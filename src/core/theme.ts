export type ThemeDefinition = {
	id: string;
	labelKey: string;
	variables: Record<string, string>;
};

const STORAGE_KEY = 'freemannotes.theme';

const baseThemeVariables = {
	'--color-border': 'rgba(0, 0, 0, 0.12)',
	'--color-outline': 'rgba(0, 0, 0, 0.35)',
	'--color-text-muted': 'rgba(0, 0, 0, 0.6)',
};

function makeNordTheme(
	id: string,
	labelKey: string,
	accent: string,
	appBg: string,
	surface: string,
	surface2: string,
	overlay: string,
	text: string = '#eceff4',
	textMuted: string = '#d8dee9'
): ThemeDefinition {
	return {
		id,
		labelKey,
		variables: {
			'--color-app-bg': appBg,
			'--color-surface': surface,
			'--color-surface-2': surface2,
			'--color-border': 'rgba(216, 222, 233, 0.24)',
			'--color-outline': `${accent}cc`,
			'--color-text': text,
			'--color-text-muted': textMuted,
			'--color-button-bg': surface2,
			'--color-button-text': text,
			'--color-input-bg': appBg,
			'--color-input-text': text,
			'--color-accent': accent,
			'--color-overlay': overlay,
		},
	};
}

// ── Catppuccin theme factory ────────────────────────────────────────────────
// Official palette: https://github.com/catppuccin/catppuccin
// Each flavor provides: base, mantle, crust, text, subtext0/1, surface0/1/2,
// overlay0/1/2, and accent colors. We map them to our CSS variable system.

type CatppuccinPalette = {
	base: string;
	mantle: string;
	crust: string;
	surface0: string;
	surface1: string;
	text: string;
	subtext0: string;
	overlay0: string;
	lavender: string;
	blue: string;
	borderAlpha: string; // rgba border color tuned per flavor
	overlayAlpha: string; // rgba overlay color tuned per flavor
};

function makeCatppuccinTheme(id: string, labelKey: string, p: CatppuccinPalette): ThemeDefinition {
	return {
		id,
		labelKey,
		variables: {
			'--color-app-bg': p.base,
			'--color-surface': p.mantle,
			'--color-surface-2': p.surface0,
			'--color-border': p.borderAlpha,
			'--color-outline': `${p.lavender}cc`,
			'--color-text': p.text,
			'--color-text-muted': p.subtext0,
			'--color-button-bg': p.surface0,
			'--color-button-text': p.text,
			'--color-input-bg': p.crust,
			'--color-input-text': p.text,
			'--color-accent': p.blue,
			'--color-overlay': p.overlayAlpha,
		},
	};
}

const catppuccinLatte: CatppuccinPalette = {
	base: '#eff1f5',
	mantle: '#e6e9ef',
	crust: '#dce0e8',
	surface0: '#ccd0da',
	surface1: '#bcc0cc',
	text: '#4c4f69',
	subtext0: '#6c6f85',
	overlay0: '#9ca0b0',
	lavender: '#7287fd',
	blue: '#1e66f5',
	borderAlpha: 'rgba(76, 79, 105, 0.15)',
	overlayAlpha: 'rgba(76, 79, 105, 0.42)',
};

const catppuccinFrappe: CatppuccinPalette = {
	base: '#303446',
	mantle: '#292c3c',
	crust: '#232634',
	surface0: '#414559',
	surface1: '#51576d',
	text: '#c6d0f5',
	subtext0: '#a5adce',
	overlay0: '#737994',
	lavender: '#babbf1',
	blue: '#8caaee',
	borderAlpha: 'rgba(198, 208, 245, 0.18)',
	overlayAlpha: 'rgba(35, 38, 52, 0.72)',
};

const catppuccinMacchiato: CatppuccinPalette = {
	base: '#24273a',
	mantle: '#1e2030',
	crust: '#181926',
	surface0: '#363a4f',
	surface1: '#494d64',
	text: '#cad3f5',
	subtext0: '#a5adcb',
	overlay0: '#6e738d',
	lavender: '#b7bdf8',
	blue: '#8aadf4',
	borderAlpha: 'rgba(202, 211, 245, 0.18)',
	overlayAlpha: 'rgba(24, 25, 38, 0.74)',
};

