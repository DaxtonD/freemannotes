/* global self */

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
const APP_SHELL_CACHE = `freemannotes-app-shell-${APP_VERSION}`;
const STATIC_CACHE = `freemannotes-static-${APP_VERSION}`;
const API_CACHE = `freemannotes-api-${APP_VERSION}`;
const IMAGE_CACHE = `freemannotes-images-${APP_VERSION}`;
const CACHE_PREFIXES = ['freemannotes-app-shell-', 'freemannotes-static-', 'freemannotes-api-', 'freemannotes-images-'];
const OFFLINE_FALLBACK_URL = '/index.html';
const BACKGROUND_SYNC_TAG = 'freemannotes-background-sync';
const LARGE_IMAGE_LIMIT_BYTES = 2 * 1024 * 1024;

const injectedManifest = self.__WB_MANIFEST;
const precacheManifest = Array.isArray(injectedManifest) ? injectedManifest : [];
// Workbox injectManifest only gives us build-time asset URLs. We normalize them
// up front so cache cleanup can compare pathname-to-pathname across versions.
const precacheUrls = Array.from(new Set(precacheManifest.map((entry) => new URL(entry.url, self.location.origin).pathname)));

function isCacheableResponse(response) {
	return Boolean(response && (response.ok || response.type === 'opaque'));
}

function canStoreResponseInCache(response) {
	if (!isCacheableResponse(response)) return false;
	const cacheControl = String(response.headers.get('cache-control') || '').toLowerCase();
	return !cacheControl.includes('no-store');
}

function shouldHandleNavigation(url) {
	return url.origin === self.location.origin && !url.pathname.startsWith('/api/');
}

function isStaticAssetRequest(request, url) {
	if (url.origin !== self.location.origin) return false;
	if (request.destination === 'style' || request.destination === 'script' || request.destination === 'font' || request.destination === 'worker') return true;
	return url.pathname.startsWith('/assets/') || url.pathname.startsWith('/locales/');
}

function isApiGetRequest(request, url) {
	// Auth/session probes must always hit the network so cookie truth wins over
	// any stale service-worker cache entry.
	return request.method === 'GET'
		&& url.origin === self.location.origin
		&& url.pathname.startsWith('/api/')
		&& !url.pathname.startsWith('/api/auth/');
}

function isImageRequest(request, url) {
	if (request.destination === 'image') return true;
	const acceptHeader = String(request.headers.get('accept') || '').toLowerCase();
	if (acceptHeader.includes('image/')) return true;
	return /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i.test(url.pathname);
}

function isLikelyThumbnail(url) {
	return /thumbnail|preview|thumb/i.test(url.pathname) || /thumbnail|preview|thumb/i.test(url.search);
}

async function trimPrecache(cache) {
	const keys = await cache.keys();
	const keep = new Set(precacheUrls);
	await Promise.all(
		keys
			.map((request) => new URL(request.url))
			.filter((url) => url.origin === self.location.origin && !keep.has(url.pathname))
			.map((url) => cache.delete(url.pathname))
	);
}

async function precacheAppShell() {
	const cache = await caches.open(APP_SHELL_CACHE);
	await Promise.all(
		precacheUrls.map(async (url) => {
			try {
				const response = await fetch(new Request(url, { cache: 'reload' }));
				if (isCacheableResponse(response)) {
					await cache.put(url, response.clone());
				}
			} catch {
				// Installation still succeeds if a single asset is temporarily unavailable.
			}
		})
	);
	await trimPrecache(cache);
}

