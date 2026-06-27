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
	findColumnNeighborAnchor,
	applyTierReorderByInsertion,
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
