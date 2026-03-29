/**
 * pushApi.ts — Typed fetch wrappers for the /api/push/* endpoints.
 *
 * All functions throw on network error; callers should handle rejection.
 */

export type PushPlatform = 'WEB' | 'IOS' | 'ANDROID';

export type PushSubscriptionStatus = {
	subscription: {
		platform: PushPlatform;
		enabled: boolean;
		endpoint: string | null;
		lastSeenAt: string;
		updatedAt: string;
	} | null;
	recentLogs: Array<{
		type: string;
		title: string;
		status: string;
		latencyMs: number | null;
		error: string | null;
		sentAt: string;
	}>;
};

export type VapidPublicKeyResponse = {
	publicKey: string;
	vapidConfigured: boolean;
	fcmConfigured: boolean;
};

async function checkResponse(res: Response): Promise<void> {
	if (!res.ok) {
		let message = `HTTP ${res.status}`;
		try {
			const body = await res.json();
			if (typeof body.error === 'string') message = body.error;
		} catch {
			// ignore
		}
		throw new Error(message);
	}
}

/** Fetch the VAPID public key from the server. No auth required. */
export async function fetchVapidPublicKey(): Promise<VapidPublicKeyResponse> {
	const res = await fetch('/api/push/vapid-public-key', { cache: 'no-store' });
	await checkResponse(res);
	return res.json();
}

/** Fetch subscription status and recent delivery logs for the current user/device. */
export async function fetchPushStatus(deviceId: string): Promise<PushSubscriptionStatus> {
	const res = await fetch(`/api/push/status?deviceId=${encodeURIComponent(deviceId)}`, { cache: 'no-store' });
	await checkResponse(res);
	return res.json();
}

/** Save a VAPID (web/android) push subscription to the server. */
export async function savePushSubscription(
	deviceId: string,
	platform: PushPlatform,
	subscription: PushSubscriptionJSON
): Promise<{ ok: boolean; id: string }> {
	const body: Record<string, string> = { deviceId, platform };
	if (platform === 'IOS') {
		body.fcmToken = (subscription as { fcmToken: string }).fcmToken;
	} else {
		body.endpoint = subscription.endpoint;
		body.p256dh = subscription.p256dh;
		body.auth = subscription.auth;
	}
	const res = await fetch('/api/push/subscribe', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	await checkResponse(res);
	return res.json();
}

/** Remove a push subscription from the server. */
export async function deletePushSubscription(deviceId: string): Promise<void> {
	const res = await fetch('/api/push/subscribe', {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ deviceId }),
	});
	await checkResponse(res);
}

/** Trigger a test push notification for the current user. */
export async function sendTestPushNotification(): Promise<{ sent: number; failed: number }> {
	const res = await fetch('/api/push/test', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: '{}',
	});
	await checkResponse(res);
	return res.json();
}

/**
 * Register or update a note reminder on the server.
 * Pass `reminderAt: null` to clear an existing reminder.
 */
export async function syncNoteReminder(opts: {
	deviceId: string;
	docId: string;
	noteId: string;
	workspaceId: string;
	reminderAt: string | null;
	noteTitle?: string;
}): Promise<void> {
	const res = await fetch('/api/push/reminder', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(opts),
	});
	await checkResponse(res);
}

/**
 * Fetch the count of fired reminders that haven't been acknowledged yet.
 * Used to drive the notification bell badge.
 */
export async function fetchPendingReminderCount(): Promise<number> {
	const res = await fetch('/api/push/reminders/pending', { cache: 'no-store' });
	await checkResponse(res);
	const data: { count: number } = await res.json();
	return typeof data.count === 'number' ? data.count : 0;
}

/**
 * A single fired reminder entry returned by the /api/push/reminders/fired endpoint.
 */
export type FiredReminder = {
	id: string;
	noteId: string;
	workspaceId: string;
	noteTitle: string | null;
	reminderAt: string;
	firedAt: string | null;
};

/**
 * Fetch the list of fired reminders that haven't been acknowledged yet.
 * Used to populate the notifications panel with reminder entries.
 */
export async function fetchFiredReminders(): Promise<{ reminders: FiredReminder[] }> {
	const res = await fetch('/api/push/reminders/fired', { cache: 'no-store' });
	await checkResponse(res);
	return res.json();
}

/**
 * Mark all fired reminders for the current user as acknowledged so the bell
 * badge clears. Call this when the user opens the notifications panel.
 */
export async function acknowledgeReminderNotifications(): Promise<void> {
	const res = await fetch('/api/push/reminders/acknowledge', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: '{}',
	});
	await checkResponse(res);
}

// ── Canonical subscription JSON shape ─────────────────────────────────────────
// Used as a normalised intermediate type between the browser PushSubscription
// object and the server API.

export type PushSubscriptionJSON = {
	endpoint: string;
	p256dh: string;
	auth: string;
	// iOS / Capacitor FCM path
	fcmToken?: string;
};
