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
import { motion } from 'framer-motion';
import { useDocumentManager } from '../../core/DocumentManagerContext';
import type { ThemeId } from '../../core/theme';
import { readNoteFromDoc } from '../../core/noteModel';
import { BUBBLE_ZOOM_MAX, BUBBLE_ZOOM_MIN } from '../../core/bubbleZoom';
import { getWorkspaceBubbleColorScheme, toWorkspaceBubbleColorStyle } from '../../core/bubbleWorkspaceColors';
import { readCachedNoteShareCollaborators, syncNoteShareCollaborators } from '../../core/noteShareApi';
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
	layoutDiameter: number;
	left: number;
	top: number;
	rotateDeg: number;
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

function circlesOverlap(
	left: number,
	top: number,
	diameter: number,
	other: { left: number; top: number; layoutDiameter: number },
	gap: number
): boolean {
	const radius = diameter / 2;
	const otherRadius = other.layoutDiameter / 2;
	const centerX = left + radius;
	const centerY = top + radius;
	const otherCenterX = other.left + otherRadius;
	const otherCenterY = other.top + otherRadius;
	const distance = Math.hypot(centerX - otherCenterX, centerY - otherCenterY);
	return distance < radius + otherRadius + gap;
}

function candidateCenterXs(
	innerWidth: number,
	anchorX: number,
	step: number,
	rowIndex: number,
	drift: number,
	preferLeft: boolean
): number[] {
	const base = preferLeft
		? anchorX + (rowIndex % 2 === 0 ? step * 0.3 : step * 0.95) + drift * 0.3
		: anchorX + (rowIndex % 2 === 0 ? step * 0.35 : -step * 0.35) + drift;
	const candidates = [base];
	const maxOffset = Math.ceil(innerWidth / step);
	for (let offset = 1; offset <= maxOffset; offset += 1) {
		if (preferLeft) {
			candidates.push(base + offset * step, base - offset * step * 0.5);
		} else {
			candidates.push(base - offset * step, base + offset * step);
		}
	}
	return candidates;
}

// ── Seeded deterministic hash (no crypto) ─────────────────────────────────

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

