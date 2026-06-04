import { isLightTheme, type ThemeId } from './theme';

export type NoteBannerOption = {
	fileName: string;
	label: string;
	url: string;
};

export type NoteBannerAssetLayout = 'card' | 'list';

const NOTE_BANNER_CACHE_STORAGE_KEY = 'freemannotes.noteBannerOptions.v3';

function normalizeBannerFileName(fileName: string): string {
	return String(fileName ?? '').trim();
}

function splitBannerFileName(fileName: string): { stem: string; ext: string } {
	const normalized = normalizeBannerFileName(fileName);
	const match = normalized.match(/^(.*?)(\.[^.]+)$/);
	if (!match) {
		return { stem: normalized.replace(/W$/, ''), ext: '' };
	}
	return {
		stem: match[1].replace(/W$/, ''),
		ext: match[2],
	};
}

export function getNormalizedBannerDisplayName(fileName: string): string {
	const { stem } = splitBannerFileName(fileName);
	if (!stem) return '';
	return stem.charAt(0).toUpperCase() + stem.slice(1).toLowerCase();
}

export function getNoteBannerVariantFileName(fileName: string, layout: NoteBannerAssetLayout = 'card'): string {
	const { stem, ext } = splitBannerFileName(fileName);
	if (!stem) return '';
	return layout === 'list' ? `${stem}W${ext}` : `${stem}${ext}`;
}

function resolveThemeBannerAssetFileName(
	fileName: string,
	themeId?: ThemeId | null,
	layout: NoteBannerAssetLayout = 'card'
): string {
	const { stem, ext } = splitBannerFileName(fileName);
	if (!stem) return '';
	const canonicalStem = stem.toLowerCase();
	const extension = (ext || '.svg').toLowerCase();
	// Banner assets now follow one on-disk convention across both theme folders:
	// lowercase stem names for card art and the same lowercase stem plus `W` for
	// list art. URL generation must normalize to that convention so legacy stored
	// filenames keep working on Linux's case-sensitive filesystem.
	return layout === 'list' ? `${canonicalStem}W${extension}` : `${canonicalStem}${extension}`;
}

let cachedPromise: Promise<readonly NoteBannerOption[]> | null = null;
let cachedOptions: readonly NoteBannerOption[] | null = null;

export function getNoteBannerAssetUrl(
	fileName: string,
	themeId?: ThemeId | null,
	layout: NoteBannerAssetLayout = 'card'
): string {
	const variantBasePath = themeId && isLightTheme(themeId) ? '/CardBanners/Light' : '/CardBanners/Dark';
	const resolvedFileName = resolveThemeBannerAssetFileName(fileName, themeId, layout);
	return `${variantBasePath}/${encodeURIComponent(resolvedFileName)}`;
}

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
	const response = await fetch(input, {
		credentials: 'include',
		...init,
	});
	if (!response.ok) {
		const body = await response.json().catch(() => null);
		const message = body && typeof body.error === 'string' ? body.error : `Request failed (${response.status})`;
		throw new Error(message);
	}
	return response.json() as Promise<T>;
}

function normalizeBannerOptions(input: unknown): readonly NoteBannerOption[] {
	if (!Array.isArray(input)) return [];
	return input.flatMap((entry) => {
		if (!entry || typeof entry !== 'object') return [];
		const fileName = typeof (entry as { fileName?: unknown }).fileName === 'string'
			? getNoteBannerVariantFileName((entry as { fileName: string }).fileName, 'card')
			: '';
		if (!fileName) return [];
		const label = getNormalizedBannerDisplayName(fileName);
		const url = typeof (entry as { url?: unknown }).url === 'string'
			? (entry as { url: string }).url
			: getNoteBannerAssetUrl(fileName, null, 'card');
		return [{ fileName, label, url }];
	});
}

function readCachedBannerOptions(): readonly NoteBannerOption[] {
	if (cachedOptions) return cachedOptions;
	try {
		if (typeof localStorage === 'undefined') return [];
		const raw = localStorage.getItem(NOTE_BANNER_CACHE_STORAGE_KEY);
		if (!raw) return [];
		cachedOptions = normalizeBannerOptions(JSON.parse(raw));
		return cachedOptions;
	} catch {
		return [];
	}
}

function persistBannerOptions(options: readonly NoteBannerOption[]): void {
	cachedOptions = options;
	try {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(NOTE_BANNER_CACHE_STORAGE_KEY, JSON.stringify(options));
	} catch {
		// Ignore localStorage errors.
	}
}

export async function listNoteBanners(force = false): Promise<readonly NoteBannerOption[]> {
	const fallbackOptions = readCachedBannerOptions();
	if (!force && fallbackOptions.length > 0) return fallbackOptions;
	if (!force && cachedPromise) return cachedPromise;
	const request = fetchJson<{ banners?: NoteBannerOption[] }>('/api/card-banners')
		.then((body) => {
			const nextOptions = normalizeBannerOptions(body?.banners);
			persistBannerOptions(nextOptions);
			return nextOptions;
		})
		.catch((error) => {
			if (fallbackOptions.length > 0) return fallbackOptions;
			throw error;
		})
		.finally(() => {
			if (cachedPromise === request) {
				cachedPromise = null;
			}
		});
	cachedPromise = request;
	return request;
}