import React from 'react';
import type * as Y from 'yjs';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faImage, faMagnifyingGlass, faTag, faUsers } from '@fortawesome/free-solid-svg-icons';
import { useDocumentManager } from '../../core/DocumentManagerContext';
import { getChecklistTextWithCountPrefix } from '../../core/checklistCounts';
import { useI18n } from '../../core/i18n';
import { getConnectionQuality, subscribeConnectionQualityChange } from '../../core/networkQuality';
import { readNoteFromDoc } from '../../core/noteModel';
import { getNotePinPrefsSnapshot, resolveUserNotePinned, subscribeNotePinPrefs } from '../../core/notePinPreferences';
import { resolveNoteReminderAt } from '../../core/reminderLookup';
import {
	readCachedNoteShareCollaborators,
	syncNoteShareCollaborators,
	type NoteShareCollaboratorSnapshot,
	type SharedNotePlacement,
} from '../../core/noteShareApi';
import type { NoteImageRecord } from '../../core/noteMediaApi';
import {
	filterRemoteNoteImagesByPendingDeletes,
	getCachedRemoteNoteImages,
	getNoteMediaChangedEventName,
	readQueuedNoteImageDeletions,
	readStoredNoteImagePreviewRows,
	readStoredRemoteNoteImages,
	refreshRemoteNoteImages,
	type QueuedNoteImageRow,
	type StoredNoteImagePreviewRecord,
} from '../../core/noteMediaStore';
import type { CollectionRecord } from '../../services/collectionService';
import type { LabelRecord } from '../../services/labelService';
import { getVisibleNotes, type NoteGroupingMode, type NoteSortMode, type ReminderFilterMode, type SortDirection, type VisibleNoteSnapshot } from '../../utilities/getVisibleNotes';
import { buildNoteGroupSections } from '../../utilities/noteGrouping';
import { NoteImageViewer } from './NoteImageViewer';
import { useResolvedNoteImageSource } from './useResolvedNoteImageSource';
import styles from './WorkspaceImagesGallery.module.css';

type CollaboratorFilter = {
	key: string;
	userId: string | null;
	label: string;
	email: string;
	avatar: string | null;
};

