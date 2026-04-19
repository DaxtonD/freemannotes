import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDatabase, faFile, faFileLines, faImage, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import { getPasswordStrengthLabel, getPasswordStrengthScore } from '../../core/passwordStrength';
import styles from './UserManagementModal.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// UserManagementModal — Admin UI for basic user management.
//
// This modal is a thin client for the server's admin endpoints:
//   - GET    /api/admin/users
//   - PATCH  /api/admin/users/:id/role
//   - POST   /api/admin/users/:id/reset-password
//   - DELETE /api/admin/users/:id
//   - POST   /api/admin/users
//
// Important server invariant (mirrored in UI as disabled controls):
//   - The earliest-created user is treated as the "server admin" and cannot be
//     demoted or deleted through the API.
//
// UI model:
//   - The table is loaded on open.
//   - Role changes are applied optimistically (then refreshed on failure).
//   - Destructive actions (delete/reset) require explicit user confirmation.
// ─────────────────────────────────────────────────────────────────────────────

export type AdminUserRow = {
	id: string;
	email: string;
	name: string;
	role: 'USER' | 'ADMIN';
	profileImage: string | null;
	disabled: boolean;
	createdAt: string;
	lastLogin: string | null;
	usage: {
		notes: number;
		images: number;
		imageBytes: number;
		totalBytes: number;
		filesBytes: number;
		dbBytes: number;
	};
};

const ADMIN_USER_CACHE_KEY = 'freemannotes.adminUserCache.v1';

function readCachedAdminUsers(): AdminUserRow[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = window.localStorage.getItem(ADMIN_USER_CACHE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as AdminUserRow[] | null;
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeCachedAdminUsers(users: readonly AdminUserRow[]): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(ADMIN_USER_CACHE_KEY, JSON.stringify(users));
	} catch {
		// best effort
	}
}

type Props = {
	isOpen: boolean;
	onClose: () => void;
	currentUserId: string | null;
};

function formatBytes(bytes: number): string {
	// Utility for rendering human-friendly storage sizes.
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let v = bytes;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i += 1;
	}
	const digits = i === 0 ? 0 : v < 10 ? 1 : 0;
	return `${v.toFixed(digits)} ${units[i]}`;
}

function initialsFor(nameOrEmail: string): string {
	// Fallback avatar label when the user has no profile image.
	const raw = String(nameOrEmail || '').trim();
	if (!raw) return '?';
	const name = raw.includes('@') ? raw.split('@')[0] : raw;
	const parts = name.split(/\s+/).filter(Boolean);
	const a = parts[0]?.[0] || '?';
	const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : '';
	return `${a}${b}`.toUpperCase();
}

async function fetchJson<T = unknown>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
	// Centralized fetch helper used by this modal.
	// - Always sends cookies (admin API is cookie-authenticated).
	// - Prefers server-provided `{ error: string }` messages when present.
	const res = await fetch(input, { credentials: 'include', ...init });
	const contentType = String(res.headers.get('content-type') || '').toLowerCase();
	const body = contentType.includes('application/json') ? await res.json().catch(() => null) : null;
	if (!res.ok) {
		const message = body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
		throw new Error(message);
	}
	return body as T;
}

