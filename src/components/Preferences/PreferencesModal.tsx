import React from 'react';
import type { EditorToolbarMode } from '../../core/deviceAppearancePreferences';
import { fetchAboutHudStats, type AboutHudStatsResponse } from '../../core/noteManagementApi';
import { flushOrphanedNoteLinkPreviews } from '../../core/noteLinkApi';
import { useBubbleMenuEnabled, setBubbleMenuEnabled } from '../../core/useBubbleMenuPreference';
import { NotificationsSection } from './NotificationsSection';
import styles from './PreferencesModal.module.css';
import aboutIconLightAsset from '../../../lighticon.png';
import aboutIconDarkAsset from '../../../darkicon.png';
import versionIconLightAsset from '../../../version-light.png';
import versionIconDarkAsset from '../../../version.png';

type ConnectionState = 'connected' | 'connecting' | 'offline';

type PreferencesSection =
	| 'install'
	| 'about'
	| 'user'
	| 'appearance'
	| 'editor'
	| 'notifications'
	| 'note-management';

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
];

export type PreferencesModalProps = {
	isOpen: boolean;
	onClose: () => void;
	t: (key: string) => string;
	isLightTheme?: boolean;
	quickDeleteChecklist: boolean;
	onQuickDeleteChecklistChange: (next: boolean) => void;
	editorToolbarMode: EditorToolbarMode;
	onEditorToolbarModeChange: (next: EditorToolbarMode) => void;
	noteCardCheckboxInteractions: boolean;
	onNoteCardCheckboxInteractionsChange: (next: boolean) => void;
	noteCardLinkInteractions: boolean;
	onNoteCardLinkInteractionsChange: (next: boolean) => void;
	noteCardCompletedInteractions: boolean;
	onNoteCardCompletedInteractionsChange: (next: boolean) => void;
	deleteAfterDays: number | null;
	onDeleteAfterDaysChange: (next: number | null) => void;
	installAvailable?: boolean;
	installMethod?: 'prompt' | 'ios' | null;
	installBusy?: boolean;
	onInstallApp?: () => void | Promise<void>;
	onOpenUser?: () => void;
	onOpenAppearance?: () => void;
	connectionState?: ConnectionState;
	/** Stable device identifier (from getDeviceId) used by the push settings panel. */
	deviceId?: string;
	// Optional admin/session actions.
	// These are injected by the App so Preferences can stay a mostly-presentational
	// component and not depend directly on auth/admin service logic.
	onUserManagement?: () => void;
	showUserManagement?: boolean;
	userManagementDisabled?: boolean;
	showSendInvite?: boolean;
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
	editorToolbarMode: EditorToolbarMode;
	onEditorToolbarModeChange: (next: EditorToolbarMode) => void;
	noteCardCheckboxInteractions: boolean;
	onNoteCardCheckboxInteractionsChange: (next: boolean) => void;
	noteCardLinkInteractions: boolean;
	onNoteCardLinkInteractionsChange: (next: boolean) => void;
	noteCardCompletedInteractions: boolean;
	onNoteCardCompletedInteractionsChange: (next: boolean) => void;
	deleteAfterDays: number | null;
	onDeleteAfterDaysChange: (next: number | null) => void;
	installAvailable?: boolean;
	installMethod?: 'prompt' | 'ios' | null;
	installBusy?: boolean;
	onInstallApp?: () => void | Promise<void>;
	connectionState: ConnectionState;
	deviceId: string;
};

