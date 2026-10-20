'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for src/core/noteChangeChips.ts — turning "who changed this note" into
// a row of chips that fits across the bottom of a card.
//
// The chips stack vertically with a FIXED cap of three plus an overflow chip, so
// there is no width arithmetic to get wrong - the value here is in the identity
// resolution and the counting:
//
//   • an unknown user still gets a chip (losing it would lose the signal),
//   • everyone past the cap is counted, never silently dropped,
//   • the count is a constant, so it can never churn on resize and feed the
//     masonry packer, which is the trap both card-hold attempts fell into.
//
// Run individually:  node --test tests/note-change-chips.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

require('ts-node/register/transpile-only');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
	MAX_NOTE_CHANGE_CHIPS,
	buildNoteChangeChipRow,
	formatNoteChangeElapsed,
	noteChangeChipInitial,
} = require('../src/core/noteChangeChips.ts');

const NOW = 1_700_000_000_000;

const people = {
	'user-alice': { userId: 'user-alice', name: 'Alice', avatarUrl: '/uploads/alice.webp' },
	'user-bob': { userId: 'user-bob', name: 'Bob', avatarUrl: null },
};
const resolve = (userId) => people[userId] ?? null;

const row = (contributors, overrides = {}) => buildNoteChangeChipRow(contributors, {
	resolve,
	now: NOW,
	fallbackName: 'Someone',
	...overrides,
});

const contributor = (userId, at = NOW) => ({ userId, at });

describe('formatNoteChangeElapsed', () => {
	it('reads as "now" under a minute', () => {
		assert.equal(formatNoteChangeElapsed(NOW - 1_000, NOW), 'now');
		assert.equal(formatNoteChangeElapsed(NOW - 59_999, NOW), 'now');
	});

	it('counts minutes, hours, days and weeks', () => {
		assert.equal(formatNoteChangeElapsed(NOW - 60_000, NOW), '1m');
		assert.equal(formatNoteChangeElapsed(NOW - 59 * 60_000, NOW), '59m');
		assert.equal(formatNoteChangeElapsed(NOW - 3_600_000, NOW), '1h');
		assert.equal(formatNoteChangeElapsed(NOW - 23 * 3_600_000, NOW), '23h');
		assert.equal(formatNoteChangeElapsed(NOW - 86_400_000, NOW), '1d');
		assert.equal(formatNoteChangeElapsed(NOW - 6 * 86_400_000, NOW), '6d');
		assert.equal(formatNoteChangeElapsed(NOW - 7 * 86_400_000, NOW), '1w');
	});

	it('reads a future timestamp as "now" rather than a negative number', () => {
		// Two devices disagreeing about the clock is normal, and the attribution timestamp comes
		// off whichever machine made the change.
		assert.equal(formatNoteChangeElapsed(NOW + 30_000, NOW), 'now');
		assert.equal(formatNoteChangeElapsed(NOW + 86_400_000, NOW), 'now');
	});

	it('returns empty rather than NaN for a nonsense timestamp', () => {
		assert.equal(formatNoteChangeElapsed(Number.NaN, NOW), '');
		assert.equal(formatNoteChangeElapsed(NOW, Number.POSITIVE_INFINITY), '');
	});
});

describe('noteChangeChipInitial', () => {
	it('takes the first letter, uppercased', () => {
		assert.equal(noteChangeChipInitial('alice'), 'A');
		assert.equal(noteChangeChipInitial('  bob smith '), 'B');
	});

	it('skips leading punctuation to find a real character', () => {
		assert.equal(noteChangeChipInitial('"Quoted"'), 'Q');
		assert.equal(noteChangeChipInitial('(1) Dave'), '1');
	});

	it('handles a non-latin name', () => {
		assert.equal(noteChangeChipInitial('Дмитрий'), 'Д');
	});

	it('falls back to ? when there is no usable character', () => {
		assert.equal(noteChangeChipInitial(''), '?');
		assert.equal(noteChangeChipInitial('---'), '?');
	});
});

