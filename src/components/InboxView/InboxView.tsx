import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAt, faListCheck, faCheckDouble, faBoxArchive, faInbox, faCircleCheck, faTrashCan, faBell } from '@fortawesome/free-solid-svg-icons';
import { acceptNoteShareInvitation } from '../../core/noteShareApi';
import type { PendingSelfMention } from '../../core/pendingSelfMentions';
import { useI18n } from '../../core/i18n';
import { useLiveAvatarUrlLookup } from '../../core/liveUserAvatarCache';
import { fetchFiredReminders, fetchNoteReminderStates, type FiredReminder, type NoteReminderState } from '../../core/pushApi';
import { isReminderDueSoon } from '../../core/reminderUrgency';
import styles from './InboxView.module.css';

// ── Types ────────────────────────────────────────────────────────────────────

type ActivityKind = 'mention' | 'assignment_created' | 'note_shared' | 'note_share_accepted';

interface ActivityActor {
	id: string;
	name: string | null;
	avatarUrl: string | null;
}

interface Activity {
	id: string;
	kind: ActivityKind;
	createdAt: string;
	read: boolean;
	archived: boolean;
	actor: ActivityActor | null;
	subject: { noteId: string; workspaceId: string; subjectType: string; subjectId: string };
	deepLink: Record<string, unknown> | null;
	snapshot: {
		noteTitle?: string | null;
		assigneeLabel?: string | null;
		mentionExcerpt?: string | null;
		invitationId?: string | null;
	} | null;
	/** Current status of the mention invitation, resolved server-side at query time */
	invitationStatus?: string | null;
}

type FilterTab = 'all' | 'mentions' | 'assigned' | 'reminders';
type PlacementChoice = 'shared-root' | 'shared-folder' | 'personal';

