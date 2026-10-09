const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDocumentOcrQueue, canOcrDocumentExtension, pageNeedsOcr } = require('../server/documentOcrQueue');

const silent = { info() {}, warn() {}, error() {} };
// Long enough to clear MIN_TEXT_LAYER_CHARS_PER_PAGE, so these count as real text-layer pages.
const REAL_TEXT = 'This page has a genuine text layer on it.';

/**
 * Enough of Prisma's `where` to run the queue against: the operators it actually uses, and
 * nothing else. Anything unrecognised throws rather than quietly matching, so a query that grows
 * a new operator fails here instead of silently testing the wrong rows.
 */
function matches(row, where) {
	for (const [key, expected] of Object.entries(where || {})) {
		if (key === 'OR') {
			if (!expected.some((clause) => matches(row, clause))) return false;
			continue;
		}
		if (key === 'AND') {
			if (!expected.every((clause) => matches(row, clause))) return false;
			continue;
		}
		if (key === 'noteDocument') {
			if (expected.is && expected.is.deletedAt === null && row.noteDocument.deletedAt !== null) return false;
			continue;
		}
		if (expected && typeof expected === 'object') {
			if ('in' in expected) {
				if (!expected.in.includes(row[key])) return false;
				continue;
			}
			if ('notIn' in expected) {
				if (expected.notIn.includes(row[key])) return false;
				continue;
			}
			if ('not' in expected) {
				if (row[key] === expected.not) return false;
				continue;
			}
			throw new Error(`test matcher doesn't understand ${key}: ${JSON.stringify(expected)}`);
		}
		if (row[key] !== expected) return false;
	}
	return true;
}

function fakePrisma(versions) {
	const writes = [];
	return {
		writes,
		noteDocumentVersion: {
			updateMany: async ({ where, data }) => {
				let count = 0;
				for (const row of versions) {
					if (!matches(row, where)) continue;
					Object.assign(row, data);
					count += 1;
				}
				// Every progress write, in order, so the test can prove the counter never goes back.
				if ('ocrPagesDone' in data) writes.push(data.ocrPagesDone);
				return { count };
			},
			findFirst: async ({ where }) => versions
				.filter((row) => matches(row, where))
				.sort((left, right) => right.createdAt - left.createdAt)[0] || null,
		},
	};
}

/**
 * Stands in for the render worker. `pages` is the per-page text layer, so a '' entry is a page
 * that will need OCR. Records which pages were asked for, to prove pages with real text are
 * never rendered (rendering is the expensive half).
 */
function fakeRenderer(pages) {
	const renderedPages = [];
	let closed = false;
	return {
		renderedPages,
		get closed() { return closed; },
		open: async () => ({
			pageCount: pages.length,
			pageTexts: pages.map((text, index) => ({ num: index + 1, text })),
			renderPages: async (pageNumbers) => {
				renderedPages.push(...pageNumbers);
				return pageNumbers.map((pageNumber) => ({ pageNumber, png: Buffer.from(`png-${pageNumber}`), width: 1000, height: 2000 }));
			},
			close: async () => { closed = true; },
		}),
	};
}

