'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// workspaceRouter.js — Workspace discovery and activation.
//
// Endpoints:
//   - GET  /api/workspaces
//       Lists workspaces the authenticated user belongs to and returns the
//       currently active workspaceId from the session (if any).
//   - POST /api/workspaces
//       Creates a new workspace owned by the authenticated user.
//   - POST /api/workspaces/:id/activate
//       Switches the active workspace by issuing a fresh session cookie with
//       the selected workspaceId embedded.
//
// Security model:
//   - All endpoints require authentication (cookie session).
//   - Mutations use `enforceSameOrigin` to reduce CSRF risk.
//   - Activation verifies membership in the target workspace.
//
// Notes:
//   - Workspace activation is implemented by re-signing the session JWT.
//     The user's global role is preserved.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const {
	appendSetCookie,
	makeSessionCookie,
	signSession,
	isSecureRequest,
	enforceSameOrigin,
} = require('./auth');

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

function createWorkspaceRouter({ prisma }) {
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

		// GET /api/workspaces
		if (pathname === '/api/workspaces' && method === 'GET') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;

					const memberships = await prisma.workspaceMember.findMany({
						where: { userId: session.userId },
						select: { role: true, workspace: { select: { id: true, name: true, createdAt: true } } },
						orderBy: { workspaceId: 'asc' },
					});

					jsonResponse(res, 200, {
						activeWorkspaceId: session.workspaceId || null,
						workspaces: memberships.map((m) => ({
							id: m.workspace.id,
							name: m.workspace.name,
							role: m.role,
							createdAt: m.workspace.createdAt.toISOString(),
						})),
					});
				} catch (err) {
					console.error('[workspace] list error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// POST /api/workspaces
		if (pathname === '/api/workspaces' && method === 'POST') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;

					const body = await readJsonBody(req);
					if (!body || typeof body !== 'object') {
						jsonResponse(res, 400, { error: 'Request body must be a JSON object' });
						return;
					}

					const name = String(body.name || '').trim();
					const wsName = name.length > 0 ? name : `ws-${crypto.randomBytes(6).toString('hex')}`;

					const created = await prisma.$transaction(async (tx) => {
						const workspace = await tx.workspace.create({
							data: { name: wsName, ownerUserId: session.userId },
							select: { id: true, name: true, createdAt: true },
						});
						await tx.workspaceMember.create({
							data: { userId: session.userId, workspaceId: workspace.id, role: 'OWNER' },
						});
						return workspace;
					});

					jsonResponse(res, 201, { workspace: { ...created, createdAt: created.createdAt.toISOString() } });
				} catch (err) {
					if (String(err.code || '') === 'P2002') {
						jsonResponse(res, 409, { error: 'Workspace name already exists' });
						return;
					}
					console.error('[workspace] create error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// POST /api/workspaces/:id/activate
		const activateMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/activate$/);
		if (activateMatch && method === 'POST') {
			const workspaceId = decodeURIComponent(activateMatch[1]);
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;

					const member = await prisma.workspaceMember.findUnique({
						where: { userId_workspaceId: { userId: session.userId, workspaceId } },
						select: { role: true },
					});
					if (!member) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const secure = isSecureRequest(req);
					const newJwt = signSession({ userId: session.userId, role: session.role, workspaceId });
					appendSetCookie(res, makeSessionCookie(newJwt, { secure }));

					jsonResponse(res, 200, { activeWorkspaceId: workspaceId });
				} catch (err) {
					console.error('[workspace] activate error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		return false;
	}

	return handleRequest;
}

module.exports = { createWorkspaceRouter };
