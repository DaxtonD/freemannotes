import {
	cacheCollaboratorSnapshot,
	clearCollaboratorSnapshot,
	enqueuePendingCollaboratorAction,
	moveCachedCollaboratorData,
	readCachedCollaboratorSnapshot,
	readPendingCollaboratorActions as readPendingCollaboratorQueue,
	removePendingCollaboratorAction,
	type CachedCollaboratorSnapshot,
	type PendingCollaboratorAction,
} from './noteShareCollaboratorStore';
import { appendMoveDebugQuery, getMoveDebugTraceIdForDocId } from './moveDebugTrace';
import { requestPwaBackgroundSync } from './pwa';
import { updateKnownUserCache } from './userIdentityCache';
import { updateAvatarCache } from './userAvatarCache';

export type NoteShareRole = 'VIEWER' | 'EDITOR';
export type NoteShareStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED';
export type WorkspaceSystemKind = 'SHARED_WITH_ME' | null;

export type NoteShareInviter = {
	id: string;
	name: string;
	email: string;
	profileImage?: string | null;
};

export type NoteShareInvitation = {
	id: string;
	docId: string;
	sourceWorkspaceId: string;
	sourceNoteId: string;
	role: NoteShareRole;
	status: NoteShareStatus;
	inviteeId?: string | null;
	inviteeEmail: string;
	inviteeName: string | null;
	inviteeProfileImage?: string | null;
	createdAt: string;
	updatedAt: string;
	respondedAt: string | null;
	revokedAt: string | null;
	inviter: NoteShareInviter | null;
	noteTitle?: string;
	placement: {
		id: string;
		targetWorkspaceId: string;
		folderName: string | null;
		deletedAt: string | null;
	} | null;
};

export type NoteShareCollaborator = {
	id: string;
	userId: string;
	role: NoteShareRole;
	accessSource?: 'direct' | 'workspace';
	revokedAt: string | null;
	createdAt: string;
	updatedAt: string;
	user: NoteShareInviter | null;
};

export type SharedNotePlacement = {
	id: string;
	aliasId: string;
	roomId: string;
	sourceWorkspaceId: string;
	sourceNoteId: string;
	role: NoteShareRole;
	folderName: string | null;
	collectionId: string | null;
	labelIds: string[];
	inviter: NoteShareInviter | null;
	createdAt: string;
	updatedAt: string;
};

export type NoteShareCollaboratorSnapshot = {
	roomId: string;
	sourceWorkspaceId: string;
	sourceNoteId: string;
	noteTitle?: string;
	accessRole: NoteShareRole;
	canManage: boolean;
	currentUserId: string | null;
	currentUser?: NoteShareInviter | null;
	selfCollaboratorId: string | null;
	sharedBy: NoteShareInviter | null;
	collaborators: NoteShareCollaborator[];
	pendingInvitations: NoteShareInvitation[];
};

export type PendingNoteShareAction = {
	id: string;
	userId: string;
	invitationId: string;
	action: 'accept' | 'decline';
	target: 'personal' | 'shared';
	folderName: string | null;
	createdAt: string;
};

const NOTE_SHARE_QUEUE_PREFIX = 'freemannotes.noteShareQueue.v1:';

type HttpError = Error & { status?: number };

const pendingCollaboratorFlushes = new Map<string, Promise<void>>();

function withHttpStatus(message: string, status: number): HttpError {
	const error = new Error(message) as HttpError;
	error.status = status;
	return error;
}

function isOffline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function createActionId(prefix: string): string {
	return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRole(value: unknown): NoteShareRole {
	return value === 'VIEWER' ? 'VIEWER' : 'EDITOR';
}

function isMissingAccessError(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && (((error as HttpError).status === 403) || ((error as HttpError).status === 404)));
}

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
	const response = await fetch(input, {
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...(init.headers || {}),
		},
		...init,
	});
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		const message = body && typeof body.error === 'string' ? body.error : `Request failed (${response.status})`;
		throw withHttpStatus(message, response.status);
	}
	return body as T;
}

async function requestNoteShareCollaborators(docId: string): Promise<NoteShareCollaboratorSnapshot> {
	const traceId = getMoveDebugTraceIdForDocId(docId);
	return fetchJson(appendMoveDebugQuery(`/api/note-shares/collaborators?docId=${encodeURIComponent(docId)}`, traceId));
}

