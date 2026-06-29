'use strict';

/**
 * @typedef {{ nodeId: string, targetType: 'note'|'user', targetId: string, label: string }} ExtractedReference
 */

/**
 * Walks a ProseMirror JSON document tree and returns every Reference node found.
 * Pure function — no external deps, safe to call inside YjsPersistenceAdapter.
 *
 * @param {unknown} json — ProseMirror doc JSON (from Y.XmlFragment → toProsemirrorJSON)
 * @returns {ExtractedReference[]}
 */
function extractEntityReferences(json) {
	const refs = [];

	function walk(node) {
		if (!node || typeof node !== 'object') return;

		if (node.type === 'reference') {
			const attrs = node.attrs ?? {};
			const nodeId = String(attrs.nodeId ?? '').trim();
			const targetType = String(attrs.type ?? '').trim();
			const targetId = String(attrs.id ?? '').trim();
			const label = String(attrs.label ?? '').trim();

			if (nodeId && targetId && (targetType === 'note' || targetType === 'user')) {
				refs.push({ nodeId, targetType, targetId, label });
			}
		}

		if (Array.isArray(node.content)) {
			for (const child of node.content) walk(child);
		}
	}

	walk(json);
	return refs;
}

module.exports = { extractEntityReferences };
