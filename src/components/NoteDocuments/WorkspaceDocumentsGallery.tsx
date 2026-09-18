import React from 'react';
import type * as Y from 'yjs';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileLines, faMagnifyingGlass, faPen, faTag, faUsers } from '@fortawesome/free-solid-svg-icons';
import { useDocumentManager } from '../../core/DocumentManagerContext';
import { getChecklistTextWithCountPrefix } from '../../core/checklistCounts';
import { useI18n } from '../../core/i18n';
import { getDocumentConversionEnabled } from '../../core/instanceConfig';
import { readNoteFromDoc } from '../../core/noteModel';
import { getNotePinPrefsSnapshot, resolveUserNotePinned, subscribeNotePinPrefs } from '../../core/notePinPreferences';
import { resolveNoteReminderAt } from '../../core/reminderLookup';
import {
	readCachedNoteShareCollaborators,
	syncNoteShareCollaborators,
	type NoteShareCollaboratorSnapshot,
	type SharedNotePlacement,
} from '../../core/noteShareApi';
import type { NoteDocumentRecord } from '../../core/noteDocumentApi';
import {
	getCachedNoteDocuments,
	getNoteDocumentExtension,
	getNoteDocumentsChangedEventName,
	readStoredRemoteNoteDocuments,
	refreshRemoteNoteDocuments,
	resolveNoteDocumentBlob,
} from '../../core/noteDocumentStore';
import type { CollectionRecord } from '../../services/collectionService';
import type { LabelRecord } from '../../services/labelService';
import { getVisibleNotes, type NoteGroupingMode, type NoteSortMode, type ReminderFilterMode, type SortDirection, type VisibleNoteSnapshot } from '../../utilities/getVisibleNotes';
import { buildNoteGroupSections } from '../../utilities/noteGrouping';
import { DocumentShareMenu } from './DocumentShareMenu';
import { DocumentTextViewer } from './DocumentTextViewer';
import { saveBlobToDevice } from './saveBlobToDevice';
import styles from './WorkspaceDocumentsGallery.module.css';

// Every document on the notes you can currently see, in one place — the same idea as the Images
// gallery, and it answers the same filters, sorting and grouping as the note grid. Search here also
// reads the text the server pulled out of each file, so "panel schedule" finds the PDF that says it.

const PdfViewer = React.lazy(() => import('./PdfViewer').then((module) => ({ default: module.PdfViewer })));

type CollaboratorFilter = {
	key: string;
	userId: string | null;
	label: string;
	email: string;
	avatar: string | null;
};

type WorkspaceDocumentsGalleryProps = {
	authUserId?: string | null;
	collections: readonly CollectionRecord[];
	labels: readonly LabelRecord[];
	activeCollectionId?: string | null;
	activeLabelIds?: readonly string[];
	activeCollaboratorFilter?: CollaboratorFilter | null;
	reminderFilter?: ReminderFilterMode;
	noteReminderByDocId?: Record<string, string | null>;
	sortMode?: NoteSortMode;
	sortDirection?: SortDirection;
	sortGrouping?: NoteGroupingMode;
	refreshCollaboratorsToken?: number;
	sharedNotes?: readonly SharedNotePlacement[];
	searchQuery?: string;
	canEdit?: boolean;
};

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

type GalleryItem = {
	key: string;
	noteId: string;
	docId: string;
	document: NoteDocumentRecord;
	noteTitle: string;
	collectionPath: string | null;
	labelNames: string[];
	collaboratorCount: number;
	/** Which part of the document matched the search, when it was its text rather than its name. */
	textMatch: string | null;
};

