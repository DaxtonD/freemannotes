const KEY = 'freemannotes.session-restore.v1';

type Entry = { noteId: string; workspaceId: string; documentId?: string };

export type SessionRestoreEntry = { noteId: string; documentId: string | null };

/**
 * Persist the currently-open note (and the document open on top of it, if any) so both can be
 * re-opened if the OS kills and restarts the PWA process (Android/iOS page discard). Pass a
 * null noteId to clear (note was explicitly closed or user signed out).
 *
 * Note that the caller has to hold off on this until the restore attempt below has run — a cold
 * boot starts with no note selected, so writing unconditionally wipes the entry we're about to
 * read. That is exactly how this whole mechanism sat dead from the day it was written.
 */
export function setSessionRestoreNote(noteId: string | null, workspaceId: string | null, documentId?: string | null): void {
    try {
        if (noteId && workspaceId) {
            const entry: Entry = { noteId, workspaceId };
            if (documentId) entry.documentId = documentId;
            localStorage.setItem(KEY, JSON.stringify(entry));
        } else {
            localStorage.removeItem(KEY);
        }
    } catch { /* quota */ }
}

/**
 * Returns what to restore if the stored workspaceId matches the current one, otherwise null.
 * Does not clear the key — the tracking effect that mirrors selectedNoteId owns its lifecycle.
 */
export function readSessionRestoreNote(currentWorkspaceId: string): SessionRestoreEntry | null {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const entry = JSON.parse(raw) as Entry;
        if (!entry.noteId || entry.workspaceId !== currentWorkspaceId) return null;
        return { noteId: entry.noteId, documentId: entry.documentId || null };
    } catch { return null; }
}

export function clearSessionRestoreNote(): void {
    try { localStorage.removeItem(KEY); } catch { /* */ }
}
