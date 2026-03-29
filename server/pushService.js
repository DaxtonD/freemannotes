'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// pushService.js — Hybrid push notification delivery (VAPID + FCM).
//
// Architecture:
//   Web / Android PWA → VAPID via the Web Push Protocol (RFC 8030).
//   iOS (Capacitor)   → Firebase Cloud Messaging (FCM) via HTTP v1 API.
//
// Environment variables required:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT  (for web/android)
//   FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY   (for iOS)
//
// The module self-initialises on first require(). Missing env vars are logged
// but do not crash the server — the affected push channel is simply disabled.
//
// Reliability:
//   - Transient failures are retried with exponential back-off (up to 3 tries).
//   - 410/404 responses indicate an expired subscription; the row is deleted.
//   - All delivery attempts are recorded in push_notification_log.
//
// Reminder scheduler:
//   startReminderScheduler(prisma) — call once at server startup.
//   Polls the note_reminder table every 60 s and fires pushes for upcoming
//   reminders. Uses a "mark-before-send" pattern to prevent duplicate delivery
//   across multiple server instances.
// ─────────────────────────────────────────────────────────────────────────────

const webpush = require('web-push');

// ── Environment configuration ─────────────────────────────────────────────────
const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim();
const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || '').trim();

const FCM_PROJECT_ID = String(process.env.FCM_PROJECT_ID || '').trim();
// Service account private key — newlines may be escaped as '\n' in env files.
const FCM_PRIVATE_KEY = String(process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
const FCM_CLIENT_EMAIL = String(process.env.FCM_CLIENT_EMAIL || '').trim();

// ── VAPID initialisation ──────────────────────────────────────────────────────
let vapidReady = false;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
	try {
		webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
		vapidReady = true;
		console.info('[push] VAPID configured');
	} catch (err) {
		console.error('[push] VAPID init failed:', err.message);
	}
} else {
	console.info('[push] VAPID not configured — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable web push');
}

// ── FCM access-token cache ────────────────────────────────────────────────────
let fcmTokenCache = { token: null, expiresAt: 0 };
const fcmReady = Boolean(FCM_PROJECT_ID && FCM_PRIVATE_KEY && FCM_CLIENT_EMAIL);
if (fcmReady) {
	console.info('[push] FCM configured');
} else {
	console.info('[push] FCM not configured — set FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY to enable iOS push');
}

/**
 * Obtain an OAuth2 access token for the FCM HTTP v1 API using a
 * service-account JWT (RFC 7523). Tokens are cached for their full
 * lifetime minus a 90-second safety margin to prevent clock-skew issues.
 */
async function getFcmAccessToken() {
	const now = Date.now();
	if (fcmTokenCache.token && now < fcmTokenCache.expiresAt) {
		return fcmTokenCache.token;
	}

	const jwt = require('jsonwebtoken');
	const nowSec = Math.floor(now / 1000);
	const expiresInSec = 3600;

	const assertion = jwt.sign(
		{
			iss: FCM_CLIENT_EMAIL,
			scope: 'https://www.googleapis.com/auth/firebase.messaging',
			aud: 'https://oauth2.googleapis.com/token',
			exp: nowSec + expiresInSec,
			iat: nowSec,
		},
		FCM_PRIVATE_KEY,
		{ algorithm: 'RS256' }
	);

	const params = new URLSearchParams({
		grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
		assertion,
	});

	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: params.toString(),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`FCM token exchange failed (${response.status}): ${body}`);
	}

	const data = await response.json();
	// Cache with a 90-second safety margin
	fcmTokenCache = {
		token: data.access_token,
		expiresAt: now + (data.expires_in ?? expiresInSec) * 1000 - 90_000,
	};
	return data.access_token;
}

// ── Retry helper ──────────────────────────────────────────────────────────────
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

/**
 * Executes `fn`, retrying transient failures with exponential back-off.
 * Permanent failures (HTTP 410, 404) are re-thrown immediately without retry.
 *
 * @param {() => Promise<unknown>} fn
 * @param {number} [retries]
 */
async function withRetry(fn, retries = MAX_RETRIES) {
	let lastError;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			// Expired / invalid subscription — do not retry.
			if (err.statusCode === 410 || err.statusCode === 404) throw err;
			if (attempt < retries) {
				await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * (2 ** attempt)));
			}
		}
	}
	throw lastError;
}

// ── Single-subscription delivery ──────────────────────────────────────────────

