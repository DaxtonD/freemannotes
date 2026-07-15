import * as React from 'react';
import { registerSW } from 'virtual:pwa-register';

export const PWA_SYNC_REQUEST_EVENT = 'freemannotes:pwa-sync-request';
const PWA_SYNC_TAG = 'freemannotes-background-sync';

type InstallMethod = 'prompt' | 'ios' | null;

type PwaSnapshot = {
	canInstall: boolean;
	installMethod: InstallMethod;
	isInstalled: boolean;
	updateAvailable: boolean;
	updateApplied: boolean;
	offlineReady: boolean;
	syncInProgress: boolean;
};

type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
	preventDefault: () => void;
};

type ServiceWorkerRegistrationWithSync = ServiceWorkerRegistration & {
	sync?: { register: (tag: string) => Promise<void> };
};

const SW_UPDATE_POLL_MS = 60_000;
const SW_UPDATE_IDLE_MS = 90_000;
const PWA_VERSION_STORAGE_KEY = 'freemannotes.pwa.current-version.v1';
const PWA_UPDATED_NOTICE_KEY = 'freemannotes.pwa.updated-notice.v1';
const PWA_DEBUG_ENABLED_KEY = 'freemannotes.pwa.debug-enabled.v1';
const PWA_DEBUG_LOG_KEY = 'freemannotes.pwa.debug-log.v1';
const PWA_DEBUG_MAX_ENTRIES = 150;
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
const DEFAULT_VIEWPORT_CONTENT = 'width=device-width, initial-scale=1, viewport-fit=cover';
const IOS_VIEWPORT_LOCKED_CONTENT = `${DEFAULT_VIEWPORT_CONTENT}, minimum-scale=1, maximum-scale=1, user-scalable=no`;

type PwaDebugEntry = { t: string; e: string; d?: Record<string, unknown> };

function pwaLog(event: string, details?: Record<string, unknown>): void {
	if (typeof window === 'undefined') return;
	try {
		if (window.localStorage.getItem(PWA_DEBUG_ENABLED_KEY) !== '1') return;
		const raw = window.localStorage.getItem(PWA_DEBUG_LOG_KEY);
		const entries: PwaDebugEntry[] = raw ? (JSON.parse(raw) as PwaDebugEntry[]) : [];
		entries.push({ t: new Date().toISOString(), e: event, ...(details ? { d: details } : {}) });
		window.localStorage.setItem(PWA_DEBUG_LOG_KEY, JSON.stringify(entries.slice(-PWA_DEBUG_MAX_ENTRIES)));
	} catch {
		// ignore storage errors
	}
}

export function getPwaDebugEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	try { return window.localStorage.getItem(PWA_DEBUG_ENABLED_KEY) === '1'; } catch { return false; }
}

export function setPwaDebugEnabled(enabled: boolean): void {
	if (typeof window === 'undefined') return;
	try {
		if (enabled) {
			window.localStorage.setItem(PWA_DEBUG_ENABLED_KEY, '1');
		} else {
			window.localStorage.removeItem(PWA_DEBUG_ENABLED_KEY);
		}
	} catch { /* ignore */ }
}

export function readPwaDebugLog(): PwaDebugEntry[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = window.localStorage.getItem(PWA_DEBUG_LOG_KEY);
		return raw ? (JSON.parse(raw) as PwaDebugEntry[]) : [];
	} catch {
		return [];
	}
}

export function clearPwaDebugLog(): void {
	if (typeof window === 'undefined') return;
	try { window.localStorage.removeItem(PWA_DEBUG_LOG_KEY); } catch { /* ignore */ }
}

let initialized = false;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;
let swRegistration: ServiceWorkerRegistration | null = null;
let swUpdateTimer: number | null = null;
let swAutoApplying = false;
let swPendingApply = false;
let pwaUpdateBlocked = false;
let pwaLastInteractionAt = Date.now();
let standaloneZoomLockCleanup: (() => void) | null = null;
let networkVersionPending = false;
let lastNetworkVersionCheckAt = 0;
let networkVersionCheckInFlight = false;

let snapshot: PwaSnapshot = {
	canInstall: false,
	installMethod: null,
	isInstalled: false,
	updateAvailable: false,
	updateApplied: false,
	offlineReady: false,
	syncInProgress: false,
};

