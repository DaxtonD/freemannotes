import type { CSSProperties } from 'react';
import { getTheme, isLightTheme, type ThemeId } from './theme';
import type { ResolvedNoteColorScheme } from './noteColors';

type WorkspaceBubbleColorTone = 'light' | 'medium' | 'dark';

type WorkspaceBubbleColorSeed = {
	base: string;
	seed: string;
};

export type WorkspaceBubbleColorScheme = Omit<ResolvedNoteColorScheme, 'token'> & {
	token: string;
};

// These are the visible families shown in the picker. Each one expands into
// light / medium / dark semantic tokens so the same choice can adapt by theme.
const VISIBLE_WORKSPACE_BUBBLE_BASES: readonly WorkspaceBubbleColorSeed[] = [
	{ base: 'yellow', seed: '#f0c74d' },
	{ base: 'amber', seed: '#d59c41' },
	{ base: 'orange', seed: '#ef7a43' },
	{ base: 'coral', seed: '#e9856e' },
	{ base: 'red', seed: '#d95c67' },
	{ base: 'rose', seed: '#d66a89' },
	{ base: 'pink', seed: '#df80b5' },
	{ base: 'magenta', seed: '#c45ad6' },
	{ base: 'purple', seed: '#9a76de' },
	{ base: 'indigo', seed: '#5c6de0' },
	{ base: 'blue', seed: '#5e9dff' },
	{ base: 'cyan', seed: '#4abec8' },
	{ base: 'teal', seed: '#2ea59a' },
	{ base: 'green', seed: '#4dbd7f' },
	{ base: 'brown', seed: '#8b6a4d' },
	{ base: 'slate', seed: '#728197' },
];

const LEGACY_MEDIUM_ONLY_BASES: readonly WorkspaceBubbleColorSeed[] = [
	{ base: 'violet', seed: '#7f67dd' },
	{ base: 'sky', seed: '#5bb9f0' },
	{ base: 'mint', seed: '#63c9a0' },
	{ base: 'lime', seed: '#97c94c' },
	{ base: 'olive', seed: '#718c46' },
	{ base: 'copper', seed: '#b8734f' },
	{ base: 'gray', seed: '#8e98a3' },
	{ base: 'graphite', seed: '#58606b' },
	{ base: 'sand', seed: '#c8b189' },
	{ base: 'peach', seed: '#ecab86' },
	{ base: 'cream', seed: '#e5d8b6' },
	{ base: 'lavender', seed: '#b7a7eb' },
];

export const WORKSPACE_COLOR_TOKENS: readonly string[] = VISIBLE_WORKSPACE_BUBBLE_BASES.flatMap(({ base }) => [
	`${base}-light`,
	base,
	`${base}-dark`,
]);

const DEFAULT_WORKSPACE_COLOR_TOKENS: readonly string[] = VISIBLE_WORKSPACE_BUBBLE_BASES.map(({ base }) => base);

// Token configs drive theme-aware rendering. We persist semantic tokens, not raw
// hex values, so the same workspace can stay recognizably "blue" or "amber"
// across light and dark themes without sharing literal colors between themes.
const WORKSPACE_COLOR_TOKEN_CONFIGS = new Map<string, { seed: string; tone: WorkspaceBubbleColorTone }>();

for (const { base, seed } of VISIBLE_WORKSPACE_BUBBLE_BASES) {
	WORKSPACE_COLOR_TOKEN_CONFIGS.set(`${base}-light`, { seed, tone: 'light' });
	WORKSPACE_COLOR_TOKEN_CONFIGS.set(base, { seed, tone: 'medium' });
	WORKSPACE_COLOR_TOKEN_CONFIGS.set(`${base}-dark`, { seed, tone: 'dark' });
}

for (const { base, seed } of LEGACY_MEDIUM_ONLY_BASES) {
	WORKSPACE_COLOR_TOKEN_CONFIGS.set(base, { seed, tone: 'medium' });
}

function hashCode(str: string): number {
	let hash = 0;
	for (let index = 0; index < str.length; index += 1) {
		hash = (Math.imul(31, hash) + str.charCodeAt(index)) | 0;
	}
	return hash;
}

