export type GridLayoutConfig = {
	columnCount: number;
	mobileCardWidthPx: number | null;
	mobileGapPx: number | null;
	mobileSectionBleedPx: number;
};

type HeightLookup = Pick<ReadonlyMap<string, number>, 'get'>;

export type MasonryItemLayout = {
	id: string;
	columnIndex: number;
	x: number;
	y: number;
	width: number;
	height: number;
	columnTop: number;
};

export type MasonryLayout = {
	columnWidth: number;
	gapPx: number;
	columnHeights: number[];
	columnOffsets: number[];
	items: readonly MasonryItemLayout[];
	itemById: ReadonlyMap<string, MasonryItemLayout>;
	totalHeight: number;
	totalWidth: number;
};

export type StableMasonryPlacementReason =
	| 'anchored-visible-column'
	| 'preserve-previous-column'
	| 'shortest-column'
	| 'reading-order-deal';

export type StableMasonryPlacementDecision = {
	noteId: string;
	assignedColumn: number;
	assignedSiblingIndex: number;
	previousColumn: number | null;
	previousSiblingIndex: number | null;
	shortestColumn: number;
	shortestColumnHeight: number;
	preferredColumn: number | null;
	preferredColumnHeight: number | null;
	anchoredColumn: number | null;
	stabilitySlackPx: number;
	measuredHeight: number;
	columnHeightsAtDecision: readonly number[];
	viewportStabilityOverridden: boolean;
	stableOrderOverridden: boolean;
	tieBreakerOccurred: boolean;
	reason: StableMasonryPlacementReason;
};

export const MOBILE_GRID_EDGE_MARGIN_PX = 4;

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
			mobileSectionBleedPx = 0;
		}

		const stableShortSide =
			typeof window !== 'undefined' && typeof window.screen !== 'undefined'
				? Math.min(window.screen.width, window.screen.height)
				: Math.min(viewportWidth, viewportHeight);
		const desiredEdgeMargin = isPortrait ? MOBILE_GRID_EDGE_MARGIN_PX : 0;
		const twoColumnBasis = Math.max(
			0,
			Math.min(containerWidth, stableShortSide) - desiredEdgeMargin * 2
		);
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
	heightById: HeightLookup,
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

export function splitIntoColumnsByHeightAnchored(args: {
	ids: readonly string[];
	columnCount: number;
	heightById: HeightLookup;
	gapPx: number;
	fallbackHeightPx: number;
	anchoredColumnById?: ReadonlyMap<string, number> | null;
	preferredColumnById?: ReadonlyMap<string, number> | null;
	preferredSiblingIndexById?: ReadonlyMap<string, number> | null;
	onAssign?: (decision: StableMasonryPlacementDecision) => void;
}): string[][] {
	const cols = Math.max(1, args.columnCount);
	const columns: string[][] = Array.from({ length: cols }, () => []);
	const heights = new Array<number>(cols).fill(0);

	for (const id of args.ids) {
		const measuredHeight = args.heightById.get(id) ?? args.fallbackHeightPx;
		const columnHeightsAtDecision = heights.slice();
		const shortestColumn = heights.reduce((bestIndex, height, index, currentHeights) => (
			height < currentHeights[bestIndex] ? index : bestIndex
		), 0);
		const shortestColumnHeight = heights[shortestColumn] ?? 0;
		const anchoredColumn = args.anchoredColumnById?.get(id);
		const previousColumn = args.preferredColumnById?.get(id);
		const previousSiblingIndex = args.preferredSiblingIndexById?.get(id) ?? null;
		const stabilitySlackPx = Math.max(args.gapPx * 2, Math.min(96, Math.round(measuredHeight * 0.18)));
		let bestColumn =
			typeof anchoredColumn === 'number' && Number.isFinite(anchoredColumn)
				? Math.max(0, Math.min(cols - 1, Math.floor(anchoredColumn)))
				: shortestColumn;
		let reason: StableMasonryPlacementReason = anchoredColumn === undefined
			? 'shortest-column'
			: 'anchored-visible-column';
		let preferredColumnHeight: number | null = null;
		if (anchoredColumn === undefined && typeof previousColumn === 'number' && Number.isFinite(previousColumn)) {
			const normalizedPreferredColumn = Math.max(0, Math.min(cols - 1, Math.floor(previousColumn)));
			preferredColumnHeight = heights[normalizedPreferredColumn] ?? 0;
			if (preferredColumnHeight <= shortestColumnHeight + stabilitySlackPx) {
				bestColumn = normalizedPreferredColumn;
				reason = 'preserve-previous-column';
			}
		}

		columns[bestColumn].push(id);
		args.onAssign?.({
			noteId: id,
			assignedColumn: bestColumn,
			assignedSiblingIndex: columns[bestColumn].length - 1,
			previousColumn: typeof previousColumn === 'number' && Number.isFinite(previousColumn) ? previousColumn : null,
			previousSiblingIndex,
			shortestColumn,
			shortestColumnHeight,
			preferredColumn: typeof previousColumn === 'number' && Number.isFinite(previousColumn) ? previousColumn : null,
			preferredColumnHeight,
			anchoredColumn: typeof anchoredColumn === 'number' && Number.isFinite(anchoredColumn) ? anchoredColumn : null,
			stabilitySlackPx,
			measuredHeight,
			columnHeightsAtDecision,
			viewportStabilityOverridden: reason === 'anchored-visible-column' && bestColumn !== shortestColumn,
			stableOrderOverridden: reason === 'preserve-previous-column' && bestColumn !== shortestColumn,
			tieBreakerOccurred: bestColumn !== shortestColumn,
			reason,
		});
		heights[bestColumn] += measuredHeight + (columns[bestColumn].length > 1 ? args.gapPx : 0);
	}

	return columns;
}

