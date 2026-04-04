/**
 * Per-device note card height cache.
 *
 * Card heights vary by device (viewport width → card width → content wrapping),
 * so they are stored per device ID in localStorage. This lets the masonry
 * packing algorithm use the correct heights on the FIRST render, preventing
 * any layout repack during hydration.
 *
 * Storage key: `freemannotes.noteHeights.<deviceId>`
 * Format v1:   { v: 1, heights: Record<noteId, heightPx> }
 *
 * The cache is written once per session (debounced) after real heights are
 * measured from the DOM. On the next page load / workspace switch, heights
 * are seeded from the cache so skeleton cards render at the correct size.
 */

const VERSION = 1;
const PREFIX = 'freemannotes.noteHeights';

type HeightCacheV1 = {
	v: 1;
	heights: Record<string, number>;
};

/**
 * Load the height cache for the given device from localStorage.
 * Returns an empty map on any error (missing key, parse failure, wrong version).
 */
export function loadNoteHeightCache(deviceId: string): Map<string, number> {
	if (typeof window === 'undefined' || !deviceId) return new Map();
	try {
		const raw = window.localStorage.getItem(`${PREFIX}.${deviceId}`);
		if (!raw) return new Map();
		const parsed = JSON.parse(raw) as unknown;
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			(parsed as { v?: unknown }).v !== VERSION
		) {
			return new Map();
		}
		const { heights } = parsed as HeightCacheV1;
		const map = new Map<string, number>();
		for (const [k, v] of Object.entries(heights)) {
			if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
				map.set(k, Math.round(v));
			}
		}
		return map;
	} catch {
		return new Map();
	}
}

/**
 * Persist the height map to localStorage for the given device.
 * No-ops silently if storage is unavailable or quota is exceeded.
 */
export function saveNoteHeightCache(deviceId: string, heights: Map<string, number>): void {
	if (typeof window === 'undefined' || !deviceId || heights.size === 0) return;
	try {
		const obj: Record<string, number> = {};
		for (const [k, v] of heights) obj[k] = v;
		const payload: HeightCacheV1 = { v: VERSION, heights: obj };
		window.localStorage.setItem(`${PREFIX}.${deviceId}`, JSON.stringify(payload));
	} catch {
		// localStorage may be full or blocked — height caching is best-effort
	}
}
