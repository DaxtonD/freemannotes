import React from 'react';
import { createPortal } from 'react-dom';
import {
	NOTE_COLOR_TOKENS,
	resolveThemeNoteColorModel,
	type NoteColorToken,
} from '../../core/noteColors';
import type { ThemeId } from '../../core/theme';
import { useI18n } from '../../core/i18n';
import styles from './NoteColorPickerModal.module.css';

export type NoteColorPickerModalProps = {
	isOpen: boolean;
	themeId: ThemeId;
	selectedToken: NoteColorToken | null;
	onClose: () => void;
	onSelect: (token: NoteColorToken | null) => void;
};

export function NoteColorPickerModal(props: NoteColorPickerModalProps): React.JSX.Element | null {
	const { t } = useI18n();
	const themeModel = React.useMemo(() => resolveThemeNoteColorModel(props.themeId), [props.themeId]);

	React.useEffect(() => {
		// The picker is portaled above the editor/card chrome, so handle Escape at the
		// window level rather than relying on ancestor key handlers.
		if (!props.isOpen || typeof window === 'undefined') return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') props.onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [props.isOpen, props.onClose]);

	if (!props.isOpen || typeof document === 'undefined') return null;

	return createPortal(
		// Render into document.body so the color picker is not clipped by transformed
		// note cards, overlays, or editor containers.
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section
				className={styles.modal}
				role="dialog"
				aria-modal="true"
				aria-label={t('noteColors.dialogTitle')}
				onClick={(event) => event.stopPropagation()}
			>
				<header className={styles.header}>
					<h3 className={styles.title}>{t('noteColors.dialogTitle')}</h3>
					<button type="button" className={styles.closeButton} onClick={props.onClose} aria-label={t('common.close')}>
						✕
					</button>
				</header>
				<div className={styles.grid} role="list" aria-label={t('noteColors.dialogTitle')}>
					<button
						type="button"
						role="listitem"
						className={`${styles.option}${props.selectedToken === null ? ` ${styles.optionActive}` : ''}`}
						onClick={() => props.onSelect(null)}
					>
						<span className={styles.clearSwatch} aria-hidden="true" />
						<span className={styles.label}>{t('noteColors.none')}</span>
					</button>
					{NOTE_COLOR_TOKENS.map((token) => {
						const resolved = themeModel.tokens[token.id];
						return (
							<button
								key={token.id}
								type="button"
								role="listitem"
								className={`${styles.option}${props.selectedToken === token.id ? ` ${styles.optionActive}` : ''}`}
								onClick={() => props.onSelect(token.id)}
							>
								<span
									className={styles.swatch}
									aria-hidden="true"
									style={{
										background: `linear-gradient(180deg, ${resolved.headerBackground}, ${resolved.cardBackground})`,
										borderColor: resolved.borderColor,
									}}
								/>
								<span className={styles.label}>{t(token.labelKey)}</span>
							</button>
						);
					})}
				</div>
			</section>
		</div>,
		document.body
	);
}