const catppuccinMocha: CatppuccinPalette = {
	base: '#1e1e2e',
	mantle: '#181825',
	crust: '#11111b',
	surface0: '#313244',
	surface1: '#45475a',
	text: '#cdd6f4',
	subtext0: '#a6adc8',
	overlay0: '#6c7086',
	lavender: '#b4befe',
	blue: '#89b4fa',
	borderAlpha: 'rgba(205, 214, 244, 0.18)',
	overlayAlpha: 'rgba(17, 17, 27, 0.76)',
};

export const THEMES: readonly ThemeDefinition[] = [
	{
		id: 'light',
		labelKey: 'theme.light',
		variables: {
			...baseThemeVariables,
			'--color-app-bg': '#f5f7fb',
			'--color-surface': '#ffffff',
			'--color-surface-2': '#f0f3f7',
			'--color-text': '#111827',
			'--color-text-muted': '#5b6473',
			'--color-button-bg': '#ffffff',
			'--color-button-text': '#111827',
			'--color-input-bg': '#ffffff',
			'--color-input-text': '#111827',
			'--color-accent': '#2f5af4',
			'--color-overlay': 'rgba(15, 23, 42, 0.45)',
		},
	},
	{
		id: 'dark',
		labelKey: 'theme.dark',
		variables: {
			'--color-app-bg': '#0b0f14',
			'--color-surface': '#161b23',
			'--color-surface-2': '#1f2632',
			'--color-border': 'rgba(148, 163, 184, 0.25)',
			'--color-outline': 'rgba(148, 163, 184, 0.55)',
			'--color-text': '#e5e7eb',
			'--color-text-muted': '#9ca3af',
			'--color-button-bg': '#1f2632',
			'--color-button-text': '#e5e7eb',
			'--color-input-bg': '#0f1520',
			'--color-input-text': '#e5e7eb',
			'--color-accent': '#7aa2f7',
			'--color-overlay': 'rgba(2, 6, 23, 0.68)',
		},
	},
	makeNordTheme('nord', 'theme.nord', '#88c0d0', '#2e3440', '#3b4252', '#434c5e', 'rgba(46, 52, 64, 0.72)'),
	makeNordTheme(
		'nord-polar-night-1',
		'theme.nordPolarNight1',
		'#81a1c1',
		'#2e3440',
		'#3b4252',
		'#434c5e',
		'rgba(46, 52, 64, 0.72)'
	),
	makeNordTheme(
		'nord-polar-night-2',
		'theme.nordPolarNight2',
		'#5e81ac',
		'#3b4252',
		'#434c5e',
		'#4c566a',
		'rgba(59, 66, 82, 0.74)'
	),
	makeNordTheme(
		'nord-polar-night-3',
		'theme.nordPolarNight3',
		'#81a1c1',
		'#434c5e',
		'#4c566a',
		'#5e81ac',
		'rgba(67, 76, 94, 0.74)'
	),
	makeNordTheme(
		'nord-polar-night-4',
		'theme.nordPolarNight4',
		'#8fbcbb',
		'#4c566a',
		'#5e81ac',
		'#81a1c1',
		'rgba(76, 86, 106, 0.74)'
	),
	makeNordTheme(
		'nord-snow-storm-1',
		'theme.nordSnowStorm1',
		'#5e81ac',
		'#eceff4',
		'#e5e9f0',
		'#d8dee9',
		'rgba(76, 86, 106, 0.4)',
		'#2e3440',
		'#4c566a'
	),
	makeNordTheme(
		'nord-snow-storm-2',
		'theme.nordSnowStorm2',
		'#81a1c1',
		'#e5e9f0',
		'#d8dee9',
		'#eceff4',
		'rgba(76, 86, 106, 0.42)',
		'#2e3440',
		'#4c566a'
	),
	makeNordTheme(
		'nord-snow-storm-3',
		'theme.nordSnowStorm3',
		'#88c0d0',
		'#d8dee9',
		'#eceff4',
		'#e5e9f0',
		'rgba(76, 86, 106, 0.42)',
		'#2e3440',
		'#4c566a'
	),
	makeNordTheme(
		'nord-frost-1',
		'theme.nordFrost1',
		'#8fbcbb',
		'#1f2a33',
		'#253341',
		'#2b3c4d',
		'rgba(31, 42, 51, 0.75)',
		'#e5f4f7',
		'#bfdae0'
	),
	makeNordTheme(
		'nord-frost-2',
		'theme.nordFrost2',
		'#88c0d0',
		'#20303d',
		'#263949',
		'#2d4256',
		'rgba(32, 48, 61, 0.75)',
		'#e5f4f7',
		'#bfdae0'
	),
	makeNordTheme(
		'nord-frost-3',
		'theme.nordFrost3',
		'#81a1c1',
		'#202c3b',
		'#27364a',
		'#2f4159',
		'rgba(32, 44, 59, 0.75)',
		'#e5f0f7',
		'#c4d3e1'
	),
	makeNordTheme(
		'nord-frost-4',
		'theme.nordFrost4',
		'#5e81ac',
		'#1d2533',
		'#253042',
		'#2c3b50',
		'rgba(29, 37, 51, 0.76)',
		'#e0ecf7',
		'#bccddd'
	),
	makeNordTheme(
		'nord-aurora-red',
		'theme.nordAuroraRed',
		'#bf616a',
		'#35232c',
		'#402933',
		'#4a303c',
		'rgba(53, 35, 44, 0.76)'
	),
	makeNordTheme(
		'nord-aurora-orange',
		'theme.nordAuroraOrange',
		'#d08770',
		'#352b25',
		'#403229',
		'#4a3a2e',
		'rgba(53, 43, 37, 0.76)'
	),
	makeNordTheme(
		'nord-aurora-yellow',
		'theme.nordAuroraYellow',
		'#ebcb8b',
		'#3c3523',
		'#473f2a',
		'#524a31',
		'rgba(60, 53, 35, 0.76)'
	),
	makeNordTheme(
		'nord-aurora-green',
		'theme.nordAuroraGreen',
		'#a3be8c',
		'#243127',
		'#2b3a2f',
		'#334337',
		'rgba(36, 49, 39, 0.76)'
	),
	makeNordTheme(
		'nord-aurora-purple',
		'theme.nordAuroraPurple',
		'#b48ead',
		'#2b2236',
		'#322a3f',
		'#3c314a',
		'rgba(43, 34, 54, 0.76)'
	),
	// ── Catppuccin ──────────────────────────────────────────────────────────
	makeCatppuccinTheme('catppuccin-latte', 'theme.catppuccinLatte', catppuccinLatte),
	makeCatppuccinTheme('catppuccin-frappe', 'theme.catppuccinFrappe', catppuccinFrappe),
	makeCatppuccinTheme('catppuccin-macchiato', 'theme.catppuccinMacchiato', catppuccinMacchiato),
	makeCatppuccinTheme('catppuccin-mocha', 'theme.catppuccinMocha', catppuccinMocha),
];

