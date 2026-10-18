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
		assert.deepEqual(summary, { added: 0, removed: 0, edited: 0, total: 0, userIds: [] });
		assert.equal(pendingAddedNoteIds(empty()).size, 0);
		assert.equal(pendingRemovedNoteIds(empty()).size, 0);
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
