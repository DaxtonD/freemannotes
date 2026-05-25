const PERSIST_ENDPOINT = '/api/debug-log';
const MAX_EVENTS = 400;
const MAX_IMPORTANT_EVENTS = 240;
const MAX_UPLOAD_BATCH = 150;
const MAX_PENDING_UPLOADS = 2000;
const UPLOAD_FLUSH_DELAY_MS = 250;

export type GridDebugEventType =
	| 'GRID_RENDER'
	| 'NOTE_RENDER'
	| 'NOTE_MEASURE'
	| 'NOTE_HEIGHT_INVALIDATED'
	| 'HEIGHT_VERSION_BUMP'
	| 'RESIZE_OBSERVER_TRIGGER'
	| 'REPACK_START'
	| 'REPACK_END'
	| 'REPACK_REASON'
	| 'COLUMN_HEIGHTS_BEFORE'
	| 'COLUMN_HEIGHTS_AFTER'
	| 'NOTE_POSITION_ASSIGNED'
	| 'NOTE_PLACEMENT_DECISION'
	| 'COLUMN_SWAP'
	| 'VIEWPORT_STABILITY_OVERRIDE'
	| 'STABLE_ORDER_OVERRIDE'
	| 'SIBLING_ORDER_CHANGED'
	| 'COLUMN_ASSIGNMENT_CHANGED'
	| 'REBALANCE_SKIPPED'
	| 'REBALANCE_DEBOUNCED'
	| 'REBALANCE_SUPPRESSED'
	| 'STICKY_COLUMNS_SET'
	| 'STICKY_COLUMNS_REJECTED'
	| 'DRAG_START'
	| 'DRAG_END'
	| 'CHECKLIST_EXPAND'
	| 'CHECKLIST_COLLAPSE'
	| 'VIEW_SWITCH'
	| 'WORKSPACE_SWITCH'
	| 'LAYOUT_INVALIDATION'
	| 'PINNED_ORDER_DIVERGE'
	| 'INITIAL_LAYOUT_SETTLED'
	| 'ALL_DOCS_LOADED';

export type GridDebugEvent = {
	type: GridDebugEventType;
	timestamp: number;
	data?: Record<string, unknown>;
};

export type NoteInvalidationDebugInfo = {
	noteId: string;
	reason: string;
	updatedAt: number;
	height?: number | null;
};

export type NoteDebugInfo = {
	noteId: string;
	renderCount: number;
	measuredHeight: number | null;
	columnIndex: number | null;
	siblingIndex: number | null;
	previousColumn: number | null;
	previousSiblingIndex: number | null;
	previousY: number | null;
	nextY: number | null;
	placementReason: string | null;
	shortestColumn: number | null;
	shortestColumnHeight: number | null;
	preferredColumn: number | null;
	preferredColumnHeight: number | null;
	anchoredColumn: number | null;
	stabilitySlackPx: number | null;
	viewportStabilityOverridden: boolean;
	stableOrderOverridden: boolean;
	tieBreakerOccurred: boolean;
	isVisible: boolean;
	isViewportAnchor: boolean;
	isRecentlyMoved: boolean;
	isHeightChanged: boolean;
	isAffectedByExpansion: boolean;
	isAllowedToReposition: boolean;
	stabilityPriority: string | null;
	lastDecisionAt: number | null;
	lastInvalidationReason: string | null;
};

type GridDebugState = {
	events: GridDebugEvent[];
	importantEvents: GridDebugEvent[];
	renderCount: number;
	repackCount: number;
	heightVersionBumps: number;
	stickyColumnsSetCount: number;
	stickyColumnsRejectedCount: number;
	resizeObserverFireCount: number;
	dragCommitCount: number;
	noteRenderCounts: Map<string, number>;
	noteMeasuredHeights: Map<string, number>;
	noteColumnAssignments: Map<string, number>;
	noteDebugById: Map<string, NoteDebugInfo>;
	activeInvalidations: Map<string, NoteInvalidationDebugInfo>;
	lastRepackMs: number;
	repackTimestamps: number[];
	lastRepackReason: string | null;
	columnHeightsBefore: number[];
	columnHeightsAfter: number[];
	rebalanceSuppressionReason: string | null;
	rebalanceDebounceReason: string | null;
	lastLiveStateUpdatedAt: number;
};

