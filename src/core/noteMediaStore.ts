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
const DB_VERSION = 3;
const NOTE_MEDIA_QUEUE_STORE = 'note_media_queue';
const NOTE_MEDIA_PREVIEW_STORE = 'note_media_preview';
const NOTE_MEDIA_CHANGED_EVENT = 'freemannotes:note-media-changed';

export type StoredNoteImagePreviewRecord = {
	id: string;
	kind: 'remote' | 'queued';
	docId: string;
	remoteImageId: string | null;
	image: NoteImageRecord | null;
	thumbnailBlob: Blob | null;
	createdAt: string;
	updatedAt: string;
};

let dbPromise: Promise<IDBDatabase> | null = null;
const pendingFlushes = new Map<string, Promise<void>>();
const flushTimers = new Map<string, number>();
const remoteCache = new Map<string, readonly NoteImageRecord[]>();
const pendingRemoteRefreshes = new Map<string, Promise<readonly NoteImageRecord[]>>();
const remoteRefreshTimestamps = new Map<string, number>();

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
				if (!db.objectStoreNames.contains(NOTE_MEDIA_PREVIEW_STORE)) {
					const previewStore = db.createObjectStore(NOTE_MEDIA_PREVIEW_STORE, { keyPath: 'id' });
					previewStore.createIndex('docId', 'docId', { unique: false });
					previewStore.createIndex('docId_kind', ['docId', 'kind'], { unique: false });
					previewStore.createIndex('remoteImageId', 'remoteImageId', { unique: false });
				} else {
					const previewStore = request.transaction?.objectStore(NOTE_MEDIA_PREVIEW_STORE);
					if (previewStore && !previewStore.indexNames.contains('docId')) {
						previewStore.createIndex('docId', 'docId', { unique: false });
					}
					if (previewStore && !previewStore.indexNames.contains('docId_kind')) {
						previewStore.createIndex('docId_kind', ['docId', 'kind'], { unique: false });
					}
					if (previewStore && !previewStore.indexNames.contains('remoteImageId')) {
						previewStore.createIndex('remoteImageId', 'remoteImageId', { unique: false });
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

async function upsertPreviewRows(rows: readonly StoredNoteImagePreviewRecord[]): Promise<void> {
	if (rows.length === 0) return;
	const db = await openDb();
	const tx = db.transaction([NOTE_MEDIA_PREVIEW_STORE], 'readwrite');
	const store = tx.objectStore(NOTE_MEDIA_PREVIEW_STORE);
	for (const row of rows) {
		store.put(row);
	}
	await transactionToPromise(tx);
}

async function deletePreviewRows(ids: readonly string[]): Promise<void> {
	if (ids.length === 0) return;
	const db = await openDb();
	const tx = db.transaction([NOTE_MEDIA_PREVIEW_STORE], 'readwrite');
	const store = tx.objectStore(NOTE_MEDIA_PREVIEW_STORE);
	for (const id of ids) {
		store.delete(id);
	}
	await transactionToPromise(tx);
}

async function readPreviewRowsByDoc(docId: string): Promise<StoredNoteImagePreviewRecord[]> {
	if (!docId) return [];
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_MEDIA_PREVIEW_STORE], 'readonly');
		const rows = (await requestToPromise(
			tx.objectStore(NOTE_MEDIA_PREVIEW_STORE).index('docId').getAll(docId)
		)) as StoredNoteImagePreviewRecord[];
		await transactionToPromise(tx);
		return Array.isArray(rows) ? rows : [];
	} catch {
		return [];
	}
}

