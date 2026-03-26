import { listNoteLinks, syncNoteLinks, type NoteLinkRecord } from './noteLinkApi';
import type { ExtractedNoteLink } from './noteLinks';
import { requestPwaBackgroundSync } from './pwa';

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

export type NoteLinksChangedReason = 'cache' | 'remote';

type RefreshRemoteNoteLinksOptions = {
	force?: boolean;
	/** When provided, any URL returned by the server that is absent from this
	 *  set will be suppressed – it was locally deleted and the flush has not
	 *  yet reached the server (e.g. network error on first attempt). */
	intentUrls?: ReadonlySet<string> | null;
};

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

export function emitNoteLinksChanged(docId: string, reason: NoteLinksChangedReason = 'cache'): void {
	if (!docId || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
	window.dispatchEvent(new CustomEvent(NOTE_LINK_CHANGED_EVENT, { detail: { docId, reason } }));
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

export async function hasQueuedNoteLinkSync(userId: string): Promise<boolean> {
	const normalizedUserId = String(userId || '').trim();
	if (!normalizedUserId) return false;
	const rows = await readQueuedSnapshotsByUser(normalizedUserId);
	return rows.length > 0;
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
	if (options.emit && typeof window !== 'undefined') emitNoteLinksChanged(docId, 'cache');
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

export function isPlaceholderLink(link: NoteLinkRecord): boolean {
	// Only genuinely unresolved (queued / in-flight) links are placeholders.
	// FAILED means resolution was attempted and the URL could not be fetched
	// (paywall, bot-block, network error) – treat it as terminal so the client
	// stops retrying and displays the basic fallback card instead.
	return link.status === 'PENDING';
}

function mergeFetchedLinksWithCachedPlaceholders(
	fetched: readonly NoteLinkRecord[],
	cached: readonly NoteLinkRecord[],
	intentUrls: ReadonlySet<string> | null = null
): readonly NoteLinkRecord[] {
	if (cached.length === 0 && intentUrls === null) return fetched.slice();
	const merged = new Map<string, NoteLinkRecord>();
	for (const link of fetched) {
		// If the caller supplied an intent set (queued snapshot that hasn't been
		// flushed yet) and this URL is absent from it, the user deleted the link
		// locally; skip the stale server entry so it doesn't reappear on reconnect.
		if (intentUrls !== null && !intentUrls.has(link.normalizedUrl)) continue;
		merged.set(link.normalizedUrl, link);
	}
	for (const link of cached) {
		if (merged.has(link.normalizedUrl)) continue;
		if (!isPlaceholderLink(link)) continue;
		merged.set(link.normalizedUrl, link);
	}
	return Array.from(merged.values()).sort((left, right) => {
		const sortDiff = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
		if (sortDiff !== 0) return sortDiff;
		return String(left.createdAt || '').localeCompare(String(right.createdAt || ''));
	});
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
	// Merge queued placeholder records with existing cached records so that
	// already-resolved previews (title, imageUrl) are preserved while offline
	// instead of being overwritten with blank placeholders.
	const existingLinks = await readStoredNoteLinks(docId);
	const existingByUrl = new Map(existingLinks.map((l) => [l.normalizedUrl, l]));
	const queued = buildQueuedRecords(docId, args.links);
	const merged = queued.map((placeholder) => {
		const existing = existingByUrl.get(placeholder.normalizedUrl);
		// Preserve any definitive server-determined status (READY or FAILED).
		// Only replace with a local placeholder if the URL is genuinely new or
		// still PENDING (i.e. background hydration has not yet run).
		if (existing && existing.status !== 'PENDING') return existing;
		return placeholder;
	});
	await writeCachedLinks(docId, merged, { emit: true });
	void requestPwaBackgroundSync();
}

export async function refreshRemoteNoteLinks(
	docId: string,
	options: RefreshRemoteNoteLinksOptions = {}
): Promise<readonly NoteLinkRecord[]> {
	if (!docId) return [];
	if (isOffline() && !options.force) {
		const stored = await readStoredNoteLinks(docId);
		return stored.length > 0 ? stored : [];
	}
	const pending = options.force ? null : pendingRefreshes.get(docId);
	if (pending) return pending;
	const request = (async () => {
		try {
			const response = await listNoteLinks(docId);
			const cached = remoteCache.get(docId) || await readStoredNoteLinks(docId);
			const merged = mergeFetchedLinksWithCachedPlaceholders(response.links, cached, options.intentUrls ?? null);
			// Emit here as well as during local queue writes so note-card rails on other
			// clients react when fresh preview metadata arrives from the server.
			await writeCachedLinks(docId, merged, { emit: true });
			return merged;
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
			const snapshots = await readQueuedSnapshotsByUser(normalizedUserId);
			for (const snapshot of snapshots.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))) {
				try {
					const response = await syncNoteLinks(snapshot.docId, snapshot.links);
					// Server sync returns hydrated rows. Use 'remote' reason so that
					// NoteLinkPanel components trigger their hydration‐retry mechanism
					// in case some rows are still PENDING after slow preview resolution.
					await writeCachedLinks(snapshot.docId, response.links, { emit: false });
					emitNoteLinksChanged(snapshot.docId, 'remote');
					await deleteQueuedSnapshot(snapshot.id);
				} catch {
					// Per-snapshot failure: leave the snapshot in the queue for the
					// next flush attempt instead of aborting the entire batch.
				}
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
	} else {
		// Flush did not process this doc (either it failed silently or a concurrent
		// flush already ran with a stale snapshot). Refresh but suppress any server
		// URLs that contradict our local intent so deleted links don't reappear.
		const intentUrls = new Set(leftover.links.map((l) => l.normalizedUrl));
		await refreshRemoteNoteLinks(docId, { force: true, intentUrls }).catch(() => undefined);
	}
}

/**
 * Returns the set of normalizedUrls from the pending queued snapshot for
 * (userId, docId), or null if no snapshot is queued.  Used by callers to
 * suppress stale server URLs when the flush hasn't propagated yet.
 */
export async function getQueuedIntentUrls(userId: string, docId: string): Promise<ReadonlySet<string> | null> {
	const snapshot = await readQueuedSnapshot(userId, docId);
	if (!snapshot) return null;
	return new Set(snapshot.links.map((l) => l.normalizedUrl));
}

/**
 * Scan every docId currently in the in-memory remote cache and trigger a
 * background refresh for any that still have placeholder (unresolved) links.
 * Called on reconnect so that all open note panels eventually upgrade their
 * placeholder chips to real preview metadata without requiring a page reload.
 */
export async function scanAllDocumentsForPlaceholders(): Promise<void> {
	if (isOffline()) return;
	for (const [docId, links] of remoteCache) {
		const placeholders = links.filter(isPlaceholderLink);
		if (placeholders.length === 0) continue;
		void refreshRemoteNoteLinks(docId, { force: true }).catch(() => undefined);
	}
}