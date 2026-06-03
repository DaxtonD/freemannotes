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

const fs = require('fs');
const path = require('path');
const Y = require('yjs');
const { randomUUID } = require('crypto');
const { docs: liveDocs } = require('y-websocket/bin/utils');
const { createTimestampFormatter } = require('./timezone');
const { findLiveWorkspace, findLiveWorkspaceMembership } = require('./workspaceAccess');
const { normalizeWorkspaceRole, canEditWorkspaceContent } = require('./workspaceRoles');
const { ensureSharedWithMeWorkspace } = require('./systemWorkspaces');
const { getMoveDebugTrace, normalizeMoveDebugTraceId, recordMoveDebugTrace } = require('./moveDebugTrace');

const NOTES_REGISTRY_ID = '__notes_registry__';
const COLLECTIONS_REGISTRY_ID = '__collections_registry__';
const LABELS_REGISTRY_ID = '__labels_registry__';
const CARD_BANNERS_DIR = path.resolve(__dirname, '..', 'public', 'CardBanners', 'Dark');
const CUSTOM_EXCALIDRAW_LIBRARY_DIR = path.resolve(__dirname, '..', 'third-party', 'excalidraw-libraries');
const EXCALIDRAW_BUNDLED_LIBRARY_DEFINITIONS = Object.freeze([
	{
		id: 'electrical-engineering',
		name: 'Electrical Engineering',
		author: '@Ris Jain',
		description: 'Electrical and circuit symbols for diagrams and system sketches.',
		downloadUrl: 'https://excalidrawlibs.leantime.io/libraries/risjain/electrical-engineering.excalidrawlib',
	},
	{
		id: 'schematic-symbols',
		name: 'Schematic Symbols',
		author: '@rkjc',
		description: 'Common schematic symbols for quick technical drawings.',
		downloadUrl: 'https://excalidrawlibs.leantime.io/libraries/rkjc/schematic-symbols.excalidrawlib',
	},
	{
		id: 'architecture-diagram-components',
		name: 'Architecture Diagram Components',
		author: '@Anna Pastushko',
		description: 'Architecture diagram parts for software and infrastructure mapping.',
		downloadUrl: 'https://excalidrawlibs.leantime.io/libraries/anna-pastushko/architecture-diagram-components.excalidrawlib',
	},
	{
		id: 'stick-figures',
		name: 'Stick Figures',
		author: '@Youri Tjang',
		description: 'Expressive stick figures for flows, scenes, and storyboards.',
		downloadUrl: 'https://excalidrawlibs.leantime.io/libraries/youritjang/stick-figures.excalidrawlib',
	},
	{
		id: 'forms',
		name: 'Forms',
		author: '@NicolasGoudry @G.Script',
		description: 'Form controls and interface inputs for wireframes and UI flows.',
		downloadUrl: 'https://excalidrawlibs.leantime.io/libraries/g-script/forms.excalidrawlib',
	},
	{
		id: 'decision-flow-control',
		name: 'Decision Flow Control',
		author: '@James Wiens',
		description: 'Decision-flow shapes for process diagrams and branching logic.',
		downloadUrl: 'https://excalidrawlibs.leantime.io/libraries/aretecode/decision-flow-control.excalidrawlib',
	},
	{
		id: 'network-topology-icons',
		name: 'Network Topology Icons',
		author: '@dwelle',
		description: 'Network equipment and topology icons for infrastructure maps.',
		downloadUrl: 'https://excalidrawlibs.leantime.io/libraries/dwelle/network-topology-icons.excalidrawlib',
	},
	{
		id: 'basic-shapes',
		name: 'Basic Shapes',
		author: '@Pablo Gil Fernández',
		description: 'Reusable geometric shapes beyond the default toolset.',
		downloadUrl: 'https://excalidrawlibs.leantime.io/libraries/pgilfernandez/basic-shapes.excalidrawlib',
	},
	{
		id: 'architecture-floor-plan-symbols',
		name: 'Architecture Floor Plan Symbols',
		author: '@Arqtangeles',
		description: 'Floor plan symbols for architectural layouts and room planning.',
		downloadUrl: 'https://excalidrawlibs.leantime.io/libraries/Arqtangeles/architecture.excalidrawlib',
	},
]);

function slugifyLibraryId(value) {
	const normalized = String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return normalized || 'library';
}

function titleCaseLibraryName(value) {
	return String(value ?? '')
		.trim()
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function normalizeBannerDisplayName(fileName) {
	const normalized = String(fileName ?? '').trim().replace(/W(?=\.[^.]+$)/, '');
	const match = normalized.match(/^(.*?)(\.[^.]+)?$/);
	const stem = String(match?.[1] || '').trim();
	const ext = String(match?.[2] || '').toLowerCase();
	if (!stem) return normalized;
	return `${stem.charAt(0).toUpperCase()}${stem.slice(1).toLowerCase()}${ext}`;
}

function readCardBannerDefinitions() {
	if (!fs.existsSync(CARD_BANNERS_DIR)) {
		return [];
	}
	return fs.readdirSync(CARD_BANNERS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.(svg|png|jpe?g|webp|avif)$/i.test(entry.name) && !/W\.[^.]+$/i.test(entry.name))
		.map((entry) => ({
			fileName: entry.name,
			label: normalizeBannerDisplayName(entry.name),
			url: `/CardBanners/Dark/${encodeURIComponent(entry.name)}`,
		}))
		.sort((left, right) => left.label.localeCompare(right.label));
}

function readCustomExcalidrawLibraryMetadata(metadataPath) {
	try {
		if (!fs.existsSync(metadataPath)) {
			return null;
		}
		const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return null;
		}
		return parsed;
	} catch (error) {
		console.warn('[api] Invalid custom Excalidraw library metadata:', metadataPath, error.message);
		return null;
	}
}

