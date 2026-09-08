/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
// Random 4-char alphanumeric tag, regenerated every time the Vite process starts
// (both `npm run dev` and `npm run build`) — lets you eyeball whether the build/PWA
// you're looking at actually matches what you just built, independent of whether
// package.json's version was bumped.
declare const __BUILD_TAG__: string;
// True only for an actual `npm run dev` session (Vite command === 'serve').
declare const __IS_DEV_BUILD__: boolean;

interface ImportMetaEnv {
	/**
	 * Note card loading effect.
	 * "0" or unset → simple CSS shimmer (default)
	 * "1"           → HL2 Combine electric-fence crackle SVG overlay
	 */
	readonly VITE_NOTE_CARD_EFFECT?: string;
	/**
	 * Force windowed grid virtualization on with just a handful of notes. Production
	 * only virtualizes a column once it crosses ~18-20 notes, so a small dev dataset
	 * never exercises that whole subsystem — which is exactly where the "cards
	 * oscillate while scrolling" / "item count regrows on scroll" bugs live. Set to
	 * "1" in a dev build's env.vite config to bake it in. There is also a per-browser
	 * runtime toggle (`?forceVirtualization=1`, persisted to localStorage) that works
	 * on any build — see VirtualizedNoteColumn.tsx. Leave this unset in production.
	 */
	readonly VITE_FORCE_VIRTUALIZATION?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
