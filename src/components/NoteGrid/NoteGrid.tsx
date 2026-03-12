import React from 'react';
import type * as Y from 'yjs';
import { createPortal } from 'react-dom';
import { motion, LayoutGroup, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUsers } from '@fortawesome/free-solid-svg-icons';
import { NoteCard } from '../NoteCard/NoteCard';
import { NoteCardMoreMenu } from '../NoteCard/NoteCardMoreMenu';
import { useDocumentManager } from '../../core/DocumentManagerContext';
import { runNoteGuards } from '../../core/devGuards';
import { useI18n } from '../../core/i18n';
import {
	readCachedNoteShareCollaborators,
	syncNoteShareCollaborators,
	type NoteShareCollaboratorSnapshot,
	type SharedNotePlacement,
} from '../../core/noteShareApi';
import { readTrashState } from '../../core/noteModel';
import { useConnectionStatus } from '../../core/useConnectionStatus';
import { measureDocumentRects } from './flip';
import {
	arraysEqual,
	flattenColumns,
	getGridLayoutForViewport,
	mergeVisibleIdsIntoLayoutOrder,
	mergeVisibleOrderIntoFullOrder,
	readCssPxVariable,
	splitIntoColumnsByHeight,
} from './layout';
import { useNoteGridDragManager } from './useNoteGridDragManager';
import styles from './NoteGrid.module.css';

type Note = {
	id: string;
	isShared: boolean;
};

export type NoteGridProps = {
	authUserId?: string | null;
	activeWorkspaceId?: string | null;
	selectedNoteId: string | null;
	onSelectNote: (noteId: string) => void;
	onAddCollaborator?: (noteId: string, title?: string) => void;
	onSelectCollaboratorFilter?: (filter: NoteGridCollaboratorFilter) => void;
	activeCollaboratorFilter?: NoteGridCollaboratorFilter | null;
	refreshCollaboratorsToken?: number;
	canEditWorkspaceContent?: boolean;
	canReorder?: boolean;
	maxCardHeightPx: number;
	showTrashed?: boolean;
	sharedNotes?: readonly SharedNotePlacement[];
	onReady?: () => void;
	/** Enable framer-motion layout animations. Keep false during splash reveal. */
	enableLayoutAnimations?: boolean;
};

type YArrayWithDoc<T> = Y.Array<T> & { doc: Y.Doc };

type NoteCardCollaborator = {
	key: string;
	userId: string | null;
	name: string;
	email: string;
	avatar: string | null;
	accessSource: 'direct' | 'workspace';
};

type NoteCardCollaboratorSummary = {
	docId: string;
	collaborators: readonly NoteCardCollaborator[];
	count: number;
};

export type NoteGridCollaboratorFilter = {
	key: string;
	userId: string | null;
	label: string;
	email: string;
	avatar: string | null;
};

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
	metaChips?: React.ReactNode;
	hasPendingSync: boolean;
	selected: boolean;
	isMoreMenuOpen: boolean;
	onOpen: () => void;
	onAddCollaborator?: () => void;
	onMoreMenu: (anchorRect?: { top: number; left: number; width: number; height: number } | null) => void;
	canEdit: boolean;
	maxCardHeightPx: number;
	isPlaceholder: boolean;
	layoutReady: boolean;
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
			layout="position"
			layoutId={props.note.id}
			initial={false}
			transition={
				props.layoutReady
					? { type: 'spring', stiffness: 700, damping: 50, mass: 0.8 }
					: { layout: { duration: 0 } }
			}
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
					metaChips={props.metaChips}
					canEdit={props.canEdit}
					hasPendingSync={props.hasPendingSync}
					isMoreMenuOpen={props.isMoreMenuOpen}
					maxCardHeightPx={props.maxCardHeightPx}
					onOpen={props.onOpen}
					onAddCollaborator={props.onAddCollaborator}
					onMoreMenu={props.onMoreMenu}
					dragHandleRef={handleDragHandleRef}
				/>
			</div>
		</motion.div>
	);
});

function normalizeEmail(value: unknown): string {
	return String(value ?? '').trim().toLowerCase();
}

function collaboratorFilterKey(collaborator: { userId?: string | null; email?: string | null }): string {
	const userId = typeof collaborator.userId === 'string' ? collaborator.userId.trim() : '';
	if (userId) return `user:${userId}`;
	return `email:${normalizeEmail(collaborator.email)}`;
}

