import React from 'react';
import type * as Y from 'yjs';
import { motion, LayoutGroup } from 'framer-motion';
import { NoteCard } from '../NoteCard/NoteCard';
import { useDocumentManager } from '../../core/DocumentManagerContext';
import { runNoteGuards } from '../../core/devGuards';
import { useI18n } from '../../core/i18n';
import { readTrashState } from '../../core/noteModel';
import { useConnectionStatus } from '../../core/useConnectionStatus';
import { measureDocumentRects } from './flip';
import {
	arraysEqual,
	columnSlotLengths,
	flattenColumns,
	getGridLayoutForViewport,
	mergeVisibleIdsIntoLayoutOrder,
	mergeVisibleOrderIntoFullOrder,
	readCssPxVariable,
	splitIntoColumnsByHeight,
	splitIntoColumnsBySlotLengths,
} from './layout';
import { useNoteGridDragManager } from './useNoteGridDragManager';
import styles from './NoteGrid.module.css';

type Note = { id: string };

export type NoteGridProps = {
	selectedNoteId: string | null;
	onSelectNote: (noteId: string) => void;
	maxCardHeightPx: number;
};

type YArrayWithDoc<T> = Y.Array<T> & { doc: Y.Doc };

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

type GridNoteCardProps = {
	note: Note;
	doc: Y.Doc;
	hasPendingSync: boolean;
	selected: boolean;
	onOpen: () => void;
	maxCardHeightPx: number;
	isPlaceholder: boolean;
	setItemElement: (id: string, node: HTMLDivElement | null) => void;
	setHandleElement: (id: string, node: HTMLDivElement | null) => void;
};

const GridNoteCard = React.memo(function GridNoteCard(props: GridNoteCardProps): React.JSX.Element {
	const handleItemRef = React.useCallback(
		(node: HTMLDivElement | null) => {
			props.setItemElement(props.note.id, node);
		},
		[props.note.id, props.setItemElement]
	);

	const handleDragHandleRef = React.useCallback(
		(node: HTMLDivElement | null) => {
			props.setHandleElement(props.note.id, node);
		},
		[props.note.id, props.setHandleElement]
	);

	return (
		<motion.div
			ref={handleItemRef}
			layout
			layoutId={props.note.id}
			transition={{ type: 'spring', stiffness: 700, damping: 50, mass: 0.8 }}
			className={[
				styles.item,
				props.isPlaceholder ? styles.itemPlaceholder : '',
			]
				.filter(Boolean)
				.join(' ')}
			data-note-id={props.note.id}
		>
			<div
				data-note-content="true"
				className={[
					props.selected ? styles.itemSelected : '',
				]
					.filter(Boolean)
					.join(' ')}
			>
				<NoteCard
					noteId={props.note.id}
					doc={props.doc}
					hasPendingSync={props.hasPendingSync}
					maxCardHeightPx={props.maxCardHeightPx}
					onOpen={props.onOpen}
					dragHandleRef={handleDragHandleRef}
				/>
			</div>
		</motion.div>
	);
});

