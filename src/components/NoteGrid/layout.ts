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
	| 'shortest-column';

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
 * ALL cross-column logic is driven by the live drag anchor: the raw pointer
 * position (pointer.clientX / pointer.clientY) passed in as dragAnchorX/Y.
 * This is intentional and critical.
 *
 * Previous attempts used the ghost card's center or edges. That caused two
 * failure modes:
 *   1. A short card dragged over a tall checklist card: the ghost bottom could
 *      never reach the tall card's midpoint, so the tall card was silently
 *      skipped and insertion always landed below it — never before it.
 *   2. Different card heights made cross-column insertion feel non-deterministic
 *      because the trigger threshold varied with the dragged card's own size.
 *
 * Using the raw anchor point makes cross-column insertion identical to how a
 * simple vertical list responds: the user's finger crosses a midpoint → the
 * neighbor shifts.  Card height is irrelevant.
 *
 * Same-column reordering STILL uses the ghost's leading edge (ghostTopY /
 * ghostBottomY) because the leading-edge heuristic gives the proven
 * "the dragged card must travel past its own half-height" feel that is
 * familiar and correct for reordering within a list.
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
 * ROW DETECTION (vertical) — same-column path
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
 * ROW DETECTION (vertical) — cross-column path
 * ═══════════════════════════════════════════════════════════════════════════
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
 * @returns { column, index } where index is the slot BEFORE which the card
 *          should be inserted, or null when columns is empty.
 */
export function findInsertionPoint(
	columns: readonly string[][],
	activeId: string,
	ghostTopY: number,
	ghostBottomY: number,
	dragAnchorX: number,
	dragAnchorY: number,
	getRectForId: (id: string) => DOMRect | null,
	getColumnRect: (columnIndex: number) => DOMRect | null,
	getViewportRect: () => Pick<DOMRect, 'top' | 'bottom'> | null
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

	// ghostCenterY is only used by the same-column leading-edge test; it is
	// NOT used for cross-column detection (that uses dragAnchorY directly).
	const ghostCenterY = (ghostTopY + ghostBottomY) / 2;

	const isCrossColumn = bestColumn !== sourceColumn;
	// Visibility bias only matters for cross-column drops where destination
	// cards might be partially clipped. Same-column cards are always visible
	// relative to the drag (the user is already looking at that column).
	const viewportRect = isCrossColumn ? getViewportRect() : null;

	for (let i = 0; i < col.length; i++) {
		const rect = getRectForId(col[i]);
		if (!rect) continue;
		// midY: for cross-column use the visibility-biased midpoint;
		//       for same-column use the plain geometric midpoint.
		const midY = isCrossColumn
			? getVisibilityBiasedMidY(rect, viewportRect)
			: rect.top + rect.height / 2;

		if (isCrossColumn) {
			// ── Cross-column: anchor crosses destination midpoint ──────────
			// The raw pointer position decides insertion, not the ghost rect.
			// This makes every destination card behave like a midpoint-triggered
			// shift, identical to how a simple single-column reorder works.
			// IMPORTANT: do not change this to use ghostCenterY or ghost edges —
			// that reintroduces the height-mismatch failure mode described above.
			if (dragAnchorY < midY) {
				return { column: bestColumn, index: i };
			}
		} else {
			// ── Same-column: leading-edge crosses destination midpoint ──────
			// Which edge of the ghost is "leading" (closest to the destination):
			//   - Ghost above card (ghostCenterY < midY) → dragging DOWN → leading edge is ghostBottomY
			//   - Ghost below card (ghostCenterY > midY) → dragging UP   → leading edge is ghostTopY
			// Insert before card[i] when the leading edge hasn't yet passed midY.
			// This requires traveling half the card's height before the swap triggers,
			// which gives the interaction its natural, "physically resistive" feel.
			// IMPORTANT: do not change this to anchor-based (dragAnchorY) —
			// that would make same-column swaps trigger too early (at the grab
			// point, not at the card edge) which feels twitchy for tall cards.
			const ghostEdge = ghostCenterY < midY ? ghostBottomY : ghostTopY;
			if (ghostEdge < midY) {
				return { column: bestColumn, index: i };
			}
		}
	}

	// Anchor is below all destination cards → insert at the end.
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
