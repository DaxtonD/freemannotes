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
import { readNoteColorToken, resolveThemeNoteColorModel } from '../../core/noteColors';
import { getUserNoteColorToken } from '../../core/noteColorPreferences';
import { useDocumentManager } from '../../core/DocumentManagerContext';
import { runNoteGuards } from '../../core/devGuards';
import { useI18n } from '../../core/i18n';
import { syncNoteLinksForDoc } from '../../core/noteLinkStore';
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
import { readNoteFromDoc, setNotePinned } from '../../core/noteModel';
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
	flattenColumns,
	getGridLayoutForViewport,
	MOBILE_GRID_EDGE_MARGIN_PX,
	mergeVisibleIdsIntoLayoutOrder,
	mergeVisibleOrderIntoFullOrder,
	readCssPxVariable,
	splitIntoColumnsBySlotLengths,
	splitIntoColumnsByHeight,
} from './layout';
import { useNoteGridDragManager } from './useNoteGridDragManager';
import { loadNoteHeightCache, saveNoteHeightCache } from '../../core/noteHeightCache';
import { ElectricFenceShimmer } from './ElectricFenceShimmer';
import styles from './NoteGrid.module.css';

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
	/** Enable framer-motion layout animations. Keep false during initially cold loads. */
	enableLayoutAnimations?: boolean;
	/** Device ID for persisting measured card heights across page loads. */
	deviceId?: string;
	/** Active view mode. 'list' and 'strip' replace the masonry grid with flat rows. */
	viewMode?: ViewMode;
	/** True only when the grid is actually visible in layout, not kept mounted under display:none. */
	isVisible?: boolean;
	/** Note ID to suppress from the display — used while a new note is being drafted. */
	hiddenNoteId?: string | null;
	/**
	 * When true, allDocsLoaded initialises as true so no skeleton shimmer is shown
	 * on mount. Use this for workspace switches where data is expected from IDB
	 * almost immediately and a full shimmer overlay would feel like a regression.
	 * Safe to pass on every switch after the first full load of a workspace.
	 */
	suppressShimmer?: boolean;
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

type NoteGridSection = {
	key: string;
	label: string;
	noteIds: string[];
};

const MAX_VISIBLE_COLLABORATORS = 6;
const MAX_VISIBLE_METADATA_ENTRIES = 6;

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

function rebalanceColumnsConstrained(args: {
	columns: readonly string[][];
	draggedId: string;
	heightOf: (id: string) => number;
	gapPx: number;
	fallbackHeightPx: number;
	maxMoves?: number;
}): string[][] {
	const maxMoves = Math.max(0, args.maxMoves ?? 2);
	const minSpreadPx = Math.max(48, Math.round(args.fallbackHeightPx * 0.45));
	let current = args.columns.map((col) => col.slice());

	for (let moveCount = 0; moveCount < maxMoves; moveCount++) {
		// Only consider adjacent-column moves. That trims obvious whitespace gaps after
		// a drop without reintroducing the broad reshuffles the user wanted removed.
		const currentHeights = computeColumnHeights(current, args.heightOf, args.gapPx);
		const currentSpread = getHeightSpread(currentHeights);
		if (currentSpread <= minSpreadPx) break;

		let bestCandidate: {
			columns: string[][];
			spread: number;
			pairImprovement: number;
		} | null = null;

		for (let columnIndex = 0; columnIndex < current.length - 1; columnIndex++) {
			const leftHeight = currentHeights[columnIndex] ?? 0;
			const rightHeight = currentHeights[columnIndex + 1] ?? 0;
			const pairGap = Math.abs(leftHeight - rightHeight);
			if (pairGap <= minSpreadPx) continue;

			const fromIndex = leftHeight > rightHeight ? columnIndex : columnIndex + 1;
			const toIndex = fromIndex === columnIndex ? columnIndex + 1 : columnIndex;
			const sourceColumn = current[fromIndex] ?? [];
			if (sourceColumn.length <= 1) continue;

			let moveIndex = sourceColumn.length - 1;
			while (moveIndex >= 0 && sourceColumn[moveIndex] === args.draggedId) {
				moveIndex--;
			}
			if (moveIndex < 0) continue;

			const nextColumns = current.map((col) => col.slice());
			const [movedId] = nextColumns[fromIndex].splice(moveIndex, 1);
			nextColumns[toIndex].push(movedId);

			const nextHeights = computeColumnHeights(nextColumns, args.heightOf, args.gapPx);
			const nextSpread = getHeightSpread(nextHeights);
			const nextPairGap = Math.abs((nextHeights[columnIndex] ?? 0) - (nextHeights[columnIndex + 1] ?? 0));
			const pairImprovement = pairGap - nextPairGap;

			if (pairImprovement <= 0) continue;
			if (nextSpread >= currentSpread) continue;

			if (
				!bestCandidate ||
				nextSpread < bestCandidate.spread ||
				(nextSpread === bestCandidate.spread && pairImprovement > bestCandidate.pairImprovement)
			) {
				bestCandidate = {
					columns: nextColumns,
					spread: nextSpread,
					pairImprovement,
				};
			}
		}

		if (!bestCandidate) break;
		current = bestCandidate.columns;
	}

	return current;
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
	isOverlayActiveCard?: boolean;
	layoutReady: boolean;
	/** True while any note doc is still loading — shows a solid shimmer overlay. */
	isHydrating: boolean;
	setItemElement: (id: string, node: HTMLDivElement | null) => void;
	setHandleElement: (id: string, node: HTMLDivElement | null) => void;
};

