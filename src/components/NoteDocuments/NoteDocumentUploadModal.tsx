import React from 'react';
import { queueNoteDocumentsForUpload } from '../../core/noteDocumentStore';
import { useI18n } from '../../core/i18n';
import styles from './NoteDocumentUploadModal.module.css';

type NoteDocumentUploadModalProps = {
	isOpen: boolean;
	docId: string | null;
	authUserId?: string | null;
	offlineMode?: boolean;
	noteTitle?: string | null;
	onClose: () => void;
	onUploaded?: (result: { count: number; queued: boolean }) => void;
};

const ACCEPTED_DOCUMENT_TYPES = '.doc,.docx,.pdf,.xls,.xlsx,.odt,.ods,.odp,.rtf';

function isOfflineRequest(offlineMode?: boolean): boolean {
	return Boolean(offlineMode) || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

export function NoteDocumentUploadModal(props: NoteDocumentUploadModalProps): React.JSX.Element | null {
	const { t } = useI18n();
	const [files, setFiles] = React.useState<File[]>([]);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		if (!props.isOpen) {
			setFiles([]);
			setBusy(false);
			setError(null);
		}
	}, [props.isOpen]);

	if (!props.isOpen || !props.docId) return null;
	const docId = props.docId;

	const handleSubmit = async (): Promise<void> => {
		if (busy || files.length === 0) return;
		setBusy(true);
		setError(null);
		try {
			// Queue first and let the store decide whether the upload flushes immediately or
			// later. That keeps the modal behavior identical online and offline.
			if (!props.authUserId) {
				throw new Error(t('documents.uploadFailed'));
			}
			await queueNoteDocumentsForUpload({
				userId: props.authUserId,
				docId,
				files,
			});
			props.onUploaded?.({ count: files.length, queued: isOfflineRequest(props.offlineMode) });
			props.onClose();
		} catch (nextError) {
			setError(nextError instanceof Error ? nextError.message : t('documents.uploadFailed'));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={styles.backdrop} role="presentation" onClick={props.onClose}>
			<section className={styles.dialog} role="dialog" aria-modal="true" aria-label={t('documents.addTitle')} onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<div>
						<h2 className={styles.title}>{t('documents.addTitle')}</h2>
						<p className={styles.subtitle}>{props.noteTitle ? `${t('media.forPrefix')} ${props.noteTitle}` : t('documents.attachToNote')}</p>
					</div>
					<button type="button" className={styles.close} onClick={props.onClose} aria-label={t('common.close')}>
						✕
					</button>
				</header>

				<div className={styles.body}>
					<label className={styles.label} htmlFor="note-document-files">{t('documents.chooseFiles')}</label>
					<input
						id="note-document-files"
						className={styles.fileInput}
						type="file"
						accept={ACCEPTED_DOCUMENT_TYPES}
						multiple
						onChange={(event) => setFiles(Array.from(event.target.files || []))}
						disabled={busy}
					/>
					<p className={styles.supportedTypes}>{t('documents.supportedTypes')}</p>
					{files.length > 0 ? <div className={styles.fileSummary}>{files.length} {t('media.filesSelected')}</div> : null}
					<button type="button" className={styles.primaryButton} onClick={() => void handleSubmit()} disabled={busy || files.length === 0}>
						{busy ? t('documents.uploading') : t('documents.uploadSelected')}
					</button>

					{error ? <p className={styles.error}>{error}</p> : null}
				</div>
			</section>
		</div>
	);
}