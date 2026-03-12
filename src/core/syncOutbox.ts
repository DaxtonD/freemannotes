import { normalizeWorkspaceInviteRole, readCachedWorkspaceInviteLink, sendWorkspaceInviteEmail, type WorkspaceInviteLink, type WorkspaceInviteRole } from './shareLinks';

export type SyncOperationType = 'create' | 'update' | 'delete' | 'invite';
export type SyncEntityType = 'workspace' | 'note' | 'collaborator' | 'workspace_invite';
export type SyncStatus = 'pending' | 'syncing' | 'failed' | 'completed';

type SyncOutboxPayload = {
	workspaceId?: string;
	identifier?: string;
	email?: string;
	role?: WorkspaceInviteRole;
	localInviteId?: string;
	userId?: string;
	inviteId?: string;
	expectedRole?: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
};

type SyncOutboxRow = {
	id: string;
	userId: string;
	operationType: SyncOperationType;
	entityType: SyncEntityType;
	entityId: string;
	payload: SyncOutboxPayload;
	createdAt: string;
	updatedAt: string;
	retryCount: number;
	syncStatus: SyncStatus;
	nextRetryAt: string | null;
	lastError: string | null;
};

type WorkspaceInviteCacheRow = {
	id: string;
	workspaceId: string;
	source: 'server' | 'local';
	kind: 'member' | 'invite';
	email: string;
	name: string | null;
	profileImage?: string | null;
	role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
	userId: string | null;
	inviteId: string | null;
	inviteUrl: string | null;
	expiresAt: string | null;
	syncStatus: SyncStatus | null;
	error: string | null;
	createdAt: string;
	updatedAt: string;
};

export type WorkspaceInviteMember = {
	id: string;
	userId: string | null;
	email: string;
	name: string | null;
	profileImage?: string | null;
	role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
	status: 'member';
};

export type WorkspaceInviteItem = {
	id: string;
	email: string;
	name: string | null;
	role: WorkspaceInviteRole;
	inviteUrl: string | null;
	expiresAt: string | null;
	status: 'pending' | 'failed';
	detail: 'server' | 'waiting' | 'syncing' | 'failed';
	error: string | null;
	isLocalOnly: boolean;
};

export type WorkspaceInviteState = {
	members: WorkspaceInviteMember[];
	invites: WorkspaceInviteItem[];
};

type WorkspaceInviteServerMember = {
	id: string;
	userId: string | null;
	email: string;
	name: string | null;
	profileImage?: string | null;
	role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
};

type WorkspaceInviteServerItem = {
	id: string;
	email: string;
	role: WorkspaceInviteRole;
	expiresAt: string;
	inviteUrl: string;
	name?: string | null;
};

type WorkspaceInviteServerResponse = {
	members: WorkspaceInviteServerMember[];
	invites: WorkspaceInviteServerItem[];
};

const DB_NAME = 'freemannotes.sync-outbox.v1';
const DB_VERSION = 1;
const SYNC_OUTBOX_STORE = 'sync_outbox';
const WORKSPACE_INVITE_STATE_STORE = 'workspace_invite_state';
const WORKSPACE_INVITE_STATE_EVENT = 'freemannotes:workspace-invite-state-changed';
const WORKSPACE_INVITE_CONFLICT_EVENT = 'freemannotes:workspace-invite-conflict';
const MAX_RETRIES = 5;
const BASE_RETRY_MS = 5_000;

let dbPromise: Promise<IDBDatabase> | null = null;
const pendingFlushes = new Map<string, Promise<void>>();
const flushTimers = new Map<string, number>();

function getNowIso(): string {
	return new Date().toISOString();
}

function asIsoString(value: unknown, fallback = getNowIso()): string {
	if (typeof value !== 'string') return fallback;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeWorkspaceId(value: unknown): string {
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeEmail(value: unknown): string {
	return String(value ?? '').trim().toLowerCase();
}

function normalizeIdentifier(value: unknown): string {
	return String(value ?? '').trim();
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

async function openDb(): Promise<IDBDatabase> {
	if (typeof indexedDB === 'undefined') {
		throw new Error('IndexedDB is unavailable');
	}
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(SYNC_OUTBOX_STORE)) {
					const store = db.createObjectStore(SYNC_OUTBOX_STORE, { keyPath: 'id' });
					store.createIndex('userId', 'userId', { unique: false });
					store.createIndex('userId_syncStatus', ['userId', 'syncStatus'], { unique: false });
				}
				if (!db.objectStoreNames.contains(WORKSPACE_INVITE_STATE_STORE)) {
					const store = db.createObjectStore(WORKSPACE_INVITE_STATE_STORE, { keyPath: 'id' });
					store.createIndex('workspaceId', 'workspaceId', { unique: false });
					store.createIndex('workspaceId_source', ['workspaceId', 'source'], { unique: false });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
		});
	}
	return dbPromise;
}

