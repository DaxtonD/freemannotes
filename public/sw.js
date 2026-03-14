const CACHE_NAME = 'freemannotes-shell-v5';
const IMAGE_CACHE_NAME = 'freemannotes-images-v1';
const IMAGE_META_CACHE_NAME = 'freemannotes-images-meta-v1';
const IMAGE_CACHE_LIMIT_BYTES = 300 * 1024 * 1024;
// Cache the canonical app shell entry only.
// Caching '/' can get sticky across proxy setups and makes upgrades harder.
const CORE_ASSETS = ['/index.html'];

async function readImageMeta(cache, url) {
	const response = await cache.match(url);
	if (!response) return null;
	try {
		return await response.json();
	} catch {
		return null;
	}
}

async function writeImageMeta(cache, url, meta) {
	await cache.put(url, new Response(JSON.stringify(meta), {
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
	}));
}

async function touchImageMeta(url) {
	const metaCache = await caches.open(IMAGE_META_CACHE_NAME);
	const existing = await readImageMeta(metaCache, url);
	if (!existing) return;
	await writeImageMeta(metaCache, url, {
		...existing,
		lastAccessed: Date.now(),
	});
}

async function enforceImageCacheLimit() {
	const imageCache = await caches.open(IMAGE_CACHE_NAME);
	const metaCache = await caches.open(IMAGE_META_CACHE_NAME);
	const keys = await metaCache.keys();
	const entries = [];
	let totalSize = 0;
	for (const request of keys) {
		const meta = await readImageMeta(metaCache, request.url);
		if (!meta) continue;
		const size = Number(meta.size || 0);
		totalSize += size;
		entries.push({
			url: request.url,
			size,
			lastAccessed: Number(meta.lastAccessed || 0),
		});
	}
	entries.sort((left, right) => left.lastAccessed - right.lastAccessed);
	while (totalSize > IMAGE_CACHE_LIMIT_BYTES && entries.length > 0) {
		const oldest = entries.shift();
		if (!oldest) break;
		totalSize -= oldest.size;
		await Promise.all([
			imageCache.delete(oldest.url),
			metaCache.delete(oldest.url),
		]);
	}
}

async function storeViewedImage(request, response) {
	if (!response || !response.ok || response.type !== 'basic') return response;
	const imageCache = await caches.open(IMAGE_CACHE_NAME);
	const metaCache = await caches.open(IMAGE_META_CACHE_NAME);
	const clone = response.clone();
	const sizedClone = response.clone();
	const blob = await sizedClone.blob().catch(() => null);
	const size = blob ? blob.size : Number(response.headers.get('content-length') || '0') || 0;
	await imageCache.put(request, clone);
	await writeImageMeta(metaCache, request.url, {
		size,
		lastAccessed: Date.now(),
	});
	await enforceImageCacheLimit();
	return response;
}

async function handleViewedImageRequest(request) {
	try {
		const response = await fetch(request);
		return await storeViewedImage(request, response);
	} catch {
		const imageCache = await caches.open(IMAGE_CACHE_NAME);
		const cached = await imageCache.match(request);
		if (cached) {
			await touchImageMeta(request.url);
			return cached;
		}
		return Response.error();
	}
}

