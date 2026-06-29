'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// supporterRouter – Supporter status and contributors list endpoints.
//
//   GET  /api/supporters              Public list of opted-in supporters
//   POST /api/user/supporter-visibility  Toggle own showPublic flag
//   POST /api/admin/grant-supporter   Admin: grant supporter status by email
//   POST /api/admin/revoke-supporter  Admin: revoke supporter status by email
// ─────────────────────────────────────────────────────────────────────────────

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
			try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
			catch { resolve(null); }
		});
		req.on('error', () => resolve(null));
	});
}

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
function createSupporterRouter({ prisma }) {
	function handleRequest(req, res) {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname;
		const method = req.method || 'GET';

		function requireAuth() {
			if (!req.auth || !req.auth.userId) {
				jsonResponse(res, 401, { error: 'Not authenticated' });
				return null;
			}
			return String(req.auth.userId);
		}

		function requireAdmin() {
			const userId = requireAuth();
			if (!userId) return null;
			if (String(req.auth.role || '').toUpperCase() !== 'ADMIN') {
				jsonResponse(res, 403, { error: 'Admin only' });
				return null;
			}
			return userId;
		}

		// ── GET /api/supporters ───────────────────────────────────────────────
		// Public: returns all users who are supporters and have opted in to
		// being listed. No auth required so the contributors page works offline
		// for guests. Name + avatar only — no email or internal IDs exposed.
		if (pathname === '/api/supporters' && method === 'GET') {
			(async () => {
				try {
					const supporters = await prisma.user.findMany({
						where: { isSupporter: true, supporterShowPublic: true, disabled: false },
						select: { id: true, name: true, profileImage: true, supporterSince: true },
						orderBy: { supporterSince: 'asc' },
					});
					jsonResponse(res, 200, {
						supporters: supporters.map((u) => ({
							id: u.id,
							name: u.name,
							avatarUrl: u.profileImage || null,
							supporterSince: u.supporterSince ? u.supporterSince.toISOString() : null,
						})),
					});
				} catch (err) {
					console.error('[supporter] GET /api/supporters error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── POST /api/user/supporter-visibility ──────────────────────────────
		// Authenticated: toggle whether the current user appears on the public
		// contributors list. Only works if the user is already a supporter.
		// Body: { showPublic: boolean }
		if (pathname === '/api/user/supporter-visibility' && method === 'POST') {
			(async () => {
				try {
					const userId = requireAuth();
					if (!userId) return;
					const body = await readJsonBody(req);
					if (typeof body?.showPublic !== 'boolean') {
						jsonResponse(res, 400, { error: 'showPublic must be a boolean' });
						return;
					}
					const user = await prisma.user.findUnique({
						where: { id: userId },
						select: { isSupporter: true },
					});
					if (!user?.isSupporter) {
						jsonResponse(res, 403, { error: 'Not a supporter' });
						return;
					}
					await prisma.user.update({
						where: { id: userId },
						data: { supporterShowPublic: body.showPublic },
					});
					jsonResponse(res, 200, { ok: true, showPublic: body.showPublic });
				} catch (err) {
					console.error('[supporter] POST /api/user/supporter-visibility error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── POST /api/admin/grant-supporter ──────────────────────────────────
		// Admin only: grant supporter status to a user by email.
		// Body: { email: string }
		if (pathname === '/api/admin/grant-supporter' && method === 'POST') {
			(async () => {
				try {
					if (!requireAdmin()) return;
					const body = await readJsonBody(req);
					const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
					if (!email) {
						jsonResponse(res, 400, { error: 'email is required' });
						return;
					}
					const user = await prisma.user.findUnique({
						where: { email },
						select: { id: true, name: true, isSupporter: true },
					});
					if (!user) {
						jsonResponse(res, 404, { error: 'User not found' });
						return;
					}
					const updated = await prisma.user.update({
						where: { id: user.id },
						data: {
							isSupporter: true,
							supporterSince: user.isSupporter ? undefined : new Date(),
						},
						select: { id: true, name: true, isSupporter: true, supporterSince: true },
					});
					jsonResponse(res, 200, {
						ok: true,
						user: { id: updated.id, name: updated.name, isSupporter: updated.isSupporter, supporterSince: updated.supporterSince?.toISOString() ?? null },
					});
				} catch (err) {
					console.error('[supporter] POST /api/admin/grant-supporter error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── POST /api/admin/revoke-supporter ─────────────────────────────────
		// Admin only: revoke supporter status from a user by email.
		// Body: { email: string }
		if (pathname === '/api/admin/revoke-supporter' && method === 'POST') {
			(async () => {
				try {
					if (!requireAdmin()) return;
					const body = await readJsonBody(req);
					const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
					if (!email) {
						jsonResponse(res, 400, { error: 'email is required' });
						return;
					}
					const user = await prisma.user.findUnique({
						where: { email },
						select: { id: true, name: true },
					});
					if (!user) {
						jsonResponse(res, 404, { error: 'User not found' });
						return;
					}
					await prisma.user.update({
						where: { id: user.id },
						data: { isSupporter: false, supporterShowPublic: false, supporterSince: null },
					});
					jsonResponse(res, 200, { ok: true });
				} catch (err) {
					console.error('[supporter] POST /api/admin/revoke-supporter error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		return false;
	}

	return handleRequest;
}

module.exports = { createSupporterRouter };
