import React from 'react';
import type * as Y from 'yjs';
import Cropper from 'react-easy-crop';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faArrowDownWideShort,
	faBars,
	faBarsStaggered,
	faBell,
	faCircleDot,
	faFileLines,
	faFolder,
	faGrip,
	faImage,
	faList,
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
import { UserModal } from './components/Preferences/UserModal';
import { type CropAreaPixels, getAvatarUploadBlob } from './core/avatarProfileImage';
import { SendInviteModal } from './components/Invites/SendInviteModal';
import { CollaboratorModal } from './components/Share/CollaboratorModal';
import { ShareNotificationsModal } from './components/Share/ShareNotificationsModal';
import { NoteDocumentBrowserModal } from './components/NoteAttachments/NoteDocumentBrowserModal';
import { NoteLinkBrowserModal } from './components/NoteAttachments/NoteLinkBrowserModal';
import { NoteImageUploadModal } from './components/NoteMedia/NoteImageUploadModal';
import { NoteMediaBrowserModal } from './components/NoteMedia/NoteMediaBrowserModal';
import { WorkspaceImagesGallery } from './components/NoteMedia/WorkspaceImagesGallery';
import { NoteDocumentUploadModal } from './components/NoteDocuments/NoteDocumentUploadModal';
import { MoveNoteModal } from './components/Workspaces/MoveNoteModal';
import { CollectionManagementModal } from './components/Workspaces/CollectionManagementModal';
import { NoteCollectionModal } from './components/Workspaces/NoteCollectionModal';
import { NoteLabelsModal } from './components/Workspaces/NoteLabelsModal';
import { ReminderModal } from './components/Workspaces/ReminderModal';
import { WorkspaceSwitcherModal } from './components/Workspaces/WorkspaceSwitcherModal';
import { TextEditor } from './components/Editors/TextEditor';
import { NoteGrid, type NoteGridCollaboratorFilter } from './components/NoteGrid/NoteGrid';
import type { NoteAttachmentBrowserKind } from './components/NoteAttachments/NoteAttachmentCountChip';
import { type ChecklistItem } from './core/bindings';
import { getDeviceId } from './core/deviceId';
import {
	clampFontScale,
	clampNoteCardMaxHeightPx,
	getDefaultNoteCardMaxHeightPx,
	isLocalAppearancePreferenceNewer,
	readCachedDeviceAppearancePreferences,
	writeCachedDeviceAppearancePreferences,
} from './core/deviceAppearancePreferences';
import { useDocumentManager } from './core/DocumentManagerContext';
import { type LocaleCode, useI18n } from './core/i18n';
import { initChecklistNoteDoc, initTextNoteDoc, makeNoteId, readNoteFromDoc } from './core/noteModel';
import { seedNoteCardCompletedExpandedByNoteId } from './core/noteCardCompletedExpansion';
import { applyTheme, getStoredThemeId, isLightTheme, persistThemeId, THEMES, type ThemeId } from './core/theme';
import { activateWorkspace, fetchUserPreferences, updateUserPreferences, type UserDevicePreferences } from './core/userDevicePreferencesApi';
import { useConnectionStatus } from './core/useConnectionStatus';
import { useIsCoarsePointer } from './core/useIsCoarsePointer';
import { useIsMobileLandscape } from './core/useIsMobileLandscape';
import { getPasswordStrengthLabel, getPasswordStrengthScore } from './core/passwordStrength';
import { createCollection, deleteCollection, getCollectionsRegistryDoc, readCollectionsFromDoc, subscribeCollections, updateCollection, type CollectionRecord, type CollectionTreeNode, buildCollectionTree, buildCollectionPathMap } from './services/collectionService';
import { createLabel, getLabelsRegistryDoc, readLabelsFromDoc, subscribeLabels, type LabelRecord } from './services/labelService';
import { assignNoteLabels, assignNoteReminder, assignNoteToCollection, markNoteAccessed, readNoteMetadataState } from './services/noteService';
import type { NoteGroupingMode, NoteSortMode, ReminderFilterMode, SortDirection } from './utilities/getVisibleNotes';
import {
	flushPendingCollaboratorActions,
	flushPendingNoteShareActions,
	listNoteShareInvitations,
	listSharedNotePlacements,
	readCachedNoteShareCollaborators,
	readPendingCollaboratorActions,
	syncNoteShareCollaborators,
	type SharedNotePlacement,
} from './core/noteShareApi';
import { addNotePreviewLinkToDoc, extractNoteLinksFromDoc, getNotePreviewLinksFromDoc, removeNotePreviewLinkFromDoc } from './core/noteLinks';
import { acceptShareToken, flushPendingShareLinkRequests, getShareTokenMetadata } from './core/shareLinks';
import { listFailedNoteLinks, type FailedNoteLinkRecord } from './core/noteLinkApi';
import { searchNotes, type NoteSearchMatchKind, type NoteSearchResult } from './core/noteMediaApi';
import { emptyTrashNow, moveNoteToWorkspace } from './core/noteManagementApi';
import { getAppDebugSessionId, logClientEvent } from './core/debugLogger';
import { flushPendingNoteMoves, queuePendingNoteMove, removePendingNoteMove } from './core/noteMoveQueue';
import {
	emitNoteMediaChanged,
	filterRemoteNoteImagesByPendingDeletes,
	getCachedRemoteNoteImages,
	readQueuedNoteImageDeletions,
	readQueuedNoteImages,
	readStoredRemoteNoteImages,
	scheduleQueuedNoteImageFlush,
} from './core/noteMediaStore';
import { emitNoteLinksChanged, flushQueuedNoteLinkSync, hasQueuedNoteLinkSync, scanAllDocumentsForPlaceholders, syncNoteLinksForDoc } from './core/noteLinkStore';
import {
	emitNoteDocumentsChanged,
	getCachedNoteDocuments,
	readQueuedNoteDocuments,
	readStoredRemoteNoteDocuments,
	scheduleQueuedNoteDocumentFlush,
} from './core/noteDocumentStore';
import { searchOfflineNotes } from './core/offlineSearch';
import { acknowledgePwaUpdated, applyPwaUpdate, deferPwaUpdate, promptInstallApp, PWA_SYNC_REQUEST_EVENT, setPwaUpdateBlocked, usePwaState } from './core/pwa';
import { onPushReceived } from './core/pushManager';
import { acknowledgeReminderNotifications, fetchFiredReminders, fetchPendingReminderCount, syncNoteReminder, type FiredReminder } from './core/pushApi';
import { cancelSyncOutboxWorker, flushSyncOutbox, getWorkspaceInviteConflictEventName, getWorkspaceInviteStateEventName, scheduleSyncOutboxFlush } from './core/syncOutbox';
import { listWorkspacePendingInvites } from './core/workspaceInviteApi';
import { canEditWorkspaceContent, canManageWorkspace, normalizeWorkspaceRole, type WorkspaceRole } from './core/workspaceRoles';
import {
	cacheActiveWorkspaceSelection,
	cacheWorkspaceDetails,
	cacheWorkspaceSnapshot,
	type CachedWorkspaceListItem,
	getWorkspaceMetadataChangedEventName,
	readPendingWorkspaceMutations,
	removePendingWorkspaceMutation,
	removeCachedWorkspace,
	readCachedWorkspaceSnapshot,
} from './core/workspaceMetadataStore';

const DOCUMENT_VIEWER_STATE_EVENT = 'freemannotes:document-viewer-state';
import { getWorkspaceDisplayName, isPersonalWorkspace } from './core/workspaceDisplay';
import { clearWorkspaceSelectionCache, readWorkspaceSelectionCache, writeWorkspaceSelectionCache } from './core/workspaceSelectionCache';
import { type ViewMode, cycleViewMode, loadViewMode, saveViewMode } from './core/viewMode';
import { BUBBLE_ZOOM_MAX, BUBBLE_ZOOM_MIN, loadBubbleZoom, saveBubbleZoom } from './core/bubbleZoom';
import { getWorkspaceBubbleColorScheme, toWorkspaceBubbleColorStyle } from './core/bubbleWorkspaceColors';
import { BubbleView, type BubbleWorkspaceInfo } from './components/BubbleView/BubbleView';

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

type MoveNoteModalState = {
	noteId: string;
	title: string;
};

type ToggleableSortMode = Extract<NoteSortMode, 'date-created' | 'date-updated' | 'alphabetical'>;

function isToggleableSortMode(value: string): value is ToggleableSortMode {
	return value === 'date-created' || value === 'date-updated' || value === 'alphabetical';
}

function getSortDirectionMarker(direction: SortDirection): string {
	return direction === 'asc' ? '▲' : '▼';
}

