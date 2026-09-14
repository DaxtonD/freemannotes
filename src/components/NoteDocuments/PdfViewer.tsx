import React from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faChevronDown, faChevronUp, faDownload, faMagnifyingGlass, faMagnifyingGlassMinus, faMagnifyingGlassPlus, faTableColumns, faXmark } from '@fortawesome/free-solid-svg-icons';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { NoteDocumentRecord } from '../../core/noteDocumentApi';
import { resolveNoteDocumentViewBlob } from '../../core/noteDocumentStore';
import { readPdfViewerPosition, writePdfViewerPosition } from '../../core/pdfViewerPositions';
import { useI18n } from '../../core/i18n';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import { PdfPageNavigator, type PdfThumbnailCache } from './PdfPageNavigator';
import {
	EMPTY_PDF_PAGE_TEXT,
	findMatchesOnPage,
	foldSearchQuery,
	readPdfPageText,
	type PdfPageHighlight,
	type PdfPageText,
	type PdfSearchMatch,
} from './pdfTextSearch';
import styles from './PdfViewer.module.css';

// This whole module is lazy-loaded from DocumentsPanel, so pdf.js (and its ~1 MB worker)
// only downloads the first time someone actually opens a PDF.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfViewerProps = {
	document: NoteDocumentRecord;
	/** Scopes the remembered reading position to this login. */
	authUserId?: string | null;
	onClose: () => void;
	onDownload: (document: NoteDocumentRecord) => void;
};

type PageSize = { width: number; height: number };

type LoadState =
	| { status: 'loading' }
	| { status: 'ready'; pdf: PDFDocumentProxy; pageSizes: PageSize[] }
	| { status: 'error'; reason: 'offline' | 'password' | 'failed' };

// Gap and padding scale with the zoom, so the whole page stack scales as one piece. That's
// what lets a pinch be an exact transform: every point on the stack moves by the same factor.
const PAGE_GAP_PX = 12;
const PAGES_PADDING_PX = 12;
const MAX_PAGE_WIDTH_PX = 1000;
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_BUTTON_STEP = 1.25;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_WINDOW_MS = 300;
const TAP_SLOP_PX = 24;
const ZOOM_ANIMATION_MS = 180;
const WHEEL_ZOOM_COMMIT_DELAY_MS = 160;
const ARROW_KEY_SCROLL_PX = 60;
const POSITION_SAVE_DELAY_MS = 500;
// Canvas memory is 4 bytes a pixel, and mobile browsers kill the tab well before desktop
// ones would. Cap each page's backing canvas; past this a page just gets slightly softer.
const MAX_CANVAS_PIXELS = 8_000_000;
// Shared with the photo viewer: the editor's attachment sheet ignores its own swipe gestures
// while a full-screen viewer is open.
const VIEWER_BODY_FLAG = 'freemannotesNoteImageViewerOpen';
// App pauses background refreshes while a document viewer is open (see App.tsx).
const DOCUMENT_VIEWER_STATE_EVENT = 'freemannotes:document-viewer-state';
const SEARCH_DEBOUNCE_MS = 220;
// Searching for "e" in a 400-page manual is not a thing anyone needs every hit of.
const MAX_SEARCH_MATCHES = 2000;
// Redraw the "n / N" count at most this often while pages are still being read.
const TEXT_READ_FLUSH_MS = 150;

type SearchState = {
	needle: string;
	matches: PdfSearchMatch[];
	/** Pages already searched for this needle; later pages get searched as their text arrives. */
	searchedPages: number;
	hasText: boolean;
};

const EMPTY_SEARCH: SearchState = { needle: '', matches: [], searchedPages: 0, hasText: false };

