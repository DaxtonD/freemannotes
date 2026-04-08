import * as Y from 'yjs';
import type { DocumentManager } from '../core/DocumentManager';

export const LABELS_REGISTRY_DOC_ID = '__labels_registry__';

const LABELS_KEY = 'labels';

export type LabelRecord = {
	id: string;
	name: string;
	color: string | null;
	createdAt: string;
};

function nowIso(): string {
	return new Date().toISOString();
}

function normalizeId(value: unknown): string {
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeName(value: unknown): string {
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeComparableName(value: unknown): string {
	return normalizeName(value).toLocaleLowerCase();
}

function normalizeColor(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function makeLabelId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `label-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getLabelsArray(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
	return doc.getArray<Y.Map<unknown>>(LABELS_KEY);
}

function normalizeLabelRow(row: Y.Map<unknown>): LabelRecord | null {
	const id = normalizeId(row.get('id'));
	const name = normalizeName(row.get('name'));
	if (!id || !name) return null;
	return {
		id,
		name,
		color: normalizeColor(row.get('color')),
		createdAt: typeof row.get('createdAt') === 'string' ? String(row.get('createdAt')) : nowIso(),
	};
}

export async function getLabelsRegistryDoc(manager: DocumentManager): Promise<Y.Doc> {
	return manager.getDocWithSync(LABELS_REGISTRY_DOC_ID);
}

export function subscribeLabels(doc: Y.Doc, listener: () => void): () => void {
	const labels = getLabelsArray(doc);
	const notify = (): void => listener();
	labels.observeDeep(notify);
	return () => {
		labels.unobserveDeep(notify);
	};
}

export function readLabelsFromDoc(doc: Y.Doc): LabelRecord[] {
	return getLabelsArray(doc)
		.toArray()
		.map((row) => normalizeLabelRow(row))
		.filter((row): row is LabelRecord => Boolean(row))
		.sort((left, right) => left.name.localeCompare(right.name));
}

export function createLabel(doc: Y.Doc, args: { name: string; color?: string | null }): LabelRecord | null {
	const name = normalizeName(args.name);
	if (!name) return null;
	if (hasLabelNameConflict(readLabelsFromDoc(doc), name)) return null;
	const label: LabelRecord = {
		id: makeLabelId(),
		name,
		color: normalizeColor(args.color),
		createdAt: nowIso(),
	};
	const labels = getLabelsArray(doc);
	doc.transact(() => {
		const row = new Y.Map<unknown>();
		row.set('id', label.id);
		row.set('name', label.name);
		row.set('color', label.color);
		row.set('createdAt', label.createdAt);
		labels.push([row]);
	});
	return label;
}

export function updateLabel(doc: Y.Doc, labelId: string, patch: { name?: string; color?: string | null }): boolean {
	const targetId = normalizeId(labelId);
	if (!targetId) return false;
	const target = getLabelsArray(doc).toArray().find((row) => normalizeId(row.get('id')) === targetId) ?? null;
	if (!target) return false;
	const nextName = patch.name === undefined ? undefined : normalizeName(patch.name);
	if (patch.name !== undefined && !nextName) return false;
	if (nextName !== undefined && hasLabelNameConflict(readLabelsFromDoc(doc), nextName, targetId)) return false;
	doc.transact(() => {
		if (nextName !== undefined) target.set('name', nextName);
		if (patch.color !== undefined) target.set('color', normalizeColor(patch.color));
	});
	return true;
}

export function deleteLabel(doc: Y.Doc, labelId: string): boolean {
	const targetId = normalizeId(labelId);
	if (!targetId) return false;
	const labels = getLabelsArray(doc);
	const rows = labels.toArray();
	const index = rows.findIndex((row) => normalizeId(row.get('id')) === targetId);
	if (index < 0) return false;
	doc.transact(() => {
		labels.delete(index, 1);
	});
	return true;
}

export function hasLabelNameConflict(labels: readonly LabelRecord[], name: string, ignoreLabelId?: string | null): boolean {
	const comparableName = normalizeComparableName(name);
	if (!comparableName) return false;
	const ignoredId = normalizeId(ignoreLabelId);
	return labels.some((label) => {
		if (ignoredId && label.id === ignoredId) return false;
		return normalizeComparableName(label.name) === comparableName;
	});
}