import React from 'react';
import type * as Y from 'yjs';
import { createPortal } from 'react-dom';
import { motion, LayoutGroup, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBell, faFileLines, faFolder, faListCheck, faTag, faThumbtack, faUsers } from '@fortawesome/free-solid-svg-icons';
import { NoteCard } from '../NoteCard/NoteCard';
import { NoteAttachmentCountChip, type NoteAttachmentBrowserKind } from '../NoteAttachments/NoteAttachmentCountChip';
import { NoteCardMoreMenu } from '../NoteCard/NoteCardMoreMenu';
import { addNotePreviewLinkToDoc, extractNoteLinksFromDoc } from '../../core/noteLinks';
import { readEffectiveNoteColorToken, resolveThemeNoteColorModel } from '../../core/noteColors';
import { getUserNoteColorPrefsSnapshot, getUserNoteColorToken, hasUserNoteColorPref, subscribeNoteColorPrefs } from '../../core/noteColorPreferences';
import { useDocumentManager } from '../../core/DocumentManagerContext';
import { runNoteGuards } from '../../core/devGuards';
import { useI18n } from '../../core/i18n';
import { getCachedRemoteNoteLinks, syncNoteLinksForDoc } from '../../core/noteLinkStore';
import { getCachedRemoteNoteImages } from '../../core/noteMediaStore';
import { buildCollectionPathMap, formatCompactCollectionPath, type CollectionRecord } from '../../services/collectionService';
import type { LabelRecord } from '../../services/labelService';
import type { ViewMode } from '../../core/viewMode';
import { NoteListView } from './NoteListView';
import {
	readCachedNoteShareCollaborators,
	syncNoteShareCollaborators,
	type NoteShareCollaboratorSnapshot,
	type SharedNotePlacement,
} from '../../core/noteShareApi';
import { readDrawingLinkState, readNoteFromDoc, setNotePinned } from '../../core/noteModel';
import type { ThemeId } from '../../core/theme';
import { useConnectionStatus } from '../../core/useConnectionStatus';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import {
	getVisibleNotes,
	type NoteGroupingMode,
	type NoteSortMode,
	type ReminderFilterMode,
	type SortDirection,
	type VisibleNoteSnapshot,
} from '../../utilities/getVisibleNotes';
import { buildNoteGroupSections } from '../../utilities/noteGrouping';
import { measureDocumentRects } from './flip';
import {
	arraysEqual,
	buildMasonryLayoutFromColumns,
	flattenColumns,
	getGridLayoutForViewport,
	MOBILE_GRID_EDGE_MARGIN_PX,
	mergeVisibleIdsIntoLayoutOrder,
	mergeVisibleOrderIntoFullOrder,
	readCssPxVariable,
	type StableMasonryPlacementDecision,
	splitIntoColumnsByHeight,
	splitIntoColumnsByHeightAnchored,
} from './layout';
import { useNoteGridDragManager } from './useNoteGridDragManager';
import { VirtualizedNoteColumn } from './VirtualizedNoteColumn';
import { loadNoteHeightCache, saveNoteHeightCache } from '../../core/noteHeightCache';
import { isDebugLoggingEnabled, logClientEvent } from '../../core/debugLogger';
import {
	getLayoutDeviceType,
	getLayoutViewportBucket,
	readNoteGridLayoutSnapshot,
	writeNoteGridLayoutSnapshot,
} from '../../core/noteGridLayoutCache';
import { readNoteOrderSnapshot, writeNoteOrderSnapshot } from '../../core/noteOrderSnapshot';
import {
	buildWorkspaceRenderSnapshotNote,
	createSnapshotDocFromWorkspaceRenderSnapshot,
	readWorkspaceRenderSnapshot,
	toWorkspaceRenderSnapshotPreviewCards,
	type WorkspaceRenderSnapshotNote,
	writeWorkspaceRenderSnapshot,
} from '../../core/workspaceRenderSnapshot';
import styles from './NoteGrid.module.css';
import {
	debugColumnHeightsBefore,
	debugChecklistToggle,
	debugColumnAssignmentChanged,
	debugColumnSwap,
	debugDragCommit,
	debugGridRender,
	debugNotePlacementDecision,
	debugLayoutInvalidation,
	debugNoteHeightInvalidated,
	debugNoteMeasure,
	debugNotePositionAssigned,
	debugNoteRender,
	debugRebalanceDebounced,
	debugRebalanceSkipped,
	debugRebalanceSuppressed,
	debugRepackEnd,
	debugRepackReason,
	debugRepackStart,
	debugSiblingOrderChanged,
	debugStableOrderOverride,
	debugViewportStabilityOverride,
	debugWorkspaceSwitch,
	debugViewSwitch,
	debugHeightVersionBump,
	debugUpdateLiveState,
} from './gridDebug';
import { NoteGridDebugOverlay } from './NoteGridDebugOverlay';

type Note = {
	id: string;
	isShared: boolean;
	isPinned: boolean;
};

export type NoteGridProps = {
	authUserId?: string | null;
	themeId: ThemeId;
	activeWorkspaceId?: string | null;
	selectedNoteId: string | null;
	onSelectNote: (noteId: string) => void;
	onTouchReorderEnd?: () => void;
	onAddCollaborator?: (noteId: string, title?: string) => void;
	onAddImage?: (noteId: string, docId: string, title?: string) => void;
	onAddDocument?: (noteId: string, docId: string, title?: string) => void;
	onMoveToWorkspace?: (noteId: string, title?: string) => void;
	onOpenAttachmentBrowser?: (
		kind: NoteAttachmentBrowserKind,
		noteId: string,
		docId: string,
		title: string | undefined,
		canEdit: boolean
	) => void;
	onSelectCollaboratorFilter?: (filter: NoteGridCollaboratorFilter) => void;
	activeCollaboratorFilter?: NoteGridCollaboratorFilter | null;
	activeCollectionId?: string | null;
	activeLabelIds?: readonly string[];
	collections?: readonly CollectionRecord[];
	labels?: readonly LabelRecord[];
	reminderFilter?: ReminderFilterMode;
	noteReminderByDocId?: Record<string, string | null>;
	sortMode?: NoteSortMode;
	sortDirection?: SortDirection;
	sortGrouping?: NoteGroupingMode;
	refreshCollaboratorsToken?: number;
	canEditWorkspaceContent?: boolean;
	canReorder?: boolean;
	noteCardCheckboxInteractions?: boolean;
	noteCardLinkInteractions?: boolean;
	noteCardCompletedInteractions?: boolean;
	onAddReminder?: (noteId: string, docId: string, title?: string) => void;
	onAddToCollection?: (noteId: string, title?: string) => void;
	onAddLabels?: (noteId: string, title?: string) => void;
	onSelectCollectionFilter?: (collectionId: string) => void;
	onToggleLabelFilter?: (labelId: string) => void;
	maxCardHeightPx: number;
	showTrashed?: boolean;
	showArchived?: boolean;
	emptyStateLabel?: string;
	sharedNotes?: readonly SharedNotePlacement[];
	/** Fires once the initial docs are loaded and the first layout is settled. */
	onReady?: () => void;
	/**
	 * Fires earlier than onReady: once the viewport-visible cards are loaded, measured,
	 * and layout-stable. Used to dismiss the loading overlay without waiting for all
	 * out-of-viewport cards on large workspaces.
	 */
	onViewportReady?: () => void;
	/** Enable framer-motion layout animations. Keep false during initially cold loads. */
	enableLayoutAnimations?: boolean;
	/** Device ID for persisting measured card heights across page loads. */
	deviceId?: string;
	/** Device-aware density/version scope for the local layout snapshot cache. */
	layoutDensityKey?: string;
	/** Active view mode. 'list' and 'strip' replace the masonry grid with flat rows. */
	viewMode?: ViewMode;
	/** True only when the grid is actually visible in layout, not kept mounted under display:none. */
	isVisible?: boolean;
	/** Note ID to suppress from the display — used while a new note is being drafted. */
	hiddenNoteId?: string | null;
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

type NoteMetaOverlayEntry = {
	key: string;
	id: string;
	label: string;
	fullLabel?: string;
	kind: 'collection' | 'label';
	active: boolean;
	color: string | null;
};

function splitCollectionOverlayPath(path: string): string[] {
	return path
		.split(' / ')
		.map((segment) => segment.trim())
		.filter(Boolean);
}

type NoteGridSection = {
	key: string;
	label: string;
	noteIds: string[];
};

const MAX_VISIBLE_COLLABORATORS = 6;
const MAX_VISIBLE_METADATA_ENTRIES = 6;
const INITIAL_DATA_SETTLE_MS = 450;

function hasRenderableNoteContent(doc: Y.Doc): boolean {
	const metadata = doc.getMap<unknown>('metadata');
	if (metadata.size > 0) return true;
	if (doc.getText('title').length > 0) return true;
	if (doc.getText('content').length > 0) return true;
	if (doc.getXmlFragment('contentRich').length > 0) return true;
	if (doc.getArray<Y.Map<unknown>>('checklist').length > 0) return true;
	return false;
}

function ChipOverlayDismissSurface(props: { children: React.ReactNode }): React.JSX.Element {
	return (
		<div
			className={styles.collaboratorOverlayRoot}
			// The shell keeps backdrop taps off the underlying note card while the
			// menu panel itself continues to opt back into pointer interaction.
			style={{ pointerEvents: 'none' }}
		>
			{props.children}
		</div>
	);
}

function isBlockedNoteCardInteractionTarget(target: EventTarget | null): target is HTMLElement {
	if (!(target instanceof HTMLElement)) return false;
	if (target.closest('[data-note-chip-trigger="true"]')) return false;
	if (target.closest('[data-note-chip-panel="true"]')) return false;
	return Boolean(target.closest('[data-note-card="true"], [data-note-list-row="true"]'));
}

function computeColumnHeights(
	columns: readonly string[][],
	heightOf: (id: string) => number,
	gapPx: number
): number[] {
	return columns.map((col) => col.reduce((sum, id, index) => sum + heightOf(id) + (index > 0 ? gapPx : 0), 0));
}

function getHeightSpread(heights: readonly number[]): number {
	if (heights.length === 0) return 0;
	return Math.max(...heights) - Math.min(...heights);
}

function arraysEqualNumbers(a: readonly number[], b: readonly number[]): boolean {
	if (a.length !== b.length) return false;
	for (let index = 0; index < a.length; index++) {
		if (a[index] !== b[index]) return false;
	}
	return true;
}

function collectViewportAnchorColumns(args: {
	columns: readonly string[][];
	grid: HTMLDivElement | null;
	overscanPx: number;
}): Map<string, number> {
	const next = new Map<string, number>();
	if (!args.grid || typeof window === 'undefined') return next;
	const columnById = new Map<string, number>();
	for (let columnIndex = 0; columnIndex < args.columns.length; columnIndex++) {
		for (const noteId of args.columns[columnIndex] ?? []) {
			columnById.set(noteId, columnIndex);
		}
	}
	const viewportTop = -Math.max(0, args.overscanPx);
	const viewportBottom = window.innerHeight + Math.max(0, args.overscanPx);
	const mountedNodes = args.grid.querySelectorAll<HTMLElement>('[data-note-id]');
	for (const node of mountedNodes) {
		const noteId = node.dataset.noteId;
		if (!noteId) continue;
		const columnIndex = columnById.get(noteId);
		if (columnIndex === undefined) continue;
		const rect = node.getBoundingClientRect();
		if (rect.bottom < viewportTop || rect.top > viewportBottom) continue;
		next.set(noteId, columnIndex);
	}
	return next;
}

// Layout-calculation-based alternative to collectViewportAnchorColumns.
// Uses a single getBoundingClientRect() on the grid container (which never
// animates) plus computed note heights to determine visibility.  This is
// accurate even when individual note DOM nodes are mid-animation — e.g. during
// the settle phase after a drag-drop or checklist expand/collapse — where
// querying each card's bounding rect would return transitioning values.
function collectViewportAnchorColumnsFromLayout(args: {
	columns: readonly string[][];
	heightById: ReadonlyMap<string, number>;
	fallbackHeightPx: number;
	gapPx: number;
	grid: HTMLDivElement | null;
	overscanPx: number;
}): Map<string, number> {
	const next = new Map<string, number>();
	if (!args.grid || typeof window === 'undefined') return next;
	const gridTop = args.grid.getBoundingClientRect().top;
	const viewportTop = -Math.max(0, args.overscanPx);
	const viewportBottom = window.innerHeight + Math.max(0, args.overscanPx);
	for (let columnIndex = 0; columnIndex < args.columns.length; columnIndex++) {
		let y = 0;
		for (const noteId of args.columns[columnIndex] ?? []) {
			const height = args.heightById.get(noteId) ?? args.fallbackHeightPx;
			const noteTop = gridTop + y;
			const noteBottom = noteTop + height;
			if (noteBottom >= viewportTop && noteTop <= viewportBottom) {
				next.set(noteId, columnIndex);
			}
			y += height + args.gapPx;
		}
	}
	return next;
}

function buildColumnById(columns: readonly string[][]): Map<string, number> {
	const next = new Map<string, number>();
	for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
		for (const noteId of columns[columnIndex] ?? []) {
			next.set(noteId, columnIndex);
		}
	}
	return next;
}

function buildSiblingIndexById(columns: readonly string[][]): Map<string, number> {
	const next = new Map<string, number>();
	for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
		for (let siblingIndex = 0; siblingIndex < (columns[columnIndex] ?? []).length; siblingIndex++) {
			next.set(columns[columnIndex][siblingIndex], siblingIndex);
		}
	}
	return next;
}

function getColumnVirtualOverscan(columnCount: number, isCoarsePointer: boolean): number {
	if (isCoarsePointer) {
		return columnCount <= 2 ? 6 : 5;
	}
	if (columnCount >= 5) return 3;
	if (columnCount >= 3) return 4;
	return 5;
}

function readColumnSlots(layoutMap: Y.Map<unknown> | null, columnCount: number, itemCount: number): number[] | null {
	if (!layoutMap) return null;
	// Slot lengths only matter when they fully describe the visible layout; partial
	// or mismatched slot data is ignored so stale sync metadata never corrupts packing.
	const raw = layoutMap.get('columnSlots');
	if (!Array.isArray(raw)) return null;
	const slots = raw
		.map((value) => Number(value))
		.filter((value) => Number.isFinite(value))
		.map((value) => Math.max(0, Math.floor(value)));
	if (slots.length !== columnCount) return null;
	if (slots.reduce((sum, value) => sum + value, 0) !== itemCount) return null;
	return slots;
}

/**
 * Simple, safe column rebalancer: on each pass, move only the bottom-most
 * unlocked note of the tallest column to the shortest column.  Never touches
 * mid-column notes, so mid-grid cards never jump unexpectedly.
 *
 * Used after drag-drop (unlocked tail notes migrate) and after checklist
 * expand/collapse (only the last note of the expanded column may move).
 * Transient height oscillations (framer-motion) bypass this entirely.
 */
function rebalanceBottomNote(args: {
	columns: readonly string[][];
	heightOf: (id: string) => number;
	gapPx: number;
	fallbackHeightPx: number;
	lockedPrefixCounts?: readonly number[];
	minSpreadPx?: number;
	maxMoves?: number;
}): string[][] {
	const maxMoves = Math.max(0, args.maxMoves ?? 3);
	const minSpreadPx = Math.max(0, Math.round(args.minSpreadPx ?? Math.max(48, args.fallbackHeightPx * 0.45)));
	const lockedPrefixCounts = (args.lockedPrefixCounts ?? []).map((count) => Math.max(0, Math.floor(count)));
	let current = args.columns.map((col) => col.slice());

	for (let moveCount = 0; moveCount < maxMoves; moveCount++) {
		const currentHeights = computeColumnHeights(current, args.heightOf, args.gapPx);
		const currentSpread = getHeightSpread(currentHeights);
		if (currentSpread <= minSpreadPx) break;

		// Identify the single tallest and single shortest column.
		let tallestIdx = 0;
		let shortestIdx = 0;
		for (let i = 1; i < current.length; i++) {
			if ((currentHeights[i] ?? 0) > (currentHeights[tallestIdx] ?? 0)) tallestIdx = i;
			if ((currentHeights[i] ?? 0) < (currentHeights[shortestIdx] ?? 0)) shortestIdx = i;
		}
		if (tallestIdx === shortestIdx) break;

		// Only the absolute bottom-most unlocked note may migrate.
		const tallestColumn = current[tallestIdx] ?? [];
		const lockedCount = lockedPrefixCounts[tallestIdx] ?? 0;
		const bottomIdx = tallestColumn.length - 1;
		if (bottomIdx < lockedCount) break;

		const nextColumns = current.map((col) => col.slice());
		const [movedId] = nextColumns[tallestIdx].splice(bottomIdx, 1);
		nextColumns[shortestIdx].push(movedId);

		const nextHeights = computeColumnHeights(nextColumns, args.heightOf, args.gapPx);
		const nextSpread = getHeightSpread(nextHeights);
		// Only accept moves that strictly reduce the overall spread.
		if (nextSpread >= currentSpread) break;

		current = nextColumns;
	}

	return current;
}

function findNotePosition(columns: readonly string[][], noteId: string): { columnIndex: number; itemIndex: number } | null {
	for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
		const itemIndex = (columns[columnIndex] ?? []).indexOf(noteId);
		if (itemIndex >= 0) return { columnIndex, itemIndex };
	}
	return null;
}

function measureTailCutIndices(args: {
	columns: readonly string[][];
	changedNoteId: string;
	getItemRect: (id: string) => DOMRect | null;
	overscanPx: number;
}): number[] {
	const changedPosition = findNotePosition(args.columns, args.changedNoteId);
	if (!changedPosition) return args.columns.map(() => 0);
	const changedRect = args.getItemRect(args.changedNoteId);
	const cutoffY = changedRect ? changedRect.bottom + Math.max(0, args.overscanPx) : null;
	const fallbackCut = changedPosition.itemIndex + 1;

	return args.columns.map((column) => {
		let cut = Math.min(column.length, fallbackCut);
		if (cutoffY === null) return cut;
		for (let index = 0; index < column.length; index++) {
			const rect = args.getItemRect(column[index]);
			if (!rect) continue;
			if (rect.top <= cutoffY) {
				cut = Math.max(cut, index + 1);
				continue;
			}
			break;
		}
		return Math.min(column.length, cut);
	});
}

function packColumnsByHeightSeeded(args: {
	ids: readonly string[];
	columnCount: number;
	initialHeights: readonly number[];
	initialItemCounts: readonly number[];
	heightOf: (id: string) => number;
	gapPx: number;
}): string[][] {
	const cols = Math.max(1, args.columnCount);
	const columns: string[][] = Array.from({ length: cols }, () => []);
	const heights = Array.from({ length: cols }, (_, index) => args.initialHeights[index] ?? 0);
	const seedCounts = Array.from({ length: cols }, (_, index) => args.initialItemCounts[index] ?? 0);

	for (const id of args.ids) {
		let bestColumn = 0;
		let bestHeight = heights[0] ?? 0;
		for (let index = 1; index < cols; index++) {
			const nextHeight = heights[index] ?? 0;
			if (nextHeight < bestHeight) {
				bestHeight = nextHeight;
				bestColumn = index;
			}
		}

		columns[bestColumn].push(id);
		const cardHeight = args.heightOf(id);
		const hasExistingStack = seedCounts[bestColumn] > 0 || columns[bestColumn].length > 1;
		heights[bestColumn] = bestHeight + cardHeight + (hasExistingStack ? args.gapPx : 0);
	}

	return columns;
}

export type NoteGridCollaboratorFilter = {
	key: string;
	userId: string | null;
	label: string;
	email: string;
	avatar: string | null;
};

function createFallbackNoteSnapshot(id: string): VisibleNoteSnapshot {
	return {
		id,
		title: '',
		createdAt: 0,
		updatedAt: 0,
		collectionId: null,
		labelIds: [],
		reminderAt: null,
		isPinned: false,
		lastAccessedAt: '',
		trashed: false,
		archived: false,
	};
}

function createVisibleNoteSnapshotFromRenderSnapshot(note: WorkspaceRenderSnapshotNote): VisibleNoteSnapshot {
	return {
		id: note.id,
		title: note.title,
		createdAt: note.createdAt,
		updatedAt: note.updatedAt,
		collectionId: note.collectionId,
		labelIds: [...note.labelIds],
		reminderAt: note.reminderAt,
		isPinned: note.isPinned,
		lastAccessedAt: note.lastAccessedAt,
		trashed: note.trashed,
		archived: note.archived,
	};
}

function estimateUnmeasuredNoteHeightPx(noteId: string, maxCardHeightPx: number): number {
	// Cold-start browsers do not have measured heights yet. Derive a deterministic
	// per-note estimate so skeleton cards and first-pass masonry packing stay in
	// sync until real DOM measurements replace the estimate.
	const idHash = noteId.slice(-8).split('').reduce((acc, character) => (acc * 31 + character.charCodeAt(0)) | 0, 0x9e3779b9);
	return Math.min(maxCardHeightPx, 160 + (Math.abs(idHash) % 220));
}

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
	return uniqueIds(
		notesList
			.toArray()
			.map((row) => normalizeId(row.get('id')))
			.filter(Boolean)
	);
}

