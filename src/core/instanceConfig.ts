// Instance-wide settings a self-hosted deployment's admin controls via env
// vars (IMAGE_CAPTURE_MAX_DIMENSION_PX / IMAGE_CAPTURE_JPEG_QUALITY — see
// server/noteMediaRouter.js). There's no DB row or admin UI for these by
// design: a deployment sizes them once for its own storage/bandwidth budget
// and user count, not something that needs to change at runtime. The client
// fetches the effective values once per session (persisted to localStorage so
// a returning session doesn't wait on a network round-trip before the first
// photo capture) rather than hardcoding a value that can't vary per instance.

const INSTANCE_CONFIG_CACHE_KEY = 'freemannotes.instanceConfig.v1';

const DEFAULT_IMAGE_CAPTURE_MAX_DIMENSION_PX = 2560;
const DEFAULT_IMAGE_CAPTURE_JPEG_QUALITY = 0.82;

type InstanceConfig = {
	imageCaptureMaxDimensionPx: number;
	imageCaptureJpegQuality: number;
};

const defaultConfig: InstanceConfig = {
	imageCaptureMaxDimensionPx: DEFAULT_IMAGE_CAPTURE_MAX_DIMENSION_PX,
	imageCaptureJpegQuality: DEFAULT_IMAGE_CAPTURE_JPEG_QUALITY,
};

function readPersistedConfig(): InstanceConfig | null {
	try {
		if (typeof localStorage === 'undefined') return null;
		const raw = localStorage.getItem(INSTANCE_CONFIG_CACHE_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') return null;
		const { imageCaptureMaxDimensionPx, imageCaptureJpegQuality } = parsed as Partial<InstanceConfig>;
		if (typeof imageCaptureMaxDimensionPx !== 'number' || typeof imageCaptureJpegQuality !== 'number') return null;
		return { imageCaptureMaxDimensionPx, imageCaptureJpegQuality };
	} catch {
		return null;
	}
}

function writePersistedConfig(config: InstanceConfig): void {
	try {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(INSTANCE_CONFIG_CACHE_KEY, JSON.stringify(config));
	} catch {
		// Best effort only.
	}
}

let cachedConfig: InstanceConfig = readPersistedConfig() ?? defaultConfig;
let fetchStarted = false;

function ensureInstanceConfigLoaded(): void {
	if (fetchStarted || typeof fetch !== 'function') return;
	fetchStarted = true;
	void (async () => {
		try {
			const response = await fetch('/api/config', { credentials: 'include' });
			if (!response.ok) return;
			const data: unknown = await response.json();
			if (!data || typeof data !== 'object') return;
			const { imageCaptureMaxDimensionPx, imageCaptureJpegQuality } = data as Partial<InstanceConfig>;
			const next: InstanceConfig = {
				imageCaptureMaxDimensionPx: typeof imageCaptureMaxDimensionPx === 'number' && imageCaptureMaxDimensionPx > 0
					? imageCaptureMaxDimensionPx
					: defaultConfig.imageCaptureMaxDimensionPx,
				imageCaptureJpegQuality: typeof imageCaptureJpegQuality === 'number' && imageCaptureJpegQuality > 0
					? imageCaptureJpegQuality
					: defaultConfig.imageCaptureJpegQuality,
			};
			cachedConfig = next;
			writePersistedConfig(next);
		} catch {
			// Offline, unauthenticated, or the request otherwise failed — keep
			// using the cached/default value. fetchStarted intentionally stays
			// true so a failure doesn't retry on every photo capture in this
			// session; the next full page load tries again.
		}
	})();
}

export function getImageCaptureMaxDimensionPx(): number {
	ensureInstanceConfigLoaded();
	return cachedConfig.imageCaptureMaxDimensionPx;
}

export function getImageCaptureJpegQuality(): number {
	ensureInstanceConfigLoaded();
	return cachedConfig.imageCaptureJpegQuality;
}