/**
 * Send a push notification to one subscription row.
 * Writes a PushNotificationLog entry regardless of outcome.
 * Removes expired/invalid subscription rows on 410/404 errors.
 *
 * @param {object} sub   – PushSubscription row from Prisma
 * @param {object} payload – { type, title, body, data? }
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function sendOneSubscription(sub, payload, prisma) {
	const start = Date.now();
	const logBase = {
		userId: sub.userId,
		type: payload.type ?? 'generic',
		title: String(payload.title ?? ''),
		body: String(payload.body ?? ''),
		data: payload.data ?? null,
	};

	try {
		if (sub.platform === 'IOS') {
			// ── FCM HTTP v1 (iOS via Capacitor + APNs) ───────────────────
			if (!sub.fcmToken || !fcmReady) {
				// No FCM token or not configured — skip silently
				return;
			}
			const accessToken = await getFcmAccessToken();
			await withRetry(async () => {
				const r = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${accessToken}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						message: {
							token: sub.fcmToken,
							notification: { title: payload.title, body: payload.body },
							// FCM data values must be strings
							data: Object.fromEntries(
								Object.entries(payload.data ?? {}).map(([k, v]) => [k, String(v)])
							),
							apns: { payload: { aps: { badge: 1, sound: 'default' } } },
						},
					}),
				});
				if (!r.ok) {
					const body = await r.text();
					const err = new Error(`FCM send failed (${r.status}): ${body}`);
					err.statusCode = r.status;
					throw err;
				}
				return r;
			});
		} else {
			// ── VAPID Web Push (web + android PWA) ───────────────────────
			if (!sub.endpoint || !vapidReady) {
				return;
			}
			const webPushSub = {
				endpoint: sub.endpoint,
				keys: { p256dh: sub.p256dh ?? '', auth: sub.auth ?? '' },
			};
			await withRetry(() =>
				webpush.sendNotification(webPushSub, JSON.stringify({
					title: payload.title,
					body: payload.body,
					type: payload.type,
					data: payload.data ?? {},
				}))
			);
		}

		// Log successful delivery
		await prisma.pushNotificationLog.create({
			data: { ...logBase, status: 'sent', latencyMs: Date.now() - start },
		}).catch(() => {});
	} catch (err) {
		// Log failure
		await prisma.pushNotificationLog.create({
			data: { ...logBase, status: 'failed', error: String(err.message ?? err), latencyMs: Date.now() - start },
		}).catch(() => {});

		// Clean up permanently expired subscriptions
		if (err.statusCode === 410 || err.statusCode === 404) {
			await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
		}

		throw err;
	}
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a push notification to all active subscriptions for a given user.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId
 * @param {{ type: string; title: string; body: string; data?: Record<string, unknown> }} payload
 * @returns {Promise<{ sent: number; failed: number }>}
 */
async function sendPushToUser(prisma, userId, payload) {
	if (!prisma || !userId) return { sent: 0, failed: 0 };

	let subscriptions;
	try {
		subscriptions = await prisma.pushSubscription.findMany({
			where: { userId, enabled: true },
		});
	} catch {
		return { sent: 0, failed: 0 };
	}

	if (!subscriptions.length) return { sent: 0, failed: 0 };

	const results = await Promise.allSettled(
		subscriptions.map((sub) => sendOneSubscription(sub, payload, prisma))
	);

	return {
		sent: results.filter((r) => r.status === 'fulfilled').length,
		failed: results.filter((r) => r.status === 'rejected').length,
	};
}

/**
 * Send a push notification to multiple users in parallel.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string[]} userIds
 * @param {object} payload
 */
async function sendPushToUsers(prisma, userIds, payload) {
	if (!userIds.length) return;
	await Promise.allSettled(userIds.map((id) => sendPushToUser(prisma, id, payload)));
}

// ── Reminder scheduler ────────────────────────────────────────────────────────
const REMINDER_CHECK_INTERVAL_MS = 60_000; // poll every 60 seconds

/**
 * Start the background reminder scheduler.
 *
 * Polls note_reminder every minute for rows that are due within the upcoming
 * check window, marks them as fired (preventing duplicates across instances),
 * then delays the actual push send until the scheduled moment.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {NodeJS.Timeout} The interval handle; call clearInterval() to stop.
 */
function startReminderScheduler(prisma) {
	if (!prisma) return null;

	async function checkAndFireReminders() {
		const now = new Date();
		const windowEnd = new Date(now.getTime() + REMINDER_CHECK_INTERVAL_MS);

		let reminders;
		try {
			reminders = await prisma.noteReminder.findMany({
				where: {
					fired: false,
					reminderAt: { gte: now, lte: windowEnd },
				},
			});
		} catch {
			return; // DB unavailable — skip this cycle
		}

		for (const reminder of reminders) {
			// Mark fired first to prevent duplicate delivery if another instance
			// or the next check cycle finds the same row.
			let marked;
			try {
				marked = await prisma.noteReminder.update({
					where: { id: reminder.id, fired: false }, // optimistic lock
					data: { fired: true, firedAt: new Date() },
				});
			} catch {
				continue; // Another instance already marked it — skip
			}
			if (!marked) continue;

			const delayMs = Math.max(0, reminder.reminderAt.getTime() - Date.now());
			setTimeout(async () => {
				try {
					await sendPushToUser(prisma, reminder.userId, {
						type: 'reminder',
						title: '\u23F0 Reminder',
						body: reminder.noteTitle
							? `Reminder: ${reminder.noteTitle}`
							: 'You have a note reminder.',
						data: {
							type: 'reminder',
							noteId: reminder.noteId,
							docId: reminder.docId,
							workspaceId: reminder.workspaceId,
							url: `/?workspace=${reminder.workspaceId}&note=${reminder.noteId}`,
						},
					});
				} catch (err) {
					console.error('[push] reminder send error:', err.message);
				}
			}, delayMs);
		}
	}

	// First check immediately on startup, then on each interval
	void checkAndFireReminders().catch((err) =>
		console.error('[push] reminder scheduler initial check error:', err.message)
	);

	return setInterval(() => {
		void checkAndFireReminders().catch((err) =>
			console.error('[push] reminder scheduler error:', err.message)
		);
	}, REMINDER_CHECK_INTERVAL_MS);
}

// ── Accessors ─────────────────────────────────────────────────────────────────

/** Returns the VAPID public key string (empty string if unconfigured). */
function getVapidPublicKey() {
	return VAPID_PUBLIC_KEY;
}

/** Returns true if VAPID is configured and ready to send. */
function isVapidConfigured() {
	return vapidReady;
}

/** Returns true if FCM is configured and ready to send. */
function isFcmConfigured() {
	return fcmReady;
}

module.exports = {
	sendPushToUser,
	sendPushToUsers,
	startReminderScheduler,
	getVapidPublicKey,
	isVapidConfigured,
	isFcmConfigured,
};
