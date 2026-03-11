export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

export function normalizeWorkspaceRole(value: unknown, fallback: WorkspaceRole = 'VIEWER'): WorkspaceRole {
	const normalized = typeof value === 'string' ? value.trim().toUpperCase() : String(value ?? '').trim().toUpperCase();
	if (normalized === 'OWNER') return 'OWNER';
	if (normalized === 'ADMIN') return 'ADMIN';
	if (normalized === 'EDITOR') return 'EDITOR';
	if (normalized === 'VIEWER') return 'VIEWER';
	if (normalized === 'MEMBER') return 'VIEWER';
	return fallback;
}

export function isWorkspaceOwner(role: unknown): boolean {
	return normalizeWorkspaceRole(role, 'VIEWER') === 'OWNER';
}

export function canManageWorkspace(role: unknown): boolean {
	const normalized = normalizeWorkspaceRole(role, 'VIEWER');
	return normalized === 'OWNER' || normalized === 'ADMIN';
}

export function canEditWorkspaceContent(role: unknown): boolean {
	const normalized = normalizeWorkspaceRole(role, 'VIEWER');
	return normalized === 'OWNER' || normalized === 'ADMIN' || normalized === 'EDITOR';
}

export function canViewWorkspace(role: unknown): boolean {
	const normalized = normalizeWorkspaceRole(role, 'VIEWER');
	return normalized === 'OWNER' || normalized === 'ADMIN' || normalized === 'EDITOR' || normalized === 'VIEWER';
}

export function getWorkspaceRoleLabelKey(role: unknown): 'invite.roleOwner' | 'invite.roleAdmin' | 'share.roleEditor' | 'share.roleViewer' {
	const normalized = normalizeWorkspaceRole(role, 'VIEWER');
	if (normalized === 'OWNER') return 'invite.roleOwner';
	if (normalized === 'ADMIN') return 'invite.roleAdmin';
	if (normalized === 'EDITOR') return 'share.roleEditor';
	return 'share.roleViewer';
}