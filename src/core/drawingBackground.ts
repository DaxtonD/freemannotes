export const DEFAULT_DRAWING_BACKGROUND = '#ffffff';
const DRAWING_DARK_INK = '#1f2937';
const DRAWING_LIGHT_INK = '#f9fafb';

export const DRAWING_BACKGROUND_PRESETS = [
	{ id: 'white', label: 'White', color: '#ffffff' },
	{ id: 'ivory', label: 'Ivory', color: '#f8f3e7' },
	{ id: 'mist', label: 'Mist', color: '#eef2ff' },
	{ id: 'powder', label: 'Powder', color: '#e7f6ff' },
	{ id: 'mint', label: 'Mint', color: '#e4f7ea' },
	{ id: 'butter', label: 'Butter', color: '#fff1bf' },
	{ id: 'blush', label: 'Blush', color: '#ffd8e2' },
	{ id: 'peach', label: 'Peach', color: '#ffd7bf' },
	{ id: 'sand', label: 'Sand', color: '#efe2c1' },
	{ id: 'sage', label: 'Sage', color: '#d9e8cf' },
	{ id: 'seafoam', label: 'Seafoam', color: '#d3f2eb' },
	{ id: 'sky', label: 'Sky', color: '#d8ecff' },
	{ id: 'lilac', label: 'Lilac', color: '#e5ddff' },
	{ id: 'rose', label: 'Rose', color: '#f2b4c8' },
	{ id: 'apricot', label: 'Apricot', color: '#f7bc8a' },
	{ id: 'ochre', label: 'Ochre', color: '#dab35e' },
	{ id: 'moss', label: 'Moss', color: '#a6c78e' },
	{ id: 'teal', label: 'Teal', color: '#89d7ca' },
	{ id: 'cerulean', label: 'Cerulean', color: '#8dc9f0' },
	{ id: 'periwinkle', label: 'Periwinkle', color: '#b2bfff' },
	{ id: 'orchid', label: 'Orchid', color: '#d4a5ee' },
	{ id: 'berry', label: 'Berry', color: '#d978a0' },
	{ id: 'terracotta', label: 'Terracotta', color: '#d07f5f' },
	{ id: 'amber', label: 'Amber', color: '#c99227' },
	{ id: 'olive', label: 'Olive', color: '#89934f' },
	{ id: 'pine', label: 'Pine', color: '#4d7a5a' },
	{ id: 'lagoon', label: 'Lagoon', color: '#3a9aa1' },
	{ id: 'denim', label: 'Denim', color: '#5f83c2' },
	{ id: 'violet', label: 'Violet', color: '#8870d8' },
	{ id: 'plum', label: 'Plum', color: '#8d5d93' },
	{ id: 'mulberry', label: 'Mulberry', color: '#6f456d' },
	{ id: 'brick', label: 'Brick', color: '#9d5749' },
	{ id: 'umber', label: 'Umber', color: '#7b5b3b' },
	{ id: 'forest', label: 'Forest', color: '#395c45' },
	{ id: 'navy', label: 'Navy', color: '#31496d' },
	{ id: 'charcoal', label: 'Charcoal', color: '#2d3441' },
	{ id: 'slate', label: 'Slate', color: '#667085' },
] as const;

export function normalizeDrawingBackgroundColor(value: unknown): string | null {
	const raw = String(value ?? '').trim();
	if (!raw) return null;
	const match = raw.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
	if (!match) return null;
	const normalized = match[1].toLowerCase();
	if (normalized.length === 3) {
		return `#${normalized.split('').map((part) => `${part}${part}`).join('')}`;
	}
	return `#${normalized}`;
}

function parseHexColor(hex: string): { r: number; g: number; b: number } {
	const normalized = normalizeDrawingBackgroundColor(hex) ?? DEFAULT_DRAWING_BACKGROUND;
	return {
		r: Number.parseInt(normalized.slice(1, 3), 16),
		g: Number.parseInt(normalized.slice(3, 5), 16),
		b: Number.parseInt(normalized.slice(5, 7), 16),
	};
}

function channelLuminance(value: number): number {
	const normalized = value / 255;
	return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
	const { r, g, b } = parseHexColor(hex);
	return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(a: string, b: string): number {
	const luminanceA = relativeLuminance(a);
	const luminanceB = relativeLuminance(b);
	const lighter = Math.max(luminanceA, luminanceB);
	const darker = Math.min(luminanceA, luminanceB);
	return (lighter + 0.05) / (darker + 0.05);
}

export function getDrawingRecommendedInkColor(backgroundColor: string): string {
	const normalizedBackground = normalizeDrawingBackgroundColor(backgroundColor) ?? DEFAULT_DRAWING_BACKGROUND;
	return contrastRatio(normalizedBackground, DRAWING_LIGHT_INK) >= contrastRatio(normalizedBackground, DRAWING_DARK_INK)
		? DRAWING_LIGHT_INK
		: DRAWING_DARK_INK;
}

export function readDrawingBackgroundColorFromMetadata(metadata: { get: (key: string) => unknown }): string {
	return normalizeDrawingBackgroundColor(metadata.get('drawingBackgroundColor')) ?? DEFAULT_DRAWING_BACKGROUND;
}