import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faImage, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import { deleteNoteImage, type NoteImageRecord } from '../../core/noteMediaApi';
import {
	deleteQueuedNoteImage,
	emitNoteMediaChanged,
	filterRemoteNoteImagesByPendingDeletes,
	flushQueuedNoteImages,
	getCachedRemoteNoteImages,
	getNoteMediaChangedEventName,
	readStoredNoteImagePreviewRows,
	readStoredRemoteNoteImages,
	readQueuedNoteImages,
	readQueuedNoteImageDeletions,
	refreshRemoteNoteImages,
	queueRemoteNoteImageDeletion,
	type StoredNoteImagePreviewRecord,
	type QueuedNoteImageRow,
} from '../../core/noteMediaStore';
import { useResolvedNoteImageSource } from './useResolvedNoteImageSource';
import { NoteImageViewer } from './NoteImageViewer';
import styles from './NoteMediaPanel.module.css';

type NoteMediaPanelProps = {
	docId: string;
	authUserId?: string | null;
	canEdit: boolean;
	onAddImage?: (() => void) | undefined;
};

type LocalPreviewItem = QueuedNoteImageRow & {
	previewUrl: string;
};

type ViewerState = {
	items: Array<{
		src: string;
		fallbackThumbnailBlob?: Blob | null;
		thumbnailUrl?: string | null;
		title: string;
		subtitle?: string | null;
		onDelete?: (() => void) | undefined;
		deleteDisabled?: boolean;
	}>;
	index: number;
};

type RemoteImageThumbProps = {
	image: NoteImageRecord;
	preview: StoredNoteImagePreviewRecord | null;
	alt: string;
};

function RemoteImageThumb(props: RemoteImageThumbProps): React.JSX.Element {
	const { t } = useI18n();
	const resolvedImage = useResolvedNoteImageSource({
		fullUrl: props.image.originalUrl,
		thumbnailUrl: props.image.thumbnailUrl,
		offlineThumbnailBlob: props.preview?.thumbnailBlob || null,
		mode: 'thumbnail',
	});

	if (resolvedImage.showPlaceholder || !resolvedImage.src) {
		return (
			<div className={`${styles.thumb} ${styles.thumbPlaceholder}`} aria-hidden="true">
				<FontAwesomeIcon icon={faImage} />
			</div>
		);
	}

	return (
		<>
			{resolvedImage.isOfflinePreview ? <span className={`${styles.badge} ${styles.offlineBadge}`}>{t('media.offlinePreviewBadge')}</span> : null}
			{!resolvedImage.isOfflinePreview && props.image.ocrStatus !== 'READY' ? <span className={styles.badge}>{t('media.ocrBadge')}</span> : null}
			<img className={styles.thumb} src={resolvedImage.src} alt={props.alt} onError={resolvedImage.fallbackToOfflinePreview} />
		</>
	);
}

function isOffline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeDate(value: string, locale: string): string {
	const time = Date.parse(value);
	if (!Number.isFinite(time)) return '';
	const deltaMs = time - Date.now();
	const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
	const minuteDelta = Math.round(deltaMs / 60_000);
	if (Math.abs(minuteDelta) < 60) return rtf.format(minuteDelta, 'minute');
	const hourDelta = Math.round(deltaMs / 3_600_000);
	if (Math.abs(hourDelta) < 24) return rtf.format(hourDelta, 'hour');
	const dayDelta = Math.round(deltaMs / 86_400_000);
	return rtf.format(dayDelta, 'day');
}

