import React from 'react';
import * as ReactDOM from 'react-dom';
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
	faListCheck,
	faMagnifyingGlass,
	faPenNib,
	faShareNodes,
	faTag,
	faTrash,
	faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { ChecklistEditor } from './components/Editors/ChecklistEditor';
import { NoteEditor } from './components/Editors/NoteEditor';
const DrawingEditor = React.lazy(async () => {
	const module = await import('./components/Editors/DrawingEditor');
	return { default: module.DrawingEditor };
});

class DrawingEditorErrorBoundary extends React.Component<
	{ children: React.ReactNode; fallback: React.ReactNode },
	{ hasError: boolean }
> {
	constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
		super(props);
		this.state = { hasError: false };
	}
	static getDerivedStateFromError(): { hasError: boolean } {
		return { hasError: true };
	}
	override render(): React.ReactNode {
		if (this.state.hasError) return this.props.fallback;
		return this.props.children;
	}
}
import { UserManagementModal } from './components/Admin/UserManagementModal';
import { UserRegistrationInviteModal } from './components/Admin/UserRegistrationInviteModal';
import { PreferencesModal } from './components/Preferences/PreferencesModal';
import { AppearanceModal } from './components/Preferences/AppearanceModal';
import { UserModal } from './components/Preferences/UserModal';
import { type CropAreaPixels, getAvatarUploadBlob } from './core/avatarProfileImage';
import { SendInviteModal } from './components/Invites/SendInviteModal';
import { CollaboratorModal } from './components/Share/CollaboratorModal';
import { ShareNotificationsModal } from './components/Share/ShareNotificationsModal';
import { NoteDrawingBrowserModal } from './components/NoteAttachments/NoteDrawingBrowserModal';
import { NoteLinkBrowserModal } from './components/NoteAttachments/NoteLinkBrowserModal';
import { NoteImageUploadModal } from './components/NoteMedia/NoteImageUploadModal';
import { NoteMediaBrowserModal } from './components/NoteMedia/NoteMediaBrowserModal';
import { WorkspaceImagesGallery } from './components/NoteMedia/WorkspaceImagesGallery';
import { MoveNoteModal } from './components/Workspaces/MoveNoteModal';
import { CollectionManagementModal } from './components/Workspaces/CollectionManagementModal';
import { NoteCollectionModal } from './components/Workspaces/NoteCollectionModal';
import { NoteLabelsModal } from './components/Workspaces/NoteLabelsModal';
import { QuickReminderModal } from './components/Workspaces/QuickReminderModal';
import { ReminderModal } from './components/Workspaces/ReminderModal';
import { WorkspaceSwitcherModal } from './components/Workspaces/WorkspaceSwitcherModal';
import { TextEditor } from './components/Editors/TextEditor';
import { NoteGrid, type NoteGridCollaboratorFilter } from './components/NoteGrid/NoteGrid';
import { captureTopVisibleListScrollAnchor, type ListScrollAnchor } from './components/NoteGrid/listScrollAnchor';
import type { NoteAttachmentBrowserKind } from './components/NoteAttachments/NoteAttachmentCountChip';
import { type ChecklistItem } from './core/bindings';
import {
	clampFontScale,
	clampNoteCardMaxHeightPx,
	getDefaultNoteCardBannerTitlePosition,
	getDefaultNoteCardFontScale,
	getDefaultNoteCardMaxHeightPx,
	getDefaultNoteEditorFontScale,
	isLocalAppearancePreferenceNewer,
	normalizeEditorToolbarMode,
	normalizeNoteCardBannerTitlePosition,
	readCachedDeviceAppearancePreferences,
	type EditorToolbarMode,
	type NoteCardBannerTitlePosition,
	writeCachedDeviceAppearancePreferences,
} from './core/deviceAppearancePreferences';
import { useDocumentManager } from './core/DocumentManagerContext';
import { type LocaleCode, useI18n } from './core/i18n';
import { addNoteDrawingId, initChecklistNoteDoc, initDrawingNoteDoc, initTextNoteDoc, makeNoteId, readDrawingLinkState, readNoteFromDoc, removeNoteDrawingId, setNoteReminder } from './core/noteModel';
import { getNotePinPrefsSnapshot, moveUserNotePinPreference, replaceUserNotePinPrefs, resolveUserNotePinned, setUserNotePinnedOnDoc, setUserNotePinPreferenceScope } from './core/notePinPreferences';
import { seedNoteCardCompletedExpandedByNoteId } from './core/noteCardCompletedExpansion';
import { applyTheme, getStoredThemeId, getStoredThemeIdForUser, isLightTheme, persistThemeId, persistThemeIdForUser, THEMES, type ThemeId } from './core/theme';
import { activateWorkspace, fetchUserPreferences, flushUserPreferences, updateUserPreferences, type UserDevicePreferences } from './core/userDevicePreferencesApi';
import { useConnectionStatus } from './core/useConnectionStatus';
import { useBodyScrollLock } from './core/useBodyScrollLock';
import { useIsCoarsePointer } from './core/useIsCoarsePointer';
import { useIsMobileLandscape } from './core/useIsMobileLandscape';
import { getPasswordStrengthLabel, getPasswordStrengthScore } from './core/passwordStrength';
import { createCollection, deleteCollection, getCollectionsRegistryDoc, readCollectionsFromDoc, subscribeCollections, updateCollection, type CollectionRecord, type CollectionTreeNode, buildCollectionTree, buildCollectionPathMap } from './services/collectionService';
import { createLabel, deleteLabel, getLabelsRegistryDoc, readLabelsFromDoc, subscribeLabels, updateLabel, type LabelRecord } from './services/labelService';
import { assignNoteBannerFile, assignNoteLabels, assignNoteToCollection, markNoteAccessed, readNoteMetadataState } from './services/noteService';
import type { NoteGroupingMode, NoteSortMode, ReminderFilterMode, SortDirection } from './utilities/getVisibleNotes';
import {
	flushPendingCollaboratorActions,
	flushPendingNoteShareActions,
	listNoteShareInvitations,
	listSharedNotePlacements,
	moveCachedNoteShareCollaborators,
	readCachedNoteShareCollaborators,
	readPendingCollaboratorActions,
	syncAttachedDrawingCollaborators,
	syncNoteShareCollaborators,
	type NoteShareCollaboratorSnapshot,
	updateSharedNotePlacementMetadata,
	type SharedNotePlacement,
} from './core/noteShareApi';
import {
	cacheSharedNotePlacements,
	patchCachedSharedNotePlacement,
	readCachedSharedNotePlacements,
	readCachedSharedNotePlacementsForWorkspace,
} from './core/noteSharePlacementStore';
import { addNotePreviewLinkToDoc, extractNoteLinksFromDoc, getNotePreviewLinksFromDoc, removeNotePreviewLinkFromDoc } from './core/noteLinks';
import { acceptShareToken, flushPendingShareLinkRequests, getShareTokenMetadata } from './core/shareLinks';
import { listFailedNoteLinks, type FailedNoteLinkRecord } from './core/noteLinkApi';
import { searchNotes, type NoteSearchMatchKind, type NoteSearchResult } from './core/noteMediaApi';
import { emptyTrashNow, moveNoteToWorkspace } from './core/noteManagementApi';
import { getAppDebugSessionId, logClientEvent } from './core/debugLogger';
import { beginMoveDebugTrace, logMoveDebugClient } from './core/moveDebugTrace';
import { createViewTransitionTraceId, recordViewTransitionTrace } from './core/viewTransitionDebug';
import { flushPendingNoteMoves, queuePendingNoteMove, removePendingNoteMove } from './core/noteMoveQueue';
import {
	emitNoteMediaChanged,
	filterRemoteNoteImagesByPendingDeletes,
	getCachedRemoteNoteImages,
	moveLocalNoteMedia,
	refreshRemoteNoteImages,
	readQueuedNoteImageDeletions,
	readQueuedNoteImages,
	readStoredRemoteNoteImages,
	scheduleQueuedNoteImageFlush,
	warmWorkspaceImageMetadata,
} from './core/noteMediaStore';
import { emitNoteLinksChanged, flushQueuedNoteLinkSync, hasQueuedNoteLinkSync, moveLocalNoteLinks, scanAllDocumentsForPlaceholders, syncNoteLinksForDoc } from './core/noteLinkStore';
import {
	emitNoteDocumentsChanged,
	getCachedNoteDocuments,
	moveLocalNoteDocuments,
	refreshRemoteNoteDocuments,
	readQueuedNoteDocuments,
	readStoredRemoteNoteDocuments,
	scheduleQueuedNoteDocumentFlush,
} from './core/noteDocumentStore';
import { searchOfflineNotes } from './core/offlineSearch';
import { acknowledgePwaUpdated, applyPwaUpdate, deferPwaUpdate, promptInstallApp, PWA_SYNC_REQUEST_EVENT, setPwaUpdateBlocked, usePwaState } from './core/pwa';
import { onPushReceived } from './core/pushManager';
import { acknowledgeReminderNotifications, fetchFiredReminders, fetchNoteReminderStates, fetchPendingReminderCount, syncNoteReminder, type FiredReminder, type NoteReminderState } from './core/pushApi';
import {
	buildReminderLookup,
	mergeServerReminderLookup,
	readReminderLookupValue,
	updateReminderLookup,
} from './core/reminderLookup';
import {
	captureNotificationDeepLink,
	clearNotificationDeepLinkFromUrl,
	clearPendingNotificationDeepLink,
	isNotificationDeepLinkConsumed,
	markNotificationDeepLinkConsumed,
	NOTIFICATION_DEEP_LINK_STASHED_EVENT,
	parseNotificationDeepLinkMessage,
	readNotificationDeepLinkFromUrl,
	stashNotificationDeepLink,
} from './core/notificationDeepLink';
import { clearCachedReminderStates, moveCachedReminderStates, readCachedReminderStates, writeCachedReminderStates } from './core/reminderCache';
import { moveNoteOrderSnapshotEntry, readNoteOrderSnapshot, writeNoteOrderSnapshot } from './core/noteOrderSnapshot';
import { getUserNoteColorPrefsSnapshot, replaceUserNoteColorPrefs, setUserNoteColorPreferenceScope } from './core/noteColorPreferences';
import { getUserNoteBannerPrefsSnapshot, replaceUserNoteBannerPrefs, setUserNoteBannerPreferenceScope } from './core/noteBannerPreferences';
import { replaceCollapsedRichHeadingPrefs, setCollapsibleHeadingPreferenceScope } from './core/collapsibleHeadingPreferences';
import { useStartupHydration } from './core/StartupHydrationContext';
import { cancelSyncOutboxWorker, flushSyncOutbox, getWorkspaceInviteConflictEventName, getWorkspaceInviteStateEventName, scheduleSyncOutboxFlush } from './core/syncOutbox';
import { listWorkspacePendingInvites } from './core/workspaceInviteApi';
import { canEditWorkspaceContent, canManageWorkspace, getWorkspaceRoleLabelKey, normalizeWorkspaceRole, type WorkspaceRole } from './core/workspaceRoles';
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
import {
	hasWorkspaceRenderSnapshot,
	readWorkspaceRenderSnapshotScroll,
	writeWorkspaceRenderSnapshotScroll,
} from './core/workspaceRenderSnapshot';

const DOCUMENT_VIEWER_STATE_EVENT = 'freemannotes:document-viewer-state';
import { getWorkspaceDisplayName, isPersonalWorkspace } from './core/workspaceDisplay';
import { readWorkspaceListLocalCache, writeWorkspaceListLocalCache, clearWorkspaceListLocalCache } from './core/workspaceListLocalCache';
import { clearWorkspaceSelectionCache, readWorkspaceSelectionCache, writeWorkspaceSelectionCache } from './core/workspaceSelectionCache';
import { type ViewMode, loadViewMode, saveViewMode } from './core/viewMode';
import { BUBBLE_ZOOM_MAX, BUBBLE_ZOOM_MIN, loadBubbleZoom, saveBubbleZoom } from './core/bubbleZoom';
import { getWorkspaceBubbleColorSchemeOverridden, toWorkspaceBubbleColorStyle, WORKSPACE_COLOR_TOKENS } from './core/bubbleWorkspaceColors';
import { BubbleView, type BubbleWorkspaceInfo } from './components/BubbleView/BubbleView';
import { CrossWorkspaceNoteModal } from './components/BubbleView/CrossWorkspaceNoteModal';

type EditorMode = 'none' | 'text' | 'checklist';
type GlobalUserRole = 'USER' | 'ADMIN';

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

type SidebarCollaboratorEntry = NoteGridCollaboratorFilter & {
	noteCount: number;
};

const FAB_LIGHT_ICON_SRC = '/icons/FAB-light.png';
const FAB_DARK_ICON_SRC = '/icons/FAB-dark.png';
const APP_HEADER_LIGHT_ICON_SRC = '/icons/app-header-light.png';
const APP_HEADER_DARK_ICON_SRC = '/icons/app-header-dark.png';

type SendInviteContext =
	| { kind: 'workspace'; workspaceId: string | null; workspaceName: string | null }
	| { kind: 'registration' };

type ToggleableSortMode = Extract<NoteSortMode, 'date-created' | 'date-updated' | 'alphabetical'>;
type SidebarFilterReminderMode = Extract<ReminderFilterMode, 'past-due' | 'due-soon'>;
type SidebarFilterSortMode = Extract<NoteSortMode, 'least-accessed' | 'most-edited'>;

const SIDEBAR_FILTER_REMINDER_MODES: readonly SidebarFilterReminderMode[] = ['past-due', 'due-soon'];
const SIDEBAR_FILTER_SORT_MODES: readonly SidebarFilterSortMode[] = ['least-accessed', 'most-edited'];
const SIDEBAR_COLLECTION_INDENT_CAP = 3;

function isToggleableSortMode(value: string): value is ToggleableSortMode {
	return value === 'date-created' || value === 'date-updated' || value === 'alphabetical';
}

function isSidebarFilterReminderMode(value: string): value is SidebarFilterReminderMode {
	return value === 'past-due' || value === 'due-soon';
}

function isSidebarFilterSortMode(value: string): value is SidebarFilterSortMode {
	return value === 'least-accessed' || value === 'most-edited';
}

function getSortDirectionMarker(direction: SortDirection): string {
	return direction === 'asc' ? '▲' : '▼';
}

