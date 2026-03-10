import React from 'react';
import { getDeviceId } from '../../core/deviceId';
import {
	cacheActiveWorkspaceSelection,
	cacheWorkspaceDetails,
	cacheWorkspaceSnapshot,
	queueOfflineWorkspaceCreate,
	queueOfflineWorkspaceDelete,
	removeCachedWorkspace,
	readCachedWorkspaceSnapshot,
} from '../../core/workspaceMetadataStore';
import { getWorkspaceDisplayName } from '../../core/workspaceDisplay';
import styles from './WorkspaceSwitcherModal.module.css';

export type WorkspaceListItem = {
	id: string;
	name: string;
	role: 'OWNER' | 'ADMIN' | 'MEMBER';
	ownerUserId?: string | null;
	systemKind?: string | null;
	createdAt: string;
	updatedAt?: string;
	pendingSync?: boolean;
	pendingSyncKind?: 'create' | 'delete' | null;
};

type ListResponse = {
	activeWorkspaceId: string | null;
	workspaces: WorkspaceListItem[];
};

type Props = {
	isOpen: boolean;
	onClose: () => void;
	t: (key: string) => string;
	authUserId: string | null;
	onWorkspaceActivated: (workspaceId: string) => void;
	onWorkspaceDeleted?: (deletedWorkspaceId: string, nextActiveWorkspaceId: string | null) => void;
	onActiveWorkspaceRenamed?: () => void;
};

function mapWorkspaces(value: unknown): WorkspaceListItem[] {
	if (!Array.isArray(value)) return [];
	return value
		.map<WorkspaceListItem | null>((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			const workspace = entry as Record<string, unknown>;
			const id = typeof workspace.id === 'string' ? workspace.id : '';
			if (!id) return null;
			return {
				id,
				name: typeof workspace.name === 'string' ? workspace.name : '',
				role: workspace.role === 'OWNER' || workspace.role === 'ADMIN' || workspace.role === 'MEMBER' ? workspace.role : 'MEMBER',
				ownerUserId: typeof workspace.ownerUserId === 'string' ? workspace.ownerUserId : null,
				systemKind: typeof workspace.systemKind === 'string' ? workspace.systemKind : null,
				createdAt: typeof workspace.createdAt === 'string' ? workspace.createdAt : new Date(0).toISOString(),
				updatedAt: typeof workspace.updatedAt === 'string' ? workspace.updatedAt : typeof workspace.createdAt === 'string' ? workspace.createdAt : new Date(0).toISOString(),
			};
		})
		.filter((workspace): workspace is WorkspaceListItem => Boolean(workspace));
}

function getWorkspaceRole(workspaces: readonly WorkspaceListItem[], workspaceId: string): 'OWNER' | 'ADMIN' | 'MEMBER' | null {
	const match = workspaces.find((workspace) => workspace.id === workspaceId);
	return match ? match.role : null;
}

function createWorkspaceId(): string {
	// Offline-create branch needs a stable client-generated ID so the optimistic row,
	// the queued mutation, and the eventual server replay all refer to the same workspace.
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
		const random = Math.random() * 16 | 0;
		const value = ch === 'x' ? random : (random & 0x3) | 0x8;
		return value.toString(16);
	});
}

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
	const res = await fetch(input, { credentials: 'include', ...init });
	const contentType = String(res.headers.get('content-type') || '').toLowerCase();
	const body = contentType.includes('application/json') ? await res.json().catch(() => null) : null;
	if (!res.ok) {
		const message = body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
		throw new Error(message);
	}
	return body as T;
}