export function NoteMediaPanel(props: NoteMediaPanelProps): React.JSX.Element {
	const { t, locale } = useI18n();
	const [remoteImages, setRemoteImages] = React.useState<readonly NoteImageRecord[]>(() => getCachedRemoteNoteImages(props.docId));
	const [queuedImages, setQueuedImages] = React.useState<readonly QueuedNoteImageRow[]>([]);
	const [queuedDeletions, setQueuedDeletions] = React.useState<readonly QueuedNoteImageRow[]>([]);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [deletingId, setDeletingId] = React.useState<string | null>(null);
	const [viewerState, setViewerState] = React.useState<ViewerState | null>(null);
	const [localPreviewItems, setLocalPreviewItems] = React.useState<readonly LocalPreviewItem[]>([]);
	const [storedPreviewRows, setStoredPreviewRows] = React.useState<readonly StoredNoteImagePreviewRecord[]>([]);
	const tileTouchStartRef = React.useRef<{ index: number; x: number; y: number } | null>(null);
	const lastTouchOpenRef = React.useRef<{ index: number; at: number } | null>(null);

	const refresh = React.useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [remoteImages, queuedResponse, queuedDeleteResponse, previewRows] = await Promise.all([
				refreshRemoteNoteImages(props.docId).catch(async () => {
					const stored = await readStoredRemoteNoteImages(props.docId);
					return stored.length > 0 ? stored : getCachedRemoteNoteImages(props.docId);
				}),
				props.authUserId ? readQueuedNoteImages(props.authUserId, props.docId) : Promise.resolve([]),
				props.authUserId ? readQueuedNoteImageDeletions(props.authUserId, props.docId) : Promise.resolve([]),
				readStoredNoteImagePreviewRows(props.docId),
			]);
			setRemoteImages(remoteImages);
			setQueuedImages(queuedResponse);
			setQueuedDeletions(queuedDeleteResponse);
			setStoredPreviewRows(previewRows);
		} catch (nextError) {
			setError(nextError instanceof Error ? nextError.message : 'Unable to load note media');
			setRemoteImages(await readStoredRemoteNoteImages(props.docId));
			setQueuedImages(props.authUserId ? await readQueuedNoteImages(props.authUserId, props.docId) : []);
			setQueuedDeletions(props.authUserId ? await readQueuedNoteImageDeletions(props.authUserId, props.docId) : []);
			setStoredPreviewRows(await readStoredNoteImagePreviewRows(props.docId));
		} finally {
			setLoading(false);
		}
	}, [props.authUserId, props.docId]);

	React.useEffect(() => {
		void refresh();
	}, [refresh]);

	React.useEffect(() => {
		const nextItems = queuedImages.map((row) => ({
			...row,
			previewUrl: URL.createObjectURL(row.blob as Blob),
		}));
		setLocalPreviewItems(nextItems);
		return () => {
			for (const item of nextItems) {
				URL.revokeObjectURL(item.previewUrl);
			}
		};
	}, [queuedImages]);

	React.useEffect(() => {
		const eventName = getNoteMediaChangedEventName();
		const onChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string }>).detail;
			if (!detail?.docId || detail.docId === props.docId) {
				void refresh();
			}
		};
		const onOnline = (): void => {
			if (props.authUserId) {
				void flushQueuedNoteImages(props.authUserId);
			}
			void refresh();
		};
		window.addEventListener(eventName, onChanged as EventListener);
		window.addEventListener('online', onOnline);
		return () => {
			window.removeEventListener(eventName, onChanged as EventListener);
			window.removeEventListener('online', onOnline);
		};
	}, [props.authUserId, props.docId, refresh]);

	const visibleRemoteImages = React.useMemo(
		() => filterRemoteNoteImagesByPendingDeletes(remoteImages, queuedDeletions),
		[queuedDeletions, remoteImages]
	);
	const storedPreviewByRemoteId = React.useMemo(() => {
		const entries = storedPreviewRows
			.filter((row) => row.kind === 'remote' && row.remoteImageId)
			.map((row) => [row.remoteImageId as string, row] as const);
		return new Map(entries);
	}, [storedPreviewRows]);
	const queuedCount = localPreviewItems.length;
	const queuedDeleteCount = queuedDeletions.length;
	const totalCount = visibleRemoteImages.length + queuedCount;
	const failedCount = localPreviewItems.filter((item) => item.syncStatus === 'failed').length;

	const handleDeleteRemote = React.useCallback(async (image: NoteImageRecord) => {
		if (!props.canEdit) return;
		if (typeof window !== 'undefined' && !window.confirm(t('media.deleteConfirm'))) return;
		if (isOffline()) {
			if (!props.authUserId) return;
			await queueRemoteNoteImageDeletion({ userId: props.authUserId, docId: props.docId, imageId: image.id });
			setViewerState((current) => {
				if (!current) return null;
				const remainingItems = current.items.filter((item) => item.src !== image.originalUrl);
				if (remainingItems.length === 0) return null;
				return {
					items: remainingItems,
					index: Math.max(0, Math.min(current.index, remainingItems.length - 1)),
				};
			});
			await refresh();
			return;
		}
		setDeletingId(image.id);
		setError(null);
		try {
			await deleteNoteImage(image.id);
			emitNoteMediaChanged(props.docId);
			setViewerState((current) => {
				if (!current) return null;
				const remainingItems = current.items.filter((item) => item.src !== image.originalUrl);
				if (remainingItems.length === 0) return null;
				return {
					items: remainingItems,
					index: Math.max(0, Math.min(current.index, remainingItems.length - 1)),
				};
			});
			await refresh();
		} catch (nextError) {
			const message = nextError instanceof Error ? nextError.message : t('media.deleteFailed');
			if (props.authUserId && /fetch|network|failed/i.test(message)) {
				await queueRemoteNoteImageDeletion({ userId: props.authUserId, docId: props.docId, imageId: image.id });
				setViewerState((current) => (current?.src === image.originalUrl ? null : current));
				await refresh();
				return;
			}
			setError(message);
		} finally {
			setDeletingId(null);
		}
	}, [props.authUserId, props.canEdit, props.docId, refresh, t]);

	const handleDeleteQueued = React.useCallback(async (row: LocalPreviewItem) => {
		if (!props.canEdit) return;
		if (typeof window !== 'undefined' && !window.confirm(t('media.removeQueuedConfirm'))) return;
		await deleteQueuedNoteImage(row.id);
		setViewerState((current) => {
			if (!current) return null;
			const remainingItems = current.items.filter((item) => item.src !== row.previewUrl);
			if (remainingItems.length === 0) return null;
			return {
				items: remainingItems,
				index: Math.max(0, Math.min(current.index, remainingItems.length - 1)),
			};
		});
		await refresh();
	}, [props.canEdit, refresh, t]);

	const handleRetry = React.useCallback(async () => {
		if (!props.authUserId) return;
		setError(null);
		await flushQueuedNoteImages(props.authUserId);
		await refresh();
	}, [props.authUserId, refresh]);

	const totalCountLabel = totalCount === 1 ? `${totalCount} ${t('media.imageSingular')} ${t('media.attachedSuffix')}` : `${totalCount} ${t('media.imagePlural')} ${t('media.attachedSuffix')}`;
	const statusLabel = loading
		? t('common.loading')
		: queuedDeleteCount > 0
			? `${queuedDeleteCount} ${queuedDeleteCount === 1 ? t('media.pendingDeletionSingular') : t('media.pendingDeletionPlural')}`
			: queuedCount > 0
				? `${queuedCount} ${queuedCount === 1 ? t('media.pendingUploadSingular') : t('media.pendingUploadPlural')}`
				: t('media.synced');
	const viewerItems = React.useMemo(() => ([
		...localPreviewItems.map((item, index) => ({
			src: item.previewUrl,
			fallbackThumbnailBlob: null,
			thumbnailUrl: null,
			title: item.fileName || `${t('media.queuedImageLabel')} ${index + 1}`,
			subtitle: item.lastError || `${t('media.queuedState')} ${formatRelativeDate(item.createdAt, locale)}`,
			onDelete: props.canEdit ? () => void handleDeleteQueued(item) : undefined,
		})),
		...visibleRemoteImages.map((image, index) => ({
			src: image.originalUrl,
			fallbackThumbnailBlob: storedPreviewByRemoteId.get(image.id)?.thumbnailBlob || null,
			thumbnailUrl: image.thumbnailUrl,
			title: `${t('media.imageLabel')} ${index + 1}`,
			subtitle: image.ocrStatus === 'READY' ? t('media.ocrReady') : `${image.width || '?'} × ${image.height || '?'}`,
			onDelete: props.canEdit ? () => void handleDeleteRemote(image) : undefined,
			deleteDisabled: deletingId === image.id,
		})),
	]), [deletingId, handleDeleteQueued, handleDeleteRemote, locale, localPreviewItems, props.canEdit, storedPreviewByRemoteId, t, visibleRemoteImages]);
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
	const openViewerAtIndex = React.useCallback((index: number): void => {
		setViewerState({ items: viewerItems, index });
	}, [viewerItems]);
	const handleTileTouchStart = React.useCallback((index: number, event: React.TouchEvent<HTMLButtonElement>): void => {
		const touch = event.touches[0];
		if (!touch) return;
		tileTouchStartRef.current = { index, x: touch.clientX, y: touch.clientY };
	}, []);
	const handleTileTouchEnd = React.useCallback((index: number, event: React.TouchEvent<HTMLButtonElement>): void => {
		const start = tileTouchStartRef.current;
		tileTouchStartRef.current = null;
		const touch = event.changedTouches[0];
		if (!start || !touch || start.index !== index) return;
		const dx = touch.clientX - start.x;
		const dy = touch.clientY - start.y;
		if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
		// Mobile browsers often emit a synthetic click after touchend. Track the
		// touch-open so the follow-up click can be ignored instead of reopening or
		// collapsing the panel through competing handlers.
		event.preventDefault();
		event.stopPropagation();
		lastTouchOpenRef.current = { index, at: Date.now() };
		openViewerAtIndex(index);
	}, [openViewerAtIndex]);
	const handleTileClick = React.useCallback((index: number, event: React.MouseEvent<HTMLButtonElement>): void => {
		const lastTouch = lastTouchOpenRef.current;
		if (lastTouch && lastTouch.index === index && Date.now() - lastTouch.at < 800) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		event.stopPropagation();
		openViewerAtIndex(index);
	}, [openViewerAtIndex]);
	const closeViewer = React.useCallback(() => {
		setViewerState(null);
	}, []);
	const showPreviousViewerItem = React.useCallback(() => {
		setViewerState((current) => current ? { ...current, index: Math.max(0, current.index - 1) } : null);
	}, []);
	const showNextViewerItem = React.useCallback(() => {
		setViewerState((current) => current ? { ...current, index: Math.min(current.items.length - 1, current.index + 1) } : null);
	}, []);

	return (
		<>
			<div className={styles.panel}>
				<div className={styles.header}>
					<div>
						<p className={styles.eyebrow}>{t('app.sidebarImages')}</p>
						<p className={styles.summary}>
							{totalCount === 0 ? t('media.summaryEmpty') : totalCountLabel}
						</p>
					</div>
					<div className={styles.toolbar}>
						{failedCount > 0 && props.authUserId ? (
							<button type="button" className={styles.retryButton} onClick={() => void handleRetry()}>
								{t('media.retryUploads')}
							</button>
						) : null}
						{props.canEdit && props.onAddImage ? (
							<button type="button" className={styles.addButton} onClick={props.onAddImage}>
								<FontAwesomeIcon icon={faPlus} />
								<span>{t('noteMenu.addImage')}</span>
							</button>
						) : null}
					</div>
				</div>

				<div className={styles.statusRow}>
					<span>{statusLabel}</span>
					{error ? <p className={styles.error}>{error}</p> : null}
				</div>

				{totalCount === 0 ? (
					<div className={styles.empty}>
						<p className={styles.emptyTitle}>{t('media.emptyTitle')}</p>
						<p className={styles.emptyBody}>{t('media.emptyBody')}</p>
						{props.canEdit && props.onAddImage ? (
							<button type="button" className={styles.addButton} onClick={props.onAddImage}>
								<FontAwesomeIcon icon={faImage} />
								<span>{t('noteMenu.addImage')}</span>
							</button>
						) : null}
					</div>
				) : (
					<div className={styles.grid}>
						{localPreviewItems.map((item, index) => (
							<div
								key={item.id}
								className={styles.tile}
							>
								{props.canEdit ? (
									<button
										type="button"
										className={styles.deleteButton}
										onClick={(event) => {
											event.stopPropagation();
											void handleDeleteQueued(item);
										}}
										aria-label={t('editors.delete')}
									>
										<FontAwesomeIcon icon={faTrash} />
									</button>
								) : null}
								<button
									type="button"
									className={styles.tileActivator}
									onClick={(event) => handleTileClick(index, event)}
									onTouchStart={(event) => handleTileTouchStart(index, event)}
									onTouchEnd={(event) => handleTileTouchEnd(index, event)}
								>
									<div className={styles.thumbWrap}>
										<span className={styles.badge}>{item.syncStatus === 'failed' ? t('media.failedBadge') : t('media.queuedBadge')}</span>
										<img className={styles.thumb} src={item.previewUrl} alt={item.fileName} />
									</div>
									<div className={styles.meta}>
										<span className={styles.title}>{item.fileName || `${t('media.queuedImageLabel')} ${index + 1}`}</span>
										<span className={styles.caption}>{formatBytes(item.byteSize)}</span>
									</div>
								</button>
							</div>
						))}

						{visibleRemoteImages.map((image, index) => (
							<div
								key={image.id}
								className={styles.tile}
							>
								{props.canEdit ? (
									<button
										type="button"
										className={styles.deleteButton}
										onClick={(event) => {
											event.stopPropagation();
											void handleDeleteRemote(image);
										}}
										disabled={deletingId === image.id}
										aria-label={t('editors.delete')}
									>
										<FontAwesomeIcon icon={faTrash} />
									</button>
								) : null}
								<button
									type="button"
									className={styles.tileActivator}
									onClick={(event) => handleTileClick(localPreviewItems.length + index, event)}
									onTouchStart={(event) => handleTileTouchStart(localPreviewItems.length + index, event)}
									onTouchEnd={(event) => handleTileTouchEnd(localPreviewItems.length + index, event)}
								>
									<div className={styles.thumbWrap}>
										<RemoteImageThumb image={image} preview={storedPreviewByRemoteId.get(image.id) || null} alt={`${t('media.imageLabel')} ${index + 1}`} />
									</div>
									<div className={styles.meta}>
										<span className={styles.title}>{t('media.imageLabel')} {index + 1}</span>
										<span className={styles.caption}>{formatRelativeDate(image.createdAt, locale)} · {image.width || '?'} × {image.height || '?'}</span>
									</div>
								</button>
							</div>
						))}
					</div>
				)}
			</div>

			{viewerState ? (
				<NoteImageViewer
					src={viewerState.items[viewerState.index]?.src || ''}
					fallbackThumbnailBlob={viewerState.items[viewerState.index]?.fallbackThumbnailBlob}
					title={viewerState.items[viewerState.index]?.title || ''}
					subtitle={viewerState.items[viewerState.index]?.subtitle}
					onClose={closeViewer}
					onDelete={viewerState.items[viewerState.index]?.onDelete}
					deleteDisabled={viewerState.items[viewerState.index]?.deleteDisabled}
					hasPrevious={viewerState.index > 0}
					hasNext={viewerState.index < viewerState.items.length - 1}
					onPrevious={showPreviousViewerItem}
					onNext={showNextViewerItem}
				/>
			) : null}
		</>
	);
}