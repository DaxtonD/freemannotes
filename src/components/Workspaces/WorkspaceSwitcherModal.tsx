import React from 'react';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import { getDeviceId } from '../../core/deviceId';
import { canManageWorkspace, getWorkspaceRoleLabelKey, normalizeWorkspaceRole, type WorkspaceRole } from '../../core/workspaceRoles';
import {
	cacheActiveWorkspaceSelection,
	cacheWorkspaceDetails,
	cacheWorkspaceSnapshot,
	queueOfflineWorkspaceCreate,
	queueOfflineWorkspaceDelete,
	queueOfflineWorkspaceRename,
	removeCachedWorkspace,
	readCachedWorkspaceSnapshot,
} from '../../core/workspaceMetadataStore';
import { getWorkspaceDisplayName, isPersonalWorkspace } from '../../core/workspaceDisplay';
import styles from './WorkspaceSwitcherModal.module.css';

export type WorkspaceListItem = {
	id: string;
	name: string;
	role: WorkspaceRole;
	ownerUserId?: string | null;
	ownerName?: string | null;
	ownerEmail?: string | null;
	ownerProfileImage?: string | null;
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
	/**
	 * Called immediately before the DELETE request is sent so the parent can
	 * suppress the metadata-WebSocket echo that will arrive on the same connection
	 * shortly after the response — before the fetch Promise resolves.
	 */
	onBeforeWorkspaceDelete?: (workspaceId: string) => void;
	onWorkspaceDeleted?: (deletedWorkspaceId: string, nextActiveWorkspaceId: string | null) => void;
	onActiveWorkspaceRenamed?: () => void;
	/**
	 * Called just before the optimistic workspace switch so the parent can
	 * disable WebSocket sync while the server session hasn't been updated yet.
	 */
	onBeforeWorkspaceActivated?: (workspaceId: string) => void;
	/**
	 * Called once the background server-activation POST succeeds, so the parent
	 * can re-enable WebSocket sync once the session cookie is up-to-date.
	 */
	onWorkspaceActivationComplete?: (workspaceId: string) => void;
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
				role: normalizeWorkspaceRole(workspace.role),
				ownerUserId: typeof workspace.ownerUserId === 'string' ? workspace.ownerUserId : null,
				ownerName: typeof workspace.ownerName === 'string' ? workspace.ownerName : null,
				ownerEmail: typeof workspace.ownerEmail === 'string' ? workspace.ownerEmail : null,
				ownerProfileImage: typeof workspace.ownerProfileImage === 'string' ? workspace.ownerProfileImage : null,
				systemKind: typeof workspace.systemKind === 'string' ? workspace.systemKind.toUpperCase() : null,
				createdAt: typeof workspace.createdAt === 'string' ? workspace.createdAt : new Date(0).toISOString(),
				updatedAt: typeof workspace.updatedAt === 'string' ? workspace.updatedAt : typeof workspace.createdAt === 'string' ? workspace.createdAt : new Date(0).toISOString(),
			};
		})
		.filter((workspace): workspace is WorkspaceListItem => Boolean(workspace));
}

function getWorkspaceRole(workspaces: readonly WorkspaceListItem[], workspaceId: string): WorkspaceRole | null {
	const match = workspaces.find((workspace) => workspace.id === workspaceId);
	return match ? match.role : null;
}

function getWorkspaceRoleLabel(role: WorkspaceListItem['role'], t: Props['t']): string {
	return t(getWorkspaceRoleLabelKey(role));
}

function getWorkspaceOwnerDisplayName(workspace: WorkspaceListItem, authUserId: string | null, t: Props['t']): string | null {
	if (!workspace.ownerUserId || workspace.ownerUserId === authUserId || workspace.systemKind === 'SHARED_WITH_ME') return null;
	const ownerName = typeof workspace.ownerName === 'string' ? workspace.ownerName.trim() : '';
	if (ownerName) return ownerName;
	const ownerEmail = typeof workspace.ownerEmail === 'string' ? workspace.ownerEmail.trim() : '';
	if (ownerEmail) return ownerEmail;
	return t('workspace.ownedByUnknown');
}

