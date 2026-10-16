'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for noteDigestProjection.ts and noteDigestStore.ts — turning the
// server's note digest into card shells so a device that has never seen a note
// can draw it at the right size (issue 2: "I see 5 blank note cards, then the
// data populates and the cards resize").
//
// A digest shell is a HINT. It loses to a live document and to the device's own
// measured render snapshot, and that precedence is applied at RENDER time, not
// by these writes — which is why the merge here upserts rather than protecting
// what it finds. The first design wrote shells into the render snapshot and was
// clobbered by the grid's own debounced write within a couple of hundred
// milliseconds; the rules in noteDigestStore.ts explain that in full.
//
// Why these imports and not noteDigestSeed: the seed module pulls in `network`,
// whose chain reaches `debugLogger.ts`, which reads `import.meta.env` at module
// scope. That is Vite-only and cannot be downlevelled to CommonJS, so it is
// undefined under ts-node. Hence the split — the rules live somewhere a test can
// actually reach. (Both modules below import the snapshot type ONLY as a type,
// which is erased, so they stay loadable.)
//
// Run individually:  node --test tests/note-digest-seed.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

const store = new Map();
globalThis.window = {
	localStorage: {
		get length() { return store.size; },
		key: (index) => Array.from(store.keys())[index] ?? null,
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => { store.set(key, String(value)); },
		removeItem: (key) => { store.delete(key); },
		clear: () => { store.clear(); },
	},
};

require('ts-node/register/transpile-only');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
	digestEntryToSnapshotNote,
	mergeDigestShells,
} = require('../src/core/noteDigestProjection.ts');
const {
	clearAllNoteDigestShells,
	clearNoteDigestShells,
	mergeNoteDigestEntries,
	readNoteDigestShellById,
	readNoteDigestShells,
	writeNoteDigestShells,
} = require('../src/core/noteDigestStore.ts');

function digestEntry(overrides) {
	return {
		id: 'note-1',
		type: 'text',
		title: 'From the digest',
		contentPreview: 'some text',
		contentLength: 9,
		checklistItems: [],
		checklistItemCount: 0,
		checklistCompletedCount: 0,
		createdAt: 1000,
		updatedAt: 2000,
		collectionId: null,
		labelIds: [],
		drawingIds: [],
		bannerFile: null,
		trashed: false,
		archived: false,
		serverUpdatedAt: '2026-10-16T00:00:00.000Z',
		...overrides,
	};
}

