/**
 * Grid scroll diagnostics (`?scrollDiag=1`).
 *
 * The scroll oscillation bug has now "come back" after being fixed more times
 * than we'd like to admit, and every round started the same way: a video of cards
 * twitching and a guess about why. The problem is that the card doing the actual
 * damage is usually NOT the one you see move — a card above it (often scrolled
 * off-screen, or not even mounted) changed height, or the virtualizer's spacer
 * got corrected, and everything below it paid the price.
 *
 * So this watches everything instead of guessing. While recording it samples,
 * every animation frame, the position and height of every mounted card inside
 * its column plus each column's virtual spacer padding, and it gets told
 * directly by NoteGrid whenever a measured height is committed, an estimated
 * height is handed to the virtualizer, or the column layout is recomputed. Any
 * frame where mounted cards move inside their column is recorded with the most
 * likely cause: a card above resized, the spacer didn't match a card that just
 * mounted (estimate mismatch), the spacer changed by itself, cards changed
 * column, or nothing we can see ("unexplained" — which is itself a clue).
 *
 * Runtime flag, sticky per browser, same pattern as `?cardDiag=1`. Safe to ship:
 * every hook bails on its first line unless a recording is actually running.
 */

import { getNoteCardDiagEntry, readStickyDiagToggle } from './noteCardDiagnostics';

export const SCROLL_DIAG_ENABLED = readStickyDiagToggle('scrollDiag', 'freemannotes.scrollDiag');

type NoteInfo = { type: string; title: string };

type EventKind = 'shift' | 'resize' | 'remount-resize' | 'column-jump' | 'pad' | 'grid-top' | 'layout' | 'measure';

type ShiftCause =
	| 'card-above-resized'
	| 'estimate-mismatch'
	| 'virtual-padding'
	| 'mount-above-no-padding'
	| 'reordered'
	| 'unexplained';

type DiagEvent = {
	t: number;
	frame: number;
	scrollY: number;
	scrollDelta: number;
	kind: EventKind;
	noteId?: string;
	column?: string;
	from?: number | null;
	to?: number;
	count?: number;
	cause?: string;
	info?: string;
};

type CardSample = { column: string; index: number; top: number; height: number; visualOffset: number };
type ColumnSample = { top: number; padTop: number; padBottom: number; virtualized: boolean; ids: string[] };

const MAX_EVENTS = 40000;
const MAX_RECORDING_MS = 120_000;
const TIMELINE_LIMIT = 300;

let noteInfoLookup: ((noteId: string) => NoteInfo | null) | null = null;

let recording = false;
let startedAt = 0;
let stoppedAt = 0;
let frame = 0;
let rafId = 0;
let lastFrameTs = 0;
let longestFrameGapMs = 0;
let events: DiagEvent[] = [];
let droppedEvents = 0;
let prevCards = new Map<string, CardSample>();
let prevColumns = new Map<string, ColumnSample>();
let prevGridTop: number | null = null;
let prevScrollY = 0;
let currentScrollY = 0;
let currentScrollDelta = 0;
let scrolledDownPx = 0;
let scrolledUpPx = 0;
let framesWithAnimation = 0;
let maxColumnsSeen = 0;
const virtualizedColumns = new Set<string>();

const lastEstimateById = new Map<string, number>();
const estimateMisses: { noteId: string; estimate: number; measured: number }[] = [];
const committedHeightsById = new Map<string, number[]>();
const domHeightsById = new Map<string, number[]>();
const mountCountById = new Map<string, number>();
const shiftCountById = new Map<string, number>();
const shiftStatsByCause = new Map<ShiftCause, { frames: number; totalAbsDy: number; whileIdle: number }>();

let lastLayoutColumnById: Map<string, number> | null = null;
let lastLayoutOrderSignature = '';
let layoutRecomputes = 0;
let layoutRecomputesWithMoves = 0;
let layoutInfo = { columnCount: 0, noteCount: 0, perColumn: [] as number[], heightsVersion: 0 };

