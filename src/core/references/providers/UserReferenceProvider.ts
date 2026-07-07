import type { ReferenceProvider, ReferenceResult } from '../ReferenceProvider';
import { listPriorCollaborators } from '../../priorCollaboratorsApi';
import { setLiveUserAvatar } from '../../liveUserAvatarCache';

const LS_KEY_PREFIX = 'freemannotes.workspaceMembersCache.v1:';

let _workspaceMembersCache: ReferenceResult[] | null = null;
let _loading = false;
let _lsKey: string | null = null;

export function initWorkspaceMembersCacheForUser(userId: string): void {
	const newKey = `${LS_KEY_PREFIX}${userId}`;
	if (newKey !== _lsKey) {
		// User changed — discard in-memory cache to prevent cross-user leakage
		_workspaceMembersCache = null;
	}
	_lsKey = newKey;
	if (_workspaceMembersCache) return;
	try {
		const raw = localStorage.getItem(_lsKey);
		if (raw) {
			const parsed = JSON.parse(raw) as ReferenceResult[];
			if (Array.isArray(parsed) && parsed.length > 0) {
				_workspaceMembersCache = parsed;
				for (const m of parsed) {
					if (m.id) setLiveUserAvatar(m.id, m.avatarUrl ?? null);
				}
			}
		}
	} catch {
		// ignore
	}
}

function saveWorkspaceMembersCacheToStorage(members: ReferenceResult[]): void {
	if (!_lsKey) return;
	try {
		localStorage.setItem(_lsKey, JSON.stringify(members));
	} catch {
		// ignore quota errors
	}
}

async function fetchWorkspaceMembers(): Promise<ReferenceResult[]> {
	if (_workspaceMembersCache) return _workspaceMembersCache;
	if (_loading) {
		// Wait briefly for the in-flight request rather than returning empty
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
		if (_workspaceMembersCache) return _workspaceMembersCache;
		return [];
	}
	_loading = true;
	try {
		const res = await fetch('/api/workspace/members', { credentials: 'include' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = await res.json();
		const members: ReferenceResult[] = (body.members ?? [])
			.filter((m: { id?: string; name?: string }) => m.id && m.name)
			.map((m: { id: string; name: string; email?: string; avatarUrl?: string | null }) => ({
				id: m.id,
				type: 'user' as const,
				label: m.name,
				sublabel: m.email ?? undefined,
				avatarUrl: m.avatarUrl ?? null,
			}));
		_workspaceMembersCache = members;
		saveWorkspaceMembersCacheToStorage(members);
		for (const m of members) {
			if (m.id) setLiveUserAvatar(m.id, m.avatarUrl ?? null);
		}
		return members;
	} catch {
		// Offline or error: return the in-memory cache if it was populated by localStorage on init
		return _workspaceMembersCache ?? [];
	} finally {
		_loading = false;
	}
}

export function invalidateWorkspaceMembersCache(): void {
	_workspaceMembersCache = null;
}

/** Refresh workspace members from the server without clearing the existing cache first.
 *  Safe to call proactively — existing cached results remain available during the fetch. */
export async function refreshUserAvatarsCache(): Promise<void> {
	if (_loading) return;
	_loading = true;
	try {
		const res = await fetch('/api/workspace/members', { credentials: 'include' });
		if (!res.ok) return;
		const body = await res.json();
		const members: ReferenceResult[] = (body.members ?? [])
			.filter((m: { id?: string; name?: string }) => m.id && m.name)
			.map((m: { id: string; name: string; email?: string; avatarUrl?: string | null }) => ({
				id: m.id,
				type: 'user' as const,
				label: m.name,
				sublabel: m.email ?? undefined,
				avatarUrl: m.avatarUrl ?? null,
			}));
		_workspaceMembersCache = members;
		saveWorkspaceMembersCacheToStorage(members);
		for (const m of members) {
			if (m.id) setLiveUserAvatar(m.id, m.avatarUrl ?? null);
		}
	} catch {
		// Offline or error — keep existing cache
	} finally {
		_loading = false;
	}
}

export const UserReferenceProvider: ReferenceProvider = {
	type: 'user',
	groupLabel: 'People',

	async search(query: string): Promise<ReferenceResult[]> {
		const [wsMembers, collaborators] = await Promise.all([
			fetchWorkspaceMembers(),
			listPriorCollaborators().catch(() => []),
		]);

		const byId = new Map<string, ReferenceResult>();
		for (const m of wsMembers) {
			if (m.id) byId.set(m.id, m);
		}
		for (const c of collaborators) {
			if (c.id && !byId.has(c.id)) {
				byId.set(c.id, {
					id: c.id,
					type: 'user',
					label: c.name ?? c.email ?? c.id,
					sublabel: c.email ?? undefined,
					avatarUrl: c.profileImage ?? null,
				});
			}
		}

		const all = Array.from(byId.values());
		const q = query.toLowerCase().trim();
		if (!q) return all.slice(0, 8);

		return all
			.filter((r) =>
				r.label.toLowerCase().includes(q) || (r.sublabel ?? '').toLowerCase().includes(q)
			)
			.slice(0, 8);
	},
};