function isOffline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function emitWorkspaceInviteStateChanged(workspaceId: string): void {
	if (!workspaceId || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
	window.dispatchEvent(new CustomEvent(WORKSPACE_INVITE_STATE_EVENT, { detail: { workspaceId } }));
}

export function getWorkspaceInviteStateEventName(): string {
	return WORKSPACE_INVITE_STATE_EVENT;
}

function emitWorkspaceInviteConflict(workspaceId: string, message: string): void {
	if (!workspaceId || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
	window.dispatchEvent(new CustomEvent(WORKSPACE_INVITE_CONFLICT_EVENT, { detail: { workspaceId, message } }));
}

export function getWorkspaceInviteConflictEventName(): string {
	return WORKSPACE_INVITE_CONFLICT_EVENT;
}

function createId(prefix: string): string {
	return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
	const response = await fetch(input, {
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...(init.headers || {}),
		},
		...init,
	});
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		const message = body && typeof body.error === 'string' ? body.error : `Request failed (${response.status})`;
		const error = new Error(message) as Error & { status?: number };
		error.status = response.status;
		throw error;
	}
	return body as T;
}

function computeBackoffMs(retryCount: number): number {
	return Math.min(BASE_RETRY_MS * Math.max(1, 2 ** Math.max(0, retryCount - 1)), 5 * 60_000);
}

function toInviteCacheId(workspaceId: string, email: string): string {
	return `invite::${workspaceId}::${email}`;
}

function toMemberCacheId(workspaceId: string, userId: string | null, email: string): string {
	return `member::${workspaceId}::${userId || email}`;
}

async function readWorkspaceInviteRows(workspaceId: string): Promise<WorkspaceInviteCacheRow[]> {
	if (!workspaceId) return [];
	try {
		const db = await openDb();
		const tx = db.transaction([WORKSPACE_INVITE_STATE_STORE], 'readonly');
		const rows = await requestToPromise(tx.objectStore(WORKSPACE_INVITE_STATE_STORE).index('workspaceId').getAll(workspaceId)) as WorkspaceInviteCacheRow[];
		await transactionToPromise(tx);
		return Array.isArray(rows) ? rows : [];
	} catch {
		return [];
	}
	}

function mergeWorkspaceInviteRows(rows: readonly WorkspaceInviteCacheRow[]): WorkspaceInviteState {
	const membersByEmail = new Map<string, WorkspaceInviteMember>();
	const invitesByEmail = new Map<string, WorkspaceInviteCacheRow>();

	for (const row of rows) {
		const email = normalizeEmail(row.email);
		if (!email) continue;
		if (row.kind === 'member') {
			const previous = membersByEmail.get(email);
			if (previous && row.source !== 'local') {
				continue;
			}
			membersByEmail.set(email, {
				id: row.id,
				userId: row.userId,
				email,
				name: row.name,
				profileImage: row.profileImage ?? null,
				role: row.role,
				status: 'member',
			});
			continue;
		}
		const previous = invitesByEmail.get(email);
		if (!previous) {
			invitesByEmail.set(email, row);
			continue;
		}
		if (row.source === 'local' && previous.source !== 'local') {
			invitesByEmail.set(email, row);
			continue;
		}
		if (row.source === previous.source && Date.parse(row.updatedAt || '') >= Date.parse(previous.updatedAt || '')) {
			invitesByEmail.set(email, row);
		}
	}

	const members = Array.from(membersByEmail.values()).sort((left, right) => left.email.localeCompare(right.email));
	const invites = Array.from(invitesByEmail.entries())
		.filter(([email]) => !membersByEmail.has(email))
		.map(([, row]) => ({
			id: row.inviteId || row.id,
			email: normalizeEmail(row.email),
			name: row.name,
			role: row.role === 'ADMIN' ? 'ADMIN' : row.role === 'EDITOR' ? 'EDITOR' : 'VIEWER',
			inviteUrl: row.inviteUrl,
			expiresAt: row.expiresAt,
			status: row.syncStatus === 'failed' ? 'failed' : 'pending',
			detail:
				row.syncStatus === 'failed'
					? 'failed'
					: row.syncStatus === 'syncing'
						? 'syncing'
						: row.source === 'local'
							? 'waiting'
							: 'server',
			error: row.error,
			isLocalOnly: row.source === 'local',
		}))
		.sort((left, right) => left.email.localeCompare(right.email));

	return { members, invites };
}

