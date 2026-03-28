export const MIN_FONT_SCALE = 0.75;
export const MAX_FONT_SCALE = 1.5;
export const MIN_NOTE_CARD_HEIGHT_PX = 320;
export const MAX_NOTE_CARD_HEIGHT_PX = 1400;

const STORAGE_KEY = 'freemannotes.deviceAppearancePreferences.v1';

export type CachedDeviceAppearancePreferences = {
	deviceId: string;
	noteCardFontScale: number;
	noteEditorFontScale: number;
	noteCardMaxHeightPx: number;
	updatedAt: string;
};

export function clampFontScale(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, value));
}

export function getDefaultNoteCardMaxHeightPx(): number {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 920;
	return window.matchMedia('(pointer: coarse)').matches ? 720 : 920;
}

export function clampNoteCardMaxHeightPx(value: number): number {
	if (!Number.isFinite(value)) return getDefaultNoteCardMaxHeightPx();
	return Math.round(Math.min(MAX_NOTE_CARD_HEIGHT_PX, Math.max(MIN_NOTE_CARD_HEIGHT_PX, value)));
}

function readRaw(): CachedDeviceAppearancePreferences | null {
	if (typeof window === 'undefined') return null;
	try {
		// Keep this payload tiny and self-healing because it is read during app boot
		// before remote preferences are available.
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<CachedDeviceAppearancePreferences> | null;
		if (!parsed || typeof parsed !== 'object') return null;
		if (typeof parsed.deviceId !== 'string' || !parsed.deviceId) return null;
		return {
			deviceId: parsed.deviceId,
			noteCardFontScale: clampFontScale(Number(parsed.noteCardFontScale)),
			noteEditorFontScale: clampFontScale(Number(parsed.noteEditorFontScale)),
			noteCardMaxHeightPx: clampNoteCardMaxHeightPx(Number(parsed.noteCardMaxHeightPx)),
			updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
		};
	} catch {
		return null;
	}
}

export function readCachedDeviceAppearancePreferences(deviceId: string): CachedDeviceAppearancePreferences | null {
	const cached = readRaw();
	if (!cached || cached.deviceId !== deviceId) return null;
	return cached;
}

export function writeCachedDeviceAppearancePreferences(snapshot: CachedDeviceAppearancePreferences): void {
	if (typeof window === 'undefined') return;
	try {
		// Local writes let the UI apply appearance changes immediately, then reconcile
		// with the server once authenticated preference sync finishes.
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				deviceId: snapshot.deviceId,
				noteCardFontScale: clampFontScale(snapshot.noteCardFontScale),
				noteEditorFontScale: clampFontScale(snapshot.noteEditorFontScale),
				noteCardMaxHeightPx: clampNoteCardMaxHeightPx(snapshot.noteCardMaxHeightPx),
				updatedAt: snapshot.updatedAt,
			})
		);
	} catch {
		// best effort
	}
}

export function isLocalAppearancePreferenceNewer(localUpdatedAt: string | null, remoteUpdatedAt: string | null): boolean {
	// Favor the freshest timestamp so offline edits made on this device can win the
	// next sync instead of being overwritten by an older server snapshot.
	const localMs = localUpdatedAt ? Date.parse(localUpdatedAt) : Number.NaN;
	const remoteMs = remoteUpdatedAt ? Date.parse(remoteUpdatedAt) : Number.NaN;
	if (!Number.isFinite(localMs)) return false;
	if (!Number.isFinite(remoteMs)) return true;
	return localMs > remoteMs;
}