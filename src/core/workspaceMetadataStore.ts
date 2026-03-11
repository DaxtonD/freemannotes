import { normalizeWorkspaceRole, type WorkspaceRole } from './workspaceRoles';
type WorkspaceMutationKind = 'create' | 'delete';

// Offline workspace metadata cache:
// - Stores the last server snapshot for workspace rows, memberships, and the
//   active-workspace device preference.
// - Stores a per-device mutation queue for offline create/delete operations.
// - Rebuilds the UI by reading the server snapshot first, then folding pending
//   offline mutations on top so the interface reflects what the user just did.

type WorkspaceRow = {
	id: string;
	name: string;
	ownerUserId: string | null;
	systemKind: string | null;
	createdAt: string;
	updatedAt: string;
};

type WorkspaceMemberRow = {
	userId: string;
	workspaceId: string;
	role: WorkspaceRole;
};

type UserDevicePreferenceRow = {
	userId: string;
	deviceId: string;
	activeWorkspaceId: string | null;
	activeSharedFolder: string | null;
	createdAt: string;
	updatedAt: string;
};

type WorkspaceMutationRow = {
	id: string;
	userId: string;
	deviceId: string;
	workspaceId: string;
	kind: WorkspaceMutationKind;
	workspaceName: string | null;
	ownerUserId: string | null;
	role: WorkspaceRole;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
};

export type CachedWorkspaceListItem = {
	id: string;
	name: string;
	role: WorkspaceRole;
	ownerUserId: string | null;
	systemKind?: string | null;
	createdAt: string;
	updatedAt: string;
	pendingSync?: boolean;
	pendingSyncKind?: WorkspaceMutationKind | null;
};

export type CachedWorkspaceSnapshot = {
	activeWorkspaceId: string | null;
	activeSharedFolder: string | null;
	preferenceUpdatedAt: string | null;
	workspaces: CachedWorkspaceListItem[];
};

export type PendingWorkspaceMutation = {
	id: string;
	workspaceId: string;
	kind: WorkspaceMutationKind;
	workspaceName: string | null;
	ownerUserId: string | null;
	role: WorkspaceRole;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
};

const DB_NAME = 'freemannotes.workspace-metadata.v1';
const DB_VERSION = 2;
// Separate stores keep the authoritative server snapshot normalized:
// workspace rows can be reused across users, membership rows answer "which
// workspaces belong to this user", and preferences/mutations stay device-scoped.
const WORKSPACE_STORE = 'workspace';
const WORKSPACE_MEMBER_STORE = 'workspace_member';
const USER_DEVICE_PREFERENCE_STORE = 'user_device_preference';
const WORKSPACE_MUTATION_STORE = 'workspace_mutation';

let dbPromise: Promise<IDBDatabase> | null = null;

function getNowIso(): string {
	return new Date().toISOString();
}

function asIsoString(value: unknown, fallback = getNowIso()): string {
	if (typeof value !== 'string') return fallback;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function asWorkspaceRole(value: unknown): WorkspaceRole {
	return normalizeWorkspaceRole(value);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
	});
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
		transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
	});
}

function deleteIndexMatches(index: IDBIndex, key: IDBValidKey | IDBKeyRange): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = index.openCursor(key);
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) {
				resolve();
				return;
			}
			cursor.delete();
			cursor.continue();
		};
		request.onerror = () => reject(request.error || new Error('IndexedDB cursor failed'));
	});
}

async function openWorkspaceMetadataDb(): Promise<IDBDatabase> {
	if (typeof indexedDB === 'undefined') {
		throw new Error('IndexedDB is unavailable');
	}
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(WORKSPACE_STORE)) {
					db.createObjectStore(WORKSPACE_STORE);
				}
				if (!db.objectStoreNames.contains(WORKSPACE_MEMBER_STORE)) {
					const store = db.createObjectStore(WORKSPACE_MEMBER_STORE);
					store.createIndex('userId', 'userId', { unique: false });
					store.createIndex('workspaceId', 'workspaceId', { unique: false });
				}
				if (!db.objectStoreNames.contains(USER_DEVICE_PREFERENCE_STORE)) {
					const store = db.createObjectStore(USER_DEVICE_PREFERENCE_STORE);
					store.createIndex('userId', 'userId', { unique: false });
					store.createIndex('userId_deviceId', ['userId', 'deviceId'], { unique: true });
				}
				if (!db.objectStoreNames.contains(WORKSPACE_MUTATION_STORE)) {
					const store = db.createObjectStore(WORKSPACE_MUTATION_STORE, { keyPath: 'id' });
					store.createIndex('userId_deviceId', ['userId', 'deviceId'], { unique: false });
					store.createIndex('workspaceId', 'workspaceId', { unique: false });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
		});
	}
	return dbPromise;
}

