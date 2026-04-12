import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import styles from './UserRegistrationInviteModal.module.css';

type Props = {
	isOpen: boolean;
	onClose: () => void;
	t: (key: string) => string;
};

type InviteResponse = {
	ok: boolean;
	email: string;
	expiresAt: string;
	inviteUrl: string;
};

async function postJson<T>(input: RequestInfo | URL, init: RequestInit): Promise<T> {
	const response = await fetch(input, {
		credentials: 'include',
		...init,
		headers: {
			'Content-Type': 'application/json',
			...(init.headers || {}),
		},
	});
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(body && typeof body.error === 'string' ? body.error : `Request failed (${response.status})`);
	}
	return body as T;
}

export function UserRegistrationInviteModal(props: Props): React.JSX.Element | null {
	const [email, setEmail] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [success, setSuccess] = React.useState<string | null>(null);
	const [inviteUrl, setInviteUrl] = React.useState<string | null>(null);
	useBodyScrollLock(props.isOpen, { disableTouchAction: false });

	React.useEffect(() => {
		if (!props.isOpen) return;
		setEmail('');
		setBusy(false);
		setError(null);
		setSuccess(null);
		setInviteUrl(null);
	}, [props.isOpen]);

	const handleSendInvite = React.useCallback(async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			const response = await postJson<InviteResponse>('/api/admin/user-invites', {
				method: 'POST',
				body: JSON.stringify({ email }),
			});
			// Keep the fallback link visible after success so admins can still deliver the
			// invite manually if the recipient asks for the raw URL.
			setInviteUrl(response.inviteUrl);
			setSuccess(props.t('adminInvite.sent'));
		} catch (nextError) {
			setError(nextError instanceof Error ? nextError.message : props.t('adminInvite.sendFailed'));
		} finally {
			setBusy(false);
		}
	}, [busy, email, props]);

	const handleCopyLink = React.useCallback(async () => {
		if (!inviteUrl) return;
		setError(null);
		try {
			await navigator.clipboard.writeText(inviteUrl);
			setSuccess(props.t('adminInvite.copied'));
		} catch {
			setError(props.t('adminInvite.copyFailed'));
		}
	}, [inviteUrl, props]);

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={styles.modal} role="dialog" aria-modal="true" aria-label={props.t('adminInvite.title')} onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<h2 className={styles.title}>{props.t('adminInvite.title')}</h2>
					<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label={props.t('common.close')}>
						<FontAwesomeIcon icon={faXmark} />
					</button>
				</header>

				<p className={styles.description}>{props.t('adminInvite.description')}</p>
				<p className={styles.notice}>{props.t('adminInvite.bypassNotice')}</p>

				<label className={styles.field}>
					<span className={styles.label}>{props.t('adminInvite.emailLabel')}</span>
					<input
						type="email"
						className={styles.input}
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						placeholder={props.t('adminInvite.emailPlaceholder')}
						autoComplete="email"
						disabled={busy}
					/>
				</label>

				{error ? <div className={styles.error}>{error}</div> : null}
				{success ? <div className={styles.success}>{success}</div> : null}

				{inviteUrl ? (
					<div className={styles.linkGroup}>
						<span className={styles.linkLabel}>{props.t('adminInvite.linkLabel')}</span>
						<div className={styles.linkValue}>{inviteUrl}</div>
					</div>
				) : null}

				<div className={styles.actions}>
					<button type="button" className={styles.secondaryButton} onClick={props.onClose} disabled={busy}>
						{props.t('common.close')}
					</button>
					{inviteUrl ? (
						<button type="button" className={styles.secondaryButton} onClick={() => void handleCopyLink()} disabled={busy}>
							<FontAwesomeIcon icon={faCopy} /> {props.t('adminInvite.copyLink')}
						</button>
					) : null}
					<button type="button" className={styles.primaryButton} onClick={() => void handleSendInvite()} disabled={busy || !email.trim()}>
						{busy ? props.t('adminInvite.sending') : props.t('adminInvite.sendAction')}
					</button>
				</div>
			</section>
		</div>
	);
}