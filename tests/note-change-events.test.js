'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for server/noteChangeEvents.js — the "who changed this note" signal
// that the whole of phase 2 rests on (own change merges silently, foreign
// change waits behind the pill and gets a collaborator chip).
//
// Two things get the most attention here because they are the ones that would
// hurt in production:
//
//   1. COALESCING. The hook fires on every Yjs update, i.e. every keystroke.
//      If debouncing is wrong this floods /ws/metadata and runs a membership
//      query per character.
//   2. FAILING CLOSED. `userIds` is a recipient filter, and an empty one means
//      "send to everyone" — which would hand a note id to people with no
//      access. A failed membership lookup must emit NOTHING.
//
// Run individually:  node --test tests/note-change-events.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
	createNoteChangeNotifier,
	parseRoomName,
	classifyRoom,
} = require('../server/noteChangeEvents.js');

const WS = '90819838-b22f-45c2-98e4-a6db94924502';
const NOTE = '19a9c6fe-95b9-4386-a13a-e057b66d3db6';
const ALICE = 'user-alice';
const BOB = 'user-bob';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CAROL = 'user-carol';

function harness(overrides = {}) {
	const emitted = [];
	const queries = { members: 0, collaborators: 0, collaboratorWhere: [] };
	const prisma = {
		workspaceMember: {
			findMany: async () => { queries.members++; return [{ userId: ALICE }, { userId: BOB }]; },
		},
		noteCollaborator: {
			findMany: async (args) => {
				queries.collaborators++;
				queries.collaboratorWhere.push(args && args.where);
				return [];
			},
		},
	};
	const notifier = createNoteChangeNotifier({
		prisma,
		emit: (event) => emitted.push(event),
		debounceMs: 20,
		maxWaitMs: 80,
		...overrides,
	});
	return { notifier, emitted, queries };
}

describe('room name parsing', () => {
	it('splits a workspace-scoped room', () => {
		assert.deepEqual(parseRoomName(`${WS}:${NOTE}`), { workspaceId: WS, rest: NOTE });
	});

	it('splits on the FIRST colon, so an id containing one survives', () => {
		const parsed = parseRoomName(`${WS}:shared-placement:abc`);
		assert.equal(parsed.workspaceId, WS);
		assert.equal(parsed.rest, 'shared-placement:abc');
	});

	it('refuses markup rooms — they belong to a document version, not a workspace', () => {
		assert.equal(parseRoomName('markup:version-1'), null);
	});

	it('refuses anything that is not workspace-scoped', () => {
		assert.equal(parseRoomName(''), null);
		assert.equal(parseRoomName(null), null);
		assert.equal(parseRoomName('no-colon'), null);
		assert.equal(parseRoomName(':leading-colon'), null);
		assert.equal(parseRoomName(`${WS}:`), null);
	});
});

describe('room classification', () => {
	it('treats the notes registry as its own kind of change', () => {
		// Not a note — but registry changes are exactly how a note being ADDED or REMOVED shows
		// up, which is what decides whether the pill counts an insertion.
		assert.equal(classifyRoom('__notes_registry__'), 'note-order-changed');
	});

	it('ignores registries that cannot change which cards exist', () => {
		assert.equal(classifyRoom('__collections_registry__'), null);
		assert.equal(classifyRoom('__labels_registry__'), null);
	});

	it('treats anything else as a note', () => {
		assert.equal(classifyRoom(NOTE), 'note-changed');
		assert.equal(classifyRoom('shared-placement:abc'), 'note-changed');
	});
});

