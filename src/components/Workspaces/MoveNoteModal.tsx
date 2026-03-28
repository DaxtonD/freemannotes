import React from 'react';
import { canEditWorkspaceContent, getWorkspaceRoleLabelKey, type WorkspaceRole } from '../../core/workspaceRoles';
import { getWorkspaceDisplayName } from '../../core/workspaceDisplay';
import styles from './MoveNoteModal.module.css';

type WorkspaceOption = {
	id: string;
	name: string;
	role: WorkspaceRole;
	ownerUserId?: string | null;
	systemKind?: string | null;
};

type MoveNoteModalProps = {
	isOpen: boolean;
	onClose: () => void;
	onSelectWorkspace: (workspaceId: string) => void;
	t: (key: string) => string;
	workspaces: readonly WorkspaceOption[];
	currentWorkspaceId: string | null;
	noteTitle?: string;
	busy?: boolean;
	error?: string | null;
};

export function MoveNoteModal(props: MoveNoteModalProps): React.JSX.Element | null {
	const availableWorkspaces = React.useMemo(() => {
		return props.workspaces.filter((workspace) => {
			if (workspace.id === props.currentWorkspaceId) return false;
			if (workspace.systemKind === 'SHARED_WITH_ME') return false;
			return canEditWorkspaceContent(workspace.role);
		});
	}, [props.currentWorkspaceId, props.workspaces]);

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={styles.modal} role="dialog" aria-modal="true" aria-label={props.t('workspace.moveNoteTitle')} onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<div className={styles.titleBlock}>
						<h2 className={styles.title}>{props.t('workspace.moveNoteTitle')}</h2>
						<p className={styles.description}>
							{props.noteTitle?.trim()
								? `${props.t('workspace.moveNoteDescription')} ${props.noteTitle.trim()}`
								: props.t('workspace.moveNoteDescription')}
						</p>
					</div>
					<button type="button" className={styles.closeButton} onClick={props.onClose} aria-label={props.t('common.close')}>
						✕
					</button>
				</header>

				{props.error ? <div className={styles.error}>{props.error}</div> : null}

				{availableWorkspaces.length === 0 ? (
					<div className={styles.status}>{props.t('workspace.moveNoteEmpty')}</div>
				) : (
					<div className={styles.list}>
						{availableWorkspaces.map((workspace) => (
							<button
								key={workspace.id}
								type="button"
								className={styles.workspaceButton}
								onClick={() => props.onSelectWorkspace(workspace.id)}
								disabled={Boolean(props.busy)}
							>
								<span className={styles.workspaceMeta}>
									<span className={styles.workspaceName}>{getWorkspaceDisplayName(workspace, props.t)}</span>
									<span className={styles.workspaceRole}>{props.t(getWorkspaceRoleLabelKey(workspace.role))}</span>
								</span>
								<span className={styles.status}>{props.busy ? props.t('common.loading') : props.t('workspace.moveNoteAction')}</span>
							</button>
						))}
					</div>
				)}
			</section>
		</div>
	);
}