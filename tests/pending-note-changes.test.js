'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for src/core/pendingNoteChanges.ts — what has changed in a workspace
// that the user has not seen yet.
//
// The happy path here is trivial; all the value is in the precedence rules and
// the two deliberate asymmetries, so those get the attention:
//
//   • YOUR OWN change is never pending (a note from your phone should just be
//     there), but an UNATTRIBUTED one is treated as somebody else's — deferring
//     is the less intrusive mistake.
//   • A note that arrived and left unseen is not news in either direction.
//
// Run individually:  node --test tests/pending-note-changes.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

require('ts-node/register/transpile-only');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
	applyNoteEdited,
	applyNoteListDiff,
	applyNoteRemoved,
	attributeNoteRemoval,
	clearPendingNoteChanges,
	createEmptyPendingNoteChanges,
	diffNoteIds,
	dropObsoleteWithheldNote,
	pendingAddedNoteIds,
	pendingCardNoteChanges,
	pendingEditedNoteChanges,
	pendingRemovedNoteIds,
	resolveNoteChange,
	resolveNoteListChangeAuthor,
	resolveOwnPendingAdd,
	retractOwnNoteListChanges,
	NOTE_ORDER_RECONCILE_ORIGIN,
	summarisePendingNoteChanges,
} = require('../src/core/pendingNoteChanges.ts');

const ME = 'user-me';
const ALICE = 'user-alice';
const BOB = 'user-bob';

const empty = () => createEmptyPendingNoteChanges();
const edited = (state, noteId, byUserId, at = 1000) =>
	applyNoteEdited(state, { noteId, byUserId, at, authUserId: ME });
const listDiff = (state, added, removed, byUserId, at = 1000, viaReconcile = false) =>
	applyNoteListDiff(state, { added, removed, byUserId, at, authUserId: ME, viaReconcile });

describe('diffing the note list', () => {
	it('reports what appeared and what went', () => {
		const result = diffNoteIds(['a', 'b', 'c'], ['b', 'c', 'd']);
		assert.deepEqual(result.added, ['d']);
		assert.deepEqual(result.removed, ['a']);
	});

	it('ignores a pure reorder', () => {
		// A reorder is not worth interrupting anyone about, and canonical order is the registry's
		// business anyway.
		const result = diffNoteIds(['a', 'b', 'c'], ['c', 'a', 'b']);
		assert.deepEqual(result.added, []);
		assert.deepEqual(result.removed, []);
	});

	it('handles the empty cases without inventing changes', () => {
		assert.deepEqual(diffNoteIds([], []), { added: [], removed: [] });
		assert.deepEqual(diffNoteIds([], ['a']), { added: ['a'], removed: [] });
		assert.deepEqual(diffNoteIds(['a'], []), { added: [], removed: ['a'] });
	});

	it('is not confused by duplicates in either list', () => {
		const result = diffNoteIds(['a', 'a'], ['a', 'b', 'b']);
		assert.deepEqual(result.added, ['b']);
		assert.deepEqual(result.removed, []);
	});
});

describe('whose change is it', () => {
	it('ignores my own edit entirely', () => {
		// A note I changed on another device should simply be up to date here.
		const state = edited(empty(), 'note-1', ME);
		assert.equal(state.size, 0);
	});

	it('ignores my own additions and removals', () => {
		const state = listDiff(empty(), ['new-1'], ['gone-1'], ME);
		assert.equal(state.size, 0);
	});

	it('holds somebody else’s edit', () => {
		const state = edited(empty(), 'note-1', ALICE);
		assert.equal(state.size, 1);
		assert.equal(state.get('note-1').kind, 'edited');
		assert.equal(state.get('note-1').byUserId, ALICE);
	});

	it('treats an UNATTRIBUTED change as somebody else’s', () => {
		// Attribution rides on a live event, so a change that arrived while disconnected has none.
		// Deferring shows a prompt that may be unnecessary; the alternative rearranges the grid
		// under the user's hands. The first mistake is the cheaper one.
		const state = edited(empty(), 'note-1', null);
		assert.equal(state.size, 1);
		assert.equal(state.get('note-1').byUserId, null);
	});

	it('does not mistake a change for mine when nobody is signed in', () => {
		const state = applyNoteEdited(empty(), { noteId: 'note-1', byUserId: null, at: 1, authUserId: null });
		assert.equal(state.size, 1);
	});
});

describe('precedence when a note changes more than once', () => {
	it('a note that arrived and left unseen is not news', () => {
		let state = listDiff(empty(), ['note-1'], [], ALICE);
		state = listDiff(state, [], ['note-1'], ALICE, 2000);
		assert.equal(state.size, 0, 'both sides cancel');
	});

	it('a note that came back before you looked is not news either', () => {
		let state = listDiff(empty(), [], ['note-1'], ALICE);
		state = listDiff(state, ['note-1'], [], ALICE, 2000);
		assert.equal(state.size, 0);
	});

	it('an edit to a pending-new note leaves it simply "new"', () => {
		let state = listDiff(empty(), ['note-1'], [], ALICE);
		state = edited(state, 'note-1', BOB, 2000);
		assert.equal(state.size, 1);
		assert.equal(state.get('note-1').kind, 'added');
		assert.equal(state.get('note-1').byUserId, BOB, 'but the later editor is remembered');
		assert.equal(state.get('note-1').at, 2000);
	});

	it('a removal beats a pending edit — structure wins over content', () => {
		let state = edited(empty(), 'note-1', ALICE);
		state = listDiff(state, [], ['note-1'], BOB, 2000);
		assert.equal(state.get('note-1').kind, 'removed');
	});

	it('an edit does not override a pending removal', () => {
		// A dimmed card that is going away should not also claim to have changed.
		let state = listDiff(empty(), [], ['note-1'], ALICE);
		state = edited(state, 'note-1', BOB, 2000);
		assert.equal(state.get('note-1').kind, 'removed');
	});

	it('two edits collapse to one entry, attributed to the later editor', () => {
		let state = edited(empty(), 'note-1', ALICE, 1000);
		state = edited(state, 'note-1', BOB, 2000);
		assert.equal(state.size, 1);
		assert.equal(state.get('note-1').byUserId, BOB);
		assert.equal(state.get('note-1').at, 2000);
	});

	it('keeps one entry per note however many notes are involved', () => {
		let state = listDiff(empty(), ['a', 'b'], ['c'], ALICE);
		state = edited(state, 'd', BOB, 2000);
		assert.equal(state.size, 4);
	});
});