function setup(t, rows, { pages = [], ocr = null, renderer = null } = {}) {
	const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fn-dococr-'));
	t.after(() => fs.rmSync(uploadDir, { recursive: true, force: true }));

	const versions = rows.map((row, index) => {
		const dir = `users/u1/documents/${row.id}`;
		const originalPath = `${dir}/file.${row.fileExtension || 'pdf'}`;
		if (row.writeOriginal !== false) {
			fs.mkdirSync(path.join(uploadDir, dir), { recursive: true });
			fs.writeFileSync(path.join(uploadDir, originalPath), '%PDF-1.7 fake');
			// An office file is read from its converted copy, so that has to exist on disk too.
			if (row.viewPdfPath) fs.writeFileSync(path.join(uploadDir, row.viewPdfPath), '%PDF-1.7 converted');
		}
		return {
			fileExtension: 'pdf',
			fileName: `file-${row.id}.pdf`,
			ocrStatus: 'PENDING',
			ocrText: '',
			ocrError: null,
			ocrPagesTotal: null,
			ocrPagesDone: null,
			ocrStartedAt: null,
			ocrCompletedAt: null,
			ocrLayout: null,
			pageCount: null,
			viewPdfPath: null,
			deletedAt: null,
			createdAt: index,
			originalPath,
			noteDocument: { docId: `ws-1:note-${row.id}`, sourceWorkspaceId: 'ws-1', deletedAt: null },
			...row,
		};
	});

	const prisma = fakePrisma(versions);
	const render = renderer || fakeRenderer(pages);
	const ocrCalls = [];
	const progress = [];
	const completed = [];

	const queue = createDocumentOcrQueue({
		prisma,
		uploadDir,
		openRenderer: render.open,
		runOcr: ocr || (async (paths, options) => {
			ocrCalls.push(paths.length);
			// Which page a file holds is read out of the bytes the renderer produced ('png-7'),
			// not out of the temp file's name — a version id with a dash in it would wreck that.
			const results = paths.map((imagePath, index) => {
				if (options && typeof options.onPage === 'function') options.onPage({ type: 'page', index });
				const pageNumber = fs.readFileSync(imagePath, 'utf8').replace('png-', '');
				// Boxes in the rendered page's pixel space, as the Python runner reports them.
				return {
					index,
					ok: true,
					text: `ocr:${pageNumber}`,
					lines: [{ text: `ocr:${pageNumber}`, box: [100, 200, 500, 240] }],
				};
			});
			return { ok: true, text: results[0] ? results[0].text : '', results };
		}),
		onProgress: async (event) => progress.push({ ...event, pagesDone: versions.find((row) => row.id === event.versionId).ocrPagesDone }),
		onComplete: async (event) => completed.push(event),
		logger: silent,
	});

	return { uploadDir, versions, queue, prisma, render, ocrCalls, progress, completed };
}

test('pageNeedsOcr: only a page with effectively nothing on it counts', () => {
	assert.equal(pageNeedsOcr(''), true);
	assert.equal(pageNeedsOcr('   \n  \t '), true);
	// A scanner's junk header isn't enough to call the page readable.
	assert.equal(pageNeedsOcr('Scan001'), true);
	assert.equal(pageNeedsOcr(REAL_TEXT), false);
});

test('only PDFs can be left waiting for OCR on upload', () => {
	assert.equal(canOcrDocumentExtension('pdf'), true);
	assert.equal(canOcrDocumentExtension('PDF'), true);
	// An office file has to wait for its Gotenberg copy, or it would say "reading text" forever.
	assert.equal(canOcrDocumentExtension('docx'), false);
	assert.equal(canOcrDocumentExtension('txt'), false);
});

test('a fully scanned PDF: every page is read and the text lands in page order', async (t) => {
	const { versions, queue, render, completed } = setup(t, [{ id: 'scan' }], { pages: ['', '', ''] });
	await queue.start();
	await queue.whenIdle();

	const row = versions[0];
	assert.equal(row.ocrStatus, 'COMPLETE');
	assert.equal(row.ocrText, 'ocr:1\n\nocr:2\n\nocr:3');
	assert.equal(row.ocrError, null);
	assert.deepEqual(render.renderedPages, [1, 2, 3]);
	// Progress is cleared on the way out, so nothing shows a stale counter afterwards.
	assert.equal(row.ocrStartedAt, null);
	assert.equal(row.ocrPagesTotal, null);
	assert.equal(row.ocrPagesDone, null);
	assert.equal(row.pageCount, 3);
	assert.equal(render.closed, true);
	assert.deepEqual(completed.map((event) => event.docId), ['ws-1:note-scan']);
});

test('a mixed PDF: pages that already have text keep it and are never rendered', async (t) => {
	const { versions, queue, render, ocrCalls } = setup(t, [{ id: 'mixed' }], {
		pages: ['', REAL_TEXT, ''],
	});
	await queue.start();
	await queue.whenIdle();

	const row = versions[0];
	assert.equal(row.ocrStatus, 'COMPLETE');
	// The middle page's own text, exactly as it was — OCR is a guess, a text layer is not.
	assert.equal(row.ocrText, `ocr:1\n\n${REAL_TEXT}\n\nocr:3`);
	assert.deepEqual(render.renderedPages, [1, 3]);
	assert.deepEqual(ocrCalls, [2]);
});

