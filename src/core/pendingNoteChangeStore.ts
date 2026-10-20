/**
 * Persistence for "who changed this card, that you have not looked at yet".
 *
 * ## Why only the EDITED entries
 *
 * A reload is one of the agreed flush points, and for added and removed notes that is right: a
 * reload lays the grid out from scratch, so there is no shift to prevent, and withholding a new
 * note across reloads would hide it indefinitely.
 *
 * Edited notes are the opposite case. The change was already applied - the card is live and
 * correct - and the only thing the pending entry carries is the ATTRIBUTION. Dropping that on
 * reload means the one piece of information you could not reconstruct is the one piece you lose,
 * and a refresh silently wipes the chips off every card. Reported as a bug, and it is one.
 *
 * Opening the note is what acknowledges it: that removes the entry from state, and this store is
 * rewritten from state, so it goes from disk at the same moment and a later reload brings nothing
 * back. A refresh is not an acknowledgement; opening the note is.
 *
 * So: added/removed stay in memory and flush on reload; edited attribution is written here.
 *
 * ## Deliberately its own store
 *
 * Not in the workspace render snapshot, which the grid rewrites on a debounce and would clobber,
 * and not in `pendingNoteChanges.ts`, which is pure by design so its rules stay testable in plain
 * Node. Scoped per user AND per workspace: the set is per workspace, and the names in it are other
 * people's, so a second user on the same device must not inherit them.
 */

import type { PendingNoteChange, PendingNoteChangeState } from './pendingNoteChanges';

const KEY_PREFIX = 'freemannotes.pendingNoteChanges.v1';

/**
 * The ONLY bound on this store, and deliberately the only one.
 *
 * There is no time-based expiry, and that is a decision rather than an omission. "Somebody changed
 * this and you have not looked at it" does not stop being true after a fortnight - if anything it
 * gets more worth knowing - so expiring on a calendar would throw away good information to solve a
 * problem the cap already solves. The cap forgets only when it physically has to, oldest first.
 *
 * 200 entries is roughly 30KB. Anyone with more than 200 unseen changed notes has a bigger problem
 * than the two hundredth gradient.
 */
const MAX_ENTRIES = 200;

type StoredContributor = { u: string; a: number };
type StoredEntry = { n: string; b: string | null; a: number; c: StoredContributor[] };

function storageKey(userId: string, workspaceId: string): string {
	return `${KEY_PREFIX}:${userId}::${workspaceId}`;
}

function isUsable(userId: string | null | undefined, workspaceId: string | null | undefined): boolean {
	return Boolean(userId && workspaceId && typeof localStorage !== 'undefined');
}

/**
 * Read back the edited-note attribution for this user and workspace.
 *
 * Returns an empty map for anything unreadable - no entry, corrupt JSON, a browser that throws on
 * `localStorage` in private mode. A missing chip is a cosmetic loss; throwing here would be a boot
 * failure, and this runs during startup.
 */
export function loadPendingEditedChanges(
	userId: string | null | undefined,
	workspaceId: string | null | undefined
): Map<string, PendingNoteChange> {
	const result = new Map<string, PendingNoteChange>();
	if (!isUsable(userId, workspaceId)) return result;
	try {
		const raw = localStorage.getItem(storageKey(String(userId), String(workspaceId)));
		if (!raw) return result;
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return result;
		for (const row of parsed as StoredEntry[]) {
			if (!row || typeof row !== 'object') continue;
			const noteId = typeof row.n === 'string' ? row.n : '';
			const at = Number(row.a);
			if (!noteId || !Number.isFinite(at)) continue;
			const contributors = Array.isArray(row.c)
				? row.c
					.filter((entry) => entry && typeof entry.u === 'string' && entry.u && Number.isFinite(Number(entry.a)))
					.map((entry) => ({ userId: String(entry.u), at: Number(entry.a) }))
				: [];
			result.set(noteId, {
				noteId,
				kind: 'edited',
				byUserId: typeof row.b === 'string' && row.b ? row.b : null,
				at,
				contributors,
			});
		}
	} catch {
		return new Map();
	}
	return result;
}

/**
 * Write the edited entries of `state`, dropping everything else.
 *
 * Removing the key when there is nothing to store matters: leaving a stale `[]` behind is
 * indistinguishable from "never written" on read, but it keeps a per-workspace key alive forever
 * for workspaces the user has stopped using.
 */
export function savePendingEditedChanges(
	userId: string | null | undefined,
	workspaceId: string | null | undefined,
	state: PendingNoteChangeState
): void {
	if (!isUsable(userId, workspaceId)) return;
	const key = storageKey(String(userId), String(workspaceId));
	try {
		const rows: StoredEntry[] = [];
		for (const change of state.values()) {
			if (change.kind !== 'edited') continue;
			rows.push({
				n: change.noteId,
				b: change.byUserId,
				a: change.at,
				c: change.contributors.map((entry) => ({ u: entry.userId, a: entry.at })),
			});
		}
		if (rows.length === 0) {
			localStorage.removeItem(key);
			return;
		}
		// Newest first, so the cap drops the entries that have been ignored longest.
		rows.sort((left, right) => right.a - left.a);
		localStorage.setItem(key, JSON.stringify(rows.slice(0, MAX_ENTRIES)));
	} catch {
		// Quota, private mode, or a disabled store. Chips reverting to in-memory-only is the
		// correct degradation; there is nothing to report to the user about it.
	}
}

/**
 * Drop every workspace's stored attribution for every user on this device.
 *
 * Must be called on logout. These entries hold other people's user ids against note ids, which is
 * exactly the shape of leak the privacy audit was about - the next person to sign in on a shared
 * device must not inherit them.
 */
export function clearAllPendingNoteChanges(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		const doomed: string[] = [];
		for (let index = 0; index < localStorage.length; index += 1) {
			const key = localStorage.key(index);
			if (key && key.startsWith(`${KEY_PREFIX}:`)) doomed.push(key);
		}
		for (const key of doomed) localStorage.removeItem(key);
	} catch {
		// Nothing useful to do; the next sign-in scopes its own key by userId anyway.
	}
}
