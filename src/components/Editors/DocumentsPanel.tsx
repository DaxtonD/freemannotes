import React from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowUpRightFromSquare, faFileLines, faPlus, faTrash, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import { useI18n } from '../../core/i18n';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import { deleteNoteDocument, type NoteDocumentRecord } from '../../core/noteDocumentApi';
import { NoteDocumentViewer } from '../NoteDocuments/NoteDocumentViewer';
import {
	deleteQueuedNoteDocument,
	emitNoteDocumentsChanged,
	getCachedNoteDocuments,
	getNoteDocumentsChangedEventName,
	refreshRemoteNoteDocuments,
	scheduleQueuedNoteDocumentFlush,
} from '../../core/noteDocumentStore';
import styles from './DocumentsPanel.module.css';

type DocumentsPanelProps = {
	docId?: string | null;
	authUserId?: string | null;
	canEdit?: boolean;
	onAddDocument?: (() => void) | undefined;
	showComingSoonPlaceholder?: boolean;
};

type DocumentViewerProps = {
	document: NoteDocumentRecord;
	onClose: () => void;
};

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function summarizeDocument(document: NoteDocumentRecord, t: (key: string) => string): string {
	const summary = String(document.ocrText || '').trim();
	if (summary) return summary.split(/\s+/).slice(0, 26).join(' ');
	if (document.ocrStatus === 'FAILED') return t('documents.previewUnavailable');
	return t('documents.processing');
}

function DocumentViewer(props: DocumentViewerProps): React.JSX.Element {
	const { t } = useI18n();
	const isCoarsePointer = useIsCoarsePointer();
	const [resolvedDocumentUrl, setResolvedDocumentUrl] = React.useState<string | null>(null);
	useBodyScrollLock(true, { disableTouchAction: false });
	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		window.dispatchEvent(new CustomEvent('freemannotes:document-viewer-state', { detail: { open: true } }));
		return () => {
			window.dispatchEvent(new CustomEvent('freemannotes:document-viewer-state', { detail: { open: false } }));
		};
	}, []);

	const content = (
		<div
			className={styles.viewerBackdrop}
			role="presentation"
			onPointerDown={(event) => {
				// Close only on direct mouse clicks on the backdrop itself.
				// Excludes touch/pen so swipe gestures and pinch-to-zoom on
				// mobile never accidentally close the viewer.
				if (event.pointerType === 'mouse' && event.target === event.currentTarget) {
					props.onClose();
				}
			}}
			onTouchMove={(event) => {
				// Prevent touch-move on the backdrop from reaching the browser
				// (which would trigger overscroll / swipe-back navigation).
				// The dialog's own touch-action CSS allows normal interaction
				// inside the viewer content.
				if (event.target === event.currentTarget) {
					event.preventDefault();
				}
			}}
		>
			<section
				className={styles.viewerDialog}
				role="dialog"
				aria-modal="true"
				aria-label={props.document.fileName}
				onClick={(event) => event.stopPropagation()}
			>
				<header className={`${styles.viewerHeader}${isCoarsePointer ? ` ${styles.viewerHeaderCompact}` : ''}`}>
					<div className={`${styles.viewerHeaderCopy}${isCoarsePointer ? ` ${styles.viewerHeaderCopyCompact}` : ''}`}>
						<h3 className={styles.viewerTitle}>{props.document.fileName}</h3>
					</div>
					<div className={`${styles.viewerActions}${isCoarsePointer ? ` ${styles.viewerActionsCompact}` : ''}`}>
						<a className={`${styles.viewerLinkButton}${isCoarsePointer ? ` ${styles.viewerLinkButtonCompact}` : ''}`} href={resolvedDocumentUrl || props.document.originalUrl} target="_blank" rel="noreferrer noopener" aria-label={t('documents.openOriginal')}>
							<FontAwesomeIcon icon={faArrowUpRightFromSquare} />
							{isCoarsePointer ? null : <span>{t('documents.openOriginal')}</span>}
						</a>
						<button type="button" className={styles.viewerCloseButton} onClick={props.onClose} aria-label={t('common.close')}>
							<FontAwesomeIcon icon={faXmark} />
						</button>
					</div>
				</header>
				<div className={styles.viewerBody}>
					<div className={styles.viewerContentColumn}>
						<NoteDocumentViewer document={props.document} onResolvedDocumentUrlChange={setResolvedDocumentUrl} />
					</div>
				</div>
			</section>
		</div>
	);

	return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}

