import React from 'react';
import type { LocaleCode } from '../../core/i18n';
import type { ThemeId } from '../../core/theme';
import type { NoteCardBannerTitlePosition } from '../../core/deviceAppearancePreferences';
import styles from './PreferencesModal.module.css';

type ThemeCategory = 'built-in' | 'earth' | 'nord' | 'catppuccin' | 'gruvbox' | 'everforest' | 'rose-pine' | 'tokyo-night';
type AppearancePane = 'theme' | 'language' | 'display-size';

type ThemeOption = { id: ThemeId; label: string };

type LanguageOption = { code: LocaleCode; label: string };

type SliderFieldProps = {
	label: string;
	valueLabel: string;
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (nextValue: number) => void;
	onCommit?: (nextValue: number) => void;
};

function getThemeCategory(themeId: ThemeId): ThemeCategory {
	if (themeId.startsWith('earth-')) return 'earth';
	if (themeId.startsWith('nord')) return 'nord';
	if (themeId.startsWith('catppuccin-')) return 'catppuccin';
	if (themeId.startsWith('gruvbox-')) return 'gruvbox';
	if (themeId.startsWith('everforest-')) return 'everforest';
	if (themeId.startsWith('rosePine-')) return 'rose-pine';
	if (themeId.startsWith('tokyoNight-')) return 'tokyo-night';
	return 'built-in';
}

function stripThemePrefixForDisplay(theme: ThemeOption): string {
	const label = theme.label;
	if (theme.id.startsWith('earth-')) {
		const stripped = label.replace(/^Earth\s*/i, '').trim();
		return stripped || label;
	}
	if (theme.id.startsWith('nord')) {
		const stripped = label.replace(/^Nord\s*/i, '').trim();
		return stripped || label;
	}
	if (theme.id.startsWith('catppuccin-')) {
		const stripped = label.replace(/^Catppuccin\s*/i, '').trim();
		return stripped || label;
	}
	if (theme.id.startsWith('gruvbox-')) {
		const stripped = label.replace(/^Gruvbox\s*/i, '').trim();
		return stripped || label;
	}
	if (theme.id.startsWith('everforest-')) {
		const stripped = label.replace(/^Everforest\s*/i, '').trim();
		return stripped || label;
	}
	if (theme.id.startsWith('rosePine-')) {
		const stripped = label.replace(/^Rose\s*Pine\s*/i, '').trim();
		return stripped || label;
	}
	if (theme.id.startsWith('tokyoNight-')) {
		const stripped = label.replace(/^Tokyo\s*Night\s*/i, '').trim();
		return stripped || label;
	}
	return label;
}

export type AppearanceModalProps = {
	isOpen: boolean;
	onClose: () => void;
	onBack: () => void;
	t: (key: string) => string;
	themeId: ThemeId;
	onThemeChange: (nextTheme: ThemeId) => void;
	themeOptions: readonly ThemeOption[];
	language: LocaleCode;
	onLanguageChange: (nextLanguage: LocaleCode) => void;
	languageOptions: readonly LanguageOption[];
	noteCardFontScale: number;
	onNoteCardFontScaleChange: (nextScale: number) => void;
	onNoteCardFontScaleCommit: (nextScale: number) => void;
	noteEditorFontScale: number;
	onNoteEditorFontScaleChange: (nextScale: number) => void;
	onNoteEditorFontScaleCommit: (nextScale: number) => void;
	noteCardMaxHeightPx: number;
	onNoteCardMaxHeightPxChange: (nextHeightPx: number) => void;
	onNoteCardMaxHeightPxCommit: (nextHeightPx: number) => void;
	noteCardBannerTitlePosition: NoteCardBannerTitlePosition;
	onNoteCardBannerTitlePositionChange: (nextPosition: NoteCardBannerTitlePosition) => void;
	onNoteCardBannerTitlePositionCommit: (nextPosition: NoteCardBannerTitlePosition) => void;
};

const FONT_SCALE_MIN = 0.60;
const FONT_SCALE_MAX = 1.5;
const FONT_SCALE_STEP = 0.05;
const NOTE_CARD_HEIGHT_MIN = 320;
const NOTE_CARD_HEIGHT_MAX = 1400;
const NOTE_CARD_HEIGHT_STEP = 20;

