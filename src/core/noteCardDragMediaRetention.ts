/**
 * Cross-column grid drags remount NoteCard in another VirtualizedNoteColumn while the
 * drag ghost still references blob: URLs from the source card. Without retaining those
 * URLs until drop-settle, image/drawing previews flash blank in the ghost and after drop.
 */
let activeDragNoteId: string | null = null;
const retainedBlobUrlsByNoteId = new Map<string, string[]>();

export function beginNoteCardDragMediaRetention(noteId: string): void {
	activeDragNoteId = noteId;
}

export function isNoteCardDragMediaRetentionActive(noteId: string): boolean {
	return activeDragNoteId === noteId;
}

export function retainNoteCardDragMediaBlobUrls(noteId: string, urls: readonly string[]): void {
	if (activeDragNoteId !== noteId || urls.length === 0) return;
	const prior = retainedBlobUrlsByNoteId.get(noteId) ?? [];
	retainedBlobUrlsByNoteId.set(noteId, [...prior, ...urls]);
}

export function endNoteCardDragMediaRetention(): void {
	const noteId = activeDragNoteId;
	activeDragNoteId = null;
	if (!noteId) return;
	const urls = retainedBlobUrlsByNoteId.get(noteId);
	if (urls) {
		for (const url of urls) {
			URL.revokeObjectURL(url);
		}
		retainedBlobUrlsByNoteId.delete(noteId);
	}
}