export function setScrollDiagNoteInfoLookup(lookup: (noteId: string) => NoteInfo | null): void {
	if (!SCROLL_DIAG_ENABLED) return;
	noteInfoLookup = lookup;
}

export function isScrollDiagRecording(): boolean {
	return recording;
}

export function getScrollDiagStatus(): { recording: boolean; elapsedMs: number; events: number } {
	const end = recording ? performance.now() : stoppedAt;
	return { recording, elapsedMs: startedAt ? Math.max(0, end - startedAt) : 0, events: events.length };
}

function readScrollY(): number {
	if (typeof window === 'undefined') return 0;
	const harness = document.querySelector<HTMLElement>('.test-harness-root');
	return Math.round(Math.max(window.scrollY || 0, document.scrollingElement?.scrollTop ?? 0, harness?.scrollTop ?? 0));
}

function push(event: Omit<DiagEvent, 't' | 'frame' | 'scrollY' | 'scrollDelta'>): void {
	if (events.length >= MAX_EVENTS) {
		droppedEvents += 1;
		return;
	}
	events.push({
		t: Math.round(performance.now() - startedAt),
		frame,
		scrollY: currentScrollY,
		scrollDelta: currentScrollDelta,
		...event,
	});
}

function appendHistory(map: Map<string, number[]>, noteId: string, value: number): boolean {
	const history = map.get(noteId);
	if (!history) {
		map.set(noteId, [value]);
		return false;
	}
	if (history[history.length - 1] === value) return false;
	history.push(value);
	return true;
}

// ── Card parts ────────────────────────────────────────────────────────────────
//
// A card is not one height, it's a stack of parts: header (with or without a
// banner image that may still be loading), meta chip row, body (text, checklist,
// drawing, or a media grid), the completed-items section, URL previews, and
// images anywhere inside. "This card went 604→368" is useless on its own; "this
// card went 604→368 because completed went EXPANDED→collapsed" is the fix. So
// every time a card's height changes we diff its parts against the last time we
// looked, and print only what changed.

type CardParts = Record<string, string>;

const lastPartsById = new Map<string, CardParts>();

function readCardParts(noteId: string): CardParts | null {
	const entry = getNoteCardDiagEntry(noteId);
	if (!entry) return null;
	const { computed, elements } = entry;
	const px = (element: HTMLElement | null): string => (element ? `${element.offsetHeight}px` : '-');
	const images = elements.card ? Array.from(elements.card.querySelectorAll('img')) : [];
	const loadedImages = images.filter((image) => image.complete && image.naturalHeight > 0).length;
	const bannerImage = computed.hasBanner ? elements.header?.querySelector('img') ?? null : null;
	const rail = elements.linkPreviewRail;
	const previewCount = rail
		? (rail.children.length === 1 && rail.children[0].children.length > 0 ? rail.children[0].children.length : rail.children.length)
		: 0;
	const isChecklist = computed.type === 'checklist';
	return {
		card: px(elements.card),
		forcedHeight: computed.forcedHeightPx === null ? 'none' : `${computed.forcedHeightPx}px`,
		header: px(elements.header),
		banner: !computed.hasBanner ? 'none' : bannerImage && bannerImage.complete && bannerImage.naturalHeight > 0 ? 'loaded' : 'LOADING',
		chips: elements.metaChipRow ? `${elements.metaChipRow.children.length}/${elements.metaChipRow.offsetHeight}px` : 'none',
		body: `${computed.bodyKind}/${px(elements.body)}`,
		items: isChecklist ? `${computed.itemsShown}/${computed.itemsTotal} shown` : '-',
		completed: isChecklist ? `${computed.completedExpanded ? 'EXPANDED' : 'collapsed'}(${computed.completedTotal})/${px(elements.completedSection)}` : '-',
		urlPreviews: rail ? `${previewCount}/${rail.offsetHeight}px` : 'none',
		mediaGrid: computed.mediaCells > 0 ? `${computed.mediaCells} cells` : 'none',
		images: images.length > 0 ? `${loadedImages}/${images.length} loaded` : 'none',
	};
}

function formatParts(parts: CardParts): string {
	return Object.entries(parts).map(([key, value]) => `${key}=${value}`).join(' ');
}