test('an ordinary digital PDF is finished without starting OCR at all', async (t) => {
	const { versions, queue, render, ocrCalls, progress } = setup(t, [{ id: 'digital' }], {
		pages: [REAL_TEXT, `${REAL_TEXT} Page two.`],
	});
	await queue.start();
	await queue.whenIdle();

	const row = versions[0];
	assert.equal(row.ocrStatus, 'COMPLETE');
	assert.equal(row.ocrText, `${REAL_TEXT}\n\n${REAL_TEXT} Page two.`);
	assert.deepEqual(render.renderedPages, []);
	assert.deepEqual(ocrCalls, []);
	// Nothing was ever "in progress", so no progress was announced.
	assert.deepEqual(progress, []);
});

test('progress is recorded while reading and only ever moves forward', async (t) => {
	// Eleven empty pages, so the default batch size of 4 means several rounds.
	const { versions, queue, prisma } = setup(t, [{ id: 'long' }], { pages: Array(11).fill('') });
	await queue.start();
	await queue.whenIdle();

	assert.equal(versions[0].ocrStatus, 'COMPLETE');
	assert.equal(versions[0].ocrText.split('\n\n').length, 11);
	// The counter starts at 0, ends at the page total, and never regresses in between — a
	// progress bar that goes 8, 9, 8 reads as a bug.
	const counters = prisma.writes.filter((value) => typeof value === 'number');
	assert.equal(counters[0], 0);
	assert.equal(counters[counters.length - 1], 11);
	for (let index = 1; index < counters.length; index += 1) {
		assert.ok(counters[index] >= counters[index - 1], `progress went backwards: ${counters.join(', ')}`);
	}
});

test('one unreadable page still saves the others, and says so', async (t) => {
	const { versions, queue } = setup(t, [{ id: 'partial' }], {
		pages: ['', '', ''],
		ocr: async (paths) => ({
			ok: true,
			text: 'ocr:1',
			results: paths.map((_, index) => (index === 1
				? { index, ok: false, error: 'paddleocr-run-failed: page exploded' }
				: { index, ok: true, text: `ocr:${index + 1}` })),
		}),
	});
	await queue.start();
	await queue.whenIdle();

	const row = versions[0];
	// Still COMPLETE: there IS text, just not all of it. Marking the whole thing failed would
	// throw away two good pages.
	assert.equal(row.ocrStatus, 'COMPLETE');
	assert.equal(row.ocrText, 'ocr:1\n\nocr:3');
	assert.match(row.ocrError, /1 of 3 page/);
});

test('a broken OCR runtime never marks documents failed, however many times it is tried', async (t) => {
	// The likeliest failure on a self-hosted box: a wrong OCR_PYTHON_BIN or a venv that didn't
	// build. If that failed the documents, every scan the user owns would be permanently FAILED
	// and fixing the config afterwards would never bring any of them back.
	let attempts = 0;
	const { versions, queue } = setup(t, [{ id: 'runtime-a' }, { id: 'runtime-b' }], {
		pages: [''],
		ocr: async () => {
			attempts += 1;
			return { ok: false, error: 'paddleocr-import-failed: No module named paddleocr', results: [] };
		},
	});
	for (let round = 0; round < 3; round += 1) {
		queue.scanSoon();
		await queue.whenIdle();
	}
	assert.equal(versions[0].ocrStatus, 'PENDING');
	assert.equal(versions[1].ocrStatus, 'PENDING');
	// One document per pass, then the pass gives up — it doesn't churn through every file
	// failing each one the same way.
	assert.equal(attempts, 3);
	assert.equal(versions[0].ocrCompletedAt, null);
});

test('a document-specific failure is retried once, then marked failed', async (t) => {
	let attempts = 0;
	const { versions, queue, completed } = setup(t, [{ id: 'broken' }], {
		pages: [''],
		ocr: async () => {
			attempts += 1;
			// Not a runtime problem — this document, specifically.
			return { ok: false, error: 'ocr-output-truncated', results: [] };
		},
	});
	await queue.start();
	await queue.whenIdle();
	// First failure holds it back rather than going straight round again.
	assert.equal(versions[0].ocrStatus, 'PENDING');
	assert.equal(attempts, 1);

	queue.scanSoon();
	await queue.whenIdle();
	assert.equal(attempts, 2);
	assert.equal(versions[0].ocrStatus, 'FAILED');
	assert.match(versions[0].ocrError, /truncated/);
	assert.equal(versions[0].ocrStartedAt, null);
	assert.deepEqual(completed.map((event) => event.docId), ['ws-1:note-broken']);
});

