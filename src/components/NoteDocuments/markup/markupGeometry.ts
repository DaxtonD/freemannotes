import type { CalloutMarkup, CloudMarkup, Markup, MarkupAuthor, StampMarkup, SymbolMarkup } from './markupTypes';

export type MarkupBounds = { x: number; y: number; w: number; h: number };
/** `v0`, `v1`…: a point of a measurement, dragged on its own. */
export type MarkupHandle = 'start' | 'end' | 'nw' | 'ne' | 'sw' | 'se' | 'w' | 'e' | 'tip' | 'rotate' | `v${number}`;

/** Narrowest a text box can be dragged, in page units. */
const MIN_TEXT_WIDTH = 24;
/** Smallest a stamp can be shrunk to (its height, in page units). */
const MIN_STAMP_HEIGHT = 8;
/** How far a scallop bulges out, as a share of its length (radius 0.6 × chord gives ~0.27). */
const CLOUD_BULGE = 0.27;
/** Screen distance from a symbol's top edge to its rotate handle, independent of zoom. */
const ROTATE_HANDLE_OFFSET_PX = 28;

/**
 * (px, py) turned `degrees` clockwise about (cx, cy) — the same sense as the SVG `rotate()`
 * transform a symbol is drawn with, so a page-space point and a symbol's own unrotated box stay
 * on speaking terms in both directions: rotate a LOCAL (unrotated) point by +rotation to place it
 * on the page: rotate a PAGE-space point by -rotation to read it as if the symbol were unrotated.
 */
