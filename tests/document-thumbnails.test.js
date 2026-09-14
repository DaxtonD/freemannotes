const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createDocumentThumbnailQueue, createFirstPagePreviews, renderFirstPagePng } = require('../server/documentThumbnails');

const silent = { info() {}, warn() {}, error() {} };

function tinyPdf(pages = 2) {
	const content = '0.1 0.3 0.8 rg 72 650 468 60 re f BT /F1 30 Tf 1 1 1 rg 90 668 Td (Page one) Tj ET';
	const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>'];
	const kids = [];
	for (let index = 0; index < pages; index += 1) kids.push(`${4 + index * 2} 0 R`);
	objects.push(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`);
	objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
	for (let index = 0; index < pages; index += 1) {
		const stream = index === 0 ? content : `BT /F1 24 Tf 72 700 Td (Page ${index + 1}) Tj ET`;
		objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
		objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
	}
	let pdf = '%PDF-1.4\n';
	const offsets = [];
	for (let n = 1; n < objects.length; n += 1) {
		offsets[n] = pdf.length;
		pdf += `${n} 0 obj\n${objects[n]}\nendobj\n`;
	}
	const xref = pdf.length;
	pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
	pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(pdf, 'latin1');
}

test('renders page 1 to a PNG in a worker thread', async () => {
	const png = await renderFirstPagePng(tinyPdf());
	assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
	const meta = await sharp(png).metadata();
	assert.equal(meta.width, 960);
	// US Letter proportions.
	assert.ok(Math.abs(meta.height - 1242) <= 2, `height ${meta.height}`);
	// The blue title bar really got drawn, so this isn't just a blank page.
	const { data } = await sharp(png).extract({ left: 400, top: 150, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
	assert.ok(data[2] > 150 && data[0] < 80, `pixel ${[...data]}`);
});

test('makes a 960 px preview and a 480 px thumbnail as WebP', async () => {
	const previews = await createFirstPagePreviews(tinyPdf(1));
	assert.equal(previews.previewWidth, 960);
	assert.equal(previews.thumbnailWidth, 480);
	assert.ok(Math.abs(previews.thumbnailHeight - 621) <= 2);
	for (const buffer of [previews.previewBuffer, previews.thumbnailBuffer]) {
		assert.equal(buffer.subarray(0, 4).toString('latin1'), 'RIFF');
		assert.equal(buffer.subarray(8, 12).toString('latin1'), 'WEBP');
	}
});

test('a file that is not a PDF rejects instead of hanging', async () => {
	await assert.rejects(renderFirstPagePng(Buffer.from('definitely not a pdf')));
});

test('a render that runs past the time limit is stopped', async () => {
	await assert.rejects(renderFirstPagePng(tinyPdf(), { timeoutMs: 1 }), /longer than|stopped/);
});

function matches(row, where) {
	if (where.deletedAt === null && row.deletedAt !== null) return false;
	if (where.originalPath && where.originalPath.not !== undefined && row.originalPath === where.originalPath.not) return false;
	if (where.noteDocument && row.noteDocument.deletedAt !== null) return false;
	if (where.NOT && where.NOT.thumbnailPath && String(row.thumbnailPath).endsWith(where.NOT.thumbnailPath.endsWith)) return false;
	if (where.OR && !where.OR.some((option) => (option.fileExtension ? row.fileExtension === option.fileExtension : row.conversionStatus === option.conversionStatus && row.viewPdfPath !== null))) return false;
	if (where.id && where.id.notIn && where.id.notIn.includes(row.id)) return false;
	if (typeof where.id === 'string' && row.id !== where.id) return false;
	return true;
}

function setup(t, rows, createPreviews) {
	const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fn-thumbs-'));
	t.after(() => fs.rmSync(uploadDir, { recursive: true, force: true }));
	const versions = rows.map((row, index) => {
		const dir = `users/u1/documents/${row.id}`;
		fs.mkdirSync(path.join(uploadDir, dir), { recursive: true });
		const originalPath = `${dir}/file.${row.fileExtension}`;
		fs.writeFileSync(path.join(uploadDir, originalPath), `original ${row.id}`);
		fs.writeFileSync(path.join(uploadDir, `${dir}/preview.webp`), 'text card');
		fs.writeFileSync(path.join(uploadDir, `${dir}/thumb.webp`), 'text card');
		if (row.viewPdfPath === true) fs.writeFileSync(path.join(uploadDir, `${dir}/view.pdf`), `copy ${row.id}`);
		return {
			deletedAt: null,
			conversionStatus: 'NOT_NEEDED',
			previewPath: `${dir}/preview.webp`,
			thumbnailPath: `${dir}/thumb.webp`,
			createdAt: index,
			originalPath,
			noteDocument: { docId: `ws-1:note-${row.id}`, sourceWorkspaceId: 'ws-1', deletedAt: null },
			...row,
			viewPdfPath: row.viewPdfPath === true ? `${dir}/view.pdf` : null,
		};
	});
	const prisma = {
		noteDocumentVersion: {
			findFirst: async ({ where }) => versions.filter((row) => matches(row, where)).sort((left, right) => right.createdAt - left.createdAt)[0] || null,
			updateMany: async ({ where, data }) => {
				const row = versions.find((candidate) => candidate.id === where.id && candidate.deletedAt === null);
				if (!row) return { count: 0 };
				Object.assign(row, data);
				return { count: 1 };
			},
		},
	};
	const announced = [];
	const rendered = [];
	const queue = createDocumentThumbnailQueue({
		prisma,
		uploadDir,
		logger: silent,
		onUpdated: async (event) => announced.push(event.docId),
		createPreviews: async (source) => {
			rendered.push(source.toString());
			return createPreviews(source, versions);
		},
	});
	return { uploadDir, versions, queue, announced, rendered };
}

const fakePreviews = () => ({
	previewBuffer: Buffer.from('preview'),
	previewWidth: 960,
	previewHeight: 1242,
	thumbnailBuffer: Buffer.from('thumb'),
	thumbnailWidth: 480,
	thumbnailHeight: 621,
});

test('queue: PDFs and converted office files get page previews, newest first; others are left alone', async (t) => {
	const { uploadDir, versions, queue, announced, rendered } = setup(t, [
		{ id: 'old-pdf', fileExtension: 'pdf' },
		{ id: 'plain-docx', fileExtension: 'docx' },
		{ id: 'converted-docx', fileExtension: 'docx', conversionStatus: 'COMPLETE', viewPdfPath: true },
		{ id: 'new-pdf', fileExtension: 'pdf' },
	], fakePreviews);
	await queue.start();

	assert.deepEqual(rendered, ['original new-pdf', 'copy converted-docx', 'original old-pdf']);
	assert.deepEqual(announced, ['ws-1:note-new-pdf', 'ws-1:note-converted-docx', 'ws-1:note-old-pdf']);
	const [oldPdf, plainDocx, convertedDocx] = versions;
	assert.equal(plainDocx.thumbnailPath, 'users/u1/documents/plain-docx/thumb.webp');
	assert.equal(convertedDocx.thumbnailPath, 'users/u1/documents/converted-docx/thumb-page.webp');
	assert.equal(oldPdf.previewPath, 'users/u1/documents/old-pdf/preview-page.webp');
	assert.equal(oldPdf.thumbnailWidth, 480);
	assert.equal(fs.readFileSync(path.join(uploadDir, oldPdf.thumbnailPath), 'utf8'), 'thumb');
	// The generated text-card images are cleaned up once replaced.
	assert.equal(fs.existsSync(path.join(uploadDir, 'users/u1/documents/old-pdf/thumb.webp')), false);
	assert.equal(fs.existsSync(path.join(uploadDir, 'users/u1/documents/plain-docx/thumb.webp')), true);

	// Nothing left to do: a second pass renders nothing.
	await queue.start();
	assert.equal(rendered.length, 3);
});

test('queue: a file that fails keeps its text card and is not retried this run', async (t) => {
	const { versions, queue, rendered } = setup(t, [
		{ id: 'locked', fileExtension: 'pdf' },
		{ id: 'fine', fileExtension: 'pdf' },
	], (source) => {
		if (source.toString() === 'original locked') throw new Error('PasswordException');
		return fakePreviews();
	});
	await queue.start();
	assert.equal(versions[0].thumbnailPath, 'users/u1/documents/locked/thumb.webp');
	assert.equal(versions[1].thumbnailPath, 'users/u1/documents/fine/thumb-page.webp');
	queue.scanSoon();
	await queue.whenIdle();
	assert.deepEqual(rendered, ['original fine', 'original locked']);
});

test('queue: a document deleted while rendering does not get its new files left behind', async (t) => {
	let versionsRef;
	const context = setup(t, [{ id: 'gone', fileExtension: 'pdf' }], () => {
		versionsRef[0].deletedAt = new Date();
		return fakePreviews();
	});
	versionsRef = context.versions;
	await context.queue.start();
	assert.equal(fs.existsSync(path.join(context.uploadDir, 'users/u1/documents/gone/thumb-page.webp')), false);
	assert.equal(context.announced.length, 0);
});