test('a scan that genuinely has no text on it is not re-read on every restart', async (t) => {
	let ocrRuns = 0;
	const { versions, queue } = setup(t, [{ id: 'blank' }], {
		pages: ['', ''],
		ocr: async (paths) => {
			ocrRuns += 1;
			return { ok: true, text: '', results: paths.map((_, index) => ({ index, ok: true, text: '' })) };
		},
	});
	await queue.start();
	await queue.whenIdle();

	assert.equal(versions[0].ocrStatus, 'COMPLETE');
	assert.equal(versions[0].ocrText, '');
	assert.equal(ocrRuns, 1);
	// An empty result is indistinguishable from the old never-OCR'd state by text alone, so
	// without the completion stamp the startup sweep would pick this up again every boot.
	assert.ok(versions[0].ocrCompletedAt instanceof Date);

	await queue.start();
	await queue.whenIdle();
	assert.equal(ocrRuns, 1, 'a second start re-read a document that had already been read');
	assert.equal(versions[0].ocrStatus, 'COMPLETE');
});

test('a missing file is failed, not retried forever', async (t) => {
	const { versions, queue } = setup(t, [{ id: 'gone', writeOriginal: false }], { pages: [''] });
	await queue.start();
	await queue.whenIdle();
	assert.equal(versions[0].ocrStatus, 'FAILED');
	assert.match(versions[0].ocrError, /missing on the server/);
});

test('startup queues the scans that were already uploaded and stamped COMPLETE with no text', async (t) => {
	const { versions, queue } = setup(t, [
		// The bug this whole queue exists for: uploaded before OCR existed, marked done, no text.
		{ id: 'old-scan', ocrStatus: 'COMPLETE', ocrText: '' },
		{ id: 'old-scan-null', ocrStatus: 'COMPLETE', ocrText: null },
		// Has text already — must be left alone, not re-read.
		{ id: 'has-text', ocrStatus: 'COMPLETE', ocrText: 'Already extracted' },
		// An office file with no PDF copy can't be rendered, so it isn't queued.
		{ id: 'office', ocrStatus: 'COMPLETE', ocrText: '', fileExtension: 'docx' },
	], { pages: [''] });

	await queue.start();
	await queue.whenIdle();

	const byId = Object.fromEntries(versions.map((row) => [row.id, row]));
	assert.equal(byId['old-scan'].ocrText, 'ocr:1');
	assert.equal(byId['old-scan-null'].ocrText, 'ocr:1');
	assert.equal(byId['has-text'].ocrText, 'Already extracted');
	assert.equal(byId.office.ocrStatus, 'COMPLETE');
	assert.equal(byId.office.ocrText, '');
});

test('an office file is picked up once its converted PDF copy exists', async (t) => {
	const { versions, queue } = setup(t, [
		{ id: 'converted', fileExtension: 'docx', viewPdfPath: 'users/u1/documents/converted/view.pdf' },
	], { pages: [''] });
	// The conversion queue sets PENDING and wakes us; the PDF copy is what makes it readable.
	await queue.start();
	await queue.whenIdle();
	assert.equal(versions[0].ocrStatus, 'COMPLETE');
	assert.equal(versions[0].ocrText, 'ocr:1');
});

test('with OCR switched off, every waiting row is cleared instead of saying "reading" forever', async (t) => {
	process.env.OCR_DISABLED = '1';
	t.after(() => { delete process.env.OCR_DISABLED; });
	const { versions, queue, ocrCalls } = setup(t, [
		{ id: 'stuck', ocrStatus: 'PENDING', ocrStartedAt: new Date(), ocrPagesTotal: 9, ocrPagesDone: 3 },
		// Never started — and with OCR off nothing is ever going to start it, so clearing only
		// the mid-read rows would leave this one saying "waiting to read text" permanently.
		{ id: 'queued-forever', ocrStatus: 'PENDING' },
	], { pages: [''] });

	await queue.start();
	await queue.whenIdle();

	assert.equal(versions[0].ocrStatus, 'COMPLETE');
	assert.equal(versions[0].ocrStartedAt, null);
	assert.equal(versions[0].ocrPagesTotal, null);
	assert.equal(versions[1].ocrStatus, 'COMPLETE');
	assert.deepEqual(ocrCalls, []);
});

