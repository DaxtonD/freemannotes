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
// Each flavor (Latte, Frappé, Macchiato, Mocha) × 14 accent colors = 56 themes.
// Background/surface/text are shared per flavor; accent varies per sub-variant.

type CatppuccinFlavor = {
	base: string;
	mantle: string;
	crust: string;
	surface0: string;
	surface1: string;
	text: string;
	subtext0: string;
	overlay0: string;
	borderAlpha: string;
	overlayAlpha: string;
	accents: Record<string, string>;
};

function makeCatppuccinTheme(
	flavorSlug: string,
	flavorLabelKey: string,
	accentSlug: string,
	accentLabelKey: string,
	accentColor: string,
	f: CatppuccinFlavor
): ThemeDefinition {
	return {
		id: `catppuccin-${flavorSlug}-${accentSlug}`,
		labelKey: `theme.catppuccin${flavorLabelKey}${accentLabelKey}`,
		variables: {
			'--color-app-bg': f.base,
			'--color-surface': f.mantle,
			'--color-surface-2': f.surface0,
			'--color-border': f.borderAlpha,
			'--color-outline': `${accentColor}cc`,
			'--color-text': f.text,
			'--color-text-muted': f.subtext0,
			'--color-button-bg': f.surface0,
			'--color-button-text': f.text,
			'--color-input-bg': f.crust,
			'--color-input-text': f.text,
			'--color-accent': accentColor,
			'--color-overlay': f.overlayAlpha,
		},
	};
}

// ── Generic theme variant factory (base palette × accent variants) ─────────
type AccentThemeBase = {
	appBg: string;
	surface: string;
	surface2: string;
	border: string;
	overlay: string;
	text: string;
	textMuted: string;
	buttonBg?: string;
	inputBg?: string;
};

type AccentDef = { slug: string; labelKey: string; color: string };

function makeAccentVariantTheme(
	familyId: string,
	variantSlug: string,
	variantLabelKey: string,
	accent: AccentDef,
	base: AccentThemeBase
): ThemeDefinition {
	return {
		id: `${familyId}-${variantSlug}-${accent.slug}`,
		labelKey: `theme.${familyId}${variantLabelKey}${accent.labelKey}`,
		variables: {
			'--color-app-bg': base.appBg,
			'--color-surface': base.surface,
			'--color-surface-2': base.surface2,
			'--color-border': base.border,
			'--color-outline': `${accent.color}cc`,
			'--color-text': base.text,
			'--color-text-muted': base.textMuted,
			'--color-button-bg': base.buttonBg ?? base.surface2,
			'--color-button-text': base.text,
			'--color-input-bg': base.inputBg ?? base.appBg,
			'--color-input-text': base.text,
			'--color-accent': accent.color,
			'--color-overlay': base.overlay,
		},
	};
}

// ── Gruvbox (Dark/Light × Hard/Medium/Soft × accents) ─────────────────────
const GRUVBOX_ACCENTS: readonly AccentDef[] = [
	{ slug: 'red', labelKey: 'Red', color: '#cc241d' },
	{ slug: 'orange', labelKey: 'Orange', color: '#d65d0e' },
	{ slug: 'yellow', labelKey: 'Yellow', color: '#d79921' },
	{ slug: 'green', labelKey: 'Green', color: '#98971a' },
	{ slug: 'aqua', labelKey: 'Aqua', color: '#689d6a' },
	{ slug: 'blue', labelKey: 'Blue', color: '#458588' },
	{ slug: 'purple', labelKey: 'Purple', color: '#b16286' },
];

const gruvboxDarkHard: AccentThemeBase = {
	appBg: '#1d2021',
	surface: '#282828',
	surface2: '#3c3836',
	border: 'rgba(235, 219, 178, 0.18)',
	overlay: 'rgba(29, 32, 33, 0.78)',
	text: '#ebdbb2',
	textMuted: '#d5c4a1',
	inputBg: '#141617',
};

const gruvboxDarkMedium: AccentThemeBase = {
	appBg: '#282828',
	surface: '#3c3836',
	surface2: '#504945',
	border: 'rgba(235, 219, 178, 0.18)',
	overlay: 'rgba(40, 40, 40, 0.76)',
	text: '#ebdbb2',
	textMuted: '#d5c4a1',
	inputBg: '#1d2021',
};

const gruvboxDarkSoft: AccentThemeBase = {
	appBg: '#32302f',
	surface: '#3c3836',
	surface2: '#504945',
	border: 'rgba(235, 219, 178, 0.18)',
	overlay: 'rgba(50, 48, 47, 0.76)',
	text: '#ebdbb2',
	textMuted: '#d5c4a1',
	inputBg: '#282828',
};

