type WorkspaceInviteRole = 'MEMBER' | 'ADMIN';

export type NoteShareLink = {
	shareUrl: string;
	expiresAt: string;
};

export type WorkspaceInviteLink = {
	inviteUrl: string;
	expiresAt: string;
	email: string;
	role: WorkspaceInviteRole;
	sentEmail: boolean;
};

const NOTE_SHARE_CACHE_KEY = 'freemannotes.share.note-links.v1';
const WORKSPACE_INVITE_CACHE_KEY = 'freemannotes.share.workspace-links.v1';
// Treat links that are within one minute of expiry as stale so the UI does not
// present a QR code or copied URL that will die immediately after the user opens it.
const EXPIRY_SKEW_MS = 60_000;

function normalizeId(value: unknown): string {
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeEmail(value: unknown): string {
	return String(value ?? '').trim().toLowerCase();
}

function readCacheMap<T>(storageKey: string): Record<string, T> {
	// Share/invite links are cached client-side so the UI can still show the last
	// known valid URL while offline instead of forcing the user through a dead end.
	if (typeof window === 'undefined') return {};
	try {
		const raw = window.localStorage.getItem(storageKey);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, T>) : {};
	} catch {
		return {};
	}
}

function writeCacheMap<T>(storageKey: string, next: Record<string, T>): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(storageKey, JSON.stringify(next));
	} catch {
		// Ignore storage quota failures and keep the live request result.
	}
}

function isUsableExpiry(expiresAt: string | null | undefined): boolean {
	if (!expiresAt) return false;
	const ms = Date.parse(expiresAt);
	return Number.isFinite(ms) && ms > Date.now() + EXPIRY_SKEW_MS;
}

function isOffline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine === false;
}

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
	const res = await fetch(input, { credentials: 'include', ...init });
	const contentType = String(res.headers.get('content-type') || '').toLowerCase();
	const body = contentType.includes('application/json') ? await res.json().catch(() => null) : null;
	if (!res.ok) {
		const message = body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
		throw new Error(message);
	}
	return body as T;
}

export function readCachedNoteShareLink(docId: string): NoteShareLink | null {
	const normalizedId = normalizeId(docId);
	if (!normalizedId) return null;
	const map = readCacheMap<NoteShareLink>(NOTE_SHARE_CACHE_KEY);
	const cached = map[normalizedId];
	if (!cached || !cached.shareUrl || !cached.expiresAt) return null;
	return cached;
}

function writeCachedNoteShareLink(docId: string, link: NoteShareLink): void {
	const normalizedId = normalizeId(docId);
	if (!normalizedId) return;
	const map = readCacheMap<NoteShareLink>(NOTE_SHARE_CACHE_KEY);
	map[normalizedId] = link;
	writeCacheMap(NOTE_SHARE_CACHE_KEY, map);
}

export async function ensureDocShareLink(docId: string, opts?: { forceRefresh?: boolean }): Promise<NoteShareLink> {
	const normalizedId = normalizeId(docId);
	if (!normalizedId) throw new Error('Missing docId');
	const cached = readCachedNoteShareLink(normalizedId);
	// Normal path: reuse the cached link until it is near expiry. The modal only
	// hits the server when the caller explicitly refreshes or when the cached URL
	// is no longer trustworthy.
	if (!opts?.forceRefresh && cached && isUsableExpiry(cached.expiresAt)) {
		return cached;
	}
	// Offline fallback: if we have any cached link at all, return it so the user
	// can still copy/open the last known URL. If there is no cache we fail loudly.
	if (isOffline()) {
		if (cached) return cached;
		throw new Error('Share link unavailable while offline');
	}
	const body = await fetchJson<{ shareUrl?: string; expiresAt?: string }>(`/api/docs/${encodeURIComponent(normalizedId)}/share`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
	});
	const shareUrl = typeof body?.shareUrl === 'string' ? body.shareUrl : '';
	const expiresAt = typeof body?.expiresAt === 'string' ? body.expiresAt : '';
	if (!shareUrl || !expiresAt) throw new Error('Missing share link');
	const next = { shareUrl, expiresAt };
	writeCachedNoteShareLink(normalizedId, next);
	return next;
}

function buildWorkspaceInviteCacheKey(workspaceId: string, email: string, role: WorkspaceInviteRole): string {
	// Workspace invites are scoped by workspace + recipient email + role so the
	// modal can cache separate links for different recipients or permission levels.
	return `${workspaceId}::${normalizeEmail(email)}::${role}`;
}

