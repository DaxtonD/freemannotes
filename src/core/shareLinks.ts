import { normalizeWorkspaceRole, type WorkspaceRole } from './workspaceRoles';

export type WorkspaceInviteRole = Exclude<WorkspaceRole, 'OWNER'>;
export type NoteShareRole = 'VIEWER' | 'EDITOR';
export type WorkspaceShareRole = Exclude<WorkspaceRole, 'OWNER'>;
export type ShareExpiryDays = 1 | 7 | 30;
export type ShareEntityType = 'note' | 'workspace';

export type NoteShareLink = {
	entityType: 'note';
	permission: NoteShareRole;
	shareUrl: string | null;
	expiresAt: string | null;
	label?: string;
	pending?: boolean;
};

export type WorkspaceShareLink = {
	entityType: 'workspace';
	permission: WorkspaceShareRole;
	shareUrl: string | null;
	expiresAt: string | null;
	label?: string;
	pending?: boolean;
};

export type WorkspaceInviteLink = {
	inviteId?: string;
	inviteUrl: string;
	expiresAt: string;
	identifier?: string;
	email: string;
	role: WorkspaceInviteRole;
	sentEmail: boolean;
	deliveredInApp?: boolean;
};

export type ShareTokenMetadata = {
	entityType: ShareEntityType;
	permission: string;
	expiresAt: string;
	label: string;
	creator: { id: string; name: string; email: string } | null;
};

export type ShareAcceptResult = {
	ok: true;
	status: 'accepted' | 'already-has-access';
	entityType: ShareEntityType;
	permission: string;
	workspaceId?: string;
	workspaceName?: string;
	targetWorkspaceId?: string;
	placementAliasId?: string | null;
	sourceNoteId?: string;
	title?: string;
	docId?: string;
};

type PendingShareLinkRequest = {
	id: string;
	userId: string;
	entityType: ShareEntityType;
	entityId: string;
	permission: string;
	expiresInDays: ShareExpiryDays;
	createdAt: string;
};

const NOTE_SHARE_CACHE_KEY = 'freemannotes.share.note-links.v2';
const WORKSPACE_SHARE_CACHE_KEY = 'freemannotes.share.workspace-links.v1';
// Workspace invite cache keys moved to v2 when invite lookup expanded from
// email-only input to raw identifiers (username or email).
const WORKSPACE_INVITE_CACHE_KEY = 'freemannotes.share.workspace-invites.v2';
const PENDING_SHARE_QUEUE_KEY = 'freemannotes.share.pending-links.v1';
const SHARE_LINK_EVENT = 'freemannotes:share-link-ready';
const EXPIRY_SKEW_MS = 60_000;

function normalizeId(value: unknown): string {
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeEmail(value: unknown): string {
	return String(value ?? '').trim().toLowerCase();
}

function normalizeIdentifier(value: unknown): string {
	return String(value ?? '').trim();
}

function normalizeExpiryDays(value: unknown): ShareExpiryDays {
	return value === 1 || value === 30 ? value : 7;
}

export function normalizeWorkspaceInviteRole(value: unknown): WorkspaceInviteRole {
	const normalized = normalizeWorkspaceRole(value);
	if (normalized === 'ADMIN') return 'ADMIN';
	return normalized === 'EDITOR' ? 'EDITOR' : 'VIEWER';
}

export function normalizeWorkspaceShareRole(value: unknown): WorkspaceShareRole {
	const normalized = normalizeWorkspaceRole(value);
	if (normalized === 'ADMIN') return 'ADMIN';
	return normalized === 'EDITOR' ? 'EDITOR' : 'VIEWER';
}

function readCacheMap<T>(storageKey: string): Record<string, T> {
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
		// Ignore storage failures.
	}
}

function readPendingQueue(): PendingShareLinkRequest[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = window.localStorage.getItem(PENDING_SHARE_QUEUE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') as PendingShareLinkRequest[] : [];
	} catch {
		return [];
	}
}

function writePendingQueue(next: PendingShareLinkRequest[]): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(PENDING_SHARE_QUEUE_KEY, JSON.stringify(next));
	} catch {
		// Ignore storage failures.
	}
}

