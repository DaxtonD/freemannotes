import {
	deleteNoteDocument,
	listNoteDocuments,
	NoteDocumentApiError,
	uploadNoteDocuments,
	type NoteDocumentRecord,
} from './noteDocumentApi';
import { requestPwaBackgroundSync } from './pwa';

// Offline-first document store:
// - caches the server's document list per note (IndexedDB + memory)
// - keeps a copy of each document's file on the device once fetched
// - queues uploads AND deletes in IndexedDB so both work offline and replay on reconnect
// - exposes one merged view (queued uploads + server list − pending deletes) to the UI

const NOTE_DOCUMENT_CHANGED_EVENT = 'freemannotes:note-documents-changed';

/** Mirrors the server's per-file limit (MAX_DOCUMENT_FILE_BYTES in noteMediaRouter.js). */
export const NOTE_DOCUMENT_MAX_FILE_BYTES = 40 * 1024 * 1024;

/** Mirrors SUPPORTED_NOTE_DOCUMENT_EXTENSIONS in server/noteDocumentPreview.js. */
export const NOTE_DOCUMENT_EXTENSIONS: readonly string[] = [
	'pdf',
	'doc', 'docx', 'odt', 'rtf',
	'xls', 'xlsx', 'ods', 'csv',
	'ppt', 'pptx', 'odp',
	'txt', 'md',
];

const NOTE_DOCUMENT_MIME_EXTENSIONS: Record<string, string> = {
	'application/pdf': 'pdf',
	'application/msword': 'doc',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
	'application/vnd.oasis.opendocument.text': 'odt',
	'application/rtf': 'rtf',
	'text/rtf': 'rtf',
	'application/vnd.ms-excel': 'xls',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
	'application/vnd.oasis.opendocument.spreadsheet': 'ods',
	'text/csv': 'csv',
	'application/vnd.ms-powerpoint': 'ppt',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
	'application/vnd.oasis.opendocument.presentation': 'odp',
	'text/plain': 'txt',
	'text/markdown': 'md',
	'text/x-markdown': 'md',
};

// Extensions for desktop pickers, MIME types for Android's picker (which greys out
// files it can't map from an extension alone, .md being the usual casualty).
export const NOTE_DOCUMENT_ACCEPT = [
	...NOTE_DOCUMENT_EXTENSIONS.map((extension) => `.${extension}`),
	...Object.keys(NOTE_DOCUMENT_MIME_EXTENSIONS),
].join(',');

export function getNoteDocumentExtension(fileName: string, mimeType = ''): string {
	const name = String(fileName || '');
	const dot = name.lastIndexOf('.');
	const fromName = dot > 0 ? name.slice(dot + 1).trim().toLowerCase() : '';
	if (fromName) return fromName;
	return NOTE_DOCUMENT_MIME_EXTENSIONS[String(mimeType || '').toLowerCase()] || '';
}

export function isSupportedNoteDocumentFile(file: { name: string; type: string }): boolean {
	return NOTE_DOCUMENT_EXTENSIONS.includes(getNoteDocumentExtension(file.name, file.type));
}

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
	permanentFailure?: boolean;
};

type QueuedNoteDocumentDeleteRow = {
	/** The server document id being deleted. */
	id: string;
	userId: string;
	docId: string;
	createdAt: string;
};

type StoredRemoteNoteDocumentAssetRow = {
	id: string;
	docId: string;
	document: NoteDocumentRecord | null;
	blob: Blob | null;
	originalUrl: string;
	createdAt: string;
	updatedAt: string;
};

const DB_NAME = 'freemannotes.note-documents.v1';
// v4: drops the device-only markup store (markup never synced; it comes back later as
// Yjs data) and adds the delete queue.
const DB_VERSION = 4;
const NOTE_DOCUMENT_QUEUE_STORE = 'note_document_queue';
const NOTE_DOCUMENT_CACHE_STORE = 'note_document_cache';
const NOTE_DOCUMENT_REMOTE_ASSET_STORE = 'note_document_remote_asset';
const NOTE_DOCUMENT_DELETE_QUEUE_STORE = 'note_document_delete_queue';
const LEGACY_NOTE_DOCUMENT_ANNOTATION_STORE = 'note_document_annotation';

