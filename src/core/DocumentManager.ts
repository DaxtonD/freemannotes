import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';

const NOTES_REGISTRY_ID = '__notes_registry__';
const NOTES_LIST_KEY = 'notesList';
const NOTE_ORDER_KEY = 'noteOrder';

export type NoteRegistryItem = {
	id: string;
	title: string;
};

export type ConnectionState = 'connected' | 'connecting' | 'offline';

export type ConnectionSnapshot = {
	state: ConnectionState;
	hasPendingSync: boolean;
	// Subset of note IDs that currently contain local edits made while websocket sync
	// was disconnected. This is intentionally note-scoped (not global) so UI can place
	// sync indicators on individual cards and avoid misleading global "pending" states.
	pendingSyncNoteIds: readonly string[];
};

export class DocumentManager {
	// In-memory caches for active Yjs docs and their persistence/sync providers.
	private readonly docs = new Map<string, Y.Doc>();
	private readonly providers = new Map<string, IndexeddbPersistence>();
	private readonly websocketProviders = new Map<string, WebsocketProvider>();
	private readonly connectionSubscribers = new Set<() => void>();
	// Internal room-level pending tracker. This includes all rooms, then emitConnectionStatus
	// filters out non-user rooms (such as the notes registry) before exposing snapshot data.
	private readonly pendingSyncRooms = new Set<string>();
	private readonly wsCleanup = new Map<string, () => void>();
	private readonly docCleanup = new Map<string, () => void>();
	private readonly readyPromises = new Map<string, Promise<void>>();
	private readonly websocketReadyPromises = new Map<string, Promise<void>>();
	private readonly websocketUrl: string;
	private readonly internalOrigin = Symbol('DocumentManagerInternal');
	private connectionState: ConnectionState = 'connecting';
	private browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
	private connectionSnapshot: ConnectionSnapshot = {
		state: 'connecting',
		hasPendingSync: false,
		pendingSyncNoteIds: [],
	};

	public constructor(websocketUrl = 'ws://localhost:1234') {
		// Normalize trailing slashes to avoid duplicate room URLs.
		this.websocketUrl = String(websocketUrl || 'ws://localhost:1234').replace(/\/+$/, '');

		if (typeof window !== 'undefined') {
			const onOnline = (): void => {
				this.browserOnline = true;
				this.updateConnectionState();
				this.emitConnectionStatus();
			};
			const onOffline = (): void => {
				this.browserOnline = false;
				this.updateConnectionState();
				this.emitConnectionStatus();
			};

			window.addEventListener('online', onOnline);
			window.addEventListener('offline', onOffline);
		}

		this.updateConnectionState();
		this.emitConnectionStatus();
	}

	public hasDoc(noteId: string): boolean {
		return this.docs.has(this.normalizeNoteId(noteId));
	}

	public subscribeConnectionStatus(listener: () => void): () => void {
		this.connectionSubscribers.add(listener);
		return () => {
			this.connectionSubscribers.delete(listener);
		};
	}

	public getConnectionSnapshot(): ConnectionSnapshot {
		return this.connectionSnapshot;
	}

	public getDoc(noteId: string): Y.Doc {
		const key = this.normalizeNoteId(noteId);

		const existing = this.docs.get(key);
		if (existing) {
			this.ensureStructure(existing);
			this.ensureProvider(key, existing);
			return existing;
		}

		// Create once, register immediately to prevent accidental duplicate creation
		// if higher-level code re-enters getDoc during initialization.
		const doc = new Y.Doc();
		this.docs.set(key, doc);

		this.ensureStructure(doc);
		this.ensureProvider(key, doc);
		return doc;
	}

	public async getDocReady(noteId: string): Promise<Y.Doc> {
		const key = this.normalizeNoteId(noteId);
		const doc = this.getDoc(key);
		const ready = this.readyPromises.get(key);
		if (!ready) {
			// getDoc() should always install a provider + ready promise.
			throw new Error(`Document provider was not initialized for noteId: ${key}`);
		}
		await ready;
		return doc;
	}

