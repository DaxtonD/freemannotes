import type { NoteGroupingMode, NoteSortMode, VisibleNoteSnapshot } from './getVisibleNotes';

export type NoteGroupSection = {
	key: string;
	label: string;
	noteIds: string[];
};

function startOfWeek(date: Date): Date {
	const next = new Date(date);
	const day = next.getDay();
	const diff = (day + 6) % 7;
	next.setDate(next.getDate() - diff);
	next.setHours(0, 0, 0, 0);
	return next;
}

function startOfMonth(date: Date): Date {
	const next = new Date(date);
	next.setDate(1);
	next.setHours(0, 0, 0, 0);
	return next;
}

function addDays(date: Date, days: number): Date {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

function addMonths(date: Date, months: number): Date {
	const next = new Date(date);
	next.setMonth(next.getMonth() + months);
	return next;
}

const MONTH_ABBREVIATIONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

function formatMonthDay(date: Date): string {
	return `${MONTH_ABBREVIATIONS[date.getMonth()]} ${date.getDate()}`;
}

export function getGroupingTimestamp(note: VisibleNoteSnapshot, sortMode: NoteSortMode | undefined): number {
	return sortMode === 'date-created' ? note.createdAt : note.updatedAt;
}

export function getSectionStart(timestamp: number, grouping: NoteGroupingMode): number {
	const source = new Date(timestamp);
	const start = grouping === 'month' ? startOfMonth(source) : startOfWeek(source);
	return start.getTime();
}

export function formatSectionLabel(startMs: number, grouping: NoteGroupingMode, nowMs: number): string {
	const start = new Date(startMs);
	if (grouping === 'month') {
		const thisMonthStart = startOfMonth(new Date(nowMs)).getTime();
		const lastMonthStart = startOfMonth(addMonths(new Date(nowMs), -1)).getTime();
		if (startMs === thisMonthStart) return 'This month';
		if (startMs === lastMonthStart) return 'Last month';
		return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(start);
	}
	const thisWeekStart = startOfWeek(new Date(nowMs)).getTime();
	const lastWeekStart = startOfWeek(addDays(new Date(nowMs), -7)).getTime();
	if (startMs === thisWeekStart) return 'This week';
	if (startMs === lastWeekStart) return 'Last week';
	const end = addDays(start, 6);
	const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
	const startLabel = formatMonthDay(start);
	const endLabel = sameMonth ? `${end.getDate()}` : formatMonthDay(end);
	return `${startLabel} - ${endLabel}`;
}

export function buildNoteGroupSections(args: {
	renderedIds: readonly string[];
	noteSnapshotById: ReadonlyMap<string, VisibleNoteSnapshot>;
	sortGrouping: NoteGroupingMode | undefined;
	sortMode: NoteSortMode | undefined;
	nowMs?: number;
}): NoteGroupSection[] {
	if (!args.sortGrouping || args.sortGrouping === 'none') return [];
	const nowMs = args.nowMs ?? Date.now();
	const sections: NoteGroupSection[] = [];
	const indexByKey = new Map<string, number>();
	for (const noteId of args.renderedIds) {
		const snapshot = args.noteSnapshotById.get(noteId);
		if (!snapshot) continue;
		const startMs = getSectionStart(getGroupingTimestamp(snapshot, args.sortMode), args.sortGrouping);
		const key = `${args.sortGrouping}:${startMs}`;
		const existingIndex = indexByKey.get(key);
		if (existingIndex === undefined) {
			indexByKey.set(key, sections.length);
			sections.push({
				key,
				label: formatSectionLabel(startMs, args.sortGrouping, nowMs),
				noteIds: [noteId],
			});
			continue;
		}
		sections[existingIndex].noteIds.push(noteId);
	}
	return sections;
}