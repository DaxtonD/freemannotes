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
const {
	findLiveWorkspaceMembership,
	resolveLiveWorkspaceId,
} = require('./workspaceAccess');
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

function createWorkspaceRouter({ prisma, onWorkspaceMetadataChanged = null }) {
	const LEGACY_DEVICE_ID = 'legacy';
	const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
					let preferredWorkspaceId = session.workspaceId || null;
					try {
						const pref = await prisma.userDevicePreference.findUnique({
							where: { userId_deviceId: { userId: session.userId, deviceId } },
							select: { activeWorkspaceId: true },
						});
						if (pref && pref.activeWorkspaceId) {
							preferredWorkspaceId = String(pref.activeWorkspaceId);
						}
					} catch {
						// Ignore preference lookup failure; fallback to session cookie.
					}
					const activeWorkspaceId = await resolveLiveWorkspaceId(prisma, session.userId, preferredWorkspaceId);
					try {
						await prisma.userDevicePreference.upsert({
							where: { userId_deviceId: { userId: session.userId, deviceId } },
							update: { activeWorkspaceId },
							create: {
								userId: session.userId,
								deviceId,
								activeWorkspaceId,
								checklistShowCompleted: false,
								quickDeleteChecklist: false,
								noteCardCompletedExpandedByNoteId: {},
							},
						});
					} catch {
						// Ignore device preference repair failure.
					}

					if (String(session.workspaceId || '') !== String(activeWorkspaceId || '')) {
						const secure = isSecureRequest(req);
						const newJwt = signSession({
							userId: session.userId,
							role: session.role,
							workspaceId: activeWorkspaceId || undefined,
						});
						appendSetCookie(res, makeSessionCookie(newJwt, { secure }));
					}

					const memberships = await prisma.workspaceMember.findMany({
						where: { userId: session.userId, workspace: { is: { deletedAt: null } } },
						select: { role: true, workspace: { select: { id: true, name: true, ownerUserId: true, systemKind: true, createdAt: true, updatedAt: true } } },
						orderBy: { workspaceId: 'asc' },
					});

					jsonResponse(res, 200, {
						activeWorkspaceId,
						workspaces: memberships.map((m) => ({
							id: m.workspace.id,
							name: m.workspace.name,
							role: normalizeWorkspaceRole(m.role, 'VIEWER'),
							ownerUserId: m.workspace.ownerUserId,
							systemKind: m.workspace.systemKind,
							createdAt: m.workspace.createdAt.toISOString(),
							updatedAt: m.workspace.updatedAt.toISOString(),
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
					const requestedId = typeof body.id === 'string' ? body.id.trim() : '';
					const wsName = name.length > 0 ? name : `Workspace ${crypto.randomBytes(6).toString('hex')}`;
					if (requestedId && !UUID_RE.test(requestedId)) {
						jsonResponse(res, 400, { error: 'Invalid workspace id' });
						return;
					}

					const created = await prisma.$transaction(async (tx) => {
						if (requestedId) {
							const existing = await tx.workspace.findUnique({
								where: { id: requestedId },
								select: { id: true, name: true, ownerUserId: true, systemKind: true, createdAt: true, updatedAt: true, deletedAt: true },
							});
							if (existing && !existing.deletedAt && existing.ownerUserId === session.userId) {
								await tx.workspaceMember.upsert({
									where: { userId_workspaceId: { userId: session.userId, workspaceId: existing.id } },
									update: { role: 'OWNER' },
									create: { userId: session.userId, workspaceId: existing.id, role: 'OWNER' },
								});
								return { workspace: existing, createdNew: false };
							}
						}

						const workspace = await tx.workspace.create({
							data: { id: requestedId || undefined, name: wsName, ownerUserId: session.userId },
							select: { id: true, name: true, ownerUserId: true, systemKind: true, createdAt: true, updatedAt: true },
						});
						await tx.workspaceMember.create({
							data: { userId: session.userId, workspaceId: workspace.id, role: 'OWNER' },
						});
						return { workspace, createdNew: true };
					});

					jsonResponse(res, 201, {
						workspace: {
							...created.workspace,
							createdAt: created.workspace.createdAt.toISOString(),
							updatedAt: created.workspace.updatedAt.toISOString(),
						},
					});

					if (created.createdNew && typeof onWorkspaceMetadataChanged === 'function') {
						try {
							await onWorkspaceMetadataChanged({
								reason: 'workspace-created',
								workspaceId: created.workspace.id,
								userIds: [session.userId],
							});
						} catch (publishErr) {
							console.warn('[workspace] create: metadata event publish failed:', publishErr.message);
						}
					}
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

					const member = await findLiveWorkspaceMembership(prisma, session.userId, workspaceId, { role: true });
					if (!member || !canManageWorkspace(member.role)) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const workspace = await prisma.workspace.findUnique({
						where: { id: workspaceId },
						select: { systemKind: true },
					});
					if (workspace && workspace.systemKind) {
						jsonResponse(res, 400, { error: 'System workspaces cannot be renamed' });
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
						select: { id: true, name: true, ownerUserId: true, systemKind: true, createdAt: true, updatedAt: true },
					});
					const memberRows = await prisma.workspaceMember.findMany({
						where: { workspaceId },
						select: { userId: true },
					});

					jsonResponse(res, 200, {
						workspace: {
							...updated,
							createdAt: updated.createdAt.toISOString(),
							updatedAt: updated.updatedAt.toISOString(),
						},
					});

					if (typeof onWorkspaceMetadataChanged === 'function') {
						try {
							await onWorkspaceMetadataChanged({
								reason: 'workspace-renamed',
								workspaceId,
								userIds: [...new Set(memberRows.map((row) => String(row.userId || '')).filter(Boolean))],
							});
						} catch (publishErr) {
							console.warn('[workspace] rename: metadata event publish failed:', publishErr.message);
						}
					}
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

		// DELETE /api/workspaces/:id
		const deleteMatch = pathname.match(/^\/api\/workspaces\/([^/]+)$/);
		if (deleteMatch && method === 'DELETE') {
			const workspaceId = decodeURIComponent(deleteMatch[1]);
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;

					const body = await readJsonBody(req);
					const deviceId = normalizeDeviceId(body && typeof body === 'object' ? body.deviceId : null);

					const member = await findLiveWorkspaceMembership(prisma, session.userId, workspaceId, { role: true });
					if (!member || member.role !== 'OWNER') {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const workspace = await prisma.workspace.findUnique({
						where: { id: workspaceId },
						select: { systemKind: true },
					});
					if (workspace && workspace.systemKind) {
						jsonResponse(res, 400, { error: 'System workspaces cannot be deleted' });
						return;
					}

					// Workspace deletion transaction:
					// 1. Tombstone the workspace so it disappears from "live" lookups.
					// 2. Clear any device preferences still pointing at it.
					// 3. Resolve the caller's next active workspace and persist it atomically.
					// Keeping these steps together avoids cookies/device prefs briefly pointing
					// at a workspace that the live-query helpers now reject.
					const result = await prisma.$transaction(async (tx) => {
						const workspace = await tx.workspace.findFirst({
							where: { id: workspaceId, deletedAt: null },
							select: { id: true, ownerUserId: true, systemKind: true },
						});
						if (!workspace) {
							return { missing: true, forbidden: false };
						}
						if (workspace.systemKind) {
							return { missing: false, forbidden: false, systemWorkspace: true };
						}
						if (workspace.ownerUserId !== session.userId) {
							return { missing: false, forbidden: true };
						}

						const deletedAt = new Date();
						const memberRows = await tx.workspaceMember.findMany({
							where: { workspaceId },
							select: { userId: true },
						});

						await tx.workspace.update({
							where: { id: workspaceId },
							data: {
								deletedAt,
								name: `__deleted__:${workspaceId}:${deletedAt.getTime()}`,
							},
						});

						await tx.userDevicePreference.updateMany({
							where: { activeWorkspaceId: workspaceId },
							data: { activeWorkspaceId: null },
						});

						const nextActiveWorkspaceId = await resolveLiveWorkspaceId(
							tx,
							session.userId,
							session.workspaceId && session.workspaceId !== workspaceId ? session.workspaceId : null,
						);

						await tx.userDevicePreference.upsert({
							where: { userId_deviceId: { userId: session.userId, deviceId } },
							update: { activeWorkspaceId: nextActiveWorkspaceId },
							create: {
								userId: session.userId,
								deviceId,
								activeWorkspaceId: nextActiveWorkspaceId,
								checklistShowCompleted: false,
								quickDeleteChecklist: false,
								noteCardCompletedExpandedByNoteId: {},
							},
						});

						return {
							missing: false,
							forbidden: false,
							nextActiveWorkspaceId,
							userIds: [...new Set(memberRows.map((row) => String(row.userId || '')).filter(Boolean))],
						};
					});

					if (result.missing) {
						jsonResponse(res, 404, { error: 'Workspace not found' });
						return;
					}
					if (result.forbidden) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}
					if (result.systemWorkspace) {
						jsonResponse(res, 400, { error: 'System workspaces cannot be deleted' });
						return;
					}

					const secure = isSecureRequest(req);
					const newJwt = signSession({
						userId: session.userId,
						role: session.role,
						workspaceId: result.nextActiveWorkspaceId || undefined,
					});
					appendSetCookie(res, makeSessionCookie(newJwt, { secure }));

					jsonResponse(res, 200, {
						ok: true,
						deletedWorkspaceId: workspaceId,
						activeWorkspaceId: result.nextActiveWorkspaceId || null,
					});

					if (typeof onWorkspaceMetadataChanged === 'function') {
						try {
							// Publish after the response path is committed so other tabs/devices can
							// refresh their cached workspace lists and notice remote deletion.
							await onWorkspaceMetadataChanged({
								reason: 'workspace-deleted',
								workspaceId,
								userIds: result.userIds,
							});
						} catch (publishErr) {
							console.warn('[workspace] delete: metadata event publish failed:', publishErr.message);
						}
					}
				} catch (err) {
					console.error('[workspace] delete error:', err.message);
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

					const member = await findLiveWorkspaceMembership(prisma, session.userId, workspaceId, { role: true });
					if (!member) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const body = await readJsonBody(req);
					const deviceId = normalizeDeviceId(body && typeof body === 'object' ? body.deviceId : null);
					try {
						await prisma.userDevicePreference.upsert({
							where: { userId_deviceId: { userId: session.userId, deviceId } },
							update: { activeWorkspaceId: workspaceId, activeSharedFolder: null },
							create: {
								userId: session.userId,
								deviceId,
								activeWorkspaceId: workspaceId,
								activeSharedFolder: null,
								checklistShowCompleted: false,
								quickDeleteChecklist: false,
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
