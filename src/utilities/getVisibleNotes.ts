export type ReminderFilterMode = 'all' | 'past-due' | 'due-soon' | 'later-today' | 'tomorrow' | 'next-week';

export type SortDirection = 'asc' | 'desc';

export type NoteSortMode = 'manual' | 'date-created' | 'date-updated' | 'alphabetical' | 'least-accessed' | 'most-edited';

export type NoteGroupingMode = 'none' | 'week' | 'month';

export type VisibleNoteSnapshot = {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	collectionId: string | null;
	labelIds: string[];
	reminderAt: string | null;
	isPinned: boolean;
	lastAccessedAt: string;
	trashed: boolean;
	archived: boolean;
};

export type VisibleNoteFilters = {
	showTrashed?: boolean;
	showArchived?: boolean;
	selectedCollectionId?: string | null;
	selectedLabelIds?: readonly string[];
	reminderFilter?: ReminderFilterMode;
	sortMode?: NoteSortMode;
	sortDirection?: SortDirection;
};

function normalizeId(value: unknown): string {
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function toTimestamp(value: string | number | null | undefined, fallback = 0): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}
	return fallback;
}

function startOfTomorrow(now: Date): number {
	const copy = new Date(now);
	copy.setHours(24, 0, 0, 0);
	return copy.getTime();
}

function endOfTomorrow(now: Date): number {
	const copy = new Date(now);
	copy.setHours(48, 0, 0, 0);
	return copy.getTime();
}

function withinReminderFilter(reminderAt: string | null, mode: ReminderFilterMode, nowMs: number): boolean {
	if (mode === 'all') return true;
	if (!reminderAt) return false;
	const reminderMs = toTimestamp(reminderAt, Number.NaN);
	if (!Number.isFinite(reminderMs)) return false;
	// Past-due is intentionally strict: reminders before "now" only.
	if (mode === 'past-due') {
		return reminderMs < nowMs;
	}
	if (mode === 'due-soon') {
		return reminderMs >= nowMs && reminderMs <= nowMs + 72 * 60 * 60 * 1000;
	}
	const now = new Date(nowMs);
	if (mode === 'later-today') {
		return reminderMs >= nowMs && reminderMs < startOfTomorrow(now);
	}
	if (mode === 'tomorrow') {
		const tomorrowStart = startOfTomorrow(now);
		const tomorrowEnd = endOfTomorrow(now);
		return reminderMs >= tomorrowStart && reminderMs < tomorrowEnd;
	}
	if (mode === 'next-week') {
		const weekStart = startOfTomorrow(now);
		const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
		return reminderMs >= weekStart && reminderMs < weekEnd;
	}
	return true;
}

function compareByTitle(left: VisibleNoteSnapshot, right: VisibleNoteSnapshot): number {
	return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
}

function getEffectiveSortDirection(sortMode: NoteSortMode, sortDirection: SortDirection | undefined): SortDirection {
	// Preserve legacy defaults when no explicit direction has been selected.
	if (sortDirection === 'asc' || sortDirection === 'desc') return sortDirection;
	if (sortMode === 'alphabetical') return 'asc';
	return 'desc';
}

function pinnedFirst(notes: readonly VisibleNoteSnapshot[]): VisibleNoteSnapshot[] {
	const pinned: VisibleNoteSnapshot[] = [];
	const unpinned: VisibleNoteSnapshot[] = [];
	for (const note of notes) {
		if (note.isPinned) pinned.push(note);
		else unpinned.push(note);
	}
	return [...pinned, ...unpinned];
}

export function getVisibleNotes(notes: readonly VisibleNoteSnapshot[], filters: VisibleNoteFilters = {}): VisibleNoteSnapshot[] {
	const {
		showArchived = false,
		showTrashed = false,
		selectedCollectionId = null,
		selectedLabelIds = [],
		reminderFilter = 'all',
		sortMode = 'manual',
		sortDirection,
	} = filters;
	const activeCollectionId = normalizeId(selectedCollectionId) || null;
	const activeLabelIds = Array.from(new Set(selectedLabelIds.map((value) => normalizeId(value)).filter(Boolean)));
	const nowMs = Date.now();

	// Apply view filters before sort/group logic so every consumer sees the same
	// workspace/archive/trash semantics from one shared source of truth.
	const filtered = notes.filter((note) => {
		if (showTrashed) {
			if (!note.trashed) return false;
		} else if (showArchived) {
			if (note.trashed || !note.archived) return false;
		} else if (note.trashed || note.archived) {
			return false;
		}
		if (activeCollectionId && note.collectionId !== activeCollectionId) return false;
		if (activeLabelIds.length > 0 && !activeLabelIds.every((labelId) => note.labelIds.includes(labelId))) return false;
		if (!withinReminderFilter(note.reminderAt, reminderFilter, nowMs)) return false;
		return true;
	});

	if (sortMode === 'manual') return pinnedFirst(filtered);
	const sorted = [...filtered];
	const effectiveSortDirection = getEffectiveSortDirection(sortMode, sortDirection);
	const multiplier = effectiveSortDirection === 'asc' ? 1 : -1;
	sorted.sort((left, right) => {
		if (sortMode === 'date-created') {
			return (left.createdAt - right.createdAt) * multiplier || compareByTitle(left, right);
		}
		if (sortMode === 'date-updated' || sortMode === 'most-edited') {
			return (left.updatedAt - right.updatedAt) * multiplier || compareByTitle(left, right);
		}
		if (sortMode === 'alphabetical') {
			return compareByTitle(left, right) * multiplier;
		}
		if (sortMode === 'least-accessed') {
			return toTimestamp(left.lastAccessedAt, 0) - toTimestamp(right.lastAccessedAt, 0) || compareByTitle(left, right);
		}
		return 0;
	});
	return pinnedFirst(sorted);
}