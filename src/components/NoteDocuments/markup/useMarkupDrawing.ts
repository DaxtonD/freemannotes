import React from 'react';
import {
	calloutStrokeWidth,
	hitTestMarkup,
	markupFooterText,
	markupHandles,
	moveCalloutBox,
	normalizeBox,
	pickMarkup,
	rectCloudPoints,
	resizeMarkup,
	roundUnit,
	simplifyPoints,
	snapSegmentEnd,
	squareBoxEnd,
	stampMainText,
	stampWidthFor,
	tidyCloudPoints,
	translateMarkup,
	type MarkupHandle,
} from './markupGeometry';
import type { CloudShape } from './markupPrefs';
import type { MarkupDraftStore } from './markupStore';
import { symbolById } from './markupSymbols';
import {
	createMarkupId,
	stampDefinition,
	TEXT_PADDING_UNITS,
	type CalloutMarkup,
	type CommentMarkup,
	type Markup,
	type MarkupAuthor,
	type MeasureMarkup,
	type MarkupTool,
	type StampMarkup,
	type StampPreset,
	type SymbolMarkup,
	type TextMarkup,
	type TypedMarkup,
} from './markupTypes';

// Turning pointer input into markup, without breaking the viewer's own navigation:
//
// - Touch: one finger draws. A second finger landing cancels the stroke and the viewer's pinch
//   handler takes over, so pinch-zoom and two-finger panning keep working mid-markup.
// - Stylus: once a pen has been used, the pen draws and a finger pans, so a palm or a finger
//   resting on the tablet never leaves stray ink.
// - Mouse: left button draws. Hold Space, or use the middle button, to drag the page instead
//   (that's handled by the viewer's grab-to-pan, which steps aside for the left button here).
// - Select: tap picks a markup, drag moves it, the round handles resize it, double-tap edits text.
//   Pressing empty page deselects and pans, so the select tool doubles as the "hand".
//   Dragging a callout's box moves just the box (the arrow keeps pointing at its spot); dragging
//   its arrow moves the whole callout.
// - Callout: press on the thing, drag out to where the note goes. A plain tap puts the note up
//   and to the right.
// - Stamp and text: tap where it goes.
//
// Shapes in progress (and markups being moved or resized) go to a tiny external store rather
// than React state, so dragging only re-renders one small layer, not the whole page stack.

const NO_IDS: ReadonlySet<string> = new Set();
// Pointer samples closer than this (in screen pixels) add nothing to a stroke.
const MIN_SAMPLE_PX = 0.75;
// Below this size (screen pixels) a line or box is a slip, not a markup.
const MIN_SHAPE_PX = 4;
const ERASER_RADIUS_PX = 10;
const INK_SIMPLIFY_PX = 0.35;
const SELECT_TOLERANCE_PX = 8;
// Fingers are bigger than cursors.
const HANDLE_HIT_MOUSE_PX = 10;
const HANDLE_HIT_TOUCH_PX = 20;
// A press that moves less than this is a tap (select), not a drag (move).
const DRAG_SLOP_PX = 4;
const DOUBLE_TAP_MS = 350;
// A tap-to-place press that moves further than this isn't a tap, so it doesn't place anything.
const TAP_MOVE_PX = 10;
// Placed with a tap, so one finger is free to scroll the page with these (see PdfViewer.module.css).
const TAP_TOOLS: ReadonlySet<MarkupTool> = new Set<MarkupTool>(['text', 'stamp', 'symbol', 'comment', 'path', 'area']);
// Path and area: a tap this close (screen pixels) to the last point, or an area's first, finishes it.
const POLY_CLOSE_PX = 14;
// Select-tool panning with a finger keeps gliding after the finger lifts, like native scrolling.
const VELOCITY_WINDOW_MS = 100;
const MOMENTUM_MIN_START_PX_PER_MS = 0.15;
const MOMENTUM_STOP_PX_PER_MS = 0.02;
const MOMENTUM_DECAY_PER_16MS = 0.95;
// How long after a touch release the phone's follow-up click is cancelled (see suppressGhostClick).
const GHOST_CLICK_MS = 600;
const DEFAULT_TEXT_WIDTH_UNITS = 220;
const MIN_NEW_TEXT_WIDTH_UNITS = 60;
// Scallops, stamps and the callout offset are sized on screen when they're made, so they look
// right at whatever zoom you're working at, on a letter page or a 36-inch sheet.
const CLOUD_ARC_PX = 16;
const STAMP_HEIGHT_PX = 44;
const CALLOUT_OFFSET_PX = 40;
// Shorter than this, a callout press was a tap: the box goes to a default spot.
const CALLOUT_DRAG_PX = 12;
const DEFAULT_CALLOUT_WIDTH_UNITS = 160;
// On-screen size of the first symbol on a document; after that each new one matches the last used.
const SYMBOL_SIZE_PX = 32;

type PageSize = { width: number; height: number };

type PagePoint = { host: HTMLElement; page: number; size: PageSize; x: number; y: number; unitsPerPx: number };

type Stroke = {
	pointerId: number;
	tool: MarkupTool;
	host: HTMLElement;
	page: number;
	size: PageSize;
	color: string;
	width: number;
	fontSize: number;
	cloudShape: CloudShape;
	startX: number;
	startY: number;
	lastX: number;
	lastY: number;
	points: number[];
	/** Page units per screen pixel at the moment the stroke started. */
	unitsPerPx: number;
	shift: boolean;
	erased: Set<string>;
};

type PageTarget = { host: HTMLElement; page: number; size: PageSize };

type EditDrag = {
	pointerId: number;
	host: HTMLElement;
	size: PageSize;
	original: Markup;
	/** null = moving the whole markup; 'box' = moving a callout's box without its arrow tip. */
	handle: MarkupHandle | 'box' | null;
	startX: number;
	startY: number;
	startClientX: number;
	startClientY: number;
	unitsPerPx: number;
	/** Where a whole-markup move would land: the page under the pointer (or the last one it crossed). */
	dropTarget: PageTarget;
	preview: Markup | null;
};

