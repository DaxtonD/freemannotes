'use strict';

// Server-side document helper pipeline:
// - extracts text from supported uploads for search and previews
// - generates preview/thumbnail art so note cards stay compact and fast

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
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
	'application/vnd.ms-powerpoint': 'ppt',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
	'text/plain': 'txt',
	'text/csv': 'csv',
	'text/markdown': 'md',
	'text/x-markdown': 'md',
};

const SUPPORTED_NOTE_DOCUMENT_EXTENSIONS = new Set([
	'pdf',
	'doc', 'docx', 'odt', 'rtf',
	'xls', 'xlsx', 'ods', 'csv',
	'ppt', 'pptx', 'odp',
	'txt', 'md',
]);

// Extracted text only exists for search and the little preview snippet. A 40 MB text
// file would otherwise land in one database row and ride along in every document list
// response, so keep the first chunk and call it a day.
const MAX_EXTRACTED_TEXT_CHARS = 100_000;

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
		case 'csv':
			return { label: extension.toUpperCase(), accent: '#15803d', surface: '#f0fdf4' };
		case 'ppt':
		case 'pptx':
		case 'odp':
			return { label: extension.toUpperCase(), accent: '#9a3412', surface: '#fff7ed' };
		case 'txt':
		case 'md':
			return { label: extension.toUpperCase(), accent: '#334155', surface: '#f8fafc' };
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
	// pdf-parse 2.x swapped the old `pdfParse(buffer)` function for a class. The old call
	// threw "not a function" on every single PDF, the LibreOffice fallback below then
	// quietly found nothing (LibreOffice isn't installed), and every PDF ever uploaded got
	// stored with no text and no page count. No error anywhere. Lovely.
	const parser = new PDFParse({ data: buffer });
	try {
		const parsed = await parser.getText();
		// Join the per-page text ourselves: the combined `text` has "-- 1 of 2 --" page
		// markers baked in, which we don't want in search results or snippets.
		const pages = Array.isArray(parsed?.pages) ? parsed.pages : [];
		const pageText = pages.map((page) => (page && typeof page.text === 'string' ? page.text : '')).join('\n\n');
		const fallbackText = typeof parsed?.text === 'string'
			? parsed.text.replace(/^-- \d+ of \d+ --$/gm, '')
			: '';
		const total = Number(parsed?.total);
		return {
			text: normalizeExtractedText(pageText.trim() ? pageText : fallbackText),
			pageCount: Number.isFinite(total) && total > 0 ? total : (pages.length || null),
		};
	} finally {
		await parser.destroy().catch(() => undefined);
	}
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

async function extractPresentationText(buffer) {
	// A .pptx is a zip with one XML file per slide; the visible words sit in <a:t> runs.
	// Sort numerically or slide10 lands between slide1 and slide2.
	const zip = await JSZip.loadAsync(buffer);
	const slideFiles = Object.keys(zip.files)
		.map((name) => ({ name, match: /^ppt\/slides\/slide(\d+)\.xml$/.exec(name) }))
		.filter((entry) => entry.match)
		.sort((a, b) => Number(a.match[1]) - Number(b.match[1]));
	const slides = [];
	for (const entry of slideFiles) {
		const xml = await zip.file(entry.name).async('string');
		const runs = [];
		const runPattern = /<a:t>([\s\S]*?)<\/a:t>/g;
		let run;
		while ((run = runPattern.exec(xml)) !== null) {
			runs.push(decodeHtmlEntities(run[1]));
		}
		if (runs.length > 0) slides.push(runs.join(' '));
	}
	return {
		text: normalizeExtractedText(slides.join('\n\n')),
		pageCount: slideFiles.length || null,
	};
}

function extractPlainText(buffer) {
	// Strip a UTF-8 byte order mark so it doesn't show up as junk in the preview.
	return {
		text: normalizeExtractedText(buffer.toString('utf8').replace(/^﻿/, '')),
		pageCount: null,
	};
}

async function extractDocumentText(args) {
	const result = await extractDocumentTextUncapped(args);
	if (result && typeof result.text === 'string' && result.text.length > MAX_EXTRACTED_TEXT_CHARS) {
		return { ...result, text: result.text.slice(0, MAX_EXTRACTED_TEXT_CHARS) };
	}
	return result;
}

async function extractDocumentTextUncapped(args) {
	const extension = String(args.extension || '').toLowerCase();
	try {
		if (extension === 'pdf') return await extractPdfText(args.buffer);
		if (extension === 'docx') return await extractDocxText(args.buffer);
		if (extension === 'xls' || extension === 'xlsx' || extension === 'ods') return extractWorkbookText(args.buffer);
		if (extension === 'odt' || extension === 'odp') return await extractOpenDocumentText(args.buffer);
		if (extension === 'pptx') return await extractPresentationText(args.buffer);
		if (extension === 'txt' || extension === 'md' || extension === 'csv') return extractPlainText(args.buffer);
		if (extension === 'rtf') return { text: stripRtfText(args.buffer.toString('utf8')), pageCount: null };
	} catch (error) {
		// Report the real failure. Returning a clean "no text" here is exactly how the
		// pdf-parse break hid for so long (behind a LibreOffice fallback that wasn't installed).
		return {
			text: '',
			pageCount: null,
			errorMessage: error && error.message ? error.message : 'Text extraction failed',
		};
	}

	// No extractor of our own for this format (old binary .doc/.ppt). With Gotenberg set up,
	// the conversion queue fills the text in from the PDF copy instead.
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
	MAX_EXTRACTED_TEXT_CHARS,
	SUPPORTED_NOTE_DOCUMENT_EXTENSIONS,
	createDocumentPreviewBuffers,
	extractDocumentText,
	getNormalizedDocumentExtension,
	isSupportedNoteDocument,
	sanitizeBaseName,
};