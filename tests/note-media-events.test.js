'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Media events must carry a recipient list.
//
// The bug, verified before it was fixed: publishNoteMediaMetadataChange emitted
//
//     { reason, workspaceId, docId }
//
// and nothing else. server.js then does:
//
//     const allowedUserIds = event.userIds.length > 0 ? new Set(...) : null;
//     if (allowedUserIds && !allowedUserIds.has(session.userId)) continue;
//
// An empty recipient list is therefore not "tell nobody" — it is "tell
// everybody". Every image upload, document upload, link preview and OCR
// progress tick published that note's `workspaceId:noteId` to every connected
// client on the server, for a note most of them could not open. All thirteen
// call sites in the media router went through this one function.
//
// These tests sit on the function rather than the router so they can assert the
// security property directly, without a database or an HTTP request in the way.
//
// Run individually:  node --test tests/note-media-events.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { publishNoteMediaMetadataChange } = require('../server/noteMediaRouter');
const { createNoteRecipientResolver } = require('../server/noteRecipients');

const ACCESS = { sourceWorkspaceId: 'ws-1', docId: 'ws-1:note-1' };

/** Collects whatever gets published. */
function recorder() {
	const events = [];
	const emit = async (event) => { events.push(event); };
	return { events, emit };
}

function resolverWith({ members = ['alice'], collaborators = [] } = {}) {
	return createNoteRecipientResolver({
		prisma: {
			workspaceMember: {
				findMany: async () => {
					if (members instanceof Error) throw members;
					return members.map((userId) => ({ userId }));
				},
			},
			noteCollaborator: {
				findMany: async () => {
					if (collaborators instanceof Error) throw collaborators;
					return collaborators.map((userId) => ({ userId }));
				},
			},
		},
	});
}

describe('a media event names its recipients', () => {
	it('includes workspace members and note collaborators', async () => {
		const { events, emit } = recorder();
		await publishNoteMediaMetadataChange(
			emit, ACCESS, 'note-media-created', resolverWith({ members: ['alice'], collaborators: ['carol'] })
		);
		assert.equal(events.length, 1);
		assert.deepEqual([...events[0].userIds].sort(), ['alice', 'carol']);
	});

	it('still carries the reason, workspace and doc', async () => {
		const { events, emit } = recorder();
		await publishNoteMediaMetadataChange(emit, ACCESS, 'note-links-updated', resolverWith());
		assert.equal(events[0].reason, 'note-links-updated');
		assert.equal(events[0].workspaceId, 'ws-1');
		assert.equal(events[0].docId, 'ws-1:note-1');
	});

	it('covers links, images, documents and OCR alike', async () => {
		// All four families go through this one function, so none of them can be forgotten - but
		// they are listed explicitly because "it is the same code path" is exactly the assumption
		// that let the leak survive.
		const reasons = [
			'note-links-updated',
			'note-media-created',
			'note-media-deleted',
			'note-documents-created',
			'note-documents-deleted',
			'note-documents-ocr',
			'note-documents-ocr-progress',
			'note-documents-previewed',
			'note-documents-converted',
			'note-documents-version-added',
			'note-documents-version-deleted',
		];
		for (const reason of reasons) {
			const { events, emit } = recorder();
			await publishNoteMediaMetadataChange(emit, ACCESS, reason, resolverWith());
			assert.equal(events.length, 1, reason);
			assert.ok(events[0].userIds.length > 0, `${reason} must name recipients`);
		}
	});
});

describe('it publishes nothing rather than broadcasting', () => {
	it('stays silent when the lookup fails', async () => {
		// Silence costs somebody a refresh. The alternative costs everybody a note id.
		const { events, emit } = recorder();
		await publishNoteMediaMetadataChange(
			emit, ACCESS, 'note-media-created', resolverWith({ members: new Error('db down') })
		);
		assert.equal(events.length, 0);
	});

	it('stays silent when there are no recipients at all', async () => {
		const { events, emit } = recorder();
		await publishNoteMediaMetadataChange(
			emit, ACCESS, 'note-media-created', resolverWith({ members: [] })
		);
		assert.equal(events.length, 0);
	});

	it('stays silent when no resolver is supplied', async () => {
		// The old signature. A caller that forgets the recipient list now publishes nothing
		// instead of publishing to everyone - the failure mode is reversed on purpose.
		const { events, emit } = recorder();
		await publishNoteMediaMetadataChange(emit, ACCESS, 'note-media-created');
		assert.equal(events.length, 0);
	});

	it('never emits an event with an empty userIds array', async () => {
		// The invariant that matters, since an empty array is what the broadcaster treats as
		// "no filter". Null, undefined and [] must all be impossible on the wire.
		for (const options of [{ members: [] }, { members: new Error('x') }, { members: ['a'], collaborators: new Error('x') }]) {
			const { events, emit } = recorder();
			await publishNoteMediaMetadataChange(emit, ACCESS, 'note-media-created', resolverWith(options));
			for (const event of events) {
				assert.ok(Array.isArray(event.userIds) && event.userIds.length > 0, 'no empty recipient list');
			}
		}
	});

	it('does nothing without an emitter or an access object', async () => {
		await publishNoteMediaMetadataChange(null, ACCESS, 'note-media-created', resolverWith());
		const { events, emit } = recorder();
		await publishNoteMediaMetadataChange(emit, null, 'note-media-created', resolverWith());
		assert.equal(events.length, 0);
	});

	it('swallows an emitter that throws', async () => {
		// Publishing is a nudge, not a transaction. An upload must not fail because a socket did.
		const emit = async () => { throw new Error('socket gone'); };
		await publishNoteMediaMetadataChange(emit, ACCESS, 'note-media-created', resolverWith());
	});
});
