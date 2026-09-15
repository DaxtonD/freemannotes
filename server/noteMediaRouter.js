'use strict';

const Y = require('yjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const { enforceSameOrigin } = require('./auth');
const {
	createDocumentPreviewBuffers,
	getNormalizedDocumentExtension,
	isSupportedNoteDocument,
	sanitizeBaseName,
} = require('./noteDocumentPreview');
const { extractDocumentTextInWorker } = require('./documentTextExtraction');
const { buildLinkSeed, isLikelyBadPreviewImageUrl, resolveNoteLinkPreview } = require('./noteLinkPreview');
const { resolveDocAccess } = require('./noteShareRouter');
const { listManifestDocuments } = require('./noteDocumentManifest');
const { createGotenbergConverter, describeConverterHealth, isConvertibleDocumentExtension } = require('./documentConverter');
const { createDocumentConversionQueue } = require('./documentConversionQueue');
const { createDocumentThumbnailQueue } = require('./documentThumbnails');
const { buildSearchSnippet, decodeDocumentState, normalizeText } = require('./noteSnapshot');
const { queueNoteImageOcr } = require('./ocr');
const { normalizeMoveDebugTraceId, recordMoveDebugTrace } = require('./moveDebugTrace');

const MAX_FILES_PER_UPLOAD = 12;
// Tracks docIds currently undergoing background URL hydration.
// Prevents concurrent hydrations for the same doc when multiple POST requests
// arrive in rapid succession during reconnect (which would rate-limit the URLs).
const activeHydrations = new Set();
const MAX_SOURCE_FILE_BYTES = 32 * 1024 * 1024;
// Largest document a user can upload (DOCUMENT_UPLOAD_MAX_MB, default 100). Print sets blow past
// 40 MB all the time. The file sits in memory while it saves, so this is also roughly how much RAM
// one upload can take. Clamped so a typo can't switch uploads off or ask for 50 GB.
const DOCUMENT_UPLOAD_MAX_MB = Math.round(clampNumber(process.env.DOCUMENT_UPLOAD_MAX_MB, 1, 2048, 100));
const MAX_DOCUMENT_FILE_BYTES = DOCUMENT_UPLOAD_MAX_MB * 1024 * 1024;
// Document uploads stream in here, then move into their version folder once they've fully arrived.
// It's inside the uploads folder so that move is a rename on the same disk, and /uploads/ never
// serves it (uploadAccess.js only knows avatars and users/… paths).
const INCOMING_DIR_NAME = '.incoming';
// A server stopped mid-upload leaves its half-written file behind; anything this old gets swept.
const STALE_INCOMING_MS = 24 * 60 * 60 * 1000;

async function moveFile(from, to) {
	try {
		await fs.promises.rename(from, to);
	} catch (error) {
		// Different disks (say, a subfolder mounted separately): copy, then remove the original.
		if (!error || error.code !== 'EXDEV') throw error;
		await fs.promises.copyFile(from, to);
		await fs.promises.rm(from, { force: true });
	}
}

async function sweepStaleIncomingUploads(incomingDir) {
	let names;
	try {
		names = await fs.promises.readdir(incomingDir);
	} catch {
		return;
	}
	const cutoff = Date.now() - STALE_INCOMING_MS;
	for (const name of names) {
		const filePath = path.join(incomingDir, name);
		try {
			const stat = await fs.promises.stat(filePath);
			if (stat.isFile() && stat.mtimeMs < cutoff) await fs.promises.rm(filePath, { force: true });
		} catch {
			// Already gone (another sweep, or the upload finished and moved it).
		}
	}
}
const MAX_COMPRESSED_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_URL_BYTES = 32 * 1024 * 1024;
const THUMB_SIZE_PX = 360;
const LEGACY_PERSONAL_NAME_RE = /^Personal \([0-9a-f-]{36}\)$/i;
const LEGACY_SHARED_WITH_ME_NAME_RE = /^Shared With Me \([0-9a-f-]{36}\)$/i;
const COLLECTIONS_REGISTRY_DOC_ID = '__collections_registry__';
const LABELS_REGISTRY_DOC_ID = '__labels_registry__';

// Client-side upload/capture compression ceiling — clients fetch this via
// GET /api/config rather than hardcoding it, so a self-hosted instance's
// admin can trade image quality against storage/bandwidth for their user
// count via env vars alone (no DB row, no admin UI — see IMAGE_CAPTURE_* in
// third-party/freemannotes.xml / docker-compose.yml / .env.example for the
// sizing guidance).
// Clamped defensively so a malformed env value can't produce a 0px canvas or
// a fully-degenerate JPEG quality.
function clampNumber(value, min, max, fallback) {
	const num = Number(value);
	if (!Number.isFinite(num)) return fallback;
	return Math.min(max, Math.max(min, num));
}
const IMAGE_CAPTURE_MAX_DIMENSION_PX = clampNumber(process.env.IMAGE_CAPTURE_MAX_DIMENSION_PX, 320, 6000, 2560);
const IMAGE_CAPTURE_JPEG_QUALITY = clampNumber(process.env.IMAGE_CAPTURE_JPEG_QUALITY, 0.1, 1, 0.82);

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

function toPublicUploadPath(relativePath) {
	return `/uploads/${String(relativePath || '').replace(/\\/g, '/')}`;
}

function requireAuth(req, res) {
	if (!req.auth || !req.auth.userId) {
		jsonResponse(res, 401, { error: 'Not authenticated' });
		return null;
	}
	return req.auth;
}

function normalizeWorkspaceLabel(workspace) {
	if (!workspace || typeof workspace !== 'object') return 'Workspace';
	if (workspace.systemKind === 'SHARED_WITH_ME') return 'Shared With Me';
	const rawName = typeof workspace.name === 'string' ? workspace.name.trim() : '';
	if (!rawName) return 'Workspace';
	if (workspace.ownerUserId && LEGACY_PERSONAL_NAME_RE.test(rawName)) return 'Personal';
	if (LEGACY_SHARED_WITH_ME_NAME_RE.test(rawName)) return 'Shared With Me';
	return rawName;
}

function formatCollaboratorLabel(user) {
	if (!user || typeof user !== 'object') return '';
	const name = typeof user.name === 'string' ? user.name.trim() : '';
	const email = typeof user.email === 'string' ? user.email.trim() : '';
	if (name && email && name.toLowerCase() !== email.toLowerCase()) return `${name} <${email}>`;
	return name || email;
}

function decodeCollectionRegistryState(state) {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, new Uint8Array(state));
	const rows = doc.getArray('collections').toArray();
	const collections = rows.map((row) => ({
		id: typeof row.get('id') === 'string' ? String(row.get('id')).trim() : '',
		name: typeof row.get('name') === 'string' ? String(row.get('name')).trim() : '',
		parentId: typeof row.get('parentId') === 'string' ? String(row.get('parentId')).trim() || null : null,
	})).filter((row) => row.id && row.name);
	doc.destroy();
	const byId = new Map(collections.map((collection) => [collection.id, collection]));
	const cache = new Map();
	const visit = (collectionId, seen = new Set()) => {
		if (cache.has(collectionId)) return cache.get(collectionId);
		const collection = byId.get(collectionId);
		if (!collection) return '';
		if (seen.has(collectionId)) return collection.name;
		const nextSeen = new Set(seen);
		nextSeen.add(collectionId);
		const parentPath = collection.parentId ? visit(collection.parentId, nextSeen) : '';
		const pathLabel = parentPath ? `${parentPath} / ${collection.name}` : collection.name;
		cache.set(collectionId, pathLabel);
		return pathLabel;
	};
	for (const collection of collections) {
		visit(collection.id);
	}
	return cache;
}

function decodeLabelRegistryState(state) {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, new Uint8Array(state));
	const rows = doc.getArray('labels').toArray();
	const labels = new Map();
	for (const row of rows) {
		const id = typeof row.get('id') === 'string' ? String(row.get('id')).trim() : '';
		const name = typeof row.get('name') === 'string' ? String(row.get('name')).trim() : '';
		if (!id || !name) continue;
		labels.set(id, name);
	}
	doc.destroy();
	return labels;
}

async function ensureMediaAccess(prisma, session, rawDocId, { requireEdit = false, debugTraceId = null, debugContext = 'note-media' } = {}) {
	const access = await resolveDocAccess(prisma, session, rawDocId, {
		debugTraceId,
		context: debugContext,
	});
	if (!access) return { error: { status: 403, body: { error: 'Forbidden' } }, access: null };
	if (requireEdit && access.accessRole !== 'EDITOR' && access.canManage !== true) {
		return { error: { status: 403, body: { error: 'Forbidden' } }, access: null };
	}
	return { error: null, access };
}