describe('resolving', () => {
	it('clears one note when the user opens it', () => {
		let state = edited(empty(), 'note-1', ALICE);
		state = edited(state, 'note-2', ALICE);
		state = resolveNoteChange(state, 'note-1');
		assert.equal(state.size, 1);
		assert.ok(!state.has('note-1'));
	});

	it('returns the SAME object when there was nothing to resolve', () => {
		// So a caller can skip a re-render rather than churn one.
		const state = edited(empty(), 'note-1', ALICE);
		assert.equal(resolveNoteChange(state, 'not-pending'), state);
		assert.equal(resolveNoteChange(state, ''), state);
	});

	it('a flush clears everything', () => {
		let state = listDiff(empty(), ['a'], ['b'], ALICE);
		state = edited(state, 'c', BOB);
		assert.equal(clearPendingNoteChanges(state).size, 0);
	});

	it('flushing an empty state returns the same object', () => {
		const state = empty();
		assert.equal(clearPendingNoteChanges(state), state);
	});
});

describe('what the grid and the pill read', () => {
	it('separates ids to withhold from ids to keep showing', () => {
		let state = listDiff(empty(), ['new-1', 'new-2'], ['gone-1'], ALICE);
		state = edited(state, 'changed-1', BOB, 2000);

		// Rendering these would be the shift the whole mechanism exists to prevent.
		assert.deepEqual([...pendingAddedNoteIds(state)].sort(), ['new-1', 'new-2']);
		// Letting these vanish is what closes the gap and moves everything below.
		assert.deepEqual([...pendingRemovedNoteIds(state)], ['gone-1']);
		// These stay live and correct, and earn a chip.
		assert.deepEqual([...pendingEditedNoteChanges(state).keys()], ['changed-1']);
	});

	it('counts each kind for the popover', () => {
		let state = listDiff(empty(), ['a', 'b', 'c'], ['d'], ALICE);
		state = edited(state, 'e', BOB, 2000);
		const summary = summarisePendingNoteChanges(state);
		assert.equal(summary.added, 3);
		assert.equal(summary.removed, 1);
		assert.equal(summary.edited, 1);
		assert.equal(summary.total, 5);
	});

	it('lists contributors most recent first', () => {
		let state = edited(empty(), 'note-1', ALICE, 1000);
		state = edited(state, 'note-2', BOB, 5000);
		assert.deepEqual(summarisePendingNoteChanges(state).userIds, [BOB, ALICE]);
	});

	it('does not list an unattributed change as a contributor', () => {
		const state = edited(empty(), 'note-1', null);
		const summary = summarisePendingNoteChanges(state);
		assert.equal(summary.total, 1);
		assert.deepEqual(summary.userIds, []);
	});

	it('reports nothing for an empty state', () => {
		const summary = summarisePendingNoteChanges(empty());
		assert.deepEqual(summary, { added: 0, removed: 0, edited: 0, total: 0, structural: 0, userIds: [] });
		assert.equal(pendingAddedNoteIds(empty()).size, 0);
		assert.equal(pendingRemovedNoteIds(empty()).size, 0);
	});
});

describe('the two races found in testing D and E', () => {
	const NOW = 100_000;
	const resolve = (overrides = {}) => resolveNoteListChangeAuthor({
		isLocalTransaction: false,
		isServerReconcile: false,
		userInitiatedAt: null,
		userActionWindowMs: 30_000,
		authUserId: ME,
		attribution: null,
		now: NOW,
		windowMs: 15_000,
		...overrides,
	});

	it('TEST D: a LOCAL registry repair of somebody else\u2019s note is an arrival', () => {
		// createNote used to write notesList and noteOrder in two transactions, so a collaborator
		// could see the list entry before the order entry - and THEIR grid's self-healing repair
		// wrote the missing id into noteOrder itself. Measured as `local: true` on the receiving
		// device, which credited the note to the wrong person and applied it instantly.
		assert.equal(resolve({ isLocalTransaction: true, isServerReconcile: true }), null);
	});

	it('TEST D: an ordinary local write is still instant', () => {
		// The fix must not make creating your own note wait.
		assert.equal(resolve({ isLocalTransaction: true, isServerReconcile: false }), ME);
	});

	it('TEST E: the device that pressed Accept wins even when the write arrived REMOTELY', () => {
		// Accepting fires a reconcile on every device at once; whichever wins the race writes it,
		// so the accepting device can see its own acceptance arrive as a remote update. Measured as
		// `local: false` on the accepting device, which held it and showed the chip there.
		assert.equal(resolve({ isLocalTransaction: false, userInitiatedAt: NOW - 3_000 }), ME);
	});

	it('TEST E: the OTHER device, which pressed nothing, still gets it announced', () => {
		assert.equal(resolve({ isLocalTransaction: false, userInitiatedAt: null }), null);
	});

	it('a user action here beats a remote attribution naming somebody else', () => {
		// You accepted it; whoever the server says touched the registry is not the point.
		assert.equal(
			resolve({ isLocalTransaction: false, userInitiatedAt: NOW - 1_000, attribution: { byUserId: ALICE, at: NOW } }),
			ME
		);
	});

	it('once the action window closes, a remote add is announced again', () => {
		assert.equal(resolve({ isLocalTransaction: false, userInitiatedAt: NOW - 30_000 }), null);
	});
});

