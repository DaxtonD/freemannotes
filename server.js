'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// FreemanNotes – Production Runtime Server (Phase 10)
//
// Serves the Vite build output, hosts the Yjs WebSocket sync endpoint, and
// integrates PostgreSQL persistence (via Prisma) as the canonical source of
// truth for all document state. Optional Redis for caching + pub/sub.
//
// Architecture:
//   HTTP (same port) ─┬─ Static files from ./dist (SPA fallback)
//                     ├─ REST API (/api/*, /healthz, /readyz)
//                     └─ WebSocket upgrade /yjs/* → y-websocket rooms
//
// Persistence modes (selected via environment variables):
//   1. Relay-only (no DATABASE_URL, no YPERSISTENCE) — pure in-memory relay.
//   2. LevelDB (YPERSISTENCE=/path) — y-websocket's built-in LevelDB (legacy).
//   3. PostgreSQL (DATABASE_URL=...) — Prisma-based durable persistence.
//      Optional: REDIS_URL for fast doc-state caching layer.
//
// Prisma schema uses the `Document` model (mapped to the `document` table)
// to store Yjs binary state. Workspace scoping provides a lightweight
// tenant boundary ready for Phase 11 auth.
//
// Docker / Unraid:
//   - Set DATABASE_URL to your PostgreSQL connection string.
//   - Optionally set REDIS_URL for Redis caching.
//   - Startup automatically syncs schema (defaults to `npx prisma migrate deploy`
//     when prisma/migrations exist). Override with DB_SCHEMA_SYNC=deploy|push|none.
//
// ─────────────────────────────────────────────────────────────────────────────

// ── Load environment (.env) before anything reads process.env ─────────────
try {
	require('dotenv').config();
} catch {
	// ignore if dotenv isn't installed
}

