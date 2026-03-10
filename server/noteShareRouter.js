'use strict';

const Y = require('yjs');
const { enforceSameOrigin } = require('./auth');
const { findLiveWorkspaceMembership, resolveLiveWorkspaceId } = require('./workspaceAccess');
const { ensureSharedWithMeWorkspace } = require('./systemWorkspaces');

function jsonResponse(res, status, body) {
	const json = JSON.stringify(body);
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
	});
	res.end(json);
}

function readJsonBody(req) {
	return new Promise((resolve) => {
		const chunks = [];
		req.on('data', (chunk) => chunks.push(chunk));
		req.on('end', () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
			} catch {
				resolve(null);
			}
		});
		req.on('error', () => resolve(null));
	});
}

function normalizeEmail(input) {
	return String(input || '').trim().toLowerCase();
}

function isValidEmail(email) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeIdentifier(input) {
	return String(input || '').trim();
}

function normalizeRole(input) {
	return String(input || '').trim().toUpperCase() === 'VIEWER' ? 'VIEWER' : 'EDITOR';
}

function normalizePlacementTarget(input) {
	return String(input || '').trim().toLowerCase() === 'shared' ? 'shared' : 'personal';
}

function splitDocRoomId(roomId) {
	const normalized = String(roomId || '').trim();
	const separator = normalized.indexOf(':');
	if (separator <= 0 || separator === normalized.length - 1) return null;
	return {
		docId: normalized,
		sourceWorkspaceId: normalized.slice(0, separator),
		sourceNoteId: normalized.slice(separator + 1),
	};
}

function resolveDocRoomId(input, fallbackWorkspaceId) {
	const normalized = String(input || '').trim();
	if (!normalized) return null;
	if (normalized.includes(':')) return normalized;
	if (!fallbackWorkspaceId) return null;
	return `${fallbackWorkspaceId}:${normalized}`;
}

function readDocumentTitle(state) {
	// Notification cards need a stable note title even when the invitation payload
	// is built server-side from persisted Yjs state instead of a live in-memory doc.
	if (!state) return '';
	try {
		const tempDoc = new Y.Doc();
		Y.applyUpdate(tempDoc, new Uint8Array(state));
		const title = tempDoc.getText('title').toString().trim();
		tempDoc.destroy();
		return title;
	} catch {
		return '';
	}
}

async function resolveTargetWorkspaceId(prisma, userId, targetKind) {
	// Shared accepts always land in the user's system Shared With Me workspace.
	// Personal accepts prefer the owner-style personal workspace and only fall back
	// to the current live workspace if the personal row cannot be resolved.
	if (targetKind === 'shared') {
		const shared = await ensureSharedWithMeWorkspace(prisma, userId);
		return shared ? String(shared.id) : null;
	}

	const personalMembership = await prisma.workspaceMember.findFirst({
		where: {
			userId,
			role: 'OWNER',
			workspace: {
				is: {
					deletedAt: null,
					systemKind: null,
				},
			},
		},
		orderBy: { workspaceId: 'asc' },
		select: { workspaceId: true },
	});
	if (personalMembership && personalMembership.workspaceId) {
		return String(personalMembership.workspaceId);
	}

	return resolveLiveWorkspaceId(prisma, userId, null);
}

async function resolveInvitee(prisma, identifier) {
	const normalized = normalizeIdentifier(identifier);
	if (!normalized) return null;
	const email = normalizeEmail(normalized);
	if (isValidEmail(email)) {
		const user = await prisma.user.findUnique({
			where: { email },
			select: { id: true, email: true, name: true, disabled: true },
		});
		return {
			email,
			user: user && !user.disabled ? user : null,
		};
	}

	const user = await prisma.user.findFirst({
		where: {
			name: {
				equals: normalized,
				mode: 'insensitive',
			},
			disabled: false,
		},
		select: { id: true, email: true, name: true, disabled: true },
	});
	if (!user || !user.email) return null;
	return {
		email: normalizeEmail(user.email),
		user,
	};
}

async function getSessionUser(prisma, session) {
	if (!session || !session.userId) return null;
	return prisma.user.findUnique({
		where: { id: session.userId },
		select: { id: true, email: true, name: true, disabled: true },
	});
}

