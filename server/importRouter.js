'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Import / Export REST endpoints
//
//   POST /api/import/batch
//     Body: { workspaceId, notes: [{ noteId, title, type, state (base64) }], labelNames: string[] }
//     Saves pre-encoded Yjs states (built client-side using noteModel factories)
//     directly to PostgreSQL and updates the workspace's notes registry doc.
//
//   GET /api/workspaces/:workspaceId/export
//     Returns { files: [{ name, content }] } — client zips them with JSZip.
//
// The client encodes Yjs doc states so y-prosemirror is never needed server-side.
// The outer handler function is SYNCHRONOUS so it correctly returns false when
// the URL doesn't match (a Promise<false> would be truthy and break the chain).
// ─────────────────────────────────────────────────────────────────────────────

const { randomUUID } = require('crypto');
const Y = require('yjs');
const { findLiveWorkspaceMembership } = require('./workspaceAccess');
const { canEditWorkspaceContent, normalizeWorkspaceRole } = require('./workspaceRoles');

const NOTES_REGISTRY_ID = '__notes_registry__';
const LABELS_REGISTRY_ID = '__labels_registry__';
const MAX_IMPORT_BATCH = 25;

function jsonResponse(res, statusCode, body) {
	res.statusCode = statusCode;
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(body));
}

function errorResponse(res, err) {
	if (!res.headersSent) {
		res.writeHead(500);
		res.end('Internal Server Error');
	}
	console.error('[import-router] unhandled error:', err?.message ?? err);
}

function normalizeName(name) {
	return typeof name === 'string' ? name.trim() : '';
}

function normalizeComparableName(name) {
	return normalizeName(name).toLowerCase();
}

