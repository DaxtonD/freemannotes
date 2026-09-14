import React from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faDownload, faListUl, faPlus, faRotateRight, faTableCellsLarge, faTrash } from '@fortawesome/free-solid-svg-icons';
import type { NoteDocumentRecord } from '../../core/noteDocumentApi';
import { useI18n } from '../../core/i18n';
import { getDocumentConversionEnabled } from '../../core/instanceConfig';
import { PANEL_VIEW_MODE_STORAGE_KEYS, usePanelViewMode } from '../../core/panelViewMode';
import { DocumentTextViewer } from './DocumentTextViewer';
import {
	NOTE_DOCUMENT_ACCEPT,
	NOTE_DOCUMENT_MAX_FILE_BYTES,
	getCachedNoteDocuments,
	getNoteDocumentExtension,
	getNoteDocumentsChangedEventName,
	isSupportedNoteDocumentFile,
	queueNoteDocumentDeletion,
	queueNoteDocumentsForUpload,
	readQueuedNoteDocumentDeletions,
	readQueuedNoteDocuments,
	readStoredRemoteNoteDocuments,
	refreshRemoteNoteDocuments,
	resolveNoteDocumentBlob,
	retryQueuedNoteDocument,
	scheduleQueuedNoteDocumentFlush,
} from '../../core/noteDocumentStore';
import styles from './DocumentsPanel.module.css';
import viewerStyles from './PdfViewer.module.css';

// Lazy: pdf.js is big, and most visits to the Documents tab never open a PDF.
const loadPdfViewer = () => import('./PdfViewer');
const PdfViewer = React.lazy(() => loadPdfViewer().then((module) => ({ default: module.PdfViewer })));

// Shown while the viewer chunk downloads. With no fallback the first tap on a PDF did
// nothing visible for a second or two, so it looked ignored and got tapped again.
function PdfViewerLoading(props: { fileName: string; onClose: () => void; t: (key: string) => string }): React.JSX.Element {
	const stop = (event: React.SyntheticEvent): void => event.stopPropagation();
	const content = (
		<div className={viewerStyles.backdrop} role="presentation" onClick={stop} onPointerDown={stop} onTouchStart={stop} onTouchMove={stop} onTouchEnd={stop}>
			<section className={viewerStyles.viewer} role="dialog" aria-modal="true" aria-label={props.fileName}>
				<header className={viewerStyles.header}>
					<button type="button" className={viewerStyles.button} onClick={props.onClose}>
						<FontAwesomeIcon icon={faArrowLeft} />
						<span className={viewerStyles.buttonLabel}>{props.t('common.back')}</span>
					</button>
					<div className={viewerStyles.titleWrap}>
						<h2 className={viewerStyles.title} title={props.fileName}>{props.fileName}</h2>
					</div>
				</header>
				<div className={viewerStyles.body}>
					<p className={viewerStyles.status}>{props.t('documents.viewerLoading')}</p>
				</div>
			</section>
		</div>
	);
	return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}

type Translate = (key: string) => string;

function isPdfDocument(document: NoteDocumentRecord): boolean {
	return (document.fileExtension || getNoteDocumentExtension(document.fileName, document.mimeType)) === 'pdf';
}

/** A PDF, or an office file Gotenberg has made a PDF copy of: both open in the PDF viewer. */
function hasPdfView(document: NoteDocumentRecord): boolean {
	if (isPdfDocument(document)) return true;
	return !document.isLocal && document.conversionStatus === 'COMPLETE' && Boolean(document.viewPdfUrl);
}

type DocumentsPanelProps = {
	docId: string;
	authUserId?: string | null;
	canEdit?: boolean;
	/** A note that hasn't been saved yet has nowhere on the server to put a file. */
	isPendingNew?: boolean;
	onShowBriefDialog?: ((message: string) => void) | undefined;
};

type DocumentKind = 'pdf' | 'text' | 'sheet' | 'slides' | 'plain';