const gruvboxLightHard: AccentThemeBase = {
	appBg: '#f9f5d7',
	surface: '#fbf1c7',
	surface2: '#f2e5bc',
	border: 'rgba(60, 56, 54, 0.18)',
	overlay: 'rgba(249, 245, 215, 0.72)',
	text: '#3c3836',
	textMuted: '#665c54',
	inputBg: '#ffffff',
	buttonBg: '#fbf1c7',
};

const gruvboxLightMedium: AccentThemeBase = {
	appBg: '#fbf1c7',
	surface: '#f2e5bc',
	surface2: '#ebdbb2',
	border: 'rgba(60, 56, 54, 0.18)',
	overlay: 'rgba(251, 241, 199, 0.70)',
	text: '#3c3836',
	textMuted: '#665c54',
	inputBg: '#ffffff',
	buttonBg: '#f2e5bc',
};

const gruvboxLightSoft: AccentThemeBase = {
	appBg: '#f2e5bc',
	surface: '#ebdbb2',
	surface2: '#e0d1a9',
	border: 'rgba(60, 56, 54, 0.18)',
	overlay: 'rgba(242, 229, 188, 0.70)',
	text: '#3c3836',
	textMuted: '#665c54',
	inputBg: '#ffffff',
	buttonBg: '#ebdbb2',
};

const gruvboxThemes: ThemeDefinition[] = [
	...GRUVBOX_ACCENTS.map((a) => makeAccentVariantTheme('gruvbox', 'dark-hard', 'DarkHard', a, gruvboxDarkHard)),
	...GRUVBOX_ACCENTS.map((a) => makeAccentVariantTheme('gruvbox', 'dark-medium', 'DarkMedium', a, gruvboxDarkMedium)),
	...GRUVBOX_ACCENTS.map((a) => makeAccentVariantTheme('gruvbox', 'dark-soft', 'DarkSoft', a, gruvboxDarkSoft)),
	...GRUVBOX_ACCENTS.map((a) => makeAccentVariantTheme('gruvbox', 'light-hard', 'LightHard', a, gruvboxLightHard)),
	...GRUVBOX_ACCENTS.map((a) => makeAccentVariantTheme('gruvbox', 'light-medium', 'LightMedium', a, gruvboxLightMedium)),
	...GRUVBOX_ACCENTS.map((a) => makeAccentVariantTheme('gruvbox', 'light-soft', 'LightSoft', a, gruvboxLightSoft)),
];

// ── Everforest (Dark/Light × Hard/Medium/Soft × accents) ──────────────────
const EVERFOREST_ACCENTS: readonly AccentDef[] = [
	{ slug: 'red', labelKey: 'Red', color: '#e67e80' },
	{ slug: 'orange', labelKey: 'Orange', color: '#e69875' },
	{ slug: 'yellow', labelKey: 'Yellow', color: '#dbbc7f' },
	{ slug: 'green', labelKey: 'Green', color: '#a7c080' },
	{ slug: 'aqua', labelKey: 'Aqua', color: '#83c092' },
	{ slug: 'blue', labelKey: 'Blue', color: '#7fbbb3' },
	{ slug: 'purple', labelKey: 'Purple', color: '#d699b6' },
];

const everforestDarkHard: AccentThemeBase = {
	appBg: '#232a2e',
	surface: '#2d353b',
	surface2: '#343f44',
	border: 'rgba(211, 198, 170, 0.18)',
	overlay: 'rgba(35, 42, 46, 0.78)',
	text: '#d3c6aa',
	textMuted: '#9da9a0',
	inputBg: '#1a2023',
};

const everforestDarkMedium: AccentThemeBase = {
	appBg: '#2d353b',
	surface: '#343f44',
	surface2: '#3d484d',
	border: 'rgba(211, 198, 170, 0.18)',
	overlay: 'rgba(45, 53, 59, 0.76)',
	text: '#d3c6aa',
	textMuted: '#9da9a0',
	inputBg: '#232a2e',
};

const everforestDarkSoft: AccentThemeBase = {
	appBg: '#333c43',
	surface: '#3a454a',
	surface2: '#445055',
	border: 'rgba(211, 198, 170, 0.18)',
	overlay: 'rgba(51, 60, 67, 0.76)',
	text: '#d3c6aa',
	textMuted: '#9da9a0',
	inputBg: '#2d353b',
};

const everforestLightHard: AccentThemeBase = {
	appBg: '#f3ead3',
	surface: '#e9dfc6',
	surface2: '#e0d6bd',
	border: 'rgba(92, 106, 114, 0.18)',
	overlay: 'rgba(243, 234, 211, 0.70)',
	text: '#5c6a72',
	textMuted: '#829181',
	inputBg: '#ffffff',
	buttonBg: '#e9dfc6',
};