const listeners = new Set<() => void>();

function emit(): void {
	for (const listener of listeners) {
		listener();
	}
}

function setSnapshot(next: Partial<PwaSnapshot>): void {
	snapshot = { ...snapshot, ...next };
	emit();
}

function isStandalone(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia?.('(display-mode: standalone)')?.matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function isIosSafari(): boolean {
	if (typeof window === 'undefined') return false;
	const ua = window.navigator.userAgent || '';
	const isIOS = /iPad|iPhone|iPod/.test(ua) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
	const isWebkit = /WebKit/i.test(ua);
	const isCriOS = /CriOS/i.test(ua);
	const isFxiOS = /FxiOS/i.test(ua);
	return isIOS && isWebkit && !isCriOS && !isFxiOS;
}

function getViewportMeta(): HTMLMetaElement | null {
	if (typeof document === 'undefined') return null;
	return document.querySelector('meta[name="viewport"]');
}

function applyViewportConfiguration(): void {
	if (typeof document === 'undefined') return;
	const viewportMeta = getViewportMeta();
	if (!viewportMeta) return;
	const iosViewportLocked = isIosSafari();
	const nextContent = iosViewportLocked ? IOS_VIEWPORT_LOCKED_CONTENT : DEFAULT_VIEWPORT_CONTENT;
	if (viewportMeta.getAttribute('content') !== nextContent) {
		viewportMeta.setAttribute('content', nextContent);
	}
	document.documentElement.classList.toggle('ios-standalone', iosViewportLocked && isStandalone());
}

function applyStandaloneZoomLock(): void {
	standaloneZoomLockCleanup?.();
	standaloneZoomLockCleanup = null;
	if (typeof document === 'undefined') return;
	if (!isIosSafari() || !isStandalone()) return;

	const preventGesture = (event: Event): void => {
		if (event.cancelable) event.preventDefault();
	};
	const preventPinchTouchMove = (event: TouchEvent): void => {
		if (event.touches.length < 2) return;
		if (event.cancelable) event.preventDefault();
	};

	document.addEventListener('gesturestart', preventGesture, { passive: false });
	document.addEventListener('gesturechange', preventGesture, { passive: false });
	document.addEventListener('gestureend', preventGesture, { passive: false });
	document.addEventListener('touchmove', preventPinchTouchMove, { passive: false });
	standaloneZoomLockCleanup = () => {
		document.removeEventListener('gesturestart', preventGesture);
		document.removeEventListener('gesturechange', preventGesture);
		document.removeEventListener('gestureend', preventGesture);
		document.removeEventListener('touchmove', preventPinchTouchMove);
	};
}

function refreshMobileViewportBehavior(): void {
	applyViewportConfiguration();
	applyStandaloneZoomLock();
}

function recomputeInstallAvailability(): void {
	const installed = isStandalone();
	const iosInstallable = !installed && isIosSafari();
	const promptInstallable = !installed && deferredInstallPrompt !== null;
	// iOS never fires beforeinstallprompt, so the UI needs to distinguish
	// between browsers that can show a native prompt and Safari-style manual
	// install instructions.
	setSnapshot({
		isInstalled: installed,
		canInstall: iosInstallable || promptInstallable,
		installMethod: promptInstallable ? 'prompt' : iosInstallable ? 'ios' : null,
	});
}

function dispatchSyncRequest(): void {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent(PWA_SYNC_REQUEST_EVENT));
}

function readStorageValue(key: string): string | null {
	if (typeof window === 'undefined') return null;
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorageValue(key: string, value: string): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(key, value);
	} catch {
		// ignore
	}
}

function removeStorageValue(key: string): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.removeItem(key);
	} catch {
		// ignore
	}
}

function reconcileVersionNotifications(): void {
	const previousVersion = readStorageValue(PWA_VERSION_STORAGE_KEY);
	if (previousVersion && previousVersion !== APP_VERSION) {
		// First open of a new version — write the notice so the user sees it once.
		writeStorageValue(PWA_UPDATED_NOTICE_KEY, APP_VERSION);
	} else if (previousVersion === APP_VERSION) {
		// Second or later open of the same version. If the user closed the app
		// without dismissing the notice (e.g. Android force-close), expire it now
		// so it doesn't keep reappearing on every reopen.
		removeStorageValue(PWA_UPDATED_NOTICE_KEY);
	}
	writeStorageValue(PWA_VERSION_STORAGE_KEY, APP_VERSION);
	setSnapshot({ updateApplied: readStorageValue(PWA_UPDATED_NOTICE_KEY) === APP_VERSION });
}

