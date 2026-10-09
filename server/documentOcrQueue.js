'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { openPdfPageRenderer, DEFAULT_RENDER_WIDTH_PX } = require('./documentPageRender');
const { MAX_EXTRACTED_TEXT_CHARS } = require('./noteDocumentPreview');
const { runPythonOcrBatch, isOcrDisabled, readIntEnv } = require('./ocr');

// Reads the text off scanned PDFs, page by page, in the background.
//
// Document text used to come only from the PDF's own text layer. A PDF photographed with the
// camera scanner (src/components/NoteDocuments/scan/scanPdf.ts embeds JPEGs and draws no text)
// has no text layer at all, so extraction returned "" — and because nothing had thrown, the row
// was then stamped ocrStatus COMPLETE. The scan looked processed, held no text, and was
// invisible to search. PaddleOCR was wired only to uploaded images; nothing in the document path
// had ever called it.
//
// What this does instead, per page: a page whose text layer already holds real text keeps that
// text exactly as it is, and only pages that come back empty get rendered and recognised. That
// covers the three real cases with one rule — a fully photographed scan (every page recognised),
// a mixed PDF where someone scanned the signature page into a digital document (only that page),
// and a scan carrying a junk text header (the header isn't enough to count, so the page still
// gets read) — and it never spends CPU re-reading text the file already gave us for free.
//
// There is deliberately no page cap. Half a document's text is worse than none: you'd search,
// find nothing, and conclude the text isn't there. Long documents just take a while, which is
// why progress is persisted rather than kept in memory.

/**
 * Below this many characters, a page's text layer isn't worth keeping and the page gets OCR'd.
 * Covers a blank text layer, a page holding only a scanner's junk header, and the stray
 * punctuation some PDF producers emit for an image-only page. Set low on purpose: OCR'ing a page
 * that didn't need it costs time, whereas skipping a page that did leaves a hole in the text.
 */
const MIN_TEXT_LAYER_CHARS_PER_PAGE = 16;
/** Pages rendered and handed to one OCR process at a time. Bounds peak memory. */
const DEFAULT_PAGE_BATCH_SIZE = 4;
/** Documents worked on at once. Each one is a render worker plus OCR processes. */
const DEFAULT_DOCUMENT_CONCURRENCY = 1;
/** A document that failed this often is left alone until the next restart. */
const MAX_ATTEMPTS_PER_VERSION = 2;
/**
 * Progress is announced to the other devices at most this often. Every page would mean one
 * websocket fan-out and one document-list refetch per page on every connected tab.
 */
const PROGRESS_ANNOUNCE_INTERVAL_MS = 4000;
/**
 * Ceiling on stored highlight boxes. A dense 700-page scan is tens of thousands of lines, and
 * this column is JSON in one row; past this the later pages simply aren't highlightable, which
 * is a far better failure than a multi-megabyte row. The recognised *text* is unaffected and
 * keeps its own cap, so search still finds those pages.
 */
const MAX_LAYOUT_LINES = 40000;
/** Bumped when the stored shape changes, so a client can refuse to read one it doesn't know. */
const OCR_LAYOUT_VERSION = 1;

function documentOcrEnabled() {
	if (isOcrDisabled()) return false;
	return String(process.env.OCR_DOCUMENTS_DISABLED || '').trim() !== '1';
}

function pageBatchSize() {
	return readIntEnv('OCR_DOCUMENT_PAGE_BATCH', DEFAULT_PAGE_BATCH_SIZE, 1, 64);
}

function documentConcurrency() {
	return readIntEnv('OCR_DOCUMENT_MAX_CONCURRENT', DEFAULT_DOCUMENT_CONCURRENCY, 1, 32);
}

function renderWidthPx() {
	return readIntEnv('OCR_DOCUMENT_RENDER_WIDTH_PX', DEFAULT_RENDER_WIDTH_PX, 600, 5000);
}