function clampZoom(value: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

type PdfPageProps = {
	pdf: PDFDocumentProxy;
	pageNumber: number;
	cssWidth: number;
	cssHeight: number;
	shouldRender: boolean;
	/** Search hits on this page, in page fractions, so they stay put at any zoom. */
	highlights?: readonly PdfPageHighlight[];
	/** Index of the current hit if it's on this page, otherwise -1. */
	activeHighlight: number;
};

const PdfPage = React.memo(function PdfPage(props: PdfPageProps): React.JSX.Element {
	const { pdf, pageNumber, cssWidth, shouldRender } = props;
	const hostRef = React.useRef<HTMLDivElement | null>(null);
	const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
	const [drawn, setDrawn] = React.useState(false);

	const releaseCanvas = React.useCallback((): void => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		canvas.remove();
		// Release the bitmap now instead of whenever the garbage collector gets round to it.
		canvas.width = 0;
		canvas.height = 0;
		canvasRef.current = null;
	}, []);

	React.useEffect(() => {
		if (!shouldRender) {
			releaseCanvas();
			setDrawn(false);
			return;
		}
		const host = hostRef.current;
		if (!host || cssWidth <= 0) return;
		let cancelled = false;
		let task: ReturnType<PDFPageProxy['render']> | null = null;
		let page: PDFPageProxy | null = null;
		let nextCanvas: HTMLCanvasElement | null = null;
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
				// Draw the new size into a fresh canvas and only swap it in once it's finished.
				// Until then the old canvas stays up, stretched to the new size by CSS: briefly
				// soft after a zoom instead of a blank white page while it redraws.
				nextCanvas = document.createElement('canvas');
				nextCanvas.className = styles.canvas;
				nextCanvas.setAttribute('aria-hidden', 'true');
				nextCanvas.width = Math.floor(viewport.width);
				nextCanvas.height = Math.floor(viewport.height);
				task = page.render({ canvas: nextCanvas, viewport });
				await task.promise;
				if (cancelled) return;
				releaseCanvas();
				host.appendChild(nextCanvas);
				canvasRef.current = nextCanvas;
				nextCanvas = null;
				setDrawn(true);
			} catch (error) {
				// Scrolling a page out of range (or zooming again) cancels its render; that's not a failure.
				if ((error as { name?: string } | null)?.name === 'RenderingCancelledException') return;
				console.error(`[pdf-viewer] failed to draw page ${pageNumber}`, error);
			}
		})();
		return () => {
			cancelled = true;
			task?.cancel();
			page?.cleanup();
			if (nextCanvas) {
				nextCanvas.width = 0;
				nextCanvas.height = 0;
			}
		};
	}, [cssWidth, pageNumber, pdf, releaseCanvas, shouldRender]);

	React.useEffect(() => releaseCanvas, [releaseCanvas]);

	return (
		<div ref={hostRef} className={styles.page} style={{ width: props.cssWidth, height: props.cssHeight }} data-pdf-page={pageNumber}>
			{!drawn ? <span className={styles.pagePlaceholder}>{pageNumber}</span> : null}
			{shouldRender && props.highlights ? props.highlights.map((highlight) => highlight.rects.map((rect, rectIndex) => (
				<span
					key={`${highlight.index}:${rectIndex}`}
					className={highlight.index === props.activeHighlight ? `${styles.highlight} ${styles.highlightActive}` : styles.highlight}
					style={{ left: `${rect.left * 100}%`, top: `${rect.top * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
					aria-hidden="true"
				/>
			))) : null}
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

// A zoom in progress (pinch, double-tap animation, ctrl+wheel, zoom buttons).
//
// The two things that went wrong with pinch zoom before: it zoomed around a fixed point
// instead of the spot between your fingers, and you couldn't move the page while pinching.
// Both come from the same idea here. At the start we note which spot on the page stack is
// under the focus point (`localX/localY`, in stack coordinates). Every frame after that we
// position the stack so that same spot sits exactly under wherever the focus point is *now*.
// Fingers spread: the spot stays put while the page grows around it. Fingers travel
// together: the spot travels with them, which is panning. No separate pan mode needed.
//
// While the gesture runs, only a CSS transform changes (cheap, no re-layout, no redraw).
// When it ends, the zoom is committed for real and the scroll position is set so the same
// spot lands under the final focus point, then pages redraw sharp at the new size.
type ZoomGesture = {
	baseZoom: number;
	originLeft: number;
	originTop: number;
	localX: number;
	localY: number;
	scale: number;
	focusX: number;
	focusY: number;
};

type PendingZoomCommit = {
	localX: number;
	localY: number;
	scale: number;
	focusX: number;
	focusY: number;
};

type PageLayout = { heights: number[]; offsets: number[]; gap: number; pageWidth: number; padding: number };

/** Reading position as "which page, and how far down it", so it survives zoom and width changes. */
type PageAnchor = { index: number; fraction: number };

function anchorForScrollTop(layout: PageLayout, scrollTop: number): PageAnchor | null {
	if (layout.offsets.length === 0) return null;
	const index = findLastAtOrBefore(layout.offsets, scrollTop);
	const height = layout.heights[index] || 0;
	const fraction = height > 0 ? Math.min(1, Math.max(0, (scrollTop - layout.offsets[index]) / height)) : 0;
	return { index, fraction };
}

function scrollTopForAnchor(layout: PageLayout, anchor: PageAnchor): number {
	const index = Math.min(layout.offsets.length - 1, Math.max(0, anchor.index));
	return layout.offsets[index] + anchor.fraction * (layout.heights[index] || 0);
}

export function PdfViewer(props: PdfViewerProps): React.JSX.Element {
	const { t } = useI18n();
	const { document: noteDocument, authUserId } = props;
	const [load, setLoad] = React.useState<LoadState>({ status: 'loading' });
	const [containerWidth, setContainerWidth] = React.useState(0);
	const [scroll, setScroll] = React.useState({ top: 0, height: 0 });
	const [zoom, setZoom] = React.useState(MIN_ZOOM);
	const [zoomCommitTick, setZoomCommitTick] = React.useState(0);
	const [navigatorOpen, setNavigatorOpen] = React.useState(false);
	const navigatorOpenRef = React.useRef(navigatorOpen);
	navigatorOpenRef.current = navigatorOpen;
	const [searchOpen, setSearchOpen] = React.useState(false);
	const searchOpenRef = React.useRef(searchOpen);
	searchOpenRef.current = searchOpen;
	const [searchQuery, setSearchQuery] = React.useState('');
	const [searchNeedle, setSearchNeedle] = React.useState('');
	const searchNeedleRef = React.useRef('');
	const [search, setSearch] = React.useState<SearchState>(EMPTY_SEARCH);
	const [activeMatch, setActiveMatch] = React.useState(-1);
	const [matchJumpTick, setMatchJumpTick] = React.useState(0);
	// Text is only read once someone actually searches, then kept for the life of the viewer.
	const [textWanted, setTextWanted] = React.useState(false);
	const [pageTextsRead, setPageTextsRead] = React.useState(0);
	const pageTextsRef = React.useRef<PdfPageText[]>([]);
	const searchStartPageRef = React.useRef(0);
	const searchInputRef = React.useRef<HTMLInputElement | null>(null);
	const zoomRef = React.useRef(zoom);
	zoomRef.current = zoom;
	const scrollerRef = React.useRef<HTMLDivElement | null>(null);
	const pagesRef = React.useRef<HTMLDivElement | null>(null);
	const scrollFrameRef = React.useRef(0);
	const gestureRef = React.useRef<ZoomGesture | null>(null);
	const pendingCommitRef = React.useRef<PendingZoomCommit | null>(null);
	const thumbnailCacheRef = React.useRef<PdfThumbnailCache>(new Map());
	const layoutRef = React.useRef<PageLayout>({ heights: [], offsets: [], gap: 0, pageWidth: 0, padding: 0 });
	const anchorRef = React.useRef<PageAnchor | null>(null);
	const positionRestoredRef = React.useRef(false);
	const previousFitWidthRef = React.useRef<number | null>(null);
	const positionSaveTimerRef = React.useRef(0);
	const onCloseRef = React.useRef(props.onClose);
	onCloseRef.current = props.onClose;
	const historyTokenRef = React.useRef(`note-pdf-viewer:${Math.random().toString(36).slice(2, 10)}`);
	const pendingHistoryCleanupRef = React.useRef<number | null>(null);
	const [isCoarsePointer] = React.useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
	// One remembered position per version: a new version starts back at page 1.
	const positionKey = `${noteDocument.id}:${noteDocument.latestVersionId ?? noteDocument.originalUrl}`;

	useBodyScrollLock(true);

	// Load the file (device copy first, so it opens offline) and read every page's size up
	// front. Knowing the sizes lets the page stack have its real height immediately, so the
	// scroll bar and page counter are right before a single page is drawn.
	React.useEffect(() => {
		let cancelled = false;
		let loadingTask: PDFDocumentLoadingTask | null = null;
		// Every failure path logs what actually went wrong. The first version of this just showed
		// "couldn't be opened" with nothing in the console, which is the same silent-failure trap
		// that hid the server's broken PDF text extraction for so long.
		let step = 'reading the file';
		setLoad({ status: 'loading' });
		pageTextsRef.current = [];
		setPageTextsRead(0);
		setSearch(EMPTY_SEARCH);
		setActiveMatch(-1);
		void (async () => {
			try {
				// A PDF opens itself; an office file opens the PDF copy Gotenberg made of it.
				const blob = await resolveNoteDocumentViewBlob(noteDocument);
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
	}, [noteDocument.id, noteDocument.originalUrl, noteDocument.viewPdfUrl]); // eslint-disable-line react-hooks/exhaustive-deps

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
		const thumbnailCache = thumbnailCacheRef.current;
		document.body.dataset[VIEWER_BODY_FLAG] = 'true';
		window.dispatchEvent(new CustomEvent(DOCUMENT_VIEWER_STATE_EVENT, { detail: { open: true } }));
		return () => {
			delete document.body.dataset[VIEWER_BODY_FLAG];
			window.dispatchEvent(new CustomEvent(DOCUMENT_VIEWER_STATE_EVENT, { detail: { open: false } }));
			window.cancelAnimationFrame(scrollFrameRef.current);
			for (const url of thumbnailCache.values()) URL.revokeObjectURL(url);
			thumbnailCache.clear();
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
		const onPopState = (event: PopStateEvent): void => {
			if (!active) return;
			if ((event.state as { __notePdfViewer?: string } | null)?.__notePdfViewer === token) return;
			// The search bar and the phone page panel ride on this same entry. The panel used to
			// push its own, and every history.back() it did landed on this entry, which App and
			// the media sheet didn't recognise, so they helpfully closed the whole editor. Now
			// Back shuts the top layer (search first, then the panel) and puts our entry back.
			if (searchOpenRef.current || navigatorOpenRef.current) {
				if (searchOpenRef.current) {
					searchOpenRef.current = false;
					setSearchOpen(false);
				} else {
					navigatorOpenRef.current = false;
					setNavigatorOpen(false);
				}
				window.history.pushState({ __notePdfViewer: token }, '');
				return;
			}
			onCloseRef.current();
		};
		window.addEventListener('popstate', onPopState);
		const currentState = window.history.state as { __notePdfViewer?: string } | null;
		if (currentState?.__notePdfViewer !== token) {
			// Swapping straight in from the text view (the PDF copy just finished): take over its
			// entry rather than stacking a second one that Back would have to get through.
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

	const closeNavigator = React.useCallback((): void => {
		setNavigatorOpen(false);
	}, []);

	const requestClose = React.useCallback((): void => {
		const state = typeof window !== 'undefined'
			? (window.history.state as { __notePdfViewer?: string } | null)
			: null;
		if (isCoarsePointer && state?.__notePdfViewer === historyTokenRef.current) {
			// Drop the layer flags first, or the popstate handler reads this as "Back with the
			// page panel or search open" and keeps the viewer.
			navigatorOpenRef.current = false;
			setNavigatorOpen(false);
			searchOpenRef.current = false;
			setSearchOpen(false);
			window.history.back();
			return;
		}
		onCloseRef.current();
	}, [isCoarsePointer]);

	// ── Reading position ────────────────────────────────────────────────────

	const saveReadingPosition = React.useCallback((): void => {
		const anchor = anchorRef.current;
		if (!positionRestoredRef.current || !anchor) return;
		writePdfViewerPosition(authUserId, positionKey, { page: anchor.index + 1, fraction: anchor.fraction });
	}, [authUserId, positionKey]);

	React.useEffect(() => () => {
		window.clearTimeout(positionSaveTimerRef.current);
		saveReadingPosition();
	}, [saveReadingPosition]);

	const handleScroll = React.useCallback((): void => {
		window.cancelAnimationFrame(scrollFrameRef.current);
		scrollFrameRef.current = window.requestAnimationFrame(() => {
			const scroller = scrollerRef.current;
			if (!scroller) return;
			setScroll({ top: scroller.scrollTop, height: scroller.clientHeight });
			anchorRef.current = anchorForScrollTop(layoutRef.current, scroller.scrollTop);
			window.clearTimeout(positionSaveTimerRef.current);
			positionSaveTimerRef.current = window.setTimeout(saveReadingPosition, POSITION_SAVE_DELAY_MS);
		});
	}, [saveReadingPosition]);

	const goToPage = React.useCallback((pageNumber: number): void => {
		const scroller = scrollerRef.current;
		const layout = layoutRef.current;
		if (!scroller || layout.offsets.length === 0 || gestureRef.current) return;
		const index = Math.min(layout.offsets.length - 1, Math.max(0, pageNumber - 1));
		scroller.scrollTop = Math.max(0, layout.offsets[index] - layout.gap / 2);
	}, []);

	const handleSelectPage = React.useCallback((pageNumber: number): void => {
		goToPage(pageNumber);
		// On a phone the panel covers half the page you just jumped to.
		if (isCoarsePointer) closeNavigator();
	}, [closeNavigator, goToPage, isCoarsePointer]);

	// ── Zoom ────────────────────────────────────────────────────────────────

	/** Start a zoom around a focus point given in the scroller's viewport coordinates. */
	const beginZoomGesture = React.useCallback((focusX: number, focusY: number): ZoomGesture | null => {
		const scroller = scrollerRef.current;
		const pages = pagesRef.current;
		if (!scroller || !pages) return null;
		const gesture: ZoomGesture = {
			baseZoom: zoomRef.current,
			originLeft: pages.offsetLeft,
			originTop: pages.offsetTop,
			localX: focusX + scroller.scrollLeft - pages.offsetLeft,
			localY: focusY + scroller.scrollTop - pages.offsetTop,
			scale: 1,
			focusX,
			focusY,
		};
		pages.style.transformOrigin = '0 0';
		pages.style.willChange = 'transform';
		gestureRef.current = gesture;
		return gesture;
	}, []);

	/** Move the live gesture: `scale` is relative to where the gesture started. */
	const updateZoomGesture = React.useCallback((scale: number, focusX: number, focusY: number): void => {
		const gesture = gestureRef.current;
		const scroller = scrollerRef.current;
		const pages = pagesRef.current;
		if (!gesture || !scroller || !pages) return;
		const clampedScale = clampZoom(gesture.baseZoom * scale) / gesture.baseZoom;
		gesture.scale = clampedScale;
		gesture.focusX = focusX;
		gesture.focusY = focusY;
		// Place the stack so the remembered spot sits under the focus point right now. Uses the
		// live scroll position, so if the browser is still scrolling from the first finger when
		// the second one lands, the spot still stays under the fingers.
		const translateX = focusX + scroller.scrollLeft - gesture.originLeft - gesture.localX * clampedScale;
		const translateY = focusY + scroller.scrollTop - gesture.originTop - gesture.localY * clampedScale;
		pages.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${clampedScale})`;
	}, []);

	/** Finish the gesture: commit the zoom; the layout effect below lands the scroll. */
	const commitZoomGesture = React.useCallback((): void => {
		const gesture = gestureRef.current;
		if (!gesture) return;
		gestureRef.current = null;
		pendingCommitRef.current = {
			localX: gesture.localX,
			localY: gesture.localY,
			scale: gesture.scale,
			focusX: gesture.focusX,
			focusY: gesture.focusY,
		};
		setZoom(clampZoom(gesture.baseZoom * gesture.scale));
		// Even a pinch that ends back at the same zoom (a pure two-finger pan) has to commit,
		// so the pan becomes a real scroll and the transform comes off.
		setZoomCommitTick((tick) => tick + 1);
	}, []);

	// Runs after the new zoom is laid out and before the browser paints it: take the transform
	// off and scroll so the focus spot is exactly where the transform was showing it. The stack
	// scales uniformly (see PAGE_GAP_PX), so the spot's new position is simply localX * scale.
	React.useLayoutEffect(() => {
		const pending = pendingCommitRef.current;
		const scroller = scrollerRef.current;
		const pages = pagesRef.current;
		if (!pending || !scroller || !pages) return;
		pendingCommitRef.current = null;
		pages.style.transition = '';
		pages.style.transform = '';
		pages.style.willChange = '';
		scroller.scrollLeft = pages.offsetLeft + pending.localX * pending.scale - pending.focusX;
		scroller.scrollTop = pages.offsetTop + pending.localY * pending.scale - pending.focusY;
		setScroll({ top: scroller.scrollTop, height: scroller.clientHeight });
	}, [zoom, zoomCommitTick]);

	/** Animated zoom to an absolute level around a focus point (double-tap, buttons). */
	const animateZoomTo = React.useCallback((targetZoom: number, focusX: number, focusY: number): void => {
		if (gestureRef.current) return;
		const gesture = beginZoomGesture(focusX, focusY);
		const pages = pagesRef.current;
		if (!gesture || !pages) return;
		const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (!reduceMotion) pages.style.transition = `transform ${ZOOM_ANIMATION_MS}ms ease-out`;
		updateZoomGesture(clampZoom(targetZoom) / gesture.baseZoom, focusX, focusY);
		window.setTimeout(() => {
			if (gestureRef.current !== gesture) return;
			commitZoomGesture();
		}, reduceMotion ? 0 : ZOOM_ANIMATION_MS);
	}, [beginZoomGesture, commitZoomGesture, updateZoomGesture]);

	const zoomAroundCenter = React.useCallback((targetZoom: number): void => {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		animateZoomTo(targetZoom, scroller.clientWidth / 2, scroller.clientHeight / 2);
	}, [animateZoomTo]);

	// Touch (pinch, double-tap) and ctrl+wheel. Native listeners, not React props, because
	// they need passive: false to stop the browser's own scrolling and page zoom mid-gesture.
	React.useEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller || load.status !== 'ready') return;
		let pinchStartDistance = 0;
		let singleTouchStart: { x: number; y: number } | null = null;
		let lastTap: { x: number; y: number; time: number } | null = null;
		let wheelScale = 1;
		let wheelCommitTimer = 0;

		const toViewportPoint = (clientX: number, clientY: number): { x: number; y: number } => {
			const rect = scroller.getBoundingClientRect();
			return { x: clientX - rect.left, y: clientY - rect.top };
		};
		const pinchMetrics = (touches: TouchList): { distance: number; x: number; y: number } => {
			const first = touches[0];
			const second = touches[1];
			const midpoint = toViewportPoint((first.clientX + second.clientX) / 2, (first.clientY + second.clientY) / 2);
			return {
				distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
				x: midpoint.x,
				y: midpoint.y,
			};
		};

		const onTouchStart = (event: TouchEvent): void => {
			if (event.touches.length === 2) {
				if (event.cancelable) event.preventDefault();
				if (gestureRef.current) commitZoomGesture();
				const metrics = pinchMetrics(event.touches);
				pinchStartDistance = Math.max(1, metrics.distance);
				beginZoomGesture(metrics.x, metrics.y);
				singleTouchStart = null;
				lastTap = null;
				return;
			}
			if (event.touches.length === 1) {
				singleTouchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
			}
		};

		const onTouchMove = (event: TouchEvent): void => {
			if (event.touches.length === 1 && singleTouchStart) {
				const touch = event.touches[0];
				if (Math.hypot(touch.clientX - singleTouchStart.x, touch.clientY - singleTouchStart.y) > TAP_SLOP_PX) {
					singleTouchStart = null;
					lastTap = null;
				}
			}
			if (!gestureRef.current || pinchStartDistance <= 0 || event.touches.length < 2) return;
			if (event.cancelable) event.preventDefault();
			const metrics = pinchMetrics(event.touches);
			updateZoomGesture(metrics.distance / pinchStartDistance, metrics.x, metrics.y);
		};

		const onTouchEnd = (event: TouchEvent): void => {
			if (pinchStartDistance > 0 && event.touches.length < 2) {
				pinchStartDistance = 0;
				commitZoomGesture();
				// Lifting the second finger isn't the first tap of a double-tap.
				singleTouchStart = null;
				lastTap = null;
				return;
			}
			if (event.touches.length !== 0 || event.changedTouches.length !== 1 || !singleTouchStart) return;
			const touch = event.changedTouches[0];
			singleTouchStart = null;
			const now = performance.now();
			if (lastTap && now - lastTap.time < DOUBLE_TAP_WINDOW_MS && Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < TAP_SLOP_PX) {
				if (event.cancelable) event.preventDefault();
				lastTap = null;
				const point = toViewportPoint(touch.clientX, touch.clientY);
				animateZoomTo(zoomRef.current < 1.5 ? DOUBLE_TAP_ZOOM : MIN_ZOOM, point.x, point.y);
				return;
			}
			lastTap = { x: touch.clientX, y: touch.clientY, time: now };
		};

		const onTouchCancel = (): void => {
			if (pinchStartDistance > 0) {
				pinchStartDistance = 0;
				commitZoomGesture();
			}
			singleTouchStart = null;
		};

		// Ctrl+wheel is a mouse-wheel zoom; trackpad pinch on desktop arrives as ctrl+wheel too.
		const onWheel = (event: WheelEvent): void => {
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			const point = toViewportPoint(event.clientX, event.clientY);
			if (!gestureRef.current) {
				wheelScale = 1;
				beginZoomGesture(point.x, point.y);
			}
			wheelScale *= Math.exp(-event.deltaY * 0.01);
			updateZoomGesture(wheelScale, point.x, point.y);
			window.clearTimeout(wheelCommitTimer);
			wheelCommitTimer = window.setTimeout(() => {
				wheelScale = 1;
				commitZoomGesture();
			}, WHEEL_ZOOM_COMMIT_DELAY_MS);
		};

		// iOS Safari fires its own gesture events for pinches; left alone they zoom the whole page.
		const blockNativeGesture = (event: Event): void => event.preventDefault();

		scroller.addEventListener('touchstart', onTouchStart, { passive: false });
		scroller.addEventListener('touchmove', onTouchMove, { passive: false });
		scroller.addEventListener('touchend', onTouchEnd, { passive: false });
		scroller.addEventListener('touchcancel', onTouchCancel);
		scroller.addEventListener('wheel', onWheel, { passive: false });
		scroller.addEventListener('gesturestart', blockNativeGesture);
		scroller.addEventListener('gesturechange', blockNativeGesture);
		return () => {
			window.clearTimeout(wheelCommitTimer);
			scroller.removeEventListener('touchstart', onTouchStart);
			scroller.removeEventListener('touchmove', onTouchMove);
			scroller.removeEventListener('touchend', onTouchEnd);
			scroller.removeEventListener('touchcancel', onTouchCancel);
			scroller.removeEventListener('wheel', onWheel);
			scroller.removeEventListener('gesturestart', blockNativeGesture);
			scroller.removeEventListener('gesturechange', blockNativeGesture);
		};
	}, [animateZoomTo, beginZoomGesture, commitZoomGesture, load.status, updateZoomGesture]);

	// Desktop: grab the page and drag it around like any PDF reader, instead of hunting for the
	// scrollbars once you've zoomed in. Mouse only: touch already pans natively, and pinch lives
	// in the touch handlers above.
	React.useEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller || load.status !== 'ready') return;
		let drag: { pointerId: number; x: number; y: number; left: number; top: number } | null = null;

		const onPointerDown = (event: PointerEvent): void => {
			if (event.pointerType !== 'mouse' || event.button !== 0 || gestureRef.current) return;
			// A press on the scrollbars themselves still works the normal way.
			const rect = scroller.getBoundingClientRect();
			if (event.clientX - rect.left >= scroller.clientWidth || event.clientY - rect.top >= scroller.clientHeight) return;
			drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
			scroller.setPointerCapture(event.pointerId);
			scroller.dataset.dragging = 'true';
			// Otherwise the browser starts dragging a ghost image of the canvas, or a text selection.
			event.preventDefault();
		};
		const onPointerMove = (event: PointerEvent): void => {
			if (!drag || event.pointerId !== drag.pointerId) return;
			scroller.scrollLeft = drag.left - (event.clientX - drag.x);
			scroller.scrollTop = drag.top - (event.clientY - drag.y);
		};
		const endDrag = (event: PointerEvent): void => {
			if (!drag || event.pointerId !== drag.pointerId) return;
			drag = null;
			delete scroller.dataset.dragging;
			if (scroller.hasPointerCapture(event.pointerId)) scroller.releasePointerCapture(event.pointerId);
		};

		scroller.addEventListener('pointerdown', onPointerDown);
		scroller.addEventListener('pointermove', onPointerMove);
		scroller.addEventListener('pointerup', endDrag);
		scroller.addEventListener('pointercancel', endDrag);
		return () => {
			scroller.removeEventListener('pointerdown', onPointerDown);
			scroller.removeEventListener('pointermove', onPointerMove);
			scroller.removeEventListener('pointerup', endDrag);
			scroller.removeEventListener('pointercancel', endDrag);
			delete scroller.dataset.dragging;
		};
	}, [load.status]);

	// ── Layout ──────────────────────────────────────────────────────────────

	const pageSizes = load.status === 'ready' ? load.pageSizes : [];
	const fitPageWidth = Math.max(0, Math.min(MAX_PAGE_WIDTH_PX, containerWidth - PAGES_PADDING_PX * 2));
	const pageCssWidth = fitPageWidth * zoom;
	const padding = PAGES_PADDING_PX * zoom;
	const gap = PAGE_GAP_PX * zoom;
	const layout = React.useMemo<PageLayout>(() => {
		// Fractional heights on purpose: rounding each page would add up to a few pixels of drift
		// across a long document and break the "everything scales by the same factor" guarantee.
		const heights = pageSizes.map((size) => (size.width > 0 ? pageCssWidth * (size.height / size.width) : 0));
		const offsets: number[] = [];
		let cursor = padding;
		for (const height of heights) {
			offsets.push(cursor);
			cursor += height + gap;
		}
		return { heights, offsets, gap, pageWidth: pageCssWidth, padding };
	}, [gap, padding, pageCssWidth, pageSizes]);
	layoutRef.current = layout;

	// Open where you left off, once the pages have their real sizes.
	React.useLayoutEffect(() => {
		if (positionRestoredRef.current || load.status !== 'ready' || fitPageWidth <= 0) return;
		const scroller = scrollerRef.current;
		if (!scroller) return;
		positionRestoredRef.current = true;
		const saved = readPdfViewerPosition(authUserId, positionKey);
		if (!saved || saved.page > layout.offsets.length) return;
		const anchor = { index: saved.page - 1, fraction: saved.fraction };
		scroller.scrollTop = scrollTopForAnchor(layout, anchor);
		anchorRef.current = anchor;
		setScroll({ top: scroller.scrollTop, height: scroller.clientHeight });
	}, [authUserId, fitPageWidth, layout, load.status, positionKey]);

	// The fit width changes when the desktop page panel opens or closes, or a phone rotates.
	// Every page resizes, so a fixed scrollTop would land on a different page; put the reader
	// back on the same page, the same distance down it.
	React.useLayoutEffect(() => {
		if (!positionRestoredRef.current) return;
		const previous = previousFitWidthRef.current;
		previousFitWidthRef.current = fitPageWidth;
		if (previous === null || previous === fitPageWidth || gestureRef.current) return;
		const scroller = scrollerRef.current;
		const anchor = anchorRef.current;
		if (!scroller || !anchor) return;
		scroller.scrollTop = scrollTopForAnchor(layoutRef.current, anchor);
		setScroll({ top: scroller.scrollTop, height: scroller.clientHeight });
	}, [fitPageWidth]);

	const pageCount = pageSizes.length;
	// Zoomed in, a page fills the screen on its own; drawing fewer neighbours keeps memory in check.
	const extraRenderedPages = zoom > 1.5 ? 1 : 2;
	const firstVisible = pageCount > 0 ? findLastAtOrBefore(layout.offsets, scroll.top) : 0;
	const lastVisible = pageCount > 0 ? findLastAtOrBefore(layout.offsets, scroll.top + scroll.height) : 0;
	const renderFrom = Math.max(0, firstVisible - extraRenderedPages);
	const renderTo = Math.min(pageCount - 1, lastVisible + extraRenderedPages);
	// The page counter follows whichever page covers the upper part of the screen.
	const currentPage = pageCount > 0 ? findLastAtOrBefore(layout.offsets, scroll.top + scroll.height * 0.35) + 1 : 0;

	// ── Search ──────────────────────────────────────────────────────────────

	const currentPageRef = React.useRef(currentPage);
	currentPageRef.current = currentPage;
	const searchRef = React.useRef(search);
	searchRef.current = search;

	// Read page text one page at a time, in order, the first time anyone searches. Matches
	// show up as pages come in, so a long document is useful before it's fully read.
	React.useEffect(() => {
		if (!textWanted || load.status !== 'ready') return;
		const { pdf } = load;
		const total = load.pageSizes.length;
		let cancelled = false;
		void (async () => {
			const texts = pageTextsRef.current;
			let lastFlush = performance.now();
			for (let index = texts.length; index < total; index += 1) {
				let pageText: PdfPageText;
				try {
					pageText = await readPdfPageText(pdf, index + 1);
				} catch (error) {
					// Closing the viewer destroys the document mid-read; that's not worth a log line.
					if (cancelled) return;
					console.error(`[pdf-viewer] failed while reading text on page ${index + 1}`, error);
					pageText = EMPTY_PDF_PAGE_TEXT;
				}
				if (cancelled || pageTextsRef.current !== texts) return;
				texts.push(pageText);
				const now = performance.now();
				if (index === total - 1 || now - lastFlush > TEXT_READ_FLUSH_MS) {
					lastFlush = now;
					setPageTextsRead(texts.length);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [load, textWanted]);

	// Wait for typing to settle; re-scanning a long PDF on every keystroke is just heat.
	React.useEffect(() => {
		const timer = window.setTimeout(() => {
			const needle = foldSearchQuery(searchQuery);
			if (needle === searchNeedleRef.current) return;
			searchNeedleRef.current = needle;
			// Like a browser's find: the first hit shown is the next one from where you're reading.
			searchStartPageRef.current = Math.max(0, currentPageRef.current - 1);
			setActiveMatch(-1);
			setSearchNeedle(needle);
			if (needle) setTextWanted(true);
		}, SEARCH_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	}, [searchQuery]);

	// Search whatever pages have been read since last time; earlier results are kept as-is.
	React.useEffect(() => {
		setSearch((previous) => {
			if (!searchNeedle) return previous.needle ? EMPTY_SEARCH : previous;
			const pages = pageTextsRef.current;
			const fresh = previous.needle !== searchNeedle || previous.searchedPages > pages.length;
			if (!fresh && previous.searchedPages === pages.length) return previous;
			const base = fresh ? { ...EMPTY_SEARCH, needle: searchNeedle } : previous;
			const matches = base.matches.slice();
			let hasText = base.hasText;
			for (let index = base.searchedPages; index < pages.length; index += 1) {
				if (pages[index].hasText) hasText = true;
				findMatchesOnPage(pages[index], index, searchNeedle, MAX_SEARCH_MATCHES - matches.length, matches);
			}
			return { needle: searchNeedle, matches, searchedPages: pages.length, hasText };
		});
	}, [pageTextsRead, searchNeedle]);

	// Pick the first hit at or after the page you were on; wrap to the top once every page is read.
	React.useEffect(() => {
		if (activeMatch >= 0 || search.matches.length === 0) return;
		const startPage = searchStartPageRef.current;
		let index = search.matches.findIndex((match) => match.pageIndex >= startPage);
		if (index < 0 && search.searchedPages >= pageCount) index = 0;
		if (index < 0) return;
		setActiveMatch(index);
		setMatchJumpTick((tick) => tick + 1);
	}, [activeMatch, pageCount, search]);

	const scrollToMatch = React.useCallback((match: PdfSearchMatch): void => {
		const scroller = scrollerRef.current;
		const pages = pagesRef.current;
		const layout = layoutRef.current;
		const rect = match.rects[0];
		if (!scroller || !pages || !rect || gestureRef.current) return;
		const pageTop = layout.offsets[match.pageIndex];
		const pageHeight = layout.heights[match.pageIndex];
		if (pageTop === undefined || !pageHeight) return;
		// Only move when the hit isn't comfortably on screen already, so stepping through hits
		// on the same screen doesn't make the page jump about.
		const top = pages.offsetTop + pageTop + rect.top * pageHeight;
		const height = rect.height * pageHeight;
		const margin = Math.min(80, scroller.clientHeight * 0.15);
		if (top < scroller.scrollTop + margin || top + height > scroller.scrollTop + scroller.clientHeight - margin) {
			scroller.scrollTop = Math.max(0, top - scroller.clientHeight * 0.35);
		}
		const left = pages.offsetLeft + layout.padding + rect.left * layout.pageWidth;
		const width = rect.width * layout.pageWidth;
		if (left < scroller.scrollLeft || left + width > scroller.scrollLeft + scroller.clientWidth) {
			scroller.scrollLeft = Math.max(0, left + width / 2 - scroller.clientWidth / 2);
		}
	}, []);

	React.useEffect(() => {
		const match = searchRef.current.matches[activeMatch];
		if (match) scrollToMatch(match);
	}, [activeMatch, matchJumpTick, scrollToMatch]);

	const stepMatch = React.useCallback((direction: 1 | -1): void => {
		const total = searchRef.current.matches.length;
		if (total === 0) return;
		setActiveMatch((current) => (current < 0 ? (direction > 0 ? 0 : total - 1) : (current + direction + total) % total));
		// Bumped even when the index doesn't change (one hit, pressing next) so it scrolls back to it.
		setMatchJumpTick((tick) => tick + 1);
	}, []);

	const openSearch = React.useCallback((): void => {
		setSearchOpen(true);
		// Already open (Ctrl+F again): put the cursor back in the box.
		searchInputRef.current?.focus();
		searchInputRef.current?.select();
	}, []);

	const closeSearch = React.useCallback((): void => {
		searchOpenRef.current = false;
		setSearchOpen(false);
	}, []);

	React.useEffect(() => {
		if (!searchOpen) return;
		searchInputRef.current?.focus();
		searchInputRef.current?.select();
	}, [searchOpen]);

	const handleSearchKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>): void => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		stepMatch(event.shiftKey ? -1 : 1);
		// On a phone the keyboard covers half the hit you just asked to see.
		if (isCoarsePointer) event.currentTarget.blur();
	}, [isCoarsePointer, stepMatch]);

	const highlightsByPage = React.useMemo(() => {
		const byPage = new Map<number, PdfPageHighlight[]>();
		if (!searchOpen) return byPage;
		search.matches.forEach((match, index) => {
			const list = byPage.get(match.pageIndex);
			if (list) list.push({ index, rects: match.rects });
			else byPage.set(match.pageIndex, [{ index, rects: match.rects }]);
		});
		return byPage;
	}, [search.matches, searchOpen]);
	const activeMatchPageIndex = searchOpen ? (search.matches[activeMatch]?.pageIndex ?? -1) : -1;

	// Keyboard: Ctrl+F searches (instead of the browser's find, which can't see inside a canvas),
	// Enter/F3 step through hits, Escape closes (search, then the page panel, then the viewer),
	// Page Up/Down and Left/Right move a page, Home/End jump to the ends, Up/Down scroll a little.
	// The page keys are ignored while typing in a text box.
	React.useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			const key = event.key.toLowerCase();
			if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'f') {
				event.preventDefault();
				openSearch();
				return;
			}
			if (event.key === 'F3' || ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'g')) {
				if (!searchOpenRef.current) return;
				event.preventDefault();
				stepMatch(event.shiftKey ? -1 : 1);
				return;
			}
			if (event.key === 'Escape') {
				if (searchOpenRef.current) closeSearch();
				else if (navigatorOpenRef.current) closeNavigator();
				else requestClose();
				return;
			}
			const target = event.target as HTMLElement | null;
			if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			const scroller = scrollerRef.current;
			const pageTotal = layoutRef.current.offsets.length;
			if (!scroller || pageTotal === 0) return;
			const current = findLastAtOrBefore(layoutRef.current.offsets, scroller.scrollTop + scroller.clientHeight * 0.35) + 1;
			let handled = true;
			switch (event.key) {
				case 'PageDown':
				case 'ArrowRight':
					goToPage(current + 1);
					break;
				case 'PageUp':
				case 'ArrowLeft':
					goToPage(current - 1);
					break;
				case 'Home':
					goToPage(1);
					break;
				case 'End':
					goToPage(pageTotal);
					break;
				case 'ArrowDown':
					scroller.scrollBy({ top: ARROW_KEY_SCROLL_PX });
					break;
				case 'ArrowUp':
					scroller.scrollBy({ top: -ARROW_KEY_SCROLL_PX });
					break;
				default:
					handled = false;
			}
			if (handled) event.preventDefault();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [closeNavigator, closeSearch, goToPage, openSearch, requestClose, stepMatch]);

	const searchTotal = search.matches.length;
	const readingText = textWanted && pageTextsRead < pageCount;
	const searchPending = foldSearchQuery(searchQuery) !== searchNeedle || search.needle !== searchNeedle || readingText;
	const searchStatus = !searchNeedle
		? ''
		: searchTotal > 0
			? `${activeMatch >= 0 ? activeMatch + 1 : '–'} / ${searchTotal}${searchTotal >= MAX_SEARCH_MATCHES ? '+' : ''}${readingText ? '…' : ''}`
			: searchPending
				? t('documents.searchSearching')
				// No text at all means a scan (a picture of pages), not a PDF that happens to lack the word.
				: search.hasText
					? t('documents.searchNoMatches')
					: t('documents.searchNoText');

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

	// Named pageNavigator, not navigator: that would shadow window.navigator, which the load
	// effect above reads for navigator.onLine.
	const pageNavigator = load.status === 'ready' && navigatorOpen ? (
		<PdfPageNavigator
			pdf={load.pdf}
			pageSizes={load.pageSizes}
			currentPage={currentPage}
			variant={isCoarsePointer ? 'sheet' : 'side'}
			cache={thumbnailCacheRef.current}
			t={t}
			onSelectPage={handleSelectPage}
			onClose={closeNavigator}
		/>
	) : null;

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
						{load.status === 'ready' ? (
							<>
								<button
									type="button"
									className={`${styles.iconButton}${searchOpen ? ` ${styles.iconButtonActive}` : ''}`}
									onClick={() => (searchOpen ? closeSearch() : openSearch())}
									aria-label={t('documents.search')}
									aria-pressed={searchOpen}
									title={t('documents.search')}
								>
									<FontAwesomeIcon icon={faMagnifyingGlass} />
								</button>
								<button
									type="button"
									className={`${styles.iconButton}${navigatorOpen ? ` ${styles.iconButtonActive}` : ''}`}
									onClick={() => (navigatorOpen ? closeNavigator() : setNavigatorOpen(true))}
									aria-label={t('documents.pagesPanel')}
									aria-pressed={navigatorOpen}
									title={t('documents.pagesPanel')}
								>
									<FontAwesomeIcon icon={faTableColumns} />
								</button>
								<div className={styles.zoomControls}>
									<button
										type="button"
										className={`${styles.iconButton} ${styles.zoomStep}`}
										onClick={() => zoomAroundCenter(zoomRef.current / ZOOM_BUTTON_STEP)}
										disabled={zoom <= MIN_ZOOM}
										aria-label={t('documents.zoomOut')}
										title={t('documents.zoomOut')}
									>
										<FontAwesomeIcon icon={faMagnifyingGlassMinus} />
									</button>
									<button
										type="button"
										className={styles.zoomValue}
										onClick={() => zoomAroundCenter(MIN_ZOOM)}
										aria-label={t('documents.zoomReset')}
										title={t('documents.zoomReset')}
									>
										{Math.round(zoom * 100)}%
									</button>
									<button
										type="button"
										className={`${styles.iconButton} ${styles.zoomStep}`}
										onClick={() => zoomAroundCenter(zoomRef.current * ZOOM_BUTTON_STEP)}
										disabled={zoom >= MAX_ZOOM}
										aria-label={t('documents.zoomIn')}
										title={t('documents.zoomIn')}
									>
										<FontAwesomeIcon icon={faMagnifyingGlassPlus} />
									</button>
								</div>
							</>
						) : null}
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
				{searchOpen && load.status === 'ready' ? (
					<div className={styles.searchBar} role="search">
						<div className={styles.searchField}>
							<FontAwesomeIcon icon={faMagnifyingGlass} className={styles.searchIcon} aria-hidden="true" />
							{/* type="text", not "search": Samsung's keyboard does odd things with special input types. */}
							<input
								ref={searchInputRef}
								className={styles.searchInput}
								type="text"
								enterKeyHint="search"
								autoComplete="off"
								autoCorrect="off"
								spellCheck={false}
								value={searchQuery}
								onChange={(event) => setSearchQuery(event.target.value)}
								onKeyDown={handleSearchKeyDown}
								placeholder={t('documents.searchPlaceholder')}
								aria-label={t('documents.searchPlaceholder')}
							/>
						</div>
						<span className={styles.searchCount} aria-live="polite" title={searchStatus}>{searchStatus}</span>
						<button
							type="button"
							className={styles.iconButton}
							onClick={() => stepMatch(-1)}
							disabled={searchTotal === 0}
							aria-label={t('documents.searchPrevious')}
							title={t('documents.searchPrevious')}
						>
							<FontAwesomeIcon icon={faChevronUp} />
						</button>
						<button
							type="button"
							className={styles.iconButton}
							onClick={() => stepMatch(1)}
							disabled={searchTotal === 0}
							aria-label={t('documents.searchNext')}
							title={t('documents.searchNext')}
						>
							<FontAwesomeIcon icon={faChevronDown} />
						</button>
						<button
							type="button"
							className={styles.iconButton}
							onClick={closeSearch}
							aria-label={t('documents.searchClose')}
							title={t('documents.searchClose')}
						>
							<FontAwesomeIcon icon={faXmark} />
						</button>
					</div>
				) : null}
				<div className={styles.body}>
					{!isCoarsePointer ? pageNavigator : null}
					<div ref={scrollerRef} className={styles.scroller} onScroll={handleScroll}>
						{load.status === 'ready' && fitPageWidth > 0 ? (
							<div
								ref={pagesRef}
								className={styles.pages}
								style={{ width: pageCssWidth + padding * 2, padding, gap }}
							>
								{pageSizes.map((_size, index) => (
									<PdfPage
										key={index}
										pdf={load.pdf}
										pageNumber={index + 1}
										cssWidth={pageCssWidth}
										cssHeight={layout.heights[index]}
										shouldRender={index >= renderFrom && index <= renderTo}
										highlights={highlightsByPage.get(index)}
										activeHighlight={index === activeMatchPageIndex ? activeMatch : -1}
									/>
								))}
							</div>
						) : null}
						{load.status === 'loading' ? <p className={styles.status}>{t('documents.viewerLoading')}</p> : null}
						{errorMessage ? <p className={styles.status}>{errorMessage}</p> : null}
					</div>
					{isCoarsePointer && pageNavigator ? (
						<div
							className={styles.sheetBackdrop}
							onClick={(event) => {
								if (event.target === event.currentTarget) closeNavigator();
							}}
						>
							{pageNavigator}
						</div>
					) : null}
				</div>
			</section>
		</div>
	);

	return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
