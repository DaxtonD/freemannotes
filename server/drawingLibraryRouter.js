'use strict';

// Drawing Library REST API router for FreemanNotes.
//
// Persists each user's Excalidraw library items server-side so they
// are available across all devices.
//
// Endpoints:
//   GET /api/drawing-library  — Returns the current user's library items.
//   PUT /api/drawing-library  — Replaces the current user's library items.

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient }} deps
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => boolean}
 */
function createDrawingLibraryRouter({ prisma }) {
	function json(res, status, body) {
		res.writeHead(status, {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'no-store',
		});
		res.end(JSON.stringify(body));
	}

	function readBody(req) {
		return new Promise((resolve, reject) => {
			const chunks = [];
			let total = 0;
			req.on('data', (chunk) => {
				total += chunk.length;
				if (total > MAX_BODY_BYTES) {
					reject(new Error('body_too_large'));
					return;
				}
				chunks.push(chunk);
			});
			req.on('end', () => {
				try {
					resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
				} catch {
					resolve(null);
				}
			});
			req.on('error', reject);
		});
	}

	function handleRequest(req, res) {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		if (url.pathname !== '/api/drawing-library') return false;

		const userId = req.auth?.userId ?? null;
		if (!userId) {
			json(res, 401, { error: 'Not authenticated' });
			return true;
		}

		if (req.method === 'GET') {
			(async () => {
				try {
					const row = await prisma.userPreference.findUnique({
						where: { userId },
						select: { drawingLibrary: true },
					});
					json(res, 200, { libraryItems: row?.drawingLibrary ?? [] });
				} catch (err) {
					console.error('[drawingLibraryRouter] GET error:', err.message);
					json(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		if (req.method === 'PUT') {
			(async () => {
				let body;
				try {
					body = await readBody(req);
				} catch (err) {
					if (err.message === 'body_too_large') {
						json(res, 413, { error: 'Library too large' });
					} else {
						json(res, 400, { error: 'Bad request' });
					}
					return;
				}

				if (!body || !Array.isArray(body.libraryItems)) {
					json(res, 400, { error: 'libraryItems must be an array' });
					return;
				}

				try {
					await prisma.userPreference.upsert({
						where: { userId },
						update: { drawingLibrary: body.libraryItems },
						create: { userId, drawingLibrary: body.libraryItems },
					});
					json(res, 200, { ok: true });
				} catch (err) {
					console.error('[drawingLibraryRouter] PUT error:', err.message);
					json(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		return false;
	}

	return handleRequest;
}

module.exports = { createDrawingLibraryRouter };