describe('the chip counts changes that are WAITING, not edits', () => {
	it('reports added + removed as structural, excluding edits', () => {
		// The chip's button says "Apply changes". An edited note has nothing to apply: the card has
		// already resized and the grid has already repacked, because deferring the rebalance was
		// planned and never built. So edits are announced on the card and nowhere else.
		let state = listDiff(empty(), ['a', 'b'], ['c'], ALICE);
		state = edited(state, 'd', BOB, 2000);
		const summary = summarisePendingNoteChanges(state);
		assert.equal(summary.added, 2);
		assert.equal(summary.removed, 1);
		assert.equal(summary.edited, 1);
		assert.equal(summary.total, 4, 'total still counts everything pending');
		assert.equal(summary.structural, 3, 'but only added + removed are waiting to be applied');
	});

	it('reports nothing structural when only edits are pending, so the chip stays hidden', () => {
		let state = edited(empty(), 'note-1', ALICE, 1000);
		state = edited(state, 'note-2', BOB, 2000);
		const summary = summarisePendingNoteChanges(state);
		assert.equal(summary.total, 2);
		assert.equal(summary.structural, 0);
	});

	it('is zero for an empty state', () => {
		assert.equal(summarisePendingNoteChanges(empty()).structural, 0);
	});
});

describe('a reconcile is not the same as the user doing something', () => {
	const NOW = 100_000;
	const resolve = (overrides = {}) => resolveNoteListChangeAuthor({
		isLocalTransaction: true,
		isServerReconcile: true,
		userInitiatedAt: null,
		userActionWindowMs: 30_000,
		authUserId: ME,
		attribution: null,
		now: NOW,
		windowMs: 15_000,
		...overrides,
	});

	it('treats a reconcile nobody asked for here as an ARRIVAL', () => {
		// Accepting a shared note fires a note-share event to EVERY device the user has open, and
		// each one writes the alias into its own noteOrder. That write is local everywhere, so
		// without this the note appeared instantly on all of them.
		assert.equal(resolve(), null, 'falls through to the remote path, so it gets announced');
	});

	it('credits the device where the user actually pressed Accept', () => {
		assert.equal(resolve({ userInitiatedAt: NOW - 2_000 }), ME);
	});

	it('stops crediting once the user action is old enough to be unrelated', () => {
		assert.equal(resolve({ userInitiatedAt: NOW - 30_000 }), null);
		assert.equal(resolve({ userInitiatedAt: NOW - 120_000 }), null);
	});

	it('uses the generous user-action window, not the attribution window', () => {
		// 20s is past the 15s attribution window but inside the 30s user-action window. Accepting a
		// share can involve a workspace switch and several requests, and being wrong here means the
		// note does not show up on the device you accepted it on.
		assert.equal(resolve({ userInitiatedAt: NOW - 20_000 }), ME);
	});

	it('falls back to windowMs when no user-action window is given', () => {
		assert.equal(resolve({ userInitiatedAt: NOW - 20_000, userActionWindowMs: undefined }), null);
		assert.equal(resolve({ userInitiatedAt: NOW - 10_000, userActionWindowMs: undefined }), ME);
	});

	it('leaves an ordinary local write alone', () => {
		// Creating or deleting a note is not a reconcile, so it is instant regardless.
		assert.equal(resolve({ isServerReconcile: false }), ME);
		assert.equal(resolve({ isServerReconcile: undefined }), ME);
	});

	it('still uses remote attribution for a genuinely remote change', () => {
		assert.equal(
			resolve({ isLocalTransaction: false, attribution: { byUserId: ALICE, at: NOW - 1_000 } }),
			ALICE
		);
	});

	it('exports a non-empty origin constant to tag writes with', () => {
		// A falsy origin would make `transaction.origin === ORIGIN` true for every untagged
		// transaction, which would invert the whole rule.
		assert.equal(typeof NOTE_ORDER_RECONCILE_ORIGIN, 'string');
		assert.ok(NOTE_ORDER_RECONCILE_ORIGIN.length > 0);
	});
});

