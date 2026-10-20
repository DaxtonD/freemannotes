'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the /ws/metadata WIRE contract — server/workspaceMetadataEvents.js's
// normalizeWorkspaceMetadataEvent + toClientMetadataPayload.
//
// This file exists because of a specific bug. `changedUserIds` (every person in a
// coalesced note-change burst) was added to the notifier, to the normaliser and to
// the Redis publisher, with a passing unit test on the emitting side — and the
// browser still received one actor, because the socket payload was a hand-written
// object literal in server.js that nobody updated. The server computed the whole
// list and discarded it on the last line before the wire.
//
// So: every field the client reads is asserted HERE, on the serialiser, and the
// serialiser is shared with server.js rather than duplicated in it.
//
// Run individually:  node --test tests/workspace-metadata-wire.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
	normalizeWorkspaceMetadataEvent,
	toClientMetadataPayload,
} = require('../server/workspaceMetadataEvents');

const noteChange = (overrides = {}) => normalizeWorkspaceMetadataEvent({
	reason: 'note-changed',
	workspaceId: 'ws-1',
	docId: 'ws-1:note-1',
	changedUserId: 'user-bob',
	changedUserIds: ['user-bob', 'user-alice'],
	userIds: ['user-bob', 'user-alice', 'user-carol'],
	...overrides,
});

describe('normalizeWorkspaceMetadataEvent', () => {
	it('keeps every actor in a coalesced burst', () => {
		assert.deepEqual(noteChange().changedUserIds, ['user-bob', 'user-alice']);
	});

	it('defaults a missing actor list to empty rather than undefined', () => {
		assert.deepEqual(noteChange({ changedUserIds: undefined }).changedUserIds, []);
		assert.deepEqual(noteChange({ changedUserIds: 'not-an-array' }).changedUserIds, []);
	});

	it('drops junk entries from the actor list', () => {
		const event = noteChange({ changedUserIds: ['user-bob', '', null, 42, 'user-alice'] });
		assert.deepEqual(event.changedUserIds, ['user-bob', 'user-alice']);
	});

	it('returns null for a non-object payload', () => {
		assert.equal(normalizeWorkspaceMetadataEvent(null), null);
		assert.equal(normalizeWorkspaceMetadataEvent('nope'), null);
	});
});

describe('toClientMetadataPayload — what the browser actually receives', () => {
	it('carries the full actor list, not just the latest', () => {
		// THE REGRESSION TEST. Dropping this field is invisible to every test that only looks at
		// what the notifier emits, which is exactly how it shipped broken once.
		const payload = toClientMetadataPayload(noteChange());
		assert.deepEqual(payload.changedUserIds, ['user-bob', 'user-alice']);
		assert.equal(payload.changedUserId, 'user-bob', 'singular field still present for compatibility');
	});

	it('carries every other field the client reads', () => {
		// Mirrors the destructured payload shape in App.tsx's /ws/metadata message handler. If a
		// field is added there, it has to be added here, and this test is where that is noticed.
		const payload = toClientMetadataPayload(noteChange({ profileImageUrl: '/uploads/bob.webp' }));
		assert.equal(payload.type, 'workspace-metadata-changed');
		assert.equal(payload.reason, 'note-changed');
		assert.equal(payload.workspaceId, 'ws-1');
		assert.equal(payload.docId, 'ws-1:note-1');
		assert.equal(payload.profileImageUrl, '/uploads/bob.webp');
		assert.ok(typeof payload.occurredAt === 'string' && payload.occurredAt.length > 0);
	});

	it('does NOT leak the recipient filter to recipients', () => {
		// `userIds` is how the broadcaster decides who to send to. Shipping it would hand every
		// recipient the list of everyone else with access to the note.
		const payload = toClientMetadataPayload(noteChange());
		assert.equal('userIds' in payload, false);
	});

	it('serialises to JSON without losing the actor list', () => {
		// The broadcaster JSON.stringifies this, so an undefined would vanish silently.
		const round = JSON.parse(JSON.stringify(toClientMetadataPayload(noteChange())));
		assert.deepEqual(round.changedUserIds, ['user-bob', 'user-alice']);
	});

	it('survives an event with nothing but defaults', () => {
		const payload = toClientMetadataPayload(normalizeWorkspaceMetadataEvent({}));
		assert.equal(payload.reason, 'workspace-updated');
		assert.equal(payload.changedUserId, null);
		assert.deepEqual(payload.changedUserIds, []);
	});
});
