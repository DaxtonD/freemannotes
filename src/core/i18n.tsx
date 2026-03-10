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
		back: 'Back',
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
		sidebarAll: 'All',
		sidebarToday: 'Today',
		sidebarThisWeek: 'This Week',
		sidebarNextWeek: 'Next Week',
		sidebarNextMonth: 'Next Month',
		sidebarImages: 'Images',
		sidebarReminders: 'Reminders',
		sidebarNoLabels: 'No Labels',
		sidebarLabels: 'Labels',
		sidebarDateCreated: 'Date created',
		sidebarDateUpdated: 'Date updated',
		sidebarAlphabetical: 'Alphabetical',
		sidebarFilters: 'Filters',
		sidebarDueSoon: 'Due soon',
		sidebarLeastAccessed: 'Least Accessed',
		sidebarMostEdited: 'Most Edited',
		sidebarClear: 'Clear',
		sidebarGrouping: 'Grouping',
		sidebarByWeek: 'By week',
		sidebarByMonth: 'By month',
		sidebarSorting: 'Sorting',
		sidebarCollections: 'Collections',
		sidebarManageCollections: 'Manage collections...',
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
		editor: 'Editor',
		bubbleMenu: 'Bubble formatting menu',
		bubbleMenuDescription: 'Show bold, italic, and underline buttons when you select text',
		quickDeleteChecklist: 'Quick delete checklist',
		quickDeleteChecklistDescription: 'Always show the delete button for checklist rows on touch devices',
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
		sidebarTitle: 'Workspace',
		personal: 'Personal',
		sharedWithMe: 'Shared With Me',
		unnamed: 'Personal',
		listAria: 'Workspace list',
		none: 'No workspaces found',
		active: 'active',
		role: 'Role',
		manage: 'Manage workspaces…',
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
		createOfflineUnavailable: 'Workspaces cannot be created while offline',
		delete: 'Delete',
		deleteConfirm: 'Delete this workspace permanently?',
		deleteFailed: 'Failed to delete workspace',
		deleteOfflineUnavailable: 'Workspaces cannot be deleted while offline',
		pendingSync: 'Pending sync',
		deletedTitle: 'Workspace deleted',
		deletedMessage: 'This workspace was deleted. Please choose another workspace.',
		deletedMessageNoFallback: 'This workspace was deleted. There is no other workspace available right now.',
		chooseAnother: 'Choose workspace',
	},
	invite: {
		title: 'Share workspace',
		email: 'Email',
		role: 'Role',
		roleMember: 'Member',
		roleAdmin: 'Admin',
		send: 'Send',
		sent: 'Invite sent',
		sendFailed: 'Failed to send invite',
		noWorkspace: 'No active workspace',
		emailMatchNotice: 'Workspace invite links stay tied to this email address. The recipient must sign in with the same email before the workspace can be joined.',
		generateLink: 'Generate link',
		linkReady: 'Invite link ready',
		linkFailed: 'Failed to create invite link',
		linkLabel: 'Invite link',
		expiresAt: 'Expires',
		offlineCached: 'Showing the last cached invite link while offline',
		copied: 'Invite link copied',
		copyFailed: 'Failed to copy invite link',
		sidebarShareAria: 'Share workspace',
		authPrompt: 'Sign in to accept this workspace invite',
		joinTitle: 'Joining workspace',
		joinDescription: 'This invite will add the signed-in account to the workspace once the token is accepted.',
		accepting: 'Accepting workspace invite…',
		acceptFailed: 'Failed to accept invite',
		accepted: 'Workspace joined',
		acceptOfflineUnavailable: 'Workspace invites can only be accepted while online',
	},
	share: {
		share: 'Share',
		title: 'Share note',
		collaborators: 'Collaborators',
		notifications: 'Share notifications',
		notificationsSubtitle: 'Review note invites and choose where accepted notes should appear.',
		clearNotifications: 'Clear notifications',
		noNotifications: 'No share notifications right now.',
		unknownInviter: 'Unknown inviter',
		wantsToShare: 'would like to share',
		withYou: 'with you.',
		identifierPlaceholder: 'Username or email',
		roleViewer: 'Viewer',
		roleEditor: 'Editor',
		sendInvite: 'Send invite',
		inviteFailed: 'Failed to send collaborator invite',
		revoke: 'Revoke access',
		revokeFailed: 'Failed to revoke collaborator access',
		roleUpdateFailed: 'Failed to update collaborator access',
		removeFailed: 'Failed to remove shared note access',
		collaboratorSyncPending: 'Collaborator changes are syncing with the server.',
		viewOnlyAccess: 'You can use this note, but only members of the original workspace can manage collaborators.',
		pendingInvitations: 'Pending invitations',
		nonePending: 'No pending invitations',
		activeCollaborators: 'Active collaborators',
		noneCollaborators: 'No collaborators yet',
		statusPending: 'Pending',
		statusAccepted: 'Accepted',
		statusDeclined: 'Declined',
		statusRevoked: 'Revoked',
		placeInPersonal: 'Place in Personal workspace',
		placeInSharedWithMe: 'Place in Shared With Me',
		placeInSharedWithMeRoot: 'Shared With Me',
		placeInSharedWithMeFolder: 'A subfolder within Shared With Me',
		folderPlaceholder: 'Optional folder name',
		noSharedFolders: 'No shared folders yet',
		accept: 'Accept',
		acceptFailed: 'Failed to accept note invite',
		decline: 'Decline',
		declineFailed: 'Failed to decline note invite',
		copy: 'Copy',
		open: 'Open',
		refresh: 'Refresh',
		qrAlt: 'QR code for share link',
		createFailed: 'Failed to create share link',
		copied: 'Share link copied',
		copyFailed: 'Failed to copy share link',
		linkLabel: 'Share link',
		expiresAt: 'Expires',
		updatedAt: 'Updated',
		snapshotNotice: 'Shared note links open a public snapshot view. Live collaboration permissions still follow the existing workspace membership rules.',
		offlineCached: 'Showing the last cached share link while offline',
		loadFailed: 'Failed to load shared note',
		publicTitle: 'Shared note',
		backToApp: 'Back to app',
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