// ── Core Node.js modules ─────────────────────────────────────────────────
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Configuration (read from environment) ────────────────────────────────
const YPERSISTENCE = String(process.env.YPERSISTENCE || '').trim();
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const REDIS_URL = String(process.env.REDIS_URL || '').trim();
const PORT = Number(process.env.PORT || 27015);
const HOST = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';
const APP_URL = String(process.env.APP_URL || '').trim();
const PGTIMEZONE = String(process.env.PGTIMEZONE || '').trim();
const DIST_DIR = path.join(__dirname, 'dist');
const UPLOAD_DIR = String(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads')).trim();

// ── y-websocket LevelDB persistence normalization ────────────────────────
// y-websocket reads process.env.YPERSISTENCE at import time.
// Normalize empty/whitespace values before requiring it.
if (YPERSISTENCE.length > 0) {
	process.env.YPERSISTENCE = YPERSISTENCE;
} else {
	delete process.env.YPERSISTENCE;
}

// ── WebSocket + y-websocket ──────────────────────────────────────────────
const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');
const {
	normalizeWorkspaceMetadataEvent,
	publishWorkspaceMetadataEvent,
	subscribeToWorkspaceMetadataEvents,
} = require('./server/workspaceMetadataEvents');
const { findLiveWorkspaceMembership } = require('./server/workspaceAccess');

// ── Phase 11 auth helpers (JWT cookie sessions) ───────────────────────
const { getSessionFromRequest } = require('./server/auth');

// ─────────────────────────────────────────────────────────────────────────────
// Prisma + Redis initialization (conditional — only when DATABASE_URL is set).
// When DATABASE_URL is absent, the server runs in relay-only mode (legacy).
// ─────────────────────────────────────────────────────────────────────────────

/** @type {import('@prisma/client').PrismaClient | null} */
let prisma = null;

/** @type {import('ioredis').Redis | null} */
let redis = null;

/** @type {import('ioredis').Redis | null} */
let redisSubscriber = null;

let unsubscribeWorkspaceMetadataEvents = async () => {};

const SERVER_INSTANCE_ID = `${process.pid}:${Math.random().toString(36).slice(2, 10)}`;

/** @type {import('./server/YjsPersistenceAdapter').YjsPersistenceAdapter | null} */
let persistAdapter = null;

/** @type {ReturnType<import('./server/apiRouter').createApiRouter> | null} */
let apiRouter = null;

/** @type {ReturnType<import('./server/authRouter').createApiAuthRouter> | null} */
let authRouter = null;

/** @type {ReturnType<import('./server/workspaceRouter').createWorkspaceRouter> | null} */
let workspaceRouter = null;

/** @type {ReturnType<import('./server/inviteRouter').createInviteRouter> | null} */
let inviteRouter = null;

/** @type {ReturnType<import('./server/shareRouter').createShareRouter> | null} */
let shareRouter = null;

/** @type {ReturnType<import('./server/profileRouter').createProfileRouter> | null} */
let profileRouter = null;

/** @type {ReturnType<import('./server/adminRouter').createAdminRouter> | null} */
let adminRouter = null;

/** @type {ReturnType<import('./server/preferencesRouter').createPreferencesRouter> | null} */
let preferencesRouter = null;

/** @type {ReturnType<import('./server/trashCleanup').createTrashCleanup> | null} */
let trashCleanup = null;

if (DATABASE_URL.length > 0) {
	// ── PostgreSQL via Prisma ─────────────────────────────────────────────
	try {
		const { PrismaClient } = require('@prisma/client');
		prisma = new PrismaClient({
			// Log slow queries in development for debugging.
			log: process.env.NODE_ENV !== 'production'
				? ['query', 'warn', 'error']
				: ['warn', 'error'],
		});
		console.info('[server] Prisma client initialized (DATABASE_URL is set)');

		// Log PGTIMEZONE if configured. The actual SET timezone = '...' runs
		// in the async boot sequence after database provisioning, so it takes
		// effect before any timestamp-returning queries execute.
		if (PGTIMEZONE.length > 0) {
			console.info(`[server] PGTIMEZONE configured: ${PGTIMEZONE}`);
		}
	} catch (err) {
		console.error('[server] Failed to initialize Prisma client:', err.message);
		console.error('[server] PostgreSQL persistence will be DISABLED.');
		prisma = null;
	}

	// ── Redis (optional, only if REDIS_URL is set) ───────────────────────
	if (REDIS_URL.length > 0) {
		try {
			const Redis = require('ioredis');
			redis = new Redis(REDIS_URL, {
				// Reconnect automatically with exponential backoff (max 10 s).
				retryStrategy: (times) => Math.min(times * 200, 10_000),
				// ── Key resilience settings ──
				// null = commands queue indefinitely until Redis reconnects instead
				// of failing after N attempts. This prevents unhandled rejections
				// from crashing the process during transient network outages.
				maxRetriesPerRequest: null,
				// Keep the offline queue enabled (default true) — pending commands are
				// buffered and replayed automatically once the connection is restored.
				enableOfflineQueue: true,
				lazyConnect: false,
				// Automatically reconnect when the server sends a read-only or
				// connection-reset error (ECONNRESET, READONLY, etc.).
				reconnectOnError: (err) => {
					const msg = err.message || '';
					return msg.includes('READONLY') || msg.includes('ECONNRESET');
				},
			});
			redis.on('connect', () => console.info('[server] Redis connected'));
			redis.on('ready', () => console.info('[server] Redis ready'));
			redis.on('close', () => console.warn('[server] Redis connection closed'));
			redis.on('reconnecting', (ms) => console.info(`[server] Redis reconnecting in ${ms}ms`));
			redis.on('error', (err) => console.warn('[server] Redis error:', err.message));
			redisSubscriber = redis.duplicate();
			redisSubscriber.on('connect', () => console.info('[server] Redis subscriber connected'));
			redisSubscriber.on('ready', () => console.info('[server] Redis subscriber ready'));
			redisSubscriber.on('close', () => console.warn('[server] Redis subscriber connection closed'));
			redisSubscriber.on('reconnecting', (ms) => console.info(`[server] Redis subscriber reconnecting in ${ms}ms`));
			redisSubscriber.on('error', (err) => console.warn('[server] Redis subscriber error:', err.message));
			console.info('[server] Redis client initialized (REDIS_URL is set)');
		} catch (err) {
			console.error('[server] Failed to initialize Redis client:', err.message);
			console.error('[server] Redis caching will be DISABLED.');
			redis = null;
		}
	}

	// ── Persistence adapter + API router (only with valid Prisma) ────────
	if (prisma) {
		// Guard: if Prisma Client is stale (schema changed but `prisma generate` wasn't run),
		// model delegates will be missing and device-scoped preference persistence will fail.
		if (!prisma.userDevicePreference) {
			console.error('[server] Prisma Client is missing model delegate: userDevicePreference');
			console.error('[server] This usually means the schema changed but Prisma Client was not regenerated.');
			console.error('[server] Fix: stop the dev server, run `npm run db:generate`, then restart.');
			throw new Error('Stale Prisma Client: missing userDevicePreference delegate');
		}
		// Persistence adapter is optional; auth/workspaces should still work even
		// if persistence fails to initialize.
		try {
			const { YjsPersistenceAdapter } = require('./server/YjsPersistenceAdapter');
			persistAdapter = new YjsPersistenceAdapter(prisma, {
				redis: redis || null,
				workspaceName: 'default',
				debounceMs: 2000,
			});
			console.info('[server] YjsPersistenceAdapter initialized');
		} catch (err) {
			console.error('[server] Failed to initialize persistence adapter:', err && err.stack ? err.stack : err.message);
			persistAdapter = null;
		}

		// REST API router requires persistence adapter.
		if (persistAdapter) {
			try {
				const { createApiRouter } = require('./server/apiRouter');
				apiRouter = createApiRouter({ prisma, adapter: persistAdapter, timezone: PGTIMEZONE || null });
				console.info('[server] REST API router initialized');
			} catch (err) {
				console.error('[server] Failed to initialize REST API router:', err.message);
				apiRouter = null;
			}
		}

		// Auth + tenancy routers should come up whenever Prisma is available.
		try {
			const { createApiAuthRouter } = require('./server/authRouter');
			authRouter = createApiAuthRouter({ prisma });
			console.info('[server] Auth API router initialized');
		} catch (err) {
			console.error('[server] Failed to initialize Auth API router:', err.message);
			authRouter = null;
		}

		try {
			const { createWorkspaceRouter } = require('./server/workspaceRouter');
			workspaceRouter = createWorkspaceRouter({
				prisma,
				onWorkspaceMetadataChanged: async (event) => {
					const normalized = normalizeWorkspaceMetadataEvent({
						...event,
						type: 'workspace-metadata-changed',
						origin: SERVER_INSTANCE_ID,
					});
					if (!normalized) return;
					broadcastWorkspaceMetadataChanged(normalized);
					if (redis) {
						await publishWorkspaceMetadataEvent(redis, normalized);
					}
				},
			});
			console.info('[server] Workspace API router initialized');
		} catch (err) {
			console.error('[server] Failed to initialize Workspace API router:', err.message);
			workspaceRouter = null;
		}

		try {
			const { createInviteRouter } = require('./server/inviteRouter');
			inviteRouter = createInviteRouter({ prisma });
			console.info('[server] Invite API router initialized');
		} catch (err) {
			console.error('[server] Failed to initialize Invite API router:', err.message);
			inviteRouter = null;
		}

		try {
			const { createShareRouter } = require('./server/shareRouter');
			shareRouter = createShareRouter({ prisma, timezone: PGTIMEZONE || null });
			console.info('[server] Share API router initialized');
		} catch (err) {
			console.error('[server] Failed to initialize Share API router:', err.message);
			shareRouter = null;
		}

		try {
			const { createProfileRouter } = require('./server/profileRouter');
			profileRouter = createProfileRouter({ prisma, uploadDir: UPLOAD_DIR });
			console.info('[server] Profile API router initialized');
		} catch (err) {
			console.error('[server] Failed to initialize Profile API router:', err.message);
			profileRouter = null;
		}

		try {
			const { createAdminRouter } = require('./server/adminRouter');
			adminRouter = createAdminRouter({ prisma });
			console.info('[server] Admin API router initialized');
		} catch (err) {
			console.error('[server] Failed to initialize Admin API router:', err.message);
			adminRouter = null;
		}

		try {
			const { createPreferencesRouter } = require('./server/preferencesRouter');
			preferencesRouter = createPreferencesRouter({ prisma, timezone: PGTIMEZONE || null });
			console.info('[server] Preferences API router initialized');
		} catch (err) {
			console.error('[server] Failed to initialize Preferences API router:', err.message);
			preferencesRouter = null;
		}
	}
} else {
	console.info('[server] DATABASE_URL not set — running in relay-only mode (no PostgreSQL persistence)');
}

// ─────────────────────────────────────────────────────────────────────────────
// y-websocket custom persistence binding.
//
// When the PostgreSQL persistence adapter is active, we register it as
// y-websocket's persistence layer. This replaces the built-in LevelDB
// persistence (YPERSISTENCE env var) when both are configured — PostgreSQL
// takes precedence.
// ─────────────────────────────────────────────────────────────────────────────
if (persistAdapter) {
	// y-websocket's utils.js exposes `setPersistence(persistence)` which
	// accepts an object with { bindState, writeState } methods. This is the
	// official extension point for custom persistence backends.
	try {
		const { setPersistence } = require('y-websocket/bin/utils');
		setPersistence({
			bindState: (docName, yDoc) => persistAdapter.bindState(docName, yDoc),
			writeState: (docName, yDoc) => persistAdapter.writeState(docName, yDoc),
		});
		console.info('[server] y-websocket persistence bound to PostgreSQL adapter');
	} catch (err) {
		console.error('[server] Failed to bind y-websocket persistence:', err.message);
		console.error('[server] Falling back to default y-websocket persistence (LevelDB or none).');
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// URL / path helpers (unchanged from original server.js)
// ─────────────────────────────────────────────────────────────────────────────

function normalizedAppUrl() {
	if (APP_URL.length === 0) {
		return `http://localhost:${PORT}`;
	}
	try {
		const u = new URL(APP_URL);
		u.pathname = '/';
		u.search = '';
		u.hash = '';
		return String(u).replace(/\/$/, '');
	} catch {
		return `http://localhost:${PORT}`;
	}
}

function wsUrlFromAppUrl(baseUrl) {
	try {
		const u = new URL(baseUrl);
		const wsProtocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${wsProtocol}//${u.host}/yjs/<room>`;
	} catch {
		return `ws://localhost:${PORT}/yjs/<room>`;
	}
}

function safePathFromUrl(urlPathname) {
	const pathname = decodeURIComponent(urlPathname.split('?')[0]);
	// Prevent path traversal.
	const resolved = path.resolve(DIST_DIR, '.' + pathname);
	if (!resolved.startsWith(DIST_DIR)) return null;
	return resolved;
}

function contentTypeFor(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === '.html') return 'text/html; charset=utf-8';
	if (ext === '.js') return 'text/javascript; charset=utf-8';
	if (ext === '.css') return 'text/css; charset=utf-8';
	if (ext === '.json') return 'application/json; charset=utf-8';
	if (ext === '.svg') return 'image/svg+xml';
	if (ext === '.png') return 'image/png';
	if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
	if (ext === '.ico') return 'image/x-icon';
	if (ext === '.txt') return 'text/plain; charset=utf-8';
	return 'application/octet-stream';
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP server — serves static files, REST API, and SPA fallback.
// ─────────────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
	try {
		// Attach auth context (if session cookie is present).
		req.auth = getSessionFromRequest(req);

		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

		// ── Auth API router ──────────────────────────────────────────────
		if (authRouter && authRouter(req, res)) {
			return;
		}

		// ── Workspaces API router ───────────────────────────────────────
		if (workspaceRouter && workspaceRouter(req, res)) {
			return;
		}

		// ── Invites API router ──────────────────────────────────────────
		if (inviteRouter && inviteRouter(req, res)) {
			return;
		}

		// ── Share API router ────────────────────────────────────────────
		if (shareRouter && shareRouter(req, res)) {
			return;
		}

		// ── Profile API router ──────────────────────────────────────────
		if (profileRouter && profileRouter(req, res)) {
			return;
		}

		// ── Admin API router ────────────────────────────────────────────
		if (adminRouter && adminRouter(req, res)) {
			return;
		}

		// ── REST API router (when PostgreSQL persistence is active) ──────
		// Try the API router first. If it handles the request, we're done.
		if (apiRouter && apiRouter(req, res)) {
			return;
		}

		// ── Preferences API router ───────────────────────────────────────
		// Handles /api/user/preferences GET and POST endpoints.
		if (preferencesRouter && preferencesRouter(req, res)) {
			return;
		}

		// ── Method guard ─────────────────────────────────────────────────
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			res.writeHead(405);
			res.end('Method Not Allowed');
			return;
		}

		// ── Health endpoint (always available, even without PostgreSQL) ──
		if (url.pathname === '/healthz') {
			res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('ok');
			return;
		}

		// ── Static file serving from dist ────────────────────────────────
		if (url.pathname.startsWith('/uploads/')) {
			// Serve uploaded profile images from UPLOAD_DIR.
			const resolved = path.resolve(UPLOAD_DIR, '.' + decodeURIComponent(url.pathname.slice('/uploads'.length)));
			const base = path.resolve(UPLOAD_DIR);
			if (!resolved.startsWith(base + path.sep) && resolved !== base) {
				res.writeHead(400);
				res.end('Bad Request');
				return;
			}
			if (!fs.existsSync(resolved)) {
				res.writeHead(404);
				res.end('Not Found');
				return;
			}
			const stat = fs.statSync(resolved);
			if (!stat.isFile()) {
				res.writeHead(404);
				res.end('Not Found');
				return;
			}
			res.setHeader('Content-Type', contentTypeFor(resolved));
			res.setHeader('Cache-Control', 'public, max-age=86400');
			if (req.method === 'HEAD') {
				res.writeHead(200);
				res.end();
				return;
			}
			fs.createReadStream(resolved)
				.on('error', () => {
					res.writeHead(500);
					res.end('Internal Server Error');
				})
				.pipe(res);
			return;
		}

		let filePath = safePathFromUrl(url.pathname);
		if (!filePath) {
			res.writeHead(400);
			res.end('Bad Request');
			return;
		}

		// Directory → index.html
		if (url.pathname.endsWith('/')) {
			filePath = path.join(filePath, 'index.html');
		}

		// SPA fallback: if file doesn't exist and it isn't an asset, serve index.html.
		const looksLikeFile = path.extname(filePath).length > 0;
		if (!fs.existsSync(filePath)) {
			if (!looksLikeFile) {
				filePath = path.join(DIST_DIR, 'index.html');
			} else {
				res.writeHead(404);
				res.end('Not Found');
				return;
			}
		}

		const stat = fs.statSync(filePath);
		if (!stat.isFile()) {
			res.writeHead(404);
			res.end('Not Found');
			return;
		}

		res.setHeader('Content-Type', contentTypeFor(filePath));
		// Cache policy:
		// - Hashed build assets: immutable
		// - Service worker + HTML shell: no-store (fast updates; SW handles offline)
		// - Everything else: revalidate
		if (filePath.includes(path.sep + 'assets' + path.sep)) {
			res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
		} else if (path.basename(filePath) === 'sw.js' || path.extname(filePath).toLowerCase() === '.html') {
			res.setHeader('Cache-Control', 'no-store');
		} else {
			res.setHeader('Cache-Control', 'no-cache');
		}

		if (req.method === 'HEAD') {
			res.writeHead(200);
			res.end();
			return;
		}

		fs.createReadStream(filePath)
			.on('error', () => {
				// If the stream errors after we've started sending the file,
				// we cannot change headers/status. Just terminate the response.
				if (res.headersSent || res.writableEnded) {
					try {
						res.destroy();
					} catch {
						// ignore
					}
					return;
				}
				res.writeHead(500);
				res.end('Internal Server Error');
			})
			.pipe(res);
	} catch {
		if (!res.headersSent) {
			res.writeHead(500);
		}
		if (!res.writableEnded) {
			res.end('Internal Server Error');
		}
	}
});