type WorkspaceImagesGalleryProps = {
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

type DocMediaState = {
	remoteImages: readonly NoteImageRecord[];
	queuedDeletions: readonly QueuedNoteImageRow[];
	storedPreviewRows: readonly StoredNoteImagePreviewRecord[];
};

type GalleryItem = {
	key: string;
	noteId: string;
	docId: string;
	imageId: string;
	noteTitle: string;
	collectionPath: string | null;
	labelNames: string[];
	collaboratorCount: number;
	ocrText: string;
	createdAt: string;
	updatedAt: string;
	originalUrl: string;
	thumbnailUrl: string;
	previewBlob: Blob | null;
	searchText: string;
};

type ViewerState = {
	items: Array<{
		src: string;
		fallbackThumbnailBlob?: Blob | null;
		title: string;
		subtitle?: string | null;
	}>;
	index: number;
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

function readOrderIds(noteOrder: Y.Array<string>): string[] {
	return uniqueIds(noteOrder.toArray().map((id) => normalizeId(id)));
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

function TileImage(props: { item: GalleryItem; onOpen: () => void }): React.JSX.Element {
	const resolvedImage = useResolvedNoteImageSource({
		fullUrl: props.item.originalUrl,
		thumbnailUrl: props.item.thumbnailUrl,
		offlineThumbnailBlob: props.item.previewBlob,
		mode: 'thumbnail',
	});
	const labelCount = props.item.labelNames.length;
	const formattedDate = new Date(props.item.updatedAt).toLocaleDateString();
	return (
		<article className={styles.tile}>
			<button type="button" className={styles.tileButton} onClick={props.onOpen}>
				<div className={styles.thumbWrap}>
					{resolvedImage.showPlaceholder || !resolvedImage.src ? (
						<div className={styles.thumbPlaceholder} aria-hidden="true">
							<FontAwesomeIcon icon={faImage} />
						</div>
					) : (
						<img className={styles.thumb} src={resolvedImage.src} alt={props.item.noteTitle} onError={resolvedImage.fallbackToOfflinePreview} />
					)}
				</div>
				<div className={styles.metadata}>
					<p className={styles.noteTitle}>{props.item.noteTitle}</p>
					{props.item.collectionPath ? <p className={styles.collectionLine}>{props.item.collectionPath}</p> : null}
					<div className={styles.countsLine}>
						<span className={styles.countBadge}>
							<FontAwesomeIcon icon={faTag} />
							<span>{labelCount}</span>
						</span>
						<span className={styles.countBadge}>
							<FontAwesomeIcon icon={faUsers} />
							<span>{props.item.collaboratorCount}</span>
						</span>
					</div>
					<div className={styles.footerLine}>
						<span className={styles.footerValue}>{formattedDate}</span>
					</div>
				</div>
			</button>
		</article>
	);
}

export function WorkspaceImagesGallery(props: WorkspaceImagesGalleryProps): React.JSX.Element {
	const manager = useDocumentManager();
	const { t } = useI18n();
	const [notesList, setNotesList] = React.useState<Y.Array<Y.Map<unknown>> | null>(null);
	const [noteOrder, setNoteOrder] = React.useState<Y.Array<string> | null>(null);
	const [registryVersion, setRegistryVersion] = React.useState(0);
	const [docsById, setDocsById] = React.useState<Record<string, Y.Doc>>({});
	const [metadataVersion, setMetadataVersion] = React.useState(0);
	const [collaboratorSummariesByNoteId, setCollaboratorSummariesByNoteId] = React.useState<Record<string, NoteCardCollaboratorSummary>>({});
	const [mediaByDocId, setMediaByDocId] = React.useState<Record<string, DocMediaState>>({});
	const [mediaLoading, setMediaLoading] = React.useState(false);
	const [mobileColumns, setMobileColumns] = React.useState(2);
	const [viewerState, setViewerState] = React.useState<ViewerState | null>(null);
	const docsByIdRef = React.useRef<Record<string, Y.Doc>>({});
	const pendingDocLoadsRef = React.useRef<Set<string>>(new Set());
	const sectionRef = React.useRef<HTMLElement | null>(null);

	const resolveMediaDocId = React.useCallback((noteId: string): string => {
		// Guard first: manager.resolveRoomName() never throws for unregistered aliases
		// — it falls back to `${activeWorkspaceId}:${rawNoteId}`, producing an invalid
		// docId. Callers with a placement should use placement.roomId directly.
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
		return uniqueIds([...readOrderIds(noteOrder), ...sharedNoteIds]);
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
				isPinned: resolveUserNotePinned({
					docId: docId || id,
					noteId: id,
					userId: props.authUserId,
					legacyPinned: note.isPinned,
				}),
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
		if (!props.authUserId) {
			setCollaboratorSummariesByNoteId({});
			return undefined;
		}
		if (visibleNoteEntries.length === 0) {
			setCollaboratorSummariesByNoteId({});
			return undefined;
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
	}, [props.authUserId, props.refreshCollaboratorsToken, visibleNoteEntries, visibleNoteEntriesSignature]);

	const filteredVisibleNoteEntries = React.useMemo(() => {
		if (!props.activeCollaboratorFilter) return visibleNoteEntries;
		return visibleNoteEntries.filter((entry) => collaboratorMatchesFilter(collaboratorSummariesByNoteId[entry.noteId], props.activeCollaboratorFilter));
	}, [collaboratorSummariesByNoteId, props.activeCollaboratorFilter, visibleNoteEntries]);

	const filteredVisibleNoteIds = React.useMemo(() => filteredVisibleNoteEntries.map((entry) => entry.noteId), [filteredVisibleNoteEntries]);
	const filteredVisibleDocIds = React.useMemo(() => filteredVisibleNoteEntries.map((entry) => entry.docId), [filteredVisibleNoteEntries]);
	const filteredVisibleDocIdSet = React.useMemo(() => new Set(filteredVisibleDocIds), [filteredVisibleDocIds]);

	const loadMediaForDoc = React.useCallback(async (docId: string, forceRemote = false): Promise<void> => {
		const [storedImages, queuedDeletions, storedPreviewRows] = await Promise.all([
			readStoredRemoteNoteImages(docId),
			props.authUserId ? readQueuedNoteImageDeletions(props.authUserId, docId) : Promise.resolve([]),
			readStoredNoteImagePreviewRows(docId),
		]);
		setMediaByDocId((previous) => ({
			...previous,
			[docId]: {
				remoteImages: storedImages.length > 0 ? storedImages : getCachedRemoteNoteImages(docId),
				queuedDeletions,
				storedPreviewRows,
			},
		}));
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
		try {
			const remoteImages = await refreshRemoteNoteImages(docId, forceRemote ? { force: true } : { minIntervalMs: 1500 });
			const nextPreviewRows = await readStoredNoteImagePreviewRows(docId);
			setMediaByDocId((previous) => ({
				...previous,
				[docId]: {
					remoteImages,
					queuedDeletions,
					storedPreviewRows: nextPreviewRows,
				},
			}));
		} catch {
			// Stored rows are already applied above; keep the gallery usable offline or during transient fetch failures.
		}
	}, [props.authUserId]);

	React.useEffect(() => {
		if (filteredVisibleDocIds.length === 0) {
			setMediaByDocId({});
			setMediaLoading(false);
			return undefined;
		}
		let cancelled = false;
		setMediaLoading(true);
		void (async () => {
			for (let start = 0; start < filteredVisibleDocIds.length; start += 6) {
				const batch = filteredVisibleDocIds.slice(start, start + 6);
				await Promise.all(batch.map(async (docId) => {
					if (cancelled) return;
					await loadMediaForDoc(docId);
				}));
				if (cancelled) return;
			}
			if (!cancelled) setMediaLoading(false);
		})();
		return () => {
			cancelled = true;
		};
	}, [filteredVisibleDocIds, loadMediaForDoc]);

	React.useEffect(() => {
		const eventName = getNoteMediaChangedEventName();
		const onChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string }>).detail;
			const changedDocId = String(detail?.docId || '').trim();
			if (!changedDocId || !filteredVisibleDocIdSet.has(changedDocId)) return;
			void loadMediaForDoc(changedDocId, true);
		};
		const onOnline = (): void => {
			for (const docId of filteredVisibleDocIds) {
				void loadMediaForDoc(docId, true);
			}
		};
		window.addEventListener(eventName, onChanged as EventListener);
		window.addEventListener('online', onOnline);
		const unsubscribeConnection = subscribeConnectionQualityChange(() => {
			if (getConnectionQuality() !== 'good') return;
			for (const docId of filteredVisibleDocIds) {
				void loadMediaForDoc(docId, true);
			}
		});
		return () => {
			window.removeEventListener(eventName, onChanged as EventListener);
			window.removeEventListener('online', onOnline);
			unsubscribeConnection();
		};
	}, [filteredVisibleDocIdSet, filteredVisibleDocIds, loadMediaForDoc]);

	React.useEffect(() => {
		if (typeof window === 'undefined') return undefined;
		const updateColumns = (): void => {
			const width = sectionRef.current?.clientWidth ?? window.innerWidth;
			if (window.innerWidth > 767) {
				setMobileColumns(3);
				return;
			}
			setMobileColumns(Math.max(1, Math.min(3, Math.floor(width / 118))));
		};
		updateColumns();
		const onResize = (): void => updateColumns();
		window.addEventListener('resize', onResize);
		const observer = sectionRef.current ? new ResizeObserver(() => updateColumns()) : null;
		if (sectionRef.current && observer) observer.observe(sectionRef.current);
		return () => {
			window.removeEventListener('resize', onResize);
			observer?.disconnect();
		};
	}, []);

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
		for (const collection of props.collections) {
			visit(collection.id);
		}
		return map;
	}, [props.collections]);
	const labelNameById = React.useMemo(() => new Map(props.labels.map((label) => [label.id, label.name] as const)), [props.labels]);

	const galleryItems = React.useMemo<GalleryItem[]>(() => {
		const searchNeedle = String(props.searchQuery || '').trim().toLowerCase();
		const items: GalleryItem[] = [];
		for (const entry of filteredVisibleNoteEntries) {
			const snapshot = noteSnapshotById.get(entry.noteId);
			if (!snapshot) continue;
			const noteDoc = docsById[entry.noteId] ?? null;
			const noteContent = buildSearchableNoteBody(noteDoc, entry.noteId);
			const mediaState = mediaByDocId[entry.docId];
			if (!mediaState) continue;
			const previewByRemoteId = new Map(
				mediaState.storedPreviewRows
					.filter((row) => row.kind === 'remote' && row.remoteImageId)
					.map((row) => [row.remoteImageId as string, row] as const)
			);
			const visibleRemoteImages = filterRemoteNoteImagesByPendingDeletes(mediaState.remoteImages, mediaState.queuedDeletions);
			const collectionPath = snapshot.collectionId ? collectionPathById.get(snapshot.collectionId) || null : null;
			const labelNames = snapshot.labelIds.map((labelId) => labelNameById.get(labelId) || labelId).filter(Boolean);
			const collaboratorCount = collaboratorSummariesByNoteId[entry.noteId]?.count || 0;
			for (const image of visibleRemoteImages) {
				const noteTitle = noteContent.title || snapshot.title || t('note.untitled');
				const searchText = [
					noteTitle,
					noteContent.bodyText,
					collectionPath || '',
					labelNames.join(' '),
					image.ocrText || '',
				].join(' ').toLowerCase();
				if (searchNeedle && !searchText.includes(searchNeedle)) continue;
				items.push({
					key: `${entry.noteId}:${image.id}`,
					noteId: entry.noteId,
					docId: entry.docId,
					imageId: image.id,
					noteTitle,
					collectionPath,
					labelNames,
					collaboratorCount,
					ocrText: image.ocrText || '',
					createdAt: image.createdAt,
					updatedAt: image.updatedAt,
					originalUrl: image.originalUrl,
					thumbnailUrl: image.thumbnailUrl,
					previewBlob: previewByRemoteId.get(image.id)?.thumbnailBlob || null,
					searchText,
				});
			}
		}
		return items;
	}, [collaboratorSummariesByNoteId, collectionPathById, docsById, filteredVisibleNoteEntries, labelNameById, mediaByDocId, noteSnapshotById, props.searchQuery, t]);

	const viewerItems = React.useMemo(() => galleryItems.map((item, index) => ({
		src: item.originalUrl,
		thumbnailUrl: item.thumbnailUrl,
		fallbackThumbnailBlob: item.previewBlob,
		title: item.noteTitle || `${t('media.imageLabel')} ${index + 1}`,
		subtitle: [item.collectionPath ? `Collection: ${item.collectionPath}` : null, item.labelNames.length > 0 ? `Labels: ${item.labelNames.join(', ')}` : null].filter(Boolean).join(' · ') || null,
	})), [galleryItems, t]);

	React.useEffect(() => {
		setViewerState((current) => {
			if (!current) return null;
			if (viewerItems.length === 0) return null;
			const activeSrc = current.items[current.index]?.src;
			const nextIndex = Math.max(0, viewerItems.findIndex((item) => item.src === activeSrc));
			return {
				items: viewerItems,
				index: viewerItems.findIndex((item) => item.src === activeSrc) >= 0 ? nextIndex : Math.min(current.index, viewerItems.length - 1),
			};
		});
	}, [viewerItems]);

	const itemsByNoteId = React.useMemo(() => {
		const map = new Map<string, GalleryItem[]>();
		for (const item of galleryItems) {
			const current = map.get(item.noteId);
			if (current) current.push(item);
			else map.set(item.noteId, [item]);
		}
		for (const list of map.values()) {
			list.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
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

	const summaryCounts = React.useMemo(() => {
		const noteCount = new Set(galleryItems.map((item) => item.noteId)).size;
		const collectionCount = new Set(galleryItems.map((item) => item.collectionPath).filter(Boolean)).size;
		return { imageCount: galleryItems.length, noteCount, collectionCount };
	}, [galleryItems]);

	const openViewerAtIndex = React.useCallback((index: number): void => {
		setViewerState({ items: viewerItems, index });
	}, [viewerItems]);

	const galleryGrid = (
		<div className={styles.grid} style={{ ['--gallery-mobile-columns' as const]: String(mobileColumns) } as React.CSSProperties}>
			{galleryItems.map((item, index) => (
				<TileImage key={item.key} item={item} onOpen={() => openViewerAtIndex(index)} />
			))}
		</div>
	);

	const emptyTitle = props.searchQuery ? 'No images match this search.' : t('media.emptyTitle');
	const emptyBody = props.searchQuery
		? 'Try a different term. Image search matches OCR text, labels, collections, and note content in the current workspace.'
		: 'Images attached to visible notes in this workspace will appear here.';

	return (
		<section ref={sectionRef} className={styles.section}>
			<div className={styles.heroAside}>
				<div className={styles.heroMeta}>
					<div className={styles.statRow}><span className={styles.statLabel}>{t('media.imagePlural')}</span><span className={styles.statValue}>{summaryCounts.imageCount}</span></div>
					<div className={styles.statRow}><span className={styles.statLabel}>Visible notes</span><span className={styles.statValue}>{summaryCounts.noteCount}</span></div>
					<div className={styles.statRow}><span className={styles.statLabel}>Collections</span><span className={styles.statValue}>{summaryCounts.collectionCount}</span></div>
				</div>
				{props.searchQuery ? <div className={styles.searchBadge}><FontAwesomeIcon icon={faMagnifyingGlass} /> {props.searchQuery}</div> : null}
			</div>

			{galleryItems.length === 0 ? (
				<div className={styles.empty}>
					<h3 className={styles.emptyTitle}>{emptyTitle}</h3>
					<p className={styles.emptyBody}>{emptyBody}</p>
				</div>
			) : groupedSections.length > 0 ? (
				groupedSections.map((section) => (
					<div key={section.key} className={styles.groupSection}>
						<div className={styles.groupHeader}>
							<h3 className={styles.groupTitle}>{section.label}</h3>
							<div className={styles.groupMeta}>{section.items.length} {section.items.length === 1 ? t('media.imageSingular') : t('media.imagePlural')}</div>
						</div>
						<div className={styles.grid} style={{ ['--gallery-mobile-columns' as const]: String(mobileColumns) } as React.CSSProperties}>
							{section.items.map((item) => {
								const index = galleryItems.findIndex((candidate) => candidate.key === item.key);
								return <TileImage key={item.key} item={item} onOpen={() => openViewerAtIndex(index)} />;
							})}
						</div>
					</div>
				))
			) : galleryGrid}

			{viewerState ? (
				<NoteImageViewer
					src={viewerState.items[viewerState.index]?.src || ''}
					thumbnailUrl={viewerState.items[viewerState.index]?.thumbnailUrl || null}
					fallbackThumbnailBlob={viewerState.items[viewerState.index]?.fallbackThumbnailBlob || null}
					title={viewerState.items[viewerState.index]?.title || t('media.imageLabel')}
					subtitle={viewerState.items[viewerState.index]?.subtitle || null}
					onClose={() => setViewerState(null)}
					hasPrevious={viewerState.index > 0}
					hasNext={viewerState.index < viewerState.items.length - 1}
					onPrevious={viewerState.index > 0 ? () => setViewerState((current) => current ? { ...current, index: Math.max(0, current.index - 1) } : current) : undefined}
					onNext={viewerState.index < viewerState.items.length - 1 ? () => setViewerState((current) => current ? { ...current, index: Math.min(current.items.length - 1, current.index + 1) } : current) : undefined}
				/>
			) : null}
		</section>
	);
}