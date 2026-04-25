import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import { touchUpdatedAt, setNoteTrashed, readTrashState } from './noteModel';
import { RICHTEXT_INTERNAL_ORIGIN } from './richText';
import {
	logClientEvent,
	getOrCreateNoteDebugSessionId,
	clearNoteDebugSession,
	getNoteDebugContext,
	peekNoteDebugContext,
	initIndexedDbDebugLogging,
} from './debugLogger';

const NOTES_REGISTRY_ID = '__notes_registry__';
const NOTES_LIST_KEY = 'notesList';
const NOTE_ORDER_KEY = 'noteOrder';

/**
 * Thrown by getDocReady when the active workspace changes mid-flight.
 * Caught by initializeRegistry to silently abort stale initialization chains.
 */
class WorkspaceChangedError extends Error {
	constructor() {
		super('doc-init aborted: workspace changed');
		this.name = 'WorkspaceChangedError';
	}
}

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
	// True once the registry room has completed at least one WebSocket sync in
	// this session. On a fresh login (empty IDB) docs are ready immediately but
	// content arrives over WS. NoteGrid uses this to keep the shimmer up until
	// the first server sync completes, preventing height-jump layout shifts.
	registryWsSynced: boolean;
	// Number of note rooms that had no IndexedDB content when first loaded.
	// On a fresh install every note doc is an empty Y.Doc stub; the WS sync
	// for each room is what delivers real content. NoteGrid gates the shimmer
	// on this reaching zero so it never shows empty Untitled cards.
	pendingNoteWsSync: number;
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
	/**
	 * Pre-seed the active workspace ID at construction time.
	 *
	 * When the app uses optimistic auth (reading a cached session from
	 * localStorage), the workspace ID is known before React renders. Passing
	 * it here ensures the notes registry is hydrated under the correct
	 * workspace-prefixed room name from the very first tick, avoiding a race
	 * where child component effects start awaiting a non-prefixed room that
	 * gets torn down when setActiveWorkspaceId runs in a parent effect.
	 */
	initialWorkspaceId?: string | null;
};

export class DocumentManager {
	// In-memory caches for active Yjs docs and their persistence/sync providers.
	private readonly docs = new Map<string, Y.Doc>();
	private readonly providers = new Map<string, IndexeddbPersistence>();
	private readonly websocketProviders = new Map<string, WebsocketProvider>();
	private readonly externalRoomAliases = new Map<string, string>();
	private readonly connectionSubscribers = new Set<() => void>();
	// Internal room-level pending tracker. This includes all rooms, then emitConnectionStatus
	// filters out non-user rooms (such as the notes registry) before exposing snapshot data.
	private readonly pendingSyncRooms = new Set<string>();
	// Debounce map: when a room is detected as disconnected during an edit, we wait
	// PENDING_DISPLAY_DEBOUNCE_MS before promoting it into pendingSyncRooms. This
	// prevents brief reconnect windows (e.g. force-reconnect on foreground-resume)
	// from flashing the pending-sync badge for edits that will sync within seconds.
	private static readonly PENDING_DISPLAY_DEBOUNCE_MS = 3_000;
	private readonly pendingSyncQueuedAt = new Map<string, number>();
	private readonly pendingSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
	// Tracks rooms whose WS provider has completed at least one sync in this session.
	// A room is only eligible for the "pending sync" badge after its first WS sync,
	// preventing false positives during the initial boot window (IDB hydrated but WS
	// not yet connected). Before first sync, the connection header already shows
	// "connecting" which is sufficient feedback.
	private readonly wsEverSynced = new Set<string>();
	// Tracks note rooms (not registry) whose Y.Doc had no content in IndexedDB at
	// load time. On a fresh install these are stub docs that will receive real
	// content on their first WS sync. Decrements as each room syncs. NoteGrid
	// reads pendingNoteWsSync (= this.noIdbContentRooms.size) to hold the shimmer
	// until all note content has arrived, preventing empty-card flashes.
	private readonly noIdbContentRooms = new Set<string>();
	private readonly wsCleanup = new Map<string, () => void>();
	private readonly docCleanup = new Map<string, () => void>();
	private readonly readyPromises = new Map<string, Promise<void>>();
	private readonly readyPromiseResolvers = new Map<string, () => void>();
	private readonly websocketReadyPromises = new Map<string, Promise<void>>();
	private readonly websocketUrl: string;
	// Opt-in verbose websocket lifecycle logging. Keep disabled by default so
	// normal editing/drag interactions don't flood the console or add overhead.
	private readonly wsDebug = ((import.meta as any).env?.VITE_DEBUG_YJS_WS === '1');
	private websocketEnabled: boolean;
	// Active workspace ID used to namespace Yjs room names.
	//
	// Why namespacing matters:
	// - The server persists documents by Yjs room name (docId) and the schema
	//   enforces docId uniqueness globally.
	// - Multi-workspace support therefore requires room names to be unique per
	//   workspace (e.g. "<workspaceId>:__notes_registry__").
	// - Namespacing the room name also keeps the client-side IndexedDB cache
	//   separated per workspace.
	private activeWorkspaceId: string | null = null;
	private readonly internalOrigin = Symbol('DocumentManagerInternal');
	private readonly accessOrigin = Symbol('DocumentManagerAccess');
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
	// Becomes true once the registry room fires onSync(true) for the first time.
	// Cleared on workspace switch so fresh logins to new workspaces also wait.
	private registryWsSynced = false;
	private connectionSnapshot: ConnectionSnapshot = {
		state: 'connecting',
		hasPendingSync: false,
		pendingSyncNoteIds: [],
		registryReady: false,
		registryWsSynced: false,
		pendingNoteWsSync: 0,
	};
	// Cleanup function for the global visibility lifecycle listeners that
	// trigger reconnect-on-foreground behavior. Stored so the manager can be
	// torn down cleanly in tests or hot-module-replacement scenarios.
	private readonly lifecycleCleanup: (() => void) | null = null;
	private onlineReconnectTimer: number | null = null;

