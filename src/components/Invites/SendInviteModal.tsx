import React from 'react';
import QRCode from 'qrcode';
import styles from './SendInviteModal.module.css';
import {
	copyTextToClipboard,
	ensureWorkspaceInviteLink,
	ensureWorkspaceShareLink,
	getShareLinkReadyEventName,
	normalizeWorkspaceInviteRole,
	normalizeWorkspaceShareRole,
	readCachedWorkspaceInviteLink,
	readCachedWorkspaceShareLink,
	sendWorkspaceInviteEmail,
	type ShareExpiryDays,
	type WorkspaceInviteLink,
	type WorkspaceInviteRole,
	type WorkspaceShareLink,
	type WorkspaceShareRole,
} from '../../core/shareLinks';
import {
	cancelWorkspaceInviteItem,
	getWorkspaceInviteStateEventName,
	hasWorkspaceInviteDuplicate,
	listWorkspaceInviteState,
	queueWorkspaceInviteEmail,
	removeWorkspaceMemberAccess,
	recordWorkspaceInviteSuccess,
	updateWorkspaceMemberAccess,
	type WorkspaceInviteState,
} from '../../core/syncOutbox';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import { getWorkspaceRoleLabelKey } from '../../core/workspaceRoles';

type Props = {
	isOpen: boolean;
	onClose: () => void;
	t: (key: string) => string;
	authUserId: string | null;
	authProfileImage?: string | null;
	workspaceId: string | null;
	workspaceName?: string | null;
};

function formatExpiry(value: string | null): string {
	if (!value) return '';
	const ms = Date.parse(value);
	if (!Number.isFinite(ms)) return value;
	return new Date(ms).toLocaleString();
}

function isTransportLikeError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /failed to fetch|networkerror|load failed/i.test(message);
}

function renderRole(role: string, t: Props['t']): string {
	return t(getWorkspaceRoleLabelKey(role));
}

