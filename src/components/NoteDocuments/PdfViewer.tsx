import React from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faDownload, faXmark } from '@fortawesome/free-solid-svg-icons';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { NoteDocumentRecord } from '../../core/noteDocumentApi';
import { resolveNoteDocumentBlob } from '../../core/noteDocumentStore';
import { useI18n } from '../../core/i18n';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import styles from './PdfViewer.module.css';

// This whole module is lazy-loaded from DocumentsPanel, so pdf.js (and its ~1 MB worker)
// only downloads the first time someone actually opens a PDF.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfViewerProps = {
	document: NoteDocumentRecord;
	onClose: () => void;
	onDownload: (document: NoteDocumentRecord) => void;
};

type PageSize = { width: number; height: number };

type LoadState =
	| { status: 'loading' }
	| { status: 'ready'; pdf: PDFDocumentProxy; pageSizes: PageSize[] }
	| { status: 'error'; reason: 'offline' | 'password' | 'failed' };

const PAGE_GAP_PX = 12;
const PAGES_PADDING_PX = 12;
const MAX_PAGE_WIDTH_PX = 1000;
// Pages drawn beyond the ones on screen, each way. Everything further out gets its canvas
// released, which is what keeps a 300-page blueprint set from eating a phone's memory.
const EXTRA_RENDERED_PAGES = 2;
// Canvas memory is 4 bytes a pixel, and mobile browsers kill the tab well before desktop
// ones would. Cap each page's backing canvas; past this a page just gets slightly softer.
const MAX_CANVAS_PIXELS = 8_000_000;
// Shared with the photo viewer: the editor's attachment sheet ignores its own swipe gestures
// while a full-screen viewer is open.
const VIEWER_BODY_FLAG = 'freemannotesNoteImageViewerOpen';
// App pauses background refreshes while a document viewer is open (see App.tsx).
const DOCUMENT_VIEWER_STATE_EVENT = 'freemannotes:document-viewer-state';

type PdfPageProps = {
	pdf: PDFDocumentProxy;
	pageNumber: number;
	cssWidth: number;
	cssHeight: number;
	shouldRender: boolean;
};

const PdfPage = React.memo(function PdfPage(props: PdfPageProps): React.JSX.Element {
	const { pdf, pageNumber, cssWidth, shouldRender } = props;
	const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
	const [drawn, setDrawn] = React.useState(false);

	React.useEffect(() => {
		if (!shouldRender) {
			setDrawn(false);
			return;
		}
		const canvas = canvasRef.current;
		if (!canvas || cssWidth <= 0) return;
		let cancelled = false;
		let task: ReturnType<PDFPageProxy['render']> | null = null;
		let page: PDFPageProxy | null = null;
		setDrawn(false);
		void (async () => {
			try {
				page = await pdf.getPage(pageNumber);
				if (cancelled) return;
				const base = page.getViewport({ scale: 1 });
				const pixelRatio = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 3);
				let scale = (cssWidth / base.width) * pixelRatio;
				const pixels = base.width * scale * base.height * scale;
				if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
				const viewport = page.getViewport({ scale });
				canvas.width = Math.floor(viewport.width);
				canvas.height = Math.floor(viewport.height);
				task = page.render({ canvas, viewport });
				await task.promise;
				if (!cancelled) setDrawn(true);
			} catch (error) {
				// Scrolling a page out of range cancels its render; that's not a failure.
				if ((error as { name?: string } | null)?.name === 'RenderingCancelledException') return;
			}
		})();
		return () => {
			cancelled = true;
			task?.cancel();
			page?.cleanup();
			// Release the bitmap now instead of whenever the garbage collector gets round to it.
			canvas.width = 0;
			canvas.height = 0;
		};
	}, [cssWidth, pageNumber, pdf, shouldRender]);

	return (
		<div className={styles.page} style={{ width: props.cssWidth, height: props.cssHeight }} data-pdf-page={pageNumber}>
			{shouldRender ? <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" /> : null}
			{!drawn ? <span className={styles.pagePlaceholder}>{pageNumber}</span> : null}
		</div>
	);
});

