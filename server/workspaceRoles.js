'use strict';

function normalizeWorkspaceRole(input, fallback = 'VIEWER') {
	const value = String(input || '').trim().toUpperCase();
	if (value === 'OWNER') return 'OWNER';
	if (value === 'ADMIN') return 'ADMIN';
	if (value === 'EDITOR') return 'EDITOR';
	if (value === 'VIEWER') return 'VIEWER';
	if (value === 'MEMBER') return 'VIEWER';
	return fallback;
}

function isWorkspaceOwner(role) {
	return normalizeWorkspaceRole(role, '') === 'OWNER';
}

function canManageWorkspace(role) {
	const normalized = normalizeWorkspaceRole(role, 'VIEWER');
	return normalized === 'OWNER' || normalized === 'ADMIN';
}

function canEditWorkspaceContent(role) {
	const normalized = normalizeWorkspaceRole(role, '');
	return normalized === 'OWNER' || normalized === 'ADMIN' || normalized === 'EDITOR';
}

function canViewWorkspace(role) {
	const normalized = normalizeWorkspaceRole(role, '');
	return normalized === 'OWNER' || normalized === 'ADMIN' || normalized === 'EDITOR' || normalized === 'VIEWER';
}

module.exports = {
	normalizeWorkspaceRole,
	isWorkspaceOwner,
	canManageWorkspace,
	canEditWorkspaceContent,
	canViewWorkspace,
};