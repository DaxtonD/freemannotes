/**
 * BubbleView – cross-workspace notes overview.
 *
 * Renders all accessible notes as size-weighted bubbles arranged in 3 lanes.
 * - Active workspace: full real-time data, scored by importance.
 * - Other workspaces: loaded once from local IndexedDB (offline-first, title only).
 *
 * Importance score (active workspace only):
 *   hasReminderSoon (+3)  isPinned (+2)  recentlyEdited (+2)  hasCollaborators (+1)
 * Score >= 5 → large; >= 2 → medium; else → small.
 *
 * Lane assignment: active workspace → center; others distributed left/right.
 * Within a lane: sorted by score descending, stable secondary key = title.
 *
 * Zoom: CSS custom property --bv-scale = 0.5 + (zoom/100).
 * Input: Ctrl+scroll (desktop) or pinch (touch).
 */

import React from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBell, faThumbtack, faUsers } from '@fortawesome/free-solid-svg-icons';
import { motion, LayoutGroup } from 'framer-motion';
import { useDocumentManager } from '../../core/DocumentManagerContext';
import type { ThemeId } from '../../core/theme';
import { readNoteFromDoc } from '../../core/noteModel';
import { BUBBLE_ZOOM_MAX, BUBBLE_ZOOM_MIN } from '../../core/bubbleZoom';
import { getWorkspaceBubbleColorScheme, toWorkspaceBubbleColorStyle } from '../../core/bubbleWorkspaceColors';
import {
	listSharedNotePlacements,
	readCachedNoteShareCollaborators,
	syncNoteShareCollaborators,
	type SharedNotePlacement,
	type WorkspaceSystemKind,
} from '../../core/noteShareApi';
import type { ReminderFilterMode } from '../../utilities/getVisibleNotes';
import styles from './BubbleView.module.css';

// ── Constants ──────────────────────────────────────────────────────────────

const NOTES_REGISTRY_ID = '__notes_registry__';
const NOTES_LIST_KEY = 'notesList';
const NOTE_ORDER_KEY = 'noteOrder';
const IDB_LOAD_TIMEOUT_MS = 4_000;
const MAX_NOTES_PER_INACTIVE_WORKSPACE = 80;

const ZOOM_MIN = BUBBLE_ZOOM_MIN;
const ZOOM_MAX = BUBBLE_ZOOM_MAX;
// BubbleView layout debugging is intentionally kept in comments for future
// troubleshooting. Re-enable the constants, types, state, and overlay below if
// another resize/measurement regression needs instrumentation.
// const BUBBLE_DEBUG_STORAGE_KEY = 'freemannotes.bubbleDebug';
// const MAX_DEBUG_EVENTS = 12;

// ── Types ──────────────────────────────────────────────────────────────────

export type BubbleWorkspaceInfo = {
	id: string;
	name: string;
	systemKind?: WorkspaceSystemKind;
};

type BubbleNote = {
	noteId: string;
	workspaceId: string;
	workspaceName: string;
	title: string;
	searchText: string;
	updatedAt: number;
	reminderAt: string | null;
	isPinned: boolean;
	hasReminder: boolean;
	hasCollaborators: boolean;
	isActiveWorkspace: boolean;
};

type ScoredBubbleNote = BubbleNote & {
	score: number;
};

// type BubbleDebugEvent = {
// 	id: string;
// 	label: string;
// 	timestamp: string;
// 	viewportWidth: number;
// 	containerClientWidth: number;
// 	containerWidth: number;
// 	cloudClientWidth: number;
// 	packedWidth: number;
// 	packedHeight: number;
// 	filteredCount: number;
// 	overflowCount: number;
// 	rightOverflow: number;
// 	sidebarIsCollapsed: boolean;
// 	mobile: boolean;
// };

type PackedBubbleLayoutItem = {
	note: ScoredBubbleNote;
	sizeClass: BubbleSizeClass;
	detailLevel: BubbleDetailLevel;
	bubbleDiameter: number;
	layoutDiameter: number; // packing diameter = bubbleDiameter (gap handled externally)
	left: number;           // absolute left of the cloudItem box
	top: number;            // absolute top  of the cloudItem box
	rotateDeg: number;
	floatDuration: number;
	floatDelay: number;
	workspaceColorStyle: React.CSSProperties;
	doc: Y.Doc | null;
};

type BubbleSizeClass = 'size1' | 'size2' | 'size3' | 'size4' | 'size5' | 'size6' | 'size7' | 'size8';
type BubbleDetailLevel = 'title' | 'meta' | 'full';

const BUBBLE_BASE_DIAMETER: Record<BubbleSizeClass, number> = {
	size1: 52,
	size2: 62,
	size3: 72,
	size4: 84,
	size5: 98,
	size6: 114,
	size7: 132,
	size8: 152,
};

const BUBBLE_SIZE_CLASSES: readonly BubbleSizeClass[] = ['size1', 'size2', 'size3', 'size4', 'size5', 'size6', 'size7', 'size8'];

/** Maps a raw importance score (0–15) to one of the eight visual size classes. */
function scoreToSizeClass(score: number): BubbleSizeClass {
	if (score >= 14) return 'size8';
	if (score >= 12) return 'size7';
	if (score >= 10) return 'size6';
	if (score >= 8) return 'size5';
	if (score >= 6) return 'size4';
	if (score >= 4) return 'size3';
	if (score >= 2) return 'size2';
	return 'size1';
}

function getBubbleSizeRank(sizeClass: BubbleSizeClass): number {
	return BUBBLE_SIZE_CLASSES.indexOf(sizeClass) + 1;
}

/**
 * Greedy circle packing using an Archimedean spiral search and a spatial hash
 * grid for O(1) collision lookups.
 *
 * For each bubble (sorted largest-first so large circles claim space early):
 *  1. Pick a seeded-random start position in the upper portion of the cloud.
 *  2. Walk an Archimedean spiral from that start, checking each candidate.
 *  3. Place the bubble at the first collision-free, in-bounds position.
 *
 * Complexity: O(N × S × G) — N bubbles, S ≤ 500 spiral steps per bubble,
 * G ≈ constant neighbors per grid cell.  Handles 500+ bubbles in < 5 ms.
 *
 * @param inputs        Items with noteId and radius (visual radius, without gap).
 * @param containerWidth Available pixel width.
 * @param gap           Minimum gap between bubble edges in pixels.
 * @returns Map of noteId → centre position { cx, cy }.
 */