/**
 * Dragging one end of the calibration line. The pointer keeps the offset it grabbed at, so a finger
 * beside the crosshair moves it without hiding the exact spot underneath.
 */
type CalibrationDrag = { pointerId: number; host: HTMLElement; size: PageSize; original: MeasureMarkup; end: 0 | 1; grabX: number; grabY: number };

/** A press with a tap-to-place tool, placed when it's released as a tap. */
type PlaceTap = { pointerId: number; tool: MarkupTool; point: PagePoint; clientX: number; clientY: number };

type Pan = {
	pointerId: number;
	pointerType: string;
	x: number;
	y: number;
	left: number;
	top: number;
	/** Recent pointer positions, for the fling speed on release. */
	samples: Array<{ time: number; x: number; y: number }>;
};

export type MarkupStampChoice = { preset: StampPreset; label: string; color: string };

/** A path or area being built tap by tap, from the viewer's buttons and keys. */
export type PolyControls = { finish: () => void; undoPoint: () => void; cancel: () => void; count: () => number };

type UseMarkupDrawingOptions = {
	scrollerRef: React.RefObject<HTMLDivElement | null>;
	/** null = markup mode off: nothing here listens. */
	tool: MarkupTool | null;
	style: { color: string; width: number };
	textStyle: { color: string; fontSize: number };
	cloudShape: CloudShape;
	stamp: MarkupStampChoice;
	/** Library id of the symbol the Symbol tool places. */
	symbolId: string;
	/** Signed on callouts and stamps. */
	author: MarkupAuthor | null;
	pageSizes: readonly PageSize[];
	items: readonly Markup[];
	selectedId: string | null;
	editingText: boolean;
	draftStore: MarkupDraftStore;
	spaceHeldRef: React.MutableRefObject<boolean>;
	onCommit: (markup: Markup) => void;
	onEraseProgress: (ids: ReadonlySet<string>) => void;
	onEraseCommit: (ids: readonly string[]) => void;
	onSelect: (id: string | null) => void;
	/** The markup being dragged (hidden from its page while its preview follows the pointer), or null. */
	onPreview: (id: string | null) => void;
	onUpdate: (markup: Markup) => void;
	onStartText: (markup: TypedMarkup, isNew: boolean) => void;
	onCommitText: () => void;
	/** Comment tool: where the new pin goes. The viewer opens the comment for writing. */
	onPlaceComment: (point: { page: number; x: number; y: number }) => void;
	/** A pin was tapped (not dragged) with the select tool. */
	onOpenComment: (comment: CommentMarkup) => void;
	/** Calibrate tool: the line over a known dimension. It stays up, ends draggable, until the scale is set. */
	calibrationStore: MarkupDraftStore;
	/** A calibration line was drawn on this page. */
	onCalibrate: (page: number) => void;
	/** Path and area in progress: how many points so far (0 when none). */
	onPolyChange: (points: number) => void;
	/** Lets the viewer finish, step back or cancel a path or area from its buttons and keys. */
	polyControlsRef: React.MutableRefObject<PolyControls | null>;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function withAuthor<T extends object>(markup: T, author: MarkupAuthor | null): T {
	// Left off entirely rather than stored as undefined when nobody is signed in.
	return author ? { ...markup, author } : markup;
}

/** Height of a one-line callout: text, author line, padding and border (see .calloutBox). */
function calloutBoxHeight(fontSize: number): number {
	return roundUnit(fontSize * 1.25 + fontSize * 0.66 * 1.25 + 2 + TEXT_PADDING_UNITS * 2 + calloutStrokeWidth(fontSize) * 2);
}

function placeCallout(stroke: Stroke, id: string, author: MarkupAuthor | null): CalloutMarkup {
	const offset = CALLOUT_OFFSET_PX * stroke.unitsPerPx;
	const dragged = Math.hypot(stroke.lastX - stroke.startX, stroke.lastY - stroke.startY) >= CALLOUT_DRAG_PX * stroke.unitsPerPx;
	const releaseX = dragged ? stroke.lastX : stroke.startX + offset;
	const releaseY = dragged ? stroke.lastY : stroke.startY - offset;
	const w = Math.min(DEFAULT_CALLOUT_WIDTH_UNITS, Math.max(40, stroke.size.width - 8));
	const h = calloutBoxHeight(stroke.fontSize);
	// The box grows away from the tip, whichever way it was dragged.
	let y = releaseY >= stroke.startY ? releaseY : releaseY - h;
	if (!dragged && y < 0) y = stroke.startY + offset;
	const x = releaseX >= stroke.startX ? releaseX : releaseX - w;
	const now = Date.now();
	return withAuthor<CalloutMarkup>({
		id,
		kind: 'callout',
		page: stroke.page,
		color: stroke.color,
		width: calloutStrokeWidth(stroke.fontSize),
		fontSize: stroke.fontSize,
		tipX: stroke.startX,
		tipY: stroke.startY,
		x: roundUnit(clamp(x, 0, Math.max(0, stroke.size.width - w))),
		y: roundUnit(clamp(y, 0, Math.max(0, stroke.size.height - h))),
		w: roundUnit(w),
		h,
		text: '',
		createdAt: now,
		updatedAt: now,
	}, author);
}

function buildMarkup(stroke: Stroke, id: string, final: boolean, author: MarkupAuthor | null): Markup {
	const now = Date.now();
	const base = { id, page: stroke.page, color: stroke.color, width: stroke.width, createdAt: now, updatedAt: now };
	switch (stroke.tool) {
		case 'line':
		case 'arrow':
		case 'move': {
			const end = stroke.shift ? snapSegmentEnd(stroke.startX, stroke.startY, stroke.lastX, stroke.lastY) : { x: stroke.lastX, y: stroke.lastY };
			return { ...base, kind: stroke.tool, x1: stroke.startX, y1: stroke.startY, x2: end.x, y2: end.y };
		}
		case 'rect':
		case 'ellipse': {
			const end = stroke.shift ? squareBoxEnd(stroke.startX, stroke.startY, stroke.lastX, stroke.lastY) : { x: stroke.lastX, y: stroke.lastY };
			return { ...base, kind: stroke.tool, ...normalizeBox(stroke.startX, stroke.startY, end.x, end.y) };
		}
		case 'cloud': {
			const arc = roundUnit(Math.max(CLOUD_ARC_PX * stroke.unitsPerPx, stroke.width * 4));
			if (stroke.cloudShape === 'rect') {
				const end = stroke.shift ? squareBoxEnd(stroke.startX, stroke.startY, stroke.lastX, stroke.lastY) : { x: stroke.lastX, y: stroke.lastY };
				return { ...base, kind: 'cloud', points: rectCloudPoints(normalizeBox(stroke.startX, stroke.startY, end.x, end.y)), arc };
			}
			// While drawing a freehand cloud, show the plain line; it turns into scallops on release.
			if (!final) return { ...base, kind: 'ink', points: stroke.points.slice() };
			return { ...base, kind: 'cloud', points: tidyCloudPoints(stroke.points, arc), arc };
		}
		case 'length':
		case 'calibrate': {
			const end = stroke.shift ? snapSegmentEnd(stroke.startX, stroke.startY, stroke.lastX, stroke.lastY) : { x: stroke.lastX, y: stroke.lastY };
			return { ...base, kind: 'measure', mode: 'length', points: [stroke.startX, stroke.startY, end.x, end.y] };
		}
		case 'callout':
			return placeCallout(stroke, id, author);
		default:
			return { ...base, kind: 'ink', points: stroke.points.slice(), highlighter: stroke.tool === 'highlighter' };
	}
}

function isWorthKeeping(markup: Markup, unitsPerPx: number): boolean {
	const minimum = MIN_SHAPE_PX * unitsPerPx;
	switch (markup.kind) {
		case 'line':
		case 'arrow':
		case 'move':
			return Math.hypot(markup.x2 - markup.x1, markup.y2 - markup.y1) >= minimum;
		case 'rect':
		case 'ellipse':
			return markup.w >= minimum && markup.h >= minimum;
		case 'cloud': {
			if (markup.points.length < 6) return false;
			const xs = markup.points.filter((_, index) => index % 2 === 0);
			const ys = markup.points.filter((_, index) => index % 2 === 1);
			return Math.max(...xs) - Math.min(...xs) >= minimum && Math.max(...ys) - Math.min(...ys) >= minimum;
		}
		case 'measure':
			return markup.points.length >= 4 && Math.hypot(markup.points[2] - markup.points[0], markup.points[3] - markup.points[1]) >= minimum;
		case 'ink':
			// Even a single tap with the pen is a deliberate dot.
			return markup.points.length >= 2;
		default:
			return true;
	}
}

function newTextMarkup(point: PagePoint, style: { color: string; fontSize: number }): TextMarkup {
	const now = Date.now();
	const width = Math.max(MIN_NEW_TEXT_WIDTH_UNITS, Math.min(DEFAULT_TEXT_WIDTH_UNITS, point.size.width - point.x - 4));
	// Near the right edge there's no room to the right: start the box further left instead.
	const x = Math.max(0, Math.min(point.x, point.size.width - width - 4));
	return {
		id: createMarkupId(),
		kind: 'text',
		page: point.page,
		color: style.color,
		width: 0,
		fontSize: style.fontSize,
		// Put the first line where the finger was, not the top of the box.
		x: roundUnit(x),
		y: roundUnit(Math.max(0, point.y - style.fontSize * 0.75)),
		w: roundUnit(width),
		h: roundUnit(style.fontSize * 1.25 + TEXT_PADDING_UNITS * 2),
		text: '',
		background: true,
		createdAt: now,
		updatedAt: now,
	};
}

function newStamp(point: PagePoint, choice: MarkupStampChoice, author: MarkupAuthor | null): StampMarkup {
	const now = Date.now();
	const h = roundUnit(STAMP_HEIGHT_PX * point.unitsPerPx);
	const stamp = withAuthor<StampMarkup>({
		id: createMarkupId(),
		kind: 'stamp',
		page: point.page,
		color: choice.color,
		width: 0,
		stamp: choice.preset,
		label: choice.label,
		text: '',
		x: 0,
		y: 0,
		w: 0,
		h,
		createdAt: now,
		updatedAt: now,
	}, author);
	const w = stampWidthFor(stampMainText(stamp), markupFooterText(stamp.author, now), h);
	// Centred on the tap, kept on the page.
	return {
		...stamp,
		w,
		x: roundUnit(clamp(point.x - w / 2, 0, Math.max(0, point.size.width - w))),
		y: roundUnit(clamp(point.y - h / 2, 0, Math.max(0, point.size.height - h))),
	};
}

function newSymbol(point: PagePoint, symbolId: string, color: string, items: readonly Markup[]): SymbolMarkup | null {
	const definition = symbolById(symbolId);
	if (!definition) return null;
	// Same size as the symbol most recently placed or resized, so a row of receptacles matches.
	let size = SYMBOL_SIZE_PX * point.unitsPerPx;
	let newest = -Infinity;
	for (const item of items) {
		if (item.kind === 'symbol' && item.updatedAt > newest) {
			newest = item.updatedAt;
			size = Math.max(item.w, item.h);
		}
	}
	const scale = size / Math.max(definition.w, definition.h);
	const w = roundUnit(definition.w * scale);
	const h = roundUnit(definition.h * scale);
	const now = Date.now();
	return {
		id: createMarkupId(),
		kind: 'symbol',
		page: point.page,
		color,
		width: 0,
		symbol: definition.id,
		rotation: 0,
		// Centred on the tap, kept on the page.
		x: roundUnit(clamp(point.x - w / 2, 0, Math.max(0, point.size.width - w))),
		y: roundUnit(clamp(point.y - h / 2, 0, Math.max(0, point.size.height - h))),
		w,
		h,
		createdAt: now,
		updatedAt: now,
	};
}

function isTypedMarkup(markup: Markup): markup is TypedMarkup {
	return markup.kind === 'text' || markup.kind === 'callout' || (markup.kind === 'stamp' && Boolean(stampDefinition(markup.stamp).input));
}

export function useMarkupDrawing(options: UseMarkupDrawingOptions): void {
	const latest = React.useRef(options);
	latest.current = options;
	const penSeenRef = React.useRef(false);
	const { scrollerRef, tool, draftStore } = options;

	React.useEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller || !tool) return;
		scroller.dataset.markupTool = tool;

		let stroke: Stroke | null = null;
		let edit: EditDrag | null = null;
		let pan: Pan | null = null;
		let placeTap: PlaceTap | null = null;
		let calibrationDrag: CalibrationDrag | null = null;
		// The calibration line from before a new one started, put back if the new one is only a slip.
		let calibrationBefore: Markup | null = null;
		let momentumFrame = 0;
		let lastTap: { id: string; time: number } | null = null;
		// A path or area being built tap by tap. Lives until it's finished or cancelled; changing tool finishes it.
		let poly: { tool: 'path' | 'area'; page: number; host: HTMLElement; size: PageSize; points: number[]; hover: { x: number; y: number } | null } | null = null;
		// After a touch release opens the comment panel, the phone still sends its own click (and the
		// mousedown before it) to whatever is now under the finger: the panel's text box, which popped
		// the keyboard, or the dimmed backdrop, which closed the panel straight away. Cancelling the
		// touchend stops those. Time-windowed, so it can never eat a later, real tap.
		let suppressTouchClickUntil = 0;
		const suppressGhostClick = (): void => {
			suppressTouchClickUntil = performance.now() + GHOST_CLICK_MS;
		};
		const activeTouches = new Set<number>();
		let frame = 0;

		const toPage = (host: HTMLElement, size: PageSize, clientX: number, clientY: number): { x: number; y: number; unitsPerPx: number } => {
			const rect = host.getBoundingClientRect();
			const unitsPerPx = rect.width > 0 ? size.width / rect.width : 1;
			return {
				x: roundUnit((clientX - rect.left) * unitsPerPx),
				y: roundUnit((clientY - rect.top) * (rect.height > 0 ? size.height / rect.height : 1)),
				unitsPerPx,
			};
		};

		const publishDraft = (): void => {
			frame = 0;
			if (stroke && stroke.tool === 'calibrate') latest.current.calibrationStore.set(buildMarkup(stroke, 'calibration', false, null));
			else if (stroke && stroke.tool !== 'eraser') draftStore.set(buildMarkup(stroke, 'draft', false, latest.current.author));
			else if (edit?.preview) draftStore.set(edit.preview);
			else if (poly) draftStore.set(polyDraft());
		};
		const scheduleDraft = (): void => {
			if (frame) return;
			frame = window.requestAnimationFrame(publishDraft);
		};
		const clearDraft = (): void => {
			if (frame) window.cancelAnimationFrame(frame);
			frame = 0;
			draftStore.set(null);
		};

		const release = (pointerId: number): void => {
			if (scroller.hasPointerCapture(pointerId)) scroller.releasePointerCapture(pointerId);
		};

		const eraseAlong = (fromX: number, fromY: number, toX: number, toY: number): void => {
			if (!stroke) return;
			const radius = ERASER_RADIUS_PX * stroke.unitsPerPx;
			// A quick swipe moves further than the eraser's radius between samples; check along the way.
			const steps = Math.max(1, Math.ceil(Math.hypot(toX - fromX, toY - fromY) / radius));
			let changed = false;
			for (const item of latest.current.items) {
				// Comments carry conversations; a stray eraser swipe shouldn't wipe one out. Delete them on purpose.
				if (item.page !== stroke.page || item.kind === 'comment' || stroke.erased.has(item.id)) continue;
				for (let step = 0; step <= steps; step += 1) {
					const x = fromX + ((toX - fromX) * step) / steps;
					const y = fromY + ((toY - fromY) * step) / steps;
					if (hitTestMarkup(item, x, y, radius)) {
						stroke.erased.add(item.id);
						changed = true;
						break;
					}
				}
			}
			if (changed) latest.current.onEraseProgress(new Set(stroke.erased));
		};

		const cancelGesture = (): void => {
			if (stroke) {
				if (stroke.tool === 'eraser' && stroke.erased.size > 0) latest.current.onEraseProgress(NO_IDS);
				if (stroke.tool === 'calibrate') latest.current.calibrationStore.set(calibrationBefore);
				release(stroke.pointerId);
				stroke = null;
			}
			if (edit) {
				release(edit.pointerId);
				if (edit.preview) latest.current.onPreview(null);
				edit = null;
			}
			if (pan) {
				release(pan.pointerId);
				pan = null;
				delete scroller.dataset.dragging;
			}
			if (placeTap) {
				release(placeTap.pointerId);
				placeTap = null;
			}
			if (calibrationDrag) {
				release(calibrationDrag.pointerId);
				latest.current.calibrationStore.set(calibrationDrag.original);
				calibrationDrag = null;
			}
			clearDraft();
		};

		const stopMomentum = (): void => {
			if (momentumFrame) window.cancelAnimationFrame(momentumFrame);
			momentumFrame = 0;
		};

		/** Keeps scrolling after a flick, slowing down each frame. Velocities are finger movement in px/ms. */
		const startMomentum = (velocityX: number, velocityY: number): void => {
			stopMomentum();
			let vx = velocityX;
			let vy = velocityY;
			let last = performance.now();
			const step = (now: number): void => {
				const elapsed = Math.min(48, now - last);
				last = now;
				scroller.scrollLeft -= vx * elapsed;
				scroller.scrollTop -= vy * elapsed;
				const decay = Math.pow(MOMENTUM_DECAY_PER_16MS, elapsed / 16);
				vx *= decay;
				vy *= decay;
				momentumFrame = Math.hypot(vx, vy) > MOMENTUM_STOP_PX_PER_MS ? window.requestAnimationFrame(step) : 0;
			};
			momentumFrame = window.requestAnimationFrame(step);
		};

		// ── Path and area, one tap per point ──
		const polyDraft = (): MeasureMarkup | null => {
			if (!poly) return null;
			const { style } = latest.current;
			// On desktop the next segment follows the cursor until the next click.
			const points = poly.hover ? [...poly.points, poly.hover.x, poly.hover.y] : poly.points.slice();
			return { id: 'draft', kind: 'measure', mode: poly.tool, page: poly.page, color: style.color, width: style.width, points, createdAt: 0, updatedAt: 0 };
		};
		const notifyPoly = (): void => latest.current.onPolyChange(poly ? poly.points.length / 2 : 0);
		const finishPoly = (): void => {
			const done = poly;
			poly = null;
			clearDraft();
			notifyPoly();
			if (!done || done.points.length / 2 < (done.tool === 'area' ? 3 : 2)) return;
			const now = Date.now();
			const { style } = latest.current;
			latest.current.onCommit({
				id: createMarkupId(),
				kind: 'measure',
				mode: done.tool,
				page: done.page,
				color: style.color,
				width: style.width,
				points: done.points.slice(),
				createdAt: now,
				updatedAt: now,
			});
		};
		const cancelPoly = (): void => {
			poly = null;
			clearDraft();
			notifyPoly();
		};
		const undoPolyPoint = (): void => {
			if (!poly) return;
			poly.points.splice(-2, 2);
			if (poly.points.length === 0) {
				cancelPoly();
				return;
			}
			notifyPoly();
			scheduleDraft();
		};
		const addPolyPoint = (polyTool: 'path' | 'area', point: PagePoint): void => {
			// A path or area stays on the page it was started on.
			if (poly && poly.page !== point.page) return;
			if (!poly || poly.tool !== polyTool) poly = { tool: polyTool, page: point.page, host: point.host, size: point.size, points: [], hover: null };
			const count = poly.points.length / 2;
			const reach = POLY_CLOSE_PX * point.unitsPerPx;
			const lastX = poly.points[poly.points.length - 2];
			const lastY = poly.points[poly.points.length - 1];
			// Tapping the last point again (a double-tap or double-click), or an area's first point, finishes it.
			if (count >= 2 && Math.hypot(point.x - lastX, point.y - lastY) <= reach) {
				finishPoly();
				return;
			}
			if (polyTool === 'area' && count >= 3 && Math.hypot(point.x - poly.points[0], point.y - poly.points[1]) <= reach) {
				finishPoly();
				return;
			}
			poly.points.push(point.x, point.y);
			notifyPoly();
			scheduleDraft();
		};
		latest.current.polyControlsRef.current = {
			finish: finishPoly,
			undoPoint: undoPolyPoint,
			cancel: cancelPoly,
			count: () => (poly ? poly.points.length / 2 : 0),
		};

		/** Puts down the thing a tap-to-place tool makes, where the tap was. */
		const placeAt = (placeTool: MarkupTool, point: PagePoint): void => {
			const current = latest.current;
			switch (placeTool) {
				case 'text': {
					const pageItems = current.items.filter((item) => item.page === point.page);
					const existing = [...pageItems].reverse().find((item): item is TextMarkup => item.kind === 'text' && hitTestMarkup(item, point.x, point.y, 2 * point.unitsPerPx));
					if (existing) current.onStartText(existing, false);
					else current.onStartText(newTextMarkup(point, current.textStyle), true);
					return;
				}
				case 'stamp': {
					const stamp = newStamp(point, current.stamp, current.author);
					// RFI and custom stamps open for typing straight away; the rest are done in one tap.
					if (stampDefinition(stamp.stamp).input) current.onStartText(stamp, true);
					else current.onCommit(stamp);
					return;
				}
				case 'symbol': {
					// One tap, one symbol; the tool stays on for the next one.
					const symbol = newSymbol(point, current.symbolId, current.style.color, current.items);
					if (symbol) current.onCommit(symbol);
					return;
				}
				case 'comment':
					current.onPlaceComment({ page: point.page, x: point.x, y: point.y });
					return;
				case 'path':
				case 'area':
					addPolyPoint(placeTool, point);
					return;
				default:
			}
		};

		const pageAt = (clientX: number, clientY: number): PageTarget | null => {
			const element = document.elementFromPoint(clientX, clientY);
			const host = (element ? element.closest('[data-pdf-page]') : null) as HTMLElement | null;
			if (!host || !scroller.contains(host)) return null;
			const page = Number(host.dataset.pdfPage);
			const size = latest.current.pageSizes[page - 1];
			return size ? { host, page, size } : null;
		};

		const startPan = (event: PointerEvent): void => {
			pan = {
				pointerId: event.pointerId,
				pointerType: event.pointerType,
				x: event.clientX,
				y: event.clientY,
				left: scroller.scrollLeft,
				top: scroller.scrollTop,
				samples: [{ time: performance.now(), x: event.clientX, y: event.clientY }],
			};
			scroller.setPointerCapture(event.pointerId);
			if (event.pointerType === 'mouse') scroller.dataset.dragging = 'true';
		};

		const locate = (event: PointerEvent): PagePoint | null => {
			const host = (event.target instanceof Element ? event.target.closest('[data-pdf-page]') : null) as HTMLElement | null;
			if (!host || !scroller.contains(host)) return null;
			const page = Number(host.dataset.pdfPage);
			const size = latest.current.pageSizes[page - 1];
			if (!size) return null;
			return { host, page, size, ...toPage(host, size, event.clientX, event.clientY) };
		};

		const onSelectPointerDown = (event: PointerEvent, point: PagePoint | null): void => {
			if (!point) {
				latest.current.onSelect(null);
				startPan(event);
				return;
			}
			const { items, selectedId } = latest.current;
			const pageItems = items.filter((item) => item.page === point.page);
			const selected = selectedId ? pageItems.find((item) => item.id === selectedId) : undefined;
			if (selected) {
				const reach = (event.pointerType === 'mouse' ? HANDLE_HIT_MOUSE_PX : HANDLE_HIT_TOUCH_PX) * point.unitsPerPx;
				const handle = markupHandles(selected, point.unitsPerPx).find((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= reach);
				if (handle) {
					event.preventDefault();
					scroller.setPointerCapture(event.pointerId);
					edit = {
						pointerId: event.pointerId,
						host: point.host,
						size: point.size,
						original: selected,
						handle: handle.handle,
						startX: point.x,
						startY: point.y,
						startClientX: event.clientX,
						startClientY: event.clientY,
						unitsPerPx: point.unitsPerPx,
						dropTarget: { host: point.host, page: point.page, size: point.size },
						preview: null,
					};
					return;
				}
			}
			const target = pickMarkup(pageItems, point.x, point.y, SELECT_TOLERANCE_PX * point.unitsPerPx);
			if (!target) {
				latest.current.onSelect(null);
				startPan(event);
				return;
			}
			const now = performance.now();
			if (isTypedMarkup(target) && lastTap && lastTap.id === target.id && now - lastTap.time < DOUBLE_TAP_MS) {
				event.preventDefault();
				lastTap = null;
				latest.current.onStartText(target, false);
				return;
			}
			lastTap = { id: target.id, time: now };
			latest.current.onSelect(target.id);
			// A finger landing on an item that wasn't already selected almost always means "I'm
			// scrolling through the page, which happens to have markup on it" rather than "grab this."
			// Select it (so it's visibly picked and its handles are ready) but let the gesture pan like
			// it would over blank page — only a drag that starts on an ALREADY-selected item moves it,
			// the same "select first" step its resize handles already require above. Mouse and pen have
			// no such ambiguity (nothing else a mouse-drag on a shape could mean), so they still grab
			// and move on the very first press. Comment pins are excluded: they're small, rarely grazed
			// by accident, and a single tap has to open one straight away — gating that behind a
			// second touch (this fix's whole point for everything else) would make replying slower for
			// no real benefit.
			if (event.pointerType === 'touch' && target.id !== selectedId && target.kind !== 'comment') {
				startPan(event);
				return;
			}
			event.preventDefault();
			scroller.setPointerCapture(event.pointerId);
			const onCalloutBox = target.kind === 'callout'
				&& point.x >= target.x && point.x <= target.x + target.w && point.y >= target.y && point.y <= target.y + target.h;
			edit = {
				pointerId: event.pointerId,
				host: point.host,
				size: point.size,
				original: target,
				handle: onCalloutBox ? 'box' : null,
				startX: point.x,
				startY: point.y,
				startClientX: event.clientX,
				startClientY: event.clientY,
				unitsPerPx: point.unitsPerPx,
				dropTarget: { host: point.host, page: point.page, size: point.size },
				preview: null,
			};
		};

		const onPointerDown = (event: PointerEvent): void => {
			// Any new press stops a glide in progress, like touching a flung list.
			stopMomentum();
			// Clicks inside the text box being typed in belong to the text box.
			if (event.target instanceof Element && event.target.closest('[data-markup-text-editor]')) return;
			if (event.pointerType === 'mouse' && (event.button !== 0 || latest.current.spaceHeldRef.current)) return;
			if (event.pointerType === 'pen') penSeenRef.current = true;
			if (event.pointerType === 'touch') {
				activeTouches.add(event.pointerId);
				if (activeTouches.size > 1) {
					// Second finger: this was the start of a pinch, not a stroke or a drag.
					cancelGesture();
					return;
				}
			}
			if (latest.current.editingText) {
				// Tapping away from a text note finishes it; that tap doesn't also start something new.
				event.preventDefault();
				latest.current.onCommitText();
				return;
			}
			const point = locate(event);
			if (tool === 'select') {
				onSelectPointerDown(event, point);
				return;
			}
			if (event.pointerType === 'touch' && penSeenRef.current) {
				startPan(event);
				return;
			}
			if (!point) return;
			if (TAP_TOOLS.has(tool)) {
				// Text, stamps, symbols and comments go down on release, as a tap. A press that turns into
				// a swipe is a scroll instead (the browser takes it over and cancels this pointer), so one
				// finger still flicks through the pages with these tools. Placing on release also stops a
				// panel or text box that opens from catching the lifting finger as a tap on itself.
				if (event.pointerType === 'mouse') event.preventDefault();
				scroller.setPointerCapture(event.pointerId);
				placeTap = { pointerId: event.pointerId, tool, point, clientX: event.clientX, clientY: event.clientY };
				return;
			}
			if (tool === 'calibrate') {
				// Grabbing an end of the line already drawn fine-tunes it; pressing anywhere else draws a new one.
				const line = latest.current.calibrationStore.get();
				if (line && line.kind === 'measure' && line.page === point.page && line.points.length >= 4) {
					const reach = (event.pointerType === 'mouse' ? HANDLE_HIT_MOUSE_PX : HANDLE_HIT_TOUCH_PX) * point.unitsPerPx;
					const toStart = Math.hypot(point.x - line.points[0], point.y - line.points[1]);
					const toEnd = Math.hypot(point.x - line.points[2], point.y - line.points[3]);
					if (Math.min(toStart, toEnd) <= reach) {
						event.preventDefault();
						scroller.setPointerCapture(event.pointerId);
						const end = toStart <= toEnd ? 0 : 1;
						calibrationDrag = {
							pointerId: event.pointerId,
							host: point.host,
							size: point.size,
							original: line,
							end,
							grabX: line.points[end * 2] - point.x,
							grabY: line.points[end * 2 + 1] - point.y,
						};
						return;
					}
				}
				calibrationBefore = line;
			}
			event.preventDefault();
			scroller.setPointerCapture(event.pointerId);
			const { style, textStyle } = latest.current;
			stroke = {
				pointerId: event.pointerId,
				tool,
				host: point.host,
				page: point.page,
				size: point.size,
				color: tool === 'callout' ? textStyle.color : style.color,
				width: style.width,
				fontSize: textStyle.fontSize,
				cloudShape: latest.current.cloudShape,
				startX: point.x,
				startY: point.y,
				lastX: point.x,
				lastY: point.y,
				points: [point.x, point.y],
				unitsPerPx: point.unitsPerPx,
				shift: event.shiftKey,
				erased: new Set(),
			};
			if (tool === 'eraser') eraseAlong(point.x, point.y, point.x, point.y);
			else scheduleDraft();
		};

		const onPointerMove = (event: PointerEvent): void => {
			if (pan && event.pointerId === pan.pointerId) {
				scroller.scrollLeft = pan.left - (event.clientX - pan.x);
				scroller.scrollTop = pan.top - (event.clientY - pan.y);
				const now = performance.now();
				pan.samples.push({ time: now, x: event.clientX, y: event.clientY });
				while (pan.samples.length > 2 && now - pan.samples[0].time > VELOCITY_WINDOW_MS) pan.samples.shift();
				return;
			}
			if (calibrationDrag && event.pointerId === calibrationDrag.pointerId) {
				const drag = calibrationDrag;
				const point = toPage(drag.host, drag.size, event.clientX, event.clientY);
				const other = drag.end === 0 ? 1 : 0;
				const target = { x: roundUnit(point.x + drag.grabX), y: roundUnit(point.y + drag.grabY) };
				// Shift keeps the line level, plumb or at 45°, like drawing it.
				const moved = event.shiftKey ? snapSegmentEnd(drag.original.points[other * 2], drag.original.points[other * 2 + 1], target.x, target.y) : target;
				const points = drag.original.points.slice();
				points[drag.end * 2] = moved.x;
				points[drag.end * 2 + 1] = moved.y;
				latest.current.calibrationStore.set({ ...drag.original, points });
				return;
			}
			if (edit && event.pointerId === edit.pointerId) {
				const moving = edit.handle === null || edit.handle === 'box';
				if (!edit.preview && moving && Math.hypot(event.clientX - edit.startClientX, event.clientY - edit.startClientY) < DRAG_SLOP_PX) return;
				if (!edit.preview) latest.current.onPreview(edit.original.id);
				if (edit.handle === null) {
					// A whole markup can move onto another page: it follows whichever page is under the
					// pointer, and keeps the last one while the pointer crosses the gap between two. Page
					// units are PDF points on every page, so the grab offset carries straight across.
					edit.dropTarget = pageAt(event.clientX, event.clientY) ?? edit.dropTarget;
					const point = toPage(edit.dropTarget.host, edit.dropTarget.size, event.clientX, event.clientY);
					edit.preview = { ...translateMarkup(edit.original, point.x - edit.startX, point.y - edit.startY), page: edit.dropTarget.page };
				} else {
					// Resizing, and moving a callout's box, stay on the markup's own page.
					const point = toPage(edit.host, edit.size, event.clientX, event.clientY);
					if (edit.handle === 'box') {
						edit.preview = edit.original.kind === 'callout'
							? moveCalloutBox(edit.original, point.x - edit.startX, point.y - edit.startY)
							: translateMarkup(edit.original, point.x - edit.startX, point.y - edit.startY);
					} else {
						edit.preview = resizeMarkup(edit.original, edit.handle, point.x, point.y, event.shiftKey);
					}
				}
				scheduleDraft();
				return;
			}
			if (poly && !stroke && event.pointerType === 'mouse') {
				const point = toPage(poly.host, poly.size, event.clientX, event.clientY);
				poly.hover = { x: point.x, y: point.y };
				scheduleDraft();
				return;
			}
			if (!stroke || event.pointerId !== stroke.pointerId) return;
			const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
			const samples = coalesced.length > 0 ? coalesced : [event];
			const collectsPoints = stroke.tool === 'pen' || stroke.tool === 'highlighter' || (stroke.tool === 'cloud' && stroke.cloudShape === 'freeform');
			for (const sample of samples) {
				const point = toPage(stroke.host, stroke.size, sample.clientX, sample.clientY);
				if (stroke.tool === 'eraser') {
					eraseAlong(stroke.lastX, stroke.lastY, point.x, point.y);
				} else if (collectsPoints) {
					if (Math.hypot(point.x - stroke.lastX, point.y - stroke.lastY) < MIN_SAMPLE_PX * stroke.unitsPerPx) continue;
					stroke.points.push(point.x, point.y);
				}
				stroke.lastX = point.x;
				stroke.lastY = point.y;
			}
			stroke.shift = event.shiftKey;
			if (stroke.tool !== 'eraser') scheduleDraft();
		};

		const onPointerUp = (event: PointerEvent): void => {
			if (event.pointerType === 'touch') activeTouches.delete(event.pointerId);
			if (pan && event.pointerId === pan.pointerId) {
				const finished = pan;
				release(event.pointerId);
				pan = null;
				delete scroller.dataset.dragging;
				// Mouse drags stop where they're let go; a finger or pen flick keeps gliding. Only movement
				// in the last moment counts, so pausing before lifting doesn't fling.
				if (finished.pointerType !== 'mouse') {
					const now = performance.now();
					const recent = finished.samples.filter((sample) => now - sample.time <= VELOCITY_WINDOW_MS);
					if (recent.length >= 2) {
						const first = recent[0];
						const last = recent[recent.length - 1];
						const span = Math.max(1, last.time - first.time);
						const velocityX = (last.x - first.x) / span;
						const velocityY = (last.y - first.y) / span;
						if (Math.hypot(velocityX, velocityY) > MOMENTUM_MIN_START_PX_PER_MS) startMomentum(velocityX, velocityY);
					}
				}
				return;
			}
			if (calibrationDrag && event.pointerId === calibrationDrag.pointerId) {
				// The line stays where it was let go; the scale panel reads its length from the store.
				calibrationDrag = null;
				release(event.pointerId);
				return;
			}
			if (placeTap && event.pointerId === placeTap.pointerId) {
				const tap = placeTap;
				placeTap = null;
				release(event.pointerId);
				if (Math.hypot(event.clientX - tap.clientX, event.clientY - tap.clientY) > TAP_MOVE_PX) return;
				if (event.pointerType === 'touch') suppressGhostClick();
				placeAt(tap.tool, tap.point);
				return;
			}
			if (edit && event.pointerId === edit.pointerId) {
				const finished = edit;
				edit = null;
				release(event.pointerId);
				clearDraft();
				if (finished.preview) {
					latest.current.onUpdate({ ...finished.preview, updatedAt: Date.now() });
					latest.current.onPreview(null);
				} else if (finished.handle === null && finished.original.kind === 'comment') {
					// A tap on a pin opens it; a drag only moves it.
					if (event.pointerType === 'touch') suppressGhostClick();
					latest.current.onOpenComment(finished.original);
				}
				return;
			}
			if (!stroke || event.pointerId !== stroke.pointerId) return;
			const finished = stroke;
			stroke = null;
			clearDraft();
			release(event.pointerId);
			if (finished.tool === 'eraser') {
				if (finished.erased.size > 0) latest.current.onEraseCommit(Array.from(finished.erased));
				return;
			}
			if (finished.tool === 'calibrate') {
				// Nothing is saved as markup: the line stays up for fine-tuning while the viewer asks how
				// long it really is. A slip keeps whatever line was there before.
				const line = buildMarkup(finished, 'calibration', true, null);
				if (isWorthKeeping(line, finished.unitsPerPx)) {
					latest.current.calibrationStore.set(line);
					latest.current.onCalibrate(finished.page);
				} else {
					latest.current.calibrationStore.set(calibrationBefore);
				}
				return;
			}
			if (finished.tool === 'callout') {
				// Placed, then straight into typing; an empty callout isn't kept.
				latest.current.onStartText(placeCallout(finished, createMarkupId(), latest.current.author), true);
				return;
			}
			const markup = buildMarkup(finished, createMarkupId(), true, latest.current.author);
			if (!isWorthKeeping(markup, finished.unitsPerPx)) return;
			if (markup.kind === 'ink') markup.points = simplifyPoints(markup.points, INK_SIMPLIFY_PX * finished.unitsPerPx);
			latest.current.onCommit(markup);
		};

		const onPointerCancel = (event: PointerEvent): void => {
			if (event.pointerType === 'touch') activeTouches.delete(event.pointerId);
			const owns = (stroke && stroke.pointerId === event.pointerId)
				|| (edit && edit.pointerId === event.pointerId)
				|| (pan && pan.pointerId === event.pointerId)
				|| (placeTap && placeTap.pointerId === event.pointerId)
				|| (calibrationDrag && calibrationDrag.pointerId === event.pointerId);
			if (owns) cancelGesture();
		};

		// Pointer events come before touch events, so this runs right after the pointerup that opened
		// the panel. Cancelling touchend stops the click the phone would otherwise send.
		const onTouchEnd = (event: TouchEvent): void => {
			if (performance.now() > suppressTouchClickUntil) return;
			suppressTouchClickUntil = 0;
			if (event.cancelable) event.preventDefault();
		};

		const isTyping = (target: EventTarget | null): boolean => {
			const element = target as HTMLElement | null;
			return Boolean(element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable));
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.code !== 'Space' || isTyping(event.target)) return;
			event.preventDefault();
			if (!latest.current.spaceHeldRef.current) {
				latest.current.spaceHeldRef.current = true;
				scroller.dataset.spacePan = 'true';
			}
		};
		const onKeyUp = (event: KeyboardEvent): void => {
			if (event.code !== 'Space') return;
			latest.current.spaceHeldRef.current = false;
			delete scroller.dataset.spacePan;
		};

		scroller.addEventListener('pointerdown', onPointerDown);
		scroller.addEventListener('pointermove', onPointerMove);
		scroller.addEventListener('pointerup', onPointerUp);
		scroller.addEventListener('pointercancel', onPointerCancel);
		scroller.addEventListener('touchend', onTouchEnd, { passive: false });
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		return () => {
			scroller.removeEventListener('pointerdown', onPointerDown);
			scroller.removeEventListener('pointermove', onPointerMove);
			scroller.removeEventListener('pointerup', onPointerUp);
			scroller.removeEventListener('pointercancel', onPointerCancel);
			scroller.removeEventListener('touchend', onTouchEnd);
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			stopMomentum();
			// Switching tool (or closing) keeps a path or area that's far enough along.
			finishPoly();
			latest.current.polyControlsRef.current = null;
			cancelGesture();
			latest.current.spaceHeldRef.current = false;
			delete scroller.dataset.markupTool;
			delete scroller.dataset.spacePan;
		};
	}, [draftStore, scrollerRef, tool]);
}