const DragPreviewMarkup = React.memo(function DragPreviewMarkup(props: { markup: string }): React.JSX.Element {
	return <div className={styles.dragPreviewMarkup} aria-hidden="true" dangerouslySetInnerHTML={{ __html: props.markup }} />;
});

/**
 * Resolves CSS custom-property overrides for a note's color scheme.
 *
 * Priority: per-user localStorage preference → legacy Yjs metadata token.
 * Using the local preference first ensures color choices are private to each
 * user and never broadcast to collaborators sharing the same note doc.
 */
function getNoteColorVars(noteId: string, doc: Y.Doc, themeId: ThemeId): React.CSSProperties | undefined {
	const token = getUserNoteColorToken(noteId) ?? readNoteColorToken(doc.getMap<any>('metadata'));
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

function renderNoteMetaChips(args: {
	noteId: string;
	docId: string | null;
	doc: Y.Doc;
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
	const collectionPath = note.collectionId ? args.collectionPathById.get(note.collectionId) ?? null : null;
	const labelItems = note.labelIds
		.map((labelId) => args.labelById.get(labelId) ?? null)
		.filter((label): label is LabelRecord => Boolean(label));
	if ((!args.collaboratorSummary || args.collaboratorSummary.count <= 0) && !args.docId && !collectionPath && labelItems.length === 0) {
		return undefined;
	}
	const chipColorStyle = getNoteColorVars(args.noteId, args.doc, args.themeId);
	const collectionChipCount = collectionPath ? '1' : null;
	const labelChipCount = `${labelItems.length}`;

	return (
		<>
			{collectionPath && note.collectionId ? (
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
								key: `collection:${note.collectionId}`,
								id: note.collectionId,
								label: formatCompactCollectionPath(collectionPath),
								fullLabel: collectionPath,
								kind: 'collection',
								active: args.activeCollectionId === note.collectionId,
								color: null,
							}],
						});
					}}
					aria-label={`Collection: ${collectionPath}`}
				>
					<FontAwesomeIcon icon={faFolder} />
					<span>{collectionChipCount}</span>
				</button>
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
			) : null}
			{args.docId ? (
				<NoteAttachmentCountChip
					docId={args.docId}
					doc={args.doc}
					authUserId={args.authUserId}
					className={styles.noteChipButton}
					colorStyle={chipColorStyle}
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
				props.isOverlayActiveCard ? styles.itemOverlayActive : '',
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
				{/* HL2 electric fence shimmer — covers the card during hydration, fades out when all docs are loaded */}
				<ElectricFenceShimmer visible={props.isHydrating} themeId={props.themeId} />
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
	const manager = useDocumentManager();
	const connection = useConnectionStatus();
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

	// all docs are loaded → shimmer fades out and layout animations can start.
	// Initialise as loaded when the caller knows IDB data will arrive quickly
	// (e.g. workspace switch back to a previously loaded workspace).
	const [allDocsLoaded, setAllDocsLoaded] = React.useState(() => props.suppressShimmer === true);
	// Prevents allDocsLoaded from reverting to false after the initial load
	// completes (e.g. when creating a new note later shouldn't re-shimmer cards).
	// When suppressShimmer is true, treat the load as already complete so the
	// tracking effect never drives allDocsLoaded back to false mid-IDB-hydration.
	const initialLoadCompleteRef = React.useRef(props.suppressShimmer === true);

	// Suppress framer-motion layout animations until all docs are loaded and two
	// paint frames have passed (so cards settle before springs can fire).
	const [layoutReady, setLayoutReady] = React.useState(false);
	const readyNotifiedRef = React.useRef(false);
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
	const noteCardLayoutRefreshRafRef = React.useRef<number>(0);

	// Seed height cache on first render from localStorage (before first pack)
	if (!heightCacheLoadedRef.current) {
		heightCacheLoadedRef.current = true;
		if (props.deviceId) {
			const cached = loadNoteHeightCache(props.deviceId);
			for (const [k, v] of cached) noteHeightByIdRef.current.set(k, v);
		}
	}
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
			if (noteCardLayoutRefreshRafRef.current) window.cancelAnimationFrame(noteCardLayoutRefreshRafRef.current);
			noteCardLayoutRefreshRafRef.current = window.requestAnimationFrame(() => {
				noteCardLayoutRefreshRafRef.current = 0;
				setNoteHeightsVersion((version) => version + 1);
			});
		};
		window.addEventListener('freemannotes:note-card-layout-change', handleNoteCardLayoutChange as EventListener);
		return () => {
			window.removeEventListener('freemannotes:note-card-layout-change', handleNoteCardLayoutChange as EventListener);
			if (noteCardLayoutRefreshRafRef.current) {
				window.cancelAnimationFrame(noteCardLayoutRefreshRafRef.current);
				noteCardLayoutRefreshRafRef.current = 0;
			}
		};
	}, []);

	React.useEffect(() => {
		docsByIdRef.current = docsById;
	}, [docsById]);

	const recalculateColumnCount = React.useCallback((): void => {
		if (typeof window === 'undefined') return;
		if (!isGridVisible) return;
		const containerWidth = sectionRef.current?.clientWidth ?? window.innerWidth;
		if (containerWidth <= 0) return;
		const next = getGridLayoutForViewport(containerWidth, window.innerWidth, window.innerHeight);
		setColumnCount((previous) => (previous === next.columnCount ? previous : next.columnCount));
		setMobileCardWidthPx((previous) => (previous === next.mobileCardWidthPx ? previous : next.mobileCardWidthPx));
		setMobileGridGapPx((previous) => (previous === next.mobileGapPx ? previous : next.mobileGapPx));
		setMobileSectionBleedPx((previous) => (previous === next.mobileSectionBleedPx ? previous : next.mobileSectionBleedPx));
	}, [isGridVisible]);

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
		if (!noteOrder) return [];
		// Local workspace order still comes from Yjs. Shared aliases are appended so
		// they render in the grid without mutating the source workspace's note order.
		return uniqueIds([...readOrderIds(noteOrder), ...sharedNoteIds]);
	}, [noteOrder, sharedNoteIds, storeVersion]);

	const noteSnapshots = React.useMemo<VisibleNoteSnapshot[]>(() => {
		return orderedIds.map((id) => {
			const doc = docsById[id];
			if (!doc) return createFallbackNoteSnapshot(id);
			const note = readNoteFromDoc(doc, id);
			const placement = (props.sharedNotes ?? []).find((entry) => entry.aliasId === id);
			const docId = placement?.roomId || resolveMediaDocId(id);
			return {
				id,
				title: note.title,
				createdAt: note.createdAt,
				updatedAt: note.updatedAt,
				collectionId: note.collectionId,
				labelIds: note.labelIds,
				reminderAt: (docId ? props.noteReminderByDocId?.[docId] : undefined) ?? props.noteReminderByDocId?.[id] ?? null,
				isPinned: note.isPinned,
				lastAccessedAt: note.lastAccessedAt,
				trashed: note.trashed,
				archived: note.archived,
			};
		});
	}, [docsById, metadataVersion, orderedIds, props.noteReminderByDocId, props.sharedNotes, resolveMediaDocId]);
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
		if (props.hiddenNoteId) return ids.filter((id) => id !== props.hiddenNoteId);
		// ^ Suppress the draft note ID from the visible list so it never renders as
		//   an empty card while the user is composing it in the editor overlay.
		return ids;
	}, [noteSnapshots, props.activeCollectionId, props.activeCollaboratorFilter, props.activeLabelIds, props.hiddenNoteId, props.reminderFilter, props.showArchived, props.showTrashed, props.sortDirection, props.sortGrouping, props.sortMode]);

	const visibleNoteEntries = React.useMemo(() => {
		const sharedPlacementByAlias = new Map((props.sharedNotes ?? []).map((placement) => [placement.aliasId, placement]));
		return baseVisibleIds
			.map((noteId) => {
				const placement = sharedPlacementByAlias.get(noteId) ?? null;
				const docId = placement?.roomId || resolveMediaDocId(noteId);
				return docId ? { noteId, docId, isSharedAlias: Boolean(placement) } : null;
			})
			.filter((entry): entry is { noteId: string; docId: string; isSharedAlias: boolean } => Boolean(entry));
	}, [baseVisibleIds, props.sharedNotes, resolveMediaDocId]);
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

	// ── Commit drag result to Yjs ─────────────────────────────────────────
	// Called by the drag manager's onDrop handler with the raw column layout
	// from the insertion point. Start from the exact preview layout, then allow
	// a tiny amount of constrained adjacent-column balancing so tall whitespace
	// gaps can tighten without triggering broad post-drop reshuffles.
	const commitVisibleOrder = React.useCallback(
		(finalColumns: string[][], draggedId: string, draggedHeight: number) => {
			if (!noteOrder) return;

			const gapPx = mobileGridGapPx ?? readCssPxVariable('--grid-gap', 16);
			const heightOf = (id: string) => {
				if (id === draggedId && draggedHeight > 0) return draggedHeight;
				return noteHeightByIdRef.current.get(id) ?? getEstimatedNoteHeight(id);
			};

			// Row-major flatten of the constrained post-drop columns → canonical order for Yjs.
			const committedColumns = rebalanceColumnsConstrained({
				columns: finalColumns,
				draggedId,
				heightOf,
				gapPx,
				fallbackHeightPx: getEstimatedNoteHeight(draggedId),
				maxMoves: 2,
			});
			const columnSlots = committedColumns.map((column) => column.length);
			const readingOrder = flattenColumns(committedColumns);
			const pinnedVisibleIds = new Set(
				visibleIds.filter((id) => noteSnapshotById.get(id)?.isPinned === true)
			);
			const constrainedReadingOrder = [
				...readingOrder.filter((id) => pinnedVisibleIds.has(id)),
				...readingOrder.filter((id) => !pinnedVisibleIds.has(id)),
			];
			pendingCommittedVisibleOrderRef.current = constrainedReadingOrder.slice();
			setLayoutOrderIds((previous) => (arraysEqual(previous, constrainedReadingOrder) ? previous : constrainedReadingOrder));
			// Preserve the committed drag result as stickyColumns so the local
			// device sees the exact column layout from the drag.  Other
			// devices re-pack from the Yjs canonical order with their own
			// card heights.  When a remote update arrives, the flat-order
			// comparison in baseColumns invalidates stale stickyColumns.
			setStickyColumns(committedColumns);

			if (noteLayout) {
				const currentSlots = readColumnSlots(noteLayout, columnSlots.length, readingOrder.length) ?? [];
				if (!arraysEqualNumbers(currentSlots, columnSlots)) {
					const layoutDoc = (noteLayout as Y.Map<unknown> & { doc?: Y.Doc | null }).doc ?? null;
					const applyLayout = (): void => {
						noteLayout.set('columnSlots', columnSlots.slice());
					};
					if (layoutDoc) layoutDoc.transact(applyLayout);
					else applyLayout();
				}
			}

			const current = readOrderIds(noteOrder);
			const next = mergeVisibleOrderIntoFullOrder(current, visibleIds, constrainedReadingOrder);
			if (arraysEqual(current, next)) return;
			const ydoc = (noteOrder as YArrayWithDoc<string>).doc;
			ydoc.transact(() => {
				noteOrder.delete(0, noteOrder.length);
				noteOrder.insert(0, next);
			});
		},
		[getEstimatedNoteHeight, noteLayout, noteOrder, noteSnapshotById, visibleIds, mobileGridGapPx]
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
		if (!noteOrder) return;
		if (orderedIds.length > 0 && orderedIds.some((id) => !docsById[id])) {
			// Notes are present but their docs haven't arrived yet.
			// Reset to hydrating only during the initial boot phase so that
			// the shimmer shows on first login (not just on page refresh).
			if (!initialLoadCompleteRef.current) {
				setAllDocsLoaded(false);
			}
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
	}, [noteOrder, orderedIds, docsById, allDocsLoaded]);

	React.useEffect(() => {
		if (!allDocsLoaded) {
			readyNotifiedRef.current = false;
			return;
		}
		if (props.enableLayoutAnimations && !layoutReady) return;
		if (readyNotifiedRef.current) return;
		readyNotifiedRef.current = true;
		props.onReady?.();
	}, [allDocsLoaded, layoutReady, props.enableLayoutAnimations, props.onReady]);

	const renderedIds = layoutOrderIds.length > 0 ? layoutOrderIds : visibleIds;
	const groupedSections = React.useMemo<NoteGridSection[]>(() => {
		return buildNoteGroupSections({
			renderedIds,
			noteSnapshotById,
			sortGrouping: props.sortGrouping,
			sortMode: props.sortMode,
		});
	}, [noteSnapshotById, props.sortGrouping, props.sortMode, renderedIds]);
	const persistedColumnSlots = React.useMemo(
		() => readColumnSlots(noteLayout, columnCount, renderedIds.length),
		[noteLayout, columnCount, renderedIds.length, storeVersion]
	);
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
	// After a drag, the balanced result is preserved as stickyColumns so
	// the dragging device sees an instant result; other devices re-pack
	// from the updated Yjs order using their own heights.
	const packedColumns = React.useMemo(() => {
		void noteHeightsVersion;
		const gapPx = mobileGridGapPx ?? readCssPxVariable('--grid-gap', 16);
		const fallbackH = Math.min(props.maxCardHeightPx, 220);
		return splitIntoColumnsByHeight(renderedIds, columnCount, packedHeightLookup, gapPx, fallbackH);
	}, [renderedIds, columnCount, noteHeightsVersion, mobileGridGapPx, packedHeightLookup, props.maxCardHeightPx]);
	const slottedColumns = React.useMemo(() => {
		if (!persistedColumnSlots) return null;
		return splitIntoColumnsBySlotLengths(renderedIds, persistedColumnSlots);
	}, [persistedColumnSlots, renderedIds]);

	// ── Reconcile stickyColumns with current card IDs ─────────────────────
	// stickyColumns preserves the column layout from the last drag so cards
	// don't shuffle on re-render.  Cleared when column count changes, IDs
	// change, or ORDER changes (remote Yjs update), falling back to
	// height-based packing unless persisted slot lengths are available.
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
	const resolvedBaseColumns = React.useMemo(() => {
		if (stickyColumns && baseColumns === stickyColumns) return baseColumns;
		if (slottedColumns && slottedColumns.length === columnCount) return slottedColumns;
		return baseColumns;
	}, [stickyColumns, baseColumns, slottedColumns, columnCount]);
	const isListLikeView = props.viewMode === 'list' || props.viewMode === 'strip';
	const dragColumns = React.useMemo(() => (isListLikeView ? [visibleIds] : resolvedBaseColumns), [isListLikeView, resolvedBaseColumns, visibleIds]);

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
		if (isGridVisible) return;
		if (isListLikeView) return;
		if (dragManager.activeDragId) return;
		if (resolvedBaseColumns.length !== columnCount) return;
		// When the card grid is hidden behind bubble/images views, keep the last
		// resolved masonry columns sticky so hidden measurement passes cannot
		// reshuffle the visible packing order.
		const frozenColumns = resolvedBaseColumns.map((column) => column.slice());
		setStickyColumns((previous) => {
			if (previous && previous.length === frozenColumns.length) {
				const previousFlat = flattenColumns(previous);
				const nextFlat = flattenColumns(frozenColumns);
				if (arraysEqual(previousFlat, nextFlat)) return previous;
			}
			return frozenColumns;
		});
	}, [columnCount, dragManager.activeDragId, isGridVisible, isListLikeView, resolvedBaseColumns]);

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

	// Measure card heights for masonry packing (runs after render)
	React.useLayoutEffect(() => {
		if (!isGridVisible) return;
		if (isListLikeView) return;
		// Only card view contributes masonry heights. List/strip rows have a
		// different layout model and would poison the cached packing heights.
		const grid = gridRef.current;
		if (!grid) return;
		const documentRects = measureDocumentRects(grid);
		if (documentRects.size === 0) return;
		let heightsChanged = false;
		for (const [id, rect] of documentRects) {
			const nextHeight = Math.max(0, Math.round(rect.height));
			if (nextHeight <= 0) continue;
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
			// Debounced persist: write heights 2 s after the last measurement change
			if (props.deviceId) {
				if (heightSaveTimerRef.current) window.clearTimeout(heightSaveTimerRef.current);
				heightSaveTimerRef.current = window.setTimeout(() => {
					heightSaveTimerRef.current = 0;
					saveNoteHeightCache(props.deviceId!, noteHeightByIdRef.current);
				}, 2000);
			}
		}
		return () => {
			if (noteHeightBumpRafRef.current && typeof window !== 'undefined') {
				window.cancelAnimationFrame(noteHeightBumpRafRef.current);
				noteHeightBumpRafRef.current = 0;
			}
		};
	}, [columns, docsById, dragManager.activeDragId, isGridVisible, isListLikeView]);

	const activeDoc = dragManager.activeDragId ? docsById[dragManager.activeDragId] : undefined;
	const activeNote = dragManager.activeDragId ? noteById.get(dragManager.activeDragId) : undefined;
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
		if (!dragManager.activeDragId || isListLikeView) {
			setDragPreviewMarkup('');
			return;
		}
		const itemElement = dragManager.getItemElement(dragManager.activeDragId);
		const contentElement = itemElement?.querySelector<HTMLElement>('[data-note-content="true"]') ?? null;
		setDragPreviewMarkup(contentElement?.innerHTML ?? '');
	}, [dragManager, dragManager.activeDragId, isListLikeView]);
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
	const disableAttachmentInitialRemoteRefresh = true;
	const collaboratorOverlayPosition = React.useMemo(() => {
		if (!openCollaboratorChip || typeof window === 'undefined') return null;
		// Match the masonry grid edge clamp on coarse pointers so left-column cards
		// open centered chip overlays instead of drifting to the right.
		const horizontalViewportInset = isCoarsePointer ? MOBILE_GRID_EDGE_MARGIN_PX : 12;
		const overlayWidth = Math.min(
			Math.round(openCollaboratorChip.anchorRect.width),
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
	const renderGridCard = React.useCallback((noteId: string): React.ReactNode => {
		const note = noteById.get(noteId);
		if (!note) return null;
		const doc = docsById[note.id];
		if (!doc) {
			// Render a skeleton card at the cached height so masonry packing is stable
			// and no layout repack occurs when the doc loads.
			const skeletonH = noteHeightByIdRef.current.get(note.id) ?? getEstimatedNoteHeight(note.id);
			return (
				<div key={note.id} className={styles.item} data-note-id={note.id} style={{ height: skeletonH }}>
					<div className={styles.skeletonCard} style={{ height: skeletonH }} />
					{/* Electric fence shimmer on skeleton cards — always visible until the doc loads */}
					<ElectricFenceShimmer visible={true} themeId={props.themeId} />
				</div>
			);
		}
		const isPlaceholder = dragManager.activeDragId === note.id;
		const collaboratorSummary = collaboratorSummariesByNoteId[note.id];
		const placement = (props.sharedNotes ?? []).find((entry) => entry.aliasId === note.id);
		const docId = placement?.roomId || resolveMediaDocId(note.id);
		const reminderAt = (docId ? props.noteReminderByDocId?.[docId] : undefined) ?? props.noteReminderByDocId?.[note.id] ?? null;
		const canEditNote = !isTrashView && (note.isShared ? placement?.role === 'EDITOR' : props.canEditWorkspaceContent !== false);
		const title = doc.getText('title').toString();
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
					collectionPathById,
					labelById,
					activeCollectionId: props.activeCollectionId,
					activeLabelIds: props.activeLabelIds,
					authUserId: props.authUserId,
					canEditNote,
					suspendAttachmentRemoteRefresh,
					disableAttachmentInitialRemoteRefresh,
					forceCloseAttachmentChip: Boolean(openCollaboratorChip || openMetadataChip || (openAttachmentChipNoteId !== null && openAttachmentChipNoteId !== note.id)),
					collaboratorSummary,
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
				canEdit={canEditNote}
				hasPendingSync={pendingSyncNoteIds.has(note.id)}
				selected={props.selectedNoteId === note.id}
				isMoreMenuOpen={moreMenuNoteId === note.id}
				isTrashView={isTrashView}
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
				allowCompletedItemInteractions={props.noteCardCompletedInteractions !== false}
				suppressContentInteractions={isChipInteractionGuardActive}
				onAddReminder={props.onAddReminder && canEditNote ? () => props.onAddReminder?.(note.id, docId, doc.getText('title').toString()) : undefined}
				onRestoreNote={isTrashView ? () => { void manager.restoreNote(note.id); } : undefined}
				onAddCollaborator={props.onAddCollaborator && canEditNote ? () => props.onAddCollaborator?.(note.id, doc.getText('title').toString()) : undefined}
				onAddImage={props.onAddImage && canEditNote ? () => {
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
				layoutReady={layoutReady}
				isHydrating={!allDocsLoaded}
				setItemElement={dragManager.setItemElement}
				setHandleElement={!isTrashView && !note.isShared ? dragManager.setHandleElement : () => {}}
			/>
		);
	}, [allDocsLoaded, collaboratorSummariesByNoteId, collectionPathById, disableAttachmentInitialRemoteRefresh, docsById, dragManager.activeDragId, dragManager.setHandleElement, dragManager.setItemElement, getEstimatedNoteHeight, gridRef, isChipInteractionGuardActive, isTrashView, labelById, layoutReady, manager, moreMenuNoteId, noteById, noteHeightByIdRef, openAttachmentChipNoteId, openCollaboratorChip, openMetadataChip, overlayActiveNoteId, pendingSyncNoteIds, props.activeCollectionId, props.activeLabelIds, props.authUserId, props.canEditWorkspaceContent, props.maxCardHeightPx, props.noteCardCheckboxInteractions, props.noteCardCompletedInteractions, props.noteCardLinkInteractions, props.noteReminderByDocId, props.onAddCollaborator, props.onAddImage, props.onAddReminder, props.onOpenAttachmentBrowser, props.onSelectNote, props.selectedNoteId, props.sharedNotes, props.themeId, resolveMediaDocId, suspendAttachmentRemoteRefresh, t]);
	const isGroupedView = groupedSections.length > 0;
	const groupedGapPx = mobileGridGapPx ?? readCssPxVariable('--grid-gap', 16);
	const groupedFallbackHeightPx = Math.min(props.maxCardHeightPx, 220);

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
												{columnIds.map((noteId) => renderGridCard(noteId))}
											</div>
										))}
									</div>
								</div>
							);
						})
						: columns.map((columnIds, columnIndex) => (
							<div key={`col-${columnIndex}`} className={styles.column}>
								{columnIds.map((noteId) => renderGridCard(noteId))}
							</div>
						))}
				</div>
			</LayoutGroup>
			) : null}
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
									collectionPathById,
									labelById,
									activeCollectionId: props.activeCollectionId,
									activeLabelIds: props.activeLabelIds,
									authUserId: props.authUserId,
									canEditNote: activeCanEdit,
									suspendAttachmentRemoteRefresh,
									disableAttachmentInitialRemoteRefresh,
									collaboratorSummary: activeCollaboratorSummary,
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
				</div>
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
													className={`${styles.collaboratorOverlayItem}${entry.active ? ` ${styles.collaboratorOverlayItemActive}` : ''}`}
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
												>
														{entry.kind === 'collection' ? <FontAwesomeIcon icon={faFolder} className={styles.metadataOverlayKindIcon} /> : null}
													{entry.color ? <span className={styles.metadataOverlaySwatch} style={{ backgroundColor: entry.color }} aria-hidden="true" /> : null}
													<span className={styles.collaboratorOverlayName}>{entry.label}</span>
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
		</section>
	);
}
