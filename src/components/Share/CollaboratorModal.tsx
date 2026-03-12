import React from 'react';
import QRCode from 'qrcode';
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
import {
	copyTextToClipboard,
	ensureNoteShareLink,
	getShareLinkReadyEventName,
	readCachedNoteShareLink,
	type NoteShareLink,
	type ShareExpiryDays,
} from '../../core/shareLinks';
import { useI18n } from '../../core/i18n';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import styles from './CollaboratorModal.module.css';

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

function formatExpiry(value: string | null): string {
	if (!value) return '';
	const ms = Date.parse(value);
	if (!Number.isFinite(ms)) return value;
	return new Date(ms).toLocaleString();
}

function renderNoteRole(role: NoteShareRole, t: (key: string) => string): string {
	return role === 'VIEWER' ? t('share.roleViewer') : t('share.roleEditor');
}

function isWorkspaceInheritedCollaborator(collaborator: NoteShareCollaboratorSnapshot['collaborators'][number]): boolean {
	return collaborator.accessSource === 'workspace';
}

export function CollaboratorModal(props: Props): React.JSX.Element | null {
	const { t } = useI18n();
	const [busy, setBusy] = React.useState(false);
	const [loading, setLoading] = React.useState(false);
	const [syncing, setSyncing] = React.useState(false);
	const [openPanel, setOpenPanel] = React.useState<'invite' | 'link' | 'pending' | 'collaborators'>('invite');
	const [shareQrModalOpen, setShareQrModalOpen] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [success, setSuccess] = React.useState<string | null>(null);
	const [identifier, setIdentifier] = React.useState('');
	const [role, setRole] = React.useState<NoteShareRole>('EDITOR');
	const [shareRole, setShareRole] = React.useState<NoteShareRole | ''>('');
	const [expiryDays, setExpiryDays] = React.useState<ShareExpiryDays>(7);
	const [shareLink, setShareLink] = React.useState<NoteShareLink | null>(null);
	const [shareQrDataUrl, setShareQrDataUrl] = React.useState<string | null>(null);
	const [pendingActionCount, setPendingActionCount] = React.useState(0);
	const [isOffline, setIsOffline] = React.useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
	const [snapshot, setSnapshot] = React.useState<NoteShareCollaboratorSnapshot>(EMPTY_SNAPSHOT);

	useBodyScrollLock(props.isOpen);

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

	React.useEffect(() => {
		if (!shareLink?.shareUrl) {
			setShareQrDataUrl(null);
			return;
		}
		let cancelled = false;
		QRCode.toDataURL(shareLink.shareUrl, { margin: 1, width: 280, errorCorrectionLevel: 'M' })
			.then((next: string) => {
				if (!cancelled) setShareQrDataUrl(next);
			})
			.catch(() => {
				if (!cancelled) setShareQrDataUrl(null);
			});
		return () => {
			cancelled = true;
		};
	}, [shareLink]);

	const loadCachedState = React.useCallback(async (): Promise<boolean> => {
		if (!props.authUserId || !props.docId) return false;
		const [cached, pendingActions] = await Promise.all([
			readCachedNoteShareCollaborators(props.authUserId, props.docId),
			readPendingCollaboratorActions(props.authUserId, props.docId),
		]);
		setPendingActionCount(pendingActions.length);
		if (cached) {
			const normalized = props.offlineCanManageHint && !cached.canManage ? buildOfflineManagerSnapshot(props.authUserId, props.docId, cached) : cached;
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
		if (!props.docId || !props.authUserId) return;
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
			if (fresh) setSnapshot(fresh);
			const pendingActions = await readPendingCollaboratorActions(props.authUserId, props.docId);
			setPendingActionCount(pendingActions.length);
		} catch {
			if (!hadCache) {
				setSnapshot(props.offlineCanManageHint && props.authUserId ? buildOfflineManagerSnapshot(props.authUserId, props.docId, null) : EMPTY_SNAPSHOT);
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
		if (!props.isOpen) return;
		if (typeof window === 'undefined') return;
		const eventName = getShareLinkReadyEventName();
		const onShareReady = (event: Event) => {
			const detail = (event as CustomEvent<{ entityType: string; entityId: string; permission: string; expiresInDays: ShareExpiryDays }>).detail;
			if (!detail || detail.entityType !== 'note' || detail.entityId !== props.docId) return;
			const cached = readCachedNoteShareLink({ docId: detail.entityId, permission: detail.permission as NoteShareRole, expiresInDays: detail.expiresInDays });
			if (cached) {
				setShareLink(cached);
				if (cached.shareUrl) setShareQrModalOpen(true);
			}
		};
		window.addEventListener(eventName, onShareReady as EventListener);
		return () => {
			window.removeEventListener(eventName, onShareReady as EventListener);
		};
	}, [props.docId, props.isOpen]);

	React.useEffect(() => {
		if (props.isOpen) return;
		setIdentifier('');
		setRole('EDITOR');
		setShareRole('');
		setExpiryDays(7);
		setOpenPanel('invite');
		setShareQrModalOpen(false);
		setShareLink(null);
		setShareQrDataUrl(null);
		setError(null);
		setSuccess(null);
		setPendingActionCount(0);
		setSnapshot(EMPTY_SNAPSHOT);
	}, [props.isOpen]);

	React.useEffect(() => {
		if (!props.isOpen) return;
		if (!snapshot.canManage && openPanel !== 'collaborators') {
			setOpenPanel('collaborators');
		}
	}, [openPanel, props.isOpen, snapshot.canManage]);

	const handleInvite = React.useCallback(async () => {
		if (!props.docId || !props.authUserId || !identifier.trim()) return;
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			const normalizedIdentifier = identifier.trim();
			if (typeof navigator !== 'undefined' && navigator.onLine === false) {
				await queueNoteShareCollaboratorInviteAction({ userId: props.authUserId, docId: props.docId, identifier: normalizedIdentifier, role });
				setIdentifier('');
				await loadCachedState();
				props.onChanged?.();
				return;
			}
			await createNoteShareInvitation({ docId: props.docId, identifier: normalizedIdentifier, role });
			setIdentifier('');
			await load();
			props.onChanged?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.inviteFailed'));
		} finally {
			setBusy(false);
		}
	}, [identifier, load, loadCachedState, props, role, t]);

	const handleGenerateShareLink = React.useCallback(async (forceRefresh: boolean) => {
		if (!props.docId) return;
		if (!shareRole) {
			setError(t('share.roleRequired'));
			return;
		}
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			const next = await ensureNoteShareLink({
				userId: props.authUserId,
				docId: props.docId,
				permission: shareRole,
				expiresInDays: expiryDays,
				forceRefresh,
			});
			setShareLink(next);
			if (next.shareUrl) setShareQrModalOpen(true);
			setSuccess(next.pending ? t('share.linkQueued') : t('share.linkReady'));
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.createFailed'));
		} finally {
			setBusy(false);
		}
	}, [expiryDays, props.authUserId, props.docId, shareRole, t]);

	const handleCopyShareLink = React.useCallback(async () => {
		if (!shareLink?.shareUrl) return;
		try {
			await copyTextToClipboard(shareLink.shareUrl);
			setSuccess(t('share.copied'));
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.copyFailed'));
		}
	}, [shareLink, t]);

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
					collaboratorUserId,
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
		<>
			<div className={styles.overlay} role="presentation" onClick={props.onClose}>
				<section className={styles.collabModal} role="dialog" aria-modal="true" aria-label={t('share.collaborators')} onClick={(event) => event.stopPropagation()}>
					<header className={styles.collabHeader}>
						<div className={styles.titleBlock}>
							<h2 className={styles.title}>{t('share.collaborators')}</h2>
							<p className={styles.subtitle}>{props.noteTitle || t('note.untitled')}</p>
						</div>
						<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label={t('common.close')}>
							✕
						</button>
					</header>

					{error ? <div className={styles.error}>{error}</div> : null}
					{success ? <div className={styles.success}>{success}</div> : null}
					{!isOffline && (syncing || pendingActionCount > 0) ? <div className={styles.info}>{t('share.collaboratorSyncPending')}</div> : null}
					{!snapshot.canManage ? <div className={styles.info}>{t('share.viewOnlyAccess')}</div> : null}

					<div className={styles.collabModalBody}>
						{snapshot.canManage ? (
							<>
								<div className={`${styles.sectionDisclosure} ${openPanel === 'invite' ? styles.sectionDisclosureExpanded : ''}`}>
									<button type="button" className={`${styles.sectionSummaryButton} ${openPanel === 'invite' ? styles.sectionSummaryButtonExpanded : ''}`} onClick={() => setOpenPanel('invite')} aria-expanded={openPanel === 'invite'}>
										<span className={styles.sectionSummaryLabel}>{t('share.sendInvite')}</span>
										<span className={styles.disclosureArrow} aria-hidden="true" />
									</button>
									<div className={`${styles.sectionPanel} ${openPanel === 'invite' ? styles.sectionPanelExpanded : ''}`} aria-hidden={openPanel !== 'invite'}>
										<div className={styles.sectionPanelInner}>
											<div className={`${styles.sectionCard} ${styles.inviteSectionCard}`}>
												<label className={styles.field}>
													<span>{t('share.identifierPlaceholder')}</span>
													<input className={styles.input} value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={t('share.identifierPlaceholder')} disabled={busy} />
												</label>
												<label className={styles.field}>
													<span>{t('share.requiredRole')}</span>
													<select className={styles.select} value={role} onChange={(event) => setRole(event.target.value === 'VIEWER' ? 'VIEWER' : 'EDITOR')} disabled={busy}>
														<option value="EDITOR">{t('share.roleEditor')}</option>
														<option value="VIEWER">{t('share.roleViewer')}</option>
													</select>
												</label>
												<div className={styles.inlineActions}>
													<button type="button" className={styles.primaryButton} onClick={() => void handleInvite()} disabled={busy || !identifier.trim()}>
														{busy ? t('common.loading') : t('share.sendInvite')}
													</button>
												</div>
											</div>
										</div>
									</div>
								</div>

								<div className={`${styles.sectionDisclosure} ${openPanel === 'link' ? styles.sectionDisclosureExpanded : ''}`}>
									<button type="button" className={`${styles.sectionSummaryButton} ${openPanel === 'link' ? styles.sectionSummaryButtonExpanded : ''}`} onClick={() => setOpenPanel('link')} aria-expanded={openPanel === 'link'}>
										<span className={styles.sectionSummaryLabel}>{t('share.linkSectionTitle')}</span>
										<span className={styles.disclosureArrow} aria-hidden="true" />
									</button>
									<div className={`${styles.sectionPanel} ${openPanel === 'link' ? styles.sectionPanelExpanded : ''}`} aria-hidden={openPanel !== 'link'}>
										<div className={styles.sectionPanelInner}>
											<div className={`${styles.sectionCard} ${styles.inviteSectionCard}`}>
												<div className={styles.fieldGrid}>
													<label className={styles.field}>
														<span>{t('share.requiredRole')}</span>
														<select className={styles.select} value={shareRole} onChange={(event) => setShareRole((event.target.value as NoteShareRole) || '')} disabled={busy}>
															<option value="">{t('share.selectRole')}</option>
															<option value="VIEWER">{t('share.roleViewer')}</option>
															<option value="EDITOR">{t('share.roleEditor')}</option>
														</select>
													</label>
													<label className={styles.field}>
														<span>{t('share.expiration')}</span>
														<select className={styles.select} value={expiryDays} onChange={(event) => setExpiryDays(Number(event.target.value) as ShareExpiryDays)} disabled={busy}>
															<option value={1}>{t('share.expiration1Day')}</option>
															<option value={7}>{t('share.expiration7Days')}</option>
															<option value={30}>{t('share.expiration30Days')}</option>
														</select>
													</label>
												</div>
												<div className={styles.inlineActions}>
													<button type="button" className={styles.primaryButton} onClick={() => void handleGenerateShareLink(Boolean(shareLink))} disabled={busy || !shareRole}>
														{busy ? t('common.loading') : shareLink ? t('share.refresh') : t('share.generateLink')}
													</button>
													{shareLink?.shareUrl ? (
														<button type="button" className={styles.secondaryButton} onClick={() => setShareQrModalOpen(true)} disabled={busy}>
															{t('share.viewQrCode')}
														</button>
													) : null}
												</div>
												{shareLink ? (
													<div className={styles.generatedStatus}>
														<div className={styles.metaRow}>
															<span className={styles.badge}>{renderNoteRole(shareLink.permission, t)}</span>
															{shareLink.expiresAt ? <span className={styles.rowMeta}>{t('share.expiresAt')}: {formatExpiry(shareLink.expiresAt)}</span> : null}
														</div>
														{shareLink.shareUrl ? <div className={styles.info}>{t('share.viewQrCode')}</div> : <div className={styles.info}>{t('share.linkQueued')}</div>}
													</div>
												) : null}
											</div>
										</div>
									</div>
								</div>

								<div className={`${styles.sectionDisclosure} ${openPanel === 'pending' ? styles.sectionDisclosureExpanded : ''}`}>
									<button type="button" className={`${styles.sectionSummaryButton} ${openPanel === 'pending' ? styles.sectionSummaryButtonExpanded : ''}`} onClick={() => setOpenPanel('pending')} aria-expanded={openPanel === 'pending'}>
										<span className={styles.sectionSummaryLabel}>{t('share.pendingInvitations')}</span>
										<span className={styles.summaryCount}>{snapshot.pendingInvitations.length}</span>
										<span className={styles.disclosureArrow} aria-hidden="true" />
									</button>
									<div className={`${styles.sectionPanel} ${openPanel === 'pending' ? styles.sectionPanelExpanded : ''}`} aria-hidden={openPanel !== 'pending'}>
										<div className={styles.sectionPanelInner}>
											<div className={styles.listSection}>
												{snapshot.pendingInvitations.length === 0 ? <div className={styles.emptyState}>{t('share.nonePending')}</div> : null}
												{snapshot.pendingInvitations.map((invitation) => (
													<div key={invitation.id} className={styles.listRow}>
														<div className={styles.memberIdentity}>
															<div className={styles.memberAvatarStack}>
																<div className={styles.memberAvatarFallback} aria-hidden="true">
																	{(invitation.inviteeName || invitation.inviteeEmail).slice(0, 1).toUpperCase()}
																</div>
																<span className={`${styles.badge} ${styles.badgePending}`}>{t('share.statusPending')}</span>
															</div>
															<div className={styles.rowCopy}>
																<div className={styles.rowPrimary}>{invitation.inviteeName || invitation.inviteeEmail}</div>
																<div className={styles.rowSecondary}>{invitation.inviteeEmail}</div>
																<div className={styles.rowTertiary}>{renderNoteRole(invitation.role, t)}</div>
															</div>
														</div>
													</div>
												))}
											</div>
										</div>
									</div>
								</div>
							</>
						) : null}

						<div className={`${styles.sectionDisclosure} ${openPanel === 'collaborators' ? styles.sectionDisclosureExpanded : ''}`}>
							<button type="button" className={`${styles.sectionSummaryButton} ${openPanel === 'collaborators' ? styles.sectionSummaryButtonExpanded : ''}`} onClick={() => setOpenPanel('collaborators')} aria-expanded={openPanel === 'collaborators'}>
								<span className={styles.sectionSummaryLabel}>{t('share.activeCollaborators')}</span>
								<span className={styles.summaryCount}>{visibleCollaboratorCount}</span>
								<span className={styles.disclosureArrow} aria-hidden="true" />
							</button>
							<div className={`${styles.sectionPanel} ${openPanel === 'collaborators' ? styles.sectionPanelExpanded : ''}`} aria-hidden={openPanel !== 'collaborators'}>
								<div className={styles.sectionPanelInner}>
									<div className={styles.listSection}>
										{visibleCollaboratorCount === 0 ? <div className={styles.emptyState}>{t('share.noneCollaborators')}</div> : null}
										{snapshot.sharedBy ? (
											<div className={styles.listRow}>
												<div className={styles.memberIdentity}>
													<div className={styles.memberAvatarStack}>
														{snapshot.sharedBy.profileImage ? (
															<img className={styles.memberAvatar} src={snapshot.sharedBy.profileImage} alt="" />
														) : (
															<div className={styles.memberAvatarFallback} aria-hidden="true">
																{(snapshot.sharedBy.name || snapshot.sharedBy.email || snapshot.sharedBy.id).slice(0, 1).toUpperCase()}
															</div>
														)}
														<span className={`${styles.badge} ${styles.badgeAccepted}`}>{t('share.statusAccepted')}</span>
													</div>
													<div className={styles.rowCopy}>
														<div className={styles.rowPrimary}>{snapshot.sharedBy.name || snapshot.sharedBy.email || snapshot.sharedBy.id}</div>
														<div className={styles.rowSecondary}>{snapshot.sharedBy.email}</div>
													</div>
												</div>
												{snapshot.selfCollaboratorId ? (
													<button type="button" className={`${styles.secondaryButton} ${styles.memberActionButton}`} onClick={() => void handleRemove()} disabled={busy}>
														{t('editors.remove')}
													</button>
												) : null}
											</div>
										) : null}
										{snapshot.collaborators.map((collaborator) => (
											<div key={collaborator.id} className={`${styles.listRow} ${styles.memberRow}`}>
												<div className={styles.memberIdentity}>
													<div className={styles.memberAvatarStack}>
														{collaborator.user?.profileImage ? (
															<img className={styles.memberAvatar} src={collaborator.user.profileImage} alt="" />
														) : (
															<div className={styles.memberAvatarFallback} aria-hidden="true">
																{(collaborator.user?.name || collaborator.user?.email || collaborator.userId).slice(0, 1).toUpperCase()}
															</div>
														)}
														<span className={`${styles.badge} ${styles.badgeAccepted}`}>{t('share.statusAccepted')}</span>
													</div>
													<div className={styles.rowCopy}>
														<div className={styles.rowPrimary}>{collaborator.user?.name || collaborator.user?.email || collaborator.userId}</div>
														<div className={styles.rowSecondary}>{collaborator.user?.email || renderNoteRole(collaborator.role, t)}</div>
														{isWorkspaceInheritedCollaborator(collaborator) ? <div className={styles.rowTertiary}>{t('share.inheritedWorkspaceAccess')}</div> : null}
													</div>
												</div>
												{snapshot.canManage && !isWorkspaceInheritedCollaborator(collaborator) ? (
													<select className={`${styles.compactSelect} ${styles.memberRoleSelect}`} value={collaborator.role} onChange={(event) => void handleRoleChange(collaborator.id, collaborator.userId, event.target.value === 'VIEWER' ? 'VIEWER' : 'EDITOR')} disabled={busy || loading}>
														<option value="EDITOR">{t('share.roleEditor')}</option>
														<option value="VIEWER">{t('share.roleViewer')}</option>
													</select>
												) : collaborator.userId === snapshot.currentUserId && !isWorkspaceInheritedCollaborator(collaborator) ? (
													<button type="button" className={`${styles.secondaryButton} ${styles.memberActionButton}`} onClick={() => void handleRemove()} disabled={busy || !snapshot.selfCollaboratorId}>
														{t('editors.remove')}
													</button>
												) : null}
												{snapshot.canManage && !isWorkspaceInheritedCollaborator(collaborator) ? (
													<button type="button" className={`${styles.secondaryButton} ${styles.memberRemoveButton}`} onClick={() => void handleRevoke(collaborator.id)} disabled={busy || loading}>
														{t('share.revoke')}
													</button>
												) : null}
											</div>
										))}
									</div>
								</div>
							</div>
						</div>
					</div>
				</section>
			</div>
			{shareQrModalOpen && shareLink ? (
				<div className={styles.qrModalOverlay} role="presentation" onClick={() => setShareQrModalOpen(false)}>
					<section className={styles.qrModal} role="dialog" aria-modal="true" aria-label={t('share.linkSectionTitle')} onClick={(event) => event.stopPropagation()}>
						<header className={styles.qrModalHeader}>
							<div className={styles.titleBlock}>
								<h3 className={styles.title}>{t('share.linkSectionTitle')}</h3>
								<p className={styles.subtitle}>{props.noteTitle || t('note.untitled')}</p>
							</div>
							<button type="button" className={styles.iconButton} onClick={() => setShareQrModalOpen(false)} aria-label={t('common.close')}>
								✕
							</button>
						</header>
						<div className={styles.qrModalBody}>
							<div className={styles.metaRow}>
								<span className={styles.badge}>{renderNoteRole(shareLink.permission, t)}</span>
								{shareLink.expiresAt ? <span className={styles.rowMeta}>{t('share.expiresAt')}: {formatExpiry(shareLink.expiresAt)}</span> : null}
							</div>
							{shareLink.shareUrl ? <div className={styles.linkValue}>{shareLink.shareUrl}</div> : <div className={styles.info}>{t('share.linkQueued')}</div>}
							{shareQrDataUrl ? (
								<div className={styles.qrCard}>
									<img className={styles.qrImage} src={shareQrDataUrl} alt={t('share.qrAlt')} />
								</div>
							) : null}
							<div className={styles.qrModalActions}>
								<button type="button" className={styles.primaryButton} onClick={() => void handleCopyShareLink()} disabled={!shareLink.shareUrl || busy}>
									{t('share.copy')}
								</button>
								<button type="button" className={styles.primaryButton} onClick={() => void handleGenerateShareLink(true)} disabled={busy || !shareRole}>
									{busy ? t('common.loading') : t('share.refresh')}
								</button>
								<button type="button" className={styles.secondaryButton} onClick={() => setShareQrModalOpen(false)}>
									{t('common.close')}
								</button>
							</div>
						</div>
					</section>
				</div>
			) : null}
		</>
	);
}
