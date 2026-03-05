import type { ChecklistItem } from './bindings';
import type { ChecklistDragAxis, ChecklistHorizontalDirection } from './checklistDragState';

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
