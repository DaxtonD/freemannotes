/**
 * Per-user note color preferences.
 *
 * Colors are stored in the authenticated user's preference payload so they can
 * sync across that user's devices without leaking to collaborators. localStorage
 * keeps a scoped local cache for instant rendering and offline continuity.
 *
 * Legacy color tokens already stored in a note's shared Yjs metadata remain a
 * fallback only when the user has never set or cleared their own override.
 */

import { flushUserPreferences, updateUserPreferences } from './userDevicePreferencesApi';
import { NOTE_COLOR_TOKENS, type NoteColorToken } from './noteColors';

const LEGACY_STORAGE_KEY = 'fn_note_color_prefs_v1';
const STORAGE_KEY_PREFIX = 'fn_note_color_prefs_v2';
const VALID_NOTE_COLOR_TOKENS = new Set<NoteColorToken>(NOTE_COLOR_TOKENS.map((token) => token.id));

function getStorageKey(userId: string | null): string {
	return `${STORAGE_KEY_PREFIX}:${userId ?? 'guest'}`;
}

function normalizePrefs(raw: unknown): Record<string, NoteColorToken | null> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out: Record<string, NoteColorToken | null> = {};
	for (const [key, value] of Object.entries(raw as object)) {
		if (typeof key !== 'string' || !key || key.length > 120) continue;
		if (value == null || value === '') {
			out[key] = null;
			continue;
		}
		if (typeof value === 'string' && VALID_NOTE_COLOR_TOKENS.has(value as NoteColorToken)) {
			out[key] = value as NoteColorToken;
		}
	}
	return out;
}

function loadFromStorage(storageKey: string, includeLegacyFallback: boolean): Record<string, NoteColorToken | null> {
	try {
		if (typeof localStorage === 'undefined') return {};
		const raw = localStorage.getItem(storageKey);
		if (raw) return normalizePrefs(JSON.parse(raw));
		if (!includeLegacyFallback) return {};
		const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
		if (!legacyRaw) return {};
		const migrated = normalizePrefs(JSON.parse(legacyRaw));
		localStorage.setItem(storageKey, JSON.stringify(migrated));
		localStorage.removeItem(LEGACY_STORAGE_KEY);
		return migrated;
	} catch {
		return {};
	}
}

let activeStorageKey = getStorageKey(null);
let cache: Record<string, NoteColorToken | null> = loadFromStorage(activeStorageKey, true);

const listeners = new Set<() => void>();

function notifyListeners(): void {
	for (const listener of listeners) listener();
}

function persist(): void {
	try {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(activeStorageKey, JSON.stringify(cache));
		}
	} catch {
		// Ignore storage quota or security errors.
	}
}

export function setUserNoteColorPreferenceScope(userId: string | null): void {
	const nextStorageKey = getStorageKey(userId);
	if (nextStorageKey === activeStorageKey) return;
	activeStorageKey = nextStorageKey;
	cache = loadFromStorage(activeStorageKey, true);
	notifyListeners();
}

export function replaceUserNoteColorPrefs(nextPrefs: Record<string, NoteColorToken | null>): void {
	cache = normalizePrefs(nextPrefs);
	persist();
	notifyListeners();
}

export function getUserNoteColorPrefsSnapshot(): Record<string, NoteColorToken | null> {
	return cache;
}

/** Returns the locally-stored color preference for a note, or null if unset/cleared. */
export function getUserNoteColorToken(noteId: string): NoteColorToken | null {
	const value = cache[noteId];
	return value !== undefined ? value : null;
}

/** Returns true if the user has explicitly set or cleared a color preference for this note. */
export function hasUserNoteColorPref(noteId: string): boolean {
	return noteId in cache;
}

/** Updates the scoped local cache immediately. Pass null to clear the color for this user. */
export function setUserNoteColorToken(noteId: string, token: NoteColorToken | null): void {
	cache = { ...cache, [noteId]: token };
	persist();
	notifyListeners();
}

/** Saves the user's note color preference and pushes it to the user-preferences API. */
export function saveUserNoteColorToken(deviceId: string, noteId: string, token: NoteColorToken | null): void {
	setUserNoteColorToken(noteId, token);
	void updateUserPreferences(deviceId, {
		noteColorsByNoteId: getUserNoteColorPrefsSnapshot(),
	}).then((pref) => {
		if (pref) {
			replaceUserNoteColorPrefs(pref.noteColorsByNoteId as Record<string, NoteColorToken | null>);
		}
	}).catch(() => undefined);
	void flushUserPreferences(deviceId).catch(() => undefined);
}

/**
 * Subscribe to any change in the local color preferences store.
 * Returns an unsubscribe function compatible with React.useSyncExternalStore.
 */
export function subscribeNoteColorPrefs(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
