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
const CARD_BANNER_CANDIDATE_DIRS = [
	path.resolve(__dirname, '..', 'public', 'CardBanners', 'Dark'),
	path.resolve(__dirname, '..', 'dist', 'CardBanners', 'Dark'),
];
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

function resolveCardBannerDirectory() {
	for (const candidateDir of CARD_BANNER_CANDIDATE_DIRS) {
		if (fs.existsSync(candidateDir)) return candidateDir;
	}
	return CARD_BANNER_CANDIDATE_DIRS[0];
}

function readCardBannerDefinitions() {
	const cardBannersDir = resolveCardBannerDirectory();
	if (!fs.existsSync(cardBannersDir)) {
		return [];
	}
	// Docker/Unraid production images ship the built `dist/` tree, not the source
	// `public/` directory. Banner discovery must therefore read from whichever
	// runtime directory actually exists instead of assuming the source tree is
	// present on disk.
	return fs.readdirSync(cardBannersDir, { withFileTypes: true })
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
function createApiRouter({ prisma, adapter, timezone = null, onWorkspaceMetadataChanged = null, onNoteDocumentDeleted = null }) {
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

	// ─── Note digest projection ──────────────────────────────────────────
	//
	// Turns a persisted Yjs blob into the small shape a note CARD needs, so a device that has
	// never seen a note can draw it at the right size instead of rendering a blank box that
	// resizes a second later.
	//
	// Projected ON DEMAND rather than maintained in a table, and that is a deliberate
	// simplification of the original plan. A table would have meant a Prisma migration (the
	// least reversible thing available) plus write-time projection hooks inside
	// YjsPersistenceAdapter, which CLAUDE.md flags for data loss and cross-workspace leakage.
	// Decoding on request needs neither: it is additive, it reads nothing it does not already
	// have access to, and it can be deleted without a trace if it turns out to be wrong.
	//
	// The cost is CPU per request. With a cursor that cost is only ever paid for documents that
	// have actually changed, so steady state is a handful of decodes. A cold start on a large
	// workspace pages through. If measurement later shows the decode cost matters, THEN add a
	// projection table — but measure first, because the obvious optimisation here buys a
	// migration and a hook in the most dangerous file in the server.
	const DIGEST_CONTENT_PREVIEW_CHARS = 600;
	const DIGEST_MAX_CHECKLIST_ITEMS = 40;
	const DIGEST_CHECKLIST_TEXT_CHARS = 240;

	function digestTextFromRichFragment(doc) {
		try {
			const fragment = doc.getXmlFragment('contentRich');
			if (!fragment || fragment.length === 0) return '';
			// toString() yields XML; strip tags for a length/shape hint. This is for SIZING a
			// card, not for displaying, so losing the markup is fine.
			return String(fragment.toString())
				.replace(/<[^>]*>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
		} catch {
			return '';
		}
	}

	function projectNoteDigestFromState(state, noteId, serverUpdatedAt) {
		if (!state || state.length === 0) return null;
		const doc = new Y.Doc();
		try {
			Y.applyUpdate(doc, new Uint8Array(state));
			const metadata = doc.getMap('metadata');
			const rawType = String(metadata.get('type') ?? 'text');
			const type = rawType === 'checklist' ? 'checklist' : rawType === 'drawing' ? 'drawing' : 'text';

			const plainContent = doc.getText('content').toString();
			const richContent = plainContent.length > 0 ? '' : digestTextFromRichFragment(doc);
			const contentSource = plainContent.length > 0 ? plainContent : richContent;

			const checklist = doc.getArray('checklist');
			const checklistItems = [];
			let completedCount = 0;
			for (let index = 0; index < checklist.length; index++) {
				const item = checklist.get(index);
				const done = item && typeof item.get === 'function' ? item.get('done') === true : false;
				if (done) completedCount += 1;
				if (checklistItems.length >= DIGEST_MAX_CHECKLIST_ITEMS) continue;
				const text = item && typeof item.get === 'function' ? String(item.get('text') ?? '') : '';
				checklistItems.push({ text: text.slice(0, DIGEST_CHECKLIST_TEXT_CHARS), done });
			}

			const labelIdsRaw = metadata.get('labelIds');
			// drawingIds is a TOP-LEVEL Y.Array, not a metadata field. Reading it off the
			// metadata map returned [] for every note, which is how this was caught: an
			// audit reported "0 attached drawings" for a user who plainly has many, and an
			// implausible zero means the method is wrong, not the data. See
			// readDrawingLinkState in noteModel.ts for the canonical read.
			let drawingIds = [];
			try {
				drawingIds = doc.getArray('drawingIds').toArray().filter((id) => typeof id === 'string');
			} catch {
				drawingIds = [];
			}

			return {
				id: noteId,
				type,
				title: doc.getText('title').toString(),
				// A hint for height estimation, not the note. Truncated on purpose.
				contentPreview: contentSource.slice(0, DIGEST_CONTENT_PREVIEW_CHARS),
				contentLength: contentSource.length,
				checklistItems,
				checklistItemCount: checklist.length,
				checklistCompletedCount: completedCount,
				createdAt: Number(metadata.get('createdAt') ?? 0) || 0,
				updatedAt: Number(metadata.get('updatedAt') ?? 0) || 0,
				collectionId: typeof metadata.get('collectionId') === 'string' ? metadata.get('collectionId') : null,
				labelIds: Array.isArray(labelIdsRaw) ? labelIdsRaw.filter((id) => typeof id === 'string') : [],
				drawingIds,
				bannerFile: typeof metadata.get('bannerFile') === 'string' ? metadata.get('bannerFile') : null,
				trashed: metadata.get('trashed') === true,
				archived: metadata.get('archived') === true,
				// The cursor field. Document.updatedAt is @updatedAt, so Postgres already
				// maintains exactly the "changed since" ordering this needs — no new column.
				serverUpdatedAt: serverUpdatedAt instanceof Date ? serverUpdatedAt.toISOString() : null,
			};
		} catch {
			return null;
		} finally {
			doc.destroy();
		}
	}

	// ─── Orphaned-document audit ─────────────────────────────────────────
	//
	// A row in `document` that no registry claims is invisible in the grid and the trash (both
	// render from the registry) while /api/search still finds it, because search queries the
	// table directly. That combination is what a user reported as "I can't find this note but
	// search can, and I can still edit it".
	//
	// Four exclusions, and every one of them is load-bearing:
	//
	//   - **Attached drawings.** These legitimately do NOT appear in noteOrder - they live in
	//     their own rooms, referenced by a parent note's top-level `drawingIds` array. An
	//     earlier version of this audit read drawingIds off the metadata MAP instead and so
	//     reported zero attached drawings, which inflated the orphan count by 39 and would
	//     have deleted every drawing in the account. Caught only because zero was implausible.
	//   - **Registry rooms** - not notes.
	//   - **Markup rooms** (`markup:*`) - these belong to a document version, not a workspace.
	//   - **Anything recent.** A note being drafted right now is not in the registry yet, so
	//     it looks exactly like an orphan. Deleting one would destroy work in progress.
	const ORPHAN_MIN_AGE_MS = 30 * 60 * 1000;

	async function collectWorkspaceDrawingReferences(workspaceId) {
		const rows = await prisma.document.findMany({
			where: { workspaceId },
			select: { state: true },
		});
		const referenced = new Set();
		for (const row of rows) {
			if (!row.state || row.state.length === 0) continue;
			const doc = new Y.Doc();
			try {
				Y.applyUpdate(doc, new Uint8Array(row.state));
				for (const id of doc.getArray('drawingIds').toArray()) {
					const value = String(id ?? '').trim();
					if (value) referenced.add(value);
				}
			} catch {
				// A row we cannot decode contributes no references; it is reported on its own.
			} finally {
				doc.destroy();
			}
		}
		return referenced;
	}

	/**
	 * Everything about a workspace needed to decide what is stale, plus enough detail for a
	 * human to sanity-check the list before anything is deleted.
	 */
	async function auditWorkspaceOrphans(workspaceId) {
		const registry = await readWorkspaceRegistryNoteIds(workspaceId);
		const referencedDrawings = await collectWorkspaceDrawingReferences(workspaceId);
		const rows = await prisma.document.findMany({
			where: { workspaceId },
			select: { docId: true, state: true, createdAt: true, updatedAt: true },
			orderBy: { createdAt: 'asc' },
		});

		const prefix = `${workspaceId}:`;
		const cutoff = Date.now() - ORPHAN_MIN_AGE_MS;
		const orphans = [];
		let noteRows = 0;
		let attachedDrawings = 0;
		let tooRecent = 0;

		for (const row of rows) {
			if (!isDigestEligibleDocId(row.docId)) continue;
			noteRows += 1;
			const bare = row.docId.startsWith(prefix) ? row.docId.slice(prefix.length) : row.docId;
			if (registry && registry.orderIds.has(bare)) continue;
			if (referencedDrawings.has(bare)) {
				attachedDrawings += 1;
				continue;
			}
			if (row.createdAt.getTime() > cutoff || row.updatedAt.getTime() > cutoff) {
				tooRecent += 1;
				continue;
			}
			const projected = projectNoteDigestFromState(row.state, bare, row.updatedAt);
			const checklistChars = projected
				? projected.checklistItems.reduce((sum, item) => sum + String(item.text || '').length, 0)
				: 0;
			const contentChars = projected ? projected.contentLength : 0;
			const titleText = projected ? String(projected.title || '').trim() : '';
			orphans.push({
				noteId: bare,
				docId: row.docId,
				type: projected ? projected.type : 'unknown',
				title: titleText,
				// Enough for a person to recognise a note they want to keep, without shipping
				// the whole thing to the client.
				preview: projected ? String(projected.contentPreview || '').slice(0, 160) : '',
				contentChars,
				checklistItemCount: projected ? projected.checklistItemCount : 0,
				checklistChars,
				trashed: projected ? projected.trashed : false,
				hasContent: titleText.length > 0 || contentChars > 0 || checklistChars > 0,
				createdAt: row.createdAt.toISOString(),
				updatedAt: row.updatedAt.toISOString(),
				bytes: row.state ? row.state.length : 0,
			});
		}

		return {
			workspaceId,
			registryNoteCount: registry ? registry.orderIds.size : null,
			documentNoteRows: noteRows,
			attachedDrawings,
			skippedTooRecent: tooRecent,
			orphans,
		};
	}

	// Which note ids the workspace's registry actually claims.
	//
	// The grid renders from the registry's noteOrder, NOT from the document table, so the two
	// can disagree — and the first real digest response suggested they do: it returned notes
	// the user cannot find in the grid, the trash, or any workspace, plus several rows with no
	// title, no content and createdAt/updatedAt of 0.
	//
	// Needed by the digest regardless of that: a digest built straight from the document table
	// would hand the client orphans and empty stubs to render as cards.
	async function readWorkspaceRegistryNoteIds(workspaceId) {
		try {
			const row = await prisma.document.findUnique({
				where: { docId: makeRoomDocId(workspaceId, '__notes_registry__') },
				select: { state: true },
			});
			if (!row || !row.state || row.state.length === 0) return null;
			const doc = new Y.Doc();
			try {
				Y.applyUpdate(doc, new Uint8Array(row.state));
				const ids = new Set();
				const noteOrder = doc.getArray('noteOrder');
				for (let index = 0; index < noteOrder.length; index++) {
					const value = String(noteOrder.get(index) ?? '').trim();
					if (value) ids.add(value);
				}
				const notesList = doc.getArray('notesList');
				const listIds = new Set();
				for (let index = 0; index < notesList.length; index++) {
					const item = notesList.get(index);
					const value = item && typeof item.get === 'function' ? String(item.get('id') ?? '').trim() : '';
					if (value) listIds.add(value);
				}
				return { orderIds: ids, listIds };
			} finally {
				doc.destroy();
			}
		} catch {
			return null;
		}
	}

	function isDigestEligibleDocId(rawDocId) {
		const id = String(rawDocId || '');
		if (!id) return false;
		if (id.startsWith('markup:')) return false;
		return !id.includes('__notes_registry__')
			&& !id.includes('__collections_registry__')
			&& !id.includes('__labels_registry__');
	}

	// Cursor is (serverUpdatedAt, docId) and both halves are load-bearing: several documents can
	// share a millisecond, and a cursor on the timestamp alone would skip every row that tied
	// with the last one returned. Silently missing notes is exactly the failure this must not
	// have, so the comparison is the standard keyset pair.
	function parseDigestCursor(raw) {
		const value = String(raw || '').trim();
		if (!value) return null;
		const separator = value.indexOf('|');
		if (separator <= 0) return null;
		const at = new Date(value.slice(0, separator));
		if (Number.isNaN(at.getTime())) return null;
		return { at, docId: value.slice(separator + 1) };
	}

	function formatDigestCursor(serverUpdatedAt, storedDocId) {
		if (!(serverUpdatedAt instanceof Date)) return null;
		return `${serverUpdatedAt.toISOString()}|${storedDocId}`;
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
		// Track whether the registry had any prior content so callers can decide
		// whether to create new entries or trust the client's offline-computed mapping.
		const wasEmpty = !liveDoc && !(row?.state && row.state.length > 0);
		if (liveDoc) {
			// Moves need the freshest registry state so label/collection ids can be
			// remapped against rows created moments earlier in the live Yjs session.
			Y.applyUpdate(doc, Y.encodeStateAsUpdate(liveDoc));
		} else if (row?.state && row.state.length > 0) {
			Y.applyUpdate(doc, new Uint8Array(row.state));
		}
		return { docId, row, doc, wasEmpty };
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

	/**
	 * Remap a source collection ID to its equivalent in the target workspace.
	 *
	 * @param {boolean} targetWasEmpty - True when the target registry had no live session
	 *   and no DB row at move time (i.e. the workspace was created offline and has never
	 *   synced). In that case we MUST NOT write new Y.Map entries into the registry:
	 *   Yjs arrays are append-only CRDTs — both the server entry and the client's offline
	 *   entry would survive the merge, producing duplicates. Instead, we use the client's
	 *   preferred ID directly and skip writing the registry altogether (see caller).
	 *
	 * Returns { collectionId, createdEntries } so the caller knows whether any new Yjs
	 * entries were actually written and whether to persist the modified registry.
	 */
	function ensureTargetCollectionIdForMove(sourceCollectionId, sourceCollectionsDoc, targetCollectionsDoc, preferredTargetIdsBySourceId = new Map(), targetWasEmpty = false) {
		const normalizedSourceId = normalizeOptionalId(sourceCollectionId);
		if (!normalizedSourceId) return { collectionId: null, createdEntries: false };
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
		if (sourceChain.length === 0) return { collectionId: null, createdEntries: false };
		let targetParentId = null;
		let createdEntries = false;
		for (const sourceCollection of sourceChain) {
			let targetCollection = readCollectionsFromRegistryDoc(targetCollectionsDoc).find((collection) => (
				collection.parentId === targetParentId && normalizeComparableName(collection.name) === normalizeComparableName(sourceCollection.name)
			)) || null;
			if (!targetCollection) {
				const preferredId = preferredTargetIdsBySourceId.get(sourceCollection.id) || null;
				// Same rationale as ensureTargetLabelIdsForMove: if the target workspace's
				// registry hasn't synced, use the client's preferred ID directly to avoid
				// duplicating Yjs entries when the offline registry eventually syncs.
				if (targetWasEmpty && preferredId) {
					targetParentId = preferredId;
					continue;
				}
				targetCollection = createCollectionInRegistryDoc(targetCollectionsDoc, {
					id: preferredId,
					name: sourceCollection.name,
					parentId: targetParentId,
				});
				if (targetCollection) createdEntries = true;
			}
			if (!targetCollection) return { collectionId: targetParentId, createdEntries };
			targetParentId = targetCollection.id;
		}
		return { collectionId: targetParentId, createdEntries };
	}

	/**
	 * Remap source label IDs to their equivalents in the target workspace.
	 * See ensureTargetCollectionIdForMove for the full rationale behind targetWasEmpty.
	 * Returns { labelIds, createdEntries }.
	 */
	function ensureTargetLabelIdsForMove(sourceLabelIds, sourceLabelsDoc, targetLabelsDoc, preferredTargetIdsBySourceId = new Map(), targetWasEmpty = false) {
		const sourceIds = normalizeLabelIds(sourceLabelIds);
		if (sourceIds.length === 0) return { labelIds: [], createdEntries: false };
		const sourceById = new Map(readLabelsFromRegistryDoc(sourceLabelsDoc).map((label) => [label.id, label]));
		const targetByName = new Map(readLabelsFromRegistryDoc(targetLabelsDoc).map((label) => [normalizeComparableName(label.name), label]));
		const nextLabelIds = [];
		let createdEntries = false;
		for (const sourceLabelId of sourceIds) {
			const sourceLabel = sourceById.get(sourceLabelId) || null;
			if (!sourceLabel) continue;
			const comparableName = normalizeComparableName(sourceLabel.name);
			let targetLabel = targetByName.get(comparableName) || null;
			if (!targetLabel) {
				const preferredId = preferredTargetIdsBySourceId.get(sourceLabel.id) || null;
				// If the target workspace's registry was entirely absent (offline workspace
				// that hasn't synced yet), don't insert a new Yjs entry — it would
				// create a duplicate row when the client's offline registry eventually
				// syncs via the WS. Use the preferred client-computed ID directly.
				if (targetWasEmpty && preferredId) {
					if (!nextLabelIds.includes(preferredId)) {
						nextLabelIds.push(preferredId);
					}
					continue;
				}
				targetLabel = createLabelInRegistryDoc(targetLabelsDoc, {
					id: preferredId,
					name: sourceLabel.name,
					color: sourceLabel.color,
				});
				if (targetLabel) {
					targetByName.set(comparableName, targetLabel);
					createdEntries = true;
				}
			}
			if (targetLabel && !nextLabelIds.includes(targetLabel.id)) {
				nextLabelIds.push(targetLabel.id);
			}
		}
		return { labelIds: nextLabelIds, createdEntries };
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
			const collectionResult = ensureTargetCollectionIdForMove(
				sourceMetadata.collectionId,
				sourceCollectionRegistry.doc,
				nextTargetCollectionRegistry.doc,
				preferredCollectionIdsBySourceId,
				nextTargetCollectionRegistry.wasEmpty,
			);
			mappedCollectionId = collectionResult.collectionId;
			// Only persist the modified registry if new entries were actually written.
			// Skipping the write when the target workspace was offline-only prevents
			// the server's empty snapshot from clobbering the client's offline state
			// when the Yjs WS eventually syncs.
			if (collectionResult.createdEntries) {
				targetCollectionRegistry = nextTargetCollectionRegistry;
			}
		}

		if (sourceMetadata.labelIds.length > 0) {
			const [sourceLabelRegistry, nextTargetLabelRegistry] = await Promise.all([
				loadLabelRegistryRow(tx, sourceWorkspaceId),
				loadLabelRegistryRow(tx, targetWorkspaceId),
			]);
			const labelResult = ensureTargetLabelIdsForMove(
				sourceMetadata.labelIds,
				sourceLabelRegistry.doc,
				nextTargetLabelRegistry.doc,
				preferredLabelIdsBySourceId,
				nextTargetLabelRegistry.wasEmpty,
			);
			mappedLabelIds = labelResult.labelIds;
			if (labelResult.createdEntries) {
				targetLabelRegistry = nextTargetLabelRegistry;
			}
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

		// What the grid thinks exists vs what the database holds, and exactly which rows are
		// unaccounted for. READ-ONLY - deleting is a separate, explicit call.
		if (pathname === '/api/maintenance/orphan-documents' && method === 'GET') {
			(async () => {
				try {
					const userId = requireAuthUserId();
					if (!userId) return;
					const requestedWorkspaceId = String(url.searchParams.get('workspaceId') ?? '').trim()
						|| getSessionWorkspaceId();
					if (!requestedWorkspaceId) {
						jsonResponse(res, 400, { error: 'No workspace specified' });
						return;
					}
					const member = await findLiveWorkspaceMembership(prisma, userId, requestedWorkspaceId, { role: true });
					if (!member) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}
					const audit = await auditWorkspaceOrphans(requestedWorkspaceId);
					jsonResponse(res, 200, audit);
				} catch (error) {
					console.error('[api] Orphan audit failed:', error.message);
					jsonResponse(res, 500, { error: 'Failed to audit documents' });
				}
			})();
			return true;
		}

		// Delete specific orphaned rows.
		//
		// Takes the EXPLICIT list of note ids the client showed the user, rather than a
		// "delete everything stale" flag. That is the whole point: the user consents to a list
		// they have read, and anything that became stale between the preview and the
		// confirmation is not silently swept up with it. Each id is re-checked server-side
		// before deletion, so a stale or hand-edited list cannot delete a live note.
		//
		// OWNER/ADMIN only. It is a bulk delete with no undo behind it.
		if (pathname === '/api/maintenance/orphan-documents' && method === 'POST') {
			(async () => {
				try {
					const userId = requireAuthUserId();
					if (!userId) return;
					const body = await readJsonBody(req);
					const requestedWorkspaceId = String(body?.workspaceId ?? '').trim() || getSessionWorkspaceId();
					if (!requestedWorkspaceId) {
						jsonResponse(res, 400, { error: 'No workspace specified' });
						return;
					}
					const member = await findLiveWorkspaceMembership(prisma, userId, requestedWorkspaceId, { role: true });
					if (!member) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}
					if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
						jsonResponse(res, 403, { error: 'Only a workspace owner or admin can delete documents' });
						return;
					}
					const requestedIds = Array.isArray(body?.noteIds)
						? body.noteIds.map((id) => String(id ?? '').trim()).filter(Boolean)
						: [];
					if (requestedIds.length === 0) {
						jsonResponse(res, 400, { error: 'No note ids supplied' });
						return;
					}

					// Re-audit and intersect. The client's list is a request, not an authority.
					const audit = await auditWorkspaceOrphans(requestedWorkspaceId);
					const deletable = new Map(audit.orphans.map((entry) => [entry.noteId, entry.docId]));
					const toDelete = [];
					const refused = [];
					for (const noteId of requestedIds) {
						const docId = deletable.get(noteId);
						if (docId) toDelete.push({ noteId, docId });
						else refused.push(noteId);
					}

					let deleted = 0;
					for (const entry of toDelete) {
						// Same tombstone as the single-note delete, for the same reason: a room
						// whose last connection closes gets flushed back to Postgres, which
						// would re-create the row we just removed.
						if (typeof onNoteDocumentDeleted === 'function') {
							try {
								onNoteDocumentDeleted(entry.docId);
							} catch {
								// non-fatal
							}
						}
						try {
							await prisma.shareAccessToken.deleteMany({
								where: { entityType: 'NOTE', entityId: entry.docId },
							});
							await prisma.document.delete({ where: { docId: entry.docId } });
							deleted += 1;
							console.info(`[api] purged orphaned document ${entry.docId}`);
						} catch (deleteError) {
							console.warn(`[api] Failed to purge ${entry.docId}:`, deleteError.message);
							refused.push(entry.noteId);
						}
					}

					const cache = adapter && adapter._redis ? adapter._redis : null;
					if (cache && typeof adapter._redisKey === 'function') {
						for (const entry of toDelete) {
							const keys = new Set([
								adapter._redisKey(entry.docId, requestedWorkspaceId),
								adapter._redisKey(entry.docId, null),
								adapter._redisKey(entry.noteId, requestedWorkspaceId),
								adapter._redisKey(entry.noteId, null),
							]);
							for (const key of keys) {
								try {
									await cache.del(key);
								} catch {
									// best effort
								}
							}
						}
					}

					jsonResponse(res, 200, { deleted, refused });
				} catch (error) {
					console.error('[api] Orphan purge failed:', error.message);
					jsonResponse(res, 500, { error: 'Failed to delete documents' });
				}
			})();
			return true;
		}

		// Card shells for the active workspace, so a device that has never seen these notes can
		// render them at the right size. A RENDER HINT ONLY — the moment a real Yjs document
		// loads it wins, unconditionally, which keeps the CRDT authoritative and makes any
		// drift cosmetic rather than a correctness problem.
		//
		// Takes an explicit `workspaceId`, and membership is verified against THAT id.
		//
		// The first version refused a workspace parameter and used requireWorkspaceMember(),
		// on the reasoning that re-implementing membership checks is how cross-workspace leaks
		// happen. Sound reasoning, wrong target: that helper resolves the workspace from
		// getSessionWorkspaceId() - the one baked into the JWT cookie - and the client's active
		// workspace legitimately differs from it. That is the exact case probeSession handles
		// ("local selection differs from the server's active workspace, e.g. an offline switch
		// that has not synced"), and it occurs on roughly half of cold boots. Measured: asking
		// for the digest returned a different workspace's single note instead of the 34 the
		// user was looking at.
		//
		// Verifying membership of the REQUESTED workspace is just as safe - the check is still
		// made, against exactly what is being read - and it is the only version that answers
		// the question the client is actually asking. Falls back to the session workspace when
		// the parameter is absent, which keeps it usable by hand in a browser.
		if (pathname === '/api/note-digest' && method === 'GET') {
			(async () => {
				try {
					const userId = requireAuthUserId();
					if (!userId) return;
					const requestedWorkspaceId = String(url.searchParams.get('workspaceId') ?? '').trim()
						|| getSessionWorkspaceId();
					if (!requestedWorkspaceId) {
						jsonResponse(res, 400, { error: 'No workspace specified' });
						return;
					}
					const member = await findLiveWorkspaceMembership(prisma, userId, requestedWorkspaceId, { role: true });
					if (!member) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}
					const workspaceId = requestedWorkspaceId;
					const requestedLimit = Number.parseInt(String(url.searchParams.get('limit') ?? ''), 10);
					const limit = Number.isFinite(requestedLimit)
						? Math.min(500, Math.max(1, requestedLimit))
						: 200;
					const cursor = parseDigestCursor(url.searchParams.get('since'));
					const includeUnclaimed = url.searchParams.get('includeUnclaimed') === '1';

					const where = { workspaceId };
					if (cursor) {
						where.OR = [
							{ updatedAt: { gt: cursor.at } },
							{ AND: [{ updatedAt: cursor.at }, { docId: { gt: cursor.docId } }] },
						];
					}

					const registry = await readWorkspaceRegistryNoteIds(workspaceId);

					const rows = await prisma.document.findMany({
						where,
						// Matches the keyset cursor above. Must stay in step with it.
						orderBy: [{ updatedAt: 'asc' }, { docId: 'asc' }],
						take: limit + 1,
						select: { docId: true, state: true, updatedAt: true },
					});

					const hasMore = rows.length > limit;
					const page = hasMore ? rows.slice(0, limit) : rows;
					const notes = [];
					for (const row of page) {
						const rawDocId = stripDocNamespace(workspaceId, row.docId);
						if (!isDigestEligibleDocId(row.docId)) continue;
						const projected = projectNoteDigestFromState(row.state, rawDocId, row.updatedAt);
						if (!projected) continue;
						// Reported, not filtered, while this is still a diagnostic. The client
						// integration will want to drop anything the registry does not claim,
						// but first we need to see how much of that there is and why.
						const inNoteOrder = registry ? registry.orderIds.has(rawDocId) : null;
						projected.inNoteOrder = inNoteOrder;
						projected.inNotesList = registry ? registry.listIds.has(rawDocId) : null;
						// Only notes the registry CLAIMS, unless explicitly asked otherwise.
						//
						// This is a correctness requirement, not a tidy-up. The document table is
						// a superset of what the app considers to exist: attached drawings live in
						// their own rooms and are referenced by a parent note's drawingIds rather
						// than by noteOrder, and a note being drafted right now is not registered
						// yet. Hand the unfiltered table to the grid and it renders a phantom card
						// for every one of them - which is precisely the class of bug this whole
						// endpoint was built to help fix, recreated from the other direction.
						//
						// `includeUnclaimed=1` keeps the raw view available for diagnostics; the
						// maintenance endpoints use their own audit and do not rely on it.
						if (!includeUnclaimed && registry && inNoteOrder !== true) continue;
						notes.push(projected);
					}

					// The cursor advances past every row INSPECTED, not every note returned —
					// registries and markup rooms are filtered out, and a cursor that only
					// tracked returned notes would re-read them on every call forever.
					const last = page.length > 0 ? page[page.length - 1] : null;
					jsonResponse(res, 200, {
						notes,
						cursor: last ? formatDigestCursor(last.updatedAt, last.docId) : (url.searchParams.get('since') ?? null),
						hasMore,
						// Echoed so a cursor that silently failed to parse cannot be mistaken for
						// one that parsed and matched nothing. The first manual test returned an
						// identical page for a request WITH a cursor, and those two explanations
						// are indistinguishable from the outside.
						diagnostics: {
							receivedSince: url.searchParams.get('since') ?? null,
							appliedCursor: cursor
								? { at: cursor.at.toISOString(), docId: cursor.docId }
								: null,
							registryNoteOrderCount: registry ? registry.orderIds.size : null,
							registryNotesListCount: registry ? registry.listIds.size : null,
							documentRowsInspected: page.length,
							includeUnclaimed,
						},
					});
				} catch (error) {
					jsonResponse(res, 500, { error: 'Failed to build note digest' });
				}
			})();
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
		// GET /api/system/hud-stats — server/app metrics for the About panel HUD.
		//
		// Admins only. These are whole-instance figures — total registered users, total
		// storage on disk and in the database, process memory, uptime — which is operator
		// information, not something a regular user of a notes app has any use for. Hiding
		// the panel in the client alone would have left the numbers a fetch away for
		// anyone with an account, so the gate lives here and the UI just mirrors it.
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

					const requester = await prisma.user.findUnique({
						where: { id: req.auth.userId },
						select: { role: true, disabled: true },
					});
					if (!requester || requester.disabled || String(requester.role || '').toUpperCase() !== 'ADMIN') {
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
						noteDocumentVersionAgg,
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
						}),
						// File sizes live on versions; every kept version is real disk use.
						prisma.noteDocumentVersion.aggregate({
							where: { deletedAt: null, noteDocument: { deletedAt: null } },
							_sum: { byteSize: true },
						}),
					]);

					const dbStateBytesRow = Array.isArray(dbStateBytesRows) ? dbStateBytesRows[0] : dbStateBytesRows;
					const dbStateBytes = Number(dbStateBytesRow?.bytes || 0);
					const noteImagesBytes = Number(noteImageAgg?._sum?.byteSize || 0);
					const noteDocumentsBytes = Number(noteDocumentVersionAgg?._sum?.byteSize || 0);
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

		// Permanently delete a note's persisted document.
		//
		// This exists because there was no way to do it, and that was a real leak. The client's
		// `permanentlyDeleteNote` removed the note from the registry and destroyed the LOCAL
		// Yjs doc, and nothing ever told the server. Measured on a dev database: 135 of 311
		// document rows belonged to no registry at all - 72 of them with real content, the rest
		// drafts that were opened, persisted, and cancelled. A note you permanently deleted was
		// still on the server, and `/api/search` (which queries the document table directly)
		// would still find it while the grid - which renders from the registry - could not.
		//
		// Note the asymmetry this closes: the SCHEDULED trash cleanup
		// (server/trashCleanup.js) always deleted the row correctly. Only the client-initiated
		// paths - emptying the trash by hand, deleting a note outright, discarding a draft -
		// leaked, because they had no server call to make.
		const deleteNoteDocMatch = pathname.match(/^\/api\/notes\/([^/]+)\/document$/);
		if (deleteNoteDocMatch && method === 'DELETE') {
			(async () => {
				try {
					const access = await requireWorkspaceMember();
					if (!access) return;
					const { workspaceId, member } = access;
					if (member.role === 'VIEWER') {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}
					const rawNoteId = decodeURIComponent(deleteNoteDocMatch[1] || '').trim();
					if (!rawNoteId) {
						jsonResponse(res, 400, { error: 'Missing note id' });
						return;
					}
					// Registry rooms are not notes and must never be deletable through here.
					if (!isDigestEligibleDocId(rawNoteId)) {
						jsonResponse(res, 400, { error: 'Not a note document' });
						return;
					}
					const storedDocId = namespacedDocId(workspaceId, rawNoteId);
					const row = await prisma.document.findUnique({
						where: { docId: storedDocId },
						select: { id: true, workspaceId: true },
					});
					if (!row) {
						// Idempotent: the client may retry a queued delete after the row is
						// already gone, and that is a success, not an error.
						console.info(`[api] note document already absent ${storedDocId}`);
						jsonResponse(res, 200, { deleted: false, alreadyAbsent: true });
						return;
					}
					// Belt and braces. The docId is namespaced with the workspace, so this
					// should be unreachable - but this endpoint deletes data, and a mismatch
					// here would mean deleting another workspace's note.
					if (row.workspaceId !== workspaceId) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					// Tombstone FIRST. The server flushes a room back to Postgres when its
					// last connection closes, so a delete races that write — and losing the
					// race re-creates the row. Marking before the delete means a flush landing
					// at any point from here on is refused.
					if (typeof onNoteDocumentDeleted === 'function') {
						try {
							onNoteDocumentDeleted(storedDocId);
						} catch (tombstoneError) {
							console.warn('[api] Failed to record delete tombstone:', tombstoneError.message);
						}
					}

					// shareAccessToken references notes polymorphically via entityId rather
					// than a foreign key, so it does not cascade and has to go explicitly.
					// Everything else that points at Document does cascade (see schema).
					await prisma.shareAccessToken.deleteMany({
						where: { entityType: 'NOTE', entityId: storedDocId },
					});
					await prisma.document.delete({ where: { id: row.id } });

					// Invalidate the Redis cache or the document comes straight back: the
					// adapter reads from cache before Postgres, with a 24h TTL. The key is
					// built as `fn:yjs:<workspaceId || workspaceName>:<docName>`, and both
					// forms are cleared because which one was written depends on how the
					// adapter was constructed. DEL on a missing key is a no-op.
					// createApiRouter does not receive a redis client, but the adapter owns one
					// along with the canonical key builder. Reaching in like this is the
					// pattern server/trashCleanup.js already uses, and it is better than
					// re-deriving the key format here and getting it subtly wrong.
					const cache = adapter && adapter._redis ? adapter._redis : null;
					if (cache && typeof adapter._redisKey === 'function') {
						// Both namespaces: the key is `fn:yjs:<workspaceId || workspaceName>:<doc>`
						// and which one was written depends on how the adapter was constructed.
						// DEL on a missing key is a no-op.
						const keys = new Set([
							adapter._redisKey(storedDocId, workspaceId),
							adapter._redisKey(storedDocId, null),
							adapter._redisKey(rawNoteId, workspaceId),
							adapter._redisKey(rawNoteId, null),
						]);
						for (const key of keys) {
							try {
								await cache.del(key);
							} catch (cacheError) {
								console.warn(`[api] Redis invalidation failed for ${key}:`, cacheError.message);
							}
						}
					}

					// Logged unconditionally. A count measured afterwards can only say whether a
					// row survived, not whether the client ever asked - and those need
					// different fixes (stale bundle / failed call vs. a server-side problem).
					console.info(`[api] deleted note document ${storedDocId}`);
					jsonResponse(res, 200, { deleted: true });
				} catch (error) {
					console.error('[api] Failed to delete note document:', error.message);
					jsonResponse(res, 500, { error: 'Failed to delete note document' });
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
						// Migrate EntityReference rows so _syncEntityReferences finds existing
						// records when it next runs for the target workspace, preventing it
						// from treating all chips as "new" and emitting duplicate activities.
						// EntityReference has @@unique([sourceDocId, nodeId]) so we must
						// delete any conflicting target rows before updating.
						const sourceEntityRefNodeIds = (await tx.entityReference.findMany({
							where: { sourceDocId: sourceDocId },
							select: { nodeId: true },
						})).map((r) => r.nodeId);
						if (sourceEntityRefNodeIds.length > 0) {
							await tx.entityReference.deleteMany({
								where: { sourceDocId: targetDocId, nodeId: { in: sourceEntityRefNodeIds } },
							});
							await tx.entityReference.updateMany({
								where: { sourceDocId: sourceDocId },
								data: { sourceDocId: targetDocId, sourceWorkspaceId: targetWorkspaceId },
							});
						}

						// Migrate Activity rows so inbox card navigation resolves to the
						// correct workspace after the move.
						await tx.activity.updateMany({
							where: { sourceDocId: sourceDocId },
							data: { sourceDocId: targetDocId, sourceWorkspaceId: targetWorkspaceId },
						});

						// Migrate NoteReminder rows. NoteReminder has @@unique([userId, docId])
						// so delete conflicting target rows first, same as EntityReference.
						const sourceReminderUserIds = (await tx.noteReminder.findMany({
							where: { docId: sourceDocId },
							select: { userId: true },
						})).map((r) => r.userId);
						if (sourceReminderUserIds.length > 0) {
							await tx.noteReminder.deleteMany({
								where: { docId: targetDocId, userId: { in: sourceReminderUserIds } },
							});
							await tx.noteReminder.updateMany({
								where: { docId: sourceDocId },
								data: { docId: targetDocId, workspaceId: targetWorkspaceId },
							});
						}

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

		// ── POST /api/dev/clear-notifications — delete all reminders for the current user ──
		// Developer tool: forces-clears lingering NoteReminder rows that keep re-firing
		// after the user has already dismissed them in the UI.
		if (pathname === '/api/dev/clear-notifications' && method === 'POST') {
			(async () => {
				const userId = requireAuthUserId();
				if (!userId) return;
				try {
					const result = await prisma.noteReminder.deleteMany({ where: { userId } });
					jsonResponse(res, 200, { ok: true, deleted: result.count });
				} catch (err) {
					console.error('[api] POST /api/dev/clear-notifications error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── POST /api/dev/clear-inbox — archive all inbox activity rows for the current user ──
		// Developer tool: hard-resets the bell badge to 0 by marking every activity row as
		// archived, clearing stale counts that persist after normal archive-all operations.
		if (pathname === '/api/dev/clear-inbox' && method === 'POST') {
			(async () => {
				const userId = requireAuthUserId();
				if (!userId) return;
				try {
					// Find all activity IDs targeting this user that aren't already archived
					const targets = await prisma.activityTarget.findMany({
						where: { userId },
						select: { activityId: true },
					});
					const activityIds = targets.map((t) => t.activityId);
					let archived = 0;
					if (activityIds.length > 0) {
						const result = await prisma.activityRead.updateMany({
							where: { userId, activityId: { in: activityIds } },
							data: { archived: true, archivedAt: new Date() },
						});
						// Upsert for any that have no read row yet
						const existingReadIds = (await prisma.activityRead.findMany({
							where: { userId, activityId: { in: activityIds } },
							select: { activityId: true },
						})).map((r) => r.activityId);
						const missing = activityIds.filter((id) => !existingReadIds.includes(id));
						if (missing.length > 0) {
							await prisma.activityRead.createMany({
								data: missing.map((activityId) => ({
									userId,
									activityId,
									archived: true,
									archivedAt: new Date(),
								})),
								skipDuplicates: true,
							});
						}
						archived = activityIds.length;
					}
					jsonResponse(res, 200, { ok: true, archived });
				} catch (err) {
					console.error('[api] POST /api/dev/clear-inbox error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── GET /api/notes/:noteId/access-check ──────────────────────────
		// Returns 200 if the current user can read the note, 403 if not.
		// Used by RichTextEditor to gate navigation on note mention chips.
		// Also reports `trashed` so the client can offer a "Restore" prompt
		// instead of silently opening a note the user just deleted, and `via`
		// so the caller knows WHY access was granted. Those two routes are not
		// interchangeable: a workspace member can be sent into that workspace,
		// a share recipient absolutely cannot — doing that switched people into
		// a workspace they were not a member of, which the next /api/workspaces
		// refresh then reported as missing and tore the whole UI down with a
		// "workspace no longer exists" notice. A bare `access: true` couldn't
		// tell the client which of the two it was looking at.
		const noteAccessMatch = pathname.match(/^\/api\/notes\/([^/]+)\/access-check$/);
		if (noteAccessMatch && method === 'GET') {
			(async () => {
				try {
					const userId = requireAuthUserId();
					if (!userId) return;

					const noteId = noteAccessMatch[1];
					if (!/^[0-9a-f-]{36}$/i.test(noteId)) {
						jsonResponse(res, 400, { error: 'Invalid noteId' });
						return;
					}

					// Find the document — docId format is `${workspaceId}:${noteId}`
					const doc = await prisma.document.findFirst({
						where: { docId: { endsWith: `:${noteId}` } },
						select: { docId: true, state: true },
					});

					if (!doc) {
						jsonResponse(res, 404, { access: false });
						return;
					}

					const ownerWorkspaceId = doc.docId.split(':')[0];

					// Note metadata (including trashed status) lives inside the Yjs doc, not
					// a SQL column. Prefer the in-memory live doc (most current) and fall
					// back to decoding the persisted state — same pattern used by the trash
					// empty endpoint and pushService's reminder trash guard.
					const isTrashed = () => {
						try {
							const liveDoc = liveDocs.get(doc.docId) || null;
							if (liveDoc) {
								return Boolean(liveDoc.getMap('metadata').get('trashed'));
							}
							if (!doc.state || doc.state.length === 0) return false;
							const tempDoc = new Y.Doc();
							Y.applyUpdate(tempDoc, new Uint8Array(doc.state));
							const trashed = Boolean(tempDoc.getMap('metadata').get('trashed'));
							tempDoc.destroy();
							return trashed;
						} catch {
							return false;
						}
					};

					// Check workspace membership
					const member = await prisma.workspaceMember.findUnique({
						where: { userId_workspaceId: { userId, workspaceId: ownerWorkspaceId } },
						select: { workspaceId: true },
					});
					if (member) {
						jsonResponse(res, 200, { access: true, via: 'member', trashed: isTrashed() });
						return;
					}

					// Check accepted note collaboration (share)
					const collab = await prisma.noteCollaborator.findFirst({
						where: { docId: doc.docId, userId },
						select: { docId: true },
					});
					if (collab) {
						jsonResponse(res, 200, { access: true, via: 'collaborator', trashed: isTrashed() });
						return;
					}

					jsonResponse(res, 403, { access: false });
				} catch (err) {
					console.error('[api] GET /api/notes/access-check error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── Flush deferred mention notifications for a note ────────────
		// Called by the client when the note editor closes. Fires any pending
		// mention notifications for that room without waiting for WS disconnect.
		if (pathname.startsWith('/api/notes/') && pathname.endsWith('/flush-mentions') && method === 'POST') {
			if (!req.auth || !req.auth.userId) {
				jsonResponse(res, 401, { error: 'Not authenticated' });
				return true;
			}
			const noteId = pathname.slice('/api/notes/'.length, -'/flush-mentions'.length);
			if (!noteId || noteId.includes('/') || noteId.includes(':')) {
				jsonResponse(res, 400, { error: 'Invalid noteId' });
				return true;
			}
			(async () => {
				try {
					await adapter?.flushMentionsForNote(noteId);
				} catch (err) {
					console.warn('[api] flush-mentions error:', err.message);
				}
				jsonResponse(res, 200, { ok: true });
			})();
			return true;
		}

		// ── Not handled by this router → fall through ────────────────────
		return false;
	}

	return handleRequest;
}

module.exports = { createApiRouter };
