import type * as Y from 'yjs';
import { getTheme, isLightTheme, type ThemeId } from './theme';

// Color model:
// - Per-user note colors are stored in the authenticated user's preferences.
// - Legacy shared-doc `metadata.colorToken` values remain readable as a fallback
//   until each user sets or clears their own override.
// - No raw colors are persisted in the database; only stable token IDs are stored.

export type NoteColorToken =
	| 'yellow'
	| 'amber'
	| 'orange'
	| 'coral'
	| 'red'
	| 'rose'
	| 'pink'
	| 'magenta'
	| 'purple'
	| 'violet'
	| 'indigo'
	| 'blue'
	| 'sky'
	| 'cyan'
	| 'teal'
	| 'mint'
	| 'green'
	| 'lime'
	| 'olive'
	| 'brown'
	| 'copper'
	| 'slate'
	| 'gray'
	| 'graphite'
	| 'sand'
	| 'peach'
	| 'cream'
	| 'lavender';

export interface NoteColorTokenDefinition {
	id: NoteColorToken;
	labelKey: string;
	group: 'warm' | 'cool' | 'neutral';
	seedColor: string;
}

export interface ResolvedNoteColorScheme {
	token: NoteColorToken;
	cardBackground: string;
	headerBackground: string;
	borderColor: string;
	textColor: string;
	mutedTextColor: string;
	accentColor: string;
}

export interface ThemeNoteColorModel {
	themeId: ThemeId;
	isLight: boolean;
	tokens: Record<NoteColorToken, ResolvedNoteColorScheme>;
}

const NOTE_COLOR_TOKEN_FIELD = 'colorToken';

const LEGACY_NOTE_COLOR_TOKENS: Record<string, NoteColorToken> = {
	'highlight-yellow': 'yellow',
	'highlight-green': 'green',
	'highlight-blue': 'blue',
	'highlight-red': 'red',
	'priority-high': 'orange',
	'priority-medium': 'amber',
	'priority-low': 'olive',
	'reference-purple': 'purple',
};

export const NOTE_COLOR_TOKENS: readonly NoteColorTokenDefinition[] = [
	{ id: 'yellow', labelKey: 'noteColors.yellow', group: 'warm', seedColor: '#f0c74d' },
	{ id: 'amber', labelKey: 'noteColors.amber', group: 'warm', seedColor: '#d59c41' },
	{ id: 'orange', labelKey: 'noteColors.orange', group: 'warm', seedColor: '#ef7a43' },
	{ id: 'coral', labelKey: 'noteColors.coral', group: 'warm', seedColor: '#e9856e' },
	{ id: 'red', labelKey: 'noteColors.red', group: 'warm', seedColor: '#d95c67' },
	{ id: 'rose', labelKey: 'noteColors.rose', group: 'warm', seedColor: '#d66a89' },
	{ id: 'pink', labelKey: 'noteColors.pink', group: 'warm', seedColor: '#df80b5' },
	{ id: 'magenta', labelKey: 'noteColors.magenta', group: 'warm', seedColor: '#c45ad6' },
	{ id: 'purple', labelKey: 'noteColors.purple', group: 'cool', seedColor: '#9a76de' },
	{ id: 'violet', labelKey: 'noteColors.violet', group: 'cool', seedColor: '#7f67dd' },
	{ id: 'indigo', labelKey: 'noteColors.indigo', group: 'cool', seedColor: '#5c6de0' },
	{ id: 'blue', labelKey: 'noteColors.blue', group: 'cool', seedColor: '#5e9dff' },
	{ id: 'sky', labelKey: 'noteColors.sky', group: 'cool', seedColor: '#5bb9f0' },
	{ id: 'cyan', labelKey: 'noteColors.cyan', group: 'cool', seedColor: '#4abec8' },
	{ id: 'teal', labelKey: 'noteColors.teal', group: 'cool', seedColor: '#2ea59a' },
	{ id: 'mint', labelKey: 'noteColors.mint', group: 'cool', seedColor: '#63c9a0' },
	{ id: 'green', labelKey: 'noteColors.green', group: 'cool', seedColor: '#4dbd7f' },
	{ id: 'lime', labelKey: 'noteColors.lime', group: 'cool', seedColor: '#97c94c' },
	{ id: 'olive', labelKey: 'noteColors.olive', group: 'cool', seedColor: '#718c46' },
	{ id: 'brown', labelKey: 'noteColors.brown', group: 'neutral', seedColor: '#8b6a4d' },
	{ id: 'copper', labelKey: 'noteColors.copper', group: 'neutral', seedColor: '#b8734f' },
	{ id: 'slate', labelKey: 'noteColors.slate', group: 'neutral', seedColor: '#728197' },
	{ id: 'gray', labelKey: 'noteColors.gray', group: 'neutral', seedColor: '#8e98a3' },
	{ id: 'graphite', labelKey: 'noteColors.graphite', group: 'neutral', seedColor: '#58606b' },
	{ id: 'sand', labelKey: 'noteColors.sand', group: 'neutral', seedColor: '#c8b189' },
	{ id: 'peach', labelKey: 'noteColors.peach', group: 'neutral', seedColor: '#ecab86' },
	{ id: 'cream', labelKey: 'noteColors.cream', group: 'neutral', seedColor: '#e5d8b6' },
	{ id: 'lavender', labelKey: 'noteColors.lavender', group: 'neutral', seedColor: '#b7a7eb' },
];

