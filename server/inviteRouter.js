'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// inviteRouter.js — Workspace email invitations.
//
// Endpoints:
//   - POST /api/workspaces/:id/invites
//       Creates an invite token for a specific email address and sends the
//       invite link via SMTP.
//   - POST /api/invites/accept
//       Marks an invite token as used and upserts a workspace membership for
//       the authenticated user.
//
// Security model:
//   - Both endpoints require authentication (cookie session).
//   - Mutations are protected by `enforceSameOrigin` to reduce CSRF risk.
//   - Invite creation additionally checks the caller is OWNER/ADMIN in the
//     target workspace.
//   - Invite acceptance checks that the authenticated user's email matches the
//     invite email (prevents using someone else's token).
//
// Operational notes:
//   - SMTP must be configured for sending emails (see server/mailer.js).
//   - Rate limiting is in-process (per Node instance).
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { sendInviteEmail } = require('./mailer');
const { enforceSameOrigin } = require('./auth');
const { createRateLimiter, getClientIp } = require('./rateLimit');
const { findLiveWorkspace, findLiveWorkspaceMembership } = require('./workspaceAccess');

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

function isValidEmail(email) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function appBaseUrlFromRequest(req) {
	const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
	const proto = forwardedProto || 'http';
	const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
	const host = forwardedHost || String(req.headers.host || 'localhost');
	return `${proto}://${host}`;
}

function createInviteRouter({ prisma }) {
	function requireAuth(req, res) {
		if (!req.auth || !req.auth.userId) {
			jsonResponse(res, 401, { error: 'Not authenticated' });
			return null;
		}
		return req.auth;
	}

	function handleRequest(req, res) {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname;
		const method = req.method || 'GET';

		if (!enforceSameOrigin(req, res)) return true;

		// POST /api/workspaces/:id/invites
		const inviteMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/invites$/);
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

					const member = await findLiveWorkspaceMembership(prisma, session.userId, workspaceId, { role: true });
					if (!member || (member.role !== 'OWNER' && member.role !== 'ADMIN')) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const body = await readJsonBody(req);
					if (!body || typeof body !== 'object') {
						jsonResponse(res, 400, { error: 'Request body must be a JSON object' });
						return;
					}

					const email = normalizeEmail(body.email);
					const role = String(body.role || 'MEMBER').toUpperCase();
					if (!email || !isValidEmail(email)) {
						jsonResponse(res, 400, { error: 'Invalid email' });
						return;
					}
					if (!['MEMBER', 'ADMIN'].includes(role)) {
						jsonResponse(res, 400, { error: 'role must be MEMBER or ADMIN' });
						return;
					}

					const workspace = await findLiveWorkspace(prisma, workspaceId, { id: true, name: true });
					if (!workspace) {
						jsonResponse(res, 404, { error: 'Workspace not found' });
						return;
					}

					const token = crypto.randomBytes(24).toString('hex');
					const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

					await prisma.inviteToken.create({
						data: { email, workspaceId, role, token, expiresAt },
					});

					const base = String(process.env.APP_URL || '').trim() || appBaseUrlFromRequest(req);
					const inviteUrl = `${base.replace(/\/$/, '')}/invite/${token}`;

					await sendInviteEmail({ to: email, workspaceName: workspace.name, inviteUrl });

					jsonResponse(res, 201, { ok: true });
				} catch (err) {
					console.error('[invite] create error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// POST /api/invites/accept
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
					const token = body && typeof body === 'object' ? String(body.token || '').trim() : '';
					if (!token) {
						jsonResponse(res, 400, { error: 'Missing token' });
						return;
					}

					const invite = await prisma.inviteToken.findUnique({
						where: { token },
						select: { id: true, email: true, workspaceId: true, role: true, expiresAt: true, used: true, workspace: { select: { name: true } } },
					});
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
							update: { role: invite.role },
							create: { userId: session.userId, workspaceId: invite.workspaceId, role: invite.role },
						});
						await tx.inviteToken.update({ where: { id: invite.id }, data: { used: true } });
					});

					jsonResponse(res, 200, { ok: true, workspaceId: invite.workspaceId, workspaceName: workspace.name, role: invite.role });
				} catch (err) {
					console.error('[invite] accept error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		return false;
	}

	return handleRequest;
}

module.exports = { createInviteRouter };
