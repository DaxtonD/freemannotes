'use strict';

const fs = require('fs');
const path = require('path');

const logFile = path.join(process.cwd(), 'freeman-debug.log');
const masonryLogFile = path.join(process.cwd(), 'masonry-debug.log');
const roomSessions = new Map();
const DEBUG_LOGGING_ENABLED = (() => {
	const value = String(process.env.VITE_DEBUG_LOGGING || process.env.DEBUG_LOGGING || '').trim().toLowerCase();
	return value === '1' || value === 'true' || value === 'yes' || value === 'on';
})();

const PRISMA_READ_ACTIONS = new Set(['findunique', 'finduniquethrow', 'findfirst', 'findfirstthrow', 'findmany', 'aggregate', 'count', 'groupby']);
const PRISMA_WRITE_ACTIONS = new Set(['create', 'createmany', 'update', 'updatemany', 'upsert', 'delete', 'deletemany']);

// Max bytes per log file before it's truncated and restarted. Confirmed
// 2026-08-17: fs.appendFileSync against a file that had grown to ~5MB measured
// ~115x slower per write than against a fresh file (~273ms vs ~2.4ms, almost
// certainly antivirus real-time-scanning the file on every write on this dev
// machine) — enough on its own to blow a 5s Prisma interactive-transaction
// timeout and make the whole app look badly regressed, with zero real app bug
// involved. A persistent write stream (opened once, reused across calls
// instead of reopened per write) plus this size cap keeps writes fast and the
// file small. This is a throwaway diagnostic log, not an audit trail, so
// truncating on rollover (rather than rotating to a numbered file) is fine.
const LOG_ROTATE_BYTES = 2 * 1024 * 1024;
const logStreams = new Map(); // targetFile -> { stream, bytesWritten }

function openStream(targetFile, truncate) {
	const existing = logStreams.get(targetFile);
	if (existing) {
		try {
			existing.stream.end();
		} catch {
			// best effort
		}
	}
	const stream = fs.createWriteStream(targetFile, { flags: truncate ? 'w' : 'a' });
	stream.on('error', (err) => {
		console.error('[debug-log] stream error:', err && err.message ? err.message : err);
		logStreams.delete(targetFile);
	});
	let bytesWritten = 0;
	if (!truncate) {
		try {
			bytesWritten = fs.statSync(targetFile).size;
		} catch {
			// file doesn't exist yet — starts at 0
		}
	}
	const state = { stream, bytesWritten };
	logStreams.set(targetFile, state);
	return state;
}

function appendLine(targetFile, entry) {
	let state = logStreams.get(targetFile) || openStream(targetFile, false);
	if (state.bytesWritten >= LOG_ROTATE_BYTES) {
		state = openStream(targetFile, true);
	}
	const line = `${JSON.stringify(entry)}\n`;
	state.stream.write(line, 'utf8');
	state.bytesWritten += Buffer.byteLength(line, 'utf8');
}

function logEvent(type, data = {}) {
	const isMasonry = data && data.channel === 'masonry';
	if (!DEBUG_LOGGING_ENABLED && !isMasonry) return;
	try {
		const entry = {
			type,
			time: new Date().toISOString(),
			...data,
		};
		if (DEBUG_LOGGING_ENABLED) {
			appendLine(logFile, entry);
		}
		if (isMasonry) {
			appendLine(masonryLogFile, entry);
		}
	} catch (err) {
		console.error('[debug-log] write failed:', err && err.message ? err.message : err);
	}
}

