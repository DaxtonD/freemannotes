/** Helpers for preserving list/strip scroll position by note id + viewport Y, not raw scrollY. */

export type ListScrollAnchor = {
	noteId: string;
	/** Row top edge in viewport coordinates at capture time (getBoundingClientRect().top). */
	viewportTopPx: number;
	/** Where every mounted list row sat on screen at capture time, so the switch can animate from there. */
	rowViewportRects?: Record<string, { left: number; top: number }>;
};

export function getAppStickyTopOffsetPx(): number {
	if (typeof window === 'undefined') return 0;
	const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-sticky-top-offset').trim();
	const parsed = Number.parseFloat(raw);
	return Number.isFinite(parsed) ? parsed : 0;
}

export function findListRowByNoteId(noteId: string): HTMLElement | null {
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

	for (const row of Array.from(rows)) {
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

/** Capture the top-visible list row, its exact viewport Y, and every row's position before a list ↔ strip switch. */
export function captureTopVisibleListScrollAnchor(): ListScrollAnchor | null {
	const noteId = findTopVisibleListNoteId();
	if (!noteId) return null;
	const row = findListRowByNoteId(noteId);
	if (!row) return null;
	const rowViewportRects: Record<string, { left: number; top: number }> = {};
	for (const node of Array.from(document.querySelectorAll<HTMLElement>('[data-note-list-row="true"]'))) {
		const id = node.dataset.noteId;
		if (!id) continue;
		const rect = node.getBoundingClientRect();
		rowViewportRects[id] = { left: rect.left, top: rect.top };
	}
	return { noteId, viewportTopPx: row.getBoundingClientRect().top, rowViewportRects };
}

/** Nudge window scroll so the row sits at the same viewport Y as when the anchor was captured. */
export function applyListScrollAnchorToRow(row: HTMLElement, anchor: ListScrollAnchor): boolean {
	if (typeof window === 'undefined') return true;
	const delta = row.getBoundingClientRect().top - anchor.viewportTopPx;
	if (Math.abs(delta) < 0.5) return true;
	// 'instant', not 'auto': 'auto' defers to CSS scroll-behavior and could turn this into a smooth scroll.
	window.scrollBy({ left: 0, top: delta, behavior: 'instant' });
	return false;
}

// Each list column is its own NoteListView, and each one receives the same anchor. The
// first column to commit does the scroll for all of them; the rest just animate.
const appliedAnchors = new WeakSet<ListScrollAnchor>();

/**
 * Scrolls so the anchor row sits exactly where it was captured, once per anchor. Call it
 * from a layout effect: the scroll lands before the browser paints the new layout.
 */
export function applyListScrollAnchorOnce(anchor: ListScrollAnchor): boolean {
	if (appliedAnchors.has(anchor)) return true;
	const row = findListRowByNoteId(anchor.noteId);
	if (!row) return false;
	// A previous switch's animation may still be moving this row; measure its real spot.
	row.style.transition = '';
	row.style.transform = '';
	row.style.willChange = '';
	applyListScrollAnchorToRow(row, anchor);
	appliedAnchors.add(anchor);
	return true;
}