function emitShareLinkReady(args: { entityType: ShareEntityType; entityId: string; permission: string; expiresInDays: ShareExpiryDays }): void {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent(SHARE_LINK_EVENT, { detail: args }));
}

export function getShareLinkReadyEventName(): string {
	return SHARE_LINK_EVENT;
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
		const error = new Error(body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`) as Error & { status?: number };
		error.status = res.status;
		throw error;
	}
	return body as T;
}

function buildShareCacheKey(entityId: string, permission: string, expiresInDays: ShareExpiryDays): string {
	return `${entityId}::${permission}::${expiresInDays}`;
}

function readCachedSecureLink<T>(storageKey: string, entityId: string, permission: string, expiresInDays: ShareExpiryDays): T | null {
	const id = normalizeId(entityId);
	if (!id) return null;
	const map = readCacheMap<T>(storageKey);
	return map[buildShareCacheKey(id, permission, expiresInDays)] || null;
}

function writeCachedSecureLink<T>(storageKey: string, entityId: string, permission: string, expiresInDays: ShareExpiryDays, link: T): void {
	const id = normalizeId(entityId);
	if (!id) return;
	const map = readCacheMap<T>(storageKey);
	map[buildShareCacheKey(id, permission, expiresInDays)] = link;
	writeCacheMap(storageKey, map);
}

async function requestSecureShareLink<T extends NoteShareLink | WorkspaceShareLink>(args: {
	entityType: ShareEntityType;
	entityId: string;
	permission: string;
	expiresInDays: ShareExpiryDays;
}): Promise<T> {
	const body = await fetchJson<{ entityType?: ShareEntityType; permission?: string; shareUrl?: string; expiresAt?: string; label?: string }>('/api/share-links', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			entityType: args.entityType.toUpperCase(),
			entityId: args.entityId,
			permission: args.permission,
			expiresInDays: args.expiresInDays,
		}),
	});
	return {
		entityType: args.entityType,
		permission: args.permission,
		shareUrl: typeof body.shareUrl === 'string' ? body.shareUrl : null,
		expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
		label: typeof body.label === 'string' ? body.label : undefined,
	} as T;
}

function enqueuePendingShareLinkRequest(request: PendingShareLinkRequest): void {
	const current = readPendingQueue();
	const deduped = current.filter((item) => !(
		item.userId === request.userId &&
		item.entityType === request.entityType &&
		item.entityId === request.entityId &&
		item.permission === request.permission &&
		item.expiresInDays === request.expiresInDays
	));
	deduped.push(request);
	writePendingQueue(deduped);
}

function removePendingShareLinkRequest(requestId: string): void {
	writePendingQueue(readPendingQueue().filter((item) => item.id !== requestId));
}

export async function flushPendingShareLinkRequests(userId: string): Promise<void> {
	if (!userId || isOffline()) return;
	const queued = readPendingQueue().filter((item) => item.userId === userId);
	for (const request of queued) {
		try {
			// Replay queued link generation one item at a time so a transient failure does
			// not discard the rest of the offline request queue.
			if (request.entityType === 'note') {
				const link = await requestSecureShareLink<NoteShareLink>({
					entityType: 'note',
					entityId: request.entityId,
					permission: request.permission,
					expiresInDays: request.expiresInDays,
				});
				writeCachedSecureLink(NOTE_SHARE_CACHE_KEY, request.entityId, request.permission, request.expiresInDays, link);
			} else {
				const link = await requestSecureShareLink<WorkspaceShareLink>({
					entityType: 'workspace',
					entityId: request.entityId,
					permission: request.permission,
					expiresInDays: request.expiresInDays,
				});
				writeCachedSecureLink(WORKSPACE_SHARE_CACHE_KEY, request.entityId, request.permission, request.expiresInDays, link);
			}
			removePendingShareLinkRequest(request.id);
			emitShareLinkReady({
				entityType: request.entityType,
				entityId: request.entityId,
				permission: request.permission,
				expiresInDays: request.expiresInDays,
			});
		} catch {
			break;
		}
	}
}

export async function ensureNoteShareLink(args: {
	userId: string | null;
	docId: string;
	permission: NoteShareRole;
	expiresInDays: ShareExpiryDays;
	forceRefresh?: boolean;
}): Promise<NoteShareLink> {
	const docId = normalizeId(args.docId);
	const expiresInDays = normalizeExpiryDays(args.expiresInDays);
	const cached = readCachedSecureLink<NoteShareLink>(NOTE_SHARE_CACHE_KEY, docId, args.permission, expiresInDays);
	if (!args.forceRefresh && cached && isUsableExpiry(cached.expiresAt)) {
		return cached;
	}
	if (isOffline()) {
		if (args.userId) {
			enqueuePendingShareLinkRequest({
				id: `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
				userId: args.userId,
				entityType: 'note',
				entityId: docId,
				permission: args.permission,
				expiresInDays,
				createdAt: new Date().toISOString(),
			});
		}
		return {
			entityType: 'note',
			permission: args.permission,
			shareUrl: cached?.shareUrl ?? null,
			expiresAt: cached?.expiresAt ?? null,
			label: cached?.label,
			pending: true,
		};
	}
	const next = await requestSecureShareLink<NoteShareLink>({ entityType: 'note', entityId: docId, permission: args.permission, expiresInDays });
	writeCachedSecureLink(NOTE_SHARE_CACHE_KEY, docId, args.permission, expiresInDays, next);
	return next;
}

