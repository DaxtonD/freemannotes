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

/**
 * A banner is now the reader's own choice, not the note's — same model as note colours
 * (see readEffectiveNoteColorToken, which this deliberately mirrors). Picking one used to
 * write shared Yjs metadata, so changing the banner on a note you collaborate on changed
 * it on everyone else's screen too.
 *
 * The shared value is kept as the starting point rather than thrown away: a note that
 * already carries one still shows it to everybody, and nothing visually disappears. The
 * moment THIS user picks something, their choice wins for them alone — including picking
 * "no banner", which is why an explicit preference has to stay distinguishable from having
 * no preference at all instead of both collapsing to null.
 */
export function readEffectiveNoteBannerFile(
	metadata: MetadataLike,
	localPreference: string | null,
	hasLocalPreference: boolean
): string | null {
	if (hasLocalPreference) return normalizeNoteBannerFile(localPreference);
	return readSharedNoteBannerFile(metadata);
}