describe('digest entry -> card shell', () => {
	it('carries across the fields that decide a card height', () => {
		const shell = digestEntryToSnapshotNote(digestEntry({
			title: 'Groceries',
			contentPreview: 'milk',
			collectionId: 'coll-1',
			labelIds: ['a', 'b'],
			bannerFile: 'banner.svg',
			createdAt: 111,
			updatedAt: 222,
		}));
		assert.equal(shell.id, 'note-1');
		assert.equal(shell.type, 'text');
		assert.equal(shell.title, 'Groceries');
		assert.equal(shell.content, 'milk');
		assert.equal(shell.collectionId, 'coll-1');
		assert.deepEqual(shell.labelIds, ['a', 'b']);
		assert.equal(shell.bannerFile, 'banner.svg');
		assert.equal(shell.createdAt, 111);
		assert.equal(shell.updatedAt, 222);
	});

	it('maps checklist rows, including which are done', () => {
		const shell = digestEntryToSnapshotNote(digestEntry({
			type: 'checklist',
			checklistItems: [{ text: 'milk', done: false }, { text: 'eggs', done: true }],
			checklistItemCount: 2,
			checklistCompletedCount: 1,
		}));
		assert.equal(shell.type, 'checklist');
		assert.equal(shell.checklistItems.length, 2);
		assert.equal(shell.checklistItems[0].text, 'milk');
		assert.equal(shell.checklistItems[0].completed, false);
		assert.equal(shell.checklistItems[1].text, 'eggs');
		assert.equal(shell.checklistItems[1].completed, true);
		// Row ids are positional and exist only for layout — the digest describes shape, not
		// identity, and a real document replaces the whole shell the moment it loads.
		assert.ok(shell.checklistItems[0].id.startsWith('digest-note-1-'));
		assert.notEqual(shell.checklistItems[0].id, shell.checklistItems[1].id);
	});

	it('normalises an unknown note type rather than passing it through', () => {
		assert.equal(digestEntryToSnapshotNote(digestEntry({ type: 'wat' })).type, 'text');
		assert.equal(digestEntryToSnapshotNote(digestEntry({ type: 'drawing' })).type, 'drawing');
		assert.equal(digestEntryToSnapshotNote(digestEntry({ type: 'checklist' })).type, 'checklist');
	});

	it('leaves what the digest cannot know at neutral defaults', () => {
		// Reminders, pins, note colour and the per-user banner preference are user- or
		// device-scoped and arrive by their own routes. Image/link/document counts are SQL rows
		// over /ws/metadata, not part of the Yjs document the digest projects. Guessing any of
		// them would put a wrong value into a cache that outlives the seed.
		const shell = digestEntryToSnapshotNote(digestEntry());
		assert.equal(shell.reminderAt, null);
		assert.equal(shell.isPinned, false);
		assert.equal(shell.colorToken, null);
		assert.equal(shell.hasSharedBannerPreference, false);
		assert.equal(shell.collaboratorCount, 0);
		assert.equal(shell.docId, null);
		assert.equal(shell.richContent, null);
		assert.deepEqual(shell.attachmentCounts, { images: 0, links: 0, drawings: 0, documents: 0 });
		assert.deepEqual(shell.previewLinks, []);
		assert.deepEqual(shell.previewCards, []);
	});

	it('does count attached drawings, because those it genuinely knows', () => {
		// drawingIds lives in the document itself (a top-level Y.Array), so unlike the other
		// attachment counts this one is real rather than a guess.
		const shell = digestEntryToSnapshotNote(digestEntry({ drawingIds: ['d1', 'd2'] }));
		assert.deepEqual(shell.drawingIds, ['d1', 'd2']);
		assert.equal(shell.attachmentCounts.drawings, 2);
	});

	it('preserves trashed and archived so a seeded card is filtered correctly', () => {
		const shell = digestEntryToSnapshotNote(digestEntry({ trashed: true, archived: true }));
		assert.equal(shell.trashed, true);
		assert.equal(shell.archived, true);
	});

	it('survives a malformed entry instead of producing a broken shell', () => {
		const shell = digestEntryToSnapshotNote({
			id: 'note-x',
			type: 'text',
			title: null,
			contentPreview: null,
			checklistItems: null,
			labelIds: null,
			drawingIds: null,
			createdAt: 'nonsense',
			updatedAt: undefined,
			bannerFile: undefined,
		});
		assert.equal(shell.title, '');
		assert.equal(shell.content, '');
		assert.deepEqual(shell.checklistItems, []);
		assert.deepEqual(shell.labelIds, []);
		assert.deepEqual(shell.drawingIds, []);
		assert.equal(shell.createdAt, 0);
		assert.equal(shell.updatedAt, 0);
		assert.equal(shell.bannerFile, null);
	});

	it('copies the arrays it is handed rather than aliasing them', () => {
		const entry = digestEntry({ labelIds: ['a'], drawingIds: ['d1'] });
		const shell = digestEntryToSnapshotNote(entry);
		entry.labelIds.push('b');
		entry.drawingIds.push('d2');
		assert.deepEqual(shell.labelIds, ['a'], 'label ids were copied');
		assert.deepEqual(shell.drawingIds, ['d1'], 'drawing ids were copied');
	});
});

