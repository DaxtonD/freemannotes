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
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
const DEFAULT_VIEWPORT_CONTENT = 'width=device-width, initial-scale=1, viewport-fit=cover';
const IOS_STANDALONE_VIEWPORT_CONTENT = `${DEFAULT_VIEWPORT_CONTENT}, maximum-scale=1, user-scalable=no`;

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
	const iosStandalone = isIosSafari() && isStandalone();
	const nextContent = iosStandalone ? IOS_STANDALONE_VIEWPORT_CONTENT : DEFAULT_VIEWPORT_CONTENT;
	if (viewportMeta.getAttribute('content') !== nextContent) {
		viewportMeta.setAttribute('content', nextContent);
	}
	document.documentElement.classList.toggle('ios-standalone', iosStandalone);
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
		writeStorageValue(PWA_UPDATED_NOTICE_KEY, APP_VERSION);
	}
	writeStorageValue(PWA_VERSION_STORAGE_KEY, APP_VERSION);
	setSnapshot({ updateApplied: readStorageValue(PWA_UPDATED_NOTICE_KEY) === APP_VERSION });
	if (previousVersion === APP_VERSION) {
		setSnapshot({ updateApplied: readStorageValue(PWA_UPDATED_NOTICE_KEY) === APP_VERSION });
	}
}

function markPwaInteraction(): void {
	pwaLastInteractionAt = Date.now();
}

function canSafelyApplyPwaUpdate(): boolean {
	if (typeof document === 'undefined') return !pwaUpdateBlocked;
	if (pwaUpdateBlocked) return false;
	if (document.visibilityState === 'hidden') return true;
	return Date.now() - pwaLastInteractionAt >= SW_UPDATE_IDLE_MS;
}

function scheduleDeferredPwaApplyCheck(): void {
	if (!swPendingApply || !updateServiceWorker) return;
	if (!canSafelyApplyPwaUpdate()) return;
	void applyPwaUpdateImmediately();
}

function scheduleServiceWorkerUpdateChecks(): void {
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	const updateNow = () => {
		void swRegistration?.update().catch(() => undefined);
		scheduleDeferredPwaApplyCheck();
	};
	if (swUpdateTimer !== null) {
		window.clearInterval(swUpdateTimer);
	}
	swUpdateTimer = window.setInterval(updateNow, SW_UPDATE_POLL_MS);
	window.addEventListener('pointerdown', markPwaInteraction, { passive: true });
	window.addEventListener('keydown', markPwaInteraction);
	window.addEventListener('touchstart', markPwaInteraction, { passive: true });
	window.addEventListener('focus', updateNow);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			markPwaInteraction();
			updateNow();
			return;
		}
		scheduleDeferredPwaApplyCheck();
	});
}

async function applyPwaUpdateImmediately(): Promise<void> {
	if (!updateServiceWorker || swAutoApplying) return;
	if (!canSafelyApplyPwaUpdate()) {
		swPendingApply = true;
		setSnapshot({ updateAvailable: true });
		return;
	}
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

export function initPwa(): void {
	if (initialized || typeof window === 'undefined') return;
	initialized = true;
	reconcileVersionNotifications();
	refreshMobileViewportBehavior();

	if (import.meta.env.DEV) {
		// Dev should always reflect the latest code, not whatever an older worker or
		// cache entry left behind from a previous build.
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

	if ('serviceWorker' in navigator) {
		navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			swAutoApplying = false;
			swPendingApply = false;
			if (typeof window !== 'undefined') {
				window.location.reload();
			}
		});
		updateServiceWorker = registerSW({
			immediate: true,
			onNeedRefresh() {
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
	if (!updateServiceWorker) return;
	swPendingApply = false;
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
		scheduleDeferredPwaApplyCheck();
	}
}

export async function requestPwaBackgroundSync(): Promise<void> {
	await scheduleBackgroundSyncInternal();
	if (typeof navigator !== 'undefined' && navigator.onLine) {
		dispatchSyncRequest();
	}
}