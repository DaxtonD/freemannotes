'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for src/core/pendingNoteChangeStore.ts — making "who changed this card"
// survive a reload.
//
// The value here is almost entirely in the failure modes, because this runs
// during startup and on a device that may be offline or in private mode:
//
//   • every read and write is wrapped, so a localStorage that THROWS (private
//     mode, blocked site data) degrades to in-memory chips instead of failing
//     to boot,
//   • only EDITED entries persist — added/removed still flush on reload, which
//     is the agreed behaviour and the reason a new note is not hidden forever,
//   • keys are scoped per user AND per workspace, because the stored ids are
//     other people's and a shared device must not leak them.
//
// Run individually:  node --test tests/pending-note-change-store.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

require('ts-node/register/transpile-only');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── A localStorage good enough to be wrong in the ways that matter ───────────
function installMemoryStorage(options = {}) {
	const map = new Map();
	const store = {
		get length() { return map.size; },
		key(index) { return [...map.keys()][index] ?? null; },
		getItem(key) {
			if (options.throwOnRead) throw new Error('read blocked');
			return map.has(key) ? map.get(key) : null;
		},
		setItem(key, value) {
			if (options.throwOnWrite) throw new Error('quota exceeded');
			map.set(key, String(value));
		},
		removeItem(key) {
			if (options.throwOnWrite) throw new Error('quota exceeded');
			map.delete(key);
		},
		_map: map,
	};
	globalThis.localStorage = store;
	return store;
}

const {
	clearAllPendingNoteChanges,
	loadPendingEditedChanges,
	savePendingEditedChanges,
} = require('../src/core/pendingNoteChangeStore.ts');

const USER = 'user-me';
const WORKSPACE = 'ws-1';
const KEY = `freemannotes.pendingNoteChanges.v1:${USER}::${WORKSPACE}`;

const edited = (noteId, contributors, at = 5_000) => [noteId, {
	noteId,
	kind: 'edited',
	byUserId: contributors[0]?.userId ?? null,
	at,
	contributors,
}];

const stateOf = (...entries) => new Map(entries);

describe('pendingNoteChangeStore — round trip', () => {
	beforeEach(() => { installMemoryStorage(); });

	it('restores an edited note with every contributor intact', () => {
		const state = stateOf(edited('note-1', [
			{ userId: 'user-bob', at: 9_000 },
			{ userId: 'user-alice', at: 8_000 },
		], 9_000));
		savePendingEditedChanges(USER, WORKSPACE, state);

		const restored = loadPendingEditedChanges(USER, WORKSPACE);
		assert.equal(restored.size, 1);
		const change = restored.get('note-1');
		assert.equal(change.kind, 'edited');
		assert.equal(change.at, 9_000);
		assert.equal(change.byUserId, 'user-bob');
		assert.deepEqual(change.contributors, [
			{ userId: 'user-bob', at: 9_000 },
			{ userId: 'user-alice', at: 8_000 },
		]);
	});

	it('persists ONLY edited entries', () => {
		// Added and removed deliberately flush on reload: a reload relays out the grid anyway, so
		// there is no shift to prevent, and withholding a new note across reloads hides it forever.
		const state = stateOf(
			edited('note-edited', [{ userId: 'user-alice', at: 1_000 }]),
			['note-added', { noteId: 'note-added', kind: 'added', byUserId: 'user-alice', at: 1_000, contributors: [{ userId: 'user-alice', at: 1_000 }] }],
			['note-removed', { noteId: 'note-removed', kind: 'removed', byUserId: 'user-alice', at: 1_000, contributors: [{ userId: 'user-alice', at: 1_000 }] }],
		);
		savePendingEditedChanges(USER, WORKSPACE, state);
		assert.deepEqual([...loadPendingEditedChanges(USER, WORKSPACE).keys()], ['note-edited']);
	});

	it('scopes storage per user and per workspace', () => {
		savePendingEditedChanges(USER, WORKSPACE, stateOf(edited('note-1', [{ userId: 'user-alice', at: 1_000 }])));
		assert.equal(loadPendingEditedChanges('user-someone-else', WORKSPACE).size, 0);
		assert.equal(loadPendingEditedChanges(USER, 'ws-other').size, 0);
		assert.equal(loadPendingEditedChanges(USER, WORKSPACE).size, 1);
	});

	it('removes the key rather than leaving an empty array behind', () => {
		savePendingEditedChanges(USER, WORKSPACE, stateOf(edited('note-1', [{ userId: 'user-alice', at: 1_000 }])));
		assert.ok(localStorage._map.has(KEY));
		savePendingEditedChanges(USER, WORKSPACE, new Map());
		assert.equal(localStorage._map.has(KEY), false, 'a stale [] keeps a dead workspace key alive forever');
	});

	it('keeps an unattributed edit, which still counts as somebody else’s', () => {
		savePendingEditedChanges(USER, WORKSPACE, stateOf(edited('note-1', [], 1_000)));
		const change = loadPendingEditedChanges(USER, WORKSPACE).get('note-1');
		assert.equal(change.byUserId, null);
		assert.deepEqual(change.contributors, []);
	});
});

