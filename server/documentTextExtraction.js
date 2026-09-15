'use strict';

const path = require('path');
const { Worker } = require('worker_threads');
// Load pdf-parse (and the native canvas library it brings) on the main thread before any worker
// does. If a worker is the first to load it, the second worker to come along crashes the whole
// process with an access violation on Windows (checked: two workers in a row, crash every time;
// preloaded here, fine). The server happens to load it already via noteDocumentPreview, but that
// shouldn't be what keeps it standing.
require('pdf-parse');

// Runs extractDocumentText in a worker thread (see documentTextWorker.js) so a big document never
// blocks the server. Two at a time at most: each holds a whole document in memory, and a burst of
// large uploads shouldn't stack up gigabytes. The rest wait their turn.

const MAX_CONCURRENT_EXTRACTIONS = 2;
const EXTRACTION_TIMEOUT_MS = 120_000;
// A 250 MB plan set can legitimately need a lot of heap; a pathological file still can't take the
// whole server down with it.
const WORKER_HEAP_MB = 1024;

let running = 0;
const waiting = [];

function acquireSlot() {
	if (running < MAX_CONCURRENT_EXTRACTIONS) {
		running += 1;
		return Promise.resolve();
	}
	return new Promise((resolve) => waiting.push(resolve));
}

function releaseSlot() {
	const next = waiting.shift();
	// Hand the slot straight to the next in line rather than giving it back and racing for it.
	if (next) next();
	else running -= 1;
}

function runWorker(workerData, transferList, timeoutMs) {
	return new Promise((resolve, reject) => {
		const worker = new Worker(path.join(__dirname, 'documentTextWorker.js'), {
			workerData,
			transferList,
			resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
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
			finish(() => reject(new Error(`Reading the document's text took longer than ${Math.round(timeoutMs / 1000)} s`)));
		}, timeoutMs);
		if (typeof timer.unref === 'function') timer.unref();
		worker.once('message', (message) => finish(() => {
			if (message && message.ok) resolve(message.result);
			else reject(new Error((message && message.error) || 'Text extraction failed'));
		}));
		worker.once('error', (error) => finish(() => reject(error)));
		worker.once('exit', (code) => finish(() => reject(new Error(`The text reader stopped unexpectedly (exit ${code})`))));
	});
}

/**
 * Same result as extractDocumentText ({ text, pageCount, errorMessage? }), read from a file on disk
 * (`filePath`, preferred: nothing big crosses into the worker) or from bytes (`buffer`). Never
 * throws: a crashed, timed-out or out-of-memory worker comes back as a failed extraction, just like
 * a document the extractors couldn't read. The file still uploads either way.
 */
async function extractDocumentTextInWorker({ filePath, buffer, extension, timeoutMs = EXTRACTION_TIMEOUT_MS }) {
	await acquireSlot();
	try {
		const workerData = { extension };
		const transferList = [];
		if (filePath) {
			workerData.filePath = filePath;
		} else {
			// Copy first: a Buffer can be a slice of a shared pool, which can't be transferred.
			const bytes = new Uint8Array(buffer);
			workerData.bytes = bytes;
			transferList.push(bytes.buffer);
		}
		return await runWorker(workerData, transferList, timeoutMs);
	} catch (error) {
		return {
			text: '',
			pageCount: null,
			errorMessage: error && error.message ? error.message : 'Text extraction failed',
		};
	} finally {
		releaseSlot();
	}
}

module.exports = {
	MAX_CONCURRENT_EXTRACTIONS,
	extractDocumentTextInWorker,
};
