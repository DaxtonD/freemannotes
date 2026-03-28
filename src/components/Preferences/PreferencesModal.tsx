import React from 'react';
import { fetchAboutHudStats, type AboutHudStatsResponse } from '../../core/noteManagementApi';
import { useBubbleMenuEnabled, setBubbleMenuEnabled } from '../../core/useBubbleMenuPreference';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import styles from './PreferencesModal.module.css';

type PreferencesSection =
	| 'install'
	| 'about'
	| 'user'
	| 'appearance'
	| 'editor'
	| 'notifications'
	| 'note-management'
	| 'collaborators';

type SectionConfig = {
	id: PreferencesSection;
	labelKey: string;
};

const sections: readonly SectionConfig[] = [
	{ id: 'install', labelKey: 'prefs.installApp' },
	{ id: 'about', labelKey: 'prefs.about' },
	{ id: 'user', labelKey: 'prefs.user' },
	{ id: 'appearance', labelKey: 'prefs.appearance' },
	{ id: 'editor', labelKey: 'prefs.editor' },
	{ id: 'notifications', labelKey: 'prefs.notifications' },
	{ id: 'note-management', labelKey: 'prefs.noteManagement' },
	{ id: 'collaborators', labelKey: 'prefs.collaborators' },
];

export type PreferencesModalProps = {
	isOpen: boolean;
	onClose: () => void;
	t: (key: string) => string;
	isLightTheme?: boolean;
	quickDeleteChecklist: boolean;
	onQuickDeleteChecklistChange: (next: boolean) => void;
	deleteAfterDays: number | null;
	onDeleteAfterDaysChange: (next: number | null) => void;
	installAvailable?: boolean;
	installMethod?: 'prompt' | 'ios' | null;
	installBusy?: boolean;
	onInstallApp?: () => void | Promise<void>;
	onOpenUser?: () => void;
	onOpenAppearance?: () => void;
	// Optional admin/session actions.
	// These are injected by the App so Preferences can stay a mostly-presentational
	// component and not depend directly on auth/admin service logic.
	onUserManagement?: () => void;
	onSendInvite?: () => void;
	onSignOut?: () => void;
};

type SectionModalProps = {
	section: PreferencesSection;
	onClose: () => void;
	t: (key: string) => string;
	isLightTheme: boolean;
	quickDeleteChecklist: boolean;
	onQuickDeleteChecklistChange: (next: boolean) => void;
	deleteAfterDays: number | null;
	onDeleteAfterDaysChange: (next: number | null) => void;
	installAvailable?: boolean;
	installMethod?: 'prompt' | 'ios' | null;
	installBusy?: boolean;
	onInstallApp?: () => void | Promise<void>;
};

const ABOUT_ICON_LIGHT = '../../../lighticon.png';
const ABOUT_ICON_DARK = '../../../darkicon.png';
const ABOUT_WORDMARK = '/icons/freemannotes.png';
const VERSION_ICON_LIGHT = '/icons/version-light.png';
const VERSION_ICON_DARK = '/icons/version.png';

function formatBytes(bytes: number): string {
	const value = Number(bytes || 0);
	if (!Number.isFinite(value) || value <= 0) return '0 B';
	const units = ['B', 'K', 'M', 'G', 'T'];
	let index = 0;
	let scaled = value;
	while (scaled >= 1024 && index < units.length - 1) {
		scaled /= 1024;
		index += 1;
	}
	if (index === 0) {
		return `${Math.round(scaled)}B`;
	}
	const digits = scaled >= 100 ? 0 : scaled >= 10 ? 0 : 1;
	return `${scaled.toFixed(digits)}${units[index]}`;
}

function formatCompact(value: number): string {
	const numeric = Number(value || 0);
	if (!Number.isFinite(numeric)) return '0';
	return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(numeric);
}

