import React from 'react';
import { useI18n } from '../../core/i18n';
import type { ParseResult, ParsedNote } from '../../core/import/ImportTypes';
import type { WorkspaceListItem } from '../Workspaces/WorkspaceSwitcherModal';
import { encodeNoteToYjs, submitImportBatch, extractPlainText, type BatchImportPayload } from '../../core/import/ImportPipeline';
import { writeNoteOrderSnapshot } from '../../core/noteOrderSnapshot';
import { writeWorkspaceRenderSnapshot, type WorkspaceRenderSnapshotNote } from '../../core/workspaceRenderSnapshot';
import styles from './ImportVerificationModal.module.css';

function buildImportSnapshotNote(note: ParsedNote, labelIdsByName: Record<string, string>): WorkspaceRenderSnapshotNote {
	const now = note.createdAt ?? Date.now();
	const labelIds = (note.labelNames ?? []).map((n) => labelIdsByName[n] ?? '').filter(Boolean);
	return {
		id: note.noteId,
		type: note.type === 'checklist' ? 'checklist' : note.type === 'drawing' ? 'drawing' : 'text',
		title: note.title || '',
		content: note.type === 'text' ? extractPlainText(note.richContent).trim() : '',
		richContent: null,
		checklistItems: note.type === 'checklist'
			? (note.items ?? []).map((item) => ({
				id: item.id,
				text: String(item.text ?? ''),
				completed: Boolean(item.completed),
				completedAt: null,
				parentId: item.parentId ?? null,
				countValue: null,
				richContent: null,
			}))
			: [],
		createdAt: now,
		updatedAt: now,
		collectionId: null,
		labelIds,
		reminderAt: null,
		isPinned: false,
		lastAccessedAt: new Date(now).toISOString(),
		drawingIds: [],
		trashed: false,
		archived: false,
		colorToken: note.colorToken ?? null,
		bannerFile: null,
		hasSharedBannerPreference: false,
		collaboratorCount: 0,
		attachmentCounts: { images: 0, links: 0, drawings: 0 },
		previewLinks: [],
		previewCards: [],
	};
}

function formatEstimatedTime(totalNotes: number): string {
	// Assume ~700ms per 25-note batch
	const batches = Math.ceil(totalNotes / 25);
	const seconds = batches * 0.7;
	if (seconds < 30) return '< 1 min';
	if (seconds < 90) return '~1 min';
	const mins = Math.round(seconds / 60);
	return `~${mins} min`;
}

type ConflictResolution = 'rename' | 'merge';

type WorkspaceState = {
	originalName: string;
	displayName: string;
	isNew: boolean;
	existingId: string | null;
	conflict: ConflictResolution;
};

export type ImportVerificationModalProps = {
	result: ParseResult;
	existingWorkspaces: WorkspaceListItem[];
	activeWorkspaceId: string;
	onClose: () => void;
	onImported: (count: number, targetWorkspaceId?: string) => void;
};

function findConflict(displayName: string, existingWorkspaces: WorkspaceListItem[]): WorkspaceListItem | null {
	const lower = displayName.trim().toLowerCase();
	return existingWorkspaces.find((ws) => ws.name.toLowerCase() === lower) ?? null;
}

