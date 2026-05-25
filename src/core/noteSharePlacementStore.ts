import type { NoteShareInviter, SharedNotePlacement } from './noteShareApi';

// Shared placements are the workspace-scoped metadata that let Shared With Me
// render and route notes offline. Keep them in IndexedDB on the same footing as
// the regular workspace snapshot instead of depending on a live placements fetch.

type PlacementRow = {
	id: string;
	userId: string;
	workspaceId: string;
	placementId: string;
	aliasId: string;
	roomId: string;
	sourceWorkspaceId: string;
	sourceNoteId: string;
	role: 'VIEWER' | 'EDITOR';
	folderName: string | null;
	collectionId: string | null;
	labelIds: string[];
	inviter: NoteShareInviter | null;
	createdAt: string;
	updatedAt: string;
};

const DB_NAME = 'freemannotes.note-share-placements.v1';
const DB_VERSION = 1;
const PLACEMENT_STORE = 'placement';

let dbPromise: Promise<IDBDatabase> | null = null;

function getNowIso(): string {
	return new Date().toISOString();
}

function asIsoString(value: unknown, fallback = getNowIso()): string {
	if (typeof value !== 'string') return fallback;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
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
				if (!db.objectStoreNames.contains(PLACEMENT_STORE)) {
					const store = db.createObjectStore(PLACEMENT_STORE, { keyPath: 'id' });
					store.createIndex('userId', 'userId', { unique: false });
					store.createIndex('userId_workspaceId', ['userId', 'workspaceId'], { unique: false });
					store.createIndex('userId_placementId', ['userId', 'placementId'], { unique: false });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
		});
	}
	return dbPromise;
}

function toRow(userId: string, workspaceId: string, placement: SharedNotePlacement): PlacementRow {
	return {
		id: `${userId}:${workspaceId}:${placement.id}`,
		userId,
		workspaceId,
		placementId: placement.id,
		aliasId: String(placement.aliasId || '').trim(),
		roomId: String(placement.roomId || '').trim(),
		sourceWorkspaceId: String(placement.sourceWorkspaceId || '').trim(),
		sourceNoteId: String(placement.sourceNoteId || '').trim(),
		role: placement.role === 'VIEWER' ? 'VIEWER' : 'EDITOR',
		folderName: typeof placement.folderName === 'string' && placement.folderName.trim() ? placement.folderName.trim() : null,
		collectionId: typeof placement.collectionId === 'string' && placement.collectionId.trim() ? placement.collectionId.trim() : null,
		labelIds: Array.isArray(placement.labelIds) ? placement.labelIds.map((id) => String(id || '').trim()).filter(Boolean) : [],
		inviter: placement.inviter ? {
			id: String(placement.inviter.id || '').trim(),
			name: String(placement.inviter.name || '').trim(),
			email: String(placement.inviter.email || '').trim(),
			profileImage: placement.inviter.profileImage ?? null,
		} : null,
		createdAt: asIsoString(placement.createdAt),
		updatedAt: asIsoString(placement.updatedAt, asIsoString(placement.createdAt)),
	};
}

function fromRow(row: PlacementRow): SharedNotePlacement {
	return {
		id: row.placementId,
		aliasId: row.aliasId,
		roomId: row.roomId,
		sourceWorkspaceId: row.sourceWorkspaceId,
		sourceNoteId: row.sourceNoteId,
		role: row.role === 'VIEWER' ? 'VIEWER' : 'EDITOR',
		folderName: row.folderName,
		collectionId: row.collectionId,
		labelIds: Array.isArray(row.labelIds) ? [...row.labelIds] : [],
		inviter: row.inviter ? { ...row.inviter } : null,
		createdAt: asIsoString(row.createdAt),
		updatedAt: asIsoString(row.updatedAt, asIsoString(row.createdAt)),
	};
}

