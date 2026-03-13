'use strict';

const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');
const sharp = require('sharp');
const { enforceSameOrigin } = require('./auth');
const { resolveDocAccess } = require('./noteShareRouter');
const { buildSearchSnippet, decodeDocumentState, normalizeText } = require('./noteSnapshot');
const { queueNoteImageOcr } = require('./ocr');

const MAX_FILES_PER_UPLOAD = 12;
const MAX_SOURCE_FILE_BYTES = 32 * 1024 * 1024;
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

function createNoteMediaRouter({ prisma, uploadDir }) {
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
					jsonResponse(res, 201, { images, count: images.length });
				} catch (err) {
					console.error('[note-media] upload error:', err.message);
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
					jsonResponse(res, 200, { ok: true, imageId: image.id });
				} catch (err) {
					console.error('[note-media] delete error:', err.message);
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

					const normalizedQuery = query.toLowerCase();
					const results = [];
					for (const row of docs) {
						if (!row.state || row.docId === '__notes_registry__' || row.docId.endsWith(':__notes_registry__')) continue;
						const snapshot = decodeDocumentState(row.state);
						if (snapshot.trashed) continue;
						const imageRows = imagesByDocId.get(row.docId) || [];
						const collaboratorLabels = collaboratorsByDocId.get(row.docId) || [];
						const ocrText = normalizeText(imageRows.map((image) => image.ocrText || '').join(' '));
						const collaboratorText = normalizeText(collaboratorLabels.join(' '));
						const noteMatch = snapshot.plainText.toLowerCase().includes(normalizedQuery);
						const ocrMatch = ocrText.toLowerCase().includes(normalizedQuery);
						const collaboratorMatches = collaboratorLabels.filter((label) => label.toLowerCase().includes(normalizedQuery));
						const collaboratorMatch = collaboratorMatches.length > 0;
						if (!noteMatch && !ocrMatch && !collaboratorMatch) continue;
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
									: buildSearchSnippet(collaboratorText, query),
							imageCount: imageRows.length,
							thumbnailUrl: imageRows[0] ? toPublicUploadPath(imageRows[0].thumbnailPath) : null,
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