function documentKind(extension: string): DocumentKind {
	switch (extension) {
		case 'pdf':
			return 'pdf';
		case 'xls':
		case 'xlsx':
		case 'ods':
		case 'csv':
			return 'sheet';
		case 'ppt':
		case 'pptx':
		case 'odp':
			return 'slides';
		case 'txt':
		case 'md':
			return 'plain';
		default:
			return 'text';
	}
}

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function saveBlobToDevice(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = fileName || 'document';
	anchor.rel = 'noopener';
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	// Some mobile browsers start reading the blob after click() returns. Give them a
	// generous head start before pulling the URL out from under them.
	window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function readIsOnline(): boolean {
	return typeof navigator === 'undefined' || navigator.onLine !== false;
}

type DocumentDisplay = {
	kind: DocumentKind;
	badgeLabel: string;
	meta: string;
	statusLabel: string | null;
	statusState: 'waiting' | 'uploading' | 'failed' | null;
};

function describeDocument(document: NoteDocumentRecord, isOnline: boolean, t: Translate): DocumentDisplay {
	const extension = document.fileExtension || getNoteDocumentExtension(document.fileName, document.mimeType) || 'doc';
	const pages = Number(document.pageCount || 0);
	const meta = [
		extension.toUpperCase(),
		formatBytes(document.byteSize),
		pages > 0 ? `${pages} ${t(pages === 1 ? 'documents.pageSingular' : 'documents.pagePlural')}` : null,
	].filter(Boolean).join(' · ');

	let statusLabel: string | null = null;
	let statusState: DocumentDisplay['statusState'] = null;
	if (document.isLocal) {
		if (document.syncPermanentFailure) {
			statusLabel = document.lastSyncError ? `${t('documents.failedBadge')}: ${document.lastSyncError}` : t('documents.failedBadge');
			statusState = 'failed';
		} else if (isOnline) {
			statusLabel = t('documents.uploadingBadge');
			statusState = 'uploading';
		} else {
			statusLabel = t('documents.waitingBadge');
			statusState = 'waiting';
		}
	} else if (document.conversionStatus === 'PENDING' && getDocumentConversionEnabled()) {
		// Uploaded fine; Gotenberg is still making the PDF copy. It opens as text until then.
		statusLabel = t('documents.preparingPdf');
		statusState = 'waiting';
	}
	return {
		kind: documentKind(extension),
		badgeLabel: extension.slice(0, 4).toUpperCase(),
		meta,
		statusLabel,
		statusState,
	};
}

/** Shown on the new-note screens, where there's no saved note to attach anything to yet. */
export function DocumentsUnsavedNotePanel(): React.JSX.Element {
	const { t } = useI18n();
	return (
		<section className={styles.panel} aria-label={t('editors.mediaTabDocuments')}>
			<div className={styles.header}>
				<div>
					<p className={styles.eyebrow}>{t('editors.mediaTabDocuments')}</p>
				</div>
			</div>
			<div className={styles.empty}>
				<p className={styles.emptyTitle}>{t('documents.unsavedTitle')}</p>
				<p className={styles.emptyBody}>{t('documents.unsavedBody')}</p>
			</div>
		</section>
	);
}

type DocumentItemProps = {
	document: NoteDocumentRecord;
	canEdit: boolean;
	isOnline: boolean;
	busy: boolean;
	t: Translate;
	onOpen: (document: NoteDocumentRecord) => void;
	onDownload: (document: NoteDocumentRecord) => void;
	onDelete: (document: NoteDocumentRecord) => void;
	onRetry: (document: NoteDocumentRecord) => void;
};

function openLabel(_document: NoteDocumentRecord, t: Translate): string {
	// Everything opens in the app now: PDFs and converted office files in the PDF viewer, the rest as text.
	return t('documents.open');
}

function DocumentActions(props: DocumentItemProps): React.JSX.Element {
	const { document, t } = props;
	return (
		<>
			{document.isLocal && document.syncPermanentFailure && props.canEdit ? (
				<button
					type="button"
					className={styles.iconButton}
					onClick={() => props.onRetry(document)}
					aria-label={t('documents.retry')}
					title={t('documents.retry')}
				>
					<FontAwesomeIcon icon={faRotateRight} />
				</button>
			) : null}
			<button
				type="button"
				className={styles.iconButton}
				onClick={() => props.onDownload(document)}
				disabled={props.busy}
				aria-label={t('documents.download')}
				title={t('documents.download')}
			>
				<FontAwesomeIcon icon={faDownload} />
			</button>
			{props.canEdit ? (
				<button
					type="button"
					className={`${styles.iconButton} ${styles.iconButtonDanger}`}
					onClick={() => props.onDelete(document)}
					aria-label={t('documents.delete')}
					title={t('documents.delete')}
				>
					<FontAwesomeIcon icon={faTrash} />
				</button>
			) : null}
		</>
	);
}

function DocumentRow(props: DocumentItemProps): React.JSX.Element {
	const { document } = props;
	const display = describeDocument(document, props.isOnline, props.t);
	return (
		<li className={styles.row}>
			<button
				type="button"
				className={styles.openArea}
				onClick={() => props.onOpen(document)}
				aria-label={`${openLabel(document, props.t)}: ${document.fileName}`}
			>
				<span className={styles.typeBadge} data-kind={display.kind} aria-hidden="true">
					{display.badgeLabel}
				</span>
				<span className={styles.copy}>
					<span className={styles.name} title={document.fileName}>{document.fileName}</span>
					<span className={styles.meta}>{display.meta}</span>
					{display.statusLabel ? <span className={styles.status} data-state={display.statusState ?? undefined}>{display.statusLabel}</span> : null}
				</span>
			</button>
			<div className={styles.actions}>
				<DocumentActions {...props} />
			</div>
		</li>
	);
}

function DocumentCard(props: DocumentItemProps): React.JSX.Element {
	const { document } = props;
	const display = describeDocument(document, props.isOnline, props.t);
	const previewUrl = document.thumbnailUrl || '';
	// Offline and not cached, the preview image just fails; show the file-type badge
	// instead of a broken-image icon. Keyed by URL so a new version gets a fresh try.
	const [failedPreviewUrl, setFailedPreviewUrl] = React.useState<string | null>(null);
	const showPreview = Boolean(previewUrl) && failedPreviewUrl !== previewUrl;
	return (
		<li className={styles.card}>
			<button
				type="button"
				className={styles.cardOpenArea}
				onClick={() => props.onOpen(document)}
				aria-label={`${openLabel(document, props.t)}: ${document.fileName}`}
			>
				<span className={styles.cardPreview}>
					{showPreview ? (
						<img
							className={styles.cardPreviewImage}
							src={previewUrl}
							alt=""
							loading="lazy"
							onError={() => setFailedPreviewUrl(previewUrl)}
						/>
					) : (
						<span className={`${styles.typeBadge} ${styles.typeBadgeLarge}`} data-kind={display.kind} aria-hidden="true">
							{display.badgeLabel}
						</span>
					)}
				</span>
				<span className={styles.cardBody}>
					<span className={styles.name} title={document.fileName}>{document.fileName}</span>
					<span className={styles.meta}>{display.meta}</span>
					{display.statusLabel ? <span className={styles.status} data-state={display.statusState ?? undefined}>{display.statusLabel}</span> : null}
				</span>
			</button>
			<div className={styles.cardActions}>
				<DocumentActions {...props} />
			</div>
		</li>
	);
}

export function DocumentsPanel(props: DocumentsPanelProps): React.JSX.Element {
	const { t } = useI18n();
	const { docId, authUserId, isPendingNew, onShowBriefDialog } = props;
	const canEdit = props.canEdit === true;
	const [documents, setDocuments] = React.useState<readonly NoteDocumentRecord[]>(() => getCachedNoteDocuments(docId));
	const [isOnline, setIsOnline] = React.useState(readIsOnline);
	const [busyId, setBusyId] = React.useState<string | null>(null);
	const [viewerDocument, setViewerDocument] = React.useState<NoteDocumentRecord | null>(null);
	const [textViewerDocument, setTextViewerDocument] = React.useState<NoteDocumentRecord | null>(null);
	// Documents open as a list by default: for files, name/type/size reads better than a preview.
	const [viewMode, toggleViewMode] = usePanelViewMode(PANEL_VIEW_MODE_STORAGE_KEYS.documents, 'list');
	const inputRef = React.useRef<HTMLInputElement | null>(null);
	const docIdRef = React.useRef(docId);
	docIdRef.current = docId;

	const refresh = React.useCallback(async (): Promise<void> => {
		if (!docId) return;
		const requestedDocId = docId;
		// Offline-first: whatever is already cached shows immediately (seeded in state
		// above); this just reconciles with IndexedDB and, when possible, the server.
		if (authUserId) {
			await Promise.all([
				readQueuedNoteDocuments(authUserId, requestedDocId).catch(() => []),
				readQueuedNoteDocumentDeletions(authUserId, requestedDocId).catch(() => []),
			]);
		}
		if (isPendingNew) {
			await readStoredRemoteNoteDocuments(requestedDocId).catch(() => []);
		} else {
			try {
				await refreshRemoteNoteDocuments(requestedDocId, { userId: authUserId });
			} catch {
				// Bad connection or a hiccup: keep showing the stored list rather than nothing.
				await readStoredRemoteNoteDocuments(requestedDocId).catch(() => []);
			}
		}
		if (docIdRef.current !== requestedDocId) return;
		setDocuments(getCachedNoteDocuments(requestedDocId));
	}, [authUserId, docId, isPendingNew]);

	React.useEffect(() => {
		setDocuments(getCachedNoteDocuments(docId));
		void refresh();
	}, [docId, refresh]);

	React.useEffect(() => {
		const eventName = getNoteDocumentsChangedEventName();
		const onChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string }>).detail;
			if (!detail?.docId || detail.docId === docId) void refresh();
		};
		const onOnline = (): void => {
			setIsOnline(true);
			if (authUserId) void scheduleQueuedNoteDocumentFlush(authUserId);
			void refresh();
		};
		const onOffline = (): void => setIsOnline(false);
		window.addEventListener(eventName, onChanged as EventListener);
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		return () => {
			window.removeEventListener(eventName, onChanged as EventListener);
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
		};
	}, [authUserId, docId, refresh]);

	const handleFilesChosen = React.useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
		const picked = Array.from(event.target.files || []);
		// Reset so choosing the same file again still fires a change event.
		event.target.value = '';
		if (picked.length === 0 || !authUserId || !docId) return;
		const supported = picked.filter((file) => isSupportedNoteDocumentFile(file));
		const accepted = supported.filter((file) => file.size <= NOTE_DOCUMENT_MAX_FILE_BYTES);
		if (supported.length < picked.length) {
			onShowBriefDialog?.(t('documents.skippedUnsupported'));
		} else if (accepted.length < supported.length) {
			onShowBriefDialog?.(t('documents.skippedTooLarge'));
		}
		if (accepted.length === 0) return;
		// Confirm first, then queue: the queue write is fast, but the toast shouldn't wait on IndexedDB.
		if (supported.length === picked.length && accepted.length === supported.length) {
			onShowBriefDialog?.(readIsOnline() ? t('documents.uploadingToast') : t('documents.queuedOfflineToast'));
		}
		void queueNoteDocumentsForUpload({ userId: authUserId, docId, files: accepted })
			.then(() => {
				if (docIdRef.current === docId) setDocuments(getCachedNoteDocuments(docId));
			})
			.catch(() => onShowBriefDialog?.(t('documents.uploadFailed')));
	}, [authUserId, docId, onShowBriefDialog, t]);

	const handleDownload = React.useCallback(async (document: NoteDocumentRecord): Promise<void> => {
		setBusyId(document.id);
		try {
			const blob = await resolveNoteDocumentBlob(document);
			if (!blob) {
				onShowBriefDialog?.(readIsOnline() ? t('documents.downloadFailed') : t('documents.downloadOffline'));
				return;
			}
			saveBlobToDevice(blob, document.fileName);
		} catch {
			onShowBriefDialog?.(t('documents.downloadFailed'));
		} finally {
			setBusyId((current) => (current === document.id ? null : current));
		}
	}, [onShowBriefDialog, t]);

	const handleDelete = React.useCallback(async (document: NoteDocumentRecord): Promise<void> => {
		if (!authUserId) return;
		if (typeof window !== 'undefined' && !window.confirm(t('documents.deleteConfirm'))) return;
		try {
			await queueNoteDocumentDeletion({ userId: authUserId, document });
			setDocuments(getCachedNoteDocuments(docId));
		} catch {
			onShowBriefDialog?.(t('documents.deleteFailed'));
		}
	}, [authUserId, docId, onShowBriefDialog, t]);

	const handleRetry = React.useCallback((document: NoteDocumentRecord): void => {
		if (!authUserId) return;
		void retryQueuedNoteDocument(authUserId, document.id);
	}, [authUserId]);

	const handleOpen = React.useCallback((document: NoteDocumentRecord): void => {
		if (hasPdfView(document)) {
			setViewerDocument(document);
			return;
		}
		// No PDF to show (no Gotenberg, still converting, couldn't convert, or a text/CSV file).
		setTextViewerDocument(document);
	}, []);

	const closeViewer = React.useCallback((): void => setViewerDocument(null), []);
	const closeTextViewer = React.useCallback((): void => setTextViewerDocument(null), []);

	// The text view shows the list's current copy of the document, so "preparing PDF" clears
	// when conversion finishes. The moment a PDF copy exists, swap to the real viewer.
	const liveTextDocument = textViewerDocument
		? documents.find((document) => document.id === textViewerDocument.id) ?? textViewerDocument
		: null;
	const liveTextDocumentHasPdf = liveTextDocument ? hasPdfView(liveTextDocument) : false;
	React.useEffect(() => {
		if (!liveTextDocument || !liveTextDocumentHasPdf) return;
		setTextViewerDocument(null);
		setViewerDocument(liveTextDocument);
	}, [liveTextDocument, liveTextDocumentHasPdf]);

	// A PDF (or converted office file) is on screen, so someone may well open it: start
	// fetching the viewer now rather than on the tap.
	const hasPdf = documents.some(hasPdfView);
	React.useEffect(() => {
		if (hasPdf) void loadPdfViewer().catch(() => undefined);
	}, [hasPdf]);

	if (isPendingNew) {
		return <DocumentsUnsavedNotePanel />;
	}

	const canAdd = canEdit && Boolean(authUserId);
	const summary = documents.length === 0
		? t('documents.emptyTitle')
		: documents.length === 1
			? `1 ${t('documents.itemSingular')}`
			: `${documents.length} ${t('documents.itemPlural')}`;
	const itemProps = (document: NoteDocumentRecord): DocumentItemProps => ({
		document,
		canEdit,
		isOnline,
		busy: busyId === document.id,
		t,
		onOpen: handleOpen,
		onDownload: (target) => void handleDownload(target),
		onDelete: (target) => void handleDelete(target),
		onRetry: handleRetry,
	});

	return (
		<section className={styles.panel} aria-label={t('editors.mediaTabDocuments')}>
			<div className={styles.header}>
				<div>
					<p className={styles.eyebrow}>{t('editors.mediaTabDocuments')}</p>
					<p className={styles.summary}>{summary}</p>
				</div>
				<div className={styles.headerActions}>
					<button
						type="button"
						className={styles.iconButton}
						onClick={toggleViewMode}
						aria-label={viewMode === 'card' ? t('common.viewAsList') : t('common.viewAsCards')}
						title={viewMode === 'card' ? t('common.viewAsList') : t('common.viewAsCards')}
					>
						<FontAwesomeIcon icon={viewMode === 'card' ? faListUl : faTableCellsLarge} />
					</button>
					{canAdd ? (
						<>
							<button
								type="button"
								className={styles.addButton}
								onClick={() => inputRef.current?.click()}
								title={t('documents.addTitle')}
							>
								<FontAwesomeIcon icon={faPlus} />
								<span>{t('documents.addButton')}</span>
							</button>
							<input
								ref={inputRef}
								type="file"
								multiple
								accept={NOTE_DOCUMENT_ACCEPT}
								className={styles.hiddenInput}
								onChange={handleFilesChosen}
								tabIndex={-1}
								aria-hidden="true"
							/>
						</>
					) : null}
				</div>
			</div>
			{documents.length === 0 ? (
				<div className={styles.empty}>
					<p className={styles.emptyTitle}>{t('documents.emptyTitle')}</p>
					<p className={styles.emptyBody}>{t('documents.emptyBody')}</p>
				</div>
			) : viewMode === 'card' ? (
				<ul className={styles.grid}>
					{documents.map((document) => <DocumentCard key={document.id} {...itemProps(document)} />)}
				</ul>
			) : (
				<ul className={styles.list}>
					{documents.map((document) => <DocumentRow key={document.id} {...itemProps(document)} />)}
				</ul>
			)}
			{viewerDocument ? (
				<React.Suspense fallback={<PdfViewerLoading fileName={viewerDocument.fileName} onClose={closeViewer} t={t} />}>
					<PdfViewer
						document={viewerDocument}
						authUserId={authUserId}
						onClose={closeViewer}
						onDownload={(target) => void handleDownload(target)}
					/>
				</React.Suspense>
			) : null}
			{liveTextDocument && !liveTextDocumentHasPdf ? (
				<DocumentTextViewer
					document={liveTextDocument}
					conversionEnabled={getDocumentConversionEnabled()}
					onClose={closeTextViewer}
					onDownload={(target) => void handleDownload(target)}
				/>
			) : null}
		</section>
	);
}