/**
 * Describe the card's parts relative to the last time we looked. Pass
 * updateBaseline=false when the frame sampler will look again shortly (a height
 * commit usually lands a frame before the sampler sees the resize), so that later
 * diff still has the "before" to compare against.
 */
function describeCardParts(noteId: string, updateBaseline = true): string {
	const now = readCardParts(noteId);
	if (!now) return 'parts: unavailable (card not registered)';
	const before = lastPartsById.get(noteId);
	if (updateBaseline) lastPartsById.set(noteId, now);
	if (!before) return `parts: ${formatParts(now)}`;
	const changes = Object.keys(now)
		.filter((key) => before[key] !== now[key])
		.map((key) => `${key} ${before[key]}→${now[key]}`);
	return changes.length > 0 ? `changed: ${changes.join(', ')}` : 'changed: nothing inside the card (height came from outside its parts)';
}

/** Called by NoteGrid every time a card's measured height is COMMITTED (changed). */
export function recordScrollDiagMeasure(noteId: string, previous: number | undefined, next: number): void {
	if (!recording) return;
	if (previous !== undefined && !committedHeightsById.has(noteId)) committedHeightsById.set(noteId, [previous]);
	appendHistory(committedHeightsById, noteId, next);
	if (previous === undefined) {
		const estimate = lastEstimateById.get(noteId);
		if (estimate !== undefined) estimateMisses.push({ noteId, estimate, measured: next });
	}
	push({
		kind: 'measure',
		noteId,
		from: previous ?? null,
		to: next,
		info: previous !== undefined ? describeCardParts(noteId, false) : undefined,
	});
}

/** Called by NoteGrid when the virtualizer is given a GUESSED height (no measurement yet). */
export function recordScrollDiagEstimate(noteId: string, estimatePx: number): void {
	if (!recording) return;
	lastEstimateById.set(noteId, estimatePx);
}

/** Called by NoteGrid whenever the packed (display) columns are recomputed. */
export function recordScrollDiagLayout(columns: readonly string[][], heightsVersion: number, order: readonly string[]): void {
	if (!SCROLL_DIAG_ENABLED) return;
	const columnById = new Map<string, number>();
	columns.forEach((column, columnIndex) => {
		for (const noteId of column) columnById.set(noteId, columnIndex);
	});
	const orderSignature = order.join('');
	layoutInfo = {
		columnCount: columns.length,
		noteCount: order.length,
		perColumn: columns.map((column) => column.length),
		heightsVersion,
	};
	if (recording && lastLayoutColumnById) {
		layoutRecomputes += 1;
		const moved: string[] = [];
		for (const [noteId, column] of columnById) {
			const previous = lastLayoutColumnById.get(noteId);
			if (previous !== undefined && previous !== column) moved.push(`${label(noteId)} col${previous}→col${column}`);
		}
		const orderChanged = orderSignature !== lastLayoutOrderSignature;
		if (moved.length > 0) layoutRecomputesWithMoves += 1;
		if (moved.length > 0 || orderChanged) {
			push({
				kind: 'layout',
				from: heightsVersion,
				count: moved.length,
				cause: orderChanged ? 'order-changed' : 'heights-changed',
				info: moved.slice(0, 10).join('; ') + (moved.length > 10 ? `; …+${moved.length - 10}` : ''),
			});
		}
	}
	lastLayoutColumnById = columnById;
	lastLayoutOrderSignature = orderSignature;
}

function bumpCause(cause: ShiftCause, absDy: number, idle: boolean): void {
	const stats = shiftStatsByCause.get(cause) ?? { frames: 0, totalAbsDy: 0, whileIdle: 0 };
	stats.frames += 1;
	stats.totalAbsDy += absDy;
	if (idle) stats.whileIdle += 1;
	shiftStatsByCause.set(cause, stats);
}

