import * as Y from 'yjs';
import { getDeviceId } from './deviceId';
import { setNotePinned } from './noteModel';

const STORAGE_KEY = 'freemannotes.notePinPrefs.v1';

type NotePinPreferenceStore = Record<string, boolean>;

function makeScopeKey(docId: string, userId?: string | null): string {
	const normalizedDocId = String(docId ?? '').trim();
	if (!normalizedDocId) return '';
	const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
	// Shared-note aliases can point at the same note content from different docs,
	// so pin state is keyed by the concrete doc plus the active user/device scope.
	const scope = normalizedUserId ? `user:${normalizedUserId}` : `device:${getDeviceId()}`;
	return `${scope}::${normalizedDocId}`;
}

function loadFromStorage(): NotePinPreferenceStore {
	try {
		if (typeof localStorage === 'undefined') return {};
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const next: NotePinPreferenceStore = {};
		for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (!key || typeof key !== 'string') continue;
			next[key] = Boolean(value);
		}
		return next;
	} catch {
		return {};
	}
}

let cache: NotePinPreferenceStore = loadFromStorage();

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
	const key = makeScopeKey(docId, userId);
	return Boolean(key) && Object.prototype.hasOwnProperty.call(cache, key);
}

export function getUserNotePinned(docId: string, userId?: string | null): boolean {
	const key = makeScopeKey(docId, userId);
	return Boolean(key) && cache[key] === true;
}

export function setUserNotePinned(docId: string, userId: string | null | undefined, pinned: boolean): void {
	const key = makeScopeKey(docId, userId);
	if (!key) return;
	cache = { ...cache, [key]: Boolean(pinned) };
	persist();
	for (const listener of listeners) listener();
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
	pinned: boolean;
}): void {
	setUserNotePinned(args.docId, args.userId, args.pinned);
	const metadata = args.doc.getMap<any>('metadata');
	if (Boolean(metadata.get('isPinned'))) {
		setNotePinned(args.doc, false);
	}
}

export function moveUserNotePinPreference(sourceDocId: string, targetDocId: string, userId?: string | null): void {
	const sourceKey = makeScopeKey(sourceDocId, userId);
	const targetKey = makeScopeKey(targetDocId, userId);
	if (!sourceKey || !targetKey || sourceKey === targetKey) return;
	if (!Object.prototype.hasOwnProperty.call(cache, sourceKey)) return;
	cache = {
		...cache,
		[targetKey]: cache[sourceKey],
	};
	delete cache[sourceKey];
	persist();
	for (const listener of listeners) listener();
}