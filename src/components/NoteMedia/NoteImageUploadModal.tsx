import React from 'react';
import { importNoteImageUrl, uploadNoteImages } from '../../core/noteMediaApi';
import { useI18n } from '../../core/i18n';
import { emitNoteMediaChanged, queueNoteImagesForUpload } from '../../core/noteMediaStore';
import styles from './NoteImageUploadModal.module.css';

type NoteImageUploadModalProps = {
	isOpen: boolean;
	docId: string | null;
	authUserId?: string | null;
	offlineMode?: boolean;
	noteTitle?: string | null;
	onClose: () => void;
	onUploaded?: (result: { queued: boolean; count: number }) => void;
};

function isOfflineRequest(props: Pick<NoteImageUploadModalProps, 'offlineMode'>): boolean {
	return Boolean(props.offlineMode) || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

export function NoteImageUploadModal(props: NoteImageUploadModalProps): React.JSX.Element | null {
	const { t } = useI18n();
	const [files, setFiles] = React.useState<File[]>([]);
	const [imageUrl, setImageUrl] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		if (!props.isOpen) {
			setFiles([]);
			setImageUrl('');
			setBusy(false);
			setError(null);
		}
	}, [props.isOpen]);

	if (!props.isOpen || !props.docId) return null;

	const handleFileSubmit = async (): Promise<void> => {
		if (busy || files.length === 0) return;
		setBusy(true);
		setError(null);
		try {
			if (isOfflineRequest(props)) {
				if (!props.authUserId) throw new Error(t('media.offlineRequiresAuth'));
				await queueNoteImagesForUpload({ userId: props.authUserId, docId: props.docId, files });
				props.onUploaded?.({ queued: true, count: files.length });
				props.onClose();
				return;
			}
			await uploadNoteImages(props.docId, files);
			emitNoteMediaChanged(props.docId);
			props.onUploaded?.({ queued: false, count: files.length });
			props.onClose();
		} catch (err) {
			const message = err instanceof Error ? err.message : t('media.uploadFailed');
			if (!isOfflineRequest(props) && props.authUserId && files.length > 0 && /fetch|network|failed/i.test(message)) {
				await queueNoteImagesForUpload({ userId: props.authUserId, docId: props.docId, files });
				props.onUploaded?.({ queued: true, count: files.length });
				props.onClose();
				return;
			}
			setError(message);
		} finally {
			setBusy(false);
		}
	};

	const handleUrlSubmit = async (): Promise<void> => {
		if (busy || !imageUrl.trim()) return;
		setBusy(true);
		setError(null);
		try {
			if (isOfflineRequest(props)) {
				throw new Error(t('media.urlOfflineUnavailable'));
			}
			await importNoteImageUrl(props.docId, imageUrl.trim());
			emitNoteMediaChanged(props.docId);
			props.onUploaded?.({ queued: false, count: 1 });
			props.onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : t('media.importFailed'));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={styles.backdrop} role="presentation" onClick={props.onClose}>
			<section className={styles.dialog} role="dialog" aria-modal="true" aria-label={t('noteMenu.addImage')} onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<div>
						<h2 className={styles.title}>{t('noteMenu.addImage')}</h2>
						<p className={styles.subtitle}>{props.noteTitle ? `${t('media.forPrefix')} ${props.noteTitle}` : t('media.attachToNote')}</p>
					</div>
					<button type="button" className={styles.close} onClick={props.onClose} aria-label={t('common.close')}>
						✕
					</button>
				</header>

				<div className={styles.body}>
					<label className={styles.label} htmlFor="note-image-url">{t('media.imageUrlLabel')}</label>
					<input
						id="note-image-url"
						className={styles.input}
						value={imageUrl}
						onChange={(event) => setImageUrl(event.target.value)}
						placeholder={t('media.imageUrlPlaceholder')}
						disabled={busy}
					/>
					<button type="button" className={styles.secondaryButton} onClick={() => void handleUrlSubmit()} disabled={busy || !imageUrl.trim()}>
						{busy ? t('media.adding') : t('media.addFromUrl')}
					</button>

					<div className={styles.divider} />

					<label className={styles.label} htmlFor="note-image-files">{t('media.chooseFiles')}</label>
					<input
						id="note-image-files"
						className={styles.fileInput}
						type="file"
						accept="image/*"
						multiple
						onChange={(event) => setFiles(Array.from(event.target.files || []))}
						disabled={busy}
					/>
					{files.length > 0 ? <div className={styles.fileSummary}>{files.length} {t('media.filesSelected')}</div> : null}
					<button type="button" className={styles.primaryButton} onClick={() => void handleFileSubmit()} disabled={busy || files.length === 0}>
						{busy ? t('media.uploading') : t('media.uploadSelected')}
					</button>

					{error ? <p className={styles.error}>{error}</p> : null}
				</div>
			</section>
		</div>
	);
}