async function replaceServerWorkspaceInviteSnapshot(workspaceId: string, state: WorkspaceInviteServerResponse): Promise<void> {
	if (!workspaceId) return;
	try {
		const db = await openDb();
		const tx = db.transaction([WORKSPACE_INVITE_STATE_STORE], 'readwrite');
		const store = tx.objectStore(WORKSPACE_INVITE_STATE_STORE);
		await deleteIndexMatches(store.index('workspaceId_source'), IDBKeyRange.bound([workspaceId, 'server'], [workspaceId, 'server']));
		for (const member of state.members || []) {
			const email = normalizeEmail(member.email);
			if (!email) continue;
			const row: WorkspaceInviteCacheRow = {
				id: toMemberCacheId(workspaceId, member.userId ?? null, email),
				workspaceId,
				source: 'server',
				kind: 'member',
				email,
				name: member.name ?? null,
				profileImage: member.profileImage ?? null,
				role: member.role,
				userId: member.userId ?? null,
				inviteId: null,
				inviteUrl: null,
				expiresAt: null,
				syncStatus: null,
				error: null,
				createdAt: getNowIso(),
				updatedAt: getNowIso(),
			};
			store.put(row);
		}
		for (const invite of state.invites || []) {
			const email = normalizeEmail(invite.email);
			if (!email) continue;
			const row: WorkspaceInviteCacheRow = {
				id: invite.id,
				workspaceId,
				source: 'server',
				kind: 'invite',
				email,
				name: invite.name ?? null,
				role: normalizeWorkspaceInviteRole(invite.role),
				userId: null,
				inviteId: invite.id,
				inviteUrl: invite.inviteUrl,
				expiresAt: invite.expiresAt,
				syncStatus: null,
				error: null,
				createdAt: getNowIso(),
				updatedAt: getNowIso(),
			};
			store.put(row);
		}
		await transactionToPromise(tx);
		emitWorkspaceInviteStateChanged(workspaceId);
	} catch {
		// Best-effort cache only.
	}
}

async function upsertLocalWorkspaceInvite(row: WorkspaceInviteCacheRow): Promise<void> {
	try {
		const db = await openDb();
		const tx = db.transaction([WORKSPACE_INVITE_STATE_STORE], 'readwrite');
		tx.objectStore(WORKSPACE_INVITE_STATE_STORE).put(row);
		await transactionToPromise(tx);
		emitWorkspaceInviteStateChanged(row.workspaceId);
	} catch {
		// Best-effort cache only.
	}
	}

async function deleteWorkspaceInviteCacheRow(rowId: string, workspaceId: string): Promise<void> {
	if (!rowId) return;
	try {
		const db = await openDb();
		const tx = db.transaction([WORKSPACE_INVITE_STATE_STORE], 'readwrite');
		tx.objectStore(WORKSPACE_INVITE_STATE_STORE).delete(rowId);
		await transactionToPromise(tx);
		emitWorkspaceInviteStateChanged(workspaceId);
	} catch {
		// Best-effort cache only.
	}
	}

async function deleteSyncOutboxEntriesMatching(predicate: (row: SyncOutboxRow) => boolean): Promise<void> {
	try {
		const db = await openDb();
		const tx = db.transaction([SYNC_OUTBOX_STORE], 'readwrite');
		const store = tx.objectStore(SYNC_OUTBOX_STORE);
		await new Promise<void>((resolve, reject) => {
			const request = store.openCursor();
			request.onsuccess = () => {
				const cursor = request.result;
				if (!cursor) {
					resolve();
					return;
				}
				const row = cursor.value as SyncOutboxRow;
				if (predicate(row)) cursor.delete();
				cursor.continue();
			};
			request.onerror = () => reject(request.error || new Error('IndexedDB cursor failed'));
		});
		await transactionToPromise(tx);
	} catch {
		// Best-effort queue persistence only.
	}
}

