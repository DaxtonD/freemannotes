'use strict';

// Opens one PDF and serves the OCR queue (server/documentOcrQueue.js) two things from it: the
// text each page already has, and PNG renders of whichever pages the parent asks for next.
// Drawing a page is synchronous, CPU-heavy work (pdf.js plus a native canvas) and a scanned page
// at OCR resolution takes real time — on the main thread that would freeze every WebSocket and
// request on the server while it drew.
//
// Unlike documentThumbnailWorker.js this one stays alive: it parses the document once, then
// renders chunk by chunk. See documentPageRender.js for why.

const { parentPort, workerData } = require('worker_threads');
const { PDFParse } = require('pdf-parse');

const parser = new PDFParse({ data: workerData.pdf });
const width = Number(workerData.width) || 1600;

async function renderPages(pages) {
	const result = await parser.getScreenshot({
		partial: pages,
		desiredWidth: width,
		// The data URL is a base64 copy of every byte we already have. On a 200-page document
		// that's a great deal of string allocation for something nothing reads.
		imageDataUrl: false,
		imageBuffer: true,
	});
	const rendered = [];
	const transfers = [];
	for (const page of Array.isArray(result.pages) ? result.pages : []) {
		if (!page || !page.data || page.data.length === 0) continue;
		const png = new Uint8Array(page.data);
		// Width/height come back with the screenshot, so OCR's pixel coordinates can be turned
		// into page fractions without measuring the PNG again.
		rendered.push({ pageNumber: page.pageNumber, png, width: page.width, height: page.height });
		transfers.push(png.buffer);
	}
	parentPort.postMessage({ ok: true, pages: rendered }, transfers);
}

(async () => {
	// Parsing the document is slow on a big file, so it happens once, before the parent sends
	// anything, and the per-page text rides along on the ready message. The parent needs that
	// text to work out which pages have nothing on them worth keeping and therefore need OCR —
	// re-opening the file separately just to ask that would parse the whole thing twice.
	const parsed = await parser.getText();
	const pages = Array.isArray(parsed && parsed.pages) ? parsed.pages : [];
	const total = Number(parsed && parsed.total);
	parentPort.postMessage({
		ok: true,
		pageCount: Number.isFinite(total) && total > 0 ? total : pages.length,
		pageTexts: pages.map((page) => ({
			num: Number(page && page.num) || 0,
			text: page && typeof page.text === 'string' ? page.text : '',
		})),
	});

	parentPort.on('message', (message) => {
		const requested = Array.isArray(message && message.pages) ? message.pages : [];
		renderPages(requested).catch((error) => {
			parentPort.postMessage({ ok: false, error: error && error.message ? error.message : String(error) });
		});
	});
})().catch((error) => {
	parentPort.postMessage({ ok: false, error: error && error.message ? error.message : String(error) });
});
