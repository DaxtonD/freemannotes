import React from 'react';
import { loadImage } from './avatarProfileImage';

type RgbColor = {
	r: number;
	g: number;
	b: number;
};

export type NoteBannerReadableColors = {
	backgroundColor: string;
	textColor: string;
	mutedTextColor: string;
	surfaceColor: string;
	controlBackgroundColor: string;
	controlBorderColor: string;
	textShadow: string;
};

export type NoteBannerSampleWindow = {
	startY?: number;
	endY?: number;
};

const readableColorCache = new Map<string, NoteBannerReadableColors>();

function clampChannel(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

function toHexChannel(value: number): string {
	return clampChannel(value).toString(16).padStart(2, '0');
}

function rgbToHex(color: RgbColor): string {
	return `#${toHexChannel(color.r)}${toHexChannel(color.g)}${toHexChannel(color.b)}`;
}

function parseHex(hex: string): RgbColor {
	const normalized = String(hex).trim().replace(/^#/, '');
	const full = normalized.length === 3
		? normalized.split('').map((part) => `${part}${part}`).join('')
		: normalized;
	return {
		r: Number.parseInt(full.slice(0, 2), 16),
		g: Number.parseInt(full.slice(2, 4), 16),
		b: Number.parseInt(full.slice(4, 6), 16),
	};
}

function mixRgb(base: RgbColor, overlay: RgbColor, overlayWeight: number): RgbColor {
	const clampedWeight = Math.max(0, Math.min(1, overlayWeight));
	const baseWeight = 1 - clampedWeight;
	return {
		r: base.r * baseWeight + overlay.r * clampedWeight,
		g: base.g * baseWeight + overlay.g * clampedWeight,
		b: base.b * baseWeight + overlay.b * clampedWeight,
	};
}

function mixHex(base: string, overlay: string, overlayWeight: number): string {
	return rgbToHex(mixRgb(parseHex(base), parseHex(overlay), overlayWeight));
}

function relativeLuminance(color: RgbColor): number {
	const transform = (channel: number): number => {
		const normalized = channel / 255;
		return normalized <= 0.03928
			? normalized / 12.92
			: Math.pow((normalized + 0.055) / 1.055, 2.4);
	};

	return 0.2126 * transform(color.r) + 0.7152 * transform(color.g) + 0.0722 * transform(color.b);
}

function resolveReadableTextColor(red: number, green: number, blue: number): string {
	return relativeLuminance({ r: red, g: green, b: blue }) > 0.43 ? '#1f1f1f' : '#f7f7f7';
}

function normalizeSampleWindow(sampleWindow?: NoteBannerSampleWindow): Required<NoteBannerSampleWindow> {
	const startY = Number.isFinite(sampleWindow?.startY) ? Number(sampleWindow?.startY) : 0;
	const endY = Number.isFinite(sampleWindow?.endY) ? Number(sampleWindow?.endY) : 1;
	return {
		startY: Math.max(0, Math.min(1, startY)),
		endY: Math.max(0, Math.min(1, endY)),
	};
}

function buildReadableColors(backgroundColor: string, textColor: string): NoteBannerReadableColors {
	const darkText = textColor === '#1f1f1f';
	return {
		backgroundColor,
		textColor,
		mutedTextColor: mixHex(textColor, backgroundColor, darkText ? 0.34 : 0.42),
		surfaceColor: darkText ? 'rgba(255, 255, 255, 0.18)' : 'rgba(18, 22, 28, 0.24)',
		controlBackgroundColor: darkText ? 'rgba(255, 255, 255, 0.46)' : 'rgba(20, 22, 28, 0.28)',
		controlBorderColor: darkText ? 'rgba(24, 28, 34, 0.14)' : 'rgba(255, 255, 255, 0.18)',
		textShadow: darkText ? '0 1px 1px rgba(255, 255, 255, 0.14)' : '0 1px 2px rgba(0, 0, 0, 0.34)',
	};
}

export function resolveNoteBannerReadableColors(backgroundColor: string): NoteBannerReadableColors {
	// Centralize the readable-color derivation so sampled banner colors and
	// post-transform banner colors share one contrast path.
	const { r, g, b } = parseHex(backgroundColor);
	return buildReadableColors(backgroundColor, resolveReadableTextColor(r, g, b));
}

export function sampleNoteBannerReadableColors(
	image: HTMLImageElement,
	sampleWindow?: NoteBannerSampleWindow,
): NoteBannerReadableColors | null {
	const normalizedWindow = normalizeSampleWindow(sampleWindow);
	const canvas = document.createElement('canvas');
	canvas.width = 24;
	canvas.height = 24;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) return null;

	ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
	const startRow = Math.max(0, Math.floor(canvas.height * Math.min(normalizedWindow.startY, normalizedWindow.endY)));
	const endRow = Math.max(startRow + 1, Math.ceil(canvas.height * Math.max(normalizedWindow.startY, normalizedWindow.endY)));
	const sampleHeight = Math.max(1, Math.min(canvas.height, endRow) - startRow);
	const imageData = ctx.getImageData(0, startRow, canvas.width, sampleHeight).data;

	let redTotal = 0;
	let greenTotal = 0;
	let blueTotal = 0;
	let weightTotal = 0;

	for (let index = 0; index < imageData.length; index += 4) {
		const alpha = imageData[index + 3] / 255;
		if (alpha <= 0.08) continue;
		redTotal += imageData[index] * alpha;
		greenTotal += imageData[index + 1] * alpha;
		blueTotal += imageData[index + 2] * alpha;
		weightTotal += alpha;
	}

	if (weightTotal <= 0) return null;

	const red = Math.round(redTotal / weightTotal);
	const green = Math.round(greenTotal / weightTotal);
	const blue = Math.round(blueTotal / weightTotal);
	const backgroundColor = `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`;
	return resolveNoteBannerReadableColors(backgroundColor);
}

export function useNoteBannerReadableColors(
	bannerUrl: string | null,
	sampleWindow?: NoteBannerSampleWindow,
): NoteBannerReadableColors | null {
	const cacheKey = React.useMemo(() => {
		if (!bannerUrl) return null;
		const normalizedWindow = normalizeSampleWindow(sampleWindow);
		return `${bannerUrl}|${normalizedWindow.startY.toFixed(3)}|${normalizedWindow.endY.toFixed(3)}`;
	}, [bannerUrl, sampleWindow?.endY, sampleWindow?.startY]);
	const [color, setColor] = React.useState<NoteBannerReadableColors | null>(() => {
		if (!cacheKey) return null;
		return readableColorCache.get(cacheKey) ?? null;
	});

	React.useEffect(() => {
		if (!bannerUrl || !cacheKey) {
			setColor(null);
			return;
		}

		const cachedColor = readableColorCache.get(cacheKey);
		if (cachedColor) {
			setColor(cachedColor);
			return;
		}

		let cancelled = false;
		(async () => {
			try {
				const image = await loadImage(bannerUrl);
				if (cancelled) return;
				const nextColor = sampleNoteBannerReadableColors(image, sampleWindow);
				if (!nextColor) {
					setColor(null);
					return;
				}
				readableColorCache.set(cacheKey, nextColor);
				setColor(nextColor);
			} catch {
				if (!cancelled) setColor(null);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [bannerUrl, cacheKey, sampleWindow]);

	return color;
}
