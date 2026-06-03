export const MIN_FONT_SCALE = 0.60;
export const MAX_FONT_SCALE = 1.5;
export const MIN_NOTE_CARD_HEIGHT_PX = 320;
export const MAX_NOTE_CARD_HEIGHT_PX = 1400;

export type EditorToolbarMode = 'full' | 'condensed';

const STORAGE_KEY = 'freemannotes.deviceAppearancePreferences.v2';
const LEGACY_STORAGE_KEY = 'freemannotes.deviceAppearancePreferences.v1';

export type NoteCardBannerTitlePosition = 'above' | 'below';

export type CachedDeviceAppearancePreferences = {
	userId: string | null;
	deviceId: string;
	noteCardFontScale: number;
	noteEditorFontScale: number;
	editorToolbarMode: EditorToolbarMode;
	noteCardMaxHeightPx: number;
	noteCardBannerTitlePosition: NoteCardBannerTitlePosition;
	checklistShowCompleted: boolean;
	quickDeleteChecklist: boolean;
	noteCardClickOpens: boolean;
	noteCardCheckboxInteractions: boolean;
	noteCardLinkInteractions: boolean;
	noteCardCompletedInteractions: boolean;
	updatedAt: string;
};

type CachedDevicePreferenceStore = {
	entries: Record<string, CachedDeviceAppearancePreferences>;
};

export function clampFontScale(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, value));
}

export function getDefaultNoteCardMaxHeightPx(): number {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 920;
	return window.matchMedia('(pointer: coarse)').matches ? 480 : 920;
}

/** Returns the default note-card font scale for this device type. */
export function getDefaultNoteCardFontScale(): number {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 1;
	return window.matchMedia('(pointer: coarse)').matches ? 0.75 : 1;
}

/** Returns the default note-editor font scale for this device type. */
export function getDefaultNoteEditorFontScale(): number {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 1;
	return window.matchMedia('(pointer: coarse)').matches ? 0.80 : 1;
}

export function clampNoteCardMaxHeightPx(value: number): number {
	if (!Number.isFinite(value)) return getDefaultNoteCardMaxHeightPx();
	return Math.round(Math.min(MAX_NOTE_CARD_HEIGHT_PX, Math.max(MIN_NOTE_CARD_HEIGHT_PX, value)));
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
	if (typeof value === 'boolean') return value;
	return fallback;
}

export function normalizeEditorToolbarMode(value: unknown): EditorToolbarMode {
	return value === 'condensed' ? 'condensed' : 'full';
}

export function getDefaultNoteCardBannerTitlePosition(): NoteCardBannerTitlePosition {
	return 'above';
}

export function normalizeNoteCardBannerTitlePosition(value: unknown): NoteCardBannerTitlePosition {
	return value === 'below' ? 'below' : 'above';
}

function normalizeSnapshot(value: Partial<CachedDeviceAppearancePreferences> | null | undefined): CachedDeviceAppearancePreferences | null {
	if (!value || typeof value !== 'object') return null;
	if (typeof value.deviceId !== 'string' || !value.deviceId) return null;
	return {
		userId: typeof value.userId === 'string' && value.userId.trim().length > 0 ? value.userId : null,
		deviceId: value.deviceId,
		noteCardFontScale: clampFontScale(Number(value.noteCardFontScale)),
		noteEditorFontScale: clampFontScale(Number(value.noteEditorFontScale)),
		editorToolbarMode: normalizeEditorToolbarMode(value.editorToolbarMode),
		noteCardMaxHeightPx: clampNoteCardMaxHeightPx(Number(value.noteCardMaxHeightPx)),
		noteCardBannerTitlePosition: normalizeNoteCardBannerTitlePosition(value.noteCardBannerTitlePosition),
		checklistShowCompleted: normalizeBoolean(value.checklistShowCompleted, false),
		quickDeleteChecklist: normalizeBoolean(value.quickDeleteChecklist, false),
		noteCardClickOpens: normalizeBoolean(value.noteCardClickOpens, true),
		noteCardCheckboxInteractions: normalizeBoolean(value.noteCardCheckboxInteractions, normalizeBoolean(value.noteCardClickOpens, true)),
		noteCardLinkInteractions: normalizeBoolean(value.noteCardLinkInteractions, normalizeBoolean(value.noteCardClickOpens, true)),
		noteCardCompletedInteractions: normalizeBoolean(value.noteCardCompletedInteractions, normalizeBoolean(value.noteCardClickOpens, true)),
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
	};
}

function makeEntryKey(deviceId: string, userId?: string | null): string {
	return `${userId ?? ''}::${deviceId}`;
}

function readRawStore(): CachedDevicePreferenceStore | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<CachedDevicePreferenceStore> | null;
		if (!parsed || typeof parsed !== 'object') return null;
		const rawEntries = parsed.entries;
		if (!rawEntries || typeof rawEntries !== 'object') return null;
		const entries: Record<string, CachedDeviceAppearancePreferences> = {};
		for (const [key, candidate] of Object.entries(rawEntries)) {
			const snapshot = normalizeSnapshot(candidate as Partial<CachedDeviceAppearancePreferences>);
			if (!snapshot) continue;
			entries[key] = snapshot;
		}
		return { entries };
	} catch {
		return null;
	}
}

function readLegacySnapshot(deviceId: string): CachedDeviceAppearancePreferences | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<CachedDeviceAppearancePreferences> | null;
		if (!parsed || typeof parsed !== 'object') return null;
		if (typeof parsed.deviceId !== 'string' || parsed.deviceId !== deviceId) return null;
		return {
			userId: null,
			deviceId,
			noteCardFontScale: clampFontScale(Number(parsed.noteCardFontScale)),
			noteEditorFontScale: clampFontScale(Number(parsed.noteEditorFontScale)),
			editorToolbarMode: 'full',
			noteCardMaxHeightPx: clampNoteCardMaxHeightPx(Number(parsed.noteCardMaxHeightPx)),
			noteCardBannerTitlePosition: getDefaultNoteCardBannerTitlePosition(),
			checklistShowCompleted: false,
			quickDeleteChecklist: false,
			noteCardClickOpens: true,
			noteCardCheckboxInteractions: true,
			noteCardLinkInteractions: true,
			noteCardCompletedInteractions: true,
			updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
		};
	} catch {
		return null;
	}
}

export function readCachedDeviceAppearancePreferences(deviceId: string, userId?: string | null): CachedDeviceAppearancePreferences | null {
	const store = readRawStore();
	const entry = store?.entries[makeEntryKey(deviceId, userId)] ?? null;
	if (entry) return entry;
	return readLegacySnapshot(deviceId);
}

export function writeCachedDeviceAppearancePreferences(snapshot: CachedDeviceAppearancePreferences): void {
	if (typeof window === 'undefined') return;
	try {
		const normalized = normalizeSnapshot(snapshot);
		if (!normalized) return;
		const existing = readRawStore();
		const nextEntries = { ...(existing?.entries ?? {}) };
		nextEntries[makeEntryKey(normalized.deviceId, normalized.userId)] = normalized;
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ entries: nextEntries })
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