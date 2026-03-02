'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// REST API router for FreemanNotes server.
//
// Provides lightweight HTTP endpoints for querying persisted Yjs doc state.
// These endpoints are READ-ONLY — all writes go through the Yjs WebSocket
// protocol. The REST layer exists for:
//
//   - Health / readiness checks (/healthz, /readyz)
//   - Listing all persisted docs in a workspace (/api/docs)
//   - Fetching a single doc snapshot (/api/docs/:docId)
//   - Fetching workspace metadata (/api/workspace)
//
// All endpoints are scoped to the active workspace configured in the
// persistence adapter. Future multi-workspace support can extend the
// routing to include a workspace ID path segment.
//
// The router is a plain function that takes (req, res) and returns true if
// it handled the request, false otherwise. This allows the main server.js
// to chain it before the static file handler without introducing a framework
// dependency (no Express/Koa).
//
// Dependencies:
//   - @prisma/client (via the persistence adapter)
//   - yjs (for decoding stored state into readable snapshots)
// ─────────────────────────────────────────────────────────────────────────────

const Y = require('yjs');
const { createTimestampFormatter } = require('./timezone');

/**
 * Creates an API router function that handles REST endpoints.
 *
 * @param {object} deps — Injected dependencies.
 * @param {import('@prisma/client').PrismaClient} deps.prisma — Prisma client instance.
 * @param {import('./YjsPersistenceAdapter').YjsPersistenceAdapter} deps.adapter — Persistence adapter.
 * @param {string | null} [deps.timezone] — IANA timezone for formatting timestamps (e.g. "America/Regina").
 *   When null/empty, all timestamps are returned as UTC ISO-8601 strings.
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => boolean}
 *   Returns true if the request was handled, false if it should fall through.
 */
