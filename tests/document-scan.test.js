'use strict';

// Tests for the scanning maths in scan/documentScan.ts: finding the page in a photo, straightening
// it, and cleaning it up. All pure functions over plain arrays — no canvas, no DOM.

require('ts-node/register/transpile-only');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
	applyScanFilter,
	computeInverseHomography,
	detectDocumentQuad,
	orderQuadCorners,
	otsuThreshold,
	quadArea,
	quadOutputSize,
	solveLinearSystem,
	toGrayscale,
	warpQuadToRectangle,
} = require('../src/components/NoteDocuments/scan/documentScan.ts');

/** A photo-like image: a bright page (optionally skewed) on a dark desk. */
function buildPhoto({ width, height, corners, pageValue = 235, deskValue = 40 }) {
	const data = new Uint8ClampedArray(width * height * 4);
	const inside = (x, y) => {
		// Even-odd test against the quad.
		let hit = false;
		for (let index = 0, previous = 3; index < 4; previous = index, index += 1) {
			const a = corners[index];
			const b = corners[previous];
			if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
		}
		return hit;
	};
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const value = inside(x + 0.5, y + 0.5) ? pageValue : deskValue;
			const index = (y * width + x) * 4;
			data[index] = value;
			data[index + 1] = value;
			data[index + 2] = value;
			data[index + 3] = 255;
		}
	}
	return { data, width, height };
}

describe('finding the page', () => {
	it('sorts four corners into top-left, top-right, bottom-right, bottom-left', () => {
		const quad = orderQuadCorners([
			{ x: 10, y: 90 },
			{ x: 95, y: 12 },
			{ x: 8, y: 10 },
			{ x: 90, y: 92 },
		]);
		assert.deepEqual(quad.map((point) => [point.x, point.y]), [[8, 10], [95, 12], [90, 92], [10, 90]]);
	});

	it('picks the brightness that separates page from desk', () => {
		const photo = buildPhoto({ width: 40, height: 40, corners: [{ x: 5, y: 5 }, { x: 35, y: 5 }, { x: 35, y: 35 }, { x: 5, y: 35 }] });
		const threshold = otsuThreshold(toGrayscale(photo));
		assert.ok(threshold >= 40 && threshold < 235, `threshold sits between desk and page: ${threshold}`);
	});

	it('finds a straight page on a dark desk', () => {
		const corners = [{ x: 12, y: 8 }, { x: 108, y: 8 }, { x: 108, y: 132 }, { x: 12, y: 132 }];
		const photo = buildPhoto({ width: 120, height: 140, corners });
		const { quad, detected } = detectDocumentQuad(toGrayscale(photo));
		assert.equal(detected, true);
		for (let index = 0; index < 4; index += 1) {
			assert.ok(Math.abs(quad[index].x - corners[index].x) <= 2, `corner ${index} x: ${quad[index].x}`);
			assert.ok(Math.abs(quad[index].y - corners[index].y) <= 2, `corner ${index} y: ${quad[index].y}`);
		}
	});

	it('finds a page photographed at an angle', () => {
		const corners = [{ x: 22, y: 14 }, { x: 104, y: 6 }, { x: 112, y: 128 }, { x: 14, y: 118 }];
		const photo = buildPhoto({ width: 130, height: 140, corners });
		const { quad, detected } = detectDocumentQuad(toGrayscale(photo));
		assert.equal(detected, true);
		for (let index = 0; index < 4; index += 1) {
			assert.ok(Math.hypot(quad[index].x - corners[index].x, quad[index].y - corners[index].y) <= 4, `corner ${index}: ${JSON.stringify(quad[index])}`);
		}
	});

	it('falls back to the whole frame when there is no page to find', () => {
		const blank = buildPhoto({ width: 60, height: 60, corners: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], deskValue: 30 });
		const { quad, detected } = detectDocumentQuad(toGrayscale(blank));
		assert.equal(detected, false);
		assert.deepEqual(quad[0], { x: 0, y: 0 });
		assert.deepEqual(quad[2], { x: 60, y: 60 });
	});

	it('ignores a scrap of paper too small to be the page', () => {
		const photo = buildPhoto({ width: 100, height: 100, corners: [{ x: 10, y: 10 }, { x: 24, y: 10 }, { x: 24, y: 24 }, { x: 10, y: 24 }] });
		assert.equal(detectDocumentQuad(toGrayscale(photo)).detected, false);
	});
});

