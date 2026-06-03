/**
 * Per-user note banner preferences.
 *
 * Banner image selections follow the same storage model as note colors: they are
 * scoped to the authenticated user, cached locally for instant/offline rendering,
 * and synced through the user-preferences API for cross-device persistence.
 */

import { flushUserPreferences, updateUserPreferences } from './userDevicePreferencesApi';
import { normalizeNoteBannerFile } from './noteBanners';

const STORAGE_KEY_PREFIX = 'fn_note_banner_prefs_v1';

function getStorageKey(userId: string | null): string {
	return `${STORAGE_KEY_PREFIX}:${userId ?? 'guest'}`;
}

function normalizePrefs(raw: unknown): Record<string, string | null> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out: Record<string, string | null> = {};
	for (const [key, value] of Object.entries(raw as object)) {
		if (typeof key !== 'string' || !key || key.length > 120) continue;
		if (value == null || value === '') {
			out[key] = null;
			continue;
		}
		const normalizedValue = normalizeNoteBannerFile(value);
		if (normalizedValue) {
			out[key] = normalizedValue;
		}
	}
	return out;
}

function loadFromStorage(storageKey: string): Record<string, string | null> {
	try {
		if (typeof localStorage === 'undefined') return {};
		const raw = localStorage.getItem(storageKey);
		if (!raw) return {};
		return normalizePrefs(JSON.parse(raw));
	} catch {
		return {};
	}
}

export function readUserNoteBannerPrefsSnapshot(userId: string | null): Record<string, string | null> {
	return loadFromStorage(getStorageKey(userId));
}

let activeStorageKey = getStorageKey(null);
let cache: Record<string, string | null> = loadFromStorage(activeStorageKey);

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

export function setUserNoteBannerPreferenceScope(userId: string | null): void {
	const nextStorageKey = getStorageKey(userId);
	if (nextStorageKey === activeStorageKey) return;
	activeStorageKey = nextStorageKey;
	cache = loadFromStorage(activeStorageKey);
	notifyListeners();
}

export function replaceUserNoteBannerPrefs(nextPrefs: Record<string, string | null>): void {
	cache = normalizePrefs(nextPrefs);
	persist();
	notifyListeners();
}

export function getUserNoteBannerPrefsSnapshot(): Record<string, string | null> {
	return cache;
}

export function getUserNoteBannerFile(noteId: string): string | null {
	const value = cache[noteId];
	return value !== undefined ? value : null;
}

export function hasUserNoteBannerPref(noteId: string): boolean {
	return noteId in cache;
}

export function setUserNoteBannerFile(noteId: string, fileName: string | null): void {
	cache = { ...cache, [noteId]: normalizeNoteBannerFile(fileName) };
	persist();
	notifyListeners();
}

export function saveUserNoteBannerFile(deviceId: string, noteId: string, fileName: string | null): void {
	setUserNoteBannerFile(noteId, fileName);
	void updateUserPreferences(deviceId, {
		noteBannersByNoteId: getUserNoteBannerPrefsSnapshot(),
	}).then((pref) => {
		if (pref) {
			replaceUserNoteBannerPrefs(pref.noteBannersByNoteId as Record<string, string | null>);
		}
	}).catch(() => undefined);
	void flushUserPreferences(deviceId).catch(() => undefined);
}

export function subscribeNoteBannerPrefs(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}