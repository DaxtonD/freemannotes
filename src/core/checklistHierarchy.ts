import type { ChecklistItem } from './bindings';
import type { ChecklistDragAxis, ChecklistHorizontalDirection } from './checklistDragState';

export type ChecklistCompletedRow<T extends ChecklistItem = ChecklistItem> = {
	kind: 'item' | 'ghost';
	item: T;
};

// ── Normalization ──────────────────────────────────────────────────────────

/**
 * Enforce hierarchy constraints on a flat item array and group children
 * immediately after their parent:
 *
 * 1. First item is always top-level (parentId = null).
 * 2. parentId must reference an existing top-level item that appears
 *    *earlier* in the pre-grouped array (max 1-deep nesting).
 * 3. Self-referencing parentIds are cleared.
 * 4. After validation, children are regrouped directly under their parent
 *    while preserving relative order within each group.
 */
export function normalizeChecklistHierarchy(items: readonly ChecklistItem[]): ChecklistItem[] {
	const result: ChecklistItem[] = items.map((item) => ({ ...item }));
	const topLevelSeen = new Set<string>();

	// Pass 1 – validate parentIds.
	for (let i = 0; i < result.length; i++) {
		const item = result[i];

		if (i === 0) {
			item.parentId = null;
			topLevelSeen.add(item.id);
			continue;
		}

		if (item.parentId) {
			if (
				item.parentId === item.id ||
				!topLevelSeen.has(item.parentId)
			) {
				item.parentId = null;
			}
		}

		if (!item.parentId) {
			topLevelSeen.add(item.id);
		}
	}

	// Pass 2 – group children directly after their parent.
	const topLevel: ChecklistItem[] = [];
	const childrenByParent = new Map<string, ChecklistItem[]>();

	for (const item of result) {
		if (!item.parentId) {
			topLevel.push(item);
		} else {
			const siblings = childrenByParent.get(item.parentId) ?? [];
			siblings.push(item);
			childrenByParent.set(item.parentId, siblings);
		}
	}

	const grouped: ChecklistItem[] = [];
	for (const parent of topLevel) {
		grouped.push(parent);
		const children = childrenByParent.get(parent.id);
		if (children) grouped.push(...children);
	}

	return grouped;
}

/**
 * Sorts completed items most-recently-completed-first, so the completed
 * section reads as a timeline of what you just finished rather than a frozen
 * copy of the list's original order. `completedAt` is missing for anything
 * completed before this field existed (or from a stale client) — those fall
 * back to their original list position, reversed, so old data degrades to a
 * stable, sensible order instead of an arbitrary one.
 *
 * Takes the already-filtered completed subset separately from the full,
 * original-order list because callers often have their own filtering rules
 * on top of plain `item.completed` (e.g. holding a row in place during its
 * completion animation) — this only owns the ordering, not the filtering.
 */
export function sortCompletedChecklistItemsByRecency<T extends ChecklistItem>(
	completedItems: readonly T[],
	allItemsInOriginalOrder: readonly T[],
): T[] {
	const orderIndexById = new Map(allItemsInOriginalOrder.map((item, index) => [item.id, index] as const));
	return completedItems.slice().sort((left, right) => {
		const leftCompletedAt = Number.isFinite(Number(left.completedAt)) ? Number(left.completedAt) : Number.NEGATIVE_INFINITY;
		const rightCompletedAt = Number.isFinite(Number(right.completedAt)) ? Number(right.completedAt) : Number.NEGATIVE_INFINITY;
		if (leftCompletedAt !== rightCompletedAt) return rightCompletedAt - leftCompletedAt;
		return (orderIndexById.get(right.id) ?? 0) - (orderIndexById.get(left.id) ?? 0);
	});
}

export function buildChecklistCompletedRows<T extends ChecklistItem>(items: readonly T[]): ChecklistCompletedRow<T>[] {
	// In completed sections, show a lightweight parent "ghost" row before a
	// completed child when the parent itself is still active. Walking the
	// recency-sorted completed items (rather than plain document order) means
	// a ghost parent row surfaces alongside whichever of its children was
	// most recently completed, consistent with the rest of the section.
	const recencyOrderedCompleted = sortCompletedChecklistItemsByRecency(items.filter((item) => item.completed), items);
	const completedIdSet = new Set(recencyOrderedCompleted.map((item) => item.id));
	const itemById = new Map(items.map((item) => [item.id, item]));
	const rows: ChecklistCompletedRow<T>[] = [];
	const insertedGhosts = new Set<string>();

	for (const item of recencyOrderedCompleted) {
		if (item.parentId) {
			const parent = itemById.get(item.parentId);
			if (parent && !completedIdSet.has(parent.id) && !insertedGhosts.has(parent.id)) {
				insertedGhosts.add(parent.id);
				rows.push({ kind: 'ghost', item: parent });
			}
		}
		rows.push({ kind: 'item', item });
	}

	return rows;
}

