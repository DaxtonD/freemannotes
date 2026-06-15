import { flushUserPreferences, updateUserPreferences } from './userDevicePreferencesApi';

const STORAGE_KEY_PREFIX = 'freemannotes.collapsibleHeadingPrefs.v1';

function makeStorageKey(userId: string | null, deviceId: string | null): string {
	return `${STORAGE_KEY_PREFIX}:${userId ?? 'guest'}::${deviceId ?? 'unknown'}`;
}

function normalizePrefs(raw: unknown): Record<string, boolean> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const next: Record<string, boolean> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof key !== 'string' || !key || key.length > 200) continue;
		if (value === true) next[key] = true;
	}
	return next;
}

function loadFromStorage(storageKey: string): Record<string, boolean> {
	try {
		if (typeof localStorage === 'undefined') return {};
		const raw = localStorage.getItem(storageKey);
		if (!raw) return {};
		return normalizePrefs(JSON.parse(raw));
	} catch {
		return {};
	}
}

let activeStorageKey = makeStorageKey(null, null);
let cache: Record<string, boolean> = loadFromStorage(activeStorageKey);
const listeners = new Set<() => void>();
const listenersByNoteId = new Map<string, Set<() => void>>();
const notePrefVersionByNoteId = new Map<string, number>();

function extractNoteIdFromPrefKey(key: string): string | null {
	const separatorIndex = key.indexOf('::');
	if (separatorIndex <= 0) return null;
	return key.slice(0, separatorIndex);
}

function collectNoteIdsFromPrefKeys(keys: Iterable<string>): Set<string> {
	const noteIds = new Set<string>();
	for (const key of keys) {
		const noteId = extractNoteIdFromPrefKey(key);
		if (noteId) noteIds.add(noteId);
	}
	return noteIds;
}

function bumpNotePrefVersion(noteId: string): void {
	notePrefVersionByNoteId.set(noteId, (notePrefVersionByNoteId.get(noteId) ?? 0) + 1);
}

function resetAllNotePrefVersions(): void {
	notePrefVersionByNoteId.clear();
}

function persist(): void {
	try {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(activeStorageKey, JSON.stringify(cache));
	} catch {
		// Best effort only.
	}
}

function notifyGlobalListeners(): void {
	for (const listener of listeners) listener();
}

function notifyScopedListenersForNote(noteId: string): void {
	const scopedListeners = listenersByNoteId.get(noteId);
	if (!scopedListeners) return;
	for (const listener of scopedListeners) listener();
}

function notifyAllScopedListeners(): void {
	for (const scopedListeners of listenersByNoteId.values()) {
		for (const listener of scopedListeners) listener();
	}
}

function notifyListenersOnPrefChange(changedNoteId?: string): void {
	notifyGlobalListeners();
	if (changedNoteId) notifyScopedListenersForNote(changedNoteId);
}

function dispatchHeadingToggleEvent(noteId: string, collapsed: boolean): void {
	if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
	window.dispatchEvent(new CustomEvent('freemannotes:rich-heading-toggle', {
		detail: { noteId, collapsed },
	}));
}

export function setCollapsibleHeadingPreferenceScope(userId: string | null, deviceId: string | null): void {
	const nextStorageKey = makeStorageKey(userId, deviceId);
	if (nextStorageKey === activeStorageKey) return;
	activeStorageKey = nextStorageKey;
	cache = loadFromStorage(activeStorageKey);
	resetAllNotePrefVersions();
	notifyAllPrefListeners();
}

function notifyAllPrefListeners(): void {
	notifyGlobalListeners();
	notifyAllScopedListeners();
}

export function replaceCollapsedRichHeadingPrefs(nextPrefs: Record<string, boolean>): void {
	const previousKeys = new Set(Object.keys(cache));
	const nextCache = normalizePrefs(nextPrefs);
	const nextKeys = new Set(Object.keys(nextCache));
	const changedKeys = new Set<string>();
	for (const key of previousKeys) {
		if (!nextKeys.has(key)) changedKeys.add(key);
	}
	for (const key of nextKeys) {
		if (!previousKeys.has(key)) changedKeys.add(key);
	}
	cache = nextCache;
	persist();
	const changedNoteIds = collectNoteIdsFromPrefKeys(changedKeys);
	for (const noteId of changedNoteIds) {
		bumpNotePrefVersion(noteId);
	}
	notifyGlobalListeners();
	for (const noteId of changedNoteIds) {
		notifyScopedListenersForNote(noteId);
	}
}

export function getCollapsedRichHeadingPrefsSnapshot(): Record<string, boolean> {
	return cache;
}

export function makeCollapsedRichHeadingKey(noteId: string, collapseId: string): string {
	return `${noteId}::${collapseId}`;
}

export function getRichHeadingCollapsed(noteId: string, collapseId: string | null | undefined): boolean {
	if (!collapseId) return false;
	return cache[makeCollapsedRichHeadingKey(noteId, collapseId)] === true;
}

export function setRichHeadingCollapsed(noteId: string, collapseId: string | null | undefined, collapsed: boolean): void {
	if (!collapseId) return;
	const key = makeCollapsedRichHeadingKey(noteId, collapseId);
	if (collapsed) {
		cache = { ...cache, [key]: true };
	} else if (key in cache) {
		const next = { ...cache };
		delete next[key];
		cache = next;
	} else {
		return;
	}
	persist();
	bumpNotePrefVersion(noteId);
	notifyListenersOnPrefChange(noteId);
	dispatchHeadingToggleEvent(noteId, collapsed);
}

export function saveRichHeadingCollapsed(
	deviceId: string,
	noteId: string,
	collapseId: string | null | undefined,
	collapsed: boolean,
): void {
	if (!collapseId) return;
	setRichHeadingCollapsed(noteId, collapseId, collapsed);
	void updateUserPreferences(deviceId, {
		collapsedRichHeadingIds: getCollapsedRichHeadingPrefsSnapshot(),
	})
		.then((pref) => {
			if (pref) replaceCollapsedRichHeadingPrefs(pref.collapsedRichHeadingIds || {});
		})
		.catch(() => undefined);
	void flushUserPreferences(deviceId).catch(() => undefined);
}

export function subscribeCollapsedRichHeadingPrefs(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function subscribeCollapsedRichHeadingPrefsForNote(noteId: string, listener: () => void): () => void {
	let scopedListeners = listenersByNoteId.get(noteId);
	if (!scopedListeners) {
		scopedListeners = new Set();
		listenersByNoteId.set(noteId, scopedListeners);
	}
	scopedListeners.add(listener);
	return () => {
		scopedListeners?.delete(listener);
		if (scopedListeners && scopedListeners.size === 0) {
			listenersByNoteId.delete(noteId);
		}
	};
}

export function getCollapsedRichHeadingPrefsForNoteVersion(noteId: string): number {
	return notePrefVersionByNoteId.get(noteId) ?? 0;
}