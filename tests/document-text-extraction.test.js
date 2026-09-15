const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractDocumentTextInWorker } = require('../server/documentTextExtraction');

function buildTinyPdf() {
	const content = 'BT /F1 18 Tf 20 100 Td (Hello blueprint) Tj ET';
	return Buffer.from([
		'%PDF-1.4',
		'1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
		'2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj',
		'3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 5 0 R/Resources<</Font<</F1 6 0 R>>>>>>endobj',
		'4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj',
		`5 0 obj<</Length ${content.length}>>stream`,
		content,
		'endstream endobj',
		'6 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
		'trailer<</Root 1 0 R>>',
		'%%EOF',
	].join('\n'));
}

test('reads a PDF on disk in a worker thread', async () => {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fn-text-'));
	try {
		const filePath = path.join(dir, 'plan.pdf');
		await fs.promises.writeFile(filePath, buildTinyPdf());
		const result = await extractDocumentTextInWorker({ filePath, extension: 'pdf' });
		assert.match(result.text, /Hello blueprint/);
		assert.equal(result.pageCount, 2);
		assert.equal(result.errorMessage, undefined);
	} finally {
		await fs.promises.rm(dir, { recursive: true, force: true });
	}
});

test('reads bytes handed to it (the converted PDF copies)', async () => {
	const text = await extractDocumentTextInWorker({ buffer: Buffer.from('Panel schedule\nL1'), extension: 'txt' });
	assert.match(text.text, /Panel schedule/);
});

test('a missing file comes back as a failed extraction instead of throwing', async () => {
	const result = await extractDocumentTextInWorker({ filePath: path.join(os.tmpdir(), 'fn-definitely-missing.pdf'), extension: 'pdf' });
	assert.equal(result.text, '');
	assert.ok(result.errorMessage);
});

test('a worker that runs out of time is stopped and reported, not left running', async () => {
	const result = await extractDocumentTextInWorker({ buffer: buildTinyPdf(), extension: 'pdf', timeoutMs: 1 });
	assert.equal(result.text, '');
	assert.match(result.errorMessage, /longer than/);
});

test('extractions beyond the concurrency limit wait their turn and all finish', async () => {
	const results = await Promise.all(Array.from({ length: 5 }, (_, index) => extractDocumentTextInWorker({ buffer: Buffer.from(`sheet ${index}`), extension: 'txt' })));
	assert.deepEqual(results.map((result) => result.text.trim()), ['sheet 0', 'sheet 1', 'sheet 2', 'sheet 3', 'sheet 4']);
});