describe('buildNoteChangeChipRow — identity', () => {
	it('resolves a known user to a name and avatar', () => {
		const result = row([contributor('user-alice')]);
		assert.equal(result.chips.length, 1);
		assert.equal(result.chips[0].name, 'Alice');
		assert.equal(result.chips[0].avatarUrl, '/uploads/alice.webp');
		assert.equal(result.chips[0].initial, 'A');
		assert.equal(result.overflowCount, 0);
	});

	it('still chips an unknown user, under the fallback name', () => {
		// "Somebody changed this" IS the signal. Dropping the chip because the device has never
		// heard of them loses it entirely.
		const result = row([contributor('user-nobody')]);
		assert.equal(result.chips.length, 1);
		assert.equal(result.chips[0].name, 'Someone');
		assert.equal(result.chips[0].avatarUrl, null);
	});

	it('leaves the avatar null when the user is known but has no picture', () => {
		const result = row([contributor('user-bob')]);
		assert.equal(result.chips[0].name, 'Bob');
		assert.equal(result.chips[0].avatarUrl, null);
		assert.equal(result.chips[0].initial, 'B');
	});

	it('returns nothing for no contributors', () => {
		assert.deepEqual(row([]), { chips: [], overflowCount: 0 });
	});

	it('ignores a contributor with no user id', () => {
		assert.deepEqual(row([{ userId: '', at: NOW }]), { chips: [], overflowCount: 0 });
	});

	it('keeps the order it was given, which is most recent first', () => {
		const result = row([contributor('user-bob', NOW), contributor('user-alice', NOW - 5_000)]);
		assert.deepEqual(result.chips.map((chip) => chip.userId), ['user-bob', 'user-alice']);
	});
});

describe('buildNoteChangeChipRow — counting', () => {
	const many = (count) => Array.from({ length: count }, (_, index) => contributor(`user-${index}`, NOW - index * 1000));

	it('shows three names then counts the rest', () => {
		assert.equal(MAX_NOTE_CHANGE_CHIPS, 3);
		const result = row(many(7));
		assert.equal(result.chips.length, 3);
		assert.equal(result.overflowCount, 4);
	});

	it('never drops anyone from the arithmetic, however many there are', () => {
		for (const count of [1, 2, 3, 4, 9, 40]) {
			const result = row(many(count));
			assert.equal(result.chips.length + result.overflowCount, count, `count ${count}`);
		}
	});

	it('reports no overflow when everyone fits', () => {
		const result = row(many(3));
		assert.equal(result.chips.length, 3);
		assert.equal(result.overflowCount, 0);
	});

	it('honours an explicit cap', () => {
		const result = row(many(5), { maxChips: 2 });
		assert.equal(result.chips.length, 2);
		assert.equal(result.overflowCount, 3);
	});

	it('always shows at least one chip, whatever cap it is given', () => {
		// A stack with nothing in it but "+4" tells the user less than one name does.
		for (const maxChips of [0, -3]) {
			const result = row(many(5), { maxChips });
			assert.equal(result.chips.length, 1, `maxChips ${maxChips}`);
			assert.equal(result.overflowCount, 4);
		}
	});

	it('does not count a contributor with no user id as overflow', () => {
		// Those are skipped entirely rather than inflating "+N" with people who cannot be named.
		const result = row([contributor('user-alice'), { userId: '', at: NOW }, contributor('user-bob')]);
		assert.equal(result.chips.length, 2);
		assert.equal(result.overflowCount, 0);
	});

	it('keeps the most recent contributors and overflows the oldest', () => {
		const result = row(many(5));
		assert.deepEqual(result.chips.map((chip) => chip.userId), ['user-0', 'user-1', 'user-2']);
	});

	it('does not care how long the names are', () => {
		// The old implementation fitted chips to the card WIDTH, so a long name cost a slot. The
		// stack ellipsises in place instead, which is what makes the count a constant.
		const long = buildNoteChangeChipRow(many(5), {
			resolve: () => ({ userId: 'x', name: 'Bartholomew Wigglesworth-Fotheringay', avatarUrl: null }),
			now: NOW,
			fallbackName: 'Someone',
		});
		const short = buildNoteChangeChipRow(many(5), {
			resolve: () => ({ userId: 'x', name: 'Jo', avatarUrl: null }),
			now: NOW,
			fallbackName: 'Someone',
		});
		assert.equal(long.chips.length, short.chips.length);
		assert.equal(long.overflowCount, short.overflowCount);
	});
});
