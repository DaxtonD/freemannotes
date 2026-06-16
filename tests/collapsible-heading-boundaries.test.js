'use strict';

require('ts-node/register/transpile-only');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
	buildCollapsibleHeadingLayout,
	getHeadingSectionEndIndex,
} = require('../src/core/collapsibleRichHeadings.ts');

function heading(level, text, { collapsible = false, collapseId = null } = {}) {
	return {
		type: 'heading',
		attrs: { level, collapsible, collapseId },
		content: [{ type: 'text', text }],
	};
}

function paragraph(text) {
	return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function collapsedIds(...ids) {
	const prefs = {};
	for (const id of ids) prefs[id] = true;
	return (collapseId) => prefs[collapseId] === true;
}

describe('collapsible heading section boundaries', () => {
	it('consumes non-collapsible sibling H1 when parent H1 is collapsed', () => {
		const blocks = [
			heading(1, 'Heading 1', { collapsible: true, collapseId: 'h1a' }),
			paragraph('some text here'),
			heading(1, 'Heading 2'),
			paragraph('more text'),
		];
		assert.equal(getHeadingSectionEndIndex(blocks, 0, 1), blocks.length);
		const layout = buildCollapsibleHeadingLayout(blocks, collapsedIds('h1a'));
		assert.equal(layout[0].hidden, false);
		assert.equal(layout[1].hidden, true);
		assert.equal(layout[2].hidden, true);
		assert.equal(layout[3].hidden, true);
	});

	it('stops at collapsible sibling H1 and keeps it visible', () => {
		const blocks = [
			heading(1, 'Heading 1', { collapsible: true, collapseId: 'h1a' }),
			paragraph('some text here'),
			heading(1, 'Heading 2', { collapsible: true, collapseId: 'h1b' }),
			paragraph('more text'),
		];
		assert.equal(getHeadingSectionEndIndex(blocks, 0, 1), 2);
		const layout = buildCollapsibleHeadingLayout(blocks, collapsedIds('h1a'));
		assert.equal(layout[0].hidden, false);
		assert.equal(layout[1].hidden, true);
		assert.equal(layout[2].hidden, false);
		assert.equal(layout[3].hidden, false);
	});

	it('consumes lower-level headings until next collapsible H1', () => {
		const blocks = [
			heading(1, 'Heading 1', { collapsible: true, collapseId: 'h1a' }),
			paragraph('some text here'),
			heading(2, 'Heading 1a'),
			paragraph('nested text'),
			heading(1, 'Heading 2', { collapsible: true, collapseId: 'h1b' }),
			paragraph('more text'),
		];
		assert.equal(getHeadingSectionEndIndex(blocks, 0, 1), 4);
		const layout = buildCollapsibleHeadingLayout(blocks, collapsedIds('h1a'));
		assert.equal(layout[0].hidden, false);
		assert.equal(layout[1].hidden, true);
		assert.equal(layout[2].hidden, true);
		assert.equal(layout[3].hidden, true);
		assert.equal(layout[4].hidden, false);
		assert.equal(layout[5].hidden, false);
	});

	it('preserves nested H2 collapsed state when parent H1 is expanded', () => {
		const blocks = [
			heading(1, 'June 8 2026', { collapsible: true, collapseId: 'j8' }),
			paragraph('some text'),
			heading(2, 'Update', { collapsible: true, collapseId: 'upd' }),
			paragraph('update text'),
			heading(1, 'June 9 2026', { collapsible: true, collapseId: 'j9' }),
		];
		const layout = buildCollapsibleHeadingLayout(blocks, collapsedIds('upd', 'j9'));
		assert.equal(layout[0].collapsed, false);
		assert.equal(layout[1].hidden, false);
		assert.equal(layout[2].collapsed, true);
		assert.equal(layout[3].hidden, true);
		assert.equal(layout[4].collapsed, true);
		assert.equal(layout[4].hidden, false);
	});
});
