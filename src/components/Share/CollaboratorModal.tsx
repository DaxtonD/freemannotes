import React from 'react';
import QRCode from 'qrcode';
import {
	cancelNoteShareInvitation,
	createNoteShareInvitation,
	flushPendingCollaboratorActions,
	queueNoteShareCollaboratorInviteAction,
	queueNoteShareCollaboratorRevokeAction,
	queueNoteShareCollaboratorRoleAction,
	readCachedNoteShareCollaborators,
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
	readAllCachedNoteShareLinks,
	readCachedNoteShareLink,
	type CachedNoteShareLink,
	type NoteShareLink,
	type ShareExpiryDays,
} from '../../core/shareLinks';
import { useI18n } from '../../core/i18n';
import { listPriorCollaborators, type PriorCollaboratorUser } from '../../core/priorCollaboratorsApi';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import { getWorkspaceMetadataChangedEventName } from '../../core/workspaceMetadataStore';
import { getCachedAvatarUrl } from '../../core/userAvatarCache';
import { PriorCollaboratorSuggestions } from './PriorCollaboratorSuggestions';
import styles from './CollaboratorModal.module.css';

type Props = {
	isOpen: boolean;
	onClose: () => void;
	authUserId: string | null;
	docId: string | null;
	offlineCanManageHint?: boolean;
	noteTitle: string;
	onChanged?: () => void;
	onAccessRemoved?: () => void;
	onSelfRemoved?: () => void;
};

const EMPTY_SNAPSHOT: NoteShareCollaboratorSnapshot = {
	roomId: '',
	sourceWorkspaceId: '',
	sourceNoteId: '',
	noteTitle: '',
	accessRole: 'EDITOR',
	canManage: false,
	currentUserId: null,
	currentUser: null,
	selfCollaboratorId: null,
	sharedBy: null,
	collaborators: [],
	pendingInvitations: [],
};

function isGatewayError(error: unknown): boolean {
	const status = (error as { status?: number } | null)?.status;
	return status === 502 || status === 503 || status === 504;
}

