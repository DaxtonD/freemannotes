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
	faTag,
	faTrash,
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
import { WorkspaceSwitcherModal } from './components/Workspaces/WorkspaceSwitcherModal';
import { TextEditor } from './components/Editors/TextEditor';
import { NoteGrid } from './components/NoteGrid/NoteGrid';
import { type ChecklistItem } from './core/bindings';
import { getDeviceId } from './core/deviceId';
import { useDocumentManager } from './core/DocumentManagerContext';
import { type LocaleCode, useI18n } from './core/i18n';
import { initChecklistNoteDoc, initTextNoteDoc, makeNoteId } from './core/noteModel';
import { seedNoteCardCompletedExpandedByNoteId } from './core/noteCardCompletedExpansion';
import { applyTheme, getStoredThemeId, isLightTheme, persistThemeId, THEMES, type ThemeId } from './core/theme';
import { fetchUserPreferences, updateUserPreferences } from './core/userDevicePreferencesApi';
import { useConnectionStatus } from './core/useConnectionStatus';
import { useIsCoarsePointer } from './core/useIsCoarsePointer';
import { useIsMobileLandscape } from './core/useIsMobileLandscape';

type EditorMode = 'none' | 'text' | 'checklist';

type OverlaySnapshot = {
	editorMode: EditorMode;
	selectedNoteId: string | null;
	isPreferencesOpen: boolean;
	isAppearanceOpen: boolean;
	isUserManagementOpen: boolean;
	isSendInviteOpen: boolean;
	isWorkspaceSwitcherOpen: boolean;
	isMobileSidebarOpen: boolean;
	isFabOpen: boolean;
};

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

