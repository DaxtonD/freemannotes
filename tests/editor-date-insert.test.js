'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for src/core/editorDateInsert.ts — the toolbar's "insert the date"
// helpers.
//
// The one that actually matters is the round-trip through the `<input
// type="date">` value format. `new Date('2026-10-10')` is parsed as UTC
// midnight, so anywhere west of Greenwich (the author writes this from
// Saskatchewan) picking the 10th in the calendar would insert the 9th into the
// note. These tests pin the local-time parsing so that can't come back.
//
// Run individually:  node --test tests/editor-date-insert.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

require('ts-node/register/transpile-only');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatInsertableDate, parseDateInputValue, toDateInputValue } = require('../src/core/editorDateInsert.ts');

describe('toDateInputValue', () => {
	it('formats a date as the YYYY-MM-DD an input[type=date] expects', () => {
		assert.equal(toDateInputValue(new Date(2026, 9, 10)), '2026-10-10');
	});

	it('zero-pads single-digit months and days', () => {
		assert.equal(toDateInputValue(new Date(2026, 0, 5)), '2026-01-05');
	});

	it('uses the LOCAL calendar day, not the UTC one', () => {
		// 11:30pm local on the 10th is already the 11th in UTC for any timezone
		// behind it. The note should say the 10th, which is the day the person is
		// actually living in.
		const lateLocalEvening = new Date(2026, 9, 10, 23, 30, 0);
		assert.equal(toDateInputValue(lateLocalEvening), '2026-10-10');
	});

	it('returns an empty string for an invalid date', () => {
		assert.equal(toDateInputValue(new Date(Number.NaN)), '');
	});
});

describe('parseDateInputValue', () => {
	it('parses a picker value to local midnight on that calendar day', () => {
		const parsed = parseDateInputValue('2026-10-10');
		assert.ok(parsed);
		assert.equal(parsed.getFullYear(), 2026);
		assert.equal(parsed.getMonth(), 9);
		assert.equal(parsed.getDate(), 10);
		assert.equal(parsed.getHours(), 0);
	});

	it('does NOT shift the day backwards west of UTC (the whole point)', () => {
		// This is what new Date('2026-10-10') would have done in a negative offset.
		assert.equal(parseDateInputValue('2026-10-10').getDate(), 10);
	});

	it('round-trips with toDateInputValue', () => {
		for (const value of ['2026-01-01', '2026-02-28', '2026-07-04', '2026-12-31']) {
			assert.equal(toDateInputValue(parseDateInputValue(value)), value);
		}
	});

	it('rejects a day that does not exist rather than rolling it forward', () => {
		// Date would happily turn Feb 31 into Mar 3.
		assert.equal(parseDateInputValue('2026-02-31'), null);
	});

	it('rejects empty, malformed and out-of-range values', () => {
		for (const value of ['', '   ', 'today', '2026-10', '10/10/2026', '2026-13-01', '2026-00-10', '2026-10-00']) {
			assert.equal(parseDateInputValue(value), null, `expected null for ${JSON.stringify(value)}`);
		}
	});

	it('tolerates surrounding whitespace', () => {
		assert.equal(toDateInputValue(parseDateInputValue('  2026-10-10  ')), '2026-10-10');
	});
});

describe('formatInsertableDate', () => {
	it('includes the weekday, month name, day and year', () => {
		const formatted = formatInsertableDate(new Date(2026, 9, 10));
		// Locale-dependent wording, so assert on the parts rather than the exact string.
		assert.match(formatted, /2026/);
		assert.match(formatted, /10/);
		assert.ok(formatted.length > 10, `expected a long-form date, got ${JSON.stringify(formatted)}`);
	});

	it('returns an empty string for an invalid date so nothing gets inserted', () => {
		assert.equal(formatInsertableDate(new Date(Number.NaN)), '');
	});

	it('formats the date the picker produced, not a UTC-shifted one', () => {
		const formatted = formatInsertableDate(parseDateInputValue('2026-10-10'));
		assert.match(formatted, /10/);
		assert.doesNotMatch(formatted, /\b9\b/);
	});
});
