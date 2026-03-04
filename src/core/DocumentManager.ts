import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import { touchUpdatedAt, setNoteTrashed, readTrashState } from './noteModel';

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
	// True once the notes registry Y.Doc has been hydrated from IndexedDB.
	// UI can gate grid rendering on this flag to avoid flash-of-empty-content
	// and ensure noteOrder is available before the first paint.
	registryReady: boolean;
};

export type DocumentManagerOptions = {
	/**
	 * When false, WebSocket providers are created with connect=false and the
	 * manager will not attempt automatic reconnects.
	 *
	 * Primary use-case in this app:
	 *   - During the auth gate (not authenticated), we want IndexedDB + local
	 *     editing UI to exist, but we must not connect to the Yjs websocket layer
	 *     because there is no authorized workspace yet.
	 *
	 * When toggled from false -> true:
	 *   - Existing providers are connected and normal reconnect behavior resumes.
	 * When toggled from true -> false:
	 *   - Existing providers are disconnected and reconnect logic is suppressed.
	 */
	enableWebsocketSync?: boolean;
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
	private websocketEnabled: boolean;
	private readonly internalOrigin = Symbol('DocumentManagerInternal');
	// Dedicated origin for automatic updatedAt timestamp writes.
	// Used to tag afterTransaction callbacks so they do not recursively re-trigger
	// themselves or get confused with user-initiated edits.
	private readonly updatedAtOrigin = Symbol('DocumentManagerUpdatedAt');
	// Tracks which note docs already have an afterTransaction listener attached
	// for automatic updatedAt stamping. Prevents double-attaching if getDoc()
	// is called multiple times for the same noteId.
	private readonly updatedAtDocs = new Set<string>();
	private connectionState: ConnectionState = 'connecting';
	private browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
	// Becomes true once the notes registry doc has been fully hydrated from
	// IndexedDB plus websocket provider wiring has been established.
	private registryHydrated = false;
	private connectionSnapshot: ConnectionSnapshot = {
		state: 'connecting',
		hasPendingSync: false,
		pendingSyncNoteIds: [],
		registryReady: false,
	};
	// Cleanup function for the global visibility/focus lifecycle listeners that
	// trigger reconnect-on-foreground behavior. Stored so the manager can be
	// torn down cleanly in tests or hot-module-replacement scenarios.
	private readonly lifecycleCleanup: (() => void) | null = null;

	public constructor(websocketUrl = 'ws://localhost:1234', options?: DocumentManagerOptions) {
		// Normalize trailing slashes to avoid duplicate room URLs.
		this.websocketUrl = String(websocketUrl || 'ws://localhost:1234').replace(/\/+$/, '');
		this.websocketEnabled = options?.enableWebsocketSync ?? true;

		if (typeof window !== 'undefined') {
			const onOnline = (): void => {
				this.browserOnline = true;
				this.updateConnectionState();
				this.emitConnectionStatus();
				// Mobile networks often silently kill WebSocket connections during
				// offline→online transitions (cell tower handoff, tunnel exit, etc).
				// Force-reconnect all providers so pending Yjs updates sync immediately.
				this.reconnectAllProviders('online-event');
			};
			const onOffline = (): void => {
				this.browserOnline = false;
				this.updateConnectionState();
				this.emitConnectionStatus();
			};

			window.addEventListener('online', onOnline);
			window.addEventListener('offline', onOffline);

			// ── Visibility / focus lifecycle ─────────────────────────────
			// Mobile browsers (iOS Safari, Android Chrome) aggressively suspend
			// background tabs, silently closing WebSocket connections without
			// firing `close` events. When the user returns to the tab, the Yjs
			// provider thinks it is still connected but the underlying socket
			// is dead. We detect the tab returning to the foreground via the
			// Page Visibility API and `focus` event, then force-disconnect and
			// reconnect every WebSocket provider so that:
			//   1. The provider re-establishes a fresh TCP/TLS connection.
			//   2. The Yjs sync protocol re-runs Step 1 (full state vector
			//      exchange) on the new connection, fetching any updates the
			//      client missed while backgrounded.
			//   3. The reconnect counter is reset so backoff doesn't accumulate
			//      across foreground/background cycles.
			//
			// This is intentionally aggressive (disconnect + reconnect every
			// provider) rather than subtle (check individual provider state)
			// because mobile OS suspension behavior is unpredictable and
			// provider-level `wsconnected` flags can be stale.
			const onVisibilityChange = (): void => {
				if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
					this.reconnectAllProviders('visibilitychange');
				}
			};
			const onFocus = (): void => {
				// Redundant with visibilitychange on most browsers, but some
				// mobile WebViews only fire `focus` (not visibility events).
				this.reconnectAllProviders('focus');
			};

			if (typeof document !== 'undefined') {
				document.addEventListener('visibilitychange', onVisibilityChange);
			}
			window.addEventListener('focus', onFocus);

			this.lifecycleCleanup = () => {
				window.removeEventListener('online', onOnline);
				window.removeEventListener('offline', onOffline);
				window.removeEventListener('focus', onFocus);
				if (typeof document !== 'undefined') {
					document.removeEventListener('visibilitychange', onVisibilityChange);
				}
			};
		}

		this.updateConnectionState();
		this.emitConnectionStatus();

		// Eagerly kick off registry hydration so noteOrder is available as early
		// as possible. This runs in the background; subsequent calls to
		// getNotesRegistryDoc() reuse the same cached doc and providers.
		this.initializeRegistry();
	}

	public setWebsocketEnabled(enabled: boolean): void {
		// This is intentionally idempotent and safe to call frequently.
		// The App uses it to turn sync on/off based on authentication state.
		const next = enabled === true;
		if (this.websocketEnabled === next) return;
		this.websocketEnabled = next;

		for (const provider of this.websocketProviders.values()) {
			try {
				if (next) {
					// Reset internal reconnect counters so a previously-disconnected
					// provider doesn't stay in a "give up" state.
					(provider as any).wsUnsuccessfulReconnects = 0;
					provider.connect();
				} else {
					// Hard disconnect and prevent reconnect attempts.
					provider.disconnect();
				}
			} catch {
				// ignore
			}
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
		this.ensureUpdatedAtTracking(key, doc);
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
				noteOrder.insert(0, [key]);
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

	// ─── Trash (soft-delete) API ──────────────────────────────────────────

	/**
	 * Move a note to trash (soft-delete).
	 *
	 * Sets `metadata.trashed = true` and `metadata.trashedAt = Date.now()`
	 * inside the note's Yjs document. The note is NOT removed from the
	 * registry or ordering arrays — the change propagates through normal
	 * CRDT sync and the UI filters trashed notes out of the main grid.
	 *
	 * The note doc and its providers remain alive so the trash state change
	 * syncs to the server and other tabs. Physical deletion (registry
	 * removal + doc destroy) is handled by the server-side cleanup process
	 * once the retention period expires, or immediately via permanentlyDeleteNote().
	 */
	public async trashNote(noteId: string): Promise<void> {
		const key = this.normalizeNoteId(noteId);
		const doc = await this.getDocWithSync(key);
		setNoteTrashed(doc, true);
	}

	/**
	 * Restore a trashed note (un-trash / undo soft-delete).
	 *
	 * Sets `metadata.trashed = false` and clears `metadata.trashedAt` to null.
	 * The note reappears in the main grid for all connected clients.
	 */
	public async restoreNote(noteId: string): Promise<void> {
		const key = this.normalizeNoteId(noteId);
		const doc = await this.getDocWithSync(key);
		setNoteTrashed(doc, false);
	}

	/**
	 * Check whether a specific note is currently trashed.
	 *
	 * Reads the `trashed` flag directly from the note's Yjs metadata map.
	 * Returns false for notes that pre-date the trash feature (legacy notes
	 * with no `trashed` field in their metadata).
	 */
	public async isNoteTrashed(noteId: string): Promise<boolean> {
		const key = this.normalizeNoteId(noteId);
		const doc = await this.getDocWithSync(key);
		return readTrashState(doc).trashed;
	}

	/**
	 * Permanently delete a note — removes from registry, order, and destroys
	 * the Yjs document and all its providers. This is irreversible.
	 *
	 * Use this for:
	 *   - Immediate permanent deletion (skip trash).
	 *   - Server-side cleanup of expired trashed notes.
	 *   - User-initiated "empty trash" / "delete permanently" actions.
	 */
	public async permanentlyDeleteNote(noteId: string): Promise<void> {
		await this.deleteNote(noteId, true);
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
		// Remove updatedAt tracking registration so a future getDoc() re-attaches cleanly.
		this.updatedAtDocs.delete(key);

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
		// All four root types that constitute the canonical note shape are
		// pre-initialized here so downstream code can assume they exist.
		doc.transact(() => {
			doc.getText('title');
			doc.getText('content');
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
		// ── Mobile-resilient provider configuration ──────────────────────
		//   resyncInterval: 30 000 ms (30 s) — periodically re-sends Yjs
		//     Sync Step 1 to the server, causing it to reply with any updates
		//     the client is missing. This covers silent message loss on flaky
		//     mobile networks where the WS connection stays alive but
		//     individual frames are dropped by intermediate proxies/NAT.
		//   maxBackoffTime: 5 000 ms — caps the exponential reconnect delay
		//     to 5 seconds. The default 2.5 s is fine for desktop; 5 s gives
		//     mobile radios a bit more time to come back up after a cell
		//     tower switch without making the user wait too long.
		//   disableBc: false (default) — BroadcastChannel remains enabled
		//     for same-origin same-browser cross-tab sync (instant, no WS).
		const wsProvider = new WebsocketProvider(this.websocketUrl, noteId, doc, {
			connect: this.websocketEnabled,
			resyncInterval: 30_000,
			maxBackoffTime: 5_000,
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

	// ─── Reconnect-on-foreground ─────────────────────────────────────────

	/**
	 * Force-disconnect and reconnect every active WebSocket provider.
	 *
	 * This is the primary mechanism for ensuring mobile browsers receive
	 * instant CRDT updates after returning from a suspended/backgrounded
	 * state. Mobile OS behaviour (iOS, Android) silently drops WebSocket
	 * connections when tabs go to the background but does NOT fire the
	 * standard `close` event, leaving y-websocket believing it is still
	 * connected. The Yjs awareness heartbeat (15 s) eventually detects the
	 * dead socket but only after 30 s of `messageReconnectTimeout` — during
	 * which all new remote edits are invisible to the user.
	 *
	 * By explicitly calling `disconnect()` then `connect()` on each
	 * provider we:
	 *   1. Tear down the dead underlying WebSocket immediately.
	 *   2. Reset the reconnect backoff counter (`wsUnsuccessfulReconnects`).
	 *   3. Open a fresh TCP/TLS connection.
	 *   4. Run Yjs Sync Step 1 on the new connection, which brings the
	 *      entire Y.Doc up to date in a single round-trip.
	 *
	 * The method uses a short 150 ms debounce so that rapid successive
	 * events (e.g. both `visibilitychange` and `focus` firing at the same
	 * instant) only trigger a single reconnect cycle.
	 *
	 * @param reason — Human-readable tag for log output (e.g. "visibilitychange").
	 */
	private reconnectDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	private reconnectAllProviders(reason: string): void {
		if (!this.websocketEnabled) return;

		// Debounce: collapse rapid-fire events into a single reconnect pass.
		if (this.reconnectDebounceTimer !== null) return;
		this.reconnectDebounceTimer = setTimeout(() => {
			this.reconnectDebounceTimer = null;
		}, 150);

		const providers = Array.from(this.websocketProviders.values());
		if (providers.length === 0) return;

		console.info(
			`[yjs-ws] reconnectAllProviders reason=${reason} providers=${providers.length}`
		);

		for (const provider of providers) {
			try {
				// disconnect() closes the WS, sets shouldConnect=false, clears timers.
				provider.disconnect();
				// Reset backoff so the next connect() fires immediately instead of
				// waiting for the accumulated exponential delay.
				(provider as any).wsUnsuccessfulReconnects = 0;
				// connect() sets shouldConnect=true and calls setupWS() which opens
				// a new WebSocket + runs Sync Step 1 on open.
				provider.connect();
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.warn(`[yjs-ws] reconnect failed for room=${provider.roomname}: ${msg}`);
			}
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
			this.connectionSnapshot.registryReady === this.registryHydrated &&
			pendingUnchanged
		) {
			return;
		}

		this.connectionSnapshot = {
			state: this.connectionState,
			hasPendingSync: nextHasPendingSync,
			pendingSyncNoteIds: nextPendingSyncNoteIds,
			registryReady: this.registryHydrated,
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

	/**
	 * Attach an afterTransaction listener on a note doc that automatically
	 * stamps `metadata.updatedAt` with the current epoch-ms on every local
	 * mutation. This covers all edit paths (title, content, checklist items)
	 * without requiring individual editors to manually call touchUpdatedAt.
	 *
	 * The listener is:
	 *   - Skipped for the notes registry doc (registry writes are not user content).
	 *   - Skipped for transactions originated by DocumentManager internals.
	 *   - Skipped for transactions originated by this listener itself (prevents recursion).
	 *   - Only attached once per noteId (tracked via updatedAtDocs set).
	 */
	private ensureUpdatedAtTracking(noteId: string, doc: Y.Doc): void {
		/* Registry doc does not represent user content – no timestamp needed. */
		if (noteId === NOTES_REGISTRY_ID) return;
		/* Already wired for this noteId – avoid double-attach. */
		if (this.updatedAtDocs.has(noteId)) return;
		this.updatedAtDocs.add(noteId);

		const handler = (tx: Y.Transaction): void => {
			/* Only stamp for local user edits, not remote sync or internal writes. */
			if (!tx.local) return;
			if (tx.origin === this.internalOrigin) return;
			if (tx.origin === this.updatedAtOrigin) return;
			/* Use the model-layer touchUpdatedAt so the timestamp format is canonical. */
			touchUpdatedAt(doc, this.updatedAtOrigin);
		};
		doc.on('afterTransaction', handler);

		/* Register cleanup so destroyDoc() detaches the listener. */
		const existingCleanup = this.docCleanup.get(noteId);
		this.docCleanup.set(noteId, () => {
			doc.off('afterTransaction', handler);
			existingCleanup?.();
		});
	}

	/**
	 * Eagerly initialize the notes registry doc (IndexedDB hydration + WS wiring).
	 *
	 * Called once from the constructor so downstream getNotesRegistryDoc() calls
	 * reuse the same cached doc/providers. Sets registryHydrated = true once
	 * IndexedDB syncing completes and emits a connection status update so UI
	 * components gating on registryReady can render.
	 */
	private initializeRegistry(): void {
		this.getNotesRegistryDoc()
			.then(() => {
				this.registryHydrated = true;
				this.emitConnectionStatus();
			})
			.catch((err) => {
				console.error('[DocumentManager] Registry initialization failed:', err);
			});
	}
}