	public constructor(websocketUrl = 'ws://localhost:1234', options?: DocumentManagerOptions) {
		// Normalize trailing slashes to avoid duplicate room URLs.
		this.websocketUrl = String(websocketUrl || 'ws://localhost:1234').replace(/\/+$/, '');
		this.websocketEnabled = options?.enableWebsocketSync ?? true;

		initIndexedDbDebugLogging();

		// Pre-seed workspace so room names use the correct prefix from the start.
		const initialWs = typeof options?.initialWorkspaceId === 'string' ? options.initialWorkspaceId.trim() : '';
		if (initialWs.length > 0) {
			this.activeWorkspaceId = initialWs;
		}

		if (typeof window !== 'undefined') {
			const clearOnlineReconnectTimer = (): void => {
				if (this.onlineReconnectTimer !== null) {
					window.clearTimeout(this.onlineReconnectTimer);
					this.onlineReconnectTimer = null;
				}
			};
			const disconnectProvidersForOffline = (): void => {
				for (const provider of this.websocketProviders.values()) {
					try {
						provider.disconnect();
					} catch {
						// Best effort: browser offline transitions can race with provider teardown.
					}
				}
			};
			const onOnline = (): void => {
				this.browserOnline = true;
				this.updateConnectionState();
				this.emitConnectionStatus();
				// Delay reconnect long enough for App's online handler to replay queued
				// workspace mutations first. Offline-created workspaces are not yet
				// authorized on the server at the instant connectivity returns, so
				// reconnecting their Yjs rooms immediately can trigger forbidden closes
				// and exponential backoff before the workspace replay completes.
				clearOnlineReconnectTimer();
				this.onlineReconnectTimer = window.setTimeout(() => {
					this.onlineReconnectTimer = null;
					if (!this.browserOnline || !this.websocketEnabled) return;
					this.reconnectAllProviders('online-event');
				}, 1500);
			};
			const onOffline = (): void => {
				clearOnlineReconnectTimer();
				this.browserOnline = false;
				disconnectProvidersForOffline();
				this.updateConnectionState();
				this.emitConnectionStatus();
			};

			window.addEventListener('online', onOnline);
			window.addEventListener('offline', onOffline);

			// ── Visibility lifecycle ─────────────────────────────────────
			// Mobile browsers (iOS Safari, Android Chrome) aggressively suspend
			// background tabs, silently closing WebSocket connections without
			// firing `close` events. When the user returns to the tab, the Yjs
			// provider thinks it is still connected but the underlying socket
			// is dead. We detect the tab returning to the foreground via the
			// Page Visibility API, then force-disconnect and
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

			if (typeof document !== 'undefined') {
				document.addEventListener('visibilitychange', onVisibilityChange);
			}

			this.lifecycleCleanup = () => {
				clearOnlineReconnectTimer();
				window.removeEventListener('online', onOnline);
				window.removeEventListener('offline', onOffline);
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
		// Skip when no workspace is set and sync is disabled (auth-gated flow):
		// the room would use an un-prefixed name that gets torn down as soon as
		// setActiveWorkspaceId is called, potentially orphaning in-flight Promises.
		logClientEvent('APP_BOOTSTRAP', {
			event: 'document-manager-init',
			workspaceId: this.activeWorkspaceId,
			wsEnabled: this.websocketEnabled,
			browserOnline: this.browserOnline,
		});
		if (this.activeWorkspaceId || this.websocketEnabled) {
			this.initializeRegistry();
		}
	}

	public getAccessOrigin(): symbol {
		return this.accessOrigin;
	}

	public setActiveWorkspaceId(workspaceId: string | null): void {
		const normalized = typeof workspaceId === 'string' ? workspaceId.trim() : '';
		const next = normalized.length > 0 ? normalized : null;
		if (this.activeWorkspaceId === next) return;

		logClientEvent('WORKSPACE_SWITCH', {
			event: 'set-active-workspace',
			from: this.activeWorkspaceId,
			to: next,
			wsEnabled: this.websocketEnabled,
			cachedDocCount: this.docs.size,
		});

		if (next === null) {
			// Logout / auth loss: full tear-down to free all resources.
			this.teardownAllRooms();
		} else {
			// Workspace switch: disconnect and discard WebSocket providers only.
			//
			// Room names embed the workspace ID (e.g. "wsA:__notes_registry__"),
			// so Y.Doc instances and IDB providers for the old workspace are entirely
			// isolated from the new workspace's rooms.  Keeping them alive means that
			// when the user switches back, getDocReady() finds the doc already in
			// this.docs with its ready-promise already resolved — instant return,
			// no IDB wait, no skeleton shimmer on revisit.
			//
			// WS providers MUST be discarded: they authenticate against a specific
			// workspace namespace and must not reconnect to the wrong one.
			for (const roomName of Array.from(this.websocketProviders.keys())) {
				this.wsCleanup.get(roomName)?.();
				this.wsCleanup.delete(roomName);
				// Also remove the doc-level onAfterTransaction handler so stale closures
				// that reference the now-destroyed WS provider can't fire later and
				// incorrectly mark the room as pending-sync (the destroyed provider has
				// wsconnected = undefined which is falsy).
				this.docCleanup.get(roomName)?.();
				this.docCleanup.delete(roomName);
				const wsProvider = this.websocketProviders.get(roomName);
				this.websocketProviders.delete(roomName);
				this.websocketReadyPromises.delete(roomName);
				try {
					wsProvider?.disconnect?.();
					wsProvider?.destroy?.();
				} catch {
					// ignore
				}
			}
			this.pendingSyncRooms.clear();
			for (const timer of this.pendingSyncTimers.values()) clearTimeout(timer);
			this.pendingSyncTimers.clear();
			this.pendingSyncQueuedAt.clear();
			this.wsEverSynced.clear();
			this.noIdbContentRooms.clear();
			this.updatedAtDocs.clear();
			this.registryHydrated = false;
			this.registryWsSynced = false;
		}

		this.activeWorkspaceId = next;
		this.registryHydrated = false;
		this.updateConnectionState();
		this.emitConnectionStatus();
		// Null workspace means logout / auth loss — skip registry re-init.
		if (next) {
			this.initializeRegistry();
		}
	}

	/** Returns the currently active workspace ID, or null if no workspace is active. */
	public getActiveWorkspaceId(): string | null {
		return this.activeWorkspaceId;
	}

	public setWebsocketEnabled(enabled: boolean): void {
		// This is intentionally idempotent and safe to call frequently.
		// The App uses it to turn sync on/off based on authentication state.
		const next = enabled === true;
		if (this.websocketEnabled === next) return;
		this.websocketEnabled = next;
		if (!next && typeof window !== 'undefined' && this.onlineReconnectTimer !== null) {
			window.clearTimeout(this.onlineReconnectTimer);
			this.onlineReconnectTimer = null;
		}

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

	public setExternalRoomAliases(aliases: Readonly<Record<string, string>>): void {
		const nextAliases = new Map<string, string>();
		for (const [aliasId, roomName] of Object.entries(aliases || {})) {
			const normalizedAliasId = typeof aliasId === 'string' ? aliasId.trim() : '';
			const normalizedRoomName = typeof roomName === 'string' ? roomName.trim() : '';
			if (!normalizedAliasId || !normalizedRoomName) continue;
			nextAliases.set(normalizedAliasId, normalizedRoomName);
		}

		const previousRoomNames = new Set(this.externalRoomAliases.values());
		const nextRoomNames = new Set(nextAliases.values());
		for (const roomName of previousRoomNames) {
			if (nextRoomNames.has(roomName)) continue;
			this.pendingSyncRooms.delete(roomName);
			if (this.docs.has(roomName)) {
				this.destroyRoom(roomName);
			}
		}

		for (const [aliasId, roomName] of nextAliases.entries()) {
			const rawAliasRoomName = this.activeWorkspaceId ? `${this.activeWorkspaceId}:${aliasId}` : aliasId;
			if (rawAliasRoomName === roomName) continue;
			this.pendingSyncRooms.delete(rawAliasRoomName);
			if (this.docs.has(rawAliasRoomName)) {
				this.destroyRoom(rawAliasRoomName);
			}
		}

		this.externalRoomAliases.clear();
		for (const [aliasId, roomName] of nextAliases.entries()) {
			this.externalRoomAliases.set(aliasId, roomName);
		}

		this.emitConnectionStatus();
	}

	public hasDoc(noteId: string): boolean {
		const raw = this.normalizeNoteId(noteId);
		return this.docs.has(this.roomNameFor(raw));
	}

	public peekDoc(noteId: string): Y.Doc | null {
		const raw = this.normalizeNoteId(noteId);
		return this.docs.get(this.roomNameFor(raw)) ?? null;
	}

	public resolveRoomName(noteId: string): string {
		const raw = this.normalizeNoteId(noteId);
		return this.roomNameFor(raw);
	}

	/** Returns the Yjs WebSocket server URL used by this manager. */
	public getWebsocketUrl(): string {
		return this.websocketUrl;
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
		const raw = this.normalizeNoteId(noteId);
		return this.getOrCreateDocEntry(raw).doc;
	}

	private getOrCreateDocEntry(rawNoteId: string): { key: string; doc: Y.Doc } {
		const key = this.roomNameFor(rawNoteId);

		const existing = this.docs.get(key);
		if (existing) {
			this.ensureStructure(existing);
			this.ensureProvider(key, existing);
			return { key, doc: existing };
		}

		getOrCreateNoteDebugSessionId(key);
		logClientEvent('DOC_LIFECYCLE', { ...getNoteDebugContext(key), event: 'doc-create' });

		// Create once, register immediately to prevent accidental duplicate creation
		// if higher-level code re-enters getDoc during initialization.
		const doc = new Y.Doc();
		this.docs.set(key, doc);

		this.ensureStructure(doc);
		this.ensureProvider(key, doc);
		this.ensureUpdatedAtTracking(key, doc);
		return { key, doc };
	}

	public async getDocReady(noteId: string): Promise<Y.Doc> {
		const raw = this.normalizeNoteId(noteId);
		// Capture the workspace at call time so we can detect mid-flight switches.
		// If setActiveWorkspaceId is called while we are waiting for IDB hydration,
		// the room we just created belongs to the wrong workspace and must be abandoned.
		const expectedWorkspaceId = this.activeWorkspaceId;
		for (let attempt = 0; attempt < 4; attempt++) {
			// Guard: abort if workspace changed between retries.
			if (this.activeWorkspaceId !== expectedWorkspaceId) {
				throw new WorkspaceChangedError();
			}
			const { key, doc } = this.getOrCreateDocEntry(raw);
			const ready = this.readyPromises.get(key);
			if (!ready) {
				// getDoc() should always install a provider + ready promise.
				throw new Error(`Document provider was not initialized for noteId: ${key}`);
			}
			await ready;
			// Guard: abort if workspace changed while waiting for IDB hydration.
			// Without this check a teardownAllRooms() during the await resolves the
			// ready promise vacuously; on retry getOrCreateDocEntry uses the new
			// (possibly null) workspace ID and creates a disconnected unscoped provider,
			// leaving websocketProviders with a permanently-offline entry.
			if (this.activeWorkspaceId !== expectedWorkspaceId) {
				throw new WorkspaceChangedError();
			}
			if (this.docs.get(key) === doc) {
				return doc;
			}
		}
		throw new Error(`Document room kept changing before sync completed: ${this.roomNameFor(raw)}`);
	}

	public async getDocWithSync(noteId: string): Promise<Y.Doc> {
		const raw = this.normalizeNoteId(noteId);
		const doc = await this.getDocReady(raw);
		const roomName = this.roomNameFor(raw);
		// Track note rooms with no IDB content (empty Y.Doc stubs on fresh install).
		// These rooms need their first WS sync before they have real content; NoteGrid
		// holds the shimmer until pendingNoteWsSync reaches zero.
		if (!this.isNotesRegistryRoom(roomName) && !this.noIdbContentRooms.has(roomName) && !this.wsEverSynced.has(roomName)) {
			const hasIdbContent = (doc.store as { clients?: Map<unknown, unknown[]> }).clients?.size ?? 0 > 0;
			if (!hasIdbContent) {
				this.noIdbContentRooms.add(roomName);
				this.emitConnectionStatus();
			}
		}
		this.ensureWebsocketProvider(roomName, doc);
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

	/**
	 * Return the Yjs layout map from the notes-registry doc.
	 * Currently stores 'columnSlots' (number[]) — the number of cards per
	 * column at the last drag-and-drop commit.  Other devices read this to
	 * reconstruct the same column grouping via splitIntoColumnsBySlotLengths,
	 * avoiding height-based packing divergence across viewports.
	 */
	public async getNoteLayout(): Promise<Y.Map<unknown>> {
		const doc = await this.getNotesRegistryDoc();
		return doc.getMap('noteLayout');
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

	public async moveNoteToWorkspaceLocally(noteId: string, targetWorkspaceId: string, opts?: { sourceWorkspaceId?: string | null; title?: string | null }): Promise<void> {
		const key = this.normalizeNoteId(noteId);
		const sourceWorkspaceId = typeof opts?.sourceWorkspaceId === 'string' && opts.sourceWorkspaceId.trim()
			? opts.sourceWorkspaceId.trim()
			: this.activeWorkspaceId;
		const normalizedTargetWorkspaceId = typeof targetWorkspaceId === 'string' ? targetWorkspaceId.trim() : '';
		if (!sourceWorkspaceId) {
			throw new Error('Cannot move a note without an active source workspace');
		}
		if (!normalizedTargetWorkspaceId) {
			throw new Error('Target workspace is required');
		}
		if (sourceWorkspaceId !== this.activeWorkspaceId) {
			throw new Error('Local note moves require the source workspace to be active');
		}
		if (normalizedTargetWorkspaceId === sourceWorkspaceId) {
			return;
		}

		const sourceDoc = await this.getDocWithSync(key);
		const noteTitle = String(opts?.title || sourceDoc.getText('title').toString() || key).trim() || key;
		const noteState = Y.encodeStateAsUpdate(sourceDoc);
		const targetNoteRoomName = `${normalizedTargetWorkspaceId}:${key}`;
		const targetRegistryRoomName = `${normalizedTargetWorkspaceId}:${NOTES_REGISTRY_ID}`;
		const targetNoteRoom = await this.openIsolatedRoom(targetNoteRoomName, { initializeRegistry: false });
		const targetRegistryRoom = await this.openIsolatedRoom(targetRegistryRoomName, { initializeRegistry: true });

		try {
			Y.applyUpdate(targetNoteRoom.doc, noteState);
			this.upsertRegistryNoteEntry(targetRegistryRoom.doc, key, noteTitle);
			const sourceRegistryDoc = await this.getNotesRegistryDoc();
			this.removeRegistryNoteEntry(sourceRegistryDoc, key);
			await this.waitForPersistenceTurn();
			this.destroyDoc(key);
			await this.deleteIndexedDbDatabase(`${sourceWorkspaceId}:${key}`);
		} finally {
			targetNoteRoom.destroy();
			targetRegistryRoom.destroy();
		}
	}

	public destroyDoc(noteId: string): void {
		const raw = this.normalizeNoteId(noteId);
		this.destroyRoom(this.roomNameFor(raw));
	}

	private destroyRoom(roomName: string): void {
		const doc = this.docs.get(roomName);
		if (!doc) return;

		logClientEvent('DOC_LIFECYCLE', { ...peekNoteDebugContext(roomName), event: 'doc-destroy' });
		clearNoteDebugSession(roomName);

		const wsProvider = this.websocketProviders.get(roomName);
		const provider = this.providers.get(roomName);

		this.docs.delete(roomName);
		this.providers.delete(roomName);
		this.websocketProviders.delete(roomName);
		this.readyPromiseResolvers.get(roomName)?.();
		this.readyPromiseResolvers.delete(roomName);
		this.readyPromises.delete(roomName);
		this.websocketReadyPromises.delete(roomName);
		this.pendingSyncRooms.delete(roomName);
		{
			const timer = this.pendingSyncTimers.get(roomName);
			if (timer !== undefined) clearTimeout(timer);
			this.pendingSyncTimers.delete(roomName);
		}
		this.pendingSyncQueuedAt.delete(roomName);
		this.wsEverSynced.delete(roomName);
		this.updatedAtDocs.delete(roomName);

		this.wsCleanup.get(roomName)?.();
		this.docCleanup.get(roomName)?.();
		this.wsCleanup.delete(roomName);
		this.docCleanup.delete(roomName);

		try {
			wsProvider?.disconnect?.();
			wsProvider?.destroy?.();
		} catch {
			// ignore
		}
		try {
			provider?.destroy?.();
		} catch {
			// ignore
		}
		doc.destroy();
		this.updateConnectionState();
		this.emitConnectionStatus();
	}

	private teardownAllRooms(): void {
		// Copy keys first since destroyRoom mutates the map.
		const rooms = Array.from(this.docs.keys());
		for (const roomName of rooms) {
			this.destroyRoom(roomName);
		}
		this.pendingSyncRooms.clear();
		for (const timer of this.pendingSyncTimers.values()) clearTimeout(timer);
		this.pendingSyncTimers.clear();
		this.pendingSyncQueuedAt.clear();
		this.wsEverSynced.clear();
		this.noIdbContentRooms.clear();
		this.updatedAtDocs.clear();
		this.registryHydrated = false;
		this.registryWsSynced = false;
	}

	private ensureRegistryStructure(doc: Y.Doc): void {
		doc.transact(() => {
			doc.getArray<Y.Map<any>>(NOTES_LIST_KEY);
			doc.getArray<string>(NOTE_ORDER_KEY);
			doc.getMap('noteLayout');
		}, this.internalOrigin);
	}

	private removeRegistryNoteEntry(doc: Y.Doc, noteId: string): void {
		this.ensureRegistryStructure(doc);
		const notesList = doc.getArray<Y.Map<any>>(NOTES_LIST_KEY);
		const noteOrder = doc.getArray<string>(NOTE_ORDER_KEY);
		const normalizedNoteId = this.normalizeNoteId(noteId);
		doc.transact(() => {
			for (let index = notesList.length - 1; index >= 0; index--) {
				const item = notesList.get(index);
				if (String(item?.get?.('id') ?? '').trim() === normalizedNoteId) {
					notesList.delete(index, 1);
				}
			}
			for (let index = noteOrder.length - 1; index >= 0; index--) {
				if (String(noteOrder.get(index) ?? '').trim() === normalizedNoteId) {
					noteOrder.delete(index, 1);
				}
			}
		}, this.internalOrigin);
	}

	private upsertRegistryNoteEntry(doc: Y.Doc, noteId: string, title: string): void {
		this.ensureRegistryStructure(doc);
		const notesList = doc.getArray<Y.Map<any>>(NOTES_LIST_KEY);
		const noteOrder = doc.getArray<string>(NOTE_ORDER_KEY);
		const normalizedNoteId = this.normalizeNoteId(noteId);
		doc.transact(() => {
			for (let index = notesList.length - 1; index >= 0; index--) {
				const item = notesList.get(index);
				if (String(item?.get?.('id') ?? '').trim() === normalizedNoteId) {
					notesList.delete(index, 1);
				}
			}
			const entry = new Y.Map<any>();
			entry.set('id', normalizedNoteId);
			entry.set('title', String(title || ''));
			notesList.insert(0, [entry]);
			for (let index = noteOrder.length - 1; index >= 0; index--) {
				if (String(noteOrder.get(index) ?? '').trim() === normalizedNoteId) {
					noteOrder.delete(index, 1);
				}
			}
			noteOrder.insert(0, [normalizedNoteId]);
		}, this.internalOrigin);
	}

	private ensureStructure(doc: Y.Doc): void {
		// Yjs root types are created on first access and are stable thereafter.
		// Re-running this method is safe and will not create duplicates.
		// All four root types that constitute the canonical note shape are
		// pre-initialized here so downstream code can assume they exist.
		doc.transact(() => {
			doc.getText('title');
			doc.getText('content');
			doc.getXmlFragment('contentRich');
			doc.getArray<Y.Map<any>>('checklist');
			doc.getMap<any>('metadata');
		}, this.internalOrigin);
	}

	private async openIsolatedRoom(roomName: string, opts?: { initializeRegistry?: boolean }): Promise<{ doc: Y.Doc; destroy: () => void }> {
		if (typeof (globalThis as any).indexedDB === 'undefined') {
			throw new Error('IndexedDB is not available in this runtime');
		}
		const doc = new Y.Doc();
		if (opts?.initializeRegistry) this.ensureRegistryStructure(doc);
		else this.ensureStructure(doc);
		const provider = new IndexeddbPersistence(roomName, doc);
		await this.waitForIsolatedProviderSynced(provider);
		return {
			doc,
			destroy: () => {
				try {
					provider.destroy();
				} catch {
					// ignore
				}
				try {
					doc.destroy();
				} catch {
					// ignore
				}
			},
		};
	}

	private waitForIsolatedProviderSynced(provider: IndexeddbPersistence): Promise<void> {
		if ((provider as any).synced === true) {
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
			queueMicrotask(() => {
				if ((provider as any).synced === true) {
					onSynced();
				}
			});
		});
	}

	private waitForPersistenceTurn(): Promise<void> {
		return new Promise((resolve) => {
			if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
				window.setTimeout(resolve, 0);
				return;
			}
			setTimeout(resolve, 0);
		});
	}

	private deleteIndexedDbDatabase(name: string): Promise<void> {
		if (typeof indexedDB === 'undefined' || !name) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			try {
				const request = indexedDB.deleteDatabase(name);
				request.onsuccess = () => resolve();
				request.onerror = () => resolve();
				request.onblocked = () => resolve();
			} catch {
				resolve();
			}
		});
	}

	private ensureProvider(roomName: string, doc: Y.Doc): void {
		if (this.providers.has(roomName)) {
			return;
		}

		if (typeof (globalThis as any).indexedDB === 'undefined') {
			throw new Error(
				'IndexedDB is not available in this runtime. ' +
					'DocumentManager requires IndexedDB for offline persistence (y-indexeddb).'
			);
		}

		// One IndexedDB room per Yjs room name.
		const provider = new IndexeddbPersistence(roomName, doc);
		this.providers.set(roomName, provider);
		logClientEvent('IDB_LIFECYCLE', { ...peekNoteDebugContext(roomName), event: 'hydration-start' });

		if (!this.readyPromises.has(roomName)) {
			this.readyPromises.set(roomName, this.waitForSynced(roomName, provider));
		}
	}

	private ensureWebsocketProvider(roomName: string, doc: Y.Doc): void {
		const existing = this.websocketProviders.get(roomName);
		if (existing) {
			if (!this.websocketReadyPromises.has(roomName)) {
				this.websocketReadyPromises.set(roomName, this.waitForWebsocketConnected(existing));
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
		const wsProvider = new WebsocketProvider(this.websocketUrl, roomName, doc, {
			connect: this.websocketEnabled,
			resyncInterval: 30_000,
			maxBackoffTime: 5_000,
		});

		logClientEvent('WS_LIFECYCLE', { ...peekNoteDebugContext(roomName), event: 'ws-provider-create' });

		const onStatus = (event: { status: string }): void => {
			logClientEvent('WS_LIFECYCLE', { ...peekNoteDebugContext(roomName), event: 'ws-status', status: event.status });
			if (this.wsDebug) {
				console.info(`[yjs-ws] room=${roomName} status=${event.status} url=${this.websocketUrl}`);
			}
			this.updateConnectionState();
			this.emitConnectionStatus();
		};
		const onConnectionClose = (): void => {
			if (this.wsDebug) {
				console.info(`[yjs-ws] room=${roomName} connection-close url=${this.websocketUrl}`);
			}
			this.updateConnectionState();
			this.emitConnectionStatus();
		};
		const onConnectionError = (err: unknown): void => {
			const msg = err instanceof Error ? err.message : String(err);
			if (this.browserOnline) {
				console.warn(`[yjs-ws] room=${roomName} connection-error=${msg} url=${this.websocketUrl}`);
			} else if (this.wsDebug) {
				console.info(`[yjs-ws] room=${roomName} connection-error=${msg} url=${this.websocketUrl} offline=true`);
			}
			this.updateConnectionState();
			this.emitConnectionStatus();
		};
		const onSync = (isSynced: boolean): void => {
			logClientEvent('WS_LIFECYCLE', { ...peekNoteDebugContext(roomName), event: 'ws-sync', isSynced });
			if (isSynced) {
				this.wsEverSynced.add(roomName);
				// Mark the registry as WS-synced for the first time. NoteGrid uses this
				// to hold the shimmer up until server content is available, preventing
				// layout shifts on fresh login when IDB is empty.
				if (this.isNotesRegistryRoom(roomName) && !this.registryWsSynced) {
					this.registryWsSynced = true;
				}
				// If this room had no IDB content at load time, it now has content from
				// the server — remove it from the pending set so NoteGrid can lift the shimmer.
				this.noIdbContentRooms.delete(roomName);
				// Clear any queued promotion — sync beat the debounce, no icon needed.
				const timer = this.pendingSyncTimers.get(roomName);
				if (timer !== undefined) {
					clearTimeout(timer);
					this.pendingSyncTimers.delete(roomName);
				}
				this.pendingSyncQueuedAt.delete(roomName);
				this.pendingSyncRooms.delete(roomName);
				this.emitConnectionStatus();
			}
		};
		const onAfterTransaction = (tx: Y.Transaction): void => {
			if (!tx.local) return;
			if (tx.origin === this.internalOrigin) return;
			if (tx.origin === this.accessOrigin) return;
			if (tx.origin === this.updatedAtOrigin) return;
			if (tx.origin === RICHTEXT_INTERNAL_ORIGIN) return;
			// Registry room writes (order/title metadata) should not produce per-note pending badges.
			// Without this filter, routine registry mutations could produce false-positive sync indicators
			// after refresh/startup even when no actual note content edits occurred offline.
			if (this.isNotesRegistryRoom(roomName)) return;
			// Skip transactions that didn't actually change any Y.Types (e.g. structure
			// assertions, read-only bindings). Without this guard, editor mount can mark a
			// room as pending even when no content was modified.
			if (tx.changed.size === 0) return;
			// Only flag as pending-sync if this room has completed at least one WS
			// sync in this session. Before that, we don't know whether IDB state
			// diverges from the server — the connection header already shows
			// "connecting" which is sufficient feedback during the startup window.
			if (!this.wsEverSynced.has(roomName)) return;
			const connected = (wsProvider as any).wsconnected === true;
			if (!connected && !this.pendingSyncQueuedAt.has(roomName)) {
				// Debounce: queue the room and promote to displayed-pending only if it
				// remains disconnected after PENDING_DISPLAY_DEBOUNCE_MS. This prevents
				// brief reconnect windows (e.g. force-reconnect on foreground-resume)
				// from flashing the sync-pending badge for edits that will sync within
				// seconds without any user action required.
				this.pendingSyncQueuedAt.set(roomName, Date.now());
				const timer = setTimeout(() => {
					this.pendingSyncTimers.delete(roomName);
					if (!this.pendingSyncQueuedAt.has(roomName)) return; // cleared by sync
					const stillConnected = (wsProvider as any).wsconnected === true;
					if (!stillConnected) {
						this.pendingSyncRooms.add(roomName);
						this.emitConnectionStatus();
					} else {
						// Reconnected before debounce fired — discard the queue entry.
						this.pendingSyncQueuedAt.delete(roomName);
					}
				}, DocumentManager.PENDING_DISPLAY_DEBOUNCE_MS);
				this.pendingSyncTimers.set(roomName, timer);
			}
		};

		(wsProvider as any).on?.('status', onStatus);
		(wsProvider as any).on?.('connection-close', onConnectionClose);
		(wsProvider as any).on?.('connection-error', onConnectionError);
		(wsProvider as any).on?.('sync', onSync);
		doc.on('afterTransaction', onAfterTransaction);

		this.websocketProviders.set(roomName, wsProvider);
		this.wsCleanup.set(roomName, () => {
			(wsProvider as any).off?.('status', onStatus);
			(wsProvider as any).off?.('connection-close', onConnectionClose);
			(wsProvider as any).off?.('connection-error', onConnectionError);
			(wsProvider as any).off?.('sync', onSync);
		});
		this.docCleanup.set(roomName, () => {
			doc.off('afterTransaction', onAfterTransaction);
		});
		if (!this.websocketReadyPromises.has(roomName)) {
			this.websocketReadyPromises.set(roomName, this.waitForWebsocketConnected(wsProvider));
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
	 * The method uses a short timestamp throttle so rapid successive foreground
	 * events only trigger one reconnect cycle.
	 *
	 * @param reason — Human-readable tag for log output (e.g. "visibilitychange").
	 */
	private lastReconnectAt = 0;

	public reconnectAllProviders(reason: string): void {
		if (!this.websocketEnabled) return;
		if (!this.browserOnline) return;

		// Throttle: collapse rapid-fire events into a single reconnect pass.
		const now = Date.now();
		if (now - this.lastReconnectAt < 250) return;
		this.lastReconnectAt = now;

		const providers = Array.from(this.websocketProviders.values());
		if (providers.length === 0) return;

		if (this.wsDebug) {
			console.info(
				`[yjs-ws] reconnectAllProviders reason=${reason} providers=${providers.length}`
			);
		}

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
		const prev = this.connectionState;
		if (!this.browserOnline) {
			this.connectionState = 'offline';
		} else if (this.websocketProviders.size === 0) {
			this.connectionState = 'connecting';
		} else {
			const providers = Array.from(this.websocketProviders.values());
			const anyConnected = providers.some((provider) => (provider as any).wsconnected === true);
			if (anyConnected) {
				this.connectionState = 'connected';
			} else {
				// During y-websocket's exponential backoff, wsconnecting is temporarily
				// false while shouldConnect remains true (the provider still intends to
				// reconnect). Without this check, the UI flashes 'offline' red during
				// every backoff interval even though a reconnect is imminent.
				const anyConnecting = providers.some(
					(provider) => (provider as any).wsconnecting === true || (provider as any).shouldConnect === true
				);
				if (anyConnecting) {
					this.connectionState = 'connecting';
				} else if (!this.websocketEnabled) {
					// WS is intentionally disabled (e.g. auth gate before session probe
					// completes). Treat as "connecting" rather than "offline" because the
					// app is still initializing — not genuinely disconnected.
					this.connectionState = 'connecting';
				} else {
					this.connectionState = 'offline';
				}
			}
		}
		if (prev !== this.connectionState) {
			logClientEvent('CONNECTION_STATE', {
				event: 'state-change',
				from: prev,
				to: this.connectionState,
				wsProviders: this.websocketProviders.size,
				browserOnline: this.browserOnline,
			});
		}
	}

	private emitConnectionStatus(): void {
		// Derive and sort snapshot IDs for stable identity semantics.
		// Stable ordering prevents unnecessary React external-store emissions and keeps
		// subscribe/update behavior deterministic across browsers.
		const nextPendingSyncNoteIds = Array.from(this.pendingSyncRooms)
			.filter((roomId) => !this.isNotesRegistryRoom(roomId))
			.map((roomId) => this.rawNoteIdFromRoomName(roomId))
			.sort();
		const nextHasPendingSync = nextPendingSyncNoteIds.length > 0;
		const nextPendingNoteWsSync = this.noIdbContentRooms.size;
		const pendingUnchanged =
			this.connectionSnapshot.pendingSyncNoteIds.length === nextPendingSyncNoteIds.length &&
			this.connectionSnapshot.pendingSyncNoteIds.every((id, index) => id === nextPendingSyncNoteIds[index]);
		if (
			this.connectionSnapshot.state === this.connectionState &&
			this.connectionSnapshot.hasPendingSync === nextHasPendingSync &&
			this.connectionSnapshot.registryReady === this.registryHydrated &&
			this.connectionSnapshot.registryWsSynced === this.registryWsSynced &&
			this.connectionSnapshot.pendingNoteWsSync === nextPendingNoteWsSync &&
			pendingUnchanged
		) {
			return;
		}

		this.connectionSnapshot = {
			state: this.connectionState,
			hasPendingSync: nextHasPendingSync,
			pendingSyncNoteIds: nextPendingSyncNoteIds,
			registryReady: this.registryHydrated,
			registryWsSynced: this.registryWsSynced,
			pendingNoteWsSync: nextPendingNoteWsSync,
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

	private waitForSynced(roomName: string, provider: IndexeddbPersistence): Promise<void> {
		const alreadySynced = (provider as any).synced === true;
		if (alreadySynced) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve, reject) => {
			this.readyPromiseResolvers.set(roomName, () => {
				cleanup();
				resolve();
			});

			const onSynced = (): void => {
				logClientEvent('IDB_LIFECYCLE', { ...peekNoteDebugContext(roomName), event: 'hydration-end' });
				cleanup();
				resolve();
			};

			const onError = (error: unknown): void => {
				logClientEvent('IDB_LIFECYCLE', { ...peekNoteDebugContext(roomName), event: 'hydration-error', error: error instanceof Error ? error.message : String(error) });
				cleanup();
				reject(error instanceof Error ? error : new Error(String(error)));
			};

			const cleanup = (): void => {
				this.readyPromiseResolvers.delete(roomName);
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

	private roomNameFor(rawNoteId: string): string {
		const externalRoomName = this.externalRoomAliases.get(rawNoteId);
		if (externalRoomName) return externalRoomName;
		// Room names are globally unique across workspaces.
		// If no active workspace is set yet (auth gate), fall back to raw IDs.
		if (!this.activeWorkspaceId) return rawNoteId;
		return `${this.activeWorkspaceId}:${rawNoteId}`;
	}

	private rawNoteIdFromRoomName(roomName: string): string {
		for (const [aliasId, aliasedRoomName] of this.externalRoomAliases.entries()) {
			if (aliasedRoomName === roomName) return aliasId;
		}
		if (!this.activeWorkspaceId) {
			// Best-effort: if the room looks namespaced, strip the first segment.
			const idx = roomName.indexOf(':');
			return idx > 0 ? roomName.slice(idx + 1) : roomName;
		}
		const prefix = `${this.activeWorkspaceId}:`;
		return roomName.startsWith(prefix) ? roomName.slice(prefix.length) : roomName;
	}

	private isNotesRegistryRoom(roomName: string): boolean {
		return roomName === NOTES_REGISTRY_ID || roomName.endsWith(`:${NOTES_REGISTRY_ID}`);
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
		if (this.isNotesRegistryRoom(noteId)) return;
		/* Already wired for this noteId – avoid double-attach. */
		if (this.updatedAtDocs.has(noteId)) return;
		this.updatedAtDocs.add(noteId);

		const handler = (tx: Y.Transaction): void => {
			/* Only stamp for local user edits, not remote sync or internal writes. */
			if (!tx.local) return;
			if (tx.origin === this.internalOrigin) return;
			if (tx.origin === this.accessOrigin) return;
			if (tx.origin === this.updatedAtOrigin) return;
			if (tx.origin === RICHTEXT_INTERNAL_ORIGIN) return;
			// Guard: a transaction with no actual Yjs map/array changes (e.g. a
			// metadata-only read that wrote `lastAccessedAt` as a side-effect)
			// should not advance `updatedAt` and trigger a bubble score bump.
			if (tx.changed.size === 0) return;
			// Optional diagnostics — enable via window.DEBUG = true in DevTools.
			if (window.DEBUG) {
				console.debug('[BubbleScore] touchUpdatedAt triggered', noteId, 'tx.origin=', tx.origin);
			}
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
	 * Discover all workspace IDs that currently have IndexedDB data stored locally.
	 *
	 * Uses `indexedDB.databases()` to enumerate all room databases and extracts the
	 * unique workspace-ID prefix from each `${workspaceId}:${docId}` database name.
	 * Returns an empty array when the API is unavailable.
	 */
	public async discoverLocalWorkspaceIds(): Promise<string[]> {
		if (typeof (globalThis as any).indexedDB === 'undefined') return [];
		try {
			if (typeof (indexedDB as any).databases !== 'function') return [];
			const allDbs: { name?: string }[] = await (indexedDB as any).databases();
			const workspaceIds = new Set<string>();
			for (const db of allDbs) {
				const name = db.name ?? '';
				const colonIdx = name.indexOf(':');
				if (colonIdx > 0) {
					workspaceIds.add(name.slice(0, colonIdx));
				}
			}
			return Array.from(workspaceIds);
		} catch {
			return [];
		}
	}

	/**
	 * Flush any pending offline Yjs edits for a workspace that is no longer active.
	 *
	 * Called in the online-reconnect path when the user switches workspace while offline.
	 * For each workspace the user edited while offline we must:
	 *   1. Ensure the server session has that workspace active (caller's responsibility).
	 *   2. Open temporary IndexedDB + WS providers for all of that workspace's rooms.
	 *   3. Wait for the Yjs state-vector exchange to upload any pending local edits.
	 *   4. Destroy the temporary providers.
	 *
	 * The temporary providers are outside DocumentManager's managed maps so they cannot
	 * interfere with the currently-active workspace and setWebsocketEnabled() does not
	 * affect them.
	 *
	 * @param previousWorkspaceId — workspace whose offline edits need syncing.
	 * @param timeoutMs           — max time to wait for sync before giving up (default 5 s).
	 */
	public async flushPreviousWorkspaceEdits(previousWorkspaceId: string, timeoutMs = 5_000): Promise<void> {
		if (!previousWorkspaceId || !this.websocketUrl) return;
		// Never flush the currently-active workspace — its rooms are managed by the
		// normal WS providers and opening a second set of providers would cause conflicts.
		if (previousWorkspaceId === this.activeWorkspaceId) return;

		// Discover which y-indexeddb databases (= Yjs rooms) exist for the previous
		// workspace by enumerating IndexedDB database names with the workspace prefix.
		// indexedDB.databases() is available on Chrome 71+, Firefox 126+, Safari 15.4+.
		const prefix = `${previousWorkspaceId}:`;
		let roomNames: string[] = [];
		try {
			if (typeof (indexedDB as any).databases === 'function') {
				const allDbs: { name?: string }[] = await (indexedDB as any).databases();
				roomNames = allDbs.map((db) => db.name ?? '').filter((name) => name.startsWith(prefix));
			} else {
				// Fallback: at minimum sync the registry doc. Individual note docs will sync
				// the next time the user opens workspace A.
				roomNames = [`${previousWorkspaceId}:${NOTES_REGISTRY_ID}`];
			}
		} catch {
			return; // Unable to enumerate – skip flush; edits will sync on next manual switch.
		}

		if (roomNames.length === 0) return;

		const tempDocs: Y.Doc[] = [];
		const tempIdbProviders: IndexeddbPersistence[] = [];
		const tempWsProviders: WebsocketProvider[] = [];

		const cleanup = (): void => {
			for (const provider of tempWsProviders) {
				try { provider.disconnect(); provider.destroy(); } catch { /* ignore */ }
			}
			for (const provider of tempIdbProviders) {
				try { provider.destroy(); } catch { /* ignore */ }
			}
			for (const doc of tempDocs) {
				try { doc.destroy(); } catch { /* ignore */ }
			}
		};

		try {
			// Step 1: Open IndexedDB providers for all rooms and wait for local hydration.
			// WS providers must only open AFTER IndexedDB is hydrated so the state vector
			// sent in Sync Step 1 reflects the full local state (including offline edits).
			const idbReadyPromises: Promise<void>[] = [];
			for (const roomName of roomNames) {
				const doc = new Y.Doc();
				tempDocs.push(doc);
				const idb = new IndexeddbPersistence(roomName, doc);
				tempIdbProviders.push(idb);
				idbReadyPromises.push(
					Promise.race([
						new Promise<void>((resolve) => {
							if ((idb as any).synced) { resolve(); return; }
							idb.on('synced', () => resolve());
						}),
						new Promise<void>((resolve) => { window.setTimeout(resolve, 3_000); }),
					])
				);
			}
			await Promise.all(idbReadyPromises);

			// Step 2: Open WS providers (server session still has previousWorkspaceId).
			const wsReadyPromises: Promise<void>[] = [];
			for (let i = 0; i < roomNames.length; i++) {
				const wsProvider = new WebsocketProvider(this.websocketUrl, roomNames[i], tempDocs[i], {
					connect: true,
					resyncInterval: 0,
					maxBackoffTime: 2_000,
				});
				tempWsProviders.push(wsProvider);
				wsReadyPromises.push(
					new Promise<void>((resolve) => {
						if ((wsProvider as any).synced === true) { resolve(); return; }
						const onSync = (isSynced: boolean): void => {
							if (isSynced) {
								(wsProvider as any).off?.('sync', onSync);
								resolve();
							}
						};
						(wsProvider as any).on?.('sync', onSync);
					})
				);
			}

			// Wait for all WS syncs to report back, or bail after timeoutMs.
			await Promise.race([
				Promise.all(wsReadyPromises),
				new Promise<void>((resolve) => { window.setTimeout(resolve, timeoutMs); }),
			]);
		} finally {
			cleanup();
		}
	}

	/**
	 * Pull a workspace's full dataset (registry + all notes) from the server into
	 * IndexedDB so it is available offline, even if the user has never visited it.
	 *
	 * Unlike flushPreviousWorkspaceEdits (which only opens rooms that ALREADY exist
	 * in IDB), this method always syncs the registry first to discover the full note
	 * list, then opens every note room. This is the correct path for the initial
	 * offline-preload use case where a workspace has never been loaded on this device.
	 *
	 * The server session MUST already be set to previousWorkspaceId before calling
	 * (the caller is responsible for the POST /activate call).
	 *
	 * @param workspaceId — workspace to pull.
	 * @param timeoutMs   — max time to wait per-sync phase before moving on (default 8 s).
	 */
	public async preloadWorkspaceFromServer(workspaceId: string, timeoutMs = 8_000): Promise<void> {
		if (!workspaceId || !this.websocketUrl) return;
		if (workspaceId === this.activeWorkspaceId) return;

		const tempDocs: Y.Doc[] = [];
		const tempIdbProviders: IndexeddbPersistence[] = [];
		const tempWsProviders: WebsocketProvider[] = [];

		const cleanup = (): void => {
			for (const p of tempWsProviders) { try { p.disconnect(); p.destroy(); } catch { /* ignore */ } }
			for (const p of tempIdbProviders) { try { p.destroy(); } catch { /* ignore */ } }
			for (const d of tempDocs) { try { d.destroy(); } catch { /* ignore */ } }
		};

		const waitIdb = (idb: IndexeddbPersistence, ms: number): Promise<void> =>
			Promise.race([
				new Promise<void>((resolve) => {
					if ((idb as any).synced) { resolve(); return; }
					idb.on('synced', () => resolve());
				}),
				new Promise<void>((resolve) => { window.setTimeout(resolve, ms); }),
			]);

		const waitWs = (ws: WebsocketProvider, ms: number): Promise<void> =>
			Promise.race([
				new Promise<void>((resolve) => {
					if ((ws as any).synced === true) { resolve(); return; }
					const onSync = (ok: boolean): void => {
						if (ok) { (ws as any).off?.('sync', onSync); resolve(); }
					};
					(ws as any).on?.('sync', onSync);
				}),
				new Promise<void>((resolve) => { window.setTimeout(resolve, ms); }),
			]);

		try {
			// ── Phase 1: sync the registry to discover the workspace's note IDs ──────
			const registryRoom = `${workspaceId}:${NOTES_REGISTRY_ID}`;
			const registryDoc = new Y.Doc();
			tempDocs.push(registryDoc);

			const registryIdb = new IndexeddbPersistence(registryRoom, registryDoc);
			tempIdbProviders.push(registryIdb);
			await waitIdb(registryIdb, 3_000);

			const registryWs = new WebsocketProvider(this.websocketUrl, registryRoom, registryDoc, {
				connect: true, resyncInterval: 0, maxBackoffTime: 2_000,
			});
			tempWsProviders.push(registryWs);
			await waitWs(registryWs, timeoutMs);

			// Read note IDs from the synced registry (same structure as getOrCreateDocEntry).
			const notesList = registryDoc.getArray<Y.Map<any>>(NOTES_LIST_KEY);
			const noteIds = notesList.toArray()
				.map((item) => String(item.get?.('id') ?? '').trim())
				.filter(Boolean);

			if (noteIds.length === 0) return;

			// ── Phase 2: sync every note doc in parallel ──────────────────────────────
			const noteWaitPromises: Promise<void>[] = [];
			for (const noteId of noteIds) {
				const noteRoom = `${workspaceId}:${noteId}`;
				const noteDoc = new Y.Doc();
				tempDocs.push(noteDoc);

				const noteIdb = new IndexeddbPersistence(noteRoom, noteDoc);
				tempIdbProviders.push(noteIdb);
				// Wait for IDB hydration so the state vector reflects existing local data
				// before the WS provider sends Sync Step 1.
				await waitIdb(noteIdb, 2_000);

				const noteWs = new WebsocketProvider(this.websocketUrl, noteRoom, noteDoc, {
					connect: true, resyncInterval: 0, maxBackoffTime: 2_000,
				});
				tempWsProviders.push(noteWs);
				noteWaitPromises.push(waitWs(noteWs, timeoutMs));
			}

			await Promise.race([
				Promise.all(noteWaitPromises),
				new Promise<void>((resolve) => { window.setTimeout(resolve, timeoutMs + 2_000); }),
			]);
		} finally {
			cleanup();
		}
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
		const startTime = Date.now();
		logClientEvent('IDB_LIFECYCLE', { event: 'registry-hydration-start', workspaceId: this.activeWorkspaceId });
		this.getNotesRegistryDoc()
			.then(() => {
				this.registryHydrated = true;
				logClientEvent('IDB_LIFECYCLE', { event: 'registry-hydration-end', workspaceId: this.activeWorkspaceId, durationMs: Date.now() - startTime });
				this.emitConnectionStatus();
			})
			.catch((err: unknown) => {
				// WorkspaceChangedError is expected whenever setActiveWorkspaceId is called
				// while the registry is still hydrating — silently abort, the new workspace
				// will spin up its own initializeRegistry call.
				if (err instanceof WorkspaceChangedError) return;
				console.error('[DocumentManager] Registry initialization failed:', err);
			});
	}
}

