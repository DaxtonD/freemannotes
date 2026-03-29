/**
 * Per-user, per-device note color preferences.
 *
 * Colors are intentionally stored in localStorage rather than the shared Yjs
 * note doc so that color choices are private to each user and device. Writing
 * to the shared doc would broadcast color changes to all collaborators, which
 * is not the desired behavior.
 *
 * Legacy color tokens already stored in a note's Yjs metadata are still
 * visible as a fallback so existing colors aren't immediately lost, but new
 * writes always go here instead of to the Yjs doc.
 */

import type { NoteColorToken } from './noteColors';

const STORAGE_KEY = 'fn_note_color_prefs_v1';

function loadFromStorage(): Record<string, NoteColorToken | null> {
	try {
		if (typeof localStorage === 'undefined') return {};
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const out: Record<string, NoteColorToken | null> = {};
		for (const [k, v] of Object.entries(parsed as object)) {
			if (!k || typeof k !== 'string') continue;
			out[k] = (typeof v === 'string' && v) ? (v as NoteColorToken) : null;
		}
		return out;
	} catch {
		return {};
	}
}

let cache: Record<string, NoteColorToken | null> = loadFromStorage();

const listeners = new Set<() => void>();

function persist(): void {
	try {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
		}
	} catch {
		// Ignore storage quota or security errors.
	}
}

/** Returns the locally-stored color preference for a note, or null if unset. */
export function getUserNoteColorToken(noteId: string): NoteColorToken | null {
	const value = cache[noteId];
	return value !== undefined ? value : null;
}

/** Returns true if the user has explicitly set (or cleared) a color preference for this note. */
export function hasUserNoteColorPref(noteId: string): boolean {
	return noteId in cache;
}

/** Persists the user's color preference for a note. Pass null to clear the color. */
export function setUserNoteColorToken(noteId: string, token: NoteColorToken | null): void {
	cache = { ...cache, [noteId]: token };
	persist();
	for (const listener of listeners) listener();
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