function sampleFrame(timestamp: number): void {
	rafId = 0;
	if (!recording) return;
	if (performance.now() - startedAt > MAX_RECORDING_MS) {
		stopScrollDiag();
		return;
	}
	if (lastFrameTs) longestFrameGapMs = Math.max(longestFrameGapMs, timestamp - lastFrameTs);
	lastFrameTs = timestamp;
	frame += 1;

	currentScrollY = readScrollY();
	currentScrollDelta = currentScrollY - prevScrollY;
	if (currentScrollDelta > 0) scrolledDownPx += currentScrollDelta;
	else scrolledUpPx -= currentScrollDelta;
	prevScrollY = currentScrollY;
	const idle = currentScrollDelta === 0;

	const nextCards = new Map<string, CardSample>();
	const nextColumns = new Map<string, ColumnSample>();
	let gridTop: number | null = null;
	let animatingCards = 0;

	const columnElements = document.querySelectorAll<HTMLElement>('[data-scroll-diag-column]');
	maxColumnsSeen = Math.max(maxColumnsSeen, columnElements.length);
	columnElements.forEach((columnElement) => {
		const key = columnElement.dataset.scrollDiagColumn ?? '?';
		const columnRect = columnElement.getBoundingClientRect();
		if (gridTop === null) gridTop = Math.round(columnRect.top + currentScrollY);
		const inner = columnElement.querySelector<HTMLElement>('[data-scroll-diag-inner]');
		const virtualized = inner?.dataset.scrollDiagVirtualized === '1';
		if (virtualized) virtualizedColumns.add(key);
		const ids: string[] = [];
		columnElement.querySelectorAll<HTMLElement>('[data-scroll-diag-item]').forEach((item) => {
			const noteId = item.dataset.scrollDiagItem ?? '';
			if (!noteId) return;
			const rect = item.getBoundingClientRect();
			const child = item.firstElementChild as HTMLElement | null;
			// The shell is where layout puts the card; its child is where framer-motion
			// is currently DRAWING it. A non-zero gap means a layout animation is mid-flight.
			const visualOffset = child ? Math.round(child.getBoundingClientRect().top - rect.top) : 0;
			if (visualOffset !== 0) animatingCards += 1;
			nextCards.set(noteId, {
				column: key,
				index: ids.length,
				top: Math.round(rect.top - columnRect.top),
				height: Math.round(rect.height),
				visualOffset,
			});
			ids.push(noteId);
		});
		nextColumns.set(key, {
			top: Math.round(columnRect.top + currentScrollY),
			padTop: inner ? Math.round(Number.parseFloat(inner.style.paddingTop || '0') || 0) : 0,
			padBottom: inner ? Math.round(Number.parseFloat(inner.style.paddingBottom || '0') || 0) : 0,
			virtualized,
			ids,
		});
	});
	if (animatingCards > 0) framesWithAnimation += 1;

	const hasPrevious = prevColumns.size > 0;

	for (const [noteId, sample] of nextCards) {
		const previous = prevCards.get(noteId);
		if (!previous) {
			mountCountById.set(noteId, (mountCountById.get(noteId) ?? 0) + 1);
			const history = domHeightsById.get(noteId);
			const lastKnown = history ? history[history.length - 1] : undefined;
			if (appendHistory(domHeightsById, noteId, sample.height) && hasPrevious) {
				push({
					kind: 'remount-resize',
					noteId,
					column: sample.column,
					from: lastKnown ?? null,
					to: sample.height,
					info: describeCardParts(noteId),
				});
			} else {
				const parts = readCardParts(noteId);
				if (parts) lastPartsById.set(noteId, parts);
			}
			continue;
		}
		if (previous.column !== sample.column) {
			push({ kind: 'column-jump', noteId, info: `col${previous.column}→col${sample.column}` });
			continue;
		}
		if (previous.height !== sample.height) {
			appendHistory(domHeightsById, noteId, sample.height);
			push({
				kind: 'resize',
				noteId,
				column: sample.column,
				from: previous.height,
				to: sample.height,
				info: describeCardParts(noteId),
			});
		}
	}

	if (hasPrevious && gridTop !== null && prevGridTop !== null && Math.abs(gridTop - prevGridTop) >= 1) {
		push({ kind: 'grid-top', from: prevGridTop, to: gridTop });
	}

	for (const [key, column] of nextColumns) {
		const previousColumn = prevColumns.get(key);
		if (!previousColumn) continue;
		if (previousColumn.padTop !== column.padTop) {
			push({ kind: 'pad', column: key, from: previousColumn.padTop, to: column.padTop });
		}

		const shifted: { noteId: string; dy: number }[] = [];
		for (const noteId of column.ids) {
			const previous = prevCards.get(noteId);
			const sample = nextCards.get(noteId);
			if (!previous || !sample || previous.column !== key) continue;
			const dy = sample.top - previous.top;
			if (Math.abs(dy) >= 1) shifted.push({ noteId, dy });
		}
		if (shifted.length === 0) continue;

		const first = shifted[0];
		const firstNow = nextCards.get(first.noteId)!;
		const firstBefore = prevCards.get(first.noteId)!;
		const aboveNow = column.ids.slice(0, firstNow.index);
		const aboveBefore = previousColumn.ids.slice(0, firstBefore.index);
		const resizedAbove = aboveNow.filter((noteId) => {
			const previous = prevCards.get(noteId);
			const sample = nextCards.get(noteId);
			return previous && sample && previous.column === key && previous.height !== sample.height;
		});
		const mountedAbove = aboveNow.filter((noteId) => !prevCards.has(noteId));
		const unmountedAbove = aboveBefore.filter((noteId) => !nextCards.has(noteId));
		const padDelta = column.padTop - previousColumn.padTop;
		const orderChanged = aboveNow.filter((noteId) => prevCards.has(noteId)).join('|')
			!== aboveBefore.filter((noteId) => nextCards.has(noteId)).join('|');

		let cause: ShiftCause;
		const details: string[] = [];
		if (resizedAbove.length > 0) {
			cause = 'card-above-resized';
			details.push(`resized above: ${resizedAbove.map((noteId) => {
				const before = prevCards.get(noteId)!.height;
				const after = nextCards.get(noteId)!.height;
				return `${label(noteId)} ${before}→${after}`;
			}).join('; ')}`);
		} else if ((mountedAbove.length > 0 || unmountedAbove.length > 0) && padDelta !== 0) {
			// The virtualizer swapped a real card for spacer padding (or back) and the
			// two weren't the same size — i.e. the height it had for that card was wrong.
			cause = 'estimate-mismatch';
			const mountedPx = mountedAbove.reduce((sum, noteId) => sum + (nextCards.get(noteId)?.height ?? 0), 0);
			const unmountedPx = unmountedAbove.reduce((sum, noteId) => sum + (prevCards.get(noteId)?.height ?? 0), 0);
			details.push(`pad ${previousColumn.padTop}→${column.padTop} (Δ${padDelta})`);
			if (mountedAbove.length) details.push(`mounted above ${mountedAbove.map(label).join('; ')} (${mountedPx}px)`);
			if (unmountedAbove.length) details.push(`unmounted above ${unmountedAbove.map(label).join('; ')} (${unmountedPx}px)`);
		} else if (padDelta !== 0) {
			cause = 'virtual-padding';
			details.push(`pad ${previousColumn.padTop}→${column.padTop} (Δ${padDelta}) with no mount change — offscreen card above re-sized`);
		} else if (mountedAbove.length > 0 || unmountedAbove.length > 0) {
			cause = 'mount-above-no-padding';
			details.push(`+${mountedAbove.length}/-${unmountedAbove.length} above, padding unchanged${column.virtualized ? '' : ' (column not virtualized)'}`);
		} else if (orderChanged) {
			cause = 'reordered';
		} else {
			cause = 'unexplained';
			if (animatingCards > 0) details.push(`${animatingCards} cards mid-animation`);
		}

		const maxAbsDy = shifted.reduce((max, entry) => Math.max(max, Math.abs(entry.dy)), 0);
		bumpCause(cause, Math.abs(first.dy), idle);
		for (const entry of shifted) shiftCountById.set(entry.noteId, (shiftCountById.get(entry.noteId) ?? 0) + 1);
		push({
			kind: 'shift',
			column: key,
			noteId: first.noteId,
			from: first.dy,
			to: maxAbsDy,
			count: shifted.length,
			cause,
			info: details.join(' | '),
		});
	}

	prevCards = nextCards;
	prevColumns = nextColumns;
	prevGridTop = gridTop;
	rafId = window.requestAnimationFrame(sampleFrame);
}