test('a restart resets the page counters of whatever was mid-read', async (t) => {
	const { versions, queue } = setup(t, [
		{ id: 'interrupted', ocrStatus: 'PENDING', ocrStartedAt: new Date(), ocrPagesTotal: 9, ocrPagesDone: 3 },
	], { pages: ['', ''] });

	await queue.start();
	await queue.whenIdle();

	// Counters from a run that no longer exists would show a wrong estimate; it starts over.
	assert.equal(versions[0].ocrStatus, 'COMPLETE');
	assert.equal(versions[0].ocrText, 'ocr:1\n\nocr:2');
	assert.equal(versions[0].ocrPagesTotal, null);
	assert.equal(versions[0].ocrPagesDone, null);
});

test('extracted text is capped, so a 700-page scan does not ride along in every list response', async (t) => {
	// Every other extraction path caps at MAX_EXTRACTED_TEXT_CHARS (100k). This queue wrote the
	// merged text raw, which only shows up on a genuinely long document: ocrText is returned in
	// full by /api/note-documents for that note, every refresh.
	const { MAX_EXTRACTED_TEXT_CHARS } = require('../server/noteDocumentPreview');
	const pageText = 'x'.repeat(5000);
	const pageCount = Math.ceil((MAX_EXTRACTED_TEXT_CHARS * 2) / pageText.length);
	const { versions, queue } = setup(t, [{ id: 'huge' }], {
		pages: Array(pageCount).fill(''),
		ocr: async (paths) => ({
			ok: true,
			text: pageText,
			results: paths.map((_, index) => ({ index, ok: true, text: pageText })),
		}),
	});

	await queue.start();
	await queue.whenIdle();

	assert.equal(versions[0].ocrStatus, 'COMPLETE');
	assert.ok(
		versions[0].ocrText.length <= MAX_EXTRACTED_TEXT_CHARS,
		`ocrText is ${versions[0].ocrText.length} chars, over the ${MAX_EXTRACTED_TEXT_CHARS} cap`
	);
	// The cap must not be mistaken for "nothing was read".
	assert.ok(versions[0].ocrText.length > MAX_EXTRACTED_TEXT_CHARS / 2);
});

test('OCR boxes are stored as page fractions, keyed by page number', async (t) => {
	const { versions, queue } = setup(t, [{ id: 'boxes' }], { pages: ['', ''] });
	await queue.start();
	await queue.whenIdle();

	const layout = versions[0].ocrLayout;
	assert.ok(layout, 'no layout was stored for a scanned document');
	assert.equal(layout.v, 1);
	assert.deepEqual(Object.keys(layout.pages).sort(), ['1', '2']);
	// 1000x2000 page, box [100,200,500,240] -> left .1, top .1, width .4, height .02
	assert.deepEqual(layout.pages['1'][0].b, [0.1, 0.1, 0.4, 0.02]);
	assert.equal(layout.pages['1'][0].t, 'ocr:1');
	// Fractions, not pixels: nothing may exceed the page.
	for (const lines of Object.values(layout.pages)) {
		for (const line of lines) {
			const [left, top, width, height] = line.b;
			assert.ok(left >= 0 && top >= 0 && left + width <= 1 && top + height <= 1, `box outside page: ${line.b}`);
		}
	}
});

test('a digital PDF stores no layout at all', async (t) => {
	// pdf.js has its own text layer for these pages and never consults ours, so there is nothing
	// worth storing. Keeping it null also keeps the column meaningful: non-null means "scanned".
	const { versions, queue, render, ocrCalls } = setup(t, [{ id: 'digital2' }], { pages: [REAL_TEXT, REAL_TEXT] });
	await queue.start();
	await queue.whenIdle();

	assert.equal(versions[0].ocrLayout, null);
	assert.deepEqual(render.renderedPages, []);
	assert.deepEqual(ocrCalls, []);
});
