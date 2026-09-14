'use strict';

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const sharp = require('sharp');

// Real first-page previews for documents: page 1 of a PDF, or of the PDF copy Gotenberg made of
// an office file. Until one exists (or when rendering fails) the generated text card from upload
// stays in place, so there's always something to show.
//
// New files get new names (preview-page.webp / thumb-page.webp) rather than overwriting the text
// card. The service worker caches images forever-ish by URL, so reusing the old name would keep
// showing the text card on every device that had already seen it.

const RENDER_WIDTH_PX = 960;
const PREVIEW_WIDTH_PX = 960;
const THUMB_WIDTH_PX = 480;
// A receipt roll or a poster-length page shouldn't become a 20,000 px tall thumbnail. Past this
// ratio we keep the top, which is the part people recognise anyway.
const MAX_HEIGHT_TO_WIDTH = 2;
const RENDER_TIMEOUT_MS = 20_000;
const PREVIEW_FILE_NAME = 'preview-page.webp';
const THUMB_FILE_NAME = 'thumb-page.webp';

function renderFirstPagePng(pdfBuffer, { timeoutMs = RENDER_TIMEOUT_MS } = {}) {
	return new Promise((resolve, reject) => {
		// Copy first: a Buffer from fs can be a slice of a shared pool, which can't be transferred.
		const bytes = new Uint8Array(pdfBuffer);
		const worker = new Worker(path.join(__dirname, 'documentThumbnailWorker.js'), {
			workerData: { pdf: bytes, width: RENDER_WIDTH_PX },
			transferList: [bytes.buffer],
			// A pathological PDF shouldn't be able to take the whole server's memory down with it.
			resourceLimits: { maxOldGenerationSizeMb: 256 },
		});
		let settled = false;
		const finish = (settle) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			void worker.terminate();
			settle();
		};
		const timer = setTimeout(() => {
			finish(() => reject(new Error(`Rendering the first page took longer than ${Math.round(timeoutMs / 1000)} s`)));
		}, timeoutMs);
		if (typeof timer.unref === 'function') timer.unref();
		worker.once('message', (message) => finish(() => {
			if (message && message.ok) resolve(Buffer.from(message.png));
			else reject(new Error((message && message.error) || 'Rendering the first page failed'));
		}));
		worker.once('error', (error) => finish(() => reject(error)));
		worker.once('exit', (code) => finish(() => reject(new Error(`The page renderer stopped unexpectedly (exit ${code})`))));
	});
}

async function resizePage(png, width) {
	const meta = await sharp(png).metadata();
	const scaledHeight = meta.width ? Math.round((meta.height * width) / meta.width) : width;
	const height = Math.max(1, Math.min(scaledHeight, width * MAX_HEIGHT_TO_WIDTH));
	const { data, info } = await sharp(png)
		// Pages with no background paint are transparent; on a dark card that looks broken.
		.flatten({ background: '#ffffff' })
		.resize({ width, height, fit: 'cover', position: 'top' })
		.webp({ quality: width > THUMB_WIDTH_PX ? 82 : 78 })
		.toBuffer({ resolveWithObject: true });
	return { data, width: info.width, height: info.height };
}

async function createFirstPagePreviews(pdfBuffer, options) {
	const png = await renderFirstPagePng(pdfBuffer, options);
	const [preview, thumbnail] = await Promise.all([resizePage(png, PREVIEW_WIDTH_PX), resizePage(png, THUMB_WIDTH_PX)]);
	return {
		previewBuffer: preview.data,
		previewWidth: preview.width,
		previewHeight: preview.height,
		thumbnailBuffer: thumbnail.data,
		thumbnailWidth: thumbnail.width,
		thumbnailHeight: thumbnail.height,
	};
}