// Right after a note moves workspaces, the server can briefly answer "no documents" for
// the new room before its rows catch up. Inside this window an empty answer doesn't wipe
// what the move just carried over. Outside it, an empty list from a successful request is
// the truth — otherwise deleting the last document on one device never reaches another.
const MOVE_EMPTY_LIST_GRACE_MS = 15_000;

const remoteCache = new Map<string, readonly NoteDocumentRecord[]>();
const queuedCache = new Map<string, readonly NoteDocumentRecord[]>();
const pendingDeleteIds = new Map<string, Set<string>>();
const recentMoveTargets = new Map<string, number>();
const pendingRefreshes = new Map<string, Promise<readonly NoteDocumentRecord[]>>();
const pendingFlushes = new Map<string, Promise<void>>();
const flushTimers = new Map<string, number>();
const objectUrlCache = new Map<string, string>();

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

function rewriteNoteDocumentDocId(document: NoteDocumentRecord, targetDocId: string): NoteDocumentRecord {
	const target = parseDocId(targetDocId);
	return {
		...document,
		docId: targetDocId,
		sourceWorkspaceId: target.workspaceId,
		sourceNoteId: target.noteId,
	};
}

function mergeNoteDocumentCache(entries: readonly NoteDocumentRecord[]): readonly NoteDocumentRecord[] {
	const byId = new Map<string, NoteDocumentRecord>();
	for (const entry of entries) {
		byId.set(entry.id, entry);
	}
	return Array.from(byId.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

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
				if (!db.objectStoreNames.contains(NOTE_DOCUMENT_REMOTE_ASSET_STORE)) {
					const store = db.createObjectStore(NOTE_DOCUMENT_REMOTE_ASSET_STORE, { keyPath: 'id' });
					store.createIndex('docId', 'docId', { unique: false });
				} else {
					const store = request.transaction?.objectStore(NOTE_DOCUMENT_REMOTE_ASSET_STORE);
					if (store && !store.indexNames.contains('docId')) {
						store.createIndex('docId', 'docId', { unique: false });
					}
				}
				if (!db.objectStoreNames.contains(NOTE_DOCUMENT_DELETE_QUEUE_STORE)) {
					const store = db.createObjectStore(NOTE_DOCUMENT_DELETE_QUEUE_STORE, { keyPath: 'id' });
					store.createIndex('userId', 'userId', { unique: false });
				}
				if (db.objectStoreNames.contains(LEGACY_NOTE_DOCUMENT_ANNOTATION_STORE)) {
					db.deleteObjectStore(LEGACY_NOTE_DOCUMENT_ANNOTATION_STORE);
				}
			};
			request.onsuccess = () => {
				const db = request.result;
				// Another tab upgrading the database has to be able to get in; drop our
				// connection and reopen lazily on the next call.
				db.onversionchange = () => {
					db.close();
					dbPromise = null;
				};
				resolve(db);
			};
			request.onerror = () => {
				dbPromise = null;
				reject(request.error || new Error('IndexedDB open failed'));
			};
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

function toQueuedDocumentRecord(row: QueuedNoteDocumentRow): NoteDocumentRecord {
	const extension = getNoteDocumentExtension(row.fileName, row.mimeType) || 'doc';
	// Local queued documents borrow object URLs and generated placeholder art so they
	// can be browsed before the server has produced permanent preview assets.
	const originalUrl = ensureObjectUrl(row.id, row.blob);
	return {
		id: row.id,
		docId: row.docId,
		sourceWorkspaceId: '',
		sourceNoteId: '',
		versionCount: 1,
		latestVersionNumber: 1,
		conversionStatus: 'NOT_NEEDED',
		viewPdfUrl: null,
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
		isLocal: true,
		syncStatus: row.syncStatus === 'failed' ? 'failed' : 'queued',
		lastSyncError: row.lastError,
		syncPermanentFailure: row.permanentFailure === true,
	};
}

function mergeDocuments(docId: string): readonly NoteDocumentRecord[] {
	const deleting = pendingDeleteIds.get(docId);
	const remote = (remoteCache.get(docId) || []).filter((document) => !deleting || !deleting.has(document.id));
	const queued = queuedCache.get(docId) || [];
	return [...remote, ...queued];
}

async function writeStoredRemoteDocuments(
	docId: string,
	documents: readonly NoteDocumentRecord[],
	options: { emitChange?: boolean } = {}
): Promise<void> {
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
	if (options.emitChange !== false) {
		emitNoteDocumentsChanged(docId);
	}
}

async function upsertRemoteAssetRows(rows: readonly StoredRemoteNoteDocumentAssetRow[]): Promise<void> {
	if (rows.length === 0) return;
	const db = await openDb();
	const tx = db.transaction([NOTE_DOCUMENT_REMOTE_ASSET_STORE], 'readwrite');
	const store = tx.objectStore(NOTE_DOCUMENT_REMOTE_ASSET_STORE);
	for (const row of rows) {
		store.put(row);
	}
	await transactionToPromise(tx);
}

async function deleteRemoteAssetRows(ids: readonly string[]): Promise<void> {
	if (ids.length === 0) return;
	const db = await openDb();
	const tx = db.transaction([NOTE_DOCUMENT_REMOTE_ASSET_STORE], 'readwrite');
	const store = tx.objectStore(NOTE_DOCUMENT_REMOTE_ASSET_STORE);
	for (const id of ids) {
		store.delete(id);
	}
	await transactionToPromise(tx);
}

async function readRemoteAssetRowsByDoc(docId: string): Promise<StoredRemoteNoteDocumentAssetRow[]> {
	if (!docId) return [];
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_DOCUMENT_REMOTE_ASSET_STORE], 'readonly');
		const rows = (await requestToPromise(
			tx.objectStore(NOTE_DOCUMENT_REMOTE_ASSET_STORE).index('docId').getAll(docId)
		)) as StoredRemoteNoteDocumentAssetRow[];
		await transactionToPromise(tx);
		return Array.isArray(rows) ? rows : [];
	} catch {
		return [];
	}
}

