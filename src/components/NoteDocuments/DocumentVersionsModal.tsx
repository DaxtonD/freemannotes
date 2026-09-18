import React from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowsRotate, faDownload, faPen, faTrash, faUpload, faXmark } from '@fortawesome/free-solid-svg-icons';
import {
	deleteNoteDocumentVersion,
	listNoteDocumentVersions,
	uploadNoteDocumentVersion,
	type NoteDocumentRecord,
	type NoteDocumentVersionRecord,
} from '../../core/noteDocumentApi';
import { useI18n } from '../../core/i18n';
import { NOTE_DOCUMENT_ACCEPT, getDocumentUploadMaxBytesLabel, isSupportedNoteDocumentFile } from './documentVersionHelpers';
import styles from './DocumentVersionsModal.module.css';

// The history of one document: every revision that's still kept, newest first. Uploading a new
// revision from here replaces what everyone opens, while older versions keep their own markup (D7).

type DocumentVersionsModalProps = {
	document: NoteDocumentRecord;
	canEdit: boolean;
	onClose: () => void;
	/** Open one version in the viewer (an older one is fetched on demand, never stored). */
	onOpenVersion: (record: NoteDocumentRecord) => void;
	onDownloadVersion: (record: NoteDocumentRecord) => void;
	/** The document's own list needs refreshing: a new version, or one deleted. */
	onChanged: () => void;
};

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A record the viewer and the download helpers can use for one particular version. */
export function noteDocumentRecordForVersion(document: NoteDocumentRecord, version: NoteDocumentVersionRecord): NoteDocumentRecord {
	return {
		...document,
		latestVersionId: version.id,
		latestVersionNumber: version.versionNumber,
		fileName: version.fileName,
		fileExtension: version.fileExtension,
		mimeType: version.mimeType,
		byteSize: version.byteSize,
		pageCount: version.pageCount,
		conversionStatus: version.conversionStatus,
		originalUrl: version.originalUrl,
		previewUrl: version.previewUrl,
		thumbnailUrl: version.thumbnailUrl,
		viewPdfUrl: version.viewPdfUrl,
		versionCreatedAt: version.createdAt,
		isOlderVersion: version.versionNumber !== document.latestVersionNumber,
	};
}

