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

let initialized = false;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;
let swRegistration: ServiceWorkerRegistration | null = null;
let swUpdateTimer: number | null = null;
let swAutoApplying = false;

let snapshot: PwaSnapshot = {
	canInstall: false,
	installMethod: null,
	isInstalled: false,
	updateAvailable: false,
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

function scheduleServiceWorkerUpdateChecks(): void {
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	const updateNow = () => {
		void swRegistration?.update().catch(() => undefined);
	};
	if (swUpdateTimer !== null) {
		window.clearInterval(swUpdateTimer);
	}
	swUpdateTimer = window.setInterval(updateNow, SW_UPDATE_POLL_MS);
	window.addEventListener('focus', updateNow);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') updateNow();
	});
}

async function applyPwaUpdateImmediately(): Promise<void> {
	if (!updateServiceWorker || swAutoApplying) return;
	swAutoApplying = true;
	setSnapshot({ updateAvailable: true });
	try {
		await updateServiceWorker(true);
	} catch {
		swAutoApplying = false;
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
	});

	window.addEventListener('appinstalled', () => {
		deferredInstallPrompt = null;
		recomputeInstallAvailability();
	});

	window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', () => {
		recomputeInstallAvailability();
	});

	if ('serviceWorker' in navigator) {
		navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			if (typeof window !== 'undefined') {
				window.location.reload();
			}
		});
		updateServiceWorker = registerSW({
			immediate: true,
			onNeedRefresh() {
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
	await updateServiceWorker(true);
	swAutoApplying = false;
	setSnapshot({ updateAvailable: false });
}

export async function requestPwaBackgroundSync(): Promise<void> {
	await scheduleBackgroundSyncInternal();
	if (typeof navigator !== 'undefined' && navigator.onLine) {
		dispatchSyncRequest();
	}
}