async function readRemoteAssetRow(documentId: string): Promise<StoredRemoteNoteDocumentAssetRow | null> {
	if (!documentId) return null;
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_DOCUMENT_REMOTE_ASSET_STORE], 'readonly');
		const row = (await requestToPromise(tx.objectStore(NOTE_DOCUMENT_REMOTE_ASSET_STORE).get(documentId))) as StoredRemoteNoteDocumentAssetRow | undefined;
		await transactionToPromise(tx);
		return row || null;
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

async function syncRemoteNoteDocumentAssetRows(
	docId: string,
	documents: readonly NoteDocumentRecord[],
	options: { emitChange?: boolean } = {}
): Promise<void> {
	if (!docId) return;
	const existingRows = await readRemoteAssetRowsByDoc(docId);
	const existingById = new Map(existingRows.map((row) => [row.id, row]));
	const nextIds = new Set(documents.map((document) => document.id));
	const staleIds = existingRows.filter((row) => !nextIds.has(row.id)).map((row) => row.id);
	if (staleIds.length > 0) {
		await deleteRemoteAssetRows(staleIds);
	}

	const baseRows = documents.map((document) => {
		const existing = existingById.get(document.id);
		// A new version means a new file URL; the old bytes are no use for it.
		const sameFile = existing?.originalUrl === document.originalUrl;
		return {
			id: document.id,
			docId,
			document,
			blob: sameFile ? existing?.blob || null : null,
			originalUrl: document.originalUrl,
			createdAt: existing?.createdAt || document.createdAt,
			updatedAt: document.updatedAt,
		};
	});
	await upsertRemoteAssetRows(baseRows);
	if (isOffline()) return;

	// Keep a copy of every document on the device so it opens offline (plan decision D3).
	let storedBlob = false;
	const deleting = pendingDeleteIds.get(docId);
	for (const row of baseRows) {
		if (row.blob || (deleting && deleting.has(row.id))) continue;
		const blob = await fetchBlob(row.originalUrl);
		if (!blob) continue;
		await upsertRemoteAssetRows([{ ...row, blob }]);
		storedBlob = true;
	}
	if (storedBlob && options.emitChange !== false) {
		emitNoteDocumentsChanged(docId);
	}
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

async function readAllDeleteRows(userId: string): Promise<QueuedNoteDocumentDeleteRow[]> {
	if (!userId) return [];
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_DOCUMENT_DELETE_QUEUE_STORE], 'readonly');
		const rows = (await requestToPromise(
			tx.objectStore(NOTE_DOCUMENT_DELETE_QUEUE_STORE).index('userId').getAll(userId)
		)) as QueuedNoteDocumentDeleteRow[];
		await transactionToPromise(tx);
		return Array.isArray(rows) ? rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt)) : [];
	} catch {
		return [];
	}
}

