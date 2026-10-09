import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

// Find-in-PDF, minus the UI. pdf.js hands us each page's text as a pile of positioned
// strings ("runs"). We glue them into one searchable string per page, remember which run
// and character every letter came from, and turn a hit back into boxes on the page.

/** A highlight box as fractions of the page, so it lines up at any zoom without recomputing. */
export type PdfHighlightRect = { left: number; top: number; width: number; height: number };

export type PdfSearchMatch = { pageIndex: number; rects: PdfHighlightRect[] };

export type PdfPageHighlight = { index: number; rects: readonly PdfHighlightRect[] };

type TextRun = {
	originX: number;
	originY: number;
	/** Unit vector along the baseline. */
	alongX: number;
	alongY: number;
	/** Unit vector towards the top of the letters. */
	upX: number;
	upY: number;
	/** Width of the whole run along its baseline. */
	advance: number;
	fontHeight: number;
	/** Characters (UTF-16 units) in the run's original string. */
	length: number;
};

export type PdfPageText = {
	/** Folded text: lower case, accents off, whitespace squashed to single spaces. */
	text: string;
	hasText: boolean;
	runOfChar: Int32Array;
	/** Position in the run's string; -1 for the spaces we add at line ends. */
	offsetOfChar: Int32Array;
	runs: TextRun[];
	pageWidth: number;
	pageHeight: number;
};

export const EMPTY_PDF_PAGE_TEXT: PdfPageText = {
	text: '',
	hasText: false,
	runOfChar: new Int32Array(0),
	offsetOfChar: new Int32Array(0),
	runs: [],
	pageWidth: 1,
	pageHeight: 1,
};

const COMBINING_MARKS = /\p{M}/gu;
const WHITESPACE = /\s/;

// "Café", "CAFE" and "cafe" all find each other, and the "ﬁ" ligature some PDFs use finds "fi".
function foldCharacter(character: string): string {
	return character.normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase();
}

export function foldSearchQuery(query: string): string {
	let folded = '';
	for (const character of query) {
		if (WHITESPACE.test(character)) {
			if (folded && !folded.endsWith(' ')) folded += ' ';
			continue;
		}
		folded += foldCharacter(character);
	}
	return folded.trim();
}

function measureRun(item: TextItem, viewportTransform: number[]): TextRun {
	const [m0, m1, m2, m3, m4, m5] = viewportTransform;
	const [t0, t1, t2, t3, t4, t5] = item.transform as number[];
	// pdf.js's Util.transform written out: text space → page → viewport (top-left origin, page
	// rotation included), so rotated pages still get their boxes in the right place.
	const a = m0 * t0 + m2 * t1;
	const b = m1 * t0 + m3 * t1;
	const c = m0 * t2 + m2 * t3;
	const d = m1 * t2 + m3 * t3;
	const alongLength = Math.hypot(a, b);
	const upLength = Math.hypot(c, d);
	return {
		originX: m0 * t4 + m2 * t5 + m4,
		originY: m1 * t4 + m3 * t5 + m5,
		alongX: alongLength > 0 ? a / alongLength : 1,
		alongY: alongLength > 0 ? b / alongLength : 0,
		upX: upLength > 0 ? c / upLength : 0,
		upY: upLength > 0 ? d / upLength : -1,
		advance: item.width,
		fontHeight: upLength > 0 ? upLength : Math.abs(item.height),
		length: item.str.length,
	};
}

