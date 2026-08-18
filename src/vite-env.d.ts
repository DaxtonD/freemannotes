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
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
