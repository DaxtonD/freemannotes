import React from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faDownload, faXmark } from '@fortawesome/free-solid-svg-icons';
import type { NoteDocumentRecord } from '../../core/noteDocumentApi';
import { useI18n } from '../../core/i18n';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import viewerStyles from './PdfViewer.module.css';
import styles from './DocumentTextViewer.module.css';

// Everything that has no PDF to show opens here: office files when there's no Gotenberg (or the
// copy is still being made, or couldn't be), plus plain text, CSV and Markdown. It shows the text
// the server pulled out of the file, with Download for the real thing. Same shell as the PDF
// viewer and the same history key, so App and the attachment sheet already leave it alone.

// Shared with the PDF and photo viewers: the attachment sheet ignores its own swipes while set.
const VIEWER_BODY_FLAG = 'freemannotesNoteImageViewerOpen';
// App pauses background refreshes while a document viewer is open.
const DOCUMENT_VIEWER_STATE_EVENT = 'freemannotes:document-viewer-state';
const TEXT_ONLY_EXTENSIONS = new Set(['txt', 'md', 'csv']);

type DocumentTextViewerProps = {
	document: NoteDocumentRecord;
	/** Gotenberg is configured, so a PENDING office file really is on its way to a PDF. */
	conversionEnabled: boolean;
	onClose: () => void;
	onDownload: (document: NoteDocumentRecord) => void;
};

export function DocumentTextViewer(props: DocumentTextViewerProps): React.JSX.Element {
	const { t } = useI18n();
	const { document: noteDocument } = props;
	const onCloseRef = React.useRef(props.onClose);
	onCloseRef.current = props.onClose;
	const historyTokenRef = React.useRef(`note-text-viewer:${Math.random().toString(36).slice(2, 10)}`);
	const pendingHistoryCleanupRef = React.useRef<number | null>(null);
	const [isCoarsePointer] = React.useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);

	useBodyScrollLock(true);

	React.useEffect(() => {
		if (typeof document === 'undefined') return;
		document.body.dataset[VIEWER_BODY_FLAG] = 'true';
		window.dispatchEvent(new CustomEvent(DOCUMENT_VIEWER_STATE_EVENT, { detail: { open: true } }));
		return () => {
			delete document.body.dataset[VIEWER_BODY_FLAG];
			window.dispatchEvent(new CustomEvent(DOCUMENT_VIEWER_STATE_EVENT, { detail: { open: false } }));
		};
	}, []);

	// Mobile Back closes this first, leaving the sheet underneath open (same pattern as the PDF viewer).
	React.useEffect(() => {
		if (!isCoarsePointer || typeof window === 'undefined') return;
		if (pendingHistoryCleanupRef.current != null) {
			window.clearTimeout(pendingHistoryCleanupRef.current);
			pendingHistoryCleanupRef.current = null;
		}
		let active = true;
		let didPush = false;
		const token = historyTokenRef.current;
		const onPopState = (event: PopStateEvent): void => {
			if (!active) return;
			if ((event.state as { __notePdfViewer?: string } | null)?.__notePdfViewer === token) return;
			onCloseRef.current();
		};
		window.addEventListener('popstate', onPopState);
		const currentState = window.history.state as { __notePdfViewer?: string } | null;
		if (currentState?.__notePdfViewer !== token) {
			if (typeof currentState?.__notePdfViewer === 'string') window.history.replaceState({ __notePdfViewer: token }, '');
			else window.history.pushState({ __notePdfViewer: token }, '');
			didPush = true;
		}
		return () => {
			active = false;
			window.removeEventListener('popstate', onPopState);
			if (!didPush) return;
			pendingHistoryCleanupRef.current = window.setTimeout(() => {
				pendingHistoryCleanupRef.current = null;
				const state = window.history.state as { __notePdfViewer?: string } | null;
				if (state?.__notePdfViewer === token) window.history.back();
			}, 0);
		};
	}, [isCoarsePointer]);

	const requestClose = React.useCallback((): void => {
		const state = typeof window !== 'undefined' ? (window.history.state as { __notePdfViewer?: string } | null) : null;
		if (isCoarsePointer && state?.__notePdfViewer === historyTokenRef.current) {
			window.history.back();
			return;
		}
		onCloseRef.current();
	}, [isCoarsePointer]);

	React.useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') requestClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [requestClose]);

	const extension = String(noteDocument.fileExtension || '').toLowerCase();
	const isOfficeFile = !TEXT_ONLY_EXTENSIONS.has(extension);
	let notice: string | null = null;
	if (isOfficeFile && !noteDocument.isLocal && props.conversionEnabled) {
		if (noteDocument.conversionStatus === 'PENDING') notice = t('documents.textViewPreparing');
		else if (noteDocument.conversionStatus === 'FAILED') notice = t('documents.textViewConversionFailed');
	}
	const text = String(noteDocument.ocrText || '').trim();
	const stopPropagation = (event: React.SyntheticEvent): void => event.stopPropagation();

	const content = (
		<div
			className={viewerStyles.backdrop}
			role="presentation"
			onClick={stopPropagation}
			onPointerDown={stopPropagation}
			onTouchStart={stopPropagation}
			onTouchMove={stopPropagation}
			onTouchEnd={stopPropagation}
		>
			<section className={viewerStyles.viewer} role="dialog" aria-modal="true" aria-label={noteDocument.fileName}>
				<header className={viewerStyles.header}>
					<button type="button" className={viewerStyles.button} onClick={requestClose}>
						<FontAwesomeIcon icon={faArrowLeft} />
						<span className={viewerStyles.buttonLabel}>{t('common.back')}</span>
					</button>
					<div className={viewerStyles.titleWrap}>
						<h2 className={viewerStyles.title} title={noteDocument.fileName}>{noteDocument.fileName}</h2>
						<p className={viewerStyles.subtitle}>{t('documents.textViewSubtitle')}</p>
					</div>
					<div className={viewerStyles.toolbar}>
						<button
							type="button"
							className={viewerStyles.iconButton}
							onClick={() => props.onDownload(noteDocument)}
							aria-label={t('documents.download')}
							title={t('documents.download')}
						>
							<FontAwesomeIcon icon={faDownload} />
						</button>
						<button
							type="button"
							className={viewerStyles.iconButton}
							onClick={requestClose}
							aria-label={t('common.close')}
							title={t('common.close')}
						>
							<FontAwesomeIcon icon={faXmark} />
						</button>
					</div>
				</header>
				{notice ? <p className={styles.notice} role="status">{notice}</p> : null}
				<div className={styles.body}>
					{text ? (
						<div className={styles.text}>{text}</div>
					) : (
						<p className={styles.empty}>{t(noteDocument.isLocal ? 'documents.textViewWaiting' : 'documents.textViewEmpty')}</p>
					)}
				</div>
			</section>
		</div>
	);

	return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
