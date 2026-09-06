/**
 * Per-device note card height cache.
 *
 * Card heights vary by device (viewport width → card width → content wrapping),
 * so they are stored per device ID in localStorage. This lets the masonry
 * packing algorithm use the correct heights on the FIRST render, preventing
 * any layout repack during hydration.
 *
 * Storage key: `freemannotes.noteHeights.<deviceId>`
 * Format v4:   { v: 4, fingerprint: string, heights: Record<noteId, heightPx> }
 *
 * `deviceId` alone is a coarser key than it looks: it's derived from physical
 * screen resolution (see deviceId.ts), which does NOT change when the browser
 * window is resized, split-screened, zoomed, or when the independent font-scale
 * preference changes — all of which genuinely change real card height. Without
 * `fingerprint`, a height measured at one browser width/font-scale would be
 * silently reused at another, forever, until that exact note happened to be
 * re-measured on this device again. `fingerprint` captures the viewport
 * bucket + layout density (max card height + font scales + a couple of other
 * height-affecting prefs, see NoteGrid.tsx's layoutDensityKey) that was active
 * when the cache was last saved; the whole cache is treated as absent — not
 * partially trusted — if the caller's current fingerprint doesn't match, the
 * same coarse-but-correct granularity a global viewport/font-scale change
 * actually calls for (see the architecture-audit memory for why per-note
 * fingerprinting would be strictly more code for no practical benefit here:
 * a fingerprint change means EVERY card's real height changed, not some).
 *
 * The caller's fingerprint alone missed the actual most common way a cached
 * height goes wrong: the CODE that computed it changing out from under it,
 * with the user's viewport/density prefs never touched at all. Every one of
 * this project's own height-related fixes falls into that bucket, and none of
 * them used to invalidate anything here — this module has APP_VERSION folded
 * into the effective fingerprint specifically so a real release, not just a
 * preference change, also counts as "this number needs re-measuring."
 *
 * The cache is written once per session (debounced) after real heights are
 * measured from the DOM. On the next page load / workspace switch, heights
 * are seeded from the cache so skeleton cards render at the correct size.
 */

const VERSION = 4;
const PREFIX = 'freemannotes.noteHeights';
// Folded into the caller's own fingerprint (viewport/density/etc.) below, not a
// separate check — real-world case that exposed why this was needed: a note
// created months ago on production, never touched again since, still had a
// height cached from whatever layout code existed the day it was measured.
// Every fix that ever changed a real card's height (there have been a lot,
// see CHANGELOG) left every pre-existing cache entry stale with nothing to
// detect it — the fingerprint only ever caught a viewport/density change, not
// "the code computing this number is different now." A build with a long note
// history and infrequent resets (production) accumulates these silently for
// months; a dev environment that gets reset often barely has time to notice.
// Tying the fingerprint to the app's own version means every release
// invalidates every previously-cached height for everyone, automatically, the
// same day it ships — no dev-tools button to remember to click.
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

type HeightCacheV1 = {
	v: 4;
	fingerprint: string;
	heights: Record<string, number>;
};

/**
 * Load the height cache for the given device from localStorage.
 * Returns an empty map on any error (missing key, parse failure, wrong
 * version) OR if the stored fingerprint doesn't match `fingerprint` — an
 * old-format entry or one saved under a different viewport/density context
 * is discarded outright rather than trusted, same as a version mismatch.
 */
export function loadNoteHeightCache(deviceId: string, fingerprint: string): Map<string, number> {
	if (typeof window === 'undefined' || !deviceId) return new Map();
	const effectiveFingerprint = `${fingerprint}:${APP_VERSION}`;
	try {
		const raw = window.localStorage.getItem(`${PREFIX}.${deviceId}`);
		if (!raw) return new Map();
		const parsed = JSON.parse(raw) as unknown;
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			(parsed as { v?: unknown }).v !== VERSION ||
			(parsed as { fingerprint?: unknown }).fingerprint !== effectiveFingerprint
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
 * Persist the height map to localStorage for the given device, tagged with
 * the viewport/density fingerprint that produced these measurements.
 * No-ops silently if storage is unavailable or quota is exceeded.
 */
export function saveNoteHeightCache(deviceId: string, fingerprint: string, heights: Map<string, number>): void {
	if (typeof window === 'undefined' || !deviceId || heights.size === 0) return;
	try {
		const obj: Record<string, number> = {};
		for (const [k, v] of heights) obj[k] = v;
		const payload: HeightCacheV1 = { v: VERSION, fingerprint: `${fingerprint}:${APP_VERSION}`, heights: obj };
		window.localStorage.setItem(`${PREFIX}.${deviceId}`, JSON.stringify(payload));
	} catch {
		// localStorage may be full or blocked — height caching is best-effort
	}
}