function buildOfflineManagerSnapshot(authUserId: string, docId: string, base?: NoteShareCollaboratorSnapshot | null): NoteShareCollaboratorSnapshot {
	return {
		roomId: base?.roomId || docId,
		sourceWorkspaceId: base?.sourceWorkspaceId || docId.split(':', 1)[0] || '',
		sourceNoteId: base?.sourceNoteId || (docId.includes(':') ? docId.slice(docId.indexOf(':') + 1) : docId),
		noteTitle: base?.noteTitle || '',
		accessRole: base?.accessRole || 'EDITOR',
		canManage: true,
		currentUserId: base?.currentUserId ?? authUserId,
		currentUser: base?.currentUser ?? null,
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

function getDisplayLabel(user: { name?: string | null; email?: string | null; id?: string | null } | null | undefined): string {
	if (!user) return '';
	return user.name || user.email || user.id || '';
}

function normalizeCollaboratorIdentifier(value: unknown): string {
	return String(value ?? '').trim().toLowerCase();
}

function isDuplicateCollaboratorIdentifier(snapshot: NoteShareCollaboratorSnapshot, rawIdentifier: string): boolean {
	const normalizedIdentifier = normalizeCollaboratorIdentifier(rawIdentifier);
	if (!normalizedIdentifier) return false;
	const matches = (...values: Array<unknown>): boolean => values.some((value) => normalizeCollaboratorIdentifier(value) === normalizedIdentifier);
	if (matches(snapshot.currentUser?.id, snapshot.currentUser?.email, snapshot.currentUser?.name, snapshot.currentUserId)) {
		return true;
	}
	if (matches(snapshot.sharedBy?.id, snapshot.sharedBy?.email, snapshot.sharedBy?.name)) {
		return true;
	}
	for (const collaborator of snapshot.collaborators) {
		if (matches(collaborator.id, collaborator.userId, collaborator.user?.id, collaborator.user?.email, collaborator.user?.name)) {
			return true;
		}
	}
	for (const invitation of snapshot.pendingInvitations) {
		if (matches(invitation.inviteeId, invitation.inviteeEmail, invitation.inviteeName)) {
			return true;
		}
	}
	return false;
}

/** Avatar image with automatic fallback to initial letter when the image fails to load (e.g. offline SW cache miss). */
function MemberAvatar({ src, initial, className, fallbackClassName }: { src: string | null | undefined; initial: string; className: string; fallbackClassName: string }): React.JSX.Element {
	const [broken, setBroken] = React.useState(false);
	React.useEffect(() => { setBroken(false); }, [src]);
	if (!src || broken) {
		return <div className={fallbackClassName} aria-hidden="true">{initial}</div>;
	}
	return <img className={className} src={src} alt="" onError={() => setBroken(true)} />;
}

export function CollaboratorModal(props: Props): React.JSX.Element | null {
	const { t } = useI18n();
	const [busy, setBusy] = React.useState(false);
	const [loading, setLoading] = React.useState(false);
	const [accessResolved, setAccessResolved] = React.useState(false);
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
	// All non-expired share links for this note across every role/expiry combo.
	// Populated from localStorage on open so previously generated links are
	// immediately visible without a server round-trip.
	const [cachedLinks, setCachedLinks] = React.useState<CachedNoteShareLink[]>([]);
	const [isOffline, setIsOffline] = React.useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
	const [snapshot, setSnapshot] = React.useState<NoteShareCollaboratorSnapshot>(EMPTY_SNAPSHOT);
	const [priorCollaborators, setPriorCollaborators] = React.useState<PriorCollaboratorUser[]>([]);
	const [loadingPriorCollaborators, setLoadingPriorCollaborators] = React.useState(false);
	const [identifierFocused, setIdentifierFocused] = React.useState(false);
	const [dismissSuggestions, setDismissSuggestions] = React.useState(false);
	const loadRequestIdRef = React.useRef(0);
	const statusMessage = error ?? success;
	const statusClassName = error ? styles.error : styles.success;
	const sourceWorkspaceId = React.useMemo(() => {
		if (!props.docId) return null;
		const separator = props.docId.indexOf(':');
		return separator > 0 ? props.docId.slice(0, separator) : props.docId;
	}, [props.docId]);

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

	// Reload cached share links before paint so the link section does not grow in after open.
	React.useLayoutEffect(() => {
		if (!props.isOpen || !props.docId) {
			setCachedLinks([]);
			return;
		}
		setCachedLinks(readAllCachedNoteShareLinks(props.docId));
	}, [props.isOpen, props.docId]);

	// Seed an optimistic manager snapshot before paint for owned notes so accordion
	// sections and controls are stable on the first frame (IDB hydrate follows).
	React.useLayoutEffect(() => {
		if (!props.isOpen || !props.authUserId || !props.docId || !props.offlineCanManageHint) return;
		setSnapshot((current) => (
			current.canManage ? current : buildOfflineManagerSnapshot(props.authUserId!, props.docId!, current.sourceNoteId ? current : null)
		));
	}, [props.authUserId, props.docId, props.isOpen, props.offlineCanManageHint]);

	const loadCachedState = React.useCallback(async (): Promise<boolean> => {
		if (!props.authUserId || !props.docId) return false;
		const cached = await readCachedNoteShareCollaborators(props.authUserId, props.docId);
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
		const requestId = loadRequestIdRef.current + 1;
		loadRequestIdRef.current = requestId;
		setAccessResolved(false);
		setLoading(true);
		setError(null);
		const hadCache = await loadCachedState();
		if (loadRequestIdRef.current !== requestId) return;
		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			setAccessResolved(true);
			setLoading(false);
			return;
		}
		try {
			await flushPendingCollaboratorActions(props.authUserId);
			const fresh = await syncNoteShareCollaborators(props.authUserId, props.docId, { suppressError: true });
			if (loadRequestIdRef.current !== requestId) return;
			if (!fresh) {
				setSnapshot(EMPTY_SNAPSHOT);
				props.onAccessRemoved?.();
				return;
			}
			setSnapshot(fresh);
		} catch {
			if (loadRequestIdRef.current !== requestId) return;
			if (!hadCache) {
				setSnapshot(props.offlineCanManageHint && props.authUserId ? buildOfflineManagerSnapshot(props.authUserId, props.docId, null) : EMPTY_SNAPSHOT);
			}
		} finally {
			if (loadRequestIdRef.current !== requestId) return;
			setAccessResolved(true);
			setLoading(false);
		}
	}, [loadCachedState, props.authUserId, props.docId, props.offlineCanManageHint, props.onAccessRemoved]);

	const loadRef = React.useRef(load);

	React.useEffect(() => {
		loadRef.current = load;
	}, [load]);

	React.useEffect(() => {
		if (!props.isOpen || !props.docId || !props.authUserId) return;
		void loadRef.current();
	}, [props.authUserId, props.docId, props.isOpen]);

	React.useEffect(() => {
		if (!props.isOpen || !props.authUserId) return;
		let cancelled = false;
		setLoadingPriorCollaborators(true);
		listPriorCollaborators()
			.then((users) => {
				if (!cancelled) setPriorCollaborators(users);
			})
			.catch(() => {
				if (!cancelled) setPriorCollaborators([]);
			})
			.finally(() => {
				if (!cancelled) setLoadingPriorCollaborators(false);
			});
		return () => {
			cancelled = true;
		};
	}, [props.authUserId, props.isOpen]);

	React.useEffect(() => {
		if (!props.isOpen) return;
		if (typeof window === 'undefined') return;
		const eventName = getShareLinkReadyEventName();
		const metadataEventName = getWorkspaceMetadataChangedEventName();
		const onShareReady = (event: Event) => {
			const detail = (event as CustomEvent<{ entityType: string; entityId: string; permission: string; expiresInDays: ShareExpiryDays }>).detail;
			if (!detail || detail.entityType !== 'note' || detail.entityId !== props.docId) return;
			const cached = readCachedNoteShareLink({ docId: detail.entityId, permission: detail.permission as NoteShareRole, expiresInDays: detail.expiresInDays });
			if (cached) {
				setShareLink(cached);
				if (cached.shareUrl) setShareQrModalOpen(true);
			}
		};
		const onMetadataChanged = (event: Event) => {
			const detail = (event as CustomEvent<{ reason?: string; workspaceId?: string | null; docId?: string | null }>).detail;
			const matchesCurrentDoc = typeof detail?.docId === 'string' && detail.docId === props.docId;
			const matchesSourceWorkspace = typeof detail?.workspaceId === 'string' && detail.workspaceId === sourceWorkspaceId;
			if (detail?.reason !== 'user-profile-updated' && !matchesCurrentDoc && !matchesSourceWorkspace) return;
			void loadRef.current();
		};
		window.addEventListener(eventName, onShareReady as EventListener);
		window.addEventListener(metadataEventName, onMetadataChanged as EventListener);
		return () => {
			window.removeEventListener(eventName, onShareReady as EventListener);
			window.removeEventListener(metadataEventName, onMetadataChanged as EventListener);
		};
	}, [props.docId, props.isOpen, sourceWorkspaceId]);

	React.useEffect(() => {
		if (props.isOpen) return;
		loadRequestIdRef.current += 1;
		setAccessResolved(false);
		setIdentifier('');
		setIdentifierFocused(false);
		setDismissSuggestions(false);
		setRole('EDITOR');
		setShareRole('');
		setExpiryDays(7);
		setOpenPanel('invite');
		setShareQrModalOpen(false);
		setShareLink(null);
		setShareQrDataUrl(null);
		setError(null);
		setSuccess(null);
		setSnapshot(EMPTY_SNAPSHOT);
	}, [props.isOpen]);

	React.useEffect(() => {
		if (!props.isOpen) return;
		if (accessResolved && !snapshot.canManage && openPanel !== 'collaborators') {
			setOpenPanel('collaborators');
		}
	}, [accessResolved, openPanel, props.isOpen, snapshot.canManage]);

	const filteredPriorCollaborators = React.useMemo(() => {
		const query = identifier.trim().toLowerCase();
		return priorCollaborators.filter((user) => {
			if (!user.email) return false;
			if (isDuplicateCollaboratorIdentifier(snapshot, user.email)) return false;
			if (!query) return true;
			const name = (user.name || '').toLowerCase();
			const email = user.email.toLowerCase();
			return name.includes(query) || email.includes(query);
		});
	}, [identifier, priorCollaborators, snapshot]);

	const showPriorCollaboratorSuggestions = identifierFocused && !dismissSuggestions && !busy;

	const handleSelectPriorCollaborator = React.useCallback((user: PriorCollaboratorUser) => {
		if (!user.email) return;
		setIdentifier(user.email);
		setDismissSuggestions(true);
		setError(null);
	}, []);

	const handleInvite = React.useCallback(async () => {
		if (!props.docId || !props.authUserId || !identifier.trim()) return;
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			const normalizedIdentifier = identifier.trim();
			if (isDuplicateCollaboratorIdentifier(snapshot, normalizedIdentifier)) {
				setError(t('share.duplicateCollaborator'));
				return;
			}
			if (typeof navigator !== 'undefined' && navigator.onLine === false) {
				await queueNoteShareCollaboratorInviteAction({ userId: props.authUserId, docId: props.docId, identifier: normalizedIdentifier, role });
				setIdentifier('');
				setSuccess(t('invite.pendingQueued'));
				await loadCachedState();
				props.onChanged?.();
				return;
			}
			try {
				await createNoteShareInvitation({ docId: props.docId, identifier: normalizedIdentifier, role });
				setIdentifier('');
				setSuccess(t('invite.sent'));
				await load();
				props.onChanged?.();
			} catch (err) {
				if (!isGatewayError(err)) throw err;
				// Server unreachable (502/503/504) — queue the invite for replay once online.
				await queueNoteShareCollaboratorInviteAction({ userId: props.authUserId, docId: props.docId, identifier: normalizedIdentifier, role });
				setIdentifier('');
				setSuccess(t('invite.pendingQueued'));
				await loadCachedState();
				props.onChanged?.();
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.inviteFailed'));
		} finally {
			setBusy(false);
		}
	}, [identifier, load, loadCachedState, props, role, snapshot, t]);

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
			// Refresh the active-links list so the new token appears immediately.
			if (props.docId) setCachedLinks(readAllCachedNoteShareLinks(props.docId));
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
			try {
				await revokeNoteShareCollaborator(collaboratorId);
				await load();
				props.onChanged?.();
			} catch (err) {
				if (!isGatewayError(err)) throw err;
				// Server unreachable — queue revoke for replay once online.
				await queueNoteShareCollaboratorRevokeAction({
					userId: props.authUserId,
					docId: props.docId,
					collaboratorId,
					collaboratorUserId: collaborator?.userId ?? null,
				});
				await loadCachedState();
				props.onChanged?.();
			}
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
			try {
				await revokeNoteShareCollaborator(snapshot.selfCollaboratorId);
				props.onSelfRemoved?.();
				props.onChanged?.();
			} catch (err) {
				if (!isGatewayError(err)) throw err;
				// Server unreachable — queue self-removal for replay once online.
				await queueNoteShareCollaboratorRevokeAction({
					userId: props.authUserId,
					docId: props.docId,
					collaboratorId: snapshot.selfCollaboratorId,
					collaboratorUserId: snapshot.currentUserId,
				});
				await loadCachedState();
				props.onChanged?.();
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.removeFailed'));
		} finally {
			setBusy(false);
		}
	}, [loadCachedState, props, snapshot.currentUserId, snapshot.selfCollaboratorId, t]);

	const handleCancelPendingInvitation = React.useCallback(async (invitationId: string) => {
		if (!props.docId) return;
		setBusy(true);
		setError(null);
		try {
			const result = await cancelNoteShareInvitation({
				userId: props.authUserId,
				docId: props.docId,
				invitationId,
			});
			if (result.localOnly) {
				// Queued offline invites only exist in local pending state, so a cache
				// reload is enough until the server has seen the invitation.
				await loadCachedState();
			} else {
				await load();
			}
			props.onChanged?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : t('invite.cancelInviteFailed'));
		} finally {
			setBusy(false);
		}
	}, [load, loadCachedState, props, t]);

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
			try {
				await updateNoteShareCollaboratorRole(collaboratorId, nextRole);
				await load();
				props.onChanged?.();
			} catch (err) {
				if (!isGatewayError(err)) throw err;
				// Server unreachable — queue role change for replay once online.
				await queueNoteShareCollaboratorRoleAction({
					userId: props.authUserId,
					docId: props.docId,
					collaboratorId,
					collaboratorUserId,
					role: nextRole,
				});
				await loadCachedState();
				props.onChanged?.();
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : t('share.roleUpdateFailed'));
		} finally {
			setBusy(false);
		}
	}, [load, loadCachedState, props, t]);

	const currentUserCollaborator = snapshot.currentUser && (snapshot.selfCollaboratorId || snapshot.sharedBy) ? snapshot.currentUser : null;
	const visibleCollaboratorCount = snapshot.collaborators.length + (snapshot.sharedBy ? 1 : 0);
	const resolvedNoteTitle = (props.noteTitle || snapshot.noteTitle || '').trim() || t('note.untitled');
	// App only opens this modal for users who can manage, but snapshot.canManage starts false
	// until IDB/server hydrate. Keep all accordion headers mounted until access resolves.
	const showManageSections = snapshot.canManage || !accessResolved;

	if (!props.isOpen) return null;

	return (
		<>
			<div className={styles.overlay} role="presentation" onClick={props.onClose}>
				<section className={styles.collabModal} role="dialog" aria-modal="true" aria-label={t('share.collaborators')} onClick={(event) => event.stopPropagation()}>
					<header className={styles.collabHeader}>
						<div className={styles.titleBlock}>
							<h2 className={styles.title}>{t('share.collaborators')}</h2>
							<p className={styles.subtitle}>{resolvedNoteTitle}</p>
						</div>
						<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label={t('common.close')}>
							✕
						</button>
					</header>

					{statusMessage ? <div className={statusClassName}>{statusMessage}</div> : null}
					{accessResolved && !snapshot.canManage ? <div className={styles.info}>{t('share.viewOnlyAccess')}</div> : null}

					<div className={styles.collabModalBody}>
						{showManageSections ? (
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
													<div className={styles.inputWithSuggestions}>
														<input id="collaborator-identifier" name="collaborator-identifier" type="text" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} data-bwignore="true" className={styles.input} value={identifier} onChange={(event) => { setIdentifier(event.target.value); setDismissSuggestions(false); }} onFocus={() => { setIdentifierFocused(true); setDismissSuggestions(false); }} onBlur={() => setIdentifierFocused(false)} placeholder={t('share.identifierPlaceholder')} disabled={busy} />
														{showPriorCollaboratorSuggestions ? (
															<PriorCollaboratorSuggestions
																items={filteredPriorCollaborators}
																loading={loadingPriorCollaborators}
																emptyLabel={t('share.collaboratorSuggestionsEmpty')}
																loadingLabel={t('share.collaboratorSuggestionsLoading')}
																onSelect={handleSelectPriorCollaborator}
															/>
														) : null}
													</div>
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
										{cachedLinks.length > 0 ? <span className={styles.summaryCount}>{cachedLinks.length}</span> : null}
										<span className={styles.disclosureArrow} aria-hidden="true" />
									</button>
									<div className={`${styles.sectionPanel} ${openPanel === 'link' ? styles.sectionPanelExpanded : ''}`} aria-hidden={openPanel !== 'link'}>
										<div className={styles.sectionPanelInner}>
											{cachedLinks.length > 0 ? (
												<div className={styles.activeLinkList}>
													{cachedLinks.map((link) => (
														<div key={`${link.permission}::${link.expiresInDays}`} className={styles.activeLinkRow}>
															<div className={styles.activeLinkMeta}>
																<span className={styles.badge}>{renderNoteRole(link.permission, t)}</span>
																{link.expiresAt ? <span className={styles.rowMeta}>{t('share.expiresAt')}: {formatExpiry(link.expiresAt)}</span> : null}
															</div>
															<div className={styles.activeLinkActions}>
																<button type="button" className={styles.secondaryButton} onClick={() => void copyTextToClipboard(link.shareUrl!).then(() => setSuccess(t('share.copied'))).catch(() => setError(t('share.copyFailed')))} disabled={!link.shareUrl || busy}>
																	{t('share.copy')}
																</button>
																<button type="button" className={styles.secondaryButton} onClick={() => { setShareLink(link); setShareRole(link.permission); setExpiryDays(link.expiresInDays); setShareQrModalOpen(true); }} disabled={!link.shareUrl || busy}>
																	{t('share.viewQrCode')}
																</button>
															</div>
														</div>
													))}
												</div>
											) : null}
											<div className={`${styles.sectionCard} ${styles.inviteSectionCard}`}>
												<p className={styles.activeLinkSectionLabel}>{t('share.generateNew')}</p>
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
													<button type="button" className={styles.primaryButton} onClick={() => void handleGenerateShareLink(false)} disabled={busy || !shareRole}>
														{busy ? t('common.loading') : t('share.generateLink')}
													</button>
												</div>
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
													<div key={invitation.id} className={`${styles.listRow} ${styles.pendingInviteRow}`}>
														<div className={styles.memberIdentity}>
															<div className={styles.memberAvatarStack}>
																<MemberAvatar
																	src={invitation.inviteeProfileImage ?? getCachedAvatarUrl(invitation.inviteeId ?? null)}
																	initial={(invitation.inviteeName || invitation.inviteeEmail).slice(0, 1).toUpperCase()}
																	className={styles.memberAvatar}
																	fallbackClassName={styles.memberAvatarFallback}
																/>
															</div>
															<div className={styles.rowCopy}>
																<div className={styles.rowPrimary}>{invitation.inviteeName || invitation.inviteeEmail}</div>
																<div className={styles.rowSecondary}>{invitation.inviteeEmail}</div>
																<div className={styles.rowMetaInline}>
																	<span className={`${styles.badge} ${styles.badgePending}`}>{t('share.statusPending')}</span>
																	<span className={styles.rowTertiary}>{renderNoteRole(invitation.role, t)}</span>
																</div>
															</div>
														</div>
														<div className={styles.memberActions}>
															<button
																type="button"
																className={`${styles.secondaryButton} ${styles.memberActionButton}`}
																onClick={() => void handleCancelPendingInvitation(invitation.id)}
																disabled={busy || loading || (isOffline && !invitation.id.startsWith('queued:'))}
															>
																{t('invite.cancelInvite')}
															</button>
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
										{currentUserCollaborator ? (
											<div className={`${styles.listRow} ${styles.memberRow}`}>
												<div className={styles.memberIdentity}>
													<div className={styles.memberAvatarStack}>
														<MemberAvatar
															src={currentUserCollaborator.profileImage}
															initial={getDisplayLabel(currentUserCollaborator).slice(0, 1).toUpperCase()}
															className={styles.memberAvatar}
															fallbackClassName={styles.memberAvatarFallback}
														/>
														<span className={`${styles.badge} ${styles.badgeAccepted}`}>{t('share.statusAccepted')}</span>
													</div>
													<div className={styles.rowCopy}>
														<div className={styles.rowPrimary}>{getDisplayLabel(currentUserCollaborator)}</div>
														<div className={styles.rowSecondary}>{currentUserCollaborator.email}</div>
														<div className={styles.rowTertiary}>{renderNoteRole(snapshot.accessRole, t)}</div>
													</div>
												</div>
												{snapshot.selfCollaboratorId ? (
													<div className={styles.memberActions}>
														<button type="button" className={`${styles.secondaryButton} ${styles.memberActionButton}`} onClick={() => void handleRemove()} disabled={busy || !snapshot.selfCollaboratorId}>
															{t('share.leaveNote')}
														</button>
													</div>
												) : null}
											</div>
										) : null}
										{snapshot.sharedBy ? (
											<div className={styles.listRow}>
												<div className={styles.memberIdentity}>
													<div className={styles.memberAvatarStack}>
														<MemberAvatar
															src={snapshot.sharedBy.profileImage}
															initial={getDisplayLabel(snapshot.sharedBy).slice(0, 1).toUpperCase()}
															className={styles.memberAvatar}
															fallbackClassName={styles.memberAvatarFallback}
														/>
														<span className={`${styles.badge} ${styles.badgeAccepted}`}>{t('invite.roleOwner')}</span>
													</div>
													<div className={styles.rowCopy}>
														<div className={styles.rowPrimary}>{getDisplayLabel(snapshot.sharedBy)}</div>
														<div className={styles.rowSecondary}>{snapshot.sharedBy.email}</div>
													</div>
												</div>
											</div>
										) : null}
										{snapshot.collaborators.map((collaborator) => (
											<div key={collaborator.id} className={`${styles.listRow} ${styles.memberRow}`}>
												<div className={styles.memberIdentity}>
													<div className={styles.memberAvatarStack}>
														<MemberAvatar
															src={collaborator.user?.profileImage}
															initial={getDisplayLabel(collaborator.user || { id: collaborator.userId }).slice(0, 1).toUpperCase()}
															className={styles.memberAvatar}
															fallbackClassName={styles.memberAvatarFallback}
														/>
														<span className={`${styles.badge} ${styles.badgeAccepted}`}>{t('share.statusAccepted')}</span>
													</div>
													<div className={styles.rowCopy}>
														<div className={styles.rowPrimary}>{getDisplayLabel(collaborator.user || { id: collaborator.userId })}</div>
														<div className={styles.rowSecondary}>{collaborator.user?.email || renderNoteRole(collaborator.role, t)}</div>
														{isWorkspaceInheritedCollaborator(collaborator) ? <div className={styles.rowTertiary}>{t('share.inheritedWorkspaceAccess')}</div> : null}
													</div>
												</div>
												{snapshot.canManage && !isWorkspaceInheritedCollaborator(collaborator) ? (
													<div className={styles.memberActions}>
														<select className={`${styles.compactSelect} ${styles.memberRoleSelect}`} value={collaborator.role} onChange={(event) => void handleRoleChange(collaborator.id, collaborator.userId, event.target.value === 'VIEWER' ? 'VIEWER' : 'EDITOR')} disabled={busy || loading}>
															<option value="EDITOR">{t('share.roleEditor')}</option>
															<option value="VIEWER">{t('share.roleViewer')}</option>
														</select>
														<button type="button" className={`${styles.secondaryButton} ${styles.memberRemoveButton}`} onClick={() => void handleRevoke(collaborator.id)} disabled={busy || loading}>
															{t('share.revoke')}
														</button>
													</div>
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
								<p className={styles.subtitle}>{resolvedNoteTitle}</p>
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
