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

/** One person's contribution to a pending change, and when they last made one. */
export type PendingNoteChangeContributor = {
	userId: string;
	at: number;
};

export type PendingNoteChange = {
	noteId: string;
	kind: PendingNoteChangeKind;
	/** Null when the change arrived without attribution - still treated as somebody else's. */
	byUserId: string | null;
	/** Most recent moment this note changed, as supplied by the caller. */
	at: number;
	/**
	 * EVERYONE who has contributed to this pending change, most recent first.
	 *
	 * `byUserId` is only the latest, which is all the pill ever needed. The card chips need the
	 * whole list: two people editing the same note before you look at it is the normal case in a
	 * shared workspace, and showing only the last of them silently drops the other.
	 *
	 * An unattributed change adds nobody here - it still counts as a pending change, it just has
	 * no one to draw a chip for.
	 */
	contributors: readonly PendingNoteChangeContributor[];
};

/** Keyed by note id: one note has at most one pending entry, however many times it changed. */
export type PendingNoteChangeState = ReadonlyMap<string, PendingNoteChange>;

export type PendingNoteChangeSummary = {
	added: number;
	removed: number;
	edited: number;
	total: number;
	/**
	 * Changes that are actually WAITING TO BE APPLIED, i.e. added + removed. This is what the chip
	 * counts and what decides whether it is shown at all.
	 *
	 * Edits are excluded on purpose, and the reasoning is worth keeping because the plan said the
	 * opposite. The plan paired "the count includes edits" with deferring column rebalancing to
	 * flush points - and that half was never built. So an edited note has nothing withheld: the
	 * card has already resized and the grid has already repacked. Counting it in a badge whose
	 * button says "Apply changes" promises an action that does not exist, and the gradient and
	 * chips on the card are the notification. Opening the note clears them.
	 */
	structural: number;
	/** Everyone who contributed, most recent first. Drives the chips and the popover. */
	userIds: string[];
};

export function createEmptyPendingNoteChanges(): PendingNoteChangeState {
	return new Map();
}

/**
 * Yjs transaction origin for a note-order write that is RECONCILING SERVER STATE rather than
 * carrying out something the user just did.
 *
 * `transaction.local` alone is not enough to answer "did the user do this here", and this is the
 * case that proves it: accepting a shared note fires a `note-share-*` event to EVERY device the
 * user has open, each of which runs `refreshNoteShareState()` and writes the alias into its own
 * `noteOrder`. That write is local on all of them, so every device thought it was the actor and
 * the note appeared instantly everywhere - when it should appear instantly only on the device
 * where the user pressed Accept, and be announced on the others.
 *
 * Tagging the reconciliation write lets the observer tell the two apart. It generalises: any
 * future server-driven write to the note list gets the same treatment by passing this origin,
 * instead of being silently credited to whoever happens to be looking.
 */
export const NOTE_ORDER_RECONCILE_ORIGIN = 'freemannotes:note-order-reconcile';

/**
 * Who to credit for a change to the note LIST.
 *
 * ## The bug this exists to stop
 *
 * Creating a note put it behind the pending chip instead of straight on the grid. The cause is an
 * ordering one, and it is worth stating plainly because it is not obvious:
 *
 * - the note list is a local Yjs array, so your own write fires the observer **immediately**;
 * - attribution rides on the `note-order-changed` metadata event, which is debounced **10 seconds**
 *   server-side.
 *
 * So at the moment a local change is seen there is NEVER an attribution for it, and an
 * unattributed change is deliberately treated as somebody else's. Every note you created was
 * therefore withheld from you - and so was every note you deleted.
 *
 * ## The fix
 *
 * A LOCAL Yjs transaction is by definition this client's own work: Yjs sets `transaction.local`
 * false for anything applied from a remote update or loaded out of IndexedDB. So a local
 * transaction is credited to the signed-in user without waiting for the server to agree, and only
 * a REMOTE change falls back to the metadata event's attribution.
 *
 * `attribution` is still consulted (within `windowMs`) for remote changes, because the registry
 * update and the metadata event are not ordered with respect to each other and have to be
 * correlated by time rather than by sequence.
 */