async function writeDeleteRows(rows: readonly QueuedNoteDocumentDeleteRow[]): Promise<void> {
	if (rows.length === 0) return;
	const db = await openDb();
	const tx = db.transaction([NOTE_DOCUMENT_DELETE_QUEUE_STORE], 'readwrite');
	const store = tx.objectStore(NOTE_DOCUMENT_DELETE_QUEUE_STORE);
	for (const row of rows) {
		store.put(row);
	}
	await transactionToPromise(tx);
}

async function removeDeleteRow(documentId: string): Promise<void> {
	const db = await openDb();
	const tx = db.transaction([NOTE_DOCUMENT_DELETE_QUEUE_STORE], 'readwrite');
	tx.objectStore(NOTE_DOCUMENT_DELETE_QUEUE_STORE).delete(documentId);
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

/** Everything the UI should show for a note right now: server list minus pending deletes, plus queued uploads. */
export function getCachedNoteDocuments(docId: string): readonly NoteDocumentRecord[] {
	return mergeDocuments(docId);
}

export function getCachedRemoteNoteDocuments(docId: string): readonly NoteDocumentRecord[] {
	return getCachedNoteDocuments(docId);
}

/** True once this note's server list is in memory (fetched or read from IndexedDB) this session. */
export function hasCachedRemoteNoteDocuments(docId: string): boolean {
	return remoteCache.has(docId);
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

/** Loads this user's queued deletes for a note into memory so the merged view hides them. */
export async function readQueuedNoteDocumentDeletions(userId: string, docId: string): Promise<readonly string[]> {
	if (!userId || !docId) return Array.from(pendingDeleteIds.get(docId) || []);
	const rows = (await readAllDeleteRows(userId)).filter((row) => row.docId === docId);
	const ids = rows.map((row) => row.id);
	pendingDeleteIds.set(docId, new Set(ids));
	return ids;
}

export async function moveLocalNoteDocuments(sourceDocId: string, targetDocId: string, userId?: string | null): Promise<void> {
	const source = String(sourceDocId || '').trim();
	const target = String(targetDocId || '').trim();
	const normalizedUserId = String(userId || '').trim();
	if (!source || !target || source === target) return;
	recentMoveTargets.set(target, Date.now());

	try {
		// Move the cached list, the stored file copies, and both queues together so
		// documents (and anything waiting to sync) survive a workspace move offline.
		const [sourceRemoteDocuments, sourceRemoteAssetRows] = await Promise.all([
			readStoredRemoteNoteDocuments(source),
			readRemoteAssetRowsByDoc(source),
		]);
		if (sourceRemoteDocuments.length > 0) {
			await writeStoredRemoteDocuments(
				target,
				mergeNoteDocumentCache([
					...(await readStoredRemoteNoteDocuments(target)),
					...sourceRemoteDocuments.map((document) => rewriteNoteDocumentDocId(document, target)),
				]),
				{ emitChange: false }
			);
		}
		await writeStoredRemoteDocuments(source, [], { emitChange: false });
		if (sourceRemoteAssetRows.length > 0) {
			await upsertRemoteAssetRows(sourceRemoteAssetRows.map((row) => ({
				...row,
				docId: target,
				document: row.document ? rewriteNoteDocumentDocId(row.document, target) : null,
			})));
		}

		if (normalizedUserId) {
			const queuedRows = await readAllQueuedRows(normalizedUserId);
			const sourceQueuedRows = queuedRows.filter((row) => row.docId === source);
			if (sourceQueuedRows.length > 0) {
				await writeQueuedRows(sourceQueuedRows.map((row) => ({
					...row,
					docId: target,
					updatedAt: nowIso(),
				})));
			}
			const deleteRows = await readAllDeleteRows(normalizedUserId);
			const sourceDeleteRows = deleteRows.filter((row) => row.docId === source);
			if (sourceDeleteRows.length > 0) {
				await writeDeleteRows(sourceDeleteRows.map((row) => ({ ...row, docId: target })));
			}
		}
	} catch {
		// Best effort only; later remote refresh can repopulate document caches.
	}

	// Update the live caches after the IndexedDB move so open panels do not keep
	// pointing at the source doc after the workspace switch completes.
	const movedRemoteCache = (remoteCache.get(source) || []).map((document) => rewriteNoteDocumentDocId(document, target));
	const movedQueuedCache = (queuedCache.get(source) || []).map((document) => rewriteNoteDocumentDocId(document, target));
	const targetRemoteCache = remoteCache.get(target) || [];
	const targetQueuedCache = queuedCache.get(target) || [];
	if (movedRemoteCache.length > 0 || targetRemoteCache.length > 0) {
		remoteCache.set(target, mergeNoteDocumentCache([...targetRemoteCache, ...movedRemoteCache]));
	}
	if (movedQueuedCache.length > 0 || targetQueuedCache.length > 0) {
		queuedCache.set(target, mergeNoteDocumentCache([...targetQueuedCache, ...movedQueuedCache]));
	}
	const movedDeletes = pendingDeleteIds.get(source);
	if (movedDeletes && movedDeletes.size > 0) {
		pendingDeleteIds.set(target, new Set([...(pendingDeleteIds.get(target) || []), ...movedDeletes]));
	}
	remoteCache.delete(source);
	queuedCache.delete(source);
	pendingDeleteIds.delete(source);
	emitNoteDocumentsChanged(source);
	emitNoteDocumentsChanged(target);
}

export async function readQueuedNoteDocumentBlob(documentId: string): Promise<Blob | null> {
	if (!documentId) return null;
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_DOCUMENT_QUEUE_STORE], 'readonly');
		const row = (await requestToPromise(tx.objectStore(NOTE_DOCUMENT_QUEUE_STORE).get(documentId))) as QueuedNoteDocumentRow | undefined;
		await transactionToPromise(tx);
		return row?.blob || null;
	} catch {
		return null;
	}
}

