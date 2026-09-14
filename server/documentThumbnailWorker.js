'use strict';

// Renders page 1 of a PDF to a PNG, in a worker thread. Drawing a page is synchronous,
// CPU-heavy work (pdf.js plus a native canvas), and a big scanned page can take seconds. On the
// main thread that would freeze every WebSocket and request on the server while it drew.

const { parentPort, workerData } = require('worker_threads');
const { PDFParse } = require('pdf-parse');

(async () => {
	const parser = new PDFParse({ data: workerData.pdf });
	try {
		const result = await parser.getScreenshot({
			partial: [1],
			desiredWidth: workerData.width,
			imageDataUrl: false,
			imageBuffer: true,
		});
		const page = result.pages[0];
		if (!page || !page.data || page.data.length === 0) throw new Error('The first page rendered empty');
		const png = new Uint8Array(page.data);
		parentPort.postMessage({ ok: true, png, pageCount: result.total }, [png.buffer]);
	} finally {
		await parser.destroy().catch(() => undefined);
	}
})().catch((error) => {
	parentPort.postMessage({ ok: false, error: error && error.message ? error.message : String(error) });
});
