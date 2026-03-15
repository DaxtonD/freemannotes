'use strict';

const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');
const sharp = require('sharp');
const { enforceSameOrigin } = require('./auth');
const {
	buildDocumentViewerHtml,
	createDocumentPreviewBuffers,
	extractDocumentText,
	getNormalizedDocumentExtension,
	isSupportedNoteDocument,
	sanitizeBaseName,
} = require('./noteDocumentPreview');
const { buildLinkSeed, isLikelyBadPreviewImageUrl, resolveNoteLinkPreview } = require('./noteLinkPreview');
const { resolveDocAccess } = require('./noteShareRouter');
const { buildSearchSnippet, decodeDocumentState, normalizeText } = require('./noteSnapshot');
const { queueNoteImageOcr } = require('./ocr');

const MAX_FILES_PER_UPLOAD = 12;
const MAX_SOURCE_FILE_BYTES = 32 * 1024 * 1024;
const MAX_DOCUMENT_FILE_BYTES = 40 * 1024 * 1024;
const MAX_COMPRESSED_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_URL_BYTES = 32 * 1024 * 1024;
const THUMB_SIZE_PX = 360;
const LEGACY_PERSONAL_NAME_RE = /^Personal \([0-9a-f-]{36}\)$/i;
const LEGACY_SHARED_WITH_ME_NAME_RE = /^Shared With Me \([0-9a-f-]{36}\)$/i;

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

async function ensureMediaAccess(prisma, session, rawDocId, { requireEdit = false } = {}) {
	const access = await resolveDocAccess(prisma, session, rawDocId);
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
					.resize(THUMB_SIZE_PX, THUMB_SIZE_PX, { fit: 'cover' })
					.webp({ quality: 72 })
					.toBuffer();
				return {
					original: candidate,
					thumbnail,
					width: Number(metadata.width || 0) || null,
					height: Number(metadata.height || 0) || null,
					thumbnailWidth: THUMB_SIZE_PX,
					thumbnailHeight: THUMB_SIZE_PX,
				};
			}
		}
	}

	throw new Error('Unable to compress image under 5 MB');
}