server.on('error', (err) => {
	console.error('[server] http error:', err);
});

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket server for Yjs, attached to same HTTP server.
//
// Server-side ping/pong keep-alive:
//   Every 30 s the server sends a WebSocket ping frame to each connected
//   client. If no pong is received within 10 s the connection is considered
//   dead and is terminated. This is critical for mobile clients on cellular
//   networks where TCP connections can die silently (NAT timeout, cell tower
//   handoff) without either side receiving a FIN. Without server-side pings
//   the dead socket would linger until y-websocket's internal 30 s idle
//   check fires, wasting memory and blocking Yjs awareness cleanup.
//
//   The `ws` library (v8+) handles pong responses automatically on the
//   client side — no application-level code needed.
// ─────────────────────────────────────────────────────────────────────────────

const WS_PING_INTERVAL_MS = 30_000;
const WS_PONG_TIMEOUT_MS = 10_000;

const wss = new WebSocket.Server({ noServer: true });
const metadataWss = new WebSocket.Server({ noServer: true });

const metadataClientSessionMap = new WeakMap();

// ── Server-side ping/pong keep-alive ─────────────────────────────────────
// Track liveness per connection so we can terminate unresponsive clients.
const wsAliveMap = new WeakMap();

function broadcastWorkspaceMetadataChanged(rawEvent) {
	const event = normalizeWorkspaceMetadataEvent(rawEvent);
	if (!event) return;
	const allowedUserIds = event.userIds.length > 0 ? new Set(event.userIds) : null;
	const payload = JSON.stringify({
		type: 'workspace-metadata-changed',
		reason: event.reason,
		workspaceId: event.workspaceId,
		occurredAt: event.occurredAt,
	});
	for (const ws of metadataWss.clients) {
		if (ws.readyState !== WebSocket.OPEN) continue;
		const session = metadataClientSessionMap.get(ws);
		if (allowedUserIds && (!session || !allowedUserIds.has(session.userId))) continue;
		try {
			ws.send(payload);
		} catch {
			// Ignore per-socket send failures; liveness tracking will clean them up.
		}
	}
}

