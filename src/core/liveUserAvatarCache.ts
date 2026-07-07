import React from 'react';

// Module-level reactive avatar cache. Each entry is the most-recently-known
// avatarUrl for a user. ReferenceChip subscribes per-userId so only affected
// chips re-render. NoteCard subscribes globally (avatar changes are rare) so
// the static renderInlineNodes pipeline can read the latest value on re-render.

const _cache = new Map<string, string | null>();
const _listeners = new Map<string, Set<() => void>>();
const _globalListeners = new Set<() => void>();

function getListeners(userId: string): Set<() => void> {
	let s = _listeners.get(userId);
	if (!s) { s = new Set(); _listeners.set(userId, s); }
	return s;
}

export function setLiveUserAvatar(userId: string, url: string | null | undefined): void {
	const resolved = url ?? null;
	if (_cache.get(userId) === resolved) return; // skip no-ops
	_cache.set(userId, resolved);
	getListeners(userId).forEach(fn => fn());
	_globalListeners.forEach(fn => fn());
}

/**
 * React hook: returns the live avatar URL for userId, falling back to
 * `fallback` (the insertion-time value from node.attrs) when the live cache
 * has no entry yet. Only re-renders the calling component when *this user's*
 * avatar changes.
 */
export function useLiveUserAvatar(
	userId: string,
	fallback: string | null | undefined,
): string | null | undefined {
	const [, forceUpdate] = React.useReducer(x => x + 1, 0);
	React.useEffect(() => {
		const listeners = getListeners(userId);
		listeners.add(forceUpdate);
		return () => { listeners.delete(forceUpdate); };
	}, [userId]);
	const cached = _cache.get(userId);
	return cached !== undefined ? cached : fallback;
}

/**
 * React hook for components that render user avatars via a pure function
 * (like NoteCard's renderInlineNodes). Subscribes to ANY avatar change and
 * returns the module-level cache Map so the render function can do
 * `liveAvatarLookup.get(userId) ?? storedAvatarUrl`.
 *
 * Avatar changes are extremely rare so the global subscription is acceptable.
 */
export function useLiveAvatarUrlLookup(): ReadonlyMap<string, string | null> {
	const [, forceUpdate] = React.useReducer(x => x + 1, 0);
	React.useEffect(() => {
		_globalListeners.add(forceUpdate);
		return () => { _globalListeners.delete(forceUpdate); };
	}, []);
	return _cache;
}
