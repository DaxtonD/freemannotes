import { updateAvatarCache } from './userAvatarCache';
import { updateKnownUserCache } from './userIdentityCache';

const CACHE_KEY_PREFIX = 'freemannotes.priorCollaborators.v1:';
// Legacy unscoped key written by older versions — removed on first login to stop cross-user leakage.
const LEGACY_CACHE_KEY = 'freemannotes.priorCollaborators.v1';

export type PriorCollaboratorUser = {
	id: string | null;
	email: string | null;
	name: string | null;
	profileImage: string | null;
};

type ListResponse = {
	users?: PriorCollaboratorUser[];
};

let _currentUserId: string | null = null;
let cachedUsers: PriorCollaboratorUser[] | null = null;
let inflightRequest: Promise<PriorCollaboratorUser[]> | null = null;
let cacheHydrated = false;
let remoteLoaded = false;

function getCacheKey(): string | null {
	return _currentUserId ? `${CACHE_KEY_PREFIX}${_currentUserId}` : null;
}

function loadCachedUsers(): PriorCollaboratorUser[] {
	if (typeof window === 'undefined') return [];
	const key = getCacheKey();
	if (!key) return [];
	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as ListResponse | PriorCollaboratorUser[] | null;
		if (Array.isArray(parsed)) return normalizeUsers(parsed);
		return normalizeUsers(Array.isArray(parsed?.users) ? parsed.users : []);
	} catch {
		return [];
	}
}

function writeCachedUsers(users: readonly PriorCollaboratorUser[]): void {
	if (typeof window === 'undefined') return;
	const key = getCacheKey();
	if (!key) return;
	try {
		window.localStorage.setItem(key, JSON.stringify({ users }));
	} catch {
		// Best effort only.
	}
}

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
	const res = await fetch(input, { credentials: 'include', ...init });
	const contentType = String(res.headers.get('content-type') || '').toLowerCase();
	const body = contentType.includes('application/json') ? await res.json().catch(() => null) : null;
	if (!res.ok) {
		throw new Error(body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`);
	}
	return body as T;
}

function normalizeUsers(users: readonly PriorCollaboratorUser[]): PriorCollaboratorUser[] {
	return users
		.map((user) => ({
			id: typeof user?.id === 'string' && user.id.trim() ? user.id : null,
			email: typeof user?.email === 'string' && user.email.trim() ? user.email.trim().toLowerCase() : null,
			name: typeof user?.name === 'string' && user.name.trim() ? user.name.trim() : null,
			profileImage: typeof user?.profileImage === 'string' && user.profileImage.trim() ? user.profileImage : null,
		}))
		.filter((user) => Boolean(user.id || user.email || user.name));
}

/**
 * Must be called once after a successful login. Removes the old unscoped legacy key
 * (which leaks one user's collaborators to the next), then resets in-memory state so
 * the new user reads only from their own userId-scoped localStorage key.
 */
export function initPriorCollaboratorsForUser(userId: string): void {
	if (typeof window !== 'undefined') {
		try { window.localStorage.removeItem(LEGACY_CACHE_KEY); } catch { /* best effort */ }
	}
	if (_currentUserId !== userId) {
		_currentUserId = userId;
		cachedUsers = null;
		cacheHydrated = false;
		remoteLoaded = false;
		inflightRequest = null;
	}
}

/**
 * Must be called on logout. Resets all in-memory state so a subsequent login by a
 * different user on the same tab cannot read the previous user's cached data.
 * The userId-scoped localStorage key is preserved so the user gets their own cache
 * back on next login without a server round-trip.
 */
export function clearPriorCollaboratorsCache(): void {
	_currentUserId = null;
	cachedUsers = null;
	cacheHydrated = false;
	remoteLoaded = false;
	inflightRequest = null;
}

/** Refresh the prior collaborators cache from the server without clearing
 *  existing cached data first. Safe to call proactively at login — if the
 *  fetch fails (e.g. offline), the existing localStorage cache is untouched. */
export async function refreshPriorCollaboratorsCache(): Promise<void> {
	if (!_currentUserId) return;
	try {
		const body = await fetchJson<ListResponse>('/api/collaborators/history');
		const users = normalizeUsers(Array.isArray(body?.users) ? body.users : []);
		cachedUsers = users;
		remoteLoaded = true;
		cacheHydrated = true;
		writeCachedUsers(users);
		updateKnownUserCache(users);
		updateAvatarCache(users);
	} catch {
		// Offline or error — keep existing cache intact
	}
}

export async function listPriorCollaborators(forceRefresh = false): Promise<PriorCollaboratorUser[]> {
	if (!cacheHydrated) {
		cacheHydrated = true;
		cachedUsers = loadCachedUsers();
		if (cachedUsers.length > 0) {
			updateKnownUserCache(cachedUsers);
			updateAvatarCache(cachedUsers);
		}
	}
	if (!forceRefresh && ((cachedUsers && cachedUsers.length > 0) || (remoteLoaded && cachedUsers))) {
		return cachedUsers;
	}
	if (!forceRefresh && inflightRequest) return inflightRequest;
	const request = fetchJson<ListResponse>('/api/collaborators/history')
		.then((body) => normalizeUsers(Array.isArray(body?.users) ? body.users : []))
		.then((users) => {
			cachedUsers = users;
			remoteLoaded = true;
			writeCachedUsers(users);
			updateKnownUserCache(users);
			updateAvatarCache(users);
			return users;
		})
		.catch((error) => {
			if (cachedUsers && cachedUsers.length > 0) return cachedUsers;
			throw error;
		})
		.finally(() => {
			if (inflightRequest === request) inflightRequest = null;
		});
	inflightRequest = request;
	return request;
}
