'use strict';

// "Live workspace" helpers centralize the rule that deleted/tombstoned workspaces
// must disappear from every auth/workspace-resolution path. Callers use these
// instead of raw Prisma lookups so reconnect flows never reactivate a workspace
// that has already been soft-deleted for the user.

/**
 * Return the caller's membership for a workspace only if the workspace is still live.
 * Null means either "not a member" or "workspace has already been deleted".
 */
async function findLiveWorkspaceMembership(prisma, userId, workspaceId, select = { role: true }) {
	if (!prisma || !userId || !workspaceId) return null;
	return prisma.workspaceMember.findFirst({
		where: {
			userId,
			workspaceId,
			workspace: { is: { deletedAt: null } },
		},
		select,
	});
}

/**
 * Find the first remaining live workspace for a user.
 * This is the fallback when the preferred workspace was deleted and we need a
 * deterministic next active workspace for cookies/device preferences.
 */
async function findFirstLiveWorkspaceMembership(prisma, userId, select = { workspaceId: true }) {
	if (!prisma || !userId) return null;
	return prisma.workspaceMember.findFirst({
		where: {
			userId,
			workspace: { is: { deletedAt: null } },
		},
		orderBy: { workspaceId: 'asc' },
		select,
	});
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
	resolveLiveWorkspaceId,
};