'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');

// How many PaddleOCR processes may run at once. One is the safe default — each holds its own
// copy of the model, so this multiplies memory, not just CPU — but a box with cores to spare
// shouldn't be stuck reading one page at a time. See OCR_MAX_CONCURRENT_JOBS in .env.example.
const DEFAULT_MAX_CONCURRENT_JOBS = 1;
// Per image, not per batch: a batch of 20 pages gets 20× this. Model loading is paid once per
// process and is the slow part of a single-page run, hence the generous floor.
const OCR_TIMEOUT_MS = 120000;
const pendingImageIds = [];
const queuedImageIds = new Set();
let activeJobs = 0;

function isOcrLoggingEnabled() {
	return String(process.env.OCR_LOG_OUTPUT || '').trim() === '1';
}

function isOcrDisabled() {
	return String(process.env.OCR_DISABLED || '').trim() === '1';
}

/**
 * An operator-supplied count, kept inside `min`..`max`. Anything unparseable falls back to the
 * default rather than quietly becoming 0 and stopping the queue dead — a typo in a Compose file
 * shouldn't look like "OCR is broken".
 */
function readIntEnv(name, fallback, min, max) {
	const raw = String(process.env[name] ?? '').trim();
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(min, Math.min(max, parsed));
}

function maxConcurrentImageJobs() {
	return readIntEnv('OCR_MAX_CONCURRENT_JOBS', DEFAULT_MAX_CONCURRENT_JOBS, 1, 64);
}

