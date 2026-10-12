'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for src/core/noteContentSeenState.ts — the "hold the card's height
// until you've looked at it" decision, plus the device-local record it reads.
//
// This is the user's own proposed fix for the third of his three data-delivery
// complaints (cards changing size while he looks at them), and it got MORE
// visible once sockets became viewport-driven: a note now syncs when you scroll
// to it, so the resize happens on arrival rather than during the first twenty
// seconds of a boot.
//
// The seeding rule is the subtle part and the one worth testing hardest. A note
// with no record is seeded silently rather than flagged, which sounds like it
// would defeat the whole thing on a cold boot. It does not, because the grid
// renders from IndexedDB before any socket opens, so the seed captures the STALE
// timestamp and the fresher one is correctly flagged when it arrives. There is a
// test for exactly that sequence below.
//
// Run individually:  node --test tests/note-content-seen-state.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

const store = new Map();
globalThis.localStorage = {
	get length() { return store.size; },
	key: (index) => Array.from(store.keys())[index] ?? null,
	getItem: (key) => (store.has(key) ? store.get(key) : null),
	setItem: (key, value) => { store.set(key, String(value)); },
	removeItem: (key) => { store.delete(key); },
	clear: () => { store.clear(); },
};

require('ts-node/register/transpile-only');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
	clearNoteContentSeenState,
	markManyNoteContentSeen,
	markNoteContentSeen,
	pruneNoteContentSeenState,
	readNoteContentSeenState,
	resetNoteContentSeenCacheForTests,
	resolveCardHold,
} = require('../src/core/noteContentSeenState.ts');

const SCOPE = { userId: 'user-1', deviceId: 'device-1' };
const OTHER_DEVICE = { userId: 'user-1', deviceId: 'device-2' };

describe('note content seen state', () => {
	beforeEach(() => {
		store.clear();
		resetNoteContentSeenCacheForTests();
	});

	it('starts empty', () => {
		assert.deepEqual(readNoteContentSeenState(SCOPE), {});
	});

	it('records and reads back a seen version', () => {
		markNoteContentSeen(SCOPE, 'note-1', 1000);
		assert.deepEqual(readNoteContentSeenState(SCOPE), { 'note-1': 1000 });
	});

	it('survives a page load', () => {
		markNoteContentSeen(SCOPE, 'note-1', 1000);
		resetNoteContentSeenCacheForTests();
		assert.deepEqual(readNoteContentSeenState(SCOPE), { 'note-1': 1000 });
	});

	it('keeps devices separate, because each screen gets its own chance to show a change', () => {
		markNoteContentSeen(SCOPE, 'note-1', 1000);
		resetNoteContentSeenCacheForTests();
		assert.deepEqual(readNoteContentSeenState(OTHER_DEVICE), {});
	});

	it('does nothing without a user and device to scope to', () => {
		markNoteContentSeen({ userId: null, deviceId: 'device-1' }, 'note-1', 1000);
		assert.deepEqual(readNoteContentSeenState({ userId: null, deviceId: 'device-1' }), {});
	});

	it('marks many at once and skips unchanged entries', () => {
		markManyNoteContentSeen(SCOPE, [
			{ noteId: 'note-1', updatedAt: 1000 },
			{ noteId: 'note-2', updatedAt: 2000 },
			{ noteId: '', updatedAt: 3000 },
			{ noteId: 'note-3', updatedAt: Number.NaN },
		]);
		assert.deepEqual(readNoteContentSeenState(SCOPE), { 'note-1': 1000, 'note-2': 2000 });
	});

	it('prunes notes that are gone', () => {
		markManyNoteContentSeen(SCOPE, [
			{ noteId: 'note-1', updatedAt: 1000 },
			{ noteId: 'note-gone', updatedAt: 2000 },
		]);
		pruneNoteContentSeenState(SCOPE, ['note-1']);
		assert.deepEqual(readNoteContentSeenState(SCOPE), { 'note-1': 1000 });
	});

	it('refuses to prune against an empty note list', () => {
		// The grid's ordered ids are empty until the registry hydrates. Pruning there would
		// wipe the map and flag every note in the workspace as changed on the next pass.
		markNoteContentSeen(SCOPE, 'note-1', 1000);
		pruneNoteContentSeenState(SCOPE, []);
		assert.deepEqual(readNoteContentSeenState(SCOPE), { 'note-1': 1000 });
	});

	it('tolerates a corrupt or hand-mangled store', () => {
		store.set('freemannotes.noteContentSeen.v1:user-1::device-1', '{not json');
		resetNoteContentSeenCacheForTests();
		assert.deepEqual(readNoteContentSeenState(SCOPE), {});

		store.set('freemannotes.noteContentSeen.v1:user-1::device-1', JSON.stringify({ a: 1, b: 'nope', c: null }));
		resetNoteContentSeenCacheForTests();
		assert.deepEqual(readNoteContentSeenState(SCOPE), { a: 1 });
	});

	it('wipes every device scope on logout', () => {
		markNoteContentSeen(SCOPE, 'note-1', 1000);
		resetNoteContentSeenCacheForTests();
		markNoteContentSeen(OTHER_DEVICE, 'note-2', 2000);
		clearNoteContentSeenState();
		assert.deepEqual(readNoteContentSeenState(SCOPE), {});
		assert.deepEqual(readNoteContentSeenState(OTHER_DEVICE), {});
		assert.equal(store.size, 0);
	});
});

