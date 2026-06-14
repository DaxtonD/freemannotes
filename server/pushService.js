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
const { isSmtpConfigured, sendNotificationEmail } = require('./mailer');
const { decodeDocumentState, normalizeText } = require('./noteSnapshot');

// ── Environment configuration ─────────────────────────────────────────────────
const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim();
const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || '').trim();

const FCM_PROJECT_ID = String(process.env.FCM_PROJECT_ID || '').trim();
// Service account private key — newlines may be escaped as '\n' in env files.
const FCM_PRIVATE_KEY = String(process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
const FCM_CLIENT_EMAIL = String(process.env.FCM_CLIENT_EMAIL || '').trim();
const APP_URL = String(process.env.APP_URL || '').trim().replace(/\/$/, '');

function normalizeNotificationMode(value, fallback = 'auto') {
	const normalized = String(value || '').trim().toLowerCase();
	if (!normalized) return fallback;
	if (normalized === 'push-only') return 'push';
	if (normalized === 'email-only') return 'email';
	if (normalized === 'disabled') return 'off';
	if (normalized === 'auto' || normalized === 'push' || normalized === 'email' || normalized === 'off') {
		return normalized;
	}
	return fallback;
}

const WEB_NOTIFICATION_MODE = normalizeNotificationMode(process.env.WEB_NOTIFICATION_MODE, 'auto');
const ANDROID_NOTIFICATION_MODE = normalizeNotificationMode(
	process.env.ANDROID_NOTIFICATION_MODE,
	WEB_NOTIFICATION_MODE
);
const IOS_NOTIFICATION_MODE = normalizeNotificationMode(process.env.IOS_NOTIFICATION_MODE, 'auto');
const smtpReady = isSmtpConfigured();
const BRAND_NAME = 'Freeman Notes';
const DEFAULT_NOTIFICATION_ICON = '/notification-icon.png';
const DEFAULT_NOTIFICATION_BADGE = '/notification-badge.png';

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
if (smtpReady) {
	console.info('[push] SMTP configured');
} else {
	console.info('[push] SMTP not configured — set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM to enable email fallback');
}

function getConfiguredNotificationMode(platform) {
	if (platform === 'IOS') return IOS_NOTIFICATION_MODE;
	if (platform === 'ANDROID') return ANDROID_NOTIFICATION_MODE;
	return WEB_NOTIFICATION_MODE;
}

function isPushConfiguredForPlatform(platform) {
	return platform === 'IOS' ? fcmReady : vapidReady;
}

function getNotificationPolicy(platform) {
	const resolvedPlatform = platform === 'IOS' ? 'IOS' : platform === 'ANDROID' ? 'ANDROID' : 'WEB';
	const configuredMode = getConfiguredNotificationMode(resolvedPlatform);
	const pushConfigured = isPushConfiguredForPlatform(resolvedPlatform);
	const emailConfigured = smtpReady;
	let effectiveMode = 'off';

	// The configured mode is an operator preference; the effective mode is what this
	// server can actually deliver after accounting for missing push or SMTP config.
	if (configuredMode === 'push') {
		effectiveMode = pushConfigured ? 'push' : 'off';
	} else if (configuredMode === 'email') {
		effectiveMode = emailConfigured ? 'email' : 'off';
	} else if (configuredMode === 'auto') {
		if (pushConfigured) {
			effectiveMode = 'push';
		} else if (emailConfigured) {
			effectiveMode = 'email';
		}
	}

	return {
		platform: resolvedPlatform,
		configuredMode,
		effectiveMode,
		pushConfigured,
		emailConfigured,
		canRegisterPush: effectiveMode === 'push' && pushConfigured,
	};
}

function getNotificationPolicies() {
	return {
		WEB: getNotificationPolicy('WEB'),
		ANDROID: getNotificationPolicy('ANDROID'),
		IOS: getNotificationPolicy('IOS'),
	};
}

function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function formatReminderDateTime(value) {
	if (!value) return '';
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short',
	}).format(date);
}

const LEGACY_PERSONAL_NAME_RE = /^Personal \([0-9a-f-]{36}\)$/i;
const LEGACY_SHARED_WITH_ME_NAME_RE = /^Shared With Me \([0-9a-f-]{36}\)$/i;

