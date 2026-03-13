import { deleteNoteImage, listNoteImages, uploadNoteImages, type NoteImageRecord } from './noteMediaApi';

export type QueuedNoteImageStatus = 'pending' | 'failed';
export type QueuedNoteImageOperation = 'upload' | 'delete';

export type QueuedNoteImageRow = {
	id: string;
	userId: string;
	docId: string;
	operationType: QueuedNoteImageOperation;
	remoteImageId: string | null;
	fileName: string | null;
	mimeType: string | null;
	byteSize: number;
	blob: Blob | null;
	createdAt: string;
	updatedAt: string;
	syncStatus: QueuedNoteImageStatus;
	lastError: string | null;
};

const DB_NAME = 'freemannotes.note-media.v1';
const DB_VERSION = 2;
const NOTE_MEDIA_QUEUE_STORE = 'note_media_queue';
const NOTE_MEDIA_CHANGED_EVENT = 'freemannotes:note-media-changed';

let dbPromise: Promise<IDBDatabase> | null = null;
const pendingFlushes = new Map<string, Promise<void>>();
const flushTimers = new Map<string, number>();
const remoteCache = new Map<string, readonly NoteImageRecord[]>();

function isOffline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function createId(prefix: string): string {
	return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
	return new Date().toISOString();
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

async function openDb(): Promise<IDBDatabase> {
	if (typeof indexedDB === 'undefined') {
		throw new Error('IndexedDB is unavailable');
	}
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(NOTE_MEDIA_QUEUE_STORE)) {
					const store = db.createObjectStore(NOTE_MEDIA_QUEUE_STORE, { keyPath: 'id' });
					store.createIndex('userId', 'userId', { unique: false });
					store.createIndex('userId_docId', ['userId', 'docId'], { unique: false });
					store.createIndex('userId_syncStatus', ['userId', 'syncStatus'], { unique: false });
					store.createIndex('userId_docId_operationType', ['userId', 'docId', 'operationType'], { unique: false });
				} else {
					const store = request.transaction?.objectStore(NOTE_MEDIA_QUEUE_STORE);
					if (store && !store.indexNames.contains('userId_docId_operationType')) {
						store.createIndex('userId_docId_operationType', ['userId', 'docId', 'operationType'], { unique: false });
					}
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
		});
	}
	return dbPromise;
}

export function getNoteMediaChangedEventName(): string {
	return NOTE_MEDIA_CHANGED_EVENT;
}

export function emitNoteMediaChanged(docId: string): void {
	if (!docId || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
	window.dispatchEvent(new CustomEvent(NOTE_MEDIA_CHANGED_EVENT, { detail: { docId } }));
}

async function upsertQueuedRows(rows: readonly QueuedNoteImageRow[]): Promise<void> {
	if (rows.length === 0) return;
	const db = await openDb();
	const tx = db.transaction([NOTE_MEDIA_QUEUE_STORE], 'readwrite');
	const store = tx.objectStore(NOTE_MEDIA_QUEUE_STORE);
	for (const row of rows) {
		store.put(row);
	}
	await transactionToPromise(tx);
}

function isUploadRow(row: QueuedNoteImageRow): boolean {
	return row.operationType !== 'delete';
}

function isDeleteRow(row: QueuedNoteImageRow): boolean {
	return row.operationType === 'delete';
}

export async function queueNoteImagesForUpload(args: {
	userId: string;
	docId: string;
	files: readonly File[];
}): Promise<QueuedNoteImageRow[]> {
	const userId = String(args.userId || '').trim();
	const docId = String(args.docId || '').trim();
	if (!userId || !docId || args.files.length === 0) return [];
	const createdAt = nowIso();
	const rows = args.files.map((file) => ({
		id: createId('note-image'),
		userId,
		docId,
		operationType: 'upload' as const,
		remoteImageId: null,
		fileName: file.name || 'image',
		mimeType: file.type || 'application/octet-stream',
		byteSize: file.size,
		blob: file,
		createdAt,
		updatedAt: createdAt,
		syncStatus: 'pending' as const,
		lastError: null,
	}));
	await upsertQueuedRows(rows);
	emitNoteMediaChanged(docId);
	await scheduleQueuedNoteImageFlush(userId);
	return rows;
}

export async function queueRemoteNoteImageDeletion(args: {
	userId: string;
	docId: string;
	imageId: string;
}): Promise<QueuedNoteImageRow | null> {
	const userId = String(args.userId || '').trim();
	const docId = String(args.docId || '').trim();
	const imageId = String(args.imageId || '').trim();
	if (!userId || !docId || !imageId) return null;
	const existing = await readQueuedNoteImageDeletions(userId, docId);
	if (existing.some((row) => row.remoteImageId === imageId)) {
		return existing.find((row) => row.remoteImageId === imageId) || null;
	}
	const createdAt = nowIso();
	const row: QueuedNoteImageRow = {
		id: createId('note-image-delete'),
		userId,
		docId,
		operationType: 'delete',
		remoteImageId: imageId,
		fileName: null,
		mimeType: null,
		byteSize: 0,
		blob: null,
		createdAt,
		updatedAt: createdAt,
		syncStatus: 'pending',
		lastError: null,
	};
	await upsertQueuedRows([row]);
	removeRemoteImageFromCache(docId, imageId);
	emitNoteMediaChanged(docId);
	await scheduleQueuedNoteImageFlush(userId);
	return row;
}

export async function readQueuedNoteImages(userId: string, docId: string): Promise<QueuedNoteImageRow[]> {
	if (!userId || !docId) return [];
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_MEDIA_QUEUE_STORE], 'readonly');
		const rows = (await requestToPromise(
			tx.objectStore(NOTE_MEDIA_QUEUE_STORE).index('userId_docId').getAll([userId, docId])
		)) as QueuedNoteImageRow[];
		await transactionToPromise(tx);
		return Array.isArray(rows)
			? rows.filter(isUploadRow).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
			: [];
	} catch {
		return [];
	}
}