export function toggleChecklistItemCompleted<T extends ChecklistItem>(
	items: readonly T[],
	id: string,
	checked: boolean,
): T[] {
	// Parent toggles cascade to direct children. Child unchecks also reopen a
	// completed parent so the hierarchy never shows an active child under a
	// completed parent state.
	const normalized = normalizeChecklistHierarchy(items) as T[];
	const target = normalized.find((item) => item.id === id);
	if (!target) return normalized;

	const nextCompletedById = new Map<string, boolean>();
	const childIds = getChildIds(normalized, id);

	if (!target.parentId) {
		nextCompletedById.set(target.id, checked);
		for (const childId of childIds) nextCompletedById.set(childId, checked);
	} else {
		nextCompletedById.set(target.id, checked);
		if (!checked) {
			const parent = normalized.find((item) => item.id === target.parentId) ?? null;
			if (parent?.completed) {
				nextCompletedById.set(parent.id, false);
			}
		}
	}

	if (nextCompletedById.size === 0) return normalized;

	// A single call can cascade to several items at once (a parent toggle
	// carrying its children with it). They all still need a well-defined
	// relative order for the completed-section recency sort, so each gets its
	// own tick off a shared base timestamp rather than colliding on the same
	// Date.now() value.
	//
	// The ticks are handed out in REVERSE of document order on purpose.
	// sortCompletedChecklistItemsByRecency sorts most-recent-first (descending
	// completedAt); if the parent (processed first, right below) and its
	// children (processed after, in list order) simply counted upward, the
	// parent would end up with the OLDEST stamp of the group and the last
	// child the NEWEST — surfacing the whole cascade upside down (child N,
	// child N-1, ..., parent) even though every item in it completed in the
	// same user action. Reversing the assignment so the topmost item in
	// document order gets the largest stamp keeps a cascaded group reading
	// top-to-bottom, matching how it already read in the active list.
	const completionStampBase = Date.now();
	const completingIds = normalized
		.filter((item) => nextCompletedById.get(item.id) === true && item.completed !== true)
		.map((item) => item.id);
	const completionStampOffsetById = new Map(
		completingIds.map((itemId, index) => [itemId, completingIds.length - 1 - index] as const)
	);
	return normalized.map((item) => {
		const nextCompleted = nextCompletedById.get(item.id);
		if (nextCompleted === undefined || nextCompleted === item.completed) return item;
		return {
			...item,
			completed: nextCompleted,
			completedAt: nextCompleted ? completionStampBase + (completionStampOffsetById.get(item.id) ?? 0) : null,
		};
	});
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Return the IDs of all direct children of `parentId`. */
function getChildIds(items: readonly ChecklistItem[], parentId: string): string[] {
	return items.filter((item) => item.parentId === parentId).map((item) => item.id);
}

/**
 * Determine the parentId a single dropped item should receive based on its
 * neighbours in the list:
 *
 * - Item above is a child → same parent (join sibling group).
 * - Item above is a top-level parent and item below is its child →
 *   dropped between parent and first child → join group.
 * - Otherwise → top-level (null).
 */
function getAutoParentId(items: readonly ChecklistItem[], index: number): string | null {
	if (index <= 0) return null;

	const above = items[index - 1];
	if (!above) return null;

	// Above is a child → become a sibling in the same group.
	if (above.parentId) return above.parentId;

	// Above is top-level. If the item below is a child of above, we are
	// splitting a parent-child pair → join the group.
	const below = items[index + 1];
	if (below?.parentId === above.id) return above.id;

	return null;
}

// ── Horizontal drag (indent / un-indent) ──────────────────────────────────

function applyHorizontalDrag(
	items: ChecklistItem[],
	sourceIndex: number,
	direction: ChecklistHorizontalDirection,
): ChecklistItem[] {
	const dragged = items[sourceIndex];
	if (!dragged) return items;

	// First item can never be indented (always a parent).
	if (sourceIndex === 0) return items;

	if (direction === 'right') {
		// Already a child → can't nest deeper (max 1 level).
		if (dragged.parentId) return items;

		// Find the nearest top-level parent to attach to.
		const above = items[sourceIndex - 1];
		if (!above) return items;
		const parentId = above.parentId ?? above.id;
		if (parentId === dragged.id) return items; // self-parent guard

		// Indenting a “parent” that already has children:
		// The UI supports at most one nesting level (parent → child). If we simply
		// set `dragged.parentId = parentId` while leaving its existing children
		// pointing at `dragged.id`, we would create a 2-deep chain
		// (grandparent → dragged → children) that the rest of the editor does not
		// represent or render correctly.
		//
		// Instead, when a top-level item with children is indented, we keep the
		// hierarchy 1-deep by re-parenting *its* children to the new parent as well
		// (the “grandparent” from the dragged item’s perspective).
		const childIds = new Set(getChildIds(items, dragged.id));

		return items.map((item) => {
			if (item.id === dragged.id) return { ...item, parentId };
			if (childIds.has(item.id)) return { ...item, parentId };
			return item;
		});
	}

	if (direction === 'left') {
		// Already top-level → nothing to un-indent.
		if (!dragged.parentId) return items;

		return items.map((item) =>
			item.id === dragged.id ? { ...item, parentId: null } : item,
		);
	}

	return items;
}

// ── Vertical drag (reorder) ───────────────────────────────────────────────

function applyVerticalDrag(
	items: ChecklistItem[],
	sourceIndex: number,
	destinationIndex: number,
): ChecklistItem[] {
	if (sourceIndex === destinationIndex) return items;

	const dragged = items[sourceIndex];
	if (!dragged) return items;

	const isTopLevel = !dragged.parentId;
	const childIds = isTopLevel ? getChildIds(items, dragged.id) : [];
	const movingIds = new Set([dragged.id, ...childIds]);

	// Collect the moving items (preserving their current order).
	const moving = items.filter((item) => movingIds.has(item.id));
	const remaining = items.filter((item) => !movingIds.has(item.id));

	// Determine insertion point in `remaining`.
	// The library's destinationIndex is based on the full flat list: it
	// simulates removing the single dragged item and then reports the index
	// in the resulting shorter array.
	const afterSingleRemoval = items.filter((_, i) => i !== sourceIndex);
	const clampedDest = Math.min(destinationIndex, afterSingleRemoval.length);

	let insertAt: number;

	if (clampedDest >= afterSingleRemoval.length) {
		insertAt = remaining.length;
	} else {
		// Walk forward from clampedDest to find the first non-moving item
		// (children traveling with a parent are invisible to the library).
		let refId: string | null = null;
		for (let i = clampedDest; i < afterSingleRemoval.length; i++) {
			if (!movingIds.has(afterSingleRemoval[i].id)) {
				refId = afterSingleRemoval[i].id;
				break;
			}
		}

		if (refId) {
			insertAt = remaining.findIndex((item) => item.id === refId);
			if (insertAt === -1) insertAt = remaining.length;
		} else {
			insertAt = remaining.length;
		}
	}

	const result = [
		...remaining.slice(0, insertAt),
		...moving,
		...remaining.slice(insertAt),
	];

	// Auto-assign parentId for single-item moves (not group moves) based
	// on the item's new neighbours.
	if (childIds.length === 0) {
		const newIdx = result.findIndex((item) => item.id === dragged.id);
		if (newIdx >= 0) {
			const autoParent = getAutoParentId(result, newIdx);
			result[newIdx] = { ...result[newIdx], parentId: autoParent };
		}
	}

	return result;
}

// ── Public API ─────────────────────────────────────────────────────────────

export function applyChecklistDragToItems(args: {
	items: readonly ChecklistItem[];
	sourceIndex: number;
	destinationIndex: number;
	axis: ChecklistDragAxis;
	horizontalDirection: ChecklistHorizontalDirection;
}): ChecklistItem[] {
	const normalized = normalizeChecklistHierarchy(args.items);
	const activeItems = normalized.filter((item) => !item.completed);
	const completedItems = normalized.filter((item) => item.completed);

	let reordered: ChecklistItem[];

	if (args.axis === 'horizontal') {
		reordered = applyHorizontalDrag(activeItems, args.sourceIndex, args.horizontalDirection);
	} else {
		reordered = applyVerticalDrag(activeItems, args.sourceIndex, args.destinationIndex);
	}

	return normalizeChecklistHierarchy([...reordered, ...completedItems]);
}

/**
 * Remove an item and all its direct children.
 * Returns a new normalized array.
 */
export function removeChecklistItemWithChildren(
	items: readonly ChecklistItem[],
	id: string,
): ChecklistItem[] {
	const childIds = new Set(
		items.filter((item) => item.parentId === id).map((item) => item.id),
	);
	return items.filter((item) => item.id !== id && !childIds.has(item.id));
}

/**
 * Move an item to the very top or bottom of the ACTIVE (unchecked) items —
 * a shortcut for "drag this all the way to one end of a long list" without
 * actually dragging. Reuses applyChecklistDragToItems (the same function
 * drag-and-drop calls) rather than reimplementing hierarchy rules: a parent
 * still carries its children along as a block, and a child landing with no
 * valid parent above it (e.g. moved to the very top) becomes top-level —
 * exactly what dragging it there by hand would do.
 * Completed items are untouched; this only reorders within the active group.
 */
export function moveChecklistItemToEdge<T extends ChecklistItem>(
	items: readonly T[],
	id: string,
	edge: 'top' | 'bottom',
): T[] {
	const normalized = normalizeChecklistHierarchy(items) as T[];
	const activeItems = normalized.filter((item) => !item.completed);
	const sourceIndex = activeItems.findIndex((item) => item.id === id);
	if (sourceIndex === -1) return normalized;
	const destinationIndex = edge === 'top' ? 0 : activeItems.length - 1;
	if (sourceIndex === destinationIndex) return normalized;
	return applyChecklistDragToItems({
		items: normalized,
		sourceIndex,
		destinationIndex,
		axis: 'vertical',
		horizontalDirection: null,
	}) as T[];
}
