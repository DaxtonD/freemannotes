import React from 'react';
import type * as Y from 'yjs';
import Cropper from 'react-easy-crop';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faArrowDownWideShort,
	faBars,
	faBell,
	faBoxArchive,
	faFileLines,
	faFolder,
	faGrip,
	faImage,
	faMagnifyingGlass,
	faShareNodes,
	faTag,
	faTrash,
	faXmark,
} from '@fortawesome/free-solid-svg-icons';
import fabIconDark from '../version.png';
import fabIconLight from '../version-light.png';
import appIconDark from '../darkicon.png';
import appIconLight from '../lighticon.png';
import { ChecklistEditor } from './components/Editors/ChecklistEditor';
import { NoteEditor } from './components/Editors/NoteEditor';
import { UserManagementModal } from './components/Admin/UserManagementModal';
import { PreferencesModal } from './components/Preferences/PreferencesModal';
import { AppearanceModal } from './components/Preferences/AppearanceModal';
import { SendInviteModal } from './components/Invites/SendInviteModal';
import { CollaboratorModal } from './components/Share/CollaboratorModal';
import { ShareNotificationsModal } from './components/Share/ShareNotificationsModal';
import { NoteDocumentBrowserModal } from './components/NoteAttachments/NoteDocumentBrowserModal';
import { NoteLinkBrowserModal } from './components/NoteAttachments/NoteLinkBrowserModal';
import { NoteImageUploadModal } from './components/NoteMedia/NoteImageUploadModal';
import { NoteMediaBrowserModal } from './components/NoteMedia/NoteMediaBrowserModal';
import { NoteDocumentUploadModal } from './components/NoteDocuments/NoteDocumentUploadModal';
import { WorkspaceSwitcherModal } from './components/Workspaces/WorkspaceSwitcherModal';
import { TextEditor } from './components/Editors/TextEditor';
import { NoteGrid, type NoteGridCollaboratorFilter } from './components/NoteGrid/NoteGrid';
import type { NoteAttachmentBrowserKind } from './components/NoteAttachments/NoteAttachmentCountChip';
import { type ChecklistItem } from './core/bindings';
import { getDeviceId } from './core/deviceId';
import { useDocumentManager } from './core/DocumentManagerContext';
import { type LocaleCode, useI18n } from './core/i18n';
import { initChecklistNoteDoc, initTextNoteDoc, makeNoteId } from './core/noteModel';
import { seedNoteCardCompletedExpandedByNoteId } from './core/noteCardCompletedExpansion';
import { applyTheme, getStoredThemeId, isLightTheme, persistThemeId, THEMES, type ThemeId } from './core/theme';
import { activateWorkspace, fetchUserPreferences, updateUserPreferences } from './core/userDevicePreferencesApi';
import { useConnectionStatus } from './core/useConnectionStatus';
import { useIsCoarsePointer } from './core/useIsCoarsePointer';
import { useIsMobileLandscape } from './core/useIsMobileLandscape';
import { getPasswordStrengthLabel, getPasswordStrengthScore } from './core/passwordStrength';
import {
	flushPendingCollaboratorActions,
	flushPendingNoteShareActions,
	listNoteShareInvitations,
	listSharedNotePlacements,
	syncNoteShareCollaborators,
	type SharedNotePlacement,
} from './core/noteShareApi';
import { addNotePreviewLinkToDoc, removeNotePreviewLinkFromDoc } from './core/noteLinks';
import { acceptShareToken, flushPendingShareLinkRequests, getShareTokenMetadata } from './core/shareLinks';
import { listFailedNoteLinks, type FailedNoteLinkRecord } from './core/noteLinkApi';
import { searchNotes, type NoteSearchMatchKind, type NoteSearchResult } from './core/noteMediaApi';
import { emitNoteMediaChanged, scheduleQueuedNoteImageFlush } from './core/noteMediaStore';
import { flushQueuedNoteLinkSync } from './core/noteLinkStore';
import { scheduleQueuedNoteDocumentFlush } from './core/noteDocumentStore';
import { cancelSyncOutboxWorker, flushSyncOutbox, getWorkspaceInviteConflictEventName, getWorkspaceInviteStateEventName, scheduleSyncOutboxFlush } from './core/syncOutbox';
import { listWorkspacePendingInvites } from './core/workspaceInviteApi';
import { canEditWorkspaceContent, canManageWorkspace, normalizeWorkspaceRole, type WorkspaceRole } from './core/workspaceRoles';
import {
	cacheActiveWorkspaceSelection,
	cacheWorkspaceDetails,
	cacheWorkspaceSnapshot,
	type CachedWorkspaceListItem,
	readPendingWorkspaceMutations,
	removePendingWorkspaceMutation,
	removeCachedWorkspace,
	readCachedWorkspaceSnapshot,
} from './core/workspaceMetadataStore';
import { getWorkspaceDisplayName } from './core/workspaceDisplay';

type EditorMode = 'none' | 'text' | 'checklist';

type CollaboratorModalState = {
	noteId: string;
	docId: string;
	title: string;
};

type NoteImageModalState = {
	noteId: string;
	docId: string;
	title: string;
};

type NoteDocumentModalState = {
	noteId: string;
	docId: string;
	title: string;
};

type NoteAttachmentBrowserState = {
	kind: NoteAttachmentBrowserKind;
	noteId: string;
	docId: string;
	title: string;
	canEdit: boolean;
};

type OverlaySnapshot = {
	editorMode: EditorMode;
	selectedNoteId: string | null;
	isPreferencesOpen: boolean;
	isAppearanceOpen: boolean;
	isUserManagementOpen: boolean;
	isSendInviteOpen: boolean;
	isWorkspaceSwitcherOpen: boolean;
	collaboratorModalState: CollaboratorModalState | null;
	noteAttachmentBrowserState: NoteAttachmentBrowserState | null;
	isMobileSidebarOpen: boolean;
	isFabOpen: boolean;
};

type SidebarWorkspaceListItem = CachedWorkspaceListItem;

function mapWorkspaceList(value: unknown): SidebarWorkspaceListItem[] {
	if (!Array.isArray(value)) return [];
	return value
		.map<SidebarWorkspaceListItem | null>((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			const workspace = entry as Record<string, unknown>;
			const id = typeof workspace.id === 'string' ? workspace.id : '';
			if (!id) return null;
			return {
				id,
				name: typeof workspace.name === 'string' ? workspace.name : '',
				role: normalizeWorkspaceRole(workspace.role),
				ownerUserId: typeof workspace.ownerUserId === 'string' ? workspace.ownerUserId : null,
				systemKind: typeof workspace.systemKind === 'string' ? workspace.systemKind : null,
				createdAt: typeof workspace.createdAt === 'string' ? workspace.createdAt : new Date(0).toISOString(),
				updatedAt: typeof workspace.updatedAt === 'string' ? workspace.updatedAt : typeof workspace.createdAt === 'string' ? workspace.createdAt : new Date(0).toISOString(),
			};
		})
		.filter((workspace): workspace is SidebarWorkspaceListItem => Boolean(workspace));
}

function isLocalWorkspaceSelectionNewer(localUpdatedAt: string | null, remoteUpdatedAt: string | null): boolean {
	const localMs = localUpdatedAt ? Date.parse(localUpdatedAt) : Number.NaN;
	const remoteMs = remoteUpdatedAt ? Date.parse(remoteUpdatedAt) : Number.NaN;
	if (!Number.isFinite(localMs)) return false;
	if (!Number.isFinite(remoteMs)) return true;
	return localMs > remoteMs;
}

const OVERLAY_HISTORY_KEY = 'freemannotes.overlay.history.v1' as const;

type OverlayHistoryState = {
	[OVERLAY_HISTORY_KEY]: true;
	snapshot: OverlaySnapshot;
	kind?: 'overlay' | 'root';
};

const EMPTY_OVERLAY_SNAPSHOT: OverlaySnapshot = {
	editorMode: 'none',
	selectedNoteId: null,
	isPreferencesOpen: false,
	isAppearanceOpen: false,
	isUserManagementOpen: false,
	isSendInviteOpen: false,
	isWorkspaceSwitcherOpen: false,
	collaboratorModalState: null,
	noteAttachmentBrowserState: null,
	isMobileSidebarOpen: false,
	isFabOpen: false,
};

const CLOSED_SIDEBAR_GROUPS: Record<string, boolean> = {
	workspaces: false,
	reminders: false,
	labels: false,
	sorting: false,
	sortingFilters: false,
	sortingGrouping: false,
	collections: false,
};

type ExternalRoute = {
	kind: 'share' | 'invite';
	token: string;
};

function isOverlayHistoryState(value: unknown): value is OverlayHistoryState {
	if (!value || typeof value !== 'object') return false;
	return (value as Partial<OverlayHistoryState>)[OVERLAY_HISTORY_KEY] === true;
}

function isMoreMenuHistoryState(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	return (value as { __moreMenu?: boolean }).__moreMenu === true;
}

function isNoteImageViewerHistoryState(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	return typeof (value as { __noteImageViewer?: unknown }).__noteImageViewer === 'string';
}

function isNoteEditorMediaDockHistoryState(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	return typeof (value as { __noteEditorMediaDock?: unknown }).__noteEditorMediaDock === 'string';
}

function readExternalRoute(): ExternalRoute | null {
	// Public share pages and workspace invite acceptance reuse the main SPA shell.
	// We parse those URLs up front so App can branch into the dedicated read-only
	// or invite-accept views before the normal authenticated workspace UI renders.
	if (typeof window === 'undefined') return null;
	const pathname = window.location.pathname;
	const shareMatch = pathname.match(/^\/share\/([^/]+)$/);
	if (shareMatch) {
		return { kind: 'share', token: decodeURIComponent(shareMatch[1]) };
	}
	const inviteMatch = pathname.match(/^\/invite\/([^/]+)$/);
	if (inviteMatch) {
		return { kind: 'invite', token: decodeURIComponent(inviteMatch[1]) };
	}
	return null;
}

function clearExternalRoute(): void {
	// Once the user leaves a share/invite route we replace the history entry back
	// to `/` so refreshes reopen the normal app instead of replaying the token flow.
	if (typeof window === 'undefined') return;
	try {
		window.history.replaceState(window.history.state, '', '/');
	} catch {
		// ignore
	}
}

function detectStandaloneDisplayMode(): boolean {
	if (typeof window === 'undefined') return false;
	return (
		window.matchMedia?.('(display-mode: standalone)')?.matches ||
		// iOS Safari
		Boolean((window.navigator as unknown as { standalone?: boolean }).standalone)
	);
}

type AuthCacheV1 = {
	v: 1;
	userId: string;
	workspaceId: string | null;
	profileImage: string | null;
};

const AUTH_CACHE_KEY = 'freemannotes.auth.cache.v1';

function readAuthCache(): AuthCacheV1 | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(AUTH_CACHE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<AuthCacheV1>;
		if (parsed?.v !== 1) return null;
		const userId = typeof parsed.userId === 'string' ? parsed.userId : '';
		const workspaceId = typeof parsed.workspaceId === 'string' ? parsed.workspaceId : null;
		const profileImage = typeof parsed.profileImage === 'string' ? parsed.profileImage : null;
		if (!userId) return null;
		return { v: 1, userId, workspaceId, profileImage };
	} catch {
		return null;
	}
}

function writeAuthCache(next: AuthCacheV1): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(next));
	} catch {
		// ignore
	}
}

/**
 * Detect whether this page load is a within-session reload (F5 / pull-to-refresh)
 * vs a fresh session (close-and-reopen, tab eviction, new tab).
 *
 * sessionStorage survives reloads but is cleared when the browser/tab closes,
 * so we use it as a sentinel. Combined with navigationType === 'reload' this
 * reliably identifies an intentional manual refresh.
 */
const _isWithinSessionReload: boolean = (() => {
	try {
		const SESSION_KEY = 'freemannotes.session.active';
		const wasActive = sessionStorage.getItem(SESSION_KEY) === 'true';
		sessionStorage.setItem(SESSION_KEY, 'true');
		if (!wasActive) return false;
		const nav = performance?.getEntriesByType?.('navigation')?.[0] as
			PerformanceNavigationTiming | undefined;
		return nav?.type === 'reload';
	} catch {
		return false;
	}
})();

function clearAuthCache(): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.removeItem(AUTH_CACHE_KEY);
	} catch {
		// ignore
	}
}

// Cropper callback provides pixel coordinates in the *source image*.
// We store these so we can produce a deterministic 1:1 square avatar later.
type CropAreaPixels = { width: number; height: number; x: number; y: number };

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.addEventListener('load', () => resolve(img));
		img.addEventListener('error', () => reject(new Error('Failed to load image')));
		// Some browsers will taint the canvas if we draw cross-origin images
		// without CORS. Registration uses a local object URL, but we keep this here
		// because the helper is generic.
		img.crossOrigin = 'anonymous';
		img.src = src;
	});
}

async function getCroppedSquareBlob(imageSrc: string, crop: CropAreaPixels, sizePx: number): Promise<Blob> {
	// Converts a crop selection into a square PNG Blob.
	//
	// Why canvas:
	// - `react-easy-crop` gives us crop coordinates; canvas is the simplest way
	//   to apply those coordinates without additional dependencies.
	// - We upload a normalized image (small, square) to keep server work bounded
	//   and provide consistent avatar rendering.
	const image = await loadImage(imageSrc);
	const canvas = document.createElement('canvas');
	canvas.width = sizePx;
	canvas.height = sizePx;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas not supported');

	ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, sizePx, sizePx);

	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	if (!blob) throw new Error('Failed to encode image');
	return blob;
}

