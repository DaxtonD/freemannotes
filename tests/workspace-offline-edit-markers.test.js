'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for src/core/workspaceOfflineEditMarkers.ts — the markers that decide
// which workspaces app startup bothers to flush.
//
// This is worth testing because the failure mode is silent and costs data
// visibility: get the `initialised` guard wrong and startup decides nobody owes
// the server anything, skips the flush, and an offline edit made in another
// workspace sits on one device until the user happens to open that workspace
// again. Nothing is lost (it's in IndexedDB), but it is invisible everywhere
// else, which is indistinguishable from lost.
//
// Run individually:  node --test tests/workspace-offline-edit-markers.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

// Minimal localStorage stand-in; the module reads it lazily on every call, so
// installing this before the import is enough.
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
	clearWorkspaceOfflineEdit,
	clearWorkspaceOfflineEditMarkers,
	isWorkspaceOfflineEditTrackingInitialised,
	markWorkspaceOfflineEdit,
	markWorkspaceOfflineEditTrackingInitialised,
	readWorkspacesWithOfflineEdits,
} = require('../src/core/workspaceOfflineEditMarkers.ts');

describe('workspace offline edit markers', () => {
	beforeEach(() => {
		store.clear();
	});

	it('starts out uninitialised, so startup falls back to flushing everything', () => {
		assert.equal(isWorkspaceOfflineEditTrackingInitialised(), false);
		assert.deepEqual(readWorkspacesWithOfflineEdits(), []);
	});

	it('records a workspace that has an offline edit', () => {
		markWorkspaceOfflineEdit('ws-a');
		assert.deepEqual(readWorkspacesWithOfflineEdits(), ['ws-a']);
	});

	it('does not record the same workspace twice', () => {
		markWorkspaceOfflineEdit('ws-a');
		markWorkspaceOfflineEdit('ws-a');
		markWorkspaceOfflineEdit('ws-a');
		assert.deepEqual(readWorkspacesWithOfflineEdits(), ['ws-a']);
	});

	it('keeps several workspaces independently', () => {
		markWorkspaceOfflineEdit('ws-a');
		markWorkspaceOfflineEdit('ws-b');
		clearWorkspaceOfflineEdit('ws-a');
		assert.deepEqual(readWorkspacesWithOfflineEdits(), ['ws-b']);
	});

	it('ignores empty and whitespace ids rather than storing junk', () => {
		markWorkspaceOfflineEdit('');
		markWorkspaceOfflineEdit('   ');
		assert.deepEqual(readWorkspacesWithOfflineEdits(), []);
	});

	it('clearing a workspace that was never marked is a no-op', () => {
		markWorkspaceOfflineEdit('ws-a');
		clearWorkspaceOfflineEdit('ws-unknown');
		assert.deepEqual(readWorkspacesWithOfflineEdits(), ['ws-a']);
	});

	it('marking initialised does not disturb existing markers', () => {
		markWorkspaceOfflineEdit('ws-a');
		markWorkspaceOfflineEditTrackingInitialised();
		assert.equal(isWorkspaceOfflineEditTrackingInitialised(), true);
		assert.deepEqual(readWorkspacesWithOfflineEdits(), ['ws-a']);
	});

	it('marking a workspace after initialisation keeps the initialised flag', () => {
		markWorkspaceOfflineEditTrackingInitialised();
		markWorkspaceOfflineEdit('ws-a');
		assert.equal(isWorkspaceOfflineEditTrackingInitialised(), true);
		assert.deepEqual(readWorkspacesWithOfflineEdits(), ['ws-a']);
	});

	it('clearing a marker keeps the initialised flag, so startup stays on the fast path', () => {
		markWorkspaceOfflineEditTrackingInitialised();
		markWorkspaceOfflineEdit('ws-a');
		clearWorkspaceOfflineEdit('ws-a');
		assert.equal(isWorkspaceOfflineEditTrackingInitialised(), true);
		assert.deepEqual(readWorkspacesWithOfflineEdits(), []);
	});

	it('logout wipes everything, including the initialised flag', () => {
		// Resetting initialised matters: the next user on this device has written no markers,
		// so they must get the flush-everything fallback once rather than inheriting a clean
		// bill of health from somebody else.
		markWorkspaceOfflineEditTrackingInitialised();
		markWorkspaceOfflineEdit('ws-a');
		clearWorkspaceOfflineEditMarkers();
		assert.equal(isWorkspaceOfflineEditTrackingInitialised(), false);
		assert.deepEqual(readWorkspacesWithOfflineEdits(), []);
	});

	it('survives corrupt stored json by falling back to the safe default', () => {
		// The safe default is uninitialised, which means "flush everything" — never "nothing
		// to do".
		store.set('freemannotes.workspaceOfflineEdits.v1', '{not json');
		assert.equal(isWorkspaceOfflineEditTrackingInitialised(), false);
		assert.deepEqual(readWorkspacesWithOfflineEdits(), []);
	});

	it('survives a stored shape that is the wrong type', () => {
		store.set('freemannotes.workspaceOfflineEdits.v1', '{"initialised":"yes","workspaceIds":"ws-a"}');
		assert.equal(isWorkspaceOfflineEditTrackingInitialised(), false);
		assert.deepEqual(readWorkspacesWithOfflineEdits(), []);
	});

	it('filters non-string entries out of a stored list', () => {
		store.set('freemannotes.workspaceOfflineEdits.v1', '{"initialised":true,"workspaceIds":["ws-a",null,7,"ws-b"]}');
		assert.deepEqual(readWorkspacesWithOfflineEdits(), ['ws-a', 'ws-b']);
	});
});
