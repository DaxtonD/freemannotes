import { listNoteDocuments, uploadNoteDocuments, type NoteDocumentRecord } from './noteDocumentApi';

// Offline-first document store:
// - caches server documents per note
// - queues uploads in IndexedDB
// - exposes merged queued + remote views to the UI

const NOTE_DOCUMENT_CHANGED_EVENT = 'freemannotes:note-documents-changed';

type QueuedNoteDocumentRow = {
	id: string;
	userId: string;
	docId: string;
	fileName: string;
	mimeType: string;
	byteSize: number;
	blob: Blob;
	previewDataUrl: string;
	thumbnailDataUrl: string;
	createdAt: string;
	updatedAt: string;
	syncStatus: 'pending' | 'failed';
	lastError: string | null;
};

const DB_NAME = 'freemannotes.note-documents.v1';
const DB_VERSION = 1;
const NOTE_DOCUMENT_QUEUE_STORE = 'note_document_queue';
const NOTE_DOCUMENT_CACHE_STORE = 'note_document_cache';

const remoteCache = new Map<string, readonly NoteDocumentRecord[]>();
const queuedCache = new Map<string, readonly NoteDocumentRecord[]>();
const pendingRefreshes = new Map<string, Promise<readonly NoteDocumentRecord[]>>();
const pendingFlushes = new Map<string, Promise<void>>();
const flushTimers = new Map<string, number>();
const objectUrlCache = new Map<string, string>();

let dbPromise: Promise<IDBDatabase> | null = null;

function isOffline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function nowIso(): string {
	return new Date().toISOString();
}

function createId(prefix: string): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `${prefix}:${crypto.randomUUID()}`;
	}
	return `${prefix}:${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
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
				if (!db.objectStoreNames.contains(NOTE_DOCUMENT_QUEUE_STORE)) {
					const store = db.createObjectStore(NOTE_DOCUMENT_QUEUE_STORE, { keyPath: 'id' });
					store.createIndex('userId', 'userId', { unique: false });
					store.createIndex('userId_docId', ['userId', 'docId'], { unique: false });
				}
				if (!db.objectStoreNames.contains(NOTE_DOCUMENT_CACHE_STORE)) {
					const store = db.createObjectStore(NOTE_DOCUMENT_CACHE_STORE, { keyPath: 'docId' });
					store.createIndex('docId', 'docId', { unique: true });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
		});
	}
	return dbPromise;
}

function ensureObjectUrl(id: string, blob: Blob): string {
	const existing = objectUrlCache.get(id);
	if (existing) return existing;
	const created = URL.createObjectURL(blob);
	objectUrlCache.set(id, created);
	return created;
}

function revokeObjectUrl(id: string): void {
	const url = objectUrlCache.get(id);
	if (!url) return;
	URL.revokeObjectURL(url);
	objectUrlCache.delete(id);
}

function buildQueuedPreviewDataUrl(fileName: string, extension: string): string {
	const label = (extension || 'DOC').slice(0, 4).toUpperCase();
	const title = String(fileName || 'Document').slice(0, 48);
	const svg = `
		<svg width="960" height="1200" viewBox="0 0 960 1200" xmlns="http://www.w3.org/2000/svg">
			<rect width="960" height="1200" rx="72" fill="#f8fafc"/>
			<rect x="64" y="64" width="832" height="1072" rx="56" fill="#ffffff" stroke="#d9e2ec"/>
			<rect x="96" y="96" width="184" height="64" rx="32" fill="#1d4ed8"/>
			<text x="188" y="137" text-anchor="middle" font-family="Georgia, serif" font-size="30" font-weight="700" fill="#ffffff">${label}</text>
			<text x="96" y="258" font-family="Georgia, serif" font-size="36" font-weight="700" fill="#0f172a">${title
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')}</text>
			<text x="96" y="1016" font-family="Georgia, serif" font-size="24" fill="#64748b">Queued for upload</text>
		</svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function getFileExtension(fileName: string, mimeType: string): string {
	const raw = String(fileName || '').split('.').pop()?.trim().toLowerCase() || '';
	if (raw) return raw;
	if (mimeType === 'application/pdf') return 'pdf';
	return 'doc';
}

function toQueuedDocumentRecord(row: QueuedNoteDocumentRow): NoteDocumentRecord {
	const extension = getFileExtension(row.fileName, row.mimeType);
	// Local queued documents borrow object URLs and generated placeholder art so they
	// can be browsed before the server has produced permanent preview assets.
	const originalUrl = ensureObjectUrl(row.id, row.blob);
	return {
		id: row.id,
		docId: row.docId,
		sourceWorkspaceId: '',
		sourceNoteId: '',
		fileName: row.fileName,
		fileExtension: extension,
		mimeType: row.mimeType,
		byteSize: row.byteSize,
		pageCount: null,
		previewWidth: null,
		previewHeight: null,
		thumbnailWidth: null,
		thumbnailHeight: null,
		ocrStatus: 'PENDING',
		ocrText: '',
		ocrError: null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		originalUrl,
		previewUrl: row.previewDataUrl,
		thumbnailUrl: row.thumbnailDataUrl,
		viewerUrl: row.mimeType === 'application/pdf' ? originalUrl : '',
		isLocal: true,
		syncStatus: row.syncStatus === 'failed' ? 'failed' : 'queued',
		lastSyncError: row.lastError,
	};
}

function mergeDocuments(docId: string): readonly NoteDocumentRecord[] {
	const remote = remoteCache.get(docId) || [];
	const queued = queuedCache.get(docId) || [];
	return [...queued, ...remote];
}

async function writeStoredRemoteDocuments(docId: string, documents: readonly NoteDocumentRecord[]): Promise<void> {
	remoteCache.set(docId, documents.slice());
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_DOCUMENT_CACHE_STORE], 'readwrite');
		tx.objectStore(NOTE_DOCUMENT_CACHE_STORE).put({ docId, documents: documents.slice() });
		await transactionToPromise(tx);
	} catch {
		// Best effort cache only.
	}
	queuedCache.set(docId, queuedCache.get(docId) || []);
	emitNoteDocumentsChanged(docId);
}