function getWorkspaceDisplayName(name, systemKind) {
	if (systemKind === 'SHARED_WITH_ME') return 'Shared With Me';
	const rawName = String(name || '').trim();
	if (!rawName) return 'Workspace';
	if (LEGACY_PERSONAL_NAME_RE.test(rawName)) return 'Personal';
	if (LEGACY_SHARED_WITH_ME_NAME_RE.test(rawName)) return 'Shared With Me';
	return rawName;
}

function buildReminderTargetUrl(reminder) {
	const workspaceId = encodeURIComponent(String(reminder.workspaceId));
	const noteId = encodeURIComponent(String(reminder.noteId));
	const docId = encodeURIComponent(String(reminder.docId || ''));
	return `/?workspace=${workspaceId}&note=${noteId}&doc=${docId}`;
}

async function isReminderNoteTrashed(prisma, reminder) {
	try {
		const document = await prisma.document.findUnique({
			where: { docId: reminder.docId },
			select: { state: true },
		});
		if (!document?.state) return true;
		return Boolean(decodeDocumentState(document.state).trashed);
	} catch {
		return false;
	}
}

async function loadReminderMetadata(prisma, reminder) {
	const [workspace, user, document] = await Promise.all([
		prisma.workspace.findUnique({
			where: { id: reminder.workspaceId },
			select: { name: true, systemKind: true },
		}).catch(() => null),
		prisma.user.findUnique({
			where: { id: reminder.userId },
			select: { name: true, email: true },
		}).catch(() => null),
		prisma.document.findUnique({
			where: { docId: reminder.docId },
			select: { state: true },
		}).catch(() => null),
	]);
	let notePreviewText = '';
	if (document?.state) {
		try {
			// Reminders can fire when the originating client is offline, so derive a
			// plain-text preview directly from the persisted Yjs document snapshot.
			const decoded = decodeDocumentState(document.state);
			const bodyText = decoded.type === 'checklist'
				? decoded.checklist.map((item) => normalizeText(item.text)).filter(Boolean).join(' • ')
				: normalizeText(decoded.content);
			const normalizedTitle = normalizeText(decoded.title);
			let preview = bodyText || normalizeText(decoded.plainText);
			if (normalizedTitle && preview.toLowerCase().startsWith(normalizedTitle.toLowerCase())) {
				preview = normalizeText(preview.slice(normalizedTitle.length));
			}
			notePreviewText = preview.length > 180 ? `${preview.slice(0, 177).trimEnd()}...` : preview;
		} catch {
			notePreviewText = '';
		}
	}
	return {
		workspaceName: getWorkspaceDisplayName(workspace?.name, workspace?.systemKind),
		userName: user?.name ? String(user.name) : '',
		userEmail: user?.email ? String(user.email) : '',
		notePreviewText,
	};
}

function createReminderNotificationPayload(reminder, metadata) {
	const noteTitle = String(reminder.noteTitle || 'Untitled note').trim() || 'Untitled note';
	const workspaceName = String(metadata.workspaceName || 'Workspace').trim() || 'Workspace';
	const reminderAtLabel = formatReminderDateTime(reminder.reminderAt);
	const noteUrl = buildReminderTargetUrl(reminder);
	const previewText = normalizeText(metadata.notePreviewText || '');
	const title = noteTitle;
	const bodyLines = [
		reminderAtLabel ? `Due ${reminderAtLabel}` : 'Reminder due',
		`Workspace: ${workspaceName}`,
		previewText,
	].filter(Boolean);
	const body = bodyLines.join('\n');
	const richLines = [
		`${BRAND_NAME}`,
		'',
		`Note: ${noteTitle}`,
		reminderAtLabel ? `Scheduled for: ${reminderAtLabel}` : '',
		`Workspace: ${workspaceName}`,
		previewText ? `Preview: ${previewText}` : '',
	].filter(Boolean);
	const iconUrl = toAbsoluteAppUrl(DEFAULT_NOTIFICATION_ICON);
	const badgeUrl = toAbsoluteAppUrl(DEFAULT_NOTIFICATION_BADGE);
	return {
		type: 'reminder',
		title,
		body,
		emailSubject: `${BRAND_NAME} reminder: ${noteTitle}`,
		emailText: [
			...richLines,
			'',
			`Open note: ${toAbsoluteAppUrl(noteUrl)}`,
			'',
			`Signed in as: ${metadata.userEmail || `your ${BRAND_NAME} account`}`,
		].join('\n'),
		emailHtml: buildReminderEmailHtml({
			noteTitle,
			workspaceName,
			reminderAtLabel,
			previewText,
			noteUrl: toAbsoluteAppUrl(noteUrl),
			userName: metadata.userName,
		}),
		data: {
			type: 'reminder',
			noteTitle,
			workspaceName,
			previewText,
			reminderAt: reminder.reminderAt instanceof Date ? reminder.reminderAt.toISOString() : String(reminder.reminderAt || ''),
			url: noteUrl,
			workspaceId: String(reminder.workspaceId),
			noteId: String(reminder.noteId),
			docId: String(reminder.docId || ''),
			tag: `freeman-notes-reminder-${String(reminder.docId)}`,
			icon: iconUrl,
			badge: badgeUrl,
			brand: BRAND_NAME,
			vibrate: '180,60,180',
			requireInteraction: true,
		},
	};
}