	public async getDocWithSync(noteId: string): Promise<Y.Doc> {
		const key = this.normalizeNoteId(noteId);
		const doc = await this.getDocReady(key);
		this.ensureWebsocketProvider(key, doc);
		// Offline-first behavior: return once the document is hydrated from IndexedDB
		// and websocket wiring exists. Connection establishment can happen asynchronously.
		return doc;
	}

	public async getNotesRegistryDoc(): Promise<Y.Doc> {
		const doc = await this.getDocWithSync(NOTES_REGISTRY_ID);
		doc.getArray<Y.Map<any>>(NOTES_LIST_KEY);
		doc.getArray<string>(NOTE_ORDER_KEY);
		return doc;
	}

	public async getNotesList(): Promise<Y.Array<Y.Map<any>>> {
		const doc = await this.getNotesRegistryDoc();
		return doc.getArray<Y.Map<any>>(NOTES_LIST_KEY);
	}

	public async getNoteOrder(): Promise<Y.Array<string>> {
		const doc = await this.getNotesRegistryDoc();
		return doc.getArray<string>(NOTE_ORDER_KEY);
	}

	public async setNoteOrder(noteIds: readonly string[]): Promise<void> {
		const noteOrder = await this.getNoteOrder();
		const next = Array.from(new Set(noteIds.map((id) => this.normalizeNoteId(id))));
		const current = noteOrder.toArray();
		if (current.length === next.length && current.every((id, index) => id === next[index])) {
			return;
		}

		const registryDoc = (noteOrder as any).doc as Y.Doc | undefined | null;
		const run = (): void => {
			if (noteOrder.length > 0) {
				noteOrder.delete(0, noteOrder.length);
			}
			if (next.length > 0) {
				noteOrder.insert(0, next.slice());
			}
		};

		if (registryDoc) registryDoc.transact(run);
		else run();
	}

	public async createNote(noteId: string, title = ''): Promise<void> {
		// Registry + order are maintained independently for efficient list rendering and DnD updates.
		const key = this.normalizeNoteId(noteId);
		const notesList = await this.getNotesList();
		const noteOrder = await this.getNoteOrder();
		const exists = notesList.toArray().some((item) => String(item.get('id') ?? '').trim() === key);
		if (!exists) {
			const map = new Y.Map<any>();
			map.set('id', key);
			map.set('title', String(title ?? ''));
			const registryDoc = (notesList as any).doc as Y.Doc | undefined | null;
			const run = (): void => {
				notesList.push([map]);
			};
			if (registryDoc) registryDoc.transact(run);
			else run();
		}

		if (!noteOrder.toArray().includes(key)) {
			const registryDoc = (noteOrder as any).doc as Y.Doc | undefined | null;
			const run = (): void => {
				noteOrder.push([key]);
			};
			if (registryDoc) registryDoc.transact(run);
			else run();
		}

		// Ensure note doc + providers are initialized.
		await this.getDocWithSync(key);
	}

	public async deleteNote(noteId: string, destroyNoteDoc = true): Promise<void> {
		// Remove from both user-visible registry and order list.
		const key = this.normalizeNoteId(noteId);
		const notesList = await this.getNotesList();
		const noteOrder = await this.getNoteOrder();
		const arr = notesList.toArray();
		const idx = arr.findIndex((item) => String(item.get('id') ?? '').trim() === key);
		if (idx !== -1) {
			const registryDoc = (notesList as any).doc as Y.Doc | undefined | null;
			const run = (): void => {
				notesList.delete(idx, 1);
			};
			if (registryDoc) registryDoc.transact(run);
			else run();
		}

		const orderIdx = noteOrder.toArray().findIndex((id) => String(id).trim() === key);
		if (orderIdx !== -1) {
			const registryDoc = (noteOrder as any).doc as Y.Doc | undefined | null;
			const run = (): void => {
				noteOrder.delete(orderIdx, 1);
			};
			if (registryDoc) registryDoc.transact(run);
			else run();
		}

		if (destroyNoteDoc) {
			this.destroyDoc(key);
		}
	}