describe('resolveNoteListChangeAuthor', () => {
	const NOW = 100_000;
	const resolve = (overrides = {}) => resolveNoteListChangeAuthor({
		isLocalTransaction: false,
		authUserId: ME,
		attribution: null,
		now: NOW,
		windowMs: 15_000,
		...overrides,
	});

	it('credits a LOCAL transaction to the signed-in user immediately', () => {
		// THE REGRESSION TEST. Creating a note fires this observer at once, but its attribution
		// event is debounced 10s server-side - so anything that waits for attribution withholds
		// every note the user makes from the user who made it. Reported exactly that way.
		assert.equal(resolve({ isLocalTransaction: true }), ME);
	});

	it('credits a local transaction without consulting attribution at all', () => {
		// Even a fresh attribution naming somebody else loses: the transaction is local, so this
		// client did it, whatever the server has got round to saying.
		assert.equal(
			resolve({ isLocalTransaction: true, attribution: { byUserId: ALICE, at: NOW } }),
			ME
		);
	});

	it('returns null for a local transaction before the user id is known', () => {
		assert.equal(resolve({ isLocalTransaction: true, authUserId: null }), null);
	});

	it('uses the metadata attribution for a REMOTE change', () => {
		assert.equal(resolve({ attribution: { byUserId: ALICE, at: NOW - 1_000 } }), ALICE);
	});

	it('does NOT credit a remote change to you just because attribution names you', () => {
		// The window that broke test D. The attribution event is 10s debounced and carries no note
		// ids, so for ~15s after your own note-list change is announced back to you the ref still
		// names you - and the next note anybody else added got credited to you and applied
		// silently. "Meshuga created a note and it appeared instantly for Daxton" was this.
		assert.equal(resolve({ attribution: { byUserId: ME, at: NOW - 1_000 } }), null);
	});

	it('still credits a remote change to the person who actually made it', () => {
		// The fix above must not become "ignore all remote attribution" - somebody else's id is
		// still the right answer, and it is what a dimmed-removal chip will need.
		assert.equal(resolve({ attribution: { byUserId: BOB, at: NOW - 500 } }), BOB);
	});

	it('ignores attribution that has gone stale', () => {
		// The registry update and the metadata event are not ordered with respect to each other,
		// so they are correlated by time - and an old attribution must not be reused.
		assert.equal(resolve({ attribution: { byUserId: ALICE, at: NOW - 15_000 } }), null);
		assert.equal(resolve({ attribution: { byUserId: ALICE, at: NOW - 60_000 } }), null);
	});

	it('returns null for a remote change with no attribution', () => {
		// Which pendingNoteChanges then treats as somebody else's - the deliberate choice, since a
		// change that arrived while disconnected has no attribution to find.
		assert.equal(resolve({ attribution: null }), null);
	});
});

describe('own changes are never withheld end to end', () => {
	it('a locally created note is not pending', () => {
		const byUserId = resolveNoteListChangeAuthor({
			isLocalTransaction: true,
			authUserId: ME,
			attribution: null,
			now: 1000,
			windowMs: 15_000,
		});
		const state = applyNoteListDiff(empty(), {
			added: ['note-new'],
			removed: [],
			byUserId,
			at: 1000,
			authUserId: ME,
		});
		assert.equal(state.size, 0, 'the note the user just made must go straight onto the grid');
	});

	it('a locally deleted note is not pending either', () => {
		// Same path, same bug: deleting your own note used to count as somebody else removing it.
		const byUserId = resolveNoteListChangeAuthor({
			isLocalTransaction: true,
			authUserId: ME,
			attribution: null,
			now: 1000,
			windowMs: 15_000,
		});
		const state = applyNoteListDiff(empty(), {
			added: [],
			removed: ['note-gone'],
			byUserId,
			at: 1000,
			authUserId: ME,
		});
		assert.equal(state.size, 0);
	});

	it('but a remote unattributed add IS still held', () => {
		const byUserId = resolveNoteListChangeAuthor({
			isLocalTransaction: false,
			authUserId: ME,
			attribution: null,
			now: 1000,
			windowMs: 15_000,
		});
		const state = applyNoteListDiff(empty(), {
			added: ['note-theirs'],
			removed: [],
			byUserId,
			at: 1000,
			authUserId: ME,
		});
		assert.deepEqual([...pendingAddedNoteIds(state)], ['note-theirs']);
	});
});

describe('contributors', () => {
	it('records the one person who changed a note', () => {
		const state = edited(empty(), 'note-1', ALICE, 1000);
		assert.deepEqual(state.get('note-1').contributors, [{ userId: ALICE, at: 1000 }]);
	});

	it('keeps BOTH people when two of them edit the same note', () => {
		// This is the whole reason contributors exist. `byUserId` only ever holds the latest, so
		// chips built from it silently drop everyone else - and two people editing one note before
		// you look at it is the normal case in a shared workspace, not an edge case.
		let state = edited(empty(), 'note-1', ALICE, 1000);
		state = edited(state, 'note-1', BOB, 2000);
		assert.deepEqual(state.get('note-1').contributors, [
			{ userId: BOB, at: 2000 },
			{ userId: ALICE, at: 1000 },
		]);
		assert.equal(state.get('note-1').byUserId, BOB, 'byUserId still holds only the latest');
	});

	it('orders contributors most recent first regardless of arrival order', () => {
		// A late event carrying an older timestamp must not jump the queue.
		let state = edited(empty(), 'note-1', ALICE, 5000);
		state = edited(state, 'note-1', BOB, 1000);
		assert.deepEqual(state.get('note-1').contributors.map((entry) => entry.userId), [ALICE, BOB]);
	});

	it('counts a repeat editor once, at their latest time', () => {
		let state = edited(empty(), 'note-1', ALICE, 1000);
		state = edited(state, 'note-1', ALICE, 4000);
		state = edited(state, 'note-1', ALICE, 2000);
		assert.deepEqual(state.get('note-1').contributors, [{ userId: ALICE, at: 4000 }]);
	});

	it('adds nobody for an unattributed change, but still records the change', () => {
		const state = edited(empty(), 'note-1', null);
		assert.deepEqual(state.get('note-1').contributors, []);
		assert.equal(state.size, 1, 'the change itself is still pending');
	});

	it('keeps the person who added a note when somebody else then edits it', () => {
		let state = listDiff(empty(), ['note-1'], [], ALICE, 1000);
		state = edited(state, 'note-1', BOB, 2000);
		const change = state.get('note-1');
		assert.equal(change.kind, 'added', 'still simply new');
		assert.deepEqual(change.contributors.map((entry) => entry.userId), [BOB, ALICE]);
	});

	it('does not credit an editor on a note that is on its way out', () => {
		// A dimmed card names whoever removed it. Adding "and Bob typed in it" to a card about to
		// disappear is noise, which is why removed+edited deliberately keeps the existing entry.
		let state = listDiff(empty(), [], ['note-1'], ALICE, 1000);
		state = edited(state, 'note-1', BOB, 2000);
		const change = state.get('note-1');
		assert.equal(change.kind, 'removed');
		assert.deepEqual(change.contributors.map((entry) => entry.userId), [ALICE]);
	});

	it('summarises every contributor, not only the last editor of each note', () => {
		let state = edited(empty(), 'note-1', ALICE, 1000);
		state = edited(state, 'note-1', BOB, 2000);
		// Before contributors existed this reported [BOB] only - ALICE was overwritten.
		assert.deepEqual(summarisePendingNoteChanges(state).userIds, [BOB, ALICE]);
	});

	it('keeps fold order when two contributors share a timestamp', () => {
		// One coalesced server event covers several people and the client stamps them all with the
		// same `at`, so ordering CANNOT come from the timestamp there - it comes from fold order,
		// most recent first, which is the order the server sends. Locked down because a refactor
		// that sorted differently would silently draw the chips oldest-first exactly when edits
		// arrive fastest.
		let state = edited(empty(), 'note-1', BOB, 7000);
		state = edited(state, 'note-1', ALICE, 7000);
		assert.deepEqual(state.get('note-1').contributors.map((entry) => entry.userId), [BOB, ALICE]);
	});

	it('places an older contributor behind newer ones already recorded', () => {
		let state = edited(empty(), 'note-1', ALICE, 1000);
		state = edited(state, 'note-1', BOB, 9000);
		state = edited(state, 'note-1', 'user-carol', 9000);
		assert.deepEqual(
			state.get('note-1').contributors.map((entry) => entry.userId),
			[BOB, 'user-carol', ALICE],
			'the two at 9000 keep fold order, and Alice at 1000 trails both'
		);
	});

	it('does not resurrect a contributor after the note is resolved', () => {
		let state = edited(empty(), 'note-1', ALICE, 1000);
		state = resolveNoteChange(state, 'note-1');
		assert.deepEqual(summarisePendingNoteChanges(state).userIds, []);
	});
});

