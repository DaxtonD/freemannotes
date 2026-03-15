'use strict';

// Server-side document helper pipeline:
// - extracts text from supported uploads for search and previews
// - builds HTML viewers for non-PDF documents
// - generates preview/thumbnail art so note cards stay compact and fast

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const JSZip = require('jszip');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const sharp = require('sharp');
const XLSX = require('xlsx');

const PREVIEW_WIDTH = 960;
const PREVIEW_HEIGHT = 1200;
const THUMB_SIZE_PX = 360;
const DEFAULT_PREVIEW_LINES = 3;
const MAX_PREVIEW_LINE_LENGTH = 32;

const MIME_EXTENSION_MAP = {
	'application/pdf': 'pdf',
	'application/msword': 'doc',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
	'application/vnd.ms-excel': 'xls',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
	'application/vnd.oasis.opendocument.text': 'odt',
	'application/vnd.oasis.opendocument.spreadsheet': 'ods',
	'application/vnd.oasis.opendocument.presentation': 'odp',
	'application/rtf': 'rtf',
	'text/rtf': 'rtf',
};

const SUPPORTED_NOTE_DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'odt', 'ods', 'odp', 'rtf']);

function escapeHtml(value) {
	return String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function inferExtensionFromMimeType(mimeType) {
	return MIME_EXTENSION_MAP[String(mimeType || '').toLowerCase()] || '';
}

function getNormalizedDocumentExtension(fileName, mimeType = '') {
	const rawExt = path.extname(String(fileName || '')).replace(/^\./, '').trim().toLowerCase();
	return rawExt || inferExtensionFromMimeType(mimeType);
}

function isSupportedNoteDocument(fileName, mimeType = '') {
	return SUPPORTED_NOTE_DOCUMENT_EXTENSIONS.has(getNormalizedDocumentExtension(fileName, mimeType));
}

function sanitizeBaseName(fileName) {
	const extension = path.extname(String(fileName || ''));
	const baseName = path.basename(String(fileName || 'document'), extension).trim() || 'document';
	return baseName.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'document';
}

function normalizeExtractedText(text) {
	return String(text || '')
		.replace(/\r/g, '\n')
		.replace(/\t/g, ' ')
		.replace(/\u0000/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \f\v]+/g, ' ')
		.replace(/ ?\n ?/g, '\n')
		.trim();
}

