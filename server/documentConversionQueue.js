'use strict';

const fs = require('fs');
const path = require('path');
const { CONVERTIBLE_DOCUMENT_EXTENSIONS, DocumentConversionError } = require('./documentConverter');

// Turns PENDING office-document versions into PDF copies, one at a time, in the background.
// Uploads never wait on this: the file is saved and listed straight away, and devices pick up
// the PDF copy when a metadata event says it's ready.
//
// Failure handling, because Gotenberg is a separate container that can be down, restarting,
// or pointed at the wrong address:
// - unreachable / misconfigured: the file stays PENDING and the whole queue backs off (30 s,
//   doubling to 10 min). Nothing is marked failed for an outage.
// - rejected (400): marked FAILED straight away; retrying the same bytes won't help.
// - 500 / timeout / not-a-PDF: up to 3 tries for that file, then FAILED, so one poisonous
//   spreadsheet can't block every file behind it forever.

const MAX_ATTEMPTS_PER_VERSION = 3;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;
const VIEW_PDF_FILE_NAME = 'view.pdf';

function createDocumentConversionQueue({
	prisma,
	uploadDir,
	converter,
	extractDocumentText,
	onConverted = null,
	logger = console,
	timers = { setTimeout, clearTimeout },
}) {
	const enabled = Boolean(converter && converter.enabled);
	const attempts = new Map();
	let currentPass = null;
	let wakeRequested = false;
	let stopped = false;
	let retryTimer = null;
	let retryDelayMs = RETRY_BASE_MS;
	let outageReported = false;

	async function reconcileOnStartup() {
		if (enabled) {
			// Office files uploaded before Gotenberg was set up (or before this feature) get queued now.
			const { count } = await prisma.noteDocumentVersion.updateMany({
				where: {
					deletedAt: null,
					conversionStatus: 'NOT_NEEDED',
					viewPdfPath: null,
					fileExtension: { in: [...CONVERTIBLE_DOCUMENT_EXTENSIONS] },
				},
				data: { conversionStatus: 'PENDING' },
			});
			if (count > 0) logger.info(`[converter] Queued ${count} existing office document(s) for PDF conversion`);
			return;
		}
		// Gotenberg used to be configured and isn't any more: nothing will ever pick these up, and
		// leaving them PENDING would show "preparing PDF" on every device forever.
		await prisma.noteDocumentVersion.updateMany({
			where: { conversionStatus: 'PENDING' },
			data: { conversionStatus: 'NOT_NEEDED' },
		});
	}

	function nextPendingVersion() {
		return prisma.noteDocumentVersion.findFirst({
			where: {
				conversionStatus: 'PENDING',
				deletedAt: null,
				noteDocument: { is: { deletedAt: null } },
			},
			orderBy: { createdAt: 'asc' },
			include: { noteDocument: { select: { docId: true, sourceWorkspaceId: true } } },
		});
	}

	async function announce(version) {
		if (typeof onConverted !== 'function' || !version.noteDocument) return;
		try {
			await onConverted({ docId: version.noteDocument.docId, sourceWorkspaceId: version.noteDocument.sourceWorkspaceId, versionId: version.id });
		} catch (error) {
			logger.warn('[converter] Couldn\'t announce a finished conversion:', error && error.message ? error.message : error);
		}
	}

	async function markFailed(version, message) {
		await prisma.noteDocumentVersion.updateMany({
			where: { id: version.id, conversionStatus: 'PENDING' },
			data: { conversionStatus: 'FAILED', conversionError: String(message || 'Conversion failed').slice(0, 500) },
		});
		logger.warn(`[converter] Gave up on document version ${version.id}: ${message}`);
		await announce(version);
	}

	/** Returns 'done', 'retry' (this file hiccupped) or 'unavailable' (Gotenberg is the problem). */
	async function convertVersion(version) {
		const originalRelativePath = String(version.originalPath || '').replace(/\\/g, '/');
		let source;
		try {
			source = await fs.promises.readFile(path.join(uploadDir, originalRelativePath));
		} catch {
			await markFailed(version, 'The original file is missing on the server');
			return 'done';
		}

		let pdf;
		try {
			pdf = await converter.convertToPdf({ buffer: source, fileName: path.posix.basename(originalRelativePath) });
		} catch (error) {
			const kind = error instanceof DocumentConversionError ? error.kind : 'failed';
			const message = error && error.message ? error.message : 'Conversion failed';
			if (kind === 'unavailable') {
				retryReason = message;
				return 'unavailable';
			}
			if (kind === 'rejected') {
				attempts.delete(version.id);
				await markFailed(version, message);
				return 'done';
			}
			const tries = (attempts.get(version.id) || 0) + 1;
			if (tries >= MAX_ATTEMPTS_PER_VERSION) {
				attempts.delete(version.id);
				await markFailed(version, message);
				return 'done';
			}
			attempts.set(version.id, tries);
			retryReason = message;
			return 'retry';
		}
		attempts.delete(version.id);

		// Next to the original, in the version's own folder, so /uploads/ access checks already
		// cover it (uploadAccess matches viewPdfPath) and deleting the version removes it too.
		const viewRelativePath = `${path.posix.dirname(originalRelativePath)}/${VIEW_PDF_FILE_NAME}`;
		const viewAbsolutePath = path.join(uploadDir, viewRelativePath);
		await fs.promises.writeFile(viewAbsolutePath, pdf);

		const data = { conversionStatus: 'COMPLETE', viewPdfPath: viewRelativePath, conversionError: null };
		// Old binary .doc/.ppt have no text extractor of their own, and Word files have no page
		// count. The PDF has both, which also makes those files searchable.
		if (!version.ocrText || version.pageCount == null) {
			try {
				const extracted = await extractDocumentText({ buffer: pdf, extension: 'pdf' });
				if (!version.ocrText && extracted && extracted.text) {
					data.ocrText = extracted.text;
					data.ocrStatus = 'COMPLETE';
					data.ocrError = null;
				}
				if (version.pageCount == null && extracted && extracted.pageCount) data.pageCount = extracted.pageCount;
			} catch {
				// The PDF still opens; the text is a bonus.
			}
		}

		const updated = await prisma.noteDocumentVersion.updateMany({ where: { id: version.id, deletedAt: null }, data });
		if (updated.count === 0) {
			// Deleted while it was converting. The delete already removed the other files; tidy ours.
			await fs.promises.rm(viewAbsolutePath, { force: true }).catch(() => undefined);
			return 'done';
		}
		await announce(version);
		return 'done';
	}

	let retryReason = '';

	function scheduleRetry(outcome) {
		if (stopped || retryTimer) return;
		if (outcome === 'unavailable' && !outageReported) {
			logger.warn(`[converter] Gotenberg isn't available at ${converter.url} (${retryReason}). Office files wait; conversion retries automatically.`);
			outageReported = true;
		}
		const delay = retryDelayMs;
		retryDelayMs = Math.min(RETRY_MAX_MS, retryDelayMs * 2);
		retryTimer = timers.setTimeout(() => {
			retryTimer = null;
			void runPass();
		}, delay);
		if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref();
	}

	function runPass() {
		if (!enabled || stopped) return Promise.resolve();
		if (currentPass) {
			wakeRequested = true;
			return currentPass;
		}
		currentPass = (async () => {
			try {
				do {
					wakeRequested = false;
					for (;;) {
						if (stopped) return;
						const version = await nextPendingVersion();
						if (!version) break;
						const outcome = await convertVersion(version);
						if (outcome !== 'done') {
							scheduleRetry(outcome);
							return;
						}
						retryDelayMs = RETRY_BASE_MS;
						if (outageReported) {
							logger.info('[converter] Gotenberg is converting again');
							outageReported = false;
						}
					}
				} while (wakeRequested && !stopped);
			} catch (error) {
				logger.error('[converter] Conversion pass failed:', error && error.message ? error.message : error);
				retryReason = error && error.message ? error.message : 'unexpected error';
				scheduleRetry('retry');
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
			logger.error('[converter] Startup check of pending conversions failed:', error && error.message ? error.message : error);
		}
		if (!enabled) {
			logger.info('[converter] GOTENBERG_URL not set: office documents open as text (conversion off)');
			return;
		}
		const health = await converter.checkHealth();
		if (health.ok) {
			logger.info(`[converter] Gotenberg${health.version ? ` ${health.version}` : ''} connected at ${converter.url}`);
		} else {
			logger.warn(`[converter] Gotenberg at ${converter.url} isn't healthy yet (${health.error}). Conversion retries automatically.`);
			outageReported = true;
		}
		await runPass();
	}

	/** A new office file was uploaded. During an outage the backoff timer already has it covered. */
	function notify() {
		if (!enabled || stopped || retryTimer) return;
		void runPass();
	}

	function stop() {
		stopped = true;
		if (retryTimer) {
			timers.clearTimeout(retryTimer);
			retryTimer = null;
		}
	}

	function whenIdle() {
		return currentPass || Promise.resolve();
	}

	return { enabled, start, notify, stop, runPass, whenIdle };
}

module.exports = { createDocumentConversionQueue, VIEW_PDF_FILE_NAME };
