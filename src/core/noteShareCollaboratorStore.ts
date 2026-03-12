type CollaboratorRole = 'VIEWER' | 'EDITOR';

type CachedUser = {
	id: string;
	name: string;
	email: string;
	profileImage: string | null;
};

type CachedCollaborator = {
	id: string;
	userId: string;
	role: CollaboratorRole;
	accessSource?: 'direct' | 'workspace';
	revokedAt: string | null;
	createdAt: string;
	updatedAt: string;
	user: CachedUser | null;
};

type CachedInvitation = {
	id: string;
	docId: string;
	sourceWorkspaceId: string;
	sourceNoteId: string;
	role: CollaboratorRole;
	status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED';
	inviteeEmail: string;
	inviteeName: string | null;
	createdAt: string;
	updatedAt: string;
	respondedAt: string | null;
	revokedAt: string | null;
	inviter: CachedUser | null;
	noteTitle?: string;
	placement: {
		id: string;
		targetWorkspaceId: string;
		folderName: string | null;
		deletedAt: string | null;
	} | null;
};

export type CachedCollaboratorSnapshot = {
	roomId: string;
	sourceWorkspaceId: string;
	sourceNoteId: string;
	accessRole: CollaboratorRole;
	canManage: boolean;
	currentUserId: string | null;
	selfCollaboratorId: string | null;
	sharedBy: CachedUser | null;
	collaborators: CachedCollaborator[];
	pendingInvitations: CachedInvitation[];
};

export type PendingCollaboratorAction = {
	id: string;
	userId: string;
	docId: string;
	kind: 'invite' | 'revoke' | 'update-role';
	identifier: string | null;
	collaboratorId: string | null;
	collaboratorUserId: string | null;
	role: CollaboratorRole | null;
	createdAt: string;
	updatedAt: string;
};

type SnapshotRow = {
	userId: string;
	docId: string;
	roomId: string;
	sourceWorkspaceId: string;
	sourceNoteId: string;
	accessRole: CollaboratorRole;
	canManage: boolean;
	currentUserId: string | null;
	selfCollaboratorId: string | null;
	sharedBy: CachedUser | null;
	updatedAt: string;
};

type CollaboratorRow = {
	id: string;
	userId: string;
	docId: string;
	collaboratorId: string;
	collaboratorUserId: string;
	role: CollaboratorRole;
	accessSource?: 'direct' | 'workspace';
	revokedAt: string | null;
	createdAt: string;
	updatedAt: string;
	username: string;
	email: string;
	avatar: string | null;
};

type InvitationRow = {
	id: string;
	userId: string;
	docId: string;
	invitationId: string;
	sourceWorkspaceId: string;
	sourceNoteId: string;
	role: CollaboratorRole;
	status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED';
	inviteeEmail: string;
	inviteeName: string | null;
	createdAt: string;
	updatedAt: string;
	respondedAt: string | null;
	revokedAt: string | null;
	inviter: CachedUser | null;
	noteTitle: string;
	placement: CachedInvitation['placement'];
};

const DB_NAME = 'freemannotes.note-share-collaborators.v1';
const DB_VERSION = 1;
const SNAPSHOT_STORE = 'snapshot';
const COLLABORATOR_STORE = 'collaborator';
const INVITATION_STORE = 'invitation';
const ACTION_STORE = 'action_queue';

let dbPromise: Promise<IDBDatabase> | null = null;

function getNowIso(): string {
	return new Date().toISOString();
}

