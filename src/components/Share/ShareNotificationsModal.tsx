import React from 'react';
import {
	acceptNoteShareInvitation,
	declineNoteShareInvitation,
	enqueuePendingNoteShareAction,
	listNoteShareInvitations,
	type NoteShareInvitation,
	type PendingNoteShareAction,
} from '../../core/noteShareApi';
import { useI18n } from '../../core/i18n';
import styles from './CollaborationModal.module.css';

type Props = {
	isOpen: boolean;
	onClose: () => void;
	authUserId: string | null;
	onChanged?: () => void;
	onAcceptedPlacement?: (args: { target: 'personal' | 'shared'; targetWorkspaceId: string; folderName: string | null }) => void;
};

type PlacementChoice = 'personal' | 'shared-root' | 'shared-folder';

const HIDDEN_NOTIFICATIONS_KEY_PREFIX = 'freemannotes.shareNotifications.hidden.v1:';

function hiddenNotificationsKey(userId: string): string {
	return `${HIDDEN_NOTIFICATIONS_KEY_PREFIX}${userId}`;
}

function readHiddenNotificationIds(userId: string | null): Set<string> {
	// Keep dismissed non-pending notifications out of the list locally without
	// mutating invitation history on the server.
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
		// Ignore persistence failures; clear-history is best effort.
	}
}

