import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faImage, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import { getConnectionQuality, subscribeConnectionQualityChange } from '../../core/networkQuality';
import { deleteNoteImage, type NoteImageRecord } from '../../core/noteMediaApi';
import {
	deleteQueuedNoteImage,
	emitNoteMediaChanged,
	filterQueuedUploadsNotYetRemote,
	filterRemoteNoteImagesByPendingDeletes,
	getCachedRemoteNoteImages,
	getNoteMediaChangedEventName,
	readStoredNoteImagePreviewRows,
	readStoredRemoteNoteImages,
	readQueuedNoteImages,
	readQueuedNoteImageDeletions,
	refreshRemoteNoteImages,
	queueRemoteNoteImageDeletion,
	scheduleQueuedNoteImageFlush,
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
	/** When true, skip server-side API calls — the note hasn't been persisted yet. */
	isPendingNew?: boolean;
	showEyebrow?: boolean;
};

type LocalPreviewItem = QueuedNoteImageRow & {
	previewUrl: string | null;
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

function getDisplayImageTitle(fileName: string | null | undefined, fallback: string): string {
	const trimmed = String(fileName || '').trim();
	if (!trimmed) return fallback;
	return trimmed.replace(/\.[^.]+$/, '') || fallback;
}

export function NoteMediaPanel(props: NoteMediaPanelProps): React.JSX.Element {
	const { t, locale } = useI18n();
	const showEyebrow = props.showEyebrow !== false;
	const [remoteImages, setRemoteImages] = React.useState<readonly NoteImageRecord[]>(() => getCachedRemoteNoteImages(props.docId));
	const [queuedImages, setQueuedImages] = React.useState<readonly QueuedNoteImageRow[]>([]);
	const [queuedDeletions, setQueuedDeletions] = React.useState<readonly QueuedNoteImageRow[]>([]);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [deletingId, setDeletingId] = React.useState<string | null>(null);
	const [viewerState, setViewerState] = React.useState<ViewerState | null>(null);
	const [localPreviewItems, setLocalPreviewItems] = React.useState<readonly LocalPreviewItem[]>([]);
	const [storedPreviewRows, setStoredPreviewRows] = React.useState<readonly StoredNoteImagePreviewRecord[]>([]);
	const newestQueuedTileRef = React.useRef<HTMLDivElement | null>(null);
	const previousQueuedCountRef = React.useRef(0);
	// Suppress the queued-tile scrollIntoView for 500ms after the panel first mounts
	// or its docId changes. Without this guard, the initial IDB hydration of queued images
	// fires scrollIntoView on the tile (which is inside the peek-position media sheet), and
	// the browser tries to scroll the nearest scrollable ancestor to bring the hidden tile
	// into view. This nudges the visual viewport or the editor scroll container, causing
	// the media sheet to appear to slide upward and then close without user interaction.
	const skipQueuedScrollUntilRef = React.useRef<number>(
		typeof performance !== 'undefined' ? performance.now() + 500 : Date.now() + 500
	);
	const tileTouchStartRef = React.useRef<{ index: number; x: number; y: number } | null>(null);
	const lastTouchOpenRef = React.useRef<{ index: number; at: number } | null>(null);
	const deleteTouchHandledRef = React.useRef<{ id: string; at: number } | null>(null);

	const refresh = React.useCallback(async (options?: { silent?: boolean }) => {
		if (!options?.silent) setLoading(true);
		setError(null);
		try {
			const loadRemoteImages = async (): Promise<readonly NoteImageRecord[]> => {
				// Unsaved notes are not in registry yet, so `/api/note-media` can 403/404
				// even after a successful upload. Keep showing local cache + IDB previews
				// until the note is published on Save.
				if (props.isPendingNew) {
					const cached = getCachedRemoteNoteImages(props.docId);
					if (cached.length > 0) return cached;
					const stored = await readStoredRemoteNoteImages(props.docId);
					return stored.length > 0 ? stored : cached;
				}
				return refreshRemoteNoteImages(props.docId).catch(async () => {
					const stored = await readStoredRemoteNoteImages(props.docId);
					return stored.length > 0 ? stored : getCachedRemoteNoteImages(props.docId);
				});
			};
			const [remoteImages, queuedResponse, queuedDeleteResponse, previewRows] = await Promise.all([
				loadRemoteImages(),
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
	}, [props.authUserId, props.docId, props.isPendingNew]);

	React.useEffect(() => {
		void refresh();
	}, [refresh]);

	React.useEffect(() => {
		const objectUrls: string[] = [];
		// Index queued preview rows by queue row id so we can fall back to the IDB
		// thumbnail blob when the in-memory row.blob has been cleared (e.g. after
		// the app warm-loaded from IDB without re-reading the original file).
		const previewByQueuedId = new Map(
			storedPreviewRows
				.filter((r) => r.kind === 'queued')
				.map((r) => [r.id, r])
		);
		const nextItems = queuedImages.map((row) => {
			if (row.blob instanceof Blob) {
				const previewUrl = URL.createObjectURL(row.blob);
				objectUrls.push(previewUrl);
				return { ...row, previewUrl };
			}
			const previewRow = previewByQueuedId.get(row.id);
			if (previewRow?.thumbnailBlob instanceof Blob) {
				const previewUrl = URL.createObjectURL(previewRow.thumbnailBlob);
				objectUrls.push(previewUrl);
				return { ...row, previewUrl };
			}
			return {
				...row,
				previewUrl: typeof row.sourceUrl === 'string' && row.sourceUrl.trim().length > 0 ? row.sourceUrl.trim() : null,
			};
		});
		setLocalPreviewItems(nextItems);
		return () => {
			for (const previewUrl of objectUrls) {
				URL.revokeObjectURL(previewUrl);
			}
		};
	}, [queuedImages, storedPreviewRows]);

	// Reset the scroll-suppress window whenever the panel switches to a different note.
	React.useEffect(() => {
		skipQueuedScrollUntilRef.current = (
			typeof performance !== 'undefined' ? performance.now() : Date.now()
		) + 500;
	}, [props.docId]);

	React.useEffect(() => {
		if (localPreviewItems.length > previousQueuedCountRef.current) {
			const isSuppressed = typeof performance !== 'undefined'
				? performance.now() < skipQueuedScrollUntilRef.current
				: false;
			if (!isSuppressed) {
				newestQueuedTileRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
			}
		}
		previousQueuedCountRef.current = localPreviewItems.length;
	}, [localPreviewItems]);

	React.useEffect(() => {
		const eventName = getNoteMediaChangedEventName();
		const onChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string }>).detail;
			if (!detail?.docId || detail.docId === props.docId) {
				// Silent refresh avoids the Loading flicker on every media sync event.
				void refresh({ silent: true });
			}
		};
		const onOnline = (): void => {
			if (props.authUserId) {
				// Use debounced scheduler so a burst of online events coalesces into one flush.
				void scheduleQueuedNoteImageFlush(props.authUserId);
			}
			void refresh();
		};
		window.addEventListener(eventName, onChanged as EventListener);
		window.addEventListener('online', onOnline);
		const unsubscribeConnection = subscribeConnectionQualityChange(() => {
			const quality = getConnectionQuality();
			if (quality !== 'offline' && props.authUserId) {
				void scheduleQueuedNoteImageFlush(props.authUserId);
			}
			void refresh({ silent: true });
		});
		return () => {
			window.removeEventListener(eventName, onChanged as EventListener);
			window.removeEventListener('online', onOnline);
			unsubscribeConnection();
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
	const storedPreviewByQueuedId = React.useMemo(() => {
		const entries = storedPreviewRows
			.filter((row) => row.kind === 'queued')
			.map((row) => [row.id, row] as const);
		return new Map(entries);
	}, [storedPreviewRows]);
	// Exclude queued rows already present in the remote list (deduplication for the
	// case where the upload completed but the queue entry hasn't been cleaned up yet).
	const activeQueuedImages = React.useMemo(
		() => filterQueuedUploadsNotYetRemote(queuedImages, visibleRemoteImages),
		[queuedImages, visibleRemoteImages]
	);
	const queuedCount = activeQueuedImages.length;
	const queuedDeleteCount = queuedDeletions.length;
	const totalCount = visibleRemoteImages.length + queuedCount;
	const failedCount = localPreviewItems.filter(
		(item) => item.syncStatus === 'failed' && activeQueuedImages.some((q) => q.id === item.id)
	).length;

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
				setViewerState((current) => (current?.items[current.index]?.src === image.originalUrl ? null : current));
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

	const handleDeleteButtonTouch = React.useCallback((id: string, event: React.TouchEvent<HTMLButtonElement>, remove: () => void): void => {
		event.preventDefault();
		event.stopPropagation();
		deleteTouchHandledRef.current = { id, at: Date.now() };
		remove();
	}, []);

	const handleDeleteButtonClick = React.useCallback((id: string, event: React.MouseEvent<HTMLButtonElement>, remove: () => void): void => {
		const lastTouch = deleteTouchHandledRef.current;
		if (lastTouch && lastTouch.id === id && Date.now() - lastTouch.at < 800) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		event.stopPropagation();
		remove();
	}, []);

	const handleRetry = React.useCallback(async () => {
		if (!props.authUserId) return;
		setError(null);
		await scheduleQueuedNoteImageFlush(props.authUserId);
		await refresh();
	}, [props.authUserId, refresh]);

	const totalCountLabel = totalCount === 1 ? `${totalCount} ${t('media.imageSingular')} ${t('media.attachedSuffix')}` : `${totalCount} ${t('media.imagePlural')} ${t('media.attachedSuffix')}`;
	const statusLabel = loading
		? t('common.loading')
		: queuedDeleteCount > 0
			? `${queuedDeleteCount} ${queuedDeleteCount === 1 ? t('media.pendingDeletionSingular') : t('media.pendingDeletionPlural')}`
			: queuedCount > 0
				? `${queuedCount} ${queuedCount === 1 ? t('media.pendingUploadSingular') : t('media.pendingUploadPlural')}`
				: null;
	const viewerItems = React.useMemo(() => ([
		...visibleRemoteImages.map((image, index) => ({
			src: image.originalUrl,
			fallbackThumbnailBlob: storedPreviewByRemoteId.get(image.id)?.thumbnailBlob || null,
			thumbnailUrl: image.thumbnailUrl,
			title: image.fileName ? image.fileName.replace(/\.[^.]+$/, '') : `${t('media.imageLabel')} ${index + 1}`,
			subtitle: image.ocrStatus === 'READY' ? t('media.ocrReady') : `${image.width || '?'} × ${image.height || '?'}`,
			onDelete: props.canEdit ? () => void handleDeleteRemote(image) : undefined,
			deleteDisabled: deletingId === image.id,
		})),
		...localPreviewItems.map((item, index) => ({
			src: item.previewUrl || item.sourceUrl || '',
			// Provide the raw blob as a fallback so the viewer can render the image
			// even when offline (useResolvedNoteImageSource will create an objectUrl).
			fallbackThumbnailBlob: item.blob instanceof Blob
				? item.blob
				: storedPreviewByQueuedId.get(item.id)?.thumbnailBlob || null,
			thumbnailUrl: null,
			title: item.fileName
				? item.fileName.replace(/\.[^.]+$/, '')
				: item.sourceUrl
					? item.sourceUrl.replace(/^https?:\/\//i, '')
					: `${t('media.queuedImageLabel')} ${index + 1}`,
			subtitle: item.lastError || `${t('media.queuedState')} ${formatRelativeDate(item.createdAt, locale)}`,
			onDelete: props.canEdit ? () => void handleDeleteQueued(item) : undefined,
		})),
	]), [deletingId, handleDeleteQueued, handleDeleteRemote, locale, localPreviewItems, props.canEdit, storedPreviewByQueuedId, storedPreviewByRemoteId, t, visibleRemoteImages]);
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
						{showEyebrow ? <p className={styles.eyebrow}>{t('app.sidebarImages')}</p> : null}
						<p className={`${styles.summary}${showEyebrow ? '' : ` ${styles.summaryWithoutEyebrow}`}`}>
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
							<button
								type="button"
								className={styles.addButton}
								onPointerDown={(event) => event.stopPropagation()}
								onTouchStart={(event) => event.stopPropagation()}
								onTouchEnd={(event) => {
									event.preventDefault();
									event.stopPropagation();
									props.onAddImage?.();
								}}
								onClick={(event) => {
									event.stopPropagation();
									props.onAddImage?.();
								}}
							>
								<FontAwesomeIcon icon={faPlus} />
								<span>{t('noteMenu.addImage')}</span>
							</button>
						) : null}
					</div>
				</div>

				{statusLabel || error ? (
					<div className={styles.statusRow}>
						{statusLabel ? <span>{statusLabel}</span> : null}
						{error ? <p className={styles.error}>{error}</p> : null}
					</div>
				) : null}

				{totalCount === 0 ? null : (
					<div className={styles.grid}>
						{visibleRemoteImages.map((image, index) => (
							<div
								key={image.id}
								className={styles.tile}
							>
								{props.canEdit ? (
									<button
										type="button"
										className={styles.deleteButton}
										onPointerDown={(event) => event.stopPropagation()}
										onTouchStart={(event) => event.stopPropagation()}
										onTouchEnd={(event) => handleDeleteButtonTouch(image.id, event, () => void handleDeleteRemote(image))}
										onClick={(event) => handleDeleteButtonClick(image.id, event, () => void handleDeleteRemote(image))}
										disabled={deletingId === image.id}
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
										<RemoteImageThumb image={image} preview={storedPreviewByRemoteId.get(image.id) || null} alt={getDisplayImageTitle(image.fileName, `${t('media.imageLabel')} ${index + 1}`)} />
									</div>
									<div className={styles.meta}>
										<span className={styles.title}>{getDisplayImageTitle(image.fileName, `${t('media.imageLabel')} ${index + 1}`)}</span>
										<span className={styles.caption}>{formatRelativeDate(image.createdAt, locale)} · {image.width || '?'} × {image.height || '?'}</span>
									</div>
								</button>
							</div>
						))}

						{localPreviewItems.map((item, index) => (
							<div
								key={item.id}
								ref={index === localPreviewItems.length - 1 ? newestQueuedTileRef : null}
								className={styles.tile}
							>
								{props.canEdit ? (
									<button
										type="button"
										className={styles.deleteButton}
										onPointerDown={(event) => event.stopPropagation()}
										onTouchStart={(event) => event.stopPropagation()}
										onTouchEnd={(event) => handleDeleteButtonTouch(item.id, event, () => void handleDeleteQueued(item))}
										onClick={(event) => handleDeleteButtonClick(item.id, event, () => void handleDeleteQueued(item))}
										aria-label={t('editors.delete')}
									>
										<FontAwesomeIcon icon={faTrash} />
									</button>
								) : null}
								<button
									type="button"
									className={styles.tileActivator}
									onClick={(event) => handleTileClick(visibleRemoteImages.length + index, event)}
									onTouchStart={(event) => handleTileTouchStart(visibleRemoteImages.length + index, event)}
									onTouchEnd={(event) => handleTileTouchEnd(visibleRemoteImages.length + index, event)}
								>
									<div className={styles.thumbWrap}>
										<span className={styles.badge}>{item.syncStatus === 'failed' ? t('media.failedBadge') : t('media.queuedBadge')}</span>
										{item.previewUrl ? (
											<img className={styles.thumb} src={item.previewUrl} alt={item.fileName ?? item.sourceUrl ?? ''} />
										) : (
											<div className={`${styles.thumb} ${styles.thumbPlaceholder}`} aria-hidden="true">
												<FontAwesomeIcon icon={faImage} />
											</div>
										)}
									</div>
									<div className={styles.meta}>
										<span className={styles.title}>{item.fileName ? getDisplayImageTitle(item.fileName, `${t('media.queuedImageLabel')} ${index + 1}`) : (item.sourceUrl ? item.sourceUrl.replace(/^https?:\/\//i, '') : `${t('media.queuedImageLabel')} ${index + 1}`)}</span>
										<span className={styles.caption}>{formatBytes(item.byteSize)}</span>
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
					thumbnailUrl={viewerState.items[viewerState.index]?.thumbnailUrl || null}
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