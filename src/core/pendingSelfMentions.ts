// Client-side store for self-mention notifications that were created offline
// and haven't yet been confirmed by the server. Persisted to localStorage so
// the notification survives page reloads while still offline.

const KEY_PREFIX = 'freemannotes.pendingSelfMentions.v1:';

export interface PendingSelfMention {
	/** Local-only ID prefixed with 'pending-' to distinguish from real Activity IDs. */
	id: string;
	noteId: string;
	workspaceId: string;
	/** The ProseMirror node UUID assigned to the reference chip. Used to match
	 *  against real server Activity deepLink.nodeId when online sync completes. */
	nodeId: string;
	noteTitle: string | null;
	insertedAt: string;
	actorId: string;
	actorName: string | null;
	actorAvatarUrl: string | null;
}

let _userId: string | null = null;

function getKey(): string | null {
	return _userId ? `${KEY_PREFIX}${_userId}` : null;
}

function load(): PendingSelfMention[] {
	const key = getKey();
	if (!key || typeof window === 'undefined') return [];
	try {
		const raw = window.localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as PendingSelfMention[]) : [];
	} catch {
		return [];
	}
}

function save(items: PendingSelfMention[]): void {
	const key = getKey();
	if (!key || typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(key, JSON.stringify(items));
	} catch {
		// Best effort only.
	}
}

/** Must be called once after a successful login. */
export function initPendingSelfMentionsForUser(userId: string): void {
	_userId = userId;
}

/** Must be called on logout so the store cannot be read by the next user. */
export function clearPendingSelfMentionsStore(): void {
	_userId = null;
}

export function getPendingSelfMentions(): PendingSelfMention[] {
	return load();
}

export function addPendingSelfMention(entry: Omit<PendingSelfMention, 'id'>): PendingSelfMention {
	const item: PendingSelfMention = { id: `pending-${crypto.randomUUID()}`, ...entry };
	const items = load();
	items.unshift(item);
	save(items);
	return item;
}

export function dismissPendingSelfMention(id: string): void {
	save(load().filter((x) => x.id !== id));
}

/**
 * Removes pending entries whose nodeId matches a nodeId from a real server
 * Activity. Called after InboxView successfully fetches real activities so
 * duplicates disappear automatically on reconnect.
 */
export function clearMatchedPendingSelfMentions(serverNodeIds: readonly string[]): void {
	const nodeIdSet = new Set(serverNodeIds);
	save(load().filter((x) => !nodeIdSet.has(x.nodeId)));
}

/** Clears all pending self-mention entries for the current user. */
export function clearAllPendingSelfMentions(): void {
	save([]);
}
