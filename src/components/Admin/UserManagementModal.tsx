import React from 'react';
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
		totalBytes: number;
		filesBytes: number;
		dbBytes: number;
	};
};

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
	const [users, setUsers] = React.useState<readonly AdminUserRow[]>([]);

	const [createEmail, setCreateEmail] = React.useState('');
	const [createName, setCreateName] = React.useState('');
	const [createPassword, setCreatePassword] = React.useState('');
	const [createRole, setCreateRole] = React.useState<'USER' | 'ADMIN'>('USER');

	const loadUsers = React.useCallback(async () => {
		// Loads the full user list from the server.
		setBusy(true);
		setError(null);
		try {
			const data = await fetchJson<{ users: AdminUserRow[] }>('/api/admin/users');
			setUsers(Array.isArray(data.users) ? data.users : []);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load users');
		} finally {
			setBusy(false);
		}
	}, []);

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

	const resetPassword = React.useCallback(async (userId: string) => {
		// Password reset returns a temporary password that the admin must
		// communicate to the user out-of-band.
		setError(null);
		try {
			const data = await fetchJson<{ tempPassword: string }>(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
				method: 'POST',
			});
			window.alert(`Temporary password: ${data.tempPassword}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to reset password');
		}
	}, []);

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
						✕
					</button>
				</header>

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

				{error ? <div className={styles.error}>{error}</div> : null}

				<div className={styles.table}>
					<div className={styles.tableHeader}>
						<div>User</div>
						<div>Role</div>
						<div>Usage</div>
						<div style={{ textAlign: 'right' }}>Actions</div>
					</div>

					{filtered.map((u) => {
						const isYou = props.currentUserId && u.id === props.currentUserId;
						const isServerAdmin = serverAdminUserId && u.id === serverAdminUserId;
						const displayEmail = `${u.email}${isYou ? ' (you)' : ''}`;
						const total = Number(u.usage?.totalBytes || 0);
						const files = Number(u.usage?.filesBytes || 0);
						const db = Number(u.usage?.dbBytes || 0);
						const notes = Number(u.usage?.notes || 0);
						const images = Number(u.usage?.images || 0);
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

								<div>
									<select
										className={styles.select}
										value={u.role}
										disabled={busy || Boolean(isServerAdmin)}
										title={isServerAdmin ? 'Server admin role cannot be changed' : undefined}
										onChange={(e) => void setRole(u.id, e.target.value === 'ADMIN' ? 'ADMIN' : 'USER')}
									>
										<option value="ADMIN">Admin</option>
										<option value="USER">User</option>
									</select>
								</div>

								<div className={styles.usage}>
									<div>{notes} notes</div>
									<div className={styles.usageSecondary}>{images} images</div>
									<div>Total {formatBytes(total)}</div>
									<div className={styles.usageSecondary}>Files {formatBytes(files)}</div>
									<div>DB {formatBytes(db)}</div>
								</div>

								<div className={styles.actions}>
									<button type="button" className={styles.actionButton} onClick={() => void resetPassword(u.id)} disabled={busy}>
										Reset password
									</button>
									<button
										type="button"
										className={styles.actionButton}
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

				<div className={styles.section}>
					<h3 className={styles.sectionTitle}>Create user</h3>
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
				</div>

				<footer className={styles.footer}>
					<button type="button" className={styles.closeButton} onClick={props.onClose}>
						Close
					</button>
				</footer>
			</section>
		</div>
	);
}
