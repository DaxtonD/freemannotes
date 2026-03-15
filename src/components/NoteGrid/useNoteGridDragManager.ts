import React from 'react';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { disableNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview';
import { autoScrollForElements, autoScrollWindowForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { isTouchDragPolyfillActive } from '../../core/touchDragPolyfill';
import { arraysEqual, findInsertionPoint, insertIntoColumns } from './layout';

type DragOverlayState = {
	id: string;
	left: number;
	top: number;
	width: number;
	height: number;
};

type InsertionPoint = { column: number; index: number };

type DragManagerArgs = {
	sectionRef: React.RefObject<HTMLElement | null>;
	gridRef: React.RefObject<HTMLDivElement | null>;
	columns: string[][];
	visibleIds: string[];
	canStartDrag: () => boolean;
	isTouchDragCandidate: () => boolean;
	onCommitOrder: (finalColumns: string[][], draggedId: string, draggedHeight: number) => void;
};

type PragmaticDragData = {
	type: 'note-grid-card';
	noteId: string;
};

type PointerInput = {
	clientX: number;
	clientY: number;
};

const DRAG_TYPE = 'note-grid-card';

function normalizeId(value: unknown): string {
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function isPragmaticDragData(value: unknown): value is PragmaticDragData {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Record<string, unknown>;
	return candidate.type === DRAG_TYPE && typeof candidate.noteId === 'string';
}

function isScrollableElement(element: HTMLElement): boolean {
	const style = window.getComputedStyle(element);
	const overflowY = style.overflowY;
	return /(auto|scroll|overlay)/.test(overflowY) && element.scrollHeight > element.clientHeight + 1;
}

export type DragManagerResult = {
	activeDragId: string | null;
	isTouchDragging: boolean;
	dragOverlay: DragOverlayState | null;
	/** Columns with the dragged card relocated to the insertion point. null when not dragging. */
	previewColumns: string[][] | null;
	setItemElement: (id: string, node: HTMLDivElement | null) => void;
	setHandleElement: (id: string, node: HTMLDivElement | null) => void;
	cancelDrag: () => void;
};

/**
 * Drag-and-drop manager hook for the NoteGrid masonry layout.
 *
 * Uses @atlaskit/pragmatic-drag-and-drop for pointer/touch drag detection and
 * auto-scroll, combined with an insertion-based reorder model (not swap-based).
 * During a drag, the hook computes live "preview columns" showing where the card
 * would land, which framer-motion animates via its `layout` prop.  On drop, the
 * final column layout is passed to `onCommitOrder` for Yjs persistence.
 *
 * Key design decisions:
 * - Ghost positioning: a custom overlay div follows the pointer (not the native
 *   drag preview, which is disabled).  The overlay is positioned at
 *   (pointer - pointerOffset), where pointerOffset is the initial grab point
 *   within the card, so the card doesn't jump to center on the cursor.
 *
 * - Hit detection: horizontal column selection uses the ghost's center X.
 *   Vertical row insertion uses the ghost's nearest edge (top when dragging up,
 *   bottom when dragging down) compared against each card's midpoint.  A 16 px
 *   buffer zone prevents oscillation from mid-animation intermediate rects.
 *
 * - Cooldown: after each insertion-point change, a 280 ms cooldown ignores
 *   further recalculations, giving framer-motion's spring animation time to
 *   settle so getBoundingClientRect() returns stable values.
 *
 * - Touch: on touch devices, scroll intent is distinguished from drag intent
 *   via the parent NoteGrid's touch handlers.  The hook respects canStartDrag()
 *   and isTouchDragCandidate() callbacks.  During a touch drag, the NoteGrid
 *   freezes touch-action/overscroll-behavior on <html>/<body>.
 */
export function useNoteGridDragManager(args: DragManagerArgs): DragManagerResult {
	const itemElementsRef = React.useRef<Map<string, HTMLDivElement>>(new Map());
	const handleElementsRef = React.useRef<Map<string, HTMLDivElement>>(new Map());
	const [registrationVersion, setRegistrationVersion] = React.useState(0);
	const [activeDragId, setActiveDragId] = React.useState<string | null>(null);
	const [dragOverlay, setDragOverlay] = React.useState<DragOverlayState | null>(null);
	const [insertionPoint, setInsertionPoint] = React.useState<InsertionPoint | null>(null);
	const [isTouchDragging, setIsTouchDragging] = React.useState(false);
	const activeDragIdRef = React.useRef<string | null>(null);
	const visibleIdsRef = React.useRef<string[]>(args.visibleIds);
	const columnsRef = React.useRef<string[][]>(args.columns);
	const canStartDragRef = React.useRef(args.canStartDrag);
	const isTouchDragCandidateRef = React.useRef(args.isTouchDragCandidate);
	const onCommitOrderRef = React.useRef(args.onCommitOrder);
	// Ghost position: the pointer offset records where within the card the user
	// initially grabbed (pointerXY - cardRect.topLeft).  This is subtracted from
	// the live pointer position to keep the ghost anchored at the grab point.
	const pointerOffsetRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });
	// Preview size: the card's measured width/height at drag start.  Used to
	// compute the ghost's center and bottom edge for insertion-point detection.
	const previewSizeRef = React.useRef<{ width: number; height: number }>({ width: 0, height: 0 });
	const insertionPointRef = React.useRef<InsertionPoint | null>(null);
	// Cooldown timestamp: after an insertion-point change, we skip recalculation
	// until Date.now() exceeds this value.  This prevents oscillation caused by
	// framer-motion's spring animation returning intermediate rects.
	const insertionCooldownRef = React.useRef(0);

	visibleIdsRef.current = args.visibleIds;
	columnsRef.current = args.columns;
	canStartDragRef.current = args.canStartDrag;
	isTouchDragCandidateRef.current = args.isTouchDragCandidate;
	onCommitOrderRef.current = args.onCommitOrder;

	const getRectForId = React.useCallback((id: string): DOMRect | null => {
		return itemElementsRef.current.get(id)?.getBoundingClientRect() ?? null;
	}, []);

	const getColumnRect = React.useCallback((columnIndex: number): DOMRect | null => {
		const grid = args.gridRef.current;
		if (!grid) return null;
		const colEl = grid.children[columnIndex] as HTMLElement | undefined;
		return colEl?.getBoundingClientRect() ?? null;
	}, [args.gridRef]);

	const updateInsertionPoint = React.useCallback(
		(pointer: PointerInput): void => {
			const activeId = activeDragIdRef.current;
			if (!activeId) return;
			// After an insertion change, skip recalculation so framer-motion's
			// spring animation settles before rect reads are trusted again.
			if (Date.now() < insertionCooldownRef.current) return;
			// Use the ghost center for horizontal column detection so crossing
			// columns follows the same visual rule as vertical insertion: the
			// dragged card itself, not the original grab point, determines when
			// neighboring cards shift.
			const ghostTopY = pointer.clientY - pointerOffsetRef.current.y;
			const ghostBottomY = ghostTopY + previewSizeRef.current.height;
			const ghostCenterX = pointer.clientX - pointerOffsetRef.current.x + previewSizeRef.current.width / 2;
			const ip = findInsertionPoint(
				columnsRef.current,
				activeId,
				ghostTopY,
				ghostBottomY,
				ghostCenterX,
				getRectForId,
				getColumnRect
			);
			if (!ip) return;
			const prev = insertionPointRef.current;
			if (prev && prev.column === ip.column && prev.index === ip.index) return;
			insertionPointRef.current = ip;
			// 280 ms cooldown — long enough for the spring (stiffness 700,
			// damping 50, mass 0.8) to settle past the overshoot phase so
			// intermediate getBoundingClientRect() values don't flip the
			// insertion point back, causing visible oscillation.
			insertionCooldownRef.current = Date.now() + 280;
			setInsertionPoint({ column: ip.column, index: ip.index });
		},
		[getRectForId, getColumnRect]
	);

	const clearDragState = React.useCallback((): void => {
		activeDragIdRef.current = null;
		insertionPointRef.current = null;
		insertionCooldownRef.current = 0;
		setActiveDragId(null);
		setDragOverlay(null);
		setInsertionPoint(null);
		setIsTouchDragging(false);
	}, []);

	const setItemElement = React.useCallback((id: string, node: HTMLDivElement | null): void => {
		const previous = itemElementsRef.current.get(id) ?? null;
		if (previous === node) return;
		if (node) itemElementsRef.current.set(id, node);
		else itemElementsRef.current.delete(id);
		setRegistrationVersion((version) => version + 1);
	}, []);

	const setHandleElement = React.useCallback((id: string, node: HTMLDivElement | null): void => {
		const previous = handleElementsRef.current.get(id) ?? null;
		if (previous === node) return;
		if (node) handleElementsRef.current.set(id, node);
		else handleElementsRef.current.delete(id);
		setRegistrationVersion((version) => version + 1);
	}, []);

	// Register the section as a drop target + auto-scroll zones
	React.useEffect(() => {
		const section = args.sectionRef.current;
		if (!section) return;
		const cleanupParts = [
			dropTargetForElements({
				element: section,
				canDrop: ({ source }) => isPragmaticDragData(source.data),
			}),
			autoScrollWindowForElements({
				canScroll: ({ source }) => isPragmaticDragData(source.data) && !isTouchDragPolyfillActive(),
			}),
		];

		if (isScrollableElement(section)) {
			cleanupParts.push(
				autoScrollForElements({
					element: section,
					canScroll: ({ source }) => isPragmaticDragData(source.data) && !isTouchDragPolyfillActive(),
				})
			);
		}

		return combine(
			...cleanupParts
		);
	}, [args.sectionRef, registrationVersion]);

	// Register each card as draggable
	React.useEffect(() => {
		const cleanups: Array<() => void> = [];
		for (const [id, itemElement] of itemElementsRef.current) {
			const dragHandle = handleElementsRef.current.get(id) ?? null;
			cleanups.push(
				draggable({
					element: itemElement,
					dragHandle: dragHandle ?? undefined,
					canDrag: () => canStartDragRef.current(),
					getInitialData: () => ({ type: DRAG_TYPE, noteId: id }),
					onGenerateDragPreview: ({ nativeSetDragImage }) => {
						disableNativeDragPreview({ nativeSetDragImage });
					},
				})
			);
		}
		return () => {
			for (const cleanup of cleanups) cleanup();
		};
	}, [registrationVersion]);

	// Global drag monitor
	React.useEffect(() => {
		const cleanup = monitorForElements({
			canMonitor: ({ source }) => isPragmaticDragData(source.data),
			onDragStart: (event: any) => {
				const data = isPragmaticDragData(event.source.data) ? event.source.data : null;
				if (!data) return;
				const activeId = normalizeId(data.noteId);
				const element = itemElementsRef.current.get(activeId);
				if (!element) return;
				const rect = element.getBoundingClientRect();
				const input = event.location.current.input as PointerInput;
				activeDragIdRef.current = activeId;
				pointerOffsetRef.current = {
					x: input.clientX - rect.left,
					y: input.clientY - rect.top,
				};
				previewSizeRef.current = { width: rect.width, height: rect.height };
				setActiveDragId(activeId);
				setIsTouchDragging(isTouchDragCandidateRef.current());
				setDragOverlay({
					id: activeId,
					left: input.clientX - pointerOffsetRef.current.x,
					top: input.clientY - pointerOffsetRef.current.y,
					width: previewSizeRef.current.width,
					height: previewSizeRef.current.height,
				});
				updateInsertionPoint(input);
			},
			onDrag: (event: any) => {
				const activeId = activeDragIdRef.current;
				if (!activeId) return;
				const pointer = event.location.current.input as PointerInput;
				setDragOverlay({
					id: activeId,
					left: pointer.clientX - pointerOffsetRef.current.x,
					top: pointer.clientY - pointerOffsetRef.current.y,
					width: previewSizeRef.current.width,
					height: previewSizeRef.current.height,
				});
				updateInsertionPoint(pointer);
			},
			onDrop: () => {
				const activeId = activeDragIdRef.current;
				const ip = insertionPointRef.current;

				if (!activeId || !ip) return;

				// Build the final column layout with the dragged card spliced into
				// the insertion point.  Compare column layouts — not the flat
				// reading order — to decide whether the drop is a no-op.  With
				// height-based masonry packing, a cross-column move can produce
				// the same row-major flat order (e.g. moving a tall card from
				// col 0 to col 1 leaves the interleaved reading order unchanged)
				// even though the visual layout clearly changed.
				const finalColumns = insertIntoColumns(columnsRef.current, activeId, ip.column, ip.index);
				const originalColumns = columnsRef.current;
				const columnsChanged =
					finalColumns.length !== originalColumns.length ||
					finalColumns.some((col, i) => !arraysEqual(col, originalColumns[i]));
				if (!columnsChanged) {
					clearDragState();
					return;
				}

				const draggedElement = itemElementsRef.current.get(activeId);
				const draggedHeight = Math.max(
					0,
					Math.round(draggedElement?.getBoundingClientRect().height ?? previewSizeRef.current.height)
				);
				onCommitOrderRef.current(finalColumns, activeId, draggedHeight);
				// Clear drag state after scheduling the committed layout so React can
				// transition directly from the live preview into the final grid state
				// instead of briefly re-rendering the pre-drop base columns.
				clearDragState();
			},
		});
		return () => {
			cleanup();
			clearDragState();
		};
	}, [clearDragState, updateInsertionPoint]);

	// Cancel drag if the active card disappears from the list
	React.useEffect(() => {
		if (!activeDragId) return;
		if (args.visibleIds.includes(activeDragId)) return;
		clearDragState();
	}, [activeDragId, args.visibleIds, clearDragState]);

	// Cleanup on unmount
	React.useEffect(() => {
		return () => { clearDragState(); };
	}, [clearDragState]);

	// Compute preview columns: the current column layout with the dragged card
	// relocated to the live insertion point.  NoteGrid renders these columns
	// instead of the base columns during a drag, and framer-motion's `layout`
	// prop automatically animates the position changes (neighbors sliding apart
	// to make room, placeholder holding the original space).
	const previewColumns = React.useMemo<string[][] | null>(() => {
		if (!activeDragId || !insertionPoint) return null;
		return insertIntoColumns(args.columns, activeDragId, insertionPoint.column, insertionPoint.index);
	}, [activeDragId, insertionPoint, args.columns]);

	return {
		activeDragId,
		isTouchDragging,
		dragOverlay,
		previewColumns,
		setItemElement,
		setHandleElement,
		cancelDrag: clearDragState,
	};
}