async function loadImageElementFromBlob(blob: Blob): Promise<HTMLImageElement> {
	const objectUrl = URL.createObjectURL(blob);
	try {
		return await new Promise((resolve, reject) => {
			const image = new Image();
			image.decoding = 'async';
			image.onload = () => resolve(image);
			image.onerror = () => reject(new Error('Image decode failed'));
			image.src = objectUrl;
		});
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

export async function createProgressiveNoteImageThumbnail(blob: Blob): Promise<Blob | null> {
	if (typeof document === 'undefined' || !(blob instanceof Blob) || blob.size === 0) return null;
	try {
		const image = await loadImageElementFromBlob(blob);
		const maxDimension = 200;
		const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
		const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
		const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) return null;
		context.drawImage(image, 0, 0, width, height);

		const qualities = [0.55, 0.48, 0.4];
		let fallbackBlob: Blob | null = null;
		for (const quality of qualities) {
			const nextBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
			if (!nextBlob) continue;
			fallbackBlob = nextBlob;
			if (nextBlob.size <= 20 * 1024) return nextBlob;
		}
		return fallbackBlob;
	} catch {
		return null;
	}
}

async function fetchBlob(url: string): Promise<Blob | null> {
	if (!url || isOffline()) return null;
	try {
		const response = await fetch(url, { credentials: 'include' });
		if (!response.ok) return null;
		return await response.blob();
	} catch {
		return null;
	}
}

async function syncRemotePreviewRows(docId: string, images: readonly NoteImageRecord[]): Promise<void> {
	if (!docId) return;
	const existingRows = (await readPreviewRowsByDoc(docId)).filter((row) => row.kind === 'remote');
	const existingById = new Map(existingRows.map((row) => [row.id, row]));
	const nextIds = new Set(images.map((image) => image.id));
	const staleIds = existingRows.filter((row) => !nextIds.has(row.id)).map((row) => row.id);
	if (staleIds.length > 0) {
		await deletePreviewRows(staleIds);
	}

	const baseRows = images.map((image) => {
		const existing = existingById.get(image.id);
		return {
			id: image.id,
			kind: 'remote' as const,
			docId,
			remoteImageId: image.id,
			image,
			thumbnailBlob: existing?.thumbnailBlob || null,
			createdAt: existing?.createdAt || image.createdAt,
			updatedAt: image.updatedAt,
		};
	});
	await upsertPreviewRows(baseRows);

	const pendingThumbnailImages = images.filter((image) => {
		const existing = existingById.get(image.id);
		if (!existing?.thumbnailBlob) return true;
		const existingThumbUrl = existing.image?.thumbnailUrl || '';
		return existingThumbUrl !== image.thumbnailUrl;
	});
	if (pendingThumbnailImages.length === 0) return;

	let storedThumbnail = false;
	const resolvedRows: StoredNoteImagePreviewRecord[] = [];
	for (const image of pendingThumbnailImages) {
		const sourceBlob = await fetchBlob(image.thumbnailUrl);
		if (!sourceBlob) continue;
		const thumbnailBlob = await createProgressiveNoteImageThumbnail(sourceBlob);
		if (!thumbnailBlob) continue;
		const existing = existingById.get(image.id);
		resolvedRows.push({
			id: image.id,
			kind: 'remote',
			docId,
			remoteImageId: image.id,
			image,
			thumbnailBlob,
			createdAt: existing?.createdAt || image.createdAt,
			updatedAt: image.updatedAt,
		});
		storedThumbnail = true;
	}
	if (resolvedRows.length > 0) {
		await upsertPreviewRows(resolvedRows);
	}
	if (storedThumbnail) {
		emitNoteMediaChanged(docId);
	}
}

async function storeQueuedPreviewRow(docId: string, rowId: string, blob: Blob, createdAt: string): Promise<void> {
	const thumbnailBlob = await createProgressiveNoteImageThumbnail(blob);
	await upsertPreviewRows([
		{
			id: rowId,
			kind: 'queued',
			docId,
			remoteImageId: null,
			image: null,
			thumbnailBlob,
			createdAt,
			updatedAt: createdAt,
		},
	]);
}

export async function readStoredNoteImagePreviewRows(docId: string): Promise<StoredNoteImagePreviewRecord[]> {
	return readPreviewRowsByDoc(docId);
}

export async function readStoredRemoteNoteImages(docId: string): Promise<NoteImageRecord[]> {
	const rows = await readPreviewRowsByDoc(docId);
	return rows
		.filter((row) => row.kind === 'remote' && row.image)
		.map((row) => row.image as NoteImageRecord)
		.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
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
	await Promise.all(rows.map((row, index) => storeQueuedPreviewRow(docId, row.id, args.files[index], createdAt).catch(() => undefined)));
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
	await deletePreviewRows([imageId]).catch(() => undefined);
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
		await deletePreviewRows([id]).catch(() => undefined);
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

export async function refreshRemoteNoteImages(
	docId: string,
	options: { force?: boolean; minIntervalMs?: number } = {}
): Promise<readonly NoteImageRecord[]> {
	if (!docId || isOffline()) {
		const stored = await readStoredRemoteNoteImages(docId);
		if (stored.length > 0) {
			remoteCache.set(docId, stored);
			return stored;
		}
		return remoteCache.get(docId) || [];
	}
	const minIntervalMs = Math.max(0, Number(options.minIntervalMs || 0) || 0);
	const cached = remoteCache.get(docId);
	if (!options.force && cached && minIntervalMs > 0) {
		const lastRefreshedAt = remoteRefreshTimestamps.get(docId) || 0;
		if (Date.now() - lastRefreshedAt < minIntervalMs) {
			return cached;
		}
	}
	const pending = pendingRemoteRefreshes.get(docId);
	if (pending) {
		// Coalesce concurrent chip/panel/viewer refreshes so one burst of note-media
		// events results in a single `/api/note-media` round-trip per note.
		return pending;
	}
	const work = (async () => {
		const response = await listNoteImages(docId);
		remoteCache.set(docId, response.images);
		remoteRefreshTimestamps.set(docId, Date.now());
		void syncRemotePreviewRows(docId, response.images);
		return response.images;
	})();
	pendingRemoteRefreshes.set(docId, work);
	try {
		return await work;
	} finally {
		pendingRemoteRefreshes.delete(docId);
	}
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
						await deletePreviewRows([row.remoteImageId]).catch(() => undefined);
					}
				} else {
					if (!row.blob) throw new Error('Upload payload is missing');
					const file = new File([row.blob], row.fileName || 'image', {
						type: row.mimeType || row.blob.type || 'application/octet-stream',
					});
					await uploadNoteImages(row.docId, [file]);
					await deletePreviewRows([row.id]).catch(() => undefined);
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