function parseHexColor(hex: string): { r: number; g: number; b: number } {
	const normalized = String(hex || '').trim().replace(/^#/, '');
	const full = normalized.length === 3
		? normalized.split('').map((part) => `${part}${part}`).join('')
		: normalized;
	if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 0, g: 0, b: 0 };
	return {
		r: parseInt(full.slice(0, 2), 16),
		g: parseInt(full.slice(2, 4), 16),
		b: parseInt(full.slice(4, 6), 16),
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

function contrastRatio(a: string, b: string): number {
	const l1 = relativeLuminance(a);
	const l2 = relativeLuminance(b);
	const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
	return (lighter + 0.05) / (darker + 0.05);
}

function resolveReadableTextColor(background: string, preferred: string): string {
	if (contrastRatio(background, preferred) >= 4.5) return preferred;
	const whiteContrast = contrastRatio(background, '#ffffff');
	const blackContrast = contrastRatio(background, '#111111');
	return whiteContrast >= blackContrast ? '#ffffff' : '#111111';
}

function resolveWorkspaceBubbleScheme(themeId: ThemeId, token: string): WorkspaceBubbleColorScheme {
	const theme = getTheme(themeId);
	const surface = theme.variables['--color-surface'] || '#ffffff';
	const themeText = theme.variables['--color-text'] || (isLightTheme(themeId) ? '#111111' : '#f3f4f6');
	const light = isLightTheme(themeId);
	const config = WORKSPACE_COLOR_TOKEN_CONFIGS.get(token) ?? WORKSPACE_COLOR_TOKEN_CONFIGS.get('blue')!;

	// The same semantic token intentionally resolves differently in light vs dark
	// themes so the palette stays varied and readable on every device.
	const seedWeight = light
		? (config.tone === 'light' ? 0.26 : config.tone === 'medium' ? 0.46 : 0.68)
		: (config.tone === 'light' ? 0.40 : config.tone === 'medium' ? 0.58 : 0.74);
	const toneBiasWeight = light
		? (config.tone === 'light' ? 0.22 : config.tone === 'medium' ? 0.08 : 0.10)
		: (config.tone === 'light' ? 0.12 : config.tone === 'medium' ? 0.04 : 0.12);
	const toneBiasColor = light
		? (config.tone === 'dark' ? '#111111' : '#ffffff')
		: (config.tone === 'dark' ? '#000000' : '#ffffff');
	const baseBackground = mixHex(surface, config.seed, seedWeight);
	const cardBackground = mixHex(baseBackground, toneBiasColor, toneBiasWeight);
	const headerBackground = mixHex(cardBackground, light ? '#111111' : '#ffffff', light ? 0.05 : 0.06);
	const borderColor = mixHex(cardBackground, light ? '#111111' : '#ffffff', light ? 0.14 : 0.12);
	const textColor = resolveReadableTextColor(cardBackground, themeText);
	const mutedTextColor = mixHex(textColor, cardBackground, 0.32);
	const accentColor = mixHex(config.seed, light ? '#111111' : '#ffffff', light ? 0.06 : 0.04);

	return {
		token,
		cardBackground,
		headerBackground,
		borderColor,
		textColor,
		mutedTextColor,
		accentColor,
	};
}

function resolveWorkspaceToken(workspaceId: string, colorOverrides?: Readonly<Record<string, string>>): string {
	const override = colorOverrides?.[workspaceId];
	if (override && WORKSPACE_COLOR_TOKEN_CONFIGS.has(override)) {
		return override;
	}
	// Stable fallback so a workspace keeps the same default family until the user
	// explicitly overrides it.
	return DEFAULT_WORKSPACE_COLOR_TOKENS[Math.abs(hashCode(workspaceId)) % DEFAULT_WORKSPACE_COLOR_TOKENS.length] ?? 'blue';
}

export function getWorkspaceBubbleColorScheme(themeId: ThemeId, workspaceId: string): WorkspaceBubbleColorScheme {
	return resolveWorkspaceBubbleScheme(themeId, resolveWorkspaceToken(workspaceId));
}

export function getWorkspaceBubbleColorSchemeOverridden(
	themeId: ThemeId,
	workspaceId: string,
	colorOverrides?: Readonly<Record<string, string>>,
): WorkspaceBubbleColorScheme {
	return resolveWorkspaceBubbleScheme(themeId, resolveWorkspaceToken(workspaceId, colorOverrides));
}

export function toWorkspaceBubbleColorStyle(resolved: WorkspaceBubbleColorScheme): CSSProperties {
	return {
		'--bv-bubble-bg': resolved.cardBackground,
		'--bv-bubble-border': resolved.borderColor,
		'--bv-bubble-text': resolved.textColor,
		'--bv-bubble-muted': resolved.mutedTextColor,
		'--bv-bubble-accent': resolved.accentColor,
	} as CSSProperties;
}