async function readAllQueuedRows(userId: string): Promise<QueuedNoteDocumentRow[]> {
	if (!userId) return [];
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_DOCUMENT_QUEUE_STORE], 'readonly');
		const rows = (await requestToPromise(tx.objectStore(NOTE_DOCUMENT_QUEUE_STORE).index('userId').getAll(userId))) as QueuedNoteDocumentRow[];
		await transactionToPromise(tx);
		return Array.isArray(rows) ? rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt)) : [];
	} catch {
		return [];
	}
	}

async function writeQueuedRows(rows: readonly QueuedNoteDocumentRow[]): Promise<void> {
	if (rows.length === 0) return;
	const db = await openDb();
	const tx = db.transaction([NOTE_DOCUMENT_QUEUE_STORE], 'readwrite');
	const store = tx.objectStore(NOTE_DOCUMENT_QUEUE_STORE);
	for (const row of rows) {
		store.put(row);
	}
	await transactionToPromise(tx);
}

async function updateQueuedRow(id: string, updater: (current: QueuedNoteDocumentRow) => QueuedNoteDocumentRow | null): Promise<void> {
	const db = await openDb();
	const tx = db.transaction([NOTE_DOCUMENT_QUEUE_STORE], 'readwrite');
	const store = tx.objectStore(NOTE_DOCUMENT_QUEUE_STORE);
	const current = (await requestToPromise(store.get(id))) as QueuedNoteDocumentRow | undefined;
	if (!current) {
		await transactionToPromise(tx);
		return;
	}
	const next = updater(current);
	if (next) store.put(next);
	else store.delete(id);
	await transactionToPromise(tx);
}

export async function deleteQueuedNoteDocument(documentId: string): Promise<void> {
	if (!documentId) return;
	let docId = '';
	try {
		await updateQueuedRow(documentId, (current) => {
			docId = current.docId;
			return null;
		});
		revokeObjectUrl(documentId);
		if (docId) {
			const remaining = (queuedCache.get(docId) || []).filter((document) => document.id !== documentId);
			queuedCache.set(docId, remaining);
			emitNoteDocumentsChanged(docId);
		}
	} catch {
		// ignore
	}
}

export function getNoteDocumentsChangedEventName(): string {
	return NOTE_DOCUMENT_CHANGED_EVENT;
}

export function emitNoteDocumentsChanged(docId: string): void {
	if (!docId || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
	window.dispatchEvent(new CustomEvent(NOTE_DOCUMENT_CHANGED_EVENT, { detail: { docId } }));
}

export function getCachedNoteDocuments(docId: string): readonly NoteDocumentRecord[] {
	return mergeDocuments(docId);
}

export function getCachedRemoteNoteDocuments(docId: string): readonly NoteDocumentRecord[] {
	return getCachedNoteDocuments(docId);
}

export async function readStoredRemoteNoteDocuments(docId: string): Promise<readonly NoteDocumentRecord[]> {
	if (!docId) return [];
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_DOCUMENT_CACHE_STORE], 'readonly');
		const row = (await requestToPromise(tx.objectStore(NOTE_DOCUMENT_CACHE_STORE).get(docId))) as { docId: string; documents: NoteDocumentRecord[] } | undefined;
		await transactionToPromise(tx);
		const documents = Array.isArray(row?.documents) ? row.documents : [];
		remoteCache.set(docId, documents);
		return documents;
	} catch {
		return remoteCache.get(docId) || [];
	}
}

