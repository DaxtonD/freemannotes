/**
 * Fetch the server's note digest and keep a store of note-card shells, so a device that has never
 * seen a note can still draw a correctly-sized card for it.
 *
 * ## The problem this solves
 *
 * Issue 2 of the three that started this work, in the user's words: "I'll be on my desktop and
 * I'll add 5 notes. Later in the day I'll open the app on my phone. I'll see 5 blank note cards
 * appear on the grid. Then after some time the data populates and the cards resize."
 *
 * A card's size comes from `WorkspaceRenderSnapshotNote` — and that has always been written to
 * **localStorage only, per device**. Which is exactly why a device that has never seen a note has
 * nothing to draw: not a bug in the snapshot, just a cache that cannot contain what it was never
 * told. `estimateUnmeasuredNoteHeightPx` fills the gap by **hashing the note id**
 * (`160 + (hash % 220)`), which is deterministic noise with no relation to the content — so the
 * blank card is also the wrong height, and resizes when the real data lands.
 *
 * The digest closes that gap by letting the server describe a note's shape without this device
 * having downloaded the note.
 *
 * ## Deliberate constraints
 *
 * - **RENDER HINT ONLY.** A digest shell loses to a live doc and to the device's own measured
 *   render snapshot. That precedence is applied where a card is rendered, not here - see
 *   `./noteDigestStore` for why writing into the render snapshot does not work.
 * - **Incremental from a cursor**, persisted per workspace and device. A large workspace cannot
 *   re-download every shell on every open, and retrofitting that later is worse than designing it
 *   in now.
 * - **Never throws.** This is an optimisation for first paint. Failing it should leave the app
 *   exactly as it was rather than break a boot.
 *
 * The rules for building and merging shells live in `./noteDigestProjection` (pure, tested) and the
 * storage in `./noteDigestStore`. What is left here is the plumbing: a fetch and a cursor.
 *
 * ## Known gap
 *
 * Shared notes are not covered: their documents live in the owner's workspace, so a
 * workspace-scoped digest cannot see them. Accepted for now — the shimmer is the mitigation.
 */

import { fetchJsonWithTimeout } from './network';
import {
	digestEntryToSnapshotNote,
	mergeDigestShells,
	type NoteDigestEntry,
} from './noteDigestProjection';
import { mergeNoteDigestEntries } from './noteDigestStore';

const DIGEST_TIMEOUT_MS = 20_000;
const DIGEST_PAGE_SIZE = 200;
/** A guard, not a design limit — a cursor that failed to advance must not page forever. */
const DIGEST_MAX_PAGES = 25;
const CURSOR_PREFIX = 'freemannotes.noteDigestCursor.v1';

export { digestEntryToSnapshotNote, mergeDigestShells };
export type { NoteDigestEntry };

type DigestResponse = {
	notes: NoteDigestEntry[];
	cursor: string | null;
	hasMore: boolean;
};

function cursorKey(workspaceId: string, deviceId: string): string {
	return `${CURSOR_PREFIX}:${workspaceId}::${deviceId}`;
}

function readCursor(workspaceId: string, deviceId: string): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(cursorKey(workspaceId, deviceId));
	} catch {
		return null;
	}
}

function writeCursor(workspaceId: string, deviceId: string, cursor: string | null): void {
	if (typeof localStorage === 'undefined') return;
	try {
		if (cursor) localStorage.setItem(cursorKey(workspaceId, deviceId), cursor);
		else localStorage.removeItem(cursorKey(workspaceId, deviceId));
	} catch {
		// Losing the cursor costs one full re-fetch, not correctness.
	}
}

/** Must be called on logout — the next user on this device must not inherit a cursor. */
export function clearNoteDigestCursors(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		const doomed: string[] = [];
		for (let index = 0; index < localStorage.length; index++) {
			const key = localStorage.key(index);
			if (key && key.startsWith(CURSOR_PREFIX)) doomed.push(key);
		}
		for (const key of doomed) localStorage.removeItem(key);
	} catch {
		// ignore
	}
}

export type DigestSeedResult = {
	/** Entries the server returned across every page. */
	fetched: number;
	/** Notes the store had never heard of, so a shell was added. */
	added: number;
	/** Shells refreshed with a newer projection. */
	updated: number;
	cursor: string | null;
};

/** Fetch the digest for a workspace and seed any missing card shells. Never throws. */
export async function seedWorkspaceDigest(args: {
	workspaceId: string | null | undefined;
	deviceId: string | null | undefined;
	/** Ignore the stored cursor and re-read the whole workspace. */
	full?: boolean;
}): Promise<DigestSeedResult> {
	const workspaceId = String(args.workspaceId || '').trim();
	const deviceId = String(args.deviceId || '').trim();
	if (!workspaceId || !deviceId) return { fetched: 0, added: 0, updated: 0, cursor: null };

	let cursor = args.full ? null : readCursor(workspaceId, deviceId);
	let fetched = 0;
	let added = 0;
	let updated = 0;

	try {
		for (let page = 0; page < DIGEST_MAX_PAGES; page++) {
			const params = new URLSearchParams({ workspaceId, limit: String(DIGEST_PAGE_SIZE) });
			if (cursor) params.set('since', cursor);
			const response = await fetchJsonWithTimeout<DigestResponse>(
				`/api/note-digest?${params.toString()}`,
				{ credentials: 'include', timeoutMs: DIGEST_TIMEOUT_MS, requestName: 'note-digest' }
			);
			const notes = Array.isArray(response?.notes) ? response.notes : [];
			fetched += notes.length;
			const merged = mergeNoteDigestEntries(workspaceId, notes);
			added += merged.added;
			updated += merged.updated;

			const nextCursor = typeof response?.cursor === 'string' ? response.cursor : null;
			// A cursor that did not move would page forever. Treat that as the end rather than
			// trusting hasMore, which is the server's opinion about a query we may be misreading.
			//
			// Note that a page can legitimately come back with ZERO notes and hasMore: true - the
			// server takes `limit` rows from the document table and only then filters to
			// registry-claimed notes, so a window full of attached drawings or drafts yields
			// nothing. Verified against the dev server: at limit=3 the full set still arrived
			// intact across 23 pages, 9 of them empty, with no gaps and no duplicates. So an empty
			// page must not end the loop.
			if (!response?.hasMore || !nextCursor || nextCursor === cursor) {
				cursor = nextCursor ?? cursor;
				break;
			}
			cursor = nextCursor;
		}
		writeCursor(workspaceId, deviceId, cursor);
	} catch {
		// Leave the cursor untouched on failure so the next attempt re-reads the same window
		// rather than skipping past notes it never saw.
		return { fetched, added, updated, cursor };
	}
	return { fetched, added, updated, cursor };
}
