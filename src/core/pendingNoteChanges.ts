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

/**
 * Why a note is leaving the grid. Three causes, and the card says a different sentence for each.
 *
 * They arrive by three different routes, which is the awkward part: `trashed` is a metadata flip
 * that never touches the note list, `deleted` is an id leaving it, and `revoked` is the placement
 * being pruned. Treating them as one path is what made a collaborator's deletion announce itself
 * as an EDIT.
 */
export type PendingNoteRemovalReason = 'trashed' | 'deleted' | 'revoked';

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
	/** Removals only. Decides whether the card reads "deleted this note" or "revoked your access". */
	removalReason?: PendingNoteRemovalReason;
	/**
	 * Recorded from a write THIS DEVICE made while mirroring server state - the transaction carried
	 * `NOTE_ORDER_RECONCILE_ORIGIN`.
	 *
	 * It exists to keep `retractOwnNoteListChanges` off these entries, and the case got through to
	 * testing: when somebody revokes your access, YOUR device prunes the alias out of its own
	 * registry. The server sees that registry write and attributes it to you, quite correctly - so
	 * ten seconds later an event arrives naming nobody but you, and the retraction threw away the
	 * tombstone that was explaining the revocation. The chip appeared and then vanished by itself.
	 *
	 * `transaction.local` cannot spot this, because the write genuinely IS local. The origin can.
	 */
	viaReconcile?: boolean;
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
 * The FIRST placement reconciliation for a workspace in this session. Produces no pending changes
 * at all - not held, not announced, not counted.
 *
 * It is cleanup, not news. On a cold start this pass adds the shares the user has and prunes the
 * ones they lost access to while they were away, and neither is something to interrupt them about:
 * the additions are notes they already know they have, and the prunes are removals that already
 * happened and were already applied in an earlier session.
 *
 * Reported from testing, and it was bad: seven notes trashed and revoked in one session came BACK
 * on the next cold start as seven dimmed tombstones with a sync chip of seven, demanding a second
 * flush for work already seen. Clearing the browser cache made it worse rather than better, which
 * is the giveaway that load-time bookkeeping was being read as live activity.
 *
 * A LATER reconciliation is genuine news and keeps `NOTE_ORDER_RECONCILE_ORIGIN`. That distinction
 * has to exist because there is no server event for "the owner deleted a shared note" - the prune
 * is the only signal that ever arrives for it.
 *
 * Deliberately an ORIGIN rather than a flag the observer reads: the origin travels with the
 * transaction, so there is no window in which the observer could consult it and get the wrong
 * answer because the write and the bookkeeping happened in a different order than expected.
 */