function sortWorkspaceMutations(rows: readonly WorkspaceMutationRow[]): WorkspaceMutationRow[] {
	return [...rows].sort((left, right) => {
		const leftMs = Date.parse(left.updatedAt || left.createdAt || '');
		const rightMs = Date.parse(right.updatedAt || right.createdAt || '');
		if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
			return leftMs - rightMs;
		}
		return left.id.localeCompare(right.id);
	});
}

// Replay queued offline mutations onto a cached server snapshot.
// Creates add optimistic rows, deletes hide rows and clear active selection when
// that selection targets a soon-to-be-deleted workspace.
function applyWorkspaceMutations(snapshot: CachedWorkspaceSnapshot, rows: readonly WorkspaceMutationRow[]): CachedWorkspaceSnapshot {
	const workspacesById = new Map(snapshot.workspaces.map((workspace) => [workspace.id, workspace]));
	let activeWorkspaceId = snapshot.activeWorkspaceId;

	for (const row of sortWorkspaceMutations(rows)) {
		if (row.kind === 'create') {
			workspacesById.set(row.workspaceId, {
				id: row.workspaceId,
				name: row.workspaceName || '',
				role: asWorkspaceRole(row.role),
				ownerUserId: row.ownerUserId ?? null,
				systemKind: null,
				createdAt: asIsoString(row.createdAt),
				updatedAt: asIsoString(row.updatedAt, asIsoString(row.createdAt)),
				pendingSync: true,
				pendingSyncKind: 'create',
			});
			continue;
		}

		workspacesById.delete(row.workspaceId);
		if (activeWorkspaceId === row.workspaceId) {
			activeWorkspaceId = null;
		}
	}

	return {
		activeWorkspaceId,
		activeSharedFolder: snapshot.activeSharedFolder,
		preferenceUpdatedAt: snapshot.preferenceUpdatedAt,
		workspaces: Array.from(workspacesById.values()).sort((left, right) => left.id.localeCompare(right.id)),
	};
}

async function readWorkspaceMutationRows(userId: string, deviceId: string): Promise<WorkspaceMutationRow[]> {
	if (!userId || !deviceId) return [];
	const db = await openWorkspaceMetadataDb();
	const tx = db.transaction([WORKSPACE_MUTATION_STORE], 'readonly');
	const store = tx.objectStore(WORKSPACE_MUTATION_STORE);
	const rows = await requestToPromise(store.index('userId_deviceId').getAll([userId, deviceId])) as WorkspaceMutationRow[];
	await transactionToPromise(tx);
	return Array.isArray(rows) ? rows : [];
}

async function safeReadWorkspaceMutationRows(userId: string, deviceId: string): Promise<WorkspaceMutationRow[]> {
	try {
		return await readWorkspaceMutationRows(userId, deviceId);
	} catch {
		return [];
	}
}

export async function readPendingWorkspaceMutations(userId: string, deviceId: string): Promise<PendingWorkspaceMutation[]> {
	try {
		const rows = await safeReadWorkspaceMutationRows(userId, deviceId);
		return sortWorkspaceMutations(rows).map((row) => ({
			id: row.id,
			workspaceId: row.workspaceId,
			kind: row.kind,
			workspaceName: row.workspaceName ?? null,
			ownerUserId: row.ownerUserId ?? null,
			role: asWorkspaceRole(row.role),
			createdAt: asIsoString(row.createdAt),
			updatedAt: asIsoString(row.updatedAt, asIsoString(row.createdAt)),
			deletedAt: row.deletedAt ? asIsoString(row.deletedAt) : null,
		}));
	} catch {
		return [];
	}
}

