// The maths behind scanning a page with a camera: find the sheet in the photo, straighten it, and
// clean it up so it reads like a scan rather than a snapshot. Deliberately plain functions over
// plain arrays — no canvas, no DOM — so the awkward parts (corner finding, the perspective warp,
// thresholding) can be tested directly.

export type Point = { x: number; y: number };
/** Four corners, always in this order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export type GrayImage = {
	data: Uint8ClampedArray;
	width: number;
	height: number;
};

export type RgbaImage = {
	data: Uint8ClampedArray;
	width: number;
	height: number;
};

/** Rec. 709 luma: closer to how bright things look than a flat average of the channels. */
export function toGrayscale(image: RgbaImage): GrayImage {
	const { data, width, height } = image;
	const gray = new Uint8ClampedArray(width * height);
	for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
		// Rounded, not truncated: the weights sum to 1 but land a hair under it in floating point, so
		// a flat grey 40 came out as 39 — enough to drop the Otsu split below the background and make
		// the whole frame look like one big page.
		gray[pixel] = Math.round(data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722);
	}
	return { data: gray, width, height };
}

/** Otsu's method: the brightness that best splits the picture into "page" and "everything else". */
export function otsuThreshold(gray: GrayImage): number {
	const histogram = new Array<number>(256).fill(0);
	for (const value of gray.data) histogram[value] += 1;
	const total = gray.data.length;
	let sum = 0;
	for (let level = 0; level < 256; level += 1) sum += level * histogram[level];
	let sumBackground = 0;
	let weightBackground = 0;
	let best = 0;
	let bestVariance = -1;
	for (let level = 0; level < 256; level += 1) {
		weightBackground += histogram[level];
		if (weightBackground === 0) continue;
		const weightForeground = total - weightBackground;
		if (weightForeground === 0) break;
		sumBackground += level * histogram[level];
		const meanBackground = sumBackground / weightBackground;
		const meanForeground = (sum - sumBackground) / weightForeground;
		const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
		if (variance > bestVariance) {
			bestVariance = variance;
			best = level;
		}
	}
	return best;
}

const fullFrameQuad = (width: number, height: number): Quad => ([
	{ x: 0, y: 0 },
	{ x: width, y: 0 },
	{ x: width, y: height },
	{ x: 0, y: height },
]);

export function quadArea(quad: Quad): number {
	let area = 0;
	for (let index = 0; index < 4; index += 1) {
		const current = quad[index];
		const next = quad[(index + 1) % 4];
		area += current.x * next.y - next.x * current.y;
	}
	return Math.abs(area) / 2;
}

/** Sorts any four corners into top-left, top-right, bottom-right, bottom-left. */
export function orderQuadCorners(points: readonly Point[]): Quad {
	if (points.length !== 4) throw new Error('A quad needs exactly four corners');
	const bySum = [...points].sort((left, right) => (left.x + left.y) - (right.x + right.y));
	const byDifference = [...points].sort((left, right) => (left.x - left.y) - (right.x - right.y));
	const topLeft = bySum[0];
	const bottomRight = bySum[3];
	const bottomLeft = byDifference[0] === topLeft || byDifference[0] === bottomRight ? byDifference[1] : byDifference[0];
	const topRight = byDifference[3] === topLeft || byDifference[3] === bottomRight ? byDifference[2] : byDifference[3];
	return [topLeft, topRight, bottomRight, bottomLeft];
}

/**
 * Where the sheet of paper is in the photo. Paper is the bright thing on a darker desk, so: split
 * light from dark, take the biggest light blob, and read its extreme corners. Anything that doesn't
 * look like a page (too small, too thin, barely a quadrilateral) falls back to the whole frame,
 * which the person can then drag into place themselves.
 */