function packBubbles(
	inputs: readonly { noteId: string; r: number }[],
	containerWidth: number,
	gap: number,
): Map<string, { cx: number; cy: number }> {
	const result = new Map<string, { cx: number; cy: number }>();
	if (inputs.length === 0 || containerWidth <= 0) return result;

	// Sort largest-first — big circles claim centre space, small ones fill gaps.
	const sorted = [...inputs].sort((a, b) => b.r - a.r);

	// Spatial hash grid: cell size = smallest bubble radius × 1.5 so each query
	// covers at most 9 cells and finds all potential colliders.
	const CELL = Math.max(24, (sorted[sorted.length - 1]?.r ?? 24) * 1.5);
	const grid = new Map<number, string[]>();
	const placed = new Map<string, { cx: number; cy: number; r: number }>();
	let cloudMaxY = 0; // bottom edge of the tallest placed bubble

	// Integer grid key — offset to handle potential negative x cells near left edge.
	const gk = (gx: number, gy: number): number => (gx + 512) * 8192 + gy;

	const register = (id: string, cx: number, cy: number, r: number): void => {
		const x0 = Math.floor((cx - r) / CELL);
		const x1 = Math.floor((cx + r) / CELL);
		const y0 = Math.floor((cy - r) / CELL);
		const y1 = Math.floor((cy + r) / CELL);
		for (let gx = x0; gx <= x1; gx++) {
			for (let gy = y0; gy <= y1; gy++) {
				const key = gk(gx, gy);
				const bucket = grid.get(key);
				if (bucket) bucket.push(id);
				else grid.set(key, [id]);
			}
		}
		placed.set(id, { cx, cy, r });
		result.set(id, { cx, cy });
		cloudMaxY = Math.max(cloudMaxY, cy + r);
	};

	const fits = (cx: number, cy: number, r: number): boolean => {
		// Keep within container horizontally; no top bound (cloud grows down).
		if (cx - r < 2 || cx + r > containerWidth - 2 || cy - r < 2) return false;
		const margin = r + gap;
		const x0 = Math.floor((cx - margin) / CELL);
		const x1 = Math.floor((cx + margin) / CELL);
		const y0 = Math.floor((cy - margin) / CELL);
		const y1 = Math.floor((cy + margin) / CELL);
		for (let gx = x0; gx <= x1; gx++) {
			for (let gy = y0; gy <= y1; gy++) {
				const bucket = grid.get(gk(gx, gy));
				if (!bucket) continue;
				for (const id of bucket) {
					const o = placed.get(id)!;
					const dx = cx - o.cx;
					const dy = cy - o.cy;
					const minD = r + o.r + gap;
					if (dx * dx + dy * dy < minD * minD) return false;
				}
			}
		}
		return true;
	};

	for (const { noteId, r } of sorted) {
		// Seed a start position inside the cloud's current extent.
		// py is biased toward existing content so bubbles fill gaps rather than
		// growing a tail at the bottom.
		const sx = Math.max(r + 2, Math.min(containerWidth - r - 2,
			seededRandom(`${noteId}:px`) * containerWidth));
		const sy = r + 2 + seededRandom(`${noteId}:py`) * Math.max(r * 2, cloudMaxY * 0.7);

		// Archimedean spiral: radius = a × θ / 2π, step angle 0.45 rad.
		// Setting a = max(r×0.5, 8) keeps arms reasonably tight so nearby gaps
		// are probed before marching far from the seed.
		const a = Math.max(r * 0.5, 8);
		const dTheta = 0.45;
		let found = false;

		for (let t = 0; t < 500; t++) {
			const theta = t * dTheta;
			const rs = a * theta / (2 * Math.PI);
			const cx = sx + Math.cos(theta) * rs;
			const cy = sy + Math.sin(theta) * rs;
			if (fits(cx, cy, r)) {
				register(noteId, cx, cy, r);
				found = true;
				break;
			}
		}

		if (!found) {
			// Fallback: systematic strip scan from the top so we always place.
			const step = r * 0.7;
			let placed_ = false;
			outer: for (let cy = r + 2; cy < cloudMaxY + 800; cy += step) {
				for (let cx = r + 2; cx <= containerWidth - r - 2; cx += step) {
					if (fits(cx, cy, r)) {
						register(noteId, cx, cy, r);
						placed_ = true;
						break outer;
					}
				}
			}
			if (!placed_) {
				// Ultimate fallback: stack below everything.
				register(noteId, containerWidth / 2, cloudMaxY + r + gap, r);
			}
		}
	}

	return result;
}

// ── Seeded deterministic hash (no crypto) ─────────────────────────────────
// These helpers produce a stable float in [0, 1) for any string key.
// Using a deterministic seed (noteId + suffix) means layout values such as
// rotation, float timing, and vertical stagger remain constant across re-renders
// and across devices, so the bubble cloud looks the same to every user.

function hashCode(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
	}
	return hash;
}

function seededRandom(seed: string): number {
	const h = Math.abs(hashCode(seed));
	return (h % 1000) / 1000;
}

// function isBubbleDebugEnabled(): boolean {
// 	if (typeof window === 'undefined') return false;
// 	try {
// 		const search = new URLSearchParams(window.location.search);
// 		if (search.get('bubbleDebug') === '1') return true;
// 		if (window.localStorage.getItem(BUBBLE_DEBUG_STORAGE_KEY) === '1') return true;
// 	} catch {
// 		// Best-effort only.
// 	}
// 	return Boolean((window as Window & { DEBUG?: boolean }).DEBUG);
// }

// function persistBubbleDebugEnabled(enabled: boolean): void {
// 	if (typeof window === 'undefined') return;
// 	try {
// 		window.localStorage.setItem(BUBBLE_DEBUG_STORAGE_KEY, enabled ? '1' : '0');
// 	} catch {
// 		// Best-effort only.
// 	}
// }

function isUuidLike(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	if (!normalized) return false;
	if (/^[0-9a-f]{32}$/.test(normalized)) return true;
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized);
}

function resolveBubbleTitle(noteId: string, title: string): string {
	const raw = title.trim();
	if (!raw) return '';
	if (raw.toLowerCase() === noteId.trim().toLowerCase()) return '';
	if (isUuidLike(raw)) return '';
	return raw;
}

// ── Balanced activity scoring ──────────────────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

type BubbleScoreInputs = {
	updatedAt: number;
	reminderAt: string | null;
	isPinned: boolean;
	collaboratorCount: number;
};

/**
 * Computes a 0–15 importance score used to size bubbles.
 *
 * Score contributions (capped at 15):
 *   +3  reminder due within 24 h
 *   +2  note is pinned
 *   +2  edited < 5 min ago   (+1 if edited < 30 min ago)
 *   +log2(collaborators+2)×0.5  shared notes get a logarithmic boost
 */
function computeBalancedActivityScore(inputs: BubbleScoreInputs, now = Date.now()): number {
	const reminderMs = inputs.reminderAt ? Date.parse(inputs.reminderAt) : Number.NaN;
	const hasReminderSoon = Number.isFinite(reminderMs) && reminderMs >= now && reminderMs - now < ONE_DAY_MS;
	const reminderScore = hasReminderSoon ? 3 : 0;
	const pinScore = inputs.isPinned ? 2 : 0;

	const minutesAgo = inputs.updatedAt > 0 ? (now - inputs.updatedAt) / 60000 : Number.POSITIVE_INFINITY;
	let recencyScore = 0;
	if (minutesAgo < FIVE_MINUTES_MS / 60000) recencyScore = 2;
	else if (minutesAgo < THIRTY_MINUTES_MS / 60000) recencyScore = 1;

	const users = Math.max(inputs.collaboratorCount + 1, 1);
	const collabScore = Math.log2(users + 1) * 0.5;
	return Math.min(reminderScore + pinScore + recencyScore + collabScore, 15);
}

/**
 * Exponential moving average smoothing applied to bubble scores.
 *
 * alpha = 0.10 means:
 *   - A single transient event (e.g. opening a note) nudges the visual size by
 *     only 10 % of the delta — nearly imperceptible.
 *   - After 25 ticks at the 1.5 s interval (~37 s) any remote client that
 *     received a sync event has converged to ≥ 93 % of the new score, so
 *     bubbles resize smoothly rather than snapping.
 */
function smoothScore(previous: number | null | undefined, next: number): number {
	if (!Number.isFinite(previous ?? Number.NaN)) return next;
	const prev = previous as number;
	return prev * 0.90 + next * 0.10;
}

// ── IDB reading helpers ────────────────────────────────────────────────────

type RegistryEntry = { noteId: string; title: string };

type LoadedInactiveNote = RegistryEntry & {
	updatedAt: number;
	reminderAt: string | null;
	isPinned: boolean;
	hasReminder: boolean;
	searchText: string;
};

function extractNoteSearchText(noteId: string, doc: Y.Doc | null, fallbackTitle = ''): string {
	if (!doc) return fallbackTitle.trim();
	try {
		const note = readNoteFromDoc(doc, noteId);
		if (note.type === 'checklist') {
			return [note.title, ...(note.items ?? []).map((item) => item.text ?? '')].join(' ').replace(/\s+/g, ' ').trim();
		}
		return [note.title, note.content ?? ''].join(' ').replace(/\s+/g, ' ').trim();
	} catch {
		return fallbackTitle.trim();
	}
}