export async function readCachedWorkspaceSnapshot(userId: string, deviceId: string): Promise<CachedWorkspaceSnapshot> {
	if (!userId || !deviceId) {
		return { activeWorkspaceId: null, activeSharedFolder: null, preferenceUpdatedAt: null, workspaces: [] };
	}
	try {
		// Read the normalized snapshot in one readonly transaction, then fold queued
		// mutations afterward so the UI sees "server snapshot + offline intent".
		const db = await openWorkspaceMetadataDb();
		const tx = db.transaction([WORKSPACE_STORE, WORKSPACE_MEMBER_STORE, USER_DEVICE_PREFERENCE_STORE], 'readonly');
		const workspaceStore = tx.objectStore(WORKSPACE_STORE);
		const memberStore = tx.objectStore(WORKSPACE_MEMBER_STORE);
		const prefStore = tx.objectStore(USER_DEVICE_PREFERENCE_STORE);

		const [members, pref] = await Promise.all([
			requestToPromise(memberStore.index('userId').getAll(userId)) as Promise<WorkspaceMemberRow[]>,
			requestToPromise(prefStore.get([userId, deviceId])) as Promise<UserDevicePreferenceRow | undefined>,
		]);

		const workspaceRows = await Promise.all(
			members.map((member) => requestToPromise(workspaceStore.get(member.workspaceId)) as Promise<WorkspaceRow | undefined>)
		);
		await transactionToPromise(tx);

		const baseSnapshot: CachedWorkspaceSnapshot = {
			activeWorkspaceId: pref?.activeWorkspaceId ?? null,
			activeSharedFolder: pref?.activeSharedFolder ?? null,
			preferenceUpdatedAt: pref?.updatedAt ?? null,
			workspaces: members
				.map((member, index) => {
					const workspace = workspaceRows[index];
					if (!workspace || !workspace.id) return null;
					return {
						id: workspace.id,
						name: workspace.name,
						role: asWorkspaceRole(member.role),
						ownerUserId: workspace.ownerUserId ?? null,
						systemKind: workspace.systemKind ?? null,
						createdAt: asIsoString(workspace.createdAt),
						updatedAt: asIsoString(workspace.updatedAt, asIsoString(workspace.createdAt)),
						pendingSync: false,
						pendingSyncKind: null,
					};
				})
				.filter((workspace): workspace is CachedWorkspaceListItem => Boolean(workspace))
				.sort((left, right) => left.id.localeCompare(right.id)),
		};

		const mutationRows = await safeReadWorkspaceMutationRows(userId, deviceId);
		return applyWorkspaceMutations(baseSnapshot, mutationRows);
	} catch {
		return { activeWorkspaceId: null, activeSharedFolder: null, preferenceUpdatedAt: null, workspaces: [] };
	}
}

export async function cacheWorkspaceSnapshot(args: {
	userId: string;
	deviceId: string;
	activeWorkspaceId: string | null;
	activeSharedFolder?: string | null;
	workspaces: readonly CachedWorkspaceListItem[];
}): Promise<void> {
	if (!args.userId || !args.deviceId) return;
	try {
		const db = await openWorkspaceMetadataDb();
		const tx = db.transaction([WORKSPACE_STORE, WORKSPACE_MEMBER_STORE, USER_DEVICE_PREFERENCE_STORE], 'readwrite');
		const workspaceStore = tx.objectStore(WORKSPACE_STORE);
		const memberStore = tx.objectStore(WORKSPACE_MEMBER_STORE);
		const prefStore = tx.objectStore(USER_DEVICE_PREFERENCE_STORE);
		const now = getNowIso();

		// Replace membership rows for this user from the fresh server snapshot.
		// We clear and reinsert instead of diffing because the server response is the
		// authoritative list and this keeps the local schema simple.
		await deleteIndexMatches(memberStore.index('userId'), args.userId);

		for (const workspace of args.workspaces) {
			const workspaceRow: WorkspaceRow = {
				id: workspace.id,
				name: workspace.name,
				ownerUserId: workspace.ownerUserId ?? null,
				systemKind: typeof workspace.systemKind === 'string' ? workspace.systemKind : null,
				createdAt: asIsoString(workspace.createdAt, now),
				updatedAt: asIsoString(workspace.updatedAt, asIsoString(workspace.createdAt, now)),
			};
			workspaceStore.put(workspaceRow, workspaceRow.id);
			const memberRow: WorkspaceMemberRow = {
				userId: args.userId,
				workspaceId: workspace.id,
				role: asWorkspaceRole(workspace.role),
			};
			memberStore.put(memberRow, [args.userId, workspace.id]);
		}

		const existingPref = await requestToPromise(prefStore.get([args.userId, args.deviceId])) as UserDevicePreferenceRow | undefined;
		const prefRow: UserDevicePreferenceRow = {
			userId: args.userId,
			deviceId: args.deviceId,
			activeWorkspaceId: args.activeWorkspaceId,
			activeSharedFolder:
				typeof args.activeSharedFolder === 'undefined'
					? existingPref?.activeSharedFolder ?? null
					: args.activeSharedFolder ?? null,
			createdAt: existingPref?.createdAt ? asIsoString(existingPref.createdAt, now) : now,
			updatedAt: now,
		};
		prefStore.put(prefRow, [args.userId, args.deviceId]);
		await transactionToPromise(tx);
	} catch {
		// Local metadata caching should not block app startup or workspace switching.
	}
}