export type ThemeId = (typeof THEMES)[number]['id'];

const fallbackThemeId: ThemeId = 'dark';

/** IDs of themes that use a light background (need dark icons/text). */
const LIGHT_THEME_IDS: ReadonlySet<string> = new Set([
	'light',
	'nord-snow-storm-1',
	'nord-snow-storm-2',
	'nord-snow-storm-3',
	'catppuccin-latte',
]);

/** Returns true if the given theme has a light background. */
export function isLightTheme(themeId: ThemeId): boolean {
	return LIGHT_THEME_IDS.has(themeId);
}

export function getTheme(themeId: ThemeId): ThemeDefinition {
	return THEMES.find((theme) => theme.id === themeId) ?? THEMES.find((theme) => theme.id === fallbackThemeId)!;
}

export function getStoredThemeId(): ThemeId {
	if (typeof window === 'undefined') return fallbackThemeId;
	const raw = window.localStorage.getItem(STORAGE_KEY);
	if (!raw) return fallbackThemeId;
	const match = THEMES.find((theme) => theme.id === raw);
	return (match?.id ?? fallbackThemeId) as ThemeId;
}

export function applyTheme(themeId: ThemeId): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	const theme = getTheme(themeId);
	root.setAttribute('data-theme', theme.id);
	for (const [key, value] of Object.entries(theme.variables)) {
		root.style.setProperty(key, value);
	}
}

export function persistThemeId(themeId: ThemeId): void {
	if (typeof window === 'undefined') return;
	window.localStorage.setItem(STORAGE_KEY, themeId);
}