export const NOTE_ORDER_INITIAL_RECONCILE_ORIGIN = 'freemannotes:note-order-initial-reconcile';

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
	at: number,
	extra?: { removalReason?: PendingNoteRemovalReason; viaReconcile?: boolean }
): PendingNoteChangeState {
	const next = new Map(state);
	const existing = next.get(noteId);
	const removalReason = kind === 'removed' ? extra?.removalReason : undefined;
	const viaReconcile = extra?.viaReconcile === true;

	if (!existing) {
		next.set(noteId, {
			noteId,
			kind,
			byUserId,
			at,
			contributors: mergeContributor([], byUserId, at),
			...(removalReason ? { removalReason } : {}),
			...(viaReconcile ? { viaReconcile: true } : {}),
		});
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

	/**
	 * A REMOVAL names one person: whoever removed it. Everybody else's chip is dropped.
	 *
	 * The card is on its way out, and what the user needs from it is "Alice deleted this" - not a
	 * stack of chips belonging to people who happened to type in it earlier, which reads as though
	 * they were all involved in the deletion. Same reasoning as the kind itself: structure beats
	 * content, and the last thing that happened is the only thing worth saying.
	 */
	if (kind === 'removed') {
		/**
		 * One removal usually arrives TWICE, and the second arrival is the anonymous one.
		 *
		 * A revocation announces itself with an actor and is then followed by the reconcile prune,
		 * which has nobody attached to it. A trashing is the other way round: the metadata observer
		 * spots it with nobody attached and the name only turns up later. Letting null overwrite a
		 * known name would lose whichever of the two happened to arrive first, so a name, once
		 * known, stays.
		 */
		const keepName = byUserId === null && existing.byUserId !== null;
		/**
		 * `deleted` is the DON'T-KNOW answer, not a fact: it is what an id leaving the note list
		 * means on its own. So it never overwrites a cause somebody actually established.
		 *
		 * The sequence that needs this is a revocation. The event says `revoked` and names the
		 * actor; the alias prune that follows is an anonymous note-list removal defaulting to
		 * `deleted`. Letting the second one win told the user their note had been deleted when in
		 * fact their access had been taken away - a different thing, and the wrong one.
		 */
		const reason = removalReason && removalReason !== 'deleted'
			? removalReason
			: (existing.removalReason ?? removalReason);
		next.set(noteId, {
			noteId,
			kind,
			byUserId: keepName ? existing.byUserId : byUserId,
			at,
			contributors: keepName ? existing.contributors : mergeContributor([], byUserId, at),
			...(reason ? { removalReason: reason } : {}),
			// Immunity is sticky: if either arrival was a reconcile write, the server will report
			// this user as the actor and the retraction must keep its hands off.
			...(viaReconcile || existing.viaReconcile ? { viaReconcile: true } : {}),
		});
		return next;
	}
	next.set(noteId, {
		noteId,
		kind,
		byUserId,
		at,
		contributors: mergeContributor(existing.contributors, byUserId, at),
		...(existing.viaReconcile ? { viaReconcile: true } : {}),
	});
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
		/** This device wrote it while mirroring server state - see `viaReconcile`. */
		viaReconcile?: boolean;
		/** Defaults to `deleted`, which is what an id leaving the note list means on its own. */
		removalReason?: PendingNoteRemovalReason;
	}
): PendingNoteChangeState {
	if (isOwnChange(args.byUserId, args.authUserId)) return state;
	if (args.added.length === 0 && args.removed.length === 0) return state;
	const extra = {
		viaReconcile: args.viaReconcile,
		removalReason: args.removalReason ?? ('deleted' as PendingNoteRemovalReason),
	};
	let next = state;
	for (const noteId of args.added) {
		if (noteId) next = foldChange(next, noteId, 'added', args.byUserId, args.at, extra);
	}
	for (const noteId of args.removed) {
		if (noteId) next = foldChange(next, noteId, 'removed', args.byUserId, args.at, extra);
	}
	return next;
}

/**
 * Record that one note has GONE, without the note list having changed.
 *
 * Exists because trashing does not touch `noteOrder`. `DocumentManager.trashNote` writes
 * `metadata.trashed` and nothing else, so a collaborator trashing a note arrives here as an
 * ordinary content change - and the grid then filters trashed notes out downstream, so the card
 * vanished anyway while the chip claimed it had merely been *edited*. Two different things were
 * being said about one event, and neither was what happened.
 *
 * So the caller that notices `trashed` flip decides it is a removal, and says so through here.
 * Permanent deletion and revoked access already arrive as note-list removals via
 * `applyNoteListDiff`; this is the third path onto the same footing.
 */
export function applyNoteRemoved(
	state: PendingNoteChangeState,
	args: {
		noteId: string;
		byUserId: string | null;
		at: number;
		authUserId: string | null;
		reason: PendingNoteRemovalReason;
		viaReconcile?: boolean;
	}
): PendingNoteChangeState {
	if (!args.noteId) return state;
	if (isOwnChange(args.byUserId, args.authUserId)) return state;
	return foldChange(state, args.noteId, 'removed', args.byUserId, args.at, {
		removalReason: args.reason,
		viaReconcile: args.viaReconcile,
	});
}

/**
 * Fill in the name on a removal that was recorded without one, or retract it if it was yours.
 *
 * Trashing has to be caught the moment `metadata.trashed` flips, which is long before anybody says
 * who did it: attribution rides on the `note-changed` event and that is debounced 10s server-side.
 * So the tombstone is drawn first and named second, and this is the second part.
 *
 * It deliberately does NOT go through `foldChange`. Folding an edit onto a removal keeps the kind
 * (correct) but also re-stamps `at` with the event's time, which would reset the chip's elapsed
 * label from "3m" back to "now" every time the announcement for the deletion itself landed. The
 * timestamp that matters is when the note went, so it is kept.
 *
 * If the attribution turns out to be the signed-in user, the entry is dropped instead: you deleted
 * it on another device, and holding your own deletion behind a prompt is the same absurdity as
 * holding your own new note. Same reasoning as `retractOwnNoteListChanges`, arriving by a
 * different route.
 */