export function ImportVerificationModal(props: ImportVerificationModalProps): React.JSX.Element {
	const { t } = useI18n();

	const initialWsStates = React.useMemo<WorkspaceState[]>(() => {
		return props.result.workspaces.map((ws) => {
			const conflict = findConflict(ws.name, props.existingWorkspaces);
			return {
				originalName: ws.name,
				displayName: ws.name,
				isNew: conflict === null,
				existingId: conflict?.id ?? null,
				conflict: 'rename' as ConflictResolution,
			};
		});
	}, [props.result.workspaces, props.existingWorkspaces]);

	const [wsStates, setWsStates] = React.useState<WorkspaceState[]>(initialWsStates);
	const [phase, setPhase] = React.useState<'review' | 'importing' | 'done' | 'error'>('review');
	const [progress, setProgress] = React.useState(0);
	const [resultMsg, setResultMsg] = React.useState('');
	const [errorDetails, setErrorDetails] = React.useState<string[]>([]);

	const totalNotes = React.useMemo(
		() => props.result.workspaces.reduce((s, ws) => s + ws.notes.length, 0),
		[props.result.workspaces]
	);

	const totalLabels = props.result.allLabelNames.length;
	const totalImages = props.result.imageCount;
	const estTime = React.useMemo(() => formatEstimatedTime(totalNotes), [totalNotes]);

	const setWs = React.useCallback((idx: number, patch: Partial<WorkspaceState>) => {
		setWsStates((prev) => prev.map((s, i) => {
			if (i !== idx) return s;
			const next = { ...s, ...patch };
			if ('displayName' in patch) {
				const conflict = findConflict(next.displayName, props.existingWorkspaces);
				next.existingId = conflict?.id ?? null;
				next.isNew = conflict === null;
			}
			return next;
		}));
	}, [props.existingWorkspaces]);

	const handleImport = React.useCallback(async () => {
		setPhase('importing');
		setProgress(0);
		setErrorDetails([]);

		const BATCH_SIZE = 25;
		const allLabelNames = props.result.allLabelNames;
		let totalCreated = 0;
		let totalErrors = 0;
		const collectedErrors: string[] = [];
		const totalNotesCount = props.result.workspaces.reduce((s, ws) => s + ws.notes.length, 0);
		let processedCount = 0;
		let lastTargetWorkspaceId: string | null = null;

		try {
			for (let wsIdx = 0; wsIdx < props.result.workspaces.length; wsIdx++) {
				const ws = props.result.workspaces[wsIdx];
				const wsState = wsStates[wsIdx];
				if (!ws || !wsState) continue;

				const notes: BatchImportPayload['notes'] = [];
				for (const note of ws.notes) {
					try {
						notes.push(encodeNoteToYjs(note, new Map()));
					} catch (encodeErr) {
						const msg = `Encode "${note.title}" (${note.type}): ${encodeErr instanceof Error ? encodeErr.message : String(encodeErr)}`;
						console.error('[Import] encodeNoteToYjs failed:', msg, encodeErr);
						collectedErrors.push(msg);
						totalErrors += 1;
					}
				}

				if (notes.length === 0) {
					processedCount += ws.notes.length;
					setProgress(Math.round((processedCount / Math.max(totalNotesCount, 1)) * 100));
					continue;
				}

				let wsTargetId: string;
				let createdWorkspaceId: string | null = null;

				if (!wsState.isNew && wsState.existingId && wsState.conflict === 'merge') {
					wsTargetId = wsState.existingId;
				} else if (wsState.isNew || wsState.conflict === 'rename') {
					const createName = wsState.conflict === 'rename' && !wsState.isNew
						? `${wsState.displayName} (Imported)`
						: wsState.displayName;
					try {
						const createRes = await fetch('/api/workspaces', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ name: createName }),
						});
						const createBody = await createRes.text();
						if (createRes.ok) {
							const created = JSON.parse(createBody) as { workspace?: { id?: string } };
							wsTargetId = created?.workspace?.id ?? props.activeWorkspaceId;
							createdWorkspaceId = created?.workspace?.id ?? null;
						} else {
							collectedErrors.push(`Create workspace "${createName}": HTTP ${createRes.status} — ${createBody}`);
							wsTargetId = props.activeWorkspaceId;
						}
					} catch (createErr) {
						collectedErrors.push(`Create workspace "${createName}": ${String(createErr)}`);
						wsTargetId = props.activeWorkspaceId;
					}
				} else {
					wsTargetId = props.activeWorkspaceId;
				}

				lastTargetWorkspaceId = wsTargetId;

				let wsCreated = 0;
				let wsFailed = false;
				let resolvedLabelIdsByName: Record<string, string> = {};
				for (let start = 0; start < notes.length; start += BATCH_SIZE) {
					const chunk = notes.slice(start, start + BATCH_SIZE);
					try {
						const res = await submitImportBatch({
							workspaceId: wsTargetId,
							labelNames: start === 0 ? allLabelNames : [],
							notes: chunk,
						});
						wsCreated += res.created;
						if (start === 0 && res.labelIdsByName) {
							resolvedLabelIdsByName = res.labelIdsByName;
						}
						totalErrors += res.errors?.length ?? 0;
						for (const e of res.errors ?? []) {
							collectedErrors.push(`Note ${e.noteId}: ${e.error}`);
						}
					} catch (batchErr) {
						const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
						collectedErrors.push(`Batch [${start}–${start + chunk.length - 1}] of "${ws.name}": ${msg}`);
						totalErrors += chunk.length;
						wsFailed = true;
					}
					processedCount += chunk.length;
					setProgress(Math.round((processedCount / Math.max(totalNotesCount, 1)) * 100));
					await new Promise<void>((r) => setTimeout(r, 0));
				}

				totalCreated += wsCreated;

				if (wsCreated > 0) {
					try {
						const orderedIds = ws.notes.map((n) => n.noteId);
						writeNoteOrderSnapshot(wsTargetId, orderedIds);
						writeWorkspaceRenderSnapshot({
							workspaceId: wsTargetId,
							orderedIds,
							notes: ws.notes.map((n) => buildImportSnapshotNote(n, resolvedLabelIdsByName)),
						});
					} catch (snapshotErr) {
						console.warn('[Import] snapshot write failed:', snapshotErr);
					}
				}

				if (wsFailed && wsCreated === 0 && createdWorkspaceId) {
					await fetch(`/api/workspaces/${createdWorkspaceId}`, { method: 'DELETE' }).catch(() => {});
				}
			}
		} catch (fatalErr) {
			const msg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
			setResultMsg(msg);
			setErrorDetails([msg]);
			setPhase('error');
			return;
		}

		setErrorDetails(collectedErrors);

		if (totalErrors === 0) {
			const msg = totalCreated === 1
				? t('importExport.importSuccessSingular').replace('{count}', String(totalCreated))
				: t('importExport.importSuccessPlural').replace('{count}', String(totalCreated));
			setResultMsg(msg);
			// Notify App before transitioning so pending import state is armed
			// before the user navigates to the workspace.
			if (totalCreated > 0) props.onImported(totalCreated, lastTargetWorkspaceId ?? undefined);
			setPhase('done');
		} else if (totalCreated > 0) {
			setResultMsg(t('importExport.importPartialSuccess').replace('{success}', String(totalCreated)).replace('{total}', String(totalCreated + totalErrors)));
			if (totalCreated > 0) props.onImported(totalCreated, lastTargetWorkspaceId ?? undefined);
			setPhase('done');
		} else {
			setResultMsg(collectedErrors[0] ?? t('importExport.importFailed'));
			setPhase('error');
			return;
		}

		// Issue a browser notification so the user knows import is done even if
		// they navigated away from this tab / have the phone screen off.
		if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && totalCreated > 0) {
			try {
				new Notification(t('importExport.importNotificationTitle'), {
					body: totalCreated === 1
						? t('importExport.importSuccessSingular').replace('{count}', '1')
						: t('importExport.importSuccessPlural').replace('{count}', String(totalCreated)),
					icon: '/icons/icon-192x192.png',
				});
			} catch { /* Notification API can be unavailable in some contexts */ }
		}
	}, [props, wsStates, t]);

	return (
		<div className={styles.overlay} role="presentation">
			<div
				className={styles.modal}
				role="dialog"
				aria-modal="true"
				aria-label={t('importExport.verifyTitle')}
			>
				<div className={styles.header}>
					<div className={styles.headerRow}>
						<h3 className={styles.title}>{t('importExport.verifyTitle')}</h3>
						{phase === 'review' && (
							<button type="button" className={styles.closeBtn} onClick={props.onClose} aria-label={t('common.close')}>
								✕
							</button>
						)}
					</div>
					<p className={styles.description}>{t('importExport.verifyDescription')}</p>
				</div>

				<div className={styles.body}>
					{/* Workspace rename / conflict resolution */}
					{props.result.workspaces.map((ws, wsIdx) => {
						const state = wsStates[wsIdx];
						if (!state) return null;
						return (
							<div key={ws.name} className={styles.workspaceBlock}>
								<div className={styles.workspaceHeader}>
									<input
										className={styles.workspaceNameInput}
										value={state.displayName}
										onChange={(e) => setWs(wsIdx, { displayName: e.target.value })}
										disabled={phase !== 'review'}
										aria-label={t('importExport.workspaceLabel')}
									/>
									{state.isNew && (
										<span className={styles.wsNewBadge}>{t('importExport.newWorkspaceBadge')}</span>
									)}
								</div>

								{!state.isNew && (
									<div className={styles.conflictRow}>
										<span className={styles.conflictLabel}>
											{t('importExport.conflictWorkspaceExists').replace('{name}', state.displayName)}
										</span>
										<select
											className={styles.conflictSelect}
											value={state.conflict}
											onChange={(e) => setWs(wsIdx, { conflict: e.target.value as ConflictResolution })}
											disabled={phase !== 'review'}
										>
											<option value="rename">{t('importExport.conflictRename')}</option>
											<option value="merge">{t('importExport.conflictMerge')}</option>
										</select>
									</div>
								)}
							</div>
						);
					})}

					{/* Detection stats */}
					{phase === 'review' && (
						<div className={styles.statsSection}>
							<div className={styles.statsRow}>
								<span className={styles.statPill}>
									<strong>{totalNotes.toLocaleString()}</strong> {totalNotes === 1 ? t('importExport.statNote') : t('importExport.statNotes')}
								</span>
								{totalImages > 0 && (
									<span className={styles.statPill}>
										<strong>{totalImages.toLocaleString()}</strong> {totalImages === 1 ? t('importExport.statImage') : t('importExport.statImages')}
									</span>
								)}
								{totalLabels > 0 && (
									<span className={styles.statPill}>
										<strong>{totalLabels.toLocaleString()}</strong> {totalLabels === 1 ? t('importExport.statLabel') : t('importExport.statLabels')}
									</span>
								)}
							</div>
							{totalNotes >= 25 && (
								<p className={styles.estTime}>
									{t('importExport.estimatedTime').replace('{time}', estTime)}
								</p>
							)}
							{totalImages > 0 && props.result.platform === 'keep' && (
								<p className={styles.imageNote}>
									{t('importExport.keepImagesNote')}
								</p>
							)}
						</div>
					)}

					{props.result.warnings.filter((w) => !w.includes('Only the first')).length > 0 && (
						<div className={styles.warnings}>
							{props.result.warnings.filter((w) => !w.includes('Only the first')).map((w, i) => (
								<div key={i} className={styles.warning}>⚠ {w}</div>
							))}
						</div>
					)}
				</div>

				<div className={styles.footer}>
					{phase === 'importing' ? (
						<div className={styles.progressRow}>
							<span style={{ whiteSpace: 'nowrap' }}>
								{t('importExport.importingProgress')} {totalNotes > 1 ? `(${Math.round(progress * totalNotes / 100)} / ${totalNotes})` : ''}
							</span>
							<div className={styles.progressBar}>
								<div className={styles.progressFill} style={{ width: `${progress}%` }} />
							</div>
							<span style={{ whiteSpace: 'nowrap' }}>{progress}%</span>
						</div>
					) : phase === 'done' ? (
						<>
							<div style={{ flex: 1, minWidth: 0 }}>
								<span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
									{resultMsg}
								</span>
								{errorDetails.length > 0 && (
									<details style={{ marginTop: '0.4rem' }}>
										<summary style={{ fontSize: '0.75rem', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
											{errorDetails.length} error{errorDetails.length !== 1 ? 's' : ''} (see console for full details)
										</summary>
										<ul style={{ margin: '0.3rem 0 0', padding: '0 0 0 1rem', fontSize: '0.72rem', color: 'var(--color-danger)', lineHeight: 1.5 }}>
											{errorDetails.map((e, i) => <li key={i}>{e}</li>)}
										</ul>
									</details>
								)}
							</div>
							<button type="button" className={styles.importBtn} onClick={props.onClose}>
								{t('common.close')}
							</button>
						</>
					) : phase === 'error' ? (
						<>
							<div style={{ flex: 1, minWidth: 0 }}>
								<span style={{ fontSize: '0.85rem', color: 'var(--color-danger)' }}>
									{resultMsg}
								</span>
								{errorDetails.length > 0 && (
									<details style={{ marginTop: '0.4rem' }}>
										<summary style={{ fontSize: '0.75rem', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
											{errorDetails.length} error{errorDetails.length !== 1 ? 's' : ''} (see console for full details)
										</summary>
										<ul style={{ margin: '0.3rem 0 0', padding: '0 0 0 1rem', fontSize: '0.72rem', color: 'var(--color-danger)', lineHeight: 1.5 }}>
											{errorDetails.map((e, i) => <li key={i}>{e}</li>)}
										</ul>
									</details>
								)}
							</div>
							<button type="button" className={styles.importBtn} onClick={props.onClose}>
								{t('common.close')}
							</button>
						</>
					) : (
						<>
							<button type="button" className={styles.cancelBtn} onClick={props.onClose}>
								{t('common.cancel')}
							</button>
							<button
								type="button"
								className={styles.importBtn}
								disabled={totalNotes === 0}
								onClick={() => { void handleImport(); }}
							>
								{totalNotes === 1
									? t('importExport.importAction').replace('{count}', '1')
									: t('importExport.importAction').replace('{count}', String(totalNotes))}
							</button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
