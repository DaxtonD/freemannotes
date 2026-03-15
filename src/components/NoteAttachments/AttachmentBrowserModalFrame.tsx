import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import styles from '../NoteMedia/NoteMediaBrowserModal.module.css';

type AttachmentBrowserModalFrameProps = {
	isOpen: boolean;
	noteTitle?: string | null;
	subtitle: string;
	onClose: () => void;
	children: React.ReactNode;
	closeLabel: string;
};

export function AttachmentBrowserModalFrame(props: AttachmentBrowserModalFrameProps): React.JSX.Element | null {
	useBodyScrollLock(props.isOpen);

	if (!props.isOpen) return null;

	// Reuse the image-browser shell so attachments feel like one feature family instead
	// of three separate modal systems that drift apart over time.
	return (
		<div className={styles.backdrop} role="presentation" onClick={props.onClose}>
			<section
				className={styles.dialog}
				role="dialog"
				aria-modal="true"
				aria-label={props.noteTitle || props.subtitle}
				onClick={(event) => event.stopPropagation()}
			>
				<header className={styles.header}>
					<div className={styles.headerCopy}>
						<h2 className={styles.title}>{props.noteTitle || props.subtitle}</h2>
						<p className={styles.subtitle}>{props.subtitle}</p>
					</div>
					<button type="button" className={styles.closeButton} onClick={props.onClose} aria-label={props.closeLabel}>
						<FontAwesomeIcon icon={faXmark} />
					</button>
				</header>
				<div className={styles.body}>{props.children}</div>
			</section>
		</div>
	);
}