describe('a late attribution takes your own cross-device change back', () => {
	// The note list diffs locally and immediately; the attribution event is 10s behind it. So a
	// note made on your phone is ALWAYS held on your laptop first and can only be un-held here.
	const WINDOW = 15000;
	const retract = (state, changedUserIds, now = 11000) =>
		retractOwnNoteListChanges(state, { changedUserIds, authUserId: ME, now, windowMs: WINDOW });

	// How such an entry actually comes into being: remote transaction, no attribution yet.
	const heldUnattributed = (added, at = 1000) => listDiff(empty(), added, [], null, at);

	it('drops an unattributed add once the event names only you', () => {
		const state = retract(heldUnattributed(['note-1']), [ME]);
		assert.equal(state.size, 0);
	});

	it('NEVER drops a removal, however confidently the event names you', () => {
		// Reversed deliberately, from a measured failure: a collaborator trashed a note, the
		// tombstone was created correctly, and 757ms later an event naming only this user deleted
		// it. Those events are frequent - six in one two-minute session - because this device
		// writes the registry constantly, so the tombstone's survival was a timing coin-flip.
		//
		// Retracting a removal loses somebody else's deletion in silence. Keeping it means your
		// own deletion from another device lingers as a tombstone until you flush. Only one of
		// those is recoverable by the user.
		const state = retract(listDiff(empty(), [], ['note-1'], null, 1000), [ME]);
		assert.equal(state.size, 1, 'the tombstone must survive');
		assert.equal(state.get('note-1').kind, 'removed');
	});

	it('still drops an unattributed ADD, which is what it exists for', () => {
		const state = retract(heldUnattributed(['note-1']), [ME]);
		assert.equal(state.size, 0);
	});

	it('keeps it when the burst names anyone else as well', () => {
		// Two names means two writers coalesced into one announcement, and there is no way to say
		// which entry is whose. Anybody else's write had to pass through the server to get here,
		// so if their note arrived before this event fired they ARE in this list.
		const state = retract(heldUnattributed(['note-1', 'note-2']), [ME, ALICE]);
		assert.equal(state.size, 2);
	});

	it('keeps an entry already credited to somebody else', () => {
		// Known to be Alice's work. An event naming only you does not explain it.
		const state = retract(listDiff(empty(), ['note-1'], [], ALICE, 1000), [ME]);
		assert.equal(state.size, 1);
	});

	it('keeps an entry older than the window', () => {
		const state = retract(heldUnattributed(['note-1'], 1000), [ME], 1000 + WINDOW);
		assert.equal(state.size, 1);
	});

	it('retracts right up to the edge of the window', () => {
		const state = retract(heldUnattributed(['note-1'], 1000), [ME], 1000 + WINDOW - 1);
		assert.equal(state.size, 0);
	});

	it('covers the real delay, which is the server debounce', () => {
		// The event cannot arrive sooner than NOTE_CHANGE_DEBOUNCE_MS (10s) after the change, so a
		// window that does not reach past 10s would never fire for the case this exists for.
		const state = retract(heldUnattributed(['note-1'], 1000), [ME], 1000 + 10000);
		assert.equal(state.size, 0, 'a 10s-late event must still be able to claim its entry');
	});

	it('leaves edits alone', () => {
		// Edits arrive on a different event, and nothing about an edited note is being withheld.
		const state = retract(edited(empty(), 'note-1', null, 1000), [ME]);
		assert.equal(state.size, 1);
		assert.equal(state.get('note-1').kind, 'edited');
	});

	it('does nothing without an actor list', () => {
		const state = retractOwnNoteListChanges(heldUnattributed(['note-1']), {
			changedUserIds: [],
			authUserId: ME,
			now: 11000,
			windowMs: WINDOW,
		});
		assert.equal(state.size, 1);
	});

	it('does nothing when signed out', () => {
		const state = retractOwnNoteListChanges(heldUnattributed(['note-1']), {
			changedUserIds: [ME],
			authUserId: null,
			now: 11000,
			windowMs: WINDOW,
		});
		assert.equal(state.size, 1);
	});

	it('retracts only what the event explains, leaving the rest held', () => {
		let state = heldUnattributed(['mine'], 1000);
		state = listDiff(state, ['alices'], [], ALICE, 1000);
		state = retract(state, [ME]);
		assert.deepEqual([...state.keys()], ['alices']);
	});

	it('returns the same object when it retracts nothing', () => {
		const state = heldUnattributed(['note-1']);
		assert.equal(retract(state, [ALICE]), state, 'refused, so no re-render');
		const emptyState = empty();
		assert.equal(retract(emptyState, [ME]), emptyState, 'nothing pending, so no re-render');
	});

	it('never mutates the state it was given', () => {
		const original = heldUnattributed(['note-1']);
		const snapshot = [...original.entries()];
		retract(original, [ME]);
		assert.deepEqual([...original.entries()], snapshot);
	});
});