export function DocumentVersionsModal(props: DocumentVersionsModalProps): React.JSX.Element | null {
	const { t } = useI18n();
	const { document: noteDocument, canEdit, onChanged } = props;
	const [versions, setVersions] = React.useState<readonly NoteDocumentVersionRecord[] | null>(null);
	const [keepAutomatically, setKeepAutomatically] = React.useState(10);
	const [error, setError] = React.useState<string | null>(null);
	const [busy, setBusy] = React.useState<'loading' | 'uploading' | string | null>('loading');
	const inputRef = React.useRef<HTMLInputElement | null>(null);
	const mountedRef = React.useRef(true);

	React.useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const load = React.useCallback(async (): Promise<void> => {
		setBusy('loading');
		setError(null);
		try {
			const response = await listNoteDocumentVersions(noteDocument.id);
			if (!mountedRef.current) return;
			setVersions(response.versions);
			setKeepAutomatically(response.keepAutomatically);
		} catch {
			if (!mountedRef.current) return;
			setError(t(typeof navigator !== 'undefined' && navigator.onLine === false ? 'documents.versionsOffline' : 'documents.versionsLoadFailed'));
		} finally {
			if (mountedRef.current) setBusy(null);
		}
	}, [noteDocument.id, t]);

	React.useEffect(() => {
		void load();
	}, [load]);

	React.useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			props.onClose();
		};
		window.document.addEventListener('keydown', onKeyDown, true);
		return () => window.document.removeEventListener('keydown', onKeyDown, true);
	}, [props]);

	const handleReplace = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
		const file = (event.target.files || [])[0];
		event.target.value = '';
		if (!file) return;
		if (!isSupportedNoteDocumentFile(file)) {
			setError(t('documents.skippedUnsupported'));
			return;
		}
		// The same file as what's already there isn't a revision; it would just age a real version out.
		const current = versions && versions.length > 0 ? versions[0] : null;
		if (current && current.fileName === file.name && current.byteSize === file.size) {
			setError(t('documents.versionDuplicate'));
			return;
		}
		setBusy('uploading');
		setError(null);
		try {
			const response = await uploadNoteDocumentVersion(noteDocument.id, file);
			if (!mountedRef.current) return;
			setVersions(response.versions);
			setKeepAutomatically(response.keepAutomatically);
			onChanged();
		} catch (uploadError) {
			console.error('[document-versions] upload failed', uploadError);
			if (!mountedRef.current) return;
			const status = (uploadError as { status?: number } | null)?.status;
			if (status === 413) setError(t('documents.skippedTooLarge').replace('{size}', getDocumentUploadMaxBytesLabel()));
			else if (status === 409) setError(t('documents.versionDuplicate'));
			else setError(t('documents.versionUploadFailed'));
		} finally {
			if (mountedRef.current) setBusy(null);
		}
	};

	const handleDelete = async (version: NoteDocumentVersionRecord): Promise<void> => {
		const message = (version.hasMarkup ? t('documents.versionDeleteMarkupConfirm') : t('documents.versionDeleteConfirm')).replace('{n}', String(version.versionNumber));
		if (typeof window !== 'undefined' && !window.confirm(message)) return;
		setBusy(version.id);
		setError(null);
		try {
			const response = await deleteNoteDocumentVersion(noteDocument.id, version.id);
			if (!mountedRef.current) return;
			setVersions(response.versions);
			onChanged();
		} catch (deleteError) {
			console.error('[document-versions] delete failed', deleteError);
			if (mountedRef.current) setError(t('documents.versionDeleteFailed'));
		} finally {
			if (mountedRef.current) setBusy(null);
		}
	};

	const latestNumber = versions && versions.length > 0 ? versions[0].versionNumber : noteDocument.latestVersionNumber ?? 1;
	const content = (
		<div className={styles.backdrop} role="presentation" data-note-editor-overlay="true" onClick={props.onClose}>
			<section
				className={styles.dialog}
				role="dialog"
				aria-modal="true"
				aria-label={`${t('documents.versionHistory')}: ${noteDocument.fileName}`}
				onClick={(event) => event.stopPropagation()}
			>
				<header className={styles.header}>
					<div className={styles.headerCopy}>
						<h2 className={styles.title} title={noteDocument.fileName}>{noteDocument.fileName}</h2>
						<p className={styles.subtitle}>{t('documents.versionHistory')}</p>
					</div>
					<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label={t('common.close')} title={t('common.close')}>
						<FontAwesomeIcon icon={faXmark} />
					</button>
				</header>

				{canEdit ? (
					<div className={styles.actions}>
						<button type="button" className={styles.primaryButton} onClick={() => inputRef.current?.click()} disabled={busy !== null}>
							<FontAwesomeIcon icon={busy === 'uploading' ? faArrowsRotate : faUpload} spin={busy === 'uploading'} />
							<span>{busy === 'uploading' ? t('documents.versionUploading') : t('documents.replaceVersion')}</span>
						</button>
						<input
							ref={inputRef}
							type="file"
							accept={NOTE_DOCUMENT_ACCEPT}
							className={styles.hiddenInput}
							onChange={(event) => void handleReplace(event)}
							tabIndex={-1}
							aria-hidden="true"
						/>
					</div>
				) : null}

				{error ? <p className={styles.error} role="alert">{error}</p> : null}

				<div className={styles.body}>
					{busy === 'loading' && !versions ? (
						<p className={styles.status}>{t('common.loading')}</p>
					) : versions && versions.length > 0 ? (
						<ul className={styles.list}>
							{versions.map((version) => {
								const isLatest = version.versionNumber === latestNumber;
								const record = noteDocumentRecordForVersion(noteDocument, version);
								return (
									<li key={version.id} className={styles.row} data-latest={isLatest ? 'true' : undefined}>
										<button
											type="button"
											className={styles.openArea}
											onClick={() => props.onOpenVersion(record)}
											aria-label={`${t('documents.open')}: ${t('documents.versionLabel').replace('{n}', String(version.versionNumber))}`}
										>
											<span className={styles.versionBadge}>{`v${version.versionNumber}`}</span>
											<span className={styles.copy}>
												<span className={styles.name} title={version.fileName}>{version.fileName}</span>
												<span className={styles.meta}>
													{[formatWhen(version.createdAt), formatBytes(version.byteSize), version.pageCount ? `${version.pageCount} ${t(version.pageCount === 1 ? 'documents.pageSingular' : 'documents.pagePlural')}` : null]
														.filter(Boolean)
														.join(' · ')}
												</span>
												<span className={styles.chips}>
													{isLatest ? <span className={styles.chip} data-tone="latest">{t('documents.versionLatest')}</span> : null}
													{version.hasMarkup ? (
														<span className={styles.chip} data-tone="markup">
															<FontAwesomeIcon icon={faPen} />
															{t('documents.versionHasMarkup')}
														</span>
													) : null}
												</span>
											</span>
										</button>
										<div className={styles.rowActions}>
											<button
												type="button"
												className={styles.iconButton}
												onClick={() => props.onDownloadVersion(record)}
												aria-label={t('documents.download')}
												title={t('documents.download')}
											>
												<FontAwesomeIcon icon={faDownload} />
											</button>
											{canEdit && !isLatest ? (
												<button
													type="button"
													className={`${styles.iconButton} ${styles.iconButtonDanger}`}
													onClick={() => void handleDelete(version)}
													disabled={busy !== null}
													aria-label={t('documents.versionDelete')}
													title={t('documents.versionDelete')}
												>
													<FontAwesomeIcon icon={busy === version.id ? faArrowsRotate : faTrash} spin={busy === version.id} />
												</button>
											) : null}
										</div>
									</li>
								);
							})}
						</ul>
					) : !error ? (
						<p className={styles.status}>{t('documents.versionsLoadFailed')}</p>
					) : null}
				</div>

				<p className={styles.note}>{t('documents.versionsKeptNote').replace('{count}', String(keepAutomatically))}</p>
			</section>
		</div>
	);

	return typeof window === 'undefined' ? null : createPortal(content, window.document.body);
}