function markPwaInteraction(): void {
	pwaLastInteractionAt = Date.now();
}

function canSafelyApplyPwaUpdate(caller?: string): boolean {
	if (typeof document === 'undefined') return !pwaUpdateBlocked;
	const vis = document.visibilityState;
	const idleMs = Date.now() - pwaLastInteractionAt;
	let result: boolean;
	let reason: string;
	if (pwaUpdateBlocked) {
		result = false;
		reason = 'blocked';
	} else if (vis !== 'visible') {
		// Never apply while the page is hidden: Chrome PWA queues location.replace()
		// calls made on a backgrounded page and executes them on foreground, producing
		// a surprise reload the moment the user returns to the app.
		result = false;
		reason = 'hidden';
	} else if (idleMs < SW_UPDATE_IDLE_MS) {
		result = false;
		reason = `not-idle(${Math.round(idleMs / 1000)}s)`;
	} else {
		result = true;
		reason = 'safe';
	}
	pwaLog('canSafelyApply', { caller, result, reason, vis, idleMs, swPendingApply, networkVersionPending });
	return result;
}

async function applyNetworkVersionUpdate(): Promise<void> {
	networkVersionPending = false;
	swPendingApply = false;
	setSnapshot({ updateAvailable: false });
	if (typeof window !== 'undefined') {
		pwaLog('RELOAD_network', {
			vis: document.visibilityState,
			idleMs: Date.now() - pwaLastInteractionAt,
			pwaUpdateBlocked,
			swAutoApplying,
		});
		// Use replace() rather than reload() — more reliable on iOS standalone PWA
		// where location.reload() can fail to escape a frozen WKWebView snapshot.
		window.location.replace('/');
	}
}

async function checkNetworkVersion(): Promise<void> {
	if (typeof window === 'undefined' || APP_VERSION === 'dev') return;
	if (networkVersionCheckInFlight) return;
	// Throttle to match the SW update polling interval.
	if (Date.now() - lastNetworkVersionCheckAt < SW_UPDATE_POLL_MS) return;
	networkVersionCheckInFlight = true;
	lastNetworkVersionCheckAt = Date.now();
	try {
		const res = await fetch('/api/version', { cache: 'no-store' });
		if (!res.ok) return;
		const data = await (res.json() as Promise<{ version?: string }>);
		const serverVersion = typeof data?.version === 'string' ? data.version : null;
		if (!serverVersion || serverVersion === APP_VERSION) return;
		// Server is running a newer version. Force a hard navigation so the
		// new index.html + hashed assets are loaded. This is the most reliable
		// approach for iOS Safari standalone where the SW update mechanism is
		// insufficient to escape a frozen WKWebView session.
		pwaLog('versionMismatch', { serverVersion, clientVersion: APP_VERSION });
		networkVersionPending = true;
		if (canSafelyApplyPwaUpdate('checkNetworkVersion')) {
			await applyNetworkVersionUpdate();
		} else {
			swPendingApply = true;
			setSnapshot({ updateAvailable: true });
		}
	} catch {
		// Offline or endpoint missing — skip silently.
	} finally {
		networkVersionCheckInFlight = false;
	}
}

function scheduleDeferredPwaApplyCheck(caller?: string): void {
	if (!swPendingApply) return;
	if (!canSafelyApplyPwaUpdate(`deferredCheck(${caller ?? '?'})`)) return;
	pwaLog('deferredCheck-firing', { caller, networkVersionPending });
	if (networkVersionPending) {
		void applyNetworkVersionUpdate();
		return;
	}
	if (!updateServiceWorker) return;
	void applyPwaUpdateImmediately();
}

