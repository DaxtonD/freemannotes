/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

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
