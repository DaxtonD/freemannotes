import React from 'react';
import type * as Y from 'yjs';
import {
	closestCenter,
	DndContext,
	DragOverlay,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from '@dnd-kit/core';
import {
	SortableContext,
	defaultAnimateLayoutChanges,
	rectSwappingStrategy,
	useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { NoteCard } from '../NoteCard/NoteCard';
import { useDocumentManager } from '../../core/DocumentManagerContext';
import { runNoteGuards } from '../../core/devGuards';
import { useI18n } from '../../core/i18n';
import { readTrashState } from '../../core/noteModel';
import { useConnectionStatus } from '../../core/useConnectionStatus';
import styles from './NoteGrid.module.css';

type Note = { id: string };

export type NoteGridProps = {
	selectedNoteId: string | null;
	onSelectNote: (noteId: string) => void;
	maxCardHeightPx: number;
};

type YArrayWithDoc<T> = Y.Array<T> & { doc: Y.Doc };

// Normalize all IDs flowing through DnD + Yjs so comparisons are stable.
function normalizeId(value: unknown): string {
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function uniqueIds(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const id = normalizeId(value);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

function readRegistryIds(notesList: Y.Array<Y.Map<unknown>>): string[] {
	return uniqueIds(notesList.toArray().map((item) => normalizeId(item.get('id'))));
}

function readOrderIds(noteOrder: Y.Array<string>): string[] {
	return uniqueIds(noteOrder.toArray().map((id) => normalizeId(id)));
}

function ensureOrderContainsAllRegistryIds(noteOrder: Y.Array<string>, registryIds: readonly string[]): void {
	const current = new Set(readOrderIds(noteOrder));
	const missing = registryIds.filter((id) => !current.has(id));
	if (missing.length === 0) return;

	const ydoc = (noteOrder as YArrayWithDoc<string>).doc;
	ydoc.transact(() => {
		noteOrder.insert(noteOrder.length, missing);
	});
}

// Reads px-valued CSS custom properties from :root.
// Example: change global default card width in src/styles/variables.css via --note-card-width.
function readCssPxVariable(name: string, fallback: number): number {
	if (typeof window === 'undefined') return fallback;
	const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	const parsed = Number.parseFloat(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
}

// Mobile detector is intentionally conservative to avoid treating resized desktop windows as mobile.
function isMobileLikeDevice(viewportWidth: number): boolean {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') return viewportWidth < 768;
	const nav = navigator as Navigator & {
		userAgentData?: { mobile?: boolean };
	};
	const byUaData = Boolean(nav.userAgentData?.mobile);
	const byAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
	return byUaData || byAgent;
}

// Central layout policy for NoteGrid.
// This is the primary place to adjust:
// - Desktop vs mobile column behavior
// - Portrait/landscape differences
// - Runtime card width overrides (currently mobile-only)
function getGridLayoutForViewport(
	containerWidth: number,
	viewportWidth: number,
	viewportHeight: number
): {
	columnCount: number;
	mobileCardWidthPx: number | null;
	mobileGapPx: number | null;
	mobileSectionBleedPx: number;
} {
	// Desktop/base card width token (fixed-width cards by design).
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
			// Portrait mobile branch: tighter gap increases visible note density and
			// aligns with edge-to-edge card presentation used in current editor UX.
			mobileGapPx = 4;
			const desiredEdgeMargin = 4;
			mobileSectionBleedPx = Math.max(0, Math.round(appSidePadding - desiredEdgeMargin));
		}
		// Use stable short side for mobile sizing so browser chrome show/hide while scrolling
		// does not cause width jitter (especially in mobile landscape).
		const stableShortSide =
			typeof window !== 'undefined' && typeof window.screen !== 'undefined'
				? Math.min(window.screen.width, window.screen.height)
				: Math.min(viewportWidth, viewportHeight);
		// Keep card width consistent between portrait and landscape on mobile.
		const effectiveContainerWidth = containerWidth + mobileSectionBleedPx * 2;
		const twoColumnBasis = Math.min(effectiveContainerWidth, stableShortSide);
		mobileCardWidthPx = Math.max(140, Math.floor((twoColumnBasis - (mobileGapPx ?? gap)) / 2));
	}

	// Effective width is either fixed desktop token or mobile override.
	const effectiveCardWidth = mobileCardWidthPx ?? noteCardWidth;
	const effectiveGap = mobileGapPx ?? gap;
	const maxByWidth = Math.max(1, Math.floor((containerWidth + effectiveGap) / (effectiveCardWidth + effectiveGap)));

	// Portrait mobile is explicitly locked to 2 columns to maximize visible content density.
	if (mobileCardWidthPx !== null && isPortrait) {
		return { columnCount: 2, mobileCardWidthPx, mobileGapPx, mobileSectionBleedPx };
	}

	return { columnCount: maxByWidth, mobileCardWidthPx, mobileGapPx, mobileSectionBleedPx };
}

// Swap semantics: only active + over IDs exchange positions.
function swapIds(ids: readonly string[], activeId: string, overId: string): string[] {
	const activeIndex = ids.indexOf(activeId);
	const overIndex = ids.indexOf(overId);
	if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return ids.slice();
	const next = ids.slice();
	[next[activeIndex], next[overIndex]] = [next[overIndex], next[activeIndex]];
	return next;
}

// Deterministic column splitter that transforms linear order into equalized vertical columns.
function splitIntoColumns(ids: readonly string[], columnCount: number): string[][] {
	const cols = Math.max(1, columnCount);
	const total = ids.length;
	const base = Math.floor(total / cols);
	const extra = total % cols;
	const out: string[][] = [];
	let cursor = 0;
	for (let columnIndex = 0; columnIndex < cols; columnIndex++) {
		const size = base + (columnIndex < extra ? 1 : 0);
		out.push(ids.slice(cursor, cursor + size));
		cursor += size;
	}
	return out;
}

type SortableNoteCardProps = {
	note: Note;
	doc: Y.Doc;
	hasPendingSync: boolean;
	selected: boolean;
	onOpen: () => void;
	maxCardHeightPx: number;
};

function SortableNoteCard(props: SortableNoteCardProps): React.JSX.Element {
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
		useSortable({
			id: props.note.id,
			animateLayoutChanges: (args: any) =>
				defaultAnimateLayoutChanges({ ...args, wasDragging: true }),
		});

	const transformNoScale = transform ? { ...transform, scaleX: 1, scaleY: 1 } : null;
	const style: React.CSSProperties = {
		// Only the actively dragged item uses dnd-kit transform.
		// Non-active items animate through our FLIP pass in useLayoutEffect.
		transform: isDragging ? CSS.Transform.toString(transformNoScale) : undefined,
		transition: isDragging ? transition : undefined,
		opacity: isDragging ? 0 : 1,
		zIndex: isDragging ? 1 : 0,
	};

	return (
		<div ref={setNodeRef} style={style} className={styles.item} data-note-id={props.note.id}>
			<div data-note-content="true" className={props.selected ? styles.itemSelected : undefined}>
				<NoteCard
					noteId={props.note.id}
					doc={props.doc}
					hasPendingSync={props.hasPendingSync}
					maxCardHeightPx={props.maxCardHeightPx}
					onOpen={props.onOpen}
					dragHandleRef={setActivatorNodeRef}
					dragHandleProps={{ ...attributes, ...listeners }}
				/>
			</div>
		</div>
	);
}

export function NoteGrid(props: NoteGridProps): React.JSX.Element {
	const { t } = useI18n();
	// DnD state: active item, overlay size, and live in-drag order.
	const [dndContextKey, setDndContextKey] = React.useState(0);
	const [activeDragId, setActiveDragId] = React.useState<string | null>(null);
	const [activeDragSize, setActiveDragSize] = React.useState<{ width: number; height: number } | null>(null);
	const [dragOrderIds, setDragOrderIds] = React.useState<string[] | null>(null);
	// Tracks whether the currently active drag originated from a touch gesture.
	// This is intentionally separate from activeDragId because we need to decide when
	// browser-native touch behaviors (scrolling/overscroll) should be temporarily disabled.
	// Desktop drags should never pay this cost.
	const [isTouchDragging, setIsTouchDragging] = React.useState(false);
	// Captures and restores document-level touch-action/overscroll styles while a touch drag is active.
	// Chrome Android can continue attempting native scroll even after dnd activation, so we store the
	// exact inline style values and restore them verbatim on cleanup.
	const touchStartPointRef = React.useRef<{ x: number; y: number } | null>(null);
	const touchDragStyleRestoreRef = React.useRef<
		| {
				htmlTouchAction: string;
				htmlOverscrollBehavior: string;
				bodyTouchAction: string;
				bodyOverscrollBehavior: string;
		  }
		| null
	>(null);
	const lastOverIdRef = React.useRef<string | null>(null);
	const isTouchDragRef = React.useRef(false);
	const activeDragIdRef = React.useRef<string | null>(null);
	// Indicates that a touch began on a note card and could become a drag if no scroll intent appears.
	// This allows us to arbitrate "scroll intent vs drag intent" before dnd-kit's delayed activation fires.
	const pendingTouchIntentRef = React.useRef(false);
	const touchScrollDetectedRef = React.useRef(false);
	// Short-lived backoff that prevents delayed drag activation from "catching up" after the user
	// has already started scrolling. This specifically targets Chrome behavior where delayed activation
	// may still trigger shortly after a native scroll gesture begins.
	const suppressTouchDragUntilRef = React.useRef(0);
	const touchReorderUnlockedRef = React.useRef(false);
	// Skip the next FLIP pass immediately after drag activation to avoid pickup jitter where all cards
	// briefly animate as if a reflow happened before the drag settles.
	const skipNextFlipRef = React.useRef(false);
	const [columnCount, setColumnCount] = React.useState<number>(() => 2);
	// Mobile-only runtime width override. Null means use desktop/root --note-card-width.
	const [mobileCardWidthPx, setMobileCardWidthPx] = React.useState<number | null>(null);
	const [mobileGridGapPx, setMobileGridGapPx] = React.useState<number | null>(null);
	const [mobileSectionBleedPx, setMobileSectionBleedPx] = React.useState<number>(0);
	const sectionRef = React.useRef<HTMLElement | null>(null);
	const gridRef = React.useRef<HTMLDivElement | null>(null);
	// FLIP animation bookkeeping across renders.
	const layoutRectsRef = React.useRef<Map<string, DOMRect>>(new Map());
	const hasMeasuredLayoutRef = React.useRef(false);
	// Suppress startup animations after hard refresh to avoid "cards animating into place" flash.
	const suppressReflowAnimationsRef = React.useRef(true);
	const manager = useDocumentManager();
	const connection = useConnectionStatus();
	const pendingSyncNoteIds = React.useMemo(() => new Set(connection.pendingSyncNoteIds), [connection.pendingSyncNoteIds]);

	const [notesList, setNotesList] = React.useState<Y.Array<Y.Map<unknown>> | null>(null);
	const [noteOrder, setNoteOrder] = React.useState<Y.Array<string> | null>(null);
	const [docsById, setDocsById] = React.useState<Record<string, Y.Doc>>({});
	const docsByIdRef = React.useRef<Record<string, Y.Doc>>({});
	const pendingDocLoadsRef = React.useRef<Set<string>>(new Set());
	const versionRef = React.useRef(0);

	React.useEffect(() => {
		docsByIdRef.current = docsById;
	}, [docsById]);

	const recalculateColumnCount = React.useCallback((): void => {
		if (typeof window === 'undefined') return;
		// Use section width (not full window) so grid responds correctly inside parent layout containers.
		const containerWidth = sectionRef.current?.clientWidth ?? window.innerWidth;
		const next = getGridLayoutForViewport(containerWidth, window.innerWidth, window.innerHeight);
		setColumnCount((previous) => (previous === next.columnCount ? previous : next.columnCount));
		setMobileCardWidthPx((previous) => (previous === next.mobileCardWidthPx ? previous : next.mobileCardWidthPx));
		setMobileGridGapPx((previous) => (previous === next.mobileGapPx ? previous : next.mobileGapPx));
		setMobileSectionBleedPx((previous) => (previous === next.mobileSectionBleedPx ? previous : next.mobileSectionBleedPx));
	}, []);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		recalculateColumnCount();

		// After initial hydration, re-enable FLIP transitions for regular interactions/resizes.
		const hydrationTimer = window.setTimeout(() => {
			suppressReflowAnimationsRef.current = false;
		}, 900);

		const onResize = (): void => {
			recalculateColumnCount();
		};

		window.addEventListener('resize', onResize);
		window.addEventListener('orientationchange', onResize);

		const section = sectionRef.current;
		const observer = section ? new ResizeObserver(() => recalculateColumnCount()) : null;
		if (section && observer) observer.observe(section);

		return () => {
			window.clearTimeout(hydrationTimer);
			window.removeEventListener('resize', onResize);
			window.removeEventListener('orientationchange', onResize);
			observer?.disconnect();
		};
	}, [recalculateColumnCount]);

	React.useEffect(() => {
		activeDragIdRef.current = activeDragId;
	}, [activeDragId]);

	React.useEffect(() => {
		// Global scroll listener used only for pre-activation intent arbitration.
		// If the page scrolls before drag activation completes, we treat that gesture as scroll-first,
		// cancel pending drag activation by remounting DndContext, and apply a brief suppression window.
		// Capture phase ensures we observe scroll transitions consistently across browsers.
		const onScroll = (): void => {
			if (!pendingTouchIntentRef.current) return;
			if (activeDragIdRef.current) return;
			touchScrollDetectedRef.current = true;
			pendingTouchIntentRef.current = false;
			touchStartPointRef.current = null;
			suppressTouchDragUntilRef.current = Date.now() + 400;
			setDndContextKey((prev) => prev + 1);
		};

		window.addEventListener('scroll', onScroll, { passive: true, capture: true });
		return () => {
			window.removeEventListener('scroll', onScroll, true);
		};
	}, []);

	React.useEffect(() => {
		if (!isTouchDragging) return;
		if (typeof document === 'undefined') return;

		const html = document.documentElement;
		const body = document.body;
		touchDragStyleRestoreRef.current = {
			htmlTouchAction: html.style.touchAction,
			htmlOverscrollBehavior: html.style.overscrollBehavior,
			bodyTouchAction: body.style.touchAction,
			bodyOverscrollBehavior: body.style.overscrollBehavior,
		};
		html.style.touchAction = 'none';
		html.style.overscrollBehavior = 'none';
		body.style.touchAction = 'none';
		body.style.overscrollBehavior = 'none';

		const onTouchMove = (event: TouchEvent): void => {
			// Explicitly block native touch scroll while touch-drag is active.
			// This prevents "drag + page scroll" from running concurrently.
			event.preventDefault();
		};
		const onPointerMove = (event: PointerEvent): void => {
			if (event.pointerType !== 'touch') return;
			// Chrome may route movement through pointer events; prevent default here as well
			// so the drag remains the single source of motion during active touch-drag.
			event.preventDefault();
		};

		window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
		window.addEventListener('pointermove', onPointerMove, { passive: false, capture: true });
		return () => {
			window.removeEventListener('touchmove', onTouchMove, true);
			window.removeEventListener('pointermove', onPointerMove, true);

			const previous = touchDragStyleRestoreRef.current;
			if (!previous) return;
			html.style.touchAction = previous.htmlTouchAction;
			html.style.overscrollBehavior = previous.htmlOverscrollBehavior;
			body.style.touchAction = previous.bodyTouchAction;
			body.style.overscrollBehavior = previous.bodyOverscrollBehavior;
			touchDragStyleRestoreRef.current = null;
		};
	}, [isTouchDragging]);

	React.useEffect(() => {
		let cancelled = false;
		(async () => {
			const [list, order] = await Promise.all([manager.getNotesList(), manager.getNoteOrder()]);
			if (cancelled) return;
			setNotesList(list as unknown as Y.Array<Y.Map<unknown>>);
			setNoteOrder(order);
		})();
		return () => {
			cancelled = true;
		};
	}, [manager]);

	const subscribe = React.useCallback(
		(onStoreChange: () => void) => {
			if (!notesList || !noteOrder) return () => {};
			const onChange = (): void => {
				versionRef.current += 1;
				onStoreChange();
			};
			notesList.observeDeep(onChange);
			noteOrder.observe(onChange);
			return () => {
				notesList.unobserveDeep(onChange);
				noteOrder.unobserve(onChange);
			};
		},
		[notesList, noteOrder]
	);

	const getSnapshot = React.useCallback(() => versionRef.current, []);
	const storeVersion = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	// ── Observe per-note metadata changes (cross-tab trash reactivity) ────
	// The storeVersion counter only fires for registry/order array mutations.
	// Trashing modifies the *note's own* metadata Y.Map — which is a
	// separate Y.Doc from the registry. Without this observer, a remote
	// tab's trash operation would update the note doc silently and the
	// grid would never re-filter.
	//
	// We attach a Y.Map observer on each loaded doc's metadata. When any
	// metadata key changes (trashed, trashedAt, updatedAt, etc.), we bump
	// metadataVersion and visibleIds recomputes — removing or showing the
	// note without a page refresh.
	const [metadataVersion, setMetadataVersion] = React.useState(0);

	React.useEffect(() => {
		const entries = Object.entries(docsById);
		if (entries.length === 0) return;

		const cleanups: (() => void)[] = [];
		for (const [, doc] of entries) {
			const metadata = doc.getMap('metadata');
			const handler = (): void => {
				setMetadataVersion((v) => v + 1);
			};
			metadata.observe(handler);
			cleanups.push(() => metadata.unobserve(handler));
		}
		return () => {
			for (const cleanup of cleanups) cleanup();
		};
	}, [docsById]);

	const orderedIds = React.useMemo<string[]>(() => {
		if (!noteOrder) return [];
		return readOrderIds(noteOrder);
	}, [noteOrder, storeVersion]);

	// ── Filter out trashed notes from the main grid ──────────────────────
	// The trash state lives in each note's Yjs metadata map. Docs are lazy-loaded,
	// so a note whose doc hasn't loaded yet is assumed to be NOT trashed (it will
	// be re-evaluated once its doc arrives and docsById is updated). This prevents
	// a flash of trashed cards that would vanish once the doc loads.
	const visibleIds = React.useMemo<string[]>(() => {
		return orderedIds.filter((id) => {
			const doc = docsById[id];
			if (!doc) return true; // doc not loaded yet → show until we know
			return !readTrashState(doc).trashed;
		});
	}, [orderedIds, docsById, metadataVersion]);

	const renderedIds = dragOrderIds ?? visibleIds;
	const orderedNotes = React.useMemo<Note[]>(() => renderedIds.map((id) => ({ id })), [renderedIds]);
	const noteById = React.useMemo(() => {
		const map = new Map<string, Note>();
		for (const note of orderedNotes) {
			map.set(note.id, note);
		}
		return map;
	}, [orderedNotes]);
	const columns = React.useMemo(() => splitIntoColumns(renderedIds, columnCount), [renderedIds, columnCount]);

	React.useLayoutEffect(() => {
		const grid = gridRef.current;
		if (!grid) return;

		const nodes = Array.from(grid.querySelectorAll<HTMLElement>('[data-note-id]'));
		const nextRects = new Map<string, DOMRect>();

		for (const node of nodes) {
			const id = node.dataset.noteId;
			if (!id) continue;
			nextRects.set(id, node.getBoundingClientRect());
		}

		if (skipNextFlipRef.current) {
			skipNextFlipRef.current = false;
			layoutRectsRef.current = nextRects;
			return;
		}

		// First measurement seeds rect cache only; avoids bogus first-pass animation.
		if (!hasMeasuredLayoutRef.current) {
			hasMeasuredLayoutRef.current = true;
			layoutRectsRef.current = nextRects;
			return;
		}

		const flipDeltas: Array<{ node: HTMLElement; dx: number; dy: number }> = [];
		// FLIP for non-active cards (drag swaps + responsive reflow).
		for (const node of nodes) {
			const id = node.dataset.noteId;
			if (!id) continue;
			if (id === activeDragId) continue;

			const previous = layoutRectsRef.current.get(id);
			const current = nextRects.get(id);
			if (!previous || !current) continue;

			const dx = previous.left - current.left;
			const dy = previous.top - current.top;
			if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
			flipDeltas.push({ node, dx, dy });
		}

		const hasUniformGlobalShift =
			flipDeltas.length >= 2 &&
			flipDeltas.every(({ dx, dy }) => {
				const base = flipDeltas[0];
				return Math.abs(dx - base.dx) <= 1.5 && Math.abs(dy - base.dy) <= 1.5;
			});

		if (hasUniformGlobalShift) {
			for (const { node } of flipDeltas) {
				const content = (node.querySelector('[data-note-content="true"]') as HTMLElement | null) ?? node;
				content.style.transition = 'none';
				content.style.transform = 'translate(0px, 0px)';
			}
			layoutRectsRef.current = nextRects;
			return;
		}

		for (const { node, dx, dy } of flipDeltas) {

			const content = (node.querySelector('[data-note-content="true"]') as HTMLElement | null) ?? node;
			if (suppressReflowAnimationsRef.current) {
				// Explicitly disable transition during startup refresh/hydration window.
				content.style.transition = 'none';
				content.style.transform = 'translate(0px, 0px)';
				continue;
			}
			content.style.transition = 'none';
			content.style.transform = `translate(${dx}px, ${dy}px)`;
			void content.getBoundingClientRect();
			content.style.transition = 'transform 180ms ease-out';
			content.style.transform = 'translate(0px, 0px)';
		}

		layoutRectsRef.current = nextRects;
	}, [columns, docsById, activeDragId]);

	// ── Cross-tab drag cancellation ──────────────────────────────────────
	// If a note is deleted remotely (e.g. Tab B) while it is being dragged
	// here (Tab A), the Yjs noteOrder update will cause orderedIds to
	// re-derive without the deleted ID. This effect detects that the
	// actively-dragged note has disappeared from the CRDT-driven order and
	// immediately aborts the drag: clearing all transient drag state and
	// remounting DndContext via key increment to ensure dnd-kit's internal
	// sensor/overlay state is fully reset. No reorder is attempted.
	React.useEffect(() => {
		if (!activeDragId) return;
		const stillExists = visibleIds.includes(activeDragId);
		if (stillExists) return;

		// The dragged note was deleted/trashed remotely — abort the drag immediately.
		isTouchDragRef.current = false;
		pendingTouchIntentRef.current = false;
		touchScrollDetectedRef.current = false;
		touchStartPointRef.current = null;
		setIsTouchDragging(false);
		touchReorderUnlockedRef.current = false;
		skipNextFlipRef.current = false;
		setActiveDragId(null);
		setActiveDragSize(null);
		setDragOrderIds(null);
		lastOverIdRef.current = null;
		layoutRectsRef.current.clear();
		hasMeasuredLayoutRef.current = false;
		// Remount DndContext so dnd-kit drops all internal references to the
		// now-deleted/trashed item (active sensor, overlay node, collision rects).
		setDndContextKey((prev) => prev + 1);
	}, [activeDragId, visibleIds]);

	React.useEffect(() => {
		// Keep noteOrder CRDT in sync with registry: backfill missing IDs, remove
		// orphans (IDs in order but not registry), and deduplicate entries.
		if (!notesList || !noteOrder) return;
		const registryIds = readRegistryIds(notesList);
		const current = readOrderIds(noteOrder);

		// Bootstrap: if noteOrder is empty but registry has entries, seed it.
		if (current.length === 0 && registryIds.length > 0) {
			const ydoc = (noteOrder as YArrayWithDoc<string>).doc;
			ydoc.transact(() => {
				noteOrder.insert(0, registryIds);
			});
			return;
		}

		// Backfill any registry IDs that are missing from the order.
		ensureOrderContainsAllRegistryIds(noteOrder, registryIds);

		// ── Orphan cleanup ─────────────────────────────────────────────────
		// Remove noteOrder entries that reference IDs no longer in the registry.
		// This can happen if a note was deleted on another tab/device and the
		// registry deletion arrived before the order deletion.
		const registrySet = new Set(registryIds);
		const rawOrder = noteOrder.toArray();
		const orphanIndices: number[] = [];
		for (let i = rawOrder.length - 1; i >= 0; i--) {
			const id = normalizeId(rawOrder[i]);
			if (id && !registrySet.has(id)) {
				orphanIndices.push(i);
			}
		}
		if (orphanIndices.length > 0) {
			const ydoc = (noteOrder as YArrayWithDoc<string>).doc;
			ydoc.transact(() => {
				// Delete in reverse-index order to keep indices stable.
				for (const idx of orphanIndices) {
					noteOrder.delete(idx, 1);
				}
			});
		}

		// ── Duplicate cleanup ──────────────────────────────────────────────
		// If CRDT merges introduced duplicate entries in noteOrder, keep only
		// the first occurrence of each ID.
		const seen = new Set<string>();
		const dupeIndices: number[] = [];
		const dedupeOrder = noteOrder.toArray();
		for (let i = 0; i < dedupeOrder.length; i++) {
			const id = normalizeId(dedupeOrder[i]);
			if (seen.has(id)) {
				dupeIndices.push(i);
			} else {
				seen.add(id);
			}
		}
		if (dupeIndices.length > 0) {
			const ydoc = (noteOrder as YArrayWithDoc<string>).doc;
			ydoc.transact(() => {
				for (let i = dupeIndices.length - 1; i >= 0; i--) {
					noteOrder.delete(dupeIndices[i], 1);
				}
			});
		}
	}, [notesList, noteOrder, storeVersion]);

	// ── Dev-only structural integrity guards ─────────────────────────────
	// Run diagnostic checks whenever the registry/order/docs change during
	// development. These are tree-shaken in production builds via the
	// import.meta.env.DEV gate inside runNoteGuards.
	React.useEffect(() => {
		if (!notesList || !noteOrder) return;
		const registryIds = readRegistryIds(notesList);
		const orderIds = readOrderIds(noteOrder);
		runNoteGuards(registryIds, orderIds, docsById);
	}, [notesList, noteOrder, storeVersion, docsById]);

	React.useEffect(() => {
		// Lazy-load each note doc as it appears in order; cache loaded docs by noteId.
		//
		// IMPORTANT: We intentionally do NOT use a `cancelled` flag tied to the effect
		// cleanup here. When a remote note arrives via Yjs sync, multiple rapid observer
		// callbacks can cause this effect to re-run before the async `getDocWithSync`
		// promise resolves. If we set `cancelled = true` in cleanup, the original
		// promise would be silently discarded and `pendingDocLoadsRef` would incorrectly
		// gate any retry — permanently leaving the note stuck in "Loading…" state.
		//
		// Instead we rely on two safe dedup mechanisms:
		//   1. `pendingDocLoadsRef` prevents starting duplicate concurrent loads.
		//   2. The `setDocsById` functional updater is idempotent (prev[id] check).
		// React 19 silently ignores state updates on unmounted components, so there is
		// no risk of "set state after unmount" warnings.
		if (!noteOrder) return;
		for (const id of orderedIds) {
			if (docsByIdRef.current[id]) continue;
			if (pendingDocLoadsRef.current.has(id)) continue;
			pendingDocLoadsRef.current.add(id);
			void manager
				.getDocWithSync(id)
				.then((doc) => {
					setDocsById((prev) => (prev[id] ? prev : { ...prev, [id]: doc }));
				})
				.catch((err) => {
					console.error('[CRDT] Failed to load note doc:', id, err);
				})
				.finally(() => {
					pendingDocLoadsRef.current.delete(id);
				});
		}
	}, [manager, noteOrder, orderedIds]);

	const sensors = useSensors(
		useSensor(MouseSensor, {
			activationConstraint: { distance: 6 },
		}),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 220, tolerance: 10 },
		})
	);

	const onDragStart = React.useCallback((event: any) => {
		const activeId = normalizeId(event.active.id);
		const activatorType = String(event?.activatorEvent?.type ?? '').toLowerCase();
		isTouchDragRef.current = activatorType.startsWith('touch');
		if (isTouchDragRef.current && (touchScrollDetectedRef.current || Date.now() < suppressTouchDragUntilRef.current)) {
			touchScrollDetectedRef.current = false;
			pendingTouchIntentRef.current = false;
			touchStartPointRef.current = null;
			setDndContextKey((prev) => prev + 1);
			return;
		}
		pendingTouchIntentRef.current = false;
		touchStartPointRef.current = null;
		setIsTouchDragging(isTouchDragRef.current);
		if (isTouchDragRef.current && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
			navigator.vibrate(12);
		}
		touchReorderUnlockedRef.current = !isTouchDragRef.current;
		skipNextFlipRef.current = true;
		// Any user interaction after startup can safely use transitions.
		suppressReflowAnimationsRef.current = false;
		setActiveDragId(activeId);
		setDragOrderIds(visibleIds);
		lastOverIdRef.current = null;
		// Primary source: dnd-kit rect snapshot.
		const rect =
			((event.active.rect.current as any)?.initial as { width: number; height: number } | undefined) ??
			((event.active.rect.current as any)?.translated as { width: number; height: number } | undefined) ??
			((event.active.rect.current as any) as { width: number; height: number } | undefined);
		if (rect && Number.isFinite(rect.width) && Number.isFinite(rect.height)) {
			setActiveDragSize({ width: rect.width, height: rect.height });
			return;
		}

		// Fallback source: actual DOM node rect (important on some mobile/touch paths).
		const grid = gridRef.current;
		const draggedNode = grid
			? Array.from(grid.querySelectorAll<HTMLElement>('[data-note-id]')).find(
				(node) => node.dataset.noteId === activeId
			)
			: null;
		if (draggedNode) {
			const measured = draggedNode.getBoundingClientRect();
			if (Number.isFinite(measured.width) && Number.isFinite(measured.height)) {
				setActiveDragSize({ width: measured.width, height: measured.height });
				return;
			}
		}

		setActiveDragSize(null);
	}, [visibleIds]);

	const onDragMove = React.useCallback((event: any) => {
		if (!isTouchDragRef.current || touchReorderUnlockedRef.current) return;
		const dx = Number(event?.delta?.x ?? 0);
		const dy = Number(event?.delta?.y ?? 0);
		if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
		// Do not apply swap-over reorder updates until the touch drag has moved
		// enough to be intentional. This suppresses oscillation/bobbing right at pickup.
		if (dx * dx + dy * dy >= 64) {
			touchReorderUnlockedRef.current = true;
		}
	}, []);

	const onDragOver = React.useCallback((event: any) => {
		if (isTouchDragRef.current && !touchReorderUnlockedRef.current) return;
		const activeId = normalizeId(event.active.id);
		const overId = event.over ? normalizeId(event.over.id) : '';
		if (!activeId || !overId || activeId === overId) {
			lastOverIdRef.current = null;
			return;
		}
		// Guard: avoid repeated swap against same over target in consecutive drag frames.
		if (lastOverIdRef.current === overId) return;
		lastOverIdRef.current = overId;

		setDragOrderIds((prev) => {
			if (!prev) return prev;
			const next = swapIds(prev, activeId, overId);
			return next.every((id, index) => id === prev[index]) ? prev : next;
		});
	}, []);

	const onDragCancel = React.useCallback((_event: any) => {
		isTouchDragRef.current = false;
		pendingTouchIntentRef.current = false;
		touchScrollDetectedRef.current = false;
		touchStartPointRef.current = null;
		setIsTouchDragging(false);
		touchReorderUnlockedRef.current = false;
		skipNextFlipRef.current = false;
		setActiveDragId(null);
		setActiveDragSize(null);
		setDragOrderIds(null);
		lastOverIdRef.current = null;
		layoutRectsRef.current.clear();
		hasMeasuredLayoutRef.current = false;
	}, []);

	const onDragEnd = React.useCallback(
		(event: any) => {
			isTouchDragRef.current = false;
			pendingTouchIntentRef.current = false;
			touchScrollDetectedRef.current = false;
			touchStartPointRef.current = null;
			setIsTouchDragging(false);
			touchReorderUnlockedRef.current = false;
			skipNextFlipRef.current = false;
			if (!noteOrder) return;
			const current = readOrderIds(noteOrder);
			const next = dragOrderIds ?? current;
			setActiveDragId(null);
			setActiveDragSize(null);
			setDragOrderIds(null);
			lastOverIdRef.current = null;
			layoutRectsRef.current.clear();
			hasMeasuredLayoutRef.current = false;

			// Guard: if the dragged note was deleted remotely during the drag,
			// the cross-tab cancellation effect already cleared state. The
			// activeId extracted from the dnd-kit event may reference a note
			// that no longer exists — skip reorder entirely to prevent writing
			// a stale ID back into noteOrder.
			const activeId = normalizeId(event?.active?.id);
			if (activeId && !current.includes(activeId)) return;

			// Persist only when order actually changed.
			if (next.length === current.length && next.every((id, index) => id === current[index])) return;
			const ydoc = (noteOrder as YArrayWithDoc<string>).doc;
			ydoc.transact(() => {
				noteOrder.delete(0, noteOrder.length);
				noteOrder.insert(0, next);
			});
		},
		[noteOrder, dragOrderIds]
	);

	const activeDoc = activeDragId ? docsById[activeDragId] : undefined;
	const activeNote = activeDragId ? orderedNotes.find((n) => n.id === activeDragId) : undefined;
	const activeHasPendingSync = activeNote ? pendingSyncNoteIds.has(activeNote.id) : false;
	const overlayWidth = activeDragSize?.width ?? mobileCardWidthPx ?? undefined;
	const overlayHeight = activeDragSize && activeDragSize.height > 0 ? activeDragSize.height : undefined;

	return (
		<section
			ref={sectionRef}
			aria-label={t('grid.notes')}
			className={styles.section}
			style={
				mobileSectionBleedPx > 0
					? { ['--mobile-section-bleed' as any]: `${mobileSectionBleedPx}px` }
					: undefined
			}
			onTouchStartCapture={(event) => {
				const target = event.target as HTMLElement | null;
				if (!target?.closest('[data-note-card="true"]')) return;
				// Taps on interactive controls inside a card (checkboxes, buttons, inputs)
				// should not be treated as a potential drag/scroll gesture.
				if (target.closest('input, button, textarea, select, a, [role="textbox"]')) return;
				const touch = event.touches[0];
				// Record initial touch point for gesture classification. We intentionally do this
				// at the card container level so future card UI complexity (icons/badges/metadata)
				// does not require introducing a dedicated visual drag handle.
				pendingTouchIntentRef.current = true;
				touchScrollDetectedRef.current = false;
				touchStartPointRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
			}}
			onTouchMoveCapture={(event) => {
				if (!pendingTouchIntentRef.current) return;
				if (activeDragIdRef.current) return;
				const start = touchStartPointRef.current;
				const touch = event.touches[0];
				if (!start || !touch) return;
				const dx = touch.clientX - start.x;
				const dy = touch.clientY - start.y;
				// Vertical-dominant motion above threshold is treated as scroll intent.
				// Once detected, we immediately cancel pending drag activation and enter
				// a brief suppression window so delayed drag activation cannot re-trigger.
				if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) >= 8) {
					touchScrollDetectedRef.current = true;
					pendingTouchIntentRef.current = false;
					touchStartPointRef.current = null;
					suppressTouchDragUntilRef.current = Date.now() + 400;
					setDndContextKey((prev) => prev + 1);
				}
			}}
			onTouchEndCapture={() => {
				pendingTouchIntentRef.current = false;
				touchScrollDetectedRef.current = false;
				touchStartPointRef.current = null;
			}}
			onTouchCancelCapture={() => {
				pendingTouchIntentRef.current = false;
				touchScrollDetectedRef.current = false;
				touchStartPointRef.current = null;
			}}
		>
			<DndContext
				key={dndContextKey}
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragStart={onDragStart}
				onDragMove={onDragMove}
				onDragOver={onDragOver}
				onDragCancel={onDragCancel}
				onDragEnd={onDragEnd}
			>
				<SortableContext items={orderedNotes.map((n) => n.id)} strategy={rectSwappingStrategy}>
					<div
						ref={gridRef}
						className={styles.grid}
						aria-label={t('grid.notesGrid')}
						style={{
							['--grid-columns' as any]: String(columnCount),
							// This is the runtime override for mobile card width.
							// Set to null in getGridLayoutForViewport to revert to root --note-card-width.
							...(mobileCardWidthPx !== null ? { ['--note-card-width' as any]: `${mobileCardWidthPx}px` } : {}),
							...(mobileGridGapPx !== null ? { ['--grid-gap' as any]: `${mobileGridGapPx}px` } : {}),
						}}
					>
						{columns.map((columnIds, columnIndex) => (
							<div key={`col-${columnIndex}`} className={styles.column}>
								{columnIds.map((noteId) => {
									const note = noteById.get(noteId);
									if (!note) return null;
									const doc = docsById[note.id];
									if (!doc) {
										return (
											<div key={note.id} className={styles.item} data-note-id={note.id}>
												<div>{t('common.loading')}</div>
											</div>
										);
									}
									return (
										<SortableNoteCard
											key={note.id}
											note={note}
											doc={doc}
											hasPendingSync={pendingSyncNoteIds.has(note.id)}
											selected={props.selectedNoteId === note.id}
											onOpen={() => props.onSelectNote(note.id)}
											maxCardHeightPx={props.maxCardHeightPx}
										/>
									);
								})}
							</div>
						))}
					</div>
				</SortableContext>
				<DragOverlay adjustScale={false}>
					{activeNote && activeDoc ? (
						<div
							className={`${styles.item} ${styles.overlay}`}
							style={{
								width: overlayWidth,
								minWidth: overlayWidth,
								maxWidth: overlayWidth,
								height: overlayHeight,
							}}
						>
							<NoteCard
								noteId={activeNote.id}
								doc={activeDoc}
								hasPendingSync={activeHasPendingSync}
								maxCardHeightPx={props.maxCardHeightPx}
							/>
						</div>
					) : null}
				</DragOverlay>
			</DndContext>
		</section>
	);
}