export function startScrollDiag(): void {
	if (!SCROLL_DIAG_ENABLED || typeof window === 'undefined') return;
	if (rafId) window.cancelAnimationFrame(rafId);
	recording = true;
	startedAt = performance.now();
	stoppedAt = 0;
	frame = 0;
	lastFrameTs = 0;
	longestFrameGapMs = 0;
	events = [];
	droppedEvents = 0;
	prevCards = new Map();
	prevColumns = new Map();
	prevGridTop = null;
	currentScrollY = readScrollY();
	prevScrollY = currentScrollY;
	currentScrollDelta = 0;
	scrolledDownPx = 0;
	scrolledUpPx = 0;
	framesWithAnimation = 0;
	maxColumnsSeen = 0;
	virtualizedColumns.clear();
	lastEstimateById.clear();
	lastPartsById.clear();
	estimateMisses.length = 0;
	committedHeightsById.clear();
	domHeightsById.clear();
	mountCountById.clear();
	shiftCountById.clear();
	shiftStatsByCause.clear();
	layoutRecomputes = 0;
	layoutRecomputesWithMoves = 0;
	rafId = window.requestAnimationFrame(sampleFrame);
}

export function stopScrollDiag(): void {
	if (!recording) return;
	recording = false;
	stoppedAt = performance.now();
	if (rafId && typeof window !== 'undefined') window.cancelAnimationFrame(rafId);
	rafId = 0;
}

