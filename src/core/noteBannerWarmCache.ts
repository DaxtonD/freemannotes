/**
 * Per-note banner warm cache.
 *
 * Stores the most-recently-chosen bannerFile (or null for explicit removal) for
 * each noteId so that the warm-start bootstrap can use the correct banner URL
 * even when the debounced render snapshot is stale.
 *
 * Written synchronously at every assignNoteBannerFile call site. Read by
 * readSynchronousWarmStartupBannerUrls (for preloading) and
 * createSnapshotDocFromWorkspaceRenderSnapshot (for first-paint display).
 */

const STORAGE_KEY = 'fn_banner_warm_v1';

type WarmCacheMap = Record<string, string | null>;

function readRawCache(): WarmCacheMap {
	try {
		const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return parsed as WarmCacheMap;
	} catch {
		return {};
	}
}

/** Returns the entire warm cache map: noteId → bannerFile | null */
export function readNoteBannerWarmCache(): WarmCacheMap {
	return readRawCache();
}

/**
 * Returns the warm-cached banner entry for the given note:
 * - `string`    → a recently-assigned banner file name
 * - `null`      → banner was recently removed
 * - `undefined` → no recent change recorded; caller should fall back to render snapshot
 */
export function getNoteBannerWarmCacheEntry(noteId: string): string | null | undefined {
	const cache = readRawCache();
	return noteId in cache ? cache[noteId] : undefined;
}

/**
 * Synchronously records the latest banner assignment for a note.
 * Call immediately after assignNoteBannerFile at every UI call site.
 */
export function writeNoteBannerWarmCacheFile(noteId: string, bannerFile: string | null): void {
	try {
		if (typeof localStorage === 'undefined') return;
		const cache = readRawCache();
		cache[noteId] = bannerFile;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
	} catch {
		// Ignore quota / security errors.
	}
}