function readOrderIds(noteOrder: Y.Array<string>): string[] {
	return uniqueIds(noteOrder.toArray().map((value) => normalizeId(value)).filter(Boolean));
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

function startOfWeek(date: Date): Date {
	const next = new Date(date);
	const day = next.getDay();
	const delta = day === 0 ? -6 : 1 - day;
	next.setDate(next.getDate() + delta);
	next.setHours(0, 0, 0, 0);
	return next;
}

function startOfMonth(date: Date): Date {
	const next = new Date(date);
	next.setDate(1);
	next.setHours(0, 0, 0, 0);
	return next;
}

function addDays(date: Date, days: number): Date {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

function addMonths(date: Date, months: number): Date {
	const next = new Date(date);
	next.setMonth(next.getMonth() + months);
	return next;
}

type GridNoteCardProps = {
	note: Note;
	docId: string | null;
	authUserId?: string | null;
	themeId: ThemeId;
	doc: Y.Doc;
	metaChips?: React.ReactNode;
	forcedHeightPx?: number;
	hasPendingSync: boolean;
	selected: boolean;
	isMoreMenuOpen: boolean;
	onOpen?: () => void;
	onAddReminder?: () => void;
	reminderAt?: string | null;
	onRestoreNote?: () => void;
	onAddCollaborator?: () => void;
	onAddImage?: () => void;
	onMoreMenu: (anchorRect?: { top: number; left: number; width: number; height: number } | null) => void;
	canEdit: boolean;
	allowChecklistItemInteractions?: boolean;
	allowLinkInteractions?: boolean;
	allowCompletedItemInteractions?: boolean;
	isTrashView?: boolean;
	maxCardHeightPx: number;
	isPlaceholder: boolean;
	initialLinkRecords?: React.ComponentProps<typeof NoteCard>['initialLinkRecords'];
	preserveControlShell?: boolean;
	isOverlayActiveCard?: boolean;
	layoutReady: boolean;
	dropSettling?: boolean;
	hideDuringDropSettle?: boolean;
	disablePositionLayout?: boolean;
	setItemElement: (id: string, node: HTMLDivElement | null) => void;
	setHandleElement: (id: string, node: HTMLDivElement | null) => void;
};

const GRID_LAYOUT_TRANSITION = { type: 'spring', stiffness: 700, damping: 50, mass: 0.8 } as const;
const GRID_DROP_SETTLE_TRANSITION = { type: 'spring', stiffness: 430, damping: 36, mass: 1 } as const;

const DragPreviewMarkup = React.memo(function DragPreviewMarkup(props: { markup: string }): React.JSX.Element {
	return <div className={styles.dragPreviewMarkup} aria-hidden="true" dangerouslySetInnerHTML={{ __html: props.markup }} />;
});

/**
 * Resolves CSS custom-property overrides for a note's color scheme.
 *
 * Priority: user-scoped preference override → legacy shared-doc fallback.
 * Explicit per-user clears also suppress the old shared-doc token.
 */
function getNoteColorVars(noteId: string, doc: Y.Doc, themeId: ThemeId): React.CSSProperties | undefined {
	const token = readEffectiveNoteColorToken(
		doc.getMap<any>('metadata'),
		getUserNoteColorToken(noteId),
		hasUserNoteColorPref(noteId)
	);
	if (!token) return undefined;
	const resolved = resolveThemeNoteColorModel(themeId).tokens[token];
	return {
		'--note-color-card-bg': resolved.cardBackground,
		'--note-color-header-bg': resolved.headerBackground,
		'--note-color-border': resolved.borderColor,
		'--note-color-text': resolved.textColor,
		'--note-color-muted': resolved.mutedTextColor,
		'--note-color-accent': resolved.accentColor,
	} as React.CSSProperties;
}

function readChipOverlayAnchorRect(element: HTMLElement | null): { top: number; left: number; width: number; height: number } | null {
	if (!element) return null;
	// Use the full note-card shell for horizontal geometry so every chip dropdown
	// has the same width/centering, but keep the trigger button's vertical rect so
	// the panel opens directly below the chip row (or flips above that row).
	const triggerRect = element.getBoundingClientRect();
	const cardShell = element.closest('[data-note-content="true"]');
	const target = cardShell instanceof HTMLElement ? cardShell : element;
	const cardRect = target.getBoundingClientRect();
	return { top: triggerRect.top, left: cardRect.left, width: cardRect.width, height: triggerRect.height };
}

function renderMetaChipShell(
	icon: typeof faFolder | typeof faTag | typeof faUsers,
	count: number,
	label: string,
	colorStyle: React.CSSProperties
): React.ReactNode {
	return (
		<span
			className={styles.noteChipButton}
			style={colorStyle}
			aria-label={label}
			onPointerDown={(event) => event.stopPropagation()}
			onClick={(event) => event.stopPropagation()}
		>
			<FontAwesomeIcon icon={icon} />
			<span>{count}</span>
		</span>
	);
}

function renderNoteMetaChips(args: {
	noteId: string;
	docId: string | null;
	doc: Y.Doc;
	sharedPlacement?: SharedNotePlacement | null;
	themeId: ThemeId;
	collectionPathById: Map<string, string>;
	labelById: Map<string, LabelRecord>;
	activeCollectionId?: string | null;
	activeLabelIds?: readonly string[];
	authUserId?: string | null;
	canEditNote: boolean;
	suspendAttachmentRemoteRefresh?: boolean;
	disableAttachmentInitialRemoteRefresh?: boolean;
	forceCloseAttachmentChip?: boolean;
	collaboratorSummary?: NoteCardCollaboratorSummary | null;
	snapshotShell?: WorkspaceRenderSnapshotNote | null;
	onOpenAttachmentBrowser?: (
		kind: NoteAttachmentBrowserKind,
		noteId: string,
		docId: string,
		title: string | undefined,
		canEdit: boolean
	) => void;
	onToggleCollaboratorChip?: (noteId: string, anchorRect: { top: number; left: number; width: number; height: number }) => void;
	onOpenMetadataChip?: (args: {
		noteId: string;
		kind: 'collection' | 'label';
		anchorRect: { top: number; left: number; width: number; height: number };
		entries: NoteMetaOverlayEntry[];
	}) => void;
	onAttachmentChipOpenStateChange?: (noteId: string, isOpen: boolean) => void;
	t: (key: string) => string;
	title?: string;
}): React.ReactNode | undefined {
	const note = readNoteFromDoc(args.doc, args.noteId);
	const collectionId = args.sharedPlacement ? args.sharedPlacement.collectionId : note.collectionId;
	const labelIds = args.sharedPlacement ? args.sharedPlacement.labelIds : note.labelIds;
	const collectionPath = collectionId ? args.collectionPathById.get(collectionId) ?? null : null;
	const labelItems = labelIds
		.map((labelId) => args.labelById.get(labelId) ?? null)
		.filter((label): label is LabelRecord => Boolean(label));
	const fallbackCollaboratorCount = Math.max(0, args.snapshotShell?.collaboratorCount ?? 0);
	const collaboratorCount = args.collaboratorSummary?.count ?? fallbackCollaboratorCount;
	const noteType = String(args.doc.getMap('metadata').get('type') ?? '');
	const attachmentAllowedKinds: readonly NoteAttachmentBrowserKind[] | undefined = noteType === 'drawing'
		? ['links']
		: undefined;
	const attachmentShellCounts = args.snapshotShell?.attachmentCounts;
	const attachmentShellTotal = (attachmentShellCounts?.images ?? 0) + (attachmentShellCounts?.links ?? 0) + (attachmentShellCounts?.drawings ?? 0);
	const showCollectionShell = Boolean(collectionId && !collectionPath);
	const showLabelShell = labelIds.length > 0 && labelItems.length === 0;
	const showCollaboratorShell = (!args.collaboratorSummary || args.collaboratorSummary.count <= 0) && collaboratorCount > 0;
	if (!collectionPath && !showCollectionShell && labelItems.length === 0 && !showLabelShell && collaboratorCount <= 0 && (!args.docId || attachmentShellTotal <= 0)) {
		return undefined;
	}
	const chipColorStyle = getNoteColorVars(args.noteId, args.doc, args.themeId);
	const collectionChipCount = collectionId ? '1' : null;
	const labelChipCount = `${labelItems.length}`;

	return (
		<>
			{collectionPath && collectionId ? (
				<button
					type="button"
					className={styles.noteChipButton}
					data-note-chip-trigger="true"
					style={chipColorStyle}
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation();
						const rect = readChipOverlayAnchorRect(event.currentTarget);
						if (!rect) return;
						args.onOpenMetadataChip?.({
							noteId: args.noteId,
							kind: 'collection',
							anchorRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
							entries: [{
								key: `collection:${collectionId}`,
								id: collectionId,
								label: formatCompactCollectionPath(collectionPath),
								fullLabel: collectionPath,
								kind: 'collection',
								active: args.activeCollectionId === collectionId,
								color: null,
							}],
						});
					}}
					aria-label={`Collection: ${collectionPath}`}
				>
					<FontAwesomeIcon icon={faFolder} />
					<span>{collectionChipCount}</span>
				</button>
			) : showCollectionShell && collectionChipCount ? (
				renderMetaChipShell(faFolder, 1, args.t('note.collection'), chipColorStyle)
			) : null}
			{labelItems.length > 0 ? (
				<button
					type="button"
					className={styles.noteChipButton}
					data-note-chip-trigger="true"
					style={chipColorStyle}
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation();
						const rect = readChipOverlayAnchorRect(event.currentTarget);
						if (!rect) return;
						args.onOpenMetadataChip?.({
							noteId: args.noteId,
							kind: 'label',
							anchorRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
							entries: labelItems.map((label) => ({
								key: `label:${label.id}`,
								id: label.id,
								label: label.name,
								kind: 'label',
								active: Boolean(args.activeLabelIds?.includes(label.id)),
								color: label.color ?? null,
							})),
						});
					}}
					aria-label={`Labels: ${labelChipCount}`}
				>
					<FontAwesomeIcon icon={faTag} />
					<span>{labelChipCount}</span>
				</button>
			) : showLabelShell ? (
				renderMetaChipShell(faTag, labelIds.length, args.t('note.labels'), chipColorStyle)
			) : null}
			{args.collaboratorSummary && args.collaboratorSummary.count > 0 ? (
				<button
					type="button"
					className={styles.noteChipButton}
					data-note-chip-trigger="true"
					style={chipColorStyle}
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation();
						const rect = readChipOverlayAnchorRect(event.currentTarget);
						if (!rect) return;
						args.onToggleCollaboratorChip?.(args.noteId, {
							top: rect.top,
							left: rect.left,
							width: rect.width,
							height: rect.height,
						});
					}}
					aria-label={`${args.t('share.activeCollaborators')}: ${args.collaboratorSummary.count}`}
				>
					<FontAwesomeIcon icon={faUsers} />
					<span>{args.collaboratorSummary.count}</span>
				</button>
			) : showCollaboratorShell ? (
				renderMetaChipShell(faUsers, collaboratorCount, args.t('share.activeCollaborators'), chipColorStyle)
			) : null}
			{args.docId ? (
				<NoteAttachmentCountChip
					docId={args.docId}
					doc={args.doc}
					authUserId={args.authUserId}
					className={styles.noteChipButton}
					colorStyle={chipColorStyle}
					allowedKinds={attachmentAllowedKinds}
					initialCounts={attachmentShellCounts}
					forceClosed={args.forceCloseAttachmentChip}
					suspendRemoteRefresh={args.suspendAttachmentRemoteRefresh}
					disableInitialRemoteRefresh={args.disableAttachmentInitialRemoteRefresh}
					onOpenStateChange={(isOpen) => args.onAttachmentChipOpenStateChange?.(args.noteId, isOpen)}
					onOpenBrowser={(kind) => args.onOpenAttachmentBrowser?.(kind, args.noteId, args.docId || '', args.title, args.canEditNote)}
				/>
			) : null}
		</>
	);
}