export function App(): React.JSX.Element {
	const manager = useDocumentManager();
	const connection = useConnectionStatus();
	const { t, locale, locales, setLocale } = useI18n();
	const [externalRoute, setExternalRoute] = React.useState<ExternalRoute | null>(() => readExternalRoute());
	const [inviteRouteState, setInviteRouteState] = React.useState<{ status: 'idle' | 'accepting' | 'error'; message: string | null }>({
		status: 'idle',
		message: null,
	});
	const [shareRouteState, setShareRouteState] = React.useState<{
		status: 'idle' | 'loading' | 'ready' | 'error';
		message: string | null;
		label: string | null;
		entityType: 'note' | 'workspace' | null;
		openWorkspaceId: string | null;
		openNoteId: string | null;
	}>({
		status: 'idle',
		message: null,
		label: null,
		entityType: null,
		openWorkspaceId: null,
		openNoteId: null,
	});
	const [shareAttemptKey, setShareAttemptKey] = React.useState(0);
	const [inviteAttemptKey, setInviteAttemptKey] = React.useState(0);
	// ── Cached auth restoration ─────────────────────────────────────────
	// Cached auth is trusted only for explicit offline startup. When the browser
	// is online we wait for `/api/auth/me` before mounting the authenticated UI,
	// which prevents stale local auth from triggering a burst of protected API
	// requests against an expired or missing server session.
	const authCacheRef = React.useRef(readAuthCache());
	const cachedAuth = authCacheRef.current;
	const canRestoreCachedAuthImmediately = Boolean(
		cachedAuth && typeof navigator !== 'undefined' && navigator.onLine === false
	);
	const [authStatus, setAuthStatus] = React.useState<'loading' | 'authed' | 'unauth'>(() =>
		canRestoreCachedAuthImmediately ? 'authed' : 'loading'
	);
	const [authMode, setAuthMode] = React.useState<'login' | 'register'>('login');
	const [authEmail, setAuthEmail] = React.useState('');
	const [authName, setAuthName] = React.useState('');
	const [authPassword, setAuthPassword] = React.useState('');
	const [authPasswordConfirm, setAuthPasswordConfirm] = React.useState('');
	const [authError, setAuthError] = React.useState<string | null>(null);
	const [authBusy, setAuthBusy] = React.useState(false);
	const [authUserId, setAuthUserId] = React.useState<string | null>(() => cachedAuth?.userId ?? null);
	const [authProfileImage, setAuthProfileImage] = React.useState<string | null>(() => cachedAuth?.profileImage ?? null);
	const [authWorkspaceId, setAuthWorkspaceId] = React.useState<string | null>(() => cachedAuth?.workspaceId ?? null);
	const [workspaceDeletedNotice, setWorkspaceDeletedNotice] = React.useState<{ hasOtherWorkspaces: boolean } | null>(null);
	// Brief dialog messages are used for small "discard" notices (e.g. preventing
	// empty notes from being saved). We avoid a blocking `alert()` and instead show
	// a transient on-screen message.
	const [briefDialogMessage, setBriefDialogMessage] = React.useState<string | null>(null);
	const briefDialogTimeoutRef = React.useRef<number | null>(null);
	const showBriefDialog = React.useCallback((message: string): void => {
		setBriefDialogMessage(message);
		if (briefDialogTimeoutRef.current !== null) {
			window.clearTimeout(briefDialogTimeoutRef.current);
		}
		briefDialogTimeoutRef.current = window.setTimeout(() => {
			briefDialogTimeoutRef.current = null;
			setBriefDialogMessage(null);
		}, 1500);
	}, []);
	React.useEffect(() => {
		return () => {
			if (briefDialogTimeoutRef.current !== null) {
				window.clearTimeout(briefDialogTimeoutRef.current);
				briefDialogTimeoutRef.current = null;
			}
		};
	}, []);
	// Splash overlay:
	// - During auth "loading": show a full-page splash immediately.
	// - After auth "authed": keep an overlay until NoteGrid signals its initial
	//   data is loaded. This prevents a refresh flash where cards paint, then
	//   immediately spring-animate from an incorrect initial layout.
	const [splashFading, setSplashFading] = React.useState(false);
	// Only show the splash overlay when this is a within-session reload (F5 /
	// pull-to-refresh). On a fresh session (close-and-reopen, tab eviction)
	// skip the splash entirely — there is no previous layout to flash.
	const [splashDismissed, setSplashDismissed] = React.useState(!_isWithinSessionReload);
	const handleGridReady = React.useCallback(() => {
		setSplashFading(true);
		setTimeout(() => setSplashDismissed(true), 400);
	}, []);
	// Stable workspace key for NoteGrid:
	// Retains the last non-null workspace ID so transient auth churn (e.g. network
	// handoffs) doesn't unmount/remount the grid and lose in-memory measurement
	// caches, scroll position, and any in-progress drag state.
	const stableWorkspaceKeyRef = React.useRef<string>('no-workspace');
	if (authWorkspaceId) stableWorkspaceKeyRef.current = authWorkspaceId;
	const [authOfflineMode, setAuthOfflineMode] = React.useState(false);
	const [registerAvatarUrl, setRegisterAvatarUrl] = React.useState<string | null>(null);
	const [registerAvatarCrop, setRegisterAvatarCrop] = React.useState({ x: 0, y: 0 });
	const [registerAvatarZoom, setRegisterAvatarZoom] = React.useState(1);
	const [registerAvatarAreaPixels, setRegisterAvatarAreaPixels] = React.useState<CropAreaPixels | null>(null);
	const authPasswordStrengthScore = React.useMemo(() => getPasswordStrengthScore(authPassword), [authPassword]);
	const authPasswordStrengthLabel = React.useMemo(() => getPasswordStrengthLabel(authPassword), [authPassword]);
	const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
	const [isMobileSidebarOpen, setIsMobileSidebarOpen] = React.useState(false);
	const [isMobileViewport, setIsMobileViewport] = React.useState(() => {
		if (typeof window === 'undefined') return false;
		return window.matchMedia('(pointer: coarse)').matches;
	});
	const headerRef = React.useRef<HTMLElement | null>(null);
	const sidebarToggleButtonRef = React.useRef<HTMLButtonElement | null>(null);
	const mobileSearchInputRef = React.useRef<HTMLInputElement | null>(null);
	const topControlsRef = React.useRef<HTMLDivElement | null>(null);
	const mobileSwipeZoneRef = React.useRef<HTMLDivElement | null>(null);
	const mobileSidebarRef = React.useRef<HTMLElement | null>(null);
	const workspaceMenuRef = React.useRef<HTMLDivElement | null>(null);
	const sidebarEntryButtonRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
	const [sidebarGroupsOpen, setSidebarGroupsOpen] = React.useState<Record<string, boolean>>(CLOSED_SIDEBAR_GROUPS);
	// Which sidebar view is active: regular notes, archive, or the trash bin.
	const [sidebarView, setSidebarView] = React.useState<'notes' | 'archive' | 'trash'>('notes');
	// UI mode for the "new note" panel.
	const [editorMode, setEditorMode] = React.useState<EditorMode>('none');
	// Phase 10 preferences shell entry point opened from top-right avatar.
	const [isPreferencesOpen, setIsPreferencesOpen] = React.useState(false);
	const [isAppearanceOpen, setIsAppearanceOpen] = React.useState(false);
	const [isUserManagementOpen, setIsUserManagementOpen] = React.useState(false);
	const [isSendInviteOpen, setIsSendInviteOpen] = React.useState(false);
	const [isShareNotificationsOpen, setIsShareNotificationsOpen] = React.useState(false);
	const [inviteWorkspaceTarget, setInviteWorkspaceTarget] = React.useState<{ id: string; name: string | null } | null>(null);
	const [isWorkspaceSwitcherOpen, setIsWorkspaceSwitcherOpen] = React.useState(false);
	const [activeWorkspaceName, setActiveWorkspaceName] = React.useState<string | null>(null);
	const [activeWorkspaceSystemKind, setActiveWorkspaceSystemKind] = React.useState<string | null>(null);
	const [sidebarWorkspaces, setSidebarWorkspaces] = React.useState<readonly SidebarWorkspaceListItem[]>([]);
	const [sidebarWorkspacesBusy, setSidebarWorkspacesBusy] = React.useState(false);
	const [sidebarWorkspacesError, setSidebarWorkspacesError] = React.useState<string | null>(null);
	const [sharedPlacements, setSharedPlacements] = React.useState<readonly SharedNotePlacement[]>([]);
	const [activeSharedFolder, setActiveSharedFolder] = React.useState<string | null>(null);
	const [pendingRestoredSharedFolder, setPendingRestoredSharedFolder] = React.useState<string | null | false>(false);
	const [pendingSharedFolderReveal, setPendingSharedFolderReveal] = React.useState<{ workspaceId: string; folderName: string | null } | null>(null);
	const [pendingShareNotificationCount, setPendingShareNotificationCount] = React.useState(0);
	const [failedLinkNotifications, setFailedLinkNotifications] = React.useState<FailedNoteLinkRecord[]>([]);
	const [collaborationRefreshToken, setCollaborationRefreshToken] = React.useState(0);
	const [collaboratorModalState, setCollaboratorModalState] = React.useState<CollaboratorModalState | null>(null);
	const [noteImageModalState, setNoteImageModalState] = React.useState<NoteImageModalState | null>(null);
	const [noteDocumentModalState, setNoteDocumentModalState] = React.useState<NoteDocumentModalState | null>(null);
	const [noteAttachmentBrowserState, setNoteAttachmentBrowserState] = React.useState<NoteAttachmentBrowserState | null>(null);
	// The currently selected note in the grid/editor area.
	const [selectedNoteId, setSelectedNoteId] = React.useState<string | null>(null);
	// Loaded Y.Doc for the selected note.
	const [openDoc, setOpenDoc] = React.useState<Y.Doc | null>(null);
	const [openDocId, setOpenDocId] = React.useState<string | null>(null);
	const [themeId, setThemeId] = React.useState<ThemeId>(() => getStoredThemeId());
	const deviceId = React.useMemo(() => getDeviceId(), []);
	const [checklistShowCompletedPref, setChecklistShowCompletedPref] = React.useState(false);
	const [quickDeleteChecklistPref, setQuickDeleteChecklistPref] = React.useState(false);
	const [prefsHydrationAttempted, setPrefsHydrationAttempted] = React.useState(false);
	const [searchQuery, setSearchQuery] = React.useState('');
	const deferredSearchQuery = React.useDeferredValue(searchQuery.trim());
	const [searchResults, setSearchResults] = React.useState<readonly NoteSearchResult[]>([]);
	const [searchResultsBusy, setSearchResultsBusy] = React.useState(false);
	const [searchResultsError, setSearchResultsError] = React.useState<string | null>(null);
	const [noteGridCollaboratorFilter, setNoteGridCollaboratorFilter] = React.useState<NoteGridCollaboratorFilter | null>(null);
	const [isMobileSearchOpen, setIsMobileSearchOpen] = React.useState(false);
	const [isFabOpen, setIsFabOpen] = React.useState(false);
	const isCoarsePointer = useIsCoarsePointer();
	const isMobileLandscape = useIsMobileLandscape();
	const maxCardHeightPx = isCoarsePointer ? 720 : 920;
	const activeWorkspaceRole = React.useMemo<WorkspaceRole | null>(() => {
		if (!authWorkspaceId) return null;
		const match = sidebarWorkspaces.find((workspace) => workspace.id === authWorkspaceId);
		return match ? normalizeWorkspaceRole(match.role) : null;
	}, [authWorkspaceId, sidebarWorkspaces]);
	const canManageActiveWorkspace = canManageWorkspace(activeWorkspaceRole);
	const canEditActiveWorkspace = canEditWorkspaceContent(activeWorkspaceRole);
	const exitBackPressRef = React.useRef({ count: 0, lastAt: 0 });
	// Guard: prevent queuing multiple history.back() calls from rapid taps.
	// Reset in the popstate handler once the navigation actually completes.
	const isNavigatingBackRef = React.useRef(false);

	const getOverlaySnapshot = React.useCallback((): OverlaySnapshot => {
		return {
			editorMode,
			selectedNoteId,
			isPreferencesOpen,
			isAppearanceOpen,
			isUserManagementOpen,
			isSendInviteOpen,
			isWorkspaceSwitcherOpen,
			collaboratorModalState,
			noteAttachmentBrowserState,
			isMobileSidebarOpen,
			isFabOpen,
		};
	}, [
		editorMode,
		selectedNoteId,
		isPreferencesOpen,
		isAppearanceOpen,
		isUserManagementOpen,
		isSendInviteOpen,
		isWorkspaceSwitcherOpen,
		collaboratorModalState,
		noteAttachmentBrowserState,
		isMobileSidebarOpen,
		isFabOpen,
	]);

	const applyOverlaySnapshot = React.useCallback((snapshot: OverlaySnapshot) => {
		setEditorMode(snapshot.editorMode);
		setSelectedNoteId(snapshot.selectedNoteId);
		setIsPreferencesOpen(snapshot.isPreferencesOpen);
		setIsAppearanceOpen(snapshot.isAppearanceOpen);
		setIsUserManagementOpen(snapshot.isUserManagementOpen);
		setIsSendInviteOpen(snapshot.isSendInviteOpen);
		setIsWorkspaceSwitcherOpen(snapshot.isWorkspaceSwitcherOpen);
		setCollaboratorModalState(snapshot.collaboratorModalState);
		setNoteAttachmentBrowserState(snapshot.noteAttachmentBrowserState);
		setIsMobileSidebarOpen(snapshot.isMobileSidebarOpen);
		setIsFabOpen(snapshot.isFabOpen);
	}, []);

	const commitOverlaySnapshot = React.useCallback(
		(snapshot: OverlaySnapshot, mode: 'push' | 'replace') => {
			applyOverlaySnapshot(snapshot);
			if (!isMobileViewport || typeof window === 'undefined') return;
			try {
				const nextState: OverlayHistoryState = {
					[OVERLAY_HISTORY_KEY]: true,
					snapshot,
					kind: 'overlay',
				};
				if (mode === 'replace' && isOverlayHistoryState(window.history.state)) {
					window.history.replaceState(nextState, '');
					return;
				}
				window.history.pushState(nextState, '');
			} catch {
				// ignore
			}
		},
		[applyOverlaySnapshot, isMobileViewport]
	);

	const goBackIfOverlayHistory = React.useCallback((): boolean => {
		if (!isMobileViewport || typeof window === 'undefined') return false;
		if (!isOverlayHistoryState(window.history.state)) return false;
		// Prevent queuing multiple history.back() from rapid taps; the guard
		// is cleared in the popstate handler once navigation completes.
		if (isNavigatingBackRef.current) return true;
		isNavigatingBackRef.current = true;
		window.history.back();
		return true;
	}, [isMobileViewport]);

	const handleExitExternalRoute = React.useCallback(() => {
		clearExternalRoute();
		setExternalRoute(null);
		setInviteRouteState({ status: 'idle', message: null });
		setShareRouteState({
			status: 'idle',
			message: null,
			label: null,
			entityType: null,
			openWorkspaceId: null,
			openNoteId: null,
		});
	}, []);

	const openPreferences = React.useCallback(() => {
		const current = getOverlaySnapshot();
		commitOverlaySnapshot(
			{
				...current,
				isPreferencesOpen: true,
				isAppearanceOpen: false,
				isUserManagementOpen: false,
				isSendInviteOpen: false,
				isWorkspaceSwitcherOpen: false,
				isFabOpen: false,
			},
			'push'
		);
	}, [commitOverlaySnapshot, getOverlaySnapshot]);

	const openAppearanceFromPreferences = React.useCallback(() => {
		const current = getOverlaySnapshot();
		commitOverlaySnapshot(
			{
				...current,
				isPreferencesOpen: false,
				isAppearanceOpen: true,
				isUserManagementOpen: false,
				isSendInviteOpen: false,
				isWorkspaceSwitcherOpen: false,
				isFabOpen: false,
			},
			'push'
		);
	}, [commitOverlaySnapshot, getOverlaySnapshot]);

	const backToPreferencesFromAppearance = React.useCallback(() => {
		if (goBackIfOverlayHistory()) return;
		setIsAppearanceOpen(false);
		setIsPreferencesOpen(true);
	}, [goBackIfOverlayHistory]);

	const openUserManagementFromPreferences = React.useCallback(() => {
		const current = getOverlaySnapshot();
		commitOverlaySnapshot(
			{
				...current,
				isPreferencesOpen: false,
				isUserManagementOpen: true,
				isSendInviteOpen: false,
				isFabOpen: false,
			},
			'push'
		);
	}, [commitOverlaySnapshot, getOverlaySnapshot]);

	const openSendInviteFromPreferences = React.useCallback(() => {
		if (activeWorkspaceSystemKind === 'SHARED_WITH_ME' || !canManageActiveWorkspace) return;
		setInviteWorkspaceTarget(authWorkspaceId ? { id: authWorkspaceId, name: activeWorkspaceName } : null);
		const current = getOverlaySnapshot();
		commitOverlaySnapshot(
			{
				...current,
				isPreferencesOpen: false,
				isUserManagementOpen: false,
				isSendInviteOpen: true,
				isFabOpen: false,
			},
			'push'
		);
	}, [activeWorkspaceName, activeWorkspaceSystemKind, authWorkspaceId, canManageActiveWorkspace, commitOverlaySnapshot, getOverlaySnapshot]);

	const openSendInviteForWorkspace = React.useCallback(
		(workspace: SidebarWorkspaceListItem) => {
			setInviteWorkspaceTarget({ id: workspace.id, name: getWorkspaceDisplayName(workspace, t) });
			const current = getOverlaySnapshot();
			commitOverlaySnapshot(
				{
					...current,
					isPreferencesOpen: false,
					isUserManagementOpen: false,
					isSendInviteOpen: true,
					isMobileSidebarOpen: false,
					isFabOpen: false,
				},
				isMobileViewport && isMobileSidebarOpen ? 'replace' : 'push'
			);
		},
			[activeWorkspaceName, activeWorkspaceSystemKind, authWorkspaceId, commitOverlaySnapshot, getOverlaySnapshot, isMobileSidebarOpen, isMobileViewport, t]
	);

	const openWorkspaceSwitcher = React.useCallback(
		(opts?: { replaceTop?: boolean }) => {
			const current = getOverlaySnapshot();
			commitOverlaySnapshot(
				{
					...current,
					isWorkspaceSwitcherOpen: true,
					isPreferencesOpen: false,
					isUserManagementOpen: false,
					isSendInviteOpen: false,
					isMobileSidebarOpen: false,
					isFabOpen: false,
				},
				opts?.replaceTop ? 'replace' : 'push'
			);
		},
		[commitOverlaySnapshot, getOverlaySnapshot]
	);

	const openShareNotifications = React.useCallback(() => {
		setIsShareNotificationsOpen(true);
	}, []);

	const openCollaboratorModalForNote = React.useCallback((noteId: string, title?: string) => {
		const placement = sharedPlacements.find((item) => item.aliasId === noteId);
		if (placement && placement.role === 'VIEWER') return;
		if (!placement && !canEditActiveWorkspace) return;
		const docId = placement ? placement.roomId : authWorkspaceId ? `${authWorkspaceId}:${noteId}` : null;
		if (!docId) return;
		const nextState: CollaboratorModalState = {
			noteId,
			docId,
			title: title || '',
		};
		const current = getOverlaySnapshot();
		commitOverlaySnapshot(
			{
				...current,
				collaboratorModalState: nextState,
				isMobileSidebarOpen: false,
				isFabOpen: false,
			},
			isMobileViewport && isMoreMenuHistoryState(typeof window !== 'undefined' ? window.history.state : null) ? 'replace' : 'push'
		);
	}, [authWorkspaceId, canEditActiveWorkspace, commitOverlaySnapshot, getOverlaySnapshot, isMobileViewport, sharedPlacements]);

	const closeCollaboratorModal = React.useCallback(() => {
		if (goBackIfOverlayHistory()) return;
		setCollaboratorModalState(null);
	}, [goBackIfOverlayHistory]);

	const openNoteImageModal = React.useCallback((noteId: string, docId: string, title?: string) => {
		setNoteImageModalState({ noteId, docId, title: title || '' });
	}, []);

	const closeNoteImageModal = React.useCallback(() => {
		setNoteImageModalState(null);
	}, []);

	const openNoteDocumentModal = React.useCallback((noteId: string, docId: string, title?: string) => {
		setNoteDocumentModalState({ noteId, docId, title: title || '' });
	}, []);

	const closeNoteDocumentModal = React.useCallback(() => {
		setNoteDocumentModalState(null);
	}, []);

	const openNoteAttachmentBrowser = React.useCallback((kind: NoteAttachmentBrowserKind, noteId: string, docId: string, title: string | undefined, canEdit: boolean) => {
		// The note-card media browser participates in the same overlay history stack
		// as editors and sidebars so mobile Back always peels off the top-most layer
		// before closing the underlying note or workspace UI.
		const current = getOverlaySnapshot();
		commitOverlaySnapshot(
			{
				...current,
				noteAttachmentBrowserState: { kind, noteId, docId, title: title || '', canEdit },
				isMobileSidebarOpen: false,
				isFabOpen: false,
			},
			'push'
		);
	}, [commitOverlaySnapshot, getOverlaySnapshot]);

	const closeNoteAttachmentBrowser = React.useCallback(() => {
		if (goBackIfOverlayHistory()) return;
		setNoteAttachmentBrowserState(null);
	}, [goBackIfOverlayHistory]);

	const openMobileSidebar = React.useCallback(() => {
		const current = getOverlaySnapshot();
		commitOverlaySnapshot(
			{
				...current,
				isMobileSidebarOpen: true,
				isFabOpen: false,
			},
			'push'
		);
	}, [commitOverlaySnapshot, getOverlaySnapshot]);

	React.useEffect(() => {
		const onPopState = () => {
			setExternalRoute(readExternalRoute());
		};
		window.addEventListener('popstate', onPopState);
		return () => window.removeEventListener('popstate', onPopState);
	}, []);

	const activeAttachmentBrowserDoc = React.useMemo(() => {
		if (!noteAttachmentBrowserState) return null;
		return manager.getDoc(noteAttachmentBrowserState.noteId);
	}, [manager, noteAttachmentBrowserState]);
	const isEditorOverlayOpen = editorMode !== 'none' || Boolean(selectedNoteId);

	const handleAddUrlPreviewFromBrowser = React.useCallback(() => {
		if (!noteAttachmentBrowserState?.canEdit) return;
		const next = window.prompt(t('links.prompt'), 'https://');
		if (!next) return;
		addNotePreviewLinkToDoc(manager.getDoc(noteAttachmentBrowserState.noteId), next);
	}, [manager, noteAttachmentBrowserState, t]);

	const handleDeleteUrlPreviewFromBrowser = React.useCallback((normalizedUrl: string) => {
		if (!noteAttachmentBrowserState?.canEdit) return;
		removeNotePreviewLinkFromDoc(manager.getDoc(noteAttachmentBrowserState.noteId), normalizedUrl);
	}, [manager, noteAttachmentBrowserState]);

	React.useEffect(() => {
		if (isSendInviteOpen) return;
		setInviteWorkspaceTarget(null);
	}, [isSendInviteOpen]);

	const restoreFocusFromHiddenRegion = React.useCallback((container: HTMLElement | null, fallbackTarget: HTMLElement | null) => {
		// Move focus out before a region becomes aria-hidden so browsers do not leave
		// the active element stranded inside hidden sidebar content.
		if (typeof document === 'undefined' || !container) return;
		const activeElement = document.activeElement;
		if (!(activeElement instanceof HTMLElement) || !container.contains(activeElement)) return;
		if (fallbackTarget && !fallbackTarget.hasAttribute('disabled')) {
			fallbackTarget.focus();
			return;
		}
		activeElement.blur();
	}, []);

	const closeMobileSidebar = React.useCallback(() => {
		if (goBackIfOverlayHistory()) return;
		restoreFocusFromHiddenRegion(mobileSidebarRef.current, sidebarToggleButtonRef.current);
		setIsMobileSidebarOpen(false);
	}, [goBackIfOverlayHistory, restoreFocusFromHiddenRegion]);

	const closeWorkspaceSidebarGroup = React.useCallback(() => {
		// Closing the workspace flyout can hide the focused workspace button, so restore
		// focus to the group trigger (desktop) or sidebar toggle (mobile) first.
		const fallbackTarget = isMobileViewport ? sidebarToggleButtonRef.current : sidebarEntryButtonRefs.current.workspaces;
		restoreFocusFromHiddenRegion(workspaceMenuRef.current, fallbackTarget);
		setSidebarGroupsOpen((prev) => ({ ...prev, workspaces: false }));
	}, [isMobileViewport, restoreFocusFromHiddenRegion]);

	const openCreateEditor = React.useCallback(
		(nextMode: Exclude<EditorMode, 'none'>, opts?: { replaceTop?: boolean }) => {
			const current = getOverlaySnapshot();
			commitOverlaySnapshot(
				{
					...current,
					editorMode: nextMode,
					selectedNoteId: null,
					isMobileSidebarOpen: false,
					isFabOpen: false,
					isPreferencesOpen: false,
					isUserManagementOpen: false,
					isSendInviteOpen: false,
					isWorkspaceSwitcherOpen: false,
				},
				opts?.replaceTop ? 'replace' : 'push'
			);
		},
		[commitOverlaySnapshot, getOverlaySnapshot]
	);

	const closeCreateEditor = React.useCallback(() => {
		if (goBackIfOverlayHistory()) return;
		setEditorMode('none');
		setSelectedNoteId(null);
	}, [goBackIfOverlayHistory]);

	type NoteEditorOpenOptions = { replaceTop?: boolean };
	const openNoteEditor = React.useCallback(
		(noteId: string, opts?: NoteEditorOpenOptions) => {
			const current = getOverlaySnapshot();
			const historyState = typeof window !== 'undefined' ? window.history.state : null;
			// When the editor is reopened from a nested media layer, replace that top
			// history entry instead of stacking another editor snapshot on top of it.
			const shouldReplaceTop =
				opts?.replaceTop ||
				isNoteImageViewerHistoryState(historyState) ||
				isNoteEditorMediaDockHistoryState(historyState);
			commitOverlaySnapshot(
				{
					...current,
					editorMode: 'none',
					selectedNoteId: noteId,
					isMobileSidebarOpen: false,
					isFabOpen: false,
				},
				shouldReplaceTop ? 'replace' : 'push'
			);
		},
		[commitOverlaySnapshot, getOverlaySnapshot]
	);

	const closeNoteEditor = React.useCallback(() => {
		if (goBackIfOverlayHistory()) return;
		setSelectedNoteId(null);
		setEditorMode('none');
	}, [goBackIfOverlayHistory]);

	const toggleFab = React.useCallback(() => {
		if (isFabOpen) {
			if (goBackIfOverlayHistory()) return;
			setIsFabOpen(false);
			return;
		}
		const current = getOverlaySnapshot();
		commitOverlaySnapshot({ ...current, isFabOpen: true }, 'push');
	}, [commitOverlaySnapshot, getOverlaySnapshot, goBackIfOverlayHistory, isFabOpen]);

	React.useEffect(() => {
		applyTheme(themeId);
		persistThemeId(themeId);
		if (authStatus !== 'authed') return;
		if (!prefsHydrationAttempted) return;
		if (authOfflineMode) return;
		void updateUserPreferences(deviceId, { theme: themeId });
	}, [authStatus, authOfflineMode, deviceId, prefsHydrationAttempted, themeId]);

	React.useEffect(() => {
		if (authStatus !== 'authed') return;
		if (!prefsHydrationAttempted) return;
		if (authOfflineMode) return;
		void updateUserPreferences(deviceId, { language: locale });
	}, [authStatus, authOfflineMode, deviceId, locale, prefsHydrationAttempted]);

	const sidebarWorkspacesRef = React.useRef<readonly SidebarWorkspaceListItem[]>([]);
	const handleWorkspaceActivatedRef = React.useRef<(workspaceId: string) => void>(() => undefined);

	const refreshActiveWorkspace = React.useCallback(async () => {
		if (!authWorkspaceId) {
			setActiveWorkspaceName(null);
			setActiveWorkspaceSystemKind(null);
			return;
		}
		const localWorkspace = sidebarWorkspacesRef.current.find((workspace) => workspace.id === authWorkspaceId);
		if (localWorkspace) {
			setActiveWorkspaceName(getWorkspaceDisplayName(localWorkspace, t));
			setActiveWorkspaceSystemKind(localWorkspace.systemKind ?? null);
		}
		if (authStatus !== 'authed' || authOfflineMode) {
			return;
		}
		try {
			const res = await fetch('/api/workspace', { credentials: 'include' });
			const contentType = String(res.headers.get('content-type') || '').toLowerCase();
			if (!res.ok || !contentType.includes('application/json')) {
				return;
			}
			const body = await res.json().catch(() => null);
			if (authUserId && body?.id) {
				await cacheWorkspaceDetails({
					workspace: {
						id: String(body.id),
						name: typeof body.name === 'string' ? body.name : '',
						ownerUserId: typeof body.ownerUserId === 'string' ? body.ownerUserId : null,
						createdAt: typeof body.createdAt === 'string' ? body.createdAt : null,
						updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : null,
					},
					userId: authUserId,
					role: body?.role ? normalizeWorkspaceRole(body.role) : null,
				});
			}
			setActiveWorkspaceName(getWorkspaceDisplayName({
				name: typeof body?.name === 'string' ? body.name : null,
				ownerUserId: typeof body?.ownerUserId === 'string' ? body.ownerUserId : null,
				systemKind: typeof body?.systemKind === 'string' ? body.systemKind : null,
			}, t));
		} catch {
			// Keep the locally cached name on screen when the server is unavailable.
		}
	}, [authOfflineMode, authStatus, authUserId, authWorkspaceId, t]);

	const refreshActiveWorkspaceRef = React.useRef(refreshActiveWorkspace);

	React.useEffect(() => {
		refreshActiveWorkspaceRef.current = refreshActiveWorkspace;
	}, [refreshActiveWorkspace]);

	const confirmActivatedWorkspaceSession = React.useCallback(async (workspaceId: string): Promise<void> => {
		// Workspace activation flips the server-side session before the client should
		// reconnect Yjs rooms against the new workspace namespace.
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const res = await fetch('/api/workspace', { credentials: 'include' });
				const contentType = String(res.headers.get('content-type') || '').toLowerCase();
				if (res.ok && contentType.includes('application/json')) {
					const body = await res.json().catch(() => null);
					if (body?.id && String(body.id) === workspaceId) {
						return;
					}
				}
			} catch {
				// Best effort only. The activation request already succeeded.
			}
			if (attempt < 2) {
				await new Promise<void>((resolve) => {
					window.setTimeout(resolve, 120);
				});
			}
		}
	}, []);

	React.useEffect(() => {
		if (authStatus !== 'authed') return;
		void refreshActiveWorkspace();
	}, [authStatus, authWorkspaceId, refreshActiveWorkspace]);

	const restoreCachedAuthSession = React.useCallback((): boolean => {
		// Offline-auth branch: reuse the last authenticated user/workspace so IndexedDB
		// notes and cached workspace metadata stay available while the backend is unreachable.
		const cached = readAuthCache();
		if (!cached) return false;
		setAuthStatus('authed');
		setAuthUserId(cached.userId);
		setAuthProfileImage(cached.profileImage);
		setAuthWorkspaceId(cached.workspaceId);
		setAuthOfflineMode(true);
		manager.setActiveWorkspaceId(cached.workspaceId);
		manager.setWebsocketEnabled(false);
		return true;
	}, [manager]);

	const probeSession = React.useCallback(
		async (opts?: { allowOfflineRestore?: boolean }) => {
			// Session probe:
			// - If authenticated, enable websocket sync.
			// - If offline and we have a cached session+workspace, restore it so the
			//   user can access their offline IndexedDB notes.
			const allowOfflineRestore = opts?.allowOfflineRestore ?? true;
			try {
				const res = await fetch(`/api/auth/me?deviceId=${encodeURIComponent(deviceId)}`, {
					credentials: 'include',
				});
				const contentType = String(res.headers.get('content-type') || '').toLowerCase();
				if (!res.ok || !contentType.includes('application/json')) {
					const isExplicitUnauth = res.status === 401 || res.status === 403;
					if (!isExplicitUnauth && allowOfflineRestore && restoreCachedAuthSession()) {
						return;
					}
					setAuthStatus('unauth');
					setAuthUserId(null);
					setAuthProfileImage(null);
					setAuthWorkspaceId(null);
					setAuthOfflineMode(false);
					manager.setActiveWorkspaceId(null);
					manager.setWebsocketEnabled(false);
					return;
				}

				const body = await res.json().catch(() => null);
				const userId = body?.user?.id ? String(body.user.id) : '';
				const profileImage = body?.user?.profileImage ? String(body.user.profileImage) : null;
				const workspaceId = body?.workspaceId ? String(body.workspaceId) : null;
				if (!userId) {
					setAuthStatus('unauth');
					setAuthUserId(null);
					setAuthProfileImage(null);
					setAuthWorkspaceId(null);
					setAuthOfflineMode(false);
					manager.setActiveWorkspaceId(null);
					manager.setWebsocketEnabled(false);
					return;
				}

				setAuthStatus('authed');
				setAuthUserId(userId);
				setAuthProfileImage(profileImage);
				setAuthWorkspaceId(workspaceId);
				setAuthOfflineMode(false);
				manager.setActiveWorkspaceId(workspaceId);
				manager.setWebsocketEnabled(Boolean(workspaceId));
				writeAuthCache({ v: 1, userId, workspaceId, profileImage });
			} catch {
				// Treat transport failures and unreachable backends like offline mode when
				// we have a cached session, even if the browser still reports "online".
				if (allowOfflineRestore && restoreCachedAuthSession()) {
					return;
				}

				setAuthStatus('unauth');
				setAuthUserId(null);
				setAuthProfileImage(null);
				setAuthWorkspaceId(null);
				setAuthOfflineMode(false);
				manager.setActiveWorkspaceId(null);
				manager.setWebsocketEnabled(false);
			}
		},
		[deviceId, manager, restoreCachedAuthSession]
	);

	// The workspace is now pre-seeded at DocumentManager construction time
	// (via initialWorkspaceId in main.tsx). This avoids the race where child
	// effects (NoteGrid) start awaiting registry data before this parent
	// effect can call setActiveWorkspaceId. No eager effect needed here.

	React.useEffect(() => {
		let cancelled = false;
		(async () => {
			await probeSession({ allowOfflineRestore: true });
			if (cancelled) return;
		})();
		return () => {
			cancelled = true;
		};
	}, [probeSession]);

	React.useEffect(() => {
		if (authStatus !== 'authed') {
			setPrefsHydrationAttempted(false);
			return;
		}
		if (authOfflineMode) {
			setPrefsHydrationAttempted(true);
			return;
		}
		let cancelled = false;
		(async () => {
			const localSnapshot = authUserId ? await readCachedWorkspaceSnapshot(authUserId, deviceId) : null;
			const pref = await fetchUserPreferences(deviceId);
			if (cancelled) return;
			if (pref) {
				let syncedWorkspaceId = pref.activeWorkspaceId;
				let syncedActiveSharedFolder = pref.activeSharedFolder;
				const localSelectionNewer = Boolean(
					localSnapshot && isLocalWorkspaceSelectionNewer(localSnapshot.preferenceUpdatedAt, pref.updatedAt)
				);
				if (
					localSnapshot &&
					localSnapshot.activeWorkspaceId &&
					localSnapshot.activeWorkspaceId !== pref.activeWorkspaceId &&
					localSelectionNewer
				) {
					const activatedWorkspaceId = await activateWorkspace(deviceId, localSnapshot.activeWorkspaceId);
					if (!cancelled && activatedWorkspaceId) {
						syncedWorkspaceId = activatedWorkspaceId;
						handleWorkspaceActivatedRef.current(activatedWorkspaceId);
					}
				}
				if (
					localSnapshot &&
					localSelectionNewer &&
					(localSnapshot.activeSharedFolder ?? null) !== (pref.activeSharedFolder ?? null)
				) {
					const updatedPref = await updateUserPreferences(deviceId, {
						activeSharedFolder: localSnapshot.activeSharedFolder ?? null,
					});
					if (!cancelled) {
						syncedActiveSharedFolder = updatedPref?.activeSharedFolder ?? (localSnapshot.activeSharedFolder ?? null);
					}
				}
				await cacheActiveWorkspaceSelection({
					userId: pref.userId,
					deviceId: pref.deviceId,
					activeWorkspaceId: syncedWorkspaceId,
					activeSharedFolder: syncedActiveSharedFolder,
					createdAt: pref.createdAt,
					updatedAt: syncedWorkspaceId === pref.activeWorkspaceId ? pref.updatedAt : new Date().toISOString(),
				});
				setPendingRestoredSharedFolder(syncedActiveSharedFolder ?? null);
				if (pref.theme) setThemeId(pref.theme as ThemeId);
				if (pref.language) setLocale(pref.language as LocaleCode);
				setChecklistShowCompletedPref(Boolean(pref.checklistShowCompleted));
				setQuickDeleteChecklistPref(Boolean(pref.quickDeleteChecklist));
				seedNoteCardCompletedExpandedByNoteId(pref.noteCardCompletedExpandedByNoteId || {});
			}
			setPrefsHydrationAttempted(true);
		})();
		return () => {
			cancelled = true;
		};
	}, [authOfflineMode, authStatus, authUserId, deviceId, setLocale]);

	React.useEffect(() => {
		if (authStatus !== 'authed' || !authUserId) return;
		let cancelled = false;
		(async () => {
			const snapshot = await readCachedWorkspaceSnapshot(authUserId, deviceId);
			if (cancelled) return;
			if (snapshot.workspaces.length > 0) {
				setSidebarWorkspaces(snapshot.workspaces);
				setSidebarWorkspacesError(null);
			}
			if ((authOfflineMode || !authWorkspaceId) && snapshot.activeWorkspaceId) {
				setAuthWorkspaceId(snapshot.activeWorkspaceId);
				manager.setActiveWorkspaceId(snapshot.activeWorkspaceId);
				manager.setWebsocketEnabled(!authOfflineMode);
				setPendingRestoredSharedFolder(snapshot.activeSharedFolder ?? null);
				writeAuthCache({
					v: 1,
					userId: authUserId,
					workspaceId: snapshot.activeWorkspaceId,
					profileImage: authProfileImage,
				});
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [authOfflineMode, authProfileImage, authStatus, authUserId, authWorkspaceId, deviceId, manager]);

	React.useEffect(() => {
		if (authStatus !== 'authed' || !authUserId || typeof window === 'undefined') return;
		let running = false;
		const onOnline = () => {
			if (running) return;
			running = true;
			void (async () => {
				try {
					await syncPendingWorkspaceMutationsRef.current();
					await flushPendingShareLinkRequests(authUserId);
					await loadSidebarWorkspacesRef.current();
					await refreshActiveWorkspaceRef.current();
					if (authOfflineMode) {
						// Browser "online" only means a network is available; it does not
						// guarantee the app server is reachable. Keep offline-auth active
						// until the probe gets a definitive authenticated or explicit unauth response.
						await probeSession({ allowOfflineRestore: true });
					}
				} finally {
					running = false;
				}
			})();
		};
		window.addEventListener('online', onOnline);
		if (navigator.onLine) {
			onOnline();
		}
		return () => {
			window.removeEventListener('online', onOnline);
		};
	}, [authOfflineMode, authStatus, authUserId, deviceId, manager, probeSession]);

	React.useEffect(() => {
		if (authStatus !== 'authed' || !authUserId || authOfflineMode) {
			cancelSyncOutboxWorker(authUserId);
			return;
		}
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
		void flushSyncOutbox(authUserId);
		void scheduleSyncOutboxFlush(authUserId);
		void flushPendingShareLinkRequests(authUserId);
		return () => {
			cancelSyncOutboxWorker(authUserId);
		};
	}, [authOfflineMode, authStatus, authUserId]);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const eventName = getWorkspaceInviteConflictEventName();
		const onConflict = (event: Event): void => {
			const detail = (event as CustomEvent<{ message?: string }>).detail;
			showBriefDialog(detail?.message || 'An offline workspace access change was rejected because the server state changed.');
		};
		window.addEventListener(eventName, onConflict as EventListener);
		return () => {
			window.removeEventListener(eventName, onConflict as EventListener);
		};
	}, [showBriefDialog]);

	const signOut = React.useCallback(async () => {
		// Logout is best-effort: even if the request fails (offline), we clear local
		// auth state and disable websocket sync.
		try {
			await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
		} catch {
			// ignore
		}
		setAuthStatus('unauth');
		setAuthUserId(null);
		setAuthProfileImage(null);
		setAuthWorkspaceId(null);
		setAuthOfflineMode(false);
		clearAuthCache();
		manager.setActiveWorkspaceId(null);
		manager.setWebsocketEnabled(false);
		cancelSyncOutboxWorker(authUserId);
		setIsUserManagementOpen(false);
		setIsPreferencesOpen(false);
		setIsAppearanceOpen(false);
		setIsSendInviteOpen(false);
		setInviteWorkspaceTarget(null);
		setIsWorkspaceSwitcherOpen(false);
		setActiveWorkspaceName(null);
		setActiveWorkspaceSystemKind(null);
		setSidebarWorkspaces([]);
		setSidebarWorkspacesError(null);
		setSharedPlacements([]);
		setActiveSharedFolder(null);
		setPendingRestoredSharedFolder(false);
		setPendingSharedFolderReveal(null);
		setPendingShareNotificationCount(0);
		setCollaboratorModalState(null);
		setNoteGridCollaboratorFilter(null);
	}, [authUserId, manager]);

	const clearActiveWorkspaceState = React.useCallback(
		(opts?: { preserveAuthCache?: boolean }) => {
			// Centralized workspace-loss reset used by local deletes, remote deletes, and
			// auth/session drift. Clearing these pieces together prevents stale editors,
			// note selections, and websocket rooms from surviving after workspace removal.
			setAuthWorkspaceId(null);
			manager.setActiveWorkspaceId(null);
			manager.setWebsocketEnabled(false);
			setSelectedNoteId(null);
			setOpenDoc(null);
			setOpenDocId(null);
			setEditorMode('none');
			setActiveWorkspaceName(null);
			setActiveWorkspaceSystemKind(null);
			setSharedPlacements([]);
			setActiveSharedFolder(null);
			setPendingRestoredSharedFolder(false);
			setPendingSharedFolderReveal(null);
			setCollaboratorModalState(null);
			if (authUserId) {
				void cacheActiveWorkspaceSelection({
					userId: authUserId,
					deviceId,
					activeWorkspaceId: null,
					activeSharedFolder: null,
				});
				if (opts?.preserveAuthCache) {
					writeAuthCache({ v: 1, userId: authUserId, workspaceId: null, profileImage: authProfileImage });
				}
			}
		},
		[authProfileImage, authUserId, deviceId, manager]
	);

	const handleWorkspaceActivated = React.useCallback(
		(workspaceId: string) => {
			// Re-show the splash overlay while the new workspace's notes load.
			// NoteGrid remounts (key changes) and fires onReady once loaded,
			// which triggers handleGridReady → fade-out → dismiss.
			setSplashFading(false);
			setSplashDismissed(false);
			setAuthWorkspaceId(workspaceId);
			manager.setActiveWorkspaceId(workspaceId);
			setSelectedNoteId(null);
			setOpenDoc(null);
			setOpenDocId(null);
			setEditorMode('none');
			setActiveSharedFolder(null);
			if (authUserId) {
				void cacheActiveWorkspaceSelection({
					userId: authUserId,
					deviceId,
					activeWorkspaceId: workspaceId,
					activeSharedFolder: null,
				});
				writeAuthCache({ v: 1, userId: authUserId, workspaceId, profileImage: authProfileImage });
			}
			void refreshActiveWorkspace();
		},
		[authProfileImage, authUserId, deviceId, manager, refreshActiveWorkspace]
	);

	const persistSharedWorkspaceSelection = React.useCallback(
		async (workspaceId: string, folderName: string | null): Promise<void> => {
			const normalizedFolder = typeof folderName === 'string' && folderName.trim() ? folderName.trim() : null;
			if (authUserId) {
				await cacheActiveWorkspaceSelection({
					userId: authUserId,
					deviceId,
					activeWorkspaceId: workspaceId,
					activeSharedFolder: normalizedFolder,
				});
			}
			if (authStatus !== 'authed' || authOfflineMode || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
				return;
			}
			await updateUserPreferences(deviceId, { activeSharedFolder: normalizedFolder });
		},
		[authOfflineMode, authStatus, authUserId, deviceId]
	);

	React.useEffect(() => {
		// Workspace invites are accepted as a post-login side effect. This keeps the
		// invite token flow resilient across reloads: the token stays in the URL until
		// the user is authenticated, online, and the workspace activation succeeds.
		if (externalRoute?.kind !== 'invite') {
			setInviteRouteState({ status: 'idle', message: null });
			return;
		}
		if (authStatus !== 'authed') return;
		if (authOfflineMode || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
			setInviteRouteState({ status: 'error', message: t('invite.acceptOfflineUnavailable') });
			return;
		}
		let cancelled = false;
		setInviteRouteState({ status: 'accepting', message: null });
		void (async () => {
			try {
				const res = await fetch('/api/invites/accept', {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ token: externalRoute.token }),
				});
				const body = await res.json().catch(() => null);
				if (!res.ok) {
					const message = body && typeof body.error === 'string' ? body.error : t('invite.acceptFailed');
					throw new Error(message);
				}
				const workspaceId = body?.workspaceId ? String(body.workspaceId) : '';
				if (workspaceId) {
					const activatedWorkspaceId = await activateWorkspace(deviceId, workspaceId);
					const resolvedWorkspaceId = activatedWorkspaceId || workspaceId;
					// Confirm the server session has switched workspaces before the grid mounts
					// the new Yjs rooms. Without this follow-up, freshly accepted workspaces can
					// render an empty grid until a full refresh refreshes the auth cookie state.
					await confirmActivatedWorkspaceSession(resolvedWorkspaceId);
					await loadSidebarWorkspacesRef.current();
					handleWorkspaceActivated(resolvedWorkspaceId);
				}
				if (cancelled) return;
				showBriefDialog(t('invite.accepted'));
				handleExitExternalRoute();
			} catch (err) {
				if (cancelled) return;
				setInviteRouteState({
					status: 'error',
					message: err instanceof Error ? err.message : t('invite.acceptFailed'),
				});
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [authOfflineMode, authStatus, confirmActivatedWorkspaceSession, deviceId, externalRoute, handleExitExternalRoute, handleWorkspaceActivated, inviteAttemptKey, manager, showBriefDialog, t]);

	const handleWorkspaceDeleted = React.useCallback(
		async (deletedWorkspaceId: string, nextActiveWorkspaceId: string | null) => {
			// Local delete flow: remove cached metadata for the deleted workspace, then either
			// activate the server-selected fallback workspace or clear workspace state entirely.
			if (authUserId) {
				await removeCachedWorkspace({ workspaceId: deletedWorkspaceId, userId: authUserId, deviceId });
			}
			setSidebarWorkspaces((prev) => prev.filter((workspace) => workspace.id !== deletedWorkspaceId));
			if (nextActiveWorkspaceId) {
				if (nextActiveWorkspaceId !== authWorkspaceId) {
					handleWorkspaceActivated(nextActiveWorkspaceId);
				}
				return;
			}
			clearActiveWorkspaceState({ preserveAuthCache: true });
		},
		[authUserId, authWorkspaceId, clearActiveWorkspaceState, deviceId, handleWorkspaceActivated]
	);

	const handleRemoteWorkspaceRemoval = React.useCallback(
		(args: { nextActiveWorkspaceId: string | null; hasOtherWorkspaces: boolean }) => {
			if (args.nextActiveWorkspaceId) {
				if (args.nextActiveWorkspaceId !== authWorkspaceId) {
					handleWorkspaceActivatedRef.current(args.nextActiveWorkspaceId);
				}
			} else {
				clearActiveWorkspaceState({ preserveAuthCache: true });
			}
			setWorkspaceDeletedNotice({ hasOtherWorkspaces: args.hasOtherWorkspaces });
		},
		[authWorkspaceId, clearActiveWorkspaceState]
	);

	const handleRemoteWorkspaceDeletedEvent = React.useCallback(
		(deletedWorkspaceId: string) => {
			// Remote delete flow: another tab/device/user action removed the workspace we are
			// currently in. Clear the active workspace immediately and show the recovery notice.
			if (!authWorkspaceId || deletedWorkspaceId !== authWorkspaceId) return;
			const hasOtherWorkspaces = sidebarWorkspacesRef.current.some((workspace) => workspace.id !== deletedWorkspaceId);
			setSidebarWorkspaces((prev) => prev.filter((workspace) => workspace.id !== deletedWorkspaceId));
			clearActiveWorkspaceState({ preserveAuthCache: true });
			setWorkspaceDeletedNotice({ hasOtherWorkspaces });
		},
		[authWorkspaceId, clearActiveWorkspaceState]
	);
	const handleRemoteWorkspaceDeletedEventRef = React.useRef(handleRemoteWorkspaceDeletedEvent);

	React.useEffect(() => {
		handleRemoteWorkspaceDeletedEventRef.current = handleRemoteWorkspaceDeletedEvent;
	}, [handleRemoteWorkspaceDeletedEvent]);

	const syncPendingWorkspaceMutations = React.useCallback(async (): Promise<void> => {
		if (authStatus !== 'authed' || !authUserId) return;
		// Mutation replay is online-only. While offline we keep the queue intact and let the
		// optimistic IndexedDB view continue to drive the workspace picker/sidebar.
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

		const pending = await readPendingWorkspaceMutations(authUserId, deviceId);
		if (pending.length === 0) return;

		for (const mutation of pending) {
			try {
				if (mutation.kind === 'create') {
					const res = await fetch('/api/workspaces', {
						method: 'POST',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ id: mutation.workspaceId, name: mutation.workspaceName || '' }),
					});
					const body = await res.json().catch(() => null);
					if (!res.ok) {
						const message = body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
						throw new Error(message);
					}
					if (body?.workspace) {
						await cacheWorkspaceDetails({
							workspace: {
								id: String(body.workspace.id),
								name: typeof body.workspace.name === 'string' ? body.workspace.name : mutation.workspaceName || '',
								ownerUserId: typeof body.workspace.ownerUserId === 'string' ? body.workspace.ownerUserId : authUserId,
								createdAt: typeof body.workspace.createdAt === 'string' ? body.workspace.createdAt : mutation.createdAt,
								updatedAt: typeof body.workspace.updatedAt === 'string' ? body.workspace.updatedAt : mutation.updatedAt,
							},
							userId: authUserId,
							role: 'OWNER',
						});
					}
					await removePendingWorkspaceMutation({
						userId: authUserId,
						deviceId,
						workspaceId: mutation.workspaceId,
						kind: 'create',
					});
					continue;
				}

				const res = await fetch(`/api/workspaces/${encodeURIComponent(mutation.workspaceId)}`, {
					method: 'DELETE',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ deviceId }),
				});
				const body = await res.json().catch(() => null);
				if (!res.ok && res.status !== 404 && res.status !== 403) {
					const message = body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
					throw new Error(message);
				}
				await removePendingWorkspaceMutation({
					userId: authUserId,
					deviceId,
					workspaceId: mutation.workspaceId,
					kind: 'delete',
				});
				await removeCachedWorkspace({ workspaceId: mutation.workspaceId, userId: authUserId, deviceId });
			} catch {
				// Stop on the first failed mutation so later queue entries do not replay against
				// a server state that is already diverging from the local mutation order.
				break;
			}
		}

		// Re-read the merged snapshot after replay so active workspace resolution uses the
		// final local cache state, including any queued mutations still left behind.
		const mergedSnapshot = await readCachedWorkspaceSnapshot(authUserId, deviceId);
		if (mergedSnapshot.activeWorkspaceId) {
			const activatedWorkspaceId = await activateWorkspace(deviceId, mergedSnapshot.activeWorkspaceId);
			if (activatedWorkspaceId && activatedWorkspaceId !== authWorkspaceId) {
				handleWorkspaceActivated(activatedWorkspaceId);
			}
		} else if (authWorkspaceId && !mergedSnapshot.workspaces.some((workspace) => workspace.id === authWorkspaceId)) {
			clearActiveWorkspaceState({ preserveAuthCache: true });
		}
	}, [authStatus, authUserId, deviceId, authWorkspaceId, handleWorkspaceActivated, clearActiveWorkspaceState]);

	const syncPendingWorkspaceMutationsRef = React.useRef(syncPendingWorkspaceMutations);

	React.useEffect(() => {
		syncPendingWorkspaceMutationsRef.current = syncPendingWorkspaceMutations;
	}, [syncPendingWorkspaceMutations]);

	React.useEffect(() => {
		handleWorkspaceActivatedRef.current = handleWorkspaceActivated;
	}, [handleWorkspaceActivated]);
	React.useEffect(() => {
		sidebarWorkspacesRef.current = sidebarWorkspaces;
		if (!authWorkspaceId) {
			setActiveWorkspaceName(null);
			setActiveWorkspaceSystemKind(null);
			return;
		}
		const match = sidebarWorkspaces.find((workspace) => workspace.id === authWorkspaceId);
		if (match) {
			setActiveWorkspaceName(getWorkspaceDisplayName(match, t));
			setActiveWorkspaceSystemKind(match.systemKind ?? null);
		}
	}, [authWorkspaceId, sidebarWorkspaces, t]);

	const sharedFolderNames = React.useMemo(() => {
		// Sidebar folders are derived from accepted placements rather than from a
		// separate folder table. A blank folderName means the note belongs directly
		// to the Shared With Me workspace root.
		const names = new Set<string>();
		for (const placement of sharedPlacements) {
			const folderName = String(placement.folderName || '').trim();
			if (!folderName) continue;
			names.add(folderName);
		}
		return Array.from(names).sort((left, right) => left.localeCompare(right));
	}, [sharedPlacements]);

	React.useEffect(() => {
		if (activeWorkspaceSystemKind !== 'SHARED_WITH_ME') {
			setActiveSharedFolder(null);
			return;
		}
		if (activeSharedFolder && !sharedFolderNames.includes(activeSharedFolder)) {
			setActiveSharedFolder(null);
		}
	}, [activeSharedFolder, activeWorkspaceSystemKind, sharedFolderNames]);

	const visibleSharedPlacements = React.useMemo(() => {
		// Shared With Me root and Shared With Me subfolders are distinct views.
		// Root shows only placements with no folder assignment; selecting a folder
		// narrows the grid to placements assigned to that specific folder name.
		if (activeWorkspaceSystemKind !== 'SHARED_WITH_ME') return sharedPlacements;
		if (!activeSharedFolder) {
			return sharedPlacements.filter((placement) => !String(placement.folderName || '').trim());
		}
		return sharedPlacements.filter((placement) => String(placement.folderName || '').trim() === activeSharedFolder);
	}, [activeSharedFolder, activeWorkspaceSystemKind, sharedPlacements]);

	const activeWorkspaceSidebarPath = React.useMemo(() => {
		const workspaceLabel = activeWorkspaceName || t('workspace.unnamed');
		if (activeWorkspaceSystemKind === 'SHARED_WITH_ME' && activeSharedFolder) {
			return `${workspaceLabel} / ${activeSharedFolder}`;
		}
		return workspaceLabel;
	}, [activeSharedFolder, activeWorkspaceName, activeWorkspaceSystemKind, t]);

	React.useEffect(() => {
		setNoteGridCollaboratorFilter(null);
	}, [activeSharedFolder, authWorkspaceId, sidebarView]);

	const noteGridScopeLabel = React.useMemo(() => {
		if (noteGridCollaboratorFilter) {
			return `${t('app.withFilterPrefix')}: ${noteGridCollaboratorFilter.label}`;
		}
		if (sidebarView === 'archive') {
			return `${t('app.sidebarArchive')} / ${activeWorkspaceSidebarPath}`;
		}
		if (sidebarView === 'trash') {
			return `${t('app.sidebarTrash')} / ${activeWorkspaceSidebarPath}`;
		}
		return `All notes / ${activeWorkspaceSidebarPath}`;
	}, [activeWorkspaceSidebarPath, noteGridCollaboratorFilter, sidebarView, t]);

	const sharedWithMeWorkspaceId = React.useMemo(() => {
		const sharedWorkspace = sidebarWorkspaces.find((workspace) => workspace.systemKind === 'SHARED_WITH_ME');
		return sharedWorkspace?.id ?? null;
	}, [sidebarWorkspaces]);

	const loadSidebarWorkspaces = React.useCallback(async (): Promise<void> => {
		if (sidebarWorkspacesBusy) return;
		if (authStatus !== 'authed') return;
		setSidebarWorkspacesBusy(true);
		setSidebarWorkspacesError(null);
		let hasCachedWorkspaces = false;
		if (authUserId) {
			const cached = await readCachedWorkspaceSnapshot(authUserId, deviceId);
			if (cached.workspaces.length > 0) {
				hasCachedWorkspaces = true;
				setSidebarWorkspaces(cached.workspaces);
			}
			if (typeof navigator !== 'undefined' && navigator.onLine === false) {
				setSidebarWorkspacesBusy(false);
				return;
			}
		}
		try {
			const res = await fetch(`/api/workspaces?deviceId=${encodeURIComponent(deviceId)}`,
				{ credentials: 'include' }
			);
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				const msg = body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
				throw new Error(msg);
			}
			const next = mapWorkspaceList(body && Array.isArray(body.workspaces) ? body.workspaces : []);
			const nextActiveWorkspaceId = body && typeof body.activeWorkspaceId === 'string' ? String(body.activeWorkspaceId) : null;
			let resolvedWorkspaces = next;
			let resolvedActiveWorkspaceId = nextActiveWorkspaceId;
			if (authUserId) {
				await cacheWorkspaceSnapshot({
					userId: authUserId,
					deviceId,
					activeWorkspaceId: nextActiveWorkspaceId,
					workspaces: next,
				});
				const merged = await readCachedWorkspaceSnapshot(authUserId, deviceId);
				resolvedWorkspaces = merged.workspaces;
				resolvedActiveWorkspaceId = merged.activeWorkspaceId;
				setSidebarWorkspaces(merged.workspaces);
			} else {
				setSidebarWorkspaces(next);
			}
			const activeWorkspaceMissing = Boolean(
				authWorkspaceId && !resolvedWorkspaces.some((workspace) => workspace.id === authWorkspaceId)
			);
			if (activeWorkspaceMissing) {
				handleRemoteWorkspaceRemoval({
					nextActiveWorkspaceId: resolvedActiveWorkspaceId,
					hasOtherWorkspaces: resolvedWorkspaces.length > 0,
				});
			} else if (!authWorkspaceId && resolvedActiveWorkspaceId) {
				handleWorkspaceActivatedRef.current(resolvedActiveWorkspaceId);
			}
		} catch (err) {
			if (!hasCachedWorkspaces) {
				setSidebarWorkspacesError(err instanceof Error ? err.message : t('workspace.loadFailed'));
			}
		} finally {
			setSidebarWorkspacesBusy(false);
		}
	}, [authStatus, authUserId, authWorkspaceId, deviceId, handleRemoteWorkspaceRemoval, sidebarWorkspacesBusy, t]);

	const loadSidebarWorkspacesRef = React.useRef(loadSidebarWorkspaces);

	React.useEffect(() => {
		loadSidebarWorkspacesRef.current = loadSidebarWorkspaces;
	}, [loadSidebarWorkspaces]);

	const refreshNoteShareState = React.useCallback(async (): Promise<void> => {
		// This is the single reconciliation point for collaboration UI state:
		// - replay queued accept/decline actions once connectivity returns
		// - refresh the notification badge/modal contents
		// - refresh alias-mounted shared note placements for the grid/sidebar
		if (authStatus !== 'authed' || !authUserId) {
			setSharedPlacements([]);
			setFailedLinkNotifications([]);
			setPendingShareNotificationCount(0);
			return;
		}
		const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
		if (!offline) {
			try {
				await flushPendingCollaboratorActions(authUserId);
			} catch {
				// Keep collaborator queue failures isolated from the rest of the share refresh.
			}
			try {
				await flushPendingNoteShareActions(authUserId);
			} catch {
				// Keep the queue intact if a replay request fails.
			}
		}
		try {
			const [invitationData, placementData, workspaceInviteData, failedLinkData] = await Promise.all([
				listNoteShareInvitations(),
				authWorkspaceId ? listSharedNotePlacements(authWorkspaceId) : Promise.resolve({ placements: [] }),
				listWorkspacePendingInvites(),
				listFailedNoteLinks().catch(() => ({ failures: [], count: 0 })),
			]);
			setFailedLinkNotifications(failedLinkData.failures);
			setPendingShareNotificationCount(invitationData.pendingCount + workspaceInviteData.invites.length + failedLinkData.count);
			setSharedPlacements(placementData.placements);
		} catch {
			if (!offline) {
				setSharedPlacements([]);
				setFailedLinkNotifications([]);
				setPendingShareNotificationCount(0);
			}
		}
	}, [authStatus, authUserId, authWorkspaceId]);

	React.useEffect(() => {
		if (externalRoute?.kind !== 'share') {
			setShareRouteState({
				status: 'idle',
				message: null,
				label: null,
				entityType: null,
				openWorkspaceId: null,
				openNoteId: null,
			});
			return;
		}
		if (authStatus !== 'authed') return;
		if (authOfflineMode || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
			setShareRouteState({
				status: 'error',
				message: 'Share links must be opened while online.',
				label: null,
				entityType: null,
				openWorkspaceId: null,
				openNoteId: null,
			});
			return;
		}

		let cancelled = false;
		setShareRouteState({
			status: 'loading',
			message: null,
			label: null,
			entityType: null,
			openWorkspaceId: null,
			openNoteId: null,
		});

		void (async () => {
			try {
				const [metadata, accepted] = await Promise.all([
					getShareTokenMetadata(externalRoute.token),
					acceptShareToken(externalRoute.token),
				]);
				if (cancelled) return;
				const entityType = accepted.entityType;
				const label = metadata.label || accepted.title || accepted.workspaceName || (entityType === 'workspace' ? 'Workspace' : 'Note');
				setShareRouteState({
					status: 'ready',
					message: accepted.status === 'already-has-access'
						? `You already have access to ${label}.`
						: `${entityType === 'workspace' ? 'Workspace' : 'Note'} access granted for ${label}.`,
					label,
					entityType,
					openWorkspaceId: entityType === 'workspace' ? accepted.workspaceId ?? null : accepted.targetWorkspaceId ?? null,
					openNoteId: entityType === 'note' ? accepted.placementAliasId || accepted.sourceNoteId || null : null,
				});
				void loadSidebarWorkspacesRef.current();
				void refreshNoteShareStateRef.current();
				setCollaborationRefreshToken((value) => value + 1);
			} catch (err) {
				if (cancelled) return;
				setShareRouteState({
					status: 'error',
					message: err instanceof Error ? err.message : 'Unable to open share link.',
					label: null,
					entityType: null,
					openWorkspaceId: null,
					openNoteId: null,
				});
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [authOfflineMode, authStatus, externalRoute, shareAttemptKey]);

	const refreshNoteShareStateRef = React.useRef(refreshNoteShareState);
	const bumpCollaborationRefreshToken = React.useCallback(() => {
		setCollaborationRefreshToken((value) => value + 1);
	}, []);

	React.useEffect(() => {
		refreshNoteShareStateRef.current = refreshNoteShareState;
	}, [refreshNoteShareState]);

	React.useEffect(() => {
		void refreshNoteShareState();
	}, [refreshNoteShareState]);

	React.useEffect(() => {
		if (authStatus !== 'authed') {
			manager.setExternalRoomAliases({});
			return;
		}
		const aliases = Object.fromEntries(sharedPlacements.map((placement) => [placement.aliasId, placement.roomId]));
		manager.setExternalRoomAliases(aliases);
	}, [authStatus, manager, sharedPlacements]);

	React.useEffect(() => {
		if (authStatus !== 'authed' || authOfflineMode || !authUserId) {
			return;
		}
		if (typeof window === 'undefined') {
			return;
		}

		let disposed = false;
		let socket: WebSocket | null = null;
		let reconnectTimer: number | null = null;
		const pendingNoteMediaTimers = new Map<string, number>();

		const clearReconnectTimer = () => {
			if (reconnectTimer !== null) {
				window.clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
		};

		const clearPendingNoteMediaTimers = () => {
			for (const timer of pendingNoteMediaTimers.values()) {
				window.clearTimeout(timer);
			}
			pendingNoteMediaTimers.clear();
		};

		const refreshWorkspaceMetadata = () => {
			// Fan-out refresh for sidebar + active workspace label after websocket nudges.
			void loadSidebarWorkspacesRef.current();
			void refreshActiveWorkspaceRef.current();
			void refreshNoteShareStateRef.current();
			bumpCollaborationRefreshToken();
		};

		const scheduleReconnect = () => {
			if (disposed || reconnectTimer !== null) return;
			if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
			reconnectTimer = window.setTimeout(() => {
				reconnectTimer = null;
				connect();
			}, 2000);
		};

		const connect = () => {
			if (disposed || socket) return;
			if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
			// Dedicated metadata websocket: lightweight event channel that tells the app when
			// workspace lists/active workspace state may have changed on another tab/device.
			const url = new URL('/ws/metadata', window.location.href);
			url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			const nextSocket = new WebSocket(url.toString());
			socket = nextSocket;

			nextSocket.addEventListener('open', () => {
				clearReconnectTimer();
				refreshWorkspaceMetadata();
			});

			nextSocket.addEventListener('message', (event) => {
				try {
					const payload = JSON.parse(String(event.data || '')) as {
						type?: string;
						reason?: string;
						workspaceId?: string | null;
							docId?: string | null;
					};
					const isNoteShareMetadataEvent = payload.type === 'workspace-metadata-changed'
						&& typeof payload.reason === 'string'
						&& payload.reason.startsWith('note-share-');
						const isNoteMediaMetadataEvent = payload.type === 'workspace-metadata-changed'
							&& typeof payload.reason === 'string'
							&& payload.reason.startsWith('note-media-');
					if (
						payload.type === 'workspace-metadata-changed' &&
						payload.reason === 'workspace-deleted' &&
						typeof payload.workspaceId === 'string'
					) {
						handleRemoteWorkspaceDeletedEventRef.current(payload.workspaceId);
					}
					if (
						payload.type === 'workspace-metadata-ready' ||
						payload.type === 'workspace-metadata-changed'
					) {
						if (
							payload.type === 'workspace-metadata-changed' &&
							typeof payload.workspaceId === 'string' &&
							typeof window.dispatchEvent === 'function'
						) {
							window.dispatchEvent(
								new CustomEvent(getWorkspaceInviteStateEventName(), {
									detail: { workspaceId: payload.workspaceId },
								})
							);
						}
						if (isNoteMediaMetadataEvent && typeof payload.docId === 'string') {
							const existingTimer = pendingNoteMediaTimers.get(payload.docId);
							if (existingTimer) {
								window.clearTimeout(existingTimer);
							}
							// Offline replay can emit one websocket event per image. Batch them per
							// note so other clients refresh the chip once instead of repainting the
							// workspace UI repeatedly during large delete bursts.
							const timer = window.setTimeout(() => {
								pendingNoteMediaTimers.delete(payload.docId as string);
								emitNoteMediaChanged(payload.docId as string);
							}, 150);
							pendingNoteMediaTimers.set(payload.docId, timer);
							return;
						}
						if (
							payload.type === 'workspace-metadata-changed' &&
							typeof payload.docId === 'string' &&
							authUserId &&
							!isNoteMediaMetadataEvent
						) {
							void syncNoteShareCollaborators(authUserId, payload.docId, { suppressError: true });
						}
						if (isNoteShareMetadataEvent) {
							void refreshNoteShareStateRef.current();
							bumpCollaborationRefreshToken();
							return;
						}
						refreshWorkspaceMetadata();
					}
				} catch {
					// Ignore malformed websocket payloads.
				}
			});

			nextSocket.addEventListener('close', () => {
				if (socket === nextSocket) {
					socket = null;
				}
				scheduleReconnect();
			});

			nextSocket.addEventListener('error', () => {
				// Browsers will emit a follow-up close event for failed websocket handshakes.
				// Avoid calling close() while the socket is still CONNECTING because that
				// produces a noisy "closed before the connection is established" console warning.
				if (nextSocket.readyState !== WebSocket.OPEN) {
					return;
				}
				try {
					nextSocket.close();
				} catch {
					// Ignore close failures on errored socket.
				}
			});
		};

		const handleOnline = () => {
			if (socket) return;
			clearReconnectTimer();
			connect();
		};

		connect();
		window.addEventListener('online', handleOnline);

		return () => {
			disposed = true;
			window.removeEventListener('online', handleOnline);
			clearReconnectTimer();
			clearPendingNoteMediaTimers();
			const activeSocket = socket;
			socket = null;
			if (activeSocket) {
				try {
					activeSocket.close();
				} catch {
					// Ignore close failures during cleanup.
				}
			}
		};
	}, [authOfflineMode, authStatus, authUserId]);

	const sidebarWorkspacesSorted = React.useMemo(() => {
		if (!authWorkspaceId) return sidebarWorkspaces;
		const active = sidebarWorkspaces.find((ws) => ws.id === authWorkspaceId);
		if (!active) return sidebarWorkspaces;
		const rest = sidebarWorkspaces.filter((ws) => ws.id !== authWorkspaceId);
		return [active, ...rest];
	}, [authWorkspaceId, sidebarWorkspaces]);

	const activateWorkspaceFromSidebar = React.useCallback(
		async (workspaceId: string, options?: { activeSharedFolder?: string | null }): Promise<void> => {
			if (authStatus !== 'authed') return;
			if (workspaceId === authWorkspaceId) return;
			const nextSharedFolder = options?.activeSharedFolder ?? null;
			if (authUserId && (authOfflineMode || (typeof navigator !== 'undefined' && navigator.onLine === false))) {
				await cacheActiveWorkspaceSelection({
					userId: authUserId,
					deviceId,
					activeWorkspaceId: workspaceId,
					activeSharedFolder: nextSharedFolder,
				});
				handleWorkspaceActivated(workspaceId);
				if (isMobileViewport) {
					closeWorkspaceSidebarGroup();
				}
				if (isMobileViewport) closeMobileSidebar();
				return;
			}
			try {
				const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/activate`, {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ deviceId }),
				});
				const body = await res.json().catch(() => null);
				if (!res.ok) {
					const msg = body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
					throw new Error(msg);
				}
				await confirmActivatedWorkspaceSession(workspaceId);
				await loadSidebarWorkspacesRef.current();
				handleWorkspaceActivated(workspaceId);
				void persistSharedWorkspaceSelection(workspaceId, nextSharedFolder);
				if (isMobileViewport) {
					closeWorkspaceSidebarGroup();
				}
				if (isMobileViewport) closeMobileSidebar();
			} catch {
				if (authUserId) {
					const cached = await readCachedWorkspaceSnapshot(authUserId, deviceId);
					if (cached.workspaces.some((workspace) => workspace.id === workspaceId)) {
						await cacheActiveWorkspaceSelection({
							userId: authUserId,
							deviceId,
							activeWorkspaceId: workspaceId,
							activeSharedFolder: nextSharedFolder,
						});
						handleWorkspaceActivated(workspaceId);
						if (isMobileViewport) {
							closeWorkspaceSidebarGroup();
						}
						if (isMobileViewport) closeMobileSidebar();
						return;
					}
				}
				// Keep errors out of the sidebar nav — Workspace modal provides richer error UX.
			}
		},
		[authOfflineMode, authStatus, authUserId, authWorkspaceId, closeMobileSidebar, closeWorkspaceSidebarGroup, confirmActivatedWorkspaceSession, deviceId, handleWorkspaceActivated, isMobileViewport, manager, persistSharedWorkspaceSelection]
	);

	const handleAcceptedSharedPlacement = React.useCallback(async (args: { target: 'personal' | 'shared'; targetWorkspaceId: string; folderName: string | null }) => {
		// Accepting into Shared With Me can require a workspace switch plus a sidebar
		// reveal. We stage the reveal first, then let the activation path complete and
		// the follow-up effect expands the correct folder once placements are loaded.
		setIsShareNotificationsOpen(false);
		if (args.target !== 'shared' || !args.targetWorkspaceId) return;
		setPendingSharedFolderReveal({
			workspaceId: args.targetWorkspaceId,
			folderName: args.folderName,
		});
		if (args.targetWorkspaceId !== authWorkspaceId) {
			await activateWorkspaceFromSidebar(args.targetWorkspaceId, { activeSharedFolder: args.folderName });
		}
	}, [activateWorkspaceFromSidebar, authWorkspaceId]);

	React.useEffect(() => {
		if (pendingRestoredSharedFolder === false) return;
		if (!authWorkspaceId) {
			setPendingRestoredSharedFolder(false);
			return;
		}
		const activeWorkspace = sidebarWorkspaces.find((workspace) => workspace.id === authWorkspaceId);
		if (!activeWorkspace) return;
		if (activeWorkspace.systemKind !== 'SHARED_WITH_ME') {
			setPendingRestoredSharedFolder(false);
			return;
		}
		const nextFolder = String(pendingRestoredSharedFolder || '').trim();
		if (nextFolder) {
			setPendingSharedFolderReveal({ workspaceId: authWorkspaceId, folderName: nextFolder });
		} else {
			setActiveSharedFolder(null);
		}
		setPendingRestoredSharedFolder(false);
	}, [authWorkspaceId, pendingRestoredSharedFolder, sidebarWorkspaces]);

	React.useEffect(() => {
		// Switching away from registration should clear any staged avatar/crop state
		// so we don't accidentally upload a stale image on a later register attempt.
		if (authMode !== 'register') {
			setRegisterAvatarUrl(null);
			setRegisterAvatarAreaPixels(null);
		}
	}, [authMode]);

	React.useEffect(() => {
		// Prevent object URL leaks when the chosen avatar file changes or when the
		// component unmounts.
		return () => {
			if (registerAvatarUrl) URL.revokeObjectURL(registerAvatarUrl);
		};
	}, [registerAvatarUrl]);

	const submitAuth = React.useCallback(async () => {
		// Handles both login + register.
		// On successful registration, optionally uploads the cropped avatar as a
		// follow-up step. We then call /api/auth/me to populate the canonical user
		// fields (including profileImage) and ensure the UI updates immediately.
		if (authBusy) return;
		if (authMode === 'register') {
			// Keep the pre-submit checks aligned with the shared password policy so the
			// user gets immediate feedback before the registration request round-trip.
			if (authPassword !== authPasswordConfirm) {
				setAuthError('Passwords do not match');
				return;
			}
			if (authPasswordStrengthScore < 2) {
				setAuthError('Password is too weak');
				return;
			}
		}
		setAuthBusy(true);
		setAuthError(null);
		try {
			const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
			let resolvedWorkspaceId: string | null = null;
			let resolvedUserId: string | null = null;
			let resolvedProfileImage: string | null = null;
			let sessionEstablished = false;
			const payload: any = {
				email: authEmail,
				password: authPassword,
			};
			if (authMode === 'register') payload.name = authName;

			const res = await fetch(endpoint, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});

			if (!res.ok) {
				let message = 'Authentication failed';
				try {
					const body = await res.json();
					if (body && typeof body.error === 'string') message = body.error;
				} catch {
					// ignore
				}
				setAuthError(message);
				setAuthStatus('unauth');
				manager.setWebsocketEnabled(false);
				return;
			}

			const authBody = await res.json().catch(() => null);
			const authUserId = authBody?.user?.id ? String(authBody.user.id) : null;
			const authWorkspaceId = authBody?.workspaceId
				? String(authBody.workspaceId)
				: authBody?.workspace?.id
					? String(authBody.workspace.id)
					: null;
			const authProfileImageFromResponse = authBody?.user?.profileImage ? String(authBody.user.profileImage) : null;
			resolvedUserId = authUserId;
			resolvedWorkspaceId = authWorkspaceId;
			resolvedProfileImage = authProfileImageFromResponse;

			// Optional post-register avatar upload.
			// This is separate from the register endpoint so registration remains a
			// small JSON API and uploads are handled via multipart.
			if (authMode === 'register' && registerAvatarUrl && registerAvatarAreaPixels) {
				try {
					const blob = await getCroppedSquareBlob(registerAvatarUrl, registerAvatarAreaPixels, 256);
					const form = new FormData();
					form.append('file', blob, 'avatar.png');
					const uploadRes = await fetch('/api/user/profile-image', {
						method: 'POST',
						credentials: 'include',
						body: form,
					});
					// Fetch does not throw on non-2xx; enforce it explicitly.
					if (!uploadRes.ok) throw new Error('Upload failed');
					const uploadBody = await uploadRes.json().catch(() => null);
					const profileImage = uploadBody?.profileImage ? String(uploadBody.profileImage) : null;
					if (profileImage) {
						resolvedProfileImage = profileImage;
					}
				} catch {
					setAuthError('Account created, but profile photo upload failed');
				}
			}

			// Re-fetch /me so we always sync to the server's truth. This keeps behavior
			// consistent if server-side bootstrap logic updates role/workspace.
			try {
				const meRes = await fetch(`/api/auth/me?deviceId=${encodeURIComponent(deviceId)}`, {
					credentials: 'include',
				});
				const contentType = String(meRes.headers.get('content-type') || '').toLowerCase();
				if (meRes.ok && contentType.includes('application/json')) {
					const meBody = await meRes.json().catch(() => null);
					const userId = meBody?.user?.id ? String(meBody.user.id) : null;
					const profileImage = meBody?.user?.profileImage ? String(meBody.user.profileImage) : null;
					const workspaceId = meBody?.workspaceId ? String(meBody.workspaceId) : null;
					if (userId) {
						resolvedUserId = userId;
						resolvedWorkspaceId = workspaceId;
						resolvedProfileImage = profileImage;
						sessionEstablished = true;
					}
				}
			} catch {
				// ignore
			}

			if (!sessionEstablished || !resolvedUserId) {
				setAuthUserId(null);
				setAuthProfileImage(null);
				setAuthWorkspaceId(null);
				setAuthOfflineMode(false);
				setAuthStatus('unauth');
				manager.setActiveWorkspaceId(null);
				manager.setWebsocketEnabled(false);
				setAuthError('Login succeeded, but the server session was not established. Check the production cookie and reverse-proxy setup, then try again.');
				return;
			}

			setAuthUserId(resolvedUserId);
			setAuthProfileImage(resolvedProfileImage);
			setAuthWorkspaceId(resolvedWorkspaceId);
			setAuthStatus('authed');
			setAuthOfflineMode(false);
			manager.setActiveWorkspaceId(resolvedWorkspaceId);
			writeAuthCache({ v: 1, userId: resolvedUserId, workspaceId: resolvedWorkspaceId, profileImage: resolvedProfileImage });
			manager.setWebsocketEnabled(Boolean(resolvedWorkspaceId));
		} catch {
			setAuthError('Authentication failed');
			setAuthStatus('unauth');
			manager.setWebsocketEnabled(false);
		} finally {
			setAuthBusy(false);
		}
	}, [authBusy, authEmail, authMode, authName, authPassword, authPasswordConfirm, authPasswordStrengthScore, manager, registerAvatarAreaPixels, registerAvatarUrl]);

	const authGateView = (
		<div className="auth-shell">
			<div className="auth-card">
				<div className="auth-title">FreemanNotes</div>
				<div className="auth-subtitle">
					{externalRoute?.kind === 'invite'
						? t('invite.authPrompt')
						: externalRoute?.kind === 'share'
							? 'Sign in to open this shared item.'
						: authStatus === 'loading'
							? 'Checking session…'
							: 'Sign in to enable sync'}
				</div>
				{externalRoute?.kind === 'invite' ? <div className="auth-hint">{t('invite.emailMatchNotice')}</div> : null}
				{externalRoute?.kind === 'share' ? <div className="auth-hint">Share links require an authenticated account before access is applied.</div> : null}
				<div className="auth-mode-row">
					<button
						type="button"
						className={authMode === 'login' ? 'auth-mode is-active' : 'auth-mode'}
						onClick={() => {
							setAuthMode('login');
								setAuthPasswordConfirm('');
							setAuthError(null);
						}}
						disabled={authBusy || authStatus === 'loading'}
					>
						Login
					</button>
					<button
						type="button"
						className={authMode === 'register' ? 'auth-mode is-active' : 'auth-mode'}
						onClick={() => {
							setAuthMode('register');
								setAuthPasswordConfirm('');
							setAuthError(null);
						}}
						disabled={authBusy || authStatus === 'loading'}
					>
						Register
					</button>
				</div>
				<form
					className="auth-form"
					onSubmit={(e) => {
						e.preventDefault();
						void submitAuth();
					}}
				>
					<label className="auth-label">
						Email
						<input
							type="email"
							autoComplete="email"
							value={authEmail}
							onChange={(e) => setAuthEmail(e.target.value)}
							disabled={authBusy || authStatus === 'loading'}
							required
						/>
					</label>
					{authMode === 'register' ? (
						<label className="auth-label">
							Name
							<input
								type="text"
								autoComplete="name"
								value={authName}
								onChange={(e) => setAuthName(e.target.value)}
								disabled={authBusy || authStatus === 'loading'}
								required
							/>
						</label>
					) : null}
					{authMode === 'register' ? (
						<div className="auth-avatar">
							<label className="auth-label">
								Profile photo (optional)
								<input
									type="file"
									accept="image/*"
									disabled={authBusy || authStatus === 'loading'}
									onChange={(e) => {
										const file = e.currentTarget.files && e.currentTarget.files[0] ? e.currentTarget.files[0] : null;
										if (!file) {
											setRegisterAvatarUrl(null);
											setRegisterAvatarAreaPixels(null);
											return;
										}
										const url = URL.createObjectURL(file);
										setRegisterAvatarUrl(url);
										setRegisterAvatarZoom(1);
										setRegisterAvatarCrop({ x: 0, y: 0 });
										setRegisterAvatarAreaPixels(null);
									}}
								/>
							</label>
							{registerAvatarUrl ? (
								<div className="auth-avatar-crop">
									<div className="auth-avatar-cropper">
										<Cropper
											image={registerAvatarUrl}
											crop={registerAvatarCrop}
											zoom={registerAvatarZoom}
											aspect={1}
											onCropChange={setRegisterAvatarCrop}
											onZoomChange={setRegisterAvatarZoom}
											onCropComplete={(_area, areaPixels) => {
												setRegisterAvatarAreaPixels({
													width: areaPixels.width,
													height: areaPixels.height,
													x: areaPixels.x,
													y: areaPixels.y,
												});
											}}
										/>
									</div>
									<label className="auth-avatar-zoom">
										Zoom
										<input
											type="range"
											min={1}
											max={3}
											step={0.1}
											value={registerAvatarZoom}
											onChange={(e) => setRegisterAvatarZoom(Number(e.target.value))}
											disabled={authBusy || authStatus === 'loading'}
										/>
									</label>
								</div>
							) : null}
						</div>
					) : null}
					<label className="auth-label">
						Password
						<input
							type="password"
							autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
							value={authPassword}
							onChange={(e) => setAuthPassword(e.target.value)}
							disabled={authBusy || authStatus === 'loading'}
							required
						/>
					</label>
					{authMode === 'register' ? (
						<>
							<div className="auth-password-strength" aria-live="polite">
								<div className="auth-password-strength-bar" aria-hidden="true">
									<span className={`auth-password-strength-fill auth-password-strength-${authPasswordStrengthLabel.toLowerCase()}`} style={{ width: `${Math.max(8, authPasswordStrengthScore * 25)}%` }} />
								</div>
								<div className="auth-password-strength-copy">Password strength: {authPasswordStrengthLabel}</div>
							</div>
							<label className="auth-label">
								Confirm password
								<input
									type="password"
									autoComplete="new-password"
									value={authPasswordConfirm}
									onChange={(e) => setAuthPasswordConfirm(e.target.value)}
									disabled={authBusy || authStatus === 'loading'}
									required
								/>
							</label>
							{authPasswordConfirm && authPassword !== authPasswordConfirm ? <div className="auth-error">Passwords do not match</div> : null}
						</>
					) : null}
					{authError ? <div className="auth-error">{authError}</div> : null}
					<button type="submit" disabled={authBusy || authStatus === 'loading'}>
						{authBusy ? 'Please wait…' : authMode === 'register' ? 'Create account' : 'Sign in'}
					</button>
				</form>
				<div className="auth-hint">Sync is disabled until you sign in.</div>
			</div>
		</div>
	);

	const inviteRouteView = (
		<div className="auth-shell">
			<div className="auth-card">
				<div className="auth-title">{t('invite.joinTitle')}</div>
				<div className="auth-subtitle">
					{inviteRouteState.status === 'accepting' ? t('invite.accepting') : t('invite.joinDescription')}
				</div>
				{inviteRouteState.message ? <div className="auth-error">{inviteRouteState.message}</div> : null}
				<div className="auth-mode-row">
					{inviteRouteState.status === 'error' ? (
						<button
							type="button"
							onClick={() => {
								setInviteRouteState({ status: 'idle', message: null });
								setInviteAttemptKey((value) => value + 1);
							}}
						>
							{t('share.refresh')}
						</button>
					) : null}
					<button type="button" onClick={handleExitExternalRoute}>
						{t('share.backToApp')}
					</button>
				</div>
			</div>
		</div>
	);

	const handleOpenSharedEntity = React.useCallback(async () => {
		const targetWorkspaceId = shareRouteState.openWorkspaceId;
		const targetNoteId = shareRouteState.openNoteId;
		if (targetWorkspaceId) {
			if (targetWorkspaceId !== authWorkspaceId) {
				await activateWorkspaceFromSidebar(targetWorkspaceId, { activeSharedFolder: null });
			} else if (activeWorkspaceSystemKind === 'SHARED_WITH_ME') {
				setActiveSharedFolder(null);
				void persistSharedWorkspaceSelection(targetWorkspaceId, null);
			}
		}
		if (targetNoteId) {
			await refreshNoteShareStateRef.current();
			setSidebarView('notes');
			setEditorMode('none');
			setSelectedNoteId(targetNoteId);
		}
		handleExitExternalRoute();
	}, [activateWorkspaceFromSidebar, activeWorkspaceSystemKind, authWorkspaceId, handleExitExternalRoute, persistSharedWorkspaceSelection, shareRouteState.openNoteId, shareRouteState.openWorkspaceId]);

	const shareRouteView = (
		<div className="auth-shell">
			<div className="auth-card">
				<div className="auth-title">{shareRouteState.label || 'Shared item'}</div>
				<div className="auth-subtitle">
					{shareRouteState.status === 'loading'
						? 'Verifying share link…'
						: shareRouteState.entityType === 'workspace'
							? 'Workspace sharing'
							: 'Note sharing'}
				</div>
				{shareRouteState.message ? <div className={shareRouteState.status === 'error' ? 'auth-error' : 'auth-hint'}>{shareRouteState.message}</div> : null}
				<div className="auth-mode-row">
					{shareRouteState.status === 'error' ? (
						<button
							type="button"
							onClick={() => {
								setShareRouteState({
									status: 'idle',
									message: null,
									label: null,
									entityType: null,
									openWorkspaceId: null,
									openNoteId: null,
								});
								setShareAttemptKey((value) => value + 1);
							}}
						>
							{t('share.refresh')}
						</button>
					) : null}
					{shareRouteState.status === 'ready' ? (
						<button type="button" onClick={() => void handleOpenSharedEntity()}>
							Open {shareRouteState.entityType === 'workspace' ? 'workspace' : 'note'}
						</button>
					) : null}
					<button type="button" onClick={handleExitExternalRoute}>
						{t('share.backToApp')}
					</button>
				</div>
			</div>
		</div>
	);

	const themeOptions = React.useMemo(() => {
		return THEMES.map((theme) => ({ id: theme.id, label: t(theme.labelKey) }));
	}, [t]);

	const languageOptions = React.useMemo(() => {
		return locales.map((entry) => ({ code: entry.code, label: entry.label }));
	}, [locales]);

	const fabIconSrc = React.useMemo(() => {
		return isLightTheme(themeId) ? fabIconDark : fabIconLight;
	}, [themeId]);

	const headerIconSrc = React.useMemo(() => {
		return isLightTheme(themeId) ? appIconLight : appIconDark;
	}, [themeId]);

	type SidebarEntry = {
		id: string;
		label: string;
		icon: unknown;
		kind: 'link' | 'group';
	};

	type SidebarSubmenuNode = {
		id: string;
		label: string;
		kind: 'item' | 'heading' | 'muted' | 'action';
	};

	type SidebarSubmenuToggle = {
		id: string;
		label: string;
		items: SidebarSubmenuNode[];
	};

	// Sidebar structure is intentionally data-driven so desktop + mobile share
	// the same ordering, labels, and nested disclosure behavior.

	const sidebarEntries: SidebarEntry[] = React.useMemo(
		() => [
			{ id: 'notes', label: t('app.sidebarNotes'), icon: faFileLines, kind: 'link' },
			{ id: 'workspaces', label: t('workspace.sidebarTitle'), icon: faGrip, kind: 'group' },
			{ id: 'collections', label: t('app.sidebarCollections'), icon: faFolder, kind: 'group' },
			{ id: 'labels', label: t('app.sidebarLabels'), icon: faTag, kind: 'group' },
			{ id: 'sorting', label: t('app.sidebarSorting'), icon: faArrowDownWideShort, kind: 'group' },
			{ id: 'reminders', label: t('app.sidebarReminders'), icon: faBell, kind: 'group' },
			{ id: 'images', label: t('app.sidebarImages'), icon: faImage, kind: 'link' },
			{ id: 'archive', label: t('app.sidebarArchive'), icon: faBoxArchive, kind: 'link' },
			{ id: 'trash', label: t('app.sidebarTrash'), icon: faTrash, kind: 'link' },
		],
		[t]
	);

	const sidebarGroupContent = React.useMemo<Record<string, SidebarSubmenuNode[]>>(
		() => ({
			reminders: [
				{ id: 'all', label: t('app.sidebarAll'), kind: 'item' },
				{ id: 'today', label: t('app.sidebarToday'), kind: 'item' },
				{ id: 'this-week', label: t('app.sidebarThisWeek'), kind: 'item' },
				{ id: 'next-week', label: t('app.sidebarNextWeek'), kind: 'item' },
				{ id: 'next-month', label: t('app.sidebarNextMonth'), kind: 'item' },
			],
			labels: [
				{ id: 'no-labels', label: t('app.sidebarNoLabels'), kind: 'muted' },
			],
			collections: [
				{ id: 'manage-collections', label: t('app.sidebarManageCollections'), kind: 'action' },
			],
		}),
		[t]
	);

	const sortingPrimaryItems = React.useMemo<SidebarSubmenuNode[]>(
		() => [
			{ id: 'date-created', label: t('app.sidebarDateCreated'), kind: 'item' },
			{ id: 'date-updated', label: t('app.sidebarDateUpdated'), kind: 'item' },
			{ id: 'alphabetical', label: t('app.sidebarAlphabetical'), kind: 'item' },
		],
		[t]
	);

	const sortingNestedGroups = React.useMemo<SidebarSubmenuToggle[]>(
		() => [
			{
				id: 'sortingFilters',
				label: t('app.sidebarFilters'),
				items: [
					{ id: 'due-soon', label: t('app.sidebarDueSoon'), kind: 'item' },
					{ id: 'least-accessed', label: t('app.sidebarLeastAccessed'), kind: 'item' },
					{ id: 'most-edited', label: t('app.sidebarMostEdited'), kind: 'item' },
					{ id: 'clear', label: t('app.sidebarClear'), kind: 'action' },
				],
			},
			{
				id: 'sortingGrouping',
				label: t('app.sidebarGrouping'),
				items: [
					{ id: 'by-week', label: t('app.sidebarByWeek'), kind: 'item' },
					{ id: 'by-month', label: t('app.sidebarByMonth'), kind: 'item' },
				],
			},
		],
		[t]
	);

	React.useEffect(() => {
		// Lock the page behind the mobile drawer so background content cannot
		// scroll or rubber-band while the sidebar is open.
		//
		// Important: avoid `body { position: fixed }` here. That pattern can cause
		// visible mid-scroll jumps when the drawer opens/closes because the entire
		// document is re-positioned relative to the viewport. An overflow-only lock
		// keeps the current scroll position stable while the backdrop/sidebar absorb
		// interaction above the page content.
		if (!isMobileViewport || !isMobileSidebarOpen || typeof window === 'undefined' || typeof document === 'undefined') return;
		const body = document.body;
		const root = document.documentElement;
		const previous = {
			rootOverflow: root.style.overflow,
			rootOverscrollBehavior: (root.style as CSSStyleDeclaration & { overscrollBehavior?: string }).overscrollBehavior ?? '',
			rootTouchAction: root.style.touchAction,
			overflow: body.style.overflow,
			bodyTouchAction: body.style.touchAction,
			overscrollBehavior: (body.style as CSSStyleDeclaration & { overscrollBehavior?: string }).overscrollBehavior ?? '',
		};
		root.style.overflow = 'hidden';
		(root.style as CSSStyleDeclaration & { overscrollBehavior?: string }).overscrollBehavior = 'none';
		root.style.touchAction = 'none';
		body.style.overflow = 'hidden';
		body.style.touchAction = 'none';
		(body.style as CSSStyleDeclaration & { overscrollBehavior?: string }).overscrollBehavior = 'none';
		return () => {
			root.style.overflow = previous.rootOverflow;
			(root.style as CSSStyleDeclaration & { overscrollBehavior?: string }).overscrollBehavior = previous.rootOverscrollBehavior;
			root.style.touchAction = previous.rootTouchAction;
			body.style.overflow = previous.overflow;
			body.style.touchAction = previous.bodyTouchAction;
			(body.style as CSSStyleDeclaration & { overscrollBehavior?: string }).overscrollBehavior = previous.overscrollBehavior;
		};
	}, [isMobileSidebarOpen, isMobileViewport]);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const mql = window.matchMedia('(pointer: coarse)');
		const onChange = () => setIsMobileViewport(mql.matches);
		onChange();
		// Safari < 14 uses addListener/removeListener
		if (typeof mql.addEventListener === 'function') {
			mql.addEventListener('change', onChange);
			return () => mql.removeEventListener('change', onChange);
		}
		mql.addListener(onChange);
		return () => mql.removeListener(onChange);
	}, []);

	React.useEffect(() => {
		// Keep mobile-only overlays consistent when resizing back to desktop.
		if (!isMobileViewport) {
			setIsMobileSidebarOpen(false);
			setIsMobileSearchOpen(false);
		}
	}, [isMobileViewport]);

	React.useEffect(() => {
		if (!isMobileViewport) return;
		if (!isMobileSearchOpen) return;
		if (isMobileSidebarOpen) {
			setIsMobileSearchOpen(false);
			return;
		}
		if (typeof window === 'undefined') return;
		let raf = 0;
		raf = requestAnimationFrame(() => {
			mobileSearchInputRef.current?.focus();
			mobileSearchInputRef.current?.select();
		});
		return () => cancelAnimationFrame(raf);
	}, [isMobileSearchOpen, isMobileSidebarOpen, isMobileViewport]);

	React.useEffect(() => {
		// Desktop editor overlay offset:
		//
		// On mobile, editors must cover *everything* (including the header/search).
		// On desktop, the desired UX keeps the header and the "create" buttons visible,
		// so editor overlays should start below those controls.
		//
		// We compute an absolute pixel offset from the viewport top by measuring the
		// bottom edge of the sticky top-controls stack. This is written to a CSS variable and
		// consumed by the editor overlay styles.
		if (typeof window === 'undefined') return;
		if (isMobileViewport) return;

		const editorOverlayOpen = editorMode !== 'none' || Boolean(selectedNoteId);
		if (!editorOverlayOpen) {
			document.documentElement.style.removeProperty('--app-editor-top-offset');
			return;
		}

		let raf = 0;
		const compute = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				const actions = topControlsRef.current;
				const header = headerRef.current;
				const headerBottom = header ? Math.round(header.getBoundingClientRect().bottom) : 0;
				let offset = headerBottom;
				if (actions) {
					const rect = actions.getBoundingClientRect();
					// If the actions row is offscreen (user scrolled far down), fall back to header.
					if (rect.bottom > headerBottom + 4) offset = Math.round(rect.bottom);
				}
				// Small breathing room between the buttons row and the editor overlay.
				offset = Math.max(0, offset + 8);
				document.documentElement.style.setProperty('--app-editor-top-offset', `${offset}px`);
			});
		};

		compute();
		window.addEventListener('resize', compute, { passive: true });
		window.addEventListener('scroll', compute, { passive: true });
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener('resize', compute);
			window.removeEventListener('scroll', compute);
			document.documentElement.style.removeProperty('--app-editor-top-offset');
		};
	}, [editorMode, isMobileViewport, selectedNoteId]);

	React.useEffect(() => {
		// Expose current header height as a CSS variable so fixed overlays (editors,
		// mobile drawer) can sit below or above it reliably.
		if (typeof window === 'undefined') return;
		const header = headerRef.current;
		if (!header) return;
		let raf = 0;

		const setVar = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				const height = Math.max(0, Math.round(header.getBoundingClientRect().height));
				document.documentElement.style.setProperty('--app-header-offset', `${height}px`);
			});
		};

		setVar();
		if (typeof (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver === 'function') {
			const ro = new ResizeObserver(() => setVar());
			ro.observe(header);
			return () => {
				cancelAnimationFrame(raf);
				ro.disconnect();
				document.documentElement.style.removeProperty('--app-header-offset');
			};
		}

		window.addEventListener('resize', setVar, { passive: true });
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener('resize', setVar);
			document.documentElement.style.removeProperty('--app-header-offset');
		};
	}, [isMobileLandscape, isMobileViewport]);

	React.useEffect(() => {
		// Best-effort edge-swipe gesture:
		// - Swipe right from the left edge opens the sidebar.
		// Implemented on a dedicated swipe zone to maximize Chrome/Safari consistency.
		if (!isMobileViewport || typeof window === 'undefined') return;
		const zone = mobileSwipeZoneRef.current;
		if (!zone) return;

		let tracking = false;
		let startX = 0;
		let startY = 0;
		const TRIGGER_DX = 42;
		const MAX_DY = 18;

		const onTouchStart = (event: TouchEvent) => {
			if (isMobileSidebarOpen) return;
			if (event.touches.length !== 1) return;
			const touch = event.touches[0];
			startX = touch.clientX;
			startY = touch.clientY;
			tracking = true;
			if (event.cancelable) event.preventDefault();
		};

		const onTouchMove = (event: TouchEvent) => {
			if (!tracking || isMobileSidebarOpen || event.touches.length !== 1) return;
			const touch = event.touches[0];
			const dx = touch.clientX - startX;
			const dy = touch.clientY - startY;
			if (Math.abs(dy) > MAX_DY) return;
			if (dx > TRIGGER_DX) {
				openMobileSidebar();
				tracking = false;
				if (event.cancelable) event.preventDefault();
			}
		};

		const onTouchEnd = () => {
			tracking = false;
		};

		zone.addEventListener('touchstart', onTouchStart, { passive: false });
		zone.addEventListener('touchmove', onTouchMove, { passive: false });
		zone.addEventListener('touchend', onTouchEnd, { passive: true });
		zone.addEventListener('touchcancel', onTouchEnd, { passive: true });
		return () => {
			zone.removeEventListener('touchstart', onTouchStart);
			zone.removeEventListener('touchmove', onTouchMove);
			zone.removeEventListener('touchend', onTouchEnd);
			zone.removeEventListener('touchcancel', onTouchEnd);
		};
	}, [isMobileViewport, isMobileSidebarOpen, openMobileSidebar]);

	React.useEffect(() => {
		if (!isMobileViewport || !isMobileSidebarOpen || typeof window === 'undefined') return;
		const drawer = mobileSidebarRef.current;
		if (!drawer) return;

		let tracking = false;
		let startX = 0;
		let startY = 0;
		const TRIGGER_DX = 54;
		const MAX_DY = 28;

		const onTouchStart = (event: TouchEvent) => {
			if (event.touches.length !== 1) return;
			const touch = event.touches[0];
			startX = touch.clientX;
			startY = touch.clientY;
			tracking = true;
		};

		const onTouchMove = (event: TouchEvent) => {
			if (!tracking || event.touches.length !== 1) return;
			const touch = event.touches[0];
			const dx = touch.clientX - startX;
			const dy = touch.clientY - startY;
			if (Math.abs(dy) > MAX_DY) {
				tracking = false;
				return;
			}
			if (dx < -TRIGGER_DX) {
				tracking = false;
				if (event.cancelable) event.preventDefault();
				closeMobileSidebar();
			}
		};

		const onTouchEnd = () => {
			tracking = false;
		};

		drawer.addEventListener('touchstart', onTouchStart, { passive: true });
		drawer.addEventListener('touchmove', onTouchMove, { passive: false });
		drawer.addEventListener('touchend', onTouchEnd, { passive: true });
		drawer.addEventListener('touchcancel', onTouchEnd, { passive: true });
		return () => {
			drawer.removeEventListener('touchstart', onTouchStart);
			drawer.removeEventListener('touchmove', onTouchMove);
			drawer.removeEventListener('touchend', onTouchEnd);
			drawer.removeEventListener('touchcancel', onTouchEnd);
		};
	}, [closeMobileSidebar, isMobileSidebarOpen, isMobileViewport]);

	React.useEffect(() => {
		// Mobile back button / swipe-back behavior:
		// - If we are on a state that was pushed by the overlay system, apply it.
		// - Otherwise, collapse to the base UI state.
		// - In standalone mode, require a second back press to exit (confirm dialog).
		if (!isMobileViewport || typeof window === 'undefined') return;
		const isStandalone = detectStandaloneDisplayMode();

		const ensureRootGuard = () => {
			if (!isStandalone) return;
			try {
				const guardState: OverlayHistoryState = {
					[OVERLAY_HISTORY_KEY]: true,
					snapshot: EMPTY_OVERLAY_SNAPSHOT,
					kind: 'root',
				};
				window.history.pushState(guardState, '');
			} catch {
				// ignore
			}
		};

		// Arm a root guard so the first back press stays inside the app.
		ensureRootGuard();

		const onPopState = (event: PopStateEvent) => {
			// Clear the rapid-tap guard so the next close gesture can navigate.
			isNavigatingBackRef.current = false;
			const state = event.state as unknown;
			if (isOverlayHistoryState(state)) {
				applyOverlaySnapshot(state.snapshot);
				return;
			}
			if (isNoteImageViewerHistoryState(state) || isNoteEditorMediaDockHistoryState(state)) {
				return;
			}

			// If we popped to a non-overlay history entry, collapse to base.
			applyOverlaySnapshot(EMPTY_OVERLAY_SNAPSHOT);
			if (!isStandalone) return;

			const now = Date.now();
			const thresholdMs = 1500;
			const ref = exitBackPressRef.current;
			if (now - ref.lastAt > thresholdMs) ref.count = 0;
			ref.lastAt = now;
			ref.count += 1;

			if (ref.count === 1) {
				window.alert('Press back again to exit');
				ensureRootGuard();
				return;
			}

			if (ref.count >= 2) {
				ref.count = 0;
				const ok = window.confirm('Exit the app?');
				if (ok) {
					window.history.back();
					return;
				}
			}

			ensureRootGuard();
		};
		window.addEventListener('popstate', onPopState);
		return () => {
			window.removeEventListener('popstate', onPopState);
		};
	}, [applyOverlaySnapshot, isMobileViewport]);

	React.useEffect(() => {
		// Keep card max-height token in sync with responsive desktop/mobile defaults.
		const root = document.documentElement;
		root.style.setProperty('--note-card-max-height', `${maxCardHeightPx}px`);
		return () => {
			root.style.removeProperty('--note-card-max-height');
		};
	}, [maxCardHeightPx]);

	React.useEffect(() => {
		// When an editor is open, the rest of the app should be visually/background-inactive.
		// The editor overlay blocks clicks; this additionally prevents background scroll
		// (wheel/trackpad) on desktop and elastic scroll on mobile.
		if (typeof document === 'undefined') return;
		const editorOpen = editorMode !== 'none' || Boolean(selectedNoteId);
		if (!editorOpen) return;

		const prevOverflow = document.body.style.overflow;
		const prevOverscroll = (document.body.style as unknown as { overscrollBehavior?: string }).overscrollBehavior;
		document.body.style.overflow = 'hidden';
		(document.body.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = 'none';
		return () => {
			document.body.style.overflow = prevOverflow;
			(document.body.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = prevOverscroll || '';
		};
	}, [editorMode, selectedNoteId]);

	const onSaveText = React.useCallback(
		async (args: { title: string; body: string; richContent: import('@tiptap/core').JSONContent; previewLinks: string[] }) => {
			if (!canEditActiveWorkspace) {
				showBriefDialog(t('share.roleViewer'));
				closeCreateEditor();
				return;
			}
			// Empty note guard:
			// It's possible to create a new note and hit save without typing anything.
			// In that case we do NOT create a note ID, do NOT create a Yjs doc, and do
			// NOT add anything to the registry — the note is discarded entirely.
			const titleTrimmed = args.title.trim();
			const bodyTrimmed = args.body.trim();
			if (titleTrimmed.length === 0 && bodyTrimmed.length === 0) {
				showBriefDialog('empty note discarded');
				closeCreateEditor();
				return;
			}

			// All note creation goes through the canonical noteModel factory functions.
			const id = makeNoteId('text-note');
			const doc = await manager.getDocWithSync(id);
			initTextNoteDoc(doc, args.title, args.body, args.richContent, args.previewLinks);
			await manager.createNote(id, args.title);
			// Branch: after create/save, close the new-note editor and return to grid.
			// We intentionally do NOT auto-open the saved note editor here.
			closeCreateEditor();
		},
		[canEditActiveWorkspace, closeCreateEditor, manager, showBriefDialog, t]
	);

	const onSaveChecklist = React.useCallback(
		async (args: { title: string; items: Array<ChecklistItem & { richContent: import('@tiptap/core').JSONContent }>; previewLinks: string[] }) => {
			if (!canEditActiveWorkspace) {
				showBriefDialog(t('share.roleViewer'));
				closeCreateEditor();
				return;
			}
			// Checklist save cleanup:
			// - Remove blank rows before persisting (both active + completed).
			// - If the checklist is truly empty (no title AND no row text), discard it
			//   without creating a Yjs doc or registry entry.
			const cleanedItems = args.items
				.map((item) => ({ ...item, text: String(item.text ?? '') }))
				.filter((item) => item.text.trim().length > 0);
			const titleTrimmed = args.title.trim();
			if (titleTrimmed.length === 0 && cleanedItems.length === 0) {
				showBriefDialog('empty checklist discarded');
				closeCreateEditor();
				return;
			}

			// All note creation goes through the canonical noteModel factory functions.
			const id = makeNoteId('checklist-note');
			const doc = await manager.getDocWithSync(id);
			initChecklistNoteDoc(doc, args.title, cleanedItems, args.previewLinks);
			await manager.createNote(id, args.title);
			// Branch: after create/save, close the new-checklist editor and return to grid.
			// We intentionally do NOT auto-open the saved note editor here.
			closeCreateEditor();
		},
		[canEditActiveWorkspace, closeCreateEditor, manager, showBriefDialog, t]
	);

	const onDeleteSelectedNote = React.useCallback(
		async (noteId: string) => {
			const placement = sharedPlacements.find((item) => item.aliasId === noteId);
			if ((placement && placement.role === 'VIEWER') || (!placement && !canEditActiveWorkspace)) {
				showBriefDialog(t('share.roleViewer'));
				return;
			}
			// Soft-delete: mark as trashed in the Yjs metadata. The note stays
			// in the registry and order arrays but is hidden from the main grid.
			// Server-side cleanup permanently removes it after deleteAfterDays.
			await manager.trashNote(noteId);
			setSelectedNoteId((prev) => (prev === noteId ? null : prev));
			setOpenDocId((prevId) => {
				if (prevId !== noteId) return prevId;
				setOpenDoc(null);
				return null;
			});
		},
		[canEditActiveWorkspace, manager, sharedPlacements, showBriefDialog, t]
	);

	React.useEffect(() => {
		let cancelled = false;
		// Branch: nothing selected.
		if (!selectedNoteId) {
			setOpenDoc(null);
			setOpenDocId(null);
			return;
		}

		(async () => {
			// Offline-first open: return as soon as IndexedDB-hydrated doc is ready.
			// WebSocket sync wiring is established by DocumentManager in parallel.
			const doc = await manager.getDocWithSync(selectedNoteId);
			if (cancelled) return;
			setOpenDoc(doc);
			setOpenDocId(selectedNoteId);
		})().catch((err) => {
			console.error('[CRDT] Failed to open note:', err);
		});

		return () => {
			cancelled = true;
		};
	}, [manager, selectedNoteId]);

	const sidebarIsCollapsed = !isMobileViewport && isSidebarCollapsed;
	const collapseAllSidebarGroups = React.useCallback(() => {
		restoreFocusFromHiddenRegion(workspaceMenuRef.current, sidebarEntryButtonRefs.current.workspaces);
		setSidebarGroupsOpen(CLOSED_SIDEBAR_GROUPS);
	}, [restoreFocusFromHiddenRegion]);

	const expandDesktopSidebarForEntry = React.useCallback((entryId: string, isGroup: boolean) => {
		// Collapsed desktop clicks should first reveal the full sidebar so users
		// can orient themselves before actions or nested lists appear.
		setIsSidebarCollapsed(false);
		setSidebarGroupsOpen({
			...CLOSED_SIDEBAR_GROUPS,
			...(isGroup ? { [entryId]: true } : {}),
		});
	}, []);

	React.useEffect(() => {
		if (!pendingSharedFolderReveal) return;
		if (authWorkspaceId !== pendingSharedFolderReveal.workspaceId) return;
		if (activeWorkspaceSystemKind !== 'SHARED_WITH_ME') return;

		const nextFolder = String(pendingSharedFolderReveal.folderName || '').trim();
		if (nextFolder && !sharedFolderNames.includes(nextFolder)) return;

		setSidebarView('notes');
		setSidebarGroupsOpen((prev) => ({
			...prev,
			workspaces: true,
			[`workspace-folders:${pendingSharedFolderReveal.workspaceId}`]: true,
		}));
		if (isMobileViewport) {
			openMobileSidebar();
		} else if (sidebarIsCollapsed) {
			expandDesktopSidebarForEntry('workspaces', true);
		}
		setActiveSharedFolder(nextFolder || null);
		setPendingSharedFolderReveal(null);
	}, [
		activeWorkspaceSystemKind,
		authWorkspaceId,
		expandDesktopSidebarForEntry,
		isMobileViewport,
		openMobileSidebar,
		pendingSharedFolderReveal,
		sharedFolderNames,
		sidebarIsCollapsed,
	]);

	React.useEffect(() => {
		if (authStatus !== 'authed' || !authUserId) return;
		void scheduleQueuedNoteImageFlush(authUserId);
		void scheduleQueuedNoteDocumentFlush(authUserId);
		void flushQueuedNoteLinkSync(authUserId);
		const onOnline = (): void => {
			void scheduleQueuedNoteImageFlush(authUserId);
			void scheduleQueuedNoteDocumentFlush(authUserId);
			void flushQueuedNoteLinkSync(authUserId).finally(() => {
				void refreshNoteShareState();
			});
		};
		window.addEventListener('online', onOnline);
		return () => window.removeEventListener('online', onOnline);
	}, [authStatus, authUserId, refreshNoteShareState]);

	React.useEffect(() => {
		if (authStatus !== 'authed') return;
		if (!deferredSearchQuery) {
			setSearchResults([]);
			setSearchResultsBusy(false);
			setSearchResultsError(null);
			return;
		}
		if (authOfflineMode || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
			setSearchResults([]);
			setSearchResultsBusy(false);
			setSearchResultsError(t('search.offlineUnavailable'));
			return;
		}

		let cancelled = false;
		const timer = window.setTimeout(() => {
			setSearchResultsBusy(true);
			setSearchResultsError(null);
			void searchNotes(deferredSearchQuery)
				.then((response) => {
					if (cancelled) return;
					setSearchResults(response.results);
				})
				.catch((error) => {
					if (cancelled) return;
					setSearchResults([]);
					setSearchResultsError(error instanceof Error ? error.message : t('search.failed'));
				})
				.finally(() => {
					if (cancelled) return;
					setSearchResultsBusy(false);
				});
		}, 180);

		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [authOfflineMode, authStatus, deferredSearchQuery, t]);

	const clearSearchAndClose = React.useCallback(() => {
		setSearchQuery('');
		setSearchResults([]);
		setSearchResultsError(null);
		setSearchResultsBusy(false);
		setIsMobileSearchOpen(false);
	}, []);
	const groupedSearchResults = React.useMemo(() => {
		const groups = new Map<string, { label: string; items: NoteSearchResult[] }>();
		for (const result of searchResults) {
			const key = `${result.group.kind}:${result.group.label}`;
			const existing = groups.get(key);
			if (existing) {
				existing.items.push(result);
				continue;
			}
			groups.set(key, { label: result.group.label, items: [result] });
		}
		return Array.from(groups.values());
	}, [searchResults]);
	const formatSearchGroupLabel = React.useCallback((group: NoteSearchResult['group']): string => {
		if (group.kind === 'shared') return `${t('search.sharedPrefix')} ${group.label}`;
		return `${t('search.workspacePrefix')} ${group.label}`;
	}, [t]);
	const formatSearchMatchLabel = React.useCallback((kind: NoteSearchMatchKind): string => {
		if (kind === 'ocr') return t('search.matchOcr');
		if (kind === 'collaborator') return t('search.matchCollaborator');
		if (kind === 'link') return t('search.matchLink');
		if (kind === 'document') return t('search.matchDocument');
		return t('search.matchNote');
	}, [t]);
	const handleSearchResultSelect = React.useCallback(async (result: NoteSearchResult) => {
		setSearchQuery('');
		setSearchResults([]);
		setSearchResultsError(null);
		setIsMobileSearchOpen(false);
		setNoteGridCollaboratorFilter(null);
		if (result.openWorkspaceId && result.openWorkspaceId !== authWorkspaceId) {
			await activateWorkspaceFromSidebar(result.openWorkspaceId, {
				activeSharedFolder: result.group.kind === 'shared' ? result.folderName ?? null : null,
			});
		} else if (result.group.kind === 'shared') {
			setActiveSharedFolder(result.folderName ?? null);
		}
		setSidebarView(result.archived ? 'archive' : 'notes');
		if (result.openNoteId) {
			openNoteEditor(result.openNoteId, { replaceTop: true });
		}
	}, [activateWorkspaceFromSidebar, authWorkspaceId, openNoteEditor]);

	const toggleSidebar = () => {
		if (isMobileViewport) {
			if (isMobileSidebarOpen) {
				closeMobileSidebar();
				return;
			}
			openMobileSidebar();
			return;
		}
		setIsSidebarCollapsed((prev) => {
			const next = !prev;
			if (next) collapseAllSidebarGroups();
			return next;
		});
	};

	// ── Auth gate / splash overlay ────────────────────────────────────────
	// 'unauth'  → show login form (early return)
	// 'loading' → show full-page splash (early return – no workspace data yet)
	// 'authed'  → render main app; keep splash overlay until NoteGrid signals ready
	if (authStatus === 'unauth') return authGateView;

	if (authStatus === 'loading') {
		const splashIcon = isLightTheme(themeId) ? appIconLight : appIconDark;
		return (
			<div className="splash-shell">
				<div className="splash-content">
					<img src={splashIcon} alt="" className="splash-icon" />
					<div className="splash-title">FreemanNotes</div>
					<div className="splash-spinner" />
				</div>
			</div>
		);
	}

	if (externalRoute?.kind === 'share') return shareRouteView;

	if (externalRoute?.kind === 'invite') return inviteRouteView;

	const splashIcon = isLightTheme(themeId) ? appIconLight : appIconDark;
	const canCreateNotesInActiveWorkspace = Boolean(authWorkspaceId && activeWorkspaceSystemKind !== 'SHARED_WITH_ME' && canEditActiveWorkspace);
	const selectedSharedPlacement = selectedNoteId ? sharedPlacements.find((placement) => placement.aliasId === selectedNoteId) ?? null : null;
	const selectedNoteDocId = selectedNoteId ? selectedSharedPlacement?.roomId || (authWorkspaceId ? `${authWorkspaceId}:${selectedNoteId}` : '') : '';
	const selectedNoteReadOnly = selectedSharedPlacement ? selectedSharedPlacement.role === 'VIEWER' : !canEditActiveWorkspace;
	const canManageSelectedNoteCollaborators = selectedSharedPlacement ? selectedSharedPlacement.role === 'EDITOR' : canEditActiveWorkspace;

	return (
		<>
			{/*
				In-app splash overlay:
				Even after auth is "authed", we keep a full-screen overlay until NoteGrid
				signals it has loaded initial data and layout measurements. This prevents a
				reload flash where cards briefly paint in a default layout and then spring.
			*/}
			{!splashDismissed && (
			<div className={`splash-shell splash-overlay${splashFading ? ' splash-fade-out' : ''}`}>
				<div className="splash-content">
					<img src={splashIcon} alt="" className="splash-icon" />
					<div className="splash-title">FreemanNotes</div>
					<div className="splash-spinner" />
				</div>
			</div>
			)}
		<div
			className={`test-harness-root${themeId.startsWith('catppuccin-') ? ' theme-catppuccin' : ''}${
				isFabOpen ? ' fab-open' : ''
			}${sidebarIsCollapsed ? ' sidebar-collapsed' : ''}${isMobileSidebarOpen ? ' mobile-sidebar-open' : ''}${isEditorOverlayOpen ? ' editor-open' : ''}${
				// Landscape branch: expose a root class so CSS can hard-disable the
				// portrait header morph transitions during rotation.
				isMobileLandscape ? ' mobile-landscape' : ''
			}`}
		>
			{isMobileViewport && !isMobileSidebarOpen ? <div ref={mobileSwipeZoneRef} className="mobile-swipe-zone" aria-hidden="true" /> : null}
			{isFabOpen ? (
				<button
					type="button"
					className="mobile-fab-backdrop"
					onClick={toggleFab}
					aria-label={t('app.closeQuickCreate')}
				/>
			) : null}
			<header ref={headerRef} className="app-header">
				{isMobileViewport ? (
					<>
						<div className="app-header-toprow mobile-toprow">
							<button
								ref={sidebarToggleButtonRef}
								type="button"
								className="app-icon-button mobile-sidebar-btn"
								onClick={toggleSidebar}
								aria-label={isMobileSidebarOpen ? t('common.close') : t('app.expandSidebar')}
								title={isMobileSidebarOpen ? t('common.close') : t('app.expandSidebar')}
							>
								<FontAwesomeIcon icon={faBars} />
							</button>
							<img className="app-header-logo mobile-app-icon" src={headerIconSrc} alt="" aria-hidden="true" />
							<button
								type="button"
								className={`app-icon-button mobile-search-btn${isMobileSearchOpen ? ' is-active' : ''}`}
								onClick={() => setIsMobileSearchOpen((prev) => !prev)}
								aria-label={t('app.globalSearchPlaceholder')}
								aria-pressed={isMobileSearchOpen}
								title={t('app.globalSearchPlaceholder')}
							>
								<FontAwesomeIcon icon={faMagnifyingGlass} />
							</button>
							<button
								type="button"
								className="app-icon-button app-notification-button mobile-notification-btn"
								onClick={openShareNotifications}
								aria-label={t('share.notifications')}
								title={t('share.notifications')}
							>
								<FontAwesomeIcon icon={faBell} />
								{pendingShareNotificationCount > 0 ? (
									<span className="app-notification-badge" aria-hidden="true">
										{pendingShareNotificationCount > 99 ? '99+' : pendingShareNotificationCount}
									</span>
								) : null}
							</button>
							<button
								type="button"
								className="app-icon-button mobile-appgrid-btn"
								aria-label={t('app.globalSearchPlaceholder')}
								title={t('app.globalSearchPlaceholder')}
							>
								<FontAwesomeIcon icon={faGrip} />
							</button>
							<button
								type="button"
								className="avatar-trigger mobile-avatar-btn"
								onClick={openPreferences}
								aria-label={t('prefs.title')}
								title={t('prefs.title')}
							>
								{authProfileImage ? <img className="avatar-img" src={authProfileImage} alt="" /> : <span aria-hidden="true">👤</span>}
							</button>
						</div>
						<div className={`app-header-searchrow mobile-searchrow${isMobileSearchOpen ? ' is-open' : ''}`}>
							<div className="mobile-search-overlay">
								<input
									ref={mobileSearchInputRef}
									type="search"
									className="app-header-search-input"
									value={searchQuery}
									onChange={(event) => setSearchQuery(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === 'Escape') setIsMobileSearchOpen(false);
									}}
									placeholder={t('app.globalSearchPlaceholder')}
									aria-label={t('app.globalSearchPlaceholder')}
								/>
								<button
									type="button"
									className="app-icon-button mobile-search-close"
									onClick={clearSearchAndClose}
									aria-label={t('common.close')}
									title={t('common.close')}
								>
									<FontAwesomeIcon icon={faXmark} />
								</button>
							</div>
						</div>
					</>
				) : (
					<>
						<div className="app-header-left">
							<button
								ref={sidebarToggleButtonRef}
								type="button"
								className="app-icon-button"
								onClick={toggleSidebar}
								aria-label={sidebarIsCollapsed ? t('app.expandSidebar') : t('app.collapseSidebar')}
								title={sidebarIsCollapsed ? t('app.expandSidebar') : t('app.collapseSidebar')}
							>
								<FontAwesomeIcon icon={faBars} />
							</button>
							<img className="app-header-logo" src={headerIconSrc} alt="" aria-hidden="true" />
						</div>
						<div className="app-header-search">
							<input
								type="search"
								className="app-header-search-input"
								value={searchQuery}
								onChange={(event) => setSearchQuery(event.target.value)}
								placeholder={t('app.globalSearchPlaceholder')}
								aria-label={t('app.globalSearchPlaceholder')}
							/>
						</div>
						<div className="app-header-right">
							<button
								type="button"
								className="app-icon-button app-notification-button"
								onClick={openShareNotifications}
								aria-label={t('share.notifications')}
								title={t('share.notifications')}
							>
								<FontAwesomeIcon icon={faBell} />
								{pendingShareNotificationCount > 0 ? (
									<span className="app-notification-badge" aria-hidden="true">
										{pendingShareNotificationCount > 99 ? '99+' : pendingShareNotificationCount}
									</span>
								) : null}
							</button>
							<button
								type="button"
								className="app-icon-button"
								aria-label={t('app.globalSearchPlaceholder')}
								title={t('app.globalSearchPlaceholder')}
							>
								<FontAwesomeIcon icon={faGrip} />
							</button>
							<button
								type="button"
								className="avatar-trigger"
								onClick={openPreferences}
								aria-label={t('prefs.title')}
								title={t('prefs.title')}
							>
								{authProfileImage ? <img className="avatar-img" src={authProfileImage} alt="" /> : <span aria-hidden="true">👤</span>}
							</button>
						</div>
					</>
				)}
			</header>

			{isMobileViewport && isMobileSidebarOpen ? (
				<button
					type="button"
					className="mobile-sidebar-backdrop"
					onClick={closeMobileSidebar}
					aria-label={t('common.close')}
				/>
			) : null}

			<div className={`app-shell${sidebarIsCollapsed ? ' sidebar-collapsed' : ''}`}>
				<aside
					ref={mobileSidebarRef}
					className={`app-sidebar${sidebarIsCollapsed ? ' is-collapsed' : ''}${isMobileSidebarOpen ? ' is-mobile-open' : ''}`}
				>
					<nav className="app-sidebar-nav" aria-label={t('grid.notes')}>
						{sidebarEntries.map((entry) => {
							const isGroup = entry.kind === 'group';
							const isOpen = Boolean(sidebarGroupsOpen[entry.id]);
							const groupContent = sidebarGroupContent[entry.id] ?? [];
							const ariaLabel = entry.id === 'workspaces'
								? `${t('workspace.sidebarTitle')}: ${activeWorkspaceName || t('workspace.unnamed')}`
								: entry.label;
							const label = entry.label;
							return (
								<div key={entry.id}>
									<button
										ref={(node) => {
											sidebarEntryButtonRefs.current[entry.id] = node;
										}}
										type="button"
										className={`app-sidebar-link${isGroup && isOpen ? ' is-open' : ''}${entry.id === 'trash' && sidebarView === 'trash' ? ' is-active' : ''}${entry.id === 'archive' && sidebarView === 'archive' ? ' is-active' : ''}${entry.id === 'notes' && sidebarView === 'notes' ? ' is-active' : ''}`}
										onClick={() => {
											if (!isMobileViewport && sidebarIsCollapsed) {
												if (entry.id === 'workspaces' && sidebarWorkspaces.length === 0) {
													void loadSidebarWorkspaces();
												}
												expandDesktopSidebarForEntry(entry.id, isGroup);
												return;
											}
											if (entry.id === 'workspaces') {
												if (isOpen) {
													closeWorkspaceSidebarGroup();
													return;
												}
												if (sidebarWorkspaces.length === 0) {
													void loadSidebarWorkspaces();
												}
												setSidebarGroupsOpen((prev) => ({ ...prev, workspaces: true }));
												return;
											}
											if (entry.id === 'trash') {
												setActiveSharedFolder(null);
												setSidebarView('trash');
												if (isMobileViewport) closeMobileSidebar();
												return;
											}
											if (entry.id === 'archive') {
												setActiveSharedFolder(null);
												setSidebarView('archive');
												if (isMobileViewport) closeMobileSidebar();
												return;
											}
											if (entry.id === 'notes') {
												setActiveSharedFolder(null);
												setSidebarView('notes');
												if (isMobileViewport) closeMobileSidebar();
												return;
											}
											if (isGroup) {
												setSidebarGroupsOpen((prev) => ({ ...prev, [entry.id]: !Boolean(prev[entry.id]) }));
												return;
											}
											if (isMobileViewport) closeMobileSidebar();
										}}
										title={sidebarIsCollapsed ? ariaLabel : undefined}
										aria-label={ariaLabel}
										aria-expanded={isGroup ? isOpen : undefined}
									>
										<span className="sidebar-disclosure" aria-hidden="true">
											{isGroup ? <span className={`sidebar-disclosure-icon${isOpen ? ' is-open' : ''}`} /> : null}
										</span>
										<span className="sidebar-icon" aria-hidden="true">
											<FontAwesomeIcon icon={entry.icon as never} />
										</span>
										<span className="sidebar-label">{label}</span>
									</button>

										{entry.id === 'workspaces' && !sidebarIsCollapsed ? (
											<div className="sidebar-workspace-current" aria-live="polite">
												<span className="sidebar-workspace-current-text">{activeWorkspaceSidebarPath}</span>
											</div>
										) : null}

									{entry.id === 'workspaces' && !sidebarIsCollapsed ? (
										<div className={`sidebar-submenu-shell${isOpen ? ' is-open' : ''}`}>
											<div ref={workspaceMenuRef} className="sidebar-submenu sidebar-workspace-menu" aria-label={t('workspace.listAria')} aria-hidden={!isOpen}>
											{sidebarWorkspacesBusy ? (
													<div className="sidebar-workspace-muted sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: 0 }}>{t('common.loading')}</div>
											) : null}
											{sidebarWorkspacesError ? (
													<div className="sidebar-workspace-muted sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: 1 }}>{sidebarWorkspacesError}</div>
											) : null}
											{sidebarWorkspacesSorted.length === 0 && !sidebarWorkspacesBusy ? (
													<div className="sidebar-workspace-muted sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: 2 }}>{t('workspace.none')}</div>
											) : null}
											{sidebarWorkspacesSorted.map((ws, index) => {
												const isActive = Boolean(authWorkspaceId && ws.id === authWorkspaceId);
												const canShareWorkspace = canManageWorkspace(ws.role) && ws.systemKind !== 'SHARED_WITH_ME';
												const sharedFolderGroupId = `workspace-folders:${ws.id}`;
												const hasSharedFolders = ws.systemKind === 'SHARED_WITH_ME' && sharedFolderNames.length > 0;
												const showSharedFolders = hasSharedFolders && Boolean(sidebarGroupsOpen[sharedFolderGroupId]);
												const itemIndex = (sidebarWorkspacesBusy || sidebarWorkspacesError ? 3 : 0) + index;
												return (
													<div key={ws.id} className="sidebar-workspace-group">
														<div className={`sidebar-workspace-row${canShareWorkspace ? ' has-share-action' : ''}`}>
															{hasSharedFolders ? (
																<button
																	type="button"
																	className="sidebar-workspace-disclosure-toggle"
																	onClick={(event) => {
																		event.stopPropagation();
																		setSidebarGroupsOpen((prev) => ({
																			...prev,
																			[sharedFolderGroupId]: !Boolean(prev[sharedFolderGroupId]),
																		}));
																	}}
																	aria-label={getWorkspaceDisplayName(ws, t)}
																	aria-expanded={showSharedFolders}
																>
																	<span className={`sidebar-disclosure-icon${showSharedFolders ? ' is-open' : ''}`} aria-hidden="true" />
																</button>
															) : (
																<span className="sidebar-workspace-disclosure-placeholder" aria-hidden="true" />
															)}
															<button
																type="button"
																className={`sidebar-workspace-item sidebar-submenu-item${isActive ? ' is-active' : ''}`}
																onClick={() => {
																	if (ws.systemKind === 'SHARED_WITH_ME') {
																		setActiveSharedFolder(null);
																		setSidebarView('notes');
																	}
																	if (hasSharedFolders) {
																		setSidebarGroupsOpen((prev) => ({ ...prev, [sharedFolderGroupId]: true }));
																	}
																	if (ws.id !== authWorkspaceId) {
																		void activateWorkspaceFromSidebar(ws.id, { activeSharedFolder: null });
																	} else if (ws.systemKind === 'SHARED_WITH_ME') {
																		void persistSharedWorkspaceSelection(ws.id, null);
																	} else if (isMobileViewport) {
																		closeMobileSidebar();
																	}
																}}
																title={getWorkspaceDisplayName(ws, t)}
																style={{ ['--sidebar-item-index' as const]: itemIndex }}
															>
																{getWorkspaceDisplayName(ws, t)}
															</button>
																	{canShareWorkspace ? (
																		<button
																			type="button"
																			className="sidebar-workspace-share"
																			onClick={(event) => {
																				event.stopPropagation();
																				openSendInviteForWorkspace(ws);
																			}}
																			aria-label={t('invite.sidebarShareAria')}
																			title={t('invite.sidebarShareAria')}
																			style={{ ['--sidebar-item-index' as const]: itemIndex }}
																		>
																			<FontAwesomeIcon icon={faShareNodes} aria-hidden="true" />
																		</button>
																	) : null}
														</div>
														{showSharedFolders ? (
															<div className="sidebar-nested-submenu-shell is-open">
																<div className="sidebar-nested-submenu sidebar-workspace-folders" aria-hidden="false">
																	{sharedFolderNames.length === 0 ? (
																		<div className="sidebar-submenu-muted sidebar-workspace-folder-muted">{t('share.noSharedFolders')}</div>
																	) : sharedFolderNames.map((folderName, folderIndex) => (
																		<button
																			key={`${ws.id}:${folderName}`}
																			type="button"
																			className={`sidebar-submenu-item sidebar-workspace-folder${activeSharedFolder === folderName ? ' is-active' : ''}`}
																			onClick={() => {
																				setSidebarView('notes');
																				if (ws.id !== authWorkspaceId) {
																					setPendingSharedFolderReveal({ workspaceId: ws.id, folderName });
																					void activateWorkspaceFromSidebar(ws.id, { activeSharedFolder: folderName });
																				} else {
																					setActiveSharedFolder(folderName);
																					void persistSharedWorkspaceSelection(ws.id, folderName);
																				}
																				if (isMobileViewport) closeMobileSidebar();
																			}}
																			style={{ ['--sidebar-item-index' as const]: folderIndex }}
																		>
																			{folderName}
																		</button>
																	))}
																</div>
															</div>
														) : null}
													</div>
												);
											})}
											<button
												type="button"
													className="sidebar-workspace-manage sidebar-submenu-action"
												onClick={() => {
													closeWorkspaceSidebarGroup();
													openWorkspaceSwitcher({ replaceTop: isMobileViewport && isMobileSidebarOpen });
												}}
													style={{ ['--sidebar-item-index' as const]: Math.max(3, sidebarWorkspacesSorted.length + 1) }}
											>
												{t('workspace.manage')}
											</button>
											</div>
										</div>
									) : null}

									{entry.id !== 'workspaces' && isGroup && groupContent.length > 0 && !sidebarIsCollapsed ? (
										<div className={`sidebar-submenu-shell${isOpen ? ' is-open' : ''}`}>
											<div className="sidebar-submenu" aria-hidden={!isOpen}>
												{groupContent.map((item, index) => {
													if (item.kind === 'heading') {
														return (
															<div key={item.id} className="sidebar-submenu-heading" style={{ ['--sidebar-item-index' as const]: index }}>
																{item.label}
															</div>
														);
													}
													if (item.kind === 'muted') {
														return (
															<div key={item.id} className="sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: index }}>
																{item.label}
															</div>
														);
													}
													const className = item.kind === 'action' ? 'sidebar-submenu-action' : 'sidebar-submenu-item';
													return (
														<button
															key={item.id}
															type="button"
															className={className}
															onClick={() => {
																if (entry.id === 'collections' && item.id === 'manage-collections') {
																	setActiveSharedFolder(null);
																	setSidebarView('notes');
																	if (isMobileViewport) closeMobileSidebar();
																}
															}}
															style={{ ['--sidebar-item-index' as const]: index }}
														>
															{item.label}
														</button>
													);
												})}
											</div>
										</div>
									) : null}

									{entry.id === 'sorting' && !sidebarIsCollapsed ? (
										<div className={`sidebar-submenu-shell${isOpen ? ' is-open' : ''}`}>
											<div className="sidebar-submenu" aria-hidden={!isOpen}>
												{sortingPrimaryItems.map((item, index) => (
													<button key={item.id} type="button" className="sidebar-submenu-item" style={{ ['--sidebar-item-index' as const]: index }}>
														{item.label}
													</button>
												))}
												{sortingNestedGroups.map((group, groupIndex) => {
													const nestedOpen = Boolean(sidebarGroupsOpen[group.id]);
													const baseIndex = sortingPrimaryItems.length + groupIndex;
													return (
														<div key={group.id} className="sidebar-nested-group">
															<button
																type="button"
																className={`sidebar-submenu-toggle${nestedOpen ? ' is-open' : ''}`}
																onClick={() => setSidebarGroupsOpen((prev) => ({ ...prev, [group.id]: !Boolean(prev[group.id]) }))}
																aria-expanded={nestedOpen}
																style={{ ['--sidebar-item-index' as const]: baseIndex }}
															>
																<span className="sidebar-submenu-toggle-icon" aria-hidden="true" />
																<span className="sidebar-submenu-toggle-label">{group.label}</span>
															</button>
															<div className={`sidebar-nested-submenu-shell${nestedOpen ? ' is-open' : ''}`}>
																<div className="sidebar-nested-submenu" aria-hidden={!nestedOpen}>
																	{group.items.map((item, itemIndex) => {
																		const className = item.kind === 'action' ? 'sidebar-submenu-action' : 'sidebar-submenu-item';
																		return (
																			<button key={item.id} type="button" className={className} style={{ ['--sidebar-item-index' as const]: itemIndex }}>
																				{item.label}
																			</button>
																		);
																	})}
																</div>
															</div>
														</div>
													);
												})}
											</div>
										</div>
									) : null}
								</div>
							);
						})}
					</nav>
				</aside>

				<main className="app-main">
					{deferredSearchQuery ? (
						<section className="global-search-results" aria-live="polite">
							<div className="global-search-results-header">
								<div>
									<p className="global-search-results-eyebrow">{t('search.title')}</p>
									<h2 className="global-search-results-title">{deferredSearchQuery}</h2>
								</div>
								<div className="global-search-results-meta">
									{searchResultsBusy ? t('common.loading') : `${searchResults.length} ${searchResults.length === 1 ? t('search.resultSingular') : t('search.resultPlural')}`}
								</div>
							</div>
							{searchResultsError ? <p className="global-search-results-error">{searchResultsError}</p> : null}
							{!searchResultsBusy && !searchResultsError && groupedSearchResults.length === 0 ? (
								<p className="global-search-results-empty">{t('search.noResults')}</p>
							) : null}
							<div className="global-search-results-groups">
								{groupedSearchResults.map((group) => (
									<section key={group.label} className="global-search-results-group">
										<header className="global-search-results-group-header">{formatSearchGroupLabel(group.items[0].group)}</header>
										<div className="global-search-results-list">
											{group.items.map((result) => (
												<button
													key={`${result.docId}:${result.openNoteId || result.noteId}`}
													type="button"
													className="global-search-result-card"
													onClick={() => void handleSearchResultSelect(result)}
												>
													{result.thumbnailUrl ? <img className="global-search-result-thumb" src={result.thumbnailUrl} alt="" /> : (
														<div className="global-search-result-thumb global-search-result-thumb-placeholder" aria-hidden="true">
															<span className="global-search-result-thumb-title">{result.title}</span>
															<span className="global-search-result-thumb-snippet">{result.snippet || t('note.untitled')}</span>
															<span className="global-search-result-thumb-line global-search-result-thumb-line-short" />
														</div>
													)}
													<div className="global-search-result-copy">
														<div className="global-search-result-topline">
															<span className="global-search-result-title">{result.title}</span>
															{result.matchKinds.map((kind) => <span key={`${result.docId}:${kind}`} className="global-search-result-badge">{formatSearchMatchLabel(kind)}</span>)}
															{result.archived ? <span className="global-search-result-badge">{t('search.archivedBadge')}</span> : null}
														</div>
														<p className="global-search-result-snippet">{result.snippet}</p>
														{result.collaboratorMatches.length > 0 ? (
															<div className="global-search-result-contexts">
																{result.collaboratorMatches.map((label) => <span key={`${result.docId}:${label}`} className="global-search-result-context">{t('search.collaboratorPrefix')} {label}</span>)}
															</div>
														) : null}
														<div className="global-search-result-meta">{result.imageCount > 0 ? `${result.imageCount} ${result.imageCount === 1 ? t('media.imageSingular') : t('media.imagePlural')} · ` : ''}{new Date(result.updatedAt).toLocaleString(locale)}</div>
													</div>
												</button>
											))}
										</div>
									</section>
								))}
							</div>
						</section>
					) : null}

					{/* Archive/trash views are read-focused, so hide quick-create affordances. */}
					{sidebarView === 'notes' ? (
						<div ref={topControlsRef} className="app-main-sticky">
							{canCreateNotesInActiveWorkspace ? (
								<div className="top-actions">
									<button type="button" className="top-action-card" onClick={() => openCreateEditor('text')}>
										{t('app.createNewNote')}
									</button>
									<button type="button" className="top-action-card" onClick={() => openCreateEditor('checklist')}>
										{t('app.createNewChecklist')}
									</button>
								</div>
							) : null}

							<div className="note-grid-scope" aria-live="polite">
								<div className="note-grid-scope-chip">
									<span className="note-grid-scope-label">{noteGridScopeLabel}</span>
									{noteGridCollaboratorFilter ? (
										<button
											type="button"
											className="note-grid-scope-clear"
											onClick={() => setNoteGridCollaboratorFilter(null)}
											aria-label={t('common.close')}
										>
											<FontAwesomeIcon icon={faXmark} />
										</button>
									) : null}
								</div>
							</div>
						</div>
					) : null}

					<section className="editor-panel">
						{/* Branch: text editor open. */}
						{editorMode === 'text' ? <TextEditor onSave={onSaveText} onCancel={closeCreateEditor} /> : null}
						{/* Branch: checklist editor open. */}
						{editorMode === 'checklist' ? (
							<ChecklistEditor
								onSave={onSaveChecklist}
								onCancel={closeCreateEditor}
								initialShowCompleted={checklistShowCompletedPref}
								allowQuickDelete={quickDeleteChecklistPref}
								onShowCompletedChange={(next) => {
									setChecklistShowCompletedPref(next);
									if (authStatus !== 'authed') return;
									if (authOfflineMode) return;
									void updateUserPreferences(deviceId, { checklistShowCompleted: next });
								}}
							/>
						) : null}
					</section>

					<NoteGrid
						key={stableWorkspaceKeyRef.current}
						// Width behavior (desktop vs mobile, portrait/landscape) is centralized in NoteGrid.
						authUserId={authUserId}
						activeWorkspaceId={authWorkspaceId}
						selectedNoteId={selectedNoteId}
						canEditWorkspaceContent={canEditActiveWorkspace}
						sharedNotes={sidebarView === 'trash' ? [] : visibleSharedPlacements}
						activeCollaboratorFilter={noteGridCollaboratorFilter}
						refreshCollaboratorsToken={collaborationRefreshToken}
						maxCardHeightPx={maxCardHeightPx}
						// When the trash view is active, NoteGrid switches to rendering trashed notes.
						showTrashed={sidebarView === 'trash'}
						showArchived={sidebarView === 'archive'}
						onAddCollaborator={canEditActiveWorkspace ? openCollaboratorModalForNote : undefined}
						onAddImage={openNoteImageModal}
						onAddDocument={openNoteDocumentModal}
						onOpenAttachmentBrowser={openNoteAttachmentBrowser}
						onSelectCollaboratorFilter={setNoteGridCollaboratorFilter}
						canReorder={canEditActiveWorkspace && !noteGridCollaboratorFilter}
						onSelectNote={(id) => {
							// Branch: selecting a note should close the create editor.
							openNoteEditor(id, { replaceTop: editorMode !== 'none' });
						}}
						// NoteGrid calls onReady once it has loaded initial note metadata and performed its
						// first layout pass (including DOM measurement needed for masonry packing).
						onReady={handleGridReady}
						// Layout animations are suppressed until after the splash overlay has faded out.
						enableLayoutAnimations={splashDismissed}
					/>
				</main>
			</div>
			<NoteMediaBrowserModal
				isOpen={noteAttachmentBrowserState?.kind === 'images'}
				docId={noteAttachmentBrowserState?.kind === 'images' ? noteAttachmentBrowserState.docId : null}
				authUserId={authUserId}
				canEdit={noteAttachmentBrowserState?.kind === 'images' ? noteAttachmentBrowserState.canEdit : false}
				noteTitle={noteAttachmentBrowserState?.kind === 'images' ? noteAttachmentBrowserState.title : null}
				onClose={closeNoteAttachmentBrowser}
				onAddImage={noteAttachmentBrowserState?.kind === 'images' && noteAttachmentBrowserState.canEdit ? () => {
					closeNoteAttachmentBrowser();
					openNoteImageModal(noteAttachmentBrowserState.noteId, noteAttachmentBrowserState.docId, noteAttachmentBrowserState.title);
				} : undefined}
			/>
			<NoteLinkBrowserModal
				isOpen={noteAttachmentBrowserState?.kind === 'links'}
				docId={noteAttachmentBrowserState?.kind === 'links' ? noteAttachmentBrowserState.docId : null}
				doc={noteAttachmentBrowserState?.kind === 'links' ? activeAttachmentBrowserDoc : null}
				authUserId={authUserId}
				canEdit={noteAttachmentBrowserState?.kind === 'links' ? noteAttachmentBrowserState.canEdit : false}
				noteTitle={noteAttachmentBrowserState?.kind === 'links' ? noteAttachmentBrowserState.title : null}
				onClose={closeNoteAttachmentBrowser}
				onDeleteLink={noteAttachmentBrowserState?.kind === 'links' && noteAttachmentBrowserState.canEdit ? handleDeleteUrlPreviewFromBrowser : undefined}
				onAddUrlPreview={noteAttachmentBrowserState?.kind === 'links' && noteAttachmentBrowserState.canEdit ? handleAddUrlPreviewFromBrowser : undefined}
			/>
			<NoteDocumentBrowserModal
				isOpen={noteAttachmentBrowserState?.kind === 'documents'}
				docId={noteAttachmentBrowserState?.kind === 'documents' ? noteAttachmentBrowserState.docId : null}
				authUserId={authUserId}
				canEdit={noteAttachmentBrowserState?.kind === 'documents' ? noteAttachmentBrowserState.canEdit : false}
				noteTitle={noteAttachmentBrowserState?.kind === 'documents' ? noteAttachmentBrowserState.title : null}
				onClose={closeNoteAttachmentBrowser}
				onAddDocument={noteAttachmentBrowserState?.kind === 'documents' && noteAttachmentBrowserState.canEdit ? () => {
					closeNoteAttachmentBrowser();
					openNoteDocumentModal(noteAttachmentBrowserState.noteId, noteAttachmentBrowserState.docId, noteAttachmentBrowserState.title);
				} : undefined}
			/>
			<NoteImageUploadModal
				isOpen={Boolean(noteImageModalState)}
				docId={noteImageModalState?.docId ?? null}
				authUserId={authUserId}
				offlineMode={authOfflineMode}
				noteTitle={noteImageModalState?.title ?? null}
				onClose={closeNoteImageModal}
				onUploaded={(result) => showBriefDialog(result.queued ? `${result.count} ${result.count === 1 ? t('media.queuedUploadToastSingular') : t('media.queuedUploadToastPlural')}` : t('media.queuedForOcrToast'))}
			/>
			<NoteDocumentUploadModal
				isOpen={Boolean(noteDocumentModalState)}
				docId={noteDocumentModalState?.docId ?? null}
				authUserId={authUserId}
				offlineMode={authOfflineMode}
				noteTitle={noteDocumentModalState?.title ?? null}
				onClose={closeNoteDocumentModal}
				onUploaded={(result) => showBriefDialog(
					result.queued
						? (result.count === 1 ? t('documents.queuedUploadToastSingular') : `${result.count} ${t('documents.queuedUploadToastPlural')}`)
						: (result.count === 1 ? t('documents.uploadToastSingular') : `${result.count} ${t('documents.uploadToastPlural')}`)
				)}
			/>
			{briefDialogMessage ? (
				<div className="brief-dialog" role="status" aria-live="polite">
					{briefDialogMessage}
				</div>
			) : null}

			{workspaceDeletedNotice ? (
				<div className="workspace-deleted-dialog-backdrop" role="presentation">
					<section className="workspace-deleted-dialog" role="dialog" aria-modal="true" aria-label={t('workspace.deletedTitle')}>
						<h2 className="workspace-deleted-dialog-title">{t('workspace.deletedTitle')}</h2>
						<p className="workspace-deleted-dialog-body">
							{workspaceDeletedNotice.hasOtherWorkspaces ? t('workspace.deletedMessage') : t('workspace.deletedMessageNoFallback')}
						</p>
						<div className="workspace-deleted-dialog-actions">
							{workspaceDeletedNotice.hasOtherWorkspaces ? (
								<button
									type="button"
									onClick={() => {
										setWorkspaceDeletedNotice(null);
										openWorkspaceSwitcher();
									}}
								>
									{t('workspace.chooseAnother')}
								</button>
							) : null}
							<button
								type="button"
								onClick={() => setWorkspaceDeletedNotice(null)}
							>
								{t('common.close')}
							</button>
						</div>
					</section>
				</div>
			) : null}

			{canCreateNotesInActiveWorkspace && sidebarView === 'notes' ? <div className={`mobile-fab-stack${isFabOpen ? ' is-open' : ''}`}>
				<button
					type="button"
					className="mobile-fab-action"
					onClick={() => {
						openCreateEditor('text', { replaceTop: true });
					}}
				>
					{t('app.createNote')}
				</button>
				<button
					type="button"
					className="mobile-fab-action"
					onClick={() => {
						openCreateEditor('checklist', { replaceTop: true });
					}}
				>
					{t('app.createChecklist')}
				</button>
			</div> : null}

			{canCreateNotesInActiveWorkspace && sidebarView === 'notes' ? (
				<button
					type="button"
					className={`mobile-fab${isFabOpen ? ' is-open' : ''}`}
					onClick={toggleFab}
					aria-label={isFabOpen ? t('app.closeQuickCreate') : t('app.openQuickCreate')}
					title={isFabOpen ? t('app.closeQuickCreate') : t('app.openQuickCreate')}
				>
					<span
						aria-hidden="true"
						className="mobile-fab-icon"
						style={{
							WebkitMaskImage: `url(${fabIconSrc})`,
							maskImage: `url(${fabIconSrc})`,
						}}
					/>
				</button>
			) : null}

			{/* Branch: selection exists but doc not yet loaded.
			   Mutual exclusion: suppress when a create editor is active to prevent
			   stacked overlays (both at z-index 220). */}
			{editorMode === 'none' && selectedNoteId && (!openDoc || openDocId !== selectedNoteId) ? <div>{t('app.loadingEditor')}</div> : null}
			{/* Branch: single active editor for the selected note.
			   Same mutual exclusion guard as above. */}
			{editorMode === 'none' && selectedNoteId && openDoc && openDocId === selectedNoteId ? (
				<NoteEditor
					noteId={selectedNoteId}
					docId={selectedNoteDocId}
					authUserId={authUserId}
					doc={openDoc}
					onClose={closeNoteEditor}
					onDelete={onDeleteSelectedNote}
					onAddCollaborator={canManageSelectedNoteCollaborators ? () => openCollaboratorModalForNote(selectedNoteId, openDoc.getText('title').toString()) : undefined}
					onAddImage={selectedNoteReadOnly ? undefined : () => {
						if (!selectedNoteDocId) return;
						openNoteImageModal(selectedNoteId, selectedNoteDocId, openDoc.getText('title').toString());
					}}
					onAddDocument={selectedNoteReadOnly ? undefined : () => {
						if (!selectedNoteDocId) return;
						openNoteDocumentModal(selectedNoteId, selectedNoteDocId, openDoc.getText('title').toString());
					}}
					readOnly={selectedNoteReadOnly}
					initialShowCompleted={checklistShowCompletedPref}
					allowQuickDelete={quickDeleteChecklistPref}
					onShowCompletedChange={(next) => {
						setChecklistShowCompletedPref(next);
						if (authStatus !== 'authed') return;
						if (authOfflineMode) return;
						void updateUserPreferences(deviceId, { checklistShowCompleted: next });
					}}
				/>
			) : null}

			<PreferencesModal
				isOpen={isPreferencesOpen}
				onClose={() => {
					if (goBackIfOverlayHistory()) return;
					setIsPreferencesOpen(false);
				}}
				t={t}
				quickDeleteChecklist={quickDeleteChecklistPref}
				onQuickDeleteChecklistChange={(next) => {
					setQuickDeleteChecklistPref(next);
					if (authStatus !== 'authed') return;
					if (authOfflineMode) return;
					void updateUserPreferences(deviceId, { quickDeleteChecklist: next });
				}}
				onOpenAppearance={openAppearanceFromPreferences}
				onUserManagement={openUserManagementFromPreferences}
				onSendInvite={openSendInviteFromPreferences}
				onSignOut={() => void signOut()}
			/>

			<AppearanceModal
				isOpen={isAppearanceOpen}
				onClose={() => {
					if (goBackIfOverlayHistory()) return;
					setIsAppearanceOpen(false);
				}}
				onBack={backToPreferencesFromAppearance}
				t={t}
				themeId={themeId}
				onThemeChange={setThemeId}
				themeOptions={themeOptions}
				language={locale}
				onLanguageChange={(next) => setLocale(next as LocaleCode)}
				languageOptions={languageOptions}
			/>

			<SendInviteModal
				isOpen={isSendInviteOpen}
				onClose={() => {
					if (goBackIfOverlayHistory()) return;
					setIsSendInviteOpen(false);
					setInviteWorkspaceTarget(null);
				}}
				t={t}
				authUserId={authUserId}
				authProfileImage={authProfileImage}
				workspaceId={inviteWorkspaceTarget?.id ?? authWorkspaceId}
				workspaceName={inviteWorkspaceTarget?.name ?? activeWorkspaceName}
			/>

			<ShareNotificationsModal
				isOpen={isShareNotificationsOpen}
				onClose={() => setIsShareNotificationsOpen(false)}
				authUserId={authUserId}
				failedLinkNotifications={failedLinkNotifications}
				onAcceptedPlacement={(args) => void handleAcceptedSharedPlacement(args)}
				onAcceptedWorkspaceInvite={(workspaceId) => {
					setIsShareNotificationsOpen(false);
					void activateWorkspaceFromSidebar(workspaceId, { activeSharedFolder: null });
				}}
				onOpenFailedLink={(failure) => {
					setIsShareNotificationsOpen(false);
					void (async () => {
						if (failure.openWorkspaceId && failure.openWorkspaceId !== authWorkspaceId) {
							await activateWorkspaceFromSidebar(failure.openWorkspaceId, {
								activeSharedFolder: failure.folderName ?? null,
							});
						} else if (failure.folderName) {
							setActiveSharedFolder(failure.folderName);
						}
						if (failure.openNoteId) {
							openNoteEditor(failure.openNoteId, { replaceTop: true });
						}
					})();
				}}
				onChanged={() => {
					bumpCollaborationRefreshToken();
					void refreshNoteShareState();
				}}
			/>

			<CollaboratorModal
				isOpen={Boolean(collaboratorModalState)}
				onClose={closeCollaboratorModal}
				authUserId={authUserId}
				docId={collaboratorModalState?.docId ?? null}
				offlineCanManageHint={Boolean(collaboratorModalState && !sharedPlacements.some((item) => item.aliasId === collaboratorModalState.noteId))}
				noteTitle={collaboratorModalState?.title ?? ''}
				onChanged={() => {
					bumpCollaborationRefreshToken();
					void refreshNoteShareState();
				}}
			/>

			<WorkspaceSwitcherModal
				isOpen={isWorkspaceSwitcherOpen}
				onClose={() => {
					if (goBackIfOverlayHistory()) return;
					setIsWorkspaceSwitcherOpen(false);
				}}
				t={t}
				authUserId={authUserId}
				onWorkspaceActivated={handleWorkspaceActivated}
				onWorkspaceDeleted={(deletedWorkspaceId, nextActiveWorkspaceId) => void handleWorkspaceDeleted(deletedWorkspaceId, nextActiveWorkspaceId)}
				onActiveWorkspaceRenamed={() => void refreshActiveWorkspace()}
			/>

			<UserManagementModal
				isOpen={isUserManagementOpen}
				onClose={() => {
					if (goBackIfOverlayHistory()) return;
					setIsUserManagementOpen(false);
				}}
				currentUserId={authUserId}
			/>
		</div>
		</>
	);
}
