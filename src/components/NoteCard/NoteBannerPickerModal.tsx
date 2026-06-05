import React from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../core/i18n';
import { getNoteBannerAssetUrl, listNoteBanners, type NoteBannerOption } from '../../core/noteBannerApi';
import type { ThemeId } from '../../core/theme';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import styles from './NoteBannerPickerModal.module.css';

export type NoteBannerPickerModalProps = {
	isOpen: boolean;
	themeId: ThemeId;
	selectedFileName: string | null;
	onClose: () => void;
	onSelect: (fileName: string | null) => void;
};

export function NoteBannerPickerModal(props: NoteBannerPickerModalProps): React.JSX.Element | null {
	const { t } = useI18n();
	const [options, setOptions] = React.useState<readonly NoteBannerOption[]>([]);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	// The fixed overlay alone is not enough on mobile; without the shared root scroll
	// lock, touchmove can still scroll the note grid underneath the banner picker.
	useBodyScrollLock(props.isOpen);

	React.useEffect(() => {
		if (!props.isOpen || typeof window === 'undefined') return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') props.onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [props.isOpen, props.onClose]);

	React.useEffect(() => {
		if (!props.isOpen) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		void listNoteBanners(true).then((nextOptions) => {
			if (cancelled) return;
			setOptions(nextOptions);
		}).catch((nextError) => {
			if (cancelled) return;
			setError(nextError instanceof Error ? nextError.message : t('noteBanners.failed'));
		}).finally(() => {
			if (cancelled) return;
			setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [props.isOpen, t]);

	if (!props.isOpen || typeof document === 'undefined') return null;

	const statusText = error
		? error
		: loading
			? t('noteBanners.loading')
			: options.length === 0
				? t('noteBanners.empty')
				: null;

	return createPortal(
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section
				className={styles.modal}
				role="dialog"
				aria-modal="true"
				aria-label={t('noteBanners.dialogTitle')}
				onClick={(event) => event.stopPropagation()}
			>
				<header className={styles.header}>
					<h3 className={styles.title}>{t('noteBanners.dialogTitle')}</h3>
					<button type="button" className={styles.closeButton} onClick={props.onClose} aria-label={t('common.close')}>
						✕
					</button>
				</header>
				{statusText ? <div className={styles.status}>{statusText}</div> : null}
				<div className={styles.grid} role="list" aria-label={t('noteBanners.dialogTitle')}>
					<button
						type="button"
						role="listitem"
						className={`${styles.option}${props.selectedFileName === null ? ` ${styles.optionActive}` : ''}`}
						onClick={() => props.onSelect(null)}
					>
						<span className={styles.clearPreview} aria-hidden="true" />
						<span className={styles.label}>{t('noteBanners.none')}</span>
					</button>
					{options.map((option) => (
						<button
							key={option.fileName}
							type="button"
							role="listitem"
							className={`${styles.option}${props.selectedFileName === option.fileName ? ` ${styles.optionActive}` : ''}`}
							onClick={() => props.onSelect(option.fileName)}
						>
							<span className={styles.preview} aria-hidden="true" style={{ backgroundImage: `url("${getNoteBannerAssetUrl(option.fileName, props.themeId, 'card')}")` }} />
							<span className={styles.label}>{option.label}</span>
						</button>
					))}
				</div>
			</section>
		</div>,
		document.body
	);
}