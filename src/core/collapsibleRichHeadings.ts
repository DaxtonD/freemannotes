import type { JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

type HeadingLike = {
	type?: string | null;
	attrs?: Record<string, unknown> | null;
} | ProseMirrorNode | null | undefined;

export type CollapsibleHeadingMeta = {
	level: number | null;
	collapsible: boolean;
	collapseId: string | null;
};

export type CollapsibleHeadingLayoutItem<T> = {
	block: T;
	hidden: boolean;
	headingLevel: number | null;
	collapsible: boolean;
	collapseId: string | null;
	collapsed: boolean;
};

function getTypeName(node: HeadingLike): string | null {
	if (!node) return null;
	if ('type' in node && typeof node.type === 'object' && node.type && 'name' in node.type) {
		return typeof node.type.name === 'string' ? node.type.name : null;
	}
	return typeof node.type === 'string' ? node.type : null;
}

function getAttrs(node: HeadingLike): Record<string, unknown> {
	if (!node || !('attrs' in node)) return {};
	return node.attrs && typeof node.attrs === 'object' ? node.attrs : {};
}

function getTextContent(node: HeadingLike): string {
	if (!node) return '';
	if ('textContent' in node && typeof (node as { textContent?: unknown }).textContent === 'string') {
		return String((node as { textContent?: unknown }).textContent ?? '');
	}
	if ('content' in node && Array.isArray((node as { content?: unknown }).content)) {
		return (node as { content: Array<HeadingLike> }).content.map((child) => getTextContent(child)).join('');
	}
	if ('text' in node && typeof (node as { text?: unknown }).text === 'string') {
		return String((node as { text?: unknown }).text ?? '');
	}
	return '';
}

function normalizeHeadingLevel(raw: unknown): number | null {
	const level = Number(raw);
	if (!Number.isFinite(level) || level < 1 || level > 6) return null;
	return Math.round(level);
}

export function getCollapsibleHeadingMeta(node: HeadingLike): CollapsibleHeadingMeta {
	if (getTypeName(node) !== 'heading') {
		return { level: null, collapsible: false, collapseId: null };
	}
	const attrs = getAttrs(node);
	const level = normalizeHeadingLevel(attrs.level);
	const collapseId = typeof attrs.collapseId === 'string' && attrs.collapseId.trim().length > 0
		? attrs.collapseId.trim()
		: null;
	const hasHeadingText = getTextContent(node).trim().length > 0;
	const collapsible = Boolean(attrs.collapsible) && hasHeadingText && level != null && level <= 5 && collapseId !== null;
	return { level, collapsible, collapseId };
}

export function buildCollapsibleHeadingLayout<T extends JSONContent | ProseMirrorNode>(
	blocks: readonly T[],
	isCollapsed: (collapseId: string) => boolean,
): Array<CollapsibleHeadingLayoutItem<T>> {
	const items: Array<CollapsibleHeadingLayoutItem<T>> = [];
	const collapsedAncestorLevels: number[] = [];

	for (const block of blocks) {
		const meta = getCollapsibleHeadingMeta(block);
		if (meta.level != null) {
			while (collapsedAncestorLevels.length > 0 && meta.level <= collapsedAncestorLevels[collapsedAncestorLevels.length - 1]) {
				collapsedAncestorLevels.pop();
			}
		}
		const hidden = collapsedAncestorLevels.length > 0;
		const collapsed = !hidden && meta.collapsible && meta.collapseId ? isCollapsed(meta.collapseId) : false;
		items.push({
			block,
			hidden,
			headingLevel: meta.level,
			collapsible: meta.collapsible,
			collapseId: meta.collapseId,
			collapsed,
		});
		if (!hidden && collapsed && meta.level != null) {
			collapsedAncestorLevels.push(meta.level);
		}
	}

	return items;
}

function forEachChild(node: HeadingLike, callback: (child: HeadingLike) => void): void {
	if (!node) return;
	if ('forEach' in node && typeof (node as ProseMirrorNode).forEach === 'function') {
		(node as ProseMirrorNode).forEach((child) => callback(child));
		return;
	}
	if ('content' in node && Array.isArray((node as { content?: unknown }).content)) {
		for (const child of (node as { content: HeadingLike[] }).content) {
			callback(child);
		}
	}
}

function countListContentUnits(node: HeadingLike): number {
	let count = 0;
	forEachChild(node, (child) => {
		if (getTypeName(child) !== 'listItem') return;
		count += 1;
		forEachChild(child, (inner) => {
			const innerType = getTypeName(inner);
			if (innerType === 'bulletList' || innerType === 'orderedList' || innerType === 'taskList') {
				count += countListContentUnits(inner);
			}
		});
	});
	return count;
}

/** Count document content units in a collapsed section block (paragraphs, list items, etc.). */
export function countCollapsibleContentUnits(node: HeadingLike): number {
	const typeName = getTypeName(node);
	if (!typeName) return 0;
	switch (typeName) {
		case 'bulletList':
		case 'orderedList':
		case 'taskList':
			return countListContentUnits(node);
		case 'blockquote': {
			let innerCount = 0;
			forEachChild(node, (child) => {
				innerCount += countCollapsibleContentUnits(child);
			});
			return innerCount > 0 ? innerCount : 1;
		}
		case 'horizontalRule':
			return 0;
		default:
			return 1;
	}
}

export function formatCollapsedContentSummary(_count: number, isWriting = false): string {
	return isWriting ? 'Writing...' : '';
}