const state: GridDebugState = {
	events: [],
	importantEvents: [],
	renderCount: 0,
	repackCount: 0,
	heightVersionBumps: 0,
	stickyColumnsSetCount: 0,
	stickyColumnsRejectedCount: 0,
	resizeObserverFireCount: 0,
	dragCommitCount: 0,
	noteRenderCounts: new Map(),
	noteMeasuredHeights: new Map(),
	noteColumnAssignments: new Map(),
	noteDebugById: new Map(),
	activeInvalidations: new Map(),
	lastRepackMs: 0,
	repackTimestamps: [],
	lastRepackReason: null,
	columnHeightsBefore: [],
	columnHeightsAfter: [],
	rebalanceSuppressionReason: null,
	rebalanceDebounceReason: null,
	lastLiveStateUpdatedAt: 0,
};

type PersistedGridDebugEvent = {
	type: GridDebugEventType;
	channel: 'masonry';
	scope: 'note-grid';
	clientTimeIso: string;
	perfTimeMs: number;
	data?: Record<string, unknown>;
};

const RENDER_ONLY_EVENT_TYPES: ReadonlySet<GridDebugEventType> = new Set([
	'GRID_RENDER',
	'NOTE_RENDER',
]);

let pendingUploads: PersistedGridDebugEvent[] = [];
let uploadFlushTimer: number | null = null;
let uploadInFlight = false;
let currentFlushPromise: Promise<void> | null = null;

function isDebugEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	try {
		if (localStorage.getItem('__ngDebug') === '1') return true;
	} catch {
		// localStorage unavailable in some contexts
	}
	if (process.env.NODE_ENV === 'production') return false;
	return Boolean((window as Window & { __noteGridDebug?: boolean }).__noteGridDebug);
}

function shouldPersistEvent(type: GridDebugEventType): boolean {
	if (!RENDER_ONLY_EVENT_TYPES.has(type)) return true;
	if (typeof window === 'undefined') return false;
	return Boolean((window as Window & { __noteGridDebugPersistRenders?: boolean }).__noteGridDebugPersistRenders);
}

function isImportantEvent(type: GridDebugEventType): boolean {
	return !RENDER_ONLY_EVENT_TYPES.has(type);
}

function getNoteDebug(noteId: string): NoteDebugInfo {
	const existing = state.noteDebugById.get(noteId);
	if (existing) return existing;
	const created: NoteDebugInfo = {
		noteId,
		renderCount: 0,
		measuredHeight: null,
		columnIndex: null,
		siblingIndex: null,
		previousColumn: null,
		previousSiblingIndex: null,
		previousY: null,
		nextY: null,
		placementReason: null,
		shortestColumn: null,
		shortestColumnHeight: null,
		preferredColumn: null,
		preferredColumnHeight: null,
		anchoredColumn: null,
		stabilitySlackPx: null,
		viewportStabilityOverridden: false,
		stableOrderOverridden: false,
		tieBreakerOccurred: false,
		isVisible: false,
		isViewportAnchor: false,
		isRecentlyMoved: false,
		isHeightChanged: false,
		isAffectedByExpansion: false,
		isAllowedToReposition: false,
		stabilityPriority: null,
		lastDecisionAt: null,
		lastInvalidationReason: null,
	};
	state.noteDebugById.set(noteId, created);
	return created;
}

function normalizeNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeBoolean(value: unknown): boolean {
	return value === true;
}

function normalizeString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function queuePersistentUpload(event: PersistedGridDebugEvent): void {
	if (typeof window === 'undefined') return;
	pendingUploads.push(event);
	if (pendingUploads.length > MAX_PENDING_UPLOADS) {
		pendingUploads = pendingUploads.slice(-MAX_PENDING_UPLOADS);
	}
	if (uploadFlushTimer !== null) {
		window.clearTimeout(uploadFlushTimer);
	}
	uploadFlushTimer = window.setTimeout(() => {
		uploadFlushTimer = null;
		void flushPersistentUploads();
	}, UPLOAD_FLUSH_DELAY_MS);
}

