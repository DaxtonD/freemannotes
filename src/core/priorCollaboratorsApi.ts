import { updateAvatarCache } from './userAvatarCache';
import { updateKnownUserCache } from './userIdentityCache';

const CACHE_KEY = 'freemannotes.priorCollaborators.v1';

export type PriorCollaboratorUser = {
	id: string | null;
	email: string | null;
	name: string | null;
	profileImage: string | null;
};

type ListResponse = {
	users?: PriorCollaboratorUser[];
};

let cachedUsers: PriorCollaboratorUser[] | null = null;
let inflightRequest: Promise<PriorCollaboratorUser[]> | null = null;
let cacheHydrated = false;
let remoteLoaded = false;

function loadCachedUsers(): PriorCollaboratorUser[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = window.localStorage.getItem(CACHE_KEY);
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
	try {
		window.localStorage.setItem(CACHE_KEY, JSON.stringify({ users }));
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