function escapeXml(value) {
	return String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function decodeHtmlEntities(value) {
	return String(value || '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function stripMarkup(value) {
	return normalizeExtractedText(
		decodeHtmlEntities(String(value || ''))
			.replace(/<text:s\b[^>]*text:c="(\d+)"[^>]*\/?>/gi, (_match, count) => ' '.repeat(Math.max(1, Number(count) || 1)))
			.replace(/<[^>]+>/g, ' ')
	);
}

function stripRtfText(value) {
	return normalizeExtractedText(
		String(value || '')
			.replace(/\\par[d]?/gi, '\n')
			.replace(/\\tab/gi, ' ')
			.replace(/\\'[0-9a-fA-F]{2}/g, ' ')
			.replace(/\\[a-z]+-?\d* ?/gi, ' ')
			.replace(/[{}]/g, ' ')
	);
}

function getDocumentDescriptor(extension) {
	switch (extension) {
		case 'pdf':
			return { label: 'PDF', accent: '#c2410c', surface: '#fff7ed' };
		case 'doc':
		case 'docx':
		case 'odt':
		case 'rtf':
			return { label: extension.toUpperCase(), accent: '#1d4ed8', surface: '#eff6ff' };
		case 'xls':
		case 'xlsx':
		case 'ods':
			return { label: extension.toUpperCase(), accent: '#15803d', surface: '#f0fdf4' };
		case 'odp':
			return { label: 'ODP', accent: '#9a3412', surface: '#fff7ed' };
		default:
			return { label: extension ? extension.toUpperCase() : 'DOC', accent: '#334155', surface: '#f8fafc' };
	}
}

function wrapTextLines(value, maxLines = DEFAULT_PREVIEW_LINES) {
	const words = normalizeExtractedText(value).split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];
	const lines = [];
	let current = '';
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (candidate.length > MAX_PREVIEW_LINE_LENGTH && current) {
			lines.push(current);
			current = word;
			if (lines.length >= maxLines) break;
			continue;
		}
		current = candidate;
	}
	if (lines.length < maxLines && current) lines.push(current);
	return lines.slice(0, maxLines);
}

async function extractPdfText(buffer) {
	const parsed = await pdfParse(buffer);
	return {
		text: normalizeExtractedText(parsed && typeof parsed.text === 'string' ? parsed.text : ''),
		pageCount: Number.isFinite(parsed?.numpages) ? parsed.numpages : null,
	};
}

async function extractDocxText(buffer) {
	const result = await mammoth.extractRawText({ buffer });
	return {
		text: normalizeExtractedText(result && typeof result.value === 'string' ? result.value : ''),
		pageCount: null,
	};
}

function extractWorkbookText(buffer) {
	const workbook = XLSX.read(buffer, { type: 'buffer', cellText: true, cellDates: true });
	const sections = workbook.SheetNames.map((sheetName) => {
		const sheet = workbook.Sheets[sheetName];
		if (!sheet) return '';
		const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
		return csv ? `${sheetName}\n${csv}` : sheetName;
	});
	return {
		text: normalizeExtractedText(sections.filter(Boolean).join('\n\n')),
		pageCount: workbook.SheetNames.length || null,
	};
}

async function extractOpenDocumentText(buffer) {
	const zip = await JSZip.loadAsync(buffer);
	const contentXml = zip.file('content.xml');
	const rawXml = contentXml ? await contentXml.async('string') : '';
	return {
		text: stripMarkup(rawXml),
		pageCount: null,
	};
}

async function runLibreOfficeConvert(sourcePath) {
	return runLibreOfficeConversion(sourcePath, {
		format: 'txt:Text',
		extension: 'txt',
		binaries: ['soffice', 'libreoffice'],
	});
}

async function runLibreOfficeConversion(sourcePath, args) {
	const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'freemannotes-doc-'));
	try {
		// Try both common binary names so the same code works locally, in containers,
		// and on hosts where LibreOffice is installed under a different executable.
		for (const binary of Array.isArray(args.binaries) ? args.binaries : ['soffice', 'libreoffice']) {
			const result = await new Promise((resolve) => {
				const child = spawn(binary, ['--headless', '--convert-to', args.format, '--outdir', tempDir, sourcePath], {
					stdio: ['ignore', 'pipe', 'pipe'],
				});
				let stderr = '';
				child.stderr.on('data', (chunk) => {
					stderr += chunk.toString('utf-8');
				});
				child.on('error', (error) => resolve({ ok: false, error: error && error.message ? error.message : 'launch-failed' }));
				child.on('close', (code) => resolve({ ok: code === 0, error: stderr.trim() || `exit-${code}` }));
			});
			if (!result.ok) continue;
			const fileNames = await fs.promises.readdir(tempDir);
			const outputFile = fileNames.find((fileName) => fileName.toLowerCase().endsWith(`.${String(args.extension || '').toLowerCase()}`));
			if (!outputFile) continue;
			const contents = await fs.promises.readFile(path.join(tempDir, outputFile), 'utf8');
			return contents;
		}
		return '';
	} finally {
		await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

function buildViewerDocument({ title, body, extension }) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${escapeHtml(title)}</title>
	<style>
		:root {
			color-scheme: light;
			--surface: #f8fafc;
			--surface-strong: #ffffff;
			--border: #d9e2ec;
			--text: #0f172a;
			--muted: #64748b;
			--accent: #2563eb;
		}
		* { box-sizing: border-box; }
		body {
			margin: 0;
			font-family: Georgia, "Times New Roman", serif;
			background: linear-gradient(180deg, #f8fafc 0%, #eef4f8 100%);
			color: var(--text);
			padding: 24px;
		}
		.page {
			max-width: 980px;
			margin: 0 auto;
			background: var(--surface-strong);
			border: 1px solid var(--border);
			border-radius: 24px;
			box-shadow: 0 24px 48px rgba(15, 23, 42, 0.08);
			overflow: hidden;
		}
		.header {
			padding: 24px 28px 20px;
			border-bottom: 1px solid var(--border);
			background: linear-gradient(135deg, rgba(37, 99, 235, 0.10), rgba(15, 23, 42, 0.02));
		}
		.eyebrow {
			margin: 0 0 8px;
			font: 700 11px/1.2 system-ui, sans-serif;
			letter-spacing: 0.08em;
			text-transform: uppercase;
			color: var(--muted);
		}
		.title {
			margin: 0;
			font-size: 30px;
			line-height: 1.2;
			word-break: break-word;
		}
		.meta {
			margin: 8px 0 0;
			font: 500 13px/1.4 system-ui, sans-serif;
			color: var(--muted);
		}
		.content {
			padding: 28px;
			font-size: 16px;
			line-height: 1.7;
		}
		.content h1,
		.content h2,
		.content h3,
		.content h4 {
			font-family: Georgia, "Times New Roman", serif;
			color: var(--text);
		}
		.content table {
			width: 100%;
			border-collapse: collapse;
			margin: 16px 0 28px;
			font: 500 14px/1.5 system-ui, sans-serif;
		}
		.content th,
		.content td {
			border: 1px solid var(--border);
			padding: 8px 10px;
			vertical-align: top;
		}
		.content th {
			background: rgba(37, 99, 235, 0.08);
			text-align: left;
		}
		.content pre {
			white-space: pre-wrap;
			word-break: break-word;
			font: inherit;
			margin: 0;
		}
		.sheet + .sheet,
		.section + .section {
			margin-top: 28px;
			padding-top: 24px;
			border-top: 1px solid var(--border);
		}
		.sheet-title,
		.section-title {
			margin: 0 0 12px;
			font-size: 22px;
			line-height: 1.25;
		}
	</style>
</head>
<body>
	<main class="page">
		<header class="header">
			<p class="eyebrow">Freeman Notes read-only ${escapeHtml(extension ? extension.toUpperCase() : 'document')} viewer</p>
			<h1 class="title">${escapeHtml(title)}</h1>
			<p class="meta">This document is rendered read-only inside the app.</p>
		</header>
		<section class="content">
			${body}
		</section>
	</main>
</body>
</html>`;
}

function buildTextHtmlBody(text) {
	const normalized = normalizeExtractedText(text);
	if (!normalized) {
		return '<section class="section"><p>No extracted document text is available for this file.</p></section>';
	}
	const blocks = normalized.split(/\n\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
	return blocks.map((paragraph) => `<section class="section"><pre>${escapeHtml(paragraph)}</pre></section>`).join('');
}

async function buildWorkbookHtml(buffer) {
	const workbook = XLSX.read(buffer, { type: 'buffer', cellText: true, cellDates: true });
	const sections = workbook.SheetNames.map((sheetName, index) => {
		const sheet = workbook.Sheets[sheetName];
		if (!sheet) return '';
		const tableHtml = XLSX.utils.sheet_to_html(sheet, { id: `sheet-${index + 1}` });
		return `<section class="sheet"><h2 class="sheet-title">${escapeHtml(sheetName)}</h2>${tableHtml}</section>`;
	}).filter(Boolean);
	return sections.join('');
}

async function buildDocumentViewerHtml(args) {
	const extension = String(args.extension || '').toLowerCase();
	const title = path.basename(String(args.fileName || 'Document'));
	try {
		// Prefer richer native conversions when possible; only fall back to text rendering
		// when the source format or runtime environment cannot support a prettier preview.
		if (extension === 'docx') {
			const result = await mammoth.convertToHtml({ buffer: args.buffer });
			const html = String(result?.value || '').trim();
			if (html) {
				return buildViewerDocument({ title, body: html, extension });
			}
		}
		if (extension === 'xls' || extension === 'xlsx' || extension === 'ods') {
			const workbookHtml = await buildWorkbookHtml(args.buffer);
			if (workbookHtml) {
				return buildViewerDocument({ title, body: workbookHtml, extension });
			}
		}
	} catch {
		// Fall back to extracted text or LibreOffice rendering below.
	}

	if (args.sourcePath && (extension === 'doc' || extension === 'odt' || extension === 'odp' || extension === 'rtf')) {
		try {
			const libreOfficeHtml = await runLibreOfficeConversion(args.sourcePath, {
				format: 'html:XHTML Writer File:UTF8',
				extension: 'html',
				binaries: ['soffice', 'libreoffice'],
			});
			if (libreOfficeHtml.trim()) {
				return libreOfficeHtml;
			}
		} catch {
			// Fall through to text rendering.
		}
	}

	return buildViewerDocument({
		title,
		body: buildTextHtmlBody(args.extractedText || ''),
		extension,
	});
}

async function extractDocumentText(args) {
	const extension = String(args.extension || '').toLowerCase();
	try {
		if (extension === 'pdf') return await extractPdfText(args.buffer);
		if (extension === 'docx') return await extractDocxText(args.buffer);
		if (extension === 'xls' || extension === 'xlsx' || extension === 'ods') return extractWorkbookText(args.buffer);
		if (extension === 'odt' || extension === 'odp') return await extractOpenDocumentText(args.buffer);
		if (extension === 'rtf') return { text: stripRtfText(args.buffer.toString('utf8')), pageCount: null };
	} catch (error) {
		if (!args.sourcePath) {
			return {
				text: '',
				pageCount: null,
				errorMessage: error && error.message ? error.message : 'Text extraction failed',
			};
		}
	}

	if (args.sourcePath) {
		try {
			const libreOfficeText = await runLibreOfficeConvert(args.sourcePath);
			if (libreOfficeText) {
				return { text: libreOfficeText, pageCount: null };
			}
		} catch (error) {
			return {
				text: '',
				pageCount: null,
				errorMessage: error && error.message ? error.message : 'Text extraction failed',
			};
		}
	}

	return { text: '', pageCount: null };
}

async function createDocumentPreviewBuffers(args) {
	const descriptor = getDocumentDescriptor(args.extension);
	const fileLabel = path.basename(String(args.fileName || 'Document'));
	const previewSource = args.extractedText || fileLabel || descriptor.label;
	const previewLines = wrapTextLines(previewSource, 4);
	const fileLines = wrapTextLines(fileLabel, 2);
	const svg = `
		<svg width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg">
			<rect width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" rx="72" fill="#F8FAFC"/>
			<rect x="64" y="64" width="${PREVIEW_WIDTH - 128}" height="${PREVIEW_HEIGHT - 128}" rx="56" fill="${descriptor.surface}"/>
			<rect x="96" y="96" width="160" height="58" rx="29" fill="${descriptor.accent}"/>
			<text x="176" y="133" text-anchor="middle" font-family="Georgia, serif" font-size="28" font-weight="700" fill="#FFFFFF">${escapeXml(descriptor.label)}</text>
			${fileLines.map((line, index) => `<text x="96" y="${248 + index * 46}" font-family="Georgia, serif" font-size="34" font-weight="700" fill="#0F172A">${escapeXml(line)}</text>`).join('')}
			${previewLines.map((line, index) => `<text x="96" y="${428 + index * 52}" font-family="Georgia, serif" font-size="30" fill="#334155">${escapeXml(line)}</text>`).join('')}
			<rect x="96" y="${PREVIEW_HEIGHT - 180}" width="${PREVIEW_WIDTH - 192}" height="1" fill="#CBD5E1"/>
			<text x="96" y="${PREVIEW_HEIGHT - 120}" font-family="Georgia, serif" font-size="24" fill="#64748B">Freeman Notes document preview</text>
		</svg>
	`;
	const previewBuffer = await sharp(Buffer.from(svg)).webp({ quality: 88 }).toBuffer();
	const thumbnailBuffer = await sharp(previewBuffer).resize(THUMB_SIZE_PX, THUMB_SIZE_PX, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
	return {
		previewBuffer,
		thumbnailBuffer,
		previewWidth: PREVIEW_WIDTH,
		previewHeight: PREVIEW_HEIGHT,
		thumbnailWidth: THUMB_SIZE_PX,
		thumbnailHeight: THUMB_SIZE_PX,
	};
}

module.exports = {
	SUPPORTED_NOTE_DOCUMENT_EXTENSIONS,
	createDocumentPreviewBuffers,
	buildDocumentViewerHtml,
	extractDocumentText,
	getNormalizedDocumentExtension,
	isSupportedNoteDocument,
	sanitizeBaseName,
};