function matchesBubbleSearch(note: BubbleNote, doc: Y.Doc | null, query: string): boolean {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return true;
	const terms = normalized.split(/\s+/).filter(Boolean);
	if (terms.length === 0) return true;
	const haystack = [
		note.workspaceName,
		note.title,
		note.searchText,
		extractNoteSearchText(note.noteId, doc, note.title),
	].join(' ').toLowerCase();
	return terms.every((term) => haystack.includes(term));
}

function toTimestamp(value: string | number | null | undefined, fallback = 0): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}
	return fallback;
}

function startOfTomorrow(now: Date): number {
	const copy = new Date(now);
	copy.setHours(24, 0, 0, 0);
	return copy.getTime();
}

function endOfTomorrow(now: Date): number {
	const copy = new Date(now);
	copy.setHours(48, 0, 0, 0);
	return copy.getTime();
}

function matchesReminderFilter(reminderAt: string | null, mode: ReminderFilterMode, nowMs: number): boolean {
	if (mode === 'all') return true;
	if (!reminderAt) return false;
	const reminderMs = toTimestamp(reminderAt, Number.NaN);
	if (!Number.isFinite(reminderMs)) return false;
	if (mode === 'past-due') {
		return reminderMs < nowMs;
	}
	if (mode === 'due-soon') {
		return reminderMs >= nowMs && reminderMs <= nowMs + 72 * 60 * 60 * 1000;
	}
	const now = new Date(nowMs);
	if (mode === 'later-today') {
		return reminderMs >= nowMs && reminderMs < startOfTomorrow(now);
	}
	if (mode === 'tomorrow') {
		const tomorrowStart = startOfTomorrow(now);
		const tomorrowEnd = endOfTomorrow(now);
		return reminderMs >= tomorrowStart && reminderMs < tomorrowEnd;
	}
	if (mode === 'next-week') {
		const weekStart = startOfTomorrow(now);
		const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
		return reminderMs >= weekStart && reminderMs < weekEnd;
	}
	return true;
}

async function loadInactiveWorkspaceNote(
	workspaceId: string,
	entry: RegistryEntry,
	showTrashed: boolean,
	reminderFilter: ReminderFilterMode,
	nowMs: number
): Promise<LoadedInactiveNote | null> {
	const roomName = `${workspaceId}:${entry.noteId}`;
	const doc = new Y.Doc();
	const idb = new IndexeddbPersistence(roomName, doc);

	await Promise.race([
		new Promise<void>((resolve) => {
			if ((idb as any).synced) { resolve(); return; }
			idb.on('synced', () => resolve());
		}),
		new Promise<void>((resolve) => { window.setTimeout(resolve, IDB_LOAD_TIMEOUT_MS); }),
	]);

	try {
		const metadata = doc.getMap<any>('metadata');
		const isTrashed = Boolean(metadata.get('trashed'));
		if (showTrashed ? !isTrashed : isTrashed) return null;
		const reminderAtRaw = metadata.get('reminderAt');
		const reminderAt = typeof reminderAtRaw === 'string' ? reminderAtRaw : null;
		if (!matchesReminderFilter(reminderAt, reminderFilter, nowMs)) return null;
		const resolvedTitle = readNoteFromDoc(doc, entry.noteId).title.trim();
		const reminderMs = reminderAt ? Date.parse(reminderAt) : Number.NaN;
		const searchText = extractNoteSearchText(entry.noteId, doc, resolvedTitle || entry.title);
		return {
			noteId: entry.noteId,
			title: resolvedTitle || entry.title,
			searchText,
			updatedAt: Number(metadata.get('updatedAt') ?? 0),
			reminderAt,
			isPinned: Boolean(metadata.get('isPinned')),
			hasReminder: Number.isFinite(reminderMs) && reminderMs > Date.now() - ONE_DAY_MS,
		};
	} catch {
		return {
			noteId: entry.noteId,
			title: entry.title,
			searchText: entry.title,
			updatedAt: 0,
			reminderAt: null,
			isPinned: false,
			hasReminder: false,
		};
	} finally {
		try { idb.destroy(); } catch { /* ignore */ }
		try { doc.destroy(); } catch { /* ignore */ }
	}
}

async function loadInactiveSharedPlacementNote(
	workspaceId: string,
	workspaceName: string,
	placement: SharedNotePlacement,
	showTrashed: boolean,
	reminderFilter: ReminderFilterMode,
	nowMs: number
): Promise<BubbleNote | null> {
	const doc = new Y.Doc();
	const idb = new IndexeddbPersistence(placement.roomId, doc);

	await Promise.race([
		new Promise<void>((resolve) => {
			if ((idb as any).synced) { resolve(); return; }
			idb.on('synced', () => resolve());
		}),
		new Promise<void>((resolve) => { window.setTimeout(resolve, IDB_LOAD_TIMEOUT_MS); }),
	]);

	try {
		const metadata = doc.getMap<any>('metadata');
		const isTrashed = Boolean(metadata.get('trashed'));
		if (showTrashed ? !isTrashed : isTrashed) return null;
		const reminderAtRaw = metadata.get('reminderAt');
		const reminderAt = typeof reminderAtRaw === 'string' ? reminderAtRaw : null;
		if (!matchesReminderFilter(reminderAt, reminderFilter, nowMs)) return null;
		const resolvedTitle = readNoteFromDoc(doc, placement.aliasId).title.trim();
		const reminderMs = reminderAt ? Date.parse(reminderAt) : Number.NaN;
		const title = resolvedTitle || placement.sourceNoteId;
		return {
			noteId: placement.aliasId,
			workspaceId,
			workspaceName,
			title,
			searchText: extractNoteSearchText(placement.aliasId, doc, title),
			updatedAt: Number(metadata.get('updatedAt') ?? 0),
			reminderAt,
			isPinned: Boolean(metadata.get('isPinned')),
			hasReminder: Number.isFinite(reminderMs) && reminderMs > Date.now() - ONE_DAY_MS,
			hasCollaborators: false,
			isActiveWorkspace: false,
		};
	} catch {
		return {
			noteId: placement.aliasId,
			workspaceId,
			workspaceName,
			title: placement.sourceNoteId,
			searchText: placement.sourceNoteId,
			updatedAt: 0,
			reminderAt: null,
			isPinned: false,
			hasReminder: false,
			hasCollaborators: false,
			isActiveWorkspace: false,
		};
	} finally {
		try { idb.destroy(); } catch { /* ignore */ }
		try { doc.destroy(); } catch { /* ignore */ }
	}
}

async function loadWorkspaceRegistry(workspaceId: string): Promise<RegistryEntry[]> {
	const roomName = `${workspaceId}:${NOTES_REGISTRY_ID}`;
	const doc = new Y.Doc();
	const idb = new IndexeddbPersistence(roomName, doc);

	await Promise.race([
		new Promise<void>((resolve) => {
			if ((idb as any).synced) { resolve(); return; }
			idb.on('synced', () => resolve());
		}),
		new Promise<void>((resolve) => { window.setTimeout(resolve, IDB_LOAD_TIMEOUT_MS); }),
	]);

	try {
		const notesList = doc.getArray<Y.Map<any>>(NOTES_LIST_KEY);
		const noteOrder = doc.getArray<string>(NOTE_ORDER_KEY);
		const titlesById = new Map<string, string>();
		for (const item of notesList.toArray()) {
			const id = String(item.get?.('id') ?? '').trim();
			const title = String(item.get?.('title') ?? '').trim();
			if (id) titlesById.set(id, title);
		}
		const ordered = noteOrder.toArray().filter(Boolean);
		const ids = ordered.length > 0 ? ordered : Array.from(titlesById.keys());
		const entries: RegistryEntry[] = ids
			.slice(0, MAX_NOTES_PER_INACTIVE_WORKSPACE)
			.map((id) => ({ noteId: id, title: titlesById.get(id) ?? '' }));
		return entries;
	} finally {
		try { idb.destroy(); } catch { /* ignore */ }
		try { doc.destroy(); } catch { /* ignore */ }
	}
}