function truncateUiName(value: string, maxLength = 48): string {
	const normalized = String(value ?? '').trim();
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}...`;
}

const EMPTY_NOTE_METADATA_STATE = { collectionId: null, labelIds: [], reminderAt: null, isPinned: false, lastAccessedAt: '' };

function metadataSnapshotsEqual(
	left: { collectionId: string | null; labelIds: string[]; reminderAt: string | null; isPinned: boolean; lastAccessedAt: string },
	right: { collectionId: string | null; labelIds: string[]; reminderAt: string | null; isPinned: boolean; lastAccessedAt: string }
): boolean {
	if (left.collectionId !== right.collectionId) return false;
	if (left.reminderAt !== right.reminderAt) return false;
	if (left.isPinned !== right.isPinned) return false;
	if (left.lastAccessedAt !== right.lastAccessedAt) return false;
	if (left.labelIds.length !== right.labelIds.length) return false;
	for (let index = 0; index < left.labelIds.length; index++) {
		if (left.labelIds[index] !== right.labelIds[index]) return false;
	}
	return true;
}

function useNoteMetadataSnapshot(doc: Y.Doc | null): { collectionId: string | null; labelIds: string[]; reminderAt: string | null; isPinned: boolean; lastAccessedAt: string } {
	const snapshotRef = React.useRef(EMPTY_NOTE_METADATA_STATE);
	const subscribe = React.useCallback((onStoreChange: () => void) => {
		if (!doc) return () => undefined;
		const metadata = doc.getMap<any>('metadata');
		const notify = (): void => onStoreChange();
		metadata.observe(notify);
		return () => {
			metadata.unobserve(notify);
		};
	}, [doc]);
	const getSnapshot = React.useCallback(() => {
		if (!doc) {
			snapshotRef.current = EMPTY_NOTE_METADATA_STATE;
			return EMPTY_NOTE_METADATA_STATE;
		}
		const next = readNoteMetadataState(doc);
		if (metadataSnapshotsEqual(snapshotRef.current, next)) {
			return snapshotRef.current;
		}
		snapshotRef.current = next;
		return next;
	}, [doc]);
	return React.useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_NOTE_METADATA_STATE);
}

type MetadataNoteModalState = {
	noteId: string;
	title: string;
};

type OverlaySnapshot = {
	editorMode: EditorMode;
	selectedNoteId: string | null;
	isMobileSearchOpen: boolean;
	isPreferencesOpen: boolean;
	isAppearanceOpen: boolean;
	isUserOpen: boolean;
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
				systemKind: typeof workspace.systemKind === 'string' ? workspace.systemKind.toUpperCase() : null,
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
	isMobileSearchOpen: false,
	isPreferencesOpen: false,
	isAppearanceOpen: false,
	isUserOpen: false,
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

function hasOverlaySnapshotContent(snapshot: OverlaySnapshot): boolean {
	return snapshot.editorMode !== 'none'
		|| snapshot.selectedNoteId !== null
		|| snapshot.isMobileSearchOpen
		|| snapshot.isPreferencesOpen
		|| snapshot.isAppearanceOpen
		|| snapshot.isUserOpen
		|| snapshot.isUserManagementOpen
		|| snapshot.isSendInviteOpen
		|| snapshot.isWorkspaceSwitcherOpen
		|| snapshot.collaboratorModalState !== null
		|| snapshot.noteAttachmentBrowserState !== null
		|| snapshot.isMobileSidebarOpen
		|| snapshot.isFabOpen;
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

function clearAuthCache(): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.removeItem(AUTH_CACHE_KEY);
	} catch {
		// ignore
	}
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
	// Workspace selection cache is the source of truth for which workspace was last
	// selected on this device. It is written on every switch and is NOT overwritten by
	// the server's session response, preventing offline switches from being reverted.
	const cachedWorkspaceSelectionRef = React.useRef(readWorkspaceSelectionCache());
	const cachedWorkspaceSelection = cachedWorkspaceSelectionRef.current;
	const canRestoreCachedAuthImmediately = Boolean(
		cachedAuth && typeof navigator !== 'undefined' && navigator.onLine === false
	);
	const [authStatus, setAuthStatus] = React.useState<'loading' | 'authed' | 'unauth'>(() =>
		canRestoreCachedAuthImmediately ? 'authed' : 'loading'
	);
	// Splash overlay: shown only after an explicit login (unauth → authed).
	// On a normal page refresh the data comes from IndexedDB quickly, so we
	// skip the splash and rely on the card shimmer instead.
	// gridReady → starts fade-out; splashGone → removes the DOM node entirely.
	const [gridReady, setGridReady] = React.useState(false);
	const [splashGone, setSplashGone] = React.useState(true); // hidden by default
	const splashTimerRef = React.useRef<number>(0);
	const prevAuthStatusRef = React.useRef(authStatus);
	// Detect unauth → authed transition (user just logged in from scratch).
	// Using an effect so we get the previous value cleanly without render-side setState.
	React.useEffect(() => {
		if (prevAuthStatusRef.current === 'unauth' && authStatus === 'authed') {
			clearTimeout(splashTimerRef.current);
			setGridReady(false);
			setSplashGone(false); // show splash
		}
		prevAuthStatusRef.current = authStatus;
	}, [authStatus]);
	const [authMode, setAuthMode] = React.useState<'login' | 'register'>('login');
	const [authEmail, setAuthEmail] = React.useState('');
	const [authName, setAuthName] = React.useState('');
	const [authPassword, setAuthPassword] = React.useState('');
	const [authPasswordConfirm, setAuthPasswordConfirm] = React.useState('');
	const [authError, setAuthError] = React.useState<string | null>(null);
	const [authBusy, setAuthBusy] = React.useState(false);
	const [forgotPasswordOpen, setForgotPasswordOpen] = React.useState(false);
	const [forgotPasswordEmail, setForgotPasswordEmail] = React.useState('');
	const [forgotPasswordBusy, setForgotPasswordBusy] = React.useState(false);
	const [forgotPasswordMessage, setForgotPasswordMessage] = React.useState<string | null>(null);
	const [forgotPasswordError, setForgotPasswordError] = React.useState<string | null>(null);
	const [passwordResetToken, setPasswordResetToken] = React.useState<string | null>(() => {
		if (typeof window === 'undefined') return null;
		return new URL(window.location.href).searchParams.get('resetPassword');
	});
	const [resetPassword, setResetPassword] = React.useState('');
	const [resetPasswordConfirm, setResetPasswordConfirm] = React.useState('');
	const [resetPasswordBusy, setResetPasswordBusy] = React.useState(false);
	const [resetPasswordMessage, setResetPasswordMessage] = React.useState<string | null>(null);
	const [resetPasswordError, setResetPasswordError] = React.useState<string | null>(null);
	const [authUserId, setAuthUserId] = React.useState<string | null>(() => cachedAuth?.userId ?? null);
	const [authProfileImage, setAuthProfileImage] = React.useState<string | null>(() => cachedAuth?.profileImage ?? null);
	const [authWorkspaceId, setAuthWorkspaceId] = React.useState<string | null>(() => {
		if (cachedAuth && cachedWorkspaceSelection?.userId === cachedAuth.userId) {
			return cachedWorkspaceSelection.workspaceId;
		}
		return cachedAuth?.workspaceId ?? null;
	});
	const [bubbleWorkspaceSelectionId, setBubbleWorkspaceSelectionId] = React.useState<string | null>(() => {
		if (cachedAuth && cachedWorkspaceSelection?.userId === cachedAuth.userId) {
			return cachedWorkspaceSelection.workspaceId;
		}
		return cachedAuth?.workspaceId ?? null;
	});
	const [workspaceDeletedNotice, setWorkspaceDeletedNotice] = React.useState<{ hasOtherWorkspaces: boolean } | null>(null);
	const pwaState = usePwaState();
	const [pwaInstallBusy, setPwaInstallBusy] = React.useState(false);
	const [pwaUpdateDismissed, setPwaUpdateDismissed] = React.useState(false);
	const hasAppUpdateNotification = pwaState.updateAvailable && !pwaUpdateDismissed;
 	const hasAppUpdatedNotification = pwaState.updateApplied;
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
		logClientEvent('APP_INIT', {
			appDebugSessionId: getAppDebugSessionId(),
			userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
			online: typeof navigator !== 'undefined' ? navigator.onLine : null,
			url: typeof window !== 'undefined' ? window.location.href : null,
		});
	}, []);
	React.useEffect(() => {
		return () => {
			if (briefDialogTimeoutRef.current !== null) {
				window.clearTimeout(briefDialogTimeoutRef.current);
				briefDialogTimeoutRef.current = null;
			}
		};
	}, []);
	React.useEffect(() => {
		if (!pwaState.updateAvailable) {
			setPwaUpdateDismissed(false);
		}
	}, [pwaState.updateAvailable]);
	const offlineReadyNoticeRef = React.useRef(false);
	React.useEffect(() => {
		if (!pwaState.offlineReady || offlineReadyNoticeRef.current) return;
		offlineReadyNoticeRef.current = true;
		showBriefDialog(t('prefs.offlineReadyToast'));
	}, [pwaState.offlineReady, showBriefDialog, t]);
	// When the user is not yet authenticated and no cached auth exists, show a
	// minimal blank shell while the auth check completes (typically <200 ms).
	// No spinner or icon — the grid skeleton makes the startup feel instant.

	// Stable workspace key for NoteGrid:
	// Retains the last non-null workspace ID so transient auth churn (e.g. network
	// handoffs) doesn't unmount/remount the grid and lose in-memory measurement
	// caches, scroll position, and any in-progress drag state.
	const stableWorkspaceKeyRef = React.useRef<string>('no-workspace');
	if (authWorkspaceId) stableWorkspaceKeyRef.current = authWorkspaceId;
	const [authOfflineMode, setAuthOfflineMode] = React.useState(false);
	// Ref mirror of authOfflineMode so async callbacks (e.g. backgroundPreloadAllWorkspaces)
	// can read the latest value without capturing a stale closure.
	const authOfflineModeRef = React.useRef(authOfflineMode);
	authOfflineModeRef.current = authOfflineMode;
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
	// Which sidebar view is active: regular notes, workspace images, archive, or trash.
	const [sidebarView, setSidebarView] = React.useState<'notes' | 'images' | 'archive' | 'trash'>('notes');
	// UI mode for the "new note" panel.
	const [editorMode, setEditorMode] = React.useState<EditorMode>('none');
	// Phase 10 preferences shell entry point opened from top-right avatar.
	const [isPreferencesOpen, setIsPreferencesOpen] = React.useState(false);
	const [isAppearanceOpen, setIsAppearanceOpen] = React.useState(false);
	const [isUserOpen, setIsUserOpen] = React.useState(false);
	const [isUserManagementOpen, setIsUserManagementOpen] = React.useState(false);
	const [userModalBusy, setUserModalBusy] = React.useState(false);
	const [userModalError, setUserModalError] = React.useState<string | null>(null);
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
	const [pendingReminderNotificationCount, setPendingReminderNotificationCount] = React.useState(0);
	const [firedReminders, setFiredReminders] = React.useState<FiredReminder[]>([]);
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
	const pendingNewNoteIdsRef = React.useRef<Set<string>>(new Set());
	const pendingNewNoteCleanupIdsRef = React.useRef<Set<string>>(new Set());
	const pendingNewNoteCollectionSeedRef = React.useRef<Map<string, { collectionId: string; label: string }>>(new Map());
	const previousSelectedNoteIdRef = React.useRef<string | null>(null);
	const deviceId = React.useMemo(() => getDeviceId(), []);
	const cachedDeviceAppearancePrefs = React.useMemo(
		() => readCachedDeviceAppearancePreferences(deviceId, authUserId),
		[authUserId, deviceId]
	);
	const [themeId, setThemeId] = React.useState<ThemeId>(() => getStoredThemeId());
	const [noteCardFontScalePref, setNoteCardFontScalePref] = React.useState(
		() => cachedDeviceAppearancePrefs?.noteCardFontScale ?? 1
	);
	const [noteEditorFontScalePref, setNoteEditorFontScalePref] = React.useState(
		() => cachedDeviceAppearancePrefs?.noteEditorFontScale ?? 1
	);
	const [noteCardMaxHeightPref, setNoteCardMaxHeightPref] = React.useState(
		() => cachedDeviceAppearancePrefs?.noteCardMaxHeightPx ?? getDefaultNoteCardMaxHeightPx()
	);
	const [trashDeleteAfterDaysPref, setTrashDeleteAfterDaysPref] = React.useState<number | null>(30);
	const [checklistShowCompletedPref, setChecklistShowCompletedPref] = React.useState(
		() => cachedDeviceAppearancePrefs?.checklistShowCompleted ?? false
	);
	const [quickDeleteChecklistPref, setQuickDeleteChecklistPref] = React.useState(
		() => cachedDeviceAppearancePrefs?.quickDeleteChecklist ?? false
	);
	const [noteCardClickOpensPref, setNoteCardClickOpensPref] = React.useState(
		() => cachedDeviceAppearancePrefs?.noteCardClickOpens ?? true
	);
	const [prefsHydrationAttempted, setPrefsHydrationAttempted] = React.useState(false);
	const [searchQuery, setSearchQuery] = React.useState('');
	const deferredSearchQuery = React.useDeferredValue(searchQuery.trim());
	const [searchResults, setSearchResults] = React.useState<readonly NoteSearchResult[]>([]);
	const [searchResultsBusy, setSearchResultsBusy] = React.useState(false);
	const [searchResultsError, setSearchResultsError] = React.useState<string | null>(null);
	const [noteGridCollaboratorFilter, setNoteGridCollaboratorFilter] = React.useState<NoteGridCollaboratorFilter | null>(null);
	const [collectionsDoc, setCollectionsDoc] = React.useState<Y.Doc | null>(null);
	const [collections, setCollections] = React.useState<CollectionRecord[]>([]);
	const [labelsDoc, setLabelsDoc] = React.useState<Y.Doc | null>(null);
	const [labels, setLabels] = React.useState<LabelRecord[]>([]);
	const [activeCollectionId, setActiveCollectionId] = React.useState<string | null>(null);
	const [activeLabelIds, setActiveLabelIds] = React.useState<string[]>([]);
	const [activeReminderFilter, setActiveReminderFilter] = React.useState<ReminderFilterMode>('all');
	const [activeSortMode, setActiveSortMode] = React.useState<NoteSortMode>('manual');
	const [sortDirectionByMode, setSortDirectionByMode] = React.useState<Record<ToggleableSortMode, SortDirection>>({
		'date-created': 'desc',
		'date-updated': 'desc',
		alphabetical: 'asc',
	});
	const [activeSortGrouping, setActiveSortGrouping] = React.useState<NoteGroupingMode>('none');
	const [isCollectionManagementOpen, setIsCollectionManagementOpen] = React.useState(false);
	const [noteCollectionModalState, setNoteCollectionModalState] = React.useState<MetadataNoteModalState | null>(null);
	const [noteLabelsModalState, setNoteLabelsModalState] = React.useState<MetadataNoteModalState | null>(null);
	const [noteReminderModalState, setNoteReminderModalState] = React.useState<MetadataNoteModalState | null>(null);
	const [moveNoteModalState, setMoveNoteModalState] = React.useState<MoveNoteModalState | null>(null);
	const [moveNoteBusy, setMoveNoteBusy] = React.useState(false);
	const [moveNoteError, setMoveNoteError] = React.useState<string | null>(null);
	const [emptyTrashBusy, setEmptyTrashBusy] = React.useState(false);
	const [isMobileSearchOpen, setIsMobileSearchOpen] = React.useState(false);
	const [isFabOpen, setIsFabOpen] = React.useState(false);
	const [viewMode, setViewMode] = React.useState<ViewMode>(() => loadViewMode());
	const [bubbleZoom, setBubbleZoom] = React.useState(() => loadBubbleZoom());
	const viewModeIcon = viewMode === 'list'
		? faList
		: viewMode === 'strip'
			? faBarsStaggered
			: viewMode === 'bubble'
				? faCircleDot
				: faGrip;
	const cycleGridViewMode = React.useCallback(() => {
		const next = cycleViewMode(viewMode);
		setViewMode(next);
		saveViewMode(next);
	}, [viewMode]);
	React.useEffect(() => {
		saveBubbleZoom(bubbleZoom);
	}, [bubbleZoom]);
	const isCoarsePointer = useIsCoarsePointer();
	const isMobileLandscape = useIsMobileLandscape();
	const maxCardHeightPx = noteCardMaxHeightPref;
	const activeWorkspaceRole = React.useMemo<WorkspaceRole | null>(() => {
		if (!authWorkspaceId) return null;
		const match = sidebarWorkspaces.find((workspace) => workspace.id === authWorkspaceId);
		return match ? normalizeWorkspaceRole(match.role) : null;
	}, [authWorkspaceId, sidebarWorkspaces]);
	const bubbleSelectedWorkspace = React.useMemo(() => {
		const targetWorkspaceId = bubbleWorkspaceSelectionId || authWorkspaceId;
		if (!targetWorkspaceId) return null;
		return sidebarWorkspaces.find((workspace) => workspace.id === targetWorkspaceId) ?? null;
	}, [authWorkspaceId, bubbleWorkspaceSelectionId, sidebarWorkspaces]);
	const bubbleSelectedWorkspaceRole = React.useMemo<WorkspaceRole | null>(() => {
		return bubbleSelectedWorkspace ? normalizeWorkspaceRole(bubbleSelectedWorkspace.role) : null;
	}, [bubbleSelectedWorkspace]);
	const canManageActiveWorkspace = canManageWorkspace(activeWorkspaceRole);
	const canEditActiveWorkspace = canEditWorkspaceContent(activeWorkspaceRole);
	const canEditBubbleSelectedWorkspace = canEditWorkspaceContent(bubbleSelectedWorkspaceRole);

	React.useEffect(() => {
		if (!authWorkspaceId) {
			setBubbleWorkspaceSelectionId(null);
			return;
		}
		setBubbleWorkspaceSelectionId((current) => {
			if (current && sidebarWorkspaces.some((workspace) => workspace.id === current)) {
				return current;
			}
			return authWorkspaceId;
		});
	}, [authWorkspaceId, sidebarWorkspaces]);

	React.useEffect(() => {
		if (authStatus !== 'authed' || !authWorkspaceId) {
			setCollectionsDoc(null);
			setCollections([]);
			return;
		}
		let cancelled = false;
		let unsubscribe = (): void => {};
		void (async () => {
			const doc = await getCollectionsRegistryDoc(manager);
			if (cancelled) return;
			setCollectionsDoc(doc);
			setCollections(readCollectionsFromDoc(doc));
			unsubscribe = subscribeCollections(doc, () => {
				setCollections(readCollectionsFromDoc(doc));
			});
		})();
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [authStatus, authWorkspaceId, manager]);

	React.useEffect(() => {
		if (authStatus !== 'authed' || !authWorkspaceId) {
			setLabelsDoc(null);
			setLabels([]);
			return;
		}
		let cancelled = false;
		let unsubscribe = (): void => {};
		void (async () => {
			const doc = await getLabelsRegistryDoc(manager);
			if (cancelled) return;
			setLabelsDoc(doc);
			setLabels(readLabelsFromDoc(doc));
			unsubscribe = subscribeLabels(doc, () => {
				setLabels(readLabelsFromDoc(doc));
			});
		})();
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [authStatus, authWorkspaceId, manager]);
	const exitBackPressRef = React.useRef({ count: 0, lastAt: 0 });
	// Guard: prevent queuing multiple history.back() calls from rapid taps.
	// Reset in the popstate handler once the navigation actually completes.
	const isNavigatingBackRef = React.useRef(false);
	const currentOverlaySnapshotRef = React.useRef<OverlaySnapshot>(EMPTY_OVERLAY_SNAPSHOT);

	const getOverlaySnapshot = React.useCallback((): OverlaySnapshot => {
		return {
			editorMode,
			selectedNoteId,
			isMobileSearchOpen,
			isPreferencesOpen,
			isAppearanceOpen,
			isUserOpen,
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
		isMobileSearchOpen,
		isPreferencesOpen,
		isAppearanceOpen,
		isUserOpen,
		isUserManagementOpen,
		isSendInviteOpen,
		isWorkspaceSwitcherOpen,
		collaboratorModalState,
		noteAttachmentBrowserState,
		isMobileSidebarOpen,
		isFabOpen,
	]);

	React.useEffect(() => {
		currentOverlaySnapshotRef.current = getOverlaySnapshot();
	}, [getOverlaySnapshot]);

	const applyOverlaySnapshot = React.useCallback((snapshot: OverlaySnapshot) => {
		setEditorMode(snapshot.editorMode);
		setSelectedNoteId(snapshot.selectedNoteId);
		setIsMobileSearchOpen(snapshot.isMobileSearchOpen);
		setIsPreferencesOpen(snapshot.isPreferencesOpen);
		setIsAppearanceOpen(snapshot.isAppearanceOpen);
		setIsUserOpen(snapshot.isUserOpen);
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
				isMobileSearchOpen: false,
				isPreferencesOpen: true,
				isAppearanceOpen: false,
				isUserOpen: false,
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
				isMobileSearchOpen: false,
				isPreferencesOpen: false,
				isAppearanceOpen: true,
				isUserOpen: false,
				isUserManagementOpen: false,
				isSendInviteOpen: false,
				isWorkspaceSwitcherOpen: false,
				isFabOpen: false,
			},
			'push'
		);
	}, [commitOverlaySnapshot, getOverlaySnapshot]);

	const openUserFromPreferences = React.useCallback(() => {
		const current = getOverlaySnapshot();
		setUserModalError(null);
		commitOverlaySnapshot(
			{
				...current,
				isMobileSearchOpen: false,
				isPreferencesOpen: false,
				isAppearanceOpen: false,
				isUserOpen: true,
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

	const backToPreferencesFromUser = React.useCallback(() => {
		if (goBackIfOverlayHistory()) return;
		setIsUserOpen(false);
		setIsPreferencesOpen(true);
		setUserModalError(null);
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
		// Acknowledge any pending reminder notifications so the bell badge clears.
		if (pendingReminderNotificationCount > 0) {
			setPendingReminderNotificationCount(0);
			void acknowledgeReminderNotifications().catch(() => undefined);
		}
	}, [pendingReminderNotificationCount]);

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

	const openCollectionManagementModal = React.useCallback(() => {
		setIsCollectionManagementOpen(true);
	}, []);

	const openNoteCollectionModal = React.useCallback((noteId: string, title?: string) => {
		setNoteCollectionModalState({ noteId, title: title || '' });
	}, []);

	const openNoteLabelsModal = React.useCallback((noteId: string, title?: string) => {
		setNoteLabelsModalState({ noteId, title: title || '' });
	}, []);

	const openNoteReminderModal = React.useCallback((noteId: string, title?: string) => {
		setNoteReminderModalState({ noteId, title: title || '' });
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
				isMobileSearchOpen: false,
				isMobileSidebarOpen: true,
				isFabOpen: false,
			},
			'push'
		);
	}, [commitOverlaySnapshot, getOverlaySnapshot]);

	const openMobileSearch = React.useCallback(() => {
		const current = getOverlaySnapshot();
		commitOverlaySnapshot(
			{
				...current,
				isMobileSearchOpen: true,
				isMobileSidebarOpen: false,
				isFabOpen: false,
			},
			'push'
		);
	}, [commitOverlaySnapshot, getOverlaySnapshot]);

	const closeMobileSearch = React.useCallback(() => {
		if (goBackIfOverlayHistory()) return;
		setIsMobileSearchOpen(false);
	}, [goBackIfOverlayHistory]);

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
	const isPwaUpdateBlocked =
		isEditorOverlayOpen ||
		isPreferencesOpen ||
		isAppearanceOpen ||
		isUserOpen ||
		isUserManagementOpen ||
		isSendInviteOpen ||
		isShareNotificationsOpen ||
		isWorkspaceSwitcherOpen ||
		Boolean(collaboratorModalState) ||
		Boolean(noteImageModalState) ||
		Boolean(noteDocumentModalState) ||
		Boolean(noteAttachmentBrowserState) ||
		userModalBusy;
	const totalNotificationCount = pendingShareNotificationCount + pendingReminderNotificationCount + ((hasAppUpdateNotification || hasAppUpdatedNotification) ? 1 : 0);

	React.useEffect(() => {
		setPwaUpdateBlocked(isPwaUpdateBlocked);
		return () => {
			setPwaUpdateBlocked(false);
		};
	}, [isPwaUpdateBlocked]);

	const handleAddUrlPreviewFromBrowser = React.useCallback(() => {
		if (!noteAttachmentBrowserState?.canEdit) return;
		const next = window.prompt(t('links.prompt'), 'https://');
		if (!next) return;
		const doc = manager.getDoc(noteAttachmentBrowserState.noteId);
		const added = addNotePreviewLinkToDoc(doc, next);
		if (!added) return;
		void syncNoteLinksForDoc({
			userId: authUserId,
			docId: noteAttachmentBrowserState.docId,
			links: extractNoteLinksFromDoc(doc),
		});
	}, [authUserId, manager, noteAttachmentBrowserState, t]);

	const handleDeleteUrlPreviewFromBrowser = React.useCallback((normalizedUrl: string) => {
		if (!noteAttachmentBrowserState?.canEdit) return;
		const doc = manager.getDoc(noteAttachmentBrowserState.noteId);
		removeNotePreviewLinkFromDoc(doc, normalizedUrl);
		void syncNoteLinksForDoc({
			userId: authUserId,
			docId: noteAttachmentBrowserState.docId,
			links: extractNoteLinksFromDoc(doc),
		});
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
					isMobileSearchOpen: false,
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
			markNoteAccessed(manager.getDoc(noteId), manager.getAccessOrigin());
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
					isMobileSearchOpen: false,
					editorMode: 'none',
					selectedNoteId: noteId,
					isMobileSidebarOpen: false,
					isFabOpen: false,
				},
				shouldReplaceTop ? 'replace' : 'push'
			);
		},
		[commitOverlaySnapshot, getOverlaySnapshot, manager]
	);

	const closeNoteEditor = React.useCallback(() => {
		if (goBackIfOverlayHistory()) return;
		setSelectedNoteId(null);
		setEditorMode('none');
	}, [goBackIfOverlayHistory]);

	const getPendingNewNoteDisposition = React.useCallback(
		async (noteId: string): Promise<{ keep: boolean; type: 'text' | 'checklist' }> => {
			const doc = manager.getDoc(noteId);
			if (!doc) return { keep: true, type: 'text' };

			// New notes are created immediately so the full editor can enable attachments,
			// collaborators, reminders, and collection actions. Cleanup therefore needs to
			// treat any persisted metadata or queued media as intentional content.
			const snapshot = readNoteFromDoc(doc, noteId);
			if (snapshot.title.trim().length > 0) {
				return { keep: true, type: snapshot.type };
			}
			if (snapshot.type === 'text' && String(snapshot.content ?? '').trim().length > 0) {
				return { keep: true, type: snapshot.type };
			}
			if (snapshot.type === 'checklist' && (snapshot.items ?? []).some((item) => String(item.text ?? '').trim().length > 0)) {
				return { keep: true, type: snapshot.type };
			}
			if (snapshot.collectionId || snapshot.reminderAt || snapshot.labelIds.length > 0) {
				return { keep: true, type: snapshot.type };
			}
			if (getNotePreviewLinksFromDoc(doc).length > 0) {
				return { keep: true, type: snapshot.type };
			}

			const [storedImages, queuedImages, queuedImageDeletions, storedDocuments, queuedDocuments, collaboratorSnapshot, pendingCollaboratorQueue] = await Promise.all([
				readStoredRemoteNoteImages(noteId).catch(() => []),
				authUserId ? readQueuedNoteImages(authUserId, noteId).catch(() => []) : Promise.resolve([]),
				authUserId ? readQueuedNoteImageDeletions(authUserId, noteId).catch(() => []) : Promise.resolve([]),
				readStoredRemoteNoteDocuments(noteId).catch(() => []),
				authUserId ? readQueuedNoteDocuments(authUserId, noteId).catch(() => []) : Promise.resolve([]),
				authUserId ? readCachedNoteShareCollaborators(authUserId, noteId).catch(() => null) : Promise.resolve(null),
				authUserId ? readPendingCollaboratorActions(authUserId, noteId).catch(() => []) : Promise.resolve([]),
			]);

			const remoteImages = storedImages.length > 0 ? storedImages : getCachedRemoteNoteImages(noteId);
			if (filterRemoteNoteImagesByPendingDeletes(remoteImages, queuedImageDeletions).length + queuedImages.length > 0) {
				return { keep: true, type: snapshot.type };
			}
			if (Math.max(storedDocuments.length + queuedDocuments.length, getCachedNoteDocuments(noteId).length) > 0) {
				return { keep: true, type: snapshot.type };
			}
			if ((collaboratorSnapshot?.collaborators?.length ?? 0) > 0 || (collaboratorSnapshot?.pendingInvitations?.length ?? 0) > 0 || pendingCollaboratorQueue.length > 0) {
				return { keep: true, type: snapshot.type };
			}

			return { keep: false, type: snapshot.type };
		},
		[authUserId, manager]
	);

	const finalizePendingNewNote = React.useCallback(
		async (noteId: string): Promise<void> => {
			if (!pendingNewNoteIdsRef.current.has(noteId) || pendingNewNoteCleanupIdsRef.current.has(noteId)) return;
			pendingNewNoteCleanupIdsRef.current.add(noteId);
			try {
				const disposition = await getPendingNewNoteDisposition(noteId);
				pendingNewNoteIdsRef.current.delete(noteId);
				pendingNewNoteCollectionSeedRef.current.delete(noteId);
				if (disposition.keep) return;
				await manager.permanentlyDeleteNote(noteId).catch(() => undefined);
				showBriefDialog(disposition.type === 'checklist' ? 'empty checklist discarded' : 'empty note discarded');
			} finally {
				pendingNewNoteCleanupIdsRef.current.delete(noteId);
			}
		},
		[getPendingNewNoteDisposition, manager, showBriefDialog]
	);

	React.useEffect(() => {
		const previousSelectedNoteId = previousSelectedNoteIdRef.current;
		if (previousSelectedNoteId && previousSelectedNoteId !== selectedNoteId && pendingNewNoteIdsRef.current.has(previousSelectedNoteId)) {
			void finalizePendingNewNote(previousSelectedNoteId);
		}
		previousSelectedNoteIdRef.current = selectedNoteId;
	}, [finalizePendingNewNote, selectedNoteId]);

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
		const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
		const shouldDeferThemeSync = authOfflineMode || browserOffline;
		applyTheme(themeId);
		persistThemeId(themeId);
		if (authStatus !== 'authed') return;
		if (!prefsHydrationAttempted) return;
		if (shouldDeferThemeSync) {
			// Mark theme as needing a sync push when we reconnect so the server
			// preference hydration doesn't overwrite the local offline change.
			try { window.localStorage.setItem('freemannotes.pendingThemeSync', themeId); } catch { /* best effort */ }
			return;
		}
		void (async () => {
			const updatedPref = await updateUserPreferences(deviceId, { theme: themeId });
			if (!updatedPref) return;
			try {
				const pendingTheme = window.localStorage.getItem('freemannotes.pendingThemeSync');
				if (!pendingTheme || pendingTheme === themeId) {
					window.localStorage.removeItem('freemannotes.pendingThemeSync');
				}
			} catch {
				// best effort
			}
		})();
	}, [authStatus, authOfflineMode, deviceId, prefsHydrationAttempted, themeId]);

	React.useEffect(() => {
		const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
		const shouldDeferLanguageSync = authOfflineMode || browserOffline;
		if (authStatus !== 'authed') return;
		if (!prefsHydrationAttempted) return;
		if (shouldDeferLanguageSync) {
			try { window.localStorage.setItem('freemannotes.pendingLanguageSync', locale); } catch { /* best effort */ }
			return;
		}
		void (async () => {
			const updatedPref = await updateUserPreferences(deviceId, { language: locale });
			if (!updatedPref) return;
			try {
				const pendingLanguage = window.localStorage.getItem('freemannotes.pendingLanguageSync');
				if (!pendingLanguage || pendingLanguage === locale) {
					window.localStorage.removeItem('freemannotes.pendingLanguageSync');
				}
			} catch {
				// best effort
			}
		})();
	}, [authStatus, authOfflineMode, deviceId, locale, prefsHydrationAttempted]);

	const applyDevicePreferenceState = React.useCallback((next: {
		noteCardFontScale?: number | null;
		noteEditorFontScale?: number | null;
		noteCardMaxHeightPx?: number | null;
		checklistShowCompleted?: boolean;
		quickDeleteChecklist?: boolean;
		noteCardClickOpens?: boolean;
	}) => {
		setNoteCardFontScalePref(clampFontScale(next.noteCardFontScale ?? 1));
		setNoteEditorFontScalePref(clampFontScale(next.noteEditorFontScale ?? 1));
		setNoteCardMaxHeightPref(clampNoteCardMaxHeightPx(next.noteCardMaxHeightPx ?? getDefaultNoteCardMaxHeightPx()));
		setChecklistShowCompletedPref(Boolean(next.checklistShowCompleted));
		setQuickDeleteChecklistPref(Boolean(next.quickDeleteChecklist));
		setNoteCardClickOpensPref(next.noteCardClickOpens !== false);
	}, []);

	const persistDevicePrefsLocally = React.useCallback((next: {
		noteCardFontScale?: number;
		noteEditorFontScale?: number;
		noteCardMaxHeightPx?: number;
		checklistShowCompleted?: boolean;
		quickDeleteChecklist?: boolean;
		noteCardClickOpens?: boolean;
		updatedAt?: string;
	}) => {
		writeCachedDeviceAppearancePreferences({
			userId: authUserId ?? null,
			deviceId,
			noteCardFontScale: clampFontScale(next.noteCardFontScale ?? noteCardFontScalePref),
			noteEditorFontScale: clampFontScale(next.noteEditorFontScale ?? noteEditorFontScalePref),
			noteCardMaxHeightPx: clampNoteCardMaxHeightPx(next.noteCardMaxHeightPx ?? noteCardMaxHeightPref),
			checklistShowCompleted: next.checklistShowCompleted ?? checklistShowCompletedPref,
			quickDeleteChecklist: next.quickDeleteChecklist ?? quickDeleteChecklistPref,
			noteCardClickOpens: next.noteCardClickOpens ?? noteCardClickOpensPref,
			updatedAt: next.updatedAt ?? new Date().toISOString(),
		});
	}, [authUserId, checklistShowCompletedPref, deviceId, noteCardClickOpensPref, noteCardFontScalePref, noteCardMaxHeightPref, noteEditorFontScalePref, quickDeleteChecklistPref]);

	const syncLocalDevicePrefsFromServer = React.useCallback((pref: UserDevicePreferences): void => {
		applyDevicePreferenceState(pref);
		persistDevicePrefsLocally({
			noteCardFontScale: pref.noteCardFontScale,
			noteEditorFontScale: pref.noteEditorFontScale,
			noteCardMaxHeightPx: pref.noteCardMaxHeightPx ?? getDefaultNoteCardMaxHeightPx(),
			checklistShowCompleted: pref.checklistShowCompleted,
			quickDeleteChecklist: pref.quickDeleteChecklist,
			noteCardClickOpens: pref.noteCardClickOpens,
			updatedAt: pref.updatedAt ?? new Date().toISOString(),
		});
	}, [applyDevicePreferenceState, persistDevicePrefsLocally]);

	const handleNoteCardFontScaleChange = React.useCallback((nextScale: number) => {
		const normalized = clampFontScale(nextScale);
		setNoteCardFontScalePref(normalized);
		persistDevicePrefsLocally({ noteCardFontScale: normalized });
	}, [persistDevicePrefsLocally]);

	const commitNoteCardFontScaleChange = React.useCallback((nextScale: number) => {
		const normalized = clampFontScale(nextScale);
		setNoteCardFontScalePref(normalized);
		persistDevicePrefsLocally({ noteCardFontScale: normalized });
		if (authStatus !== 'authed' || authOfflineMode || !prefsHydrationAttempted) return;
		void (async () => {
			const updated = await updateUserPreferences(deviceId, { noteCardFontScale: normalized });
			if (!updated) return;
			syncLocalDevicePrefsFromServer(updated);
		})();
	}, [authOfflineMode, authStatus, deviceId, persistDevicePrefsLocally, prefsHydrationAttempted, syncLocalDevicePrefsFromServer]);

	const handleNoteEditorFontScaleChange = React.useCallback((nextScale: number) => {
		const normalized = clampFontScale(nextScale);
		setNoteEditorFontScalePref(normalized);
		persistDevicePrefsLocally({ noteEditorFontScale: normalized });
	}, [persistDevicePrefsLocally]);

	const commitNoteEditorFontScaleChange = React.useCallback((nextScale: number) => {
		const normalized = clampFontScale(nextScale);
		setNoteEditorFontScalePref(normalized);
		persistDevicePrefsLocally({ noteEditorFontScale: normalized });
		if (authStatus !== 'authed' || authOfflineMode || !prefsHydrationAttempted) return;
		void (async () => {
			const updated = await updateUserPreferences(deviceId, { noteEditorFontScale: normalized });
			if (!updated) return;
			syncLocalDevicePrefsFromServer(updated);
		})();
	}, [authOfflineMode, authStatus, deviceId, persistDevicePrefsLocally, prefsHydrationAttempted, syncLocalDevicePrefsFromServer]);

	const handleNoteCardMaxHeightChange = React.useCallback((nextHeight: number) => {
		const normalized = clampNoteCardMaxHeightPx(nextHeight);
		setNoteCardMaxHeightPref(normalized);
		persistDevicePrefsLocally({ noteCardMaxHeightPx: normalized });
	}, [persistDevicePrefsLocally]);

	const commitNoteCardMaxHeightChange = React.useCallback((nextHeight: number) => {
		const normalized = clampNoteCardMaxHeightPx(nextHeight);
		setNoteCardMaxHeightPref(normalized);
		persistDevicePrefsLocally({ noteCardMaxHeightPx: normalized });
		if (authStatus !== 'authed' || authOfflineMode || !prefsHydrationAttempted) return;
		void (async () => {
			const updated = await updateUserPreferences(deviceId, { noteCardMaxHeightPx: normalized });
			if (!updated) return;
			syncLocalDevicePrefsFromServer(updated);
		})();
	}, [authOfflineMode, authStatus, deviceId, persistDevicePrefsLocally, prefsHydrationAttempted, syncLocalDevicePrefsFromServer]);

	const commitChecklistShowCompletedPref = React.useCallback((next: boolean) => {
		setChecklistShowCompletedPref(next);
		persistDevicePrefsLocally({ checklistShowCompleted: next });
		if (authStatus !== 'authed' || authOfflineMode || !prefsHydrationAttempted) return;
		void (async () => {
			const updated = await updateUserPreferences(deviceId, { checklistShowCompleted: next });
			if (!updated) return;
			syncLocalDevicePrefsFromServer(updated);
		})();
	}, [authOfflineMode, authStatus, deviceId, persistDevicePrefsLocally, prefsHydrationAttempted, syncLocalDevicePrefsFromServer]);

	const commitQuickDeleteChecklistPref = React.useCallback((next: boolean) => {
		setQuickDeleteChecklistPref(next);
		persistDevicePrefsLocally({ quickDeleteChecklist: next });
		if (authStatus !== 'authed' || authOfflineMode || !prefsHydrationAttempted) return;
		void (async () => {
			const updated = await updateUserPreferences(deviceId, { quickDeleteChecklist: next });
			if (!updated) return;
			syncLocalDevicePrefsFromServer(updated);
		})();
	}, [authOfflineMode, authStatus, deviceId, persistDevicePrefsLocally, prefsHydrationAttempted, syncLocalDevicePrefsFromServer]);

	const commitNoteCardClickOpensPref = React.useCallback((next: boolean) => {
		setNoteCardClickOpensPref(next);
		persistDevicePrefsLocally({ noteCardClickOpens: next });
		if (authStatus !== 'authed' || authOfflineMode || !prefsHydrationAttempted) return;
		void (async () => {
			const updated = await updateUserPreferences(deviceId, { noteCardClickOpens: next });
			if (!updated) return;
			syncLocalDevicePrefsFromServer(updated);
		})();
	}, [authOfflineMode, authStatus, deviceId, persistDevicePrefsLocally, prefsHydrationAttempted, syncLocalDevicePrefsFromServer]);

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
			// Guard: if the server returns a different workspace than the locally-selected one,
			// the server session is stale (e.g. an offline workspace switch is still being
			// activated). Skip updating the label to avoid a transient flip to the old name.
			if (body?.id && String(body.id) !== authWorkspaceId) {
				return;
			}
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
		const cachedWorkspaceSelection = readWorkspaceSelectionCache();
		if (!cached) return false;
		const restoredWorkspaceId = cachedWorkspaceSelection?.userId === cached.userId
			? cachedWorkspaceSelection.workspaceId
			: cached.workspaceId;
		setAuthStatus('authed');
		setAuthUserId(cached.userId);
		setAuthProfileImage(cached.profileImage);
		setAuthWorkspaceId(restoredWorkspaceId);
		setAuthOfflineMode(true);
		writeWorkspaceSelectionCache({ userId: cached.userId, workspaceId: restoredWorkspaceId });
		manager.setWebsocketEnabled(false);
		manager.setActiveWorkspaceId(restoredWorkspaceId);
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

				// Preserve the locally selected workspace (e.g. an offline switch) rather than
				// unconditionally reverting to the server's active workspace on reconnect.
				const existingSelection = readWorkspaceSelectionCache();
				const effectiveWorkspaceId =
					existingSelection?.userId === userId && existingSelection?.workspaceId
						? existingSelection.workspaceId
						: workspaceId;
				setAuthStatus('authed');
				setAuthUserId(userId);
				setAuthProfileImage(profileImage);
				setAuthWorkspaceId(effectiveWorkspaceId);
				setAuthOfflineMode(false);
				writeAuthCache({ v: 1, userId, workspaceId: effectiveWorkspaceId, profileImage });
				// Keep the local workspace-selection cache warm even when the user never
				// explicitly switches workspaces on this device. Refresh bootstrap may
				// otherwise fall back to a transient server-side workspace cookie.
				writeWorkspaceSelectionCache({ userId, workspaceId: effectiveWorkspaceId });
				// If the local selection differs from the server's active workspace (e.g. an
				// offline switch that has not been synced yet), we MUST activate workspace B on
				// the server before enabling WebSocket sync. Enabling WS before activation
				// completes causes the server to reject the workspace B room names with
				// "forbidden namespace" errors, which triggers an infinite reconnect storm.
				if (effectiveWorkspaceId && effectiveWorkspaceId !== workspaceId) {
					// Keep WS disabled while we re-activate on the server. Only enabling WS
					// AFTER activation completes prevents "forbidden namespace" loops where
					// the client opens workspace-B rooms before the server session is updated.
					manager.setWebsocketEnabled(false);
					// Point the manager at the intended workspace only after WS is disabled,
					// otherwise it eagerly opens the new registry rooms against the old cookie.
					manager.setActiveWorkspaceId(effectiveWorkspaceId);

					// Flush offline edits from EVERY workspace that has local IndexedDB data,
					// not just the server's current one. While offline the user may have switched
					// between many workspaces and edited notes in each. The WS auth is tied to the
					// server session, so we must activate each workspace in turn, flush its edits,
					// then move on — and finally activate the desired target workspace.
					let localWorkspaceIds = await manager.discoverLocalWorkspaceIds();
					if (localWorkspaceIds.length === 0) {
						// Fallback: indexedDB.databases() not available — use the cached workspace list.
						const snapshot = await readCachedWorkspaceSnapshot(userId, deviceId);
						localWorkspaceIds = snapshot.workspaces.map((w) => w.id);
					}
					// Exclude the target workspace — it will sync normally once its session is active.
					const idsToFlush = localWorkspaceIds.filter((id) => id !== effectiveWorkspaceId);

					// Flush the server's currently-authorized workspace first (no activation needed).
					if (workspaceId && idsToFlush.includes(workspaceId)) {
						await manager.flushPreviousWorkspaceEdits(workspaceId, 5_000);
					}

					// For every other workspace with local data, activate on server then flush.
					let flushNetworkFailed = false;
					for (const wsId of idsToFlush.filter((id) => id !== workspaceId)) {
						try {
							const res = await fetch(
								`/api/workspaces/${encodeURIComponent(wsId)}/activate`,
								{
									method: 'POST',
									credentials: 'include',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ deviceId }),
								}
							);
							if (!res.ok) continue; // Lost access to this workspace — skip it.
						} catch {
							flushNetworkFailed = true;
							break; // Network dropped — stop flushing.
						}
						await manager.flushPreviousWorkspaceEdits(wsId, 5_000);
					}

					if (flushNetworkFailed) {
						// Network went down mid-flush — treat as offline, preserve local selection.
						setAuthOfflineMode(true);
						manager.setWebsocketEnabled(false);
					} else {
						// All preceding workspaces flushed. Now activate the target workspace.
						let activatedWorkspaceId: string | null = effectiveWorkspaceId;
						let activationNetworkError = false;
						try {
							const activateRes = await fetch(
								`/api/workspaces/${encodeURIComponent(effectiveWorkspaceId)}/activate`,
								{
									method: 'POST',
									credentials: 'include',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ deviceId }),
								}
							);
							if (!activateRes.ok) {
								// Server explicitly rejected B (403/404/etc): revert to server's workspace.
								activatedWorkspaceId = workspaceId;
							}
						} catch {
							// Network error: the server is genuinely unreachable (the /api/auth/me
							// response was likely served from the service-worker cache). Keep the
							// locally-selected workspace and go into offline mode instead of reverting
							// to the stale server workspace.
							activationNetworkError = true;
						}

						if (activationNetworkError) {
							// Treat as offline: preserve the locally-selected workspace and disable sync.
							setAuthOfflineMode(true);
							manager.setWebsocketEnabled(false);
						} else if (activatedWorkspaceId !== effectiveWorkspaceId) {
							// Server rejected target: revert so WS rooms align with existing session.
							manager.setActiveWorkspaceId(activatedWorkspaceId);
							setAuthWorkspaceId(activatedWorkspaceId);
							writeAuthCache({ v: 1, userId, workspaceId: activatedWorkspaceId, profileImage });
							writeWorkspaceSelectionCache({ userId, workspaceId: activatedWorkspaceId });
							manager.setWebsocketEnabled(Boolean(activatedWorkspaceId));
						} else {
							manager.setWebsocketEnabled(Boolean(effectiveWorkspaceId));
						}
					}
				} else {
					manager.setActiveWorkspaceId(effectiveWorkspaceId);
					manager.setWebsocketEnabled(Boolean(effectiveWorkspaceId));
				}
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

	const refreshAuthenticatedProfile = React.useCallback(async (): Promise<string | null> => {
		if (authStatus !== 'authed') return null;
		try {
			const res = await fetch(`/api/auth/me?deviceId=${encodeURIComponent(deviceId)}`, {
				credentials: 'include',
			});
			const contentType = String(res.headers.get('content-type') || '').toLowerCase();
			if (!res.ok || !contentType.includes('application/json')) return null;

			const body = await res.json().catch(() => null);
			const userId = body?.user?.id ? String(body.user.id) : null;
			if (!userId) return null;
			const profileImage = body?.user?.profileImage ? String(body.user.profileImage) : null;
			const workspaceId = body?.workspaceId ? String(body.workspaceId) : null;

			const existingSelection = readWorkspaceSelectionCache();
			const effectiveWorkspaceId =
				existingSelection?.userId === userId && existingSelection?.workspaceId
					? existingSelection.workspaceId
					: workspaceId;
			setAuthUserId(userId);
			setAuthProfileImage(profileImage);
			setAuthWorkspaceId(effectiveWorkspaceId);
			setAuthStatus('authed');
			setAuthOfflineMode(false);
			if (effectiveWorkspaceId && effectiveWorkspaceId !== workspaceId) {
				manager.setWebsocketEnabled(false);
			}
			manager.setActiveWorkspaceId(effectiveWorkspaceId);
			manager.setWebsocketEnabled(Boolean(effectiveWorkspaceId) && effectiveWorkspaceId === workspaceId);
			writeAuthCache({ v: 1, userId, workspaceId: effectiveWorkspaceId, profileImage });
			writeWorkspaceSelectionCache({ userId, workspaceId: effectiveWorkspaceId });
			return profileImage;
		} catch {
			return null;
		}
	}, [authStatus, deviceId, manager]);

	const refreshAuthenticatedProfileRef = React.useRef(refreshAuthenticatedProfile);

	React.useEffect(() => {
		refreshAuthenticatedProfileRef.current = refreshAuthenticatedProfile;
	}, [refreshAuthenticatedProfile]);

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
			const cachedAppearance = readCachedDeviceAppearancePreferences(deviceId, authUserId);
			if (cachedAppearance) {
				applyDevicePreferenceState(cachedAppearance);
			}
			setPrefsHydrationAttempted(true);
			return;
		}
		let cancelled = false;
		(async () => {
			const localSnapshot = authUserId ? await readCachedWorkspaceSnapshot(authUserId, deviceId) : null;
			const localAppearanceSnapshot = readCachedDeviceAppearancePreferences(deviceId, authUserId);
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
				// If the user changed theme/language while offline, push the local
				// value to the server instead of overwriting it with the stale
				// server preference.
				const pendingTheme = (() => { try { return window.localStorage.getItem('freemannotes.pendingThemeSync'); } catch { return null; } })();
				const pendingLanguage = (() => { try { return window.localStorage.getItem('freemannotes.pendingLanguageSync'); } catch { return null; } })();
				if (pendingTheme) {
					const pendingThemeId = pendingTheme as ThemeId;
					setThemeId(pendingThemeId);
					const updatedPref = await updateUserPreferences(deviceId, { theme: pendingThemeId });
					if (updatedPref) {
						try {
							if (window.localStorage.getItem('freemannotes.pendingThemeSync') === pendingThemeId) {
								window.localStorage.removeItem('freemannotes.pendingThemeSync');
							}
						} catch {
							// best effort
						}
					}
				} else if (pref.theme) {
					setThemeId(pref.theme as ThemeId);
				}
				if (pendingLanguage) {
					const pendingLocale = pendingLanguage as LocaleCode;
					setLocale(pendingLocale);
					const updatedPref = await updateUserPreferences(deviceId, { language: pendingLocale });
					if (updatedPref) {
						try {
							if (window.localStorage.getItem('freemannotes.pendingLanguageSync') === pendingLocale) {
								window.localStorage.removeItem('freemannotes.pendingLanguageSync');
							}
						} catch {
							// best effort
						}
					}
				} else if (pref.language) {
					setLocale(pref.language as LocaleCode);
				}
				const localAppearanceNewer = Boolean(
					localAppearanceSnapshot && isLocalAppearancePreferenceNewer(localAppearanceSnapshot.updatedAt, pref.updatedAt)
				);
				if (localAppearanceSnapshot && localAppearanceNewer) {
					applyDevicePreferenceState(localAppearanceSnapshot);
					const updatedAppearance = await updateUserPreferences(deviceId, {
						noteCardFontScale: localAppearanceSnapshot.noteCardFontScale,
						noteEditorFontScale: localAppearanceSnapshot.noteEditorFontScale,
						noteCardMaxHeightPx: localAppearanceSnapshot.noteCardMaxHeightPx,
						checklistShowCompleted: localAppearanceSnapshot.checklistShowCompleted,
						quickDeleteChecklist: localAppearanceSnapshot.quickDeleteChecklist,
						noteCardClickOpens: localAppearanceSnapshot.noteCardClickOpens,
					});
					if (!cancelled && updatedAppearance) {
						syncLocalDevicePrefsFromServer(updatedAppearance);
					}
				} else {
					syncLocalDevicePrefsFromServer(pref);
				}
				setTrashDeleteAfterDaysPref(pref.deleteAfterDays ?? null);
				seedNoteCardCompletedExpandedByNoteId(pref.noteCardCompletedExpandedByNoteId || {});
			}
			setPrefsHydrationAttempted(true);
		})();
		return () => {
			cancelled = true;
		};
	}, [applyDevicePreferenceState, authOfflineMode, authStatus, authUserId, deviceId, setLocale, syncLocalDevicePrefsFromServer]);

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
			// The workspace selection cache (localStorage) is written on every switch and is
			// authoritative at startup. Only fall back to the IndexedDB snapshot if no
			// workspace is set at all — never override an already-determined workspace,
			// as the snapshot can lag behind the latest offline switch.
			const shouldHydrateFromSnapshot = Boolean(
				snapshot.activeWorkspaceId && !authWorkspaceId
			);
			if (shouldHydrateFromSnapshot && snapshot.activeWorkspaceId) {
				setAuthWorkspaceId(snapshot.activeWorkspaceId);
				manager.setWebsocketEnabled(false);
				manager.setActiveWorkspaceId(snapshot.activeWorkspaceId);
				setPendingRestoredSharedFolder(snapshot.activeSharedFolder ?? null);
				writeAuthCache({
					v: 1,
					userId: authUserId,
					workspaceId: snapshot.activeWorkspaceId,
					profileImage: authProfileImage,
				});
				writeWorkspaceSelectionCache({
					userId: authUserId,
					workspaceId: snapshot.activeWorkspaceId,
					activeSharedFolder: snapshot.activeSharedFolder ?? null,
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
					// Always probe the session when going back online to ensure the server JWT
					// is aligned with the locally-selected workspace. Workspace switches made
					// while offline need server-side activation regardless of whether authOfflineMode
					// is true (started offline) or false (was online, went offline, switched workspace).
					// probeSession only enables WebSocket AFTER activation completes.
					await probeSession({ allowOfflineRestore: true });
					// After the session is fully established, kick off a background preload
					// so any workspaces the user has not visited on this device are pulled
					// into IndexedDB and available offline. Fire-and-forget — errors are
					// swallowed inside the callback.
					void backgroundPreloadAllWorkspacesRef.current();
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
	}, [authStatus, authUserId, deviceId, manager, probeSession]);

	// Trigger an initial background preload when the user is online and authenticated
	// with a workspace list. This covers the case where the user logs in while already
	// online (the onOnline handler above fires immediately via navigator.onLine, but by
	// the time loadSidebarWorkspaces completes the sidebarWorkspaces state update is
	// async, so this effect is the reliable trigger once data lands). Uses a 5-second
	// delay so the active workspace is fully connected before we start cycling sessions.
	React.useEffect(() => {
		if (authStatus !== 'authed' || authOfflineMode || sidebarWorkspaces.length <= 1) return;
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
		const timer = window.setTimeout(() => {
			void backgroundPreloadAllWorkspacesRef.current();
		}, 5_000);
		return () => window.clearTimeout(timer);
	// Re-run only when workspace count changes or auth/offline state changes.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [authOfflineMode, authStatus, sidebarWorkspaces.length]);

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
		setIsUserOpen(false);
		setUserModalBusy(false);
		setUserModalError(null);
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
				writeWorkspaceSelectionCache({ userId: authUserId, workspaceId: null, activeSharedFolder: null });
				if (opts?.preserveAuthCache) {
					writeAuthCache({ v: 1, userId: authUserId, workspaceId: null, profileImage: authProfileImage });
				}
			} else {
				clearWorkspaceSelectionCache();
			}
		},
		[authProfileImage, authUserId, deviceId, manager]
	);

	const handleWorkspaceActivated = React.useCallback(
		(workspaceId: string) => {
			// NoteGrid remounts (key changes) when the workspace changes; the new
			// instance resets allDocsLoaded and shows skeleton cards during hydration.
			setAuthWorkspaceId(workspaceId);
			manager.setActiveWorkspaceId(workspaceId);
			setSelectedNoteId(null);
			setOpenDoc(null);
			setOpenDocId(null);
			setEditorMode('none');
			setActiveSharedFolder(null);
			// Cancel any in-progress background preload so it cannot re-activate a
			// previous workspace and clobber the user's intentional switch.
			backgroundPreloadAbortRef.current++;
			backgroundPreloadRunningRef.current = false;
			const cachedAuth = readAuthCache();
			const cacheUserId = authUserId || cachedAuth?.userId || null;
			const cacheProfileImage = authProfileImage ?? cachedAuth?.profileImage ?? null;
			if (cacheUserId) {
				writeAuthCache({ v: 1, userId: cacheUserId, workspaceId, profileImage: cacheProfileImage });
				writeWorkspaceSelectionCache({ userId: cacheUserId, workspaceId, activeSharedFolder: null });
			}
			if (authUserId) {
				void cacheActiveWorkspaceSelection({
					userId: authUserId,
					deviceId,
					activeWorkspaceId: workspaceId,
					activeSharedFolder: null,
				});
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
				writeWorkspaceSelectionCache({ userId: authUserId, workspaceId, activeSharedFolder: normalizedFolder });
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

				if (mutation.kind === 'rename') {
					const res = await fetch(`/api/workspaces/${encodeURIComponent(mutation.workspaceId)}`, {
						method: 'PATCH',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ name: mutation.workspaceName || '' }),
					});
					const body = await res.json().catch(() => null);
					if (!res.ok && res.status !== 404 && res.status !== 403) {
						const message = body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
						throw new Error(message);
					}
					if (body?.workspace) {
						await cacheWorkspaceDetails({
							workspace: {
								id: String(body.workspace.id),
								name: typeof body.workspace.name === 'string' ? body.workspace.name : mutation.workspaceName || '',
								ownerUserId: typeof body.workspace.ownerUserId === 'string' ? body.workspace.ownerUserId : authUserId,
							},
							userId: authUserId,
							role: mutation.role || 'OWNER',
						});
					}
					await removePendingWorkspaceMutation({
						userId: authUserId,
						deviceId,
						workspaceId: mutation.workspaceId,
						kind: 'rename',
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

	// ── Background preload ────────────────────────────────────────────────────
	// When the user is online and authenticated, pre-populate IndexedDB for every
	// workspace so data is available offline WITHOUT the user having to visit each
	// workspace first. This runs as a fire-and-forget background task.
	//
	// The server enforces per-session workspace isolation for WS connections, so
	// we must briefly activate each workspace on the server, sync its rooms, then
	// restore the user's current session. Existing WS connections for the active
	// workspace are NOT affected by the session switch (the server only checks auth
	// at connection time, not per-message).
	//
	// An abort-ID mechanism cancels the loop if the user manually switches workspace
	// during a preload cycle (to prevent the "restore" activation from clobbering
	// the user's intentional switch).
	const backgroundPreloadAbortRef = React.useRef(0);
	const backgroundPreloadRunningRef = React.useRef(false);
	const authWorkspaceIdRef = React.useRef(authWorkspaceId);
	authWorkspaceIdRef.current = authWorkspaceId;

	/**
	 * Iterate every workspace the user belongs to (except the current one) and pull
	 * its full dataset (registry + all notes) into IndexedDB via temporary Yjs
	 * providers. This ensures every workspace is available offline even if the user
	 * has never visited it on this device.
	 *
	 * Sequence per workspace:
	 *   1. POST /activate to align the server session with this workspace.
	 *   2. Call DocumentManager.preloadWorkspaceFromServer() — syncs registry + notes.
	 *   3. Continue to next workspace.
	 * Finally: restore the server session to the user's actual current workspace.
	 *
	 * The loop is aborted immediately if the user manually switches workspace
	 * (backgroundPreloadAbortRef is incremented by handleWorkspaceActivated).
	 */
	const backgroundPreloadAllWorkspaces = React.useCallback(async (): Promise<void> => {
		if (backgroundPreloadRunningRef.current) return;
		if (authStatus !== 'authed' || !authUserId || authOfflineMode) return;
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

		const workspaces = sidebarWorkspacesRef.current;
		const currentWorkspaceId = authWorkspaceIdRef.current;
		if (!currentWorkspaceId || workspaces.length <= 1) return;

		backgroundPreloadRunningRef.current = true;
		const preloadId = ++backgroundPreloadAbortRef.current;
		const aborted = (): boolean => backgroundPreloadAbortRef.current !== preloadId;

		const otherWorkspaces = workspaces.filter((w) => w.id !== currentWorkspaceId);
		let lastActivatedId = currentWorkspaceId;

		try {
			for (const workspace of otherWorkspaces) {
				if (aborted()) break;
				if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
				try {
					const res = await fetch(
						`/api/workspaces/${encodeURIComponent(workspace.id)}/activate`,
						{
							method: 'POST',
							credentials: 'include',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ deviceId }),
						}
					);
					if (!res.ok) continue; // lost access — skip without aborting
					lastActivatedId = workspace.id;
				} catch {
					break; // network gone
				}
				if (aborted()) break;
				await manager.preloadWorkspaceFromServer(workspace.id, 8_000);
			}
		} finally {
			backgroundPreloadRunningRef.current = false;
			// Restore the session to whatever workspace the user currently has active.
			// Read from the ref so we use the up-to-date value even if the user
			// switched workspaces during the preload loop.
			const restoreId = authWorkspaceIdRef.current ?? currentWorkspaceId;
			if (!aborted() && lastActivatedId !== restoreId && restoreId) {
				try {
					await fetch(
						`/api/workspaces/${encodeURIComponent(restoreId)}/activate`,
						{
							method: 'POST',
							credentials: 'include',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ deviceId }),
						}
					);
				} catch {
					// best effort
				}
			}
		}
	}, [authOfflineMode, authStatus, authUserId, deviceId, manager]);

	const backgroundPreloadAllWorkspacesRef = React.useRef(backgroundPreloadAllWorkspaces);
	React.useEffect(() => {
		backgroundPreloadAllWorkspacesRef.current = backgroundPreloadAllWorkspaces;
	}, [backgroundPreloadAllWorkspaces]);

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
		setActiveCollectionId(null);
		setActiveLabelIds([]);
		setActiveReminderFilter('all');
		setActiveSortMode('manual');
		setActiveSortGrouping('none');
	}, [activeSharedFolder, authWorkspaceId, sidebarView]);

	const collectionTree = React.useMemo(() => buildCollectionTree(collections), [collections]);
	const collectionPathById = React.useMemo(() => buildCollectionPathMap(collections), [collections]);
	const collectionParentById = React.useMemo(() => new Map(collections.map((collection) => [collection.id, collection.parentId] as const)), [collections]);
	const activeCollection = React.useMemo(
		() => collections.find((collection) => collection.id === activeCollectionId) ?? null,
		[activeCollectionId, collections]
	);
	const activeLabels = React.useMemo(
		() => labels.filter((label) => activeLabelIds.includes(label.id)),
		[activeLabelIds, labels]
	);
	const activeSortDirection = React.useMemo<SortDirection | undefined>(() => {
		if (!isToggleableSortMode(activeSortMode)) return undefined;
		return sortDirectionByMode[activeSortMode];
	}, [activeSortMode, sortDirectionByMode]);
	const activeFilterChips = React.useMemo(() => {
		const chips: Array<{ key: string; label: string; onClear: () => void; onPrimaryAction?: () => void; primaryAriaLabel?: string }> = [];
		if (noteGridCollaboratorFilter) {
			chips.push({
				key: `collaborator:${noteGridCollaboratorFilter.key}`,
				label: `${t('app.withFilterPrefix')}: ${noteGridCollaboratorFilter.label}`,
				onClear: () => setNoteGridCollaboratorFilter(null),
			});
		}
		if (activeCollection) {
			const collectionLabel = collectionPathById.get(activeCollection.id) ?? activeCollection.name;
			chips.push({
				key: `collection:${activeCollection.id}`,
				label: `Collection: ${truncateUiName(collectionLabel, 52)}`,
				onClear: () => setActiveCollectionId(null),
			});
		}
		for (const label of activeLabels) {
			chips.push({
				key: `label:${label.id}`,
				label: `Label: ${truncateUiName(label.name, 44)}`,
				onClear: () => setActiveLabelIds((current) => current.filter((entry) => entry !== label.id)),
			});
		}
		if (activeReminderFilter !== 'all') {
			const reminderLabels: Record<ReminderFilterMode, string> = {
				all: t('app.sidebarAll'),
				'past-due': t('app.sidebarPastDue'),
				'later-today': t('app.sidebarToday'),
				tomorrow: 'Tomorrow',
				'next-week': t('app.sidebarNextWeek'),
				'due-soon': t('app.sidebarDueSoon'),
			};
			chips.push({
				key: `reminder:${activeReminderFilter}`,
				label: `Reminder: ${reminderLabels[activeReminderFilter]}`,
				onClear: () => setActiveReminderFilter('all'),
			});
		}
		if (activeSortMode !== 'manual') {
			const sortLabels: Record<NoteSortMode, string> = {
				manual: 'Manual',
				'date-created': t('app.sidebarDateCreated'),
				'date-updated': t('app.sidebarDateUpdated'),
				alphabetical: t('app.sidebarAlphabetical'),
				'least-accessed': t('app.sidebarLeastAccessed'),
				'most-edited': t('app.sidebarMostEdited'),
			};
			const sortDirectionSuffix = isToggleableSortMode(activeSortMode)
				? `  ${getSortDirectionMarker(sortDirectionByMode[activeSortMode])}`
				: '';
			chips.push({
				key: `sort:${activeSortMode}`,
				label: `Sort: ${sortLabels[activeSortMode]}${sortDirectionSuffix}`,
				onClear: () => setActiveSortMode('manual'),
				// Sort chips can toggle direction in-place to avoid reopening sidebar menus.
				onPrimaryAction: isToggleableSortMode(activeSortMode)
					? () => {
						setSortDirectionByMode((current) => ({
							...current,
							[activeSortMode]: current[activeSortMode] === 'asc' ? 'desc' : 'asc',
						}));
					}
					: undefined,
				primaryAriaLabel: isToggleableSortMode(activeSortMode)
					? `Toggle sort direction for ${sortLabels[activeSortMode]}`
					: undefined,
			});
		}
		if (activeSortGrouping !== 'none') {
			const groupingLabels: Record<NoteGroupingMode, string> = {
				none: t('app.sidebarClear'),
				week: t('app.sidebarByWeek'),
				month: t('app.sidebarByMonth'),
			};
			chips.push({
				key: `grouping:${activeSortGrouping}`,
				label: `Grouping: ${groupingLabels[activeSortGrouping]}`,
				onClear: () => setActiveSortGrouping('none'),
			});
		}
		return chips;
	}, [activeCollection, activeLabels, activeReminderFilter, activeSortGrouping, activeSortMode, collectionPathById, noteGridCollaboratorFilter, sortDirectionByMode, t]);

	const noteGridEmptyStateLabel = React.useMemo(() => {
		if (activeCollection) return 'No notes in this collection.';
		if (activeFilterChips.length > 0) return 'No notes match current filters.';
		if (sidebarView === 'archive') return 'No archived notes.';
		if (sidebarView === 'trash') return 'Trash is empty.';
		return 'No notes yet.';
	}, [activeCollection, activeFilterChips.length, sidebarView]);

	const noteGridScopeLabel = React.useMemo(() => {
		if (sidebarView === 'images') {
			return `${t('app.sidebarImages')} / ${activeWorkspaceSidebarPath}`;
		}
		if (viewMode === 'bubble') {
			return 'All Workspaces';
		}
		if (sidebarView === 'archive') {
			return `${t('app.sidebarArchive')} / ${activeWorkspaceSidebarPath}`;
		}
		if (sidebarView === 'trash') {
			return `${t('app.sidebarTrash')} / ${activeWorkspaceSidebarPath}`;
		}
		return `All notes / ${activeWorkspaceSidebarPath}`;
	}, [activeWorkspaceSidebarPath, sidebarView, t, viewMode]);

	const moveNoteWorkspaceOptions = React.useMemo(() => {
		return sidebarWorkspaces.filter((workspace) => workspace.id !== authWorkspaceId && workspace.systemKind !== 'SHARED_WITH_ME' && canEditWorkspaceContent(workspace.role));
	}, [authWorkspaceId, sidebarWorkspaces]);

	const noteCollectionDoc = React.useMemo(
		() => (noteCollectionModalState ? manager.getDoc(noteCollectionModalState.noteId) : null),
		[manager, noteCollectionModalState]
	);
	const noteLabelsDoc = React.useMemo(
		() => (noteLabelsModalState ? manager.getDoc(noteLabelsModalState.noteId) : null),
		[manager, noteLabelsModalState]
	);
	const noteReminderDoc = React.useMemo(
		() => (noteReminderModalState ? manager.getDoc(noteReminderModalState.noteId) : null),
		[manager, noteReminderModalState]
	);
	const noteCollectionMetadata = useNoteMetadataSnapshot(noteCollectionDoc);
	const noteLabelsMetadata = useNoteMetadataSnapshot(noteLabelsDoc);
	const noteReminderMetadata = useNoteMetadataSnapshot(noteReminderDoc);
	const selectedNoteMetadata = useNoteMetadataSnapshot(editorMode === 'none' && selectedNoteId ? openDoc : null);

	React.useEffect(() => {
		if (!activeCollectionId) return;
		const nextOpenState: Record<string, boolean> = { collections: true };
		let cursor = collectionParentById.get(activeCollectionId) ?? null;
		while (cursor) {
			nextOpenState[`collection-node:${cursor}`] = true;
			cursor = collectionParentById.get(cursor) ?? null;
		}
		setSidebarGroupsOpen((prev) => ({ ...prev, ...nextOpenState }));
	}, [activeCollectionId, collectionParentById]);
	const handleCreateCollection = React.useCallback((args: { name: string; parentId: string | null }) => {
		if (!collectionsDoc) return;
		createCollection(collectionsDoc, args);
	}, [collectionsDoc]);
	const handleRenameCollection = React.useCallback((collectionId: string, nextName: string) => {
		if (!collectionsDoc) return;
		updateCollection(collectionsDoc, collectionId, { name: nextName });
	}, [collectionsDoc]);
	const handleDeleteCollection = React.useCallback((collectionId: string) => {
		if (!collectionsDoc) return;
		deleteCollection(collectionsDoc, collectionId);
		setActiveCollectionId((current) => current === collectionId ? null : current);
	}, [collectionsDoc]);
	const handleCreateLabel = React.useCallback((args: { name: string; color?: string | null }): string | null => {
		if (!labelsDoc) return null;
		return createLabel(labelsDoc, args)?.id ?? null;
	}, [labelsDoc]);
	const handleSelectNoteCollection = React.useCallback((collectionId: string | null) => {
		if (!noteCollectionDoc) return;
		assignNoteToCollection(noteCollectionDoc, collectionId);
		setNoteCollectionModalState(null);
	}, [noteCollectionDoc]);
	const handleToggleNoteLabel = React.useCallback((labelId: string) => {
		if (!noteLabelsDoc) return;
		const current = readNoteMetadataState(noteLabelsDoc).labelIds;
		assignNoteLabels(
			noteLabelsDoc,
			current.includes(labelId) ? current.filter((entry) => entry !== labelId) : [...current, labelId]
		);
	}, [noteLabelsDoc]);
	const handleSaveNoteReminder = React.useCallback((reminderAt: string | null) => {
		if (!noteReminderDoc) return;
		assignNoteReminder(noteReminderDoc, reminderAt);
		setNoteReminderModalState(null);
		// Sync reminder to server so the push scheduler can fire the notification.
		if (authStatus === 'authed' && !authOfflineMode && noteReminderModalState) {
			void syncNoteReminder({
				deviceId,
				docId: noteReminderModalState.noteId,
				noteId: noteReminderModalState.noteId,
				workspaceId: authWorkspaceId ?? '',
				reminderAt,
				noteTitle: noteReminderModalState.title || undefined,
			}).catch(() => undefined);
		}
	}, [noteReminderDoc, authStatus, authOfflineMode, noteReminderModalState, deviceId, authWorkspaceId]);

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
				// Prefer the locally-selected workspace (authWorkspaceId) over the server's
				// stale activeWorkspaceId when the server's list contains the local selection.
				// Without this guard, loadSidebarWorkspaces overwrites IndexedDB with the
				// server's old workspace A, causing the prefs-hydration effect to see a
				// "newer" local selection of A and revert an offline switch to B.
				const localActiveWorkspaceId =
					authWorkspaceId && next.some((w) => w.id === authWorkspaceId)
						? authWorkspaceId
						: nextActiveWorkspaceId;
				await cacheWorkspaceSnapshot({
					userId: authUserId,
					deviceId,
					activeWorkspaceId: localActiveWorkspaceId,
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

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const eventName = getWorkspaceMetadataChangedEventName();
		const onWorkspaceMetadataChanged = (): void => {
			const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
			if (!authOfflineMode && !browserOffline) {
				return;
			}
			void loadSidebarWorkspacesRef.current();
		};
		window.addEventListener(eventName, onWorkspaceMetadataChanged as EventListener);
		return () => {
			window.removeEventListener(eventName, onWorkspaceMetadataChanged as EventListener);
		};
	}, [authOfflineMode]);

	const refreshNoteShareState = React.useCallback(async (): Promise<void> => {
		// This is the single reconciliation point for collaboration UI state:
		// - replay queued accept/decline actions once connectivity returns
		// - refresh the notification badge/modal contents
		// - refresh alias-mounted shared note placements for the grid/sidebar
		if (authStatus !== 'authed' || !authUserId) {
			setSharedPlacements([]);
			setFailedLinkNotifications([]);
			setPendingShareNotificationCount(0);
			setPendingReminderNotificationCount(0);
			setFiredReminders([]);
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
			const [invitationData, placementData, workspaceInviteData, failedLinkData, pendingReminderCount, firedRemindersData] = await Promise.all([
				listNoteShareInvitations(),
				authWorkspaceId ? listSharedNotePlacements(authWorkspaceId) : Promise.resolve({ placements: [] }),
				listWorkspacePendingInvites(),
				listFailedNoteLinks().catch(() => ({ failures: [], count: 0 })),
				fetchPendingReminderCount().catch(() => 0),
				fetchFiredReminders().catch(() => ({ reminders: [] })),
			]);
			setFailedLinkNotifications(failedLinkData.failures);
			setPendingShareNotificationCount(invitationData.pendingCount + workspaceInviteData.invites.length + failedLinkData.count);
			setPendingReminderNotificationCount(pendingReminderCount);
			setFiredReminders(firedRemindersData.reminders);
			setSharedPlacements(placementData.placements);
			manager.setExternalRoomAliases(Object.fromEntries(placementData.placements.map((placement) => [placement.aliasId, placement.roomId])));
		} catch {
			if (!offline) {
				setSharedPlacements([]);
				setFailedLinkNotifications([]);
				setPendingShareNotificationCount(0);
				setPendingReminderNotificationCount(0);
				setFiredReminders([]);
				manager.setExternalRoomAliases({});
			}
		}
	}, [authStatus, authUserId, authWorkspaceId, manager]);

	const flushPwaOfflineQueues = React.useCallback(async (): Promise<void> => {
		if (authStatus !== 'authed' || !authUserId || authOfflineMode) return;
		await flushPendingNoteMoves(authUserId).catch(() => undefined);
		await syncPendingWorkspaceMutationsRef.current().catch(() => undefined);
		await flushSyncOutbox(authUserId).catch(() => undefined);
		await scheduleSyncOutboxFlush(authUserId).catch(() => undefined);
		await flushPendingShareLinkRequests(authUserId).catch(() => undefined);
		await scheduleQueuedNoteImageFlush(authUserId).catch(() => undefined);
		await scheduleQueuedNoteDocumentFlush(authUserId).catch(() => undefined);
		await flushQueuedNoteLinkSync(authUserId).catch(() => undefined);
		await flushPendingCollaboratorActions(authUserId).catch(() => undefined);
		await flushPendingNoteShareActions(authUserId).catch(() => undefined);
		await loadSidebarWorkspacesRef.current().catch(() => undefined);
		await refreshActiveWorkspaceRef.current().catch(() => undefined);
		await refreshNoteShareState().catch(() => undefined);
	}, [authOfflineMode, authStatus, authUserId, refreshNoteShareState]);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const onPwaSyncRequest = (): void => {
			void flushPwaOfflineQueues();
		};
		window.addEventListener(PWA_SYNC_REQUEST_EVENT, onPwaSyncRequest as EventListener);
		return () => {
			window.removeEventListener(PWA_SYNC_REQUEST_EVENT, onPwaSyncRequest as EventListener);
		};
	}, [flushPwaOfflineQueues]);

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
	const documentViewerOpenRef = React.useRef(false);
	const pendingViewerRefreshRef = React.useRef(false);

	React.useEffect(() => {
		refreshNoteShareStateRef.current = refreshNoteShareState;
	}, [refreshNoteShareState]);

	// Refresh the notification badge whenever a push message arrives in the
	// background (the service worker posts FREEMANNOTES_PUSH_RECEIVED).
	React.useEffect(() => {
		return onPushReceived((data) => {
			// For reminder pushes, re-fetch the server-side unacknowledged count
			// so the bell badges even when the app is already open.
			if ((data as { type?: string }).type === 'reminder') {
				void fetchPendingReminderCount()
					.then((count) => setPendingReminderNotificationCount(count))
					.catch(() => undefined);
			}
			void refreshNoteShareStateRef.current();
		});
	}, []);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const onViewerState = (event: Event): void => {
			const open = Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open);
			documentViewerOpenRef.current = open;
			if (open || !pendingViewerRefreshRef.current) return;
			pendingViewerRefreshRef.current = false;
			void loadSidebarWorkspacesRef.current();
			void refreshActiveWorkspaceRef.current();
			void refreshNoteShareStateRef.current();
			bumpCollaborationRefreshToken();
		};
		window.addEventListener(DOCUMENT_VIEWER_STATE_EVENT, onViewerState as EventListener);
		return () => window.removeEventListener(DOCUMENT_VIEWER_STATE_EVENT, onViewerState as EventListener);
	}, [bumpCollaborationRefreshToken]);

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
		let refreshMetadataTimer: number | null = null;
		const pendingNoteMediaTimers = new Map<string, number>();
		const pendingNoteDocumentTimers = new Map<string, number>();
		const pendingNoteLinkTimers = new Map<string, number>();

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
		const clearPendingNoteLinkTimers = () => {
			for (const timer of pendingNoteLinkTimers.values()) {
				window.clearTimeout(timer);
			}
			pendingNoteLinkTimers.clear();
		};
		const clearPendingNoteDocumentTimers = () => {
			for (const timer of pendingNoteDocumentTimers.values()) {
				window.clearTimeout(timer);
			}
			pendingNoteDocumentTimers.clear();
		};

		const refreshWorkspaceMetadata = () => {
			if (documentViewerOpenRef.current) {
				pendingViewerRefreshRef.current = true;
				return;
			}
			// Debounce: coalesce bursts of WS open + metadata-ready + metadata-changed events
			// (common during initial session setup) into a single fan-out refresh.
			if (refreshMetadataTimer !== null) {
				window.clearTimeout(refreshMetadataTimer);
			}
			refreshMetadataTimer = window.setTimeout(() => {
				refreshMetadataTimer = null;
				void loadSidebarWorkspacesRef.current();
				void refreshActiveWorkspaceRef.current();
				void refreshNoteShareStateRef.current();
				bumpCollaborationRefreshToken();
			}, 300);
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
					const isNoteDocumentsMetadataEvent = payload.type === 'workspace-metadata-changed'
						&& typeof payload.reason === 'string'
						&& payload.reason.startsWith('note-documents-');
					const isNoteLinksMetadataEvent = payload.type === 'workspace-metadata-changed'
						&& typeof payload.reason === 'string'
						&& payload.reason.startsWith('note-links-');
					const isUserProfileMetadataEvent = payload.type === 'workspace-metadata-changed'
						&& payload.reason === 'user-profile-updated';
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
						if (isNoteDocumentsMetadataEvent && typeof payload.docId === 'string') {
							const existingTimer = pendingNoteDocumentTimers.get(payload.docId);
							if (existingTimer) {
								window.clearTimeout(existingTimer);
							}
							const timer = window.setTimeout(() => {
								pendingNoteDocumentTimers.delete(payload.docId as string);
								emitNoteDocumentsChanged(payload.docId as string);
							}, 150);
							pendingNoteDocumentTimers.set(payload.docId, timer);
							return;
						}
						if (isNoteLinksMetadataEvent && typeof payload.docId === 'string') {
							const existingTimer = pendingNoteLinkTimers.get(payload.docId);
							if (existingTimer) {
								window.clearTimeout(existingTimer);
							}
							const timer = window.setTimeout(() => {
								pendingNoteLinkTimers.delete(payload.docId as string);
								emitNoteLinksChanged(payload.docId as string, 'remote');
							}, 150);
							pendingNoteLinkTimers.set(payload.docId, timer);
							return;
						}
						if (
							payload.type === 'workspace-metadata-changed' &&
							typeof payload.docId === 'string' &&
							authUserId &&
							!isNoteMediaMetadataEvent &&
							!isNoteDocumentsMetadataEvent &&
							!isNoteLinksMetadataEvent
						) {
							void syncNoteShareCollaborators(authUserId, payload.docId, { suppressError: true });
						}
						if (isNoteShareMetadataEvent) {
							void refreshNoteShareStateRef.current();
							bumpCollaborationRefreshToken();
							return;
						}
						if (payload.reason === 'reminder-fired') {
							// Reminder became due — update the bell badge and notification
							// panel immediately without going through the debounced metadata
							// refresh path (which would delay badge update by ~300 ms and
							// could drop the event if another refresh is in flight).
							void refreshNoteShareStateRef.current();
							return;
						}
						if (isUserProfileMetadataEvent) {
							void refreshAuthenticatedProfileRef.current();
							void loadSidebarWorkspacesRef.current();
							void refreshActiveWorkspaceRef.current();
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
			if (refreshMetadataTimer !== null) {
				window.clearTimeout(refreshMetadataTimer);
				refreshMetadataTimer = null;
			}
			clearPendingNoteMediaTimers();
			clearPendingNoteDocumentTimers();
			clearPendingNoteLinkTimers();
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
		// Pin Personal (auto-created at registration, identified by name pattern) and
		// Shared With Me (systemKind: SHARED_WITH_ME) to the top two positions.
		// The active user workspace floats to the top of the remaining group.
		const personalWorkspace = sidebarWorkspaces.find(isPersonalWorkspace) || null;
		const sharedWorkspace = sidebarWorkspaces.find((workspace) => (workspace.systemKind || '').toUpperCase() === 'SHARED_WITH_ME') || null;
		const pinnedWorkspaceIds = new Set<string>();
		if (personalWorkspace) pinnedWorkspaceIds.add(personalWorkspace.id);
		if (sharedWorkspace) pinnedWorkspaceIds.add(sharedWorkspace.id);

		const remainingWorkspaces = sidebarWorkspaces.filter((workspace) => !pinnedWorkspaceIds.has(workspace.id));
		if (authWorkspaceId) {
			const activeRemainingIndex = remainingWorkspaces.findIndex((workspace) => workspace.id === authWorkspaceId);
			if (activeRemainingIndex > 0) {
				const [activeRemainingWorkspace] = remainingWorkspaces.splice(activeRemainingIndex, 1);
				remainingWorkspaces.unshift(activeRemainingWorkspace);
			}
		}

		return [
			...(personalWorkspace ? [personalWorkspace] : []),
			...(sharedWorkspace ? [sharedWorkspace] : []),
			...remainingWorkspaces,
		];
	}, [authWorkspaceId, sidebarWorkspaces]);

	const activateWorkspaceFromSidebar = React.useCallback(
		async (workspaceId: string, options?: { activeSharedFolder?: string | null }): Promise<void> => {
			if (authStatus !== 'authed') return;
			if (workspaceId === authWorkspaceId) return;
			const nextSharedFolder = options?.activeSharedFolder ?? null;
			if (authUserId && (authOfflineMode || (typeof navigator !== 'undefined' && navigator.onLine === false))) {
				handleWorkspaceActivated(workspaceId);
				void persistSharedWorkspaceSelection(workspaceId, nextSharedFolder);
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
						handleWorkspaceActivated(workspaceId);
						void persistSharedWorkspaceSelection(workspaceId, nextSharedFolder);
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
		[authOfflineMode, authStatus, authUserId, authWorkspaceId, closeMobileSidebar, closeWorkspaceSidebarGroup, confirmActivatedWorkspaceSession, deviceId, handleWorkspaceActivated, isMobileViewport, persistSharedWorkspaceSelection]
	);

	const handleBubbleNoteSelect = React.useCallback(async (noteId: string, workspaceId: string): Promise<void> => {
		const targetWorkspace = sidebarWorkspaces.find((workspace) => workspace.id === workspaceId) ?? null;
		if (workspaceId !== authWorkspaceId) {
			await activateWorkspaceFromSidebar(workspaceId, { activeSharedFolder: null });
		}
		if (noteId.startsWith('shared-placement:') || targetWorkspace?.systemKind === 'SHARED_WITH_ME') {
			await refreshNoteShareStateRef.current();
		}
		try {
			await manager.getDocWithSync(noteId);
		} catch {
			// Fall back to the normal loading state if preloading cannot complete yet.
		}
		openNoteEditor(noteId, { replaceTop: editorMode !== 'none' });
	}, [activateWorkspaceFromSidebar, authWorkspaceId, editorMode, manager, openNoteEditor, sidebarWorkspaces]);

	const openCreateEditorForCurrentContext = React.useCallback(
		async (mode: 'text' | 'checklist', opts?: { replaceTop?: boolean }) => {
			if (viewMode === 'bubble') {
				const targetWorkspaceId = bubbleSelectedWorkspace?.id || authWorkspaceId;
				if (!targetWorkspaceId) return;
				if (targetWorkspaceId !== authWorkspaceId) {
					await activateWorkspaceFromSidebar(targetWorkspaceId, { activeSharedFolder: null });
				}
			}
			if (!canEditActiveWorkspace) {
				showBriefDialog(t('share.roleViewer'));
				return;
			}

			// Create the real note up front so the compose session has the same feature
			// surface as editing an existing note, including media, collaborators, and
			// metadata assignment while the note is still effectively a draft.
			const noteId = makeNoteId(mode === 'checklist' ? 'checklist-note' : 'text-note');
			const doc = await manager.getDocWithSync(noteId);
			if (mode === 'checklist') {
				initChecklistNoteDoc(doc, '', [], []);
			} else {
				initTextNoteDoc(doc, '', '', undefined, []);
			}
			if (sidebarView === 'notes' && activeCollectionId && activeCollection) {
				// Seed the active collection so quick-create from a filtered collection keeps
				// the new note visible there unless the user opts out in the editor.
				assignNoteToCollection(doc, activeCollectionId);
				pendingNewNoteCollectionSeedRef.current.set(noteId, {
					collectionId: activeCollectionId,
					label: collectionPathById.get(activeCollectionId) ?? activeCollection.name,
				});
			} else {
				pendingNewNoteCollectionSeedRef.current.delete(noteId);
			}
			await manager.createNote(noteId, '');
			pendingNewNoteIdsRef.current.add(noteId);
			openNoteEditor(noteId, opts);
		},
		[activateWorkspaceFromSidebar, activeCollection, activeCollectionId, authWorkspaceId, bubbleSelectedWorkspace, canEditActiveWorkspace, collectionPathById, manager, openNoteEditor, showBriefDialog, sidebarView, t, viewMode]
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

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		const nextToken = url.searchParams.get('resetPassword');
		setPasswordResetToken(nextToken);
		setResetPassword('');
		setResetPasswordConfirm('');
		setResetPasswordError(null);
		setResetPasswordMessage(null);
	}, []);

	const clearPasswordResetTokenFromUrl = React.useCallback((): void => {
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		if (!url.searchParams.has('resetPassword')) return;
		url.searchParams.delete('resetPassword');
		window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
		setPasswordResetToken(null);
	}, []);

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
				setAuthError('Login succeeded, but the session could not be confirmed. The server may be temporarily unavailable — please try again. If this persists, check the production cookie and reverse-proxy setup.');
				return;
			}

			// Optional post-register avatar upload.
			// Delay this until after /api/auth/me succeeds so the fresh session cookie is
			// definitely active before the multipart upload hits the authenticated route.
			if (authMode === 'register' && registerAvatarUrl) {
				try {
					const blob = await getAvatarUploadBlob(registerAvatarUrl, registerAvatarAreaPixels, 256);
					const form = new FormData();
					form.append('file', blob, 'avatar.png');
					const uploadRes = await fetch('/api/user/profile-image', {
						method: 'POST',
						credentials: 'include',
						body: form,
					});
					if (!uploadRes.ok) throw new Error('Upload failed');
					const uploadBody = await uploadRes.json().catch(() => null);
					const profileImage = uploadBody?.profileImage ? String(uploadBody.profileImage) : null;
					if (profileImage) {
						resolvedProfileImage = profileImage;
					}
				} catch {
					showBriefDialog(t('prefs.avatarUploadFailed'));
				}
			}

			setAuthUserId(resolvedUserId);
			setAuthProfileImage(resolvedProfileImage);
			setAuthWorkspaceId(resolvedWorkspaceId);
			setAuthStatus('authed');
			setAuthOfflineMode(false);
			manager.setActiveWorkspaceId(resolvedWorkspaceId);
			writeAuthCache({ v: 1, userId: resolvedUserId, workspaceId: resolvedWorkspaceId, profileImage: resolvedProfileImage });
			writeWorkspaceSelectionCache({ userId: resolvedUserId, workspaceId: resolvedWorkspaceId });
			manager.setWebsocketEnabled(Boolean(resolvedWorkspaceId));
		} catch {
			setAuthError('Authentication failed');
			setAuthStatus('unauth');
			manager.setWebsocketEnabled(false);
		} finally {
			setAuthBusy(false);
		}
	}, [authBusy, authEmail, authMode, authName, authPassword, authPasswordConfirm, authPasswordStrengthScore, deviceId, manager, registerAvatarAreaPixels, registerAvatarUrl, showBriefDialog, t]);

	const submitForgotPassword = React.useCallback(async () => {
		if (forgotPasswordBusy) return;
		setForgotPasswordBusy(true);
		setForgotPasswordError(null);
		setForgotPasswordMessage(null);
		try {
			const res = await fetch('/api/auth/forgot-password', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: forgotPasswordEmail }),
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				setForgotPasswordError(typeof body?.error === 'string' ? body.error : 'Unable to send reset link');
				return;
			}
			setForgotPasswordMessage(typeof body?.message === 'string' ? body.message : 'If the email exists, a reset link has been sent.');
		} catch {
			setForgotPasswordError('Unable to send reset link');
		} finally {
			setForgotPasswordBusy(false);
		}
	}, [forgotPasswordBusy, forgotPasswordEmail]);

	const submitPasswordReset = React.useCallback(async () => {
		if (resetPasswordBusy || !passwordResetToken) return;
		if (resetPassword !== resetPasswordConfirm) {
			setResetPasswordError('Passwords do not match');
			return;
		}
		if (getPasswordStrengthScore(resetPassword) < 2) {
			setResetPasswordError('Password is too weak');
			return;
		}
		setResetPasswordBusy(true);
		setResetPasswordError(null);
		setResetPasswordMessage(null);
		try {
			const res = await fetch('/api/auth/reset-password', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: passwordResetToken, password: resetPassword }),
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				setResetPasswordError(typeof body?.error === 'string' ? body.error : 'Unable to reset password');
				return;
			}
			setResetPasswordMessage(typeof body?.message === 'string' ? body.message : 'Password updated successfully');
			setAuthMode('login');
			setAuthPassword('');
			setAuthPasswordConfirm('');
			window.setTimeout(() => {
				clearPasswordResetTokenFromUrl();
			}, 1200);
		} catch {
			setResetPasswordError('Unable to reset password');
		} finally {
			setResetPasswordBusy(false);
		}
	}, [clearPasswordResetTokenFromUrl, passwordResetToken, resetPassword, resetPasswordBusy, resetPasswordConfirm]);

	const handleSaveUserAvatar = React.useCallback(
		async ({ imageUrl, crop }: { imageUrl: string; crop: CropAreaPixels | null }) => {
			if (userModalBusy) return;
			if (authStatus !== 'authed' || !authUserId) {
				setUserModalError(t('prefs.avatarUploadFailed'));
				return;
			}

			setUserModalBusy(true);
			setUserModalError(null);
			try {
				const blob = await getAvatarUploadBlob(imageUrl, crop, 256);
				const form = new FormData();
				form.append('file', blob, 'avatar.png');

				const uploadRes = await fetch('/api/user/profile-image', {
					method: 'POST',
					credentials: 'include',
					body: form,
				});
				const uploadBody = await uploadRes.json().catch(() => null);
				if (!uploadRes.ok) {
					throw new Error(
						typeof uploadBody?.error === 'string' && uploadBody.error.trim()
							? uploadBody.error
							: t('prefs.avatarUploadFailed')
					);
				}

				const uploadedProfileImage = uploadBody?.profileImage ? String(uploadBody.profileImage) : null;
				if (uploadedProfileImage) {
					setAuthProfileImage(uploadedProfileImage);
					writeAuthCache({
						v: 1,
						userId: authUserId,
						workspaceId: authWorkspaceId,
						profileImage: uploadedProfileImage,
					});
				}

				await Promise.allSettled([
					refreshAuthenticatedProfileRef.current(),
					loadSidebarWorkspacesRef.current(),
					refreshActiveWorkspaceRef.current(),
					refreshNoteShareStateRef.current(),
				]);
				bumpCollaborationRefreshToken();
				setIsUserOpen(false);
				setIsPreferencesOpen(true);
				setUserModalError(null);
				showBriefDialog(t('prefs.avatarUpdated'));
			} catch (error) {
				setUserModalError(error instanceof Error && error.message ? error.message : t('prefs.avatarUploadFailed'));
			} finally {
				setUserModalBusy(false);
			}
		},
		[authStatus, authUserId, authWorkspaceId, bumpCollaborationRefreshToken, showBriefDialog, t, userModalBusy]
	);

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
					{authMode === 'login' ? (
						<button
							type="button"
							className="auth-link"
							onClick={() => {
								setForgotPasswordOpen(true);
								setForgotPasswordEmail(authEmail);
								setForgotPasswordError(null);
								setForgotPasswordMessage(null);
							}}
							disabled={authBusy || authStatus === 'loading'}
						>
							Forgot password?
						</button>
					) : null}
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
				{forgotPasswordOpen ? (
					<div className="auth-modal-backdrop" role="presentation" onClick={() => setForgotPasswordOpen(false)}>
						<div className="auth-modal" role="dialog" aria-modal="true" aria-label="Reset password" onClick={(event) => event.stopPropagation()}>
							<div className="auth-modal-title">Reset password</div>
							<div className="auth-modal-copy">Enter the email address for your account and we will send you a password reset link.</div>
							<label className="auth-label">
								Email
								<input
									type="email"
									autoComplete="email"
									value={forgotPasswordEmail}
									onChange={(e) => setForgotPasswordEmail(e.target.value)}
									disabled={forgotPasswordBusy}
									required
								/>
							</label>
							{forgotPasswordError ? <div className="auth-error">{forgotPasswordError}</div> : null}
							{forgotPasswordMessage ? <div className="auth-success">{forgotPasswordMessage}</div> : null}
							<div className="auth-modal-actions">
								<button type="button" className="auth-secondary-button" onClick={() => setForgotPasswordOpen(false)} disabled={forgotPasswordBusy}>Close</button>
								<button type="button" onClick={() => void submitForgotPassword()} disabled={forgotPasswordBusy || !forgotPasswordEmail.trim()}>
									{forgotPasswordBusy ? 'Sending…' : 'Send reset link'}
								</button>
							</div>
						</div>
					</div>
				) : null}
				{passwordResetToken ? (
					<div className="auth-modal-backdrop" role="presentation" onClick={() => clearPasswordResetTokenFromUrl()}>
						<div className="auth-modal" role="dialog" aria-modal="true" aria-label="Choose a new password" onClick={(event) => event.stopPropagation()}>
							<div className="auth-modal-title">Choose a new password</div>
							<div className="auth-modal-copy">This secure link lets you set a new password for your FreemanNotes account.</div>
							<label className="auth-label">
								New password
								<input
									type="password"
									autoComplete="new-password"
									value={resetPassword}
									onChange={(e) => setResetPassword(e.target.value)}
									disabled={resetPasswordBusy}
									required
								/>
							</label>
							<div className="auth-password-strength" aria-live="polite">
								<div className="auth-password-strength-bar" aria-hidden="true">
									<span className={`auth-password-strength-fill auth-password-strength-${getPasswordStrengthLabel(resetPassword).toLowerCase()}`} style={{ width: `${Math.max(8, getPasswordStrengthScore(resetPassword) * 25)}%` }} />
								</div>
								<div className="auth-password-strength-copy">Password strength: {getPasswordStrengthLabel(resetPassword)}</div>
							</div>
							<label className="auth-label">
								Confirm password
								<input
									type="password"
									autoComplete="new-password"
									value={resetPasswordConfirm}
									onChange={(e) => setResetPasswordConfirm(e.target.value)}
									disabled={resetPasswordBusy}
									required
								/>
							</label>
							{resetPasswordError ? <div className="auth-error">{resetPasswordError}</div> : null}
							{resetPasswordMessage ? <div className="auth-success">{resetPasswordMessage}</div> : null}
							<div className="auth-modal-actions">
								<button type="button" className="auth-secondary-button" onClick={() => clearPasswordResetTokenFromUrl()} disabled={resetPasswordBusy}>Cancel</button>
								<button type="button" onClick={() => void submitPasswordReset()} disabled={resetPasswordBusy || !resetPassword || !resetPasswordConfirm}>
									{resetPasswordBusy ? 'Updating…' : 'Update password'}
								</button>
							</div>
						</div>
					</div>
				) : null}
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

	const headerConnectionState = connection.state;

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
			{ id: 'notes', label: viewMode === 'bubble' ? 'All Notes' : t('app.sidebarNotes'), icon: faFileLines, kind: 'link' },
			{ id: 'workspaces', label: viewMode === 'bubble' ? 'Workspaces' : t('workspace.sidebarTitle'), icon: faGrip, kind: 'group' },
			{ id: 'collections', label: viewMode === 'bubble' ? 'All Collections' : t('app.sidebarCollections'), icon: faFolder, kind: 'group' },
			{ id: 'labels', label: viewMode === 'bubble' ? 'All Labels' : t('app.sidebarLabels'), icon: faTag, kind: 'group' },
			{ id: 'sorting', label: t('app.sidebarSorting'), icon: faArrowDownWideShort, kind: 'group' },
			{ id: 'reminders', label: t('app.sidebarReminders'), icon: faBell, kind: 'group' },
			{ id: 'images', label: t('app.sidebarImages'), icon: faImage, kind: 'link' },
			{ id: 'trash', label: t('app.sidebarTrash'), icon: faTrash, kind: 'link' },
		].filter((entry) => viewMode !== 'bubble' || sidebarView === 'images' || (entry.id !== 'collections' && entry.id !== 'labels' && entry.id !== 'sorting')),
		[sidebarView, t, viewMode]
	);
	const sidebarUsesBubbleSummaryMenus = viewMode === 'bubble' && sidebarView !== 'images';
	const filterSidebarView = sidebarView === 'images' ? 'images' : 'notes';

	const bubbleWorkspaceLegend = React.useMemo(() => {
		return sidebarWorkspacesSorted.map((workspace) => ({
			id: workspace.id,
			name: getWorkspaceDisplayName(workspace, t),
			isActive: workspace.id === (viewMode === 'bubble' ? (bubbleWorkspaceSelectionId || authWorkspaceId) : authWorkspaceId),
			style: toWorkspaceBubbleColorStyle(getWorkspaceBubbleColorScheme(themeId, workspace.id)),
		}));
	}, [authWorkspaceId, bubbleWorkspaceSelectionId, sidebarWorkspacesSorted, t, themeId, viewMode]);

	const sidebarGroupContent = React.useMemo<Record<string, SidebarSubmenuNode[]>>(
		() => ({
			reminders: [
				{ id: 'all', label: t('app.sidebarAll'), kind: 'item' },
				{ id: 'past-due', label: t('app.sidebarPastDue'), kind: 'item' },
				{ id: 'later-today', label: t('app.sidebarToday'), kind: 'item' },
				{ id: 'tomorrow', label: 'Tomorrow', kind: 'item' },
				{ id: 'next-week', label: t('app.sidebarNextWeek'), kind: 'item' },
			],
			labels: sidebarUsesBubbleSummaryMenus
				? [{ id: 'all-labels', label: 'All Labels', kind: 'muted' }]
				: labels.length > 0
				? labels.map((label) => ({ id: label.id, label: label.name, kind: 'item' as const }))
				: [{ id: 'no-labels', label: t('app.sidebarNoLabels'), kind: 'muted' }],
			collections: sidebarUsesBubbleSummaryMenus ? [{ id: 'all-collections', label: 'All Collections', kind: 'muted' }] : [],
		}),
		[labels, sidebarUsesBubbleSummaryMenus, t]
	);

	const sortingPrimaryItems = React.useMemo<SidebarSubmenuNode[]>(
		() => [
			{ id: 'manual', label: 'Manual', kind: 'item' },
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
					{ id: 'past-due', label: t('app.sidebarPastDue'), kind: 'item' },
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

	const renderCollectionSidebarNodes = React.useCallback((nodes: readonly CollectionTreeNode[], depth = 0): React.ReactNode[] => {
		return nodes.map((collection) => {
			const toggleId = `collection-node:${collection.id}`;
			const hasChildren = collection.children.length > 0;
			const isExpanded = hasChildren && Boolean(sidebarGroupsOpen[toggleId]);
			return (
				<div key={collection.id} className="sidebar-collection-node">
					<div className="sidebar-collection-row" style={{ ['--sidebar-collection-depth' as const]: depth } as React.CSSProperties}>
						{hasChildren ? (
							<button
								type="button"
								className={`sidebar-collection-disclosure${isExpanded ? ' is-open' : ''}`}
								onClick={() => setSidebarGroupsOpen((prev) => ({ ...prev, [toggleId]: !Boolean(prev[toggleId]) }))}
								aria-label={isExpanded ? 'Collapse collection' : 'Expand collection'}
							>
								<span className="sidebar-collection-disclosure-icon" aria-hidden="true" />
							</button>
						) : <span className="sidebar-collection-disclosure-spacer" aria-hidden="true" />}
						<button
							type="button"
							className={`sidebar-submenu-item sidebar-collection-item${activeCollectionId === collection.id ? ' is-active' : ''}`}
							onClick={() => {
								setSidebarView(filterSidebarView);
								setActiveCollectionId((current) => current === collection.id ? null : collection.id);
								if (isMobileViewport) closeMobileSidebar();
							}}
							title={collectionPathById.get(collection.id) ?? collection.name}
						>
							<span className="sidebar-collection-item-label">{truncateUiName(collection.name, 44)}</span>
						</button>
					</div>
					{hasChildren ? (
						<div className={`sidebar-nested-submenu-shell${isExpanded ? ' is-open' : ''}`}>
							<div className="sidebar-nested-submenu sidebar-collection-children">
								{renderCollectionSidebarNodes(collection.children, depth + 1)}
							</div>
						</div>
					) : null}
				</div>
			);
		});
	}, [activeCollectionId, closeMobileSidebar, collectionPathById, filterSidebarView, isMobileViewport, setSidebarView, sidebarGroupsOpen]);

	React.useEffect(() => {
		if (viewMode !== 'bubble') return;
		setSidebarGroupsOpen((prev) => ({
			...prev,
			workspaces: true,
			collections: false,
			labels: false,
			sorting: false,
		}));
		if (sidebarWorkspaces.length === 0 && !sidebarWorkspacesBusy) {
			void loadSidebarWorkspaces();
		}
	}, [loadSidebarWorkspaces, sidebarWorkspaces.length, sidebarWorkspacesBusy, viewMode]);

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
		// Listen on the document rather than a dedicated swipe-zone element so the
		// gesture still works even when stacking/z-index changes put transient UI in
		// front of the edge strip.
		// Suppressed while the note editor is open so that the editor's own swipe
		// gestures (e.g. media panel tab switching) don't accidentally open the sidebar.
		if (!isMobileViewport || typeof window === 'undefined') return;
		if (editorMode !== 'none' || selectedNoteId !== null) return;

		let tracking = false;
		let startX = 0;
		let startY = 0;
		const TRIGGER_DX = 42;
		const MAX_DY = 18;
		const MAX_START_X = 28;

		const onTouchStart = (event: TouchEvent) => {
			if (isMobileSidebarOpen) return;
			if (event.touches.length !== 1) return;
			const touch = event.touches[0];
			if (touch.clientX > MAX_START_X) return;
			startX = touch.clientX;
			startY = touch.clientY;
			tracking = true;
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

		document.addEventListener('touchstart', onTouchStart, { passive: true });
		document.addEventListener('touchmove', onTouchMove, { passive: false });
		document.addEventListener('touchend', onTouchEnd, { passive: true });
		document.addEventListener('touchcancel', onTouchEnd, { passive: true });
		return () => {
			document.removeEventListener('touchstart', onTouchStart);
			document.removeEventListener('touchmove', onTouchMove);
			document.removeEventListener('touchend', onTouchEnd);
			document.removeEventListener('touchcancel', onTouchEnd);
		};
	}, [editorMode, isMobileViewport, isMobileSidebarOpen, openMobileSidebar, selectedNoteId]);

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
			const hadActiveOverlay = hasOverlaySnapshotContent(currentOverlaySnapshotRef.current);
			if (isOverlayHistoryState(state)) {
				applyOverlaySnapshot(state.snapshot);
				return;
			}
			if (isNoteImageViewerHistoryState(state) || isNoteEditorMediaDockHistoryState(state)) {
				return;
			}

			// If we popped to a non-overlay history entry, collapse to base.
			applyOverlaySnapshot(EMPTY_OVERLAY_SNAPSHOT);
			if (hadActiveOverlay) {
				exitBackPressRef.current.count = 0;
				return;
			}
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
		const root = document.documentElement;
		root.style.setProperty('--note-card-font-scale', String(clampFontScale(noteCardFontScalePref)));
		root.style.setProperty('--note-editor-font-scale', String(clampFontScale(noteEditorFontScalePref)));
		return () => {
			root.style.removeProperty('--note-card-font-scale');
			root.style.removeProperty('--note-editor-font-scale');
		};
	}, [noteCardFontScalePref, noteEditorFontScalePref]);

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

	const closeMoveNoteModal = React.useCallback(() => {
		if (moveNoteBusy) return;
		setMoveNoteModalState(null);
		setMoveNoteError(null);
	}, [moveNoteBusy]);

	const openMoveNoteModal = React.useCallback((noteId: string, title?: string) => {
		if (authStatus !== 'authed' || !authWorkspaceId) {
			return;
		}
		setMoveNoteError(null);
		setMoveNoteModalState({ noteId, title: String(title || '').trim() });
	}, [authStatus, authWorkspaceId]);

	const handleMoveNoteToWorkspace = React.useCallback(async (targetWorkspaceId: string) => {
		if (!moveNoteModalState || !authWorkspaceId) return;
		const noteId = moveNoteModalState.noteId;
		const noteTitle = moveNoteModalState.title;
		const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
		const shouldQueueImmediately = authOfflineMode || browserOffline;
		let shouldShowQueuedMessage = shouldQueueImmediately;
		setMoveNoteBusy(true);
		setMoveNoteError(null);
		try {
			await manager.moveNoteToWorkspaceLocally(noteId, targetWorkspaceId, {
				sourceWorkspaceId: authWorkspaceId,
				title: noteTitle,
			});
			setSelectedNoteId((current) => current === noteId ? null : current);
			setOpenDocId((current) => {
				if (current !== noteId) return current;
				setOpenDoc(null);
				return null;
			});
			if (authUserId) {
				queuePendingNoteMove({
					userId: authUserId,
					noteId,
					sourceWorkspaceId: authWorkspaceId,
					targetWorkspaceId,
					title: noteTitle,
				});
			}
			if (!shouldQueueImmediately) {
				try {
					await moveNoteToWorkspace(noteId, targetWorkspaceId, authWorkspaceId);
					if (authUserId) {
						removePendingNoteMove(authUserId, noteId);
					}
					shouldShowQueuedMessage = false;
				} catch (error) {
					const message = error instanceof Error ? error.message : '';
					const status = typeof (error as { status?: unknown } | null | undefined)?.status === 'number'
						? (error as { status: number }).status
						: null;
					const isNetworkFailure = /failed to fetch|networkerror|load failed/i.test(message);
					if (status === 409) {
						if (authUserId) {
							removePendingNoteMove(authUserId, noteId);
						}
						shouldShowQueuedMessage = false;
					} else if (isNetworkFailure || status == null || status >= 500) {
						// Keep the local move and persisted queue when the server response is
						// ambiguous. The move may have already committed remotely.
						shouldShowQueuedMessage = true;
					} else {
						await manager.moveNoteToWorkspaceLocally(noteId, authWorkspaceId, {
							sourceWorkspaceId: targetWorkspaceId,
							title: noteTitle,
						});
						if (authUserId) {
							removePendingNoteMove(authUserId, noteId);
						}
						throw error;
					}
				}
			}
			setMoveNoteModalState(null);
			showBriefDialog(t(shouldShowQueuedMessage ? 'workspace.moveNoteQueued' : 'workspace.moveNoteSuccess'));
		} catch (error) {
			setMoveNoteError(error instanceof Error ? error.message : t('workspace.moveNoteFailed'));
		} finally {
			setMoveNoteBusy(false);
		}
	}, [authOfflineMode, authUserId, authWorkspaceId, manager, moveNoteModalState, showBriefDialog, t]);

	const handleEmptyTrashNow = React.useCallback(async () => {
		if (authStatus !== 'authed' || authOfflineMode || typeof navigator !== 'undefined' && navigator.onLine === false) {
			showBriefDialog(t('app.emptyTrashOfflineUnavailable'));
			return;
		}
		if (!window.confirm(t('app.emptyTrashConfirm'))) return;
		setEmptyTrashBusy(true);
		try {
			const result = await emptyTrashNow();
			await Promise.all(result.noteIds.map((noteId) => manager.permanentlyDeleteNote(noteId).catch(() => undefined)));
			setSelectedNoteId((current) => current && result.noteIds.includes(current) ? null : current);
			setOpenDocId((current) => {
				if (!current || !result.noteIds.includes(current)) return current;
				setOpenDoc(null);
				return null;
			});
			if (result.deletedCount <= 0) {
				showBriefDialog(t('app.emptyTrashAlreadyEmpty'));
			} else if (result.deletedCount === 1) {
				showBriefDialog(t('app.emptyTrashSuccessSingle'));
			} else {
				showBriefDialog(`${result.deletedCount} ${t('app.emptyTrashSuccessPlural')}`);
			}
		} catch (error) {
			showBriefDialog(error instanceof Error ? error.message : t('app.emptyTrashFailed'));
		} finally {
			setEmptyTrashBusy(false);
		}
	}, [authOfflineMode, authStatus, manager, showBriefDialog, t]);

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

		setSidebarView(filterSidebarView);
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
		filterSidebarView,
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
		let retryTimer: ReturnType<typeof setTimeout> | null = null;
		const MAX_RECONNECT_FLUSH_ATTEMPTS = 8;
		const onOnline = (): void => {
			// Small delay to let the network connection stabilise after the
			// browser fires the `online` event (DNS/TLS may still be settling).
			if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
			const attemptFlush = (attempt: number): void => {
				void (async () => {
					await new Promise((r) => setTimeout(r, attempt === 0 ? 600 : 2000));
					void scheduleQueuedNoteImageFlush(authUserId);
					void scheduleQueuedNoteDocumentFlush(authUserId);
					await flushQueuedNoteLinkSync(authUserId);
					void refreshNoteShareState();
					// After each attempt, re-scan placeholders in cache so hydrated rows
					// are picked up even if a websocket reconnect event is delayed.
					void scanAllDocumentsForPlaceholders();

					const stillQueued = await hasQueuedNoteLinkSync(authUserId);
					if (stillQueued && attempt < MAX_RECONNECT_FLUSH_ATTEMPTS) {
						retryTimer = setTimeout(() => { retryTimer = null; attemptFlush(attempt + 1); }, 3000);
					}
				})();
			};
			attemptFlush(0);
		};
		window.addEventListener('online', onOnline);
		return () => {
			window.removeEventListener('online', onOnline);
			if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
		};
	}, [authStatus, authUserId, refreshNoteShareState]);

	React.useEffect(() => {
		if (authStatus !== 'authed') return;
		if (viewMode === 'bubble' || sidebarView === 'images') {
			setSearchResults([]);
			setSearchResultsBusy(false);
			setSearchResultsError(null);
			return;
		}
		if (!deferredSearchQuery) {
			setSearchResults([]);
			setSearchResultsBusy(false);
			setSearchResultsError(null);
			return;
		}

		let cancelled = false;
		const timer = window.setTimeout(() => {
			setSearchResultsBusy(true);
			setSearchResultsError(null);
			const isOfflineSearch = authOfflineMode || (typeof navigator !== 'undefined' && navigator.onLine === false);
			const offlineRequest = searchOfflineNotes({
				manager,
				query: deferredSearchQuery,
				authUserId,
				activeWorkspaceId: authWorkspaceId,
				activeWorkspaceName,
				collections,
				labels,
				sharedPlacements,
			});
			const request = isOfflineSearch
				? offlineRequest.then((results) => ({ results }))
				: Promise.all([searchNotes(deferredSearchQuery), offlineRequest]).then(([remoteResponse, offlineResults]) => {
					const merged = new Map<string, NoteSearchResult>();
					for (const result of remoteResponse.results) {
						merged.set(`${result.docId}:${result.openNoteId || result.noteId}`, result);
					}
					for (const result of offlineResults) {
						const key = `${result.docId}:${result.openNoteId || result.noteId}`;
						const current = merged.get(key);
						if (!current) {
							merged.set(key, result);
							continue;
						}
						merged.set(key, {
							...current,
							matchKinds: Array.from(new Set([...current.matchKinds, ...result.matchKinds])),
							collaboratorMatches: Array.from(new Set([...current.collaboratorMatches, ...result.collaboratorMatches])).slice(0, 3),
							collectionMatches: Array.from(new Set([...current.collectionMatches, ...result.collectionMatches])).slice(0, 3),
							labelMatches: Array.from(new Set([...current.labelMatches, ...result.labelMatches])).slice(0, 4),
							snippet: current.snippet || result.snippet,
							thumbnailUrl: current.thumbnailUrl || result.thumbnailUrl,
							imageCount: Math.max(current.imageCount, result.imageCount),
							updatedAt: Date.parse(current.updatedAt) >= Date.parse(result.updatedAt) ? current.updatedAt : result.updatedAt,
						});
					}
					return {
						results: Array.from(merged.values()).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
					};
				});
			void request
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
	}, [activeWorkspaceName, authOfflineMode, authStatus, authUserId, authWorkspaceId, collections, deferredSearchQuery, labels, manager, sharedPlacements, sidebarView, t, viewMode]);

	const clearSearchAndClose = React.useCallback(() => {
		setSearchQuery('');
		setSearchResults([]);
		setSearchResultsError(null);
		setSearchResultsBusy(false);
		closeMobileSearch();
	}, [closeMobileSearch]);
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
		if (kind === 'collection') return 'Collection';
		if (kind === 'label') return 'Label';
		return t('search.matchNote');
	}, [t]);
	const handleSearchResultSelect = React.useCallback(async (result: NoteSearchResult) => {
		setSearchQuery('');
		setSearchResults([]);
		setSearchResultsError(null);
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
		// Auth check in progress — render a blank app-background screen.
		// Resolves in <200 ms for cached auth, after which the grid skeleton takes over.
		return <div className="splash-shell" />;
	}

	if (externalRoute?.kind === 'share') return shareRouteView;

	if (externalRoute?.kind === 'invite') return inviteRouteView;

	const canCreateNotesInActiveWorkspace = Boolean(authWorkspaceId && activeWorkspaceSystemKind !== 'SHARED_WITH_ME' && canEditActiveWorkspace);
	const canCreateNotesInCurrentContext = viewMode === 'bubble'
		? Boolean(bubbleSelectedWorkspace?.id && bubbleSelectedWorkspace.systemKind !== 'SHARED_WITH_ME' && canEditBubbleSelectedWorkspace)
		: canCreateNotesInActiveWorkspace;
	const selectedSharedPlacement = selectedNoteId ? sharedPlacements.find((placement) => placement.aliasId === selectedNoteId) ?? null : null;
	const selectedNoteDocId = selectedNoteId ? selectedSharedPlacement?.roomId || (authWorkspaceId ? `${authWorkspaceId}:${selectedNoteId}` : '') : '';
	const selectedNoteReadOnly = selectedSharedPlacement ? selectedSharedPlacement.role === 'VIEWER' : !canEditActiveWorkspace;
	const canManageSelectedNoteCollaborators = selectedSharedPlacement ? selectedSharedPlacement.role === 'EDITOR' : canEditActiveWorkspace;
	const selectedNewNoteCollectionSeed = selectedNoteId ? pendingNewNoteCollectionSeedRef.current.get(selectedNoteId) ?? null : null;
	const selectedQuickCreateCollectionOption = selectedNoteId && openDoc && selectedNewNoteCollectionSeed && !selectedNoteReadOnly
		? {
			label: selectedNewNoteCollectionSeed.label,
			checked: selectedNoteMetadata.collectionId === selectedNewNoteCollectionSeed.collectionId,
			onChange: (next: boolean) => {
				assignNoteToCollection(openDoc, next ? selectedNewNoteCollectionSeed.collectionId : null);
			},
		}
		: undefined;

	return (
		<>
		{!splashGone && (
			<div
				aria-hidden="true"
				className={`splash-overlay${gridReady ? ' splash-fade-out' : ''}`}
			>
				<div className="splash-content">
					<img className="splash-icon" src={headerIconSrc} alt="" />
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
								<span className={`app-header-logo-stack mobile-app-icon is-${headerConnectionState}`} aria-hidden="true">
									<img className="app-header-logo" src={headerIconSrc} alt="" />
									<span className="app-header-connection-line" />
								</span>
							<button
								type="button"
								className={`app-icon-button mobile-search-btn${isMobileSearchOpen ? ' is-active' : ''}`}
								onClick={() => {
									if (isMobileSearchOpen) {
										closeMobileSearch();
										return;
									}
									openMobileSearch();
								}}
								aria-label={isMobileSearchOpen ? t('common.close') : t('app.globalSearchPlaceholder')}
								aria-pressed={isMobileSearchOpen}
								title={isMobileSearchOpen ? t('common.close') : t('app.globalSearchPlaceholder')}
							>
								<FontAwesomeIcon icon={isMobileSearchOpen ? faXmark : faMagnifyingGlass} />
							</button>
							<button
								type="button"
								className="app-icon-button app-notification-button mobile-notification-btn"
								onClick={openShareNotifications}
								aria-label={t('prefs.notifications')}
								title={t('prefs.notifications')}
							>
								<FontAwesomeIcon icon={faBell} />
								{totalNotificationCount > 0 ? (
									<span className="app-notification-badge" aria-hidden="true">
										{totalNotificationCount > 99 ? '99+' : totalNotificationCount}
									</span>
								) : null}
							</button>
							<button
								type="button"
								className="app-icon-button mobile-appgrid-btn"
								onClick={cycleGridViewMode}
								aria-label="Cycle note view"
								title="Cycle note view"
							>
								<FontAwesomeIcon icon={viewModeIcon} />
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
									name="global-search-mobile"
									autoComplete="off"
									autoCorrect="off"
									autoCapitalize="none"
									spellCheck={false}
									data-bwignore="true"
									data-lpignore="true"
									data-1p-ignore="true"
									className="app-header-search-input"
									value={searchQuery}
									onChange={(event) => setSearchQuery(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === 'Escape') closeMobileSearch();
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
								<span className={`app-header-logo-stack is-${headerConnectionState}`} aria-hidden="true">
									<img className="app-header-logo" src={headerIconSrc} alt="" />
									<span className="app-header-connection-line" />
								</span>
						</div>
						<div className="app-header-search">
							<input
								type="search"
								name="global-search"
								autoComplete="off"
								autoCorrect="off"
								autoCapitalize="none"
								spellCheck={false}
								data-bwignore="true"
								data-lpignore="true"
								data-1p-ignore="true"
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
								aria-label={t('prefs.notifications')}
								title={t('prefs.notifications')}
							>
								<FontAwesomeIcon icon={faBell} />
								{totalNotificationCount > 0 ? (
									<span className="app-notification-badge" aria-hidden="true">
										{totalNotificationCount > 99 ? '99+' : totalNotificationCount}
									</span>
								) : null}
							</button>
							<button
								type="button"
								className="app-icon-button"
								onClick={cycleGridViewMode}
								aria-label="Cycle note view"
								title="Cycle note view"
							>
								<FontAwesomeIcon icon={viewModeIcon} />
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
							const isOpen = entry.id === 'workspaces' && sidebarUsesBubbleSummaryMenus ? true : Boolean(sidebarGroupsOpen[entry.id]);
							const groupContent = sidebarGroupContent[entry.id] ?? [];
							const ariaLabel = entry.id === 'workspaces'
								? (sidebarUsesBubbleSummaryMenus
									? 'Workspaces'
									: `${t('workspace.sidebarTitle')}: ${activeWorkspaceName || t('workspace.unnamed')}`)
								: entry.label;
							const label = entry.label;
							const isEntryActive =
								(entry.id === 'trash' && sidebarView === 'trash') ||
								(entry.id === 'images' && sidebarView === 'images') ||
								(entry.id === 'notes' && sidebarView === 'notes');
							return (
								<div key={entry.id}>
									<button
										ref={(node) => {
											sidebarEntryButtonRefs.current[entry.id] = node;
										}}
										type="button"
										className={`app-sidebar-link${isGroup && isOpen ? ' is-open' : ''}${isEntryActive ? ' is-active' : ''}`}
										onClick={() => {
											if (!isMobileViewport && sidebarIsCollapsed) {
												if ((entry.id === 'collections' || entry.id === 'labels') && sidebarUsesBubbleSummaryMenus) {
													return;
												}
												if (entry.id === 'workspaces' && sidebarWorkspaces.length === 0) {
													void loadSidebarWorkspaces();
												}
												expandDesktopSidebarForEntry(entry.id, isGroup);
												return;
											}
											if (entry.id === 'workspaces') {
												if (sidebarUsesBubbleSummaryMenus) {
													if (sidebarIsCollapsed) {
														expandDesktopSidebarForEntry(entry.id, isGroup);
													}
													return;
												}
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
											if ((entry.id === 'collections' || entry.id === 'labels') && sidebarUsesBubbleSummaryMenus) {
												return;
											}
											if (entry.id === 'trash') {
												setActiveSharedFolder(null);
												setSidebarView('trash');
												if (isMobileViewport) closeMobileSidebar();
												return;
											}
											if (entry.id === 'images') {
												setActiveSharedFolder(null);
												setSidebarView('images');
												if (isMobileViewport) closeMobileSidebar();
												return;
											}
											if (entry.id === 'notes') {
												setActiveSharedFolder(null);
												setSidebarView('notes');
												setActiveCollectionId(null);
												setActiveLabelIds([]);
												setActiveReminderFilter('all');
												setActiveSortMode('manual');
												setActiveSortGrouping('none');
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
											<div ref={workspaceMenuRef} className="sidebar-submenu sidebar-workspace-menu" aria-label={sidebarUsesBubbleSummaryMenus ? 'Workspaces' : t('workspace.listAria')} aria-hidden={!isOpen}>
											{sidebarUsesBubbleSummaryMenus ? (
												<>
													<div className="sidebar-workspace-muted sidebar-submenu-muted sidebar-workspace-legend-summary" style={{ ['--sidebar-item-index' as const]: 0 }}>
															Workspaces
													</div>
														<div className="sidebar-workspace-muted sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: 1 }}>
															New notes placed in selected workspace
														</div>
													{sidebarWorkspacesBusy ? (
															<div className="sidebar-workspace-muted sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: 2 }}>{t('common.loading')}</div>
													) : null}
													{sidebarWorkspacesError ? (
															<div className="sidebar-workspace-muted sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: 3 }}>{sidebarWorkspacesError}</div>
													) : null}
													{bubbleWorkspaceLegend.length === 0 && !sidebarWorkspacesBusy ? (
															<div className="sidebar-workspace-muted sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: 4 }}>{t('workspace.none')}</div>
													) : null}
													{bubbleWorkspaceLegend.map((workspace, index) => (
															<button
															key={workspace.id}
																type="button"
															className={`sidebar-workspace-legend-item${workspace.isActive ? ' is-active' : ''}`}
																onClick={() => {
																	setBubbleWorkspaceSelectionId(workspace.id);
																	if (sidebarView === 'trash' || sidebarView === 'archive') {
																		setActiveSharedFolder(null);
																		setSidebarView('notes');
																	}
																	if (isMobileViewport) closeMobileSidebar();
																}}
																style={{ ['--sidebar-item-index' as const]: index + 5 } as React.CSSProperties}
														>
															<span className="sidebar-workspace-legend-swatch" style={workspace.style} aria-hidden="true" />
															<span className="sidebar-workspace-legend-label">{truncateUiName(workspace.name, 44)}</span>
															</button>
													))}
												</>
											) : (
												<>
												<button
												type="button"
												className="sidebar-workspace-manage sidebar-workspace-manage-top sidebar-submenu-action"
												onClick={() => {
													closeWorkspaceSidebarGroup();
													openWorkspaceSwitcher({ replaceTop: isMobileViewport && isMobileSidebarOpen });
												}}
												style={{ ['--sidebar-item-index' as const]: 0 }}
											>
												{t('workspace.manage')}
											</button>
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
												const workspaceDisplayName = getWorkspaceDisplayName(ws, t);
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
																	aria-label={workspaceDisplayName}
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
																		setSidebarView('notes');
																		void activateWorkspaceFromSidebar(ws.id, { activeSharedFolder: null });
																	} else if (sidebarView === 'trash' || sidebarView === 'archive' || sidebarView === 'images') {
																		setActiveSharedFolder(null);
																		setSidebarView('notes');
																		if (isMobileViewport) closeMobileSidebar();
																	} else if (ws.systemKind === 'SHARED_WITH_ME') {
																		void persistSharedWorkspaceSelection(ws.id, null);
																	} else if (isMobileViewport) {
																		closeMobileSidebar();
																	}
																}}
																title={workspaceDisplayName}
																style={{ ['--sidebar-item-index' as const]: itemIndex }}
															>
																<span className="sidebar-submenu-item-label">{truncateUiName(workspaceDisplayName, 44)}</span>
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
																				setSidebarView(filterSidebarView);
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
																			<span className="sidebar-submenu-item-label">{truncateUiName(folderName, 44)}</span>
																		</button>
																	))}
																</div>
															</div>
														) : null}
													</div>
												);
											})}
												</>
											)}
											</div>
										</div>
									) : null}

									{entry.id !== 'workspaces' && isGroup && (entry.id === 'collections' || groupContent.length > 0) && !sidebarIsCollapsed ? (
										<div className={`sidebar-submenu-shell${isOpen ? ' is-open' : ''}`}>
											<div className={`sidebar-submenu${entry.id === 'collections' ? ' sidebar-collections-menu' : ''}`} aria-hidden={!isOpen}>
												{entry.id === 'collections' ? (
														sidebarUsesBubbleSummaryMenus ? (
														<div className="sidebar-submenu-muted">All Collections</div>
													) : (
													// Sticky top action for collections — mirrors the workspace dropdown
													// so "Manage Collections" is always reachable regardless of list length.
													<button
														type="button"
														className="sidebar-submenu-action sidebar-submenu-manage-top"
														onClick={() => {
															openCollectionManagementModal();
															setActiveSharedFolder(null);
																setSidebarView(filterSidebarView);
															if (isMobileViewport) closeMobileSidebar();
														}}
														style={{ ['--sidebar-item-index' as const]: 0 }}
													>
														{t('app.sidebarManageCollections')}
													</button>
													)
												) : null}
													{entry.id === 'collections'
														? (sidebarUsesBubbleSummaryMenus
														? null
														: collectionTree.length > 0
														? renderCollectionSidebarNodes(collectionTree)
															: <div className="sidebar-submenu-muted">No collections yet.</div>)
													: groupContent.map((item, index) => {
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
														const isLabelsItemActive = entry.id === 'labels' && item.kind === 'item' && activeLabelIds.includes(item.id);
														const isReminderItemActive = entry.id === 'reminders' && item.kind === 'item' && activeReminderFilter === item.id;
														const className = `${item.kind === 'action' ? 'sidebar-submenu-action' : 'sidebar-submenu-item'}${isLabelsItemActive || isReminderItemActive ? ' is-active' : ''}`;
														return (
															<button
																key={item.id}
																type="button"
																className={className}
																onClick={() => {
																	if (entry.id === 'labels' && item.kind === 'item') {
																		setSidebarView(filterSidebarView);
																		setActiveLabelIds((current) => current.includes(item.id) ? current.filter((entryId) => entryId !== item.id) : [...current, item.id]);
																		if (isMobileViewport) closeMobileSidebar();
																		return;
																	}
																	if (entry.id === 'reminders' && item.kind === 'item') {
																		setSidebarView(filterSidebarView);
																		setActiveReminderFilter(item.id as ReminderFilterMode);
																		if (isMobileViewport) closeMobileSidebar();
																	}
																}}
																style={{ ['--sidebar-item-index' as const]: index }}
															>
																<span className="sidebar-submenu-item-label" title={item.label}>{truncateUiName(item.label, 44)}</span>
															</button>
														);
													})}
											</div>
										</div>
									) : null}

									{entry.id === 'sorting' && !sidebarIsCollapsed ? (
										<div className={`sidebar-submenu-shell${isOpen ? ' is-open' : ''}`}>
											<div className="sidebar-submenu" aria-hidden={!isOpen}>
												{sortingPrimaryItems.map((item, index) => {
													const isActive = activeSortMode === item.id;
													const isToggleable = isToggleableSortMode(item.id);
													const displayLabel = isToggleable
														? `${item.label}`
														: item.label;
													return (
														<button
															key={item.id}
															type="button"
															className={`sidebar-submenu-item${isActive ? ' is-active' : ''}`}
															onClick={() => {
																setSidebarView(filterSidebarView);
																if (isToggleable && isActive) {
																	// Second tap on an active sortable field flips direction.
																	setSortDirectionByMode((current) => ({
																		...current,
																		[item.id]: current[item.id] === 'asc' ? 'desc' : 'asc',
																	}));
																} else {
																	setActiveSortMode(item.id as NoteSortMode);
																}
																if (isMobileViewport) closeMobileSidebar();
															}}
															style={{ ['--sidebar-item-index' as const]: index }}
														>
															<span className="sidebar-submenu-item-label">{displayLabel}</span>
															{isToggleable ? <span className="sidebar-sort-direction">{getSortDirectionMarker(sortDirectionByMode[item.id])}</span> : null}
														</button>
													);
												})}
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
																		const isActive = item.id === 'past-due' || item.id === 'due-soon'
																			? activeReminderFilter === item.id
																			: item.id === 'least-accessed' || item.id === 'most-edited'
																				? activeSortMode === item.id
																				: item.id === 'by-week'
																					? activeSortGrouping === 'week'
																					: item.id === 'by-month'
																						? activeSortGrouping === 'month'
																				: false;
																		const className = `${item.kind === 'action' ? 'sidebar-submenu-action' : 'sidebar-submenu-item'}${isActive ? ' is-active' : ''}`;
																		return (
																			<button
																				key={item.id}
																				type="button"
																				className={className}
																				onClick={() => {
																					setSidebarView(filterSidebarView);
																					if (item.id === 'clear') {
																						setActiveReminderFilter('all');
																						setActiveSortMode('manual');
																						setActiveSortGrouping('none');
																					} else if (item.id === 'past-due' || item.id === 'due-soon') {
																						setActiveReminderFilter(item.id as ReminderFilterMode);
																					} else if (item.id === 'least-accessed' || item.id === 'most-edited') {
																						setActiveSortMode(item.id as NoteSortMode);
																					} else if (item.id === 'by-week' || item.id === 'by-month') {
																						setActiveSortGrouping(item.id === 'by-week' ? 'week' : 'month');
																					}
																					if (isMobileViewport) closeMobileSidebar();
																				}}
																				style={{ ['--sidebar-item-index' as const]: itemIndex }}
																			>
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
					{deferredSearchQuery && viewMode !== 'bubble' && sidebarView !== 'images' ? (
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
															{result.collaboratorMatches.length > 0 || result.collectionMatches.length > 0 || result.labelMatches.length > 0 ? (
															<div className="global-search-result-contexts">
																{result.collaboratorMatches.map((label) => <span key={`${result.docId}:${label}`} className="global-search-result-context">{t('search.collaboratorPrefix')} {label}</span>)}
																	{result.collectionMatches.map((label) => <span key={`${result.docId}:collection:${label}`} className="global-search-result-context">Collection: {label}</span>)}
																	{result.labelMatches.map((label) => <span key={`${result.docId}:label:${label}`} className="global-search-result-context">Label: {label}</span>)}
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

					{/* Archive/trash views are read-focused; only notes view shows quick-create. */}
					{(sidebarView === 'notes' || sidebarView === 'trash' || sidebarView === 'images') ? (
						<div ref={topControlsRef} className="app-main-sticky">
{sidebarView === 'notes' ? (
						// Reserve the button-row height unconditionally so the grid
						// doesn't shift down when canCreateNotesInCurrentContext resolves.
						<div className="top-actions">
							<button
								type="button"
								className="top-action-card"
								disabled={!canCreateNotesInCurrentContext}
								onClick={() => void openCreateEditorForCurrentContext('text')}
							>
								{t('app.createNewNote')}
							</button>
							<button
								type="button"
								className="top-action-card"
								disabled={!canCreateNotesInCurrentContext}
								onClick={() => void openCreateEditorForCurrentContext('checklist')}
							>
										{t('app.createNewChecklist')}
									</button>
								</div>
							) : null}

							<div className="note-grid-scope" aria-live="polite">
								{viewMode === 'bubble' && sidebarView !== 'images' ? (
									<div className="note-grid-scope-chip">
										<span className="note-grid-scope-label">All Workspaces</span>
										<input
											type="range"
											className="note-grid-scope-slider"
											min={BUBBLE_ZOOM_MIN}
											max={BUBBLE_ZOOM_MAX}
											step={1}
											value={bubbleZoom}
											onChange={(event) => setBubbleZoom(Number(event.target.value))}
											aria-label="Bubble zoom"
										/>
									</div>
								) : activeFilterChips.length === 0 ? (
									<div className="note-grid-scope-chip">
										<span className="note-grid-scope-label">{noteGridScopeLabel}</span>
									</div>
								) : null}
								{viewMode !== 'bubble' || sidebarView === 'images' ? activeFilterChips.map((chip) => (
									<div
										key={chip.key}
										className={`note-grid-scope-chip is-clearable${chip.onPrimaryAction ? ' is-interactive' : ''}`}
										onClick={chip.onPrimaryAction}
										onKeyDown={(event) => {
											if (!chip.onPrimaryAction) return;
											if (event.key !== 'Enter' && event.key !== ' ') return;
											event.preventDefault();
											chip.onPrimaryAction();
										}}
										role={chip.onPrimaryAction ? 'button' : undefined}
										tabIndex={chip.onPrimaryAction ? 0 : undefined}
										aria-label={chip.onPrimaryAction ? chip.primaryAriaLabel : undefined}
									>
										<span className="note-grid-scope-label">{chip.label}</span>
										<button
											type="button"
											className="note-grid-scope-clear"
											onClick={(event) => {
																	// Keep clear/remove behavior independent from chip primary action.
												event.stopPropagation();
												chip.onClear();
											}}
											aria-label={t('common.close')}
										>
											<FontAwesomeIcon icon={faXmark} />
										</button>
									</div>
								)) : null}
								{sidebarView === 'trash' && canEditActiveWorkspace ? (
									<div className="note-grid-scope-actions">
										<button
											type="button"
											className="note-grid-scope-actionButton"
											onClick={() => void handleEmptyTrashNow()}
											disabled={emptyTrashBusy}
										>
											{emptyTrashBusy ? t('common.loading') : t('app.emptyTrashNow')}
										</button>
									</div>
								) : null}

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
									commitChecklistShowCompletedPref(next);
								}}
							/>
						) : null}
					</section>

				{/* NoteGrid stays mounted in bubble mode (display:none) so DocumentManager keeps docs loaded. */}
				<div style={{ display: viewMode === 'bubble' || sidebarView === 'images' ? 'none' : undefined }}>
					<NoteGrid
						key={stableWorkspaceKeyRef.current}
						// Width behavior (desktop vs mobile, portrait/landscape) is centralized in NoteGrid.
						authUserId={authUserId}
						themeId={themeId}
						activeWorkspaceId={authWorkspaceId}
						selectedNoteId={selectedNoteId}
						canEditWorkspaceContent={canEditActiveWorkspace}
						sharedNotes={sidebarView === 'trash' ? [] : visibleSharedPlacements}
						activeCollaboratorFilter={noteGridCollaboratorFilter}
						activeCollectionId={activeCollectionId}
						activeLabelIds={activeLabelIds}
						collections={collections}
						labels={labels}
						reminderFilter={activeReminderFilter}
						sortMode={activeSortMode}
						sortDirection={activeSortDirection}
						sortGrouping={activeSortGrouping}
						refreshCollaboratorsToken={collaborationRefreshToken}
						maxCardHeightPx={maxCardHeightPx}
						noteCardClickOpens={noteCardClickOpensPref}
						// When the trash view is active, NoteGrid switches to rendering trashed notes.
						showTrashed={sidebarView === 'trash'}
						showArchived={sidebarView === 'archive'}
						onAddCollaborator={canEditActiveWorkspace ? openCollaboratorModalForNote : undefined}
						onAddImage={openNoteImageModal}
						onAddDocument={undefined}
						onAddReminder={openNoteReminderModal}
						onAddToCollection={openNoteCollectionModal}
						onAddLabels={openNoteLabelsModal}
						onMoveToWorkspace={(noteId, title) => openMoveNoteModal(noteId, title)}
						onOpenAttachmentBrowser={openNoteAttachmentBrowser}
						onSelectCollaboratorFilter={setNoteGridCollaboratorFilter}
						onSelectCollectionFilter={(collectionId) => {
							setSidebarView('notes');
							setActiveCollectionId(collectionId);
						}}
						onToggleLabelFilter={(labelId) => {
							setSidebarView('notes');
							setActiveLabelIds((current) => current.includes(labelId) ? current.filter((entry) => entry !== labelId) : [...current, labelId]);
						}}
									canReorder={canEditActiveWorkspace && !noteGridCollaboratorFilter && !activeCollectionId && activeLabelIds.length === 0 && activeReminderFilter === 'all' && activeSortMode === 'manual' && activeSortGrouping === 'none' && sidebarView === 'notes'}
									emptyStateLabel={noteGridEmptyStateLabel}
								onTouchReorderEnd={() => {
									setSelectedNoteId(null);
								}}
						onSelectNote={(id) => {
							// Branch: selecting a note should close the create editor.
							openNoteEditor(id, { replaceTop: editorMode !== 'none' });
						}}
						// NoteGrid calls onReady once it has loaded all docs.
						// Dismiss the splash overlay when this fires.
						onReady={() => {
							setGridReady(true);
							// Give the CSS fade-out transition 500 ms to complete,
							// then unmount the overlay node entirely.
							clearTimeout(splashTimerRef.current);
							splashTimerRef.current = window.setTimeout(() => setSplashGone(true), 500);
						}}
						// Layout animations are managed internally by NoteGrid
						// (held until allDocsLoaded, then enabled after 2 rAFs).
						enableLayoutAnimations={true}
						// Device ID scopes the height cache so skeleton cards render
						// at the correct size for this device/viewport combination.
						deviceId={deviceId}
						viewMode={viewMode === 'bubble' ? 'card' : viewMode}
				/>
				</div>
				{sidebarView === 'images' ? (
					<WorkspaceImagesGallery
						authUserId={authUserId}
						collections={collections}
						labels={labels}
						activeCollectionId={activeCollectionId}
						activeLabelIds={activeLabelIds}
						activeCollaboratorFilter={noteGridCollaboratorFilter}
						reminderFilter={activeReminderFilter}
						sortMode={activeSortMode}
						sortDirection={activeSortDirection}
						sortGrouping={activeSortGrouping}
						refreshCollaboratorsToken={collaborationRefreshToken}
						sharedNotes={visibleSharedPlacements}
						searchQuery={deferredSearchQuery}
					/>
				) : null}
				{/* BubbleView overlays the grid — NoteGrid stays mounted above (display:none) */}
				{viewMode === 'bubble' && sidebarView !== 'images' && authWorkspaceId ? (
						<BubbleView
							workspaces={sidebarWorkspaces as BubbleWorkspaceInfo[]}
							activeWorkspaceId={authWorkspaceId}
							authUserId={authUserId}
							sharedPlacements={sharedPlacements}
							themeId={themeId}
							zoom={bubbleZoom}
							showTrashed={sidebarView === 'trash'}
							reminderFilter={activeReminderFilter}
							searchQuery={deferredSearchQuery}
							sidebarIsCollapsed={sidebarIsCollapsed}
							onSelectNote={handleBubbleNoteSelect}
						/>
					) : null}
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
				onAddDocument={undefined}
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

			{canCreateNotesInCurrentContext && sidebarView === 'notes' ? <div className={`mobile-fab-stack${isFabOpen ? ' is-open' : ''}`}>
				<button
					type="button"
					className="mobile-fab-action"
					onClick={() => {
						void openCreateEditorForCurrentContext('text', { replaceTop: true });
					}}
				>
					{t('app.createNote')}
				</button>
				<button
					type="button"
					className="mobile-fab-action"
					onClick={() => {
						void openCreateEditorForCurrentContext('checklist', { replaceTop: true });
					}}
				>
					{t('app.createChecklist')}
				</button>
			</div> : null}

			{canCreateNotesInCurrentContext && sidebarView === 'notes' ? (
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
					themeId={themeId}
					doc={openDoc}
					quickCreateCollectionOption={selectedQuickCreateCollectionOption}
					onClose={closeNoteEditor}
					onDelete={onDeleteSelectedNote}
					onAddCollaborator={canManageSelectedNoteCollaborators ? () => openCollaboratorModalForNote(selectedNoteId, openDoc.getText('title').toString()) : undefined}
					onAddImage={selectedNoteReadOnly ? undefined : () => {
						if (!selectedNoteDocId) return;
						openNoteImageModal(selectedNoteId, selectedNoteDocId, openDoc.getText('title').toString());
					}}
					onAddDocument={undefined}
						onAddReminder={selectedNoteReadOnly ? undefined : () => openNoteReminderModal(selectedNoteId, openDoc.getText('title').toString())}
						onAddToCollection={selectedNoteReadOnly ? undefined : () => openNoteCollectionModal(selectedNoteId, openDoc.getText('title').toString())}
						onAddLabels={selectedNoteReadOnly ? undefined : () => openNoteLabelsModal(selectedNoteId, openDoc.getText('title').toString())}
					onMoveToWorkspace={!selectedSharedPlacement && !selectedNoteReadOnly ? () => openMoveNoteModal(selectedNoteId, openDoc.getText('title').toString()) : undefined}
					readOnly={selectedNoteReadOnly}
					initialShowCompleted={checklistShowCompletedPref}
					allowQuickDelete={quickDeleteChecklistPref}
					onShowCompletedChange={(next) => {
						commitChecklistShowCompletedPref(next);
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
				isLightTheme={isLightTheme(themeId)}
				quickDeleteChecklist={quickDeleteChecklistPref}
				noteCardClickOpens={noteCardClickOpensPref}
				deleteAfterDays={trashDeleteAfterDaysPref}
				installAvailable={pwaState.canInstall}
				installMethod={pwaState.installMethod}
				installBusy={pwaInstallBusy}
				onInstallApp={async () => {
					setPwaInstallBusy(true);
					try {
						const outcome = await promptInstallApp();
						if (outcome === 'accepted') {
							showBriefDialog(t('prefs.installAcceptedToast'));
						}
					} finally {
						setPwaInstallBusy(false);
					}
				}}
				onQuickDeleteChecklistChange={(next) => {
					commitQuickDeleteChecklistPref(next);
				}}
				onNoteCardClickOpensChange={(next) => {
					commitNoteCardClickOpensPref(next);
				}}
				onDeleteAfterDaysChange={(next) => {
					setTrashDeleteAfterDaysPref(next);
					if (authStatus !== 'authed') return;
					if (authOfflineMode) return;
					void updateUserPreferences(deviceId, { deleteAfterDays: next });
				}}
				onOpenAppearance={openAppearanceFromPreferences}
				onOpenUser={openUserFromPreferences}
				connectionState={connection.state}
				deviceId={deviceId}
				onUserManagement={openUserManagementFromPreferences}
				onSendInvite={openSendInviteFromPreferences}
				onSignOut={() => void signOut()}
			/>

			<CollectionManagementModal
				isOpen={isCollectionManagementOpen}
				onClose={() => setIsCollectionManagementOpen(false)}
				collections={collections}
				onCreate={handleCreateCollection}
				onRename={handleRenameCollection}
				onDelete={handleDeleteCollection}
			/>

			<NoteCollectionModal
				isOpen={Boolean(noteCollectionModalState)}
				onClose={() => setNoteCollectionModalState(null)}
				collections={collections}
				selectedCollectionId={noteCollectionMetadata.collectionId}
				noteTitle={noteCollectionModalState?.title}
				onSelectCollection={handleSelectNoteCollection}
			/>

			<NoteLabelsModal
				isOpen={Boolean(noteLabelsModalState)}
				onClose={() => setNoteLabelsModalState(null)}
				labels={labels}
				selectedLabelIds={noteLabelsMetadata.labelIds}
				noteTitle={noteLabelsModalState?.title}
				onToggleLabel={handleToggleNoteLabel}
				onCreateLabel={handleCreateLabel}
			/>

			<ReminderModal
				isOpen={Boolean(noteReminderModalState)}
				onClose={() => setNoteReminderModalState(null)}
				reminderAt={noteReminderMetadata.reminderAt}
				noteTitle={noteReminderModalState?.title}
				onSave={handleSaveNoteReminder}
			/>

			<MoveNoteModal
				isOpen={Boolean(moveNoteModalState)}
				onClose={closeMoveNoteModal}
				onSelectWorkspace={(workspaceId) => void handleMoveNoteToWorkspace(workspaceId)}
				t={t}
				workspaces={moveNoteWorkspaceOptions}
				currentWorkspaceId={authWorkspaceId}
				noteTitle={moveNoteModalState?.title ?? ''}
				busy={moveNoteBusy}
				error={moveNoteError}
			/>

			<UserModal
				isOpen={isUserOpen}
				onClose={() => {
					if (goBackIfOverlayHistory()) return;
					setIsUserOpen(false);
					setUserModalError(null);
				}}
				onBack={backToPreferencesFromUser}
				t={t}
				currentProfileImage={authProfileImage}
				busy={userModalBusy}
				error={userModalError}
				onSave={handleSaveUserAvatar}
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
				noteCardFontScale={noteCardFontScalePref}
				onNoteCardFontScaleChange={handleNoteCardFontScaleChange}
				onNoteCardFontScaleCommit={commitNoteCardFontScaleChange}
				noteEditorFontScale={noteEditorFontScalePref}
				onNoteEditorFontScaleChange={handleNoteEditorFontScaleChange}
				onNoteEditorFontScaleCommit={commitNoteEditorFontScaleChange}
				noteCardMaxHeightPx={noteCardMaxHeightPref}
				onNoteCardMaxHeightPxChange={handleNoteCardMaxHeightChange}
				onNoteCardMaxHeightPxCommit={commitNoteCardMaxHeightChange}
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
				firedReminders={firedReminders}
				pendingReminderCount={pendingReminderNotificationCount}
				onClearReminders={() => {
					setFiredReminders([]);
					setPendingReminderNotificationCount(0);
					void acknowledgeReminderNotifications().catch(() => undefined);
				}}
				onOpenReminder={(reminder) => {
					setIsShareNotificationsOpen(false);
					void (async () => {
						if (reminder.workspaceId && reminder.workspaceId !== authWorkspaceId) {
							await activateWorkspaceFromSidebar(reminder.workspaceId, { activeSharedFolder: null });
						}
						if (reminder.noteId) {
							openNoteEditor(reminder.noteId, { replaceTop: true });
						}
					})();
				}}
				hasAppUpdateNotification={hasAppUpdateNotification}
				hasAppUpdatedNotification={hasAppUpdatedNotification}
				onApplyAppUpdate={() => void applyPwaUpdate()}
				onDismissAppUpdate={() => {
					setPwaUpdateDismissed(true);
					deferPwaUpdate();
				}}
				onDismissAppUpdated={() => acknowledgePwaUpdated()}
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
