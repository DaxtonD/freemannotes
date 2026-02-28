'use strict';

// Production runtime server:
// - Serves the Vite build output from ./dist
// - Hosts Yjs websocket sync at /yjs/* on the SAME port (reverse-proxy friendly)
//
// Docker/Unraid guidance:
// - Mount a volume and set YPERSISTENCE=/data/yjs to persist Yjs docs (LevelDB)
// - Set PORT to choose the listening port

try {
	// Optional. Loads .env into process.env for local/dev parity.
	// In Docker, you can pass env vars directly or via docker-compose env_file.
	require('dotenv').config();
} catch {
	// ignore if dotenv isn't installed
}

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');

const PORT = Number(process.env.PORT || 27015);
const DIST_DIR = path.join(__dirname, 'dist');

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

const server = http.createServer((req, res) => {
	try {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			res.writeHead(405);
			res.end('Method Not Allowed');
			return;
		}

		// Health endpoint for reverse proxies.
		if (url.pathname === '/healthz') {
			res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('ok');
			return;
		}

		// Serve static files from dist.
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

// WebSocket server for Yjs, attached to same HTTP server.
const wss = new WebSocket.Server({ noServer: true });

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
	// Client connects to /yjs/<room>; y-websocket expects /<room>
	req.url = String(req.url || '/').replace(/^\/yjs/, '') || '/';
	setupWSConnection(conn, req, { gc: true });
});

server.listen(PORT, () => {
	console.log(`[server] http://localhost:${PORT}`);
	console.log(`[server] yjs websocket ws://localhost:${PORT}/yjs/<room>`);
	if (process.env.YPERSISTENCE) {
		console.log(`[server] YPERSISTENCE enabled at ${process.env.YPERSISTENCE}`);
	} else {
		console.log('[server] YPERSISTENCE not set (relay-only server)');
	}
});
