import { listNoteLinks, syncNoteLinks, type NoteLinkRecord } from './noteLinkApi';
import type { ExtractedNoteLink } from './noteLinks';

// Offline-aware link-preview store:
// - remembers resolved previews per note
// - snapshots pending sync input while offline
// - emits lightweight doc-scoped change events for cards and modals

type QueuedNoteLinkSnapshot = {
	id: string;
	userId: string;
	docId: string;
	links: ExtractedNoteLink[];
	updatedAt: string;
	lastError: string | null;
};

const DB_NAME = 'freemannotes.note-links.v1';
const DB_VERSION = 1;
const NOTE_LINK_QUEUE_STORE = 'note_link_queue';
const NOTE_LINK_CACHE_STORE = 'note_link_cache';
const NOTE_LINK_CHANGED_EVENT = 'freemannotes:note-links-changed';

let dbPromise: Promise<IDBDatabase> | null = null;
const remoteCache = new Map<string, readonly NoteLinkRecord[]>();
const pendingRefreshes = new Map<string, Promise<readonly NoteLinkRecord[]>>();
const pendingFlushes = new Map<string, Promise<void>>();

function isOffline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine === false;
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
				if (!db.objectStoreNames.contains(NOTE_LINK_QUEUE_STORE)) {
					const store = db.createObjectStore(NOTE_LINK_QUEUE_STORE, { keyPath: 'id' });
					store.createIndex('userId', 'userId', { unique: false });
					store.createIndex('userId_docId', ['userId', 'docId'], { unique: true });
				}
				if (!db.objectStoreNames.contains(NOTE_LINK_CACHE_STORE)) {
					const store = db.createObjectStore(NOTE_LINK_CACHE_STORE, { keyPath: 'docId' });
					store.createIndex('docId', 'docId', { unique: true });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
		});
	}
	return dbPromise;
}

export function getNoteLinksChangedEventName(): string {
	return NOTE_LINK_CHANGED_EVENT;
}

export function emitNoteLinksChanged(docId: string): void {
	if (!docId || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
	window.dispatchEvent(new CustomEvent(NOTE_LINK_CHANGED_EVENT, { detail: { docId } }));
}

async function writeQueuedSnapshot(row: QueuedNoteLinkSnapshot): Promise<void> {
	const db = await openDb();
	const tx = db.transaction([NOTE_LINK_QUEUE_STORE], 'readwrite');
	tx.objectStore(NOTE_LINK_QUEUE_STORE).put(row);
	await transactionToPromise(tx);
}

async function deleteQueuedSnapshot(id: string): Promise<void> {
	const db = await openDb();
	const tx = db.transaction([NOTE_LINK_QUEUE_STORE], 'readwrite');
	tx.objectStore(NOTE_LINK_QUEUE_STORE).delete(id);
	await transactionToPromise(tx);
}

async function readQueuedSnapshotsByUser(userId: string): Promise<QueuedNoteLinkSnapshot[]> {
	if (!userId) return [];
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_LINK_QUEUE_STORE], 'readonly');
		const rows = (await requestToPromise(tx.objectStore(NOTE_LINK_QUEUE_STORE).index('userId').getAll(userId))) as QueuedNoteLinkSnapshot[];
		await transactionToPromise(tx);
		return Array.isArray(rows) ? rows : [];
	} catch {
		return [];
	}
}

async function readQueuedSnapshot(userId: string, docId: string): Promise<QueuedNoteLinkSnapshot | null> {
	if (!userId || !docId) return null;
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_LINK_QUEUE_STORE], 'readonly');
		const row = (await requestToPromise(tx.objectStore(NOTE_LINK_QUEUE_STORE).index('userId_docId').get([userId, docId]))) as QueuedNoteLinkSnapshot | undefined;
		await transactionToPromise(tx);
		return row || null;
	} catch {
		return null;
	}
}

async function writeCachedLinks(docId: string, links: readonly NoteLinkRecord[], options: { emit?: boolean } = {}): Promise<void> {
	remoteCache.set(docId, links.slice());
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_LINK_CACHE_STORE], 'readwrite');
		tx.objectStore(NOTE_LINK_CACHE_STORE).put({ docId, links: links.slice() });
		await transactionToPromise(tx);
	} catch {
		// Best effort cache only.
	}
	if (options.emit && typeof window !== 'undefined') emitNoteLinksChanged(docId);
}