export function attributeNoteRemoval(
	state: PendingNoteChangeState,
	args: { noteId: string; byUserId: string | null; at: number; authUserId: string | null }
): PendingNoteChangeState {
	if (!args.noteId || !args.byUserId) return state;
	const existing = state.get(args.noteId);
	if (!existing) return state;
	if (existing.kind !== 'removed') return state;
	// Already named. The first name wins, because a removal names whoever removed it and anybody
	// announced afterwards was only editing on the way out.
	if (existing.byUserId !== null) return state;
	const next = new Map(state);
	if (args.byUserId === args.authUserId) {
		next.delete(args.noteId);
		return next;
	}
	next.set(args.noteId, {
		...existing,
		byUserId: args.byUserId,
		// `existing.at` on purpose, not `args.at` - see above.
		contributors: mergeContributor([], args.byUserId, existing.at),
	});
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

/**
 * Drop pending note-list changes that a LATE attribution event has just explained.
 *
 * ## Why this is needed at all
 *
 * A note you create on your phone should simply be on the grid when you look at your laptop, and
 * it is not: it waits behind the chip. The cause is an ordering problem that cannot be fixed at
 * the moment the change arrives, which is why it needs its own entry point.
 *
 * - The note list is a local Yjs array, so the laptop diffs it the instant the update lands.
 * - Attribution rides on a `note-order-changed` metadata event, debounced 10s server-side.
 *
 * So when the diff runs there is no attribution, and `resolveNoteListChangeAuthor` deliberately
 * refuses to guess (see the long note there - guessing credited somebody else's note to you for
 * ~15s after any of your own). The entry is therefore held. Ten seconds later the event arrives
 * saying "that was you", by which time the only thing left to do is take the entry back.
 *
 * ## Which entries does one event explain?
 *
 * The event carries NO note ids, so the honest answer is "the ones recorded recently". Two things
 * narrow that from a guess to something defensible:
 *
 * 1. **The burst must name nobody but you.** Every write to the registry room coalesces into one
 *    announcement, and anybody else's write has to pass through the server to reach this client -
 *    so if their note got here before this event fired, the server recorded them in the same burst
 *    and `changedUserIds` has two names in it. A write that reached us inside the window but is
 *    missing from the list is not possible on a single server instance. When the list names anyone
 *    else, nothing is retracted: there is no way to tell which entry belongs to whom.
 * 2. **Only UNATTRIBUTED entries are eligible.** An entry already credited to Alice is known to be
 *    Alice's work, and an event naming only you does not explain it. Your own cross-device changes
 *    always land here as null, because that is exactly the case `resolveNoteListChangeAuthor`
 *    gives up on.
 *
 * What remains uncovered, deliberately: an entry recorded recently that describes an OLD change by
 * somebody else - this tab was asleep, Alice added a note, the tab reconnected and recorded it
 * unattributed with a fresh timestamp, and Alice's burst flushed long ago so she cannot appear in
 * this event's actor list. That is the only hole, it is what keeps the window narrow, and widening
 * the window to cover `NOTE_CHANGE_MAX_WAIT_MS` would multiply exposure to it for no real gain
 * (see the caller for the arithmetic).
 *
 * Edits are left alone: they arrive on `note-changed`, a different reason, and nothing about an
 * edited note is being withheld anyway.
 */
export function retractOwnNoteListChanges(
	state: PendingNoteChangeState,
	args: {
		/** `changedUserIds` from the event - everyone in the coalesced registry burst. */
		changedUserIds: readonly string[];
		authUserId: string | null;
		now: number;
		/** How far back an entry can be and still be explained by this event. */
		windowMs: number;
	}
): PendingNoteChangeState {
	if (state.size === 0) return state;
	if (!args.authUserId) return state;
	const actors = args.changedUserIds.filter((userId) => typeof userId === 'string' && userId.length > 0);
	// No actors at all means an older server that sent nothing useful - not evidence of anything.
	if (actors.length === 0) return state;
	if (actors.some((userId) => userId !== args.authUserId)) return state;

	let next: Map<string, PendingNoteChange> | null = null;
	for (const change of state.values()) {
		/**
		 * ADDED only. A removal is never retracted, however confidently the event names you.
		 *
		 * Measured in testing: a collaborator trashed a note, the tombstone was created correctly
		 * and unattributed, and 757ms later an event naming only this user arrived and this
		 * function deleted it. Those "only me" events are not rare - six of them inside one
		 * two-minute session, because the registry gets written by this device constantly.
		 *
		 * The two directions are not comparable. Retracting a removal loses a collaborator's
		 * deletion silently and the user never finds out. Keeping one means your own deletion from
		 * another device sits as a tombstone until you flush it: visible, recoverable, and in
		 * keeping with this module's existing bias that an unattributed change counts as somebody
		 * else's because deferring is the less intrusive mistake.
		 *
		 * This narrows the damage; it does not make the design right. The design is right when the
		 * actor is recorded ON the note and no time correlation is needed at all.
		 */
		if (change.kind !== 'added') continue;
		if (change.byUserId !== null) continue;
		/**
		 * Born from this device's own reconcile write, so the server attributing it to you proves
		 * nothing about who CAUSED it.
		 *
		 * This is the revocation case, and it is not hypothetical - it reached testing. Somebody
		 * revokes your access, your device prunes its own registry, the server reports you as the
		 * actor, and without this line the tombstone explaining the revocation was retracted ten
		 * seconds after appearing.
		 */
		if (change.viaReconcile === true) continue;
		const age = args.now - change.at;
		if (age < 0 || age >= args.windowMs) continue;
		if (!next) next = new Map(state);
		next.delete(change.noteId);
	}
	return next ?? state;
}

/**
 * Release a held note once the note itself says you created it.
 *
 * ## Why this exists alongside `retractOwnNoteListChanges`
 *
 * They answer the same question by opposite means, and this one is the right way round.
 *
 * The retraction is driven by a `/ws/metadata` event: debounced 10s, carrying no note ids, so it
 * can only be matched to entries by time. That is why it needs a window, why the window is wrong on
 * any connection it was not tuned for, and why it twice deleted a tombstone it had no business
 * touching.
 *
 * This is driven by the note's own `createdByUserId`, which arrives as part of the note. It names
 * exactly one note, so there is nothing to correlate and no window to choose. It fires when the
 * data arrives rather than when a timer expires, which is what makes it behave the same offline,
 * on fibre, and on a phone with two bars.
 *
 * The retraction stays for notes created before the field existed - those have no author to read,
 * so they keep the old behaviour. It is the fallback now, not the mechanism.
 *
 * ## Only an UNATTRIBUTED add
 *
 * An entry already credited to somebody else is not touched: the note's author and the person who
 * put it on your grid are not always the same person (a share can be placed by its recipient), and
 * a known name is better evidence than an inferred one.
 *
 * Removals are out of scope by construction - a removal is never released this way, because the
 * author field says who MADE the note, not who got rid of it.
 */
export function resolveOwnPendingAdd(
	state: PendingNoteChangeState,
	args: {
		noteId: string;
		/** `createdByUserId` from the note's own metadata. Null for a legacy note. */
		authorUserId: string | null;
		authUserId: string | null;
	}
): PendingNoteChangeState {
	if (!args.noteId || !args.authorUserId || !args.authUserId) return state;
	if (args.authorUserId !== args.authUserId) return state;
	const existing = state.get(args.noteId);
	if (!existing) return state;
	if (existing.kind !== 'added') return state;
	if (existing.byUserId !== null) return state;
	const next = new Map(state);
	next.delete(args.noteId);
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

/**
 * Every card that should wear an overlay: edited ones and removed ones, in one map.
 *
 * Added notes are deliberately absent - they are not on the grid yet, which is the whole point of
 * withholding them. Edited and removed cards are both *present and marked*, differing only in what
 * the overlay says, so the render site wants them together rather than having to merge two maps and
 * keep the merge in step.
 */
export function pendingCardNoteChanges(
	state: PendingNoteChangeState
): Map<string, PendingNoteChange> {
	const cards = new Map<string, PendingNoteChange>();
	for (const change of state.values()) {
		if (change.kind === 'added') continue;
		cards.set(change.noteId, change);
	}
	return cards;
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