function rotatePoint(px: number, py: number, cx: number, cy: number, degrees: number): { x: number; y: number } {
	if (!degrees) return { x: px, y: py };
	const rad = (degrees * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const dx = px - cx;
	const dy = py - cy;
	return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** Degrees clockwise from north (straight up) to (px, py) as seen from (cx, cy) — 0-360. */
function angleFromCentre(cx: number, cy: number, px: number, py: number): number {
	const dx = px - cx;
	const dy = py - cy;
	if (dx === 0 && dy === 0) return 0;
	const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
	return degrees < 0 ? degrees + 360 : degrees;
}

/** Two decimals of a PDF point is far finer than anyone can draw, and keeps stored markup small. */
export function roundUnit(value: number): number {
	return Math.round(value * 100) / 100;
}

export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
	const dx = bx - ax;
	const dy = by - ay;
	const lengthSquared = dx * dx + dy * dy;
	let t = lengthSquared > 0 ? ((px - ax) * dx + (py - ay) * dy) / lengthSquared : 0;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * A smooth path through freehand points: straight segments between raw pointer samples look
 * jagged, so each sample becomes a control point and the curve runs through the midpoints.
 */
export function inkPath(points: readonly number[]): string {
	const count = Math.floor(points.length / 2);
	if (count === 0) return '';
	const x = (index: number): number => points[index * 2];
	const y = (index: number): number => points[index * 2 + 1];
	// A tap is a dot: a tiny segment with round caps.
	if (count === 1) return `M${x(0)} ${y(0)}L${roundUnit(x(0) + 0.01)} ${y(0)}`;
	if (count === 2) return `M${x(0)} ${y(0)}L${x(1)} ${y(1)}`;
	let path = `M${x(0)} ${y(0)}`;
	for (let index = 1; index < count - 1; index += 1) {
		path += `Q${x(index)} ${y(index)} ${roundUnit((x(index) + x(index + 1)) / 2)} ${roundUnit((y(index) + y(index + 1)) / 2)}`;
	}
	return `${path}L${x(count - 1)} ${y(count - 1)}`;
}

/** Ramer–Douglas–Peucker: drops points that don't change the stroke's shape by more than `tolerance`. */
export function simplifyPoints(points: readonly number[], tolerance: number): number[] {
	const count = Math.floor(points.length / 2);
	if (count <= 2 || tolerance <= 0) return points.slice(0, count * 2);
	const keep = new Uint8Array(count);
	keep[0] = 1;
	keep[count - 1] = 1;
	const stack: Array<[number, number]> = [[0, count - 1]];
	while (stack.length > 0) {
		const [start, end] = stack.pop() as [number, number];
		let furthest = -1;
		let furthestDistance = 0;
		for (let index = start + 1; index < end; index += 1) {
			const distance = distanceToSegment(
				points[index * 2], points[index * 2 + 1],
				points[start * 2], points[start * 2 + 1],
				points[end * 2], points[end * 2 + 1],
			);
			if (distance > furthestDistance) {
				furthestDistance = distance;
				furthest = index;
			}
		}
		if (furthest >= 0 && furthestDistance > tolerance) {
			keep[furthest] = 1;
			stack.push([start, furthest], [furthest, end]);
		}
	}
	const simplified: number[] = [];
	for (let index = 0; index < count; index += 1) {
		if (keep[index]) simplified.push(points[index * 2], points[index * 2 + 1]);
	}
	return simplified;
}

/** The filled head of an arrow, plus where to stop the shaft so its round cap hides inside the head. */
export function arrowGeometry(x1: number, y1: number, x2: number, y2: number, width: number): { head: string; shaftX: number; shaftY: number } {
	const length = Math.hypot(x2 - x1, y2 - y1) || 1;
	const ux = (x2 - x1) / length;
	const uy = (y2 - y1) / length;
	const headLength = Math.min(length, Math.max(width * 4.5, 9));
	const headHalfWidth = headLength * 0.42;
	const baseX = x2 - ux * headLength;
	const baseY = y2 - uy * headLength;
	const head = [
		`${roundUnit(x2)},${roundUnit(y2)}`,
		`${roundUnit(baseX - uy * headHalfWidth)},${roundUnit(baseY + ux * headHalfWidth)}`,
		`${roundUnit(baseX + uy * headHalfWidth)},${roundUnit(baseY - ux * headHalfWidth)}`,
	].join(' ');
	return { head, shaftX: roundUnit(x2 - ux * headLength * 0.6), shaftY: roundUnit(y2 - uy * headLength * 0.6) };
}

/** Radius of the ring at the start of a move marker (where the thing is now). */
export function moveMarkerRadius(width: number): number {
	return Math.max(width * 2.2, 4);
}

export function normalizeBox(ax: number, ay: number, bx: number, by: number): { x: number; y: number; w: number; h: number } {
	return {
		x: roundUnit(Math.min(ax, bx)),
		y: roundUnit(Math.min(ay, by)),
		w: roundUnit(Math.abs(bx - ax)),
		h: roundUnit(Math.abs(by - ay)),
	};
}

/** Shift while drawing a line or arrow: snap to the nearest 45°. */
export function snapSegmentEnd(ax: number, ay: number, bx: number, by: number): { x: number; y: number } {
	const length = Math.hypot(bx - ax, by - ay);
	const step = Math.PI / 4;
	const angle = Math.round(Math.atan2(by - ay, bx - ax) / step) * step;
	return { x: roundUnit(ax + Math.cos(angle) * length), y: roundUnit(ay + Math.sin(angle) * length) };
}

/** Shift while drawing a rectangle or ellipse: keep it square / round. */
export function squareBoxEnd(ax: number, ay: number, bx: number, by: number): { x: number; y: number } {
	const size = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
	return { x: roundUnit(ax + Math.sign(bx - ax || 1) * size), y: roundUnit(ay + Math.sign(by - ay || 1) * size) };
}

// ── Revision clouds ─────────────────────────────────────────────────────────

export function rectCloudPoints(box: MarkupBounds): number[] {
	const right = roundUnit(box.x + box.w);
	const bottom = roundUnit(box.y + box.h);
	return [box.x, box.y, right, box.y, right, bottom, box.x, bottom];
}

/** Shoelace area. With y pointing down, positive means the corners go clockwise on screen. */
function signedArea(points: readonly number[]): number {
	const count = Math.floor(points.length / 2);
	let area = 0;
	for (let index = 0; index < count; index += 1) {
		const next = (index + 1) % count;
		area += points[index * 2] * points[next * 2 + 1] - points[next * 2] * points[index * 2 + 1];
	}
	return area / 2;
}

/**
 * A freehand loop tidied into cloud corners: small wobbles smoothed out, corners closer together
 * than about one scallop merged, and the end dropped if it came back onto the start.
 */
export function tidyCloudPoints(points: readonly number[], arc: number): number[] {
	const simplified = simplifyPoints(points, arc * 0.35);
	const minGap = arc * 0.6;
	const kept: number[] = [];
	for (let index = 0; index + 1 < simplified.length; index += 2) {
		const count = kept.length / 2;
		if (count > 0 && Math.hypot(simplified[index] - kept[kept.length - 2], simplified[index + 1] - kept[kept.length - 1]) < minGap) continue;
		kept.push(roundUnit(simplified[index]), roundUnit(simplified[index + 1]));
	}
	while (kept.length >= 8 && Math.hypot(kept[kept.length - 2] - kept[0], kept[kept.length - 1] - kept[1]) < minGap) {
		kept.splice(kept.length - 2, 2);
	}
	return kept;
}

/**
 * The scalloped outline: each edge is split into bumps of about `arc` length, each bump an arc
 * that bulges outwards whichever way round the outline was drawn.
 */
export function cloudPath(points: readonly number[], arc: number): string {
	const count = Math.floor(points.length / 2);
	if (count < 2 || arc <= 0) return '';
	const sweep = signedArea(points) >= 0 ? 1 : 0;
	let path = `M${points[0]} ${points[1]}`;
	for (let index = 0; index < count; index += 1) {
		const next = (index + 1) % count;
		const ax = points[index * 2];
		const ay = points[index * 2 + 1];
		const bx = points[next * 2];
		const by = points[next * 2 + 1];
		const length = Math.hypot(bx - ax, by - ay);
		if (length === 0) continue;
		const bumps = Math.max(1, Math.round(length / arc));
		const radius = roundUnit((length / bumps) * 0.6);
		for (let bump = 1; bump <= bumps; bump += 1) {
			path += `A${radius} ${radius} 0 0 ${sweep} ${roundUnit(ax + ((bx - ax) * bump) / bumps)} ${roundUnit(ay + ((by - ay) * bump) / bumps)}`;
		}
	}
	return `${path}Z`;
}

function pointInPolygon(points: readonly number[], px: number, py: number): boolean {
	const count = Math.floor(points.length / 2);
	let inside = false;
	for (let index = 0, previous = count - 1; index < count; previous = index, index += 1) {
		const xi = points[index * 2];
		const yi = points[index * 2 + 1];
		const xj = points[previous * 2];
		const yj = points[previous * 2 + 1];
		if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

// ── Callouts ────────────────────────────────────────────────────────────────

/** Where the leader leaves the box: the point on the box nearest the tip. Null when the tip is inside. */
export function calloutAnchor(callout: Pick<CalloutMarkup, 'tipX' | 'tipY' | 'x' | 'y' | 'w' | 'h'>): { x: number; y: number } | null {
	const x = Math.max(callout.x, Math.min(callout.tipX, callout.x + callout.w));
	const y = Math.max(callout.y, Math.min(callout.tipY, callout.y + callout.h));
	if (x === callout.tipX && y === callout.tipY) return null;
	return { x, y };
}

/** Line width of a callout's border and leader, in step with its text size. */
export function calloutStrokeWidth(fontSize: number): number {
	return roundUnit(Math.max(1, fontSize * 0.09));
}

export function moveCalloutBox(callout: CalloutMarkup, dx: number, dy: number): CalloutMarkup {
	return { ...callout, x: roundUnit(callout.x + dx), y: roundUnit(callout.y + dy) };
}

// ── Stamps ──────────────────────────────────────────────────────────────────

/** The big line of a stamp: "RFI #1234", the custom wording, or just the stamp's word. */
export function stampMainText(stamp: Pick<StampMarkup, 'stamp' | 'label' | 'text'>): string {
	const typed = stamp.text.trim();
	if (stamp.stamp === 'custom') return typed || stamp.label;
	if (stamp.stamp === 'rfi') return typed ? `${stamp.label} #${typed}` : stamp.label;
	return stamp.label;
}

/** Proportions of a stamp, all as shares of its height, so resizing scales it as one piece. */
export const STAMP_LAYOUT = {
	mainSize: 0.42,
	mainBaseline: 0.52,
	footerSize: 0.19,
	footerBaseline: 0.83,
	padX: 0.28,
	stroke: 0.055,
	radius: 0.12,
} as const;

// Rough glyph widths (as a share of font size) for bold capitals and the smaller mixed-case
// author line. Only used to size a new stamp's box; the SVG then fits the text to the box exactly.
const MAIN_GLYPH = 0.68;
const FOOTER_GLYPH = 0.54;

export function stampWidthFor(mainText: string, footerText: string, height: number): number {
	const main = Math.max(1, mainText.length) * MAIN_GLYPH * STAMP_LAYOUT.mainSize * height;
	const footer = footerText.length * FOOTER_GLYPH * STAMP_LAYOUT.footerSize * height;
	return roundUnit(Math.max(height * 1.6, Math.max(main, footer) + STAMP_LAYOUT.padX * 2 * height));
}

/** Which of the two lines sets the stamp's width (that one gets stretched to fit exactly). */
export function stampWidestLine(mainText: string, footerText: string): 'main' | 'footer' {
	const main = mainText.length * MAIN_GLYPH * STAMP_LAYOUT.mainSize;
	const footer = footerText.length * FOOTER_GLYPH * STAMP_LAYOUT.footerSize;
	return footer > main ? 'footer' : 'main';
}

/** A stamp resized to fit its wording, staying centred where it was. */
export function fitStampWidth(stamp: StampMarkup): StampMarkup {
	const w = stampWidthFor(stampMainText(stamp), markupFooterText(stamp.author, stamp.createdAt), stamp.h);
	return { ...stamp, x: roundUnit(stamp.x + (stamp.w - w) / 2), w };
}

/** A quarter turn clockwise. The box itself never moves — see SymbolMarkup's own rotation comment. */
export function rotateSymbol(symbol: SymbolMarkup): SymbolMarkup {
	return { ...symbol, rotation: ((symbol.rotation + 90) % 360) as SymbolMarkup['rotation'] };
}

// ── Author line (callouts and stamps) ───────────────────────────────────────

// Formatted in the reader's own locale when it's drawn, so a stamp reads "14 sept 2026" in Spain
// and "Sep 14, 2026" in the US.
const footerDateFormat = typeof Intl !== 'undefined'
	? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
	: null;

export function markupFooterText(author: MarkupAuthor | null | undefined, createdAt: number): string {
	const date = footerDateFormat && Number.isFinite(createdAt) ? footerDateFormat.format(new Date(createdAt)) : '';
	const name = author?.name.trim() ?? '';
	return name && date ? `${name} · ${date}` : name || date;
}

// ── Hit tests, bounds, moving and resizing ──────────────────────────────────

function polylineHit(points: readonly number[], closed: boolean, px: number, py: number, reach: number): boolean {
	const count = Math.floor(points.length / 2);
	if (count === 1) return Math.hypot(px - points[0], py - points[1]) <= reach;
	const edges = closed ? count : count - 1;
	for (let index = 0; index < edges; index += 1) {
		const next = (index + 1) % count;
		if (distanceToSegment(px, py, points[index * 2], points[index * 2 + 1], points[next * 2], points[next * 2 + 1]) <= reach) return true;
	}
	return false;
}

function insideBox(box: MarkupBounds, px: number, py: number, tolerance: number): boolean {
	return px >= box.x - tolerance && px <= box.x + box.w + tolerance && py >= box.y - tolerance && py <= box.y + box.h + tolerance;
}

/** Is (px, py) on this markup, within `tolerance` page units of its stroke? Used by the eraser. */
export function hitTestMarkup(markup: Markup, px: number, py: number, tolerance: number): boolean {
	const reach = tolerance + markup.width / 2;
	switch (markup.kind) {
		case 'ink':
			return polylineHit(markup.points, false, px, py, reach);
		case 'line':
		case 'arrow':
		case 'move':
			return distanceToSegment(px, py, markup.x1, markup.y1, markup.x2, markup.y2) <= reach
				|| (markup.kind === 'move' && Math.hypot(px - markup.x1, py - markup.y1) <= moveMarkerRadius(markup.width) + reach);
		case 'rect': {
			const { x, y, w, h } = markup;
			return distanceToSegment(px, py, x, y, x + w, y) <= reach
				|| distanceToSegment(px, py, x + w, y, x + w, y + h) <= reach
				|| distanceToSegment(px, py, x + w, y + h, x, y + h) <= reach
				|| distanceToSegment(px, py, x, y + h, x, y) <= reach;
		}
		case 'ellipse': {
			const rx = markup.w / 2;
			const ry = markup.h / 2;
			const cx = markup.x + rx;
			const cy = markup.y + ry;
			if (rx <= 0 || ry <= 0) return distanceToSegment(px, py, markup.x, markup.y, markup.x + markup.w, markup.y + markup.h) <= reach;
			// Close enough for an eraser: how far off the unit circle the point is, scaled back up.
			const radial = Math.hypot((px - cx) / rx, (py - cy) / ry);
			return Math.abs(radial - 1) * Math.min(rx, ry) <= reach;
		}
		case 'cloud':
			// The scallops wander a little either side of the corner-to-corner edges.
			return polylineHit(markup.points, true, px, py, reach + markup.arc * CLOUD_BULGE);
		case 'measure':
			return polylineHit(markup.points, markup.mode === 'area', px, py, reach);
		case 'callout': {
			// The box is solid; the leader is a line.
			if (insideBox(markup, px, py, tolerance)) return true;
			const anchor = calloutAnchor(markup);
			return Boolean(anchor && distanceToSegment(px, py, anchor.x, anchor.y, markup.tipX, markup.tipY) <= reach);
		}
		case 'comment':
			// Pins are drawn at a fixed screen size; tolerance is already in screen-sized units, so a
			// couple of tolerances covers the pin.
			return Math.hypot(px - markup.x, py - markup.y) <= tolerance * 2;
		case 'text':
		case 'stamp':
			// Solid: anywhere on the box counts.
			return insideBox(markup, px, py, tolerance);
		case 'symbol': {
			if (!markup.rotation) return insideBox(markup, px, py, tolerance);
			const cx = markup.x + markup.w / 2;
			const cy = markup.y + markup.h / 2;
			const local = rotatePoint(px, py, cx, cy, -markup.rotation);
			return insideBox(markup, local.x, local.y, tolerance);
		}
		default:
			return false;
	}
}

function pointExtents(points: readonly number[]): MarkupBounds {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (let index = 0; index + 1 < points.length; index += 2) {
		minX = Math.min(minX, points[index]);
		maxX = Math.max(maxX, points[index]);
		minY = Math.min(minY, points[index + 1]);
		maxY = Math.max(maxY, points[index + 1]);
	}
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function padBounds(box: MarkupBounds, pad: number): MarkupBounds {
	return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
}

/** The box a markup occupies, including its stroke. */
export function markupBounds(markup: Markup): MarkupBounds {
	switch (markup.kind) {
		case 'ink':
		case 'measure':
			return padBounds(pointExtents(markup.points), markup.width / 2);
		case 'line':
		case 'arrow':
		case 'move': {
			const box = normalizeBox(markup.x1, markup.y1, markup.x2, markup.y2);
			const pad = markup.kind === 'line'
				? markup.width / 2
				: Math.max(markup.width * 2.5, 5, markup.kind === 'move' ? moveMarkerRadius(markup.width) + markup.width : 0);
			return padBounds(box, pad);
		}
		case 'cloud':
			return padBounds(pointExtents(markup.points), markup.arc * CLOUD_BULGE + markup.width / 2);
		case 'comment':
			return { x: markup.x, y: markup.y, w: 0, h: 0 };
		case 'callout': {
			const left = Math.min(markup.x, markup.tipX);
			const top = Math.min(markup.y, markup.tipY);
			const right = Math.max(markup.x + markup.w, markup.tipX);
			const bottom = Math.max(markup.y + markup.h, markup.tipY);
			return { x: left, y: top, w: right - left, h: bottom - top };
		}
		default:
			return { x: markup.x, y: markup.y, w: markup.w, h: markup.h };
	}
}

/**
 * The markup under a tap, topmost first. Strokes and solid boxes (text, callouts, stamps) are
 * checked before the insides of outlines, so an arrow drawn inside a big cloud can still be
 * picked instead of the cloud.
 */
export function pickMarkup(items: readonly Markup[], px: number, py: number, tolerance: number): Markup | null {
	for (let index = items.length - 1; index >= 0; index -= 1) {
		if (hitTestMarkup(items[index], px, py, tolerance)) return items[index];
	}
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index];
		if ((item.kind === 'rect' || item.kind === 'ellipse') && insideBox(item, px, py, 0)) return item;
		if (item.kind === 'cloud' && pointInPolygon(item.points, px, py)) return item;
		if (item.kind === 'measure' && item.mode === 'area' && pointInPolygon(item.points, px, py)) return item;
	}
	return null;
}

const shiftPoints = (points: readonly number[], dx: number, dy: number): number[] => (
	points.map((value, index) => roundUnit(value + (index % 2 === 0 ? dx : dy)))
);

export function translateMarkup<T extends Markup>(markup: T, dx: number, dy: number): T {
	switch (markup.kind) {
		case 'ink':
		case 'cloud':
		case 'measure':
			return { ...markup, points: shiftPoints(markup.points, dx, dy) };
		case 'line':
		case 'arrow':
		case 'move':
			return { ...markup, x1: roundUnit(markup.x1 + dx), y1: roundUnit(markup.y1 + dy), x2: roundUnit(markup.x2 + dx), y2: roundUnit(markup.y2 + dy) };
		case 'callout':
			return { ...markup, tipX: roundUnit(markup.tipX + dx), tipY: roundUnit(markup.tipY + dy), x: roundUnit(markup.x + dx), y: roundUnit(markup.y + dy) };
		default:
			return { ...markup, x: roundUnit(markup.x + dx), y: roundUnit(markup.y + dy) };
	}
}

function cornerHandles(box: MarkupBounds): Array<{ handle: MarkupHandle; x: number; y: number }> {
	return [
		{ handle: 'nw', x: box.x, y: box.y },
		{ handle: 'ne', x: box.x + box.w, y: box.y },
		{ handle: 'sw', x: box.x, y: box.y + box.h },
		{ handle: 'se', x: box.x + box.w, y: box.y + box.h },
	];
}

/**
 * Where the drag handles sit for a selected markup, in page space. `unitsPerPx` sizes the
 * rotate handle's offset from the box so it sits a constant distance away on screen at any zoom
 * — the same reasoning MarkupSelectionLayer already applies to the handle circles themselves.
 */
export function markupHandles(markup: Markup, unitsPerPx = 1): Array<{ handle: MarkupHandle; x: number; y: number }> {
	switch (markup.kind) {
		case 'symbol': {
			const cx = markup.x + markup.w / 2;
			const cy = markup.y + markup.h / 2;
			const local: Array<{ handle: MarkupHandle; x: number; y: number }> = [
				{ handle: 'nw', x: markup.x, y: markup.y },
				{ handle: 'ne', x: markup.x + markup.w, y: markup.y },
				{ handle: 'sw', x: markup.x, y: markup.y + markup.h },
				{ handle: 'se', x: markup.x + markup.w, y: markup.y + markup.h },
				{ handle: 'rotate', x: cx, y: markup.y - ROTATE_HANDLE_OFFSET_PX * unitsPerPx },
			];
			if (!markup.rotation) return local;
			return local.map((handle) => ({ handle: handle.handle, ...rotatePoint(handle.x, handle.y, cx, cy, markup.rotation) }));
		}
		case 'line':
		case 'arrow':
		case 'move':
			return [
				{ handle: 'start', x: markup.x1, y: markup.y1 },
				{ handle: 'end', x: markup.x2, y: markup.y2 },
			];
		case 'text':
			return [
				{ handle: 'w', x: markup.x, y: markup.y + markup.h / 2 },
				{ handle: 'e', x: markup.x + markup.w, y: markup.y + markup.h / 2 },
			];
		case 'callout':
			return [
				{ handle: 'tip', x: markup.tipX, y: markup.tipY },
				{ handle: 'w', x: markup.x, y: markup.y + markup.h / 2 },
				{ handle: 'e', x: markup.x + markup.w, y: markup.y + markup.h / 2 },
			];
		case 'ink':
		case 'cloud':
			return cornerHandles(pointExtents(markup.points));
		case 'measure': {
			// Every point can be dragged, so a measurement can be nudged onto the exact corner.
			const handles: Array<{ handle: MarkupHandle; x: number; y: number }> = [];
			for (let index = 0; index + 1 < markup.points.length; index += 2) {
				handles.push({ handle: `v${index / 2}`, x: markup.points[index], y: markup.points[index + 1] });
			}
			return handles;
		}
		case 'comment':
			// Pins are dragged, not resized.
			return [];
		default:
			return cornerHandles(markupBounds(markup));
	}
}

/** Stretch a set of points by dragging one corner of their extents, the opposite corner staying put. */
function scalePointsFromCorner(points: readonly number[], handle: MarkupHandle, px: number, py: number, uniform: boolean): number[] {
	const box = pointExtents(points);
	const left = handle === 'nw' || handle === 'sw';
	const top = handle === 'nw' || handle === 'ne';
	const anchorX = left ? box.x + box.w : box.x;
	const anchorY = top ? box.y + box.h : box.y;
	const cornerX = left ? box.x : box.x + box.w;
	const cornerY = top ? box.y : box.y + box.h;
	let scaleX = box.w > 0.5 ? (px - anchorX) / (cornerX - anchorX) : 1;
	let scaleY = box.h > 0.5 ? (py - anchorY) / (cornerY - anchorY) : 1;
	if (uniform) {
		const size = Math.max(Math.abs(scaleX), Math.abs(scaleY));
		scaleX = Math.sign(scaleX || 1) * size;
		scaleY = Math.sign(scaleY || 1) * size;
	}
	return points.map((value, index) => (index % 2 === 0
		? roundUnit(anchorX + (value - anchorX) * scaleX)
		: roundUnit(anchorY + (value - anchorY) * scaleY)));
}

function resizeTextWidth<T extends { x: number; w: number }>(original: T, handle: MarkupHandle, px: number): T {
	const right = original.x + original.w;
	if (handle === 'w') {
		const x = Math.min(px, right - MIN_TEXT_WIDTH);
		return { ...original, x: roundUnit(x), w: roundUnit(right - x) };
	}
	return { ...original, w: roundUnit(Math.max(MIN_TEXT_WIDTH, px - original.x)) };
}

/** A markup with one of its handles dragged to (px, py). Shift keeps angles at 45° and boxes square. */
export function resizeMarkup(original: Markup, handle: MarkupHandle, px: number, py: number, shift: boolean): Markup {
	switch (original.kind) {
		case 'line':
		case 'arrow':
		case 'move': {
			if (handle === 'start') {
				const point = shift ? snapSegmentEnd(original.x2, original.y2, px, py) : { x: roundUnit(px), y: roundUnit(py) };
				return { ...original, x1: point.x, y1: point.y };
			}
			const point = shift ? snapSegmentEnd(original.x1, original.y1, px, py) : { x: roundUnit(px), y: roundUnit(py) };
			return { ...original, x2: point.x, y2: point.y };
		}
		case 'text':
			return resizeTextWidth(original, handle, px);
		case 'callout':
			if (handle === 'tip') return { ...original, tipX: roundUnit(px), tipY: roundUnit(py) };
			return resizeTextWidth(original, handle, px);
		case 'rect':
		case 'ellipse': {
			const anchorX = handle === 'nw' || handle === 'sw' ? original.x + original.w : original.x;
			const anchorY = handle === 'nw' || handle === 'ne' ? original.y + original.h : original.y;
			const end = shift ? squareBoxEnd(anchorX, anchorY, px, py) : { x: px, y: py };
			return { ...original, ...normalizeBox(anchorX, anchorY, end.x, end.y) };
		}
		case 'ink':
			// Scale the stroke from the opposite corner, so a sketch can be stretched to fit.
			return { ...original, points: scalePointsFromCorner(original.points, handle, px, py, shift) };
		case 'cloud':
			return { ...original, points: scalePointsFromCorner(original.points, handle, px, py, shift) } satisfies CloudMarkup;
		case 'measure': {
			if (typeof handle !== 'string' || handle.charAt(0) !== 'v') return original;
			const index = Number(handle.slice(1));
			const count = original.points.length / 2;
			if (!Number.isInteger(index) || index < 0 || index >= count) return original;
			// Shift keeps the dragged point at a 45° step from its neighbour.
			const neighbour = index > 0 ? index - 1 : 1;
			const point = shift && count > 1
				? snapSegmentEnd(original.points[neighbour * 2], original.points[neighbour * 2 + 1], px, py)
				: { x: roundUnit(px), y: roundUnit(py) };
			const points = original.points.slice();
			points[index * 2] = point.x;
			points[index * 2 + 1] = point.y;
			return { ...original, points };
		}
		case 'symbol':
			if (handle === 'rotate') {
				// Drag it around like a clock hand; it always lands on a compass point. Free rotation
				// was never the ask — a visible handle for the same quarter turns the toolbar button
				// already does was.
				const centreX = original.x + original.w / 2;
				const centreY = original.y + original.h / 2;
				const angle = angleFromCentre(centreX, centreY, px, py);
				const rotation = (Math.round(angle / 90) * 90) % 360;
				return { ...original, rotation: rotation as SymbolMarkup['rotation'] };
			}
		// eslint-disable-next-line no-fallthrough
		case 'stamp': {
			// Stamps and symbols keep their proportions: wording has to keep fitting, and a squashed
			// receptacle stops looking like one.
			const rotation = original.kind === 'symbol' ? original.rotation : 0;
			const centreX = original.x + original.w / 2;
			const centreY = original.y + original.h / 2;
			// A rotated symbol's corner handles were themselves rotated into page space (see
			// markupHandles), so the drag lands somewhere on the page that doesn't correspond
			// directly to the unrotated box's own coordinates. Un-rotate it first — same
			// correspondence the rendered symbol uses, just run backwards — and every line below
			// reads exactly like the unrotated case it always was.
			const local = rotation ? rotatePoint(px, py, centreX, centreY, -rotation) : { x: px, y: py };
			const left = handle === 'nw' || handle === 'sw';
			const top = handle === 'nw' || handle === 'ne';
			const anchorX = left ? original.x + original.w : original.x;
			const anchorY = top ? original.y + original.h : original.y;
			const scale = Math.max(Math.abs(local.x - anchorX) / original.w, Math.abs(local.y - anchorY) / original.h, MIN_STAMP_HEIGHT / original.h);
			const w = original.w * scale;
			const h = original.h * scale;
			return {
				...original,
				x: roundUnit(left ? anchorX - w : anchorX),
				y: roundUnit(top ? anchorY - h : anchorY),
				w: roundUnit(w),
				h: roundUnit(h),
			};
		}
		default:
			return original;
	}
}