/** Index of the last offset that is <= value (offsets ascending). */
function findLastAtOrBefore(offsets: readonly number[], value: number): number {
	let low = 0;
	let high = offsets.length - 1;
	let result = 0;
	while (low <= high) {
		const middle = (low + high) >> 1;
		if (offsets[middle] <= value) {
			result = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	return result;
}

export function PdfViewer(props: PdfViewerProps): React.JSX.Element {
	const { t } = useI18n();
	const { document: noteDocument } = props;
	const [load, setLoad] = React.useState<LoadState>({ status: 'loading' });
	const [containerWidth, setContainerWidth] = React.useState(0);
	const [scroll, setScroll] = React.useState({ top: 0, height: 0 });
	const scrollerRef = React.useRef<HTMLDivElement | null>(null);
	const scrollFrameRef = React.useRef(0);
	const onCloseRef = React.useRef(props.onClose);
	onCloseRef.current = props.onClose;
	const historyTokenRef = React.useRef(`note-pdf-viewer:${Math.random().toString(36).slice(2, 10)}`);
	const pendingHistoryCleanupRef = React.useRef<number | null>(null);
	const [isCoarsePointer] = React.useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);

	useBodyScrollLock(true);

	// Load the file (device copy first, so it opens offline) and read every page's size up
	// front. Knowing the sizes lets the page stack have its real height immediately, so the
	// scroll bar and page counter are right before a single page is drawn.
	React.useEffect(() => {
		let cancelled = false;
		let loadingTask: PDFDocumentLoadingTask | null = null;
		setLoad({ status: 'loading' });
		// Every failure path logs what actually went wrong. The first version of this just showed
		// "couldn't be opened" with nothing in the console, which is the same silent-failure trap
		// that hid the server's broken PDF text extraction for so long.
		let step = 'reading the file';
		void (async () => {
			try {
				const blob = await resolveNoteDocumentBlob(noteDocument);
				if (cancelled) return;
				if (!blob) {
					console.warn('[pdf-viewer] no file available', {
						documentId: noteDocument.id,
						originalUrl: noteDocument.originalUrl,
						online: typeof navigator === 'undefined' ? null : navigator.onLine,
					});
					setLoad({ status: 'error', reason: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'failed' });
					return;
				}
				const data = new Uint8Array(await blob.arrayBuffer());
				if (cancelled) return;
				step = 'opening the PDF';
				// isEvalSupported: false keeps pdf.js from compiling font code with new Function().
				loadingTask = pdfjsLib.getDocument({ data, isEvalSupported: false });
				const pdf = await loadingTask.promise;
				step = 'reading page sizes';
				const pageSizes: PageSize[] = [];
				for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
					const page = await pdf.getPage(pageNumber);
					if (cancelled) return;
					const viewport = page.getViewport({ scale: 1 });
					pageSizes.push({ width: viewport.width, height: viewport.height });
					page.cleanup();
				}
				if (cancelled) return;
				setLoad({ status: 'ready', pdf, pageSizes });
			} catch (error) {
				if (cancelled) return;
				console.error(`[pdf-viewer] failed while ${step}`, { documentId: noteDocument.id, originalUrl: noteDocument.originalUrl }, error);
				const name = (error as { name?: string } | null)?.name;
				setLoad({ status: 'error', reason: name === 'PasswordException' ? 'password' : 'failed' });
			}
		})();
		return () => {
			cancelled = true;
			// Destroys the document and terminates its worker.
			void loadingTask?.destroy();
		};
	}, [noteDocument.id, noteDocument.originalUrl]); // eslint-disable-line react-hooks/exhaustive-deps

	React.useEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		const measure = (): void => {
			setContainerWidth(scroller.clientWidth);
			setScroll({ top: scroller.scrollTop, height: scroller.clientHeight });
		};
		measure();
		const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
		observer?.observe(scroller);
		return () => observer?.disconnect();
	}, []);

	React.useEffect(() => {
		if (typeof document === 'undefined') return;
		document.body.dataset[VIEWER_BODY_FLAG] = 'true';
		window.dispatchEvent(new CustomEvent(DOCUMENT_VIEWER_STATE_EVENT, { detail: { open: true } }));
		return () => {
			delete document.body.dataset[VIEWER_BODY_FLAG];
			window.dispatchEvent(new CustomEvent(DOCUMENT_VIEWER_STATE_EVENT, { detail: { open: false } }));
			window.cancelAnimationFrame(scrollFrameRef.current);
		};
	}, []);

	// Mobile Back closes the viewer first, leaving the sheet or browser underneath open.
	// Same pattern as the photo viewer.
	React.useEffect(() => {
		if (!isCoarsePointer || typeof window === 'undefined') return;
		if (pendingHistoryCleanupRef.current != null) {
			window.clearTimeout(pendingHistoryCleanupRef.current);
			pendingHistoryCleanupRef.current = null;
		}
		let active = true;
		let didPush = false;
		const token = historyTokenRef.current;
		const onPopState = (): void => {
			if (!active) return;
			onCloseRef.current();
		};
		window.addEventListener('popstate', onPopState);
		const currentState = window.history.state as { __notePdfViewer?: string } | null;
		if (currentState?.__notePdfViewer !== token) {
			window.history.pushState({ __notePdfViewer: token }, '');
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

	const handleScroll = React.useCallback((): void => {
		window.cancelAnimationFrame(scrollFrameRef.current);
		scrollFrameRef.current = window.requestAnimationFrame(() => {
			const scroller = scrollerRef.current;
			if (!scroller) return;
			setScroll({ top: scroller.scrollTop, height: scroller.clientHeight });
		});
	}, []);

	const pageSizes = load.status === 'ready' ? load.pageSizes : [];
	const pageCssWidth = Math.max(0, Math.min(MAX_PAGE_WIDTH_PX, containerWidth - PAGES_PADDING_PX * 2));
	const layout = React.useMemo(() => {
		const heights = pageSizes.map((size) => (size.width > 0 ? Math.round(pageCssWidth * (size.height / size.width)) : 0));
		const offsets: number[] = [];
		let cursor = PAGES_PADDING_PX;
		for (const height of heights) {
			offsets.push(cursor);
			cursor += height + PAGE_GAP_PX;
		}
		return { heights, offsets };
	}, [pageCssWidth, pageSizes]);

	const pageCount = pageSizes.length;
	const firstVisible = pageCount > 0 ? findLastAtOrBefore(layout.offsets, scroll.top) : 0;
	const lastVisible = pageCount > 0 ? findLastAtOrBefore(layout.offsets, scroll.top + scroll.height) : 0;
	const renderFrom = Math.max(0, firstVisible - EXTRA_RENDERED_PAGES);
	const renderTo = Math.min(pageCount - 1, lastVisible + EXTRA_RENDERED_PAGES);
	// The page counter follows whichever page covers the upper part of the screen.
	const currentPage = pageCount > 0 ? findLastAtOrBefore(layout.offsets, scroll.top + scroll.height * 0.35) + 1 : 0;

	const subtitle = load.status === 'ready'
		? `${t('documents.pageLabel')} ${currentPage} / ${pageCount}`
		: load.status === 'loading'
			? t('documents.viewerLoading')
			: null;
	const errorMessage = load.status === 'error'
		? load.reason === 'offline'
			? t('documents.downloadOffline')
			: load.reason === 'password'
				? t('documents.viewerPassword')
				: t('documents.viewerFailed')
		: null;

	// Touches, pointers and clicks inside the viewer must not bubble (through the portal, in
	// React's tree) into the attachment sheet or browser it was opened from, or scrolling a PDF
	// would drag the sheet or switch its tabs.
	const stopPropagation = (event: React.SyntheticEvent): void => event.stopPropagation();

	const content = (
		<div
			className={styles.backdrop}
			role="presentation"
			onClick={stopPropagation}
			onPointerDown={stopPropagation}
			onTouchStart={stopPropagation}
			onTouchMove={stopPropagation}
			onTouchEnd={stopPropagation}
		>
			<section className={styles.viewer} role="dialog" aria-modal="true" aria-label={noteDocument.fileName}>
				<header className={styles.header}>
					<button type="button" className={styles.button} onClick={requestClose}>
						<FontAwesomeIcon icon={faArrowLeft} />
						<span className={styles.buttonLabel}>{t('common.back')}</span>
					</button>
					<div className={styles.titleWrap}>
						<h2 className={styles.title} title={noteDocument.fileName}>{noteDocument.fileName}</h2>
						{subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
					</div>
					<div className={styles.toolbar}>
						<button
							type="button"
							className={styles.iconButton}
							onClick={() => props.onDownload(noteDocument)}
							aria-label={t('documents.download')}
							title={t('documents.download')}
						>
							<FontAwesomeIcon icon={faDownload} />
						</button>
						<button
							type="button"
							className={styles.iconButton}
							onClick={requestClose}
							aria-label={t('common.close')}
							title={t('common.close')}
						>
							<FontAwesomeIcon icon={faXmark} />
						</button>
					</div>
				</header>
				<div ref={scrollerRef} className={styles.scroller} onScroll={handleScroll}>
					{load.status === 'ready' && pageCssWidth > 0 ? (
						<div className={styles.pages} style={{ padding: PAGES_PADDING_PX, gap: PAGE_GAP_PX }}>
							{pageSizes.map((_size, index) => (
								<PdfPage
									key={index}
									pdf={load.pdf}
									pageNumber={index + 1}
									cssWidth={pageCssWidth}
									cssHeight={layout.heights[index]}
									shouldRender={index >= renderFrom && index <= renderTo}
								/>
							))}
						</div>
					) : null}
					{load.status === 'loading' ? <p className={styles.status}>{t('documents.viewerLoading')}</p> : null}
					{errorMessage ? <p className={styles.status}>{errorMessage}</p> : null}
				</div>
			</section>
		</div>
	);

	return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
