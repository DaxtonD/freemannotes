import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileImport, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import type { ParseResult } from '../../core/import/ImportTypes';
import { runImportPipeline } from '../../core/import/ImportPipeline';
import styles from './ImportModal.module.css';

const PLATFORM_LABELS: Record<string, string> = {
	obsidian: 'Obsidian',
	keep: 'Google Keep',
	joplin: 'Joplin',
	notion: 'Notion',
	onenote: 'OneNote',
	generic: 'Markdown / Text',
};

export type ImportModalProps = {
	onReview: (result: ParseResult) => void;
};

export function ImportSection(props: ImportModalProps): React.JSX.Element {
	const { t } = useI18n();
	const fileInputRef = React.useRef<HTMLInputElement>(null);
	const [isDragOver, setIsDragOver] = React.useState(false);
	const [status, setStatus] = React.useState<'idle' | 'parsing' | 'done' | 'error'>('idle');
	const [statusMsg, setStatusMsg] = React.useState('');

	const handleFiles = React.useCallback(async (files: File[] | FileList) => {
		const arr = Array.from(files);
		if (arr.length === 0) return;
		setStatus('parsing');
		setStatusMsg(t('importExport.parsingNotes'));
		// Yield to the macro-task queue so React can commit the spinner update
		// before the CPU-intensive pipeline begins. Without this the "Reading notes…"
		// state update is queued but never painted while JSZip blocks microtasks.
		await new Promise<void>((r) => setTimeout(r, 0));
		try {
			const result = await runImportPipeline(arr);
			setStatus('done');
			const total = result.workspaces.reduce((s, ws) => s + ws.notes.length, 0);
			const countLabel = total === 1 ? t('importExport.noteCountSingular').replace('{count}', '1') : t('importExport.noteCountPlural').replace('{count}', String(total));
			setStatusMsg(`${PLATFORM_LABELS[result.platform] ?? result.platform} · ${countLabel}`);
			props.onReview(result);
		} catch (err) {
			setStatus('error');
			setStatusMsg(err instanceof Error ? err.message : t('importExport.importFailed'));
		}
	}, [t, props.onReview]);

	const handleDrop = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		setIsDragOver(false);
		const files = Array.from(e.dataTransfer.files);
		void handleFiles(files);
	}, [handleFiles]);

	const handleDragOver = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		setIsDragOver(true);
	}, []);

	const handleDragLeave = React.useCallback(() => {
		setIsDragOver(false);
	}, []);

	const handleClick = React.useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		if (files && files.length > 0) void handleFiles(files);
		e.target.value = '';
	}, [handleFiles]);

	return (
		<div className={styles.section}>
			<p className={styles.description}>{t('importExport.importDescription')}</p>

			<div
				className={`${styles.dropZone}${isDragOver ? ` ${styles.dropZoneActive}` : ''}`}
				role="button"
				tabIndex={0}
				aria-label={t('importExport.chooseFiles')}
				onClick={handleClick}
				onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
				onDrop={handleDrop}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
			>
				<span className={styles.dropZoneIcon}>
					{status === 'parsing'
						? <FontAwesomeIcon icon={faSpinner} spin />
						: <FontAwesomeIcon icon={faFileImport} />}
				</span>
				<span className={styles.dropZoneLabel}>{t('importExport.chooseFiles')}</span>
				<span className={styles.dropZoneHint}>{t('importExport.orDragDrop')}</span>
			</div>

			<input
				ref={fileInputRef}
				type="file"
				className={styles.fileInput}
				multiple
				accept=".md,.txt,.markdown,.json,.docx,.zip"
				onChange={handleInputChange}
			/>

			{status !== 'idle' && (
				<p className={styles.status}>{statusMsg}</p>
			)}
		</div>
	);
}