async function deleteOutdatedCaches() {
	const keys = await caches.keys();
	await Promise.all(
		keys
			.filter((key) => CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
			.filter((key) => ![APP_SHELL_CACHE, STATIC_CACHE, API_CACHE, IMAGE_CACHE].includes(key))
			.map((key) => caches.delete(key))
	);
}

async function staleWhileRevalidate(request, cacheName) {
	const cache = await caches.open(cacheName);
	const cached = await cache.match(request);
	const networkPromise = fetch(request)
		.then(async (response) => {
			if (canStoreResponseInCache(response)) {
				await cache.put(request, response.clone());
			} else {
				await cache.delete(request);
			}
			return response;
		})
		.catch(() => null);
	if (cached) {
		void networkPromise;
		return cached;
	}
	const networkResponse = await networkPromise;
	if (networkResponse) return networkResponse;
	// Fall back to the precache (APP_SHELL_CACHE) for assets that were stored
	// during SW install but haven't been fetched online yet in this session
	// (e.g. lazy-loaded chunks like the drawing editor that are only requested
	// the first time a user opens a drawing note).
	const shellCache = await caches.open(APP_SHELL_CACHE);
	return (await shellCache.match(request)) || Response.error();
}

async function networkFirst(request, cacheName) {
	const cache = await caches.open(cacheName);
	try {
		const response = await fetch(request);
		// Use isCacheableResponse (not canStoreResponseInCache) so that API responses
		// with Cache-Control: no-store are still stored here.  That header targets
		// browser and CDN proxy caches; a same-origin service worker acting as a
		// local offline fallback is not a shared proxy, so the directive does not apply.
		if (isCacheableResponse(response)) {
			await cache.put(request, response.clone());
		} else {
			await cache.delete(request);
		}
		return response;
	} catch {
		return (await cache.match(request)) || Response.error();
	}
}

async function cacheFirstImage(request) {
	const cache = await caches.open(IMAGE_CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;
	try {
		const response = await fetch(request);
		if (!isCacheableResponse(response)) return response;
		const size = Number(response.headers.get('content-length') || '0');
		// Full-size note images can be much larger than the thumbnails that make card
		// rails feel instant offline. Skip caching oversized local originals so the PWA
		// keeps space for the assets users actually revisit most often.
		if (request.url.startsWith(self.location.origin) && !isLikelyThumbnail(new URL(request.url)) && Number.isFinite(size) && size > LARGE_IMAGE_LIMIT_BYTES) {
			return response;
		}
		if (canStoreResponseInCache(response)) {
			await cache.put(request, response.clone());
		} else {
			await cache.delete(request);
		}
		return response;
	} catch {
		// Offline and not cached — return a graceful error response instead of
		// letting the unhandled rejection surface as a broken image placeholder.
		return Response.error();
	}
}

async function refreshNavigationShell(request) {
	try {
		const response = await fetch(new Request(request.url, { cache: 'no-store' }));
		if (!response || !response.ok) return null;
		const cache = await caches.open(APP_SHELL_CACHE);
		await cache.put(OFFLINE_FALLBACK_URL, response.clone());
		return response;
	} catch {
		return null;
	}
}

async function handleNavigation(request) {
	const cache = await caches.open(APP_SHELL_CACHE);
	const cachedShell = await cache.match(OFFLINE_FALLBACK_URL);
	if (cachedShell) {
		void refreshNavigationShell(request);
		return cachedShell;
	}
	return (await refreshNavigationShell(request)) || Response.error();
}

async function postMessageToClients(message) {
	const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	for (const client of clients) {
		client.postMessage(message);
	}
}

self.addEventListener('install', (event) => {
	event.waitUntil(precacheAppShell());
});

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		await deleteOutdatedCaches();
		await self.clients.claim();
	})());
});

self.addEventListener('message', (event) => {
	if (!event.data || typeof event.data !== 'object') return;
	if (event.data.type === 'SKIP_WAITING') {
		self.skipWaiting();
		return;
	}
	if (event.data.type === 'FREEMANNOTES_SCHEDULE_SYNC') {
		event.waitUntil((async () => {
			try {
				if (self.registration.sync) {
					await self.registration.sync.register(event.data.tag || BACKGROUND_SYNC_TAG);
				}
			} catch {
				// iOS Safari and some desktop browsers do not support Background Sync.
			}
			// Ask every open client to flush immediately as well, so sync still happens
			// in browsers that accept the message but never fire a background sync event.
			await postMessageToClients({ type: 'FREEMANNOTES_SW_FLUSH_QUEUES' });
		})());
	}
});

