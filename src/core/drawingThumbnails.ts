import * as Y from 'yjs';
import { DEFAULT_DRAWING_BACKGROUND, readDrawingBackgroundColorFromMetadata } from './drawingBackground';
import {
	readLatestStoredDrawingThumbnail,
	readLatestStoredDrawingThumbnailSnapshot,
	readStoredDrawingThumbnail,
	writeStoredDrawingThumbnail,
} from './drawingThumbnailStore';

type ExcalidrawModule = typeof import('@excalidraw/excalidraw');
type YExcalidrawModule = typeof import('y-excalidraw');

type DrawingPlaceholderPalette = {
	background: string;
	surface: string;
	border: string;
	text: string;
	muted: string;
	accent: string;
};

export type DrawingPlaceholderOptions = {
	seed?: string;
	colors?: Partial<DrawingPlaceholderPalette>;
};

const thumbnailCache = new Map<string, Promise<string>>();
const resolvedThumbnailCache = new Map<string, string>();
const storedThumbnailLoadCache = new Map<string, Promise<string | null>>();
const placeholderSvgCache = new Map<string, Promise<string>>();
const DRAWING_PLACEHOLDER_ASSETS = [
	'DrawingPlaceholders/d1.svg',
	'DrawingPlaceholders/d2.svg',
	'DrawingPlaceholders/d3.svg',
] as const;