const everforestLightMedium: AccentThemeBase = {
	appBg: '#fdf6e3',
	surface: '#f4f0d9',
	surface2: '#efebd4',
	border: 'rgba(92, 106, 114, 0.18)',
	overlay: 'rgba(253, 246, 227, 0.68)',
	text: '#5c6a72',
	textMuted: '#829181',
	inputBg: '#ffffff',
	buttonBg: '#f4f0d9',
};

const everforestLightSoft: AccentThemeBase = {
	appBg: '#f8f0dc',
	surface: '#f0e8d4',
	surface2: '#e9e1cd',
	border: 'rgba(92, 106, 114, 0.18)',
	overlay: 'rgba(248, 240, 220, 0.68)',
	text: '#5c6a72',
	textMuted: '#829181',
	inputBg: '#ffffff',
	buttonBg: '#f0e8d4',
};

const everforestThemes: ThemeDefinition[] = [
	...EVERFOREST_ACCENTS.map((a) => makeAccentVariantTheme('everforest', 'dark-hard', 'DarkHard', a, everforestDarkHard)),
	...EVERFOREST_ACCENTS.map((a) => makeAccentVariantTheme('everforest', 'dark-medium', 'DarkMedium', a, everforestDarkMedium)),
	...EVERFOREST_ACCENTS.map((a) => makeAccentVariantTheme('everforest', 'dark-soft', 'DarkSoft', a, everforestDarkSoft)),
	...EVERFOREST_ACCENTS.map((a) => makeAccentVariantTheme('everforest', 'light-hard', 'LightHard', a, everforestLightHard)),
	...EVERFOREST_ACCENTS.map((a) => makeAccentVariantTheme('everforest', 'light-medium', 'LightMedium', a, everforestLightMedium)),
	...EVERFOREST_ACCENTS.map((a) => makeAccentVariantTheme('everforest', 'light-soft', 'LightSoft', a, everforestLightSoft)),
];

// ── Rose Pine (Main/Moon/Dawn × accents) ──────────────────────────────────
const ROSEPINE_ACCENTS: readonly AccentDef[] = [
	{ slug: 'rose', labelKey: 'Rose', color: '#eb6f92' },
	{ slug: 'gold', labelKey: 'Gold', color: '#f6c177' },
	{ slug: 'pine', labelKey: 'Pine', color: '#31748f' },
	{ slug: 'foam', labelKey: 'Foam', color: '#9ccfd8' },
	{ slug: 'iris', labelKey: 'Iris', color: '#c4a7e7' },
	{ slug: 'love', labelKey: 'Love', color: '#ebbcba' },
];

const rosePineMain: AccentThemeBase = {
	appBg: '#191724',
	surface: '#1f1d2e',
	surface2: '#26233a',
	border: 'rgba(224, 222, 244, 0.16)',
	overlay: 'rgba(25, 23, 36, 0.78)',
	text: '#e0def4',
	textMuted: '#908caa',
	inputBg: '#16141f',
};

const rosePineMoon: AccentThemeBase = {
	appBg: '#232136',
	surface: '#2a273f',
	surface2: '#393552',
	border: 'rgba(224, 222, 244, 0.16)',
	overlay: 'rgba(35, 33, 54, 0.78)',
	text: '#e0def4',
	textMuted: '#908caa',
	inputBg: '#1f1d2e',
};

const rosePineDawn: AccentThemeBase = {
	appBg: '#faf4ed',
	surface: '#fffaf3',
	surface2: '#f2e9e1',
	border: 'rgba(87, 82, 121, 0.16)',
	overlay: 'rgba(250, 244, 237, 0.70)',
	text: '#575279',
	textMuted: '#797593',
	inputBg: '#ffffff',
	buttonBg: '#fffaf3',
};

const rosePineThemes: ThemeDefinition[] = [
	...ROSEPINE_ACCENTS.map((a) => makeAccentVariantTheme('rosePine', 'main', 'Main', a, rosePineMain)),
	...ROSEPINE_ACCENTS.map((a) => makeAccentVariantTheme('rosePine', 'moon', 'Moon', a, rosePineMoon)),
	...ROSEPINE_ACCENTS.map((a) => makeAccentVariantTheme('rosePine', 'dawn', 'Dawn', a, rosePineDawn)),
];