// ── useBubbleNotes hook ────────────────────────────────────────────────────

function useBubbleNotes(
	workspaces: BubbleWorkspaceInfo[],
	activeWorkspaceId: string | null,
	sharedPlacements: readonly SharedNotePlacement[],
	showTrashed: boolean,
	reminderFilter: ReminderFilterMode
): BubbleNote[] {
	const manager = useDocumentManager();
	const [notes, setNotes] = React.useState<BubbleNote[]>([]);

	React.useEffect(() => {
		if (!activeWorkspaceId) return;
		let cancelled = false;
		let refreshTimer = 0;
		const cleanups: Array<() => void> = [];

		const disposeRefreshSubscriptions = (): void => {
			while (cleanups.length > 0) {
				const cleanup = cleanups.pop();
				try { cleanup?.(); } catch { /* ignore */ }
			}
		};

		const scheduleRefresh = (): void => {
			if (cancelled) return;
			if (refreshTimer) window.clearTimeout(refreshTimer);
			refreshTimer = window.setTimeout(() => {
				refreshTimer = 0;
				void refresh();
			}, 120);
		};

		const refresh = async (): Promise<void> => {
			if (cancelled) return;
			disposeRefreshSubscriptions();
			const nextNotes: BubbleNote[] = [];
			const nowMs = Date.now();

			// ── Active workspace ─────────────────────────────────────────────────────
			const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
			const activeWorkspaceName = activeWorkspace?.name ?? '';
			const activeWorkspaceIsShared = activeWorkspace?.systemKind === 'SHARED_WITH_ME';

			if (activeWorkspaceIsShared) {
				const activeEntries = await Promise.all(sharedPlacements.slice(0, MAX_NOTES_PER_INACTIVE_WORKSPACE).map(async (placement) => {
					try {
						const doc = await manager.getDocReady(placement.aliasId);
						const meta = doc.getMap<any>('metadata');
						const titleText = doc.getText('title');
						const contentText = doc.getText('content');
						const checklist = doc.getArray<Y.Map<any>>('checklist');
						const onMetadataChange = (event: Y.YMapEvent<any>): void => {
							if (window.DEBUG) {
								console.debug('[BubbleScore] meta change', placement.aliasId, {
									keys: [...event.keysChanged],
									updatedAt: meta.get('updatedAt'),
								});
							}
							if (event.keysChanged.size === 1 && event.keysChanged.has('lastAccessedAt')) return;
							scheduleRefresh();
						};
						const onTitleChange = (): void => scheduleRefresh();
						const onContentChange = (): void => scheduleRefresh();
						const onChecklistChange = (): void => scheduleRefresh();
						meta.observe(onMetadataChange);
						titleText.observe(onTitleChange);
						contentText.observe(onContentChange);
						checklist.observeDeep(onChecklistChange);
						cleanups.push(() => {
							try { meta.unobserve(onMetadataChange); } catch { /* ignore */ }
							try { titleText.unobserve(onTitleChange); } catch { /* ignore */ }
							try { contentText.unobserve(onContentChange); } catch { /* ignore */ }
							try { checklist.unobserveDeep(onChecklistChange); } catch { /* ignore */ }
						});
						const isTrashed = Boolean(meta.get('trashed'));
						if (showTrashed ? !isTrashed : isTrashed) return null;
						const reminderAtRaw = meta.get('reminderAt');
						const reminderAt = typeof reminderAtRaw === 'string' ? reminderAtRaw : null;
						if (!matchesReminderFilter(reminderAt, reminderFilter, nowMs)) return null;
						const resolvedTitle = readNoteFromDoc(doc, placement.aliasId).title.trim();
						const title = resolvedTitle || placement.sourceNoteId;
						const reminderMs = reminderAt ? Date.parse(String(reminderAt)) : Number.NaN;
						return {
							noteId: placement.aliasId,
							workspaceId: activeWorkspaceId,
							workspaceName: activeWorkspaceName,
							title,
							searchText: extractNoteSearchText(placement.aliasId, doc, title),
							updatedAt: Number(meta.get('updatedAt') ?? 0),
							reminderAt,
							isPinned: Boolean(meta.get('isPinned')),
							hasReminder: Number.isFinite(reminderMs) && reminderMs > Date.now() - ONE_DAY_MS,
							hasCollaborators: false,
							isActiveWorkspace: true,
						};
					} catch {
						return null;
					}
				}));
				nextNotes.push(...activeEntries.filter((entry): entry is BubbleNote => entry !== null));
			} else {
				try {
					const registryDoc = await manager.getNotesRegistryDoc();
					if (cancelled) return;
					const notesList = registryDoc.getArray<Y.Map<any>>(NOTES_LIST_KEY);
					const noteOrder = registryDoc.getArray<string>(NOTE_ORDER_KEY);

					const titlesById = new Map<string, string>();
					for (const item of notesList.toArray()) {
						const id = String(item.get?.('id') ?? '').trim();
						const title = String(item.get?.('title') ?? '').trim();
						if (id) titlesById.set(id, title);
					}
					const orderedIds: string[] = noteOrder.toArray().filter(Boolean);

					const activeEntries: Array<BubbleNote | null> = await Promise.all(orderedIds.map(async (noteId) => {
						const registryTitle = titlesById.get(noteId) ?? '';
						const doc = await manager.getDocReady(noteId);
						const meta = doc.getMap<any>('metadata');
						const titleText = doc.getText('title');
						const contentText = doc.getText('content');
						const checklist = doc.getArray<Y.Map<any>>('checklist');
						const onMetadataChange = (event: Y.YMapEvent<any>): void => {
							if (window.DEBUG) {
								console.debug('[BubbleScore] meta change', noteId, {
									keys: [...event.keysChanged],
									updatedAt: meta.get('updatedAt'),
								});
							}
							if (event.keysChanged.size === 1 && event.keysChanged.has('lastAccessedAt')) return;
							scheduleRefresh();
						};
						const onTitleChange = (): void => scheduleRefresh();
						const onContentChange = (): void => scheduleRefresh();
						const onChecklistChange = (): void => scheduleRefresh();
						meta.observe(onMetadataChange);
						titleText.observe(onTitleChange);
						contentText.observe(onContentChange);
						checklist.observeDeep(onChecklistChange);
						cleanups.push(() => {
							try { meta.unobserve(onMetadataChange); } catch { /* ignore */ }
							try { titleText.unobserve(onTitleChange); } catch { /* ignore */ }
							try { contentText.unobserve(onContentChange); } catch { /* ignore */ }
							try { checklist.unobserveDeep(onChecklistChange); } catch { /* ignore */ }
						});
						const isTrashed = Boolean(meta.get('trashed'));
						if (showTrashed ? !isTrashed : isTrashed) return null;
						const reminderAtRaw = meta.get('reminderAt');
						const reminderAt = typeof reminderAtRaw === 'string' ? reminderAtRaw : null;
						if (!matchesReminderFilter(reminderAt, reminderFilter, nowMs)) return null;
						const resolvedTitle = readNoteFromDoc(doc, noteId).title.trim();
						const isPinned = Boolean(meta.get('isPinned'));
						const updatedAt = Number(meta.get('updatedAt') ?? 0);
						const reminderMs = reminderAt ? Date.parse(String(reminderAt)) : Number.NaN;
						const hasReminder = Number.isFinite(reminderMs) && reminderMs > Date.now() - ONE_DAY_MS;
						const title = resolvedTitle || registryTitle;
						return {
							noteId,
							workspaceId: activeWorkspaceId,
							workspaceName: activeWorkspaceName,
							title,
							searchText: extractNoteSearchText(noteId, doc, title),
							updatedAt,
							reminderAt,
							isPinned,
							hasReminder,
							hasCollaborators: false,
							isActiveWorkspace: true,
						};
					}));
					nextNotes.push(...activeEntries.filter((entry): entry is BubbleNote => entry !== null));

					const onRegistryChange = (): void => { scheduleRefresh(); };
					registryDoc.getArray(NOTES_LIST_KEY).observe(onRegistryChange);
					registryDoc.getArray(NOTE_ORDER_KEY).observe(onRegistryChange);
					cleanups.push(() => {
						try {
							registryDoc.getArray(NOTES_LIST_KEY).unobserve(onRegistryChange);
							registryDoc.getArray(NOTE_ORDER_KEY).unobserve(onRegistryChange);
						} catch { /* ignore */ }
					});
				} catch { /* active workspace load failed – skip */ }
			}

			// ── Non-active workspaces ────────────────────────────────────────────────
			const otherWorkspaces = workspaces.filter((w) => w.id !== activeWorkspaceId);
			await Promise.all(
				otherWorkspaces.map(async (workspace) => {
					if (cancelled) return;
					if (workspace.systemKind === 'SHARED_WITH_ME') {
						try {
							const placementData = await listSharedNotePlacements(workspace.id);
							if (cancelled) return;
							const visiblePlacements = await Promise.all(
								placementData.placements
									.slice(0, MAX_NOTES_PER_INACTIVE_WORKSPACE)
									.map((placement) => loadInactiveSharedPlacementNote(workspace.id, workspace.name, placement, showTrashed, reminderFilter, nowMs))
							);
							for (const visiblePlacement of visiblePlacements) {
								if (!visiblePlacement) continue;
								nextNotes.push(visiblePlacement);
							}
						} catch { /* skip shared placements if unavailable */ }
						return;
					}
					try {
						const entries = await loadWorkspaceRegistry(workspace.id);
						if (cancelled) return;
						const visibleEntries = await Promise.all(entries.map((entry) => loadInactiveWorkspaceNote(workspace.id, entry, showTrashed, reminderFilter, nowMs)));
						for (const visibleEntry of visibleEntries) {
							if (!visibleEntry) continue;
							nextNotes.push({
								noteId: visibleEntry.noteId,
								workspaceId: workspace.id,
								workspaceName: workspace.name,
								title: visibleEntry.title,
								searchText: visibleEntry.searchText,
								updatedAt: visibleEntry.updatedAt,
								reminderAt: visibleEntry.reminderAt,
								isPinned: visibleEntry.isPinned,
								hasReminder: visibleEntry.hasReminder,
								hasCollaborators: false,
								isActiveWorkspace: false,
							});
						}
					} catch { /* skip workspace if IDB not available */ }
				})
			);

			if (!cancelled) {
				setNotes(nextNotes);
			}
		};

		void refresh();

		return () => {
			cancelled = true;
			if (refreshTimer) window.clearTimeout(refreshTimer);
			disposeRefreshSubscriptions();
		};
	}, [activeWorkspaceId, manager, reminderFilter, sharedPlacements, showTrashed, workspaces]);

	return notes;
}

