'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for src/core/roomOfflineEditMarkers.ts — the markers that decide which
// individual note rooms always earn a WebSocket, however far off-screen they are.
//
// Worth testing for a sharper reason than its workspace-level twin. Once sockets
// are only opened for notes you are actually looking at, this set is the ONLY
// thing standing between "you edited a note offline" and "that edit sits in
// IndexedDB forever and the person you share it with never sees it". Nothing is
// lost and nothing looks wrong, which is the worst shape a data bug can take.
//
// The in-memory cache is the part most likely to break quietly: the module is
// called from a Yjs transaction handler (every keystroke), so it must not read
// localStorage each time — but a cache that drifts from storage is worse than no
// cache. Hence the round-trip assertions below.
//
// Run individually:  node --test tests/room-offline-edit-markers.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

const store = new Map();
globalThis.localStorage = {
	getItem: (key) => (store.has(key) ? store.get(key) : null),
	setItem: (key, value) => { store.set(key, String(value)); },
	removeItem: (key) => { store.delete(key); },
	clear: () => { store.clear(); },
};

require('ts-node/register/transpile-only');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
	clearRoomOfflineEdit,
	clearRoomOfflineEditMarkers,
	hasRoomOfflineEdit,
	isRoomOfflineEditTrackingInitialised,
	markRoomOfflineEdit,
	markRoomOfflineEditTrackingInitialised,
	readRoomsWithOfflineEdits,
	resetRoomOfflineEditMarkerCacheForTests,
} = require('../src/core/roomOfflineEditMarkers.ts');

const STORAGE_KEY = 'freemannotes.roomOfflineEdits.v1';

describe('room offline edit markers', () => {
	beforeEach(() => {
		store.clear();
		resetRoomOfflineEditMarkerCacheForTests();
	});

	it('starts out uninitialised, so the first boot connects everything', () => {
		assert.equal(isRoomOfflineEditTrackingInitialised(), false);
		assert.deepEqual(readRoomsWithOfflineEdits(), []);
	});

	it('records a room that has an offline edit', () => {
		markRoomOfflineEdit('ws-a:note-1');
		assert.deepEqual(readRoomsWithOfflineEdits(), ['ws-a:note-1']);
		assert.equal(hasRoomOfflineEdit('ws-a:note-1'), true);
		assert.equal(hasRoomOfflineEdit('ws-a:note-2'), false);
	});

	it('does not record the same room twice', () => {
		markRoomOfflineEdit('ws-a:note-1');
		markRoomOfflineEdit('ws-a:note-1');
		markRoomOfflineEdit('ws-a:note-1');
		assert.deepEqual(readRoomsWithOfflineEdits(), ['ws-a:note-1']);
	});

	it('keeps rooms in different workspaces apart', () => {
		// Room names carry their own workspace prefix, which is why this module needs
		// no workspace scoping of its own. If that ever changes, this breaks first.
		markRoomOfflineEdit('ws-a:note-1');
		markRoomOfflineEdit('ws-b:note-1');
		clearRoomOfflineEdit('ws-a:note-1');
		assert.deepEqual(readRoomsWithOfflineEdits(), ['ws-b:note-1']);
	});

	it('clears a room once it has synced, leaving the others', () => {
		markRoomOfflineEdit('ws-a:note-1');
		markRoomOfflineEdit('ws-a:note-2');
		clearRoomOfflineEdit('ws-a:note-1');
		assert.deepEqual(readRoomsWithOfflineEdits(), ['ws-a:note-2']);
	});

	it('ignores blank and whitespace-only room names', () => {
		markRoomOfflineEdit('');
		markRoomOfflineEdit('   ');
		assert.deepEqual(readRoomsWithOfflineEdits(), []);
		assert.equal(hasRoomOfflineEdit(''), false);
	});

	it('trims room names so a stray space cannot orphan a marker', () => {
		// A marker written as ' ws-a:note-1 ' and looked up as 'ws-a:note-1' would be
		// a silently unflushable edit, so both ends normalise.
		markRoomOfflineEdit('  ws-a:note-1  ');
		assert.deepEqual(readRoomsWithOfflineEdits(), ['ws-a:note-1']);
		clearRoomOfflineEdit('ws-a:note-1');
		assert.deepEqual(readRoomsWithOfflineEdits(), []);
	});

	it('clearing a room that was never marked is a no-op', () => {
		markRoomOfflineEdit('ws-a:note-1');
		clearRoomOfflineEdit('ws-a:nope');
		assert.deepEqual(readRoomsWithOfflineEdits(), ['ws-a:note-1']);
	});

	it('remembers the initialised flag independently of the markers', () => {
		markRoomOfflineEdit('ws-a:note-1');
		markRoomOfflineEditTrackingInitialised();
		assert.equal(isRoomOfflineEditTrackingInitialised(), true);
		assert.deepEqual(readRoomsWithOfflineEdits(), ['ws-a:note-1']);
		clearRoomOfflineEdit('ws-a:note-1');
		// Clearing the last marker must not take the flag with it, or every boot
		// with an empty set would fall back to connecting all ~96 rooms.
		assert.equal(isRoomOfflineEditTrackingInitialised(), true);
	});

	it('survives a page load — state round-trips through storage, not just the cache', () => {
		markRoomOfflineEdit('ws-a:note-1');
		markRoomOfflineEditTrackingInitialised();
		// Simulate a fresh page: same storage, no in-memory cache. This is the case
		// that actually matters — an edit made offline then the app closed.
		resetRoomOfflineEditMarkerCacheForTests();
		assert.deepEqual(readRoomsWithOfflineEdits(), ['ws-a:note-1']);
		assert.equal(isRoomOfflineEditTrackingInitialised(), true);
	});

	it('tolerates corrupt stored JSON by starting over rather than throwing', () => {
		store.set(STORAGE_KEY, '{not json');
		resetRoomOfflineEditMarkerCacheForTests();
		assert.deepEqual(readRoomsWithOfflineEdits(), []);
		assert.equal(isRoomOfflineEditTrackingInitialised(), false);
	});

	it('drops non-string entries from a hand-mangled store', () => {
		store.set(STORAGE_KEY, JSON.stringify({ initialised: true, roomNames: ['ws-a:note-1', 42, null, ''] }));
		resetRoomOfflineEditMarkerCacheForTests();
		assert.deepEqual(readRoomsWithOfflineEdits(), ['ws-a:note-1']);
	});

	it('wipes everything on logout, flag included', () => {
		markRoomOfflineEdit('ws-a:note-1');
		markRoomOfflineEditTrackingInitialised();
		clearRoomOfflineEditMarkers();
		assert.deepEqual(readRoomsWithOfflineEdits(), []);
		// Back to uninitialised on purpose: the next user on this device gets the
		// safe fallback rather than inheriting a flag earned by someone else's boot.
		assert.equal(isRoomOfflineEditTrackingInitialised(), false);
		assert.equal(store.has(STORAGE_KEY), false);
	});
});
