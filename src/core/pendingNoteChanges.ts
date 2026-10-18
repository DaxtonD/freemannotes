/**
 * What has changed in this workspace that the user has not seen yet.
 *
 * The grid applies remote changes the instant they arrive, which is the whole of the complaint
 * this is here to fix: notes added on another device appear and shift everything down, notes
 * deleted elsewhere vanish and everything closes up, notes edited elsewhere grow or shrink. All
 * three are one sentence - *somebody else's change was applied while you were looking at it.*
 *
 * So changes land here first, and the grid applies them when the user says so.
 *
 * ## Deliberately pure
 *
 * No imports, no side effects, no clock of its own - every entry point takes `at` and `authUserId`
 * rather than reaching for them. That keeps the whole rule set testable in plain Node, which
 * matters because the interesting behaviour is all in the edge cases below rather than in the
 * happy path.
 *
 * ## Your own changes are never pending
 *
 * A note you created on your phone should simply be there when you open your laptop; holding it
 * behind a prompt would be absurd. So anything attributed to the signed-in user is dropped on the
 * floor here.
 *
 * **An UNATTRIBUTED change counts as somebody else's.** That is the deliberate choice, not an
 * oversight: attribution rides on a live `/ws/metadata` event, so a change that arrived while the
 * tab was disconnected has none. Deferring is the less intrusive mistake - it shows a prompt that
 * might have been unnecessary, where the alternative rearranges the grid under someone's hands.
 *
 * ## Why a registry event is not itself a change
 *
 * Measured, not assumed. While the author edited a note in one workspace, `note-order-changed`
 * events arrived for a *different* workspace's registry - so the registry gets written for reasons
 * that have nothing to do with notes being added or removed. Reacting to the event directly would
 * count phantom changes and show "2 new notes" when nothing was added.
 *
 * Hence `diffNoteIds`: the event is only a prompt to re-examine the note list, the diff decides
 * what actually happened, and the event supplies the attribution for it.
 */

export type PendingNoteChangeKind = 'added' | 'removed' | 'edited';

export type PendingNoteChange = {
	noteId: string;
	kind: PendingNoteChangeKind;
	/** Null when the change arrived without attribution - still treated as somebody else's. */
	byUserId: string | null;
	/** Most recent moment this note changed, as supplied by the caller. */
	at: number;
};

/** Keyed by note id: one note has at most one pending entry, however many times it changed. */
export type PendingNoteChangeState = ReadonlyMap<string, PendingNoteChange>;

export type PendingNoteChangeSummary = {
	added: number;
	removed: number;
	edited: number;
	total: number;
	/** Everyone who contributed, most recent first. Drives the chips and the popover. */
	userIds: string[];
};

export function createEmptyPendingNoteChanges(): PendingNoteChangeState {
	return new Map();
}

/**
 * What actually changed in the note list.
 *
 * Order is ignored on purpose - a reorder is not something to interrupt anyone about, and the
 * canonical order is the registry's business.
 */
export function diffNoteIds(
	previous: readonly string[],
	next: readonly string[]
): { added: string[]; removed: string[] } {
	const before = new Set(previous);
	const after = new Set(next);
	const added: string[] = [];
	const removed: string[] = [];
	for (const id of after) {
		if (!before.has(id)) added.push(id);
	}
	for (const id of before) {
		if (!after.has(id)) removed.push(id);
	}
	return { added, removed };
}

function isOwnChange(byUserId: string | null | undefined, authUserId: string | null | undefined): boolean {
	if (!byUserId) return false; // unattributed - see the note above
	if (!authUserId) return false;
	return byUserId === authUserId;
}

/**
 * Fold one note's change into the state.
 *
 * The precedence rules, all of which come from the agreed spec:
 *
 * | already pending | now        | result                                            |
 * |-----------------|------------|---------------------------------------------------|
 * | added           | removed    | **nothing** - it arrived and left unseen          |
 * | removed         | added      | **nothing** - it came back before you looked      |
 * | added           | edited     | added - it is still simply "new"                  |
 * | edited          | removed    | removed - structure beats content                 |
 * | edited          | edited     | edited, re-attributed to the later editor         |
 * | removed         | edited     | removed - a dimmed card does not also "change"    |
 */