export function getCachedRemoteNoteLinks(docId: string): readonly NoteLinkRecord[] {
	return remoteCache.get(docId) || [];
}

export async function readStoredNoteLinks(docId: string): Promise<readonly NoteLinkRecord[]> {
	if (!docId) return [];
	try {
		const db = await openDb();
		const tx = db.transaction([NOTE_LINK_CACHE_STORE], 'readonly');
		const row = (await requestToPromise(tx.objectStore(NOTE_LINK_CACHE_STORE).get(docId))) as { docId: string; links: NoteLinkRecord[] } | undefined;
		await transactionToPromise(tx);
		const links = Array.isArray(row?.links) ? row.links : [];
		remoteCache.set(docId, links);
		return links;
	} catch {
		return remoteCache.get(docId) || [];
	}
}

function buildQueuedRecords(docId: string, links: readonly ExtractedNoteLink[]): NoteLinkRecord[] {
	const timestamp = nowIso();
	return links.map((link) => ({
		id: `queued:${link.normalizedUrl}`,
		docId,
		sourceWorkspaceId: '',
		sourceNoteId: '',
		normalizedUrl: link.normalizedUrl,
		originalUrl: link.url,
		hostname: link.hostname,
		rootDomain: link.rootDomain,
		siteName: link.rootDomain || null,
		title: null,
		description: null,
		mainContent: null,
		imageUrl: null,
		metadataJson: null,
		imageUrls: [],
		sortOrder: link.sortOrder,
		status: 'PENDING',
		errorMessage: null,
		createdAt: timestamp,
		updatedAt: timestamp,
	}));
}

export async function queueNoteLinkSync(args: {
	userId: string;
	docId: string;
	links: readonly ExtractedNoteLink[];
}): Promise<void> {
	const userId = String(args.userId || '').trim();
	const docId = String(args.docId || '').trim();
	if (!userId || !docId) return;
	const updatedAt = nowIso();
	await writeQueuedSnapshot({
		// Store the exact extracted link set so a later flush can reconcile the preview list
		// with the note's latest intended URLs rather than replaying incremental mutations.
		id: `${userId}:${docId}`,
		userId,
		docId,
		links: args.links.map((link) => ({ ...link })),
		updatedAt,
		lastError: null,
	});
	await writeCachedLinks(docId, buildQueuedRecords(docId, args.links), { emit: true });
}

export async function refreshRemoteNoteLinks(docId: string): Promise<readonly NoteLinkRecord[]> {
	if (!docId) return [];
	const pending = pendingRefreshes.get(docId);
	if (pending) return pending;
	const request = (async () => {
		try {
			const response = await listNoteLinks(docId);
			await writeCachedLinks(docId, response.links);
			return response.links;
		} finally {
			pendingRefreshes.delete(docId);
		}
	})();
	pendingRefreshes.set(docId, request);
	return request;
}

export async function flushQueuedNoteLinkSync(userId: string): Promise<void> {
	const normalizedUserId = String(userId || '').trim();
	if (!normalizedUserId) return;
	const existing = pendingFlushes.get(normalizedUserId);
	if (existing) return existing;
	const work = (async () => {
		try {
			if (isOffline()) return;
			const snapshots = await readQueuedSnapshotsByUser(normalizedUserId);
			for (const snapshot of snapshots.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))) {
				const response = await syncNoteLinks(snapshot.docId, snapshot.links);
				await writeCachedLinks(snapshot.docId, response.links, { emit: true });
				await deleteQueuedSnapshot(snapshot.id);
			}
		} finally {
			pendingFlushes.delete(normalizedUserId);
		}
	})();
	pendingFlushes.set(normalizedUserId, work);
	return work;
}

export async function syncNoteLinksForDoc(args: {
	userId: string | null | undefined;
	docId: string;
	links: readonly ExtractedNoteLink[];
}): Promise<void> {
	const docId = String(args.docId || '').trim();
	if (!docId) return;
	const userId = String(args.userId || '').trim();
	if (!userId) {
		// Unauthenticated or pre-session flows still get optimistic local preview placeholders.
		await writeCachedLinks(docId, buildQueuedRecords(docId, args.links), { emit: true });
		return;
	}
	await queueNoteLinkSync({ userId, docId, links: args.links });
	if (isOffline()) return;
	await flushQueuedNoteLinkSync(userId);
	const leftover = await readQueuedSnapshot(userId, docId);
	if (!leftover) {
		await refreshRemoteNoteLinks(docId).catch(() => undefined);
	}
	}