const wsPingInterval = setInterval(() => {
	for (const serverInstance of [wss, metadataWss]) {
		for (const ws of serverInstance.clients) {
			if (wsAliveMap.get(ws) === false) {
				// No pong received since last ping — connection is dead.
				ws.terminate();
				continue;
			}
			wsAliveMap.set(ws, false);
			ws.ping();
		}
	}
}, WS_PING_INTERVAL_MS);

// Clean up the interval when the WebSocket server closes.
wss.on('close', () => {
	clearInterval(wsPingInterval);
});

metadataWss.on('close', () => {
	clearInterval(wsPingInterval);
});

server.on('upgrade', (req, socket, head) => {
	socket.on('error', () => {
		// ignore (ECONNRESET etc)
	});

	const url = req.url || '/';
	if (url.startsWith('/ws/metadata')) {
		try {
			metadataWss.handleUpgrade(req, socket, head, (conn) => {
				metadataWss.emit('connection', conn, req);
			});
		} catch {
			try {
				socket.destroy();
			} catch {
				// ignore
			}
		}
		return;
	}
	if (!url.startsWith('/yjs')) return;

	try {
		wss.handleUpgrade(req, socket, head, (conn) => {
			wss.emit('connection', conn, req);
		});
	} catch {
		try {
			socket.destroy();
		} catch {
			// ignore
		}
	}
});

