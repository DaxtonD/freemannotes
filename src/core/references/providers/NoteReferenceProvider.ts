import type { ReferenceProvider, ReferenceResult } from '../ReferenceProvider';

type NoteSummary = { id: string; title: string; noteType?: string };
type NotesGetter = () => NoteSummary[] | Promise<NoteSummary[]>;

let _getter: NotesGetter = () => [];

/**
 * Set the data source for note suggestions. Call once at app startup with a
 * function that returns the current workspace's note list.
 */
export function setNoteReferenceSource(getter: NotesGetter): void {
	_getter = getter;
}

export const NoteReferenceProvider: ReferenceProvider = {
	type: 'note',
	groupLabel: 'Notes',

	async search(query: string): Promise<ReferenceResult[]> {
		const notes = await _getter();
		const q = query.toLowerCase().trim();

		// When searching, match by title. When no query, show everything (including
		// untitled checklists and drawings that have no explicit title set).
		const filtered = q
			? notes.filter((n) => {
				const t = (n.title ?? '').toLowerCase();
				return t.includes(q) || (!t && 'untitled'.includes(q));
			})
			: notes;

		return filtered.slice(0, 30).map((n) => ({
			id: n.id,
			type: 'note',
			label: n.title?.trim() || 'Untitled',
			noteType: n.noteType,
		}));
	},
};