function parseHexColor(hex: string): { r: number; g: number; b: number } {
	const normalized = String(hex || '').trim().replace(/^#/, '');
	const full = normalized.length === 3
		? normalized.split('').map((part) => `${part}${part}`).join('')
		: normalized;
	if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 0, g: 0, b: 0 };
	return {
		r: Number.parseInt(full.slice(0, 2), 16),
		g: Number.parseInt(full.slice(2, 4), 16),
		b: Number.parseInt(full.slice(4, 6), 16),
	};
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
	const channel = (value: number): string => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
	return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function mixHex(base: string, overlay: string, overlayWeight: number): string {
	const a = parseHexColor(base);
	const b = parseHexColor(overlay);
	const weight = Math.max(0, Math.min(1, overlayWeight));
	return toHex({
		r: a.r + (b.r - a.r) * weight,
		g: a.g + (b.g - a.g) * weight,
		b: a.b + (b.b - a.b) * weight,
	});
}

function channelLuminance(value: number): number {
	const normalized = value / 255;
	return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
	const { r, g, b } = parseHexColor(hex);
	return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function normalizeColor(candidate: string | undefined, fallback: string): string {
	const value = String(candidate || '').trim();
	return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : fallback;
}

function readCssVar(name: string, fallback: string): string {
	if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
	const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return value || fallback;
}

function getDefaultPlaceholderPalette(): DrawingPlaceholderPalette {
	const background = readCssVar('--color-surface', '#f4f1ea');
	const text = readCssVar('--color-text', '#1c1c1c');
	const border = readCssVar('--color-border', mixHex(background, text, 0.24));
	return {
		background,
		surface: readCssVar('--color-surface-elevated', mixHex(background, '#ffffff', 0.16)),
		border,
		text,
		muted: readCssVar('--color-text-muted', mixHex(text, background, 0.42)),
		accent: readCssVar('--color-accent', '#5c6de0'),
	};
}

function resolvePlaceholderPalette(colors?: Partial<DrawingPlaceholderPalette>): DrawingPlaceholderPalette {
	const fallback = getDefaultPlaceholderPalette();
	return {
		background: normalizeColor(colors?.background, fallback.background),
		surface: normalizeColor(colors?.surface, fallback.surface),
		border: normalizeColor(colors?.border, fallback.border),
		text: normalizeColor(colors?.text, fallback.text),
		muted: normalizeColor(colors?.muted, fallback.muted),
		accent: normalizeColor(colors?.accent, fallback.accent),
	};
}

function choosePlaceholderAsset(seed: string): string {
	const normalized = String(seed || '').trim() || 'drawing';
	let hash = 0;
	for (let index = 0; index < normalized.length; index += 1) {
		hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
	}
	return DRAWING_PLACEHOLDER_ASSETS[Math.abs(hash) % DRAWING_PLACEHOLDER_ASSETS.length];
}

async function loadPlaceholderSvg(assetPath: string): Promise<string> {
	const cached = placeholderSvgCache.get(assetPath);
	if (cached) return cached;
	const nextPromise = (async () => {
		const response = await fetch(assetPath, { cache: 'force-cache' });
		if (!response.ok) throw new Error(`Failed to load drawing placeholder: ${assetPath}`);
		return response.text();
	})();
	placeholderSvgCache.set(assetPath, nextPromise);
	return nextPromise;
}

function mapPlaceholderColor(sourceHex: string, palette: DrawingPlaceholderPalette, kind: 'fill' | 'stroke'): string {
	const { r, g, b } = parseHexColor(sourceHex);
	const luminance = relativeLuminance(sourceHex);
	const spread = Math.max(r, g, b) - Math.min(r, g, b);
	const isColorful = spread > 40;
	if (kind === 'stroke') {
		if (isColorful) return mixHex(palette.accent, palette.text, 0.18);
		if (luminance < 0.22) return palette.text;
		if (luminance < 0.48) return palette.border;
		return palette.muted;
	}
	if (isColorful) {
		return luminance > 0.6 ? mixHex(palette.accent, palette.surface, 0.35) : palette.accent;
	}
	if (luminance > 0.9) return palette.background;
	if (luminance > 0.72) return palette.surface;
	if (luminance > 0.48) return palette.border;
	if (luminance > 0.22) return palette.muted;
	return palette.text;
}

function recolorPlaceholderSvg(svg: string, palette: DrawingPlaceholderPalette): string {
	const recolor = (input: string, attr: 'fill' | 'stroke'): string => input.replace(
		new RegExp(`${attr}="(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))"`, 'g'),
		(_match, color: string) => `${attr}="${mapPlaceholderColor(color, palette, attr)}"`
	);
	return recolor(recolor(svg, 'fill'), 'stroke');
}

function buildInlineFallbackPlaceholderDataUrl(title: string, palette: DrawingPlaceholderPalette): string {
	const safeTitle = String(title || '').trim() || 'Drawing';
	const escapedTitle = safeTitle
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.slice(0, 36);
	const svg = `
		<svg width="960" height="720" viewBox="0 0 960 720" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<linearGradient id="drawingGradient" x1="0" x2="1" y1="0" y2="1">
					<stop offset="0%" stop-color="${palette.surface}" />
					<stop offset="100%" stop-color="${palette.background}" />
				</linearGradient>
			</defs>
			<rect width="960" height="720" rx="48" fill="url(#drawingGradient)" />
			<rect x="48" y="48" width="864" height="624" rx="36" fill="${palette.surface}" stroke="${palette.border}" stroke-width="6" />
			<path d="M220 484c82-184 124-276 202-276 86 0 126 238 224 238 44 0 84-34 122-98" fill="none" stroke="${palette.text}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" opacity="0.88" />
			<path d="M244 278c46-58 92-88 136-88 34 0 68 18 102 54" fill="none" stroke="${palette.accent}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" opacity="0.8" />
			<circle cx="654" cy="254" r="22" fill="${palette.accent}" opacity="0.9" />
			<text x="88" y="612" font-family="Assistant, sans-serif" font-size="58" font-weight="700" fill="${palette.text}">${escapedTitle}</text>
			<text x="88" y="658" font-family="Assistant, sans-serif" font-size="28" fill="${palette.muted}">Freeman Notes drawing</text>
		</svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function buildDrawingPlaceholderDataUrl(title: string, options?: DrawingPlaceholderOptions): Promise<string> {
	const palette = resolvePlaceholderPalette(options?.colors);
	const assetPath = choosePlaceholderAsset(options?.seed || title);
	try {
		const svg = await loadPlaceholderSvg(assetPath);
		return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(recolorPlaceholderSvg(svg, palette))}`;
	} catch {
		return buildInlineFallbackPlaceholderDataUrl(title, palette);
	}
}

export function getDrawingThumbnailVersion(doc: Y.Doc): string {
	const metadata = doc.getMap<any>('metadata');
	const updatedAt = Number(metadata.get('updatedAt') ?? 0);
	const drawingBackgroundColor = readDrawingBackgroundColorFromMetadata(metadata);
	const title = doc.getText('title').toString().trim();
	const elementCount = doc.getArray<Y.Map<any>>('elements').length;
	const assetCount = doc.getMap<any>('assets').size;
	return `${updatedAt}|${elementCount}|${assetCount}|${drawingBackgroundColor}|${title}`;
}

function getPlaceholderPaletteKey(options?: DrawingPlaceholderOptions): string {
	return options?.colors
		? `${options.colors.background || ''}|${options.colors.surface || ''}|${options.colors.border || ''}|${options.colors.text || ''}|${options.colors.muted || ''}|${options.colors.accent || ''}`
		: '';
}

export function getDrawingThumbnailCacheKey(
	drawingId: string,
	versionKey: string,
	placeholderOptions?: DrawingPlaceholderOptions
): string {
	return `${drawingId}:${versionKey}:${getPlaceholderPaletteKey(placeholderOptions)}`;
}

export function peekDrawingThumbnail(cacheKey: string): string | null {
	return resolvedThumbnailCache.get(cacheKey) ?? null;
}

export function peekLatestDrawingThumbnail(noteId: string): string | null {
	if (!noteId) return null;
	const snapshot = readLatestStoredDrawingThumbnailSnapshot(noteId);
	if (!snapshot?.dataUrl) return null;
	resolvedThumbnailCache.set(snapshot.id, snapshot.dataUrl);
	thumbnailCache.set(snapshot.id, Promise.resolve(snapshot.dataUrl));
	return snapshot.dataUrl;
}

export async function readLatestCachedDrawingThumbnail(noteId: string): Promise<string | null> {
	if (!noteId) return null;
	const snapshot = readLatestStoredDrawingThumbnailSnapshot(noteId);
	if (snapshot?.dataUrl) {
		resolvedThumbnailCache.set(snapshot.id, snapshot.dataUrl);
		thumbnailCache.set(snapshot.id, Promise.resolve(snapshot.dataUrl));
		return snapshot.dataUrl;
	}
	const latest = await readLatestStoredDrawingThumbnail(noteId);
	if (!latest?.dataUrl) return null;
	resolvedThumbnailCache.set(latest.id, latest.dataUrl);
	thumbnailCache.set(latest.id, Promise.resolve(latest.dataUrl));
	return latest.dataUrl;
}

export async function readCachedDrawingThumbnail(
	cacheKey: string,
	drawingId: string,
	versionKey: string
): Promise<string | null> {
	if (!cacheKey || !drawingId || !versionKey) return null;
	const resolved = resolvedThumbnailCache.get(cacheKey);
	if (resolved) return resolved;
	const cachedLoad = storedThumbnailLoadCache.get(cacheKey);
	if (cachedLoad) return cachedLoad;
	const nextLoad = (async () => {
		const row = await readStoredDrawingThumbnail(cacheKey);
		if (!row) return null;
		if (row.noteId !== drawingId || row.versionKey !== versionKey || !row.dataUrl) return null;
		resolvedThumbnailCache.set(cacheKey, row.dataUrl);
		thumbnailCache.set(cacheKey, Promise.resolve(row.dataUrl));
		return row.dataUrl;
	})();
	storedThumbnailLoadCache.set(cacheKey, nextLoad);
	return nextLoad;
}

export async function renderDrawingThumbnail(
	drawingId: string,
	drawingDoc: Y.Doc,
	fallbackTitle: string,
	versionKey = getDrawingThumbnailVersion(drawingDoc),
	placeholderOptions?: DrawingPlaceholderOptions
): Promise<string> {
	const cacheKey = getDrawingThumbnailCacheKey(drawingId, versionKey, placeholderOptions);
	const resolved = resolvedThumbnailCache.get(cacheKey);
	if (resolved) {
		return resolved;
	}
	const cached = thumbnailCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const persistThumbnail = (dataUrl: string): string => {
		resolvedThumbnailCache.set(cacheKey, dataUrl);
		void writeStoredDrawingThumbnail({
			id: cacheKey,
			noteId: drawingId,
			versionKey,
			dataUrl,
			updatedAt: new Date().toISOString(),
		});
		return dataUrl;
	};

	const renderPromise = (async () => {
		try {
			const [{ exportToCanvas }, { yjsToExcalidraw }]: [ExcalidrawModule, YExcalidrawModule] = await Promise.all([
				import('@excalidraw/excalidraw'),
				import('y-excalidraw'),
			]);
			const drawingBackgroundColor = readDrawingBackgroundColorFromMetadata(drawingDoc.getMap<any>('metadata'));
			const yElements = drawingDoc.getArray<Y.Map<any>>('elements');
			const elements = yjsToExcalidraw(yElements).filter((element) => !element.isDeleted);
			if (elements.length === 0) {
				const latestPreview = peekLatestDrawingThumbnail(drawingId);
				if (latestPreview) {
					return persistThumbnail(latestPreview);
				}
				const latestCachedThumbnail = await readLatestCachedDrawingThumbnail(drawingId);
				if (latestCachedThumbnail) {
					return persistThumbnail(latestCachedThumbnail);
				}
				return persistThumbnail(await buildDrawingPlaceholderDataUrl(fallbackTitle, { ...placeholderOptions, seed: placeholderOptions?.seed || drawingId }));
			}
			const files = Object.fromEntries(drawingDoc.getMap<any>('assets').entries());
			const canvas = await exportToCanvas({
				elements,
				files,
				maxWidthOrHeight: 720,
				exportPadding: 24,
				appState: {
					exportBackground: true,
					viewBackgroundColor: drawingBackgroundColor || DEFAULT_DRAWING_BACKGROUND,
				},
			});
			return persistThumbnail(canvas.toDataURL('image/png'));
		} catch {
			return persistThumbnail(await buildDrawingPlaceholderDataUrl(fallbackTitle, { ...placeholderOptions, seed: placeholderOptions?.seed || drawingId }));
		}
	})();

	thumbnailCache.set(cacheKey, renderPromise);
	return renderPromise;
}