describe('merging a digest page into the shell store', () => {
	const shellFor = (id, extra) => ({ ...digestEntryToSnapshotNote(digestEntry({ id })), ...extra });

	it('adds a shell for a note the store has never heard of', () => {
		const result = mergeDigestShells([], [digestEntry()]);
		assert.equal(result.added, 1);
		assert.equal(result.updated, 0);
		assert.equal(result.shells.length, 1);
		assert.equal(result.shells[0].title, 'From the digest');
	});

	it('refreshes a shell it already had, because the digest owns this store', () => {
		// Opposite of the render-time rule, and deliberately so. The cursor fetches in ascending
		// updatedAt order, so an entry for an id already present is by construction newer -
		// keeping the old one would leave the card stale forever.
		const result = mergeDigestShells(
			[shellFor('note-1', { title: 'stale title' })],
			[digestEntry({ id: 'note-1', title: 'fresh title' })]
		);
		assert.equal(result.added, 0);
		assert.equal(result.updated, 1);
		assert.equal(result.shells.length, 1);
		assert.equal(result.shells[0].title, 'fresh title');
	});

	it('keeps every existing shell the page does not mention', () => {
		// The digest is incremental, so a page is a slice and never a complete picture. Dropping
		// anything absent from it would empty the store on a quiet workspace.
		const result = mergeDigestShells(
			[shellFor('a'), shellFor('b')],
			[digestEntry({ id: 'c' })]
		);
		assert.equal(result.added, 1);
		assert.deepEqual(result.shells.map((shell) => shell.id).sort(), ['a', 'b', 'c']);
	});

	it('counts a within-page duplicate as one add, with the last entry winning', () => {
		// Last wins because later in a page means later in the cursor ordering, so it is the
		// newer projection of that note.
		const result = mergeDigestShells([], [
			digestEntry({ id: 'dupe', title: 'first' }),
			digestEntry({ id: 'dupe', title: 'second' }),
		]);
		assert.equal(result.added, 1);
		assert.equal(result.updated, 1);
		assert.equal(result.shells.length, 1);
		assert.equal(result.shells[0].title, 'second');
	});

	it('ignores entries with no usable id', () => {
		const result = mergeDigestShells([], [
			digestEntry({ id: '  ' }),
			digestEntry({ id: null }),
			digestEntry({ id: undefined }),
		]);
		assert.equal(result.added, 0);
		assert.deepEqual(result.shells, []);
	});

	it('matches on a trimmed id, so whitespace cannot smuggle in a duplicate', () => {
		const result = mergeDigestShells([shellFor('note-1')], [digestEntry({ id: ' note-1 ' })]);
		assert.equal(result.added, 0, 'a padded id is the same note');
		assert.equal(result.updated, 1);
		assert.equal(result.shells.length, 1);
		assert.equal(result.shells[0].id, 'note-1', 'the stored id is the trimmed one');
	});

	it('handles an empty page without touching anything', () => {
		const result = mergeDigestShells([shellFor('a')], []);
		assert.equal(result.added, 0);
		assert.equal(result.updated, 0);
		assert.deepEqual(result.shells.map((shell) => shell.id), ['a']);
	});
});

