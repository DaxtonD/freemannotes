export type ChecklistDragAxis = 'vertical' | 'horizontal' | null;
export type ChecklistHorizontalDirection = 'left' | 'right' | null;

let currentChecklistDragAxis: ChecklistDragAxis = null;
let currentChecklistHorizontalDirection: ChecklistHorizontalDirection = null;

export function setChecklistDragAxis(axis: ChecklistDragAxis): void {
	currentChecklistDragAxis = axis;
}

export function getChecklistDragAxis(): ChecklistDragAxis {
	return currentChecklistDragAxis;
}

export function setChecklistHorizontalDirection(direction: ChecklistHorizontalDirection): void {
	currentChecklistHorizontalDirection = direction;
}

export function getChecklistHorizontalDirection(): ChecklistHorizontalDirection {
	return currentChecklistHorizontalDirection;
}

export function resetChecklistDragAxis(): void {
	currentChecklistDragAxis = null;
	currentChecklistHorizontalDirection = null;
}

// ── Horizontal snap callback ──────────────────────────────────────────────
// The sensor calls fireHorizontalSnap when horizontal axis is detected.
// The active editor registers a handler to apply indent/unindent directly,
// completely bypassing the drag-drop library for horizontal operations.

type HorizontalSnapHandler = (draggableId: string, direction: 'left' | 'right') => void;
let horizontalSnapHandler: HorizontalSnapHandler | null = null;

export function registerHorizontalSnapHandler(handler: HorizontalSnapHandler): () => void {
	horizontalSnapHandler = handler;
	return () => {
		if (horizontalSnapHandler === handler) horizontalSnapHandler = null;
	};
}

export function fireHorizontalSnap(draggableId: string, direction: 'left' | 'right'): void {
	if (horizontalSnapHandler) horizontalSnapHandler(draggableId, direction);
}

// ── Vertical drag Y clamp ──────────────────────────────────────────────────
// The active checklist editor registers a getter returning the maximum
// clientY the drag sensor should report to @hello-pangea/dnd — the top edge
// of the completed-items section, which an active (unchecked) row can never
// actually be dropped into. Clamping at the sensor (the source of the
// coordinates fed into the library) rather than reacting to the library's
// own auto-scroll/clone position afterward freezes the dragged clone at that
// boundary and keeps auto-scroll (driven by this same reported position)
// from ever requesting a scroll past it — no fighting the library's own
// scroll loop, no oscillation.

type ChecklistDragMaxYGetter = () => number | null;
let checklistDragMaxYGetter: ChecklistDragMaxYGetter | null = null;

export function registerChecklistDragMaxY(getter: ChecklistDragMaxYGetter): () => void {
	checklistDragMaxYGetter = getter;
	return () => {
		if (checklistDragMaxYGetter === getter) checklistDragMaxYGetter = null;
	};
}

export function clampChecklistDragY(y: number): number {
	const maxY = checklistDragMaxYGetter?.();
	return typeof maxY === 'number' ? Math.min(y, maxY) : y;
}
