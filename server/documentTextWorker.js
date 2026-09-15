'use strict';

// Pulls the searchable text out of an uploaded document, in a worker thread. pdf-parse (pdf.js
// underneath) and the zip/spreadsheet readers are synchronous CPU work, and a big print set keeps
// them busy for many seconds. On the main thread that froze every WebSocket and request while it
// ran, so one person uploading plans stalled sync for everyone.

const fs = require('fs');
const { parentPort, workerData } = require('worker_threads');
const { extractDocumentText } = require('./noteDocumentPreview');

(async () => {
	const buffer = workerData.filePath
		? await fs.promises.readFile(workerData.filePath)
		: Buffer.from(workerData.bytes.buffer, workerData.bytes.byteOffset, workerData.bytes.byteLength);
	const result = await extractDocumentText({ buffer, extension: workerData.extension });
	parentPort.postMessage({ ok: true, result });
})().catch((error) => {
	parentPort.postMessage({ ok: false, error: error && error.message ? error.message : String(error) });
});
