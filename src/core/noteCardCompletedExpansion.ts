import { getDeviceId } from './deviceId';

// Note-card checklist expansion is intentionally device-local first. The server
// preference still syncs across sessions, but a reload/offline restart on the
// same device should restore immediately from local storage.

const completedExpandedByNoteId = new Map<string, boolean>();
let hydratedFromLocalCache = false;

function getStorageKey(): string {
	return `freemannotes.noteCardCompletedExpanded.v1:${getDeviceId()}`;
}

function readLocalCache(): Record<string, boolean> {
	if (typeof window === 'undefined') return {};
	try {
		const raw = window.localStorage.getItem(getStorageKey());
		if (!raw) return {};
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const next: Record<string, boolean> = {};
		for (const [noteId, expanded] of Object.entries(parsed || {})) {
			if (!noteId) continue;
			next[noteId] = Boolean(expanded);
		}
		return next;
	} catch {
		return {};
	}
}

function writeLocalCache(): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(getStorageKey(), JSON.stringify(Object.fromEntries(completedExpandedByNoteId.entries())));
	} catch {
		// Best effort only.
	}
}

function ensureHydratedFromLocalCache(): void {
	if (hydratedFromLocalCache) return;
	hydratedFromLocalCache = true;
	completedExpandedByNoteId.clear();
	for (const [noteId, expanded] of Object.entries(readLocalCache())) {
		completedExpandedByNoteId.set(noteId, expanded);
	}
}

export function seedNoteCardCompletedExpandedByNoteId(seed: Record<string, boolean>): void {
	ensureHydratedFromLocalCache();
	const merged = new Map<string, boolean>();
	for (const [noteId, expanded] of Object.entries(seed || {})) {
		if (!noteId) continue;
		merged.set(noteId, Boolean(expanded));
	}
	// Keep local device choices authoritative when a later server hydration arrives.
	for (const [noteId, expanded] of completedExpandedByNoteId.entries()) {
		merged.set(noteId, expanded);
	}
	completedExpandedByNoteId.clear();
	for (const [noteId, expanded] of merged.entries()) {
		completedExpandedByNoteId.set(noteId, expanded);
	}
	writeLocalCache();
}

export function getNoteCardCompletedExpanded(noteId: string): boolean {
	ensureHydratedFromLocalCache();
	return completedExpandedByNoteId.get(noteId) ?? false;
}

export function setNoteCardCompletedExpanded(noteId: string, expanded: boolean): void {
	ensureHydratedFromLocalCache();
	completedExpandedByNoteId.set(noteId, Boolean(expanded));
	writeLocalCache();
}