describe('pendingNoteChangeStore — bounds', () => {
	beforeEach(() => { installMemoryStorage(); });

	it('KEEPS an old entry — there is deliberately no time expiry', () => {
		// "Somebody changed this and you have not looked" does not stop being true on a calendar.
		// The cap is the only bound, so nothing is discarded while there is room for it.
		const now = 100 * 24 * 60 * 60 * 1000;
		const ancient = now - 400 * 24 * 60 * 60 * 1000;
		savePendingEditedChanges(USER, WORKSPACE, stateOf(
			edited('fresh', [{ userId: 'user-alice', at: now - 1_000 }], now - 1_000),
			edited('ancient', [{ userId: 'user-alice', at: ancient }], ancient),
		));
		assert.deepEqual(
			[...loadPendingEditedChanges(USER, WORKSPACE).keys()].sort(),
			['ancient', 'fresh']
		);
	});

	it('caps the number of stored notes, keeping the newest', () => {
		const entries = [];
		for (let index = 0; index < 260; index += 1) {
			entries.push(edited(`note-${index}`, [{ userId: 'user-alice', at: 1_000 + index }], 1_000 + index));
		}
		savePendingEditedChanges(USER, WORKSPACE, stateOf(...entries));
		const restored = loadPendingEditedChanges(USER, WORKSPACE);
		assert.equal(restored.size, 200);
		assert.ok(restored.has('note-259'), 'newest kept');
		assert.equal(restored.has('note-0'), false, 'oldest dropped');
	});
});

describe('pendingNoteChangeStore — hostile environments', () => {
	it('returns an empty map when there is nothing stored', () => {
		installMemoryStorage();
		assert.equal(loadPendingEditedChanges(USER, WORKSPACE).size, 0);
	});

	it('survives corrupt JSON', () => {
		installMemoryStorage();
		localStorage._map.set(KEY, '{not json at all');
		assert.equal(loadPendingEditedChanges(USER, WORKSPACE).size, 0);
	});

	it('survives a stored value that is not an array', () => {
		installMemoryStorage();
		localStorage._map.set(KEY, '{"nope":true}');
		assert.equal(loadPendingEditedChanges(USER, WORKSPACE).size, 0);
	});

	it('skips individual rows that are malformed', () => {
		installMemoryStorage();
		localStorage._map.set(KEY, JSON.stringify([
			{ n: 'good', b: null, a: 1_000, c: [{ u: 'user-alice', a: 1_000 }] },
			{ n: '', b: null, a: 1_000, c: [] },
			{ n: 'no-time', b: null, a: 'tomorrow', c: [] },
			null,
			{ n: 'bad-contributors', b: null, a: 1_000, c: [{ u: '', a: 1_000 }, { u: 'user-bob', a: 'soon' }] },
		]));
		const restored = loadPendingEditedChanges(USER, WORKSPACE);
		assert.deepEqual([...restored.keys()].sort(), ['bad-contributors', 'good']);
		assert.deepEqual(restored.get('bad-contributors').contributors, [], 'unusable contributors dropped, entry kept');
	});

	it('does not throw when localStorage reads throw', () => {
		// Private mode and blocked site data both do this, and this runs during startup.
		installMemoryStorage({ throwOnRead: true });
		assert.equal(loadPendingEditedChanges(USER, WORKSPACE).size, 0);
	});

	it('does not throw when localStorage writes throw', () => {
		installMemoryStorage({ throwOnWrite: true });
		assert.doesNotThrow(() => savePendingEditedChanges(USER, WORKSPACE, stateOf(
			edited('note-1', [{ userId: 'user-alice', at: 1_000 }])
		)));
	});

	it('does nothing without a user or a workspace', () => {
		installMemoryStorage();
		savePendingEditedChanges(null, WORKSPACE, stateOf(edited('note-1', [{ userId: 'user-alice', at: 1_000 }])));
		savePendingEditedChanges(USER, null, stateOf(edited('note-1', [{ userId: 'user-alice', at: 1_000 }])));
		assert.equal(localStorage._map.size, 0);
		assert.equal(loadPendingEditedChanges(null, null).size, 0);
	});

	it('does not throw when localStorage is absent entirely', () => {
		delete globalThis.localStorage;
		assert.equal(loadPendingEditedChanges(USER, WORKSPACE).size, 0);
		assert.doesNotThrow(() => savePendingEditedChanges(USER, WORKSPACE, new Map()));
		assert.doesNotThrow(() => clearAllPendingNoteChanges());
	});
});

describe('pendingNoteChangeStore — logout', () => {
	it('clears every user and workspace, and nothing else', () => {
		installMemoryStorage();
		savePendingEditedChanges(USER, WORKSPACE, stateOf(edited('a', [{ userId: 'x', at: 1 }])));
		savePendingEditedChanges(USER, 'ws-2', stateOf(edited('b', [{ userId: 'x', at: 1 }])));
		savePendingEditedChanges('user-other', 'ws-3', stateOf(edited('c', [{ userId: 'x', at: 1 }])));
		localStorage._map.set('freemannotes.somethingElse.v1', 'keep me');

		clearAllPendingNoteChanges();

		assert.deepEqual([...localStorage._map.keys()], ['freemannotes.somethingElse.v1']);
	});
});