export async function readStoredRemoteNoteDocumentBlob(documentId: string): Promise<Blob | null> {
	const row = await readRemoteAssetRow(documentId);
	return row?.blob || null;
}

/** The document's file from this device if we have it, otherwise fetched (and kept). Null when offline and not stored. */
export async function resolveNoteDocumentBlob(document: NoteDocumentRecord): Promise<Blob | null> {
	if (!document || !document.id) return null;
	if (document.isLocal) return readQueuedNoteDocumentBlob(document.id);
	const cachedRow = await readRemoteAssetRow(document.id);
	if (cachedRow?.blob && cachedRow.originalUrl === document.originalUrl) return cachedRow.blob;
	const blob = await fetchBlob(document.originalUrl);
	if (!blob) return null;
	await upsertRemoteAssetRows([
		{
			id: document.id,
			docId: document.docId,
			document,
			blob,
			originalUrl: document.originalUrl,
			createdAt: document.createdAt,
			updatedAt: document.updatedAt,
		},
	]).catch(() => undefined);
	return blob;
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
		const extension = getNoteDocumentExtension(file.name, file.type);
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
	queuedCache.set(docId, [...(queuedCache.get(docId) || []), ...queuedDocuments]);
	emitNoteDocumentsChanged(docId);
	void requestPwaBackgroundSync();
	// Not awaited: the rows are already safe in IndexedDB and on screen. Waiting here would
	// hold the caller until a 40 MB upload finishes.
	void scheduleQueuedNoteDocumentFlush(userId);
	return queuedDocuments;
}

/** Deletes a document everywhere. Works offline: it disappears now and the delete replays on reconnect. */
export async function queueNoteDocumentDeletion(args: { userId: string; document: NoteDocumentRecord }): Promise<void> {
	const userId = String(args.userId || '').trim();
	const document = args.document;
	if (!userId || !document?.id) return;
	if (document.isLocal) {
		// Never reached the server, so there's nothing to delete there.
		await deleteQueuedNoteDocument(document.id);
		return;
	}
	const docId = document.docId;
	await writeDeleteRows([{ id: document.id, userId, docId, createdAt: nowIso() }]);
	const deleting = pendingDeleteIds.get(docId) || new Set<string>();
	deleting.add(document.id);
	pendingDeleteIds.set(docId, deleting);
	await deleteRemoteAssetRows([document.id]).catch(() => undefined);
	emitNoteDocumentsChanged(docId);
	void requestPwaBackgroundSync();
	void scheduleQueuedNoteDocumentFlush(userId);
}

/** Puts a failed upload back in line. */
export async function retryQueuedNoteDocument(userId: string, documentId: string): Promise<void> {
	if (!userId || !documentId) return;
	let docId = '';
	await updateQueuedRow(documentId, (current) => {
		docId = current.docId;
		return { ...current, syncStatus: 'pending', lastError: null, permanentFailure: false, updatedAt: nowIso() };
	});
	if (docId) {
		await readQueuedNoteDocuments(userId, docId);
		emitNoteDocumentsChanged(docId);
	}
	void scheduleQueuedNoteDocumentFlush(userId);
}