export function UserManagementModal(props: Props): React.JSX.Element | null {
	// `busy` is used to disable form controls during network activity.
	// `error` is displayed as a single banner at the top of the modal.
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [query, setQuery] = React.useState('');
	useBodyScrollLock(props.isOpen, { disableTouchAction: false });
	const [users, setUsers] = React.useState<readonly AdminUserRow[]>([]);

	const [createEmail, setCreateEmail] = React.useState('');
	const [createName, setCreateName] = React.useState('');
	const [createPassword, setCreatePassword] = React.useState('');
	const [createRole, setCreateRole] = React.useState<'USER' | 'ADMIN'>('USER');
	const [resetPasswordTarget, setResetPasswordTarget] = React.useState<{ userId: string; email: string } | null>(null);
	const [resetPasswordValue, setResetPasswordValue] = React.useState('');
	const [resetPasswordConfirm, setResetPasswordConfirm] = React.useState('');
	// Controls which accordion section is expanded — only one panel is open at a time.
	const [openPanel, setOpenPanel] = React.useState<'users' | 'create'>('users');
	const resetPasswordStrengthScore = React.useMemo(() => getPasswordStrengthScore(resetPasswordValue), [resetPasswordValue]);
	const resetPasswordStrengthLabel = React.useMemo(() => getPasswordStrengthLabel(resetPasswordValue), [resetPasswordValue]);

	const loadUsers = React.useCallback(async () => {
		// Loads the full user list from the server.
		const cachedUsers = readCachedAdminUsers();
		if (cachedUsers.length > 0) {
			setUsers(cachedUsers);
		}
		setBusy(true);
		setError(null);
		try {
			const data = await fetchJson<{ users: AdminUserRow[] }>('/api/admin/users');
			const nextUsers = Array.isArray(data.users) ? data.users : [];
			setUsers(nextUsers);
			writeCachedAdminUsers(nextUsers);
		} catch (err) {
			if (cachedUsers.length > 0) {
				setUsers(cachedUsers);
				setError(null);
				return;
			}
			setError(err instanceof Error ? err.message : 'Failed to load users');
		} finally {
			setBusy(false);
		}
	}, []);

	React.useEffect(() => {
		if (users.length === 0) return;
		writeCachedAdminUsers(users);
	}, [users]);

	React.useEffect(() => {
		// When the modal opens, fetch the latest list.
		if (!props.isOpen) return;
		void loadUsers();
	}, [props.isOpen, loadUsers]);

	const filtered = React.useMemo(() => {
		// Client-side search filter. We still rely on the server to enforce access.
		const q = query.trim().toLowerCase();
		if (!q) return users;
		return users.filter((u) => {
			return String(u.email).toLowerCase().includes(q) || String(u.name).toLowerCase().includes(q);
		});
	}, [query, users]);

	const serverAdminUserId = React.useMemo(() => {
		// Determine the "server admin" user id from the list by choosing the earliest
		// creation time. The server also enforces this; we use it to disable controls.
		if (!users || users.length === 0) return null;
		let best = users[0];
		let bestTs = Date.parse(best.createdAt);
		for (const u of users) {
			const ts = Date.parse(u.createdAt);
			if (!Number.isFinite(ts)) continue;
			if (!Number.isFinite(bestTs) || ts < bestTs) {
				best = u;
				bestTs = ts;
			}
		}
		return best?.id || null;
	}, [users]);

	const setRole = React.useCallback(async (userId: string, role: 'USER' | 'ADMIN') => {
		// Optimistic role update: update local UI first, then persist.
		// On error, reload from server to avoid drift.
		if (serverAdminUserId && userId === serverAdminUserId) return;
		setError(null);
		try {
			setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
			await fetchJson(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ role }),
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to update role');
			void loadUsers();
		}
	}, [loadUsers, serverAdminUserId]);

	const openResetPasswordModal = React.useCallback((userId: string, email: string) => {
		// Reset each draft when the nested modal opens so one admin action cannot
		// leak a stale password into the next user.
		setError(null);
		setResetPasswordTarget({ userId, email });
		setResetPasswordValue('');
		setResetPasswordConfirm('');
	}, []);

	const submitResetPassword = React.useCallback(async () => {
		if (!resetPasswordTarget) return;
		// Mirror the shared server policy client-side so mismatched or weak values
		// are rejected before the reset request is sent.
		if (resetPasswordValue !== resetPasswordConfirm) {
			setError('Passwords do not match');
			return;
		}
		if (resetPasswordStrengthScore < 2) {
			setError('Password is too weak');
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await fetchJson(`/api/admin/users/${encodeURIComponent(resetPasswordTarget.userId)}/reset-password`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password: resetPasswordValue }),
			});
			setResetPasswordTarget(null);
			setResetPasswordValue('');
			setResetPasswordConfirm('');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to reset password');
		} finally {
			setBusy(false);
		}
	}, [resetPasswordConfirm, resetPasswordStrengthScore, resetPasswordTarget, resetPasswordValue]);

	const deleteUser = React.useCallback(async (userId: string, email: string) => {
		// Destructive action: confirm first.
		if (!window.confirm(`Delete user ${email}? This cannot be undone.`)) return;
		setError(null);
		setBusy(true);
		try {
			await fetchJson(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
			await loadUsers();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to delete user');
		} finally {
			setBusy(false);
		}
	}, [loadUsers]);

	const createUser = React.useCallback(async () => {
		// Creates a new user and their default personal workspace on the server.
		setError(null);
		if (!createName.trim()) {
			setError('Name is required');
			return;
		}
		setBusy(true);
		try {
			await fetchJson('/api/admin/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: createEmail, name: createName, password: createPassword, role: createRole }),
			});
			setCreateEmail('');
			setCreateName('');
			setCreatePassword('');
			setCreateRole('USER');
			await loadUsers();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create user');
		} finally {
			setBusy(false);
		}
	}, [createEmail, createName, createPassword, createRole, loadUsers]);

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={styles.modal} role="dialog" aria-modal="true" aria-label="User management" onClick={(e) => e.stopPropagation()}>
				<header className={styles.header}>
					<h2 className={styles.title}>User management</h2>
					<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label="Close">
						<FontAwesomeIcon icon={faXmark} />
					</button>
				</header>

				{error ? <div className={styles.error}>{error}</div> : null}

				<div className={`${styles.sectionDisclosure} ${openPanel === 'users' ? styles.sectionDisclosureExpanded : ''}`}>
					<button
						type="button"
						className={`${styles.sectionSummaryButton} ${openPanel === 'users' ? styles.sectionSummaryButtonExpanded : ''}`}
						onClick={() => setOpenPanel('users')}
						aria-expanded={openPanel === 'users'}
					>
						<span className={styles.sectionSummaryLabel}>Users</span>
						<span className={styles.summaryCount}>{filtered.length}</span>
						<span className={styles.disclosureArrow} aria-hidden="true" />
					</button>
					<div className={`${styles.sectionPanel} ${openPanel === 'users' ? styles.sectionPanelExpanded : ''}`} aria-hidden={openPanel !== 'users'}>
						<div className={styles.sectionPanelInner}>
							<div className={styles.sectionCard}>
								<div className={styles.toolbar}>
									<input
										className={styles.search}
										placeholder="Search users (email or name)"
										value={query}
										onChange={(e) => setQuery(e.target.value)}
										disabled={busy}
									/>
									<button type="button" className={styles.refreshButton} onClick={() => void loadUsers()} disabled={busy}>
										Refresh
									</button>
								</div>

								<div className={styles.table}>
									<div className={styles.tableHeader}>
										<div>User</div>
										<div>Usage</div>
										<div className={styles.controlsHeader}>Controls</div>
									</div>

									{filtered.map((u) => {
						const isYou = props.currentUserId && u.id === props.currentUserId;
						const isServerAdmin = serverAdminUserId && u.id === serverAdminUserId;
						const displayEmail = `${u.email}${isYou ? ' (you)' : ''}`;
						const files = Number(u.usage?.filesBytes || 0);
						const db = Number(u.usage?.dbBytes || 0);
						const images = Number(u.usage?.images || 0);
						const imageBytes = Number(u.usage?.imageBytes || 0);
						const notes = Number(u.usage?.notes || 0);
						const usageItems = [
							{ key: 'db', icon: faDatabase, label: 'Database', value: formatBytes(db) },
							{ key: 'files', icon: faFile, label: 'Files', value: formatBytes(files) },
							{ key: 'images', icon: faImage, label: 'Images', value: formatBytes(imageBytes), title: `${images.toLocaleString()} image${images === 1 ? '' : 's'}` },
							{ key: 'notes', icon: faFileLines, label: 'Notes', value: String(notes) },
						] as const;
						return (
							<div key={u.id} className={styles.row}>
								<div className={styles.userCell}>
									<div className={styles.avatar} aria-hidden="true">
										{u.profileImage ? (
											<img className={styles.avatarImg} src={u.profileImage} alt="" />
										) : (
											<span>{initialsFor(u.name || u.email)}</span>
										)}
									</div>
									<div className={styles.userText}>
										<a className={styles.emailLink} href={`mailto:${u.email}`} title={u.email}>
											{displayEmail}
										</a>
										<div className={styles.name}>{u.name}</div>
									</div>
								</div>

								<div className={styles.usage}>
									{usageItems.map((item) => (
										<div key={item.key} className={styles.usageStat}>
											<span className={styles.usageIcon} aria-hidden="true">
												<FontAwesomeIcon icon={item.icon} />
											</span>
											<span className={styles.usageText} title={item.title}>
												<span className={styles.usageLabel}>{item.label}</span>
												<span className={styles.usageValue}>{item.value}</span>
											</span>
										</div>
									))}
								</div>

								<div className={styles.controls}>
									<select
										className={`${styles.select} ${styles.compactControl}`}
										value={u.role}
										disabled={busy || Boolean(isServerAdmin)}
										title={isServerAdmin ? 'Server admin role cannot be changed' : undefined}
										onChange={(e) => void setRole(u.id, e.target.value === 'ADMIN' ? 'ADMIN' : 'USER')}
									>
										<option value="ADMIN">Admin</option>
										<option value="USER">User</option>
									</select>
									<button type="button" className={`${styles.actionButton} ${styles.compactControl} ${styles.mobileTwoLineButton}`} onClick={() => openResetPasswordModal(u.id, u.email)} disabled={busy}>
										<span>Reset<br />password</span>
									</button>
									<button
										type="button"
										className={`${styles.actionButton} ${styles.compactControl}`}
										onClick={() => void deleteUser(u.id, u.email)}
										disabled={busy || Boolean(isServerAdmin)}
										title={isServerAdmin ? 'Server admin cannot be deleted' : undefined}
									>
										Delete
									</button>
								</div>
							</div>
						);
					})}
								</div>
							</div>
						</div>
					</div>
				</div>

				<div className={`${styles.sectionDisclosure} ${openPanel === 'create' ? styles.sectionDisclosureExpanded : ''}`}>
					<button
						type="button"
						className={`${styles.sectionSummaryButton} ${openPanel === 'create' ? styles.sectionSummaryButtonExpanded : ''}`}
						onClick={() => setOpenPanel('create')}
						aria-expanded={openPanel === 'create'}
					>
						<span className={styles.sectionSummaryLabel}>Create user</span>
						<span className={styles.disclosureArrow} aria-hidden="true" />
					</button>
					<div className={`${styles.sectionPanel} ${openPanel === 'create' ? styles.sectionPanelExpanded : ''}`} aria-hidden={openPanel !== 'create'}>
						<div className={styles.sectionPanelInner}>
						<div className={styles.sectionCard}>
							<form onSubmit={(e) => e.preventDefault()}>
							<div className={styles.createRow}>
						<input
							className={styles.input}
							placeholder="Email"
							value={createEmail}
							onChange={(e) => setCreateEmail(e.target.value)}
							disabled={busy}
						/>
						<input
							className={styles.input}
							placeholder="Name"
							value={createName}
							onChange={(e) => setCreateName(e.target.value)}
							disabled={busy}
							required
						/>
						<input
							className={styles.input}
							type="password"
							placeholder="Password"
							value={createPassword}
							onChange={(e) => setCreatePassword(e.target.value)}
							disabled={busy}
						/>
						<select className={styles.select} value={createRole} onChange={(e) => setCreateRole(e.target.value === 'ADMIN' ? 'ADMIN' : 'USER')} disabled={busy}>
							<option value="ADMIN">Admin</option>
							<option value="USER">User</option>
						</select>
						<button type="button" className={styles.refreshButton} onClick={() => void createUser()} disabled={busy}>
							Create
						</button>
								</div>
							</form>
							</div>
						</div>
					</div>
				</div>

				<footer className={styles.footer}>
					<button type="button" className={styles.closeButton} onClick={props.onClose}>
						Close
					</button>
				</footer>
			</section>
			{resetPasswordTarget ? (
				<div className={styles.resetPasswordOverlay} role="presentation" onClick={(event) => {
					event.stopPropagation();
					setResetPasswordTarget(null);
				}}>
					<section className={styles.resetPasswordModal} role="dialog" aria-modal="true" aria-label="Reset password" onClick={(e) => e.stopPropagation()}>
						<header className={styles.header}>
							<div>
								<h3 className={styles.sectionTitle}>Reset password</h3>
							</div>
							<button type="button" className={styles.iconButton} onClick={() => setResetPasswordTarget(null)} aria-label="Close">
								<FontAwesomeIcon icon={faXmark} />
							</button>
						</header>
						<form onSubmit={(e) => e.preventDefault()}>
						<div className={styles.resetPasswordBody}>
							<label className={styles.fieldLabel}>
								<span>New password</span>
								<input className={styles.input} type="password" autoComplete="new-password" value={resetPasswordValue} onChange={(e) => setResetPasswordValue(e.target.value)} disabled={busy} />
							</label>
							<div className={styles.passwordStrength} aria-live="polite">
								<div className={styles.passwordStrengthBar} aria-hidden="true">
									<span className={`${styles.passwordStrengthFill} ${styles[`passwordStrength${resetPasswordStrengthLabel}`]}`} style={{ width: `${Math.max(8, resetPasswordStrengthScore * 25)}%` }} />
								</div>
								<div className={styles.passwordStrengthCopy}>Password strength: {resetPasswordStrengthLabel}</div>
							</div>
							<label className={styles.fieldLabel}>
								<span>Confirm password</span>
								<input className={styles.input} type="password" autoComplete="new-password" value={resetPasswordConfirm} onChange={(e) => setResetPasswordConfirm(e.target.value)} disabled={busy} />
							</label>
							{resetPasswordConfirm && resetPasswordValue !== resetPasswordConfirm ? <div className={styles.error}>Passwords do not match</div> : null}
						</div>
						<footer className={styles.footer}>
							<button type="button" className={styles.closeButton} onClick={() => setResetPasswordTarget(null)} disabled={busy}>Cancel</button>
							<button type="button" className={styles.refreshButton} onClick={() => void submitResetPassword()} disabled={busy}>Save password</button>
						</footer>
						</form>
					</section>
				</div>
			) : null}
		</div>
	);
}