function isProtectedWorkspace(workspace: WorkspaceListItem, t: Props['t']): boolean {
	if (workspace.systemKind === 'SHARED_WITH_ME') return true;
	return getWorkspaceDisplayName(workspace, t) === t('workspace.personal');
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

function normalizeWorkspaceNameKey(name: string): string {
	return name.trim().toLocaleLowerCase();
}

function isReservedWorkspaceName(name: string, t: Props['t']): boolean {
	// Match against the user-facing labels as well as the legacy stored forms so
	// built-in workspaces cannot be recreated under a cosmetic alias.
	const normalized = normalizeWorkspaceNameKey(name);
	if (!normalized) return false;
	if (normalized === normalizeWorkspaceNameKey(t('workspace.personal'))) return true;
	if (normalized === normalizeWorkspaceNameKey(t('workspace.sharedWithMe'))) return true;
	if (/^personal \([0-9a-f-]{36}\)$/i.test(name.trim())) return true;
	if (/^shared with me \([0-9a-f-]{36}\)$/i.test(name.trim())) return true;
	return false;
}

function hasDuplicateWorkspaceName(
	workspaces: readonly WorkspaceListItem[],
	name: string,
	t: Props['t'],
	excludeWorkspaceId?: string | null
): boolean {
	const normalized = normalizeWorkspaceNameKey(name);
	if (!normalized) return false;
	if (isReservedWorkspaceName(name, t)) return true;
	return workspaces.some((workspace) => {
		if (excludeWorkspaceId && workspace.id === excludeWorkspaceId) return false;
		// Compare both raw stored names and normalized display labels so legacy system
		// workspace names still block duplicates in the modal.
		if (normalizeWorkspaceNameKey(workspace.name) === normalized) return true;
		return normalizeWorkspaceNameKey(getWorkspaceDisplayName(workspace, t)) === normalized;
	});
}

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
	const res = await fetch(input, { credentials: 'include', ...init });
	const contentType = String(res.headers.get('content-type') || '').toLowerCase();
	const body = contentType.includes('application/json') ? await res.json().catch(() => null) : null;
	if (!res.ok) {
		const message = body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
		const error = new Error(message) as Error & { status?: number };
		error.status = res.status;
		throw error;
	}
	return body as T;
}

function isGatewayError(error: unknown): boolean {
	const status = (error as { status?: number } | null)?.status;
	return status === 502 || status === 503 || status === 504;
}