async function requestCreateNoteShareInvitation(args: { docId: string; identifier: string; role: NoteShareRole }): Promise<{ invitation: NoteShareInvitation }> {
	return fetchJson('/api/note-shares/invitations', {
		method: 'POST',
		body: JSON.stringify(args),
	});
}

async function requestCancelNoteShareInvitation(invitationId: string): Promise<{ invitation: NoteShareInvitation }> {
	return fetchJson(`/api/note-shares/invitations/${encodeURIComponent(invitationId)}`, {
		method: 'DELETE',
		body: JSON.stringify({}),
	});
}

async function requestRevokeNoteShareCollaborator(collaboratorId: string): Promise<{ ok: true; collaboratorId: string }> {
	return fetchJson(`/api/note-shares/collaborators/${encodeURIComponent(collaboratorId)}`, {
		method: 'DELETE',
		body: JSON.stringify({}),
	});
}

async function requestUpdateNoteShareCollaboratorRole(collaboratorId: string, role: NoteShareRole): Promise<{ collaborator: NoteShareCollaborator }> {
	return fetchJson(`/api/note-shares/collaborators/${encodeURIComponent(collaboratorId)}`, {
		method: 'PUT',
		body: JSON.stringify({ role }),
	});
}

async function requestSyncAttachedDrawingCollaborators(args: { parentDocId: string; drawingDocId: string }): Promise<{ ok: true; collaboratorCount: number }> {
	return fetchJson('/api/note-shares/attached-drawing-access', {
		method: 'POST',
		body: JSON.stringify(args),
	});
}

function toCachedCollaboratorSnapshot(snapshot: NoteShareCollaboratorSnapshot): CachedCollaboratorSnapshot {
	updateKnownUserCache([
		snapshot.currentUser,
		snapshot.sharedBy,
		...snapshot.collaborators.map((c) => c.user),
		...snapshot.pendingInvitations.map((inv) => ({
			id: inv.inviteeId ?? null,
			email: inv.inviteeEmail,
			name: inv.inviteeName,
			profileImage: inv.inviteeProfileImage ?? null,
		})),
		...snapshot.pendingInvitations.map((inv) => inv.inviter),
	].filter(Boolean) as Array<{ id?: string | null; email?: string | null; name?: string | null; profileImage?: string | null }>);
	updateAvatarCache([
		snapshot.currentUser,
		snapshot.sharedBy,
		...snapshot.collaborators.map((c) => c.user),
		...snapshot.pendingInvitations.map((inv) => inv.inviter),
		// Cache invitee avatars using their userId so the collaborator modal can
		// display them offline even when inviteeProfileImage is not cached locally.
		...snapshot.pendingInvitations
			.filter((inv) => inv.inviteeId && inv.inviteeProfileImage)
			.map((inv) => ({ id: inv.inviteeId!, profileImage: inv.inviteeProfileImage })),
	].filter(Boolean) as Array<{ id: string; profileImage?: string | null }>);
	return {
		roomId: snapshot.roomId,
		sourceWorkspaceId: snapshot.sourceWorkspaceId,
		sourceNoteId: snapshot.sourceNoteId,
		noteTitle: typeof snapshot.noteTitle === 'string' ? snapshot.noteTitle : '',
		accessRole: normalizeRole(snapshot.accessRole),
		canManage: Boolean(snapshot.canManage),
		currentUserId: snapshot.currentUserId ?? null,
		currentUser: snapshot.currentUser
			? {
				...snapshot.currentUser,
				profileImage: snapshot.currentUser.profileImage ?? null,
			}
			: null,
		selfCollaboratorId: snapshot.selfCollaboratorId ?? null,
		sharedBy: snapshot.sharedBy
			? {
				...snapshot.sharedBy,
				profileImage: snapshot.sharedBy.profileImage ?? null,
			}
			: null,
		collaborators: snapshot.collaborators.map((collaborator) => ({
			...collaborator,
			role: normalizeRole(collaborator.role),
			accessSource: collaborator.accessSource === 'workspace' ? 'workspace' : 'direct',
			user: collaborator.user
				? {
					...collaborator.user,
					profileImage: collaborator.user.profileImage ?? null,
				}
				: null,
		})),
		pendingInvitations: snapshot.pendingInvitations.map((invitation) => ({
			...invitation,
			role: normalizeRole(invitation.role),
			inviter: invitation.inviter
				? {
					...invitation.inviter,
					profileImage: invitation.inviter.profileImage ?? null,
				}
				: null,
			noteTitle: typeof invitation.noteTitle === 'string' ? invitation.noteTitle : '',
			placement: invitation.placement ? { ...invitation.placement } : null,
		})),
	};
}