function clampFontScale(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
}

function formatFontScalePercent(value: number): string {
	return `${Math.round(clampFontScale(value) * 100)}%`;
}

function formatHeightPx(value: number): string {
	return `${Math.round(value)}px`;
}

function SliderField(props: SliderFieldProps): React.JSX.Element {
	const dirtyRef = React.useRef(false);
	const commitIfDirty = React.useCallback((value: number): void => {
		if (!dirtyRef.current || !props.onCommit) return;
		dirtyRef.current = false;
		props.onCommit(value);
	}, [props]);
	const handleKeyUp = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>): void => {
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
		commitIfDirty(Number(event.currentTarget.value));
	}, [commitIfDirty]);

	return (
		<label className={styles.scaleField}>
			<div className={styles.scaleFieldHeader}>
				<span>{props.label}</span>
				<strong>{props.valueLabel}</strong>
			</div>
			<input
				type="range"
				className={styles.scaleSlider}
				min={props.min}
				max={props.max}
				step={props.step}
				value={props.value}
				onChange={(event) => {
					dirtyRef.current = true;
					props.onChange(Number(event.target.value));
				}}
				onPointerUp={(event) => commitIfDirty(Number(event.currentTarget.value))}
				onMouseUp={(event) => commitIfDirty(Number(event.currentTarget.value))}
				onBlur={(event) => commitIfDirty(Number(event.currentTarget.value))}
				onKeyUp={handleKeyUp}
			/>
		</label>
	);
}