async function resolveDocAccess(prisma, session, rawDocId) {
	if (!session || !session.userId) return null;
	const docId = resolveDocRoomId(rawDocId, session.workspaceId || null);
	const room = splitDocRoomId(docId);
	if (!room) return null;

	const document = await prisma.document.findUnique({
		where: { docId: room.docId },
		select: { docId: true, workspaceId: true },
	});
	if (!document || String(document.workspaceId) !== room.sourceWorkspaceId) {
		return null;
	}

	// Workspace members manage collaboration for source notes. Accepted recipients
	// can open the note but do not inherit collaborator-management rights merely by
	// having EDITOR access to the shared content itself.
	const membership = await findLiveWorkspaceMembership(prisma, session.userId, room.sourceWorkspaceId, { role: true });
	if (membership) {
		return {
			docId: room.docId,
			sourceWorkspaceId: room.sourceWorkspaceId,
			sourceNoteId: room.sourceNoteId,
			accessRole: membership.role === 'MEMBER' ? 'EDITOR' : 'EDITOR',
			canManage: true,
			via: 'workspace-member',
		};
	}

	const collaborator = await prisma.noteCollaborator.findFirst({
		where: {
			docId: room.docId,
			userId: session.userId,
			revokedAt: null,
		},
		select: { id: true, role: true },
	});
	if (!collaborator) return null;

	return {
		docId: room.docId,
		sourceWorkspaceId: room.sourceWorkspaceId,
		sourceNoteId: room.sourceNoteId,
		accessRole: collaborator.role,
		canManage: false,
		via: 'collaborator',
		collaboratorId: collaborator.id,
	};
}

function mapInvitation(invitation) {
	// Invitations now carry enough metadata for the notifications modal to render
	// the sender avatar and note title without an extra client-side fetch.
	return {
		id: invitation.id,
		docId: invitation.docId,
		sourceWorkspaceId: invitation.sourceWorkspaceId,
		sourceNoteId: invitation.sourceNoteId,
		role: invitation.role,
		status: invitation.status,
		inviteeEmail: invitation.inviteeEmail,
		inviteeName: invitation.inviteeName,
		createdAt: invitation.createdAt.toISOString(),
		updatedAt: invitation.updatedAt.toISOString(),
		respondedAt: invitation.respondedAt ? invitation.respondedAt.toISOString() : null,
		revokedAt: invitation.revokedAt ? invitation.revokedAt.toISOString() : null,
		inviter: invitation.inviter
			? {
				id: invitation.inviter.id,
				name: invitation.inviter.name,
				email: invitation.inviter.email,
				profileImage: invitation.inviter.profileImage || null,
			}
			: null,
		noteTitle: invitation.document ? readDocumentTitle(invitation.document.state) : '',
		placement: invitation.placement
			? {
				id: invitation.placement.id,
				targetWorkspaceId: invitation.placement.targetWorkspaceId,
				folderName: invitation.placement.folderName,
				deletedAt: invitation.placement.deletedAt ? invitation.placement.deletedAt.toISOString() : null,
			}
			: null,
	};
}

function mapCollaborator(collaborator) {
	return {
		id: collaborator.id,
		userId: collaborator.userId,
		role: collaborator.role,
		revokedAt: collaborator.revokedAt ? collaborator.revokedAt.toISOString() : null,
		createdAt: collaborator.createdAt.toISOString(),
		updatedAt: collaborator.updatedAt.toISOString(),
		user: collaborator.user
			? {
				id: collaborator.user.id,
				name: collaborator.user.name,
				email: collaborator.user.email,
			}
			: null,
	};
}

