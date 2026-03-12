'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// adminRouter.js — Admin-only endpoints (user management + basic stats).
//
// This router powers the "User Management" UI in the client. It is guarded by
// the authenticated user's *database role* (global role), not the role value
// stored in the session cookie.
//
// Endpoints:
//   - GET    /api/admin/stats
//   - GET    /api/admin/users?search=
//   - PATCH  /api/admin/users/:id/role
//   - POST   /api/admin/users/:id/reset-password
//   - DELETE /api/admin/users/:id
//   - POST   /api/admin/users
//
// Key invariants:
//   - "Server admin" safety: the earliest-created user is treated as the
//     server admin and cannot be deleted or demoted via this API. (Resetting
//     their password is still allowed.) This prevents bricking an instance.
//
// Security notes:
//   - Cookie-based auth + `enforceSameOrigin` CSRF mitigation for mutations.
//   - User IDs are validated as UUIDs.
//   - Password changes are validated server-side before the bcrypt hash is updated.
//
// Usage accounting:
//   - Workspace usage is computed from stored Yjs document rows.
//   - The raw query casts workspaceId to uuid to satisfy Postgres typing.
// ─────────────────────────────────────────────────────────────────────────────

const bcrypt = require('bcryptjs');
const { enforceSameOrigin } = require('./auth');
const { validatePassword } = require('./passwordPolicy');

const BCRYPT_ROUNDS = Number(process.env.AUTH_BCRYPT_ROUNDS || 12);

function jsonResponse(res, status, body) {
	if (res.writableEnded) return;
	const json = JSON.stringify(body);
	if (!res.headersSent) {
		res.writeHead(status, {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'no-store',
		});
	}
	try {
		res.end(json);
	} catch {
		// ignore
	}
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

function isUuid(input) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(input || '').trim());
}

function usageForWorkspace(prisma, workspaceId) {
	const registryA = `${workspaceId}:__notes_registry__`;
	const registryB = '__notes_registry__';
	return prisma.$queryRaw`
		SELECT
			COUNT(*)::int as note_count,
			COALESCE(SUM(octet_length(state)), 0)::bigint as bytes
		FROM document
		WHERE workspace_id = ${workspaceId}::uuid
			AND doc_id <> ${registryA}
			AND doc_id <> ${registryB}
	`;
}

