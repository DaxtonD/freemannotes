import React from 'react';
import {
	createNoteShareInvitation,
	getNoteShareCollaborators,
	revokeNoteShareCollaborator,
	type NoteShareCollaboratorSnapshot,
	type NoteShareRole,
} from '../../core/noteShareApi';
import { useI18n } from '../../core/i18n';
import styles from './CollaborationModal.module.css';

type Props = {
	isOpen: boolean;
	onClose: () => void;
	docId: string | null;
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

export function CollaboratorModal(props: Props): React.JSX.Element | null {
	const { t } = useI18n();
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [identifier, setIdentifier] = React.useState('');
	const [role, setRole] = React.useState<NoteShareRole>('EDITOR');
	const [snapshot, setSnapshot] = React.useState<NoteShareCollaboratorSnapshot>(EMPTY_SNAPSHOT);

	const load = React.useCallback(async () => {
		if (!props.docId) return;
		// The snapshot is role-sensitive: owners/members get pending invites and full
		// revoke controls, while recipients get a reduced view centered on their own
		// access plus the sharer identity.
		setBusy(true);
		setError(null);
		try {
			setSnapshot(await getNoteShareCollaborators(props.docId));
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.loadFailed'));
		} finally {
			setBusy(false);
		}
	}, [props.docId, t]);

	React.useEffect(() => {
		if (!props.isOpen || !props.docId) return;
		void load();
	}, [load, props.docId, props.isOpen, props.refreshToken]);

	React.useEffect(() => {
		if (props.isOpen) return;
		setIdentifier('');
		setRole('EDITOR');
		setError(null);
		setSnapshot(EMPTY_SNAPSHOT);
	}, [props.isOpen]);

	const handleInvite = React.useCallback(async () => {
		if (!props.docId || !identifier.trim()) return;
		setBusy(true);
		setError(null);
		try {
			await createNoteShareInvitation({ docId: props.docId, identifier: identifier.trim(), role });
			setIdentifier('');
			await load();
			props.onChanged?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.inviteFailed'));
		} finally {
			setBusy(false);
		}
	}, [identifier, load, props, role, t]);

	const handleRevoke = React.useCallback(async (collaboratorId: string) => {
		setBusy(true);
		setError(null);
		try {
			await revokeNoteShareCollaborator(collaboratorId);
			await load();
			props.onChanged?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.revokeFailed'));
		} finally {
			setBusy(false);
		}
	}, [load, props, t]);

	const handleRemove = React.useCallback(async () => {
		if (!snapshot.selfCollaboratorId) return;
		// Recipient-side "Remove" is implemented by revoking that collaborator row.
		// The server accepts this for self-removal even though recipients cannot manage
		// anyone else in the collaborator list.
		setBusy(true);
		setError(null);
		try {
			await revokeNoteShareCollaborator(snapshot.selfCollaboratorId);
			await load();
			props.onChanged?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.removeFailed'));
		} finally {
			setBusy(false);
		}
	}, [load, props, snapshot.selfCollaboratorId, t]);

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
							<div>
								<div className={styles.rowTitle}>{collaborator.user?.name || collaborator.user?.email || collaborator.userId}</div>
								<div className={styles.rowMeta}>{collaborator.role === 'VIEWER' ? t('share.roleViewer') : t('share.roleEditor')}</div>
							</div>
							{snapshot.canManage ? (
								<button type="button" className={styles.secondaryButton} onClick={() => void handleRevoke(collaborator.id)} disabled={busy}>
									{t('share.revoke')}
								</button>
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