const ABOUT_ICON_LIGHT = aboutIconLightAsset;
const ABOUT_ICON_DARK = aboutIconDarkAsset;
const ABOUT_WORDMARK = '/icons/freemannotes.png';
const VERSION_ICON_LIGHT = versionIconLightAsset;
const VERSION_ICON_DARK = versionIconDarkAsset;

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
	connectionState: ConnectionState;
}): React.JSX.Element {
	const [hud, setHud] = React.useState<AboutHudStatsResponse | null>(null);
	const [hudLoading, setHudLoading] = React.useState(true);
	const [hudError, setHudError] = React.useState<string | null>(null);
	const [iconLoadFailed, setIconLoadFailed] = React.useState(false);
	const [iconRetryToken, setIconRetryToken] = React.useState(0);
	// Hidden developer tools: unlocked after 10 quick taps on the app icon.
	const [iconTapCount, setIconTapCount] = React.useState(0);
	const [devToolsUnlocked, setDevToolsUnlocked] = React.useState(false);
	const [devToolsRunning, setDevToolsRunning] = React.useState(false);
	const [devToolsResult, setDevToolsResult] = React.useState<string | null>(null);
	const iconTapTimerRef = React.useRef<number>(0);

	const handleIconTap = React.useCallback(() => {
		if (devToolsUnlocked) return;
		// Reset tap count if tapping slowly (> 1 second between taps).
		if (iconTapTimerRef.current) window.clearTimeout(iconTapTimerRef.current);
		iconTapTimerRef.current = window.setTimeout(() => {
			setIconTapCount(0);
		}, 1000);
		setIconTapCount((count) => {
			const next = count + 1;
			if (next >= 10) {
				window.clearTimeout(iconTapTimerRef.current);
				setDevToolsUnlocked(true);
			}
			return next;
		});
	}, [devToolsUnlocked]);

	const handleFlushOrphanedPreviews = React.useCallback(async () => {
		if (devToolsRunning) return;
		setDevToolsRunning(true);
		setDevToolsResult(null);
		try {
			const result = await flushOrphanedNoteLinkPreviews();
			setDevToolsResult(`Done — removed ${result.removed} of ${result.checked} link previews.`);
		} catch (err) {
			setDevToolsResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setDevToolsRunning(false);
		}
	}, [devToolsRunning]);

	const fetchHud = React.useCallback(async () => {
		setHudLoading(true);
		setHudError(null);
		try {
			const response = await fetchAboutHudStats();
			setHud(response);
			setHudLoading(false);
		} catch {
			setHudLoading(false);
			setHudError('Telemetry unavailable');
		}
	}, []);

	React.useEffect(() => {
		if (props.connectionState === 'offline') {
			setHudLoading(false);
			setHudError('Telemetry unavailable');
			return;
		}

		if (props.connectionState === 'connected') {
			void fetchHud();
		}
	}, [fetchHud, props.connectionState]);

	React.useEffect(() => {
		if (props.connectionState !== 'connected') return;
		const timer = window.setInterval(() => {
			void fetchHud();
		}, 30000);
		return () => {
			window.clearInterval(timer);
		};
	}, [fetchHud, props.connectionState]);

	React.useEffect(() => {
		if (props.connectionState !== 'connected') return;
		setIconLoadFailed(false);
		setIconRetryToken((value) => value + 1);
	}, [props.connectionState, props.isLightTheme]);

	const healthValue = React.useMemo(() => {
		if (props.connectionState === 'offline') return 25;
		if (props.connectionState === 'connecting' || hudLoading) return 50;
		if (hud?.status === 'ok') return 100;
		return 50;
	}, [hud, hudLoading, props.connectionState]);

	const hudItems = React.useMemo(() => {
		if (!hud) {
			return [
				{ key: 'db', label: 'DB', value: '--' },
				{ key: 'uploads', label: 'UPLOADS', value: '--' },
				{ key: 'rooms', label: 'ROOMS', value: '--' },
				{ key: 'images', label: 'IMAGES', value: '--' },
				{ key: 'docs', label: 'DOCS', value: '--' },
				{ key: 'workspaces', label: 'WORKSPACES', value: '--' },
			];
		}
		return [
			{ key: 'db', label: 'DB', value: formatBytes(hud.totals.dbStateBytes) },
			{ key: 'uploads', label: 'UPLOADS', value: formatBytes(hud.totals.uploadBytes) },
			{ key: 'rooms', label: 'ROOMS', value: formatCompact(hud.totals.documents) },
			{ key: 'images', label: 'IMAGES', value: formatCompact(hud.totals.noteImagesCount) },
			{ key: 'docs', label: 'DOCS', value: formatCompact(hud.totals.noteDocumentsCount) },
			{ key: 'workspaces', label: 'WORKSPACES', value: formatCompact(hud.totals.workspaces) },
		];
	}, [hud]);

	return (
		<div className={styles.aboutSection}>
			<h4 className={styles.aboutTitle}>{props.t('prefs.aboutTitle')}</h4>
			<div className={styles.aboutHeroGroup}>
				<div
					className={styles.aboutHero}
					aria-label={props.t('prefs.aboutBrandingAria')}
					style={{ cursor: devToolsUnlocked ? 'default' : 'pointer' }}
					onClick={handleIconTap}
				>
					<img
						key={`about-icon-${props.isLightTheme ? 'light' : 'dark'}-${iconRetryToken}`}
						src={iconLoadFailed ? (props.isLightTheme ? ABOUT_ICON_DARK : ABOUT_ICON_LIGHT) : (props.isLightTheme ? ABOUT_ICON_LIGHT : ABOUT_ICON_DARK)}
						alt={props.t('prefs.aboutIconAlt')}
						className={styles.aboutHeroIcon}
						onError={() => {
							setIconLoadFailed(true);
						}}
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
				</div>
			</div>
			<div className={styles.aboutDescription}>
				<p>{props.t('prefs.aboutBodyLine1')}</p>
				<p>{props.t('prefs.aboutBodyLine2')}</p>
				<p>{props.t('prefs.aboutBodyLine3')}</p>
			</div>
			<div className={styles.aboutFooterStats} aria-live="polite">
				<div className={styles.aboutFooterGroup}>
					<div className={styles.aboutFooterCell}>
						<span className={styles.aboutFooterLabel}>HEALTH</span>
						<span className={styles.aboutFooterValue}>{healthValue}</span>
					</div>
					<div className={styles.aboutFooterCell}>
						<span className={styles.aboutFooterLabel}>MEMORY</span>
						<span className={styles.aboutFooterValue}>{hud ? formatBytes(hud.process.rssBytes) : '--'}</span>
					</div>
				</div>
				<div className={`${styles.aboutFooterGroup} ${styles.aboutFooterGroupRight}`}>
					<div className={styles.aboutFooterCell}>
						<span className={styles.aboutFooterLabel}>UPTIME</span>
						<span className={styles.aboutFooterValue}>{hud ? formatUptime(hud.uptimeSeconds) : '--'}</span>
					</div>
					<div className={styles.aboutFooterCell}>
						<span className={styles.aboutFooterLabel}>USERS</span>
						<span className={styles.aboutFooterValue}>{hud ? formatCompact(hud.totals.users) : '--'}</span>
					</div>
				</div>
			</div>
			{devToolsUnlocked ? (
				<div style={{ marginTop: '20px', padding: '12px 14px', border: '1px solid rgba(128,128,128,0.25)', borderRadius: '8px', background: 'rgba(0,0,0,0.03)' }}>
					<p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.5 }}>Developer Tools</p>
					<button
						type="button"
						className={styles.footerButton}
						disabled={devToolsRunning || props.connectionState !== 'connected'}
						onClick={() => { void handleFlushOrphanedPreviews(); }}
					>
						{devToolsRunning ? 'Running…' : 'Clear orphaned URL previews'}
					</button>
					{devToolsResult ? <p style={{ margin: '8px 0 0', fontSize: '13px', opacity: 0.75 }}>{devToolsResult}</p> : null}
				</div>
			) : null}
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
	editorToolbarMode: EditorToolbarMode;
	onEditorToolbarModeChange: (next: EditorToolbarMode) => void;
	noteCardCheckboxInteractions: boolean;
	onNoteCardCheckboxInteractionsChange: (next: boolean) => void;
	noteCardLinkInteractions: boolean;
	onNoteCardLinkInteractionsChange: (next: boolean) => void;
	noteCardCompletedInteractions: boolean;
	onNoteCardCompletedInteractionsChange: (next: boolean) => void;
}): React.JSX.Element {
	const bubbleEnabled = useBubbleMenuEnabled();
	return (
		<div className={styles.editorSection}>
			<label className={styles.toggleRow}>
				<span className={styles.toggleLabel}>
					<span className={styles.toggleTitle}>{props.t('prefs.editorToolbarMode')}</span>
					<span className={styles.toggleDescription}>{props.t('prefs.editorToolbarModeDescription')}</span>
				</span>
				<select
					className={styles.selectControl}
					value={props.editorToolbarMode}
					onChange={(event) => props.onEditorToolbarModeChange(event.target.value as EditorToolbarMode)}
				>
					<option value="full">{props.t('prefs.editorToolbarModeFull')}</option>
					<option value="condensed">{props.t('prefs.editorToolbarModeCondensed')}</option>
				</select>
			</label>
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
			<label className={styles.toggleRow}>
				<span className={styles.toggleLabel}>
					<span className={styles.toggleTitle}>{props.t('prefs.noteCardCheckboxInteractions')}</span>
					<span className={styles.toggleDescription}>{props.t('prefs.noteCardCheckboxInteractionsDescription')}</span>
				</span>
				<input
					type="checkbox"
					checked={props.noteCardCheckboxInteractions}
					onChange={(e) => props.onNoteCardCheckboxInteractionsChange(e.target.checked)}
					className={styles.toggleCheckbox}
				/>
			</label>
			<label className={styles.toggleRow}>
				<span className={styles.toggleLabel}>
					<span className={styles.toggleTitle}>{props.t('prefs.noteCardLinkInteractions')}</span>
					<span className={styles.toggleDescription}>{props.t('prefs.noteCardLinkInteractionsDescription')}</span>
				</span>
				<input
					type="checkbox"
					checked={props.noteCardLinkInteractions}
					onChange={(e) => props.onNoteCardLinkInteractionsChange(e.target.checked)}
					className={styles.toggleCheckbox}
				/>
			</label>
			<label className={styles.toggleRow}>
				<span className={styles.toggleLabel}>
					<span className={styles.toggleTitle}>{props.t('prefs.noteCardCompletedInteractions')}</span>
					<span className={styles.toggleDescription}>{props.t('prefs.noteCardCompletedInteractionsDescription')}</span>
				</span>
				<input
					type="checkbox"
					checked={props.noteCardCompletedInteractions}
					onChange={(e) => props.onNoteCardCompletedInteractionsChange(e.target.checked)}
					className={styles.toggleCheckbox}
				/>
			</label>
			<label className={styles.toggleRow}>
				<span className={styles.toggleLabel}>
					<span className={styles.toggleTitle}>{props.t('prefs.quickDeleteChecklist')}</span>
					<span className={styles.toggleDescription}>{props.t('prefs.quickDeleteChecklistDescription')}</span>
				</span>
				<input
					type="checkbox"
					checked={props.quickDeleteChecklist}
					onChange={(e) => props.onQuickDeleteChecklistChange(e.target.checked)}
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
						editorToolbarMode={props.editorToolbarMode}
						onEditorToolbarModeChange={props.onEditorToolbarModeChange}
						noteCardCheckboxInteractions={props.noteCardCheckboxInteractions}
						onNoteCardCheckboxInteractionsChange={props.onNoteCardCheckboxInteractionsChange}
						noteCardLinkInteractions={props.noteCardLinkInteractions}
						onNoteCardLinkInteractionsChange={props.onNoteCardLinkInteractionsChange}
						noteCardCompletedInteractions={props.noteCardCompletedInteractions}
						onNoteCardCompletedInteractionsChange={props.onNoteCardCompletedInteractionsChange}
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
						connectionState={props.connectionState}
					/>
				) : props.section === 'notifications' ? (
					<NotificationsSection
						t={props.t}
						deviceId={props.deviceId}
						connectionState={props.connectionState}
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
					{props.showUserManagement ? (
						<button
							type="button"
							className={styles.footerButton}
							onClick={props.onUserManagement}
							disabled={props.userManagementDisabled}
						>
							{props.t('prefs.userManagement')}
						</button>
					) : null}
					{props.showSendInvite ? (
						<button type="button" className={styles.footerButton} onClick={props.onSendInvite}>
							{props.t('prefs.sendInvite')}
						</button>
					) : null}
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
					editorToolbarMode={props.editorToolbarMode}
					onEditorToolbarModeChange={props.onEditorToolbarModeChange}
					noteCardCheckboxInteractions={props.noteCardCheckboxInteractions}
					onNoteCardCheckboxInteractionsChange={props.onNoteCardCheckboxInteractionsChange}
					noteCardLinkInteractions={props.noteCardLinkInteractions}
					onNoteCardLinkInteractionsChange={props.onNoteCardLinkInteractionsChange}
					noteCardCompletedInteractions={props.noteCardCompletedInteractions}
					onNoteCardCompletedInteractionsChange={props.onNoteCardCompletedInteractionsChange}
					deleteAfterDays={props.deleteAfterDays}
					onDeleteAfterDaysChange={props.onDeleteAfterDaysChange}
					installAvailable={props.installAvailable}
					installMethod={props.installMethod}
					installBusy={props.installBusy}
					onInstallApp={props.onInstallApp}
					connectionState={props.connectionState ?? 'connecting'}
					deviceId={props.deviceId ?? ''}
				/>
			) : null}
		</div>
	);
}
