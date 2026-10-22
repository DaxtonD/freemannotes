'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for getVisibleNotes' `keepNoteIds` exemption.
//
// This is what holds a card on the grid after somebody else trashed it, and the
// reason it is an exemption INSIDE the filter rather than a re-insertion
// afterwards is the whole point: the note keeps whatever position the current
// sort gives it, instead of being spliced back in at a guessed index. A card
// that moves on its way out is the same complaint as a card that appears
// unannounced.
//
// Run individually:  node --test tests/visible-notes-held.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

require('ts-node/register/transpile-only');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getVisibleNotes } = require('../src/utilities/getVisibleNotes.ts');

let sequence = 0;
function note(id, overrides = {}) {
	sequence += 1;
	return {
		id,
		title: id,
		createdAt: sequence,
		updatedAt: sequence,
		collectionId: null,
		labelIds: [],
		reminderAt: null,
		isPinned: false,
		lastAccessedAt: new Date(sequence).toISOString(),
		trashed: false,
		archived: false,
		...overrides,
	};
}

const ids = (notes) => notes.map((entry) => entry.id);

describe('held notes survive the trash gate', () => {
	it('keeps a trashed note that is being held', () => {
		const notes = [note('a'), note('gone', { trashed: true }), note('b')];
		const visible = getVisibleNotes(notes, { keepNoteIds: new Set(['gone']) });
		assert.deepEqual(ids(visible), ['a', 'gone', 'b']);
	});

	it('still hides a trashed note that is NOT being held', () => {
		const notes = [note('a'), note('gone', { trashed: true })];
		assert.deepEqual(ids(getVisibleNotes(notes, {})), ['a']);
	});

	it('keeps an archived note that is being held', () => {
		const notes = [note('a'), note('gone', { archived: true })];
		const visible = getVisibleNotes(notes, { keepNoteIds: new Set(['gone']) });
		assert.deepEqual(ids(visible), ['a', 'gone']);
	});

	it('holds its position under a sort rather than being appended', () => {
		// The point of exempting inside the filter: the sort places it, so it does not move.
		const notes = [
			note('oldest', { createdAt: 1 }),
			note('middle', { createdAt: 2, trashed: true }),
			note('newest', { createdAt: 3 }),
		];
		const visible = getVisibleNotes(notes, {
			keepNoteIds: new Set(['middle']),
			sortMode: 'date-created',
			sortDirection: 'asc',
		});
		assert.deepEqual(ids(visible), ['oldest', 'middle', 'newest']);
	});
});

describe('a held note is not exempt from the user\'s own scoping', () => {
	// Those filters are the view the user chose. A card from a collection they are not looking at
	// has no position here to hold on to in the first place.
	it('is still filtered out by collection', () => {
		const notes = [note('in', { collectionId: 'c1' }), note('out', { collectionId: 'c2', trashed: true })];
		const visible = getVisibleNotes(notes, {
			keepNoteIds: new Set(['out']),
			selectedCollectionId: 'c1',
		});
		assert.deepEqual(ids(visible), ['in']);
	});

	it('is still filtered out by label', () => {
		const notes = [note('in', { labelIds: ['l1'] }), note('out', { labelIds: [], trashed: true })];
		const visible = getVisibleNotes(notes, {
			keepNoteIds: new Set(['out']),
			selectedLabelIds: ['l1'],
		});
		assert.deepEqual(ids(visible), ['in']);
	});
});

describe('trash view is unaffected', () => {
	it('shows trashed notes and still hides live ones', () => {
		const notes = [note('live'), note('dead', { trashed: true })];
		const visible = getVisibleNotes(notes, { showTrashed: true, keepNoteIds: new Set(['dead']) });
		assert.deepEqual(ids(visible), ['dead']);
	});
});
