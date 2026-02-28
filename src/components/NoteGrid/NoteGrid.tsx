import React from 'react';
import type * as Y from 'yjs';
import {
	closestCenter,
	DndContext,
	DragOverlay,
	PointerSensor,
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
): { columnCount: number; mobileCardWidthPx: number | null } {
	// Desktop/base card width token (fixed-width cards by design).
	const noteCardWidth = readCssPxVariable('--note-card-width', 280);
	const gap = readCssPxVariable('--grid-gap', 16);

	const isMobile = isMobileLikeDevice(viewportWidth);
	const isPortrait = viewportHeight >= viewportWidth;

	let mobileCardWidthPx: number | null = null;
	if (isMobile) {
		// Use stable short side for mobile sizing so browser chrome show/hide while scrolling
		// does not cause width jitter (especially in mobile landscape).
		const stableShortSide =
			typeof window !== 'undefined' && typeof window.screen !== 'undefined'
				? Math.min(window.screen.width, window.screen.height)
				: Math.min(viewportWidth, viewportHeight);
		// Keep card width consistent between portrait and landscape on mobile.
		const twoColumnBasis = Math.min(containerWidth, stableShortSide);
		mobileCardWidthPx = Math.max(140, Math.floor((twoColumnBasis - gap) / 2));
	}

	// Effective width is either fixed desktop token or mobile override.
	const effectiveCardWidth = mobileCardWidthPx ?? noteCardWidth;
	const maxByWidth = Math.max(1, Math.floor((containerWidth + gap) / (effectiveCardWidth + gap)));

	// Portrait mobile is explicitly locked to 2 columns to maximize visible content density.
	if (mobileCardWidthPx !== null && isPortrait) {
		return { columnCount: 2, mobileCardWidthPx };
	}

	return { columnCount: maxByWidth, mobileCardWidthPx };
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
	selected: boolean;
	onOpen: () => void;
	maxCardHeightPx: number;
};

function SortableNoteCard(props: SortableNoteCardProps): React.JSX.Element {
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
		useSortable({
			id: props.note.id,
			animateLayoutChanges: (args) => defaultAnimateLayoutChanges({ ...args, wasDragging: true }),
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
	// DnD state: active item, overlay size, and live in-drag order.
	const [activeDragId, setActiveDragId] = React.useState<string | null>(null);
	const [activeDragSize, setActiveDragSize] = React.useState<{ width: number; height: number } | null>(null);
	const [dragOrderIds, setDragOrderIds] = React.useState<string[] | null>(null);
	const lastOverIdRef = React.useRef<string | null>(null);
	const [columnCount, setColumnCount] = React.useState<number>(() => 2);
	// Mobile-only runtime width override. Null means use desktop/root --note-card-width.
	const [mobileCardWidthPx, setMobileCardWidthPx] = React.useState<number | null>(null);
	const sectionRef = React.useRef<HTMLElement | null>(null);
	const gridRef = React.useRef<HTMLDivElement | null>(null);
	// FLIP animation bookkeeping across renders.
	const layoutRectsRef = React.useRef<Map<string, DOMRect>>(new Map());
	const hasMeasuredLayoutRef = React.useRef(false);
	// Suppress startup animations after hard refresh to avoid "cards animating into place" flash.
	const suppressReflowAnimationsRef = React.useRef(true);
	const manager = useDocumentManager();

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

	const orderedIds = React.useMemo<string[]>(() => {
		if (!noteOrder) return [];
		return readOrderIds(noteOrder);
	}, [noteOrder, storeVersion]);
	const renderedIds = dragOrderIds ?? orderedIds;
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

		// First measurement seeds rect cache only; avoids bogus first-pass animation.
		if (!hasMeasuredLayoutRef.current) {
			hasMeasuredLayoutRef.current = true;
			layoutRectsRef.current = nextRects;
			return;
		}

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

	React.useEffect(() => {
		// Keep noteOrder CRDT in sync with registry additions (backfill missing IDs only).
		if (!notesList || !noteOrder) return;
		const registryIds = readRegistryIds(notesList);
		const current = readOrderIds(noteOrder);
		if (current.length === 0 && registryIds.length > 0) {
			const ydoc = (noteOrder as YArrayWithDoc<string>).doc;
			ydoc.transact(() => {
				noteOrder.insert(0, registryIds);
			});
			return;
		}
		ensureOrderContainsAllRegistryIds(noteOrder, registryIds);
	}, [notesList, noteOrder, storeVersion]);

	React.useEffect(() => {
		// Lazy-load each note doc as it appears in order; cache loaded docs by noteId.
		let cancelled = false;
		if (!noteOrder) return;
		for (const id of orderedIds) {
			if (docsByIdRef.current[id]) continue;
			if (pendingDocLoadsRef.current.has(id)) continue;
			pendingDocLoadsRef.current.add(id);
			void manager
				.getDocWithSync(id)
				.then((doc) => {
					if (cancelled) return;
					setDocsById((prev) => (prev[id] ? prev : { ...prev, [id]: doc }));
				})
				.catch((err) => {
					console.error('[CRDT] Failed to load note doc:', id, err);
				})
				.finally(() => {
					pendingDocLoadsRef.current.delete(id);
				});
		}
		return () => {
			cancelled = true;
		};
	}, [manager, noteOrder, orderedIds]);

	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

	const onDragStart = React.useCallback((event: any) => {
		const activeId = normalizeId(event.active.id);
		// Any user interaction after startup can safely use transitions.
		suppressReflowAnimationsRef.current = false;
		setActiveDragId(activeId);
		setDragOrderIds(orderedIds);
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
	}, [orderedIds]);

	const onDragOver = React.useCallback((event: any) => {
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
		setActiveDragId(null);
		setActiveDragSize(null);
		setDragOrderIds(null);
		lastOverIdRef.current = null;
		layoutRectsRef.current.clear();
		hasMeasuredLayoutRef.current = false;
	}, []);

	const onDragEnd = React.useCallback(
		(event: any) => {
			if (!noteOrder) return;
			const current = readOrderIds(noteOrder);
			const next = dragOrderIds ?? current;
			setActiveDragId(null);
			setActiveDragSize(null);
			setDragOrderIds(null);
			lastOverIdRef.current = null;
			layoutRectsRef.current.clear();
			hasMeasuredLayoutRef.current = false;
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
	const overlayWidth = activeDragSize?.width ?? mobileCardWidthPx ?? undefined;
	const overlayHeight = activeDragSize && activeDragSize.height > 0 ? activeDragSize.height : undefined;

	return (
		<section ref={sectionRef} aria-label="Notes" className={styles.section}>
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragStart={onDragStart}
				onDragOver={onDragOver}
				onDragCancel={onDragCancel}
				onDragEnd={onDragEnd}
			>
				<SortableContext items={orderedNotes.map((n) => n.id)} strategy={rectSwappingStrategy}>
					<div
						ref={gridRef}
						className={styles.grid}
						aria-label="Notes Grid"
						style={{
							['--grid-columns' as any]: String(columnCount),
							// This is the runtime override for mobile card width.
							// Set to null in getGridLayoutForViewport to revert to root --note-card-width.
							...(mobileCardWidthPx !== null ? { ['--note-card-width' as any]: `${mobileCardWidthPx}px` } : {}),
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
												<div>Loading…</div>
											</div>
										);
									}
									return (
										<SortableNoteCard
											key={note.id}
											note={note}
											doc={doc}
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
							<NoteCard noteId={activeNote.id} doc={activeDoc} maxCardHeightPx={props.maxCardHeightPx} />
						</div>
					) : null}
				</DragOverlay>
			</DndContext>
		</section>
	);
}
