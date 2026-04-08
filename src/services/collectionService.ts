import * as Y from 'yjs';
import type { DocumentManager } from '../core/DocumentManager';

export const COLLECTIONS_REGISTRY_DOC_ID = '__collections_registry__';

const COLLECTIONS_KEY = 'collections';

export type CollectionRecord = {
	id: string;
	name: string;
	parentId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type CollectionTreeNode = CollectionRecord & {
	children: CollectionTreeNode[];
	depth: number;
};

function nowIso(): string {
	return new Date().toISOString();
}

function normalizeId(value: unknown): string {
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeOptionalId(value: unknown): string | null {
	const normalized = normalizeId(value);
	return normalized.length > 0 ? normalized : null;
}

function normalizeName(value: unknown): string {
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeComparableName(value: unknown): string {
	return normalizeName(value).toLocaleLowerCase();
}

function makeCollectionId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `collection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCollectionsArray(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
	return doc.getArray<Y.Map<unknown>>(COLLECTIONS_KEY);
}

function normalizeCollectionRow(row: Y.Map<unknown>): CollectionRecord | null {
	const id = normalizeId(row.get('id'));
	const name = normalizeName(row.get('name'));
	if (!id || !name) return null;
	const createdAt = typeof row.get('createdAt') === 'string' ? String(row.get('createdAt')) : nowIso();
	const updatedAt = typeof row.get('updatedAt') === 'string' ? String(row.get('updatedAt')) : createdAt;
	return {
		id,
		name,
		parentId: normalizeOptionalId(row.get('parentId')),
		createdAt,
		updatedAt,
	};
}

export async function getCollectionsRegistryDoc(manager: DocumentManager): Promise<Y.Doc> {
	return manager.getDocWithSync(COLLECTIONS_REGISTRY_DOC_ID);
}

export function subscribeCollections(doc: Y.Doc, listener: () => void): () => void {
	const collections = getCollectionsArray(doc);
	const notify = (): void => listener();
	collections.observeDeep(notify);
	return () => {
		collections.unobserveDeep(notify);
	};
}

export function readCollectionsFromDoc(doc: Y.Doc): CollectionRecord[] {
	return getCollectionsArray(doc)
		.toArray()
		.map((row) => normalizeCollectionRow(row))
		.filter((row): row is CollectionRecord => Boolean(row))
		.sort((left, right) => left.name.localeCompare(right.name));
}

export function createCollection(doc: Y.Doc, args: { name: string; parentId?: string | null }): CollectionRecord | null {
	const name = normalizeName(args.name);
	if (!name) return null;
	const parentId = normalizeOptionalId(args.parentId);
	if (hasCollectionNameConflict(readCollectionsFromDoc(doc), name, parentId)) return null;
	const collection: CollectionRecord = {
		id: makeCollectionId(),
		name,
		parentId,
		createdAt: nowIso(),
		updatedAt: nowIso(),
	};
	const collections = getCollectionsArray(doc);
	doc.transact(() => {
		const row = new Y.Map<unknown>();
		row.set('id', collection.id);
		row.set('name', collection.name);
		row.set('parentId', collection.parentId);
		row.set('createdAt', collection.createdAt);
		row.set('updatedAt', collection.updatedAt);
		collections.push([row]);
	});
	return collection;
}

export function updateCollection(doc: Y.Doc, collectionId: string, patch: { name?: string; parentId?: string | null }): boolean {
	const targetId = normalizeId(collectionId);
	if (!targetId) return false;
	const collections = getCollectionsArray(doc);
	const target = collections.toArray().find((row) => normalizeId(row.get('id')) === targetId) ?? null;
	if (!target) return false;
	const nextName = patch.name === undefined ? undefined : normalizeName(patch.name);
	if (patch.name !== undefined && !nextName) return false;
	const nextParentId = patch.parentId === undefined ? undefined : normalizeOptionalId(patch.parentId);
	const current = normalizeCollectionRow(target);
	if (!current) return false;
	const resolvedParentId = nextParentId === undefined ? current.parentId : (nextParentId === targetId ? null : nextParentId);
	const resolvedName = nextName ?? current.name;
	if (hasCollectionNameConflict(readCollectionsFromDoc(doc), resolvedName, resolvedParentId, targetId)) return false;
	doc.transact(() => {
		if (nextName !== undefined) target.set('name', nextName);
		if (nextParentId !== undefined) target.set('parentId', nextParentId === targetId ? null : nextParentId);
		target.set('updatedAt', nowIso());
	});
	return true;
}

export function deleteCollection(doc: Y.Doc, collectionId: string): boolean {
	const targetId = normalizeId(collectionId);
	if (!targetId) return false;
	const collections = getCollectionsArray(doc);
	const rows = collections.toArray();
	const index = rows.findIndex((row) => normalizeId(row.get('id')) === targetId);
	if (index < 0) return false;
	doc.transact(() => {
		for (const row of rows) {
			if (normalizeOptionalId(row.get('parentId')) === targetId) {
				row.set('parentId', null);
				row.set('updatedAt', nowIso());
			}
		}
		collections.delete(index, 1);
	});
	return true;
}

export function buildCollectionTree(collections: readonly CollectionRecord[]): CollectionTreeNode[] {
	const byId = new Map<string, CollectionTreeNode>();
	for (const collection of collections) {
		byId.set(collection.id, { ...collection, children: [], depth: 0 });
	}
	// Build parent/child links in a second pass so out-of-order rows from Yjs still
	// produce a stable tree for the sidebar and modal pickers.
	const roots: CollectionTreeNode[] = [];
	for (const node of byId.values()) {
		const parent = node.parentId ? byId.get(node.parentId) ?? null : null;
		if (!parent || parent.id === node.id) {
			roots.push(node);
			continue;
		}
		node.depth = parent.depth + 1;
		parent.children.push(node);
	}
	const sortNodes = (nodes: CollectionTreeNode[]): void => {
		nodes.sort((left, right) => left.name.localeCompare(right.name));
		for (const node of nodes) {
			for (const child of node.children) {
				child.depth = node.depth + 1;
			}
			sortNodes(node.children);
		}
	};
	sortNodes(roots);
	return roots;
}

export function flattenCollectionTree(nodes: readonly CollectionTreeNode[]): CollectionTreeNode[] {
	const output: CollectionTreeNode[] = [];
	const walk = (list: readonly CollectionTreeNode[]): void => {
		for (const node of list) {
			output.push(node);
			walk(node.children);
		}
	};
	walk(nodes);
	return output;
}

export function buildCollectionPathMap(
	collections: readonly CollectionRecord[],
	separator = ' / '
): Map<string, string> {
	const byId = new Map(collections.map((collection) => [collection.id, collection] as const));
	const cache = new Map<string, string>();
	// Cache each computed path so repeated sidebar/search lookups stay cheap even
	// when a collection tree is deeply nested.
	const visit = (collectionId: string, seen = new Set<string>()): string => {
		if (cache.has(collectionId)) return cache.get(collectionId) || '';
		const collection = byId.get(collectionId) ?? null;
		if (!collection) return '';
		if (seen.has(collectionId)) return collection.name;
		const nextSeen = new Set(seen);
		nextSeen.add(collectionId);
		const parentPath = collection.parentId ? visit(collection.parentId, nextSeen) : '';
		const path = parentPath ? `${parentPath}${separator}${collection.name}` : collection.name;
		cache.set(collectionId, path);
		return path;
	};
	for (const collection of collections) {
		visit(collection.id);
	}
	return cache;
}

export function buildCollectionPath(
	collectionId: string | null | undefined,
	collections: readonly CollectionRecord[],
	separator = ' / '
): string | null {
	const normalizedId = typeof collectionId === 'string' ? collectionId.trim() : '';
	if (!normalizedId) return null;
	return buildCollectionPathMap(collections, separator).get(normalizedId) ?? null;
}

export function hasCollectionNameConflict(
	collections: readonly CollectionRecord[],
	name: string,
	parentId: string | null | undefined,
	ignoreCollectionId?: string | null
): boolean {
	const comparableName = normalizeComparableName(name);
	if (!comparableName) return false;
	const comparableParentId = normalizeOptionalId(parentId);
	const ignoredId = normalizeOptionalId(ignoreCollectionId);
	return collections.some((collection) => {
		if (ignoredId && collection.id === ignoredId) return false;
		return normalizeOptionalId(collection.parentId) === comparableParentId
			&& normalizeComparableName(collection.name) === comparableName;
	});
}

export function formatCompactCollectionPath(path: string, separator = ' / ', maxLeafLength = 18): string {
	const normalized = normalizeName(path);
	if (!normalized) return '';
	const parts = normalized.split(separator).map((part) => part.trim()).filter(Boolean);
	const truncate = (value: string): string => value.length > maxLeafLength ? `${value.slice(0, Math.max(1, maxLeafLength - 3)).trimEnd()}...` : value;
	// Preserve the root and active leaf so deep collection paths stay readable in
	// tight chip/dropdown layouts without losing their most useful context.
	if (parts.length <= 1) return truncate(normalized);
	const root = parts[0] ?? '';
	const leaf = truncate(parts[parts.length - 1] ?? '');
	return `${root}${separator}...${separator}${leaf}`;
}