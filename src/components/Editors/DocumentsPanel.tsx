import React from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowUpRightFromSquare, faFileLines, faPlus, faTrash, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import { useI18n } from '../../core/i18n';
import { deleteNoteDocument, type NoteDocumentRecord } from '../../core/noteDocumentApi';
import { PdfDocumentViewer } from '../NoteDocuments/PdfDocumentViewer';
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
};

type DocumentViewerProps = {
	document: NoteDocumentRecord;
	authUserId?: string | null;
	canEdit?: boolean;
	onClose: () => void;
};

type DocumentViewerMode = 'preview' | 'text';

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
	useBodyScrollLock(true);
	// PDFs get the full embedded viewer. Other documents reuse either a generated HTML
	// viewer or the extracted-text fallback so the modal always has something useful.
	const canEmbedPdf = props.document.mimeType === 'application/pdf';
	const hasTextPreview = props.document.ocrText.trim().length > 0;
	const hasDocumentViewer = !canEmbedPdf && Boolean(props.document.viewerUrl);
	const [viewerMode, setViewerMode] = React.useState<DocumentViewerMode>('preview');
	const showPdfCanvas = canEmbedPdf && viewerMode === 'preview';
	const useFullBleedContent = showPdfCanvas;

	React.useEffect(() => {
		// Reset the active tab whenever a different document opens so the modal does not
		// inherit a stale text/preview mode from the previous item.
		setViewerMode('preview');
	}, [props.document.id]);

	const content = (
		<div className={styles.viewerBackdrop} role="presentation">
			<section className={styles.viewerDialog} role="dialog" aria-modal="true" aria-label={props.document.fileName} onClick={(event) => event.stopPropagation()}>
				<header className={styles.viewerHeader}>
					<div>
						<h3 className={styles.viewerTitle}>{props.document.fileName}</h3>
						<p className={styles.viewerMeta}>{props.document.fileExtension.toUpperCase()} · {formatBytes(props.document.byteSize)}</p>
					</div>
					<div className={styles.viewerActions}>
						<a className={styles.viewerLinkButton} href={props.document.originalUrl} target="_blank" rel="noreferrer noopener">
							<FontAwesomeIcon icon={faArrowUpRightFromSquare} />
							<span>{t('documents.openOriginal')}</span>
						</a>
						<button type="button" className={styles.viewerCloseButton} onClick={props.onClose} aria-label={t('common.close')}>
							<FontAwesomeIcon icon={faXmark} />
						</button>
					</div>
				</header>
				<div className={styles.viewerToolbar}>
					<div className={styles.viewerModeTabs} role="tablist" aria-label={t('documents.previewModes')}>
						<button
							type="button"
							role="tab"
							aria-selected={viewerMode === 'preview'}
							className={`${styles.viewerModeButton}${viewerMode === 'preview' ? ` ${styles.viewerModeButtonActive}` : ''}`}
							onClick={() => setViewerMode('preview')}
						>
							{t('documents.previewTab')}
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={viewerMode === 'text'}
							className={`${styles.viewerModeButton}${viewerMode === 'text' ? ` ${styles.viewerModeButtonActive}` : ''}`}
							onClick={() => setViewerMode('text')}
							disabled={!hasTextPreview}
						>
							{t('documents.textTab')}
						</button>
					</div>
					<p className={styles.viewerModeHint}>
						{viewerMode === 'preview'
							? (canEmbedPdf ? t('documents.previewPdfHint') : t('documents.previewDocumentHint'))
							: t('documents.previewTextHint')}
					</p>
				</div>
				<div className={`${styles.viewerBody}${useFullBleedContent ? ` ${styles.viewerBodyFullBleed}` : ''}`}>
					{useFullBleedContent ? null : (
					<div className={styles.viewerPreviewColumn}>
						<img className={styles.viewerPreviewImage} src={props.document.previewUrl} alt="" />
						<div className={styles.viewerPreviewMeta}>
							<p className={styles.viewerMetaRow}>{props.document.fileExtension.toUpperCase()} · {formatBytes(props.document.byteSize)}</p>
							{props.document.syncStatus && props.document.syncStatus !== 'synced' ? (
								<p className={styles.viewerMetaRow}>{props.document.syncStatus === 'failed' ? t('documents.failedBadge') : t('documents.queuedBadge')}</p>
							) : null}
							{props.document.pageCount ? <p className={styles.viewerMetaRow}>{props.document.pageCount} {props.document.pageCount === 1 ? t('documents.pageSingular') : t('documents.pagePlural')}</p> : null}
						</div>
					</div>
					)}
					<div className={`${styles.viewerContentColumn}${useFullBleedContent ? ` ${styles.viewerContentColumnFullBleed}` : ''}`}>
						{viewerMode === 'preview' ? (
							canEmbedPdf ? (
								<PdfDocumentViewer document={props.document} authUserId={props.authUserId} canEdit={props.canEdit} />
							) : hasDocumentViewer ? (
								<iframe className={styles.viewerFrame} src={props.document.viewerUrl} title={props.document.fileName} />
							) : (
								<div className={styles.viewerDocumentPreview}>
									<img className={styles.viewerDocumentPreviewImage} src={props.document.previewUrl} alt="" />
								</div>
							)
						) : hasTextPreview ? (
							<div className={styles.viewerText}>
								{props.document.ocrText}
							</div>
						) : (
							<div className={styles.viewerEmpty}>
								<p className={styles.viewerEmptyTitle}>{t('documents.previewUnavailable')}</p>
								<p className={styles.viewerEmptyBody}>{t('documents.openOriginalHint')}</p>
							</div>
						)}
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

	const refresh = React.useCallback(async () => {
		if (!docId) {
			setDocuments([]);
			return;
		}
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
	}, [docId, props.authUserId, t]);

	React.useEffect(() => {
		void refresh();
	}, [refresh]);

	React.useEffect(() => {
		const eventName = getNoteDocumentsChangedEventName();
		const onChanged = (event: Event): void => {
			const changedDocId = (event as CustomEvent<{ docId?: string }>).detail?.docId;
			if (!changedDocId || changedDocId === docId) {
				void refresh();
			}
		};
		window.addEventListener(eventName, onChanged as EventListener);
		return () => window.removeEventListener(eventName, onChanged as EventListener);
	}, [docId, refresh]);

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
			{viewerDocument ? <DocumentViewer document={viewerDocument} authUserId={props.authUserId} canEdit={canEdit} onClose={() => setViewerDocument(null)} /> : null}
		</>
	);
}