describe('a removal names one person: whoever removed it', () => {
	// The user's call, and the reason is worth keeping: a card on its way out should say "Alice
	// deleted this". A stack of chips from people who typed in it earlier reads as though they were
	// all party to the deletion.
	it('drops earlier editors when the note is removed', () => {
		let state = edited(empty(), 'note-1', ALICE, 1000);
		state = edited(state, 'note-1', BOB, 2000);
		assert.equal(state.get('note-1').contributors.length, 2);
		state = listDiff(state, [], ['note-1'], ALICE, 3000);
		const change = state.get('note-1');
		assert.equal(change.kind, 'removed');
		assert.deepEqual(change.contributors.map((c) => c.userId), [ALICE]);
	});

	it('still names the remover when somebody else edits it on the way out', () => {
		// foldChange deliberately does not re-attribute removed -> edited.
		let state = listDiff(empty(), [], ['note-1'], ALICE, 1000);
		state = edited(state, 'note-1', BOB, 2000);
		const change = state.get('note-1');
		assert.equal(change.kind, 'removed');
		assert.equal(change.byUserId, ALICE);
		assert.deepEqual(change.contributors.map((c) => c.userId), [ALICE]);
	});

	it('an unattributed removal has nobody to draw, but is still a removal', () => {
		const state = listDiff(empty(), [], ['note-1'], null, 1000);
		assert.equal(state.get('note-1').kind, 'removed');
		assert.deepEqual(state.get('note-1').contributors, []);
	});
});

describe('trashing is a removal, not an edit', () => {
	// DocumentManager.trashNote writes metadata.trashed and never touches noteOrder, so a
	// collaborator trashing a note used to arrive as a content change - while the grid filtered the
	// card out anyway. The chip said "edited" about a card that had vanished.
	const removed = (state, noteId, byUserId, at = 1000) =>
		applyNoteRemoved(state, { noteId, byUserId, at, authUserId: ME, reason: 'trashed' });

	it('records a removal', () => {
		const state = removed(empty(), 'note-1', ALICE);
		assert.equal(state.get('note-1').kind, 'removed');
		assert.equal(state.get('note-1').byUserId, ALICE);
	});

	it('is counted by the chip, because something is being withheld', () => {
		const summary = summarisePendingNoteChanges(removed(empty(), 'note-1', ALICE));
		assert.equal(summary.removed, 1);
		assert.equal(summary.structural, 1);
	});

	it('shows up in the ids the grid must keep rendering', () => {
		assert.deepEqual([...pendingRemovedNoteIds(removed(empty(), 'note-1', ALICE))], ['note-1']);
	});

	it('upgrades an existing edit to a removal', () => {
		let state = edited(empty(), 'note-1', ALICE, 1000);
		state = removed(state, 'note-1', ALICE, 2000);
		assert.equal(state.get('note-1').kind, 'removed');
	});

	it('is never pending when you trashed it yourself', () => {
		assert.equal(removed(empty(), 'note-1', ME).size, 0);
	});

	it('cancels out a note that was added unseen and then trashed', () => {
		let state = listDiff(empty(), ['note-1'], [], ALICE, 1000);
		state = removed(state, 'note-1', ALICE, 2000);
		assert.equal(state.size, 0, 'it arrived and left without ever being seen');
	});
});

describe('what wears an overlay', () => {
	it('is every edited and removed card, but never an added one', () => {
		let state = listDiff(empty(), ['new-note'], [], ALICE, 1000);
		state = edited(state, 'edited-note', ALICE, 1000);
		state = listDiff(state, [], ['gone-note'], BOB, 1000);
		const cards = pendingCardNoteChanges(state);
		assert.deepEqual([...cards.keys()].sort(), ['edited-note', 'gone-note']);
		assert.equal(cards.get('gone-note').kind, 'removed');
	});
});

