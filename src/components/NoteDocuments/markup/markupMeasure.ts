import { roundUnit } from './markupGeometry';
import type { MeasureMarkup, MeasureSystem, PageScale } from './markupTypes';

// Measuring on plans. Markup coordinates are PDF points (1/72 inch on the sheet as printed), so a
// page's scale is simply how much real length one point stands for: real inches per point for
// feet-and-inch sheets, real millimetres per point for metric ones. Every page keeps its own scale,
// because a set mixes 1/4" floor plans, 1-1/2" details and 1:100 site plans.

const POINTS_PER_INCH = 72;
const MM_PER_INCH = 25.4;

/** What a measurement label needs from its page: the scale (if any) and the "no scale" wording. */
export type MeasureContext = { scale: PageScale | null; noScale: string };

export type ScalePreset = {
	id: string;
	system: MeasureSystem;
	group: 'architectural' | 'engineering' | 'metric';
	label: string;
	/** Real inches (imperial) or millimetres (metric) per PDF point. */
	realPerUnit: number;
};

const architectural = (id: string, label: string, realInchesPerSheetInch: number): ScalePreset => ({
	id,
	system: 'imperial',
	group: 'architectural',
	label,
	realPerUnit: realInchesPerSheetInch / POINTS_PER_INCH,
});

const engineering = (feetPerInch: number): ScalePreset => ({
	id: `eng-${feetPerInch}`,
	system: 'imperial',
	group: 'engineering',
	label: `1" = ${feetPerInch}'`,
	realPerUnit: (feetPerInch * 12) / POINTS_PER_INCH,
});

const metric = (ratio: number): ScalePreset => ({
	id: `metric-${ratio}`,
	system: 'metric',
	group: 'metric',
	label: `1:${ratio}`,
	realPerUnit: (ratio * MM_PER_INCH) / POINTS_PER_INCH,
});

export const SCALE_PRESETS: readonly ScalePreset[] = [
	architectural('arch-1-32', `1/32" = 1'-0"`, 384),
	architectural('arch-1-16', `1/16" = 1'-0"`, 192),
	architectural('arch-3-32', `3/32" = 1'-0"`, 128),
	architectural('arch-1-8', `1/8" = 1'-0"`, 96),
	architectural('arch-3-16', `3/16" = 1'-0"`, 64),
	architectural('arch-1-4', `1/4" = 1'-0"`, 48),
	architectural('arch-3-8', `3/8" = 1'-0"`, 32),
	architectural('arch-1-2', `1/2" = 1'-0"`, 24),
	architectural('arch-3-4', `3/4" = 1'-0"`, 16),
	architectural('arch-1', `1" = 1'-0"`, 12),
	architectural('arch-1-1-2', `1-1/2" = 1'-0"`, 8),
	architectural('arch-3', `3" = 1'-0"`, 4),
	architectural('arch-full', `1" = 1"`, 1),
	...[10, 20, 30, 40, 50, 60, 100].map(engineering),
	...[1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].map(metric),
];

export function scalePresetById(id: string | undefined): ScalePreset | null {
	return id ? SCALE_PRESETS.find((preset) => preset.id === id) ?? null : null;
}

// ── Geometry ────────────────────────────────────────────────────────────────

export function polylineLength(points: readonly number[]): number {
	let total = 0;
	for (let index = 2; index + 1 < points.length; index += 2) {
		total += Math.hypot(points[index] - points[index - 2], points[index + 1] - points[index - 1]);
	}
	return total;
}

export function polygonArea(points: readonly number[]): number {
	const count = Math.floor(points.length / 2);
	if (count < 3) return 0;
	let sum = 0;
	for (let index = 0; index < count; index += 1) {
		const next = (index + 1) % count;
		sum += points[index * 2] * points[next * 2 + 1] - points[next * 2] * points[index * 2 + 1];
	}
	return Math.abs(sum) / 2;
}

/** The balance point of an area (falls back to the average of its corners for degenerate shapes). */
function polygonCentroid(points: readonly number[]): { x: number; y: number } {
	const count = Math.floor(points.length / 2);
	let area = 0;
	let cx = 0;
	let cy = 0;
	for (let index = 0; index < count; index += 1) {
		const next = (index + 1) % count;
		const cross = points[index * 2] * points[next * 2 + 1] - points[next * 2] * points[index * 2 + 1];
		area += cross;
		cx += (points[index * 2] + points[next * 2]) * cross;
		cy += (points[index * 2 + 1] + points[next * 2 + 1]) * cross;
	}
	if (Math.abs(area) < 1e-6) {
		let sx = 0;
		let sy = 0;
		for (let index = 0; index < count; index += 1) {
			sx += points[index * 2];
			sy += points[index * 2 + 1];
		}
		return { x: sx / Math.max(1, count), y: sy / Math.max(1, count) };
	}
	return { x: cx / (3 * area), y: cy / (3 * area) };
}

/** Where a measurement's label sits: halfway along a length or path, in the middle of an area. */
export function measureLabelPoint(markup: MeasureMarkup): { x: number; y: number } {
	const { points } = markup;
	if (markup.mode === 'area') return polygonCentroid(points);
	const half = polylineLength(points) / 2;
	let walked = 0;
	for (let index = 2; index + 1 < points.length; index += 2) {
		const ax = points[index - 2];
		const ay = points[index - 1];
		const segment = Math.hypot(points[index] - ax, points[index + 1] - ay);
		if (walked + segment >= half && segment > 0) {
			const t = (half - walked) / segment;
			return { x: ax + (points[index] - ax) * t, y: ay + (points[index + 1] - ay) * t };
		}
		walked += segment;
	}
	return { x: points[0] ?? 0, y: points[1] ?? 0 };
}