function queueKey(userId: string): string {
	return `${NOTE_SHARE_QUEUE_PREFIX}${String(userId || '').trim()}`;
}

function readQueue(userId: string): PendingNoteShareAction[] {
	// Accept/decline actions are queued locally so the notifications modal can
	// optimistically update while offline and replay once the app reconnects.
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(queueKey(userId));
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((item): item is PendingNoteShareAction => Boolean(item && typeof item === 'object'));
	} catch {
		return [];
	}
}

function writeQueue(userId: string, actions: readonly PendingNoteShareAction[]): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(queueKey(userId), JSON.stringify(actions));
	} catch {
		// Ignore persistent queue write failures.
	}
}

export function readPendingNoteShareActions(userId: string): PendingNoteShareAction[] {
	return readQueue(userId);
}

export function enqueuePendingNoteShareAction(action: PendingNoteShareAction): void {
	if (!action.userId || !action.invitationId) return;
	const existing = readQueue(action.userId).filter((item) => item.invitationId !== action.invitationId);
	existing.push(action);
	writeQueue(action.userId, existing);
	void requestPwaBackgroundSync();
}

export function removePendingNoteShareAction(userId: string, invitationId: string): void {
	if (!userId || !invitationId) return;
	writeQueue(userId, readQueue(userId).filter((item) => item.invitationId !== invitationId));
}

const pendingNoteShareFlushes = new Map<string, Promise<void>>();

export async function flushPendingNoteShareActions(userId: string): Promise<void> {
	if (!userId) return;
	const existing = pendingNoteShareFlushes.get(userId);
	if (existing) {
		await existing;
		return;
	}
	const task = (async () => {
		const pending = readQueue(userId);
		// Replay in insertion order so the queued local view converges with the server
		// in the same order the user acted on invitations while offline.
		for (const action of pending) {
			if (action.action === 'decline') {
				await declineNoteShareInvitation(action.invitationId);
			} else {
				await acceptNoteShareInvitation(action.invitationId, {
					target: action.target,
					folderName: action.folderName || undefined,
				});
			}
			removePendingNoteShareAction(userId, action.invitationId);
		}
	})().finally(() => {
		if (pendingNoteShareFlushes.get(userId) === task) {
			pendingNoteShareFlushes.delete(userId);
		}
	});
	pendingNoteShareFlushes.set(userId, task);
	await task;
}

export async function listNoteShareInvitations(): Promise<{ invitations: NoteShareInvitation[]; pendingCount: number }> {
	const result = await fetchJson<{ invitations: NoteShareInvitation[]; pendingCount: number }>('/api/note-shares/invitations');
	if (Array.isArray(result?.invitations)) {
		updateKnownUserCache(result.invitations.flatMap((inv) => {
			const users: Array<{ id?: string | null; email?: string | null; name?: string | null; profileImage?: string | null }> = [];
			if (inv.inviter) {
				users.push(inv.inviter);
			}
			users.push({
				id: inv.inviteeId ?? null,
				email: inv.inviteeEmail,
				name: inv.inviteeName,
				profileImage: inv.inviteeProfileImage ?? null,
			});
			return users;
		}));
		updateAvatarCache(result.invitations.map((inv) => inv.inviter).filter(Boolean) as Array<{ id: string; profileImage?: string | null }>);
	}
	return result;
}

export async function listSharedNotePlacements(workspaceId?: string | null): Promise<{ placements: SharedNotePlacement[] }> {
	const normalizedWorkspaceId = typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : '';
	const url = normalizedWorkspaceId
		? `/api/note-shares/placements?workspaceId=${encodeURIComponent(normalizedWorkspaceId)}`
		: '/api/note-shares/placements';
	return fetchJson(url);
}

