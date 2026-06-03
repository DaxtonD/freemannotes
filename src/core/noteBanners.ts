export const NOTE_BANNER_METADATA_FIELD = 'bannerFile';
export const VALID_NOTE_BANNER_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,158}\.(svg|png|jpe?g|webp|avif)$/i;

type MetadataLike = {
	get: (key: string) => unknown;
	has?: (key: string) => boolean;
};

export function normalizeNoteBannerFile(value: unknown): string | null {
	if (value == null || value === '') return null;
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return VALID_NOTE_BANNER_FILE_RE.test(normalized) ? normalized : null;
}

export function hasSharedNoteBannerPreference(metadata: MetadataLike): boolean {
	return typeof metadata.has === 'function' && metadata.has(NOTE_BANNER_METADATA_FIELD);
}

export function readSharedNoteBannerFile(metadata: MetadataLike): string | null {
	return normalizeNoteBannerFile(metadata.get(NOTE_BANNER_METADATA_FIELD));
}

export function readEffectiveNoteBannerFile(metadata: MetadataLike, legacyFallback: string | null): string | null {
	if (hasSharedNoteBannerPreference(metadata)) {
		return readSharedNoteBannerFile(metadata);
	}
	return normalizeNoteBannerFile(legacyFallback);
}