async function getBuildAssetsFromIndexHtml() {
	// For production builds, index.html references hashed assets under /assets/.
	// We can discover them at install-time so offline refresh works immediately
	// after the first successful load (no second refresh required).
	try {
		const res = await fetch('/index.html', { cache: 'no-store' });
		if (!res.ok) return [];
		const html = await res.text();

		// Dev safety: Vite dev HTML references /@vite/client and /src/main.tsx.
		// Never precache those.
		if (html.includes('/@vite/client') || html.includes('/src/')) {
			return [];
		}

		const assets = new Set();
		const re = /(href|src)=("|')([^"']+)("|')/g;
		let m;
		while ((m = re.exec(html))) {
			const url = m[3];
			if (!url) continue;
			if (!url.startsWith('/assets/')) continue;
			if (url.includes('hot-update') || url.endsWith('.map')) continue;
			assets.add(url);
		}
		return Array.from(assets);
	} catch {
		return [];
	}
}

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			await cache.addAll(CORE_ASSETS);
			const buildAssets = await getBuildAssetsFromIndexHtml();
			if (buildAssets.length > 0) {
				await cache.addAll(buildAssets);
			}
			// NOTE: We intentionally do NOT call self.skipWaiting() here.
			// Immediate activation causes clients.claim() to fire which
			// triggers a navigation reload on mobile browsers — exactly the
			// "random splash screen" scenario we want to avoid.
			// Instead, the new SW activates naturally when all tabs are closed
			// and re-opened, or the app can prompt users to refresh.
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const names = await caches.keys();
			await Promise.all(names.filter((name) => ![CACHE_NAME, IMAGE_CACHE_NAME, IMAGE_META_CACHE_NAME].includes(name)).map((name) => caches.delete(name)));
			// Claim the current page on first install so the cached app shell can
			// serve subsequent navigations even when the origin is unreachable.
			// We intentionally still avoid skipWaiting(), so updates only activate
			// after older tabs close; claiming here is therefore safe.
			if (!self.clients) return;
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	if (url.pathname.startsWith('/uploads/')) {
		// Attachment assets stay out of IndexedDB. We only cache the responses that
		// users actually view, and we bound that cache with LRU eviction.
		event.respondWith(handleViewedImageRequest(request));
		return;
	}

	// Never cache API responses or uploads. They change frequently and must stay fresh.
	if (url.pathname.startsWith('/api/')) {
		return;
	}

	// Locale JSON files must always be fetched fresh so translation updates
	// take effect immediately after a deploy.
	if (url.pathname.startsWith('/locales/')) {
		return;
	}

	// Branch: Vite dev server requests must NOT be cached.
	// If these are cached, HMR and module loading can break badly.
	if (
		url.pathname.startsWith('/@') ||
		url.pathname.startsWith('/src/') ||
		url.pathname.startsWith('/node_modules/') ||
		url.pathname.startsWith('/__vite') ||
		url.pathname.includes('hot-update') ||
		url.pathname.endsWith('.map')
	) {
		return;
	}

	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request.url, { cache: 'no-store' })
				.then((response) => {
					// If the origin/proxy returns an error page (e.g. 502 Bad Gateway),
					// treat it like offline and fall back to the cached app shell.
					if (!response || !response.ok) {
						throw new Error(`Navigation fetch failed: ${response ? response.status : 'no-response'}`);
					}
					const clone = response.clone();
					caches.open(CACHE_NAME).then(async (cache) => {
						// Refresh shell.
						await cache.put('/index.html', clone);
						// Refresh hashed build assets in the background so upgrades take effect
						// even if the previous build is fully cached.
						const buildAssets = await getBuildAssetsFromIndexHtml();
						if (buildAssets.length > 0) {
							await cache.addAll(buildAssets);
							// Cleanup old cached assets not referenced by the current build.
							const keep = new Set(buildAssets);
							const keys = await cache.keys();
							await Promise.all(
								keys
									.map((req) => new URL(req.url))
									.filter((u) => u.origin === self.location.origin && u.pathname.startsWith('/assets/'))
									.filter((u) => !keep.has(u.pathname))
									.map((u) => cache.delete(u.pathname))
							);
						}
					});
					return response;
				})
				.catch(async () => {
					const cache = await caches.open(CACHE_NAME);
					return (await cache.match('/index.html')) || Response.error();
				})
		);
		return;
	}

	event.respondWith(
		caches.match(request).then((cached) => {
			if (cached) return cached;
			return fetch(request).then((response) => {
				if (response && response.status === 200 && response.type === 'basic') {
					const clone = response.clone();
					caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
				}
				return response;
			});
		})
	);
});