/**
 * Compute column slot lengths for a height-triggered repack that avoids
 * reshuffling visible cards.
 *
 * Uses `splitIntoColumnsByHeight` to find the globally optimal slot sizes, then
 * clamps each slot to at least `floor(lockTopCount / columnCount)` rows.  Because
 * `splitIntoColumnsBySlotLengths` distributes notes in interleaved row order, the
 * first `lockRows × columnCount` notes always land in the same columns regardless
 * of the final slot sizes — so visible cards stay put while off-screen cards
 * rebalance.
 *
 * @param ids           - All visible card IDs in canonical order.
 * @param columnCount   - Number of grid columns.
 * @param heightById    - Current measured card heights.
 * @param gapPx         - Gap between cards within a column.
 * @param fallbackHeightPx - Height estimate for unmeasured cards.
 * @param lockTopCount  - Approximate number of cards currently visible on screen.
 *                        The first `floor(lockTopCount / columnCount)` rows are
 *                        guaranteed to keep their column assignments.
 * @returns Slot lengths for `splitIntoColumnsBySlotLengths(ids, result)`.
 */
export function computeStableRepackSlots(
	ids: readonly string[],
	columnCount: number,
	heightById: HeightLookup,
	gapPx: number,
	fallbackHeightPx: number,
	lockTopCount: number,
): number[] {
	const cols = Math.max(1, columnCount);
	const N = ids.length;
	if (N === 0) return Array.from({ length: cols }, () => 0);

	// Greedy height-optimal slot sizes.
	const greedyCols = splitIntoColumnsByHeight(ids, cols, heightById, gapPx, fallbackHeightPx);
	const slots = greedyCols.map((col) => col.length);

	// Minimum rows to lock per column so the first lockTopCount canonical notes
	// keep their column assignments after the repack.
	const lockRows = Math.floor(lockTopCount / cols);
	if (lockRows <= 0) return slots;

	// Raise any under-quota column to lockRows, tracking how many extra slots we created.
	let excess = 0;
	for (let i = 0; i < slots.length; i++) {
		if (slots[i] < lockRows) {
			excess += lockRows - slots[i];
			slots[i] = lockRows;
		}
	}

	// Drain the excess from the largest over-quota columns one step at a time.
	while (excess > 0) {
		let bestIdx = -1;
		let bestVal = lockRows;
		for (let i = 0; i < slots.length; i++) {
			if (slots[i] > bestVal) {
				bestVal = slots[i];
				bestIdx = i;
			}
		}
		if (bestIdx < 0) break;
		slots[bestIdx]--;
		excess--;
	}

	return slots;
}

export function buildMasonryLayoutFromColumns(args: {
	columns: readonly string[][];
	columnWidth: number;
	gapPx: number;
	heightById: ReadonlyMap<string, number>;
	fallbackHeightPx: number;
}): MasonryLayout {
	const normalizedColumnWidth = Math.max(1, Math.round(args.columnWidth));
	const normalizedGapPx = Math.max(0, Math.round(args.gapPx));
	const columnOffsets = args.columns.map((_, index) => index * (normalizedColumnWidth + normalizedGapPx));
	const columnHeights = new Array<number>(args.columns.length).fill(0);
	const items: MasonryItemLayout[] = [];
	const itemById = new Map<string, MasonryItemLayout>();

	for (let columnIndex = 0; columnIndex < args.columns.length; columnIndex++) {
		const columnIds = args.columns[columnIndex] ?? [];
		let y = 0;
		for (const id of columnIds) {
			const height = Math.max(1, Math.round(args.heightById.get(id) ?? args.fallbackHeightPx));
			const nextItem: MasonryItemLayout = {
				id,
				columnIndex,
				x: columnOffsets[columnIndex] ?? 0,
				y,
				width: normalizedColumnWidth,
				height,
				columnTop: y,
			};
			items.push(nextItem);
			itemById.set(id, nextItem);
			y += height + normalizedGapPx;
		}
		columnHeights[columnIndex] = Math.max(0, y - (columnIds.length > 0 ? normalizedGapPx : 0));
	}

	const totalHeight = columnHeights.length > 0 ? Math.max(...columnHeights) : 0;
	const totalWidth = args.columns.length > 0
		? args.columns.length * normalizedColumnWidth + Math.max(0, args.columns.length - 1) * normalizedGapPx
		: normalizedColumnWidth;

	return {
		columnWidth: normalizedColumnWidth,
		gapPx: normalizedGapPx,
		columnHeights,
		columnOffsets,
		items,
		itemById,
		totalHeight,
		totalWidth,
	};
}

