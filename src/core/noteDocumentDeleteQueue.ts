/**
 * Ask the server to permanently delete a note's persisted document — and don't forget if it fails.
 *
 * ## Why this exists
 *
 * `DocumentManager.permanentlyDeleteNote()` removed the note from the registry and destroyed the
 * **local** Yjs document, and that was all it ever did. Nothing told the server. Measured on a
 * real dev database: **135 of 311 document rows belonged to no registry at all** — 72 of them
 * with genuine content (including a 1 MB note), the rest drafts that were opened, persisted and
 * then cancelled.
 *
 * The user's report was "I can't find this note, it's not in the grid or the trash, but search
 * finds it and I can edit it". All three of those follow from one fact: the grid renders from the
 * registry's `noteOrder`, while `/api/search` queries the document table directly. Delete the
 * registry entry without deleting the row and the note becomes exactly that — invisible but
 * present.
 *
 * Note the asymmetry this closes. The SCHEDULED trash cleanup (`server/trashCleanup.js`) always
 * deleted the row properly. Only the client-initiated paths leaked: emptying the trash by hand,
 * deleting a note outright, discarding a draft. They leaked because there was no server call for
 * them to make.
 *
 * ## Why a queue rather than a bare fetch
 *
 * The old discard path was `permanentlyDeleteNote(id).catch(() => undefined)` — a swallowed
 * failure with no retry. Adding a network call with the same handling would just move the leak
 * rather than fix it: offline, or a timeout, and the row survives with nobody left to care.
 * Deleting is idempotent server-side (an already-absent row answers 200), so replaying is always
 * safe, which makes a queue the obvious shape.
 *
 * Deliberately NOT placed in DocumentManager. That file makes no network calls at all, and
 * keeping it that way is worth more than the convenience of centralising this inside it.
 */

import { fetchJsonWithTimeout } from './network';

const STORAGE_PREFIX = 'freemannotes.noteDocumentDeletes.v1';

type PendingDelete = {
	workspaceId: string;
	noteId: string;
	queuedAt: number;
};

function storageKey(userId: string | null | undefined): string | null {
	const id = String(userId || '').trim();
	return id ? `${STORAGE_PREFIX}:${id}` : null;
}

function read(userId: string | null | undefined): PendingDelete[] {
	const key = storageKey(userId);
	if (!key || typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry): entry is PendingDelete =>
			Boolean(entry)
			&& typeof (entry as PendingDelete).workspaceId === 'string'
			&& typeof (entry as PendingDelete).noteId === 'string'
			&& (entry as PendingDelete).workspaceId.length > 0
			&& (entry as PendingDelete).noteId.length > 0
		);
	} catch {
		return [];
	}
}

function write(userId: string | null | undefined, entries: readonly PendingDelete[]): void {
	const key = storageKey(userId);
	if (!key || typeof localStorage === 'undefined') return;
	try {
		if (entries.length === 0) localStorage.removeItem(key);
		else localStorage.setItem(key, JSON.stringify(entries));
	} catch {
		// Best effort. A lost queue entry costs one leaked row, which the dev-tools cleanup
		// can still collect — it does not cost the user any data.
	}
}

const DELETE_TIMEOUT_MS = 10_000;

async function sendDelete(_workspaceId: string, noteId: string): Promise<void> {
	// The server scopes the delete to the session's workspace and re-derives the namespaced
	// docId itself, so the workspaceId is carried in the queue only to keep entries
	// unambiguous across a workspace switch.
	await fetchJsonWithTimeout(`/api/notes/${encodeURIComponent(noteId)}/document`, {
		method: 'DELETE',
		credentials: 'include',
		timeoutMs: DELETE_TIMEOUT_MS,
		requestName: 'delete-note-document',
	});
}

/**
 * Delete the server's copy of a note document, queueing for replay if that fails.
 *
 * Never throws: the caller has already destroyed the local note and cannot usefully undo that,
 * so a failure here has to become a retry rather than an error.
 */
export async function deleteNoteDocumentOnServer(args: {
	userId: string | null | undefined;
	workspaceId: string | null | undefined;
	noteId: string;
}): Promise<void> {
	const noteId = String(args.noteId || '').trim();
	const workspaceId = String(args.workspaceId || '').trim();
	if (!noteId || !workspaceId) return;
	try {
		await sendDelete(workspaceId, noteId);
	} catch {
		const pending = read(args.userId);
		if (pending.some((entry) => entry.noteId === noteId && entry.workspaceId === workspaceId)) return;
		write(args.userId, [...pending, { workspaceId, noteId, queuedAt: Date.now() }]);
	}
}

/** Replay queued deletes. Safe to call often — the server treats a missing row as success. */
export async function flushPendingNoteDocumentDeletes(userId: string | null | undefined): Promise<void> {
	const pending = read(userId);
	if (pending.length === 0) return;
	const survivors: PendingDelete[] = [];
	for (const entry of pending) {
		try {
			await sendDelete(entry.workspaceId, entry.noteId);
		} catch {
			survivors.push(entry);
		}
	}
	if (survivors.length !== pending.length) write(userId, survivors);
}

export function countPendingNoteDocumentDeletes(userId: string | null | undefined): number {
	return read(userId).length;
}

/** Must be called on logout — the next user on this device has no business replaying these. */
export function clearPendingNoteDocumentDeletes(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		const doomed: string[] = [];
		for (let index = 0; index < localStorage.length; index++) {
			const key = localStorage.key(index);
			if (key && key.startsWith(STORAGE_PREFIX)) doomed.push(key);
		}
		for (const key of doomed) localStorage.removeItem(key);
	} catch {
		// ignore
	}
}
