import React from 'react';
import type { LocaleCode } from '../../core/i18n';
import type { ThemeId } from '../../core/theme';
import styles from './PreferencesModal.module.css';

type ThemeCategory = 'built-in' | 'earth' | 'nord' | 'catppuccin' | 'gruvbox' | 'everforest' | 'rose-pine' | 'tokyo-night';
type AppearancePane = 'theme' | 'language';

type ThemeOption = { id: ThemeId; label: string };

type LanguageOption = { code: LocaleCode; label: string };

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
};

export function AppearanceModal(props: AppearanceModalProps): React.JSX.Element | null {
	const [category, setCategory] = React.useState<ThemeCategory>(() => getThemeCategory(props.themeId));
	const [activePane, setActivePane] = React.useState<AppearancePane>('theme');

	React.useEffect(() => {
		if (!props.isOpen) return;
		setCategory(getThemeCategory(props.themeId));
		setActivePane('theme');
	}, [props.isOpen, props.themeId]);

	const themesInCategory = React.useMemo(() => {
		return props.themeOptions.filter((theme) => getThemeCategory(theme.id) === category);
	}, [category, props.themeOptions]);

	if (!props.isOpen) return null;

	return (
		<div className={styles.subOverlay} role="presentation" onClick={props.onClose}>
			<section
				className={styles.subModal}
				role="dialog"
				aria-modal="true"
				aria-label={props.t('prefs.appearance')}
				onClick={(e) => e.stopPropagation()}
			>
				<header className={styles.subHeader}>
					<button type="button" className={styles.iconButtonLeft} onClick={props.onBack} aria-label={props.t('common.back')}>
						←
					</button>
					<h3 className={styles.subTitle}>{props.t('prefs.appearance')}</h3>
					<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label={props.t('common.close')}>
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
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}
