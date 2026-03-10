'use strict';

const SHARED_WITH_ME_KIND = 'SHARED_WITH_ME';

function getSharedWithMeWorkspaceName(userId) {
	// Stored names retain the historical UUID suffix because the database still
	// enforces global workspace-name uniqueness. The UI normalizes this back to a
	// clean "Shared With Me" label for display.
	return `Shared With Me (${String(userId || '').trim()})`;
}

async function ensureSharedWithMeWorkspace(prismaOrTx, userId) {
	if (!prismaOrTx || !userId) return null;
	// Shared With Me behaves like a system workspace per user. We upsert the owner
	// membership even when the workspace already exists so older accounts recover a
	// consistent membership row without a dedicated repair migration.
	const existing = await prismaOrTx.workspace.findFirst({
		where: {
			ownerUserId: userId,
			systemKind: SHARED_WITH_ME_KIND,
		},
		select: {
			id: true,
			name: true,
			ownerUserId: true,
			systemKind: true,
			createdAt: true,
			updatedAt: true,
		},
	});
	if (existing) {
		await prismaOrTx.workspaceMember.upsert({
			where: { userId_workspaceId: { userId, workspaceId: existing.id } },
			update: { role: 'OWNER' },
			create: { userId, workspaceId: existing.id, role: 'OWNER' },
		});
		return existing;
	}

	const workspace = await prismaOrTx.workspace.create({
		data: {
			name: getSharedWithMeWorkspaceName(userId),
			ownerUserId: userId,
			systemKind: SHARED_WITH_ME_KIND,
		},
		select: {
			id: true,
			name: true,
			ownerUserId: true,
			systemKind: true,
			createdAt: true,
			updatedAt: true,
		},
	});

	await prismaOrTx.workspaceMember.create({
		data: { userId, workspaceId: workspace.id, role: 'OWNER' },
	});

	return workspace;
}

async function findPreferredWorkspaceMembership(prisma, userId, select = { workspaceId: true }) {
	if (!prisma || !userId) return null;
	// Personal workspaces are preferred for fallback activation so newly accepted
	// shared notes do not unexpectedly make Shared With Me the user's default root.
	const personal = await prisma.workspaceMember.findFirst({
		where: {
			userId,
			workspace: {
				is: {
					deletedAt: null,
					systemKind: null,
				},
			},
		},
		orderBy: { workspaceId: 'asc' },
		select,
	});
	if (personal) return personal;
	return prisma.workspaceMember.findFirst({
		where: {
			userId,
			workspace: { is: { deletedAt: null } },
		},
		orderBy: { workspaceId: 'asc' },
		select,
	});
}

module.exports = {
	SHARED_WITH_ME_KIND,
	ensureSharedWithMeWorkspace,
	findPreferredWorkspaceMembership,
	getSharedWithMeWorkspaceName,
};