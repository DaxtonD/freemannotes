'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for recording WHO on the note itself (src/core/noteAuthorFields.ts).
//
// The claim this change rests on is worth testing directly rather than
// assuming: the actor travels WITH the note, on the same path as its title, so
// another device reads it out of the same update that told it anything changed.
//
// What it replaced: the actor arrived only on a /ws/metadata event that is
// debounced 10s server-side and carries NO note ids, so the client had to match
// "a note appeared" against "somebody did something" by timing. Three bugs came
// from that, and the 15s window at the centre of it was wrong on any connection
// it had not been tuned for.
//
// This imports noteAuthorFields rather than noteModel on purpose. noteModel's
// import chain reaches React components and CSS modules and cannot be loaded in
// Node at all — which is why the repo has never had a test for it. These field
// names are the wire contract across every client, so they are the last thing
// that should be untestable; the logic lives in a pure module for that reason,
// the same way pendingNoteChanges.ts does.
//
// Deliberately NOT covered, because it deliberately does not exist: a field for
// permanent deletion. Once a document is destroyed there is nothing left to read
// it from, and making the write flush first would need a timer — the thing this
// removes. That case keeps the old attribution path.
//
// Run individually:  node --test tests/note-author-fields.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

require('ts-node/register/transpile-only');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');

const {
	NOTE_CREATED_BY_FIELD,
	NOTE_TRASHED_BY_FIELD,
	readNoteCreatedBy,
	readNoteTrashedBy,
	setNoteCreatedBy,
	writeNoteTrashedBy,
} = require('../src/core/noteAuthorFields.ts');

const DAXTON = 'user-daxton';
const MESHUGA = 'user-meshuga';

/** A note as it exists just after creation. `author` omitted = legacy note. */
function newNote(author) {
	const doc = new Y.Doc();
	doc.transact(() => {
		const meta = doc.getMap('metadata');
		meta.set('type', 'text');
		meta.set('trashed', false);
	});
	if (author !== undefined) setNoteCreatedBy(doc, author);
	return doc;
}

/**
 * Trash a note the way setNoteTrashed does: flag, timestamp and actor, all in ONE transaction.
 * The single transaction is the behaviour under test, so it is modelled rather than described.
 */
function trash(doc, actorUserId) {
	doc.transact(() => {
		const meta = doc.getMap('metadata');
		meta.set('trashed', true);
		meta.set('trashedAt', new Date().toISOString());
		writeNoteTrashedBy(meta, true, actorUserId);
	});
}

function restore(doc) {
	doc.transact(() => {
		const meta = doc.getMap('metadata');
		meta.set('trashed', false);
		meta.set('trashedAt', null);
		writeNoteTrashedBy(meta, false);
	});
}

/** What another device ends up with after receiving this note. */
function receivedBy(doc) {
	const other = new Y.Doc();
	Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
	return other;
}

describe('who created it', () => {
	it('is readable back off the note', () => {
		assert.equal(readNoteCreatedBy(newNote(DAXTON)), DAXTON);
	});

	it('is absent, not null, when there is no signed-in user', () => {
		// A note made while signed out must be indistinguishable from a legacy note rather than
		// asserting that nobody made it — both mean "unknown" and both fall back the same way.
		const doc = newNote(null);
		assert.equal(readNoteCreatedBy(doc), null);
		assert.equal(doc.getMap('metadata').has(NOTE_CREATED_BY_FIELD), false);
	});

	it('reads null for a note created before the field existed', () => {
		assert.equal(readNoteCreatedBy(newNote()), null);
	});

	it('ignores an empty string', () => {
		assert.equal(readNoteCreatedBy(newNote('')), null);
	});
});

