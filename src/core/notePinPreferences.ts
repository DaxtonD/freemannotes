import * as Y from 'yjs';
import { getDeviceId } from './deviceId';
import { flushUserPreferences, updateUserPreferences } from './userDevicePreferencesApi';
import { setNotePinned } from './noteModel';

const LEGACY_STORAGE_KEY = 'freemannotes.notePinPrefs.v1';
const STORAGE_KEY_PREFIX = 'fn_note_pin_prefs_v2';

type NotePinPreferenceStore = Record<string, boolean>;

function getStorageKey(userId: string | null): string {
	return `${STORAGE_KEY_PREFIX}:${userId ?? `guest:${getDeviceId()}`}`;
}

function normalizePrefs(raw: unknown): NotePinPreferenceStore {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const next: NotePinPreferenceStore = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof key !== 'string' || !key || key.length > 160) continue;
		if (typeof value === 'boolean') {
			next[key] = value;
		}
	}
	return next;
}

function notePinPrefsEqual(left: NotePinPreferenceStore, right: NotePinPreferenceStore): boolean {
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) return false;
	for (const key of leftKeys) {
		if (left[key] !== right[key]) return false;
	}
	return true;
}

function loadLegacyPrefs(userId: string | null): NotePinPreferenceStore {
	try {
		if (typeof localStorage === 'undefined') return {};
		const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
		if (!raw) return {};
		const next: NotePinPreferenceStore = {};
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const prefix = userId ? `user:${userId}::` : `device:${getDeviceId()}::`;
		for (const [key, value] of Object.entries(parsed)) {
			if (!key.startsWith(prefix) || typeof value !== 'boolean') continue;
			const docId = key.slice(prefix.length).trim();
			if (!docId) continue;
			next[docId] = value;
		}
		return next;
	} catch {
		return {};
	}
}

function loadFromStorage(storageKey: string, userId: string | null): NotePinPreferenceStore {
	try {
		if (typeof localStorage === 'undefined') return {};
		const raw = localStorage.getItem(storageKey);
		if (raw) return normalizePrefs(JSON.parse(raw));
		const migrated = loadLegacyPrefs(userId);
		if (Object.keys(migrated).length > 0) {
			localStorage.setItem(storageKey, JSON.stringify(migrated));
		}
		return migrated;
	} catch {
		return {};
	}
}

let activeStorageKey = getStorageKey(null);
let cache: NotePinPreferenceStore = loadFromStorage(activeStorageKey, null);

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
		// Best effort only.
	}
}

export function setUserNotePinPreferenceScope(userId: string | null): void {
	const nextStorageKey = getStorageKey(userId);
	if (nextStorageKey === activeStorageKey) return;
	activeStorageKey = nextStorageKey;
	cache = loadFromStorage(activeStorageKey, userId);
	notifyListeners();
}

export function replaceUserNotePinPrefs(nextPrefs: NotePinPreferenceStore): void {
	const normalized = normalizePrefs(nextPrefs);
	// POST /preferences responses that omit notePinsByDocId used to arrive as {} and
	// wipe optimistic local pins, flashing every thumbtack badge off then on.
	if (Object.keys(normalized).length === 0 && Object.keys(cache).length > 0) return;
	if (notePinPrefsEqual(cache, normalized)) return;
	cache = normalized;
	persist();
	notifyListeners();
}

export function getNotePinPrefsSnapshot(): NotePinPreferenceStore {
	return cache;
}

export function subscribeNotePinPrefs(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function hasUserNotePinPref(docId: string, userId?: string | null): boolean {
	void userId;
	const normalizedDocId = String(docId ?? '').trim();
	return Boolean(normalizedDocId) && Object.prototype.hasOwnProperty.call(cache, normalizedDocId);
}

export function getUserNotePinned(docId: string, userId?: string | null): boolean {
	void userId;
	const normalizedDocId = String(docId ?? '').trim();
	return Boolean(normalizedDocId) && cache[normalizedDocId] === true;
}

export function setUserNotePinned(docId: string, userId: string | null | undefined, pinned: boolean): void {
	void userId;
	const normalizedDocId = String(docId ?? '').trim();
	if (!normalizedDocId) return;
	cache = { ...cache, [normalizedDocId]: Boolean(pinned) };
	persist();
	notifyListeners();
}

function syncUserNotePins(deviceId: string, docId: string, pinned: boolean): void {
	setUserNotePinned(docId, null, pinned);
	void updateUserPreferences(deviceId, {
		notePinsByDocId: getNotePinPrefsSnapshot(),
	}).then((pref) => {
		if (pref?.notePinsByDocId) {
			replaceUserNotePinPrefs(pref.notePinsByDocId);
		}
	}).catch(() => undefined);
	void flushUserPreferences(deviceId).catch(() => undefined);
}

export function isSharedPinnedAliasDoc(docId: string, noteId: string): boolean {
	const normalizedDocId = String(docId || '').trim();
	const normalizedNoteId = String(noteId || '').trim();
	if (!normalizedDocId || !normalizedNoteId) return false;
	return !normalizedDocId.endsWith(`:${normalizedNoteId}`);
}

export function resolveUserNotePinned(args: {
	docId: string;
	noteId: string;
	userId?: string | null;
	legacyPinned?: boolean;
}): boolean {
	if (hasUserNotePinPref(args.docId, args.userId)) {
		return getUserNotePinned(args.docId, args.userId);
	}
	// Alias docs should not inherit the source note's global pinned bit; only the
	// original workspace note keeps that legacy fallback behavior.
	return isSharedPinnedAliasDoc(args.docId, args.noteId) ? false : args.legacyPinned === true;
}

export function setUserNotePinnedOnDoc(args: {
	doc: Y.Doc;
	docId: string;
	noteId: string;
	userId?: string | null;
	deviceId?: string | null;
	pinned: boolean;
}): void {
	if (args.userId && args.deviceId) {
		syncUserNotePins(args.deviceId, args.docId, args.pinned);
	} else {
		setUserNotePinned(args.docId, args.userId, args.pinned);
	}
	const metadata = args.doc.getMap<any>('metadata');
	if (Boolean(metadata.get('isPinned'))) {
		setNotePinned(args.doc, false);
	}
}

export function moveUserNotePinPreference(sourceDocId: string, targetDocId: string, userId?: string | null, deviceId?: string | null): void {
	void userId;
	const sourceKey = String(sourceDocId ?? '').trim();
	const targetKey = String(targetDocId ?? '').trim();
	if (!sourceKey || !targetKey || sourceKey === targetKey) return;
	if (!Object.prototype.hasOwnProperty.call(cache, sourceKey)) return;
	cache = {
		...cache,
		[targetKey]: cache[sourceKey],
	};
	delete cache[sourceKey];
	persist();
	notifyListeners();
	if (userId && deviceId) {
		void updateUserPreferences(deviceId, {
			notePinsByDocId: getNotePinPrefsSnapshot(),
		}).then((pref) => {
			if (pref?.notePinsByDocId) {
				replaceUserNotePinPrefs(pref.notePinsByDocId);
			}
		}).catch(() => undefined);
		void flushUserPreferences(deviceId).catch(() => undefined);
	}
}