describe('the shell store', () => {
	beforeEach(() => { store.clear(); });

	it('round-trips what it was given', () => {
		const result = mergeNoteDigestEntries('ws-1', [digestEntry(), digestEntry({ id: 'note-2' })]);
		assert.deepEqual(result, { added: 2, updated: 0 });
		const shells = readNoteDigestShells('ws-1');
		assert.equal(shells.length, 2);
		assert.deepEqual(shells.map((shell) => shell.id).sort(), ['note-1', 'note-2']);
	});

	it('keeps workspaces apart', () => {
		mergeNoteDigestEntries('ws-1', [digestEntry({ id: 'in-one' })]);
		mergeNoteDigestEntries('ws-2', [digestEntry({ id: 'in-two' })]);
		assert.deepEqual(readNoteDigestShells('ws-1').map((shell) => shell.id), ['in-one']);
		assert.deepEqual(readNoteDigestShells('ws-2').map((shell) => shell.id), ['in-two']);
	});

	it('accumulates across pages, which is the whole point of the cursor', () => {
		mergeNoteDigestEntries('ws-1', [digestEntry({ id: 'page1-a' }), digestEntry({ id: 'page1-b' })]);
		mergeNoteDigestEntries('ws-1', [digestEntry({ id: 'page2-a' })]);
		assert.equal(readNoteDigestShells('ws-1').length, 3);
	});

	it('reads back as a map for the render path', () => {
		mergeNoteDigestEntries('ws-1', [digestEntry({ title: 'Mapped' })]);
		const byId = readNoteDigestShellById('ws-1');
		assert.equal(byId.get('note-1').title, 'Mapped');
		assert.equal(byId.get('nope'), undefined);
	});

	it('returns an empty list rather than throwing for anything unusable', () => {
		assert.deepEqual(readNoteDigestShells('never-written'), []);
		assert.deepEqual(readNoteDigestShells(null), []);
		assert.deepEqual(readNoteDigestShells(''), []);
		assert.equal(readNoteDigestShellById(null).size, 0);
	});

	it('discards a corrupt or wrong-version payload instead of surfacing junk', () => {
		// It is a render hint, so there is nothing worth salvaging and nothing worth migrating.
		store.set('freemannotes.noteDigestShells.v1.ws-1', 'not json at all');
		assert.deepEqual(readNoteDigestShells('ws-1'), []);
		store.set('freemannotes.noteDigestShells.v1.ws-1', JSON.stringify({ v: 99, shells: [{ id: 'x' }] }));
		assert.deepEqual(readNoteDigestShells('ws-1'), []);
		store.set('freemannotes.noteDigestShells.v1.ws-1', JSON.stringify({ v: 1, shells: 'nope' }));
		assert.deepEqual(readNoteDigestShells('ws-1'), []);
	});

	it('drops stored shells with no id, which could never match a card anyway', () => {
		store.set('freemannotes.noteDigestShells.v1.ws-1', JSON.stringify({
			v: 1,
			shells: [{ id: 'good' }, { id: '' }, null, 'string', { nope: true }],
		}));
		assert.deepEqual(readNoteDigestShells('ws-1').map((shell) => shell.id), ['good']);
	});

	it('caps the store, keeping the most recently updated notes', () => {
		// Those are the cards a person is most likely to see before their documents load.
		const many = [];
		for (let i = 0; i < 250; i++) many.push(digestEntry({ id: 'note-' + i, updatedAt: i }));
		mergeNoteDigestEntries('ws-1', many);
		const shells = readNoteDigestShells('ws-1');
		assert.equal(shells.length, 200, 'capped');
		const ids = new Set(shells.map((shell) => shell.id));
		assert.ok(ids.has('note-249'), 'kept the newest');
		assert.ok(!ids.has('note-0'), 'dropped the oldest');
		assert.equal(Math.min(...shells.map((shell) => shell.updatedAt)), 50);
	});

	it('does not write when a merge changed nothing', () => {
		writeNoteDigestShells('ws-1', [digestEntryToSnapshotNote(digestEntry())]);
		const before = store.get('freemannotes.noteDigestShells.v1.ws-1');
		assert.deepEqual(mergeNoteDigestEntries('ws-1', []), { added: 0, updated: 0 });
		assert.equal(store.get('freemannotes.noteDigestShells.v1.ws-1'), before);
	});

	it('clears one workspace, and all of them on logout', () => {
		mergeNoteDigestEntries('ws-1', [digestEntry()]);
		mergeNoteDigestEntries('ws-2', [digestEntry()]);
		clearNoteDigestShells('ws-1');
		assert.deepEqual(readNoteDigestShells('ws-1'), []);
		assert.equal(readNoteDigestShells('ws-2').length, 1, 'the other workspace is untouched');

		mergeNoteDigestEntries('ws-1', [digestEntry()]);
		store.set('unrelated.key', 'keep me');
		clearAllNoteDigestShells();
		assert.deepEqual(readNoteDigestShells('ws-1'), []);
		assert.deepEqual(readNoteDigestShells('ws-2'), [], 'a logout must leave no note titles behind');
		assert.equal(store.get('unrelated.key'), 'keep me', 'it only clears its own keys');
	});

	it('ignores a write with no workspace id rather than inventing a key', () => {
		writeNoteDigestShells('', [digestEntryToSnapshotNote(digestEntry())]);
		assert.equal(store.size, 0);
		assert.deepEqual(mergeNoteDigestEntries('', [digestEntry()]), { added: 0, updated: 0 });
		assert.equal(store.size, 0);
	});
});
