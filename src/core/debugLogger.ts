const DEBUG_ENDPOINT = '/api/debug-log';
const DEBUG_FLUSH_INTERVAL_MS = 400;
const DEBUG_MAX_BATCH_SIZE = 100;
const DEBUG_MAX_BUFFERED_EVENTS = 2000;
const DEBUG_LOGGING_ENABLED = (() => {
	const value = String(import.meta.env.VITE_DEBUG_LOGGING || '').trim().toLowerCase();
	return value === '1' || value === 'true' || value === 'yes' || value === 'on';
})();

const appSessionId = (() => {
	try {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
	} catch {
		// ignore
	}
	return `app-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
})();

const noteSessionIds = new Map<string, string>();
let indexedDbLoggingInitialized = false;
const pendingDebugEvents: Array<Record<string, unknown>> = [];
let debugFlushTimer: number | null = null;
let debugFlushInFlight = false;

type ClientDebugPayload = Record<string, unknown>;

function clearDebugFlushTimer(): void {
	if (debugFlushTimer == null || typeof window === 'undefined') return;
	window.clearTimeout(debugFlushTimer);
	debugFlushTimer = null;
}

function scheduleDebugFlush(): void {
	if (!DEBUG_LOGGING_ENABLED) return;
	if (debugFlushTimer != null) return;
	if (typeof window === 'undefined') return;
	debugFlushTimer = window.setTimeout(() => {
		debugFlushTimer = null;
		void flushDebugEvents();
	}, DEBUG_FLUSH_INTERVAL_MS);
}

async function flushDebugEvents(force = false): Promise<void> {
	if (!DEBUG_LOGGING_ENABLED) return;
	if (debugFlushInFlight) return;
	if (pendingDebugEvents.length === 0) return;
	if (!force && pendingDebugEvents.length < DEBUG_MAX_BATCH_SIZE) {
		scheduleDebugFlush();
		return;
	}

	clearDebugFlushTimer();
	debugFlushInFlight = true;
	const batch = pendingDebugEvents.splice(0, DEBUG_MAX_BATCH_SIZE);
	const body = JSON.stringify(batch);
	try {
		await fetch(DEBUG_ENDPOINT, {
			method: 'POST',
			credentials: 'include',
			keepalive: true,
			headers: { 'Content-Type': 'application/json' },
			body,
		});
	} catch {
		pendingDebugEvents.unshift(...batch);
		if (pendingDebugEvents.length > DEBUG_MAX_BUFFERED_EVENTS) {
			pendingDebugEvents.splice(0, pendingDebugEvents.length - DEBUG_MAX_BUFFERED_EVENTS);
		}
	} finally {
		debugFlushInFlight = false;
		if (pendingDebugEvents.length > 0) {
			if (force || pendingDebugEvents.length >= DEBUG_MAX_BATCH_SIZE) {
				void flushDebugEvents(force);
			} else {
				scheduleDebugFlush();
			}
		}
	}
}

function parseRoomName(roomName: string | null | undefined): {
	roomName: string | null;
	workspaceId: string | null;
	noteId: string | null;
	roomKind: 'note' | 'registry' | 'unknown';
} {
	const normalized = typeof roomName === 'string' ? roomName.trim() : '';
	if (!normalized) {
		return { roomName: null, workspaceId: null, noteId: null, roomKind: 'unknown' };
	}
	const index = normalized.indexOf(':');
	const workspaceId = index > 0 ? normalized.slice(0, index) : null;
	const noteId = index > 0 ? normalized.slice(index + 1) : normalized;
	return {
		roomName: normalized,
		workspaceId,
		noteId,
		roomKind: noteId === '__notes_registry__' ? 'registry' : 'note',
	};
}

function makeRandomId(prefix: string): string {
	try {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
	} catch {
		// ignore
	}
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getAppDebugSessionId(): string {
	return appSessionId;
}

export function isDebugLoggingEnabled(): boolean {
	return DEBUG_LOGGING_ENABLED;
}

export function getOrCreateNoteDebugSessionId(roomName: string): string {
	const parsed = parseRoomName(roomName);
	if (!parsed.roomName) {
		return makeRandomId('note');
	}
	const existing = noteSessionIds.get(parsed.roomName);
	if (existing) return existing;
	const next = makeRandomId('note');
	noteSessionIds.set(parsed.roomName, next);
	return next;
}

export function clearNoteDebugSession(roomName: string): void {
	const parsed = parseRoomName(roomName);
	if (!parsed.roomName) return;
	noteSessionIds.delete(parsed.roomName);
}

export function getNoteDebugContext(roomName: string): Record<string, unknown> {
	const parsed = parseRoomName(roomName);
	return {
		roomName: parsed.roomName,
		workspaceId: parsed.workspaceId,
		noteId: parsed.noteId,
		roomKind: parsed.roomKind,
		sessionId: parsed.roomName ? getOrCreateNoteDebugSessionId(parsed.roomName) : null,
		appSessionId,
	};
}

export function peekNoteDebugContext(roomName: string | null | undefined): Record<string, unknown> {
	const parsed = parseRoomName(roomName);
	return {
		roomName: parsed.roomName,
		workspaceId: parsed.workspaceId,
		noteId: parsed.noteId,
		roomKind: parsed.roomKind,
		sessionId: parsed.roomName ? noteSessionIds.get(parsed.roomName) ?? null : null,
		appSessionId,
	};
}

export async function logClientEvent(type: string, data: ClientDebugPayload = {}): Promise<void> {
	if (!DEBUG_LOGGING_ENABLED) return;
	pendingDebugEvents.push({
		type,
		time: Date.now(),
		appSessionId,
		...data,
	});
	if (pendingDebugEvents.length > DEBUG_MAX_BUFFERED_EVENTS) {
		pendingDebugEvents.splice(0, pendingDebugEvents.length - DEBUG_MAX_BUFFERED_EVENTS);
	}
	if (pendingDebugEvents.length >= DEBUG_MAX_BATCH_SIZE) {
		await flushDebugEvents(true);
		return;
	}
	scheduleDebugFlush();
}

if (typeof window !== 'undefined' && DEBUG_LOGGING_ENABLED) {
	window.addEventListener('pagehide', () => {
		void flushDebugEvents(true);
	});
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			void flushDebugEvents(true);
		}
	});
}

function wrapRequestLogging<T extends IDBRequest>(request: T, eventType: string, payload: Record<string, unknown>): T {
	request.addEventListener('success', () => {
		void logClientEvent(eventType, payload);
	});
	request.addEventListener('error', () => {
		void logClientEvent(`${eventType}_ERROR`, {
			...payload,
			error: request.error ? String(request.error.message || request.error.name || request.error) : 'unknown',
		});
	});
	return request;
}

export function initIndexedDbDebugLogging(): void {
	if (!DEBUG_LOGGING_ENABLED) return;
	if (indexedDbLoggingInitialized) return;
	if (typeof indexedDB === 'undefined') return;
	indexedDbLoggingInitialized = true;

	const indexedDbApi = indexedDB as IDBFactory & {
		__fnOriginalOpen?: typeof indexedDB.open;
		__fnOriginalDeleteDatabase?: typeof indexedDB.deleteDatabase;
	};

	if (!indexedDbApi.__fnOriginalOpen) {
		indexedDbApi.__fnOriginalOpen = indexedDB.open.bind(indexedDB);
		(indexedDB as any).open = ((name: string, version?: number) => {
			const roomName = String(name || '');
			const payload = {
				...peekNoteDebugContext(roomName),
				database: roomName,
				version: typeof version === 'number' ? version : null,
			};
			return wrapRequestLogging(indexedDbApi.__fnOriginalOpen!(name, version), 'IDB_OPEN', payload);
		}) as typeof indexedDB.open;
	}

	if (!indexedDbApi.__fnOriginalDeleteDatabase) {
		indexedDbApi.__fnOriginalDeleteDatabase = indexedDB.deleteDatabase.bind(indexedDB);
		(indexedDB as any).deleteDatabase = ((name: string) => {
			const roomName = String(name || '');
			return wrapRequestLogging(indexedDbApi.__fnOriginalDeleteDatabase!(name), 'IDB_DELETE_DATABASE', {
				...peekNoteDebugContext(roomName),
				database: roomName,
			});
		}) as typeof indexedDB.deleteDatabase;
	}

	const databaseProto = (globalThis as any).IDBDatabase?.prototype;
	if (databaseProto && !databaseProto.__fnDebugTransactionPatched) {
		const originalTransaction = databaseProto.transaction;
		databaseProto.transaction = function patchedTransaction(storeNames: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
			void logClientEvent('IDB_TRANSACTION', {
				...peekNoteDebugContext(this.name),
				database: this.name,
				stores: Array.isArray(storeNames) ? storeNames.slice() : [storeNames],
				mode: mode ?? 'readonly',
			});
			return originalTransaction.call(this, storeNames, mode, options);
		};
		databaseProto.__fnDebugTransactionPatched = true;
	}

	const storeProto = (globalThis as any).IDBObjectStore?.prototype;
	if (storeProto && !storeProto.__fnDebugStorePatched) {
		const wrapStoreMethod = (methodName: string, eventType: string): void => {
			const original = storeProto[methodName];
			if (typeof original !== 'function') return;
			storeProto[methodName] = function patchedStoreMethod(...args: unknown[]) {
				const dbName = this.transaction?.db?.name ?? null;
				const payload = {
					...peekNoteDebugContext(dbName),
					database: dbName,
					storeName: this.name,
					method: methodName,
				};
				const request = original.apply(this, args);
				if (request && typeof request.addEventListener === 'function') {
					wrapRequestLogging(request, eventType, payload);
				}
				return request;
			};
		};

		for (const methodName of ['get', 'getAll', 'getAllKeys', 'count', 'openCursor', 'openKeyCursor']) {
			wrapStoreMethod(methodName, 'IDB_READ');
		}
		for (const methodName of ['put', 'add', 'delete', 'clear']) {
			wrapStoreMethod(methodName, 'IDB_WRITE');
		}
		storeProto.__fnDebugStorePatched = true;
	}
}