export async function readQueuedNoteImageDeletions(userId: string, docId: string): Promise<QueuedNoteImageRow[]> {
	if (!userId || !docId) return [];
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_MEDIA_QUEUE_STORE], 'readonly');
		const rows = (await requestToPromise(
			tx.objectStore(NOTE_MEDIA_QUEUE_STORE).index('userId_docId').getAll([userId, docId])
		)) as QueuedNoteImageRow[];
		await transactionToPromise(tx);
		return Array.isArray(rows)
			? rows.filter(isDeleteRow).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
			: [];
	} catch {
		return [];
	}
}

async function readAllQueuedNoteImages(userId: string): Promise<QueuedNoteImageRow[]> {
	if (!userId) return [];
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_MEDIA_QUEUE_STORE], 'readonly');
		const rows = (await requestToPromise(tx.objectStore(NOTE_MEDIA_QUEUE_STORE).index('userId').getAll(userId))) as QueuedNoteImageRow[];
		await transactionToPromise(tx);
		return Array.isArray(rows) ? rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt)) : [];
	} catch {
		return [];
	}
}

async function updateQueuedRow(id: string, updater: (current: QueuedNoteImageRow) => QueuedNoteImageRow | null): Promise<void> {
	const db = await openDb();
	const tx = db.transaction([NOTE_MEDIA_QUEUE_STORE], 'readwrite');
	const store = tx.objectStore(NOTE_MEDIA_QUEUE_STORE);
	const current = (await requestToPromise(store.get(id))) as QueuedNoteImageRow | undefined;
	if (!current) {
		await transactionToPromise(tx);
		return;
	}
	const next = updater(current);
	if (next) {
		store.put(next);
	} else {
		store.delete(id);
	}
	await transactionToPromise(tx);
}

export async function deleteQueuedNoteImage(id: string): Promise<void> {
	if (!id) return;
	try {
		let docId = '';
		await updateQueuedRow(id, (current) => {
			docId = current.docId;
			return null;
		});
		if (docId) emitNoteMediaChanged(docId);
	} catch {
		// ignore
	}
}

function removeRemoteImageFromCache(docId: string, imageId: string): void {
	if (!docId || !imageId) return;
	const current = remoteCache.get(docId);
	if (!current) return;
	remoteCache.set(docId, current.filter((image) => image.id !== imageId));
}

export function filterRemoteNoteImagesByPendingDeletes(images: readonly NoteImageRecord[], deleteRows: readonly QueuedNoteImageRow[]): NoteImageRecord[] {
	if (deleteRows.length === 0) return [...images];
	const hiddenIds = new Set(deleteRows.map((row) => row.remoteImageId).filter((value): value is string => Boolean(value)));
	return images.filter((image) => !hiddenIds.has(image.id));
}

export async function refreshRemoteNoteImages(docId: string): Promise<readonly NoteImageRecord[]> {
	if (!docId || isOffline()) {
		return remoteCache.get(docId) || [];
	}
	const response = await listNoteImages(docId);
	remoteCache.set(docId, response.images);
	emitNoteMediaChanged(docId);
	return response.images;
}

export function getCachedRemoteNoteImages(docId: string): readonly NoteImageRecord[] {
	return remoteCache.get(docId) || [];
}

export async function scheduleQueuedNoteImageFlush(userId: string): Promise<void> {
	if (!userId) return;
	if (pendingFlushes.has(userId)) {
		await pendingFlushes.get(userId);
		return;
	}
	const existingTimer = flushTimers.get(userId);
	if (existingTimer) {
		window.clearTimeout(existingTimer);
	}
	await new Promise<void>((resolve) => {
		const timer = window.setTimeout(() => {
			flushTimers.delete(userId);
			resolve();
		}, 200);
		flushTimers.set(userId, timer);
	});
	await flushQueuedNoteImages(userId);
}

export async function flushQueuedNoteImages(userId: string): Promise<void> {
	if (!userId || isOffline()) return;
	if (pendingFlushes.has(userId)) {
		await pendingFlushes.get(userId);
		return;
	}
	const work = (async () => {
		const rows = await readAllQueuedNoteImages(userId);
		for (const row of rows) {
			if (isOffline()) return;
			try {
				if (row.operationType === 'delete') {
					if (row.remoteImageId) {
						await deleteNoteImage(row.remoteImageId);
						removeRemoteImageFromCache(row.docId, row.remoteImageId);
					}
				} else {
					if (!row.blob) throw new Error('Upload payload is missing');
					const file = new File([row.blob], row.fileName || 'image', {
						type: row.mimeType || row.blob.type || 'application/octet-stream',
					});
					await uploadNoteImages(row.docId, [file]);
				}
				await updateQueuedRow(row.id, () => null);
				await refreshRemoteNoteImages(row.docId).catch(() => undefined);
				emitNoteMediaChanged(row.docId);
			} catch (error) {
				await updateQueuedRow(row.id, (current) => ({
					...current,
					updatedAt: nowIso(),
					syncStatus: 'failed',
					lastError: error instanceof Error ? error.message : 'Upload failed',
				}));
				emitNoteMediaChanged(row.docId);
			}
		}
	})();
	pendingFlushes.set(userId, work);
	try {
		await work;
	} finally {
		pendingFlushes.delete(userId);
	}
}