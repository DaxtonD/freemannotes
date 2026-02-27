const CACHE_NAME = 'freemannotes-shell-v1';
const CORE_ASSETS = ['/', '/index.html'];

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
			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const names = await caches.keys();
			await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

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
			fetch(request)
				.then((response) => {
					const clone = response.clone();
					caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone));
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
