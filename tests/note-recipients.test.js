'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Who is allowed to hear that something happened to a note.
//
// This exists because of a real leak. `publishNoteMediaMetadataChange` sent
// `reason`, `workspaceId` and `docId` with no `userIds`, and the broadcaster
// reads an empty recipient list as "no filter":
//
//     const allowedUserIds = event.userIds.length > 0 ? new Set(...) : null;
//     if (allowedUserIds && !allowedUserIds.has(session.userId)) continue;
//
// So every image upload, document upload, link preview and OCR progress tick
// sent that note's `workspaceId:noteId` to EVERY connected client on the
// server, including people with no access to the workspace. Thirteen call
// sites, all of them.
//
// The note-change path had been hardened against exactly this and carries a
// comment saying so; the media path never got the same treatment. Two copies of
// a fail-closed rule drifting apart IS this bug, so the rules now live in one
// module and both paths use it. These tests are what stop them drifting again.
//
// The governing rule, asserted repeatedly below: FAIL CLOSED. "Nobody extra"
// and "we could not find out" must never produce the same answer, because one
// of them is a broadcast.
//
// Run individually:  node --test tests/note-recipients.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createNoteRecipientResolver } = require('../server/noteRecipients');

const WORKSPACE = 'ws-1';
const DOC = 'ws-1:note-1';

/** A prisma stand-in. Pass `Error` for either list to make that lookup throw. */
function fakePrisma({ members = ['alice'], collaborators = [] } = {}) {
	const calls = { members: 0, collaborators: 0 };
	return {
		calls,
		workspaceMember: {
			findMany: async () => {
				calls.members += 1;
				if (members instanceof Error) throw members;
				return members.map((userId) => ({ userId }));
			},
		},
		noteCollaborator: {
			findMany: async (args) => {
				calls.collaborators += 1;
				calls.lastCollaboratorWhere = args && args.where;
				if (collaborators instanceof Error) throw collaborators;
				return collaborators.map((userId) => ({ userId }));
			},
		},
	};
}

const resolverFor = (prisma, ttlMs) => createNoteRecipientResolver({ prisma, ttlMs });

describe('the ordinary case', () => {
	it('returns the workspace members', async () => {
		const resolver = resolverFor(fakePrisma({ members: ['alice', 'bob'] }));
		const result = await resolver.resolveRecipients({ workspaceId: WORKSPACE, docId: DOC });
		assert.deepEqual([...result].sort(), ['alice', 'bob']);
	});

	it('adds the note\'s collaborators', async () => {
		const resolver = resolverFor(fakePrisma({ members: ['alice'], collaborators: ['carol'] }));
		const result = await resolver.resolveRecipients({ workspaceId: WORKSPACE, docId: DOC });
		assert.deepEqual([...result].sort(), ['alice', 'carol']);
	});

	it('does not list somebody twice when they are both', async () => {
		const resolver = resolverFor(fakePrisma({ members: ['alice'], collaborators: ['alice'] }));
		const result = await resolver.resolveRecipients({ workspaceId: WORKSPACE, docId: DOC });
		assert.deepEqual(result, ['alice']);
	});

	it('skips the collaborator lookup for a registry event', async () => {
		// The notes registry is not a note and has no collaborators of its own.
		const prisma = fakePrisma({ members: ['alice'] });
		const resolver = resolverFor(prisma);
		await resolver.resolveRecipients({ workspaceId: WORKSPACE, docId: DOC, includeCollaborators: false });
		assert.equal(prisma.calls.collaborators, 0);
	});

	it('ignores collaborators whose access was revoked', async () => {
		// revokedAt is how access is taken away; the row stays. Without this filter an
		// ex-collaborator keeps hearing about a note they can no longer open.
		const prisma = fakePrisma({ members: ['alice'], collaborators: ['carol'] });
		const resolver = resolverFor(prisma);
		await resolver.resolveRecipients({ workspaceId: WORKSPACE, docId: DOC });
		assert.deepEqual(prisma.calls.lastCollaboratorWhere, { docId: DOC, revokedAt: null });
	});
});

