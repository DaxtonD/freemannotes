import React from 'react';
import {
	acceptNoteShareInvitation,
	declineNoteShareInvitation,
	enqueuePendingNoteShareAction,
	listNoteShareInvitations,
	type NoteShareInvitation,
	type PendingNoteShareAction,
} from '../../core/noteShareApi';
import {
	acceptWorkspacePendingInvite,
	declineWorkspacePendingInvite,
	listWorkspacePendingInvites,
	type WorkspacePendingInvite,
} from '../../core/workspaceInviteApi';
import { getWorkspaceMetadataChangedEventName } from '../../core/workspaceMetadataStore';
import { getCachedAvatarUrl } from '../../core/userAvatarCache';
import type { FailedNoteLinkRecord } from '../../core/noteLinkApi';
import type { FiredReminder } from '../../core/pushApi';
import { useI18n } from '../../core/i18n';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import styles from './CollaborationModal.module.css';

type Props = {
	isOpen: boolean;
	onClose: () => void;
	authUserId: string | null;
	failedLinkNotifications?: FailedNoteLinkRecord[];
	firedReminders?: FiredReminder[];
	pendingReminderCount?: number;
	onClearReminders?: () => void;
	onOpenReminder?: (reminder: FiredReminder) => void;
	hasAppUpdateNotification?: boolean;
	hasAppUpdatedNotification?: boolean;
	onApplyAppUpdate?: () => void;
	onDismissAppUpdate?: () => void;
	onDismissAppUpdated?: () => void;
	importCompletedNotification?: { count: number } | null;
	onDismissImportCompleted?: () => void;
	onChanged?: () => void;
	onAcceptedPlacement?: (args: { target: 'personal' | 'shared'; targetWorkspaceId: string; folderName: string | null }) => void;
	onAcceptedWorkspaceInvite?: (workspaceId: string) => void;
	onClearFailedLinks?: () => void;
	onOpenFailedLink?: (failure: FailedNoteLinkRecord) => void;
	inboxUnreadCount?: number;
	onOpenInbox?: () => void;
	/** Server-persisted "cleared" invitation notification IDs (UserPreference.dismissedShareInvitationIds), merged into the local hidden set so a cleared notification stays cleared even after a cache clear or on a different device. */
	serverDismissedInvitationIds?: Record<string, boolean>;
	/** Called with the invitation IDs just cleared so the parent can persist them server-side. */
	onPersistDismissedInvitationIds?: (ids: readonly string[]) => void;
};

type PlacementChoice = 'personal' | 'shared-root' | 'shared-folder';

const HIDDEN_NOTIFICATIONS_KEY_PREFIX = 'freemannotes.shareNotifications.hidden.v1:';

function isTransportLikeError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /failed to fetch|networkerror|load failed/i.test(message);
}

function hiddenNotificationsKey(userId: string): string {
	return `${HIDDEN_NOTIFICATIONS_KEY_PREFIX}${userId}`;
}

function readHiddenNotificationIds(userId: string | null): Set<string> {
	if (!userId || typeof window === 'undefined') return new Set();
	try {
		const raw = window.localStorage.getItem(hiddenNotificationsKey(userId));
		if (!raw) return new Set();
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0));
	} catch {
		return new Set();
	}
}

function writeHiddenNotificationIds(userId: string | null, ids: ReadonlySet<string>): void {
	if (!userId || typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(hiddenNotificationsKey(userId), JSON.stringify(Array.from(ids)));
	} catch {
		// Best effort only.
	}
}

function normalizeInvitation(invitation: NoteShareInvitation): NoteShareInvitation {
	return {
		...invitation,
		noteTitle: typeof invitation.noteTitle === 'string' ? invitation.noteTitle : '',
		inviter: invitation.inviter
			? {
				...invitation.inviter,
				profileImage: typeof invitation.inviter.profileImage === 'string' ? invitation.inviter.profileImage : null,
			}
			: null,
	};
}

