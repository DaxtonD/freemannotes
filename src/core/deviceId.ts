const STORAGE_KEY = 'freemannotes.deviceId';

// ─── Device fingerprint ──────────────────────────────────────────────────────
//
// Goal: a stable, cache-resilient identifier for the physical device +
// browser combination.
//
// A pure localStorage UUID is lost as soon as the user clears site data.
// We derive a deterministic fingerprint from signals that are tied to the
// browser installation and hardware, not to stored state:
//
//   • userAgent      — browser name, version, OS
//   • screen         — width × height × colorDepth
//   • devicePixelRatio — retina vs non-retina
//   • hardwareConcurrency — CPU logical cores
//   • timezone       — IANA time-zone (e.g. "America/New_York")
//   • language       — primary browser language
//
// The signals are concatenated and reduced to a 16-char hex digest using a
// fast non-cryptographic hash (FNV-1a 64-bit variant). That is plenty of
// entropy to distinguish a desktop-Firefox from a mobile-Safari for a
// single user's preference record.
//
// If localStorage IS available we still write the ID there so subsequent
// calls are synchronous and zero-cost. If the cache is cleared the next
// call recomputes from the same fingerprint and arrives at the same ID.
//
// The UUID-shaped legacy IDs already stored in localStorage are preserved as-
// is so existing users see no disruption: the ID is only replaced when
// localStorage is empty (cleared site data or first visit).

/**
 * FNV-1a 64-bit hash expressed as two 32-bit halves to stay within safe
 * integer range. Returns a 16-character lowercase hex string.
 */
function fnv1a64(input: string): string {
	// 64-bit FNV offset basis split into high/low 32-bit halves
	let lo = 0x84222325;
	let hi = 0xcbf29ce4;
	for (let i = 0; i < input.length; i++) {
		const c = input.charCodeAt(i);
		// XOR low half with byte
		lo ^= c;
		// 64-bit FNV prime = 0x00000100000001B3
		// Multiply: (hi:lo) * prime using 32-bit arithmetic
		const primeHi = 0x00000100;
		const primeLo = 0x000001b3;
		const newLo = Math.imul(lo, primeLo) >>> 0;
		const newHi = (Math.imul(hi, primeLo) + Math.imul(lo, primeHi)) >>> 0;
		lo = newLo;
		hi = newHi;
	}
	return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

/**
 * Collect the stable, cache-independent device signals.
 * Returns a human-readable label and a fingerprint string to hash.
 */
function collectDeviceSignals(): { fingerprint: string; label: string } {
	if (typeof window === 'undefined') return { fingerprint: 'ssr', label: 'server' };

	const nav = window.navigator;
	const scr = window.screen;

	const ua = nav.userAgent ?? '';
	const sw = String(scr?.width ?? 0);
	const sh = String(scr?.height ?? 0);
	const cd = String(scr?.colorDepth ?? 24);
	const dpr = String(window.devicePixelRatio ?? 1);
	const cpu = String(nav.hardwareConcurrency ?? 0);
	const tz = Intl?.DateTimeFormat?.().resolvedOptions?.()?.timeZone ?? '';
	const lang = (nav.language ?? '').split('-')[0];

	const fingerprint = [ua, sw, sh, cd, dpr, cpu, tz, lang].join('|');

	// Build a human-readable label: "os-browser-resolution"
	// e.g.  "windows-chrome-1920x1080"  or  "ios-safari-390x844"
	const osRaw = (() => {
		if (/android/i.test(ua)) return 'android';
		if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
		if (/macintosh|mac os x/i.test(ua)) return 'macos';
		if (/windows/i.test(ua)) return 'windows';
		if (/linux/i.test(ua)) return 'linux';
		return 'unknown-os';
	})();
	const browserRaw = (() => {
		if (/edg\//i.test(ua)) return 'edge';
		if (/opr\//i.test(ua)) return 'opera';
		if (/firefox\//i.test(ua)) return 'firefox';
		if (/chrome\//i.test(ua)) return 'chrome';
		if (/safari\//i.test(ua)) return 'safari';
		return 'browser';
	})();
	const res = `${sw}x${sh}`;
	const label = `${osRaw}-${browserRaw}-${res}`;

	return { fingerprint, label };
}

/**
 * Return a stable device label describing this device/browser.
 * Examples: "windows-chrome-1920x1080", "ios-safari-390x844"
 */
export function getDeviceLabel(): string {
	return collectDeviceSignals().label;
}

/**
 * Return a stable, cache-resilient device ID for the current browser.
 *
 * Resolution order:
 *  1. localStorage (fast path, survives across sessions until cache cleared)
 *  2. Deterministic fingerprint (survives cache clearing — same device always
 *     produces the same ID from its hardware/browser signals)
 *
 * The ID is always written back to localStorage after being computed so
 * future calls are synchronous and O(1).
 */
export function getDeviceId(): string {
	if (typeof window === 'undefined') return 'legacy';
	try {
		// Fast path: already stored
		const stored = String(window.localStorage.getItem(STORAGE_KEY) || '').trim();
		if (stored) return stored;

		// Cache was cleared (or first visit): compute from stable device signals
		const { fingerprint, label } = collectDeviceSignals();
		const id = `fp-${label}-${fnv1a64(fingerprint)}`;

		// Write back for O(1) future reads, but don't fail if storage is blocked
		try { window.localStorage.setItem(STORAGE_KEY, id); } catch { /* ok */ }
		return id;
	} catch {
		// localStorage fully unavailable (e.g. private browsing with strict settings)
		// Fall back to a per-session fingerprint — not cache-resilient but better than 'legacy'
		const { fingerprint, label } = collectDeviceSignals();
		return `fp-${label}-${fnv1a64(fingerprint)}`;
	}
}

