const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDocumentConversionQueue } = require('../server/documentConversionQueue');
const { DocumentConversionError } = require('../server/documentConverter');

const PDF = Buffer.from('%PDF-1.7\nconverted');
const silent = { info() {}, warn() {}, error() {} };

function matches(row, where) {
	for (const [key, expected] of Object.entries(where || {})) {
		if (key === 'noteDocument') {
			if (expected.is && expected.is.deletedAt === null && row.noteDocument.deletedAt !== null) return false;
			continue;
		}
		if (expected && typeof expected === 'object' && Array.isArray(expected.in)) {
			if (!expected.in.includes(row[key])) return false;
			continue;
		}
		if (row[key] !== expected) return false;
	}
	return true;
}

function fakePrisma(versions) {
	return {
		versions,
		noteDocumentVersion: {
			updateMany: async ({ where, data }) => {
				let count = 0;
				for (const row of versions) {
					if (!matches(row, where)) continue;
					Object.assign(row, data);
					count += 1;
				}
				return { count };
			},
			findFirst: async ({ where }) => versions
				.filter((row) => matches(row, where))
				.sort((left, right) => left.createdAt - right.createdAt)[0] || null,
		},
	};
}

function fakeTimers() {
	const pending = [];
	return {
		pending,
		timers: {
			setTimeout: (fn, ms) => {
				const handle = { fn, ms };
				pending.push(handle);
				return handle;
			},
			clearTimeout: (handle) => {
				const index = pending.indexOf(handle);
				if (index >= 0) pending.splice(index, 1);
			},
		},
		async fire(queue) {
			const handle = pending.shift();
			handle.fn();
			await queue.whenIdle();
			return handle.ms;
		},
	};
}

function setup(t, rows, converterBehaviour) {
	const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fn-convert-'));
	t.after(() => fs.rmSync(uploadDir, { recursive: true, force: true }));
	const versions = rows.map((row, index) => {
		const dir = `users/u1/documents/${row.id}`;
		const originalPath = `${dir}/file.${row.fileExtension}`;
		if (row.writeOriginal !== false) {
			fs.mkdirSync(path.join(uploadDir, dir), { recursive: true });
			fs.writeFileSync(path.join(uploadDir, originalPath), `original ${row.id}`);
		}
		return {
			conversionStatus: 'NOT_NEEDED',
			viewPdfPath: null,
			conversionError: null,
			deletedAt: null,
			ocrText: '',
			ocrStatus: 'COMPLETE',
			pageCount: null,
			createdAt: index,
			originalPath,
			noteDocument: { docId: `ws-1:note-${row.id}`, sourceWorkspaceId: 'ws-1', deletedAt: null },
			...row,
		};
	});
	const prisma = fakePrisma(versions);
	const converted = [];
	const announced = [];
	const clock = fakeTimers();
	const converter = {
		enabled: converterBehaviour !== null,
		url: 'http://gotenberg:3000',
		checkHealth: async () => ({ ok: true, version: '8.37.0' }),
		convertToPdf: async ({ fileName }) => {
			converted.push(fileName);
			return converterBehaviour(fileName, converted.length);
		},
	};
	const queue = createDocumentConversionQueue({
		prisma,
		uploadDir,
		converter,
		extractDocumentText: async ({ extension }) => ({ text: extension === 'pdf' ? 'Words from the PDF' : '', pageCount: 3 }),
		onConverted: async (event) => announced.push(event),
		logger: silent,
		timers: clock.timers,
	});
	return { uploadDir, versions, queue, converted, announced, clock };
}

test('with Gotenberg: existing office files are queued and converted next to the original', async (t) => {
	const { uploadDir, versions, queue, announced } = setup(t, [
		{ id: 'v-docx', fileExtension: 'docx' },
		{ id: 'v-pdf', fileExtension: 'pdf' },
		{ id: 'v-doc', fileExtension: 'doc', ocrText: 'kept text', pageCount: 7 },
	], () => PDF);
	await queue.start();
	await queue.whenIdle();

	const [docx, pdf, doc] = versions;
	assert.equal(pdf.conversionStatus, 'NOT_NEEDED');
	assert.equal(docx.conversionStatus, 'COMPLETE');
	assert.equal(docx.viewPdfPath, 'users/u1/documents/v-docx/view.pdf');
	assert.deepEqual(fs.readFileSync(path.join(uploadDir, docx.viewPdfPath)), PDF);
	assert.equal(docx.ocrText, 'Words from the PDF');
	assert.equal(docx.pageCount, 3);
	// Text and page count that were already there are left alone.
	assert.equal(doc.conversionStatus, 'COMPLETE');
	assert.equal(doc.ocrText, 'kept text');
	assert.equal(doc.pageCount, 7);
	assert.deepEqual(announced.map((event) => event.docId), ['ws-1:note-v-docx', 'ws-1:note-v-doc']);
});