async function flushPersistentUploads(): Promise<void> {
	if (currentFlushPromise) {
		return currentFlushPromise;
	}
	currentFlushPromise = (async () => {
		if (typeof fetch !== 'function') return;
		if (uploadFlushTimer !== null && typeof window !== 'undefined') {
			window.clearTimeout(uploadFlushTimer);
			uploadFlushTimer = null;
		}
		while (pendingUploads.length > 0) {
			if (uploadInFlight) {
				await Promise.resolve();
				continue;
			}
			uploadInFlight = true;
			const batch = pendingUploads.slice(0, MAX_UPLOAD_BATCH);
			let uploaded = false;
			try {
				const response = await fetch(PERSIST_ENDPOINT, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(batch),
					keepalive: true,
				});
				uploaded = response.ok;
				if (uploaded) {
					pendingUploads.splice(0, batch.length);
				}
			} catch {
				// Best-effort debug transport.
			} finally {
				uploadInFlight = false;
			}
			if (!uploaded) {
				break;
			}
		}
		if (pendingUploads.length > 0 && typeof window !== 'undefined') {
			uploadFlushTimer = window.setTimeout(() => {
				uploadFlushTimer = null;
				void flushPersistentUploads();
			}, UPLOAD_FLUSH_DELAY_MS * 2);
		}
	})().finally(() => {
		currentFlushPromise = null;
	});
	return currentFlushPromise;
}

function updateNoteDebugFromData(noteId: string, data: Record<string, unknown>): void {
	const note = getNoteDebug(noteId);
	const renderCount = normalizeNumber(data.renderCount);
	if (renderCount !== null) note.renderCount = renderCount;
	const measuredHeight = normalizeNumber(data.measuredHeight ?? data.height);
	if (measuredHeight !== null) note.measuredHeight = measuredHeight;
	const columnIndex = normalizeNumber(data.columnIndex ?? data.assignedColumn ?? data.newColumn);
	if (columnIndex !== null) note.columnIndex = columnIndex;
	const siblingIndex = normalizeNumber(data.siblingIndex ?? data.assignedSiblingIndex ?? data.newSiblingIndex);
	if (siblingIndex !== null) note.siblingIndex = siblingIndex;
	note.previousColumn = normalizeNumber(data.previousColumn) ?? note.previousColumn;
	note.previousSiblingIndex = normalizeNumber(data.previousSiblingIndex) ?? note.previousSiblingIndex;
	note.previousY = normalizeNumber(data.previousY) ?? note.previousY;
	note.nextY = normalizeNumber(data.nextY) ?? note.nextY;
	note.placementReason = normalizeString(data.reason) ?? note.placementReason;
	note.shortestColumn = normalizeNumber(data.shortestColumn) ?? note.shortestColumn;
	note.shortestColumnHeight = normalizeNumber(data.shortestColumnHeight) ?? note.shortestColumnHeight;
	note.preferredColumn = normalizeNumber(data.preferredColumn) ?? note.preferredColumn;
	note.preferredColumnHeight = normalizeNumber(data.preferredColumnHeight) ?? note.preferredColumnHeight;
	note.anchoredColumn = normalizeNumber(data.anchoredColumn) ?? note.anchoredColumn;
	note.stabilitySlackPx = normalizeNumber(data.stabilitySlackPx) ?? note.stabilitySlackPx;
	note.viewportStabilityOverridden = normalizeBoolean(data.viewportStabilityOverridden) || note.viewportStabilityOverridden;
	note.stableOrderOverridden = normalizeBoolean(data.stableOrderOverridden) || note.stableOrderOverridden;
	note.tieBreakerOccurred = normalizeBoolean(data.tieBreakerOccurred) || note.tieBreakerOccurred;
	note.isVisible = normalizeBoolean(data.isVisible);
	note.isViewportAnchor = normalizeBoolean(data.isViewportAnchor);
	note.isRecentlyMoved = normalizeBoolean(data.isRecentlyMoved);
	note.isHeightChanged = normalizeBoolean(data.isHeightChanged);
	note.isAffectedByExpansion = normalizeBoolean(data.isAffectedByExpansion);
	note.isAllowedToReposition = normalizeBoolean(data.isAllowedToReposition);
	note.stabilityPriority = normalizeString(data.stabilityPriority) ?? note.stabilityPriority;
	note.lastDecisionAt = performance.now();
	const lastInvalidationReason = normalizeString(data.lastInvalidationReason);
	if (lastInvalidationReason) note.lastInvalidationReason = lastInvalidationReason;
	if (note.columnIndex !== null) {
		state.noteColumnAssignments.set(noteId, note.columnIndex);
	}
	if (note.measuredHeight !== null) {
		state.noteMeasuredHeights.set(noteId, note.measuredHeight);
	}
}

