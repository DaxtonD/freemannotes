'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for src/core/relativeDate.ts's getRelativeDayBucket — the calendar-day
// bucketing that drives "Yesterday / Today / Tomorrow" reminder labels.
//
// Run individually:  node --test tests/relative-date.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

require('ts-node/register/transpile-only');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getRelativeDayBucket } = require('../src/core/relativeDate.ts');

describe('getRelativeDayBucket', () => {
	const now = new Date(2026, 7, 31, 17, 30, 0); // Aug 31 2026, 5:30pm local

	it('buckets a time later the same day as today', () => {
		assert.equal(getRelativeDayBucket(new Date(2026, 7, 31, 23, 59, 0), now), 'today');
	});

	it('buckets a time earlier the same day as today', () => {
		assert.equal(getRelativeDayBucket(new Date(2026, 7, 31, 0, 1, 0), now), 'today');
	});

	it('buckets the next calendar day as tomorrow, even just after midnight', () => {
		assert.equal(getRelativeDayBucket(new Date(2026, 8, 1, 0, 1, 0), now), 'tomorrow');
	});

	it('buckets the previous calendar day as yesterday, even just before midnight', () => {
		assert.equal(getRelativeDayBucket(new Date(2026, 7, 30, 23, 59, 0), now), 'yesterday');
	});

	it('does not bucket two days out', () => {
		assert.equal(getRelativeDayBucket(new Date(2026, 8, 2, 12, 0, 0), now), null);
	});

	it('does not bucket two days back', () => {
		assert.equal(getRelativeDayBucket(new Date(2026, 7, 29, 12, 0, 0), now), null);
	});

	it('handles a month boundary correctly (Aug 31 -> Sep 1 is one day, not zero)', () => {
		const endOfMonth = new Date(2026, 7, 31, 9, 0, 0);
		assert.equal(getRelativeDayBucket(new Date(2026, 8, 1, 9, 0, 0), endOfMonth), 'tomorrow');
	});

	it('returns null for an invalid date', () => {
		assert.equal(getRelativeDayBucket(new Date(NaN), now), null);
	});
});