export function DocumentsPanel(props: DocumentsPanelProps): React.JSX.Element {
	const { t } = useI18n();
	const canEdit = props.canEdit === true;
	const docId = String(props.docId || '').trim();
	const [documents, setDocuments] = React.useState<readonly NoteDocumentRecord[]>(() => docId ? getCachedNoteDocuments(docId) : []);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [viewerDocument, setViewerDocument] = React.useState<NoteDocumentRecord | null>(null);
	const [deletingId, setDeletingId] = React.useState<string | null>(null);
	const isViewerOpen = viewerDocument != null;

	const refresh = React.useCallback(async () => {
		if (!docId) {
			setDocuments([]);
			return;
		}
		if (isViewerOpen) return;
		setLoading(true);
		setError(null);
		try {
			// Refresh the server view but keep cached documents as fallback so offline-opened
			// modals still render immediately after a failed network round-trip.
			setDocuments(await refreshRemoteNoteDocuments(docId, { userId: props.authUserId }));
		} catch (nextError) {
			setError(nextError instanceof Error ? nextError.message : t('documents.loadFailed'));
			setDocuments(getCachedNoteDocuments(docId));
		} finally {
			setLoading(false);
		}
	}, [docId, isViewerOpen, props.authUserId, t]);

	React.useEffect(() => {
		if (isViewerOpen) return;
		void refresh();
	}, [isViewerOpen, refresh]);

	React.useEffect(() => {
		if (isViewerOpen) return;
		const eventName = getNoteDocumentsChangedEventName();
		const onChanged = (event: Event): void => {
			const changedDocId = (event as CustomEvent<{ docId?: string }>).detail?.docId;
			if (!changedDocId || changedDocId === docId) {
				void refresh();
			}
		};
		window.addEventListener(eventName, onChanged as EventListener);
		return () => window.removeEventListener(eventName, onChanged as EventListener);
	}, [docId, isViewerOpen, refresh]);

	const failedCount = documents.filter((document) => document.isLocal && document.syncStatus === 'failed').length;

	const handleDeleteDocument = React.useCallback(async (document: NoteDocumentRecord): Promise<void> => {
		if (!canEdit) return;
		if (typeof window !== 'undefined' && !window.confirm(t('documents.deleteConfirm'))) return;
		setDeletingId(document.id);
		setError(null);
		try {
			if (document.isLocal) {
				await deleteQueuedNoteDocument(document.id);
			} else {
				await deleteNoteDocument(document.id);
			}
			emitNoteDocumentsChanged(document.docId);
			setViewerDocument((current) => current?.id === document.id ? null : current);
			await refresh();
		} catch (nextError) {
			setError(nextError instanceof Error ? nextError.message : t('documents.deleteFailed'));
		} finally {
			setDeletingId(null);
		}
	}, [canEdit, refresh, t]);

	if (props.showComingSoonPlaceholder) {
		return (
			<section className={styles.panel} aria-label={t('editors.mediaTabDocuments')}>
				<div className={styles.header}>
					<div>
						<p className={styles.eyebrow}>{t('editors.mediaTabDocuments')}</p>
						<p className={styles.summary}>{t('documents.comingSoonTitle')}</p>
					</div>
				</div>
				<div className={styles.comingSoonCard}>
					<p className={styles.placeholderTitle}>{t('documents.comingSoonTitle')}</p>
					<p className={styles.placeholderBody}>{t('documents.comingSoonBody')}</p>
				</div>
			</section>
		);
	}

	if (!docId) {
		return (
			<div className={styles.placeholderCard}>
				<p className={styles.placeholderTitle}>{t('documents.emptyTitle')}</p>
				<p className={styles.placeholderBody}>{t('documents.emptyBody')}</p>
			</div>
		);
	}

	const summaryLabel = documents.length === 1 ? `1 ${t('documents.itemSingular')}` : `${documents.length} ${t('documents.itemPlural')}`;

	return (
		<>
			<section className={styles.panel} aria-label={t('editors.mediaTabDocuments')}>
				<div className={styles.header}>
					<div>
						<p className={styles.eyebrow}>{t('editors.mediaTabDocuments')}</p>
						<p className={styles.summary}>{documents.length === 0 ? t('documents.emptyTitle') : summaryLabel}</p>
					</div>
					<div className={styles.toolbar}>
						{failedCount > 0 && props.authUserId ? (
							<button type="button" className={styles.retryButton} onClick={() => void scheduleQueuedNoteDocumentFlush(props.authUserId || '')}>
								{t('documents.retryUploads')}
							</button>
						) : null}
						{loading ? <span className={styles.status}>{t('common.loading')}</span> : null}
						{canEdit && props.onAddDocument ? (
							<button type="button" className={styles.addButton} onClick={props.onAddDocument}>
								<FontAwesomeIcon icon={faPlus} />
								<span>{t('documents.addButton')}</span>
							</button>
						) : null}
					</div>
				</div>
				{error ? <p className={styles.error}>{error}</p> : null}
				{documents.length === 0 ? null : (
					<div className={styles.list}>
						{documents.map((document) => (
							<div key={document.id} className={styles.card}>
								{canEdit ? (
									<button
										type="button"
										className={styles.deleteButton}
										onClick={(event) => {
											event.stopPropagation();
											void handleDeleteDocument(document);
										}}
										disabled={deletingId === document.id}
										aria-label={t('documents.delete')}
									>
										<FontAwesomeIcon icon={faTrash} />
									</button>
								) : null}
								<button type="button" className={styles.cardButton} onClick={() => setViewerDocument(document)}>
									<img className={styles.thumbnail} src={document.thumbnailUrl || document.previewUrl} alt="" />
									<div className={styles.copy}>
										<p className={styles.title}>{document.fileName}</p>
										<p className={styles.description}>{summarizeDocument(document, t)}</p>
										<p className={styles.meta}>{document.fileExtension.toUpperCase()} · {formatBytes(document.byteSize)}</p>
										{document.syncStatus && document.syncStatus !== 'synced' ? (
											<span className={styles.badge}>{document.syncStatus === 'failed' ? t('documents.failedBadge') : t('documents.queuedBadge')}</span>
										) : null}
									</div>
								</button>
							</div>
						))}
					</div>
				)}
			</section>
			{viewerDocument ? <DocumentViewer document={viewerDocument} onClose={() => setViewerDocument(null)} /> : null}
		</>
	);
}