export async function getNoteShareCollaborators(docId: string): Promise<NoteShareCollaboratorSnapshot> {
	return requestNoteShareCollaborators(docId);
}

export async function createNoteShareInvitation(args: { docId: string; identifier: string; role: NoteShareRole }): Promise<{ invitation: NoteShareInvitation }> {
	return requestCreateNoteShareInvitation(args);
}

export async function acceptNoteShareInvitation(invitationId: string, args: { target: 'personal' | 'shared'; folderName?: string }): Promise<{ invitation: NoteShareInvitation; placement: { id: string; aliasId: string; targetWorkspaceId: string; folderName: string | null } }> {
	return fetchJson(`/api/note-shares/invitations/${encodeURIComponent(invitationId)}/accept`, {
		method: 'POST',
		body: JSON.stringify(args),
	});
}

export async function updateSharedNotePlacementMetadata(args: { placementId: string; collectionId?: string | null; labelIds?: readonly string[] }): Promise<{ placement: SharedNotePlacement }> {
	const placementId = String(args.placementId || '').trim();
	if (!placementId) throw new Error('Placement id is required');
	return fetchJson(`/api/note-shares/placements/${encodeURIComponent(placementId)}`, {
		method: 'PUT',
		body: JSON.stringify({
			collectionId: args.collectionId,
			labelIds: args.labelIds,
		}),
	});
}

export async function declineNoteShareInvitation(invitationId: string): Promise<{ invitation: NoteShareInvitation }> {
	return fetchJson(`/api/note-shares/invitations/${encodeURIComponent(invitationId)}/decline`, {
		method: 'POST',
		body: JSON.stringify({}),
	});
}

export async function cancelNoteShareInvitation(args: { userId?: string | null; docId: string; invitationId: string }): Promise<{ invitation?: NoteShareInvitation; invitationId: string; localOnly: boolean }> {
	const invitationId = String(args.invitationId || '').trim();
	if (!invitationId) throw new Error('Missing invitation data');
	if (invitationId.startsWith('queued:')) {
		await removePendingCollaboratorAction(invitationId.slice('queued:'.length));
		return { invitationId, localOnly: true };
	}
	if (isOffline()) {
		throw new Error('Pending invite cancellation requires an online connection');
	}
	const result = await requestCancelNoteShareInvitation(invitationId);
	return { invitation: result.invitation, invitationId, localOnly: false };
}

export async function revokeNoteShareCollaborator(collaboratorId: string): Promise<{ ok: true; collaboratorId: string }> {
	return requestRevokeNoteShareCollaborator(collaboratorId);
}

export async function updateNoteShareCollaboratorRole(collaboratorId: string, role: NoteShareRole): Promise<{ collaborator: NoteShareCollaborator }> {
	return requestUpdateNoteShareCollaboratorRole(collaboratorId, role);
}

export async function syncAttachedDrawingCollaborators(args: { parentDocId: string; drawingDocId: string }): Promise<{ ok: true; collaboratorCount: number }> {
	const parentDocId = String(args.parentDocId || '').trim();
	const drawingDocId = String(args.drawingDocId || '').trim();
	if (!parentDocId || !drawingDocId) {
		return { ok: true, collaboratorCount: 0 };
	}
	return requestSyncAttachedDrawingCollaborators({ parentDocId, drawingDocId });
}

export async function readCachedNoteShareCollaborators(userId: string, docId: string): Promise<NoteShareCollaboratorSnapshot | null> {
	return readCachedCollaboratorSnapshot(userId, docId) as Promise<NoteShareCollaboratorSnapshot | null>;
}

export async function readPendingCollaboratorActions(userId: string, docId?: string): Promise<readonly PendingCollaboratorAction[]> {
	return readPendingCollaboratorQueue(userId, docId);
}

export async function moveCachedNoteShareCollaborators(userId: string, sourceDocId: string, targetDocId: string): Promise<void> {
	await moveCachedCollaboratorData(userId, sourceDocId, targetDocId);
}

