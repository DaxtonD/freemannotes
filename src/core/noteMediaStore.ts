import { deleteNoteImage, importNoteImageUrl, listNoteImages, uploadNoteImages, type NoteImageRecord } from './noteMediaApi';
import { shouldTreatConnectionAsOffline } from './networkQuality';
import { requestPwaBackgroundSync } from './pwa';

export type QueuedNoteImageStatus = 'pending' | 'failed';
export type QueuedNoteImageOperation = 'upload' | 'delete' | 'import-url';

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
	/** Source URL for 'import-url' operations (queued when network is unavailable). */
	sourceUrl: string | null;
	createdAt: string;
	updatedAt: string;
	syncStatus: QueuedNoteImageStatus;
	lastError: string | null;
};

const DB_NAME = 'freemannotes.note-media.v1';
const DB_VERSION = 4;
const NOTE_MEDIA_QUEUE_STORE = 'note_media_queue';
const NOTE_MEDIA_PREVIEW_STORE = 'note_media_preview';
const NOTE_MEDIA_CHANGED_EVENT = 'freemannotes:note-media-changed';
const NOTE_MEDIA_PREVIEW_VERSION = 2;

// Upload retry / backoff constants
const FLUSH_DEBOUNCE_MS = 400;
const FLUSH_BACKOFF_INITIAL_MS = 2_000;
const FLUSH_BACKOFF_MAX_MS = 60_000;
// Delay before retrying a row whose note returned 403/404 (awaiting server sync)
const FLUSH_ACCESS_RETRY_MS = 5_000;

export type StoredNoteImagePreviewRecord = {
	id: string;
	kind: 'remote' | 'queued';
	docId: string;
	remoteImageId: string | null;
	image: NoteImageRecord | null;
	thumbnailBlob: Blob | null;
	previewVersion?: number;
	createdAt: string;
	updatedAt: string;
};

let dbPromise: Promise<IDBDatabase> | null = null;
const pendingFlushes = new Map<string, Promise<void>>();
const flushTimers = new Map<string, number>();
const flushFollowUpTimers = new Map<string, ReturnType<typeof setTimeout>>();
const flushBackoffMs = new Map<string, number>();
const remoteCache = new Map<string, readonly NoteImageRecord[]>();
// Synchronous in-memory count of pending upload rows per docId. Updated without an
// IDB round-trip so NoteGrid can include queued images in `liveAttachmentTotal` and
// avoid the early-return gate that prevents the chip from mounting while offline.
const queuedCountByDocId = new Map<string, number>();
const pendingRemoteRefreshes = new Map<string, Promise<readonly NoteImageRecord[]>>();
const remoteRefreshTimestamps = new Map<string, number>();
const remoteFileNameOverrides = new Map<string, string>();
const movedCacheGraceUntil = new Map<string, number>();
const MOVE_CACHE_GRACE_MS = 8_000;

function isMissingAccessError(error: unknown): boolean {
	const status = (error as { status?: number } | null)?.status;
	return status === 403 || status === 404;
}

function parseDocId(docId: string): { workspaceId: string; noteId: string } {
	const normalizedDocId = String(docId || '').trim();
	const separatorIndex = normalizedDocId.indexOf(':');
	if (separatorIndex <= 0) {
		return { workspaceId: '', noteId: normalizedDocId };
	}
	return {
		workspaceId: normalizedDocId.slice(0, separatorIndex),
		noteId: normalizedDocId.slice(separatorIndex + 1),
	};
}

function rewriteNoteImageDocId(image: NoteImageRecord, targetDocId: string): NoteImageRecord {
	const target = parseDocId(targetDocId);
	return {
		...image,
		docId: targetDocId,
		sourceWorkspaceId: target.workspaceId,
		sourceNoteId: target.noteId,
	};
}

