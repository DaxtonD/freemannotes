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
	clearPendingNoteChanges,
	createEmptyPendingNoteChanges,
	diffNoteIds,
	pendingAddedNoteIds,
	pendingEditedNoteChanges,
	pendingRemovedNoteIds,
	resolveNoteChange,
	resolveNoteListChangeAuthor,
	NOTE_ORDER_RECONCILE_ORIGIN,
	summarisePendingNoteChanges,
} = require('../src/core/pendingNoteChanges.ts');

const ME = 'user-me';
const ALICE = 'user-alice';
const BOB = 'user-bob';

const empty = () => createEmptyPendingNoteChanges();
const edited = (state, noteId, byUserId, at = 1000) =>
	applyNoteEdited(state, { noteId, byUserId, at, authUserId: ME });
const listDiff = (state, added, removed, byUserId, at = 1000) =>
	applyNoteListDiff(state, { added, removed, byUserId, at, authUserId: ME });

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