// ── Earth / neutral palettes (small curated set, not accent permutations) ──
const earthyThemes: ThemeDefinition[] = [
	{
		id: 'earth-warm-charcoal',
		labelKey: 'theme.earthWarmCharcoal',
		variables: {
			'--color-app-bg': '#211d1a',
			'--color-surface': '#2d2723',
			'--color-surface-2': '#3a332e',
			'--color-border': 'rgba(214, 198, 177, 0.18)',
			'--color-outline': 'rgba(199, 160, 122, 0.65)',
			'--color-text': '#efe4d7',
			'--color-text-muted': '#c4b4a2',
			'--color-button-bg': '#3a332e',
			'--color-button-text': '#efe4d7',
			'--color-input-bg': '#191614',
			'--color-input-text': '#efe4d7',
			'--color-accent': '#c7a07a',
			'--color-overlay': 'rgba(24, 21, 19, 0.72)',
		},
	},
	{
		id: 'earth-taupe-earth',
		labelKey: 'theme.earthTaupeEarth',
		variables: {
			'--color-app-bg': '#d9d0c4',
			'--color-surface': '#e8dfd3',
			'--color-surface-2': '#d1c5b6',
			'--color-border': 'rgba(88, 74, 60, 0.18)',
			'--color-outline': 'rgba(124, 104, 84, 0.62)',
			'--color-text': '#342b25',
			'--color-text-muted': '#6e6157',
			'--color-button-bg': '#e8dfd3',
			'--color-button-text': '#342b25',
			'--color-input-bg': '#f4eee6',
			'--color-input-text': '#342b25',
			'--color-accent': '#7c6854',
			'--color-overlay': 'rgba(70, 58, 47, 0.28)',
		},
	},
	{
		id: 'earth-mossy-hollow',
		labelKey: 'theme.earthMossyHollow',
		variables: {
			'--color-app-bg': '#20261f',
			'--color-surface': '#2a3228',
			'--color-surface-2': '#354034',
			'--color-border': 'rgba(198, 206, 184, 0.16)',
			'--color-outline': 'rgba(130, 156, 108, 0.62)',
			'--color-text': '#e6eadf',
			'--color-text-muted': '#b8c0b0',
			'--color-button-bg': '#354034',
			'--color-button-text': '#e6eadf',
			'--color-input-bg': '#181d17',
			'--color-input-text': '#e6eadf',
			'--color-accent': '#829c6c',
			'--color-overlay': 'rgba(18, 24, 18, 0.7)',
		},
	},
	{
		id: 'earth-weathered-sand',
		labelKey: 'theme.earthWeatheredSand',
		variables: {
			'--color-app-bg': '#eee4d4',
			'--color-surface': '#f7f0e5',
			'--color-surface-2': '#e6d8c5',
			'--color-border': 'rgba(98, 84, 68, 0.16)',
			'--color-outline': 'rgba(165, 133, 98, 0.56)',
			'--color-text': '#2f2923',
			'--color-text-muted': '#74685c',
			'--color-button-bg': '#f7f0e5',
			'--color-button-text': '#2f2923',
			'--color-input-bg': '#fffaf2',
			'--color-input-text': '#2f2923',
			'--color-accent': '#a58562',
			'--color-overlay': 'rgba(58, 48, 39, 0.24)',
		},
	},
	{
		id: 'earth-riverstone-fog',
		labelKey: 'theme.earthRiverstoneFog',
		variables: {
			'--color-app-bg': '#dde1df',
			'--color-surface': '#eef1ef',
			'--color-surface-2': '#d2d8d5',
			'--color-border': 'rgba(74, 79, 77, 0.15)',
			'--color-outline': 'rgba(102, 122, 118, 0.56)',
			'--color-text': '#28302d',
			'--color-text-muted': '#64706b',
			'--color-button-bg': '#eef1ef',
			'--color-button-text': '#28302d',
			'--color-input-bg': '#f9fbfa',
			'--color-input-text': '#28302d',
			'--color-accent': '#667a76',
			'--color-overlay': 'rgba(41, 49, 46, 0.24)',
		},
	},
	{
		id: 'earth-flint-hollow',
		labelKey: 'theme.earthFlintHollow',
		variables: {
			'--color-app-bg': '#1d2022',
			'--color-surface': '#272b2d',
			'--color-surface-2': '#32383b',
			'--color-border': 'rgba(203, 208, 204, 0.16)',
			'--color-outline': 'rgba(137, 149, 147, 0.58)',
			'--color-text': '#e5e8e4',
			'--color-text-muted': '#b6beb8',
			'--color-button-bg': '#32383b',
			'--color-button-text': '#e5e8e4',
			'--color-input-bg': '#171a1b',
			'--color-input-text': '#e5e8e4',
			'--color-accent': '#899593',
			'--color-overlay': 'rgba(20, 24, 25, 0.72)',
		},
	},
	{
		id: 'earth-clay-hearth',
		labelKey: 'theme.earthClayHearth',
		variables: {
			'--color-app-bg': '#2a201d',
			'--color-surface': '#352824',
			'--color-surface-2': '#43322d',
			'--color-border': 'rgba(221, 198, 184, 0.16)',
			'--color-outline': 'rgba(180, 121, 90, 0.6)',
			'--color-text': '#f1e3d8',
			'--color-text-muted': '#cab2a4',
			'--color-button-bg': '#43322d',
			'--color-button-text': '#f1e3d8',
			'--color-input-bg': '#201816',
			'--color-input-text': '#f1e3d8',
			'--color-accent': '#b4795a',
			'--color-overlay': 'rgba(27, 20, 18, 0.72)',
		},
	},
	{
		id: 'earth-linen-stone',
		labelKey: 'theme.earthLinenStone',
		variables: {
			'--color-app-bg': '#e7e0d7',
			'--color-surface': '#f4eee6',
			'--color-surface-2': '#ddd3c7',
			'--color-border': 'rgba(93, 84, 74, 0.15)',
			'--color-outline': 'rgba(132, 118, 103, 0.54)',
			'--color-text': '#312b26',
			'--color-text-muted': '#74675d',
			'--color-button-bg': '#f4eee6',
			'--color-button-text': '#312b26',
			'--color-input-bg': '#fffaf4',
			'--color-input-text': '#312b26',
			'--color-accent': '#847667',
			'--color-overlay': 'rgba(49, 43, 38, 0.22)',
		},
	},
	{
		id: 'earth-canyon-dust',
		labelKey: 'theme.earthCanyonDust',
		variables: {
			'--color-app-bg': '#ead8c7',
			'--color-surface': '#f7ecdf',
			'--color-surface-2': '#e2c9b2',
			'--color-border': 'rgba(103, 80, 61, 0.15)',
			'--color-outline': 'rgba(172, 124, 82, 0.56)',
			'--color-text': '#34271f',
			'--color-text-muted': '#7b6657',
			'--color-button-bg': '#f7ecdf',
			'--color-button-text': '#34271f',
			'--color-input-bg': '#fff8f0',
			'--color-input-text': '#34271f',
			'--color-accent': '#ac7c52',
			'--color-overlay': 'rgba(62, 47, 36, 0.22)',
		},
	},
	{
		id: 'earth-olive-grove',
		labelKey: 'theme.earthOliveGrove',
		variables: {
			'--color-app-bg': '#252820',
			'--color-surface': '#313629',
			'--color-surface-2': '#3f4634',
			'--color-border': 'rgba(212, 215, 191, 0.16)',
			'--color-outline': 'rgba(146, 156, 104, 0.6)',
			'--color-text': '#ececde',
			'--color-text-muted': '#c2c7ae',
			'--color-button-bg': '#3f4634',
			'--color-button-text': '#ececde',
			'--color-input-bg': '#1c1f19',
			'--color-input-text': '#ececde',
			'--color-accent': '#929c68',
			'--color-overlay': 'rgba(24, 27, 21, 0.72)',
		},
	},
	{
		id: 'earth-ashen-oak',
		labelKey: 'theme.earthAshenOak',
		variables: {
			'--color-app-bg': '#24211f',
			'--color-surface': '#2f2a27',
			'--color-surface-2': '#3b3531',
			'--color-border': 'rgba(215, 206, 197, 0.16)',
			'--color-outline': 'rgba(151, 134, 118, 0.58)',
			'--color-text': '#ece3da',
			'--color-text-muted': '#c1b4aa',
			'--color-button-bg': '#3b3531',
			'--color-button-text': '#ece3da',
			'--color-input-bg': '#1b1817',
			'--color-input-text': '#ece3da',
			'--color-accent': '#978676',
			'--color-overlay': 'rgba(22, 20, 18, 0.72)',
		},
	},
	{
		id: 'earth-misty-quarry',
		labelKey: 'theme.earthMistyQuarry',
		variables: {
			'--color-app-bg': '#e2e1dd',
			'--color-surface': '#f1f0ec',
			'--color-surface-2': '#d5d3ce',
			'--color-border': 'rgba(80, 79, 76, 0.14)',
			'--color-outline': 'rgba(109, 112, 111, 0.52)',
			'--color-text': '#2f312f',
			'--color-text-muted': '#6a6e6b',
			'--color-button-bg': '#f1f0ec',
			'--color-button-text': '#2f312f',
			'--color-input-bg': '#fafaf8',
			'--color-input-text': '#2f312f',
			'--color-accent': '#6d706f',
			'--color-overlay': 'rgba(42, 44, 42, 0.2)',
		},
	},
	{
		id: 'earth-copper-dusk',
		labelKey: 'theme.earthCopperDusk',
		variables: {
			'--color-app-bg': '#241c1b',
			'--color-surface': '#302523',
			'--color-surface-2': '#3d2f2c',
			'--color-border': 'rgba(222, 199, 186, 0.16)',
			'--color-outline': 'rgba(181, 113, 82, 0.62)',
			'--color-text': '#f0e1d8',
			'--color-text-muted': '#c9b0a3',
			'--color-button-bg': '#3d2f2c',
			'--color-button-text': '#f0e1d8',
			'--color-input-bg': '#1b1514',
			'--color-input-text': '#f0e1d8',
			'--color-accent': '#b57152',
			'--color-overlay': 'rgba(24, 18, 17, 0.72)',
		},
	},
	{
		id: 'earth-heather-lichen',
		labelKey: 'theme.earthHeatherLichen',
		variables: {
			'--color-app-bg': '#e3e3d7',
			'--color-surface': '#f1f2e9',
			'--color-surface-2': '#d7d9c9',
			'--color-border': 'rgba(86, 92, 76, 0.14)',
			'--color-outline': 'rgba(121, 135, 100, 0.54)',
			'--color-text': '#2d3128',
			'--color-text-muted': '#69705e',
			'--color-button-bg': '#f1f2e9',
			'--color-button-text': '#2d3128',
			'--color-input-bg': '#fbfcf7',
			'--color-input-text': '#2d3128',
			'--color-accent': '#798764',
			'--color-overlay': 'rgba(45, 49, 40, 0.2)',
		},
	},
	{
		id: 'earth-driftwood',
		labelKey: 'theme.earthDriftwood',
		variables: {
			'--color-app-bg': '#d7d0c7',
			'--color-surface': '#e9e1d7',
			'--color-surface-2': '#cbc0b3',
			'--color-border': 'rgba(89, 79, 69, 0.14)',
			'--color-outline': 'rgba(134, 111, 92, 0.54)',
			'--color-text': '#312921',
			'--color-text-muted': '#736559',
			'--color-button-bg': '#e9e1d7',
			'--color-button-text': '#312921',
			'--color-input-bg': '#f7f3ee',
			'--color-input-text': '#312921',
			'--color-accent': '#866f5c',
			'--color-overlay': 'rgba(49, 41, 33, 0.22)',
		},
	},
	{
		id: 'earth-birch-smoke',
		labelKey: 'theme.earthBirchSmoke',
		variables: {
			'--color-app-bg': '#f0ece5',
			'--color-surface': '#faf6f0',
			'--color-surface-2': '#e2dbd1',
			'--color-border': 'rgba(83, 78, 73, 0.14)',
			'--color-outline': 'rgba(123, 114, 103, 0.5)',
			'--color-text': '#2f2b27',
			'--color-text-muted': '#70685f',
			'--color-button-bg': '#faf6f0',
			'--color-button-text': '#2f2b27',
			'--color-input-bg': '#fffdfa',
			'--color-input-text': '#2f2b27',
			'--color-accent': '#7b7267',
			'--color-overlay': 'rgba(47, 43, 39, 0.18)',
		},
	},
];