function asIsoString(value: unknown, fallback = getNowIso()): string {
	if (typeof value !== 'string') return fallback;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function asRole(value: unknown): CollaboratorRole {
	return value === 'VIEWER' ? 'VIEWER' : 'EDITOR';
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
				if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
					db.createObjectStore(SNAPSHOT_STORE);
				}
				if (!db.objectStoreNames.contains(COLLABORATOR_STORE)) {
					const store = db.createObjectStore(COLLABORATOR_STORE, { keyPath: 'id' });
					store.createIndex('userId_docId', ['userId', 'docId'], { unique: false });
				}
				if (!db.objectStoreNames.contains(INVITATION_STORE)) {
					const store = db.createObjectStore(INVITATION_STORE, { keyPath: 'id' });
					store.createIndex('userId_docId', ['userId', 'docId'], { unique: false });
				}
				if (!db.objectStoreNames.contains(ACTION_STORE)) {
					const store = db.createObjectStore(ACTION_STORE, { keyPath: 'id' });
					store.createIndex('userId', 'userId', { unique: false });
					store.createIndex('userId_docId', ['userId', 'docId'], { unique: false });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
		});
	}
	return dbPromise;
}

function sortActions(rows: readonly PendingCollaboratorAction[]): PendingCollaboratorAction[] {
	return [...rows].sort((left, right) => {
		const leftMs = Date.parse(left.updatedAt || left.createdAt || '');
		const rightMs = Date.parse(right.updatedAt || right.createdAt || '');
		if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
			return leftMs - rightMs;
		}
		return left.id.localeCompare(right.id);
	});
}

function createEmptySnapshot(userId: string, docId: string): CachedCollaboratorSnapshot {
	return {
		roomId: docId,
		sourceWorkspaceId: '',
		sourceNoteId: '',
		accessRole: 'EDITOR',
		canManage: false,
		currentUserId: userId,
		selfCollaboratorId: null,
		sharedBy: null,
		collaborators: [],
		pendingInvitations: [],
	};
}

function applyPendingActions(snapshot: CachedCollaboratorSnapshot, rows: readonly PendingCollaboratorAction[]): CachedCollaboratorSnapshot {
	// Rebuild the visible snapshot by layering queued offline mutations over the
	// last server-backed cache. This keeps the modal responsive offline without
	// pretending the server has already confirmed those changes.
	const next: CachedCollaboratorSnapshot = {
		...snapshot,
		collaborators: snapshot.collaborators.map((collaborator) => ({
			...collaborator,
			user: collaborator.user ? { ...collaborator.user } : null,
		})),
		pendingInvitations: snapshot.pendingInvitations.map((invitation) => ({
			...invitation,
			inviter: invitation.inviter ? { ...invitation.inviter } : null,
			placement: invitation.placement ? { ...invitation.placement } : null,
		})),
		sharedBy: snapshot.sharedBy ? { ...snapshot.sharedBy } : null,
	};

	for (const action of sortActions(rows)) {
		if (action.kind === 'invite' && action.identifier) {
			const queuedId = `queued:${action.id}`;
			next.pendingInvitations = next.pendingInvitations.filter((invitation) => invitation.id !== queuedId && invitation.inviteeEmail !== action.identifier);
			next.pendingInvitations.unshift({
				id: queuedId,
				docId: next.roomId,
				sourceWorkspaceId: next.sourceWorkspaceId,
				sourceNoteId: next.sourceNoteId,
				role: action.role || 'EDITOR',
				status: 'PENDING',
				inviteeEmail: action.identifier,
				inviteeName: action.identifier,
				createdAt: action.createdAt,
				updatedAt: action.updatedAt,
				respondedAt: null,
				revokedAt: null,
				inviter: null,
				noteTitle: '',
				placement: null,
			});
			continue;
		}

		if (action.kind === 'revoke') {
			next.collaborators = next.collaborators.filter((collaborator) => {
				if (action.collaboratorId && collaborator.id === action.collaboratorId) return false;
				if (action.collaboratorUserId && collaborator.userId === action.collaboratorUserId) return false;
				return true;
			});
			if ((action.collaboratorId && next.selfCollaboratorId === action.collaboratorId) || (action.collaboratorUserId && next.currentUserId === action.collaboratorUserId)) {
				next.selfCollaboratorId = null;
				next.sharedBy = null;
			}
			continue;
		}

		if (action.kind === 'update-role' && action.role) {
			next.collaborators = next.collaborators.map((collaborator) => {
				if (action.collaboratorId && collaborator.id === action.collaboratorId) {
					return { ...collaborator, role: action.role, updatedAt: action.updatedAt };
				}
				if (action.collaboratorUserId && collaborator.userId === action.collaboratorUserId) {
					return { ...collaborator, role: action.role, updatedAt: action.updatedAt };
				}
				return collaborator;
			});
			if ((action.collaboratorId && next.selfCollaboratorId === action.collaboratorId) || (action.collaboratorUserId && next.currentUserId === action.collaboratorUserId)) {
				next.accessRole = action.role;
			}
		}
	}

	return next;
}