function snapshotToCollaboratorSummary(docId: string, snapshot: NoteShareCollaboratorSnapshot | null): NoteCardCollaboratorSummary | null {
	if (!snapshot || !Array.isArray(snapshot.collaborators) || snapshot.collaborators.length === 0) {
		return null;
	}
	const collaborators = snapshot.collaborators
		.map((collaborator): NoteCardCollaborator | null => {
			const label = String(collaborator.user?.name || collaborator.user?.email || collaborator.userId || '').trim();
			const email = String(collaborator.user?.email || '').trim();
			if (!label && !email) return null;
			return {
				key: collaboratorFilterKey({ userId: collaborator.userId, email }),
				userId: collaborator.userId || null,
				name: label || email,
				email,
				avatar: collaborator.user?.profileImage ?? null,
				accessSource: collaborator.accessSource === 'workspace' ? 'workspace' : 'direct',
			};
		})
		.filter((collaborator): collaborator is NoteCardCollaborator => Boolean(collaborator))
		.sort((left, right) => left.name.localeCompare(right.name));
	if (collaborators.length === 0) return null;
	return { docId, collaborators, count: collaborators.length };
}

function collaboratorMatchesFilter(summary: NoteCardCollaboratorSummary | null | undefined, filter: NoteGridCollaboratorFilter | null | undefined): boolean {
	if (!summary || !filter) return false;
	return summary.collaborators.some((collaborator) => collaborator.key === filter.key);
}

function collaboratorAvatarFallback(name: string): string {
	const value = String(name || '').trim();
	if (!value) return '?';
	return value.slice(0, 1).toUpperCase();
}

