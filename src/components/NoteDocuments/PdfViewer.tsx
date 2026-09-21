import React from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faArrowsRotate, faChevronDown, faChevronUp, faCloud, faCloudArrowUp, faCommentDots, faTriangleExclamation, faMagnifyingGlass, faMagnifyingGlassMinus, faMagnifyingGlassPlus, faPen, faTableColumns, faXmark } from '@fortawesome/free-solid-svg-icons';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { NoteDocumentRecord } from '../../core/noteDocumentApi';
import { resolveNoteDocumentViewBlob } from '../../core/noteDocumentStore';
import { DocumentShareMenu } from './DocumentShareMenu';
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
import {
	MarkupCalibrationLayer,
	MarkupDraftLayer,
	MarkupLayer,
	MarkupPinLayer,
	MarkupSelectionLayer,
	MarkupTextEditor,
	MarkupTextLayer,
	type MarkupTextEditorHandlers,
} from './markup/MarkupLayer';
import { scaleLabel, type MeasureContext } from './markup/markupMeasure';
import { MarkupScalePanel } from './markup/MarkupScalePanel';
import { MarkupToolbar, type MarkupStyleControls } from './markup/MarkupToolbar';
import { calloutStrokeWidth, fitStampWidth, markupBounds, rotateSymbol, roundUnit, translateMarkup } from './markup/markupGeometry';
import { MarkupPanel, type MarkupPanelTab } from './markup/MarkupPanel';
import { MAX_RECENT_SYMBOLS, styleForTool, useMarkupPrefs } from './markup/markupPrefs';
import { createMarkupDraftStore, usePdfMarkup, type MarkupDraftStore } from './markup/markupStore';
import { createMarkupId, stampDefinition, type CommentMarkup, type Markup, type MarkupAuthor, type MarkupTool, type TypedMarkup } from './markup/markupTypes';
import { useMarkupDrawing, type MarkupStampChoice, type PolyControls } from './markup/useMarkupDrawing';
import { resolveKnownUserById } from '../../core/userIdentityCache';
import { useDocumentManager } from '../../core/DocumentManagerContext';
import styles from './PdfViewer.module.css';

// This whole module is lazy-loaded from DocumentsPanel, so pdf.js (and its ~1 MB worker)
// only downloads the first time someone actually opens a PDF.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfViewerProps = {
	document: NoteDocumentRecord;
	/** Scopes the remembered reading position to this login. */
	authUserId?: string | null;
	/** Editors can mark up; everyone else sees the markup read-only (D4). */
	canEdit?: boolean;
	onClose: () => void;
	onDownload: (document: NoteDocumentRecord) => void;
	/**
	 * Opened from a search result: the viewer starts with its own search on this text, which jumps to
	 * the first hit from the page you'd be on — the same behaviour as typing it into the search box.
	 */
	initialSearch?: string;
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
// Fit-to-width fills the viewer, but never past this many screen pixels per PDF point (about 150%
// of printed size). A 36" plan fills a big monitor; a letter page stops at a comfortable reading
// size instead of stretching to 2500px of giant text. Zooming in still goes as far as it ever did.
const MAX_FIT_PX_PER_POINT = 2;
// Phones: room under the last page so the floating page pill never sits on top of its bottom edge.
const PAGE_PILL_CLEARANCE_PX = 56;
const MIN_ZOOM = 1;
// How far you can zoom in: at least 5×, and on a big sheet far enough that one PDF point (1/72")
// is MAX_ZOOM_PX_PER_POINT screen pixels, so a 1" scale bar on a 36" plan can be picked out exactly.
const MIN_MAX_ZOOM = 5;
const MAX_ZOOM_LIMIT = 64;
const MAX_ZOOM_PX_PER_POINT = 10;
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
// Zoomed in past that cap, the on-screen part of a page is redrawn sharp once scrolling has been
// still this long, with this share of the view added on each side so small pans stay sharp.
const DETAIL_SETTLE_MS = 150;
const DETAIL_MARGIN = 0.25;
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
const NO_MARKUP_IDS: ReadonlySet<string> = new Set();
const NO_MARKUPS: readonly Markup[] = [];
const NO_PAGE_SIZES: readonly PageSize[] = [];
// Desktop tool shortcuts while marking up (shown in the tool tooltips).
const MARKUP_TOOL_KEYS: Record<string, MarkupTool | undefined> = {
	v: 'select',
	p: 'pen',
	h: 'highlighter',
	e: 'eraser',
	l: 'line',
	a: 'arrow',
	r: 'rect',
	o: 'ellipse',
	t: 'text',
	c: 'cloud',
	k: 'callout',
	m: 'move',
	s: 'stamp',
	y: 'symbol',
	n: 'comment',
	d: 'length',
	w: 'path',
	q: 'area',
};
// The tools that show the page's scale in the options row.
const MEASURE_TOOLS: ReadonlySet<MarkupTool> = new Set<MarkupTool>(['length', 'path', 'area', 'calibrate']);
const MARKUP_NUDGE: Record<string, [number, number] | undefined> = {
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
};

function clampZoom(value: number, maxZoom: number): number {
	return Math.min(maxZoom, Math.max(MIN_ZOOM, value));
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
	/** The page's size in page units (pdf.js viewport at scale 1): the markup coordinate system. */
	pageWidth: number;
	pageHeight: number;
	markups: readonly Markup[];
	draftStore: MarkupDraftStore;
	/** The selected markup, when it's on this page. */
	selectedMarkup: Markup | null;
	/** The text note, callout or stamp being typed, when it's on this page. */
	textEdit: TypedMarkup | null;
	textEditor: MarkupTextEditorHandlers;
	/** A comment being written on this page, not saved yet. */
	pendingComment: CommentMarkup | null;
	/** The comment open in the markup panel, highlighted on its pin. */
	activeCommentId: string | null;
	/** This page's scale for measurement labels (null: not set). */
	pageScale: MeasureContext['scale'];
	noScaleLabel: string;
	/** The calibration line while a scale is being calibrated (drawn on its own page). */
	calibrationStore: MarkupDraftStore;
	/** The viewer's scroll box, for working out which part of a zoomed-in page is on screen. */
	scrollerRef: React.RefObject<HTMLDivElement | null>;
};

