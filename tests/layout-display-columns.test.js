'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the Option B masonry layout functions in layout.ts:
//
//   computeDisplayColumns      — direct bottom-note migration (no cascade)
//   findColumnNeighborAnchor   — column-local anchor for drag commit
//   applyTierReorderByInsertion — canonical reorder by insertion (tier-safe)
//
// Run individually:  node --test tests/layout-display-columns.test.js
// Run with suite:    npm test
//
// No DOM, no React, no Yjs — all three functions are pure.
// ─────────────────────────────────────────────────────────────────────────────

require('ts-node/register/transpile-only');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
	computeDisplayColumns,
	dealIntoColumns,
	findColumnNeighborAnchor,
	applyTierReorderByInsertion,
	applyTierReorderToCanonicalVisible,
	mergeVisibleOrderIntoFullOrder,
	reinsertIdsAtPreviousPositions,
	reorderByInsertion,
	resolveGridDropOrder,
} = require('../src/components/NoteGrid/layout.ts');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a HeightLookup from a plain object { noteId: heightPx }. */
function heights(map) {
	return { get: (id) => map[id] ?? undefined };
}

/** No notes are pinned. */
const noPin = () => false;

/** Notes whose ID starts with 'P' are pinned. */
const pinByPrefix = (id) => id.startsWith('P');

// ── computeDisplayColumns ────────────────────────────────────────────────────

describe('computeDisplayColumns', () => {

	it('single column: returns a copy, no migration attempted', () => {
		const canonical = [['A', 'B', 'C']];
		const result = computeDisplayColumns({
			canonicalColumns: canonical,
			heightById: heights({ A: 100, B: 200, C: 100 }),
			gapPx: 8,
			fallbackHeightPx: 100,
		});
		assert.deepEqual(result, [['A', 'B', 'C']]);
	});

	it('balanced columns: no migration when imbalance is within threshold', () => {
		// col0=[A,C], col1=[B,D] — all 100px, perfectly balanced
		const canonical = [['A', 'C'], ['B', 'D']];
		const result = computeDisplayColumns({
			canonicalColumns: canonical,
			heightById: heights({ A: 100, B: 100, C: 100, D: 100 }),
			gapPx: 8,
			fallbackHeightPx: 100,
			thresholdPx: 150,
		});
		assert.deepEqual(result, [['A', 'C'], ['B', 'D']]);
	});

	it('2-column: moves bottom note of tallest when it reduces grid height', () => {
		// col0=[A,C,D] heights: A=100, C=100, D=100 → 316px
		// col1=[B]     heights: B=300 → 300px
		// Tallest=col0 (316), shortest=col1 (300)? No, col1 has 300 which < 316.
		// Actually let's use: col0 tall because of A being large.
		// col0=[A,C] A=300, C=100 → 300+100+8=408
		// col1=[B,D] B=100, D=100 → 208
		// bottom of col0 = C (100px). 208+8+100=316 < 408 → improvement.
		const canonical = [['A', 'C'], ['B', 'D']];
		const result = computeDisplayColumns({
			canonicalColumns: canonical,
			heightById: heights({ A: 300, B: 100, C: 100, D: 100 }),
			gapPx: 8,
			fallbackHeightPx: 100,
			thresholdPx: 50,
		});
		// C moves from col0 to col1.
		assert.deepEqual(result, [['A'], ['B', 'D', 'C']]);
	});

	it('3-column: only the bottom note of the tallest column moves — no cascade', () => {
		// Canonical round-robin with 6 notes [A,B,C,D,E,F]:
		// col0=[A,D]  A=300, D=100 → 300+100+8=408
		// col1=[B,E]  B=100, E=100 → 208
		// col2=[C,F]  C=100, F=100 → 208
		// col0 is tallest. Bottom of col0 = D (100px).
		// newHeightTallest = 408-100-8 = 300
		// newHeightShortest (col1=208) = 208+8+100 = 316 < 408 → improvement.
		// Only D should move; E and F stay put (no cascade).
		const canonical = [['A', 'D'], ['B', 'E'], ['C', 'F']];
		const result = computeDisplayColumns({
			canonicalColumns: canonical,
			heightById: heights({ A: 300, B: 100, C: 100, D: 100, E: 100, F: 100 }),
			gapPx: 8,
			fallbackHeightPx: 100,
			thresholdPx: 50,
		});
		// D migrates to col1. E and F do not move.
		assert.deepEqual(result[0], ['A']);
		assert.deepEqual(result[1], ['B', 'E', 'D']);
		assert.deepEqual(result[2], ['C', 'F']);
	});

	it('no migration when moving bottom note would make shortest column the new tallest', () => {
		// col0=[A,D,G] A=100, D=100, G=400 → 616px
		// col1=[B,E]   B=100, E=100         → 208px
		// col2=[C,F]   C=100, F=100         → 208px
		// Bottom of col0 = G (400px). newHeightShortest = 208+8+400=616 NOT < 616.
		const canonical = [['A', 'D', 'G'], ['B', 'E'], ['C', 'F']];
		const result = computeDisplayColumns({
			canonicalColumns: canonical,
			heightById: heights({ A: 100, B: 100, C: 100, D: 100, E: 100, F: 100, G: 400 }),
			gapPx: 8,
			fallbackHeightPx: 100,
			thresholdPx: 50,
		});
		// G cannot move — grid height would not decrease. Columns unchanged.
		assert.deepEqual(result, [['A', 'D', 'G'], ['B', 'E'], ['C', 'F']]);
	});

	it('multiple passes: migrates more than one note when each pass improves height', () => {
		// col0=[A,D,G] A=200, D=200, G=100 → 200+200+100+16=516
		// col1=[B]     B=100              → 100
		// col2=[C]     C=100              → 100
		// Pass 1: bottom of col0=G (100). newShort = 100+8+100=208 < 516 → move G to col1.
		//   col0=[A,D]=408, col1=[B,G]=208, col2=[C]=100
		// Pass 2: col0 tallest (408), col2 shortest (100). bottom of col0=D (200).
		//   newShort = 100+8+200=308 < 408 → move D to col2.
		//   col0=[A]=200, col1=[B,G]=208, col2=[C,D]=308
		// Pass 3: col2 tallest (308), col0 shortest (200). bottom of col2=D (200).
		//   newShort = 200+8+200=408 NOT < 308 → stop.
		const canonical = [['A', 'D', 'G'], ['B'], ['C']];
		const result = computeDisplayColumns({
			canonicalColumns: canonical,
			heightById: heights({ A: 200, B: 100, C: 100, D: 200, G: 100 }),
			gapPx: 8,
			fallbackHeightPx: 100,
			thresholdPx: 0,
			maxPasses: 8,
		});
		assert.deepEqual(result[0], ['A']);
		assert.deepEqual(result[1], ['B', 'G']);
		assert.deepEqual(result[2], ['C', 'D']);
	});

});