	public destroyDoc(noteId: string): void {
		const key = this.normalizeNoteId(noteId);
		const doc = this.docs.get(key);
		if (!doc) {
			return;
		}

		const wsProvider = this.websocketProviders.get(key);
		const provider = this.providers.get(key);

		this.docs.delete(key);
		this.providers.delete(key);
		this.websocketProviders.delete(key);
		this.readyPromises.delete(key);
		this.websocketReadyPromises.delete(key);
		this.pendingSyncRooms.delete(key);

		this.wsCleanup.get(key)?.();
		this.docCleanup.get(key)?.();
		this.wsCleanup.delete(key);
		this.docCleanup.delete(key);

		wsProvider?.destroy();
		// Provider must be destroyed before the doc in case it is still syncing.
		provider?.destroy();
		doc.destroy();
		this.updateConnectionState();
		this.emitConnectionStatus();
	}

	private ensureStructure(doc: Y.Doc): void {
		// Yjs root types are created on first access and are stable thereafter.
		// Re-running this method is safe and will not create duplicates.
		doc.transact(() => {
			doc.getText('title');
			doc.getArray<Y.Map<any>>('checklist');
			doc.getMap<any>('metadata');
		}, this.internalOrigin);
	}

	private ensureProvider(noteId: string, doc: Y.Doc): void {
		if (this.providers.has(noteId)) {
			return;
		}

		if (typeof (globalThis as any).indexedDB === 'undefined') {
			throw new Error(
				'IndexedDB is not available in this runtime. ' +
					'DocumentManager requires IndexedDB for offline persistence (y-indexeddb).'
			);
		}

		// One IndexedDB room per note ID.
		const provider = new IndexeddbPersistence(noteId, doc);
		this.providers.set(noteId, provider);

		if (!this.readyPromises.has(noteId)) {
			this.readyPromises.set(noteId, this.waitForSynced(provider));
		}
	}

