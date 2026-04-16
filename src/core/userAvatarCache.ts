/**
 * Lightweight localStorage cache for user avatar (profile image) URLs.
 *
 * Avatar images are served from /uploads/<userId>.webp and are typically
 * cached by the service worker after the first load. However, the URL
 * itself must be known before it can be requested. This module persists
 * userId → profileImageUrl mappings so collaborator avatars can be
 * displayed from local cache when the network is unavailable.
 */

const CACHE_KEY = 'freemannotes.userAvatarCache.v1';
const MAX_ENTRIES = 500;

type CacheV1 = Record<string, string>; // userId → profileImageUrl

function load(): CacheV1 {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (raw) return JSON.parse(raw) as CacheV1;
	} catch { /* ignore */ }
	return {};
}

function save(cache: CacheV1): void {
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
	} catch { /* ignore */ }
}

let _cache: CacheV1 | null = null;
function getCache(): CacheV1 {
	if (!_cache) _cache = load();
	return _cache;
}

/** Return a cached profile image URL for the given userId, or null if unknown. */
export function getCachedAvatarUrl(userId: string | null | undefined): string | null {
	if (!userId) return null;
	return getCache()[userId] ?? null;
}

/**
 * Update the cache with a batch of users. Silently ignores entries with
 * missing/null profileImage. Evicts oldest entries when the cache is full.
 */
export function updateAvatarCache(users: ReadonlyArray<{ id?: string | null; userId?: string | null; profileImage?: string | null }>): void {
	if (!users.length) return;
	const cache = getCache();
	let changed = false;
	for (const user of users) {
		const id = user.id ?? user.userId;
		const url = user.profileImage;
		if (!id || !url) continue;
		if (cache[id] === url) continue;
		cache[id] = url;
		changed = true;
	}
	if (!changed) return;
	// Evict oldest entries if over limit (simple: remove arbitrary keys until under limit).
	const keys = Object.keys(cache);
	if (keys.length > MAX_ENTRIES) {
		for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) {
			delete cache[key];
		}
	}
	save(cache);
}
