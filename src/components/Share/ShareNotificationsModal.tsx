import React from 'react';
import {
	acceptNoteShareInvitation,
	declineNoteShareInvitation,
	enqueuePendingNoteShareAction,
	isNetworkUnavailableError,
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
};

type PlacementChoice = 'personal' | 'shared-root' | 'shared-folder';

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
	// Rendered as an info strip, not a red error: being unable to reach the server is a
	// state the app is designed for, not a fault the user needs to act on.
	const [notice, setNotice] = React.useState<string | null>(null);
	const [invitations, setInvitations] = React.useState<NoteShareInvitation[]>([]);
	const [workspaceInvites, setWorkspaceInvites] = React.useState<WorkspacePendingInvite[]>([]);
	const [acceptingId, setAcceptingId] = React.useState<string | null>(null);
	const [placementChoiceByInvitationId, setPlacementChoiceByInvitationId] = React.useState<Record<string, PlacementChoice>>({});
	const [folderByInvitationId, setFolderByInvitationId] = React.useState<Record<string, string>>({});
	const failedLinkNotifications = React.useMemo(() => Array.isArray(props.failedLinkNotifications) ? props.failedLinkNotifications : [], [props.failedLinkNotifications]);
	const firedReminders = React.useMemo(() => Array.isArray(props.firedReminders) ? props.firedReminders : [], [props.firedReminders]);
	const hasAppUpdate = props.hasAppUpdateNotification === true;
	const hasAppUpdated = props.hasAppUpdatedNotification === true;

	const load = React.useCallback(async () => {
		setError(null);
		setNotice(null);
		// Whatever we already have on screen is the best answer available when the
		// server can't be reached — so never blank the lists out. They used to be
		// cleared to [] on every offline path, which turned "we can't check right now"
		// into a confident and wrong "you have no invitations".
		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			setNotice(t('share.notificationsDisabledOffline'));
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
			if (isNetworkUnavailableError(err)) {
				setNotice(t('share.notificationsDisabledOffline'));
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

	// Pending only. This panel is the list of things you owe someone an answer to, so
	// answering one is what removes it — an accepted/declined row lingering here with a
	// status badge is the inbox's job now, and having both was the whole complaint:
	// one event, two notifications, side by side.
	const visibleInvitations = React.useMemo(() => {
		return invitations.filter((invitation) => invitation.status === 'PENDING');
	}, [invitations]);
	const hasWorkspaceInvites = workspaceInvites.length > 0;
	const hasNoteInvites = visibleInvitations.length > 0;
	const hasFailedLinks = failedLinkNotifications.length > 0;
	const hasFiredReminders = firedReminders.length > 0;
	// Read for the footer link only. The inbox is a separate surface with its own
	// badge; counting it here made one event show up as two notifications side by side.
	const inboxUnreadCount = props.inboxUnreadCount ?? 0;
	// Use the authoritative pending count too, because reminder rows can be stale
	// on mobile/PWA while the badge count is already non-zero.
	const hasPendingReminderNotifications = (props.pendingReminderCount ?? 0) > 0;
	const hasImportCompleted = Boolean(props.importCompletedNotification);
	const hasAnyShareNotifications = hasWorkspaceInvites || hasNoteInvites || hasFailedLinks || hasFiredReminders || hasPendingReminderNotifications;
	const hasAppNotification = hasAppUpdate || hasAppUpdated || hasImportCompleted;
	const modalTitle = t('share.notifications');
	const modalSubtitle = hasAppNotification ? t('prefs.notificationsSubtitle') : t('share.notificationsSubtitle');
	const emptyStateLabel = t('share.noNotifications');

	// "Clear notifications" may only act on what is actually on screen.
	//
	// It used to sweep up every answered invitation the API returned. That was fine when
	// the panel listed them with an Accepted/Declined badge; it stopped being fine when
	// the bell became pending-only, because listNoteShareInvitations still returns those
	// answered rows. The button then sat enabled with nothing visibly clearable, and
	// pressing it silently marked invitations dismissed that the user could not see —
	// and their record lives in the inbox now regardless, so hiding them here achieved
	// nothing except a button that lies about what it does.
	const canClearNotifications = firedReminders.length > 0 || hasPendingReminderNotifications || hasFailedLinks;

	const getWorkspaceRoleLabel = React.useCallback((role: WorkspacePendingInvite['role']): string => {
		if (role === 'ADMIN') return t('invite.roleAdmin');
		if (role === 'EDITOR') return t('invite.roleEditor');
		return t('invite.roleViewer');
	}, [t]);

	const handleClearNotifications = React.useCallback(() => {
		if (firedReminders.length > 0 || hasPendingReminderNotifications) {
			props.onClearReminders?.();
		}
		if (hasFailedLinks) {
			// Notify the parent so it can clear failedLinkNotifications state,
			// which removes the notification badge and hides the failed items.
			props.onClearFailedLinks?.();
		}
	}, [firedReminders.length, hasFailedLinks, hasPendingReminderNotifications, props]);

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
		const queueThisDecline = () => {
			queueAction({
				id: `decline:${invitation.id}`,
				userId: props.authUserId as string,
				invitationId: invitation.id,
				action: 'decline',
				target: 'personal',
				folderName: null,
				createdAt: new Date().toISOString(),
			});
			setNotice(t('share.acceptQueuedOffline'));
		};
		const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
		try {
			if (isOffline) {
				queueThisDecline();
				return;
			}
			const result = await declineNoteShareInvitation(invitation.id);
			updateInvitation(invitation.id, () => result.invitation);
			props.onChanged?.();
		} catch (err) {
			// Same reasoning as handleAccept: a bad network is not a refusal.
			if (isNetworkUnavailableError(err)) {
				queueThisDecline();
				return;
			}
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
		const queueThisAccept = () => {
			queueAction({
				id: `accept:${invitation.id}`,
				userId: props.authUserId as string,
				invitationId: invitation.id,
				action: 'accept',
				target,
				folderName: folderName || null,
				createdAt: new Date().toISOString(),
			});
			setAcceptingId(null);
			setNotice(t('share.declineQueuedOffline'));
		};
		const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
		try {
			if (isOffline) {
				queueThisAccept();
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
			// Accepting is not allowed to fail just because the network is bad. navigator.onLine
			// only knows about having *an* interface up, so a throttled or half-dead connection
			// took the online path, timed out, and threw a raw "signal is aborted without reason"
			// at someone who had simply tapped Accept. Anything that means "couldn't reach the
			// server" now lands in the same queue as a deliberate offline accept and replays on
			// reconnect. The endpoint upserts the collaborator and placement, so a request that
			// actually did land before the client gave up replays harmlessly.
			if (isNetworkUnavailableError(err)) {
				queueThisAccept();
				return;
			}
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
					{notice ? <div className={styles.info}>{notice}</div> : null}
				{visibleInvitations.length === 0 && workspaceInvites.length === 0 && failedLinkNotifications.length === 0 && firedReminders.length === 0 && !hasAppNotification ? <div className={styles.empty}>{emptyStateLabel}</div> : null}

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

				<div className={styles.modalFooter}>
					{props.onOpenInbox ? (
						<button
							type="button"
							className={styles.footerLink}
							onClick={() => { props.onOpenInbox?.(); props.onClose(); }}
						>
							{t('share.viewAllActivity')}
							{inboxUnreadCount > 0 ? (
								<> <span className={styles.footerLinkCount}>{inboxUnreadCount > 99 ? '99+' : inboxUnreadCount}</span></>
							) : null}
						</button>
					) : <span />}
					{hasAnyShareNotifications ? (
						<button type="button" className={styles.secondaryButton} onClick={handleClearNotifications} disabled={!canClearNotifications}>
							{t('share.clearNotifications')}
						</button>
					) : null}
				</div>
			</section>
		</div>
	);
}
