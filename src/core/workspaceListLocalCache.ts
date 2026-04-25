/**
 * workspaceListLocalCache.ts
 *
 * Per-user localStorage snapshot of the workspace list.
 *
 * Purpose: `sidebarWorkspaces` is populated from an async IDB read + optional
 * network fetch. On app launch this leaves the sidebar empty for a visible
 * moment. By persisting the last-known workspace list to localStorage (keyed
 * by userId) we can seed the sidebar synchronously on the very first render.
 *
 * Storage key format: freemannotes.workspaceListCache.v1.<userId>
 * Value: JSON array of CachedWorkspaceListItem
 *
 * The cache is best-effort: once the real IDB/network data arrives it
 * overwrites both the UI state and this cache. On logout the cache is cleared
 * so a different user logging in on the same device sees a clean sidebar.
 */

import type { CachedWorkspaceListItem } from './workspaceMetadataStore';

const STORAGE_KEY_PREFIX = 'freemannotes.workspaceListCache.v1.';

/**
 * Returns the cached workspace list for the given userId.
 * Returns [] if nothing is cached or the value is malformed.
 */
export function readWorkspaceListLocalCache(userId: string): readonly CachedWorkspaceListItem[] {
	if (!userId) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY_PREFIX + userId);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		// Basic validation: each entry must have at least an id and name string.
		return (parsed as unknown[]).filter(
			(v): v is CachedWorkspaceListItem =>
				typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).id === 'string' && typeof (v as Record<string, unknown>).name === 'string',
		);
	} catch {
		return [];
	}
}

/**
 * Persists the workspace list for the given userId.
 * Silently swallows storage-quota errors.
 */
export function writeWorkspaceListLocalCache(userId: string, workspaces: readonly CachedWorkspaceListItem[]): void {
	if (!userId) return;
	try {
		localStorage.setItem(STORAGE_KEY_PREFIX + userId, JSON.stringify(workspaces));
	} catch {
		// Quota exceeded — ignore; the cache is an optional perf hint.
	}
}

/**
 * Clears the workspace list cache for the given userId (called on logout so
 * a different user on the same device starts with a clean sidebar).
 */
export function clearWorkspaceListLocalCache(userId: string): void {
	if (!userId) return;
	try {
		localStorage.removeItem(STORAGE_KEY_PREFIX + userId);
	} catch {
		// Ignore storage errors.
	}
}