export function WorkspaceSwitcherModal(props: Props): React.JSX.Element | null {
	const deviceId = React.useMemo(() => getDeviceId(), []);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<string | null>(null);
	const [workspaces, setWorkspaces] = React.useState<readonly WorkspaceListItem[]>([]);
	const [createName, setCreateName] = React.useState('');
	const [renameId, setRenameId] = React.useState<string | null>(null);
	const [renameValue, setRenameValue] = React.useState('');

	const load = React.useCallback(async () => {
		setBusy(true);
		setError(null);
		let hasCachedWorkspaces = false;
		if (props.authUserId) {
			// Cache-first paint: show the last known workspace list immediately, then refresh
			// from the server when online so the modal stays responsive during startup.
			const cached = await readCachedWorkspaceSnapshot(props.authUserId, deviceId);
			if (cached.workspaces.length > 0) {
				hasCachedWorkspaces = true;
				setActiveWorkspaceId(cached.activeWorkspaceId);
				setWorkspaces(cached.workspaces);
			}
		}
		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			setBusy(false);
			return;
		}
		try {
			const data = await fetchJson<ListResponse>(
				`/api/workspaces?deviceId=${encodeURIComponent(deviceId)}`
			);
			const nextWorkspaces = mapWorkspaces(data.workspaces);
			const nextActiveWorkspaceId = typeof data.activeWorkspaceId === 'string' ? data.activeWorkspaceId : null;
			if (props.authUserId) {
				await cacheWorkspaceSnapshot({
					userId: props.authUserId,
					deviceId,
					activeWorkspaceId: nextActiveWorkspaceId,
					workspaces: nextWorkspaces.map((workspace) => ({
						id: workspace.id,
						name: workspace.name,
						role: workspace.role,
						ownerUserId: workspace.ownerUserId ?? null,
						systemKind: workspace.systemKind ?? null,
						createdAt: workspace.createdAt,
						updatedAt: workspace.updatedAt ?? workspace.createdAt,
					})),
				});
				const merged = await readCachedWorkspaceSnapshot(props.authUserId, deviceId);
				setActiveWorkspaceId(merged.activeWorkspaceId);
				setWorkspaces(merged.workspaces);
			} else {
				setActiveWorkspaceId(nextActiveWorkspaceId);
				setWorkspaces(nextWorkspaces);
			}
		} catch (err) {
			if (!hasCachedWorkspaces) {
				setError(err instanceof Error ? err.message : props.t('workspace.loadFailed'));
			}
		} finally {
			setBusy(false);
		}
	}, [deviceId, props]);

	React.useEffect(() => {
		if (!props.isOpen) return;
		void load();
	}, [props.isOpen, load]);

	React.useEffect(() => {
		if (props.isOpen) return;
		setError(null);
		setCreateName('');
		setRenameId(null);
		setRenameValue('');
	}, [props.isOpen]);

	const activateWorkspace = React.useCallback(
		async (workspaceId: string) => {
			if (busy) return;
			if (props.authUserId && typeof navigator !== 'undefined' && navigator.onLine === false) {
				await cacheActiveWorkspaceSelection({
					userId: props.authUserId,
					deviceId,
					activeWorkspaceId: workspaceId,
				});
				setActiveWorkspaceId(workspaceId);
				props.onWorkspaceActivated(workspaceId);
				props.onClose();
				return;
			}
			setBusy(true);
			setError(null);
			try {
				await fetchJson<{ activeWorkspaceId: string }>(
					`/api/workspaces/${encodeURIComponent(workspaceId)}/activate`,
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ deviceId }),
					}
				);
				if (props.authUserId) {
					await cacheActiveWorkspaceSelection({
						userId: props.authUserId,
						deviceId,
						activeWorkspaceId: workspaceId,
					});
				}
				setActiveWorkspaceId(workspaceId);
				props.onWorkspaceActivated(workspaceId);
				props.onClose();
			} catch (err) {
				if (props.authUserId) {
					const cached = await readCachedWorkspaceSnapshot(props.authUserId, deviceId);
					if (cached.workspaces.some((workspace) => workspace.id === workspaceId)) {
						await cacheActiveWorkspaceSelection({
							userId: props.authUserId,
							deviceId,
							activeWorkspaceId: workspaceId,
						});
						setActiveWorkspaceId(workspaceId);
						props.onWorkspaceActivated(workspaceId);
						props.onClose();
						setBusy(false);
						return;
					}
				}
				setError(err instanceof Error ? err.message : props.t('workspace.activateFailed'));
			} finally {
				setBusy(false);
			}
		},
		[busy, deviceId, props]
	);

	const createWorkspace = React.useCallback(async () => {
		if (busy) return;
		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			if (!props.authUserId) {
				setError(props.t('workspace.createFailed'));
				return;
			}
			// Offline-create branch: materialize the row locally and queue the mutation for
			// replay on the next online transition instead of blocking on the server.
			const now = new Date().toISOString();
			const workspace: WorkspaceListItem = {
				id: createWorkspaceId(),
				name: createName.trim() || props.t('workspace.unnamed'),
				role: 'OWNER',
				ownerUserId: props.authUserId,
				createdAt: now,
				updatedAt: now,
				pendingSync: true,
				pendingSyncKind: 'create',
			};
			await queueOfflineWorkspaceCreate({
				userId: props.authUserId,
				deviceId,
				workspace,
				role: 'OWNER',
			});
			setCreateName('');
			const merged = await readCachedWorkspaceSnapshot(props.authUserId, deviceId);
			setActiveWorkspaceId(merged.activeWorkspaceId);
			setWorkspaces(merged.workspaces);
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const data = await fetchJson<{ workspace: WorkspaceListItem }>(`/api/workspaces`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: createName }),
			});
			if (data.workspace) {
				await cacheWorkspaceDetails({ workspace: data.workspace, userId: props.authUserId, role: 'OWNER' });
			}
			setCreateName('');
			await load();
		} catch (err) {
			const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
			setError(err instanceof Error ? err.message : isOffline ? props.t('workspace.createFailed') : props.t('workspace.createFailed'));
		} finally {
			setBusy(false);
		}
	}, [busy, createName, load, props]);

	const renameWorkspace = React.useCallback(
		async (workspaceId: string) => {
			if (busy) return;
			const nextName = renameValue.trim();
			if (!nextName) {
				setError(props.t('workspace.renameInvalid'));
				return;
			}

			setBusy(true);
			setError(null);
			try {
				const data = await fetchJson<{ workspace: WorkspaceListItem }>(`/api/workspaces/${encodeURIComponent(workspaceId)}`,
					{
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ name: nextName }),
					}
				);
				if (data.workspace) {
					await cacheWorkspaceDetails({
						workspace: data.workspace,
						userId: props.authUserId,
						role: getWorkspaceRole(workspaces, workspaceId),
					});
				}
				setRenameId(null);
				setRenameValue('');
				await load();
				if (activeWorkspaceId && workspaceId === activeWorkspaceId) {
					props.onActiveWorkspaceRenamed?.();
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : props.t('workspace.renameFailed'));
			} finally {
				setBusy(false);
			}
		},
		[activeWorkspaceId, busy, load, props, renameValue]
	);

	const deleteWorkspace = React.useCallback(
		async (workspace: WorkspaceListItem) => {
			if (busy) return;
			if (typeof navigator !== 'undefined' && navigator.onLine === false) {
				if (!props.authUserId) {
					setError(props.t('workspace.deleteFailed'));
					return;
				}
			}
			const confirmed = typeof window === 'undefined'
				? true
				: window.confirm(`${props.t('workspace.deleteConfirm')} "${getWorkspaceDisplayName(workspace, props.t)}"?`);
			if (!confirmed) return;

			if (typeof navigator !== 'undefined' && navigator.onLine === false) {
				// Offline-delete branch: hide the workspace immediately, persist the next active
				// selection locally, and let App replay the delete request once back online.
				const remaining = workspaces.filter((entry) => entry.id !== workspace.id);
				const nextActiveWorkspaceId = activeWorkspaceId === workspace.id ? (remaining[0]?.id ?? null) : activeWorkspaceId;
				await queueOfflineWorkspaceDelete({
					userId: props.authUserId!,
					deviceId,
					workspaceId: workspace.id,
					workspaceName: workspace.name,
					ownerUserId: workspace.ownerUserId ?? props.authUserId,
					role: workspace.role,
				});
				await removeCachedWorkspace({
					workspaceId: workspace.id,
					userId: props.authUserId,
					deviceId,
				});
				await cacheActiveWorkspaceSelection({
					userId: props.authUserId!,
					deviceId,
					activeWorkspaceId: nextActiveWorkspaceId,
				});
				setWorkspaces(remaining);
				setActiveWorkspaceId(nextActiveWorkspaceId);
				props.onWorkspaceDeleted?.(workspace.id, nextActiveWorkspaceId);
				props.onClose();
				return;
			}

			setBusy(true);
			setError(null);
			try {
				// Online-delete branch: ask the server to tombstone the workspace first, then
				// mirror that authoritative result into the local cache.
				const data = await fetchJson<{ deletedWorkspaceId: string; activeWorkspaceId: string | null }>(
					`/api/workspaces/${encodeURIComponent(workspace.id)}`,
					{
						method: 'DELETE',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ deviceId }),
					}
				);
				if (props.authUserId) {
					await removeCachedWorkspace({
						workspaceId: workspace.id,
						userId: props.authUserId,
						deviceId,
					});
					await cacheActiveWorkspaceSelection({
						userId: props.authUserId,
						deviceId,
						activeWorkspaceId: data.activeWorkspaceId ?? null,
					});
				}
				setWorkspaces((prev) => prev.filter((entry) => entry.id !== workspace.id));
				setActiveWorkspaceId(data.activeWorkspaceId ?? null);
				setRenameId((current) => (current === workspace.id ? null : current));
				setRenameValue('');
				props.onWorkspaceDeleted?.(workspace.id, data.activeWorkspaceId ?? null);
				props.onClose();
			} catch (err) {
				setError(err instanceof Error ? err.message : props.t('workspace.deleteFailed'));
			} finally {
				setBusy(false);
			}
		},
		[busy, deviceId, props]
	);

	const sortedWorkspaces = React.useMemo(() => {
		if (!activeWorkspaceId) return workspaces;
		const active = workspaces.find((ws) => ws.id === activeWorkspaceId);
		if (!active) return workspaces;
		const rest = workspaces.filter((ws) => ws.id !== activeWorkspaceId);
		return [active, ...rest];
	}, [activeWorkspaceId, workspaces]);

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={styles.modal} role="dialog" aria-modal="true" aria-label={props.t('workspace.title')} onClick={(e) => e.stopPropagation()}>
				<header className={styles.header}>
					<h2 className={styles.title}>{props.t('workspace.title')}</h2>
					<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label={props.t('common.close')}>
						✕
					</button>
				</header>

				{error ? <div className={styles.error}>{error}</div> : null}

				<div className={styles.list} aria-label={props.t('workspace.listAria')}>
					{workspaces.length === 0 ? (
						<div className={styles.row}>
							<div className={styles.meta}>
								<div className={styles.name}>{props.t('workspace.none')}</div>
							</div>
						</div>
					) : (
						sortedWorkspaces.map((ws) => {
							const isActive = Boolean(activeWorkspaceId && ws.id === activeWorkspaceId);
							const canRename = ws.role === 'OWNER' || ws.role === 'ADMIN';
							const canDelete = ws.role === 'OWNER';
							const isRenaming = renameId === ws.id;
							return (
								<div key={ws.id} className={styles.row}>
									<div className={styles.meta}>
										<div className={`${styles.name}${isActive ? ` ${styles.activeName}` : ''}`} title={getWorkspaceDisplayName(ws, props.t)}>
											{getWorkspaceDisplayName(ws, props.t)}
										</div>
										<div className={styles.sub}>
											{props.t('workspace.role')}: {ws.role}{ws.pendingSync ? ` • ${props.t('workspace.pendingSync')}` : ''}
										</div>
									</div>
									<div className={styles.actions}>
										{isRenaming ? (
											<>
												<input
													className={styles.renameInput}
													value={renameValue}
													onChange={(e) => setRenameValue(e.target.value)}
													disabled={busy}
													aria-label={props.t('workspace.rename')}
													placeholder={props.t('workspace.renamePlaceholder')}
												/>
												<button type="button" disabled={busy} onClick={() => void renameWorkspace(ws.id)}>
													{props.t('workspace.saveName')}
												</button>
												<button
													type="button"
													disabled={busy}
													onClick={() => {
														setRenameId(null);
														setRenameValue('');
													}}
												>
													{props.t('common.cancel')}
												</button>
											</>
										) : (
											<>
												{!isActive ? (
													<button type="button" disabled={busy} onClick={() => void activateWorkspace(ws.id)}>
														{props.t('workspace.activate')}
													</button>
												) : null}
												{canRename ? (
													<button
														type="button"
														disabled={busy}
														onClick={() => {
														setRenameId(ws.id);
														setRenameValue(getWorkspaceDisplayName(ws, props.t));
													}}
													>
														{props.t('workspace.rename')}
													</button>
												) : null}
													{canDelete ? (
														<button
															type="button"
															className={styles.dangerButton}
															disabled={busy}
															onClick={() => void deleteWorkspace(ws)}
														>
															{props.t('workspace.delete')}
														</button>
													) : null}
											</>
										)}
									</div>
								</div>
							);
						})
					)}
				</div>

				<div className={styles.form}>
					<input
						className={styles.input}
						value={createName}
						onChange={(e) => setCreateName(e.target.value)}
						placeholder={props.t('workspace.namePlaceholder')}
						disabled={busy}
					/>
					<button type="button" onClick={() => void createWorkspace()} disabled={busy}>
						{busy ? props.t('common.loading') : props.t('workspace.create')}
					</button>
				</div>

				<footer className={styles.footer}>
					<button type="button" onClick={props.onClose} disabled={busy}>
						{props.t('common.close')}
					</button>
				</footer>
			</section>
		</div>
	);
}