export function NoteGrid(props: NoteGridProps): React.JSX.Element {
	const { t } = useI18n();
	const manager = useDocumentManager();
	const connection = useConnectionStatus();
	// Shared notes are mounted into the grid by alias ID so the receiver can open
	// them like local notes while the DocumentManager still resolves them back to
	// the source room via the alias map maintained by App.
	const sharedNoteIds = React.useMemo(() => (props.sharedNotes ?? []).map((note) => note.aliasId), [props.sharedNotes]);
	const sharedNoteIdSet = React.useMemo(() => new Set(sharedNoteIds), [sharedNoteIds]);
	const sharedAliasSignature = React.useMemo(
		() => (props.sharedNotes ?? []).map((note) => `${note.aliasId}:${note.roomId}:${note.role}`).sort().join('|'),
		[props.sharedNotes]
	);

	// Suppress framer-motion layout animations until the parent explicitly
	// enables them (after the splash overlay is fully dismissed). A 2-frame
	// defer after the prop flips ensures cards paint at their final positions
	// before animations can fire.
	const [layoutReady, setLayoutReady] = React.useState(false);
	React.useEffect(() => {
		if (!props.enableLayoutAnimations) return;
		if (layoutReady) return;
		// Two rAFs:
		// - rAF #1: wait for React commit + first paint
		// - rAF #2: wait one more frame so layout is stable, then enable springs
		let raf2 = 0;
		const raf1 = requestAnimationFrame(() => {
			raf2 = requestAnimationFrame(() => setLayoutReady(true));
		});
		return () => {
			cancelAnimationFrame(raf1);
			if (raf2) cancelAnimationFrame(raf2);
		};
	}, [props.enableLayoutAnimations, layoutReady]);

	const pendingSyncNoteIds = React.useMemo(() => new Set(connection.pendingSyncNoteIds), [connection.pendingSyncNoteIds]);
	const [collaboratorSummariesByNoteId, setCollaboratorSummariesByNoteId] = React.useState<Record<string, NoteCardCollaboratorSummary>>({});
	const [openCollaboratorChip, setOpenCollaboratorChip] = React.useState<{
		noteId: string;
		anchorRect: { top: number; left: number; width: number; height: number };
	} | null>(null);

	const [notesList, setNotesList] = React.useState<Y.Array<Y.Map<unknown>> | null>(null);
	const [noteOrder, setNoteOrder] = React.useState<Y.Array<string> | null>(null);

	// Signal to the parent that the grid's initial data is loaded.
	const readyFiredRef = React.useRef(false);

	// ── Yjs-backed note data ─────────────────────────────────────────────
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
	// ── More-menu state ──────────────────────────────────────────────────
	// Tracks which note's long-press more-menu is currently open (null = closed).
	const [moreMenuNoteId, setMoreMenuNoteId] = React.useState<string | null>(null);
	const [moreMenuAnchorRect, setMoreMenuAnchorRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);

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
			suppressTouchDragUntilRef.current = Date.now() + 200;
		};
		window.addEventListener('scroll', onScroll, { passive: true, capture: true });
		return () => {
			window.removeEventListener('scroll', onScroll, true);
		};
	}, []);

	// ── Load Yjs data: notesList + noteOrder ─────────────────────────────
	React.useEffect(() => {
		let cancelled = false;
		(async () => {
			const [list, order] = await Promise.all([manager.getNotesList(), manager.getNoteOrder()]);
			if (cancelled) return;
			setNotesList(list as unknown as Y.Array<Y.Map<unknown>>);
			setNoteOrder(order);
		})();
		return () => { cancelled = true; };
	}, [manager]);

	// ── Subscribe to Yjs changes: notesList + noteOrder ──────────────────
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
		// Local workspace order still comes from Yjs. Shared aliases are appended so
		// they render in the grid without mutating the source workspace's note order.
		return uniqueIds([...readOrderIds(noteOrder), ...sharedNoteIds]);
	}, [noteOrder, sharedNoteIds, storeVersion]);

	const baseVisibleIds = React.useMemo<string[]>(() => {
		return orderedIds.filter((id) => {
			const doc = docsById[id];
			if (!doc) return !props.showTrashed;
			const trashed = readTrashState(doc).trashed;
			return props.showTrashed ? trashed : !trashed;
		});
	}, [orderedIds, docsById, metadataVersion, props.showTrashed]);

	const visibleNoteEntries = React.useMemo(() => {
		const sharedPlacementByAlias = new Map((props.sharedNotes ?? []).map((placement) => [placement.aliasId, placement]));
		return baseVisibleIds
			.map((noteId) => {
				const placement = sharedPlacementByAlias.get(noteId) ?? null;
				const docId = placement?.roomId || (props.activeWorkspaceId ? `${props.activeWorkspaceId}:${noteId}` : '');
				return docId ? { noteId, docId } : null;
			})
			.filter((entry): entry is { noteId: string; docId: string } => Boolean(entry));
	}, [baseVisibleIds, props.activeWorkspaceId, props.sharedNotes]);

	React.useEffect(() => {
		if (!props.authUserId) {
			setCollaboratorSummariesByNoteId({});
			return;
		}
		if (visibleNoteEntries.length === 0) {
			setCollaboratorSummariesByNoteId({});
			return;
		}
		let cancelled = false;

		const applySummaries = (rows: readonly { noteId: string; summary: NoteCardCollaboratorSummary | null }[]) => {
			if (cancelled) return;
			setCollaboratorSummariesByNoteId(() => {
				const next: Record<string, NoteCardCollaboratorSummary> = {};
				for (const row of rows) {
					if (row.summary) next[row.noteId] = row.summary;
				}
				return next;
			});
		};

		void (async () => {
			const cached = await Promise.all(
				visibleNoteEntries.map(async (entry) => ({
					noteId: entry.noteId,
					summary: snapshotToCollaboratorSummary(entry.docId, await readCachedNoteShareCollaborators(props.authUserId || '', entry.docId)),
				}))
			);
			applySummaries(cached);

			if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

			// Refresh visible notes in small batches so collaborator chips converge to
			// server state without stalling the rest of the grid on large workspaces.
			const refreshed: Array<{ noteId: string; summary: NoteCardCollaboratorSummary | null }> = [];
			for (let start = 0; start < visibleNoteEntries.length; start += 6) {
				const batch = visibleNoteEntries.slice(start, start + 6);
				const batchRows = await Promise.all(
					batch.map(async (entry) => ({
						noteId: entry.noteId,
						summary: snapshotToCollaboratorSummary(entry.docId, await syncNoteShareCollaborators(props.authUserId || '', entry.docId, { suppressError: true })),
					}))
				);
				if (cancelled) return;
				refreshed.push(...batchRows);
			}
			applySummaries(refreshed);
		})();

		return () => {
			cancelled = true;
		};
	}, [props.authUserId, props.refreshCollaboratorsToken, visibleNoteEntries]);

	const visibleIds = React.useMemo<string[]>(() => {
		if (!props.activeCollaboratorFilter) return baseVisibleIds;
		return baseVisibleIds.filter((noteId) => collaboratorMatchesFilter(collaboratorSummariesByNoteId[noteId], props.activeCollaboratorFilter));
	}, [baseVisibleIds, collaboratorSummariesByNoteId, props.activeCollaboratorFilter]);

	// ── Commit drag result to Yjs ─────────────────────────────────────────
	// Called by the drag manager's onDrop handler with the raw column layout
	// from the insertion point.  Before writing to Yjs this function:
	//
	// 1. REBALANCES columns: if the tallest column is >2× the shortest
	//    (by summed card height), iteratively moves the bottom card from
	//    the tallest to the shortest until the ratio drops to ≤1.5×.
	//
	// 2. Flattens the balanced result into reading order (row-major) and
	//    writes it to Yjs.  Every device then reconstructs columns locally
	//    with splitIntoColumnsByHeight using its own measured card heights.
	//    stickyColumns preserves the balanced drag result on the local
	//    device so there's no visual jump.
	const commitVisibleOrder = React.useCallback(
		(nextVisibleOrder: string[], finalColumns: string[][], draggedId: string) => {
			if (!noteOrder) return;

			// ── Rebalance: move bottom cards from tallest to shortest ─────
			// Protect the just-dropped card so rebalancing never undoes the
			// user's drag intention.
			const gapPx = mobileGridGapPx ?? readCssPxVariable('--grid-gap', 16);
			const fallbackH = Math.min(props.maxCardHeightPx, 220);
			const heightOf = (id: string) => noteHeightByIdRef.current.get(id) ?? fallbackH;
			const computeColHeights = (cols: string[][]) =>
				cols.map((col) => col.reduce((sum, id, i) => sum + heightOf(id) + (i > 0 ? gapPx : 0), 0));

			const balanced = finalColumns.map((col) => col.slice());
			let colHeights = computeColHeights(balanced);
			let maxH = Math.max(...colHeights);
			let minH = Math.min(...colHeights);

			if (minH > 0 && maxH / minH > 2) {
				for (let moves = 0; moves < balanced.flat().length; moves++) {
					maxH = Math.max(...colHeights);
					minH = Math.min(...colHeights);
					if (minH <= 0 || maxH / minH <= 1.5) break;

					const tallestIdx = colHeights.indexOf(maxH);
					const shortestIdx = colHeights.indexOf(minH);
					if (tallestIdx === shortestIdx || balanced[tallestIdx].length <= 1) break;

					// Never move the card the user just dropped — that would
					// undo the drag.  Skip upward from the bottom until we find
					// a movable card, or give up on this column.
					let candidateIdx = balanced[tallestIdx].length - 1;
					while (candidateIdx >= 0 && balanced[tallestIdx][candidateIdx] === draggedId) {
						candidateIdx--;
					}
					if (candidateIdx < 0) break;

					const [movedId] = balanced[tallestIdx].splice(candidateIdx, 1);
					balanced[shortestIdx].push(movedId);
					colHeights = computeColHeights(balanced);
				}
			}

			// Row-major flatten of balanced columns → canonical order for Yjs.
			const readingOrder = flattenColumns(balanced);
			pendingCommittedVisibleOrderRef.current = readingOrder.slice();
			setLayoutOrderIds((previous) => (arraysEqual(previous, readingOrder) ? previous : readingOrder));
			// Preserve the balanced drag result as stickyColumns so the local
			// device sees the exact column layout from the drag.  Other
			// devices re-pack from the Yjs canonical order with their own
			// card heights.  When a remote update arrives, the flat-order
			// comparison in baseColumns invalidates stale stickyColumns.
			setStickyColumns(balanced);

			const current = readOrderIds(noteOrder);
			const next = mergeVisibleOrderIntoFullOrder(current, visibleIds, readingOrder);
			if (arraysEqual(current, next)) return;
			const ydoc = (noteOrder as YArrayWithDoc<string>).doc;
			ydoc.transact(() => {
				noteOrder.delete(0, noteOrder.length);
				noteOrder.insert(0, next);
			});
		},
		[noteOrder, visibleIds, mobileGridGapPx, props.maxCardHeightPx]
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
	}, [notesList, noteOrder, sharedNoteIds, storeVersion]);

	React.useEffect(() => {
		if (!notesList || !noteOrder) return;
		runNoteGuards(
			readRegistryIds(notesList),
			readOrderIds(noteOrder),
			docsById,
			props.showTrashed ? [] : visibleIds,
		);
	}, [notesList, noteOrder, storeVersion, docsById, props.showTrashed, visibleIds]);

	React.useEffect(() => {
		if (!noteOrder) return;
		for (const id of orderedIds) {
			const currentDoc = docsByIdRef.current[id] ?? null;
			const canonicalDoc = manager.peekDoc(id);
			if (currentDoc && canonicalDoc === currentDoc) continue;
			if (pendingDocLoadsRef.current.has(id)) continue;
			pendingDocLoadsRef.current.add(id);
			void manager
				.getDocWithSync(id)
				.then((doc) => {
					setDocsById((previous) => (previous[id] === doc ? previous : { ...previous, [id]: doc }));
				})
				.catch((error) => {
					console.error('[CRDT] Failed to load note doc:', id, error);
				})
				.finally(() => {
					pendingDocLoadsRef.current.delete(id);
				});
		}
	}, [manager, noteOrder, orderedIds, sharedAliasSignature]);

	// ── Fire onReady once initial docs are loaded ──────────────────────────
	// Wait for every ordered note to have a loaded Y.Doc (or for 0 notes).
	// This tells the parent "data is ready" so the splash can begin fading.
	// Layout animations are NOT enabled here — that's controlled by the
	// enableLayoutAnimations prop (set after splash is fully dismissed).
	React.useEffect(() => {
		if (readyFiredRef.current) return;
		if (!noteOrder) return;
		if (orderedIds.length > 0 && orderedIds.some((id) => !docsById[id])) return;
		readyFiredRef.current = true;
		props.onReady?.();
	}, [noteOrder, orderedIds, docsById, props.onReady]);

	const renderedIds = layoutOrderIds.length > 0 ? layoutOrderIds : visibleIds;
	const noteById = React.useMemo(() => {
		const map = new Map<string, Note>();
		// Persist whether a card is a shared alias so downstream menu and drag logic
		// can disable local-only actions like trashing or reordering that shared notes
		// should not perform inside the receiver workspace.
		for (const id of renderedIds) map.set(id, { id, isShared: sharedNoteIdSet.has(id) });
		return map;
	}, [renderedIds, sharedNoteIdSet]);

	// ── Column computation: packedColumns ─────────────────────────────────
	// Greedy shortest-column masonry: each card from the canonical order is
	// placed into whichever column currently has the least accumulated
	// height.  This produces visually balanced columns at every column
	// count.  Different devices may compute different column assignments
	// (because card heights vary across viewports), but the canonical order
	// in Yjs is deterministic — each device simply packs from it locally.
	// After a drag, the balanced result is preserved as stickyColumns so
	// the dragging device sees an instant result; other devices re-pack
	// from the updated Yjs order using their own heights.
	const packedColumns = React.useMemo(() => {
		void noteHeightsVersion;
		const gapPx = mobileGridGapPx ?? readCssPxVariable('--grid-gap', 16);
		const fallbackH = Math.min(props.maxCardHeightPx, 220);
		return splitIntoColumnsByHeight(renderedIds, columnCount, noteHeightByIdRef.current, gapPx, fallbackH);
	}, [renderedIds, columnCount, noteHeightsVersion, mobileGridGapPx, props.maxCardHeightPx]);

	// ── Reconcile stickyColumns with current card IDs ─────────────────────
	// stickyColumns preserves the column layout from the last drag so cards
	// don't shuffle on re-render.  Cleared when column count changes, IDs
	// change, or ORDER changes (remote Yjs update), falling back to
	// packedColumns (round-robin).
	const baseColumns = React.useMemo(() => {
		if (!stickyColumns || stickyColumns.length !== columnCount) return packedColumns;

		// Verify stickyColumns still match current renderedIds AND order.
		// flattenColumns is the inverse of dealIntoColumns, so if a remote
		// update changed the order, the flat forms will diverge.
		const stickyFlat = flattenColumns(stickyColumns);
		if (!arraysEqual(stickyFlat, renderedIds)) {
			return packedColumns;
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
		canStartDrag: () => props.canReorder !== false && !touchScrollDetectedRef.current && Date.now() >= suppressTouchDragUntilRef.current,
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
	const collaboratorOverlaySummary = openCollaboratorChip ? collaboratorSummariesByNoteId[openCollaboratorChip.noteId] ?? null : null;
	const collaboratorOverlayPosition = React.useMemo(() => {
		if (!openCollaboratorChip || typeof window === 'undefined') return null;
		const overlayWidth = Math.min(320, Math.max(240, Math.round(openCollaboratorChip.anchorRect.width + 84)));
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const left = Math.min(Math.max(12, openCollaboratorChip.anchorRect.left), Math.max(12, viewportWidth - overlayWidth - 12));
		const estimatedHeight = Math.min(240, Math.max(84, (collaboratorOverlaySummary?.count ?? 1) * 44 + 16));
		const preferredTop = openCollaboratorChip.anchorRect.top + openCollaboratorChip.anchorRect.height + 10;
		const top = preferredTop + estimatedHeight <= viewportHeight - 12
			? preferredTop
			: Math.max(12, openCollaboratorChip.anchorRect.top - estimatedHeight - 10);
		return { top, left, width: overlayWidth };
	}, [collaboratorOverlaySummary?.count, openCollaboratorChip]);

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
					suppressTouchDragUntilRef.current = Date.now() + 200;
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
								const collaboratorSummary = collaboratorSummariesByNoteId[note.id];
								return (
										< GridNoteCard
										key={note.id}
										note={note}
										doc={doc}
										metaChips={collaboratorSummary && collaboratorSummary.count > 0 ? (
											<button
												type="button"
												className={styles.noteChipButton}
												onPointerDown={(event) => event.stopPropagation()}
												onClick={(event) => {
													event.stopPropagation();
													const rect = event.currentTarget.getBoundingClientRect();
													setOpenCollaboratorChip((current) => current?.noteId === note.id
														? null
														: {
															noteId: note.id,
															anchorRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
														}
													);
												}}
												aria-label={`${t('share.activeCollaborators')}: ${collaboratorSummary.count}`}
											>
												<FontAwesomeIcon icon={faUsers} />
												<span>{collaboratorSummary.count}</span>
											</button>
										) : undefined}
										canEdit={note.isShared
											? (props.sharedNotes ?? []).find((placement) => placement.aliasId === note.id)?.role === 'EDITOR'
											: props.canEditWorkspaceContent !== false}
										hasPendingSync={pendingSyncNoteIds.has(note.id)}
										selected={props.selectedNoteId === note.id}
										isMoreMenuOpen={moreMenuNoteId === note.id}
										onOpen={() => props.onSelectNote(note.id)}
											onAddCollaborator={props.onAddCollaborator ? () => props.onAddCollaborator?.(note.id, doc.getText('title').toString()) : undefined}
										onMoreMenu={(anchorRect) => {
											// Footer 3-dot triggers provide a custom anchor so desktop
											// popovers align to the card edge instead of the trigger.
									const cardEl = gridRef.current?.querySelector(`[data-note-id="${note.id}"]`);
											setMoreMenuAnchorRect(anchorRect ?? (cardEl ? cardEl.getBoundingClientRect().toJSON() : null));
									setMoreMenuNoteId(note.id);
								}}
										maxCardHeightPx={props.maxCardHeightPx}
										isPlaceholder={isPlaceholder}
										layoutReady={layoutReady}
										setItemElement={dragManager.setItemElement}
										setHandleElement={note.isShared ? () => {} : dragManager.setHandleElement}
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
						metaChips={undefined}
						canEdit={activeNote.isShared
							? (props.sharedNotes ?? []).find((placement) => placement.aliasId === activeNote.id)?.role === 'EDITOR'
							: props.canEditWorkspaceContent !== false}
						hasPendingSync={activeHasPendingSync}
						maxCardHeightPx={props.maxCardHeightPx}
					/>
				</div>
			) : null}
			{typeof document !== 'undefined'
				? createPortal(
					<AnimatePresence>
						{openCollaboratorChip && collaboratorOverlaySummary && collaboratorOverlayPosition ? (
							(() => {
								const shouldCapCollaboratorList = collaboratorOverlaySummary.collaborators.length > 10;
								return (
							<div className={styles.collaboratorOverlayRoot} onPointerDown={() => setOpenCollaboratorChip(null)}>
								<motion.div
									className={styles.collaboratorOverlayPanel}
									style={collaboratorOverlayPosition}
									onPointerDown={(event) => event.stopPropagation()}
									initial={{ opacity: 0, y: -8, scale: 0.985 }}
									animate={{ opacity: 1, y: 0, scale: 1 }}
									exit={{ opacity: 0, y: -8, scale: 0.98 }}
									transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
								>
									<div
										className={`${styles.collaboratorOverlayList}${shouldCapCollaboratorList ? ` ${styles.collaboratorOverlayListScrollable}` : ''}`}
									>
										{collaboratorOverlaySummary.collaborators.map((collaborator, index) => {
											const isActive = props.activeCollaboratorFilter?.key === collaborator.key;
											// Each row grows the panel first, then drops in from above the settled rows.
											const shellDelay = 0.01 + index * 0.035;
											const contentDelay = shellDelay + 0.0125;
											// Later rows start higher so they visibly hop over the earlier collaborators.
											const entryOffset = 18 + index * 32;
											return (
												<motion.div
													key={collaborator.key}
													className={styles.collaboratorOverlayItemShell}
													initial={{ height: 0, marginTop: 0 }}
													animate={{ height: 'auto', marginTop: index === 0 ? 0 : 4 }}
													exit={{ height: 0, marginTop: 0 }}
													transition={{
														height: { duration: 0.06, ease: [0.22, 1, 0.36, 1], delay: shellDelay },
														marginTop: { duration: 0.04, ease: 'easeOut', delay: shellDelay },
													}}
												>
													<motion.button
														type="button"
														className={`${styles.collaboratorOverlayItem}${isActive ? ` ${styles.collaboratorOverlayItemActive}` : ''}`}
														// Keep the newest row above earlier ones while it flies through the stack.
														style={{ zIndex: index + 1 }}
														initial={{ y: -entryOffset, scale: 0.97 }}
														animate={{ y: 0, scale: 1 }}
														exit={{ y: -12, scale: 0.98 }}
														transition={{
															type: 'spring',
															stiffness: 620,
															damping: 30,
															mass: 0.6,
															delay: contentDelay,
														}}
														onClick={() => {
															props.onSelectCollaboratorFilter?.({
																key: collaborator.key,
																userId: collaborator.userId,
																label: collaborator.name,
																email: collaborator.email,
																avatar: collaborator.avatar,
															});
															setOpenCollaboratorChip(null);
														}}
													>
														{collaborator.avatar ? (
															<img className={styles.collaboratorOverlayAvatar} src={collaborator.avatar} alt="" />
														) : (
															<span className={styles.collaboratorOverlayAvatarFallback} aria-hidden="true">
																{collaboratorAvatarFallback(collaborator.name)}
															</span>
														)}
														<span className={styles.collaboratorOverlayName}>{collaborator.name}</span>
													</motion.button>
												</motion.div>
											);
										})}
									</div>
								</motion.div>
							</div>
								);
							})()
						) : null}
					</AnimatePresence>,
					document.body
				)
				: null}
			{moreMenuNoteId && docsById[moreMenuNoteId] ? (
				<NoteCardMoreMenu
					noteType={
						String(docsById[moreMenuNoteId].getMap('metadata').get('type') ?? '') === 'checklist'
							? 'checklist'
							: 'text'
					}
					anchorRect={moreMenuAnchorRect}
					onClose={() => { setMoreMenuNoteId(null); setMoreMenuAnchorRect(null); }}
					onAddCollaborator={props.onAddCollaborator ? () => {
						// The more-menu now routes share/collaboration actions through the
						// dedicated collaborator modal instead of creating ad-hoc share links.
						const noteId = moreMenuNoteId;
						setMoreMenuNoteId(null);
						setMoreMenuAnchorRect(null);
						props.onAddCollaborator?.(noteId);
					} : undefined}
					onTrash={sharedNoteIdSet.has(moreMenuNoteId) ? undefined : () => {
						// Shared aliases are projections of another workspace's document, so the
						// receiver can remove access but cannot locally trash the source note.
						const noteId = moreMenuNoteId;
						setMoreMenuNoteId(null);
						setMoreMenuAnchorRect(null);
						void manager.trashNote(noteId);
					}}
				/>
			) : null}
		</section>
	);
}
