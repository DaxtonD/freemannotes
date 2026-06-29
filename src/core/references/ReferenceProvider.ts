// Reference provider registry — all @-mention autocomplete sources register here.

export type ReferenceEntityType = 'note' | 'user';

export interface ReferenceResult {
	id: string;
	type: ReferenceEntityType;
	label: string;
	sublabel?: string;
	avatarUrl?: string | null;
	/** For type='note': the Yjs metadata 'type' field (text|rich|checklist|drawing) */
	noteType?: string;
	/** For type='user': role assigned at insertion time ('VIEWER' | 'EDITOR', default 'EDITOR') */
	editRole?: 'VIEWER' | 'EDITOR';
}

export interface ReferenceGroup {
	type: ReferenceEntityType;
	groupLabel: string;
	results: ReferenceResult[];
}

export interface ReferenceProvider {
	type: ReferenceEntityType;
	groupLabel: string;
	search(query: string): Promise<ReferenceResult[]>;
}

const _providers: ReferenceProvider[] = [];

export function registerReferenceProvider(provider: ReferenceProvider): void {
	if (_providers.some((p) => p.type === provider.type)) return;
	_providers.push(provider);
}

export async function searchReferenceProviders(query: string): Promise<ReferenceGroup[]> {
	const groups = await Promise.all(
		_providers.map(async (provider) => ({
			type: provider.type,
			groupLabel: provider.groupLabel,
			results: await provider.search(query).catch(() => [] as ReferenceResult[]),
		}))
	);
	return groups.filter((g) => g.results.length > 0);
}
