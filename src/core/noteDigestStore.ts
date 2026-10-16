/**
 * Per-workspace storage for note-card shells projected from the server's note digest.
 *
 * ## Why this is not just written into the render snapshot
 *
 * That was the first design, and it does not work. `readWorkspaceRenderSnapshot` is read by
 * NoteGrid **once per workspace id** (a `useMemo` keyed on `props.activeWorkspaceId`), and the
 * grid's own write - debounced 180ms, fired on any change to `orderedIds` or `docsById` - rebuilds
 * the whole notes array from live docs plus that one stale read. So an async digest landing a few
 * hundred milliseconds into a boot is both invisible to the current render *and* wiped by the next
 * grid write. Measured in the code, not guessed: see `snapshotNotesForPersistence`, whose
 * no-live-doc branch is `workspaceRenderSnapshotNoteById.get(id) ?? null`.
 *
 * Keeping the digest in its own store means it cannot clobber the measured snapshot and the
 * snapshot cannot clobber it. The precedence rule - a live doc beats a measured shell beats a
 * digest shell - is then applied where the card is rendered, which holds regardless of what order
 * the two caches happened to be written in. Write ordering is precisely what made the first
 * attempt fail, so the invariant does not get to depend on it.
 *
 * Shells are a **render hint**. Nothing here is authoritative, nothing here is ever synced back,
 * and losing the lot costs one re-fetch.
 */

import {
	mergeDigestShells,
	type NoteDigestEntry,
} from './noteDigestProjection';
import type { WorkspaceRenderSnapshotNote } from './workspaceRenderSnapshot';

const KEY_PREFIX = 'freemannotes.noteDigestShells.v1.';
const VERSION = 1;

/**
 * Per workspace.
 *
 * **Measured, not guessed: ~1.75KB per shell** across 38 real notes on the dev server (65KB of
 * JSON), driven by the server's 600-char content preview and up to 40 checklist rows. So 200 is
 * roughly 350KB per workspace, and a few workspaces plus the render snapshot - which stores
 * comparable data - still sits well inside a 5MB localStorage budget. A first guess of 400 was
 * made against an assumed 1KB and would have been ~700KB each.
 *
 * Trimming the *count* rather than the preview is deliberate: the preview length is what makes a
 * card the right height, so shortening it would reintroduce the wrong-size card this whole feature
 * exists to prevent. Better to hold full fidelity for fewer notes. 200 is around eight screens of
 * a six-column desktop grid, and anything past the cap simply renders as it does today.
 */
const MAX_SHELLS_PER_WORKSPACE = 200;

type NoteDigestShellStore = {
	v: number;
	workspaceId: string;
	shells: WorkspaceRenderSnapshotNote[];
	savedAt: string;
};

function storeKey(workspaceId: string): string {
	return `${KEY_PREFIX}${workspaceId}`;
}

/**
 * Listeners woken when shells change, so a grid already on screen picks up a digest that lands
 * mid-boot rather than waiting for the next workspace switch.
 *
 * A plain listener set on purpose, consumed with `useState` + `useEffect`. NOT
 * `useSyncExternalStore`: an unstable `getSnapshot` is a live React #185 crash in this codebase
 * (see the Accept & View bug), and `readNoteDigestShells` builds a fresh array on every call, so it
 * would walk straight into it.
 */
type NoteDigestShellListener = () => void;
const shellListeners = new Set<NoteDigestShellListener>();

export function subscribeNoteDigestShells(listener: NoteDigestShellListener): () => void {
	shellListeners.add(listener);
	return () => {
		shellListeners.delete(listener);
	};
}

function notifyShellListeners(): void {
	// Copy first: a listener that unsubscribes itself would otherwise mutate the set mid-iteration.
	for (const listener of [...shellListeners]) {
		try {
			listener();
		} catch {
			// A broken listener is not this store's problem, and must not stop the others.
		}
	}
}

/**
 * Keep the most recently updated shells when over the cap.
 *
 * Trimming by `updatedAt` rather than arrival order is the useful choice: the notes a person is
 * actually working with are the ones whose cards they are most likely to see before their
 * documents load.
 */
function capShells(shells: readonly WorkspaceRenderSnapshotNote[]): WorkspaceRenderSnapshotNote[] {
	if (shells.length <= MAX_SHELLS_PER_WORKSPACE) return [...shells];
	return [...shells]
		.sort((a, b) => (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0))
		.slice(0, MAX_SHELLS_PER_WORKSPACE);
}

export function readNoteDigestShells(
	workspaceId: string | null | undefined
): WorkspaceRenderSnapshotNote[] {
	if (typeof window === 'undefined' || !workspaceId) return [];
	try {
		const raw = window.localStorage.getItem(storeKey(workspaceId));
		if (!raw) return [];
		const parsed = JSON.parse(raw) as Partial<NoteDigestShellStore> | null;
		// A version bump throws the lot away rather than trying to migrate a render hint.
		if (!parsed || parsed.v !== VERSION || !Array.isArray(parsed.shells)) return [];
		return parsed.shells.filter(
			(shell): shell is WorkspaceRenderSnapshotNote =>
				Boolean(shell) && typeof shell === 'object' && typeof shell.id === 'string' && shell.id.length > 0
		);
	} catch {
		return [];
	}
}

/** Read the shells as a map, which is how every caller actually wants them. */
export function readNoteDigestShellById(
	workspaceId: string | null | undefined
): Map<string, WorkspaceRenderSnapshotNote> {
	return new Map(readNoteDigestShells(workspaceId).map((shell) => [shell.id, shell] as const));
}

export function writeNoteDigestShells(
	workspaceId: string,
	shells: readonly WorkspaceRenderSnapshotNote[]
): void {
	if (typeof window === 'undefined' || !workspaceId) return;
	try {
		const payload: NoteDigestShellStore = {
			v: VERSION,
			workspaceId,
			shells: capShells(shells),
			savedAt: new Date().toISOString(),
		};
		window.localStorage.setItem(storeKey(workspaceId), JSON.stringify(payload));
	} catch {
		// Best effort only - a full quota costs a re-fetch, not correctness.
		return;
	}
	notifyShellListeners();
}

/**
 * Merge a page of digest entries into the stored shells.
 *
 * Returns what changed so the caller can tell a quiet workspace from a fresh install, and so
 * nothing writes when there was nothing to write.
 */
export function mergeNoteDigestEntries(
	workspaceId: string,
	entries: readonly NoteDigestEntry[]
): { added: number; updated: number } {
	if (!workspaceId || entries.length === 0) return { added: 0, updated: 0 };
	const merged = mergeDigestShells(readNoteDigestShells(workspaceId), entries);
	if (merged.added === 0 && merged.updated === 0) return { added: 0, updated: 0 };
	writeNoteDigestShells(workspaceId, merged.shells);
	return { added: merged.added, updated: merged.updated };
}

export function clearNoteDigestShells(workspaceId: string): void {
	if (typeof window === 'undefined' || !workspaceId) return;
	try {
		window.localStorage.removeItem(storeKey(workspaceId));
	} catch {
		// ignore
	}
	notifyShellListeners();
}

/** Must run on logout - the next user on this device must not see the last one's note titles. */
export function clearAllNoteDigestShells(): void {
	if (typeof window === 'undefined') return;
	try {
		const doomed: string[] = [];
		for (let index = 0; index < window.localStorage.length; index++) {
			const key = window.localStorage.key(index);
			if (key && key.startsWith(KEY_PREFIX)) doomed.push(key);
		}
		for (const key of doomed) window.localStorage.removeItem(key);
	} catch {
		// ignore
	}
	notifyShellListeners();
}
