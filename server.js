'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// FreemanNotes – Production Runtime Server (Phase 8)
//
// Serves the Vite build output, hosts the Yjs WebSocket sync endpoint, and
// integrates optional PostgreSQL persistence (via Prisma) with optional Redis
// caching. All persistence is backward-compatible: the server still works as
// a relay-only WebSocket bridge when DATABASE_URL is not configured.
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
// Docker / Unraid:
//   - Set DATABASE_URL to your PostgreSQL connection string.
//   - Optionally set REDIS_URL for Redis caching.
//   - Run `npx prisma migrate deploy` or `npx prisma db push` on first boot.
//   - Mount volumes as needed for LevelDB fallback if desired.
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

// ─────────────────────────────────────────────────────────────────────────────
// Prisma + Redis initialization (conditional — only when DATABASE_URL is set).
// When DATABASE_URL is absent, the server runs in relay-only mode (legacy).
// ─────────────────────────────────────────────────────────────────────────────

/** @type {import('@prisma/client').PrismaClient | null} */
let prisma = null;

/** @type {import('ioredis').Redis | null} */
let redis = null;

/** @type {import('./server/YjsPersistenceAdapter').YjsPersistenceAdapter | null} */
let persistAdapter = null;

/** @type {ReturnType<import('./server/apiRouter').createApiRouter> | null} */
let apiRouter = null;

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
				// Reconnect automatically with exponential backoff.
				retryStrategy: (times) => Math.min(times * 200, 5000),
				// Don't throw on connection failure — persistence still works via PG.
				lazyConnect: false,
				maxRetriesPerRequest: 3,
			});
			redis.on('connect', () => console.info('[server] Redis connected'));
			redis.on('error', (err) => console.warn('[server] Redis error:', err.message));
			console.info('[server] Redis client initialized (REDIS_URL is set)');
		} catch (err) {
			console.error('[server] Failed to initialize Redis client:', err.message);
			console.error('[server] Redis caching will be DISABLED.');
			redis = null;
		}
	}

	// ── Persistence adapter + API router (only with valid Prisma) ────────
	if (prisma) {
		try {
			const { YjsPersistenceAdapter } = require('./server/YjsPersistenceAdapter');
			persistAdapter = new YjsPersistenceAdapter(prisma, {
				redis: redis || null,
				workspaceName: 'default',
				debounceMs: 2000,
			});
			console.info('[server] YjsPersistenceAdapter initialized');

			const { createApiRouter } = require('./server/apiRouter');
			apiRouter = createApiRouter({ prisma, adapter: persistAdapter, timezone: PGTIMEZONE || null });
			console.info('[server] REST API router initialized');

			const { createPreferencesRouter } = require('./server/preferencesRouter');
			preferencesRouter = createPreferencesRouter({ prisma, timezone: PGTIMEZONE || null });
			console.info('[server] Preferences API router initialized');
		} catch (err) {
			console.error('[server] Failed to initialize persistence adapter:', err.message);
			persistAdapter = null;
			apiRouter = null;
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
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

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
				res.writeHead(500);
				res.end('Internal Server Error');
			})
			.pipe(res);
	} catch {
		res.writeHead(500);
		res.end('Internal Server Error');
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

// ── Server-side ping/pong keep-alive ─────────────────────────────────────
// Track liveness per connection so we can terminate unresponsive clients.
const wsAliveMap = new WeakMap();

const wsPingInterval = setInterval(() => {
	for (const ws of wss.clients) {
		if (wsAliveMap.get(ws) === false) {
			// No pong received since last ping — connection is dead.
			ws.terminate();
			continue;
		}
		wsAliveMap.set(ws, false);
		ws.ping();
	}
}, WS_PING_INTERVAL_MS);

// Clean up the interval when the WebSocket server closes.
wss.on('close', () => {
	clearInterval(wsPingInterval);
});

server.on('upgrade', (req, socket, head) => {
	socket.on('error', () => {
		// ignore (ECONNRESET etc)
	});

	const url = req.url || '/';
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

wss.on('connection', (conn, req) => {
	// ── Ping/pong liveness tracking ──────────────────────────────────────
	// Mark this connection as alive. The wsPingInterval periodically sets
	// alive=false then sends a ping; if no pong arrives before the next
	// cycle the connection is terminated.
	wsAliveMap.set(conn, true);
	conn.on('pong', () => {
		wsAliveMap.set(conn, true);
	});

	// ── Yjs WebSocket setup ──────────────────────────────────────────────
	// Client connects to /yjs/<room>; y-websocket expects /<room>
	req.url = String(req.url || '/').replace(/^\/yjs/, '') || '/';
	setupWSConnection(conn, req, { gc: true });
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

	// 4. Close the HTTP + WebSocket server.
	try {
		wss.close();
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