function normalizeId(value: unknown): string {
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function uniqueIds(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const output: string[] = [];
	for (const value of values) {
		const normalized = normalizeId(value);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		output.push(normalized);
	}
	return output;
}

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

function normalizeEmail(value: unknown): string {
	return String(value ?? '').trim().toLowerCase();
}

function collaboratorFilterKey(collaborator: { userId?: string | null; email?: string | null }): string {
	const userId = typeof collaborator.userId === 'string' ? collaborator.userId.trim() : '';
	if (userId) return `user:${userId}`;
	return `email:${normalizeEmail(collaborator.email)}`;
}

function snapshotToCollaboratorSummary(docId: string, snapshot: NoteShareCollaboratorSnapshot | null): NoteCardCollaboratorSummary | null {
	if (!snapshot) return null;
	const collaboratorsByKey = new Map<string, NoteCardCollaborator>();
	const mapUserLike = (
		user: { id?: string | null; name?: string | null; email?: string | null; profileImage?: string | null } | null | undefined,
		accessSource: 'direct' | 'workspace'
	): NoteCardCollaborator | null => {
		const label = String(user?.name || user?.email || user?.id || '').trim();
		const email = String(user?.email || '').trim();
		const userId = typeof user?.id === 'string' ? user.id : null;
		if (!label && !email) return null;
		return { key: collaboratorFilterKey({ userId, email }), userId, name: label || email, email, avatar: user?.profileImage ?? null, accessSource };
	};
	const first = mapUserLike(snapshot.sharedBy, 'direct');
	if (first) collaboratorsByKey.set(first.key, first);
	for (const collaborator of snapshot.collaborators ?? []) {
		const mapped = mapUserLike({
			id: collaborator.userId,
			name: collaborator.user?.name,
			email: collaborator.user?.email,
			profileImage: collaborator.user?.profileImage,
		}, collaborator.accessSource === 'workspace' ? 'workspace' : 'direct');
		if (mapped) collaboratorsByKey.set(mapped.key, mapped);
	}
	const collaborators = Array.from(collaboratorsByKey.values()).sort((left, right) => left.name.localeCompare(right.name));
	if (collaborators.length === 0) return null;
	return { docId, collaborators, count: collaborators.length };
}

function collaboratorMatchesFilter(summary: NoteCardCollaboratorSummary | null | undefined, filter: CollaboratorFilter | null | undefined): boolean {
	if (!summary || !filter) return false;
	return summary.collaborators.some((collaborator) => collaborator.key === filter.key);
}

function buildSearchableNoteBody(doc: Y.Doc | null, noteId: string): { title: string; bodyText: string } {
	if (!doc) return { title: '', bodyText: '' };
	const note = readNoteFromDoc(doc, noteId);
	const checklistText = Array.isArray(note.items) ? note.items.map((item) => getChecklistTextWithCountPrefix(item)).join(' ') : '';
	return {
		title: String(note.title || '').trim(),
		bodyText: [String(note.content || '').trim(), checklistText].filter(Boolean).join(' '),
	};
}

/** The line of extracted text around a search hit, so a result shows why it matched. */
function buildTextMatch(text: string, needle: string): string | null {
	if (!needle) return null;
	const index = text.toLowerCase().indexOf(needle);
	if (index < 0) return null;
	const start = Math.max(0, index - 40);
	const snippet = text.slice(start, Math.min(text.length, index + needle.length + 60)).replace(/\s+/g, ' ').trim();
	return `${start > 0 ? '…' : ''}${snippet}${index + needle.length + 60 < text.length ? '…' : ''}`;
}

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdfDocument(document: NoteDocumentRecord): boolean {
	return (document.fileExtension || getNoteDocumentExtension(document.fileName, document.mimeType)) === 'pdf';
}

function hasPdfView(document: NoteDocumentRecord): boolean {
	if (isPdfDocument(document)) return true;
	return !document.isLocal && document.conversionStatus === 'COMPLETE' && Boolean(document.viewPdfUrl);
}

function DocumentTile(props: {
	item: GalleryItem;
	websocketUrl: string | null;
	t: (key: string) => string;
	onOpen: () => void;
	onDownload: (document: NoteDocumentRecord) => void;
}): React.JSX.Element {
	const { item, t } = props;
	const extension = (item.document.fileExtension || getNoteDocumentExtension(item.document.fileName, item.document.mimeType) || 'doc').toUpperCase();
	const [thumbnailFailed, setThumbnailFailed] = React.useState(false);
	const pages = Number(item.document.pageCount || 0);
	const versionNumber = Number(item.document.latestVersionNumber || 0);
	return (
		<article className={styles.tile}>
			<button type="button" className={styles.tileButton} onClick={props.onOpen}>
				<div className={styles.thumbWrap}>
					{item.document.thumbnailUrl && !thumbnailFailed ? (
						<img className={styles.thumb} src={item.document.thumbnailUrl} alt="" loading="lazy" onError={() => setThumbnailFailed(true)} />
					) : (
						<div className={styles.thumbPlaceholder} aria-hidden="true">
							<FontAwesomeIcon icon={faFileLines} />
							<span>{extension.slice(0, 4)}</span>
						</div>
					)}
				</div>
				<div className={styles.metadata}>
					<p className={styles.fileName} title={item.document.fileName}>{item.document.fileName}</p>
					<p className={styles.noteTitle}>{item.noteTitle}</p>
					{item.collectionPath ? <p className={styles.collectionLine}>{item.collectionPath}</p> : null}
					<p className={styles.metaLine}>
						{[
							extension,
							(item.document.versionCount ?? 1) > 1 && versionNumber > 0 ? `v${versionNumber}` : null,
							formatBytes(item.document.byteSize),
							pages > 0 ? `${pages} ${t(pages === 1 ? 'documents.pageSingular' : 'documents.pagePlural')}` : null,
						].filter(Boolean).join(' · ')}
					</p>
					{item.textMatch ? (
						<p className={styles.textMatch}>
							<FontAwesomeIcon icon={faMagnifyingGlass} />
							<span>{item.textMatch}</span>
						</p>
					) : null}
					<div className={styles.countsLine}>
						<span className={styles.countBadge}>
							<FontAwesomeIcon icon={faTag} />
							<span>{item.labelNames.length}</span>
						</span>
						<span className={styles.countBadge}>
							<FontAwesomeIcon icon={faUsers} />
							<span>{item.collaboratorCount}</span>
						</span>
					</div>
				</div>
			</button>
			<div className={styles.tileActions}>
				<DocumentShareMenu
					document={item.document}
					t={t}
					floating
					markupVersionId={!item.document.isLocal && hasPdfView(item.document) ? item.document.latestVersionId ?? null : null}
					websocketUrl={props.websocketUrl}
					onDownloadOriginal={props.onDownload}
					buttonClassName={styles.iconButton}
					buttonActiveClassName={styles.iconButtonActive}
				/>
			</div>
		</article>
	);
}

export function WorkspaceDocumentsGallery(props: WorkspaceDocumentsGalleryProps): React.JSX.Element {
	const manager = useDocumentManager();
	const { t } = useI18n();
	const [notesList, setNotesList] = React.useState<Y.Array<Y.Map<unknown>> | null>(null);
	const [noteOrder, setNoteOrder] = React.useState<Y.Array<string> | null>(null);
	const [registryVersion, setRegistryVersion] = React.useState(0);
	const [docsById, setDocsById] = React.useState<Record<string, Y.Doc>>({});
	const [metadataVersion, setMetadataVersion] = React.useState(0);
	const [collaboratorSummariesByNoteId, setCollaboratorSummariesByNoteId] = React.useState<Record<string, NoteCardCollaboratorSummary>>({});
	const [documentsByDocId, setDocumentsByDocId] = React.useState<Record<string, readonly NoteDocumentRecord[]>>({});
	const [viewerDocument, setViewerDocument] = React.useState<NoteDocumentRecord | null>(null);
	const [textViewerDocument, setTextViewerDocument] = React.useState<NoteDocumentRecord | null>(null);
	const docsByIdRef = React.useRef<Record<string, Y.Doc>>({});
	const pendingDocLoadsRef = React.useRef<Set<string>>(new Set());
	const sectionRef = React.useRef<HTMLElement | null>(null);
	const websocketUrl = manager.getWebsocketUrl();

	const resolveMediaDocId = React.useCallback((noteId: string): string => {
		if (noteId.startsWith('shared-placement:')) return '';
		try {
			return manager.resolveRoomName(noteId);
		} catch {
			return '';
		}
	}, [manager]);

	React.useEffect(() => {
		docsByIdRef.current = docsById;
	}, [docsById]);

	React.useEffect(() => {
		let cancelled = false;
		void (async () => {
			const [list, order] = await Promise.all([manager.getNotesList(), manager.getNoteOrder()]);
			if (cancelled) return;
			setNotesList(list as unknown as Y.Array<Y.Map<unknown>>);
			setNoteOrder(order);
		})();
		return () => {
			cancelled = true;
		};
	}, [manager]);

	React.useEffect(() => {
		if (!notesList || !noteOrder) return undefined;
		const onChange = (): void => setRegistryVersion((current) => current + 1);
		notesList.observeDeep(onChange);
		noteOrder.observe(onChange);
		return () => {
			notesList.unobserveDeep(onChange);
			noteOrder.unobserve(onChange);
		};
	}, [noteOrder, notesList]);

	React.useEffect(() => {
		const entries = Object.entries(docsById);
		if (entries.length === 0) return undefined;
		const cleanups: Array<() => void> = [];
		for (const [, doc] of entries) {
			const metadata = doc.getMap('metadata');
			const handler = (): void => setMetadataVersion((current) => current + 1);
			metadata.observe(handler);
			cleanups.push(() => metadata.unobserve(handler));
		}
		return () => {
			for (const cleanup of cleanups) cleanup();
		};
	}, [docsById]);

	const sharedNoteIds = React.useMemo(() => (props.sharedNotes ?? []).map((note) => note.aliasId), [props.sharedNotes]);
	const sharedPlacementByAlias = React.useMemo(() => new Map((props.sharedNotes ?? []).map((placement) => [placement.aliasId, placement] as const)), [props.sharedNotes]);
	const orderedIds = React.useMemo(() => {
		if (!noteOrder) return [];
		return uniqueIds([...noteOrder.toArray().map((id) => normalizeId(id)), ...sharedNoteIds]);
	}, [noteOrder, registryVersion, sharedNoteIds]);

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
				.finally(() => {
					pendingDocLoadsRef.current.delete(id);
				});
		}
	}, [manager, noteOrder, orderedIds, sharedPlacementByAlias]);

	const pinPrefsSnapshot = React.useSyncExternalStore(subscribeNotePinPrefs, getNotePinPrefsSnapshot, getNotePinPrefsSnapshot);

	const noteSnapshots = React.useMemo<VisibleNoteSnapshot[]>(() => {
		void pinPrefsSnapshot;
		return orderedIds.map((id) => {
			const doc = docsById[id];
			if (!doc) return createFallbackNoteSnapshot(id);
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
				reminderAt: resolveNoteReminderAt(props.noteReminderByDocId, docId, id),
				isPinned: resolveUserNotePinned({ docId: docId || id, noteId: id, userId: props.authUserId, legacyPinned: note.isPinned }),
				lastAccessedAt: note.lastAccessedAt,
				trashed: note.trashed,
				archived: note.archived,
			};
		});
	}, [docsById, metadataVersion, orderedIds, pinPrefsSnapshot, props.authUserId, props.noteReminderByDocId, resolveMediaDocId, sharedPlacementByAlias]);

	const noteSnapshotById = React.useMemo(() => new Map(noteSnapshots.map((note) => [note.id, note] as const)), [noteSnapshots]);
	const baseVisibleIds = React.useMemo(() => {
		return getVisibleNotes(noteSnapshots, {
			showTrashed: false,
			showArchived: false,
			selectedCollectionId: props.activeCollectionId,
			selectedLabelIds: props.activeLabelIds,
			reminderFilter: props.reminderFilter,
			sortMode: props.sortMode,
			sortDirection: props.sortDirection,
			prioritizePinned: !props.activeCollectionId
				&& (props.activeLabelIds?.length ?? 0) === 0
				&& props.reminderFilter === 'all'
				&& props.sortMode === 'manual',
		}).map((note) => note.id);
	}, [noteSnapshots, props.activeCollectionId, props.activeLabelIds, props.reminderFilter, props.sortDirection, props.sortMode]);

	const visibleNoteEntries = React.useMemo(() => {
		return baseVisibleIds
			.map((noteId) => {
				const placement = sharedPlacementByAlias.get(noteId) ?? null;
				const docId = placement?.roomId || resolveMediaDocId(noteId);
				return docId ? { noteId, docId } : null;
			})
			.filter((entry): entry is { noteId: string; docId: string } => Boolean(entry));
	}, [baseVisibleIds, resolveMediaDocId, sharedPlacementByAlias]);

	const visibleNoteEntriesSignature = React.useMemo(
		() => visibleNoteEntries.map((entry) => `${entry.noteId}:${entry.docId}`).join('|'),
		[visibleNoteEntries]
	);

	React.useEffect(() => {
		if (!props.authUserId || visibleNoteEntries.length === 0) {
			setCollaboratorSummariesByNoteId({});
			return undefined;
		}
		let cancelled = false;
		const applySummaries = (rows: readonly { noteId: string; summary: NoteCardCollaboratorSummary | null }[]): void => {
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
			const cached = await Promise.all(visibleNoteEntries.map(async (entry) => ({
				noteId: entry.noteId,
				summary: snapshotToCollaboratorSummary(entry.docId, await readCachedNoteShareCollaborators(props.authUserId || '', entry.docId)),
			})));
			applySummaries(cached);
			if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
			const refreshed: Array<{ noteId: string; summary: NoteCardCollaboratorSummary | null }> = [];
			for (let start = 0; start < visibleNoteEntries.length; start += 6) {
				const batch = visibleNoteEntries.slice(start, start + 6);
				const batchRows = await Promise.all(batch.map(async (entry) => ({
					noteId: entry.noteId,
					summary: snapshotToCollaboratorSummary(entry.docId, await syncNoteShareCollaborators(props.authUserId || '', entry.docId, { suppressError: true })),
				})));
				if (cancelled) return;
				refreshed.push(...batchRows);
			}
			applySummaries(refreshed);
		})();
		return () => {
			cancelled = true;
		};
	}, [props.authUserId, props.refreshCollaboratorsToken, visibleNoteEntries, visibleNoteEntriesSignature]);

	const filteredVisibleNoteEntries = React.useMemo(() => {
		if (!props.activeCollaboratorFilter) return visibleNoteEntries;
		return visibleNoteEntries.filter((entry) => collaboratorMatchesFilter(collaboratorSummariesByNoteId[entry.noteId], props.activeCollaboratorFilter));
	}, [collaboratorSummariesByNoteId, props.activeCollaboratorFilter, visibleNoteEntries]);

	const filteredVisibleNoteIds = React.useMemo(() => filteredVisibleNoteEntries.map((entry) => entry.noteId), [filteredVisibleNoteEntries]);
	const filteredVisibleDocIds = React.useMemo(() => filteredVisibleNoteEntries.map((entry) => entry.docId), [filteredVisibleNoteEntries]);
	const filteredVisibleDocIdSet = React.useMemo(() => new Set(filteredVisibleDocIds), [filteredVisibleDocIds]);

	const loadDocumentsFor = React.useCallback(async (docId: string): Promise<void> => {
		// Whatever this device already has shows first; the server is asked afterwards.
		const stored = await readStoredRemoteNoteDocuments(docId).catch(() => []);
		setDocumentsByDocId((previous) => ({ ...previous, [docId]: stored.length > 0 ? stored : getCachedNoteDocuments(docId) }));
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
		try {
			await refreshRemoteNoteDocuments(docId);
			setDocumentsByDocId((previous) => ({ ...previous, [docId]: getCachedNoteDocuments(docId) }));
		} catch {
			// Offline or a hiccup: the stored list above is still on screen.
		}
	}, []);

	React.useEffect(() => {
		if (filteredVisibleDocIds.length === 0) {
			setDocumentsByDocId({});
			return undefined;
		}
		let cancelled = false;
		void (async () => {
			for (let start = 0; start < filteredVisibleDocIds.length; start += 6) {
				const batch = filteredVisibleDocIds.slice(start, start + 6);
				await Promise.all(batch.map((docId) => (cancelled ? Promise.resolve() : loadDocumentsFor(docId))));
				if (cancelled) return;
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [filteredVisibleDocIds, loadDocumentsFor]);

	React.useEffect(() => {
		const eventName = getNoteDocumentsChangedEventName();
		const onChanged = (event: Event): void => {
			const changedDocId = String((event as CustomEvent<{ docId?: string }>).detail?.docId || '').trim();
			if (!changedDocId || !filteredVisibleDocIdSet.has(changedDocId)) return;
			void loadDocumentsFor(changedDocId);
		};
		const onOnline = (): void => {
			for (const docId of filteredVisibleDocIds) void loadDocumentsFor(docId);
		};
		window.addEventListener(eventName, onChanged as EventListener);
		window.addEventListener('online', onOnline);
		return () => {
			window.removeEventListener(eventName, onChanged as EventListener);
			window.removeEventListener('online', onOnline);
		};
	}, [filteredVisibleDocIdSet, filteredVisibleDocIds, loadDocumentsFor]);

	const collectionPathById = React.useMemo(() => {
		const map = new Map<string, string>();
		const cache = new Map(props.collections.map((collection) => [collection.id, collection] as const));
		const visit = (collectionId: string, seen = new Set<string>()): string => {
			if (map.has(collectionId)) return map.get(collectionId) || '';
			const collection = cache.get(collectionId) ?? null;
			if (!collection) return '';
			if (seen.has(collectionId)) return collection.name;
			const nextSeen = new Set(seen);
			nextSeen.add(collectionId);
			const parentPath = collection.parentId ? visit(collection.parentId, nextSeen) : '';
			const path = parentPath ? `${parentPath} / ${collection.name}` : collection.name;
			map.set(collectionId, path);
			return path;
		};
		for (const collection of props.collections) visit(collection.id);
		return map;
	}, [props.collections]);
	const labelNameById = React.useMemo(() => new Map(props.labels.map((label) => [label.id, label.name] as const)), [props.labels]);

	const galleryItems = React.useMemo<GalleryItem[]>(() => {
		const searchNeedle = String(props.searchQuery || '').trim().toLowerCase();
		const items: GalleryItem[] = [];
		for (const entry of filteredVisibleNoteEntries) {
			const snapshot = noteSnapshotById.get(entry.noteId);
			if (!snapshot) continue;
			const documents = documentsByDocId[entry.docId];
			if (!documents || documents.length === 0) continue;
			const noteContent = buildSearchableNoteBody(docsById[entry.noteId] ?? null, entry.noteId);
			const noteTitle = noteContent.title || snapshot.title || t('note.untitled');
			const collectionPath = snapshot.collectionId ? collectionPathById.get(snapshot.collectionId) || null : null;
			const labelNames = snapshot.labelIds.map((labelId) => labelNameById.get(labelId) || labelId).filter(Boolean);
			const collaboratorCount = collaboratorSummariesByNoteId[entry.noteId]?.count || 0;
			for (const document of documents) {
				const documentText = document.ocrText || '';
				const searchText = [
					document.fileName,
					noteTitle,
					noteContent.bodyText,
					collectionPath || '',
					labelNames.join(' '),
					documentText,
				].join(' ').toLowerCase();
				if (searchNeedle && !searchText.includes(searchNeedle)) continue;
				items.push({
					key: `${entry.noteId}:${document.id}`,
					noteId: entry.noteId,
					docId: entry.docId,
					document,
					noteTitle,
					collectionPath,
					labelNames,
					collaboratorCount,
					textMatch: searchNeedle && !document.fileName.toLowerCase().includes(searchNeedle) ? buildTextMatch(documentText, searchNeedle) : null,
				});
			}
		}
		return items;
	}, [collaboratorSummariesByNoteId, collectionPathById, docsById, documentsByDocId, filteredVisibleNoteEntries, labelNameById, noteSnapshotById, props.searchQuery, t]);

	const itemsByNoteId = React.useMemo(() => {
		const map = new Map<string, GalleryItem[]>();
		for (const item of galleryItems) {
			const current = map.get(item.noteId);
			if (current) current.push(item);
			else map.set(item.noteId, [item]);
		}
		for (const list of map.values()) {
			list.sort((left, right) => Date.parse(right.document.updatedAt) - Date.parse(left.document.updatedAt));
		}
		return map;
	}, [galleryItems]);

	const groupedSections = React.useMemo(() => {
		const noteSections = buildNoteGroupSections({
			renderedIds: filteredVisibleNoteIds,
			noteSnapshotById,
			sortGrouping: props.sortGrouping,
			sortMode: props.sortMode,
		});
		if (noteSections.length === 0) return [];
		return noteSections
			.map((section) => ({
				key: section.key,
				label: section.label,
				items: section.noteIds.flatMap((noteId) => itemsByNoteId.get(noteId) || []),
			}))
			.filter((section) => section.items.length > 0);
	}, [filteredVisibleNoteIds, itemsByNoteId, noteSnapshotById, props.sortGrouping, props.sortMode]);

	const summaryCounts = React.useMemo(() => ({
		documentCount: galleryItems.length,
		noteCount: new Set(galleryItems.map((item) => item.noteId)).size,
		markedUpCount: galleryItems.filter((item) => hasPdfView(item.document)).length,
	}), [galleryItems]);

	const handleOpen = React.useCallback((document: NoteDocumentRecord): void => {
		if (hasPdfView(document)) setViewerDocument(document);
		else setTextViewerDocument(document);
	}, []);

	const handleDownload = React.useCallback(async (document: NoteDocumentRecord): Promise<void> => {
		const blob = await resolveNoteDocumentBlob(document).catch(() => null);
		if (blob) saveBlobToDevice(blob, document.fileName);
	}, []);

	const renderTile = (item: GalleryItem): React.JSX.Element => (
		<DocumentTile
			key={item.key}
			item={item}
			websocketUrl={websocketUrl}
			t={t}
			onOpen={() => handleOpen(item.document)}
			onDownload={(target) => void handleDownload(target)}
		/>
	);

	return (
		<section ref={sectionRef} className={styles.section}>
			<div className={styles.heroAside}>
				<div className={styles.heroMeta}>
					<div className={styles.statRow}><span className={styles.statLabel}>{t('editors.mediaTabDocuments')}</span><span className={styles.statValue}>{summaryCounts.documentCount}</span></div>
					<div className={styles.statRow}><span className={styles.statLabel}>{t('documents.galleryNotesStat')}</span><span className={styles.statValue}>{summaryCounts.noteCount}</span></div>
					<div className={styles.statRow}><span className={styles.statLabel}><FontAwesomeIcon icon={faPen} /> {t('documents.galleryMarkableStat')}</span><span className={styles.statValue}>{summaryCounts.markedUpCount}</span></div>
				</div>
				{props.searchQuery ? <div className={styles.searchBadge}><FontAwesomeIcon icon={faMagnifyingGlass} /> {props.searchQuery}</div> : null}
			</div>

			{galleryItems.length === 0 ? (
				<div className={styles.empty}>
					<h3 className={styles.emptyTitle}>{props.searchQuery ? t('documents.gallerySearchEmptyTitle') : t('documents.galleryEmptyTitle')}</h3>
					<p className={styles.emptyBody}>{props.searchQuery ? t('documents.gallerySearchEmptyBody') : t('documents.galleryEmptyBody')}</p>
				</div>
			) : groupedSections.length > 0 ? (
				groupedSections.map((section) => (
					<div key={section.key} className={styles.groupSection}>
						<div className={styles.groupHeader}>
							<h3 className={styles.groupTitle}>{section.label}</h3>
							<div className={styles.groupMeta}>{`${section.items.length} ${t(section.items.length === 1 ? 'documents.itemSingular' : 'documents.itemPlural')}`}</div>
						</div>
						<div className={styles.grid}>{section.items.map(renderTile)}</div>
					</div>
				))
			) : (
				<div className={styles.grid}>{galleryItems.map(renderTile)}</div>
			)}

			{viewerDocument ? (
				<React.Suspense fallback={null}>
					<PdfViewer
						document={viewerDocument}
						authUserId={props.authUserId}
						canEdit={props.canEdit === true}
						onClose={() => setViewerDocument(null)}
						onDownload={(target) => void handleDownload(target)}
					/>
				</React.Suspense>
			) : null}
			{textViewerDocument ? (
				<DocumentTextViewer
					document={textViewerDocument}
					conversionEnabled={getDocumentConversionEnabled()}
					onClose={() => setTextViewerDocument(null)}
					onDownload={(target) => void handleDownload(target)}
				/>
			) : null}
		</section>
	);
}