function foldChange(
	state: PendingNoteChangeState,
	noteId: string,
	kind: PendingNoteChangeKind,
	byUserId: string | null,
	at: number
): PendingNoteChangeState {
	const next = new Map(state);
	const existing = next.get(noteId);

	if (!existing) {
		next.set(noteId, { noteId, kind, byUserId, at });
		return next;
	}

	// A note that appeared and disappeared before anyone saw it is not news in either direction.
	if (
		(existing.kind === 'added' && kind === 'removed')
		|| (existing.kind === 'removed' && kind === 'added')
	) {
		next.delete(noteId);
		return next;
	}

	if (existing.kind === 'added' && kind === 'edited') {
		// Still just "new" - but keep the later timestamp and editor for the chip.
		next.set(noteId, { ...existing, byUserId, at });
		return next;
	}

	if (existing.kind === 'removed' && kind === 'edited') {
		next.set(noteId, { ...existing, at });
		return next;
	}

	next.set(noteId, { noteId, kind, byUserId, at });
	return next;
}

/** Record the result of a note-list diff, attributed to whoever triggered it. */
export function applyNoteListDiff(
	state: PendingNoteChangeState,
	args: {
		added: readonly string[];
		removed: readonly string[];
		byUserId: string | null;
		at: number;
		authUserId: string | null;
	}
): PendingNoteChangeState {
	if (isOwnChange(args.byUserId, args.authUserId)) return state;
	if (args.added.length === 0 && args.removed.length === 0) return state;
	let next = state;
	for (const noteId of args.added) {
		if (noteId) next = foldChange(next, noteId, 'added', args.byUserId, args.at);
	}
	for (const noteId of args.removed) {
		if (noteId) next = foldChange(next, noteId, 'removed', args.byUserId, args.at);
	}
	return next;
}

/** Record that one note's content changed. */
export function applyNoteEdited(
	state: PendingNoteChangeState,
	args: { noteId: string; byUserId: string | null; at: number; authUserId: string | null }
): PendingNoteChangeState {
	if (!args.noteId) return state;
	if (isOwnChange(args.byUserId, args.authUserId)) return state;
	return foldChange(state, args.noteId, 'edited', args.byUserId, args.at);
}

/**
 * The user has seen this one - opening a note, or editing it themselves, both count.
 *
 * Returns the same state object when nothing was pending, so callers can skip a re-render.
 */
export function resolveNoteChange(
	state: PendingNoteChangeState,
	noteId: string
): PendingNoteChangeState {
	if (!noteId || !state.has(noteId)) return state;
	const next = new Map(state);
	next.delete(noteId);
	return next;
}

/** Flush: everything has been applied, so nothing is pending. */
export function clearPendingNoteChanges(state: PendingNoteChangeState): PendingNoteChangeState {
	return state.size === 0 ? state : new Map();
}

export function summarisePendingNoteChanges(state: PendingNoteChangeState): PendingNoteChangeSummary {
	let added = 0;
	let removed = 0;
	let edited = 0;
	const seen = new Map<string, number>();
	for (const change of state.values()) {
		if (change.kind === 'added') added += 1;
		else if (change.kind === 'removed') removed += 1;
		else edited += 1;
		if (change.byUserId) {
			const previous = seen.get(change.byUserId) ?? 0;
			if (change.at > previous) seen.set(change.byUserId, change.at);
		}
	}
	const userIds = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([userId]) => userId);
	return { added, removed, edited, total: state.size, userIds };
}

/**
 * Note ids the grid must NOT render yet - they arrived unseen, so rendering them is the shift this
 * whole mechanism exists to prevent.
 */
export function pendingAddedNoteIds(state: PendingNoteChangeState): Set<string> {
	const ids = new Set<string>();
	for (const change of state.values()) {
		if (change.kind === 'added') ids.add(change.noteId);
	}
	return ids;
}

/**
 * Note ids the grid must KEEP rendering even though they are gone from the list, shown dimmed.
 * Letting them vanish is what closes the gap up and moves everything below.
 */
export function pendingRemovedNoteIds(state: PendingNoteChangeState): Set<string> {
	const ids = new Set<string>();
	for (const change of state.values()) {
		if (change.kind === 'removed') ids.add(change.noteId);
	}
	return ids;
}

/** Note id -> who last changed it, for the cards that should carry a chip. */
export function pendingEditedNoteChanges(
	state: PendingNoteChangeState
): Map<string, PendingNoteChange> {
	const edited = new Map<string, PendingNoteChange>();
	for (const change of state.values()) {
		if (change.kind === 'edited') edited.set(change.noteId, change);
	}
	return edited;
}