describe('a tombstone is drawn first and named second', () => {
	// The trashing has to be caught the instant metadata.trashed flips, which is ~10s before the
	// server says who did it. So the chip starts anonymous and the name arrives later.
	const removed = (state, noteId, byUserId, at = 1000) =>
		applyNoteRemoved(state, { noteId, byUserId, at, authUserId: ME, reason: 'trashed' });
	const attribute = (state, noteId, byUserId, at = 11000) =>
		attributeNoteRemoval(state, { noteId, byUserId, at, authUserId: ME });

	it('fills in the name on an unattributed removal', () => {
		let state = removed(empty(), 'note-1', null, 1000);
		assert.equal(state.get('note-1').byUserId, null);
		state = attribute(state, 'note-1', ALICE);
		const change = state.get('note-1');
		assert.equal(change.kind, 'removed');
		assert.equal(change.byUserId, ALICE);
		assert.deepEqual(change.contributors.map((c) => c.userId), [ALICE]);
	});

	it('keeps the time the note WENT, not the time it was announced', () => {
		// Otherwise the chip's elapsed label resets from "3m" to "now" when the debounced
		// announcement for the deletion itself finally lands.
		let state = removed(empty(), 'note-1', null, 1000);
		state = attribute(state, 'note-1', ALICE, 11000);
		assert.equal(state.get('note-1').at, 1000);
		assert.equal(state.get('note-1').contributors[0].at, 1000);
	});

	it('retracts it when the announcement says it was you', () => {
		// You trashed it on your other device. Holding your own deletion behind a prompt is the
		// same absurdity as holding your own new note.
		const state = attribute(removed(empty(), 'note-1', null, 1000), 'note-1', ME);
		assert.equal(state.size, 0);
	});

	it('does not overwrite a name that is already there', () => {
		// A removal names whoever removed it; anybody announced afterwards was editing on the way
		// out.
		let state = removed(empty(), 'note-1', ALICE, 1000);
		state = attribute(state, 'note-1', BOB);
		assert.equal(state.get('note-1').byUserId, ALICE);
	});

	it('leaves an edited card alone', () => {
		const state = attribute(edited(empty(), 'note-1', null, 1000), 'note-1', ALICE);
		assert.equal(state.get('note-1').kind, 'edited');
		assert.equal(state.get('note-1').byUserId, null, 'this path is only for removals');
	});

	it('does nothing for a note that is not pending', () => {
		const state = empty();
		assert.equal(attribute(state, 'note-404', ALICE), state);
	});

	it('does nothing without a name to apply', () => {
		const state = removed(empty(), 'note-1', null, 1000);
		assert.equal(attribute(state, 'note-1', null), state);
	});

	it('never mutates the state it was given', () => {
		const original = removed(empty(), 'note-1', null, 1000);
		const snapshot = [...original.entries()];
		attribute(original, 'note-1', ALICE);
		assert.deepEqual([...original.entries()], snapshot);
	});
});

describe('why a note left decides what the card says', () => {
	const WINDOW = 15000;

	it('records the reason it was given', () => {
		const trashed = applyNoteRemoved(empty(), {
			noteId: 'n', byUserId: ALICE, at: 1000, authUserId: ME, reason: 'trashed',
		});
		assert.equal(trashed.get('n').removalReason, 'trashed');
		const revoked = applyNoteRemoved(empty(), {
			noteId: 'n', byUserId: ALICE, at: 1000, authUserId: ME, reason: 'revoked',
		});
		assert.equal(revoked.get('n').removalReason, 'revoked');
	});

	it('defaults a note-list removal to "deleted"', () => {
		// An id simply leaving the registry says nothing more specific than that.
		assert.equal(listDiff(empty(), [], ['n'], ALICE, 1000).get('n').removalReason, 'deleted');
	});

	it('keeps the SPECIFIC reason when a generic one follows it', () => {
		// This is the revocation sequence: the event names it as a revocation, and the alias prune
		// that follows is an anonymous note-list removal. "deleted" must not overwrite "revoked".
		let state = applyNoteRemoved(empty(), {
			noteId: 'n', byUserId: ALICE, at: 1000, authUserId: ME, reason: 'revoked',
		});
		state = listDiff(state, [], ['n'], null, 1200);
		assert.equal(state.get('n').removalReason, 'revoked');
	});

	it('keeps a name it already had when the second arrival is anonymous', () => {
		// Same sequence. Losing the name here is what left the card unable to say who did it.
		let state = applyNoteRemoved(empty(), {
			noteId: 'n', byUserId: ALICE, at: 1000, authUserId: ME, reason: 'revoked',
		});
		state = listDiff(state, [], ['n'], null, 1200);
		assert.equal(state.get('n').byUserId, ALICE);
		assert.deepEqual(state.get('n').contributors.map((c) => c.userId), [ALICE]);
	});
});

describe('a reconcile-born entry survives your own attribution', () => {
	// THE BUG FROM TESTING. Somebody revokes Daxton's access; HIS OWN device prunes the alias out
	// of its own registry; the server sees that write and names him as the actor, quite correctly.
	// Ten seconds later the event arrives naming nobody but him, and the retraction threw away the
	// tombstone that was explaining the revocation - the chip appeared and then vanished by itself.
	const WINDOW = 15000;
	const retract = (state, now = 11000) =>
		retractOwnNoteListChanges(state, { changedUserIds: [ME], authUserId: ME, now, windowMs: WINDOW });

	it('does not retract a removal this device wrote as a reconcile', () => {
		const state = retract(listDiff(empty(), [], ['n'], null, 1000, true));
		assert.equal(state.size, 1, 'the tombstone has to stay');
		assert.equal(state.get('n').kind, 'removed');
	});

	it('does not retract an explicit revocation entry either', () => {
		const state = retract(applyNoteRemoved(empty(), {
			noteId: 'n', byUserId: null, at: 1000, authUserId: ME, reason: 'revoked', viaReconcile: true,
		}));
		assert.equal(state.size, 1);
	});

	it('STILL retracts an ordinary remote change, which is the point of the feature', () => {
		// The cross-device own-note case must keep working: that diff is a remote transaction, not
		// a reconcile write, so it stays eligible.
		assert.equal(retract(listDiff(empty(), ['n'], [], null, 1000)).size, 0);
	});

	it('immunity is sticky across a second arrival', () => {
		let state = listDiff(empty(), [], ['n'], null, 1000, true);
		state = listDiff(state, [], ['n'], null, 1200);
		assert.equal(state.get('n').viaReconcile, true);
		assert.equal(retract(state).size, 1);
	});
});