export function getVirtualizedMasonryItems(args: {
	layout: MasonryLayout;
	viewportTop: number;
	viewportHeight: number;
	overscanPx: number;
}): Set<string> {
	const visibleIds = new Set<string>();
	const minY = Math.max(0, args.viewportTop - Math.max(0, args.overscanPx));
	const maxY = args.viewportTop + Math.max(0, args.viewportHeight) + Math.max(0, args.overscanPx);
	for (const item of args.layout.items) {
		const itemBottom = item.y + item.height;
		if (itemBottom < minY) continue;
		if (item.y > maxY) continue;
		visibleIds.add(item.id);
	}
	return visibleIds;
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

/**
 * Display-layer sort: pinned IDs first, preserving relative order within each tier.
 *
 * INVARIANT: This is display-only. Never write its output to Yjs `noteOrder`.
 * Pin/unpin toggles only update user prefs; this function re-derives the grid
 * order on read. See memory/pinning-architecture.md.
 */
export function applyPinnedDisplaySort(
	ids: readonly string[],
	isPinned: (id: string) => boolean
): string[] {
	const pinned: string[] = [];
	const unpinned: string[] = [];
	for (const id of ids) {
		if (isPinned(id)) pinned.push(id);
		else unpinned.push(id);
	}
	return [...pinned, ...unpinned];
}

export function isPinTierSorted(
	ids: readonly string[],
	isPinned: (id: string) => boolean,
): boolean {
	let seenUnpinned = false;
	for (const id of ids) {
		if (isPinned(id)) {
			if (seenUnpinned) return false;
		} else {
			seenUnpinned = true;
		}
	}
	return true;
}

export function layoutOrderMatchesVisible(layoutOrderIds: readonly string[], visibleIds: readonly string[]): boolean {
	if (layoutOrderIds.length === 0 || layoutOrderIds.length !== visibleIds.length) return false;
	const visibleSet = new Set(visibleIds);
	return layoutOrderIds.every((id) => visibleSet.has(id));
}

/** Prefer warm cached display order until live pin snapshots catch up; prefer visibleIds once pin tiers are current. */
export function pickRenderedDisplayOrder(args: {
	layoutOrderIds: readonly string[];
	visibleIds: readonly string[];
	shouldPrioritizePinned: boolean;
	isPinned: (id: string) => boolean;
}): string[] {
	const { layoutOrderIds, visibleIds, shouldPrioritizePinned, isPinned } = args;
	if (!layoutOrderMatchesVisible(layoutOrderIds, visibleIds)) {
		return [...visibleIds];
	}
	if (arraysEqual(layoutOrderIds, visibleIds)) {
		return [...visibleIds];
	}
	if (shouldPrioritizePinned) {
		const visiblePinSorted = isPinTierSorted(visibleIds, isPinned);
		const layoutPinSorted = isPinTierSorted(layoutOrderIds, isPinned);
		if (!visiblePinSorted && layoutPinSorted) {
			return [...layoutOrderIds];
		}
	}
	return [...visibleIds];
}

/**
 * Apply a within-tier drag result to canonical visible order.
 *
 * Used at drag-commit time so only the dragged note's pin tier is reordered in
 * Yjs. IDs in the other tier keep their canonical slots; cross-tier moves happen
 * via Pin/Unpin, not drag-and-drop.
 *
 * @param canonicalVisibleOrder Visible IDs in manual/canonical order (not pin-sorted).
 * @param readingOrder          Row-major order from flattenColumns after drag preview.
 * @param tierIsPinned          Whether the dragged note is in the pinned tier.
 */
export function applyTierReorderToCanonicalVisible(
	canonicalVisibleOrder: readonly string[],
	readingOrder: readonly string[],
	tierIsPinned: boolean,
	isPinned: (id: string) => boolean
): string[] {
	const tierNewOrder = readingOrder.filter((id) => isPinned(id) === tierIsPinned);
	let tierCursor = 0;
	return canonicalVisibleOrder.map((id) => {
		if (isPinned(id) !== tierIsPinned) return id;
		return tierNewOrder[tierCursor++] ?? id;
	});
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
 * Returns the horizontal distance from a point `x` to the nearest edge of
 * `rect`. Returns 0 when `x` is inside the rect.
 *
 * Used by findInsertionPoint's column selector: when the drag anchor is
 * between columns (in the gap), we pick the column whose edge is closest
 * rather than whose center is closest.  This gives correct behavior at all
 * gap widths without any magic threshold constant.
 */
function getHorizontalDistanceToRect(x: number, rect: DOMRect): number {
	if (x < rect.left) return rect.left - x;
	if (x > rect.right) return x - rect.right;
	return 0;
}

/**
 * Returns an effective card midpoint Y for cross-column insertion, applying a
 * small bias toward the card's visible slice when the card is partially clipped
 * by the grid section boundary.
 *
 * WHY THIS EXISTS:
 *   When the user drags near the top or bottom edge of the visible grid, some
 *   destination cards may be largely off-screen. Without any correction the raw
 *   geometric midpoint of a mostly-hidden card is outside the visible area,
 *   which means the user would have to drag past a point they cannot see before
 *   the insertion slot moves past that card. The bias nudges the effective
 *   midpoint toward the visible portion so the insertion feels responsive to
 *   what the user can actually see.
 *
 * HOW THE BIAS WORKS:
 *   - hiddenFraction = how much of the card is off-screen (0 → fully visible,
 *     1 → fully hidden).
 *   - biasStrength caps at 0.4: even a completely hidden card shifts its
 *     effective midpoint by at most 40 % toward the visible slice midpoint.
 *     A fully visible card (hiddenFraction ≈ 0) gets no shift at all.
 *   - The 0.4 cap keeps the bias gentle. It does NOT change which order
 *     fully-visible destination cards are tested — it only softens the
 *     priority of clipped edge cards.
 *
 * @param rect         Live DOMRect of the destination card.
 * @param viewportRect top/bottom of the grid's scroll container (sectionRef).
 *                     null disables the bias (same-column path skips this).
 */
function getVisibilityBiasedMidY(
	rect: DOMRect,
	viewportRect: Pick<DOMRect, 'top' | 'bottom'> | null
): number {
	const midY = rect.top + rect.height / 2;
	// No viewport info, or card is fully visible → use plain geometric midpoint.
	if (!viewportRect) return midY;
	const visibleTop = Math.max(rect.top, viewportRect.top);
	const visibleBottom = Math.min(rect.bottom, viewportRect.bottom);
	const visibleHeight = Math.max(0, visibleBottom - visibleTop);
	const rectHeight = Math.max(1, rect.height);
	// Card is fully visible (or fully hidden) → no bias needed / no reliable data.
	if (visibleHeight <= 0 || visibleHeight >= rectHeight - 1) return midY;
	const visibleMidY = (visibleTop + visibleBottom) / 2;
	const hiddenFraction = 1 - visibleHeight / rectHeight;
	// biasStrength: 0 for fully visible card, up to 0.4 for fully hidden card.
	const biasStrength = Math.min(0.4, hiddenFraction * 0.4);
	// Interpolate slightly toward the visible midpoint.
	return midY + (visibleMidY - midY) * biasStrength;
}

/**
 * Resolve the drag position to a (column, index) insertion point.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DESIGN PRINCIPLE — anchor vs. ghost rectangle
 * ═══════════════════════════════════════════════════════════════════════════
 * Column detection (horizontal) always uses the raw pointer (dragAnchorX).
 *
 * Row detection (vertical) uses TWO strategies selected by usePointerRowTest:
 *   • Ghost leading-edge — origin column and adopted foreign columns.
 *   • Pointer Y — first insertion only when entering a foreign column.
 *
 * Do NOT infer row strategy from layout column membership alone: during drag
 * preview the card still appears in the origin column in `columns`, which
 * previously kept pointer mode active for the entire cross-column drag.
 *
 * Cross-column ENTRY uses pointer Y so the first neighbor shift follows the
 * finger (height-independent). See getVisibilityBiasedMidY for clipped cards.
 *
 * IN-COLUMN (and post-adoption foreign column) uses ghost leading edges so the
 * dragged card must travel ~half its height past a neighbour before swapping —
 * the proven resistive feel for same-column reordering.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COLUMN DETECTION (horizontal)
 * ═══════════════════════════════════════════════════════════════════════════
 * The source column is kept as the active column until the drag anchor
 * physically leaves that column's DOM bounds. Once outside, we test each
 * column's bounding rect:
 *   - If the anchor is inside a column rect → that column wins immediately.
 *   - If the anchor is in a gap → pick the column with the shortest edge
 *     distance via getHorizontalDistanceToRect() (not center distance).
 *
 * The edge-distance tie-break was chosen over center-distance so that wide
 * gaps don't create a large dead zone where it's unclear which column will
 * receive the drop. The anchor enters the winning column the moment it exits
 * the source column, making the transition instant and predictable.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ROW DETECTION (vertical) — in-column / adopted-column path (ghost edges)
 * ═══════════════════════════════════════════════════════════════════════════
 * Uses the ghost card's leading edge against each card's midpoint:
 *   - Dragging DOWN: ghostBottom is the leading edge.
 *     Insert before card[i] when ghostBottom < card[i].midY
 *     (the ghost hasn't "passed" card[i] yet).
 *   - Dragging UP:   ghostTop is the leading edge.
 *     Insert before card[i] when ghostTop < card[i].midY
 *     (the ghost has risen above card[i]'s midpoint).
 * Which edge to use is determined by comparing ghostCenterY to card midY:
 *   ghostCenterY < card.midY → ghost is above → use ghostBottom as leading edge
 *   ghostCenterY > card.midY → ghost is below → use ghostTop as leading edge
 *
 * This means the dragged card must travel at least its own half-height past
 * a neighbour before triggering a swap — which feels physically natural.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ROW DETECTION (vertical) — foreign-column entry path (pointer Y)
 * ═══════════════════════════════════════════════════════════════════════════
 * Active only while inColumnRowTestColumn !== bestColumn (first insertion in
 * that foreign column). After the drag manager records the first insertion it
 * sets inColumnRowTestColumn and subsequent moves use ghost edges above.
 *
 * Uses the raw drag anchor Y against each destination card's midpoint:
 *   Insert before card[i] when dragAnchorY < card[i].effectiveMidY
 * The destination column behaves like a local vertical list driven entirely
 * by where the user's finger / header is, not by the dragged card's size.
 *
 * A small visibility bias is applied to destination cards that are partially
 * clipped by the grid container (see getVisibilityBiasedMidY). This prevents
 * mostly-hidden cards near the viewport edge from eagerly claiming the slot
 * for an insertion point the user cannot see.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PIN TIERS (optional isPinned callback)
 * ═══════════════════════════════════════════════════════════════════════════
 * When isPinned is provided, row hit-tests skip opposite-tier cards and insert
 * indices clamp to the active tier. Preview insertion uses
 * insertIntoColumnsRespectingPinGroups in the drag manager.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * OSCILLATION PREVENTION
 * ═══════════════════════════════════════════════════════════════════════════
 * After any insertion-point change, the drag manager sets a 280 ms cooldown
 * (insertionCooldownRef) during which this function is not called. This gives
 * framer-motion's spring animation time to settle so getBoundingClientRect()
 * returns stable card positions before the next hit test. No extra geometric
 * hysteresis is needed inside this function.
 *
 * @param columns        Current masonry column layout (includes activeId).
 * @param activeId       ID of the card currently being dragged.
 * @param ghostTopY      Top edge of the ghost overlay (clientY coords).
 * @param ghostBottomY   Bottom edge of the ghost overlay (clientY coords).
 *                       Only used by the same-column leading-edge test.
 * @param dragAnchorX    Raw pointer clientX — used for column selection and
 *                       cross-column row test. NOT the ghost center.
 * @param dragAnchorY    Raw pointer clientY — used for cross-column row test.
 * @param getRectForId   Returns the live DOMRect for a card element.
 * @param getColumnRect  Returns the live DOMRect for a column container.
 * @param getViewportRect Returns top/bottom of the grid scroll container,
 *                        used for the visibility bias on cross-column drags.
 * @param isPinned         Optional pin-tier filter for drag preview.
 * @param dragOriginColumn Column index where the drag started (layout columns,
 *                        not preview). When set with inColumnRowTestColumn,
 *                        enables hybrid row hit-testing (see below).
 * @param inColumnRowTestColumn After the first insertion in a foreign column,
 *                        this column uses ghost-edge row tests like a native
 *                        in-column drag. null = still in pointer entry phase.
 * @returns { column, index } where index is the slot BEFORE which the card
 *          should be inserted, or null when columns is empty.
 *
 * Hybrid row hit-testing (when dragOriginColumn is provided):
 *   • Origin column → ghost leading-edge tests.
 *   • Foreign column, first entry (inColumnRowTestColumn !== bestColumn) → pointer Y.
 *   • Foreign column after first insertion (inColumnRowTestColumn === bestColumn) → ghost edges.
 */
/** Clamp a raw insert index to the active pin tier within one column. */
function clampInsertionIndexForPinGroup(
	index: number,
	activeIsPinned: boolean,
	pinnedCount: number
): number {
	return activeIsPinned ? Math.min(index, pinnedCount) : Math.max(index, pinnedCount);
}

/**
 * Return true when the pointer is vertically over an opposite-pin card in the
 * target column. When true, drag preview leaves columns unchanged (no neighbor
 * shift) — avoids implying a valid drop across pin tiers.
 */
export function shouldSuppressPinGroupInsertion(
	colWithoutActive: readonly string[],
	activeId: string,
	dragAnchorY: number,
	isPinned: (id: string) => boolean,
	getRectForId: (id: string) => DOMRect | null
): boolean {
	const activeIsPinned = isPinned(activeId);
	for (const id of colWithoutActive) {
		if (isPinned(id) === activeIsPinned) continue;
		const rect = getRectForId(id);
		if (!rect) continue;
		if (dragAnchorY >= rect.top && dragAnchorY <= rect.bottom) {
			return true;
		}
	}
	return false;
}

/**
 * Splice the dragged card into the pinned or unpinned sub-block of one column,
 * then reconcatenate [...pinned, ...unpinned]. Opposite-tier cards never shift
 * during drag preview. Used instead of insertIntoColumns when pin groups apply.
 */
export function insertIntoColumnsRespectingPinGroups(
	columns: readonly string[][],
	activeId: string,
	insertColumn: number,
	insertIndex: number,
	isPinned: (id: string) => boolean
): string[][] {
	const next = columns.map((col) => col.filter((id) => id !== activeId));
	const targetCol = next[insertColumn] ?? next[0];
	const pinnedBlock: string[] = [];
	const unpinnedBlock: string[] = [];
	for (const id of targetCol) {
		if (isPinned(id)) pinnedBlock.push(id);
		else unpinnedBlock.push(id);
	}
	const activeIsPinned = isPinned(activeId);
	if (activeIsPinned) {
		const idx = Math.min(insertIndex, pinnedBlock.length);
		pinnedBlock.splice(idx, 0, activeId);
	} else {
		const unpinnedSubIndex = Math.max(0, insertIndex - pinnedBlock.length);
		unpinnedBlock.splice(unpinnedSubIndex, 0, activeId);
	}
	targetCol.length = 0;
	targetCol.push(...pinnedBlock, ...unpinnedBlock);
	return next;
}

export function findInsertionPoint(
	columns: readonly string[][],
	activeId: string,
	ghostTopY: number,
	ghostBottomY: number,
	dragAnchorX: number,
	dragAnchorY: number,
	getRectForId: (id: string) => DOMRect | null,
	getColumnRect: (columnIndex: number) => DOMRect | null,
	getViewportRect: () => Pick<DOMRect, 'top' | 'bottom'> | null,
	isPinned?: (id: string) => boolean,
	dragOriginColumn?: number,
	inColumnRowTestColumn?: number | null
): { column: number; index: number } | null {
	if (columns.length === 0) return null;
	// Locate which column the dragged card currently lives in.
	// This is needed both for column-detection hysteresis and for choosing
	// the same-column vs cross-column row strategy.
	const sourceColumn = columns.findIndex((c) => c.includes(activeId));

	// ── Column detection ────────────────────────────────────────────────────
	// Strategy: keep the source column as long as the drag anchor is physically
	// inside it (bestDist = 0 short-circuits the rest of the loop). Once the
	// anchor leaves, switch to the column that contains the anchor, falling back
	// to edge-distance proximity when the anchor is in a gap.
	let bestColumn = sourceColumn >= 0 ? sourceColumn : 0;
	let bestDist = Infinity;
	if (sourceColumn >= 0) {
		const sourceRect = getColumnRect(sourceColumn);
		// Anchor still inside the source column → no column change needed.
		if (sourceRect && dragAnchorX >= sourceRect.left && dragAnchorX <= sourceRect.right) {
			bestDist = 0; // signals "locked to source" — loop will skip all other columns
		}
	}
	for (let c = 0; c < columns.length; c++) {
		// Already confirmed we're inside the source column; skip everything else.
		if (bestDist === 0 && c === bestColumn) continue;
		const colRect = getColumnRect(c);
		if (!colRect) continue;
		// Anchor is directly inside this column's rect → best possible match.
		if (dragAnchorX >= colRect.left && dragAnchorX <= colRect.right) {
			bestColumn = c;
			bestDist = 0;
			break; // can't do better than 0 distance
		}
		// Anchor is in a gap → track whichever column's edge is nearest.
		const dist = getHorizontalDistanceToRect(dragAnchorX, colRect);
		if (dist < bestDist) {
			bestDist = dist;
			bestColumn = c;
		}
	}

	// ── Row detection ───────────────────────────────────────────────────────
	// Build destination column's list, excluding the dragged card itself
	// (it has been lifted out of the layout preview).
	const col = columns[bestColumn].filter((id) => id !== activeId);
	// Empty destination column → trivially insert at index 0.
	if (col.length === 0) return { column: bestColumn, index: 0 };

	const pinGroupActive = typeof isPinned === 'function';
	const activeIsPinned = pinGroupActive ? isPinned(activeId) : false;
	const pinnedCount = pinGroupActive ? col.filter((id) => isPinned(id)).length : 0;
	const clampIndex = (index: number): number => (
		pinGroupActive ? clampInsertionIndexForPinGroup(index, activeIsPinned, pinnedCount) : index
	);

	// ghostCenterY is only used by the same-column leading-edge test; it is
	// NOT used for cross-column detection (that uses dragAnchorY directly).
	const ghostCenterY = (ghostTopY + ghostBottomY) / 2;

	// ── Hybrid row strategy ─────────────────────────────────────────────────
	// When dragOriginColumn is set (always during managed drags), foreign columns
	// use pointer Y only until inColumnRowTestColumn === bestColumn. Otherwise
	// fall back to legacy isCrossColumn = bestColumn !== sourceColumn.
	// IMPORTANT: Do not revert to sourceColumn membership alone — layout columns
	// still list the card in the origin column during drag preview.
	const usePointerRowTest = typeof dragOriginColumn === 'number' && dragOriginColumn >= 0
		? (
			bestColumn !== dragOriginColumn
			&& inColumnRowTestColumn !== bestColumn
		)
		: bestColumn !== sourceColumn;
	// Visibility bias only for pointer-based foreign-column entry.
	const viewportRect = usePointerRowTest ? getViewportRect() : null;

	for (let i = 0; i < col.length; i++) {
		// Pin tiers: only same-tier cards participate in neighbor-shift hit tests.
		if (pinGroupActive && isPinned(col[i]) !== activeIsPinned) continue;
		const rect = getRectForId(col[i]);
		if (!rect) continue;
		const midY = usePointerRowTest
			? getVisibilityBiasedMidY(rect, viewportRect)
			: rect.top + rect.height / 2;

		if (usePointerRowTest) {
			// ── Cross-column entry: anchor crosses destination midpoint ────────
			if (dragAnchorY < midY) {
				return { column: bestColumn, index: clampIndex(i) };
			}
		} else {
			// ── In-column: leading-edge crosses destination midpoint ───────────
			const ghostEdge = ghostCenterY < midY ? ghostBottomY : ghostTopY;
			if (ghostEdge < midY) {
				return { column: bestColumn, index: clampIndex(i) };
			}
		}
	}

	// Anchor is below all destination cards → insert at the end of the active pin tier.
	const fallThroughIndex = pinGroupActive
		? (activeIsPinned ? pinnedCount : col.length)
		: col.length;
	return { column: bestColumn, index: fallThroughIndex };
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
 * Compute column slot lengths that balance column heights while preserving
 * the flattenColumns invariant.
 *
 * Starts from round-robin slot sizes and iteratively transfers one slot from
 * the tallest column to the shortest column as long as the transfer reduces
 * imbalance and the imbalance exceeds `thresholdPx`.
 *
 * Column content for given slot sizes is determined by splitIntoColumnsBySlotLengths
 * (row-major from canonical order), so flattenColumns(result) === ids is preserved
 * after every adjustment. Only the BOTTOM rows of the tallest column participate —
 * mid-column and top-column cards never migrate.
 */
export function computeTailBalancedSlots(args: {
	ids: readonly string[];
	columnCount: number;
	heightById: HeightLookup;
	gapPx: number;
	fallbackHeightPx: number;
	thresholdPx?: number;
	maxPasses?: number;
}): number[] {
	const cols = Math.max(1, args.columnCount);
	const N = args.ids.length;
	if (N === 0 || cols === 1) return Array.from({ length: cols }, () => N);

	const thresholdPx = args.thresholdPx ?? 150;
	const maxPasses = args.maxPasses ?? 4;

	// Round-robin starting slots: first (N % cols) columns get one extra card.
	const slots = Array.from({ length: cols }, (_, i) => Math.floor(N / cols) + (i < N % cols ? 1 : 0));

	const columnHeightsForSlots = (currentSlots: readonly number[]): number[] => {
		const columns = splitIntoColumnsBySlotLengths(args.ids, currentSlots);
		return columns.map((colIds) => {
			if (colIds.length === 0) return 0;
			let h = 0;
			for (const id of colIds) h += args.heightById.get(id) ?? args.fallbackHeightPx;
			h += (colIds.length - 1) * args.gapPx;
			return h;
		});
	};

	for (let pass = 0; pass < maxPasses; pass++) {
		const heights = columnHeightsForSlots(slots);
		let tallestIdx = 0;
		let shortestIdx = 0;
		for (let i = 1; i < heights.length; i++) {
			if (heights[i] > heights[tallestIdx]) tallestIdx = i;
			if (heights[i] < heights[shortestIdx]) shortestIdx = i;
		}
		const imbalance = heights[tallestIdx] - heights[shortestIdx];
		if (imbalance <= thresholdPx) break;
		if (slots[tallestIdx] <= 1) break;
		if (tallestIdx === shortestIdx) break;

		const nextSlots = slots.slice();
		nextSlots[tallestIdx] -= 1;
		nextSlots[shortestIdx] += 1;

		const nextHeights = columnHeightsForSlots(nextSlots);
		const nextImbalance = Math.max(...nextHeights) - Math.min(...nextHeights);
		if (nextImbalance < imbalance) {
			for (let i = 0; i < slots.length; i++) slots[i] = nextSlots[i];
		} else {
			break;
		}
	}

	return slots;
}

/**
 * Assign notes to columns in round-robin order so row-major flattening matches
 * the input list exactly: flattenColumns(result) === ids.
 *
 * INVARIANT: Use this for all viewport-driven masonry packing in NoteGrid.
 * Do NOT use splitIntoColumnsByHeight for column membership — greedy height
 * packing assigns different columns when card heights change across viewports,
 * which breaks row-major reading order on resize (e.g. A,B,D,C,F,E instead of
 * A,B,C,D,E,F). Heights only affect Y positions within a column, not membership.
 *
 * See memory/pinning-architecture.md § Reading order vs masonry.
 */
export function splitIntoColumnsByReadingOrder(ids: readonly string[], columnCount: number): string[][] {
	return dealIntoColumns(ids, columnCount);
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

// ─── Option B: two-layer masonry architecture ────────────────────────────────
//
// The three functions below implement the separation between canonical note
// ordering (stored in Yjs, never altered by visual layout) and display column
// placement (device-local, derived from canonical order but not round-trip safe).
//
// computeDisplayColumns  — builds display columns from canonical columns by
//   directly migrating the bottom note of the tallest column to the shortest
//   column, one note at a time, until no migration reduces the grid height or
//   the imbalance falls below thresholdPx.  Avoids the cascade problem of
//   slot-based balancing with 3+ equal-height columns.
//
// findColumnNeighborAnchor — given the final drag columns (derived from display
//   columns), locates the same-tier sibling immediately before or after the
//   dragged note within its column.  Used at commit time instead of
//   flattenColumns(finalColumns) to determine canonical insertion intent.
//
// applyTierReorderByInsertion — applies a single within-tier reorderByInsertion
//   to the canonical visible order, leaving opposite-tier notes untouched.
//   Replaces the applyTierReorderToCanonicalVisible + flattenColumns pipeline
//   when finalColumns are display columns (which do not satisfy the
//   flattenColumns === renderedIds invariant).

/**
 * Build display columns from canonical round-robin columns by directly
 * migrating the bottom note of the tallest column to the shortest column.
 *
 * Unlike computeTailBalancedSlots (slot-based), this operates at the note
 * level: only one specific note moves per pass, with no cascading effect on
 * other columns.  The trade-off is that flattenColumns(result) may differ from
 * the canonical reading order, so these columns must NEVER be written to Yjs
 * and must not be used with flattenColumns to derive a commit order.
 *
 * Use dealIntoColumns to produce canonicalColumns before calling this function.
 */
export function computeDisplayColumns(args: {
	canonicalColumns: readonly string[][];
	heightById: HeightLookup;
	gapPx: number;
	fallbackHeightPx: number;
	thresholdPx?: number;
	maxPasses?: number;
}): string[][] {
	const { canonicalColumns, heightById, gapPx, fallbackHeightPx } = args;
	const thresholdPx = args.thresholdPx ?? 150;
	const maxPasses = args.maxPasses ?? 8;

	if (canonicalColumns.length <= 1) return canonicalColumns.map((col) => col.slice());

	const computeHeight = (col: readonly string[]): number => {
		if (col.length === 0) return 0;
		let h = 0;
		for (const id of col) h += heightById.get(id) ?? fallbackHeightPx;
		return h + (col.length - 1) * gapPx;
	};

	const columns: string[][] = canonicalColumns.map((col) => col.slice());

	for (let pass = 0; pass < maxPasses; pass++) {
		const heights = columns.map(computeHeight);
		let tallestIdx = 0;
		let shortestIdx = 0;
		for (let i = 1; i < heights.length; i++) {
			if (heights[i] > heights[tallestIdx]) tallestIdx = i;
			if (heights[i] < heights[shortestIdx]) shortestIdx = i;
		}
		if (tallestIdx === shortestIdx) break;
		if (heights[tallestIdx] - heights[shortestIdx] <= thresholdPx) break;
		if (columns[tallestIdx].length <= 1) break;

		const bottomNote = columns[tallestIdx][columns[tallestIdx].length - 1];
		const noteHeight = heightById.get(bottomNote) ?? fallbackHeightPx;
		// Height of tallest column after removing its bottom note (loses note + 1 gap).
		const newHeightTallest = heights[tallestIdx] - noteHeight - gapPx;
		// Height of shortest column after receiving the note (gains note + 1 gap, or
		// just the note height if the shortest column is currently empty).
		const newHeightShortest = columns[shortestIdx].length === 0
			? noteHeight
			: heights[shortestIdx] + gapPx + noteHeight;

		// Only migrate when the overall grid height (max column height) decreases.
		if (Math.max(newHeightTallest, newHeightShortest) >= heights[tallestIdx]) break;

		columns[tallestIdx] = columns[tallestIdx].slice(0, -1);
		columns[shortestIdx] = [...columns[shortestIdx], bottomNote];
	}

	return columns;
}

/**
 * Given the final columns produced by a drag operation, find the same-tier
 * sibling immediately before or after the dragged note within its column.
 *
 * This is the canonical anchor used by applyTierReorderByInsertion at commit
 * time. It replaces the flattenColumns(finalColumns) approach when the columns
 * are display columns (which may not satisfy flattenColumns === canonicalOrder).
 *
 * Returns null when the dragged note is the only member of its tier in its
 * column (drop is a no-op in canonical space) or when the note is not found.
 */
export function findColumnNeighborAnchor(
	columns: readonly string[][],
	draggedId: string,
	isPinned?: (id: string) => boolean,
): { id: string; placeAfter: boolean } | null {
	for (const col of columns) {
		const idx = col.indexOf(draggedId);
		if (idx < 0) continue;
		const activeIsPinned = isPinned ? isPinned(draggedId) : false;
		// Prefer the next same-tier sibling: inserting before it expresses the
		// user's intent most directly (the dragged note lands above it).
		for (let i = idx + 1; i < col.length; i++) {
			if (!isPinned || isPinned(col[i]) === activeIsPinned) {
				return { id: col[i], placeAfter: false };
			}
		}
		// Fall back to the previous same-tier sibling when the dragged note is
		// at the bottom of its tier block (no next same-tier sibling exists).
		for (let i = idx - 1; i >= 0; i--) {
			if (!isPinned || isPinned(col[i]) === activeIsPinned) {
				return { id: col[i], placeAfter: true };
			}
		}
		return null; // Only note in its tier in this column — position unchanged.
	}
	return null; // Dragged note not found in any column.
}

/**
 * Apply a within-tier drag-drop reorder to the canonical visible order using
 * a single reorderByInsertion call rather than a full reading-order remap.
 *
 * This replaces the applyTierReorderToCanonicalVisible + flattenColumns
 * pipeline when finalColumns are display columns.  The anchor (id + placeAfter)
 * comes from findColumnNeighborAnchor.  Opposite-tier notes are never touched.
 *
 * Returns the canonical order unchanged when anchorId is null (no-op drop).
 */
export function applyTierReorderByInsertion(
	canonicalVisibleOrder: readonly string[],
	draggedId: string,
	anchorId: string | null,
	placeAfter: boolean,
	tierIsPinned: boolean,
	isPinned: (id: string) => boolean,
): string[] {
	if (!anchorId) return canonicalVisibleOrder.slice();
	const tierIds = canonicalVisibleOrder.filter((id) => isPinned(id) === tierIsPinned);
	const newTierOrder = reorderByInsertion(tierIds, draggedId, anchorId, placeAfter);
	let tierCursor = 0;
	return canonicalVisibleOrder.map((id) => {
		if (isPinned(id) !== tierIsPinned) return id;
		return newTierOrder[tierCursor++] ?? id;
	});
}