// ── Tokyo Night (Night/Storm/Moon/Day × accents) ──────────────────────────
const TOKYONIGHT_ACCENTS: readonly AccentDef[] = [
	{ slug: 'blue', labelKey: 'Blue', color: '#7aa2f7' },
	{ slug: 'cyan', labelKey: 'Cyan', color: '#7dcfff' },
	{ slug: 'green', labelKey: 'Green', color: '#9ece6a' },
	{ slug: 'yellow', labelKey: 'Yellow', color: '#e0af68' },
	{ slug: 'orange', labelKey: 'Orange', color: '#ff9e64' },
	{ slug: 'red', labelKey: 'Red', color: '#f7768e' },
	{ slug: 'purple', labelKey: 'Purple', color: '#bb9af7' },
];

const tokyoNightNight: AccentThemeBase = {
	appBg: '#1a1b26',
	surface: '#24283b',
	surface2: '#2f334d',
	border: 'rgba(192, 202, 245, 0.18)',
	overlay: 'rgba(26, 27, 38, 0.78)',
	text: '#c0caf5',
	textMuted: '#9aa5ce',
	inputBg: '#16161e',
};

const tokyoNightStorm: AccentThemeBase = {
	appBg: '#24283b',
	surface: '#2f334d',
	surface2: '#3b4261',
	border: 'rgba(192, 202, 245, 0.18)',
	overlay: 'rgba(36, 40, 59, 0.78)',
	text: '#c0caf5',
	textMuted: '#9aa5ce',
	inputBg: '#1f2335',
};

