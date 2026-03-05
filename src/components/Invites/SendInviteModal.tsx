import React from 'react';
import styles from './SendInviteModal.module.css';

type Props = {
	isOpen: boolean;
	onClose: () => void;
	t: (key: string) => string;
	workspaceId: string | null;
};

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
	const res = await fetch(input, { credentials: 'include', ...init });
	const contentType = String(res.headers.get('content-type') || '').toLowerCase();
	const body = contentType.includes('application/json') ? await res.json().catch(() => null) : null;
	if (!res.ok) {
		const message = body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
		throw new Error(message);
	}
	return body as T;
}

export function SendInviteModal(props: Props): React.JSX.Element | null {
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [success, setSuccess] = React.useState<string | null>(null);
	const [email, setEmail] = React.useState('');
	const [role, setRole] = React.useState<'MEMBER' | 'ADMIN'>('MEMBER');

	React.useEffect(() => {
		if (props.isOpen) return;
		setBusy(false);
		setError(null);
		setSuccess(null);
		setEmail('');
		setRole('MEMBER');
	}, [props.isOpen]);

	const canSend = Boolean(props.workspaceId) && email.trim().length > 0;

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
			await fetchJson<{ ok: true }>(`/api/workspaces/${encodeURIComponent(props.workspaceId)}/invites`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, role }),
			});
			setSuccess(props.t('invite.sent'));
		} catch (err) {
			setError(err instanceof Error ? err.message : props.t('invite.sendFailed'));
		} finally {
			setBusy(false);
		}
	}, [busy, email, props, role]);

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={styles.modal} role="dialog" aria-modal="true" aria-label={props.t('invite.title')} onClick={(e) => e.stopPropagation()}>
				<header className={styles.header}>
					<h2 className={styles.title}>{props.t('invite.title')}</h2>
					<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label={props.t('common.close')}>
						✕
					</button>
				</header>

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

				<footer className={styles.footer}>
					<button type="button" onClick={props.onClose} disabled={busy}>
						{props.t('common.close')}
					</button>
					<button type="button" onClick={() => void send()} disabled={busy || !canSend}>
						{busy ? props.t('common.loading') : props.t('invite.send')}
					</button>
				</footer>
			</section>
		</div>
	);
}