export async function cacheCollaboratorSnapshot(args: { userId: string; docId: string; snapshot: CachedCollaboratorSnapshot }): Promise<void> {
	if (!args.userId || !args.docId) return;
	try {
		const db = await openDb();
		const tx = db.transaction([SNAPSHOT_STORE, COLLABORATOR_STORE, INVITATION_STORE], 'readwrite');
		const snapshotStore = tx.objectStore(SNAPSHOT_STORE);
		const collaboratorStore = tx.objectStore(COLLABORATOR_STORE);
		const invitationStore = tx.objectStore(INVITATION_STORE);

		await Promise.all([
			deleteIndexMatches(collaboratorStore.index('userId_docId'), [args.userId, args.docId]),
			deleteIndexMatches(invitationStore.index('userId_docId'), [args.userId, args.docId]),
		]);

		const snapshotRow: SnapshotRow = {
			userId: args.userId,
			docId: args.docId,
			roomId: args.snapshot.roomId || args.docId,
			sourceWorkspaceId: args.snapshot.sourceWorkspaceId || '',
			sourceNoteId: args.snapshot.sourceNoteId || '',
			accessRole: asRole(args.snapshot.accessRole),
			canManage: Boolean(args.snapshot.canManage),
			currentUserId: args.snapshot.currentUserId ?? null,
			selfCollaboratorId: args.snapshot.selfCollaboratorId ?? null,
			sharedBy: args.snapshot.sharedBy
				? {
					id: args.snapshot.sharedBy.id,
					name: args.snapshot.sharedBy.name,
					email: args.snapshot.sharedBy.email,
					profileImage: args.snapshot.sharedBy.profileImage ?? null,
				}
				: null,
			updatedAt: getNowIso(),
		};
		snapshotStore.put(snapshotRow, [args.userId, args.docId]);

		for (const collaborator of args.snapshot.collaborators) {
			const row: CollaboratorRow = {
				id: `${args.userId}::${args.docId}::${collaborator.id}`,
				userId: args.userId,
				docId: args.docId,
				collaboratorId: collaborator.id,
				collaboratorUserId: collaborator.userId,
				role: asRole(collaborator.role),
				accessSource: collaborator.accessSource === 'workspace' ? 'workspace' : 'direct',
				revokedAt: collaborator.revokedAt ? asIsoString(collaborator.revokedAt) : null,
				createdAt: asIsoString(collaborator.createdAt),
				updatedAt: asIsoString(collaborator.updatedAt, asIsoString(collaborator.createdAt)),
				username: collaborator.user?.name || collaborator.user?.email || collaborator.userId,
				email: collaborator.user?.email || '',
				avatar: collaborator.user?.profileImage ?? null,
			};
			collaboratorStore.put(row);
		}

		for (const invitation of args.snapshot.pendingInvitations) {
			const row: InvitationRow = {
				id: `${args.userId}::${args.docId}::${invitation.id}`,
				userId: args.userId,
				docId: args.docId,
				invitationId: invitation.id,
				sourceWorkspaceId: invitation.sourceWorkspaceId,
				sourceNoteId: invitation.sourceNoteId,
				role: asRole(invitation.role),
				status: invitation.status,
				inviteeEmail: invitation.inviteeEmail,
				inviteeName: invitation.inviteeName ?? null,
				createdAt: asIsoString(invitation.createdAt),
				updatedAt: asIsoString(invitation.updatedAt, asIsoString(invitation.createdAt)),
				respondedAt: invitation.respondedAt ? asIsoString(invitation.respondedAt) : null,
				revokedAt: invitation.revokedAt ? asIsoString(invitation.revokedAt) : null,
				inviter: invitation.inviter
					? {
						id: invitation.inviter.id,
						name: invitation.inviter.name,
						email: invitation.inviter.email,
						profileImage: invitation.inviter.profileImage ?? null,
					}
					: null,
				noteTitle: typeof invitation.noteTitle === 'string' ? invitation.noteTitle : '',
				placement: invitation.placement ? { ...invitation.placement } : null,
			};
			invitationStore.put(row);
		}

		await transactionToPromise(tx);
	} catch {
		// Cache failures should not block collaborator UI or server reconciliation.
	}
}

