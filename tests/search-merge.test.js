'use strict';

// mergeSearchResults is what makes global search survive a bad network.
//
// The search used to run the server request and the device's own index as one Promise.all, which
// meant a single rejected fetch threw away offline results that had already resolved, blanked the
// list, and printed the raw DOMException ("signal is aborted without reason") in place of the
// results. The effect now calls this with whatever actually arrived — including an empty array
// for the side that never did — so these cases are the contract that behaviour rests on.

require('ts-node/register/transpile-only');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mergeSearchResults } = require('../src/core/searchResultMerge');

function result(overrides) {
	return {
		docId: 'ws-1:note-1',
		noteId: 'note-1',
		openNoteId: null,
		title: 'Note one',
		snippet: '',
		type: 'text',
		archived: false,
		group: { kind: 'workspace', label: 'Personal', workspaceId: 'ws-1' },
		matchKinds: ['note'],
		collaboratorMatches: [],
		collectionMatches: [],
		labelMatches: [],
		thumbnailUrl: null,
		imageCount: 0,
		updatedAt: '2026-10-09T00:00:00.000Z',
		...overrides,
	};
}

describe('mergeSearchResults', () => {
	it('returns the local results untouched when the server gave nothing', () => {
		// The whole point: a failed fetch must not cost you the results you already have.
		const offline = [result({ noteId: 'a', docId: 'ws-1:a' }), result({ noteId: 'b', docId: 'ws-1:b' })];
		const merged = mergeSearchResults([], offline);
		assert.equal(merged.length, 2);
		assert.deepEqual(merged.map((r) => r.noteId).sort(), ['a', 'b']);
	});

	it('returns the server results when the device index found nothing', () => {
		const remote = [result({ noteId: 'a', docId: 'ws-1:a' })];
		assert.deepEqual(mergeSearchResults(remote, []).map((r) => r.noteId), ['a']);
	});

	it('is empty only when both sides are', () => {
		assert.deepEqual(mergeSearchResults([], []), []);
	});

	it('a note found by both sides appears once, keeping every reason it matched', () => {
		const remote = [result({ matchKinds: ['document', 'ocr'] })];
		const offline = [result({ matchKinds: ['note'] })];
		const merged = mergeSearchResults(remote, offline);
		assert.equal(merged.length, 1, 'the same note was listed twice');
		assert.deepEqual(merged[0].matchKinds.sort(), ['document', 'note', 'ocr']);
	});

	it('the server wins on fields it is authoritative for, with the local value as fallback', () => {
		// Its snippet comes from the full extracted text; the device only has a partial cache.
		const remote = [result({ snippet: 'from the server', thumbnailUrl: null })];
		const offline = [result({ snippet: 'from this device', thumbnailUrl: '/thumb.webp' })];
		const merged = mergeSearchResults(remote, offline);
		assert.equal(merged[0].snippet, 'from the server');
		assert.equal(merged[0].thumbnailUrl, '/thumb.webp', 'should fall back when the server had none');
	});

	it('keeps the newer updatedAt and the larger image count', () => {
		const remote = [result({ updatedAt: '2026-10-01T00:00:00.000Z', imageCount: 1 })];
		const offline = [result({ updatedAt: '2026-10-08T00:00:00.000Z', imageCount: 4 })];
		const merged = mergeSearchResults(remote, offline);
		assert.equal(merged[0].updatedAt, '2026-10-08T00:00:00.000Z');
		assert.equal(merged[0].imageCount, 4);
	});

	it('sorts newest first regardless of which side supplied each note', () => {
		const remote = [result({ noteId: 'old', docId: 'ws-1:old', updatedAt: '2026-01-01T00:00:00.000Z' })];
		const offline = [result({ noteId: 'new', docId: 'ws-1:new', updatedAt: '2026-10-09T00:00:00.000Z' })];
		assert.deepEqual(mergeSearchResults(remote, offline).map((r) => r.noteId), ['new', 'old']);
	});

	it('treats a shared-note alias as its own result, not a duplicate of the source note', () => {
		// The key includes openNoteId: the same underlying doc can legitimately appear twice,
		// once as the owner's note and once as the placement shared into your workspace.
		const remote = [result({ openNoteId: 'shared-placement:p1' }), result({ openNoteId: null })];
		assert.equal(mergeSearchResults(remote, []).length, 2);
	});

	it('caps the context lists so one note cannot flood the row', () => {
		const many = (prefix) => Array.from({ length: 6 }, (_, i) => `${prefix}${i}`);
		const merged = mergeSearchResults(
			[result({ collaboratorMatches: many('r'), labelMatches: many('r') })],
			[result({ collaboratorMatches: many('o'), labelMatches: many('o') })]
		);
		assert.ok(merged[0].collaboratorMatches.length <= 3, 'collaborators uncapped');
		assert.ok(merged[0].labelMatches.length <= 4, 'labels uncapped');
	});
});
