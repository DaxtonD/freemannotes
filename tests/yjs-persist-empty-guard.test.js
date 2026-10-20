'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the empty-document guard in server/YjsPersistenceAdapter.js's
// _persistDoc.
//
// This exists because of real data loss: 23 notes in one workspace were blanked
// inside a 27-second window — `state` down to 2 bytes, `stateVector` with it —
// while the notes registry still held their titles. Whatever left an empty doc
// in memory, the upsert in _persistDoc is what made it permanent.
//
// The guard's safety rests on one fact about Yjs, so it is asserted here
// directly: DELETIONS ARE TOMBSTONES. A note the user emptied by hand still
// encodes to a large state, so "2 bytes" means "never held anything" rather
// than "content was removed". Without that property the guard would be a
// heuristic that could refuse a legitimate write.
//
// Run individually:  node --test tests/yjs-persist-empty-guard.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');

const { YjsPersistenceAdapter } = require('../server/YjsPersistenceAdapter');

const ROOM = 'ws-1:note-1';

/** Records what the adapter tried to do, and reports whatever `stored` says is on disk. */
function fakePrisma(storedBytes) {
	const calls = { upserts: [], findUniques: 0 };
	return {
		calls,
		document: {
			findUnique: async () => {
				calls.findUniques += 1;
				return storedBytes == null ? null : { state: Buffer.alloc(storedBytes) };
			},
			upsert: async (args) => {
				calls.upserts.push(args);
				return {};
			},
		},
	};
}

function adapterFor(prisma) {
	const adapter = new YjsPersistenceAdapter(prisma);
	// _persistDoc resolves a workspace id first; that lookup is not what is under test.
	adapter._workspaceIdForDocName = async () => 'ws-1';
	// Mention/reference extraction is fire-and-forget and needs models the fake does not have.
	adapter._syncEntityReferences = async () => {};
	return adapter;
}

const emptyDoc = () => new Y.Doc();

function docWithContent(text) {
	const doc = new Y.Doc();
	doc.getText('title').insert(0, text);
	return doc;
}

function docEmptiedByHand(text) {
	const doc = docWithContent(text);
	doc.getText('title').delete(0, doc.getText('title').length);
	return doc;
}

describe('the Yjs fact the guard depends on', () => {
	it('an empty document encodes to 2 bytes', () => {
		assert.equal(Y.encodeStateAsUpdate(emptyDoc()).length, 2);
	});

	it('a document emptied BY HAND stays large, because deletions are tombstones', () => {
		// This is the whole reason a byte test is safe here rather than a guess.
		const emptied = docEmptiedByHand('a real note that got cleared out');
		assert.equal(emptied.getText('title').length, 0, 'no visible content left');
		assert.ok(
			Y.encodeStateAsUpdate(emptied).length > 2,
			'but its state is NOT 2 bytes, so the guard cannot mistake it for a never-used doc'
		);
	});
});

describe('_persistDoc empty-document guard', () => {
	it('REFUSES to write an empty doc over stored content', async () => {
		const prisma = fakePrisma(4096);
		await adapterFor(prisma)._persistDoc(ROOM, emptyDoc());
		assert.equal(prisma.calls.upserts.length, 0, 'the stored bytes must survive');
		assert.equal(prisma.calls.findUniques, 1, 'it checked what was on disk first');
	});

	it('allows an empty doc when there is no row yet', async () => {
		const prisma = fakePrisma(null);
		await adapterFor(prisma)._persistDoc(ROOM, emptyDoc());
		assert.equal(prisma.calls.upserts.length, 1, 'a brand-new empty room may be created');
	});

	it('allows an empty doc when the stored row is also empty', async () => {
		const prisma = fakePrisma(2);
		await adapterFor(prisma)._persistDoc(ROOM, emptyDoc());
		assert.equal(prisma.calls.upserts.length, 1);
	});

	it('does not check the database at all on the normal path', async () => {
		// The guard must cost nothing for every ordinary save, which is almost all of them.
		const prisma = fakePrisma(4096);
		await adapterFor(prisma)._persistDoc(ROOM, docWithContent('hello'));
		assert.equal(prisma.calls.findUniques, 0, 'no extra query for a doc that has content');
		assert.equal(prisma.calls.upserts.length, 1);
	});

	it('still saves a note the user emptied by hand', async () => {
		// The case the guard must NOT block: real content deleted deliberately. Its tombstones
		// keep the state above the threshold, so it never reaches the guard.
		const prisma = fakePrisma(4096);
		await adapterFor(prisma)._persistDoc(ROOM, docEmptiedByHand('clear me out'));
		assert.equal(prisma.calls.upserts.length, 1, 'deleting all of a note is a legitimate save');
		assert.equal(prisma.calls.findUniques, 0);
	});

	it('survives the existence check failing, without writing the empty doc', async () => {
		// A failed lookup must not be read as "there is nothing stored" — that would reinstate
		// the exact loss this guard prevents.
		const prisma = fakePrisma(4096);
		prisma.document.findUnique = async () => { throw new Error('db down'); };
		await adapterFor(prisma)._persistDoc(ROOM, emptyDoc());
		assert.equal(prisma.calls.upserts.length, 1, 'cannot prove content exists, so it proceeds');
	});
});