export function detectDocumentQuad(gray: GrayImage): { quad: Quad; detected: boolean } {
	const { data, width, height } = gray;
	if (width < 8 || height < 8) return { quad: fullFrameQuad(width, height), detected: false };
	const threshold = otsuThreshold(gray);
	const visited = new Uint8Array(width * height);
	const queue = new Int32Array(width * height);
	let bestSize = 0;
	let bestCorners: Quad | null = null;
	let bestBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

	for (let start = 0; start < data.length; start += 1) {
		// Otsu's level belongs to the darker side, so the page is what sits strictly above it.
		if (visited[start] || data[start] <= threshold) continue;
		let head = 0;
		let tail = 0;
		queue[tail += 1] = start;
		visited[start] = 1;
		let size = 0;
		let minSum = Infinity;
		let maxSum = -Infinity;
		let minDifference = Infinity;
		let maxDifference = -Infinity;
		let topLeft = { x: 0, y: 0 };
		let bottomRight = { x: 0, y: 0 };
		let bottomLeft = { x: 0, y: 0 };
		let topRight = { x: 0, y: 0 };
		let minX = width;
		let minY = height;
		let maxX = -1;
		let maxY = -1;

		while (head < tail) {
			const index = queue[head += 1];
			const x = index % width;
			const y = (index / width) | 0;
			size += 1;
			const sum = x + y;
			const difference = x - y;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			if (sum < minSum) {
				minSum = sum;
				topLeft = { x, y };
			}
			if (sum > maxSum) {
				maxSum = sum;
				bottomRight = { x, y };
			}
			if (difference < minDifference) {
				minDifference = difference;
				bottomLeft = { x, y };
			}
			if (difference > maxDifference) {
				maxDifference = difference;
				topRight = { x, y };
			}
			// Four-way flood fill; the queue is sized for every pixel so it can never overflow.
			if (x > 0 && !visited[index - 1] && data[index - 1] > threshold) {
				visited[index - 1] = 1;
				queue[tail += 1] = index - 1;
			}
			if (x + 1 < width && !visited[index + 1] && data[index + 1] > threshold) {
				visited[index + 1] = 1;
				queue[tail += 1] = index + 1;
			}
			if (y > 0 && !visited[index - width] && data[index - width] > threshold) {
				visited[index - width] = 1;
				queue[tail += 1] = index - width;
			}
			if (y + 1 < height && !visited[index + width] && data[index + width] > threshold) {
				visited[index + width] = 1;
				queue[tail += 1] = index + width;
			}
		}

		if (size > bestSize) {
			bestSize = size;
			bestCorners = [topLeft, topRight, bottomRight, bottomLeft];
			bestBounds = { minX, minY, maxX, maxY };
		}
	}

	if (!bestCorners) return { quad: fullFrameQuad(width, height), detected: false };
	const area = quadArea(bestCorners);
	const frameArea = width * height;
	// A real page fills a good part of the frame, and its corners are actually apart from each other.
	const sides = bestCorners.map((corner, index) => {
		const next = bestCorners![(index + 1) % 4];
		return Math.hypot(next.x - corner.x, next.y - corner.y);
	});
	const shortestSide = Math.min(...sides);
	// Touching all four edges means nothing stood out from anything else — a blank wall, or a page
	// already cropped to the edges. Either way the whole frame is the answer, and claiming to have
	// found a page would be a lie that hides the "drag the corners yourself" prompt.
	const spansWholeFrame = bestBounds.minX <= 0 && bestBounds.minY <= 0
		&& bestBounds.maxX >= width - 1 && bestBounds.maxY >= height - 1
		&& area >= frameArea * 0.9;
	if (spansWholeFrame) return { quad: fullFrameQuad(width, height), detected: false };
	if (area < frameArea * 0.15 || shortestSide < Math.min(width, height) * 0.15) {
		return { quad: fullFrameQuad(width, height), detected: false };
	}
	return { quad: orderQuadCorners(bestCorners), detected: true };
}