function mergeRemoteImageCache(entries: readonly NoteImageRecord[]): readonly NoteImageRecord[] {
	const byId = new Map<string, NoteImageRecord>();
	for (const entry of entries) {
		byId.set(entry.id, entry);
	}
	return Array.from(byId.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function shouldPreserveMovedCache(docId: string): boolean {
	const graceUntil = movedCacheGraceUntil.get(docId) || 0;
	if (graceUntil > Date.now()) return true;
	movedCacheGraceUntil.delete(docId);
	return false;
}

function applyRemoteFileNameOverrides(images: readonly NoteImageRecord[]): NoteImageRecord[] {
	return images.map((image) => {
		if (image.fileName) return image;
		const override = remoteFileNameOverrides.get(image.id);
		return override ? { ...image, fileName: override } : image;
	});
}

function isOffline(): boolean {
	return shouldTreatConnectionAsOffline();
}

// Strict offline check: only blocks on a hard navigator.onLine=false.
// Uploads are allowed to run on slow/poor connections; they use dynamic timeouts
// and exponential backoff so they eventually succeed even at 128 kb/s.
function isBrowserOffline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine === false;
}

// Budget: ~100 KB/s (conservative for cellular connections).
// Min timeout: 90s. Max: 10 min. On slow links the flush will retry via follow-up.
function computeUploadTimeoutMs(byteSize: number): number {
	const budgetMs = Math.round((Math.max(0, byteSize) / (100 * 1024)) * 1000);
	return Math.max(90_000, Math.min(600_000, budgetMs + 30_000));
}

// Exclude queued uploads that already exist on the server (matched by remoteImageId
// or by fileName+byteSize fingerprint). This prevents double-counting when the upload
// succeeded but the queue entry hasn't been cleaned up yet (partial reconnect).
export function filterQueuedUploadsNotYetRemote(
	queuedRows: readonly QueuedNoteImageRow[],
	remoteImages: readonly NoteImageRecord[],
): QueuedNoteImageRow[] {
	if (queuedRows.length === 0) return [];
	if (remoteImages.length === 0) return [...queuedRows];
	const remoteIds = new Set(remoteImages.map((img) => img.id));
	const remoteKeys = new Set(
		remoteImages
			.filter((img) => img.fileName && img.byteSize > 0)
			.map((img) => `${img.fileName}:${img.byteSize}`)
	);
	return queuedRows.filter((row) => {
		if (row.remoteImageId && remoteIds.has(row.remoteImageId)) return false;
		const key = row.fileName && row.byteSize > 0 ? `${row.fileName}:${row.byteSize}` : null;
		return !(key && remoteKeys.has(key));
	});
}

export async function hasQueuedNoteImageUploads(userId: string): Promise<boolean> {
	if (!userId) return false;
	const rows = await readAllQueuedNoteImages(userId);
	return rows.some(isUploadRow);
}

// Returns the number of pending upload rows for a docId from the synchronous
// in-memory cache. Zero until warmQueuedImageCounts() has run or images are
// queued in the current session.
export function getQueuedNoteImageCount(docId: string): number {
	return queuedCountByDocId.get(docId) || 0;
}

// Hydrate the synchronous count cache from IDB at startup so NoteGrid can gate
// the chip row correctly on warm boot without waiting for chip mount effects.
export async function warmQueuedImageCounts(userId: string, docIds: readonly string[]): Promise<void> {
	if (!userId || docIds.length === 0) return;
	try {
		const allRows = await readAllQueuedNoteImages(userId);
		const uploadRows = allRows.filter(isUploadRow);
		const docIdSet = new Set(docIds.map((id) => String(id).trim()).filter(Boolean));
		const countsByDocId = new Map<string, number>();
		for (const row of uploadRows) {
			if (docIdSet.has(row.docId)) {
				countsByDocId.set(row.docId, (countsByDocId.get(row.docId) || 0) + 1);
			}
		}
		for (const [docId, count] of countsByDocId) {
			queuedCountByDocId.set(docId, count);
		}
	} catch {
		// Best-effort; chips will self-correct after mounting.
	}
}

// Exponential-backoff follow-up flush. Replaces any pending follow-up for this user.
// Resets backoff counter after a successful upload pass (noteFlushProgress).
function scheduleFlushFollowUp(userId: string, delayMs?: number): void {
	if (!userId) return;
	const existing = flushFollowUpTimers.get(userId);
	if (existing !== undefined) clearTimeout(existing);
	const currentBackoff = flushBackoffMs.get(userId) ?? FLUSH_BACKOFF_INITIAL_MS;
	const waitMs = delayMs ?? currentBackoff;
	const nextBackoff = Math.min(currentBackoff * 2, FLUSH_BACKOFF_MAX_MS);
	flushBackoffMs.set(userId, nextBackoff);
	const timer = setTimeout(() => {
		flushFollowUpTimers.delete(userId);
		void scheduleQueuedNoteImageFlush(userId);
	}, waitMs);
	flushFollowUpTimers.set(userId, timer);
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
					// v4: sourceUrl field added — no index needed, existing rows get null implicitly.
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
		// Keep source proportions while downscaling so offline previews preserve
		// the original composition instead of stretching/cropping unexpectedly.
		const maxDimension = 400;
		const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
		const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
		const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) return null;
		context.drawImage(image, 0, 0, width, height);

		// Progressive quality fallback keeps tiles sharp enough for note scanning
		// while staying small enough for reliable offline cache + sync behavior.
		const qualities = [0.55, 0.48, 0.4];
		let fallbackBlob: Blob | null = null;
		for (const quality of qualities) {
			const nextBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
			if (!nextBlob) continue;
			fallbackBlob = nextBlob;
			if (nextBlob.size <= 50 * 1024) return nextBlob;
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
			previewVersion: existing?.previewVersion || NOTE_MEDIA_PREVIEW_VERSION,
			createdAt: existing?.createdAt || image.createdAt,
			updatedAt: image.updatedAt,
		};
	});
	await upsertPreviewRows(baseRows);

	const pendingThumbnailImages = images.filter((image) => {
		const existing = existingById.get(image.id);
		if (!existing?.thumbnailBlob) return true;
		if (existing.previewVersion !== NOTE_MEDIA_PREVIEW_VERSION) return true;
		const existingThumbUrl = existing.image?.thumbnailUrl || '';
		const existingOriginalUrl = existing.image?.originalUrl || '';
		return existingThumbUrl !== image.thumbnailUrl || existingOriginalUrl !== image.originalUrl;
	});
	if (pendingThumbnailImages.length === 0) return;

	let storedThumbnail = false;
	const resolvedRows: StoredNoteImagePreviewRecord[] = [];
	for (const image of pendingThumbnailImages) {
		const sourceBlob = (await fetchBlob(image.thumbnailUrl)) || (await fetchBlob(image.originalUrl));
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
			previewVersion: NOTE_MEDIA_PREVIEW_VERSION,
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

async function promoteQueuedPreviewRow(docId: string, queuedRowId: string, image: NoteImageRecord): Promise<void> {
	if (!docId || !queuedRowId || !image.id) return;
	try {
		const existingRows = await readPreviewRowsByDoc(docId);
		const queuedPreview = existingRows.find((row) => row.id === queuedRowId && row.kind === 'queued');
		await upsertPreviewRows([
			{
				id: image.id,
				kind: 'remote',
				docId,
				remoteImageId: image.id,
				image,
				thumbnailBlob: queuedPreview?.thumbnailBlob || null,
				previewVersion: NOTE_MEDIA_PREVIEW_VERSION,
				createdAt: queuedPreview?.createdAt || image.createdAt,
				updatedAt: image.updatedAt,
			},
		]);
		await deletePreviewRows([queuedRowId]).catch(() => undefined);
	} catch {
		// Best effort only.
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
			previewVersion: NOTE_MEDIA_PREVIEW_VERSION,
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
	return applyRemoteFileNameOverrides(rows
		.filter((row) => row.kind === 'remote' && row.image)
		.map((row) => row.image as NoteImageRecord)
		.sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
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
	fileNames?: readonly string[];
}): Promise<QueuedNoteImageRow[]> {
	const userId = String(args.userId || '').trim();
	const docId = String(args.docId || '').trim();
	if (!userId || !docId || args.files.length === 0) return [];
	const createdAt = nowIso();
	const rows = args.files.map((file, index) => ({
		id: createId('note-image'),
		userId,
		docId,
		operationType: 'upload' as const,
		remoteImageId: null,
		fileName: String(args.fileNames?.[index] || file.name || 'image').trim() || 'image',
		mimeType: file.type || 'application/octet-stream',
		byteSize: file.size,
		blob: file,
		sourceUrl: null,
		createdAt,
		updatedAt: createdAt,
		syncStatus: 'pending' as const,
		lastError: null,
	}));
	await upsertQueuedRows(rows);
	await Promise.all(rows.map((row, index) => storeQueuedPreviewRow(docId, row.id, args.files[index], createdAt).catch(() => undefined)));
	// Update synchronous count cache immediately so NoteGrid can mount the chip
	// row on the next render without waiting for the IDB async round-trip.
	queuedCountByDocId.set(docId, (queuedCountByDocId.get(docId) || 0) + rows.length);
	emitNoteMediaChanged(docId);
	void requestPwaBackgroundSync();
	await scheduleQueuedNoteImageFlush(userId);
	return rows;
}

export async function queueNoteImageUrlForImport(args: {
	userId: string;
	docId: string;
	imageUrl: string;
}): Promise<QueuedNoteImageRow | null> {
	const userId = String(args.userId || '').trim();
	const docId = String(args.docId || '').trim();
	const imageUrl = String(args.imageUrl || '').trim();
	if (!userId || !docId || !imageUrl) return null;
	const createdAt = nowIso();
	const row: QueuedNoteImageRow = {
		id: createId('note-image-url'),
		userId,
		docId,
		operationType: 'import-url',
		remoteImageId: null,
		fileName: null,
		mimeType: null,
		byteSize: 0,
		blob: null,
		sourceUrl: imageUrl,
		createdAt,
		updatedAt: createdAt,
		syncStatus: 'pending',
		lastError: null,
	};
	await upsertQueuedRows([row]);
	emitNoteMediaChanged(docId);
	void requestPwaBackgroundSync();
	await scheduleQueuedNoteImageFlush(userId);
	return row;
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
		sourceUrl: null,
		createdAt,
		updatedAt: createdAt,
		syncStatus: 'pending',
		lastError: null,
	};
	await upsertQueuedRows([row]);
	removeRemoteImageFromCache(docId, imageId);
	await deletePreviewRows([imageId]).catch(() => undefined);
	emitNoteMediaChanged(docId);
	void requestPwaBackgroundSync();
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

export async function moveLocalNoteMedia(sourceDocId: string, targetDocId: string, userId?: string | null): Promise<void> {
	const source = String(sourceDocId || '').trim();
	const target = String(targetDocId || '').trim();
	const normalizedUserId = String(userId || '').trim();
	if (!source || !target || source === target) return;

	try {
		// Migrate both preview rows and queued uploads so the destination note can
		// keep rendering local image state even while offline or mid-sync.
		const previewRows = await readPreviewRowsByDoc(source);
		if (previewRows.length > 0) {
			await upsertPreviewRows(previewRows.map((row) => ({
				...row,
				docId: target,
				image: row.image ? rewriteNoteImageDocId(row.image, target) : null,
			})));
		}

		if (normalizedUserId) {
			const queuedRows = await readAllQueuedNoteImages(normalizedUserId);
			const sourceQueuedRows = queuedRows.filter((row) => row.docId === source);
			if (sourceQueuedRows.length > 0) {
				await upsertQueuedRows(sourceQueuedRows.map((row) => ({
					...row,
					docId: target,
					updatedAt: nowIso(),
				})));
			}
		}
	} catch {
		// Best effort only; server-backed refresh can still repair caches later.
	}

	// Mirror the IndexedDB move in the in-memory caches so subscribed UIs update
	// immediately without waiting for a reload.
	const sourceRefreshAt = remoteRefreshTimestamps.get(source);
	const migratedSourceCache = (remoteCache.get(source) || []).map((image) => rewriteNoteImageDocId(image, target));
	const existingTargetCache = remoteCache.get(target) || [];
	if (migratedSourceCache.length > 0 || existingTargetCache.length > 0) {
		remoteCache.set(target, mergeRemoteImageCache([...existingTargetCache, ...migratedSourceCache]));
	}
	movedCacheGraceUntil.set(target, Date.now() + MOVE_CACHE_GRACE_MS);
	remoteCache.delete(source);
	remoteRefreshTimestamps.delete(source);
	const targetRefreshAt = remoteRefreshTimestamps.get(target);
	if (typeof sourceRefreshAt === 'number') {
		remoteRefreshTimestamps.set(target, Math.max(targetRefreshAt || 0, sourceRefreshAt));
	}
	emitNoteMediaChanged(source);
	emitNoteMediaChanged(target);
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
		if (docId) {
			const next = Math.max(0, (queuedCountByDocId.get(docId) || 0) - 1);
			if (next === 0) queuedCountByDocId.delete(docId);
			else queuedCountByDocId.set(docId, next);
			emitNoteMediaChanged(docId);
		}
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
		try {
			const response = await listNoteImages(docId);
			const cachedImages = remoteCache.get(docId) || await readStoredRemoteNoteImages(docId);
			const preserveMovedCache = shouldPreserveMovedCache(docId) && cachedImages.length > 0;
			const fetchedImages = applyRemoteFileNameOverrides(response.images);
			const images = preserveMovedCache
				? applyRemoteFileNameOverrides(mergeRemoteImageCache([...cachedImages, ...fetchedImages]))
				: fetchedImages;
			if (preserveMovedCache) {
				const cachedIds = new Set(cachedImages.map((image) => image.id));
				const fetchedIds = new Set(fetchedImages.map((image) => image.id));
				const serverCaughtUp = cachedIds.size === 0 || Array.from(cachedIds).every((id) => fetchedIds.has(id));
				if (serverCaughtUp) {
					movedCacheGraceUntil.delete(docId);
				}
			}
			remoteCache.set(docId, images);
			remoteRefreshTimestamps.set(docId, Date.now());
			void syncRemotePreviewRows(docId, images);
			return images;
		} catch (error) {
			if (isMissingAccessError(error)) {
				const preserved = remoteCache.get(docId) || await readStoredRemoteNoteImages(docId);
				if (preserved.length > 0) {
					remoteCache.set(docId, preserved);
					return preserved;
				}
				// Note may not exist server-side yet (offline-created note awaiting sync).
				// Do NOT wipe IDB preview rows or emit a changed event — wiping would destroy
				// queued-upload thumbnail blobs and emit would trigger an infinite refresh loop.
				remoteCache.set(docId, []);
				return [];
			}
			throw error;
		}
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

export async function warmWorkspaceImageMetadata(
	docIds: readonly string[],
	options: { onlineRefreshLimit?: number; minIntervalMs?: number } = {}
): Promise<void> {
	const uniqueDocIds = [...new Set(docIds.map((docId) => String(docId || '').trim()).filter(Boolean))];
	if (uniqueDocIds.length === 0) return;
	await Promise.all(uniqueDocIds.map(async (docId) => {
		const stored = await readStoredRemoteNoteImages(docId);
		if (stored.length > 0) {
			remoteCache.set(docId, stored);
		}
	}));
	if (isOffline()) return;
	const refreshLimit = Math.max(0, Math.min(uniqueDocIds.length, options.onlineRefreshLimit ?? 24));
	const minIntervalMs = Math.max(0, Number(options.minIntervalMs ?? 1500) || 0);
	for (let start = 0; start < refreshLimit; start += 4) {
		const batch = uniqueDocIds.slice(start, start + 4);
		await Promise.all(batch.map((docId) => refreshRemoteNoteImages(docId, { minIntervalMs }).catch(() => [])));
	}
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
		}, FLUSH_DEBOUNCE_MS);
		flushTimers.set(userId, timer);
	});
	await flushQueuedNoteImages(userId);
}

