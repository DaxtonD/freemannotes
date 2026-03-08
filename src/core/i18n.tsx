import React from 'react';

export type LocaleCode = 'en' | 'es';

type Dictionary = Record<string, unknown>;

type LocaleOption = {
	code: LocaleCode;
	label: string;
};

type I18nContextValue = {
	locale: LocaleCode;
	locales: readonly LocaleOption[];
	isLoadingLocale: boolean;
	setLocale: (code: LocaleCode) => void;
	t: (key: string) => string;
};

const STORAGE_KEY = 'freemannotes.locale';
const FALLBACK_LOCALE: LocaleCode = 'en';

const SUPPORTED_LOCALES: readonly LocaleOption[] = [
	{ code: 'en', label: 'English' },
	{ code: 'es', label: 'Español' },
];

// Fallback dictionary keeps app labels readable even if a locale file fails to load.
const FALLBACK_MESSAGES: Dictionary = {
	common: {
		close: 'Close',
		save: 'Save',
		cancel: 'Cancel',
		loading: 'Loading…',
	},
	app: {
		newTextNote: 'New Text Note',
		newChecklist: 'New Checklist',
		loadingEditor: 'Loading editor…',
		globalSearchPlaceholder: 'Search',
		createNewNote: 'Create a new note',
		createNewChecklist: 'Create a new checklist',
		collapseSidebar: 'Collapse sidebar',
		expandSidebar: 'Expand sidebar',
		openQuickCreate: 'Open quick create',
		closeQuickCreate: 'Close quick create',
		createNote: 'Create note',
		createChecklist: 'Create checklist',
		sidebarNotes: 'Notes',
		sidebarImages: 'Images',
		sidebarReminders: 'Reminders',
		sidebarLabels: 'Labels',
		sidebarSorting: 'Sorting',
		sidebarCollections: 'Collections',
		sidebarArchive: 'Archive',
		sidebarTrash: 'Trash',
	},
	prefs: {
		title: 'Preferences',
		installApp: 'Install app',
		about: 'About',
		appearance: 'Appearance',
		notifications: 'Notifications',
		noteManagement: 'Note management',
		dragAnimation: 'Drag & Animation',
		collaborators: 'Collaborators',
		userManagement: 'User management',
		sendInvite: 'Send Invite',
		signOut: 'Sign out',
		comingSoon: 'This section is planned for a future phase.',
		appearanceTitle: 'Appearance Settings',
		theme: 'Theme',
		language: 'Language',
	},
	editors: {
		// Fallback branch for newly introduced editor dock/formatting labels.
		// These keys ensure old or failed locale payloads still render readable UI
		// instead of showing raw i18n keys during startup or offline conditions.
		newText: 'New Text Note',
		newChecklist: 'New Checklist Note',
		titlePlaceholder: 'Title',
		bodyPlaceholder: 'Body',
		checklistItemPlaceholder: 'Checklist item',
		addItem: 'Add Item',
		remove: 'Remove',
		saving: 'Saving…',
		editing: 'Editing',
		delete: 'Delete',
		deleting: 'Deleting…',
		title: 'Title',
		content: 'Content',
		untitled: 'Untitled',
		startTyping: 'Start typing…',
		checklist: 'Checklist',
		add: 'Add',
		dragHandle: 'Drag row',
		checklistHint: 'Press Enter to add a row. Press Backspace on an empty row to remove it.',
		completedItems: 'completed items',
		formatting: 'Formatting',
		bold: 'Bold',
		italic: 'Italic',
		underline: 'Underline',
		link: 'Link',
		heading1: 'Heading 1',
		heading2: 'Heading 2',
		heading3: 'Heading 3',
		bulletedList: 'Bulleted list',
		numberedList: 'Numbered list',
		alignLeft: 'Align left',
		alignCenter: 'Align center',
		alignRight: 'Align right',
		mediaDock: 'Media dock',
		mediaDockTabs: 'Media dock tabs',
		mediaTabMedia: 'Media',
		mediaTabLinks: 'Links',
		bottomDock: 'Bottom dock',
		dockAction: 'Dock action',
	},
	noteMenu: {
		pinNote: 'Pin note',
		addCollaborator: 'Add collaborator',
		addImage: 'Add image',
		addReminder: 'Add reminder',
		moveToTrash: 'Move to trash',
		addToCollection: 'Add to collection',
		addLabel: 'Add label',
		cardWidth: 'Card width',
		uncheckAll: 'Uncheck all',
		checkAll: 'Check all',
		narrow: 'Narrow',
		default: 'Default',
		wide: 'Wide',
	},
	note: {
		untitled: '(untitled)',
		pendingSync: 'Pending sync',
	},
	grid: {
		notes: 'Notes',
		notesGrid: 'Notes Grid',
	},
	workspace: {
		title: 'Workspaces',
		unnamed: 'Personal',
		listAria: 'Workspace list',
		none: 'No workspaces found',
		active: 'active',
		role: 'Role',
		activate: 'Activate',
		rename: 'Rename',
		renamePlaceholder: 'Workspace name',
		saveName: 'Save',
		renameInvalid: 'Workspace name is required',
		renameFailed: 'Failed to rename workspace',
		namePlaceholder: 'New workspace name',
		create: 'Create',
		loadFailed: 'Failed to load workspaces',
		activateFailed: 'Failed to activate workspace',
		createFailed: 'Failed to create workspace',
	},
	invite: {
		title: 'Send Invite',
		email: 'Email',
		role: 'Role',
		roleMember: 'Member',
		roleAdmin: 'Admin',
		send: 'Send',
		sent: 'Invite sent',
		sendFailed: 'Failed to send invite',
		noWorkspace: 'No active workspace',
	},
	share: {
		share: 'Share',
		title: 'Share note',
		copy: 'Copy',
		open: 'Open',
		refresh: 'Refresh',
		qrAlt: 'QR code for share link',
		createFailed: 'Failed to create share link',
	},
	theme: {
		light: 'Light',
		dark: 'Dark',
		nord: 'Nord',
		nordPolarNight1: 'Nord Polar Night 1',
		nordPolarNight2: 'Nord Polar Night 2',
		nordPolarNight3: 'Nord Polar Night 3',
		nordPolarNight4: 'Nord Polar Night 4',
		nordSnowStorm1: 'Nord Snow Storm 1',
		nordSnowStorm2: 'Nord Snow Storm 2',
		nordSnowStorm3: 'Nord Snow Storm 3',
		nordFrost1: 'Nord Frost 1',
		nordFrost2: 'Nord Frost 2',
		nordFrost3: 'Nord Frost 3',
		nordFrost4: 'Nord Frost 4',
		nordAuroraRed: 'Nord Aurora Red',
		nordAuroraOrange: 'Nord Aurora Orange',
		nordAuroraYellow: 'Nord Aurora Yellow',
		nordAuroraGreen: 'Nord Aurora Green',
		nordAuroraPurple: 'Nord Aurora Purple',
	},
};