function splitRoomName(roomName) {
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

function getRoomSessionIds(roomName) {
	const sessions = roomSessions.get(roomName);
	if (!sessions) return [];
	return Array.from(sessions.keys());
}

function getRoomDebugContext(roomName, extra = {}) {
	const room = splitRoomName(roomName);
	const sessionIds = room.roomName ? getRoomSessionIds(room.roomName) : [];
	return {
		roomName: room.roomName,
		workspaceId: room.workspaceId,
		noteId: room.noteId,
		roomKind: room.roomKind,
		sessionId: sessionIds[0] ?? null,
		sessionIds,
		...extra,
	};
}

function registerRoomSession(roomName, sessionId, metadata = {}) {
	if (!DEBUG_LOGGING_ENABLED) return;
	const normalizedRoomName = typeof roomName === 'string' ? roomName.trim() : '';
	const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
	if (!normalizedRoomName || !normalizedSessionId) return;
	let sessions = roomSessions.get(normalizedRoomName);
	if (!sessions) {
		sessions = new Map();
		roomSessions.set(normalizedRoomName, sessions);
	}
	sessions.set(normalizedSessionId, {
		connectedAt: new Date().toISOString(),
		...metadata,
	});
	logEvent('WS_EVENT', {
		...getRoomDebugContext(normalizedRoomName, { sessionId: normalizedSessionId }),
		event: 'session-register',
		...metadata,
	});
}

function unregisterRoomSession(roomName, sessionId) {
	if (!DEBUG_LOGGING_ENABLED) return;
	const normalizedRoomName = typeof roomName === 'string' ? roomName.trim() : '';
	const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
	if (!normalizedRoomName || !normalizedSessionId) return;
	const sessions = roomSessions.get(normalizedRoomName);
	if (!sessions) return;
	sessions.delete(normalizedSessionId);
	if (sessions.size === 0) {
		roomSessions.delete(normalizedRoomName);
	}
	logEvent('WS_EVENT', {
		...getRoomDebugContext(normalizedRoomName, { sessionId: normalizedSessionId }),
		event: 'session-unregister',
	});
}

function collectIdentifiers(value, sink = {}, depth = 0) {
	if (!value || typeof value !== 'object' || depth > 5) return sink;
	if (Array.isArray(value)) {
		for (const entry of value) {
			collectIdentifiers(entry, sink, depth + 1);
		}
		return sink;
	}
	for (const [key, entry] of Object.entries(value)) {
		if (sink[key] == null && (typeof entry === 'string' || typeof entry === 'number')) {
			sink[key] = entry;
		}
		collectIdentifiers(entry, sink, depth + 1);
	}
	return sink;
}

function classifyPrismaAction(action) {
	const normalized = String(action || '').trim().toLowerCase();
	if (PRISMA_READ_ACTIONS.has(normalized)) return 'DB_READ';
	if (PRISMA_WRITE_ACTIONS.has(normalized)) return 'DB_WRITE';
	return null;
}

function buildPrismaContext(params) {
	const identifiers = collectIdentifiers(params && params.args ? params.args : {});
	const roomName = typeof identifiers.docId === 'string'
		? identifiers.docId
		: typeof identifiers.noteId === 'string'
			? identifiers.noteId
			: null;
	const roomContext = roomName ? getRoomDebugContext(roomName) : getRoomDebugContext(null);
	return {
		model: params && params.model ? String(params.model) : null,
		action: params && params.action ? String(params.action) : null,
		queryType: params && params.action ? String(params.action) : null,
		roomName: roomContext.roomName,
		workspaceId: roomContext.workspaceId || (typeof identifiers.workspaceId === 'string' ? identifiers.workspaceId : null),
		noteId: roomContext.noteId || (typeof identifiers.noteId === 'string' ? identifiers.noteId : null),
		sessionId: roomContext.sessionId,
		sessionIds: roomContext.sessionIds,
		userId: typeof identifiers.userId === 'string' ? identifiers.userId : null,
	};
}

function attachPrismaDebugLogging(prisma) {
	if (!DEBUG_LOGGING_ENABLED) return prisma;
	if (!prisma || prisma.__fnDebugLoggerAttached) return prisma;
	prisma.$use(async (params, next) => {
		const eventType = classifyPrismaAction(params && params.action);
		const startedAt = Date.now();
		try {
			const result = await next(params);
			if (eventType) {
				logEvent(eventType, {
					...buildPrismaContext(params),
					durationMs: Date.now() - startedAt,
					resultCount: Array.isArray(result) ? result.length : null,
					status: 'ok',
				});
			}
			return result;
		} catch (err) {
			if (eventType) {
				logEvent(eventType, {
					...buildPrismaContext(params),
					durationMs: Date.now() - startedAt,
					status: 'error',
					error: err && err.message ? err.message : String(err),
				});
			}
			throw err;
		}
	});
	Object.defineProperty(prisma, '__fnDebugLoggerAttached', {
		value: true,
		configurable: true,
	});
	return prisma;
}

function classifyRedisMethod(methodName) {
	const normalized = String(methodName || '').trim().toLowerCase();
	if (!normalized) return null;
	if (normalized.includes('publish')) return 'publish';
	if (normalized.includes('subscribe')) return normalized.startsWith('un') ? 'unsubscribe' : 'subscribe';
	if (normalized.startsWith('get')) return 'get';
	if (normalized.startsWith('set')) return 'set';
	if (normalized.startsWith('del')) return 'delete';
	if (normalized.startsWith('expire')) return 'expire';
	return normalized;
}

function parseRedisRoomName(key) {
	const normalized = typeof key === 'string' ? key.trim() : '';
	if (!normalized.startsWith('fn:yjs:')) return null;
	const parts = normalized.split(':');
	if (parts.length < 4) return null;
	return parts.slice(3).join(':') || null;
}

function instrumentRedisClient(client, label = 'redis') {
	if (!DEBUG_LOGGING_ENABLED) return client;
	if (!client) return client;
	if (client.__fnDebugProxy) return client.__fnDebugProxy;
	const proxy = new Proxy(client, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof value !== 'function') return value;
			return function instrumentedRedisMethod(...args) {
				const method = String(prop);
				const action = classifyRedisMethod(method);
				const roomName = parseRedisRoomName(args[0]);
				const context = roomName ? getRoomDebugContext(roomName) : getRoomDebugContext(null);
				if (action) {
					logEvent('REDIS', {
						...context,
						client: label,
						action,
						method,
						key: typeof args[0] === 'string' ? args[0] : null,
						status: 'start',
					});
				}
				const result = value.apply(target, args);
				if (action && result && typeof result.then === 'function') {
					return result.then((resolved) => {
						logEvent('REDIS', {
							...context,
							client: label,
							action,
							method,
							key: typeof args[0] === 'string' ? args[0] : null,
							status: 'ok',
						});
						return resolved;
					}).catch((err) => {
						logEvent('REDIS', {
							...context,
							client: label,
							action,
							method,
							key: typeof args[0] === 'string' ? args[0] : null,
							status: 'error',
							error: err && err.message ? err.message : String(err),
						});
						throw err;
					});
				}
				return result;
			};
		},
	});
	Object.defineProperty(client, '__fnDebugProxy', {
		value: proxy,
		configurable: true,
	});
	return proxy;
}

module.exports = {
	logEvent,
	getRoomDebugContext,
	registerRoomSession,
	unregisterRoomSession,
	attachPrismaDebugLogging,
	instrumentRedisClient,
	DEBUG_LOGGING_ENABLED,
};