// ── findColumnNeighborAnchor ─────────────────────────────────────────────────

describe('findColumnNeighborAnchor', () => {

	it('mid-column: prefers next sibling (placeAfter: false)', () => {
		const columns = [['A', 'B', 'C'], ['D', 'E']];
		assert.deepEqual(
			findColumnNeighborAnchor(columns, 'B', noPin),
			{ id: 'C', placeAfter: false },
		);
	});

	it('top of column: uses next sibling when no prev exists', () => {
		const columns = [['B', 'C', 'D']];
		assert.deepEqual(
			findColumnNeighborAnchor(columns, 'B', noPin),
			{ id: 'C', placeAfter: false },
		);
	});

	it('bottom of column: falls back to prev sibling (placeAfter: true)', () => {
		const columns = [['A', 'B', 'C']];
		assert.deepEqual(
			findColumnNeighborAnchor(columns, 'C', noPin),
			{ id: 'B', placeAfter: true },
		);
	});

	it('only note in column: returns null', () => {
		const columns = [['A'], ['B', 'C']];
		assert.equal(findColumnNeighborAnchor(columns, 'A', noPin), null);
	});

	it('note not present in any column: returns null without throwing', () => {
		const columns = [['A', 'B'], ['C', 'D']];
		assert.equal(findColumnNeighborAnchor(columns, 'Z', noPin), null);
	});

	it('correctly finds note in a non-first column', () => {
		const columns = [['A', 'D'], ['B', 'E', 'G'], ['C', 'F']];
		assert.deepEqual(
			findColumnNeighborAnchor(columns, 'E', noPin),
			{ id: 'G', placeAfter: false },
		);
	});

	it('pin boundary: skips opposite-tier next sibling, falls back to prev same-tier', () => {
		// col = [P1, P2, U1, U2] — P2 is the last pinned note.
		// Its immediate next sibling is U1 (opposite tier) and must be skipped.
		const columns = [['P1', 'P2', 'U1', 'U2']];
		assert.deepEqual(
			findColumnNeighborAnchor(columns, 'P2', pinByPrefix),
			{ id: 'P1', placeAfter: true },
		);
	});

	it('only pinned note in column: no same-tier neighbor in either direction → null', () => {
		// P1 is the sole pinned note; U1/U2 are opposite tier.
		const columns = [['P1', 'U1', 'U2']];
		assert.equal(findColumnNeighborAnchor(columns, 'P1', pinByPrefix), null);
	});

});

