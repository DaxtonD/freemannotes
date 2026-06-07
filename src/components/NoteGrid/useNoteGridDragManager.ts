import React from 'react';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { disableNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview';
import { autoScrollForElements, autoScrollWindowForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { createPointerEdgeAutoScroller, getClosestVerticalScrollContainer } from './autoScroll';
import { isTouchDragPolyfillActive } from '../../core/touchDragPolyfill';
import { arraysEqual, findInsertionPoint, insertIntoColumns } from './layout';
import { debugDragEnd, debugDragStart } from './gridDebug';

type DragOverlayState = {
	id: string;
	left: number;
	top: number;
	width: number;
	height: number;
	settleTo?: {
		left: number;
		top: number;
		width: number;
		height: number;
	} | null;
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
	onTouchDropCommit?: () => void;
	insertionSettleMs?: number;
	usePointerEdgeAutoScroll?: boolean;
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

function getMinDragTop(sectionRef: React.RefObject<HTMLElement | null>): number {
	if (typeof window === 'undefined') return 0;
	const scope = document.querySelector<HTMLElement>('.note-grid-scope');
	if (scope) {
		const rect = scope.getBoundingClientRect();
		// Keep the dragged card anchored below the scope row (All notes / workspace)
		// so touch drags cannot carry cards into the header area.
		return rect.top;
	}
	const section = sectionRef.current;
	if (section) {
		return section.getBoundingClientRect().top;
	}
	return 0;
}

function clamp(value: number, min: number, max: number): number {
	if (value < min) return min;
	if (value > max) return max;
	return value;
}

export type DragManagerResult = {
	activeDragId: string | null;
	isTouchDragging: boolean;
	dragOverlay: DragOverlayState | null;
	dropOverlay: DragOverlayState | null;
	/** Columns with the dragged card relocated to the insertion point. null when not dragging. */
	previewColumns: string[][] | null;
	/** Increments each time a card item or handle element is registered or unregistered. */
	registrationVersion: number;
	setItemElement: (id: string, node: HTMLDivElement | null) => void;
	setHandleElement: (id: string, node: HTMLDivElement | null) => void;
	getItemElement: (id: string) => HTMLDivElement | null;
	shouldSuppressOpen: () => boolean;
	clearDropOverlay: () => void;
	startTouchDrag: (id: string, input: PointerInput) => boolean;
	updateTouchDrag: (input: PointerInput) => void;
	finishTouchDrag: () => void;
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
	const registrationVersionRafRef = React.useRef<number>(0);
	const [activeDragId, setActiveDragId] = React.useState<string | null>(null);
	const [dragOverlay, setDragOverlay] = React.useState<DragOverlayState | null>(null);
	const [dropOverlay, setDropOverlay] = React.useState<DragOverlayState | null>(null);
	const [insertionPoint, setInsertionPoint] = React.useState<InsertionPoint | null>(null);
	const [isTouchDragging, setIsTouchDragging] = React.useState(false);
	const activeDragIdRef = React.useRef<string | null>(null);
	const dragOverlayRef = React.useRef<DragOverlayState | null>(null);
	const dropOverlayTimerRef = React.useRef<number>(0);
	const dropOverlayTrackingRafRef = React.useRef<number>(0);
	const visibleIdsRef = React.useRef<string[]>(args.visibleIds);
	const columnsRef = React.useRef<string[][]>(args.columns);
	const canStartDragRef = React.useRef(args.canStartDrag);
	const isTouchDragCandidateRef = React.useRef(args.isTouchDragCandidate);
	const onCommitOrderRef = React.useRef(args.onCommitOrder);
	const onTouchDropCommitRef = React.useRef(args.onTouchDropCommit);
	const insertionSettleMsRef = React.useRef(args.insertionSettleMs ?? 280);
	const usePointerEdgeAutoScrollRef = React.useRef(Boolean(args.usePointerEdgeAutoScroll));
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
	const touchDragSessionRef = React.useRef(false);
	const suppressOpenUntilRef = React.useRef(0);
	const lastPointerRef = React.useRef<PointerInput | null>(null);
	const edgeAutoScrollerRef = React.useRef<ReturnType<typeof createPointerEdgeAutoScroller> | null>(null);

	const scheduleRegistrationRefresh = React.useCallback((): void => {
		if (typeof window === 'undefined') {
			setRegistrationVersion((version) => version + 1);
			return;
		}
		if (registrationVersionRafRef.current !== 0) return;
		registrationVersionRafRef.current = window.requestAnimationFrame(() => {
			registrationVersionRafRef.current = 0;
			setRegistrationVersion((version) => version + 1);
		});
	}, []);

	visibleIdsRef.current = args.visibleIds;
	columnsRef.current = args.columns;
	canStartDragRef.current = args.canStartDrag;
	isTouchDragCandidateRef.current = args.isTouchDragCandidate;
	onCommitOrderRef.current = args.onCommitOrder;
	onTouchDropCommitRef.current = args.onTouchDropCommit;
	insertionSettleMsRef.current = args.insertionSettleMs ?? 280;
	usePointerEdgeAutoScrollRef.current = Boolean(args.usePointerEdgeAutoScroll);

	const getRectForId = React.useCallback((id: string): DOMRect | null => {
		return itemElementsRef.current.get(id)?.getBoundingClientRect() ?? null;
	}, []);

	/**
	 * Returns the live DOMRect for a column container element.
	 * The grid element holds one direct child per column; we index into
	 * grid.children to get the column element and read its bounding rect.
	 *
	 * This is passed into findInsertionPoint as getColumnRect and is used
	 * for both column-selection (horizontal) and viewport-bias (cross-column
	 * vertical) calculations. Reads happen during the pointer-move handler so
	 * rect values are always current (not cached).
	 */
	const getColumnRect = React.useCallback((columnIndex: number): DOMRect | null => {
		const grid = args.gridRef.current;
		if (!grid) return null;
		const colEl = grid.children[columnIndex] as HTMLElement | undefined;
		return colEl?.getBoundingClientRect() ?? null;
	}, [args.gridRef]);

	/**
	 * Returns the top and bottom of the grid scroll container (sectionRef).
	 * Used by findInsertionPoint to compute the visibility-biased midpoint for
	 * destination cards that are partially clipped near the grid's edges.
	 *
	 * Only called during cross-column drags; returns null if the section
	 * element is unavailable (treated as "no bias" by getVisibilityBiasedMidY).
	 */
	const getViewportRect = React.useCallback((): Pick<DOMRect, 'top' | 'bottom'> | null => {
		return args.sectionRef.current?.getBoundingClientRect() ?? null;
	}, [args.sectionRef]);

	/**
	 * Core hit-test function called on every pointer-move during a drag.
	 *
	 * WHAT IT COMPUTES:
	 *   ghostTopY / ghostBottomY  — the vertical extent of the visual ghost
	 *     overlay.  Derived from the live pointer minus the initial grab offset
	 *     (pointerOffsetRef), so the ghost always tracks where the user's
	 *     finger grabbed the card header.
	 *
	 *   dragAnchorX / dragAnchorY — the raw pointer position (pointer.clientX,
	 *     pointer.clientY). Passed directly as the drag anchor for cross-column
	 *     targeting.  NOT adjusted by pointerOffset.
	 *
	 * WHY THE SPLIT:
	 *   Same-column ordering uses ghostTopY / ghostBottomY so it keeps the
	 *   proven "leading-edge crosses neighbour midpoint" feel.
	 *
	 *   Cross-column ordering uses the raw anchor point so the destination
	 *   column behaves like a simple vertical list driven by the finger position
	 *   and is completely independent of the dragged card's height. See the
	 *   design notes in findInsertionPoint (layout.ts) for the full rationale.
	 *
	 * COOLDOWN:
	 *   insertionCooldownRef guards against running a new hit-test within
	 *   insertionSettleMsRef.current ms of the last insertion-point change.
	 *   framer-motion's spring animation transiently displaces card rects during
	 *   those ~280 ms; re-running the test against mid-animation positions
	 *   causes the insertion point to flicker back to its previous value
	 *   ("oscillation"). The cooldown prevents that without any extra geometric
	 *   logic inside findInsertionPoint itself.
	 */
	const updateInsertionPoint = React.useCallback(
		(pointer: PointerInput): void => {
			const activeId = activeDragIdRef.current;
			if (!activeId) return;
			// Cooldown: skip while framer-motion is still animating card positions
			// after the last insertion-point change (prevents rect-read oscillation).
			if (Date.now() < insertionCooldownRef.current) return;

			// Ghost overlay bounds — used only by the same-column leading-edge test.
			const ghostTopY = pointer.clientY - pointerOffsetRef.current.y;
			const ghostBottomY = ghostTopY + previewSizeRef.current.height;

			// dragAnchorX / dragAnchorY are the raw pointer coords passed straight
			// through to findInsertionPoint for cross-column column detection and
			// cross-column row insertion. They are NOT offset-adjusted because the
			// anchor represents "where the user's finger is", not "where the card
			// top-left is".
			const ip = findInsertionPoint(
				columnsRef.current,
				activeId,
				ghostTopY,
				ghostBottomY,
				pointer.clientX,    // drag anchor X: raw pointer, not ghost left edge
				pointer.clientY,    // drag anchor Y: raw pointer, not ghost top edge
				getRectForId,
				getColumnRect,
				getViewportRect
			);
			if (!ip) return;
			const sourceColumn = columnsRef.current.findIndex((column) => column.includes(activeId));
			const isCrossColumnInsertion = sourceColumn >= 0 && ip.column !== sourceColumn;
			const prev = insertionPointRef.current;
			// No-op if the resolved insertion point hasn't changed.
			if (prev && prev.column === ip.column && prev.index === ip.index) return;
			insertionPointRef.current = ip;
			// Arm the cooldown before triggering the React state update so the
			// next pointer-move event that arrives during framer-motion's spring
			// is skipped. Cross-column touch insertions need a shorter guard than
			// the full masonry settle window, otherwise the dragged card appears to
			// freeze as soon as the destination column begins its neighbour shift.
			// Keep the full cooldown for same-column reorders so they retain their
			// proven anti-oscillation behavior.
			const cooldownMs = touchDragSessionRef.current && isCrossColumnInsertion
				? Math.min(96, Math.max(0, insertionSettleMsRef.current))
				: Math.max(0, insertionSettleMsRef.current);
			insertionCooldownRef.current = Date.now() + cooldownMs;
			setInsertionPoint({ column: ip.column, index: ip.index });
		},
		[getRectForId, getColumnRect, getViewportRect]
	);

	const computeOverlayTop = React.useCallback((pointer: PointerInput): number => {
		const rawTop = pointer.clientY - pointerOffsetRef.current.y;
		const minTop = getMinDragTop(args.sectionRef);
		return Math.max(rawTop, minTop);
	}, [args.sectionRef]);

	const computeOverlayLeft = React.useCallback((pointer: PointerInput): number => {
		const rawLeft = pointer.clientX - pointerOffsetRef.current.x;
		const section = args.sectionRef.current;
		if (!section) return rawLeft;
		const rect = section.getBoundingClientRect();
		const maxLeft = Math.max(rect.left, rect.right - previewSizeRef.current.width);
		return clamp(rawLeft, rect.left, maxLeft);
	}, [args.sectionRef]);

	const clearDragState = React.useCallback((): void => {
		activeDragIdRef.current = null;
		insertionPointRef.current = null;
		insertionCooldownRef.current = 0;
		touchDragSessionRef.current = false;
		lastPointerRef.current = null;
		setActiveDragId(null);
		setDragOverlay(null);
		dragOverlayRef.current = null;
		setInsertionPoint(null);
		setIsTouchDragging(false);
	}, []);

	const clearDropOverlay = React.useCallback((): void => {
		if (dropOverlayTrackingRafRef.current && typeof window !== 'undefined') {
			window.cancelAnimationFrame(dropOverlayTrackingRafRef.current);
			dropOverlayTrackingRafRef.current = 0;
		}
		if (dropOverlayTimerRef.current && typeof window !== 'undefined') {
			window.clearTimeout(dropOverlayTimerRef.current);
			dropOverlayTimerRef.current = 0;
		}
		setDropOverlay(null);
	}, []);

	const startDropOverlaySettle = React.useCallback((activeId: string, overlay: DragOverlayState | null): void => {
		if (!overlay) return;
		clearDropOverlay();
		const baseTarget = {
			left: overlay.left,
			top: overlay.top,
			width: overlay.width,
			height: overlay.height,
		};
		setDropOverlay({
			...overlay,
			settleTo: baseTarget,
		});
		if (typeof window === 'undefined') return;
		// Follow the committed card's live rect for a short settle window so drops
		// that land during neighbour motion animate with the card instead of aiming
		// at a stale pre-commit measurement.
		const trackTarget = (): void => {
			const rect = itemElementsRef.current.get(activeId)?.getBoundingClientRect() ?? null;
			if (rect && rect.width > 0 && rect.height > 0) {
				setDropOverlay((current) => {
					if (!current || current.id !== activeId) return current;
					return {
						...current,
						settleTo: {
							left: rect.left,
							top: rect.top,
							width: rect.width,
							height: rect.height,
						},
					};
				});
			}
			dropOverlayTrackingRafRef.current = window.requestAnimationFrame(trackTarget);
		};
		dropOverlayTrackingRafRef.current = window.requestAnimationFrame(trackTarget);
		dropOverlayTimerRef.current = window.setTimeout(() => {
			dropOverlayTimerRef.current = 0;
			clearDropOverlay();
		}, 320);
	}, [clearDropOverlay]);

	const shouldSuppressOpen = React.useCallback((): boolean => {
		return Date.now() < suppressOpenUntilRef.current;
	}, []);

	const finalizeTouchDrop = React.useCallback((): void => {
		if (!touchDragSessionRef.current) return;
		suppressOpenUntilRef.current = Date.now() + 400;
		onTouchDropCommitRef.current?.();
	}, []);

	const beginManagedDrag = React.useCallback((activeId: string, input: PointerInput, isTouchDrag: boolean): boolean => {
		clearDropOverlay();
		const element = itemElementsRef.current.get(activeId);
		if (!element) return false;
		const rect = element.getBoundingClientRect();
		activeDragIdRef.current = activeId;
		touchDragSessionRef.current = isTouchDrag;
		pointerOffsetRef.current = {
			x: input.clientX - rect.left,
			y: input.clientY - rect.top,
		};
		lastPointerRef.current = input;
		previewSizeRef.current = { width: rect.width, height: rect.height };
		setActiveDragId(activeId);
		setIsTouchDragging(isTouchDrag);
		const overlayLeft = computeOverlayLeft(input);
		const overlayTop = computeOverlayTop(input);
		setDragOverlay({
			id: activeId,
			left: overlayLeft,
			top: overlayTop,
			width: previewSizeRef.current.width,
			height: previewSizeRef.current.height,
			settleTo: null,
		});
		dragOverlayRef.current = {
			id: activeId,
			left: overlayLeft,
			top: overlayTop,
			width: previewSizeRef.current.width,
			height: previewSizeRef.current.height,
			settleTo: null,
		};
		debugDragStart(activeId);
		if (isTouchDrag || usePointerEdgeAutoScrollRef.current) {
			edgeAutoScrollerRef.current?.start();
		}
		updateInsertionPoint(input);
		return true;
	}, [clearDropOverlay, computeOverlayLeft, computeOverlayTop, updateInsertionPoint]);

	const updateManagedDrag = React.useCallback((pointer: PointerInput): void => {
		const activeId = activeDragIdRef.current;
		if (!activeId) return;
		lastPointerRef.current = pointer;
		const overlayLeft = computeOverlayLeft(pointer);
		const overlayTop = computeOverlayTop(pointer);
		setDragOverlay({
			id: activeId,
			left: overlayLeft,
			top: overlayTop,
			width: previewSizeRef.current.width,
			height: previewSizeRef.current.height,
			settleTo: null,
		});
		dragOverlayRef.current = {
			id: activeId,
			left: overlayLeft,
			top: overlayTop,
			width: previewSizeRef.current.width,
			height: previewSizeRef.current.height,
			settleTo: null,
		};
		updateInsertionPoint(pointer);
	}, [computeOverlayLeft, computeOverlayTop, updateInsertionPoint]);

	const finishManagedDrag = React.useCallback((): void => {
		edgeAutoScrollerRef.current?.stop();
		const activeId = activeDragIdRef.current;
		const ip = insertionPointRef.current;
		if (activeId) debugDragEnd(activeId);

		if (!activeId || !ip) {
			finalizeTouchDrop();
			clearDragState();
			return;
		}

		const finalColumns = insertIntoColumns(columnsRef.current, activeId, ip.column, ip.index);
		const originalColumns = columnsRef.current;
		const columnsChanged =
			finalColumns.length !== originalColumns.length ||
			finalColumns.some((col, i) => !arraysEqual(col, originalColumns[i]));
		if (!columnsChanged) {
			startDropOverlaySettle(activeId, dragOverlayRef.current ? { ...dragOverlayRef.current } : null);
			finalizeTouchDrop();
			clearDragState();
			return;
		}

		const draggedHeight = Math.max(
			0,
			Math.round(itemElementsRef.current.get(activeId)?.getBoundingClientRect().height ?? previewSizeRef.current.height)
		);
		startDropOverlaySettle(activeId, dragOverlayRef.current ? { ...dragOverlayRef.current } : null);
		onCommitOrderRef.current(finalColumns, activeId, draggedHeight);
		finalizeTouchDrop();
		clearDragState();
	}, [clearDragState, finalizeTouchDrop, startDropOverlaySettle]);

	const cancelManagedDrag = React.useCallback((): void => {
		edgeAutoScrollerRef.current?.stop();
		clearDragState();
	}, [clearDragState]);

	const setItemElement = React.useCallback((id: string, node: HTMLDivElement | null): void => {
		const previous = itemElementsRef.current.get(id) ?? null;
		if (previous === node) return;
		if (node) itemElementsRef.current.set(id, node);
		else itemElementsRef.current.delete(id);
		// Registration version lets the grid re-bind drag handles and re-measure
		// cards when virtualization mounts or unmounts DOM nodes.
		scheduleRegistrationRefresh();
	}, [scheduleRegistrationRefresh]);

	const setHandleElement = React.useCallback((id: string, node: HTMLDivElement | null): void => {
		const previous = handleElementsRef.current.get(id) ?? null;
		if (previous === node) return;
		if (node) handleElementsRef.current.set(id, node);
		else handleElementsRef.current.delete(id);
		scheduleRegistrationRefresh();
	}, [scheduleRegistrationRefresh]);

	const getItemElement = React.useCallback((id: string): HTMLDivElement | null => {
		return itemElementsRef.current.get(id) ?? null;
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
		];

		if (!usePointerEdgeAutoScrollRef.current) {
			cleanupParts.push(
				autoScrollWindowForElements({
					canScroll: ({ source }) => isPragmaticDragData(source.data) && !isTouchDragPolyfillActive(),
				})
			);

			if (isScrollableElement(section)) {
				cleanupParts.push(
					autoScrollForElements({
						element: section,
						canScroll: ({ source }) => isPragmaticDragData(source.data) && !isTouchDragPolyfillActive(),
					})
				);
			}
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
		const edgeAutoScroller = createPointerEdgeAutoScroller({
			getPointerInput: () => lastPointerRef.current,
			getScrollContainer: () => getClosestVerticalScrollContainer(args.sectionRef.current),
			edgePx: 88,
			minSpeedPxPerSecond: 90,
			maxSpeedPxPerSecond: 1500,
			onDidScroll: () => {
				const pointer = lastPointerRef.current;
				if (!pointer) return;
				updateInsertionPoint(pointer);
			},
		});
		edgeAutoScrollerRef.current = edgeAutoScroller;
		const cleanup = monitorForElements({
			canMonitor: ({ source }) => isPragmaticDragData(source.data),
			onDragStart: (event: any) => {
				const data = isPragmaticDragData(event.source.data) ? event.source.data : null;
				if (!data) return;
				const activeId = normalizeId(data.noteId);
				const input = event.location.current.input as PointerInput;
				const isTouchDrag = isTouchDragCandidateRef.current();
				beginManagedDrag(activeId, input, isTouchDrag);
			},
			onDrag: (event: any) => {
				const pointer = event.location.current.input as PointerInput;
				updateManagedDrag(pointer);
			},
			onDrop: () => {
				finishManagedDrag();
			},
		});
		return () => {
			edgeAutoScroller.stop();
			edgeAutoScrollerRef.current = null;
			cleanup();
			clearDragState();
		};
	}, [beginManagedDrag, clearDragState, finishManagedDrag, updateManagedDrag]);

	// Cancel drag if the active card disappears from the list
	React.useEffect(() => {
		if (!activeDragId) return;
		if (args.visibleIds.includes(activeDragId)) return;
		clearDragState();
	}, [activeDragId, args.visibleIds, clearDragState]);

	// Cleanup on unmount
	React.useEffect(() => {
		return () => {
			if (typeof window !== 'undefined' && registrationVersionRafRef.current !== 0) {
				window.cancelAnimationFrame(registrationVersionRafRef.current);
				registrationVersionRafRef.current = 0;
			}
			clearDropOverlay();
			clearDragState();
		};
	}, [clearDragState, clearDropOverlay]);

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
		dropOverlay,
		previewColumns,
		registrationVersion,
		setItemElement,
		setHandleElement,
		getItemElement,
		shouldSuppressOpen,
		clearDropOverlay,
		startTouchDrag: (id, input) => beginManagedDrag(id, input, true),
		updateTouchDrag: updateManagedDrag,
		finishTouchDrag: finishManagedDrag,
		cancelDrag: cancelManagedDrag,
	};
}