export function resolveNoteListChangeAuthor(args: {
	/** `event.transaction.local` from the note-order observer. */
	isLocalTransaction: boolean;
	/**
	 * This device wrote it, but only to mirror server state - `transaction.origin` was
	 * `NOTE_ORDER_RECONCILE_ORIGIN`. Writing it does not mean the user asked for it HERE.
	 */
	isServerReconcile?: boolean;
	/**
	 * When the user last did something in THIS tab that a reconcile would be carrying out
	 * (accepting or declining a share, leaving a note). Null if they have not.
	 *
	 * This is how the accepting device stays instant: it reconciles through the same code path as
	 * every other device, so the only thing that distinguishes it is that somebody pressed a
	 * button here a moment ago.
	 */
	userInitiatedAt?: number | null;
	/**
	 * How long a user action keeps counting as the cause of a reconcile. Defaults to `windowMs`.
	 *
	 * Deliberately separate, and more generous: accepting a share can involve a workspace switch
	 * and several requests before the write lands, and being wrong in that direction reproduces
	 * the exact symptom this is fixing - the note not appearing on the device you accepted it on.
	 */
	userActionWindowMs?: number;
	authUserId: string | null;
	attribution: { byUserId: string | null; at: number } | null;
	now: number;
	windowMs: number;
}): string | null {
	/**
	 * A deliberate action in THIS tab wins outright, whatever wrote the change.
	 *
	 * Checked BEFORE the local/remote branch, because the user's own other device can be the
	 * writer. Accepting a share fires a reconcile on every device at once, and whichever one wins
	 * the race writes it - so the device where Accept was pressed can perfectly well see the
	 * result arrive as a REMOTE update. Measured: on the accepting device the diff reported
	 * `local: false`, so it was held and the chip appeared on the very device that asked for it.
	 *
	 * The window only opens when somebody pressed a button here, so the collateral risk is a note
	 * genuinely added by somebody else inside those few seconds being applied instead of held.
	 */
	const userActionWindowMs = args.userActionWindowMs ?? args.windowMs;
	const withinUserAction = args.userInitiatedAt != null
		&& args.now - args.userInitiatedAt < userActionWindowMs;
	if (withinUserAction) return args.authUserId ?? null;

	if (args.isLocalTransaction) {
		// A reconcile nobody asked for here is an ARRIVAL, so it falls through to the remote path
		// and gets announced like any other change made elsewhere.
		if (args.isServerReconcile !== true) return args.authUserId ?? null;
	}
	const attribution = args.attribution;
	if (!attribution) return null;
	if (args.now - attribution.at >= args.windowMs) return null;
	/**
	 * A REMOTE change that attribution says was made by YOU is not proof it was yours.
	 *
	 * The attribution arrives on a 10s-debounced event and carries no note ids, so it is correlated
	 * with a diff by time alone. That means for ~15s after your own note-list change is announced
	 * back to you, the ref still names you - and the next note anybody else adds in that window
	 * gets credited to you and silently applied. Reported as "Meshuga created a note and it
	 * appeared instantly for Daxton", which is exactly that window.
	 *
	 * It cannot be told apart from the legitimate case (your own change from another device), so
	 * the conservative answer wins: treat it as unknown, which `pendingNoteChanges` then holds. The
	 * cost is that a note you made on your phone waits behind the chip on your laptop; the cost of
	 * the other choice is somebody else's note rearranging the grid under you, which is the entire
	 * thing this mechanism exists to prevent.
	 */
	if (attribution.byUserId && attribution.byUserId === args.authUserId) return null;
	return attribution.byUserId;
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
/**
 * Upsert one contributor, keeping the list most-recent-first.
 *
 * A repeat contributor moves up rather than appearing twice - somebody who edited a note four
 * times is one chip, not four.
 */
function mergeContributor(
	existing: readonly PendingNoteChangeContributor[],
	userId: string | null,
	at: number
): readonly PendingNoteChangeContributor[] {
	if (!userId) return existing;
	const merged = existing.filter((entry) => entry.userId !== userId);
	const previous = existing.find((entry) => entry.userId === userId);
	merged.push({ userId, at: previous ? Math.max(previous.at, at) : at });
	merged.sort((left, right) => right.at - left.at);
	return merged;
}

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
		next.set(noteId, { noteId, kind, byUserId, at, contributors: mergeContributor([], byUserId, at) });
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
		next.set(noteId, { ...existing, byUserId, at, contributors: mergeContributor(existing.contributors, byUserId, at) });
		return next;
	}

	if (existing.kind === 'removed' && kind === 'edited') {
		// Deliberately does NOT re-attribute: a card on its way out should name whoever removed
		// it, not whoever typed in it on the way. Same reason the kind does not change.
		next.set(noteId, { ...existing, at });
		return next;
	}

	next.set(noteId, { noteId, kind, byUserId, at, contributors: mergeContributor(existing.contributors, byUserId, at) });
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
		// Every contributor, not just `byUserId` - the popover claims to list who changed things,
		// and naming only the last editor of each note quietly omits the rest.
		for (const contributor of change.contributors) {
			const previous = seen.get(contributor.userId) ?? 0;
			if (contributor.at > previous) seen.set(contributor.userId, contributor.at);
		}
	}
	const userIds = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([userId]) => userId);
	return { added, removed, edited, total: state.size, structural: added + removed, userIds };
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