/** Reads one page's text. Local work on the already-open file, so it's fine offline. */
export async function readPdfPageText(pdf: PDFDocumentProxy, pageNumber: number): Promise<PdfPageText> {
	const page = await pdf.getPage(pageNumber);
	const viewport = page.getViewport({ scale: 1 });
	const content = await page.getTextContent();
	const characters: string[] = [];
	const runOfChar: number[] = [];
	const offsetOfChar: number[] = [];
	const runs: TextRun[] = [];
	let hasText = false;
	const pushSpace = (run: number, offset: number): void => {
		if (characters.length === 0 || characters[characters.length - 1] === ' ') return;
		characters.push(' ');
		runOfChar.push(run);
		offsetOfChar.push(offset);
	};
	for (const item of content.items) {
		if (!('str' in item)) continue;
		const run = runs.length;
		runs.push(measureRun(item, viewport.transform));
		const source = item.str;
		for (let offset = 0; offset < source.length;) {
			const character = String.fromCodePoint(source.codePointAt(offset) ?? 32);
			if (WHITESPACE.test(character)) {
				pushSpace(run, offset);
			} else {
				hasText = true;
				const folded = foldCharacter(character);
				for (let unit = 0; unit < folded.length; unit += 1) {
					characters.push(folded[unit]);
					runOfChar.push(run);
					offsetOfChar.push(offset);
				}
			}
			offset += character.length;
		}
		// Each line is its own item. Without this, "end of" + "line" reads "end ofline" and a
		// search for a phrase that wraps onto the next line finds nothing.
		if (item.hasEOL) pushSpace(run, -1);
	}
	return {
		text: characters.join(''),
		hasText,
		runOfChar: Int32Array.from(runOfChar),
		offsetOfChar: Int32Array.from(offsetOfChar),
		runs,
		pageWidth: viewport.width || 1,
		pageHeight: viewport.height || 1,
	};
}

/** One OCR'd line: its text, and its box as page fractions [left, top, width, height]. */
export type OcrLayoutLine = { t: string; b: [number, number, number, number] };

// rectForRunSlice builds its box from the baseline outwards: 0.9 of the font height above and
// 0.25 below, so a run's drawn height is 1.15x fontHeight. An OCR box is the whole line's
// extent, top to bottom, so to land exactly on it we work backwards through those constants
// rather than guessing a font size.
const RUN_ASCENT_RATIO = 0.9;
const RUN_DESCENT_RATIO = 0.25;
const RUN_TOTAL_RATIO = RUN_ASCENT_RATIO + RUN_DESCENT_RATIO;

/**
 * Builds the same structure `readPdfPageText` returns, from OCR'd lines instead of a pdf.js text
 * layer — so a scanned page goes through `findMatchesOnPage` and `rectsForRange` unchanged and
 * highlights exactly like a digital one.
 *
 * Geometry is kept in page fractions by setting pageWidth/pageHeight to 1: the boxes arrive as
 * fractions and the rect maths divides by those at the end, so it passes straight through.
 *
 * PaddleOCR gives one box per *line*, not per word, so a match inside a line is positioned by
 * character share along that box. That is the same approximation pdf.js already forces on us
 * for a partial run, and it reads correctly for a highlight.
 */
