'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// pushRouter.js — REST API for push notification subscriptions.
//
// Endpoints:
//   GET  /api/push/vapid-public-key           – Returns the VAPID public key.
//   GET  /api/push/status                     – Subscription status + recent logs.
//   POST /api/push/subscribe                  – Upsert a push subscription.
//   DELETE /api/push/subscribe                – Remove a push subscription.
//   POST /api/push/test                       – Send a test notification.
//   GET  /api/push/reminders/fired           – List of unacknowledged fired reminders.
//   GET  /api/push/reminders/pending          – Count of unacknowledged fired reminders.
//   POST /api/push/reminders/acknowledge      – Mark all fired reminders as seen.
//   PUT  /api/push/reminder                   – Register or clear a note reminder.
//
// All mutating endpoints enforce same-origin CSRF check and require auth.
// Subscription endpoint URLs are validated to prevent SSRF.
// ─────────────────────────────────────────────────────────────────────────────

const { enforceSameOrigin } = require('./auth');
const { createRateLimiter, getClientIp } = require('./rateLimit');
const { sendPushToUser, getVapidPublicKey, isVapidConfigured, isFcmConfigured } = require('./pushService');

const subscribeLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });
const testLimiter = createRateLimiter({ windowMs: 60_000, max: 5 });

// ── Helpers ───────────────────────────────────────────────────────────────────

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
				resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
			} catch {
				resolve(null);
			}
		});
		req.on('error', () => resolve(null));
	});
}

/** Extract authenticated userId from req.auth, or return null. */
function getAuthUserId(req) {
	return req.auth && typeof req.auth.userId === 'string' && req.auth.userId
		? req.auth.userId
		: null;
}

/** Normalise and cap device ID length to prevent oversized input. */
function normalizeDeviceId(id) {
	return String(id ?? '').trim().slice(0, 120);
}

/** Map raw platform string to the PushPlatform enum value. */
function normalizePlatform(p) {
	if (p === 'IOS') return 'IOS';
	if (p === 'ANDROID') return 'ANDROID';
	return 'WEB';
}

/**
 * Validate that an endpoint URL is an HTTPS (or localhost HTTP) URL to
 * prevent SSRF attacks where an attacker could make the server call an
 * arbitrary internal service.
 */
function isValidEndpoint(endpoint) {
	let url;
	try {
		url = new URL(endpoint);
	} catch {
		return false;
	}
	// Web Push endpoints must be HTTPS (or http for localhost in dev)
	if (url.protocol === 'https:') return true;
	if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
		return true;
	}
	return false;
}

// ── Router factory ────────────────────────────────────────────────────────────

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient }} deps
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => boolean | Promise<boolean>}
 */