const tokyoNightMoon: AccentThemeBase = {
	appBg: '#222436',
	surface: '#2b2d3f',
	surface2: '#363a4f',
	border: 'rgba(200, 211, 245, 0.18)',
	overlay: 'rgba(34, 36, 54, 0.78)',
	text: '#c8d3f5',
	textMuted: '#a9b8e8',
	inputBg: '#1e2030',
};

const tokyoNightDay: AccentThemeBase = {
	appBg: '#e1e2e7',
	surface: '#d7d8dd',
	surface2: '#c4c8da',
	border: 'rgba(55, 96, 191, 0.18)',
	overlay: 'rgba(225, 226, 231, 0.70)',
	text: '#3760bf',
	textMuted: '#6172b0',
	inputBg: '#ffffff',
	buttonBg: '#d7d8dd',
};

const tokyoNightThemes: ThemeDefinition[] = [
	...TOKYONIGHT_ACCENTS.map((a) => makeAccentVariantTheme('tokyoNight', 'night', 'Night', a, tokyoNightNight)),
	...TOKYONIGHT_ACCENTS.map((a) => makeAccentVariantTheme('tokyoNight', 'storm', 'Storm', a, tokyoNightStorm)),
	...TOKYONIGHT_ACCENTS.map((a) => makeAccentVariantTheme('tokyoNight', 'moon', 'Moon', a, tokyoNightMoon)),
	...TOKYONIGHT_ACCENTS.map((a) => makeAccentVariantTheme('tokyoNight', 'day', 'Day', a, tokyoNightDay)),
];

