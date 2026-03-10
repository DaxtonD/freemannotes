import React from 'react';
import {
	createNoteShareInvitation,
	flushPendingCollaboratorActions,
	queueNoteShareCollaboratorInviteAction,
	queueNoteShareCollaboratorRevokeAction,
	queueNoteShareCollaboratorRoleAction,
	readCachedNoteShareCollaborators,
	readPendingCollaboratorActions,
	revokeNoteShareCollaborator,
	syncNoteShareCollaborators,
	updateNoteShareCollaboratorRole,
	type NoteShareCollaboratorSnapshot,
	type NoteShareRole,
} from '../../core/noteShareApi';
import { useI18n } from '../../core/i18n';
import styles from './CollaborationModal.module.css';

type Props = {
	isOpen: boolean;
	onClose: () => void;
	authUserId: string | null;
	docId: string | null;
	offlineCanManageHint?: boolean;
	noteTitle: string;
	onChanged?: () => void;
	refreshToken?: number;
};

const EMPTY_SNAPSHOT: NoteShareCollaboratorSnapshot = {
	roomId: '',
	sourceWorkspaceId: '',
	sourceNoteId: '',
	accessRole: 'EDITOR',
	canManage: false,
	currentUserId: null,
	selfCollaboratorId: null,
	sharedBy: null,
	collaborators: [],
	pendingInvitations: [],
};

function buildOfflineManagerSnapshot(authUserId: string, docId: string, base?: NoteShareCollaboratorSnapshot | null): NoteShareCollaboratorSnapshot {
	return {
		roomId: base?.roomId || docId,
		sourceWorkspaceId: base?.sourceWorkspaceId || docId.split(':', 1)[0] || '',
		sourceNoteId: base?.sourceNoteId || (docId.includes(':') ? docId.slice(docId.indexOf(':') + 1) : docId),
		accessRole: base?.accessRole || 'EDITOR',
		canManage: true,
		currentUserId: base?.currentUserId ?? authUserId,
		selfCollaboratorId: base?.selfCollaboratorId ?? null,
		sharedBy: base?.sharedBy ?? null,
		collaborators: base?.collaborators ?? [],
		pendingInvitations: base?.pendingInvitations ?? [],
	};
}

