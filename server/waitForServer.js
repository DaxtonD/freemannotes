'use strict';

// Polls the backend /healthz endpoint until it responds 200, then exits.
// Used by `npm run dev` so Vite doesn't start proxying before server.js is ready.

const http = require('http');

const target = process.env.VITE_API_PROXY_TARGET || 'http://localhost:27015';
const url = new URL('/healthz', target);
const MAX_WAIT_MS = 60_000;
const POLL_MS = 400;

const start = Date.now();

function check() {
	if (Date.now() - start > MAX_WAIT_MS) {
		console.error('[wait] Server did not become ready within 60s — starting Vite anyway');
		process.exit(0);
	}

	const req = http.get(url, (res) => {
		if (res.statusCode === 200) {
			console.log('[wait] Server is ready');
			process.exit(0);
		}
		res.resume();
		setTimeout(check, POLL_MS);
	});
	req.on('error', () => setTimeout(check, POLL_MS));
	req.setTimeout(2000, () => {
		req.destroy();
		setTimeout(check, POLL_MS);
	});
}

check();
