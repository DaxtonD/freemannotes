/**
 * Who changed this card, as chips stacked up its bottom edge.
 *
 * The pending-change set (`pendingNoteChanges.ts`) already knows *that* a note changed and *who*
 * changed it. This turns that into something drawable: a name, an avatar, a short elapsed label,
 * and a cap with an overflow count.
 *
 * ## Deliberately pure
 *
 * No imports, no DOM, no clock. `now` and the identity lookup are both passed in. That keeps the
 * rules testable in plain Node, and it keeps this module from touching layout - the card's height
 * is measured by a ResizeObserver and fed to the masonry packer, and nothing here should be able to
 * influence that.
 *
 * ## A FIXED cap, not a fitted one
 *
 * The chips stack vertically, so the three visible ones plus an overflow chip are a fixed ~110px of
 * card bottom regardless of how long anyone's name is - a long name ellipsises in place instead of
 * costing a slot. That makes the count a constant, which is the useful property: the chip count
 * never changes on resize, so it cannot churn in the subsystem behind the oscillation bug and both
 * abandoned card-hold attempts.
 *
 * This replaced a width-fitting estimate (chips used to be a single horizontal row). Covering some
 * of the card's text is accepted and deliberate - knowing who changed a card beats reading the
 * bottom two lines of it.
 */

/** What the grid knows about a person, however little that is. */
export type NoteChangeChipIdentity = {
	userId: string;
	name: string | null;
	avatarUrl: string | null;
};

export type NoteChangeChip = {
	key: string;
	userId: string;
	/** Already resolved to something printable - never empty. */
	name: string;
	avatarUrl: string | null;
	/** Single uppercase character for the avatar fallback. */
	initial: string;
	/** Compact elapsed label, e.g. "now", "4m", "2h", "3d". */
	elapsedLabel: string;
	at: number;
};

export type NoteChangeChipRow = {
	chips: readonly NoteChangeChip[];
	/** How many contributors did not fit. Zero means the stack is complete. */
	overflowCount: number;
};

/** Three names, then "+N more". */
export const MAX_NOTE_CHANGE_CHIPS = 3;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * "now" / "4m" / "2h" / "3d" / "5w".
 *
 * Deliberately terser than the inbox's "4 minutes ago": this sits inside a chip on a note card
 * where there is room for about three characters, and the point is only to say whether the change
 * is fresh or stale.
 *
 * A timestamp in the future (clock skew between two devices is normal, and the attribution
 * timestamp comes off another machine) reads as "now" rather than a negative number.
 */
export function formatNoteChangeElapsed(at: number, now: number): string {
	if (!Number.isFinite(at) || !Number.isFinite(now)) return '';
	const elapsed = now - at;
	if (elapsed < MINUTE_MS) return 'now';
	if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m`;
	if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h`;
	const days = Math.floor(elapsed / DAY_MS);
	if (days < 7) return `${days}d`;
	return `${Math.floor(days / 7)}w`;
}

/** First character of a name, for the avatar fallback circle. */
export function noteChangeChipInitial(name: string): string {
	for (const char of name.trim()) {
		if (/[\p{L}\p{N}]/u.test(char)) return char.toUpperCase();
	}
	return '?';
}

/**
 * Turn contributors into the stack of chips a changed card wears.
 *
 * `resolve` is the caller's identity lookup. It is allowed to return null for someone the device
 * has never heard of - that person still gets a chip, because "somebody changed this" is the
 * signal and suppressing the chip would lose it. `fallbackName` is what they are called.
 */
export function buildNoteChangeChipRow(
	contributors: readonly { userId: string; at: number }[],
	options: {
		resolve: (userId: string) => NoteChangeChipIdentity | null;
		now: number;
		fallbackName: string;
		maxChips?: number;
	}
): NoteChangeChipRow {
	if (contributors.length === 0) return { chips: [], overflowCount: 0 };

	const cap = Math.max(1, Math.floor(options.maxChips ?? MAX_NOTE_CHANGE_CHIPS));
	const chips: NoteChangeChip[] = [];
	let skipped = 0;
	for (const contributor of contributors) {
		if (!contributor.userId) continue;
		if (chips.length >= cap) {
			skipped += 1;
			continue;
		}
		const identity = options.resolve(contributor.userId);
		const name = String(identity?.name ?? '').trim() || options.fallbackName;
		chips.push({
			key: contributor.userId,
			userId: contributor.userId,
			name,
			avatarUrl: identity?.avatarUrl ?? null,
			initial: noteChangeChipInitial(name),
			elapsedLabel: formatNoteChangeElapsed(contributor.at, options.now),
			at: contributor.at,
		});
	}
	if (chips.length === 0) return { chips: [], overflowCount: 0 };

	return { chips, overflowCount: skipped };
}