/** The straightened page's size: the longest opposite edges, so nothing is squeezed. */
export function quadOutputSize(quad: Quad, maxSide = 2200): { width: number; height: number } {
	const distance = (from: Point, to: Point): number => Math.hypot(to.x - from.x, to.y - from.y);
	const width = Math.max(distance(quad[0], quad[1]), distance(quad[3], quad[2]));
	const height = Math.max(distance(quad[0], quad[3]), distance(quad[1], quad[2]));
	const scale = Math.min(1, maxSide / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/**
 * The 3×3 transform taking the output rectangle back to the four corners in the photo. Inverse by
 * design: warping samples the source for each destination pixel, which leaves no holes.
 */
export function computeInverseHomography(quad: Quad, width: number, height: number): number[] {
	const destination: Quad = [
		{ x: 0, y: 0 },
		{ x: width, y: 0 },
		{ x: width, y: height },
		{ x: 0, y: height },
	];
	// Solve for h in: source = H · destination, with h9 fixed at 1 (eight unknowns, eight equations).
	const matrix: number[][] = [];
	const vector: number[] = [];
	for (let index = 0; index < 4; index += 1) {
		const { x: dx, y: dy } = destination[index];
		const { x: sx, y: sy } = quad[index];
		matrix.push([dx, dy, 1, 0, 0, 0, -dx * sx, -dy * sx]);
		vector.push(sx);
		matrix.push([0, 0, 0, dx, dy, 1, -dx * sy, -dy * sy]);
		vector.push(sy);
	}
	const solution = solveLinearSystem(matrix, vector);
	return [...solution, 1];
}

/** Gaussian elimination with partial pivoting. Small fixed system, so clarity beats cleverness. */
export function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
	const size = vector.length;
	const augmented = matrix.map((row, index) => [...row, vector[index]]);
	for (let column = 0; column < size; column += 1) {
		let pivot = column;
		for (let row = column + 1; row < size; row += 1) {
			if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
		}
		if (Math.abs(augmented[pivot][column]) < 1e-12) throw new Error('These corners do not describe a quadrilateral');
		[augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
		for (let row = 0; row < size; row += 1) {
			if (row === column) continue;
			const factor = augmented[row][column] / augmented[column][column];
			if (factor === 0) continue;
			for (let term = column; term <= size; term += 1) augmented[row][term] -= factor * augmented[column][term];
		}
	}
	return augmented.map((row, index) => row[size] / row[index]);
}

/** Straightens the quad out of the photo into a rectangle, sampling bilinearly so edges stay smooth. */
export function warpQuadToRectangle(source: RgbaImage, quad: Quad, outputWidth: number, outputHeight: number): RgbaImage {
	const homography = computeInverseHomography(quad, outputWidth, outputHeight);
	const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = homography;
	const output = new Uint8ClampedArray(outputWidth * outputHeight * 4);
	const { data, width, height } = source;
	for (let y = 0; y < outputHeight; y += 1) {
		for (let x = 0; x < outputWidth; x += 1) {
			const denominator = h6 * x + h7 * y + h8;
			const sourceX = (h0 * x + h1 * y + h2) / denominator;
			const sourceY = (h3 * x + h4 * y + h5) / denominator;
			const target = (y * outputWidth + x) * 4;
			if (sourceX < 0 || sourceY < 0 || sourceX > width - 1 || sourceY > height - 1) {
				output[target] = 255;
				output[target + 1] = 255;
				output[target + 2] = 255;
				output[target + 3] = 255;
				continue;
			}
			const x0 = Math.floor(sourceX);
			const y0 = Math.floor(sourceY);
			const x1 = Math.min(x0 + 1, width - 1);
			const y1 = Math.min(y0 + 1, height - 1);
			const fx = sourceX - x0;
			const fy = sourceY - y0;
			for (let channel = 0; channel < 4; channel += 1) {
				const topLeft = data[(y0 * width + x0) * 4 + channel];
				const topRight = data[(y0 * width + x1) * 4 + channel];
				const bottomLeft = data[(y1 * width + x0) * 4 + channel];
				const bottomRight = data[(y1 * width + x1) * 4 + channel];
				const top = topLeft + (topRight - topLeft) * fx;
				const bottom = bottomLeft + (bottomRight - bottomLeft) * fx;
				output[target + channel] = top + (bottom - top) * fy;
			}
		}
	}
	return { data: output, width: outputWidth, height: outputHeight };
}

export type ScanFilter = 'colour' | 'grey' | 'bw';

export type ScanAdjustments = {
	filter: ScanFilter;
	/** -100…100, nudges the black point of the clean-up. */
	brightness: number;
	/** -100…100. */
	contrast: number;
};

export const DEFAULT_SCAN_ADJUSTMENTS: ScanAdjustments = { filter: 'bw', brightness: 0, contrast: 0 };

/**
 * A blurred copy of the image, used as the local "what counts as paper here" reference. Two
 * box-blur passes, each separable, so a big radius stays cheap on a phone.
 */
export function boxBlur(gray: GrayImage, radius: number): GrayImage {
	const { width, height } = gray;
	const source = gray.data;
	const horizontal = new Float32Array(width * height);
	const output = new Uint8ClampedArray(width * height);
	const window = radius * 2 + 1;
	for (let y = 0; y < height; y += 1) {
		let total = 0;
		const row = y * width;
		for (let x = -radius; x <= radius; x += 1) total += source[row + Math.min(width - 1, Math.max(0, x))];
		for (let x = 0; x < width; x += 1) {
			horizontal[row + x] = total / window;
			const leaving = source[row + Math.min(width - 1, Math.max(0, x - radius))];
			const entering = source[row + Math.min(width - 1, Math.max(0, x + radius + 1))];
			total += entering - leaving;
		}
	}
	for (let x = 0; x < width; x += 1) {
		let total = 0;
		for (let y = -radius; y <= radius; y += 1) total += horizontal[Math.min(height - 1, Math.max(0, y)) * width + x];
		for (let y = 0; y < height; y += 1) {
			output[y * width + x] = total / window;
			const leaving = horizontal[Math.min(height - 1, Math.max(0, y - radius)) * width + x];
			const entering = horizontal[Math.min(height - 1, Math.max(0, y + radius + 1)) * width + x];
			total += entering - leaving;
		}
	}
	return { data: output, width, height };
}

/**
 * The scan look: each pixel is compared with the paper around it rather than one threshold for the
 * whole page, so a shadow across the corner doesn't turn into a black block.
 */
export function applyScanFilter(image: RgbaImage, adjustments: ScanAdjustments): RgbaImage {
	const { width, height } = image;
	const output = new Uint8ClampedArray(image.data);
	if (adjustments.filter === 'colour') {
		applyLevels(output, adjustments);
		return { data: output, width, height };
	}
	const gray = toGrayscale(image);
	if (adjustments.filter === 'grey') {
		for (let pixel = 0; pixel < gray.data.length; pixel += 1) {
			const value = gray.data[pixel];
			output[pixel * 4] = value;
			output[pixel * 4 + 1] = value;
			output[pixel * 4 + 2] = value;
		}
		applyLevels(output, adjustments);
		return { data: output, width, height };
	}
	// Local mean over roughly a sixteenth of the page, which is wider than any letterform but
	// narrower than the lighting changes across a photo.
	const radius = Math.max(4, Math.round(Math.min(width, height) / 16));
	const background = boxBlur(gray, radius);
	// How much darker than its surroundings a pixel must be before it counts as ink. Paper sits a
	// little under this, which is what makes it go properly white instead of muddy grey; turning
	// brightness up widens the gap (more paper, less ink), and contrast steepens the change.
	const inkOffset = 12 + adjustments.brightness * 0.12;
	const softness = Math.max(2.5, 6 - adjustments.contrast * 0.03);
	for (let pixel = 0; pixel < gray.data.length; pixel += 1) {
		const difference = background.data[pixel] - gray.data[pixel] - inkOffset;
		// A soft step rather than a hard one: thin pencil lines survive instead of dropping out.
		const value = 255 / (1 + Math.exp(difference / softness));
		output[pixel * 4] = value;
		output[pixel * 4 + 1] = value;
		output[pixel * 4 + 2] = value;
		output[pixel * 4 + 3] = 255;
	}
	return { data: output, width, height };
}

function applyLevels(data: Uint8ClampedArray, adjustments: ScanAdjustments): void {
	const brightness = adjustments.brightness * 1.2;
	const contrast = (100 + adjustments.contrast) / 100;
	if (brightness === 0 && contrast === 1) return;
	for (let index = 0; index < data.length; index += 4) {
		for (let channel = 0; channel < 3; channel += 1) {
			const value = data[index + channel];
			data[index + channel] = (value - 128) * contrast + 128 + brightness;
		}
	}
}

/** Turns the corners found on a scaled-down copy back into coordinates on the full-size photo. */
export function scaleQuad(quad: Quad, scaleX: number, scaleY: number): Quad {
	return quad.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY })) as Quad;
}
