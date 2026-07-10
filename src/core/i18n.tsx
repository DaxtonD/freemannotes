import React from 'react';

export type LocaleCode = string;

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

const LOCALE_LABELS: Record<string, string> = {
	en: 'English',
	es: 'Espanol',
};

// Bundle locale payloads at build-time so switching languages works fully
// offline (no runtime network fetch required for shipped locale files).
const LOCALE_MESSAGE_MODULES = import.meta.glob('../locales/*.json', {
	eager: true,
	import: 'default',
}) as Record<string, Dictionary>;

function getLocaleCodeFromModulePath(path: string): string | null {
	const normalized = String(path || '').replace(/\\/g, '/');
	const match = normalized.match(/\/locales\/([A-Za-z0-9-]+)\.json$/);
	return match ? match[1].toLowerCase() : null;
}

const BUNDLED_LOCALE_MESSAGES: Record<string, Dictionary> = Object.entries(LOCALE_MESSAGE_MODULES)
	.reduce<Record<string, Dictionary>>((acc, [path, messages]) => {
		const code = getLocaleCodeFromModulePath(path);
		if (!code || !messages || typeof messages !== 'object') return acc;
		acc[code] = messages;
		return acc;
	}, {});

function getLocaleLabel(code: string): string {
	const normalized = String(code || '').toLowerCase();
	if (LOCALE_LABELS[normalized]) return LOCALE_LABELS[normalized];
	const baseLanguage = normalized.split('-')[0] || normalized;
	if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
		try {
			const displayNames = new Intl.DisplayNames([FALLBACK_LOCALE], { type: 'language' });
			const candidate = displayNames.of(baseLanguage);
			if (candidate) return candidate;
		} catch {
			// Ignore Intl localization errors and fall back to the language code.
		}
	}
	return normalized || FALLBACK_LOCALE;
}

const SUPPORTED_LOCALES: readonly LocaleOption[] = (() => {
	const discovered = Array.from(new Set(Object.keys(BUNDLED_LOCALE_MESSAGES).map((code) => code.toLowerCase())));
	if (!discovered.includes(FALLBACK_LOCALE)) discovered.unshift(FALLBACK_LOCALE);
	discovered.sort((a, b) => {
		if (a === FALLBACK_LOCALE) return -1;
		if (b === FALLBACK_LOCALE) return 1;
		return a.localeCompare(b);
	});
	return discovered.map((code) => ({ code, label: getLocaleLabel(code) }));
})();