// ── Accent color definitions (slug → label key suffix) ──────────────────────
const ACCENT_KEYS: readonly { slug: string; labelKey: string }[] = [
	{ slug: 'rosewater', labelKey: 'Rosewater' },
	{ slug: 'flamingo', labelKey: 'Flamingo' },
	{ slug: 'pink', labelKey: 'Pink' },
	{ slug: 'mauve', labelKey: 'Mauve' },
	{ slug: 'red', labelKey: 'Red' },
	{ slug: 'maroon', labelKey: 'Maroon' },
	{ slug: 'peach', labelKey: 'Peach' },
	{ slug: 'yellow', labelKey: 'Yellow' },
	{ slug: 'green', labelKey: 'Green' },
	{ slug: 'teal', labelKey: 'Teal' },
	{ slug: 'sky', labelKey: 'Sky' },
	{ slug: 'sapphire', labelKey: 'Sapphire' },
	{ slug: 'blue', labelKey: 'Blue' },
	{ slug: 'lavender', labelKey: 'Lavender' },
];

// ── Flavor definitions (official Catppuccin hex values) ─────────────────────

const catppuccinLatte: CatppuccinFlavor = {
	base: '#eff1f5', mantle: '#e6e9ef', crust: '#dce0e8',
	surface0: '#ccd0da', surface1: '#bcc0cc',
	text: '#4c4f69', subtext0: '#6c6f85', overlay0: '#9ca0b0',
	borderAlpha: 'rgba(76, 79, 105, 0.15)',
	overlayAlpha: 'rgba(76, 79, 105, 0.42)',
	accents: {
		rosewater: '#dc8a78', flamingo: '#dd7878', pink: '#ea76cb', mauve: '#8839ef',
		red: '#d20f39', maroon: '#e64553', peach: '#fe640b', yellow: '#df8e1d',
		green: '#40a02b', teal: '#179299', sky: '#04a5e5', sapphire: '#209fb5',
		blue: '#1e66f5', lavender: '#7287fd',
	},
};

const catppuccinFrappe: CatppuccinFlavor = {
	base: '#303446', mantle: '#292c3c', crust: '#232634',
	surface0: '#414559', surface1: '#51576d',
	text: '#c6d0f5', subtext0: '#a5adce', overlay0: '#737994',
	borderAlpha: 'rgba(198, 208, 245, 0.18)',
	overlayAlpha: 'rgba(35, 38, 52, 0.72)',
	accents: {
		rosewater: '#f2d5cf', flamingo: '#eebebe', pink: '#f4b8e4', mauve: '#ca9ee6',
		red: '#e78284', maroon: '#ea999c', peach: '#ef9f76', yellow: '#e5c890',
		green: '#a6d189', teal: '#81c8be', sky: '#99d1db', sapphire: '#85c1dc',
		blue: '#8caaee', lavender: '#babbf1',
	},
};