function updateStateForEvent(event: GridDebugEvent): void {
	const data = event.data ?? {};
	switch (event.type) {
		case 'GRID_RENDER':
			state.renderCount += 1;
			break;
		case 'NOTE_RENDER': {
			const noteId = normalizeString(data.noteId);
			if (!noteId) break;
			const nextCount = (state.noteRenderCounts.get(noteId) ?? 0) + 1;
			state.noteRenderCounts.set(noteId, nextCount);
			updateNoteDebugFromData(noteId, { ...data, renderCount: nextCount });
			break;
		}
		case 'NOTE_MEASURE': {
			const noteId = normalizeString(data.noteId);
			const height = normalizeNumber(data.height);
			if (!noteId || height === null) break;
			state.noteMeasuredHeights.set(noteId, height);
			updateNoteDebugFromData(noteId, { ...data, measuredHeight: height });
			break;
		}
		case 'NOTE_HEIGHT_INVALIDATED': {
			const noteId = normalizeString(data.noteId);
			const reason = normalizeString(data.reason) ?? 'unknown';
			if (!noteId) break;
			state.activeInvalidations.set(noteId, {
				noteId,
				reason,
				updatedAt: Date.now(),
				height: normalizeNumber(data.height),
			});
			updateNoteDebugFromData(noteId, { ...data, lastInvalidationReason: reason, isHeightChanged: true });
			break;
		}
		case 'HEIGHT_VERSION_BUMP':
			state.heightVersionBumps += 1;
			break;
		case 'RESIZE_OBSERVER_TRIGGER':
			state.resizeObserverFireCount += 1;
			break;
		case 'REPACK_START':
			state.repackCount += 1;
			state.lastRepackMs = event.timestamp;
			state.repackTimestamps.push(event.timestamp);
			if (state.repackTimestamps.length > 20) state.repackTimestamps.shift();
			break;
		case 'REPACK_REASON':
			state.lastRepackReason = normalizeString(data.reason);
			break;
		case 'COLUMN_HEIGHTS_BEFORE':
			state.columnHeightsBefore = Array.isArray(data.heights)
				? data.heights.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
				: [];
			break;
		case 'COLUMN_HEIGHTS_AFTER':
			state.columnHeightsAfter = Array.isArray(data.heights)
				? data.heights.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
				: [];
			state.activeInvalidations.clear();
			break;
		case 'NOTE_POSITION_ASSIGNED':
		case 'NOTE_PLACEMENT_DECISION':
		case 'COLUMN_SWAP':
		case 'VIEWPORT_STABILITY_OVERRIDE':
		case 'STABLE_ORDER_OVERRIDE':
		case 'SIBLING_ORDER_CHANGED':
		case 'COLUMN_ASSIGNMENT_CHANGED': {
			const noteId = normalizeString(data.noteId);
			if (!noteId) break;
			updateNoteDebugFromData(noteId, data);
			break;
		}
		case 'REBALANCE_DEBOUNCED':
			state.rebalanceDebounceReason = normalizeString(data.reason);
			break;
		case 'REBALANCE_SUPPRESSED':
			state.rebalanceSuppressionReason = normalizeString(data.reason);
			break;
		case 'STICKY_COLUMNS_SET':
			state.stickyColumnsSetCount += 1;
			break;
		case 'STICKY_COLUMNS_REJECTED':
			state.stickyColumnsRejectedCount += 1;
			break;
		case 'DRAG_END':
			state.dragCommitCount += 1;
			break;
		case 'CHECKLIST_EXPAND':
		case 'CHECKLIST_COLLAPSE': {
			const noteId = normalizeString(data.noteId);
			if (!noteId) break;
			updateNoteDebugFromData(noteId, { ...data, isAffectedByExpansion: true });
			break;
		}
		default:
			break;
	}
}