function scheduleServiceWorkerUpdateChecks(): void {
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	const updateNow = (trigger: string) => {
		pwaLog('updateNow', { trigger, swPendingApply, networkVersionPending });
		void swRegistration?.update().catch(() => undefined);
		scheduleDeferredPwaApplyCheck(trigger);
		void checkNetworkVersion();
	};
	if (swUpdateTimer !== null) {
		window.clearInterval(swUpdateTimer);
	}
	swUpdateTimer = window.setInterval(() => updateNow('timer'), SW_UPDATE_POLL_MS);
	window.addEventListener('pointerdown', markPwaInteraction, { passive: true });
	window.addEventListener('keydown', markPwaInteraction);
	window.addEventListener('touchstart', markPwaInteraction, { passive: true });
	window.addEventListener('focus', () => updateNow('focus'));
	document.addEventListener('visibilitychange', () => {
		const vis = document.visibilityState;
		pwaLog('visibilitychange', { vis, swPendingApply, networkVersionPending, pwaUpdateBlocked, idleMs: Date.now() - pwaLastInteractionAt });
		if (vis === 'visible') {
			markPwaInteraction();
			updateNow('visibilityVisible');
			return;
		}
		scheduleDeferredPwaApplyCheck('visibilityHidden');
	});
}

async function applyPwaUpdateImmediately(): Promise<void> {
	if (!updateServiceWorker || swAutoApplying) return;
	if (!canSafelyApplyPwaUpdate('applyImmediately')) {
		swPendingApply = true;
		setSnapshot({ updateAvailable: true });
		return;
	}
	pwaLog('swApply-start');
	swAutoApplying = true;
	swPendingApply = false;
	setSnapshot({ updateAvailable: true });
	try {
		await updateServiceWorker(true);
	} catch {
		swAutoApplying = false;
		swPendingApply = true;
	}
}

async function scheduleBackgroundSyncInternal(): Promise<void> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
	try {
		const registration = (await navigator.serviceWorker.ready) as ServiceWorkerRegistrationWithSync;
		await registration.sync?.register?.(PWA_SYNC_TAG);
		if (navigator.serviceWorker.controller) {
			// Registering the sync tag is best-effort. We also ping the active worker
			// immediately so browsers without SyncManager still flush the same queues.
			navigator.serviceWorker.controller.postMessage({ type: 'FREEMANNOTES_SCHEDULE_SYNC', tag: PWA_SYNC_TAG });
		}
	} catch {
		// Browsers without Background Sync still rely on the app's normal online listeners.
	}
}

function handleServiceWorkerMessage(event: MessageEvent): void {
	const data = event.data as { type?: string; status?: 'started' | 'complete' } | undefined;
	if (!data?.type) return;
	if (data.type === 'FREEMANNOTES_SW_FLUSH_QUEUES') {
		setSnapshot({ syncInProgress: true });
		dispatchSyncRequest();
		return;
	}
	if (data.type === 'FREEMANNOTES_SW_SYNC_STATUS') {
		setSnapshot({ syncInProgress: data.status === 'started' });
	}
}

function isStandalonePwa(): boolean {
	if (typeof window === 'undefined') return false;
	return Boolean(
		window.matchMedia?.('(display-mode: standalone)')?.matches
		|| window.matchMedia?.('(display-mode: fullscreen)')?.matches
		|| window.matchMedia?.('(display-mode: minimal-ui)')?.matches
		|| (window.navigator as Navigator & { standalone?: boolean }).standalone
	);
}

function registerAppServiceWorker(): void {
	if (!('serviceWorker' in navigator)) return;
	navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
	let hadControllerOnInit = Boolean(navigator.serviceWorker.controller);
	navigator.serviceWorker.addEventListener('controllerchange', () => {
		const wasAutoApplying = swAutoApplying;
		swAutoApplying = false;
		swPendingApply = false;
		pwaLog('controllerchange', {
			hadControllerOnInit,
			wasAutoApplying,
			vis: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
			pwaUpdateBlocked,
			idleMs: Date.now() - pwaLastInteractionAt,
		});
		if (!hadControllerOnInit) {
			hadControllerOnInit = true;
			return;
		}
		if (typeof window !== 'undefined') {
			// Defer reload when the page is hidden or a modal/editor is blocking.
			// Calling location.replace() while hidden causes Chrome PWA to queue the
			// navigation and execute it the moment the user foregrounds the app.
			if (document.visibilityState !== 'visible' || pwaUpdateBlocked) {
				swPendingApply = true;
				networkVersionPending = true;
				return;
			}
			pwaLog('RELOAD_controllerchange', { wasAutoApplying, idleMs: Date.now() - pwaLastInteractionAt });
			window.location.replace(window.location.href);
		}
	});
	updateServiceWorker = registerSW({
		immediate: true,
		onNeedRefresh() {
			pwaLog('onNeedRefresh', { swPendingApply, vis: document.visibilityState, idleMs: Date.now() - pwaLastInteractionAt });
			swPendingApply = true;
			void applyPwaUpdateImmediately();
		},
		onOfflineReady() {
			setSnapshot({ offlineReady: true });
		},
		onRegisteredSW(_swUrl, registration) {
			swRegistration = registration || null;
			registration?.update().catch(() => undefined);
			scheduleServiceWorkerUpdateChecks();
		},
	});
}