async function publishNoteMediaMetadataChange(onWorkspaceMetadataChanged, access, reason) {
	if (typeof onWorkspaceMetadataChanged !== 'function' || !access) return;
	try {
		// Media mutations do not change the Yjs document body, so we publish a small
		// metadata event to nudge other sessions to refresh note-media state directly.
		await onWorkspaceMetadataChanged({
			reason,
			workspaceId: access.sourceWorkspaceId,
			docId: access.docId,
		});
	} catch (error) {
		console.warn('[note-media] metadata event publish failed:', error && error.message ? error.message : String(error));
	}
}

async function compressImage(buffer) {
	const resizeTargets = [2560, 2200, 1920, 1600];
	const qualities = [82, 76, 68, 60, 52];

	for (const edge of resizeTargets) {
		for (const quality of qualities) {
			const candidate = await sharp(buffer)
				.rotate()
				.resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
				.webp({ quality })
				.toBuffer();
			if (candidate.length <= MAX_COMPRESSED_FILE_BYTES) {
				const metadata = await sharp(candidate).metadata();
				const thumbnail = await sharp(candidate)
					.resize(THUMB_SIZE_PX, THUMB_SIZE_PX, { fit: 'inside', withoutEnlargement: true })
					.webp({ quality: 72 })
					.toBuffer();
				const thumbMetadata = await sharp(thumbnail).metadata();
				return {
					original: candidate,
					thumbnail,
					width: Number(metadata.width || 0) || null,
					height: Number(metadata.height || 0) || null,
					thumbnailWidth: Number(thumbMetadata.width || 0) || null,
					thumbnailHeight: Number(thumbMetadata.height || 0) || null,
				};
			}
		}
	}

	throw new Error('Unable to compress image under 5 MB');
}

function isHeicLikeInput(mimeType, fileName = '') {
	const normalizedMimeType = String(mimeType || '').toLowerCase();
	if (normalizedMimeType === 'image/heic' || normalizedMimeType === 'image/heif') return true;
	return /\.(heic|heif)$/i.test(String(fileName || '').trim());
}

async function normalizeSourceImageBuffer(sourceBuffer, mimeType, fileName = '') {
	if (!isHeicLikeInput(mimeType, fileName)) return sourceBuffer;
	try {
		return Buffer.from(await heicConvert({
			buffer: sourceBuffer,
			format: 'JPEG',
			quality: 0.92,
		}));
	} catch (error) {
		throw new Error(`HEIC/HEIF conversion failed: ${error && error.message ? error.message : String(error)}`);
	}
}

async function persistImageRecord({ prisma, uploadDir, access, userId, sourceBuffer, mimeType, fileName = '', sourceUrl = null }) {
	const normalizedSourceBuffer = await normalizeSourceImageBuffer(sourceBuffer, mimeType, fileName);
	const compressed = await compressImage(normalizedSourceBuffer);
	const noteImage = await prisma.noteImage.create({
		data: {
			docId: access.docId,
			sourceWorkspaceId: access.sourceWorkspaceId,
			sourceNoteId: access.sourceNoteId,
			uploadedByUserId: userId,
			storageKey: '',
			originalPath: '',
			thumbnailPath: '',
			mimeType,
			byteSize: compressed.original.length,
			width: compressed.width,
			height: compressed.height,
			thumbnailWidth: compressed.thumbnailWidth,
			thumbnailHeight: compressed.thumbnailHeight,
			sourceUrl,
			fileName: path.basename(String(fileName || '')) || null,
		},
	});

	const baseRelativeDir = path.join('users', userId, 'notes', noteImage.id);
	const absoluteDir = path.join(uploadDir, baseRelativeDir);
	await fs.promises.mkdir(absoluteDir, { recursive: true });

	const originalRelativePath = path.join(baseRelativeDir, 'original.webp');
	const thumbnailRelativePath = path.join(baseRelativeDir, 'thumb.webp');
	await Promise.all([
		fs.promises.writeFile(path.join(uploadDir, originalRelativePath), compressed.original),
		fs.promises.writeFile(path.join(uploadDir, thumbnailRelativePath), compressed.thumbnail),
	]);

	const updated = await prisma.noteImage.update({
		where: { id: noteImage.id },
		data: {
			storageKey: noteImage.id,
			originalPath: originalRelativePath.replace(/\\/g, '/'),
			thumbnailPath: thumbnailRelativePath.replace(/\\/g, '/'),
		},
	});

	queueNoteImageOcr(prisma, updated.id);
	return updated;
}

function mapNoteImage(image) {
	return {
		id: image.id,
		docId: image.docId,
		sourceWorkspaceId: image.sourceWorkspaceId,
		sourceNoteId: image.sourceNoteId,
		mimeType: image.mimeType,
		byteSize: image.byteSize,
		width: image.width,
		height: image.height,
		thumbnailWidth: image.thumbnailWidth,
		thumbnailHeight: image.thumbnailHeight,
		sourceUrl: image.sourceUrl || null,
		fileName: image.fileName || null,
		assetStatus: image.assetStatus,
		ocrStatus: image.ocrStatus,
		ocrText: image.ocrText || '',
		ocrError: image.ocrError || null,
		createdAt: image.createdAt.toISOString(),
		updatedAt: image.updatedAt.toISOString(),
		originalUrl: toPublicUploadPath(image.originalPath),
		thumbnailUrl: toPublicUploadPath(image.thumbnailPath),
	};
}

function mapNoteLink(link) {
	return {
		id: link.id,
		docId: link.docId,
		sourceWorkspaceId: link.sourceWorkspaceId,
		sourceNoteId: link.sourceNoteId,
		normalizedUrl: link.normalizedUrl,
		originalUrl: link.originalUrl,
		hostname: link.hostname,
		rootDomain: link.rootDomain,
		siteName: link.siteName || null,
		title: link.title || null,
		description: link.description || null,
		mainContent: link.mainContent || null,
		imageUrl: link.imageUrl || null,
		metadataJson: link.metadataJson && typeof link.metadataJson === 'object' ? link.metadataJson : null,
		imageUrls: Array.isArray(link.imageUrls) ? link.imageUrls.filter((value) => typeof value === 'string') : [],
		sortOrder: Number(link.sortOrder || 0),
		status: link.status,
		errorMessage: link.errorMessage || null,
		createdAt: link.createdAt.toISOString(),
		updatedAt: link.updatedAt.toISOString(),
	};
}

// Every document query that feeds mapNoteDocument must include this, so the mapper
// always has the newest live version and a count of the live ones.
const LATEST_DOCUMENT_VERSION_INCLUDE = {
	versions: {
		where: { deletedAt: null },
		orderBy: { versionNumber: 'desc' },
		take: 1,
	},
	_count: {
		select: { versions: { where: { deletedAt: null } } },
	},
};

// The document list keeps the old flat shape (fileName, ocrText, originalUrl, …) filled
// from the latest version, plus version info on top. The client stores and search code
// read those flat fields today, so they keep working while the new Documents tab is
// built on top of the same payload.
function mapNoteDocument(document) {
	const latest = Array.isArray(document.versions) ? document.versions[0] : null;
	// A document with no live version has nothing to show or download. Upload never
	// leaves one behind (it cleans up after itself), so this is belt and braces.
	if (!latest) return null;
	return {
		id: document.id,
		docId: document.docId,
		sourceWorkspaceId: document.sourceWorkspaceId,
		sourceNoteId: document.sourceNoteId,
		versionCount: Number(document._count?.versions || 1),
		latestVersionId: latest.id,
		latestVersionNumber: latest.versionNumber,
		uploadedByUserId: latest.uploadedByUserId,
		fileName: latest.fileName,
		fileExtension: latest.fileExtension,
		mimeType: latest.mimeType,
		byteSize: latest.byteSize,
		pageCount: latest.pageCount,
		previewWidth: latest.previewWidth,
		previewHeight: latest.previewHeight,
		thumbnailWidth: latest.thumbnailWidth,
		thumbnailHeight: latest.thumbnailHeight,
		ocrStatus: latest.ocrStatus,
		ocrText: latest.ocrText || '',
		ocrError: latest.ocrError || null,
		createdAt: document.createdAt.toISOString(),
		updatedAt: document.updatedAt.toISOString(),
		versionCreatedAt: latest.createdAt.toISOString(),
		conversionStatus: latest.conversionStatus,
		viewPdfUrl: latest.viewPdfPath ? toPublicUploadPath(latest.viewPdfPath) : null,
		originalUrl: toPublicUploadPath(latest.originalPath),
		previewUrl: toPublicUploadPath(latest.previewPath),
		thumbnailUrl: toPublicUploadPath(latest.thumbnailPath),
	};
}