export function pointsPath(points: readonly number[], closed: boolean): string {
	let path = '';
	for (let index = 0; index + 1 < points.length; index += 2) path += `${index === 0 ? 'M' : 'L'}${roundUnit(points[index])} ${roundUnit(points[index + 1])}`;
	return closed && path ? `${path}Z` : path;
}

/** The short end marks of a length measurement, square to the line, like a dimension string. */
export function lengthTicks(points: readonly number[], width: number): Array<[number, number, number, number]> {
	if (points.length < 4) return [];
	const half = Math.max(width * 2.5, 4);
	const tick = (x: number, y: number, dx: number, dy: number): [number, number, number, number] => {
		const length = Math.hypot(dx, dy) || 1;
		const nx = (-dy / length) * half;
		const ny = (dx / length) * half;
		return [x - nx, y - ny, x + nx, y + ny];
	};
	const last = points.length - 2;
	return [
		tick(points[0], points[1], points[2] - points[0], points[3] - points[1]),
		tick(points[last], points[last + 1], points[last] - points[last - 2], points[last + 1] - points[last - 1]),
	];
}

export const measureLabelSize = (width: number): number => Math.max(9, width * 3.4);
export const pathVertexRadius = (width: number): number => Math.max(width * 1.1, 1.5);

// ── Formatting ──────────────────────────────────────────────────────────────

function formatNumber(value: number, maximumFractionDigits: number): string {
	try {
		return new Intl.NumberFormat(undefined, { maximumFractionDigits, minimumFractionDigits: 0 }).format(value);
	} catch {
		return value.toFixed(maximumFractionDigits);
	}
}

/** 150.5 inches → 12'-6 1/2". Quarter-inch precision, which is as fine as anyone reads a plan. */
export function formatFeetInches(totalInches: number): string {
	const quarters = Math.max(0, Math.round(totalInches * 4));
	const feet = Math.floor(quarters / 48);
	const rest = quarters - feet * 48;
	const inches = Math.floor(rest / 4);
	const fraction = ['', '1/4', '1/2', '3/4'][rest % 4];
	const inchText = inches === 0 && fraction ? `${fraction}"` : `${inches}${fraction ? ` ${fraction}` : ''}"`;
	return feet > 0 ? `${feet}'-${inchText}` : inchText;
}

/** The label a measurement shows: its real length or area at the page's scale, or its size on the sheet. */
export function formatMeasure(markup: MeasureMarkup, scale: PageScale | null, noScale: string): string {
	if (markup.mode === 'area') {
		const unitsSquared = polygonArea(markup.points);
		if (!scale) return `${formatNumber(unitsSquared / (POINTS_PER_INCH * POINTS_PER_INCH), 2)} sq in (${noScale})`;
		const realSquared = unitsSquared * scale.realPerUnit * scale.realPerUnit;
		if (scale.system === 'imperial') {
			const squareFeet = realSquared / 144;
			return `${formatNumber(squareFeet, squareFeet < 100 ? 1 : 0)} sq ft`;
		}
		return `${formatNumber(realSquared / 1e6, 2)} m²`;
	}
	const units = polylineLength(markup.points);
	if (!scale) return `${formatNumber(units / POINTS_PER_INCH, 2)}" (${noScale})`;
	if (scale.system === 'imperial') return formatFeetInches(units * scale.realPerUnit);
	const millimetres = units * scale.realPerUnit;
	return scale.metricUnit === 'm' ? `${formatNumber(millimetres / 1000, 2)} m` : `${formatNumber(millimetres, 0)} mm`;
}

/** How a page's scale reads in the tool bar: the standard scale's own name, or what a calibration works out to. */
export function scaleLabel(scale: PageScale | null, t: (key: string) => string): string {
	if (!scale) return t('documents.markupScaleNone');
	const preset = scalePresetById(scale.preset);
	if (preset && preset.system === scale.system) return preset.label;
	if (scale.system === 'imperial') return `${t('documents.markupScaleCalibrated')}: 1" = ${formatFeetInches(scale.realPerUnit * POINTS_PER_INCH)}`;
	return `${t('documents.markupScaleCalibrated')}: 1:${formatNumber((scale.realPerUnit * POINTS_PER_INCH) / MM_PER_INCH, 0)}`;
}

/** A typed length: "6", "6.5", "6,5", "1/2" or "6 1/2". Empty counts as zero; anything else is null. */
export function parseLengthNumber(text: string): number | null {
	const cleaned = text.trim().replace(',', '.');
	if (!cleaned) return 0;
	const mixed = /^(\d+(?:\.\d+)?)\s+(\d+)\/(\d+)$/.exec(cleaned);
	if (mixed) return Number(mixed[3]) > 0 ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) : null;
	const fraction = /^(\d+)\/(\d+)$/.exec(cleaned);
	if (fraction) return Number(fraction[2]) > 0 ? Number(fraction[1]) / Number(fraction[2]) : null;
	const plain = Number(cleaned);
	return Number.isFinite(plain) && plain >= 0 ? plain : null;
}

/** A scale switched to other display units, keeping the real length it represents. */
export function convertScaleSystem(scale: PageScale, system: MeasureSystem, metricUnit: 'mm' | 'm'): Omit<PageScale, 'page' | 'updatedAt'> {
	const sameSystem = scale.system === system;
	const realPerUnit = sameSystem ? scale.realPerUnit : system === 'metric' ? scale.realPerUnit * MM_PER_INCH : scale.realPerUnit / MM_PER_INCH;
	return {
		system,
		realPerUnit,
		...(system === 'metric' ? { metricUnit } : {}),
		...(sameSystem && scale.preset ? { preset: scale.preset } : {}),
	};
}