export function CollaboratorModal(props: Props): React.JSX.Element | null {
	const { t } = useI18n();
	const [busy, setBusy] = React.useState(false);
	const [loading, setLoading] = React.useState(false);
	const [syncing, setSyncing] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [identifier, setIdentifier] = React.useState('');
	const [role, setRole] = React.useState<NoteShareRole>('EDITOR');
	const [pendingActionCount, setPendingActionCount] = React.useState(0);
	const [isOffline, setIsOffline] = React.useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
	const [snapshot, setSnapshot] = React.useState<NoteShareCollaboratorSnapshot>(EMPTY_SNAPSHOT);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const update = () => setIsOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
		window.addEventListener('online', update);
		window.addEventListener('offline', update);
		return () => {
			window.removeEventListener('online', update);
			window.removeEventListener('offline', update);
		};
	}, []);

	const loadCachedState = React.useCallback(async (): Promise<boolean> => {
		if (!props.authUserId || !props.docId) return false;
		const [cached, pendingActions] = await Promise.all([
			readCachedNoteShareCollaborators(props.authUserId, props.docId),
			readPendingCollaboratorActions(props.authUserId, props.docId),
		]);
		setPendingActionCount(pendingActions.length);
		if (cached) {
			const normalized = props.offlineCanManageHint && !cached.canManage
				? buildOfflineManagerSnapshot(props.authUserId, props.docId, cached)
				: cached;
			setSnapshot(normalized);
			return true;
		}
		if (props.offlineCanManageHint) {
			setSnapshot(buildOfflineManagerSnapshot(props.authUserId, props.docId, null));
			return true;
		}
		return false;
	}, [props.authUserId, props.docId, props.offlineCanManageHint]);

	const load = React.useCallback(async () => {
		if (!props.docId) return;
		if (!props.authUserId) return;
		// The snapshot is role-sensitive: owners/members get pending invites and full
		// revoke controls, while recipients get a reduced view centered on their own
		// access plus the sharer identity.
		setLoading(true);
		setError(null);
		const hadCache = await loadCachedState();
		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			setLoading(false);
			return;
		}
		setSyncing(true);
		try {
			await flushPendingCollaboratorActions(props.authUserId);
			const fresh = await syncNoteShareCollaborators(props.authUserId, props.docId, { suppressError: true });
			if (fresh) {
				setSnapshot(fresh);
			}
			const pendingActions = await readPendingCollaboratorActions(props.authUserId, props.docId);
			setPendingActionCount(pendingActions.length);
		} catch {
			if (!hadCache) {
				setSnapshot(
					props.offlineCanManageHint && props.authUserId
						? buildOfflineManagerSnapshot(props.authUserId, props.docId, null)
						: EMPTY_SNAPSHOT
				);
			}
		} finally {
			setSyncing(false);
			setLoading(false);
		}
	}, [loadCachedState, props.authUserId, props.docId, props.offlineCanManageHint]);

	React.useEffect(() => {
		if (!props.isOpen || !props.docId) return;
		void load();
	}, [load, props.docId, props.isOpen, props.refreshToken]);

	React.useEffect(() => {
		if (props.isOpen) return;
		setIdentifier('');
		setRole('EDITOR');
		setError(null);
		setPendingActionCount(0);
		setSnapshot(EMPTY_SNAPSHOT);
	}, [props.isOpen]);

	const handleInvite = React.useCallback(async () => {
		if (!props.docId || !props.authUserId || !identifier.trim()) return;
		setBusy(true);
		setError(null);
		try {
			const normalizedIdentifier = identifier.trim();
			if (typeof navigator !== 'undefined' && navigator.onLine === false) {
				await queueNoteShareCollaboratorInviteAction({
					userId: props.authUserId,
					docId: props.docId,
					identifier: normalizedIdentifier,
					role,
				});
				setIdentifier('');
				await loadCachedState();
				props.onChanged?.();
				return;
			}
			await createNoteShareInvitation({ docId: props.docId, identifier: identifier.trim(), role });
			setIdentifier('');
			await load();
			props.onChanged?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.inviteFailed'));
		} finally {
			setBusy(false);
		}
	}, [identifier, load, loadCachedState, props, role, t]);

	const handleRevoke = React.useCallback(async (collaboratorId: string) => {
		if (!props.authUserId || !props.docId) return;
		setBusy(true);
		setError(null);
		try {
			const collaborator = snapshot.collaborators.find((item) => item.id === collaboratorId);
			if (typeof navigator !== 'undefined' && navigator.onLine === false) {
				await queueNoteShareCollaboratorRevokeAction({
					userId: props.authUserId,
					docId: props.docId,
					collaboratorId,
					collaboratorUserId: collaborator?.userId ?? null,
				});
				await loadCachedState();
				props.onChanged?.();
				return;
			}
			await revokeNoteShareCollaborator(collaboratorId);
			await load();
			props.onChanged?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.revokeFailed'));
		} finally {
			setBusy(false);
		}
	}, [load, loadCachedState, props, snapshot.collaborators, t]);

	const handleRemove = React.useCallback(async () => {
		if (!snapshot.selfCollaboratorId || !props.authUserId || !props.docId) return;
		// Recipient-side "Remove" is implemented by revoking that collaborator row.
		// The server accepts this for self-removal even though recipients cannot manage
		// anyone else in the collaborator list.
		setBusy(true);
		setError(null);
		try {
			if (typeof navigator !== 'undefined' && navigator.onLine === false) {
				await queueNoteShareCollaboratorRevokeAction({
					userId: props.authUserId,
					docId: props.docId,
					collaboratorId: snapshot.selfCollaboratorId,
					collaboratorUserId: snapshot.currentUserId,
				});
				await loadCachedState();
				props.onChanged?.();
				return;
			}
			await revokeNoteShareCollaborator(snapshot.selfCollaboratorId);
			await load();
			props.onChanged?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.removeFailed'));
		} finally {
			setBusy(false);
		}
	}, [load, loadCachedState, props, snapshot.currentUserId, snapshot.selfCollaboratorId, t]);

	const handleRoleChange = React.useCallback(async (collaboratorId: string, collaboratorUserId: string, nextRole: NoteShareRole) => {
		if (!props.authUserId || !props.docId) return;
		setBusy(true);
		setError(null);
		try {
			if (typeof navigator !== 'undefined' && navigator.onLine === false) {
				await queueNoteShareCollaboratorRoleAction({
					userId: props.authUserId,
					docId: props.docId,
					collaboratorId,
					collaboratorUserId: collaboratorUserId,
					role: nextRole,
				});
				await loadCachedState();
				props.onChanged?.();
				return;
			}
			await updateNoteShareCollaboratorRole(collaboratorId, nextRole);
			await load();
			props.onChanged?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.roleUpdateFailed'));
		} finally {
			setBusy(false);
		}
	}, [load, loadCachedState, props, t]);

	const visibleCollaboratorCount = snapshot.collaborators.length + (snapshot.sharedBy ? 1 : 0);

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={styles.modal} role="dialog" aria-modal="true" aria-label={t('share.collaborators')} onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<div>
						<h2 className={styles.title}>{t('share.collaborators')}</h2>
						<p className={styles.subtitle}>{props.noteTitle || t('note.untitled')}</p>
					</div>
					<button type="button" className={styles.closeButton} onClick={props.onClose} aria-label={t('common.close')}>
						✕
					</button>
				</header>

				{error ? <div className={styles.error}>{error}</div> : null}
				{!isOffline && (syncing || pendingActionCount > 0) ? <div className={styles.info}>{t('share.collaboratorSyncPending')}</div> : null}

				{snapshot.canManage ? (
					<div className={styles.inviteBox}>
						<input
							className={styles.input}
							value={identifier}
							onChange={(event) => setIdentifier(event.target.value)}
							placeholder={t('share.identifierPlaceholder')}
							disabled={busy}
						/>
						<select className={styles.select} value={role} onChange={(event) => setRole(event.target.value === 'VIEWER' ? 'VIEWER' : 'EDITOR')} disabled={busy}>
							<option value="EDITOR">{t('share.roleEditor')}</option>
							<option value="VIEWER">{t('share.roleViewer')}</option>
						</select>
						<button type="button" className={styles.primaryButton} onClick={() => void handleInvite()} disabled={busy || !identifier.trim()}>
							{busy ? t('common.loading') : t('share.sendInvite')}
						</button>
					</div>
				) : (
					// Non-managers can still inspect who shared the note, but they should not
					// see owner/admin invite controls or revoke actions for other people.
					<div className={styles.info}>{t('share.viewOnlyAccess')}</div>
				)}

				{snapshot.canManage ? (
				<div className={styles.section}>
					<h3 className={styles.sectionTitle}>{t('share.pendingInvitations')}</h3>
					{snapshot.pendingInvitations.length === 0 ? <div className={styles.empty}>{t('share.nonePending')}</div> : null}
					{snapshot.pendingInvitations.map((invitation) => (
						<div key={invitation.id} className={styles.row}>
							<div>
								<div className={styles.rowTitle}>{invitation.inviteeName || invitation.inviteeEmail}</div>
								<div className={styles.rowMeta}>{invitation.role === 'VIEWER' ? t('share.roleViewer') : t('share.roleEditor')}</div>
							</div>
							<div className={styles.badge}>{t('share.statusPending')}</div>
						</div>
					))}
				</div>
				) : null}

				<div className={styles.section}>
					<h3 className={styles.sectionTitle}>{t('share.activeCollaborators')}</h3>
					{visibleCollaboratorCount === 0 ? <div className={styles.empty}>{t('share.noneCollaborators')}</div> : null}
					{snapshot.sharedBy ? (
						<div className={styles.row}>
							<div>
								<div className={styles.rowTitle}>{snapshot.sharedBy.name || snapshot.sharedBy.email || snapshot.sharedBy.id}</div>
								<div className={styles.rowMeta}>{snapshot.sharedBy.email}</div>
							</div>
							{snapshot.selfCollaboratorId ? (
								<button type="button" className={styles.secondaryButton} onClick={() => void handleRemove()} disabled={busy}>
									{t('editors.remove')}
								</button>
							) : null}
						</div>
					) : null}
					{snapshot.collaborators.map((collaborator) => (
						<div key={collaborator.id} className={styles.row}>
							<div className={styles.rowIdentity}>
								{collaborator.user?.profileImage ? (
									<img className={styles.notificationAvatar} src={collaborator.user.profileImage} alt="" />
								) : (
									<div className={styles.notificationAvatarFallback} aria-hidden="true">
										{(collaborator.user?.name || collaborator.user?.email || collaborator.userId).slice(0, 1).toUpperCase()}
									</div>
								)}
								<div>
									<div className={styles.rowTitle}>{collaborator.user?.name || collaborator.user?.email || collaborator.userId}</div>
									<div className={styles.rowMeta}>{collaborator.user?.email || (collaborator.role === 'VIEWER' ? t('share.roleViewer') : t('share.roleEditor'))}</div>
								</div>
							</div>
							{snapshot.canManage ? (
								<div className={styles.rowActions}>
									<select className={styles.compactSelect} value={collaborator.role} onChange={(event) => void handleRoleChange(collaborator.id, collaborator.userId, event.target.value === 'VIEWER' ? 'VIEWER' : 'EDITOR')} disabled={busy || loading}>
										<option value="EDITOR">{t('share.roleEditor')}</option>
										<option value="VIEWER">{t('share.roleViewer')}</option>
									</select>
									<button type="button" className={styles.secondaryButton} onClick={() => void handleRevoke(collaborator.id)} disabled={busy || loading}>
										{t('share.revoke')}
									</button>
								</div>
							) : collaborator.userId === snapshot.currentUserId ? (
								<button type="button" className={styles.secondaryButton} onClick={() => void handleRemove()} disabled={busy || !snapshot.selfCollaboratorId}>
									{t('editors.remove')}
								</button>
							) : null}
						</div>
					))}
				</div>
			</section>
		</div>
	);
}