function noteLinkNeedsResolution(link) {
	if (!link || typeof link !== 'object') return false;
	// FAILED means the server already attempted resolution and the URL could not
	// be fetched (paywall, bot-block, timeout). Treat it as terminal – do not
	// re-attempt automatically to avoid hammering the same failing endpoint.
	if (link.status === 'FAILED') return false;
	return link.status !== 'READY'
		|| (!link.title && !link.description && !link.mainContent)
		|| !link.imageUrl
		|| isLikelyBadPreviewImageUrl(link.imageUrl);
}

async function hydrateNoteLinkRows(prisma, rows) {
	if (!Array.isArray(rows) || rows.length === 0) return [];
	let mutated = false;
	for (const row of rows) {
		if (!noteLinkNeedsResolution(row)) continue;
		mutated = true;
		try {
			const resolved = await resolveNoteLinkPreview(row.originalUrl || row.normalizedUrl);
			await prisma.noteLink.update({
				where: { id: row.id },
				data: {
					hostname: resolved.hostname,
					rootDomain: resolved.rootDomain,
					siteName: resolved.siteName,
					title: resolved.title,
					description: resolved.description,
					mainContent: resolved.mainContent,
					imageUrl: resolved.imageUrl,
					metadataJson: resolved.metadataJson,
					imageUrls: resolved.imageUrls,
					status: 'READY',
					errorMessage: null,
				},
			});
		} catch (error) {
			await prisma.noteLink.update({
				where: { id: row.id },
				data: {
					status: 'FAILED',
					errorMessage: error && error.message ? error.message : 'Link preview resolution failed',
				},
			});
		}
	}
	if (!mutated) return rows;
	return prisma.noteLink.findMany({
		where: {
			docId: rows[0].docId,
			deletedAt: null,
		},
		orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
	});
}

// Writes one version's files and fills in its row. Files live in their own folder per
// version (users/<uploader>/documents/<versionId>/), which is also how /uploads/ access
// checks find the row again (see server/uploadAccess.js).
async function createDocumentVersion({ prisma, uploadDir, noteDocumentId, versionNumber, userId, sourcePath, byteSize, fileName, mimeType, convertOffice = false }) {
	const fileExtension = getNormalizedDocumentExtension(fileName, mimeType);
	const version = await prisma.noteDocumentVersion.create({
		data: {
			noteDocumentId,
			versionNumber,
			uploadedByUserId: userId,
			originalPath: '',
			previewPath: '',
			thumbnailPath: '',
			fileName: path.basename(String(fileName || `document.${fileExtension || 'bin'}`)),
			fileExtension,
			mimeType,
			byteSize,
			// Office files wait for a PDF copy only when Gotenberg is set up; the queue picks them up.
			conversionStatus: convertOffice && isConvertibleDocumentExtension(fileExtension) ? 'PENDING' : 'NOT_NEEDED',
		},
	});

	const baseRelativeDir = ['users', userId, 'documents', version.id].join('/');
	const fileBaseName = sanitizeBaseName(fileName);
	const originalRelativePath = `${baseRelativeDir}/${fileBaseName || 'document'}.${fileExtension}`;
	const previewRelativePath = `${baseRelativeDir}/preview.webp`;
	const thumbnailRelativePath = `${baseRelativeDir}/thumb.webp`;
	const absoluteOriginalPath = path.join(uploadDir, originalRelativePath);

	try {
		await fs.promises.mkdir(path.join(uploadDir, baseRelativeDir), { recursive: true });
		// The upload is already on disk: move it into place instead of reading it back into memory.
		await moveFile(sourcePath, absoluteOriginalPath);

		// In a worker thread, straight from the file, so a big print set doesn't stall the server.
		const extracted = await extractDocumentTextInWorker({
			filePath: absoluteOriginalPath,
			extension: fileExtension,
		});
		const preview = await createDocumentPreviewBuffers({
			fileName,
			extension: fileExtension,
			extractedText: extracted.text,
		});

		await Promise.all([
			fs.promises.writeFile(path.join(uploadDir, previewRelativePath), preview.previewBuffer),
			fs.promises.writeFile(path.join(uploadDir, thumbnailRelativePath), preview.thumbnailBuffer),
		]);

		return await prisma.noteDocumentVersion.update({
			where: { id: version.id },
			data: {
				originalPath: originalRelativePath,
				previewPath: previewRelativePath,
				thumbnailPath: thumbnailRelativePath,
				pageCount: extracted.pageCount,
				previewWidth: preview.previewWidth,
				previewHeight: preview.previewHeight,
				thumbnailWidth: preview.thumbnailWidth,
				thumbnailHeight: preview.thumbnailHeight,
				ocrStatus: extracted.errorMessage ? 'FAILED' : 'COMPLETE',
				ocrText: extracted.text || '',
				ocrError: extracted.errorMessage ? String(extracted.errorMessage).slice(0, 2000) : null,
			},
		});
	} catch (error) {
		// Half-written versions are worse than none: a row pointing at missing files
		// shows up as a broken download on every device. Undo and let the caller report.
		await prisma.noteDocumentVersion.delete({ where: { id: version.id } }).catch(() => undefined);
		await fs.promises.rm(path.join(uploadDir, baseRelativeDir), { recursive: true, force: true }).catch(() => undefined);
		throw error;
	}
}

async function persistDocumentRecord({ prisma, uploadDir, access, userId, sourcePath, byteSize, fileName, mimeType, convertOffice = false }) {
	if (!isSupportedNoteDocument(fileName, mimeType)) {
		throw new Error('Unsupported document type');
	}
	const noteDocument = await prisma.noteDocument.create({
		data: {
			docId: access.docId,
			sourceWorkspaceId: access.sourceWorkspaceId,
			sourceNoteId: access.sourceNoteId,
			uploadedByUserId: userId,
			latestVersionNumber: 1,
		},
	});
	try {
		await createDocumentVersion({
			prisma,
			uploadDir,
			noteDocumentId: noteDocument.id,
			versionNumber: 1,
			userId,
			sourcePath,
			byteSize,
			fileName,
			mimeType,
			convertOffice,
		});
	} catch (error) {
		await prisma.noteDocument.delete({ where: { id: noteDocument.id } }).catch(() => undefined);
		throw error;
	}
	return prisma.noteDocument.findUnique({
		where: { id: noteDocument.id },
		include: LATEST_DOCUMENT_VERSION_INCLUDE,
	});
}

async function syncNoteLinks({ prisma, access, userId, links, hydrate = true }) {
	const seeds = [];
	const seen = new Set();
	for (const entry of Array.isArray(links) ? links : []) {
		const seed = buildLinkSeed(entry && typeof entry === 'object' ? entry.url : '', entry && typeof entry === 'object' ? entry.sortOrder : 0);
		if (!seed || seen.has(seed.normalizedUrl)) continue;
		seen.add(seed.normalizedUrl);
		seeds.push(seed);
	}

	const existingRows = await prisma.noteLink.findMany({
		where: {
			docId: access.docId,
		},
		orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
	});
	const existingByUrl = new Map(existingRows.map((row) => [row.normalizedUrl, row]));
	const activeUrls = new Set(seeds.map((seed) => seed.normalizedUrl));

	for (const seed of seeds) {
		const current = existingByUrl.get(seed.normalizedUrl);
		await prisma.noteLink.upsert({
			where: {
				docId_normalizedUrl: {
					docId: access.docId,
					normalizedUrl: seed.normalizedUrl,
				},
			},
			update: {
				sourceWorkspaceId: access.sourceWorkspaceId,
				sourceNoteId: access.sourceNoteId,
				createdByUserId: userId || null,
				originalUrl: seed.originalUrl,
				hostname: seed.hostname,
				rootDomain: seed.rootDomain,
				sortOrder: seed.sortOrder,
				deletedAt: null,
				// Preserve READY and FAILED statuses - resolution was already attempted
				// for both. Only reset to PENDING for truly new rows or rows that were
				// previously soft-deleted (re-added after removal).
				status: current && !current.deletedAt ? current.status : 'PENDING',
				errorMessage: current && !current.deletedAt ? current.errorMessage : null,
			},
			create: {
				docId: access.docId,
				sourceWorkspaceId: access.sourceWorkspaceId,
				sourceNoteId: access.sourceNoteId,
				createdByUserId: userId || null,
				normalizedUrl: seed.normalizedUrl,
				originalUrl: seed.originalUrl,
				hostname: seed.hostname,
				rootDomain: seed.rootDomain,
				sortOrder: seed.sortOrder,
				status: 'PENDING',
			},
		});
	}

	for (const row of existingRows) {
		if (activeUrls.has(row.normalizedUrl) || row.deletedAt) continue;
		await prisma.noteLink.update({
			where: { id: row.id },
			data: { deletedAt: new Date() },
		});
	}

	const rows = await prisma.noteLink.findMany({
		where: {
			docId: access.docId,
			deletedAt: null,
		},
		orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
	});

	if (!hydrate) return rows;
	return hydrateNoteLinkRows(prisma, rows);
}

