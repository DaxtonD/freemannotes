'use strict';

const path = require('path');
const { spawn } = require('child_process');

const MAX_CONCURRENT_JOBS = 1;
const pendingImageIds = [];
const queuedImageIds = new Set();
let activeJobs = 0;

function runPythonOcr(imagePath) {
	const disabled = String(process.env.OCR_DISABLED || '').trim() === '1';
	if (disabled) {
		return Promise.resolve({ ok: true, text: '' });
	}

	const pythonBin = String(process.env.OCR_PYTHON_BIN || 'python3').trim() || 'python3';
	const scriptPath = path.join(__dirname, 'ocrRunner.py');

	return new Promise((resolve) => {
		const child = spawn(pythonBin, [scriptPath, imagePath], {
			cwd: path.dirname(scriptPath),
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString('utf-8');
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString('utf-8');
		});
		child.on('error', (err) => {
			resolve({ ok: false, error: err.message || 'ocr-process-error' });
		});
		child.on('close', () => {
			try {
				const parsed = JSON.parse(stdout || '{}');
				if (parsed && parsed.ok) {
					resolve({ ok: true, text: typeof parsed.text === 'string' ? parsed.text : '' });
					return;
				}
				resolve({ ok: false, error: parsed && parsed.error ? String(parsed.error) : stderr || 'ocr-failed' });
			} catch {
				resolve({ ok: false, error: stderr || stdout || 'ocr-output-invalid' });
			}
		});
	});
}

async function processNext(prisma) {
	if (activeJobs >= MAX_CONCURRENT_JOBS) return;
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
		const result = await runPythonOcr(imagePath);
		if (result.ok) {
			await prisma.noteImage.update({
				where: { id: imageId },
				data: {
					ocrStatus: 'COMPLETE',
					ocrText: result.text || '',
					ocrError: null,
				},
			});
		} else {
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
};