export async function ensureWorkspaceShareLink(args: {
	userId: string | null;
	workspaceId: string;
	permission: WorkspaceShareRole;
	expiresInDays: ShareExpiryDays;
	forceRefresh?: boolean;
}): Promise<WorkspaceShareLink> {
	const workspaceId = normalizeId(args.workspaceId);
	const expiresInDays = normalizeExpiryDays(args.expiresInDays);
	const cached = readCachedSecureLink<WorkspaceShareLink>(WORKSPACE_SHARE_CACHE_KEY, workspaceId, args.permission, expiresInDays);
	if (!args.forceRefresh && cached && isUsableExpiry(cached.expiresAt)) {
		return cached;
	}
	if (isOffline()) {
		if (args.userId) {
			enqueuePendingShareLinkRequest({
				id: `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
				userId: args.userId,
				entityType: 'workspace',
				entityId: workspaceId,
				permission: args.permission,
				expiresInDays,
				createdAt: new Date().toISOString(),
			});
		}
		return {
			entityType: 'workspace',
			permission: args.permission,
			shareUrl: cached?.shareUrl ?? null,
			expiresAt: cached?.expiresAt ?? null,
			label: cached?.label,
			pending: true,
		};
	}
	const next = await requestSecureShareLink<WorkspaceShareLink>({ entityType: 'workspace', entityId: workspaceId, permission: args.permission, expiresInDays });
	writeCachedSecureLink(WORKSPACE_SHARE_CACHE_KEY, workspaceId, args.permission, expiresInDays, next);
	return next;
}

export function readCachedNoteShareLink(args: { docId: string; permission: NoteShareRole; expiresInDays: ShareExpiryDays }): NoteShareLink | null {
	return readCachedSecureLink<NoteShareLink>(NOTE_SHARE_CACHE_KEY, args.docId, args.permission, normalizeExpiryDays(args.expiresInDays));
}

export function readCachedWorkspaceShareLink(args: { workspaceId: string; permission: WorkspaceShareRole; expiresInDays: ShareExpiryDays }): WorkspaceShareLink | null {
	return readCachedSecureLink<WorkspaceShareLink>(WORKSPACE_SHARE_CACHE_KEY, args.workspaceId, args.permission, normalizeExpiryDays(args.expiresInDays));
}

export async function ensureDocShareLink(docId: string, opts?: { forceRefresh?: boolean }): Promise<NoteShareLink> {
	return ensureNoteShareLink({ userId: null, docId, permission: 'VIEWER', expiresInDays: 7, forceRefresh: opts?.forceRefresh });
}

function buildWorkspaceInviteCacheKey(workspaceId: string, identifier: string, role: WorkspaceInviteRole): string {
	return `${workspaceId}::${normalizeIdentifier(identifier).toLowerCase()}::${role}`;
}

export function readCachedWorkspaceInviteLink(args: { workspaceId: string; identifier: string; role: WorkspaceInviteRole }): WorkspaceInviteLink | null {
	const workspaceId = normalizeId(args.workspaceId);
	const identifier = normalizeIdentifier(args.identifier);
	if (!workspaceId || !identifier) return null;
	const map = readCacheMap<WorkspaceInviteLink>(WORKSPACE_INVITE_CACHE_KEY);
	return map[buildWorkspaceInviteCacheKey(workspaceId, identifier, args.role)] || null;
}

function writeCachedWorkspaceInviteLink(args: { workspaceId: string; identifier: string; role: WorkspaceInviteRole }, link: WorkspaceInviteLink): void {
	const workspaceId = normalizeId(args.workspaceId);
	const identifier = normalizeIdentifier(args.identifier);
	if (!workspaceId || !identifier) return;
	const map = readCacheMap<WorkspaceInviteLink>(WORKSPACE_INVITE_CACHE_KEY);
	map[buildWorkspaceInviteCacheKey(workspaceId, identifier, args.role)] = link;
	writeCacheMap(WORKSPACE_INVITE_CACHE_KEY, map);
}

async function requestWorkspaceInviteLink(args: {
	workspaceId: string;
	identifier: string;
	role: WorkspaceInviteRole;
	sendEmail: boolean;
}): Promise<WorkspaceInviteLink> {
	const workspaceId = normalizeId(args.workspaceId);
	const identifier = normalizeIdentifier(args.identifier);
	if (!workspaceId) throw new Error('Missing workspaceId');
	if (!identifier) throw new Error('Missing identifier');
	if (isOffline()) {
		const cached = readCachedWorkspaceInviteLink({ workspaceId, identifier, role: args.role });
		if (cached) return cached;
		throw new Error('Invite link unavailable while offline');
	}
	const body = await fetchJson<{
		inviteId?: string;
		inviteUrl?: string;
		expiresAt?: string;
		email?: string;
		identifier?: string;
		role?: WorkspaceInviteRole;
		sentEmail?: boolean;
		deliveredInApp?: boolean;
	}>(`/api/workspaces/${encodeURIComponent(workspaceId)}/invites`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ identifier, role: args.role, sendEmail: args.sendEmail }),
	});
	const role = normalizeWorkspaceInviteRole(body.role || args.role);
	const next: WorkspaceInviteLink = {
		inviteId: typeof body.inviteId === 'string' ? body.inviteId : undefined,
		inviteUrl: typeof body.inviteUrl === 'string' ? body.inviteUrl : '',
		expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : '',
		identifier,
		email: normalizeEmail(body.email || identifier),
		role,
		sentEmail: Boolean(body.sentEmail),
		deliveredInApp: Boolean(body.deliveredInApp),
	};
	if (!next.inviteUrl || !next.expiresAt) throw new Error('Missing invite link');
	writeCachedWorkspaceInviteLink({ workspaceId, identifier, role }, next);
	return next;
}

export async function ensureWorkspaceInviteLink(args: {
	workspaceId: string;
	identifier: string;
	role: WorkspaceInviteRole;
	forceRefresh?: boolean;
}): Promise<WorkspaceInviteLink> {
	const workspaceId = normalizeId(args.workspaceId);
	const identifier = normalizeIdentifier(args.identifier);
	const cached = readCachedWorkspaceInviteLink({ workspaceId, identifier, role: args.role });
	if (!args.forceRefresh && cached && isUsableExpiry(cached.expiresAt)) {
		return cached;
	}
	return requestWorkspaceInviteLink({ workspaceId, identifier, role: args.role, sendEmail: false });
}

export async function sendWorkspaceInviteEmail(args: {
	workspaceId: string;
	identifier: string;
	role: WorkspaceInviteRole;
}): Promise<WorkspaceInviteLink> {
	return requestWorkspaceInviteLink({ workspaceId: args.workspaceId, identifier: args.identifier, role: args.role, sendEmail: true });
}

export async function getShareTokenMetadata(token: string): Promise<ShareTokenMetadata> {
	return fetchJson<ShareTokenMetadata>(`/api/share/${encodeURIComponent(token)}`);
}

export async function acceptShareToken(token: string): Promise<ShareAcceptResult> {
	return fetchJson<ShareAcceptResult>('/api/share/accept', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token }),
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