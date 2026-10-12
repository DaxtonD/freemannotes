'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for src/core/roomConnectionPool.ts — which rooms hold a live WebSocket.
//
// Every rule here answers a specific way the app could feel wrong, and most of
// them came out of the user asking the right questions when this was proposed:
// "what happens if someone scrolls the grid up and down like a game", and "what
// about my most-used note sitting at the very bottom of the grid". Those are the
// cases below. They are cheap to test here and expensive to discover on a phone.
//
// Run individually:  node --test tests/room-connection-pool.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

require('ts-node/register/transpile-only');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeConnectionPool } = require('../src/core/roomConnectionPool.ts');

const NOW = 1_000_000;
const GRACE = 30_000;

function pool(overrides) {
	return computeConnectionPool({
		viewportRooms: [],
		pinnedRoom: null,
		interest: new Map(),
		now: NOW,
		graceMs: GRACE,
		maxWarm: 25,
		...overrides,
	});
}

const sorted = (set) => Array.from(set).sort();

describe('room connection pool', () => {
	it('connects what is on screen', () => {
		const { pooled } = pool({ viewportRooms: ['ws:a', 'ws:b'] });
		assert.deepEqual(sorted(pooled), ['ws:a', 'ws:b']);
	});

	it('connects nothing when nothing is on screen and nothing is recent', () => {
		const { pooled } = pool({});
		assert.equal(pooled.size, 0);
	});

	it('holds the pinned room even though nothing else wants it', () => {
		// This is the open editor. Without it, a note open longer than the grace
		// window would lose its connection under the person typing into it.
		const { pooled } = pool({ pinnedRoom: 'ws:open' });
		assert.deepEqual(sorted(pooled), ['ws:open']);
	});

	it('keeps a room connected through its grace window after it leaves view', () => {
		// Scrolled past 5 s ago: still connected, so scrolling back costs no handshake.
		const { pooled, expired } = pool({ interest: new Map([['ws:a', NOW - 5_000]]) });
		assert.deepEqual(sorted(pooled), ['ws:a']);
		assert.deepEqual(expired, []);
	});

	it('expires a room once its grace window has passed', () => {
		const { pooled, expired } = pool({ interest: new Map([['ws:a', NOW - GRACE - 1]]) });
		assert.equal(pooled.size, 0);
		assert.deepEqual(expired, ['ws:a']);
	});

	it('treats the boundary as still inside the window', () => {
		const { pooled, expired } = pool({ interest: new Map([['ws:a', NOW - GRACE]]) });
		assert.deepEqual(sorted(pooled), ['ws:a']);
		assert.deepEqual(expired, []);
	});

	it('never counts on-screen rooms against the warm cap', () => {
		// The one unambiguous regression available here would be refusing to connect
		// something the user is looking at, so the cap must not be able to cause it.
		const viewportRooms = Array.from({ length: 40 }, (_unused, index) => `ws:v${index}`);
		const { pooled } = pool({ viewportRooms, maxWarm: 5 });
		assert.equal(pooled.size, 40);
	});

	it('caps the warm tail and keeps the most recently wanted rooms', () => {
		const interest = new Map([
			['ws:oldest', NOW - 9_000],
			['ws:middle', NOW - 5_000],
			['ws:newest', NOW - 1_000],
		]);
		const { pooled } = pool({ interest, maxWarm: 2 });
		assert.deepEqual(sorted(pooled), ['ws:middle', 'ws:newest']);
	});

	it('does not expire a room merely because the cap squeezed it out', () => {
		// Squeezed out is not stale. Dropping its interest entry would mean it could
		// never come back into the pool as warmer rooms age out.
		const interest = new Map([
			['ws:a', NOW - 1_000],
			['ws:b', NOW - 2_000],
		]);
		const { pooled, expired } = pool({ interest, maxWarm: 1 });
		assert.deepEqual(sorted(pooled), ['ws:a']);
		assert.deepEqual(expired, []);
	});

	it('scrolling a whole workspace settles to a bounded number of sockets', () => {
		// The "scroll the grid like a game" case. Ninety-six notes all touched
		// recently, ten of them still on screen: the result has to be bounded, or we
		// have reinvented one-socket-per-note by a slower route.
		const interest = new Map(
			Array.from({ length: 96 }, (_unused, index) => [`ws:n${index}`, NOW - index * 100])
		);
		const viewportRooms = Array.from({ length: 10 }, (_unused, index) => `ws:n${index}`);
		const { pooled } = pool({ interest, viewportRooms, maxWarm: 25 });
		assert.equal(pooled.size, 35, 'ten visible plus the warm cap, and nothing more');
		for (const roomName of viewportRooms) assert.ok(pooled.has(roomName), roomName);
	});

	it('a recently-opened note stays connected wherever it sits in the grid', () => {
		// The "my most-used note is at the very bottom" case. It is seeded into
		// interest at startup, so it is live before you ever scroll to it.
		const { pooled } = pool({
			viewportRooms: ['ws:top1', 'ws:top2'],
			interest: new Map([['ws:bottom-favourite', NOW - 500]]),
		});
		assert.ok(pooled.has('ws:bottom-favourite'));
	});

	it('does not double-count a room that is both on screen and recently wanted', () => {
		const { pooled } = pool({
			viewportRooms: ['ws:a'],
			interest: new Map([['ws:a', NOW - 1_000], ['ws:b', NOW - 1_000]]),
			maxWarm: 1,
		});
		// 'ws:a' is already in via the viewport, so the single warm slot goes to 'ws:b'
		// rather than being spent again on 'ws:a'.
		assert.deepEqual(sorted(pooled), ['ws:a', 'ws:b']);
	});

	it('still holds the pinned room when the warm cap is zero', () => {
		const { pooled } = pool({
			pinnedRoom: 'ws:open',
			interest: new Map([['ws:other', NOW - 1_000]]),
			maxWarm: 0,
		});
		assert.deepEqual(sorted(pooled), ['ws:open']);
	});

	it('expires stale entries even when the cap is already full', () => {
		const interest = new Map([
			['ws:fresh', NOW - 1_000],
			['ws:stale', NOW - GRACE - 5_000],
		]);
		const { pooled, expired } = pool({ interest, maxWarm: 1 });
		assert.deepEqual(sorted(pooled), ['ws:fresh']);
		assert.deepEqual(expired, ['ws:stale'], 'stale entries are reported regardless of the cap');
	});
});
