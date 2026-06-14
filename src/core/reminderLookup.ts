import type { NoteReminderState } from './pushApi';

/**
 * User-scoped reminder lookup helpers shared by App, NoteGrid, and BubbleView.
 * Server fetches return only active reminders; mergeServerReminderLookup treats
 * that list as authoritative so deleted reminders clear bell icons on every device.
 */
export function buildReminderLookup(reminders: readonly NoteReminderState[]): Record<string, string | null> {
	const next: Record<string, string | null> = {};
	for (const reminder of reminders) {
		const reminderAt = typeof reminder.reminderAt === 'string' && reminder.reminderAt.trim().length > 0
			? reminder.reminderAt
			: null;
		if (reminder.docId) {
			next[reminder.docId] = reminderAt;
		}
		if (reminder.noteId && !(reminder.noteId in next)) {
			next[reminder.noteId] = reminderAt;
		}
	}
	return next;
}

export function updateReminderLookup(
	lookup: Record<string, string | null>,
	docId: string,
	noteId: string,
	reminderAt: string | null,
): Record<string, string | null> {
	const next = { ...lookup };
	if (docId) {
		if (reminderAt) next[docId] = reminderAt;
		else next[docId] = null;
	}
	if (noteId) {
		if (reminderAt) next[noteId] = reminderAt;
		else next[noteId] = null;
	}
	return next;
}

export function readReminderLookupValue(
	lookup: Record<string, string | null>,
	docId: string | null | undefined,
	noteId?: string | null,
): string | null {
	if (docId) {
		const direct = lookup[docId];
		if (typeof direct === 'string' && direct.trim().length > 0) return direct;
	}
	if (noteId) {
		const fallback = lookup[noteId];
		if (typeof fallback === 'string' && fallback.trim().length > 0) return fallback;
	}
	return null;
}

export function resolveNoteReminderAt(
	lookup: Record<string, string | null> | undefined,
	docId: string | null | undefined,
	noteId: string,
	snapshotFallback?: string | null,
): string | null {
	if (docId && lookup && Object.prototype.hasOwnProperty.call(lookup, docId)) {
		const value = lookup[docId];
		return typeof value === 'string' && value.trim().length > 0 ? value : null;
	}
	if (lookup && Object.prototype.hasOwnProperty.call(lookup, noteId)) {
		const value = lookup[noteId];
		return typeof value === 'string' && value.trim().length > 0 ? value : null;
	}
	const fallback = typeof snapshotFallback === 'string' ? snapshotFallback.trim() : '';
	return fallback.length > 0 ? fallback : null;
}

export function mergeServerReminderLookup(
	current: Record<string, string | null>,
	serverLookup: Record<string, string | null>,
): Record<string, string | null> {
	// Server list is authoritative for active reminders. Only overlay explicit local
	// null clears (optimistic unsets pending sync). Do not preserve stale non-null
	// entries from `current` when the server omitted them — that kept bell icons on
	// other devices after a reminder was deleted elsewhere.
	const merged: Record<string, string | null> = { ...serverLookup };
	for (const [key, value] of Object.entries(current)) {
		if (value === null) {
			merged[key] = null;
		}
	}
	return merged;
}
