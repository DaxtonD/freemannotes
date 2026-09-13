'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for src/core/noteLinks.ts's URL auto-detection:
//   extractUrlCandidatesFromText  — finds URL-shaped tokens in free text
//   findNewlyTypedNoteLinks       — diffs against an "already offered" set
//   findCleanableOrphanedPreviews — which previews "Clean up" may remove
//
// Run individually:  node --test tests/note-links-auto-detect.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

require('ts-node/register/transpile-only');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractUrlCandidatesFromText, findNewlyTypedNoteLinks, findCleanableOrphanedPreviews } = require('../src/core/noteLinks.ts');

function link(normalizedUrl) {
	return { url: normalizedUrl, normalizedUrl, hostname: '', rootDomain: '', sortOrder: 0 };
}

describe('extractUrlCandidatesFromText', () => {
	it('finds a bare https URL in prose', () => {
		assert.deepEqual(extractUrlCandidatesFromText('check out https://example.com/page for details'), ['https://example.com/page']);
	});

	it('finds a www.-prefixed URL with no scheme', () => {
		assert.deepEqual(extractUrlCandidatesFromText('see www.example.com'), ['www.example.com']);
	});

	it('does not match a bare domain-looking word with no scheme or www.', () => {
		assert.deepEqual(extractUrlCandidatesFromText('talked to john re: project.io status'), []);
	});

	it('trims a trailing sentence period that is not part of the URL', () => {
		assert.deepEqual(extractUrlCandidatesFromText('Read this: https://example.com/article.'), ['https://example.com/article']);
	});

	it('does not swallow a closing paren wrapped around the URL', () => {
		assert.deepEqual(extractUrlCandidatesFromText('(see https://example.com/x)'), ['https://example.com/x']);
	});

	it('finds multiple distinct URLs', () => {
		assert.deepEqual(
			extractUrlCandidatesFromText('https://a.com and https://b.com'),
			['https://a.com', 'https://b.com'],
		);
	});

	it('deduplicates an exact repeat within the same text', () => {
		assert.deepEqual(
			extractUrlCandidatesFromText('https://a.com again: https://a.com'),
			['https://a.com'],
		);
	});

	it('returns nothing for text with no URLs', () => {
		assert.deepEqual(extractUrlCandidatesFromText('just a normal checklist item'), []);
	});
});

describe('findNewlyTypedNoteLinks', () => {
	it('returns a URL not yet in the already-offered set', () => {
		const found = findNewlyTypedNoteLinks('see https://example.com/page', new Set());
		assert.equal(found.length, 1);
		assert.equal(found[0].normalizedUrl, 'https://example.com/page');
	});

	it('does not re-offer a URL already in the already-offered set (manual-delete stays deleted)', () => {
		const found = findNewlyTypedNoteLinks(
			'see https://example.com/page',
			new Set(['https://example.com/page']),
		);
		assert.deepEqual(found, []);
	});

	it('normalizes before comparing, so a trailing-slash variant of an offered URL is not re-offered', () => {
		// The root path normalizes to a trailing slash either way.
		const found = findNewlyTypedNoteLinks('see https://example.com', new Set(['https://example.com/']));
		assert.deepEqual(found, []);
	});

	it('only returns URLs that are actually new, leaving already-offered ones out', () => {
		const found = findNewlyTypedNoteLinks(
			'https://old.com and https://new.com',
			new Set(['https://old.com/']),
		);
		assert.equal(found.length, 1);
		assert.equal(found[0].normalizedUrl, 'https://new.com/');
	});
});

describe('findCleanableOrphanedPreviews', () => {
	it('removes a preview whose link is gone from content, when it was content-derived', () => {
		const previews = [link('https://gone.com/')];
		const result = findCleanableOrphanedPreviews(previews, new Set(), new Set(['https://gone.com/']));
		assert.deepEqual(result, previews);
	});

	it('never removes a manually-added preview, even though it has no matching content', () => {
		// Added via "+ URL Preview" — never discovered by the content scanner, so
		// it never made it into autoLinkedUrls. This is the exact case that must
		// never be "cleaned up".
		const previews = [link('https://manually-added.com/')];
		const result = findCleanableOrphanedPreviews(previews, new Set(), new Set());
		assert.deepEqual(result, []);
	});

	it('keeps a preview whose link is still present in the content', () => {
		const previews = [link('https://still-here.com/')];
		const result = findCleanableOrphanedPreviews(previews, new Set(['https://still-here.com/']), new Set(['https://still-here.com/']));
		assert.deepEqual(result, []);
	});

	it('sorts a mix of manual and content-derived previews correctly', () => {
		const previews = [link('https://manual.com/'), link('https://orphaned.com/'), link('https://linked.com/')];
		const result = findCleanableOrphanedPreviews(
			previews,
			new Set(['https://linked.com/']),
			new Set(['https://orphaned.com/', 'https://linked.com/']) // manual.com never scanned, so never in this set
		);
		assert.deepEqual(result.map((l) => l.normalizedUrl), ['https://orphaned.com/']);
	});
});