export function initPwa(): void {
	if (initialized || typeof window === 'undefined') return;
	initialized = true;
	pwaLog('init', {
		appVersion: APP_VERSION,
		hadController: Boolean(navigator.serviceWorker?.controller),
		vis: document.visibilityState,
	});
	reconcileVersionNotifications();
	refreshMobileViewportBehavior();

	if (import.meta.env.DEV && !isStandalonePwa()) {
		// Browser-tab dev should stay cache-free, but installed dev PWAs need a live
		// service worker so push subscriptions remain valid across reloads.
		navigator.serviceWorker?.getRegistrations?.()
			.then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
			.then(() => caches.keys())
			.then((names) => Promise.all(names.map((name) => caches.delete(name))))
			.catch((error) => {
				console.warn('[PWA] dev cleanup failed:', error);
			});
		recomputeInstallAvailability();
		return;
	}

	window.addEventListener('beforeinstallprompt', (event) => {
		event.preventDefault();
		deferredInstallPrompt = event as BeforeInstallPromptEvent;
		recomputeInstallAvailability();
		refreshMobileViewportBehavior();
	});

	window.addEventListener('appinstalled', () => {
		deferredInstallPrompt = null;
		recomputeInstallAvailability();
		refreshMobileViewportBehavior();
	});

	window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', () => {
		recomputeInstallAvailability();
		refreshMobileViewportBehavior();
	});

	registerAppServiceWorker();

	recomputeInstallAvailability();
	refreshMobileViewportBehavior();
}

export function subscribeToPwaState(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getPwaSnapshot(): PwaSnapshot {
	return snapshot;
}

export function usePwaState(): PwaSnapshot {
	return React.useSyncExternalStore(subscribeToPwaState, getPwaSnapshot, getPwaSnapshot);
}

export async function promptInstallApp(): Promise<'accepted' | 'dismissed' | 'unsupported'> {
	if (snapshot.installMethod !== 'prompt' || !deferredInstallPrompt) return 'unsupported';
	const promptEvent = deferredInstallPrompt;
	deferredInstallPrompt = null;
	await promptEvent.prompt();
	const choice = await promptEvent.userChoice;
	recomputeInstallAvailability();
	return choice.outcome;
}

export async function applyPwaUpdate(): Promise<void> {
	pwaLog('applyPwaUpdate-manual', { networkVersionPending });
	swPendingApply = false;
	if (networkVersionPending) {
		await applyNetworkVersionUpdate();
		return;
	}
	if (!updateServiceWorker) return;
	swAutoApplying = true;
	await updateServiceWorker(true);
	swAutoApplying = false;
	setSnapshot({ updateAvailable: false });
}

export function deferPwaUpdate(): void {
	swPendingApply = true;
	scheduleDeferredPwaApplyCheck();
}

export function acknowledgePwaUpdated(): void {
	removeStorageValue(PWA_UPDATED_NOTICE_KEY);
	setSnapshot({ updateApplied: false });
}

export function setPwaUpdateBlocked(next: boolean): void {
	pwaUpdateBlocked = next;
	if (!next) {
		scheduleDeferredPwaApplyCheck('unblocked');
	}
}

export async function requestPwaBackgroundSync(): Promise<void> {
	await scheduleBackgroundSyncInternal();
	if (typeof navigator !== 'undefined' && navigator.onLine) {
		dispatchSyncRequest();
	}
}