export async function cacheWorkspaceDetails(args: {
	workspace: {
		id: string;
		name: string;
		ownerUserId?: string | null;
		systemKind?: string | null;
		createdAt?: string | null;
		updatedAt?: string | null;
	};
	userId?: string | null;
	role?: WorkspaceRole | null;
}): Promise<void> {
	if (!args.workspace.id) return;
	try {
		const db = await openWorkspaceMetadataDb();
		const stores = args.userId && args.role
			? [WORKSPACE_STORE, WORKSPACE_MEMBER_STORE]
			: [WORKSPACE_STORE];
		const tx = db.transaction(stores, 'readwrite');
		const workspaceStore = tx.objectStore(WORKSPACE_STORE);
		const now = getNowIso();
		const existingWorkspace = await requestToPromise(workspaceStore.get(args.workspace.id)) as WorkspaceRow | undefined;
		const workspaceRow: WorkspaceRow = {
			id: args.workspace.id,
			name: args.workspace.name,
			ownerUserId: args.workspace.ownerUserId ?? existingWorkspace?.ownerUserId ?? null,
			systemKind: args.workspace.systemKind ?? existingWorkspace?.systemKind ?? null,
			createdAt: asIsoString(args.workspace.createdAt ?? existingWorkspace?.createdAt ?? now, now),
			updatedAt: asIsoString(args.workspace.updatedAt ?? existingWorkspace?.updatedAt ?? now, now),
		};
		workspaceStore.put(workspaceRow, workspaceRow.id);
		if (args.userId && args.role) {
			const memberStore = tx.objectStore(WORKSPACE_MEMBER_STORE);
			const memberRow: WorkspaceMemberRow = {
				userId: args.userId,
				workspaceId: args.workspace.id,
				role: asWorkspaceRole(args.role),
			};
			memberStore.put(memberRow, [args.userId, args.workspace.id]);
		}
		await transactionToPromise(tx);
	} catch {
		// Ignore local cache failures and keep the live UI responsive.
	}
}

export async function cacheActiveWorkspaceSelection(args: {
	userId: string;
	deviceId: string;
	activeWorkspaceId: string | null;
	activeSharedFolder?: string | null;
	createdAt?: string | null;
	updatedAt?: string | null;
}): Promise<void> {
	if (!args.userId || !args.deviceId) return;
	try {
		const db = await openWorkspaceMetadataDb();
		const tx = db.transaction([USER_DEVICE_PREFERENCE_STORE], 'readwrite');
		const prefStore = tx.objectStore(USER_DEVICE_PREFERENCE_STORE);
		const now = getNowIso();
		const existingPref = await requestToPromise(prefStore.get([args.userId, args.deviceId])) as UserDevicePreferenceRow | undefined;
		const prefRow: UserDevicePreferenceRow = {
			userId: args.userId,
			deviceId: args.deviceId,
			activeWorkspaceId: args.activeWorkspaceId,
			activeSharedFolder:
				typeof args.activeSharedFolder === 'undefined'
					? existingPref?.activeSharedFolder ?? null
					: args.activeSharedFolder ?? null,
			createdAt: asIsoString(args.createdAt ?? existingPref?.createdAt ?? now, now),
			updatedAt: asIsoString(args.updatedAt ?? now, now),
		};
		prefStore.put(prefRow, [args.userId, args.deviceId]);
		await transactionToPromise(tx);
	} catch {
		// Ignore local cache failures and let the server remain the fallback.
	}
}

export async function queueOfflineWorkspaceCreate(args: {
	userId: string;
	deviceId: string;
	workspace: {
		id: string;
		name: string;
		ownerUserId?: string | null;
		createdAt?: string | null;
		updatedAt?: string | null;
	};
	role?: WorkspaceRole;
}): Promise<void> {
	if (!args.userId || !args.deviceId || !args.workspace.id) return;
	try {
		// Cache the optimistic workspace immediately so the modal/sidebar can render it
		// before the queued mutation is replayed to the server.
		await cacheWorkspaceDetails({
			workspace: args.workspace,
			userId: args.userId,
			role: args.role ?? 'OWNER',
		});
		const db = await openWorkspaceMetadataDb();
		const tx = db.transaction([WORKSPACE_MUTATION_STORE], 'readwrite');
		const store = tx.objectStore(WORKSPACE_MUTATION_STORE);
		const now = getNowIso();
		const existingRows = await requestToPromise(store.index('workspaceId').getAll(args.workspace.id)) as WorkspaceMutationRow[];
		// One queued mutation per workspace/device pair keeps replay order predictable.
		for (const row of existingRows) {
			if (row.userId === args.userId && row.deviceId === args.deviceId) {
				store.delete(row.id);
			}
		}
		store.put({
			id: `create:${args.workspace.id}`,
			userId: args.userId,
			deviceId: args.deviceId,
			workspaceId: args.workspace.id,
			kind: 'create',
			workspaceName: args.workspace.name,
			ownerUserId: args.workspace.ownerUserId ?? args.userId,
			role: asWorkspaceRole(args.role ?? 'OWNER'),
			createdAt: asIsoString(args.workspace.createdAt ?? now, now),
			updatedAt: asIsoString(args.workspace.updatedAt ?? now, now),
			deletedAt: null,
		});
		await transactionToPromise(tx);
	} catch {
		// Ignore local queue failures and let the UI continue best-effort.
	}
}

