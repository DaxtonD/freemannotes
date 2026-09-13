/**
 * "Yesterday / Today / Tomorrow" labels for reminder dates, everywhere one is
 * shown (note card reminder badge, Inbox reminder cards, reminder toasts). The
 * point is to skip the mental math of matching a hard date against today's
 * date — anything more than a day out still shows a real date, just like
 * before.
 */

import type { useI18n } from './i18n';

export type RelativeDayBucket = 'yesterday' | 'today' | 'tomorrow';

/** Midnight of `date` in the viewer's own timezone, as an epoch ms timestamp. */
function startOfLocalDay(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Buckets `date` against `now` by CALENDAR day, not a raw 24h/48h delta —
 * 11:58pm and 12:02am four minutes apart are different calendar days, and a
 * plain millisecond difference gets that wrong right around midnight.
 */
export function getRelativeDayBucket(date: Date, now: Date = new Date()): RelativeDayBucket | null {
	if (!Number.isFinite(date.getTime()) || !Number.isFinite(now.getTime())) return null;
	const dayDiff = Math.round((startOfLocalDay(date) - startOfLocalDay(now)) / 86_400_000);
	if (dayDiff === -1) return 'yesterday';
	if (dayDiff === 0) return 'today';
	if (dayDiff === 1) return 'tomorrow';
	return null;
}

export type FormatRelativeDateOptions = {
	/** Append a localized time-of-day after the date. Default true. */
	includeTime?: boolean;
	/** `now` to bucket against — overridable for tests, defaults to the real current time. */
	now?: Date;
};

/**
 * "Tomorrow, 1:00 PM" for the next/previous/current calendar day, otherwise a
 * hard date ("Aug 31, 2026, 1:00 PM") — same shape either way so the reminder
 * badge/card/toast layouts never need to branch on which case they got.
 *
 * `t` is `useI18n()`'s translator — pass it through rather than importing the
 * hook here so this stays a plain function callable from any component (and
 * testable without a provider).
 */
export function formatRelativeReminderDate(
	value: Date | string | number,
	t: ReturnType<typeof useI18n>['t'],
	options: FormatRelativeDateOptions = {}
): string {
	const date = value instanceof Date ? value : new Date(value);
	if (!Number.isFinite(date.getTime())) return '';
	const includeTime = options.includeTime !== false;
	const timeLabel = includeTime ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
	const bucket = getRelativeDayBucket(date, options.now);
	const dayLabel = bucket
		? t(`date.${bucket}`)
		: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	return includeTime ? `${dayLabel}, ${timeLabel}` : dayLabel;
}