export function SendInviteModal(props: Props): React.JSX.Element | null {
	const [busy, setBusy] = React.useState(false);
	const [actionBusyKey, setActionBusyKey] = React.useState<string | null>(null);
	const [openPanel, setOpenPanel] = React.useState<'email' | 'qr-link' | 'members' | 'pending'>('email');
	const [shareQrModalOpen, setShareQrModalOpen] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [success, setSuccess] = React.useState<string | null>(null);
	const [identifier, setIdentifier] = React.useState('');
	const [inviteRole, setInviteRole] = React.useState<WorkspaceInviteRole>('VIEWER');
	const [linkRole, setLinkRole] = React.useState<WorkspaceShareRole | ''>('');
	const [expiryDays, setExpiryDays] = React.useState<ShareExpiryDays>(7);
	const [inviteLink, setInviteLink] = React.useState<WorkspaceInviteLink | null>(null);
	const [shareLink, setShareLink] = React.useState<WorkspaceShareLink | null>(null);
	const [inviteQrDataUrl, setInviteQrDataUrl] = React.useState<string | null>(null);
	const [shareQrDataUrl, setShareQrDataUrl] = React.useState<string | null>(null);
	const [inviteState, setInviteState] = React.useState<WorkspaceInviteState>({ members: [], invites: [] });

	useBodyScrollLock(props.isOpen);

	React.useEffect(() => {
		if (props.isOpen) return;
		setBusy(false);
		setActionBusyKey(null);
		setOpenPanel('email');
		setShareQrModalOpen(false);
		setError(null);
		setSuccess(null);
		setIdentifier('');
		setInviteRole('VIEWER');
		setLinkRole('');
		setExpiryDays(7);
		setInviteLink(null);
		setShareLink(null);
		setInviteQrDataUrl(null);
		setShareQrDataUrl(null);
		setInviteState({ members: [], invites: [] });
	}, [props.isOpen]);

	React.useEffect(() => {
		if (!inviteLink?.inviteUrl) {
			setInviteQrDataUrl(null);
			return;
		}
		let cancelled = false;
		QRCode.toDataURL(inviteLink.inviteUrl, { margin: 1, width: 280, errorCorrectionLevel: 'M' })
			.then((next) => {
				if (!cancelled) setInviteQrDataUrl(next);
			})
			.catch(() => {
				if (!cancelled) setInviteQrDataUrl(null);
			});
		return () => {
			cancelled = true;
		};
	}, [inviteLink]);

	React.useEffect(() => {
		if (!shareLink?.shareUrl) {
			setShareQrDataUrl(null);
			return;
		}
		let cancelled = false;
		QRCode.toDataURL(shareLink.shareUrl, { margin: 1, width: 280, errorCorrectionLevel: 'M' })
			.then((next) => {
				if (!cancelled) setShareQrDataUrl(next);
			})
			.catch(() => {
				if (!cancelled) setShareQrDataUrl(null);
			});
		return () => {
			cancelled = true;
		};
	}, [shareLink]);

	const loadInviteState = React.useCallback(async (preferCache: boolean) => {
		if (!props.workspaceId) {
			setInviteState({ members: [], invites: [] });
			return;
		}
		try {
			setInviteState(await listWorkspaceInviteState(props.workspaceId, { preferCache }));
		} catch {
			if (preferCache) setInviteState({ members: [], invites: [] });
		}
	}, [props.workspaceId]);

	React.useEffect(() => {
		if (!props.isOpen) return;
		void loadInviteState(typeof navigator !== 'undefined' && navigator.onLine === false);
	}, [loadInviteState, props.isOpen]);

	React.useEffect(() => {
		if (!props.isOpen || typeof window === 'undefined') return;
		const inviteEventName = getWorkspaceInviteStateEventName();
		const shareEventName = getShareLinkReadyEventName();
		const onInviteChanged = (event: Event) => {
			const workspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId;
			if (!workspaceId || workspaceId !== props.workspaceId) return;
			void loadInviteState(typeof navigator !== 'undefined' && navigator.onLine === false);
		};
		const onShareReady = (event: Event) => {
			const detail = (event as CustomEvent<{ entityType: string; entityId: string; permission: string; expiresInDays: ShareExpiryDays }>).detail;
			if (!detail || detail.entityType !== 'workspace' || detail.entityId !== props.workspaceId) return;
			const cached = readCachedWorkspaceShareLink({
				workspaceId: detail.entityId,
				permission: detail.permission as WorkspaceShareRole,
				expiresInDays: detail.expiresInDays,
			});
			if (cached) {
				setShareLink(cached);
				if (cached.shareUrl) setShareQrModalOpen(true);
			}
		};
		const onOnline = () => {
			void loadInviteState(false);
		};
		window.addEventListener(inviteEventName, onInviteChanged as EventListener);
		window.addEventListener(shareEventName, onShareReady as EventListener);
		window.addEventListener('online', onOnline);
		return () => {
			window.removeEventListener(inviteEventName, onInviteChanged as EventListener);
			window.removeEventListener(shareEventName, onShareReady as EventListener);
			window.removeEventListener('online', onOnline);
		};
	}, [loadInviteState, props.isOpen, props.workspaceId]);

	const canSendInvite = Boolean(props.workspaceId) && identifier.trim().length > 0;
	const canGenerateShareLink = Boolean(props.workspaceId && linkRole);

	const generateInviteLink = React.useCallback(async (forceRefresh: boolean) => {
		if (busy) return;
		if (!props.workspaceId) {
			setError(props.t('invite.noWorkspace'));
			return;
		}
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			const next = await ensureWorkspaceInviteLink({ workspaceId: props.workspaceId, identifier, role: inviteRole, forceRefresh });
			setInviteLink(next);
			const cached = readCachedWorkspaceInviteLink({ workspaceId: props.workspaceId, identifier, role: inviteRole });
			if (!forceRefresh && cached && cached.inviteUrl === next.inviteUrl && typeof navigator !== 'undefined' && navigator.onLine === false) {
				setSuccess(props.t('invite.offlineCached'));
			} else {
				setSuccess(props.t('invite.linkReady'));
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : props.t('invite.linkFailed'));
		} finally {
			setBusy(false);
		}
	}, [busy, identifier, inviteRole, props]);

	const generateWorkspaceShare = React.useCallback(async (forceRefresh: boolean) => {
		if (busy) return;
		if (!props.workspaceId) {
			setError(props.t('invite.noWorkspace'));
			return;
		}
		if (!linkRole) {
			setError(props.t('share.roleRequired'));
			return;
		}
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			const next = await ensureWorkspaceShareLink({
				userId: props.authUserId,
				workspaceId: props.workspaceId,
				permission: linkRole,
				expiresInDays: expiryDays,
				forceRefresh,
			});
			setShareLink(next);
			if (next.shareUrl) setShareQrModalOpen(true);
			setSuccess(next.pending ? props.t('share.linkQueued') : props.t('share.linkReady'));
		} catch (err) {
			setError(err instanceof Error ? err.message : props.t('share.createFailed'));
		} finally {
			setBusy(false);
		}
	}, [busy, expiryDays, linkRole, props]);

	const send = React.useCallback(async () => {
		if (busy) return;
		if (!props.workspaceId) {
			setError(props.t('invite.noWorkspace'));
			return;
		}
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			const duplicate = await hasWorkspaceInviteDuplicate(props.workspaceId, identifier);
			if (duplicate === 'member') throw new Error(props.t('invite.duplicateMember'));
			if (duplicate === 'invite') throw new Error(props.t('invite.duplicateInvite'));
			if (typeof navigator !== 'undefined' && navigator.onLine === false) {
				// Offline sends queue the typed identifier so the pending invite appears
				// immediately and can replay once the connection returns.
				if (!props.authUserId) throw new Error(props.t('invite.sendFailed'));
				const queued = await queueWorkspaceInviteEmail({ userId: props.authUserId, workspaceId: props.workspaceId, identifier, role: inviteRole });
				setInviteLink(queued.inviteLink);
				setSuccess(props.t('invite.pendingQueued'));
				await loadInviteState(true);
				return;
			}
			const next = await sendWorkspaceInviteEmail({ workspaceId: props.workspaceId, identifier, role: inviteRole });
			setInviteLink(next);
			if (next.inviteId) {
				await recordWorkspaceInviteSuccess({
					workspaceId: props.workspaceId,
					identifier,
					email: next.email,
					role: inviteRole,
					inviteId: next.inviteId,
					inviteUrl: next.inviteUrl,
					expiresAt: next.expiresAt,
				});
			}
			await loadInviteState(false);
			setSuccess(next.sentEmail ? props.t('invite.sent') : props.t('invite.sentInApp'));
		} catch (err) {
			if (props.authUserId && props.workspaceId && isTransportLikeError(err)) {
				try {
					// Treat transport failures after the duplicate check like offline mode so
					// the admin keeps the action instead of re-entering the invite later.
					const queued = await queueWorkspaceInviteEmail({ userId: props.authUserId, workspaceId: props.workspaceId, identifier, role: inviteRole });
					setInviteLink(queued.inviteLink);
					setSuccess(props.t('invite.pendingQueued'));
					setError(null);
					await loadInviteState(true);
					return;
				} catch (queueErr) {
					setError(queueErr instanceof Error ? queueErr.message : props.t('invite.sendFailed'));
					return;
				}
			}
			setError(err instanceof Error ? err.message : props.t('invite.sendFailed'));
		} finally {
			setBusy(false);
		}
	}, [busy, identifier, inviteRole, loadInviteState, props]);

	const copyLink = React.useCallback(async (value: string | null, successKey: string, failureKey: string) => {
		if (!value) return;
		try {
			await copyTextToClipboard(value);
			setSuccess(props.t(successKey));
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : props.t(failureKey));
		}
	}, [props]);

	const inviteStatusLabel = React.useCallback((status: WorkspaceInviteState['invites'][number]['status']) => {
		return status === 'failed' ? props.t('invite.stateFailed') : props.t('invite.statePending');
	}, [props]);

	const inviteStatusDetail = React.useCallback((invite: WorkspaceInviteState['invites'][number]) => {
		if (invite.detail === 'waiting') return props.t('invite.statePendingOffline');
		if (invite.detail === 'syncing') return props.t('invite.statePendingSyncing');
		if (invite.status === 'failed') return invite.error || props.t('invite.stateFailed');
		return invite.expiresAt ? `${props.t('invite.expiresAt')}: ${formatExpiry(invite.expiresAt)}` : null;
	}, [props]);

	const handleMemberRoleChange = React.useCallback(async (userId: string | null, nextRole: WorkspaceInviteRole) => {
		if (!props.workspaceId || !userId) return;
		const key = `member-role:${userId}`;
		setActionBusyKey(key);
		setError(null);
		try {
			const current = inviteState.members.find((member) => member.userId === userId);
			await updateWorkspaceMemberAccess({ workspaceId: props.workspaceId, userId, role: nextRole, actorUserId: props.authUserId, expectedRole: current?.role });
			await loadInviteState(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : props.t('invite.updateRoleFailed'));
		} finally {
			setActionBusyKey(null);
		}
	}, [loadInviteState, props]);

	const handleRemoveMember = React.useCallback(async (userId: string | null) => {
		if (!props.workspaceId || !userId) return;
		if (typeof window !== 'undefined' && !window.confirm(props.t('invite.removeMemberConfirm'))) {
			return;
		}
		const key = `member-remove:${userId}`;
		setActionBusyKey(key);
		setError(null);
		try {
			const current = inviteState.members.find((member) => member.userId === userId);
			await removeWorkspaceMemberAccess({ workspaceId: props.workspaceId, userId, actorUserId: props.authUserId, expectedRole: current?.role });
			await loadInviteState(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : props.t('invite.removeMemberFailed'));
		} finally {
			setActionBusyKey(null);
		}
	}, [loadInviteState, props]);

	const handleCancelInvite = React.useCallback(async (invite: WorkspaceInviteState['invites'][number]) => {
		if (!props.workspaceId) return;
		const key = `invite-cancel:${invite.id}`;
		setActionBusyKey(key);
		setError(null);
		try {
			await cancelWorkspaceInviteItem({
				workspaceId: props.workspaceId,
				inviteId: invite.id,
				email: invite.email,
				isLocalOnly: invite.isLocalOnly,
				actorUserId: props.authUserId,
				expectedRole: invite.role,
			});
			await loadInviteState(invite.isLocalOnly);
		} catch (err) {
			setError(err instanceof Error ? err.message : props.t('invite.cancelInviteFailed'));
		} finally {
			setActionBusyKey(null);
		}
	}, [loadInviteState, props]);

	if (!props.isOpen) return null;

	return (
		<>
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={styles.modal} role="dialog" aria-modal="true" aria-label={props.t('invite.title')} onClick={(e) => e.stopPropagation()}>
				<header className={styles.header}>
					<div className={styles.titleBlock}>
						<h2 className={styles.title}>{props.t('invite.title')}</h2>
						<p className={styles.subtitle}>{props.workspaceName || props.t('workspace.unnamed')}</p>
					</div>
					<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label={props.t('common.close')}>
						✕
					</button>
				</header>

				<div className={styles.info}>{props.t('invite.identifierNotice')}</div>
				{error ? <div className={styles.error}>{error}</div> : null}
				{success ? <div className={styles.success}>{success}</div> : null}

				<div className={styles.modalBody}>
					<div className={`${styles.sectionDisclosure} ${openPanel === 'email' ? styles.sectionDisclosureExpanded : ''}`}>
						<button
							type="button"
							className={`${styles.sectionSummaryButton} ${openPanel === 'email' ? styles.sectionSummaryButtonExpanded : ''}`}
							onClick={() => setOpenPanel('email')}
							aria-expanded={openPanel === 'email'}
						>
							<span className={styles.sectionSummaryLabel}>{props.t('invite.emailSectionTitle')}</span>
							<span className={styles.disclosureArrow} aria-hidden="true" />
						</button>
						<div className={`${styles.sectionPanel} ${openPanel === 'email' ? styles.sectionPanelExpanded : ''}`} aria-hidden={openPanel !== 'email'}>
							<div className={styles.sectionPanelInner}>
								<div className={`${styles.sectionCard} ${styles.inviteSectionCard}`}>
									<label className={styles.field}>
										<span>{props.t('invite.identifier')}</span>
										<input className={styles.input} type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={props.t('share.identifierPlaceholder')} disabled={busy || Boolean(actionBusyKey)} />
									</label>
									<label className={styles.field}>
										<span>{props.t('invite.role')}</span>
										<select className={styles.input} value={inviteRole} onChange={(e) => setInviteRole(normalizeWorkspaceInviteRole(e.target.value))} disabled={busy || Boolean(actionBusyKey)}>
											<option value="VIEWER">{props.t('share.roleViewer')}</option>
											<option value="EDITOR">{props.t('invite.roleEditor')}</option>
											<option value="ADMIN">{props.t('invite.roleAdmin')}</option>
										</select>
									</label>
									<div className={styles.inlineActions}>
										<button type="button" onClick={() => void send()} disabled={busy || Boolean(actionBusyKey) || !canSendInvite}>
											{busy ? props.t('common.loading') : props.t('invite.send')}
										</button>
									</div>
								</div>
							</div>
						</div>
					</div>

					<div className={`${styles.sectionDisclosure} ${openPanel === 'qr-link' ? styles.sectionDisclosureExpanded : ''}`}>
						<button
							type="button"
							className={`${styles.sectionSummaryButton} ${openPanel === 'qr-link' ? styles.sectionSummaryButtonExpanded : ''}`}
							onClick={() => setOpenPanel('qr-link')}
							aria-expanded={openPanel === 'qr-link'}
						>
							<span className={styles.sectionSummaryLabel}>{props.t('invite.qrSectionTitle')}</span>
							<span className={styles.disclosureArrow} aria-hidden="true" />
						</button>
						<div className={`${styles.sectionPanel} ${openPanel === 'qr-link' ? styles.sectionPanelExpanded : ''}`} aria-hidden={openPanel !== 'qr-link'}>
							<div className={styles.sectionPanelInner}>
								<div className={`${styles.sectionCard} ${styles.inviteSectionCard}`}>
									<div className={styles.fieldGrid}>
										<label className={styles.field}>
											<span>{props.t('share.requiredRole')}</span>
											<select className={styles.input} value={linkRole} onChange={(e) => setLinkRole(e.target.value ? normalizeWorkspaceShareRole(e.target.value) : '')} disabled={busy || Boolean(actionBusyKey)}>
												<option value="">{props.t('share.selectRole')}</option>
												<option value="VIEWER">{props.t('share.roleViewer')}</option>
												<option value="EDITOR">{props.t('invite.roleEditor')}</option>
												<option value="ADMIN">{props.t('invite.roleAdmin')}</option>
											</select>
										</label>
										<label className={styles.field}>
											<span>{props.t('share.expiration')}</span>
											<select className={styles.input} value={expiryDays} onChange={(e) => setExpiryDays(Number(e.target.value) as ShareExpiryDays)} disabled={busy || Boolean(actionBusyKey)}>
												<option value={1}>{props.t('share.expiration1Day')}</option>
												<option value={7}>{props.t('share.expiration7Days')}</option>
												<option value={30}>{props.t('share.expiration30Days')}</option>
											</select>
										</label>
									</div>
									<div className={styles.inlineActions}>
										<button type="button" onClick={() => void generateWorkspaceShare(Boolean(shareLink))} disabled={busy || Boolean(actionBusyKey) || !canGenerateShareLink}>
											{busy ? props.t('common.loading') : shareLink ? props.t('share.refresh') : props.t('share.generateLink')}
										</button>
										{shareLink?.shareUrl ? (
											<button type="button" className={styles.secondaryAction} onClick={() => setShareQrModalOpen(true)} disabled={busy || Boolean(actionBusyKey)}>
												{props.t('share.viewQrCode')}
											</button>
										) : null}
									</div>
									{shareLink ? (
										<div className={styles.generatedStatus}>
											<div className={styles.metaRow}>
												<span className={styles.badge}>{renderRole(shareLink.permission, props.t)}</span>
												{shareLink.expiresAt ? <span className={styles.meta}>{props.t('share.expiresAt')}: {formatExpiry(shareLink.expiresAt)}</span> : null}
											</div>
											{shareLink.shareUrl ? <div className={styles.info}>{props.t('share.viewQrCode')}</div> : <div className={styles.info}>{props.t('share.linkQueued')}</div>}
										</div>
									) : null}
								</div>
							</div>
						</div>
					</div>

					<div className={`${styles.sectionDisclosure} ${openPanel === 'members' ? styles.sectionDisclosureExpanded : ''}`}>
						<button
							type="button"
							className={`${styles.sectionSummaryButton} ${openPanel === 'members' ? styles.sectionSummaryButtonExpanded : ''}`}
							onClick={() => setOpenPanel('members')}
							aria-expanded={openPanel === 'members'}
						>
							<span className={styles.sectionSummaryLabel}>{props.t('invite.membersTitle')}</span>
							<span className={styles.summaryCount}>{inviteState.members.length}</span>
							<span className={styles.disclosureArrow} aria-hidden="true" />
						</button>
						<div className={`${styles.sectionPanel} ${openPanel === 'members' ? styles.sectionPanelExpanded : ''}`} aria-hidden={openPanel !== 'members'}>
							<div className={styles.sectionPanelInner}>
								<div className={styles.listSection}>
									{inviteState.members.length === 0 ? <div className={styles.emptyState}>{props.t('invite.noneMembers')}</div> : null}
									{inviteState.members.map((member) => {
								const isOwner = member.role === 'OWNER';
								const canManage = Boolean(member.userId) && !isOwner;
								const resolvedProfileImage = member.profileImage || (member.userId && member.userId === props.authUserId ? props.authProfileImage || null : null);
								return (
									<div key={member.id} className={`${styles.listRow} ${styles.memberRow}`}>
										<div className={styles.memberIdentity}>
											<div className={styles.memberAvatarStack}>
												{resolvedProfileImage ? (
													<img className={styles.memberAvatar} src={resolvedProfileImage} alt="" />
												) : (
													<div className={styles.memberAvatarFallback} aria-hidden="true">
														{(member.name || member.email).slice(0, 1).toUpperCase()}
													</div>
												)}
												<span className={styles.badge}>{renderRole(member.role, props.t)}</span>
											</div>
											<div className={styles.rowCopy}>
												<div className={styles.rowPrimary}>{member.name || member.email}</div>
												<div className={styles.rowSecondary}>{member.email}</div>
											</div>
										</div>
										{canManage ? (
											<select
												className={`${styles.compactInput} ${styles.memberRoleSelect}`}
												value={member.role}
												onChange={(event) => void handleMemberRoleChange(member.userId, normalizeWorkspaceInviteRole(event.target.value))}
												disabled={Boolean(actionBusyKey) || busy}
											>
												<option value="VIEWER">{props.t('share.roleViewer')}</option>
												<option value="EDITOR">{props.t('invite.roleEditor')}</option>
												<option value="ADMIN">{props.t('invite.roleAdmin')}</option>
											</select>
										) : null}
										{canManage ? (
											<button type="button" className={`${styles.secondaryAction} ${styles.memberRemoveButton}`} onClick={() => void handleRemoveMember(member.userId)} disabled={Boolean(actionBusyKey) || busy}>
												{props.t('invite.removeMember')}
											</button>
										) : null}
									</div>
								);
										})}
									</div>
								</div>
							</div>
					</div>

					<div className={`${styles.sectionDisclosure} ${openPanel === 'pending' ? styles.sectionDisclosureExpanded : ''}`}>
						<button
							type="button"
							className={`${styles.sectionSummaryButton} ${openPanel === 'pending' ? styles.sectionSummaryButtonExpanded : ''}`}
							onClick={() => setOpenPanel('pending')}
							aria-expanded={openPanel === 'pending'}
						>
							<span className={styles.sectionSummaryLabel}>{props.t('invite.pendingTitle')}</span>
							<span className={styles.summaryCount}>{inviteState.invites.length}</span>
							<span className={styles.disclosureArrow} aria-hidden="true" />
						</button>
						<div className={`${styles.sectionPanel} ${openPanel === 'pending' ? styles.sectionPanelExpanded : ''}`} aria-hidden={openPanel !== 'pending'}>
							<div className={styles.sectionPanelInner}>
								<div className={styles.listSection}>
									{inviteState.invites.length === 0 ? <div className={styles.emptyState}>{props.t('invite.noneInvites')}</div> : null}
									{inviteState.invites.map((invite) => (
								<div key={invite.id} className={styles.listRow}>
									<div className={styles.memberIdentity}>
										<div className={styles.memberAvatarStack}>
											<div className={styles.memberAvatarFallback} aria-hidden="true">
												{(invite.name || invite.email).slice(0, 1).toUpperCase()}
											</div>
											<span className={`${styles.badge} ${invite.status === 'failed' ? styles.badgeFailed : ''}`}>{inviteStatusLabel(invite.status)}</span>
										</div>
										<div className={styles.rowCopy}>
											<div className={styles.rowPrimary}>{invite.name || invite.email}</div>
											<div className={styles.rowSecondary}>{invite.email}</div>
											<div className={styles.rowTertiary}>
												{[renderRole(invite.role, props.t), inviteStatusDetail(invite)].filter(Boolean).join(' • ')}
											</div>
										</div>
									</div>
									{invite.inviteUrl ? (
										<button type="button" className={`${styles.secondaryAction} ${styles.memberActionButton}`} onClick={() => void copyLink(invite.inviteUrl, 'invite.copied', 'invite.copyFailed')} disabled={Boolean(actionBusyKey) || busy}>
											{props.t('share.copy')}
										</button>
									) : null}
									<button type="button" className={`${styles.secondaryAction} ${styles.memberActionButton}`} onClick={() => void handleCancelInvite(invite)} disabled={Boolean(actionBusyKey) || busy}>
										{props.t('invite.cancelInvite')}
									</button>
								</div>
									))}
								</div>
							</div>
						</div>
					</div>
				</div>

				<footer className={styles.footer}>
					<button type="button" onClick={props.onClose} disabled={busy || Boolean(actionBusyKey)}>
						{props.t('common.close')}
					</button>
				</footer>
			</section>
		</div>
		{shareQrModalOpen && shareLink ? (
			<div className={styles.qrModalOverlay} role="presentation" onClick={() => setShareQrModalOpen(false)}>
				<section className={styles.qrModal} role="dialog" aria-modal="true" aria-label={props.t('invite.qrSectionTitle')} onClick={(event) => event.stopPropagation()}>
					<header className={styles.qrModalHeader}>
						<div className={styles.titleBlock}>
							<h3 className={styles.title}>{props.t('invite.qrSectionTitle')}</h3>
							<p className={styles.subtitle}>{props.workspaceName || props.t('workspace.unnamed')}</p>
						</div>
						<button type="button" className={styles.iconButton} onClick={() => setShareQrModalOpen(false)} aria-label={props.t('common.close')}>
							✕
						</button>
					</header>
					<div className={styles.qrModalBody}>
						<div className={styles.metaRow}>
							<span className={styles.badge}>{renderRole(shareLink.permission, props.t)}</span>
							{shareLink.expiresAt ? <span className={styles.meta}>{props.t('share.expiresAt')}: {formatExpiry(shareLink.expiresAt)}</span> : null}
						</div>
						{shareLink.shareUrl ? <div className={styles.linkValue}>{shareLink.shareUrl}</div> : <div className={styles.info}>{props.t('share.linkQueued')}</div>}
						{shareQrDataUrl ? (
							<div className={styles.qrCard}>
								<img className={styles.qrImage} src={shareQrDataUrl} alt={props.t('share.qrAlt')} />
							</div>
						) : null}
						<div className={styles.qrModalActions}>
							<button type="button" onClick={() => void copyLink(shareLink.shareUrl, 'share.copied', 'share.copyFailed')} disabled={busy || Boolean(actionBusyKey) || !shareLink.shareUrl}>
								{props.t('share.copy')}
							</button>
							<button type="button" onClick={() => void generateWorkspaceShare(true)} disabled={busy || Boolean(actionBusyKey) || !canGenerateShareLink}>
								{busy ? props.t('common.loading') : props.t('share.refresh')}
							</button>
							<button type="button" className={styles.secondaryAction} onClick={() => setShareQrModalOpen(false)}>
								{props.t('common.close')}
							</button>
						</div>
					</div>
				</section>
			</div>
		) : null}
		</>
	);
}
