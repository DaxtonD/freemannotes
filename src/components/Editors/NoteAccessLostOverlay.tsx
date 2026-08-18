import React from 'react';
import { useI18n } from '../../core/i18n';
import styles from './NoteAccessLostOverlay.module.css';

type Props = {
	onDismiss: () => void;
};

/** Blocking overlay shown when the note open in the editor becomes inaccessible out from
 *  under the user (owner revoked access, or its workspace was deleted). Deliberately does
 *  not auto-close the editor — see noteAccessLostState's comment in App.tsx for why. */
export function NoteAccessLostOverlay(props: Props): React.JSX.Element {
	const { t } = useI18n();
	return (
		<div className={styles.overlay} role="presentation">
			<section className={styles.card} role="dialog" aria-modal="true" aria-label={t('share.accessRemovedToast')}>
				<h2 className={styles.title}>{t('share.accessRemovedToast')}</h2>
				<p className={styles.body}>{t('share.accessLostOverlayBody')}</p>
				<button type="button" className={styles.dismissButton} onClick={props.onDismiss}>
					{t('share.accessLostOverlayDismiss')}
				</button>
			</section>
		</div>
	);
}