async function fetchImportUrlBuffer(imageUrl) {
	const response = await fetch(imageUrl, { redirect: 'follow' });
	if (!response.ok) {
		throw new Error(`Image URL request failed (${response.status})`);
	}
	const mimeType = String(response.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
	if (!mimeType.startsWith('image/')) {
		throw new Error('URL did not return an image');
	}
	const contentLength = Number(response.headers.get('content-length') || '0');
	if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_URL_BYTES) {
		throw new Error('Image URL is too large');
	}
	const arrayBuffer = await response.arrayBuffer();
	if (arrayBuffer.byteLength > MAX_IMPORT_URL_BYTES) {
		throw new Error('Image URL is too large');
	}
	return { buffer: Buffer.from(arrayBuffer), mimeType };
}

async function buildAccessibleDocContext(prisma, userId) {
	const [memberships, placements] = await Promise.all([
		prisma.workspaceMember.findMany({
			where: {
				userId,
				workspace: { is: { deletedAt: null } },
			},
			select: {
				workspaceId: true,
				workspace: { select: { name: true, systemKind: true, ownerUserId: true } },
			},
		}),
		prisma.noteSharePlacement.findMany({
			where: {
				userId,
				deletedAt: null,
				collaborator: { revokedAt: null },
			},
			select: {
				id: true,
				targetWorkspaceId: true,
				folderName: true,
				collaborator: {
					select: { docId: true, sourceWorkspaceId: true, sourceNoteId: true },
				},
				invitation: {
					select: { inviter: { select: { name: true, email: true } } },
				},
			},
		}),
	]);

	const docContext = new Map();
	const workspaceIds = memberships.map((membership) => membership.workspaceId);
	for (const membership of memberships) {
		docContext.set(`workspace:${membership.workspaceId}`, {
			kind: membership.workspace.systemKind === 'SHARED_WITH_ME' ? 'shared-workspace' : 'workspace',
			label: normalizeWorkspaceLabel(membership.workspace),
			workspaceId: membership.workspaceId,
			openWorkspaceId: membership.workspaceId,
			openNoteId: null,
			folderName: null,
		});
	}
	for (const placement of placements) {
		const inviter = placement.invitation && placement.invitation.inviter
			? placement.invitation.inviter.name || placement.invitation.inviter.email || 'Shared'
			: 'Shared';
		docContext.set(placement.collaborator.docId, {
			kind: 'shared',
			label: placement.folderName ? `Shared / ${placement.folderName}` : `Shared / ${inviter}`,
			workspaceId: placement.collaborator.sourceWorkspaceId,
			noteId: placement.collaborator.sourceNoteId,
			openWorkspaceId: placement.targetWorkspaceId,
			openNoteId: `shared-placement:${placement.id}`,
			folderName: placement.folderName || null,
		});
	}

	return { docContext, workspaceIds, sharedDocIds: placements.map((placement) => placement.collaborator.docId) };
}

