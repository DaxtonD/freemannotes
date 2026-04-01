import { getDeviceId } from './deviceId';

const STORAGE_KEY = 'freemannotes.noteAutoScrollPrefs.v1';

type NoteAutoScrollPreferenceStore = Record<string, boolean>;

function makeScopeKey(docId: string, userId?: string | null): string {
	const normalizedDocId = String(docId ?? '').trim();
	if (!normalizedDocId) return '';
	const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
	// Signed-in users get per-account note behavior, while draft/offline flows fall
	// back to device scope so preferences still work before authentication exists.
	const scope = normalizedUserId ? `user:${normalizedUserId}` : `device:${getDeviceId()}`;
	return `${scope}::${normalizedDocId}`;
}

function loadFromStorage(): NoteAutoScrollPreferenceStore {
	try {
		if (typeof localStorage === 'undefined') return {};
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const next: NoteAutoScrollPreferenceStore = {};
		for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (!key || typeof key !== 'string') continue;
			next[key] = Boolean(value);
		}
		return next;
	} catch {
		return {};
	}
}

let cache: NoteAutoScrollPreferenceStore = loadFromStorage();

const listeners = new Set<() => void>();

function persist(): void {
	try {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
		}
	} catch {
		// Best effort only.
	}
}

export function getUserNoteAutoScrollEnabled(docId: string, userId?: string | null): boolean {
	const key = makeScopeKey(docId, userId);
	if (!key) return false;
	return cache[key] === true;
}

export function setUserNoteAutoScrollEnabled(docId: string, userId: string | null | undefined, enabled: boolean): void {
	const key = makeScopeKey(docId, userId);
	if (!key) return;
	// Clone-on-write keeps useSyncExternalStore subscribers on a simple immutable map.
	cache = { ...cache, [key]: Boolean(enabled) };
	persist();
	for (const listener of listeners) listener();
}

export function subscribeNoteAutoScrollPrefs(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}