export function buildOcrPageText(lines: readonly OcrLayoutLine[]): PdfPageText {
	const characters: string[] = [];
	const runOfChar: number[] = [];
	const offsetOfChar: number[] = [];
	const runs: TextRun[] = [];
	let hasText = false;
	for (const line of lines) {
		const source = String(line?.t || '');
		const box = line?.b;
		if (!source || !Array.isArray(box) || box.length < 4) continue;
		const [left, top, width, height] = box.map(Number);
		if (![left, top, width, height].every((value) => Number.isFinite(value)) || width <= 0 || height <= 0) continue;
		const run = runs.length;
		const fontHeight = height / RUN_TOTAL_RATIO;
		runs.push({
			originX: left,
			// The baseline that makes the drawn box come out as exactly this line's box.
			originY: top + fontHeight * RUN_ASCENT_RATIO,
			alongX: 1,
			alongY: 0,
			upX: 0,
			// Viewport coordinates run downwards, so "up" is negative Y — same as pdf.js's.
			upY: -1,
			advance: width,
			fontHeight,
			length: source.length,
		});
		for (let offset = 0; offset < source.length;) {
			const character = String.fromCodePoint(source.codePointAt(offset) ?? 32);
			if (WHITESPACE.test(character)) {
				if (characters.length > 0 && characters[characters.length - 1] !== ' ') {
					characters.push(' ');
					runOfChar.push(run);
					offsetOfChar.push(offset);
				}
			} else {
				hasText = true;
				const folded = foldCharacter(character);
				for (let unit = 0; unit < folded.length; unit += 1) {
					characters.push(folded[unit]);
					runOfChar.push(run);
					offsetOfChar.push(offset);
				}
			}
			offset += character.length;
		}
		// Each OCR line is its own run, so a phrase spanning two lines needs the gap to exist.
		if (characters.length > 0 && characters[characters.length - 1] !== ' ') {
			characters.push(' ');
			runOfChar.push(run);
			offsetOfChar.push(-1);
		}
	}
	return {
		text: characters.join(''),
		hasText,
		runOfChar: Int32Array.from(runOfChar),
		offsetOfChar: Int32Array.from(offsetOfChar),
		runs,
		// Already fractions; dividing by 1 leaves them alone.
		pageWidth: 1,
		pageHeight: 1,
	};
}

function rectForRunSlice(run: TextRun, from: number, to: number, pageWidth: number, pageHeight: number): PdfHighlightRect {
	// pdf.js doesn't give per-letter positions, so a partial run is cut by character share.
	// Close enough for proportional fonts that nobody notices; exact for monospace.
	const start = run.length > 0 ? from / run.length : 0;
	const end = run.length > 0 ? Math.min(1, to / run.length) : 1;
	const startX = run.originX + run.alongX * run.advance * start;
	const startY = run.originY + run.alongY * run.advance * start;
	const endX = run.originX + run.alongX * run.advance * end;
	const endY = run.originY + run.alongY * run.advance * end;
	// Letters sit on the baseline with descenders hanging below it.
	const above = run.fontHeight * 0.9;
	const below = run.fontHeight * 0.25;
	const xs = [
		startX - run.upX * below, startX + run.upX * above,
		endX - run.upX * below, endX + run.upX * above,
	];
	const ys = [
		startY - run.upY * below, startY + run.upY * above,
		endY - run.upY * below, endY + run.upY * above,
	];
	const left = Math.min(...xs);
	const top = Math.min(...ys);
	return {
		left: left / pageWidth,
		top: top / pageHeight,
		width: (Math.max(...xs) - left) / pageWidth,
		height: (Math.max(...ys) - top) / pageHeight,
	};
}

function rectsForRange(page: PdfPageText, start: number, end: number): PdfHighlightRect[] {
	const rects: PdfHighlightRect[] = [];
	let run = -1;
	let low = 0;
	let high = 0;
	const flush = (): void => {
		if (run >= 0) rects.push(rectForRunSlice(page.runs[run], low, high + 1, page.pageWidth, page.pageHeight));
	};
	for (let index = start; index < end; index += 1) {
		const offset = page.offsetOfChar[index];
		if (offset < 0) continue;
		const charRun = page.runOfChar[index];
		if (charRun !== run) {
			flush();
			run = charRun;
			low = offset;
			high = offset;
		} else {
			low = Math.min(low, offset);
			high = Math.max(high, offset);
		}
	}
	flush();
	return rects;
}

/** Appends up to `limit` matches for an already-folded needle to `into`. */
export function findMatchesOnPage(page: PdfPageText, pageIndex: number, needle: string, limit: number, into: PdfSearchMatch[]): void {
	if (!needle || limit <= 0) return;
	let found = 0;
	let from = page.text.indexOf(needle);
	while (from >= 0 && found < limit) {
		into.push({ pageIndex, rects: rectsForRange(page, from, from + needle.length) });
		found += 1;
		from = page.text.indexOf(needle, from + needle.length);
	}
}