function createNoteMediaRouter({ prisma, uploadDir, onWorkspaceMetadataChanged = null, documentConverter = null }) {
	if (!uploadDir) throw new Error('uploadDir is required');
	void sweepStaleIncomingUploads(path.join(uploadDir, INCOMING_DIR_NAME));

	// Office → PDF only when a Gotenberg container is configured (GOTENBERG_URL). Optional like Redis.
	const converter = documentConverter || createGotenbergConverter({
		url: process.env.GOTENBERG_URL,
		username: process.env.GOTENBERG_USERNAME,
		password: process.env.GOTENBERG_PASSWORD,
	});
	// Real first-page previews for PDFs and converted office files, made in the background.
	const thumbnailQueue = createDocumentThumbnailQueue({
		prisma,
		uploadDir,
		onUpdated: (target) => publishNoteMediaMetadataChange(onWorkspaceMetadataChanged, target, 'note-documents-previewed'),
	});
	const conversionQueue = createDocumentConversionQueue({
		prisma,
		uploadDir,
		converter,
		// The PDF copy of an office file can be huge too; read its text off the main thread.
		extractDocumentText: ({ buffer, extension }) => extractDocumentTextInWorker({ buffer, extension }),
		// Same event as upload/delete, so every device refreshes that note's documents and the
		// background download fetches the new PDF copy. A finished copy also has a first page to show.
		onConverted: (target) => {
			thumbnailQueue.scanSoon();
			return publishNoteMediaMetadataChange(onWorkspaceMetadataChanged, target, 'note-documents-converted');
		},
	});

	// Preferences → Storage asks "is the document converter up?". A short cache (and one shared
	// in-flight check) so a room full of people opening Preferences doesn't hammer Gotenberg.
	const CONVERTER_STATUS_CACHE_MS = 10_000;
	const CONVERTER_STATUS_REFRESH_MIN_MS = 3_000;
	let converterStatus = null;
	let converterStatusCheckedAt = 0;
	let converterStatusInFlight = null;
	function readConverterStatus({ refresh = false } = {}) {
		const age = Date.now() - converterStatusCheckedAt;
		if (converterStatus && age < (refresh ? CONVERTER_STATUS_REFRESH_MIN_MS : CONVERTER_STATUS_CACHE_MS)) {
			return Promise.resolve(converterStatus);
		}
		if (converterStatusInFlight) return converterStatusInFlight;
		converterStatusInFlight = (async () => {
			try {
				const health = converter.enabled ? await converter.checkHealth() : null;
				converterStatus = describeConverterHealth(converter.enabled, health);
				converterStatusCheckedAt = Date.now();
				return converterStatus;
			} finally {
				converterStatusInFlight = null;
			}
		})();
		return converterStatusInFlight;
	}

	const handleRequest = function handleRequest(req, res) {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname;
		const method = String(req.method || 'GET').toUpperCase();

		if (!enforceSameOrigin(req, res)) return true;

		if (pathname === '/api/note-media' && method === 'GET') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const rawDocId = url.searchParams.get('docId');
					const debugTraceId = normalizeMoveDebugTraceId(url.searchParams.get('debugTraceId') || req.headers['x-fn-debug-trace']);
					recordMoveDebugTrace(debugTraceId, 'note-media-request', {
						userId: String(session.userId || ''),
						sessionWorkspaceId: typeof session.workspaceId === 'string' ? session.workspaceId : null,
						rawDocId,
					});
					const accessResult = await ensureMediaAccess(prisma, session, rawDocId, {
						debugTraceId,
						debugContext: 'note-media-list',
					});
					if (accessResult.error) {
						recordMoveDebugTrace(debugTraceId, 'note-media-denied', {
							userId: String(session.userId || ''),
							rawDocId,
							status: accessResult.error.status,
						});
						jsonResponse(res, accessResult.error.status, accessResult.error.body);
						return;
					}
					recordMoveDebugTrace(debugTraceId, 'note-media-access', {
						userId: String(session.userId || ''),
						rawDocId,
						docId: accessResult.access.docId,
						sourceWorkspaceId: accessResult.access.sourceWorkspaceId,
						accessRole: accessResult.access.accessRole,
						canManage: accessResult.access.canManage === true,
						via: accessResult.access.via || null,
					});
					const images = await prisma.noteImage.findMany({
						where: {
							docId: accessResult.access.docId,
							deletedAt: null,
							assetStatus: 'READY',
						},
						orderBy: { createdAt: 'asc' },
					});
					recordMoveDebugTrace(debugTraceId, 'note-media-response', {
						docId: accessResult.access.docId,
						count: images.length,
					});
					jsonResponse(res, 200, { images: images.map(mapNoteImage), count: images.length });
				} catch (err) {
					console.error('[note-media] list error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		if (pathname === '/api/note-links' && method === 'GET') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const accessResult = await ensureMediaAccess(prisma, session, url.searchParams.get('docId'));
					if (accessResult.error) {
						jsonResponse(res, accessResult.error.status, accessResult.error.body);
						return;
					}
					const links = await prisma.noteLink.findMany({
						where: {
							docId: accessResult.access.docId,
							deletedAt: null,
						},
						orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
					});
					// Return the current DB state directly — background hydration (triggered
					// by the sync POST and deduped by activeHydrations) is the sole mechanism
					// for URL resolution. Inline GET hydration was removed because running
					// concurrent URL fetches from every client retry caused rate-limiting.
					jsonResponse(res, 200, { links: links.map(mapNoteLink), count: links.length });
				} catch (err) {
					console.error('[note-links] list error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		if (pathname === '/api/note-documents' && method === 'GET') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const accessResult = await ensureMediaAccess(prisma, session, url.searchParams.get('docId'));
					if (accessResult.error) {
						jsonResponse(res, accessResult.error.status, accessResult.error.body);
						return;
					}
					const rows = await prisma.noteDocument.findMany({
						where: {
							docId: accessResult.access.docId,
							deletedAt: null,
						},
						orderBy: { createdAt: 'asc' },
						include: LATEST_DOCUMENT_VERSION_INCLUDE,
					});
					const documents = rows.map(mapNoteDocument).filter(Boolean);
					jsonResponse(res, 200, { documents, count: documents.length });
				} catch (err) {
					console.error('[note-documents] list error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// Every document this user can see, so each device can keep a copy (plan D3).
		if (pathname === '/api/note-documents/manifest' && method === 'GET') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const { workspaceIds, sharedDocIds } = await buildAccessibleDocContext(prisma, session.userId);
					const manifest = await listManifestDocuments({
						prisma,
						workspaceIds,
						sharedDocIds,
						include: LATEST_DOCUMENT_VERSION_INCLUDE,
						mapDocument: mapNoteDocument,
					});
					// Devices decide what to download and delete from this. A service-worker copy
					// from an hour ago would be worse than no answer at all.
					res.setHeader('Cache-Control', 'no-store');
					jsonResponse(res, 200, manifest);
				} catch (err) {
					console.error('[note-documents] manifest error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		if (pathname === '/api/note-links/failures' && method === 'GET') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const { docContext, workspaceIds, sharedDocIds } = await buildAccessibleDocContext(prisma, session.userId);
					const docWhere = [];
					if (workspaceIds.length > 0) docWhere.push({ workspaceId: { in: workspaceIds } });
					if (sharedDocIds.length > 0) docWhere.push({ docId: { in: sharedDocIds } });
					if (docWhere.length === 0) {
						jsonResponse(res, 200, { failures: [], count: 0 });
						return;
					}
					const docs = await prisma.document.findMany({
						where: { OR: docWhere },
						select: { docId: true, workspaceId: true, state: true },
					});
					const docIds = docs.map((doc) => doc.docId);
					const failedLinks = docIds.length > 0 ? await prisma.noteLink.findMany({
						where: {
							docId: { in: docIds },
							deletedAt: null,
							status: 'FAILED',
						},
						orderBy: [{ updatedAt: 'desc' }, { sortOrder: 'asc' }],
					}) : [];
					const titleByDocId = new Map();
					for (const doc of docs) {
						const snapshot = decodeDocumentState(doc.state);
						titleByDocId.set(doc.docId, snapshot.title || '(untitled)');
					}
					const failures = failedLinks.map((link) => {
						const context = docContext.get(link.docId) || docs.find((doc) => doc.docId === link.docId);
						const fallbackWorkspaceId = context && typeof context === 'object' && 'workspaceId' in context ? context.workspaceId : null;
						const noteId = context && typeof context === 'object' && 'noteId' in context && context.noteId
							? context.noteId
							: (String(link.docId).includes(':') ? String(link.docId).split(':').slice(1).join(':') : link.docId);
						return {
							id: link.id,
							docId: link.docId,
							noteId,
							noteTitle: titleByDocId.get(link.docId) || '(untitled)',
							originalUrl: link.originalUrl,
							rootDomain: link.rootDomain,
							errorMessage: link.errorMessage || 'Link preview resolution failed',
							updatedAt: link.updatedAt.toISOString(),
							openWorkspaceId: context && typeof context === 'object' && 'openWorkspaceId' in context ? context.openWorkspaceId || fallbackWorkspaceId : fallbackWorkspaceId,
							openNoteId: context && typeof context === 'object' && 'openNoteId' in context ? context.openNoteId || noteId : noteId,
							folderName: context && typeof context === 'object' && 'folderName' in context ? context.folderName || null : null,
						};
					});
					jsonResponse(res, 200, { failures, count: failures.length });
				} catch (err) {
					console.error('[note-links] failures error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		if (pathname === '/api/note-links/sync' && method === 'POST') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const body = await readJsonBody(req);
					if (!body || typeof body !== 'object') {
						jsonResponse(res, 400, { error: 'Request body must be a JSON object' });
						return;
					}
					const accessResult = await ensureMediaAccess(prisma, session, body.docId, { requireEdit: true });
					if (accessResult.error) {
						jsonResponse(res, accessResult.error.status, accessResult.error.body);
						return;
					}
					// Upsert link rows immediately (fast – no URL fetching) and
					// respond so the client can show the placeholder right away.
					const pendingRows = await syncNoteLinks({
						prisma,
						access: accessResult.access,
						userId: session.userId,
						links: Array.isArray(body.links) ? body.links : [],
						hydrate: false,
					});
					await publishNoteMediaMetadataChange(onWorkspaceMetadataChanged, accessResult.access, 'note-links-updated');
					jsonResponse(res, 200, { links: pendingRows.map(mapNoteLink), count: pendingRows.length });
					// Resolve URL metadata in the background. When hydration
					// finishes, emit a second event so all clients refresh and
					// replace placeholders with real preview data.
					// activeHydrations prevents multiple concurrent URL fetches for the same
					// doc when Yjs fires many afterTransaction events on reconnect.
					const hydrationDocId = accessResult.access.docId;
					if (pendingRows.some(noteLinkNeedsResolution) && !activeHydrations.has(hydrationDocId)) {
						activeHydrations.add(hydrationDocId);
						setImmediate(async () => {
							try {
								const hydratedRows = await hydrateNoteLinkRows(prisma, pendingRows);
								// hydrateNoteLinkRows returns the original array reference when
								// nothing changed; a new array means at least one row was mutated.
								if (hydratedRows !== pendingRows) {
									await publishNoteMediaMetadataChange(onWorkspaceMetadataChanged, accessResult.access, 'note-links-updated');
								}
							} catch (err) {
								console.error('[note-links] background hydration error:', err && err.message ? err.message : String(err));
							} finally {
								activeHydrations.delete(hydrationDocId);
							}
						});
					}
				} catch (err) {
					console.error('[note-links] sync error:', err.message);
					jsonResponse(res, 400, { error: err.message || 'Link sync failed' });
				}
			})();
			return true;
		}

		if (pathname === '/api/note-links/flush-orphaned' && method === 'POST') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const { userId } = session;

					// Find all active (non-deleted) NoteLink rows the user created.
					const activeLinks = await prisma.noteLink.findMany({
						where: { createdByUserId: userId, deletedAt: null },
						select: { id: true, docId: true, normalizedUrl: true },
					});

					if (activeLinks.length === 0) {
						jsonResponse(res, 200, { removed: 0 });
						return;
					}

					// Group by docId so we read each Yjs doc at most once.
					const byDocId = new Map();
					for (const link of activeLinks) {
						if (!byDocId.has(link.docId)) byDocId.set(link.docId, []);
						byDocId.get(link.docId).push(link);
					}

					const orphanIds = [];

					for (const [docId, links] of byDocId) {
						let yjsUrls = null;
						try {
							const row = await prisma.document.findUnique({
								where: { docId },
								select: { state: true },
							});
							if (row && row.state) {
								const decoded = decodeDocumentState(row.state);
								const raw = decoded.metadata && Array.isArray(decoded.metadata.urlPreviewLinks)
									? decoded.metadata.urlPreviewLinks
									: [];
								// Normalize the Yjs URL list the same way the client does.
								yjsUrls = new Set(
									raw
										.map((v) => {
											if (typeof v !== 'string') return null;
											const trimmed = v.trim();
											if (!trimmed) return null;
											try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`).toString().replace(/#.*$/, ''); }
											catch { return null; }
										})
										.filter(Boolean)
								);
							}
						} catch {
							// If the doc can't be decoded, skip it rather than deleting everything.
							continue;
						}

						// If the Yjs doc has no urlPreviewLinks at all (empty array or
						// missing field), every NoteLink row for this doc is orphaned.
						// If the doc couldn't be read (yjsUrls still null), skip.
						if (yjsUrls === null) continue;

						for (const link of links) {
							if (!yjsUrls.has(link.normalizedUrl)) {
								orphanIds.push(link.id);
							}
						}
					}

					if (orphanIds.length > 0) {
						await prisma.noteLink.updateMany({
							where: { id: { in: orphanIds } },
							data: { deletedAt: new Date() },
						});
					}

					console.log(`[note-links] flush-orphaned: removed ${orphanIds.length} of ${activeLinks.length} links for userId=${userId}`);
					jsonResponse(res, 200, { removed: orphanIds.length, checked: activeLinks.length });
				} catch (err) {
					console.error('[note-links] flush-orphaned error:', err.message);
					jsonResponse(res, 500, { error: 'Flush failed' });
				}
			})();
			return true;
		}

		if (pathname === '/api/note-media/import-url' && method === 'POST') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const body = await readJsonBody(req);
					if (!body || typeof body !== 'object') {
						jsonResponse(res, 400, { error: 'Request body must be a JSON object' });
						return;
					}
					const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
					if (!imageUrl) {
						jsonResponse(res, 400, { error: 'imageUrl is required' });
						return;
					}
					const accessResult = await ensureMediaAccess(prisma, session, body.docId, { requireEdit: true });
					if (accessResult.error) {
						jsonResponse(res, accessResult.error.status, accessResult.error.body);
						return;
					}
					const imported = await fetchImportUrlBuffer(imageUrl);
					const image = await persistImageRecord({
						prisma,
						uploadDir,
						access: accessResult.access,
						userId: session.userId,
						sourceBuffer: imported.buffer,
						mimeType: imported.mimeType,
						fileName: imageUrl,
						sourceUrl: imageUrl,
					});
					await publishNoteMediaMetadataChange(onWorkspaceMetadataChanged, accessResult.access, 'note-media-created');
					jsonResponse(res, 201, { image: mapNoteImage(image) });
				} catch (err) {
					console.error('[note-media] import-url error:', err.message);
					jsonResponse(res, 400, { error: err.message || 'Image import failed' });
				}
			})();
			return true;
		}

		if (pathname === '/api/note-media' && method === 'POST') {
			const session = requireAuth(req, res);
			if (!session) return true;

			const bb = Busboy({
				headers: req.headers,
				limits: { files: MAX_FILES_PER_UPLOAD, fileSize: MAX_SOURCE_FILE_BYTES, fields: 8 },
			});

			let docId = '';
			let fileError = null;
			const files = [];

			bb.on('field', (name, value) => {
				if (name === 'docId') docId = String(value || '').trim();
			});

			bb.on('file', (_fieldname, file, info) => {
				const mimeType = String(info.mimeType || '').toLowerCase();
				if (!mimeType.startsWith('image/')) {
					fileError = 'Unsupported file type';
					file.resume();
					return;
				}
				const chunks = [];
				file.on('data', (chunk) => chunks.push(chunk));
				file.on('limit', () => {
					fileError = 'File too large';
				});
				file.on('end', () => {
					if (!fileError) {
						files.push({
							mimeType,
							fileName: String(info.filename || ''),
							buffer: Buffer.concat(chunks),
						});
					}
				});
			});

			bb.on('error', (err) => {
				fileError = err.message || 'Upload failed';
			});

			bb.on('finish', async () => {
				try {
					if (!docId) {
						jsonResponse(res, 400, { error: 'docId is required' });
						return;
					}
					if (fileError) {
						jsonResponse(res, fileError === 'File too large' ? 413 : 400, { error: fileError });
						return;
					}
					if (files.length === 0) {
						jsonResponse(res, 400, { error: 'No files uploaded' });
						return;
					}
					const accessResult = await ensureMediaAccess(prisma, session, docId, { requireEdit: true });
					if (accessResult.error) {
						jsonResponse(res, accessResult.error.status, accessResult.error.body);
						return;
					}
					const images = [];
					for (const entry of files) {
						const image = await persistImageRecord({
							prisma,
							uploadDir,
							access: accessResult.access,
							userId: session.userId,
							sourceBuffer: entry.buffer,
							mimeType: entry.mimeType,
							fileName: entry.fileName,
						});
						images.push(mapNoteImage(image));
					}
					await publishNoteMediaMetadataChange(onWorkspaceMetadataChanged, accessResult.access, 'note-media-created');
					jsonResponse(res, 201, { images, count: images.length });
				} catch (err) {
					console.error('[note-media] upload error:', err.message);
					jsonResponse(res, 400, { error: err.message || 'Upload failed' });
				}
			});

			req.pipe(bb);
			return true;
		}

		if (pathname === '/api/note-documents' && method === 'POST') {
			const session = requireAuth(req, res);
			if (!session) return true;

			// Each file streams straight to disk as it arrives. Buffering it meant a 250 MB print set
			// was 250 MB of server memory (twice over, briefly, while the pieces were joined).
			const incomingDir = path.join(uploadDir, INCOMING_DIR_NAME);
			try {
				fs.mkdirSync(incomingDir, { recursive: true });
			} catch (err) {
				console.error('[note-documents] cannot create the incoming upload folder:', err.message);
				jsonResponse(res, 500, { error: 'Upload failed' });
				return true;
			}

			const bb = Busboy({
				headers: req.headers,
				limits: { files: MAX_FILES_PER_UPLOAD, fileSize: MAX_DOCUMENT_FILE_BYTES, fields: 8 },
			});

			let docId = '';
			let fileError = null;
			let responded = false;
			const files = [];
			// One per file: settles once that file is completely on disk and its handle is closed
			// (Windows won't move a file that's still open).
			const writes = [];
			const removeIncoming = () => Promise.all(files.map((entry) => fs.promises.rm(entry.tempPath, { force: true }).catch(() => undefined)));
			const respond = (status, body) => {
				if (responded) return;
				responded = true;
				jsonResponse(res, status, body);
			};

			bb.on('field', (name, value) => {
				if (name === 'docId') docId = String(value || '').trim();
			});

			bb.on('file', (_fieldname, file, info) => {
				const mimeType = String(info.mimeType || '').toLowerCase();
				const fileName = String(info.filename || '').trim() || 'document';
				if (!isSupportedNoteDocument(fileName, mimeType)) {
					fileError = 'Unsupported document type';
					file.resume();
					return;
				}
				const entry = { fileName, mimeType, tempPath: path.join(incomingDir, `${crypto.randomUUID()}.part`), byteSize: 0 };
				files.push(entry);
				writes.push(new Promise((resolve) => {
					const out = fs.createWriteStream(entry.tempPath);
					file.on('data', (chunk) => {
						entry.byteSize += chunk.length;
					});
					file.on('limit', () => {
						fileError = 'File too large';
					});
					out.on('close', resolve);
					out.on('error', (err) => {
						fileError = fileError || err.message || 'Upload failed';
						file.unpipe(out);
						file.resume();
						resolve();
					});
					file.pipe(out);
				}));
			});

			// Signal lost or the tab closed mid-upload: the form never finishes, so tidy up after it.
			req.on('close', () => {
				if (req.complete) return;
				void Promise.all(writes).then(removeIncoming);
			});

			bb.on('error', (err) => {
				fileError = err.message || 'Upload failed';
				void Promise.all(writes).then(removeIncoming).then(() => respond(400, { error: fileError }));
			});

			bb.on('finish', async () => {
				try {
					// Busboy has read the whole form; wait for every file to finish reaching the disk too.
					await Promise.all(writes);
					if (!docId) {
						respond(400, { error: 'docId is required' });
						return;
					}
					if (fileError) {
						respond(fileError === 'File too large' ? 413 : 400, { error: fileError });
						return;
					}
					if (files.length === 0) {
						respond(400, { error: 'No files uploaded' });
						return;
					}
					const accessResult = await ensureMediaAccess(prisma, session, docId, { requireEdit: true });
					if (accessResult.error) {
						respond(accessResult.error.status, accessResult.error.body);
						return;
					}
					const documents = [];
					for (const entry of files) {
						const documentRecord = await persistDocumentRecord({
							prisma,
							uploadDir,
							access: accessResult.access,
							userId: session.userId,
							sourcePath: entry.tempPath,
							byteSize: entry.byteSize,
							fileName: entry.fileName,
							convertOffice: conversionQueue.enabled,
							mimeType: entry.mimeType,
						});
						const mapped = mapNoteDocument(documentRecord);
						if (mapped) documents.push(mapped);
					}
					await publishNoteMediaMetadataChange(onWorkspaceMetadataChanged, accessResult.access, 'note-documents-created');
					conversionQueue.notify();
					thumbnailQueue.scanSoon();
					respond(201, { documents, count: documents.length });
				} catch (err) {
					console.error('[note-documents] upload error:', err.message);
					respond(400, { error: err.message || 'Upload failed' });
				} finally {
					// Files that made it were moved out already; this clears whatever didn't.
					await removeIncoming();
				}
			});

			req.pipe(bb);
			return true;
		}

		const deleteMatch = pathname.match(/^\/api\/note-media\/([^/]+)$/);
		if (deleteMatch && method === 'DELETE') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const imageId = decodeURIComponent(deleteMatch[1]);
					const image = await prisma.noteImage.findUnique({ where: { id: imageId } });
					if (!image || image.deletedAt) {
						jsonResponse(res, 404, { error: 'Image not found' });
						return;
					}
					const accessResult = await ensureMediaAccess(prisma, session, image.docId, { requireEdit: true });
					if (accessResult.error) {
						jsonResponse(res, accessResult.error.status, accessResult.error.body);
						return;
					}
					await prisma.noteImage.update({
						where: { id: image.id },
						data: {
							deletedAt: new Date(),
							assetStatus: 'DELETED',
						},
					});
					await Promise.allSettled([
						fs.promises.rm(path.join(uploadDir, image.originalPath), { force: true }),
						fs.promises.rm(path.join(uploadDir, image.thumbnailPath), { force: true }),
					]);
					await publishNoteMediaMetadataChange(onWorkspaceMetadataChanged, accessResult.access, 'note-media-deleted');
					jsonResponse(res, 200, { ok: true, imageId: image.id });
				} catch (err) {
					console.error('[note-media] delete error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		const deleteDocumentMatch = pathname.match(/^\/api\/note-documents\/([^/]+)$/);
		if (deleteDocumentMatch && method === 'DELETE') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const documentId = decodeURIComponent(deleteDocumentMatch[1]);
					const noteDocument = await prisma.noteDocument.findUnique({
					where: { id: documentId },
					include: { versions: { where: { deletedAt: null } } },
				});
					if (!noteDocument || noteDocument.deletedAt) {
						jsonResponse(res, 404, { error: 'Document not found' });
						return;
					}
					const accessResult = await ensureMediaAccess(prisma, session, noteDocument.docId, { requireEdit: true });
					if (accessResult.error) {
						jsonResponse(res, accessResult.error.status, accessResult.error.body);
						return;
					}
					const deletedAt = new Date();
					await prisma.$transaction([
						prisma.noteDocumentVersion.updateMany({
							where: { noteDocumentId: noteDocument.id, deletedAt: null },
							data: { deletedAt },
						}),
						prisma.noteDocument.update({
							where: { id: noteDocument.id },
							data: { deletedAt },
						}),
					]);
					// Deleting the document takes every version with it. Stage 5 adds deleting a
					// single old version; this route is the "remove it from the note" button.
					await Promise.allSettled(noteDocument.versions.flatMap((version) => [
						version.originalPath,
						version.previewPath,
						version.thumbnailPath,
						version.viewPdfPath,
					].filter(Boolean).map((relativePath) => fs.promises.rm(path.join(uploadDir, relativePath), { force: true }))));
					await publishNoteMediaMetadataChange(onWorkspaceMetadataChanged, accessResult.access, 'note-documents-deleted');
					jsonResponse(res, 200, { ok: true, documentId: noteDocument.id });
				} catch (err) {
					console.error('[note-documents] delete error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		if (pathname === '/api/document-conversion/status' && method === 'GET') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const status = await readConverterStatus({ refresh: url.searchParams.get('refresh') === '1' });
					res.setHeader('Cache-Control', 'no-store');
					jsonResponse(res, 200, status);
				} catch (err) {
					console.error('[converter] status check error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		if (pathname === '/api/config' && method === 'GET') {
			const session = requireAuth(req, res);
			if (!session) return true;
			jsonResponse(res, 200, {
				imageCaptureMaxDimensionPx: IMAGE_CAPTURE_MAX_DIMENSION_PX,
				imageCaptureJpegQuality: IMAGE_CAPTURE_JPEG_QUALITY,
				documentUploadMaxBytes: MAX_DOCUMENT_FILE_BYTES,
				// Whether office files will get a PDF copy (Gotenberg configured). Clients use it to
				// choose between "preparing PDF" and the text view.
				documentConversion: conversionQueue.enabled,
			});
			return true;
		}

		if (pathname === '/api/search' && method === 'GET') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const query = normalizeText(url.searchParams.get('q') || '');
					if (!query) {
						jsonResponse(res, 200, { query: '', results: [], count: 0 });
						return;
					}

					const { docContext, workspaceIds, sharedDocIds } = await buildAccessibleDocContext(prisma, session.userId);
					const docWhere = [];
					if (workspaceIds.length > 0) docWhere.push({ workspaceId: { in: workspaceIds } });
					if (sharedDocIds.length > 0) docWhere.push({ docId: { in: sharedDocIds } });
					if (docWhere.length === 0) {
						jsonResponse(res, 200, { query, results: [], count: 0 });
						return;
					}

					const docs = await prisma.document.findMany({
						where: { OR: docWhere },
						select: { docId: true, workspaceId: true, updatedAt: true, state: true },
						orderBy: { updatedAt: 'desc' },
					});
					const docIds = docs.map((doc) => doc.docId);
					// Run all auxiliary queries in parallel — they are independent of each
					// other and only depend on the docIds list resolved above.
					const [noteImages, noteCollaborators, noteLinks, noteDocuments, pendingInvitations] = await Promise.all([
						prisma.noteImage.findMany({
							where: {
								docId: { in: docIds },
								deletedAt: null,
								assetStatus: 'READY',
							},
							select: {
								docId: true,
								fileName: true,
								ocrText: true,
								thumbnailPath: true,
							},
						}),
						prisma.noteCollaborator.findMany({
							where: {
								docId: { in: docIds },
								revokedAt: null,
							},
							select: {
								docId: true,
								user: {
									select: {
										name: true,
										email: true,
									},
								},
							},
						}),
						prisma.noteLink.findMany({
							where: {
								docId: { in: docIds },
								deletedAt: null,
							},
							select: {
								docId: true,
								originalUrl: true,
								rootDomain: true,
								hostname: true,
								siteName: true,
								title: true,
								description: true,
								mainContent: true,
								imageUrl: true,
							},
						}),
						prisma.noteDocument.findMany({
							where: {
								docId: { in: docIds },
								deletedAt: null,
							},
							select: {
								docId: true,
								// Search looks at the latest version only; older versions are history.
								versions: {
									where: { deletedAt: null },
									orderBy: { versionNumber: 'desc' },
									take: 1,
									select: {
										fileName: true,
										fileExtension: true,
										ocrText: true,
										thumbnailPath: true,
									},
								},
							},
						}),
						prisma.noteShareInvitation.findMany({
							where: {
								docId: { in: docIds },
								status: 'PENDING',
								revokedAt: null,
							},
							select: {
								docId: true,
								inviteeName: true,
								inviteeEmail: true,
							},
						}),
					]);
					const imagesByDocId = new Map();
					for (const image of noteImages) {
						const next = imagesByDocId.get(image.docId) || [];
						next.push(image);
						imagesByDocId.set(image.docId, next);
					}
					const collaboratorsByDocId = new Map();
					const linksByDocId = new Map();
					const documentsByDocId = new Map();
					const collectionPathsByWorkspaceId = new Map();
					const labelNamesByWorkspaceId = new Map();
					// Decode the per-workspace metadata registries once so note-level search can
					// match human-readable collection paths and label names without extra queries.
					for (const row of docs) {
						if (!row.state) continue;
						if (row.docId === COLLECTIONS_REGISTRY_DOC_ID || String(row.docId).endsWith(`:${COLLECTIONS_REGISTRY_DOC_ID}`)) {
							collectionPathsByWorkspaceId.set(row.workspaceId, decodeCollectionRegistryState(row.state));
						}
						if (row.docId === LABELS_REGISTRY_DOC_ID || String(row.docId).endsWith(`:${LABELS_REGISTRY_DOC_ID}`)) {
							labelNamesByWorkspaceId.set(row.workspaceId, decodeLabelRegistryState(row.state));
						}
					}
					for (const collaborator of noteCollaborators) {
						const label = formatCollaboratorLabel(collaborator.user);
						if (!label) continue;
						const next = collaboratorsByDocId.get(collaborator.docId) || [];
						if (!next.includes(label)) next.push(label);
						collaboratorsByDocId.set(collaborator.docId, next);
					}
					for (const invitation of pendingInvitations) {
						const name = typeof invitation.inviteeName === 'string' ? invitation.inviteeName.trim() : '';
						const email = typeof invitation.inviteeEmail === 'string' ? invitation.inviteeEmail.trim() : '';
						const label = name && email && name.toLowerCase() !== email.toLowerCase()
							? `${name} <${email}>`
							: name || email;
						if (!label) continue;
						const next = collaboratorsByDocId.get(invitation.docId) || [];
						if (!next.includes(label)) next.push(label);
						collaboratorsByDocId.set(invitation.docId, next);
					}
					for (const link of noteLinks) {
						const next = linksByDocId.get(link.docId) || [];
						next.push(link);
						linksByDocId.set(link.docId, next);
					}
					for (const noteDocument of noteDocuments) {
						const latest = noteDocument.versions && noteDocument.versions[0];
						if (!latest) continue;
						const next = documentsByDocId.get(noteDocument.docId) || [];
						next.push({ docId: noteDocument.docId, ...latest });
						documentsByDocId.set(noteDocument.docId, next);
					}
					const normalizedQuery = query.toLowerCase();
					const results = [];
					for (const row of docs) {
						if (
							!row.state ||
							row.docId === '__notes_registry__' ||
							row.docId.endsWith(':__notes_registry__') ||
							row.docId === COLLECTIONS_REGISTRY_DOC_ID ||
							row.docId.endsWith(`:${COLLECTIONS_REGISTRY_DOC_ID}`) ||
							row.docId === LABELS_REGISTRY_DOC_ID ||
							row.docId.endsWith(`:${LABELS_REGISTRY_DOC_ID}`)
						) continue;
						const snapshot = decodeDocumentState(row.state);
						if (snapshot.trashed) continue;
						const collectionPathById = collectionPathsByWorkspaceId.get(row.workspaceId) || new Map();
						const labelNamesById = labelNamesByWorkspaceId.get(row.workspaceId) || new Map();
						const collectionPath = snapshot.metadata && typeof snapshot.metadata.collectionId === 'string'
							? collectionPathById.get(String(snapshot.metadata.collectionId).trim()) || ''
							: '';
						const labelMatches = Array.isArray(snapshot.metadata && snapshot.metadata.labelIds)
							? snapshot.metadata.labelIds
								.map((labelId) => (typeof labelId === 'string' ? labelNamesById.get(labelId.trim()) || '' : ''))
								.filter((labelName) => labelName && labelName.toLowerCase().includes(normalizedQuery))
							: [];
						const imageRows = imagesByDocId.get(row.docId) || [];
						const collaboratorLabels = collaboratorsByDocId.get(row.docId) || [];
						const linkRows = linksByDocId.get(row.docId) || [];
						const documentRows = documentsByDocId.get(row.docId) || [];
						const ocrText = normalizeText(imageRows.map((image) => image.ocrText || '').join(' '));
						// The name the user gave an image in the upload dialog (defaults to
						// "image 1" etc., but the whole point of letting them rename it there
						// is so they can find it again by that name) — kept separate from OCR
						// text so a filename match doesn't show a misleading "OCR" badge.
						const imageNameText = normalizeText(imageRows.map((image) => image.fileName || '').join(' '));
						const collaboratorText = normalizeText(collaboratorLabels.join(' '));
						const linkText = normalizeText(linkRows.map((link) => [
							link.originalUrl,
							link.rootDomain,
							link.hostname,
							link.siteName,
							link.title,
							link.description,
							link.mainContent,
						].filter(Boolean).join(' ')).join(' '));
						const documentText = normalizeText(documentRows.map((document) => [document.fileName, document.fileExtension, document.ocrText].filter(Boolean).join(' ')).join(' '));
						const noteMatch = snapshot.plainText.toLowerCase().includes(normalizedQuery);
						const ocrMatch = ocrText.toLowerCase().includes(normalizedQuery);
						const imageNameMatch = imageNameText.toLowerCase().includes(normalizedQuery);
						const collaboratorMatches = collaboratorLabels.filter((label) => label.toLowerCase().includes(normalizedQuery));
						const collaboratorMatch = collaboratorMatches.length > 0;
						const linkMatch = linkText.toLowerCase().includes(normalizedQuery);
						const documentMatch = documentText.toLowerCase().includes(normalizedQuery);
						const collectionMatch = collectionPath.toLowerCase().includes(normalizedQuery);
						const labelMatch = labelMatches.length > 0;
						if (!noteMatch && !ocrMatch && !imageNameMatch && !collaboratorMatch && !linkMatch && !documentMatch && !collectionMatch && !labelMatch) continue;
						const context = docContext.get(row.docId) || docContext.get(`workspace:${row.workspaceId}`) || {
							kind: 'workspace',
							label: 'Workspace',
							workspaceId: row.workspaceId,
							openWorkspaceId: row.workspaceId,
							openNoteId: null,
							folderName: null,
						};
						const noteId = context.noteId || (String(row.docId).includes(':') ? String(row.docId).split(':').slice(1).join(':') : row.docId);
						const matchKinds = [];
						if (noteMatch) matchKinds.push('note');
						if (ocrMatch) matchKinds.push('ocr');
						if (imageNameMatch) matchKinds.push('imageName');
						if (collaboratorMatch) matchKinds.push('collaborator');
						if (linkMatch) matchKinds.push('link');
						if (documentMatch) matchKinds.push('document');
						if (collectionMatch) matchKinds.push('collection');
						if (labelMatch) matchKinds.push('label');
						const linkSnippetSource = linkRows.map((link) => [
							link.title,
							link.description,
							link.mainContent,
							link.rootDomain,
							link.originalUrl,
						].filter(Boolean).join(' ')).join(' ');
						const documentSnippetSource = documentRows.map((document) => [
							document.fileName,
							document.ocrText,
						].filter(Boolean).join(' ')).join(' ');
						results.push({
							docId: row.docId,
							noteId,
							title: snapshot.title || '(untitled)',
							archived: snapshot.archived,
							group: {
								kind: context.kind,
								label: context.label,
								workspaceId: context.workspaceId,
							},
							matchKinds,
							collaboratorMatches: collaboratorMatches.slice(0, 3),
							collectionMatches: collectionMatch ? [collectionPath] : [],
							labelMatches: labelMatches.slice(0, 4),
							snippet: noteMatch
								? buildSearchSnippet(snapshot.plainText, query)
								: ocrMatch
									? buildSearchSnippet(ocrText, query)
									: imageNameMatch
										? buildSearchSnippet(imageNameText, query)
										: collaboratorMatch
											? buildSearchSnippet(collaboratorText, query)
											: linkMatch
												? buildSearchSnippet(linkSnippetSource, query)
												: collectionMatch
													? buildSearchSnippet(collectionPath, query)
													: labelMatch
														? buildSearchSnippet(labelMatches.join(' '), query)
												: buildSearchSnippet(documentSnippetSource, query),
							imageCount: imageRows.length,
							thumbnailUrl: imageRows[0]
								? toPublicUploadPath(imageRows[0].thumbnailPath)
								: documentRows[0]
									? toPublicUploadPath(documentRows[0].thumbnailPath)
									: (linkRows[0]?.imageUrl || null),
							updatedAt: row.updatedAt.toISOString(),
							openWorkspaceId: context.openWorkspaceId || context.workspaceId || null,
							openNoteId: context.openNoteId || noteId,
							folderName: context.folderName || null,
						});
					}
					jsonResponse(res, 200, { query, results, count: results.length });
				} catch (err) {
					console.error('[note-media] search error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		return false;
	};
	// Started by server.js once the database is ready, and stopped on shutdown.
	handleRequest.startBackgroundWork = () => Promise.all([conversionQueue.start(), thumbnailQueue.start()]);
	handleRequest.stop = () => {
		conversionQueue.stop();
		thumbnailQueue.stop();
	};
	return handleRequest;
}

module.exports = {
	createNoteMediaRouter,
};