function createAdminRouter({ prisma }) {
	async function getServerAdminUserId() {
		const first = await prisma.user.findFirst({
			orderBy: { createdAt: 'asc' },
			select: { id: true },
		});
		return first?.id || null;
	}

	async function requireAdmin(req, res) {
		if (!req.auth || !req.auth.userId) {
			jsonResponse(res, 401, { error: 'Not authenticated' });
			return null;
		}
		try {
			const u = await prisma.user.findUnique({
				where: { id: req.auth.userId },
				select: { role: true, disabled: true },
			});
			if (!u || u.disabled) {
				jsonResponse(res, 401, { error: 'Not authenticated' });
				return null;
			}
			if (String(u.role || '').toUpperCase() !== 'ADMIN') {
				jsonResponse(res, 403, { error: 'Forbidden' });
				return null;
			}
			return req.auth.userId;
		} catch (err) {
			console.error('[admin] requireAdmin error:', err.message);
			jsonResponse(res, 500, { error: 'Internal server error' });
			return null;
		}
	}

	function handleRequest(req, res) {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname;
		const method = String(req.method || 'GET').toUpperCase();

		// CSRF mitigation for cookie-authenticated endpoints.
		if (!enforceSameOrigin(req, res)) return true;

		// GET /api/admin/stats
		if (pathname === '/api/admin/stats' && method === 'GET') {
			(async () => {
				try {
					const adminUserId = await requireAdmin(req, res);
					if (!adminUserId) return;

					const [users, workspaces, docs] = await Promise.all([
						prisma.user.count(),
						prisma.workspace.count(),
						prisma.document.count(),
					]);

					jsonResponse(res, 200, { users, workspaces, documents: docs });
				} catch (err) {
					console.error('[admin] stats error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// GET /api/admin/users
		if (pathname === '/api/admin/users' && method === 'GET') {
			(async () => {
				try {
					const adminUserId = await requireAdmin(req, res);
					if (!adminUserId) return;

					const q = String(url.searchParams.get('search') || '').trim();
					const where = q
						? {
							OR: [
								{ email: { contains: q, mode: 'insensitive' } },
								{ name: { contains: q, mode: 'insensitive' } },
							],
						}
						: {};

					const rows = await prisma.user.findMany({
						where,
						select: {
							id: true,
							email: true,
							name: true,
							role: true,
							disabled: true,
							profileImage: true,
							createdAt: true,
							lastLogin: true,
						},
						orderBy: { createdAt: 'asc' },
						take: 200,
					});

					const users = await Promise.all(
						rows.map(async (u) => {
							const ws = await prisma.workspace.findFirst({
								where: { ownerUserId: u.id },
								select: { id: true },
								orderBy: { createdAt: 'asc' },
							});

							let notes = 0;
							let dbBytes = 0;
							if (ws) {
								const result = await usageForWorkspace(prisma, ws.id);
								const first = Array.isArray(result) ? result[0] : result;
								notes = Number(first?.note_count || 0);
								dbBytes = Number(first?.bytes || 0);
							}

							const filesBytes = 0;
							const totalBytes = dbBytes + filesBytes;

							return {
								id: u.id,
								email: u.email,
								name: u.name,
								role: String(u.role || 'USER').toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER',
								profileImage: u.profileImage || null,
								disabled: Boolean(u.disabled),
								createdAt: u.createdAt.toISOString(),
								lastLogin: u.lastLogin ? u.lastLogin.toISOString() : null,
								usage: {
									notes,
									images: 0,
									totalBytes,
									filesBytes,
									dbBytes,
								},
							};
						})
					);

					jsonResponse(res, 200, { users });
				} catch (err) {
					console.error('[admin] users list error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// PATCH /api/admin/users/:id/role
		const roleMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
		if (roleMatch && method === 'PATCH') {
			const userId = decodeURIComponent(roleMatch[1]);
			(async () => {
				try {
					const adminUserId = await requireAdmin(req, res);
					if (!adminUserId) return;
					if (!isUuid(userId)) {
						jsonResponse(res, 400, { error: 'Invalid user id' });
						return;
					}

					const serverAdminUserId = await getServerAdminUserId();
					if (serverAdminUserId && userId === serverAdminUserId) {
						jsonResponse(res, 400, { error: 'Cannot change server admin role' });
						return;
					}

					const body = await readJsonBody(req);
					const nextRole = body && typeof body === 'object' ? String(body.role || '').toUpperCase() : '';
					if (!['USER', 'ADMIN'].includes(nextRole)) {
						jsonResponse(res, 400, { error: 'role must be USER or ADMIN' });
						return;
					}

					await prisma.user.update({
						where: { id: userId },
						data: { role: nextRole },
					});

					jsonResponse(res, 200, { ok: true });
				} catch (err) {
					console.error('[admin] set role error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// POST /api/admin/users/:id/reset-password
		const resetMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
		if (resetMatch && method === 'POST') {
			const userId = decodeURIComponent(resetMatch[1]);
			(async () => {
				try {
					const adminUserId = await requireAdmin(req, res);
					if (!adminUserId) return;
					if (!isUuid(userId)) {
						jsonResponse(res, 400, { error: 'Invalid user id' });
						return;
					}

					const body = await readJsonBody(req);
					const password = body && typeof body === 'object' ? String(body.password || '') : '';
					const passwordError = validatePassword(password);
					if (passwordError) {
						jsonResponse(res, 400, { error: passwordError });
						return;
					}
					const passwordHash = await bcrypt.hash(password, Number.isFinite(BCRYPT_ROUNDS) ? BCRYPT_ROUNDS : 12);

					await prisma.user.update({
						where: { id: userId },
						data: { passwordHash },
					});

					jsonResponse(res, 200, { ok: true });
				} catch (err) {
					console.error('[admin] reset password error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// DELETE /api/admin/users/:id
		const deleteMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
		if (deleteMatch && method === 'DELETE') {
			const userId = decodeURIComponent(deleteMatch[1]);
			(async () => {
				try {
					const adminUserId = await requireAdmin(req, res);
					if (!adminUserId) return;
					if (!isUuid(userId)) {
						jsonResponse(res, 400, { error: 'Invalid user id' });
						return;
					}

					const serverAdminUserId = await getServerAdminUserId();
					if (serverAdminUserId && userId === serverAdminUserId) {
						jsonResponse(res, 400, { error: 'Cannot delete server admin' });
						return;
					}

					await prisma.$transaction(async (tx) => {
						const owned = await tx.workspace.findMany({
							where: { ownerUserId: userId },
							select: { id: true },
						});
						for (const ws of owned) {
							await tx.workspace.delete({ where: { id: ws.id } });
						}
						await tx.user.delete({ where: { id: userId } });
					});

					jsonResponse(res, 200, { ok: true });
				} catch (err) {
					console.error('[admin] delete user error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// POST /api/admin/users
		if (pathname === '/api/admin/users' && method === 'POST') {
			(async () => {
				try {
					const adminUserId = await requireAdmin(req, res);
					if (!adminUserId) return;

					const body = await readJsonBody(req);
					if (!body || typeof body !== 'object') {
						jsonResponse(res, 400, { error: 'Request body must be a JSON object' });
						return;
					}

					const email = normalizeEmail(body.email);
					const name = String(body.name || '').trim();
					const password = String(body.password || '');
					const role = String(body.role || 'USER').toUpperCase();
					const finalRole = role === 'ADMIN' ? 'ADMIN' : 'USER';

					if (!email || !isValidEmail(email)) {
						jsonResponse(res, 400, { error: 'Invalid email' });
						return;
					}
					if (!name) {
						jsonResponse(res, 400, { error: 'Name is required' });
						return;
					}
					if (name.length > 120) {
						jsonResponse(res, 400, { error: 'Name is too long' });
						return;
					}
					const passwordError = validatePassword(password);
					if (passwordError) {
						jsonResponse(res, 400, { error: passwordError });
						return;
					}

					const existing = await prisma.user.findUnique({ where: { email } });
					if (existing) {
						jsonResponse(res, 409, { error: 'Email already registered' });
						return;
					}

					const passwordHash = await bcrypt.hash(password, Number.isFinite(BCRYPT_ROUNDS) ? BCRYPT_ROUNDS : 12);
					const created = await prisma.$transaction(async (tx) => {
						const user = await tx.user.create({
							data: {
								email,
								name,
								passwordHash,
								role: finalRole,
							},
							select: { id: true, email: true, name: true, role: true },
						});

						// Workspace names are globally unique in the DB schema.
						// Using the full user UUID guarantees uniqueness while staying human-readable.
						const workspaceName = `Personal (${user.id})`;
						const workspace = await tx.workspace.create({
							data: { name: workspaceName, ownerUserId: user.id },
							select: { id: true, name: true },
						});
						await tx.workspaceMember.create({
							data: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' },
						});
						await tx.userPreference.create({ data: { userId: user.id, deleteAfterDays: 30 } });
						return { user, workspace };
					});

					jsonResponse(res, 201, { user: created.user, workspace: created.workspace });
				} catch (err) {
					console.error('[admin] create user error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		return false;
	}

	return handleRequest;
}

module.exports = { createAdminRouter };