export async function clearCollaboratorSnapshot(userId: string, docId: string): Promise<void> {
	if (!userId || !docId) return;
	try {
		const db = await openDb();
		const tx = db.transaction([SNAPSHOT_STORE, COLLABORATOR_STORE, INVITATION_STORE], 'readwrite');
		const snapshotStore = tx.objectStore(SNAPSHOT_STORE);
		const collaboratorStore = tx.objectStore(COLLABORATOR_STORE);
		const invitationStore = tx.objectStore(INVITATION_STORE);
		snapshotStore.delete([userId, docId]);
		await Promise.all([
			deleteIndexMatches(collaboratorStore.index('userId_docId'), [userId, docId]),
			deleteIndexMatches(invitationStore.index('userId_docId'), [userId, docId]),
		]);
		await transactionToPromise(tx);
	} catch {
		// Best-effort cache cleanup only.
	}
}

export async function readPendingCollaboratorActions(userId: string, docId?: string): Promise<PendingCollaboratorAction[]> {
	if (!userId) return [];
	try {
		const db = await openDb();
		const tx = db.transaction([ACTION_STORE], 'readonly');
		const store = tx.objectStore(ACTION_STORE);
		const rows = docId
			? await requestToPromise(store.index('userId_docId').getAll([userId, docId])) as PendingCollaboratorAction[]
			: await requestToPromise(store.index('userId').getAll(userId)) as PendingCollaboratorAction[];
		await transactionToPromise(tx);
		return sortActions(Array.isArray(rows) ? rows : []);
	} catch {
		return [];
	}
}