async function loadRemoteWorkspaceInviteState(workspaceId: string): Promise<WorkspaceInviteServerResponse> {
	return fetchJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/invites`);
}

async function optimisticUpdateWorkspaceMemberRole(args: { workspaceId: string; userId: string; role: WorkspaceInviteRole }): Promise<void> {
	const rows = await readWorkspaceInviteRows(args.workspaceId);
	const row = rows.find((candidate) => candidate.kind === 'member' && candidate.userId === args.userId);
	if (!row) return;
	await upsertLocalWorkspaceInvite({
		...row,
		source: 'local',
		role: args.role,
		syncStatus: 'pending',
		error: null,
		updatedAt: getNowIso(),
	});
}

async function optimisticRemoveWorkspaceMember(args: { workspaceId: string; userId: string }): Promise<void> {
	const rows = await readWorkspaceInviteRows(args.workspaceId);
	const row = rows.find((candidate) => candidate.kind === 'member' && candidate.userId === args.userId);
	if (!row) return;
	await deleteWorkspaceInviteCacheRow(row.id, args.workspaceId);
}

async function optimisticCancelServerInvite(args: { workspaceId: string; inviteId: string }): Promise<void> {
	await deleteWorkspaceInviteCacheRow(args.inviteId, args.workspaceId);
}

export async function cancelWorkspaceInviteItem(args: { workspaceId: string; inviteId: string; email: string; isLocalOnly: boolean; actorUserId?: string | null; expectedRole?: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' }): Promise<void> {

	const workspaceId = normalizeWorkspaceId(args.workspaceId);
	const inviteId = String(args.inviteId || '').trim();
	const email = normalizeEmail(args.email);
	if (!workspaceId || !inviteId || !email) throw new Error('Missing invite data');

	if (args.isLocalOnly) {
		await deleteWorkspaceInviteCacheRow(toInviteCacheId(workspaceId, email), workspaceId);
		await deleteSyncOutboxEntriesMatching((row) => {
			const payload = row.payload || {};
			return row.entityType === 'workspace_invite'
				&& normalizeWorkspaceId(payload.workspaceId || row.entityId) === workspaceId
				&& normalizeIdentifier(payload.identifier || payload.email) === normalizeIdentifier(email);
		});
		return;
	}
	const send = async (): Promise<void> => {
		await fetchJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/invites/${encodeURIComponent(inviteId)}/cancel`, {
			method: 'POST',
			// Stale-role checks are for queued offline replay. Live UI actions should act
			// on the latest server state instead of failing on cached role metadata.
			body: JSON.stringify({}),
		});
		const remote = await loadRemoteWorkspaceInviteState(workspaceId);
		await replaceServerWorkspaceInviteSnapshot(workspaceId, remote);
	};
	if (!isOffline()) {
		try {
			await send();
			return;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Request failed';
			if (!args.actorUserId || !/failed to fetch|networkerror|load failed/i.test(message)) {
				throw error;
			}
		}
	}
	if (!args.actorUserId) throw new Error('Workspace invite management requires an authenticated user');
	await optimisticCancelServerInvite({ workspaceId, inviteId });
	await enqueueSyncOutboxEntry({
		id: createId('sync-outbox'),
		userId: args.actorUserId,
		operationType: 'delete',
		entityType: 'workspace_invite',
		entityId: inviteId,
		payload: { workspaceId, inviteId, identifier: email, email, expectedRole: args.expectedRole },
		createdAt: getNowIso(),
		updatedAt: getNowIso(),
		retryCount: 0,
		syncStatus: 'pending',
		nextRetryAt: null,
		lastError: null,
	});
}