// ── applyTierReorderByInsertion ──────────────────────────────────────────────

describe('applyTierReorderByInsertion', () => {

	it('null anchor: returns canonical order unchanged', () => {
		const canonical = ['A', 'B', 'C', 'D'];
		assert.deepEqual(
			applyTierReorderByInsertion(canonical, 'C', null, false, false, noPin),
			canonical,
		);
	});

	it('move note down within unpinned tier', () => {
		// User moved B down past C and D; anchor = D, placeAfter = true.
		assert.deepEqual(
			applyTierReorderByInsertion(['A', 'B', 'C', 'D', 'E'], 'B', 'D', true, false, noPin),
			['A', 'C', 'D', 'B', 'E'],
		);
	});

	it('move note up within unpinned tier', () => {
		// User moved D up before B; anchor = B, placeAfter = false.
		assert.deepEqual(
			applyTierReorderByInsertion(['A', 'B', 'C', 'D', 'E'], 'D', 'B', false, false, noPin),
			['A', 'D', 'B', 'C', 'E'],
		);
	});

	it('move note to the very end of the tier', () => {
		assert.deepEqual(
			applyTierReorderByInsertion(['A', 'B', 'C', 'D'], 'B', 'D', true, false, noPin),
			['A', 'C', 'D', 'B'],
		);
	});

	it('pin tier isolation: reordering unpinned leaves pinned notes unmoved', () => {
		// canonical: [P1, P2, U1, U2, U3]. User moved U1 after U2.
		assert.deepEqual(
			applyTierReorderByInsertion(
				['P1', 'P2', 'U1', 'U2', 'U3'], 'U1', 'U2', true, false, pinByPrefix,
			),
			['P1', 'P2', 'U2', 'U1', 'U3'],
		);
	});

	it('pinned tier reorder leaves unpinned notes unmoved', () => {
		// canonical: [P1, P2, U1, U2]. User moved P1 after P2.
		assert.deepEqual(
			applyTierReorderByInsertion(
				['P1', 'P2', 'U1', 'U2'], 'P1', 'P2', true, true, pinByPrefix,
			),
			['P2', 'P1', 'U1', 'U2'],
		);
	});

	it('anchor not found in canonical tier: returns order unchanged', () => {
		// anchorId 'Z' does not exist — reorderByInsertion returns ids unchanged.
		const canonical = ['A', 'B', 'C'];
		assert.deepEqual(
			applyTierReorderByInsertion(canonical, 'B', 'Z', false, false, noPin),
			canonical,
		);
	});

});

// ── resolveGridDropOrder ─────────────────────────────────────────────────────