const I18nContext = React.createContext<I18nContextValue | null>(null);

function getNestedValue(dict: Dictionary, key: string): string | null {
	const segments = key.split('.');
	let cursor: unknown = dict;
	for (const segment of segments) {
		if (!cursor || typeof cursor !== 'object') return null;
		cursor = (cursor as Dictionary)[segment];
	}
	return typeof cursor === 'string' ? cursor : null;
}

function normalizeLocale(raw: string | null): LocaleCode {
	if (!raw) return FALLBACK_LOCALE;
	return SUPPORTED_LOCALES.some((entry) => entry.code === raw) ? (raw as LocaleCode) : FALLBACK_LOCALE;
}

function getInitialLocale(): LocaleCode {
	if (typeof window === 'undefined') return FALLBACK_LOCALE;
	const stored = normalizeLocale(window.localStorage.getItem(STORAGE_KEY));
	if (stored !== FALLBACK_LOCALE) return stored;

	const browser = normalizeLocale(window.navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en');
	return browser;
}

async function loadLocaleMessages(locale: LocaleCode): Promise<Dictionary> {
	const response = await fetch(`/locales/${locale}.json`, { cache: 'no-store' });
	if (!response.ok) {
		throw new Error(`Failed to load locale ${locale}`);
	}
	return (await response.json()) as Dictionary;
}

export function I18nProvider(props: { children: React.ReactNode }): React.JSX.Element {
	const [locale, setLocaleState] = React.useState<LocaleCode>(() => getInitialLocale());
	const [messages, setMessages] = React.useState<Dictionary>(FALLBACK_MESSAGES);
	const [isLoadingLocale, setIsLoadingLocale] = React.useState(false);

	React.useEffect(() => {
		let cancelled = false;
		setIsLoadingLocale(true);
		loadLocaleMessages(locale)
			.then((next) => {
				if (cancelled) return;
				setMessages(next);
			})
			.catch((error) => {
				console.warn('[i18n] Falling back to embedded messages:', error);
				if (!cancelled) setMessages(FALLBACK_MESSAGES);
			})
			.finally(() => {
				if (!cancelled) setIsLoadingLocale(false);
			});

		if (typeof document !== 'undefined') {
			document.documentElement.lang = locale;
		}
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(STORAGE_KEY, locale);
		}
		return () => {
			cancelled = true;
		};
	}, [locale]);

	const setLocale = React.useCallback((code: LocaleCode) => {
		setLocaleState(normalizeLocale(code));
	}, []);

	const t = React.useCallback(
		(key: string): string => {
			return getNestedValue(messages, key) ?? getNestedValue(FALLBACK_MESSAGES, key) ?? key;
		},
		[messages]
	);

	const contextValue = React.useMemo<I18nContextValue>(() => {
		return {
			locale,
			locales: SUPPORTED_LOCALES,
			isLoadingLocale,
			setLocale,
			t,
		};
	}, [locale, isLoadingLocale, setLocale, t]);

	return <I18nContext.Provider value={contextValue}>{props.children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
	const context = React.useContext(I18nContext);
	if (!context) {
		throw new Error('useI18n must be used inside I18nProvider');
	}
	return context;
}
