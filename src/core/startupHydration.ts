import type { DocumentManager } from './DocumentManager';
import { logClientEvent } from './debugLogger';
import { getDeviceId } from './deviceId';
import { readCachedDeviceAppearancePreferences, type CachedDeviceAppearancePreferences } from './deviceAppearancePreferences';
import { getNoteBannerAssetUrl } from './noteBannerApi';
import { readNoteBannerWarmCache } from './noteBannerWarmCache';
import { readUserNoteBannerPrefsSnapshot } from './noteBannerPreferences';
import { readNoteOrderSnapshot } from './noteOrderSnapshot';
import { readCachedReminderStates } from './reminderCache';
import type { ThemeId } from './theme';
import { readWorkspaceSelectionCache } from './workspaceSelectionCache';
import { readWorkspaceListLocalCache } from './workspaceListLocalCache';
import { readCachedWorkspaceSnapshot, type CachedWorkspaceSnapshot, type CachedWorkspaceListItem } from './workspaceMetadataStore';
import { readWorkspaceRenderSnapshot } from './workspaceRenderSnapshot';
import { getCollectionsRegistryDoc, readCollectionsFromDoc, type CollectionRecord } from '../services/collectionService';
import { getLabelsRegistryDoc, readLabelsFromDoc, type LabelRecord } from '../services/labelService';
import type { NoteReminderState } from './pushApi';
import type { ViewMode } from './viewMode';

type AuthCacheShape = {
	v?: unknown;
	userId?: unknown;
	workspaceId?: unknown;
};

export type StartupHydrationSnapshot = {
	deviceId: string;
	userId: string | null;
	workspaceId: string | null;
	hasWarmCache: boolean;
	workspaceSnapshot: CachedWorkspaceSnapshot | null;
	workspaceList: readonly CachedWorkspaceListItem[];
	deviceAppearance: CachedDeviceAppearancePreferences | null;
	reminderStates: readonly NoteReminderState[];
	noteOrderIds: readonly string[];
	collections: readonly CollectionRecord[];
	labels: readonly LabelRecord[];
	hydratedAt: number;
};

const STARTUP_BANNER_SCAN_LIMIT = 24;
const STARTUP_BANNER_PRELOAD_LIMIT: Record<ViewMode, number> = {
	bubble: 0,
	card: 8,
	list: 12,
	strip: 12,
	inbox: 0,
};

function buildStartupHydrationBase(): Omit<StartupHydrationSnapshot, 'workspaceSnapshot' | 'collections' | 'labels' | 'hydratedAt'> {
	const deviceId = getDeviceId();
	const cachedAuth = readCachedAuth();
	const cachedWorkspaceSelection = readWorkspaceSelectionCache();
	const userId = cachedAuth.userId;
	// Prefer the last workspace explicitly selected for this user, but fall back
	// to the auth cache so cold boots still open a plausible workspace quickly.
	const workspaceId =
		cachedWorkspaceSelection?.workspaceId && cachedWorkspaceSelection.userId === cachedAuth.userId
			? cachedWorkspaceSelection.workspaceId
			: cachedAuth.workspaceId;
	const workspaceList = readWorkspaceListLocalCache(userId || '');
	const deviceAppearance = readCachedDeviceAppearancePreferences(deviceId, userId);
	const reminderStates = readCachedReminderStates(userId || '');
	const noteOrderIds = workspaceId ? readNoteOrderSnapshot(workspaceId) : [];
	const hasWarmCache = Boolean(
		workspaceList.length > 0 ||
		reminderStates.length > 0 ||
		noteOrderIds.length > 0
	);

	return {
		deviceId,
		userId,
		workspaceId,
		hasWarmCache,
		workspaceList,
		deviceAppearance,
		reminderStates,
		noteOrderIds,
	};
}

export function readSynchronousStartupHydrationSnapshot(): StartupHydrationSnapshot {
	const hydratedAt = Date.now();
	const base = buildStartupHydrationBase();
	return {
		...base,
		workspaceSnapshot: null,
		collections: [],
		labels: [],
		hydratedAt,
	};
	}

