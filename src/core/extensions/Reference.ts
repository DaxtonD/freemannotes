import { Node, mergeAttributes } from '@tiptap/core';
import { v4 as uuidv4 } from 'uuid';

export type ReferenceNodeType = 'note' | 'user';

export interface ReferenceNodeAttrs {
	type: ReferenceNodeType;
	id: string;
	label: string;
	nodeId: string;
	editRole: 'VIEWER' | 'EDITOR';
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
				'data-id': HTMLAttributes.id,
				'data-node-id': HTMLAttributes.nodeId,
				class: 'fn-reference-chip',
			}),
			`@${HTMLAttributes.label ?? ''}`,
		];
	},

	renderText({ node }) {
		return `@${node.attrs.label ?? ''}`;
	},

	addNodeView() {
		return ({ node }) => {
			const dom = document.createElement('span');
			dom.className = 'fn-reference-chip';
			dom.setAttribute('data-reference', 'true');
			dom.setAttribute('data-type', node.attrs.type ?? '');
			dom.setAttribute('data-id', node.attrs.id ?? '');
			dom.setAttribute('data-node-id', node.attrs.nodeId ?? '');
			dom.contentEditable = 'false';
			dom.textContent = `@${node.attrs.label ?? ''}`;
			return { dom };
		};
	},
});
