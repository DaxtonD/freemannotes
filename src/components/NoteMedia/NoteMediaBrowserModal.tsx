import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import { NoteMediaPanel } from './NoteMediaPanel';
import styles from './NoteMediaBrowserModal.module.css';

type NoteMediaBrowserModalProps = {
	isOpen: boolean;
	docId: string | null;
	authUserId?: string | null;
	canEdit: boolean;
	noteTitle?: string | null;
	onClose: () => void;
	onAddImage?: (() => void) | undefined;
};

export function NoteMediaBrowserModal(props: NoteMediaBrowserModalProps): React.JSX.Element | null {
	const { t } = useI18n();

	useBodyScrollLock(props.isOpen);

	if (!props.isOpen || !props.docId) return null;

	return (
		<div className={styles.backdrop} role="presentation" onClick={props.onClose}>
			<section className={styles.dialog} role="dialog" aria-modal="true" aria-label={props.noteTitle || t('app.sidebarImages')} onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<div className={styles.headerCopy}>
						<h2 className={styles.title}>{props.noteTitle || t('note.untitled')}</h2>
						<p className={styles.subtitle}>{t('app.sidebarImages')}</p>
					</div>
					<button type="button" className={styles.closeButton} onClick={props.onClose} aria-label={t('common.close')}>
						<FontAwesomeIcon icon={faXmark} />
					</button>
				</header>
				<div className={styles.body}>
					<NoteMediaPanel
						docId={props.docId}
						authUserId={props.authUserId}
						canEdit={props.canEdit}
						onAddImage={props.onAddImage}
					/>
				</div>
			</section>
		</div>
	);
}
