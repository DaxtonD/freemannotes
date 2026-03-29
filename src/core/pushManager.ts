/**
 * pushManager.ts — Client-side push notification subscription lifecycle.
 *
 * Responsibilities:
 *   - Detect platform (web/ios/android).
 *   - Request Notification permission on user action only (never auto-prompt).
 *   - Subscribe via the browser PushManager API (VAPID).
 *   - Sync the subscription to the server.
 *   - Handle unsubscription / re-registration.
 *   - Listen for PUSH_NOTIFICATION_RECEIVED messages from the service worker
 *     and notify registered listeners so the bell badge can refresh.
 *
 * iOS via Capacitor:
 *   Full iOS Capacitor + FCM integration requires the native app build and
 *   @capacitor/push-notifications plugin. This module provides the detection
 *   hook and stubs; see README for setup instructions.
 *   When running as a Capacitor iOS app, `getPlatform()` returns 'IOS' and
 *   the caller should use the Capacitor plugin to obtain the FCM token, then
 *   call `syncFcmTokenToServer(deviceId, fcmToken)`.
 */

import { fetchVapidPublicKey, savePushSubscription, deletePushSubscription, type PushPlatform } from './pushApi';

// ── Platform detection ────────────────────────────────────────────────────────

/** Returns the push delivery platform for this runtime environment. */
export function getPlatform(): PushPlatform {
	if (typeof window === 'undefined') return 'WEB';
	// Capacitor sets window.Capacitor when running as a native app
	const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
	if (cap?.getPlatform?.() === 'ios') return 'IOS';
	if (cap?.getPlatform?.() === 'android') return 'ANDROID';
	// Detect iOS Safari in a browser context (no Capacitor)
	const ua = navigator.userAgent || '';
	const isIOS = /iPad|iPhone|iPod/.test(ua)
		|| (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	if (isIOS) return 'IOS';
	return 'WEB';
}

/** Returns true if the current environment is iOS (native or browser). */
export function isIosPlatform(): boolean {
	return getPlatform() === 'IOS';
}

/** Returns true if the app is added to the iOS home screen (required for push). */
export function isIosInstalled(): boolean {
	if (typeof window === 'undefined') return false;
	return Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

// ── Permission state ──────────────────────────────────────────────────────────

export type PushPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

/** Returns the current Notification permission state. */
export function getNotificationPermission(): PushPermissionState {
	if (typeof Notification === 'undefined') return 'unsupported';
	return Notification.permission as PushPermissionState;
}

/** Returns true if push is supported on this device/browser. */
export function isPushSupported(): boolean {
	return (
		typeof window !== 'undefined' &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		typeof Notification !== 'undefined'
	);
}

// ── URL-safe base64 helper ────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const rawData = window.atob(base64);
	return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

// ── Subscribe ─────────────────────────────────────────────────────────────────

/**
 * Request notification permission, subscribe via PushManager, and sync to server.
 *
 * IMPORTANT: Only call this from a direct user gesture (button tap). Never
 * auto-invoke on page load — browsers block permission dialogs that are not
 * user-initiated, and iOS cannot re-prompt after "Don't Allow".
 *
 * @param deviceId — The stable device ID from getDeviceId()
 * @returns The PushPermissionState after the attempt
 */
export async function subscribeToPush(deviceId: string): Promise<PushPermissionState> {
	if (!isPushSupported()) return 'unsupported';

	// iOS running in the browser (not home screen) cannot use Web Push
	if (isIosPlatform() && !isIosInstalled()) {
		// Caller should show "Add to Home Screen" guidance instead of prompting
		return 'unsupported';
	}

	// Request permission — must be from a user gesture
	const permission = await Notification.requestPermission();
	if (permission !== 'granted') {
		return permission as PushPermissionState;
	}

	// Obtain the VAPID public key from the server
	let vapidPublicKey: string;
	try {
		const keyResponse = await fetchVapidPublicKey();
		vapidPublicKey = keyResponse.publicKey;
		if (!vapidPublicKey) throw new Error('VAPID key not configured on server');
	} catch (err) {
		console.error('[push] Failed to fetch VAPID key:', err);
		throw err;
	}

	// Subscribe via the browser PushManager
	const registration = await navigator.serviceWorker.ready;
	const browserSub = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as any,
	});

	// Normalise to a plain JSON object
	const subJson = browserSub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
	const platform = getPlatform();

	// Sync to server
	await savePushSubscription(deviceId, platform, {
		endpoint: subJson.endpoint,
		p256dh: subJson.keys?.p256dh ?? '',
		auth: subJson.keys?.auth ?? '',
	});

	return 'granted';
}

/** Unsubscribe from push notifications on this device and remove from server. */
export async function unsubscribeFromPush(deviceId: string): Promise<void> {
	// Unsubscribe from browser PushManager
	if (isPushSupported()) {
		try {
			const registration = await navigator.serviceWorker.ready;
			const sub = await registration.pushManager.getSubscription();
			await sub?.unsubscribe();
		} catch (err) {
			console.warn('[push] Browser unsubscribe failed:', err);
		}
	}
	// Remove from server
	await deletePushSubscription(deviceId);
}

/**
 * Re-register the current device — useful after a subscription has expired.
 * Equivalent to unsubscribing then subscribing fresh.
 */
export async function reregisterPush(deviceId: string): Promise<PushPermissionState> {
	await unsubscribeFromPush(deviceId);
	return subscribeToPush(deviceId);
}

/** Sync an FCM token (from Capacitor iOS) to the server. */
export async function syncFcmTokenToServer(deviceId: string, fcmToken: string): Promise<void> {
	await savePushSubscription(deviceId, 'IOS', { endpoint: '', p256dh: '', auth: '', fcmToken });
}

// ── SW push message listener ──────────────────────────────────────────────────

type PushReceivedListener = (data: Record<string, unknown>) => void;
const pushListeners = new Set<PushReceivedListener>();

let swMessageHandlerAttached = false;

function attachSwMessageHandler(): void {
	if (swMessageHandlerAttached || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
	swMessageHandlerAttached = true;

	navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
		const msg = event.data as { type?: string; notificationData?: Record<string, unknown> } | undefined;
		if (msg?.type === 'FREEMANNOTES_PUSH_RECEIVED') {
			const data = msg.notificationData ?? {};
			for (const listener of pushListeners) {
				try { listener(data); } catch { /* ignore */ }
			}
		}
	});
}

/**
 * Subscribe to push-received events forwarded from the service worker.
 * Useful for refreshing the notification bell badge without polling.
 *
 * @returns Unsubscribe function
 */
export function onPushReceived(listener: PushReceivedListener): () => void {
	attachSwMessageHandler();
	pushListeners.add(listener);
	return () => pushListeners.delete(listener);
}