function buildReminderEmailHtml({ noteTitle, workspaceName, reminderAtLabel, previewText, noteUrl, userName }) {
	const greeting = userName ? `Hello ${escapeHtml(userName)},` : 'Hello,';
	const whenMarkup = reminderAtLabel
		? `<tr><td style="padding:0 0 12px;color:#5b6677;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Scheduled for</td><td style="padding:0 0 12px;color:#152033;font-size:15px;font-weight:600;text-align:right;">${escapeHtml(reminderAtLabel)}</td></tr>`
		: '';
	const previewMarkup = previewText
		? `<tr><td style="padding:0;color:#5b6677;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;vertical-align:top;">Preview</td><td style="padding:0;color:#152033;font-size:15px;line-height:1.55;font-weight:500;text-align:right;">${escapeHtml(previewText)}</td></tr>`
		: '';
	return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#eef2f7;font-family:Segoe UI,Arial,sans-serif;color:#152033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #d8e0ea;box-shadow:0 18px 50px rgba(17,24,39,0.08);">
      <tr>
        <td style="padding:28px 32px;background:linear-gradient(135deg,#18253f 0%,#284a77 55%,#5e8bc2 100%);color:#ffffff;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;opacity:0.84;">${BRAND_NAME}</div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.15;">Reminder ready</h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.55;max-width:460px;opacity:0.92;">${escapeHtml(noteTitle)} is ready for your attention in ${escapeHtml(workspaceName)}.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px 8px;">
          <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">${greeting}</p>
	          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">${BRAND_NAME} fired a scheduled reminder for one of your notes. The summary below includes the key details and a direct link back into the note.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:18px 20px;">
            <tr><td style="padding:0 0 12px;color:#5b6677;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Note</td><td style="padding:0 0 12px;color:#152033;font-size:15px;font-weight:700;text-align:right;">${escapeHtml(noteTitle)}</td></tr>
            <tr><td style="padding:0 0 12px;color:#5b6677;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Workspace</td><td style="padding:0 0 12px;color:#152033;font-size:15px;font-weight:600;text-align:right;">${escapeHtml(workspaceName)}</td></tr>
            ${whenMarkup}
	            ${previewMarkup}
          </table>
          <div style="padding:28px 0 18px;">
            <a href="${escapeHtml(noteUrl)}" style="display:inline-block;background:#264b79;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 22px;border-radius:999px;">Open in ${BRAND_NAME}</a>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:0 32px 28px;color:#64748b;font-size:13px;line-height:1.6;">
	          This message was generated by the notification settings for your ${BRAND_NAME} deployment. If this server is configured for email-mode reminders on your platform, this email is the primary external reminder channel.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function createTestNotificationPayload() {
	const iconUrl = toAbsoluteAppUrl(DEFAULT_NOTIFICATION_ICON);
	const badgeUrl = toAbsoluteAppUrl(DEFAULT_NOTIFICATION_BADGE);
	return {
		type: 'test',
		title: `${BRAND_NAME} notifications ready`,
		body: 'External notifications are configured and ready for this account.',
		emailSubject: `${BRAND_NAME} test notification`,
		emailText: `${BRAND_NAME} notifications are working. This is a branded test notification from your configured delivery channel.`,
		emailHtml: `<!doctype html><html><body style="margin:0;padding:24px;background:#eef2f7;font-family:Segoe UI,Arial,sans-serif;color:#152033;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:18px;border:1px solid #d8e0ea;overflow:hidden;"><tr><td style="padding:24px 28px;background:linear-gradient(135deg,#18253f 0%,#284a77 55%,#5e8bc2 100%);color:#fff;"><div style="font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;opacity:0.84;">${BRAND_NAME}</div><h1 style="margin:10px 0 0;font-size:26px;">Notifications ready</h1></td></tr><tr><td style="padding:24px 28px;font-size:15px;line-height:1.6;color:#334155;">Your current ${BRAND_NAME} notification channel is working. You can return to Preferences and send another test whenever you change delivery settings.</td></tr></table></body></html>`,
		data: {
			type: 'test',
			url: '/',
			icon: iconUrl,
			badge: badgeUrl,
			brand: BRAND_NAME,
			tag: 'freeman-notes-test',
			vibrate: '120,50,120',
		},
	};
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

function normalizeWebPushAssetPath(value) {
	const asString = String(value || '').trim();
	if (!asString) return undefined;
	if (asString.startsWith('/')) return asString;
	try {
		const parsed = new URL(asString);
		if (parsed.origin === APP_URL || !APP_URL) {
			return `${parsed.pathname}${parsed.search}${parsed.hash}` || undefined;
		}
	} catch {
		return asString;
	}
	return asString;
}

function buildWebPushNotificationBody(payload) {
	const rawData = payload.data && typeof payload.data === 'object' ? payload.data : {};
	const compactData = {};
	for (const [key, value] of Object.entries(rawData)) {
		if (value === undefined || value === null) continue;
		if (key === 'previewText') continue;
		if (key === 'icon' || key === 'badge' || key === 'image') continue;
		compactData[key] = typeof value === 'string' ? value : String(value);
	}
	const icon = normalizeWebPushAssetPath(rawData.icon);
	const badge = normalizeWebPushAssetPath(rawData.badge);
	const image = normalizeWebPushAssetPath(rawData.image);
	if (icon) compactData.icon = icon;
	if (badge) compactData.badge = badge;
	if (image) compactData.image = image;
	return JSON.stringify({
		title: String(payload.title ?? ''),
		body: String(payload.body ?? ''),
		type: typeof payload.type === 'string' ? payload.type : 'generic',
		icon,
		badge,
		image,
		data: compactData,
	});
}

function formatWebPushError(err) {
	const statusCode = Number(err?.statusCode);
	const statusSuffix = Number.isFinite(statusCode) && statusCode > 0 ? ` (HTTP ${statusCode})` : '';
	const bodySuffix = err?.body ? `: ${String(err.body).slice(0, 240)}` : '';
	return `${String(err?.message ?? err)}${statusSuffix}${bodySuffix}`;
}
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
							notification: {
								title: payload.title,
								body: payload.body,
								image: typeof payload.data?.image === 'string' ? payload.data.image : undefined,
							},
							// FCM data values must be strings
							data: Object.fromEntries(
								Object.entries(payload.data ?? {}).map(([k, v]) => [k, String(v)])
							),
							android: {
								notification: {
									channelId: 'freeman-notes-reminders',
									icon: 'ic_launcher',
									color: '#264b79',
									tag: typeof payload.data?.tag === 'string' ? payload.data.tag : undefined,
									image: typeof payload.data?.image === 'string' ? payload.data.image : undefined,
								},
							},
							apns: {
								headers: { 'apns-priority': '10' },
								payload: {
									aps: {
										badge: 1,
										sound: 'default',
										category: typeof payload.type === 'string' ? payload.type : 'generic',
										threadId: typeof payload.data?.tag === 'string' ? payload.data.tag : 'freeman-notes',
										mutableContent: 1,
									},
								},
								fcm_options: {
									image: typeof payload.data?.image === 'string' ? payload.data.image : undefined,
								},
							},
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
				webpush.sendNotification(webPushSub, buildWebPushNotificationBody(payload))
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
			console.info(
				`[push] removed expired subscription (platform=${sub.platform} device=${sub.deviceId}) — re-enable notifications in Preferences`
			);
			return;
		}

		throw err;
	}
}