function label(noteId: string): string {
	const info = noteInfoLookup?.(noteId) ?? null;
	const shortId = noteId.slice(-6);
	const title = (info?.title ?? '').replace(/\s+/g, ' ').trim();
	const clipped = title.length > 28 ? `${title.slice(0, 27)}…` : title;
	return `#${shortId} [${info?.type || '?'}] "${clipped}"`;
}

function countFlips(sequence: readonly number[]): number {
	let flips = 0;
	for (let i = 2; i < sequence.length; i++) {
		if (sequence[i] === sequence[i - 2] && sequence[i] !== sequence[i - 1]) flips += 1;
	}
	return flips;
}

function formatSequence(sequence: readonly number[]): string {
	if (sequence.length <= 14) return sequence.join('→');
	return `${sequence.slice(0, 12).join('→')}→…(${sequence.length - 12} more)`;
}

function seconds(ms: number): string {
	return `${(ms / 1000).toFixed(3)}s`;
}

function formatEvent(event: DiagEvent): string {
	const arrow = event.scrollDelta > 0 ? '↓' : event.scrollDelta < 0 ? '↑' : '·';
	const prefix = `${seconds(event.t).padStart(8)} f${event.frame} y=${event.scrollY}${arrow}`;
	switch (event.kind) {
		case 'shift':
			return `${prefix} SHIFT col${event.column} n=${event.count} dy=${event.from} max|dy|=${event.to} cause=${event.cause} first=${label(event.noteId ?? '')}${event.info ? ` | ${event.info}` : ''}`;
		case 'resize':
			return `${prefix} RESIZE ${label(event.noteId ?? '')} ${event.from}→${event.to} (on screen) | ${event.info ?? ''}`;
		case 'remount-resize':
			return `${prefix} REMOUNT-AT-NEW-HEIGHT ${label(event.noteId ?? '')} last seen ${event.from} → now ${event.to} | ${event.info ?? ''}`;
		case 'column-jump':
			return `${prefix} COLUMN-JUMP ${label(event.noteId ?? '')} ${event.info}`;
		case 'pad':
			return `${prefix} PAD col${event.column} ${event.from}→${event.to}`;
		case 'grid-top':
			return `${prefix} GRID-TOP moved ${event.from}→${event.to} (content above the grid changed height)`;
		case 'layout':
			return `${prefix} LAYOUT v${event.from} ${event.cause} moved=${event.count}${event.info ? ` | ${event.info}` : ''}`;
		case 'measure':
			return `${prefix} MEASURE ${label(event.noteId ?? '')} ${event.from ?? 'first'}→${event.to}${event.info ? ` | ${event.info}` : ''}`;
		default:
			return `${prefix} ${event.kind}`;
	}
}

