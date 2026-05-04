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
const { docs: liveDocs } = require('y-websocket/bin/utils');
const { createTimestampFormatter } = require('./timezone');
const { findLiveWorkspace, findLiveWorkspaceMembership } = require('./workspaceAccess');
const { normalizeWorkspaceRole, canEditWorkspaceContent } = require('./workspaceRoles');

const NOTES_REGISTRY_ID = '__notes_registry__';

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
function createApiRouter({ prisma, adapter, timezone = null, onWorkspaceMetadataChanged = null }) {
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

	function readJsonBody(req) {
		return new Promise((resolve) => {
			const chunks = [];
			req.on('data', (chunk) => chunks.push(chunk));
			req.on('end', () => {
				try {
					resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
				} catch {
					resolve(null);
				}
			});
			req.on('error', () => resolve(null));
		});
	}

	function ensureRegistryStructure(doc) {
		doc.getArray('notesList');
		doc.getArray('noteOrder');
	}

	function readTitleFromDoc(doc) {
		return doc.getText('title').toString();
	}

	function readTitleFromState(state, fallback) {
		if (!state || state.length === 0) return fallback;
		try {
			const doc = new Y.Doc();
			Y.applyUpdate(doc, new Uint8Array(state));
			const title = readTitleFromDoc(doc);
			doc.destroy();
			return title || fallback;
		} catch {
			return fallback;
		}
	}

	function makeRoomDocId(workspaceId, rawDocId) {
		return `${workspaceId}:${rawDocId}`;
	}

	function removeNoteFromRegistryDoc(doc, noteId) {
		ensureRegistryStructure(doc);
		const notesList = doc.getArray('notesList');
		const noteOrder = doc.getArray('noteOrder');
		const normalizedNoteId = String(noteId || '').trim();
		if (!normalizedNoteId) return;

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
		});
	}

	function addNoteToRegistryDoc(doc, noteId, title) {
		ensureRegistryStructure(doc);
		const notesList = doc.getArray('notesList');
		const noteOrder = doc.getArray('noteOrder');
		const normalizedNoteId = String(noteId || '').trim();
		if (!normalizedNoteId) return;

		doc.transact(() => {
			for (let index = notesList.length - 1; index >= 0; index--) {
				const item = notesList.get(index);
				if (String(item?.get?.('id') ?? '').trim() === normalizedNoteId) {
					notesList.delete(index, 1);
				}
			}
			const entry = new Y.Map();
			entry.set('id', normalizedNoteId);
			entry.set('title', String(title || ''));
			notesList.insert(0, [entry]);

			for (let index = noteOrder.length - 1; index >= 0; index--) {
				if (String(noteOrder.get(index) ?? '').trim() === normalizedNoteId) {
					noteOrder.delete(index, 1);
				}
			}
			noteOrder.insert(0, [normalizedNoteId]);
		});
	}

	async function loadRegistryRow(tx, workspaceId) {
		const docId = makeRoomDocId(workspaceId, NOTES_REGISTRY_ID);
		const row = await tx.document.findUnique({
			where: { docId },
			select: { id: true, state: true },
		});
		const doc = new Y.Doc();
		ensureRegistryStructure(doc);
		if (row?.state && row.state.length > 0) {
			Y.applyUpdate(doc, new Uint8Array(row.state));
		}
		return { docId, row, doc };
	}

	async function saveRegistryRow(tx, workspaceId, registry) {
		const state = Buffer.from(Y.encodeStateAsUpdate(registry.doc));
		const stateVector = Buffer.from(Y.encodeStateVector(registry.doc));
		if (registry.row?.id) {
			await tx.document.update({
				where: { id: registry.row.id },
				data: { state, stateVector },
			});
			return;
		}
		await tx.document.create({
			data: {
				workspaceId,
				docId: registry.docId,
				state,
				stateVector,
			},
		});
	}

	function updateLiveRegistryDoc(docId, apply) {
		const liveDoc = liveDocs.get(docId);
		if (!liveDoc) return;
		apply(liveDoc);
	}

	function closeLiveRoom(docId) {
		const liveDoc = liveDocs.get(docId);
		if (!liveDoc) return;
		const connections = Array.from(liveDoc.conns?.keys?.() || []);
		if (liveDoc.conns?.clear) {
			liveDoc.conns.clear();
		}
		liveDocs.delete(docId);
		for (const connection of connections) {
			try {
				connection.close(4000, 'room-moved');
			} catch {
				// ignore
			}
		}
		try {
			liveDoc.destroy();
		} catch {
			// ignore
		}
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

		function getSessionWorkspaceId() {
			return req.auth && typeof req.auth.workspaceId === 'string' && req.auth.workspaceId.length > 0
				? req.auth.workspaceId
				: null;
		}

		function requireAuthWorkspace() {
			const workspaceId = getSessionWorkspaceId();
			if (!req.auth || !req.auth.userId) {
				jsonResponse(res, 401, { error: 'Not authenticated' });
				return null;
			}
			if (!workspaceId) {
				jsonResponse(res, 400, { error: 'No active workspace' });
				return null;
			}
			return workspaceId;
		}

		function namespacedDocId(workspaceId, rawDocId) {
			return `${workspaceId}:${rawDocId}`;
		}

		function stripDocNamespace(workspaceId, storedDocId) {
			const prefix = `${workspaceId}:`;
			return String(storedDocId).startsWith(prefix)
				? String(storedDocId).slice(prefix.length)
				: storedDocId;
		}

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

		// ── About HUD metrics ─────────────────────────────────────────────
		// GET /api/system/hud-stats — lightweight server/app metrics for the
		// in-app About panel HUD. Available to all authenticated users.
		if (pathname === '/api/system/hud-stats' && method === 'GET') {
			(async () => {
				try {
					const workspaceId = requireAuthWorkspace();
					if (!workspaceId) return;

					const member = await findLiveWorkspaceMembership(prisma, req.auth.userId, workspaceId, { role: true });
					if (!member) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const [
						users,
						workspaces,
						documents,
						dbStateBytesRows,
						noteImageAgg,
						noteDocumentAgg,
					] = await Promise.all([
						prisma.user.count(),
						prisma.workspace.count({ where: { deletedAt: null } }),
						// Count only note documents — exclude the notes-registry doc for every
						// workspace (docIds ending in ":__notes_registry__") and the legacy
						// unnamespaced "__notes_registry__" sentinel.  This gives a 1:1 count
						// of unique Yjs note rooms, not total persisted document rows.
						prisma.document.count({
							where: {
								AND: [
									{ docId: { not: { endsWith: ':__notes_registry__' } } },
									{ docId: { not: '__notes_registry__' } },
								],
							},
						}),
						prisma.$queryRaw`
							SELECT COALESCE(SUM(octet_length(state)), 0)::bigint as bytes
							FROM document
						`,
						prisma.noteImage.aggregate({
							where: { deletedAt: null },
							_count: { _all: true },
							_sum: { byteSize: true },
						}),
						prisma.noteDocument.aggregate({
							where: { deletedAt: null },
							_count: { _all: true },
							_sum: { byteSize: true },
						}),
					]);

					const dbStateBytesRow = Array.isArray(dbStateBytesRows) ? dbStateBytesRows[0] : dbStateBytesRows;
					const dbStateBytes = Number(dbStateBytesRow?.bytes || 0);
					const noteImagesBytes = Number(noteImageAgg?._sum?.byteSize || 0);
					const noteDocumentsBytes = Number(noteDocumentAgg?._sum?.byteSize || 0);
					const uploadBytes = noteImagesBytes + noteDocumentsBytes;

					const memory = process.memoryUsage();
					jsonResponse(res, 200, {
						status: 'ok',
						generatedAt: new Date().toISOString(),
						uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
						process: {
							nodeVersion: process.version,
							pid: process.pid,
							rssBytes: Number(memory.rss || 0),
							heapUsedBytes: Number(memory.heapUsed || 0),
							heapTotalBytes: Number(memory.heapTotal || 0),
						},
						totals: {
							users,
							workspaces,
							documents,
							dbStateBytes,
							noteImagesBytes,
							noteDocumentsBytes,
							uploadBytes,
							noteImagesCount: Number(noteImageAgg?._count?._all || 0),
							noteDocumentsCount: Number(noteDocumentAgg?._count?._all || 0),
						},
					});
				} catch (err) {
					console.error('[api] GET /api/system/hud-stats error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── Workspace info ───────────────────────────────────────────────
		// GET /api/workspace — returns the active workspace metadata.
		if (pathname === '/api/workspace' && method === 'GET') {
			(async () => {
				try {
					const workspaceId = requireAuthWorkspace();
					if (!workspaceId) return;

					const member = await findLiveWorkspaceMembership(prisma, req.auth.userId, workspaceId, { role: true });
					if (!member) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const workspace = await findLiveWorkspace(prisma, workspaceId);
					if (!workspace) {
						jsonResponse(res, 404, { error: 'Workspace not found' });
						return;
					}
					jsonResponse(res, 200, {
						id: workspace.id,
						name: workspace.name,
						ownerUserId: workspace.ownerUserId,
						role: normalizeWorkspaceRole(member.role, 'VIEWER'),
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
					const workspaceId = requireAuthWorkspace();
					if (!workspaceId) return;

					const member = await findLiveWorkspaceMembership(prisma, req.auth.userId, workspaceId, { role: true });
					if (!member) {
						jsonResponse(res, 403, { error: 'Forbidden' });
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

					const result = docs.map((doc) => {
						const rawDocId = stripDocNamespace(workspaceId, doc.docId);
						return {
							docId: rawDocId,
						sizeBytes: sizeMap.get(doc.docId) || 0,
						updatedAt: fmt(doc.updatedAt),
						createdAt: fmt(doc.createdAt),
					};
					});

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
					const workspaceId = requireAuthWorkspace();
					if (!workspaceId) return;

					const member = await findLiveWorkspaceMembership(prisma, req.auth.userId, workspaceId, { role: true });
					if (!member) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const storedDocId = namespacedDocId(workspaceId, docId);
					let row = await prisma.document.findFirst({
						where: { docId: storedDocId, workspaceId },
						select: { state: true, updatedAt: true, createdAt: true },
					});

					// Backward-compat: legacy docs (un-namespaced docId)
					if (!row) {
						row = await prisma.document.findFirst({
							where: { docId, workspaceId },
						select: { state: true, updatedAt: true, createdAt: true },
					});
					}
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

		const moveNoteMatch = pathname.match(/^\/api\/notes\/([^/]+)\/move$/);
		if (moveNoteMatch && method === 'POST') {
			(async () => {
				try {
					if (!req.auth || !req.auth.userId) {
						jsonResponse(res, 401, { error: 'Not authenticated' });
						return;
					}

					const body = await readJsonBody(req);
					const sessionWorkspaceId = getSessionWorkspaceId();
					const sourceWorkspaceId = typeof body?.sourceWorkspaceId === 'string' && body.sourceWorkspaceId.trim()
						? body.sourceWorkspaceId.trim()
						: sessionWorkspaceId;
					const targetWorkspaceId = typeof body?.targetWorkspaceId === 'string' ? body.targetWorkspaceId.trim() : '';
					if (!sourceWorkspaceId) {
						jsonResponse(res, 400, { error: 'sourceWorkspaceId is required' });
						return;
					}
					if (!targetWorkspaceId) {
						jsonResponse(res, 400, { error: 'targetWorkspaceId is required' });
						return;
					}
					if (targetWorkspaceId === sourceWorkspaceId) {
						jsonResponse(res, 400, { error: 'Note is already in that workspace' });
						return;
					}

					const noteId = decodeURIComponent(moveNoteMatch[1]).trim();
					if (!noteId) {
						jsonResponse(res, 400, { error: 'noteId is required' });
						return;
					}

					const [sourceMembership, targetWorkspace, targetMembership, sourceRow] = await Promise.all([
						findLiveWorkspaceMembership(prisma, req.auth.userId, sourceWorkspaceId, { role: true }),
						findLiveWorkspace(prisma, targetWorkspaceId, { id: true, systemKind: true }),
						findLiveWorkspaceMembership(prisma, req.auth.userId, targetWorkspaceId, { role: true }),
						prisma.document.findUnique({
							where: { docId: makeRoomDocId(sourceWorkspaceId, noteId) },
							select: { id: true, state: true, stateVector: true },
						}),
					]);
					if (!sourceMembership || !canEditWorkspaceContent(sourceMembership.role)) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}
					if (!targetWorkspace) {
						jsonResponse(res, 404, { error: 'Target workspace not found' });
						return;
					}
					if (targetWorkspace.systemKind === 'SHARED_WITH_ME') {
						jsonResponse(res, 400, { error: 'Notes cannot be moved into Shared With Me' });
						return;
					}
					if (!targetMembership || !canEditWorkspaceContent(targetMembership.role)) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}
					if (!sourceRow) {
						jsonResponse(res, 404, { error: 'Note not found' });
						return;
					}

					const sourceDocId = makeRoomDocId(sourceWorkspaceId, noteId);
					const targetDocId = makeRoomDocId(targetWorkspaceId, noteId);
					const liveSourceDoc = liveDocs.get(sourceDocId) || null;
					const noteState = liveSourceDoc
						? Buffer.from(Y.encodeStateAsUpdate(liveSourceDoc))
						: sourceRow.state;
					const noteTitle = liveSourceDoc
						? readTitleFromDoc(liveSourceDoc)
						: readTitleFromState(sourceRow.state, noteId);
					const sanitizedMoveDoc = new Y.Doc();
					Y.applyUpdate(sanitizedMoveDoc, new Uint8Array(noteState));
					sanitizedMoveDoc.transact(() => {
						const metadata = sanitizedMoveDoc.getMap('metadata');
						metadata.set('collectionId', null);
						metadata.set('labelIds', []);
						metadata.set('updatedAt', Date.now());
					});
					const noteStateBuffer = Buffer.from(Y.encodeStateAsUpdate(sanitizedMoveDoc));
					const noteStateVector = Buffer.from(Y.encodeStateVector(sanitizedMoveDoc));
					sanitizedMoveDoc.destroy();

					const targetDocExists = await prisma.document.findUnique({
						where: { docId: targetDocId },
						select: { id: true },
					});
					if (targetDocExists) {
						jsonResponse(res, 409, { error: 'A note with this id already exists in the target workspace' });
						return;
					}

					const [shareCollaborators, shareInvitations] = await Promise.all([
						prisma.noteCollaborator.findMany({
							where: { docId: sourceDocId, revokedAt: null },
							select: { userId: true },
						}),
						prisma.noteShareInvitation.findMany({
							where: { docId: sourceDocId, revokedAt: null },
							select: { inviteeUserId: true, inviterUserId: true },
						}),
					]);
					const affectedShareUserIds = Array.from(new Set([
						req.auth && req.auth.userId ? String(req.auth.userId) : '',
						...shareCollaborators.map((row) => String(row.userId || '')),
						...shareInvitations.map((row) => String(row.inviteeUserId || '')),
						...shareInvitations.map((row) => String(row.inviterUserId || '')),
					].filter(Boolean)));

					await prisma.$transaction(async (tx) => {
						const sourceRegistry = await loadRegistryRow(tx, sourceWorkspaceId);
						const targetRegistry = await loadRegistryRow(tx, targetWorkspaceId);

						removeNoteFromRegistryDoc(sourceRegistry.doc, noteId);
						addNoteToRegistryDoc(targetRegistry.doc, noteId, noteTitle);

						await tx.shareAccessToken.updateMany({
							where: {
								entityType: 'NOTE',
								entityId: sourceDocId,
							},
							data: {
								entityId: targetDocId,
								sourceWorkspaceId: targetWorkspaceId,
							},
						});
						await tx.shareToken.updateMany({
							where: { docId: sourceDocId },
							data: { docId: targetDocId },
						});
						await tx.noteShareInvitation.updateMany({
							where: { docId: sourceDocId },
							data: {
								docId: targetDocId,
								sourceWorkspaceId: targetWorkspaceId,
							},
						});
						await tx.noteCollaborator.updateMany({
							where: { docId: sourceDocId },
							data: {
								docId: targetDocId,
								sourceWorkspaceId: targetWorkspaceId,
							},
						});
						await tx.noteImage.updateMany({
							where: { docId: sourceDocId },
							data: {
								docId: targetDocId,
								sourceWorkspaceId: targetWorkspaceId,
							},
						});
						await tx.noteLink.updateMany({
							where: { docId: sourceDocId },
							data: {
								docId: targetDocId,
								sourceWorkspaceId: targetWorkspaceId,
							},
						});
						await tx.noteDocument.updateMany({
							where: { docId: sourceDocId },
							data: {
								docId: targetDocId,
								sourceWorkspaceId: targetWorkspaceId,
							},
						});

						await tx.document.update({
							where: { id: sourceRow.id },
							data: {
								workspaceId: targetWorkspaceId,
								docId: targetDocId,
								state: noteStateBuffer,
								stateVector: noteStateVector,
							},
						});

						await saveRegistryRow(tx, sourceWorkspaceId, sourceRegistry);
						await saveRegistryRow(tx, targetWorkspaceId, targetRegistry);
					});

					updateLiveRegistryDoc(makeRoomDocId(sourceWorkspaceId, NOTES_REGISTRY_ID), (doc) => removeNoteFromRegistryDoc(doc, noteId));
					updateLiveRegistryDoc(makeRoomDocId(targetWorkspaceId, NOTES_REGISTRY_ID), (doc) => addNoteToRegistryDoc(doc, noteId, noteTitle));
					closeLiveRoom(sourceDocId);

					jsonResponse(res, 200, {
						noteId,
						sourceWorkspaceId,
						targetWorkspaceId,
						docId: targetDocId,
					});

					if (typeof onWorkspaceMetadataChanged === 'function' && affectedShareUserIds.length > 0) {
						try {
							await onWorkspaceMetadataChanged({
								reason: 'note-share-moved',
								workspaceId: targetWorkspaceId,
								docId: targetDocId,
								userIds: affectedShareUserIds,
							});
						} catch (publishErr) {
							console.warn('[api] note move metadata publish failed:', publishErr.message);
						}
					}
				} catch (err) {
					console.error('[api] POST /api/notes/:noteId/move error:', err.message);
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
					const workspaceId = requireAuthWorkspace();
					if (!workspaceId) return;
					const member = await findLiveWorkspaceMembership(prisma, req.auth.userId, workspaceId, { role: true });
					if (!member) {
						jsonResponse(res, 403, { error: 'Forbidden' });
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

		if (pathname === '/api/trash/empty' && method === 'POST') {
			(async () => {
				try {
					const workspaceId = requireAuthWorkspace();
					if (!workspaceId) return;
					const member = await findLiveWorkspaceMembership(prisma, req.auth.userId, workspaceId, { role: true });
					if (!member || !canEditWorkspaceContent(member.role)) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const allDocs = await prisma.document.findMany({
						where: { workspaceId },
						select: { id: true, docId: true, state: true },
					});

					const trashedDocIds = [];
					const trashedNoteIds = [];
					for (const row of allDocs) {
						if (row.docId === makeRoomDocId(workspaceId, NOTES_REGISTRY_ID)) continue;
						if (!row.state || row.state.length === 0) continue;
						try {
							const liveDoc = liveDocs.get(row.docId) || null;
							if (liveDoc) {
								const metadata = liveDoc.getMap('metadata');
								if (Boolean(metadata.get('trashed'))) {
									trashedDocIds.push(row.id);
									trashedNoteIds.push(row.docId);
								}
								continue;
							}
							const tempDoc = new Y.Doc();
							Y.applyUpdate(tempDoc, new Uint8Array(row.state));
							if (Boolean(tempDoc.getMap('metadata').get('trashed'))) {
								trashedDocIds.push(row.id);
								trashedNoteIds.push(row.docId);
							}
							tempDoc.destroy();
						} catch (decodeErr) {
							console.warn(`[api] POST /api/trash/empty — failed to decode doc ${row.docId}:`, decodeErr.message);
						}
					}

					if (trashedDocIds.length === 0) {
						jsonResponse(res, 200, { deletedCount: 0, noteIds: [] });
						return;
					}

					await prisma.$transaction(async (tx) => {
						const registry = await loadRegistryRow(tx, workspaceId);
						for (const storedDocId of trashedNoteIds) {
							removeNoteFromRegistryDoc(registry.doc, String(storedDocId).slice(`${workspaceId}:`.length));
						}
						await tx.shareAccessToken.deleteMany({
							where: {
								entityType: 'NOTE',
								entityId: { in: trashedNoteIds },
							},
						});
						await tx.shareToken.deleteMany({
							where: { docId: { in: trashedNoteIds } },
						});
						await tx.document.deleteMany({ where: { id: { in: trashedDocIds } } });
						await saveRegistryRow(tx, workspaceId, registry);
					});

					updateLiveRegistryDoc(makeRoomDocId(workspaceId, NOTES_REGISTRY_ID), (doc) => {
						for (const storedDocId of trashedNoteIds) {
							removeNoteFromRegistryDoc(doc, String(storedDocId).slice(`${workspaceId}:`.length));
						}
					});
					for (const storedDocId of trashedNoteIds) {
						closeLiveRoom(storedDocId);
					}

					jsonResponse(res, 200, {
						deletedCount: trashedNoteIds.length,
						noteIds: trashedNoteIds.map((storedDocId) => String(storedDocId).slice(`${workspaceId}:`.length)),
					});
				} catch (err) {
					console.error('[api] POST /api/trash/empty error:', err.message);
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
