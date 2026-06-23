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

function isNoteBannerPickerHistoryState(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	return (value as { __noteBannerPicker?: boolean }).__noteBannerPicker === true;
}

export function NoteBannerPickerModal(props: NoteBannerPickerModalProps): React.JSX.Element | null {
	const { t } = useI18n();
	const [options, setOptions] = React.useState<readonly NoteBannerOption[]>([]);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const onCloseRef = React.useRef(props.onClose);
	React.useEffect(() => { onCloseRef.current = props.onClose; }, [props.onClose]);

	// The fixed overlay alone is not enough on mobile; without the shared root scroll
	// lock, touchmove can still scroll the note grid underneath the banner picker.
	useBodyScrollLock(props.isOpen);

	// Push a dismiss-layer history entry on mobile so Android back closes the picker
	// instead of collapsing the whole overlay stack. Mirrors NoteColorPickerModal.
	React.useEffect(() => {
		if (!props.isOpen || typeof window === 'undefined') return;
		const mql = window.matchMedia('(pointer: coarse)');
		if (!mql.matches) return;

		let active = true;
		let didPush = false;
		const pushTimer = window.setTimeout(() => {
			if (!active) return;
			// If the more menu opened us via closeForChildOverlay it skips its own
			// history.back(), leaving an orphaned {__moreMenu} entry. Replace it so
			// pressing back from within the picker lands on the grid snapshot instead
			// of requiring an extra back press to clear the orphaned entry.
			const currentState = window.history.state as { __moreMenu?: boolean } | null;
			if (currentState?.__moreMenu === true) {
				window.history.replaceState({ __noteBannerPicker: true }, '');
			} else {
				window.history.pushState({ __noteBannerPicker: true }, '');
			}
			didPush = true;
		}, 0);
		const onPopState = (): void => {
			if (!active || !didPush) return;
			active = false;
			onCloseRef.current();
		};
		window.addEventListener('popstate', onPopState);

		return () => {
			window.clearTimeout(pushTimer);
			window.removeEventListener('popstate', onPopState);
			if (active && didPush && isNoteBannerPickerHistoryState(window.history.state)) {
				active = false;
				window.history.back();
			}
			active = false;
		};
	}, [props.isOpen]);

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

	// Must be called unconditionally before any early return (React hook rules).
	const localizedOptions = React.useMemo(() => options.map((option) => {
		const translatedLabel = t(option.labelKey);
		return {
			...option,
			displayLabel: translatedLabel === option.labelKey ? option.label : translatedLabel,
		};
	}).sort((left, right) => left.displayLabel.localeCompare(right.displayLabel)), [options, t]);

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
					{localizedOptions.map((option) => (
						<button
							key={option.fileName}
							type="button"
							role="listitem"
							className={`${styles.option}${props.selectedFileName === option.fileName ? ` ${styles.optionActive}` : ''}`}
							onClick={() => props.onSelect(option.fileName)}
						>
							<span className={styles.preview} aria-hidden="true" style={{ backgroundImage: `url("${getNoteBannerAssetUrl(option.fileName, props.themeId, 'card')}")` }} />
							<span className={styles.label}>{option.displayLabel}</span>
						</button>
					))}
				</div>
			</section>
		</div>,
		document.body
	);
}