function record(type: GridDebugEventType, data?: Record<string, unknown>): void {
	const event: GridDebugEvent = {
		type,
		timestamp: typeof performance !== 'undefined' ? performance.now() : Date.now(),
		data,
	};
	state.events.push(event);
	if (state.events.length > MAX_EVENTS) {
		state.events.splice(0, state.events.length - MAX_EVENTS);
	}
	if (isImportantEvent(type)) {
		state.importantEvents.push(event);
		if (state.importantEvents.length > MAX_IMPORTANT_EVENTS) {
			state.importantEvents.splice(0, state.importantEvents.length - MAX_IMPORTANT_EVENTS);
		}
	}
	updateStateForEvent(event);
	if (typeof console !== 'undefined' && typeof console.debug === 'function') {
		console.debug('[masonry-debug]', type, data ?? {});
	}
	if (!shouldPersistEvent(type)) {
		return;
	}
	queuePersistentUpload({
		type,
		channel: 'masonry',
		scope: 'note-grid',
		clientTimeIso: new Date().toISOString(),
		perfTimeMs: Math.round(event.timestamp),
		data,
	});
}

export function debugGridRender(data?: Record<string, unknown>): void {
	if (!isDebugEnabled()) return;
	record('GRID_RENDER', data);
}

export function debugNoteRender(noteId: string, data?: Record<string, unknown>): void {
	if (!isDebugEnabled()) return;
	record('NOTE_RENDER', { noteId, ...data });
}

export function debugNoteMeasure(noteId: string, height: number, data?: Record<string, unknown> | number): void {
	if (!isDebugEnabled()) return;
	if (typeof data === 'number') {
		record('NOTE_MEASURE', { noteId, height, previousHeight: data });
		return;
	}
	record('NOTE_MEASURE', { noteId, height, ...(data ?? {}) });
}

export function debugNoteHeightInvalidated(
	noteId: string,
	dataOrHeight: { reason: string; height?: number | null; [key: string]: unknown } | number,
	previousHeight?: number | null,
	reason?: string
): void {
	if (!isDebugEnabled()) return;
	if (typeof dataOrHeight === 'number') {
		record('NOTE_HEIGHT_INVALIDATED', {
			noteId,
			height: dataOrHeight,
			previousHeight: previousHeight ?? null,
			reason: reason ?? 'unknown',
		});
		return;
	}
	record('NOTE_HEIGHT_INVALIDATED', { noteId, ...dataOrHeight });
}

export function debugHeightVersionBump(reason: string, data?: Record<string, unknown>): void {
	if (!isDebugEnabled()) return;
	record('HEIGHT_VERSION_BUMP', { reason, ...data });
}

export function debugResizeObserverTrigger(noteId: string, height: number): void {
	if (!isDebugEnabled()) return;
	record('RESIZE_OBSERVER_TRIGGER', { noteId, height });
}

export function debugRepackReason(reason: string, data?: Record<string, unknown>): void {
	if (!isDebugEnabled()) return;
	record('REPACK_REASON', { reason, ...data });
}

export function debugColumnHeightsBefore(heights: readonly number[], data?: Record<string, unknown>): void {
	if (!isDebugEnabled()) return;
	record('COLUMN_HEIGHTS_BEFORE', { heights: Array.from(heights), ...data });
}

export function debugColumnHeightsAfter(heights: readonly number[], data?: Record<string, unknown>): void {
	if (!isDebugEnabled()) return;
	record('COLUMN_HEIGHTS_AFTER', { heights: Array.from(heights), ...data });
}

export function debugRepackStart(renderedCount: number, columnCount: number, reason?: string, data?: Record<string, unknown>): void {
	if (!isDebugEnabled()) return;
	record('REPACK_START', { renderedCount, columnCount, reason: reason ?? null, ...data });
	if (reason) {
		record('REPACK_REASON', { reason, ...data });
	}
}

export function debugRepackEnd(args: {
	renderedCount?: number;
	columnCount?: number;
	columns: readonly string[][];
	heights?: readonly number[];
	columnHeights?: readonly number[];
	notePositions?: readonly Record<string, unknown>[];
	reason?: string;
	data?: Record<string, unknown>;
}): void {
	if (!isDebugEnabled()) return;
	const heights = args.heights ?? args.columnHeights ?? [];
	record('REPACK_END', {
		renderedCount: args.renderedCount ?? args.columns.flat().length,
		columnCount: args.columnCount ?? args.columns.length,
		columnSizes: args.columns.map((column) => column.length),
		heights: Array.from(heights),
		notePositions: args.notePositions,
		reason: args.reason ?? null,
		...args.data,
	});
	record('COLUMN_HEIGHTS_AFTER', {
		heights: Array.from(heights),
		reason: args.reason ?? null,
		...args.data,
	});
}

