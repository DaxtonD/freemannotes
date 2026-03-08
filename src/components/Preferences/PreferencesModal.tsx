import React from 'react';
import styles from './PreferencesModal.module.css';

type PreferencesSection =
	| 'install'
	| 'about'
	| 'appearance'
	| 'notifications'
	| 'note-management'
	| 'drag-animation'
	| 'collaborators';

type SectionConfig = {
	id: PreferencesSection;
	labelKey: string;
};

const sections: readonly SectionConfig[] = [
	{ id: 'install', labelKey: 'prefs.installApp' },
	{ id: 'about', labelKey: 'prefs.about' },
	{ id: 'appearance', labelKey: 'prefs.appearance' },
	{ id: 'notifications', labelKey: 'prefs.notifications' },
	{ id: 'note-management', labelKey: 'prefs.noteManagement' },
	{ id: 'drag-animation', labelKey: 'prefs.dragAnimation' },
	{ id: 'collaborators', labelKey: 'prefs.collaborators' },
];

export type PreferencesModalProps = {
	isOpen: boolean;
	onClose: () => void;
	t: (key: string) => string;
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
};

function SectionModal(props: SectionModalProps): React.JSX.Element {
	const sectionConfig = sections.find((item) => item.id === props.section);
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

				<div className={styles.subPlaceholder}>{props.t('prefs.comingSoon')}</div>
			</section>
		</div>
	);
}

export function PreferencesModal(props: PreferencesModalProps): React.JSX.Element | null {
	const [activeSection, setActiveSection] = React.useState<PreferencesSection | null>(null);

	React.useEffect(() => {
		if (props.isOpen) return;
		setActiveSection(null);
	}, [props.isOpen]);

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
					{sections.map((section) => {
						return (
							<button
								key={section.id}
								type="button"
								className={styles.sectionButton}
								onClick={() => {
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
				/>
			) : null}
		</div>
	);
}