/**
 * Turns PaddleOCR's pixel boxes into page fractions, which is what the viewer highlights with:
 * a fraction holds at any zoom and does not depend on OCR_DOCUMENT_RENDER_WIDTH_PX, so changing
 * the render resolution later doesn't invalidate everything already stored. Lines whose box is
 * missing or degenerate are dropped rather than stored as a zero-size rect that would silently
 * highlight nothing.
 */
function toPageFractionLines(lines, pageWidth, pageHeight) {
	if (!Array.isArray(lines) || !(pageWidth > 0) || !(pageHeight > 0)) return [];
	const out = [];
	for (const line of lines) {
		const text = String((line && line.text) || '').trim();
		const box = line && Array.isArray(line.box) ? line.box : null;
		if (!text || !box || box.length < 4) continue;
		const [x0, y0, x1, y1] = box.map(Number);
		if (![x0, y0, x1, y1].every((value) => Number.isFinite(value))) continue;
		// Clamped: a detection can sit a pixel or two outside the page it was rendered from.
		const left = Math.max(0, Math.min(1, Math.min(x0, x1) / pageWidth));
		const top = Math.max(0, Math.min(1, Math.min(y0, y1) / pageHeight));
		const right = Math.max(0, Math.min(1, Math.max(x0, x1) / pageWidth));
		const bottom = Math.max(0, Math.min(1, Math.max(y0, y1) / pageHeight));
		const width = right - left;
		const height = bottom - top;
		if (!(width > 0) || !(height > 0)) continue;
		out.push({ t: text, b: [round4(left), round4(top), round4(width), round4(height)] });
	}
	return out;
}

/** Four decimals is ~0.3px on a 3000px page, and keeps the stored JSON a third of the size. */
function round4(value) {
	return Math.round(value * 10000) / 10000;
}

/** The searchable-text ceiling, shared with every other extraction path. */
function capExtractedText(text) {
	const value = String(text || '');
	return value.length > MAX_EXTRACTED_TEXT_CHARS ? value.slice(0, MAX_EXTRACTED_TEXT_CHARS) : value;
}

function normalizeWhitespace(value) {
	return String(value || '').replace(/\s+/g, ' ').trim();
}

/** True when this page's text layer has so little on it that the page is effectively an image. */
function pageNeedsOcr(text) {
	return normalizeWhitespace(text).length < MIN_TEXT_LAYER_CHARS_PER_PAGE;
}

/**
 * Whether a failure means "PaddleOCR isn't usable here" rather than "this document is bad". A
 * wrong OCR_PYTHON_BIN, a venv that didn't build, a model that won't download — on a self-hosted
 * app these are the likeliest failures of the lot, and they'd otherwise mark every scan the user
 * owns as permanently FAILED, with nothing to un-fail them once the config was corrected.
 */
function isOcrRuntimeUnavailable(message) {
	return /paddleocr-import-failed|paddleocr-constructor-failed|paddleocr-api-unsupported|ocr-process-error|ENOENT|No module named|is not recognized|cannot find the (file|path)/i
		.test(String(message || ''));
}

/**
 * Whether a freshly uploaded file of this type can be left waiting for OCR. Only PDFs: they're
 * the only thing we can render ourselves. An office file has to wait for its Gotenberg PDF copy
 * first, so the conversion queue is what hands it over (and if Gotenberg is missing it must NOT
 * sit there saying "reading text" with nothing ever coming to read it).
 */
function canOcrDocumentExtension(extension) {
	return String(extension || '').toLowerCase() === 'pdf';
}