export function debugNotePositionAssigned(data: {
	noteId: string;
	columnIndex: number;
	siblingIndex: number;
	y: number;
	height: number;
	previousY?: number | null;
	previousColumn?: number | null;
	previousSiblingIndex?: number | null;
}): void {
	if (!isDebugEnabled()) return;
	record('NOTE_POSITION_ASSIGNED', {
		noteId: data.noteId,
		columnIndex: data.columnIndex,
		siblingIndex: data.siblingIndex,
		nextY: data.y,
		height: data.height,
		previousY: data.previousY ?? null,
		previousColumn: data.previousColumn ?? null,
		previousSiblingIndex: data.previousSiblingIndex ?? null,
	});
}

export function debugNotePlacementDecision(data: Record<string, unknown> & { noteId: string }): void {
	if (!isDebugEnabled()) return;
	record('NOTE_PLACEMENT_DECISION', data);
}

export function debugColumnSwap(data: Record<string, unknown> & { noteId: string }): void {
	if (!isDebugEnabled()) return;
	record('COLUMN_SWAP', data);
}

export function debugViewportStabilityOverride(data: Record<string, unknown> & { noteId: string }): void {
	if (!isDebugEnabled()) return;
	record('VIEWPORT_STABILITY_OVERRIDE', data);
}

export function debugStableOrderOverride(data: Record<string, unknown> & { noteId: string }): void {
	if (!isDebugEnabled()) return;
	record('STABLE_ORDER_OVERRIDE', data);
}

export function debugRebalanceSkipped(reason: string, data?: Record<string, unknown>): void {
	if (!isDebugEnabled()) return;
	record('REBALANCE_SKIPPED', { reason, ...data });
}

export function debugRebalanceDebounced(reason: string, data?: Record<string, unknown>): void {
	if (!isDebugEnabled()) return;
	record('REBALANCE_DEBOUNCED', { reason, ...data });
}

export function debugRebalanceSuppressed(reason: string, data?: Record<string, unknown>): void {
	if (!isDebugEnabled()) return;
	record('REBALANCE_SUPPRESSED', { reason, ...data });
}

export function debugStickyColumnsSet(sizeSummary: number[]): void {
	if (!isDebugEnabled()) return;
	record('STICKY_COLUMNS_SET', { sizeSummary });
}

export function debugStickyColumnsRejected(reason: string, data?: Record<string, unknown>): void {
	if (!isDebugEnabled()) return;
	record('STICKY_COLUMNS_REJECTED', { reason, ...data });
}

export function debugDragStart(draggedId: string, activeColumnSizes: number[]): void {
	if (!isDebugEnabled()) return;
	record('DRAG_START', { draggedId, activeColumnSizes });
}

export function debugDragEnd(data?: Record<string, unknown>): void {
	if (!isDebugEnabled()) return;
	record('DRAG_END', data);
}

export function debugDragCommit(draggedId: string, columnCount: number, targetColumn: number): void {
	if (!isDebugEnabled()) return;
	record('DRAG_END', { draggedId, columnCount, targetColumn, committed: true });
}

export function debugChecklistToggle(noteId: string, expanded: boolean): void {
	if (!isDebugEnabled()) return;
	record(expanded ? 'CHECKLIST_EXPAND' : 'CHECKLIST_COLLAPSE', { noteId });
}

export function debugSiblingOrderChanged(data: {
	noteId: string;
	previousColumn: number | null;
	newColumn: number;
	previousSiblingIndex: number | null;
	newSiblingIndex: number;
	measuredHeight: number;
	reason: string;
	preferredColumnHeight: number | null;
	shortestColumnHeight: number;
	stabilitySlackPx: number;
}): void {
	if (!isDebugEnabled()) return;
	record('SIBLING_ORDER_CHANGED', data);
}

export function debugColumnAssignmentChanged(data: {
	noteId: string;
	previousColumn: number | null;
	newColumn: number;
	previousSiblingIndex: number | null;
	newSiblingIndex: number;
	measuredHeight: number;
	reason: string;
	preferredColumnHeight: number | null;
	shortestColumnHeight: number;
	stabilitySlackPx: number;
}): void {
	if (!isDebugEnabled()) return;
	record('COLUMN_ASSIGNMENT_CHANGED', data);
}

export function debugViewSwitch(from: string, to: string): void {
	if (!isDebugEnabled()) return;
	record('VIEW_SWITCH', { from, to });
}

