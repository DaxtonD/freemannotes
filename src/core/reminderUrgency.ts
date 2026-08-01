/**
 * reminderUrgency.ts – Shared thresholds for reminder urgency, used by note
 * card bell coloring, the in-editor overdue prompt, and the Inbox Reminders
 * tab digest.
 *
 * Two independent scales are used deliberately:
 * - Card tier is same-calendar-day based ("today"), for a tight at-a-glance signal.
 * - The Inbox digest's due-soon window is a rolling 48h lookahead, since it's a
 *   deliberate check-in tool where a bit more lead time is actually useful.
 */

export type ReminderCardTier = 'overdue' | 'dueToday' | 'upcoming';

export function getReminderCardTier(reminderAt: string, now: Date = new Date()): ReminderCardTier {
	const due = new Date(reminderAt);
	if (due.getTime() <= now.getTime()) return 'overdue';
	if (due.toDateString() === now.toDateString()) return 'dueToday';
	return 'upcoming';
}

export const REMINDER_DUE_SOON_WINDOW_MS = 48 * 60 * 60 * 1000;

export function isReminderOverdue(reminderAt: string, now: Date = new Date()): boolean {
	return new Date(reminderAt).getTime() <= now.getTime();
}

export function isReminderDueSoon(reminderAt: string, now: Date = new Date()): boolean {
	const dueTime = new Date(reminderAt).getTime();
	return dueTime > now.getTime() && dueTime <= now.getTime() + REMINDER_DUE_SOON_WINDOW_MS;
}