/** Paste-friendly report. Summary first, then worst offenders, then the raw timeline. */
export function formatScrollDiagReport(): string {
	const lines: string[] = [];
	const durationMs = (recording ? performance.now() : stoppedAt) - startedAt;
	const pointer = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
		? (window.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine')
		: 'unknown';
	const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
	const buildTag = typeof __BUILD_TAG__ === 'string' ? __BUILD_TAG__ : '';
	let forcedVirtualization = 'no';
	try {
		forcedVirtualization = window.localStorage.getItem('freemannotes.forceVirtualization') === '1' ? 'yes' : 'no';
	} catch {
		// ignore
	}

	lines.push('=== grid scroll diag ===');
	lines.push(`app ${appVersion} · build ${buildTag} · pointer=${pointer} viewport=${window.innerWidth}x${window.innerHeight} dpr=${Math.round(window.devicePixelRatio * 100) / 100}`);
	lines.push(`recorded ${(durationMs / 1000).toFixed(1)}s · ${frame} frames · longest frame gap ${Math.round(longestFrameGapMs)}ms · scrolled down ${scrolledDownPx}px / up ${scrolledUpPx}px`);
	lines.push(`grid: columns=${layoutInfo.columnCount} (DOM ${maxColumnsSeen}) notes=${layoutInfo.noteCount} perColumn=[${layoutInfo.perColumn.join(',')}] virtualizedColumns=${virtualizedColumns.size} forceVirtualization=${forcedVirtualization}`);
	if (droppedEvents > 0) lines.push(`!! event buffer full, ${droppedEvents} events dropped — record a shorter session`);
	lines.push('');

	const shiftEvents = events.filter((event) => event.kind === 'shift');
	const totalShiftDy = shiftEvents.reduce((sum, event) => sum + Math.abs(event.from ?? 0), 0);
	lines.push('SUMMARY');
	lines.push(`  frames where mounted cards moved inside their column: ${shiftEvents.length} (total |dy| ${totalShiftDy}px), while not scrolling: ${shiftEvents.filter((event) => event.scrollDelta === 0).length}`);
	const causeOrder: ShiftCause[] = ['estimate-mismatch', 'virtual-padding', 'card-above-resized', 'mount-above-no-padding', 'reordered', 'unexplained'];
	for (const cause of causeOrder) {
		const stats = shiftStatsByCause.get(cause);
		if (!stats) continue;
		lines.push(`    ${cause.padEnd(24)} ${String(stats.frames).padStart(5)} frames  ${String(stats.totalAbsDy).padStart(7)}px  (idle ${stats.whileIdle})`);
	}
	const resizeEvents = events.filter((event) => event.kind === 'resize');
	const remountEvents = events.filter((event) => event.kind === 'remount-resize');
	const jumpEvents = events.filter((event) => event.kind === 'column-jump');
	const measureEvents = events.filter((event) => event.kind === 'measure');
	lines.push(`  on-screen card resizes: ${resizeEvents.length} (${new Set(resizeEvents.map((event) => event.noteId)).size} cards)   remounted at a different height: ${remountEvents.length}`);
	lines.push(`  column jumps seen on screen: ${jumpEvents.length}   layout recomputes: ${layoutRecomputes} (moved a card's column: ${layoutRecomputesWithMoves})`);
	lines.push(`  height commits: ${measureEvents.length} (first measurements ${measureEvents.filter((event) => event.from === null).length}, re-measurements ${measureEvents.filter((event) => event.from !== null).length})`);
	lines.push(`  padding changes: ${events.filter((event) => event.kind === 'pad').length}   grid-top moves: ${events.filter((event) => event.kind === 'grid-top').length}   frames with a layout animation running: ${framesWithAnimation}`);
	if (estimateMisses.length > 0) {
		const deltas = estimateMisses.map((miss) => Math.abs(miss.measured - miss.estimate)).sort((a, b) => a - b);
		lines.push(`  cards placed on a GUESSED height then measured: ${estimateMisses.length}, |guess - real| median ${deltas[Math.floor(deltas.length / 2)]}px, max ${deltas[deltas.length - 1]}px`);
	}
	lines.push('');

	const noteIds = new Set<string>([...domHeightsById.keys(), ...committedHeightsById.keys()]);
	const unstable = [...noteIds]
		.map((noteId) => {
			const dom = domHeightsById.get(noteId) ?? [];
			const committed = committedHeightsById.get(noteId) ?? [];
			return {
				noteId,
				dom,
				committed,
				flips: Math.max(countFlips(dom), countFlips(committed)),
				changes: Math.max(dom.length, committed.length) - 1,
			};
		})
		.filter((entry) => entry.changes > 0)
		.sort((a, b) => b.flips - a.flips || b.changes - a.changes)
		.slice(0, 20);
	lines.push('CARDS WHOSE HEIGHT CHANGED (flips = went back to a previous height)');
	if (unstable.length === 0) lines.push('  none');
	for (const entry of unstable) {
		lines.push(`  ${label(entry.noteId)} flips=${entry.flips} changes=${entry.changes} mounts=${mountCountById.get(entry.noteId) ?? 0}`);
		if (entry.dom.length > 1) lines.push(`      on screen: ${formatSequence(entry.dom)}`);
		if (entry.committed.length > 1) lines.push(`      committed: ${formatSequence(entry.committed)}`);
		const parts = lastPartsById.get(entry.noteId);
		if (parts) lines.push(`      last parts: ${formatParts(parts)}`);
		// Every part change this card went through, so a flip-flopping part shows up
		// as the same pair repeating.
		const partChanges = events
			.filter((event) => event.noteId === entry.noteId && event.info?.startsWith('changed:') && (event.kind === 'resize' || event.kind === 'remount-resize'))
			.map((event) => `${event.from}→${event.to}: ${event.info?.slice('changed: '.length)}`);
		for (const change of partChanges.slice(0, 8)) lines.push(`      ${change}`);
		if (partChanges.length > 8) lines.push(`      …${partChanges.length - 8} more part changes`);
	}
	lines.push('');

	lines.push('WORST HEIGHT GUESSES (virtualizer placed the card on this estimate before it was measured)');
	const worstMisses = estimateMisses
		.slice()
		.sort((a, b) => Math.abs(b.measured - b.estimate) - Math.abs(a.measured - a.estimate))
		.slice(0, 15);
	if (worstMisses.length === 0) lines.push('  none');
	for (const miss of worstMisses) {
		const delta = miss.measured - miss.estimate;
		lines.push(`  ${label(miss.noteId)} guess ${miss.estimate} → real ${miss.measured} (${delta > 0 ? '+' : ''}${delta})`);
	}
	lines.push('');

	lines.push('MOST-SHIFTED CARDS');
	const mostShifted = [...shiftCountById.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
	if (mostShifted.length === 0) lines.push('  none');
	for (const [noteId, count] of mostShifted) lines.push(`  ${label(noteId)} shifted in ${count} frames`);
	lines.push('');

	const layoutEvents = events.filter((event) => event.kind === 'layout');
	lines.push('LAYOUT RECOMPUTES THAT MOVED CARDS OR CHANGED ORDER');
	if (layoutEvents.length === 0) lines.push('  none');
	for (const event of layoutEvents.slice(-25)) lines.push(`  ${formatEvent(event)}`);
	lines.push('');

	const timeline = events.filter((event) => !(event.kind === 'measure' && event.from === null));
	lines.push(`TIMELINE (last ${Math.min(TIMELINE_LIMIT, timeline.length)} of ${timeline.length} events; first measurements omitted)`);
	for (const event of timeline.slice(-TIMELINE_LIMIT)) lines.push(formatEvent(event));
	return lines.join('\n');
}