const GridNoteCard = React.memo(function GridNoteCard(props: GridNoteCardProps): React.JSX.Element {
	React.useEffect(() => {
		debugNoteRender(props.note.id, {
			selected: props.selected,
			layoutReady: props.layoutReady,
			dropSettling: Boolean(props.dropSettling),
			isPlaceholder: props.isPlaceholder,
		});
	});

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
			layout={props.disablePositionLayout ? false : 'position'}
			layoutId={props.disablePositionLayout ? undefined : props.note.id}
			initial={false}
			transition={
				props.layoutReady && !props.disablePositionLayout
					? {
						layout: props.dropSettling ? GRID_DROP_SETTLE_TRANSITION : GRID_LAYOUT_TRANSITION,
					}
					: { layout: { duration: 0 } }
			}
			className={[
				styles.item,
				props.isOverlayActiveCard ? styles.itemOverlayActive : '',
				props.hideDuringDropSettle ? styles.itemDropSettlingHidden : '',
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
					docId={props.docId || undefined}
					authUserId={props.authUserId}
					themeId={props.themeId}
					doc={props.doc}
					metaChips={props.metaChips}
					canEdit={props.canEdit}
					isPinned={props.note.isPinned}
					reminderAt={props.reminderAt}
					forcedHeightPx={props.forcedHeightPx}
					hasPendingSync={props.hasPendingSync}
					isMoreMenuOpen={props.isMoreMenuOpen}
					maxCardHeightPx={props.maxCardHeightPx}
					onOpen={props.onOpen}
					onAddReminder={props.onAddReminder}
					onRestoreNote={props.onRestoreNote}
					onAddCollaborator={props.onAddCollaborator}
					onAddImage={props.onAddImage}
					onMoreMenu={props.onMoreMenu}
					allowChecklistItemInteractions={props.allowChecklistItemInteractions}
					allowLinkInteractions={props.allowLinkInteractions}
					allowCompletedItemInteractions={props.allowCompletedItemInteractions}
					isTrashView={props.isTrashView}
					initialLinkRecords={props.initialLinkRecords}
					preserveControlShell={props.preserveControlShell}
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
	if (!snapshot) {
		return null;
	}
	const collaboratorsByKey = new Map<string, NoteCardCollaborator>();
	const upsertCollaborator = (candidate: NoteCardCollaborator | null): void => {
		if (!candidate) return;
		collaboratorsByKey.set(candidate.key, candidate);
	};
	const mapUserLike = (
		user: { id?: string | null; name?: string | null; email?: string | null; profileImage?: string | null } | null | undefined,
		accessSource: 'direct' | 'workspace'
	): NoteCardCollaborator | null => {
		const label = String(user?.name || user?.email || user?.id || '').trim();
		const email = String(user?.email || '').trim();
		const userId = typeof user?.id === 'string' ? user.id : null;
		if (!label && !email) return null;
		return {
			key: collaboratorFilterKey({ userId, email }),
			userId,
			name: label || email,
			email,
			avatar: user?.profileImage ?? null,
			accessSource,
		};
	};

	upsertCollaborator(mapUserLike(snapshot.sharedBy, 'direct'));
	for (const collaborator of snapshot.collaborators ?? []) {
		upsertCollaborator(mapUserLike({
			id: collaborator.userId,
			name: collaborator.user?.name,
			email: collaborator.user?.email,
			profileImage: collaborator.user?.profileImage,
		}, collaborator.accessSource === 'workspace' ? 'workspace' : 'direct'));
	}
	const collaborators = Array.from(collaboratorsByKey.values()).sort((left, right) => left.name.localeCompare(right.name));
	if (collaborators.length === 0) return null;
	return { docId, collaborators, count: collaborators.length };
}

function collaboratorMatchesFilter(summary: NoteCardCollaboratorSummary | null | undefined, filter: NoteGridCollaboratorFilter | null | undefined): boolean {
	if (!summary || !filter) return false;
	return summary.collaborators.some((collaborator) => collaborator.key === filter.key);
}

function preventChipOverlayRowPressBubble(event: React.SyntheticEvent): void {
	// Overlay rows need to stop the press from reaching the card beneath them, but
	// must still complete their own click so filter actions continue to fire.
	event.stopPropagation();
}

function collaboratorAvatarFallback(name: string): string {
	const value = String(name || '').trim();
	if (!value) return '?';
	return value.slice(0, 1).toUpperCase();
}

function setChecklistCompletedState(doc: Y.Doc, completed: boolean): void {
	const checklist = doc.getArray<Y.Map<unknown>>('checklist');
	if (checklist.length === 0) return;
	doc.transact(() => {
		for (const item of checklist.toArray()) {
			item.set('completed', completed);
		}
	});
}

export function NoteGrid(props: NoteGridProps): React.JSX.Element {
	const { t } = useI18n();
	React.useSyncExternalStore(subscribeNoteColorPrefs, getUserNoteColorPrefsSnapshot, getUserNoteColorPrefsSnapshot);
	const manager = useDocumentManager();
	const connection = useConnectionStatus();
	const isDevBuild =
		(typeof (import.meta as any).env !== 'undefined' && (import.meta as any).env.DEV) ||
		(typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production');
	const startupDebugEnabled = isDevBuild || isDebugLoggingEnabled();
	const resolveMediaDocId = React.useCallback((noteId: string): string => {
		try {
			// Shared aliases need to resolve back to their source room so media and
			// collaborator lookups hit the real document namespace instead of the alias.
			return manager.resolveRoomName(noteId);
		} catch {
			return props.activeWorkspaceId ? `${props.activeWorkspaceId}:${noteId}` : '';
		}
	}, [manager, props.activeWorkspaceId]);
	// Shared notes are mounted into the grid by alias ID so the receiver can open
	// them like local notes while the DocumentManager still resolves them back to
	// the source room via the alias map maintained by App.
	const sharedNoteIds = React.useMemo(() => (props.sharedNotes ?? []).map((note) => note.aliasId), [props.sharedNotes]);
	const sharedNoteIdSet = React.useMemo(() => new Set(sharedNoteIds), [sharedNoteIds]);
	const sharedAliasSignature = React.useMemo(
		() => (props.sharedNotes ?? []).map((note) => `${note.aliasId}:${note.roomId}:${note.role}`).sort().join('|'),
		[props.sharedNotes]
	);

	// all docs are loaded → the startup splash can fade out and layout animations can start.
	const [allDocsLoaded, setAllDocsLoaded] = React.useState(false);
	// Prevents allDocsLoaded from reverting to false after the initial load completes
	// (e.g. creating a new note later should not restart the startup gate).
	const initialLoadCompleteRef = React.useRef(false);
	// On fresh login, IDB docs hydrate almost instantly (empty IDB), but content
	// arrives later over WebSocket. Keep the shimmer up until the registry room
	// has completed its first WS sync so cards render with real content heights.
	// Once true it stays true for the active workspace load and is rearmed on
	// workspace/view changes.

	// Suppress framer-motion layout animations until all docs are loaded and two
	// paint frames have passed (so cards settle before springs can fire).
	const [layoutReady, setLayoutReady] = React.useState(false);
	const [initialDataSettled, setInitialDataSettled] = React.useState(false);
	const [initialLayoutSettled, setInitialLayoutSettled] = React.useState(false);
	const [startupLayoutAnimationsReady, setStartupLayoutAnimationsReady] = React.useState(false);
	const readyNotifiedRef = React.useRef(false);
	/** True once the first viewportCapacity-worth of cards are measured and stable. Drives onViewportReady. */
	// Never initialise to true: an immediately-true state causes onViewportReady to
	// fire on mount before the App.tsx workspace-switch effect has shown the splash,
	// setting viewportReadyNotifiedRef=true and blocking any later fire when the data
	// is genuinely ready.  The viewportLayoutSettled effect drives this to true quickly
	// (within a couple of async ticks + 2 rAFs) once noteOrder and docs are available.
	const [viewportLayoutSettled, setViewportLayoutSettled] = React.useState(false);
	const viewportReadyNotifiedRef = React.useRef(false);
	const startupDebugSnapshotRef = React.useRef<string>('');

	// ── Shimmer guard: 200 ms grace period after registry WS sync ────────
	// When registryWsSynced first fires, Yjs note-order data may not have
	// propagated to React's orderedIds in the same render cycle. Hold the
	// shimmer for up to 200 ms so notes can arrive before we conclude the
	// workspace is genuinely empty. Without this, a fresh login can briefly
	// show an empty grid then flood with cards — the "chaotic grid" bug.
	const [wsSyncJustFired, setWsSyncJustFired] = React.useState(false);
	const prevRegistryWsSyncedRef = React.useRef(connection.registryWsSynced);
	React.useEffect(() => {
		const prev = prevRegistryWsSyncedRef.current;
		prevRegistryWsSyncedRef.current = connection.registryWsSynced;
		if (connection.registryWsSynced && !prev) {
			setWsSyncJustFired(true);
			const id = setTimeout(() => setWsSyncJustFired(false), 200);
			return () => clearTimeout(id);
		}
		if (!connection.registryWsSynced) {
			setWsSyncJustFired(false);
		}
	}, [connection.registryWsSynced]);

	// ── Shimmer guard: stall timeout ─────────────────────────────────────
	// If the shimmer has been up for more than 5 s without resolving (e.g.
	// WS sync stalls on a flaky connection), force-clear it so the user
	// never sees an infinite spinner. 5 s covers even very slow connections.
	const SHIMMER_STALL_TIMEOUT_MS = 5000;
	const [shimmerStalled, setShimmerStalled] = React.useState(false);
	React.useEffect(() => {
		if (allDocsLoaded) {
			setShimmerStalled(false);
			return;
		}
		const id = setTimeout(() => setShimmerStalled(true), SHIMMER_STALL_TIMEOUT_MS);
		return () => clearTimeout(id);
	}, [allDocsLoaded]);
	React.useEffect(() => {
		if (!props.enableLayoutAnimations) return;
		if (!allDocsLoaded) return; // wait for shimmer to finish before enabling springs
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
	}, [props.enableLayoutAnimations, allDocsLoaded, layoutReady]);

	const getEstimatedNoteHeight = React.useCallback(
		(noteId: string): number => estimateUnmeasuredNoteHeightPx(noteId, props.maxCardHeightPx),
		[props.maxCardHeightPx]
	);
	const packedHeightLookup = React.useMemo<Pick<ReadonlyMap<string, number>, 'get'>>(
		() => ({
			get: (noteId: string) => noteHeightByIdRef.current.get(noteId) ?? getEstimatedNoteHeight(noteId),
		}),
		[getEstimatedNoteHeight]
	);

	const pendingSyncNoteIds = React.useMemo(() => new Set(connection.pendingSyncNoteIds), [connection.pendingSyncNoteIds]);
	// Stable primitive signature for use as effect dep.  The Set object above is a new
	// reference whenever `connectionSnapshot` is emitted (even if content is identical),
	// which would cause the collaborator sync effect to re-run spuriously every time the
	// Yjs WS connection state changes (e.g., offline → connecting → synced).
	// DocumentManager already sorts the IDs, so a plain join produces a deterministic key.
	const pendingSyncNoteIdsSignature = React.useMemo(
		() => connection.pendingSyncNoteIds.join('|'),
		[connection.pendingSyncNoteIds],
	);
	const [collaboratorSummariesByNoteId, setCollaboratorSummariesByNoteId] = React.useState<Record<string, NoteCardCollaboratorSummary>>({});
	const [openCollaboratorChip, setOpenCollaboratorChip] = React.useState<{
		noteId: string;
		anchorRect: { top: number; left: number; width: number; height: number };
	} | null>(null);
	const [openMetadataChip, setOpenMetadataChip] = React.useState<{
		noteId: string;
		kind: 'collection' | 'label';
		anchorRect: { top: number; left: number; width: number; height: number };
		entries: NoteMetaOverlayEntry[];
	} | null>(null);
	const [openAttachmentChipNoteId, setOpenAttachmentChipNoteId] = React.useState<string | null>(null);
	const [latchedOverlayNoteId, setLatchedOverlayNoteId] = React.useState<string | null>(null);
	const isCoarsePointer = useIsCoarsePointer();
	const collaboratorOverlayPanelRef = React.useRef<HTMLDivElement | null>(null);
	// ── DEBUG: tracks previous collaborator-sync effect deps to surface which one changed ──
	const prevCollabSyncDepsRef = React.useRef<{
		pendingSyncSig: string;
		authUserId: string | null | undefined;
		refreshToken: number;
		noteSig: string;
	} | null>(null);
	const collaboratorOverlayListRef = React.useRef<HTMLDivElement | null>(null);
	const metadataOverlayPanelRef = React.useRef<HTMLDivElement | null>(null);
	const collaboratorTouchYRef = React.useRef<number | null>(null);
	const collaboratorBackStatePushedRef = React.useRef(false);
	const chipInteractionGuardTimerRef = React.useRef<number>(0);
	const overlayReleaseTimerRef = React.useRef<number>(0);
	const suppressGridOpenUntilRef = React.useRef(0);
	const suppressNoteCardInteractionUntilRef = React.useRef(0);
	const [isChipInteractionGuardActive, setIsChipInteractionGuardActive] = React.useState(false);

	const [notesList, setNotesList] = React.useState<Y.Array<Y.Map<unknown>> | null>(null);
	const [noteOrder, setNoteOrder] = React.useState<Y.Array<string> | null>(null);
	const [noteLayout, setNoteLayout] = React.useState<Y.Map<unknown> | null>(null);

	// ── Height cache: load stored heights from localStorage on mount ───────
	// Seeding noteHeightByIdRef before the first render ensures masonry packing
	// uses correct heights immediately — no repack during hydration.
	const heightCacheLoadedRef = React.useRef(false);
	const heightSaveTimerRef = React.useRef<number>(0);

	// ── Yjs-backed note data ─────────────────────────────────────────────
	const [docsById, setDocsById] = React.useState<Record<string, Y.Doc>>({});
	const docsByIdRef = React.useRef<Record<string, Y.Doc>>({});
	const pendingDocLoadsRef = React.useRef<Set<string>>(new Set());
	const versionRef = React.useRef(0);
	const [metadataVersion, setMetadataVersion] = React.useState(0);
	const [layoutOrderIds, setLayoutOrderIds] = React.useState<string[]>([]);
	// Lazy-initialize layout state from the current viewport so the very first render
	// already uses the correct column count and card widths — eliminating the jarring
	// 2-column → N-column reflash that previously occurred during the skeleton phase.
	const [columnCount, setColumnCount] = React.useState<number>(() => {
		if (typeof window === 'undefined') return 2;
		return getGridLayoutForViewport(window.innerWidth, window.innerWidth, window.innerHeight).columnCount;
	});
	const [mobileCardWidthPx, setMobileCardWidthPx] = React.useState<number | null>(() => {
		if (typeof window === 'undefined') return null;
		return getGridLayoutForViewport(window.innerWidth, window.innerWidth, window.innerHeight).mobileCardWidthPx;
	});
	const [mobileGridGapPx, setMobileGridGapPx] = React.useState<number | null>(() => {
		if (typeof window === 'undefined') return null;
		return getGridLayoutForViewport(window.innerWidth, window.innerWidth, window.innerHeight).mobileGapPx;
	});
	const [mobileSectionBleedPx, setMobileSectionBleedPx] = React.useState<number>(() => {
		if (typeof window === 'undefined') return 0;
		return getGridLayoutForViewport(window.innerWidth, window.innerWidth, window.innerHeight).mobileSectionBleedPx;
	});
	const [noteHeightsVersion, setNoteHeightsVersion] = React.useState(0);
	const latestNoteHeightsVersionRef = React.useRef(0);
	const pendingCommittedVisibleOrderRef = React.useRef<string[] | null>(null);
	const appliedLayoutCacheKeyRef = React.useRef<string | null>(null);
	const sectionRef = React.useRef<HTMLElement | null>(null);
	// Tracks which checklist cards currently have their completed section open.
	// Used to apply padding-bottom to the section only while any card is expanded.
	const expandedChecklistNoteIdsRef = React.useRef<Set<string>>(new Set());
	const gridRef = React.useRef<HTMLDivElement | null>(null);
	const noteHeightByIdRef = React.useRef<Map<string, number>>(new Map());
	const viewportAnchorColumnsRef = React.useRef<Map<string, number>>(new Map());
	const viewportAnchorSourceColumnsRef = React.useRef<string[][]>([]);
	const settledColumnByIdRef = React.useRef<Map<string, number>>(new Map());
	const settledSiblingIndexByIdRef = React.useRef<Map<string, number>>(new Map());
	const settledColumnsRef = React.useRef<string[][]>([]);
	const invalidatedNoteReasonsRef = React.useRef<Map<string, string>>(new Map());
	const recentlyMovedNoteIdsRef = React.useRef<Set<string>>(new Set());
	const expansionAffectedNoteIdsRef = React.useRef<Set<string>>(new Set());
	const lastRebalanceSuppressionReasonRef = React.useRef<string | null>(null);
	const repackReasonRef = React.useRef('initial-mount');
	const noteHeightBumpRafRef = React.useRef<number>(0);
	const noteCardLayoutRefreshRafRef = React.useRef<number>(0);
	const layoutSnapshotHeightSeedKeyRef = React.useRef<string | null>(null);


	// Seed height cache on first render from localStorage (before first pack)
	if (!heightCacheLoadedRef.current) {
		heightCacheLoadedRef.current = true;
		if (props.deviceId) {
			const cached = loadNoteHeightCache(props.deviceId);
			for (const [k, v] of cached) noteHeightByIdRef.current.set(k, v);
		}
	}
	const layoutViewportBucket = React.useMemo(
		() => typeof window !== 'undefined' ? getLayoutViewportBucket(window.innerWidth, window.innerHeight) : '0x0',
		[]
	);
	const layoutDeviceType = React.useMemo(
		() => typeof window !== 'undefined' ? getLayoutDeviceType(window.innerWidth) : 'desktop',
		[]
	);
	const layoutDensityKey = props.layoutDensityKey || 'default';
	const cachedLayoutSnapshot = React.useMemo(() => {
		if (!props.activeWorkspaceId) return null;
		return readNoteGridLayoutSnapshot({
			workspaceId: props.activeWorkspaceId,
			viewMode: props.viewMode ?? 'card',
			deviceType: layoutDeviceType,
			density: layoutDensityKey,
			viewportBucket: layoutViewportBucket,
		});
	}, [layoutDensityKey, layoutDeviceType, layoutViewportBucket, props.activeWorkspaceId, props.viewMode]);
	const cachedLayoutSnapshotSeedKey = cachedLayoutSnapshot
		? `${props.activeWorkspaceId}:${props.viewMode ?? 'card'}:${layoutDeviceType}:${layoutDensityKey}:${layoutViewportBucket}:${cachedLayoutSnapshot.savedAt}`
		: null;

	// Seed warm-load masonry with the last settled per-note rect heights from the
	// layout snapshot. Order/column slots alone are not enough; without the cached
	// heights, the first pack falls back to generic estimates and notes visibly
	// shuffle once live measurements arrive.
	if (cachedLayoutSnapshotSeedKey && layoutSnapshotHeightSeedKeyRef.current !== cachedLayoutSnapshotSeedKey) {
		layoutSnapshotHeightSeedKeyRef.current = cachedLayoutSnapshotSeedKey;
		for (const rect of cachedLayoutSnapshot.rects) {
			if (rect.height > 0) {
				noteHeightByIdRef.current.set(rect.noteId, Math.round(rect.height));
			}
		}
	}
	const workspaceRenderSnapshot = React.useMemo(
		() => readWorkspaceRenderSnapshot(props.activeWorkspaceId),
		[props.activeWorkspaceId]
	);
	const workspaceRenderSnapshotNoteById = React.useMemo(
		() => new Map((workspaceRenderSnapshot?.notes ?? []).map((note) => [note.id, note] as const)),
		[workspaceRenderSnapshot]
	);
	const snapshotDocCacheRef = React.useRef<Map<string, { signature: string; doc: Y.Doc }>>(new Map());
	const snapshotDocById = React.useMemo(() => {
		const nextCache = new Map<string, { signature: string; doc: Y.Doc }>();
		const nextDocs = new Map<string, Y.Doc>();
		for (const note of workspaceRenderSnapshot?.notes ?? []) {
			const signature = JSON.stringify(note);
			const cached = snapshotDocCacheRef.current.get(note.id);
			const doc = cached && cached.signature === signature
				? cached.doc
				: createSnapshotDocFromWorkspaceRenderSnapshot(note);
			nextCache.set(note.id, { signature, doc });
			nextDocs.set(note.id, doc);
		}
		snapshotDocCacheRef.current = nextCache;
		return nextDocs;
	}, [workspaceRenderSnapshot]);
	React.useEffect(() => {
		if (!props.activeWorkspaceId) return;
		void logClientEvent(cachedLayoutSnapshot ? 'LAYOUT_CACHE_HIT' : 'LAYOUT_CACHE_MISS', {
			workspaceId: props.activeWorkspaceId,
			viewMode: props.viewMode ?? 'card',
			deviceType: layoutDeviceType,
			density: layoutDensityKey,
			viewportBucket: layoutViewportBucket,
		});
	}, [cachedLayoutSnapshot, layoutDensityKey, layoutDeviceType, layoutViewportBucket, props.activeWorkspaceId, props.viewMode]);

	// ── Viewport capacity estimate ────────────────────────────────────────
	// How many note cards can fit in the visible area? We only need this many
	// cards to be measured before calling onViewportReady (and hiding the splash).
	// noteHeightsVersion is intentionally a dep so the estimate improves as real
	// heights are measured — the first measurement is just the 180 px fallback.
	const viewportCapacity = React.useMemo(() => {
		const containerH = typeof window !== 'undefined' ? Math.max(window.innerHeight - 80, 400) : 600;
		if (props.viewMode === 'list' || props.viewMode === 'strip') {
			return Math.ceil(containerH / 56) + 5;
		}
		const heights = [...noteHeightByIdRef.current.values()];
		const avgH = heights.length > 0 ? heights.reduce((s, h) => s + h, 0) / heights.length : 180;
		const rows = Math.ceil(containerH / (avgH + 12)) + 1;
		return Math.max(rows * columnCount, columnCount * 3);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [columnCount, noteHeightsVersion, props.viewMode]);

	// ── Reset startup/readiness state on workspace / view-mode change ─────
	// NoteGrid stays mounted across workspace switches, so one-shot readiness refs
	// and settled flags must be explicitly rearmed for the next workspace.
	const prevVpWorkspaceRef = React.useRef(props.activeWorkspaceId);
	const prevVpViewModeRef = React.useRef(props.viewMode);
	React.useEffect(() => {
		const wsChanged = prevVpWorkspaceRef.current !== props.activeWorkspaceId;
		const vmChanged = prevVpViewModeRef.current !== props.viewMode;
		prevVpWorkspaceRef.current = props.activeWorkspaceId;
		prevVpViewModeRef.current = props.viewMode;
		if (wsChanged || vmChanged) {
			// NoteGrid stays mounted across workspace switches, so every startup gate
			// has to be rearmed here before App waits for the next viewport-ready paint.
			readyNotifiedRef.current = false;
			viewportReadyNotifiedRef.current = false;
			initialLoadCompleteRef.current = false;
			setAllDocsLoaded(false);
			setInitialDataSettled(false);
			setInitialLayoutSettled(false);
			setStartupLayoutAnimationsReady(false);
			setViewportLayoutSettled(false);
			setLayoutReady(false);
			setShimmerStalled(false);
			// Clear stale column state from the previous workspace/view so
			// renderedIds starts empty rather than briefly showing old note IDs.
			setLayoutOrderIds([]);
			viewportAnchorColumnsRef.current = new Map();
			viewportAnchorSourceColumnsRef.current = [];
			settledColumnByIdRef.current = new Map();
			settledSiblingIndexByIdRef.current = new Map();
			settledColumnsRef.current = [];
			invalidatedNoteReasonsRef.current.clear();
			recentlyMovedNoteIdsRef.current.clear();
			expansionAffectedNoteIdsRef.current.clear();
			lastRebalanceSuppressionReasonRef.current = null;
			repackReasonRef.current = wsChanged ? 'workspace-change' : 'view-mode-change';
			if (wsChanged) debugWorkspaceSwitch(prevVpWorkspaceRef.current, props.activeWorkspaceId);
			if (vmChanged) debugViewSwitch(String(prevVpViewModeRef.current), String(props.viewMode));
		}
	}, [props.activeWorkspaceId, props.viewMode]);

	React.useEffect(() => {
		if (!initialLayoutSettled) return;
		setStartupLayoutAnimationsReady(true);
	}, [initialLayoutSettled]);

	const touchStartPointRef = React.useRef<{ x: number; y: number } | null>(null);
	const pendingTouchIntentRef = React.useRef(false);
	const touchScrollDetectedRef = React.useRef(false);
	const suppressTouchDragUntilRef = React.useRef(0);
	// ── More-menu state ──────────────────────────────────────────────────
	// Tracks which note's long-press more-menu is currently open (null = closed).
	const [moreMenuNoteId, setMoreMenuNoteId] = React.useState<string | null>(null);
	const [moreMenuAnchorRect, setMoreMenuAnchorRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);
	const [moreMenuOpenedByLongPress, setMoreMenuOpenedByLongPress] = React.useState(false);
	const isTrashView = Boolean(props.showTrashed);
	const isGridVisible = props.isVisible !== false;

	React.useEffect(() => {
		if (moreMenuNoteId !== null) return;
		setMoreMenuOpenedByLongPress(false);
	}, [moreMenuNoteId]);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const handleNoteCardLayoutChange = (): void => {
			if (!repackReasonRef.current.startsWith('checklist-')) {
				repackReasonRef.current = 'note-card-layout-change';
			}
			if (noteCardLayoutRefreshRafRef.current) {
				window.cancelAnimationFrame(noteCardLayoutRefreshRafRef.current);
				debugRebalanceDebounced('note-card-layout-refresh-already-scheduled', {
					reason: repackReasonRef.current,
				});
			}
			noteCardLayoutRefreshRafRef.current = window.requestAnimationFrame(() => {
				noteCardLayoutRefreshRafRef.current = 0;
				setNoteHeightsVersion((version) => version + 1);
			});
		};
		const handleChecklistToggle = (event: Event): void => {
			const detail = (event as CustomEvent<{ noteId?: string; expanded?: boolean }>).detail;
			if (!detail?.noteId) return;
			repackReasonRef.current = detail.expanded ? 'checklist-expand' : 'checklist-collapse';
			expansionAffectedNoteIdsRef.current.add(detail.noteId);
			invalidatedNoteReasonsRef.current.set(detail.noteId, repackReasonRef.current);
			debugChecklistToggle(detail.noteId, Boolean(detail.expanded));
			// Apply bottom padding while any checklist has its completed section
			// open so expanding cards at the bottom of a column have room to grow
			// downward without jumping the viewport.
			if (detail.expanded) {
				expandedChecklistNoteIdsRef.current.add(detail.noteId);
			} else {
				expandedChecklistNoteIdsRef.current.delete(detail.noteId);
			}
			const section = sectionRef.current;
			if (section) {
				section.style.paddingBottom = expandedChecklistNoteIdsRef.current.size > 0 ? '50vh' : '';
			}
		};
		window.addEventListener('freemannotes:note-card-layout-change', handleNoteCardLayoutChange as EventListener);
		window.addEventListener('freemannotes:checklist-toggle', handleChecklistToggle as EventListener);
		return () => {
			window.removeEventListener('freemannotes:note-card-layout-change', handleNoteCardLayoutChange as EventListener);
			window.removeEventListener('freemannotes:checklist-toggle', handleChecklistToggle as EventListener);
			if (noteCardLayoutRefreshRafRef.current) {
				window.cancelAnimationFrame(noteCardLayoutRefreshRafRef.current);
				noteCardLayoutRefreshRafRef.current = 0;
			}
		};
	}, []);

	React.useEffect(() => {
		docsByIdRef.current = docsById;
	}, [docsById]);

	React.useEffect(() => {
		if (latestNoteHeightsVersionRef.current !== noteHeightsVersion) {
			debugHeightVersionBump(repackReasonRef.current, { noteHeightsVersion });
		}
		latestNoteHeightsVersionRef.current = noteHeightsVersion;
	}, [noteHeightsVersion]);

	const scheduleMeasuredHeightRefresh = React.useCallback((): void => {
		if (typeof window === 'undefined') {
			setNoteHeightsVersion((version) => version + 1);
			return;
		}
		if (noteHeightBumpRafRef.current) {
			debugRebalanceDebounced('height-refresh-raf-already-scheduled', {
				reason: repackReasonRef.current,
			});
			window.cancelAnimationFrame(noteHeightBumpRafRef.current);
		}
		noteHeightBumpRafRef.current = window.requestAnimationFrame(() => {
			noteHeightBumpRafRef.current = 0;
			setNoteHeightsVersion((version) => version + 1);
		});
	}, []);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		if (!props.deviceId) return;
		if (!initialLayoutSettled) return;
		if (noteHeightByIdRef.current.size === 0) return;
		if (heightSaveTimerRef.current) {
			window.clearTimeout(heightSaveTimerRef.current);
		}
		heightSaveTimerRef.current = window.setTimeout(() => {
			heightSaveTimerRef.current = 0;
			saveNoteHeightCache(props.deviceId!, noteHeightByIdRef.current);
		}, 250);
		return () => {
			if (heightSaveTimerRef.current) {
				window.clearTimeout(heightSaveTimerRef.current);
				heightSaveTimerRef.current = 0;
			}
		};
	}, [initialLayoutSettled, noteHeightsVersion, props.deviceId]);

	const handleMeasuredCardHeight = React.useCallback((noteId: string, height: number): void => {
		const normalizedHeight = Math.max(0, Math.round(height));
		if (!noteId || normalizedHeight <= 0) return;
		const previousMeasuredHeight = noteHeightByIdRef.current.get(noteId);
		if (previousMeasuredHeight === normalizedHeight) return;
		// Preserve higher-priority reasons set before the ResizeObserver fires.
		// A checklist toggle or a max-card-height preference change sets the reason
		// first; the ResizeObserver measurement arrives a tick later and must not
		// downgrade the reason to 'measured-card-height' (which suppresses rebalancing).
		const currentReason = repackReasonRef.current;
		const isHighPriorityReason =
			currentReason.startsWith('checklist-') ||
			currentReason === 'max-card-height-change';
		if (!isHighPriorityReason) {
			repackReasonRef.current = previousMeasuredHeight === undefined ? 'initial-measurement' : 'measured-card-height';
		}
		invalidatedNoteReasonsRef.current.set(noteId, repackReasonRef.current);
		debugNoteMeasure(noteId, normalizedHeight, previousMeasuredHeight);
		debugNoteHeightInvalidated(
			noteId,
			normalizedHeight,
			previousMeasuredHeight,
			previousMeasuredHeight === undefined ? 'initial-measurement' : 'measured-card-height'
		);
		// ResizeObserver callbacks can land in bursts while images/fonts settle.
		// Coalesce those updates so masonry only repacks once per animation frame.
		noteHeightByIdRef.current.set(noteId, normalizedHeight);
		scheduleMeasuredHeightRefresh();
	}, [scheduleMeasuredHeightRefresh]);

	React.useEffect(() => {
		return () => {
			if (typeof window !== 'undefined') {
				if (noteHeightBumpRafRef.current) {
					window.cancelAnimationFrame(noteHeightBumpRafRef.current);
					noteHeightBumpRafRef.current = 0;
				}
				if (heightSaveTimerRef.current) {
					window.clearTimeout(heightSaveTimerRef.current);
					heightSaveTimerRef.current = 0;
				}
			}
		};
	}, []);

	const recalculateColumnCount = React.useCallback((): void => {
		if (typeof window === 'undefined') return;
		if (!isGridVisible) return;
		const containerWidth = sectionRef.current?.clientWidth ?? window.innerWidth;
		if (containerWidth <= 0) return;
		const next = getGridLayoutForViewport(containerWidth, window.innerWidth, window.innerHeight);
		if (
			columnCount !== next.columnCount ||
			mobileCardWidthPx !== next.mobileCardWidthPx ||
			mobileGridGapPx !== next.mobileGapPx ||
			mobileSectionBleedPx !== next.mobileSectionBleedPx
		) {
			repackReasonRef.current = 'viewport-width-change';
			debugLayoutInvalidation('VIEWPORT_WIDTH_CHANGE', {
				previousColumnCount: columnCount,
				nextColumnCount: next.columnCount,
			});
		}
		setColumnCount((previous) => (previous === next.columnCount ? previous : next.columnCount));
		setMobileCardWidthPx((previous) => (previous === next.mobileCardWidthPx ? previous : next.mobileCardWidthPx));
		setMobileGridGapPx((previous) => (previous === next.mobileGapPx ? previous : next.mobileGapPx));
		setMobileSectionBleedPx((previous) => (previous === next.mobileSectionBleedPx ? previous : next.mobileSectionBleedPx));
	}, [columnCount, isGridVisible, mobileCardWidthPx, mobileGridGapPx, mobileSectionBleedPx]);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		if (!isGridVisible) return;
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
	}, [isGridVisible, recalculateColumnCount]);

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
			const [list, order, layout] = await Promise.all([manager.getNotesList(), manager.getNoteOrder(), manager.getNoteLayout()]);
			if (cancelled) return;
			setNotesList(list as unknown as Y.Array<Y.Map<unknown>>);
			setNoteOrder(order);
			setNoteLayout(layout);
		})();
		return () => { cancelled = true; };
	}, [manager]);

	// ── Subscribe to Yjs changes: notesList + noteOrder ──────────────────
	const subscribe = React.useCallback(
		(onStoreChange: () => void) => {
			if (!notesList || !noteOrder || !noteLayout) return () => {};
			const onChange = (): void => {
				versionRef.current += 1;
				onStoreChange();
			};
			notesList.observeDeep(onChange);
			noteOrder.observe(onChange);
			noteLayout.observe(onChange);
			return () => {
				notesList.unobserveDeep(onChange);
				noteOrder.unobserve(onChange);
				noteLayout.unobserve(onChange);
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
		if (!noteOrder) {
			// IDB registry not yet hydrated — use the localStorage snapshot so skeleton
			// cards occupy the correct grid positions on the very first render.
			// Once the real Yjs data arrives (noteOrder becomes non-null) this branch
			// is never entered again and the actual registry order takes over.
			const snapshotIds = readNoteOrderSnapshot(props.activeWorkspaceId ?? '');
			return uniqueIds([...snapshotIds, ...(workspaceRenderSnapshot?.orderedIds ?? []), ...sharedNoteIds]);
		}
		// Local workspace order still comes from Yjs. Shared aliases are appended so
		// they render in the grid without mutating the source workspace's note order.
		return uniqueIds([...readOrderIds(noteOrder), ...sharedNoteIds]);
	}, [noteOrder, sharedNoteIds, storeVersion, props.activeWorkspaceId, workspaceRenderSnapshot]);
	const sharedPlacementByAlias = React.useMemo(
		() => new Map((props.sharedNotes ?? []).map((placement) => [placement.aliasId, placement] as const)),
		[props.sharedNotes]
	);

	const noteSnapshots = React.useMemo<VisibleNoteSnapshot[]>(() => {
		return orderedIds.map((id) => {
			const liveDoc = docsById[id] ?? manager.peekDoc(id) ?? null;
			const doc = liveDoc && hasRenderableNoteContent(liveDoc) ? liveDoc : null;
			if (!doc) {
				const snapshotNote = workspaceRenderSnapshotNoteById.get(id);
				return snapshotNote ? createVisibleNoteSnapshotFromRenderSnapshot(snapshotNote) : createFallbackNoteSnapshot(id);
			}
			const note = readNoteFromDoc(doc, id);
			const placement = sharedPlacementByAlias.get(id) ?? null;
			const docId = placement?.roomId || resolveMediaDocId(id);
			return {
				id,
				title: note.title,
				createdAt: note.createdAt,
				updatedAt: note.updatedAt,
				collectionId: placement ? placement.collectionId : note.collectionId,
				labelIds: placement ? placement.labelIds : note.labelIds,
				reminderAt: (docId ? props.noteReminderByDocId?.[docId] : undefined) ?? props.noteReminderByDocId?.[id] ?? null,
				isPinned: note.isPinned,
				lastAccessedAt: note.lastAccessedAt,
				trashed: note.trashed,
				archived: note.archived,
			};
		});
	}, [docsById, manager, metadataVersion, orderedIds, props.noteReminderByDocId, resolveMediaDocId, sharedPlacementByAlias, workspaceRenderSnapshotNoteById]);
	const noteSnapshotById = React.useMemo(() => new Map(noteSnapshots.map((note) => [note.id, note] as const)), [noteSnapshots]);

	const baseVisibleIds = React.useMemo<string[]>(() => {
		const ids = getVisibleNotes(noteSnapshots, {
			showTrashed: props.showTrashed,
			showArchived: props.showArchived,
			selectedCollectionId: props.activeCollectionId,
			selectedLabelIds: props.activeLabelIds,
			reminderFilter: props.reminderFilter,
			sortMode: props.sortMode,
			sortDirection: props.sortDirection,
			prioritizePinned: !props.showTrashed
				&& !props.showArchived
				&& !props.activeCollaboratorFilter
				&& !props.activeCollectionId
				&& (props.activeLabelIds?.length ?? 0) === 0
				&& props.reminderFilter === 'all'
				&& props.sortMode === 'manual'
				&& props.sortGrouping === 'none',
		}).map((note) => note.id);
		const unresolvedIds = !allDocsLoaded
			? orderedIds.filter((id) => !(docsById[id] ?? manager.peekDoc(id)))
			: [];
		const mergedIds = unresolvedIds.length > 0 ? uniqueIds([...ids, ...unresolvedIds]) : ids;
		if (props.hiddenNoteId) return mergedIds.filter((id) => id !== props.hiddenNoteId);
		// ^ Suppress the draft note ID from the visible list so it never renders as
		//   an empty card while the user is composing it in the editor overlay.
		return mergedIds;
	}, [allDocsLoaded, docsById, manager, noteSnapshots, orderedIds, props.activeCollectionId, props.activeCollaboratorFilter, props.activeLabelIds, props.hiddenNoteId, props.reminderFilter, props.showArchived, props.showTrashed, props.sortDirection, props.sortGrouping, props.sortMode]);

	const visibleNoteEntries = React.useMemo(() => {
		return baseVisibleIds
			.map((noteId) => {
				const placement = sharedPlacementByAlias.get(noteId) ?? null;
				const docId = placement?.roomId || resolveMediaDocId(noteId);
				return docId ? { noteId, docId, isSharedAlias: Boolean(placement) } : null;
			})
			.filter((entry): entry is { noteId: string; docId: string; isSharedAlias: boolean } => Boolean(entry));
	}, [baseVisibleIds, resolveMediaDocId, sharedPlacementByAlias]);
	const visibleNoteEntriesForCollaboratorSync = React.useMemo(
		() => [...visibleNoteEntries].sort((left, right) => left.noteId.localeCompare(right.noteId)),
		[visibleNoteEntries]
	);
	const visibleNoteEntriesForCollaboratorSyncSignature = React.useMemo(
		() => visibleNoteEntriesForCollaboratorSync.map((entry) => `${entry.noteId}:${entry.docId}:${entry.isSharedAlias ? 'shared' : 'local'}`).join('|'),
		[visibleNoteEntriesForCollaboratorSync]
	);

	React.useEffect(() => {
		if (!props.authUserId) {
			setCollaboratorSummariesByNoteId({});
			return;
		}
		if (visibleNoteEntriesForCollaboratorSync.length === 0) {
			setCollaboratorSummariesByNoteId({});
			return;
		}
		let cancelled = false;

		// ── DEBUG: log which dep changed to surface infinite-loop causes ──
		if (process.env.NODE_ENV !== 'production') {
			const prev = prevCollabSyncDepsRef.current;
			const changed: string[] = [];
			if (!prev || prev.pendingSyncSig !== pendingSyncNoteIdsSignature) changed.push(`pendingSyncNoteIds(${pendingSyncNoteIdsSignature || 'empty'})`);
			if (!prev || prev.authUserId !== props.authUserId) changed.push(`authUserId(${props.authUserId})`);
			if (!prev || prev.refreshToken !== props.refreshCollaboratorsToken) changed.push(`refreshCollaboratorsToken(${props.refreshCollaboratorsToken})`);
			if (!prev || prev.noteSig !== visibleNoteEntriesForCollaboratorSyncSignature) changed.push(`notesSig`);
			console.log('[collab-sync] effect fired — changed deps:', changed.join(', ') || '(none?)');
			prevCollabSyncDepsRef.current = {
				pendingSyncSig: pendingSyncNoteIdsSignature,
				authUserId: props.authUserId,
				refreshToken: props.refreshCollaboratorsToken,
				noteSig: visibleNoteEntriesForCollaboratorSyncSignature,
			};
		}

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
				visibleNoteEntriesForCollaboratorSync.map(async (entry) => ({
					noteId: entry.noteId,
					snapshot: await readCachedNoteShareCollaborators(props.authUserId || '', entry.docId),
				}))
			);
			applySummaries(cached.map((entry) => ({
				noteId: entry.noteId,
				summary: snapshotToCollaboratorSummary(visibleNoteEntriesForCollaboratorSync.find((row) => row.noteId === entry.noteId)?.docId ?? '', entry.snapshot),
			})));

			if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

			// Refresh all visible notes in small batches so collaborator chips converge
			// to server state consistently across devices. Rely on suppressError=true
			// to turn missing-access or not-yet-shared notes into a no-op instead of
			// requiring a device-local collaborator cache before the chip can appear.
			const entriesToRefresh = visibleNoteEntriesForCollaboratorSync;
			if (entriesToRefresh.length === 0) return;
			const refreshed: Array<{ noteId: string; summary: NoteCardCollaboratorSummary | null }> = [];
			for (let start = 0; start < entriesToRefresh.length; start += 6) {
				const batch = entriesToRefresh.slice(start, start + 6);
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
	}, [pendingSyncNoteIdsSignature, props.authUserId, props.refreshCollaboratorsToken, visibleNoteEntriesForCollaboratorSyncSignature]);

	const visibleIds = React.useMemo<string[]>(() => {
		if (!props.activeCollaboratorFilter) return baseVisibleIds;
		return baseVisibleIds.filter((noteId) => collaboratorMatchesFilter(collaboratorSummariesByNoteId[noteId], props.activeCollaboratorFilter));
	}, [baseVisibleIds, collaboratorSummariesByNoteId, props.activeCollaboratorFilter]);
	const initialDataSettleSignature = React.useMemo(
		() => `${orderedIds.join('\u001f')}\u001e${visibleIds.join('\u001f')}`,
		[orderedIds, visibleIds]
	);

	// ── Commit drag result to Yjs ─────────────────────────────────────────
	// Called by the drag manager's onDrop handler with the raw column layout
	// from the insertion point. Start from the exact preview layout, then allow
	// a tiny amount of constrained adjacent-column balancing so tall whitespace
	// gaps can tighten without triggering broad post-drop reshuffles.
	const commitVisibleOrder = React.useCallback(
		(finalColumns: string[][], draggedId: string, draggedHeight: number) => {
			if (!noteOrder) return;
			const readingOrder = flattenColumns(finalColumns);
			const pinnedVisibleIds = new Set(
				visibleIds.filter((id) => noteSnapshotById.get(id)?.isPinned === true)
			);
			const constrainedReadingOrder = [
				...readingOrder.filter((id) => pinnedVisibleIds.has(id)),
				...readingOrder.filter((id) => !pinnedVisibleIds.has(id)),
			];
			pendingCommittedVisibleOrderRef.current = constrainedReadingOrder.slice();
			setLayoutOrderIds((previous) => (arraysEqual(previous, constrainedReadingOrder) ? previous : constrainedReadingOrder));
			repackReasonRef.current = 'drag-drop';
			recentlyMovedNoteIdsRef.current = new Set([draggedId]);
			invalidatedNoteReasonsRef.current.set(draggedId, 'drag-drop');
			viewportAnchorSourceColumnsRef.current = finalColumns.map((column) => [...column]);
			// Use layout-calculated positions rather than per-node getBoundingClientRect.
			// At commit time the drag animation is still in flight; querying DOM nodes
			// returns transitioning values that misidentify which notes are in the
			// viewport, causing the post-drop repack to use wrong column anchors.
			const commitOverscanPx = Math.max(24, Math.round(Math.max(draggedHeight, getEstimatedNoteHeight(draggedId)) * 0.2));
			const committedViewportAnchors = collectViewportAnchorColumnsFromLayout({
				columns: finalColumns,
				heightById: noteHeightByIdRef.current,
				fallbackHeightPx: 220,
				gapPx: readCssPxVariable('--grid-gap', 16),
				grid: gridRef.current,
				overscanPx: commitOverscanPx,
			});
			const draggedPrevColumn = settledColumnByIdRef.current.get(draggedId) ?? null;
			const draggedNewColumn = finalColumns.findIndex((col) => col.includes(draggedId));
			const isSameColumnSwap = draggedPrevColumn !== null && draggedPrevColumn === draggedNewColumn;
			// Lock ALL notes to their committed columns to prevent framer-motion's
			// transient height oscillations during the drop animation from triggering
			// greedy shortest-column moves.  finalColumns only covers the ~10 visible
			// notes; seed from settledColumnByIdRef to also cover offscreen notes.
			{
				const fullAnchorMap = new Map<string, number>(settledColumnByIdRef.current);
				for (let colIdx = 0; colIdx < finalColumns.length; colIdx++) {
					for (const noteId of finalColumns[colIdx]) {
						fullAnchorMap.set(noteId, colIdx);
					}
				}
				viewportAnchorColumnsRef.current = fullAnchorMap;
			}
			debugDragCommit(draggedId, finalColumns.length, Math.max(0, draggedNewColumn));
			debugLayoutInvalidation('DRAG_COMMIT_RESULT', {
				draggedId,
				isSameColumnSwap,
				draggedPrevColumn,
				draggedNewColumn: draggedNewColumn < 0 ? null : draggedNewColumn,
				committedAnchorCount: viewportAnchorColumnsRef.current.size,
			});

			const current = readOrderIds(noteOrder);
			const next = mergeVisibleOrderIntoFullOrder(current, visibleIds, constrainedReadingOrder);
			if (arraysEqual(current, next)) return;
			const ydoc = (noteOrder as YArrayWithDoc<string>).doc;
			ydoc.transact(() => {
				noteOrder.delete(0, noteOrder.length);
				noteOrder.insert(0, next);
			});
		},
		[getEstimatedNoteHeight, noteOrder, noteSnapshotById, visibleIds]
	);

	React.useLayoutEffect(() => {
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

	// Apply the warm-start layout snapshot before paint so the reopened PWA does
	// not first render in fallback order and then visibly jump once effects run.
	React.useLayoutEffect(() => {
		if (!cachedLayoutSnapshot || !props.activeWorkspaceId) return;
		const cacheKey = `${props.activeWorkspaceId}:${props.viewMode ?? 'card'}:${layoutDeviceType}:${layoutDensityKey}:${layoutViewportBucket}`;
		if (appliedLayoutCacheKeyRef.current === cacheKey) return;
		appliedLayoutCacheKeyRef.current = cacheKey;
		const nextLayoutOrder = mergeVisibleIdsIntoLayoutOrder(cachedLayoutSnapshot.orderedIds, visibleIds);
		if (nextLayoutOrder.length > 0) {
			setLayoutOrderIds((previous) => (arraysEqual(previous, nextLayoutOrder) ? previous : nextLayoutOrder));
		}
	}, [cachedLayoutSnapshot, layoutDensityKey, layoutDeviceType, layoutViewportBucket, props.activeWorkspaceId, props.viewMode, visibleIds]);

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
			// Shared note aliases are intentionally absent from the user's own
			// notesList but are valid entries in noteOrder after being dragged.
			// Do not treat them as orphans.
			if (id && !registrySet.has(id) && !sharedNoteIdSet.has(id)) orphanIndices.push(i);
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

	// Persist the current note order to localStorage so the next startup can use it
	// as a snapshot, enabling skeleton cards to appear on the very first render
	// before the async IDB registry hydration completes.
	React.useEffect(() => {
		if (!noteOrder || !props.activeWorkspaceId) return;
		const ids = readOrderIds(noteOrder);
		if (ids.length === 0) return;
		writeNoteOrderSnapshot(props.activeWorkspaceId, ids);
	}, [noteOrder, storeVersion, props.activeWorkspaceId]);
	const workspaceRenderSnapshotWriteTimerRef = React.useRef<number>(0);
	const snapshotNotesForPersistence = React.useMemo(() => {
		return orderedIds
			.map((id) => {
				const liveDoc = docsById[id] ?? manager.peekDoc(id) ?? null;
				if (liveDoc && hasRenderableNoteContent(liveDoc)) {
					const previousSnapshot = workspaceRenderSnapshotNoteById.get(id) ?? null;
					const placement = (props.sharedNotes ?? []).find((entry) => entry.aliasId === id);
					const docId = placement?.roomId || resolveMediaDocId(id);
					const reminderAt = (docId ? props.noteReminderByDocId?.[docId] : undefined) ?? props.noteReminderByDocId?.[id] ?? null;
					const previewLinks = extractNoteLinksFromDoc(liveDoc);
					const cachedPreviewCards = toWorkspaceRenderSnapshotPreviewCards(getCachedRemoteNoteLinks(docId));
					return buildWorkspaceRenderSnapshotNote({
						noteId: id,
						doc: liveDoc,
						reminderAt,
						collaboratorCount: Math.max(collaboratorSummariesByNoteId[id]?.count ?? 0, previousSnapshot?.collaboratorCount ?? 0),
						attachmentCounts: {
							images: Math.max(getCachedRemoteNoteImages(docId).length, previousSnapshot?.attachmentCounts.images ?? 0),
							links: Math.max(getCachedRemoteNoteLinks(docId).length, previewLinks.length, previousSnapshot?.attachmentCounts.links ?? 0),
							drawings: Math.max(readDrawingLinkState(liveDoc).drawingIds.length, previousSnapshot?.attachmentCounts.drawings ?? 0),
						},
						previewCards: cachedPreviewCards.length > 0 ? cachedPreviewCards : (previousSnapshot?.previewCards ?? []),
					});
				}
				return workspaceRenderSnapshotNoteById.get(id) ?? null;
			})
			.filter((note): note is WorkspaceRenderSnapshotNote => Boolean(note));
	}, [collaboratorSummariesByNoteId, docsById, manager, orderedIds, props.noteReminderByDocId, props.sharedNotes, resolveMediaDocId, workspaceRenderSnapshotNoteById]);
	React.useEffect(() => {
		return () => {
			if (typeof window !== 'undefined' && workspaceRenderSnapshotWriteTimerRef.current) {
				window.clearTimeout(workspaceRenderSnapshotWriteTimerRef.current);
				workspaceRenderSnapshotWriteTimerRef.current = 0;
			}
		};
	}, []);
	React.useEffect(() => {
		if (typeof window === 'undefined' || !props.activeWorkspaceId) return;
		window.clearTimeout(workspaceRenderSnapshotWriteTimerRef.current);
		workspaceRenderSnapshotWriteTimerRef.current = window.setTimeout(() => {
			workspaceRenderSnapshotWriteTimerRef.current = 0;
			writeWorkspaceRenderSnapshot({
				workspaceId: props.activeWorkspaceId || '',
				orderedIds,
				notes: snapshotNotesForPersistence,
			});
		}, 180);
		return () => {
			if (workspaceRenderSnapshotWriteTimerRef.current) {
				window.clearTimeout(workspaceRenderSnapshotWriteTimerRef.current);
				workspaceRenderSnapshotWriteTimerRef.current = 0;
			}
		};
	}, [orderedIds, props.activeWorkspaceId, snapshotNotesForPersistence]);

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

	// ── Track when all docs are loaded (drives shimmer + layout animations) ─
	//
	// On a page refresh, IndexedDB caches the note list so orderedIds is
	// non-empty immediately — the shimmer shows while Yjs syncs.
	//
	// On first login (cleared cache) IndexedDB is empty, so orderedIds starts
	// as [] and the old code immediately set allDocsLoaded=true.  When notes
	// arrived from the server shortly after, the `if (allDocsLoaded) return`
	// guard blocked the reset, so no shimmer ever appeared.
	//
	// Fix: allow allDocsLoaded to reset to false while the initial load is
	// still in progress (initialLoadCompleteRef not yet set).  Once a full
	// set of notes has been loaded we freeze it at true so that creating a
	// new note doesn't re-shimmer every existing card.
	React.useEffect(() => {
		const canResolveWithoutRegistryOrder = !noteOrder && orderedIds.length > 0;
		if (!noteOrder && !canResolveWithoutRegistryOrder) return;
		if (orderedIds.length > 0 && orderedIds.some((id) => !docsById[id])) {
			// Notes are present but their docs haven't arrived yet.
			// Reset to hydrating only during the initial boot phase so that
			// the shimmer shows on first login (not just on page refresh).
			if (!initialLoadCompleteRef.current) {
				setAllDocsLoaded(false);
			}
			return;
		}
		// Stall timeout: if WS sync is taking too long, force-clear shimmer so
		// the user never sees an infinite spinner on a broken connection.
		if (shimmerStalled) {
			initialLoadCompleteRef.current = true;
			if (!allDocsLoaded) setAllDocsLoaded(true);
			return;
		}
		// All present notes have loaded docs (or the workspace is genuinely empty).
		// On fresh login with an empty IDB, also wait for the
		// registry WS sync so cards have real content before the shimmer lifts.
		// Without this, cards inflate from near-empty to full height after shimmer
		// clears, causing layout shifts. This must also hold when `orderedIds` is
		// still empty on a cold boot: an empty pre-sync registry snapshot is not yet
		// evidence that the workspace is genuinely empty, and lifting the splash at
		// that point exposes the note grid while cards stream in and repack. When the
		// app is offline, no registry WS sync will ever arrive, so locally-created
		// workspaces/notes must be allowed to finish hydrating from their in-memory
		// docs alone.
		if (
			!initialLoadCompleteRef.current &&
			noteOrder != null &&
			connection.state !== 'offline' &&
			!connection.registryWsSynced
		) {
			// Registry WS sync hasn't completed yet — hold the shimmer even if the
			// current Yjs order is empty, because fresh installs start with an empty
			// IDB snapshot before the server sends the real registry contents.
			setAllDocsLoaded(false);
			return;
		}
		// Post-WS-sync grace period: if registryWsSynced JUST fired and orderedIds is
		// still empty, hold the shimmer for up to 200 ms so Yjs note data can propagate
		// through React's render pipeline. Without this, fresh login can briefly show
		// an empty grid then flood with cards — the "chaotic grid" bug.
		if (
			!initialLoadCompleteRef.current &&
			noteOrder != null &&
			connection.registryWsSynced &&
			orderedIds.length === 0 &&
			wsSyncJustFired
		) {
			setAllDocsLoaded(false);
			return;
		}
		// Fresh-login guard: hold the shimmer while note rooms that had empty IDB are
		// still waiting for their first WS sync. On a fresh install every note doc is
		// a stub Y.Doc (no IDB data); getDocWithSync resolves immediately and adds the
		// stub to docsById, making docsById look "complete" before any real content has
		// arrived from the server. Without this guard the shimmer clears to reveal a
		// grid of empty "Untitled" cards that slowly populate over 30–60 seconds.
		// DocumentManager tracks these rooms in noIdbContentRooms and surfaces the
		// count via connection.pendingNoteWsSync, decrementing as each WS sync fires.
		// The shimmerStalled timeout (5 s) serves as a fallback for offline/stall cases.
		if (
			!initialLoadCompleteRef.current &&
			noteOrder != null &&
			connection.registryWsSynced &&
			orderedIds.length > 0 &&
			connection.pendingNoteWsSync > 0
		) {
			setAllDocsLoaded(false);
			return;
		}
		// All present notes have loaded docs (or the workspace is genuinely empty).
		if (orderedIds.length > 0) {
			// Freeze: from now on don't allow going back to false.
			initialLoadCompleteRef.current = true;
		}
		if (!allDocsLoaded) {
			setAllDocsLoaded(true);
		}
	}, [noteOrder, orderedIds, docsById, allDocsLoaded, connection.registryWsSynced, connection.state, wsSyncJustFired, shimmerStalled, connection.pendingNoteWsSync]);

	React.useEffect(() => {
		if (!allDocsLoaded) {
			setInitialDataSettled(false);
			return;
		}
		setInitialDataSettled(false);
		const timeoutId = setTimeout(() => {
			setInitialDataSettled(true);
		}, INITIAL_DATA_SETTLE_MS);
		return () => {
			clearTimeout(timeoutId);
		};
	}, [allDocsLoaded, initialDataSettleSignature]);

	const renderedIds = layoutOrderIds.length > 0 ? layoutOrderIds : visibleIds;
	const renderedIdsSignature = React.useMemo(() => renderedIds.join('\u001f'), [renderedIds]);
	const layoutMeasurementTargetIds = React.useMemo(
		() => (isGridVisible && props.viewMode === 'card' ? renderedIds.slice(0, viewportCapacity) : renderedIds),
		[isGridVisible, props.viewMode, renderedIds, viewportCapacity]
	);
	const measuredRenderedCardCount = React.useMemo(
		() => renderedIds.reduce((count, id) => count + (noteHeightByIdRef.current.has(id) ? 1 : 0), 0),
		[noteHeightsVersion, renderedIds]
	);
	const measuredLayoutTargetCount = React.useMemo(
		() => layoutMeasurementTargetIds.reduce((count, id) => count + (noteHeightByIdRef.current.has(id) ? 1 : 0), 0),
		[layoutMeasurementTargetIds, noteHeightsVersion]
	);
	React.useEffect(() => {
		if (!startupDebugEnabled) return;
		const unresolvedOrderedIds = orderedIds.filter((id) => !(docsById[id] ?? manager.peekDoc(id)));
		const blocker = !noteOrder
			? 'waiting-note-order'
			: !allDocsLoaded
				? orderedIds.length > 0 && unresolvedOrderedIds.length > 0
					? 'waiting-note-docs'
					: connection.state !== 'offline' && !connection.registryWsSynced
						? 'waiting-registry-ws-sync'
						: 'waiting-doc-load-gate'
				: !initialDataSettled
					? 'waiting-data-quiescence'
				: props.enableLayoutAnimations && !layoutReady
					? 'waiting-layout-ready'
					: !initialLayoutSettled
						? renderedIds.length === 0 || !isGridVisible || props.viewMode !== 'card'
							? 'waiting-initial-layout-bypass'
							: measuredLayoutTargetCount < layoutMeasurementTargetIds.length
								? 'waiting-card-measurements'
								: 'waiting-layout-quiescence'
						: 'ready';
		const snapshot = JSON.stringify({
			workspaceId: props.activeWorkspaceId ?? null,
			blocker,
			noteOrderReady: Boolean(noteOrder),
			orderedCount: orderedIds.length,
			visibleCount: visibleIds.length,
			renderedCount: renderedIds.length,
			layoutMeasurementTargetCount: layoutMeasurementTargetIds.length,
			unresolvedOrderedCount: unresolvedOrderedIds.length,
			docCount: Object.keys(docsById).length,
			allDocsLoaded,
			initialDataSettled,
			layoutReady,
			initialLayoutSettled,
			registryWsSynced: connection.registryWsSynced,
			pendingNoteWsSync: connection.pendingNoteWsSync,
			wsSyncJustFired,
			shimmerStalled,
			connectionState: connection.state,
			measuredRenderedCardCount,
			measuredLayoutTargetCount,
			noteHeightsVersion,
			viewMode: props.viewMode,
			isGridVisible,
		});
		if (startupDebugSnapshotRef.current === snapshot) return;
		startupDebugSnapshotRef.current = snapshot;
		const parsedSnapshot = JSON.parse(snapshot);
		void logClientEvent('NOTE_GRID_STARTUP', parsedSnapshot);
	}, [allDocsLoaded, connection.pendingNoteWsSync, connection.registryWsSynced, connection.state, docsById, initialDataSettled, initialLayoutSettled, isGridVisible, layoutMeasurementTargetIds.length, layoutReady, manager, measuredLayoutTargetCount, measuredRenderedCardCount, noteHeightsVersion, noteOrder, orderedIds, props.activeWorkspaceId, props.enableLayoutAnimations, props.viewMode, renderedIds, shimmerStalled, startupDebugEnabled, visibleIds, wsSyncJustFired]);
	React.useEffect(() => {
		if (!allDocsLoaded) {
			setInitialLayoutSettled(false);
			return;
		}
		if (!initialDataSettled) {
			setInitialLayoutSettled(false);
			return;
		}
		if (props.enableLayoutAnimations && !layoutReady) {
			setInitialLayoutSettled(false);
			return;
		}
		if (!isGridVisible || props.viewMode !== 'card' || renderedIds.length === 0) {
			setInitialLayoutSettled(true);
			return;
		}
		const allLayoutTargetsMeasured = layoutMeasurementTargetIds.every((id) => noteHeightByIdRef.current.has(id));
		if (!allLayoutTargetsMeasured) {
			setInitialLayoutSettled(false);
			return;
		}

		let cancelled = false;
		// Do NOT clear viewportAnchorColumnsRef here. This effect re-fires on every
		// noteHeightsVersion bump (e.g. after every drag-drop card remeasure), and
		// clearing the anchor map at that point destroys the anchors set by
		// commitVisibleOrder, leaving the post-drag repack with viewportAnchorCount=0
		// and causing unrelated notes to change columns.  Anchors are cleared on
		// workspace/view-mode change (line ~1419) which is the correct reset point.
		const rafIds: number[] = [];
		const baselineHeightVersion = latestNoteHeightsVersionRef.current;
		const waitForStableFrames = (remainingFrames: number): void => {
			const rafId = requestAnimationFrame(() => {
				if (cancelled) return;
				if (latestNoteHeightsVersionRef.current !== baselineHeightVersion) {
					setInitialLayoutSettled(false);
					return;
				}
				if (remainingFrames <= 1) {
					setInitialLayoutSettled(true);
					return;
				}
				waitForStableFrames(remainingFrames - 1);
			});
			rafIds.push(rafId);
		};

		setInitialLayoutSettled(false);
		// Quiescence gate: after the docs load, wait until every visible card has
		// been measured and no card-height changes occur for a few paint frames.
		// This ties splash dismissal to actual grid stability rather than elapsed time.
		waitForStableFrames(4);
		return () => {
			cancelled = true;
			for (const rafId of rafIds) {
				cancelAnimationFrame(rafId);
			}
		};
	}, [allDocsLoaded, initialDataSettled, isGridVisible, layoutMeasurementTargetIds, layoutReady, noteHeightsVersion, props.enableLayoutAnimations, props.viewMode, renderedIds.length]);

	// ── Viewport-first layout settled ─────────────────────────────────────
	// Mirrors initialLayoutSettled but only waits for the first viewportCapacity
	// cards. On a 1000-note workspace this fires after ~20 cards are ready rather
	// than all 1000, making the splash feel instant while the rest load silently.
	React.useEffect(() => {
		// List/strip views need no card measurement — settle immediately.
		if (!isGridVisible || props.viewMode !== 'card') {
			setViewportLayoutSettled(true);
			return;
		}
		if (!noteOrder && orderedIds.length === 0) { setViewportLayoutSettled(false); return; }
		// Wait for full data quiescence before checking viewport stability.
		if (!allDocsLoaded || !initialDataSettled) { setViewportLayoutSettled(false); return; }
		// Apply the same WS-ordering guards as allDocsLoaded to prevent premature
		// reveal with a stale or incomplete note order.
		if (noteOrder != null && connection.state !== 'offline' && !connection.registryWsSynced && !shimmerStalled) {
			setViewportLayoutSettled(false); return;
		}
		if (noteOrder != null && connection.registryWsSynced && orderedIds.length === 0 && wsSyncJustFired) {
			setViewportLayoutSettled(false); return;
		}
		if (noteOrder != null && connection.registryWsSynced && connection.pendingNoteWsSync > 0 && !shimmerStalled) {
			setViewportLayoutSettled(false); return;
		}
		// Only check the first viewportCapacity cards.
		const viewportIds = renderedIds.slice(0, viewportCapacity);
		if (viewportIds.length === 0) { setViewportLayoutSettled(false); return; }
		// All viewport docs must have a Y.Doc instance (not just a skeleton placeholder).
		const viewportDocsLoaded = viewportIds.every((id) => !!docsById[id]);
		if (!viewportDocsLoaded) { setViewportLayoutSettled(false); return; }
		// All viewport card heights must be measured.
		const viewportMeasured = viewportIds.every((id) => noteHeightByIdRef.current.has(id));
		if (!viewportMeasured) { setViewportLayoutSettled(false); return; }
		// Wait for 2 stable rAFs with no height changes.
		let cancelled = false;
		const rafIds: number[] = [];
		const baselineVersion = latestNoteHeightsVersionRef.current;
		const waitForStableFrames = (remaining: number): void => {
			const rafId = requestAnimationFrame(() => {
				if (cancelled) return;
				if (latestNoteHeightsVersionRef.current !== baselineVersion) {
					setViewportLayoutSettled(false);
					return;
				}
				if (remaining <= 1) { setViewportLayoutSettled(true); return; }
				waitForStableFrames(remaining - 1);
			});
			rafIds.push(rafId);
		};
		setViewportLayoutSettled(false);
		waitForStableFrames(2);
		return () => {
			cancelled = true;
			for (const rafId of rafIds) cancelAnimationFrame(rafId);
		};
	}, [allDocsLoaded, connection.pendingNoteWsSync, connection.registryWsSynced, connection.state, docsById,
		initialDataSettled, isGridVisible, noteHeightsVersion, noteOrder, orderedIds.length,
		props.viewMode, renderedIds, shimmerStalled, viewportCapacity, wsSyncJustFired]);

	React.useEffect(() => {
		if (!allDocsLoaded) {
			readyNotifiedRef.current = false;
			return;
		}
		if (!initialDataSettled) return;
		if (!initialLayoutSettled) return;
		if (readyNotifiedRef.current) return;
		if (startupDebugEnabled) {
			const readySnapshot = {
				workspaceId: props.activeWorkspaceId ?? null,
				orderedCount: orderedIds.length,
				visibleCount: visibleIds.length,
				renderedCount: renderedIds.length,
				measuredRenderedCardCount,
				noteHeightsVersion,
				registryWsSynced: connection.registryWsSynced,
				connectionState: connection.state,
				allDocsLoaded,
				initialDataSettled,
				layoutReady,
				initialLayoutSettled,
			};
				void logClientEvent('NOTE_GRID_STARTUP_READY', readySnapshot);
		}
		readyNotifiedRef.current = true;
		props.onReady?.();
	}, [allDocsLoaded, connection.registryWsSynced, connection.state, initialDataSettled, initialLayoutSettled, layoutReady, measuredRenderedCardCount, noteHeightsVersion, orderedIds.length, props.activeWorkspaceId, props.onReady, renderedIds.length, startupDebugEnabled, visibleIds.length]);

	// ── onViewportReady — fires as soon as viewport-visible layout is stable ──
	// Fires before onReady on large workspaces. Drives splash dismissal so the
	// overlay is never on screen longer than needed.
	React.useEffect(() => {
		if (!viewportLayoutSettled) return;
		if (viewportReadyNotifiedRef.current) return;
		viewportReadyNotifiedRef.current = true;
		props.onViewportReady?.();
	}, [viewportLayoutSettled, props.onViewportReady]);

	const groupedSections = React.useMemo<NoteGridSection[]>(() => {
		return buildNoteGroupSections({
			renderedIds,
			noteSnapshotById,
			sortGrouping: props.sortGrouping,
			sortMode: props.sortMode,
		});
	}, [noteSnapshotById, props.sortGrouping, props.sortMode, renderedIds]);
	const noteById = React.useMemo(() => {
		const map = new Map<string, Note>();
		// Persist whether a card is a shared alias so downstream menu and drag logic
		// can disable local-only actions like trashing or reordering that shared notes
		// should not perform inside the receiver workspace.
		for (const id of renderedIds) {
			map.set(id, {
				id,
				isShared: sharedNoteIdSet.has(id),
				isPinned: noteSnapshotById.get(id)?.isPinned === true,
			});
		}
		return map;
	}, [noteSnapshotById, renderedIds, sharedNoteIdSet]);

	// ── Column computation: packedColumns ─────────────────────────────────
	// Greedy shortest-column masonry: each card from the canonical order is
	// placed into whichever column currently has the least accumulated
	// height.  This produces visually balanced columns at every column
	// count.  Different devices may compute different column assignments
	// (because card heights vary across viewports), but the canonical order
	// in Yjs is deterministic — each device simply packs from it locally.
	const packedLayout = React.useMemo(() => {
		void noteHeightsVersion;
		const gapPx = mobileGridGapPx ?? readCssPxVariable('--grid-gap', 16);
		const fallbackH = Math.min(props.maxCardHeightPx, 220);

		// ── Anchor strategy ─────────────────────────────────────────────────
		// STABLE repacks (height changes, expansion, framer-motion oscillations,
		// same-width resize) must NEVER move notes between columns.  We lock
		// every note to its last-settled column by using settledColumnByIdRef as
		// the anchor map.  This covers ALL notes — not just the viewport-visible
		// subset — eliminating the entire class of bugs where:
		//   • framer-motion height oscillations cause greedy shortest-column jumps
		//   • checklist expand/collapse reshuffles adjacent column notes
		//   • swapping bottom notes forces top notes to repack (viewport scroll-down
		//     left top notes unanchored so the rebalancer had a free prefix of zero)
		//
		// DYNAMIC repacks (explicit drag-drop, workspace/view-mode change,
		// column-count change) use viewportAnchorColumnsRef as before so that
		// drag commits apply their full-anchor map and structural resets pack freely.
		const repackReason = repackReasonRef.current;
		const isColumnCountChanged =
			settledColumnsRef.current.length > 0 &&
			settledColumnsRef.current.length !== columnCount;
		const useSettledAnchors =
			repackReason !== 'drag-drop' &&
			repackReason !== 'workspace-change' &&
			repackReason !== 'view-mode-change' &&
			!isColumnCountChanged &&
			settledColumnByIdRef.current.size > 0;
		let anchoredColumnById: ReadonlyMap<string, number>;
		if (useSettledAnchors) {
			anchoredColumnById = settledColumnByIdRef.current;
		} else {
			anchoredColumnById = viewportAnchorColumnsRef.current;
			// Recovery fallback: if viewport anchors were cleared (e.g. on first
			// render before captureAnchors fires) reconstruct them from layout.
			if (
				props.viewMode === 'card' &&
				anchoredColumnById.size === 0 &&
				repackReason === 'measured-card-height' &&
				gridRef.current
			) {
				const anchorSourceColumns = viewportAnchorSourceColumnsRef.current.length > 0
					? viewportAnchorSourceColumnsRef.current
					: settledColumnsRef.current;
				if (anchorSourceColumns.length > 0) {
					const recoveredAnchors = collectViewportAnchorColumns({
						columns: anchorSourceColumns,
						grid: gridRef.current,
						overscanPx: Math.max(24, Math.round(fallbackH * 0.2)),
					});
					if (recoveredAnchors.size > 0) {
						anchoredColumnById = recoveredAnchors;
						viewportAnchorColumnsRef.current = recoveredAnchors;
						debugLayoutInvalidation('VIEWPORT_ANCHOR_RECOVERY', {
							reason: repackReason,
							anchorCount: recoveredAnchors.size,
						});
					}
				}
			}
		}
		const placementDecisions = new Map<string, StableMasonryPlacementDecision>();
		const columns = splitIntoColumnsByHeightAnchored({
			ids: renderedIds,
			columnCount,
			heightById: packedHeightLookup,
			gapPx,
			fallbackHeightPx: fallbackH,
			anchoredColumnById,
			preferredColumnById: settledColumnByIdRef.current,
			preferredSiblingIndexById: settledSiblingIndexByIdRef.current,
			onAssign: (decision) => {
				placementDecisions.set(decision.noteId, decision);
			},
		});
		// Bottom-note rebalancing: only the absolute bottom-most note of the
		// tallest column may migrate to the shortest column, one move at a time.
		// Mid-grid notes are never touched, preventing the "notes flying"
		// symptom.  Transient height oscillations (framer-motion, image loads)
		// are suppressed entirely to keep the grid visually stable.
		if (columnCount > 1) {
			const isChecklist = repackReason === 'checklist-expand' || repackReason === 'checklist-collapse';
			const isPreferenceChange = repackReason === 'max-card-height-change';
			// Suppress rebalancing for pure height fluctuations (framer-motion
			// spring oscillations, measured-card-height events, content loads).
			// useSettledAnchors is true for all such events; checklist events and
			// max-card-height preference changes also set useSettledAnchors but
			// intentionally deserve a bottom-note balancing pass.
			const suppressRebalance = useSettledAnchors && !isChecklist && !isPreferenceChange;
			if (!suppressRebalance) {
				let lockedPrefixCounts: number[];
				if (isChecklist || isPreferenceChange) {
					// The packing step already locked every note via settledColumnByIdRef.
					// Allow only the bottom-most note of each column to migrate so a
					// checklist expand/collapse can trim trailing height imbalances
					// without disturbing any mid-grid card positions.
					lockedPrefixCounts = columns.map((col) => Math.max(0, col.length - 1));
				} else {
					// For drag-drop and structural repacks, lock the anchored prefix;
					// only unlocked tail notes (off-screen or newly added) may move.
					// Always cap at col.length-1 so the bottom-most note is never
					// fully locked — even when all notes are in the anchor map (as
					// drag-drop builds a full-coverage anchor map to suppress
					// framer-motion oscillations during the drop animation).
					// Without this cap the rebalancer bails immediately when every
					// note is anchored (locked count === column length), producing
					// the "600 px spread after drop, no balancing" bug.
					lockedPrefixCounts = columns.map((col) => {
						let count = 0;
						while (count < col.length && anchoredColumnById.has(col[count])) {
							count++;
						}
						return Math.min(count, Math.max(0, col.length - 1));
					});
				}
				const rebalanced = rebalanceBottomNote({
					columns,
					heightOf: (id) => packedHeightLookup.get(id) ?? fallbackH,
					gapPx,
					fallbackHeightPx: fallbackH,
					lockedPrefixCounts,
					maxMoves: 3,
				});
				return {
					columns: rebalanced,
					placementDecisions,
				};
			}
		}
		return {
			columns,
			placementDecisions,
		};
	}, [renderedIds, columnCount, noteHeightsVersion, mobileGridGapPx, packedHeightLookup, props.maxCardHeightPx, props.viewMode]);
	const packedColumns = packedLayout.columns;
	const resolvedBaseColumns = packedColumns;
	const isListLikeView = props.viewMode === 'list' || props.viewMode === 'strip';
	const dragColumns = React.useMemo(() => (isListLikeView ? [visibleIds] : resolvedBaseColumns), [isListLikeView, resolvedBaseColumns, visibleIds]);

	// ── Wire up the drag manager ──────────────────────────────────────────
	// Passes baseColumns as the starting column layout.  During drag, the
	// manager computes previewColumns with the card at the live insertion
	// point; the grid renders whichever is available.
	const dragManager = useNoteGridDragManager({
		sectionRef,
		gridRef,
		columns: dragColumns,
		visibleIds,
		canStartDrag: () => !isTrashView && props.canReorder !== false && !touchScrollDetectedRef.current && Date.now() >= suppressTouchDragUntilRef.current,
		isTouchDragCandidate: () => pendingTouchIntentRef.current,
		onCommitOrder: commitVisibleOrder,
		onTouchDropCommit: props.onTouchReorderEnd,
		insertionSettleMs: isListLikeView ? 96 : 280,
		usePointerEdgeAutoScroll: isListLikeView,
	});

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		if (isListLikeView) return;
		let rafId = 0;
		const captureAnchors = (): void => {
			if (dragManager.activeDragId) return;
			// Don't overwrite anchors established at drag-commit (or by a prior scroll
			// capture) while a repack triggered by that change is still settling.
			// A RAF can fire between the drag-commit state update and the rebalance
			// effect settling, and if the user has scrolled past all notes by then,
			// the anchor map gets cleared — causing notes near the viewport to
			// unexpectedly swap columns during the still-pending repack.
			if (repackReasonRef.current !== 'settled') return;
			viewportAnchorSourceColumnsRef.current = resolvedBaseColumns.map((column) => [...column]);
			// Use the layout-calculated approach so the anchor map reflects computed
			// final positions rather than DOM positions that may still be animating
			// on the first RAF after a settle.
			const fallbackH = Math.min(props.maxCardHeightPx, 220);
			viewportAnchorColumnsRef.current = collectViewportAnchorColumnsFromLayout({
				columns: resolvedBaseColumns,
				heightById: noteHeightByIdRef.current,
				fallbackHeightPx: fallbackH,
				gapPx: readCssPxVariable('--grid-gap', 16),
				grid: gridRef.current,
				overscanPx: Math.max(24, Math.round(fallbackH * 0.2)),
			});
		};
		const scheduleCapture = (): void => {
			if (rafId) return;
			rafId = window.requestAnimationFrame(() => {
				rafId = 0;
				captureAnchors();
			});
		};
		scheduleCapture();
		window.addEventListener('scroll', scheduleCapture, { passive: true });
		window.addEventListener('resize', scheduleCapture);
		return () => {
			if (rafId) window.cancelAnimationFrame(rafId);
			window.removeEventListener('scroll', scheduleCapture);
			window.removeEventListener('resize', scheduleCapture);
		};
	}, [dragManager.activeDragId, isListLikeView, props.maxCardHeightPx, resolvedBaseColumns]);

	React.useEffect(() => {
		if (isListLikeView) {
			if (lastRebalanceSuppressionReasonRef.current !== 'list-like-view') {
				lastRebalanceSuppressionReasonRef.current = 'list-like-view';
				debugRebalanceSuppressed('list-like-view', { viewMode: props.viewMode });
			}
			return;
		}
		if (dragManager.activeDragId) {
			if (lastRebalanceSuppressionReasonRef.current !== 'active-drag') {
				lastRebalanceSuppressionReasonRef.current = 'active-drag';
				debugRebalanceSuppressed('active-drag', { draggedId: dragManager.activeDragId });
			}
			return;
		}
		lastRebalanceSuppressionReasonRef.current = null;
		const reason = repackReasonRef.current;
		const gapPx = mobileGridGapPx ?? readCssPxVariable('--grid-gap', 16);
		const fallbackH = Math.min(props.maxCardHeightPx, 220);
		const columnWidth = mobileCardWidthPx ?? readCssPxVariable('--note-card-width', 280);
		const previousColumns = settledColumnsRef.current;
		const previousLayout = previousColumns.length > 0
			? buildMasonryLayoutFromColumns({
				columns: previousColumns,
				columnWidth,
				gapPx,
				heightById: noteHeightByIdRef.current,
				fallbackHeightPx: fallbackH,
			})
			: null;
		const previousColumnSignature = previousColumns.map((column) => column.join('|')).join('||');
		const nextColumnSignature = resolvedBaseColumns.map((column) => column.join('|')).join('||');
		debugRepackReason(reason, {
			viewportAnchorCount: viewportAnchorColumnsRef.current.size,
			invalidatedCount: invalidatedNoteReasonsRef.current.size,
			recentlyMovedCount: recentlyMovedNoteIdsRef.current.size,
		});
		debugColumnHeightsBefore(previousLayout?.columnHeights ?? [], { reason });
		debugRepackStart(renderedIds.length, columnCount, reason);
		const masonryLayout = buildMasonryLayoutFromColumns({
			columns: resolvedBaseColumns,
			columnWidth,
			gapPx,
			heightById: noteHeightByIdRef.current,
			fallbackHeightPx: fallbackH,
		});
		if (previousColumnSignature === nextColumnSignature) {
			debugRebalanceSkipped('layout-unchanged', {
				reason,
				columnCount,
				viewportAnchorCount: viewportAnchorColumnsRef.current.size,
			});
		}
		debugRepackEnd({
			renderedCount: renderedIds.length,
			columnCount,
			columns: resolvedBaseColumns,
			columnHeights: masonryLayout.columnHeights,
			reason,
			notePositions: masonryLayout.items.map((item) => ({
				noteId: item.id,
				measuredHeight: noteHeightByIdRef.current.get(item.id) ?? fallbackH,
				assignedColumn: item.columnIndex,
				assignedYPosition: item.y,
			})),
		});
		const previousItemById = new Map((previousLayout?.items ?? []).map((item) => [item.id, item]));
		const nextItemById = new Map(masonryLayout.items.map((item) => [item.id, item]));
		const nextColumnById = buildColumnById(resolvedBaseColumns);
		const nextSiblingIndexById = buildSiblingIndexById(resolvedBaseColumns);
		const visibleIdSet = new Set(visibleIds);
		for (const [noteId, decision] of packedLayout.placementDecisions) {
			const previousColumn = settledColumnByIdRef.current.get(noteId) ?? null;
			const previousSiblingIndex = settledSiblingIndexByIdRef.current.get(noteId) ?? null;
			const newColumn = nextColumnById.get(noteId) ?? decision.assignedColumn;
			const newSiblingIndex = nextSiblingIndexById.get(noteId) ?? decision.assignedSiblingIndex;
			const previousItem = previousItemById.get(noteId) ?? null;
			const nextItem = nextItemById.get(noteId) ?? null;
			const lastInvalidationReason = invalidatedNoteReasonsRef.current.get(noteId) ?? null;
			const isViewportAnchor = viewportAnchorColumnsRef.current.has(noteId);
			const isRecentlyMoved = recentlyMovedNoteIdsRef.current.has(noteId);
			const isAffectedByExpansion = expansionAffectedNoteIdsRef.current.has(noteId);
			const isHeightChanged = lastInvalidationReason !== null && lastInvalidationReason !== 'drag-drop';
			const isAllowedToReposition = !isViewportAnchor || isRecentlyMoved || isAffectedByExpansion || isHeightChanged;
			const stabilityPriority = isViewportAnchor && !isAllowedToReposition
				? 'anchor-locked'
				: isRecentlyMoved
					? 'dragged-note'
					: isAffectedByExpansion
						? 'expansion-affected'
						: isHeightChanged
							? 'height-affected'
							: isViewportAnchor
								? 'viewport-anchor'
								: 'offscreen-free';
			const placementPayload = {
				noteId,
				previousColumn,
				newColumn,
				previousSiblingIndex,
				newSiblingIndex,
				previousY: previousItem?.y ?? null,
				nextY: nextItem?.y ?? null,
				isVisible: visibleIdSet.has(noteId),
				isViewportAnchor,
				isRecentlyMoved,
				isHeightChanged,
				isAffectedByExpansion,
				isAllowedToReposition,
				stabilityPriority,
				lastInvalidationReason,
				columnHeightsAtDecision: [...decision.columnHeightsAtDecision],
				assignedColumn: decision.assignedColumn,
				assignedSiblingIndex: decision.assignedSiblingIndex,
				previousColumnPreference: decision.preferredColumn,
				previousSiblingPreference: decision.previousSiblingIndex,
				anchoredColumn: decision.anchoredColumn,
				shortestColumn: decision.shortestColumn,
				shortestColumnHeight: decision.shortestColumnHeight,
				preferredColumn: decision.preferredColumn,
				preferredColumnHeight: decision.preferredColumnHeight,
				stabilitySlackPx: decision.stabilitySlackPx,
				measuredHeight: decision.measuredHeight,
				reason: decision.reason,
				viewportStabilityOverridden: decision.viewportStabilityOverridden,
				stableOrderOverridden: decision.stableOrderOverridden,
				tieBreakerOccurred: decision.tieBreakerOccurred,
			};
			debugNotePlacementDecision(placementPayload);
			if (nextItem) {
				debugNotePositionAssigned({
					noteId,
					columnIndex: newColumn,
					siblingIndex: newSiblingIndex,
					y: nextItem.y,
					height: decision.measuredHeight,
					previousY: previousItem?.y ?? null,
					previousColumn,
					previousSiblingIndex,
				});
			}
			if (decision.viewportStabilityOverridden) {
				debugViewportStabilityOverride(placementPayload);
			}
			if (decision.stableOrderOverridden) {
				debugStableOrderOverride(placementPayload);
			}
			const logPayload = {
				noteId,
				previousColumn,
				newColumn,
				previousSiblingIndex,
				newSiblingIndex,
				measuredHeight: decision.measuredHeight,
				reason: decision.reason,
				preferredColumnHeight: decision.preferredColumnHeight,
				shortestColumnHeight: decision.shortestColumnHeight,
				stabilitySlackPx: decision.stabilitySlackPx,
			};
			if (previousColumn !== null && previousColumn !== newColumn) {
				debugColumnAssignmentChanged(logPayload);
				debugColumnSwap(placementPayload);
			}
			if (previousSiblingIndex !== null && previousSiblingIndex !== newSiblingIndex) {
				debugSiblingOrderChanged(logPayload);
			}
		}
		settledColumnsRef.current = resolvedBaseColumns.map((column) => [...column]);
		settledColumnByIdRef.current = nextColumnById;
		settledSiblingIndexByIdRef.current = nextSiblingIndexById;
		invalidatedNoteReasonsRef.current.clear();
		expansionAffectedNoteIdsRef.current.clear();
		recentlyMovedNoteIdsRef.current.clear();
		repackReasonRef.current = 'settled';
	}, [columnCount, dragManager.activeDragId, isListLikeView, mobileCardWidthPx, mobileGridGapPx, packedLayout.placementDecisions, props.maxCardHeightPx, props.viewMode, renderedIds.length, resolvedBaseColumns, visibleIds]);

	// ── Active columns for rendering ──────────────────────────────────────
	// During drag, use previewColumns (with the card at the insertion point
	// and the placeholder holding the original space); otherwise use the
	// stable baseColumns.  framer-motion's `layout` prop on each card
	// automatically animates position changes when columns swap.
	const columns = dragManager.previewColumns ?? dragColumns;
	const listOrderedIds = React.useMemo(() => flattenColumns(columns), [columns]);

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

	// When the max-card-height preference changes, all previously measured heights
	// are stale (the CSS cap has moved). Clear the in-memory cache so the next
	// layout pass re-measures at the new cap instead of using the old values.
	// Skip the initial mount so we don't wipe heights seeded from localStorage.
	const maxCardHeightPxInitializedRef = React.useRef(false);
	React.useEffect(() => {
		if (!maxCardHeightPxInitializedRef.current) {
			maxCardHeightPxInitializedRef.current = true;
			return;
		}
		// Keep the measured cache, but clamp it to the new cap. Clearing every
		// height forces an immediate fallback-estimate pack that can re-freeze the
		// old layout before live ResizeObserver measurements arrive.
		for (const [noteId, measuredHeight] of noteHeightByIdRef.current) {
			noteHeightByIdRef.current.set(noteId, Math.min(measuredHeight, props.maxCardHeightPx));
		}
		repackReasonRef.current = 'max-card-height-change';
		setNoteHeightsVersion((v) => v + 1);
	}, [props.maxCardHeightPx]);

	// Persist a DOM snapshot of currently mounted cards for warm starts and
	// local rect/height hydration. Height updates themselves now come from
	// per-card ResizeObservers so virtualized columns can keep offscreen estimates.
	React.useLayoutEffect(() => {
		if (!isGridVisible) return;
		if (isListLikeView) return;
		if (!initialLayoutSettled) return;
		const grid = gridRef.current;
		if (!grid) return;
		const documentRects = measureDocumentRects(grid);
		if (documentRects.size === 0) return;
		if (!dragManager.activeDragId && props.activeWorkspaceId && renderedIds.length > 0) {
			const gridRect = grid.getBoundingClientRect();
			writeNoteGridLayoutSnapshot(
				{
					workspaceId: props.activeWorkspaceId,
					viewMode: props.viewMode ?? 'card',
					deviceType: layoutDeviceType,
					density: layoutDensityKey,
					viewportBucket: layoutViewportBucket,
				},
				{
					orderedIds: renderedIds.slice(),
					columnCount,
					columnSlots: null,
					rects: renderedIds.flatMap((id) => {
						const rect = documentRects.get(id);
						if (!rect) return [];
						return [{
							id,
							x: Math.round(rect.left - gridRect.left),
							y: Math.round(rect.top - gridRect.top),
							width: Math.round(rect.width),
							height: Math.round(rect.height),
						}];
					}),
				}
			);
		}
	}, [columnCount, columns, dragManager.activeDragId, initialLayoutSettled, isGridVisible, isListLikeView, layoutDensityKey, layoutDeviceType, layoutViewportBucket, noteHeightsVersion, props.activeWorkspaceId, props.viewMode, renderedIds]);

	const activeOverlayId = dragManager.activeDragId ?? dragManager.dropOverlay?.id ?? null;
	const activeDoc = activeOverlayId ? docsById[activeOverlayId] : undefined;
	const activeNote = activeOverlayId ? noteById.get(activeOverlayId) : undefined;
	const activeHasPendingSync = activeNote ? pendingSyncNoteIds.has(activeNote.id) : false;
	const activePlacement = activeNote ? (props.sharedNotes ?? []).find((entry) => entry.aliasId === activeNote.id) : undefined;
	const activeDocId = activeNote ? activePlacement?.roomId || resolveMediaDocId(activeNote.id) : undefined;
	const activeCanEdit = Boolean(
		activeNote && !isTrashView && (activeNote.isShared ? activePlacement?.role === 'EDITOR' : props.canEditWorkspaceContent !== false)
	);
	const activeSnapshot = activeNote ? noteSnapshotById.get(activeNote.id) : undefined;
	const activeIsPinned = activeSnapshot?.isPinned === true;
	const activeHasReminder = Boolean(activeSnapshot?.reminderAt);
	const activeTitle = activeDoc?.getText('title').toString().trim() || t('note.untitled');
	const activeIsChecklist = Boolean(activeDoc && String(activeDoc.getMap<any>('metadata').get('type') ?? '') === 'checklist');
	const activeStripPreview = React.useMemo(() => {
		if (props.viewMode !== 'strip' || !activeDoc || !activeNote) return '';
		try {
			const note = readNoteFromDoc(activeDoc, activeNote.id);
			if (note.type === 'checklist') {
				const items = note.items ?? [];
				if (items.length === 0) return '';
				const done = items.filter((entry) => entry.completed).length;
				return `${done} / ${items.length}`;
			}
			const content = (note.content ?? '').replace(/\s+/g, ' ').trim();
			if (!content) return '';
			return content.length > 110 ? `${content.slice(0, 109)}...` : content;
		} catch {
			return '';
		}
	}, [activeDoc, activeNote, props.viewMode]);
	const [dragPreviewMarkup, setDragPreviewMarkup] = React.useState('');
	React.useLayoutEffect(() => {
		const previewNoteId = dragManager.activeDragId ?? dragManager.dropOverlay?.id ?? null;
		if (!previewNoteId || isListLikeView) {
			setDragPreviewMarkup('');
			return;
		}
		const itemElement = dragManager.getItemElement(previewNoteId);
		const contentElement = itemElement?.querySelector<HTMLElement>('[data-note-content="true"]') ?? null;
		setDragPreviewMarkup(contentElement?.innerHTML ?? '');
	}, [dragManager, dragManager.activeDragId, dragManager.dropOverlay?.id, isListLikeView]);
	const activeCollaboratorSummary = activeNote ? collaboratorSummariesByNoteId[activeNote.id] ?? null : null;
	const moreMenuDoc = moreMenuNoteId ? docsById[moreMenuNoteId] : undefined;
	const moreMenuPlacement = moreMenuNoteId ? (props.sharedNotes ?? []).find((entry) => entry.aliasId === moreMenuNoteId) : undefined;
	const moreMenuDocId = moreMenuNoteId ? moreMenuPlacement?.roomId || resolveMediaDocId(moreMenuNoteId) : undefined;
	const moreMenuCanEdit = Boolean(
		moreMenuNoteId && !isTrashView && (sharedNoteIdSet.has(moreMenuNoteId) ? moreMenuPlacement?.role === 'EDITOR' : props.canEditWorkspaceContent !== false)
	);
	const collaboratorOverlaySummary = openCollaboratorChip ? collaboratorSummariesByNoteId[openCollaboratorChip.noteId] ?? null : null;
	const collectionPathById = React.useMemo(() => buildCollectionPathMap(props.collections ?? []), [props.collections]);
	const labelById = React.useMemo(() => new Map((props.labels ?? []).map((label) => [label.id, label] as const)), [props.labels]);
	const hasOpenChipOverlay = Boolean(openCollaboratorChip || openMetadataChip || openAttachmentChipNoteId);
	const collaboratorCountByNoteId = React.useMemo<Record<string, number>>(() => {
		const result: Record<string, number> = {};
		for (const [noteId, summary] of Object.entries(collaboratorSummariesByNoteId)) {
			result[noteId] = summary?.count ?? 0;
		}
		return result;
	}, [collaboratorSummariesByNoteId]);
	const openOverlayNoteId = openCollaboratorChip?.noteId ?? openMetadataChip?.noteId ?? openAttachmentChipNoteId;
	const overlayActiveNoteId = openOverlayNoteId ?? latchedOverlayNoteId;
	const collaboratorOverlayColorStyle = React.useMemo(() => {
		if (!openCollaboratorChip) return undefined;
		const doc = docsById[openCollaboratorChip.noteId];
		if (!doc) return undefined;
		return getNoteColorVars(openCollaboratorChip.noteId, doc, props.themeId);
	}, [docsById, openCollaboratorChip, props.themeId]);
	const metadataOverlayColorStyle = React.useMemo(() => {
		if (!openMetadataChip) return undefined;
		const doc = docsById[openMetadataChip.noteId];
		if (!doc) return undefined;
		return getNoteColorVars(openMetadataChip.noteId, doc, props.themeId);
	}, [docsById, openMetadataChip, props.themeId]);
	const closeChipOverlays = React.useCallback((): void => {
		setOpenCollaboratorChip(null);
		setOpenMetadataChip(null);
		setOpenAttachmentChipNoteId(null);
		setLatchedOverlayNoteId(null);
	}, []);

	React.useEffect(() => {
		if (typeof window === 'undefined') {
			setIsChipInteractionGuardActive(hasOpenChipOverlay);
			return;
		}
		if (chipInteractionGuardTimerRef.current) {
			window.clearTimeout(chipInteractionGuardTimerRef.current);
			chipInteractionGuardTimerRef.current = 0;
		}
		if (hasOpenChipOverlay) {
			setIsChipInteractionGuardActive(true);
			return;
		}
		chipInteractionGuardTimerRef.current = window.setTimeout(() => {
			chipInteractionGuardTimerRef.current = 0;
			setIsChipInteractionGuardActive(false);
		}, 420);
		return () => {
			if (chipInteractionGuardTimerRef.current) {
				window.clearTimeout(chipInteractionGuardTimerRef.current);
				chipInteractionGuardTimerRef.current = 0;
			}
		};
	}, [hasOpenChipOverlay]);

	React.useEffect(() => {
		if (overlayReleaseTimerRef.current) {
			window.clearTimeout(overlayReleaseTimerRef.current);
			overlayReleaseTimerRef.current = 0;
		}
		if (openOverlayNoteId) {
			setLatchedOverlayNoteId(openOverlayNoteId);
			return;
		}
		if (!latchedOverlayNoteId) return;
		// Keep the originating note visually "active" through dropdown exit motion
		// so it doesn't momentarily drop back into the blurred background.
		overlayReleaseTimerRef.current = window.setTimeout(() => {
			overlayReleaseTimerRef.current = 0;
			setLatchedOverlayNoteId(null);
		}, 220);
		return () => {
			if (overlayReleaseTimerRef.current) {
				window.clearTimeout(overlayReleaseTimerRef.current);
				overlayReleaseTimerRef.current = 0;
			}
		};
	}, [latchedOverlayNoteId, openOverlayNoteId]);

	React.useEffect(() => {
		if (!props.selectedNoteId && !moreMenuNoteId && !dragManager.activeDragId) return;
		closeChipOverlays();
	}, [closeChipOverlays, dragManager.activeDragId, moreMenuNoteId, props.selectedNoteId]);

	React.useEffect(() => {
		if (typeof window === 'undefined' || typeof document === 'undefined') return;
		const handleVisibilityChange = (): void => {
			if (document.visibilityState === 'hidden') {
				closeChipOverlays();
			}
		};
		window.addEventListener('blur', closeChipOverlays);
		window.addEventListener('pagehide', closeChipOverlays);
		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => {
			window.removeEventListener('blur', closeChipOverlays);
			window.removeEventListener('pagehide', closeChipOverlays);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	}, [closeChipOverlays]);
	const suspendAttachmentRemoteRefresh = Boolean(dragManager.activeDragId);
	// Allow attachment chips to refresh once the grid has finished hydrating so
	// cold loads show correct counts without firing per-note requests during the
	// skeleton/loading phase.
	const disableAttachmentInitialRemoteRefresh = !allDocsLoaded;
	const collaboratorOverlayPosition = React.useMemo(() => {
		if (!openCollaboratorChip || typeof window === 'undefined') return null;
		// Match the masonry grid edge clamp on coarse pointers so left-column cards
		// open centered chip overlays instead of drifting to the right.
		const horizontalViewportInset = isCoarsePointer ? MOBILE_GRID_EDGE_MARGIN_PX : 12;
		const minimumOverlayWidth = isCoarsePointer ? 196 : 176;
		const overlayWidth = Math.min(
			Math.max(minimumOverlayWidth, Math.round(openCollaboratorChip.anchorRect.width)),
			window.innerWidth - horizontalViewportInset * 2
		);
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const centeredLeft = openCollaboratorChip.anchorRect.left + (openCollaboratorChip.anchorRect.width - overlayWidth) / 2;
		const left = Math.min(
			Math.max(horizontalViewportInset, centeredLeft),
			Math.max(horizontalViewportInset, viewportWidth - overlayWidth - horizontalViewportInset)
		);
		const visibleRows = Math.min(MAX_VISIBLE_COLLABORATORS, collaboratorOverlaySummary?.count ?? 1);
		const estimatedHeight = Math.min(240, Math.max(84, visibleRows * 44 + 16));
		const preferredTop = openCollaboratorChip.anchorRect.top + openCollaboratorChip.anchorRect.height + 8;
		const top = preferredTop + estimatedHeight <= viewportHeight - 12
			? preferredTop
			: Math.max(12, openCollaboratorChip.anchorRect.top - estimatedHeight - 8);
		return { top, left, width: overlayWidth };
	}, [collaboratorOverlaySummary?.count, isCoarsePointer, openCollaboratorChip]);
	const metadataOverlayPosition = React.useMemo(() => {
		if (!openMetadataChip || typeof window === 'undefined') return null;
		// Align metadata overlays to the same card-width anchor as other note chips.
		// Reuse the mobile grid inset here as well so every chip overlay clamps the
		// same way on narrow screens.
		const horizontalViewportInset = isCoarsePointer ? MOBILE_GRID_EDGE_MARGIN_PX : 12;
		const overlayWidth = Math.min(
			Math.round(openMetadataChip.anchorRect.width),
			window.innerWidth - horizontalViewportInset * 2
		);
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const centeredLeft = openMetadataChip.anchorRect.left + (openMetadataChip.anchorRect.width - overlayWidth) / 2;
		const left = Math.min(
			Math.max(horizontalViewportInset, centeredLeft),
			Math.max(horizontalViewportInset, viewportWidth - overlayWidth - horizontalViewportInset)
		);
		const estimatedHeight = Math.min(260, Math.max(84, openMetadataChip.entries.length * 38 + 18));
		const preferredTop = openMetadataChip.anchorRect.top + openMetadataChip.anchorRect.height + 8;
		const top = preferredTop + estimatedHeight <= viewportHeight - 12
			? preferredTop
			: Math.max(12, openMetadataChip.anchorRect.top - estimatedHeight - 8);
		return { top, left, width: overlayWidth };
	}, [isCoarsePointer, openMetadataChip]);
	const cardPositionAnimationsReady = layoutReady && startupLayoutAnimationsReady;
	const isDropSettling = Boolean(dragManager.dropOverlay) && !dragManager.activeDragId;
	const dropSettlingOverlayTarget = isDropSettling ? dragManager.dropOverlay?.settleTo ?? null : null;
	const dropSettlingNoteId = isDropSettling ? dragManager.dropOverlay?.id ?? null : null;
	const debugCurrentColumnHeights = React.useMemo(() => {
		const gapPx = mobileGridGapPx ?? readCssPxVariable('--grid-gap', 16);
		const fallbackH = Math.min(props.maxCardHeightPx, 220);
		return resolvedBaseColumns.map((column) => column.reduce((total, id, index) => (
			total + (noteHeightByIdRef.current.get(id) ?? fallbackH) + (index > 0 ? gapPx : 0)
		), 0));
	}, [mobileGridGapPx, props.maxCardHeightPx, resolvedBaseColumns, noteHeightsVersion]);

	React.useEffect(() => {
		debugGridRender({
			renderedCount: renderedIds.length,
			columnCount,
			activeDragId: dragManager.activeDragId,
			isDropSettling,
		});
		debugUpdateLiveState({
			scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
			activeDragId: dragManager.activeDragId,
			stickyColumnSizes: null,
			resolvedBaseColumnSizes: resolvedBaseColumns.map((column) => column.length),
			columnHeights: debugCurrentColumnHeights,
			renderedCount: renderedIds.length,
			columnCount,
			initialLayoutSettled,
			noteHeightsVersion,
			isGridVisible,
			workspaceId: props.activeWorkspaceId ?? null,
			isDropSettling,
			dropSettlingNoteId,
			cardPositionAnimationsReady,
			activeViewportAnchorIds: Array.from(viewportAnchorColumnsRef.current.keys()),
			activeInvalidations: Array.from(invalidatedNoteReasonsRef.current.entries()).map(([noteId, reason]) => ({
				noteId,
				reason,
				updatedAt: Date.now(),
				height: noteHeightByIdRef.current.get(noteId) ?? null,
			})),
			activeAnimations: [
				cardPositionAnimationsReady ? 'card-position' : '',
				isDropSettling ? 'drop-settle' : '',
				dragManager.activeDragId ? 'drag-active' : '',
			].filter(Boolean),
			lastRepackReason: repackReasonRef.current,
		});
	});
	const renderGridCard = React.useCallback((noteId: string): React.ReactNode => {
		const note = noteById.get(noteId);
		if (!note) return null;
		const liveDoc = docsById[note.id] ?? manager.peekDoc(note.id) ?? null;
		const hasRenderableLiveDoc = Boolean(liveDoc && hasRenderableNoteContent(liveDoc));
		const snapshotDoc = !hasRenderableLiveDoc ? (snapshotDocById.get(note.id) ?? null) : null;
		const doc = hasRenderableLiveDoc ? liveDoc : snapshotDoc;
		if (!doc) {
			// Render a skeleton card at the cached height so masonry packing is stable
			// and no layout repack occurs when the doc loads.
			const skeletonH = noteHeightByIdRef.current.get(note.id) ?? getEstimatedNoteHeight(note.id);
			return (
				<div key={note.id} className={styles.item} data-note-id={note.id} style={{ height: skeletonH }}>
					<div className={styles.skeletonCard} style={{ height: skeletonH }} />
				</div>
			);
		}
		const isSnapshotCard = !hasRenderableLiveDoc && Boolean(snapshotDoc);
		const isPlaceholder = dragManager.activeDragId === note.id;
		const cachedMeasuredHeightPx = noteHeightByIdRef.current.get(note.id) ?? null;
		const collaboratorSummary = collaboratorSummariesByNoteId[note.id];
		const snapshotShell = workspaceRenderSnapshotNoteById.get(note.id) ?? null;
		const noteType = String(doc.getMap('metadata').get('type') ?? 'text') === 'checklist' ? 'checklist' : 'text';
		const placement = (props.sharedNotes ?? []).find((entry) => entry.aliasId === note.id);
		const docId = placement?.roomId || resolveMediaDocId(note.id);
		const reminderAt = (docId ? props.noteReminderByDocId?.[docId] : undefined) ?? props.noteReminderByDocId?.[note.id] ?? snapshotShell?.reminderAt ?? null;
		const canEditNote = !isSnapshotCard && !isTrashView && (note.isShared ? placement?.role === 'EDITOR' : props.canEditWorkspaceContent !== false);
		const title = doc.getText('title').toString();
		const initialLinkRecords = docId && snapshotShell?.previewCards?.length
			? snapshotShell.previewCards.map((card, index) => ({
				id: `snapshot:${note.id}:${card.normalizedUrl || index}`,
				docId,
				sourceWorkspaceId: '',
				sourceNoteId: note.id,
				normalizedUrl: card.normalizedUrl,
				originalUrl: card.originalUrl,
				hostname: card.hostname,
				rootDomain: card.rootDomain,
				siteName: card.siteName,
				title: card.title,
				description: card.description,
				mainContent: card.mainContent,
				imageUrl: card.imageUrl,
				metadataJson: null,
				imageUrls: card.imageUrls,
				sortOrder: card.sortOrder,
				status: card.status,
				errorMessage: null,
				createdAt: '',
				updatedAt: '',
			}))
			: undefined;
		return (
			<GridNoteCard
				key={note.id}
				note={note}
				docId={docId}
				authUserId={props.authUserId}
				themeId={props.themeId}
				doc={doc}
				reminderAt={reminderAt}
				metaChips={renderNoteMetaChips({
					noteId: note.id,
					docId,
					doc,
					sharedPlacement: sharedPlacementByAlias.get(note.id) ?? null,
					collectionPathById,
					labelById,
					activeCollectionId: props.activeCollectionId,
					activeLabelIds: props.activeLabelIds,
					authUserId: props.authUserId,
					canEditNote,
					suspendAttachmentRemoteRefresh,
					disableAttachmentInitialRemoteRefresh: disableAttachmentInitialRemoteRefresh && !note.isShared,
					forceCloseAttachmentChip: Boolean(openCollaboratorChip || openMetadataChip || (openAttachmentChipNoteId !== null && openAttachmentChipNoteId !== note.id)),
					collaboratorSummary,
					snapshotShell,
					onOpenAttachmentBrowser: props.onOpenAttachmentBrowser,
					onToggleCollaboratorChip: (chipNoteId, anchorRect) => {
						setOpenAttachmentChipNoteId(null);
						setOpenMetadataChip(null);
						setOpenCollaboratorChip((current) => current?.noteId === chipNoteId ? null : { noteId: chipNoteId, anchorRect });
					},
					onOpenMetadataChip: ({ noteId: chipNoteId, kind, anchorRect, entries }) => {
						setOpenAttachmentChipNoteId(null);
						setOpenCollaboratorChip(null);
						setOpenMetadataChip((current) => current && current.noteId === chipNoteId && current.kind === kind ? null : { noteId: chipNoteId, kind, anchorRect, entries });
					},
					onAttachmentChipOpenStateChange: (chipNoteId, isOpen) => {
						if (isOpen) {
							setOpenCollaboratorChip(null);
							setOpenMetadataChip(null);
						}
						setOpenAttachmentChipNoteId((current) => {
							if (isOpen) return chipNoteId;
							return current === chipNoteId ? null : current;
						});
					},
					t,
					themeId: props.themeId,
					title,
				})}
				forcedHeightPx={isSnapshotCard && cachedMeasuredHeightPx && cachedMeasuredHeightPx > 0 ? cachedMeasuredHeightPx : undefined}
				canEdit={canEditNote}
				hasPendingSync={pendingSyncNoteIds.has(note.id)}
				selected={props.selectedNoteId === note.id}
				isMoreMenuOpen={moreMenuNoteId === note.id}
				isTrashView={isTrashView}
				initialLinkRecords={initialLinkRecords}
				preserveControlShell={isSnapshotCard}
				dropSettling={isDropSettling}
				// In trash view, opening is suppressed and restore is wired instead.
				onOpen={!isTrashView ? () => {
					if (moreMenuNoteId) return;
					if (dragManager.shouldSuppressOpen()) return;
					if (isChipInteractionGuardActive) return;
					if (openCollaboratorChip || openMetadataChip || openAttachmentChipNoteId) return;
					if (Date.now() < suppressGridOpenUntilRef.current) return;
					props.onSelectNote(note.id);
				} : undefined}
				allowChecklistItemInteractions={props.noteCardCheckboxInteractions !== false}
				allowLinkInteractions={props.noteCardLinkInteractions !== false}
				allowCompletedItemInteractions={!isSnapshotCard && props.noteCardCompletedInteractions !== false}
				suppressContentInteractions={isChipInteractionGuardActive}
				onAddReminder={props.onAddReminder ? () => props.onAddReminder?.(note.id, docId, doc.getText('title').toString()) : undefined}
				onRestoreNote={isTrashView ? () => { void manager.restoreNote(note.id); } : undefined}
				onAddCollaborator={props.onAddCollaborator ? () => props.onAddCollaborator?.(note.id, doc.getText('title').toString()) : undefined}
				onAddImage={props.onAddImage ? () => {
					if (!docId) return;
					props.onAddImage?.(note.id, docId, doc.getText('title').toString());
				} : undefined}
				onMoreMenu={(anchorRect) => {
					const cardEl = gridRef.current?.querySelector(`[data-note-id="${note.id}"]`);
					setMoreMenuOpenedByLongPress(typeof anchorRect === 'undefined');
					setMoreMenuAnchorRect(anchorRect ?? (cardEl ? cardEl.getBoundingClientRect().toJSON() : null));
					setMoreMenuNoteId(note.id);
				}}
				maxCardHeightPx={props.maxCardHeightPx}
				isPlaceholder={isPlaceholder}
				isOverlayActiveCard={overlayActiveNoteId === note.id}
				layoutReady={cardPositionAnimationsReady}
				hideDuringDropSettle={dropSettlingNoteId === note.id}
				setItemElement={dragManager.setItemElement}
				setHandleElement={!isTrashView && !note.isShared ? dragManager.setHandleElement : () => {}}
			/>
		);
	}, [allDocsLoaded, cardPositionAnimationsReady, collaboratorSummariesByNoteId, collectionPathById, disableAttachmentInitialRemoteRefresh, docsById, dragManager.activeDragId, dragManager.dropOverlay, dragManager.setHandleElement, dragManager.setItemElement, dropSettlingNoteId, getEstimatedNoteHeight, gridRef, isChipInteractionGuardActive, isDropSettling, isTrashView, labelById, manager, moreMenuNoteId, noteById, noteHeightByIdRef, openAttachmentChipNoteId, openCollaboratorChip, openMetadataChip, overlayActiveNoteId, pendingSyncNoteIds, props.activeCollectionId, props.activeLabelIds, props.authUserId, props.canEditWorkspaceContent, props.maxCardHeightPx, props.noteCardCheckboxInteractions, props.noteCardCompletedInteractions, props.noteCardLinkInteractions, props.noteReminderByDocId, props.onAddCollaborator, props.onAddImage, props.onAddReminder, props.onOpenAttachmentBrowser, props.onSelectNote, props.selectedNoteId, props.sharedNotes, props.themeId, resolveMediaDocId, snapshotDocById, suspendAttachmentRemoteRefresh, t]);
	const isGroupedView = groupedSections.length > 0;
	const groupedGapPx = mobileGridGapPx ?? readCssPxVariable('--grid-gap', 16);
	const groupedFallbackHeightPx = Math.min(props.maxCardHeightPx, 220);
	const columnVirtualOverscan = React.useMemo(
		() => getColumnVirtualOverscan(columnCount, isCoarsePointer),
		[columnCount, isCoarsePointer]
	);

	React.useEffect(() => {
		if ((!openCollaboratorChip && !openMetadataChip) || typeof window === 'undefined') return;
		if (isCoarsePointer) return;
		const closeOverlay = (): void => closeChipOverlays();
		window.addEventListener('wheel', closeOverlay, { passive: true });
		window.addEventListener('scroll', closeOverlay, true);
		return () => {
			window.removeEventListener('wheel', closeOverlay);
			window.removeEventListener('scroll', closeOverlay, true);
		};
	}, [closeChipOverlays, isCoarsePointer, openCollaboratorChip, openMetadataChip]);

	React.useEffect(() => {
		if ((!openCollaboratorChip && !openMetadataChip && !openAttachmentChipNoteId) || typeof document === 'undefined') return;
		const handlePointerDown = (event: PointerEvent): void => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			if (target.closest('[data-note-chip-trigger="true"]')) return;
			if (target.closest('[data-note-chip-panel="true"]')) return;
			if (collaboratorOverlayPanelRef.current?.contains(target)) return;
			if (metadataOverlayPanelRef.current?.contains(target)) return;
			if (event.cancelable) event.preventDefault();
			event.stopPropagation();
			// Delay card-opening gestures long enough for the overlay close to win,
			// otherwise touch devices can treat the dismiss tap as a note open.
			suppressGridOpenUntilRef.current = Date.now() + 320;
			suppressNoteCardInteractionUntilRef.current = Date.now() + 520;
			closeChipOverlays();
		};
		document.addEventListener('pointerdown', handlePointerDown, true);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown, true);
		};
	}, [closeChipOverlays, openAttachmentChipNoteId, openCollaboratorChip, openMetadataChip]);

	React.useEffect(() => {
		if (!moreMenuNoteId || typeof document === 'undefined') return;
		const handlePointerDown = (event: PointerEvent): void => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			if (target.closest('[data-note-more-menu-panel="true"]')) return;
			if (target.closest('[data-note-more-menu-overlay="true"]')) return;
			if (target.closest('[data-more-btn="true"]')) return;
			if (!target.closest('[data-note-card="true"], [data-note-list-row="true"]')) return;
			if (event.cancelable) event.preventDefault();
			event.stopPropagation();
			suppressGridOpenUntilRef.current = Date.now() + 320;
			suppressNoteCardInteractionUntilRef.current = Date.now() + 520;
			setMoreMenuNoteId(null);
			setMoreMenuAnchorRect(null);
		};
		document.addEventListener('pointerdown', handlePointerDown, true);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown, true);
		};
	}, [moreMenuNoteId]);

	React.useEffect(() => {
		if (typeof document === 'undefined') return;
		const blockSuppressedInteraction = (event: Event): void => {
			if (Date.now() >= suppressNoteCardInteractionUntilRef.current) return;
			if (!isBlockedNoteCardInteractionTarget(event.target)) return;
			if (event.cancelable) event.preventDefault();
			event.stopPropagation();
			const nativeEvent = event as Event & { stopImmediatePropagation?: () => void };
			nativeEvent.stopImmediatePropagation?.();
		};
		document.addEventListener('click', blockSuppressedInteraction, true);
		document.addEventListener('pointerup', blockSuppressedInteraction, true);
		document.addEventListener('mouseup', blockSuppressedInteraction, true);
		document.addEventListener('touchend', blockSuppressedInteraction, true);
		return () => {
			document.removeEventListener('click', blockSuppressedInteraction, true);
			document.removeEventListener('pointerup', blockSuppressedInteraction, true);
			document.removeEventListener('mouseup', blockSuppressedInteraction, true);
			document.removeEventListener('touchend', blockSuppressedInteraction, true);
		};
	}, []);

	React.useEffect(() => {
		if (!openCollaboratorChip || !isCoarsePointer) return;
		const panel = collaboratorOverlayPanelRef.current;
		if (!panel) return;

		const onTouchMove = (event: TouchEvent): void => {
			if (!event.cancelable) return;
			const list = collaboratorOverlayListRef.current;
			const touch = event.touches[0];
			if (!list || !touch) {
				event.preventDefault();
				return;
			}
			const isScrollable = list.scrollHeight > list.clientHeight + 1;
			if (!isScrollable) {
				event.preventDefault();
				return;
			}
			const previousY = collaboratorTouchYRef.current;
			collaboratorTouchYRef.current = touch.clientY;
			if (previousY === null) return;
			const deltaY = touch.clientY - previousY;
			const atTop = list.scrollTop <= 0;
			const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
			if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
				event.preventDefault();
			}
		};

		panel.addEventListener('touchmove', onTouchMove, { passive: false });
		return () => {
			panel.removeEventListener('touchmove', onTouchMove);
			collaboratorTouchYRef.current = null;
		};
	}, [isCoarsePointer, openCollaboratorChip]);

	React.useEffect(() => {
		if (!openCollaboratorChip || !isCoarsePointer || typeof window === 'undefined') return;
		try {
			const currentState = window.history.state as Record<string, unknown> | null;
			window.history.pushState({ ...(currentState ?? {}), __chipOverlay: 'collaborator' }, '', window.location.href);
			collaboratorBackStatePushedRef.current = true;
		} catch {
			collaboratorBackStatePushedRef.current = false;
		}

		const onPopState = (): void => {
			setOpenCollaboratorChip(null);
		};
		window.addEventListener('popstate', onPopState);
		return () => {
			window.removeEventListener('popstate', onPopState);
			if (collaboratorBackStatePushedRef.current) {
				collaboratorBackStatePushedRef.current = false;
				try {
					const state = window.history.state as Record<string, unknown> | null;
					if (state && state.__chipOverlay === 'collaborator') {
						window.history.back();
					}
				} catch {
					// No-op if history APIs are unavailable.
				}
			}
		};
	}, [isCoarsePointer, openCollaboratorChip]);

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
				if (!target?.closest('[data-note-card="true"], [data-note-list-row="true"]')) return;
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
			{visibleIds.length === 0 ? (
				<div className={styles.emptyState} role="status">
					{props.emptyStateLabel || t('search.noResults')}
				</div>
			) : null}
			{(props.viewMode === 'list' || props.viewMode === 'strip') && visibleIds.length > 0 ? (
				<div ref={gridRef} className={isGroupedView ? styles.groupedSections : styles.listGrid} aria-label={t('grid.notesGrid')}>
					{isGroupedView ? groupedSections.map((section) => (
						<div key={section.key} className={styles.groupSection}>
							<div className={styles.groupHeader}>
								<h3 className={styles.groupTitle}>{section.label}</h3>
								<span className={styles.groupHeaderRule} aria-hidden="true" />
							</div>
							<div className={styles.listGrid}>
								<div className={styles.listColumn}>
									<NoteListView
										variant={props.viewMode}
										orderedIds={section.noteIds}
										docsById={docsById}
										noteSnapshotById={noteSnapshotById}
										collectionPathById={collectionPathById}
										labelById={labelById}
										collaboratorCountByNoteId={collaboratorCountByNoteId}
										selectedNoteId={props.selectedNoteId}
										moreMenuNoteId={moreMenuNoteId}
										themeId={props.themeId}
										activeDragId={dragManager.activeDragId}
										setItemElement={dragManager.setItemElement}
										setHandleElement={dragManager.setHandleElement}
										shouldSuppressOpen={() => dragManager.shouldSuppressOpen() || moreMenuNoteId !== null}
										canOpenNotes={!isTrashView}
										isTrashView={isTrashView}
										restoreLabel={t('noteMenu.restoreNote')}
										canDrag={(noteId) => {
											const note = noteById.get(noteId);
											if (!note) return false;
											return !isTrashView && !note.isShared && props.canReorder !== false;
										}}
										onSelectNote={props.onSelectNote}
										onMoreMenu={(noteId, rect) => {
											setMoreMenuOpenedByLongPress(false);
											setMoreMenuAnchorRect(rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null);
											setMoreMenuNoteId(noteId);
										}}
										onRestoreNote={isTrashView ? (noteId) => {
											void manager.restoreNote(noteId);
										} : undefined}
									/>
								</div>
							</div>
						</div>
					)) : (
						<div className={styles.listColumn}>
							<NoteListView
								variant={props.viewMode}
								orderedIds={listOrderedIds}
								docsById={docsById}
								noteSnapshotById={noteSnapshotById}
								collectionPathById={collectionPathById}
								labelById={labelById}
								collaboratorCountByNoteId={collaboratorCountByNoteId}
								selectedNoteId={props.selectedNoteId}
								moreMenuNoteId={moreMenuNoteId}
								themeId={props.themeId}
								activeDragId={dragManager.activeDragId}
								setItemElement={dragManager.setItemElement}
								setHandleElement={dragManager.setHandleElement}
								shouldSuppressOpen={() => dragManager.shouldSuppressOpen() || moreMenuNoteId !== null}
								canOpenNotes={!isTrashView}
								isTrashView={isTrashView}
								restoreLabel={t('noteMenu.restoreNote')}
								canDrag={(noteId) => {
									const note = noteById.get(noteId);
									if (!note) return false;
									return !isTrashView && !note.isShared && props.canReorder !== false;
								}}
								onSelectNote={props.onSelectNote}
								onMoreMenu={(noteId, rect) => {
									setMoreMenuOpenedByLongPress(false);
									setMoreMenuAnchorRect(rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null);
									setMoreMenuNoteId(noteId);
								}}
								onRestoreNote={isTrashView ? (noteId) => {
									void manager.restoreNote(noteId);
								} : undefined}
							/>
						</div>
					)}
				</div>
			) : null}
			{props.viewMode !== 'list' && props.viewMode !== 'strip' ? (
			<LayoutGroup>
				<div ref={gridRef} className={isGroupedView ? styles.groupedSections : styles.grid} aria-label={t('grid.notesGrid')} style={{
					['--grid-columns' as any]: String(columnCount),
					...(mobileCardWidthPx !== null ? { ['--note-card-width' as any]: `${mobileCardWidthPx}px` } : {}),
					...(mobileGridGapPx !== null ? { ['--grid-gap' as any]: `${mobileGridGapPx}px` } : {}),
				}}>
					{isGroupedView
						? groupedSections.map((section) => {
							const sectionColumns = splitIntoColumnsByHeight(section.noteIds, columnCount, packedHeightLookup, groupedGapPx, groupedFallbackHeightPx);
							return (
								<div key={section.key} className={styles.groupSection}>
									<div className={styles.groupHeader}>
										<h3 className={styles.groupTitle}>{section.label}</h3>
										<span className={styles.groupHeaderRule} aria-hidden="true" />
									</div>
									<div className={styles.grid}>
										{sectionColumns.map((columnIds, columnIndex) => (
											<div key={`${section.key}:col-${columnIndex}`} className={styles.column}>
												<VirtualizedNoteColumn
													key={`${props.activeWorkspaceId ?? 'workspace'}:${props.viewMode}:${section.key}:col-${columnIndex}`}
													noteIds={columnIds}
													estimateSize={getEstimatedNoteHeight}
													renderItem={renderGridCard}
													onItemHeightChange={handleMeasuredCardHeight}
													gapPx={groupedGapPx}
													overscan={columnVirtualOverscan}
													enabled={true}
												/>
											</div>
										))}
									</div>
								</div>
							);
						})
						: columns.map((columnIds, columnIndex) => (
							<div key={`col-${columnIndex}`} className={styles.column}>
								<VirtualizedNoteColumn
									key={`${props.activeWorkspaceId ?? 'workspace'}:${props.viewMode}:col-${columnIndex}`}
									noteIds={columnIds}
									estimateSize={getEstimatedNoteHeight}
									renderItem={renderGridCard}
									onItemHeightChange={handleMeasuredCardHeight}
									gapPx={groupedGapPx}
									overscan={columnVirtualOverscan}
									enabled={true}
								/>
							</div>
						))}
				</div>
			</LayoutGroup>
			) : null}
			{(dragManager.dragOverlay || dragManager.dropOverlay) && activeNote && activeDoc ? (
				(() => {
					const overlayRect = dragManager.dragOverlay ?? dragManager.dropOverlay;
					if (!overlayRect) return null;
					const dragPreviewAnimate = { opacity: 0.92, scale: 1.012, y: -2 } as const;
					const dropOverlayAnimate = isDropSettling
						? (dropSettlingOverlayTarget
							? {
								left: dropSettlingOverlayTarget.left,
								top: dropSettlingOverlayTarget.top,
								width: dropSettlingOverlayTarget.width,
								height: dropSettlingOverlayTarget.height,
								opacity: 1,
								scale: 1,
								y: 0,
							}
							: { opacity: 0, scale: 1, y: 0 })
						: dragPreviewAnimate;
					const dropOverlayTransition = isDropSettling
						? (dropSettlingOverlayTarget
							? {
								type: 'spring',
								stiffness: 430,
								damping: 36,
								mass: 1,
							}
							: { duration: 0.28, ease: [0.22, 1, 0.36, 1] })
						: undefined;
					return (
				<motion.div
					className={`${styles.item} ${styles.dragPreview}`}
					style={{
						left: overlayRect.left,
						top: overlayRect.top,
						width: overlayRect.width,
						minWidth: overlayRect.width,
						maxWidth: overlayRect.width,
						height: overlayRect.height,
					}}
					initial={false}
					animate={dropOverlayAnimate}
					transition={dropOverlayTransition}
				>
					{props.viewMode === 'list' || props.viewMode === 'strip' ? (
						<div className={styles.listDragGhost} style={getNoteColorVars(activeNote.id, activeDoc, props.themeId)}>
							<div className={styles.listDragGhostMain}>
								<span className={styles.listDragGhostType}>
									<FontAwesomeIcon icon={activeIsChecklist ? faListCheck : faFileLines} />
								</span>
								<span className={styles.listDragGhostTitle}>{activeTitle}</span>
								{activeIsPinned ? (
									<span className={styles.listDragGhostBadge}>
										<FontAwesomeIcon icon={faThumbtack} />
									</span>
								) : null}
								{activeHasReminder ? (
									<span className={styles.listDragGhostBadge}>
										<FontAwesomeIcon icon={faBell} />
									</span>
								) : null}
							</div>
							{props.viewMode === 'strip' && activeStripPreview ? (
								<div className={styles.listDragGhostPreview}>{activeStripPreview}</div>
							) : null}
						</div>
					) : (
						dragPreviewMarkup ? (
							<DragPreviewMarkup markup={dragPreviewMarkup} />
						) : (
							<NoteCard
								noteId={activeNote.id}
								docId={activeDocId || undefined}
								authUserId={props.authUserId}
								themeId={props.themeId}
								doc={activeDoc}
								metaChips={renderNoteMetaChips({
									noteId: activeNote.id,
									docId: activeDocId ?? null,
									doc: activeDoc,
									sharedPlacement: sharedPlacementByAlias.get(activeNote.id) ?? null,
									collectionPathById,
									labelById,
									activeCollectionId: props.activeCollectionId,
									activeLabelIds: props.activeLabelIds,
									authUserId: props.authUserId,
									canEditNote: activeCanEdit,
									suspendAttachmentRemoteRefresh,
									disableAttachmentInitialRemoteRefresh,
									collaboratorSummary: activeCollaboratorSummary,
									snapshotShell: workspaceRenderSnapshotNoteById.get(activeNote.id) ?? null,
									onOpenAttachmentBrowser: props.onOpenAttachmentBrowser,
									onOpenMetadataChip: ({ noteId, kind, anchorRect, entries }) => {
										setOpenCollaboratorChip(null);
										setOpenMetadataChip((current) => current && current.noteId === noteId && current.kind === kind ? null : { noteId, kind, anchorRect, entries });
									},
									onAttachmentChipOpenStateChange: (chipNoteId, isOpen) => {
										setOpenAttachmentChipNoteId((current) => {
											if (isOpen) return chipNoteId;
											return current === chipNoteId ? null : current;
										});
									},
									t,
									themeId: props.themeId,
									title: activeDoc.getText('title').toString(),
								})}
								canEdit={activeCanEdit}
								hasPendingSync={activeHasPendingSync}
								maxCardHeightPx={props.maxCardHeightPx}
							/>
						)
					)}
				</motion.div>
					);
				})()
			) : null}
			{typeof document !== 'undefined'
				? createPortal(
					<AnimatePresence>
						{openCollaboratorChip && collaboratorOverlaySummary && collaboratorOverlayPosition ? (
							(() => {
								const shouldCapCollaboratorList = collaboratorOverlaySummary.collaborators.length > MAX_VISIBLE_COLLABORATORS;
								return (
									<>
										<motion.div
											className={styles.overlayBackdrop}
											aria-hidden="true"
											initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
											animate={{ opacity: 1, backdropFilter: 'blur(2px)' }}
											exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
											transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
										/>
										<ChipOverlayDismissSurface>
								<motion.div
									ref={collaboratorOverlayPanelRef}
									className={styles.collaboratorOverlayPanel}
										data-note-chip-panel="true"
									style={{
										...(collaboratorOverlayColorStyle ?? {}),
										...collaboratorOverlayPosition,
									}}
									onPointerDown={(event) => event.stopPropagation()}
									onClick={(event) => event.stopPropagation()}
									onTouchStartCapture={(event) => {
										const touch = event.touches[0];
										collaboratorTouchYRef.current = touch ? touch.clientY : null;
									}}
									initial={{ opacity: 0, y: -6 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: -6 }}
									transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
								>
									<div
										ref={collaboratorOverlayListRef}
										className={`${styles.collaboratorOverlayList}${shouldCapCollaboratorList ? ` ${styles.collaboratorOverlayListScrollable}` : ''}`}
									>
										{collaboratorOverlaySummary.collaborators.map((collaborator, index) => {
											const isActive = props.activeCollaboratorFilter?.key === collaborator.key;
											const rowDelay = 0.016 + index * 0.024;
											return (
												<div
													key={collaborator.key}
													className={styles.collaboratorOverlayItemShell}
												>
													<motion.button
														type="button"
														className={`${styles.collaboratorOverlayItem}${isActive ? ` ${styles.collaboratorOverlayItemActive}` : ''}`}
															initial={{ opacity: 0, y: -10 }}
															animate={{ opacity: 1, y: 0 }}
															exit={{ opacity: 0, y: -6 }}
														transition={{
																duration: 0.15,
																ease: [0.22, 1, 0.36, 1],
																delay: rowDelay,
														}}
														onMouseDown={preventChipOverlayRowPressBubble}
														onPointerDown={preventChipOverlayRowPressBubble}
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
												</div>
											);
										})}
									</div>
									</motion.div>
								</ChipOverlayDismissSurface>
									</>
								);
							})()
						) : null}
						{openMetadataChip && metadataOverlayPosition ? (
							<>
								<motion.div
									className={styles.overlayBackdrop}
									aria-hidden="true"
									initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
									animate={{ opacity: 1, backdropFilter: 'blur(2px)' }}
									exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
									transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
								/>
								<ChipOverlayDismissSurface>
									{(() => {
										const shouldCapMetadataList = openMetadataChip.entries.length > MAX_VISIBLE_METADATA_ENTRIES;
										return (
									<motion.div
										ref={metadataOverlayPanelRef}
										className={styles.collaboratorOverlayPanel}
										data-note-chip-panel="true"
										style={{ ...(metadataOverlayColorStyle ?? {}), ...metadataOverlayPosition }}
										onPointerDown={(event) => event.stopPropagation()}
										onClick={(event) => event.stopPropagation()}
										initial={{ opacity: 0, y: -6 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: -6 }}
										transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
									>
										<div className={`${styles.collaboratorOverlayList} ${styles.metadataOverlayList}${shouldCapMetadataList ? ` ${styles.metadataOverlayListScrollable}` : ''}`}>
											{openMetadataChip.entries.map((entry, index) => (
												<motion.button
													key={entry.key}
													type="button"
													title={entry.fullLabel ?? entry.label}
													aria-label={entry.fullLabel ?? entry.label}
													initial={{ opacity: 0, y: -10 }}
													animate={{ opacity: 1, y: 0 }}
													exit={{ opacity: 0, y: -6 }}
													transition={{
														duration: 0.15,
														ease: [0.22, 1, 0.36, 1],
														delay: 0.016 + index * 0.024,
													}}
													onMouseDown={preventChipOverlayRowPressBubble}
													onPointerDown={preventChipOverlayRowPressBubble}
															onClick={() => {
														if (entry.kind === 'collection') {
															props.onSelectCollectionFilter?.(entry.id);
														} else {
															props.onToggleLabelFilter?.(entry.id);
														}
														setOpenMetadataChip(null);
															}}
															className={`${styles.collaboratorOverlayItem}${entry.active ? ` ${styles.collaboratorOverlayItemActive}` : ''}${entry.kind === 'collection' ? ` ${styles.metadataOverlayCollectionItem}` : ''}`}
												>
														{entry.kind === 'collection' ? <FontAwesomeIcon icon={faFolder} className={styles.metadataOverlayKindIcon} /> : null}
													{entry.color ? <span className={styles.metadataOverlaySwatch} style={{ backgroundColor: entry.color }} aria-hidden="true" /> : null}
															{entry.kind === 'collection' && entry.fullLabel ? (
																<span className={styles.metadataOverlayPath}>
																	{splitCollectionOverlayPath(entry.fullLabel).map((segment, segmentIndex, segments) => (
																		<span key={`${entry.key}:segment:${segmentIndex}`} className={styles.metadataOverlayPathSegment}>
																			<span className={styles.metadataOverlayPathSegmentText}>{segment}</span>
																			{segmentIndex < segments.length - 1 ? <span className={styles.metadataOverlayPathSegmentSlash}>/</span> : null}
																		</span>
																	))}
																</span>
															) : (
																<span className={styles.collaboratorOverlayName}>{entry.label}</span>
															)}
												</motion.button>
											))}
										</div>
									</motion.div>
										);
									})()}
								</ChipOverlayDismissSurface>
							</>
						) : null}
					</AnimatePresence>,
					document.body
				)
				: null}
			{moreMenuNoteId && moreMenuDoc ? (
				<NoteCardMoreMenu
					openedByLongPress={moreMenuOpenedByLongPress}
					noteType={
						String(moreMenuDoc.getMap('metadata').get('type') ?? '') === 'checklist'
							? 'checklist'
							: 'text'
					}
					showAddImage={String(moreMenuDoc.getMap('metadata').get('type') ?? '') !== 'drawing'}
					showAddDocument={String(moreMenuDoc.getMap('metadata').get('type') ?? '') !== 'drawing'}
					isPinned={noteSnapshotById.get(moreMenuNoteId)?.isPinned === true}
					anchorRect={moreMenuAnchorRect}
					isTrashView={isTrashView}
					onClose={() => { setMoreMenuNoteId(null); setMoreMenuAnchorRect(null); }}
					onTogglePin={(moreMenuCanEdit || isTrashView) ? () => {
						if (!moreMenuCanEdit) return;
						setNotePinned(moreMenuDoc, !(noteSnapshotById.get(moreMenuNoteId)?.isPinned === true));
					} : undefined}
					onCheckAll={(moreMenuCanEdit || isTrashView) ? () => {
						if (!moreMenuCanEdit) return;
						setChecklistCompletedState(moreMenuDoc, true);
					} : undefined}
					onUncheckAll={(moreMenuCanEdit || isTrashView) ? () => {
						if (!moreMenuCanEdit) return;
						setChecklistCompletedState(moreMenuDoc, false);
					} : undefined}
					onAddCollaborator={props.onAddCollaborator && (moreMenuCanEdit || isTrashView) ? () => {
						if (!moreMenuCanEdit) return;
						// The more-menu now routes share/collaboration actions through the
						// dedicated collaborator modal instead of creating ad-hoc share links.
						const noteId = moreMenuNoteId;
						setMoreMenuNoteId(null);
						setMoreMenuAnchorRect(null);
						props.onAddCollaborator?.(noteId);
					} : undefined}
					onAddImage={props.onAddImage && (moreMenuCanEdit || isTrashView) ? () => {
						if (!moreMenuCanEdit) return;
						const noteId = moreMenuNoteId;
						setMoreMenuNoteId(null);
						setMoreMenuAnchorRect(null);
						if (!moreMenuDocId || !moreMenuDoc) return;
						props.onAddImage?.(noteId, moreMenuDocId, moreMenuDoc.getText('title').toString());
					} : undefined}
					onAddDocument={props.onAddDocument && (moreMenuCanEdit || isTrashView) ? () => {
						if (!moreMenuCanEdit) return;
						const noteId = moreMenuNoteId;
						setMoreMenuNoteId(null);
						setMoreMenuAnchorRect(null);
						if (!moreMenuDocId || !moreMenuDoc) return;
						props.onAddDocument?.(noteId, moreMenuDocId, moreMenuDoc.getText('title').toString());
					} : undefined}
					onAddReminder={props.onAddReminder && (moreMenuCanEdit || isTrashView) ? () => {
						if (!moreMenuCanEdit) return;
						const noteId = moreMenuNoteId;
						if (!moreMenuDocId) return;
						const title = moreMenuDoc.getText('title').toString();
						setMoreMenuNoteId(null);
						setMoreMenuAnchorRect(null);
						props.onAddReminder?.(noteId, moreMenuDocId, title);
					} : undefined}
					onAddToCollection={props.onAddToCollection && (moreMenuCanEdit || isTrashView) ? () => {
						if (!moreMenuCanEdit) return;
						const noteId = moreMenuNoteId;
						const title = moreMenuDoc.getText('title').toString();
						setMoreMenuNoteId(null);
						setMoreMenuAnchorRect(null);
						props.onAddToCollection?.(noteId, title);
					} : undefined}
					onAddLabels={props.onAddLabels && (moreMenuCanEdit || isTrashView) ? () => {
						if (!moreMenuCanEdit) return;
						const noteId = moreMenuNoteId;
						const title = moreMenuDoc.getText('title').toString();
						setMoreMenuNoteId(null);
						setMoreMenuAnchorRect(null);
						props.onAddLabels?.(noteId, title);
					} : undefined}
					onMoveToWorkspace={props.onMoveToWorkspace && !sharedNoteIdSet.has(moreMenuNoteId) && (moreMenuCanEdit || isTrashView) ? () => {
						if (!moreMenuCanEdit) return;
						const noteId = moreMenuNoteId;
						const title = moreMenuDoc.getText('title').toString();
						setMoreMenuNoteId(null);
						setMoreMenuAnchorRect(null);
						props.onMoveToWorkspace?.(noteId, title);
					} : undefined}
					onAddUrlPreview={(moreMenuCanEdit || isTrashView) ? () => {
						if (!moreMenuCanEdit) return;
						setMoreMenuNoteId(null);
						setMoreMenuAnchorRect(null);
						if (!moreMenuDoc) return;
						const next = window.prompt(t('links.prompt'), 'https://');
						if (!next) return;
						const added = addNotePreviewLinkToDoc(moreMenuDoc, next);
						if (!added || !moreMenuDocId) return;
						void syncNoteLinksForDoc({
							userId: props.authUserId,
							docId: moreMenuDocId,
							links: extractNoteLinksFromDoc(moreMenuDoc),
						});
					} : undefined}
					onTrash={sharedNoteIdSet.has(moreMenuNoteId) ? undefined : () => {
						// Shared aliases are projections of another workspace's document, so the
						// receiver can remove access but cannot locally trash the source note.
						const noteId = moreMenuNoteId;
						setMoreMenuNoteId(null);
						setMoreMenuAnchorRect(null);
						if (isTrashView) {
							void manager.restoreNote(noteId);
							return;
						}
						void manager.trashNote(noteId);
					}}
				/>
			) : null}
			{process.env.NODE_ENV !== 'production' ? (
				<NoteGridDebugOverlay columns={columns} noteHeightByIdRef={noteHeightByIdRef} />
			) : null}
		</section>
	);
}
