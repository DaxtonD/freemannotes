import React from 'react';
import { fetchDocumentConversionStatus, type DocumentConversionStatus } from '../../core/noteDocumentApi';
import {
	clearSavedNoteDocumentFiles,
	getNoteDocumentBackgroundSyncStatus,
	readNoteDocumentStorageMode,
	readNoteDocumentStorageUsage,
	subscribeNoteDocumentBackgroundSync,
	writeNoteDocumentStorageMode,
	type NoteDocumentStorageMode,
	type NoteDocumentStorageUsage,
} from '../../core/noteDocumentStore';
import styles from './PreferencesModal.module.css';

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

type ConverterCheck =
	| { phase: 'checking' }
	| { phase: 'done'; status: DocumentConversionStatus }
	| { phase: 'offline' }
	| { phase: 'error' };

// Semantic colours for the status dot, with fallbacks for themes that don't define them.
const DOT_COLORS: Record<string, string> = {
	good: 'var(--color-success, #16a34a)',
	warn: 'var(--color-warning, #d97706)',
	bad: 'var(--color-danger, #dc2626)',
	muted: 'var(--color-text-muted)',
};

function DocumentConversionHealth(props: { t: (key: string) => string }): React.JSX.Element {
	const { t } = props;
	const [check, setCheck] = React.useState<ConverterCheck>({ phase: 'checking' });

	const runCheck = React.useCallback(async (refresh: boolean): Promise<void> => {
		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			setCheck({ phase: 'offline' });
			return;
		}
		setCheck({ phase: 'checking' });
		try {
			setCheck({ phase: 'done', status: await fetchDocumentConversionStatus(refresh) });
		} catch {
			setCheck({ phase: 'error' });
		}
	}, []);

	React.useEffect(() => {
		void runCheck(false);
	}, [runCheck]);

	let tone: keyof typeof DOT_COLORS = 'muted';
	let label = t('prefs.storageConversionChecking');
	if (check.phase === 'offline') {
		label = t('prefs.storageConversionOffline');
	} else if (check.phase === 'error') {
		tone = 'warn';
		label = t('prefs.storageConversionError');
	} else if (check.phase === 'done') {
		switch (check.status.state) {
			case 'connected':
				tone = 'good';
				label = check.status.version
					? `${t('prefs.storageConversionConnected')} · Gotenberg ${check.status.version}`
					: t('prefs.storageConversionConnected');
				break;
			case 'off':
				label = t('prefs.storageConversionOff');
				break;
			case 'auth':
				tone = 'bad';
				label = t('prefs.storageConversionAuth');
				break;
			case 'libreoffice-down':
				tone = 'bad';
				label = t('prefs.storageConversionLibreOffice');
				break;
			default:
				tone = 'bad';
				label = t('prefs.storageConversionUnreachable');
				break;
		}
	}

	return (
		<div className={styles.toggleRow}>
			<span className={styles.toggleLabel}>
				<span className={styles.toggleTitle}>{t('prefs.storageConversionTitle')}</span>
				<span className={styles.toggleDescription} aria-live="polite">
					<span
						aria-hidden="true"
						style={{
							display: 'inline-block',
							width: 8,
							height: 8,
							borderRadius: '50%',
							marginRight: 6,
							verticalAlign: 'middle',
							background: DOT_COLORS[tone],
						}}
					/>
					{label}
					<br />
					{t('prefs.storageConversionDescription')}
				</span>
			</span>
			<button
				type="button"
				className={styles.installAction}
				onClick={() => void runCheck(true)}
				disabled={check.phase === 'checking'}
			>
				{t('prefs.storageConversionCheck')}
			</button>
		</div>
	);
}

