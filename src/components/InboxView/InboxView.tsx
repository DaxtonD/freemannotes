import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAt, faListCheck, faCheckDouble, faBoxArchive, faInbox, faCircleCheck, faTrashCan } from '@fortawesome/free-solid-svg-icons';
import { acceptNoteShareInvitation } from '../../core/noteShareApi';
import type { PendingSelfMention } from '../../core/pendingSelfMentions';
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

type FilterTab = 'all' | 'mentions' | 'assigned';
type PlacementChoice = 'shared-root' | 'shared-folder' | 'personal';

interface Props {
	authUserId: string | null;
	themeId: string;
	iconSrc?: string;
	refreshToken?: number;
	onOpenNote: (noteId: string, workspaceId: string, roomId?: string, scrollToNodeId?: string) => void;
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
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 5_000;

function formatRelativeTime(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return 'Just now';
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	if (days === 1) return 'Yesterday';
	if (days < 7) return `${days}d ago`;
	return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function activityMessage(activity: Activity, authUserId: string | null): string {
	const isSelf = authUserId != null && activity.actor?.id === authUserId;
	const actorName = activity.actor?.name ?? 'Someone';
	const noteTitle = activity.snapshot?.noteTitle;
	const inNote = noteTitle ? `in "${noteTitle}"` : 'in a note';
	switch (activity.kind) {
		case 'mention':
			return isSelf ? `You mentioned yourself ${inNote}` : `${actorName} mentioned you ${inNote}`;
		case 'assignment_created':
			return isSelf ? `You assigned yourself a task ${inNote}` : `${actorName} assigned you a task ${inNote}`;
		case 'note_shared':      return `${actorName} shared a note with you`;
		case 'note_share_accepted': return `${actorName} accepted your note share`;
		default:                 return `${actorName} sent you an activity`;
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

export function InboxView({ authUserId, onOpenNote, iconSrc, refreshToken = 0, onAllArchived, onActivityChanged, pendingSelfMentions, onPendingDismissed, onServerNodeIdsLoaded }: Props) {
	const [filter, setFilter] = useState<FilterTab>('all');
	const [activities, setActivities] = useState<Activity[]>([]);
	// True only when fetching for a filter that has no cached data yet.
	const [loading, setLoading] = useState(true);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loadingMore, setLoadingMore] = useState(false);
	const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
	const [acceptingIds, setAcceptingIds] = useState<Set<string>>(new Set());
	const [acceptedInvitationIds, setAcceptedInvitationIds] = useState<Set<string>>(new Set());

	// Placement picker state
	const [placementPickerActivityId, setPlacementPickerActivityId] = useState<string | null>(null);
	const [placementChoice, setPlacementChoice] = useState<PlacementChoice>('shared-root');
	const [folderName, setFolderName] = useState('');

	const abortRef = useRef<AbortController | null>(null);
	// Per-filter in-memory cache. Populated on each successful fetch so that
	// switching tabs offline shows the last-known data rather than a blank list.
	const cacheRef = useRef<Partial<Record<FilterTab, FilterCache>>>({});

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
	}, [kindForFilter, onServerNodeIdsLoaded, commitToCache]);

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
		onActivityChanged?.();
		await fetch('/api/inbox/read', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ activityIds: [id] }),
		}).catch(() => {});
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
	}, []);

	const archiveActivity = useCallback(async (e: React.MouseEvent, id: string) => {
		e.stopPropagation();
		if (id.startsWith('pending-')) {
			onPendingDismissed?.(id);
			onActivityChanged?.();
			return;
		}
		setActivities((prev) => prev.filter((a) => a.id !== id));
		removeFromCache(id);
		onActivityChanged?.();
		await fetch('/api/inbox/archive', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ activityIds: [id] }),
		}).catch(() => {});
	}, [onActivityChanged, onPendingDismissed, removeFromCache]);

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
		onActivityChanged?.();
		await fetch('/api/inbox/read', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ activityIds: ids }),
		}).catch(() => {});
	}, [unreadIds, onActivityChanged]);

	const archiveAll = useCallback(async () => {
		setActivities([]);
		setUnreadIds(new Set());
		cacheRef.current = {};
		await fetch('/api/inbox/archive-all', {
			method: 'POST',
		}).catch(() => {});
		onAllArchived?.();
	}, [onAllArchived]);

	// Swipe-to-dismiss state: maps activityId → current swipe offset (px)
	const [swipeOffsets, setSwipeOffsets] = useState<Record<string, number>>({});
	const swipeTouchRef = useRef<{ id: string; startX: number; startY: number; startTime: number; moved: boolean } | null>(null);

	const handleSwipeTouchStart = useCallback((e: React.TouchEvent, activityId: string) => {
		const t = e.touches[0];
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
			setTimeout(() => {
				setSwipeOffsets((prev) => { const n = { ...prev }; delete n[activity.id]; return n; });
				onActivityChanged?.();
				if (activity.id.startsWith('pending-')) {
					onPendingDismissed?.(activity.id);
				} else {
					setActivities((prev) => prev.filter((a) => a.id !== activity.id));
					removeFromCache(activity.id);
					fetch('/api/inbox/archive', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ activityIds: [activity.id] }),
					}).catch(() => {});
				}
			}, 200);
		} else {
			// Snap back
			setSwipeOffsets((prev) => { const n = { ...prev }; delete n[activity.id]; return n; });
		}
	}, [swipeOffsets, onActivityChanged, onPendingDismissed, removeFromCache]);

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
		onOpenNote(activity.subject.noteId, activity.subject.workspaceId, undefined, scrollToNodeId);
	}, [markRead, onOpenNote, placementPickerActivityId, onPendingDismissed, onActivityChanged]);

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
			markRead(activity.id);
			onOpenNote(noteId, activity.subject.workspaceId, roomId);
		} catch {
			// non-fatal — let user retry
		} finally {
			setAcceptingIds((prev) => { const n = new Set(prev); n.delete(activity.id); return n; });
		}
	}, [folderName, markRead, onOpenNote, placementChoice]);

	const tabs: { key: FilterTab; label: string }[] = [
		{ key: 'all',      label: 'All' },
		{ key: 'mentions', label: 'Mentions' },
		{ key: 'assigned', label: 'Assigned to me' },
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
					Inbox
				</h1>
				<div style={{ display: 'flex', gap: 8 }}>
					{unreadIds.size > 0 && (
						<button className={styles.markAllBtn} onClick={markAllRead} type="button">
							<FontAwesomeIcon icon={faCheckDouble} />
							Mark all read
						</button>
					)}
					{displayActivities.length > 0 && (
						<button className={styles.clearAllBtn} onClick={archiveAll} type="button">
							<FontAwesomeIcon icon={faTrashCan} />
							Clear all
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
					</button>
				))}
			</div>

			<div className={styles.feed}>
				{loading ? (
					<div className={styles.empty}>
						<div className={styles.emptyIcon}>
							{iconSrc
								? <img src={iconSrc} alt="" aria-hidden="true" style={{ width: '2.5rem', height: '2.5rem', objectFit: 'contain' }} />
								: <FontAwesomeIcon icon={faInbox} />}
						</div>
						<span>Loading…</span>
					</div>
				) : displayActivities.length === 0 ? (
					<div className={styles.empty}>
						<div className={styles.emptyIcon}>
							{iconSrc
								? <img src={iconSrc} alt="" aria-hidden="true" style={{ width: '2.5rem', height: '2.5rem', objectFit: 'contain' }} />
								: <FontAwesomeIcon icon={faInbox} />}
						</div>
						<span className={styles.emptyTitle}>Sector clear.</span>
						<span className={styles.emptySubtext}>No incoming transmissions. Mentions and assignments will appear here.</span>
					</div>
				) : (
					<>
						{displayActivities.map((activity) => {
							// Pending activities are always unread; real ones check the server-driven set.
							const isUnread = activity.id.startsWith('pending-') || unreadIds.has(activity.id);
							const isPickerOpen = placementPickerActivityId === activity.id;
							const isBusy = acceptingIds.has(activity.id);
							const invitationId = activity.snapshot?.invitationId;
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
										{isUnread && <span className={styles.unreadDot} aria-label="Unread" />}
										<div className={styles.avatar}>
											{activity.actor?.avatarUrl ? (
												<img src={activity.actor.avatarUrl} alt="" className={styles.avatarImg} />
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
										<p className={styles.message}>{activityMessage(activity, authUserId)}</p>
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
												Accept &amp; View
											</button>
										)}

										{showAcceptBtn && isPickerOpen && (
											<div className={styles.placementPicker} onClick={(e) => e.stopPropagation()}>
												<p className={styles.placementLabel}>Where should this note appear?</p>
												<label className={styles.radioLabel}>
													<input
														type="radio"
														name={`placement-${activity.id}`}
														checked={placementChoice === 'shared-root'}
														onChange={() => setPlacementChoice('shared-root')}
													/>
													Shared With Me
												</label>
												<label className={styles.radioLabel}>
													<input
														type="radio"
														name={`placement-${activity.id}`}
														checked={placementChoice === 'shared-folder'}
														onChange={() => setPlacementChoice('shared-folder')}
													/>
													A subfolder within Shared With Me
												</label>
												{placementChoice === 'shared-folder' && (
													<input
														className={styles.folderInput}
														type="text"
														value={folderName}
														onChange={(e) => setFolderName(e.target.value)}
														placeholder="Folder name (optional)"
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
													Personal workspace
												</label>
												<div className={styles.placementActions}>
													<button
														type="button"
														className={styles.confirmBtn}
														disabled={isBusy}
														onClick={(e) => handleConfirmPlacement(e, activity)}
													>
														{isBusy ? 'Opening…' : 'Confirm & Open'}
													</button>
													<button
														type="button"
														className={styles.cancelBtn}
														disabled={isBusy}
														onClick={closePlacementPicker}
													>
														Cancel
													</button>
												</div>
											</div>
										)}

										<time className={styles.time} dateTime={activity.createdAt}>
											{formatRelativeTime(activity.createdAt)}
										</time>
									</div>

									<button
										type="button"
										className={styles.archiveBtn}
										title="Archive"
										onClick={(e) => { e.stopPropagation(); archiveActivity(e, activity.id); }}
										aria-label="Archive"
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
								{loadingMore ? 'Loading…' : 'Load more'}
							</button>
						)}
					</>
				)}
			</div>
		</div>
	);
}