async function prepareOcrInputPath(imagePath) {
	if (!String(imagePath || '').toLowerCase().endsWith('.webp')) {
		return { imagePath, cleanup: async () => {} };
	}

	const tempPath = path.join(
		os.tmpdir(),
		`freemannotes-ocr-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
	);
	await sharp(imagePath).png().toFile(tempPath);
	return {
		imagePath: tempPath,
		cleanup: async () => {
			await fs.unlink(tempPath).catch(() => {});
		},
	};
}

/**
 * Reads one or more images in a single PaddleOCR process and resolves to
 * `{ ok, text, results: [{ index, ok, text?, error? }] }`. `text` is the first image's text, so
 * single-image callers can ignore `results` entirely.
 *
 * Several images per call is the whole point for a scanned PDF: constructing PaddleOCR loads a
 * few hundred MB of model and takes seconds, so one process per page would spend most of its
 * life starting up. `onPage` fires as each page comes back off stdout, which is what lets a
 * long document show a page counter instead of just hanging there.
 *
 * Never rejects — a crash, a timeout or unparseable output all come back as `ok: false`.
 */
async function runPythonOcrBatch(imagePaths, { onPage = null } = {}) {
	const inputs = Array.isArray(imagePaths) ? imagePaths.filter(Boolean) : [];
	if (inputs.length === 0) return { ok: true, text: '', results: [] };
	if (isOcrDisabled()) {
		return { ok: true, text: '', results: inputs.map((_, index) => ({ index, ok: true, text: '' })) };
	}

	const pythonBin = String(process.env.OCR_PYTHON_BIN || 'python3').trim() || 'python3';
	const scriptPath = path.join(__dirname, 'ocrRunner.py');
	const logOutput = isOcrLoggingEnabled();

	// Prepare them all up front so a failure here never leaves a half-converted set behind.
	const prepared = [];
	try {
		for (const imagePath of inputs) {
			prepared.push(await prepareOcrInputPath(imagePath));
		}
	} catch (error) {
		await Promise.all(prepared.map((entry) => entry.cleanup().catch(() => {})));
		return {
			ok: false,
			error: error && error.message ? error.message : 'ocr-input-preparation-failed',
			results: [],
		};
	}
	const cleanupAll = () => Promise.all(prepared.map((entry) => entry.cleanup().catch(() => {})));

	return new Promise((resolve) => {
		const child = spawn(pythonBin, [scriptPath, ...prepared.map((entry) => entry.imagePath)], {
			cwd: path.dirname(scriptPath),
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill('SIGKILL');
		}, OCR_TIMEOUT_MS * prepared.length);
		let stdout = '';
		let stderr = '';
		// stdout arrives in chunks that don't respect line boundaries, so hold the tail back until
		// a newline turns up rather than trying to JSON.parse half an object.
		let lineBuffer = '';
		const handleLine = (line) => {
			if (logOutput) console.info('[ocr][stdout]', line);
			if (typeof onPage !== 'function') return;
			// Only the streamed per-page lines; the summary is read from `stdout` at close.
			if (!line.includes('"type"')) return;
			try {
				const parsed = JSON.parse(line);
				if (parsed && parsed.type === 'page') onPage(parsed);
			} catch {
				// A log line that happens to mention "type". Nothing to do.
			}
		};
		child.stdout.on('data', (chunk) => {
			const text = chunk.toString('utf-8');
			stdout += text;
			lineBuffer += text;
			const lines = lineBuffer.split(/\r?\n/);
			lineBuffer = lines.pop() || '';
			for (const line of lines) {
				if (line.trim()) handleLine(line);
			}
		});
		child.stderr.on('data', (chunk) => {
			const text = chunk.toString('utf-8');
			stderr += text;
			if (logOutput) {
				for (const line of text.split(/\r?\n/).filter(Boolean)) {
					console.info('[ocr][stderr]', line);
				}
			}
		});
		child.on('error', (err) => {
			clearTimeout(timeout);
			void cleanupAll().finally(() => {
				resolve({ ok: false, error: err.message || 'ocr-process-error', results: [] });
			});
		});
		child.on('close', () => {
			clearTimeout(timeout);
			if (lineBuffer.trim()) handleLine(lineBuffer);
			void cleanupAll();
			try {
				const lastLine = String(stdout || '')
					.trim()
					.split(/\r?\n/)
					.filter(Boolean)
					.pop() || '{}';
				const parsed = JSON.parse(lastLine);
				// The summary is the only line without a `type`. This check is load-bearing: a run
				// killed by the timeout mid-batch ends with a per-page line, and those carry
				// `ok: true` of their own — reading that as the summary would report a batch that
				// never finished as a success with no text in it, silently losing those pages.
				const isSummary = parsed && typeof parsed === 'object' && parsed.type !== 'page';
				if (!isSummary) {
					resolve({
						ok: false,
						error: timedOut
							? `ocr-timed-out after ${Math.round((OCR_TIMEOUT_MS * prepared.length) / 1000)} s`
							: stderr || 'ocr-output-truncated',
						results: [],
					});
					return;
				}
				const results = Array.isArray(parsed.results) ? parsed.results : [];
				if (parsed.ok) {
					resolve({
						ok: true,
						text: typeof parsed.text === 'string' ? parsed.text : '',
						results,
					});
					return;
				}
				resolve({
					ok: false,
					error: parsed.error ? String(parsed.error) : stderr || 'ocr-failed',
					results,
				});
			} catch {
				resolve({
					ok: false,
					error: timedOut
						? `ocr-timed-out after ${Math.round((OCR_TIMEOUT_MS * prepared.length) / 1000)} s`
						: stderr || stdout || 'ocr-output-invalid',
					results: [],
				});
			}
		});
	});
}

async function runPythonOcr(imagePath) {
	const result = await runPythonOcrBatch([imagePath]);
	return result.ok ? { ok: true, text: result.text } : { ok: false, error: result.error };
}

async function processNext(prisma) {
	if (activeJobs >= maxConcurrentImageJobs()) return;
	const imageId = pendingImageIds.shift();
	if (!imageId) return;
	activeJobs += 1;
	queuedImageIds.delete(imageId);

	try {
		const image = await prisma.noteImage.findUnique({
			where: { id: imageId },
			select: { id: true, originalPath: true, deletedAt: true },
		});
		if (!image || image.deletedAt) return;
		const imagePath = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'), image.originalPath);
		if (isOcrLoggingEnabled()) {
			console.info('[ocr] starting image OCR:', imageId, imagePath);
		}
		const result = await runPythonOcr(imagePath);
		if (result.ok) {
			if (isOcrLoggingEnabled()) {
				console.info('[ocr] image OCR complete:', imageId, `${(result.text || '').length} chars`);
			}
			await prisma.noteImage.update({
				where: { id: imageId },
				data: {
					ocrStatus: 'COMPLETE',
					ocrText: result.text || '',
					ocrError: null,
				},
			});
		} else {
			console.warn('[ocr] image OCR failed:', imageId, result.error || 'ocr-failed');
			await prisma.noteImage.update({
				where: { id: imageId },
				data: {
					ocrStatus: 'FAILED',
					ocrError: String(result.error || 'ocr-failed').slice(0, 2000),
				},
			});
		}
	} catch (err) {
		console.error('[ocr] image processing error:', err && err.message ? err.message : err);
	} finally {
		activeJobs = Math.max(0, activeJobs - 1);
		void processNext(prisma);
	}
}

function queueNoteImageOcr(prisma, imageId) {
	if (!imageId || queuedImageIds.has(imageId)) return;
	queuedImageIds.add(imageId);
	pendingImageIds.push(imageId);
	void processNext(prisma);
}

module.exports = {
	queueNoteImageOcr,
	// Shared with server/documentOcrQueue.js so scanned PDFs and uploaded images go through the
	// same process spawning, temp-file handling and output parsing.
	runPythonOcrBatch,
	isOcrDisabled,
	isOcrLoggingEnabled,
	readIntEnv,
};