describe('card hold decision', () => {
	const base = { updatedAt: 2000, seenUpdatedAt: 1000, measuredHeightPx: 240, isOpen: false };

	it('holds a card whose content changed since this device last showed it', () => {
		assert.deepEqual(resolveCardHold(base), { changed: true, holdHeightPx: 240, needsSeed: false });
	});

	it('leaves a card alone when nothing has changed', () => {
		assert.deepEqual(
			resolveCardHold({ ...base, updatedAt: 1000 }),
			{ changed: false, holdHeightPx: null, needsSeed: false }
		);
	});

	it('never holds the note that is open in the editor', () => {
		// Opening it is how the user catches up, and the re-measure happens behind the
		// editor overlay so the grid is already correct when it closes.
		assert.deepEqual(
			resolveCardHold({ ...base, isOpen: true }),
			{ changed: false, holdHeightPx: null, needsSeed: false }
		);
	});

	it('asks for a seed, and does not flag, when this device has never tracked the note', () => {
		assert.deepEqual(
			resolveCardHold({ ...base, seenUpdatedAt: undefined }),
			{ changed: false, holdHeightPx: null, needsSeed: true }
		);
	});

	it('does not hold a changed card that has never been measured', () => {
		// Nothing to hold it at, and nothing has moved yet, so there is nothing to warn about.
		assert.deepEqual(
			resolveCardHold({ ...base, measuredHeightPx: null }),
			{ changed: false, holdHeightPx: null, needsSeed: false }
		);
		assert.deepEqual(
			resolveCardHold({ ...base, measuredHeightPx: 0 }),
			{ changed: false, holdHeightPx: null, needsSeed: false }
		);
	});

	it('ignores a nonsense timestamp rather than flagging everything', () => {
		assert.equal(resolveCardHold({ ...base, updatedAt: Number.NaN }).changed, false);
	});

	it('the cold-boot sequence: seed from IndexedDB, then flag what the socket brings', () => {
		// This is the case the whole design turns on. The grid renders from IndexedDB at
		// ~400 ms, long before any socket opens, so the seed captures the stale timestamp.
		const fromIndexedDb = 1000;
		const first = resolveCardHold({
			updatedAt: fromIndexedDb,
			seenUpdatedAt: undefined,
			measuredHeightPx: null,
			isOpen: false,
		});
		assert.equal(first.needsSeed, true, 'seeded silently, nothing to report yet');
		markNoteContentSeen(SCOPE, 'note-1', fromIndexedDb);

		// Card measures, then the collaborator's edit arrives over the socket.
		const afterSync = resolveCardHold({
			updatedAt: 5000,
			seenUpdatedAt: readNoteContentSeenState(SCOPE)['note-1'],
			measuredHeightPx: 240,
			isOpen: false,
		});
		assert.deepEqual(afterSync, { changed: true, holdHeightPx: 240, needsSeed: false });
	});

	it('opening the note clears the hold for good', () => {
		markNoteContentSeen(SCOPE, 'note-1', 5000);
		assert.deepEqual(
			resolveCardHold({
				updatedAt: 5000,
				seenUpdatedAt: readNoteContentSeenState(SCOPE)['note-1'],
				measuredHeightPx: 240,
				isOpen: false,
			}),
			{ changed: false, holdHeightPx: null, needsSeed: false }
		);
	});
});