export async function readQueuedNoteDocuments(userId: string, docId: string): Promise<readonly NoteDocumentRecord[]> {
	if (!userId || !docId) return queuedCache.get(docId) || [];
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_DOCUMENT_QUEUE_STORE], 'readonly');
		const rows = (await requestToPromise(tx.objectStore(NOTE_DOCUMENT_QUEUE_STORE).index('userId_docId').getAll([userId, docId]))) as QueuedNoteDocumentRow[];
		await transactionToPromise(tx);
		const documents = Array.isArray(rows)
			? rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map(toQueuedDocumentRecord)
			: [];
		queuedCache.set(docId, documents);
		return documents;
	} catch {
		return queuedCache.get(docId) || [];
	}
}

export async function queueNoteDocumentsForUpload(args: {
	userId: string;
	docId: string;
	files: readonly File[];
}): Promise<readonly NoteDocumentRecord[]> {
	const userId = String(args.userId || '').trim();
	const docId = String(args.docId || '').trim();
	if (!userId || !docId || !Array.isArray(args.files) || args.files.length === 0) return [];
	const createdAt = nowIso();
	const rows: QueuedNoteDocumentRow[] = args.files.map((file) => {
		const extension = getFileExtension(file.name, file.type);
		const previewDataUrl = buildQueuedPreviewDataUrl(file.name, extension);
		return {
			id: createId('note-document'),
			userId,
			docId,
			fileName: file.name || 'document',
			mimeType: file.type || 'application/octet-stream',
			byteSize: file.size,
			blob: file,
			previewDataUrl,
			thumbnailDataUrl: previewDataUrl,
			createdAt,
			updatedAt: createdAt,
			syncStatus: 'pending',
			lastError: null,
		};
	});
	await writeQueuedRows(rows);
	const queuedDocuments = rows.map(toQueuedDocumentRecord);
	queuedCache.set(docId, [...queuedDocuments, ...(queuedCache.get(docId) || [])]);
	emitNoteDocumentsChanged(docId);
	await scheduleQueuedNoteDocumentFlush(userId);
	return queuedDocuments;
}

export async function refreshRemoteNoteDocuments(
	docId: string,
	options: { userId?: string | null; force?: boolean } = {}
): Promise<readonly NoteDocumentRecord[]> {
	if (!docId) return [];
	if (isOffline()) {
		// When offline, explicitly rehydrate from caches instead of returning an empty list.
		// That keeps document browsers useful after refreshes or reconnect failures.
		const [storedRemote, storedQueued] = await Promise.all([
			readStoredRemoteNoteDocuments(docId),
			options.userId ? readQueuedNoteDocuments(String(options.userId || ''), docId) : Promise.resolve(queuedCache.get(docId) || []),
		]);
		remoteCache.set(docId, storedRemote);
		queuedCache.set(docId, storedQueued);
		return mergeDocuments(docId);
	}
	const pending = pendingRefreshes.get(docId);
	if (pending) return pending;
	const request = (async () => {
		try {
			const response = await listNoteDocuments(docId);
			await writeStoredRemoteDocuments(docId, response.documents);
			if (options.userId) {
				await readQueuedNoteDocuments(String(options.userId || ''), docId);
			}
			return mergeDocuments(docId);
		} finally {
			pendingRefreshes.delete(docId);
		}
	})();
	pendingRefreshes.set(docId, request);
	return request;
}

export async function scheduleQueuedNoteDocumentFlush(userId: string): Promise<void> {
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
	await flushQueuedNoteDocuments(userId);
}

export async function flushQueuedNoteDocuments(userId: string): Promise<void> {
	if (!userId || isOffline()) return;
	if (pendingFlushes.has(userId)) {
		await pendingFlushes.get(userId);
		return;
	}
	const work = (async () => {
		// Flush oldest-first so attachment order is predictable and the UI converges on the
		// same ordering the user created, even if they uploaded several files while offline.
		const rows = await readAllQueuedRows(userId);
		for (const row of rows) {
			if (isOffline()) return;
			try {
				const file = new File([row.blob], row.fileName || 'document', {
					type: row.mimeType || row.blob.type || 'application/octet-stream',
				});
				await uploadNoteDocuments(row.docId, [file]);
				await updateQueuedRow(row.id, () => null);
				revokeObjectUrl(row.id);
				queuedCache.set(row.docId, (queuedCache.get(row.docId) || []).filter((document) => document.id !== row.id));
				await refreshRemoteNoteDocuments(row.docId, { userId });
				emitNoteDocumentsChanged(row.docId);
			} catch (error) {
				await updateQueuedRow(row.id, (current) => ({
					...current,
					updatedAt: nowIso(),
					syncStatus: 'failed',
					lastError: error instanceof Error ? error.message : 'Upload failed',
				}));
				const nextQueued = (await readQueuedNoteDocuments(userId, row.docId)).slice();
				queuedCache.set(row.docId, nextQueued);
				emitNoteDocumentsChanged(row.docId);
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