export async function updateWorkspaceMemberAccess(args: { workspaceId: string; userId: string; role: WorkspaceInviteRole; actorUserId?: string | null; expectedRole?: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' }): Promise<void> {
	const workspaceId = normalizeWorkspaceId(args.workspaceId);
	const userId = String(args.userId || '').trim();
	if (!workspaceId || !userId) throw new Error('Missing member data');
	const send = async (): Promise<void> => {
		await fetchJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`, {
			method: 'PATCH',
			// Stale-role checks are preserved for offline replay. Online edits should use
			// the current server row even if the local modal cached an older role.
			body: JSON.stringify({ role: args.role }),
		});
		const remote = await loadRemoteWorkspaceInviteState(workspaceId);
		await replaceServerWorkspaceInviteSnapshot(workspaceId, remote);
	};
	if (!isOffline()) {
		try {
			await send();
			return;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Request failed';
			if (!args.actorUserId || !/failed to fetch|networkerror|load failed/i.test(message)) {
				throw error;
			}
		}
	}
	if (!args.actorUserId) throw new Error('Workspace member management requires an authenticated user');
	await optimisticUpdateWorkspaceMemberRole({ workspaceId, userId, role: args.role });
	await enqueueSyncOutboxEntry({
		id: createId('sync-outbox'),
		userId: args.actorUserId,
		operationType: 'update',
		entityType: 'workspace',
		entityId: userId,
		payload: { workspaceId, userId, role: args.role, expectedRole: args.expectedRole },
		createdAt: getNowIso(),
		updatedAt: getNowIso(),
		retryCount: 0,
		syncStatus: 'pending',
		nextRetryAt: null,
		lastError: null,
	});
}

export async function removeWorkspaceMemberAccess(args: { workspaceId: string; userId: string; actorUserId?: string | null; expectedRole?: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' }): Promise<void> {
	const workspaceId = normalizeWorkspaceId(args.workspaceId);
	const userId = String(args.userId || '').trim();
	if (!workspaceId || !userId) throw new Error('Missing member data');
	const send = async (): Promise<void> => {
		await fetchJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`, {
			method: 'DELETE',
			// Stale-role checks are preserved for offline replay. Online removals should
			// delete the current membership row instead of rejecting due to cached role drift.
			body: JSON.stringify({}),
		});
		const remote = await loadRemoteWorkspaceInviteState(workspaceId);
		await replaceServerWorkspaceInviteSnapshot(workspaceId, remote);
	};
	if (!isOffline()) {
		try {
			await send();
			return;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Request failed';
			if (!args.actorUserId || !/failed to fetch|networkerror|load failed/i.test(message)) {
				throw error;
			}
		}
	}
	if (!args.actorUserId) throw new Error('Workspace member management requires an authenticated user');
	await optimisticRemoveWorkspaceMember({ workspaceId, userId });
	await enqueueSyncOutboxEntry({
		id: createId('sync-outbox'),
		userId: args.actorUserId,
		operationType: 'delete',
		entityType: 'workspace',
		entityId: userId,
		payload: { workspaceId, userId, expectedRole: args.expectedRole },
		createdAt: getNowIso(),
		updatedAt: getNowIso(),
		retryCount: 0,
		syncStatus: 'pending',
		nextRetryAt: null,
		lastError: null,
	});
}

export async function listWorkspaceInviteState(workspaceId: string, opts?: { preferCache?: boolean }): Promise<WorkspaceInviteState> {
	const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
	if (!normalizedWorkspaceId) {
		return { members: [], invites: [] };
	}
	if (!opts?.preferCache && !isOffline()) {
		try {
			const remote = await loadRemoteWorkspaceInviteState(normalizedWorkspaceId);
			await replaceServerWorkspaceInviteSnapshot(normalizedWorkspaceId, remote);
		} catch {
			// Fall back to the last cached snapshot when the remote read fails.
		}
	}
	const rows = await readWorkspaceInviteRows(normalizedWorkspaceId);
	return mergeWorkspaceInviteRows(rows);
}

export async function readCachedWorkspaceInviteState(workspaceId: string): Promise<WorkspaceInviteState> {
	return listWorkspaceInviteState(workspaceId, { preferCache: true });
}

export async function hasWorkspaceInviteDuplicate(workspaceId: string, identifier: string): Promise<'member' | 'invite' | null> {
	const normalizedIdentifier = normalizeIdentifier(identifier);
	const normalizedEmail = normalizeEmail(identifier);
	if (!normalizedIdentifier) return null;
	const state = await listWorkspaceInviteState(workspaceId, { preferCache: isOffline() });
	// Identifier-based invites must dedupe against both the resolved email and the
	// visible username so offline behavior matches the server-side lookup.
	if (state.members.some((member) => member.email === normalizedEmail || String(member.name || '').trim().toLowerCase() === normalizedIdentifier.toLowerCase())) return 'member';
	if (state.invites.some((invite) => invite.email === normalizedEmail || String(invite.name || '').trim().toLowerCase() === normalizedIdentifier.toLowerCase())) return 'invite';
	return null;
}