function makeId() {
	try { return randomUUID(); } catch { return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
}

function sanitizeFilename(name) {
	return String(name ?? 'Untitled')
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
		.replace(/^\.+/, '_')
		.trim()
		.slice(0, 200) || 'Untitled';
}

async function loadDoc(prisma, docId) {
	const doc = new Y.Doc();
	const row = await prisma.document.findFirst({
		where: { docId },
		select: { state: true },
	});
	if (row?.state?.length > 0) {
		Y.applyUpdate(doc, new Uint8Array(row.state));
	}
	return doc;
}

async function saveDoc(prisma, docId, workspaceId, doc) {
	const state = Buffer.from(Y.encodeStateAsUpdate(doc));
	const stateVector = Buffer.from(Y.encodeStateVector(doc));
	await prisma.document.upsert({
		where: { docId },
		update: { state, stateVector },
		create: { docId, workspaceId, state, stateVector },
	});
}

// ── POST /api/import/batch ───────────────────────────────────────────────────
async function handleBatchImport(req, res, prisma, persistenceAdapter) {
	if (!req.auth?.userId) { jsonResponse(res, 401, { error: 'Unauthorized' }); return; }

	let body = '';
	for await (const chunk of req) body += chunk;
	let payload;
	try { payload = JSON.parse(body); } catch { jsonResponse(res, 400, { error: 'Invalid JSON' }); return; }

	const workspaceId = String(payload.workspaceId ?? '').trim();
	const notes = Array.isArray(payload.notes) ? payload.notes : [];
	const labelNames = Array.isArray(payload.labelNames) ? payload.labelNames.map(String) : [];

	if (!workspaceId) { jsonResponse(res, 400, { error: 'workspaceId required' }); return; }
	if (notes.length > MAX_IMPORT_BATCH) {
		jsonResponse(res, 400, { error: `Too many notes (max ${MAX_IMPORT_BATCH})` });
		return;
	}

	console.log(`[import] batch request — user=${req.auth.userId} workspace=${workspaceId} notes=${notes.length} labels=${labelNames.length}`);

	const member = await findLiveWorkspaceMembership(prisma, req.auth.userId, workspaceId, { role: true });
	if (!member || !canEditWorkspaceContent(normalizeWorkspaceRole(member.role, 'VIEWER'))) {
		console.warn(`[import] 403 — user=${req.auth.userId} workspace=${workspaceId} member=${JSON.stringify(member)}`);
		jsonResponse(res, 403, { error: 'Forbidden' }); return;
	}
	console.log(`[import] membership ok — role=${member.role}`);

	// ── Create / find labels ─────────────────────────────────────────────────
	const labelIdsByName = {};
	const uniqueLabelNames = [...new Set(labelNames.map(normalizeName).filter(Boolean))];
	if (uniqueLabelNames.length > 0) {
		const labelsDocId = `${workspaceId}:${LABELS_REGISTRY_ID}`;
		const labelsDoc = await loadDoc(prisma, labelsDocId);
		const labelsArr = labelsDoc.getArray('labels');
		const existingByComparable = new Map(
			labelsArr.toArray().map((m) => [normalizeComparableName(String(m.get('name') ?? '')), String(m.get('id') ?? '')])
		);

		labelsDoc.transact(() => {
			for (const name of uniqueLabelNames) {
				const key = normalizeComparableName(name);
				if (existingByComparable.has(key)) {
					labelIdsByName[name] = existingByComparable.get(key);
				} else {
					const id = makeId();
					const row = new Y.Map();
					row.set('id', id);
					row.set('name', name);
					row.set('color', null);
					row.set('createdAt', new Date().toISOString());
					labelsArr.push([row]);
					existingByComparable.set(key, id);
					labelIdsByName[name] = id;
				}
			}
		});
		await saveDoc(prisma, labelsDocId, workspaceId, labelsDoc);
		if (persistenceAdapter) {
			const labelsState = Buffer.from(Y.encodeStateAsUpdate(labelsDoc));
			await persistenceAdapter.writeDocToCache(labelsDocId, workspaceId, labelsState);
		}
	}

	// ── Persist each note's Yjs state ────────────────────────────────────────
	const created = [];
	const errors = [];

	for (const note of notes) {
		try {
			const noteId = String(note.noteId ?? '').trim();
			const stateB64 = String(note.state ?? '').trim();
			if (!noteId || !stateB64) {
				console.warn(`[import] skipping note — missing noteId (${noteId}) or state (len=${stateB64.length})`);
				continue;
			}

			const stateBytes = Buffer.from(stateB64, 'base64');
			let stateVector = Buffer.alloc(0);
			try {
				const tmp = new Y.Doc();
				Y.applyUpdate(tmp, new Uint8Array(stateBytes));
				stateVector = Buffer.from(Y.encodeStateVector(tmp));
			} catch (yjsErr) {
				console.warn(`[import] stateVector computation failed for note=${noteId}:`, yjsErr?.message);
			}

			const docId = `${workspaceId}:${noteId}`;
			await prisma.document.upsert({
				where: { docId },
				update: { state: stateBytes, stateVector },
				create: { docId, workspaceId, state: stateBytes, stateVector },
			});
			created.push({ noteId, title: String(note.title ?? '').trim() });
		} catch (err) {
			console.error(`[import] note persist failed — noteId=${note.noteId}:`, err?.message);
			errors.push({ noteId: note.noteId, error: err.message });
		}
	}
	console.log(`[import] notes persisted: saved=${created.length} errors=${errors.length}`);

	// ── Update notes registry ────────────────────────────────────────────────
	if (created.length > 0) {
		const registryDocId = `${workspaceId}:${NOTES_REGISTRY_ID}`;
		const registryDoc = await loadDoc(prisma, registryDocId);
		const notesList = registryDoc.getArray('notesList');
		const noteOrder = registryDoc.getArray('noteOrder');
		const existingOrderSet = new Set(noteOrder.toArray().map(String));
		const existingListSet = new Set(notesList.toArray().map((m) => String(m.get('id') ?? '')));

		// Capture state vector BEFORE adding notes so we can compute a diff.
		// The diff is applied to the active in-memory Yjs room (if any) so
		// connected clients see the imported notes without reconnecting.
		const svBeforeUpdate = Y.encodeStateVector(registryDoc);

		registryDoc.transact(() => {
			for (const { noteId, title } of created) {
				if (!existingListSet.has(noteId)) {
					const m = new Y.Map();
					m.set('id', noteId);
					m.set('title', title);
					notesList.push([m]);
				}
			}
			// Prepend at position 0 so imported notes appear at the top.
			// Reverse so the first note in `created` ends up at index 0.
			const toInsert = created.map((c) => c.noteId).filter((id) => !existingOrderSet.has(id)).reverse();
			if (toInsert.length > 0) {
				noteOrder.insert(0, toInsert);
			}
		});

		// Apply the diff to the active in-memory room so connected clients
		// receive the new notes immediately via the Yjs WebSocket protocol.
		// If no room is active the direct DB write below is sufficient.
		if (persistenceAdapter) {
			const diff = Y.encodeStateAsUpdate(registryDoc, svBeforeUpdate);
			const appliedLive = persistenceAdapter.applyExternalUpdate(registryDocId, diff);
			if (appliedLive) {
				console.info(`[import-router] pushed registry diff to live room: ${registryDocId}`);
			}
		}

		try {
			await saveDoc(prisma, registryDocId, workspaceId, registryDoc);
			const savedOrderLen = registryDoc.getArray('noteOrder').length;
			const savedListLen = registryDoc.getArray('notesList').length;
			console.log(`[import] registry saved — docId=${registryDocId} noteOrder.length=${savedOrderLen} notesList.length=${savedListLen}`);
			// Keep Redis in sync so the next WS bindState serves fresh data instead
			// of a stale cache entry (saveDoc writes PostgreSQL only, bypassing the
			// normal persistence adapter path that also refreshes Redis).
			if (persistenceAdapter) {
				const registryState = Buffer.from(Y.encodeStateAsUpdate(registryDoc));
				await persistenceAdapter.writeDocToCache(registryDocId, workspaceId, registryState);
			}
		} catch (regErr) {
			console.error(`[import] registry save failed — docId=${registryDocId}:`, regErr?.message);
		}
	}

	jsonResponse(res, 200, {
		created: created.length,
		labelIdsByName,
		errors,
	});
}

// ── GET /api/workspaces/:workspaceId/export ──────────────────────────────────
async function handleWorkspaceExport(req, res, prisma, workspaceId) {
	if (!req.auth?.userId) { jsonResponse(res, 401, { error: 'Unauthorized' }); return; }

	const member = await findLiveWorkspaceMembership(prisma, req.auth.userId, workspaceId, { role: true });
	if (!member) { jsonResponse(res, 403, { error: 'Forbidden' }); return; }

	const registryDocId = `${workspaceId}:${NOTES_REGISTRY_ID}`;
	const registryDoc = await loadDoc(prisma, registryDocId);
	const noteIds = registryDoc.getArray('noteOrder').toArray().map(String).filter(Boolean);

	const files = [];
	for (const noteId of noteIds) {
		try {
			const docId = `${workspaceId}:${noteId}`;
			const doc = await loadDoc(prisma, docId);
			const meta = doc.getMap('metadata');
			if (meta.get('trashed') || meta.get('archived')) continue;

			const title = doc.getText('title').toString().trim() || 'Untitled';
			const type = String(meta.get('type') ?? 'text');

			if (type === 'text') {
				const bodyText = doc.getText('content').toString();
				files.push({ name: `${sanitizeFilename(title)}.md`, content: `# ${title}\n\n${bodyText}` });
			} else if (type === 'checklist') {
				const items = doc.getArray('checklist').toArray();
				const lines = [`# ${title}`, ''];
				for (const item of items) {
					const text = String(item.get('text') ?? '').trim();
					const done = Boolean(item.get('completed'));
					lines.push(`- [${done ? 'x' : ' '}] ${text}`);
				}
				files.push({ name: `${sanitizeFilename(title)}.md`, content: lines.join('\n') });
			} else if (type === 'drawing') {
				const elements = doc.getArray('elements').toArray().map((m) => {
					const obj = {};
					if (m && typeof m.forEach === 'function') m.forEach((v, k) => { obj[k] = v; });
					return obj;
				});
				const filesMap = {};
				doc.getMap('assets').forEach((v, k) => { filesMap[k] = v; });
				files.push({
					name: `${sanitizeFilename(title)}.excalidraw`,
					content: JSON.stringify({ type: 'excalidraw', version: 2, source: 'freemannotes', elements, appState: {}, files: filesMap }, null, 2),
				});
			}
		} catch { /* skip broken notes */ }
	}

	jsonResponse(res, 200, { files });
}

// ── Router factory (synchronous — returns true/false so the caller chain works) ──
function createImportRouter(prisma, persistenceAdapter) {
	return function handleImportRequest(req, res) {
		const url = new URL(req.url, 'http://localhost');
		const pathname = url.pathname;

		if (req.method === 'POST' && pathname === '/api/import/batch') {
			handleBatchImport(req, res, prisma, persistenceAdapter).catch((err) => errorResponse(res, err));
			return true;
		}

		const exportMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/export$/);
		if (req.method === 'GET' && exportMatch) {
			handleWorkspaceExport(req, res, prisma, exportMatch[1]).catch((err) => errorResponse(res, err));
			return true;
		}

		return false;
	};
}

module.exports = { createImportRouter };