describe('coalescing', () => {
	it('emits once for a burst, not once per update', async () => {
		const { notifier, emitted } = harness();
		for (let i = 0; i < 25; i++) notifier.recordChange(`${WS}:${NOTE}`, ALICE);
		assert.equal(emitted.length, 0, 'nothing on the leading edge');
		await sleep(60);
		assert.equal(emitted.length, 1, '25 keystrokes produced one event');
		assert.equal(emitted[0].changedUserId, ALICE);
		assert.equal(emitted[0].docId, `${WS}:${NOTE}`);
		assert.equal(emitted[0].workspaceId, WS);
		assert.equal(emitted[0].reason, 'note-changed');
		notifier.dispose();
	});

	it('names the LAST writer when two people touch the same note', async () => {
		const { notifier, emitted } = harness();
		notifier.recordChange(`${WS}:${NOTE}`, ALICE);
		notifier.recordChange(`${WS}:${NOTE}`, BOB);
		await sleep(60);
		assert.equal(emitted.length, 1);
		assert.equal(emitted[0].changedUserId, BOB);
		notifier.dispose();
	});

	it('keeps rooms independent', async () => {
		const { notifier, emitted } = harness();
		notifier.recordChange(`${WS}:note-a`, ALICE);
		notifier.recordChange(`${WS}:note-b`, BOB);
		await sleep(60);
		assert.equal(emitted.length, 2);
		assert.deepEqual(emitted.map((e) => e.docId).sort(), [`${WS}:note-a`, `${WS}:note-b`]);
		notifier.dispose();
	});

	it('still reports during CONTINUOUS editing that never pauses', async () => {
		// The case the max-wait exists for: without it, a trailing debounce that keeps being reset
		// never fires at all, so somebody typing for two minutes would produce no event.
		const { notifier, emitted } = harness();
		const until = Date.now() + 140;
		while (Date.now() < until) {
			notifier.recordChange(`${WS}:${NOTE}`, ALICE);
			await sleep(5);
		}
		assert.ok(emitted.length >= 1, `max-wait fired during a continuous burst (got ${emitted.length})`);
		notifier.dispose();
	});

	it('starts a fresh window after a flush', async () => {
		const { notifier, emitted } = harness();
		notifier.recordChange(`${WS}:${NOTE}`, ALICE);
		await sleep(60);
		assert.equal(emitted.length, 1);
		notifier.recordChange(`${WS}:${NOTE}`, ALICE);
		await sleep(60);
		assert.equal(emitted.length, 2, 'a later edit is a new event');
		notifier.dispose();
	});

	it('leaves nothing pending once flushed', async () => {
		const { notifier } = harness();
		notifier.recordChange(`${WS}:${NOTE}`, ALICE);
		assert.equal(notifier._pendingCount(), 1);
		await sleep(60);
		assert.equal(notifier._pendingCount(), 0);
		notifier.dispose();
	});
});

describe('what is ignored outright', () => {
	it('ignores updates with no attributed user', async () => {
		// An unauthenticated or unattributed write tells us nothing about ownership, and guessing
		// would be worse than silence.
		const { notifier, emitted } = harness();
		notifier.recordChange(`${WS}:${NOTE}`, null);
		notifier.recordChange(`${WS}:${NOTE}`, '');
		await sleep(60);
		assert.equal(emitted.length, 0);
		notifier.dispose();
	});

	it('ignores markup rooms and the non-note registries', async () => {
		const { notifier, emitted } = harness();
		notifier.recordChange('markup:v1', ALICE);
		notifier.recordChange(`${WS}:__collections_registry__`, ALICE);
		notifier.recordChange(`${WS}:__labels_registry__`, ALICE);
		await sleep(60);
		assert.equal(emitted.length, 0);
		notifier.dispose();
	});

	it('does nothing at all without an emit function', () => {
		const notifier = createNoteChangeNotifier({ prisma: null, emit: null });
		notifier.recordChange(`${WS}:${NOTE}`, ALICE);
		assert.equal(notifier._pendingCount(), 0, 'not even queued');
		notifier.dispose();
	});
});