export function debugWorkspaceSwitch(from: string | undefined, to: string | undefined): void {
	if (!isDebugEnabled()) return;
	record('WORKSPACE_SWITCH', { from, to });
}

export function debugLayoutInvalidation(reason: string, data?: Record<string, unknown>): void {
	if (!isDebugEnabled()) return;
	record('LAYOUT_INVALIDATION', { reason, ...data });
}

export function debugPinnedOrderDiverge(readingOrderSample: string[], constrainedOrderSample: string[]): void {
	if (!isDebugEnabled()) return;
	record('PINNED_ORDER_DIVERGE', {
		readingOrderSample: readingOrderSample.slice(0, 6),
		constrainedOrderSample: constrainedOrderSample.slice(0, 6),
	});
}

export function debugInitialLayoutSettled(): void {
	if (!isDebugEnabled()) return;
	record('INITIAL_LAYOUT_SETTLED', { repackCount: state.repackCount, heightBumps: state.heightVersionBumps });
}

export function debugAllDocsLoaded(): void {
	if (!isDebugEnabled()) return;
	record('ALL_DOCS_LOADED', { repackCount: state.repackCount });
}

export type LiveGridState = {
	scrollY: number;
	activeDragId: string | null;
	stickyColumnSizes: number[] | null;
	resolvedBaseColumnSizes: number[];
	columnHeights: number[];
	renderedCount: number;
	columnCount: number;
	initialLayoutSettled: boolean;
	noteHeightsVersion: number;
	isGridVisible: boolean;
	workspaceId: string | null;
	isDropSettling: boolean;
	dropSettlingNoteId: string | null;
	cardPositionAnimationsReady: boolean;
	activeViewportAnchorIds: string[];
	activeInvalidations: NoteInvalidationDebugInfo[];
	activeAnimations: string[];
	lastRepackReason: string | null;
};

let liveState: LiveGridState | null = null;

export function debugUpdateLiveState(s: LiveGridState): void {
	if (process.env.NODE_ENV === 'production') return;
	liveState = s;
	state.lastLiveStateUpdatedAt = Date.now();
}

export type GridDebugSummary = {
	renderCount: number;
	repackCount: number;
	heightVersionBumps: number;
	stickyColumnsSetCount: number;
	stickyColumnsRejectedCount: number;
	stickyRejectionRate: string;
	resizeObserverFireCount: number;
	dragCommitCount: number;
	repacks_per_second_last20: number;
	recentEvents: GridDebugEvent[];
	recentImportantEvents: GridDebugEvent[];
	noteCount: number;
	noteColumnAssignments: Record<string, number>;
	noteMeasuredHeights: Record<string, number>;
	noteDebugById: Record<string, NoteDebugInfo>;
	activeInvalidations: NoteInvalidationDebugInfo[];
	columnHeightsBefore: number[];
	columnHeightsAfter: number[];
	lastRepackReason: string | null;
	rebalanceSuppressionReason: string | null;
	rebalanceDebounceReason: string | null;
	liveState: LiveGridState | null;
	lastLiveStateUpdatedAt: number;
};

export function getDebugSummary(): GridDebugSummary {
	const repackTimestamps = state.repackTimestamps;
	let repacks_per_second_last20 = 0;
	if (repackTimestamps.length >= 2) {
		const window_ms = repackTimestamps[repackTimestamps.length - 1] - repackTimestamps[0];
		if (window_ms > 0) {
			repacks_per_second_last20 = (repackTimestamps.length / window_ms) * 1000;
		}
	}
	const rejectedRate = state.stickyColumnsSetCount > 0
		? `${((state.stickyColumnsRejectedCount / state.stickyColumnsSetCount) * 100).toFixed(1)}%`
		: 'n/a';
	return {
		renderCount: state.renderCount,
		repackCount: state.repackCount,
		heightVersionBumps: state.heightVersionBumps,
		stickyColumnsSetCount: state.stickyColumnsSetCount,
		stickyColumnsRejectedCount: state.stickyColumnsRejectedCount,
		stickyRejectionRate: rejectedRate,
		resizeObserverFireCount: state.resizeObserverFireCount,
		dragCommitCount: state.dragCommitCount,
		repacks_per_second_last20,
		recentEvents: state.events.slice(-40),
		recentImportantEvents: state.importantEvents.slice(-60),
		noteCount: state.noteMeasuredHeights.size,
		noteColumnAssignments: Object.fromEntries(state.noteColumnAssignments),
		noteMeasuredHeights: Object.fromEntries(state.noteMeasuredHeights),
		noteDebugById: Object.fromEntries(state.noteDebugById),
		activeInvalidations: Array.from(state.activeInvalidations.values()),
		columnHeightsBefore: [...state.columnHeightsBefore],
		columnHeightsAfter: [...state.columnHeightsAfter],
		lastRepackReason: state.lastRepackReason,
		rebalanceSuppressionReason: state.rebalanceSuppressionReason,
		rebalanceDebounceReason: state.rebalanceDebounceReason,
		liveState,
		lastLiveStateUpdatedAt: state.lastLiveStateUpdatedAt,
	};
}