function logPushSendFailures(results, subscriptions) {
	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		if (result.status === 'rejected') {
			const sub = subscriptions[i];
			const endpointHint = sub.platform === 'IOS'
				? `fcm:${String(sub.fcmToken ?? '').slice(0, 20)}…`
				: String(sub.endpoint ?? '').replace(/^https:\/\/[^/]+/, (host) => host.slice(0, 40));
			console.error(
				`[push] send failed (platform=${sub.platform} device=${sub.deviceId} endpoint=${endpointHint}):`,
				formatWebPushError(result.reason)
			);
		}
	}
}

function buildEmailBody(payload) {
	const segments = [];
	if (payload.body) segments.push(String(payload.body));
	if (payload.data?.noteTitle) segments.push(`Note: ${String(payload.data.noteTitle)}`);
	if (payload.data?.workspaceName) segments.push(`Workspace: ${String(payload.data.workspaceName)}`);
	if (payload.data?.reminderAt) {
		const label = formatReminderDateTime(payload.data.reminderAt);
		if (label) segments.push(`Scheduled for: ${label}`);
	}
	const url = payload && payload.data && typeof payload.data.url === 'string'
		? toAbsoluteAppUrl(payload.data.url)
		: '';
	if (url) segments.push(`Open ${BRAND_NAME}: ${url}`);
	segments.push(`You are receiving this email because this ${BRAND_NAME} deployment is configured to use email delivery for notifications on at least one platform.`);
	return segments.join('\n\n');
}