function isOverlayHistoryState(value: unknown): value is OverlayHistoryState {
	if (!value || typeof value !== 'object') return false;
	return (value as Partial<OverlayHistoryState>)[OVERLAY_HISTORY_KEY] === true;
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
	workspaceId: string;
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
		const workspaceId = typeof parsed.workspaceId === 'string' ? parsed.workspaceId : '';
		const profileImage = typeof parsed.profileImage === 'string' ? parsed.profileImage : null;
		if (!userId || !workspaceId) return null;
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
	// ── Optimistic auth restoration ──────────────────────────────────────
	// If a valid auth cache exists in localStorage we optimistically treat
	// the user as authenticated on the very first render. This lets the
	// NoteGrid begin loading data from IndexedDB immediately, avoiding the
	// splash screen while the background `/api/auth/me` probe completes.
	// If the probe later fails, authStatus is reverted to 'unauth'.
	const authCacheRef = React.useRef(readAuthCache());
	const cachedAuth = authCacheRef.current;
	const [authStatus, setAuthStatus] = React.useState<'loading' | 'authed' | 'unauth'>(() =>
		cachedAuth ? 'authed' : 'loading'
	);
	const [authMode, setAuthMode] = React.useState<'login' | 'register'>('login');
	const [authEmail, setAuthEmail] = React.useState('');
	const [authName, setAuthName] = React.useState('');
	const [authPassword, setAuthPassword] = React.useState('');
	const [authError, setAuthError] = React.useState<string | null>(null);
	const [authBusy, setAuthBusy] = React.useState(false);
	const [authUserId, setAuthUserId] = React.useState<string | null>(() => cachedAuth?.userId ?? null);
	const [authProfileImage, setAuthProfileImage] = React.useState<string | null>(() => cachedAuth?.profileImage ?? null);
	const [authWorkspaceId, setAuthWorkspaceId] = React.useState<string | null>(() => cachedAuth?.workspaceId ?? null);
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
	const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
	const [isMobileSidebarOpen, setIsMobileSidebarOpen] = React.useState(false);
	const [isMobileHeaderCollapsed, setIsMobileHeaderCollapsed] = React.useState(false);
	const [isMobileViewport, setIsMobileViewport] = React.useState(() => {
		if (typeof window === 'undefined') return false;
		return window.matchMedia('(pointer: coarse)').matches;
	});
	const headerRef = React.useRef<HTMLElement | null>(null);
	const topActionsRef = React.useRef<HTMLDivElement | null>(null);
	const mobileSwipeZoneRef = React.useRef<HTMLDivElement | null>(null);
	const mobileSidebarRef = React.useRef<HTMLElement | null>(null);
	const [sidebarGroupsOpen, setSidebarGroupsOpen] = React.useState<Record<string, boolean>>(CLOSED_SIDEBAR_GROUPS);
	// Which sidebar view is active: regular notes or the trash bin.
	const [sidebarView, setSidebarView] = React.useState<'notes' | 'trash'>('notes');
	// UI mode for the "new note" panel.
	const [editorMode, setEditorMode] = React.useState<EditorMode>('none');
	// Phase 10 preferences shell entry point opened from top-right avatar.
	const [isPreferencesOpen, setIsPreferencesOpen] = React.useState(false);
	const [isAppearanceOpen, setIsAppearanceOpen] = React.useState(false);
	const [isUserManagementOpen, setIsUserManagementOpen] = React.useState(false);
	const [isSendInviteOpen, setIsSendInviteOpen] = React.useState(false);
	const [isWorkspaceSwitcherOpen, setIsWorkspaceSwitcherOpen] = React.useState(false);
	const [activeWorkspaceName, setActiveWorkspaceName] = React.useState<string | null>(null);
	// The currently selected note in the grid/editor area.
	const [selectedNoteId, setSelectedNoteId] = React.useState<string | null>(null);
	// Loaded Y.Doc for the selected note.
	const [openDoc, setOpenDoc] = React.useState<Y.Doc | null>(null);
	const [openDocId, setOpenDocId] = React.useState<string | null>(null);
	const [themeId, setThemeId] = React.useState<ThemeId>(() => getStoredThemeId());
	const deviceId = React.useMemo(() => getDeviceId(), []);
	const [checklistShowCompletedPref, setChecklistShowCompletedPref] = React.useState(false);
	const [prefsHydrationAttempted, setPrefsHydrationAttempted] = React.useState(false);
	const [searchQuery, setSearchQuery] = React.useState('');
	const [isFabOpen, setIsFabOpen] = React.useState(false);
	const isCoarsePointer = useIsCoarsePointer();
	const isMobileLandscape = useIsMobileLandscape();
	const maxCardHeightPx = isCoarsePointer ? 450 : 615;
	const exitBackPressRef = React.useRef({ count: 0, lastAt: 0 });

	const getOverlaySnapshot = React.useCallback((): OverlaySnapshot => {
		return {
			editorMode,
			selectedNoteId,
			isPreferencesOpen,
			isAppearanceOpen,
			isUserManagementOpen,
			isSendInviteOpen,
			isWorkspaceSwitcherOpen,
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
		window.history.back();
		return true;
	}, [isMobileViewport]);

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
	}, [commitOverlaySnapshot, getOverlaySnapshot]);

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

	const closeMobileSidebar = React.useCallback(() => {
		if (goBackIfOverlayHistory()) return;
		setIsMobileSidebarOpen(false);
	}, [goBackIfOverlayHistory]);

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
	}, [goBackIfOverlayHistory]);

	type NoteEditorOpenOptions = { replaceTop?: boolean };
	const openNoteEditor = React.useCallback(
		(noteId: string, opts?: NoteEditorOpenOptions) => {
			const current = getOverlaySnapshot();
			commitOverlaySnapshot(
				{
					...current,
					editorMode: 'none',
					selectedNoteId: noteId,
					isMobileSidebarOpen: false,
					isFabOpen: false,
				},
				opts?.replaceTop ? 'replace' : 'push'
			);
		},
		[commitOverlaySnapshot, getOverlaySnapshot]
	);

	const closeNoteEditor = React.useCallback(() => {
		if (goBackIfOverlayHistory()) return;
		setSelectedNoteId(null);
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

	const refreshActiveWorkspace = React.useCallback(async () => {
		if (!authWorkspaceId) {
			setActiveWorkspaceName(null);
			return;
		}
		try {
			const res = await fetch('/api/workspace', { credentials: 'include' });
			const contentType = String(res.headers.get('content-type') || '').toLowerCase();
			if (!res.ok || !contentType.includes('application/json')) {
				setActiveWorkspaceName(null);
				return;
			}
			const body = await res.json().catch(() => null);
			const name = body?.name ? String(body.name) : null;
			setActiveWorkspaceName(name);
		} catch {
			setActiveWorkspaceName(null);
		}
	}, [authWorkspaceId]);

	React.useEffect(() => {
		if (authStatus !== 'authed') return;
		void refreshActiveWorkspace();
	}, [authStatus, authWorkspaceId, refreshActiveWorkspace]);

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
				const workspaceId = body?.workspaceId ? String(body.workspaceId) : '';
				if (!userId || !workspaceId) {
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
				manager.setWebsocketEnabled(true);
				writeAuthCache({ v: 1, userId, workspaceId, profileImage });
			} catch {
				// Network failure (offline, captive portal, DNS, etc). Only restore cached
				// auth when the browser is offline (or when explicitly allowed).
				const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
				if (allowOfflineRestore && isOffline) {
					const cached = readAuthCache();
					if (cached) {
						setAuthStatus('authed');
						setAuthUserId(cached.userId);
						setAuthProfileImage(cached.profileImage);
						setAuthWorkspaceId(cached.workspaceId);
						setAuthOfflineMode(true);
						manager.setActiveWorkspaceId(cached.workspaceId);
						// Stay offline: IndexedDB works, websocket waits until we re-probe online.
						manager.setWebsocketEnabled(false);
						return;
					}
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
		[deviceId, manager]
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
		let cancelled = false;
		(async () => {
			const pref = await fetchUserPreferences(deviceId);
			if (cancelled) return;
			if (pref) {
				if (pref.theme) setThemeId(pref.theme as ThemeId);
				if (pref.language) setLocale(pref.language as LocaleCode);
				setChecklistShowCompletedPref(Boolean(pref.checklistShowCompleted));
				seedNoteCardCompletedExpandedByNoteId(pref.noteCardCompletedExpandedByNoteId || {});
			}
			setPrefsHydrationAttempted(true);
		})();
		return () => {
			cancelled = true;
		};
	}, [authStatus, deviceId, setLocale]);

	React.useEffect(() => {
		// If we booted offline (restored from cache), re-probe once connectivity returns.
		if (!authOfflineMode || typeof window === 'undefined') return;
		const onOnline = () => {
			void probeSession({ allowOfflineRestore: false });
		};
		window.addEventListener('online', onOnline);
		return () => {
			window.removeEventListener('online', onOnline);
		};
	}, [authOfflineMode, probeSession]);

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
		setIsUserManagementOpen(false);
		setIsPreferencesOpen(false);
		setIsAppearanceOpen(false);
		setIsSendInviteOpen(false);
		setIsWorkspaceSwitcherOpen(false);
	}, [manager]);

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
			void refreshActiveWorkspace();
		},
		[manager, refreshActiveWorkspace]
	);

	type SidebarWorkspaceListItem = {
		id: string;
		name: string;
	};
	const [sidebarWorkspaces, setSidebarWorkspaces] = React.useState<readonly SidebarWorkspaceListItem[]>([]);
	const [sidebarWorkspacesBusy, setSidebarWorkspacesBusy] = React.useState(false);
	const [sidebarWorkspacesError, setSidebarWorkspacesError] = React.useState<string | null>(null);

	const loadSidebarWorkspaces = React.useCallback(async (): Promise<void> => {
		if (sidebarWorkspacesBusy) return;
		if (authStatus !== 'authed') return;
		if (authOfflineMode) return;
		setSidebarWorkspacesBusy(true);
		setSidebarWorkspacesError(null);
		try {
			const res = await fetch(`/api/workspaces?deviceId=${encodeURIComponent(deviceId)}`,
				{ credentials: 'include' }
			);
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				const msg = body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
				throw new Error(msg);
			}
			const next = body && Array.isArray(body.workspaces) ? body.workspaces : [];
			setSidebarWorkspaces(
				next
					.map((ws: any) => ({
						id: typeof ws.id === 'string' ? ws.id : '',
						name: typeof ws.name === 'string' ? ws.name : '',
					}))
					.filter((ws: SidebarWorkspaceListItem) => Boolean(ws.id))
			);
		} catch (err) {
			setSidebarWorkspacesError(err instanceof Error ? err.message : t('workspace.loadFailed'));
		} finally {
			setSidebarWorkspacesBusy(false);
		}
	}, [authOfflineMode, authStatus, deviceId, sidebarWorkspacesBusy, t]);

	const sidebarWorkspacesSorted = React.useMemo(() => {
		if (!authWorkspaceId) return sidebarWorkspaces;
		const active = sidebarWorkspaces.find((ws) => ws.id === authWorkspaceId);
		if (!active) return sidebarWorkspaces;
		const rest = sidebarWorkspaces.filter((ws) => ws.id !== authWorkspaceId);
		return [active, ...rest];
	}, [authWorkspaceId, sidebarWorkspaces]);

	const activateWorkspaceFromSidebar = React.useCallback(
		async (workspaceId: string): Promise<void> => {
			if (authStatus !== 'authed') return;
			if (authOfflineMode) return;
			if (workspaceId === authWorkspaceId) return;
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
				handleWorkspaceActivated(workspaceId);
				setSidebarGroupsOpen((prev) => ({ ...prev, workspaces: false }));
				if (isMobileViewport) closeMobileSidebar();
			} catch {
				// Keep errors out of the sidebar nav — Workspace modal provides richer error UX.
			}
		},
		[authOfflineMode, authStatus, authWorkspaceId, closeMobileSidebar, deviceId, handleWorkspaceActivated, isMobileViewport]
	);

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
		setAuthBusy(true);
		setAuthError(null);
		try {
			const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
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
					if (profileImage) setAuthProfileImage(profileImage);
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
					setAuthUserId(userId);
					setAuthProfileImage(profileImage);
					if (workspaceId) {
						setAuthWorkspaceId(workspaceId);
						manager.setActiveWorkspaceId(workspaceId);
					}
					setAuthOfflineMode(false);
					if (userId && workspaceId) {
						writeAuthCache({ v: 1, userId, workspaceId, profileImage });
					}
				}
			} catch {
				// ignore
			}

			setAuthStatus('authed');
			setAuthOfflineMode(false);
			manager.setWebsocketEnabled(true);
		} catch {
			setAuthError('Authentication failed');
			setAuthStatus('unauth');
			manager.setWebsocketEnabled(false);
		} finally {
			setAuthBusy(false);
		}
	}, [authBusy, authEmail, authMode, authName, authPassword, manager, registerAvatarAreaPixels, registerAvatarUrl]);

	const authGateView = (
		<div className="auth-shell">
			<div className="auth-card">
				<div className="auth-title">FreemanNotes</div>
				<div className="auth-subtitle">
					{authStatus === 'loading' ? 'Checking session…' : 'Sign in to enable sync'}
				</div>
				<div className="auth-mode-row">
					<button
						type="button"
						className={authMode === 'login' ? 'auth-mode is-active' : 'auth-mode'}
						onClick={() => {
							setAuthMode('login');
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
					{authError ? <div className="auth-error">{authError}</div> : null}
					<button type="submit" disabled={authBusy || authStatus === 'loading'}>
						{authBusy ? 'Please wait…' : authMode === 'register' ? 'Create account' : 'Sign in'}
					</button>
				</form>
				<div className="auth-hint">Sync is disabled until you sign in.</div>
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
		if (!isMobileViewport || !isMobileSidebarOpen || typeof window === 'undefined' || typeof document === 'undefined') return;
		const body = document.body;
		const scrollY = window.scrollY;
		const previous = {
			overflow: body.style.overflow,
			position: body.style.position,
			top: body.style.top,
			width: body.style.width,
			overscrollBehavior: (body.style as CSSStyleDeclaration & { overscrollBehavior?: string }).overscrollBehavior ?? '',
		};
		body.style.overflow = 'hidden';
		body.style.position = 'fixed';
		body.style.top = `-${scrollY}px`;
		body.style.width = '100%';
		(body.style as CSSStyleDeclaration & { overscrollBehavior?: string }).overscrollBehavior = 'none';
		return () => {
			body.style.overflow = previous.overflow;
			body.style.position = previous.position;
			body.style.top = previous.top;
			body.style.width = previous.width;
			(body.style as CSSStyleDeclaration & { overscrollBehavior?: string }).overscrollBehavior = previous.overscrollBehavior;
			window.scrollTo(0, scrollY);
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
		// Keep mobile drawer state consistent when resizing.
		if (!isMobileViewport) {
			setIsMobileSidebarOpen(false);
			setIsMobileHeaderCollapsed(false);
		}
	}, [isMobileViewport]);

	React.useEffect(() => {
		// Desktop editor overlay offset:
		//
		// On mobile, editors must cover *everything* (including the header/search).
		// On desktop, the desired UX keeps the header and the "create" buttons visible,
		// so editor overlays should start below those controls.
		//
		// We compute an absolute pixel offset from the viewport top by measuring the
		// bottom edge of the `.top-actions` row. This is written to a CSS variable and
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
				const actions = topActionsRef.current;
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
	}, [isMobileViewport]);

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
		// Mobile header morph (MOBILE ONLY):
		//
		// UX spec:
		// - Normal: top header row shows sidebar button + app icon + app-grid + avatar;
		//   a search input sits *below* that header row.
		// - On scroll (content moves up): app icon fades out, avatar slides right + fades,
		//   app-grid slides into the avatar slot, and the search input morphs into the
		//   top row (between sidebar button and app-grid).
		// - On reverse scroll: everything returns.
		//
		// Browser notes:
		// - Chrome can oscillate rapidly if the collapse/expand state is driven purely
		//   by scrollTop thresholds while the header height is animating (layout shifts
		//   can change scrollTop mid-frame). To avoid this:
		//   1) we base toggling on scroll direction + accumulated delta, not a single threshold
		//   2) we apply a short "lock" after toggling so bounce/elastic scroll doesn't flip it back
		if (!isMobileViewport || isMobileLandscape || typeof window === 'undefined') return;
		let raf = 0;
		let lastScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
		let accumDown = 0;
		let accumUp = 0;
		// Tuning knobs:
		// - COLLAPSE_DELTA_PX: how far you must scroll "down" before collapsing.
		// - EXPAND_DELTA_PX: how far you must scroll "up" before expanding.
		// - MIN_SCROLL_TO_COLLAPSE_PX: prevents collapsing from tiny jitters near scrollTop=0.
		//
		// If a specific browser feels too eager/too sluggish, these are the values to adjust.
		const COLLAPSE_DELTA_PX = 18;
		const EXPAND_DELTA_PX = 10;
		const MIN_SCROLL_TO_COLLAPSE_PX = 12;
		let lockUntil = 0;

		const setCollapsedWithLock = (nextCollapsed: boolean) => {
			setIsMobileHeaderCollapsed((prev) => {
				if (prev === nextCollapsed) return prev;
				// Chrome-specific stability guard:
				// After toggling, give the layout/scroll position time to settle. Without this,
				// Chrome can bounce scrollTop by a few pixels during the header transition,
				// which would otherwise immediately re-trigger the opposite state.
				lockUntil = performance.now() + 260;
				return nextCollapsed;
			});
		};
		const onScroll = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				const now = performance.now();
				if (now < lockUntil) {
					lastScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
					return;
				}
				const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
				const delta = scrollTop - lastScrollTop;
				lastScrollTop = scrollTop;

				// Always expand at the very top.
				if (scrollTop <= 0) {
					accumDown = 0;
					accumUp = 0;
					setCollapsedWithLock(false);
					return;
				}

				if (delta > 0) {
					accumDown += delta;
					accumUp = 0;
					if (scrollTop > MIN_SCROLL_TO_COLLAPSE_PX && accumDown >= COLLAPSE_DELTA_PX) {
						accumDown = 0;
						setCollapsedWithLock(true);
					}
				} else if (delta < 0) {
					accumUp += -delta;
					accumDown = 0;
					// Expand as soon as the user scrolls back (downward gesture).
					if (accumUp >= EXPAND_DELTA_PX) {
						accumUp = 0;
						setCollapsedWithLock(false);
					}
				}
			});
		};
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener('scroll', onScroll);
		};
	}, [isMobileLandscape, isMobileViewport]);

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
			const state = event.state as unknown;
			if (isOverlayHistoryState(state)) {
				applyOverlaySnapshot(state.snapshot);
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
		async (args: { title: string; body: string }) => {
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
			initTextNoteDoc(doc, args.title, args.body);
			await manager.createNote(id, args.title);
			// Branch: after create/save, close the new-note editor and return to grid.
			// We intentionally do NOT auto-open the saved note editor here.
			closeCreateEditor();
		},
		[closeCreateEditor, manager, showBriefDialog]
	);

	const onSaveChecklist = React.useCallback(
		async (args: { title: string; items: ChecklistItem[] }) => {
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
			initChecklistNoteDoc(doc, args.title, cleanedItems);
			await manager.createNote(id, args.title);
			// Branch: after create/save, close the new-checklist editor and return to grid.
			// We intentionally do NOT auto-open the saved note editor here.
			closeCreateEditor();
		},
		[closeCreateEditor, manager, showBriefDialog]
	);

	const onDeleteSelectedNote = React.useCallback(
		async (noteId: string) => {
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
		[manager]
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

	const sidebarIsCollapsed = !isMobileViewport && isSidebarCollapsed;
	const collapseAllSidebarGroups = React.useCallback(() => {
		setSidebarGroupsOpen(CLOSED_SIDEBAR_GROUPS);
	}, []);

	const expandDesktopSidebarForEntry = React.useCallback((entryId: string, isGroup: boolean) => {
		// Collapsed desktop clicks should first reveal the full sidebar so users
		// can orient themselves before actions or nested lists appear.
		setIsSidebarCollapsed(false);
		setSidebarGroupsOpen({
			...CLOSED_SIDEBAR_GROUPS,
			...(isGroup ? { [entryId]: true } : {}),
		});
	}, []);

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

	const splashIcon = isLightTheme(themeId) ? appIconLight : appIconDark;

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
			}${sidebarIsCollapsed ? ' sidebar-collapsed' : ''}${isMobileSidebarOpen ? ' mobile-sidebar-open' : ''}${
				// Landscape branch: expose a root class so CSS can hard-disable the
				// portrait header morph transitions during rotation.
				isMobileLandscape ? ' mobile-landscape' : ''
				// Collapse branch:
				// - normal mobile uses scroll-driven `isMobileHeaderCollapsed`
				// - landscape forcibly stays collapsed to maximize editor space and
				//   avoid transition jitter while rotating.
			}${isMobileHeaderCollapsed || isMobileLandscape ? ' mobile-header-collapsed' : ''
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
						<div className="app-header-searchrow mobile-searchrow">
							<input
								type="search"
								className="app-header-search-input"
								value={searchQuery}
								onChange={(event) => setSearchQuery(event.target.value)}
								placeholder={t('app.globalSearchPlaceholder')}
								aria-label={t('app.globalSearchPlaceholder')}
							/>
						</div>
					</>
				) : (
					<>
						<div className="app-header-left">
							<button
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
										type="button"
										className={`app-sidebar-link${isGroup && isOpen ? ' is-open' : ''}${entry.id === 'trash' && sidebarView === 'trash' ? ' is-active' : ''}${entry.id === 'notes' && sidebarView === 'notes' ? ' is-active' : ''}`}
										onClick={() => {
											if (!isMobileViewport && sidebarIsCollapsed) {
												if (entry.id === 'workspaces' && sidebarWorkspaces.length === 0) {
													void loadSidebarWorkspaces();
												}
												expandDesktopSidebarForEntry(entry.id, isGroup);
												return;
											}
											if (entry.id === 'workspaces') {
												setSidebarGroupsOpen((prev) => {
													const nextOpen = !Boolean(prev.workspaces);
													if (nextOpen && sidebarWorkspaces.length === 0) {
														void loadSidebarWorkspaces();
													}
													return { ...prev, workspaces: nextOpen };
												});
												return;
											}
											if (entry.id === 'trash') {
												setSidebarView('trash');
												if (isMobileViewport) closeMobileSidebar();
												return;
											}
											if (entry.id === 'notes') {
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
										<div className={`sidebar-submenu-shell${isOpen ? ' is-open' : ''}`}>
											<div className="sidebar-submenu sidebar-workspace-menu" aria-label={t('workspace.listAria')} aria-hidden={!isOpen}>
											{sidebarWorkspacesBusy ? (
													<div className="sidebar-workspace-muted sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: 0 }}>{t('common.loading')}</div>
											) : null}
											{sidebarWorkspacesError ? (
													<div className="sidebar-workspace-muted sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: 1 }}>{sidebarWorkspacesError}</div>
											) : null}
											{sidebarWorkspacesSorted.length === 0 && !sidebarWorkspacesBusy ? (
													<div className="sidebar-workspace-muted sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: 2 }}>{t('workspace.none')}</div>
											) : null}
											{sidebarWorkspacesSorted.map((ws) => {
												const isActive = Boolean(authWorkspaceId && ws.id === authWorkspaceId);
												return (
													<button
														key={ws.id}
														type="button"
															className={`sidebar-workspace-item sidebar-submenu-item${isActive ? ' is-active' : ''}`}
														onClick={() => void activateWorkspaceFromSidebar(ws.id)}
														title={ws.name || t('workspace.unnamed')}
															style={{ ['--sidebar-item-index' as const]: sidebarWorkspacesBusy || sidebarWorkspacesError ? 3 : 0 }}
													>
														{ws.name || t('workspace.unnamed')}
													</button>
												);
											})}
											<button
												type="button"
													className="sidebar-workspace-manage sidebar-submenu-action"
												onClick={() => {
													setSidebarGroupsOpen((prev) => ({ ...prev, workspaces: false }));
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
														<button key={item.id} type="button" className={className} style={{ ['--sidebar-item-index' as const]: index }}>
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

					{/* In trash view we hide the "create new note" affordances. */}
					{sidebarView !== 'trash' ? (
						<div ref={topActionsRef} className="top-actions">
							<button type="button" className="top-action-card" onClick={() => openCreateEditor('text')}>
								{t('app.createNewNote')}
							</button>
							<button type="button" className="top-action-card" onClick={() => openCreateEditor('checklist')}>
								{t('app.createNewChecklist')}
							</button>
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
						selectedNoteId={selectedNoteId}
						maxCardHeightPx={maxCardHeightPx}
						// When the trash view is active, NoteGrid switches to rendering trashed notes.
						showTrashed={sidebarView === 'trash'}
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
			{briefDialogMessage ? (
				<div className="brief-dialog" role="status" aria-live="polite">
					{briefDialogMessage}
				</div>
			) : null}

			<div className={`mobile-fab-stack${isFabOpen ? ' is-open' : ''}`}>
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
			</div>

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

			{/* Branch: selection exists but doc not yet loaded. */}
			{selectedNoteId && (!openDoc || openDocId !== selectedNoteId) ? <div>{t('app.loadingEditor')}</div> : null}
			{/* Branch: single active editor for the selected note. */}
			{selectedNoteId && openDoc && openDocId === selectedNoteId ? (
				<NoteEditor
					noteId={selectedNoteId}
					doc={openDoc}
					onClose={closeNoteEditor}
					onDelete={onDeleteSelectedNote}
					initialShowCompleted={checklistShowCompletedPref}
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
				}}
				t={t}
				workspaceId={authWorkspaceId}
			/>

			<WorkspaceSwitcherModal
				isOpen={isWorkspaceSwitcherOpen}
				onClose={() => {
					if (goBackIfOverlayHistory()) return;
					setIsWorkspaceSwitcherOpen(false);
				}}
				t={t}
				onWorkspaceActivated={handleWorkspaceActivated}
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
