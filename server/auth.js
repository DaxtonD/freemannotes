'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// auth.js — Cookie-based session helpers + basic CSRF mitigation.
//
// This module centralizes all low-level auth primitives used by the server:
//   - JWT signing/verifying for the session cookie (HttpOnly, SameSite=Lax).
//   - Robust base URL detection behind reverse proxies (x-forwarded-* headers).
//   - A minimal Origin/Referer check for state-changing requests to reduce the
//     risk of CSRF in a cookie-authenticated app.
//
// Design notes:
//   - The session cookie contains only identifiers (userId, role, workspaceId).
//     Sensitive data remains in the database.
//   - `enforceSameOrigin` is intentionally simple: it blocks cross-site POST/PUT/
//     PATCH/DELETE requests unless the host matches the request host.
//   - Production should run over HTTPS. `isSecureRequest()` decides whether to
//     mark cookies as `Secure` based on actual request transport or an explicit
//     AUTH_COOKIE_SECURE override.
//
// IMPORTANT:
//   - AUTH_JWT_SECRET must be set in the environment.
//   - Cookie name and max age are configurable via env.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const jwt = require('jsonwebtoken');

const COOKIE_NAME = String(process.env.AUTH_COOKIE_NAME || 'freemannotes_session').trim();
const JWT_SECRET = String(process.env.AUTH_JWT_SECRET || '').trim();

const SESSION_MAX_AGE_DAYS = Number(process.env.AUTH_SESSION_DAYS || 14);
const SESSION_MAX_AGE_SEC = Number.isFinite(SESSION_MAX_AGE_DAYS) && SESSION_MAX_AGE_DAYS > 0
	? Math.floor(SESSION_MAX_AGE_DAYS * 24 * 60 * 60)
	: 14 * 24 * 60 * 60;

function baseUrlFromRequest(req) {
	// Prefer reverse-proxy headers (x-forwarded-*) when present so that apps
	// running behind a load balancer generate correct absolute URLs.
	const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
	const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
	return `${proto}://${host}`;
}

function isSecureRequest(req) {
	// Explicit override wins when operators need to force a specific behavior.
	const override = String(process.env.AUTH_COOKIE_SECURE || '').trim().toLowerCase();
	if (override === 'true' || override === '1') return true;
	if (override === 'false' || override === '0') return false;

	// When running behind a proxy, x-forwarded-proto is the best signal.
	const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
	if (proto === 'https') return true;

	// Direct TLS termination without proxy headers.
	if (req.socket && req.socket.encrypted) return true;

	return false;
}

/**
 * Minimal cookie parser. Returns an object of cookieName -> value.
 *
 * @param {string} header
 */
function parseCookieHeader(header) {
	// This is a minimal parser: it intentionally ignores cookie attributes and
	// only returns key/value pairs from the Cookie request header.
	const out = {};
	if (!header) return out;
	for (const part of header.split(';')) {
		const idx = part.indexOf('=');
		if (idx < 0) continue;
		const key = part.slice(0, idx).trim();
		const val = part.slice(idx + 1).trim();
		if (!key) continue;
		out[key] = decodeURIComponent(val);
	}
	return out;
}

function appendSetCookie(res, cookie) {
	// Node's `Set-Cookie` header can be a single string or an array.
	// This helper safely appends without clobbering existing cookies.
	const prev = res.getHeader('Set-Cookie');
	if (!prev) {
		res.setHeader('Set-Cookie', cookie);
		return;
	}
	if (Array.isArray(prev)) {
		res.setHeader('Set-Cookie', [...prev, cookie]);
		return;
	}
	res.setHeader('Set-Cookie', [String(prev), cookie]);
}

function makeSessionCookie(sessionJwt, { secure }) {
	// HttpOnly: not readable from JS (mitigates XSS cookie theft).
	// SameSite=Lax: permits top-level navigation while blocking most CSRF.
	// Path=/ : cookie applies to all app routes.
	const attrs = [
		`${COOKIE_NAME}=${encodeURIComponent(sessionJwt)}`,
		`Max-Age=${SESSION_MAX_AGE_SEC}`,
		'Path=/',
		'HttpOnly',
		'SameSite=Lax',
	];
	if (secure) attrs.push('Secure');
	return attrs.join('; ');
}

function makeClearSessionCookie({ secure }) {
	// Clear by setting empty value and Max-Age=0.
	const attrs = [
		`${COOKIE_NAME}=`,
		'Max-Age=0',
		'Path=/',
		'HttpOnly',
		'SameSite=Lax',
	];
	if (secure) attrs.push('Secure');
	return attrs.join('; ');
}

function requireJwtSecret() {
	// Fail fast and loudly: without a secret we cannot validate sessions.
	if (!JWT_SECRET) {
		const err = new Error('AUTH_JWT_SECRET is not set');
		err.code = 'AUTH_MISCONFIGURED';
		throw err;
	}
}

function signSession(payload) {
	// Payload is deliberately small: only identifiers go in the cookie.
	requireJwtSecret();
	return jwt.sign(payload, JWT_SECRET, {
		expiresIn: SESSION_MAX_AGE_SEC,
	});
}

function verifySession(token) {
	// Throws if the token is invalid/expired/misconfigured.
	requireJwtSecret();
	return jwt.verify(token, JWT_SECRET);
}

/**
 * Returns the authenticated session payload, or null.
 *
 * Payload shape:
 *   { userId: string, role: 'USER'|'ADMIN', workspaceId?: string }
 */
function getSessionFromRequest(req) {
	try {
		// NOTE: req.auth may be set earlier in server.js; this helper is a fallback
		// for code paths that need to parse cookies directly.
		const cookies = parseCookieHeader(String(req.headers.cookie || ''));
		const raw = cookies[COOKIE_NAME];
		if (!raw) return null;
		const payload = verifySession(raw);
		if (!payload || typeof payload !== 'object') return null;

		const userId = String(payload.userId || '').trim();
		if (!userId) return null;

		return {
			userId,
			role: String(payload.role || 'USER'),
			workspaceId: payload.workspaceId ? String(payload.workspaceId) : undefined,
		};
	} catch {
		return null;
	}
}

/**
 * Basic CSRF mitigation for cookie-based auth.
 * For state-changing requests, require Origin/Referer host to match request host.
 */
function enforceSameOrigin(req, res) {
	const method = String(req.method || 'GET').toUpperCase();
	if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;

	// For cookie-authenticated mutation requests, require an Origin/Referer header
	// that matches the request host.
	//
	// This is not a replacement for a full CSRF token, but it blocks the most
	// common cross-site POST scenarios and is effective for same-origin SPAs.

	const origin = String(req.headers.origin || '').trim();
	const referer = String(req.headers.referer || '').trim();
	const base = baseUrlFromRequest(req);

	const check = origin || referer;
	if (!check) {
		res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
		res.end(JSON.stringify({ error: 'Missing Origin/Referer' }));
		return false;
	}

	try {
		const u = new URL(check);
		const b = new URL(base);
		if (u.host !== b.host) {
			res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify({ error: 'Cross-site request blocked' }));
			return false;
		}
	} catch {
		res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
		res.end(JSON.stringify({ error: 'Invalid Origin/Referer' }));
		return false;
	}

	return true;
}

module.exports = {
	COOKIE_NAME,
	SESSION_MAX_AGE_SEC,
	isSecureRequest,
	appendSetCookie,
	makeSessionCookie,
	makeClearSessionCookie,
	signSession,
	getSessionFromRequest,
	enforceSameOrigin,
};