function createPushRouter({ prisma }) {
	/**
	 * Main handler — returns true if the request was handled, false to pass through.
	 * Synchronous outer shell (matches all other routers); async work runs inside an IIFE.
	 */
	return function pushRouter(req, res) {
		const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
		if (!url.pathname.startsWith('/api/push')) return false;

		;(async () => {

		const method = String(req.method ?? 'GET').toUpperCase();

		// ── GET /api/push/vapid-public-key — no auth required ─────────────
		if (method === 'GET' && url.pathname === '/api/push/vapid-public-key') {
			jsonResponse(res, 200, {
				publicKey: getVapidPublicKey(),
				vapidConfigured: isVapidConfigured(),
				fcmConfigured: isFcmConfigured(),
			});
			return true;
		}

		// All remaining endpoints require an authenticated session.
		const userId = getAuthUserId(req);
		if (!userId || !prisma) {
			if (url.pathname.startsWith('/api/push/')) {
				jsonResponse(res, 401, { error: 'Authentication required' });
				return true;
			}
			return false;
		}

		// ── GET /api/push/status — subscription status + recent delivery logs ─
		if (method === 'GET' && url.pathname === '/api/push/status') {
			try {
				const deviceId = normalizeDeviceId(url.searchParams.get('deviceId') ?? '');
				const [sub, logs] = await Promise.all([
					deviceId
						? prisma.pushSubscription.findUnique({
								where: { userId_deviceId: { userId, deviceId } },
								select: {
									platform: true,
									enabled: true,
									endpoint: true,
									lastSeenAt: true,
									updatedAt: true,
								},
							})
						: null,
					prisma.pushNotificationLog.findMany({
						where: { userId },
						orderBy: { sentAt: 'desc' },
						take: 10,
						select: { type: true, title: true, status: true, latencyMs: true, error: true, sentAt: true },
					}),
				]);
				jsonResponse(res, 200, { subscription: sub ?? null, recentLogs: logs });
			} catch (err) {
				console.error('[push] status error:', err.message);
				jsonResponse(res, 500, { error: 'Internal server error' });
			}
			return true;
		}

		// ── POST /api/push/subscribe — create or update subscription ──────────
		if (method === 'POST' && url.pathname === '/api/push/subscribe') {
			if (!enforceSameOrigin(req, res)) return true;
			const ip = getClientIp(req);
			if (!subscribeLimiter.allow(`push:subscribe:${ip}`)) {
				jsonResponse(res, 429, { error: 'Too many requests' });
				return true;
			}
			try {
				const body = await readJsonBody(req);
				if (!body) { jsonResponse(res, 400, { error: 'Invalid JSON body' }); return true; }

				const deviceId = normalizeDeviceId(body.deviceId ?? '');
				if (!deviceId) { jsonResponse(res, 400, { error: 'deviceId is required' }); return true; }

				const platform = normalizePlatform(body.platform);
				let data;

				if (platform === 'IOS') {
					if (!body.fcmToken || typeof body.fcmToken !== 'string') {
						jsonResponse(res, 400, { error: 'fcmToken is required for iOS' });
						return true;
					}
					data = {
						platform,
						fcmToken: String(body.fcmToken).slice(0, 500),
						endpoint: null,
						p256dh: null,
						auth: null,
						enabled: true,
						lastSeenAt: new Date(),
					};
				} else {
					if (!body.endpoint || typeof body.endpoint !== 'string') {
						jsonResponse(res, 400, { error: 'endpoint is required' });
						return true;
					}
					// Validate endpoint URL to prevent SSRF
					if (!isValidEndpoint(body.endpoint)) {
						jsonResponse(res, 400, { error: 'Invalid endpoint URL' });
						return true;
					}
					data = {
						platform,
						endpoint: body.endpoint,
						p256dh: String(body.p256dh ?? '').slice(0, 200),
						auth: String(body.auth ?? '').slice(0, 50),
						fcmToken: null,
						enabled: true,
						lastSeenAt: new Date(),
					};
				}

				const sub = await prisma.pushSubscription.upsert({
					where: { userId_deviceId: { userId, deviceId } },
					create: { userId, deviceId, ...data },
					update: data,
					select: { id: true, platform: true },
				});

				jsonResponse(res, 200, { ok: true, id: sub.id, platform: sub.platform });
			} catch (err) {
				console.error('[push] subscribe error:', err.message);
				jsonResponse(res, 500, { error: 'Internal server error' });
			}
			return true;
		}

		// ── DELETE /api/push/subscribe — remove subscription ──────────────────
		if (method === 'DELETE' && url.pathname === '/api/push/subscribe') {
			if (!enforceSameOrigin(req, res)) return true;
			try {
				const body = await readJsonBody(req);
				const deviceId = normalizeDeviceId((body && body.deviceId) ?? '');
				if (deviceId) {
					await prisma.pushSubscription.deleteMany({ where: { userId, deviceId } });
				} else {
					// No deviceId — delete all subscriptions for user
					await prisma.pushSubscription.deleteMany({ where: { userId } });
				}
				jsonResponse(res, 200, { ok: true });
			} catch (err) {
				console.error('[push] unsubscribe error:', err.message);
				jsonResponse(res, 500, { error: 'Internal server error' });
			}
			return true;
		}

		// ── POST /api/push/test — send test notification ──────────────────────
		if (method === 'POST' && url.pathname === '/api/push/test') {
			if (!enforceSameOrigin(req, res)) return true;
			const ip = getClientIp(req);
			if (!testLimiter.allow(`push:test:${userId}:${ip}`)) {
				jsonResponse(res, 429, { error: 'Too many requests' });
				return true;
			}
			try {
				const result = await sendPushToUser(prisma, userId, {
					type: 'test',
					title: '\uD83D\uDD14 Test Notification',
					body: 'Push notifications are working! You\'re all set.',
					data: { type: 'test', url: '/' },
				});
				jsonResponse(res, 200, { ok: true, sent: result.sent, failed: result.failed });
			} catch (err) {
				console.error('[push] test error:', err.message);
				jsonResponse(res, 500, { error: 'Internal server error' });
			}
			return true;
		}

		// ── GET /api/push/reminders/fired — list for notification panel ───────
		// Returns fired reminders that haven't been acknowledged yet, so the
		// notifications panel can display note title, due time, and a deep link.
		if (method === 'GET' && url.pathname === '/api/push/reminders/fired') {
			try {
				const reminders = await prisma.noteReminder.findMany({
					where: {
						userId,
						fired: true,
						notificationAcknowledgedAt: null,
					},
					select: {
						id: true,
						noteId: true,
						workspaceId: true,
						noteTitle: true,
						reminderAt: true,
						firedAt: true,
					},
					orderBy: { firedAt: 'desc' },
					take: 20,
				});
				jsonResponse(res, 200, { reminders });
			} catch (err) {
				console.error('[push] reminders/fired error:', err.message);
				jsonResponse(res, 500, { error: 'Internal server error' });
			}
			return true;
		}

		// ── GET /api/push/reminders/pending — bell badge count ───────────────
		// Returns the number of fired reminders the user hasn't acknowledged yet.
		// Used by the frontend notification bell to display a badge.
		if (method === 'GET' && url.pathname === '/api/push/reminders/pending') {
			try {
				const count = await prisma.noteReminder.count({
					where: {
						userId,
						fired: true,
						notificationAcknowledgedAt: null,
					},
				});
				jsonResponse(res, 200, { count });
			} catch (err) {
				console.error('[push] reminders/pending error:', err.message);
				jsonResponse(res, 500, { error: 'Internal server error' });
			}
			return true;
		}

		// ── POST /api/push/reminders/acknowledge — clear bell badge ──────────
		// Marks all fired, unacknowledged reminders for this user as seen.
		// The frontend calls this when the user opens the notifications panel.
		if (method === 'POST' && url.pathname === '/api/push/reminders/acknowledge') {
			if (!enforceSameOrigin(req, res)) return true;
			try {
				await prisma.noteReminder.updateMany({
					where: {
						userId,
						fired: true,
						notificationAcknowledgedAt: null,
					},
					data: { notificationAcknowledgedAt: new Date() },
				});
				jsonResponse(res, 200, { ok: true });
			} catch (err) {
				console.error('[push] reminders/acknowledge error:', err.message);
				jsonResponse(res, 500, { error: 'Internal server error' });
			}
			return true;
		}

		// ── PUT /api/push/reminder — register or clear a note reminder ─────────
		if (method === 'PUT' && url.pathname === '/api/push/reminder') {
			if (!enforceSameOrigin(req, res)) return true;
			try {
				const body = await readJsonBody(req);
				if (!body || !body.docId) {
					jsonResponse(res, 400, { error: 'docId is required' });
					return true;
				}

				const docId = String(body.docId).trim().slice(0, 100);
				const reminderAt = body.reminderAt ? new Date(body.reminderAt) : null;

				if (reminderAt && isNaN(reminderAt.getTime())) {
					jsonResponse(res, 400, { error: 'Invalid reminderAt date' });
					return true;
				}

				if (!reminderAt) {
					// Clear reminder — delete the row
					await prisma.noteReminder.deleteMany({ where: { userId, docId } });
					jsonResponse(res, 200, { ok: true, cleared: true });
					return true;
				}

				const deviceId = normalizeDeviceId(body.deviceId ?? '');
				const noteId = String(body.noteId ?? '').trim().slice(0, 100);
				const workspaceId = String(body.workspaceId ?? '').trim().slice(0, 50);
				const noteTitle = body.noteTitle ? String(body.noteTitle).slice(0, 200) : null;

				await prisma.noteReminder.upsert({
					where: { userId_docId: { userId, docId } },
					create: { userId, deviceId, docId, noteId, workspaceId, reminderAt, noteTitle, fired: false },
					// Reset fired, firedAt, and notificationAcknowledgedAt so the new
					// reminder cycle starts fresh. Without clearing notificationAcknowledgedAt,
					// a reminder that was previously fired and acknowledged would never show
					// a bell badge again when re-scheduled on the same note.
					update: { deviceId, noteId, workspaceId, reminderAt, noteTitle, fired: false, firedAt: null, notificationAcknowledgedAt: null },
				});

				jsonResponse(res, 200, { ok: true });
			} catch (err) {
				console.error('[push] reminder error:', err.message);
				jsonResponse(res, 500, { error: 'Internal server error' });
			}
			return true;
		}

		// Unrecognised /api/push/* sub-path — return 404.
		jsonResponse(res, 404, { error: 'Not found' });
		})().catch((err) => {
			console.error('[push] unhandled error:', err.message);
			if (!res.headersSent) jsonResponse(res, 500, { error: 'Internal server error' });
		});

		return true;
	};
}

module.exports = { createPushRouter };
