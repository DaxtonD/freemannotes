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
//   - PATCH /api/workspaces/:id
//       Renames a workspace (OWNER/ADMIN only).
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
	const LEGACY_DEVICE_ID = 'legacy';

	function normalizeDeviceId(raw) {
		if (typeof raw !== 'string') return LEGACY_DEVICE_ID;
		const id = raw.trim();
		if (!id) return LEGACY_DEVICE_ID;
		if (id.length > 120) return LEGACY_DEVICE_ID;
		return id;
	}

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

					const deviceId = normalizeDeviceId(url.searchParams.get('deviceId'));
					let activeWorkspaceId = session.workspaceId || null;
					try {
						const pref = await prisma.userDevicePreference.findUnique({
							where: { userId_deviceId: { userId: session.userId, deviceId } },
							select: { activeWorkspaceId: true },
						});
						if (pref && pref.activeWorkspaceId) {
							activeWorkspaceId = String(pref.activeWorkspaceId);
						}
					} catch {
						// Ignore preference lookup failure; fallback to session cookie.
					}

					const memberships = await prisma.workspaceMember.findMany({
						where: { userId: session.userId },
						select: { role: true, workspace: { select: { id: true, name: true, createdAt: true } } },
						orderBy: { workspaceId: 'asc' },
					});

					jsonResponse(res, 200, {
						activeWorkspaceId,
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
					const wsName = name.length > 0 ? name : `Workspace ${crypto.randomBytes(6).toString('hex')}`;

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

		// PATCH /api/workspaces/:id
		const renameMatch = pathname.match(/^\/api\/workspaces\/([^/]+)$/);
		if (renameMatch && method === 'PATCH') {
			const workspaceId = decodeURIComponent(renameMatch[1]);
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;

					const member = await prisma.workspaceMember.findUnique({
						where: { userId_workspaceId: { userId: session.userId, workspaceId } },
						select: { role: true },
					});
					if (!member || (member.role !== 'OWNER' && member.role !== 'ADMIN')) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const body = await readJsonBody(req);
					if (!body || typeof body !== 'object') {
						jsonResponse(res, 400, { error: 'Request body must be a JSON object' });
						return;
					}
					const name = String(body.name || '').trim();
					if (!name || name.length < 1 || name.length > 120) {
						jsonResponse(res, 400, { error: 'Invalid workspace name' });
						return;
					}

					const updated = await prisma.workspace.update({
						where: { id: workspaceId },
						data: { name },
						select: { id: true, name: true, createdAt: true },
					});

					jsonResponse(res, 200, { workspace: { ...updated, createdAt: updated.createdAt.toISOString() } });
				} catch (err) {
					if (String(err.code || '') === 'P2002') {
						jsonResponse(res, 409, { error: 'Workspace name already exists' });
						return;
					}
					console.error('[workspace] rename error:', err.message);
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

					const body = await readJsonBody(req);
					const deviceId = normalizeDeviceId(body && typeof body === 'object' ? body.deviceId : null);
					try {
						await prisma.userDevicePreference.upsert({
							where: { userId_deviceId: { userId: session.userId, deviceId } },
							update: { activeWorkspaceId: workspaceId },
							create: {
								userId: session.userId,
								deviceId,
								activeWorkspaceId: workspaceId,
								checklistShowCompleted: false,
								noteCardCompletedExpandedByNoteId: {},
							},
						});
					} catch (err) {
						console.warn('[workspace] activate: could not persist device pref:', err.message);
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