export function WorkspaceSwitcherModal(props: Props): React.JSX.Element | null {
	useBodyScrollLock(props.isOpen, { disableTouchAction: false });
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
						ownerName: workspace.ownerName ?? null,
						ownerEmail: workspace.ownerEmail ?? null,
						ownerProfileImage: workspace.ownerProfileImage ?? null,
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
	}, [deviceId, props.authUserId, props.t]);

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

			// ── Offline-first: switch immediately, confirm with server in background ──
			//
			// We always switch the UI straight away using the locally-cached workspace
			// data so the user sees their notes within milliseconds (IDB hydration),
			// regardless of network quality. The server /activate call is sent in the
			// background and is only used to update the session cookie so that WebSocket
			// connections to the new workspace are authorised. WS sync is disabled until
			// that call succeeds to prevent "forbidden namespace" errors.

			// Step 1: Disable WS before switching room namespaces.
			props.onBeforeWorkspaceActivated?.(workspaceId);

			// Step 2: Update local cache and switch the view immediately.
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

			// Step 3: Offline — no WS needed, nothing else to do.
			if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

			// Step 4: Background server activation with retries.
			// The modal is already closed here; callbacks land in App.tsx safely.
			void (async () => {
				for (let attempt = 0; attempt < 3; attempt++) {
					try {
						await fetchJson<{ activeWorkspaceId: string }>(
							`/api/workspaces/${encodeURIComponent(workspaceId)}/activate`,
							{
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ deviceId }),
							}
						);
						// Session cookie updated — safe to re-enable WS.
						props.onWorkspaceActivationComplete?.(workspaceId);
						return;
					} catch {
						if (attempt < 2) {
							// Back off before retrying (2 s, then 4 s).
							await new Promise<void>((resolve) => {
								window.setTimeout(resolve, 2000 * (attempt + 1));
							});
						}
					}
				}
				// All retries exhausted — WS unavailable until the app
				// is reloaded or the user re-switches to this workspace.
			})();
		},
		[busy, deviceId, props]
	);

	const createWorkspace = React.useCallback(async () => {
		if (busy) return;
		const nextName = createName.trim();
		if (hasDuplicateWorkspaceName(workspaces, nextName, props.t)) {
			setError(props.t('workspace.duplicateName'));
			return;
		}
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
				name: nextName || props.t('workspace.unnamed'),
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
				body: JSON.stringify({ name: nextName }),
			});
			if (data.workspace) {
				await cacheWorkspaceDetails({ workspace: data.workspace, userId: props.authUserId, role: 'OWNER' });
			}
			setCreateName('');
			await load();
		} catch (err) {
			if (isGatewayError(err) && props.authUserId) {
				// Server unreachable (502/503/504) — queue the create for replay once online.
				const now = new Date().toISOString();
				const workspace: WorkspaceListItem = {
					id: createWorkspaceId(),
					name: nextName || props.t('workspace.unnamed'),
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
			} else {
				setError(err instanceof Error ? err.message : props.t('workspace.createFailed'));
			}
		} finally {
			setBusy(false);
		}
	}, [busy, createName, load, props, workspaces]);

	const renameWorkspace = React.useCallback(
		async (workspaceId: string) => {
			if (busy) return;
			const nextName = renameValue.trim();
			if (!nextName) {
				setError(props.t('workspace.renameInvalid'));
				return;
			}
			if (hasDuplicateWorkspaceName(workspaces, nextName, props.t, workspaceId)) {
				setError(props.t('workspace.duplicateName'));
				return;
			}

			const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
			if (isOffline) {
				if (!props.authUserId) {
					setError(props.t('workspace.renameFailed'));
					return;
				}
				// Offline rename flow: queue the mutation and update cached workspace
				// records now so the new name is visible immediately without waiting
				// for the next successful server round-trip.
				await queueOfflineWorkspaceRename({
					userId: props.authUserId,
					deviceId: getDeviceId(),
					workspaceId,
					nextName,
					ownerUserId: props.authUserId,
					role: getWorkspaceRole(workspaces, workspaceId),
				});
				setRenameId(null);
				setRenameValue('');
				await load();
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
		[activeWorkspaceId, busy, load, props, renameValue, workspaces]
	);

	const deleteWorkspace = React.useCallback(
		async (workspace: WorkspaceListItem) => {
			if (busy) return;
			if (isProtectedWorkspace(workspace, props.t)) return;
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
				//
				// Notify the parent BEFORE sending the request so it can register a
				// suppression guard for the metadata-WebSocket echo.  The server publishes
				// the echo right after issuing the HTTP response; on fast/local connections
				// the WebSocket message can arrive and be processed by the browser BEFORE
				// the fetch Promise resolves, creating a race where clearActiveWorkspaceState
				// disables WebSocket sync before the workspace switch completes.
				props.onBeforeWorkspaceDelete?.(workspace.id);
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

	// Sort order: Personal workspace first, then Shared-With-Me, then user-created
	// workspaces. Within the user-created group, the currently active workspace is
	// floated to the top so it's always visible without scrolling.
	// Personal is identified by its name pattern ("Personal (<userId>)"), NOT by
	// systemKind — it has systemKind: null in the database.
	const sortedWorkspaces = React.useMemo(() => {
		const personalWorkspace = workspaces.find(isPersonalWorkspace) || null;
		const sharedWorkspace = workspaces.find((workspace) => (workspace.systemKind || '').toUpperCase() === 'SHARED_WITH_ME') || null;
		const pinnedWorkspaceIds = new Set<string>();
		if (personalWorkspace) pinnedWorkspaceIds.add(personalWorkspace.id);
		if (sharedWorkspace) pinnedWorkspaceIds.add(sharedWorkspace.id);

		const remaining = workspaces.filter((workspace) => !pinnedWorkspaceIds.has(workspace.id));
		if (activeWorkspaceId) {
			const activeRemainingIndex = remaining.findIndex((workspace) => workspace.id === activeWorkspaceId);
			if (activeRemainingIndex > 0) {
				const [activeRemainingWorkspace] = remaining.splice(activeRemainingIndex, 1);
				remaining.unshift(activeRemainingWorkspace);
			}
		}

		return [
			...(personalWorkspace ? [personalWorkspace] : []),
			...(sharedWorkspace ? [sharedWorkspace] : []),
			...remaining,
		];
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
							const canRename = canManageWorkspace(ws.role);
							const canDelete = ws.role === 'OWNER' && !isProtectedWorkspace(ws, props.t);
							const isRenaming = renameId === ws.id;
								const ownerDisplayName = getWorkspaceOwnerDisplayName(ws, props.authUserId, props.t);
							return (
								<div key={ws.id} className={styles.row}>
									<div className={styles.meta}>
											<div className={styles.nameRow}>
												<div className={`${styles.name}${isActive ? ` ${styles.activeName}` : ''}`} title={getWorkspaceDisplayName(ws, props.t)}>
													{getWorkspaceDisplayName(ws, props.t)}
												</div>
												{ownerDisplayName ? (
													<span className={styles.ownerName} title={`${props.t('workspace.ownedBy')} ${ownerDisplayName}`}>
														{ownerDisplayName}
													</span>
												) : null}
										</div>
										<div className={styles.sub}>
											{props.t('workspace.role')}: {getWorkspaceRoleLabel(ws.role, props.t)}{ws.pendingSync ? ` • ${props.t('workspace.pendingSync')}` : ''}
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
