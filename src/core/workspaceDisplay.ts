type WorkspaceDisplayInput = {
	name?: string | null;
	ownerUserId?: string | null;
	systemKind?: string | null;
};

const LEGACY_PERSONAL_NAME_RE = /^Personal \([0-9a-f-]{36}\)$/i;
const LEGACY_SHARED_WITH_ME_NAME_RE = /^Shared With Me \([0-9a-f-]{36}\)$/i;

/**
 * Returns true when the workspace is the user's automatically-created personal
 * workspace (name stored as "Personal (<userId>)" in the DB).
 * Used by sort logic to pin Personal before Shared With Me and user workspaces.
 */
export function isPersonalWorkspace(workspace: WorkspaceDisplayInput | null | undefined): boolean {
	if (!workspace) return false;
	// Prefer the canonical system kind marker set by the schema migration.
	// IMPORTANT: Always check systemKind first.  The name-pattern fallback below
	// exists only for workspaces that predate the PERSONAL enum value.  Do not
	// remove either branch — old production databases may still have unbackfilled rows.
	if (workspace.systemKind === 'PERSONAL') return true;
	// Legacy fallback: workspaces that match the old name pattern but predate the
	// PERSONAL enum value (created before migration or backfill missed a rename).
	const rawName = typeof workspace.name === 'string' ? workspace.name.trim() : '';
	return Boolean(workspace.ownerUserId && LEGACY_PERSONAL_NAME_RE.test(rawName));
}

export function getWorkspaceDisplayName(
	workspace: WorkspaceDisplayInput | null | undefined,
	t: (key: string) => string
): string {
	// Display normalization keeps the database/storage layer stable while the UI
	// hides legacy UUID-suffixed workspace names from users.
	if (!workspace) return t('workspace.unnamed');
	if (workspace.systemKind === 'PERSONAL') return t('workspace.personal');
	if (workspace.systemKind === 'SHARED_WITH_ME') return t('workspace.sharedWithMe');

	const rawName = typeof workspace.name === 'string' ? workspace.name.trim() : '';
	if (!rawName) return t('workspace.unnamed');
	if (workspace.ownerUserId && LEGACY_PERSONAL_NAME_RE.test(rawName)) return t('workspace.personal');
	if (LEGACY_SHARED_WITH_ME_NAME_RE.test(rawName)) return t('workspace.sharedWithMe');
	return rawName;
}