describe('who trashed it', () => {
	it('is recorded alongside the flag', () => {
		const doc = newNote(DAXTON);
		trash(doc, MESHUGA);
		assert.equal(doc.getMap('metadata').get('trashed'), true);
		assert.equal(readNoteTrashedBy(doc), MESHUGA);
	});

	it('lands in the SAME update as the flag, which is the whole point', () => {
		// If these could arrive separately, the receiving device would be back to guessing in the
		// gap between them — which is the entire bug this change exists to remove.
		const doc = newNote(DAXTON);
		const beforeTrash = Y.encodeStateAsUpdate(doc);
		trash(doc, MESHUGA);

		const other = new Y.Doc();
		Y.applyUpdate(other, beforeTrash);
		let sawTrashedWithoutActor = false;
		other.getMap('metadata').observe((event) => {
			if (!event.keysChanged.has('trashed')) return;
			if (other.getMap('metadata').get('trashed') !== true) return;
			if (readNoteTrashedBy(other) === null) sawTrashedWithoutActor = true;
		});
		Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));

		assert.equal(readNoteTrashedBy(other), MESHUGA);
		assert.equal(sawTrashedWithoutActor, false, 'the actor must never lag behind the flag');
	});

	it('is cleared on restore', () => {
		// A stale name left behind would let a later tombstone credit the wrong person.
		const doc = newNote(DAXTON);
		trash(doc, MESHUGA);
		restore(doc);
		assert.equal(readNoteTrashedBy(doc), null);
	});

	it('keeps a name already recorded when a later caller has nobody to name', () => {
		// Every pre-existing caller passes no actor. Those must not blank out a name that a
		// better-informed caller already wrote.
		const doc = newNote(DAXTON);
		trash(doc, MESHUGA);
		trash(doc, null);
		assert.equal(readNoteTrashedBy(doc), MESHUGA);
	});

	it('records nothing when nobody is known, rather than failing', () => {
		const doc = newNote(DAXTON);
		trash(doc, null);
		assert.equal(doc.getMap('metadata').get('trashed'), true);
		assert.equal(readNoteTrashedBy(doc), null, 'unknown, which falls back to the old path');
	});

	it('does not disturb the author', () => {
		const doc = newNote(DAXTON);
		trash(doc, MESHUGA);
		assert.equal(readNoteCreatedBy(doc), DAXTON, 'who made it is not who binned it');
	});
});

describe('the actor travels with the note', () => {
	it('arrives on another device as part of the note', () => {
		assert.equal(readNoteCreatedBy(receivedBy(newNote(DAXTON))), DAXTON);
	});

	it('survives being persisted and reloaded', () => {
		// The durability that lets a tombstone still name somebody after a refresh.
		const stored = Y.encodeStateAsUpdate(newNote(DAXTON));
		const reloaded = new Y.Doc();
		Y.applyUpdate(reloaded, stored);
		assert.equal(readNoteCreatedBy(reloaded), DAXTON);
	});

	it('needs no second message to become readable', () => {
		// The design claim, as a test: one update in, both actors available.
		const doc = newNote(DAXTON);
		trash(doc, MESHUGA);
		const other = receivedBy(doc);
		assert.equal(readNoteCreatedBy(other), DAXTON);
		assert.equal(readNoteTrashedBy(other), MESHUGA);
	});
});

describe('compatibility in both directions', () => {
	it('an older client merging in does not wipe the fields', () => {
		// An old build knows nothing about these keys. Merging its edits must not clear them.
		const doc = newNote(DAXTON);
		const oldClient = receivedBy(doc);
		oldClient.transact(() => { oldClient.getMap('metadata').set('updatedAt', Date.now()); });
		Y.applyUpdate(doc, Y.encodeStateAsUpdate(oldClient));
		assert.equal(readNoteCreatedBy(doc), DAXTON);
	});

	it("a new client reading an old client's note just gets null", () => {
		const oldNote = newNote();
		oldNote.transact(() => { oldNote.getMap('metadata').set('trashed', true); });
		const mine = receivedBy(oldNote);
		assert.equal(readNoteCreatedBy(mine), null);
		assert.equal(readNoteTrashedBy(mine), null);
		assert.equal(mine.getMap('metadata').get('trashed'), true, 'still works, just anonymous');
	});

	it('uses the field names the wire contract expects', () => {
		// These strings are shared across every client, so a rename is a breaking change.
		assert.equal(NOTE_CREATED_BY_FIELD, 'createdByUserId');
		assert.equal(NOTE_TRASHED_BY_FIELD, 'trashedByUserId');
	});
});