function toAbsoluteAppUrl(path) {
	const normalizedPath = String(path || '').trim();
	if (!normalizedPath) return APP_URL;
	if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath;
	if (!APP_URL) return normalizedPath;
	return `${APP_URL}${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`;
}

async function sendEmailNotificationToUser(prisma, userId, payload) {
	if (!smtpReady) return false;
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { email: true },
	});
	if (!user?.email) return false;

	await sendNotificationEmail({
		to: user.email,
		subject: String(payload.emailSubject || payload.title || `${BRAND_NAME} notification`),
		text: String(payload.emailText || buildEmailBody(payload)),
		html: payload.emailHtml ? String(payload.emailHtml) : undefined,
	});
	return true;
}

function shouldSendEmailFallback(subscriptions, platformHint) {
	if (!smtpReady) return false;
	if (platformHint) {
		const platformPolicy = getNotificationPolicy(platformHint);
		if (platformPolicy.effectiveMode === 'off') return false;
		if (platformPolicy.effectiveMode === 'email') return true;
		if (platformPolicy.configuredMode === 'auto') {
			const hasEligiblePlatformPush = subscriptions.some(
				(sub) => sub.platform === platformHint && getNotificationPolicy(sub.platform).effectiveMode === 'push'
			);
			if (!hasEligiblePlatformPush) {
				return true;
			}
		}
	}
	if (subscriptions.some((sub) => getNotificationPolicy(sub.platform).effectiveMode === 'email')) {
		return true;
	}
	const hasEligiblePush = subscriptions.some((sub) => getNotificationPolicy(sub.platform).effectiveMode === 'push');
	if (hasEligiblePush) return false;

	const policies = Object.values(getNotificationPolicies());
	return policies.some((policy) => policy.effectiveMode === 'email' || policy.configuredMode === 'auto');
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
	logPushSendFailures(results, subscriptions);

	return {
		sent: results.filter((r) => r.status === 'fulfilled').length,
		failed: results.filter((r) => r.status === 'rejected').length,
	};
}