export function StorageSection(props: { t: (key: string) => string; authUserId?: string | null }): React.JSX.Element {
	const { t, authUserId } = props;
	const status = React.useSyncExternalStore(
		subscribeNoteDocumentBackgroundSync,
		getNoteDocumentBackgroundSyncStatus,
		getNoteDocumentBackgroundSyncStatus
	);
	const [mode, setMode] = React.useState<NoteDocumentStorageMode>(() => readNoteDocumentStorageMode(authUserId));
	const [usage, setUsage] = React.useState<NoteDocumentStorageUsage | null>(null);
	const [clearing, setClearing] = React.useState(false);

	// Re-add it up whenever the background download moves on, so the size grows as you watch.
	React.useEffect(() => {
		let cancelled = false;
		void readNoteDocumentStorageUsage(authUserId).then((next) => {
			if (!cancelled) setUsage(next);
		});
		return () => {
			cancelled = true;
		};
	}, [authUserId, status]);

	const handleModeChange = (next: NoteDocumentStorageMode): void => {
		if (!authUserId) return;
		setMode(next);
		writeNoteDocumentStorageMode(authUserId, next);
	};

	const handleClear = async (): Promise<void> => {
		if (!window.confirm(mode === 'all' ? t('prefs.storageClearConfirmAll') : t('prefs.storageClearConfirmOpened'))) return;
		setClearing(true);
		try {
			await clearSavedNoteDocumentFiles();
			setUsage(await readNoteDocumentStorageUsage(authUserId));
		} finally {
			setClearing(false);
		}
	};

	const files = (count: number): string => `${count} ${count === 1 ? t('prefs.storageFileSingular') : t('prefs.storageFilePlural')}`;
	let statusText = '';
	switch (status.phase) {
		case 'checking':
			statusText = t('prefs.storageStatusChecking');
			break;
		case 'downloading':
			statusText = `${t('prefs.storageStatusDownloading')} ${status.saved} / ${status.total}`;
			break;
		case 'done':
			// "Only ones I open" has nothing in progress worth reporting.
			if (mode === 'all') {
				statusText = status.failed > 0
					? `${status.saved} / ${status.total} ${t('prefs.storageDownloaded')}`
					: t('prefs.storageStatusUpToDate');
			}
			break;
		case 'offline':
			statusText = t('prefs.storageStatusOffline');
			break;
		case 'storage-full':
			statusText = `${t('prefs.storageStatusFull')} ${status.total - status.saved} ${t('prefs.storageNotDownloaded')}`;
			break;
		case 'error':
			statusText = t('prefs.storageStatusError');
			break;
		default:
			break;
	}

	return (
		<div className={styles.editorSection}>
			<div className={styles.toggleRow}>
				<span className={styles.toggleLabel}>
					<span className={styles.toggleTitle}>{t('prefs.storageDocumentsTitle')}</span>
					<span className={styles.toggleDescription} aria-live="polite">
						{usage ? `${formatBytes(usage.savedBytes)} · ${files(usage.savedCount)}` : t('common.loading')}
						{usage && usage.waitingCount > 0 ? (
							<>
								<br />
								{`${t('prefs.storageWaitingUpload')}: ${formatBytes(usage.waitingBytes)} · ${files(usage.waitingCount)}`}
							</>
						) : null}
						{statusText ? (
							<>
								<br />
								{statusText}
							</>
						) : null}
					</span>
				</span>
				<button
					type="button"
					className={styles.installAction}
					onClick={() => void handleClear()}
					disabled={clearing || !usage || usage.savedCount === 0}
				>
					{t('prefs.storageClear')}
				</button>
			</div>
			<label className={styles.toggleRow}>
				<span className={styles.toggleLabel}>
					<span className={styles.toggleTitle}>{t('prefs.storageKeepTitle')}</span>
					<span className={styles.toggleDescription}>{t('prefs.storageKeepDescription')}</span>
				</span>
				<select
					className={styles.selectControl}
					value={mode}
					disabled={!authUserId}
					onChange={(event) => handleModeChange(event.target.value === 'opened' ? 'opened' : 'all')}
				>
					<option value="all">{t('prefs.storageKeepAll')}</option>
					<option value="opened">{t('prefs.storageKeepOpened')}</option>
				</select>
			</label>
			<DocumentConversionHealth t={t} />
		</div>
	);
}
