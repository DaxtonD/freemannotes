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