function createNoteShareRouter({ prisma, onWorkspaceMetadataChanged = null }) {
	function requireAuth(req, res) {
		if (!req.auth || !req.auth.userId) {
			jsonResponse(res, 401, { error: 'Not authenticated' });
			return null;
		}
		return req.auth;
	}

	return function handleRequest(req, res) {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname;
		const method = req.method || 'GET';

		if (!enforceSameOrigin(req, res)) return true;

		if (pathname === '/api/note-shares/invitations' && method === 'GET') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const user = await getSessionUser(prisma, session);
					if (!user || user.disabled) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					await prisma.noteShareInvitation.updateMany({
						where: {
							inviteeUserId: null,
							inviteeEmail: normalizeEmail(user.email),
						},
						data: { inviteeUserId: user.id, inviteeName: user.name },
					});

					const invitations = await prisma.noteShareInvitation.findMany({
						where: {
							revokedAt: null,
							OR: [
								{ inviteeUserId: user.id },
								{ inviteeUserId: null, inviteeEmail: normalizeEmail(user.email) },
							],
						},
						include: {
							inviter: { select: { id: true, name: true, email: true, profileImage: true } },
							document: { select: { state: true } },
							placement: true,
						},
						orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
						take: 50,
					});

					jsonResponse(res, 200, {
						invitations: invitations.map(mapInvitation),
						pendingCount: invitations.filter((item) => item.status === 'PENDING').length,
					});
				} catch (err) {
					console.error('[note-share] list invitations error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		if (pathname === '/api/note-shares/placements' && method === 'GET') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					if (!session.workspaceId) {
						jsonResponse(res, 400, { error: 'No active workspace' });
						return;
					}

					const member = await findLiveWorkspaceMembership(prisma, session.userId, session.workspaceId, { role: true });
					if (!member) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const placements = await prisma.noteSharePlacement.findMany({
						where: {
							userId: session.userId,
							targetWorkspaceId: session.workspaceId,
							deletedAt: null,
							collaborator: { revokedAt: null },
						},
						include: {
							collaborator: true,
							invitation: {
								include: {
									inviter: { select: { id: true, name: true, email: true } },
								},
							},
						},
						orderBy: { createdAt: 'desc' },
					});

					jsonResponse(res, 200, {
						placements: placements.map((placement) => ({
							id: placement.id,
							aliasId: `shared-placement:${placement.id}`,
							roomId: placement.collaborator.docId,
							sourceWorkspaceId: placement.collaborator.sourceWorkspaceId,
							sourceNoteId: placement.collaborator.sourceNoteId,
							role: placement.collaborator.role,
							folderName: placement.folderName,
							inviter: placement.invitation && placement.invitation.inviter
								? {
									id: placement.invitation.inviter.id,
									name: placement.invitation.inviter.name,
									email: placement.invitation.inviter.email,
								}
								: null,
							createdAt: placement.createdAt.toISOString(),
							updatedAt: placement.updatedAt.toISOString(),
						})),
					});
				} catch (err) {
					console.error('[note-share] list placements error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		if (pathname === '/api/note-shares/invitations' && method === 'POST') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const body = await readJsonBody(req);
					if (!body || typeof body !== 'object') {
						jsonResponse(res, 400, { error: 'Request body must be a JSON object' });
						return;
					}

					const access = await resolveDocAccess(prisma, session, body.docId);
					if (!access || !access.canManage) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const invitee = await resolveInvitee(prisma, body.identifier);
					if (!invitee || !invitee.email) {
						jsonResponse(res, 404, { error: 'User not found' });
						return;
					}

					const actor = await getSessionUser(prisma, session);
					if (!actor || actor.disabled) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}
					if (invitee.user && invitee.user.id === actor.id) {
						jsonResponse(res, 400, { error: 'You already have access to this note' });
						return;
					}

					const activeCollaborator = invitee.user
						? await prisma.noteCollaborator.findFirst({
							where: {
								docId: access.docId,
								userId: invitee.user.id,
								revokedAt: null,
							},
							select: { id: true },
						})
						: null;
					if (activeCollaborator) {
						jsonResponse(res, 409, { error: 'User is already a collaborator' });
						return;
					}

					const role = normalizeRole(body.role);
					const existingInvitation = await prisma.noteShareInvitation.findFirst({
						where: {
							docId: access.docId,
							inviteeEmail: invitee.email,
							revokedAt: null,
						},
						select: { id: true },
					});

					const invitation = existingInvitation
						? await prisma.noteShareInvitation.update({
							where: { id: existingInvitation.id },
							data: {
								docId: access.docId,
								sourceWorkspaceId: access.sourceWorkspaceId,
								sourceNoteId: access.sourceNoteId,
								inviterUserId: actor.id,
								inviteeUserId: invitee.user ? invitee.user.id : null,
								inviteeEmail: invitee.email,
								inviteeName: invitee.user ? invitee.user.name : null,
								role,
								status: 'PENDING',
								respondedAt: null,
								revokedAt: null,
							},
							include: {
								inviter: { select: { id: true, name: true, email: true } },
								placement: true,
							},
						})
						: await prisma.noteShareInvitation.create({
							data: {
								docId: access.docId,
								sourceWorkspaceId: access.sourceWorkspaceId,
								sourceNoteId: access.sourceNoteId,
								inviterUserId: actor.id,
								inviteeUserId: invitee.user ? invitee.user.id : null,
								inviteeEmail: invitee.email,
								inviteeName: invitee.user ? invitee.user.name : null,
								role,
							},
							include: {
								inviter: { select: { id: true, name: true, email: true } },
								placement: true,
							},
						});

					jsonResponse(res, 201, { invitation: mapInvitation(invitation) });

					if (typeof onWorkspaceMetadataChanged === 'function') {
						try {
							await onWorkspaceMetadataChanged({
								reason: 'note-share-invited',
								workspaceId: access.sourceWorkspaceId,
								userIds: invitee.user ? [invitee.user.id, actor.id] : [actor.id],
							});
						} catch (publishErr) {
							console.warn('[note-share] invite publish failed:', publishErr.message);
						}
					}
				} catch (err) {
					console.error('[note-share] create invitation error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		const collaboratorsMatch = pathname === '/api/note-shares/collaborators' && method === 'GET';
		if (collaboratorsMatch) {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const access = await resolveDocAccess(prisma, session, url.searchParams.get('docId'));
					if (!access) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const [collaborators, pendingInvites, selfCollaborator] = await Promise.all([
						prisma.noteCollaborator.findMany({
							where: { docId: access.docId, revokedAt: null },
							include: { user: { select: { id: true, name: true, email: true } } },
							orderBy: { createdAt: 'asc' },
						}),
						prisma.noteShareInvitation.findMany({
							where: { docId: access.docId, status: 'PENDING', revokedAt: null },
							include: { inviter: { select: { id: true, name: true, email: true } }, placement: true },
							orderBy: { createdAt: 'desc' },
						}),
						access.via === 'collaborator' && access.collaboratorId
							? prisma.noteCollaborator.findUnique({
								where: { id: access.collaboratorId },
								include: {
									invitation: {
										include: {
											inviter: { select: { id: true, name: true, email: true, profileImage: true } },
										},
									},
								},
							})
							: Promise.resolve(null),
					]);

					const visibleCollaborators = access.via === 'collaborator' && access.collaboratorId
						? collaborators.filter((collaborator) => collaborator.id !== access.collaboratorId)
						: collaborators;

					jsonResponse(res, 200, {
						roomId: access.docId,
						sourceWorkspaceId: access.sourceWorkspaceId,
						sourceNoteId: access.sourceNoteId,
						accessRole: access.accessRole,
						canManage: access.canManage,
						currentUserId: session.userId,
						selfCollaboratorId: access.via === 'collaborator' ? access.collaboratorId || null : null,
						sharedBy: selfCollaborator && selfCollaborator.invitation && selfCollaborator.invitation.inviter
							? {
								id: selfCollaborator.invitation.inviter.id,
								name: selfCollaborator.invitation.inviter.name,
								email: selfCollaborator.invitation.inviter.email,
								profileImage: selfCollaborator.invitation.inviter.profileImage || null,
							}
							: null,
						collaborators: visibleCollaborators.map(mapCollaborator),
						pendingInvitations: access.canManage ? pendingInvites.map(mapInvitation) : [],
					});
				} catch (err) {
					console.error('[note-share] collaborators error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		const invitationActionMatch = pathname.match(/^\/api\/note-shares\/invitations\/([^/]+)\/(accept|decline)$/);
		if (invitationActionMatch && method === 'POST') {
			const invitationId = decodeURIComponent(invitationActionMatch[1]);
			const action = invitationActionMatch[2];
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const body = await readJsonBody(req);
					const user = await getSessionUser(prisma, session);
					if (!user || user.disabled) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const invitation = await prisma.noteShareInvitation.findUnique({
						where: { id: invitationId },
						include: {
							inviter: { select: { id: true, name: true, email: true } },
							placement: true,
						},
					});
					if (!invitation) {
						jsonResponse(res, 404, { error: 'Invitation not found' });
						return;
					}

					const emailMatches = normalizeEmail(invitation.inviteeEmail) === normalizeEmail(user.email);
					const userMatches = invitation.inviteeUserId ? String(invitation.inviteeUserId) === user.id : emailMatches;
					if (!userMatches) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					if (action === 'decline') {
						const declined = await prisma.noteShareInvitation.update({
							where: { id: invitationId },
							data: {
								inviteeUserId: user.id,
								inviteeName: user.name,
								status: 'DECLINED',
								respondedAt: new Date(),
							},
							include: {
								inviter: { select: { id: true, name: true, email: true } },
								placement: true,
							},
						});
						jsonResponse(res, 200, { invitation: mapInvitation(declined) });
						if (typeof onWorkspaceMetadataChanged === 'function') {
							try {
								await onWorkspaceMetadataChanged({
									reason: 'note-share-declined',
									workspaceId: invitation.sourceWorkspaceId,
									userIds: [user.id, invitation.inviterUserId],
								});
							} catch (publishErr) {
								console.warn('[note-share] decline publish failed:', publishErr.message);
							}
						}
						return;
					}

					const targetKind = normalizePlacementTarget(body && typeof body === 'object' ? body.target : null);
					const folderName = body && typeof body === 'object' && typeof body.folderName === 'string'
						? body.folderName.trim().slice(0, 120)
						: '';

					const accepted = await prisma.$transaction(async (tx) => {
						const targetWorkspaceId = await resolveTargetWorkspaceId(tx, user.id, targetKind);
						if (!targetWorkspaceId) {
							throw new Error('No target workspace available');
						}

						const collaborator = await tx.noteCollaborator.upsert({
							where: { docId_userId: { docId: invitation.docId, userId: user.id } },
							update: {
								sourceWorkspaceId: invitation.sourceWorkspaceId,
								sourceNoteId: invitation.sourceNoteId,
								invitationId: invitation.id,
								role: invitation.role,
								revokedAt: null,
							},
							create: {
								docId: invitation.docId,
								sourceWorkspaceId: invitation.sourceWorkspaceId,
								sourceNoteId: invitation.sourceNoteId,
								userId: user.id,
								invitationId: invitation.id,
								role: invitation.role,
							},
						});

						const placement = await tx.noteSharePlacement.upsert({
							where: { collaboratorId: collaborator.id },
							update: {
								userId: user.id,
								invitationId: invitation.id,
								targetWorkspaceId,
								folderName: folderName || null,
								deletedAt: null,
							},
							create: {
								userId: user.id,
								invitationId: invitation.id,
								collaboratorId: collaborator.id,
								targetWorkspaceId,
								folderName: folderName || null,
							},
						});

						const updatedInvitation = await tx.noteShareInvitation.update({
							where: { id: invitation.id },
							data: {
								inviteeUserId: user.id,
								inviteeName: user.name,
								status: 'ACCEPTED',
								respondedAt: new Date(),
							},
							include: {
								inviter: { select: { id: true, name: true, email: true } },
								placement: true,
							},
						});

						return { invitation: updatedInvitation, placement };
					});

					jsonResponse(res, 200, {
						invitation: mapInvitation(accepted.invitation),
						placement: {
							id: accepted.placement.id,
							aliasId: `shared-placement:${accepted.placement.id}`,
							targetWorkspaceId: accepted.placement.targetWorkspaceId,
							folderName: accepted.placement.folderName,
						},
					});

					if (typeof onWorkspaceMetadataChanged === 'function') {
						try {
							await onWorkspaceMetadataChanged({
								reason: 'note-share-accepted',
								workspaceId: invitation.sourceWorkspaceId,
								userIds: [user.id, invitation.inviterUserId],
							});
						} catch (publishErr) {
							console.warn('[note-share] accept publish failed:', publishErr.message);
						}
					}
				} catch (err) {
					console.error(`[note-share] ${action} invitation error:`, err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		const revokeMatch = pathname.match(/^\/api\/note-shares\/collaborators\/([^/]+)$/);
		if (revokeMatch && method === 'DELETE') {
			const collaboratorId = decodeURIComponent(revokeMatch[1]);
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;

					const collaborator = await prisma.noteCollaborator.findUnique({
						where: { id: collaboratorId },
						include: {
							invitation: true,
							placement: true,
						},
					});
					if (!collaborator) {
						jsonResponse(res, 404, { error: 'Collaborator not found' });
						return;
					}

					const sourceMembership = await findLiveWorkspaceMembership(prisma, session.userId, collaborator.sourceWorkspaceId, { role: true });
					const isSelf = collaborator.userId === session.userId;
					if (!sourceMembership && !isSelf) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					await prisma.$transaction(async (tx) => {
						await tx.noteCollaborator.update({
							where: { id: collaborator.id },
							data: { revokedAt: new Date() },
						});
						if (collaborator.invitationId) {
							await tx.noteShareInvitation.update({
								where: { id: collaborator.invitationId },
								data: { status: 'REVOKED', revokedAt: new Date() },
							});
						}
						if (collaborator.placement) {
							await tx.noteSharePlacement.update({
								where: { id: collaborator.placement.id },
								data: { deletedAt: new Date() },
							});
						}
					});

					jsonResponse(res, 200, { ok: true, collaboratorId: collaborator.id });

					if (typeof onWorkspaceMetadataChanged === 'function') {
						try {
							await onWorkspaceMetadataChanged({
								reason: 'note-share-revoked',
								workspaceId: collaborator.sourceWorkspaceId,
								userIds: [collaborator.userId, session.userId],
							});
						} catch (publishErr) {
							console.warn('[note-share] revoke publish failed:', publishErr.message);
						}
					}
				} catch (err) {
					console.error('[note-share] revoke collaborator error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		return false;
	};
}

module.exports = {
	createNoteShareRouter,
	resolveDocRoomId,
	splitDocRoomId,
};