describe('resolveGridDropOrder', () => {
	const flat = heights({});
	const resolve = (renderedOrder, finalColumns, draggedId, isPinned = noPin, heightById = flat) =>
		resolveGridDropOrder({ renderedOrder, finalColumns, draggedId, isPinned, heightById, gapPx: 0, fallbackHeightPx: 100 });

	it('same-column drop commits exactly the preview and touches no other column', () => {
		// col0=[A,C,E] col1=[B,D,F]. Drag E to the top of col0.
		const next = resolve(['A', 'B', 'C', 'D', 'E', 'F'], [['E', 'A', 'C'], ['B', 'D', 'F']], 'E');
		assert.deepEqual(dealIntoColumns(next, 2), [['E', 'A', 'C'], ['B', 'D', 'F']]);
	});

	it('cross-column drop keeps every neighbour shift; only a bottom note rebalances', () => {
		// col0=[A,C,E,G] col1=[B,D,F,H]. Drag C into col1 between B and D.
		// Preview: col0=[A,E,G] col1=[B,C,D,F,H]. col1's bottom note H moves to col0.
		const next = resolve(
			['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
			[['A', 'E', 'G'], ['B', 'C', 'D', 'F', 'H']],
			'C',
		);
		assert.deepEqual(dealIntoColumns(next, 2), [['A', 'E', 'G', 'H'], ['B', 'C', 'D', 'F']]);
	});

	it('dropping at the very bottom of a column does not undo itself', () => {
		// Drag A to the bottom of col1: the note above it rebalances instead.
		const next = resolve(
			['A', 'B', 'C', 'D', 'E', 'F'],
			[['C', 'E'], ['B', 'D', 'F', 'A']],
			'A',
		);
		assert.deepEqual(dealIntoColumns(next, 2), [['C', 'E', 'F'], ['B', 'D', 'A']]);
	});

	it('with several under-full columns, the pixel-shortest one is filled first', () => {
		// 3 cols, 2 notes each required. col1 is 2 over; col0 (600px) and col2
		// (100px) are each 1 under. E goes to col2 first, then D to col0.
		const next = resolve(
			['A', 'B', 'C', 'D', 'E', 'F'],
			[['B'], ['A', 'C', 'D', 'E'], ['F']],
			'A',
			noPin,
			heights({ B: 600 }),
		);
		assert.deepEqual(dealIntoColumns(next, 3), [['B', 'D'], ['A', 'C'], ['F', 'E']]);
	});

	it('pinned notes keep every index when an unpinned note is dragged', () => {
		// Dealt: [P1,P2,P3,U1,U2,U3] → col0=[P1,P3,U2] col1=[P2,U1,U3]. Drag U2 above U1.
		const next = resolve(
			['P1', 'P2', 'P3', 'U1', 'U2', 'U3'],
			[['P1', 'P3'], ['P2', 'U2', 'U1', 'U3']],
			'U2',
			pinByPrefix,
		);
		assert.deepEqual(next.slice(0, 3), ['P1', 'P2', 'P3']);
		assert.deepEqual(dealIntoColumns(next, 2), [['P1', 'P3', 'U3'], ['P2', 'U2', 'U1']]);
	});

	it('returns null when the columns and the dealt order disagree about which notes exist', () => {
		assert.equal(resolve(['A', 'B', 'C'], [['A', 'C'], ['B', 'Z']], 'A'), null);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// A tier reorder must never INTRODUCE a note.
//
// Reachable through a real feature: a card held on the grid as a tombstone
// (somebody else deleted it, the user has not applied the change yet) is in the
// rendered columns on purpose and out of the canonical commit order on purpose.
// Before these guards, a drag while one was held committed the dead note back
// into the shared registry and pushed a live note out of the order to make room.
// ─────────────────────────────────────────────────────────────────────────────

describe('applyTierReorderToCanonicalVisible ignores ids the canonical list does not hold', () => {
	const unpinned = () => false;

	it('does not let an on-screen-only id into the committed order', () => {
		const result = applyTierReorderToCanonicalVisible(['A', 'B'], ['A', 'TOMB', 'B'], false, unpinned);
		assert.deepEqual(result, ['A', 'B'], 'TOMB is not committed and B is not pushed out');
	});

	it('still applies a genuine reorder', () => {
		const result = applyTierReorderToCanonicalVisible(['A', 'B', 'C'], ['C', 'A', 'B'], false, unpinned);
		assert.deepEqual(result, ['C', 'A', 'B']);
	});

	it('leaves the other pin tier untouched', () => {
		const isPinned = (id) => id === 'P';
		const result = applyTierReorderToCanonicalVisible(['P', 'A', 'B'], ['B', 'TOMB', 'A'], false, isPinned);
		assert.deepEqual(result, ['P', 'B', 'A']);
	});
});

describe('reorderByInsertion reorders but never inserts', () => {
	it('refuses to add an id that was not in the list', () => {
		assert.deepEqual(reorderByInsertion(['A', 'B'], 'TOMB', 'A', true), ['A', 'B']);
	});

	it('still moves an id that IS in the list', () => {
		assert.deepEqual(reorderByInsertion(['A', 'B', 'C'], 'C', 'A', false), ['C', 'A', 'B']);
	});

	it('leaves the list alone when the anchor is unknown', () => {
		assert.deepEqual(reorderByInsertion(['A', 'B'], 'A', 'Z', true), ['A', 'B']);
	});
});

describe('mergeVisibleOrderIntoFullOrder: why tombstones stay out of the commit order', () => {
	it('APPENDS a visible id the full order does not contain', () => {
		// Documenting the mechanism rather than asserting a wish: this is correct for its own
		// contract, and it is exactly why a deleted id must never reach `visibleIds`.
		const next = mergeVisibleOrderIntoFullOrder(['A', 'B'], ['A', 'B', 'TOMB'], ['A', 'B', 'TOMB']);
		assert.deepEqual(next, ['A', 'B', 'TOMB']);
	});

	it('passes the full order through untouched when the visible set is clean', () => {
		const next = mergeVisibleOrderIntoFullOrder(['A', 'B', 'hidden'], ['A', 'B'], ['B', 'A']);
		assert.deepEqual(next, ['B', 'A', 'hidden']);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// reinsertIdsAtPreviousPositions - putting held cards back where they were.
//
// A card somebody else deleted is kept on the grid as a dimmed tombstone, but it
// is deliberately absent from the order that gets written to Yjs (letting a dead
// id in there put the note back into the shared registry for everybody). The
// order used for DRAWING has to put it back, and appending it would move the
// card - which is the one thing the tombstone exists to prevent.
// ─────────────────────────────────────────────────────────────────────────────

describe('reinsertIdsAtPreviousPositions', () => {
	it('restores an id to the index it used to hold', () => {
		const result = reinsertIdsAtPreviousPositions(['A', 'C'], ['A', 'B', 'C'], ['B']);
		assert.deepEqual(result, ['A', 'B', 'C']);
	});

	it('restores several without them swapping places', () => {
		const result = reinsertIdsAtPreviousPositions(['A', 'D'], ['A', 'B', 'C', 'D'], ['C', 'B']);
		assert.deepEqual(result, ['A', 'B', 'C', 'D']);
	});

	it('keeps a restored id at the front when that is where it was', () => {
		assert.deepEqual(reinsertIdsAtPreviousPositions(['B'], ['A', 'B'], ['A']), ['A', 'B']);
	});

	it('puts an id with no previous position last', () => {
		// The only honest answer when there is nothing to restore it to.
		assert.deepEqual(reinsertIdsAtPreviousPositions(['A'], ['A'], ['Z']), ['A', 'Z']);
	});

	it('ignores ids already present', () => {
		const next = ['A', 'B'];
		assert.deepEqual(reinsertIdsAtPreviousPositions(next, ['A', 'B'], ['B']), ['A', 'B']);
	});

	it('returns the input untouched when there is nothing to do', () => {
		const next = ['A', 'B'];
		assert.equal(reinsertIdsAtPreviousPositions(next, ['A', 'B'], []), next);
	});

	it('does not mutate what it was given', () => {
		const next = ['A', 'C'];
		const previous = ['A', 'B', 'C'];
		reinsertIdsAtPreviousPositions(next, previous, ['B']);
		assert.deepEqual(next, ['A', 'C']);
		assert.deepEqual(previous, ['A', 'B', 'C']);
	});

	it('survives a previous order that no longer resembles the new one', () => {
		// A sync can land mid-drag; this must not throw or duplicate.
		const result = reinsertIdsAtPreviousPositions(['X', 'Y'], ['A', 'B'], ['B']);
		assert.equal(result.length, 3);
		assert.equal(new Set(result).size, 3);
	});
});