const PdfPage = React.memo(function PdfPage(props: PdfPageProps): React.JSX.Element {
	const { pdf, pageNumber, cssWidth, shouldRender } = props;
	const hostRef = React.useRef<HTMLDivElement | null>(null);
	const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
	const [drawn, setDrawn] = React.useState(false);
	const measure = React.useMemo<MeasureContext>(() => ({ scale: props.pageScale, noScale: props.noScaleLabel }), [props.noScaleLabel, props.pageScale]);

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
			// Scrolled out of range: now pdf.js can drop this page's parsed drawing instructions.
			void pdf.getPage(pageNumber).then((page) => page.cleanup()).catch(() => undefined);
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
			// No page.cleanup() here. This runs on every zoom change too, and cleaning up threw away
			// the parsed page, so each redraw after a pinch re-read every line of a busy plan first.
			// The page is cleaned up when it scrolls out of range instead (above).
			if (nextCanvas) {
				nextCanvas.width = 0;
				nextCanvas.height = 0;
			}
		};
	}, [cssWidth, pageNumber, pdf, releaseCanvas, shouldRender]);

	React.useEffect(() => releaseCanvas, [releaseCanvas]);

	// Past MAX_CANVAS_PIXELS the page's own canvas is softer than the screen: fine for reading,
	// useless for picking out a 1" scale bar at 3000%. So when the cap is in play, the part of the
	// page on screen is drawn again at full sharpness on top, whenever scrolling or zooming settles.
	const detailRef = React.useRef<HTMLCanvasElement | null>(null);
	const releaseDetail = React.useCallback((): void => {
		const canvas = detailRef.current;
		if (!canvas) return;
		canvas.remove();
		canvas.width = 0;
		canvas.height = 0;
		detailRef.current = null;
	}, []);
	const { scrollerRef, pageWidth, pageHeight } = props;
	React.useEffect(() => {
		const host = hostRef.current;
		const scroller = scrollerRef.current;
		const pixelRatio = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 3);
		const fullWidthPx = cssWidth * pixelRatio;
		const capped = pageWidth > 0 && fullWidthPx * fullWidthPx * (pageHeight / pageWidth) > MAX_CANVAS_PIXELS * 1.1;
		if (!shouldRender || !capped || !host || !scroller) {
			releaseDetail();
			return;
		}
		let cancelled = false;
		let timer = 0;
		let task: ReturnType<PDFPageProxy['render']> | null = null;
		let pending: HTMLCanvasElement | null = null;
		const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

		const draw = async (): Promise<void> => {
			timer = 0;
			// A pinch in progress moves the whole page stack with a transform; wait until it lands.
			if (host.parentElement?.style.transform) {
				timer = window.setTimeout(() => void draw(), DETAIL_SETTLE_MS);
				return;
			}
			const pageRect = host.getBoundingClientRect();
			const viewRect = scroller.getBoundingClientRect();
			if (pageRect.width <= 0 || pageRect.height <= 0) return;
			const marginX = viewRect.width * DETAIL_MARGIN;
			const marginY = viewRect.height * DETAIL_MARGIN;
			const left = clamp01((viewRect.left - marginX - pageRect.left) / pageRect.width);
			const right = clamp01((viewRect.right + marginX - pageRect.left) / pageRect.width);
			const top = clamp01((viewRect.top - marginY - pageRect.top) / pageRect.height);
			const bottom = clamp01((viewRect.bottom + marginY - pageRect.top) / pageRect.height);
			if (right <= left || bottom <= top) {
				releaseDetail();
				return;
			}
			task?.cancel();
			try {
				const page = await pdf.getPage(pageNumber);
				if (cancelled) return;
				const base = page.getViewport({ scale: 1 });
				let scale = (cssWidth / base.width) * pixelRatio;
				const regionPixels = (right - left) * base.width * scale * (bottom - top) * base.height * scale;
				if (regionPixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / regionPixels);
				const viewport = page.getViewport({ scale });
				const x = Math.floor(left * viewport.width);
				const y = Math.floor(top * viewport.height);
				const canvas = document.createElement('canvas');
				pending = canvas;
				canvas.className = `${styles.canvas} ${styles.canvasDetail}`;
				canvas.setAttribute('aria-hidden', 'true');
				canvas.width = Math.max(1, Math.ceil(right * viewport.width) - x);
				canvas.height = Math.max(1, Math.ceil(bottom * viewport.height) - y);
				// Shift the drawing so the canvas holds just this piece of the page.
				task = page.render({ canvas, viewport, transform: [1, 0, 0, 1, -x, -y] });
				await task.promise;
				task = null;
				if (cancelled) return;
				canvas.style.left = `${(x / viewport.width) * 100}%`;
				canvas.style.top = `${(y / viewport.height) * 100}%`;
				canvas.style.width = `${(canvas.width / viewport.width) * 100}%`;
				canvas.style.height = `${(canvas.height / viewport.height) * 100}%`;
				releaseDetail();
				host.appendChild(canvas);
				detailRef.current = canvas;
				pending = null;
			} catch (error) {
				if ((error as { name?: string } | null)?.name === 'RenderingCancelledException') return;
				console.error(`[pdf-viewer] failed to sharpen page ${pageNumber}`, error);
			} finally {
				if (pending && pending !== detailRef.current) {
					pending.width = 0;
					pending.height = 0;
					pending = null;
				}
			}
		};
		const schedule = (): void => {
			if (timer) window.clearTimeout(timer);
			timer = window.setTimeout(() => void draw(), DETAIL_SETTLE_MS);
		};
		schedule();
		scroller.addEventListener('scroll', schedule, { passive: true });
		return () => {
			cancelled = true;
			if (timer) window.clearTimeout(timer);
			task?.cancel();
			scroller.removeEventListener('scroll', schedule);
		};
	}, [cssWidth, pageHeight, pageNumber, pageWidth, pdf, releaseDetail, scrollerRef, shouldRender]);

	React.useEffect(() => releaseDetail, [releaseDetail]);

	return (
		<div
			ref={hostRef}
			className={styles.page}
			// --markup-scale: screen pixels per page unit, which text markup sizes itself with.
			style={{ width: props.cssWidth, height: props.cssHeight, '--markup-scale': props.pageWidth > 0 ? props.cssWidth / props.pageWidth : 1 } as React.CSSProperties}
			data-pdf-page={pageNumber}
		>
			{!drawn ? <span className={styles.pagePlaceholder}>{pageNumber}</span> : null}
			{shouldRender && props.highlights ? props.highlights.map((highlight) => highlight.rects.map((rect, rectIndex) => (
				<span
					key={`${highlight.index}:${rectIndex}`}
					className={highlight.index === props.activeHighlight ? `${styles.highlight} ${styles.highlightActive}` : styles.highlight}
					style={{ left: `${rect.left * 100}%`, top: `${rect.top * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
					aria-hidden="true"
				/>
			))) : null}
			{shouldRender ? <MarkupLayer items={props.markups} pageWidth={props.pageWidth} pageHeight={props.pageHeight} measure={measure} /> : null}
			{shouldRender ? <MarkupTextLayer items={props.markups} pageWidth={props.pageWidth} pageHeight={props.pageHeight} /> : null}
			{shouldRender ? (
				<MarkupPinLayer items={props.markups} pending={props.pendingComment} activeId={props.activeCommentId} pageWidth={props.pageWidth} pageHeight={props.pageHeight} />
			) : null}
			{shouldRender ? <MarkupDraftLayer store={props.draftStore} page={pageNumber} pageWidth={props.pageWidth} pageHeight={props.pageHeight} measure={measure} /> : null}
			{shouldRender ? (
				<MarkupCalibrationLayer store={props.calibrationStore} page={pageNumber} pageWidth={props.pageWidth} pageHeight={props.pageHeight} cssWidth={props.cssWidth} />
			) : null}
			{shouldRender && props.selectedMarkup ? (
				<MarkupSelectionLayer markup={props.selectedMarkup} pageWidth={props.pageWidth} pageHeight={props.pageHeight} cssWidth={props.cssWidth} />
			) : null}
			{props.textEdit ? (
				<MarkupTextEditor key={props.textEdit.id} markup={props.textEdit} pageWidth={props.pageWidth} pageHeight={props.pageHeight} handlers={props.textEditor} />
			) : null}
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
	const [searchOpen, setSearchOpen] = React.useState(Boolean(props.initialSearch));
	const searchOpenRef = React.useRef(searchOpen);
	searchOpenRef.current = searchOpen;
	const [searchQuery, setSearchQuery] = React.useState(props.initialSearch ?? '');
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
	// Markup belongs to a server version (D7). A file still waiting to upload has no version yet.
	const markupVersionId = !noteDocument.isLocal && noteDocument.latestVersionId ? noteDocument.latestVersionId : null;
	const canMarkup = props.canEdit === true && Boolean(markupVersionId);
	// Markup syncs through the same server address as notes (the server checks access per room).
	const documentManager = useDocumentManager();
	const markup = usePdfMarkup(markupVersionId, { websocketUrl: documentManager.getWebsocketUrl(), canEdit: canMarkup });
	const [markupPrefs, updateMarkupPrefs] = useMarkupPrefs();
	const [markupTool, setMarkupTool] = React.useState<MarkupTool | null>(null);
	const markupToolRef = React.useRef(markupTool);
	markupToolRef.current = markupTool;
	const spaceHeldRef = React.useRef(false);
	const [markupDraftStore] = React.useState(createMarkupDraftStore);
	const [erasingMarkupIds, setErasingMarkupIds] = React.useState<ReadonlySet<string>>(NO_MARKUP_IDS);
	const [selectedMarkupId, setSelectedMarkupId] = React.useState<string | null>(null);
	const selectedMarkupIdRef = React.useRef(selectedMarkupId);
	selectedMarkupIdRef.current = selectedMarkupId;
	// The markup being dragged: hidden on its page while its preview follows the pointer.
	const [previewMarkupId, setPreviewMarkupId] = React.useState<string | null>(null);
	const [textEdit, setTextEdit] = React.useState<{ markup: TypedMarkup; isNew: boolean } | null>(null);
	const textEditRef = React.useRef(textEdit);
	textEditRef.current = textEdit;
	const textEditorElementRef = React.useRef<HTMLElement | null>(null);
	// Assigned once commitTextEdit exists further down; closing the viewer calls it first.
	const commitTextEditRef = React.useRef<() => void>(() => undefined);
	// Markup list and comments panel (beside the pages on desktop, a sheet on phones). Everyone can
	// open it; only editors can change anything in it.
	const [markupPanelOpen, setMarkupPanelOpen] = React.useState(false);
	const markupPanelOpenRef = React.useRef(markupPanelOpen);
	markupPanelOpenRef.current = markupPanelOpen;
	const [openCommentId, setOpenCommentId] = React.useState<string | null>(null);
	const openCommentIdRef = React.useRef(openCommentId);
	const [pendingComment, setPendingComment] = React.useState<CommentMarkup | null>(null);
	const pendingCommentRef = React.useRef(pendingComment);
	pendingCommentRef.current = pendingComment;
	const [commentText, setCommentText] = React.useState('');
	const commentTextRef = React.useRef(commentText);
	// The panel was opened just to write a new comment: cancelling closes it again.
	const panelOpenedForCommentRef = React.useRef(false);
	// Assigned once closeMarkupPanel exists further down; Back and Escape call it.
	const closeMarkupPanelRef = React.useRef<() => void>(() => undefined);
	// Comments first: it's what people open the panel for.
	const [markupPanelTab, setMarkupPanelTab] = React.useState<MarkupPanelTab>('comments');
	// Measuring: the scale panel, a calibration line waiting for its real length, and a path or area in progress.
	const [scalePanelOpen, setScalePanelOpen] = React.useState(false);
	const [calibrationPage, setCalibrationPage] = React.useState<number | null>(null);
	// The calibration line itself moves with every pointer event while its ends are dragged, so it
	// lives in a small store the line and the scale panel subscribe to, not in the viewer's state.
	const [calibrationStore] = React.useState(createMarkupDraftStore);
	const [polyPoints, setPolyPoints] = React.useState(0);
	const polyControlsRef = React.useRef<PolyControls | null>(null);
	// The measuring tool to go back to once a calibration is set or cancelled.
	const toolBeforeCalibrateRef = React.useRef<MarkupTool>('length');
	const zoomRef = React.useRef(zoom);
	zoomRef.current = zoom;
	// Set during layout below (it depends on the page sizes); the zoom gesture callbacks read it.
	const maxZoomRef = React.useRef(MIN_MAX_ZOOM);
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
	// Phones: every open layer (markup mode, search, the page panel sheet, the comments sheet) has its
	// own history entry above the viewer's, added when the layer opens (see the layer effect below).
	// How many of those entries are on the stack right now:
	const layerEntryCountRef = React.useRef(0);
	// The open layers, oldest first, so Back closes the most recent one.
	const layerOrderRef = React.useRef<string[]>([]);
	// Layers Back just closed: their entry is already gone, so the layer effect mustn't step back for them.
	const closedByBackRef = React.useRef(new Set<string>());
	// Our own history.go() after a layer closed on screen lands on one of our entries; that pop isn't Back.
	const ignoredPopsRef = React.useRef(0);
	// Closing the whole viewer: the layer effect leaves history alone while it happens.
	const viewerClosingRef = React.useRef(false);
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

	// Back closes the viewer first, leaving the sheet or browser underneath open. On phones that's the
	// system Back button; on desktop it's the browser's Back, which used to fall through to the app's
	// own history and shut the attachments sheet, dropping the reader back into the editor.
	// (The per-layer entries below stay a phone thing: on desktop the panels sit beside the page.)
	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		if (pendingHistoryCleanupRef.current != null) {
			window.clearTimeout(pendingHistoryCleanupRef.current);
			pendingHistoryCleanupRef.current = null;
		}
		let active = true;
		let didPush = false;
		const token = historyTokenRef.current;
		const closeLayer = (name: string): void => {
			if (name === 'panel') {
				closeMarkupPanelRef.current();
			} else if (name === 'markup') {
				markupToolRef.current = null;
				setMarkupTool(null);
			} else if (name === 'search') {
				searchOpenRef.current = false;
				setSearchOpen(false);
			} else if (name === 'navigator') {
				navigatorOpenRef.current = false;
				setNavigatorOpen(false);
			}
		};
		const onPopState = (event: PopStateEvent): void => {
			if (!active) return;
			if ((event.state as { __notePdfViewer?: string } | null)?.__notePdfViewer === token) {
				// Landed on one of this viewer's own entries.
				if (ignoredPopsRef.current > 0) {
					// Our own history.go() after a layer was closed on screen, not the Back button.
					ignoredPopsRef.current -= 1;
					return;
				}
				// Back popped a layer's entry: close the most recently opened layer. Nothing is pushed
				// back. Layers used to share the viewer's single entry and re-push it here, but an
				// entry pushed while handling Back (no tap involved) is one Chrome on Android marks as
				// skippable, so a later Back jumped straight past it, sometimes right out of the app.
				layerEntryCountRef.current = Math.max(0, layerEntryCountRef.current - 1);
				const top = layerOrderRef.current[layerOrderRef.current.length - 1];
				if (top) {
					closedByBackRef.current.add(top);
					closeLayer(top);
				}
				return;
			}
			// Back went below the viewer's own entry: close the viewer.
			layerEntryCountRef.current = 0;
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
				// Closed some other way while our entries are still current: remove them all, layers included.
				if (state?.__notePdfViewer === token) window.history.go(-(layerEntryCountRef.current + 1));
				layerEntryCountRef.current = 0;
				layerOrderRef.current = [];
			}, 0);
		};
	}, [isCoarsePointer]);

	// Phones: one history entry per open layer, added when the layer opens. Opening is a tap, so the
	// entry counts as user-made and Back stops at it. A layer closed on screen (its X, Done, a tap on
	// the dimmed page) steps back over its entry; a layer closed by Back already lost its entry.
	// Entries are interchangeable, so when one tap closes a layer and opens another (Add comment
	// closes the sheet and turns on the comment tool) the entry is reused instead of racing a
	// history.go() against a pushState().
	const openLayerKey = isCoarsePointer
		? [markupTool ? 'markup' : '', searchOpen ? 'search' : '', navigatorOpen ? 'navigator' : '', markupPanelOpen ? 'panel' : '']
			.filter(Boolean)
			.join(',')
		: '';
	React.useEffect(() => {
		if (!isCoarsePointer || typeof window === 'undefined') return;
		const open = openLayerKey ? openLayerKey.split(',') : [];
		const previous = layerOrderRef.current;
		const closed = previous.filter((name) => !open.includes(name));
		const opened = open.filter((name) => !previous.includes(name));
		if (closed.length === 0 && opened.length === 0) return;
		layerOrderRef.current = [...previous.filter((name) => open.includes(name)), ...opened];
		let closedOnScreen = 0;
		for (const name of closed) {
			if (closedByBackRef.current.has(name)) closedByBackRef.current.delete(name);
			else closedOnScreen += 1;
		}
		if (viewerClosingRef.current) return;
		const state = window.history.state as { __notePdfViewer?: string } | null;
		if (state?.__notePdfViewer !== historyTokenRef.current) return;
		const net = opened.length - closedOnScreen;
		if (net > 0) {
			for (let index = 0; index < net; index += 1) {
				window.history.pushState({ __notePdfViewer: historyTokenRef.current, __pdfLayer: true }, '');
			}
			layerEntryCountRef.current += net;
		} else if (net < 0) {
			const steps = Math.min(-net, layerEntryCountRef.current);
			if (steps > 0) {
				layerEntryCountRef.current -= steps;
				ignoredPopsRef.current += 1;
				window.history.go(-steps);
			}
		}
	}, [isCoarsePointer, openLayerKey]);

	const closeNavigator = React.useCallback((): void => {
		setNavigatorOpen(false);
	}, []);

	const requestClose = React.useCallback((): void => {
		// Before anything closes its layers, so the layer effect doesn't step back through history too.
		viewerClosingRef.current = true;
		// A text note still being typed gets saved, not thrown away with the viewer (same for a comment edit).
		commitTextEditRef.current();
		closeMarkupPanelRef.current();
		const state = typeof window !== 'undefined'
			? (window.history.state as { __notePdfViewer?: string } | null)
			: null;
		if (state?.__notePdfViewer === historyTokenRef.current) {
			navigatorOpenRef.current = false;
			setNavigatorOpen(false);
			searchOpenRef.current = false;
			setSearchOpen(false);
			markupToolRef.current = null;
			setMarkupTool(null);
			// One jump over the viewer's entry and any layer entries above it; the pop lands below the
			// viewer and the popstate handler closes it.
			const steps = layerEntryCountRef.current + 1;
			layerEntryCountRef.current = 0;
			layerOrderRef.current = [];
			window.history.go(-steps);
			return;
		}
		onCloseRef.current();
	}, [isCoarsePointer]);

	const openMarkup = React.useCallback((): void => {
		setMarkupTool(markupPrefs.tool);
		// On a phone the page panel covers the page you're about to draw on.
		if (isCoarsePointer) closeNavigator();
	}, [closeNavigator, isCoarsePointer, markupPrefs.tool]);

	const selectMarkupTool = React.useCallback((tool: MarkupTool): void => {
		setMarkupTool(tool);
		updateMarkupPrefs({ tool });
	}, [updateMarkupPrefs]);

	// Leaving the measuring tools puts the scale panel and any half-done calibration away.
	React.useEffect(() => {
		if (markupTool && MEASURE_TOOLS.has(markupTool)) return;
		setScalePanelOpen(false);
		calibrationStore.set(null);
		setCalibrationPage(null);
		setPolyPoints(0);
	}, [calibrationStore, markupTool]);

	const startCalibrating = React.useCallback((): void => {
		const current = markupToolRef.current;
		if (current && current !== 'calibrate' && MEASURE_TOOLS.has(current)) toolBeforeCalibrateRef.current = current;
		calibrationStore.set(null);
		setCalibrationPage(null);
		setScalePanelOpen(false);
		// Not saved as the remembered tool: calibrating is a one-off.
		setMarkupTool('calibrate');
	}, [calibrationStore]);

	// A calibration line was drawn: it stays up for fine-tuning while the panel asks for its real length.
	const handleCalibrate = React.useCallback((page: number): void => {
		setCalibrationPage(page);
		setScalePanelOpen(true);
	}, []);

	const closeScalePanel = React.useCallback((): void => {
		setScalePanelOpen(false);
		calibrationStore.set(null);
		setCalibrationPage(null);
		if (markupToolRef.current === 'calibrate') setMarkupTool(toolBeforeCalibrateRef.current);
	}, [calibrationStore]);
	const closeScalePanelRef = React.useRef(closeScalePanel);
	closeScalePanelRef.current = closeScalePanel;

	const { removeMany: removeMarkups, add: putMarkup, setPageScale } = markup;
	const handleEraseCommit = React.useCallback((ids: readonly string[]): void => {
		removeMarkups(ids);
		setErasingMarkupIds(NO_MARKUP_IDS);
	}, [removeMarkups]);

	const pageSizesRef = React.useRef<readonly PageSize[]>(NO_PAGE_SIZES);
	pageSizesRef.current = load.status === 'ready' ? load.pageSizes : NO_PAGE_SIZES;
	const markupItemsRef = React.useRef(markup.items);
	markupItemsRef.current = markup.items;

	const commitTextEdit = React.useCallback((): void => {
		const current = textEditRef.current;
		if (!current) return;
		textEditRef.current = null;
		setTextEdit(null);
		const target = current.markup;
		if (target.kind === 'stamp') {
			const typed = target.text.trim();
			// A custom stamp is nothing but its wording; an RFI stamp still says RFI without a number.
			if (!typed && stampDefinition(target.stamp).input === 'label') {
				if (!current.isNew) removeMarkups([target.id]);
				return;
			}
			putMarkup(fitStampWidth({ ...target, text: typed, updatedAt: Date.now() }));
			return;
		}
		const text = target.text.replace(/\s+$/, '');
		if (!text.trim()) {
			// Emptied out: an existing note goes away, and a new one was never really there.
			if (!current.isNew) removeMarkups([target.id]);
			return;
		}
		// Store the height it actually took up (a callout's author line included), so selecting and
		// erasing it hit the whole box.
		const size = pageSizesRef.current[target.page - 1];
		const scale = size && size.width > 0 ? layoutRef.current.pageWidth / size.width : 0;
		const element = textEditorElementRef.current;
		const measured = element && scale > 0 ? element.offsetHeight / scale : target.h;
		putMarkup({ ...target, text, h: roundUnit(Math.max(measured, target.fontSize)), updatedAt: Date.now() });
	}, [putMarkup, removeMarkups]);
	commitTextEditRef.current = commitTextEdit;

	const startTextEdit = React.useCallback((target: TypedMarkup, isNew: boolean): void => {
		commitTextEditRef.current();
		setSelectedMarkupId(null);
		const next = { markup: target, isNew };
		textEditRef.current = next;
		setTextEdit(next);
	}, []);

	// Callouts and stamps are signed with your name (remembered from sign-in, so it works offline).
	const markupAuthor = React.useMemo<MarkupAuthor | null>(() => {
		const userId = props.authUserId;
		if (!userId) return null;
		return { id: userId, name: resolveKnownUserById(userId)?.name?.trim() ?? '' };
	}, [props.authUserId]);

	const stampChoice = React.useMemo<MarkupStampChoice>(() => {
		const definition = stampDefinition(markupPrefs.stampPreset);
		return { preset: definition.preset, label: t(definition.labelKey), color: definition.color };
	}, [markupPrefs.stampPreset, t]);

	const textEditorHandlers = React.useMemo<MarkupTextEditorHandlers>(() => ({
		placeholders: {
			text: t('documents.markupTextPlaceholder'),
			stampNumber: t('documents.markupStampNumberPlaceholder'),
			stampLabel: t('documents.markupStampLabelPlaceholder'),
		},
		onChange: (text) => {
			const current = textEditRef.current;
			if (!current) return;
			// A stamp widens as its number is typed, so the frame always fits the wording.
			const edited: TypedMarkup = current.markup.kind === 'stamp' ? fitStampWidth({ ...current.markup, text }) : { ...current.markup, text };
			const next = { ...current, markup: edited };
			textEditRef.current = next;
			setTextEdit(next);
		},
		onCommit: () => commitTextEditRef.current(),
		setElement: (element) => {
			textEditorElementRef.current = element;
		},
	}), [t]);

	const deleteSelectedMarkup = React.useCallback((): void => {
		const id = selectedMarkupIdRef.current;
		if (!id) return;
		removeMarkups([id]);
		setSelectedMarkupId(null);
	}, [removeMarkups]);

	const nudgeSelectedMarkup = React.useCallback((dx: number, dy: number): void => {
		const id = selectedMarkupIdRef.current;
		const target = id ? markupItemsRef.current.find((item) => item.id === id) : undefined;
		if (!target) return;
		putMarkup({ ...translateMarkup(target, dx, dy), updatedAt: Date.now() });
	}, [putMarkup]);

	const rotateSelectedMarkup = React.useCallback((): void => {
		const id = selectedMarkupIdRef.current;
		const target = id ? markupItemsRef.current.find((item) => item.id === id) : undefined;
		if (target?.kind !== 'symbol') return;
		putMarkup({ ...rotateSymbol(target), updatedAt: Date.now() });
	}, [putMarkup]);

	// ── Comments and the markup panel ───────────────────────────────────────

	const { addComment, peekCommentNumber, addReply, removeReply } = markup;

	/**
	 * Scrolls a markup into view. On phones it lands in the top part, above the panel sheet.
	 * onlyIfHidden: leave the page alone when it's already in that visible part.
	 */
	const revealMarkup = React.useCallback((target: Markup, onlyIfHidden = false): void => {
		const scroller = scrollerRef.current;
		const pages = pagesRef.current;
		const layout = layoutRef.current;
		const size = pageSizesRef.current[target.page - 1];
		const pageTop = layout.offsets[target.page - 1];
		const pageHeight = layout.heights[target.page - 1];
		if (!scroller || !pages || !size || pageTop === undefined || !pageHeight || size.width <= 0 || size.height <= 0) return;
		const bounds = markupBounds(target);
		const centreX = (bounds.x + bounds.w / 2) / size.width;
		const centreY = (bounds.y + bounds.h / 2) / size.height;
		const top = pages.offsetTop + pageTop + centreY * pageHeight;
		const left = pages.offsetLeft + layout.padding + centreX * layout.pageWidth;
		if (onlyIfHidden) {
			// The phone sheet covers the lower ~62% of the page area.
			const visibleTop = scroller.scrollTop + scroller.clientHeight * 0.06;
			const visibleBottom = scroller.scrollTop + scroller.clientHeight * (isCoarsePointer ? 0.36 : 0.9);
			const inViewX = left >= scroller.scrollLeft + 16 && left <= scroller.scrollLeft + scroller.clientWidth - 16;
			if (top >= visibleTop && top <= visibleBottom && inViewX) return;
		}
		scroller.scrollTop = Math.max(0, top - scroller.clientHeight * (isCoarsePointer ? 0.2 : 0.4));
		scroller.scrollLeft = Math.max(0, left - scroller.clientWidth / 2);
	}, [isCoarsePointer]);

	const setCommentBuffer = React.useCallback((text: string): void => {
		commentTextRef.current = text;
		setCommentText(text);
	}, []);

	const setOpenComment = React.useCallback((id: string | null): void => {
		openCommentIdRef.current = id;
		setOpenCommentId(id);
	}, []);

	/** Saves what's typed into an open (already posted) comment. An emptied comment keeps its text; deleting is explicit. */
	const saveOpenComment = React.useCallback((): void => {
		const id = openCommentIdRef.current;
		const target = id ? markupItemsRef.current.find((item) => item.id === id) : undefined;
		if (!canMarkup || !target || target.kind !== 'comment') return;
		const text = commentTextRef.current.trim();
		if (!text || text === target.text) return;
		putMarkup({ ...target, text, updatedAt: Date.now() });
	}, [canMarkup, putMarkup]);

	const openComment = React.useCallback((target: CommentMarkup): void => {
		if (openCommentIdRef.current !== target.id) saveOpenComment();
		setPendingComment(null);
		setOpenComment(target.id);
		setCommentBuffer(target.text);
		if (isCoarsePointer) closeNavigator();
		setMarkupPanelOpen(true);
	}, [closeNavigator, isCoarsePointer, saveOpenComment, setCommentBuffer, setOpenComment]);

	const showMarkupList = React.useCallback((): void => {
		saveOpenComment();
		setPendingComment(null);
		setOpenComment(null);
	}, [saveOpenComment, setOpenComment]);

	const closeMarkupPanel = React.useCallback((): void => {
		saveOpenComment();
		setPendingComment(null);
		setOpenComment(null);
		panelOpenedForCommentRef.current = false;
		markupPanelOpenRef.current = false;
		setMarkupPanelOpen(false);
	}, [saveOpenComment, setOpenComment]);
	closeMarkupPanelRef.current = closeMarkupPanel;

	const toggleMarkupPanel = React.useCallback((): void => {
		if (markupPanelOpenRef.current) {
			closeMarkupPanel();
			return;
		}
		if (isCoarsePointer) closeNavigator();
		setMarkupPanelOpen(true);
	}, [closeMarkupPanel, closeNavigator, isCoarsePointer]);

	const placeComment = React.useCallback((point: { page: number; x: number; y: number }): void => {
		commitTextEditRef.current();
		saveOpenComment();
		const now = Date.now();
		setOpenComment(null);
		setCommentBuffer('');
		setSelectedMarkupId(null);
		setPendingComment({
			id: createMarkupId(),
			kind: 'comment',
			page: point.page,
			x: point.x,
			y: point.y,
			color: markupPrefs.commentColor,
			width: 0,
			// A preview; the real number is taken when it's posted, so a cancelled comment doesn't use one up.
			number: peekCommentNumber(),
			text: '',
			status: 'open',
			createdAt: now,
			updatedAt: now,
			...(markupAuthor ? { author: markupAuthor } : {}),
		});
		if (!markupPanelOpenRef.current) panelOpenedForCommentRef.current = true;
		// Back from the new comment lands on the comments list.
		setMarkupPanelTab('comments');
		if (isCoarsePointer) closeNavigator();
		setMarkupPanelOpen(true);
	}, [closeNavigator, isCoarsePointer, markupAuthor, markupPrefs.commentColor, peekCommentNumber, saveOpenComment, setCommentBuffer, setOpenComment]);

	const postComment = React.useCallback((): void => {
		const draft = pendingCommentRef.current;
		const text = commentTextRef.current.trim();
		if (!draft || !text) return;
		const now = Date.now();
		const saved = addComment({ ...draft, text, createdAt: now, updatedAt: now });
		setPendingComment(null);
		panelOpenedForCommentRef.current = false;
		if (saved) setOpenComment(saved.id);
	}, [addComment, setOpenComment]);

	const cancelComment = React.useCallback((): void => {
		setPendingComment(null);
		setCommentBuffer('');
		if (panelOpenedForCommentRef.current) {
			panelOpenedForCommentRef.current = false;
			markupPanelOpenRef.current = false;
			setMarkupPanelOpen(false);
		}
	}, [setCommentBuffer]);

	/** Flips a comment between Open and Resolved, recording who resolved it and when. */
	const setCommentResolved = React.useCallback((target: CommentMarkup, text: string): void => {
		if (!canMarkup) return;
		const now = Date.now();
		if (target.status === 'resolved') {
			const reopened: CommentMarkup = { ...target, text, status: 'open', updatedAt: now };
			delete reopened.resolvedAt;
			delete reopened.resolvedBy;
			putMarkup(reopened);
			return;
		}
		putMarkup({ ...target, text, status: 'resolved', resolvedAt: now, ...(markupAuthor ? { resolvedBy: markupAuthor } : {}), updatedAt: now });
	}, [canMarkup, markupAuthor, putMarkup]);

	const toggleCommentResolved = React.useCallback((): void => {
		const id = openCommentIdRef.current;
		const target = id ? markupItemsRef.current.find((item) => item.id === id) : undefined;
		if (!target || target.kind !== 'comment') return;
		// Keep any unsaved typing along with the status change.
		setCommentResolved(target, commentTextRef.current.trim() || target.text);
	}, [setCommentResolved]);

	/** The quick ✓ on a row in the Comments list. */
	const toggleResolvedFromList = React.useCallback((target: CommentMarkup): void => {
		setCommentResolved(target, target.text);
	}, [setCommentResolved]);

	const deleteOpenComment = React.useCallback((): void => {
		const id = openCommentIdRef.current;
		if (!id || !canMarkup) return;
		removeMarkups([id]);
		setOpenComment(null);
		setSelectedMarkupId((current) => (current === id ? null : current));
	}, [canMarkup, removeMarkups, setOpenComment]);

	const addReplyToOpenComment = React.useCallback((text: string): void => {
		const commentId = openCommentIdRef.current;
		const trimmed = text.trim();
		if (!canMarkup || !commentId || !trimmed) return;
		const now = Date.now();
		addReply({ id: createMarkupId(), commentId, text: trimmed, createdAt: now, updatedAt: now, ...(markupAuthor ? { author: markupAuthor } : {}) });
	}, [addReply, canMarkup, markupAuthor]);

	const deleteReply = React.useCallback((replyId: string): void => {
		if (canMarkup) removeReply(replyId);
	}, [canMarkup, removeReply]);

	/** "Add comment" in the panel: turn on the comment tool; the next tap on the page places it. */
	const startAddingComment = React.useCallback((): void => {
		if (!canMarkup) return;
		setMarkupTool('comment');
		// On a phone the sheet covers the page you're about to tap.
		if (isCoarsePointer) closeMarkupPanel();
	}, [canMarkup, closeMarkupPanel, isCoarsePointer]);

	/** Tapping a pin on the page opens its comment, in the Comments tab. */
	const openCommentFromPin = React.useCallback((target: CommentMarkup): void => {
		setMarkupPanelTab('comments');
		openComment(target);
	}, [openComment]);

	/** Tapping a row in the list: go to it, and select it if marking up. */
	const handleRevealFromList = React.useCallback((target: Markup): void => {
		revealMarkup(target);
		if (target.kind === 'comment') {
			openComment(target);
			return;
		}
		if (markupToolRef.current) {
			setMarkupTool('select');
			setSelectedMarkupId(target.id);
		}
		// On a phone the sheet would cover it.
		if (isCoarsePointer) closeMarkupPanel();
	}, [closeMarkupPanel, isCoarsePointer, openComment, revealMarkup]);

	// Phones have room for one sheet at a time.
	React.useEffect(() => {
		if (isCoarsePointer && navigatorOpen) closeMarkupPanelRef.current();
	}, [isCoarsePointer, navigatorOpen]);

	// Phones: the keyboard slides over the lower part of the screen without resizing the page (and the
	// browser pans to show the text box), which buried the comment's pin under the keyboard. While the
	// keyboard is up, the viewer is fitted to the part of the screen that's still visible instead.
	const [visibleViewport, setVisibleViewport] = React.useState<{ top: number; height: number } | null>(null);
	React.useEffect(() => {
		if (!isCoarsePointer || typeof window === 'undefined' || !window.visualViewport) return;
		const viewport = window.visualViewport;
		const measure = (): void => {
			const keyboardUp = window.innerHeight - viewport.height > 80;
			const next = keyboardUp ? { top: Math.round(viewport.offsetTop), height: Math.round(viewport.height) } : null;
			setVisibleViewport((current) => (
				current?.top === next?.top && current?.height === next?.height ? current : next
			));
		};
		measure();
		viewport.addEventListener('resize', measure);
		viewport.addEventListener('scroll', measure);
		return () => {
			viewport.removeEventListener('resize', measure);
			viewport.removeEventListener('scroll', measure);
		};
	}, [isCoarsePointer]);

	// Phones: keep the comment being written or read in sight above the panel sheet (and the keyboard),
	// without moving the page when its pin is already visible.
	const pendingCommentId = pendingComment?.id ?? null;
	React.useEffect(() => {
		if (!isCoarsePointer || !markupPanelOpen) return;
		const openId = openCommentIdRef.current;
		const target = pendingCommentRef.current ?? (openId ? markupItemsRef.current.find((item) => item.id === openId) : undefined);
		if (!target) return;
		// Two frames: the sheet and a resized viewer have to be laid out before measuring.
		let second = 0;
		const first = window.requestAnimationFrame(() => {
			second = window.requestAnimationFrame(() => revealMarkup(target, true));
		});
		return () => {
			window.cancelAnimationFrame(first);
			window.cancelAnimationFrame(second);
		};
	}, [isCoarsePointer, markupPanelOpen, openCommentId, pendingCommentId, revealMarkup, visibleViewport?.height]);

	// Switching away from the select tool drops the selection. Switching to anything other than select
	// or the tool that made the thing being typed (another tool, Done, Escape, Back) saves it.
	React.useEffect(() => {
		if (markupTool !== 'select') setSelectedMarkupId(null);
		const typingKind = textEditRef.current?.markup.kind;
		if (markupTool !== 'select' && markupTool !== typingKind) commitTextEditRef.current();
	}, [markupTool]);

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
		const clampedScale = clampZoom(gesture.baseZoom * scale, maxZoomRef.current) / gesture.baseZoom;
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
		setZoom(clampZoom(gesture.baseZoom * gesture.scale, maxZoomRef.current));
		// Land the scroll state in the same render as the zoom. Without this, that render worked out
		// which pages to draw from the old scroll position against the new, bigger layout: the page
		// under your fingers counted as off screen, lost its canvas, and went blank until the layout
		// effect below fixed the scroll and it was drawn again from scratch. Same sum as that effect.
		const scroller = scrollerRef.current;
		const pages = pagesRef.current;
		if (scroller && pages) {
			setScroll({ top: Math.max(0, pages.offsetTop + gesture.localY * gesture.scale - gesture.focusY), height: scroller.clientHeight });
		}
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
		updateZoomGesture(clampZoom(targetZoom, maxZoomRef.current) / gesture.baseZoom, focusX, focusY);
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
			// While marking up, a quick second tap is the next dot or stroke, not a zoom.
			if (markupToolRef.current) {
				lastTap = null;
				return;
			}
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
			if (event.pointerType !== 'mouse' || gestureRef.current) return;
			// While marking up, the left button draws; Space + drag or the middle button still pans.
			const pans = event.button === 1 || (event.button === 0 && (!markupToolRef.current || spaceHeldRef.current));
			if (!pans) return;
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

	useMarkupDrawing({
		scrollerRef,
		tool: load.status === 'ready' && canMarkup ? markupTool : null,
		style: styleForTool(markupPrefs, markupTool),
		textStyle: { color: markupPrefs.textColor, fontSize: markupPrefs.textSize },
		cloudShape: markupPrefs.cloudShape,
		stamp: stampChoice,
		symbolId: markupPrefs.symbolId,
		onPlaceComment: placeComment,
		onOpenComment: openCommentFromPin,
		author: markupAuthor,
		pageSizes: load.status === 'ready' ? load.pageSizes : NO_PAGE_SIZES,
		items: markup.items,
		selectedId: selectedMarkupId,
		editingText: textEdit !== null,
		draftStore: markupDraftStore,
		spaceHeldRef,
		onCommit: putMarkup,
		onEraseProgress: setErasingMarkupIds,
		onEraseCommit: handleEraseCommit,
		onSelect: setSelectedMarkupId,
		onPreview: setPreviewMarkupId,
		onUpdate: putMarkup,
		onStartText: startTextEdit,
		onCommitText: commitTextEdit,
		onCalibrate: handleCalibrate,
		calibrationStore,
		onPolyChange: setPolyPoints,
		polyControlsRef,
	});

	// Hidden from the page: markups mid-erase, the one being dragged (its preview is drawn instead),
	// and a text note being edited (the editor shows it).
	const editingMarkupId = textEdit && !textEdit.isNew ? textEdit.markup.id : null;
	const hiddenMarkupIds = React.useMemo<ReadonlySet<string>>(() => {
		if (!previewMarkupId && !editingMarkupId) return erasingMarkupIds;
		const hidden = new Set(erasingMarkupIds);
		if (previewMarkupId) hidden.add(previewMarkupId);
		if (editingMarkupId) hidden.add(editingMarkupId);
		return hidden;
	}, [editingMarkupId, erasingMarkupIds, previewMarkupId]);

	// Per-page markup lists. A page whose markup didn't change keeps the same array, so drawing on
	// page 3 doesn't re-render every other page.
	const markupsByPageRef = React.useRef(new Map<number, readonly Markup[]>());
	const markupsByPage = React.useMemo(() => {
		const grouped = new Map<number, Markup[]>();
		for (const item of markup.items) {
			if (hiddenMarkupIds.has(item.id)) continue;
			const list = grouped.get(item.page);
			if (list) list.push(item);
			else grouped.set(item.page, [item]);
		}
		const previous = markupsByPageRef.current;
		const stable = new Map<number, readonly Markup[]>();
		for (const [page, list] of grouped) {
			const old = previous.get(page);
			stable.set(page, old && old.length === list.length && old.every((item, index) => item === list[index]) ? old : list);
		}
		markupsByPageRef.current = stable;
		return stable;
	}, [hiddenMarkupIds, markup.items]);

	// ── Layout ──────────────────────────────────────────────────────────────

	const pageSizes = load.status === 'ready' ? load.pageSizes : [];
	// Every page is laid out at the same width, so the widest sheet (in points) sets both the fit
	// width's ceiling and how much zoom it takes to reach MAX_ZOOM_PX_PER_POINT.
	const widestPagePoints = pageSizes.reduce((widest, size) => Math.max(widest, size.width), 0);
	const availablePageWidth = Math.max(0, containerWidth - PAGES_PADDING_PX * 2);
	const fitPageWidth = widestPagePoints > 0 ? Math.min(availablePageWidth, widestPagePoints * MAX_FIT_PX_PER_POINT) : availablePageWidth;
	const maxZoom = widestPagePoints > 0 && fitPageWidth > 0
		? Math.min(MAX_ZOOM_LIMIT, Math.max(MIN_MAX_ZOOM, (MAX_ZOOM_PX_PER_POINT * widestPagePoints) / fitPageWidth))
		: MIN_MAX_ZOOM;
	maxZoomRef.current = maxZoom;
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
	const { undo: markupUndo, redo: markupRedo } = markup;

	// Keyboard: Ctrl+F searches (instead of the browser's find, which can't see inside a canvas),
	// Enter/F3 step through hits, Escape closes (search, then the page panel, then the viewer),
	// Page Up/Down and Left/Right move a page, Home/End jump to the ends, Up/Down scroll a little.
	// The page keys are ignored while typing in a text box.
	React.useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			const key = event.key.toLowerCase();
			if (markupToolRef.current) {
				const typing = event.target instanceof HTMLElement && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable);
				// A path or area in progress: Enter finishes it, Backspace takes back a point, Escape drops it.
				const poly = polyControlsRef.current;
				if (poly && poly.count() > 0 && !typing) {
					if (event.key === 'Escape' || event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Delete') {
						event.preventDefault();
						if (event.key === 'Escape') poly.cancel();
						else if (event.key === 'Enter') poly.finish();
						else poly.undoPoint();
						return;
					}
				}
				if (event.key === 'Escape' && markupToolRef.current === 'calibrate') {
					event.preventDefault();
					closeScalePanelRef.current();
					return;
				}
				// Escape peels one layer at a time: finish the text being typed, then drop the
				// selection, then leave markup mode, all before it does anything else.
				if (event.key === 'Escape') {
					event.preventDefault();
					if (textEditRef.current) commitTextEditRef.current();
					else if (selectedMarkupIdRef.current) setSelectedMarkupId(null);
					else if (markupPanelOpenRef.current) closeMarkupPanelRef.current();
					else setMarkupTool(null);
					return;
				}
				if (!typing && (event.ctrlKey || event.metaKey) && !event.altKey && (key === 'z' || key === 'y')) {
					event.preventDefault();
					if (key === 'y' || event.shiftKey) markupRedo();
					else markupUndo();
					return;
				}
				if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
					if ((event.key === 'Delete' || event.key === 'Backspace') && selectedMarkupIdRef.current) {
						event.preventDefault();
						deleteSelectedMarkup();
						return;
					}
					const nudge = MARKUP_NUDGE[event.key];
					if (nudge && selectedMarkupIdRef.current) {
						event.preventDefault();
						const step = event.shiftKey ? 10 : 1;
						nudgeSelectedMarkup(nudge[0] * step, nudge[1] * step);
						return;
					}
					const shortcutTool = MARKUP_TOOL_KEYS[key];
					if (shortcutTool) {
						event.preventDefault();
						selectMarkupTool(shortcutTool);
						return;
					}
				}
			}
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
				else if (markupPanelOpenRef.current) closeMarkupPanelRef.current();
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
	}, [closeNavigator, closeSearch, deleteSelectedMarkup, goToPage, markupRedo, markupUndo, nudgeSelectedMarkup, openSearch, requestClose, selectMarkupTool, stepMatch]);

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
			pageNames={markup.pageNames}
			canRename={canMarkup}
			onRenamePage={markup.setPageName}
			onSelectPage={handleSelectPage}
			onClose={closeNavigator}
		/>
	) : null;

	const selectedMarkup = selectedMarkupId ? markup.items.find((item) => item.id === selectedMarkupId) ?? null : null;
	// What the colour and size controls act on: the selected markup when using Select, the note or
	// callout being typed when using Text or Callout, otherwise the current tool's defaults.
	let styleControls: MarkupStyleControls | null = null;
	if (markupTool === 'select') {
		if (selectedMarkup) {
			if (selectedMarkup.kind === 'text' || selectedMarkup.kind === 'callout') {
				styleControls = { family: 'text', color: selectedMarkup.color, size: selectedMarkup.fontSize };
			} else if (selectedMarkup.kind === 'stamp' || selectedMarkup.kind === 'symbol' || selectedMarkup.kind === 'comment') {
				styleControls = { family: 'colors', color: selectedMarkup.color, size: 0 };
			} else {
				styleControls = {
					family: selectedMarkup.kind === 'ink' && selectedMarkup.highlighter ? 'highlighter' : 'pen',
					color: selectedMarkup.color,
					size: selectedMarkup.width,
				};
			}
		}
	} else if (markupTool === 'text' || markupTool === 'callout') {
		const typing = textEdit && textEdit.markup.kind !== 'stamp' ? textEdit.markup : null;
		styleControls = { family: 'text', color: typing?.color ?? markupPrefs.textColor, size: typing?.fontSize ?? markupPrefs.textSize };
	} else if (markupTool === 'comment') {
		styleControls = { family: 'colors', color: pendingComment?.color ?? markupPrefs.commentColor, size: 0 };
	} else if (markupTool === 'symbol') {
		// Symbols are placed in the pen colour.
		styleControls = { family: 'colors', color: markupPrefs.penColor, size: 0 };
	} else if (markupTool && markupTool !== 'eraser' && markupTool !== 'stamp' && markupTool !== 'calibrate') {
		const toolStyle = styleForTool(markupPrefs, markupTool);
		styleControls = { family: markupTool === 'highlighter' ? 'highlighter' : 'pen', color: toolStyle.color, size: toolStyle.width };
	}

	const handleMarkupStyleChange = (patch: { color?: string; size?: number }): void => {
		if (markupTool === 'select' && selectedMarkup) {
			const next = { ...selectedMarkup, updatedAt: Date.now() } as Markup;
			if (patch.color) next.color = patch.color;
			if (patch.size !== undefined) {
				if ((next.kind === 'text' || next.kind === 'callout') && (selectedMarkup.kind === 'text' || selectedMarkup.kind === 'callout')) {
					next.fontSize = patch.size;
					// Keep the stored height roughly right until it's next edited and re-measured.
					next.h = roundUnit((selectedMarkup.h * patch.size) / selectedMarkup.fontSize);
					if (next.kind === 'callout') next.width = calloutStrokeWidth(patch.size);
				} else if (next.kind !== 'text' && next.kind !== 'callout' && next.kind !== 'stamp' && next.kind !== 'symbol' && next.kind !== 'comment') {
					next.width = patch.size;
				}
			}
			putMarkup(next);
			return;
		}
		if (markupTool === 'text' || markupTool === 'callout') {
			updateMarkupPrefs({
				...(patch.color ? { textColor: patch.color } : {}),
				...(patch.size !== undefined ? { textSize: patch.size } : {}),
			});
			const current = textEditRef.current;
			if (current && current.markup.kind !== 'stamp') {
				const edited: TypedMarkup = current.markup.kind === 'callout'
					? {
						...current.markup,
						...(patch.color ? { color: patch.color } : {}),
						...(patch.size !== undefined ? { fontSize: patch.size, width: calloutStrokeWidth(patch.size) } : {}),
					}
					: {
						...current.markup,
						...(patch.color ? { color: patch.color } : {}),
						...(patch.size !== undefined ? { fontSize: patch.size } : {}),
					};
				const next = { ...current, markup: edited };
				textEditRef.current = next;
				setTextEdit(next);
			}
			return;
		}
		if (markupTool === 'comment') {
			const color = patch.color;
			if (color) {
				updateMarkupPrefs({ commentColor: color });
				setPendingComment((current) => (current ? { ...current, color } : current));
			}
			return;
		}
		if (markupTool === 'highlighter') {
			updateMarkupPrefs({
				...(patch.color ? { highlighterColor: patch.color } : {}),
				...(patch.size !== undefined ? { highlighterWidth: patch.size } : {}),
			});
			return;
		}
		updateMarkupPrefs({
			...(patch.color ? { penColor: patch.color } : {}),
			...(patch.size !== undefined ? { penWidth: patch.size } : {}),
		});
	};

	const noScaleLabel = t('documents.markupNoScale');
	const openCommentMarkup = openCommentId
		? markup.items.find((item): item is CommentMarkup => item.id === openCommentId && item.kind === 'comment') ?? null
		: null;
	const panelComment = pendingComment
		? { markup: pendingComment, isNew: true }
		: openCommentMarkup
			? { markup: openCommentMarkup, isNew: false }
			: null;
	const markupPanel = markupPanelOpen && load.status === 'ready' ? (
		<MarkupPanel
			variant={isCoarsePointer ? 'sheet' : 'side'}
			tab={markupPanelTab}
			onTabChange={setMarkupPanelTab}
			onAddComment={startAddingComment}
			onToggleResolvedFor={toggleResolvedFromList}
			currentUserId={props.authUserId ?? null}
			onAddReply={addReplyToOpenComment}
			onDeleteReply={deleteReply}
			items={markup.items}
			replies={markup.replies}
			selectedId={selectedMarkupId ?? openCommentId}
			comment={panelComment}
			commentText={commentText}
			canEdit={canMarkup}
			t={t}
			onReveal={handleRevealFromList}
			onBackToList={showMarkupList}
			onCommentChange={setCommentBuffer}
			onCommentSave={saveOpenComment}
			onCommentPost={postComment}
			onCommentCancel={cancelComment}
			onToggleResolved={toggleCommentResolved}
			onDeleteComment={deleteOpenComment}
			onClose={closeMarkupPanel}
			pageScales={markup.pageScales}
			noScaleLabel={noScaleLabel}
		/>
	) : null;
	const showMarkupListButton = load.status === 'ready' && (canMarkup || markup.items.length > 0);
	const openCommentCount = markup.items.reduce((count, item) => count + (item.kind === 'comment' && item.status === 'open' ? 1 : 0), 0);
	// Sync status for this version's markup: always on desktop, only when something's not right on phones.
	const showSyncIndicator = load.status === 'ready' && Boolean(markupVersionId) && (canMarkup || markup.items.length > 0);
	const syncTone: 'synced' | 'connecting' | 'waiting' | 'offline' | 'denied' = markup.syncState === 'synced'
		? 'synced'
		: markup.syncState === 'denied'
			? 'denied'
			: markup.syncState === 'offline' || markup.syncState === 'local'
				? (markup.unsynced ? 'waiting' : 'offline')
				: 'connecting';
	const syncLabel = t({
		synced: 'documents.markupSyncSynced',
		connecting: 'documents.markupSyncConnecting',
		waiting: 'documents.markupSyncWaiting',
		offline: 'documents.markupSyncOffline',
		denied: 'documents.markupSyncDenied',
	}[syncTone]);

	// The scale shown and set is the page being calibrated, otherwise the page in view.
	const scalePage = calibrationPage ?? Math.max(1, currentPage);
	const scaleForPage = markup.pageScales.get(scalePage) ?? null;
	const markupBar = canMarkup && markupTool && load.status === 'ready' ? (
		<MarkupToolbar
			measure={MEASURE_TOOLS.has(markupTool) ? {
				scaleLabel: scaleLabel(scaleForPage, t),
				hasScale: scaleForPage !== null,
				scaleOpen: scalePanelOpen,
				onToggleScale: () => (scalePanelOpen ? closeScalePanel() : setScalePanelOpen(true)),
				polyPoints,
				onFinishPoly: () => polyControlsRef.current?.finish(),
				onUndoPolyPoint: () => polyControlsRef.current?.undoPoint(),
			} : null}
			panel={scalePanelOpen && MEASURE_TOOLS.has(markupTool) ? (
				<MarkupScalePanel
					key={`${scalePage}:${calibrationPage !== null ? 'calibrate' : 'set'}`}
					placement={isCoarsePointer ? 'bottom' : 'top'}
					page={scalePage}
					scale={scaleForPage}
					calibration={calibrationPage !== null ? calibrationStore : null}
					t={t}
					onApply={(fields) => setPageScale(scalePage, { ...fields, page: scalePage, updatedAt: Date.now() })}
					onApplyCalibration={(fields) => {
						setPageScale(scalePage, { ...fields, page: scalePage, updatedAt: Date.now() });
						closeScalePanel();
					}}
					onStartCalibrate={startCalibrating}
					onRemove={() => setPageScale(scalePage, null)}
					onClose={closeScalePanel}
				/>
			) : null}
			placement={isCoarsePointer ? 'bottom' : 'top'}
			tool={markupTool}
			styleControls={styleControls}
			cloudShape={markupPrefs.cloudShape}
			stampPreset={markupPrefs.stampPreset}
			onCloudShapeChange={(cloudShape) => updateMarkupPrefs({ cloudShape })}
			onStampPresetChange={(stampPreset) => updateMarkupPrefs({ stampPreset })}
			symbolId={markupPrefs.symbolId}
			recentSymbols={markupPrefs.recentSymbols}
			onSymbolChange={(symbolId) => updateMarkupPrefs({
				symbolId,
				recentSymbols: [symbolId, ...markupPrefs.recentSymbols.filter((id) => id !== symbolId)].slice(0, MAX_RECENT_SYMBOLS),
			})}
			canRotate={markupTool === 'select' && selectedMarkup?.kind === 'symbol'}
			onRotateSelection={rotateSelectedMarkup}
			hasSelection={markupTool === 'select' && Boolean(selectedMarkup)}
			canUndo={markup.canUndo}
			canRedo={markup.canRedo}
			isCoarsePointer={isCoarsePointer}
			t={t}
			onToolChange={selectMarkupTool}
			onStyleChange={handleMarkupStyleChange}
			onDeleteSelection={deleteSelectedMarkup}
			onUndo={markupUndo}
			onRedo={markupRedo}
			onDone={() => setMarkupTool(null)}
		/>
	) : null;

	const content = (
		<div
			className={styles.backdrop}
			role="presentation"
			data-keyboard={visibleViewport ? 'open' : undefined}
			style={visibleViewport ? { top: visibleViewport.top, height: visibleViewport.height, bottom: 'auto' } : undefined}
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
						{subtitle ? <p className={`${styles.subtitle}${load.status === 'ready' ? ` ${styles.desktopOnly}` : ''}`}>{subtitle}</p> : null}
					</div>
					<div className={styles.toolbar}>
						{load.status === 'ready' ? (
							<>
								{canMarkup ? (
									<button
										type="button"
										className={`${styles.iconButton}${markupTool ? ` ${styles.iconButtonActive}` : ''}`}
										onClick={() => (markupTool ? setMarkupTool(null) : openMarkup())}
										aria-label={t('documents.markup')}
										aria-pressed={Boolean(markupTool)}
										title={t('documents.markup')}
									>
										<FontAwesomeIcon icon={faPen} />
									</button>
								) : null}
								{showSyncIndicator ? (
									<span
										className={`${styles.syncIndicator}${syncTone === 'synced' ? ` ${styles.desktopOnly}` : ''}`}
										data-tone={syncTone}
										role="status"
										aria-label={syncLabel}
										title={syncLabel}
									>
										<FontAwesomeIcon
											icon={syncTone === 'synced' ? faCloud : syncTone === 'connecting' ? faArrowsRotate : syncTone === 'denied' ? faTriangleExclamation : faCloudArrowUp}
											spin={syncTone === 'connecting'}
										/>
									</span>
								) : null}
								{showMarkupListButton ? (
									<button
										type="button"
										className={`${styles.iconButton}${markupPanelOpen ? ` ${styles.iconButtonActive}` : ''}`}
										onClick={toggleMarkupPanel}
										aria-label={openCommentCount > 0 ? `${t('documents.markupComments')}: ${openCommentCount} ${t('documents.markupCommentOpen')}` : t('documents.markupComments')}
										aria-pressed={markupPanelOpen}
										title={t('documents.markupComments')}
									>
										<FontAwesomeIcon icon={faCommentDots} />
										{/* Open comments at a glance, without scrolling the set looking for pins. */}
										{openCommentCount > 0 ? <span className={styles.iconBadge} aria-hidden="true">{openCommentCount > 99 ? '99+' : openCommentCount}</span> : null}
									</button>
								) : null}
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
									className={`${styles.iconButton} ${styles.desktopOnly}${navigatorOpen ? ` ${styles.iconButtonActive}` : ''}`}
									onClick={() => (navigatorOpen ? closeNavigator() : setNavigatorOpen(true))}
									aria-label={t('documents.pagesPanel')}
									aria-pressed={navigatorOpen}
									title={t('documents.pagesPanel')}
								>
									<FontAwesomeIcon icon={faTableColumns} />
								</button>
								<div className={`${styles.zoomControls} ${styles.desktopOnly}`}>
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
										disabled={zoom >= maxZoom - 0.001}
										aria-label={t('documents.zoomIn')}
										title={t('documents.zoomIn')}
									>
										<FontAwesomeIcon icon={faMagnifyingGlassPlus} />
									</button>
								</div>
							</>
						) : null}
						<DocumentShareMenu
							document={noteDocument}
							t={t}
							live={load.status === 'ready' ? { pdf: load.pdf, items: markup.items, replies: markup.replies, pageScales: markup.pageScales } : null}
							onDownloadOriginal={props.onDownload}
							buttonClassName={styles.iconButton}
							buttonActiveClassName={styles.iconButtonActive}
						/>
						<button
							type="button"
							// Phones already have Back at the other end of the header, and the room is better spent on the title.
							className={`${styles.iconButton} ${styles.desktopOnly}`}
							onClick={requestClose}
							aria-label={t('common.close')}
							title={t('common.close')}
						>
							<FontAwesomeIcon icon={faXmark} />
						</button>
					</div>
				</header>
				{!isCoarsePointer ? markupBar : null}
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
								// Only the very bottom gets the extra room, after the last page, so pinch maths (which
								// relies on padding and gaps scaling with the zoom) is untouched for every page.
								style={{ width: pageCssWidth + padding * 2, padding: `${padding}px ${padding}px ${padding + (isCoarsePointer ? PAGE_PILL_CLEARANCE_PX : 0)}px`, gap }}
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
										pageWidth={pageSizes[index].width}
										pageHeight={pageSizes[index].height}
										markups={markupsByPage.get(index + 1) ?? NO_MARKUPS}
										draftStore={markupDraftStore}
										selectedMarkup={selectedMarkup && selectedMarkup.page === index + 1 && previewMarkupId !== selectedMarkup.id ? selectedMarkup : null}
										textEdit={textEdit && textEdit.markup.page === index + 1 ? textEdit.markup : null}
										textEditor={textEditorHandlers}
										pendingComment={pendingComment && pendingComment.page === index + 1 ? pendingComment : null}
										activeCommentId={openCommentId}
										pageScale={markup.pageScales.get(index + 1) ?? null}
										noScaleLabel={noScaleLabel}
										calibrationStore={calibrationStore}
										scrollerRef={scrollerRef}
									/>
								))}
							</div>
						) : null}
						{load.status === 'loading' ? <p className={styles.status}>{t('documents.viewerLoading')}</p> : null}
						{errorMessage ? <p className={styles.status}>{errorMessage}</p> : null}
					</div>
					{!isCoarsePointer ? markupPanel : null}
					{/* Phones: page number and zoom live in a small pill over the page instead of squeezing the
					    title out of the header. Tap the page count for the page panel; the zoom part only shows
					    once zoomed, and tapping it goes back to fit-width. */}
					{isCoarsePointer && load.status === 'ready' && !navigatorOpen && !markupPanelOpen ? (
						<div className={styles.pagePill}>
							<button
								type="button"
								className={styles.pagePillButton}
								onClick={() => setNavigatorOpen(true)}
								aria-label={`${t('documents.pagesPanel')}: ${t('documents.pageLabel')} ${currentPage} / ${pageCount}`}
							>
								<FontAwesomeIcon icon={faTableColumns} />
								<span>{currentPage} / {pageCount}</span>
							</button>
							{zoom > MIN_ZOOM + 0.001 ? (
								<>
									<span className={styles.pagePillDivider} aria-hidden="true" />
									<button
										type="button"
										className={styles.pagePillButton}
										onClick={() => zoomAroundCenter(MIN_ZOOM)}
										aria-label={t('documents.zoomReset')}
									>
										{Math.round(zoom * 100)}%
									</button>
								</>
							) : null}
						</div>
					) : null}
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
					{isCoarsePointer && markupPanel ? (
						<div
							className={styles.sheetBackdrop}
							onClick={(event) => {
								if (event.target === event.currentTarget) closeMarkupPanel();
							}}
						>
							{markupPanel}
						</div>
					) : null}
				</div>
				{isCoarsePointer ? markupBar : null}
			</section>
		</div>
	);

	return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