function useBubbleCollaboratorCounts(
	authUserId: string | null | undefined,
	notes: readonly BubbleNote[],
	manager: ReturnType<typeof useDocumentManager>
): Record<string, number> {
	const [counts, setCounts] = React.useState<Record<string, number>>({});
	const activeEntries = React.useMemo(
		() => notes
			.filter((note) => note.isActiveWorkspace)
			.map((note) => ({ noteId: note.noteId, docId: manager.resolveRoomName(note.noteId) })),
		[manager, notes]
	);
	const signature = React.useMemo(
		() => activeEntries.map((entry) => `${entry.noteId}:${entry.docId}`).join('|'),
		[activeEntries]
	);

	React.useEffect(() => {
		if (!authUserId || activeEntries.length === 0) {
			setCounts({});
			return;
		}
		let cancelled = false;

		const applyRows = (rows: readonly { noteId: string; count: number }[]): void => {
			if (cancelled) return;
			setCounts((previous) => {
				const next: Record<string, number> = {};
				for (const row of rows) {
					next[row.noteId] = row.count;
				}
				const previousKeys = Object.keys(previous);
				const nextKeys = Object.keys(next);
				if (previousKeys.length === nextKeys.length && nextKeys.every((key) => previous[key] === next[key])) {
					return previous;
				}
				return next;
			});
		};

		void (async () => {
			const cached = await Promise.all(activeEntries.map(async (entry) => ({
				noteId: entry.noteId,
				count: (await readCachedNoteShareCollaborators(authUserId, entry.docId))?.collaborators?.length ?? 0,
			})));
			applyRows(cached);

			if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
			const refreshed: Array<{ noteId: string; count: number }> = [];
			for (let start = 0; start < activeEntries.length; start += 6) {
				const batch = activeEntries.slice(start, start + 6);
				const batchRows = await Promise.all(batch.map(async (entry) => ({
					noteId: entry.noteId,
					count: (await syncNoteShareCollaborators(authUserId, entry.docId, { suppressError: true }))?.collaborators?.length ?? 0,
				})));
				if (cancelled) return;
				refreshed.push(...batchRows);
			}
			applyRows(refreshed);
		})();

		return () => {
			cancelled = true;
		};
	}, [activeEntries, authUserId, signature]);

	return counts;
}

// ── Bubble rendering ───────────────────────────────────────────────────────

type BubbleProps = {
	note: BubbleNote;
	doc: Y.Doc | null;
	sizeClass: BubbleSizeClass;
	detailLevel: BubbleDetailLevel;
	bubbleDiameter: number;
	workspaceColorStyle: React.CSSProperties;
	rotateDeg: number;
	/** Float animation duration in seconds (6–10, seeded per note). */
	floatDuration: number;
	/** Float animation delay in seconds (0–6, seeded per note). */
	floatDelay: number;
	onSelect: () => void | Promise<void>;
};

function getBubblePreview(noteId: string, doc: Y.Doc | null, sizeClass: BubbleSizeClass): string {
	const sizeRank = getBubbleSizeRank(sizeClass);
	if (!doc || sizeRank <= 3) return '';
	try {
		const note = readNoteFromDoc(doc, noteId);
		if (note.type === 'checklist') {
			const total = note.items?.length ?? 0;
			if (total === 0) return '';
			const completed = (note.items ?? []).filter((entry) => entry.completed).length;
			return `${completed} / ${total} completed`;
		}
		const raw = (note.content ?? '').replace(/\s+/g, ' ').trim();
		if (!raw) return '';
		const maxChars = sizeRank >= 7 ? 180 : sizeRank >= 5 ? 120 : 90;
		return raw.length > maxChars ? `${raw.slice(0, maxChars - 1)}...` : raw;
	} catch {
		return '';
	}
}

function sumWordLengths(words: readonly string[], start: number, end: number): number {
	let total = 0;
	for (let index = start; index < end; index += 1) {
		total += words[index]?.length ?? 0;
	}
	return total + Math.max(0, end - start - 1);
}

