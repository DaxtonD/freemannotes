const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pageNeedsOcr } = require('../server/documentOcrQueue');

// buildOcrPageText is TypeScript in the client bundle, and the thing worth pinning is its
// arithmetic, not its types: a synthesised run has to produce a highlight box that lands exactly
// on the OCR line's own box. Get the ratios wrong and every highlight on a scanned page sits
// slightly too high or too tall, which is the kind of thing nobody notices until it ships.
//
// So: re-implement the two functions' maths here from the same constants the source uses, and
// assert they round-trip. The constants are read out of the source file, so if someone changes
// them on one side and not the other this fails rather than drifting.

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'NoteDocuments', 'pdfTextSearch.ts'), 'utf8');

function constantFromSource(name) {
	const match = new RegExp(`const ${name} = ([0-9.]+);`).exec(source);
	assert.ok(match, `${name} not found in pdfTextSearch.ts`);
	return Number(match[1]);
}

const ASCENT = constantFromSource('RUN_ASCENT_RATIO');
const DESCENT = constantFromSource('RUN_DESCENT_RATIO');
const TOTAL = ASCENT + DESCENT;

/** The run buildOcrPageText creates for one OCR line. */
function runForBox([left, top, width, height]) {
	const fontHeight = height / TOTAL;
	return {
		originX: left,
		originY: top + fontHeight * ASCENT,
		alongX: 1,
		alongY: 0,
		upX: 0,
		upY: -1,
		advance: width,
		fontHeight,
	};
}

/** rectForRunSlice, with pageWidth/pageHeight of 1 as buildOcrPageText uses. */
function rectForRunSlice(run, from, to, length) {
	const start = length > 0 ? from / length : 0;
	const end = length > 0 ? Math.min(1, to / length) : 1;
	const startX = run.originX + run.alongX * run.advance * start;
	const startY = run.originY + run.alongY * run.advance * start;
	const endX = run.originX + run.alongX * run.advance * end;
	const endY = run.originY + run.alongY * run.advance * end;
	const above = run.fontHeight * ASCENT;
	const below = run.fontHeight * DESCENT;
	const xs = [startX - run.upX * below, startX + run.upX * above, endX - run.upX * below, endX + run.upX * above];
	const ys = [startY - run.upY * below, startY + run.upY * above, endY - run.upY * below, endY + run.upY * above];
	const left = Math.min(...xs);
	const top = Math.min(...ys);
	return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} != ${b}`);

test('a whole OCR line highlights exactly its own box', () => {
	const box = [0.12, 0.34, 0.5, 0.02];
	const run = runForBox(box);
	const rect = rectForRunSlice(run, 0, 10, 10);
	close(rect.left, box[0], 'left');
	close(rect.top, box[1], 'top');
	close(rect.width, box[2], 'width');
	close(rect.height, box[3], 'height');
});

test('a match inside a line is positioned by character share, at the line height', () => {
	const box = [0.1, 0.2, 0.4, 0.03];
	const run = runForBox(box);
	// Characters 5..9 of a 20-character line: a quarter in, a fifth wide.
	const rect = rectForRunSlice(run, 5, 10, 20);
	close(rect.left, 0.1 + 0.4 * (5 / 20), 'left');
	close(rect.width, 0.4 * (5 / 20), 'width');
	close(rect.top, box[1], 'top');
	close(rect.height, box[3], 'height');
});

test('boxes stay inside the page, so a highlight can never be drawn off it', () => {
	const box = [0, 0, 1, 1];
	const rect = rectForRunSlice(runForBox(box), 0, 1, 1);
	assert.ok(rect.left >= 0 && rect.top >= 0, 'origin inside page');
	assert.ok(rect.left + rect.width <= 1 + 1e-9, 'right edge inside page');
	assert.ok(rect.top + rect.height <= 1 + 1e-9, 'bottom edge inside page');
});

test('the ratios in the source are the ones this test checks against', () => {
	// Guards the re-implementation above: if rectForRunSlice stops using these, this file is lying.
	assert.match(source, /const above = run\.fontHeight \* 0\.9;/);
	assert.match(source, /const below = run\.fontHeight \* 0\.25;/);
	assert.equal(ASCENT, 0.9);
	assert.equal(DESCENT, 0.25);
});

test('a page with real text is still left to pdf.js, not OCR', () => {
	// The other half of the contract: OCR geometry is only consulted where there is no text layer.
	assert.equal(pageNeedsOcr('This page has a genuine text layer on it.'), false);
	assert.equal(pageNeedsOcr(''), true);
});

// ── The wiring, not just the arithmetic ──────────────────────────────────────────────────────
//
// Correct geometry is useless if the boxes never reach the page. They did not, at first: the
// OCR layout arrives over the network while the page text is read locally, and on a scan every
// text layer is empty and reads in milliseconds — so the pages were always recorded as empty
// before the boxes landed, and the read loop never revisits a page. A scanned PDF searched
// correctly, highlighted nothing, and reported "no searchable text" about text it had found.

const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'NoteDocuments', 'PdfViewer.tsx'), 'utf8');
const viewerCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'NoteDocuments', 'PdfViewer.module.css'), 'utf8');

test('the page-text read re-runs when the OCR layout arrives', () => {
	// Without ocrLayout in the dependency array the effect never re-runs, and pages read before
	// the fetch resolved keep their empty text forever.
	assert.match(
		viewerSource,
		/\}, \[load, ocrLayout, textWanted\]\);/,
		'the page-text effect no longer depends on ocrLayout — scanned pages will never pick up their boxes'
	);
	// And it has to actually discard what it read without them.
	assert.match(viewerSource, /textsOcrLayoutRef\.current !== ocrLayout/);
	assert.match(viewerSource, /pageTextsRef\.current = \[\];/);
});

test('the sharpening canvas sits below the highlights, not over them', () => {
	// .canvasDetail is appended to the host after React's children, so an equal z-index is
	// decided by DOM order and this always wins — which hid every highlight past the zoom
	// threshold that creates it.
	const detail = /\.canvasDetail \{[^}]*\}/.exec(viewerCss);
	assert.ok(detail, '.canvasDetail rule not found');
	const detailZ = /z-index:\s*(-?\d+)/.exec(detail[0]);
	assert.ok(detailZ, '.canvasDetail has no z-index');

	const highlight = /\.highlight \{[^}]*\}/.exec(viewerCss);
	assert.ok(highlight, '.highlight rule not found');
	const highlightZ = /z-index:\s*(-?\d+)/.exec(highlight[0]);
	assert.ok(highlightZ, '.highlight has no z-index');

	assert.ok(
		Number(highlightZ[1]) > Number(detailZ[1]),
		`.highlight (${highlightZ[1]}) must stack above .canvasDetail (${detailZ[1]}), or zooming in hides every match`
	);
});