function normalizeInvitation(invitation: NoteShareInvitation): NoteShareInvitation {
	// Older cached payloads may be missing newer optional fields like noteTitle or
	// inviter.profileImage, so the modal normalizes them before rendering cards.
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
	const statusLabels: Record<NoteShareInvitation['status'], string> = {
		PENDING: t('share.statusPending'),
		ACCEPTED: t('share.statusAccepted'),
		DECLINED: t('share.statusDeclined'),
		REVOKED: t('share.statusRevoked'),
	};
	const [busyId, setBusyId] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [invitations, setInvitations] = React.useState<NoteShareInvitation[]>([]);
	const [acceptingId, setAcceptingId] = React.useState<string | null>(null);
	const [placementChoiceByInvitationId, setPlacementChoiceByInvitationId] = React.useState<Record<string, PlacementChoice>>({});
	const [folderByInvitationId, setFolderByInvitationId] = React.useState<Record<string, string>>({});
	const [hiddenInvitationIds, setHiddenInvitationIds] = React.useState<Set<string>>(() => readHiddenNotificationIds(props.authUserId));

	React.useEffect(() => {
		setHiddenInvitationIds(readHiddenNotificationIds(props.authUserId));
	}, [props.authUserId]);

	const load = React.useCallback(async () => {
		setError(null);
		try {
			// Revoked invites are filtered defensively here even though the backend also
			// excludes them. That keeps stale cached payloads from resurfacing revoked rows.
			const data = await listNoteShareInvitations();
			setInvitations(
				data.invitations
					.filter((invitation) => invitation.status !== 'REVOKED' && !invitation.revokedAt)
					.map(normalizeInvitation)
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.loadFailed'));
		}
	}, [t]);

	React.useEffect(() => {
		if (!props.isOpen) return;
		void load();
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

	const clearableInvitationIds = React.useMemo(() => {
		return visibleInvitations.filter((invitation) => invitation.status !== 'PENDING').map((invitation) => invitation.id);
	}, [visibleInvitations]);

	const handleClearNotifications = React.useCallback(() => {
		if (!props.authUserId || clearableInvitationIds.length === 0) return;
		setHiddenInvitationIds((current) => {
			const next = new Set(current);
			for (const id of clearableInvitationIds) {
				next.add(id);
			}
			writeHiddenNotificationIds(props.authUserId, next);
			return next;
		});
	}, [clearableInvitationIds, props.authUserId]);

	const queueAction = React.useCallback((action: PendingNoteShareAction) => {
		// Offline accept/decline keeps the card state moving immediately and leaves the
		// actual API replay to App's connectivity reconciliation pass.
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
		// Placement choice is intentionally split into three UI options while still
		// mapping onto the server's two target kinds: personal, shared root, and shared
		// subfolder (the latter is shared + folderName).
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

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={styles.modal} role="dialog" aria-modal="true" aria-label={t('share.notifications')} onClick={(event) => event.stopPropagation()}>
				<button type="button" className={styles.cornerCloseButton} onClick={props.onClose} aria-label={t('common.close')}>
					✕
				</button>
				<header className={styles.header}>
					<div>
						<h2 className={styles.title}>{t('share.notifications')}</h2>
						<p className={styles.subtitle}>{t('share.notificationsSubtitle')}</p>
					</div>
				</header>

				<div className={styles.modalBody}>
					{error ? <div className={styles.error}>{error}</div> : null}
					{visibleInvitations.length === 0 ? <div className={styles.empty}>{t('share.noNotifications')}</div> : null}

					<div className={`${styles.section} ${styles.notificationList}`}>
					{visibleInvitations.map((invitation) => {
						const isPending = invitation.status === 'PENDING';
						const placementChoice = placementChoiceByInvitationId[invitation.id] || 'personal';
						const isAccepting = acceptingId === invitation.id;
						const inviterName = invitation.inviter?.name || invitation.inviter?.email || t('share.unknownInviter');
						const noteTitle = String(invitation.noteTitle || '').trim() || t('note.untitled');
						return (
							<div key={invitation.id} className={`${styles.notificationCard} ${styles.notificationCardCompact}`}>
								<div className={styles.notificationHeader}>
									{invitation.inviter?.profileImage ? (
										<img className={`${styles.notificationAvatar} ${styles.notificationAvatarCompact}`} src={invitation.inviter.profileImage} alt="" />
									) : (
										<div className={`${styles.notificationAvatarFallback} ${styles.notificationAvatarCompact}`} aria-hidden="true">
											{inviterName.slice(0, 1).toUpperCase()}
										</div>
									)}
									<div className={styles.notificationCopy}>
										<div className={styles.notificationSummaryRow}>
											<div className={`${styles.rowTitle} ${styles.notificationTitleCompact}`}>{inviterName}</div>
											<span className={styles.badge}>{statusLabels[invitation.status]}</span>
										</div>
										<div className={`${styles.rowMessage} ${styles.notificationMessageCompact}`}>
											{inviterName} {t('share.wantsToShare')} <strong>{noteTitle}</strong> {t('share.withYou')}
										</div>
										<div className={`${styles.rowMeta} ${styles.notificationMetaCompact}`}>{invitation.role === 'VIEWER' ? t('share.roleViewer') : t('share.roleEditor')}</div>
									</div>
								</div>
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
													<input
														className={styles.input}
														value={folderByInvitationId[invitation.id] || ''}
														onChange={(event) => setFolderByInvitationId((current) => ({ ...current, [invitation.id]: event.target.value }))}
														placeholder={t('share.folderPlaceholder')}
													/>
												) : null}
												<label className={styles.radioLabel}>
													<input type="radio" checked={placementChoice === 'personal'} onChange={() => setPlacementChoiceByInvitationId((current) => ({ ...current, [invitation.id]: 'personal' }))} />
													{t('share.placeInPersonal')}
												</label>
												<div className={styles.actionRow}>
													<button type="button" className={styles.primaryButton} onClick={() => void handleAccept(invitation)} disabled={busyId === invitation.id}>
														{t('share.accept')}
													</button>
													<button type="button" className={styles.secondaryButton} onClick={() => setAcceptingId(null)} disabled={busyId === invitation.id}>
														{t('common.cancel')}
													</button>
												</div>
											</div>
										) : (
											<div className={styles.actionRow}>
												<button type="button" className={styles.primaryButton} onClick={() => setAcceptingId(invitation.id)} disabled={busyId === invitation.id}>
													{t('share.accept')}
												</button>
												<button type="button" className={styles.secondaryButton} onClick={() => void handleDecline(invitation)} disabled={busyId === invitation.id}>
													{t('share.decline')}
												</button>
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
					<button type="button" className={styles.secondaryButton} onClick={handleClearNotifications} disabled={clearableInvitationIds.length === 0}>
						{t('share.clearNotifications')}
					</button>
				</div>
			</section>
		</div>
	);
}
