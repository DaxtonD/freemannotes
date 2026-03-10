import React from 'react';
import QRCode from 'qrcode';
import styles from './SendInviteModal.module.css';
import {
	copyTextToClipboard,
	ensureWorkspaceInviteLink,
	readCachedWorkspaceInviteLink,
	sendWorkspaceInviteEmail,
	type WorkspaceInviteLink,
} from '../../core/shareLinks';

type Props = {
	isOpen: boolean;
	onClose: () => void;
	t: (key: string) => string;
	workspaceId: string | null;
	workspaceName?: string | null;
};

function formatExpiry(value: string): string {
	const ms = Date.parse(value);
	if (!Number.isFinite(ms)) return value;
	return new Date(ms).toLocaleString();
}

export function SendInviteModal(props: Props): React.JSX.Element | null {
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [success, setSuccess] = React.useState<string | null>(null);
	const [email, setEmail] = React.useState('');
	const [role, setRole] = React.useState<'MEMBER' | 'ADMIN'>('MEMBER');
	const [inviteLink, setInviteLink] = React.useState<WorkspaceInviteLink | null>(null);
	const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);

	React.useEffect(() => {
		if (props.isOpen) return;
		setBusy(false);
		setError(null);
		setSuccess(null);
		setEmail('');
		setRole('MEMBER');
		setInviteLink(null);
		setQrDataUrl(null);
	}, [props.isOpen]);

	React.useEffect(() => {
		// QR generation is intentionally decoupled from link creation so the modal can
		// reuse the same invite link state for copy/open/email flows and only render the
		// QR once a concrete URL exists.
		if (!inviteLink?.inviteUrl) {
			setQrDataUrl(null);
			return;
		}
		let cancelled = false;
		QRCode.toDataURL(inviteLink.inviteUrl, {
			margin: 1,
			width: 280,
			errorCorrectionLevel: 'M',
		})
			.then((next) => {
				if (!cancelled) setQrDataUrl(next);
			})
			.catch(() => {
				if (!cancelled) setQrDataUrl(null);
			});
		return () => {
			cancelled = true;
		};
	}, [inviteLink]);

	React.useEffect(() => {
		setInviteLink(null);
		setQrDataUrl(null);
		setSuccess(null);
		setError(null);
	}, [email, role]);

	const canShare = Boolean(props.workspaceId) && email.trim().length > 0;

	const generateLink = React.useCallback(async (forceRefresh: boolean) => {
		// "Generate link" is the non-SMTP path. It creates or refreshes the invite URL,
		// stores it in client cache for offline reuse, and leaves delivery to copy/QR or
		// a later explicit email send.
		if (busy) return;
		if (!props.workspaceId) {
			setError(props.t('invite.noWorkspace'));
			return;
		}
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			const next = await ensureWorkspaceInviteLink({
				workspaceId: props.workspaceId,
				email,
				role,
				forceRefresh,
			});
			setInviteLink(next);
			const cached = readCachedWorkspaceInviteLink({ workspaceId: props.workspaceId, email, role });
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
	}, [busy, email, props, role]);

	const send = React.useCallback(async () => {
		// Email send runs through the same backend invite creation flow but asks the
		// server to dispatch SMTP immediately. We still keep the returned link locally
		// so the admin can copy or open exactly what the recipient will receive.
		if (busy) return;
		if (!props.workspaceId) {
			setError(props.t('invite.noWorkspace'));
			return;
		}
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			const next = await sendWorkspaceInviteEmail({ workspaceId: props.workspaceId, email, role });
			setInviteLink(next);
			setSuccess(props.t('invite.sent'));
		} catch (err) {
			setError(err instanceof Error ? err.message : props.t('invite.sendFailed'));
		} finally {
			setBusy(false);
		}
	}, [busy, email, props, role]);

	const copyLink = React.useCallback(async () => {
		if (!inviteLink?.inviteUrl) return;
		try {
			await copyTextToClipboard(inviteLink.inviteUrl);
			setSuccess(props.t('invite.copied'));
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : props.t('invite.copyFailed'));
		}
	}, [inviteLink, props]);

	const openLink = React.useCallback(() => {
		if (!inviteLink?.inviteUrl || typeof window === 'undefined') return;
		window.open(inviteLink.inviteUrl, '_blank', 'noopener,noreferrer');
	}, [inviteLink]);

	if (!props.isOpen) return null;

	return (
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

				<div className={styles.info}>{props.t('invite.emailMatchNotice')}</div>
				{error ? <div className={styles.error}>{error}</div> : null}
				{success ? <div className={styles.success}>{success}</div> : null}

				<label className={styles.field}>
					<span>{props.t('invite.email')}</span>
					<input className={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
				</label>

				<label className={styles.field}>
					<span>{props.t('invite.role')}</span>
					<select className={styles.input} value={role} onChange={(e) => setRole(e.target.value as 'MEMBER' | 'ADMIN')} disabled={busy}>
						<option value="MEMBER">{props.t('invite.roleMember')}</option>
						<option value="ADMIN">{props.t('invite.roleAdmin')}</option>
					</select>
				</label>

				{inviteLink ? (
					<>
						<div className={styles.field}>
							<span>{props.t('invite.linkLabel')}</span>
							<div className={styles.linkValue}>{inviteLink.inviteUrl}</div>
						</div>
						<div className={styles.meta}>
							{props.t('invite.expiresAt')}: {formatExpiry(inviteLink.expiresAt)}
						</div>
						{qrDataUrl ? (
							<div className={styles.qrCard}>
								<img className={styles.qrImage} src={qrDataUrl} alt={props.t('share.qrAlt')} />
							</div>
						) : null}
					</>
				) : null}

				<footer className={styles.footer}>
					{/* Footer actions intentionally split link generation from delivery:
					   close = dismiss, copy/open = reuse current URL, generate = mint/refresh
					   without email, send = mint and email in one step. */}
					<button type="button" onClick={props.onClose} disabled={busy}>
						{props.t('common.close')}
					</button>
					<button type="button" onClick={() => void copyLink()} disabled={busy || !inviteLink?.inviteUrl}>
						{props.t('share.copy')}
					</button>
					<button type="button" onClick={openLink} disabled={!inviteLink?.inviteUrl}>
						{props.t('share.open')}
					</button>
					<button type="button" onClick={() => void generateLink(Boolean(inviteLink))} disabled={busy || !canShare}>
						{busy ? props.t('common.loading') : inviteLink ? props.t('share.refresh') : props.t('invite.generateLink')}
					</button>
					<button type="button" onClick={() => void send()} disabled={busy || !canShare}>
						{busy ? props.t('common.loading') : props.t('invite.send')}
					</button>
				</footer>
			</section>
		</div>
	);
}