export async function readCachedCollaboratorSnapshot(userId: string, docId: string): Promise<CachedCollaboratorSnapshot | null> {
	if (!userId || !docId) return null;
	try {
		const db = await openDb();
		const tx = db.transaction([SNAPSHOT_STORE, COLLABORATOR_STORE, INVITATION_STORE], 'readonly');
		const snapshotStore = tx.objectStore(SNAPSHOT_STORE);
		const collaboratorStore = tx.objectStore(COLLABORATOR_STORE);
		const invitationStore = tx.objectStore(INVITATION_STORE);

		const [snapshotRow, collaboratorRows, invitationRows] = await Promise.all([
			requestToPromise(snapshotStore.get([userId, docId])) as Promise<SnapshotRow | undefined>,
			requestToPromise(collaboratorStore.index('userId_docId').getAll([userId, docId])) as Promise<CollaboratorRow[]>,
			requestToPromise(invitationStore.index('userId_docId').getAll([userId, docId])) as Promise<InvitationRow[]>,
		]);
		await transactionToPromise(tx);
		const pendingActions = await readPendingCollaboratorActions(userId, docId);

		if (!snapshotRow && collaboratorRows.length === 0 && invitationRows.length === 0 && pendingActions.length === 0) {
			return null;
		}

		const base: CachedCollaboratorSnapshot = snapshotRow
			? {
				roomId: snapshotRow.roomId,
				sourceWorkspaceId: snapshotRow.sourceWorkspaceId,
				sourceNoteId: snapshotRow.sourceNoteId,
				accessRole: asRole(snapshotRow.accessRole),
				canManage: Boolean(snapshotRow.canManage),
				currentUserId: snapshotRow.currentUserId ?? null,
				selfCollaboratorId: snapshotRow.selfCollaboratorId ?? null,
				sharedBy: snapshotRow.sharedBy ? { ...snapshotRow.sharedBy } : null,
				collaborators: collaboratorRows.map((row) => ({
					id: row.collaboratorId,
					userId: row.collaboratorUserId,
					role: asRole(row.role),
					accessSource: row.accessSource === 'workspace' ? 'workspace' : 'direct',
					revokedAt: row.revokedAt ? asIsoString(row.revokedAt) : null,
					createdAt: asIsoString(row.createdAt),
					updatedAt: asIsoString(row.updatedAt, asIsoString(row.createdAt)),
					user: {
						id: row.collaboratorUserId,
						name: row.username,
						email: row.email,
						profileImage: row.avatar ?? null,
					},
				})),
				pendingInvitations: invitationRows.map((row) => ({
					id: row.invitationId,
					docId: docId,
					sourceWorkspaceId: row.sourceWorkspaceId,
					sourceNoteId: row.sourceNoteId,
					role: asRole(row.role),
					status: row.status,
					inviteeEmail: row.inviteeEmail,
					inviteeName: row.inviteeName ?? null,
					createdAt: asIsoString(row.createdAt),
					updatedAt: asIsoString(row.updatedAt, asIsoString(row.createdAt)),
					respondedAt: row.respondedAt ? asIsoString(row.respondedAt) : null,
					revokedAt: row.revokedAt ? asIsoString(row.revokedAt) : null,
					inviter: row.inviter ? { ...row.inviter } : null,
					noteTitle: row.noteTitle,
					placement: row.placement ? { ...row.placement } : null,
				})),
			}
			: createEmptySnapshot(userId, docId);

		base.collaborators.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
		base.pendingInvitations.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
		return applyPendingActions(base, pendingActions);
	} catch {
		return null;
	}
}

async function replaceDocActions(userId: string, docId: string, rows: readonly PendingCollaboratorAction[]): Promise<void> {
	const db = await openDb();
	const tx = db.transaction([ACTION_STORE], 'readwrite');
	const store = tx.objectStore(ACTION_STORE);
	await deleteIndexMatches(store.index('userId_docId'), [userId, docId]);
	for (const row of rows) {
		store.put(row);
	}
	await transactionToPromise(tx);
}

export async function enqueuePendingCollaboratorAction(action: PendingCollaboratorAction): Promise<void> {
	if (!action.userId || !action.docId) return;
	try {
		const existing = await readPendingCollaboratorActions(action.userId, action.docId);
		const next = existing.filter((row) => {
			if (action.kind === 'invite') {
				return !(row.kind === 'invite' && row.identifier && row.identifier === action.identifier);
			}
			if (action.kind === 'update-role') {
				if (row.kind === 'revoke') return true;
				return !(
					row.kind === 'update-role' &&
					((action.collaboratorId && row.collaboratorId === action.collaboratorId) ||
					(action.collaboratorUserId && row.collaboratorUserId === action.collaboratorUserId))
				);
			}
			if (action.kind === 'revoke') {
				return !(
					(action.collaboratorId && row.collaboratorId === action.collaboratorId) ||
					(action.collaboratorUserId && row.collaboratorUserId === action.collaboratorUserId)
				);
			}
			return true;
		});
		next.push({
			...action,
			role: action.role ? asRole(action.role) : null,
			createdAt: asIsoString(action.createdAt),
			updatedAt: asIsoString(action.updatedAt, asIsoString(action.createdAt)),
		});
		await replaceDocActions(action.userId, action.docId, next);
	} catch {
		// Queue failures should not crash the live UI.
	}
}

export async function removePendingCollaboratorAction(actionId: string): Promise<void> {
	if (!actionId) return;
	try {
		const db = await openDb();
		const tx = db.transaction([ACTION_STORE], 'readwrite');
		tx.objectStore(ACTION_STORE).delete(actionId);
		await transactionToPromise(tx);
	} catch {
		// Best-effort queue cleanup only.
	}
}