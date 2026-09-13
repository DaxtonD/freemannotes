'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for src/core/noteLinkAutoLink.ts's autoLinkifyRichContentJson — the
// close-time transform that turns bare URL text in a note's rich content into
// real `link` marks. Pure prosemirror-json in, prosemirror-json out; no editor
// instance, no Yjs doc, so these run without a browser.
//
// Run individually:  node --test tests/note-link-auto-link.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

require('ts-node/register/transpile-only');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { autoLinkifyRichContentJson, collectLinkedUrlsFromRichContentJson } = require('../src/core/noteLinkAutoLink.ts');

const noPrior = new Set();

function paragraphDoc(...textNodes) {
	return { type: 'doc', content: [{ type: 'paragraph', content: textNodes }] };
}

function text(value, marks) {
	return marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
}

describe('autoLinkifyRichContentJson', () => {
	it('links a bare URL in the middle of a sentence', () => {
		const doc = paragraphDoc(text('see https://example.com/page for details'));
		const result = autoLinkifyRichContentJson(doc, noPrior);
		assert.equal(result.changed, true);
		const pieces = result.json.content[0].content;
		assert.deepEqual(pieces.map((p) => p.text), ['see ', 'https://example.com/page', ' for details']);
		assert.deepEqual(pieces[1].marks, [{ type: 'link', attrs: { href: 'https://example.com/page' } }]);
		assert.equal(result.linksNeedingPreview.length, 1);
		assert.equal(result.linksNeedingPreview[0].normalizedUrl, 'https://example.com/page');
	});

	it('reports no change and returns the same object when there is nothing to link', () => {
		const doc = paragraphDoc(text('just a normal sentence'));
		const result = autoLinkifyRichContentJson(doc, noPrior);
		assert.equal(result.changed, false);
		assert.equal(result.json, doc);
		assert.deepEqual(result.linksNeedingPreview, []);
	});

	it('does not re-wrap a URL that already has a link mark, but still queues its preview', () => {
		const doc = paragraphDoc(text('https://example.com', [{ type: 'link', attrs: { href: 'https://example.com' } }]));
		const result = autoLinkifyRichContentJson(doc, noPrior);
		assert.equal(result.changed, false); // the tree itself is untouched
		assert.equal(result.linksNeedingPreview.length, 1);
		assert.equal(result.linksNeedingPreview[0].normalizedUrl, 'https://example.com/');
	});

	it('queues a preview for a manually-applied link whose visible text is not URL-shaped at all', () => {
		// "Google" linked to https://google.com via the toolbar — the text has no
		// URL in it; the only way to find the target is the mark's own href.
		const doc = paragraphDoc(text('Google', [{ type: 'link', attrs: { href: 'https://google.com' } }]));
		const result = autoLinkifyRichContentJson(doc, noPrior);
		assert.equal(result.changed, false);
		assert.equal(result.linksNeedingPreview.length, 1);
		assert.equal(result.linksNeedingPreview[0].normalizedUrl, 'https://google.com/');
	});

	it('does not re-queue an already-handled pre-existing link', () => {
		const doc = paragraphDoc(text('Google', [{ type: 'link', attrs: { href: 'https://google.com' } }]));
		const result = autoLinkifyRichContentJson(doc, new Set(['https://google.com/']));
		assert.equal(result.changed, false);
		assert.deepEqual(result.linksNeedingPreview, []);
	});

	it('queues a preview for a URL TipTap already auto-linked live, without re-splitting it', () => {
		// Simulates autolink:true having already turned typed text into a real
		// link mark before this ever runs — same shape as case above, different
		// origin story.
		const doc = paragraphDoc(text('https://www.google.com', [{ type: 'link', attrs: { href: 'https://www.google.com' } }]));
		const result = autoLinkifyRichContentJson(doc, noPrior);
		assert.equal(result.changed, false);
		assert.equal(result.linksNeedingPreview.length, 1);
		assert.equal(result.linksNeedingPreview[0].normalizedUrl, 'https://www.google.com/');
	});

	it('does not linkify a URL shown with an inline code mark', () => {
		const doc = paragraphDoc(text('https://example.com', [{ type: 'code' }]));
		const result = autoLinkifyRichContentJson(doc, noPrior);
		assert.equal(result.changed, false);
	});

	it('does not linkify inside a code block', () => {
		const doc = { type: 'doc', content: [{ type: 'codeBlock', content: [text('https://example.com')] }] };
		const result = autoLinkifyRichContentJson(doc, noPrior);
		assert.equal(result.changed, false);
	});

	it('leaves an already-handled URL as plain text instead of re-linking it', () => {
		const doc = paragraphDoc(text('see https://example.com/page here'));
		const result = autoLinkifyRichContentJson(doc, new Set(['https://example.com/page']));
		assert.equal(result.changed, false);
		assert.deepEqual(result.linksNeedingPreview, []);
	});

	it('links a new URL but leaves an already-handled one alone in the same text node', () => {
		const doc = paragraphDoc(text('old https://old.com new https://new.com'));
		const result = autoLinkifyRichContentJson(doc, new Set(['https://old.com/']));
		const pieces = result.json.content[0].content;
		const oldPiece = pieces.find((p) => p.text === 'https://old.com');
		const newPiece = pieces.find((p) => p.text === 'https://new.com');
		assert.equal(oldPiece.marks, undefined);
		assert.deepEqual(newPiece.marks, [{ type: 'link', attrs: { href: 'https://new.com' } }]);
		assert.equal(result.linksNeedingPreview.length, 1);
		assert.equal(result.linksNeedingPreview[0].normalizedUrl, 'https://new.com/');
	});

	it('preserves an existing mark (e.g. bold) on both the linked and unlinked segments', () => {
		const doc = paragraphDoc(text('bold https://example.com text', [{ type: 'bold' }]));
		const result = autoLinkifyRichContentJson(doc, noPrior);
		const pieces = result.json.content[0].content;
		for (const piece of pieces) {
			assert.ok(piece.marks.some((m) => m.type === 'bold'));
		}
		const linked = pieces.find((p) => p.text === 'https://example.com');
		assert.ok(linked.marks.some((m) => m.type === 'link'));
	});

	it('links a URL inside a nested list item', () => {
		const doc = {
			type: 'doc',
			content: [{
				type: 'bulletList',
				content: [{
					type: 'listItem',
					content: [{ type: 'paragraph', content: [text('link: https://example.com/nested')] }],
				}],
			}],
		};
		const result = autoLinkifyRichContentJson(doc, noPrior);
		assert.equal(result.changed, true);
		const para = result.json.content[0].content[0].content[0];
		assert.ok(para.content.some((p) => p.marks?.some((m) => m.type === 'link')));
	});

	it('handles multiple separate text nodes across the document', () => {
		const doc = {
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [text('first https://a.com')] },
				{ type: 'paragraph', content: [text('second https://b.com')] },
			],
		};
		const result = autoLinkifyRichContentJson(doc, noPrior);
		assert.equal(result.linksNeedingPreview.length, 2);
	});
});

describe('collectLinkedUrlsFromRichContentJson', () => {
	it('collects hrefs from real link marks, normalized', () => {
		const doc = paragraphDoc(
			text('Google', [{ type: 'link', attrs: { href: 'https://google.com' } }]),
			text(' and '),
			text('example', [{ type: 'link', attrs: { href: 'HTTPS://EXAMPLE.COM/page' } }]),
		);
		const found = collectLinkedUrlsFromRichContentJson(doc);
		assert.deepEqual([...found].sort(), ['https://example.com/page', 'https://google.com/']);
	});

	it('returns an empty set when there are no links', () => {
		const doc = paragraphDoc(text('just plain text'));
		assert.deepEqual(collectLinkedUrlsFromRichContentJson(doc), new Set());
	});

	it('finds links nested inside lists', () => {
		const doc = {
			type: 'doc',
			content: [{
				type: 'bulletList',
				content: [{
					type: 'listItem',
					content: [{
						type: 'paragraph',
						content: [text('site', [{ type: 'link', attrs: { href: 'https://nested.example' } }])],
					}],
				}],
			}],
		};
		assert.deepEqual(collectLinkedUrlsFromRichContentJson(doc), new Set(['https://nested.example/']));
	});
});