async function persistImageRecord({ prisma, uploadDir, access, userId, sourceBuffer, mimeType, sourceUrl = null }) {
	const compressed = await compressImage(sourceBuffer);
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

function mapNoteDocument(document) {
	const viewerRelativePath = getNoteDocumentViewerRelativePath(document);
	return {
		id: document.id,
		docId: document.docId,
		sourceWorkspaceId: document.sourceWorkspaceId,
		sourceNoteId: document.sourceNoteId,
		fileName: document.fileName,
		fileExtension: document.fileExtension,
		mimeType: document.mimeType,
		byteSize: document.byteSize,
		pageCount: document.pageCount,
		previewWidth: document.previewWidth,
		previewHeight: document.previewHeight,
		thumbnailWidth: document.thumbnailWidth,
		thumbnailHeight: document.thumbnailHeight,
		ocrStatus: document.ocrStatus,
		ocrText: document.ocrText || '',
		ocrError: document.ocrError || null,
		createdAt: document.createdAt.toISOString(),
		updatedAt: document.updatedAt.toISOString(),
		originalUrl: toPublicUploadPath(document.originalPath),
		previewUrl: toPublicUploadPath(document.previewPath),
		thumbnailUrl: toPublicUploadPath(document.thumbnailPath),
		viewerUrl: toPublicUploadPath(viewerRelativePath),
	};
}

function getNoteDocumentViewerRelativePath(document) {
	return path.join(path.dirname(document.originalPath), 'viewer.html').replace(/\\/g, '/');
}

async function ensureNoteDocumentViewerFile({ uploadDir, document }) {
	if (!document || !document.originalPath) return;
	if (String(document.mimeType || '').toLowerCase() === 'application/pdf') return;
	const viewerRelativePath = getNoteDocumentViewerRelativePath(document);
	const absoluteViewerPath = path.join(uploadDir, viewerRelativePath);
	try {
		await fs.promises.access(absoluteViewerPath, fs.constants.F_OK);
		return;
	} catch {
		// Missing viewer file; regenerate it from the stored original.
	}

	const absoluteOriginalPath = path.join(uploadDir, document.originalPath);
	const sourceBuffer = await fs.promises.readFile(absoluteOriginalPath);
	const viewerHtml = await buildDocumentViewerHtml({
		buffer: sourceBuffer,
		extension: document.fileExtension,
		sourcePath: absoluteOriginalPath,
		fileName: document.fileName,
		extractedText: document.ocrText || '',
	});
	await fs.promises.writeFile(absoluteViewerPath, viewerHtml, 'utf8');
}

async function persistDocumentRecord({ prisma, uploadDir, access, userId, sourceBuffer, fileName, mimeType }) {
	const fileExtension = getNormalizedDocumentExtension(fileName, mimeType);
	if (!isSupportedNoteDocument(fileName, mimeType)) {
		throw new Error('Unsupported document type');
	}
	const noteDocument = await prisma.noteDocument.create({
		data: {
			docId: access.docId,
			sourceWorkspaceId: access.sourceWorkspaceId,
			sourceNoteId: access.sourceNoteId,
			uploadedByUserId: userId,
			storageKey: '',
			originalPath: '',
			previewPath: '',
			thumbnailPath: '',
			fileName: path.basename(String(fileName || `document.${fileExtension || 'bin'}`)),
			fileExtension,
			mimeType,
			byteSize: sourceBuffer.length,
		},
	});

	const fileBaseName = sanitizeBaseName(fileName);
	const baseRelativeDir = path.join('users', userId, 'notes', noteDocument.id, 'documents');
	const absoluteDir = path.join(uploadDir, baseRelativeDir);
	await fs.promises.mkdir(absoluteDir, { recursive: true });

	const originalRelativePath = path.join(baseRelativeDir, `${fileBaseName || 'document'}.${fileExtension}`).replace(/\\/g, '/');
	const previewRelativePath = path.join(baseRelativeDir, 'preview.webp').replace(/\\/g, '/');
	const thumbnailRelativePath = path.join(baseRelativeDir, 'thumb.webp').replace(/\\/g, '/');
	const viewerRelativePath = path.join(baseRelativeDir, 'viewer.html').replace(/\\/g, '/');
	const absoluteOriginalPath = path.join(uploadDir, originalRelativePath);

	await fs.promises.writeFile(absoluteOriginalPath, sourceBuffer);

	const extracted = await extractDocumentText({
		buffer: sourceBuffer,
		extension: fileExtension,
		sourcePath: absoluteOriginalPath,
	});
	const preview = await createDocumentPreviewBuffers({
		fileName,
		extension: fileExtension,
		extractedText: extracted.text,
	});
	const viewerHtml = await buildDocumentViewerHtml({
		buffer: sourceBuffer,
		extension: fileExtension,
		sourcePath: absoluteOriginalPath,
		fileName,
		extractedText: extracted.text,
	});

	await Promise.all([
		fs.promises.writeFile(path.join(uploadDir, previewRelativePath), preview.previewBuffer),
		fs.promises.writeFile(path.join(uploadDir, thumbnailRelativePath), preview.thumbnailBuffer),
		fs.promises.writeFile(path.join(uploadDir, viewerRelativePath), viewerHtml, 'utf8'),
	]);

	return prisma.noteDocument.update({
		where: { id: noteDocument.id },
		data: {
			storageKey: noteDocument.id,
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
}

async function syncNoteLinks({ prisma, access, userId, links }) {
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
				status: current && current.status === 'READY' ? 'READY' : 'PENDING',
				errorMessage: current && current.status === 'READY' ? current.errorMessage : null,
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

	for (const row of rows) {
		const needsResolution = row.status !== 'READY'
			|| (!row.title && !row.description && !row.mainContent)
			|| !row.imageUrl
			|| isLikelyBadPreviewImageUrl(row.imageUrl);
		if (!needsResolution) continue;
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

	return prisma.noteLink.findMany({
		where: {
			docId: access.docId,
			deletedAt: null,
		},
		orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
	});
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

function createNoteMediaRouter({ prisma, uploadDir, onWorkspaceMetadataChanged = null }) {
	if (!uploadDir) throw new Error('uploadDir is required');

	return function handleRequest(req, res) {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname;
		const method = String(req.method || 'GET').toUpperCase();

		if (!enforceSameOrigin(req, res)) return true;

		if (pathname === '/api/note-media' && method === 'GET') {
			(async () => {
				try {
					const session = requireAuth(req, res);
					if (!session) return;
					const accessResult = await ensureMediaAccess(prisma, session, url.searchParams.get('docId'));
					if (accessResult.error) {
						jsonResponse(res, accessResult.error.status, accessResult.error.body);
						return;
					}
					const images = await prisma.noteImage.findMany({
						where: {
							docId: accessResult.access.docId,
							deletedAt: null,
							assetStatus: 'READY',
						},
						orderBy: { createdAt: 'asc' },
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
					const documents = await prisma.noteDocument.findMany({
						where: {
							docId: accessResult.access.docId,
							deletedAt: null,
						},
						orderBy: { createdAt: 'asc' },
					});
					await Promise.all(documents.map((document) => ensureNoteDocumentViewerFile({ uploadDir, document }).catch(() => undefined)));
					jsonResponse(res, 200, { documents: documents.map(mapNoteDocument), count: documents.length });
				} catch (err) {
					console.error('[note-documents] list error:', err.message);
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
					const links = await syncNoteLinks({
						prisma,
						access: accessResult.access,
						userId: session.userId,
						links: Array.isArray(body.links) ? body.links : [],
					});
					await publishNoteMediaMetadataChange(onWorkspaceMetadataChanged, accessResult.access, 'note-links-updated');
					jsonResponse(res, 200, { links: links.map(mapNoteLink), count: links.length });
				} catch (err) {
					console.error('[note-links] sync error:', err.message);
					jsonResponse(res, 400, { error: err.message || 'Link sync failed' });
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

			const bb = Busboy({
				headers: req.headers,
				limits: { files: MAX_FILES_PER_UPLOAD, fileSize: MAX_DOCUMENT_FILE_BYTES, fields: 8 },
			});

			let docId = '';
			let fileError = null;
			const files = [];

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
				const chunks = [];
				file.on('data', (chunk) => chunks.push(chunk));
				file.on('limit', () => {
					fileError = 'File too large';
				});
				file.on('end', () => {
					if (!fileError) {
						files.push({
							fileName,
							mimeType,
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
					const documents = [];
					for (const entry of files) {
						const documentRecord = await persistDocumentRecord({
							prisma,
							uploadDir,
							access: accessResult.access,
							userId: session.userId,
							sourceBuffer: entry.buffer,
							fileName: entry.fileName,
							mimeType: entry.mimeType,
						});
						documents.push(mapNoteDocument(documentRecord));
					}
					await publishNoteMediaMetadataChange(onWorkspaceMetadataChanged, accessResult.access, 'note-documents-created');
					jsonResponse(res, 201, { documents, count: documents.length });
				} catch (err) {
					console.error('[note-documents] upload error:', err.message);
					jsonResponse(res, 400, { error: err.message || 'Upload failed' });
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
					const noteDocument = await prisma.noteDocument.findUnique({ where: { id: documentId } });
					if (!noteDocument || noteDocument.deletedAt) {
						jsonResponse(res, 404, { error: 'Document not found' });
						return;
					}
					const accessResult = await ensureMediaAccess(prisma, session, noteDocument.docId, { requireEdit: true });
					if (accessResult.error) {
						jsonResponse(res, accessResult.error.status, accessResult.error.body);
						return;
					}
					await prisma.noteDocument.update({
						where: { id: noteDocument.id },
						data: { deletedAt: new Date() },
					});
					await Promise.allSettled([
						fs.promises.rm(path.join(uploadDir, noteDocument.originalPath), { force: true }),
						fs.promises.rm(path.join(uploadDir, noteDocument.previewPath), { force: true }),
						fs.promises.rm(path.join(uploadDir, noteDocument.thumbnailPath), { force: true }),
						fs.promises.rm(path.join(uploadDir, path.join(path.dirname(noteDocument.originalPath), 'viewer.html')), { force: true }),
					]);
					await publishNoteMediaMetadataChange(onWorkspaceMetadataChanged, accessResult.access, 'note-documents-deleted');
					jsonResponse(res, 200, { ok: true, documentId: noteDocument.id });
				} catch (err) {
					console.error('[note-documents] delete error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
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
					const noteImages = await prisma.noteImage.findMany({
						where: {
							docId: { in: docs.map((doc) => doc.docId) },
							deletedAt: null,
							assetStatus: 'READY',
						},
						select: {
							docId: true,
							ocrText: true,
							thumbnailPath: true,
						},
					});
					const noteCollaborators = await prisma.noteCollaborator.findMany({
						where: {
							docId: { in: docs.map((doc) => doc.docId) },
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
					});
					const noteLinks = await prisma.noteLink.findMany({
						where: {
							docId: { in: docs.map((doc) => doc.docId) },
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
					});
					const noteDocuments = await prisma.noteDocument.findMany({
						where: {
							docId: { in: docs.map((doc) => doc.docId) },
							deletedAt: null,
						},
						select: {
							docId: true,
							fileName: true,
							fileExtension: true,
							ocrText: true,
							thumbnailPath: true,
						},
					});
					const pendingInvitations = await prisma.noteShareInvitation.findMany({
						where: {
							docId: { in: docs.map((doc) => doc.docId) },
							status: 'PENDING',
							revokedAt: null,
						},
						select: {
							docId: true,
							inviteeName: true,
							inviteeEmail: true,
						},
					});
					const imagesByDocId = new Map();
					for (const image of noteImages) {
						const next = imagesByDocId.get(image.docId) || [];
						next.push(image);
						imagesByDocId.set(image.docId, next);
					}
					const collaboratorsByDocId = new Map();
					const linksByDocId = new Map();
					const documentsByDocId = new Map();
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
						const next = documentsByDocId.get(noteDocument.docId) || [];
						next.push(noteDocument);
						documentsByDocId.set(noteDocument.docId, next);
					}
					const normalizedQuery = query.toLowerCase();
					const results = [];
					for (const row of docs) {
						if (!row.state || row.docId === '__notes_registry__' || row.docId.endsWith(':__notes_registry__')) continue;
						const snapshot = decodeDocumentState(row.state);
						if (snapshot.trashed) continue;
						const imageRows = imagesByDocId.get(row.docId) || [];
						const collaboratorLabels = collaboratorsByDocId.get(row.docId) || [];
						const linkRows = linksByDocId.get(row.docId) || [];
						const documentRows = documentsByDocId.get(row.docId) || [];
						const ocrText = normalizeText(imageRows.map((image) => image.ocrText || '').join(' '));
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
						const collaboratorMatches = collaboratorLabels.filter((label) => label.toLowerCase().includes(normalizedQuery));
						const collaboratorMatch = collaboratorMatches.length > 0;
						const linkMatch = linkText.toLowerCase().includes(normalizedQuery);
						const documentMatch = documentText.toLowerCase().includes(normalizedQuery);
						if (!noteMatch && !ocrMatch && !collaboratorMatch && !linkMatch && !documentMatch) continue;
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
						if (collaboratorMatch) matchKinds.push('collaborator');
						if (linkMatch) matchKinds.push('link');
						if (documentMatch) matchKinds.push('document');
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
							snippet: noteMatch
								? buildSearchSnippet(snapshot.plainText, query)
								: ocrMatch
									? buildSearchSnippet(ocrText, query)
									: collaboratorMatch
										? buildSearchSnippet(collaboratorText, query)
										: linkMatch
											? buildSearchSnippet(linkSnippetSource, query)
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
}

module.exports = {
	createNoteMediaRouter,
};