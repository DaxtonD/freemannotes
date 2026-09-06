import { getDeviceId } from './deviceId';

// Note-card checklist expansion is intentionally device-local first. The server
// preference still syncs across sessions, but a reload/offline restart on the
// same device should restore immediately from local storage.

const completedExpandedByNoteId = new Map<string, boolean>();
let hydratedFromLocalCache = false;

// Unlike its sibling per-user preference modules (noteColorPreferences.ts,
// notePinPreferences.ts), this store used to have no subscription mechanism at
// all — an already-mounted NoteCard could only ever pick up a cross-device
// server seed via a one-shot mount effect, racing the real network fetch that
// delivers it. If the fetch lost that race, the card's expand state was never
// corrected for the rest of that session, not just "late" — visible as
// completed-item dropdowns that occasionally never expand to match another
// device until a hard reload. Matching the established pattern closes the gap.
const listeners = new Set<() => void>();

function notifyListeners(): void {
	for (const listener of listeners) listener();
}

/** Subscribe to any change in device-local checklist expand/collapse state
 *  (local toggle or a merged-in server seed). Returns an unsubscribe function. */
export function subscribeNoteCardCompletedExpansion(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getStorageKey(): string {
	return `freemannotes.noteCardCompletedExpanded.v1:${getDeviceId()}`;
}

// notifyListeners() above only reaches subscribers within THIS tab's JS context —
// it says nothing to a second tab open on the same device, which has its own
// separate module instance of this whole file. The browser's own `storage` event
// is the standard bridge for exactly this: it fires in every OTHER same-origin tab
// (never the one that wrote it) whenever localStorage changes. Re-hydrate from
// disk and notify local subscribers so a toggle in tab 1 reaches an already-open
// tab 2 without needing a manual refresh there.
if (typeof window !== 'undefined') {
	window.addEventListener('storage', (event: StorageEvent) => {
		if (event.key !== null && event.key !== getStorageKey()) return;
		hydratedFromLocalCache = false;
		ensureHydratedFromLocalCache();
		notifyListeners();
	});
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
	notifyListeners();
}

export function getNoteCardCompletedExpanded(noteId: string): boolean {
	ensureHydratedFromLocalCache();
	return completedExpandedByNoteId.get(noteId) ?? false;
}

export function setNoteCardCompletedExpanded(noteId: string, expanded: boolean): void {
	ensureHydratedFromLocalCache();
	completedExpandedByNoteId.set(noteId, Boolean(expanded));
	writeLocalCache();
	notifyListeners();
}