async function sendExternalNotificationToUser(prisma, userId, payload, options = {}) {
	if (!prisma || !userId) return { sent: 0, failed: 0, emailSent: false, emailError: null };

	let subscriptions;
	try {
		subscriptions = await prisma.pushSubscription.findMany({
			where: { userId, enabled: true },
		});
	} catch {
		subscriptions = [];
	}
	// Reminder sends and manual tests should resolve delivery against the device
	// that triggered them so another registration on the same account does not
	// incorrectly suppress the email fallback path.
	const candidateSubscriptions = options.deviceId
		? subscriptions.filter((sub) => sub.deviceId === options.deviceId)
		: subscriptions;
	const resolvedPlatformHint = options.platformHint || candidateSubscriptions[0]?.platform || null;

	const eligiblePushSubscriptions = candidateSubscriptions.filter(
		(sub) => getNotificationPolicy(sub.platform).effectiveMode === 'push'
	);

	let sent = 0;
	let failed = 0;
	if (eligiblePushSubscriptions.length > 0) {
		const results = await Promise.allSettled(
			eligiblePushSubscriptions.map((sub) => sendOneSubscription(sub, payload, prisma))
		);
		logPushSendFailures(results, eligiblePushSubscriptions);
		sent = results.filter((result) => result.status === 'fulfilled').length;
		failed = results.filter((result) => result.status === 'rejected').length;
	}

	let emailSent = false;
	let emailError = null;
	// Email acts as the delivery fallback only when the targeted device did not
	// receive a push and the platform policy allows email delivery.
	if (sent === 0 && shouldSendEmailFallback(candidateSubscriptions, resolvedPlatformHint)) {
		try {
			emailSent = await sendEmailNotificationToUser(prisma, userId, payload);
		} catch (err) {
			emailError = err instanceof Error ? err.message : String(err);
			console.error('[push] email fallback failed:', emailError);
		}
	}

	return { sent, failed, emailSent, emailError };
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
 * @param {import('ioredis').Redis | null} [redis]
 * @param {((payload: { userId: string; workspaceId: string }) => void) | null} [onReminderFired]
 *   Optional callback invoked after each reminder fires. Intended for in-process
 *   WebSocket broadcast so the bell badge updates even when Redis is not configured.
 * @returns {NodeJS.Timeout} The interval handle; call clearInterval() to stop.
 */
function startReminderScheduler(prisma, redis, onReminderFired) {
	if (!prisma) return null;

	async function checkAndFireReminders() {
		const now = new Date();
		const windowEnd = new Date(now.getTime() + REMINDER_CHECK_INTERVAL_MS);

		let reminders;
		try {
			reminders = await prisma.noteReminder.findMany({
				where: {
					fired: false,
					// Use only an upper bound so reminders that were missed
					// (server restart, row created after the window already ran)
					// are still caught on the next cycle. Past-due reminders
					// fire immediately (delayMs = 0 via the Math.max below).
					reminderAt: { lte: windowEnd },
				},
			});
		} catch {
			return; // DB unavailable — skip this cycle
		}

		for (const reminder of reminders) {
			if (await isReminderNoteTrashed(prisma, reminder)) {
				try {
					await prisma.noteReminder.delete({ where: { id: reminder.id } });
				} catch {
					// Row may have been cleared elsewhere — skip silently.
				}
				continue;
			}

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
			// Capture loop variable for the async closure below.
			const capturedReminder = reminder;
			setTimeout(async () => {
				try {
					if (await isReminderNoteTrashed(prisma, capturedReminder)) {
						return;
					}
					const metadata = await loadReminderMetadata(prisma, capturedReminder);
					await sendExternalNotificationToUser(
						prisma,
						capturedReminder.userId,
						createReminderNotificationPayload(capturedReminder, metadata),
						{ deviceId: capturedReminder.deviceId }
					);
				} catch (err) {
					console.error('[push] reminder send error:', err.message);
				}
				// Notify all open browser tabs for this user via the metadata WS
				// channel. This drives the bell badge on devices that didn't receive
				// (or blocked) the push notification.
				// onReminderFired handles BOTH the in-process WS broadcast and the
				// cross-instance Redis publish (when configured). Centralising here
				// avoids double-delivery when Redis is present.
				if (typeof onReminderFired === 'function') {
					try {
						onReminderFired({ userId: capturedReminder.userId, workspaceId: capturedReminder.workspaceId });
					} catch {
						// Do not crash the scheduler if the broadcast fails.
					}
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
	createTestNotificationPayload,
	getNotificationPolicy,
	getNotificationPolicies,
	sendPushToUser,
	sendExternalNotificationToUser,
	sendPushToUsers,
	startReminderScheduler,
	getVapidPublicKey,
	isVapidConfigured,
	isFcmConfigured,
};
