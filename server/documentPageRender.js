'use strict';

const path = require('path');
const { Worker } = require('worker_threads');
// Loaded here before any worker loads it: a worker being first to load pdf-parse's native canvas
// library crashes the process when the next worker starts (see documentTextExtraction.js).
require('pdf-parse');

// Renders chosen pages of a PDF to PNG, for OCR. documentThumbnails.js does page 1 at thumbnail
// size and nothing else; this one takes a page list at a resolution you pick, and keeps the
// document open between calls.
//
// Why a session rather than a function call per chunk: OCR of a scanned document needs every
// page, and the two obvious approaches are both bad. All pages at once is hundreds of MB of
// bitmaps in memory (a 200-page scan at OCR resolution is gigabytes). A fresh worker per chunk
// re-opens and re-parses the whole PDF every time. So the worker stays alive holding one parsed
// document and renders whatever range the caller asks for next, which keeps peak memory at one
// chunk and the parse cost at one.

// Thumbnails render at 960px, which is fine to look at and poor to recognise text from — small
// print turns to mush and PaddleOCR returns nothing. 1600px keeps body text legible without the
// memory a 300dpi render would cost. Operators can raise it (OCR_DOCUMENT_RENDER_WIDTH_PX).
const DEFAULT_RENDER_WIDTH_PX = 1600;
const OPEN_TIMEOUT_MS = 60_000;
const RENDER_TIMEOUT_MS = 120_000;
// A pathological PDF shouldn't be able to take the whole server's memory with it. Higher than
// the thumbnail worker's 256 MB because this renders bigger pages, several per chunk.
const WORKER_HEAP_MB = 1024;

/**
 * Opens `pdfBuffer` in a worker and resolves to a session:
 *   `{ pageCount, pageTexts, renderPages(pageNumbers) → [{ pageNumber, png }], close() }`
 *
 * `renderPages` calls must not overlap — one worker, one document, one render at a time. Always
 * `close()` when done, including on failure, or the worker thread leaks.
 */
async function openPdfPageRenderer(pdfBuffer, { width = DEFAULT_RENDER_WIDTH_PX } = {}) {
	// Copy first: a Buffer from fs can be a slice of a shared pool, which can't be transferred.
	const bytes = new Uint8Array(pdfBuffer);
	const worker = new Worker(path.join(__dirname, 'documentPageRenderWorker.js'), {
		workerData: { pdf: bytes, width },
		transferList: [bytes.buffer],
		resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
	});

	let closed = false;
	let pending = null;
	const fail = (error) => {
		if (!pending) return;
		const reject = pending.reject;
		pending = null;
		reject(error);
	};

	worker.on('message', (message) => {
		if (!pending) return;
		const { resolve, reject } = pending;
		pending = null;
		if (message && message.ok) resolve(message);
		else reject(new Error((message && message.error) || 'Rendering the page failed'));
	});
	worker.on('error', (error) => fail(error));
	worker.on('exit', (code) => {
		// A clean close() exit has nothing waiting on it; anything else means we lost the worker
		// mid-request and the caller needs to hear about it rather than hang.
		if (!closed) fail(new Error(`The page renderer stopped unexpectedly (exit ${code})`));
	});

	function request(payload, timeoutMs) {
		if (closed) return Promise.reject(new Error('The page renderer is closed'));
		if (pending) return Promise.reject(new Error('The page renderer is already busy'));
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				fail(new Error(`Rendering took longer than ${Math.round(timeoutMs / 1000)} s`));
			}, timeoutMs);
			if (typeof timer.unref === 'function') timer.unref();
			pending = {
				resolve: (message) => {
					clearTimeout(timer);
					resolve(message);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			};
			if (payload) worker.postMessage(payload);
		});
	}

	async function close() {
		if (closed) return;
		closed = true;
		pending = null;
		await worker.terminate().catch(() => undefined);
	}

	let opened;
	try {
		// The worker opens the document on start and reports back before taking any requests.
		opened = await request(null, OPEN_TIMEOUT_MS);
	} catch (error) {
		await close();
		throw error;
	}

	return {
		pageCount: Number(opened.pageCount) || 0,
		/** What each page's text layer already holds: `[{ num, text }]`, page order. */
		pageTexts: Array.isArray(opened.pageTexts) ? opened.pageTexts : [],
		async renderPages(pageNumbers) {
			const pages = (Array.isArray(pageNumbers) ? pageNumbers : [])
				.map((value) => Number(value))
				.filter((value) => Number.isInteger(value) && value >= 1);
			if (pages.length === 0) return [];
			const message = await request({ pages }, RENDER_TIMEOUT_MS * pages.length);
			return (Array.isArray(message.pages) ? message.pages : []).map((page) => ({
				pageNumber: Number(page.pageNumber),
				png: Buffer.from(page.png),
			}));
		},
		close,
	};
}

module.exports = {
	DEFAULT_RENDER_WIDTH_PX,
	openPdfPageRenderer,
};
