'use strict';

const crypto = require('crypto');
const { sendInviteEmail } = require('./mailer');
const { enforceSameOrigin } = require('./auth');
const { createRateLimiter, getClientIp } = require('./rateLimit');
const { findLiveWorkspace, findLiveWorkspaceMembership } = require('./workspaceAccess');
const { normalizeWorkspaceRole: normalizeStoredWorkspaceRole, canManageWorkspace } = require('./workspaceRoles');

const inviteLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 50 });
const acceptLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40 });

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

function normalizeEmail(input) {
	return String(input || '').trim().toLowerCase();
}

function normalizeIdentifier(input) {
	return String(input || '').trim();
}

function isValidEmail(email) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function resolveInvitee(prisma, identifier) {
	const normalized = normalizeIdentifier(identifier);
	if (!normalized) return null;
	// Workspace invites accept either an email address or an in-app username.
	// Existing accounts are resolved up front so the invite can target the
	// canonical account email and optionally skip SMTP delivery.
	const email = normalizeEmail(normalized);
	if (isValidEmail(email)) {
		const user = await prisma.user.findFirst({
			where: { email: { equals: email, mode: 'insensitive' } },
			select: { id: true, email: true, name: true, disabled: true },
		});
		return {
			identifier: normalized,
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
		identifier: normalized,
		email: normalizeEmail(user.email),
		user,
	};
}

function appBaseUrlFromRequest(req) {
	const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
	const proto = forwardedProto || 'http';
	const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
	const host = forwardedHost || String(req.headers.host || 'localhost');
	return `${proto}://${host}`;
}

function normalizeWorkspaceRole(input) {
	const normalized = normalizeStoredWorkspaceRole(input);
	if (normalized === 'OWNER') return 'OWNER';
	if (normalized === 'ADMIN') return 'ADMIN';
	if (normalized === 'EDITOR') return 'EDITOR';
	return 'VIEWER';
}

function normalizeAssignableWorkspaceRole(input) {
	const normalized = normalizeStoredWorkspaceRole(input);
	if (normalized === 'ADMIN') return 'ADMIN';
	if (normalized === 'EDITOR') return 'EDITOR';
	return 'VIEWER';
}

async function requireWorkspaceAdmin(prisma, userId, workspaceId) {
	const member = await findLiveWorkspaceMembership(prisma, userId, workspaceId, { role: true });
	if (!member) return null;
	return canManageWorkspace(member.role) ? { ...member, role: normalizeWorkspaceRole(member.role) } : null;
}

async function listWorkspaceInviteState(prisma, workspaceId, baseUrl) {
	const [members, invites] = await Promise.all([
		prisma.workspaceMember.findMany({
			where: { workspaceId, workspace: { is: { deletedAt: null } } },
			include: {
				user: { select: { id: true, email: true, name: true, profileImage: true } },
			},
			orderBy: [{ role: 'asc' }, { userId: 'asc' }],
		}),
		prisma.inviteToken.findMany({
			where: {
				workspaceId,
				used: false,
				expiresAt: { gt: new Date() },
			},
			include: {
				creator: { select: { id: true, name: true, email: true } },
			},
			orderBy: [{ expiresAt: 'asc' }, { email: 'asc' }],
		}),
	]);

	return {
		members: members.map((member) => ({
			id: member.user ? member.user.id : `${workspaceId}:${member.userId}`,
			userId: member.user ? member.user.id : null,
			email: normalizeEmail(member.user ? member.user.email : ''),
			name: member.user ? member.user.name : null,
			profileImage: member.user ? member.user.profileImage || null : null,
			role: normalizeWorkspaceRole(member.role),
		})),
		invites: invites.map((invite) => ({
			id: invite.id,
			email: normalizeEmail(invite.email),
			role: normalizeWorkspaceRole(invite.role),
			expiresAt: invite.expiresAt.toISOString(),
			inviteUrl: `${baseUrl.replace(/\/$/, '')}/invite/${invite.token}`,
			name: null,
			creator: invite.creator
				? {
					id: invite.creator.id,
					name: invite.creator.name,
					email: invite.creator.email,
				}
				: null,
		})),
	};
}

async function publishWorkspaceInviteMetadataChange(onWorkspaceMetadataChanged, event, errorLabel) {
	if (typeof onWorkspaceMetadataChanged !== 'function') return;
	try {
		await onWorkspaceMetadataChanged(event);
	} catch (publishErr) {
		console.warn(`[invite] ${errorLabel} publish failed:`, publishErr.message);
	}
}

function createInviteRouter({ prisma, onWorkspaceMetadataChanged }) {
	function requireAuth(req, res) {
		if (!req.auth || !req.auth.userId) {
			jsonResponse(res, 401, { error: 'Not authenticated' });
			return null;
		}
		return req.auth;
	}

	async function resolveInviteForAcceptance(body) {
		const token = body && typeof body === 'object' ? String(body.token || '').trim() : '';
		const inviteId = body && typeof body === 'object' ? String(body.inviteId || '').trim() : '';
		if (token) {
			return prisma.inviteToken.findUnique({
				where: { token },
				include: {
					workspace: { select: { id: true, name: true } },
					creator: { select: { id: true, name: true, email: true } },
				},
			});
		}
		if (inviteId) {
			return prisma.inviteToken.findUnique({
				where: { id: inviteId },
				include: {
					workspace: { select: { id: true, name: true } },
					creator: { select: { id: true, name: true, email: true } },
				},
			});
		}
		return null;
	}

	return function handleRequest(req, res) {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname;
		const method = req.method || 'GET';

		if (!enforceSameOrigin(req, res)) return true;

		const inviteMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/invites$/);
		if (inviteMatch && method === 'GET') {
			const workspaceId = decodeURIComponent(inviteMatch[1]);
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;

					const member = await requireWorkspaceAdmin(prisma, session.userId, workspaceId);
					if (!member) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const workspace = await findLiveWorkspace(prisma, workspaceId, { id: true });
					if (!workspace) {
						jsonResponse(res, 404, { error: 'Workspace not found' });
						return;
					}

					jsonResponse(res, 200, await listWorkspaceInviteState(prisma, workspaceId, appBaseUrlFromRequest(req)));
				} catch (err) {
					console.error('[invite] list error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		if (inviteMatch && method === 'POST') {
			const workspaceId = decodeURIComponent(inviteMatch[1]);
			const ip = getClientIp(req);
			if (!inviteLimiter.allow(`${ip}:invite:${workspaceId}`)) {
				jsonResponse(res, 429, { error: 'Too many requests' });
				return true;
			}
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;

					const member = await requireWorkspaceAdmin(prisma, session.userId, workspaceId);
					if (!member) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const body = await readJsonBody(req);
					if (!body || typeof body !== 'object') {
						jsonResponse(res, 400, { error: 'Request body must be a JSON object' });
						return;
					}

					const identifier = normalizeIdentifier(body.identifier || body.email);
					const role = normalizeAssignableWorkspaceRole(body.role);
					const sendEmail = body.sendEmail !== false;
					if (!identifier) {
						jsonResponse(res, 400, { error: 'Username or email is required' });
						return;
					}
					if (!['VIEWER', 'EDITOR', 'ADMIN'].includes(role)) {
						jsonResponse(res, 400, { error: 'role must be VIEWER, EDITOR, or ADMIN' });
						return;
					}

					const workspace = await findLiveWorkspace(prisma, workspaceId, { id: true, name: true });
					if (!workspace) {
						jsonResponse(res, 404, { error: 'Workspace not found' });
						return;
					}

					const resolvedInvitee = await resolveInvitee(prisma, identifier);
					if (!resolvedInvitee) {
						jsonResponse(res, 404, { error: 'No matching user or email address found' });
						return;
					}
					const email = resolvedInvitee.email;
					const existingUser = resolvedInvitee.user;
					const [existingMember, existingInvite] = await Promise.all([
						prisma.workspaceMember.findFirst({
							where: {
								workspaceId,
								workspace: { is: { deletedAt: null } },
								user: { is: { email: { equals: email, mode: 'insensitive' } } },
							},
							select: { id: true },
						}),
						prisma.inviteToken.findFirst({
							where: {
								workspaceId,
								email,
								used: false,
								expiresAt: { gt: new Date() },
							},
							select: { id: true },
						}),
					]);
					if (existingMember) {
						jsonResponse(res, 409, { error: 'This user already belongs to the workspace' });
						return;
					}
					if (existingInvite) {
						jsonResponse(res, 409, { error: 'This user already has a pending invite' });
						return;
					}

					const token = crypto.randomBytes(24).toString('hex');
					const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
					const invite = await prisma.inviteToken.create({
						data: {
							email,
							workspaceId,
							createdByUserId: session.userId,
							role,
							token,
							expiresAt,
						},
						select: { id: true },
					});

					const base = String(process.env.APP_URL || '').trim() || appBaseUrlFromRequest(req);
					const inviteUrl = `${base.replace(/\/$/, '')}/invite/${token}`;
					const sentEmail = sendEmail && !existingUser;
					// Existing users receive the invite in-app, so email is only sent when the
					// identifier did not resolve to a local account.
					if (sentEmail) {
						await sendInviteEmail({ to: email, workspaceName: workspace.name, inviteUrl });
					}

					jsonResponse(res, 201, {
						ok: true,
						inviteId: invite.id,
						inviteUrl,
						expiresAt: expiresAt.toISOString(),
						email,
						role,
						sentEmail,
						deliveredInApp: Boolean(existingUser),
					});

					await publishWorkspaceInviteMetadataChange(
						onWorkspaceMetadataChanged,
						{
							reason: 'workspace-invite-created',
							workspaceId,
							userIds: existingUser ? [existingUser.id, session.userId] : [session.userId],
						},
						'create invite'
					);
				} catch (err) {
					console.error('[invite] create error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		const memberMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/members\/([^/]+)$/);
		if (memberMatch && (method === 'PATCH' || method === 'DELETE')) {
			const workspaceId = decodeURIComponent(memberMatch[1]);
			const targetUserId = decodeURIComponent(memberMatch[2]);
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;

					const actor = await requireWorkspaceAdmin(prisma, session.userId, workspaceId);
					if (!actor) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const target = await prisma.workspaceMember.findUnique({
						where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
						select: { userId: true, role: true },
					});
					if (!target) {
						jsonResponse(res, 404, { error: 'Workspace member not found' });
						return;
					}
					if (target.role === 'OWNER') {
						jsonResponse(res, 403, { error: 'Workspace owner cannot be changed here' });
						return;
					}

					if (method === 'DELETE') {
						const body = await readJsonBody(req);
						const expectedRole = body && typeof body === 'object' && typeof body.expectedRole === 'string'
							? normalizeWorkspaceRole(body.expectedRole)
							: '';
						const currentRole = normalizeWorkspaceRole(target.role);
						if (expectedRole && expectedRole !== currentRole) {
							jsonResponse(res, 409, { error: 'Workspace member changed before this action could sync', code: 'STALE_MEMBER_ROLE', currentRole });
							return;
						}
						await prisma.workspaceMember.delete({ where: { userId_workspaceId: { userId: targetUserId, workspaceId } } });
						jsonResponse(res, 200, { ok: true, userId: targetUserId });
						await publishWorkspaceInviteMetadataChange(
							onWorkspaceMetadataChanged,
							{
								reason: 'workspace-member-removed',
								workspaceId,
								userIds: [targetUserId, session.userId],
							},
							'remove member'
						);
						return;
					}

					const body = await readJsonBody(req);
					if (!body || typeof body !== 'object') {
						jsonResponse(res, 400, { error: 'Request body must be a JSON object' });
						return;
					}
					const role = normalizeAssignableWorkspaceRole(body.role);
					const expectedRole = typeof body.expectedRole === 'string' ? normalizeWorkspaceRole(body.expectedRole) : '';
					const currentRole = normalizeWorkspaceRole(target.role);
					if (expectedRole && expectedRole !== currentRole) {
						jsonResponse(res, 409, { error: 'Workspace member changed before this action could sync', code: 'STALE_MEMBER_ROLE', currentRole });
						return;
					}
					if (!['VIEWER', 'EDITOR', 'ADMIN'].includes(role)) {
						jsonResponse(res, 400, { error: 'role must be VIEWER, EDITOR, or ADMIN' });
						return;
					}
					await prisma.workspaceMember.update({
						where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
						data: { role },
					});
					jsonResponse(res, 200, { ok: true, userId: targetUserId, role });
					await publishWorkspaceInviteMetadataChange(
						onWorkspaceMetadataChanged,
						{
							reason: 'workspace-member-role-updated',
							workspaceId,
							userIds: [targetUserId, session.userId],
						},
						'update member'
					);
				} catch (err) {
					console.error('[invite] member mutation error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		const cancelInviteMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/invites\/([^/]+)\/cancel$/);
		if (cancelInviteMatch && method === 'POST') {
			const workspaceId = decodeURIComponent(cancelInviteMatch[1]);
			const inviteId = decodeURIComponent(cancelInviteMatch[2]);
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;

					const actor = await requireWorkspaceAdmin(prisma, session.userId, workspaceId);
					if (!actor) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const invite = await prisma.inviteToken.findUnique({
						where: { id: inviteId },
						select: { id: true, workspaceId: true, used: true, role: true, email: true },
					});
					if (!invite || invite.workspaceId !== workspaceId || invite.used) {
						jsonResponse(res, 409, { error: 'Invite changed before this action could sync', code: 'STALE_INVITE' });
						return;
					}
					const body = await readJsonBody(req);
					const expectedRole = body && typeof body === 'object' && typeof body.expectedRole === 'string'
						? normalizeWorkspaceRole(body.expectedRole)
						: '';
					const currentRole = normalizeWorkspaceRole(invite.role);
					if (expectedRole && expectedRole !== currentRole) {
						jsonResponse(res, 409, { error: 'Invite changed before this action could sync', code: 'STALE_INVITE_ROLE', currentRole });
						return;
					}

					await prisma.inviteToken.update({ where: { id: inviteId }, data: { used: true } });
					jsonResponse(res, 200, { ok: true, inviteId });

					const invitee = await prisma.user.findFirst({
						where: { email: { equals: invite.email, mode: 'insensitive' } },
						select: { id: true },
					});
					await publishWorkspaceInviteMetadataChange(
						onWorkspaceMetadataChanged,
						{
							reason: 'workspace-invite-cancelled',
							workspaceId,
							userIds: invitee ? [invitee.id, session.userId] : [session.userId],
						},
						'cancel invite'
					);
				} catch (err) {
					console.error('[invite] cancel error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		if (pathname === '/api/invites' && method === 'GET') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const user = await prisma.user.findUnique({
						where: { id: session.userId },
						select: { email: true },
					});
					if (!user || !user.email) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const invites = await prisma.inviteToken.findMany({
						where: {
							email: normalizeEmail(user.email),
							used: false,
							expiresAt: { gt: new Date() },
							workspace: { is: { deletedAt: null } },
						},
						include: {
							workspace: { select: { id: true, name: true } },
							creator: { select: { id: true, name: true, email: true } },
						},
						orderBy: [{ createdAt: 'desc' }],
					});

					jsonResponse(res, 200, {
						invites: invites.map((invite) => ({
							id: invite.id,
							workspaceId: invite.workspaceId,
							workspaceName: invite.workspace ? invite.workspace.name : '',
							role: normalizeWorkspaceRole(invite.role),
							email: normalizeEmail(invite.email),
							createdAt: invite.createdAt.toISOString(),
							expiresAt: invite.expiresAt.toISOString(),
							inviter: invite.creator
								? {
									id: invite.creator.id,
									name: invite.creator.name,
									email: invite.creator.email,
								}
								: null,
						})),
					});
				} catch (err) {
					console.error('[invite] notifications error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		if (pathname === '/api/invites/accept' && method === 'POST') {
			const ip = getClientIp(req);
			if (!acceptLimiter.allow(`${ip}:invite-accept`)) {
				jsonResponse(res, 429, { error: 'Too many requests' });
				return true;
			}
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const body = await readJsonBody(req);
					const invite = await resolveInviteForAcceptance(body);
					if (!invite || invite.used) {
						jsonResponse(res, 404, { error: 'Invite not found' });
						return;
					}
					if (invite.expiresAt.getTime() < Date.now()) {
						jsonResponse(res, 410, { error: 'Invite expired' });
						return;
					}

					const workspace = await findLiveWorkspace(prisma, invite.workspaceId, { id: true, name: true });
					if (!workspace) {
						jsonResponse(res, 410, { error: 'Workspace no longer exists' });
						return;
					}

					const user = await prisma.user.findUnique({
						where: { id: session.userId },
						select: { email: true },
					});
					if (!user) {
						jsonResponse(res, 401, { error: 'Not authenticated' });
						return;
					}
					if (normalizeEmail(user.email) !== normalizeEmail(invite.email)) {
						jsonResponse(res, 403, { error: 'Invite email does not match current user' });
						return;
					}

					await prisma.$transaction(async (tx) => {
						await tx.workspaceMember.upsert({
							where: { userId_workspaceId: { userId: session.userId, workspaceId: invite.workspaceId } },
							update: { role: normalizeWorkspaceRole(invite.role) },
							create: { userId: session.userId, workspaceId: invite.workspaceId, role: normalizeWorkspaceRole(invite.role) },
						});
						await tx.inviteToken.update({ where: { id: invite.id }, data: { used: true } });
					});

					jsonResponse(res, 200, { ok: true, workspaceId: invite.workspaceId, workspaceName: workspace.name, role: normalizeWorkspaceRole(invite.role) });
					await publishWorkspaceInviteMetadataChange(
						onWorkspaceMetadataChanged,
						{
							reason: 'workspace-invite-accepted',
							workspaceId: invite.workspaceId,
							userIds: invite.creator ? [session.userId, invite.creator.id] : [session.userId],
						},
						'accept invite'
					);
				} catch (err) {
					console.error('[invite] accept error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		const declineMatch = pathname.match(/^\/api\/invites\/([^/]+)\/decline$/);
		if (declineMatch && method === 'POST') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const inviteId = decodeURIComponent(declineMatch[1]);
					const invite = await prisma.inviteToken.findUnique({
						where: { id: inviteId },
						include: { workspace: { select: { id: true, name: true } } },
					});
					if (!invite || invite.used) {
						jsonResponse(res, 404, { error: 'Invite not found' });
						return;
					}
					const user = await prisma.user.findUnique({
						where: { id: session.userId },
						select: { email: true },
					});
					if (!user || normalizeEmail(user.email) !== normalizeEmail(invite.email)) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}
					await prisma.inviteToken.update({ where: { id: invite.id }, data: { used: true } });
					jsonResponse(res, 200, { ok: true, inviteId: invite.id });
					await publishWorkspaceInviteMetadataChange(
						onWorkspaceMetadataChanged,
						{
							reason: 'workspace-invite-declined',
							workspaceId: invite.workspaceId,
							userIds: invite.createdByUserId ? [session.userId, invite.createdByUserId] : [session.userId],
						},
						'decline invite'
					);
				} catch (err) {
					console.error('[invite] decline error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		return false;
	};
}

module.exports = { createInviteRouter };
