import { getCachedAvatarUrl } from './userAvatarCache';

const CACHE_KEY = 'freemannotes.userIdentityCache.v1';
const MAX_ENTRIES = 1000;

export type KnownUserIdentity = {
	userId: string | null;
	email: string | null;
	name: string | null;
	profileImage: string | null;
	updatedAt: string;
};

function normalizeText(value: unknown): string {
	return String(value ?? '').trim();
}

function normalizeIdentifier(value: unknown): string {
	return normalizeText(value).toLowerCase();
}

function normalizeEmail(value: unknown): string {
	return normalizeIdentifier(value);
}

function load(): KnownUserIdentity[] {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry): entry is KnownUserIdentity => Boolean(entry && typeof entry === 'object'));
	} catch {
		return [];
	}
}

function save(entries: readonly KnownUserIdentity[]): void {
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
	} catch {
		// Best effort only.
	}
}

let cache: KnownUserIdentity[] | null = null;

function getCache(): KnownUserIdentity[] {
	if (!cache) cache = load();
	return cache;
}

function findEntryIndex(entries: readonly KnownUserIdentity[], candidate: { userId: string | null; email: string | null; name: string | null }): number {
	const normalizedName = normalizeIdentifier(candidate.name);
	return entries.findIndex((entry) => (
		(candidate.userId && entry.userId === candidate.userId)
		|| (candidate.email && entry.email === candidate.email)
		|| (normalizedName && normalizeIdentifier(entry.name) === normalizedName)
	));
}

export function updateKnownUserCache(users: ReadonlyArray<{
	id?: string | null;
	userId?: string | null;
	email?: string | null;
	name?: string | null;
	profileImage?: string | null;
}>): void {
	if (!users.length) return;
	const entries = [...getCache()];
	let changed = false;
	for (const user of users) {
		const userId = normalizeText(user.id ?? user.userId) || null;
		const email = normalizeEmail(user.email) || null;
		const name = normalizeText(user.name) || null;
		const profileImage = typeof user.profileImage === 'string' && user.profileImage.trim() ? user.profileImage : null;
		if (!userId && !email && !name) continue;
		const nextEntry: KnownUserIdentity = {
			userId,
			email,
			name,
			profileImage,
			updatedAt: new Date().toISOString(),
		};
		const index = findEntryIndex(entries, nextEntry);
		if (index >= 0) {
			const previous = entries[index];
			entries[index] = {
				userId: nextEntry.userId ?? previous.userId,
				email: nextEntry.email ?? previous.email,
				name: nextEntry.name ?? previous.name,
				profileImage: nextEntry.profileImage ?? previous.profileImage,
				updatedAt: nextEntry.updatedAt,
			};
		} else {
			entries.push(nextEntry);
		}
		changed = true;
	}
	if (!changed) return;
	entries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	cache = entries.slice(0, MAX_ENTRIES);
	save(cache);
}

export function resolveKnownUser(identifier: string | null | undefined): KnownUserIdentity | null {
	const normalizedIdentifier = normalizeIdentifier(identifier);
	if (!normalizedIdentifier) return null;
	const entries = getCache();
	const emailMatch = entries.find((entry) => entry.email === normalizedIdentifier);
	if (emailMatch) return { ...emailMatch };
	const nameMatch = entries.find((entry) => normalizeIdentifier(entry.name) === normalizedIdentifier);
	return nameMatch ? { ...nameMatch } : null;
}

export function resolveKnownUserProfileImage(identifier: string | null | undefined): string | null {
	const knownUser = resolveKnownUser(identifier);
	if (!knownUser) return null;
	return knownUser.profileImage ?? getCachedAvatarUrl(knownUser.userId);
}