function minMaxLineLength(words: readonly string[], lines: 2 | 3): number {
	if (words.length <= 1) return words[0]?.length ?? 0;
	const targetLines = Math.min(lines, words.length) as 2 | 3;
	let best = Number.POSITIVE_INFINITY;
	const visit = (start: number, linesLeft: number, currentMax: number): void => {
		if (linesLeft === 1) {
			best = Math.min(best, Math.max(currentMax, sumWordLengths(words, start, words.length)));
			return;
		}
		for (let end = start + 1; end <= words.length - linesLeft + 1; end += 1) {
			const lineLength = sumWordLengths(words, start, end);
			if (lineLength >= best) continue;
			visit(end, linesLeft - 1, Math.max(currentMax, lineLength));
		}
	};
	visit(0, targetLines, 0);
	return best;
}

function approximateTextWidth(charCount: number, fontPx: number): number {
	return charCount * fontPx * 0.54;
}

function getBubbleSafeBox(diameter: number): number {
	return Math.max(22, diameter * 0.7);
}

function getBubbleTitleFontSize(diameter: number): number {
	if (diameter < 80) return 11;
	if (diameter < 140) return 13;
	if (diameter < 200) return 15;
	return 17;
}

function getBubbleTitleClamp(diameter: number): 1 | 2 | 3 {
	if (diameter < 80) return 1;
	if (diameter < 140) return 2;
	return 3;
}

function resolveBubbleTitleLayout(title: string, bubbleDiameter: number): { fontPx: number; clamp: 1 | 2 | 3; safeBox: number; grownDiameter: number } {
	const trimmed = title.trim() || '(untitled)';
	const words = trimmed.split(/\s+/).filter(Boolean);
	const safeBox = getBubbleSafeBox(bubbleDiameter);
	const baseFontPx = getBubbleTitleFontSize(bubbleDiameter);
	const clamp = getBubbleTitleClamp(bubbleDiameter);
	const maxLineWidth = clamp === 1 ? trimmed.length : minMaxLineLength(words, clamp);
	const requiredSafeBox = approximateTextWidth(maxLineWidth, baseFontPx);
	const growRatio = Math.min(1.24, Math.max(1, requiredSafeBox / Math.max(safeBox, 1)));
	const grownDiameter = bubbleDiameter * growRatio;
	const grownSafeBox = getBubbleSafeBox(grownDiameter);
	const fittedFontPx = Math.min(baseFontPx, Math.max(9, grownSafeBox / Math.max(maxLineWidth * 0.54, 1)));
	return {
		fontPx: fittedFontPx,
		clamp,
		safeBox: grownSafeBox,
		grownDiameter,
	};
}

function getBubbleDetailLevel(zoom: number, sizeClass: BubbleSizeClass): BubbleDetailLevel {
	const sizeRank = getBubbleSizeRank(sizeClass);
	if (zoom <= 24) return 'title';
	if (zoom <= 42) return sizeRank >= 6 ? 'meta' : 'title';
	if (zoom <= 60) return sizeRank >= 4 ? 'full' : 'meta';
	return sizeRank <= 2 ? 'meta' : 'full';
}

const Bubble = React.memo(function Bubble({ note, doc, sizeClass, detailLevel, bubbleDiameter, workspaceColorStyle, rotateDeg, floatDuration, floatDelay, onSelect }: BubbleProps) {
	const displayTitle = resolveBubbleTitle(note.noteId, note.title);
	const preview = getBubblePreview(note.noteId, doc, sizeClass);
	const titleLayout = resolveBubbleTitleLayout(displayTitle || '(untitled)', bubbleDiameter);
	const showBadges = detailLevel !== 'title' && (note.isPinned || note.hasReminder || note.hasCollaborators);
	const showPreview = detailLevel === 'full' && Boolean(preview);

	// Track touch start position so we can distinguish taps from scrolls and call
	// e.preventDefault() on touchend to block the 300 ms ghost click iOS emits.
	const touchStartRef = React.useRef<{ x: number; y: number } | null>(null);
	const handleTouchStart = React.useCallback((e: React.TouchEvent<HTMLButtonElement>) => {
		const t = e.touches[0];
		touchStartRef.current = { x: t.clientX, y: t.clientY };
	}, []);
	const handleTouchEnd = React.useCallback((e: React.TouchEvent<HTMLButtonElement>) => {
		const start = touchStartRef.current;
		touchStartRef.current = null;
		if (!start) return;
		const t = e.changedTouches[0];
		const dx = Math.abs(t.clientX - start.x);
		const dy = Math.abs(t.clientY - start.y);
		if (dx > 10 || dy > 10) return; // was a scroll gesture, not a tap
		e.preventDefault(); // block delayed ghost click so editor doesn't immediately close
		void onSelect();
	}, [onSelect]);

	const baseStyle: React.CSSProperties = {
		'--bv-bubble-rotate': `${rotateDeg}deg`,
		'--bv-bubble-diameter': `${titleLayout.grownDiameter}px`,
		'--bv-float-duration': `${floatDuration}s`,
		'--bv-float-delay': `${floatDelay}s`,
		...workspaceColorStyle,
	} as React.CSSProperties;
	const contentStyle: React.CSSProperties = {
		paddingTop: showBadges ? '22%' : '10%',
		paddingBottom: showPreview ? '28%' : '12%',
		paddingInline: '9%',
	};
	const textBoxStyle: React.CSSProperties = {
		maxWidth: `${titleLayout.safeBox}px`,
		maxHeight: `${showPreview ? Math.max(18, titleLayout.safeBox * 0.72) : titleLayout.safeBox}px`,
	};
	const titleStyle: React.CSSProperties = {
		fontSize: `${titleLayout.fontPx}px`,
		WebkitLineClamp: titleLayout.clamp,
		lineClamp: titleLayout.clamp,
	};

	return (
		<motion.div
			layoutId={`bubble-${note.workspaceId}-${note.noteId}`}
			className={styles.bubbleShell}
			initial={{ opacity: 0, scale: 0.4 }}
			animate={{ opacity: 1, scale: 1 }}
			exit={{ opacity: 0, scale: 0.3 }}
			transition={{ type: 'spring', stiffness: 260, damping: 22 }}
		>
			<button
				type="button"
				className={[
					styles.bubble,
					styles[`bubble_${sizeClass}`],
					styles[`bubbleDetail_${detailLevel}`],
					note.isActiveWorkspace ? styles.bubbleActive : styles.bubbleInactive,
				].join(' ')}
				style={baseStyle}
				onTouchStart={handleTouchStart}
				onTouchEnd={handleTouchEnd}
				onClick={(e) => { e.stopPropagation(); void onSelect(); }}
				title={displayTitle || '(untitled)'}
			>
				{showBadges ? (
					<span className={styles.bubbleBadges}>
						{note.isPinned ? <FontAwesomeIcon icon={faThumbtack} className={styles.bubbleBadgeIcon} /> : null}
						{note.hasReminder ? <FontAwesomeIcon icon={faBell} className={styles.bubbleBadgeIcon} /> : null}
						{note.hasCollaborators ? <FontAwesomeIcon icon={faUsers} className={styles.bubbleBadgeIcon} /> : null}
					</span>
				) : null}
				<span className={styles.bubbleContent} style={contentStyle}>
					<span className={styles.bubbleTextBox} style={textBoxStyle}>
						<span className={styles.bubbleTitle} style={titleStyle}>
						{displayTitle || <em>(untitled)</em>}
					</span>
					</span>
				</span>
				{showPreview ? (
					<span className={`${styles.bubblePreview} ${getBubbleSizeRank(sizeClass) >= 7 ? styles.bubblePreviewLarge : styles.bubblePreviewMedium}`}>
						{preview}
					</span>
				) : null}
			</button>
		</motion.div>
	);
});

// ── BubbleView props & component ───────────────────────────────────────────

// Maximum bubbles to lay out at once — keeps packing + render fast even
// when a user has many workspaces.  Notes beyond this cap are omitted from
// the visual layout (the IDB per-workspace limit of 80 notes means in
// practice the total rarely exceeds 500 anyway).
const MAX_LAYOUT_BUBBLES = 500;