function createApiRouter({ prisma, adapter, timezone = null }) {
	// ── Timezone-aware formatter ─────────────────────────────────────────
	// All timestamps in API responses go through this formatter so that
	// Prisma Date objects (from timestamptz columns) and Yjs epoch-ms
	// integers (from note metadata) are consistently presented in the
	// configured timezone. Internal storage remains UTC.
	const fmt = createTimestampFormatter(timezone);

	/**
	 * Sends a JSON response with the given status code and body.
	 *
	 * @param {import('http').ServerResponse} res
	 * @param {number} status — HTTP status code.
	 * @param {any} body — JSON-serializable response body.
	 */
	function jsonResponse(res, status, body) {
		const json = JSON.stringify(body);
		res.writeHead(status, {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'no-store',
		});
		res.end(json);
	}

	/**
	 * The main router handler. Returns true if the request was handled.
	 *
	 * @param {import('http').IncomingMessage} req
	 * @param {import('http').ServerResponse} res
	 * @returns {boolean} Whether the request was handled by this router.
	 */
	function handleRequest(req, res) {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname;
		const method = req.method || 'GET';

		// ── Health endpoint ──────────────────────────────────────────────
		// Kept here as well as in server.js for backward compatibility.
		// Returns 200 "ok" for reverse-proxy health checks.
		if (pathname === '/healthz' && method === 'GET') {
			res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('ok');
			return true;
		}

		// ── Readiness endpoint ───────────────────────────────────────────
		// Returns 200 only once the persistence adapter has resolved its
		// workspace and the Prisma client can talk to PostgreSQL.
		if (pathname === '/readyz' && method === 'GET') {
			const workspaceId = adapter.getWorkspaceId();
			if (workspaceId) {
				jsonResponse(res, 200, { status: 'ready', workspaceId });
			} else {
				jsonResponse(res, 503, { status: 'not-ready' });
			}
			return true;
		}

		// ── Timezone info ────────────────────────────────────────────────
		// GET /api/timezone — returns the configured PGTIMEZONE and current
		// server time formatted in that timezone. Useful for clients to
		// verify timezone configuration without inspecting individual notes.
		if (pathname === '/api/timezone' && method === 'GET') {
			const now = new Date();
			jsonResponse(res, 200, {
				timezone: timezone || 'UTC',
				serverTimeUtc: now.toISOString(),
				serverTimeLocal: fmt(now),
			});
			return true;
		}

		// ── Workspace info ───────────────────────────────────────────────
		// GET /api/workspace — returns the active workspace metadata.
		if (pathname === '/api/workspace' && method === 'GET') {
			(async () => {
				try {
					const workspaceId = adapter.getWorkspaceId();
					if (!workspaceId) {
						jsonResponse(res, 503, { error: 'Workspace not initialized yet' });
						return;
					}
					const workspace = await prisma.workspace.findUnique({
						where: { id: workspaceId },
					});
					if (!workspace) {
						jsonResponse(res, 404, { error: 'Workspace not found' });
						return;
					}
					jsonResponse(res, 200, {
						id: workspace.id,
						name: workspace.name,
						ownerUserId: workspace.ownerUserId,
						createdAt: fmt(workspace.createdAt),
						updatedAt: fmt(workspace.updatedAt),
						timezone: timezone || 'UTC',
					});
				} catch (err) {
					console.error('[api] GET /api/workspace error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── List all docs ────────────────────────────────────────────────
		// GET /api/docs — returns a list of all persisted doc IDs and sizes.
		if (pathname === '/api/docs' && method === 'GET') {
			(async () => {
				try {
					const workspaceId = adapter.getWorkspaceId();
					if (!workspaceId) {
						jsonResponse(res, 503, { error: 'Workspace not initialized yet' });
						return;
					}
					const docs = await prisma.document.findMany({
						where: { workspaceId },
						select: {
							docId: true,
							updatedAt: true,
							createdAt: true,
							// Include state length for size info without transferring the blob.
							state: false,
						},
						orderBy: { updatedAt: 'desc' },
					});

					// For size info, we need a raw query or compute in JS.
					// Prisma doesn't support selecting length of a Bytes field directly,
					// so we re-query with raw SQL for sizes.
					const sizes = await prisma.$queryRaw`
						SELECT doc_id, octet_length(state) as size_bytes
						FROM document
						WHERE workspace_id = ${workspaceId}::uuid
					`;
					const sizeMap = new Map(
						/** @type {Array<{doc_id: string, size_bytes: number}>} */ (sizes).map(
							(s) => [s.doc_id, Number(s.size_bytes)]
						)
					);

					const result = docs.map((doc) => ({
						docId: doc.docId,
						sizeBytes: sizeMap.get(doc.docId) || 0,
						updatedAt: fmt(doc.updatedAt),
						createdAt: fmt(doc.createdAt),
					}));

					jsonResponse(res, 200, { docs: result, count: result.length, timezone: timezone || 'UTC' });
				} catch (err) {
					console.error('[api] GET /api/docs error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── Get single doc snapshot ──────────────────────────────────────
		// GET /api/docs/:docId — returns the decoded Yjs doc state as JSON.
		// The response includes the raw structure of the Yjs shared types
		// (title, content, checklist, metadata) decoded from the binary state.
		const docMatch = pathname.match(/^\/api\/docs\/([^/]+)$/);
		if (docMatch && method === 'GET') {
			const docId = decodeURIComponent(docMatch[1]);
			(async () => {
				try {
					const workspaceId = adapter.getWorkspaceId();
					if (!workspaceId) {
						jsonResponse(res, 503, { error: 'Workspace not initialized yet' });
						return;
					}
					const row = await prisma.document.findUnique({
						where: { docId },
						select: { state: true, updatedAt: true, createdAt: true },
					});
					if (!row || !row.state) {
						jsonResponse(res, 404, { error: 'Document not found', docId });
						return;
					}

					// Decode the binary Yjs state into a temporary Y.Doc to extract
					// the shared type contents as plain JSON.
					const tempDoc = new Y.Doc();
					Y.applyUpdate(tempDoc, new Uint8Array(row.state));

					const title = tempDoc.getText('title').toString();
					const content = tempDoc.getText('content').toString();
					const rawMetadata = tempDoc.getMap('metadata').toJSON();
					const checklist = tempDoc.getArray('checklist').toJSON();

					tempDoc.destroy();

					// Format Yjs epoch-ms timestamps from note metadata through
					// the timezone formatter for consistent presentation.
					const metadata = { ...rawMetadata };
					if (typeof metadata.createdAt === 'number') {
						metadata.createdAt = fmt(metadata.createdAt);
					}
					if (typeof metadata.updatedAt === 'number') {
						metadata.updatedAt = fmt(metadata.updatedAt);
					}

					jsonResponse(res, 200, {
						docId,
						sizeBytes: row.state.length,
						updatedAt: fmt(row.updatedAt),
						createdAt: fmt(row.createdAt),
						snapshot: { title, content, metadata, checklist },
						timezone: timezone || 'UTC',
					});
				} catch (err) {
					console.error(`[api] GET /api/docs/${docId} error:`, err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── List trashed notes ───────────────────────────────────────────
		// GET /api/trash — returns a list of all notes where metadata.trashed === true.
		// Each entry includes the docId, title, trashedAt timestamp, and size.
		// This endpoint decodes every persisted Yjs doc to inspect its metadata,
		// which is acceptable for the expected volume of trashed notes.
		if (pathname === '/api/trash' && method === 'GET') {
			(async () => {
				try {
					const workspaceId = adapter.getWorkspaceId();
					if (!workspaceId) {
						jsonResponse(res, 503, { error: 'Workspace not initialized yet' });
						return;
					}

					const allDocs = await prisma.document.findMany({
						where: { workspaceId },
						select: { docId: true, state: true, updatedAt: true, createdAt: true },
					});

					const trashedNotes = [];
					for (const row of allDocs) {
						// Skip the notes registry — it's not a user note.
						if (row.docId === '__notes_registry__') continue;
						if (!row.state || row.state.length === 0) continue;

						try {
							const tempDoc = new Y.Doc();
							Y.applyUpdate(tempDoc, new Uint8Array(row.state));
							const metadata = tempDoc.getMap('metadata');
							const trashed = Boolean(metadata.get('trashed'));

							if (trashed) {
								const trashedAt = metadata.get('trashedAt');
								const title = tempDoc.getText('title').toString();
								const noteType = String(metadata.get('type') ?? 'text');

								trashedNotes.push({
									docId: row.docId,
									title,
									type: noteType,
									trashedAt: typeof trashedAt === 'string' ? trashedAt : null,
									trashedAtRaw: typeof trashedAt === 'string' ? new Date(trashedAt).getTime() : null,
									sizeBytes: row.state.length,
									updatedAt: fmt(row.updatedAt),
									createdAt: fmt(row.createdAt),
								});
							}

							tempDoc.destroy();
						} catch (decodeErr) {
							console.warn(`[api] GET /api/trash — failed to decode doc ${row.docId}:`, decodeErr.message);
						}
					}

					// Sort by trashedAt descending (most recently trashed first).
					trashedNotes.sort((a, b) => (b.trashedAtRaw || 0) - (a.trashedAtRaw || 0));

					jsonResponse(res, 200, {
						notes: trashedNotes,
						count: trashedNotes.length,
						timezone: timezone || 'UTC',
					});
				} catch (err) {
					console.error('[api] GET /api/trash error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── Not handled by this router → fall through ────────────────────
		return false;
	}

	return handleRequest;
}

module.exports = { createApiRouter };
