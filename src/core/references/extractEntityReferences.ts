// Pure function — no imports, no side effects, ESM.
// Used both client-side and (as CJS copy) in the server persistence layer.

export interface ExtractedReference {
	nodeId: string;
	targetType: 'note' | 'user';
	targetId: string;
	label: string;
}

/**
 * Walks a ProseMirror JSON document tree and returns every Reference node found.
 * Nodes with missing or invalid attributes are silently skipped.
 */
export function extractEntityReferences(json: unknown): ExtractedReference[] {
	const refs: ExtractedReference[] = [];

	function walk(node: unknown): void {
		if (!node || typeof node !== 'object') return;
		const n = node as Record<string, unknown>;

		if (n.type === 'reference') {
			const attrs = ((n.attrs ?? {}) as Record<string, unknown>);
			const nodeId = String(attrs.nodeId ?? '').trim();
			const targetType = String(attrs.type ?? '').trim();
			const targetId = String(attrs.id ?? '').trim();
			const label = String(attrs.label ?? '').trim();

			if (nodeId && targetId && (targetType === 'note' || targetType === 'user')) {
				refs.push({ nodeId, targetType: targetType as 'note' | 'user', targetId, label });
			}
		}

		if (Array.isArray(n.content)) {
			for (const child of n.content) walk(child);
		}
	}

	walk(json);
	return refs;
}