export type BubbleViewProps = {
	workspaces: BubbleWorkspaceInfo[];
	activeWorkspaceId: string | null;
	authUserId?: string | null;
	sharedPlacements?: readonly SharedNotePlacement[];
	themeId: ThemeId;
	zoom: number;
	showTrashed: boolean;
	reminderFilter: ReminderFilterMode;
	searchQuery: string;
	sidebarIsCollapsed: boolean;
	/** Note ID to keep hidden from the bubble display while being drafted. */
	hiddenNoteId?: string | null;
	onSelectNote: (noteId: string, workspaceId: string) => void | Promise<void>;
};

export function BubbleView({
	workspaces,
	activeWorkspaceId,
	authUserId,
	sharedPlacements = [],
	themeId,
	zoom,
	showTrashed,
	reminderFilter,
	searchQuery,
	sidebarIsCollapsed,
	hiddenNoteId,
	onSelectNote,
}: BubbleViewProps): React.JSX.Element {
	const manager = useDocumentManager();
	const notes = useBubbleNotes(workspaces, activeWorkspaceId, sharedPlacements, showTrashed, reminderFilter);
	// Exclude the draft note from collaborator syncing — it hasn't been persisted
	// to the server yet so the API would return 403 for it.
	const notesForCollaborators = React.useMemo(
		() => (hiddenNoteId ? notes.filter((n) => n.noteId !== hiddenNoteId) : notes),
		[hiddenNoteId, notes]
	);
	const collaboratorCountByNoteId = useBubbleCollaboratorCounts(authUserId, notesForCollaborators, manager);
	// Track viewport width for scale-factor computations; the cloud container
	// width is measured separately via the callback ref / ResizeObserver below.
	const [viewportWidth, setViewportWidth] = React.useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
	// Holds the active ResizeObserver so the callback ref can disconnect it when
	// the cloud div unmounts (e.g. when filteredNotes goes to 0 and back).
	const roRef = React.useRef<ResizeObserver | null>(null);
	// Better initial estimate: on mobile (≤ 768 px) there is no sidebar, so use
	// the full innerWidth; on desktop subtract sidebar (320 px) + main padding.
	const [containerWidth, setContainerWidth] = React.useState<number>(() => {
		if (typeof window === 'undefined') return 800;
		const w = window.innerWidth;
		return Math.max(300, w <= 768 ? w - 16 : w - 336);
	});
	// Callback ref: fires every time the cloud div mounts/unmounts so the
	// ResizeObserver is always attached to the live element, even when the
	// component transitions through the empty-notes early-return path.
	const cloudRef = React.useCallback((el: HTMLDivElement | null) => {
		if (roRef.current) {
			roRef.current.disconnect();
			roRef.current = null;
		}
		if (!el) return;
		const measure = (): void => {
			const w = el.getBoundingClientRect().width;
			if (w > 0) setContainerWidth(Math.floor(w));
		};
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		measure();
		roRef.current = observer;
	}, []);
	// const [debugEnabled, setDebugEnabled] = React.useState(() => isBubbleDebugEnabled());
	// const [lastMeasureSource, setLastMeasureSource] = React.useState('initial');
	// const [debugEvents, setDebugEvents] = React.useState<BubbleDebugEvent[]>([]);
	// const [debugCopyState, setDebugCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
	const smoothedScoreRef = React.useRef<Record<string, number>>({});
	// const lastDebugKeyRef = React.useRef('');
	// Advance smooth scores on a regular 1.5 s tick so scores converge on devices
	// that receive infrequent Y.js sync pulses. Without this, a remote client that
	// gets a single sync event would only apply one EMA step, leaving scores
	// visually lagging well behind the local originator.
	const [scoreTick, setScoreTick] = React.useState(0);
	React.useEffect(() => {
		const id = window.setInterval(() => setScoreTick((t) => t + 1), 1500);
		return () => window.clearInterval(id);
	}, []);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const onResize = (): void => setViewportWidth(window.innerWidth);
		onResize();
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);

	const clampedZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
	const workspaceColorSchemeById = React.useMemo(() => {
		const entries = new Map<string, ReturnType<typeof getWorkspaceBubbleColorScheme>>();
		for (const workspace of workspaces) {
			entries.set(workspace.id, getWorkspaceBubbleColorScheme(themeId, workspace.id));
		}
		return entries;
	}, [themeId, workspaces]);
	const scoredNotes = React.useMemo(() => {
		void scoreTick; // re-run each tick so smooth scores converge between Y.js events
		const nowMs = Date.now();
		return notes.map((note) => {
			const activityKey = `${note.workspaceId}:${note.noteId}`;
			const collaboratorCount = collaboratorCountByNoteId[note.noteId] ?? 0;
			const rawScore = computeBalancedActivityScore({
				updatedAt: note.updatedAt,
				reminderAt: note.reminderAt,
				isPinned: note.isPinned,
				collaboratorCount,
			}, nowMs);
			const previousScore = smoothedScoreRef.current[activityKey];
			const score = smoothScore(previousScore, rawScore);
			smoothedScoreRef.current[activityKey] = score;
			return {
				...note,
				score,
				hasCollaborators: collaboratorCount > 0,
			};
		});
	}, [collaboratorCountByNoteId, notes, scoreTick]);
	const filteredNotes = React.useMemo(() => {
		return scoredNotes.filter((note) => {
			if (hiddenNoteId && note.noteId === hiddenNoteId) return false;
			const doc = activeWorkspaceId === note.workspaceId
				? (manager.peekDoc(note.noteId) ?? null)
				: null;
			return matchesBubbleSearch(note, doc, searchQuery);
		});
	}, [activeWorkspaceId, hiddenNoteId, manager, scoredNotes, searchQuery]);
	const scale = 0.62 + clampedZoom / 120;

	// Build the visual layout list.  Notes are sorted score-descending (title
	// as a stable tiebreaker) so the most important bubbles get first pick of
	// the central position candidates in candidateCenterXs.

	// ── Circle-packing layout ──────────────────────────────────────────────────────
	// Computes absolute (left, top) positions for every bubble so they are
	// densely packed without row artefacts.  Large bubbles are sorted first so
	// they claim the upper area; small ones fill the gaps.
	// ── Circle-packing layout ──────────────────────────────────────────────────────
	// Computes absolute (left, top) positions for every bubble so they are
	// densely packed without row artefacts.  Large bubbles are sorted first so
	// they claim the upper area; small ones fill the gaps.
	const PACK_GAP = Math.max(4, 8 * scale);
	const packedLayout = React.useMemo((): { items: PackedBubbleLayoutItem[]; totalHeight: number } => {
		// Cap at MAX_LAYOUT_BUBBLES to bound packing time for very large workspaces.
		const visible = filteredNotes.slice(0, MAX_LAYOUT_BUBBLES);
		const sorted = [...visible].sort((a, b) =>
			b.score !== a.score ? b.score - a.score : a.title.localeCompare(b.title)
		);

		// Build visual metadata for every note (size, color, animation seeds).
		const visualItems = sorted.map((note) => {
			const sizeClass = scoreToSizeClass(note.score);
			const detailLevel = getBubbleDetailLevel(clampedZoom, sizeClass);
			const nominalDiameter = BUBBLE_BASE_DIAMETER[sizeClass] * scale;
			// Account for title-driven bubble growth so packing uses the real
			// visual size and avoids text clipping across adjacent bubbles.
			const displayTitle = resolveBubbleTitle(note.noteId, note.title);
			const { grownDiameter } = resolveBubbleTitleLayout(displayTitle || '(untitled)', nominalDiameter);
			const rotateDeg = (seededRandom(`${note.noteId}:r`) - 0.5) * 8;
			const floatDuration = 6 + seededRandom(`${note.noteId}:float`) * 4;
			const floatDelay = seededRandom(`${note.noteId}:delay`) * 6;
			const doc = activeWorkspaceId === note.workspaceId ? (manager.peekDoc(note.noteId) ?? null) : null;
			const workspaceColorStyle = toWorkspaceBubbleColorStyle(
				workspaceColorSchemeById.get(note.workspaceId) ?? getWorkspaceBubbleColorScheme(themeId, note.workspaceId)
			);
			return { note, sizeClass, detailLevel, bubbleDiameter: grownDiameter, rotateDeg, floatDuration, floatDelay, workspaceColorStyle, doc };
		});

		// Run the packing algorithm with the measured container width.
		// Use a 16 px padding inset so bubbles don't press against the edge.
		const usableWidth = Math.max(80, containerWidth - 32);
		const packInputs = visualItems.map((item) => ({
			noteId: item.note.noteId,
			r: item.bubbleDiameter / 2,
		}));
		const positions = packBubbles(packInputs, usableWidth, PACK_GAP);

		let totalHeight = 0;
		const items: PackedBubbleLayoutItem[] = visualItems.map((item) => {
			const pos = positions.get(item.note.noteId) ?? { cx: containerWidth / 2, cy: item.bubbleDiameter / 2 };
			const d = item.bubbleDiameter;
			// Offset packing coordinates (centred) to top-left corner, then add
			// the 16 px inset we removed from usableWidth above.
			const left = Math.round(pos.cx - d / 2 + 16);
			const top = Math.round(pos.cy - d / 2);
			totalHeight = Math.max(totalHeight, top + d);
			return {
				...item,
				layoutDiameter: d,
				left,
				top,
			};
		});

		return { items, totalHeight };
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeWorkspaceId, clampedZoom, containerWidth, filteredNotes, manager, scale, themeId, workspaceColorSchemeById]);

	// const debugSummary = React.useMemo(() => {
	// 	const rightmostEdge = packedLayout.items.reduce((max, item) => Math.max(max, item.left + item.layoutDiameter), 0);
	// 	const leftmostEdge = packedLayout.items.reduce((min, item) => Math.min(min, item.left), packedLayout.items.length > 0 ? packedLayout.items[0].left : 0);
	// 	const overflowCount = packedLayout.items.filter((item) => item.left < -0.5 || item.left + item.layoutDiameter > packedLayout.width + 0.5).length;
	// 	return {
	// 		containerClientWidth: containerRef.current?.clientWidth ?? 0,
	// 		cloudClientWidth: cloudRef.current?.clientWidth ?? 0,
	// 		leftmostEdge,
	// 		overflowCount,
	// 		rightmostEdge,
	// 		rightOverflow: Math.max(0, rightmostEdge - packedLayout.width),
	// 	};
	// }, [packedLayout]);

	// React.useEffect(() => {
	// 	if (!debugEnabled) return;
	// 	const eventKey = [
	// 		lastMeasureSource,
	// 		viewportWidth,
	// 		containerWidth,
	// 		packedLayout.width,
	// 		packedLayout.height,
	// 		filteredNotes.length,
	// 		debugSummary.containerClientWidth,
	// 		debugSummary.cloudClientWidth,
	// 		debugSummary.overflowCount,
	// 		debugSummary.rightOverflow,
	// 		sidebarIsCollapsed ? '1' : '0',
	// 	].join('|');
	// 	if (lastDebugKeyRef.current === eventKey) return;
	// 	lastDebugKeyRef.current = eventKey;
	// 	const event: BubbleDebugEvent = {
	// 		id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	// 		label: lastMeasureSource,
	// 		timestamp: new Date().toLocaleTimeString(),
	// 		viewportWidth,
	// 		containerClientWidth: debugSummary.containerClientWidth,
	// 		containerWidth,
	// 		cloudClientWidth: debugSummary.cloudClientWidth,
	// 		packedWidth: packedLayout.width,
	// 		packedHeight: packedLayout.height,
	// 		filteredCount: filteredNotes.length,
	// 		overflowCount: debugSummary.overflowCount,
	// 		rightOverflow: debugSummary.rightOverflow,
	// 		sidebarIsCollapsed,
	// 		mobile,
	// 	};
	// 	setDebugEvents((current) => [event, ...current].slice(0, MAX_DEBUG_EVENTS));
	// 	console.log('[BubbleDebug]', event);
	// }, [containerWidth, debugEnabled, debugSummary, filteredNotes.length, lastMeasureSource, mobile, packedLayout.height, packedLayout.width, sidebarIsCollapsed, viewportWidth]);

	// const handleToggleDebug = React.useCallback(() => {
	// 	setDebugEnabled((current) => {
	// 		const next = !current;
	// 		persistBubbleDebugEnabled(next);
	// 		if (!next) setDebugCopyState('idle');
	// 		return next;
	// 	});
	// }, []);

	// const handleCopyDebug = React.useCallback(async () => {
	// 	const payload = {
	// 		current: {
	// 			viewportWidth,
	// 			mobile,
	// 			sidebarIsCollapsed,
	// 			lastMeasureSource,
	// 			containerClientWidth: debugSummary.containerClientWidth,
	// 			containerWidth,
	// 			cloudClientWidth: debugSummary.cloudClientWidth,
	// 			innerWidth,
	// 			packedWidth: packedLayout.width,
	// 			packedHeight: packedLayout.height,
	// 			bubbleCount: packedLayout.items.length,
	// 			leftmostEdge: debugSummary.leftmostEdge,
	// 			rightmostEdge: debugSummary.rightmostEdge,
	// 			overflowCount: debugSummary.overflowCount,
	// 			rightOverflow: debugSummary.rightOverflow,
	// 		},
	// 		recentEvents: debugEvents,
	// 		items: packedLayout.items.map((item) => ({
	// 			title: resolveBubbleTitle(item.note.noteId, item.note.title),
	// 			left: Math.round(item.left),
	// 			right: Math.round(item.left + item.layoutDiameter),
	// 			diameter: Math.round(item.layoutDiameter),
	// 			workspaceId: item.note.workspaceId,
	// 		})),
	// 	};
	// 	try {
	// 		await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
	// 		setDebugCopyState('copied');
	// 	} catch {
	// 		setDebugCopyState('failed');
	// 	}
	// }, [containerWidth, debugEvents, debugSummary, innerWidth, lastMeasureSource, mobile, packedLayout, sidebarIsCollapsed, viewportWidth]);

	if (filteredNotes.length === 0) {
		return (
			<div className={styles.empty}>
				{searchQuery.trim() ? 'No bubbles match the current search.' : 'No notes found across workspaces.'}
			</div>
		);
	}

	return (
		<LayoutGroup>
			<div
				ref={cloudRef}
				className={styles.cloud}
				style={{
					'--bv-scale': String(scale),
					height: `${packedLayout.totalHeight + 48}px`,
				} as React.CSSProperties}
			>
				{packedLayout.items.map((item) => (
					<div
						key={`${item.note.workspaceId}:${item.note.noteId}`}
						className={styles.cloudItem}
						style={{
							left: item.left,
							top: item.top,
							width: item.layoutDiameter,
							height: item.layoutDiameter,
						}}
					>
						<Bubble
							note={item.note}
							doc={item.doc}
							sizeClass={item.sizeClass}
							detailLevel={item.detailLevel}
							bubbleDiameter={item.bubbleDiameter}
							workspaceColorStyle={item.workspaceColorStyle}
							rotateDeg={item.rotateDeg}
							floatDuration={item.floatDuration}
							floatDelay={item.floatDelay}
							onSelect={() => onSelectNote(item.note.noteId, item.note.workspaceId)}
						/>
					</div>
				))}
			</div>
		</LayoutGroup>
	);
}
