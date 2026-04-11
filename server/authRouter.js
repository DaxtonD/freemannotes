'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// authRouter.js — Authentication REST API (register/login/logout/me).
//
// Endpoints:
//   - POST /api/auth/register  (creates user + personal workspace; sets session)
//   - POST /api/auth/login     (verifies password; sets session)
//   - POST /api/auth/logout    (clears session cookie)
//   - GET  /api/auth/me        (returns current user + workspaceId; may refresh cookie)
//
// Key behaviors and invariants:
//   - First-ever registered user is bootstrapped as global ADMIN. This prevents
//     a fresh install from getting locked out of admin functionality.
//   - Single-user installs auto-promote the only user to ADMIN on login/me.
//     This provides resilience if the DB role is accidentally reset.
//   - All endpoints are cookie-authenticated; CSRF mitigation is enforced via
//     `enforceSameOrigin` for state-changing requests.
//   - Authentication attempts are rate-limited in-process to reduce brute force.
//
// Security notes:
//   - Passwords are stored as bcrypt hashes (bcryptjs).
//   - Session is a signed JWT stored in an HttpOnly cookie.
//   - The session token includes only identifiers (userId/role/workspaceId).
//
// Operational notes:
//   - This router expects Prisma models: user, workspace, workspaceMember,
//     userPreference.
// ─────────────────────────────────────────────────────────────────────────────

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { createRateLimiter, getClientIp } = require('./rateLimit');
const { sendNotificationEmail } = require('./mailer');
const {
	appendSetCookie,
	baseUrlFromRequest,
	makeClearSessionCookie,
	makeSessionCookie,
	signSession,
	getSessionFromRequest,
	isSecureRequest,
	enforceSameOrigin,
} = require('./auth');
const {
	findFirstLiveWorkspaceMembership,
	resolveLiveWorkspaceId,
} = require('./workspaceAccess');
const { ensureSharedWithMeWorkspace } = require('./systemWorkspaces');
const { validatePassword } = require('./passwordPolicy');

const BCRYPT_ROUNDS = Number(process.env.AUTH_BCRYPT_ROUNDS || 12);
const ALLOW_REGISTER = String(process.env.AUTH_ALLOW_REGISTER || 'true').trim().toLowerCase() !== 'false';
const PASSWORD_RESET_WINDOW_MS = 60 * 60 * 1000;

const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
const registerLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const forgotPasswordLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const resetPasswordLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