function readCachedAuth(): { userId: string | null; workspaceId: string | null } {
	if (typeof window === 'undefined') return { userId: null, workspaceId: null };
	try {
		const raw = window.localStorage.getItem('freemannotes.auth.cache.v1');
		if (!raw) return { userId: null, workspaceId: null };
		const parsed = JSON.parse(raw) as AuthCacheShape | null;
		if (!parsed || parsed.v !== 1) return { userId: null, workspaceId: null };
		return {
			userId: typeof parsed.userId === 'string' && parsed.userId ? parsed.userId : null,
			workspaceId: typeof parsed.workspaceId === 'string' && parsed.workspaceId ? parsed.workspaceId : null,
		};
	} catch {
		return { userId: null, workspaceId: null };
	}
}

async function safeIdbLoad<T>(label: string, loader: () => Promise<T>, fallback: T): Promise<T> {
	const startedAt = Date.now();
	try {
		const value = await loader();
		void logClientEvent('IDB_LOAD', { label, status: 'success', latencyMs: Date.now() - startedAt });
		return value;
	} catch (error) {
		void logClientEvent('IDB_LOAD', {
			label,
			status: 'error',
			latencyMs: Date.now() - startedAt,
			error: error instanceof Error ? error.message : String(error),
		});
		return fallback;
	}
}

export async function hydrateStartupSnapshot(manager: DocumentManager): Promise<StartupHydrationSnapshot> {
	const hydratedAt = Date.now();
	const base = buildStartupHydrationBase();
	const { deviceId, userId, workspaceId } = base;
	void logClientEvent('HYDRATION_START', { deviceId, userId, workspaceId });

	// Start from synchronous cache reads, then opportunistically deepen the
	// snapshot from IndexedDB-backed registries without blocking first paint.
	const workspaceSnapshot = userId
		? await safeIdbLoad('workspaceSnapshot', () => readCachedWorkspaceSnapshot(userId, deviceId), null)
		: null;
	const workspaceList = workspaceSnapshot?.workspaces?.length
		? workspaceSnapshot.workspaces
		: base.workspaceList;
	const deviceAppearance = base.deviceAppearance;
	const reminderStates = base.reminderStates;
	const noteOrderIds = [...base.noteOrderIds];

	let collections: CollectionRecord[] = [];
	let labels: LabelRecord[] = [];
	if (workspaceId) {
		collections = await safeIdbLoad('collectionsRegistry', async () => {
			const doc = await getCollectionsRegistryDoc(manager);
			return readCollectionsFromDoc(doc);
		}, []);
		labels = await safeIdbLoad('labelsRegistry', async () => {
			const doc = await getLabelsRegistryDoc(manager);
			return readLabelsFromDoc(doc);
		}, []);
		if (noteOrderIds.length === 0) {
			const hydratedNoteOrderIds = await safeIdbLoad('noteOrder', async () => {
				const noteOrder = await manager.getNoteOrder();
				return noteOrder.toArray().map((id) => String(id || '')).filter(Boolean);
			}, [] as string[]);
			noteOrderIds.push(...hydratedNoteOrderIds);
		}
	}

	const hasWarmCache = Boolean(
		workspaceList.length > 0 ||
		collections.length > 0 ||
		labels.length > 0 ||
		reminderStates.length > 0 ||
		noteOrderIds.length > 0
	);

	void logClientEvent('HYDRATION_END', {
		deviceId,
		userId,
		workspaceId,
		hasWarmCache,
		workspaceCount: workspaceList.length,
		collectionCount: collections.length,
		labelCount: labels.length,
		reminderCount: reminderStates.length,
		noteOrderCount: noteOrderIds.length,
		latencyMs: Date.now() - hydratedAt,
	});

	return {
		deviceId,
		userId,
		workspaceId,
		hasWarmCache,
		workspaceSnapshot,
		workspaceList,
		deviceAppearance,
		reminderStates,
		noteOrderIds,
		collections,
		labels,
		hydratedAt,
	};
}

