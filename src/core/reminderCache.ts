import type { NoteReminderState } from './pushApi';

const STORAGE_KEY_PREFIX = 'freemannotes.reminderStates.v1.';

type ReminderCachePayload = {
	v: 1;
	updatedAt: string;
	reminders: NoteReminderState[];
};

export function readCachedReminderStates(userId: string): NoteReminderState[] {
	if (typeof window === 'undefined' || !userId) return [];
	try {
		// Keep validation deliberately strict so stale or malformed localStorage data
		// cannot poison the reminder badge/filter UI during startup hydration.
		const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + userId);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as Partial<ReminderCachePayload> | null;
		if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.reminders)) return [];
		return parsed.reminders.filter((entry): entry is NoteReminderState => {
			return Boolean(
				entry &&
				typeof entry === 'object' &&
				typeof entry.docId === 'string' &&
				typeof entry.noteId === 'string' &&
				typeof entry.workspaceId === 'string' &&
				typeof entry.reminderAt === 'string'
			);
		});
	} catch {
		return [];
	}
}

export function writeCachedReminderStates(userId: string, reminders: readonly NoteReminderState[]): void {
	if (typeof window === 'undefined' || !userId) return;
	try {
		// Persist only the fields required to rebuild the note-id → reminder lookup.
		const payload: ReminderCachePayload = {
			v: 1,
			updatedAt: new Date().toISOString(),
			reminders: reminders.map((entry) => ({
				docId: String(entry.docId || ''),
				noteId: String(entry.noteId || ''),
				workspaceId: String(entry.workspaceId || ''),
				reminderAt: String(entry.reminderAt || ''),
			})).filter((entry) => entry.docId && entry.noteId && entry.workspaceId && entry.reminderAt),
		};
		window.localStorage.setItem(STORAGE_KEY_PREFIX + userId, JSON.stringify(payload));
	} catch {
		// Best effort only.
	}
}

export function clearCachedReminderStates(userId: string): void {
	if (typeof window === 'undefined' || !userId) return;
	try {
		window.localStorage.removeItem(STORAGE_KEY_PREFIX + userId);
	} catch {
		// ignore
	}
}