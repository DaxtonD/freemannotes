const test = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const { YjsPersistenceAdapter } = require('../server/YjsPersistenceAdapter');

const VERSION_ID = '5f0e8a4b-1c2d-4e3f-9a8b-7c6d5e4f3a2b';
const ROOM = `markup:${VERSION_ID}`;

// A fake Prisma whose note tables blow up if touched: markup rooms must never read or write
// the `document`, `workspace` or `entityReference` tables.
function makePrisma({ failRead = false } = {}) {
	const store = { row: null, writes: 0, reads: 0 };
	const forbidden = new Proxy({}, {
		get: () => () => {
			throw new Error('markup rooms must not touch note tables');
		},
	});
	return {
		store,
		document: forbidden,
		workspace: forbidden,
		entityReference: forbidden,
		$queryRaw: async (_strings, versionId) => {
			store.reads += 1;
			assert.equal(versionId, VERSION_ID);
			if (failRead) throw new Error('database unavailable');
			return store.row ? [store.row] : [];
		},
		$executeRaw: async (_strings, versionId, state, stateVector) => {
			assert.equal(versionId, VERSION_ID);
			store.writes += 1;
			store.row = { state, state_vector: stateVector };
			return 1;
		},
	};
}

function quietConsole(t) {
	const info = console.info;
	const error = console.error;
	console.info = () => {};
	console.error = () => {};
	t.after(() => {
		console.info = info;
		console.error = error;
	});
}

test('opening and closing a markup room nobody drew in saves nothing', async (t) => {
	quietConsole(t);
	const prisma = makePrisma();
	const adapter = new YjsPersistenceAdapter(prisma, { debounceMs: 5 });
	const doc = new Y.Doc();
	await adapter.bindState(ROOM, doc);
	await adapter.writeState(ROOM, doc);
	assert.equal(prisma.store.reads, 1);
	assert.equal(prisma.store.writes, 0);
});

test('markup drawn in a room is saved to its own table and comes back when the room reopens', async (t) => {
	quietConsole(t);
	const prisma = makePrisma();
	const adapter = new YjsPersistenceAdapter(prisma, { debounceMs: 5 });

	const first = new Y.Doc();
	await adapter.bindState(ROOM, first);
	first.getMap('markups').set('m1', { id: 'm1', kind: 'rect', page: 1, x: 10, y: 20, w: 30, h: 40 });
	first.getMap('replies').set('r1', { id: 'r1', commentId: 'c1', text: 'ok' });
	await adapter.writeState(ROOM, first);
	assert.equal(prisma.store.writes, 1);

	const second = new Y.Doc();
	await adapter.bindState(ROOM, second);
	assert.deepEqual(second.getMap('markups').get('m1'), { id: 'm1', kind: 'rect', page: 1, x: 10, y: 20, w: 30, h: 40 });
	assert.equal(second.getMap('replies').get('r1').text, 'ok');

	// Reopened and closed without changes: no second write.
	await adapter.writeState(ROOM, second);
	assert.equal(prisma.store.writes, 1);
});

test('a room whose saved markup could not be read is never written back over it', async (t) => {
	quietConsole(t);
	const prisma = makePrisma({ failRead: true });
	const adapter = new YjsPersistenceAdapter(prisma, { debounceMs: 5 });
	const doc = new Y.Doc();
	await adapter.bindState(ROOM, doc);
	// A client syncs in its own (possibly partial) copy...
	doc.getMap('markups').set('partial', { id: 'partial', kind: 'ink', page: 1, points: [0, 0] });
	await new Promise((resolve) => setTimeout(resolve, 20));
	await adapter.writeState(ROOM, doc);
	// ...and it never replaces what's in the database.
	assert.equal(prisma.store.writes, 0);
});
