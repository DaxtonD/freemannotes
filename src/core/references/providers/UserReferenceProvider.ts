import type { ReferenceProvider, ReferenceResult } from '../ReferenceProvider';
import { listPriorCollaborators } from '../../priorCollaboratorsApi';

let _workspaceMembersCache: ReferenceResult[] | null = null;
let _loading = false;

async function fetchWorkspaceMembers(): Promise<ReferenceResult[]> {
	if (_workspaceMembersCache) return _workspaceMembersCache;
	if (_loading) return [];
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
		return members;
	} catch {
		return [];
	} finally {
		_loading = false;
	}
}

export function invalidateWorkspaceMembersCache(): void {
	_workspaceMembersCache = null;
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
