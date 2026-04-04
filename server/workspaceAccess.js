'use strict';

const { findPreferredWorkspaceMembership } = require('./systemWorkspaces');

// "Live workspace" helpers centralize the rule that deleted/tombstoned workspaces
// must disappear from every auth/workspace-resolution path. Callers use these
// instead of raw Prisma lookups so reconnect flows never reactivate a workspace
// that has already been soft-deleted for the user.

// ─── In-memory membership cache ─────────────────────────────────────────────
// Short-lived TTL cache to avoid repeating the same WorkspaceMember.findFirst
// query hundreds of times during bursts of WS connections and API requests from
// the same authenticated user+workspace pair. Entries expire after CACHE_TTL_MS
// and are evicted eagerly on read. The cache stores resolved membership objects
// or explicit `null` (meaning "not a member or workspace deleted") so negative
// lookups are also cached.
const MEMBERSHIP_CACHE_TTL_MS = 30_000;
const _membershipCache = new Map();

function _membershipCacheKey(userId, workspaceId) {
	return `${userId}\0${workspaceId}`;
}

function _getCachedMembership(userId, workspaceId) {
	const key = _membershipCacheKey(userId, workspaceId);
	const entry = _membershipCache.get(key);
	if (!entry) return undefined; // cache miss
	if (Date.now() > entry.expiresAt) {
		_membershipCache.delete(key);
		return undefined; // expired
	}
	return entry.value; // may be null (negative cache)
}

function _setCachedMembership(userId, workspaceId, value) {
	const key = _membershipCacheKey(userId, workspaceId);
	_membershipCache.set(key, { value, expiresAt: Date.now() + MEMBERSHIP_CACHE_TTL_MS });
}

/**
 * Invalidate cached membership for a user+workspace pair. Call this when
 * membership changes (invite acceptance, role change, workspace deletion).
 */
function invalidateMembershipCache(userId, workspaceId) {
	if (userId && workspaceId) {
		_membershipCache.delete(_membershipCacheKey(userId, workspaceId));
	}
}

/**
 * Return the caller's membership for a workspace only if the workspace is still live.
 * Null means either "not a member" or "workspace has already been deleted".
 *
 * Results are cached for MEMBERSHIP_CACHE_TTL_MS to avoid redundant DB queries
 * during bursts of WS connections and API requests. Only the `{ role: true }`
 * select shape is cacheable; other select shapes bypass the cache.
 */
async function findLiveWorkspaceMembership(prisma, userId, workspaceId, select = { role: true }) {
	if (!prisma || !userId || !workspaceId) return null;

	// Only cache the common `{ role: true }` select shape to keep the cache simple.
	const isRoleSelect = select && Object.keys(select).length === 1 && select.role === true;
	if (isRoleSelect) {
		const cached = _getCachedMembership(userId, workspaceId);
		if (cached !== undefined) return cached;
	}

	const result = await prisma.workspaceMember.findFirst({
		where: {
			userId,
			workspaceId,
			workspace: { is: { deletedAt: null } },
		},
		select,
	});

	if (isRoleSelect) {
		_setCachedMembership(userId, workspaceId, result);
	}

	return result;
}

/**
 * Find the first remaining live workspace for a user.
 * This is the fallback when the preferred workspace was deleted and we need a
 * deterministic next active workspace for cookies/device preferences.
 */
async function findFirstLiveWorkspaceMembership(prisma, userId, select = { workspaceId: true }) {
	if (!prisma || !userId) return null;
	return findPreferredWorkspaceMembership(prisma, userId, select);
}

/**
 * Resolve the workspace the user should land in after a workspace loss event.
 * Prefer the requested workspace if it is still live; otherwise fall back to the
 * first remaining live membership. Return null when the user has none left.
 */
async function resolveLiveWorkspaceId(prisma, userId, preferredWorkspaceId = null) {
	if (!prisma || !userId) return null;
	if (preferredWorkspaceId) {
		const preferred = await findLiveWorkspaceMembership(prisma, userId, preferredWorkspaceId, { workspaceId: true });
		if (preferred && preferred.workspaceId) {
			return String(preferred.workspaceId);
		}
	}
	const fallback = await findFirstLiveWorkspaceMembership(prisma, userId, { workspaceId: true });
	return fallback && fallback.workspaceId ? String(fallback.workspaceId) : null;
}

/**
 * Fetch a workspace only when it has not been tombstoned.
 * This keeps callers from branching on deletedAt themselves in every route.
 */
async function findLiveWorkspace(prisma, workspaceId, select = undefined) {
	if (!prisma || !workspaceId) return null;
	return prisma.workspace.findFirst({
		where: { id: workspaceId, deletedAt: null },
		...(select ? { select } : {}),
	});
}

module.exports = {
	findFirstLiveWorkspaceMembership,
	findLiveWorkspace,
	findLiveWorkspaceMembership,
	invalidateMembershipCache,
	resolveLiveWorkspaceId,
};