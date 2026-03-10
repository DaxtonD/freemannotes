import React from 'react';
import QRCode from 'qrcode';
import styles from './NoteShareModal.module.css';
import { copyTextToClipboard, ensureDocShareLink, type NoteShareLink, readCachedNoteShareLink } from '../../core/shareLinks';

type Props = {
	isOpen: boolean;
	onClose: () => void;
	t: (key: string) => string;
	docId: string;
	title?: string | null;
};

function formatExpiry(value: string): string {
	const ms = Date.parse(value);
	if (!Number.isFinite(ms)) return value;
	return new Date(ms).toLocaleString();
}

export function NoteShareModal(props: Props): React.JSX.Element | null {
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [success, setSuccess] = React.useState<string | null>(null);
	const [link, setLink] = React.useState<NoteShareLink | null>(null);
	const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);

	const loadLink = React.useCallback(async (forceRefresh: boolean) => {
		// Note share links are cached with the same policy as workspace invite links:
		// reuse valid cached URLs by default, allow explicit refresh, and surface the
		// last known URL when offline if one had already been generated earlier.
		if (!props.docId) return;
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			const next = await ensureDocShareLink(props.docId, { forceRefresh });
			setLink(next);
			const cached = readCachedNoteShareLink(props.docId);
			if (!forceRefresh && cached && cached.shareUrl === next.shareUrl && typeof navigator !== 'undefined' && navigator.onLine === false) {
				setSuccess(props.t('share.offlineCached'));
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : props.t('share.createFailed'));
		} finally {
			setBusy(false);
		}
	}, [props]);

	React.useEffect(() => {
		if (!props.isOpen) return;
		void loadLink(false);
	}, [loadLink, props.isOpen]);

	React.useEffect(() => {
		if (!props.isOpen) {
			setBusy(false);
			setError(null);
			setSuccess(null);
			setQrDataUrl(null);
			return;
		}
	}, [props.isOpen]);

	React.useEffect(() => {
		// QR generation is derived state from the resolved share URL, not from the
		// modal open state, so manual refreshes automatically repaint the QR image.
		if (!link?.shareUrl) {
			setQrDataUrl(null);
			return;
		}
		let cancelled = false;
		QRCode.toDataURL(link.shareUrl, {
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
	}, [link]);

	const handleCopy = React.useCallback(async () => {
		if (!link?.shareUrl) return;
		try {
			await copyTextToClipboard(link.shareUrl);
			setSuccess(props.t('share.copied'));
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : props.t('share.copyFailed'));
		}
	}, [link, props]);

	const handleOpen = React.useCallback(() => {
		if (!link?.shareUrl || typeof window === 'undefined') return;
		window.open(link.shareUrl, '_blank', 'noopener,noreferrer');
	}, [link]);

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={styles.modal} role="dialog" aria-modal="true" aria-label={props.t('share.title')} onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<div className={styles.titleBlock}>
						<h2 className={styles.title}>{props.t('share.title')}</h2>
						{props.title ? <p className={styles.subtitle}>{props.title}</p> : null}
					</div>
					<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label={props.t('common.close')}>
						✕
					</button>
				</header>

				<div className={styles.banner}>{props.t('share.snapshotNotice')}</div>
				{error ? <div className={styles.error}>{error}</div> : null}
				{success ? <div className={styles.success}>{success}</div> : null}

				{/* Once a link exists the modal becomes the operator console for that URL:
				   show the canonical link text, expiry, QR, and actions to reuse or rotate it. */}
				{link ? (
					<>
						<div className={styles.linkField}>
							<div className={styles.linkLabel}>{props.t('share.linkLabel')}</div>
							<div className={styles.linkValue}>{link.shareUrl}</div>
						</div>
						<div className={styles.meta}>
							{props.t('share.expiresAt')}: {formatExpiry(link.expiresAt)}
						</div>
						{qrDataUrl ? (
							<div className={styles.qrCard}>
								<img className={styles.qrImage} src={qrDataUrl} alt={props.t('share.qrAlt')} />
							</div>
						) : null}
					</>
				) : null}

				<footer className={styles.footer}>
					<button type="button" onClick={props.onClose} disabled={busy}>
						{props.t('common.close')}
					</button>
					<button type="button" className={styles.actionButton} onClick={() => void handleCopy()} disabled={busy || !link?.shareUrl}>
						{props.t('share.copy')}
					</button>
					<button type="button" className={styles.actionButton} onClick={handleOpen} disabled={!link?.shareUrl}>
						{props.t('share.open')}
					</button>
					<button type="button" className={styles.actionButton} onClick={() => void loadLink(true)} disabled={busy || !props.docId}>
						{busy ? props.t('common.loading') : props.t('share.refresh')}
					</button>
				</footer>
			</section>
		</div>
	);
}