metadataWss.on('connection', (conn, req) => {
	wsAliveMap.set(conn, true);
	conn.on('pong', () => {
		wsAliveMap.set(conn, true);
	});

	const session = getSessionFromRequest(req);
	if (!session || !session.userId) {
		conn.close(1008, 'unauthorized');
		return;
	}

	metadataClientSessionMap.set(conn, { userId: session.userId });

	conn.on('close', () => {
		metadataClientSessionMap.delete(conn);
	});

	conn.on('error', (err) => {
		console.warn('[ws-metadata] socket error:', err.message);
	});

	try {
		conn.send(JSON.stringify({ type: 'workspace-metadata-ready' }));
	} catch {
		// Ignore eager send failures.
	}
});

wss.on('connection', (conn, req) => {
	// ── Ping/pong liveness tracking ──────────────────────────────────────
	// Mark this connection as alive. The wsPingInterval periodically sets
	// alive=false then sends a ping; if no pong arrives before the next
	// cycle the connection is terminated.
	wsAliveMap.set(conn, true);
	conn.on('pong', () => {
		wsAliveMap.set(conn, true);
	});

	// ── Yjs WebSocket setup (Phase 11: auth + workspace isolation) ───────
	(async () => {
		try {
			const cookieHeader = String(req.headers.cookie || '');
			const session = getSessionFromRequest(req);
			if (!session || !session.userId || !session.workspaceId) {
				console.warn(
					'[ws] close unauthorized',
					JSON.stringify({
						hasCookie: cookieHeader.length > 0,
						userId: session && session.userId ? String(session.userId) : null,
						workspaceId: session && session.workspaceId ? String(session.workspaceId) : null,
						path: String(req.url || ''),
					})
				);
				conn.close(1008, 'unauthorized');
				return;
			}
			if (!prisma) {
				console.warn(
					'[ws] close server not ready',
					JSON.stringify({
						hasPrisma: false,
						hasPersistAdapter: Boolean(persistAdapter),
						userId: session.userId,
						workspaceId: session.workspaceId,
						path: String(req.url || ''),
					})
				);
				conn.close(1011, 'server not ready');
				return;
			}
			if (!persistAdapter) {
				console.warn(
					'[ws] persistence adapter unavailable; running relay-only for this connection',
					JSON.stringify({
						userId: session.userId,
						workspaceId: session.workspaceId,
						path: String(req.url || ''),
					})
				);
			}

			// Extract raw room from /yjs/<room>
			const raw = String(req.url || '/').replace(/^\/yjs\/?/, '').replace(/^\/+/, '');
			if (!raw) {
				console.warn('[ws] close invalid room', JSON.stringify({ path: String(req.url || '') }));
				conn.close(1008, 'invalid room');
				return;
			}

			// Verify workspace membership against a non-deleted workspace so stale
			// offline/session state cannot reattach to tombstoned workspaces.
			const member = await findLiveWorkspaceMembership(prisma, session.userId, session.workspaceId, { role: true });
			if (!member) {
				console.warn(
					'[ws] close forbidden',
					JSON.stringify({
						userId: session.userId,
						workspaceId: session.workspaceId,
						rawRoom: raw,
					})
				);
				conn.close(1008, 'forbidden');
				return;
			}

			// Namespace the room so shared IDs like "__notes_registry__" don't collide
			// across workspaces.
			//
			// The client may already namespace the room ("<workspaceId>:<docId>") so
			// we must avoid double-prefixing ("<ws>:<ws>:<docId>").
			let docName = raw;
			const expectedPrefix = `${session.workspaceId}:`;
			const hasNamespace = raw.includes(':');
			if (hasNamespace) {
				if (!raw.startsWith(expectedPrefix)) {
					console.warn(
						'[ws] close forbidden namespace',
						JSON.stringify({
							userId: session.userId,
							workspaceId: session.workspaceId,
							rawRoom: raw,
						})
					);
					conn.close(1008, 'forbidden');
					return;
				}
			} else {
				docName = `${session.workspaceId}:${raw}`;
			}
			persistAdapter?.registerDocWorkspace(docName, session.workspaceId);

			// y-websocket expects req.url === '/<room>'
			req.url = `/${docName}`;
			setupWSConnection(conn, req, { gc: true });
		} catch (err) {
			console.error('[ws] connection setup error:', err.message);
			try {
				conn.close(1011, 'internal error');
			} catch {
				// ignore
			}
		}
	})();
});

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown — flush all persisted docs before exit.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Performs a clean shutdown: flushes all active Yjs docs to PostgreSQL,
 * disconnects Redis, closes the Prisma client, and stops the HTTP server.
 *
 * @param {string} signal — The signal that triggered the shutdown (e.g. "SIGTERM").
 */