function createDocumentThumbnailQueue({
	prisma,
	uploadDir,
	createPreviews = createFirstPagePreviews,
	onUpdated = null,
	logger = console,
}) {
	// Files that failed this run (password-protected, corrupt, too slow). Not retried until the
	// next restart, so one bad file can't spin the queue.
	const failedIds = new Set();
	let currentPass = null;
	let wakeRequested = false;
	let stopped = false;

	function nextVersion() {
		return prisma.noteDocumentVersion.findFirst({
			where: {
				deletedAt: null,
				// Still being written by an upload in progress.
				originalPath: { not: '' },
				noteDocument: { is: { deletedAt: null } },
				NOT: { thumbnailPath: { endsWith: THUMB_FILE_NAME } },
				OR: [{ fileExtension: 'pdf' }, { conversionStatus: 'COMPLETE', viewPdfPath: { not: null } }],
				id: { notIn: [...failedIds] },
			},
			// Newest first: the document someone just attached is the one they're looking at.
			orderBy: { createdAt: 'desc' },
			include: { noteDocument: { select: { docId: true, sourceWorkspaceId: true } } },
		});
	}

	async function processVersion(version) {
		const originalRelativePath = String(version.originalPath || '').replace(/\\/g, '/');
		const sourceRelativePath = String(version.fileExtension === 'pdf' ? version.originalPath : version.viewPdfPath || '').replace(/\\/g, '/');
		const directory = path.posix.dirname(originalRelativePath);
		const previewRelativePath = `${directory}/${PREVIEW_FILE_NAME}`;
		const thumbnailRelativePath = `${directory}/${THUMB_FILE_NAME}`;

		// Taken now, before the row changes: these are the text-card images to tidy up afterwards.
		const previousPaths = [version.previewPath, version.thumbnailPath];
		const source = await fs.promises.readFile(path.join(uploadDir, sourceRelativePath));
		const previews = await createPreviews(source);
		await Promise.all([
			fs.promises.writeFile(path.join(uploadDir, previewRelativePath), previews.previewBuffer),
			fs.promises.writeFile(path.join(uploadDir, thumbnailRelativePath), previews.thumbnailBuffer),
		]);

		const updated = await prisma.noteDocumentVersion.updateMany({
			where: { id: version.id, deletedAt: null },
			data: {
				previewPath: previewRelativePath,
				thumbnailPath: thumbnailRelativePath,
				previewWidth: previews.previewWidth,
				previewHeight: previews.previewHeight,
				thumbnailWidth: previews.thumbnailWidth,
				thumbnailHeight: previews.thumbnailHeight,
			},
		});
		if (updated.count === 0) {
			// Deleted while rendering; the delete already removed everything it knew about.
			await Promise.allSettled([previewRelativePath, thumbnailRelativePath].map((relativePath) => fs.promises.rm(path.join(uploadDir, relativePath), { force: true })));
			return;
		}
		// The old generated text-card images are no longer referenced by anything.
		await Promise.allSettled(previousPaths
			.map((relativePath) => String(relativePath || '').replace(/\\/g, '/'))
			.filter((relativePath) => relativePath && relativePath !== previewRelativePath && relativePath !== thumbnailRelativePath)
			.map((relativePath) => fs.promises.rm(path.join(uploadDir, relativePath), { force: true })));
		if (typeof onUpdated === 'function' && version.noteDocument) {
			try {
				await onUpdated({ docId: version.noteDocument.docId, sourceWorkspaceId: version.noteDocument.sourceWorkspaceId, versionId: version.id });
			} catch (error) {
				logger.warn('[thumbnails] Couldn\'t announce a new preview:', error && error.message ? error.message : error);
			}
		}
	}

	function runPass() {
		if (stopped) return Promise.resolve();
		if (currentPass) {
			wakeRequested = true;
			return currentPass;
		}
		currentPass = (async () => {
			let rendered = 0;
			try {
				do {
					wakeRequested = false;
					for (;;) {
						if (stopped) return;
						const version = await nextVersion();
						if (!version) break;
						try {
							await processVersion(version);
							rendered += 1;
						} catch (error) {
							failedIds.add(version.id);
							logger.warn(`[thumbnails] No page preview for document version ${version.id}: ${error && error.message ? error.message : error}`);
						}
					}
				} while (wakeRequested && !stopped);
			} catch (error) {
				logger.error('[thumbnails] Preview pass failed:', error && error.message ? error.message : error);
			} finally {
				if (rendered > 1) logger.info(`[thumbnails] Made page previews for ${rendered} documents`);
				currentPass = null;
			}
		})();
		return currentPass;
	}

	return {
		start: () => runPass(),
		/** Something new may need a preview (an upload, a finished conversion). */
		scanSoon: () => {
			void runPass();
		},
		stop: () => {
			stopped = true;
		},
		whenIdle: () => currentPass || Promise.resolve(),
	};
}

module.exports = {
	PREVIEW_FILE_NAME,
	THUMB_FILE_NAME,
	createDocumentThumbnailQueue,
	createFirstPagePreviews,
	renderFirstPagePng,
};