interface Props {
	authUserId: string | null;
	themeId: string;
	iconSrc?: string;
	refreshToken?: number;
	/**
	 * May resolve `{ noteMissing: true }` when the target note has been
	 * permanently deleted — the caller has already shown a "no longer exists"
	 * toast and skipped navigation. InboxView responds by auto-archiving the
	 * card so it doesn't keep coming back for a note that no longer exists.
	 */
	onOpenNote: (noteId: string, workspaceId: string, roomId?: string, scrollToNodeId?: string) => void | Promise<{ noteMissing?: boolean } | void>;
	onAllArchived?: () => void;
	/** Called whenever an activity is read or archived so the badge count re-fetches. */
	onActivityChanged?: () => void;
	/** Optimistic self-mention notifications created while offline. Displayed at the
	 *  top of the feed and filtered out when a matching real server activity arrives. */
	pendingSelfMentions?: PendingSelfMention[];
	/** Called when the user dismisses (swipe or archive) a pending notification. */
	onPendingDismissed?: (id: string) => void;
	/** Called after each successful server fetch with the nodeIds found in deepLinks.
	 *  The caller uses this to clear pending entries that now have a real counterpart. */
	onServerNodeIdsLoaded?: (nodeIds: string[]) => void;
	/** Clears a reminder (Mark done) from the Reminders tab, without opening the note. */
	onMarkReminderDone?: (noteId: string, docId: string, title: string) => void;
	/** Opens the reminder date-picker modal for a note, pre-filled with its current value. */
	onOpenReminderModal?: (noteId: string, docId: string, title: string) => void;
	/** Called right after accepting a note share, with the resulting alias ID, so the
	 *  grid can scroll to and briefly highlight it once the user is back there —
	 *  otherwise a freshly accepted note is easy to lose in a large workspace. */
	onNoteAccepted?: (noteId: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Background refreshes on slow networks need more time than the original 5 s.
// The UI is never blocked (we always show cached data first), so a generous
// timeout is fine here — it only affects how long we wait for the silent update.
const FETCH_TIMEOUT_MS = 30_000;

// Touches starting within this many px of the left edge are reserved for
// App.tsx's mobile-sidebar edge-swipe-to-open gesture (MAX_START_X in the
// mobile-sidebar-open touch effect, src/App.tsx). Keep this in sync with
// that value: a card swipe starting in this zone is left completely alone
// (no preventDefault/stopPropagation) so the touch passes through to the
// sidebar gesture untouched; a swipe starting past it belongs to the card.
const SIDEBAR_EDGE_RESERVED_PX = 36;

// ── Persistent inbox cache (localStorage) ────────────────────────────────────
// Persists the first page of each filter tab across reloads so the inbox
// renders immediately without waiting for the network on slow connections.

const INBOX_CACHE_LS_KEY = 'freemannotes.inbox.cache.v1:';

interface PersistedFilterEntry {
	items: Activity[];
	nextCursor: string | null;
}
type PersistedInboxCache = Partial<Record<FilterTab, PersistedFilterEntry>>;

function readPersistedInboxCache(userId: string): PersistedInboxCache {
	try {
		const raw = localStorage.getItem(INBOX_CACHE_LS_KEY + userId);
		return raw ? (JSON.parse(raw) as PersistedInboxCache) : {};
	} catch {
		return {};
	}
}

function writePersistedFilterEntry(userId: string, tab: FilterTab, entry: PersistedFilterEntry): void {
	try {
		const existing = readPersistedInboxCache(userId);
		localStorage.setItem(INBOX_CACHE_LS_KEY + userId, JSON.stringify({ ...existing, [tab]: entry }));
	} catch {
		// Storage full or private browsing — silently ignore.
	}
}

function removeIdFromPersistedCache(userId: string, activityId: string): void {
	try {
		const existing = readPersistedInboxCache(userId);
		const updated: PersistedInboxCache = {};
		for (const [k, entry] of Object.entries(existing) as [FilterTab, PersistedFilterEntry][]) {
			updated[k] = { ...entry, items: entry.items.filter((a) => a.id !== activityId) };
		}
		localStorage.setItem(INBOX_CACHE_LS_KEY + userId, JSON.stringify(updated));
	} catch {
		// ignore
	}
}

function clearPersistedInboxCache(userId: string): void {
	try {
		localStorage.removeItem(INBOX_CACHE_LS_KEY + userId);
	} catch {
		// ignore
	}
}

function formatRelativeTime(iso: string, t: (key: string) => string): string {
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return t('inbox.justNow');
	if (mins < 60) return t('inbox.minsAgo').replace('{mins}', String(mins));
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return t('inbox.hoursAgo').replace('{hrs}', String(hrs));
	const days = Math.floor(hrs / 24);
	if (days === 1) return t('inbox.yesterday');
	if (days < 7) return t('inbox.daysAgo').replace('{days}', String(days));
	return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function activityMessage(activity: Activity, authUserId: string | null, t: (key: string) => string): string {
	const isSelf = authUserId != null && activity.actor?.id === authUserId;
	const actorName = activity.actor?.name ?? t('inbox.fallbackActor');
	const noteTitle = activity.snapshot?.noteTitle;
	const inNote = noteTitle
		? t('inbox.inNoteTitle').replace('{title}', noteTitle)
		: t('inbox.inNote');
	switch (activity.kind) {
		case 'mention':
			return isSelf
				? t('inbox.mentionSelf').replace('{inNote}', inNote)
				: t('inbox.mentionOther').replace('{actorName}', actorName).replace('{inNote}', inNote);
		case 'assignment_created':
			return isSelf
				? t('inbox.assignSelf').replace('{inNote}', inNote)
				: t('inbox.assignOther').replace('{actorName}', actorName).replace('{inNote}', inNote);
		case 'note_shared':
			return t('inbox.sharedNote').replace('{actorName}', actorName);
		case 'note_share_accepted':
			return t('inbox.shareAccepted').replace('{actorName}', actorName);
		default:
			return t('inbox.unknownActivity').replace('{actorName}', actorName);
	}
}

function activityIcon(kind: ActivityKind) {
	switch (kind) {
		case 'mention':          return faAt;
		case 'assignment_created': return faListCheck;
		default:                 return faAt;
	}
}

function initials(name: string | null | undefined): string {
	if (!name) return '?';
	return name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

// Per-filter cache stored in a ref so it persists across renders without
// causing re-renders when updated. Keyed by FilterTab.
interface FilterCache {
	items: Activity[];
	unreadIds: Set<string>;
	nextCursor: string | null;
}

// ── Main component ────────────────────────────────────────────────────────────

export function InboxView({ authUserId, onOpenNote, iconSrc, refreshToken = 0, onAllArchived, onActivityChanged, pendingSelfMentions, onPendingDismissed, onServerNodeIdsLoaded, onMarkReminderDone, onOpenReminderModal, onNoteAccepted }: Props) {
	const { t } = useI18n();
	const liveAvatarLookup = useLiveAvatarUrlLookup();
	const [filter, setFilter] = useState<FilterTab>('all');
	const [activities, setActivities] = useState<Activity[]>([]);
	// True only when fetching for a filter that has no cached data yet.
	const [loading, setLoading] = useState(true);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loadingMore, setLoadingMore] = useState(false);
	const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
	const [acceptingIds, setAcceptingIds] = useState<Set<string>>(new Set());

	// ── Reminders tab ────────────────────────────────────────────────────────
	// A separate data source from the Activity feed above (different API
	// namespace entirely — /api/push/reminders/*, not /api/inbox). Fetched
	// eagerly (not lazily on tab-select) so the tab's own count badge is
	// accurate even while viewing a different tab.
	const [remindersLoading, setRemindersLoading] = useState(true);
	const [overdueReminders, setOverdueReminders] = useState<FiredReminder[]>([]);
	const [dueSoonReminders, setDueSoonReminders] = useState<NoteReminderState[]>([]);

	const loadReminders = useCallback(async (): Promise<void> => {
		if (!authUserId) return;
		try {
			const [fired, all] = await Promise.all([
				fetchFiredReminders().catch(() => ({ reminders: [] as FiredReminder[] })),
				fetchNoteReminderStates().catch(() => ({ reminders: [] as NoteReminderState[] })),
			]);
			setOverdueReminders(fired.reminders);
			const firedNoteIds = new Set(fired.reminders.map((r) => r.noteId));
			setDueSoonReminders(all.reminders.filter((r) => !firedNoteIds.has(r.noteId) && isReminderDueSoon(r.reminderAt)));
		} finally {
			setRemindersLoading(false);
		}
	}, [authUserId]);

	useEffect(() => {
		void loadReminders();
	}, [loadReminders, refreshToken]);

	const handleMarkReminderDoneClick = useCallback((noteId: string, workspaceId: string, title: string | null): void => {
		if (!onMarkReminderDone) return;
		onMarkReminderDone(noteId, `${workspaceId}:${noteId}`, title || '');
		// Optimistic removal — the server sync happens fire-and-forget in the caller.
		setOverdueReminders((prev) => prev.filter((r) => r.noteId !== noteId));
		setDueSoonReminders((prev) => prev.filter((r) => r.noteId !== noteId));
	}, [onMarkReminderDone]);

	const handleRescheduleReminderClick = useCallback((noteId: string, workspaceId: string, title: string | null): void => {
		onOpenReminderModal?.(noteId, `${workspaceId}:${noteId}`, title || '');
	}, [onOpenReminderModal]);
	const [acceptedInvitationIds, setAcceptedInvitationIds] = useState<Set<string>>(new Set());

	// Placement picker state
	const [placementPickerActivityId, setPlacementPickerActivityId] = useState<string | null>(null);
	const [placementChoice, setPlacementChoice] = useState<PlacementChoice>('shared-root');
	const [folderName, setFolderName] = useState('');

	const abortRef = useRef<AbortController | null>(null);
	// Per-filter in-memory cache. Pre-seeded from localStorage so the inbox
	// renders immediately on cold start without waiting for the network.
	const cacheRef = useRef<Partial<Record<FilterTab, FilterCache>>>(
		(() => {
			if (!authUserId) return {};
			const persisted = readPersistedInboxCache(authUserId);
			const result: Partial<Record<FilterTab, FilterCache>> = {};
			for (const [tab, entry] of Object.entries(persisted) as [FilterTab, PersistedFilterEntry][]) {
				result[tab] = {
					items: entry.items,
					// Derive unreadIds from the persisted read state on the items themselves.
					unreadIds: new Set(entry.items.filter((a) => !a.read).map((a) => a.id)),
					nextCursor: entry.nextCursor,
				};
			}
			return result;
		})()
	);

	const kindForFilter = useCallback((f: FilterTab): string | null => {
		if (f === 'mentions')  return 'mention';
		if (f === 'assigned')  return 'assignment_created';
		return null;
	}, []);

	// Apply a cached entry to the live display state (no network needed).
	const applyCache = useCallback((entry: FilterCache) => {
		setActivities(entry.items);
		setUnreadIds(entry.unreadIds);
		setNextCursor(entry.nextCursor);
	}, []);

	// Update the cache ref AND live display state together so they stay in sync.
	const commitToCache = useCallback((f: FilterTab, items: Activity[], unread: Set<string>, cursor: string | null) => {
		cacheRef.current = { ...cacheRef.current, [f]: { items, unreadIds: unread, nextCursor: cursor } };
		setActivities(items);
		setUnreadIds(unread);
		setNextCursor(cursor);
	}, []);

	const fetchPage = useCallback(async (cursor: string | null, replace: boolean, targetFilter: FilterTab): Promise<boolean> => {
		abortRef.current?.abort();
		const ctrl = new AbortController();
		abortRef.current = ctrl;

		// Abort if the network hasn't responded in FETCH_TIMEOUT_MS (prevents infinite
		// "Loading" when the device goes offline mid-request).
		const timeoutId = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

		const params = new URLSearchParams({ limit: '30' });
		if (cursor) params.set('cursor', cursor);
		const kindFilter = kindForFilter(targetFilter);
		if (kindFilter) params.set('kind', kindFilter);

		try {
			const res = await fetch(`/api/inbox?${params}`, { signal: ctrl.signal });
			clearTimeout(timeoutId);
			if (!res.ok) return false;
			const data: { items: Activity[]; nextCursor: string | null } = await res.json();

			const prevItems = replace ? [] : (cacheRef.current[targetFilter]?.items ?? []);
			const prevUnread = replace ? new Set<string>() : (cacheRef.current[targetFilter]?.unreadIds ?? new Set<string>());
			const newItems = replace ? data.items : [...prevItems, ...data.items];
			const newUnread = new Set([...prevUnread, ...data.items.filter((a) => !a.read).map((a) => a.id)]);

			commitToCache(targetFilter, newItems, newUnread, data.nextCursor);

			// Persist only the first page (replace=true) so we never overflow storage
			// with paginated history and always cold-start from the freshest known page.
			if (replace && authUserId) {
				writePersistedFilterEntry(authUserId, targetFilter, { items: data.items, nextCursor: data.nextCursor });
			}

			if (onServerNodeIdsLoaded) {
				const nodeIds = data.items.flatMap((a) =>
					a.deepLink?.kind === 'prosemirror_node' && typeof a.deepLink.nodeId === 'string'
						? [a.deepLink.nodeId as string]
						: []
				);
				if (nodeIds.length > 0) onServerNodeIdsLoaded(nodeIds);
			}
			return true;
		} catch (e: unknown) {
			clearTimeout(timeoutId);
			if (e instanceof Error && e.name === 'AbortError') return false;
			return false;
		}
	}, [authUserId, kindForFilter, onServerNodeIdsLoaded, commitToCache]);

	// On filter change: show cached data immediately (no flash) and fetch to refresh.
	// Only show the loading spinner when there is no cached data for this filter yet.
	useEffect(() => {
		const cached = cacheRef.current[filter];
		if (cached) {
			applyCache(cached);
			setLoading(false);
			// Background refresh — don't show spinner
			void fetchPage(null, true, filter);
		} else {
			setLoading(true);
			fetchPage(null, true, filter).finally(() => setLoading(false));
		}
	}, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

	// Server-push refresh: re-fetch quietly without blanking the list.
	const prevRefreshTokenRef = useRef(refreshToken);
	useEffect(() => {
		if (prevRefreshTokenRef.current === refreshToken) return;
		prevRefreshTokenRef.current = refreshToken;
		void fetchPage(null, true, filter).catch(() => {});
	}, [refreshToken, fetchPage, filter]);

	const handleLoadMore = useCallback(async () => {
		if (!nextCursor || loadingMore) return;
		setLoadingMore(true);
		await fetchPage(nextCursor, false, filter);
		setLoadingMore(false);
	}, [nextCursor, loadingMore, fetchPage, filter]);

	const markRead = useCallback(async (id: string) => {
		setUnreadIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
		// Keep cache in sync
		const cached = cacheRef.current[filter];
		if (cached) {
			const updatedUnread = new Set(cached.unreadIds);
			updatedUnread.delete(id);
			cacheRef.current = { ...cacheRef.current, [filter]: { ...cached, unreadIds: updatedUnread } };
		}
		// Wait for the POST before bumping the refresh token so the count re-fetch
		// sees the updated read state and doesn't return a stale badge count.
		await fetch('/api/inbox/read', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ activityIds: [id] }),
		}).catch(() => {});
		onActivityChanged?.();
	}, [onActivityChanged, filter]);

	const removeFromCache = useCallback((id: string) => {
		// Remove an item from every filter cache so it stays gone on tab switches.
		const updated: Partial<Record<FilterTab, FilterCache>> = {};
		for (const [k, entry] of Object.entries(cacheRef.current) as [FilterTab, FilterCache][]) {
			const items = entry.items.filter((a) => a.id !== id);
			const unreadIds = new Set(entry.unreadIds);
			unreadIds.delete(id);
			updated[k] = { ...entry, items, unreadIds };
		}
		cacheRef.current = updated;
		if (authUserId) removeIdFromPersistedCache(authUserId, id);
	}, [authUserId]);

	// Wait for the POST before bumping the refresh token — firing it first caused
	// the count re-fetch and list re-fetch to race with the in-flight archive and
	// return stale data (badge stuck at 1, card reappearing after swipe).
	const archiveActivityById = useCallback(async (id: string) => {
		setActivities((prev) => prev.filter((a) => a.id !== id));
		removeFromCache(id);
		await fetch('/api/inbox/archive', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ activityIds: [id] }),
		}).catch(() => {});
		onActivityChanged?.();
	}, [onActivityChanged, removeFromCache]);

	const archiveActivity = useCallback(async (e: React.MouseEvent, id: string) => {
		e.stopPropagation();
		if (id.startsWith('pending-')) {
			onPendingDismissed?.(id);
			onActivityChanged?.();
			return;
		}
		await archiveActivityById(id);
	}, [archiveActivityById, onPendingDismissed, onActivityChanged]);

	const markAllRead = useCallback(async () => {
		if (unreadIds.size === 0) return;
		const ids = [...unreadIds];
		setUnreadIds(new Set());
		// Clear unread from all filter caches
		const updated: Partial<Record<FilterTab, FilterCache>> = {};
		for (const [k, entry] of Object.entries(cacheRef.current) as [FilterTab, FilterCache][]) {
			const updatedUnread = new Set(entry.unreadIds);
			ids.forEach((id) => updatedUnread.delete(id));
			updated[k] = { ...entry, unreadIds: updatedUnread };
		}
		cacheRef.current = updated;
		await fetch('/api/inbox/read', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ activityIds: ids }),
		}).catch(() => {});
		onActivityChanged?.();
	}, [unreadIds, onActivityChanged]);

	const archiveAll = useCallback(async () => {
		setActivities([]);
		setUnreadIds(new Set());
		cacheRef.current = {};
		if (authUserId) clearPersistedInboxCache(authUserId);
		await fetch('/api/inbox/archive-all', {
			method: 'POST',
		}).catch(() => {});
		onAllArchived?.();
	}, [authUserId, onAllArchived]);

	// Swipe-to-dismiss state: maps activityId → current swipe offset (px)
	const [swipeOffsets, setSwipeOffsets] = useState<Record<string, number>>({});
	const swipeTouchRef = useRef<{ id: string; startX: number; startY: number; startTime: number; moved: boolean } | null>(null);

	const handleSwipeTouchStart = useCallback((e: React.TouchEvent, activityId: string) => {
		const t = e.touches[0];
		if (t.clientX <= SIDEBAR_EDGE_RESERVED_PX) {
			swipeTouchRef.current = null;
			return;
		}
		swipeTouchRef.current = { id: activityId, startX: t.clientX, startY: t.clientY, startTime: Date.now(), moved: false };
	}, []);

	const handleSwipeTouchMove = useCallback((e: React.TouchEvent, activityId: string) => {
		const touch = swipeTouchRef.current;
		if (!touch || touch.id !== activityId) return;
		const t = e.touches[0];
		const dx = t.clientX - touch.startX;
		const dy = Math.abs(t.clientY - touch.startY);
		// If vertical movement dominates, don't intercept (let scroll happen)
		if (!touch.moved && dy > Math.abs(dx)) {
			swipeTouchRef.current = null;
			return;
		}
		touch.moved = true;
		e.preventDefault();
		// App.tsx has a document-level touchmove listener (bubble phase, not capture)
		// that opens the mobile sidebar on a left-edge right-swipe. preventDefault()
		// alone doesn't stop the native event from continuing to bubble to it, so a
		// card swipe starting near the screen edge dragged the sidebar open in sync
		// with the card. stopPropagation() keeps this gesture from reaching document.
		e.stopPropagation();
		setSwipeOffsets((prev) => ({ ...prev, [activityId]: dx }));
	}, []);

	const handleSwipeTouchEnd = useCallback((e: React.TouchEvent, activity: Activity) => {
		const touch = swipeTouchRef.current;
		swipeTouchRef.current = null;
		if (!touch || touch.id !== activity.id || !touch.moved) return;
		const offset = swipeOffsets[activity.id] ?? 0;
		const elapsed = Date.now() - touch.startTime;
		const velocity = elapsed > 0 ? Math.abs(offset) / elapsed : 0;
		// Require a meaningful displacement AND velocity so accidental grazes don't dismiss.
		// 120 px threshold + 0.25 px/ms minimum velocity (a deliberate swipe is ~0.5–2 px/ms).
		if (Math.abs(offset) > 120 && velocity > 0.25) {
			// Dismissed — animate fully out in the swipe direction then archive
			const exitX = offset > 0 ? 9999 : -9999;
			setSwipeOffsets((prev) => ({ ...prev, [activity.id]: exitX }));
			setTimeout(async () => {
				setSwipeOffsets((prev) => { const n = { ...prev }; delete n[activity.id]; return n; });
				if (activity.id.startsWith('pending-')) {
					onPendingDismissed?.(activity.id);
					onActivityChanged?.();
				} else {
					await archiveActivityById(activity.id);
				}
			}, 200);
		} else {
			// Snap back
			setSwipeOffsets((prev) => { const n = { ...prev }; delete n[activity.id]; return n; });
		}
	}, [swipeOffsets, archiveActivityById, onActivityChanged, onPendingDismissed]);

	const handleActivityClick = useCallback((activity: Activity) => {
		// Don't navigate if the placement picker is open on this card.
		if (placementPickerActivityId === activity.id) return;
		const scrollToNodeId =
			activity.deepLink?.kind === 'prosemirror_node' && typeof activity.deepLink.nodeId === 'string'
				? activity.deepLink.nodeId
				: undefined;
		if (activity.id.startsWith('pending-')) {
			// Clicking a pending self-mention: open the note and dismiss the pending entry.
			onPendingDismissed?.(activity.id);
			onActivityChanged?.();
			onOpenNote(activity.subject.noteId, activity.subject.workspaceId, undefined, scrollToNodeId);
			return;
		}
		markRead(activity.id);
		// The target note may have been trashed or permanently deleted since the
		// mention was created. onOpenNote resolves { noteMissing: true } when it
		// found the note is gone for good (as opposed to just trashed) — in that
		// case there's nothing useful left for this card to point at, so archive
		// it automatically instead of leaving a permanently-dead notification.
		void Promise.resolve(onOpenNote(activity.subject.noteId, activity.subject.workspaceId, undefined, scrollToNodeId))
			.then((outcome) => {
				if (outcome?.noteMissing) void archiveActivityById(activity.id);
			});
	}, [markRead, onOpenNote, placementPickerActivityId, onPendingDismissed, onActivityChanged, archiveActivityById]);

	const openPlacementPicker = useCallback((e: React.MouseEvent, activity: Activity) => {
		e.stopPropagation();
		setPlacementPickerActivityId(activity.id);
		setPlacementChoice('shared-root');
		setFolderName('');
	}, []);

	const closePlacementPicker = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		setPlacementPickerActivityId(null);
	}, []);

	const handleConfirmPlacement = useCallback(async (e: React.MouseEvent, activity: Activity) => {
		e.stopPropagation();
		const invitationId = activity.snapshot?.invitationId;
		if (!invitationId) return;

		setAcceptingIds((prev) => new Set([...prev, activity.id]));
		try {
			const target = placementChoice === 'personal' ? 'personal' : 'shared';
			const folder = placementChoice === 'shared-folder' ? folderName.trim() : '';
			const result = await acceptNoteShareInvitation(invitationId, {
				target,
				folderName: folder || undefined,
			});
			const aliasId = result.placement?.aliasId;
			const roomId = result.invitation?.docId;
			const noteId: string = (aliasId && typeof aliasId === 'string') ? aliasId : activity.subject.noteId;
			setAcceptedInvitationIds((prev) => new Set([...prev, invitationId]));
			setPlacementPickerActivityId(null);
			// Remove the card immediately and mark as read. The server has already
			// archived it on the acceptance endpoint, so it won't reappear on
			// re-login, cache clear, or app update.
			setActivities((prev) => prev.filter((a) => a.id !== activity.id));
			removeFromCache(activity.id);
			markRead(activity.id);
			onNoteAccepted?.(noteId);
			onOpenNote(noteId, activity.subject.workspaceId, roomId);
		} catch {
			// non-fatal — let user retry
		} finally {
			setAcceptingIds((prev) => { const n = new Set(prev); n.delete(activity.id); return n; });
		}
	}, [folderName, markRead, onNoteAccepted, onOpenNote, placementChoice, removeFromCache]);

	const reminderTabCount = overdueReminders.length + dueSoonReminders.length;
	const tabs: { key: FilterTab; label: string; count?: number }[] = [
		{ key: 'all',       label: t('inbox.tabAll') },
		{ key: 'mentions',  label: t('inbox.tabMentions') },
		{ key: 'assigned',  label: t('inbox.tabAssigned') },
		{ key: 'reminders', label: t('inbox.tabReminders'), count: reminderTabCount },
	];

	// Build a merged display list: pending self-mentions shown above real activities.
	// Pending entries whose nodeId already has a real server Activity are suppressed
	// (they've been synced and the real one is now in the list).
	const serverNodeIds = React.useMemo(() => {
		const ids = new Set<string>();
		for (const a of activities) {
			if (a.deepLink?.kind === 'prosemirror_node' && typeof a.deepLink.nodeId === 'string') {
				ids.add(a.deepLink.nodeId as string);
			}
		}
		return ids;
	}, [activities]);

	const pendingAsActivities = React.useMemo((): Activity[] => {
		if (!pendingSelfMentions || pendingSelfMentions.length === 0) return [];
		// Show only if filter is 'all' or 'mentions' (self-mentions are always 'mention' kind)
		if (filter === 'assigned') return [];
		return pendingSelfMentions
			.filter((p) => !serverNodeIds.has(p.nodeId))
			.map((p) => ({
				id: p.id,
				kind: 'mention' as const,
				createdAt: p.insertedAt,
				read: false,
				archived: false,
				actor: { id: p.actorId, name: p.actorName, avatarUrl: p.actorAvatarUrl },
				subject: { noteId: p.noteId, workspaceId: p.workspaceId, subjectType: 'note', subjectId: p.noteId },
				deepLink: { kind: 'prosemirror_node', nodeId: p.nodeId },
				snapshot: { noteTitle: p.noteTitle },
				invitationStatus: null,
			}));
	}, [pendingSelfMentions, serverNodeIds, filter]);

	const displayActivities = React.useMemo(
		() => [...pendingAsActivities, ...activities],
		[pendingAsActivities, activities],
	);

	return (
		<div className={styles.root}>
			<div className={styles.header}>
				<h1 className={styles.title}>
					{iconSrc
						? <img src={iconSrc} alt="" aria-hidden="true" className={styles.titleIcon} style={{ width: 22, height: 22, objectFit: 'contain' }} />
						: <FontAwesomeIcon icon={faInbox} className={styles.titleIcon} />}
					{t('inbox.title')}
				</h1>
				<div style={{ display: 'flex', gap: 8 }}>
					{filter !== 'reminders' && unreadIds.size > 0 && (
						<button className={styles.markAllBtn} onClick={markAllRead} type="button">
							<FontAwesomeIcon icon={faCheckDouble} />
							{t('inbox.markAllRead')}
						</button>
					)}
					{filter !== 'reminders' && displayActivities.length > 0 && (
						<button className={styles.clearAllBtn} onClick={archiveAll} type="button">
							<FontAwesomeIcon icon={faTrashCan} />
							{t('inbox.clearAll')}
						</button>
					)}
				</div>
			</div>

			<div className={styles.tabs}>
				{tabs.map((tab) => (
					<button
						key={tab.key}
						type="button"
						className={`${styles.tab}${filter === tab.key ? ` ${styles.tabActive}` : ''}`}
						onClick={() => setFilter(tab.key)}
					>
						{tab.label}
						{tab.count ? <span className={styles.tabCount}>{tab.count}</span> : null}
					</button>
				))}
			</div>

			<div className={styles.feed}>
				{filter === 'reminders' ? (
					remindersLoading ? (
						<div className={styles.empty}>
							<div className={styles.emptyIcon}>
								<FontAwesomeIcon icon={faBell} />
							</div>
							<span>{t('common.loading')}</span>
						</div>
					) : reminderTabCount === 0 ? (
						<div className={styles.empty}>
							<div className={styles.emptyIcon}>
								<FontAwesomeIcon icon={faBell} />
							</div>
							<span className={styles.emptyTitle}>{t('inbox.remindersEmptyTitle')}</span>
							<span className={styles.emptySubtext}>{t('inbox.remindersEmptySubtext')}</span>
						</div>
					) : (
						<>
							{overdueReminders.length > 0 ? (
								<>
									<div className={styles.reminderGroupLabel}>{t('inbox.remindersOverdueGroup')}</div>
									{overdueReminders.map((reminder) => (
										<div key={reminder.id} className={`${styles.card} ${styles.reminderCard} ${styles.reminderCardOverdue}`}>
											<div
												role="button"
												tabIndex={0}
												className={styles.reminderCardMain}
												onClick={() => onOpenNote(reminder.noteId, reminder.workspaceId)}
												onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpenNote(reminder.noteId, reminder.workspaceId); }}
											>
												<FontAwesomeIcon icon={faBell} className={styles.reminderCardIcon} />
												<div>
													<div className={styles.reminderCardTitle}>{reminder.noteTitle || t('note.untitled')}</div>
													<div className={styles.reminderCardMeta}>{new Date(reminder.reminderAt).toLocaleString()}</div>
												</div>
											</div>
											<div className={styles.reminderCardActions}>
												<button type="button" className={styles.reminderCardButton} onClick={() => handleMarkReminderDoneClick(reminder.noteId, reminder.workspaceId, reminder.noteTitle)}>
													{t('editors.reminderMarkDone')}
												</button>
												<button type="button" className={styles.reminderCardButton} onClick={() => handleRescheduleReminderClick(reminder.noteId, reminder.workspaceId, reminder.noteTitle)}>
													{t('editors.reminderReschedule')}
												</button>
											</div>
										</div>
									))}
								</>
							) : null}
							{dueSoonReminders.length > 0 ? (
								<>
									<div className={styles.reminderGroupLabel}>{t('inbox.remindersDueSoonGroup')}</div>
									{dueSoonReminders.map((reminder) => (
										<div key={reminder.docId} className={`${styles.card} ${styles.reminderCard}`}>
											<div
												role="button"
												tabIndex={0}
												className={styles.reminderCardMain}
												onClick={() => onOpenNote(reminder.noteId, reminder.workspaceId)}
												onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpenNote(reminder.noteId, reminder.workspaceId); }}
											>
												<FontAwesomeIcon icon={faBell} className={styles.reminderCardIcon} />
												<div>
													<div className={styles.reminderCardTitle}>{reminder.noteTitle || t('note.untitled')}</div>
													<div className={styles.reminderCardMeta}>{new Date(reminder.reminderAt).toLocaleString()}</div>
												</div>
											</div>
											<div className={styles.reminderCardActions}>
												<button type="button" className={styles.reminderCardButton} onClick={() => handleMarkReminderDoneClick(reminder.noteId, reminder.workspaceId, reminder.noteTitle)}>
													{t('editors.reminderMarkDone')}
												</button>
												<button type="button" className={styles.reminderCardButton} onClick={() => handleRescheduleReminderClick(reminder.noteId, reminder.workspaceId, reminder.noteTitle)}>
													{t('editors.reminderReschedule')}
												</button>
											</div>
										</div>
									))}
								</>
							) : null}
						</>
					)
				) : loading ? (
					<div className={styles.empty}>
						<div className={styles.emptyIcon}>
							{iconSrc
								? <img src={iconSrc} alt="" aria-hidden="true" style={{ width: '2.5rem', height: '2.5rem', objectFit: 'contain' }} />
								: <FontAwesomeIcon icon={faInbox} />}
						</div>
						<span>{t('common.loading')}</span>
					</div>
				) : displayActivities.length === 0 ? (
					<div className={styles.empty}>
						<div className={styles.emptyIcon}>
							{iconSrc
								? <img src={iconSrc} alt="" aria-hidden="true" style={{ width: '2.5rem', height: '2.5rem', objectFit: 'contain' }} />
								: <FontAwesomeIcon icon={faInbox} />}
						</div>
						<span className={styles.emptyTitle}>{t('inbox.emptyTitle')}</span>
						<span className={styles.emptySubtext}>{t('inbox.emptySubtext')}</span>
					</div>
				) : (
					<>
						{displayActivities.map((activity) => {
							// Pending activities are always unread; real ones check the server-driven set.
							const isUnread = activity.id.startsWith('pending-') || unreadIds.has(activity.id);
							const isPickerOpen = placementPickerActivityId === activity.id;
							const isBusy = acceptingIds.has(activity.id);
							const invitationId = activity.snapshot?.invitationId;
							const actorId = activity.actor?.id;
							const actorAvatarUrl = actorId
								? (liveAvatarLookup.has(actorId) ? liveAvatarLookup.get(actorId) ?? null : activity.actor!.avatarUrl)
								: null;
							// Show Accept & View only when a pending invitation exists.
							// Both mention and assignment_created can carry an invitation —
							// the button is suppressed if the user already has access (no
							// invitationId) or has accepted in this session.
							const showAcceptBtn =
								(activity.kind === 'mention' || activity.kind === 'assignment_created') &&
								invitationId &&
								activity.invitationStatus === 'PENDING' &&
								!acceptedInvitationIds.has(invitationId);
							const swipeOffset = swipeOffsets[activity.id] ?? 0;
							const isSwiping = swipeOffset !== 0;
							return (
								<div key={activity.id} className={styles.cardSwipeWrap}>
									<div className={styles.cardSwipeBack} aria-hidden="true">
										<FontAwesomeIcon icon={faBoxArchive} />
										<FontAwesomeIcon icon={faBoxArchive} />
									</div>
									<div
										className={styles.cardSwipeFront}
										style={isSwiping ? { transform: `translateX(${swipeOffset}px)`, transition: 'none' } : undefined}
										onTouchStart={(e) => handleSwipeTouchStart(e, activity.id)}
										onTouchMove={(e) => handleSwipeTouchMove(e, activity.id)}
										onTouchEnd={(e) => handleSwipeTouchEnd(e, activity)}
									>
									<div
										role="button"
										tabIndex={0}
										className={`${styles.card}${isUnread ? ` ${styles.cardUnread}` : ''}${isPickerOpen ? ` ${styles.cardPickerOpen}` : ''}`}
										onClick={() => handleActivityClick(activity)}
										onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleActivityClick(activity); }}
								>
									<div className={styles.cardLeft}>
										{isUnread && <span className={styles.unreadDot} aria-label={t('inbox.unread')} />}
										<div className={styles.avatar}>
											{actorAvatarUrl ? (
												<img src={actorAvatarUrl} alt="" className={styles.avatarImg} />
											) : (
												<span className={styles.avatarInitials}>
													{initials(activity.actor?.name)}
												</span>
											)}
											<span className={styles.kindBadge} aria-hidden="true">
												<FontAwesomeIcon icon={activityIcon(activity.kind)} />
											</span>
										</div>
									</div>

									<div className={styles.cardBody}>
										<p className={styles.message}>{activityMessage(activity, authUserId, t)}</p>
										{activity.snapshot?.mentionExcerpt && (
											<p className={styles.snippet}>"{activity.snapshot.mentionExcerpt}"</p>
										)}
										{!activity.snapshot?.mentionExcerpt && activity.snapshot?.noteTitle && (
											<p className={styles.snippet}>"{activity.snapshot.noteTitle}"</p>
										)}

										{showAcceptBtn && !isPickerOpen && (
											<button
												type="button"
												className={styles.acceptBtn}
												onMouseDown={(e) => e.stopPropagation()}
												onClick={(e) => openPlacementPicker(e, activity)}
											>
												<FontAwesomeIcon icon={faCircleCheck} />
												{t('inbox.acceptAndView')}
											</button>
										)}

										{showAcceptBtn && isPickerOpen && (
											<div className={styles.placementPicker} onClick={(e) => e.stopPropagation()}>
												<p className={styles.placementLabel}>{t('inbox.placementLabel')}</p>
												<label className={styles.radioLabel}>
													<input
														type="radio"
														name={`placement-${activity.id}`}
														checked={placementChoice === 'shared-root'}
														onChange={() => setPlacementChoice('shared-root')}
													/>
													{t('inbox.placementSharedRoot')}
												</label>
												<label className={styles.radioLabel}>
													<input
														type="radio"
														name={`placement-${activity.id}`}
														checked={placementChoice === 'shared-folder'}
														onChange={() => setPlacementChoice('shared-folder')}
													/>
													{t('inbox.placementSharedFolder')}
												</label>
												{placementChoice === 'shared-folder' && (
													<input
														className={styles.folderInput}
														type="text"
														value={folderName}
														onChange={(e) => setFolderName(e.target.value)}
														placeholder={t('inbox.folderNamePlaceholder')}
														autoFocus
													/>
												)}
												<label className={styles.radioLabel}>
													<input
														type="radio"
														name={`placement-${activity.id}`}
														checked={placementChoice === 'personal'}
														onChange={() => setPlacementChoice('personal')}
													/>
													{t('inbox.placementPersonal')}
												</label>
												<div className={styles.placementActions}>
													<button
														type="button"
														className={styles.confirmBtn}
														disabled={isBusy}
														onClick={(e) => handleConfirmPlacement(e, activity)}
													>
														{isBusy ? t('inbox.opening') : t('inbox.confirmAndOpen')}
													</button>
													<button
														type="button"
														className={styles.cancelBtn}
														disabled={isBusy}
														onClick={closePlacementPicker}
													>
														{t('common.cancel')}
													</button>
												</div>
											</div>
										)}

										<time className={styles.time} dateTime={activity.createdAt}>
											{formatRelativeTime(activity.createdAt, t)}
										</time>
									</div>

									<button
										type="button"
										className={styles.archiveBtn}
										title={t('inbox.archive')}
										onClick={(e) => { e.stopPropagation(); archiveActivity(e, activity.id); }}
										aria-label={t('inbox.archive')}
									>
										<FontAwesomeIcon icon={faBoxArchive} />
									</button>
								</div>
								</div>
								</div>
							);
						})}

						{nextCursor && (
							<button
								type="button"
								className={styles.loadMoreBtn}
								onClick={handleLoadMore}
								disabled={loadingMore}
							>
								{loadingMore ? t('common.loading') : t('inbox.loadMore')}
							</button>
						)}
					</>
				)}
			</div>
		</div>
	);
}
