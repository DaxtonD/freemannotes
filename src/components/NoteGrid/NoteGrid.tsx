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
import { buildCollectionPathMap, type CollectionRecord } from '../../services/collectionService';
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
import { getVisibleNotes, type NoteGroupingMode, type NoteSortMode, type ReminderFilterMode, type SortDirection, type VisibleNoteSnapshot } from '../../utilities/getVisibleNotes';
import { buildNoteGroupSections } from '../../utilities/noteGrouping';
import { measureDocumentRects } from './flip';
import {
	arraysEqual,
	flattenColumns,
	getGridLayoutForViewport,
	mergeVisibleIdsIntoLayoutOrder,
	mergeVisibleOrderIntoFullOrder,
	readCssPxVariable,
	splitIntoColumnsBySlotLengths,
	splitIntoColumnsByHeight,
} from './layout';
import { useNoteGridDragManager } from './useNoteGridDragManager';
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
	sortMode?: NoteSortMode;
	sortDirection?: SortDirection;
	sortGrouping?: NoteGroupingMode;
	refreshCollaboratorsToken?: number;
	canEditWorkspaceContent?: boolean;
	canReorder?: boolean;
	noteCardClickOpens?: boolean;
	onAddReminder?: (noteId: string, title?: string) => void;
	onAddToCollection?: (noteId: string, title?: string) => void;
	onAddLabels?: (noteId: string, title?: string) => void;
	onSelectCollectionFilter?: (collectionId: string) => void;
	onToggleLabelFilter?: (labelId: string) => void;
	maxCardHeightPx: number;
	showTrashed?: boolean;
	showArchived?: boolean;
	emptyStateLabel?: string;
	sharedNotes?: readonly SharedNotePlacement[];
	onReady?: () => void;
	/** Enable framer-motion layout animations. Keep false during splash reveal. */
	enableLayoutAnimations?: boolean;
	/** Active view mode. 'list' and 'strip' replace the masonry grid with flat rows. */
	viewMode?: ViewMode;
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