export async function queueOfflineWorkspaceDelete(args: {
	userId: string;
	deviceId: string;
	workspaceId: string;
	workspaceName?: string | null;
	ownerUserId?: string | null;
	role?: WorkspaceRole;
	deletedAt?: string | null;
}): Promise<void> {
	if (!args.userId || !args.deviceId || !args.workspaceId) return;
	try {
		const db = await openWorkspaceMetadataDb();
		const tx = db.transaction([WORKSPACE_MUTATION_STORE], 'readwrite');
		const store = tx.objectStore(WORKSPACE_MUTATION_STORE);
		const existingRows = await requestToPromise(store.index('workspaceId').getAll(args.workspaceId)) as WorkspaceMutationRow[];
		// Deletion supersedes any older queued mutation for the same workspace/device.
		for (const row of existingRows) {
			if (row.userId === args.userId && row.deviceId === args.deviceId) {
				store.delete(row.id);
			}
		}
		const now = getNowIso();
		store.put({
			id: `delete:${args.workspaceId}`,
			userId: args.userId,
			deviceId: args.deviceId,
			workspaceId: args.workspaceId,
			kind: 'delete',
			workspaceName: args.workspaceName ?? null,
			ownerUserId: args.ownerUserId ?? args.userId,
			role: asWorkspaceRole(args.role ?? 'OWNER'),
			createdAt: now,
			updatedAt: now,
			deletedAt: asIsoString(args.deletedAt ?? now, now),
		});
		await transactionToPromise(tx);
	} catch {
		// Ignore local queue failures and let the UI continue best-effort.
	}
}

export async function removePendingWorkspaceMutation(args: {
	userId: string;
	deviceId: string;
	workspaceId: string;
	kind?: WorkspaceMutationKind;
}): Promise<void> {
	if (!args.userId || !args.deviceId || !args.workspaceId) return;
	try {
		const db = await openWorkspaceMetadataDb();
		const tx = db.transaction([WORKSPACE_MUTATION_STORE], 'readwrite');
		const store = tx.objectStore(WORKSPACE_MUTATION_STORE);
		const rows = await requestToPromise(store.index('workspaceId').getAll(args.workspaceId)) as WorkspaceMutationRow[];
		for (const row of rows) {
			if (row.userId !== args.userId || row.deviceId !== args.deviceId) continue;
			if (args.kind && row.kind !== args.kind) continue;
			store.delete(row.id);
		}
		await transactionToPromise(tx);
	} catch {
		// Ignore local queue cleanup failures.
	}
}

export async function removeCachedWorkspace(args: {
	workspaceId: string;
	userId?: string | null;
	deviceId?: string | null;
}): Promise<void> {
	if (!args.workspaceId) return;
	try {
		const db = await openWorkspaceMetadataDb();
		const tx = db.transaction([WORKSPACE_STORE, WORKSPACE_MEMBER_STORE, USER_DEVICE_PREFERENCE_STORE], 'readwrite');
		const workspaceStore = tx.objectStore(WORKSPACE_STORE);
		const memberStore = tx.objectStore(WORKSPACE_MEMBER_STORE);
		const prefStore = tx.objectStore(USER_DEVICE_PREFERENCE_STORE);

		await deleteIndexMatches(memberStore.index('workspaceId'), args.workspaceId);
		workspaceStore.delete(args.workspaceId);

		if (args.userId && args.deviceId) {
			const prefKey: [string, string] = [args.userId, args.deviceId];
			const existingPref = await requestToPromise(prefStore.get(prefKey)) as UserDevicePreferenceRow | undefined;
			if (existingPref && existingPref.activeWorkspaceId === args.workspaceId) {
				prefStore.put(
					{
						...existingPref,
						activeWorkspaceId: null,
						updatedAt: getNowIso(),
					},
					prefKey,
				);
			}
		}

		await transactionToPromise(tx);
	} catch {
		// Local metadata cleanup should never block UI updates.
	}
}