export function AppearanceModal(props: AppearanceModalProps): React.JSX.Element | null {
	const [category, setCategory] = React.useState<ThemeCategory>(() => getThemeCategory(props.themeId));
	const [activePane, setActivePane] = React.useState<AppearancePane>('theme');

	// Display-size uses a deferred-commit pattern to prevent a database write
	// on every tick of the sliders:
	//   displaySizeDraft  – live values shown in the UI while dragging
	//   displaySizeInitial – values captured when the pane was opened, used both
	//                        to detect changes (enables the Save button) and to
	//                        revert the live preview when the user discards.
	// The props.onChange callbacks are still called on every slider move so the
	// rest of the app shows a live preview; only the Commit callbacks (which
	// trigger a persistence write) are deferred to the explicit Save click.
	const [displaySizeDraft, setDisplaySizeDraft] = React.useState(() => ({
		noteCardFontScale: props.noteCardFontScale,
		noteEditorFontScale: props.noteEditorFontScale,
		noteCardMaxHeightPx: props.noteCardMaxHeightPx,
		noteCardBannerTitlePosition: props.noteCardBannerTitlePosition,
	}));
	const [displaySizeInitial, setDisplaySizeInitial] = React.useState(() => ({
		noteCardFontScale: props.noteCardFontScale,
		noteEditorFontScale: props.noteEditorFontScale,
		noteCardMaxHeightPx: props.noteCardMaxHeightPx,
		noteCardBannerTitlePosition: props.noteCardBannerTitlePosition,
	}));
	const hasDisplaySizeChanges = (
		displaySizeDraft.noteCardFontScale !== displaySizeInitial.noteCardFontScale ||
		displaySizeDraft.noteEditorFontScale !== displaySizeInitial.noteEditorFontScale ||
		displaySizeDraft.noteCardMaxHeightPx !== displaySizeInitial.noteCardMaxHeightPx ||
		displaySizeDraft.noteCardBannerTitlePosition !== displaySizeInitial.noteCardBannerTitlePosition
	);

	React.useEffect(() => {
		if (!props.isOpen) return;
		setCategory(getThemeCategory(props.themeId));
		setActivePane('theme');
	}, [props.isOpen, props.themeId]);

	const themesInCategory = React.useMemo(() => {
		return props.themeOptions.filter((theme) => getThemeCategory(theme.id) === category);
	}, [category, props.themeOptions]);

	const activateDisplaySizePane = () => {
		const initial = {
			noteCardFontScale: props.noteCardFontScale,
			noteEditorFontScale: props.noteEditorFontScale,
			noteCardMaxHeightPx: props.noteCardMaxHeightPx,
			noteCardBannerTitlePosition: props.noteCardBannerTitlePosition,
		};
		setDisplaySizeInitial(initial);
		setDisplaySizeDraft(initial);
		setActivePane('display-size');
	};

	const revertDisplaySizePreview = () => {
		props.onNoteCardFontScaleChange(displaySizeInitial.noteCardFontScale);
		props.onNoteEditorFontScaleChange(displaySizeInitial.noteEditorFontScale);
		props.onNoteCardMaxHeightPxChange(displaySizeInitial.noteCardMaxHeightPx);
		props.onNoteCardBannerTitlePositionChange(displaySizeInitial.noteCardBannerTitlePosition);
	};

	if (!props.isOpen) return null;

	return (
		<div className={styles.subOverlay} role="presentation" onClick={() => { if (hasDisplaySizeChanges) revertDisplaySizePreview(); props.onClose(); }}>
			<section
				className={styles.subModal}
				role="dialog"
				aria-modal="true"
				aria-label={props.t('prefs.appearance')}
				onClick={(e) => e.stopPropagation()}
			>
				<header className={styles.subHeader}>
					<h3 className={styles.subTitle}>{props.t('prefs.appearance')}</h3>
					<button type="button" className={styles.iconButton} onClick={() => { if (hasDisplaySizeChanges) revertDisplaySizePreview(); props.onClose(); }} aria-label={props.t('common.close')}>
						✕
					</button>
				</header>

				<div className={styles.subBody}>
					<div className={styles.appearanceLayout}>
						<nav className={styles.appearanceNav} aria-label={props.t('prefs.appearance')}>
							<button
								type="button"
								className={`${styles.appearanceNavItem}${activePane === 'theme' ? ` ${styles.appearanceNavItemActive}` : ''}`}
								onClick={() => setActivePane('theme')}
								aria-current={activePane === 'theme' ? 'true' : undefined}
							>
								{props.t('prefs.theme')}
							</button>
							<button
								type="button"
								className={`${styles.appearanceNavItem}${activePane === 'language' ? ` ${styles.appearanceNavItemActive}` : ''}`}
								onClick={() => setActivePane('language')}
								aria-current={activePane === 'language' ? 'true' : undefined}
							>
								{props.t('prefs.language')}
							</button>
							<button
								type="button"
								className={`${styles.appearanceNavItem}${activePane === 'display-size' ? ` ${styles.appearanceNavItemActive}` : ''}`}
							onClick={() => activateDisplaySizePane()}
								aria-current={activePane === 'display-size' ? 'true' : undefined}
							>
								{props.t('prefs.displaySize')}
							</button>
						</nav>

						<div className={styles.appearanceContent}>
							{activePane === 'theme' ? (
								<>
									<label className={styles.field}>
										<span>{props.t('prefs.theme')}</span>
										<select value={category} onChange={(e) => setCategory(e.target.value as ThemeCategory)}>
											<option value="built-in">{props.t('prefs.themeCategoryBuiltIn')}</option>
											<option value="earth">{props.t('prefs.themeCategoryEarth')}</option>
											<option value="nord">{props.t('prefs.themeCategoryNord')}</option>
											<option value="catppuccin">{props.t('prefs.themeCategoryCatppuccin')}</option>
											<option value="gruvbox">{props.t('prefs.themeCategoryGruvbox')}</option>
											<option value="everforest">{props.t('prefs.themeCategoryEverforest')}</option>
											<option value="rose-pine">{props.t('prefs.themeCategoryRosePine')}</option>
											<option value="tokyo-night">{props.t('prefs.themeCategoryTokyoNight')}</option>
										</select>
									</label>

									<div className={styles.themeList} role="list" aria-label={props.t('prefs.theme')}>
										{themesInCategory.map((theme) => {
											const isActive = theme.id === props.themeId;
											return (
												<button
													key={theme.id}
													type="button"
													role="listitem"
													className={`${styles.themeListItem}${isActive ? ` ${styles.themeListItemActive}` : ''}`}
													onClick={() => props.onThemeChange(theme.id)}
													aria-current={isActive ? 'true' : undefined}
												>
													{stripThemePrefixForDisplay(theme)}
												</button>
											);
										})}
									</div>
								</>
							) : null}

							{activePane === 'language' ? (
								<label className={styles.field}>
									<span>{props.t('prefs.language')}</span>
									<select value={props.language} onChange={(event) => props.onLanguageChange(event.target.value as LocaleCode)}>
										{props.languageOptions.map((locale) => (
											<option key={locale.code} value={locale.code}>
												{locale.label}
											</option>
										))}
									</select>
								</label>
							) : null}

							{activePane === 'display-size' ? (
								<div className={styles.displaySizeSection}>
									<SliderField
										label={props.t('prefs.noteCardFontScale')}
										valueLabel={formatFontScalePercent(displaySizeDraft.noteCardFontScale)}
										value={clampFontScale(displaySizeDraft.noteCardFontScale)}
										min={FONT_SCALE_MIN}
										max={FONT_SCALE_MAX}
										step={FONT_SCALE_STEP}
										onChange={(v) => {
											setDisplaySizeDraft((d) => ({ ...d, noteCardFontScale: v }));
											props.onNoteCardFontScaleChange(v);
										}}
									/>

									<SliderField
										label={props.t('prefs.noteEditorFontScale')}
										valueLabel={formatFontScalePercent(displaySizeDraft.noteEditorFontScale)}
										value={clampFontScale(displaySizeDraft.noteEditorFontScale)}
										min={FONT_SCALE_MIN}
										max={FONT_SCALE_MAX}
										step={FONT_SCALE_STEP}
										onChange={(v) => {
											setDisplaySizeDraft((d) => ({ ...d, noteEditorFontScale: v }));
											props.onNoteEditorFontScaleChange(v);
										}}
									/>

									<SliderField
										label={props.t('prefs.noteCardMaxHeight')}
										valueLabel={formatHeightPx(displaySizeDraft.noteCardMaxHeightPx)}
										value={displaySizeDraft.noteCardMaxHeightPx}
										min={NOTE_CARD_HEIGHT_MIN}
										max={NOTE_CARD_HEIGHT_MAX}
										step={NOTE_CARD_HEIGHT_STEP}
										onChange={(v) => {
											setDisplaySizeDraft((d) => ({ ...d, noteCardMaxHeightPx: v }));
											props.onNoteCardMaxHeightPxChange(v);
										}}
									/>

									<label className={styles.field}>
										<span>{props.t('prefs.noteCardBannerTitlePosition')}</span>
										<select
											value={displaySizeDraft.noteCardBannerTitlePosition}
											onChange={(event) => {
												const value = event.target.value as NoteCardBannerTitlePosition;
												setDisplaySizeDraft((draft) => ({ ...draft, noteCardBannerTitlePosition: value }));
												props.onNoteCardBannerTitlePositionChange(value);
											}}
										>
											<option value="below">{props.t('prefs.noteCardBannerTitlePositionBelow')}</option>
											<option value="above">{props.t('prefs.noteCardBannerTitlePositionAbove')}</option>
										</select>
									</label>

									<div className={styles.displaySizeSaveRow}>
										<button
											type="button"
											className={styles.displaySizeSaveButton}
											disabled={!hasDisplaySizeChanges}
											onClick={() => {
												props.onNoteCardFontScaleCommit(displaySizeDraft.noteCardFontScale);
												props.onNoteEditorFontScaleCommit(displaySizeDraft.noteEditorFontScale);
												props.onNoteCardMaxHeightPxCommit(displaySizeDraft.noteCardMaxHeightPx);
												props.onNoteCardBannerTitlePositionCommit(displaySizeDraft.noteCardBannerTitlePosition);
												setDisplaySizeInitial({ ...displaySizeDraft });
											}}
										>
											{props.t('common.save')}
										</button>
									</div>
								</div>
							) : null}
						</div>
					</div>
				</div>

				<footer className={styles.subFooter}>
					<button
						type="button"
						className={styles.subBackButton}
						onClick={() => { if (hasDisplaySizeChanges) revertDisplaySizePreview(); props.onBack(); }}
						aria-label={props.t('common.back')}
					>
						← {props.t('common.back')}
					</button>
				</footer>
			</section>
		</div>
	);
}
