/**
 * noteOrderSnapshot.ts
 *
 * Per-workspace localStorage snapshot of note ordering.
 *
 * Purpose: the Yjs registry doc (noteOrder) hydrates from IndexedDB
 * asynchronously. Before it arrives, NoteGrid has no ordered IDs and renders
 * nothing. By persisting the last-known order to localStorage we can seed
 * skeleton cards at the correct positions on the very first render — before
 * any async IDB read completes — making the app feel instant on relaunch.
 *
 * Storage key format: freemannotes.noteOrderSnapshot.v1.<workspaceId>
 * Value: JSON array of note ID strings
 */

const STORAGE_KEY_PREFIX = 'freemannotes.noteOrderSnapshot.v1.';

/**
 * Returns the last-known ordered note IDs for the given workspace.
 * Returns [] if nothing is cached or the stored value is malformed.
 */
export function readNoteOrderSnapshot(workspaceId: string): string[] {
	if (!workspaceId) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY_PREFIX + workspaceId);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return (parsed as unknown[]).filter((v): v is string => typeof v === 'string');
	} catch {
		return [];
	}
}

/**
 * Persists the current note order for the given workspace.
 * Silently swallows storage-quota errors — the snapshot is best-effort.
 */
export function writeNoteOrderSnapshot(workspaceId: string, ids: string[]): void {
	if (!workspaceId || ids.length === 0) return;
	try {
		localStorage.setItem(STORAGE_KEY_PREFIX + workspaceId, JSON.stringify(ids));
	} catch {
		// Quota exceeded — ignore; the snapshot is an optional perf hint.
	}
}

export function moveNoteOrderSnapshotEntry(sourceWorkspaceId: string, targetWorkspaceId: string, noteId: string): void {
	if (!sourceWorkspaceId || !targetWorkspaceId || sourceWorkspaceId === targetWorkspaceId) return;
	const normalizedNoteId = String(noteId || '').trim();
	if (!normalizedNoteId) return;
	const sourceSnapshot = readNoteOrderSnapshot(sourceWorkspaceId).filter((id) => id !== normalizedNoteId);
	const targetSnapshot = readNoteOrderSnapshot(targetWorkspaceId).filter((id) => id !== normalizedNoteId);
	if (sourceSnapshot.length > 0) {
		writeNoteOrderSnapshot(sourceWorkspaceId, sourceSnapshot);
	} else {
		clearNoteOrderSnapshot(sourceWorkspaceId);
	}
	writeNoteOrderSnapshot(targetWorkspaceId, [normalizedNoteId, ...targetSnapshot]);
}

/**
 * Removes the snapshot for the given workspace (e.g. on workspace deletion).
 */
export function clearNoteOrderSnapshot(workspaceId: string): void {
	if (!workspaceId) return;
	try {
		localStorage.removeItem(STORAGE_KEY_PREFIX + workspaceId);
	} catch {
		// Ignore storage errors.
	}
}