export function ShareNotificationsModal(props: Props): React.JSX.Element | null {
	const { t } = useI18n();
	useBodyScrollLock(props.isOpen);
	const statusLabels: Record<NoteShareInvitation['status'], string> = {
		PENDING: t('share.statusPending'),
		ACCEPTED: t('share.statusAccepted'),
		DECLINED: t('share.statusDeclined'),
		REVOKED: t('share.statusRevoked'),
	};
	const statusClassNames: Record<NoteShareInvitation['status'], string> = {
		PENDING: styles.badgePending,
		ACCEPTED: styles.badgeAccepted,
		DECLINED: styles.badgeDeclined,
		REVOKED: styles.badgeDeclined,
	};
	const [busyId, setBusyId] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [invitations, setInvitations] = React.useState<NoteShareInvitation[]>([]);
	const [workspaceInvites, setWorkspaceInvites] = React.useState<WorkspacePendingInvite[]>([]);
	const [acceptingId, setAcceptingId] = React.useState<string | null>(null);
	const [placementChoiceByInvitationId, setPlacementChoiceByInvitationId] = React.useState<Record<string, PlacementChoice>>({});
	const [folderByInvitationId, setFolderByInvitationId] = React.useState<Record<string, string>>({});
	const [hiddenInvitationIds, setHiddenInvitationIds] = React.useState<Set<string>>(() => readHiddenNotificationIds(props.authUserId));
	const failedLinkNotifications = React.useMemo(() => Array.isArray(props.failedLinkNotifications) ? props.failedLinkNotifications : [], [props.failedLinkNotifications]);
	const firedReminders = React.useMemo(() => Array.isArray(props.firedReminders) ? props.firedReminders : [], [props.firedReminders]);
	const hasAppUpdate = props.hasAppUpdateNotification === true;
	const hasAppUpdated = props.hasAppUpdatedNotification === true;

	React.useEffect(() => {
		// "Clear notifications" used to only ever write to localStorage. Clear your browser
		// cache (or just get unlucky with storage eviction) and every notification you'd
		// already dismissed comes back from the dead like nothing happened — because as far
		// as the server was concerned, nothing HAD happened, we never told it. Merge in the
		// server-persisted dismissed set (UserPreference.dismissedShareInvitationIds)
		// alongside the local localStorage cache, so a notification cleared on this device
		// (or a different one entirely) actually stays cleared.
		const local = readHiddenNotificationIds(props.authUserId);
		const serverIds = props.serverDismissedInvitationIds;
		if (serverIds && Object.keys(serverIds).length > 0) {
			const merged = new Set(local);
			for (const id of Object.keys(serverIds)) merged.add(id);
			if (merged.size !== local.size) {
				writeHiddenNotificationIds(props.authUserId, merged);
			}
			setHiddenInvitationIds(merged);
			return;
		}
		setHiddenInvitationIds(local);
	}, [props.authUserId, props.serverDismissedInvitationIds]);

	const load = React.useCallback(async () => {
		setError(null);
		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			setInvitations([]);
			setWorkspaceInvites([]);
			setError(t('share.notificationsDisabledOffline'));
			return;
		}
		try {
			const [noteData, workspaceData] = await Promise.all([
				listNoteShareInvitations(),
				listWorkspacePendingInvites(),
			]);
			setInvitations(
				noteData.invitations
					.filter((invitation) => invitation.status !== 'REVOKED' && !invitation.revokedAt)
					.map(normalizeInvitation)
			);
			setWorkspaceInvites(workspaceData.invites);
		} catch (err) {
			if (isTransportLikeError(err)) {
				setInvitations([]);
				setWorkspaceInvites([]);
				setError(t('share.notificationsDisabledOffline'));
				return;
			}
			setError(err instanceof Error ? err.message : t('share.loadFailed'));
		}
	}, [t]);

	React.useEffect(() => {
		if (!props.isOpen) return;
		void load();
	}, [load, props.isOpen]);

	React.useEffect(() => {
		if (!props.isOpen || typeof window === 'undefined') return;
		const eventName = getWorkspaceMetadataChangedEventName();
		// Keep the panel live while it is open so revoked/cancelled invitations drop
		// out immediately when another tab or modal changes workspace metadata.
		// Only reload for events that actually affect the notification panel contents:
		// workspace invite changes, note-share invite changes, and profile updates.
		const onMetadataChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ reason?: string }>).detail;
			const reason = detail?.reason;
			if (reason &&
				!reason.startsWith('workspace-invite-') &&
				!reason.startsWith('note-share-') &&
				reason !== 'user-profile-updated'
			) return;
			void load();
		};
		window.addEventListener(eventName, onMetadataChanged as EventListener);
		return () => {
			window.removeEventListener(eventName, onMetadataChanged as EventListener);
		};
	}, [load, props.isOpen]);

	React.useEffect(() => {
		if (props.isOpen) return;
		setAcceptingId(null);
		setError(null);
	}, [props.isOpen]);

	const updateInvitation = React.useCallback((invitationId: string, updater: (invitation: NoteShareInvitation) => NoteShareInvitation): void => {
		setInvitations((current) => current.map((invitation) => invitation.id === invitationId ? normalizeInvitation(updater(invitation)) : invitation));
	}, []);

	const visibleInvitations = React.useMemo(() => {
		return invitations.filter((invitation) => invitation.status === 'PENDING' || !hiddenInvitationIds.has(invitation.id));
	}, [hiddenInvitationIds, invitations]);
	const hasWorkspaceInvites = workspaceInvites.length > 0;
	const hasNoteInvites = visibleInvitations.length > 0;
	const hasFailedLinks = failedLinkNotifications.length > 0;
	const hasFiredReminders = firedReminders.length > 0;
	const inboxUnreadCount = props.inboxUnreadCount ?? 0;
	const hasInboxUnread = inboxUnreadCount > 0;
	// Use the authoritative pending count too, because reminder rows can be stale
	// on mobile/PWA while the badge count is already non-zero.
	const hasPendingReminderNotifications = (props.pendingReminderCount ?? 0) > 0;
	const hasImportCompleted = Boolean(props.importCompletedNotification);
	const hasAnyShareNotifications = hasWorkspaceInvites || hasNoteInvites || hasFailedLinks || hasFiredReminders || hasPendingReminderNotifications || hasInboxUnread;
	const hasAppNotification = hasAppUpdate || hasAppUpdated || hasImportCompleted;
	const modalTitle = t('share.notifications');
	const modalSubtitle = hasAppNotification ? t('prefs.notificationsSubtitle') : t('share.notificationsSubtitle');
	const emptyStateLabel = t('share.noNotifications');

	const clearableInvitationIds = React.useMemo(() => {
		return visibleInvitations.filter((invitation) => invitation.status !== 'PENDING').map((invitation) => invitation.id);
	}, [visibleInvitations]);
	// Failed link-preview notifications are now treated as clearable items so the
	// "Clear notifications" footer button is enabled when they are the only content.
	const canClearNotifications = clearableInvitationIds.length > 0 || firedReminders.length > 0 || hasPendingReminderNotifications || hasFailedLinks;

	const getWorkspaceRoleLabel = React.useCallback((role: WorkspacePendingInvite['role']): string => {
		if (role === 'ADMIN') return t('invite.roleAdmin');
		if (role === 'EDITOR') return t('invite.roleEditor');
		return t('invite.roleViewer');
	}, [t]);

	const handleClearNotifications = React.useCallback(() => {
		if (props.authUserId && clearableInvitationIds.length > 0) {
			setHiddenInvitationIds((current) => {
				const next = new Set(current);
				for (const id of clearableInvitationIds) next.add(id);
				writeHiddenNotificationIds(props.authUserId, next);
				return next;
			});
			// Also persist server-side (UserPreference.dismissedShareInvitationIds) so this
			// stays cleared across a cache clear or on a different device — see the merge
			// effect above.
			props.onPersistDismissedInvitationIds?.(clearableInvitationIds);
		}
		if (firedReminders.length > 0 || hasPendingReminderNotifications) {
			props.onClearReminders?.();
		}
		if (hasFailedLinks) {
			// Notify the parent so it can clear failedLinkNotifications state,
			// which removes the notification badge and hides the failed items.
			props.onClearFailedLinks?.();
		}
	}, [clearableInvitationIds, firedReminders.length, hasFailedLinks, hasPendingReminderNotifications, props]);

	const queueAction = React.useCallback((action: PendingNoteShareAction) => {
		enqueuePendingNoteShareAction(action);
		updateInvitation(action.invitationId, (invitation) => ({
			...invitation,
			status: action.action === 'decline' ? 'DECLINED' : 'ACCEPTED',
			respondedAt: new Date().toISOString(),
			placement: action.action === 'accept'
				? {
					id: invitation.placement?.id || `queued:${action.invitationId}`,
					targetWorkspaceId: '',
					folderName: action.folderName,
					deletedAt: null,
				}
				: invitation.placement,
		}));
		props.onChanged?.();
	}, [props, updateInvitation]);

	const handleDecline = React.useCallback(async (invitation: NoteShareInvitation) => {
		if (!props.authUserId) return;
		setBusyId(invitation.id);
		setError(null);
		const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
		try {
			if (isOffline) {
				queueAction({
					id: `decline:${invitation.id}`,
					userId: props.authUserId,
					invitationId: invitation.id,
					action: 'decline',
					target: 'personal',
					folderName: null,
					createdAt: new Date().toISOString(),
				});
				return;
			}
			const result = await declineNoteShareInvitation(invitation.id);
			updateInvitation(invitation.id, () => result.invitation);
			props.onChanged?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.declineFailed'));
		} finally {
			setBusyId(null);
		}
	}, [props, queueAction, t, updateInvitation]);

	const handleAccept = React.useCallback(async (invitation: NoteShareInvitation) => {
		if (!props.authUserId) return;
		setBusyId(invitation.id);
		setError(null);
		const placementChoice = placementChoiceByInvitationId[invitation.id] || 'personal';
		const target = placementChoice === 'personal' ? 'personal' : 'shared';
		const folderName = placementChoice === 'shared-folder' ? (folderByInvitationId[invitation.id] || '').trim() : '';
		const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
		try {
			if (isOffline) {
				queueAction({
					id: `accept:${invitation.id}`,
					userId: props.authUserId,
					invitationId: invitation.id,
					action: 'accept',
					target,
					folderName: folderName || null,
					createdAt: new Date().toISOString(),
				});
				setAcceptingId(null);
				return;
			}
			const result = await acceptNoteShareInvitation(invitation.id, { target, folderName: folderName || undefined });
			updateInvitation(invitation.id, () => result.invitation);
			setAcceptingId(null);
			props.onAcceptedPlacement?.({
				target,
				targetWorkspaceId: result.placement.targetWorkspaceId,
				folderName: result.placement.folderName,
			});
			props.onChanged?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.acceptFailed'));
		} finally {
			setBusyId(null);
		}
	}, [folderByInvitationId, placementChoiceByInvitationId, props, queueAction, t, updateInvitation]);

	const handleAcceptWorkspaceInvite = React.useCallback(async (invite: WorkspacePendingInvite) => {
		setBusyId(`workspace:${invite.id}`);
		setError(null);
		try {
			const result = await acceptWorkspacePendingInvite(invite.id);
			setWorkspaceInvites((current) => current.filter((item) => item.id !== invite.id));
			props.onAcceptedWorkspaceInvite?.(result.workspaceId);
			props.onChanged?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : t('invite.acceptFailed'));
		} finally {
			setBusyId(null);
		}
	}, [props, t]);

	const handleDeclineWorkspaceInvite = React.useCallback(async (invite: WorkspacePendingInvite) => {
		setBusyId(`workspace:${invite.id}`);
		setError(null);
		try {
			await declineWorkspacePendingInvite(invite.id);
			setWorkspaceInvites((current) => current.filter((item) => item.id !== invite.id));
			props.onChanged?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : t('invite.acceptFailed'));
		} finally {
			setBusyId(null);
		}
	}, [props, t]);

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={styles.modal} role="dialog" aria-modal="true" aria-label={modalTitle} onClick={(event) => event.stopPropagation()}>
				<button type="button" className={styles.cornerCloseButton} onClick={props.onClose} aria-label={t('common.close')}>
					✕
				</button>
				<header className={styles.header}>
					<div>
						<h2 className={styles.title}>{modalTitle}</h2>
						<p className={styles.subtitle}>{modalSubtitle}</p>
					</div>
				</header>

				<div className={styles.modalBody}>
					{error ? <div className={styles.error}>{error}</div> : null}
				{visibleInvitations.length === 0 && workspaceInvites.length === 0 && failedLinkNotifications.length === 0 && firedReminders.length === 0 && !hasAppNotification ? <div className={styles.empty}>{emptyStateLabel}</div> : null}

				{hasInboxUnread ? (
					<div className={`${styles.section} ${styles.notificationList} ${styles.inboxSummarySection}`}>
						<div className={`${styles.notificationCard} ${styles.notificationCardCompact}`}>
							<div className={styles.notificationHeader}>
								<div className={`${styles.notificationAvatarFallback} ${styles.notificationAvatarCompact}`} aria-hidden="true">
									@
								</div>
								<div className={styles.notificationCopy}>
									<div className={`${styles.rowMessage} ${styles.notificationMessageCompact}`}>
										<strong>
											{inboxUnreadCount === 1
												? t('share.inboxUnreadOne')
												: t('share.inboxUnreadMany').replace('{count}', String(inboxUnreadCount))}
										</strong>
									</div>
									<div className={`${styles.rowMeta} ${styles.notificationMetaCompact}`}>
										{t('share.inboxUnreadSubtitle')}
									</div>
								</div>
							</div>
							<div className={styles.actionRow}>
								<button
									type="button"
									className={styles.primaryButton}
									onClick={() => { props.onOpenInbox?.(); props.onClose(); }}
								>
									{t('share.openInbox')}
								</button>
							</div>
						</div>
					</div>
				) : null}

				{hasFiredReminders ? (
					<div className={`${styles.section} ${styles.notificationList}`}>
						{firedReminders.map((reminder) => {
							const noteTitle = (typeof reminder.noteTitle === 'string' && reminder.noteTitle.trim()) || 'Untitled note';
							const dueTime = new Date(reminder.reminderAt).toLocaleString();
							return (
								<div key={reminder.id} className={`${styles.notificationCard} ${styles.notificationCardCompact}`}>
									<div className={styles.notificationHeader}>
										<div className={`${styles.notificationAvatarFallback} ${styles.notificationAvatarCompact}`} aria-hidden="true">
											⏰
										</div>
										<div className={styles.notificationCopy}>
											<div className={`${styles.rowMessage} ${styles.notificationMessageCompact}`}>
												<strong>{noteTitle}</strong>
											</div>
											<div className={`${styles.rowMeta} ${styles.notificationMetaCompact}`}>
												{dueTime}
											</div>
										</div>
									</div>
									<div className={styles.actionRow}>
										<button type="button" className={styles.primaryButton} onClick={() => props.onOpenReminder?.(reminder)}>
											Open note
										</button>
									</div>
								</div>
							);
						})}
					</div>
				) : null}

					{hasAppUpdate ? (
						<div className={`${styles.section} ${styles.notificationList}`}>
							<div className={`${styles.notificationCard} ${styles.notificationCardCompact}`}>
								<div className={styles.notificationHeader}>
									<div className={`${styles.notificationAvatarFallback} ${styles.notificationAvatarCompact}`} aria-hidden="true">
										↻
									</div>
									<div className={styles.notificationCopy}>
										<div className={`${styles.rowMessage} ${styles.notificationMessageCompact}`}>
											<strong>{t('prefs.updateNotificationTitle')}</strong>
										</div>
										<div className={`${styles.rowMeta} ${styles.notificationMetaCompact}`}>
											{t('prefs.updateNotificationBody')}
										</div>
									</div>
									<div className={styles.notificationStatusWrap}>
										<span className={`${styles.badge} ${styles.badgePending}`}>{t('prefs.updateAvailableBadge')}</span>
									</div>
								</div>
								<div className={styles.actionRow}>
									<button type="button" className={styles.primaryButton} onClick={props.onApplyAppUpdate}>
										{t('prefs.updateNow')}
									</button>
									<button type="button" className={styles.secondaryButton} onClick={props.onDismissAppUpdate}>
										{t('common.close')}
									</button>
								</div>
							</div>
						</div>
					) : null}

					{hasAppUpdated ? (
						<div className={`${styles.section} ${styles.notificationList}`}>
							<div className={`${styles.notificationCard} ${styles.notificationCardCompact}`}>
								<div className={styles.notificationHeader}>
									<div className={`${styles.notificationAvatarFallback} ${styles.notificationAvatarCompact}`} aria-hidden="true">
										✓
									</div>
									<div className={styles.notificationCopy}>
										<div className={`${styles.rowMessage} ${styles.notificationMessageCompact}`}>
											<strong>{t('prefs.updatedNotificationTitle')}</strong>
										</div>
										<div className={`${styles.rowMeta} ${styles.notificationMetaCompact}`}>
											{t('prefs.updatedNotificationBody')}
										</div>
									</div>
									<div className={styles.notificationStatusWrap}>
										<span className={`${styles.badge} ${styles.badgeAccepted}`}>{t('prefs.updatedBadge')}</span>
									</div>
								</div>
								<div className={styles.actionRow}>
									<button type="button" className={styles.primaryButton} onClick={props.onDismissAppUpdated}>
										{t('common.close')}
									</button>
								</div>
							</div>
						</div>
					) : null}

					{hasImportCompleted ? (
						<div className={`${styles.section} ${styles.notificationList}`}>
							<div className={`${styles.notificationCard} ${styles.notificationCardCompact}`}>
								<div className={styles.notificationHeader}>
									<div className={`${styles.notificationAvatarFallback} ${styles.notificationAvatarCompact}`} aria-hidden="true">
										✓
									</div>
									<div className={styles.notificationCopy}>
										<div className={`${styles.rowMessage} ${styles.notificationMessageCompact}`}>
											<strong>{t('importExport.importNotificationTitle')}</strong>
										</div>
										<div className={`${styles.rowMeta} ${styles.notificationMetaCompact}`}>
											{props.importCompletedNotification!.count === 1
												? t('importExport.importSuccessSingular').replace('{count}', '1')
												: t('importExport.importSuccessPlural').replace('{count}', String(props.importCompletedNotification!.count))}
										</div>
									</div>
									<div className={styles.notificationStatusWrap}>
										<span className={`${styles.badge} ${styles.badgeAccepted}`}>{t('importExport.importCompleteBadge')}</span>
									</div>
								</div>
								<div className={styles.actionRow}>
									<button type="button" className={styles.primaryButton} onClick={props.onDismissImportCompleted}>
										{t('common.close')}
									</button>
								</div>
							</div>
						</div>
					) : null}

					{failedLinkNotifications.length > 0 ? (
						<div className={`${styles.section} ${styles.notificationList}`}>
							{failedLinkNotifications.map((failure) => (
								<div key={failure.id} className={`${styles.notificationCard} ${styles.notificationCardCompact}`}>
									<div className={styles.notificationHeader}>
										<div className={`${styles.notificationAvatarFallback} ${styles.notificationAvatarCompact}`} aria-hidden="true">
											!
										</div>
										<div className={styles.notificationCopy}>
											<div className={`${styles.rowMessage} ${styles.notificationMessageCompact}`}>
												<strong>{failure.noteTitle}</strong> {t('links.notificationMessage')}
											</div>
											<div className={`${styles.rowMeta} ${styles.notificationMetaCompact}`}>
												{failure.rootDomain} · {failure.errorMessage}
											</div>
										</div>
									</div>
									<div className={styles.actionRow}>
										<button type="button" className={styles.primaryButton} onClick={() => props.onOpenFailedLink?.(failure)}>
											{t('links.openNote')}
										</button>
									</div>
								</div>
							))}
						</div>
					) : null}

					<div className={`${styles.section} ${styles.notificationList}`}>
						{workspaceInvites.map((invite) => {
							const inviterName = invite.inviter?.name || invite.inviter?.email || t('share.unknownInviter');
							return (
								<div key={invite.id} className={`${styles.notificationCard} ${styles.notificationCardCompact}`}>
									<div className={styles.notificationHeader}>
										<div className={`${styles.notificationAvatarFallback} ${styles.notificationAvatarCompact}`} aria-hidden="true">
											{inviterName.slice(0, 1).toUpperCase()}
										</div>
										<div className={styles.notificationCopy}>
											<div className={`${styles.rowMessage} ${styles.notificationMessageCompact}`}>
												<strong>{t('invite.joinWorkspaceLabel')}:</strong> {invite.workspaceName}
											</div>
											<div className={`${styles.rowMeta} ${styles.notificationMetaCompact}`}>
												{t('share.fromLabel')}: {inviterName} · {getWorkspaceRoleLabel(invite.role)}
											</div>
										</div>
										<div className={styles.notificationStatusWrap}>
											<span className={`${styles.badge} ${styles.badgePending}`}>{t('invite.statePending')}</span>
										</div>
									</div>
									<div className={`${styles.rowMeta} ${styles.notificationMetaCompact}`}>{t('invite.expiresAt')}: {new Date(invite.expiresAt).toLocaleString()}</div>
									<div className={styles.actionRow}>
										<button type="button" className={styles.primaryButton} onClick={() => void handleAcceptWorkspaceInvite(invite)} disabled={busyId === `workspace:${invite.id}`}>
											{t('share.accept')}
										</button>
										<button type="button" className={styles.secondaryButton} onClick={() => void handleDeclineWorkspaceInvite(invite)} disabled={busyId === `workspace:${invite.id}`}>
											{t('share.decline')}
										</button>
									</div>
								</div>
							);
						})}

						{visibleInvitations.map((invitation) => {
							const isPending = invitation.status === 'PENDING';
							const placementChoice = placementChoiceByInvitationId[invitation.id] || 'personal';
							const isAccepting = acceptingId === invitation.id;
							const inviterName = invitation.inviter?.name || invitation.inviter?.email || t('share.unknownInviter');
							const noteTitle = String(invitation.noteTitle || '').trim() || t('note.untitled');
							const roleLabel = invitation.role === 'VIEWER' ? t('share.roleViewer') : t('share.roleEditor');
							return (
								<div key={invitation.id} className={`${styles.notificationCard} ${styles.notificationCardCompact}`}>
									<div className={styles.notificationHeader}>
							{(invitation.inviter?.profileImage ?? getCachedAvatarUrl(invitation.inviter?.id)) ? (
								<img className={`${styles.notificationAvatar} ${styles.notificationAvatarCompact}`} src={invitation.inviter?.profileImage ?? getCachedAvatarUrl(invitation.inviter?.id) ?? undefined} alt="" />
										) : (
											<div className={`${styles.notificationAvatarFallback} ${styles.notificationAvatarCompact}`} aria-hidden="true">
												{inviterName.slice(0, 1).toUpperCase()}
											</div>
										)}
										<div className={styles.notificationCopy}>
											<div className={`${styles.rowMessage} ${styles.notificationMessageCompact}`}>
												<strong>{t('share.joinNoteLabel')}:</strong> {noteTitle}
											</div>
											<div className={`${styles.rowMeta} ${styles.notificationMetaCompact}`}>{t('share.fromLabel')}: {inviterName} · {roleLabel}</div>
										</div>
										<div className={styles.notificationStatusWrap}>
											<span className={`${styles.badge} ${statusClassNames[invitation.status]}`}>{statusLabels[invitation.status]}</span>
										</div>
									</div>
									<div className={`${styles.rowMeta} ${styles.notificationMetaCompact}`}>{t('share.sharedAt')}: {new Date(invitation.createdAt).toLocaleString()}</div>
									{isPending ? (
										<>
											{isAccepting ? (
												<div className={styles.acceptBox}>
													<label className={styles.radioLabel}>
														<input type="radio" checked={placementChoice === 'shared-root'} onChange={() => setPlacementChoiceByInvitationId((current) => ({ ...current, [invitation.id]: 'shared-root' }))} />
														{t('share.placeInSharedWithMeRoot')}
													</label>
													<label className={styles.radioLabel}>
														<input type="radio" checked={placementChoice === 'shared-folder'} onChange={() => setPlacementChoiceByInvitationId((current) => ({ ...current, [invitation.id]: 'shared-folder' }))} />
														{t('share.placeInSharedWithMeFolder')}
													</label>
													{placementChoice === 'shared-folder' ? (
														<input className={styles.input} value={folderByInvitationId[invitation.id] || ''} onChange={(event) => setFolderByInvitationId((current) => ({ ...current, [invitation.id]: event.target.value }))} placeholder={t('share.folderPlaceholder')} />
													) : null}
													<label className={styles.radioLabel}>
														<input type="radio" checked={placementChoice === 'personal'} onChange={() => setPlacementChoiceByInvitationId((current) => ({ ...current, [invitation.id]: 'personal' }))} />
														{t('share.placeInPersonal')}
													</label>
													<div className={styles.actionRow}>
														<button type="button" className={styles.primaryButton} onClick={() => void handleAccept(invitation)} disabled={busyId === invitation.id}>{t('share.accept')}</button>
														<button type="button" className={styles.secondaryButton} onClick={() => setAcceptingId(null)} disabled={busyId === invitation.id}>{t('common.cancel')}</button>
													</div>
												</div>
											) : (
												<div className={styles.actionRow}>
													<button type="button" className={styles.primaryButton} onClick={() => setAcceptingId(invitation.id)} disabled={busyId === invitation.id}>{t('share.accept')}</button>
													<button type="button" className={styles.secondaryButton} onClick={() => void handleDecline(invitation)} disabled={busyId === invitation.id}>{t('share.decline')}</button>
												</div>
											)}
										</>
									) : null}
								</div>
							);
						})}
					</div>
				</div>

				{hasAnyShareNotifications ? (
					<div className={styles.modalFooter}>
						<button type="button" className={styles.secondaryButton} onClick={handleClearNotifications} disabled={!canClearNotifications}>
							{t('share.clearNotifications')}
						</button>
					</div>
				) : null}
			</section>
		</div>
	);
}
