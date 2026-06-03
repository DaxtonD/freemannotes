import React from 'react';
import { getNoteBannerAssetUrl, type NoteBannerAssetLayout } from './noteBannerApi';
import { getTheme, isLightTheme, type ThemeId } from './theme';

export type NoteBannerThemeInput = {
	surface?: string | null;
	surfaceAlt?: string | null;
	text?: string | null;
	accent?: string | null;
};

type RgbColor = {
	r: number;
	g: number;
	b: number;
};

type NoteBannerPresentationStyle = React.CSSProperties & {
	'--note-banner-image-filter'?: string;
	'--note-banner-overlay-top'?: string;
	'--note-banner-overlay-bottom'?: string;
	'--note-banner-colorize'?: string;
	'--note-banner-colorize-opacity'?: string;
};

type NoteBannerPresentationFactors = {
	brighten: number;
	contrast: number;
	saturate: number;
	colorize: string;
	colorizeOpacity: number;
	topWash: string;
	bottomWash: string;
	topAlpha: number;
	bottomAlpha: number;
};

function clampChannel(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

function toHexChannel(value: number): string {
	return clampChannel(value).toString(16).padStart(2, '0');
}

function rgbToHex(color: RgbColor): string {
	return `#${toHexChannel(color.r)}${toHexChannel(color.g)}${toHexChannel(color.b)}`;
}

function parseColor(value: string | null | undefined): RgbColor | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;

	if (trimmed.startsWith('#')) {
		const hex = trimmed.slice(1);
		if (hex.length === 3) {
			return {
				r: Number.parseInt(hex[0] + hex[0], 16),
				g: Number.parseInt(hex[1] + hex[1], 16),
				b: Number.parseInt(hex[2] + hex[2], 16),
			};
		}
		if (hex.length === 6) {
			return {
				r: Number.parseInt(hex.slice(0, 2), 16),
				g: Number.parseInt(hex.slice(2, 4), 16),
				b: Number.parseInt(hex.slice(4, 6), 16),
			};
		}
		return null;
	}

	const rgbMatch = trimmed.match(/^rgba?\(([^)]+)\)$/i);
	if (!rgbMatch) return null;
	const parts = rgbMatch[1].split(',').map((part) => Number.parseFloat(part.trim()));
	if (parts.length < 3 || parts.slice(0, 3).some((part) => Number.isNaN(part))) return null;
	return {
		r: clampChannel(parts[0]),
		g: clampChannel(parts[1]),
		b: clampChannel(parts[2]),
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
	const baseRgb = parseColor(base);
	const overlayRgb = parseColor(overlay);
	if (!baseRgb || !overlayRgb) return base;
	return rgbToHex(mixRgb(baseRgb, overlayRgb, overlayWeight));
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

function normalizeColor(value: string | null | undefined, fallback: string): string {
	const parsed = parseColor(value ?? '');
	if (parsed) return rgbToHex(parsed);
	const fallbackParsed = parseColor(fallback);
	return fallbackParsed ? rgbToHex(fallbackParsed) : '#808080';
}

function toRgba(color: string, alpha: number): string {
	const parsed = parseColor(color);
	if (!parsed) return `rgba(128, 128, 128, ${Math.max(0, Math.min(1, alpha))})`;
	return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function applyBrightness(color: RgbColor, factor: number): RgbColor {
	return {
		r: color.r * factor,
		g: color.g * factor,
		b: color.b * factor,
	};
}

function applySaturation(color: RgbColor, factor: number): RgbColor {
	const gray = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
	return {
		r: gray + (color.r - gray) * factor,
		g: gray + (color.g - gray) * factor,
		b: gray + (color.b - gray) * factor,
	};
}

function applyContrast(color: RgbColor, factor: number): RgbColor {
	return {
		r: (color.r - 128) * factor + 128,
		g: (color.g - 128) * factor + 128,
		b: (color.b - 128) * factor + 128,
	};
}

function multiplyRgb(base: RgbColor, overlay: RgbColor): RgbColor {
	return {
		r: (base.r * overlay.r) / 255,
		g: (base.g * overlay.g) / 255,
		b: (base.b * overlay.b) / 255,
	};
}

function resolvePresentationFactors(themeId: ThemeId, input: NoteBannerThemeInput = {}): NoteBannerPresentationFactors {
	const theme = getTheme(themeId);
	const lightTheme = isLightTheme(themeId);
	const surface = normalizeColor(input.surface, theme.variables['--color-surface'] ?? '#ffffff');
	const surfaceAlt = normalizeColor(input.surfaceAlt, input.surface ?? theme.variables['--color-surface-2'] ?? surface);
	const accent = normalizeColor(input.accent, theme.variables['--color-accent'] ?? (lightTheme ? '#7c6854' : '#899593'));
	const hasExplicitSurface = Boolean(input.surface);
	const surfaceLuminance = relativeLuminance(parseColor(surfaceAlt) as RgbColor);
	const brighten = hasExplicitSurface
		? (lightTheme ? 0.988 + surfaceLuminance * 0.008 : 1.0)
		: (lightTheme ? 1.004 + surfaceLuminance * 0.012 : 1.02);
	const contrast = hasExplicitSurface
		? (lightTheme ? 0.985 : 1.005)
		: (lightTheme ? 1.012 : 1.03);
	const saturate = hasExplicitSurface
		? (lightTheme ? 0.9 : 0.94)
		: (lightTheme ? 1.01 : 1.02);
	const topWash = hasExplicitSurface
		? mixHex(surface, '#ffffff', lightTheme ? 0.04 : 0.025)
		: mixHex(surface, '#ffffff', lightTheme ? 0.08 : 0.06);
	const bottomWash = hasExplicitSurface
		? mixHex(surfaceAlt, accent, lightTheme ? 0.12 : 0.18)
		: mixHex(surfaceAlt, accent, lightTheme ? 0.025 : 0.1);
	const topAlpha = hasExplicitSurface
		? (lightTheme ? 0.02 : 0.035)
		: (lightTheme ? 0.006 + surfaceLuminance * 0.009 : 0.03);
	const bottomAlpha = hasExplicitSurface
		? (lightTheme ? 0.22 : 0.28)
		: (lightTheme ? 0.018 + surfaceLuminance * 0.014 : 0.1);

	return {
		brighten,
		contrast,
		saturate,
		colorize: surfaceAlt,
		colorizeOpacity: hasExplicitSurface ? (lightTheme ? 0.28 : 0.34) : 0,
		topWash,
		bottomWash,
		topAlpha,
		bottomAlpha,
	};
}

export function transformNoteBannerSampleColor(themeId: ThemeId, sampleColor: string, input: NoteBannerThemeInput = {}): string {
	const sample = parseColor(sampleColor);
	if (!sample) return normalizeColor(sampleColor, '#808080');
	// Mirror the same broad color treatment that the CSS banner media receives so
	// any banner-derived header/body palette stays visually aligned with the card.
	const factors = resolvePresentationFactors(themeId, input);
	let transformed = applyBrightness(sample, factors.brighten);
	transformed = applySaturation(transformed, factors.saturate);
	transformed = applyContrast(transformed, factors.contrast);

	const colorize = parseColor(factors.colorize);
	if (colorize && factors.colorizeOpacity > 0) {
		transformed = mixRgb(transformed, multiplyRgb(transformed, colorize), factors.colorizeOpacity);
	}

	const bottomWash = parseColor(factors.bottomWash);
	if (bottomWash && factors.bottomAlpha > 0) {
		transformed = mixRgb(transformed, bottomWash, factors.bottomAlpha * 0.72);
	}

	return rgbToHex(transformed);
}

export function getNoteBannerPresentationStyle(themeId: ThemeId, input: NoteBannerThemeInput = {}): NoteBannerPresentationStyle {
	const factors = resolvePresentationFactors(themeId, input);

	return {
		'--note-banner-image-filter': `brightness(${factors.brighten.toFixed(3)}) saturate(${factors.saturate.toFixed(3)}) contrast(${factors.contrast.toFixed(3)})`,
		'--note-banner-overlay-top': toRgba(factors.topWash, factors.topAlpha),
		'--note-banner-overlay-bottom': toRgba(factors.bottomWash, factors.bottomAlpha),
		'--note-banner-colorize': factors.colorize,
		'--note-banner-colorize-opacity': factors.colorizeOpacity > 0 ? factors.colorizeOpacity.toFixed(2) : '0',
	};
}

export function useThemedNoteBannerImageUrl(
	fileName: string | null | undefined,
	themeId: ThemeId,
	_input: NoteBannerThemeInput = {},
	layout: NoteBannerAssetLayout = 'card'
): string | null {
	return React.useMemo(() => (fileName ? getNoteBannerAssetUrl(fileName, themeId, layout) : null), [fileName, layout, themeId]);
}