describe('the note itself says who made it', () => {
	// The replacement for the time-window retraction on the path that matters. Driven by the note's
	// own createdByUserId, so it names exactly ONE note and needs no window - which is what makes
	// it behave the same on fibre and on a phone with two bars.
	const held = (ids, at = 1000) => listDiff(empty(), ids, [], null, at);
	const resolve = (state, noteId, authorUserId) =>
		resolveOwnPendingAdd(state, { noteId, authorUserId, authUserId: ME });

	it('releases a held note that says I created it', () => {
		assert.equal(resolve(held(['mine']), 'mine', ME).size, 0);
	});

	it('keeps a held note somebody else created', () => {
		const state = resolve(held(['theirs']), 'theirs', ALICE);
		assert.equal(state.size, 1);
	});

	it('keeps it when the note has no author - a legacy note', () => {
		// These are exactly the notes the old retraction still has to cover.
		const state = held(['old']);
		assert.equal(resolve(state, 'old', null), state, 'unchanged, same object');
	});

	it('releases only the note named, leaving others held', () => {
		let state = held(['mine', 'alsomine'], 1000);
		state = resolve(state, 'mine', ME);
		assert.deepEqual([...state.keys()], ['alsomine']);
	});

	it('does not touch an entry already credited to somebody else', () => {
		// The note's author and whoever put it on your grid are not always the same person, and a
		// known name beats an inferred one.
		const state = listDiff(empty(), ['shared'], [], ALICE, 1000);
		assert.equal(resolve(state, 'shared', ME).size, 1);
	});

	it('never releases a REMOVAL', () => {
		// The field says who MADE the note, not who got rid of it.
		const state = listDiff(empty(), [], ['gone'], null, 1000);
		assert.equal(resolve(state, 'gone', ME).size, 1);
	});

	it('never releases an EDIT', () => {
		const state = edited(empty(), 'note-1', null, 1000);
		assert.equal(resolve(state, 'note-1', ME).size, 1);
	});

	it('is unaffected by how old the entry is - there is no window', () => {
		// The whole point. A note held for ten minutes on a bad connection still releases the
		// instant its author becomes readable.
		const state = held(['mine'], 1);
		assert.equal(resolveOwnPendingAdd(state, {
			noteId: 'mine', authorUserId: ME, authUserId: ME,
		}).size, 0);
	});

	it('does nothing when signed out', () => {
		const state = held(['mine']);
		assert.equal(resolveOwnPendingAdd(state, {
			noteId: 'mine', authorUserId: ME, authUserId: null,
		}), state);
	});

	it('returns the same object when it changes nothing', () => {
		const state = held(['mine']);
		assert.equal(resolve(state, 'absent', ME), state);
	});

	it('never mutates the state it was given', () => {
		const original = held(['mine']);
		const snapshot = [...original.entries()];
		resolve(original, 'mine', ME);
		assert.deepEqual([...original.entries()], snapshot);
	});
});

describe('a held note that has since been trashed is obsolete', () => {
	// Reported from testing: Meshuga shared a note, Daxton accepted it on his desktop so his phone
	// held it behind the chip, and then Meshuga trashed it. The phone kept offering the note;
	// applying it showed the card and then hid it again - the grid moving twice to say nothing.
	//
	// foldChange already reaches this conclusion when both halves arrive as list changes. A
	// trashing never touches the note list, and a device meeting the note for the first time finds
	// the flag ALREADY true, so there is no transition for anything to observe.
	it('drops a held add', () => {
		const state = dropObsoleteWithheldNote(listDiff(empty(), ['shared'], [], ALICE, 1000), 'shared');
		assert.equal(state.size, 0);
	});

	it('leaves a tombstone alone', () => {
		// It is ABOUT the note being gone, so the note being gone is not a reason to discard it.
		const state = listDiff(empty(), [], ['gone'], ALICE, 1000);
		assert.equal(dropObsoleteWithheldNote(state, 'gone').size, 1);
	});

	it('leaves an edited card alone', () => {
		// Already on the grid; the grid's own filters deal with it being trashed.
		const state = edited(empty(), 'note-1', ALICE, 1000);
		assert.equal(dropObsoleteWithheldNote(state, 'note-1').size, 1);
	});

	it('returns the same object when there is nothing to drop', () => {
		const state = edited(empty(), 'note-1', ALICE);
		assert.equal(dropObsoleteWithheldNote(state, 'absent'), state);
	});

	it('leaves the chip counting nothing once the only held note goes', () => {
		let state = listDiff(empty(), ['shared'], [], ALICE, 1000);
		assert.equal(summarisePendingNoteChanges(state).structural, 1);
		state = dropObsoleteWithheldNote(state, 'shared');
		assert.equal(summarisePendingNoteChanges(state).structural, 0);
	});
});

describe('immutability', () => {
	it('never mutates the state it was given', () => {
		const original = edited(empty(), 'note-1', ALICE);
		const snapshot = [...original.entries()];
		applyNoteEdited(original, { noteId: 'note-2', byUserId: BOB, at: 2, authUserId: ME });
		applyNoteListDiff(original, { added: ['x'], removed: [], byUserId: BOB, at: 2, authUserId: ME });
		resolveNoteChange(original, 'note-1');
		clearPendingNoteChanges(original);
		assert.deepEqual([...original.entries()], snapshot);
	});

	it('returns the same object when a diff changes nothing', () => {
		const state = edited(empty(), 'note-1', ALICE);
		assert.equal(applyNoteListDiff(state, { added: [], removed: [], byUserId: BOB, at: 2, authUserId: ME }), state);
	});
});
