const KEY = 'freemannotes.session-restore.v1';

type Entry = { noteId: string; workspaceId: string };

/**
 * Persist the currently-open note so it can be re-opened if the OS kills
 * and restarts the PWA process (Android/iOS page discard). Pass null/null
 * to clear (note was explicitly closed or user signed out).
 */
export function setSessionRestoreNote(noteId: string | null, workspaceId: string | null): void {
    try {
        if (noteId && workspaceId) {
            localStorage.setItem(KEY, JSON.stringify({ noteId, workspaceId }));
        } else {
            localStorage.removeItem(KEY);
        }
    } catch { /* quota */ }
}

/**
 * Returns the noteId to restore if the stored workspaceId matches the current
 * one, otherwise null. Does not clear the key — the tracking effect that mirrors
 * selectedNoteId handles the key lifecycle.
 */
export function readSessionRestoreNote(currentWorkspaceId: string): string | null {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const entry = JSON.parse(raw) as Entry;
        if (!entry.noteId || entry.workspaceId !== currentWorkspaceId) return null;
        return entry.noteId;
    } catch { return null; }
}

export function clearSessionRestoreNote(): void {
    try { localStorage.removeItem(KEY); } catch { /* */ }
}
