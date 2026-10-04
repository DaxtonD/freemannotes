'use strict';

const crypto = require('crypto');
const Y = require('yjs');
const { enforceSameOrigin } = require('./auth');
const {
	ensureSharedWithMeWorkspace,
	normalizePlacementTarget,
	resolveTargetWorkspaceId,
} = require('./systemWorkspaces');
const { findLiveWorkspace, findLiveWorkspaceMembership, resolveLiveWorkspaceId } = require('./workspaceAccess');
const { normalizeWorkspaceRole, canManageWorkspace } = require('./workspaceRoles');

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
				const raw = Buffer.concat(chunks).toString('utf-8');
				resolve(JSON.parse(raw));
			} catch {
				resolve(null);
			}
		});
		req.on('error', () => resolve(null));
	});
}

function appBaseUrlFromRequest(req) {
	const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
	const proto = forwardedProto || 'http';
	const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
	const host = forwardedHost || String(req.headers.host || 'localhost');
	return `${proto}://${host}`;
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

function normalizeEntityType(input) {
	const value = String(input || '').trim().toUpperCase();
	if (value === 'WORKSPACE') return 'WORKSPACE';
	if (value === 'NOTE') return 'NOTE';
	return null;
}

function normalizeNotePermission(input) {
	return String(input || '').trim().toUpperCase() === 'EDITOR' ? 'EDITOR' : 'VIEWER';
}

function normalizeWorkspacePermission(input) {
	const normalized = String(input || '').trim().toUpperCase();
	if (normalized === 'ADMIN') return 'ADMIN';
	if (normalized === 'EDITOR') return 'EDITOR';
	return 'VIEWER';
}

function normalizeExpiryDays(input) {
	const parsed = Number(input);
	if (parsed === 1 || parsed === 7 || parsed === 30) return parsed;
	return 7;
}

function permissionToNoteRole(permission) {
	return permission === 'EDITOR' ? 'EDITOR' : 'VIEWER';
}

function permissionToWorkspaceRole(permission) {
	if (permission === 'ADMIN') return 'ADMIN';
	if (permission === 'EDITOR') return 'EDITOR';
	return 'VIEWER';
}

function readDocumentTitle(state) {
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

function buildShareUrl(req, token) {
	const base = String(process.env.APP_URL || '').trim() || appBaseUrlFromRequest(req);
	return `${base.replace(/\/$/, '')}/share/${token}`;
}

function requireAuth(req, res) {
	if (!req.auth || !req.auth.userId) {
		jsonResponse(res, 401, { error: 'Not authenticated' });
		return null;
	}
	return req.auth;
}

async function resolveNoteForCreation(prisma, session, rawDocId) {
	const docId = resolveDocRoomId(rawDocId, session.workspaceId || null);
	const room = splitDocRoomId(docId);
	if (!room) return { error: 'Document not found' };

	const [document, membership] = await Promise.all([
		prisma.document.findUnique({
			where: { docId: room.docId },
			select: { docId: true, workspaceId: true, state: true },
		}),
		findLiveWorkspaceMembership(prisma, session.userId, room.sourceWorkspaceId, { role: true }),
	]);

	if (!document || String(document.workspaceId) !== room.sourceWorkspaceId) {
		return { error: 'Document not found' };
	}
	if (!membership) {
		return { error: 'Forbidden', status: 403 };
	}

	return {
		docId: room.docId,
		sourceWorkspaceId: room.sourceWorkspaceId,
		title: readDocumentTitle(document.state) || room.sourceNoteId,
	};
}

async function resolveWorkspaceForCreation(prisma, session, workspaceId) {
	const [workspace, membership] = await Promise.all([
		findLiveWorkspace(prisma, workspaceId, { id: true, name: true }),
		findLiveWorkspaceMembership(prisma, session.userId, workspaceId, { role: true }),
	]);
	if (!workspace) return { error: 'Workspace not found', status: 404 };
	if (!membership || !canManageWorkspace(membership.role)) {
		return { error: 'Forbidden', status: 403 };
	}
	return workspace;
}

async function readShareMetadata(prisma, token) {
	const share = await prisma.shareAccessToken.findUnique({
		where: { token },
		include: {
			creator: { select: { id: true, name: true, email: true } },
			sourceWorkspace: { select: { id: true, name: true } },
		},
	});
	if (!share || share.revokedAt) return null;

	if (share.entityType === 'WORKSPACE') {
		const workspace = await findLiveWorkspace(prisma, share.entityId, { id: true, name: true });
		if (!workspace) return { share, missing: true };
		return {
			share,
			missing: false,
			entityType: 'WORKSPACE',
			label: workspace.name,
			workspaceId: workspace.id,
		};
	}

	const document = await prisma.document.findUnique({
		where: { docId: share.entityId },
		select: { docId: true, workspaceId: true, state: true },
	});
	if (!document) return { share, missing: true };
	const room = splitDocRoomId(document.docId);
	return {
		share,
		missing: false,
		entityType: 'NOTE',
		label: readDocumentTitle(document.state) || (room ? room.sourceNoteId : document.docId),
		workspaceId: room ? room.sourceWorkspaceId : String(document.workspaceId),
		docId: document.docId,
	};
}

async function acceptWorkspaceShare(prisma, session, metadata) {
	const workspace = await findLiveWorkspace(prisma, metadata.workspaceId, { id: true, name: true });
	if (!workspace) {
		return { statusCode: 410, body: { error: 'Workspace no longer exists' } };
	}

	const existing = await findLiveWorkspaceMembership(prisma, session.userId, metadata.workspaceId, { role: true });
	if (existing) {
		return {
			statusCode: 200,
			body: {
				ok: true,
				status: 'already-has-access',
				entityType: 'workspace',
				workspaceId: workspace.id,
				workspaceName: workspace.name,
				permission: normalizeWorkspaceRole(existing.role, 'VIEWER'),
			},
		};
	}

	const role = permissionToWorkspaceRole(metadata.share.permission);
	await prisma.workspaceMember.upsert({
		where: { userId_workspaceId: { userId: session.userId, workspaceId: workspace.id } },
		update: { role },
		create: { userId: session.userId, workspaceId: workspace.id, role },
	});

	return {
		statusCode: 200,
		body: {
			ok: true,
			status: 'accepted',
			entityType: 'workspace',
			workspaceId: workspace.id,
			workspaceName: workspace.name,
			permission: role,
		},
	};
}

async function acceptNoteShare(prisma, session, metadata, targetKind) {
	const room = splitDocRoomId(metadata.docId);
	if (!room) {
		return { statusCode: 410, body: { error: 'Shared note no longer exists' } };
	}

	const sourceMembership = await findLiveWorkspaceMembership(prisma, session.userId, metadata.workspaceId, { role: true });
	if (sourceMembership) {
		return {
			statusCode: 200,
			body: {
				ok: true,
				status: 'already-has-access',
				entityType: 'note',
				docId: metadata.docId,
				sourceNoteId: room.sourceNoteId,
				title: metadata.label,
				targetWorkspaceId: metadata.workspaceId,
				permission: sourceMembership.role,
			},
		};
	}

	const existingCollaborator = await prisma.noteCollaborator.findFirst({
		where: {
			docId: metadata.docId,
			userId: session.userId,
			revokedAt: null,
		},
		include: { placement: true },
	});
	if (existingCollaborator) {
		return {
			statusCode: 200,
			body: {
				ok: true,
				status: 'already-has-access',
				entityType: 'note',
				docId: metadata.docId,
				sourceNoteId: room.sourceNoteId,
				title: metadata.label,
				targetWorkspaceId: existingCollaborator.placement ? existingCollaborator.placement.targetWorkspaceId : metadata.workspaceId,
				placementAliasId: existingCollaborator.placement ? `shared-placement:${existingCollaborator.placement.id}` : null,
				permission: existingCollaborator.role,
			},
		};
	}

	const user = await prisma.user.findUnique({
		where: { id: session.userId },
		select: { id: true, email: true, name: true, disabled: true },
	});
	if (!user || user.disabled) {
		return { statusCode: 403, body: { error: 'Forbidden' } };
	}

	const accepted = await prisma.$transaction(async (tx) => {
		// Was hardcoded to Shared With Me, which is why a link accept never asked where the note
		// should go while an invitation accept always did. Same helper as the invitation path now,
		// so the two can't answer the question differently.
		const targetWorkspaceId = await resolveTargetWorkspaceId(tx, user.id, targetKind, resolveLiveWorkspaceId);
		const targetWorkspace = targetWorkspaceId
			? { id: targetWorkspaceId }
			: await ensureSharedWithMeWorkspace(tx, user.id);
		const invitation = await tx.noteShareInvitation.create({
			data: {
				docId: metadata.docId,
				sourceWorkspaceId: metadata.workspaceId,
				sourceNoteId: room.sourceNoteId,
				inviterUserId: metadata.share.createdByUserId,
				inviteeUserId: user.id,
				inviteeEmail: user.email,
				inviteeName: user.name,
				role: permissionToNoteRole(metadata.share.permission),
				status: 'ACCEPTED',
				respondedAt: new Date(),
			},
		});

		const collaborator = await tx.noteCollaborator.upsert({
			where: { docId_userId: { docId: metadata.docId, userId: user.id } },
			update: {
				sourceWorkspaceId: metadata.workspaceId,
				sourceNoteId: room.sourceNoteId,
				invitationId: invitation.id,
				role: permissionToNoteRole(metadata.share.permission),
				revokedAt: null,
			},
			create: {
				docId: metadata.docId,
				sourceWorkspaceId: metadata.workspaceId,
				sourceNoteId: room.sourceNoteId,
				userId: user.id,
				invitationId: invitation.id,
				role: permissionToNoteRole(metadata.share.permission),
			},
		});

		const placement = await tx.noteSharePlacement.upsert({
			where: { collaboratorId: collaborator.id },
			update: {
				userId: user.id,
				invitationId: invitation.id,
				targetWorkspaceId: targetWorkspace.id,
				folderName: null,
				deletedAt: null,
			},
			create: {
				userId: user.id,
				invitationId: invitation.id,
				collaboratorId: collaborator.id,
				targetWorkspaceId: targetWorkspace.id,
				folderName: null,
			},
		});

		return { placement };
	});

	return {
		statusCode: 200,
		body: {
			ok: true,
			status: 'accepted',
			entityType: 'note',
			docId: metadata.docId,
			sourceNoteId: room.sourceNoteId,
			title: metadata.label,
			targetWorkspaceId: accepted.placement.targetWorkspaceId,
			placementAliasId: `shared-placement:${accepted.placement.id}`,
			permission: permissionToNoteRole(metadata.share.permission),
		},
	};
}

function createShareRouter({ prisma }) {
	async function createShareLink(req, res, args) {
		const session = requireAuth(req, res);
		if (!session) return;

		const entityType = normalizeEntityType(args.entityType);
		if (!entityType) {
			jsonResponse(res, 400, { error: 'entityType must be NOTE or WORKSPACE' });
			return;
		}

		const expiresInDays = normalizeExpiryDays(args.expiresInDays);
		const token = crypto.randomBytes(24).toString('hex');
		const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

		let permission = null;
		let entityId = '';
		let sourceWorkspaceId = null;
		let label = '';

		if (entityType === 'NOTE') {
			const note = await resolveNoteForCreation(prisma, session, args.entityId);
			if (note.error) {
				jsonResponse(res, note.status || 404, { error: note.error });
				return;
			}
			permission = normalizeNotePermission(args.permission);
			entityId = note.docId;
			sourceWorkspaceId = note.sourceWorkspaceId;
			label = note.title;
		} else {
			const workspace = await resolveWorkspaceForCreation(prisma, session, String(args.entityId || '').trim());
			if (workspace.error) {
				jsonResponse(res, workspace.status || 404, { error: workspace.error });
				return;
			}
			permission = normalizeWorkspacePermission(args.permission);
			entityId = workspace.id;
			sourceWorkspaceId = workspace.id;
			label = workspace.name;
		}

		// Reuse a live link rather than minting another. Creation used to be unconditional, so the
		// same person asking for the same link from a second device — or after clearing site data —
		// silently created a second token for the same note. The list below could then show links
		// nobody remembered making, and each had to be revoked separately. One live link per
		// (creator, entity, permission) is what people assume they already have.
		const existing = await prisma.shareAccessToken.findFirst({
			where: {
				entityType,
				entityId,
				permission,
				createdByUserId: session.userId,
				revokedAt: null,
				expiresAt: { gt: new Date() },
			},
			orderBy: { expiresAt: 'desc' },
		});
		if (existing) {
			jsonResponse(res, 200, {
				ok: true,
				entityType: entityType.toLowerCase(),
				permission,
				shareUrl: buildShareUrl(req, existing.token),
				expiresAt: existing.expiresAt.toISOString(),
				label,
				reused: true,
			});
			return;
		}

		await prisma.shareAccessToken.create({
			data: {
				token,
				entityType,
				entityId,
				sourceWorkspaceId,
				createdByUserId: session.userId,
				permission,
				expiresAt,
			},
		});

		jsonResponse(res, 201, {
			ok: true,
			entityType: entityType.toLowerCase(),
			permission,
			shareUrl: buildShareUrl(req, token),
			expiresAt: expiresAt.toISOString(),
			label,
		});
	}

	return function handleRequest(req, res) {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname;
		const method = req.method || 'GET';

		const legacyCreateMatch = pathname.match(/^\/api\/docs\/([^/]+)\/share$/);
		if (legacyCreateMatch && method === 'POST') {
			if (!enforceSameOrigin(req, res)) return true;
			(async () => {
				const body = await readJsonBody(req);
				await createShareLink(req, res, {
					entityType: 'NOTE',
					entityId: decodeURIComponent(legacyCreateMatch[1]),
					permission: body && typeof body === 'object' ? body.permission : null,
					expiresInDays: body && typeof body === 'object' ? body.expiresInDays : null,
				});
			})();
			return true;
		}

		// The server is the record of which links exist. It wasn't: the only list anyone had was a
		// localStorage cache, so a link made on one device was invisible on every other, and there
		// was no way to see — let alone revoke — a link you'd made and forgotten.
		if (pathname === '/api/share-links' && method === 'GET') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const entityType = normalizeEntityType(url.searchParams.get('entityType'));
					const entityId = String(url.searchParams.get('entityId') || '').trim();
					if (!entityType || !entityId) {
						jsonResponse(res, 400, { error: 'entityType and entityId are required' });
						return;
					}
					// Scoped to the caller's own links on purpose: someone else's link to the same
					// note is not yours to see or revoke, even if you can both reach the note.
					const links = await prisma.shareAccessToken.findMany({
						where: {
							entityType,
							entityId,
							createdByUserId: session.userId,
							revokedAt: null,
							expiresAt: { gt: new Date() },
						},
						orderBy: { createdAt: 'desc' },
					});
					jsonResponse(res, 200, {
						links: links.map((link) => ({
							id: link.id,
							entityType: link.entityType.toLowerCase(),
							permission: link.permission,
							shareUrl: buildShareUrl(req, link.token),
							expiresAt: link.expiresAt.toISOString(),
							createdAt: link.createdAt.toISOString(),
						})),
					});
				} catch (err) {
					console.error('[share] list links error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		const revokeMatch = pathname.match(/^\/api\/share-links\/([^/]+)$/);
		if (revokeMatch && method === 'DELETE') {
			if (!enforceSameOrigin(req, res)) return true;
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const id = decodeURIComponent(revokeMatch[1]);
					// Soft revoke rather than delete, so an accepted share keeps its provenance.
					const result = await prisma.shareAccessToken.updateMany({
						where: { id, createdByUserId: session.userId, revokedAt: null },
						data: { revokedAt: new Date() },
					});
					if (result.count === 0) {
						jsonResponse(res, 404, { error: 'Share link not found' });
						return;
					}
					jsonResponse(res, 200, { ok: true });
				} catch (err) {
					console.error('[share] revoke link error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		if (pathname === '/api/share-links' && method === 'POST') {
			if (!enforceSameOrigin(req, res)) return true;
			(async () => {
				const body = await readJsonBody(req);
				if (!body || typeof body !== 'object') {
					jsonResponse(res, 400, { error: 'Request body must be a JSON object' });
					return;
				}
				await createShareLink(req, res, body);
			})();
			return true;
		}

		const readMatch = pathname.match(/^\/api\/share\/([^/]+)$/);
		if (readMatch && method === 'GET') {
			(async () => {
				try {
					const token = decodeURIComponent(readMatch[1]);
					const metadata = await readShareMetadata(prisma, token);
					if (!metadata) {
						jsonResponse(res, 404, { error: 'Share not found' });
						return;
					}
					if (metadata.share.expiresAt.getTime() < Date.now()) {
						jsonResponse(res, 410, { error: 'Share expired' });
						return;
					}
					if (metadata.missing) {
						jsonResponse(res, 410, { error: 'Shared item no longer exists' });
						return;
					}
					jsonResponse(res, 200, {
						entityType: metadata.entityType.toLowerCase(),
						permission: metadata.share.permission,
						expiresAt: metadata.share.expiresAt.toISOString(),
						label: metadata.label,
						creator: metadata.share.creator
							? {
								id: metadata.share.creator.id,
								name: metadata.share.creator.name,
								email: metadata.share.creator.email,
							}
							: null,
					});
				} catch (err) {
					console.error('[share] read metadata error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		if (pathname === '/api/share/accept' && method === 'POST') {
			if (!enforceSameOrigin(req, res)) return true;
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const body = await readJsonBody(req);
					const token = body && typeof body === 'object' ? String(body.token || '').trim() : '';
					if (!token) {
						jsonResponse(res, 400, { error: 'Missing token' });
						return;
					}

					const metadata = await readShareMetadata(prisma, token);
					if (!metadata) {
						jsonResponse(res, 404, { error: 'Share not found' });
						return;
					}
					if (metadata.share.expiresAt.getTime() < Date.now()) {
						jsonResponse(res, 410, { error: 'Share expired' });
						return;
					}
					if (metadata.missing) {
						jsonResponse(res, 410, { error: 'Shared item no longer exists' });
						return;
					}

					// 'personal' unless asked otherwise, matching the invitation accept's default.
					const targetKind = normalizePlacementTarget(body && typeof body === 'object' ? body.target : null);
					const result = metadata.entityType === 'WORKSPACE'
						? await acceptWorkspaceShare(prisma, session, metadata)
						: await acceptNoteShare(prisma, session, metadata, targetKind);
					jsonResponse(res, result.statusCode, result.body);
				} catch (err) {
					console.error('[share] accept error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		return false;
	};
}

module.exports = { createShareRouter };
