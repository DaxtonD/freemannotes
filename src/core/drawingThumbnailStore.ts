export type StoredDrawingThumbnailRow = {
	id: string;
	noteId: string;
	versionKey: string;
	dataUrl: string;
	updatedAt: string;
};

const DB_NAME = 'freemannotes.drawing-thumbnails.v1';
const DB_VERSION = 1;
const STORE_NAME = 'drawing_thumbnails';
const LATEST_DRAWING_THUMBNAILS_STORAGE_KEY = 'freemannotes.latest-drawing-thumbnails.v1';
const MAX_LATEST_DRAWING_THUMBNAILS = 24;

let dbPromise: Promise<IDBDatabase> | null = null;
let latestThumbnailSnapshotCache: Record<string, StoredDrawingThumbnailRow> | null = null;

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

async function openDb(): Promise<IDBDatabase> {
	if (typeof indexedDB === 'undefined') {
		throw new Error('IndexedDB is unavailable');
	}
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
					store.createIndex('noteId', 'noteId', { unique: false });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
		});
	}
	return dbPromise;
}

function loadLatestThumbnailSnapshot(): Record<string, StoredDrawingThumbnailRow> {
	if (latestThumbnailSnapshotCache) return latestThumbnailSnapshotCache;
	if (typeof window === 'undefined') {
		latestThumbnailSnapshotCache = {};
		return latestThumbnailSnapshotCache;
	}
	try {
		const raw = window.localStorage.getItem(LATEST_DRAWING_THUMBNAILS_STORAGE_KEY);
		if (!raw) {
			latestThumbnailSnapshotCache = {};
			return latestThumbnailSnapshotCache;
		}
		const parsed = JSON.parse(raw) as Record<string, StoredDrawingThumbnailRow>;
		latestThumbnailSnapshotCache = parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		latestThumbnailSnapshotCache = {};
	}
	return latestThumbnailSnapshotCache;
}

function persistLatestThumbnailSnapshot(next: Record<string, StoredDrawingThumbnailRow>): void {
	latestThumbnailSnapshotCache = next;
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(LATEST_DRAWING_THUMBNAILS_STORAGE_KEY, JSON.stringify(next));
	} catch {
		// Best-effort warm-start snapshot only.
	}
}

function updateLatestThumbnailSnapshot(row: StoredDrawingThumbnailRow): void {
	const current = loadLatestThumbnailSnapshot();
	const next: Record<string, StoredDrawingThumbnailRow> = {
		...current,
		[row.noteId]: row,
	};
	const entries = Object.entries(next)
		.sort((left, right) => String(right[1]?.updatedAt || '').localeCompare(String(left[1]?.updatedAt || '')))
		.slice(0, MAX_LATEST_DRAWING_THUMBNAILS);
	persistLatestThumbnailSnapshot(Object.fromEntries(entries));
}

export function readLatestStoredDrawingThumbnailSnapshot(noteId: string): StoredDrawingThumbnailRow | null {
	if (!noteId) return null;
	return loadLatestThumbnailSnapshot()[noteId] ?? null;
}

export async function readStoredDrawingThumbnail(cacheKey: string): Promise<StoredDrawingThumbnailRow | null> {
	if (!cacheKey) return null;
	try {
		const db = await openDb();
		const tx = db.transaction([STORE_NAME], 'readonly');
		const row = await requestToPromise(tx.objectStore(STORE_NAME).get(cacheKey)) as StoredDrawingThumbnailRow | undefined;
		await transactionToPromise(tx);
		return row ?? null;
	} catch {
		return null;
	}
}

export async function readLatestStoredDrawingThumbnail(noteId: string): Promise<StoredDrawingThumbnailRow | null> {
	if (!noteId) return null;
	try {
		const db = await openDb();
		const tx = db.transaction([STORE_NAME], 'readonly');
		const rows = await requestToPromise(tx.objectStore(STORE_NAME).index('noteId').getAll(noteId)) as StoredDrawingThumbnailRow[] | undefined;
		await transactionToPromise(tx);
		if (!Array.isArray(rows) || rows.length === 0) return null;
		let latest: StoredDrawingThumbnailRow | null = null;
		for (const row of rows) {
			if (!row?.dataUrl) continue;
			if (!latest || String(row.updatedAt || '') > String(latest.updatedAt || '')) {
				latest = row;
			}
		}
		return latest;
	} catch {
		return null;
	}
}

export async function writeStoredDrawingThumbnail(row: StoredDrawingThumbnailRow): Promise<void> {
	if (!row.id || !row.dataUrl) return;
	updateLatestThumbnailSnapshot(row);
	try {
		const db = await openDb();
		const tx = db.transaction([STORE_NAME], 'readwrite');
		tx.objectStore(STORE_NAME).put(row);
		await transactionToPromise(tx);
	} catch {
		// Best-effort local cache only.
	}
}

/** Must be called on logout. Clears the localStorage warm-start snapshot so the
 *  next user on the same device cannot see drawing thumbnails from the previous
 *  user's notes. The IndexedDB store is left intact: access is gated by
 *  workspaceId on the server, so cross-user IDB leakage is not a concern. */
export function clearDrawingThumbnailLocalCache(): void {
	latestThumbnailSnapshotCache = null;
	try { window.localStorage.removeItem(LATEST_DRAWING_THUMBNAILS_STORAGE_KEY); } catch { /* ignore */ }
}