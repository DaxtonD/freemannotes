import { type WorkspaceInviteRole } from './shareLinks';

export type WorkspacePendingInvite = {
	id: string;
	workspaceId: string;
	workspaceName: string;
	role: WorkspaceInviteRole;
	email: string;
	createdAt: string;
	expiresAt: string;
	inviter: { id: string; name: string; email: string } | null;
};

type ListResponse = {
	invites: WorkspacePendingInvite[];
};

type AcceptResponse = {
	ok: true;
	workspaceId: string;
	workspaceName: string;
	role: WorkspaceInviteRole;
};

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
	const res = await fetch(input, { credentials: 'include', ...init });
	const contentType = String(res.headers.get('content-type') || '').toLowerCase();
	const body = contentType.includes('application/json') ? await res.json().catch(() => null) : null;
	if (!res.ok) {
		throw new Error(body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`);
	}
	return body as T;
}

export async function listWorkspacePendingInvites(): Promise<ListResponse> {
	return fetchJson<ListResponse>('/api/invites');
}

export async function acceptWorkspacePendingInvite(inviteId: string): Promise<AcceptResponse> {
	return fetchJson<AcceptResponse>('/api/invites/accept', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ inviteId }),
	});
}

export async function declineWorkspacePendingInvite(inviteId: string): Promise<{ ok: true; inviteId: string }> {
	return fetchJson<{ ok: true; inviteId: string }>(`/api/invites/${encodeURIComponent(inviteId)}/decline`, {
		method: 'POST',
	});
}