function readCustomExcalidrawLibraryDefinitions() {
	if (!fs.existsSync(CUSTOM_EXCALIDRAW_LIBRARY_DIR)) {
		return [];
	}

	return fs.readdirSync(CUSTOM_EXCALIDRAW_LIBRARY_DIR, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.excalidrawlib'))
		.map((entry) => {
			const baseName = entry.name.slice(0, -'.excalidrawlib'.length);
			const metadataPath = path.join(CUSTOM_EXCALIDRAW_LIBRARY_DIR, `${baseName}.json`);
			const metadata = readCustomExcalidrawLibraryMetadata(metadataPath);
			return {
				id: `custom-${slugifyLibraryId(baseName)}`,
				name: typeof metadata?.name === 'string' && metadata.name.trim() ? metadata.name.trim() : titleCaseLibraryName(baseName),
				author: typeof metadata?.author === 'string' && metadata.author.trim() ? metadata.author.trim() : 'Local library',
				description: typeof metadata?.description === 'string' && metadata.description.trim()
					? metadata.description.trim()
					: 'Custom Excalidraw library loaded from third-party/excalidraw-libraries.',
				filePath: path.join(CUSTOM_EXCALIDRAW_LIBRARY_DIR, entry.name),
				source: 'custom',
			};
		});
}

function getExcalidrawLibraryDefinitions() {
	return [
		...EXCALIDRAW_BUNDLED_LIBRARY_DEFINITIONS,
		...readCustomExcalidrawLibraryDefinitions(),
	];
}

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

	function nowIso() {
		return new Date().toISOString();
	}

	function normalizeId(value) {
		return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
	}

	function normalizeOptionalId(value) {
		const normalized = normalizeId(value);
		return normalized.length > 0 ? normalized : null;
	}

	function normalizeName(value) {
		return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
	}

	function normalizeComparableName(value) {
		return normalizeName(value).toLocaleLowerCase();
	}

	function normalizeLabelIds(value) {
		if (!Array.isArray(value)) return [];
		const seen = new Set();
		const output = [];
		for (const entry of value) {
			const normalized = normalizeId(entry);
			if (!normalized || seen.has(normalized)) continue;
			seen.add(normalized);
			output.push(normalized);
		}
		return output;
	}

	function makeGeneratedId(prefix) {
		if (typeof randomUUID === 'function') return randomUUID();
		return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}

	function ensureRegistryStructure(doc) {
		doc.getArray('notesList');
		doc.getArray('noteOrder');
	}

	function ensureCollectionRegistryStructure(doc) {
		doc.getArray('collections');
	}

	function ensureLabelRegistryStructure(doc) {
		doc.getArray('labels');
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
		return loadWorkspaceDocRow(tx, workspaceId, NOTES_REGISTRY_ID, ensureRegistryStructure);
	}

	async function loadCollectionRegistryRow(tx, workspaceId) {
		return loadWorkspaceDocRow(tx, workspaceId, COLLECTIONS_REGISTRY_ID, ensureCollectionRegistryStructure);
	}

	async function loadLabelRegistryRow(tx, workspaceId) {
		return loadWorkspaceDocRow(tx, workspaceId, LABELS_REGISTRY_ID, ensureLabelRegistryStructure);
	}

	async function loadWorkspaceDocRow(tx, workspaceId, rawDocId, initializeDoc) {
		const docId = makeRoomDocId(workspaceId, rawDocId);
		const row = await tx.document.findUnique({
			where: { docId },
			select: { id: true, state: true },
		});
		const doc = new Y.Doc();
		initializeDoc(doc);
		const liveDoc = liveDocs.get(docId) || null;
		if (liveDoc) {
			// Moves need the freshest registry state so label/collection ids can be
			// remapped against rows created moments earlier in the live Yjs session.
			Y.applyUpdate(doc, Y.encodeStateAsUpdate(liveDoc));
		} else if (row?.state && row.state.length > 0) {
			Y.applyUpdate(doc, new Uint8Array(row.state));
		}
		return { docId, row, doc };
	}

	async function saveRegistryRow(tx, workspaceId, registry) {
		return saveWorkspaceDocRow(tx, workspaceId, registry);
	}

	async function saveWorkspaceDocRow(tx, workspaceId, registry) {
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

	function workspaceRoleToNoteShareRole(role) {
		return canEditWorkspaceContent(normalizeWorkspaceRole(role, 'VIEWER')) ? 'EDITOR' : 'VIEWER';
	}

	function readMoveMetadata(doc) {
		const metadata = doc.getMap('metadata');
		return {
			collectionId: normalizeOptionalId(metadata.get('collectionId')),
			labelIds: normalizeLabelIds(metadata.get('labelIds')),
		};
	}

	function readCollectionsFromRegistryDoc(doc) {
		return doc.getArray('collections').toArray().map((row) => {
			const id = normalizeId(row.get('id'));
			const name = normalizeName(row.get('name'));
			if (!id || !name) return null;
			return {
				id,
				name,
				parentId: normalizeOptionalId(row.get('parentId')),
			};
		}).filter(Boolean);
	}

	function readLabelsFromRegistryDoc(doc) {
		return doc.getArray('labels').toArray().map((row) => {
			const id = normalizeId(row.get('id'));
			const name = normalizeName(row.get('name'));
			if (!id || !name) return null;
			return {
				id,
				name,
				color: typeof row.get('color') === 'string' ? String(row.get('color')).trim() || null : null,
			};
		}).filter(Boolean);
	}

	function normalizeMoveIdPairs(value) {
		if (!Array.isArray(value)) return [];
		return value.map((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			const sourceId = normalizeId(entry.sourceId);
			const targetId = normalizeId(entry.targetId);
			if (!sourceId || !targetId) return null;
			return { sourceId, targetId };
		}).filter(Boolean);
	}

	function normalizeClientMoveMetadata(value) {
		if (!value || typeof value !== 'object') return null;
		const collectionId = normalizeOptionalId(value.collectionId);
		const labelIds = normalizeLabelIds(value.labelIds);
		const collectionIdPairs = normalizeMoveIdPairs(value.collectionIdPairs);
		const labelIdPairs = normalizeMoveIdPairs(value.labelIdPairs);
		if (!collectionId && labelIds.length === 0 && collectionIdPairs.length === 0 && labelIdPairs.length === 0) {
			return null;
		}
		return {
			collectionId,
			labelIds,
			collectionIdPairs,
			labelIdPairs,
		};
	}

	function createCollectionInRegistryDoc(doc, { id = null, name, parentId = null }) {
		const normalizedName = normalizeName(name);
		if (!normalizedName) return null;
		const normalizedParentId = normalizeOptionalId(parentId);
		const existing = readCollectionsFromRegistryDoc(doc).find((collection) => (
			collection.parentId === normalizedParentId && normalizeComparableName(collection.name) === normalizeComparableName(normalizedName)
		)) || null;
		if (existing) return existing;
		const createdAt = nowIso();
		const row = new Y.Map();
		const collection = {
			id: normalizeOptionalId(id) || makeGeneratedId('collection'),
			name: normalizedName,
			parentId: normalizedParentId,
		};
		row.set('id', collection.id);
		row.set('name', collection.name);
		row.set('parentId', collection.parentId);
		row.set('createdAt', createdAt);
		row.set('updatedAt', createdAt);
		doc.transact(() => {
			doc.getArray('collections').push([row]);
		});
		return collection;
	}

	function createLabelInRegistryDoc(doc, { id = null, name, color = null }) {
		const normalizedName = normalizeName(name);
		if (!normalizedName) return null;
		const existing = readLabelsFromRegistryDoc(doc).find((label) => normalizeComparableName(label.name) === normalizeComparableName(normalizedName)) || null;
		if (existing) return existing;
		const row = new Y.Map();
		const label = {
			id: normalizeOptionalId(id) || makeGeneratedId('label'),
			name: normalizedName,
			color: typeof color === 'string' && color.trim() ? color.trim() : null,
		};
		row.set('id', label.id);
		row.set('name', label.name);
		row.set('color', label.color);
		row.set('createdAt', nowIso());
		doc.transact(() => {
			doc.getArray('labels').push([row]);
		});
		return label;
	}

	function ensureTargetCollectionIdForMove(sourceCollectionId, sourceCollectionsDoc, targetCollectionsDoc, preferredTargetIdsBySourceId = new Map()) {
		const normalizedSourceId = normalizeOptionalId(sourceCollectionId);
		if (!normalizedSourceId) return null;
		const sourceCollections = readCollectionsFromRegistryDoc(sourceCollectionsDoc);
		const sourceById = new Map(sourceCollections.map((collection) => [collection.id, collection]));
		const sourceChain = [];
		const seen = new Set();
		let cursor = sourceById.get(normalizedSourceId) || null;
		while (cursor && !seen.has(cursor.id)) {
			seen.add(cursor.id);
			sourceChain.unshift(cursor);
			cursor = cursor.parentId ? sourceById.get(cursor.parentId) || null : null;
		}
		if (sourceChain.length === 0) return null;
		let targetParentId = null;
		for (const sourceCollection of sourceChain) {
			let targetCollection = readCollectionsFromRegistryDoc(targetCollectionsDoc).find((collection) => (
				collection.parentId === targetParentId && normalizeComparableName(collection.name) === normalizeComparableName(sourceCollection.name)
			)) || null;
			if (!targetCollection) {
				targetCollection = createCollectionInRegistryDoc(targetCollectionsDoc, {
					id: preferredTargetIdsBySourceId.get(sourceCollection.id) || null,
					name: sourceCollection.name,
					parentId: targetParentId,
				});
			}
			if (!targetCollection) return targetParentId;
			targetParentId = targetCollection.id;
		}
		return targetParentId;
	}

	function ensureTargetLabelIdsForMove(sourceLabelIds, sourceLabelsDoc, targetLabelsDoc, preferredTargetIdsBySourceId = new Map()) {
		const sourceIds = normalizeLabelIds(sourceLabelIds);
		if (sourceIds.length === 0) return [];
		const sourceById = new Map(readLabelsFromRegistryDoc(sourceLabelsDoc).map((label) => [label.id, label]));
		const targetByName = new Map(readLabelsFromRegistryDoc(targetLabelsDoc).map((label) => [normalizeComparableName(label.name), label]));
		const nextLabelIds = [];
		for (const sourceLabelId of sourceIds) {
			const sourceLabel = sourceById.get(sourceLabelId) || null;
			if (!sourceLabel) continue;
			const comparableName = normalizeComparableName(sourceLabel.name);
			let targetLabel = targetByName.get(comparableName) || null;
			if (!targetLabel) {
				targetLabel = createLabelInRegistryDoc(targetLabelsDoc, {
					id: preferredTargetIdsBySourceId.get(sourceLabel.id) || null,
					name: sourceLabel.name,
					color: sourceLabel.color,
				});
				if (targetLabel) {
					targetByName.set(comparableName, targetLabel);
				}
			}
			if (targetLabel && !nextLabelIds.includes(targetLabel.id)) {
				nextLabelIds.push(targetLabel.id);
			}
		}
		return nextLabelIds;
	}

	async function remapMoveNoteStateForWorkspaceMove(tx, sourceWorkspaceId, targetWorkspaceId, noteState, clientMetadataMapping = null) {
		const moveDoc = new Y.Doc();
		Y.applyUpdate(moveDoc, new Uint8Array(noteState));
		const sourceMetadata = readMoveMetadata(moveDoc);
		const preferredCollectionIdsBySourceId = new Map((clientMetadataMapping?.collectionIdPairs || []).map((entry) => [entry.sourceId, entry.targetId]));
		const preferredLabelIdsBySourceId = new Map((clientMetadataMapping?.labelIdPairs || []).map((entry) => [entry.sourceId, entry.targetId]));
		let targetCollectionRegistry = null;
		let targetLabelRegistry = null;
		let mappedCollectionId = null;
		let mappedLabelIds = [];

		if (sourceMetadata.collectionId) {
			const [sourceCollectionRegistry, nextTargetCollectionRegistry] = await Promise.all([
				loadCollectionRegistryRow(tx, sourceWorkspaceId),
				loadCollectionRegistryRow(tx, targetWorkspaceId),
			]);
			targetCollectionRegistry = nextTargetCollectionRegistry;
			mappedCollectionId = ensureTargetCollectionIdForMove(
				sourceMetadata.collectionId,
				sourceCollectionRegistry.doc,
				targetCollectionRegistry.doc,
				preferredCollectionIdsBySourceId,
			);
		}

		if (sourceMetadata.labelIds.length > 0) {
			const [sourceLabelRegistry, nextTargetLabelRegistry] = await Promise.all([
				loadLabelRegistryRow(tx, sourceWorkspaceId),
				loadLabelRegistryRow(tx, targetWorkspaceId),
			]);
			targetLabelRegistry = nextTargetLabelRegistry;
			mappedLabelIds = ensureTargetLabelIdsForMove(
				sourceMetadata.labelIds,
				sourceLabelRegistry.doc,
				targetLabelRegistry.doc,
				preferredLabelIdsBySourceId,
			);
		}

		moveDoc.transact(() => {
			const metadata = moveDoc.getMap('metadata');
			metadata.set('collectionId', mappedCollectionId);
			metadata.set('labelIds', mappedLabelIds);
			metadata.set('updatedAt', Date.now());
		});

		const result = {
			noteStateBuffer: Buffer.from(Y.encodeStateAsUpdate(moveDoc)),
			noteStateVector: Buffer.from(Y.encodeStateVector(moveDoc)),
			targetCollectionRegistry,
			targetLabelRegistry,
			targetCollectionRegistryState: targetCollectionRegistry ? Buffer.from(Y.encodeStateAsUpdate(targetCollectionRegistry.doc)) : null,
			targetLabelRegistryState: targetLabelRegistry ? Buffer.from(Y.encodeStateAsUpdate(targetLabelRegistry.doc)) : null,
		};
		moveDoc.destroy();
		return result;
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

		async function requireWorkspaceMember() {
			const workspaceId = requireAuthWorkspace();
			if (!workspaceId) return null;
			const member = await findLiveWorkspaceMembership(prisma, req.auth.userId, workspaceId, { role: true });
			if (!member) {
				jsonResponse(res, 403, { error: 'Forbidden' });
				return null;
			}
			return { workspaceId, member };
		}

		function requireAuthUserId() {
			if (!req.auth || !req.auth.userId) {
				jsonResponse(res, 401, { error: 'Not authenticated' });
				return null;
			}
			return String(req.auth.userId);
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

		if (pathname === '/api/debug/move-trace' && method === 'GET') {
			if (!req.auth || !req.auth.userId) {
				jsonResponse(res, 401, { error: 'Not authenticated' });
				return true;
			}
			const traceId = normalizeMoveDebugTraceId(url.searchParams.get('traceId'));
			if (!traceId) {
				jsonResponse(res, 400, { error: 'traceId is required' });
				return true;
			}
			const trace = getMoveDebugTrace(traceId);
			if (!trace) {
				jsonResponse(res, 404, { error: 'Trace not found', traceId });
				return true;
			}
			jsonResponse(res, 200, trace);
			return true;
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

		if (pathname === '/api/collaborators/history' && method === 'GET') {
			(async () => {
				try {
					const userId = requireAuthUserId();
					if (!userId) return;
					const currentUser = await prisma.user.findUnique({
						where: { id: userId },
						select: { email: true },
					});

					const [workspaceMembers, noteCollaborators, acceptedInvitations, sentAcceptedWorkspaceInvites, receivedAcceptedWorkspaceInvites] = await Promise.all([
						prisma.workspaceMember.findMany({
							where: {
								userId: { not: userId },
								workspace: {
									is: {
										deletedAt: null,
										members: { some: { userId } },
									},
								},
								user: { disabled: false },
							},
							include: {
								user: { select: { id: true, email: true, name: true, profileImage: true, disabled: true } },
							},
						}),
						prisma.noteCollaborator.findMany({
							where: {
								userId: { not: userId },
								sourceWorkspace: {
									is: {
										deletedAt: null,
										members: { some: { userId } },
									},
								},
								user: { disabled: false },
							},
							include: {
								user: { select: { id: true, email: true, name: true, profileImage: true, disabled: true } },
							},
						}),
						prisma.noteShareInvitation.findMany({
							where: {
								status: 'ACCEPTED',
								OR: [
									{ inviterUserId: userId },
									{ inviteeUserId: userId },
								],
							},
							include: {
								inviter: { select: { id: true, email: true, name: true, profileImage: true, disabled: true } },
								invitee: { select: { id: true, email: true, name: true, profileImage: true, disabled: true } },
							},
						}),
						prisma.inviteToken.findMany({
							where: {
								createdByUserId: userId,
								used: true,
							},
							select: { email: true },
						}),
						currentUser?.email
							? prisma.inviteToken.findMany({
								where: {
									email: currentUser.email,
									used: true,
									creator: { isNot: null },
								},
								include: {
									creator: { select: { id: true, email: true, name: true, profileImage: true, disabled: true } },
								},
							})
							: Promise.resolve([]),
					]);

					const sentAcceptedInviteEmails = Array.from(new Set(
						sentAcceptedWorkspaceInvites
							.map((invite) => normalizeOptionalId(invite.email)?.toLowerCase() ?? null)
							.filter(Boolean)
					));
					const sentAcceptedWorkspaceUsers = sentAcceptedInviteEmails.length > 0
						? await prisma.user.findMany({
							where: {
								email: { in: sentAcceptedInviteEmails },
								disabled: false,
							},
							select: { id: true, email: true, name: true, profileImage: true, disabled: true },
						})
						: [];

					const usersByKey = new Map();
					const pushUser = (user) => {
						if (!user || user.disabled) return;
						const id = normalizeOptionalId(user.id);
						const email = normalizeOptionalId(user.email)?.toLowerCase() ?? null;
						const name = normalizeOptionalId(user.name);
						const profileImage = normalizeOptionalId(user.profileImage);
						if (id === userId) return;
						const key = id || email;
						if (!key) return;
						const previous = usersByKey.get(key);
						usersByKey.set(key, {
							id: id ?? previous?.id ?? null,
							email: email ?? previous?.email ?? null,
							name: name ?? previous?.name ?? null,
							profileImage: profileImage ?? previous?.profileImage ?? null,
						});
					};

					for (const row of workspaceMembers) pushUser(row.user);
					for (const row of noteCollaborators) pushUser(row.user);
					for (const invitation of acceptedInvitations) {
						pushUser(String(invitation.inviterUserId || '') === userId ? invitation.invitee : invitation.inviter);
					}
					for (const user of sentAcceptedWorkspaceUsers) pushUser(user);
					for (const invite of receivedAcceptedWorkspaceInvites) pushUser(invite.creator);

					const users = Array.from(usersByKey.values())
						.filter((user) => Boolean(user.id || user.email || user.name))
						.sort((left, right) => {
							const leftLabel = normalizeComparableName(left.name || left.email || left.id || '');
							const rightLabel = normalizeComparableName(right.name || right.email || right.id || '');
							if (leftLabel !== rightLabel) return leftLabel.localeCompare(rightLabel);
							return normalizeComparableName(left.email || '').localeCompare(normalizeComparableName(right.email || ''));
						});

					jsonResponse(res, 200, { users });
				} catch (err) {
					console.error('[api] collaborator history error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
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

		if (pathname === '/api/excalidraw-libraries' && method === 'GET') {
			(async () => {
				try {
					const access = await requireWorkspaceMember();
					if (!access) return;
					const libraries = getExcalidrawLibraryDefinitions();
					jsonResponse(res, 200, {
						libraries: libraries.map(({ downloadUrl, filePath, source, ...library }) => library),
					});
				} catch (err) {
					console.error('[api] GET /api/excalidraw-libraries error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		if (pathname === '/api/card-banners' && method === 'GET') {
			(async () => {
				try {
					const access = await requireWorkspaceMember();
					if (!access) return;
					jsonResponse(res, 200, {
						banners: readCardBannerDefinitions(),
					});
				} catch (err) {
					console.error('[api] GET /api/card-banners error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		const excalidrawLibraryMatch = pathname.match(/^\/api\/excalidraw-libraries\/([^/]+)$/);
		if (excalidrawLibraryMatch && method === 'GET') {
			const libraryId = decodeURIComponent(excalidrawLibraryMatch[1]);
			(async () => {
				try {
					const access = await requireWorkspaceMember();
					if (!access) return;
					const library = getExcalidrawLibraryDefinitions().find((entry) => entry.id === libraryId);
					if (!library) {
						jsonResponse(res, 404, { error: 'Drawing library not found' });
						return;
					}
					let payload;
					if (library.filePath) {
						payload = fs.readFileSync(library.filePath);
					} else {
						const response = await fetch(library.downloadUrl, { redirect: 'follow' });
						if (!response.ok) {
							jsonResponse(res, 502, { error: 'Failed to download drawing library' });
							return;
						}
						payload = Buffer.from(await response.arrayBuffer());
					}
					res.writeHead(200, {
						'Content-Type': 'application/vnd.excalidrawlib+json',
						'Cache-Control': 'no-store',
						'Content-Disposition': `inline; filename="${library.id}.excalidrawlib"`,
					});
					res.end(payload);
				} catch (err) {
					console.error('[api] GET /api/excalidraw-libraries/:id error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
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
					const debugTraceId = normalizeMoveDebugTraceId(body?.debugTraceId);
					req.moveDebugTraceId = debugTraceId;
					const clientMetadataMapping = normalizeClientMoveMetadata(body?.metadataMapping);
					const sessionWorkspaceId = getSessionWorkspaceId();
					const sourceWorkspaceId = typeof body?.sourceWorkspaceId === 'string' && body.sourceWorkspaceId.trim()
						? body.sourceWorkspaceId.trim()
						: sessionWorkspaceId;
					const targetWorkspaceId = typeof body?.targetWorkspaceId === 'string' ? body.targetWorkspaceId.trim() : '';
					recordMoveDebugTrace(debugTraceId, 'move-request', {
						userId: String(req.auth.userId || ''),
						sessionWorkspaceId,
						sourceWorkspaceId,
						targetWorkspaceId,
					});
					if (!sourceWorkspaceId) {
						recordMoveDebugTrace(debugTraceId, 'move-rejected', { reason: 'missing-source-workspace-id' });
						jsonResponse(res, 400, { error: 'sourceWorkspaceId is required' });
						return;
					}
					if (!targetWorkspaceId) {
						recordMoveDebugTrace(debugTraceId, 'move-rejected', { reason: 'missing-target-workspace-id' });
						jsonResponse(res, 400, { error: 'targetWorkspaceId is required' });
						return;
					}
					if (targetWorkspaceId === sourceWorkspaceId) {
						recordMoveDebugTrace(debugTraceId, 'move-rejected', { reason: 'same-workspace' });
						jsonResponse(res, 400, { error: 'Note is already in that workspace' });
						return;
					}

					const noteId = decodeURIComponent(moveNoteMatch[1]).trim();
					if (!noteId) {
						recordMoveDebugTrace(debugTraceId, 'move-rejected', { reason: 'missing-note-id' });
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
					recordMoveDebugTrace(debugTraceId, 'move-preflight', {
						noteId,
						sourceMembershipRole: sourceMembership ? String(sourceMembership.role || '') : null,
						targetMembershipRole: targetMembership ? String(targetMembership.role || '') : null,
						targetWorkspaceFound: Boolean(targetWorkspace),
						targetWorkspaceSystemKind: targetWorkspace ? targetWorkspace.systemKind ?? null : null,
						sourceRowFound: Boolean(sourceRow),
					});
					if (!sourceMembership || !canEditWorkspaceContent(sourceMembership.role)) {
						recordMoveDebugTrace(debugTraceId, 'move-rejected', { reason: 'missing-source-edit-access', noteId });
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}
					if (!targetWorkspace) {
						recordMoveDebugTrace(debugTraceId, 'move-rejected', { reason: 'target-workspace-missing', noteId });
						jsonResponse(res, 404, { error: 'Target workspace not found' });
						return;
					}
					if (targetWorkspace.systemKind === 'SHARED_WITH_ME') {
						recordMoveDebugTrace(debugTraceId, 'move-rejected', { reason: 'target-workspace-shared-with-me', noteId });
						jsonResponse(res, 400, { error: 'Notes cannot be moved into Shared With Me' });
						return;
					}
					if (!targetMembership || !canEditWorkspaceContent(targetMembership.role)) {
						recordMoveDebugTrace(debugTraceId, 'move-rejected', { reason: 'missing-target-edit-access', noteId });
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}
					if (!sourceRow) {
						recordMoveDebugTrace(debugTraceId, 'move-rejected', { reason: 'source-note-missing', noteId });
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

					const targetDocRow = await prisma.document.findUnique({
						where: { docId: targetDocId },
						select: { id: true },
					});
					let reusableTargetDocRow = null;
					let targetDocConflictState = null;
					if (targetDocRow) {
						// A previous move can fail after writing the target note row but before
						// the FK-bound child tables are repointed. Treat that shape as resumable
						// state instead of a hard conflict so the next move attempt can finish.
						const [
							targetShareAccessTokenCount,
							targetShareTokenCount,
							targetShareInvitationCount,
							targetCollaboratorCount,
							targetImageCount,
							targetLinkCount,
							targetDocumentCount,
						] = await Promise.all([
							prisma.shareAccessToken.count({
								where: {
									entityType: 'NOTE',
									entityId: targetDocId,
								},
							}),
							prisma.shareToken.count({ where: { docId: targetDocId } }),
							prisma.noteShareInvitation.count({
								where: {
									docId: targetDocId,
									revokedAt: null,
								},
							}),
							prisma.noteCollaborator.count({
								where: {
									docId: targetDocId,
									revokedAt: null,
								},
							}),
							prisma.noteImage.count({
								where: {
									docId: targetDocId,
									deletedAt: null,
								},
							}),
							prisma.noteLink.count({
								where: {
									docId: targetDocId,
									deletedAt: null,
								},
							}),
							prisma.noteDocument.count({
								where: {
									docId: targetDocId,
									deletedAt: null,
								},
							}),
						]);
						targetDocConflictState = {
							shareAccessTokenCount: targetShareAccessTokenCount,
							shareTokenCount: targetShareTokenCount,
							shareInvitationCount: targetShareInvitationCount,
							collaboratorCount: targetCollaboratorCount,
							imageCount: targetImageCount,
							linkCount: targetLinkCount,
							documentCount: targetDocumentCount,
						};
						if (
							targetShareAccessTokenCount === 0
							&& targetShareTokenCount === 0
							&& targetShareInvitationCount === 0
							&& targetCollaboratorCount === 0
							&& targetImageCount === 0
							&& targetLinkCount === 0
							&& targetDocumentCount === 0
						) {
							reusableTargetDocRow = targetDocRow;
						}
					}
					recordMoveDebugTrace(debugTraceId, 'move-doc-state', {
						noteId,
						sourceDocId,
						targetDocId,
						liveSourceDoc: Boolean(liveSourceDoc),
						targetDocExists: Boolean(targetDocRow),
						reusableTargetDoc: Boolean(reusableTargetDocRow),
						targetDocConflictState,
					});
					if (targetDocRow && !reusableTargetDocRow) {
						recordMoveDebugTrace(debugTraceId, 'move-conflict', {
							noteId,
							sourceDocId,
							targetDocId,
							reason: 'target-doc-exists',
							targetDocConflictState,
						});
						jsonResponse(res, 409, { error: 'A note with this id already exists in the target workspace' });
						return;
					}

					const [shareCollaborators, shareInvitations, sourceWorkspaceMembers] = await Promise.all([
						prisma.noteCollaborator.findMany({
							where: { docId: sourceDocId, revokedAt: null },
							select: { userId: true },
						}),
						prisma.noteShareInvitation.findMany({
							where: { docId: sourceDocId, revokedAt: null },
							select: { inviteeUserId: true, inviterUserId: true },
						}),
						prisma.workspaceMember.findMany({
							where: {
								workspaceId: sourceWorkspaceId,
								workspace: { is: { deletedAt: null } },
								user: { disabled: false },
							},
							select: {
								userId: true,
								role: true,
								user: {
									select: {
										id: true,
										email: true,
										name: true,
									},
								},
							},
						}),
					]);
					const existingCollaboratorUserIds = new Set(shareCollaborators.map((row) => String(row.userId || '')).filter(Boolean));
					const retainedWorkspaceCollaborators = sourceWorkspaceMembers
						.filter((member) => member.user && String(member.userId || '') !== String(req.auth.userId || ''))
						.filter((member) => !existingCollaboratorUserIds.has(String(member.userId || '')));
					const affectedShareUserIds = Array.from(new Set([
						req.auth && req.auth.userId ? String(req.auth.userId) : '',
						...shareCollaborators.map((row) => String(row.userId || '')),
						...shareInvitations.map((row) => String(row.inviteeUserId || '')),
						...shareInvitations.map((row) => String(row.inviterUserId || '')),
						...retainedWorkspaceCollaborators.map((row) => String(row.userId || '')),
					].filter(Boolean)));
					let targetCollectionRegistryState = null;
					let targetLabelRegistryState = null;

					// Extract drawing IDs from the note Yjs state so drawing sub-documents
					// can be migrated to the target workspace inside the transaction.
					const rawDrawingIds = [];
					if (noteState) {
						const drawingMigrationDoc = new Y.Doc();
						try {
							Y.applyUpdate(drawingMigrationDoc, new Uint8Array(noteState));
							rawDrawingIds.push(...drawingMigrationDoc.getArray('drawingIds').toArray()
								.filter((id) => typeof id === 'string' && String(id).trim() && !String(id).includes(':')));
						} finally {
							drawingMigrationDoc.destroy();
						}
					}
					const sourceDrawingDocIds = rawDrawingIds.map((drawingId) => `${sourceWorkspaceId}:${drawingId}`);
					const sourceDrawingRows = sourceDrawingDocIds.length > 0
						? await prisma.document.findMany({
							where: { docId: { in: sourceDrawingDocIds } },
							select: { id: true, docId: true, state: true, stateVector: true },
						})
						: [];
					const sourceDrawingRowsByDocId = new Map(sourceDrawingRows.map((row) => [row.docId, row]));
					const drawingMoveRows = rawDrawingIds.map((drawingId) => {
						const sourceDrawingDocId = `${sourceWorkspaceId}:${drawingId}`;
						const targetDrawingDocId = `${targetWorkspaceId}:${drawingId}`;
						const sourceDrawingRow = sourceDrawingRowsByDocId.get(sourceDrawingDocId) || null;
						const liveDrawingDoc = liveDocs.get(sourceDrawingDocId) || null;
						return {
							drawingId,
							sourceDrawingDocId,
							targetDrawingDocId,
							sourceRowId: sourceDrawingRow ? sourceDrawingRow.id : null,
							state: liveDrawingDoc
								? Buffer.from(Y.encodeStateAsUpdate(liveDrawingDoc))
								: sourceDrawingRow ? sourceDrawingRow.state : null,
							stateVector: liveDrawingDoc
								? Buffer.from(Y.encodeStateVector(liveDrawingDoc))
								: sourceDrawingRow ? sourceDrawingRow.stateVector : null,
						};
					}).filter((row) => row.state && row.stateVector);
					recordMoveDebugTrace(debugTraceId, 'move-related-state', {
						noteId,
						drawingCount: rawDrawingIds.length,
						drawingDocRowCount: drawingMoveRows.length,
						shareCollaboratorCount: shareCollaborators.length,
						shareInvitationCount: shareInvitations.length,
						sourceWorkspaceMemberCount: sourceWorkspaceMembers.length,
						retainedWorkspaceCollaboratorCount: retainedWorkspaceCollaborators.length,
						affectedShareUserCount: affectedShareUserIds.length,
					});

					// Pre-compute Shared With Me workspaces for retained collaborators
					// before the transaction to avoid extra round-trips inside the
					// interactive transaction and isolate any creation errors.
					const sharedWithMeByInviteeId = new Map();
					for (const member of retainedWorkspaceCollaborators) {
						const inviteeUserId = String(member.userId || '').trim();
						if (!inviteeUserId) continue;
						try {
							const swm = await ensureSharedWithMeWorkspace(prisma, inviteeUserId);
							sharedWithMeByInviteeId.set(inviteeUserId, swm);
						} catch (swmErr) {
							console.warn('[api] ensureSharedWithMeWorkspace failed for', inviteeUserId, swmErr.message);
							sharedWithMeByInviteeId.set(inviteeUserId, null);
						}
					}

					await prisma.$transaction(async (tx) => {
						const remappedMoveState = await remapMoveNoteStateForWorkspaceMove(tx, sourceWorkspaceId, targetWorkspaceId, noteState, clientMetadataMapping);
						const sourceRegistry = await loadRegistryRow(tx, sourceWorkspaceId);
						const targetRegistry = await loadRegistryRow(tx, targetWorkspaceId);

						removeNoteFromRegistryDoc(sourceRegistry.doc, noteId);
						addNoteToRegistryDoc(targetRegistry.doc, noteId, noteTitle);
						targetCollectionRegistryState = remappedMoveState.targetCollectionRegistryState;
						targetLabelRegistryState = remappedMoveState.targetLabelRegistryState;

						// Keep foreign keys valid throughout the move: the target note and drawing
						// rows must exist before any collaborator/share/media rows can point at
						// the new docIds.
						if (reusableTargetDocRow) {
							await tx.document.update({
								where: { id: reusableTargetDocRow.id },
								data: {
									workspaceId: targetWorkspaceId,
									state: remappedMoveState.noteStateBuffer,
									stateVector: remappedMoveState.noteStateVector,
								},
							});
						} else {
							await tx.document.create({
								data: {
									workspaceId: targetWorkspaceId,
									docId: targetDocId,
									state: remappedMoveState.noteStateBuffer,
									stateVector: remappedMoveState.noteStateVector,
								},
							});
						}
						for (const drawingRow of drawingMoveRows) {
							await tx.document.create({
								data: {
									workspaceId: targetWorkspaceId,
									docId: drawingRow.targetDrawingDocId,
									state: drawingRow.state,
									stateVector: drawingRow.stateVector,
								},
							});
						}

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

						// Migrate drawing sub-documents that belong to this note.
						// Drawings are stored as separate document rows with docId
						// = sourceWorkspaceId:drawingId. After a note move the client
						// constructs drawingDocId using the parent note's new workspace
						// prefix, so the drawing rows must be updated to match.
						for (const drawingRow of drawingMoveRows) {
							await tx.noteCollaborator.updateMany({
								where: { docId: drawingRow.sourceDrawingDocId },
								data: { docId: drawingRow.targetDrawingDocId, sourceWorkspaceId: targetWorkspaceId },
							});
						}

						for (const member of retainedWorkspaceCollaborators) {
							const inviteeUserId = String(member.userId || '').trim();
							const inviteeEmail = String(member.user?.email || '').trim();
							if (!inviteeUserId || !inviteeEmail) continue;
							const invitation = await tx.noteShareInvitation.create({
								data: {
									docId: targetDocId,
									sourceWorkspaceId: targetWorkspaceId,
									sourceNoteId: noteId,
									inviterUserId: req.auth.userId,
									inviteeUserId,
									inviteeEmail,
									inviteeName: member.user?.name || null,
									role: workspaceRoleToNoteShareRole(member.role),
									status: 'ACCEPTED',
									respondedAt: new Date(),
								},
							});
							const collaborator = await tx.noteCollaborator.create({
								data: {
									docId: targetDocId,
									sourceWorkspaceId: targetWorkspaceId,
									sourceNoteId: noteId,
									userId: inviteeUserId,
									invitationId: invitation.id,
									role: invitation.role,
								},
							});
							// Place the shared note into the invitee's Shared With Me workspace
							// so it appears in the correct location in their account. Using the
							// source workspace here would point them to a workspace that no
							// longer contains the note.
							const inviteeSharedWithMeWorkspace = sharedWithMeByInviteeId.get(inviteeUserId) ?? null;
							await tx.noteSharePlacement.create({
								data: {
									userId: inviteeUserId,
									invitationId: invitation.id,
									collaboratorId: collaborator.id,
									targetWorkspaceId: inviteeSharedWithMeWorkspace ? String(inviteeSharedWithMeWorkspace.id) : targetWorkspaceId,
									folderName: null,
									collectionId: null,
									labelIds: [],
								},
							});
						}

						await saveRegistryRow(tx, sourceWorkspaceId, sourceRegistry);
						await saveRegistryRow(tx, targetWorkspaceId, targetRegistry);
						if (remappedMoveState.targetCollectionRegistry) {
							await saveWorkspaceDocRow(tx, targetWorkspaceId, remappedMoveState.targetCollectionRegistry);
						}
						if (remappedMoveState.targetLabelRegistry) {
							await saveWorkspaceDocRow(tx, targetWorkspaceId, remappedMoveState.targetLabelRegistry);
						}
						await tx.document.delete({ where: { id: sourceRow.id } });
						const sourceDrawingRowIds = drawingMoveRows.map((row) => row.sourceRowId).filter(Boolean);
						if (sourceDrawingRowIds.length > 0) {
							await tx.document.deleteMany({
								where: { id: { in: sourceDrawingRowIds } },
							});
						}
					});

					updateLiveRegistryDoc(makeRoomDocId(sourceWorkspaceId, NOTES_REGISTRY_ID), (doc) => removeNoteFromRegistryDoc(doc, noteId));
					updateLiveRegistryDoc(makeRoomDocId(targetWorkspaceId, NOTES_REGISTRY_ID), (doc) => addNoteToRegistryDoc(doc, noteId, noteTitle));
					if (targetCollectionRegistryState) {
						// Do not merge a full saved registry snapshot back into an already-live
						// room here. If the room history diverged during prior optimistic moves,
						// replaying the whole document can duplicate logically identical
						// collection rows. Force the room to reconnect from the persisted state.
						closeLiveRoom(makeRoomDocId(targetWorkspaceId, COLLECTIONS_REGISTRY_ID));
					}
					if (targetLabelRegistryState) {
						// Same rationale as collections above: reconnect the live labels room so
						// clients reload the canonical saved registry state instead of merging a
						// potentially divergent full-document update.
						closeLiveRoom(makeRoomDocId(targetWorkspaceId, LABELS_REGISTRY_ID));
					}
					closeLiveRoom(sourceDocId);
					// Close live rooms for all drawing sub-documents so connected clients
					// reconnect using the new docId (targetWorkspaceId:drawingId).
					for (const drawingId of rawDrawingIds) {
						closeLiveRoom(`${sourceWorkspaceId}:${drawingId}`);
					}

					jsonResponse(res, 200, {
						noteId,
						sourceWorkspaceId,
						targetWorkspaceId,
						docId: targetDocId,
					});
					recordMoveDebugTrace(debugTraceId, 'move-success', {
						noteId,
						sourceDocId,
						targetDocId,
						drawingCount: rawDrawingIds.length,
						retainedWorkspaceCollaboratorCount: retainedWorkspaceCollaborators.length,
					});

					if (typeof onWorkspaceMetadataChanged === 'function' && affectedShareUserIds.length > 0) {
						try {
							await onWorkspaceMetadataChanged({
								reason: 'note-share-moved',
								workspaceId: targetWorkspaceId,
								docId: targetDocId,
								userIds: affectedShareUserIds,
							});
							recordMoveDebugTrace(debugTraceId, 'move-metadata-published', {
								noteId,
								targetDocId,
								userCount: affectedShareUserIds.length,
							});
						} catch (publishErr) {
							recordMoveDebugTrace(debugTraceId, 'move-metadata-publish-error', {
								noteId,
								targetDocId,
								error: publishErr && publishErr.message ? publishErr.message : String(publishErr),
							});
							console.warn('[api] note move metadata publish failed:', publishErr.message);
						}
					}
				} catch (err) {
					recordMoveDebugTrace(normalizeMoveDebugTraceId(req.moveDebugTraceId) || null, 'move-error', {
						error: err && err.message ? err.message : String(err),
						stack: err && err.stack ? String(err.stack) : null,
					});
					console.error('[api] POST /api/notes/:noteId/move error:', err.message, err.stack);
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