describe('recipients — this is the privacy-sensitive part', () => {
	it('addresses the event to workspace members', async () => {
		const { notifier, emitted } = harness();
		notifier.recordChange(`${WS}:${NOTE}`, ALICE);
		await sleep(60);
		assert.deepEqual(emitted[0].userIds.sort(), [ALICE, BOB].sort());
		notifier.dispose();
	});

	it('emits NOTHING when the membership lookup fails', async () => {
		// An empty userIds list means "broadcast to every connected client", which would hand a
		// note id and workspace id to people with no access. Failing closed is the only safe
		// direction, so a thrown query must drop the event.
		const { notifier, emitted } = harness({
			prisma: {
				workspaceMember: { findMany: async () => { throw new Error('db down'); } },
				noteCollaborator: { findMany: async () => [] },
			},
		});
		notifier.recordChange(`${WS}:${NOTE}`, ALICE);
		await sleep(60);
		assert.equal(emitted.length, 0);
		notifier.dispose();
	});

	it('emits nothing for a workspace with no members rather than broadcasting', async () => {
		const { notifier, emitted } = harness({
			prisma: {
				workspaceMember: { findMany: async () => [] },
				noteCollaborator: { findMany: async () => [] },
			},
		});
		notifier.recordChange(`${WS}:${NOTE}`, ALICE);
		await sleep(60);
		assert.equal(emitted.length, 0);
		notifier.dispose();
	});

	it('caches membership so a burst does not query per event', async () => {
		const { notifier, emitted, queries } = harness();
		notifier.recordChange(`${WS}:note-a`, ALICE);
		await sleep(60);
		notifier.recordChange(`${WS}:note-b`, ALICE);
		await sleep(60);
		notifier.recordChange(`${WS}:note-c`, ALICE);
		await sleep(60);
		assert.equal(emitted.length, 3);
		assert.equal(queries.members, 1, 'three events, one membership query');
	});

	it('includes the note OWN collaborators, not just workspace members', async () => {
		// Measured against real data before this was added: of 27 shared notes, 27 had somebody
		// with access who was not a member of the owning workspace. A shared note lives in its
		// owner's workspace, so members-only meant the chips never working on the notes they
		// exist for.
		const { notifier, emitted } = harness({
			prisma: {
				workspaceMember: { findMany: async () => [{ userId: ALICE }] },
				noteCollaborator: { findMany: async () => [{ userId: CAROL }] },
			},
		});
		notifier.recordChange(`${WS}:${NOTE}`, ALICE);
		await sleep(60);
		assert.equal(emitted.length, 1);
		assert.deepEqual(emitted[0].userIds.sort(), [ALICE, CAROL].sort());
		notifier.dispose();
	});

	it('asks only for collaborators whose access has NOT been revoked', async () => {
		// Access is removed by setting revokedAt, not by deleting the row. Without that filter an
		// ex-collaborator would carry on being told when the note changes.
		const { notifier, queries } = harness();
		notifier.recordChange(`${WS}:${NOTE}`, ALICE);
		await sleep(60);
		assert.equal(queries.collaborators, 1);
		assert.deepEqual(queries.collaboratorWhere[0], { docId: `${WS}:${NOTE}`, revokedAt: null });
		notifier.dispose();
	});

	it('does NOT add collaborators to a registry event', async () => {
		// A collaborator on one note has no business being told the workspace's note LIST changed.
		const { notifier, emitted, queries } = harness({
			prisma: {
				workspaceMember: { findMany: async () => [{ userId: ALICE }] },
				noteCollaborator: { findMany: async () => { throw new Error('must not be asked'); } },
			},
		});
		notifier.recordChange(`${WS}:__notes_registry__`, ALICE);
		await sleep(60);
		assert.equal(emitted.length, 1);
		assert.equal(emitted[0].reason, 'note-order-changed');
		assert.deepEqual(emitted[0].userIds, [ALICE]);
		assert.equal(queries.collaborators, 0, 'the collaborator table was never consulted');
		notifier.dispose();
	});

	it('drops the event when the COLLABORATOR lookup fails', async () => {
		// Same fail-closed rule as the membership lookup: "we do not know" must not become
		// "send it to everyone".
		const { notifier, emitted } = harness({
			prisma: {
				workspaceMember: { findMany: async () => [{ userId: ALICE }] },
				noteCollaborator: { findMany: async () => { throw new Error('db down'); } },
			},
		});
		notifier.recordChange(`${WS}:${NOTE}`, ALICE);
		await sleep(60);
		assert.equal(emitted.length, 0);
		notifier.dispose();
	});
});