export async function queueWorkspaceInviteEmail(args: {
	userId: string;
	workspaceId: string;
	identifier: string;
	role: WorkspaceInviteRole;
}): Promise<{ inviteId: string; inviteLink: WorkspaceInviteLink | null }> {
	const workspaceId = normalizeWorkspaceId(args.workspaceId);
	const identifier = normalizeIdentifier(args.identifier);
	if (!args.userId || !workspaceId || !identifier) {
		throw new Error('Missing invite data');
	}
	const duplicate = await hasWorkspaceInviteDuplicate(workspaceId, identifier);
	if (duplicate === 'member') {
		throw new Error('This user is already a workspace member');
	}
	if (duplicate === 'invite') {
		throw new Error('This user already has a pending invite');
	}
	const localInviteId = createId('workspace-invite');
	const now = getNowIso();
	const cachedLink = readCachedWorkspaceInviteLink({ workspaceId, identifier, role: args.role });
	// Preserve the user-entered identifier locally so queued offline invites remain
	// recognizable before the server resolves the canonical email address.
	await upsertLocalWorkspaceInvite({
		id: toInviteCacheId(workspaceId, identifier.toLowerCase()),
		workspaceId,
		source: 'local',
		kind: 'invite',
		email: normalizeEmail(identifier),
		name: identifier,
		role: args.role,
		userId: null,
		inviteId: localInviteId,
		inviteUrl: cachedLink?.inviteUrl ?? null,
		expiresAt: cachedLink?.expiresAt ?? null,
		syncStatus: 'pending',
		error: null,
		createdAt: now,
		updatedAt: now,
	});
	await enqueueSyncOutboxEntry({
		id: createId('sync-outbox'),
		userId: args.userId,
		operationType: 'invite',
		entityType: 'workspace_invite',
		entityId: workspaceId,
		payload: {
			workspaceId,
			identifier,
			role: args.role,
			localInviteId,
		},
		createdAt: now,
		updatedAt: now,
		retryCount: 0,
		syncStatus: 'pending',
		nextRetryAt: null,
		lastError: null,
	});
	return { inviteId: localInviteId, inviteLink: cachedLink };
}

export async function recordWorkspaceInviteSuccess(args: {
	workspaceId: string;
	identifier?: string;
	email: string;
	role: WorkspaceInviteRole;
	inviteId: string;
	inviteUrl: string;
	expiresAt: string;
}): Promise<void> {
	const workspaceId = normalizeWorkspaceId(args.workspaceId);
	const email = normalizeEmail(args.email);
	const identifier = normalizeIdentifier(args.identifier || args.email);
	if (!workspaceId || !email || !args.inviteId) return;
	// Swap the optimistic identifier-keyed placeholder with the authoritative
	// server invite row once the create call succeeds.
	await deleteWorkspaceInviteCacheRow(toInviteCacheId(workspaceId, identifier.toLowerCase()), workspaceId);
	await upsertLocalWorkspaceInvite({
		id: args.inviteId,
		workspaceId,
		source: 'server',
		kind: 'invite',
		email,
		name: identifier && normalizeEmail(identifier) !== email ? identifier : null,
		role: args.role,
		userId: null,
		inviteId: args.inviteId,
		inviteUrl: args.inviteUrl,
		expiresAt: args.expiresAt,
		syncStatus: null,
		error: null,
		createdAt: getNowIso(),
		updatedAt: getNowIso(),
	});
	// Replace the ad-hoc server insert above with a full server snapshot so cached
	// members/invites stay consistent after any successful invite mutation.
	try {
		const remote = await loadRemoteWorkspaceInviteState(workspaceId);
		await replaceServerWorkspaceInviteSnapshot(workspaceId, remote);
	} catch {
		// Keep the optimistic server row if the refresh fails.
	}
}

async function markWorkspaceInviteLocalState(args: {
	workspaceId: string;
	email: string;
	syncStatus: SyncStatus;
	error: string | null;
	inviteLink?: WorkspaceInviteLink | null;
}): Promise<void> {
	const workspaceId = normalizeWorkspaceId(args.workspaceId);
	const email = normalizeEmail(args.email);
	if (!workspaceId || !email) return;
	const rows = await readWorkspaceInviteRows(workspaceId);
	const row = rows.find((candidate) => candidate.id === toInviteCacheId(workspaceId, email));
	if (!row) return;
	await upsertLocalWorkspaceInvite({
		...row,
		syncStatus: args.syncStatus,
		error: args.error,
		inviteUrl: args.inviteLink?.inviteUrl ?? row.inviteUrl,
		expiresAt: args.inviteLink?.expiresAt ?? row.expiresAt,
		updatedAt: getNowIso(),
	});
}

async function enqueueSyncOutboxEntry(entry: SyncOutboxRow): Promise<void> {
	try {
		const db = await openDb();
		const tx = db.transaction([SYNC_OUTBOX_STORE], 'readwrite');
		tx.objectStore(SYNC_OUTBOX_STORE).put(entry);
		await transactionToPromise(tx);
	} catch {
		// Best-effort queue persistence only.
	}
	}