function suppressNextDocumentCompatibilityMouseEvents(): void {
	if (typeof window === 'undefined') return;
	let timeoutId = 0;
	const handler = (event: MouseEvent): void => {
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
	};
	const cleanup = (): void => {
		window.removeEventListener('mousedown', handler, true);
		window.removeEventListener('mouseup', handler, true);
		window.removeEventListener('click', handler, true);
		if (timeoutId) window.clearTimeout(timeoutId);
	};
	window.addEventListener('mousedown', handler, true);
	window.addEventListener('mouseup', handler, true);
	window.addEventListener('click', handler, true);
	timeoutId = window.setTimeout(() => cleanup(), 500);
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
	onRestoreNote?: () => void;
	onAddCollaborator?: () => void;
	onAddImage?: () => void;
	onMoreMenu: (anchorRect?: { top: number; left: number; width: number; height: number } | null) => void;
	canEdit: boolean;
	allowCardItemInteractions?: boolean;
	isTrashView?: boolean;
	maxCardHeightPx: number;
	isPlaceholder: boolean;
	isOverlayActiveCard?: boolean;
	layoutReady: boolean;
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
					style={chipColorStyle}
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation();
						const rect = event.currentTarget.getBoundingClientRect();
						args.onOpenMetadataChip?.({
							noteId: args.noteId,
							kind: 'collection',
							anchorRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
							entries: [{
								key: `collection:${note.collectionId}`,
								id: note.collectionId,
								label: collectionPath,
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
					style={chipColorStyle}
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation();
						const rect = event.currentTarget.getBoundingClientRect();
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
					style={chipColorStyle}
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation();
						const rect = event.currentTarget.getBoundingClientRect();
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
				<NoteCard
					noteId={props.note.id}
					docId={props.docId || undefined}
					authUserId={props.authUserId}
					themeId={props.themeId}
					doc={props.doc}
					metaChips={props.metaChips}
					canEdit={props.canEdit}
					isPinned={props.note.isPinned}
					hasPendingSync={props.hasPendingSync}
					isMoreMenuOpen={props.isMoreMenuOpen}
					maxCardHeightPx={props.maxCardHeightPx}
					onOpen={props.onOpen}
					onAddReminder={props.onAddReminder}
					onRestoreNote={props.onRestoreNote}
					onAddCollaborator={props.onAddCollaborator}
					onAddImage={props.onAddImage}
					onMoreMenu={props.onMoreMenu}
					allowCardItemInteractions={props.allowCardItemInteractions}
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

function preventChipOverlayFocusSteal(event: React.SyntheticEvent): void {
	if (event.cancelable) event.preventDefault();
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
	const collaboratorOverlayListRef = React.useRef<HTMLDivElement | null>(null);
	const collaboratorTouchYRef = React.useRef<number | null>(null);
	const collaboratorBackStatePushedRef = React.useRef(false);
	const overlayReleaseTimerRef = React.useRef<number>(0);

	const [notesList, setNotesList] = React.useState<Y.Array<Y.Map<unknown>> | null>(null);
	const [noteOrder, setNoteOrder] = React.useState<Y.Array<string> | null>(null);
	const [noteLayout, setNoteLayout] = React.useState<Y.Map<unknown> | null>(null);

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
	const isTrashView = Boolean(props.showTrashed);

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
			return {
				id,
				title: note.title,
				createdAt: note.createdAt,
				updatedAt: note.updatedAt,
				collectionId: note.collectionId,
				labelIds: note.labelIds,
				reminderAt: note.reminderAt,
				isPinned: note.isPinned,
				lastAccessedAt: note.lastAccessedAt,
				trashed: note.trashed,
				archived: note.archived,
			};
		});
	}, [docsById, metadataVersion, orderedIds]);
	const noteSnapshotById = React.useMemo(() => new Map(noteSnapshots.map((note) => [note.id, note] as const)), [noteSnapshots]);

	const baseVisibleIds = React.useMemo<string[]>(() => {
		return getVisibleNotes(noteSnapshots, {
			showTrashed: props.showTrashed,
			showArchived: props.showArchived,
			selectedCollectionId: props.activeCollectionId,
			selectedLabelIds: props.activeLabelIds,
			reminderFilter: props.reminderFilter,
			sortMode: props.sortMode,
			sortDirection: props.sortDirection,
		}).map((note) => note.id);
	}, [noteSnapshots, props.activeCollectionId, props.activeLabelIds, props.reminderFilter, props.showArchived, props.showTrashed, props.sortDirection, props.sortMode]);

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
					summary: snapshotToCollaboratorSummary(entry.docId, await readCachedNoteShareCollaborators(props.authUserId || '', entry.docId)),
				}))
			);
			applySummaries(cached);

			if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

			// Refresh visible notes in small batches so collaborator chips converge to
			// server state without stalling the rest of the grid on large workspaces.
			// Brand-new local notes can still be missing from the server document table,
			// which produces 403s if we probe them immediately. Once a local note is
			// synced, though, a fresh device still needs one server read to discover any
			// collaborators because there is no local collaborator cache yet.
			const cachedSummaryByNoteId = new Map(cached.map((row) => [row.noteId, row.summary] as const));
			const entriesToRefresh = visibleNoteEntriesForCollaboratorSync.filter(
				(entry) => entry.isSharedAlias || Boolean(cachedSummaryByNoteId.get(entry.noteId)) || !pendingSyncNoteIds.has(entry.noteId)
			);
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
	}, [pendingSyncNoteIds, props.authUserId, props.refreshCollaboratorsToken, visibleNoteEntriesForCollaboratorSyncSignature]);

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
			const fallbackH = Math.min(props.maxCardHeightPx, 220);
			const heightOf = (id: string) => {
				if (id === draggedId && draggedHeight > 0) return draggedHeight;
				return noteHeightByIdRef.current.get(id) ?? fallbackH;
			};

			// Row-major flatten of the constrained post-drop columns → canonical order for Yjs.
			const committedColumns = rebalanceColumnsConstrained({
				columns: finalColumns,
				draggedId,
				heightOf,
				gapPx,
				fallbackHeightPx: fallbackH,
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
		[noteLayout, noteOrder, noteSnapshotById, visibleIds, mobileGridGapPx, props.maxCardHeightPx]
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
		return splitIntoColumnsByHeight(renderedIds, columnCount, noteHeightByIdRef.current, gapPx, fallbackH);
	}, [renderedIds, columnCount, noteHeightsVersion, mobileGridGapPx, props.maxCardHeightPx]);
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
	});

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
		const overlayWidth = Math.min(230, Math.max(170, Math.round(openCollaboratorChip.anchorRect.width + 34)));
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const left = Math.min(Math.max(12, openCollaboratorChip.anchorRect.left), Math.max(12, viewportWidth - overlayWidth - 12));
		const visibleRows = Math.min(MAX_VISIBLE_COLLABORATORS, collaboratorOverlaySummary?.count ?? 1);
		const estimatedHeight = Math.min(240, Math.max(84, visibleRows * 44 + 16));
		const preferredTop = openCollaboratorChip.anchorRect.top + openCollaboratorChip.anchorRect.height + 10;
		const top = preferredTop + estimatedHeight <= viewportHeight - 12
			? preferredTop
			: Math.max(12, openCollaboratorChip.anchorRect.top - estimatedHeight - 10);
		return { top, left, width: overlayWidth };
	}, [collaboratorOverlaySummary?.count, openCollaboratorChip]);
	const metadataOverlayPosition = React.useMemo(() => {
		if (!openMetadataChip || typeof window === 'undefined') return null;
		// Anchor the metadata overlay near the chip button, but flip above the card when
		// there is not enough room below in shorter mobile viewports.
		const overlayWidth = Math.min(280, Math.max(190, Math.round(openMetadataChip.anchorRect.width + 80)));
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const left = Math.min(Math.max(12, openMetadataChip.anchorRect.left), Math.max(12, viewportWidth - overlayWidth - 12));
		const estimatedHeight = Math.min(260, Math.max(84, openMetadataChip.entries.length * 38 + 18));
		const preferredTop = openMetadataChip.anchorRect.top + openMetadataChip.anchorRect.height + 10;
		const top = preferredTop + estimatedHeight <= viewportHeight - 12
			? preferredTop
			: Math.max(12, openMetadataChip.anchorRect.top - estimatedHeight - 10);
		return { top, left, width: overlayWidth };
	}, [openMetadataChip]);
	const renderGridCard = React.useCallback((noteId: string): React.ReactNode => {
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
		const placement = (props.sharedNotes ?? []).find((entry) => entry.aliasId === note.id);
		const docId = placement?.roomId || resolveMediaDocId(note.id);
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
					collaboratorSummary,
					onOpenAttachmentBrowser: props.onOpenAttachmentBrowser,
					onToggleCollaboratorChip: (chipNoteId, anchorRect) => {
						setOpenMetadataChip(null);
						setOpenCollaboratorChip((current) => current?.noteId === chipNoteId ? null : { noteId: chipNoteId, anchorRect });
					},
					onOpenMetadataChip: ({ noteId: chipNoteId, kind, anchorRect, entries }) => {
						setOpenCollaboratorChip(null);
						setOpenMetadataChip((current) => current && current.noteId === chipNoteId && current.kind === kind ? null : { noteId: chipNoteId, kind, anchorRect, entries });
					},
					onAttachmentChipOpenStateChange: (chipNoteId, isOpen) => {
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
					if (dragManager.shouldSuppressOpen()) return;
					props.onSelectNote(note.id);
				} : undefined}
				allowCardItemInteractions={props.noteCardClickOpens !== false}
				onAddReminder={props.onAddReminder && canEditNote ? () => props.onAddReminder?.(note.id, doc.getText('title').toString()) : undefined}
				onRestoreNote={isTrashView ? () => { void manager.restoreNote(note.id); } : undefined}
				onAddCollaborator={props.onAddCollaborator && canEditNote ? () => props.onAddCollaborator?.(note.id, doc.getText('title').toString()) : undefined}
				onAddImage={props.onAddImage && canEditNote ? () => {
					if (!docId) return;
					props.onAddImage?.(note.id, docId, doc.getText('title').toString());
				} : undefined}
				onMoreMenu={(anchorRect) => {
					const cardEl = gridRef.current?.querySelector(`[data-note-id="${note.id}"]`);
					setMoreMenuAnchorRect(anchorRect ?? (cardEl ? cardEl.getBoundingClientRect().toJSON() : null));
					setMoreMenuNoteId(note.id);
				}}
				maxCardHeightPx={props.maxCardHeightPx}
				isPlaceholder={isPlaceholder}
				isOverlayActiveCard={overlayActiveNoteId === note.id}
				layoutReady={layoutReady}
				setItemElement={dragManager.setItemElement}
				setHandleElement={!isTrashView && !note.isShared ? dragManager.setHandleElement : () => {}}
			/>
		);
	}, [collaboratorSummariesByNoteId, collectionPathById, disableAttachmentInitialRemoteRefresh, docsById, dragManager.activeDragId, dragManager.setHandleElement, dragManager.setItemElement, gridRef, isTrashView, labelById, layoutReady, manager, moreMenuNoteId, noteById, overlayActiveNoteId, pendingSyncNoteIds, props.activeCollectionId, props.activeLabelIds, props.authUserId, props.canEditWorkspaceContent, props.maxCardHeightPx, props.noteCardClickOpens, props.onAddCollaborator, props.onAddImage, props.onAddReminder, props.onOpenAttachmentBrowser, props.onSelectNote, props.selectedNoteId, props.sharedNotes, props.themeId, resolveMediaDocId, suspendAttachmentRemoteRefresh, t]);
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
				<div ref={gridRef} className={styles.listGrid} aria-label={t('grid.notesGrid')}>
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
							shouldSuppressOpen={dragManager.shouldSuppressOpen}
							canOpenNotes={!isTrashView}
							canDrag={(noteId) => {
								const note = noteById.get(noteId);
								if (!note) return false;
								return !isTrashView && !note.isShared && props.canReorder !== false;
							}}
							onSelectNote={props.onSelectNote}
							onMoreMenu={(noteId, rect) => {
								setMoreMenuAnchorRect(rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null);
								setMoreMenuNoteId(noteId);
							}}
						/>
					</div>
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
							const sectionColumns = splitIntoColumnsByHeight(section.noteIds, columnCount, noteHeightByIdRef.current, groupedGapPx, groupedFallbackHeightPx);
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
											transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
										/>
										<div
											className={styles.collaboratorOverlayRoot}
								onPointerDown={(event) => {
									if (event.cancelable) event.preventDefault();
									event.stopPropagation();
									if (isCoarsePointer) {
										suppressNextDocumentCompatibilityMouseEvents();
									}
									setOpenCollaboratorChip(null);
								}}
								onClick={(event) => {
									event.preventDefault();
									event.stopPropagation();
								}}
										>
								<motion.div
									ref={collaboratorOverlayPanelRef}
									className={styles.collaboratorOverlayPanel}
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
									initial={{ opacity: 0, y: -8, scale: 0.985 }}
									animate={{ opacity: 1, y: 0, scale: 1 }}
									exit={{ opacity: 0, y: -8, scale: 0.98 }}
									transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
								>
									<div
										ref={collaboratorOverlayListRef}
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
														onMouseDown={preventChipOverlayFocusSteal}
														onPointerDown={preventChipOverlayFocusSteal}
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
									transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
								/>
								<div
									className={styles.collaboratorOverlayRoot}
									onPointerDown={(event) => {
										if (event.cancelable) event.preventDefault();
										event.stopPropagation();
										setOpenMetadataChip(null);
									}}
									onClick={(event) => {
										event.preventDefault();
										event.stopPropagation();
									}}
								>
									<motion.div
										className={styles.collaboratorOverlayPanel}
										style={{ ...(metadataOverlayColorStyle ?? {}), ...metadataOverlayPosition }}
										onPointerDown={(event) => event.stopPropagation()}
										onClick={(event) => event.stopPropagation()}
										initial={{ opacity: 0, y: -8, scale: 0.985 }}
										animate={{ opacity: 1, y: 0, scale: 1 }}
										exit={{ opacity: 0, y: -8, scale: 0.98 }}
										transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
									>
										<div className={styles.collaboratorOverlayList}>
											{openMetadataChip.entries.map((entry) => (
												<button
													key={entry.key}
													type="button"
													className={`${styles.collaboratorOverlayItem}${entry.active ? ` ${styles.collaboratorOverlayItemActive}` : ''}`}
													onMouseDown={preventChipOverlayFocusSteal}
													onPointerDown={preventChipOverlayFocusSteal}
													onClick={() => {
														if (entry.kind === 'collection') {
															props.onSelectCollectionFilter?.(entry.id);
														} else {
															props.onToggleLabelFilter?.(entry.id);
														}
														setOpenMetadataChip(null);
													}}
												>
													{entry.color ? <span className={styles.metadataOverlaySwatch} style={{ backgroundColor: entry.color }} aria-hidden="true" /> : null}
													<span className={styles.collaboratorOverlayName}>{entry.label}</span>
												</button>
											))}
										</div>
									</motion.div>
								</div>
							</>
						) : null}
					</AnimatePresence>,
					document.body
				)
				: null}
			{moreMenuNoteId && moreMenuDoc ? (
				<NoteCardMoreMenu
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
						const title = moreMenuDoc.getText('title').toString();
						setMoreMenuNoteId(null);
						setMoreMenuAnchorRect(null);
						props.onAddReminder?.(noteId, title);
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