describe('straightening it', () => {
	it('solves the small linear system it needs', () => {
		const solution = solveLinearSystem([[2, 1], [1, 3]], [5, 10]);
		assert.ok(Math.abs(solution[0] - 1) < 1e-9);
		assert.ok(Math.abs(solution[1] - 3) < 1e-9);
	});

	it('maps the output rectangle back onto the photographed corners', () => {
		const quad = [{ x: 20, y: 12 }, { x: 96, y: 8 }, { x: 104, y: 120 }, { x: 12, y: 110 }];
		const homography = computeInverseHomography(quad, 200, 300);
		const project = (x, y) => {
			const w = homography[6] * x + homography[7] * y + homography[8];
			return { x: (homography[0] * x + homography[1] * y + homography[2]) / w, y: (homography[3] * x + homography[4] * y + homography[5]) / w };
		};
		const checks = [[0, 0, quad[0]], [200, 0, quad[1]], [200, 300, quad[2]], [0, 300, quad[3]]];
		for (const [x, y, expected] of checks) {
			const actual = project(x, y);
			assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-6, `${x},${y} -> ${JSON.stringify(actual)}`);
		}
	});

	it('warps a skewed page into a filled rectangle', () => {
		const corners = [{ x: 22, y: 14 }, { x: 104, y: 6 }, { x: 112, y: 128 }, { x: 14, y: 118 }];
		const photo = buildPhoto({ width: 130, height: 140, corners });
		const warped = warpQuadToRectangle(photo, corners, 80, 100);
		assert.equal(warped.width, 80);
		let bright = 0;
		for (let index = 0; index < warped.data.length; index += 4) {
			if (warped.data[index] > 200) bright += 1;
		}
		// The page filled the output; a mis-mapped warp would drag the dark desk in.
		assert.ok(bright / (80 * 100) > 0.95, `bright share ${(bright / 8000).toFixed(3)}`);
	});

	it('sizes the output from the longest edges, capped', () => {
		const size = quadOutputSize([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 6000 }, { x: 0, y: 6000 }], 2200);
		assert.equal(size.height, 2200);
		assert.ok(Math.abs(size.width - 1467) <= 2, `width ${size.width}`);
	});

	it('refuses corners that are not a quadrilateral', () => {
		assert.throws(() => computeInverseHomography([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], 10, 10));
	});

	it('measures a quad', () => {
		assert.equal(quadArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }]), 200);
	});
});

describe('cleaning it up', () => {
	/** A grey page, unevenly lit, with a band of darker "writing" across it. */
	function buildPage() {
		const width = 120;
		const height = 120;
		const data = new Uint8ClampedArray(width * height * 4);
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				// One corner is in shadow: the whole point of a local threshold.
				const lighting = 150 + Math.round(((x + y) / (width + height)) * 90);
				const isInk = y >= 50 && y < 56 && x >= 20 && x < 100;
				const value = isInk ? Math.max(0, lighting - 110) : lighting;
				const index = (y * width + x) * 4;
				data[index] = value;
				data[index + 1] = value;
				data[index + 2] = value;
				data[index + 3] = 255;
			}
		}
		return { data, width, height };
	}

	it('turns an unevenly lit page white with black writing', () => {
		const cleaned = applyScanFilter(buildPage(), { filter: 'bw', brightness: 0, contrast: 0 });
		const at = (x, y) => cleaned.data[(y * 120 + x) * 4];
		assert.ok(at(10, 10) > 200, `lit paper stays white: ${at(10, 10)}`);
		assert.ok(at(110, 110) > 200, `shadowed paper also goes white: ${at(110, 110)}`);
		assert.ok(at(60, 52) < 90, `writing goes dark: ${at(60, 52)}`);
	});

	it('greyscale keeps the shading instead of forcing black and white', () => {
		const grey = applyScanFilter(buildPage(), { filter: 'grey', brightness: 0, contrast: 0 });
		const lit = grey.data[(10 * 120 + 10) * 4];
		const shadowed = grey.data[(110 * 120 + 110) * 4];
		assert.ok(shadowed > lit, 'the lighting gradient survives');
		assert.ok(lit < 250, 'nothing is forced to pure white');
	});

	it('brightness pushes more of the page to white', () => {
		const page = buildPage();
		const darker = applyScanFilter(page, { filter: 'bw', brightness: -60, contrast: 0 });
		const brighter = applyScanFilter(page, { filter: 'bw', brightness: 60, contrast: 0 });
		const countWhite = (image) => {
			let total = 0;
			for (let index = 0; index < image.data.length; index += 4) if (image.data[index] > 200) total += 1;
			return total;
		};
		assert.ok(countWhite(brighter) > countWhite(darker), 'turning brightness up leaves less ink');
	});
});