async function readSyncOutboxEntries(userId: string): Promise<SyncOutboxRow[]> {
	if (!userId) return [];
	try {
		const db = await openDb();
		const tx = db.transaction([SYNC_OUTBOX_STORE], 'readonly');
		const rows = await requestToPromise(tx.objectStore(SYNC_OUTBOX_STORE).index('userId').getAll(userId)) as SyncOutboxRow[];
		await transactionToPromise(tx);
		return Array.isArray(rows)
			? rows.sort((left, right) => Date.parse(left.createdAt || '') - Date.parse(right.createdAt || ''))
			: [];
	} catch {
		return [];
	}
	}

async function updateSyncOutboxEntry(id: string, updater: (current: SyncOutboxRow) => SyncOutboxRow | null): Promise<void> {
	if (!id) return;
	try {
		const db = await openDb();
		const tx = db.transaction([SYNC_OUTBOX_STORE], 'readwrite');
		const store = tx.objectStore(SYNC_OUTBOX_STORE);
		const current = await requestToPromise(store.get(id)) as SyncOutboxRow | undefined;
		if (!current) {
			await transactionToPromise(tx);
			return;
		}
		const next = updater(current);
		if (!next) {
			store.delete(id);
		} else {
			store.put(next);
		}
		await transactionToPromise(tx);
	} catch {
		// Best-effort queue persistence only.
	}
	}

function clearScheduledFlush(userId: string): void {
	const timer = flushTimers.get(userId);
	if (typeof timer === 'number' && typeof window !== 'undefined') {
		window.clearTimeout(timer);
	}
	flushTimers.delete(userId);
}

async function scheduleNextFlush(userId: string): Promise<void> {
	if (!userId || typeof window === 'undefined') return;
	clearScheduledFlush(userId);
	const rows = await readSyncOutboxEntries(userId);
	const pending = rows
		.filter((row) => row.syncStatus === 'pending' || (row.syncStatus === 'failed' && row.retryCount < MAX_RETRIES))
		.sort((left, right) => Date.parse(left.createdAt || '') - Date.parse(right.createdAt || ''));
	if (pending.length === 0) return;
	const now = Date.now();
	const nextDueAt = pending.reduce<number>((best, row) => {
		const rowDue = row.nextRetryAt ? Date.parse(row.nextRetryAt) : now;
		if (!Number.isFinite(best)) return rowDue;
		return Math.min(best, rowDue);
	}, Number.NaN);
	const delay = Math.max(0, (Number.isFinite(nextDueAt) ? nextDueAt : now) - now);
	const timer = window.setTimeout(() => {
		void flushSyncOutbox(userId);
	}, delay);
	flushTimers.set(userId, timer);
}

export function cancelSyncOutboxWorker(userId: string | null | undefined): void {
	if (!userId) return;
	clearScheduledFlush(userId);
	}

export async function scheduleSyncOutboxFlush(userId: string): Promise<void> {
	if (!userId || isOffline()) return;
	await scheduleNextFlush(userId);
}