function createDocumentOcrQueue({
	prisma,
	uploadDir,
	runOcr = runPythonOcrBatch,
	openRenderer = openPdfPageRenderer,
	onProgress = null,
	onComplete = null,
	logger = console,
}) {
	const attempts = new Map();
	// Versions this run has given up on, so one unreadable file can't spin the queue forever.
	const abandonedIds = new Set();
	// So a broken OCR runtime is logged once rather than once per document.
	let runtimeOutageReported = false;
	let currentPass = null;
	let wakeRequested = false;
	let stopped = false;

	async function reconcileOnStartup() {
		if (!documentOcrEnabled()) {
			// OCR used to be on and isn't any more (or was never on, and these rows came from a
			// build that marked them before uploads checked). EVERY pending row has to be cleared,
			// not just the ones that had started: nothing is coming to pick any of them up, so a
			// row left PENDING says "waiting to read text" on every device, forever.
			const { count } = await prisma.noteDocumentVersion.updateMany({
				where: { ocrStatus: 'PENDING' },
				data: { ocrStatus: 'COMPLETE', ocrStartedAt: null, ocrPagesTotal: null, ocrPagesDone: null },
			});
			if (count > 0) logger.info(`[document-ocr] OCR is off: cleared ${count} document(s) that were waiting to be read`);
			return;
		}

		// Anything the server was midway through when it stopped. The page counters are from a
		// run that no longer exists, so they go back to the start.
		await prisma.noteDocumentVersion.updateMany({
			where: { ocrStatus: 'PENDING', ocrStartedAt: { not: null } },
			data: { ocrStartedAt: null, ocrPagesDone: null, ocrPagesTotal: null },
		});

		// Every scan uploaded before this queue existed is sitting there marked COMPLETE with no
		// text, and would stay that way — nothing else ever revisits a finished version. These
		// are exactly the documents the user noticed weren't searchable, so they get queued now.
		const { count } = await prisma.noteDocumentVersion.updateMany({
			where: {
				deletedAt: null,
				ocrStatus: 'COMPLETE',
				OR: [{ ocrText: null }, { ocrText: '' }],
				// Already been read — there was just nothing on it. Without this check a blank or
				// unreadable scan would be re-rendered and re-recognised on every single restart,
				// since an empty ocrText is all the legacy bug left behind too.
				ocrCompletedAt: null,
				// Only files we can actually render. An office file waits for its PDF copy and is
				// picked up by notify() when the conversion queue announces one.
				AND: [{ OR: [{ fileExtension: 'pdf' }, { viewPdfPath: { not: null } }] }],
			},
			data: { ocrStatus: 'PENDING' },
		});
		if (count > 0) logger.info(`[document-ocr] Queued ${count} existing document(s) with no extracted text`);
	}

	function nextPendingVersion(skipIds) {
		return prisma.noteDocumentVersion.findFirst({
			where: {
				ocrStatus: 'PENDING',
				deletedAt: null,
				// Still being written by an upload in progress.
				originalPath: { not: '' },
				noteDocument: { is: { deletedAt: null } },
				OR: [{ fileExtension: 'pdf' }, { viewPdfPath: { not: null } }],
				id: { notIn: [...skipIds] },
			},
			// Newest first: the scan someone just took is the one they're waiting on.
			orderBy: { createdAt: 'desc' },
			include: { noteDocument: { select: { docId: true, sourceWorkspaceId: true } } },
		});
	}

	async function announce(version, hook) {
		if (typeof hook !== 'function' || !version.noteDocument) return;
		try {
			await hook({
				docId: version.noteDocument.docId,
				sourceWorkspaceId: version.noteDocument.sourceWorkspaceId,
				versionId: version.id,
			});
		} catch (error) {
			logger.warn('[document-ocr] Couldn\'t announce OCR progress:', error && error.message ? error.message : error);
		}
	}

	/**
	 * Writes the PNG somewhere PaddleOCR can open it. The runner takes paths, not buffers (it's a
	 * separate Python process), so the bytes have to land on disk between the two.
	 */
	async function writeTempPage(versionId, pageNumber, png) {
		const tempPath = path.join(
			os.tmpdir(),
			`freemannotes-dococr-${process.pid}-${versionId}-${pageNumber}-${Math.random().toString(36).slice(2)}.png`
		);
		await fs.promises.writeFile(tempPath, png);
		return tempPath;
	}

	async function markFailed(version, message) {
		await prisma.noteDocumentVersion.updateMany({
			where: { id: version.id, ocrStatus: 'PENDING' },
			data: {
				ocrStatus: 'FAILED',
				ocrError: String(message || 'Text recognition failed').slice(0, 2000),
				ocrStartedAt: null,
				ocrPagesTotal: null,
				ocrPagesDone: null,
			},
		});
		logger.warn(`[document-ocr] Gave up on document version ${version.id}: ${message}`);
		await announce(version, onComplete);
	}

	/** Which file to read: a PDF is its own source; an office file uses its converted copy. */
	function sourceRelativePath(version) {
		const relative = version.fileExtension === 'pdf' ? version.originalPath : version.viewPdfPath;
		return String(relative || '').replace(/\\/g, '/');
	}

	async function processVersion(version) {
		const relativePath = sourceRelativePath(version);
		if (!relativePath) {
			// An office file with no PDF copy yet. Leave it PENDING; notify() brings it back when
			// the conversion queue has made one.
			abandonedIds.add(version.id);
			return;
		}

		let pdf;
		try {
			pdf = await fs.promises.readFile(path.join(uploadDir, relativePath));
		} catch {
			await markFailed(version, 'The file is missing on the server');
			return;
		}

		const renderer = await openRenderer(pdf, { width: renderWidthPx() });
		try {
			// Page order is what matters for the final text, so index by page number rather than
			// trusting the order anything comes back in.
			const textByPage = new Map();
			for (const page of renderer.pageTexts) {
				if (page && page.num > 0) textByPage.set(page.num, page.text);
			}
			const pageCount = renderer.pageCount || textByPage.size;
			const pagesToOcr = [];
			for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
				if (pageNeedsOcr(textByPage.get(pageNumber))) pagesToOcr.push(pageNumber);
			}

			if (pagesToOcr.length === 0) {
				// Nothing to recognise — a normal digital PDF. Keep the text layer and be done.
				await finish(version, textByPage, pageCount, new Map(), null, null);
				return;
			}

			const startedAt = new Date();
			await prisma.noteDocumentVersion.updateMany({
				where: { id: version.id, ocrStatus: 'PENDING' },
				data: { ocrStartedAt: startedAt, ocrPagesTotal: pagesToOcr.length, ocrPagesDone: 0, ocrError: null },
			});
			await announce(version, onProgress);
			logger.info(`[document-ocr] Reading ${pagesToOcr.length} page(s) of ${version.fileName} (version ${version.id})`);

			const ocrByPage = new Map();
			// Page number -> recognised lines with their boxes, for highlighting (see finish()).
			const layoutByPage = new Map();
			let layoutLineCount = 0;
			let layoutTruncated = false;
			let done = 0;
			let failedPages = 0;
			let lastAnnouncedAt = Date.now();
			// The streamed per-page writes and the end-of-batch write race each other, and a
			// counter that goes 7, 8, 7 reads as a bug. Never write a number lower than the last.
			let highestWrittenDone = 0;
			const writeProgress = async (reached) => {
				if (reached <= highestWrittenDone) return true;
				highestWrittenDone = reached;
				const updated = await prisma.noteDocumentVersion.updateMany({
					where: { id: version.id, ocrStatus: 'PENDING' },
					data: { ocrPagesDone: reached },
				});
				return updated.count > 0;
			};
			const batchSize = pageBatchSize();

			for (let offset = 0; offset < pagesToOcr.length; offset += batchSize) {
				if (stopped) return;
				const batch = pagesToOcr.slice(offset, offset + batchSize);
				const rendered = await renderer.renderPages(batch);
				if (rendered.length === 0) {
					// Pages that won't draw at all. Count them off so progress still completes.
					failedPages += batch.length;
					done += batch.length;
					continue;
				}

				const tempPaths = [];
				try {
					for (const page of rendered) {
						tempPaths.push(await writeTempPage(version.id, page.pageNumber, page.png));
					}
					// The runner streams a line per page, which is what moves the counter while a
					// batch is still going rather than only when it ends.
					let streamed = 0;
					const result = await runOcr(tempPaths, {
						onPage: () => {
							streamed += 1;
							const now = Date.now();
							if (now - lastAnnouncedAt < PROGRESS_ANNOUNCE_INTERVAL_MS) return;
							lastAnnouncedAt = now;
							const reached = done + streamed;
							void writeProgress(reached)
								.then((live) => (live ? announce(version, onProgress) : undefined))
								.catch(() => undefined);
						},
					});

					if (!result.ok) {
						// The whole batch failed — a missing Python, a model that won't load. That
						// isn't this document's fault and the next batch would fail the same way.
						throw new Error(result.error || 'ocr-failed');
					}
					for (const entry of result.results) {
						const page = rendered[Number(entry.index)];
						if (!page) continue;
						if (!entry.ok) {
							failedPages += 1;
							continue;
						}
						ocrByPage.set(page.pageNumber, String(entry.text || ''));
						const pageLines = toPageFractionLines(entry.lines, page.width, page.height);
						if (pageLines.length > 0 && layoutLineCount < MAX_LAYOUT_LINES) {
							const room = MAX_LAYOUT_LINES - layoutLineCount;
							layoutByPage.set(page.pageNumber, pageLines.slice(0, room));
							layoutLineCount += Math.min(room, pageLines.length);
							if (layoutLineCount >= MAX_LAYOUT_LINES) layoutTruncated = true;
						} else if (pageLines.length > 0) {
							layoutTruncated = true;
						}
					}
					done += rendered.length;
				} finally {
					await Promise.all(tempPaths.map((tempPath) => fs.promises.unlink(tempPath).catch(() => {})));
				}

				const live = await writeProgress(done);
				if (!live) return; // Deleted, or replaced, while we were reading it.
				if (Date.now() - lastAnnouncedAt >= PROGRESS_ANNOUNCE_INTERVAL_MS) {
					lastAnnouncedAt = Date.now();
					await announce(version, onProgress);
				}
			}

			const error = failedPages > 0
				? `${failedPages} of ${pagesToOcr.length} page(s) couldn't be read`
				: null;
			await finish(version, textByPage, pageCount, ocrByPage, error, buildLayout(layoutByPage, layoutTruncated));
		} finally {
			await renderer.close();
		}
	}

	/**
	 * `{ v, truncated, pages }` for storage, or null when there is nothing to highlight — which
	 * is every ordinary digital PDF, since pdf.js has its own text layer for those and never
	 * consults this. The `v` rides inside the blob so a later change of shape can be recognised.
	 */
	function buildLayout(layoutByPage, truncated) {
		if (layoutByPage.size === 0) return null;
		const pages = {};
		for (const [pageNumber, lines] of layoutByPage) pages[String(pageNumber)] = lines;
		return { v: OCR_LAYOUT_VERSION, truncated: Boolean(truncated), pages };
	}

	/** Merges text-layer text and recognised text back into one document, in page order. */
	async function finish(version, textByPage, pageCount, ocrByPage, partialError, layout) {
		const parts = [];
		for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
			// Recognised text wins only where the page had none of its own: the text layer is
			// exact, OCR is a guess.
			const own = textByPage.get(pageNumber);
			const text = pageNeedsOcr(own) ? (ocrByPage.get(pageNumber) || '') : own;
			if (String(text || '').trim()) parts.push(String(text).trim());
		}
		// Same ceiling every other extraction path goes through (extractDocumentText applies it
		// via noteDocumentPreview). This queue wrote the merged text raw, which was fine for a
		// ten-page scan and wrong for a long one: a 700-page document is a couple of million
		// characters, and `ocrText` rides along in full in every /api/note-documents response
		// for that note. Capping here rather than at the read keeps one rule in one place.
		const merged = capExtractedText(parts.join('\n\n'));
		const updated = await prisma.noteDocumentVersion.updateMany({
			where: { id: version.id, ocrStatus: 'PENDING' },
			data: {
				ocrStatus: 'COMPLETE',
				ocrText: merged,
				// A document that mostly read fine still says so, so the UI can mention it without
				// pretending the whole thing failed.
				ocrError: partialError ? String(partialError).slice(0, 2000) : null,
				ocrStartedAt: null,
				ocrPagesTotal: null,
				ocrPagesDone: null,
				// Stamped even when nothing was found, so the startup sweep knows this one has
				// had its turn and doesn't queue it again on every boot.
				ocrCompletedAt: new Date(),
				// null for a document that needed no OCR, so a digital PDF never carries an empty
				// layout blob around; pdf.js's own text layer highlights those already.
				ocrLayout: layout,
				...(version.pageCount == null && pageCount > 0 ? { pageCount } : {}),
			},
		});
		if (updated.count === 0) return;
		if (ocrByPage.size > 0) {
			logger.info(`[document-ocr] Read ${ocrByPage.size} page(s) of ${version.fileName}: ${merged.length} chars`);
		}
		await announce(version, onComplete);
	}

	function runPass() {
		if (!documentOcrEnabled() || stopped) return Promise.resolve();
		if (currentPass) {
			wakeRequested = true;
			return currentPass;
		}
		currentPass = (async () => {
			try {
				do {
					wakeRequested = false;
					// Documents in flight are skipped by id so parallel workers never collide on one.
					const inFlight = new Set();
					const worker = async () => {
						for (;;) {
							if (stopped) return;
							const version = await nextPendingVersion(new Set([...abandonedIds, ...inFlight]));
							if (!version) return;
							inFlight.add(version.id);
							try {
								await processVersion(version);
								attempts.delete(version.id);
							} catch (error) {
								const message = error && error.message ? error.message : String(error);
								if (isOcrRuntimeUnavailable(message)) {
									// PaddleOCR itself isn't there — a wrong OCR_PYTHON_BIN, a venv that
									// didn't build, a model that won't load. That's not this document's
									// fault, and every other document would fail the same way, so nothing
									// is marked FAILED and no attempt is counted against it. Otherwise one
									// bad config would permanently fail every scan the user owns, and
									// fixing the config afterwards would never bring them back. The row
									// stays PENDING; a restart or the next upload retries it. Same
									// reasoning as the conversion queue's handling of a Gotenberg outage.
									abandonedIds.add(version.id);
									if (!runtimeOutageReported) {
										runtimeOutageReported = true;
										logger.warn(`[document-ocr] OCR isn't available (${message}). Scans stay queued; retries on restart or the next upload.`);
									}
									return;
								}
								const tries = (attempts.get(version.id) || 0) + 1;
								if (tries >= MAX_ATTEMPTS_PER_VERSION) {
									attempts.delete(version.id);
									await markFailed(version, message).catch(() => undefined);
								} else {
									attempts.set(version.id, tries);
									// Back to the end of the line rather than straight round again.
									abandonedIds.add(version.id);
									logger.warn(`[document-ocr] Retrying document version ${version.id} later: ${message}`);
								}
							} finally {
								inFlight.delete(version.id);
							}
						}
					};
					await Promise.all(Array.from({ length: documentConcurrency() }, () => worker()));
				} while (wakeRequested && !stopped);
			} catch (error) {
				logger.error('[document-ocr] OCR pass failed:', error && error.message ? error.message : error);
			} finally {
				currentPass = null;
			}
		})();
		return currentPass;
	}

	async function start() {
		if (stopped) return;
		try {
			await reconcileOnStartup();
		} catch (error) {
			logger.error('[document-ocr] Startup check failed:', error && error.message ? error.message : error);
		}
		if (!documentOcrEnabled()) {
			logger.info('[document-ocr] Document OCR is off (OCR_DISABLED / OCR_DOCUMENTS_DISABLED)');
			return;
		}
		await runPass();
	}

	return {
		get enabled() {
			return documentOcrEnabled();
		},
		start,
		/** Something new may need reading (an upload, a finished office conversion). */
		scanSoon: () => {
			// A file that was waiting on its PDF copy, or failed a first attempt, gets another go —
			// including everything parked by a broken OCR runtime, in case it's been fixed since.
			abandonedIds.clear();
			runtimeOutageReported = false;
			void runPass();
		},
		stop: () => {
			stopped = true;
		},
		whenIdle: () => currentPass || Promise.resolve(),
	};
}

module.exports = {
	MIN_TEXT_LAYER_CHARS_PER_PAGE,
	canOcrDocumentExtension,
	createDocumentOcrQueue,
	pageNeedsOcr,
};