export function NoteGrid(props: NoteGridProps): React.JSX.Element {
	const { t } = useI18n();
	const manager = useDocumentManager();
	const connection = useConnectionStatus();
	const pendingSyncNoteIds = React.useMemo(() => new Set(connection.pendingSyncNoteIds), [connection.pendingSyncNoteIds]);

	const [notesList, setNotesList] = React.useState<Y.Array<Y.Map<unknown>> | null>(null);
	const [noteOrder, setNoteOrder] = React.useState<Y.Array<string> | null>(null);
	// ── Yjs-backed layout map ─────────────────────────────────────────────
	// A Y.Map stored in the notes-registry Yjs doc alongside noteOrder.
	// Currently holds one key: 'columnSlots' (number[]) — the number of cards
	// in each column at the time of the last drag-and-drop commit.  Other
	// devices read this to reconstruct the same column grouping via
	// splitIntoColumnsBySlotLengths, avoiding height-based packing divergence.
	const [noteLayout, setNoteLayout] = React.useState<Y.Map<unknown> | null>(null);
	const [docsById, setDocsById] = React.useState<Record<string, Y.Doc>>({});
	const docsByIdRef = React.useRef<Record<string, Y.Doc>>({});
	const pendingDocLoadsRef = React.useRef<Set<string>>(new Set());
	const versionRef = React.useRef(0);
	const [metadataVersion, setMetadataVersion] = React.useState(0);
	const [layoutOrderIds, setLayoutOrderIds] = React.useState<string[]>([]);
	const [columnCount, setColumnCount] = React.useState<number>(2);
	const [mobileCardWidthPx, setMobileCardWidthPx] = React.useState<number | null>(null);
	const [mobileGridGapPx, setMobileGridGapPx] = React.useState<number | null>(null);
	const [mobileSectionBleedPx, setMobileSectionBleedPx] = React.useState<number>(0);
	const [noteHeightsVersion, setNoteHeightsVersion] = React.useState(0);
	// ── Sticky columns ───────────────────────────────────────────────────
	// After a drag-and-drop commit, the balanced column layout is saved here
	// so it persists across re-renders without being re-packed by height.
	// Cleared when column count changes, card IDs change, or it falls back
	// to packedColumns.  This prevents the "all cards shuffle" problem where
	// greedy repacking rearranges cards that the user didn't move.
	const [stickyColumns, setStickyColumns] = React.useState<string[][] | null>(null);
	const pendingCommittedVisibleOrderRef = React.useRef<string[] | null>(null);
	const sectionRef = React.useRef<HTMLElement | null>(null);
	const gridRef = React.useRef<HTMLDivElement | null>(null);
	const noteHeightByIdRef = React.useRef<Map<string, number>>(new Map());
	const noteHeightBumpRafRef = React.useRef<number>(0);
	const touchStartPointRef = React.useRef<{ x: number; y: number } | null>(null);
	const pendingTouchIntentRef = React.useRef(false);
	const touchScrollDetectedRef = React.useRef(false);
	const suppressTouchDragUntilRef = React.useRef(0);

	React.useEffect(() => {
		docsByIdRef.current = docsById;
	}, [docsById]);

	const recalculateColumnCount = React.useCallback((): void => {
		if (typeof window === 'undefined') return;
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
		const onResize = (): void => { recalculateColumnCount(); };
		window.addEventListener('resize', onResize);
		window.addEventListener('orientationchange', onResize);
		const section = sectionRef.current;
		const observer = section ? new ResizeObserver(() => recalculateColumnCount()) : null;
		if (section && observer) observer.observe(section);
		return () => {
			window.removeEventListener('resize', onResize);
			window.removeEventListener('orientationchange', onResize);
			observer?.disconnect();
		};
	}, [recalculateColumnCount]);

	React.useEffect(() => {
		const onScroll = (): void => {
			if (!pendingTouchIntentRef.current) return;
			touchScrollDetectedRef.current = true;
			pendingTouchIntentRef.current = false;
			touchStartPointRef.current = null;
			suppressTouchDragUntilRef.current = Date.now() + 400;
		};
		window.addEventListener('scroll', onScroll, { passive: true, capture: true });
		return () => {
			window.removeEventListener('scroll', onScroll, true);
		};
	}, []);

	// ── Load Yjs data: notesList, noteOrder, AND noteLayout ──────────────
	// All three are Y types from the shared notes-registry doc.  noteLayout
	// is a Y.Map that stores column slot lengths for cross-device sync.
	React.useEffect(() => {
		let cancelled = false;
		(async () => {
			const [list, order, layout] = await Promise.all([manager.getNotesList(), manager.getNoteOrder(), manager.getNoteLayout()]);
			if (cancelled) return;
			setNotesList(list as unknown as Y.Array<Y.Map<unknown>>);
			setNoteOrder(order);
			setNoteLayout(layout);
		})();
		return () => { cancelled = true; };
	}, [manager]);

	// ── Subscribe to Yjs changes: notesList + noteOrder + noteLayout ──────
	// All three are observed so React re-renders when any of them change.
	// noteLayout changes arrive when another device commits a drag result,
	// which triggers packedColumns to re-derive columns from the new slot lengths.
	const subscribe = React.useCallback(
		(onStoreChange: () => void) => {
			if (!notesList || !noteOrder) return () => {};
			const onChange = (): void => {
				versionRef.current += 1;
				onStoreChange();
			};
			notesList.observeDeep(onChange);
			noteOrder.observe(onChange);
			// Also observe the layout map so cross-device slot-length updates
			// trigger a re-render and column reconstruction.
			noteLayout?.observe(onChange);
			return () => {
				notesList.unobserveDeep(onChange);
				noteOrder.unobserve(onChange);
				noteLayout?.unobserve(onChange);
			};
		},
		[notesList, noteOrder, noteLayout]
	);

	const getSnapshot = React.useCallback(() => versionRef.current, []);
	const storeVersion = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	React.useEffect(() => {
		const entries = Object.entries(docsById);
		if (entries.length === 0) return;
		const cleanups: Array<() => void> = [];
		for (const [, doc] of entries) {
			const metadata = doc.getMap('metadata');
			const handler = (): void => { setMetadataVersion((version) => version + 1); };
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

	const visibleIds = React.useMemo<string[]>(() => {
		return orderedIds.filter((id) => {
			const doc = docsById[id];
			if (!doc) return true;
			return !readTrashState(doc).trashed;
		});
	}, [orderedIds, docsById, metadataVersion]);

	// ── Commit drag result to Yjs ─────────────────────────────────────────
	// Called by the drag manager's onDrop handler with the raw column layout
	// from the insertion point.  Before writing to Yjs, this function:
	//
	// 1. REBALANCES columns locally: if the tallest column is >2x the shortest
	//    (measured by summing card heights), moves bottom cards from the tallest
	//    to the shortest until the ratio drops to ≤1.5x.  Only the minimum
	//    number of cards move — the rest of the layout is preserved.  This
	//    rebalancing happens HERE (before commit) rather than in a read-only
	//    memo, so that the BALANCED layout is what gets written to Yjs and
	//    synced to other devices.
	//
	// 2. Saves the balanced columns as stickyColumns (local state) so the grid
	//    doesn't repack on the next render.
	//
	// 3. Writes TWO things to Yjs in a single transaction:
	//    a) The flat note order (column-major via flattenColumns)
	//    b) The column slot lengths in the noteLayout Y.Map
	//    Other devices read both to reconstruct the identical column grouping
	//    via splitIntoColumnsBySlotLengths, regardless of card-height differences.
	const commitVisibleOrder = React.useCallback(
		(nextVisibleOrder: string[], finalColumns: string[][]) => {
			if (!noteOrder) return;

			// Rebalance columns before committing so other devices receive the
			// balanced layout, not the raw drop result.
			const gapPx = mobileGridGapPx ?? readCssPxVariable('--grid-gap', 16);
			const fallbackH = Math.min(props.maxCardHeightPx, 220);
			const heightOf = (id: string) => noteHeightByIdRef.current.get(id) ?? fallbackH;
			const computeColHeights = (cols: string[][]) =>
				cols.map((col) => col.reduce((sum, id, i) => sum + heightOf(id) + (i > 0 ? gapPx : 0), 0));

			let balancedColumns = finalColumns.map((col) => col.slice());
			let colHeights = computeColHeights(balancedColumns);
			let maxH = Math.max(...colHeights);
			let minH = Math.min(...colHeights);

			// ── Rebalance: move cards from the tallest column to shorter ones ──
			// If the tallest column is >2x the shortest (by summed card height),
			// iteratively pop the bottom card from the tallest and append it to
			// the shortest until the ratio drops to ≤1.5x.  This avoids a full
			// greedy repack (which would shuffle every column) and instead only
			// moves the minimum cards causing the imbalance.
			if (minH > 0 && maxH / minH > 2) {
				for (let moves = 0; moves < balancedColumns.flat().length; moves++) {
					maxH = Math.max(...colHeights);
					minH = Math.min(...colHeights);
					if (minH <= 0 || maxH / minH <= 1.5) break;

					const tallestIdx = colHeights.indexOf(maxH);
					const shortestIdx = colHeights.indexOf(minH);
					if (tallestIdx === shortestIdx || balancedColumns[tallestIdx].length <= 1) break;

					const movedId = balancedColumns[tallestIdx].pop()!;
					balancedColumns[shortestIdx].push(movedId);
					colHeights = computeColHeights(balancedColumns);
				}
			}

			const balancedOrder = flattenColumns(balancedColumns);
			pendingCommittedVisibleOrderRef.current = balancedOrder.slice();
			setLayoutOrderIds((previous) => (arraysEqual(previous, balancedOrder) ? previous : balancedOrder));
			setStickyColumns(balancedColumns);

			// ── Persist to Yjs in a single transaction ──────────────────────
			// Write the balanced flat order AND column slot lengths atomically.
			// The flat order is column-major (flattenColumns) so the receiving
			// device can split it at slot boundaries to get the same columns.
			const current = readOrderIds(noteOrder);
			const next = mergeVisibleOrderIntoFullOrder(current, visibleIds, balancedOrder);
			if (arraysEqual(current, next)) return;
			const ydoc = (noteOrder as YArrayWithDoc<string>).doc;
			ydoc.transact(() => {
				noteOrder.delete(0, noteOrder.length);
				noteOrder.insert(0, next);
				if (noteLayout) {
					noteLayout.set('columnSlots', columnSlotLengths(balancedColumns));
				}
			});
		},
		[noteOrder, noteLayout, visibleIds, mobileGridGapPx, props.maxCardHeightPx]
	);

	React.useEffect(() => {
		setLayoutOrderIds((previous) => {
			const pendingCommitted = pendingCommittedVisibleOrderRef.current;
			if (pendingCommitted) {
				if (arraysEqual(visibleIds, pendingCommitted)) {
					pendingCommittedVisibleOrderRef.current = null;
					return arraysEqual(previous, visibleIds) ? previous : visibleIds;
				}
				const nextDuringPending = mergeVisibleIdsIntoLayoutOrder(previous, visibleIds);
				return arraysEqual(previous, nextDuringPending) ? previous : nextDuringPending;
			}
			return arraysEqual(previous, visibleIds) ? previous : visibleIds;
		});
	}, [visibleIds]);

	React.useEffect(() => {
		if (!notesList || !noteOrder) return;
		const registryIds = readRegistryIds(notesList);
		const current = readOrderIds(noteOrder);
		if (current.length === 0 && registryIds.length > 0) {
			const ydoc = (noteOrder as YArrayWithDoc<string>).doc;
			ydoc.transact(() => { noteOrder.insert(0, registryIds); });
			return;
		}
		ensureOrderContainsAllRegistryIds(noteOrder, registryIds);
		const registrySet = new Set(registryIds);
		const rawOrder = noteOrder.toArray();
		const orphanIndices: number[] = [];
		for (let i = rawOrder.length - 1; i >= 0; i--) {
			const id = normalizeId(rawOrder[i]);
			if (id && !registrySet.has(id)) orphanIndices.push(i);
		}
		if (orphanIndices.length > 0) {
			const ydoc = (noteOrder as YArrayWithDoc<string>).doc;
			ydoc.transact(() => {
				for (const index of orphanIndices) noteOrder.delete(index, 1);
			});
		}
		const seen = new Set<string>();
		const dupeIndices: number[] = [];
		const dedupeOrder = noteOrder.toArray();
		for (let i = 0; i < dedupeOrder.length; i++) {
			const id = normalizeId(dedupeOrder[i]);
			if (seen.has(id)) dupeIndices.push(i);
			else seen.add(id);
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

	React.useEffect(() => {
		if (!notesList || !noteOrder) return;
		runNoteGuards(readRegistryIds(notesList), readOrderIds(noteOrder), docsById);
	}, [notesList, noteOrder, storeVersion, docsById]);

	React.useEffect(() => {
		if (!noteOrder) return;
		for (const id of orderedIds) {
			if (docsByIdRef.current[id]) continue;
			if (pendingDocLoadsRef.current.has(id)) continue;
			pendingDocLoadsRef.current.add(id);
			void manager
				.getDocWithSync(id)
				.then((doc) => {
					setDocsById((previous) => (previous[id] ? previous : { ...previous, [id]: doc }));
				})
				.catch((error) => {
					console.error('[CRDT] Failed to load note doc:', id, error);
				})
				.finally(() => {
					pendingDocLoadsRef.current.delete(id);
				});
		}
	}, [manager, noteOrder, orderedIds]);

	const renderedIds = layoutOrderIds.length > 0 ? layoutOrderIds : visibleIds;
	const noteById = React.useMemo(() => {
		const map = new Map<string, Note>();
		for (const id of renderedIds) map.set(id, { id });
		return map;
	}, [renderedIds]);

	// ── Column computation: packedColumns ─────────────────────────────────
	// This is the "cold start" column layout, used when there are no
	// stickyColumns from a recent drag.  Two strategies, in priority order:
	//
	// 1. Slot-based (cross-device sync): if the Yjs noteLayout map has stored
	//    columnSlots from another device's drag, AND those slots match the
	//    local column count and total card count, reconstruct columns by
	//    slicing the flat order at slot boundaries.  This guarantees the same
	//    column grouping regardless of card-height differences.
	//
	// 2. Height-based (greedy packing): fall back to assigning each card to
	//    the shortest column.  Used on first load, when column count differs
	//    from stored slots, or when cards have been added/removed.
	const packedColumns = React.useMemo(() => {
		// If the Yjs layout map has stored column slot lengths from the last drag,
		// and they match the local column count + total card count, use them to
		// reconstruct the exact column grouping. This ensures cross-device consistency
		// even when card heights differ between devices.
		if (noteLayout) {
			const stored = noteLayout.get('columnSlots');
			if (Array.isArray(stored) && stored.length === columnCount) {
				const totalSlots = stored.reduce((sum: number, n: number) => sum + n, 0);
				if (totalSlots === renderedIds.length && stored.every((n: unknown) => typeof n === 'number' && n >= 0)) {
					return splitIntoColumnsBySlotLengths(renderedIds, stored as number[]);
				}
			}
		}
		const gapPx = mobileGridGapPx ?? readCssPxVariable('--grid-gap', 16);
		const fallbackHeightPx = Math.min(props.maxCardHeightPx, 220);
		return splitIntoColumnsByHeight(renderedIds, columnCount, noteHeightByIdRef.current, gapPx, fallbackHeightPx);
	}, [renderedIds, columnCount, noteHeightsVersion, mobileGridGapPx, props.maxCardHeightPx, noteLayout, storeVersion]);

	// Reconcile stickyColumns with current renderedIds: keep sticky layout if still valid,
	// clear it if column count changed or IDs changed.
	// ── Reconcile stickyColumns with current card IDs ─────────────────────
	// stickyColumns preserves the column layout from the last drag so cards
	// don't shuffle on re-render.  But they can become stale if:
	//   - Column count changed (viewport resize) → fall back to packedColumns
	//   - Cards were added or removed → patch stickyColumns by removing stale
	//     IDs and inserting new ones into the shortest column
	// If stickyColumns are valid and up-to-date, use them as-is.
	const baseColumns = React.useMemo(() => {
		if (!stickyColumns || stickyColumns.length !== columnCount) return packedColumns;

		// Check that all renderedIds are still present in stickyColumns
		const stickyFlat = new Set(stickyColumns.flat());
		const renderedSet = new Set(renderedIds);
		const allPresent = renderedIds.every((id) => stickyFlat.has(id));
		const noExtras = stickyFlat.size === renderedSet.size;

		if (!allPresent || !noExtras) {
			// IDs changed (card added/removed) — merge additions into sticky, remove stale
			const reconciled = stickyColumns.map((col) => col.filter((id) => renderedSet.has(id)));
			const seen = new Set(reconciled.flat());
			const missing = renderedIds.filter((id) => !seen.has(id));
			// Add missing cards to the shortest column
			for (const id of missing) {
				let shortest = 0;
				for (let i = 1; i < reconciled.length; i++) {
					if (reconciled[i].length < reconciled[shortest].length) shortest = i;
				}
				reconciled[shortest].push(id);
			}
			return reconciled;
		}

		return stickyColumns;
	}, [stickyColumns, packedColumns, renderedIds, columnCount]);

	// Clear stickyColumns when a full repack wins (e.g. height imbalance or column count change)
	React.useEffect(() => {
		if (stickyColumns && baseColumns === packedColumns) {
			setStickyColumns(null);
		}
	}, [stickyColumns, baseColumns, packedColumns]);

	// ── Wire up the drag manager ──────────────────────────────────────────
	// Passes baseColumns as the starting column layout.  During drag, the
	// manager computes previewColumns with the card at the live insertion
	// point; the grid renders whichever is available.
	const dragManager = useNoteGridDragManager({
		sectionRef,
		gridRef,
		columns: baseColumns,
		visibleIds,
		canStartDrag: () => !touchScrollDetectedRef.current && Date.now() >= suppressTouchDragUntilRef.current,
		isTouchDragCandidate: () => pendingTouchIntentRef.current,
		onCommitOrder: commitVisibleOrder,
	});

	// ── Active columns for rendering ──────────────────────────────────────
	// During drag, use previewColumns (with the card at the insertion point
	// and the placeholder holding the original space); otherwise use the
	// stable baseColumns.  framer-motion's `layout` prop on each card
	// automatically animates position changes when columns swap.
	const columns = dragManager.previewColumns ?? baseColumns;

	// Freeze touch actions during touch drag to prevent browser scroll interference
	React.useEffect(() => {
		if (!dragManager.isTouchDragging) return;
		if (typeof document === 'undefined') return;
		const html = document.documentElement;
		const body = document.body;
		const previous = {
			htmlTouchAction: html.style.touchAction,
			htmlOverscrollBehavior: html.style.overscrollBehavior,
			bodyTouchAction: body.style.touchAction,
			bodyOverscrollBehavior: body.style.overscrollBehavior,
		};
		html.style.touchAction = 'none';
		html.style.overscrollBehavior = 'none';
		body.style.touchAction = 'none';
		body.style.overscrollBehavior = 'none';
		return () => {
			html.style.touchAction = previous.htmlTouchAction;
			html.style.overscrollBehavior = previous.htmlOverscrollBehavior;
			body.style.touchAction = previous.bodyTouchAction;
			body.style.overscrollBehavior = previous.bodyOverscrollBehavior;
		};
	}, [dragManager.isTouchDragging]);

	// Measure card heights for masonry packing (runs after render)
	React.useLayoutEffect(() => {
		const grid = gridRef.current;
		if (!grid) return;
		const documentRects = measureDocumentRects(grid);
		let heightsChanged = false;
		for (const [id, rect] of documentRects) {
			const nextHeight = Math.max(0, Math.round(rect.height));
			const previousHeight = noteHeightByIdRef.current.get(id);
			if (previousHeight !== nextHeight) {
				noteHeightByIdRef.current.set(id, nextHeight);
				heightsChanged = true;
			}
		}
		for (const id of Array.from(noteHeightByIdRef.current.keys())) {
			if (!documentRects.has(id)) {
				noteHeightByIdRef.current.delete(id);
				heightsChanged = true;
			}
		}
		if (!dragManager.activeDragId && heightsChanged && typeof window !== 'undefined') {
			if (noteHeightBumpRafRef.current) window.cancelAnimationFrame(noteHeightBumpRafRef.current);
			noteHeightBumpRafRef.current = window.requestAnimationFrame(() => {
				noteHeightBumpRafRef.current = 0;
				setNoteHeightsVersion((version) => version + 1);
			});
		}
		return () => {
			if (noteHeightBumpRafRef.current && typeof window !== 'undefined') {
				window.cancelAnimationFrame(noteHeightBumpRafRef.current);
				noteHeightBumpRafRef.current = 0;
			}
		};
	}, [columns, docsById, dragManager.activeDragId]);

	const activeDoc = dragManager.activeDragId ? docsById[dragManager.activeDragId] : undefined;
	const activeNote = dragManager.activeDragId ? noteById.get(dragManager.activeDragId) : undefined;
	const activeHasPendingSync = activeNote ? pendingSyncNoteIds.has(activeNote.id) : false;

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
				if (target.closest('input, button, textarea, select, a, [role="textbox"]')) return;
				const touch = event.touches[0];
				pendingTouchIntentRef.current = true;
				touchScrollDetectedRef.current = false;
				touchStartPointRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
			}}
			onTouchMoveCapture={(event) => {
				if (!pendingTouchIntentRef.current) return;
				if (dragManager.activeDragId) return;
				const start = touchStartPointRef.current;
				const touch = event.touches[0];
				if (!start || !touch) return;
				const dx = touch.clientX - start.x;
				const dy = touch.clientY - start.y;
				if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) >= 8) {
					touchScrollDetectedRef.current = true;
					pendingTouchIntentRef.current = false;
					touchStartPointRef.current = null;
					suppressTouchDragUntilRef.current = Date.now() + 400;
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
			<LayoutGroup>
				<div
					ref={gridRef}
					className={styles.grid}
					aria-label={t('grid.notesGrid')}
					style={{
						['--grid-columns' as any]: String(columnCount),
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
								const isPlaceholder = dragManager.activeDragId === note.id;
								return (
									<GridNoteCard
										key={note.id}
										note={note}
										doc={doc}
										hasPendingSync={pendingSyncNoteIds.has(note.id)}
										selected={props.selectedNoteId === note.id}
										onOpen={() => props.onSelectNote(note.id)}
										maxCardHeightPx={props.maxCardHeightPx}
										isPlaceholder={isPlaceholder}
										setItemElement={dragManager.setItemElement}
										setHandleElement={dragManager.setHandleElement}
									/>
								);
							})}
						</div>
					))}
				</div>
			</LayoutGroup>
			{dragManager.dragOverlay && activeNote && activeDoc ? (
				<div
					className={`${styles.item} ${styles.dragPreview}`}
					style={{
						left: dragManager.dragOverlay.left,
						top: dragManager.dragOverlay.top,
						width: dragManager.dragOverlay.width,
						minWidth: dragManager.dragOverlay.width,
						maxWidth: dragManager.dragOverlay.width,
						height: dragManager.dragOverlay.height,
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
		</section>
	);
}