test('without Gotenberg: leftover PENDING rows are reset and nothing converts', async (t) => {
	const { versions, queue, converted } = setup(t, [{ id: 'v1', fileExtension: 'xlsx', conversionStatus: 'PENDING' }], null);
	await queue.start();
	await queue.whenIdle();
	assert.equal(versions[0].conversionStatus, 'NOT_NEEDED');
	assert.equal(converted.length, 0);
	queue.notify();
	await queue.whenIdle();
	assert.equal(converted.length, 0);
});

test('a rejected file fails straight away and the queue moves on', async (t) => {
	const { versions, queue } = setup(t, [
		{ id: 'bad', fileExtension: 'docx', conversionStatus: 'PENDING' },
		{ id: 'good', fileExtension: 'docx', conversionStatus: 'PENDING' },
	], (fileName) => {
		if (fileName === 'file.docx' && versions[0].conversionStatus === 'PENDING') {
			throw new DocumentConversionError('Gotenberg 400: rejected', 'rejected', 400);
		}
		return PDF;
	});
	await queue.runPass();
	assert.equal(versions[0].conversionStatus, 'FAILED');
	assert.match(versions[0].conversionError, /400/);
	assert.equal(versions[1].conversionStatus, 'COMPLETE');
});

test('an outage leaves files PENDING and backs off, doubling, without blaming the file', async (t) => {
	let up = false;
	const { versions, queue, clock, converted } = setup(t, [{ id: 'v1', fileExtension: 'pptx', conversionStatus: 'PENDING' }], () => {
		if (!up) throw new DocumentConversionError('Gotenberg unreachable: ECONNREFUSED', 'unavailable');
		return PDF;
	});
	await queue.runPass();
	assert.equal(versions[0].conversionStatus, 'PENDING');
	assert.equal(clock.pending.length, 1);
	assert.equal(clock.pending[0].ms, 30_000);

	// Uploads during the outage don't hammer Gotenberg; the timer has it.
	queue.notify();
	await queue.whenIdle();
	assert.equal(converted.length, 1);

	assert.equal(await clock.fire(queue), 30_000);
	assert.equal(versions[0].conversionStatus, 'PENDING');
	assert.equal(clock.pending[0].ms, 60_000);

	up = true;
	await clock.fire(queue);
	assert.equal(versions[0].conversionStatus, 'COMPLETE');
	assert.equal(clock.pending.length, 0);
});

test('a file that keeps failing is given up on after three tries', async (t) => {
	const { versions, queue, clock } = setup(t, [
		{ id: 'poison', fileExtension: 'xlsx', conversionStatus: 'PENDING' },
		{ id: 'fine', fileExtension: 'docx', conversionStatus: 'PENDING' },
	], (_fileName, callNumber) => {
		if (callNumber <= 3) throw new DocumentConversionError('Gotenberg 503: timeout', 'failed', 503);
		return PDF;
	});
	await queue.runPass();
	assert.equal(versions[0].conversionStatus, 'PENDING');
	await clock.fire(queue);
	assert.equal(versions[0].conversionStatus, 'PENDING');
	await clock.fire(queue);
	assert.equal(versions[0].conversionStatus, 'FAILED');
	assert.match(versions[0].conversionError, /503/);
	assert.equal(versions[1].conversionStatus, 'COMPLETE');
});

test('a missing original fails with a clear reason', async (t) => {
	const { versions, queue } = setup(t, [{ id: 'gone', fileExtension: 'odt', conversionStatus: 'PENDING', writeOriginal: false }], () => PDF);
	await queue.runPass();
	assert.equal(versions[0].conversionStatus, 'FAILED');
	assert.match(versions[0].conversionError, /missing/);
});

test('a document deleted mid-conversion is not resurrected and its PDF copy is removed', async (t) => {
	let versionsRef;
	const context = setup(t, [{ id: 'v1', fileExtension: 'docx', conversionStatus: 'PENDING' }], () => {
		versionsRef[0].deletedAt = new Date();
		return PDF;
	});
	versionsRef = context.versions;
	await context.queue.runPass();
	assert.equal(context.versions[0].conversionStatus, 'PENDING');
	assert.equal(context.versions[0].viewPdfPath, null);
	assert.equal(fs.existsSync(path.join(context.uploadDir, 'users/u1/documents/v1/view.pdf')), false);
	assert.equal(context.announced.length, 0);
});

test('stop cancels a pending retry', async (t) => {
	const { queue, clock } = setup(t, [{ id: 'v1', fileExtension: 'docx', conversionStatus: 'PENDING' }], () => {
		throw new DocumentConversionError('down', 'unavailable');
	});
	await queue.runPass();
	assert.equal(clock.pending.length, 1);
	queue.stop();
	assert.equal(clock.pending.length, 0);
});
