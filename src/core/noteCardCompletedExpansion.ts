const completedExpandedByNoteId = new Map<string, boolean>();

export function seedNoteCardCompletedExpandedByNoteId(seed: Record<string, boolean>): void {
	completedExpandedByNoteId.clear();
	for (const [noteId, expanded] of Object.entries(seed || {})) {
		if (!noteId) continue;
		completedExpandedByNoteId.set(noteId, Boolean(expanded));
	}
}

export function getNoteCardCompletedExpanded(noteId: string): boolean {
	return completedExpandedByNoteId.get(noteId) ?? false;
}

export function setNoteCardCompletedExpanded(noteId: string, expanded: boolean): void {
	completedExpandedByNoteId.set(noteId, Boolean(expanded));
}
