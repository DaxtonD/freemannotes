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
 * the result to Yjs, it stores the flat reading-order list produced by
 * `flattenColumns` plus the number of cards per column (the "slot lengths",
 * e.g. [3, 2] for 3-in-col-0 / 2-in-col-1).
 * Device B reads the same flat order and slot lengths and uses this function to
 * reproduce the exact same column grouping — bypassing height-based packing which
 * would diverge because card heights differ across viewports.
 *
 * If the slot lengths don't cover all IDs (e.g. a card was added after the last
 * drag), overflow IDs are collected into an extra column so nothing is lost.
 */
export function splitIntoColumnsBySlotLengths(ids: readonly string[], slotLengths: readonly number[]): string[][] {
	if (slotLengths.length === 0) return [ids.slice()];
	const normalizedSlots = slotLengths.map((rawLength) => Math.max(0, rawLength));
	const columns: string[][] = normalizedSlots.map(() => []);
	let cursor = 0;
	const maxRows = Math.max(0, ...normalizedSlots);

	for (let row = 0; row < maxRows && cursor < ids.length; row++) {
		for (let columnIndex = 0; columnIndex < normalizedSlots.length && cursor < ids.length; columnIndex++) {
			if (row >= normalizedSlots[columnIndex]) continue;
			columns[columnIndex].push(ids[cursor++]);
		}
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
	*   Uses the ghost card's center X (`ghostCenterX`) to pick the column whose
	*   center is closest. This makes horizontal movement follow the same visual
	*   rule as vertical movement: the dragged card itself must cross into the new
	*   column before neighbors shift.
 *
 * Row detection (vertical):
 *   Uses the ghost card's edges to find the insertion slot.  For each card in
 *   the target column (excluding the dragged card), we compare the ghost's
 *   nearest edge against the card's vertical midpoint:
 *     • Ghost center above card → bottom edge (leading edge when dragging down).
 *       If ghostBottom > cardMidY the ghost has "passed" the card.
 *     • Ghost center below card → top edge (leading edge when dragging up).
 *       If ghostTop < cardMidY the ghost has risen past the card.
 *   This matches the physical overlap the user sees and provides stable,
 *   predictable same-column and cross-column shifts.  The 280 ms cooldown in
 *   the drag manager prevents oscillation from spring-animation intermediate
 *   rects.
 *
 * @returns { column, index } where `index` is the slot BEFORE which the card
 *          should be inserted in that column, or null if columns are empty.
 */
export function findInsertionPoint(
	columns: readonly string[][],
	activeId: string,
	ghostTopY: number,
	ghostBottomY: number,
	ghostCenterX: number,
	getRectForId: (id: string) => DOMRect | null,
	getColumnRect: (columnIndex: number) => DOMRect | null
): { column: number; index: number } | null {
	if (columns.length === 0) return null;

	// ── Column detection ────────────────────────────────────────────────
	// Use the ghost center so horizontal swaps trigger when the card itself
	// crosses into a neighboring column, not when the user's original grab
	// point happens to reach it first.
	let bestColumn = 0;
	let bestDist = Infinity;
	for (let c = 0; c < columns.length; c++) {
		const colRect = getColumnRect(c);
		if (!colRect) continue;
		const colCenterX = colRect.left + colRect.width / 2;
		const dist = Math.abs(ghostCenterX - colCenterX);
		if (dist < bestDist) {
			bestDist = dist;
			bestColumn = c;
		}
	}

	// ── Row detection ───────────────────────────────────────────────────
	// Use the ghost card's edges (not the raw pointer) to determine the
	// insertion slot.  This matches the physical overlap the user sees:
	//
	//   • Dragging DOWN: the ghost's bottom edge crossing below a card's
	//     midpoint means the ghost has "passed" that card.
	//   • Dragging UP: the ghost's top edge crossing above a card's
	//     midpoint means the ghost has risen past that card.
	//
	// To decide which edge to compare for each card, we look at whether
	// the ghost center is above or below the card's midpoint:
	//   ghost center above card → use bottom edge (leading when moving down)
	//   ghost center below card → use top edge   (leading when moving up)
	const col = columns[bestColumn].filter((id) => id !== activeId);
	if (col.length === 0) return { column: bestColumn, index: 0 };

	const ghostCenterY = (ghostTopY + ghostBottomY) / 2;
	for (let i = 0; i < col.length; i++) {
		const rect = getRectForId(col[i]);
		if (!rect) continue;
		const midY = rect.top + rect.height / 2;
		// Pick the ghost edge that faces this card
		const ghostEdge = ghostCenterY < midY ? ghostBottomY : ghostTopY;
		if (ghostEdge < midY) {
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
 * Flatten columns to reading order (row-major).
 *
 * Interleaves columns row-by-row so the flat list reads left-to-right,
 * top-to-bottom — the natural "reading order".  This is the canonical
 * order stored in Yjs so that every device, regardless of its local
 * column count, can reconstruct the correct visual sequence by dealing
 * the flat list with `dealIntoColumns`.
 *
 * Example: col0=[A,C,E] col1=[B,D,F] → [A,B,C,D,E,F]
 */
export function flattenColumns(columns: readonly string[][]): string[] {
	const maxLen = Math.max(0, ...columns.map((col) => col.length));
	const result: string[] = [];
	for (let row = 0; row < maxLen; row++) {
		for (const col of columns) {
			if (row < col.length) result.push(col[row]);
		}
	}
	return result;
}

/**
 * Deal a flat reading-order list into columns using round-robin assignment.
 *
 * Card 0 → col 0, card 1 → col 1, …, card N → col 0, card N+1 → col 1, …
 * This preserves reading order (left-to-right, top-to-bottom) regardless of
 * how many columns the device has.  It is the inverse of `flattenColumns`.
 *
 * Example: [A,B,C,D,E,F] with 3 cols → col0=[A,D] col1=[B,E] col2=[C,F]
 */
export function dealIntoColumns(ids: readonly string[], columnCount: number): string[][] {
	const cols = Math.max(1, columnCount);
	const columns: string[][] = Array.from({ length: cols }, () => []);
	for (let i = 0; i < ids.length; i++) {
		columns[i % cols].push(ids[i]);
	}
	return columns;
}
