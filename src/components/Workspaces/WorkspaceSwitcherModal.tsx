import React from 'react';
import styles from './WorkspaceSwitcherModal.module.css';

export type WorkspaceListItem = {
	id: string;
	name: string;
	role: 'OWNER' | 'ADMIN' | 'MEMBER';
	createdAt: string;
};

type ListResponse = {
	activeWorkspaceId: string | null;
	workspaces: WorkspaceListItem[];
};

type Props = {
	isOpen: boolean;
	onClose: () => void;
	t: (key: string) => string;
	onWorkspaceActivated: (workspaceId: string) => void;
	onActiveWorkspaceRenamed?: () => void;
};

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
		try {
			const data = await fetchJson<ListResponse>('/api/workspaces');
			setActiveWorkspaceId(typeof data.activeWorkspaceId === 'string' ? data.activeWorkspaceId : null);
			setWorkspaces(Array.isArray(data.workspaces) ? data.workspaces : []);
		} catch (err) {
			setError(err instanceof Error ? err.message : props.t('workspace.loadFailed'));
		} finally {
			setBusy(false);
		}
	}, [props]);

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
			setBusy(true);
			setError(null);
			try {
				await fetchJson<{ activeWorkspaceId: string }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/activate`, {
					method: 'POST',
				});
				props.onWorkspaceActivated(workspaceId);
				props.onClose();
			} catch (err) {
				setError(err instanceof Error ? err.message : props.t('workspace.activateFailed'));
			} finally {
				setBusy(false);
			}
		},
		[busy, props]
	);

	const createWorkspace = React.useCallback(async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await fetchJson<{ workspace: WorkspaceListItem }>(`/api/workspaces`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: createName }),
			});
			setCreateName('');
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : props.t('workspace.createFailed'));
		} finally {
			setBusy(false);
		}
	}, [busy, createName, load, props.t]);

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
				await fetchJson<{ workspace: WorkspaceListItem }>(`/api/workspaces/${encodeURIComponent(workspaceId)}`,
					{
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ name: nextName }),
					}
				);
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
						workspaces.map((ws) => {
							const isActive = Boolean(activeWorkspaceId && ws.id === activeWorkspaceId);
							const canRename = ws.role === 'OWNER' || ws.role === 'ADMIN';
							const isRenaming = renameId === ws.id;
							return (
								<div key={ws.id} className={styles.row}>
									<div className={styles.meta}>
										<div className={styles.name} title={ws.name}>
											{ws.name}
											{isActive ? ` (${props.t('workspace.active')})` : ''}
										</div>
										<div className={styles.sub}>
											{props.t('workspace.role')}: {ws.role}
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
												<button type="button" disabled={busy || isActive} onClick={() => void activateWorkspace(ws.id)}>
													{props.t('workspace.activate')}
												</button>
												{canRename ? (
													<button
														type="button"
														disabled={busy}
														onClick={() => {
														setRenameId(ws.id);
														setRenameValue(ws.name);
													}}
													>
														{props.t('workspace.rename')}
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