self.addEventListener('sync', (event) => {
	if (event.tag !== BACKGROUND_SYNC_TAG) return;
	event.waitUntil((async () => {
		await postMessageToClients({ type: 'FREEMANNOTES_SW_SYNC_STATUS', status: 'started' });
		await postMessageToClients({ type: 'FREEMANNOTES_SW_FLUSH_QUEUES' });
		await postMessageToClients({ type: 'FREEMANNOTES_SW_SYNC_STATUS', status: 'complete' });
	})());
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);

	if (request.mode === 'navigate' && shouldHandleNavigation(url)) {
		event.respondWith(handleNavigation(request));
		return;
	}

	if (isApiGetRequest(request, url)) {
		event.respondWith(networkFirst(request, API_CACHE));
		return;
	}

	if (isStaticAssetRequest(request, url)) {
		event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
		return;
	}

	if (isImageRequest(request, url)) {
		event.respondWith(cacheFirstImage(request));
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// Push notification handlers
//
// The `push` event fires when a push message arrives from the server.
// `notificationclick` handles user taps on displayed notifications.
//
// Architecture:
//   1. Server sends a push via VAPID (web/android) or FCM (iOS).
//   2. SW receives the payload, extracts { title, body, data } from JSON.
//   3. SW shows a system notification with an icon + badge.
//   4. On click: focus an existing window or open a new one, navigating to
//      the note/workspace URL embedded in the notification data.
//   5. SW posts a PUSH_NOTIFICATION_RECEIVED message to all clients so the
//      in-app notification bell can refresh its badge count.
// ─────────────────────────────────────────────────────────────────────────────

const NOTIFICATION_ICON = '/notification-icon.png';
const NOTIFICATION_BADGE = '/notification-badge.png';

function normalizeVibrate(value) {
	if (Array.isArray(value)) {
		return value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry) && entry >= 0);
	}
	if (typeof value === 'string') {
		return value
			.split(',')
			.map((entry) => Number(entry.trim()))
			.filter((entry) => Number.isFinite(entry) && entry >= 0);
	}
	return [150, 50, 150];
}

self.addEventListener('push', (event) => {
	// Safely extract notification payload — fall back to defaults if malformed.
	let payload = {
		title: 'Freeman Notes',
		body: 'You have a new notification.',
		icon: NOTIFICATION_ICON,
		badge: NOTIFICATION_BADGE,
		image: undefined,
		data: {},
	};
	if (event.data) {
		try {
			const raw = event.data.json();
			payload = {
				title: String(raw.title || payload.title),
				body: String(raw.body || payload.body),
				icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : (raw.data?.icon || payload.icon),
				badge: typeof raw.badge === 'string' && raw.badge ? raw.badge : (raw.data?.badge || payload.badge),
				image: typeof raw.image === 'string' && raw.image ? raw.image : (raw.data?.image || undefined),
				data: raw.data && typeof raw.data === 'object' ? raw.data : {},
			};
		} catch {
			try {
				payload.body = event.data.text() || payload.body;
			} catch {
				// ignore
			}
		}
	}

	const showPromise = self.registration.showNotification(payload.title, {
		body: payload.body,
		icon: payload.icon || NOTIFICATION_ICON,
		badge: payload.badge || NOTIFICATION_BADGE,
		image: typeof payload.image === 'string' && payload.image ? payload.image : undefined,
		// Collapse duplicate notifications from the same type, but give each
		// reminder its own slot so multiple due notes don't override each other.
		tag: typeof payload.data.tag === 'string' && payload.data.tag
			? payload.data.tag
			: payload.data.type ? `freeman-notes-${String(payload.data.type)}` : 'freeman-notes',
		renotify: true,
		data: payload.data,
		vibrate: normalizeVibrate(payload.data?.vibrate),
		requireInteraction: payload.data?.requireInteraction === true,
		actions: payload.data?.type === 'reminder'
			? [
				{ action: 'open-note', title: 'Open note' },
				{ action: 'dismiss', title: 'Dismiss' },
			]
			: undefined,
	}).then(async () => {
		// Notify open app windows so the bell badge can refresh immediately.
		await postMessageToClients({ type: 'FREEMANNOTES_PUSH_RECEIVED', notificationData: payload.data });
	});

	event.waitUntil(showPromise);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	if (event.action === 'dismiss') return;

	const data = event.notification.data || {};
	// Determine the deep-link target URL from notification data.
	// Format: /?workspace=<id>&note=<id>  or a fully-qualified URL in data.url
	let targetUrl = '/';
	if (data.url && typeof data.url === 'string') {
		// Use the URL from the notification payload (already constructed by the server)
		try {
			const parsed = new URL(data.url, self.location.origin);
			if (parsed.origin === self.location.origin) {
				targetUrl = parsed.pathname + parsed.search + parsed.hash;
			}
		} catch {
			targetUrl = '/';
		}
	} else if (data.workspaceId && data.noteId) {
		targetUrl = `/?workspace=${encodeURIComponent(String(data.workspaceId))}&note=${encodeURIComponent(String(data.noteId))}`;
	}

	event.waitUntil(
		(async () => {
			// Try to reuse an already-open window on this origin rather than opening a new tab.
			const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of clients) {
				if (new URL(client.url).origin === self.location.origin) {
					// Navigate the existing window to the target note
					await client.navigate(targetUrl);
					await client.focus();
					return;
				}
			}
			// No existing window — open a new one
			await self.clients.openWindow(targetUrl);
		})()
	);
});