describe('fail closed', () => {
	it('returns null when the member lookup throws', async () => {
		const resolver = resolverFor(fakePrisma({ members: new Error('db down') }));
		assert.equal(await resolver.resolveRecipients({ workspaceId: WORKSPACE, docId: DOC }), null);
	});

	it('returns null when the collaborator lookup throws', async () => {
		// Falling back to "just the members" would be worse than silence: it would quietly drop a
		// collaborator who should have been told.
		const resolver = resolverFor(fakePrisma({ members: ['alice'], collaborators: new Error('db down') }));
		assert.equal(await resolver.resolveRecipients({ workspaceId: WORKSPACE, docId: DOC }), null);
	});

	it('returns null rather than an empty list when nobody matches', async () => {
		// THE bug. An empty userIds array is not "tell nobody", it is "tell everybody".
		const resolver = resolverFor(fakePrisma({ members: [], collaborators: [] }));
		assert.equal(await resolver.resolveRecipients({ workspaceId: WORKSPACE, docId: DOC }), null);
	});

	it('returns null without a workspace id', async () => {
		const resolver = resolverFor(fakePrisma());
		assert.equal(await resolver.resolveRecipients({ workspaceId: '', docId: DOC }), null);
	});

	it('returns null with no database at all', async () => {
		const resolver = resolverFor(null);
		assert.equal(await resolver.resolveRecipients({ workspaceId: WORKSPACE, docId: DOC }), null);
	});

	it('never returns an empty array, in any failure mode', async () => {
		// Stated once as an invariant, because every caller's guard is `if (!userIds) return` and
		// an empty array would sail straight through it.
		const cases = [
			fakePrisma({ members: [] }),
			fakePrisma({ members: new Error('x') }),
			fakePrisma({ members: ['a'], collaborators: new Error('x') }),
		];
		for (const prisma of cases) {
			const result = await resolverFor(prisma).resolveRecipients({ workspaceId: WORKSPACE, docId: DOC });
			assert.ok(result === null || result.length > 0, 'null or non-empty, never []');
		}
	});
});

describe('caching', () => {
	it('does not re-query within the TTL', async () => {
		const prisma = fakePrisma({ members: ['alice'] });
		const resolver = resolverFor(prisma, 10_000);
		await resolver.resolveRecipients({ workspaceId: WORKSPACE, docId: DOC });
		await resolver.resolveRecipients({ workspaceId: WORKSPACE, docId: DOC });
		assert.equal(prisma.calls.members, 1);
	});

	it('does not cache a failure', async () => {
		// A transient error must not silence a note for the whole TTL.
		let shouldThrow = true;
		const prisma = {
			workspaceMember: {
				findMany: async () => {
					if (shouldThrow) throw new Error('transient');
					return [{ userId: 'alice' }];
				},
			},
			noteCollaborator: { findMany: async () => [] },
		};
		const resolver = resolverFor(prisma, 10_000);
		assert.equal(await resolver.resolveRecipients({ workspaceId: WORKSPACE, docId: DOC }), null);
		shouldThrow = false;
		assert.deepEqual(await resolver.resolveRecipients({ workspaceId: WORKSPACE, docId: DOC }), ['alice']);
	});

	it('clear() forgets everything', async () => {
		const prisma = fakePrisma({ members: ['alice'] });
		const resolver = resolverFor(prisma, 10_000);
		await resolver.resolveRecipients({ workspaceId: WORKSPACE, docId: DOC });
		resolver.clear();
		await resolver.resolveRecipients({ workspaceId: WORKSPACE, docId: DOC });
		assert.equal(prisma.calls.members, 2);
	});

	it('keeps workspaces apart', async () => {
		const prisma = fakePrisma({ members: ['alice'] });
		const resolver = resolverFor(prisma, 10_000);
		await resolver.resolveRecipients({ workspaceId: 'ws-1', docId: 'ws-1:n' });
		await resolver.resolveRecipients({ workspaceId: 'ws-2', docId: 'ws-2:n' });
		assert.equal(prisma.calls.members, 2);
	});
});