function jsonResponse(res, status, body) {
	if (res.writableEnded) return;
	const json = JSON.stringify(body);
	// If another handler already started the response (bug/edge-case),
	// avoid throwing ERR_HTTP_HEADERS_SENT.
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

function sha256(value) {
	return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function buildPasswordResetUrl(req, token) {
	const appUrl = String(process.env.APP_URL || '').trim().replace(/\/$/, '');
	const base = appUrl || baseUrlFromRequest(req);
	return `${base}/?resetPassword=${encodeURIComponent(token)}`;
}

function buildPasswordResetEmailHtml({ name, resetUrl }) {
	const safeName = String(name || '').trim();
	const greeting = safeName ? `Hello ${safeName},` : 'Hello,';
	return `<!doctype html>
<html>
	<body style="margin:0;padding:24px;background:#eef2f7;font-family:Segoe UI,Arial,sans-serif;color:#152033;">
		<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #d8e0ea;box-shadow:0 18px 50px rgba(17,24,39,0.08);">
			<tr>
				<td style="padding:28px 32px;background:linear-gradient(135deg,#18253f 0%,#284a77 55%,#5e8bc2 100%);color:#ffffff;">
					<div style="font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;opacity:0.84;">FreemanNotes</div>
					<h1 style="margin:12px 0 0;font-size:28px;line-height:1.15;">Reset your password</h1>
					<p style="margin:12px 0 0;font-size:15px;line-height:1.55;max-width:460px;opacity:0.92;">Use the secure link below to choose a new password for your FreemanNotes account.</p>
				</td>
			</tr>
			<tr>
				<td style="padding:28px 32px 8px;">
					<p style="margin:0 0 18px;font-size:15px;line-height:1.6;">${greeting}</p>
					<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">We received a password reset request for your FreemanNotes account. This link expires in 1 hour.</p>
					<div style="padding:0 0 24px;">
						<a href="${resetUrl}" style="display:inline-block;background:#264b79;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 22px;border-radius:999px;">Reset password</a>
					</div>
					<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#64748b;word-break:break-all;">If the button does not open, copy this link into your browser:<br>${resetUrl}</p>
				</td>
			</tr>
			<tr>
				<td style="padding:0 32px 28px;color:#64748b;font-size:13px;line-height:1.6;">
					If you did not request this reset, you can ignore this email. Your current password will remain unchanged.
				</td>
			</tr>
		</table>
	</body>
</html>`;
}

function createApiAuthRouter({ prisma }) {
	const LEGACY_DEVICE_ID = 'legacy';
	function normalizeDeviceId(raw) {
		if (typeof raw !== 'string') return LEGACY_DEVICE_ID;
		const id = raw.trim();
		if (!id) return LEGACY_DEVICE_ID;
		if (id.length > 120) return LEGACY_DEVICE_ID;
		return id;
	}
	/**
	 * @param {import('http').IncomingMessage} req
	 * @param {import('http').ServerResponse} res
	 */
	function handleRequest(req, res) {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname;
		const method = req.method || 'GET';

		// CSRF mitigation for cookie-based auth.
		if (!enforceSameOrigin(req, res)) return true;

		// ── POST /api/auth/register ──────────────────────────────────────
		if (pathname === '/api/auth/register' && method === 'POST') {
			if (!ALLOW_REGISTER) {
				jsonResponse(res, 403, { error: 'Registration is disabled' });
				return true;
			}

			const ip = getClientIp(req);
			if (!registerLimiter.allow(`${ip}:register`)) {
				jsonResponse(res, 429, { error: 'Too many requests' });
				return true;
			}

			(async () => {
				try {
					const body = await readJsonBody(req);
					if (!body || typeof body !== 'object') {
						jsonResponse(res, 400, { error: 'Request body must be a JSON object' });
						return;
					}

					const email = normalizeEmail(body.email);
					const name = String(body.name || '').trim();
					const password = String(body.password || '');

					if (!email || !isValidEmail(email)) {
						jsonResponse(res, 400, { error: 'Invalid email' });
						return;
					}
					if (!name || name.length < 1 || name.length > 120) {
						jsonResponse(res, 400, { error: 'Invalid name' });
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

					const result = await prisma.$transaction(async (tx) => {
						const existingUsers = await tx.user.count();
						const role = existingUsers === 0 ? 'ADMIN' : 'USER';
						const user = await tx.user.create({
							data: { email, name, passwordHash, role },
							select: { id: true, email: true, name: true, role: true, disabled: true, createdAt: true },
						});

						// Workspace names are globally unique in the DB schema.
						// Using the full user UUID guarantees uniqueness while staying human-readable.
						// IMPORTANT: Always set systemKind = 'PERSONAL' at creation so new users are
						// identified canonically without relying on the legacy UUID-name pattern.
						// The name pattern is kept as a display fallback only (see workspaceDisplay.ts).
						const workspaceName = `Personal (${user.id})`;
						const workspace = await tx.workspace.create({
							data: { name: workspaceName, ownerUserId: user.id, systemKind: 'PERSONAL' },
							select: { id: true, name: true },
						});

						await tx.workspaceMember.create({
							data: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' },
						});

						await ensureSharedWithMeWorkspace(tx, user.id);

						await tx.userPreference.create({
							data: { userId: user.id, deleteAfterDays: 30 },
						});

						return { user, workspace };
					});

					const secure = isSecureRequest(req);
					const sessionJwt = signSession({
						userId: result.user.id,
						role: result.user.role,
						workspaceId: result.workspace.id,
					});
					appendSetCookie(res, makeSessionCookie(sessionJwt, { secure }));

					jsonResponse(res, 201, {
						user: {
							id: result.user.id,
							email: result.user.email,
							name: result.user.name,
							role: result.user.role,
						},
						workspace: result.workspace,
					});
				} catch (err) {
					console.error('[auth] register error:', err);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── POST /api/auth/login ─────────────────────────────────────────
		if (pathname === '/api/auth/login' && method === 'POST') {
			const ip = getClientIp(req);
			if (!loginLimiter.allow(`${ip}:login`)) {
				jsonResponse(res, 429, { error: 'Too many requests' });
				return true;
			}

			(async () => {
				try {
					const body = await readJsonBody(req);
					if (!body || typeof body !== 'object') {
						jsonResponse(res, 400, { error: 'Request body must be a JSON object' });
						return;
					}

					const email = normalizeEmail(body.email);
					const password = String(body.password || '');
					if (!email || !isValidEmail(email) || !password) {
						jsonResponse(res, 400, { error: 'Invalid credentials' });
						return;
					}

					let user = await prisma.user.findUnique({
						where: { email },
						select: {
							id: true,
							email: true,
							name: true,
							role: true,
							disabled: true,
							passwordHash: true,
						},
					});

					if (!user || user.disabled) {
						jsonResponse(res, 401, { error: 'Invalid credentials' });
						return;
					}

					const ok = await bcrypt.compare(password, user.passwordHash);
					if (!ok) {
						jsonResponse(res, 401, { error: 'Invalid credentials' });
						return;
					}

					// Bootstrap: if this is a single-user install, ensure the only user is ADMIN.
					// This avoids locking the first user out of admin features.
					if (String(user.role || '').toUpperCase() !== 'ADMIN') {
						const totalUsers = await prisma.user.count();
						if (totalUsers === 1) {
							user = await prisma.user.update({
								where: { id: user.id },
								data: { role: 'ADMIN' },
								select: {
									id: true,
									email: true,
									name: true,
									role: true,
									disabled: true,
									passwordHash: true,
								},
							});
						}
					}

					await ensureSharedWithMeWorkspace(prisma, user.id);

					const membership = await findFirstLiveWorkspaceMembership(prisma, user.id, { workspaceId: true });

					if (!membership) {
						jsonResponse(res, 403, { error: 'User has no workspace' });
						return;
					}

					await prisma.user.update({
						where: { id: user.id },
						data: { lastLogin: new Date() },
					});

					const secure = isSecureRequest(req);
					const sessionJwt = signSession({
						userId: user.id,
						role: user.role,
						workspaceId: membership.workspaceId,
					});
					appendSetCookie(res, makeSessionCookie(sessionJwt, { secure }));

					jsonResponse(res, 200, {
						user: { id: user.id, email: user.email, name: user.name, role: user.role },
						workspaceId: membership.workspaceId,
					});
				} catch (err) {
					console.error('[auth] login error:', err);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── POST /api/auth/forgot-password ───────────────────────────────
		if (pathname === '/api/auth/forgot-password' && method === 'POST') {
			const ip = getClientIp(req);
			if (!forgotPasswordLimiter.allow(`${ip}:forgot-password`)) {
				jsonResponse(res, 429, { error: 'Too many requests' });
				return true;
			}

			(async () => {
				try {
					const body = await readJsonBody(req);
					const email = normalizeEmail(body?.email);
					if (!email || !isValidEmail(email)) {
						jsonResponse(res, 200, { ok: true, message: 'If the email exists, a reset link has been sent.' });
						return;
					}

					const user = await prisma.user.findUnique({
						where: { email },
						select: { id: true, name: true, email: true, disabled: true },
					});

					if (user && !user.disabled) {
						const rawToken = crypto.randomBytes(32).toString('base64url');
						const tokenHash = sha256(rawToken);
						const expiresAt = new Date(Date.now() + PASSWORD_RESET_WINDOW_MS);

						await prisma.$transaction(async (tx) => {
							await tx.passwordResetToken.deleteMany({
								where: {
									userId: user.id,
									OR: [{ usedAt: null }, { expiresAt: { lt: new Date() } }],
								},
							});
							await tx.passwordResetToken.create({
								data: { userId: user.id, tokenHash, expiresAt },
							});
						});

						const resetUrl = buildPasswordResetUrl(req, rawToken);
						await sendNotificationEmail({
							to: user.email,
							subject: 'FreemanNotes password reset',
							text: [
								'FreemanNotes password reset',
								'',
								'We received a request to reset your password.',
								'This link expires in 1 hour.',
								'',
								resetUrl,
								'',
								'If you did not request this change, you can ignore this email.',
							].join('\n'),
							html: buildPasswordResetEmailHtml({ name: user.name, resetUrl }),
						});
					}

					jsonResponse(res, 200, { ok: true, message: 'If the email exists, a reset link has been sent.' });
				} catch (err) {
					console.error('[auth] forgot-password error:', err);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── POST /api/auth/reset-password ────────────────────────────────
		if (pathname === '/api/auth/reset-password' && method === 'POST') {
			const ip = getClientIp(req);
			if (!resetPasswordLimiter.allow(`${ip}:reset-password`)) {
				jsonResponse(res, 429, { error: 'Too many requests' });
				return true;
			}

			(async () => {
				try {
					const body = await readJsonBody(req);
					const token = String(body?.token || '').trim();
					const password = String(body?.password || '');
					if (!token) {
						jsonResponse(res, 400, { error: 'Reset token is required' });
						return;
					}
					const passwordError = validatePassword(password);
					if (passwordError) {
						jsonResponse(res, 400, { error: passwordError });
						return;
					}

					const tokenHash = sha256(token);
					const resetToken = await prisma.passwordResetToken.findUnique({
						where: { tokenHash },
						select: { id: true, userId: true, expiresAt: true, usedAt: true },
					});
					if (!resetToken || resetToken.usedAt || resetToken.expiresAt.getTime() < Date.now()) {
						jsonResponse(res, 400, { error: 'This password reset link is invalid or has expired' });
						return;
					}

					const passwordHash = await bcrypt.hash(password, Number.isFinite(BCRYPT_ROUNDS) ? BCRYPT_ROUNDS : 12);
					await prisma.$transaction(async (tx) => {
						await tx.user.update({
							where: { id: resetToken.userId },
							data: { passwordHash },
						});
						await tx.passwordResetToken.update({
							where: { tokenHash },
							data: { usedAt: new Date() },
						});
						await tx.passwordResetToken.deleteMany({
							where: {
								userId: resetToken.userId,
								id: { not: resetToken.id },
							},
						});
					});

					jsonResponse(res, 200, { ok: true, message: 'Password updated successfully' });
				} catch (err) {
					console.error('[auth] reset-password error:', err);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── POST /api/auth/logout ────────────────────────────────────────
		if (pathname === '/api/auth/logout' && method === 'POST') {
			const secure = isSecureRequest(req);
			appendSetCookie(res, makeClearSessionCookie({ secure }));
			res.writeHead(204, { 'Cache-Control': 'no-store' });
			res.end();
			return true;
		}

		// ── GET /api/auth/me ─────────────────────────────────────────────
		if (pathname === '/api/auth/me' && method === 'GET') {
			(async () => {
				try {
					const session = req.auth || getSessionFromRequest(req);
					if (!session) {
						jsonResponse(res, 200, { authenticated: false, user: null, workspaceId: null });
						return;
					}

					const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
					const deviceId = normalizeDeviceId(url.searchParams.get('deviceId'));

					let user = await prisma.user.findUnique({
						where: { id: session.userId },
						select: { id: true, email: true, name: true, role: true, disabled: true, profileImage: true, lastLogin: true, createdAt: true },
					});
					if (!user || user.disabled) {
						jsonResponse(res, 200, { authenticated: false, user: null, workspaceId: null });
						return;
					}

					// Bootstrap: if this is a single-user install, ensure the only user is ADMIN.
					if (String(user.role || '').toUpperCase() !== 'ADMIN') {
						const totalUsers = await prisma.user.count();
						if (totalUsers === 1) {
							user = await prisma.user.update({
								where: { id: user.id },
								data: { role: 'ADMIN' },
								select: { id: true, email: true, name: true, role: true, disabled: true, profileImage: true, lastLogin: true, createdAt: true },
							});
						}
					}

					await ensureSharedWithMeWorkspace(prisma, user.id);

					// If the DB role differs from the role in the session cookie, refresh the cookie.
					// This keeps long-lived sessions consistent after admin promotion/demotion.
					let preferredWorkspaceId = session.workspaceId || null;
					if (deviceId) {
						// Ensure a device preference row exists; if missing, seed it with current session workspace.
						try {
							await prisma.userDevicePreference.upsert({
								where: { userId_deviceId: { userId: user.id, deviceId } },
								update: {},
								create: {
									userId: user.id,
									deviceId,
									activeWorkspaceId: preferredWorkspaceId,
									noteCardFontScale: 1,
									noteEditorFontScale: 1,
									checklistShowCompleted: false,
									quickDeleteChecklist: false,
									noteCardCompletedExpandedByNoteId: {},
								},
							});
							const pref = await prisma.userDevicePreference.findUnique({
								where: { userId_deviceId: { userId: user.id, deviceId } },
								select: { activeWorkspaceId: true },
							});
							if (pref && pref.activeWorkspaceId) {
								preferredWorkspaceId = String(pref.activeWorkspaceId);
							}
						} catch (err) {
							console.warn('[auth] me: device preference lookup failed:', err.message);
						}
					}

					const effectiveWorkspaceId = await resolveLiveWorkspaceId(prisma, user.id, preferredWorkspaceId);
					if (deviceId) {
						try {
							await prisma.userDevicePreference.upsert({
								where: { userId_deviceId: { userId: user.id, deviceId } },
								update: { activeWorkspaceId: effectiveWorkspaceId },
								create: {
									userId: user.id,
									deviceId,
									activeWorkspaceId: effectiveWorkspaceId,
									noteCardFontScale: 1,
									noteEditorFontScale: 1,
									checklistShowCompleted: false,
									quickDeleteChecklist: false,
									noteCardCompletedExpandedByNoteId: {},
								},
							});
						} catch (err) {
							console.warn('[auth] me: device preference repair failed:', err.message);
						}
					}

					const roleChanged =
						String(session.role || '').toUpperCase() !== String(user.role || '').toUpperCase();
					const workspaceChanged = String(session.workspaceId || '') !== String(effectiveWorkspaceId || '');
					if (roleChanged || workspaceChanged) {
						const secure = isSecureRequest(req);
						const sessionJwt = signSession({
							userId: user.id,
							role: user.role,
							workspaceId: effectiveWorkspaceId || undefined,
						});
						appendSetCookie(res, makeSessionCookie(sessionJwt, { secure }));
					}

					jsonResponse(res, 200, {
						authenticated: true,
						user: {
							id: user.id,
							email: user.email,
							name: user.name,
							role: user.role,
							profileImage: user.profileImage,
							lastLogin: user.lastLogin ? user.lastLogin.toISOString() : null,
							createdAt: user.createdAt.toISOString(),
						},
						workspaceId: effectiveWorkspaceId || null,
					});
				} catch (err) {
					console.error('[auth] me error:', err);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		return false;
	}

	return handleRequest;
}

module.exports = { createApiAuthRouter }; 
