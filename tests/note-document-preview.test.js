const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const {
	MAX_EXTRACTED_TEXT_CHARS,
	extractDocumentText,
	getNormalizedDocumentExtension,
	isSupportedNoteDocument,
} = require('../server/noteDocumentPreview');

test('accepts the agreed document formats and nothing that could run as a page', () => {
	for (const name of ['a.pdf', 'a.doc', 'a.docx', 'a.odt', 'a.rtf', 'a.xls', 'a.xlsx', 'a.ods', 'a.csv', 'a.ppt', 'a.pptx', 'a.odp', 'a.txt', 'a.md']) {
		assert.equal(isSupportedNoteDocument(name), true, name);
	}
	for (const name of ['a.html', 'a.htm', 'a.svg', 'a.js', 'a.exe', 'a']) {
		assert.equal(isSupportedNoteDocument(name), false, name);
	}
});

test('falls back to the mime type when the file name has no extension', () => {
	assert.equal(getNormalizedDocumentExtension('slides', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'), 'pptx');
	assert.equal(getNormalizedDocumentExtension('notes', 'text/markdown'), 'md');
	assert.equal(isSupportedNoteDocument('export', 'text/csv'), true);
});

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

test('extracts PDF text and page count without the page marker lines', async () => {
	const result = await extractDocumentText({ buffer: buildTinyPdf(), extension: 'pdf' });
	assert.equal(result.pageCount, 2);
	assert.equal(result.text, 'Hello blueprint');
	assert.equal(result.errorMessage, undefined);
});

test('a broken PDF reports an error instead of pretending it had no text', async () => {
	const result = await extractDocumentText({ buffer: Buffer.from('definitely not a pdf'), extension: 'pdf', sourcePath: 'Z:/nowhere/broken.pdf' });
	assert.equal(result.text, '');
	assert.equal(typeof result.errorMessage, 'string');
	assert.ok(result.errorMessage.length > 0);
});

test('extracts slide text from a pptx in slide order', async () => {
	const zip = new JSZip();
	const slide = (text) => `<p:sld><p:cSld><p:spTree><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>`;
	zip.file('ppt/slides/slide2.xml', slide('Second &amp; last'));
	zip.file('ppt/slides/slide10.xml', slide('Tenth'));
	zip.file('ppt/slides/slide1.xml', slide('First'));
	const buffer = await zip.generateAsync({ type: 'nodebuffer' });
	const result = await extractDocumentText({ buffer, extension: 'pptx' });
	assert.equal(result.pageCount, 3);
	assert.equal(result.text, 'First\n\nSecond & last\n\nTenth');
});

test('reads plain text, markdown and csv as text and drops a byte order mark', async () => {
	const txt = await extractDocumentText({ buffer: Buffer.from('﻿Hello\nworld'), extension: 'txt' });
	assert.equal(txt.text, 'Hello\nworld');
	const csv = await extractDocumentText({ buffer: Buffer.from('name,qty\nbolts,12'), extension: 'csv' });
	assert.equal(csv.text, 'name,qty\nbolts,12');
	const md = await extractDocumentText({ buffer: Buffer.from('# Title\n\nBody'), extension: 'md' });
	assert.equal(md.text, '# Title\n\nBody');
});

test('caps stored text so a huge file cannot bloat every document list', async () => {
	const huge = Buffer.from('word '.repeat(MAX_EXTRACTED_TEXT_CHARS));
	const result = await extractDocumentText({ buffer: huge, extension: 'txt' });
	assert.equal(result.text.length, MAX_EXTRACTED_TEXT_CHARS);
});