/**
 * Returns docIds (workspace-prefixed room names) for the first SCAN_LIMIT notes in the
 * render snapshot that have at least one image attachment. Used to preload image metadata
 * from IDB into the in-memory remoteCache before createRoot() so cards don't start blank.
 * Mirrors the docId format from DocumentManager.roomNameFor: `${workspaceId}:${noteId}`.
 */
export function readSynchronousWarmStartupMediaDocIds(limit = 16): string[] {
	const base = buildStartupHydrationBase();
	if (!base.hasWarmCache || !base.workspaceId) return [];
	const renderSnapshot = readWorkspaceRenderSnapshot(base.workspaceId);
	if (!renderSnapshot?.notes?.length) return [];
	const docIds: string[] = [];
	for (const note of renderSnapshot.notes) {
		if ((note.attachmentCounts?.images ?? 0) > 0 && !note.id.startsWith('shared-placement:')) {
			docIds.push(`${base.workspaceId}:${note.id}`);
			if (docIds.length >= limit) break;
		}
	}
	return docIds;
}

export function readSynchronousWarmStartupBannerUrls(themeId: ThemeId | null | undefined, viewMode: ViewMode): string[] {
	if (viewMode === 'bubble') return [];
	const preloadLimit = STARTUP_BANNER_PRELOAD_LIMIT[viewMode];
	if (preloadLimit <= 0) return [];

	const base = buildStartupHydrationBase();
	if (!base.hasWarmCache || !base.userId || !base.workspaceId) return [];

	const noteBannerPrefs = readUserNoteBannerPrefsSnapshot(base.userId);
	// The warm cache is read here only to extend preloading when legacy prefs are
	// already active. DO NOT use it to open the preload gate on its own:
	// the warm cache persists across sessions, so non-empty warm cache would block
	// createRoot() on up to 900 ms of banner image decoding on every warm start for
	// users who ever changed a banner. The snapshot-doc fix in
	// createSnapshotDocFromWorkspaceRenderSnapshot handles first-paint correctness
	// without blocking startup.
	const noteBannerWarmCache = readNoteBannerWarmCache();

	// Preserve original gate: only legacy per-user prefs open the preload path.
	// Shared banners (Yjs metadata) are handled by the snapshot-doc warm-cache fix
	// and must NOT gate createRoot() here.
	if (Object.keys(noteBannerPrefs).length === 0) return [];

	const renderSnapshot = readWorkspaceRenderSnapshot(base.workspaceId);
	const orderedIdsSource = renderSnapshot?.orderedIds.length ? renderSnapshot.orderedIds : base.noteOrderIds;
	if (orderedIdsSource.length === 0) return [];
	const renderSnapshotNotesById = new Map((renderSnapshot?.notes ?? []).map((note) => [note.id, note]));

	const urls: string[] = [];
	const seen = new Set<string>();
	for (const noteId of orderedIdsSource.slice(0, STARTUP_BANNER_SCAN_LIMIT)) {
		if (noteId.startsWith('shared-placement:')) continue;
		const snapshotNote = renderSnapshotNotesById.get(noteId);

		// Warm cache takes priority over the render snapshot (it may reflect a recent
		// pick not yet saved). Falls back to shared-banner render-snapshot entry then
		// to legacy user prefs. This path is only reached when noteBannerPrefs is
		// non-empty, so the user has legacy prefs and banners are likely HTTP-cached.
		let fileName: string | null;
		if (noteId in noteBannerWarmCache) {
			fileName = noteBannerWarmCache[noteId];
		} else if (snapshotNote?.hasSharedBannerPreference) {
			fileName = snapshotNote.bannerFile ?? null;
		} else {
			fileName = noteBannerPrefs[noteId] ?? null;
		}
		if (!fileName) continue;
		const url = getNoteBannerAssetUrl(fileName, themeId, viewMode === 'card' ? 'card' : 'list');
		if (seen.has(url)) continue;
		seen.add(url);
		urls.push(url);
		if (urls.length >= preloadLimit) break;
	}

	return urls;
}