export async function flushQueuedNoteImages(userId: string): Promise<void> {
	// Use strict navigator.onLine check so uploads proceed on slow/poor connections.
	if (!userId || isBrowserOffline()) return;
	if (pendingFlushes.has(userId)) {
		await pendingFlushes.get(userId);
		return;
	}
	const work = (async () => {
		const rows = await readAllQueuedNoteImages(userId);

		// Reset all previously-failed upload rows to 'pending' so they are retried
		// in this pass. The failed state is only a transient UI hint; auto-retry is
		// the source of truth for true offline-first behavior.
		const failedUploadRows = rows.filter((r) => r.syncStatus === 'failed' && isUploadRow(r));
		if (failedUploadRows.length > 0) {
			await upsertQueuedRows(failedUploadRows.map((r) => ({
				...r,
				syncStatus: 'pending' as const,
				lastError: null,
				updatedAt: nowIso(),
			})));
		}

		const touchedDocIds = new Set<string>();
		let anySucceeded = false;
		let anyRetryable = false;

		for (const row of rows) {
			if (isBrowserOffline()) break;
			try {
				if (row.operationType === 'delete') {
					if (row.remoteImageId) {
						await deleteNoteImage(row.remoteImageId);
						removeRemoteImageFromCache(row.docId, row.remoteImageId);
						await deletePreviewRows([row.remoteImageId]).catch(() => undefined);
					}
					await updateQueuedRow(row.id, () => null);
					const dNext = Math.max(0, (queuedCountByDocId.get(row.docId) || 0) - 1);
					if (dNext === 0) queuedCountByDocId.delete(row.docId);
					else queuedCountByDocId.set(row.docId, dNext);
					touchedDocIds.add(row.docId);
					anySucceeded = true;
				} else if (row.operationType === 'import-url') {
					if (!row.sourceUrl) throw new Error('Import-URL payload is missing');
					await importNoteImageUrl(row.docId, row.sourceUrl);
					await updateQueuedRow(row.id, () => null);
					const iNext = Math.max(0, (queuedCountByDocId.get(row.docId) || 0) - 1);
					if (iNext === 0) queuedCountByDocId.delete(row.docId);
					else queuedCountByDocId.set(row.docId, iNext);
					touchedDocIds.add(row.docId);
					anySucceeded = true;
				} else {
					if (!row.blob) throw new Error('Upload payload is missing');
					const file = new File([row.blob], row.fileName || 'image', {
						type: row.mimeType || row.blob.type || 'application/octet-stream',
					});
					const timeoutMs = computeUploadTimeoutMs(row.byteSize);
					const response = await uploadNoteImages(row.docId, [file], { timeoutMs });
					const uploadedImages = applyRemoteFileNameOverrides(response.images);
					if (uploadedImages.length > 0) {
						remoteCache.set(
							row.docId,
							mergeRemoteImageCache([...(remoteCache.get(row.docId) || []), ...uploadedImages]),
						);
					}
					for (const image of uploadedImages) {
						if (!image.fileName && row.fileName) {
							remoteFileNameOverrides.set(image.id, row.fileName);
						}
						await promoteQueuedPreviewRow(row.docId, row.id, image);
					}
					await updateQueuedRow(row.id, () => null);
					const uNext = Math.max(0, (queuedCountByDocId.get(row.docId) || 0) - 1);
					if (uNext === 0) queuedCountByDocId.delete(row.docId);
					else queuedCountByDocId.set(row.docId, uNext);
					touchedDocIds.add(row.docId);
					anySucceeded = true;
				}
			} catch (error) {
				touchedDocIds.add(row.docId);
				if (isMissingAccessError(error)) {
					// Note not yet on server (offline-created note awaiting sync).
					// Keep row pending and retry soon after the note sync completes.
					await updateQueuedRow(row.id, (current) => ({
						...current,
						syncStatus: 'pending' as const,
						lastError: null,
						updatedAt: nowIso(),
					}));
					scheduleFlushFollowUp(userId, FLUSH_ACCESS_RETRY_MS);
					anyRetryable = true;
				} else {
					// Transient network/timeout error — mark failed for UI feedback,
					// then schedule a follow-up that will reset it back to pending.
					await updateQueuedRow(row.id, (current) => ({
						...current,
						updatedAt: nowIso(),
						syncStatus: 'failed' as const,
						lastError: error instanceof Error ? error.message : 'Upload failed',
					}));
					anyRetryable = true;
				}
			}
		}

		// Batch remote refresh + UI notification once per touched note (not per row).
		await Promise.all(
			Array.from(touchedDocIds).map((docId) =>
				refreshRemoteNoteImages(docId).catch(() => undefined)
			)
		);
		for (const docId of touchedDocIds) {
			emitNoteMediaChanged(docId);
		}

		if (anySucceeded) {
			// Reset backoff after at least one image succeeded.
			flushBackoffMs.delete(userId);
		}

		// If rows remain (failed, pending-403, or new arrivals), schedule a follow-up
		// flush with exponential backoff so uploads complete without user intervention.
		if (anyRetryable || await hasQueuedNoteImageUploads(userId)) {
			scheduleFlushFollowUp(userId);
		}
	})();
	pendingFlushes.set(userId, work);
	try {
		await work;
	} finally {
		pendingFlushes.delete(userId);
	}
}