const catppuccinMacchiato: CatppuccinFlavor = {
	base: '#24273a', mantle: '#1e2030', crust: '#181926',
	surface0: '#363a4f', surface1: '#494d64',
	text: '#cad3f5', subtext0: '#a5adcb', overlay0: '#6e738d',
	borderAlpha: 'rgba(202, 211, 245, 0.18)',
	overlayAlpha: 'rgba(24, 25, 38, 0.74)',
	accents: {
		rosewater: '#f4dbd6', flamingo: '#f0c6c6', pink: '#f5bde6', mauve: '#c6a0f6',
		red: '#ed8796', maroon: '#ee99a0', peach: '#f5a97f', yellow: '#eed49f',
		green: '#a6da95', teal: '#8bd5ca', sky: '#91d7e3', sapphire: '#7dc4e4',
		blue: '#8aadf4', lavender: '#b7bdf8',
	},
};

const catppuccinMocha: CatppuccinFlavor = {
	base: '#1e1e2e', mantle: '#181825', crust: '#11111b',
	surface0: '#313244', surface1: '#45475a',
	text: '#cdd6f4', subtext0: '#a6adc8', overlay0: '#6c7086',
	borderAlpha: 'rgba(205, 214, 244, 0.18)',
	overlayAlpha: 'rgba(17, 17, 27, 0.76)',
	accents: {
		rosewater: '#f5e0dc', flamingo: '#f2cdcd', pink: '#f5c2e7', mauve: '#cba6f7',
		red: '#f38ba8', maroon: '#eba0ac', peach: '#fab387', yellow: '#f9e2af',
		green: '#a6e3a1', teal: '#94e2d5', sky: '#89dceb', sapphire: '#74c7ec',
		blue: '#89b4fa', lavender: '#b4befe',
	},
};

// ── Generate all 56 Catppuccin themes (4 flavors × 14 accents) ──────────────
const CATPPUCCIN_FLAVORS: readonly { slug: string; labelKey: string; flavor: CatppuccinFlavor }[] = [
	{ slug: 'latte', labelKey: 'Latte', flavor: catppuccinLatte },
	{ slug: 'frappe', labelKey: 'Frappe', flavor: catppuccinFrappe },
	{ slug: 'macchiato', labelKey: 'Macchiato', flavor: catppuccinMacchiato },
	{ slug: 'mocha', labelKey: 'Mocha', flavor: catppuccinMocha },
];

const catppuccinThemes: ThemeDefinition[] = CATPPUCCIN_FLAVORS.flatMap(({ slug, labelKey, flavor }) =>
	ACCENT_KEYS.map(({ slug: accentSlug, labelKey: accentLabelKey }) =>
		makeCatppuccinTheme(slug, labelKey, accentSlug, accentLabelKey, flavor.accents[accentSlug], flavor)
	)
);

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
	// ── Additional built-in themes (accent variants) ───────────────────────
	...earthyThemes,
	...gruvboxThemes,
	...everforestThemes,
	...rosePineThemes,
	...tokyoNightThemes,
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
	// ── Catppuccin (4 flavors × 14 accents = 56 themes) ────────────────────
	...catppuccinThemes,
];

export type ThemeId = (typeof THEMES)[number]['id'];

const fallbackThemeId: ThemeId = 'dark';

/** IDs of themes that use a light background (need dark icons/text). */
const LIGHT_THEME_IDS: ReadonlySet<string> = new Set([
	'light',
	'earth-taupe-earth',
	'earth-weathered-sand',
	'earth-riverstone-fog',
	'earth-linen-stone',
	'earth-canyon-dust',
	'earth-misty-quarry',
	'earth-heather-lichen',
	'earth-driftwood',
	'earth-birch-smoke',
	'nord-snow-storm-1',
	'nord-snow-storm-2',
	'nord-snow-storm-3',
	// Gruvbox light variants
	...GRUVBOX_ACCENTS.flatMap(({ slug }) => [
		`gruvbox-light-hard-${slug}`,
		`gruvbox-light-medium-${slug}`,
		`gruvbox-light-soft-${slug}`,
	]),
	// Everforest light variants
	...EVERFOREST_ACCENTS.flatMap(({ slug }) => [
		`everforest-light-hard-${slug}`,
		`everforest-light-medium-${slug}`,
		`everforest-light-soft-${slug}`,
	]),
	// Rose Pine Dawn is light
	...ROSEPINE_ACCENTS.map(({ slug }) => `rosePine-dawn-${slug}`),
	// Tokyo Night Day is light
	...TOKYONIGHT_ACCENTS.map(({ slug }) => `tokyoNight-day-${slug}`),
	// All Catppuccin Latte variants (light flavor)
	...ACCENT_KEYS.map(({ slug }) => `catppuccin-latte-${slug}`),
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