	private ensureWebsocketProvider(noteId: string, doc: Y.Doc): void {
		const existing = this.websocketProviders.get(noteId);
		if (existing) {
			if (!this.websocketReadyPromises.has(noteId)) {
				this.websocketReadyPromises.set(noteId, this.waitForWebsocketConnected(existing));
			}
			return;
		}

		if (typeof (globalThis as any).WebSocket === 'undefined') {
			throw new Error(
				'WebSocket is not available in this runtime. ' +
					'DocumentManager requires WebSocket support for collaborative sync (y-websocket).'
			);
		}

		// Attach only after IndexedDB hydration has completed (enforced by getDocWithSync).
		const wsProvider = new WebsocketProvider(this.websocketUrl, noteId, doc, {
			connect: true,
		});

		const onStatus = (event: { status: string }): void => {
			console.info(`[yjs-ws] room=${noteId} status=${event.status} url=${this.websocketUrl}`);
			this.updateConnectionState();
			this.emitConnectionStatus();
		};
		const onConnectionClose = (): void => {
			console.info(`[yjs-ws] room=${noteId} connection-close url=${this.websocketUrl}`);
			this.updateConnectionState();
			this.emitConnectionStatus();
		};
		const onConnectionError = (err: unknown): void => {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[yjs-ws] room=${noteId} connection-error=${msg} url=${this.websocketUrl}`);
			this.updateConnectionState();
			this.emitConnectionStatus();
		};
		const onSync = (isSynced: boolean): void => {
			if (isSynced) {
				this.pendingSyncRooms.delete(noteId);
				this.emitConnectionStatus();
			}
		};
		const onAfterTransaction = (tx: Y.Transaction): void => {
			if (!tx.local) return;
			if (tx.origin === this.internalOrigin) return;
				// Registry room writes (order/title metadata) should not produce per-note pending badges.
				// Without this filter, routine registry mutations could produce false-positive sync indicators
				// after refresh/startup even when no actual note content edits occurred offline.
			if (noteId === NOTES_REGISTRY_ID) return;
			const connected = (wsProvider as any).wsconnected === true;
			if (!connected) {
				this.pendingSyncRooms.add(noteId);
				this.emitConnectionStatus();
			}
		};

		(wsProvider as any).on?.('status', onStatus);
		(wsProvider as any).on?.('connection-close', onConnectionClose);
		(wsProvider as any).on?.('connection-error', onConnectionError);
		(wsProvider as any).on?.('sync', onSync);
		doc.on('afterTransaction', onAfterTransaction);

		this.websocketProviders.set(noteId, wsProvider);
		this.wsCleanup.set(noteId, () => {
			(wsProvider as any).off?.('status', onStatus);
			(wsProvider as any).off?.('connection-close', onConnectionClose);
			(wsProvider as any).off?.('connection-error', onConnectionError);
			(wsProvider as any).off?.('sync', onSync);
		});
		this.docCleanup.set(noteId, () => {
			doc.off('afterTransaction', onAfterTransaction);
		});
		if (!this.websocketReadyPromises.has(noteId)) {
			this.websocketReadyPromises.set(noteId, this.waitForWebsocketConnected(wsProvider));
		}
		this.updateConnectionState();
		this.emitConnectionStatus();
	}

	private updateConnectionState(): void {
		if (!this.browserOnline) {
			this.connectionState = 'offline';
			return;
		}

		if (this.websocketProviders.size === 0) {
			this.connectionState = 'connecting';
			return;
		}

		const providers = Array.from(this.websocketProviders.values());
		const anyConnected = providers.some((provider) => (provider as any).wsconnected === true);
		if (anyConnected) {
			this.connectionState = 'connected';
			return;
		}

		const anyConnecting = providers.some((provider) => (provider as any).wsconnecting === true);
		this.connectionState = anyConnecting ? 'connecting' : 'offline';
	}

	private emitConnectionStatus(): void {
		// Derive and sort snapshot IDs for stable identity semantics.
		// Stable ordering prevents unnecessary React external-store emissions and keeps
		// subscribe/update behavior deterministic across browsers.
		const nextPendingSyncNoteIds = Array.from(this.pendingSyncRooms)
			.filter((roomId) => roomId !== NOTES_REGISTRY_ID)
			.sort();
		const nextHasPendingSync = nextPendingSyncNoteIds.length > 0;
		const pendingUnchanged =
			this.connectionSnapshot.pendingSyncNoteIds.length === nextPendingSyncNoteIds.length &&
			this.connectionSnapshot.pendingSyncNoteIds.every((id, index) => id === nextPendingSyncNoteIds[index]);
		if (
			this.connectionSnapshot.state === this.connectionState &&
			this.connectionSnapshot.hasPendingSync === nextHasPendingSync &&
			pendingUnchanged
		) {
			return;
		}

		this.connectionSnapshot = {
			state: this.connectionState,
			hasPendingSync: nextHasPendingSync,
			pendingSyncNoteIds: nextPendingSyncNoteIds,
		};

		for (const listener of this.connectionSubscribers) {
			listener();
		}
	}

	private waitForWebsocketConnected(provider: WebsocketProvider): Promise<void> {
		const alreadyConnected = (provider as any).wsconnected === true;
		if (alreadyConnected) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve) => {
			const onStatus = (event: { status: string }): void => {
				if (event.status === 'connected') {
					cleanup();
					resolve();
				}
			};

			const cleanup = (): void => {
				(provider as any).off?.('status', onStatus);
			};

			(provider as any).on?.('status', onStatus);

			queueMicrotask(() => {
				if ((provider as any).wsconnected === true) {
					cleanup();
					resolve();
				}
			});
		});
	}

	private waitForSynced(provider: IndexeddbPersistence): Promise<void> {
		const alreadySynced = (provider as any).synced === true;
		if (alreadySynced) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve, reject) => {
			const onSynced = (): void => {
				cleanup();
				resolve();
			};

			const onError = (error: unknown): void => {
				cleanup();
				reject(error instanceof Error ? error : new Error(String(error)));
			};

			const cleanup = (): void => {
				(provider as any).off?.('synced', onSynced);
				(provider as any).off?.('error', onError);
			};

			(provider as any).on?.('synced', onSynced);
			(provider as any).on?.('error', onError);

			// In case sync finishes between the initial check and handler registration.
			queueMicrotask(() => {
				if ((provider as any).synced === true) {
					onSynced();
				}
			});
		});
	}

	private normalizeNoteId(noteId: string): string {
		if (typeof noteId !== 'string') {
			throw new TypeError('noteId must be a string');
		}
		const trimmed = noteId.trim();
		if (trimmed.length === 0) {
			throw new TypeError('noteId must be a non-empty string');
		}
		return trimmed;
	}
}

