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

// ─────────────────────────────────────────────────────────────────────────────
// What the refusal TELLS you.
//
// Preserving the data is only half the guard's job. The other half is saying
// WHICH bug this is, because "emptied after loading" and "never loaded" have no
// overlap in where you would look:
//
//   loaded then emptied -> something clears root types after bindState
//   load failed         -> bindState's catch deliberately does not throw, so a
//                          transient DB error leaves the doc empty on purpose
//   never bound         -> something is persisting a doc this adapter never
//                          hydrated
//
// The original incident destroyed its own evidence. These assertions are what
// stop the next one doing the same.
// ─────────────────────────────────────────────────────────────────────────────

/** Capture console.error while running fn. */
async function captureError(fn) {
	const lines = [];
	const original = console.error;
	console.error = (...args) => { lines.push(args.join(' ')); };
	try {
		await fn();
	} finally {
		console.error = original;
	}
	return lines.join('\n');
}

describe('the refusal explains itself', () => {
	it('says the doc LOADED OK and lost its content afterwards', async () => {
		const prisma = fakePrisma(4096);
		const adapter = adapterFor(prisma);
		adapter._bindOutcome.set(ROOM, { startedAt: Date.now(), source: 'postgres', bytes: 4096, error: null });
		const output = await captureError(() => adapter._persistDoc(ROOM, emptyDoc()));
		assert.match(output, /LOADED OK from postgres/);
		assert.match(output, /lost it afterwards/);
		assert.equal(prisma.calls.upserts.length, 0, 'and still refuses the write');
	});

	it('names a failed database read as the likely cause, with its message', async () => {
		// The path that actually exists: bindState catches a read error and lets the doc start
		// empty. If that is what happened, the refusal should say so rather than leaving it to be
		// rediscovered from first principles.
		const prisma = fakePrisma(4096);
		const adapter = adapterFor(prisma);
		adapter._bindOutcome.set(ROOM, {
			startedAt: Date.now(), source: 'read-failed', bytes: 0, error: 'connection terminated',
		});
		const output = await captureError(() => adapter._persistDoc(ROOM, emptyDoc()));
		assert.match(output, /LOAD FAILED/);
		assert.match(output, /connection terminated/);
		assert.match(output, /most likely cause/);
	});

	it('flags a doc that was never bound at all', async () => {
		const prisma = fakePrisma(4096);
		const output = await captureError(() => adapterFor(prisma)._persistDoc(ROOM, emptyDoc()));
		assert.match(output, /NEVER BOUND/);
	});

	it('distinguishes "bindState found nothing" from "the read failed"', async () => {
		// Conflating them would throw away the more interesting of the two.
		const prisma = fakePrisma(4096);
		const adapter = adapterFor(prisma);
		adapter._bindOutcome.set(ROOM, { startedAt: Date.now(), source: 'empty', bytes: 0, error: null });
		const output = await captureError(() => adapter._persistDoc(ROOM, emptyDoc()));
		assert.match(output, /LOADED EMPTY/);
		assert.doesNotMatch(output, /LOAD FAILED/);
	});

	it('counts repeats, so a loop reads as a loop', async () => {
		const prisma = fakePrisma(4096);
		const adapter = adapterFor(prisma);
		await captureError(() => adapter._persistDoc(ROOM, emptyDoc()));
		const second = await captureError(() => adapter._persistDoc(ROOM, emptyDoc()));
		assert.match(second, /refusals\s+:\s*2 for this room/);
	});

	it('always names the room and the stored byte count', async () => {
		const prisma = fakePrisma(4096);
		const output = await captureError(() => adapterFor(prisma)._persistDoc(ROOM, emptyDoc()));
		assert.ok(output.includes(ROOM), 'names the room');
		assert.match(output, /4096 stored bytes/);
	});

	it('says nothing at all on the normal path', async () => {
		// The guard must stay invisible for the writes that are fine, which is all of them.
		const prisma = fakePrisma(4096);
		const output = await captureError(() => adapterFor(prisma)._persistDoc(ROOM, docWithContent('hello')));
		assert.equal(output, '');
	});
});
