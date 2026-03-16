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

function shouldHandleNavigation(url) {
	return url.origin === self.location.origin && !url.pathname.startsWith('/api/');
}

function isStaticAssetRequest(request, url) {
	if (url.origin !== self.location.origin) return false;
	if (request.destination === 'style' || request.destination === 'script' || request.destination === 'font' || request.destination === 'worker') return true;
	return url.pathname.startsWith('/assets/') || url.pathname.startsWith('/locales/');
}

function isApiGetRequest(request, url) {
	return request.method === 'GET' && url.origin === self.location.origin && url.pathname.startsWith('/api/');
}

function isImageRequest(request) {
	return request.destination === 'image';
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
			if (isCacheableResponse(response)) {
				await cache.put(request, response.clone());
			}
			return response;
		})
		.catch(() => null);
	if (cached) {
		void networkPromise;
		return cached;
	}
	return (await networkPromise) || Response.error();
}

async function networkFirst(request, cacheName) {
	const cache = await caches.open(cacheName);
	try {
		const response = await fetch(request);
		if (isCacheableResponse(response)) {
			await cache.put(request, response.clone());
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
	const response = await fetch(request);
	if (!isCacheableResponse(response)) return response;
	const size = Number(response.headers.get('content-length') || '0');
	// Full-size note images can be much larger than the thumbnails that make card
	// rails feel instant offline. Skip caching oversized local originals so the PWA
	// keeps space for the assets users actually revisit most often.
	if (request.url.startsWith(self.location.origin) && !isLikelyThumbnail(new URL(request.url)) && Number.isFinite(size) && size > LARGE_IMAGE_LIMIT_BYTES) {
		return response;
	}
	await cache.put(request, response.clone());
	return response;
}

async function handleNavigation(request) {
	try {
		const response = await fetch(new Request(request.url, { cache: 'no-store' }));
		if (!response || !response.ok) throw new Error('navigation failed');
		const cache = await caches.open(APP_SHELL_CACHE);
		await cache.put(OFFLINE_FALLBACK_URL, response.clone());
		return response;
	} catch {
		const cache = await caches.open(APP_SHELL_CACHE);
		return (await cache.match(OFFLINE_FALLBACK_URL)) || Response.error();
	}
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

	if (isImageRequest(request)) {
		event.respondWith(cacheFirstImage(request));
	}
});