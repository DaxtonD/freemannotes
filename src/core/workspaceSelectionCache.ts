/**
 * Persistent localStorage cache for the user's workspace selection.
 *
 * Kept separate from the auth cache (freemannotes.auth.cache.v1) so that workspace
 * switches made while offline — or before the server session is re-activated on
 * reconnect — are not silently overwritten when auth.cache is refreshed from the
 * server response.
 *
 * The cache is keyed by userId so that a device shared between users never loads
 * a stale selection from a previous session.
 */
export type WorkspaceSelectionCacheV1 = {
	v: 1;
	userId: string;
	workspaceId: string | null;
	activeSharedFolder: string | null;
};

const WORKSPACE_SELECTION_CACHE_KEY = 'freemannotes.workspace.selection.cache.v1';

/** Read the persisted workspace selection, or null if absent / malformed. */
export function readWorkspaceSelectionCache(): WorkspaceSelectionCacheV1 | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(WORKSPACE_SELECTION_CACHE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<WorkspaceSelectionCacheV1>;
		if (parsed?.v !== 1) return null;
		const userId = typeof parsed.userId === 'string' ? parsed.userId : '';
		const workspaceId = typeof parsed.workspaceId === 'string' ? parsed.workspaceId : null;
		const activeSharedFolder = typeof parsed.activeSharedFolder === 'string' ? parsed.activeSharedFolder : null;
		if (!userId) return null;
		return { v: 1, userId, workspaceId, activeSharedFolder };
	} catch {
		return null;
	}
}

/**
 * Persist the user's current workspace selection.
 * Pass `activeSharedFolder: undefined` to preserve the existing shared-folder value.
 */
export function writeWorkspaceSelectionCache(args: {
	userId: string;
	workspaceId: string | null;
	activeSharedFolder?: string | null;
}): void {
	if (typeof window === 'undefined' || !args.userId) return;
	try {
		const existing = readWorkspaceSelectionCache();
		const next: WorkspaceSelectionCacheV1 = {
			v: 1,
			userId: args.userId,
			workspaceId: args.workspaceId,
			activeSharedFolder:
				typeof args.activeSharedFolder === 'undefined'
					? existing?.userId === args.userId ? existing.activeSharedFolder ?? null : null
					: args.activeSharedFolder ?? null,
		};
		window.localStorage.setItem(WORKSPACE_SELECTION_CACHE_KEY, JSON.stringify(next));
	} catch {
		// ignore
	}
}

/** Remove the workspace selection cache entry (e.g. on sign-out with no preserved workspace). */
export function clearWorkspaceSelectionCache(): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.removeItem(WORKSPACE_SELECTION_CACHE_KEY);
	} catch {
		// ignore
	}
}