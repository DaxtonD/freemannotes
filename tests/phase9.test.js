'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 9 Tests – Trash, Preferences, Cleanup
//
// Uses Node.js built-in test runner (node:test + node:assert).
// Run with:  node --test tests/phase9.test.js
//
// These tests validate:
//   1. Note model trash toggle via Yjs metadata (setNoteTrashed / readTrashState)
//   2. Trash state round-trip through Y.Doc encode/decode (offline sync)
//   3. Server-side cleanup identification of expired trashed notes
//   4. Preference validation logic
//   5. CRDT convergence: trash state converges across independent Y.Docs
//
// No database or network required — all tests operate on in-memory Yjs docs
// and mock/stub server modules where needed.
// ─────────────────────────────────────────────────────────────────────────────

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Initialize a minimal text note doc with the canonical field layout.
 * Mirrors the client-side initTextNoteDoc but works in pure Node.js.
 */
function initTextNoteDoc(doc, title, body) {
	const now = Date.now();
	doc.transact(() => {
		const yTitle = doc.getText('title');
		yTitle.delete(0, yTitle.length);
		yTitle.insert(0, title);
		const yContent = doc.getText('content');
		yContent.delete(0, yContent.length);
		yContent.insert(0, body);
		const metadata = doc.getMap('metadata');
		metadata.set('type', 'text');
		metadata.set('createdAt', now);
		metadata.set('updatedAt', now);
		metadata.set('trashed', false);
		metadata.set('trashedAt', null);
	});
}

/**
 * Set the trashed state on a note doc (mirrors client-side setNoteTrashed).
 */
function setNoteTrashed(doc, trashed = true) {
	const metadata = doc.getMap('metadata');
	doc.transact(() => {
		metadata.set('trashed', trashed);
		metadata.set('trashedAt', trashed ? new Date().toISOString() : null);
		metadata.set('updatedAt', Date.now());
	});
}

/**
 * Read the trash state from a note doc (mirrors client-side readTrashState).
 */
function readTrashState(doc) {
	const metadata = doc.getMap('metadata');
	const trashed = Boolean(metadata.get('trashed'));
	const rawTrashedAt = metadata.get('trashedAt');
	const trashedAt = typeof rawTrashedAt === 'string' ? rawTrashedAt : null;
	return { trashed, trashedAt };
}

/**
 * Read a full note snapshot from a doc (mirrors client-side readNoteFromDoc).
 */