export async function flushSyncOutbox(userId: string): Promise<void> {
	if (!userId || isOffline()) return;
	const existing = pendingFlushes.get(userId);
	if (existing) {
		await existing;
		return;
	}
	const task = (async () => {
		clearScheduledFlush(userId);
		const rows = await readSyncOutboxEntries(userId);
		const now = Date.now();
		const pending = rows.filter((row) => {
			if (row.syncStatus === 'completed') return false;
			if (row.syncStatus === 'syncing') return false;
			if (row.retryCount >= MAX_RETRIES && row.syncStatus === 'failed') return false;
			const dueAt = row.nextRetryAt ? Date.parse(row.nextRetryAt) : Number.NaN;
			return !Number.isFinite(dueAt) || dueAt <= now;
		}).sort((left, right) => Date.parse(left.createdAt || '') - Date.parse(right.createdAt || ''));

		for (const row of pending) {
			await updateSyncOutboxEntry(row.id, (current) => ({
				...current,
				syncStatus: 'syncing',
				updatedAt: getNowIso(),
				lastError: null,
			}));
			const payload = row.payload || {};
			const workspaceId = normalizeWorkspaceId(payload.workspaceId || row.entityId);
			const identifier = normalizeIdentifier(payload.identifier || payload.email);
			const email = normalizeEmail(payload.email);
			const role = normalizeWorkspaceInviteRole(payload.role);
			const targetUserId = String(payload.userId || row.entityId || '').trim();
			const inviteId = String(payload.inviteId || row.entityId || '').trim();
			try {
				if (row.operationType === 'invite' && row.entityType === 'workspace_invite' && workspaceId && identifier) {
					await markWorkspaceInviteLocalState({
						workspaceId,
						email: normalizeEmail(identifier),
						syncStatus: 'syncing',
						error: null,
					});
					const link = await sendWorkspaceInviteEmail({ workspaceId, identifier, role });
					await recordWorkspaceInviteSuccess({
						workspaceId,
						identifier,
						email: link.email,
						role,
						inviteId: link.inviteId || row.payload.localInviteId || createId('workspace-invite-server'),
						inviteUrl: link.inviteUrl,
						expiresAt: link.expiresAt,
					});
					await updateSyncOutboxEntry(row.id, (current) => ({
						...current,
						syncStatus: 'completed',
						updatedAt: getNowIso(),
						lastError: null,
						nextRetryAt: null,
					}));
					continue;
				}
				if (row.operationType === 'update' && row.entityType === 'workspace' && workspaceId && targetUserId) {
					await fetchJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(targetUserId)}`, {
						method: 'PATCH',
						body: JSON.stringify({ role, expectedRole: payload.expectedRole }),
					});
					const remote = await loadRemoteWorkspaceInviteState(workspaceId);
					await replaceServerWorkspaceInviteSnapshot(workspaceId, remote);
					await updateSyncOutboxEntry(row.id, (current) => ({
						...current,
						syncStatus: 'completed',
						updatedAt: getNowIso(),
						nextRetryAt: null,
						lastError: null,
					}));
					continue;
				}
				if (row.operationType === 'delete' && row.entityType === 'workspace' && workspaceId && targetUserId) {
					await fetchJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(targetUserId)}`, {
						method: 'DELETE',
						body: JSON.stringify({ expectedRole: payload.expectedRole }),
					});
					const remote = await loadRemoteWorkspaceInviteState(workspaceId);
					await replaceServerWorkspaceInviteSnapshot(workspaceId, remote);
					await updateSyncOutboxEntry(row.id, (current) => ({
						...current,
						syncStatus: 'completed',
						updatedAt: getNowIso(),
						nextRetryAt: null,
						lastError: null,
					}));
					continue;
				}
				if (row.operationType === 'delete' && row.entityType === 'workspace_invite' && workspaceId && inviteId) {
					await fetchJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/invites/${encodeURIComponent(inviteId)}/cancel`, {
						method: 'POST',
						body: JSON.stringify({ expectedRole: payload.expectedRole }),
					});
					const remote = await loadRemoteWorkspaceInviteState(workspaceId);
					await replaceServerWorkspaceInviteSnapshot(workspaceId, remote);
					await updateSyncOutboxEntry(row.id, (current) => ({
						...current,
						syncStatus: 'completed',
						updatedAt: getNowIso(),
						nextRetryAt: null,
						lastError: null,
					}));
					continue;
				}
				await updateSyncOutboxEntry(row.id, (current) => ({
					...current,
					syncStatus: 'completed',
					updatedAt: getNowIso(),
					nextRetryAt: null,
					lastError: null,
				}));
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Sync failed';
				const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : Number.NaN;
				if (workspaceId && (status === 409 || status === 404)) {
					try {
						const remote = await loadRemoteWorkspaceInviteState(workspaceId);
						await replaceServerWorkspaceInviteSnapshot(workspaceId, remote);
						emitWorkspaceInviteConflict(workspaceId, 'Workspace membership changed before an offline action could sync');
						await updateSyncOutboxEntry(row.id, () => null);
						continue;
					} catch {
						// Fall through to failed state if the reconcile fetch also fails.
					}
				}
				const nextRetryCount = row.retryCount + 1;
				const nextRetryAt = nextRetryCount >= MAX_RETRIES ? null : new Date(Date.now() + computeBackoffMs(nextRetryCount)).toISOString();
				if (workspaceId && email) {
					await markWorkspaceInviteLocalState({
						workspaceId,
						email,
						syncStatus: 'failed',
						error: message,
					});
				}
				await updateSyncOutboxEntry(row.id, (current) => ({
					...current,
					retryCount: nextRetryCount,
					syncStatus: 'failed',
					updatedAt: getNowIso(),
					nextRetryAt,
					lastError: message,
				}));
			}
		}
		await scheduleNextFlush(userId);
	})().finally(() => {
		if (pendingFlushes.get(userId) === task) {
			pendingFlushes.delete(userId);
		}
	});
	pendingFlushes.set(userId, task);
	await task;
}