function truncateUiName(value: string, maxLength = 48): string {
	const normalized = String(value ?? '').trim();
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}...`;
}

function normalizeSidebarCollaboratorEmail(value: unknown): string {
	return String(value ?? '').trim().toLowerCase();
}

function buildSidebarCollaboratorKey(args: { userId?: string | null; email?: string | null }): string {
	const userId = typeof args.userId === 'string' ? args.userId.trim() : '';
	if (userId) return `user:${userId}`;
	return `email:${normalizeSidebarCollaboratorEmail(args.email)}`;
}

function getSidebarCollaboratorLabel(user: { id?: string | null; name?: string | null; email?: string | null } | null | undefined): string {
	return String(user?.name || user?.email || user?.id || '').trim();
}

function getSidebarCollaboratorInitial(label: string): string {
	const trimmed = String(label || '').trim();
	return trimmed ? trimmed.slice(0, 1).toUpperCase() : '?';
}

function buildWorkspaceCollaboratorEntries(snapshots: readonly (NoteShareCollaboratorSnapshot | null)[]): SidebarCollaboratorEntry[] {
	const collaboratorsByKey = new Map<string, SidebarCollaboratorEntry>();
	for (const snapshot of snapshots) {
		if (!snapshot) continue;
		const seenInSnapshot = new Set<string>();
		const upsert = (candidate: { id?: string | null; name?: string | null; email?: string | null; profileImage?: string | null } | null | undefined): void => {
			const label = getSidebarCollaboratorLabel(candidate);
			const email = String(candidate?.email || '').trim();
			const userId = typeof candidate?.id === 'string' ? candidate.id : null;
			if (!label && !email) return;
			const key = buildSidebarCollaboratorKey({ userId, email });
			if (seenInSnapshot.has(key)) return;
			seenInSnapshot.add(key);
			const existing = collaboratorsByKey.get(key);
			if (existing) {
				existing.noteCount += 1;
				if (!existing.avatar && candidate?.profileImage) existing.avatar = candidate.profileImage;
				if ((!existing.label || existing.label === existing.email) && label) existing.label = label;
				if (!existing.email && email) existing.email = email;
				return;
			}
			collaboratorsByKey.set(key, {
				key,
				userId,
				label: label || email,
				email,
				avatar: candidate?.profileImage ?? null,
				noteCount: 1,
			});
		};

		upsert(snapshot.sharedBy);
		for (const collaborator of snapshot.collaborators ?? []) {
			upsert({
				id: collaborator.userId,
				name: collaborator.user?.name,
				email: collaborator.user?.email,
				profileImage: collaborator.user?.profileImage,
			});
		}
	}
	return Array.from(collaboratorsByKey.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function getCompressedSidebarCollectionPrefix(path: string, depth: number): string | null {
	if (depth <= SIDEBAR_COLLECTION_INDENT_CAP) return null;
	const segments = String(path ?? '')
		.split(' / ')
		.map((segment) => segment.trim())
		.filter(Boolean);
	const ancestorSegments = segments.slice(0, -1);
	if (ancestorSegments.length === 0) return null;
	return `${ancestorSegments[ancestorSegments.length - 1]} / `;
}

function scrollExpandedCollectionNodeIntoView(toggleButton: HTMLButtonElement): void {
	if (typeof window === 'undefined') return;
	const collectionNode = toggleButton.closest('.sidebar-collection-node');
	const scrollContainer = toggleButton.closest('.sidebar-collections-menu');
	const nestedShell = collectionNode?.querySelector(':scope > .sidebar-nested-submenu-shell');
	if (!(collectionNode instanceof HTMLElement) || !(scrollContainer instanceof HTMLElement)) return;

	const alignExpandedNode = (): void => {
		const nodeRect = collectionNode.getBoundingClientRect();
		const containerRect = scrollContainer.getBoundingClientRect();
		if (nodeRect.bottom > containerRect.bottom) {
			scrollContainer.scrollTop += nodeRect.bottom - containerRect.bottom + 10;
		}
		if (nodeRect.top < containerRect.top) {
			scrollContainer.scrollTop -= containerRect.top - nodeRect.top + 10;
		}
	};

	let rafId = 0;
	const deadline = window.performance.now() + 360;

	const tick = (): void => {
		alignExpandedNode();
		if (window.performance.now() < deadline) {
			rafId = window.requestAnimationFrame(tick);
		}
	};

	const handleTransitionEnd = (): void => {
		alignExpandedNode();
		if (rafId) window.cancelAnimationFrame(rafId);
		if (nestedShell instanceof HTMLElement) nestedShell.removeEventListener('transitionend', handleTransitionEnd);
	};

	if (nestedShell instanceof HTMLElement) {
		nestedShell.addEventListener('transitionend', handleTransitionEnd);
	}

	rafId = window.requestAnimationFrame(tick);
}

function OverflowMarqueeText(props: {
	value: string;
	title?: string;
	titleClassName?: string;
	viewportClassName: string;
	trackClassName: string;
}): React.JSX.Element {
	const viewportRef = React.useRef<HTMLSpanElement | null>(null);
	const trackRef = React.useRef<HTMLSpanElement | null>(null);
	const [marqueeState, setMarqueeState] = React.useState<{ distancePx: number; durationSec: number } | null>(null);
	const [isVisible, setIsVisible] = React.useState(false);

	React.useLayoutEffect(() => {
		if (typeof window === 'undefined') return;
		const viewport = viewportRef.current;
		const track = trackRef.current;
		if (!viewport || !track) return;

		const evaluateVisibility = (): boolean => {
			const rect = viewport.getBoundingClientRect();
			if (rect.width <= 1 || rect.height <= 1) return false;
			if (viewport.closest('[aria-hidden="true"]')) return false;
			const computedStyle = window.getComputedStyle(viewport);
			if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') return false;
			return true;
		};

		const measure = (): void => {
			setIsVisible(evaluateVisibility());
			const viewportWidth = Math.round(viewport.clientWidth);
			const trackWidth = Math.round(track.scrollWidth);
			const overflowPx = Math.max(0, trackWidth - viewportWidth);
			if (overflowPx <= 4) {
				setMarqueeState((previous) => (previous === null ? previous : null));
				return;
			}
			const durationSec = Math.max(3.8, Math.min(14, overflowPx / 32 + 4.6));
			setMarqueeState((previous) => {
				if (previous && previous.distancePx === overflowPx && previous.durationSec === durationSec) return previous;
				return { distancePx: overflowPx, durationSec };
			});
		};

		measure();
		const rafId = window.requestAnimationFrame(measure);
		const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
		observer?.observe(viewport);
		observer?.observe(track);
		const intersectionObserver = typeof IntersectionObserver !== 'undefined'
			? new IntersectionObserver((entries) => {
				const nextEntry = entries[0];
				setIsVisible(Boolean(nextEntry?.isIntersecting) && evaluateVisibility());
			}, { threshold: 0.2 })
			: null;
		intersectionObserver?.observe(viewport);
		window.addEventListener('resize', measure);
		window.addEventListener('orientationchange', measure);
		return () => {
			window.cancelAnimationFrame(rafId);
			observer?.disconnect();
			intersectionObserver?.disconnect();
			window.removeEventListener('resize', measure);
			window.removeEventListener('orientationchange', measure);
		};
	}, [props.value, props.title]);

	const shouldAnimate = marqueeState !== null && isVisible;

	return (
		<>
			{props.title ? <span className={props.titleClassName}>{props.title}</span> : null}
			<span
				ref={viewportRef}
				className={`${props.viewportClassName}${shouldAnimate ? ' is-overflowing' : ''}`}
			>
				<span
					ref={trackRef}
					className={`${props.trackClassName}${shouldAnimate ? ' is-overflowing' : ''}`}
					style={marqueeState
						? {
							['--chip-marquee-distance' as any]: `${marqueeState.distancePx}px`,
							['--chip-marquee-duration' as any]: `${marqueeState.durationSec}s`,
						}
						: undefined}
				>
					{props.value}
				</span>
			</span>
		</>
	);
}

function ScrollingScopeChipLabel(props: { title?: string; value: string }): React.JSX.Element {
	return (
		<OverflowMarqueeText
			value={props.value}
			title={props.title}
			titleClassName="note-grid-scope-label-static"
			viewportClassName="note-grid-scope-label-viewport"
			trackClassName="note-grid-scope-label"
		/>
	);
}

function isCoarsePointerDevice(): boolean {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
	return window.matchMedia('(pointer: coarse)').matches;
}

function suppressNextDocumentCompatibilityMouseEvents(): void {
	if (typeof window === 'undefined') return;
	let timeoutId = 0;
	const handler = (event: MouseEvent): void => {
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
	};
	const cleanup = (): void => {
		window.removeEventListener('mousedown', handler, true);
		window.removeEventListener('mouseup', handler, true);
		window.removeEventListener('click', handler, true);
		if (timeoutId) window.clearTimeout(timeoutId);
	};
	window.addEventListener('mousedown', handler, true);
	window.addEventListener('mouseup', handler, true);
	window.addEventListener('click', handler, true);
	timeoutId = window.setTimeout(() => cleanup(), 500);
}

function closeBackdropFromPointerEvent(
	event: React.PointerEvent<HTMLButtonElement>,
	onClose: () => void
): void {
	if (event.pointerType !== 'touch' && !isCoarsePointerDevice()) return;
	if (event.cancelable) event.preventDefault();
	event.stopPropagation();
	suppressNextDocumentCompatibilityMouseEvents();
	onClose();
}

function clampMobileSidebarProgress(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(1, value));
}

function getMobileSidebarWidth(drawer: HTMLElement): number {
	const rect = drawer.getBoundingClientRect();
	if (rect.width > 0) return rect.width;
	if (typeof window !== 'undefined') return Math.min(window.innerWidth * 0.86, 320);
	return 320;
}

type NoteMetadataSnapshot = {
	collectionId: string | null;
	labelIds: string[];
	reminderAt: string | null;
	isPinned: boolean;
	lastAccessedAt: string;
};

const EMPTY_NOTE_METADATA_STATE: NoteMetadataSnapshot = { collectionId: null, labelIds: [], reminderAt: null, isPinned: false, lastAccessedAt: '' };

function metadataSnapshotsEqual(
	left: NoteMetadataSnapshot,
	right: NoteMetadataSnapshot
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

function useNoteMetadataSnapshot(doc: Y.Doc | null): NoteMetadataSnapshot {
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

function useEffectiveNoteMetadataSnapshot(doc: Y.Doc | null, sharedPlacement: SharedNotePlacement | null): NoteMetadataSnapshot {
	const baseSnapshot = useNoteMetadataSnapshot(doc);
	const placementLabelIdsKey = React.useMemo(
		() => sharedPlacement ? sharedPlacement.labelIds.join('\u0000') : '',
		[sharedPlacement]
	);
	return React.useMemo(() => {
		if (!sharedPlacement) return baseSnapshot;
		return {
			...baseSnapshot,
			collectionId: sharedPlacement.collectionId,
			labelIds: [...sharedPlacement.labelIds],
		};
	}, [baseSnapshot, placementLabelIdsKey, sharedPlacement]);
}

type MetadataNoteModalState = {
	noteId: string;
	docId?: string;
	doc?: Y.Doc | null;
	title: string;
};

type LabelManagementModalState = {
	title: string;
};

type ReminderNoteModalState = {
	noteId: string;
	docId: string;
	title: string;
};

type PendingReminderSync = {
	docId: string;
	noteId: string;
	workspaceId: string;
	reminderAt: string | null;
	noteTitle?: string;
	updatedAt: string;
};

type SidebarView = 'notes' | 'images' | 'archive' | 'trash';

type OverlaySnapshot = {
	sidebarView: SidebarView;
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
	/** Cross-workspace note viewer opened from bubble view. */
	crossWorkspaceNote: { noteId: string; workspaceId: string; workspaceName: string } | null;
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
				ownerName: typeof workspace.ownerName === 'string' ? workspace.ownerName : null,
				ownerEmail: typeof workspace.ownerEmail === 'string' ? workspace.ownerEmail : null,
				ownerProfileImage: typeof workspace.ownerProfileImage === 'string' ? workspace.ownerProfileImage : null,
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
	sidebarView: 'notes',
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
	crossWorkspaceNote: null,
	isMobileSidebarOpen: false,
	isFabOpen: false,
};

function stripRestoredOverlayToCurrentView(snapshot: OverlaySnapshot): OverlaySnapshot {
	// A hard refresh should reopen the underlying workspace view, not whichever
	// transient modal/editor happened to be open when the page was reloaded.
	return {
		...EMPTY_OVERLAY_SNAPSHOT,
		sidebarView: snapshot.sidebarView,
	};
}

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

const SS_OVERLAY_KEY = '__freemannotes_overlay_snapshot';

/**
 * Restore overlay snapshot on page init.
 * Android kills the webview while the camera Activity is open; on return the
 * browser does a full page reload.  The history stack is intact, so we try
 * history.state first.  If the current entry is a media-dock or image-viewer
 * entry (pushed on top of the overlay), fall back to sessionStorage.
 */
const _restoredOverlay: OverlaySnapshot | null = (() => {
	try {
		const s = window.history.state;
		if (isOverlayHistoryState(s)) {
			return stripRestoredOverlayToCurrentView(s.snapshot);
		}
		// history.state may be a media-dock or image-viewer entry pushed on top.
		// Fall back to the sessionStorage snapshot.
		const raw = sessionStorage.getItem(SS_OVERLAY_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as OverlaySnapshot;
			if (hasOverlaySnapshotContent(parsed)) {
				return stripRestoredOverlayToCurrentView(parsed);
			}
		}
	} catch { /* */ }
	return null;
})();

if (typeof window !== 'undefined') {
	try {
		const bootstrapDeepLink = readNotificationDeepLinkFromUrl();
		if (bootstrapDeepLink) {
			stashNotificationDeepLink(bootstrapDeepLink);
			clearNotificationDeepLinkFromUrl();
		}
	} catch {
		// ignore
	}
}

function isMoreMenuHistoryState(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	return (value as { __moreMenu?: boolean }).__moreMenu === true;
}

function isNoteImageUploadHistoryState(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	return typeof (value as { __noteImageUpload?: unknown }).__noteImageUpload === 'string';
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
	return snapshot.sidebarView !== 'notes'
		|| snapshot.editorMode !== 'none'
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
		|| snapshot.crossWorkspaceNote !== null
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
	const isManifestStandalone = Boolean(
		window.matchMedia?.('(display-mode: standalone)')?.matches ||
		window.matchMedia?.('(display-mode: fullscreen)')?.matches ||
		window.matchMedia?.('(display-mode: minimal-ui)')?.matches ||
		document.referrer.startsWith('android-app://')
	);
	return (
		isManifestStandalone ||
		// iOS Safari
		Boolean((window.navigator as unknown as { standalone?: boolean }).standalone)
	);
}

function shouldUseMobileOverlayHistory(isMobileViewport: boolean): boolean {
	if (isMobileViewport) return true;
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(pointer: coarse)').matches;
}

function detectIosStandaloneDisplayMode(): boolean {
	if (typeof window === 'undefined') return false;
	return detectIosSafariBrowser() && detectStandaloneDisplayMode();
}

function detectIosSafariBrowser(): boolean {
	if (typeof window === 'undefined') return false;
	const navigatorValue = window.navigator;
	const ua = navigatorValue.userAgent || '';
	const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigatorValue.platform === 'MacIntel' && navigatorValue.maxTouchPoints > 1);
	const isWebkit = /WebKit/i.test(ua);
	const isCriOS = /CriOS/i.test(ua);
	const isFxiOS = /FxiOS/i.test(ua);
	const isEdgiOS = /EdgiOS/i.test(ua);
	return isIOS && isWebkit && !isCriOS && !isFxiOS && !isEdgiOS;
}

function detectAndroidStandaloneDisplayMode(): boolean {
	if (typeof window === 'undefined') return false;
	const ua = window.navigator.userAgent || '';
	if (!/Android/i.test(ua)) return false;
	return Boolean(
		window.matchMedia?.('(display-mode: standalone)')?.matches ||
		window.matchMedia?.('(display-mode: fullscreen)')?.matches ||
		window.matchMedia?.('(display-mode: minimal-ui)')?.matches ||
		document.referrer.startsWith('android-app://')
	);
}

function normalizeGlobalUserRole(value: unknown): GlobalUserRole {
	return String(value || '').trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER';
}

function readRegistrationInviteFromUrl(): { token: string | null; email: string | null } {
	if (typeof window === 'undefined') return { token: null, email: null };
	const url = new URL(window.location.href);
	const token = String(url.searchParams.get('registerInvite') || '').trim();
	const email = String(url.searchParams.get('inviteEmail') || '').trim();
	return {
		token: token || null,
		email: email || null,
	};
}

type AuthCacheV1 = {
	v: 1;
	userId: string;
	workspaceId: string | null;
	profileImage: string | null;
	role?: GlobalUserRole | null;
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
		const role = typeof parsed.role === 'string' ? normalizeGlobalUserRole(parsed.role) : null;
		if (!userId) return null;
		return { v: 1, userId, workspaceId, profileImage, role };
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
	const startupHydration = useStartupHydration();
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
	// Offline-first: if a cached auth session exists, start as 'authed' immediately
	// regardless of network state. This lets the UI render IndexedDB data on the very
	// first frame instead of showing a blank splash while probeSession completes.
	// probeSession still runs in the background and will transition to 'unauth' if
	// the server responds with an explicit 401/403 (expired session).
	const canRestoreCachedAuthImmediately = Boolean(cachedAuth);
	const initialWorkspaceRenderSnapshotAvailable = hasWorkspaceRenderSnapshot(
		startupHydration.workspaceId ?? cachedWorkspaceSelection?.workspaceId ?? cachedAuth?.workspaceId ?? null
	);
	const hasWarmStartupCache = startupHydration.hasWarmCache || initialWorkspaceRenderSnapshotAvailable;
	const canSkipStartupSplash = canRestoreCachedAuthImmediately && hasWarmStartupCache;
	type SplashDismissMode = 'viewport' | 'full';
	const [authStatus, setAuthStatus] = React.useState<'loading' | 'authed' | 'unauth'>(() =>
		canRestoreCachedAuthImmediately ? 'authed' : 'loading'
	);
	// Splash overlay is startup-only. Cold starts keep it mounted until NoteGrid
	// reports the viewport-stable first paint. Warm cached launches skip it so the
	// OS splash hands directly to the cached workspace render.
	// gridReady → starts fade-out; splashGone → removes the DOM node entirely.
	const [gridReady, setGridReady] = React.useState(canSkipStartupSplash);
	const [splashGone, setSplashGone] = React.useState(canSkipStartupSplash);
	const [splashDismissMode, setSplashDismissMode] = React.useState<SplashDismissMode>('viewport');
	const splashTimerRef = React.useRef<number>(0);
	const prevAuthStatusRef = React.useRef(authStatus);
	React.useEffect(() => {
		return () => {
			clearTimeout(splashTimerRef.current);
		};
	}, []);
	const initialRegistrationInviteRef = React.useRef(readRegistrationInviteFromUrl());
	const initialRegistrationInvite = initialRegistrationInviteRef.current;
	const [authMode, setAuthMode] = React.useState<'login' | 'register'>(initialRegistrationInvite.token ? 'register' : 'login');
	const [authEmail, setAuthEmail] = React.useState(initialRegistrationInvite.email ?? '');
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
	const [authUserRole, setAuthUserRole] = React.useState<GlobalUserRole | null>(() => cachedAuth?.role ?? null);
	const [authProfileImage, setAuthProfileImage] = React.useState<string | null>(() => cachedAuth?.profileImage ?? null);
	const [registrationInviteToken, setRegistrationInviteToken] = React.useState<string | null>(initialRegistrationInvite.token);
	const [registrationInviteEmail, setRegistrationInviteEmail] = React.useState<string>(initialRegistrationInvite.email ?? '');
	const [authWorkspaceId, setAuthWorkspaceId] = React.useState<string | null>(() => {
		if (cachedAuth && cachedWorkspaceSelection?.userId === cachedAuth.userId) {
			return cachedWorkspaceSelection.workspaceId;
		}
		return cachedAuth?.workspaceId ?? null;
	});
	// Detect unauth -> authed transition (user just logged in from scratch).
	// Run this after authWorkspaceId is initialized so the dependency list does not
	// touch the workspace state while it is still in the temporal dead zone.
	React.useEffect(() => {
		const restoredWorkspaceId = authWorkspaceId ?? cachedWorkspaceSelection?.workspaceId ?? cachedAuth?.workspaceId ?? null;
		if (prevAuthStatusRef.current === 'unauth' && authStatus === 'authed') {
			clearTimeout(splashTimerRef.current);
			setSplashDismissMode('viewport');
			setGridReady(false);
			setSplashGone(false);
		}
		prevAuthStatusRef.current = authStatus;
	}, [authStatus, authWorkspaceId, cachedWorkspaceSelection, cachedAuth]);
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
		}, 2600);
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
	// When the user is not yet authenticated and no cached auth exists, show a
	// minimal blank shell while the auth check completes (typically <200 ms).
	// No spinner or icon — the grid skeleton makes the startup feel instant.

	// Stable workspace key for NoteGrid:
	// Retains the last non-null workspace ID so transient auth churn (e.g. network
	// handoffs) doesn't unmount/remount the grid and lose in-memory measurement
	// caches, scroll position, and any in-progress drag state.
	const stableWorkspaceKeyRef = React.useRef<string>('no-workspace');
	if (authWorkspaceId) stableWorkspaceKeyRef.current = authWorkspaceId;
	// Workspace switches should rearm the splash, but use the fast viewport-ready
	// dismissal path so cached workspaces do not wait on the multi-second fallback.
	const prevAuthWorkspaceIdForSplashRef = React.useRef<string | null>(authWorkspaceId);
	React.useEffect(() => {
		const prev = prevAuthWorkspaceIdForSplashRef.current;
		prevAuthWorkspaceIdForSplashRef.current = authWorkspaceId;
		if (prev !== null && authWorkspaceId !== null && prev !== authWorkspaceId) {
			const hasWarmWorkspaceSnapshot = hasWorkspaceRenderSnapshot(authWorkspaceId);
			clearTimeout(splashTimerRef.current);
			setSplashDismissMode('viewport');
			if (hasWarmWorkspaceSnapshot) {
				setGridReady(true);
				setSplashGone(true);
			} else {
				setGridReady(false);
				setSplashGone(false);
			}
			void logClientEvent('VIEW_SWITCH', { kind: 'workspace', from: prev, to: authWorkspaceId });
		}
	}, [authWorkspaceId]);
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
	const [isMobileSidebarOpen, setIsMobileSidebarOpen] = React.useState(_restoredOverlay?.isMobileSidebarOpen ?? false);
	const isMobileSidebarOpenRef = React.useRef(isMobileSidebarOpen);
	isMobileSidebarOpenRef.current = isMobileSidebarOpen;
	const [mobileSidebarProgress, setMobileSidebarProgress] = React.useState(_restoredOverlay?.isMobileSidebarOpen ? 1 : 0);
	const [isMobileSidebarDragging, setIsMobileSidebarDragging] = React.useState(false);
	const [isMobileViewport, setIsMobileViewport] = React.useState(() => {
		if (typeof window === 'undefined') return false;
		return window.matchMedia('(pointer: coarse)').matches;
	});
	const [mobileSearchViewportOffsetTop, setMobileSearchViewportOffsetTop] = React.useState(0);
	const headerRef = React.useRef<HTMLElement | null>(null);
	const sidebarToggleButtonRef = React.useRef<HTMLButtonElement | null>(null);
	const mobileSearchInputRef = React.useRef<HTMLInputElement | null>(null);
	const viewModeToggleButtonRef = React.useRef<HTMLButtonElement | null>(null);
	const viewModePickerRef = React.useRef<HTMLDivElement | null>(null);
	const topControlsRef = React.useRef<HTMLDivElement | null>(null);
	const mobileSidebarRef = React.useRef<HTMLElement | null>(null);
	const workspaceMenuRef = React.useRef<HTMLDivElement | null>(null);
	const sidebarEntryButtonRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
	const [sidebarGroupsOpen, setSidebarGroupsOpen] = React.useState<Record<string, boolean>>(CLOSED_SIDEBAR_GROUPS);
	// Which sidebar view is active: regular notes, workspace images, archive, or trash.
	const [sidebarView, setSidebarView] = React.useState<SidebarView>(_restoredOverlay?.sidebarView ?? 'notes');
	// UI mode for the "new note" panel.
	const [editorMode, setEditorMode] = React.useState<EditorMode>(_restoredOverlay?.editorMode ?? 'none');
	const editorModeRef = React.useRef(editorMode);
	editorModeRef.current = editorMode;
	// Phase 10 preferences shell entry point opened from top-right avatar.
	const [isPreferencesOpen, setIsPreferencesOpen] = React.useState(_restoredOverlay?.isPreferencesOpen ?? false);
	const [isAppearanceOpen, setIsAppearanceOpen] = React.useState(_restoredOverlay?.isAppearanceOpen ?? false);
	const [isUserOpen, setIsUserOpen] = React.useState(_restoredOverlay?.isUserOpen ?? false);
	const [isUserManagementOpen, setIsUserManagementOpen] = React.useState(_restoredOverlay?.isUserManagementOpen ?? false);
	const [userModalBusy, setUserModalBusy] = React.useState(false);
	const [userModalError, setUserModalError] = React.useState<string | null>(null);
	const [isSendInviteOpen, setIsSendInviteOpen] = React.useState(_restoredOverlay?.isSendInviteOpen ?? false);
	const [sendInviteContext, setSendInviteContext] = React.useState<SendInviteContext | null>(null);
	const [isShareNotificationsOpen, setIsShareNotificationsOpen] = React.useState(false);
	const [isWorkspaceSwitcherOpen, setIsWorkspaceSwitcherOpen] = React.useState(_restoredOverlay?.isWorkspaceSwitcherOpen ?? false);
	const [activeWorkspaceName, setActiveWorkspaceName] = React.useState<string | null>(null);
	const [activeWorkspaceSystemKind, setActiveWorkspaceSystemKind] = React.useState<string | null>(null);
	// Seed from localStorage so the sidebar workspace list is populated on the
	// very first render, before the async IDB snapshot resolves. The IDB/network
	// fetch will overwrite this with authoritative data shortly after mount.
	const [sidebarWorkspaces, setSidebarWorkspaces] = React.useState<readonly SidebarWorkspaceListItem[]>(
		() => startupHydration.workspaceList.length > 0 ? startupHydration.workspaceList : readWorkspaceListLocalCache(cachedAuth?.userId ?? ''),
	);
	const [sidebarWorkspacesBusy, setSidebarWorkspacesBusy] = React.useState(false);
	const [sidebarWorkspacesError, setSidebarWorkspacesError] = React.useState<string | null>(null);
	// sharedPlacements holds ALL placements (active workspace + every other SHARED_WITH_ME
	// workspace) so that bubble-click lookups and setExternalRoomAliases work across any
	// workspace. visibleSharedPlacements (below) limits what the NoteGrid receives.
	const [sharedPlacements, setSharedPlacements] = React.useState<readonly SharedNotePlacement[]>([]);
	// activeWorkspaceSharedPlacements holds ONLY the placements for the currently active
	// workspace. Used by visibleSharedPlacements so personal-workspace shared notes appear.
	const [activeWorkspaceSharedPlacements, setActiveWorkspaceSharedPlacements] = React.useState<readonly SharedNotePlacement[]>([]);
	const sharedPlacementsRef = React.useRef<readonly SharedNotePlacement[]>(sharedPlacements);
	sharedPlacementsRef.current = sharedPlacements;
	const activeWorkspaceSharedPlacementsRef = React.useRef<readonly SharedNotePlacement[]>(activeWorkspaceSharedPlacements);
	activeWorkspaceSharedPlacementsRef.current = activeWorkspaceSharedPlacements;
	const [manualRoomAliases, setManualRoomAliases] = React.useState<Record<string, string>>({});
	const manualRoomAliasesRef = React.useRef<Record<string, string>>(manualRoomAliases);
	manualRoomAliasesRef.current = manualRoomAliases;
	const mergeExternalRoomAliases = React.useCallback((placements: readonly SharedNotePlacement[]): Record<string, string> => ({
		...Object.fromEntries(placements.map((placement) => [placement.aliasId, placement.roomId] as const)),
		...manualRoomAliases,
	}), [manualRoomAliases]);
	const ensureManualRoomAlias = React.useCallback((aliasId: string, roomId: string): void => {
		const normalizedAliasId = String(aliasId || '').trim();
		const normalizedRoomId = String(roomId || '').trim();
		if (!normalizedAliasId || !normalizedRoomId) return;
		const current = manualRoomAliasesRef.current;
		if (current[normalizedAliasId] === normalizedRoomId) return;
		const nextAliases = { ...current, [normalizedAliasId]: normalizedRoomId };
		manualRoomAliasesRef.current = nextAliases;
		setManualRoomAliases(nextAliases);
		manager.setExternalRoomAliases({
			...Object.fromEntries(sharedPlacementsRef.current.map((placement) => [placement.aliasId, placement.roomId] as const)),
			...nextAliases,
		});
	}, [manager]);
	const removeManualRoomAlias = React.useCallback((aliasId: string): void => {
		const normalizedAliasId = String(aliasId || '').trim();
		if (!normalizedAliasId) return;
		const current = manualRoomAliasesRef.current;
		if (!(normalizedAliasId in current)) return;
		const nextAliases = Object.fromEntries(Object.entries(current).filter(([key]) => key !== normalizedAliasId));
		manualRoomAliasesRef.current = nextAliases;
		setManualRoomAliases(nextAliases);
		manager.setExternalRoomAliases({
			...Object.fromEntries(sharedPlacementsRef.current.map((placement) => [placement.aliasId, placement.roomId] as const)),
			...nextAliases,
		});
	}, [manager]);
	React.useEffect(() => {
		const current = manualRoomAliasesRef.current;
		const sharedAliasIds = new Set(sharedPlacements.map((placement) => placement.aliasId));
		const staleSharedAliases = Object.keys(current).filter((aliasId) => aliasId.startsWith('shared-placement:') && !sharedAliasIds.has(aliasId));
		if (staleSharedAliases.length === 0) return;
		const nextAliases = Object.fromEntries(
			Object.entries(current).filter(([aliasId]) => !aliasId.startsWith('shared-placement:') || sharedAliasIds.has(aliasId))
		);
		manualRoomAliasesRef.current = nextAliases;
		setManualRoomAliases(nextAliases);
		manager.setExternalRoomAliases({
			...Object.fromEntries(sharedPlacements.map((placement) => [placement.aliasId, placement.roomId] as const)),
			...nextAliases,
		});
	}, [manager, sharedPlacements]);
	const resolveRelatedNoteRoomId = React.useCallback((parentNoteId: string, relatedNoteId: string): string => {
		const normalizedRelatedNoteId = String(relatedNoteId || '').trim();
		if (!normalizedRelatedNoteId) return '';
		if (normalizedRelatedNoteId.includes(':')) return normalizedRelatedNoteId;
		const parentRoomId = manager.resolveRoomName(parentNoteId);
		const separator = parentRoomId.indexOf(':');
		if (separator <= 0) return normalizedRelatedNoteId;
		return `${parentRoomId.slice(0, separator)}:${normalizedRelatedNoteId}`;
	}, [manager]);
	const ensureRelatedNoteAlias = React.useCallback((parentNoteId: string, relatedNoteId: string): string => {
		const normalizedRelatedNoteId = String(relatedNoteId || '').trim();
		if (!normalizedRelatedNoteId) return '';
		const relatedRoomId = resolveRelatedNoteRoomId(parentNoteId, normalizedRelatedNoteId);
		if (relatedRoomId) {
			ensureManualRoomAlias(normalizedRelatedNoteId, relatedRoomId);
		}
		return normalizedRelatedNoteId;
	}, [ensureManualRoomAlias, resolveRelatedNoteRoomId]);
	const [activeSharedFolder, setActiveSharedFolder] = React.useState<string | null>(null);
	const [pendingRestoredSharedFolder, setPendingRestoredSharedFolder] = React.useState<string | null | false>(false);
	const [pendingSharedFolderReveal, setPendingSharedFolderReveal] = React.useState<{ workspaceId: string; folderName: string | null } | null>(null);
	const [pendingShareNotificationCount, setPendingShareNotificationCount] = React.useState(0);
	const [pendingReminderNotificationCount, setPendingReminderNotificationCount] = React.useState(0);
	const [firedReminders, setFiredReminders] = React.useState<FiredReminder[]>([]);
	const [failedLinkNotifications, setFailedLinkNotifications] = React.useState<FailedNoteLinkRecord[]>([]);
	// Tracks failed-link notification IDs the user has explicitly dismissed so
	// they don't re-appear on the next refreshNoteShareState call. Stored per
	// user in localStorage as an offline/cache fallback, and mirrored to the
	// server-backed user preferences row for cross-device persistence.
	const dismissedFailedLinkIdsRef = React.useRef<Set<string>>(new Set());
	React.useEffect(() => {
		if (!authUserId || typeof window === 'undefined') {
			dismissedFailedLinkIdsRef.current = new Set();
			return;
		}
		const next = new Set<string>();
		try {
			const scopedRaw = window.localStorage.getItem(`freemannotes.dismissedFailedLinks.v2:${authUserId}`);
			if (scopedRaw) {
				const parsed = JSON.parse(scopedRaw) as unknown;
				if (Array.isArray(parsed)) {
					for (const value of parsed) {
						if (typeof value === 'string' && value) next.add(value);
					}
				}
			}
			const legacyRaw = window.localStorage.getItem('freemannotes.dismissedFailedLinks.v1');
			if (legacyRaw) {
				const parsed = JSON.parse(legacyRaw) as unknown;
				if (Array.isArray(parsed)) {
					for (const value of parsed) {
						if (typeof value === 'string' && value) next.add(value);
					}
				}
				window.localStorage.removeItem('freemannotes.dismissedFailedLinks.v1');
			}
			window.localStorage.setItem(`freemannotes.dismissedFailedLinks.v2:${authUserId}`, JSON.stringify([...next]));
		} catch {
			// Best effort only.
		}
		dismissedFailedLinkIdsRef.current = next;
	}, [authUserId]);
	const [collaborationRefreshToken, setCollaborationRefreshToken] = React.useState(0);
	const [collaboratorModalState, setCollaboratorModalState] = React.useState<CollaboratorModalState | null>(_restoredOverlay?.collaboratorModalState ?? null);
	const [noteImageModalState, setNoteImageModalState] = React.useState<NoteImageModalState | null>(() => {
		try {
			const raw = sessionStorage.getItem('__freemannotes_imageModal');
			if (raw) return JSON.parse(raw) as NoteImageModalState;
		} catch { /* */ }
		return null;
	});
	React.useEffect(() => {
		try {
			if (noteImageModalState) {
				sessionStorage.setItem('__freemannotes_imageModal', JSON.stringify(noteImageModalState));
				return;
			}
			sessionStorage.removeItem('__freemannotes_imageModal');
		} catch {
			// Best effort only.
		}
	}, [noteImageModalState]);
	const [noteAttachmentBrowserState, setNoteAttachmentBrowserState] = React.useState<NoteAttachmentBrowserState | null>(_restoredOverlay?.noteAttachmentBrowserState ?? null);
	// The currently selected note in the grid/editor area.
	const [selectedNoteId, setSelectedNoteId] = React.useState<string | null>(_restoredOverlay?.selectedNoteId ?? null);
	const selectedNoteIdRef = React.useRef(selectedNoteId);
	selectedNoteIdRef.current = selectedNoteId;
	// Loaded Y.Doc for the selected note.
	const [openDoc, setOpenDoc] = React.useState<Y.Doc | null>(null);
	const [openDocId, setOpenDocId] = React.useState<string | null>(null);
	const pendingNewNoteIdsRef = React.useRef<Set<string>>(new Set());
	const [pendingNewNotesRevision, setPendingNewNotesRevision] = React.useState(0);
	const markPendingNewNotesChanged = React.useCallback((): void => {
		setPendingNewNotesRevision((value) => value + 1);
	}, []);
	const pendingNewNoteCleanupIdsRef = React.useRef<Set<string>>(new Set());
	const pendingAttachedDrawingParentsRef = React.useRef<Map<string, string>>(new Map());
	// Tracks the note currently being created as a draft — kept hidden from the grid
	// and bubble view until finalization (saved = visible, discarded = never shown).
	const [draftNoteId, setDraftNoteId] = React.useState<string | null>(null);
	const pendingNewNoteCollectionSeedRef = React.useRef<Map<string, { collectionId: string; label: string }>>(new Map());
	const previousSelectedNoteIdRef = React.useRef<string | null>(null);
	const deviceId = startupHydration.deviceId;
	const authStatusRef = React.useRef(authStatus);
	authStatusRef.current = authStatus;
	const gridReadyRef = React.useRef(gridReady);
	gridReadyRef.current = gridReady;
	const splashGoneRef = React.useRef(splashGone);
	splashGoneRef.current = splashGone;
	const isGlobalAdmin = authUserRole === 'ADMIN';
	const isUserManagementOffline = authOfflineMode || connection.state === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false);
	const cachedDeviceAppearancePrefs = React.useMemo(
		() => {
			if (startupHydration.deviceAppearance && startupHydration.userId === authUserId) {
				return startupHydration.deviceAppearance;
			}
			return readCachedDeviceAppearancePreferences(deviceId, authUserId);
		},
		[authUserId, deviceId, startupHydration.deviceAppearance, startupHydration.userId]
	);
	const [themeId, setThemeId] = React.useState<ThemeId>(() => getStoredThemeIdForUser(cachedAuth?.userId ?? null));
	const [noteCardFontScalePref, setNoteCardFontScalePref] = React.useState(
		() => cachedDeviceAppearancePrefs?.noteCardFontScale ?? getDefaultNoteCardFontScale()
	);
	const [noteEditorFontScalePref, setNoteEditorFontScalePref] = React.useState(
		() => cachedDeviceAppearancePrefs?.noteEditorFontScale ?? getDefaultNoteEditorFontScale()
	);
	const [editorToolbarModePref, setEditorToolbarModePref] = React.useState<EditorToolbarMode>(
		() => normalizeEditorToolbarMode(cachedDeviceAppearancePrefs?.editorToolbarMode)
	);
	const [noteCardMaxHeightPref, setNoteCardMaxHeightPref] = React.useState(
		() => cachedDeviceAppearancePrefs?.noteCardMaxHeightPx ?? getDefaultNoteCardMaxHeightPx()
	);
	const [noteCardBannerTitlePositionPref, setNoteCardBannerTitlePositionPref] = React.useState<NoteCardBannerTitlePosition>(
		() => normalizeNoteCardBannerTitlePosition(cachedDeviceAppearancePrefs?.noteCardBannerTitlePosition)
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
	const [noteCardCheckboxInteractionsPref, setNoteCardCheckboxInteractionsPref] = React.useState(
		() => cachedDeviceAppearancePrefs?.noteCardCheckboxInteractions ?? cachedDeviceAppearancePrefs?.noteCardClickOpens ?? true
	);
	const [noteCardLinkInteractionsPref, setNoteCardLinkInteractionsPref] = React.useState(
		() => cachedDeviceAppearancePrefs?.noteCardLinkInteractions ?? cachedDeviceAppearancePrefs?.noteCardClickOpens ?? true
	);
	const [noteCardCompletedInteractionsPref, setNoteCardCompletedInteractionsPref] = React.useState(
		() => cachedDeviceAppearancePrefs?.noteCardCompletedInteractions ?? cachedDeviceAppearancePrefs?.noteCardClickOpens ?? true
	);
	const [prefsHydrationAttempted, setPrefsHydrationAttempted] = React.useState(false);
	// When auth bootstrap already fetched server preferences to apply theme early,
	// reuse that payload during normal preference hydration so we do not refetch and
	// accidentally make the first visible theme correction happen after notes render.
	const prefetchedAuthPreferencesRef = React.useRef<UserDevicePreferences | null>(null);
	// Per-user workspace bubble color overrides: { [workspaceId]: NoteColorToken }.
	// Loaded from /api/user/preferences on auth, saved back on each change.
	const [bubbleWorkspaceColorOverrides, setBubbleWorkspaceColorOverrides] = React.useState<Record<string, string>>({});
	// Which workspace's color picker popover is open in the sidebar legend.
	const [bubbleColorPickerWorkspaceId, setBubbleColorPickerWorkspaceId] = React.useState<string | null>(null);
	// Viewport-relative rect of the swatch button that opened the color picker.
	const [bubbleColorPickerAnchorRect, setBubbleColorPickerAnchorRect] = React.useState<DOMRect | null>(null);
	// Ref to the portal-rendered picker div, used to skip close() when clicking inside it.
	const bubbleColorPickerRef = React.useRef<HTMLDivElement | null>(null);
	// Inline owner overlay shown when clicking an owner avatar chip in the workspace sidebar.
	const [wsOwnerPopup, setWsOwnerPopup] = React.useState<{ workspaceId: string } | null>(null);
	const [wsOwnerPopupClosing, setWsOwnerPopupClosing] = React.useState(false);
	const wsOwnerPopupCloseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const closeOwnerPopup = React.useCallback(() => {
		// Keep the row mounted long enough for the close animation to play before
		// removing the inline owner overlay from the sidebar.
		if (wsOwnerPopupCloseTimer.current !== null) {
			clearTimeout(wsOwnerPopupCloseTimer.current);
			wsOwnerPopupCloseTimer.current = null;
		}
		setWsOwnerPopupClosing(true);
		wsOwnerPopupCloseTimer.current = setTimeout(() => {
			setWsOwnerPopup(null);
			setWsOwnerPopupClosing(false);
			wsOwnerPopupCloseTimer.current = null;
		}, 210);
	}, []);
	React.useEffect(() => {
		return () => {
			if (wsOwnerPopupCloseTimer.current !== null) {
				clearTimeout(wsOwnerPopupCloseTimer.current);
			}
		};
	}, []);
	React.useEffect(() => {
		if (!wsOwnerPopup) return;
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (target.closest('.sidebar-workspace-owner-inline-overlay')) return;
			if (target.closest('.sidebar-workspace-owner-avatar')) return;
			closeOwnerPopup();
		};
		document.addEventListener('pointerdown', handlePointerDown, true);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown, true);
		};
	}, [closeOwnerPopup, wsOwnerPopup]);
	// Cross-workspace note opened from bubble view without switching active workspace.
	const [crossWorkspaceNote, setCrossWorkspaceNote] = React.useState<{ noteId: string; workspaceId: string; workspaceName: string } | null>(_restoredOverlay?.crossWorkspaceNote ?? null);
	const [searchQuery, setSearchQuery] = React.useState('');
	const deferredSearchQuery = React.useDeferredValue(searchQuery.trim());
	const [searchResults, setSearchResults] = React.useState<readonly NoteSearchResult[]>([]);
	const [searchResultsBusy, setSearchResultsBusy] = React.useState(false);
	const [searchResultsError, setSearchResultsError] = React.useState<string | null>(null);
	const [noteGridCollaboratorFilter, setNoteGridCollaboratorFilter] = React.useState<NoteGridCollaboratorFilter | null>(null);
	const [workspaceCollaborators, setWorkspaceCollaborators] = React.useState<SidebarCollaboratorEntry[]>([]);
	const [workspaceCollaboratorsBusy, setWorkspaceCollaboratorsBusy] = React.useState(false);
	const [collectionsDoc, setCollectionsDoc] = React.useState<Y.Doc | null>(null);
	const [collections, setCollections] = React.useState<CollectionRecord[]>(() => [...startupHydration.collections]);
	const [labelsDoc, setLabelsDoc] = React.useState<Y.Doc | null>(null);
	const [labels, setLabels] = React.useState<LabelRecord[]>(() => [...startupHydration.labels]);
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
	const [labelManagementModalState, setLabelManagementModalState] = React.useState<LabelManagementModalState | null>(null);
	const [noteReminderModalState, setNoteReminderModalState] = React.useState<ReminderNoteModalState | null>(null);
	const [isQuickReminderOpen, setIsQuickReminderOpen] = React.useState(false);
	const [noteReminderByDocId, setNoteReminderByDocId] = React.useState<Record<string, string | null>>(
		() => buildReminderLookup(startupHydration.reminderStates)
	);
	const [pendingReminderMutationVersion, bumpPendingReminderMutationVersion] = React.useReducer((value: number) => value + 1, 0);
	const pendingReminderStorageKey = React.useMemo(
		() => `freemannotes.pendingReminderSync.v1:${authUserId ?? ''}:${deviceId}`,
		[authUserId, deviceId]
	);
	const readPendingReminderMutations = React.useCallback((): PendingReminderSync[] => {
		if (typeof window === 'undefined') return [];
		try {
			const raw = window.localStorage.getItem(pendingReminderStorageKey);
			if (!raw) return [];
			const parsed = JSON.parse(raw) as PendingReminderSync[] | null;
			if (!Array.isArray(parsed)) return [];
			return parsed.filter((entry): entry is PendingReminderSync => Boolean(entry && typeof entry === 'object' && typeof entry.docId === 'string' && typeof entry.noteId === 'string'));
		} catch {
			return [];
		}
	}, [pendingReminderStorageKey]);
	const writePendingReminderMutations = React.useCallback((entries: readonly PendingReminderSync[]): void => {
		if (typeof window === 'undefined') return;
		try {
			if (entries.length === 0) {
				window.localStorage.removeItem(pendingReminderStorageKey);
				bumpPendingReminderMutationVersion();
				return;
			}
			window.localStorage.setItem(pendingReminderStorageKey, JSON.stringify(entries));
			bumpPendingReminderMutationVersion();
		} catch {
			// best effort
		}
	}, [pendingReminderStorageKey]);
	const queuePendingReminderMutation = React.useCallback((entry: PendingReminderSync): void => {
		const existing = readPendingReminderMutations().filter((candidate) => !(candidate.docId === entry.docId && candidate.noteId === entry.noteId));
		existing.push(entry);
		writePendingReminderMutations(existing);
	}, [readPendingReminderMutations, writePendingReminderMutations]);
	const removePendingReminderMutation = React.useCallback((docId: string, noteId: string): void => {
		const next = readPendingReminderMutations().filter((candidate) => !(candidate.docId === docId && candidate.noteId === noteId));
		writePendingReminderMutations(next);
	}, [readPendingReminderMutations, writePendingReminderMutations]);
	const updateCachedReminderState = React.useCallback((entry: {
		docId: string;
		noteId: string;
		workspaceId: string;
		reminderAt: string | null;
	}): void => {
		if (!authUserId) return;
		const current = readCachedReminderStates(authUserId);
		const next = current.filter((candidate) => !(candidate.docId === entry.docId && candidate.noteId === entry.noteId));
		if (entry.reminderAt) {
			next.push({
				docId: entry.docId,
				noteId: entry.noteId,
				workspaceId: entry.workspaceId,
				reminderAt: entry.reminderAt,
			});
		}
		writeCachedReminderStates(authUserId, next);
	}, [authUserId]);
	const applyPendingReminderMutations = React.useCallback((base: Record<string, string | null>): Record<string, string | null> => {
		let next = base;
		for (const entry of readPendingReminderMutations()) {
			next = updateReminderLookup(next, entry.docId, entry.noteId, entry.reminderAt);
		}
		return next;
	}, [readPendingReminderMutations]);
	const applyServerReminderStates = React.useCallback((
		current: Record<string, string | null>,
		reminders: readonly NoteReminderState[],
	): Record<string, string | null> => {
		return applyPendingReminderMutations(mergeServerReminderLookup(current, buildReminderLookup(reminders)));
	}, [applyPendingReminderMutations]);
	const persistNoteReminderState = React.useCallback((entry: {
		docId: string;
		noteId: string;
		workspaceId: string;
		reminderAt: string | null;
		noteTitle?: string;
	}): void => {
		const doc = manager.peekDoc(entry.noteId);
		if (doc) setNoteReminder(doc, entry.reminderAt);
		setNoteReminderByDocId((current) => updateReminderLookup(current, entry.docId, entry.noteId, entry.reminderAt));
		updateCachedReminderState({
			docId: entry.docId,
			noteId: entry.noteId,
			workspaceId: entry.workspaceId,
			reminderAt: entry.reminderAt,
		});
		if (authStatus !== 'authed') return;
		const pendingEntry: PendingReminderSync = {
			docId: entry.docId,
			noteId: entry.noteId,
			workspaceId: entry.workspaceId,
			reminderAt: entry.reminderAt,
			noteTitle: entry.noteTitle,
			updatedAt: new Date().toISOString(),
		};
		const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
		if (authOfflineMode || browserOffline) {
			queuePendingReminderMutation(pendingEntry);
			return;
		}
		queuePendingReminderMutation(pendingEntry);
		void syncNoteReminder({
			deviceId,
			docId: entry.docId,
			noteId: entry.noteId,
			workspaceId: entry.workspaceId,
			reminderAt: entry.reminderAt,
			noteTitle: entry.noteTitle,
		}).then(() => {
			removePendingReminderMutation(entry.docId, entry.noteId);
		}).catch(() => {
			void fetchNoteReminderStates()
				.then((data) => {
					writeCachedReminderStates(authUserId ?? '', data.reminders);
					setNoteReminderByDocId((current) => applyServerReminderStates(current, data.reminders));
				})
				.catch(() => undefined);
		});
	}, [applyPendingReminderMutations, applyServerReminderStates, authOfflineMode, authStatus, authUserId, deviceId, manager, queuePendingReminderMutation, removePendingReminderMutation, updateCachedReminderState]);
	const flushPendingReminderMutations = React.useCallback(async (): Promise<void> => {
		if (authStatus !== 'authed' || authOfflineMode) return;
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
		const pending = readPendingReminderMutations();
		if (pending.length === 0) return;
		const remaining: PendingReminderSync[] = [];
		for (let index = 0; index < pending.length; index += 1) {
			const entry = pending[index];
			try {
				await syncNoteReminder({
					deviceId,
					docId: entry.docId,
					noteId: entry.noteId,
					workspaceId: entry.workspaceId,
					reminderAt: entry.reminderAt,
					noteTitle: entry.noteTitle,
				});
			} catch {
				remaining.push(...pending.slice(index));
				break;
			}
		}
		writePendingReminderMutations(remaining);
		const data = await fetchNoteReminderStates().catch(() => null);
		if (data) {
			writeCachedReminderStates(authUserId ?? '', data.reminders);
			setNoteReminderByDocId((current) => applyServerReminderStates(current, data.reminders));
		}
	}, [applyPendingReminderMutations, applyServerReminderStates, authOfflineMode, authStatus, authUserId, deviceId, readPendingReminderMutations, writePendingReminderMutations]);
	const [moveNoteModalState, setMoveNoteModalState] = React.useState<MoveNoteModalState | null>(null);
	const [moveNoteBusy, setMoveNoteBusy] = React.useState(false);
	const [moveNoteError, setMoveNoteError] = React.useState<string | null>(null);
	const [emptyTrashBusy, setEmptyTrashBusy] = React.useState(false);
	const [isMobileSearchOpen, setIsMobileSearchOpen] = React.useState(_restoredOverlay?.isMobileSearchOpen ?? false);
	const [isFabOpen, setIsFabOpen] = React.useState(_restoredOverlay?.isFabOpen ?? false);
	const [viewMode, setViewMode] = React.useState<ViewMode>(() => loadViewMode());
	const [viewTransitionTraceId, setViewTransitionTraceId] = React.useState<string | null>(null);
	const [isViewModePickerOpen, setIsViewModePickerOpen] = React.useState(false);
	const [bubbleZoom, setBubbleZoom] = React.useState(() => loadBubbleZoom());
	const viewModeOptions = React.useMemo(
		() => [
			{ mode: 'card' as ViewMode, icon: faGrip, label: t('app.viewCard') },
			{ mode: 'list' as ViewMode, icon: faList, label: t('app.viewList') },
			{ mode: 'strip' as ViewMode, icon: faBarsStaggered, label: t('app.viewDetailedList') },
			{ mode: 'bubble' as ViewMode, icon: faCircleDot, label: t('app.viewBubble') },
		],
		[t]
	);
	const selectedViewModeOption = React.useMemo(() => {
		for (const option of viewModeOptions) {
			if (option.mode === viewMode) return option;
		}
		return { mode: 'card' as ViewMode, icon: faGrip, label: t('app.viewCard') };
	}, [t, viewMode, viewModeOptions]);
	const viewModeIcon = selectedViewModeOption.icon;
	const listScrollAnchorRef = React.useRef<ListScrollAnchor | null>(null);
	const [listScrollAnchor, setListScrollAnchor] = React.useState<ListScrollAnchor | null>(null);
	const clearListScrollAnchor = React.useCallback(() => {
		listScrollAnchorRef.current = null;
		setListScrollAnchor(null);
	}, []);
	const selectViewMode = React.useCallback((nextMode: ViewMode) => {
		const prevMode = viewMode;
		const isListVariantSwap = (prevMode === 'list' || prevMode === 'strip')
			&& (nextMode === 'list' || nextMode === 'strip')
			&& prevMode !== nextMode;
		const anchor = isListVariantSwap ? captureTopVisibleListScrollAnchor() : null;
		listScrollAnchorRef.current = anchor;
		setListScrollAnchor(anchor);
		setViewMode(nextMode);
		saveViewMode(nextMode);
		setIsViewModePickerOpen(false);
	}, [viewMode]);
	React.useEffect(() => {
		saveBubbleZoom(bubbleZoom);
	}, [bubbleZoom]);
	// View switches should be cache-backed and never blocked on splash.
	const prevViewModeForSplashRef = React.useRef(viewMode);
	React.useEffect(() => {
		if (prevViewModeForSplashRef.current === viewMode) return;
		const traceId = createViewTransitionTraceId('view-mode', prevViewModeForSplashRef.current, viewMode);
		setViewTransitionTraceId(traceId);
		recordViewTransitionTrace(traceId, 'APP_VIEW_MODE_SWITCH', {
			from: prevViewModeForSplashRef.current,
			to: viewMode,
			sidebarView,
			activeWorkspaceId: authWorkspaceId ?? null,
			selectedNoteId: selectedNoteId ?? null,
			gridViewMode: viewMode === 'bubble' ? 'card' : viewMode,
			bubbleZoom,
			searchQueryLength: deferredSearchQuery.trim().length,
		});
		void logClientEvent('VIEW_SWITCH', { kind: 'view-mode', from: prevViewModeForSplashRef.current, to: viewMode });
		prevViewModeForSplashRef.current = viewMode;
	}, [authWorkspaceId, bubbleZoom, deferredSearchQuery, selectedNoteId, sidebarView, viewMode]);
	const activeGridViewMode = (viewMode === 'bubble' ? 'card' : viewMode);
	const scrollPersistTimerRef = React.useRef<number>(0);
	const suppressWorkspaceScrollPersistUntilRef = React.useRef(0);
	const handleListScrollAnchorApplied = React.useCallback(() => {
		suppressWorkspaceScrollPersistUntilRef.current = Date.now() + 180;
		clearListScrollAnchor();
	}, [clearListScrollAnchor]);
	const previousWorkspaceScrollScopeRef = React.useRef<{ workspaceId: string | null; viewMode: typeof activeGridViewMode }>({
		workspaceId: authWorkspaceId,
		viewMode: activeGridViewMode,
	});
	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const persistScroll = (): void => {
			if (Date.now() < suppressWorkspaceScrollPersistUntilRef.current) return;
			const scope = previousWorkspaceScrollScopeRef.current;
			if (!scope.workspaceId) return;
			writeWorkspaceRenderSnapshotScroll(scope.workspaceId, scope.viewMode, window.scrollY || 0);
		};
		const onScroll = (): void => {
			if (scrollPersistTimerRef.current) {
				window.clearTimeout(scrollPersistTimerRef.current);
			}
			scrollPersistTimerRef.current = window.setTimeout(() => {
				scrollPersistTimerRef.current = 0;
				persistScroll();
			}, 160);
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			window.removeEventListener('scroll', onScroll);
			if (scrollPersistTimerRef.current) {
				window.clearTimeout(scrollPersistTimerRef.current);
				scrollPersistTimerRef.current = 0;
			}
			persistScroll();
		};
	}, []);
	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const previous = previousWorkspaceScrollScopeRef.current;
		if (previous.workspaceId === authWorkspaceId && previous.viewMode === activeGridViewMode) return;
		if (previous.workspaceId) {
			writeWorkspaceRenderSnapshotScroll(previous.workspaceId, previous.viewMode, window.scrollY || 0);
		}
		previousWorkspaceScrollScopeRef.current = { workspaceId: authWorkspaceId, viewMode: activeGridViewMode };
		// List ↔ detailed-list switches anchor to the top-visible note instead of
		// restoring raw scrollY (row heights differ between variants).
		if (listScrollAnchorRef.current) {
			suppressWorkspaceScrollPersistUntilRef.current = Date.now() + 400;
			return;
		}
		const restoredScrollY = authWorkspaceId ? readWorkspaceRenderSnapshotScroll(authWorkspaceId, activeGridViewMode) : null;
		suppressWorkspaceScrollPersistUntilRef.current = Date.now() + 400;
		window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => {
				window.scrollTo({ left: 0, top: restoredScrollY ?? 0, behavior: 'auto' });
				suppressWorkspaceScrollPersistUntilRef.current = Date.now() + 180;
			});
		});
	}, [activeGridViewMode, authWorkspaceId]);
	const isCoarsePointer = useIsCoarsePointer();
	const isMobileLandscape = useIsMobileLandscape();
	const maxCardHeightPx = noteCardMaxHeightPref;
	const noteGridLayoutDensityKey = React.useMemo(
		() => [
			`card-${maxCardHeightPx}`,
			`cardfs-${Math.round(noteCardFontScalePref * 100)}`,
			`editorfs-${Math.round(noteEditorFontScalePref * 100)}`,
			`check-${checklistShowCompletedPref ? 1 : 0}`,
		].join(':'),
		[checklistShowCompletedPref, maxCardHeightPx, noteCardFontScalePref, noteEditorFontScalePref]
	);
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
		if (viewMode !== 'bubble') return;
		if (sidebarView !== 'images' && sidebarView !== 'trash') return;
		setActiveSharedFolder(null);
		setSidebarView('notes');
	}, [sidebarView, viewMode]);

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
			sidebarView,
			editorMode,
			selectedNoteId,
			crossWorkspaceNote,
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
		sidebarView,
		editorMode,
		selectedNoteId,
		crossWorkspaceNote,
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
		setSidebarView(snapshot.sidebarView);
		setEditorMode(snapshot.editorMode);
		setSelectedNoteId(snapshot.selectedNoteId);
		setCrossWorkspaceNote(snapshot.crossWorkspaceNote);
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
		setMobileSidebarProgress(snapshot.isMobileSidebarOpen ? 1 : 0);
		setIsMobileSidebarDragging(false);
		setIsFabOpen(snapshot.isFabOpen);
		// Keep sessionStorage in sync so page-kill restoration stays current.
		try { sessionStorage.setItem(SS_OVERLAY_KEY, JSON.stringify(snapshot)); } catch { /* quota */ }
	}, []);

	const commitOverlaySnapshot = React.useCallback(
		(snapshot: OverlaySnapshot, mode: 'push' | 'replace') => {
			applyOverlaySnapshot(snapshot);
			// Persist to sessionStorage so the snapshot survives Android page kills
			// even when a media-dock/image-viewer entry sits on top in history.
			try { sessionStorage.setItem(SS_OVERLAY_KEY, JSON.stringify(snapshot)); } catch { /* quota */ }
			if (!shouldUseMobileOverlayHistory(isMobileViewport) || typeof window === 'undefined') return;
			try {
				const nextState: OverlayHistoryState = {
					[OVERLAY_HISTORY_KEY]: true,
					snapshot,
					kind: 'overlay',
				};
				// Replace whichever in-app history layer is currently on top. Media-dock
				// and image-viewer entries are not overlay snapshots, but callers rely on
				// replace semantics when transitioning from those layers into an editor.
				if (mode === 'replace') {
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

	const replaceActiveOverlaySnapshot = React.useCallback((snapshot: OverlaySnapshot) => {
		if (shouldUseMobileOverlayHistory(isMobileViewport) && typeof window !== 'undefined' && isOverlayHistoryState(window.history.state)) {
			commitOverlaySnapshot(snapshot, 'replace');
			return;
		}
		applyOverlaySnapshot(snapshot);
	}, [applyOverlaySnapshot, commitOverlaySnapshot, isMobileViewport]);

	const goBackIfOverlayHistory = React.useCallback((): boolean => {
		if (!shouldUseMobileOverlayHistory(isMobileViewport) || typeof window === 'undefined') return false;
		if (!isOverlayHistoryState(window.history.state)) return false;
		// Prevent queuing multiple history.back() from rapid taps; the guard
		// is cleared in the popstate handler once navigation completes.
		if (isNavigatingBackRef.current) return true;
		isNavigatingBackRef.current = true;
		window.history.back();
		return true;
	}, [isMobileViewport]);

	const openMobileSidebarHistoryView = React.useCallback((nextSidebarView: Extract<SidebarView, 'images' | 'trash' | 'archive'>) => {
		// When a special sidebar view is opened from the mobile drawer, reuse that
		// top history entry so Back returns directly to the prior notes state.
		const current = getOverlaySnapshot();
		commitOverlaySnapshot(
			{
				...current,
				sidebarView: nextSidebarView,
				isMobileSidebarOpen: false,
			},
			isMobileViewport && isMobileSidebarOpen ? 'replace' : 'push',
		);
	}, [commitOverlaySnapshot, getOverlaySnapshot, isMobileSidebarOpen, isMobileViewport]);

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
				isMobileSidebarOpen: false,
				isPreferencesOpen: true,
				isAppearanceOpen: false,
				isUserOpen: false,
				isUserManagementOpen: false,
				isSendInviteOpen: false,
				isWorkspaceSwitcherOpen: false,
				isFabOpen: false,
			},
			isMobileViewport && isMobileSidebarOpen ? 'replace' : 'push'
		);
	}, [commitOverlaySnapshot, getOverlaySnapshot, isMobileSidebarOpen, isMobileViewport]);

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
		if (!isGlobalAdmin || isUserManagementOffline) return;
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
	}, [commitOverlaySnapshot, getOverlaySnapshot, isGlobalAdmin, isUserManagementOffline]);

	const openSendInviteFromPreferences = React.useCallback(() => {
		if (!isGlobalAdmin) return;
		setSendInviteContext({ kind: 'registration' });
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
	}, [commitOverlaySnapshot, getOverlaySnapshot, isGlobalAdmin]);

	const openSendInviteForWorkspace = React.useCallback(
		(workspace: SidebarWorkspaceListItem) => {
			setSendInviteContext({ kind: 'workspace', workspaceId: workspace.id, workspaceName: getWorkspaceDisplayName(workspace, t) });
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
			[commitOverlaySnapshot, getOverlaySnapshot, isMobileSidebarOpen, isMobileViewport, t]
	);

	React.useEffect(() => {
		if (isSendInviteOpen) return;
		setSendInviteContext(null);
	}, [isSendInviteOpen]);

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

	const openCollaboratorModalForNote = React.useCallback((noteId: string, title?: string, options?: { docId?: string; canManage?: boolean }) => {
		const placement = sharedPlacements.find((item) => item.aliasId === noteId);
		const canManage = typeof options?.canManage === 'boolean'
			? options.canManage
			: placement
				? placement.role === 'EDITOR'
				: canEditActiveWorkspace;
		if (!canManage) return;
		const docId = options?.docId ?? (placement ? placement.roomId : authWorkspaceId ? `${authWorkspaceId}:${noteId}` : null);
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

	const handleCollaboratorAccessRemoved = React.useCallback(() => {
		closeCollaboratorModal();
		showBriefDialog(t('share.accessRemovedToast'));
	}, [closeCollaboratorModal, showBriefDialog, t]);

	const handleCollaboratorSelfRemoved = React.useCallback(() => {
		closeCollaboratorModal();
		showBriefDialog(t('share.leftNoteToast'));
	}, [closeCollaboratorModal, showBriefDialog, t]);

	const openNoteImageModal = React.useCallback((noteId: string, docId: string, title?: string) => {
		setNoteImageModalState({ noteId, docId, title: title || '' });
	}, []);

	const closeNoteImageModal = React.useCallback(() => {
		setNoteImageModalState(null);
	}, []);
	const openCollectionManagementModal = React.useCallback(() => {
		setIsCollectionManagementOpen(true);
	}, []);

	const openNoteCollectionModal = React.useCallback((noteId: string, title?: string, options?: { docId?: string; doc?: Y.Doc | null }) => {
		setNoteCollectionModalState({ noteId, docId: options?.docId, doc: options?.doc ?? null, title: title || '' });
	}, []);

	const openNoteLabelsModal = React.useCallback((noteId: string, title?: string, options?: { docId?: string; doc?: Y.Doc | null }) => {
		setNoteLabelsModalState({ noteId, docId: options?.docId, doc: options?.doc ?? null, title: title || '' });
	}, []);

	const openLabelManagementModal = React.useCallback(() => {
		setLabelManagementModalState({ title: '' });
	}, []);

	const openNoteReminderModal = React.useCallback((noteId: string, docId: string, title?: string) => {
		if (!docId) return;
		setNoteReminderModalState({ noteId, docId, title: title || '' });
	}, []);

	const openNoteAttachmentBrowser = React.useCallback((kind: NoteAttachmentBrowserKind, noteId: string, docId: string, title: string | undefined, canEdit: boolean) => {
		const scrollX = typeof window !== 'undefined' ? window.scrollX : 0;
		const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
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
		if (typeof window !== 'undefined') {
			// Opening the attachment browser should not change the user's place in the
			// note grid just because focus or history state changed under the overlay.
			window.requestAnimationFrame(() => {
				window.scrollTo({ left: scrollX, top: scrollY, behavior: 'auto' });
			});
		}
	}, [commitOverlaySnapshot, getOverlaySnapshot]);

	const closeNoteAttachmentBrowser = React.useCallback(() => {
		if (goBackIfOverlayHistory()) return;
		setNoteAttachmentBrowserState(null);
	}, [goBackIfOverlayHistory]);

	const canSyncAttachedDrawingAccess = React.useCallback((parentNoteId: string): boolean => {
		const normalizedParentNoteId = String(parentNoteId || '').trim();
		if (!normalizedParentNoteId) return false;
		const placement = sharedPlacements.find((item) => item.aliasId === normalizedParentNoteId) ?? null;
		return placement ? true : canEditActiveWorkspace;
	}, [canEditActiveWorkspace, sharedPlacements]);

	const syncAttachedDrawingAccess = React.useCallback(async (parentNoteId: string, drawingId: string): Promise<void> => {
		if (!canSyncAttachedDrawingAccess(parentNoteId)) return;
		const parentDocId = manager.resolveRoomName(parentNoteId);
		const drawingDocId = resolveRelatedNoteRoomId(parentNoteId, drawingId);
		if (!parentDocId || !drawingDocId || parentDocId === drawingDocId) return;
		await syncAttachedDrawingCollaborators({ parentDocId, drawingDocId }).catch(() => undefined);
	}, [canSyncAttachedDrawingAccess, manager, resolveRelatedNoteRoomId]);

	const loadDrawingDoc = React.useCallback(async (parentNoteId: string, drawingId: string): Promise<Y.Doc | null> => {
		const normalizedDrawingId = ensureRelatedNoteAlias(parentNoteId, drawingId);
		if (!normalizedDrawingId) return null;
		// Access sync is intentionally NOT called here — thumbnail loading should never
		// trigger the collaborator-sync API, which would fire a metadata event on every
		// thumbnail render and create an infinite refresh loop (metadata event →
		// refreshNoteShareState → re-render → new loadDrawingDoc reference → effect
		// re-runs → API call → metadata event → …).  Access sync happens once in
		// openAttachedDrawing, just before the editor is opened.
		return manager.getDocWithSync(normalizedDrawingId);
	}, [ensureRelatedNoteAlias, manager]);

	const deleteAttachedDrawing = React.useCallback(async (noteId: string, drawingId: string) => {
		const normalizedNoteId = String(noteId || '').trim();
		const normalizedDrawingId = ensureRelatedNoteAlias(normalizedNoteId, drawingId);
		if (!normalizedNoteId || !normalizedDrawingId) return;
		const parentDoc = manager.getDoc(normalizedNoteId);
		if (!parentDoc) return;
		removeNoteDrawingId(parentDoc, normalizedDrawingId);
		await manager.deleteNote(normalizedDrawingId, true);
	}, [ensureRelatedNoteAlias, manager]);

	const openMobileSidebar = React.useCallback(() => {
		setIsMobileSidebarDragging(false);
		setMobileSidebarProgress(1);
		isMobileSidebarOpenRef.current = true;
		const current = getOverlaySnapshot();
		const nextSnapshot: OverlaySnapshot = {
			...current,
			isMobileSearchOpen: false,
			isMobileSidebarOpen: true,
			isFabOpen: false,
		};
		if (sidebarView !== 'notes' && isMobileViewport && typeof window !== 'undefined' && isOverlayHistoryState(window.history.state)) {
			commitOverlaySnapshot(nextSnapshot, 'replace');
			return;
		}
		commitOverlaySnapshot(nextSnapshot, 'push');
	}, [commitOverlaySnapshot, getOverlaySnapshot, isMobileViewport, sidebarView]);

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
		replaceActiveOverlaySnapshot({
			...getOverlaySnapshot(),
			isMobileSearchOpen: false,
		});
	}, [getOverlaySnapshot, goBackIfOverlayHistory, replaceActiveOverlaySnapshot]);

	const toggleViewModePicker = React.useCallback(() => {
		if (isViewModePickerOpen) {
			setIsViewModePickerOpen(false);
			return;
		}
		// The mobile search field and view picker share the same header lane, so
		// opening the picker first collapses search in-place instead of stacking UI.
		if (isMobileSearchOpen) {
			replaceActiveOverlaySnapshot({
				...getOverlaySnapshot(),
				isMobileSearchOpen: false,
			});
		}
		setIsViewModePickerOpen(true);
	}, [getOverlaySnapshot, isMobileSearchOpen, isViewModePickerOpen, replaceActiveOverlaySnapshot]);

	React.useEffect(() => {
		if (!isViewModePickerOpen) return;
		const handlePointerDown = (event: PointerEvent): void => {
			const target = event.target as Node | null;
			if (!target) return;
			if (viewModePickerRef.current?.contains(target)) return;
			if (viewModeToggleButtonRef.current?.contains(target)) return;
			setIsViewModePickerOpen(false);
		};
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') setIsViewModePickerOpen(false);
		};
		window.addEventListener('pointerdown', handlePointerDown);
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('pointerdown', handlePointerDown);
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [isViewModePickerOpen]);

	React.useEffect(() => {
		if (!isViewModePickerOpen) return;
		const overlayOpen = editorMode !== 'none' || Boolean(selectedNoteId) || Boolean(crossWorkspaceNote);
		if (!overlayOpen) return;
		setIsViewModePickerOpen(false);
	}, [crossWorkspaceNote, editorMode, isViewModePickerOpen, selectedNoteId]);

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
	const isEditorOverlayOpen = editorMode !== 'none' || Boolean(selectedNoteId) || Boolean(crossWorkspaceNote);
	const isFabBlockedByOverlay =
		isEditorOverlayOpen ||
		isMobileSidebarOpen ||
		isMobileSearchOpen ||
		isPreferencesOpen ||
		isAppearanceOpen ||
		isUserOpen ||
		isUserManagementOpen ||
		isSendInviteOpen ||
		isShareNotificationsOpen ||
		isWorkspaceSwitcherOpen ||
		Boolean(collaboratorModalState) ||
		Boolean(noteAttachmentBrowserState) ||
		Boolean(noteImageModalState) ||
		Boolean(noteCollectionModalState) ||
		Boolean(noteLabelsModalState) ||
		Boolean(labelManagementModalState) ||
		Boolean(noteReminderModalState) ||
		isQuickReminderOpen ||
		Boolean(moveNoteModalState) ||
		isCollectionManagementOpen ||
		Boolean(workspaceDeletedNotice);
	const showMobileFab =
		isMobileViewport &&
		viewMode !== 'bubble' &&
		sidebarView === 'notes' &&
		Boolean(authWorkspaceId && activeWorkspaceSystemKind !== 'SHARED_WITH_ME' && canEditActiveWorkspace) &&
		!isFabBlockedByOverlay;
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
		showBriefDialog(t('links.addedToast'));
		void syncNoteLinksForDoc({
			userId: authUserId,
			docId: noteAttachmentBrowserState.docId,
			links: extractNoteLinksFromDoc(doc),
		});
	}, [authUserId, manager, noteAttachmentBrowserState, showBriefDialog, t]);

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
		setSendInviteContext(null);
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
		setIsMobileSidebarDragging(false);
		setMobileSidebarProgress(0);
		restoreFocusFromHiddenRegion(mobileSidebarRef.current, sidebarToggleButtonRef.current);
		// Rearm the edge-swipe guard immediately, but let history apply the actual
		// overlay snapshot so the drawer classes and FAB state do not desync.
		isMobileSidebarOpenRef.current = false;
		if (goBackIfOverlayHistory()) return;
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

	type NoteEditorOpenOptions = {
		replaceTop?: boolean;
		closeAttachmentBrowser?: boolean;
		fromExternalDeepLink?: boolean;
	};
	const openNoteEditor = React.useCallback(
		(noteId: string, opts?: NoteEditorOpenOptions) => {
			markNoteAccessed(manager.getDoc(noteId), manager.getAccessOrigin());
			const current = getOverlaySnapshot();
			const mobileOverlay = shouldUseMobileOverlayHistory(isMobileViewport);
			if (opts?.fromExternalDeepLink && mobileOverlay) {
				const editorSnapshot: OverlaySnapshot = {
					...current,
					sidebarView: 'notes',
					isMobileSearchOpen: false,
					editorMode: 'none',
					selectedNoteId: noteId,
					noteAttachmentBrowserState: opts?.closeAttachmentBrowser ? null : current.noteAttachmentBrowserState,
					isMobileSidebarOpen: false,
					isFabOpen: false,
				};
				// Cold-start deep links (email/push) land on a non-overlay history entry.
				// Convert that entry into a grid guard so Back/Save stay inside the app.
				if (typeof window !== 'undefined' && !isOverlayHistoryState(window.history.state)) {
					try {
						const gridSnapshot: OverlaySnapshot = {
							...EMPTY_OVERLAY_SNAPSHOT,
							sidebarView: 'notes',
						};
						const guardState: OverlayHistoryState = {
							[OVERLAY_HISTORY_KEY]: true,
							snapshot: gridSnapshot,
							kind: 'root',
						};
						window.history.replaceState(
							guardState,
							'',
							`${window.location.pathname}${window.location.search}${window.location.hash}`,
						);
						applyOverlaySnapshot(gridSnapshot);
					} catch {
						// ignore
					}
				}
				// Push onto overlay history so Back/Save return to the grid instead of leaving the PWA.
				commitOverlaySnapshot(editorSnapshot, 'push');
				return;
			}
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
					noteAttachmentBrowserState: opts?.closeAttachmentBrowser ? null : current.noteAttachmentBrowserState,
					isMobileSidebarOpen: false,
					isFabOpen: false,
				},
				shouldReplaceTop ? 'replace' : 'push'
			);
		},
		[commitOverlaySnapshot, applyOverlaySnapshot, getOverlaySnapshot, isMobileViewport, manager]
	);

	const openAttachedDrawing = React.useCallback(async (parentNoteId: string, drawingId: string) => {
		const normalizedDrawingId = ensureRelatedNoteAlias(parentNoteId, drawingId);
		if (!normalizedDrawingId) return;
		await syncAttachedDrawingAccess(parentNoteId, normalizedDrawingId);
		openNoteEditor(normalizedDrawingId, { replaceTop: true, closeAttachmentBrowser: true });
	}, [ensureRelatedNoteAlias, openNoteEditor, syncAttachedDrawingAccess]);

	const createAttachedDrawing = React.useCallback(async (noteId: string) => {
		const normalizedNoteId = String(noteId || '').trim();
		if (!normalizedNoteId) return;
		const parentDoc = manager.getDoc(normalizedNoteId);
		if (!parentDoc) return;

		// Attached drawings stay hidden from the note grid and remain local drafts
		// until Save links them into the parent note.
		const drawingId = makeNoteId('drawing-note');
		ensureRelatedNoteAlias(normalizedNoteId, drawingId);
		pendingNewNoteIdsRef.current.add(drawingId);
		markPendingNewNotesChanged();
		pendingAttachedDrawingParentsRef.current.set(drawingId, normalizedNoteId);
		setDraftNoteId(drawingId);
		const drawingDoc = await manager.getDocWithSync(drawingId);
		initDrawingNoteDoc(drawingDoc, '');
		openNoteEditor(drawingId);
	}, [ensureRelatedNoteAlias, manager, markPendingNewNotesChanged, openNoteEditor]);

	const getPendingNewNoteDisposition = React.useCallback(
		async (noteId: string): Promise<{ keep: boolean; type: 'text' | 'checklist' | 'drawing' }> => {
			const doc = manager.getDoc(noteId);
			if (!doc) return { keep: true, type: 'text' };
			const docId = manager.resolveRoomName(noteId);

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
			if (snapshot.type === 'drawing' && doc.getArray<Y.Map<any>>('elements').length > 0) {
				return { keep: true, type: snapshot.type };
			}
			if (snapshot.collectionId || readReminderLookupValue(noteReminderByDocId, docId, noteId) || snapshot.labelIds.length > 0) {
				return { keep: true, type: snapshot.type };
			}
			if (getNotePreviewLinksFromDoc(doc).length > 0) {
				return { keep: true, type: snapshot.type };
			}
			if (readDrawingLinkState(doc).drawingIds.length > 0) {
				return { keep: true, type: snapshot.type };
			}

			const [storedImages, queuedImages, queuedImageDeletions, storedDocuments, queuedDocuments, collaboratorSnapshot, pendingCollaboratorQueue] = await Promise.all([
				readStoredRemoteNoteImages(docId).catch(() => []),
				authUserId ? readQueuedNoteImages(authUserId, docId).catch(() => []) : Promise.resolve([]),
				authUserId ? readQueuedNoteImageDeletions(authUserId, docId).catch(() => []) : Promise.resolve([]),
				readStoredRemoteNoteDocuments(docId).catch(() => []),
				authUserId ? readQueuedNoteDocuments(authUserId, docId).catch(() => []) : Promise.resolve([]),
				authUserId ? readCachedNoteShareCollaborators(authUserId, docId).catch(() => null) : Promise.resolve(null),
				authUserId ? readPendingCollaboratorActions(authUserId, docId).catch(() => []) : Promise.resolve([]),
			]);

			const remoteImages = storedImages.length > 0 ? storedImages : getCachedRemoteNoteImages(docId);
			if (filterRemoteNoteImagesByPendingDeletes(remoteImages, queuedImageDeletions).length + queuedImages.length > 0) {
				return { keep: true, type: snapshot.type };
			}
			if (Math.max(storedDocuments.length + queuedDocuments.length, getCachedNoteDocuments(docId).length) > 0) {
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
		async (noteId: string, mode: 'cancel' | 'save' = 'cancel'): Promise<void> => {
			if (!pendingNewNoteIdsRef.current.has(noteId) || pendingNewNoteCleanupIdsRef.current.has(noteId)) return;
			pendingNewNoteCleanupIdsRef.current.add(noteId);
			try {
				const attachedParentNoteId = pendingAttachedDrawingParentsRef.current.get(noteId) ?? null;
				const rawNoteType = String(manager.getDoc(noteId)?.getMap('metadata')?.get('type') ?? 'text');
				const noteType = rawNoteType === 'checklist'
					? 'checklist' as const
					: rawNoteType === 'drawing'
						? 'drawing' as const
						: 'text' as const;
				const disposition = mode === 'save'
					? await getPendingNewNoteDisposition(noteId)
					: { keep: false, type: noteType };
				if (disposition.keep) {
					if (attachedParentNoteId) {
						const parentDoc = manager.getDoc(attachedParentNoteId);
						addNoteDrawingId(parentDoc, noteId);
						await syncAttachedDrawingAccess(attachedParentNoteId, noteId);
					} else {
						const title = manager.getDoc(noteId)?.getText('title')?.toString() ?? '';
						await manager.createNote(noteId, title);
						if (authWorkspaceId) {
							const nextSnapshotIds = [
								noteId,
								...readNoteOrderSnapshot(authWorkspaceId).filter((id) => id !== noteId),
							];
							writeNoteOrderSnapshot(authWorkspaceId, nextSnapshotIds);
						}
					}
					pendingNewNoteIdsRef.current.delete(noteId);
					markPendingNewNotesChanged();
					pendingNewNoteCollectionSeedRef.current.delete(noteId);
					pendingAttachedDrawingParentsRef.current.delete(noteId);
					// If the draft is no longer the actively open editor note, unhide it now.
					// When the editor is still mounted we keep the pending flag until close so
					// attachment/media panels never switch into server-refresh mode mid-teardown.
					if (selectedNoteId !== noteId) {
						setDraftNoteId((prev) => prev === noteId ? null : prev);
					}
					return;
				}
				await manager.permanentlyDeleteNote(noteId).catch(() => undefined);
				pendingNewNoteIdsRef.current.delete(noteId);
				markPendingNewNotesChanged();
				pendingNewNoteCollectionSeedRef.current.delete(noteId);
				pendingAttachedDrawingParentsRef.current.delete(noteId);
				if (selectedNoteId !== noteId) {
					setDraftNoteId((prev) => prev === noteId ? null : prev);
				}
				if (mode === 'save') {
					showBriefDialog(
						disposition.type === 'checklist'
							? 'empty checklist discarded'
							: disposition.type === 'drawing'
								? 'empty drawing discarded'
								: 'empty note discarded'
					);
				}
			} finally {
				pendingNewNoteCleanupIdsRef.current.delete(noteId);
			}
		},
		[authWorkspaceId, getPendingNewNoteDisposition, manager, markPendingNewNotesChanged, noteReminderByDocId, selectedNoteId, showBriefDialog, syncAttachedDrawingAccess]
	);

	const collapseEditorOverlay = React.useCallback((): void => {
		const gridSnapshot: OverlaySnapshot = {
			...getOverlaySnapshot(),
			editorMode: 'none',
			selectedNoteId: null,
			isMobileSearchOpen: false,
			isMobileSidebarOpen: false,
			isFabOpen: false,
		};
		if (shouldUseMobileOverlayHistory(isMobileViewport) && typeof window !== 'undefined' && isOverlayHistoryState(window.history.state)) {
			commitOverlaySnapshot(gridSnapshot, 'replace');
			return;
		}
		applyOverlaySnapshot(gridSnapshot);
	}, [applyOverlaySnapshot, commitOverlaySnapshot, getOverlaySnapshot, isMobileViewport]);

	const closeNoteEditor = React.useCallback(async () => {
		const closingNoteId = selectedNoteId;
		const attachedParentNoteId = closingNoteId ? pendingAttachedDrawingParentsRef.current.get(closingNoteId) ?? null : null;
		if (selectedNoteId && pendingNewNoteIdsRef.current.has(selectedNoteId)) {
			await finalizePendingNewNote(selectedNoteId, 'cancel');
		}
		if (attachedParentNoteId) {
			openNoteEditor(attachedParentNoteId, { replaceTop: true });
			return;
		}
		if (goBackIfOverlayHistory()) {
			if (closingNoteId) {
				setDraftNoteId((prev) => prev === closingNoteId ? null : prev);
			}
			// history.back() can no-op when the launch entry was never converted into a guard.
			if (typeof window !== 'undefined') {
				window.setTimeout(() => {
					isNavigatingBackRef.current = false;
					if (selectedNoteIdRef.current !== closingNoteId) return;
					collapseEditorOverlay();
				}, 0);
			}
			return;
		}
		setSelectedNoteId(null);
		setEditorMode('none');
		if (closingNoteId) {
			setDraftNoteId((prev) => prev === closingNoteId ? null : prev);
		}
	}, [collapseEditorOverlay, finalizePendingNewNote, goBackIfOverlayHistory, openNoteEditor, selectedNoteId]);

	const saveDrawingEditor = React.useCallback(async () => {
		const closingNoteId = selectedNoteId;
		const attachedParentNoteId = closingNoteId ? pendingAttachedDrawingParentsRef.current.get(closingNoteId) ?? null : null;
		if (selectedNoteId && pendingNewNoteIdsRef.current.has(selectedNoteId)) {
			try {
				await finalizePendingNewNote(selectedNoteId, 'save');
			} catch (error) {
				console.error('Failed to save pending drawing draft', error);
				showBriefDialog('failed to save note');
				return;
			}
		}
		if (attachedParentNoteId) {
			openNoteEditor(attachedParentNoteId, { replaceTop: true });
			return;
		}
		if (goBackIfOverlayHistory()) {
			if (closingNoteId) {
				setDraftNoteId((prev) => prev === closingNoteId ? null : prev);
			}
			if (typeof window !== 'undefined') {
				window.setTimeout(() => {
					isNavigatingBackRef.current = false;
					if (selectedNoteIdRef.current !== closingNoteId) return;
					collapseEditorOverlay();
				}, 0);
			}
			return;
		}
		setSelectedNoteId(null);
		setEditorMode('none');
		if (closingNoteId) {
			setDraftNoteId((prev) => prev === closingNoteId ? null : prev);
		}
	}, [collapseEditorOverlay, finalizePendingNewNote, goBackIfOverlayHistory, openNoteEditor, selectedNoteId, showBriefDialog]);

	const savePendingNewNoteAndClose = React.useCallback(async () => {
		const closingNoteId = selectedNoteId;
		if (selectedNoteId && pendingNewNoteIdsRef.current.has(selectedNoteId)) {
			try {
				await finalizePendingNewNote(selectedNoteId, 'save');
			} catch (error) {
				console.error('Failed to save pending note draft', error);
				showBriefDialog('failed to save note');
				return;
			}
		}
		if (goBackIfOverlayHistory()) {
			if (closingNoteId) {
				setDraftNoteId((prev) => prev === closingNoteId ? null : prev);
			}
			if (typeof window !== 'undefined') {
				window.setTimeout(() => {
					isNavigatingBackRef.current = false;
					if (selectedNoteIdRef.current !== closingNoteId) return;
					collapseEditorOverlay();
				}, 0);
			}
			return;
		}
		setSelectedNoteId(null);
		setEditorMode('none');
		if (closingNoteId) {
			setDraftNoteId((prev) => prev === closingNoteId ? null : prev);
		}
	}, [collapseEditorOverlay, finalizePendingNewNote, goBackIfOverlayHistory, selectedNoteId, showBriefDialog]);

	React.useEffect(() => {
		const previousSelectedNoteId = previousSelectedNoteIdRef.current;
		const openingPendingAttachedDrawing = Boolean(
			previousSelectedNoteId
			&& selectedNoteId
			&& pendingAttachedDrawingParentsRef.current.get(selectedNoteId) === previousSelectedNoteId
		);
		if (
			previousSelectedNoteId
			&& previousSelectedNoteId !== selectedNoteId
			&& pendingNewNoteIdsRef.current.has(previousSelectedNoteId)
			&& !openingPendingAttachedDrawing
		) {
			void finalizePendingNewNote(previousSelectedNoteId, 'cancel');
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
		if (!isFabOpen || showMobileFab) return;
		setIsFabOpen(false);
	}, [isFabOpen, showMobileFab]);

	React.useEffect(() => {
		if (!isFabOpen || !isEditorOverlayOpen) return;
		// Opening an editor should fully supersede quick-create on mobile so the
		// FAB button/backdrop cannot linger above the editor overlay.
		const current = getOverlaySnapshot();
		commitOverlaySnapshot({ ...current, isFabOpen: false }, 'replace');
	}, [commitOverlaySnapshot, getOverlaySnapshot, isEditorOverlayOpen, isFabOpen]);

	// Block background pan/scroll while the mobile FAB menu is open without toggling
	// overflow on the scroll root — that pattern snaps iOS/PWA grids back to the top.
	React.useEffect(() => {
		if (!isFabOpen || !showMobileFab || !isMobileViewport || typeof document === 'undefined') return;
		const allowTouchTarget = (target: EventTarget | null): boolean => {
			if (!(target instanceof Element)) return false;
			return Boolean(target.closest('.mobile-fab-backdrop, .mobile-fab-stack, .mobile-fab'));
		};
		const onTouchMove = (event: TouchEvent): void => {
			if (allowTouchTarget(event.target)) return;
			if (event.cancelable) event.preventDefault();
		};
		document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
		return () => {
			document.removeEventListener('touchmove', onTouchMove, { capture: true });
		};
	}, [isFabOpen, isMobileViewport, showMobileFab]);

	React.useEffect(() => {
		const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
		const shouldDeferThemeSync = authOfflineMode || browserOffline;
		applyTheme(themeId);
		persistThemeId(themeId);
		persistThemeIdForUser(authUserId, themeId);
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

	const primeThemeForAuthenticatedUser = React.useCallback((userId: string | null | undefined): void => {
		if (!userId) return;
		// Start from the per-user local cache so auth restore can paint a plausible
		// theme synchronously before any network preference fetch finishes.
		const nextThemeId = getStoredThemeIdForUser(userId);
		applyTheme(nextThemeId);
		persistThemeId(nextThemeId);
		persistThemeIdForUser(userId, nextThemeId);
		setThemeId((current) => (current === nextThemeId ? current : nextThemeId));
	}, []);

	const primeAuthenticatedThemeBeforeWorkspaceLoad = React.useCallback(async (userId: string | null | undefined): Promise<void> => {
		if (!userId) return;
		// Offline theme edits are queued in localStorage. Honor that choice first so a
		// reconnecting client does not briefly flash the stale server theme during auth.
		const pendingTheme = (() => {
			try {
				return window.localStorage.getItem('freemannotes.pendingThemeSync');
			} catch {
				return null;
			}
		})();
		if (pendingTheme && THEMES.some((theme) => theme.id === pendingTheme)) {
			const nextThemeId = pendingTheme as ThemeId;
			applyTheme(nextThemeId);
			persistThemeId(nextThemeId);
			persistThemeIdForUser(userId, nextThemeId);
			setThemeId((current) => (current === nextThemeId ? current : nextThemeId));
			prefetchedAuthPreferencesRef.current = null;
			return;
		}

		primeThemeForAuthenticatedUser(userId);
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

		// Fetch server-backed preferences before we mark the app fully authed so the
		// correct account theme can win before workspace activation starts note loading.
		const pref = await fetchUserPreferences(deviceId);
		if (!pref || pref.userId !== userId) return;
		prefetchedAuthPreferencesRef.current = pref;
		if (pref.theme && THEMES.some((theme) => theme.id === pref.theme)) {
			const nextThemeId = pref.theme as ThemeId;
			applyTheme(nextThemeId);
			persistThemeId(nextThemeId);
			persistThemeIdForUser(userId, nextThemeId);
			setThemeId((current) => (current === nextThemeId ? current : nextThemeId));
		}
	}, [deviceId, primeThemeForAuthenticatedUser]);

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
		editorToolbarMode?: EditorToolbarMode | null;
		noteCardMaxHeightPx?: number | null;
		noteCardBannerTitlePosition?: NoteCardBannerTitlePosition | null;
		checklistShowCompleted?: boolean;
		quickDeleteChecklist?: boolean;
		noteCardClickOpens?: boolean;
		noteCardCheckboxInteractions?: boolean;
		noteCardLinkInteractions?: boolean;
		noteCardCompletedInteractions?: boolean;
	}) => {
		const legacyNoteCardInteractions = next.noteCardClickOpens !== false;
		setNoteCardFontScalePref(clampFontScale(next.noteCardFontScale ?? getDefaultNoteCardFontScale()));
		setNoteEditorFontScalePref(clampFontScale(next.noteEditorFontScale ?? getDefaultNoteEditorFontScale()));
		setEditorToolbarModePref(normalizeEditorToolbarMode(next.editorToolbarMode));
		setNoteCardMaxHeightPref(clampNoteCardMaxHeightPx(next.noteCardMaxHeightPx ?? getDefaultNoteCardMaxHeightPx()));
		setNoteCardBannerTitlePositionPref(normalizeNoteCardBannerTitlePosition(next.noteCardBannerTitlePosition));
		setChecklistShowCompletedPref(Boolean(next.checklistShowCompleted));
		setQuickDeleteChecklistPref(Boolean(next.quickDeleteChecklist));
		setNoteCardClickOpensPref(legacyNoteCardInteractions);
		setNoteCardCheckboxInteractionsPref(next.noteCardCheckboxInteractions !== false && legacyNoteCardInteractions);
		setNoteCardLinkInteractionsPref(next.noteCardLinkInteractions !== false && legacyNoteCardInteractions);
		setNoteCardCompletedInteractionsPref(next.noteCardCompletedInteractions !== false && legacyNoteCardInteractions);
	}, []);

	const persistDevicePrefsLocally = React.useCallback((next: {
		noteCardFontScale?: number;
		noteEditorFontScale?: number;
		editorToolbarMode?: EditorToolbarMode;
		noteCardMaxHeightPx?: number;
		noteCardBannerTitlePosition?: NoteCardBannerTitlePosition;
		checklistShowCompleted?: boolean;
		quickDeleteChecklist?: boolean;
		noteCardClickOpens?: boolean;
		noteCardCheckboxInteractions?: boolean;
		noteCardLinkInteractions?: boolean;
		noteCardCompletedInteractions?: boolean;
		updatedAt?: string;
	}) => {
		writeCachedDeviceAppearancePreferences({
			userId: authUserId ?? null,
			deviceId,
			noteCardFontScale: clampFontScale(next.noteCardFontScale ?? noteCardFontScalePref),
			noteEditorFontScale: clampFontScale(next.noteEditorFontScale ?? noteEditorFontScalePref),
			editorToolbarMode: normalizeEditorToolbarMode(next.editorToolbarMode ?? editorToolbarModePref),
			noteCardMaxHeightPx: clampNoteCardMaxHeightPx(next.noteCardMaxHeightPx ?? noteCardMaxHeightPref),
			noteCardBannerTitlePosition: normalizeNoteCardBannerTitlePosition(next.noteCardBannerTitlePosition ?? noteCardBannerTitlePositionPref),
			checklistShowCompleted: next.checklistShowCompleted ?? checklistShowCompletedPref,
			quickDeleteChecklist: next.quickDeleteChecklist ?? quickDeleteChecklistPref,
			noteCardClickOpens: next.noteCardClickOpens ?? noteCardClickOpensPref,
			noteCardCheckboxInteractions: next.noteCardCheckboxInteractions ?? noteCardCheckboxInteractionsPref,
			noteCardLinkInteractions: next.noteCardLinkInteractions ?? noteCardLinkInteractionsPref,
			noteCardCompletedInteractions: next.noteCardCompletedInteractions ?? noteCardCompletedInteractionsPref,
			updatedAt: next.updatedAt ?? new Date().toISOString(),
		});
	}, [authUserId, checklistShowCompletedPref, deviceId, editorToolbarModePref, noteCardBannerTitlePositionPref, noteCardCheckboxInteractionsPref, noteCardClickOpensPref, noteCardCompletedInteractionsPref, noteCardFontScalePref, noteCardLinkInteractionsPref, noteCardMaxHeightPref, noteEditorFontScalePref, quickDeleteChecklistPref]);

	const syncLocalDevicePrefsFromServer = React.useCallback((pref: UserDevicePreferences): void => {
		applyDevicePreferenceState(pref);
		persistDevicePrefsLocally({
			noteCardFontScale: pref.noteCardFontScale,
			noteEditorFontScale: pref.noteEditorFontScale,
			editorToolbarMode: pref.editorToolbarMode,
			noteCardMaxHeightPx: pref.noteCardMaxHeightPx ?? getDefaultNoteCardMaxHeightPx(),
			noteCardBannerTitlePosition: pref.noteCardBannerTitlePosition,
			checklistShowCompleted: pref.checklistShowCompleted,
			quickDeleteChecklist: pref.quickDeleteChecklist,
			noteCardClickOpens: pref.noteCardClickOpens,
			noteCardCheckboxInteractions: pref.noteCardCheckboxInteractions,
			noteCardLinkInteractions: pref.noteCardLinkInteractions,
			noteCardCompletedInteractions: pref.noteCardCompletedInteractions,
			updatedAt: pref.updatedAt ?? new Date().toISOString(),
		});
	}, [applyDevicePreferenceState, persistDevicePrefsLocally]);

	React.useEffect(() => {
		setUserNoteColorPreferenceScope(authUserId ?? null);
		setUserNoteBannerPreferenceScope(authUserId ?? null);
		setUserNotePinPreferenceScope(authUserId ?? null);
		setCollapsibleHeadingPreferenceScope(authUserId ?? null, deviceId ?? null);
	}, [authUserId, deviceId]);

	const pendingAppearanceSyncStorageKey = React.useMemo(
		() => `freemannotes.pendingAppearanceSync.v1:${authUserId ?? ''}:${deviceId}`,
		[authUserId, deviceId]
	);

	const hasPendingAppearanceSync = React.useCallback((): boolean => {
		if (typeof window === 'undefined') return false;
		try {
			return window.localStorage.getItem(pendingAppearanceSyncStorageKey) === '1';
		} catch {
			return false;
		}
	}, [pendingAppearanceSyncStorageKey]);

	const markPendingAppearanceSync = React.useCallback((): void => {
		if (typeof window === 'undefined') return;
		try {
			window.localStorage.setItem(pendingAppearanceSyncStorageKey, '1');
		} catch {
			// best effort
		}
	}, [pendingAppearanceSyncStorageKey]);

	const clearPendingAppearanceSync = React.useCallback((): void => {
		if (typeof window === 'undefined') return;
		try {
			window.localStorage.removeItem(pendingAppearanceSyncStorageKey);
		} catch {
			// best effort
		}
	}, [pendingAppearanceSyncStorageKey]);

	const syncPendingAppearancePreferences = React.useCallback(async (): Promise<void> => {
		if (authStatus !== 'authed' || !prefsHydrationAttempted) return;
		if (authOfflineMode || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
		if (!hasPendingAppearanceSync()) return;
		const localAppearanceSnapshot = readCachedDeviceAppearancePreferences(deviceId, authUserId);
		if (!localAppearanceSnapshot) {
			clearPendingAppearanceSync();
			return;
		}
		const updatedAppearance = await updateUserPreferences(deviceId, {
			noteCardFontScale: localAppearanceSnapshot.noteCardFontScale,
			noteEditorFontScale: localAppearanceSnapshot.noteEditorFontScale,
			editorToolbarMode: localAppearanceSnapshot.editorToolbarMode,
			noteCardMaxHeightPx: localAppearanceSnapshot.noteCardMaxHeightPx,
			noteCardBannerTitlePosition: localAppearanceSnapshot.noteCardBannerTitlePosition,
			checklistShowCompleted: localAppearanceSnapshot.checklistShowCompleted,
			quickDeleteChecklist: localAppearanceSnapshot.quickDeleteChecklist,
			noteCardClickOpens: localAppearanceSnapshot.noteCardClickOpens,
			noteCardCheckboxInteractions: localAppearanceSnapshot.noteCardCheckboxInteractions,
			noteCardLinkInteractions: localAppearanceSnapshot.noteCardLinkInteractions,
			noteCardCompletedInteractions: localAppearanceSnapshot.noteCardCompletedInteractions,
		});
		if (!updatedAppearance) return;
		clearPendingAppearanceSync();
		syncLocalDevicePrefsFromServer(updatedAppearance);
	}, [authOfflineMode, authStatus, authUserId, clearPendingAppearanceSync, deviceId, hasPendingAppearanceSync, prefsHydrationAttempted, syncLocalDevicePrefsFromServer]);

	const commitAppearancePreferencePatch = React.useCallback((patch: {
		noteCardFontScale?: number;
		noteEditorFontScale?: number;
		editorToolbarMode?: EditorToolbarMode;
		noteCardMaxHeightPx?: number;
		noteCardBannerTitlePosition?: NoteCardBannerTitlePosition;
		checklistShowCompleted?: boolean;
		quickDeleteChecklist?: boolean;
		noteCardClickOpens?: boolean;
		noteCardCheckboxInteractions?: boolean;
		noteCardLinkInteractions?: boolean;
		noteCardCompletedInteractions?: boolean;
	}): void => {
		persistDevicePrefsLocally(patch);
		if (authStatus !== 'authed' || !prefsHydrationAttempted) return;
		const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
		if (authOfflineMode || browserOffline) {
			markPendingAppearanceSync();
			return;
		}
		void (async () => {
			const updated = await updateUserPreferences(deviceId, patch);
			if (!updated) {
				markPendingAppearanceSync();
				return;
			}
			clearPendingAppearanceSync();
			syncLocalDevicePrefsFromServer(updated);
		})();
	}, [authOfflineMode, authStatus, clearPendingAppearanceSync, deviceId, markPendingAppearanceSync, persistDevicePrefsLocally, prefsHydrationAttempted, syncLocalDevicePrefsFromServer]);

	const handleNoteCardFontScaleChange = React.useCallback((nextScale: number) => {
		const normalized = clampFontScale(nextScale);
		setNoteCardFontScalePref(normalized);
		persistDevicePrefsLocally({ noteCardFontScale: normalized });
	}, [persistDevicePrefsLocally]);

	const commitNoteCardFontScaleChange = React.useCallback((nextScale: number) => {
		const normalized = clampFontScale(nextScale);
		setNoteCardFontScalePref(normalized);
		commitAppearancePreferencePatch({ noteCardFontScale: normalized });
	}, [commitAppearancePreferencePatch]);

	const handleNoteEditorFontScaleChange = React.useCallback((nextScale: number) => {
		const normalized = clampFontScale(nextScale);
		setNoteEditorFontScalePref(normalized);
		persistDevicePrefsLocally({ noteEditorFontScale: normalized });
	}, [persistDevicePrefsLocally]);

	const commitNoteEditorFontScaleChange = React.useCallback((nextScale: number) => {
		const normalized = clampFontScale(nextScale);
		setNoteEditorFontScalePref(normalized);
		commitAppearancePreferencePatch({ noteEditorFontScale: normalized });
	}, [commitAppearancePreferencePatch]);

	const handleNoteCardMaxHeightChange = React.useCallback((nextHeight: number) => {
		const normalized = clampNoteCardMaxHeightPx(nextHeight);
		setNoteCardMaxHeightPref(normalized);
		persistDevicePrefsLocally({ noteCardMaxHeightPx: normalized });
	}, [persistDevicePrefsLocally]);

	const commitNoteCardMaxHeightChange = React.useCallback((nextHeight: number) => {
		const normalized = clampNoteCardMaxHeightPx(nextHeight);
		setNoteCardMaxHeightPref(normalized);
		commitAppearancePreferencePatch({ noteCardMaxHeightPx: normalized });
	}, [commitAppearancePreferencePatch]);

	const handleNoteCardBannerTitlePositionChange = React.useCallback((nextPosition: NoteCardBannerTitlePosition) => {
		const normalized = normalizeNoteCardBannerTitlePosition(nextPosition);
		setNoteCardBannerTitlePositionPref(normalized);
		persistDevicePrefsLocally({ noteCardBannerTitlePosition: normalized });
	}, [persistDevicePrefsLocally]);

	const commitNoteCardBannerTitlePositionChange = React.useCallback((nextPosition: NoteCardBannerTitlePosition) => {
		const normalized = normalizeNoteCardBannerTitlePosition(nextPosition);
		setNoteCardBannerTitlePositionPref(normalized);
		commitAppearancePreferencePatch({ noteCardBannerTitlePosition: normalized });
	}, [commitAppearancePreferencePatch]);

	const commitChecklistShowCompletedPref = React.useCallback((next: boolean) => {
		setChecklistShowCompletedPref(next);
		commitAppearancePreferencePatch({ checklistShowCompleted: next });
	}, [commitAppearancePreferencePatch]);

	const commitQuickDeleteChecklistPref = React.useCallback((next: boolean) => {
		setQuickDeleteChecklistPref(next);
		commitAppearancePreferencePatch({ quickDeleteChecklist: next });
	}, [commitAppearancePreferencePatch]);

	const commitEditorToolbarModePref = React.useCallback((next: EditorToolbarMode) => {
		const normalized = normalizeEditorToolbarMode(next);
		setEditorToolbarModePref(normalized);
		commitAppearancePreferencePatch({ editorToolbarMode: normalized });
	}, [commitAppearancePreferencePatch]);

	const commitNoteCardClickOpensPref = React.useCallback((next: boolean) => {
		setNoteCardClickOpensPref(next);
		commitAppearancePreferencePatch({ noteCardClickOpens: next });
	}, [commitAppearancePreferencePatch]);

	const commitNoteCardCheckboxInteractionsPref = React.useCallback((next: boolean) => {
		setNoteCardCheckboxInteractionsPref(next);
		commitAppearancePreferencePatch({ noteCardCheckboxInteractions: next });
	}, [commitAppearancePreferencePatch]);

	const commitNoteCardLinkInteractionsPref = React.useCallback((next: boolean) => {
		setNoteCardLinkInteractionsPref(next);
		commitAppearancePreferencePatch({ noteCardLinkInteractions: next });
	}, [commitAppearancePreferencePatch]);

	const commitNoteCardCompletedInteractionsPref = React.useCallback((next: boolean) => {
		setNoteCardCompletedInteractionsPref(next);
		commitAppearancePreferencePatch({ noteCardCompletedInteractions: next });
	}, [commitAppearancePreferencePatch]);

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

	// Stable refs for callbacks that change identity on every preference change.
	// Using refs prevents the prefs hydration effect from re-firing every time
	// the user moves a preference slider (which would race-fetch stale server
	// values and potentially reset in-flight local changes).
	const syncLocalDevicePrefsFromServerRef = React.useRef(syncLocalDevicePrefsFromServer);
	React.useEffect(() => {
		syncLocalDevicePrefsFromServerRef.current = syncLocalDevicePrefsFromServer;
	}, [syncLocalDevicePrefsFromServer]);

	const persistDevicePrefsLocallyRef = React.useRef(persistDevicePrefsLocally);
	React.useEffect(() => {
		persistDevicePrefsLocallyRef.current = persistDevicePrefsLocally;
	}, [persistDevicePrefsLocally]);

	const syncPendingAppearancePreferencesRef = React.useRef(syncPendingAppearancePreferences);
	React.useEffect(() => {
		syncPendingAppearancePreferencesRef.current = syncPendingAppearancePreferences;
	}, [syncPendingAppearancePreferences]);

	const flushPendingReminderMutationsRef = React.useRef(flushPendingReminderMutations);
	React.useEffect(() => {
		flushPendingReminderMutationsRef.current = flushPendingReminderMutations;
	}, [flushPendingReminderMutations]);

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
		primeThemeForAuthenticatedUser(cached.userId);
		setAuthStatus('authed');
		setAuthUserId(cached.userId);
		setAuthUserRole(cached.role ?? null);
		setAuthProfileImage(cached.profileImage);
		setAuthWorkspaceId(restoredWorkspaceId);
		setAuthOfflineMode(true);
		writeWorkspaceSelectionCache({ userId: cached.userId, workspaceId: restoredWorkspaceId });
		manager.setWebsocketEnabled(false);
		manager.setActiveWorkspaceId(restoredWorkspaceId);
		return true;
	}, [manager, primeThemeForAuthenticatedUser]);

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
					setAuthUserRole(null);
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
				const role = body?.user?.role ? normalizeGlobalUserRole(body.user.role) : null;
				const workspaceId = body?.workspaceId ? String(body.workspaceId) : null;
				if (!userId) {
					setAuthStatus('unauth');
					setAuthUserId(null);
					setAuthUserRole(null);
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
				await primeAuthenticatedThemeBeforeWorkspaceLoad(userId);
				setAuthStatus('authed');
				setAuthUserId(userId);
				setAuthUserRole(role);
				setAuthProfileImage(profileImage);
				setAuthWorkspaceId(effectiveWorkspaceId);
				setAuthOfflineMode(false);
				writeAuthCache({ v: 1, userId, workspaceId: effectiveWorkspaceId, profileImage, role });
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
							writeAuthCache({ v: 1, userId, workspaceId: activatedWorkspaceId, profileImage, role });
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
				setAuthUserRole(null);
				setAuthProfileImage(null);
				setAuthWorkspaceId(null);
				setAuthOfflineMode(false);
				manager.setActiveWorkspaceId(null);
				manager.setWebsocketEnabled(false);
			}
		},
		[deviceId, manager, primeAuthenticatedThemeBeforeWorkspaceLoad, restoreCachedAuthSession]
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
			const role = body?.user?.role ? normalizeGlobalUserRole(body.user.role) : null;
			const workspaceId = body?.workspaceId ? String(body.workspaceId) : null;

			const existingSelection = readWorkspaceSelectionCache();
			const effectiveWorkspaceId =
				existingSelection?.userId === userId && existingSelection?.workspaceId
					? existingSelection.workspaceId
					: workspaceId;
			setAuthUserId(userId);
			setAuthUserRole(role);
			setAuthProfileImage(profileImage);
			setAuthWorkspaceId(effectiveWorkspaceId);
			setAuthStatus('authed');
			setAuthOfflineMode(false);
			if (effectiveWorkspaceId && effectiveWorkspaceId !== workspaceId) {
				manager.setWebsocketEnabled(false);
			}
			manager.setActiveWorkspaceId(effectiveWorkspaceId);
			manager.setWebsocketEnabled(Boolean(effectiveWorkspaceId) && effectiveWorkspaceId === workspaceId);
			writeAuthCache({ v: 1, userId, workspaceId: effectiveWorkspaceId, profileImage, role });
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
			const prefetched = prefetchedAuthPreferencesRef.current;
			prefetchedAuthPreferencesRef.current = null;
			let pref = prefetched && prefetched.userId === authUserId
				? prefetched
				: await fetchUserPreferences(deviceId);
			if (cancelled) return;
			if (pref) {
				const localNoteColorPrefs = getUserNoteColorPrefsSnapshot();
				const localNoteBannerPrefs = getUserNoteBannerPrefsSnapshot();
				const localNotePinPrefs = getNotePinPrefsSnapshot();
				if (
					Object.keys(localNoteColorPrefs).length > 0
					&& Object.keys(pref.noteColorsByNoteId || {}).length === 0
				) {
					const updatedNoteColorPrefs = await updateUserPreferences(deviceId, {
						noteColorsByNoteId: localNoteColorPrefs,
					});
					if (cancelled) return;
					if (updatedNoteColorPrefs) {
						pref = updatedNoteColorPrefs;
					}
				}
				if (
					Object.keys(localNoteBannerPrefs).length > 0
					&& Object.keys(pref.noteBannersByNoteId || {}).length === 0
				) {
					const updatedNoteBannerPrefs = await updateUserPreferences(deviceId, {
						noteBannersByNoteId: localNoteBannerPrefs,
					});
					if (cancelled) return;
					if (updatedNoteBannerPrefs) {
						pref = updatedNoteBannerPrefs;
					}
				}
				if (
					Object.keys(localNotePinPrefs).length > 0
					&& Object.keys(pref.notePinsByDocId || {}).length === 0
				) {
					const updatedNotePinPrefs = await updateUserPreferences(deviceId, {
						notePinsByDocId: localNotePinPrefs,
					});
					if (cancelled) return;
					if (updatedNotePinPrefs) {
						pref = updatedNotePinPrefs;
					}
				}
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
				const pendingAppearanceSync = hasPendingAppearanceSync();
				if (localAppearanceSnapshot && (localAppearanceNewer || pendingAppearanceSync)) {
					applyDevicePreferenceState(localAppearanceSnapshot);
					const updatedAppearance = await updateUserPreferences(deviceId, {
						noteCardFontScale: localAppearanceSnapshot.noteCardFontScale,
						noteEditorFontScale: localAppearanceSnapshot.noteEditorFontScale,
						editorToolbarMode: localAppearanceSnapshot.editorToolbarMode,
						noteCardMaxHeightPx: localAppearanceSnapshot.noteCardMaxHeightPx,
						noteCardBannerTitlePosition: localAppearanceSnapshot.noteCardBannerTitlePosition,
						checklistShowCompleted: localAppearanceSnapshot.checklistShowCompleted,
						quickDeleteChecklist: localAppearanceSnapshot.quickDeleteChecklist,
						noteCardClickOpens: localAppearanceSnapshot.noteCardClickOpens,
						noteCardCheckboxInteractions: localAppearanceSnapshot.noteCardCheckboxInteractions,
						noteCardLinkInteractions: localAppearanceSnapshot.noteCardLinkInteractions,
						noteCardCompletedInteractions: localAppearanceSnapshot.noteCardCompletedInteractions,
					});
					if (!cancelled && updatedAppearance) {
						clearPendingAppearanceSync();
						syncLocalDevicePrefsFromServerRef.current(updatedAppearance);
					}
				} else if (pref.noteCardMaxHeightPx == null) {
					// Fresh device: server has no saved card height → apply device-aware
					// defaults and persist them so subsequent logins use the real values.
					const freshDefaults = {
						noteCardMaxHeightPx: getDefaultNoteCardMaxHeightPx(),
						noteCardFontScale: getDefaultNoteCardFontScale(),
						noteEditorFontScale: getDefaultNoteEditorFontScale(),
						noteCardBannerTitlePosition: getDefaultNoteCardBannerTitlePosition(),
					};
					applyDevicePreferenceState({ ...pref, ...freshDefaults });
					persistDevicePrefsLocallyRef.current({
						noteCardFontScale: freshDefaults.noteCardFontScale,
						noteEditorFontScale: freshDefaults.noteEditorFontScale,
						editorToolbarMode: pref.editorToolbarMode ?? 'full',
						noteCardMaxHeightPx: freshDefaults.noteCardMaxHeightPx,
						noteCardBannerTitlePosition: freshDefaults.noteCardBannerTitlePosition,
						checklistShowCompleted: pref.checklistShowCompleted ?? false,
						quickDeleteChecklist: pref.quickDeleteChecklist ?? false,
						noteCardClickOpens: pref.noteCardClickOpens ?? true,
						noteCardCheckboxInteractions: pref.noteCardCheckboxInteractions ?? true,
						noteCardLinkInteractions: pref.noteCardLinkInteractions ?? true,
						noteCardCompletedInteractions: pref.noteCardCompletedInteractions ?? true,
						updatedAt: new Date().toISOString(),
					});
					if (!cancelled) {
						void updateUserPreferences(deviceId, freshDefaults);
					}
				} else {
					clearPendingAppearanceSync();
					syncLocalDevicePrefsFromServerRef.current(pref);
				}
				setTrashDeleteAfterDaysPref(pref.deleteAfterDays ?? null);
				seedNoteCardCompletedExpandedByNoteId(pref.noteCardCompletedExpandedByNoteId || {});
				replaceCollapsedRichHeadingPrefs(pref.collapsedRichHeadingIds || {});
				replaceUserNoteColorPrefs(pref.noteColorsByNoteId || {});
				replaceUserNoteBannerPrefs(pref.noteBannersByNoteId || {});
				replaceUserNotePinPrefs(pref.notePinsByDocId || {});
				setBubbleWorkspaceColorOverrides(pref.bubbleWorkspaceColors || {});
				// Merge the server-backed dismissed IDs with the local offline cache so
				// users keep dismissals made on other devices without losing any that
				// were created locally while offline or before the server sync landed.
				const serverDismissedFailedLinkIds = new Set(
					Object.entries(pref.dismissedFailedLinkIds || {})
						.filter(([, dismissed]) => dismissed)
						.map(([id]) => id)
				);
				const mergedDismissedFailedLinkIds = new Set([
					...serverDismissedFailedLinkIds,
					...dismissedFailedLinkIdsRef.current,
				]);
				dismissedFailedLinkIdsRef.current = mergedDismissedFailedLinkIds;
				if (authUserId && typeof window !== 'undefined') {
					try {
						window.localStorage.setItem(
							`freemannotes.dismissedFailedLinks.v2:${authUserId}`,
							JSON.stringify([...mergedDismissedFailedLinkIds])
						);
					} catch {
						// Best effort only.
					}
				}
				if (!cancelled && mergedDismissedFailedLinkIds.size !== serverDismissedFailedLinkIds.size) {
					void updateUserPreferences(deviceId, {
						dismissedFailedLinkIds: Object.fromEntries(
							[...mergedDismissedFailedLinkIds].map((id) => [id, true] as const)
						),
					});
				}
				if (!cancelled && mergedDismissedFailedLinkIds.size > 0) {
					void refreshNoteShareStateRef.current();
				}
			}
			setPrefsHydrationAttempted(true);
		})();
		return () => {
			cancelled = true;
		};
	}, [applyDevicePreferenceState, authOfflineMode, authStatus, authUserId, deviceId, setLocale]);

	React.useEffect(() => {
		if (authStatus !== 'authed' || !authUserId) return;
		let cancelled = false;
		(async () => {
			const snapshot = await readCachedWorkspaceSnapshot(authUserId, deviceId);
			if (cancelled) return;
			if (snapshot.workspaces.length > 0) {
				setSidebarWorkspaces(snapshot.workspaces);
				setSidebarWorkspacesError(null);
				writeWorkspaceListLocalCache(authUserId, snapshot.workspaces);
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
					role: authUserRole,
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
					await flushUserPreferences(deviceId);
					await syncPendingAppearancePreferencesRef.current();
					await flushPendingReminderMutationsRef.current();
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

	React.useEffect(() => {
		if (authStatus !== 'authed' || !authUserId || !authOfflineMode || typeof window === 'undefined') return;
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

		let cancelled = false;
		let running = false;
		let timer: ReturnType<typeof window.setTimeout> | null = null;

		const schedule = (delayMs: number): void => {
			if (cancelled) return;
			if (timer !== null) window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				timer = null;
				void attemptRecovery();
			}, delayMs);
		};

		const attemptRecovery = async (): Promise<void> => {
			if (cancelled || running) return;
			if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
			running = true;
			try {
				await probeSession({ allowOfflineRestore: true });
			} finally {
				running = false;
				if (!cancelled && authOfflineModeRef.current) {
					// Server restarts do not fire the browser `online` event because the
					// device never lost network connectivity. Keep probing while the app
					// is in offline-restored mode so Chrome/PWA sessions recover on their
					// own as soon as the backend is reachable again.
					schedule(5_000);
				}
			}
		};

		schedule(2_000);
		return () => {
			cancelled = true;
			if (timer !== null) window.clearTimeout(timer);
		};
	}, [authOfflineMode, authStatus, authUserId, probeSession]);

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
	}, [authOfflineMode, authStatus, authUserId, deviceId]);

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
		setAuthUserRole(null);
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
		setSendInviteContext(null);
		setIsWorkspaceSwitcherOpen(false);
		setActiveWorkspaceName(null);
		setActiveWorkspaceSystemKind(null);
		setSidebarWorkspaces([]);
		setSidebarWorkspacesError(null);
		// Clear the localStorage workspace-list cache so a different user logging in
		// on this device starts with a clean sidebar (no stale entries from previous session).
		clearWorkspaceListLocalCache(authUserId ?? '');
		clearCachedReminderStates(authUserId ?? '');
		setSharedPlacements([]);
		setActiveWorkspaceSharedPlacements([]);
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
			setActiveWorkspaceSharedPlacements([]);
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
					writeAuthCache({ v: 1, userId: authUserId, workspaceId: null, profileImage: authProfileImage, role: authUserRole });
				}
			} else {
				clearWorkspaceSelectionCache();
			}
		},
		[authProfileImage, authUserId, authUserRole, deviceId, manager]
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
			const cacheRole = authUserRole ?? cachedAuth?.role ?? null;
			if (cacheUserId) {
				writeAuthCache({ v: 1, userId: cacheUserId, workspaceId, profileImage: cacheProfileImage, role: cacheRole });
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

	// Tracks workspace IDs that were deleted by the local user and whose switch is in progress.
	// Used by handleRemoteWorkspaceDeletedEvent to skip the metadata-WebSocket echo that arrives
	// on the same connection during the async gap in handleWorkspaceDeleted — without this guard,
	// the stale authWorkspaceId closure in the remote handler matches the deleted workspace and
	// calls clearActiveWorkspaceState, which disables WebSocket sync before handleWorkspaceActivated
	// can set up the new workspace providers.
	const locallyDeletingWorkspaceIdsRef = React.useRef<Set<string>>(new Set());

	const handleWorkspaceDeleted = React.useCallback(
		async (deletedWorkspaceId: string, nextActiveWorkspaceId: string | null) => {
			// Ensure the workspace is in the suppression set even if handleBeforeWorkspaceDelete
			// was already called (idempotent add).
			locallyDeletingWorkspaceIdsRef.current.add(deletedWorkspaceId);
			try {
				setSidebarWorkspaces((prev) => prev.filter((workspace) => workspace.id !== deletedWorkspaceId));
				if (nextActiveWorkspaceId) {
					if (nextActiveWorkspaceId !== authWorkspaceId) {
						handleWorkspaceActivated(nextActiveWorkspaceId);
					}
					// Re-enable WebSocket sync explicitly.  The metadata-WS echo may have
					// raced ahead of this fetch response and called clearActiveWorkspaceState
					// (which sets websocketEnabled=false).  The DELETE response already
					// carries the new JWT session cookie, so it is safe to enable WS now.
					manager.setWebsocketEnabled(true);
				} else {
					clearActiveWorkspaceState({ preserveAuthCache: true });
				}
				// Cache cleanup is async-only; runs after the switch is committed.
				if (authUserId) {
					await removeCachedWorkspace({ workspaceId: deletedWorkspaceId, userId: authUserId, deviceId });
				}
			} finally {
				locallyDeletingWorkspaceIdsRef.current.delete(deletedWorkspaceId);
			}
		},
		[authUserId, authWorkspaceId, clearActiveWorkspaceState, deviceId, handleWorkspaceActivated, manager]
	);

	// Called by WorkspaceSwitcherModal BEFORE the HTTP DELETE request is sent so we
	// can suppress the metadata-WebSocket echo that races against the fetch response.
	// On fast/local connections the server publishes the echo right after sending the
	// HTTP response; the browser can process the WS message macrotask BEFORE the fetch
	// Promise resolves, causing handleRemoteWorkspaceDeletedEvent to fire before
	// handleWorkspaceDeleted — when locallyDeletingWorkspaceIdsRef is still empty.
	const handleBeforeWorkspaceDelete = React.useCallback((workspaceId: string) => {
		locallyDeletingWorkspaceIdsRef.current.add(workspaceId);
		// Safety valve: remove after 10 s in case the request fails and
		// handleWorkspaceDeleted (which cleans up in finally) is never called.
		if (typeof window !== 'undefined') {
			window.setTimeout(() => {
				locallyDeletingWorkspaceIdsRef.current.delete(workspaceId);
			}, 10_000);
		}
	}, []);

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
			//
			// Two guards prevent the metadata-WS echo from the local delete action from
			// incorrectly calling clearActiveWorkspaceState after the workspace switch:
			//
			// Guard 1 (fast path): the ref-based set captures the window while
			//   handleWorkspaceDeleted is still executing.
			//
			// Guard 2 (reliable fallback): manager.setActiveWorkspaceId(nextId) runs
			//   synchronously inside handleWorkspaceActivated, BEFORE any await.  So by
			//   the time any async callback fires, getActiveWorkspaceId() already returns
			//   the new workspace — even when the React authWorkspaceId closure is stale.
			if (locallyDeletingWorkspaceIdsRef.current.has(deletedWorkspaceId)) return;
			if (manager.getActiveWorkspaceId() !== deletedWorkspaceId) return;
			const hasOtherWorkspaces = sidebarWorkspacesRef.current.some((workspace) => workspace.id !== deletedWorkspaceId);
			setSidebarWorkspaces((prev) => prev.filter((workspace) => workspace.id !== deletedWorkspaceId));
			clearActiveWorkspaceState({ preserveAuthCache: true });
			setWorkspaceDeletedNotice({ hasOtherWorkspaces });
		},
		[clearActiveWorkspaceState, manager]
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
		// For non-SHARED_WITH_ME workspaces, use only the active workspace's placements
		// so personal-workspace shared notes appear without injecting other workspace notes.
		// For SHARED_WITH_ME, filter by the selected folder.
		if (activeWorkspaceSystemKind !== 'SHARED_WITH_ME') return activeWorkspaceSharedPlacements;
		if (!activeSharedFolder) {
			return sharedPlacements.filter((placement) => !String(placement.folderName || '').trim());
		}
		return sharedPlacements.filter((placement) => String(placement.folderName || '').trim() === activeSharedFolder);
	}, [activeSharedFolder, activeWorkspaceSystemKind, activeWorkspaceSharedPlacements, sharedPlacements]);

	const resolvedActiveWorkspace = React.useMemo(() => {
		if (!authWorkspaceId) return null;
		return sidebarWorkspaces.find((workspace) => workspace.id === authWorkspaceId) ?? null;
	}, [authWorkspaceId, sidebarWorkspaces]);

	const resolvedActiveWorkspaceName = React.useMemo(() => {
		if (resolvedActiveWorkspace) {
			return getWorkspaceDisplayName(resolvedActiveWorkspace, t);
		}
		return activeWorkspaceName;
	}, [activeWorkspaceName, resolvedActiveWorkspace, t]);

	const resolvedActiveWorkspaceSystemKind = resolvedActiveWorkspace?.systemKind ?? activeWorkspaceSystemKind;

	const activeWorkspaceSidebarPath = React.useMemo(() => {
		const workspaceLabel = resolvedActiveWorkspaceName || t('workspace.unnamed');
		if (resolvedActiveWorkspaceSystemKind === 'SHARED_WITH_ME' && activeSharedFolder) {
			return `${workspaceLabel} / ${activeSharedFolder}`;
		}
		return workspaceLabel;
	}, [activeSharedFolder, resolvedActiveWorkspaceName, resolvedActiveWorkspaceSystemKind, t]);

	React.useEffect(() => {
		setNoteGridCollaboratorFilter(null);
		setActiveCollectionId(null);
		setActiveLabelIds([]);
		setActiveReminderFilter('all');
		setActiveSortMode('manual');
		setActiveSortGrouping('none');
	}, [activeSharedFolder, authWorkspaceId, sidebarView]);

	React.useEffect(() => {
		if (authStatus !== 'authed' || !authUserId || !authWorkspaceId) {
			setWorkspaceCollaborators([]);
			setWorkspaceCollaboratorsBusy(false);
			return;
		}
		let cancelled = false;
		const loadWorkspaceCollaborators = async (): Promise<void> => {
			setWorkspaceCollaboratorsBusy(true);
			const noteOrder = await manager.getNoteOrder().catch(() => null);
			if (cancelled) return;
			const localDocIds = noteOrder && noteOrder.length > 0
				? noteOrder.toArray().filter((noteId) => !noteId.startsWith('shared-placement:')).map((noteId) => manager.resolveRoomName(noteId)).filter(Boolean)
				: startupHydration.noteOrderIds.filter((noteId) => !noteId.startsWith('shared-placement:')).map((noteId) => manager.resolveRoomName(noteId)).filter(Boolean);
			const sharedDocIds = activeWorkspaceSharedPlacements.map((placement) => String(placement.roomId || '').trim()).filter(Boolean);
			const docIds = [...new Set([...localDocIds, ...sharedDocIds])];
			if (docIds.length === 0) {
				if (!cancelled) {
					setWorkspaceCollaborators([]);
					setWorkspaceCollaboratorsBusy(false);
				}
				return;
			}
			const cachedSnapshots = await Promise.all(docIds.map((docId) => readCachedNoteShareCollaborators(authUserId, docId).catch(() => null)));
			if (cancelled) return;
			setWorkspaceCollaborators(buildWorkspaceCollaboratorEntries(cachedSnapshots));
			if (authOfflineMode || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
				setWorkspaceCollaboratorsBusy(false);
				return;
			}
			const syncedSnapshots = await Promise.all(docIds.map((docId) => syncNoteShareCollaborators(authUserId, docId, { suppressError: true }).catch(() => null)));
			if (cancelled) return;
			setWorkspaceCollaborators(buildWorkspaceCollaboratorEntries(syncedSnapshots.map((snapshot, index) => snapshot ?? cachedSnapshots[index] ?? null)));
			setWorkspaceCollaboratorsBusy(false);
		};
		void loadWorkspaceCollaborators();
		return () => {
			cancelled = true;
		};
	}, [activeWorkspaceSharedPlacements, authOfflineMode, authStatus, authUserId, authWorkspaceId, collaborationRefreshToken, manager, startupHydration.noteOrderIds]);

	React.useEffect(() => {
		if (!noteGridCollaboratorFilter) return;
		const next = workspaceCollaborators.find((entry) => entry.key === noteGridCollaboratorFilter.key);
		if (!next) return;
		if (
			next.label === noteGridCollaboratorFilter.label &&
			next.email === noteGridCollaboratorFilter.email &&
			next.avatar === noteGridCollaboratorFilter.avatar
		) {
			return;
		}
		setNoteGridCollaboratorFilter({
			key: next.key,
			userId: next.userId,
			label: next.label,
			email: next.email,
			avatar: next.avatar,
		});
	}, [noteGridCollaboratorFilter, workspaceCollaborators]);

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
		const chips: Array<{ key: string; title?: string; value: string; label: string; onClear: () => void; onPrimaryAction?: () => void; primaryAriaLabel?: string }> = [];
		if (noteGridCollaboratorFilter) {
			chips.push({
				key: `collaborator:${noteGridCollaboratorFilter.key}`,
				label: `${t('app.withFilterPrefix')}: ${noteGridCollaboratorFilter.label}`,
				title: `${t('app.withFilterPrefix')}:`,
				value: noteGridCollaboratorFilter.label,
				onClear: () => setNoteGridCollaboratorFilter(null),
			});
		}
		if (activeCollection) {
			const collectionLabel = collectionPathById.get(activeCollection.id) ?? activeCollection.name;
			chips.push({
				key: `collection:${activeCollection.id}`,
				label: `${t('search.collectionPrefix')} ${collectionLabel}`,
				title: t('search.collectionPrefix'),
				value: collectionLabel,
				onClear: () => setActiveCollectionId(null),
			});
		}
		for (const label of activeLabels) {
			chips.push({
				key: `label:${label.id}`,
				label: `${t('search.labelPrefix')} ${label.name}`,
				title: t('search.labelPrefix'),
				value: label.name,
				onClear: () => setActiveLabelIds((current) => current.filter((entry) => entry !== label.id)),
			});
		}
		if (activeReminderFilter !== 'all') {
			const reminderLabels: Record<ReminderFilterMode, string> = {
				all: t('app.sidebarAll'),
				'past-due': t('app.sidebarPastDue'),
				'later-today': t('app.sidebarToday'),
				tomorrow: t('reminders.tomorrow'),
				'next-week': t('app.sidebarNextWeek'),
				'due-soon': t('app.sidebarDueSoon'),
			};
			chips.push({
				key: `reminder:${activeReminderFilter}`,
				label: `${t('app.sidebarReminders')}: ${reminderLabels[activeReminderFilter]}`,
				title: `${t('app.sidebarReminders')}:`,
				value: reminderLabels[activeReminderFilter],
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
				label: `${t('app.sidebarSorting')}: ${sortLabels[activeSortMode]}${sortDirectionSuffix}`,
				title: `${t('app.sidebarSorting')}:`,
				value: `${sortLabels[activeSortMode]}${sortDirectionSuffix}`,
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
				label: `${t('app.sidebarGroupBy')}: ${groupingLabels[activeSortGrouping]}`,
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
		return `${t('app.sidebarNotes')} / ${activeWorkspaceSidebarPath}`;
	}, [activeWorkspaceSidebarPath, sidebarView, t, viewMode]);

	const exitSpecialSidebarView = React.useCallback(() => {
		const current = getOverlaySnapshot();
		replaceActiveOverlaySnapshot({
			...current,
			sidebarView: 'notes',
			isMobileSidebarOpen: false,
			isFabOpen: false,
		});
	}, [getOverlaySnapshot, replaceActiveOverlaySnapshot]);

	const moveNoteWorkspaceOptions = React.useMemo(() => {
		return sidebarWorkspaces.filter((workspace) => workspace.id !== authWorkspaceId && workspace.systemKind !== 'SHARED_WITH_ME' && canEditWorkspaceContent(workspace.role));
	}, [authWorkspaceId, sidebarWorkspaces]);
	const selectedNoteSharedPlacement = React.useMemo(
		() => selectedNoteId ? sharedPlacements.find((placement) => placement.aliasId === selectedNoteId) ?? null : null,
		[selectedNoteId, sharedPlacements]
	);

	const applySharedPlacementMetadataLocally = React.useCallback((placementId: string, patch: { collectionId?: string | null; labelIds?: readonly string[]; updatedAt?: string }) => {
		const applyPatch = (placements: readonly SharedNotePlacement[]): readonly SharedNotePlacement[] => placements.map((placement) => {
			if (placement.id !== placementId) return placement;
			return {
				...placement,
				collectionId: patch.collectionId !== undefined ? patch.collectionId : placement.collectionId,
				labelIds: patch.labelIds !== undefined ? [...patch.labelIds] : placement.labelIds,
				updatedAt: patch.updatedAt ?? new Date().toISOString(),
			};
		});
		setSharedPlacements((current) => applyPatch(current));
		setActiveWorkspaceSharedPlacements((current) => applyPatch(current));
		if (authUserId) {
			void patchCachedSharedNotePlacement(authUserId, placementId, patch).catch(() => undefined);
		}
	}, [authUserId]);

	const saveSharedPlacementMetadata = React.useCallback(async (placement: SharedNotePlacement, patch: { collectionId?: string | null; labelIds?: readonly string[] }): Promise<void> => {
		const previousCollectionId = placement.collectionId;
		const previousLabelIds = [...placement.labelIds];
		const optimisticUpdatedAt = new Date().toISOString();
		applySharedPlacementMetadataLocally(placement.id, {
			collectionId: patch.collectionId !== undefined ? patch.collectionId : placement.collectionId,
			labelIds: patch.labelIds !== undefined ? patch.labelIds : placement.labelIds,
			updatedAt: optimisticUpdatedAt,
		});
		try {
			const result = await updateSharedNotePlacementMetadata({
				placementId: placement.id,
				collectionId: patch.collectionId,
				labelIds: patch.labelIds,
			});
			applySharedPlacementMetadataLocally(result.placement.id, {
				collectionId: result.placement.collectionId,
				labelIds: result.placement.labelIds,
				updatedAt: result.placement.updatedAt,
			});
		} catch (error) {
			applySharedPlacementMetadataLocally(placement.id, {
				collectionId: previousCollectionId,
				labelIds: previousLabelIds,
				updatedAt: placement.updatedAt,
			});
			showBriefDialog(error instanceof Error ? error.message : 'Unable to update shared note metadata.');
		}
	}, [applySharedPlacementMetadataLocally, showBriefDialog]);

	const noteCollectionDoc = React.useMemo(
		() => noteCollectionModalState ? (noteCollectionModalState.doc ?? manager.getDoc(noteCollectionModalState.docId || noteCollectionModalState.noteId)) : null,
		[manager, noteCollectionModalState]
	);
	const noteCollectionPlacement = React.useMemo(
		() => noteCollectionModalState ? sharedPlacements.find((placement) => placement.aliasId === noteCollectionModalState.noteId) ?? null : null,
		[noteCollectionModalState, sharedPlacements]
	);
	const noteLabelsDoc = React.useMemo(
		() => noteLabelsModalState ? (noteLabelsModalState.doc ?? manager.getDoc(noteLabelsModalState.docId || noteLabelsModalState.noteId)) : null,
		[manager, noteLabelsModalState]
	);
	const noteLabelsPlacement = React.useMemo(
		() => noteLabelsModalState ? sharedPlacements.find((placement) => placement.aliasId === noteLabelsModalState.noteId) ?? null : null,
		[noteLabelsModalState, sharedPlacements]
	);
	const noteCollectionMetadata = useEffectiveNoteMetadataSnapshot(noteCollectionDoc, noteCollectionPlacement);
	const noteLabelsMetadata = useEffectiveNoteMetadataSnapshot(noteLabelsDoc, noteLabelsPlacement);
	const selectedNoteMetadata = useEffectiveNoteMetadataSnapshot(editorMode === 'none' && selectedNoteId ? openDoc : null, selectedNoteSharedPlacement);

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
	const handleCreateCollection = React.useCallback((args: { name: string; parentId: string | null }): string | null => {
		if (!collectionsDoc) return;
		return createCollection(collectionsDoc, args)?.id ?? null;
	}, [collectionsDoc]);
	const handleRenameCollection = React.useCallback((collectionId: string, nextName: string): boolean => {
		if (!collectionsDoc) return false;
		return updateCollection(collectionsDoc, collectionId, { name: nextName });
	}, [collectionsDoc]);
	const handleDeleteCollection = React.useCallback((collectionId: string) => {
		if (!collectionsDoc) return;
		deleteCollection(collectionsDoc, collectionId);
		if (noteCollectionPlacement && noteCollectionMetadata.collectionId === collectionId) {
			void saveSharedPlacementMetadata(noteCollectionPlacement, { collectionId: null });
		} else if (noteCollectionDoc && readNoteMetadataState(noteCollectionDoc).collectionId === collectionId) {
			assignNoteToCollection(noteCollectionDoc, null);
		}
		setActiveCollectionId((current) => current === collectionId ? null : current);
	}, [collectionsDoc, noteCollectionDoc, noteCollectionMetadata.collectionId, noteCollectionPlacement, saveSharedPlacementMetadata]);
	const handleCreateLabel = React.useCallback((args: { name: string; color?: string | null }): string | null => {
		if (!labelsDoc) return null;
		return createLabel(labelsDoc, args)?.id ?? null;
	}, [labelsDoc]);
	const handleUpdateLabel = React.useCallback((labelId: string, patch: { name?: string; color?: string | null }): boolean => {
		if (!labelsDoc) return false;
		return updateLabel(labelsDoc, labelId, patch);
	}, [labelsDoc]);
	const handleDeleteLabel = React.useCallback((labelId: string) => {
		if (!labelsDoc) return;
		deleteLabel(labelsDoc, labelId);
		if (noteLabelsPlacement && noteLabelsMetadata.labelIds.includes(labelId)) {
			void saveSharedPlacementMetadata(noteLabelsPlacement, {
				labelIds: noteLabelsMetadata.labelIds.filter((entry) => entry !== labelId),
			});
		} else if (noteLabelsDoc) {
			const current = readNoteMetadataState(noteLabelsDoc).labelIds;
			if (current.includes(labelId)) {
				assignNoteLabels(noteLabelsDoc, current.filter((entry) => entry !== labelId));
			}
		}
		setActiveLabelIds((current) => current.filter((entry) => entry !== labelId));
	}, [labelsDoc, noteLabelsDoc, noteLabelsMetadata.labelIds, noteLabelsPlacement, saveSharedPlacementMetadata]);
	const handleSelectNoteCollection = React.useCallback((collectionId: string | null) => {
		if (noteCollectionPlacement) {
			void saveSharedPlacementMetadata(noteCollectionPlacement, { collectionId });
			return;
		}
		if (!noteCollectionDoc) return;
		assignNoteToCollection(noteCollectionDoc, collectionId);
	}, [noteCollectionDoc, noteCollectionPlacement, saveSharedPlacementMetadata]);
	const handleToggleNoteLabel = React.useCallback((labelId: string) => {
		const current = noteLabelsMetadata.labelIds;
		const nextLabelIds = current.includes(labelId)
			? current.filter((entry) => entry !== labelId)
			: [...current, labelId];
		if (noteLabelsPlacement) {
			void saveSharedPlacementMetadata(noteLabelsPlacement, { labelIds: nextLabelIds });
			return;
		}
		if (!noteLabelsDoc) return;
		assignNoteLabels(noteLabelsDoc, nextLabelIds);
	}, [noteLabelsDoc, noteLabelsMetadata.labelIds, noteLabelsPlacement, saveSharedPlacementMetadata]);
	const handleSaveNoteReminder = React.useCallback((reminderAt: string | null) => {
		if (!noteReminderModalState) return;
		const { docId, noteId, title } = noteReminderModalState;
		persistNoteReminderState({
			docId,
			noteId,
			workspaceId: authWorkspaceId ?? '',
			reminderAt,
			noteTitle: title || undefined,
		});
		setNoteReminderModalState(null);
	}, [authWorkspaceId, noteReminderModalState, persistNoteReminderState]);

	React.useEffect(() => {
		if (authStatus !== 'authed' || !authUserId) {
			setNoteReminderByDocId({});
			return;
		}
		const cachedLookup = applyPendingReminderMutations(buildReminderLookup(readCachedReminderStates(authUserId)));
		if (Object.keys(cachedLookup).length > 0) {
			setNoteReminderByDocId(cachedLookup);
		}
		if (authOfflineMode) return;
		let cancelled = false;
		// Reminder filtering now uses the server scheduler state instead of the
		// editor metadata field so every surface sees the same reminder source.
		void fetchNoteReminderStates()
			.then((data) => {
				if (cancelled) return;
				writeCachedReminderStates(authUserId, data.reminders);
				setNoteReminderByDocId((current) => applyServerReminderStates(current, data.reminders));
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [applyPendingReminderMutations, applyServerReminderStates, authOfflineMode, authStatus, authUserId]);

	React.useEffect(() => {
		if (authStatus !== 'authed' || authOfflineMode) return;
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
		void flushPendingReminderMutations();
	}, [authOfflineMode, authStatus, authUserId, flushPendingReminderMutations]);

	React.useEffect(() => {
		if (authStatus !== 'authed' || authOfflineMode || typeof window === 'undefined') return;
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
		if (readPendingReminderMutations().length === 0) return;

		let cancelled = false;
		let timer: ReturnType<typeof window.setTimeout> | null = null;

		const attemptFlush = async (): Promise<void> => {
			if (cancelled) return;
			await flushPendingReminderMutationsRef.current().catch(() => undefined);
			if (cancelled) return;
			if (readPendingReminderMutations().length > 0) {
				timer = window.setTimeout(() => {
					timer = null;
					void attemptFlush();
				}, 5_000);
			}
		};

		void attemptFlush();
		return () => {
			cancelled = true;
			if (timer !== null) window.clearTimeout(timer);
		};
	}, [authOfflineMode, authStatus, authUserId, pendingReminderMutationVersion, readPendingReminderMutations]);

	React.useEffect(() => {
		if (authStatus !== 'authed' || !authWorkspaceId) return;
		let cancelled = false;
		void (async () => {
			const noteOrder = await manager.getNoteOrder().catch(() => null);
			if (cancelled) return;
			const localDocIds = noteOrder && noteOrder.length > 0
				? noteOrder.toArray().filter((noteId) => !noteId.startsWith('shared-placement:')).map((noteId) => manager.resolveRoomName(noteId)).filter(Boolean)
				: startupHydration.noteOrderIds.filter((noteId) => !noteId.startsWith('shared-placement:')).map((noteId) => manager.resolveRoomName(noteId)).filter(Boolean);
			const sharedDocIds = visibleSharedPlacements.map((placement) => String(placement.roomId || '').trim()).filter(Boolean);
			const docIds = [...new Set([...localDocIds, ...sharedDocIds])];
			if (docIds.length === 0) return;
			await warmWorkspaceImageMetadata(docIds, { onlineRefreshLimit: 24, minIntervalMs: 1500 });
		})();
		return () => {
			cancelled = true;
		};
	}, [authStatus, authWorkspaceId, manager, startupHydration.noteOrderIds, visibleSharedPlacements]);

	const sharedWithMeWorkspaceId = React.useMemo(() => {
		const sharedWorkspace = sidebarWorkspaces.find((workspace) => workspace.systemKind === 'SHARED_WITH_ME');
		return sharedWorkspace?.id ?? null;
	}, [sidebarWorkspaces]);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		if (authStatus !== 'authed' || splashGone || gridReady) return;
		if (!authWorkspaceId && sidebarWorkspacesBusy) return;
		const fallbackDelayMs = hasWarmStartupCache ? 2200 : 4200;
		const timerId = window.setTimeout(() => {
			void logClientEvent('APP_SPLASH_FALLBACK_DISMISS', {
				hasWarmStartupCache,
				authWorkspaceId,
				sidebarWorkspacesCount: sidebarWorkspaces.length,
				sidebarWorkspacesBusy,
				sharedWithMeWorkspaceId,
				activeWorkspaceSystemKind,
				isMobileViewport,
			});
			setGridReady(true);
			if (splashGoneRef.current) return;
			clearTimeout(splashTimerRef.current);
			splashTimerRef.current = window.setTimeout(() => setSplashGone(true), 500);
		}, fallbackDelayMs);
		return () => {
			window.clearTimeout(timerId);
		};
	}, [
		activeWorkspaceSystemKind,
		authStatus,
		authWorkspaceId,
		gridReady,
		hasWarmStartupCache,
		isMobileViewport,
		sharedWithMeWorkspaceId,
		sidebarWorkspaces.length,
		sidebarWorkspacesBusy,
		splashGone,
	]);

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
				writeWorkspaceListLocalCache(authUserId, merged.workspaces);
			} else {
				setSidebarWorkspaces(next);
				writeWorkspaceListLocalCache(authUserId ?? '', next);
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
			setActiveWorkspaceSharedPlacements([]);
			setFailedLinkNotifications([]);
			setPendingShareNotificationCount(0);
			setPendingReminderNotificationCount(0);
			setFiredReminders([]);
			return;
		}
		const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
		if (authUserId) {
			// Seed from IndexedDB first so Shared With Me behaves like the rest of the
			// offline-first workspace shell, then let the network refresh replace it.
			const [cachedAllPlacements, cachedActivePlacements] = await Promise.all([
				readCachedSharedNotePlacements(authUserId).catch(() => [] as SharedNotePlacement[]),
				authWorkspaceId
					? readCachedSharedNotePlacementsForWorkspace(authUserId, authWorkspaceId).catch(() => [] as SharedNotePlacement[])
					: Promise.resolve([] as SharedNotePlacement[]),
			]);
			setSharedPlacements(cachedAllPlacements);
			setActiveWorkspaceSharedPlacements(cachedActivePlacements);
			manager.setExternalRoomAliases(mergeExternalRoomAliases(cachedAllPlacements));
		}
		const lastKnownSharedPlacements = sharedPlacementsRef.current;
		const lastKnownActiveWorkspacePlacements = activeWorkspaceSharedPlacementsRef.current;
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
				listNoteShareInvitations().catch(() => ({ invitations: [], pendingCount: 0 })),
				authWorkspaceId ? listSharedNotePlacements(authWorkspaceId).catch(() => ({ placements: [] })) : Promise.resolve({ placements: [] }),
				listWorkspacePendingInvites().catch(() => ({ invites: [] })),
				listFailedNoteLinks().catch(() => ({ failures: [], count: 0 })),
				fetchPendingReminderCount().catch(() => 0),
				fetchFiredReminders().catch(() => ({ reminders: [] })),
			]);

			// The primary placement fetch above only queries the active workspace.
			// When the user is in Bubble View, notes from non-active SHARED_WITH_ME
			// workspaces can also appear as bubbles.  Without their placements being
			// loaded here, clicking those bubbles falls back to an incorrect Yjs room
			// name (workspaceId:noteId instead of the real shared docId), which means
			// the WebSocket connects to the wrong room and the note never hydrates.
			// Each SHARED_WITH_ME workspace may have its own set of placements and
			// sub-folders, so we fetch them all and merge into a single flat list.
			// sidebarWorkspacesRef may still be empty when this runs for the first time on
			// an offline load — the loadSidebarWorkspaces effect runs concurrently and may
			// not have updated the ref yet.  Fall back to the persisted IDB workspace
			// cache so the SHARED_WITH_ME placements are still fetched.
			let sharedWithMeWsIds = sidebarWorkspacesRef.current
				.filter((ws) => ws.systemKind === 'SHARED_WITH_ME' && ws.id !== authWorkspaceId)
				.map((ws) => ws.id);
			if (sharedWithMeWsIds.length === 0 && authUserId) {
				const cachedSnapshot = await readCachedWorkspaceSnapshot(authUserId, deviceId);
				sharedWithMeWsIds = cachedSnapshot.workspaces
					.filter((ws) => ws.systemKind === 'SHARED_WITH_ME' && ws.id !== authWorkspaceId)
					.map((ws) => ws.id);
			}
			const extraPlacementEntries = sharedWithMeWsIds.length > 0
				? await Promise.all(sharedWithMeWsIds.map(async (id) => ({
					workspaceId: id,
					placements: (await listSharedNotePlacements(id).catch(() => ({ placements: [] as SharedNotePlacement[] }))).placements,
				})))
				: [];
			const extraPlacementsResults: SharedNotePlacement[] = extraPlacementEntries.flatMap((entry) => entry.placements);
			const fetchedAllPlacements: SharedNotePlacement[] = [...placementData.placements, ...extraPlacementsResults];
			const resolvedAllPlacements = offline && fetchedAllPlacements.length === 0 && lastKnownSharedPlacements.length > 0
				? lastKnownSharedPlacements
				: fetchedAllPlacements;
			const resolvedActiveWorkspacePlacements = offline && placementData.placements.length === 0 && lastKnownActiveWorkspacePlacements.length > 0
				? lastKnownActiveWorkspacePlacements
				: placementData.placements;

			// Filter out failures the user has already dismissed so they don't
			// re-appear on every metadata event refresh.
			const dismissedIds = dismissedFailedLinkIdsRef.current;
			const filteredFailures = dismissedIds.size > 0
				? failedLinkData.failures.filter((f) => !dismissedIds.has(f.id))
				: failedLinkData.failures;
			const dismissedCount = failedLinkData.failures.length - filteredFailures.length;
			setFailedLinkNotifications(filteredFailures);
			setPendingShareNotificationCount(invitationData.pendingCount + workspaceInviteData.invites.length + failedLinkData.count - dismissedCount);
			setPendingReminderNotificationCount(pendingReminderCount);
			setFiredReminders(firedRemindersData.reminders);
			// Store ALL placements (active workspace + every other SHARED_WITH_ME workspace)
			// so that lookups and alias registration work for bubbles from any workspace.
			// visibleSharedPlacements filters what the NoteGrid actually displays.
			setSharedPlacements(resolvedAllPlacements);
			setActiveWorkspaceSharedPlacements(resolvedActiveWorkspacePlacements);
			manager.setExternalRoomAliases(mergeExternalRoomAliases(resolvedAllPlacements));
			if (authUserId) {
				const workspacePlacementWrites: Promise<void>[] = [];
				if (authWorkspaceId) {
					workspacePlacementWrites.push(cacheSharedNotePlacements(authUserId, authWorkspaceId, placementData.placements));
				}
				for (const entry of extraPlacementEntries) {
					workspacePlacementWrites.push(cacheSharedNotePlacements(authUserId, entry.workspaceId, entry.placements));
				}
				await Promise.all(workspacePlacementWrites).catch(() => undefined);
			}
		} catch {
			if (!offline) {
				setSharedPlacements([]);
				setActiveWorkspaceSharedPlacements([]);
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
	// ── DEBUG: rate-tracking refs for collaboration token bumps ──
	const collabBumpDebugRef = React.useRef<{ count: number; windowStart: number }>({ count: 0, windowStart: Date.now() });
	// ── DEBUG: rate-tracking ref for WS metadata messages ──
	const wsMetaMsgDebugRef = React.useRef<{ count: number; windowStart: number; lastTypes: string[] }>({ count: 0, windowStart: Date.now(), lastTypes: [] });
	const bumpCollaborationRefreshToken = React.useCallback(() => {
		if (process.env.NODE_ENV !== 'production') {
			const now = Date.now();
			const debug = collabBumpDebugRef.current;
			if (now - debug.windowStart > 2000) {
				if (debug.count > 3) {
					console.warn(`[collab-debug] bumpCollaborationRefreshToken called ${debug.count}x in last 2 s — possible rapid loop`);
				}
				debug.count = 0;
				debug.windowStart = now;
			}
			debug.count++;
		}
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
		// sharedPlacements holds ALL placements so this covers every SHARED_WITH_ME workspace.
		manager.setExternalRoomAliases(mergeExternalRoomAliases(sharedPlacements));
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
		let collaborationRefreshTimer: number | null = null;
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
				// Do NOT call bumpCollaborationRefreshToken() here — workspace-level events
				// (invite accepted/created/cancelled, workspace deleted, etc.) do not change
				// per-note collaborator data.  Bumping here causes NoteGrid to re-sync every
				// visible note on every WS metadata event, generating hundreds of DB queries.
				// Note-share collaborator bumps are handled by the isNoteShareMetadataEvent
				// and isUserProfileMetadataEvent branches that already call bumpCollaborationRefreshToken.
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
					// ── DEBUG: rate-track incoming metadata WS messages ──
					if (process.env.NODE_ENV !== 'production') {
						const now = Date.now();
						const wd = wsMetaMsgDebugRef.current;
						if (now - wd.windowStart > 2000) {
							if (wd.count > 10) {
								console.warn(`[ws-meta-debug] ${wd.count} metadata messages in 2 s — possible rapid event loop. Types: ${wd.lastTypes.slice(-8).join(', ')}`);
							}
							wd.count = 0;
							wd.windowStart = now;
							wd.lastTypes = [];
						}
						wd.count++;
						const label = `${payload.type ?? '?'}/${payload.reason ?? '?'}`;
						if (wd.lastTypes.length < 20) wd.lastTypes.push(label);
					}
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
							typeof window.dispatchEvent === 'function'
						) {
							window.dispatchEvent(
								new CustomEvent(getWorkspaceMetadataChangedEventName(), {
									detail: payload,
								})
							);
						}
						if (
							payload.type === 'workspace-metadata-changed' &&
							typeof payload.workspaceId === 'string' &&
							typeof window.dispatchEvent === 'function'
						) {
							window.dispatchEvent(
								new CustomEvent(getWorkspaceInviteStateEventName(), {
									detail: { workspaceId: payload.workspaceId, source: 'remote', reason: payload.reason },
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
							!isNoteLinksMetadataEvent &&
							!isNoteShareMetadataEvent
						) {
							// Non-share per-doc event: update this note's collaborator cache directly.
							void syncNoteShareCollaborators(authUserId, payload.docId, { suppressError: true });
						}
						if (isNoteShareMetadataEvent) {
							// Debounce BOTH the share-state refresh and the full-grid token
							// bump together so that a burst of N note-share events (e.g.
							// bulk invitation sends or workspace-acceptance echoes) produces
							// ONE pair of calls instead of N×refreshNoteShareState + 1 bump.
							if (collaborationRefreshTimer !== null) window.clearTimeout(collaborationRefreshTimer);
							collaborationRefreshTimer = window.setTimeout(() => {
								collaborationRefreshTimer = null;
								void refreshNoteShareStateRef.current();
								bumpCollaborationRefreshToken();
							}, 300);
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
						if (payload.type === 'workspace-metadata-changed' && payload.reason === 'reminder-state-changed') {
							if (!authUserId || authOfflineMode) return;
							void fetchNoteReminderStates()
								.then((data) => {
									writeCachedReminderStates(authUserId, data.reminders);
									setNoteReminderByDocId((current) => applyServerReminderStates(current, data.reminders));
								})
								.catch(() => undefined);
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
						if (payload.type === 'workspace-metadata-changed' && payload.reason === 'user-preferences-changed') {
							// Another session changed a user-scoped preference (e.g. bubble colors or note colors).
							void fetchUserPreferences(deviceId).then((pref) => {
								if (pref) {
									replaceCollapsedRichHeadingPrefs(pref.collapsedRichHeadingIds || {});
									replaceUserNoteColorPrefs(pref.noteColorsByNoteId || {});
									replaceUserNoteBannerPrefs(pref.noteBannersByNoteId || {});
									replaceUserNotePinPrefs(pref.notePinsByDocId || {});
									setBubbleWorkspaceColorOverrides(pref.bubbleWorkspaceColors || {});
								}
							});
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
			if (collaborationRefreshTimer !== null) {
				window.clearTimeout(collaborationRefreshTimer);
				collaborationRefreshTimer = null;
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

			// ── Offline-first: always switch locally first ──────────────────────
			// Disable WS before switching so the manager doesn't open rooms
			// against the old server session (which still points at the previous
			// workspace and would reject the new namespace with "forbidden").
			manager.setWebsocketEnabled(false);
			handleWorkspaceActivated(workspaceId);
			void persistSharedWorkspaceSelection(workspaceId, nextSharedFolder);
			if (isMobileViewport) {
				closeWorkspaceSidebarGroup();
				closeMobileSidebar();
			}

			// ── Background: activate on server then re-enable WS ───────────────
			if (authOfflineMode || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
				// Genuinely offline — nothing more to do; WS stays disabled.
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
				// Re-enable WS now that the server session points at the new workspace.
				manager.setWebsocketEnabled(true);
				void loadSidebarWorkspacesRef.current();
			} catch {
				// Network failed or server rejected — keep WS disabled (offline-like
				// for this workspace) so the user can still browse IDB data.
			}
		},
		[authOfflineMode, authStatus, authWorkspaceId, closeMobileSidebar, closeWorkspaceSidebarGroup, confirmActivatedWorkspaceSession, deviceId, handleWorkspaceActivated, isMobileViewport, manager, persistSharedWorkspaceSelection]
	);

	const handleBubbleNoteSelect = React.useCallback(async (noteId: string, workspaceId: string): Promise<void> => {
		if (workspaceId !== authWorkspaceId) {
			// Open a standalone cross-workspace viewer instead of switching the
			// active workspace. Route it through the shared overlay history stack
			// so Android Back dismisses the note before it reaches the app-exit guard.
			const targetWorkspace = sidebarWorkspaces.find((ws) => ws.id === workspaceId) ?? null;
			const workspaceName = targetWorkspace ? getWorkspaceDisplayName(targetWorkspace, t) : workspaceId;
			const current = getOverlaySnapshot();
			commitOverlaySnapshot(
				{
					...current,
					crossWorkspaceNote: { noteId, workspaceId, workspaceName },
					isMobileSidebarOpen: false,
					isFabOpen: false,
				},
				'push'
			);
			return;
		}
		// Same workspace — normal editor open flow.
		const targetWorkspace = sidebarWorkspaces.find((ws) => ws.id === workspaceId) ?? null;
		if (noteId.startsWith('shared-placement:') || targetWorkspace?.systemKind === 'SHARED_WITH_ME') {
			await refreshNoteShareStateRef.current();
		}
		try {
			await manager.getDocWithSync(noteId);
		} catch {
			// Fall back to the normal loading state if preloading cannot complete yet.
		}
		openNoteEditor(noteId, { replaceTop: editorMode !== 'none' });
	}, [authWorkspaceId, commitOverlaySnapshot, editorMode, getOverlaySnapshot, manager, openNoteEditor, sidebarWorkspaces, t]);

	const closeCrossWorkspaceNote = React.useCallback(() => {
		if (goBackIfOverlayHistory()) return;
		setCrossWorkspaceNote(null);
	}, [goBackIfOverlayHistory]);

	/** Persist a new color token for a workspace's bubble color and sync to server. */
	const handleBubbleWorkspaceColorChange = React.useCallback((workspaceId: string, token: string) => {
		// Build next outside the state setter to avoid React StrictMode double-invoke side-effects.
		const next = { ...bubbleWorkspaceColorOverrides, [workspaceId]: token };
		setBubbleWorkspaceColorOverrides(next);
		setBubbleColorPickerWorkspaceId(null);
		setBubbleColorPickerAnchorRect(null);
		// Queue the update then flush immediately — bypasses the 1-second debounce so
		// the save goes out before the user can navigate away or refresh the page.
		void updateUserPreferences(deviceId, { bubbleWorkspaceColors: next });
		void flushUserPreferences(deviceId);
	}, [bubbleWorkspaceColorOverrides, deviceId]);

	// Close the bubble color picker when the user clicks or taps outside it.
	React.useEffect(() => {
		if (!bubbleColorPickerWorkspaceId) return;
		const close = (e: MouseEvent | TouchEvent): void => {
			// Skip closing when the interaction is inside the picker itself.
			if (bubbleColorPickerRef.current?.contains(e.target as Node)) return;
			setBubbleColorPickerWorkspaceId(null);
			setBubbleColorPickerAnchorRect(null);
		};
		window.addEventListener('mousedown', close, true);
		window.addEventListener('touchstart', close, true);
		return () => {
			window.removeEventListener('mousedown', close, true);
			window.removeEventListener('touchstart', close, true);
		};
	}, [bubbleColorPickerWorkspaceId]);

	const openCreateEditorForCurrentContext = React.useCallback(
		async (mode: 'text' | 'checklist' | 'drawing', opts?: { replaceTop?: boolean }) => {
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

			// Create the real note doc up front so the compose session has the same
			// feature surface as editing an existing note, including media,
			// collaborators, and metadata assignment while the note is still
			// effectively a draft. Keep the draft out of registry/noteOrder until
			// Save so other devices never render an empty unsaved note.
			const noteId = makeNoteId(
				mode === 'checklist'
					? 'checklist-note'
					: mode === 'drawing'
						? 'drawing-note'
						: 'text-note'
			);
			// Mark as draft BEFORE any async IDB/network operations so NoteGrid/BubbleView
			// never render the note during the creation window (avoids a brief flash and
			// the 403 API calls that follow from attachment chips being mounted).
			pendingNewNoteIdsRef.current.add(noteId);
			markPendingNewNotesChanged();
			setDraftNoteId(noteId);
			const doc = await manager.getDocWithSync(noteId);
			if (mode === 'checklist') {
				initChecklistNoteDoc(doc, '', [], []);
			} else if (mode === 'drawing') {
				initDrawingNoteDoc(doc, '');
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
			openNoteEditor(noteId, opts);
		},
		[activateWorkspaceFromSidebar, activeCollection, activeCollectionId, authWorkspaceId, bubbleSelectedWorkspace, canEditActiveWorkspace, collectionPathById, manager, markPendingNewNotesChanged, openNoteEditor, showBriefDialog, sidebarView, t, viewMode]
	);

	const handleAcceptedSharedPlacement = React.useCallback(async (args: { target: 'personal' | 'shared'; targetWorkspaceId: string; folderName: string | null }) => {
		// Accepting into Shared With Me can require a workspace switch plus a sidebar
		// reveal. We stage the reveal first, then let the activation path complete and
		// the follow-up effect expands the correct folder once placements are loaded.
		setIsShareNotificationsOpen(false);
		if (args.target === 'shared') {
			if (!args.targetWorkspaceId) return;
			setPendingSharedFolderReveal({
				workspaceId: args.targetWorkspaceId,
				folderName: args.folderName,
			});
			if (args.targetWorkspaceId !== authWorkspaceId) {
				await activateWorkspaceFromSidebar(args.targetWorkspaceId, { activeSharedFolder: args.folderName });
			}
		} else {
			// Personal workspace acceptance: switch workspace if needed, then refresh
			// placements so the newly accepted note appears in the grid.
			if (args.targetWorkspaceId && args.targetWorkspaceId !== authWorkspaceId) {
				await activateWorkspaceFromSidebar(args.targetWorkspaceId, { activeSharedFolder: null });
			} else {
				await refreshNoteShareStateRef.current();
			}
			// The server may not have committed the collaborator permission in its
			// WS session store by the time the new room's provider first connects.
			// A brief delay reconnect gives the server time to propagate the
			// acceptance, reducing the note content delay from ~30 s (resync timer)
			// to ~1.5 s.
			window.setTimeout(() => {
				manager.reconnectAllProviders('post-acceptance');
			}, 1500);
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

	React.useEffect(() => {
		const nextInvite = readRegistrationInviteFromUrl();
		setRegistrationInviteToken(nextInvite.token);
		setRegistrationInviteEmail(nextInvite.email ?? '');
		if (!nextInvite.token) return;
		// Deep-linked admin invites should open directly into register mode with the
		// invited email already staged for the user.
		setAuthMode('register');
		if (nextInvite.email) {
			setAuthEmail(nextInvite.email);
		}
		setAuthError(null);
	}, []);

	const clearPasswordResetTokenFromUrl = React.useCallback((): void => {
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		if (!url.searchParams.has('resetPassword')) return;
		url.searchParams.delete('resetPassword');
		window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
		setPasswordResetToken(null);
	}, []);

	const clearRegistrationInviteFromUrl = React.useCallback((): void => {
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		if (!url.searchParams.has('registerInvite') && !url.searchParams.has('inviteEmail')) return;
		url.searchParams.delete('registerInvite');
		url.searchParams.delete('inviteEmail');
		window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
		setRegistrationInviteToken(null);
		setRegistrationInviteEmail('');
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
			let resolvedUserRole: GlobalUserRole | null = null;
			let resolvedProfileImage: string | null = null;
			let sessionEstablished = false;
			const payload: any = {
				email: authEmail,
				password: authPassword,
			};
			if (authMode === 'register') payload.name = authName;
			if (authMode === 'register' && registrationInviteToken) payload.inviteToken = registrationInviteToken;

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
			const authUserRoleFromResponse = authBody?.user?.role ? normalizeGlobalUserRole(authBody.user.role) : null;
			const authProfileImageFromResponse = authBody?.user?.profileImage ? String(authBody.user.profileImage) : null;
			resolvedUserId = authUserId;
			resolvedWorkspaceId = authWorkspaceId;
			resolvedUserRole = authUserRoleFromResponse;
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
					const role = meBody?.user?.role ? normalizeGlobalUserRole(meBody.user.role) : null;
					const profileImage = meBody?.user?.profileImage ? String(meBody.user.profileImage) : null;
					const workspaceId = meBody?.workspaceId ? String(meBody.workspaceId) : null;
					if (userId) {
						resolvedUserId = userId;
						resolvedWorkspaceId = workspaceId;
						resolvedUserRole = role;
						resolvedProfileImage = profileImage;
						sessionEstablished = true;
					}
				}
			} catch {
				// ignore
			}

			if (!sessionEstablished || !resolvedUserId) {
				setAuthUserId(null);
				setAuthUserRole(null);
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

			await primeAuthenticatedThemeBeforeWorkspaceLoad(resolvedUserId);
			setAuthUserId(resolvedUserId);
			setAuthUserRole(resolvedUserRole);
			setAuthProfileImage(resolvedProfileImage);
			setAuthWorkspaceId(resolvedWorkspaceId);
			setAuthStatus('authed');
			setAuthOfflineMode(false);
			manager.setActiveWorkspaceId(resolvedWorkspaceId);
			writeAuthCache({ v: 1, userId: resolvedUserId, workspaceId: resolvedWorkspaceId, profileImage: resolvedProfileImage, role: resolvedUserRole });
			writeWorkspaceSelectionCache({ userId: resolvedUserId, workspaceId: resolvedWorkspaceId });
			if (authMode === 'register' && registrationInviteToken) {
				clearRegistrationInviteFromUrl();
			}
			manager.setWebsocketEnabled(Boolean(resolvedWorkspaceId));
		} catch {
			setAuthError('Authentication failed');
			setAuthStatus('unauth');
			setAuthUserRole(null);
			manager.setWebsocketEnabled(false);
		} finally {
			setAuthBusy(false);
		}
	}, [authBusy, authEmail, authMode, authName, authPassword, authPasswordConfirm, authPasswordStrengthScore, clearRegistrationInviteFromUrl, deviceId, manager, primeAuthenticatedThemeBeforeWorkspaceLoad, registerAvatarAreaPixels, registerAvatarUrl, registrationInviteToken, showBriefDialog, t]);

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
						role: authUserRole,
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
		[authStatus, authUserId, authUserRole, authWorkspaceId, bumpCollaborationRefreshToken, showBriefDialog, t, userModalBusy]
	);

	const authGateSubtitle = externalRoute?.kind === 'invite'
		? t('invite.authPrompt')
		: externalRoute?.kind === 'share'
			? 'Sign in to open this shared item.'
			: authStatus === 'loading'
				? 'Checking session…'
				: null;

	const authGateView = (
		<div className="auth-shell">
			<div className="auth-card">
				<div className="auth-title">Freeman Notes</div>
				{authGateSubtitle ? <div className="auth-subtitle">{authGateSubtitle}</div> : null}
				{externalRoute?.kind === 'invite' ? <div className="auth-hint">{t('invite.emailMatchNotice')}</div> : null}
				{externalRoute?.kind === 'share' ? <div className="auth-hint">Share links require an authenticated account before access is applied.</div> : null}
				{registrationInviteToken ? <div className="auth-hint">{t('adminInvite.authHint')}</div> : null}
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
							readOnly={Boolean(registrationInviteToken && registrationInviteEmail)}
							required
						/>
					</label>
					{registrationInviteToken && registrationInviteEmail ? <div className="auth-hint">{t('adminInvite.emailLockedNotice')}</div> : null}
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
					{authMode === 'login' ? (
						<button
							type="button"
							className="auth-secondary-button auth-form-secondary-button"
							onClick={() => {
								// Keep registration reachable without the old top toggle while
								// preserving the same underlying auth mode/state transitions.
								setAuthMode('register');
								setAuthPasswordConfirm('');
								setAuthError(null);
							}}
							disabled={authBusy || authStatus === 'loading'}
						>
							Register
						</button>
					) : (
						<button
							type="button"
							className="auth-secondary-button auth-form-secondary-button"
							onClick={() => {
								setAuthMode('login');
								setAuthPasswordConfirm('');
								setAuthError(null);
							}}
							disabled={authBusy || authStatus === 'loading'}
						>
							Back to sign in
						</button>
					)}
				</form>
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
							<form onSubmit={(e) => e.preventDefault()}>
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
							</form>
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
		return isLightTheme(themeId) ? FAB_LIGHT_ICON_SRC : FAB_DARK_ICON_SRC;
	}, [themeId]);
	const isIosStandalonePwa = isMobileViewport && detectIosStandaloneDisplayMode();
	const isAndroidStandalonePwa = isMobileViewport && detectAndroidStandaloneDisplayMode();

	// Keep the FAB trigger, action stack, and backdrop in one overlay block so
	// iOS standalone scrolling cannot split their stacking or anchoring contexts.
	const mobileFabOverlay = React.useMemo(() => {
		if (!showMobileFab) return null;
		const fabButton = (
			<button
				type="button"
				className={`mobile-fab${isFabOpen ? ' is-open' : ''}`}
				onClick={toggleFab}
				aria-label={isFabOpen ? t('app.closeQuickCreate') : t('app.openQuickCreate')}
				title={isFabOpen ? t('app.closeQuickCreate') : t('app.openQuickCreate')}
			>
				<img
					aria-hidden="true"
					className="mobile-fab-icon"
					src={fabIconSrc}
					alt=""
				/>
			</button>
		);
		const fabStack = (
			<div className={`mobile-fab-stack${isFabOpen ? ' is-open' : ''}`}>
				<button
					type="button"
					className="mobile-fab-action"
					onClick={() => {
						replaceActiveOverlaySnapshot({
							...getOverlaySnapshot(),
							isFabOpen: false,
						});
						setIsQuickReminderOpen(true);
					}}
				>
					<FontAwesomeIcon icon={faBell} />
					{t('app.createQuickReminder')}
				</button>
				<button
					type="button"
					className="mobile-fab-action"
					onClick={() => {
						void openCreateEditorForCurrentContext('text', { replaceTop: true });
					}}
				>
					<FontAwesomeIcon icon={faFileLines} />
					{t('app.createNote')}
				</button>
				<button
					type="button"
					className="mobile-fab-action"
					onClick={() => {
						void openCreateEditorForCurrentContext('checklist', { replaceTop: true });
					}}
				>
					<FontAwesomeIcon icon={faListCheck} />
					{t('app.createChecklist')}
				</button>
				<button
					type="button"
					className="mobile-fab-action"
					onClick={() => {
						void openCreateEditorForCurrentContext('drawing', { replaceTop: true });
					}}
				>
					<FontAwesomeIcon icon={faPenNib} />
					{t('app.createDrawing')}
				</button>
			</div>
		);
		const content = (
			<>
				{isFabOpen ? (
					<button
						type="button"
						className="mobile-fab-backdrop"
						onPointerUp={(event) => closeBackdropFromPointerEvent(event, toggleFab)}
						onClick={(event) => {
							if (event.defaultPrevented) return;
							toggleFab();
						}}
						aria-label={t('app.closeQuickCreate')}
					/>
				) : null}
				{fabStack}
				{fabButton}
			</>
		);
		return content;
	}, [fabIconSrc, getOverlaySnapshot, isFabOpen, openCreateEditorForCurrentContext, replaceActiveOverlaySnapshot, showMobileFab, t, toggleFab]);

	const headerIconSrc = React.useMemo(() => {
		return isLightTheme(themeId) ? APP_HEADER_LIGHT_ICON_SRC : APP_HEADER_DARK_ICON_SRC;
	}, [themeId]);

	// Debounce the header "connecting" state so brief workspace-switch
	// reconnects (WS providers torn down and rebuilt) don't flash a loading
	// indicator for the ~100-300 ms it takes to set up the new providers.
	// Only "offline" and "connected" transitions are applied immediately.
	const [headerConnectionState, setHeaderConnectionState] = React.useState<typeof connection.state>(connection.state);
	const headerConnectingTimerRef = React.useRef<number | null>(null);
	React.useEffect(() => {
		if (connection.state !== 'connecting') {
			if (headerConnectingTimerRef.current !== null) {
				clearTimeout(headerConnectingTimerRef.current);
				headerConnectingTimerRef.current = null;
			}
			setHeaderConnectionState(connection.state);
			return;
		}
		// Defer displaying "connecting" by 600 ms — fast workspace switches complete
		// before the timer fires so the header never flickers to loading.
		if (headerConnectingTimerRef.current !== null) return;
		headerConnectingTimerRef.current = window.setTimeout(() => {
			headerConnectingTimerRef.current = null;
			setHeaderConnectionState('connecting');
		}, 600);
	}, [connection.state]);

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
		color?: string | null;
		avatar?: string | null;
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
			{ id: 'collaborators', label: t('prefs.collaborators'), icon: faShareNodes, kind: 'group' },
			{ id: 'sorting', label: t('app.sidebarSorting'), icon: faArrowDownWideShort, kind: 'group' },
			{ id: 'reminders', label: t('app.sidebarReminders'), icon: faBell, kind: 'group' },
			{ id: 'images', label: t('app.sidebarImages'), icon: faImage, kind: 'link' },
			{ id: 'trash', label: t('app.sidebarTrash'), icon: faTrash, kind: 'link' },
		].filter((entry) => {
			if (viewMode !== 'bubble') return true;
			return entry.id !== 'collections'
				&& entry.id !== 'labels'
				&& entry.id !== 'collaborators'
				&& entry.id !== 'sorting'
				&& entry.id !== 'images'
				&& entry.id !== 'trash';
		}),
		[sidebarView, t, viewMode]
	);
	const sidebarUsesBubbleSummaryMenus = viewMode === 'bubble';
	const filterSidebarView = sidebarView === 'images' ? 'images' : 'notes';

	const bubbleWorkspaceLegend = React.useMemo(() => {
		return sidebarWorkspacesSorted.map((workspace) => ({
			id: workspace.id,
			name: getWorkspaceDisplayName(workspace, t),
			isActive: workspace.id === (viewMode === 'bubble' ? (bubbleWorkspaceSelectionId || authWorkspaceId) : authWorkspaceId),
			style: toWorkspaceBubbleColorStyle(getWorkspaceBubbleColorSchemeOverridden(themeId, workspace.id, bubbleWorkspaceColorOverrides)),
		}));
	}, [authWorkspaceId, bubbleWorkspaceColorOverrides, bubbleWorkspaceSelectionId, sidebarWorkspacesSorted, t, themeId, viewMode]);

	const clearReminderSidebarFilter = React.useCallback(() => {
		setActiveReminderFilter('all');
	}, []);

	const clearSidebarSortMode = React.useCallback(() => {
		setActiveSortMode('manual');
	}, []);

	const clearSidebarGrouping = React.useCallback(() => {
		setActiveSortGrouping('none');
	}, []);

	const clearSidebarFilters = React.useCallback(() => {
		setActiveReminderFilter((current) => (isSidebarFilterReminderMode(current) ? 'all' : current));
		setActiveSortMode((current) => (isSidebarFilterSortMode(current) ? 'manual' : current));
	}, []);

	const applyReminderSidebarFilter = React.useCallback((mode: ReminderFilterMode) => {
		setSidebarView(filterSidebarView);
		setActiveReminderFilter(mode);
		if (isSidebarFilterReminderMode(mode)) {
			setActiveSortMode((current) => (isSidebarFilterSortMode(current) ? 'manual' : current));
		}
		if (isMobileViewport) closeMobileSidebar();
	}, [closeMobileSidebar, filterSidebarView, isMobileViewport]);

	const applySidebarFilterSelection = React.useCallback((mode: SidebarFilterReminderMode | SidebarFilterSortMode) => {
		setSidebarView(filterSidebarView);
		if (isSidebarFilterReminderMode(mode)) {
			setActiveReminderFilter(mode);
			setActiveSortMode((current) => (isSidebarFilterSortMode(current) ? 'manual' : current));
		} else {
			setActiveSortMode(mode);
			setActiveReminderFilter((current) => (isSidebarFilterReminderMode(current) ? 'all' : current));
		}
		if (isMobileViewport) closeMobileSidebar();
	}, [closeMobileSidebar, filterSidebarView, isMobileViewport]);

	const activeSidebarFilterItem = React.useMemo<SidebarFilterReminderMode | SidebarFilterSortMode | null>(() => {
		if (isSidebarFilterReminderMode(activeReminderFilter)) return activeReminderFilter;
		if (isSidebarFilterSortMode(activeSortMode)) return activeSortMode;
		return null;
	}, [activeReminderFilter, activeSortMode]);

	const sidebarGroupContent = React.useMemo<Record<string, SidebarSubmenuNode[]>>(
		() => ({
			reminders: [
				{ id: 'past-due', label: t('app.sidebarPastDue'), kind: 'item' },
				{ id: 'later-today', label: t('app.sidebarToday'), kind: 'item' },
				{ id: 'tomorrow', label: t('reminders.tomorrow'), kind: 'item' },
				{ id: 'next-week', label: t('app.sidebarNextWeek'), kind: 'item' },
				{ id: 'clear-reminders', label: t('app.sidebarClearReminders'), kind: 'action' },
			],
			labels: sidebarUsesBubbleSummaryMenus
				? [{ id: 'all-labels', label: 'All Labels', kind: 'muted' }]
				: labels.length > 0
				// Carry label colors through the shared sidebar item model so the
				// dropdown renderer can stay common across groups.
				? labels.map((label) => ({ id: label.id, label: label.name, kind: 'item' as const, color: label.color ?? null }))
				: [{ id: 'no-labels', label: t('app.sidebarNoLabels'), kind: 'muted' }],
			collaborators: workspaceCollaborators.length > 0
				? [
					...workspaceCollaborators.map((collaborator) => ({
						id: collaborator.key,
						label: collaborator.label,
						kind: 'item' as const,
						avatar: collaborator.avatar,
					})),
					...(noteGridCollaboratorFilter ? [{ id: 'clear-collaborator-filter', label: t('app.sidebarClear'), kind: 'action' as const }] : []),
				]
				: [{
					id: workspaceCollaboratorsBusy ? 'loading-collaborators' : 'no-collaborators',
					label: workspaceCollaboratorsBusy ? t('common.loading') : t('share.noneCollaborators'),
					kind: 'muted' as const,
				}],
			collections: sidebarUsesBubbleSummaryMenus ? [{ id: 'all-collections', label: 'All Collections', kind: 'muted' }] : [],
		}),
		[labels, noteGridCollaboratorFilter, sidebarUsesBubbleSummaryMenus, t, workspaceCollaborators, workspaceCollaboratorsBusy]
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
				label: t('app.sidebarQuickFilters'),
				items: [
					{ id: 'past-due', label: t('app.sidebarPastDue'), kind: 'item' },
					{ id: 'due-soon', label: t('app.sidebarDueSoon'), kind: 'item' },
					{ id: 'least-accessed', label: t('app.sidebarLeastAccessed'), kind: 'item' },
					{ id: 'most-edited', label: t('app.sidebarMostEdited'), kind: 'item' },
					{ id: 'clear-filters', label: t('app.sidebarClearFilters'), kind: 'action' },
				],
			},
			{
				id: 'sortingGrouping',
				label: t('app.sidebarGroupBy'),
				items: [
					{ id: 'by-week', label: t('app.sidebarByWeek'), kind: 'item' },
					{ id: 'by-month', label: t('app.sidebarByMonth'), kind: 'item' },
					{ id: 'clear-grouping', label: t('app.sidebarClearGrouping'), kind: 'action' },
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
			const collectionPath = collectionPathById.get(collection.id) ?? collection.name;
			const cappedDepth = Math.min(depth, SIDEBAR_COLLECTION_INDENT_CAP);
			const ancestryPrefix = getCompressedSidebarCollectionPrefix(collectionPath, depth);
			const nestedBranchStyle = {
				['--sidebar-collection-branch-margin-left' as const]: depth + 1 <= SIDEBAR_COLLECTION_INDENT_CAP ? '10px' : '0px',
				['--sidebar-collection-branch-padding-left' as const]: depth + 1 <= SIDEBAR_COLLECTION_INDENT_CAP ? '6px' : '0px',
				['--sidebar-collection-branch-border-width' as const]: depth + 1 <= SIDEBAR_COLLECTION_INDENT_CAP ? '1px' : '0px',
			} as React.CSSProperties;
			return (
				<div key={collection.id} className="sidebar-collection-node">
					<div className="sidebar-collection-row" style={{ ['--sidebar-collection-depth' as const]: cappedDepth } as React.CSSProperties}>
						{hasChildren ? (
							<button
								type="button"
								className={`sidebar-collection-disclosure${isExpanded ? ' is-open' : ''}`}
								onClick={(event) => {
									const nextIsExpanded = !Boolean(sidebarGroupsOpen[toggleId]);
									setSidebarGroupsOpen((prev) => ({ ...prev, [toggleId]: nextIsExpanded }));
									if (nextIsExpanded) scrollExpandedCollectionNodeIntoView(event.currentTarget);
								}}
								aria-label={isExpanded ? 'Collapse collection' : 'Expand collection'}
							>
								<span className="sidebar-collection-disclosure-icon" aria-hidden="true" />
							</button>
						) : <span className="sidebar-collection-disclosure-spacer" aria-hidden="true" />}
						<button
							type="button"
							className={`sidebar-submenu-item sidebar-collection-item${activeCollectionId === collection.id ? ' is-active' : ''}${ancestryPrefix ? ' has-ancestry' : ''}`}
							onClick={() => {
								setSidebarView(filterSidebarView);
								setActiveCollectionId((current) => current === collection.id ? null : collection.id);
								if (isMobileViewport) closeMobileSidebar();
							}}
							title={collectionPath}
						>
							<span className={`sidebar-collection-item-copy${ancestryPrefix ? ' has-ancestry' : ''}`}>
								{ancestryPrefix ? (
									<OverflowMarqueeText
										value={ancestryPrefix}
										viewportClassName="sidebar-overflow-label-viewport sidebar-collection-line-viewport"
										trackClassName="sidebar-collection-item-prefix sidebar-overflow-label"
									/>
								) : null}
								<OverflowMarqueeText
									value={collection.name}
									viewportClassName="sidebar-overflow-label-viewport sidebar-collection-line-viewport"
									trackClassName="sidebar-collection-item-label sidebar-overflow-label"
								/>
							</span>
						</button>
					</div>
					{hasChildren ? (
						<div className={`sidebar-nested-submenu-shell${isExpanded ? ' is-open' : ''}`}>
							<div className="sidebar-nested-submenu sidebar-collection-children" style={nestedBranchStyle}>
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
		if (!isMobileViewport || !isMobileSearchOpen || typeof window === 'undefined') return;
		if (isOverlayHistoryState(window.history.state)) return;
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
	}, [commitOverlaySnapshot, getOverlaySnapshot, isMobileSearchOpen, isMobileViewport]);

	React.useEffect(() => {
		if (!isMobileViewport || !isMobileSearchOpen || typeof window === 'undefined' || !window.visualViewport) {
			setMobileSearchViewportOffsetTop(0);
			return;
		}

		const viewport = window.visualViewport;
		let raf = 0;

		const syncViewportOffset = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				const nextOffsetTop = Math.max(0, Math.round(Math.max(viewport.offsetTop, viewport.pageTop - window.scrollY)));
				setMobileSearchViewportOffsetTop((previous) => (Math.abs(previous - nextOffsetTop) <= 1 ? previous : nextOffsetTop));
			});
		};

		syncViewportOffset();
		viewport.addEventListener('resize', syncViewportOffset);
		viewport.addEventListener('scroll', syncViewportOffset);
		window.addEventListener('scroll', syncViewportOffset, { passive: true });

		return () => {
			cancelAnimationFrame(raf);
			viewport.removeEventListener('resize', syncViewportOffset);
			viewport.removeEventListener('scroll', syncViewportOffset);
			window.removeEventListener('scroll', syncViewportOffset);
			setMobileSearchViewportOffsetTop(0);
		};
	}, [isMobileSearchOpen, isMobileViewport]);

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
		// In installed iOS PWAs the document shell can still rubber-band even when
		// the app root is meant to be the only scroll container. Mirror a root class
		// onto html/body so global CSS can fully lock the outer page.
		if (typeof document === 'undefined') return;
		const className = 'ios-standalone-pwa';
		const html = document.documentElement;
		const body = document.body;
		if (!isIosStandalonePwa) {
			html.classList.remove(className);
			body.classList.remove(className);
			return;
		}
		html.classList.add(className);
		body.classList.add(className);
		return () => {
			html.classList.remove(className);
			body.classList.remove(className);
		};
	}, [isIosStandalonePwa]);

	React.useEffect(() => {
		if (typeof document === 'undefined') return;
		const className = 'android-standalone-pwa';
		const html = document.documentElement;
		const body = document.body;
		if (!body) return;
		// Mirror the detection on both html/body so layout and overscroll CSS can key
		// off the same standalone-PWA flag without fighting React render timing.
		if (!isAndroidStandalonePwa) {
			html.classList.remove(className);
			body.classList.remove(className);
			return;
		}
		html.classList.add(className);
		body.classList.add(className);
		return () => {
			html.classList.remove(className);
			body.classList.remove(className);
		};
	}, [isAndroidStandalonePwa]);

	React.useEffect(() => {
		if (typeof document === 'undefined') return;
		const viewportMeta = document.querySelector('meta[name="viewport"]');
		if (!(viewportMeta instanceof HTMLMetaElement)) return;
		const defaultContent = 'width=device-width, initial-scale=1, viewport-fit=cover';
		// iOS Safari can preserve an accidental page zoom / text autosize state across
		// navigations, and Android installed PWAs need the stricter viewport content
		// immediately when React hydrates or the system chrome can reserve stale zoom
		// insets. Apply the locked viewport to both cases.
		const nextContent = (isAndroidStandalonePwa || detectIosSafariBrowser())
			? 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
			: defaultContent;
		viewportMeta.setAttribute('content', nextContent);
		return () => {
			viewportMeta.setAttribute('content', defaultContent);
		};
	}, [isAndroidStandalonePwa]);

	React.useEffect(() => {
		// iOS standalone PWAs still expose the native left-edge swipe-back gesture,
		// which can pop our overlay history and visually drag the app shell even when
		// the user meant to interact with the editor. Capture that edge gesture early
		// and cancel it once it resolves into a horizontal right-swipe.
		if (!isMobileViewport || typeof window === 'undefined') return;
		if (!detectIosStandaloneDisplayMode()) return;

		let tracking = false;
		let horizontalLocked = false;
		let startX = 0;
		let startY = 0;
		const MAX_START_X = 28;
		const MAX_DY = 24;
		const MIN_BLOCK_DX = 8;

		const onTouchStart = (event: TouchEvent) => {
			if (event.touches.length !== 1) {
				tracking = false;
				horizontalLocked = false;
				return;
			}
			const touch = event.touches[0];
			if (touch.clientX > MAX_START_X) {
				tracking = false;
				horizontalLocked = false;
				return;
			}
			startX = touch.clientX;
			startY = touch.clientY;
			tracking = true;
			horizontalLocked = false;
		};

		const onTouchMove = (event: TouchEvent) => {
			if (!tracking || event.touches.length !== 1) return;
			const touch = event.touches[0];
			const dx = touch.clientX - startX;
			const dy = touch.clientY - startY;

			if (!horizontalLocked && Math.abs(dy) > MAX_DY && Math.abs(dy) > Math.abs(dx)) {
				tracking = false;
				return;
			}

			if (dx > MIN_BLOCK_DX && Math.abs(dx) > Math.abs(dy)) {
				horizontalLocked = true;
			}

			if (horizontalLocked && event.cancelable) {
				event.preventDefault();
			}
		};

		const onTouchEnd = () => {
			tracking = false;
			horizontalLocked = false;
		};

		document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
		document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
		document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
		document.addEventListener('touchcancel', onTouchEnd, { passive: true, capture: true });
		return () => {
			document.removeEventListener('touchstart', onTouchStart, { capture: true });
			document.removeEventListener('touchmove', onTouchMove, { capture: true });
			document.removeEventListener('touchend', onTouchEnd, { capture: true });
			document.removeEventListener('touchcancel', onTouchEnd, { capture: true });
		};
	}, [isMobileViewport]);

	React.useEffect(() => {
		if (!isMobileViewport || typeof window === 'undefined') return;
		// Keep the edge-swipe listener mounted for the whole mobile session and consult
		// live refs inside the handlers. Fresh login performs several post-auth state
		// transitions (workspace, splash, editor restore), and a listener that only
		// attaches for one render can miss the first stable shell until another UI
		// change like a workspace switch or manual toggle retriggers the effect.

		let tracking = false;
		let horizontalLocked = false;
		let startX = 0;
		let startY = 0;
		let currentProgress = 0;
		let drawerWidth = 0;
		const MAX_DY = 28;
		const MIN_LOCK_DX = 6;
		const MAX_START_X = 36;

		const canTrackOpenGesture = (): boolean => {
			if (authStatusRef.current !== 'authed') return false;
			if (!gridReadyRef.current && !splashGoneRef.current) return false;
			if (editorModeRef.current !== 'none' || selectedNoteIdRef.current !== null) return false;
			if (isMobileSidebarOpenRef.current) return false;
			return true;
		};

		const resetGesture = (): void => {
			tracking = false;
			horizontalLocked = false;
			currentProgress = 0;
			setIsMobileSidebarDragging(false);
			setMobileSidebarProgress(0);
		};

		const cancelGesture = (): void => {
			tracking = false;
			horizontalLocked = false;
			currentProgress = 0;
			setIsMobileSidebarDragging(false);
		};

		const onTouchStart = (event: TouchEvent) => {
			if (!canTrackOpenGesture()) {
				cancelGesture();
				return;
			}
			if (event.touches.length !== 1) return;
			const touch = event.touches[0];
			if (touch.clientX > MAX_START_X) return;
			const drawer = mobileSidebarRef.current;
			startX = touch.clientX;
			startY = touch.clientY;
			drawerWidth = drawer ? getMobileSidebarWidth(drawer) : Math.min(window.innerWidth * 0.86, 320);
			currentProgress = 0;
			tracking = true;
			horizontalLocked = false;
		};

		const onTouchMove = (event: TouchEvent) => {
			if (!tracking || event.touches.length !== 1) return;
			if (!canTrackOpenGesture()) {
				resetGesture();
				return;
			}
			const touch = event.touches[0];
			const dx = touch.clientX - startX;
			const dy = touch.clientY - startY;

			if (!horizontalLocked) {
				if (Math.abs(dy) > MAX_DY && Math.abs(dy) > Math.abs(dx)) {
					resetGesture();
					return;
				}
				if (dx <= 0) return;
				if (dx > MIN_LOCK_DX && Math.abs(dx) > Math.abs(dy) * 0.75) {
					horizontalLocked = true;
				} else {
					return;
				}
			}

			if (event.cancelable) event.preventDefault();
			currentProgress = clampMobileSidebarProgress(dx / drawerWidth);
			setIsMobileSidebarDragging(true);
			setMobileSidebarProgress(currentProgress);
		};

		const onTouchEnd = () => {
			if (!tracking) return;
			if (!canTrackOpenGesture()) {
				resetGesture();
				return;
			}
			const shouldOpen = horizontalLocked && currentProgress >= 0.3;
			tracking = false;
			horizontalLocked = false;
			setIsMobileSidebarDragging(false);
			if (shouldOpen) {
				openMobileSidebar();
				return;
			}
			setMobileSidebarProgress(0);
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
	}, [isMobileViewport, openMobileSidebar]);

	React.useEffect(() => {
		if (!isMobileViewport || !isMobileSidebarOpen || typeof window === 'undefined') return;
		const drawer = mobileSidebarRef.current;
		if (!drawer) return;

		let tracking = false;
		let horizontalLocked = false;
		let startX = 0;
		let startY = 0;
		let drawerWidth = 0;
		let currentProgress = 1;
		const MAX_DY = 32;
		const MIN_LOCK_DX = 6;

		const resetGesture = (): void => {
			tracking = false;
			horizontalLocked = false;
			currentProgress = 1;
			setIsMobileSidebarDragging(false);
			setMobileSidebarProgress(1);
		};

		const onTouchStart = (event: TouchEvent) => {
			if (event.touches.length !== 1) return;
			const touch = event.touches[0];
			startX = touch.clientX;
			startY = touch.clientY;
			drawerWidth = getMobileSidebarWidth(drawer);
			currentProgress = 1;
			tracking = true;
			horizontalLocked = false;
		};

		const onTouchMove = (event: TouchEvent) => {
			if (!tracking || event.touches.length !== 1) return;
			const touch = event.touches[0];
			const dx = touch.clientX - startX;
			const dy = touch.clientY - startY;

			if (!horizontalLocked) {
				if (Math.abs(dy) > MAX_DY && Math.abs(dy) > Math.abs(dx)) {
					resetGesture();
					return;
				}
				if (dx >= 0) return;
				if (Math.abs(dx) > MIN_LOCK_DX && Math.abs(dx) > Math.abs(dy) * 0.75) {
					horizontalLocked = true;
				} else {
					return;
				}
			}

			if (event.cancelable) event.preventDefault();
			currentProgress = clampMobileSidebarProgress(1 + (dx / drawerWidth));
			setIsMobileSidebarDragging(true);
			setMobileSidebarProgress(currentProgress);
		};

		const onTouchEnd = () => {
			if (!tracking) return;
			const shouldClose = horizontalLocked && currentProgress <= 0.72;
			tracking = false;
			horizontalLocked = false;
			setIsMobileSidebarDragging(false);
			if (shouldClose) {
				closeMobileSidebar();
				return;
			}
			setMobileSidebarProgress(1);
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
			if (isNoteImageViewerHistoryState(state) || isNoteEditorMediaDockHistoryState(state) || isNoteImageUploadHistoryState(state)) {
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

	// Lock html/body scroll (and preserve scroll position) while any editor overlay is open.
	// Body-only overflow was insufficient on desktop: the document/html scrollbar stayed
	// live and wheel events could still scroll the note grid behind the editor.
	useBodyScrollLock(isEditorOverlayOpen, { disableTouchAction: false });

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
			if (authWorkspaceId) {
				persistNoteReminderState({
					docId: manager.resolveRoomName(noteId),
					noteId,
					workspaceId: authWorkspaceId,
					reminderAt: null,
				});
			}
			setSelectedNoteId((prev) => (prev === noteId ? null : prev));
			setOpenDocId((prevId) => {
				if (prevId !== noteId) return prevId;
				setOpenDoc(null);
				return null;
			});
		},
		[authWorkspaceId, canEditActiveWorkspace, manager, persistNoteReminderState, sharedPlacements, showBriefDialog, t]
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

	const handleCreateQuickReminder = React.useCallback(async (value: { title: string; reminderAt: string }) => {
		if (!canEditActiveWorkspace || !authWorkspaceId) {
			showBriefDialog(t('share.roleViewer'));
			replaceActiveOverlaySnapshot({
				...getOverlaySnapshot(),
				isFabOpen: false,
			});
			setIsQuickReminderOpen(false);
			return;
		}
		const title = value.title.trim();
		if (!title || !value.reminderAt) return;
		try {
			const noteId = makeNoteId('text-note');
			const docId = manager.resolveRoomName(noteId);
			const doc = await manager.getDocWithSync(noteId);
			initTextNoteDoc(doc, title, '', undefined, []);
			assignNoteBannerFile(doc, 'reminder.svg');
			if (sidebarView === 'notes' && activeCollectionId) {
				assignNoteToCollection(doc, activeCollectionId);
			}
			await manager.createNote(noteId, title);
			persistNoteReminderState({
				docId,
				noteId,
				workspaceId: authWorkspaceId,
				reminderAt: value.reminderAt,
				noteTitle: title,
			});
			replaceActiveOverlaySnapshot({
				...getOverlaySnapshot(),
				isFabOpen: false,
			});
			setSidebarView('notes');
			if (typeof window !== 'undefined') {
				suppressWorkspaceScrollPersistUntilRef.current = Date.now() + 400;
				writeWorkspaceRenderSnapshotScroll(authWorkspaceId, activeGridViewMode, 0);
				window.requestAnimationFrame(() => {
					window.scrollTo({ left: 0, top: 0, behavior: 'auto' });
				});
			}
			setIsQuickReminderOpen(false);
		} catch {
			showBriefDialog('failed to save note');
		}
	}, [activeCollectionId, activeGridViewMode, authWorkspaceId, canEditActiveWorkspace, getOverlaySnapshot, manager, persistNoteReminderState, replaceActiveOverlaySnapshot, showBriefDialog, sidebarView, t]);

	const handleMoveNoteToWorkspace = React.useCallback(async (targetWorkspaceId: string) => {
		if (!moveNoteModalState || !authWorkspaceId) return;
		const noteId = moveNoteModalState.noteId;
		const noteTitle = moveNoteModalState.title;
		const sourceDocId = `${authWorkspaceId}:${noteId}`;
		const targetDocId = `${targetWorkspaceId}:${noteId}`;
		const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
		const shouldQueueImmediately = authOfflineMode || browserOffline;
		let shouldShowQueuedMessage = shouldQueueImmediately;
		const moveDebugTrace = beginMoveDebugTrace({
			noteId,
			sourceWorkspaceId: authWorkspaceId,
			targetWorkspaceId,
		});
		const moveDebugTraceId = moveDebugTrace?.traceId ?? null;
		logMoveDebugClient(moveDebugTraceId, 'move-start', {
			noteId,
			sourceDocId,
			targetDocId,
			shouldQueueImmediately,
			authOfflineMode,
			browserOffline,
		});
		const refreshMovedNoteRemoteState = async (): Promise<void> => {
			await Promise.allSettled([
				refreshRemoteNoteImages(targetDocId, { force: true }),
				refreshRemoteNoteDocuments(targetDocId, { userId: authUserId, force: true }),
			]);
		};
		setMoveNoteBusy(true);
		setMoveNoteError(null);
		try {
			if (!shouldQueueImmediately && authUserId) {
				removePendingNoteMove(authUserId, noteId);
			}
			const metadataMapping = await manager.moveNoteToWorkspaceLocally(noteId, targetWorkspaceId, {
				sourceWorkspaceId: authWorkspaceId,
				title: noteTitle,
			});
			logMoveDebugClient(moveDebugTraceId, 'local-move-complete', {
				noteId,
				targetDocId,
				collectionPairCount: metadataMapping.collectionIdPairs.length,
				labelPairCount: metadataMapping.labelIdPairs.length,
			});
			removeManualRoomAlias(noteId);
			// Keep docId-keyed local caches aligned with the optimistic move so chips,
			// previews, and attachment panels stay populated before the server round-trip.
			await Promise.allSettled([
				moveLocalNoteMedia(sourceDocId, targetDocId, authUserId),
				moveLocalNoteLinks(sourceDocId, targetDocId, authUserId),
				moveLocalNoteDocuments(sourceDocId, targetDocId, authUserId),
				Promise.resolve().then(() => moveUserNotePinPreference(sourceDocId, targetDocId, authUserId)),
				Promise.resolve().then(() => moveNoteOrderSnapshotEntry(authWorkspaceId, targetWorkspaceId, noteId)),
				authUserId ? Promise.resolve().then(() => moveCachedReminderStates({ userId: authUserId, noteId, sourceWorkspaceId: authWorkspaceId, targetWorkspaceId })) : Promise.resolve(),
				authUserId ? moveCachedNoteShareCollaborators(authUserId, sourceDocId, targetDocId) : Promise.resolve(),
			]);
			setSelectedNoteId((current) => current === noteId ? null : current);
			setOpenDocId((current) => {
				if (current !== noteId) return current;
				setOpenDoc(null);
				return null;
			});
			if (shouldQueueImmediately && authUserId) {
				logMoveDebugClient(moveDebugTraceId, 'move-queued-offline', {
					noteId,
					targetDocId,
				});
				queuePendingNoteMove({
					userId: authUserId,
					noteId,
					sourceWorkspaceId: authWorkspaceId,
					targetWorkspaceId,
					title: noteTitle,
					metadataMapping,
				});
			}
			if (!shouldQueueImmediately) {
				try {
					await moveNoteToWorkspace(noteId, targetWorkspaceId, authWorkspaceId, metadataMapping, moveDebugTraceId);
					await refreshMovedNoteRemoteState();
					logMoveDebugClient(moveDebugTraceId, 'server-move-success', {
						noteId,
						targetDocId,
					});
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
					logMoveDebugClient(moveDebugTraceId, 'server-move-error', {
						noteId,
						targetDocId,
						status,
						message,
						isNetworkFailure,
					});
					if (isNetworkFailure || status == null || status >= 500) {
						// Keep the local move and persisted queue when the server response is
						// ambiguous. The move may have already committed remotely.
						logMoveDebugClient(moveDebugTraceId, 'move-queued-ambiguous', {
							noteId,
							targetDocId,
							status,
						});
						if (authUserId) {
							queuePendingNoteMove({
								userId: authUserId,
								noteId,
								sourceWorkspaceId: authWorkspaceId,
								targetWorkspaceId,
								title: noteTitle,
								metadataMapping,
							});
						}
						shouldShowQueuedMessage = true;
					} else {
						logMoveDebugClient(moveDebugTraceId, 'rollback-start', {
							noteId,
							targetDocId,
							status,
						});
						await manager.moveNoteToWorkspaceLocally(noteId, authWorkspaceId, {
							sourceWorkspaceId: targetWorkspaceId,
							title: noteTitle,
						});
						await Promise.allSettled([
							moveLocalNoteMedia(targetDocId, sourceDocId, authUserId),
							moveLocalNoteLinks(targetDocId, sourceDocId, authUserId),
							moveLocalNoteDocuments(targetDocId, sourceDocId, authUserId),
							Promise.resolve().then(() => moveUserNotePinPreference(targetDocId, sourceDocId, authUserId)),
							Promise.resolve().then(() => moveNoteOrderSnapshotEntry(targetWorkspaceId, authWorkspaceId, noteId)),
							authUserId ? Promise.resolve().then(() => moveCachedReminderStates({ userId: authUserId, noteId, sourceWorkspaceId: targetWorkspaceId, targetWorkspaceId: authWorkspaceId })) : Promise.resolve(),
							authUserId ? moveCachedNoteShareCollaborators(authUserId, targetDocId, sourceDocId) : Promise.resolve(),
						]);
						if (authUserId) {
							removePendingNoteMove(authUserId, noteId);
						}
						logMoveDebugClient(moveDebugTraceId, 'rollback-complete', {
							noteId,
							targetDocId,
							status,
						});
						throw error;
					}
				}
			}
			if (!shouldShowQueuedMessage) {
				await refreshNoteShareStateRef.current().catch(() => undefined);
			}
			setMoveNoteModalState(null);
			showBriefDialog(t(shouldShowQueuedMessage ? 'workspace.moveNoteQueued' : 'workspace.moveNoteSuccess'));
		} catch (error) {
			setMoveNoteError(error instanceof Error ? error.message : t('workspace.moveNoteFailed'));
		} finally {
			setMoveNoteBusy(false);
		}
	}, [authOfflineMode, authUserId, authWorkspaceId, manager, moveNoteModalState, removeManualRoomAlias, showBriefDialog, t]);

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

	const selectedNoteRoomId = React.useMemo(() => {
		if (!selectedNoteId) return '';
		if (selectedNoteSharedPlacement?.roomId) return selectedNoteSharedPlacement.roomId;
		const manualRoomId = selectedNoteId.startsWith('shared-placement:') ? '' : manualRoomAliases[selectedNoteId];
		if (manualRoomId) return manualRoomId;
		if (selectedNoteId.startsWith('shared-placement:')) return '';
		try {
			return manager.resolveRoomName(selectedNoteId);
		} catch {
			return authWorkspaceId ? `${authWorkspaceId}:${selectedNoteId}` : selectedNoteId;
		}
	}, [authWorkspaceId, manager, manualRoomAliases, selectedNoteId, selectedNoteSharedPlacement]);
	const selectedMovedSharedPlacement = React.useMemo(() => {
		if (!selectedNoteId || selectedNoteId.startsWith('shared-placement:')) return null;
		return activeWorkspaceSharedPlacements.find((placement) => placement.sourceNoteId === selectedNoteId) ?? null;
	}, [activeWorkspaceSharedPlacements, selectedNoteId]);

	React.useEffect(() => {
		if (!selectedNoteId || !selectedMovedSharedPlacement) return;
		setSelectedNoteId((current) => current === selectedNoteId ? selectedMovedSharedPlacement.aliasId : current);
	}, [selectedMovedSharedPlacement, selectedNoteId]);

	React.useEffect(() => {
		if (!selectedNoteId || !selectedNoteId.startsWith('shared-placement:')) return;
		if (selectedNoteSharedPlacement) return;
		setSelectedNoteId((current) => current === selectedNoteId ? null : current);
		setOpenDoc(null);
		setOpenDocId((current) => current === selectedNoteId ? null : current);
		setCollaboratorModalState((current) => current?.noteId === selectedNoteId ? null : current);
		setNoteImageModalState((current) => current?.noteId === selectedNoteId ? null : current);
		setNoteAttachmentBrowserState((current) => current?.noteId === selectedNoteId ? null : current);
	}, [selectedNoteId, selectedNoteSharedPlacement]);

	React.useEffect(() => {
		let cancelled = false;
		// Branch: nothing selected.
		if (!selectedNoteId) {
			setOpenDoc(null);
			setOpenDocId(null);
			return;
		}
		if (selectedNoteId.startsWith('shared-placement:')) {
			if (!selectedNoteRoomId) {
				setOpenDoc(null);
				setOpenDocId(null);
				return;
			}
			ensureManualRoomAlias(selectedNoteId, selectedNoteRoomId);
		}
		// Re-open the editor whenever a shared-note alias is remapped to a different
		// underlying room (for example after the owner moves the shared note).
		setOpenDoc(null);
		setOpenDocId(null);

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
	}, [ensureManualRoomAlias, manager, selectedNoteId, selectedNoteRoomId]);

	const sidebarIsCollapsed = !isMobileViewport && isSidebarCollapsed;
	React.useEffect(() => {
		if (!wsOwnerPopup) return;
		if (sidebarIsCollapsed || (isMobileViewport && !isMobileSidebarOpen)) {
			closeOwnerPopup();
		}
	}, [closeOwnerPopup, isMobileSidebarOpen, isMobileViewport, sidebarIsCollapsed, wsOwnerPopup]);
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
		const INITIAL_NOTE_LINK_RECONNECT_DELAY_MS = 2100;
		const onOnline = (): void => {
			// Small delay to let the network connection stabilise after the
			// browser fires the `online` event (DNS/TLS may still be settling).
			if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
			const attemptFlush = (attempt: number): void => {
				void (async () => {
					await new Promise((r) => setTimeout(r, attempt === 0 ? INITIAL_NOTE_LINK_RECONNECT_DELAY_MS : 2000));
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

	const clearSearch = React.useCallback(() => {
		setSearchQuery('');
		setSearchResults([]);
		setSearchResultsError(null);
		setSearchResultsBusy(false);
	}, []);
	const clearSearchAndClose = React.useCallback(() => {
		clearSearch();
		closeMobileSearch();
	}, [clearSearch, closeMobileSearch]);
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
		if (kind === 'collection') return t('search.matchCollection');
		if (kind === 'label') return t('search.matchLabel');
		return t('search.matchNote');
	}, [t]);
	const canShowGlobalSearchResults = viewMode !== 'bubble' && sidebarView !== 'images';
	const hasGlobalSearchResults = canShowGlobalSearchResults && Boolean(deferredSearchQuery);
	function renderGlobalSearchResults(variantClassName: string): React.ReactNode {
		return (
		<section className={`global-search-results ${variantClassName}`} aria-live="polite">
			<div className="global-search-results-header">
				<div>
					<p className="global-search-results-eyebrow">{t('search.title')}</p>
					<h2 className="global-search-results-title">{deferredSearchQuery}</h2>
				</div>
				<div className="global-search-results-meta">
					{searchResultsBusy ? t('common.loading') : `${searchResults.length} ${searchResults.length === 1 ? t('search.resultSingular') : t('search.resultPlural')}`}
					<button
						type="button"
						className="global-search-results-close"
						onClick={clearSearch}
						aria-label={t('common.close')}
						title={t('common.close')}
					>
						<FontAwesomeIcon icon={faXmark} />
					</button>
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
												{result.collectionMatches.map((label) => <span key={`${result.docId}:collection:${label}`} className="global-search-result-context">{t('search.collectionPrefix')} {label}</span>)}
												{result.labelMatches.map((label) => <span key={`${result.docId}:label:${label}`} className="global-search-result-context">{t('search.labelPrefix')} {label}</span>)}
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
		);
	}
	const handleSearchResultSelect = React.useCallback(async (result: NoteSearchResult) => {
		setSearchQuery('');
		setSearchResults([]);
		setSearchResultsError(null);
		setNoteGridCollaboratorFilter(null);
		if (isMobileViewport) {
			replaceActiveOverlaySnapshot({
				...getOverlaySnapshot(),
				isMobileSearchOpen: false,
			});
		}
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
	}, [activateWorkspaceFromSidebar, authWorkspaceId, getOverlaySnapshot, isMobileViewport, openNoteEditor, replaceActiveOverlaySnapshot]);

	const notificationDeepLinkOpeningRef = React.useRef(false);
	const openNotificationDeepLink = React.useCallback(async (): Promise<void> => {
		if (authStatus !== 'authed' || notificationDeepLinkOpeningRef.current) return;
		const deepLink = captureNotificationDeepLink();
		if (!deepLink) return;
		notificationDeepLinkOpeningRef.current = true;
		try {
			if (deepLink.workspaceId && deepLink.workspaceId !== authWorkspaceId) {
				await activateWorkspaceFromSidebar(deepLink.workspaceId, { activeSharedFolder: null });
			}
			const refreshedLink = captureNotificationDeepLink();
			if (!refreshedLink) return;
			clearPendingNotificationDeepLink();
			markNotificationDeepLinkConsumed(refreshedLink);
			setSidebarView('notes');
			const mobileOverlay = shouldUseMobileOverlayHistory(isMobileViewport);
			openNoteEditor(refreshedLink.noteId, {
				fromExternalDeepLink: mobileOverlay,
				replaceTop: !mobileOverlay,
			});
		} finally {
			notificationDeepLinkOpeningRef.current = false;
		}
	}, [activateWorkspaceFromSidebar, authStatus, authWorkspaceId, isMobileViewport, openNoteEditor]);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const capture = (): void => {
			const link = readNotificationDeepLinkFromUrl();
			if (!link) return;
			stashNotificationDeepLink(link);
			// Strip params from the launch entry so a later Back cannot re-trigger the deep link.
			clearNotificationDeepLinkFromUrl();
		};
		capture();
		const onPopState = (): void => {
			const link = readNotificationDeepLinkFromUrl();
			if (!link) return;
			if (isNotificationDeepLinkConsumed(link)) {
				clearNotificationDeepLinkFromUrl();
				return;
			}
			void openNotificationDeepLink();
		};
		const onPageShow = (): void => {
			capture();
			void openNotificationDeepLink();
		};
		const onServiceWorkerMessage = (event: MessageEvent): void => {
			if (event.data?.type !== 'FREEMANNOTES_NOTIFICATION_OPEN') return;
			const parsed = parseNotificationDeepLinkMessage(event.data);
			if (parsed) stashNotificationDeepLink(parsed);
		};
		const onDeepLinkStashed = (): void => {
			void openNotificationDeepLink();
		};
		window.addEventListener('popstate', onPopState);
		window.addEventListener('pageshow', onPageShow);
		window.addEventListener(NOTIFICATION_DEEP_LINK_STASHED_EVENT, onDeepLinkStashed);
		const serviceWorker = navigator.serviceWorker;
		serviceWorker?.addEventListener('message', onServiceWorkerMessage);
		return () => {
			window.removeEventListener('popstate', onPopState);
			window.removeEventListener('pageshow', onPageShow);
			window.removeEventListener(NOTIFICATION_DEEP_LINK_STASHED_EVENT, onDeepLinkStashed);
			serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
		};
	}, [openNotificationDeepLink]);

	React.useEffect(() => {
		if (authStatus !== 'authed') return;
		void openNotificationDeepLink();
	}, [authStatus, authWorkspaceId, gridReady, openNotificationDeepLink]);

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

	// Stable memoized loadDrawingDoc prop for NoteDrawingBrowserModal.
	// Using an inline arrow in JSX would create a new function reference on every
	// render, causing DrawingsPanel's effect (which depends on loadDrawingDoc) to
	// re-run and flash "Loading..." unnecessarily on unrelated state updates.
	// NOTE: must be declared before any early-return (auth gate, share route, etc.)
	// so the hook is always called unconditionally on every render.
	const drawingBrowserNoteId = noteAttachmentBrowserState?.kind === 'drawings' ? noteAttachmentBrowserState.noteId : null;
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const drawingBrowserLoadDoc = React.useCallback(
		(drawingId: string) => drawingBrowserNoteId ? loadDrawingDoc(drawingBrowserNoteId, drawingId) : Promise.resolve(null),
		// loadDrawingDoc is stable (useCallback with [ensureRelatedNoteAlias, manager]);
		// drawingBrowserNoteId only changes when a different note's drawings modal opens.
		[drawingBrowserNoteId, loadDrawingDoc]
	);
	const selectedNoteIsPendingNew = React.useMemo(
		() => Boolean(selectedNoteId && pendingNewNoteIdsRef.current.has(selectedNoteId)),
		[selectedNoteId, pendingNewNotesRevision],
	);

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
	const selectedSharedPlacement = selectedNoteSharedPlacement;
	const selectedNoteDocId = selectedNoteRoomId;
	const selectedNoteReadOnly = selectedSharedPlacement ? selectedSharedPlacement.role === 'VIEWER' : !canEditActiveWorkspace;
	const canManageSelectedNoteCollaborators = selectedSharedPlacement ? selectedSharedPlacement.role === 'EDITOR' : canEditActiveWorkspace;
	const crossWorkspacePlacement = crossWorkspaceNote ? sharedPlacements.find((placement) => placement.aliasId === crossWorkspaceNote.noteId) ?? null : null;
	const crossWorkspaceTarget = crossWorkspaceNote ? sidebarWorkspaces.find((workspace) => workspace.id === crossWorkspaceNote.workspaceId) ?? null : null;
	const crossWorkspaceDocId = crossWorkspaceNote
		? crossWorkspacePlacement?.roomId ?? `${crossWorkspaceNote.workspaceId}:${crossWorkspaceNote.noteId}`
		: '';
	const canEditCrossWorkspace = crossWorkspacePlacement
		? crossWorkspacePlacement.role === 'EDITOR'
		: canEditWorkspaceContent(normalizeWorkspaceRole(crossWorkspaceTarget?.role));
	const crossWorkspaceReadOnly = crossWorkspaceNote ? !canEditCrossWorkspace : true;
	const canManageCrossWorkspaceCollaborators = crossWorkspacePlacement
		? crossWorkspacePlacement.role === 'EDITOR'
		: canEditCrossWorkspace;
	const selectedNewNoteCollectionSeed = selectedNoteId ? pendingNewNoteCollectionSeedRef.current.get(selectedNoteId) ?? null : null;
	const toggleSelectedNotePin = (): void => {
		if (!openDoc || !selectedNoteId || !selectedNoteDocId) return;
		const isPinned = resolveUserNotePinned({
			docId: selectedNoteDocId,
			noteId: selectedNoteId,
			userId: authUserId,
			legacyPinned: readNoteMetadataState(openDoc).isPinned,
		});
		setUserNotePinnedOnDoc({
			doc: openDoc,
			docId: selectedNoteDocId,
			noteId: selectedNoteId,
			userId: authUserId,
			deviceId,
			pinned: !isPinned,
		});
	};
	const selectedQuickCreateCollectionOption = selectedNoteId && openDoc && selectedNewNoteCollectionSeed && !selectedNoteReadOnly
		? {
			label: selectedNewNoteCollectionSeed.label,
			checked: selectedNoteMetadata.collectionId === selectedNewNoteCollectionSeed.collectionId,
			onChange: (next: boolean) => {
				assignNoteToCollection(openDoc, next ? selectedNewNoteCollectionSeed.collectionId : null);
			},
		}
		: undefined;
	const mobileSidebarVisualProgress = clampMobileSidebarProgress(mobileSidebarProgress);
	const isMobileSidebarActive = mobileSidebarVisualProgress > 0.001;
	const mobileShellStyle = {
		['--mobile-sidebar-open-progress' as const]: mobileSidebarVisualProgress.toFixed(4),
		['--app-mobile-search-viewport-offset' as const]: `${mobileSearchViewportOffsetTop}px`,
	} as React.CSSProperties;
	const blurPx = (mobileSidebarVisualProgress * 4).toFixed(2);
	const mobileSidebarBackdropStyle = {
		opacity: mobileSidebarVisualProgress,
		backdropFilter: `blur(${blurPx}px)`,
		WebkitBackdropFilter: `blur(${blurPx}px)`,
		pointerEvents: isMobileSidebarOpen && !isMobileSidebarDragging ? 'auto' : 'none',
	} as React.CSSProperties;


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
			style={mobileShellStyle}
			className={`test-harness-root${themeId.startsWith('catppuccin-') ? ' theme-catppuccin' : ''}${
				isFabOpen ? ' fab-open' : ''
			}${sidebarIsCollapsed ? ' sidebar-collapsed' : ''}${isMobileSidebarOpen ? ' mobile-sidebar-open' : ''}${isMobileSidebarActive ? ' mobile-sidebar-active' : ''}${isEditorOverlayOpen ? ' editor-open' : ''}${isIosStandalonePwa ? ' ios-standalone-pwa' : ''}${isAndroidStandalonePwa ? ' android-standalone-pwa' : ''}${
				// Landscape branch: expose a root class so CSS can hard-disable the
				// portrait header morph transitions during rotation.
				isMobileLandscape ? ' mobile-landscape' : ''
			}`}
		>
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
								ref={viewModeToggleButtonRef}
								type="button"
								className={`app-icon-button mobile-appgrid-btn${isViewModePickerOpen ? ' is-active' : ''}`}
								onClick={toggleViewModePicker}
								aria-label={t('app.chooseView')}
								aria-pressed={isViewModePickerOpen}
								title={selectedViewModeOption.label}
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
							<div className="app-header-search-field">
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
									onKeyDown={(event) => {
										if (event.key === 'Escape' && searchQuery.trim()) clearSearch();
									}}
									placeholder={t('app.globalSearchPlaceholder')}
									aria-label={t('app.globalSearchPlaceholder')}
								/>
								{searchQuery.trim() ? (
									<button
										type="button"
										className="app-header-search-clear"
										onClick={clearSearch}
										aria-label={t('common.close')}
										title={t('common.close')}
									>
										<FontAwesomeIcon icon={faXmark} />
									</button>
								) : null}
							</div>
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
								ref={viewModeToggleButtonRef}
								type="button"
								className={`app-icon-button${isViewModePickerOpen ? ' is-active' : ''}`}
								onClick={toggleViewModePicker}
								aria-label={t('app.chooseView')}
								aria-pressed={isViewModePickerOpen}
								title={selectedViewModeOption.label}
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
				{/* Keep the chooser anchored under the header controls so desktop and
				    installed-PWA layouts reuse the same safe-area geometry. */}
				<div ref={viewModePickerRef} className={`app-header-viewrow${isViewModePickerOpen ? ' is-open' : ''}`}>
					<div className="app-header-view-actions" role="group" aria-label={t('app.chooseView')}>
						{viewModeOptions.map((option) => (
							<button
								key={option.mode}
								type="button"
								className={`app-icon-button app-view-mode-option${viewMode === option.mode ? ' is-selected' : ''}`}
								onClick={() => selectViewMode(option.mode)}
								aria-label={option.label}
								title={option.label}
							>
								<FontAwesomeIcon icon={option.icon} />
							</button>
						))}
					</div>
				</div>
			</header>

			{hasGlobalSearchResults && isMobileViewport ? (
				<div className="mobile-search-results-surface">{renderGlobalSearchResults('global-search-results--mobile')}</div>
			) : null}

			{isMobileViewport && isMobileSidebarActive ? (
				<button
					type="button"
					className="mobile-sidebar-backdrop"
					style={mobileSidebarBackdropStyle}
					onPointerUp={(event) => closeBackdropFromPointerEvent(event, closeMobileSidebar)}
					onClick={(event) => {
						if (event.defaultPrevented) return;
						closeMobileSidebar();
					}}
					aria-label={t('common.close')}
				/>
			) : null}

			<div className={`app-shell${sidebarIsCollapsed ? ' sidebar-collapsed' : ''}`}>
				<aside
					ref={mobileSidebarRef}
					className={`app-sidebar${sidebarIsCollapsed ? ' is-collapsed' : ''}${isMobileSidebarOpen ? ' is-mobile-open' : ''}${isMobileSidebarDragging ? ' is-mobile-dragging' : ''}`}
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
												if (isMobileViewport) {
													if (sidebarView !== 'trash') {
														openMobileSidebarHistoryView('trash');
													} else {
														closeMobileSidebar();
													}
												} else {
													setSidebarView('trash');
												}
												return;
											}
											if (entry.id === 'images') {
												setActiveSharedFolder(null);
												if (isMobileViewport) {
													if (sidebarView !== 'images') {
														openMobileSidebarHistoryView('images');
													} else {
														closeMobileSidebar();
													}
												} else {
													setSidebarView('images');
												}
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
													{sidebarWorkspacesBusy ? (
															<div className="sidebar-workspace-muted sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: 1 }}>{t('common.loading')}</div>
													) : null}
													{sidebarWorkspacesError ? (
															<div className="sidebar-workspace-muted sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: 2 }}>{sidebarWorkspacesError}</div>
													) : null}
													{bubbleWorkspaceLegend.length === 0 && !sidebarWorkspacesBusy ? (
															<div className="sidebar-workspace-muted sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: 3 }}>{t('workspace.none')}</div>
													) : null}
													{bubbleWorkspaceLegend.map((workspace, index) => (
															<div
															key={workspace.id}
															className="sidebar-workspace-legend-item"
															style={{ ['--sidebar-item-index' as const]: index + 4 } as React.CSSProperties}
														>
															<button
																type="button"
																className={`sidebar-workspace-legend-swatch-btn${bubbleColorPickerWorkspaceId === workspace.id ? ' is-active' : ''}`}
																style={workspace.style}
																aria-label={`Change color for ${workspace.name}`}
																onClick={(e) => {
																	e.stopPropagation();
																	if (bubbleColorPickerWorkspaceId === workspace.id) {
																		setBubbleColorPickerWorkspaceId(null);
																		setBubbleColorPickerAnchorRect(null);
																	} else {
																		setBubbleColorPickerWorkspaceId(workspace.id);
																		setBubbleColorPickerAnchorRect(e.currentTarget.getBoundingClientRect());
																	}
																}}
															/>
															<OverflowMarqueeText
																value={workspace.name}
																viewportClassName="sidebar-overflow-label-viewport"
																trackClassName="sidebar-workspace-legend-label sidebar-overflow-label"
															/>
															</div>
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
											{sidebarWorkspacesError ? (
													<div className="sidebar-workspace-muted sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: 1 }}>{sidebarWorkspacesError}</div>
											) : null}
											{sidebarWorkspacesSorted.length === 0 && !sidebarWorkspacesBusy ? (
													<div className="sidebar-workspace-muted sidebar-submenu-muted" style={{ ['--sidebar-item-index' as const]: 2 }}>{t('workspace.none')}</div>
											) : null}
											{sidebarWorkspacesSorted.map((ws, index) => {
												const workspaceDisplayName = getWorkspaceDisplayName(ws, t);
												const isActive = Boolean(authWorkspaceId && ws.id === authWorkspaceId);
												const canShareWorkspace = canManageWorkspace(ws.role) && ws.systemKind !== 'SHARED_WITH_ME' && !isPersonalWorkspace(ws);
												const sharedFolderGroupId = `workspace-folders:${ws.id}`;
												const hasSharedFolders = ws.systemKind === 'SHARED_WITH_ME' && sharedFolderNames.length > 0;
												const showSharedFolders = hasSharedFolders && Boolean(sidebarGroupsOpen[sharedFolderGroupId]);
												const itemIndex = (sidebarWorkspacesError ? 2 : 0) + index;
												// Show owner avatar for any workspace the current user does not own
												// so they can always see whose workspace they are in.
												const showOwnerAvatar = ws.systemKind !== 'SHARED_WITH_ME' && ws.ownerUserId !== authUserId && ws.ownerUserId != null;
												const ownerDisplayName = ws.ownerName?.trim() || ws.ownerEmail?.trim() || null;
												const isOwnerOverlayOpen = wsOwnerPopup?.workspaceId === ws.id;
												const ownerInitials = ws.ownerName
													? ws.ownerName.trim().split(/\s+/).map((n) => n[0]).join('').toUpperCase().slice(0, 2)
													: (ws.ownerUserId ? '?' : '');
												return (
													<div key={ws.id} className="sidebar-workspace-group">
														<div className={`sidebar-workspace-row${canShareWorkspace ? ' has-share-action' : ''}${showOwnerAvatar ? ' has-owner-avatar' : ''}${(canShareWorkspace || showOwnerAvatar) ? ' has-inline-summary' : ''}${isOwnerOverlayOpen ? ' is-owner-overlay-open' : ''}`}>
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
																<OverflowMarqueeText
																	value={workspaceDisplayName}
																	viewportClassName="sidebar-overflow-label-viewport"
																	trackClassName="sidebar-submenu-item-label sidebar-overflow-label"
																/>
															</button>
															{canShareWorkspace || showOwnerAvatar ? (
																<div className="sidebar-workspace-row-summary">
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
																	{showOwnerAvatar ? (
																		<button
																			type="button"
																			className="sidebar-workspace-owner-avatar"
																			title={ownerDisplayName ?? undefined}
																			aria-label={ownerDisplayName ? `${t('workspace.ownedBy')} ${ownerDisplayName}` : t('workspace.ownedByUnknown')}
																			onClick={(e) => {
																				e.stopPropagation();
																				setWsOwnerPopupClosing(false);
																				setWsOwnerPopup({ workspaceId: ws.id });
																			}}
																		>
																			{ws.ownerProfileImage ? (
																				<img
																					src={ws.ownerProfileImage}
																					alt=""
																					className="sidebar-workspace-owner-img"
																				/>
																			) : (
																				<span className="sidebar-workspace-owner-initials" aria-hidden="true">{ownerInitials}</span>
																			)}
																		</button>
																	) : null}
																</div>
															) : null}
																	{showOwnerAvatar && isOwnerOverlayOpen ? (
																		<div
																			className={`sidebar-workspace-owner-inline-overlay${wsOwnerPopupClosing ? ' is-closing' : ''}`}
																			onClick={(event) => event.stopPropagation()}
																		>
																			<div className="sidebar-workspace-owner-inline-avatar-shell" aria-hidden="true">
																				{ws.ownerProfileImage ? (
																					<img src={ws.ownerProfileImage} alt="" className="sidebar-workspace-owner-inline-avatar" />
																				) : (
																					<div className="sidebar-workspace-owner-inline-avatar-initials">{ownerInitials}</div>
																				)}
																			</div>
																			<div className="sidebar-workspace-owner-inline-copy">
																				<span className="sidebar-workspace-owner-inline-name">{ownerDisplayName ?? t('workspace.ownedByUnknown')}</span>
																				<span className="sidebar-workspace-owner-inline-role">({t(getWorkspaceRoleLabelKey('OWNER'))})</span>
																			</div>
																			<button
																				type="button"
																				className="sidebar-workspace-owner-inline-close"
																				onClick={(event) => {
																					event.stopPropagation();
																					closeOwnerPopup();
																				}}
																				aria-label={t('common.close')}
																				title={t('common.close')}
																			>
																				<FontAwesomeIcon icon={faXmark} aria-hidden="true" />
																			</button>
																		</div>
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
											<div className={`sidebar-submenu${entry.id === 'collections' ? ' sidebar-collections-menu' : ''}${entry.id === 'labels' ? ' sidebar-labels-menu' : ''}`} aria-hidden={!isOpen}>
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
													{entry.id === 'labels' ? (
														<button
															type="button"
															className="sidebar-submenu-action sidebar-submenu-manage-top"
															onClick={() => {
																openLabelManagementModal();
																setSidebarView(filterSidebarView);
																if (isMobileViewport) closeMobileSidebar();
															}}
															style={{ ['--sidebar-item-index' as const]: 0 }}
														>
															{t('app.sidebarManageLabels')}
														</button>
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
														const isCollaboratorItemActive = entry.id === 'collaborators' && item.kind === 'item' && noteGridCollaboratorFilter?.key === item.id;
														const className = `${item.kind === 'action' ? 'sidebar-submenu-action' : 'sidebar-submenu-item'}${isLabelsItemActive || isReminderItemActive || isCollaboratorItemActive ? ' is-active' : ''}`;
														return (
															<button
																key={item.id}
																type="button"
																className={className}
																onClick={() => {
																	if (entry.id === 'collaborators' && item.kind === 'item') {
																		const collaborator = workspaceCollaborators.find((entry) => entry.key === item.id);
																		if (!collaborator) return;
																		setSidebarView(filterSidebarView);
																		setNoteGridCollaboratorFilter((current) => current?.key === collaborator.key ? null : {
																			key: collaborator.key,
																			userId: collaborator.userId,
																			label: collaborator.label,
																			email: collaborator.email,
																			avatar: collaborator.avatar,
																		});
																		if (isMobileViewport) closeMobileSidebar();
																		return;
																	}
																	if (entry.id === 'collaborators' && item.id === 'clear-collaborator-filter') {
																		setSidebarView(filterSidebarView);
																		setNoteGridCollaboratorFilter(null);
																		if (isMobileViewport) closeMobileSidebar();
																		return;
																	}
																	if (entry.id === 'labels' && item.kind === 'item') {
																		setSidebarView(filterSidebarView);
																		setActiveLabelIds((current) => current.includes(item.id) ? current.filter((entryId) => entryId !== item.id) : [...current, item.id]);
																		if (isMobileViewport) closeMobileSidebar();
																		return;
																	}
																	if (entry.id === 'reminders' && item.kind === 'item') {
																		applyReminderSidebarFilter(item.id as ReminderFilterMode);
																		return;
																	}
																	if (entry.id === 'reminders' && item.id === 'clear-reminders') {
																		setSidebarView(filterSidebarView);
																		clearReminderSidebarFilter();
																		if (isMobileViewport) closeMobileSidebar();
																	}
																}}
																style={{ ['--sidebar-item-index' as const]: index }}
															>
																<span className="sidebar-submenu-item-copy">
																	{entry.id === 'labels' && item.kind === 'item' && item.color ? <span className="sidebar-submenu-color-pill" style={{ backgroundColor: item.color }} aria-hidden="true" /> : null}
																	{entry.id === 'collaborators' && item.kind === 'item' ? (
																		item.avatar ? (
																			<img className="sidebar-collaborator-avatar" src={item.avatar} alt="" />
																		) : (
																			<span className="sidebar-collaborator-avatar-fallback" aria-hidden="true">{getSidebarCollaboratorInitial(item.label)}</span>
																		)
																	) : null}
																	{entry.id === 'labels' && item.kind === 'item' ? (
																		<OverflowMarqueeText
																			value={item.label}
																			viewportClassName="sidebar-overflow-label-viewport"
																			trackClassName="sidebar-submenu-item-label sidebar-overflow-label"
																		/>
																	) : (
																		<span className="sidebar-submenu-item-label" title={item.label}>{truncateUiName(item.label, 44)}</span>
																	)}
																</span>
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
														<button
															type="button"
															className="sidebar-submenu-action"
															onClick={() => {
																setSidebarView(filterSidebarView);
																clearSidebarSortMode();
																if (isMobileViewport) closeMobileSidebar();
															}}
															style={{ ['--sidebar-item-index' as const]: sortingPrimaryItems.length }}
														>
															{t('app.sidebarClearSort')}
														</button>
												{sortingNestedGroups.map((group, groupIndex) => {
													const nestedOpen = Boolean(sidebarGroupsOpen[group.id]);
															const baseIndex = sortingPrimaryItems.length + 1 + groupIndex;
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
																		const isActive = item.id === 'past-due' || item.id === 'due-soon' || item.id === 'least-accessed' || item.id === 'most-edited'
																			? activeSidebarFilterItem === item.id
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
																					if (item.id === 'clear-filters') {
																						clearSidebarFilters();
																					} else if (item.id === 'past-due' || item.id === 'due-soon') {
																						applySidebarFilterSelection(item.id as SidebarFilterReminderMode);
																					} else if (item.id === 'least-accessed' || item.id === 'most-edited') {
																						applySidebarFilterSelection(item.id as SidebarFilterSortMode);
																					} else if (item.id === 'by-week' || item.id === 'by-month') {
																						setActiveSortGrouping(item.id === 'by-week' ? 'week' : 'month');
																					} else if (item.id === 'clear-grouping') {
																						clearSidebarGrouping();
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
					{/* Bubble view is read-only; quick-create stays in the grid/list views only. */}
					{(sidebarView === 'notes' || sidebarView === 'trash' || sidebarView === 'images') ? (
						<div ref={topControlsRef} className="app-main-sticky">
							{sidebarView === 'notes' && viewMode !== 'bubble' && activeWorkspaceSystemKind !== 'SHARED_WITH_ME' ? (
						// Reserve the button-row height unconditionally so the grid
						// doesn't shift down when canCreateNotesInCurrentContext resolves.
						<div className="top-actions">
							<button
								type="button"
								className="top-action-card"
								disabled={!canCreateNotesInCurrentContext}
								onClick={() => {
									setSidebarView('notes');
									setIsQuickReminderOpen(true);
								}}
							>
								<FontAwesomeIcon icon={faBell} />
								{t('app.createQuickReminder')}
							</button>
							<button
								type="button"
								className="top-action-card"
								disabled={!canCreateNotesInCurrentContext}
								onClick={() => void openCreateEditorForCurrentContext('text')}
							>
								<FontAwesomeIcon icon={faFileLines} />
								{t('app.createNewNote')}
							</button>
							<button
								type="button"
								className="top-action-card"
								disabled={!canCreateNotesInCurrentContext}
								onClick={() => void openCreateEditorForCurrentContext('checklist')}
							>
								<FontAwesomeIcon icon={faListCheck} />
										{t('app.createNewChecklist')}
									</button>
							<button
								type="button"
								className="top-action-card"
								disabled={!canCreateNotesInCurrentContext}
								onClick={() => void openCreateEditorForCurrentContext('drawing')}
							>
								<FontAwesomeIcon icon={faPenNib} />
								{t('app.addNewDrawing')}
							</button>
								</div>
							) : null}

							<div className="note-grid-scope" aria-live="polite">
								{viewMode === 'bubble' && sidebarView !== 'images' ? (
									<div className="note-grid-scope-chip">
										<ScrollingScopeChipLabel value="All Workspaces" />
										<input
											type="range"
											className="note-grid-scope-slider"
											min={BUBBLE_ZOOM_MIN}
											max={BUBBLE_ZOOM_MAX}
											step={1}
											value={bubbleZoom}
											onChange={(event) => setBubbleZoom(Number(event.target.value))}
											// iOS PWA: touch-action:none prevents page-scroll interference but also
											// breaks WebKit's internal range-input drag handler. Instead we claim
											// pointer capture on pointerdown and manually compute the value from
											// clientX so the slider responds reliably to touch-drag on iOS.
											onPointerDown={(event) => {
												try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
											}}
											onPointerMove={(event) => {
												if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
												const rect = event.currentTarget.getBoundingClientRect();
												const relX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
												setBubbleZoom(Math.round(BUBBLE_ZOOM_MIN + relX * (BUBBLE_ZOOM_MAX - BUBBLE_ZOOM_MIN)));
											}}
											aria-label="Bubble zoom"
										/>
									</div>
								) : activeFilterChips.length === 0 ? (
									(sidebarView === 'trash' || sidebarView === 'archive' || sidebarView === 'images') ? (
										<div className="note-grid-scope-chip is-clearable">
											<ScrollingScopeChipLabel value={noteGridScopeLabel} />
											<button
												type="button"
												className="note-grid-scope-clear"
												onClick={exitSpecialSidebarView}
												aria-label={t('common.close')}
											>
												<FontAwesomeIcon icon={faXmark} />
											</button>
										</div>
									) : (
										<div className="note-grid-scope-chip">
											<ScrollingScopeChipLabel value={noteGridScopeLabel} />
										</div>
									)
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
										<ScrollingScopeChipLabel title={chip.title} value={chip.value} />
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
								{hasGlobalSearchResults && !isMobileViewport ? renderGlobalSearchResults('global-search-results--sticky') : null}
						</div>
					) : null}

					<section className="editor-panel">
						{/* Branch: text editor open. */}
						{editorMode === 'text' ? <TextEditor onSave={onSaveText} onCancel={closeCreateEditor} toolbarMode={editorToolbarModePref} /> : null}
						{/* Branch: checklist editor open. */}
						{editorMode === 'checklist' ? (
							<ChecklistEditor
								onSave={onSaveChecklist}
								onCancel={closeCreateEditor}
								onShowBriefDialog={showBriefDialog}
								initialShowCompleted={checklistShowCompletedPref}
								allowQuickDelete={quickDeleteChecklistPref}
								toolbarMode={editorToolbarModePref}
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
						noteReminderByDocId={noteReminderByDocId}
						sortMode={activeSortMode}
						sortDirection={activeSortDirection}
						sortGrouping={activeSortGrouping}
						refreshCollaboratorsToken={collaborationRefreshToken}
						maxCardHeightPx={maxCardHeightPx}
						noteCardCheckboxInteractions={noteCardCheckboxInteractionsPref}
						noteCardLinkInteractions={noteCardLinkInteractionsPref}
						noteCardCompletedInteractions={noteCardCompletedInteractionsPref}
						noteCardBannerTitlePosition={noteCardBannerTitlePositionPref}
						// When the trash view is active, NoteGrid switches to rendering trashed notes.
						showTrashed={sidebarView === 'trash'}
						showArchived={sidebarView === 'archive'}
						onAddCollaborator={canEditActiveWorkspace ? openCollaboratorModalForNote : undefined}
						onAddImage={openNoteImageModal}
						onAddDocument={(noteId) => {
							void createAttachedDrawing(noteId);
						}}
						onAddReminder={openNoteReminderModal}
						onAddToCollection={openNoteCollectionModal}
						onAddLabels={openNoteLabelsModal}
						onTrashNote={(noteId) => {
							void onDeleteSelectedNote(noteId);
						}}
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
										if (viewMode === 'list' || viewMode === 'strip') {
											setSelectedNoteId(null);
										}
								}}
						onSelectNote={(id) => {
							// Branch: selecting a note should close the create editor.
							openNoteEditor(id, { replaceTop: editorMode !== 'none' });
						}}
						// onViewportReady fires as soon as the viewport-visible cards are
						// measured and stable — much sooner than onReady on large workspaces.
						// Use it only for true cold starts. Warm starts and workspace switches
						// wait for onReady so cached hydration/repack tail and late chip rows
						// remain hidden behind the splash.
						onViewportReady={() => {
							if (splashDismissMode !== 'viewport') return;
							setGridReady(true);
							if (splashGone) return;
							// Give the CSS fade-out transition 500 ms to complete,
							// then unmount the overlay node entirely.
							clearTimeout(splashTimerRef.current);
							splashTimerRef.current = window.setTimeout(() => setSplashGone(true), 500);
						}}
						// onReady fires after ALL docs are loaded and the full layout has
						// settled. Warm starts and workspace switches dismiss here; cold
						// starts have usually already faded out via onViewportReady.
						onReady={() => {
							setGridReady(true);
							if (!splashGoneRef.current) {
								clearTimeout(splashTimerRef.current);
								splashTimerRef.current = window.setTimeout(() => setSplashGone(true), 500);
							}
						}}
						// Layout animations are managed internally by NoteGrid
						// (held until allDocsLoaded, then enabled after 2 rAFs).
						enableLayoutAnimations={true}
						// Device ID scopes the height cache so skeleton cards render
						// at the correct size for this device/viewport combination.
						deviceId={deviceId}
						layoutDensityKey={noteGridLayoutDensityKey}
						viewMode={viewMode === 'bubble' ? 'card' : viewMode}
						debugHostViewMode={viewMode}
						debugTransitionTraceId={viewTransitionTraceId}
						isVisible={viewMode !== 'bubble' && sidebarView !== 'images'}
						hiddenNoteId={draftNoteId}
						listScrollAnchor={listScrollAnchor}
						onListScrollAnchorApplied={handleListScrollAnchorApplied}
						loadDrawingDoc={loadDrawingDoc}
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
						noteReminderByDocId={noteReminderByDocId}
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
							sharedPlacements={visibleSharedPlacements}
							themeId={themeId}
							zoom={bubbleZoom}
							showTrashed={sidebarView === 'trash'}
							reminderFilter={activeReminderFilter}
							noteReminderByDocId={noteReminderByDocId}
							searchQuery={deferredSearchQuery}
							sidebarIsCollapsed={sidebarIsCollapsed}
							hiddenNoteId={draftNoteId}
							debugTransitionTraceId={viewTransitionTraceId}
							onSelectNote={handleBubbleNoteSelect}
							workspaceColorOverrides={bubbleWorkspaceColorOverrides}
						/>
					) : null}
				</main>
			</div>
			{crossWorkspaceNote ? (
				<CrossWorkspaceNoteModal
					noteId={crossWorkspaceNote.noteId}
					docId={crossWorkspaceDocId}
					workspaceId={crossWorkspaceNote.workspaceId}
					workspaceName={crossWorkspaceNote.workspaceName}
					themeId={themeId}
					authUserId={authUserId}
					websocketUrl={manager.getWebsocketUrl()}
					readOnly={crossWorkspaceReadOnly}
					onAddCollaborator={canManageCrossWorkspaceCollaborators ? ({ noteId, docId, title }) => openCollaboratorModalForNote(noteId, title, { docId, canManage: true }) : undefined}
					onAddImage={crossWorkspaceReadOnly ? undefined : ({ noteId, docId, title }) => openNoteImageModal(noteId, docId, title)}
					onAddDocument={undefined}
					onAddReminder={crossWorkspaceReadOnly ? undefined : ({ noteId, docId, title }) => openNoteReminderModal(noteId, docId, title)}
					onAddToCollection={crossWorkspaceReadOnly ? undefined : ({ noteId, doc, docId, title }) => openNoteCollectionModal(noteId, title, { docId, doc })}
					onAddLabels={crossWorkspaceReadOnly ? undefined : ({ noteId, doc, docId, title }) => openNoteLabelsModal(noteId, title, { docId, doc })}
					onShowBriefDialog={showBriefDialog}
					initialShowCompleted={checklistShowCompletedPref}
					allowQuickDelete={quickDeleteChecklistPref}
					onClose={closeCrossWorkspaceNote}
				/>
			) : null}
			{/* Bubble workspace color picker — rendered as a portal so it escapes
			    the sidebar's overflow:hidden clipping, regardless of scroll position. */}
			{bubbleColorPickerWorkspaceId && bubbleColorPickerAnchorRect ? ReactDOM.createPortal(
				<div
					ref={bubbleColorPickerRef}
					className="sidebar-bubble-color-picker"
					role="listbox"
					aria-label="Bubble color"
					style={(() => {
						const PICKER_HEIGHT = 162;
						const PICKER_WIDTH = 212;
						const MARGIN = 6;
						const spaceBelow = window.innerHeight - bubbleColorPickerAnchorRect.bottom;
						const top = spaceBelow >= PICKER_HEIGHT + MARGIN
							? bubbleColorPickerAnchorRect.bottom + MARGIN
							: bubbleColorPickerAnchorRect.top - PICKER_HEIGHT - MARGIN;
						const left = Math.min(
							bubbleColorPickerAnchorRect.left,
							window.innerWidth - PICKER_WIDTH - MARGIN,
						);
						return { top, left };
					})()}
					onMouseDown={(e) => e.stopPropagation()}
					onTouchStart={(e) => e.stopPropagation()}
				>
					{WORKSPACE_COLOR_TOKENS.map((token) => {
						const scheme = getWorkspaceBubbleColorSchemeOverridden(themeId, bubbleColorPickerWorkspaceId, { [bubbleColorPickerWorkspaceId]: token });
						const isSelected = bubbleWorkspaceColorOverrides[bubbleColorPickerWorkspaceId] === token;
						return (
							<button
								key={token}
								type="button"
								role="option"
								aria-selected={isSelected}
								className={`sidebar-bubble-color-picker-swatch${isSelected ? ' is-selected' : ''}`}
								style={toWorkspaceBubbleColorStyle(scheme)}
								title={token}
								onClick={(e) => {
									e.stopPropagation();
									handleBubbleWorkspaceColorChange(bubbleColorPickerWorkspaceId, token);
								}}
							/>
						);
					})}
				</div>,
				document.body,
			) : null}
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
			<NoteDrawingBrowserModal
				isOpen={noteAttachmentBrowserState?.kind === 'drawings'}
				doc={noteAttachmentBrowserState?.kind === 'drawings' ? activeAttachmentBrowserDoc : null}
				canEdit={noteAttachmentBrowserState?.kind === 'drawings' ? noteAttachmentBrowserState.canEdit : false}
				noteTitle={noteAttachmentBrowserState?.kind === 'drawings' ? noteAttachmentBrowserState.title : null}
				onClose={closeNoteAttachmentBrowser}
				onAddDrawing={noteAttachmentBrowserState?.kind === 'drawings' && noteAttachmentBrowserState.canEdit ? () => {
					void createAttachedDrawing(noteAttachmentBrowserState.noteId);
				} : undefined}
				onOpenDrawing={noteAttachmentBrowserState?.kind === 'drawings' ? (drawingId) => openAttachedDrawing(noteAttachmentBrowserState.noteId, drawingId) : undefined}
				onDeleteDrawing={noteAttachmentBrowserState?.kind === 'drawings' && noteAttachmentBrowserState.canEdit ? (drawingId) => deleteAttachedDrawing(noteAttachmentBrowserState.noteId, drawingId) : undefined}
				loadDrawingDoc={noteAttachmentBrowserState?.kind === 'drawings' ? drawingBrowserLoadDoc : undefined}
			/>
			<NoteImageUploadModal
				isOpen={Boolean(noteImageModalState)}
				docId={noteImageModalState?.docId ?? null}
				authUserId={authUserId}
				offlineMode={authOfflineMode}
				noteTitle={noteImageModalState?.title ?? null}
				onClose={closeNoteImageModal}
				onUploaded={(result) => showBriefDialog(
					result.queued
						? `${result.count} ${result.count === 1 ? t('media.queuedUploadToastSingular') : t('media.queuedUploadToastPlural')}`
						: (result.count === 1 ? t('media.addedToastSingular') : `${result.count} ${t('media.addedToastPlural')}`)
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

			{mobileFabOverlay}

			{/* Branch: selection exists but doc not yet loaded.
			   Mutual exclusion: suppress when a create editor is active to prevent
			   stacked overlays (both at z-index 220). */}
			{editorMode === 'none' && selectedNoteId && (!openDoc || openDocId !== selectedNoteId) ? (
				<div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 220, background: 'var(--color-overlay)' }}>
					<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
						{t('app.loadingEditor')}
					</div>
				</div>
			) : null}
			{/* Branch: single active editor for the selected note.
			   Same mutual exclusion guard as above. */}
			{editorMode === 'none' && selectedNoteId && openDoc && openDocId === selectedNoteId ? (
				String(openDoc.getMap<any>('metadata').get('type') ?? 'text') === 'drawing' ? (
					<DrawingEditorErrorBoundary
						fallback={
							<div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 220, background: 'var(--color-overlay)' }}>
								<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
									{t('app.loadingEditor')}
								</div>
							</div>
						}
					>
					<React.Suspense
						fallback={
							<div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 220, background: 'var(--color-overlay)' }}>
								<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
									{t('app.loadingEditor')}
								</div>
							</div>
						}
					>
						<DrawingEditor
							noteId={selectedNoteId}
							docId={selectedNoteDocId}
							themeId={themeId}
							doc={openDoc}
							awareness={manager.getAwareness(selectedNoteId)}
							onClose={closeNoteEditor}
							onSave={selectedNoteIsPendingNew ? saveDrawingEditor : closeNoteEditor}
							onDelete={onDeleteSelectedNote}
							onAddCollaborator={canManageSelectedNoteCollaborators ? () => openCollaboratorModalForNote(selectedNoteId, openDoc.getText('title').toString()) : undefined}
							onAddImage={selectedNoteReadOnly ? undefined : () => {
								if (!selectedNoteDocId) return;
								openNoteImageModal(selectedNoteId, selectedNoteDocId, openDoc.getText('title').toString());
							}}
							onAddReminder={selectedNoteReadOnly ? undefined : () => {
								if (!selectedNoteDocId) return;
								openNoteReminderModal(selectedNoteId, selectedNoteDocId, openDoc.getText('title').toString());
							}}
							onAddToCollection={selectedNoteReadOnly ? undefined : () => openNoteCollectionModal(selectedNoteId, openDoc.getText('title').toString(), { docId: selectedNoteDocId, doc: openDoc })}
							onAddLabels={selectedNoteReadOnly ? undefined : () => openNoteLabelsModal(selectedNoteId, openDoc.getText('title').toString(), { docId: selectedNoteDocId, doc: openDoc })}
							onTogglePin={selectedNoteReadOnly ? undefined : toggleSelectedNotePin}
							isPendingNew={selectedNoteIsPendingNew}
							readOnly={selectedNoteReadOnly}
						/>
					</React.Suspense>
					</DrawingEditorErrorBoundary>
				) : (
					<NoteEditor
						noteId={selectedNoteId}
						docId={selectedNoteDocId}
						authUserId={authUserId}
						themeId={themeId}
						doc={openDoc}
						quickCreateCollectionOption={selectedQuickCreateCollectionOption}
						onClose={closeNoteEditor}
						onSavePendingNew={selectedNoteIsPendingNew ? savePendingNewNoteAndClose : undefined}
						onDelete={onDeleteSelectedNote}
						isPendingNew={selectedNoteIsPendingNew}
						onAddCollaborator={canManageSelectedNoteCollaborators ? () => openCollaboratorModalForNote(selectedNoteId, openDoc.getText('title').toString()) : undefined}
						onAddImage={selectedNoteReadOnly ? undefined : () => {
							if (!selectedNoteDocId) return;
							openNoteImageModal(selectedNoteId, selectedNoteDocId, openDoc.getText('title').toString());
						}}
						onAddDocument={selectedNoteReadOnly ? undefined : () => {
							void createAttachedDrawing(selectedNoteId);
						}}
						onOpenDrawing={(drawingId) => openAttachedDrawing(selectedNoteId, drawingId)}
						onDeleteDrawing={selectedNoteReadOnly ? undefined : (drawingId) => deleteAttachedDrawing(selectedNoteId, drawingId)}
						loadDrawingDoc={(drawingId) => loadDrawingDoc(selectedNoteId, drawingId)}
						onAddReminder={selectedNoteReadOnly ? undefined : () => openNoteReminderModal(selectedNoteId, selectedNoteDocId, openDoc.getText('title').toString())}
						onAddToCollection={selectedNoteReadOnly ? undefined : () => openNoteCollectionModal(selectedNoteId, openDoc.getText('title').toString(), { docId: selectedNoteDocId, doc: openDoc })}
						onAddLabels={selectedNoteReadOnly ? undefined : () => openNoteLabelsModal(selectedNoteId, openDoc.getText('title').toString(), { docId: selectedNoteDocId, doc: openDoc })}
						onTogglePin={selectedNoteReadOnly ? undefined : toggleSelectedNotePin}
						onShowBriefDialog={showBriefDialog}
						readOnly={selectedNoteReadOnly}
						initialShowCompleted={checklistShowCompletedPref}
						allowQuickDelete={quickDeleteChecklistPref}
						toolbarMode={editorToolbarModePref}
						hideFormattingToolbar={Boolean(noteImageModalState)}
						onShowCompletedChange={(next) => {
							commitChecklistShowCompletedPref(next);
						}}
					/>
				)
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
				editorToolbarMode={editorToolbarModePref}
				noteCardCheckboxInteractions={noteCardCheckboxInteractionsPref}
				noteCardLinkInteractions={noteCardLinkInteractionsPref}
				noteCardCompletedInteractions={noteCardCompletedInteractionsPref}
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
				onEditorToolbarModeChange={(next) => {
					commitEditorToolbarModePref(next);
				}}
				onNoteCardCheckboxInteractionsChange={(next) => {
					commitNoteCardCheckboxInteractionsPref(next);
				}}
				onNoteCardLinkInteractionsChange={(next) => {
					commitNoteCardLinkInteractionsPref(next);
				}}
				onNoteCardCompletedInteractionsChange={(next) => {
					commitNoteCardCompletedInteractionsPref(next);
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
				showUserManagement={isGlobalAdmin}
				userManagementDisabled={isGlobalAdmin && isUserManagementOffline}
				showSendInvite={isGlobalAdmin}
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
				onCreate={handleCreateCollection}
				onRename={handleRenameCollection}
				onDelete={handleDeleteCollection}
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
				onUpdateLabel={handleUpdateLabel}
				onDeleteLabel={handleDeleteLabel}
			/>

			<NoteLabelsModal
				isOpen={Boolean(labelManagementModalState)}
				onClose={() => setLabelManagementModalState(null)}
				labels={labels}
				onCreateLabel={handleCreateLabel}
				onUpdateLabel={handleUpdateLabel}
				onDeleteLabel={handleDeleteLabel}
				showSelection={false}
			/>

			<ReminderModal
				isOpen={Boolean(noteReminderModalState)}
				onClose={() => setNoteReminderModalState(null)}
				reminderAt={readReminderLookupValue(noteReminderByDocId, noteReminderModalState?.docId, noteReminderModalState?.noteId ?? null)}
				noteTitle={noteReminderModalState?.title}
				onSave={handleSaveNoteReminder}
			/>

			<QuickReminderModal
				isOpen={isQuickReminderOpen}
				onClose={() => setIsQuickReminderOpen(false)}
				onSave={(value) => {
					void handleCreateQuickReminder(value);
				}}
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
				noteCardBannerTitlePosition={noteCardBannerTitlePositionPref}
				onNoteCardBannerTitlePositionChange={handleNoteCardBannerTitlePositionChange}
				onNoteCardBannerTitlePositionCommit={commitNoteCardBannerTitlePositionChange}
			/>

			<UserRegistrationInviteModal
				isOpen={isSendInviteOpen && sendInviteContext?.kind === 'registration'}
				onClose={() => {
					if (goBackIfOverlayHistory()) return;
					setIsSendInviteOpen(false);
				}}
				t={t}
			/>

			<SendInviteModal
				isOpen={isSendInviteOpen && sendInviteContext?.kind === 'workspace'}
				onClose={() => {
					if (goBackIfOverlayHistory()) return;
					setIsSendInviteOpen(false);
				}}
				t={t}
				authUserId={authUserId}
				authProfileImage={authProfileImage}
				workspaceId={sendInviteContext?.kind === 'workspace' ? sendInviteContext.workspaceId : authWorkspaceId}
				workspaceName={sendInviteContext?.kind === 'workspace' ? sendInviteContext.workspaceName : activeWorkspaceName}
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
				// Clearing failed-link notifications: persist the dismissed IDs so the
				// entries don't re-appear on the next refreshNoteShareState call, and
				// subtract their count from the badge immediately.
				onClearFailedLinks={() => {
					const ids = failedLinkNotifications.map((f) => f.id);
					if (ids.length > 0) {
						const next = new Set([...dismissedFailedLinkIdsRef.current, ...ids]);
						dismissedFailedLinkIdsRef.current = next;
						if (authUserId) {
							try {
								localStorage.setItem(`freemannotes.dismissedFailedLinks.v2:${authUserId}`, JSON.stringify([...next]));
							} catch { /* ignore */ }
							void updateUserPreferences(deviceId, {
								dismissedFailedLinkIds: Object.fromEntries([...next].map((id) => [id, true] as const)),
							});
						}
					}
					setPendingShareNotificationCount((prev) => Math.max(0, prev - failedLinkNotifications.length));
					setFailedLinkNotifications([]);
				}}
				onOpenReminder={(reminder) => {
					setIsShareNotificationsOpen(false);
					void (async () => {
						if (reminder.workspaceId && reminder.workspaceId !== authWorkspaceId) {
							await activateWorkspaceFromSidebar(reminder.workspaceId, { activeSharedFolder: null });
						}
						if (reminder.noteId) {
							const mobileOverlay = shouldUseMobileOverlayHistory(isMobileViewport);
							openNoteEditor(reminder.noteId, {
								fromExternalDeepLink: mobileOverlay,
								replaceTop: !mobileOverlay,
							});
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
				onAccessRemoved={handleCollaboratorAccessRemoved}
				onSelfRemoved={handleCollaboratorSelfRemoved}
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
				onBeforeWorkspaceDelete={handleBeforeWorkspaceDelete}
				onWorkspaceDeleted={(deletedWorkspaceId, nextActiveWorkspaceId) => void handleWorkspaceDeleted(deletedWorkspaceId, nextActiveWorkspaceId)}
				onActiveWorkspaceRenamed={() => void refreshActiveWorkspace()}
				onBeforeWorkspaceActivated={() => {
					// Disable WS before switching room namespaces. The new workspace's
					// rooms must not connect until the server session cookie is updated.
					manager.setWebsocketEnabled(false);
				}}
				onWorkspaceActivationComplete={(workspaceId) => {
					// Server confirmed the new session cookie — safe to open WS rooms.
					if (manager.getActiveWorkspaceId() === workspaceId) {
						manager.setWebsocketEnabled(true);
					}
				}}
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
