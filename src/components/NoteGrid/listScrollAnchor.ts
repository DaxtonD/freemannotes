/** Helpers for preserving list/strip scroll position by note id + viewport Y, not raw scrollY. */

export type ListScrollAnchor = {
	noteId: string;
	/** Row top edge in viewport coordinates at capture time (getBoundingClientRect().top). */
	viewportTopPx: number;
};

export function getAppStickyTopOffsetPx(): number {
	if (typeof window === 'undefined') return 0;
	const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-sticky-top-offset').trim();
	const parsed = Number.parseFloat(raw);
	return Number.isFinite(parsed) ? parsed : 0;
}

function findListRowByNoteId(noteId: string): HTMLElement | null {
	if (typeof document === 'undefined') return null;
	return document.querySelector<HTMLElement>(
		`[data-note-list-row="true"][data-note-id="${CSS.escape(noteId)}"]`,
	);
}

/** Returns the note id whose row is closest to the top of the viewport (below sticky chrome). */
export function findTopVisibleListNoteId(): string | null {
	if (typeof window === 'undefined') return null;
	const viewportTop = getAppStickyTopOffsetPx();
	const rows = document.querySelectorAll<HTMLElement>('[data-note-list-row="true"]');
	let bestId: string | null = null;
	let bestTop = Infinity;

	for (const row of rows) {
		const noteId = row.dataset.noteId;
		if (!noteId) continue;
		const rect = row.getBoundingClientRect();
		if (rect.bottom <= viewportTop + 1) continue;
		if (rect.top >= window.innerHeight) continue;
		if (rect.top < bestTop) {
			bestTop = rect.top;
			bestId = noteId;
		}
	}
	return bestId;
}

/** Capture the top-visible list row and its exact viewport Y before a list ↔ strip switch. */
export function captureTopVisibleListScrollAnchor(): ListScrollAnchor | null {
	const noteId = findTopVisibleListNoteId();
	if (!noteId) return null;
	const row = findListRowByNoteId(noteId);
	if (!row) return null;
	return { noteId, viewportTopPx: row.getBoundingClientRect().top };
}

/** Nudge window scroll so the row sits at the same viewport Y as when the anchor was captured. */
export function applyListScrollAnchorToRow(row: HTMLElement, anchor: ListScrollAnchor): boolean {
	if (typeof window === 'undefined') return true;
	const delta = row.getBoundingClientRect().top - anchor.viewportTopPx;
	if (Math.abs(delta) < 0.5) return true;
	window.scrollBy({ left: 0, top: delta, behavior: 'auto' });
	return false;
}
