import type { DocumentManager } from './DocumentManager';
import { logClientEvent } from './debugLogger';
import { getDeviceId } from './deviceId';
import { readCachedDeviceAppearancePreferences, type CachedDeviceAppearancePreferences } from './deviceAppearancePreferences';
import { readNoteOrderSnapshot } from './noteOrderSnapshot';
import { readCachedReminderStates } from './reminderCache';
import { readWorkspaceSelectionCache } from './workspaceSelectionCache';
import { readWorkspaceListLocalCache } from './workspaceListLocalCache';
import { readCachedWorkspaceSnapshot, type CachedWorkspaceSnapshot, type CachedWorkspaceListItem } from './workspaceMetadataStore';
import { getCollectionsRegistryDoc, readCollectionsFromDoc, type CollectionRecord } from '../services/collectionService';
import { getLabelsRegistryDoc, readLabelsFromDoc, type LabelRecord } from '../services/labelService';
import type { NoteReminderState } from './pushApi';

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
	const deviceId = getDeviceId();
	const cachedAuth = readCachedAuth();
	const cachedWorkspaceSelection = readWorkspaceSelectionCache();
	const userId = cachedAuth.userId;
	const workspaceId =
		cachedWorkspaceSelection?.workspaceId && cachedWorkspaceSelection.userId === cachedAuth.userId
			? cachedWorkspaceSelection.workspaceId
			: cachedAuth.workspaceId;
	void logClientEvent('HYDRATION_START', { deviceId, userId, workspaceId });

	const workspaceSnapshot = userId
		? await safeIdbLoad('workspaceSnapshot', () => readCachedWorkspaceSnapshot(userId, deviceId), null)
		: null;
	const workspaceList = workspaceSnapshot?.workspaces?.length
		? workspaceSnapshot.workspaces
		: readWorkspaceListLocalCache(userId || '');
	const deviceAppearance = readCachedDeviceAppearancePreferences(deviceId, userId);
	const reminderStates = readCachedReminderStates(userId || '');
	const noteOrderIds = workspaceId ? readNoteOrderSnapshot(workspaceId) : [];

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