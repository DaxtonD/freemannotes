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

export class DocumentManager {
	private readonly docs = new Map<string, Y.Doc>();
	private readonly providers = new Map<string, IndexeddbPersistence>();
	private readonly websocketProviders = new Map<string, WebsocketProvider>();
	private readonly readyPromises = new Map<string, Promise<void>>();
	private readonly websocketReadyPromises = new Map<string, Promise<void>>();
	private readonly websocketUrl: string;

	public constructor(websocketUrl = 'ws://localhost:1234') {
		this.websocketUrl = String(websocketUrl || 'ws://localhost:1234').replace(/\/+$/, '');
	}

	public hasDoc(noteId: string): boolean {
		return this.docs.has(this.normalizeNoteId(noteId));
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

		wsProvider?.destroy();
		// Provider must be destroyed before the doc in case it is still syncing.
		provider?.destroy();
		doc.destroy();
	}

	private ensureStructure(doc: Y.Doc): void {
		// Yjs root types are created on first access and are stable thereafter.
		// Re-running this method is safe and will not create duplicates.
		doc.transact(() => {
			doc.getText('title');
			doc.getText('content');
			doc.getArray<Y.Map<any>>('checklist');
			doc.getMap<any>('metadata');
		});
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

		// Diagnostics: desktop tabs can appear to "sync" via IndexedDB even if the websocket
		// is unreachable. Logging status makes mobile issues obvious.
		(wsProvider as any).on?.('status', (event: { status: string }) => {
			// Keep logs concise; these are useful when debugging remote mobile Safari/Chrome.
			console.info(`[yjs-ws] room=${noteId} status=${event.status} url=${this.websocketUrl}`);
		});
		(wsProvider as any).on?.('connection-close', () => {
			console.info(`[yjs-ws] room=${noteId} connection-close url=${this.websocketUrl}`);
		});
		(wsProvider as any).on?.('connection-error', (err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[yjs-ws] room=${noteId} connection-error=${msg} url=${this.websocketUrl}`);
		});

		this.websocketProviders.set(noteId, wsProvider);
		if (!this.websocketReadyPromises.has(noteId)) {
			this.websocketReadyPromises.set(noteId, this.waitForWebsocketConnected(wsProvider));
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