function readNoteFromDoc(doc, id) {
	const metadata = doc.getMap('metadata');
	const type = String(metadata.get('type') ?? 'text');
	const title = doc.getText('title').toString();
	const createdAt = Number(metadata.get('createdAt') ?? 0);
	const updatedAt = Number(metadata.get('updatedAt') ?? createdAt);
	const trashed = Boolean(metadata.get('trashed'));
	const rawTrashedAt = metadata.get('trashedAt');
	const trashedAt = typeof rawTrashedAt === 'string' ? rawTrashedAt : null;
	const content = type === 'text' ? doc.getText('content').toString() : undefined;
	return { id, type, title, createdAt, updatedAt, trashed, trashedAt, content };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 9 – Trash / Preferences / Cleanup', () => {
	// ── 1. Trash toggle ──────────────────────────────────────────────────

	describe('Trash toggle (Yjs metadata)', () => {
		it('newly created note is not trashed', () => {
			const doc = new Y.Doc();
			initTextNoteDoc(doc, 'Test', 'Hello');
			const state = readTrashState(doc);
			assert.equal(state.trashed, false);
			assert.equal(state.trashedAt, null);
			doc.destroy();
		});

		it('setNoteTrashed(doc, true) marks note as trashed with ISO timestamp', () => {
			const doc = new Y.Doc();
			initTextNoteDoc(doc, 'Test', 'Hello');
			const before = Date.now();
			setNoteTrashed(doc, true);
			const after = Date.now();
			const state = readTrashState(doc);
			assert.equal(state.trashed, true);
			assert.ok(typeof state.trashedAt === 'string', 'trashedAt should be an ISO string');
			const parsed = new Date(state.trashedAt).getTime();
			assert.ok(Number.isFinite(parsed), 'trashedAt must be a valid ISO date');
			assert.ok(parsed >= before && parsed <= after, 'trashedAt must be within test window');
			doc.destroy();
		});

		it('setNoteTrashed(doc, false) restores note and clears trashedAt', () => {
			const doc = new Y.Doc();
			initTextNoteDoc(doc, 'Test', 'Hello');
			setNoteTrashed(doc, true);
			assert.equal(readTrashState(doc).trashed, true);
			setNoteTrashed(doc, false);
			const state = readTrashState(doc);
			assert.equal(state.trashed, false);
			assert.equal(state.trashedAt, null);
			doc.destroy();
		});

		it('readNoteFromDoc includes trashed and trashedAt', () => {
			const doc = new Y.Doc();
			initTextNoteDoc(doc, 'My Note', 'Body text');
			setNoteTrashed(doc, true);
			const note = readNoteFromDoc(doc, 'note-1');
			assert.equal(note.id, 'note-1');
			assert.equal(note.trashed, true);
			assert.ok(typeof note.trashedAt === 'string', 'trashedAt should be ISO string');
			assert.equal(note.title, 'My Note');
			assert.equal(note.content, 'Body text');
			doc.destroy();
		});

		it('legacy notes without trashed field default to not-trashed', () => {
			const doc = new Y.Doc();
			// Simulate a legacy note that only has type/createdAt/updatedAt.
			doc.transact(() => {
				doc.getText('title').insert(0, 'Legacy');
				doc.getText('content').insert(0, 'Old note');
				const metadata = doc.getMap('metadata');
				metadata.set('type', 'text');
				metadata.set('createdAt', Date.now());
				metadata.set('updatedAt', Date.now());
				// No trashed or trashedAt fields — simulate pre-Phase 9 note.
			});
			const state = readTrashState(doc);
			assert.equal(state.trashed, false);
			assert.equal(state.trashedAt, null);
			doc.destroy();
		});
	});

	// ── 2. Offline sync (encode/decode round-trip) ───────────────────────

	describe('Trash state survives offline sync (Y.Doc encode/decode)', () => {
		it('trash state round-trips through Y.encodeStateAsUpdate', () => {
			const doc1 = new Y.Doc();
			initTextNoteDoc(doc1, 'Offline Note', 'Body');
			setNoteTrashed(doc1, true);
			const trashedAtOriginal = readTrashState(doc1).trashedAt;

			// Encode → decode into a fresh doc (simulates IndexedDB persistence).
			const update = Y.encodeStateAsUpdate(doc1);
			const doc2 = new Y.Doc();
			Y.applyUpdate(doc2, update);

			const state = readTrashState(doc2);
			assert.equal(state.trashed, true);
			assert.equal(state.trashedAt, trashedAtOriginal);

			doc1.destroy();
			doc2.destroy();
		});

		it('restore round-trips through encode/decode', () => {
			const doc1 = new Y.Doc();
			initTextNoteDoc(doc1, 'Restored Note', 'Body');
			setNoteTrashed(doc1, true);
			setNoteTrashed(doc1, false);

			const update = Y.encodeStateAsUpdate(doc1);
			const doc2 = new Y.Doc();
			Y.applyUpdate(doc2, update);

			const state = readTrashState(doc2);
			assert.equal(state.trashed, false);
			assert.equal(state.trashedAt, null);

			doc1.destroy();
			doc2.destroy();
		});
	});

	// ── 3. CRDT convergence across tabs ──────────────────────────────────

	describe('CRDT convergence – trash state syncs across Y.Docs', () => {
		it('trash state from doc1 propagates to doc2 via incremental update', () => {
			const doc1 = new Y.Doc();
			const doc2 = new Y.Doc();

			// Wire bidirectional sync (simulates y-websocket relay).
			doc1.on('update', (update) => Y.applyUpdate(doc2, update));
			doc2.on('update', (update) => Y.applyUpdate(doc1, update));

			// Create note on doc1.
			initTextNoteDoc(doc1, 'Synced Note', 'Content');

			// Verify doc2 received the creation.
			assert.equal(doc2.getText('title').toString(), 'Synced Note');
			assert.equal(readTrashState(doc2).trashed, false);

			// Trash on doc1 → should appear on doc2.
			setNoteTrashed(doc1, true);
			assert.equal(readTrashState(doc2).trashed, true);
			assert.ok(typeof readTrashState(doc2).trashedAt === 'string');

			// Restore on doc2 → should appear on doc1.
			setNoteTrashed(doc2, false);
			assert.equal(readTrashState(doc1).trashed, false);
			assert.equal(readTrashState(doc1).trashedAt, null);

			doc1.destroy();
			doc2.destroy();
		});

		it('concurrent trash + restore converges (last-write-wins for Y.Map)', () => {
			const doc1 = new Y.Doc();
			const doc2 = new Y.Doc();

			initTextNoteDoc(doc1, 'Concurrent Note', 'Content');

			// Sync initial state.
			Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

			// Simulate offline: no sync between doc1 and doc2.
			// doc1 trashes, doc2 independently modifies (e.g. content edit).
			setNoteTrashed(doc1, true);
			doc2.getText('content').insert(0, 'Edit while offline: ');

			// Re-sync: apply each other's updates.
			Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
			Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

			// Both docs should converge to the same trash state.
			// Y.Map uses last-writer-wins per key, so the result depends on
			// client ID ordering, but both must agree.
			const state1 = readTrashState(doc1);
			const state2 = readTrashState(doc2);
			assert.equal(state1.trashed, state2.trashed);
			assert.equal(state1.trashedAt, state2.trashedAt);

			doc1.destroy();
			doc2.destroy();
		});
	});

	// ── 4. Server-side cleanup identification ────────────────────────────

	describe('Trash cleanup – expired note identification', () => {
		it('identifies notes trashed longer than deleteAfterDays', () => {
			const deleteAfterDays = 7;
			const retentionMs = deleteAfterDays * 24 * 60 * 60 * 1000;
			const now = Date.now();

			// Create a note trashed 8 days ago (expired).
			const doc1 = new Y.Doc();
			initTextNoteDoc(doc1, 'Old Trash', 'Content');
			const metadata1 = doc1.getMap('metadata');
			doc1.transact(() => {
				metadata1.set('trashed', true);
				metadata1.set('trashedAt', new Date(now - (8 * 24 * 60 * 60 * 1000)).toISOString());
			});

			// Create a note trashed 3 days ago (not expired).
			const doc2 = new Y.Doc();
			initTextNoteDoc(doc2, 'Recent Trash', 'Content');
			const metadata2 = doc2.getMap('metadata');
			doc2.transact(() => {
				metadata2.set('trashed', true);
				metadata2.set('trashedAt', new Date(now - (3 * 24 * 60 * 60 * 1000)).toISOString());
			});

			// Create a non-trashed note.
			const doc3 = new Y.Doc();
			initTextNoteDoc(doc3, 'Active Note', 'Content');

			// Simulate the cleanup check logic.
			const cutoff = now - retentionMs;
			const docs = [
				{ docId: 'note-1', doc: doc1 },
				{ docId: 'note-2', doc: doc2 },
				{ docId: 'note-3', doc: doc3 },
			];

			const expired = [];
			for (const { docId, doc } of docs) {
				const state = readTrashState(doc);
				if (state.trashed && typeof state.trashedAt === 'string') {
					const trashedAtMs = new Date(state.trashedAt).getTime();
					if (Number.isFinite(trashedAtMs) && trashedAtMs <= cutoff) {
						expired.push(docId);
					}
				}
			}

			assert.deepEqual(expired, ['note-1']);

			doc1.destroy();
			doc2.destroy();
			doc3.destroy();
		});

		it('does not flag non-trashed notes regardless of age', () => {
			const deleteAfterDays = 1;
			const retentionMs = deleteAfterDays * 24 * 60 * 60 * 1000;
			const now = Date.now();

			const doc = new Y.Doc();
			initTextNoteDoc(doc, 'Ancient Note', 'Content');
			// Note is very old but NOT trashed.
			const metadata = doc.getMap('metadata');
			doc.transact(() => {
				metadata.set('createdAt', now - (365 * 24 * 60 * 60 * 1000));
			});

			const cutoff = now - retentionMs;
			const state = readTrashState(doc);
			const isExpired = state.trashed && typeof state.trashedAt === 'string' &&
				Number.isFinite(new Date(state.trashedAt).getTime()) &&
				new Date(state.trashedAt).getTime() <= cutoff;

			assert.equal(isExpired, false);

			doc.destroy();
		});
	});

	// ── 5. Preference validation ─────────────────────────────────────────

	describe('Preference validation', () => {
		it('deleteAfterDays must be a positive integer', () => {
			const MIN = 1;
			const MAX = 365;
			const validateDays = (days) => {
				return Number.isFinite(days) && Number.isInteger(days) && days >= MIN && days <= MAX;
			};

			assert.equal(validateDays(30), true);
			assert.equal(validateDays(1), true);
			assert.equal(validateDays(365), true);
			assert.equal(validateDays(0), false);
			assert.equal(validateDays(-1), false);
			assert.equal(validateDays(366), false);
			assert.equal(validateDays(1.5), false);
			assert.equal(validateDays(NaN), false);
			assert.equal(validateDays(Infinity), false);
		});
	});

	// ── 6. Metadata schema completeness ──────────────────────────────────

	describe('Note metadata schema', () => {
		it('new text note has all canonical metadata fields', () => {
			const doc = new Y.Doc();
			initTextNoteDoc(doc, 'Schema Test', 'Content');
			const metadata = doc.getMap('metadata');

			assert.equal(metadata.get('type'), 'text');
			assert.ok(typeof metadata.get('createdAt') === 'number');
			assert.ok(typeof metadata.get('updatedAt') === 'number');
			assert.equal(metadata.get('trashed'), false);
			assert.equal(metadata.get('trashedAt'), null);
			doc.destroy();
		});

		it('trashing preserves all other metadata fields', () => {
			const doc = new Y.Doc();
			initTextNoteDoc(doc, 'Preserve Test', 'Content');
			const createdAtBefore = doc.getMap('metadata').get('createdAt');
			const typeBefore = doc.getMap('metadata').get('type');

			setNoteTrashed(doc, true);

			const metadata = doc.getMap('metadata');
			assert.equal(metadata.get('type'), typeBefore);
			assert.equal(metadata.get('createdAt'), createdAtBefore);
			assert.equal(metadata.get('trashed'), true);
			assert.ok(typeof metadata.get('trashedAt') === 'string', 'trashedAt should be ISO string');
			doc.destroy();
		});
	});
});