export async function refreshRemoteNoteDocuments(
	docId: string,
	options: { userId?: string | null; force?: boolean } = {}
): Promise<readonly NoteDocumentRecord[]> {
	if (!docId) return [];
	const userId = String(options.userId || '');
	if (isOffline()) {
		// When offline, explicitly rehydrate from caches instead of returning an empty list.
		// That keeps document panels useful after refreshes or reconnect failures.
		const [storedRemote, storedQueued] = await Promise.all([
			readStoredRemoteNoteDocuments(docId),
			userId ? readQueuedNoteDocuments(userId, docId) : Promise.resolve(queuedCache.get(docId) || []),
			userId ? readQueuedNoteDocumentDeletions(userId, docId) : Promise.resolve([]),
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
			const existingRemoteDocuments = remoteCache.get(docId) || await readStoredRemoteNoteDocuments(docId);
			const movedAt = recentMoveTargets.get(docId) || 0;
			const insideMoveGrace = Date.now() - movedAt < MOVE_EMPTY_LIST_GRACE_MS;
			if (!options.force && insideMoveGrace && response.documents.length === 0 && existingRemoteDocuments.length > 0) {
				remoteCache.set(docId, existingRemoteDocuments);
			} else {
				await writeStoredRemoteDocuments(docId, response.documents, { emitChange: false });
				void syncRemoteNoteDocumentAssetRows(docId, response.documents, { emitChange: false });
			}
			if (userId) {
				await Promise.all([
					readQueuedNoteDocuments(userId, docId),
					readQueuedNoteDocumentDeletions(userId, docId),
				]);
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

function errorStatus(error: unknown): number {
	return error instanceof NoteDocumentApiError ? error.status : 0;
}

export async function flushQueuedNoteDocuments(userId: string): Promise<void> {
	if (!userId || isOffline()) return;
	if (pendingFlushes.has(userId)) {
		await pendingFlushes.get(userId);
		return;
	}
	const work = (async () => {
		// Deletes first: if someone deleted a document and then uploaded a replacement
		// while offline, the note should never briefly end up with both.
		for (const row of await readAllDeleteRows(userId)) {
			if (isOffline()) return;
			try {
				await deleteNoteDocument(row.id);
			} catch (error) {
				const status = errorStatus(error);
				// No status = the network, not the server. Stop and try again next flush.
				if (!status) return;
				// 404: already gone. 403: this user can't delete it any more (lost edit
				// access), so drop the request and let the next refresh show the truth.
				// Anything else (a 500): leave it queued for the next flush.
				if (status !== 404 && status !== 403) continue;
			}
			await removeDeleteRow(row.id).catch(() => undefined);
			pendingDeleteIds.get(row.docId)?.delete(row.id);
			const remaining = (remoteCache.get(row.docId) || []).filter((document) => document.id !== row.id);
			await writeStoredRemoteDocuments(row.docId, remaining, { emitChange: false });
			emitNoteDocumentsChanged(row.docId);
		}

		// Uploads oldest-first so attachment order matches the order the user added them,
		// even if they queued several while offline. Rejected-for-good rows sit out until
		// the user retries or removes them.
		const rows = (await readAllQueuedRows(userId)).filter((row) => row.permanentFailure !== true);
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
				await refreshRemoteNoteDocuments(row.docId, { userId }).catch(() => undefined);
				emitNoteDocumentsChanged(row.docId);
			} catch (error) {
				const status = errorStatus(error);
				if (!status) {
					// Dropped connection or timeout mid-upload: it isn't the file's fault.
					// Leave it waiting and stop; the next flush picks it up.
					return;
				}
				// 400/413/415: the server looked at the file and said no. Retrying the same
				// bytes forever would just burn data. 403/404 (e.g. the note isn't on the
				// server yet) may sort itself out, so those keep retrying.
				const permanent = status === 400 || status === 413 || status === 415;
				await updateQueuedRow(row.id, (current) => ({
					...current,
					updatedAt: nowIso(),
					syncStatus: 'failed',
					lastError: error instanceof Error ? error.message : 'Upload failed',
					permanentFailure: permanent,
				})).catch(() => undefined);
				await readQueuedNoteDocuments(userId, row.docId);
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