export function readCachedWorkspaceInviteLink(args: { workspaceId: string; email: string; role: WorkspaceInviteRole }): WorkspaceInviteLink | null {
	const workspaceId = normalizeId(args.workspaceId);
	const email = normalizeEmail(args.email);
	if (!workspaceId || !email) return null;
	const key = buildWorkspaceInviteCacheKey(workspaceId, email, args.role);
	const map = readCacheMap<WorkspaceInviteLink>(WORKSPACE_INVITE_CACHE_KEY);
	const cached = map[key];
	if (!cached || !cached.inviteUrl || !cached.expiresAt) return null;
	return cached;
}

function writeCachedWorkspaceInviteLink(args: { workspaceId: string; email: string; role: WorkspaceInviteRole }, link: WorkspaceInviteLink): void {
	const workspaceId = normalizeId(args.workspaceId);
	const email = normalizeEmail(args.email);
	if (!workspaceId || !email) return;
	const key = buildWorkspaceInviteCacheKey(workspaceId, email, args.role);
	const map = readCacheMap<WorkspaceInviteLink>(WORKSPACE_INVITE_CACHE_KEY);
	map[key] = link;
	writeCacheMap(WORKSPACE_INVITE_CACHE_KEY, map);
}

async function requestWorkspaceInviteLink(args: {
	workspaceId: string;
	email: string;
	role: WorkspaceInviteRole;
	sendEmail: boolean;
}): Promise<WorkspaceInviteLink> {
	const workspaceId = normalizeId(args.workspaceId);
	const email = normalizeEmail(args.email);
	if (!workspaceId) throw new Error('Missing workspaceId');
	if (!email) throw new Error('Missing email');
	if (isOffline()) {
		const cached = readCachedWorkspaceInviteLink({ workspaceId, email, role: args.role });
		if (cached) return cached;
		throw new Error('Invite link unavailable while offline');
	}
	// Both "generate link" and "send email" run through the same endpoint. The
	// sendEmail flag decides whether the server should only mint/return the link or
	// also dispatch SMTP delivery for that recipient.
	const body = await fetchJson<{
		inviteUrl?: string;
		expiresAt?: string;
		email?: string;
		role?: WorkspaceInviteRole;
		sentEmail?: boolean;
	}>(`/api/workspaces/${encodeURIComponent(workspaceId)}/invites`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, role: args.role, sendEmail: args.sendEmail }),
	});
	const inviteUrl = typeof body?.inviteUrl === 'string' ? body.inviteUrl : '';
	const expiresAt = typeof body?.expiresAt === 'string' ? body.expiresAt : '';
	const role = body?.role === 'ADMIN' ? 'ADMIN' : 'MEMBER';
	const responseEmail = normalizeEmail(body?.email || email);
	if (!inviteUrl || !expiresAt || !responseEmail) throw new Error('Missing invite link');
	const next: WorkspaceInviteLink = {
		inviteUrl,
		expiresAt,
		email: responseEmail,
		role,
		sentEmail: Boolean(body?.sentEmail),
	};
	writeCachedWorkspaceInviteLink({ workspaceId, email: responseEmail, role }, next);
	return next;
}

export async function ensureWorkspaceInviteLink(args: {
	workspaceId: string;
	email: string;
	role: WorkspaceInviteRole;
	forceRefresh?: boolean;
}): Promise<WorkspaceInviteLink> {
	const workspaceId = normalizeId(args.workspaceId);
	const email = normalizeEmail(args.email);
	const cached = readCachedWorkspaceInviteLink({ workspaceId, email, role: args.role });
	if (!args.forceRefresh && cached && isUsableExpiry(cached.expiresAt)) {
		return cached;
	}
	// Generate-link mode intentionally suppresses email delivery so admins can
	// preview/copy/QR-share the invite before deciding whether to send mail.
	return requestWorkspaceInviteLink({ workspaceId, email, role: args.role, sendEmail: false });
}

export async function sendWorkspaceInviteEmail(args: {
	workspaceId: string;
	email: string;
	role: WorkspaceInviteRole;
}): Promise<WorkspaceInviteLink> {
	// Email-send mode still returns the link payload so the modal can update its
	// copy/open/QR affordances without making a second request.
	return requestWorkspaceInviteLink({
		workspaceId: args.workspaceId,
		email: args.email,
		role: args.role,
		sendEmail: true,
	});
}

export async function copyTextToClipboard(value: string): Promise<void> {
	if (!value) throw new Error('Nothing to copy');
	if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
		await navigator.clipboard.writeText(value);
		return;
	}
	throw new Error('Clipboard unavailable');
}