async function gracefulShutdown(signal) {
	console.info(`[server] ${signal} received — starting graceful shutdown...`);

	// 1. Stop the trash cleanup scheduler (no more periodic cycles).
	if (trashCleanup) {
		try {
			trashCleanup.stop();
		} catch (err) {
			console.error('[server] Error stopping trash cleanup:', err.message);
		}
	}

	// 2. Flush all active docs to PostgreSQL.
	if (persistAdapter) {
		try {
			await persistAdapter.destroy();
			console.info('[server] Persistence adapter flushed and destroyed');
		} catch (err) {
			console.error('[server] Error flushing persistence adapter:', err.message);
		}
	}

	// 3. Disconnect Prisma client.
	if (prisma) {
		try {
			await prisma.$disconnect();
			console.info('[server] Prisma client disconnected');
		} catch (err) {
			console.error('[server] Error disconnecting Prisma:', err.message);
		}
	}

	try {
		await unsubscribeWorkspaceMetadataEvents();
	} catch (err) {
		console.error('[server] Error unsubscribing workspace metadata events:', err.message);
	}

	if (redisSubscriber) {
		try {
			redisSubscriber.disconnect();
			console.info('[server] Redis subscriber disconnected');
		} catch (err) {
			console.error('[server] Error disconnecting Redis subscriber:', err.message);
		}
	}

	// 4. Close the HTTP + WebSocket server.
	try {
		wss.close();
		metadataWss.close();
		server.close(() => {
			console.info('[server] HTTP server closed');
			process.exit(0);
		});
	} catch {
		process.exit(1);
	}

	// Safety net: force exit after 10 seconds if graceful shutdown stalls.
	setTimeout(() => {
		console.error('[server] Forced exit after timeout');
		process.exit(1);
	}, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ── Safety net: prevent unhandled rejections from crashing the process ────
// Redis (and other async subsystems) can produce promise rejections that
// escape all try/catch guards during edge-case timing scenarios. Since Redis
// is a non-critical cache layer, these should never bring down the server.
process.on('unhandledRejection', (reason) => {
	console.error('[server] Unhandled promise rejection (server continues):', reason);
});

// ─────────────────────────────────────────────────────────────────────────────
// Start listening
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Async boot sequence:
//   1. If DATABASE_URL is set → ensure the database exists & schema is current.
//   2. Initialize the default workspace so it's ready before any client connects.
//   3. Start listening for HTTP / WebSocket connections.
//
// All database work happens BEFORE the server starts accepting traffic. This
// guarantees that the first client connection has a fully-provisioned backend.
// ─────────────────────────────────────────────────────────────────────────────

(async function boot() {
	// ── Step 1: Automatic database provisioning ─────────────────────────
	// Creates the database if it doesn't exist and syncs the Prisma schema
	// without data loss. Safe to run on every startup (idempotent).
	if (DATABASE_URL.length > 0) {
		try {
			const { ensureDatabase } = require('./server/dbInit');
			await ensureDatabase(DATABASE_URL);
		} catch (err) {
			console.error('[server] Database initialization failed:', err.message);
			if (process.env.NODE_ENV === 'production') {
				console.error('[server] Production startup requires a valid, migrated database. Exiting.');
				process.exit(1);
			}
			console.error('[server] The server will start, but persistence may not work.');
		}

		// ── Set PostgreSQL session timezone ───────────────────────────
		// Must happen after ensureDatabase (schema may not exist yet) and
		// before any Prisma queries that return timestamps. The SET command
		// applies to the current connection and affects all subsequent
		// timestamptz → text conversions in query results.
		if (prisma && PGTIMEZONE.length > 0) {
			try {
				await prisma.$executeRawUnsafe(`SET timezone = '${PGTIMEZONE.replace(/'/g, "''")}';`);
				console.info(`[server] PostgreSQL session timezone set to: ${PGTIMEZONE}`);
			} catch (err) {
				console.warn('[server] Failed to set PostgreSQL timezone:', err.message);
				console.warn('[server] Timestamps will be returned in UTC.');
			}
		}
	}

	// ── Step 2: Eagerly resolve the default workspace ───────────────────
	// The workspace row is needed before any Yjs doc can be persisted.
	// We do this after schema sync so the workspace table is guaranteed to exist.
	if (persistAdapter) {
		try {
			await persistAdapter._ensureWorkspace();
			console.info('[server] Default workspace initialized');
		} catch (err) {
			console.error('[server] WARNING: workspace initialization failed:', err.message);
			console.error('[server] PostgreSQL may not be reachable. Persistence writes will fail until resolved.');
		}
	}

	// ── Step 3: Start the trash cleanup scheduler ──────────────────────
	// Automatically deletes notes where trashed=true and trashedAt is older
	// than the user's deleteAfterDays preference. Runs periodically in the
	// background. Must start after workspace initialization so the adapter
	// has a valid workspace ID.
	if (persistAdapter && prisma) {
		try {
			const { createTrashCleanup } = require('./server/trashCleanup');
			trashCleanup = createTrashCleanup({
				prisma,
				adapter: persistAdapter,
				redis: redis || null,
				// Default: run every 60 minutes. Can be overridden via env var.
				intervalMs: Number(process.env.TRASH_CLEANUP_INTERVAL_MS) || 60 * 60 * 1000,
			});
			console.info('[server] Trash cleanup scheduler initialized');
		} catch (err) {
			console.error('[server] Failed to initialize trash cleanup:', err.message);
		}
	}

	if (redisSubscriber) {
		try {
			unsubscribeWorkspaceMetadataEvents = await subscribeToWorkspaceMetadataEvents(redisSubscriber, (event) => {
				if (event.origin && event.origin === SERVER_INSTANCE_ID) return;
				broadcastWorkspaceMetadataChanged(event);
			});
			console.info('[server] Workspace metadata Redis subscription initialized');
		} catch (err) {
			console.error('[server] Failed to subscribe to workspace metadata events:', err.message);
		}
	}

	// ── Step 4: Start the HTTP + WebSocket server ──────────────────────
	server.listen(PORT, HOST, () => {
		const publicBaseUrl = normalizedAppUrl();
		console.log(`[server] listening on ${HOST}:${PORT}`);
		console.log(`[server] http ${publicBaseUrl}`);
		console.log(`[server] yjs websocket ${wsUrlFromAppUrl(publicBaseUrl)}`);

		// ── Persistence status log ────────────────────────────────────
		if (persistAdapter) {
			console.log('[server] persistence: PostgreSQL (Prisma)');
			if (redis) {
				console.log('[server] cache: Redis');
			}
		} else if (YPERSISTENCE.length > 0) {
			console.log(`[server] persistence: LevelDB at ${YPERSISTENCE}`);
		} else {
			console.log('[server] persistence: NONE (relay-only)');
		}
	});
})().catch((err) => {
	// Catch-all for unexpected boot errors. Log and exit with non-zero code
	// so Docker/systemd can detect the failure and restart.
	console.error('[server] Fatal boot error:', err);
	process.exit(1);
});