function smoothScore(previous: number | null | undefined, next: number): number {
	if (!Number.isFinite(previous ?? Number.NaN)) return next;
	return (previous as number) * 0.8 + next * 0.2;
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
					const onMetadataChange = (): void => scheduleRefresh();
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

				// Subscribe to registry changes to keep the active workspace fresh
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

			// ── Non-active workspaces ────────────────────────────────────────────────
			const otherWorkspaces = workspaces.filter((w) => w.id !== activeWorkspaceId);
			await Promise.all(
				otherWorkspaces.map(async (workspace) => {
					if (cancelled) return;
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
	}, [activeWorkspaceId, manager, reminderFilter, showTrashed, workspaces]);

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
	swirlX: number;
	swirlY: number;
	rotateDeg: number;
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

const Bubble = React.memo(function Bubble({ note, doc, sizeClass, detailLevel, bubbleDiameter, workspaceColorStyle, swirlX, swirlY, rotateDeg, onSelect }: BubbleProps) {
	const displayTitle = resolveBubbleTitle(note.noteId, note.title);
	const preview = getBubblePreview(note.noteId, doc, sizeClass);
	const titleLayout = resolveBubbleTitleLayout(displayTitle || '(untitled)', bubbleDiameter);
	const showBadges = detailLevel !== 'title' && (note.isPinned || note.hasReminder || note.hasCollaborators);
	const showPreview = detailLevel === 'full' && Boolean(preview);

	const baseStyle: React.CSSProperties = {
		'--bv-bubble-rotate': `${rotateDeg}deg`,
		'--bv-bubble-diameter': `${titleLayout.grownDiameter}px`,
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
			layout
			className={styles.bubbleShell}
			style={{
				marginTop: `${Math.max(0, swirlY)}px`,
				marginBottom: `${Math.max(0, -swirlY)}px`,
				paddingInline: `${Math.max(0, swirlX)}px ${Math.max(0, -swirlX)}px`,
			}}
			transition={{ type: 'spring', stiffness: 180, damping: 26, mass: 0.8 }}
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
				onClick={onSelect}
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

export type BubbleViewProps = {
	workspaces: BubbleWorkspaceInfo[];
	activeWorkspaceId: string | null;
	authUserId?: string | null;
	themeId: ThemeId;
	zoom: number;
	showTrashed: boolean;
	reminderFilter: ReminderFilterMode;
	searchQuery: string;
	sidebarIsCollapsed: boolean;
	onSelectNote: (noteId: string, workspaceId: string) => void | Promise<void>;
};

export function BubbleView({
	workspaces,
	activeWorkspaceId,
	authUserId,
	themeId,
	zoom,
	showTrashed,
	reminderFilter,
	searchQuery,
	sidebarIsCollapsed,
	onSelectNote,
}: BubbleViewProps): React.JSX.Element {
	const manager = useDocumentManager();
	const containerRef = React.useRef<HTMLDivElement | null>(null);
	// const cloudRef = React.useRef<HTMLDivElement | null>(null);
	const notes = useBubbleNotes(workspaces, activeWorkspaceId, showTrashed, reminderFilter);
	const collaboratorCountByNoteId = useBubbleCollaboratorCounts(authUserId, notes, manager);
	const [viewportWidth, setViewportWidth] = React.useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
	const [containerWidth, setContainerWidth] = React.useState(0);
	// const [debugEnabled, setDebugEnabled] = React.useState(() => isBubbleDebugEnabled());
	// const [lastMeasureSource, setLastMeasureSource] = React.useState('initial');
	// const [debugEvents, setDebugEvents] = React.useState<BubbleDebugEvent[]>([]);
	// const [debugCopyState, setDebugCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
	const smoothedScoreRef = React.useRef<Record<string, number>>({});
	// const lastDebugKeyRef = React.useRef('');
	const measureContainerWidth = React.useCallback((source: string): void => {
		const node = containerRef.current;
		if (!node) return;
		const nextWidth = Math.max(0, node.clientWidth - 16);
		void source;
		// setLastMeasureSource(source);
		setContainerWidth((current) => (current === nextWidth ? current : nextWidth));
	}, []);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const onResize = (): void => {
			setViewportWidth(window.innerWidth);
			measureContainerWidth('window-resize');
		};
		onResize();
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, [measureContainerWidth]);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const node = containerRef.current;
		if (!node) return;
		const update = (source: string): void => measureContainerWidth(source);
		update('mount');
		if (typeof ResizeObserver === 'undefined') {
			const onResize = (): void => update('window-resize-fallback');
			window.addEventListener('resize', onResize);
			return () => window.removeEventListener('resize', onResize);
		}
		const observer = new ResizeObserver(() => update('resize-observer'));
		observer.observe(node);
		return () => observer.disconnect();
	}, [measureContainerWidth]);

	// Re-measure synchronously after any resize-driven render or sidebar toggle so
	// packedLayout always sees the current DOM width rather than stale state.
	React.useLayoutEffect(() => {
		measureContainerWidth(sidebarIsCollapsed ? 'layout-effect-collapsed' : 'layout-effect-expanded');
	}, [measureContainerWidth, sidebarIsCollapsed, viewportWidth]);

	const clampedZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
	const workspaceColorSchemeById = React.useMemo(() => {
		const entries = new Map<string, ReturnType<typeof getWorkspaceBubbleColorScheme>>();
		for (const workspace of workspaces) {
			entries.set(workspace.id, getWorkspaceBubbleColorScheme(themeId, workspace.id));
		}
		return entries;
	}, [themeId, workspaces]);
	const scoredNotes = React.useMemo(() => {
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
	}, [collaboratorCountByNoteId, notes]);
	const filteredNotes = React.useMemo(() => {
		return scoredNotes.filter((note) => {
			const doc = activeWorkspaceId === note.workspaceId
				? (manager.peekDoc(note.noteId) ?? null)
				: null;
			return matchesBubbleSearch(note, doc, searchQuery);
		});
	}, [activeWorkspaceId, manager, scoredNotes, searchQuery]);
	const scale = 0.62 + clampedZoom / 120;
	const mobile = viewportWidth <= 768;
	const measuredWidth = containerWidth > 0 ? containerWidth : null;
	const fallbackWidth = mobile
		? Math.max(260, viewportWidth - 32)
		: Math.max(200, viewportWidth - (sidebarIsCollapsed ? 88 : 356));
	const innerWidth = Math.max(1, measuredWidth ?? fallbackWidth);
	const packedLayout = React.useMemo(() => {
		const sorted = [...filteredNotes].sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.title.localeCompare(b.title);
		});
		const horizontalStep = mobile ? 24 : 30;
		const verticalStep = mobile ? 18 : 22;
		const minGap = mobile ? 8 : 10;
		const topInset = 10;
		const anchorX = mobile ? innerWidth / 2 : 18;
		const preferLeft = !mobile;
		const placed: PackedBubbleLayoutItem[] = [];

		for (const note of sorted) {
			const sizeClass = scoreToSizeClass(note.score);
			const detailLevel = getBubbleDetailLevel(clampedZoom, sizeClass);
			const bubbleDiameter = BUBBLE_BASE_DIAMETER[sizeClass] * scale;
			const displayTitle = resolveBubbleTitle(note.noteId, note.title);
			const titleLayout = resolveBubbleTitleLayout(displayTitle || '(untitled)', bubbleDiameter);
			const layoutDiameter = titleLayout.grownDiameter + (detailLevel === 'full' ? 10 : 6);
			const radius = layoutDiameter / 2;
			const driftX = (seededRandom(`${note.noteId}:pack:x`) - 0.5) * horizontalStep * 1.1;
			const driftY = Math.max(0, (seededRandom(`${note.noteId}:pack:y`) - 0.15) * verticalStep * 1.4);
			const maxLeft = Math.max(0, innerWidth - layoutDiameter);
			let chosenLeft = Math.max(0, Math.min(maxLeft, (mobile ? innerWidth / 2 : anchorX + radius) - radius + (preferLeft ? driftX * 0.25 : driftX)));
			let chosenTop = topInset;
			let found = false;
			const maxRows = Math.max(40, sorted.length * 6);

			for (let rowIndex = 0; rowIndex < maxRows && !found; rowIndex += 1) {
				const centerY = topInset + radius + rowIndex * verticalStep + driftY;
				for (const candidateCenterX of candidateCenterXs(innerWidth, mobile ? innerWidth / 2 : anchorX + radius, horizontalStep, rowIndex, driftX, preferLeft)) {
					const clampedCenterX = innerWidth <= layoutDiameter
						? radius
						: Math.max(radius, Math.min(innerWidth - radius, candidateCenterX));
					const left = clampedCenterX - radius;
					const top = centerY - radius;
					if (placed.some((other) => circlesOverlap(left, top, layoutDiameter, other, minGap))) {
						continue;
					}
					chosenLeft = left;
					chosenTop = top;
					found = true;
					break;
				}
			}

			if (!found) {
				const fallbackBottom = placed.reduce((max, item) => Math.max(max, item.top + item.layoutDiameter), topInset);
				chosenTop = fallbackBottom + minGap;
			}

			const rotateDeg = (seededRandom(`${note.noteId}:r`) - 0.5) * 8;
			const doc = activeWorkspaceId === note.workspaceId
				? (manager.peekDoc(note.noteId) ?? null)
				: null;
			const workspaceColorStyle = toWorkspaceBubbleColorStyle(
				workspaceColorSchemeById.get(note.workspaceId) ?? getWorkspaceBubbleColorScheme(themeId, note.workspaceId)
			);
			placed.push({
				note,
				sizeClass,
				detailLevel,
				bubbleDiameter,
				layoutDiameter,
				left: chosenLeft,
				top: chosenTop,
				rotateDeg,
				workspaceColorStyle,
				doc,
			});
		}

		const height = placed.reduce((max, item) => Math.max(max, item.top + item.layoutDiameter), 0) + 24;
		return { items: placed, width: Math.max(1, innerWidth), height };
	}, [activeWorkspaceId, clampedZoom, filteredNotes, innerWidth, manager, mobile, scale, themeId, workspaceColorSchemeById]);

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
		<div
			ref={containerRef}
			className={styles.container}
			style={{ '--bv-scale': String(scale) } as React.CSSProperties}
		>
			{/*
				BubbleView debug overlay intentionally left commented out.
				Re-enable this block with the debug state/effects above when layout
				instrumentation is needed again.
			<div className={styles.debugDock}>
				...
			</div>
			*/}
			<div className={styles.cloud} style={{ width: `${packedLayout.width}px`, minHeight: `${packedLayout.height}px` }}>
				{packedLayout.items.map((item) => (
					<motion.div
						key={`${item.note.workspaceId}:${item.note.noteId}`}
						initial={{ scale: 0.7, opacity: 0 }}
						animate={{ scale: 1, opacity: 1 }}
						className={styles.cloudItem}
						style={{
							left: `${item.left}px`,
							top: `${item.top}px`,
							width: `${item.layoutDiameter}px`,
							height: `${item.layoutDiameter}px`,
						}}
						transition={{ type: 'spring', stiffness: 300, damping: 22, mass: 0.6 }}
					>
							<Bubble
								note={item.note}
								doc={item.doc}
								sizeClass={item.sizeClass}
								detailLevel={item.detailLevel}
								bubbleDiameter={item.bubbleDiameter}
								workspaceColorStyle={item.workspaceColorStyle}
								swirlX={0}
								swirlY={0}
								rotateDeg={item.rotateDeg}
								onSelect={() => onSelectNote(item.note.noteId, item.note.workspaceId)}
							/>
					</motion.div>
				))
				}
			</div>
		</div>
	);
}