const NOTE_COLOR_TOKEN_IDS = new Set<NoteColorToken>(NOTE_COLOR_TOKENS.map((token) => token.id));

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

function resolveMutedTextColor(textColor: string, background: string): string {
	return mixHex(textColor, background, 0.34);
}

export function resolveThemeNoteColorModel(themeId: ThemeId): ThemeNoteColorModel {
	const theme = getTheme(themeId);
	const surface = theme.variables['--color-surface'] || '#ffffff';
	const themeText = theme.variables['--color-text'] || (isLightTheme(themeId) ? '#111111' : '#f3f4f6');
	const light = isLightTheme(themeId);
	const tokens = Object.fromEntries(
		NOTE_COLOR_TOKENS.map((token) => {
			const cardBackground = mixHex(surface, token.seedColor, light ? 0.24 : 0.34);
			const headerBackground = mixHex(cardBackground, light ? '#111111' : '#ffffff', light ? 0.08 : 0.07);
			const borderColor = mixHex(cardBackground, token.seedColor, light ? 0.42 : 0.52);
			const textColor = resolveReadableTextColor(cardBackground, themeText);
			return [token.id, {
				token: token.id,
				cardBackground,
				headerBackground,
				borderColor,
				textColor,
				mutedTextColor: resolveMutedTextColor(textColor, cardBackground),
				accentColor: token.seedColor,
			} satisfies ResolvedNoteColorScheme];
		})
	) as Record<NoteColorToken, ResolvedNoteColorScheme>;
	return { themeId, isLight: light, tokens };
}

export function readNoteColorToken(metadata: Y.Map<any>): NoteColorToken | null {
	const raw = metadata.get(NOTE_COLOR_TOKEN_FIELD);
	if (typeof raw !== 'string') return null;
	if (NOTE_COLOR_TOKEN_IDS.has(raw as NoteColorToken)) return raw as NoteColorToken;
	return LEGACY_NOTE_COLOR_TOKENS[raw] ?? null;
}

// User-scoped note colors override the legacy shared-doc token completely.
// When the user has never set or cleared a color, fall back to the old doc token
// so pre-existing colors remain visible until migrated.
export function readEffectiveNoteColorToken(
	metadata: Y.Map<any>,
	localPreference: NoteColorToken | null,
	hasLocalPreference: boolean
): NoteColorToken | null {
	if (hasLocalPreference) return localPreference;
	return readNoteColorToken(metadata);
}

export function setNoteColorToken(doc: Y.Doc, token: NoteColorToken | null, origin?: symbol): void {
	const metadata = doc.getMap<any>('metadata');
	const run = (): void => {
		metadata.set(NOTE_COLOR_TOKEN_FIELD, token ?? null);
		metadata.set('updatedAt', Date.now());
	};
	if (origin) {
		doc.transact(run, origin);
	} else {
		doc.transact(run);
	}
}