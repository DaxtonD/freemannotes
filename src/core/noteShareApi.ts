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
	inviteeEmail: string;
	inviteeName: string | null;
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
	inviter: NoteShareInviter | null;
	createdAt: string;
	updatedAt: string;
};

export type NoteShareCollaboratorSnapshot = {
	roomId: string;
	sourceWorkspaceId: string;
	sourceNoteId: string;
	accessRole: NoteShareRole;
	canManage: boolean;
	currentUserId: string | null;
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
		throw new Error(message);
	}
	return body as T;
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
}

export function removePendingNoteShareAction(userId: string, invitationId: string): void {
	if (!userId || !invitationId) return;
	writeQueue(userId, readQueue(userId).filter((item) => item.invitationId !== invitationId));
}

export async function flushPendingNoteShareActions(userId: string): Promise<void> {
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
}

export async function listNoteShareInvitations(): Promise<{ invitations: NoteShareInvitation[]; pendingCount: number }> {
	return fetchJson('/api/note-shares/invitations');
}

export async function listSharedNotePlacements(): Promise<{ placements: SharedNotePlacement[] }> {
	return fetchJson('/api/note-shares/placements');
}

export async function getNoteShareCollaborators(docId: string): Promise<NoteShareCollaboratorSnapshot> {
	return fetchJson(`/api/note-shares/collaborators?docId=${encodeURIComponent(docId)}`);
}

export async function createNoteShareInvitation(args: { docId: string; identifier: string; role: NoteShareRole }): Promise<{ invitation: NoteShareInvitation }> {
	return fetchJson('/api/note-shares/invitations', {
		method: 'POST',
		body: JSON.stringify(args),
	});
}

export async function acceptNoteShareInvitation(invitationId: string, args: { target: 'personal' | 'shared'; folderName?: string }): Promise<{ invitation: NoteShareInvitation; placement: { id: string; aliasId: string; targetWorkspaceId: string; folderName: string | null } }> {
	return fetchJson(`/api/note-shares/invitations/${encodeURIComponent(invitationId)}/accept`, {
		method: 'POST',
		body: JSON.stringify(args),
	});
}

export async function declineNoteShareInvitation(invitationId: string): Promise<{ invitation: NoteShareInvitation }> {
	return fetchJson(`/api/note-shares/invitations/${encodeURIComponent(invitationId)}/decline`, {
		method: 'POST',
		body: JSON.stringify({}),
	});
}

export async function revokeNoteShareCollaborator(collaboratorId: string): Promise<{ ok: true; collaboratorId: string }> {
	return fetchJson(`/api/note-shares/collaborators/${encodeURIComponent(collaboratorId)}`, {
		method: 'DELETE',
		body: JSON.stringify({}),
	});
}