// Fallback dictionary keeps app labels readable even if a locale file fails to load.
const FALLBACK_MESSAGES: Dictionary = {
	common: {
		back: 'Back',
		previous: 'Previous',
		next: 'Next',
		close: 'Close',
		done: 'Done',
		save: 'Save',
		cancel: 'Cancel',
		loading: 'Loading…',
		refresh: 'Refresh',
		chooseFiles: 'Choose Files',
		noFilesChosen: 'No file chosen',
	},
	app: {
		newTextNote: 'New Text Note',
		newChecklist: 'New Checklist',
		loadingEditor: 'Loading editor…',
		globalSearchPlaceholder: 'Search',
		createNewNote: 'Create a new note',
		createNewChecklist: 'Create a new checklist',
		addNewDrawing: 'Add a new drawing',
		collapseSidebar: 'Collapse sidebar',
		expandSidebar: 'Expand sidebar',
		openQuickCreate: 'Open quick create',
		closeQuickCreate: 'Close quick create',
		createQuickReminder: 'Quick reminder',
		createNote: 'Create note',
		createChecklist: 'Create checklist',
		createDrawing: 'Create drawing',
		createDrawingComingSoon: 'Create drawing coming soon',
		chooseView: 'Choose note view',
		viewCard: 'Card view',
		viewList: 'List view',
		viewDetailedList: 'Detailed list view',
		viewBubble: 'Bubble view',
		viewInbox: 'Inbox',
		withFilterPrefix: 'With',
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
		sidebarPastDue: 'Past due',
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
		sidebarManageLabels: 'Manage labels...',
		sidebarArchive: 'Archive',
		sidebarTrash: 'Trash',
		emptyTrashNow: 'Empty trash now',
		emptyTrashConfirm: 'Delete all trashed notes permanently?',
		emptyTrashAlreadyEmpty: 'Trash is already empty',
		emptyTrashSuccessSingle: 'Trash emptied',
		emptyTrashSuccessPlural: 'notes permanently deleted',
		emptyTrashFailed: 'Failed to empty trash',
		emptyTrashOfflineUnavailable: 'Trash can only be emptied while online',
	},
	prefs: {
		title: 'Preferences',
		installApp: 'Install app',
		about: 'About',
		user: 'User',
		appearance: 'Appearance',
		notifications: 'Notifications',
		notificationsSubtitle: 'Review app updates, invites, and link issues in one place.',
		noNotifications: 'No notifications right now.',
		noteManagement: 'Note management',
		support: 'Support',
		collaborators: 'Collaborators',
		editor: 'Editor',
		userAvatarTitle: 'Profile photo',
		userAvatarDescription: 'Choose a new avatar image, crop it, and save it to update your profile everywhere it appears.',
		chooseProfilePhoto: 'Choose profile photo',
		avatarZoom: 'Zoom',
		avatarUpdated: 'Profile photo updated',
		avatarUploadFailed: 'Profile photo upload failed',
		bubbleMenu: 'Bubble formatting menu',
		bubbleMenuDescription: 'Show bold, italic, and underline buttons when you select text',
		quickDeleteChecklist: 'Quick delete checklist',
		quickDeleteChecklistDescription: 'Always show the delete button for checklist rows on touch devices',
		emptyTrashAfter: 'Empty trash after',
		emptyTrashAfterDescription: 'Choose how long trashed notes are kept before they are permanently deleted',
		emptyTrashAfter7Days: '7 days',
		emptyTrashAfter14Days: '14 days',
		emptyTrashAfter30Days: '30 days',
		emptyTrashAfterNever: 'Never',
		userManagement: 'User management',
		sendInvite: 'Send Invite',
		signOut: 'Sign out',
		aboutTitle: 'About Freeman Notes',
		aboutBrandingAria: 'Freeman Notes branding',
		aboutIconAlt: 'Freeman Notes icon',
		aboutVersionAria: 'Current version',
		aboutVersionIconAlt: 'Version badge',
		aboutBodyLine1: 'I loved Google Keep in a "this is exactly how my brain works" way. Open it, write the thing, done. No friction.',
		aboutBodyLine2: 'I spent years looking for a self-hosted replacement and found nothing. Two-pane markdown editors that make you stare at your own syntax. Note apps so bloated it takes four clicks to make a checklist. Nobody built the thing I actually wanted.',
		aboutBodyLine3: 'So I did.',
		aboutBodyLine4: 'Freeman Notes is offline-first, runs on hardware you control. You never see the markdown, just the result. Collections, collaboration, permissions — there when you need them, invisible when you don\'t.',
		aboutBodyLine5: 'The right man in the wrong app can make all the difference in the world.',
		devToolsSection: 'Developer Tools',
		devToolsClearOrphanedPreviews: 'Clear orphaned URL previews',
		devToolsForceClearNotifications: 'Force clear all notifications',
		devToolsClearInbox: 'Force clear inbox badge (archive all activities)',
		devToolsResetNoteOrder: 'Reset canonical note order',
		devToolsRemeasureCardHeights: 'Remeasure all card heights',
		devToolsEnableSwDebug: 'Enable SW debug logging',
		devToolsDisableSwDebug: 'Disable SW debug logging',
		devToolsCopySwLog: 'Copy SW debug log',
		devToolsClearSwLog: 'Clear SW debug log',
		devToolsRunning: 'Running…',
		updateAvailable: 'A new app version is ready.',
		updateAvailableBadge: 'Update',
		updateNotificationTitle: 'App update available',
		updateNotificationBody: 'A newer version of Freeman Notes has been downloaded. Update now, or close this notice and it will be applied automatically when you are done working.',
		updateNow: 'Refresh to update',
		updateLater: 'Later',
		updatedBadge: 'Updated',
		updatedNotificationTitle: 'Application updated',
		updatedNotificationBody: 'Freeman Notes has been updated successfully and the latest version is now active.',
		comingSoon: 'This section is planned for a future phase.',
		appearanceTitle: 'Appearance Settings',
		displaySize: 'Display',
		theme: 'Theme',
		language: 'Language',
		noteCardFontScale: 'Note card text size',
		noteEditorFontScale: 'Note editor text size',
		noteCardMaxHeight: 'Maximum note card height',
		noteCardBannerTitlePosition: 'Banner title position',
		noteCardBannerTitlePositionAbove: 'Above banner image',
		noteCardBannerTitlePositionBelow: 'Below banner image',
		themeCategoryBuiltIn: 'Built-in',
		themeCategoryEarth: 'Earth',
		themeCategoryNord: 'Nord',
		themeCategoryCatppuccin: 'Catppuccin',
		themeCategoryGruvbox: 'Gruvbox',
		themeCategoryEverforest: 'Everforest',
		themeCategoryRosePine: 'Rose Pine',
		themeCategoryTokyoNight: 'Tokyo Night',
		themeCategoryFreeman: 'Freeman',
	},
	adminInvite: {
		title: 'Send invite',
		description: 'Email a one-time registration invite to a user so they can create an account without reopening public registration.',
		bypassNotice: 'This admin invite bypasses the normal registration toggle for the recipient only. The link is single-use and expires automatically.',
		emailLabel: 'User email',
		emailPlaceholder: 'name@example.com',
		sendAction: 'Send invite',
		sending: 'Sending…',
		sent: 'Invite email sent successfully.',
		linkLabel: 'Fallback invite link',
		copyLink: 'Copy link',
		copied: 'Invite link copied.',
		copyFailed: 'Failed to copy invite link.',
		sendFailed: 'Failed to send invite.',
		authHint: 'This email was invited by an administrator. Complete registration below to activate the account.',
		emailLockedNotice: 'This invite is tied to the email address in the invite link.',
	},
	collections: {
		manageTitle: 'Manage collections',
		manageDescription: 'Create, nest, rename, and remove collections.',
		nameLabel: 'Collection name',
		newPlaceholder: 'New collection',
		parentLabel: 'Parent collection',
		renamePrompt: 'Rename collection',
		renameAction: 'Rename',
		deleteAction: 'Delete',
		deleteConfirmPrefix: 'Delete "{name}"? {count} note(s) in this collection will be unassigned.',
		emptyState: 'No collections yet.',
		createAction: 'Create collection',
	},
	labels: {
		addTitle: 'Add labels',
		addDescription: 'Tag this note with one or more labels.',
		manageTitle: 'Manage labels',
		manageDescription: 'Create, rename, recolor, and remove labels.',
		searchPlaceholder: 'Search labels',
		createPlaceholder: 'Create new label',
		changePlaceholder: 'Change label',
		colorAria: 'New label color',
		editColorAria: 'Label color',
		createAction: 'Create',
		manageAction: 'Edit',
		nameLabel: 'Label name',
		customColorAction: 'Custom',
		deleteAction: 'Delete',
		confirmDeleteAction: 'Confirm delete',
		confirmDeleteWithCount: 'Remove from {count} note(s)?',
		duplicateNameError: 'A label with that name already exists.',
		noMatches: 'No matching labels.',
	},
	reminders: {
		addTitle: 'Add reminder',
		addDescription: 'Schedule a reminder for this note.',
		quickAddTitle: 'Quick reminder',
		quickAddDescription: 'Create a note with a title and reminder time.',
		quickCreateAction: 'Create reminder',
		laterToday: 'Later today',
		tomorrow: 'Tomorrow',
		nextWeek: 'Next week',
		dateLabel: 'Date',
		timeLabel: 'Time',
		clearAction: 'Clear reminder',
		saveAction: 'Save reminder',
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
		addCountItem: 'Add count item',
		makeCountItem: 'Make count item',
		removeCountItem: 'Remove count item',
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
		incrementCountItem: 'Increase count item',
		decrementCountItem: 'Decrease count item',
		copyMode: 'Copy mode',
		copyMarkdown: 'Copy Markdown',
		copyRichText: 'Copy Rich Text',
		copyModeMarkdownToast: 'Selected text will be copied as markdown',
		copyModeRichTextToast: 'Selected text will be copied as rich text',
		copyMarkdownSuccess: 'Markdown copied',
		copyRichTextSuccess: 'Rich text copied',
		copyMarkdownFailed: 'Failed to copy Markdown',
		copyRichTextFailed: 'Failed to copy rich text',
		link: 'Link',
		linkApply: 'Apply',
		linkHeadingsSection: 'Jump to heading',
		urlPreview: 'URL Preview',
		headingMenu: 'Headings',
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
		mediaTabDocuments: 'Drawings',
		bottomDock: 'Bottom dock',
		dockAction: 'Dock action',
	},
	documents: {
		emptyTitle: 'No drawings yet',
		emptyBody: 'Linked drawings will appear here.',
		addButton: 'Drawing',
		addTitle: 'Add drawing',
		attachToNote: 'Attach drawings to this note',
		chooseFiles: 'Choose file(s)',
		supportedTypes: 'Supported: DOC, DOCX, PDF, XLS, XLSX, ODT, ODS, ODP, and RTF.',
		itemSingular: 'drawing',
		itemPlural: 'drawings',
		pageSingular: 'page',
		pagePlural: 'pages',
		retryUploads: 'Retry uploads',
		queuedBadge: 'Queued',
		failedBadge: 'Failed',
		processing: 'Drawing preview ready',
		previewUnavailable: 'Preview text is unavailable for this file.',
		previewModes: 'Document preview modes',
		previewTab: 'Preview',
		textTab: 'Text',
		previewPdfHint: 'View every PDF page directly in the app.',
		previewDocumentHint: 'Preview the generated document card directly in the app.',
		previewTextHint: 'Review extracted text without leaving the note.',
		openOriginal: 'Open original',
		openOriginalHint: 'Open the original file in a new tab if you need the native document layout.',
		delete: 'Delete drawing',
		deleteConfirm: 'Delete this drawing?',
		deleteFailed: 'Delete failed',
		loadFailed: 'Failed to load drawings',
		offlineUnavailable: 'Document uploads are unavailable while offline',
		uploadFailed: 'Upload failed',
		uploadSelected: 'Upload selected documents',
		uploading: 'Uploading…',
		queuedUploadToastSingular: 'document queued for upload',
		queuedUploadToastPlural: 'documents queued for upload',
		uploadToastSingular: 'document uploaded',
		uploadToastPlural: 'documents uploaded',
		pdfLoadFailed: 'Failed to load PDF',
		comingSoonTitle: 'Coming Soon...',
		comingSoonBody: 'Drawing attachments are temporarily disabled.',
	},
	drawings: {
		elementSingular: 'element',
		elementPlural: 'elements',
		canvasBackground: 'Canvas background',
		canvasBackgroundColors: 'Canvas background colors',
		emptyPreview: 'Start drawing to generate a preview.',
	},
	media: {
		summaryEmpty: 'No images attached yet',
		imageSingular: 'image',
		imagePlural: 'images',
		attachedSuffix: 'attached',
		retryUploads: 'Retry uploads',
		pendingUploadSingular: 'pending upload',
		pendingUploadPlural: 'pending uploads',
		pendingDeletionSingular: 'pending deletion',
		pendingDeletionPlural: 'pending deletions',
		synced: 'Synced',
		emptyTitle: 'No media yet',
		emptyBody: 'Uploads appear here immediately, even before they finish syncing or OCR processing.',
		queuedBadge: 'Queued',
		failedBadge: 'Failed',
		ocrBadge: 'OCR',
		ocrReady: 'OCR ready',
		queuedImageLabel: 'Queued image',
		imageLabel: 'Image',
		queuedState: 'Queued',
		deleteConfirm: 'Delete this image?',
		removeQueuedConfirm: 'Remove this queued image?',
		deleteFailed: 'Delete failed',
		addTitle: 'Add image',
		forPrefix: 'For',
		attachToNote: 'Attach media to this note',
		imageUrlLabel: 'Image URL',
		imageUrlPlaceholder: 'https://example.com/image.jpg',
		addFromUrl: 'Add from URL',
		adding: 'Adding…',
		takePhoto: 'Take Photo',
		capturePhoto: 'Capture photo',
		capturingPhoto: 'Capturing…',
		cameraStarting: 'Starting camera…',
		cancelCamera: 'Cancel camera',
		cameraFlash: 'Flash',
		cameraLenses: 'Camera lenses',
		cameraZoom: 'Camera zoom',
		cameraZoomUnavailable: 'Zoom is unavailable on this device',
		cameraFlashUnavailable: 'Flash is unavailable on this device',
		cameraUnavailable: 'Camera access is unavailable on this device',
		cameraPermissionDenied: 'Camera permission was denied. Enable camera access and try again.',
		chooseFiles: 'Choose file(s)',
		filesSelected: 'file(s) selected',
		uploadSelected: 'Upload selected images',
		uploading: 'Uploading…',
		offlineRequiresAuth: 'Offline uploads require a signed-in user',
		urlOfflineUnavailable: 'Image URLs cannot be imported while offline',
		importFailed: 'Image import failed',
		uploadFailed: 'Upload failed',
		queuedUploadToastSingular: 'image queued for upload',
		queuedUploadToastPlural: 'images queued for upload',
		queuedForOcrToast: 'image queued for OCR',
		offlinePreviewBadge: 'Offline preview',
		offlinePreviewHint: 'Offline preview',
		imageUnavailableOffline: 'Image unavailable offline',
		zoomOut: 'Zoom out',
		zoomIn: 'Zoom in',
		resetZoom: 'Reset zoom',
	},
	links: {
		sectionTitle: 'Links',
		emptyTitle: 'No links yet',
		emptyBody: 'Hyperlinks from the note body appear here after they are analyzed.',
		emptyBodyOffline: 'Links are queued while offline and will resolve when you reconnect.',
		loadFailed: 'Failed to load links',
		pendingBadge: 'Queued',
		readyBadge: 'Ready',
		failedBadge: 'Failed',
		linkSingular: 'link',
		linkPlural: 'links',
		addButton: 'URL Preview',
		prompt: 'Enter a URL to preview',
		deletePreview: 'Delete URL preview',
		notificationsSubtitle: 'Review link previews that failed to resolve and reopen the note to fix the URL.',
		notificationMessage: 'has a link preview that needs attention.',
		openNote: 'Open note',
	},
	attachments: {
		chipLabel: 'Attachments',
	},
	search: {
		title: 'Global search',
		offlineUnavailable: 'Search is unavailable while offline',
		failed: 'Search failed',
		noResults: 'No results found across notes and OCR text.',
		resultSingular: 'result',
		resultPlural: 'results',
		matchNote: 'note',
		matchOcr: 'OCR',
		matchCollaborator: 'Collaborator',
		matchLink: 'Link',
		matchDocument: 'Document',
		matchCollection: 'Collection',
		matchLabel: 'Label',
		archivedBadge: 'Archived',
		workspacePrefix: 'Workspace:',
		sharedPrefix: 'Shared:',
		collaboratorPrefix: 'Collaborator:',
		collectionPrefix: 'Collection:',
		labelPrefix: 'Label:',
	},
	noteMenu: {
		pinNote: 'Pin note',
		unpinNote: 'Unpin note',
		selectBannerImage: 'Select banner image',
		addCollaborator: 'Add collaborator',
		addImage: 'Add image',
		addDocument: 'Add Drawing',
		addUrlPreview: 'Add URL Preview',
		addReminder: 'Add reminder',
		moveToWorkspace: 'Move to workspace',
		moveToTrash: 'Move to trash',
		restoreNote: 'Restore note',
		addToCollection: 'Add to collection',
		addLabel: 'Add label',
		cardWidth: 'Card width',
		uncheckAll: 'Uncheck all',
		checkAll: 'Check all',
		narrow: 'Narrow',
		default: 'Default',
		wide: 'Wide',
	},
	noteColors: {
		dialogTitle: 'Note color',
		none: 'Default',
		yellow: 'Yellow',
		amber: 'Amber',
		orange: 'Orange',
		coral: 'Coral',
		red: 'Red',
		rose: 'Rose',
		pink: 'Pink',
		magenta: 'Magenta',
		purple: 'Purple',
		violet: 'Violet',
		indigo: 'Indigo',
		blue: 'Blue',
		sky: 'Sky',
		cyan: 'Cyan',
		teal: 'Teal',
		mint: 'Mint',
		green: 'Green',
		lime: 'Lime',
		olive: 'Olive',
		brown: 'Brown',
		copper: 'Copper',
		slate: 'Slate',
		gray: 'Gray',
		graphite: 'Graphite',
		sand: 'Sand',
		peach: 'Peach',
		cream: 'Cream',
		lavender: 'Lavender'
	},
	noteBanners: {
		dialogTitle: 'Note banner',
		none: 'No banner',
		loading: 'Loading banner images…',
		failed: 'Failed to load banner images',
		empty: 'No banner images are available.',
		images: {
			calendar: 'Calendar',
			checklist: 'Checklist',
			coding: 'Coding',
			finance: 'Finance',
			gaming: 'Gaming',
			grocery: 'Grocery',
			health: 'Health',
			household: 'Household',
			ideas: 'Ideas',
			important: 'Important',
			industrial: 'Industrial',
			journal: 'Journal',
			maintenance: 'Maintenance',
			media: 'Media',
			reading: 'Reading',
			recipes: 'Recipes',
			reminder: 'Reminder',
			school: 'School',
			travel: 'Travel',
			work: 'Work',
		},
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
		duplicateName: 'A workspace with that name already exists',
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
		moveNoteTitle: 'Move to workspace',
		moveNoteDescription: 'Choose a workspace for this note.',
		moveNoteAction: 'Move',
		moveNoteEmpty: 'No other editable workspace is available.',
		moveNoteFailed: 'Failed to move note',
		moveNoteWarningTitle: 'Workspace-specific metadata will be removed',
		moveNoteWarningDescription: 'Collections and labels belong to the current workspace. Moving this note will clear those assignments in the destination workspace.',
		moveNoteWarningCollection: 'The current collection assignment will be removed.',
		moveNoteWarningCollectionNamed: 'The collection assignment "{name}" will be removed.',
		moveNoteWarningLabelsCount: '{count} label assignments will be removed.',
		moveNoteWarningLabelsNamed: 'These label assignments will be removed: {names}.',
		moveNoteQueued: 'Note move queued',
		moveNoteSuccess: 'Note moved',
		moveNoteOfflineUnavailable: 'Notes can only be moved while online',
		deleteOfflineUnavailable: 'Workspaces cannot be deleted while offline',
		pendingSync: 'Pending sync',
		deletedTitle: 'Workspace deleted',
		deletedMessage: 'This workspace was deleted. Please choose another workspace.',
		deletedMessageNoFallback: 'This workspace was deleted. There is no other workspace available right now.',
		chooseAnother: 'Choose workspace',
		ownedBy: 'Owned by',
		ownedByUnknown: 'Unknown owner',
	},
	invite: {
		title: 'Share workspace',
		notifications: 'Workspace invitations',
		notificationsSubtitle: 'Review pending workspace invitations and join the workspaces you want to access.',
		notificationsSubtitleMixed: 'Review pending workspace and note invitations.',
		noNotifications: 'No invitations right now.',
		identifier: 'Username or email',
		email: 'Email',
		role: 'Role',
		roleOwner: 'Owner',
		roleMember: 'Member',
		roleViewer: 'Viewer',
		roleEditor: 'Editor',
		roleAdmin: 'Admin',
		send: 'Send',
		sent: 'Invite sent',
		sentInApp: 'Invite delivered in app',
		sendFailed: 'Failed to send invite',
		noWorkspace: 'No active workspace',
		emailMatchNotice: 'Workspace invite links stay tied to this email address. The recipient must sign in with the same email before the workspace can be joined.',
		identifierNotice: 'Enter a username or email. Existing accounts receive the invite in app, and email delivery uses the matched account email.',
		emailSectionTitle: 'Direct invite',
		generateLink: 'Generate link',
		linkReady: 'Invite link ready',
		linkFailed: 'Failed to create invite link',
		linkLabel: 'Invite link',
		expiresAt: 'Expires',
		offlineCached: 'Showing the last cached invite link while offline',
		pendingQueued: 'Invite queued and will send when you are back online',
		copied: 'Invite link copied',
		copyFailed: 'Failed to copy invite link',
		membersTitle: 'Workspace members',
		pendingTitle: 'Pending invites',
		qrSectionTitle: 'QR code invite',
		noneMembers: 'No workspace members found',
		noneInvites: 'No invites yet',
		cancelInvite: 'Cancel invite',
		cancelInviteFailed: 'Failed to cancel invite',
		removeMember: 'Remove member',
		removeMemberConfirm: 'Remove this member from the workspace?',
		removeMemberFailed: 'Failed to remove workspace member',
		updateRoleFailed: 'Failed to update workspace member role',
		manageOfflineUnavailable: 'Workspace member and invite management requires an online connection',
		stateMember: 'Member',
		statePending: 'Pending Invite',
		statePendingOffline: 'Pending (waiting for connection)',
		statePendingSyncing: 'Pending (syncing now)',
		stateFailed: 'Invite Failed',
		duplicateMember: 'This user already belongs to the workspace',
		duplicateInvite: 'This user already has a pending invite',
		collaboratorSuggestionsLoading: 'Loading collaborators…',
		collaboratorSuggestionsEmpty: 'No prior collaborators match this search',
		sidebarShareAria: 'Share workspace',
		authPrompt: 'Sign in to accept this workspace invite',
		joinTitle: 'Joining workspace',
		joinDescription: 'This invite will add the signed-in account to the workspace once the token is accepted.',
		joinWorkspaceLabel: 'Join workspace',
		invitedYouToJoin: 'invited you to join',
		accepting: 'Accepting workspace invite…',
		acceptFailed: 'Failed to accept invite',
		accepted: 'Workspace joined',
		acceptOfflineUnavailable: 'Workspace invites can only be accepted while online',
	},
	support: {
		blurb: 'Freeman Notes is free and open source. If it saves you time or brings you joy, a coffee goes a long way.',
		buyMeACoffee: 'Buy Me a Coffee',
		paypal: 'PayPal',
		thankYou: "You're a supporter — thank you!",
		showOnContributors: 'Show my name on the contributors page',
		contributorsTitle: 'Contributors',
		contributorsEmpty: 'Be the first to support Freeman Notes!',
	},
	share: {
		share: 'Share',
		title: 'Share note',
		collaborators: 'Collaborators',
		notifications: 'Notifications',
		notificationsSubtitle: 'Review your notifications in one place.',
		notificationsDisabledOffline: 'Notifications disabled offline',
		clearNotifications: 'Clear notifications',
		noNotifications: 'No notifications right now.',
		inboxUnreadOne: '1 unread mention or assignment',
		inboxUnreadMany: '{count} unread mentions & assignments',
		inboxUnreadSubtitle: 'Mentions and assignments are in your Inbox.',
		openInbox: 'Open Inbox',
		joinNoteLabel: 'Join note',
		fromLabel: 'From',
		sharedAt: 'Shared',
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
		viewOnlyAccess: 'You can use this note, but only members of the original workspace can manage collaborators.',
		duplicateCollaborator: 'This collaborator already has access or a pending invite.',
		collaboratorSuggestionsLoading: 'Loading collaborators…',
		collaboratorSuggestionsEmpty: 'No prior collaborators match this search',
		pendingInvitations: 'Pending invitations',
		nonePending: 'No pending invitations',
		activeCollaborators: 'Active collaborators',
		noneCollaborators: 'No collaborators yet',
		inheritedWorkspaceAccess: 'Inherited from workspace access',
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
		generateLink: 'Generate link',
		linkReady: 'Share link ready',
		linkQueued: 'Share link queued and will be generated when you are back online',
		linkSectionTitle: 'QR code invite',
		activeLinks: 'Active share links',
		generateNew: 'Generate new link',
		requiredRole: 'Required role',
		selectRole: 'Select a role',
		roleRequired: 'Choose a role before generating a share link',
		expiration: 'Expiration',
		expiration1Day: '1 day',
		expiration7Days: '7 days',
		expiration30Days: '30 days',
		qrAlt: 'QR code for share link',
		viewQrCode: 'View QR code',
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
	importExport: {
		prefsTitle: 'Import / Export',
		importSectionTitle: 'Import notes',
		importDescription: 'Bring notes in from another app. Supported: Obsidian vaults, Google Keep, Notion, Joplin, OneNote, and generic Markdown files or ZIPs.',
		chooseFiles: 'Choose files or ZIP',
		orDragDrop: 'or drag & drop here',
		detectingPlatform: 'Detecting platform…',
		parsingNotes: 'Reading notes…',
		detectedPlatform: 'Detected: {platform}',
		detectedGeneric: 'Generic Markdown / ZIP',
		verifyTitle: 'Review import',
		verifyDescription: 'Review the notes that will be imported. You can rename workspaces before proceeding.',
		workspaceLabel: 'Workspace',
		noteCountSingular: '{count} note',
		noteCountPlural: '{count} notes',
		conflictRename: 'Rename',
		conflictMerge: 'Merge into existing',
		conflictWorkspaceExists: 'A workspace named "{name}" already exists.',
		newWorkspaceBadge: 'New',
		collapseAll: 'Collapse all',
		expandAll: 'Expand all',
		importAction: 'Import {count} notes',
		importingProgress: 'Importing…',
		importSuccessSingular: '{count} note imported',
		importSuccessPlural: '{count} notes imported',
		importFailed: 'Import failed',
		importPartialSuccess: '{success} of {total} notes imported',
		exportNote: 'Export note',
		exportWorkspace: 'Export workspace',
		exportingNote: 'Exporting…',
		exportingWorkspace: 'Preparing export…',
		exportFailed: 'Export failed',
		noNotesToImport: 'No notes were found in the selected files.',
		unsupportedFile: 'Unsupported file format',
		offlineUnavailable: 'Import is unavailable while offline',
		statNote: 'note',
		statNotes: 'notes',
		statImage: 'image',
		statImages: 'images',
		statLabel: 'label',
		statLabels: 'labels',
		estimatedTime: 'Estimated time: {time}',
		keepImagesNote: 'Images attached to Google Keep notes are not yet imported (planned for a future update).',
		importNotificationTitle: 'Import complete',
		importCompleteBadge: 'Done',
		importSyncing: 'Syncing your notes…',
		importSyncProgress: '{synced} of {total} notes synced',
	},
	inbox: {
		title: 'Inbox',
		tabAll: 'All',
		tabMentions: 'Mentions',
		tabAssigned: 'Assigned to me',
		markAllRead: 'Mark all read',
		clearAll: 'Clear all',
		emptyTitle: 'Sector clear.',
		emptySubtext: 'No incoming transmissions. Mentions and assignments will appear here.',
		acceptAndView: 'Accept & View',
		placementLabel: 'Where should this note appear?',
		placementSharedRoot: 'Shared With Me',
		placementSharedFolder: 'A subfolder within Shared With Me',
		folderNamePlaceholder: 'Folder name (optional)',
		placementPersonal: 'Personal workspace',
		opening: 'Opening…',
		confirmAndOpen: 'Confirm & Open',
		archive: 'Archive',
		loadMore: 'Load more',
		unread: 'Unread',
		fallbackActor: 'Someone',
		inNote: 'in a note',
		inNoteTitle: 'in "{title}"',
		mentionSelf: 'You mentioned yourself {inNote}',
		mentionOther: '{actorName} mentioned you {inNote}',
		assignSelf: 'You assigned yourself a task {inNote}',
		assignOther: '{actorName} assigned you a task {inNote}',
		sharedNote: '{actorName} shared a note with you',
		shareAccepted: '{actorName} accepted your note share',
		unknownActivity: '{actorName} sent you an activity',
		justNow: 'Just now',
		minsAgo: '{mins}m ago',
		hoursAgo: '{hrs}h ago',
		yesterday: 'Yesterday',
		daysAgo: '{days}d ago',
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
	const normalized = String(raw || '').trim().toLowerCase().replace(/_/g, '-');
	if (!normalized) return FALLBACK_LOCALE;
	if (SUPPORTED_LOCALES.some((entry) => entry.code === normalized)) return normalized;
	const base = normalized.split('-')[0] || normalized;
	if (SUPPORTED_LOCALES.some((entry) => entry.code === base)) return base;
	return FALLBACK_LOCALE;
}

function getInitialLocale(): LocaleCode {
	if (typeof window === 'undefined') return FALLBACK_LOCALE;
	const stored = normalizeLocale(window.localStorage.getItem(STORAGE_KEY));
	if (stored !== FALLBACK_LOCALE) return stored;

	const browser = normalizeLocale(window.navigator.language || FALLBACK_LOCALE);
	return browser;
}

async function loadLocaleMessages(locale: LocaleCode): Promise<Dictionary> {
	const normalized = normalizeLocale(locale);
	const bundled = BUNDLED_LOCALE_MESSAGES[normalized];
	if (bundled && typeof bundled === 'object') return bundled;
	const response = await fetch(`/locales/${normalized}.json`);
	if (!response.ok) {
		throw new Error(`Failed to load locale ${normalized}`);
	}
	return (await response.json()) as Dictionary;
}

export function I18nProvider(props: { children: React.ReactNode }): React.JSX.Element {
	const [locale, setLocaleState] = React.useState<LocaleCode>(() => getInitialLocale());
	const [messages, setMessages] = React.useState<Dictionary>(FALLBACK_MESSAGES);
	const [isLoadingLocale, setIsLoadingLocale] = React.useState(false);

	React.useEffect(() => {
		let cancelled = false;
		const bundled = BUNDLED_LOCALE_MESSAGES[normalizeLocale(locale)];
		if (bundled && typeof bundled === 'object') {
			setMessages(bundled);
			setIsLoadingLocale(false);
		} else {
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
		}

		if (typeof document !== 'undefined') {
			document.documentElement.lang = locale;
		}
		if (typeof window !== 'undefined') {
			try {
				window.localStorage.setItem(STORAGE_KEY, locale);
			} catch {
				// Ignore storage write failures in restricted browser contexts.
			}
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
