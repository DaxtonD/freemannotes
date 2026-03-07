export type GridLayoutConfig = {
	columnCount: number;
	mobileCardWidthPx: number | null;
	mobileGapPx: number | null;
	mobileSectionBleedPx: number;
};

export function readCssPxVariable(name: string, fallback: number): number {
	if (typeof window === 'undefined') return fallback;
	const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	const parsed = Number.parseFloat(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
}

export function isMobileLikeDevice(viewportWidth: number): boolean {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') return viewportWidth < 768;
	const nav = navigator as Navigator & {
		userAgentData?: { mobile?: boolean };
	};
	const byUaData = Boolean(nav.userAgentData?.mobile);
	const byAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
	return byUaData || byAgent;
}

export function getGridLayoutForViewport(
	containerWidth: number,
	viewportWidth: number,
	viewportHeight: number
): GridLayoutConfig {
	const noteCardWidth = readCssPxVariable('--note-card-width', 280);
	const gap = readCssPxVariable('--grid-gap', 16);
	const appSidePadding = readCssPxVariable('--space-3', 12);

	const isMobile = isMobileLikeDevice(viewportWidth);
	const isPortrait = viewportHeight >= viewportWidth;

	let mobileCardWidthPx: number | null = null;
	let mobileGapPx: number | null = null;
	let mobileSectionBleedPx = 0;

	if (isMobile) {
		if (isPortrait) {
			mobileGapPx = 4;
			const desiredEdgeMargin = 4;
			mobileSectionBleedPx = Math.max(0, Math.round(appSidePadding - desiredEdgeMargin));
		}

		const stableShortSide =
			typeof window !== 'undefined' && typeof window.screen !== 'undefined'
				? Math.min(window.screen.width, window.screen.height)
				: Math.min(viewportWidth, viewportHeight);
		const effectiveContainerWidth = containerWidth + mobileSectionBleedPx * 2;
		const twoColumnBasis = Math.min(effectiveContainerWidth, stableShortSide);
		mobileCardWidthPx = Math.max(140, Math.floor((twoColumnBasis - (mobileGapPx ?? gap)) / 2));
	}

	const effectiveCardWidth = mobileCardWidthPx ?? noteCardWidth;
	const effectiveGap = mobileGapPx ?? gap;
	const maxByWidth = Math.max(1, Math.floor((containerWidth + effectiveGap) / (effectiveCardWidth + effectiveGap)));

	if (mobileCardWidthPx !== null && isPortrait) {
		return { columnCount: 2, mobileCardWidthPx, mobileGapPx, mobileSectionBleedPx };
	}

	return { columnCount: maxByWidth, mobileCardWidthPx, mobileGapPx, mobileSectionBleedPx };
}

/**
 * Split a flat list of card IDs into masonry columns using greedy shortest-column
 * packing.  Each card is assigned to whichever column currently has the smallest
 * accumulated height (summing card heights + inter-card gaps).  This is the
 * default packing strategy and is used when no cross-device column slot lengths
 * are available in the Yjs layout map.
 *
 * @param ids            - Visible card IDs in their canonical order.
 * @param columnCount    - Number of grid columns to fill.
 * @param heightById     - Measured card heights (px) keyed by note ID.
 * @param gapPx          - Gap between cards within a column.
 * @param fallbackHeightPx - Height estimate used for cards not yet measured.
 * @returns An array of columns, each column being an ordered array of card IDs.
 */
export function splitIntoColumnsByHeight(
	ids: readonly string[],
	columnCount: number,
	heightById: ReadonlyMap<string, number>,
	gapPx: number,
	fallbackHeightPx: number
): string[][] {
	const cols = Math.max(1, columnCount);
	const columns: string[][] = Array.from({ length: cols }, () => []);
	const heights = new Array<number>(cols).fill(0);

	for (const id of ids) {
		let bestColumn = 0;
		let bestHeight = heights[0];
		for (let i = 1; i < cols; i++) {
			const height = heights[i];
			if (height < bestHeight) {
				bestHeight = height;
				bestColumn = i;
			}
		}

		columns[bestColumn].push(id);
		const cardHeight = heightById.get(id) ?? fallbackHeightPx;
		heights[bestColumn] = bestHeight + cardHeight + (columns[bestColumn].length > 1 ? gapPx : 0);
	}

	return columns;
}

/**
 * Reconstruct columns from a flat ID list using predefined slot lengths.
 * This is the cross-device sync path: when device A performs a drag and commits
 * the result to Yjs, it stores both the flat column-major order AND the number
 * of cards per column (the "slot lengths", e.g. [3, 2] for 3-in-col-0 / 2-in-col-1).
 * Device B reads the same flat order and slot lengths and uses this function to
 * reproduce the exact same column grouping — bypassing height-based packing which
 * would diverge because card heights differ across viewports.
 *
 * If the slot lengths don't cover all IDs (e.g. a card was added after the last
 * drag), overflow IDs are collected into an extra column so nothing is lost.
 */
export function splitIntoColumnsBySlotLengths(ids: readonly string[], slotLengths: readonly number[]): string[][] {
	if (slotLengths.length === 0) return [ids.slice()];
	const columns: string[][] = [];
	let cursor = 0;
	for (const rawLength of slotLengths) {
		const length = Math.max(0, rawLength);
		columns.push(ids.slice(cursor, cursor + length));
		cursor += length;
	}
	if (cursor < ids.length) {
		columns.push(ids.slice(cursor));
	}
	return columns;
}

export function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

export function mergeVisibleIdsIntoLayoutOrder(previous: readonly string[], visibleIds: readonly string[]): string[] {
	const visibleSet = new Set(visibleIds);
	const kept = previous.filter((id) => visibleSet.has(id));
	const keptSet = new Set(kept);
	const appended = visibleIds.filter((id) => !keptSet.has(id));
	return [...kept, ...appended];
}

/**
 * Merge a reordered visible list back into the full note-order array that
 * includes trashed/hidden notes.  The visible slots in `fullOrder` are replaced
 * in-sequence with elements from `nextVisibleOrder`, while non-visible slots
 * (trashed notes, etc.) keep their relative positions untouched.  This is
 * called at commit time so the Yjs note-order array stays consistent with both
 * the visible drag result and any hidden notes.
 */
export function mergeVisibleOrderIntoFullOrder(
	fullOrder: readonly string[],
	visibleIds: readonly string[],
	nextVisibleOrder: readonly string[]
): string[] {
	const visibleSet = new Set(visibleIds);
	const queue = nextVisibleOrder.filter((id) => visibleSet.has(id));
	let cursor = 0;
	const next = fullOrder.map((id) => (visibleSet.has(id) ? queue[cursor++] ?? id : id));
	for (; cursor < queue.length; cursor++) {
		next.push(queue[cursor]);
	}
	return next;
}

export function reorderByInsertion(
	ids: readonly string[],
	activeId: string,
	targetId: string,
	placeAfter: boolean
): string[] {
	if (activeId === targetId) return ids.slice();
	const withoutActive = ids.filter((id) => id !== activeId);
	const targetIndex = withoutActive.indexOf(targetId);
	if (targetIndex < 0) return ids.slice();
	const insertIndex = placeAfter ? targetIndex + 1 : targetIndex;
	const next = withoutActive.slice();
	next.splice(insertIndex, 0, activeId);
	return next;
}

export function swapIds(ids: readonly string[], activeId: string, overId: string): string[] {
	const activeIndex = ids.indexOf(activeId);
	const overIndex = ids.indexOf(overId);
	if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return ids.slice();
	const next = ids.slice();
	[next[activeIndex], next[overIndex]] = [next[overIndex], next[activeIndex]];
	return next;
}

/**
 * Resolve the ghost card's position to a (column, index) insertion point.
 *
 * Column detection (horizontal):
 *   Uses the ghost's horizontal center (`pointerX`) and picks the column whose
 *   own center is closest.  Center-based detection works well horizontally
 *   because columns are roughly the same width.
 *
 * Row detection (vertical):
 *   Receives BOTH the ghost's top edge (`ghostTopY`) and bottom edge
 *   (`ghostBottomY`).  For each card in the target column, the function picks
 *   whichever ghost edge is closer to the card's midpoint:
 *     • Dragging UP  → the ghost's top edge is closer, so the shift triggers
 *       when the top edge crosses the card's midpoint.
 *     • Dragging DOWN → the ghost's bottom edge is closer, so the shift
 *       triggers when the bottom edge crosses the card's midpoint.
 *   This "nearest edge" approach solves the tall-card-over-short-card problem:
 *   using only the ghost center would require dragging impossibly far for tall
 *   cards to clear a short card's midpoint.
 *
 * Dead zone (BUFFER_PX = 16):
 *   After a layout shift, framer-motion animates cards to their new positions.
 *   During the animation, getBoundingClientRect() returns intermediate values
 *   that can immediately flip the insertion point back, causing oscillation.
 *   The 16 px buffer ensures the ghost edge must clearly cross a card's midpoint
 *   before re-triggering, giving the spring animation time to settle.
 *
 * @returns { column, index } where `index` is the slot BEFORE which the card
 *          should be inserted in that column, or null if columns are empty.
 */
export function findInsertionPoint(
	columns: readonly string[][],
	activeId: string,
	ghostTopY: number,
	ghostBottomY: number,
	pointerX: number,
	getRectForId: (id: string) => DOMRect | null,
	getColumnRect: (columnIndex: number) => DOMRect | null
): { column: number; index: number } | null {
	if (columns.length === 0) return null;

	// Find which column the pointer is over
	let bestColumn = 0;
	let bestDist = Infinity;
	for (let c = 0; c < columns.length; c++) {
		const colRect = getColumnRect(c);
		if (!colRect) continue;
		const colCenterX = colRect.left + colRect.width / 2;
		const dist = Math.abs(pointerX - colCenterX);
		if (dist < bestDist) {
			bestDist = dist;
			bestColumn = c;
		}
	}

	// Find insertion index within that column.
	// For each card, compare its center against whichever ghost edge is
	// closer. This means dragging UP triggers when the ghost's top edge
	// crosses the card's midpoint, and dragging DOWN triggers when the
	// ghost's bottom edge crosses the card's midpoint.
	// A buffer/dead-zone is applied around each midpoint so the ghost edge
	// must cross by BUFFER_PX to trigger. This prevents oscillation where
	// card layout shifts cause the insertion point to immediately flip back.
	const BUFFER_PX = 16;
	const col = columns[bestColumn].filter((id) => id !== activeId);
	if (col.length === 0) return { column: bestColumn, index: 0 };

	for (let i = 0; i < col.length; i++) {
		const rect = getRectForId(col[i]);
		if (!rect) continue;
		const midY = rect.top + rect.height / 2;
		const edgeY = Math.abs(ghostTopY - midY) <= Math.abs(ghostBottomY - midY) ? ghostTopY : ghostBottomY;
		if (edgeY < midY - BUFFER_PX) {
			return { column: bestColumn, index: i };
		}
	}

	return { column: bestColumn, index: col.length };
}

/**
 * Produce new columns with `activeId` removed from its current position and
 * spliced into the target column at `insertIndex`.  This is called both during
 * drag (to compute live preview columns) and on drop (to compute the final
 * column layout before committing to Yjs).
 */
export function insertIntoColumns(
	columns: readonly string[][],
	activeId: string,
	insertColumn: number,
	insertIndex: number
): string[][] {
	// Remove activeId from all columns first
	const next = columns.map((col) => col.filter((id) => id !== activeId));
	const targetCol = next[insertColumn] ?? next[0];
	const idx = Math.min(insertIndex, targetCol.length);
	targetCol.splice(idx, 0, activeId);
	return next;
}

/**
 * Flatten columns to a column-major linear order (all of col-0, then col-1, etc.).
 *
 * Column-major (not row-interleaved) is critical for cross-device sync:
 * the receiving device reads the flat order and splits it back into columns
 * using `splitIntoColumnsBySlotLengths`.  Column-major order means a simple
 * sequential slice at the stored slot boundaries reproduces the original
 * column grouping, regardless of how many cards each column has.
 */
export function flattenColumns(columns: readonly string[][]): string[] {
	const result: string[] = [];
	for (const col of columns) {
		for (const id of col) result.push(id);
	}
	return result;
}

/**
 * Extract the number of items in each column (the "slot lengths").
 * Stored in Yjs alongside the flat note order so other devices can reconstruct
 * the same column groupings via `splitIntoColumnsBySlotLengths`.
 */
export function columnSlotLengths(columns: readonly string[][]): number[] {
	return columns.map((col) => col.length);
}