export function resetDebug(): void {
	state.events.length = 0;
	state.importantEvents.length = 0;
	state.renderCount = 0;
	state.repackCount = 0;
	state.heightVersionBumps = 0;
	state.stickyColumnsSetCount = 0;
	state.stickyColumnsRejectedCount = 0;
	state.resizeObserverFireCount = 0;
	state.dragCommitCount = 0;
	state.noteRenderCounts.clear();
	state.noteMeasuredHeights.clear();
	state.noteColumnAssignments.clear();
	state.noteDebugById.clear();
	state.activeInvalidations.clear();
	state.lastRepackMs = 0;
	state.repackTimestamps.length = 0;
	state.lastRepackReason = null;
	state.columnHeightsBefore = [];
	state.columnHeightsAfter = [];
	state.rebalanceSuppressionReason = null;
	state.rebalanceDebounceReason = null;
	state.lastLiveStateUpdatedAt = 0;
	liveState = null;
	pendingUploads = [];
	if (uploadFlushTimer !== null && typeof window !== 'undefined') {
		window.clearTimeout(uploadFlushTimer);
		uploadFlushTimer = null;
	}
}

function getImportantDebugPayload(): object {
	return {
		summary: getDebugSummary(),
		liveState,
		events: [...state.importantEvents],
	};
}

function getImportantDebugText(): string {
	return JSON.stringify(getImportantDebugPayload(), null, 2);
}

function printImportantDebugText(): string {
	const payload = getImportantDebugText();
	if (typeof console !== 'undefined') {
		console.log(payload);
	}
	return payload;
}

function downloadImportantDebugPayload(): void {
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	const payload = getImportantDebugText();
	const blob = new Blob([payload], { type: 'application/json' });
	const url = window.URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `masonry-debug-client-${Date.now()}.json`;
	anchor.click();
	window.URL.revokeObjectURL(url);
}

if (typeof window !== 'undefined') {
	type NgWindow = Window & {
		__noteGridDebugSummary?: () => GridDebugSummary;
		__noteGridDebugReset?: () => void;
		__noteGridDebugEvents?: () => GridDebugEvent[];
		__noteGridDebugImportantEvents?: () => GridDebugEvent[];
		__noteGridDebugImportantText?: () => string;
		__noteGridDebugPrintImportant?: () => string;
		__noteGridDebugFlush?: () => Promise<void>;
		__noteGridDebugDownloadImportant?: () => void;
		__noteGridDebug?: boolean;
		__ng?: () => object;
		__ngImportant?: () => object;
		__ngImportantText?: () => string;
		__ngReset?: () => void;
	};
	const w = window as NgWindow;
	w.__noteGridDebugSummary = getDebugSummary;
	w.__noteGridDebugReset = resetDebug;
	w.__noteGridDebugEvents = () => [...state.events];
	w.__noteGridDebugImportantEvents = () => [...state.importantEvents];
	w.__noteGridDebugImportantText = getImportantDebugText;
	w.__noteGridDebugPrintImportant = printImportantDebugText;
	w.__noteGridDebugFlush = flushPersistentUploads;
	w.__noteGridDebugDownloadImportant = downloadImportantDebugPayload;
	w.__ng = () => ({
		summary: getDebugSummary(),
		liveState,
		events: [...state.events],
	});
	w.__ngImportant = getImportantDebugPayload;
	w.__ngImportantText = getImportantDebugText;
	w.__ngReset = resetDebug;
	window.addEventListener('pagehide', () => {
		void flushPersistentUploads();
	});
}