function sortPlacements(placements: readonly SharedNotePlacement[]): SharedNotePlacement[] {
	return [...placements].sort((left, right) => {
		const rightMs = Date.parse(right.createdAt || right.updatedAt || '');
		const leftMs = Date.parse(left.createdAt || left.updatedAt || '');
		if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
			return rightMs - leftMs;
		}
		return left.id.localeCompare(right.id);
	});
}

export async function cacheSharedNotePlacements(userId: string, workspaceId: string, placements: readonly SharedNotePlacement[]): Promise<void> {
	const normalizedUserId = String(userId || '').trim();
	const normalizedWorkspaceId = String(workspaceId || '').trim();
	if (!normalizedUserId || !normalizedWorkspaceId) return;
	const db = await openDb();
	const transaction = db.transaction([PLACEMENT_STORE], 'readwrite');
	const store = transaction.objectStore(PLACEMENT_STORE);
	await deleteIndexMatches(store.index('userId_workspaceId'), [normalizedUserId, normalizedWorkspaceId]);
	for (const placement of placements) {
		store.put(toRow(normalizedUserId, normalizedWorkspaceId, placement));
	}
	await transactionToPromise(transaction);
}

export async function readCachedSharedNotePlacements(userId: string): Promise<SharedNotePlacement[]> {
	const normalizedUserId = String(userId || '').trim();
	if (!normalizedUserId) return [];
	const db = await openDb();
	const transaction = db.transaction([PLACEMENT_STORE], 'readonly');
	const store = transaction.objectStore(PLACEMENT_STORE);
	const rows = await requestToPromise(store.index('userId').getAll(normalizedUserId)) as PlacementRow[];
	return sortPlacements(rows.map((row) => fromRow(row)));
}

export async function readCachedSharedNotePlacementsForWorkspace(userId: string, workspaceId: string): Promise<SharedNotePlacement[]> {
	const normalizedUserId = String(userId || '').trim();
	const normalizedWorkspaceId = String(workspaceId || '').trim();
	if (!normalizedUserId || !normalizedWorkspaceId) return [];
	const db = await openDb();
	const transaction = db.transaction([PLACEMENT_STORE], 'readonly');
	const store = transaction.objectStore(PLACEMENT_STORE);
	const rows = await requestToPromise(store.index('userId_workspaceId').getAll([normalizedUserId, normalizedWorkspaceId])) as PlacementRow[];
	return sortPlacements(rows.map((row) => fromRow(row)));
}

export async function patchCachedSharedNotePlacement(userId: string, placementId: string, patch: { collectionId?: string | null; labelIds?: readonly string[]; updatedAt?: string }): Promise<void> {
	const normalizedUserId = String(userId || '').trim();
	const normalizedPlacementId = String(placementId || '').trim();
	if (!normalizedUserId || !normalizedPlacementId) return;
	const db = await openDb();
	const transaction = db.transaction([PLACEMENT_STORE], 'readwrite');
	const store = transaction.objectStore(PLACEMENT_STORE);
	const request = store.index('userId_placementId').openCursor([normalizedUserId, normalizedPlacementId]);
	await new Promise<void>((resolve, reject) => {
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) {
				resolve();
				return;
			}
			const row = cursor.value as PlacementRow;
			const next: PlacementRow = {
				...row,
				collectionId: patch.collectionId !== undefined
					? (typeof patch.collectionId === 'string' && patch.collectionId.trim() ? patch.collectionId.trim() : null)
					: row.collectionId,
				labelIds: patch.labelIds !== undefined
					? patch.labelIds.map((id) => String(id || '').trim()).filter(Boolean)
					: row.labelIds,
				updatedAt: patch.updatedAt ? asIsoString(patch.updatedAt, row.updatedAt) : getNowIso(),
			};
			cursor.update(next);
			cursor.continue();
		};
		request.onerror = () => reject(request.error || new Error('IndexedDB cursor failed'));
	});
	await transactionToPromise(transaction);
}