function formatUptime(seconds: number): string {
	const total = Math.max(0, Math.floor(Number(seconds || 0)));
	const days = Math.floor(total / 86400);
	const hours = Math.floor((total % 86400) / 3600);
	if (days > 0) return `${days}d ${hours}h`;
	const minutes = Math.floor((total % 3600) / 60);
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${Math.max(1, minutes)}m`;
}

function AboutSectionContent(props: {
	t: (key: string) => string;
	isLightTheme: boolean;
}): React.JSX.Element {
	const [hud, setHud] = React.useState<AboutHudStatsResponse | null>(null);
	const [hudLoading, setHudLoading] = React.useState(true);
	const [hudError, setHudError] = React.useState<string | null>(null);

	React.useEffect(() => {
		let cancelled = false;
		setHudLoading(true);
		setHudError(null);
		void fetchAboutHudStats()
			.then((response) => {
				if (cancelled) return;
				setHud(response);
				setHudLoading(false);
			})
			.catch(() => {
				if (cancelled) return;
				setHud(null);
				setHudLoading(false);
				setHudError('Telemetry unavailable');
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const healthValue = React.useMemo(() => {
		if (hudLoading) return 50;
		if (hud?.status === 'ok') return 100;
		if (hud) return 50;
		return 25;
	}, [hud, hudLoading]);

	const hudItems = React.useMemo(() => {
		if (!hud) {
			return [
				{ key: 'users', label: 'USERS', value: '--' },
				{ key: 'db', label: 'DB', value: '--' },
				{ key: 'uploads', label: 'UPLOADS', value: '--' },
				{ key: 'rooms', label: 'ROOMS', value: '--' },
				{ key: 'uptime', label: 'UPTIME', value: '--' },
				{ key: 'memory', label: 'MEMORY', value: '--' },
			];
		}
		return [
			{ key: 'users', label: 'USERS', value: formatCompact(hud.totals.users) },
			{ key: 'db', label: 'DB', value: formatBytes(hud.totals.dbStateBytes) },
			{ key: 'uploads', label: 'UPLOADS', value: formatBytes(hud.totals.uploadBytes) },
			{ key: 'rooms', label: 'ROOMS', value: formatCompact(hud.totals.documents) },
			{ key: 'uptime', label: 'UPTIME', value: formatUptime(hud.uptimeSeconds) },
			{ key: 'memory', label: 'MEMORY', value: formatBytes(hud.process.rssBytes) },
		];
	}, [hud, hudLoading]);

	return (
		<div className={styles.aboutSection}>
			<h4 className={styles.aboutTitle}>{props.t('prefs.aboutTitle')}</h4>
			<div className={styles.aboutHeroGroup}>
				<div className={styles.aboutHero} aria-label={props.t('prefs.aboutBrandingAria')}>
					<img
						src={props.isLightTheme ? ABOUT_ICON_LIGHT : ABOUT_ICON_DARK}
						alt={props.t('prefs.aboutIconAlt')}
						className={styles.aboutHeroIcon}
					/>
					<img
						src={ABOUT_WORDMARK}
						alt=""
						role="presentation"
						className={styles.aboutHeroWordmark}
						onError={(event) => {
							event.currentTarget.style.display = 'none';
						}}
					/>
				</div>
				<div className={styles.aboutVersionRow} aria-label={props.t('prefs.aboutVersionAria')}>
					<img
						src={props.isLightTheme ? VERSION_ICON_LIGHT : VERSION_ICON_DARK}
						alt={props.t('prefs.aboutVersionIconAlt')}
						className={styles.aboutVersionIcon}
					/>
					<span className={styles.aboutVersionText}>{__APP_VERSION__}</span>
				</div>
				<div className={styles.aboutHudWrap}>
					<div className={styles.aboutHudGrid} role="status" aria-live="polite">
						{hudItems.map((item) => (
							<div key={item.key} className={styles.aboutHudCell}>
								<span className={styles.aboutHudLabel}>{item.label}</span>
								<span className={styles.aboutHudValue}>{item.value}</span>
							</div>
						))}
					</div>
					{hudError ? <div className={styles.aboutHudMeta}>{hudError}</div> : null}
					{hud && !hudError ? (
						<div className={styles.aboutHudMeta}>
							{`IMAGES ${formatCompact(hud.totals.noteImagesCount)}  DOCS ${formatCompact(hud.totals.noteDocumentsCount)}  WORKSPACES ${formatCompact(hud.totals.workspaces)}`}
						</div>
					) : null}
				</div>
			</div>
			<div className={styles.aboutDescription}>
				<p>{props.t('prefs.aboutBodyLine1')}</p>
				<p>{props.t('prefs.aboutBodyLine2')}</p>
				<p>{props.t('prefs.aboutBodyLine3')}</p>
			</div>
			<div className={styles.aboutHealthCorner} aria-live="polite">
				<span className={styles.aboutHealthLabel}>HEALTH</span>
				<span className={styles.aboutHealthValue}>{healthValue}</span>
			</div>
		</div>
	);
}

function getVisibleSections(installAvailable: boolean): readonly SectionConfig[] {
	return installAvailable ? sections : sections.filter((section) => section.id !== 'install');
}

function EditorSectionContent(props: {
	t: (key: string) => string;
	quickDeleteChecklist: boolean;
	onQuickDeleteChecklistChange: (next: boolean) => void;
	deleteAfterDays: number | null;
	onDeleteAfterDaysChange: (next: number | null) => void;
}): React.JSX.Element {
	const bubbleEnabled = useBubbleMenuEnabled();
	const isCoarsePointer = useIsCoarsePointer();
	return (
		<div className={styles.editorSection}>
			<label className={styles.toggleRow}>
				<span className={styles.toggleLabel}>
					<span className={styles.toggleTitle}>{props.t('prefs.bubbleMenu')}</span>
					<span className={styles.toggleDescription}>{props.t('prefs.bubbleMenuDescription')}</span>
				</span>
				<input
					type="checkbox"
					checked={bubbleEnabled}
					onChange={(e) => setBubbleMenuEnabled(e.target.checked)}
					className={styles.toggleCheckbox}
				/>
			</label>
			<label className={`${styles.toggleRow}${!isCoarsePointer ? ` ${styles.toggleRowDisabled}` : ''}`}>
				<span className={styles.toggleLabel}>
					<span className={styles.toggleTitle}>{props.t('prefs.quickDeleteChecklist')}</span>
					<span className={styles.toggleDescription}>{props.t('prefs.quickDeleteChecklistDescription')}</span>
				</span>
				<input
					type="checkbox"
					checked={props.quickDeleteChecklist}
					onChange={(e) => props.onQuickDeleteChecklistChange(e.target.checked)}
					disabled={!isCoarsePointer}
					className={styles.toggleCheckbox}
				/>
			</label>
		</div>
	);
}

function NoteManagementSectionContent(props: {
	t: (key: string) => string;
	deleteAfterDays: number | null;
	onDeleteAfterDaysChange: (next: number | null) => void;
}): React.JSX.Element {
	const value = props.deleteAfterDays == null ? 'never' : String(props.deleteAfterDays);
	return (
		<div className={styles.editorSection}>
			<label className={styles.toggleRow}>
				<span className={styles.toggleLabel}>
					<span className={styles.toggleTitle}>{props.t('prefs.emptyTrashAfter')}</span>
					<span className={styles.toggleDescription}>{props.t('prefs.emptyTrashAfterDescription')}</span>
				</span>
				<select
					className={styles.selectControl}
					value={value}
					onChange={(event) => {
						const nextValue = event.target.value;
						props.onDeleteAfterDaysChange(nextValue === 'never' ? null : Number(nextValue));
					}}
				>
					<option value="7">{props.t('prefs.emptyTrashAfter7Days')}</option>
					<option value="14">{props.t('prefs.emptyTrashAfter14Days')}</option>
					<option value="30">{props.t('prefs.emptyTrashAfter30Days')}</option>
					<option value="never">{props.t('prefs.emptyTrashAfterNever')}</option>
				</select>
			</label>
		</div>
	);
}

function InstallSectionContent(props: {
	t: (key: string) => string;
	installMethod: 'prompt' | 'ios' | null;
	installBusy: boolean;
	onInstallApp?: () => void | Promise<void>;
}): React.JSX.Element {
	if (props.installMethod === 'ios') {
		return (
			<div className={styles.installSection}>
				<p className={styles.installDescription}>{props.t('prefs.installIosBody')}</p>
				<ol className={styles.installSteps}>
					<li>{props.t('prefs.installIosStep1')}</li>
					<li>{props.t('prefs.installIosStep2')}</li>
				</ol>
			</div>
		);
	}

	return (
		<div className={styles.installSection}>
			<p className={styles.installDescription}>{props.t('prefs.installPromptBody')}</p>
			<button
				type="button"
				className={styles.installAction}
				onClick={() => props.onInstallApp?.()}
				disabled={props.installBusy}
			>
				{props.installBusy ? props.t('common.loading') : props.t('prefs.installNow')}
			</button>
		</div>
	);
}

function SectionModal(props: SectionModalProps): React.JSX.Element {
	const sectionConfig = getVisibleSections(Boolean(props.installAvailable)).find((item) => item.id === props.section);
	const sectionTitle = sectionConfig ? props.t(sectionConfig.labelKey) : props.t('prefs.title');

	return (
		<div className={styles.subOverlay} role="presentation" onClick={props.onClose}>
			<section className={styles.subModal} role="dialog" aria-modal="true" aria-label={sectionTitle} onClick={(e) => e.stopPropagation()}>
				<header className={styles.subHeader}>
					<button type="button" className={styles.iconButtonLeft} onClick={props.onClose} aria-label={props.t('common.back')}>
						←
					</button>
					<h3 className={styles.subTitle}>{sectionTitle}</h3>
					<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label={props.t('common.close')}>
						✕
					</button>
				</header>

				{props.section === 'install' && props.installAvailable ? (
					<InstallSectionContent
						t={props.t}
						installMethod={props.installMethod ?? null}
						installBusy={Boolean(props.installBusy)}
						onInstallApp={props.onInstallApp}
					/>
				) : props.section === 'editor' ? (
					<EditorSectionContent
						t={props.t}
						quickDeleteChecklist={props.quickDeleteChecklist}
						onQuickDeleteChecklistChange={props.onQuickDeleteChecklistChange}
					/>
				) : props.section === 'note-management' ? (
					<NoteManagementSectionContent
						t={props.t}
						deleteAfterDays={props.deleteAfterDays}
						onDeleteAfterDaysChange={props.onDeleteAfterDaysChange}
					/>
				) : props.section === 'about' ? (
					<AboutSectionContent
						t={props.t}
						isLightTheme={props.isLightTheme}
					/>
				) : (
					<div className={styles.subPlaceholder}>{props.t('prefs.comingSoon')}</div>
				)}
			</section>
		</div>
	);
}

export function PreferencesModal(props: PreferencesModalProps): React.JSX.Element | null {
	const [activeSection, setActiveSection] = React.useState<PreferencesSection | null>(null);
	const visibleSections = React.useMemo(() => getVisibleSections(Boolean(props.installAvailable)), [props.installAvailable]);

	React.useEffect(() => {
		if (props.isOpen) return;
		setActiveSection(null);
	}, [props.isOpen]);

	React.useEffect(() => {
		if (props.installAvailable || activeSection !== 'install') return;
		setActiveSection(null);
	}, [activeSection, props.installAvailable]);

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section
				className={styles.modal}
				role="dialog"
				aria-modal="true"
				aria-label={props.t('prefs.title')}
				onClick={(event) => event.stopPropagation()}
			>
				<header className={styles.header}>
					<button type="button" className={styles.iconButtonLeft} onClick={props.onClose} aria-label={props.t('common.back')}>
						←
					</button>
					<h2 className={styles.title}>{props.t('prefs.title')}</h2>
					<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label={props.t('common.close')}>
						✕
					</button>
				</header>

				<div className={styles.sections}>
					{visibleSections.map((section) => {
						return (
							<button
								key={section.id}
								type="button"
								className={styles.sectionButton}
								onClick={() => {
									if (section.id === 'user') {
										props.onOpenUser?.();
										return;
									}
									if (section.id === 'appearance') {
										props.onOpenAppearance?.();
										return;
									}
									setActiveSection(section.id);
								}}
							>
								{props.t(section.labelKey)}
							</button>
						);
					})}
				</div>

				<footer className={styles.footer}>
					<button type="button" className={styles.footerButton} onClick={props.onClose}>
						{props.t('common.close')}
					</button>
					<button type="button" className={styles.footerButton} onClick={props.onUserManagement}>
						{props.t('prefs.userManagement')}
					</button>
					<button type="button" className={styles.footerButton} onClick={props.onSendInvite}>
						{props.t('prefs.sendInvite')}
					</button>
					<button type="button" className={styles.footerButton} onClick={props.onSignOut}>
						{props.t('prefs.signOut')}
					</button>
				</footer>
			</section>

			{activeSection ? (
				<SectionModal
					section={activeSection}
					onClose={() => setActiveSection(null)}
					t={props.t}
					isLightTheme={props.isLightTheme !== false}
					quickDeleteChecklist={props.quickDeleteChecklist}
					onQuickDeleteChecklistChange={props.onQuickDeleteChecklistChange}
					deleteAfterDays={props.deleteAfterDays}
					onDeleteAfterDaysChange={props.onDeleteAfterDaysChange}
					installAvailable={props.installAvailable}
					installMethod={props.installMethod}
					installBusy={props.installBusy}
					onInstallApp={props.onInstallApp}
				/>
			) : null}
		</div>
	);
}