export async function syncNoteShareCollaborators(userId: string, docId: string, opts?: { suppressError?: boolean }): Promise<NoteShareCollaboratorSnapshot | null> {
	if (!userId || !docId) return null;
	try {
		const snapshot = await requestNoteShareCollaborators(docId);
		await cacheCollaboratorSnapshot({ userId, docId, snapshot: toCachedCollaboratorSnapshot(snapshot) });
		return (await readCachedCollaboratorSnapshot(userId, docId)) as NoteShareCollaboratorSnapshot | null;
	} catch (error) {
		if (isMissingAccessError(error)) {
			await clearCollaboratorSnapshot(userId, docId);
			return null;
		}
		if (opts?.suppressError) {
			return (await readCachedCollaboratorSnapshot(userId, docId)) as NoteShareCollaboratorSnapshot | null;
		}
		throw error;
	}
}

export async function queueNoteShareCollaboratorInviteAction(args: { userId: string; docId: string; identifier: string; role: NoteShareRole }): Promise<void> {
	await enqueuePendingCollaboratorAction({
		id: createActionId('note-share-invite'),
		userId: args.userId,
		docId: args.docId,
		kind: 'invite',
		identifier: args.identifier.trim(),
		collaboratorId: null,
		collaboratorUserId: null,
		role: normalizeRole(args.role),
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});
}

export async function queueNoteShareCollaboratorRevokeAction(args: { userId: string; docId: string; collaboratorId: string; collaboratorUserId?: string | null }): Promise<void> {
	await enqueuePendingCollaboratorAction({
		id: createActionId('note-share-revoke'),
		userId: args.userId,
		docId: args.docId,
		kind: 'revoke',
		identifier: null,
		collaboratorId: args.collaboratorId,
		collaboratorUserId: args.collaboratorUserId ?? null,
		role: null,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});
}

export async function queueNoteShareCollaboratorRoleAction(args: { userId: string; docId: string; collaboratorId: string; collaboratorUserId?: string | null; role: NoteShareRole }): Promise<void> {
	await enqueuePendingCollaboratorAction({
		id: createActionId('note-share-role'),
		userId: args.userId,
		docId: args.docId,
		kind: 'update-role',
		identifier: null,
		collaboratorId: args.collaboratorId,
		collaboratorUserId: args.collaboratorUserId ?? null,
		role: normalizeRole(args.role),
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});
}

export async function flushPendingCollaboratorActions(userId: string): Promise<void> {
	if (!userId || isOffline()) return;
	const existing = pendingCollaboratorFlushes.get(userId);
	if (existing) {
		await existing;
		return;
	}
	const task = (async () => {
		// Replay the collaborator queue in order so invite/revoke/role changes reach
		// the server deterministically, then refresh any touched docs from the source
		// of truth to collapse queued placeholders back into canonical state.
		const pending = await readPendingCollaboratorQueue(userId);
		const touchedDocIds = new Set<string>();

		for (const action of pending) {
			try {
				if (action.kind === 'invite') {
					if (!action.identifier || !action.role) continue;
					await requestCreateNoteShareInvitation({
						docId: action.docId,
						identifier: action.identifier,
						role: normalizeRole(action.role),
					});
				} else if (action.kind === 'revoke') {
					if (!action.collaboratorId) continue;
					await requestRevokeNoteShareCollaborator(action.collaboratorId);
				} else if (action.kind === 'update-role') {
					if (!action.collaboratorId || !action.role) continue;
					await requestUpdateNoteShareCollaboratorRole(action.collaboratorId, normalizeRole(action.role));
				}
				touchedDocIds.add(action.docId);
				await removePendingCollaboratorAction(action.id);
			} catch (error) {
				const status = (error as HttpError).status;
				if ((action.kind === 'revoke' || action.kind === 'update-role') && (status === 403 || status === 404)) {
					touchedDocIds.add(action.docId);
					await removePendingCollaboratorAction(action.id);
					continue;
				}
				if (action.kind === 'invite' && status === 409) {
					touchedDocIds.add(action.docId);
					await removePendingCollaboratorAction(action.id);
					continue;
				}
				break;
			}
		}

		for (const docId of touchedDocIds) {
			await syncNoteShareCollaborators(userId, docId, { suppressError: true });
		}
	})().finally(() => {
		if (pendingCollaboratorFlushes.get(userId) === task) {
			pendingCollaboratorFlushes.delete(userId);
		}
	});
	pendingCollaboratorFlushes.set(userId, task);
	await task;
}
