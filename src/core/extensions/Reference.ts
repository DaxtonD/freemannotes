import { Node, mergeAttributes } from '@tiptap/core';
import { v4 as uuidv4 } from 'uuid';

export type ReferenceNodeType = 'note' | 'user';

export interface ReferenceNodeAttrs {
	type: ReferenceNodeType;
	id: string;
	label: string;
	nodeId: string;
	editRole: 'VIEWER' | 'EDITOR';
	/** Yjs note type (text/checklist/drawing/reminder). null for user references. */
	noteType: string | null;
	/** Avatar URL captured at insertion so chips render correctly offline. null for note references. */
	avatarUrl: string | null;
}

/**
 * Atom inline node that represents a @mention or [[note]] reference.
 * - `type`: entity kind ('user' | 'note')
 * - `id`: stable UUID of the referenced entity
 * - `label`: display text captured at insertion (offline fallback)
 * - `nodeId`: stable UUID assigned at insertion; never changes; used for deep-link targets
 */
export const Reference = Node.create({
	name: 'reference',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,

	addAttributes() {
		return {
			type: { default: null },
			id: { default: null },
			label: { default: '' },
			nodeId: {
				default: null,
				// On paste / collaborative merge, regenerate nodeId if missing
				parseHTML: (element) => element.getAttribute('data-node-id') || uuidv4(),
			},
			editRole: { default: 'EDITOR' },
			// Note type (note/checklist/drawing/reminder) for type-aware icon rendering.
			// null for user references.
			noteType: { default: null },
			// Avatar URL captured at insertion time so it's available offline.
			// null for note references.
			avatarUrl: { default: null },
		};
	},

	parseHTML() {
		return [{ tag: 'span[data-reference]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return [
			'span',
			mergeAttributes(HTMLAttributes, {
				'data-reference': 'true',
				'data-type': HTMLAttributes.type,
				'data-note-type': HTMLAttributes.noteType ?? undefined,
				'data-id': HTMLAttributes.id,
				'data-node-id': HTMLAttributes.nodeId,
				class: 'fn-reference-chip',
			}),
			HTMLAttributes.label ?? '',
		];
	},

	renderText({ node }) {
		return node.attrs.label ?? '';
	},

	addNodeView() {
		// Fallback plain DOM renderer used in non-React environments.
		// ReferenceExtension overrides this with ReactNodeViewRenderer.
		return ({ node }) => {
			const dom = document.createElement('span');
			dom.className = 'fn-reference-chip';
			dom.setAttribute('data-reference', 'true');
			dom.setAttribute('data-type', node.attrs.type ?? '');
			if (node.attrs.noteType) dom.setAttribute('data-note-type', node.attrs.noteType);
			dom.setAttribute('data-id', node.attrs.id ?? '');
			dom.setAttribute('data-node-id', node.attrs.nodeId ?? '');
			dom.contentEditable = 'false';
			dom.textContent = node.attrs.label ?? '';
			return { dom };
		};
	},
});
