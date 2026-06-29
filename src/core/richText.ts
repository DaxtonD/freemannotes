import { generateText, getRenderedAttributes, getSchema, type Editor, type Extensions, type JSONContent } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import Heading from '@tiptap/extension-heading';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';
import MarkdownIt from 'markdown-it';
import markdownItTaskLists from 'markdown-it-task-lists';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { ReplaceStep } from '@tiptap/pm/transform';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { buildCollapsibleHeadingLayout, getCollapsibleHeadingMeta, getHeadingSectionEndIndex } from './collapsibleRichHeadings';
import { getRichHeadingCollapsed, saveRichHeadingCollapsed, subscribeCollapsedRichHeadingPrefs } from './collapsibleHeadingPreferences';
import {
	beginHeadingCollapseDebugSession,
	endHeadingCollapseDebugSession,
	isHeadingCollapseDebugEnabled,
	measureNoteContainerHeight,
	recordHeadingCollapseDebug,
} from './collapsibleHeadingCollapseDebug';
import { getDeviceId } from './deviceId';
import { getExternalLinkRel, getExternalLinkTarget } from './externalLinks';
import { ReferenceExtension } from './extensions/ReferenceExtension';

export const TEXT_NOTE_RICH_FIELD = 'contentRich';
export const CHECKLIST_ITEM_RICH_FIELD = 'contentRich';
export const RICHTEXT_INTERNAL_ORIGIN = 'freemannotes:richtext-internal';

export type RichTextVariant = 'full' | 'minimal';

const markdownParser = new MarkdownIt({
	html: false,
	linkify: true,
	typographer: false,
}).use(markdownItTaskLists, {
	enabled: true,
	label: false,
	labelAfter: false,
});

const MEANINGFUL_CLIPBOARD_HTML_PATTERN = /<(p|div|ul|ol|li|strong|b|em|i|a|h1|h2|h3|blockquote|pre|code|table|thead|tbody|tr|th|td|hr)\b/i;
const MARKDOWN_BLOCK_PATTERN = /(^|\n)(#{1,6}\s|>\s|[-+*]\s|\d+\.\s|```|~~~|\|.+\||\s*[-+*]\s\[[ xX]\]\s)|(^|\n)\s*([-*_])(?:\s*\3){2,}\s*($|\n)/m;
const MARKDOWN_INLINE_PATTERN = /(\*\*[^*\n][\s\S]*?\*\*|__[^_\n][\s\S]*?__|~~[^~\n][\s\S]*?~~|==[^=\n][\s\S]*?==|`[^`\n]+`|\[[^\]]+\]\([^\)]+\)|!\[[^\]]*\]\([^\)]+\))/;
const CLIPBOARD_BLOCK_SELECTOR = 'p,div,section,article,header,footer,aside,blockquote,pre,ul,ol,li,table,thead,tbody,tfoot,tr,hr,h1,h2,h3,h4,h5,h6';
const CLIPBOARD_CELL_SELECTOR = 'th,td';
const MARKDOWN_MARK_PATTERN = /==(?=\S)([\s\S]*?\S)==/g;

// Meta key used to mark internally-generated regeneration transactions so the
// plugin does not re-process its own output and loop indefinitely.
const TASK_ITEM_REGEN_META = 'taskItemCrdt';
const COLLAPSIBLE_HEADING_REFRESH_META = 'collapsibleHeadingRefresh';
const COLLAPSIBLE_HEADING_ID_REPAIR_META = 'collapsibleHeadingRepair';
const COLLAPSIBLE_HEADING_FADE_MS = 180;
const COLLAPSIBLE_HEADING_ANIMATION_MS = COLLAPSIBLE_HEADING_FADE_MS;
const COLLAPSIBLE_HEADING_PHASE_BUFFER_MS = 24;
const COLLAPSIBLE_HEADING_MAX_ANIMATED_BLOCKS = 18;
const COLLAPSIBLE_HEADING_MAX_ANIMATED_HEIGHT = 1800;
const COLLAPSIBLE_HEADING_TOGGLE_HITBOX_PX = 24;
const COLLAPSIBLE_HEADING_TOGGLE_HITBOX_COARSE_PX = 44;
// Must stay in sync with `.fn-collapsible-heading::after` in Editors.module.css.
const COLLAPSIBLE_HEADING_ARROW_VISUAL_WIDTH_PX = 20;
const COLLAPSIBLE_HEADING_ARROW_INSET_ADJUST_PX = 7;
const COLLAPSIBLE_HEADING_SELECTION_REPAIR_META = 'collapsibleHeadingSelectionRepair';
const COLLAPSIBLE_HEADING_ANIMATION_REFRESH_EVENT = 'freemannotes:rich-heading-animation-refresh';
const activeCollapsibleHeadingAnimations = new Set<string>();
const activeSectionCollapseAnimations = new Map<string, SectionCollapseAnimationState>();
const activeSectionCollapseAnimationTimeouts = new Map<string, number>();
const lastSectionCollapseMetrics = new Map<string, SectionCollapseMetrics>();
const visibleCollapsedHeadingExitStarts = new Map<string, number>();
// Transient "Writing..." label only. Exit-start positions may persist after close so
// content written under a collapsed heading stays visible; labels always clear on save/close.
const activeCollapsedHeadingWritingLabels = new Set<string>();

function createCollapsibleHeadingId(): string {
	try {
		return crypto.randomUUID();
	} catch {
		return `heading-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	}
}

function findActiveHeading(state: Editor['state']): { node: ProseMirrorNode; pos: number } | null {
	const { $from } = state.selection;
	for (let depth = $from.depth; depth > 0; depth -= 1) {
		const node = $from.node(depth);
		if (node.type.name === 'heading') {
			return { node, pos: $from.before(depth) };
		}
	}
	return null;
}

function isSelectionWithinHeadingText(
	state: Editor['state'],
	headingPos: number,
	headingNode: ProseMirrorNode,
): boolean {
	const textStart = headingPos + 1;
	const textEnd = headingPos + headingNode.nodeSize - 1;
	return state.selection.from >= textStart && state.selection.to <= textEnd;
}

function findCollapsedHeadingEnterContext(state: Editor['state'], noteId: string): {
	heading: { node: ProseMirrorNode; pos: number };
	meta: { level: number; collapseId: string };
	blocks: ProseMirrorNode[];
	positions: number[];
	headingIndex: number;
} | null {
	const activeHeading = findActiveHeading(state);
	if (activeHeading) {
		const meta = getCollapsibleHeadingMeta(activeHeading.node);
		if (
			meta.collapsible &&
			meta.collapseId &&
			meta.level != null &&
			getRichHeadingCollapsed(noteId, meta.collapseId) &&
			isSelectionWithinHeadingText(state, activeHeading.pos, activeHeading.node)
		) {
			const { blocks, positions } = getTopLevelBlocks(state.doc);
			const headingIndex = positions.indexOf(activeHeading.pos);
			if (headingIndex >= 0) {
				return {
					heading: activeHeading,
					meta: { level: meta.level, collapseId: meta.collapseId },
					blocks,
					positions,
					headingIndex,
				};
			}
		}
	}
	if (!state.selection.empty) return null;
	const { blocks, positions } = getTopLevelBlocks(state.doc);
	for (let index = 0; index < blocks.length; index += 1) {
		const node = blocks[index];
		if (positions[index] + node.nodeSize !== state.selection.from) continue;
		const meta = getCollapsibleHeadingMeta(node);
		if (!meta.collapsible || !meta.collapseId || meta.level == null || !getRichHeadingCollapsed(noteId, meta.collapseId)) {
			continue;
		}
		return {
			heading: { node, pos: positions[index] },
			meta: { level: meta.level, collapseId: meta.collapseId },
			blocks,
			positions,
			headingIndex: index,
		};
	}
	return null;
}

function getTopLevelBlocks(doc: ProseMirrorNode): { blocks: ProseMirrorNode[]; positions: number[] } {
	const blocks: ProseMirrorNode[] = [];
	const positions: number[] = [];
	doc.forEach((node, offset) => {
		blocks.push(node);
		positions.push(offset);
	});
	return { blocks, positions };
}

function getHeadingSectionIndexes(
	blocks: readonly ProseMirrorNode[],
	headingIndex: number,
	headingLevel: number,
): { startIndex: number; endIndexExclusive: number } {
	return {
		startIndex: headingIndex + 1,
		endIndexExclusive: getHeadingSectionEndIndex(blocks, headingIndex, headingLevel),
	};
}

function hasFollowingTopLevelBlocks(
	blocks: readonly ProseMirrorNode[],
	headingIndex: number,
	headingLevel: number,
): boolean {
	const { endIndexExclusive } = getHeadingSectionIndexes(blocks, headingIndex, headingLevel);
	return endIndexExclusive < blocks.length;
}

function getHeadingSectionRange(
	doc: ProseMirrorNode,
	blocks: readonly ProseMirrorNode[],
	positions: readonly number[],
	headingIndex: number,
	headingNode: ProseMirrorNode,
	headingLevel: number,
): { contentStartPos: number; contentEndPos: number; blockPositions: number[] } {
	const { startIndex, endIndexExclusive } = getHeadingSectionIndexes(blocks, headingIndex, headingLevel);
	return {
		contentStartPos: positions[headingIndex] + headingNode.nodeSize,
		contentEndPos: endIndexExclusive < positions.length ? positions[endIndexExclusive] : doc.content.size,
		blockPositions: positions.slice(startIndex, endIndexExclusive),
	};
}

type CollapsibleHeadingLocation = {
	pos: number;
	node: ProseMirrorNode;
	index: number;
	level: number;
	collapseId: string;
	collapsed: boolean;
};

function findCollapsibleHeadingById(doc: ProseMirrorNode, noteId: string, collapseId: string): CollapsibleHeadingLocation | null {
	const { blocks, positions } = getTopLevelBlocks(doc);
	for (let index = 0; index < blocks.length; index += 1) {
		const meta = getCollapsibleHeadingMeta(blocks[index]);
		if (!meta.collapsible || meta.collapseId !== collapseId || meta.level == null) continue;
		return {
			pos: positions[index],
			node: blocks[index],
			index,
			level: meta.level,
			collapseId,
			collapsed: getRichHeadingCollapsed(noteId, collapseId),
		};
	}
	return null;
}

function findCollapsibleHeadingFromToggleElement(
	view: EditorView,
	noteId: string,
	headingElement: HTMLElement,
): CollapsibleHeadingLocation | null {
	const collapseId = headingElement.getAttribute('data-collapsible-heading-id');
	if (collapseId) {
		const found = findCollapsibleHeadingById(view.state.doc, noteId, collapseId);
		if (found) return found;
	}
	try {
		const pos = view.posAtDOM(headingElement, 0);
		if (typeof pos !== 'number' || pos < 0) return null;
		const $pos = view.state.doc.resolve(pos);
		for (let depth = $pos.depth; depth > 0; depth -= 1) {
			const node = $pos.node(depth);
			if (node.type.name !== 'heading') continue;
			const meta = getCollapsibleHeadingMeta(node);
			if (!meta.collapsible || !meta.collapseId || meta.level == null) return null;
			const headingPos = $pos.before(depth);
			const { blocks, positions } = getTopLevelBlocks(view.state.doc);
			const headingIndex = positions.indexOf(headingPos);
			if (headingIndex < 0) return null;
			return {
				pos: headingPos,
				node,
				index: headingIndex,
				level: meta.level,
				collapseId: meta.collapseId,
				collapsed: getRichHeadingCollapsed(noteId, meta.collapseId),
			};
		}
	} catch {
		return null;
	}
	return null;
}

function makeCollapsibleHeadingUiKey(noteId: string, collapseId: string): string {
	return `${noteId}::${collapseId}`;
}

function dispatchCollapsibleHeadingAnimationRefresh(noteId: string, collapsed?: boolean): void {
	if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
	window.dispatchEvent(new CustomEvent(COLLAPSIBLE_HEADING_ANIMATION_REFRESH_EVENT, {
		detail: { noteId, collapsed },
	}));
}

function noteHasActiveCollapsibleHeadingAnimation(noteId: string): boolean {
	const prefix = `${noteId}::`;
	for (const animationKey of activeCollapsibleHeadingAnimations) {
		if (animationKey.startsWith(prefix)) return true;
	}
	return false;
}

function findCollapsibleHeadingElement(target: EventTarget | null): HTMLElement | null {
	if (!(target instanceof Node)) return null;
	const element = target instanceof HTMLElement ? target : target.parentElement;
	return element?.closest('[data-collapsible-heading="true"]') as HTMLElement | null;
}

function setCollapsibleHeadingToggleHover(element: HTMLElement | null, isHoveringToggle: boolean): void {
	if (!element) return;
	element.classList.toggle('fn-collapsible-heading-toggle-hover', isHoveringToggle);
}

function resolveHeadingOverlayLengthPx(element: HTMLElement, value: string): number {
	const trimmed = value.trim();
	if (!trimmed) return 0;
	if (trimmed.endsWith('px')) return Number.parseFloat(trimmed) || 0;
	if (trimmed.endsWith('rem')) {
		const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
		return (Number.parseFloat(trimmed) || 0) * rootFontSize;
	}
	if (trimmed.endsWith('em')) {
		const fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize) || 16;
		return (Number.parseFloat(trimmed) || 0) * fontSize;
	}
	return Number.parseFloat(trimmed) || 0;
}

function isCoarsePointerInteraction(): boolean {
	return typeof window !== 'undefined'
		&& typeof window.matchMedia === 'function'
		&& window.matchMedia('(pointer: coarse)').matches;
}

function getCollapsibleHeadingToggleHitboxPx(): number {
	if (isCoarsePointerInteraction()) {
		return COLLAPSIBLE_HEADING_TOGGLE_HITBOX_COARSE_PX;
	}
	return COLLAPSIBLE_HEADING_TOGGLE_HITBOX_PX;
}

type CollapsibleHeadingToggleGeometry = {
	toggleVisualLeft: number;
	toggleVisualRight: number;
	arrowCenterX: number;
};

// Derive chevron bounds from the same CSS custom properties that position ::after.
// Do not widen hit-testing from the heading's padding edge — that steals clicks from
// the caret zone after the last heading character.
function getCollapsibleHeadingToggleGeometry(element: HTMLElement): CollapsibleHeadingToggleGeometry {
	const rect = element.getBoundingClientRect();
	const styles = window.getComputedStyle(element);
	const summarySpace = resolveHeadingOverlayLengthPx(element, styles.getPropertyValue('--collapsible-heading-summary-space'));
	const arrowGap = resolveHeadingOverlayLengthPx(element, styles.getPropertyValue('--collapsible-heading-arrow-gap'));
	const toggleVisualRight = rect.right - summarySpace - arrowGap + COLLAPSIBLE_HEADING_ARROW_INSET_ADJUST_PX;
	const toggleVisualLeft = toggleVisualRight - COLLAPSIBLE_HEADING_ARROW_VISUAL_WIDTH_PX;
	return {
		toggleVisualLeft,
		toggleVisualRight,
		arrowCenterX: (toggleVisualLeft + toggleVisualRight) / 2,
	};
}

function isCollapsibleHeadingToggleHit(element: HTMLElement, event: MouseEvent): boolean {
	const rect = element.getBoundingClientRect();
	if (event.clientY < rect.top || event.clientY > rect.bottom) return false;
	const geometry = getCollapsibleHeadingToggleGeometry(element);
	const coarse = isCoarsePointerInteraction();
	const caretZoneEnd = geometry.toggleVisualLeft;
	if (event.clientX < caretZoneEnd) {
		return false;
	}
	const hitboxPx = getCollapsibleHeadingToggleHitboxPx();
	const outerSlopPx = coarse ? 10 : 3;
	let hitLeft = geometry.arrowCenterX - hitboxPx / 2;
	let hitRight = geometry.arrowCenterX + hitboxPx / 2;
	if (hitLeft < caretZoneEnd) {
		const shift = caretZoneEnd - hitLeft;
		hitLeft += shift;
		hitRight += shift;
	}
	hitRight = Math.max(hitRight, geometry.toggleVisualRight) + outerSlopPx;
	return event.clientX >= hitLeft && event.clientX <= hitRight;
}

function suppressCoarsePointerEditorFocus(view: EditorView): void {
	if (!isCoarsePointerInteraction()) return;
	const root = view.dom as HTMLElement | null;
	const active = document.activeElement;
	if (active instanceof HTMLElement && (active === root || root?.contains(active))) {
		active.blur();
	}
}

function findCollapsedHeadingOwnerForSelection(
	doc: ProseMirrorNode,
	noteId: string,
	selectionPos: number,
): { pos: number; node: ProseMirrorNode } | null {
	const collapsedStack: Array<{ pos: number; node: ProseMirrorNode; level: number; collapseId: string }> = [];
	const { blocks, positions } = getTopLevelBlocks(doc);
	for (let index = 0; index < blocks.length; index += 1) {
		const node = blocks[index];
		const pos = positions[index];
		const meta = getCollapsibleHeadingMeta(node);
		if (meta.collapsible && meta.level != null) {
			while (collapsedStack.length > 0 && meta.level <= collapsedStack[collapsedStack.length - 1].level) {
				collapsedStack.pop();
			}
		}
		const blockStart = pos;
		const blockEnd = pos + node.nodeSize;
		if (collapsedStack.length > 0 && selectionPos >= blockStart && selectionPos <= blockEnd) {
			const owner = collapsedStack[collapsedStack.length - 1];
			const visibleExitStart = visibleCollapsedHeadingExitStarts.get(makeCollapsibleHeadingUiKey(noteId, owner.collapseId));
			if (typeof visibleExitStart === 'number' && selectionPos >= visibleExitStart) {
				return null;
			}
			return { pos: owner.pos, node: owner.node };
		}
		if (meta.level != null && meta.collapsible && meta.collapseId && getRichHeadingCollapsed(noteId, meta.collapseId)) {
			collapsedStack.push({ pos, node, level: meta.level, collapseId: meta.collapseId });
		}
	}
	return null;
}

function getScrollContainer(node: HTMLElement | null): HTMLElement | null {
	let current = node?.parentElement ?? null;
	while (current) {
		const style = window.getComputedStyle(current);
		const overflowY = style.overflowY;
		const isScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && current.scrollHeight > current.clientHeight;
		if (isScrollable) return current;
		current = current.parentElement;
	}
	return null;
}

function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function preserveHeadingViewportPosition(view: EditorView, headingPos: number, callback: () => void): void {
	const headingElement = view.nodeDOM(headingPos);
	const beforeRect = headingElement instanceof HTMLElement ? headingElement.getBoundingClientRect() : null;
	const scrollContainer = view.dom instanceof HTMLElement ? getScrollContainer(view.dom) : null;
	const pageScrollTop = typeof window === 'undefined' ? 0 : window.scrollY;
	callback();
	const updatedHeadingElement = view.nodeDOM(headingPos);
	const afterRect = updatedHeadingElement instanceof HTMLElement ? updatedHeadingElement.getBoundingClientRect() : null;
	if (!beforeRect || !afterRect) return;
	const delta = afterRect.top - beforeRect.top;
	if (Math.abs(delta) < 0.5) return;
	if (scrollContainer) {
		scrollContainer.scrollTop += delta;
		return;
	}
	if (typeof window !== 'undefined') {
		window.scrollTo({ top: pageScrollTop + delta, left: window.scrollX, behavior: 'auto' });
	}
}

function selectionIntersectsCollapsedRange(state: Editor['state'], startPos: number, endPos: number): boolean {
	if (endPos <= startPos) return false;
	return state.selection.from < endPos && state.selection.to > startPos;
}

function collectHeadingSectionElements(view: EditorView, blockPositions: readonly number[]): Array<{ element: HTMLElement; pos: number }> {
	const elements: Array<{ element: HTMLElement; pos: number }> = [];
	for (const pos of blockPositions) {
		const domNode = view.nodeDOM(pos);
		if (domNode instanceof HTMLElement) {
			elements.push({ element: domNode, pos });
		}
	}
	return elements;
}

function shouldAnimateHeadingSection(elements: readonly { element: HTMLElement; pos: number }[]): boolean {
	if (prefersReducedMotion() || elements.length === 0 || elements.length > COLLAPSIBLE_HEADING_MAX_ANIMATED_BLOCKS) {
		return false;
	}
	let totalHeight = 0;
	for (const { element } of elements) {
		totalHeight += element.offsetHeight;
		if (totalHeight > COLLAPSIBLE_HEADING_MAX_ANIMATED_HEIGHT) return false;
	}
	return totalHeight > 0;
}

type AnimatedBlockSnapshot = {
	pos: number;
	element: HTMLElement;
	previousStyle: string | null;
	height: number;
	rect: DOMRect;
	marginTop: string;
	marginBottom: string;
	paddingTop: string;
	paddingBottom: string;
};

type SectionBlockMetric = {
	top: number;
	height: number;
	paddingTop: string;
	paddingBottom: string;
};

type SectionCollapseMetrics = {
	totalHeight: number;
	contentStartPos: number;
	firstBlockPos: number;
	blockPositions: number[];
	blocks: Map<number, SectionBlockMetric>;
};

type SectionCollapsePhase = 'collapse-fade' | 'expand-fade';

type SectionCollapseAnimationState = SectionCollapseMetrics & {
	direction: 'collapse' | 'expand';
	phase: SectionCollapsePhase;
};

function captureAnimatedBlockSnapshots(elements: readonly { element: HTMLElement; pos: number }[]): AnimatedBlockSnapshot[] {
	return elements
		.map(({ element, pos }) => {
			const computedStyle = window.getComputedStyle(element);
			return {
				pos,
				element,
				previousStyle: element.getAttribute('style'),
				height: element.offsetHeight,
				rect: element.getBoundingClientRect(),
				marginTop: computedStyle.marginTop,
				marginBottom: computedStyle.marginBottom,
				paddingTop: computedStyle.paddingTop,
				paddingBottom: computedStyle.paddingBottom,
			};
		})
		.filter((snapshot) => snapshot.height > 0);
}

function measureSectionCollapseLayout(
	editorElement: HTMLElement,
	snapshots: readonly AnimatedBlockSnapshot[],
	contentStartPos: number,
	blockPositions: readonly number[],
): SectionCollapseMetrics {
	if (snapshots.length === 0) {
		return {
			totalHeight: 0,
			contentStartPos,
			firstBlockPos: blockPositions[0] ?? contentStartPos,
			blockPositions: [...blockPositions],
			blocks: new Map(),
		};
	}
	const editorRect = editorElement.getBoundingClientRect();
	const editorScrollTop = editorElement.scrollTop;
	const blocks = new Map<number, SectionBlockMetric>();
	let sectionTop = Number.POSITIVE_INFINITY;
	let sectionBottom = Number.NEGATIVE_INFINITY;
	for (const snapshot of snapshots) {
		sectionTop = Math.min(sectionTop, snapshot.rect.top);
		sectionBottom = Math.max(sectionBottom, snapshot.rect.bottom);
		blocks.set(snapshot.pos, {
			top: snapshot.rect.top - editorRect.top + editorScrollTop,
			height: snapshot.height,
			paddingTop: snapshot.paddingTop,
			paddingBottom: snapshot.paddingBottom,
		});
	}
	return {
		totalHeight: Math.max(0, sectionBottom - sectionTop),
		contentStartPos,
		firstBlockPos: snapshots[0].pos,
		blockPositions: [...blockPositions],
		blocks,
	};
}

function refreshCollapsibleHeadingDecorations(view: EditorView): void {
	if (view.isDestroyed) return;
	view.dispatch(view.state.tr.setMeta(COLLAPSIBLE_HEADING_REFRESH_META, true));
}

function getSectionAnimationForBlock(noteId: string, pos: number): SectionCollapseAnimationState | null {
	const prefix = `${noteId}::`;
	for (const [animationKey, animationState] of activeSectionCollapseAnimations) {
		if (!animationKey.startsWith(prefix)) continue;
		if (animationState.blocks.has(pos) || animationState.blockPositions.includes(pos)) {
			return animationState;
		}
	}
	return null;
}

function clearSectionAnimationTimeouts(animationKey: string): void {
	const existingTimeout = activeSectionCollapseAnimationTimeouts.get(animationKey);
	if (existingTimeout != null) {
		window.clearTimeout(existingTimeout);
		activeSectionCollapseAnimationTimeouts.delete(animationKey);
	}
}

function scheduleSectionAnimationTimeout(animationKey: string, callback: () => void, delayMs: number): void {
	clearSectionAnimationTimeouts(animationKey);
	activeSectionCollapseAnimationTimeouts.set(animationKey, window.setTimeout(callback, delayMs));
}

function finishSectionCollapseAnimation(
	view: EditorView,
	noteId: string,
	animationKey: string,
	collapsed: boolean,
	reason: string,
): void {
	activeSectionCollapseAnimations.delete(animationKey);
	clearSectionAnimationTimeouts(animationKey);
	activeCollapsibleHeadingAnimations.delete(animationKey);
	endHeadingCollapseDebugSession({
		noteContainerHeightAfter: measureNoteContainerHeight(view.dom),
		reason,
	});
	refreshCollapsibleHeadingDecorations(view);
	dispatchCollapsibleHeadingAnimationRefresh(noteId, collapsed);
}

function formatSectionBlockStyle(): string {
	return `--collapsible-heading-fade-ms:${COLLAPSIBLE_HEADING_FADE_MS}ms;`;
}

function toggleCollapsibleHeadingSection(
	view: EditorView,
	noteId: string,
	headingPos: number,
	headingNode: ProseMirrorNode,
	headingLevel: number,
	headingIndex: number,
	blocks: readonly ProseMirrorNode[],
	positions: readonly number[],
	collapseId: string,
	isCollapsed: boolean,
): void {
	const animationKey = `${noteId}::${collapseId}`;
	const uiKey = makeCollapsibleHeadingUiKey(noteId, collapseId);
	visibleCollapsedHeadingExitStarts.delete(uiKey);
	activeCollapsedHeadingWritingLabels.delete(uiKey);
	if (activeCollapsibleHeadingAnimations.has(animationKey)) return;
	const section = getHeadingSectionRange(view.state.doc, blocks, positions, headingIndex, headingNode, headingLevel);
	const headingEndPos = Math.max(headingPos + 1, headingPos + headingNode.nodeSize - 1);
	const applyCollapsedState = (nextCollapsed: boolean): void => {
		preserveHeadingViewportPosition(view, headingPos, () => {
			saveRichHeadingCollapsed(getDeviceId(), noteId, collapseId, nextCollapsed);
		});
	};
	if (!isCollapsed && selectionIntersectsCollapsedRange(view.state, section.contentStartPos, section.contentEndPos)) {
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, headingEndPos)));
	}
	if (isCollapsed) {
		const storedMetrics = lastSectionCollapseMetrics.get(animationKey);
		if (!storedMetrics || storedMetrics.totalHeight <= 0 || storedMetrics.blocks.size === 0 || prefersReducedMotion()) {
			applyCollapsedState(false);
			refreshCollapsibleHeadingDecorations(view);
			dispatchCollapsibleHeadingAnimationRefresh(noteId, false);
			return;
		}
		if (isHeadingCollapseDebugEnabled()) {
			beginHeadingCollapseDebugSession({
				noteId,
				collapseId,
				direction: 'expand',
				blockCount: storedMetrics.blocks.size,
				hasFollowingHeading: hasFollowingTopLevelBlocks(blocks, headingIndex, headingLevel),
				noteContainerHeightBefore: measureNoteContainerHeight(view.dom),
			});
		}
		activeSectionCollapseAnimations.set(animationKey, {
			...storedMetrics,
			direction: 'expand',
			phase: 'expand-fade',
		});
		clearSectionAnimationTimeouts(animationKey);
		// Mark animation active before pref notify so duplicate decoration refreshes
		// are suppressed; defer the decoration refresh one frame so expand fade runs
		// after display:none is cleared (see memory/collapsible-rich-headings.md).
		activeCollapsibleHeadingAnimations.add(animationKey);
		applyCollapsedState(false);
		requestAnimationFrame(() => {
			if (view.isDestroyed) return;
			refreshCollapsibleHeadingDecorations(view);
		});
		scheduleSectionAnimationTimeout(animationKey, () => {
			finishSectionCollapseAnimation(view, noteId, animationKey, false, 'expand-animation-complete');
		}, COLLAPSIBLE_HEADING_FADE_MS + COLLAPSIBLE_HEADING_PHASE_BUFFER_MS);
		return;
	}
	const visibleElements = collectHeadingSectionElements(view, section.blockPositions);
	if (!shouldAnimateHeadingSection(visibleElements)) {
		if (isHeadingCollapseDebugEnabled()) {
			beginHeadingCollapseDebugSession({
				noteId,
				collapseId,
				direction: 'collapse',
				blockCount: visibleElements.length,
				hasFollowingHeading: hasFollowingTopLevelBlocks(blocks, headingIndex, headingLevel),
				noteContainerHeightBefore: measureNoteContainerHeight(view.dom),
			});
			applyCollapsedState(true);
			endHeadingCollapseDebugSession({
				noteContainerHeightAfter: measureNoteContainerHeight(view.dom),
				reason: 'instant-no-animation',
			});
		} else {
			applyCollapsedState(true);
		}
		refreshCollapsibleHeadingDecorations(view);
		dispatchCollapsibleHeadingAnimationRefresh(noteId, true);
		return;
	}
	const collapseSnapshots = captureAnimatedBlockSnapshots(visibleElements);
	if (isHeadingCollapseDebugEnabled()) {
		beginHeadingCollapseDebugSession({
			noteId,
			collapseId,
			direction: 'collapse',
			blockCount: collapseSnapshots.length,
			hasFollowingHeading: hasFollowingTopLevelBlocks(blocks, headingIndex, headingLevel),
			noteContainerHeightBefore: measureNoteContainerHeight(view.dom),
		});
	}
	const sectionMetrics = measureSectionCollapseLayout(
		view.dom as HTMLElement,
		collapseSnapshots,
		section.contentStartPos,
		section.blockPositions,
	);
	lastSectionCollapseMetrics.set(animationKey, sectionMetrics);
	activeSectionCollapseAnimations.set(animationKey, {
		...sectionMetrics,
		direction: 'collapse',
		phase: 'collapse-fade',
	});
	clearSectionAnimationTimeouts(animationKey);
	activeCollapsibleHeadingAnimations.add(animationKey);
	applyCollapsedState(true);
	refreshCollapsibleHeadingDecorations(view);
	scheduleSectionAnimationTimeout(animationKey, () => {
		finishSectionCollapseAnimation(view, noteId, animationKey, true, 'collapse-animation-complete');
	}, COLLAPSIBLE_HEADING_FADE_MS + COLLAPSIBLE_HEADING_PHASE_BUFFER_MS);
}

function buildCollapsibleHeadingDecorations(doc: ProseMirrorNode, noteId: string): DecorationSet {
	const { blocks, positions } = getTopLevelBlocks(doc);
	const decorations: Decoration[] = [];
	const layout = buildCollapsibleHeadingLayout(blocks, (collapseId) => getRichHeadingCollapsed(noteId, collapseId));
	let activeCollapsedOwnerId: string | null = null;

	layout.forEach((item, index) => {
		const node = item.block;
		const pos = positions[index];
		if (!item.hidden) {
			activeCollapsedOwnerId = item.collapsed && item.collapseId ? item.collapseId : null;
		}
		// Nested hide/collapsible heading chrome wins over parent section fade animations.
		if (item.hidden) {
			const visibleExitStart = activeCollapsedOwnerId ? visibleCollapsedHeadingExitStarts.get(makeCollapsibleHeadingUiKey(noteId, activeCollapsedOwnerId)) : undefined;
			if (typeof visibleExitStart === 'number' && pos >= visibleExitStart) {
				return;
			}
			decorations.push(Decoration.node(pos, pos + node.nodeSize, {
				class: 'fn-collapsible-heading-hidden',
				style: 'display:none;',
			}));
			return;
		}
		if (item.collapsible && item.collapseId && item.headingLevel != null) {
			const collapsedContentSummary = item.collapsed && activeCollapsedHeadingWritingLabels.has(makeCollapsibleHeadingUiKey(noteId, item.collapseId))
				? 'Writing...'
				: '';
			decorations.push(Decoration.node(pos, pos + node.nodeSize, {
				class: item.collapsed ? 'fn-collapsible-heading is-collapsed' : 'fn-collapsible-heading',
				'data-collapsible-heading': 'true',
				'data-collapsible-heading-id': item.collapseId,
				'data-collapsible-heading-collapsed': item.collapsed ? 'true' : 'false',
				'data-collapsible-heading-summary': collapsedContentSummary,
			}));
			return;
		}
		const sectionAnimation = getSectionAnimationForBlock(noteId, pos);
		if (sectionAnimation) {
			if (sectionAnimation.phase === 'collapse-fade') {
				decorations.push(Decoration.node(pos, pos + node.nodeSize, {
					class: 'fn-collapsible-heading-section-block-fade-out',
					style: formatSectionBlockStyle(),
				}));
				return;
			}
			if (sectionAnimation.phase === 'expand-fade') {
				decorations.push(Decoration.node(pos, pos + node.nodeSize, {
					class: 'fn-collapsible-heading-section-block-fade-in',
					style: formatSectionBlockStyle(),
				}));
				return;
			}
		}
	});

	return DecorationSet.create(doc, decorations);
}

function createCollapsibleHeadingDecorationPlugin(noteId: string): Plugin {
	const pluginKey = new PluginKey<DecorationSet>('freemannotes-collapsible-headings');
	let hoveredHeadingElement: HTMLElement | null = null;
	return new Plugin({
		key: pluginKey,
		appendTransaction: (transactions, _oldState, newState) => {
			if (transactions.some((tr) => tr.getMeta(COLLAPSIBLE_HEADING_SELECTION_REPAIR_META))) {
				return null;
			}
			if (!transactions.some((tr) => tr.selectionSet || tr.docChanged)) return null;
			const hiddenOwner = findCollapsedHeadingOwnerForSelection(newState.doc, noteId, newState.selection.from);
			if (!hiddenOwner) return null;
			const repairPos = Math.max(hiddenOwner.pos + 1, hiddenOwner.pos + hiddenOwner.node.nodeSize - 1);
			if (newState.selection.from === repairPos && newState.selection.to === repairPos) return null;
			return newState.tr
				.setMeta(COLLAPSIBLE_HEADING_SELECTION_REPAIR_META, true)
				.setSelection(TextSelection.create(newState.doc, repairPos));
		},
		state: {
			init: (_config, state) => buildCollapsibleHeadingDecorations(state.doc, noteId),
			apply: (tr, value, _oldState, newState) => {
				if (tr.docChanged || tr.selectionSet || tr.getMeta(pluginKey) || tr.getMeta(COLLAPSIBLE_HEADING_REFRESH_META)) {
					return buildCollapsibleHeadingDecorations(newState.doc, noteId);
				}
				return value;
			},
		},
		view: (view) => {
			const refreshDecorations = (): void => {
				if (view.isDestroyed) return;
				recordHeadingCollapseDebug('decorationRefresh', { noteId });
				view.dispatch(view.state.tr.setMeta(COLLAPSIBLE_HEADING_REFRESH_META, true));
			};
			const clearHoveredHeading = (): void => {
				if (!hoveredHeadingElement) return;
				setCollapsibleHeadingToggleHover(hoveredHeadingElement, false);
				hoveredHeadingElement = null;
			};
			const handlePointerHover = (event: MouseEvent): void => {
				const headingElement = findCollapsibleHeadingElement(event.target);
				const isHoveringToggle = headingElement ? isCollapsibleHeadingToggleHit(headingElement, event) : false;
				if (hoveredHeadingElement && hoveredHeadingElement !== headingElement) {
					setCollapsibleHeadingToggleHover(hoveredHeadingElement, false);
				}
				if (headingElement && isHoveringToggle) {
					setCollapsibleHeadingToggleHover(headingElement, true);
					hoveredHeadingElement = headingElement;
					return;
				}
				clearHoveredHeading();
			};
			const unsubscribe = subscribeCollapsedRichHeadingPrefs(() => {
				if (noteHasActiveCollapsibleHeadingAnimation(noteId)) return;
				recordHeadingCollapseDebug('prefNotify', { noteId });
				refreshDecorations();
			});
			const handleHeadingToggle = (event: Event): void => {
				const detail = event instanceof CustomEvent ? event.detail as { noteId?: unknown; collapsed?: unknown } | null : null;
				if (detail && typeof detail.noteId === 'string' && detail.noteId !== noteId) return;
				if (noteHasActiveCollapsibleHeadingAnimation(noteId)) return;
				recordHeadingCollapseDebug('richHeadingToggleEvent', { noteId, collapsed: detail?.collapsed });
				refreshDecorations();
			};
			const handleAnimationRefresh = (event: Event): void => {
				const detail = event instanceof CustomEvent ? event.detail as { noteId?: unknown } | null : null;
				if (detail && typeof detail.noteId === 'string' && detail.noteId !== noteId) return;
				recordHeadingCollapseDebug('animationRefreshEvent', { noteId });
				refreshDecorations();
			};
			window.addEventListener('freemannotes:rich-heading-toggle', handleHeadingToggle as EventListener);
			window.addEventListener(COLLAPSIBLE_HEADING_ANIMATION_REFRESH_EVENT, handleAnimationRefresh as EventListener);
			view.dom.addEventListener('mousemove', handlePointerHover);
			view.dom.addEventListener('mouseleave', clearHoveredHeading);
			return {
				destroy() {
					view.dom.removeEventListener('mousemove', handlePointerHover);
					view.dom.removeEventListener('mouseleave', clearHoveredHeading);
					clearHoveredHeading();
					unsubscribe();
					window.removeEventListener('freemannotes:rich-heading-toggle', handleHeadingToggle as EventListener);
					window.removeEventListener(COLLAPSIBLE_HEADING_ANIMATION_REFRESH_EVENT, handleAnimationRefresh as EventListener);
				},
			};
		},
		props: {
			handleDOMEvents: {
				mousemove(_view, event) {
					if (!(event instanceof MouseEvent)) return false;
					const headingElement = findCollapsibleHeadingElement(event.target);
					const isHoveringToggle = headingElement ? isCollapsibleHeadingToggleHit(headingElement, event) : false;
					if (hoveredHeadingElement && hoveredHeadingElement !== headingElement) {
						setCollapsibleHeadingToggleHover(hoveredHeadingElement, false);
					}
					if (headingElement) {
						setCollapsibleHeadingToggleHover(headingElement, isHoveringToggle);
						hoveredHeadingElement = isHoveringToggle ? headingElement : null;
					} else if (hoveredHeadingElement) {
						setCollapsibleHeadingToggleHover(hoveredHeadingElement, false);
						hoveredHeadingElement = null;
					}
					return false;
				},
				mouseleave() {
					if (hoveredHeadingElement) {
						setCollapsibleHeadingToggleHover(hoveredHeadingElement, false);
						hoveredHeadingElement = null;
					}
					return false;
				},
				pointerdown(view, event) {
					if (!(event instanceof PointerEvent) || event.pointerType !== 'touch') return false;
					const headingElement = findCollapsibleHeadingElement(event.target);
					if (!headingElement || !isCollapsibleHeadingToggleHit(headingElement, event)) return false;
					suppressCoarsePointerEditorFocus(view);
					event.preventDefault();
					event.stopPropagation();
					return true;
				},
				mousedown(view, event) {
					if (!(event instanceof MouseEvent) || event.button !== 0) return false;
					const headingElement = findCollapsibleHeadingElement(event.target);
					if (!headingElement || !isCollapsibleHeadingToggleHit(headingElement, event)) return false;
					suppressCoarsePointerEditorFocus(view);
					event.preventDefault();
					event.stopPropagation();
					return true;
				},
				touchstart(view, event) {
					const touch = event.touches[0];
					if (!touch) return false;
					const headingElement = findCollapsibleHeadingElement(touch.target);
					if (!headingElement) return false;
					const syntheticMouseEvent = {
						clientX: touch.clientX,
						clientY: touch.clientY,
					} as MouseEvent;
					if (!isCollapsibleHeadingToggleHit(headingElement, syntheticMouseEvent)) return false;
					suppressCoarsePointerEditorFocus(view);
					if (event.cancelable) event.preventDefault();
					event.stopPropagation();
					return true;
				},
				click(view, event) {
					if (!(event instanceof MouseEvent) || event.button !== 0) return false;
					const headingElement = findCollapsibleHeadingElement(event.target);
					if (!headingElement || !isCollapsibleHeadingToggleHit(headingElement, event)) return false;
					suppressCoarsePointerEditorFocus(view);
					event.preventDefault();
					event.stopPropagation();
					if (event.detail !== 1) return true;
					const heading = findCollapsibleHeadingFromToggleElement(view, noteId, headingElement);
					if (!heading) return false;
					const { blocks, positions } = getTopLevelBlocks(view.state.doc);
					toggleCollapsibleHeadingSection(
						view,
						noteId,
						heading.pos,
						heading.node,
						heading.level,
						heading.index,
						blocks,
						positions,
						heading.collapseId,
						heading.collapsed,
					);
					return true;
				},
			},
			handleKeyDown(view, event) {
				if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
					return false;
				}
				const enterContext = findCollapsedHeadingEnterContext(view.state, noteId);
				if (!enterContext) {
					return false;
				}
				const { heading, meta, blocks, positions, headingIndex } = enterContext;
				const section = getHeadingSectionRange(view.state.doc, blocks, positions, headingIndex, heading.node, meta.level);
				const paragraph = view.state.schema.nodes.paragraph?.createAndFill();
				if (!paragraph) return true;
				event.preventDefault();
				const uiKey = makeCollapsibleHeadingUiKey(noteId, meta.collapseId);
				visibleCollapsedHeadingExitStarts.set(uiKey, section.contentEndPos);
				activeCollapsedHeadingWritingLabels.add(uiKey);
				let tr = view.state.tr.insert(section.contentEndPos, paragraph);
				tr = tr.setMeta(COLLAPSIBLE_HEADING_REFRESH_META, true);
				tr = tr.setSelection(TextSelection.create(tr.doc, section.contentEndPos + 1));
				view.dispatch(tr);
				return true;
			},
			decorations(state) {
				return pluginKey.getState(state) ?? null;
			},
		},
	});
}

function isEmptyCollapsedHeadingWritingBlock(node: ProseMirrorNode): boolean {
	return node.textContent.trim().length === 0;
}

/** Clears transient "Writing..." labels and prunes empty draft blocks when a note editor closes. */
export function finalizeCollapsedHeadingWritingForNote(noteId: string, editor?: Editor | null): void {
	const prefix = `${noteId}::`;
	for (const key of [...activeCollapsedHeadingWritingLabels]) {
		if (key.startsWith(prefix)) activeCollapsedHeadingWritingLabels.delete(key);
	}
	if (!editor || editor.isDestroyed) {
		return;
	}
	const keysToFinalize = [...visibleCollapsedHeadingExitStarts.keys()].filter((key) => key.startsWith(prefix));
	if (keysToFinalize.length === 0) return;
	let tr = editor.state.tr;
	let changed = false;
	for (const key of keysToFinalize) {
		const collapseId = key.slice(prefix.length);
		const heading = findCollapsibleHeadingById(tr.doc, noteId, collapseId);
		if (!heading) {
			visibleCollapsedHeadingExitStarts.delete(key);
			continue;
		}
		const { blocks, positions } = getTopLevelBlocks(tr.doc);
		const section = getHeadingSectionRange(tr.doc, blocks, positions, heading.index, heading.node, heading.level);
		const exitStart = visibleCollapsedHeadingExitStarts.get(key);
		if (typeof exitStart !== 'number') {
			visibleCollapsedHeadingExitStarts.delete(key);
			continue;
		}
		const tailPositions = section.blockPositions.filter((pos) => pos >= exitStart);
		if (tailPositions.length === 0) {
			visibleCollapsedHeadingExitStarts.delete(key);
			continue;
		}
		const allTailEmpty = tailPositions.every((pos) => {
			const node = tr.doc.nodeAt(pos);
			return node != null && isEmptyCollapsedHeadingWritingBlock(node);
		});
		if (!allTailEmpty) continue;
		for (const pos of [...tailPositions].sort((left, right) => right - left)) {
			const node = tr.doc.nodeAt(pos);
			if (!node) continue;
			tr = tr.delete(pos, pos + node.nodeSize);
			changed = true;
		}
		visibleCollapsedHeadingExitStarts.delete(key);
	}
	if (!changed) return;
	editor.view.dispatch(tr.setMeta(COLLAPSIBLE_HEADING_REFRESH_META, true));
}

const CollapsibleHeading = Heading.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			collapsible: {
				default: false,
				parseHTML: (element: Element) => element.getAttribute('data-collapsible') === 'true',
				renderHTML: (attrs: Record<string, unknown>) => attrs.collapsible ? { 'data-collapsible': 'true' } : {},
			},
			collapseId: {
				default: null as string | null,
				parseHTML: (element: Element) => element.getAttribute('data-collapse-id') || null,
				renderHTML: (attrs: Record<string, unknown>) =>
					typeof attrs.collapseId === 'string' && attrs.collapseId
						? { 'data-collapse-id': attrs.collapseId }
						: {},
			},
		};
	},

	addCommands() {
		return {
			...this.parent?.(),
			setHeading: (attributes: Record<string, unknown>) => ({ commands, state }) => {
				const activeHeading = findActiveHeading(state);
				return commands.setNode(this.name, activeHeading ? { ...activeHeading.node.attrs, ...attributes } : attributes);
			},
			toggleHeading: (attributes: Record<string, unknown>) => ({ commands, state }) => {
				const activeHeading = findActiveHeading(state);
				return commands.toggleNode(this.name, 'paragraph', activeHeading ? { ...activeHeading.node.attrs, ...attributes } : attributes);
			},
			toggleHeadingCollapsible: () => ({ state, dispatch }) => {
				const activeHeading = findActiveHeading(state);
				if (!activeHeading) return false;
				const meta = getCollapsibleHeadingMeta(activeHeading.node);
				if (meta.level == null || meta.level > 5) return false;
				const nextCollapsible = !Boolean(activeHeading.node.attrs.collapsible);
				const nextAttrs = {
					...activeHeading.node.attrs,
					collapsible: nextCollapsible,
					collapseId: nextCollapsible
						? (typeof activeHeading.node.attrs.collapseId === 'string' && activeHeading.node.attrs.collapseId
							? activeHeading.node.attrs.collapseId
							: createCollapsibleHeadingId())
						: activeHeading.node.attrs.collapseId ?? null,
				};
				if (!dispatch) return true;
				dispatch(state.tr.setNodeMarkup(activeHeading.pos, undefined, nextAttrs));
				return true;
			},
		};
	},

	addProseMirrorPlugins() {
		const noteId = typeof this.options.noteId === 'string' && this.options.noteId ? this.options.noteId : null;
		const plugins = [...(this.parent?.() ?? [])];
		plugins.push(new Plugin({
			appendTransaction: (transactions, _oldState, newState) => {
				if (!transactions.some((tr) => tr.docChanged) || transactions.some((tr) => tr.getMeta(COLLAPSIBLE_HEADING_ID_REPAIR_META))) {
					return null;
				}
				const seen = new Set<string>();
				let nextTr = newState.tr.setMeta(COLLAPSIBLE_HEADING_ID_REPAIR_META, true);
				let changed = false;
				newState.doc.descendants((node, pos) => {
					const meta = getCollapsibleHeadingMeta(node);
					if (
						node.type.name === 'heading' &&
						Boolean(node.attrs.collapsible) &&
						node.textContent.trim().length === 0
					) {
						nextTr = nextTr.setNodeMarkup(pos, undefined, {
							...node.attrs,
							collapsible: false,
							collapseId: null,
						});
						changed = true;
						return false;
					}
					if (!meta.collapsible || meta.level == null || meta.level > 5) return false;
					let nextCollapseId = meta.collapseId;
					if (!nextCollapseId || seen.has(nextCollapseId)) {
						nextCollapseId = createCollapsibleHeadingId();
						nextTr = nextTr.setNodeMarkup(pos, undefined, { ...node.attrs, collapseId: nextCollapseId });
						changed = true;
					}
					seen.add(nextCollapseId);
					return false;
				});
				return changed ? nextTr : null;
			},
		}));
		if (noteId) {
			plugins.push(createCollapsibleHeadingDecorationPlugin(noteId));
		}
		return plugins;
	},
});

const MobileSafeTaskItem = TaskItem.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			// Stable per-item UUID written as data-unique-id on the <li>.
			// Each new node created by the CRDT regeneration plugin below gets
			// a fresh UUID, which gives it a distinct Yjs element identity.
			uniqueId: {
				default: null as string | null,
				parseHTML: (el: Element) => el.getAttribute('data-unique-id') || null,
				renderHTML: (attrs: Record<string, unknown>) =>
					attrs.uniqueId ? { 'data-unique-id': attrs.uniqueId } : {},
			},
		};
	},

	addProseMirrorPlugins() {
		return [
			...(this.parent?.() ?? []),
			new Plugin({
				/**
				 * CRDT text-concatenation guard for concurrent checklist item replacement.
				 *
				 * Problem: when two users are both offline and each deletes + retypes the
				 * entire content of the same task item, Yjs CRDT merges their edits at
				 * the character level inside the shared Y.Text node, producing a
				 * concatenated result (e.g. "breadCream").
				 *
				 * Fix: convert a "full-content replacement" into a node-level replacement.
				 * The old Y.XmlElement is tombstoned and a fresh Y.XmlElement is
				 * inserted.  On CRDT merge, each user's new element has a distinct Yjs
				 * identity (different clock) so they coexist as two separate items
				 * instead of one concatenated item.
				 *
				 * Detection: any ProseMirror ReplaceStep whose range covers the full text
				 * span of a task item's own paragraph (direct text only, not nested
				 * sub-items) is treated as a full-content replacement and triggers node
				 * regeneration.  This covers select-all-then-type, paste-over-selection,
				 * and the final backspace that empties the item.
				 */
				appendTransaction(transactions, _oldState, newState) {
					// Collect items to regenerate; apply last→first to keep positions valid.
					const toRegenerate: Array<{ pos: number; node: ProseMirrorNode }> = [];

					for (const tr of transactions) {
						if (!tr.docChanged || tr.getMeta(TASK_ITEM_REGEN_META)) continue;

						tr.before.descendants((node, pos) => {
							if (node.type.name !== 'taskItem') return false;

							// Only examine the item's own paragraph (first child), not any
							// nested task list children.
							const para = node.firstChild;
							if (!para || para.type.name !== 'paragraph') return false;
							const oldText = para.textContent;
							if (!oldText) return false; // already empty — nothing to protect

							// Absolute text span in the pre-transaction document:
							//   taskItem node opens at `pos` (cursor position before node)
							//   paragraph opens at pos+1 (first token inside taskItem)
							//   text starts at pos+2 (first token inside paragraph)
							const textStart = pos + 2;
							const textEnd = textStart + oldText.length;

							// A step that covers the entire text span is a full replacement.
							let isFullReplacement = false;
							for (const step of tr.steps) {
								if (
									step instanceof ReplaceStep &&
									(step as ReplaceStep).from <= textStart &&
									(step as ReplaceStep).to >= textEnd
								) {
									isFullReplacement = true;
									break;
								}
							}
							if (!isFullReplacement) return false;

							// Map the item position into the post-transaction document.
							const mapped = tr.mapping.mapResult(pos);
							if (mapped.deleted) return false;
							const newItem = newState.doc.nodeAt(mapped.pos);
							if (!newItem || newItem.type.name !== 'taskItem') return false;

							toRegenerate.push({ pos: mapped.pos, node: newItem });
							return false; // don't descend into this item's children
						});
					}

					if (toRegenerate.length === 0) return null;

					// Sort descending so each replaceWith doesn't shift subsequent positions.
					toRegenerate.sort((a, b) => b.pos - a.pos);
					const regenTr = newState.tr.setMeta(TASK_ITEM_REGEN_META, true);
					for (const { pos, node } of toRegenerate) {
						// Create a structurally identical node with a fresh UUID.
						// At the Yjs layer this becomes: delete old Y.XmlElement (tombstone)
						// + insert new Y.XmlElement (distinct clock). Concurrent replacements
						// by other users produce nodes with different clocks and therefore
						// coexist as separate items after CRDT merge.
						const freshNode = node.type.create(
							{ ...node.attrs, uniqueId: crypto.randomUUID() },
							node.content,
						);
						regenTr.replaceWith(pos, pos + node.nodeSize, freshNode);
					}
					return regenTr;
				},
			}),
		];
	},

	addNodeView() {
		return ({ node, HTMLAttributes, getPos, editor }) => {
			const listItem = document.createElement('li');
			const checkboxWrapper = document.createElement('label');
			const checkboxStyler = document.createElement('span');
			const checkbox = document.createElement('input');
			const content = document.createElement('div');

			const updateA11y = (currentNode: ProseMirrorNode) => {
				checkbox.ariaLabel =
					this.options.a11y?.checkboxLabel?.(currentNode, checkbox.checked) ||
					`Task item checkbox for ${currentNode.textContent || 'empty task item'}`;
			};

			const syncCheckedState = (checked: boolean) => {
				listItem.dataset.checked = String(checked);
				checkbox.checked = checked;
			};

			updateA11y(node);

			checkboxWrapper.contentEditable = 'false';
			checkbox.type = 'checkbox';
			checkbox.addEventListener('mousedown', (event) => event.preventDefault());
			checkbox.addEventListener('change', (event) => {
				if (!editor.isEditable && !this.options.onReadOnlyChecked) {
					checkbox.checked = !checkbox.checked;
					return;
				}

				const { checked } = event.target as HTMLInputElement;

				if (editor.isEditable && typeof getPos === 'function') {
					const position = getPos();
					if (typeof position !== 'number') {
						syncCheckedState(node.attrs.checked);
						return;
					}

					const transaction = editor.state.tr;
					const currentNode = transaction.doc.nodeAt(position);
					if (!currentNode) {
						syncCheckedState(node.attrs.checked);
						return;
					}

					transaction.setNodeMarkup(position, undefined, {
						...currentNode.attrs,
						checked,
					});
					editor.view.dispatch(transaction);
				}

				if (!editor.isEditable && this.options.onReadOnlyChecked) {
					if (!this.options.onReadOnlyChecked(node, checked)) {
						checkbox.checked = !checkbox.checked;
					}
				}
			});

			Object.entries(this.options.HTMLAttributes).forEach(([key, value]) => {
				listItem.setAttribute(key, String(value));
			});

			syncCheckedState(Boolean(node.attrs.checked));

			checkboxWrapper.append(checkbox, checkboxStyler);
			listItem.append(checkboxWrapper, content);

			Object.entries(HTMLAttributes).forEach(([key, value]) => {
				listItem.setAttribute(key, String(value));
			});

			let previousRenderedAttributeKeys = new Set(Object.keys(HTMLAttributes));

			return {
				dom: listItem,
				contentDOM: content,
				update: (updatedNode) => {
					if (updatedNode.type !== this.type) {
						return false;
					}

					syncCheckedState(Boolean(updatedNode.attrs.checked));
					updateA11y(updatedNode);

					const extensionAttributes = editor.extensionManager.attributes;
					const newHtmlAttributes = getRenderedAttributes(updatedNode, extensionAttributes);
					const newKeys = new Set(Object.keys(newHtmlAttributes));
					const staticAttributes = this.options.HTMLAttributes;

					previousRenderedAttributeKeys.forEach((key) => {
						if (!newKeys.has(key)) {
							if (key in staticAttributes) {
								listItem.setAttribute(key, String(staticAttributes[key]));
							} else {
								listItem.removeAttribute(key);
							}
						}
					});

					Object.entries(newHtmlAttributes).forEach(([key, value]) => {
						if (value === null || value === undefined) {
							if (key in staticAttributes) {
								listItem.setAttribute(key, String(staticAttributes[key]));
							} else {
								listItem.removeAttribute(key);
							}
						} else {
							listItem.setAttribute(key, String(value));
						}
					});

					previousRenderedAttributeKeys = newKeys;
					return true;
				},
			};
		};
	},
});

function buildStarterKit(variant: RichTextVariant, enableUndoRedo: boolean) {
	if (variant === 'minimal') {
		return StarterKit.configure({
			undoRedo: enableUndoRedo,
			link: false,
			underline: false,
			heading: false,
			bulletList: false,
			orderedList: false,
			blockquote: false,
			codeBlock: false,
			horizontalRule: false,
		});
	}

	return StarterKit.configure({
		undoRedo: enableUndoRedo,
		link: false,
		underline: false,
		heading: false,
	});
}

export function createRichTextExtensions(args: {
	variant: RichTextVariant;
	placeholder?: string;
	includeCollaboration?: boolean;
	fragment?: Y.XmlFragment | null;
	collapsibleHeadingNoteId?: string | null;
}): Extensions {
	const enableUndoRedo = args.includeCollaboration !== true;
	const extensions: Extensions = [
		buildStarterKit(args.variant, enableUndoRedo),
		...(args.variant === 'full' ? [CollapsibleHeading.configure({ noteId: args.collapsibleHeadingNoteId ?? null })] : []),
		Underline,
		Highlight.configure({ multicolor: true }),
		Link.configure({
			autolink: true,
			openOnClick: true,
			defaultProtocol: 'https',
			HTMLAttributes: {
				target: getExternalLinkTarget(),
				rel: getExternalLinkRel(),
			},
		}),
	];

	if (args.variant === 'full') {
		extensions.push(
			TaskList,
			MobileSafeTaskItem.configure({ nested: true }),
			Table.configure({ resizable: false }),
			TableRow,
			TableHeader,
			TableCell,
			TextAlign.configure({ types: ['heading', 'paragraph'] }),
		);
	}

	// ReferenceExtension enabled for both variants so @mention works in checklist items
	extensions.push(ReferenceExtension);

	if (args.placeholder) {
		extensions.push(
			Placeholder.configure({
				placeholder: args.placeholder,
				showOnlyWhenEditable: true,
			})
		);
	}

	if (args.includeCollaboration && args.fragment) {
		extensions.push(Collaboration.configure({ fragment: args.fragment }));
	}

	return extensions;
}

function getSchemaForVariant(variant: RichTextVariant) {
	return getSchema(createRichTextExtensions({ variant }));
}

function makeParagraphNode(text: string): JSONContent {
	if (text.length === 0) {
		return { type: 'paragraph' };
	}

	const pieces = text.split('\n');
	const content: JSONContent[] = [];
	pieces.forEach((piece, index) => {
		if (piece.length > 0) {
			content.push({ type: 'text', text: piece });
		}
		if (index < pieces.length - 1) {
			content.push({ type: 'hardBreak' });
		}
	});

	return { type: 'paragraph', content: content.length > 0 ? content : undefined };
}

function ensureMinimalRichTextDoc(json: JSONContent): JSONContent {
	if (json.type === 'doc' && Array.isArray(json.content) && json.content.length > 0) {
		return json;
	}
	return createRichTextDocFromPlainText('', 'minimal');
}

export function splitMinimalRichTextAtSelection(editor: Editor): {
	before: JSONContent;
	after: JSONContent;
	beforeText: string;
	afterText: string;
} {
	const { doc, selection } = editor.state;
	const before = ensureMinimalRichTextDoc(doc.cut(0, selection.from).toJSON() as JSONContent);
	const after = ensureMinimalRichTextDoc(doc.cut(selection.to, doc.content.size).toJSON() as JSONContent);
	return {
		before,
		after,
		beforeText: getPlainTextFromRichJson(before, 'minimal'),
		afterText: getPlainTextFromRichJson(after, 'minimal'),
	};
}

export function createRichTextDocFromPlainText(text: string, variant: RichTextVariant = 'minimal'): JSONContent {
	const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
	const paragraphs = variant === 'full' ? normalized.split('\n') : normalized.split('\n\n');
	return {
		type: 'doc',
		content: paragraphs.map((paragraph) => makeParagraphNode(paragraph)),
	};
}

export function setYTextValue(ytext: Y.Text, next: string): void {
	const prev = ytext.toString();
	if (prev === next) return;

	let start = 0;
	const prevLen = prev.length;
	const nextLen = next.length;
	const minLen = Math.min(prevLen, nextLen);
	while (start < minLen && prev.charCodeAt(start) === next.charCodeAt(start)) {
		start++;
	}

	let prevEnd = prevLen - 1;
	let nextEnd = nextLen - 1;
	while (prevEnd >= start && nextEnd >= start && prev.charCodeAt(prevEnd) === next.charCodeAt(nextEnd)) {
		prevEnd--;
		nextEnd--;
	}

	const deleteLen = prevEnd >= start ? prevEnd - start + 1 : 0;
	const insertText = nextEnd >= start ? next.slice(start, nextEnd + 1) : '';
	const doc = (ytext as unknown as { doc?: Y.Doc | null }).doc ?? null;
	const apply = (): void => {
		if (deleteLen > 0) ytext.delete(start, deleteLen);
		if (insertText.length > 0) ytext.insert(start, insertText);
	};
	if (doc) doc.transact(apply);
	else apply();
}

export function getPlainTextFromRichJson(json: JSONContent, variant: RichTextVariant): string {
	// trim() (not just trimEnd) prevents leading/trailing whitespace from
	// leaking into the plain-text 'content' field and being re-seeded on a
	// subsequent cache clear, which would compound blank-paragraph corruption.
	return generateText(json, createRichTextExtensions({ variant }), { blockSeparator: variant === 'full' ? '\n' : '\n\n' }).trim();
}

export function getPlainTextFromRichFragment(fragment: Y.XmlFragment, variant: RichTextVariant): string {
	if (fragment.length === 0) return '';
	return getPlainTextFromRichJson(yXmlFragmentToProsemirrorJSON(fragment) as JSONContent, variant);
}

export function replaceRichFragmentFromJson(fragment: Y.XmlFragment, json: JSONContent, variant: RichTextVariant): void {
	const doc = (fragment as unknown as { doc?: Y.Doc | null }).doc ?? null;
	const apply = (): void => {
		// Detached fragments log a noisy Yjs warning when their length is read.
		// Only clear existing content once the fragment is attached to a real doc.
		if (doc && fragment.length > 0) {
			fragment.delete(0, fragment.length);
		}
		prosemirrorJSONToYXmlFragment(getSchemaForVariant(variant), json, fragment);
	};
	if (doc) doc.transact(apply);
	else apply();
}

export function ensureTextNoteRichContent(doc: Y.Doc): Y.XmlFragment {
	const fragment = doc.getXmlFragment(TEXT_NOTE_RICH_FIELD);
	if (fragment.length === 0) {
		const plainText = doc.getText('content').toString();
		if (plainText.length > 0) {
			// Only seed when the plain-text field already has content.
			// If both fields are empty the document has not yet received its
			// initial state from the WebSocket server — seeding now would write
			// ghost CRDT items (e.g. an empty paragraph) into the fragment.
			// When the real server state arrives it cannot overwrite those items;
			// instead they merge, producing extra blank paragraphs that persist
			// and compound across subsequent cache clears.
			const seed = (): void => {
				replaceRichFragmentFromJson(fragment, createRichTextDocFromPlainText(plainText, 'full'), 'full');
			};
			doc.transact(seed, RICHTEXT_INTERNAL_ORIGIN);
		}
	}
	return fragment;
}

export function syncTextNotePlainText(doc: Y.Doc, fragment: Y.XmlFragment): string {
	const next = getPlainTextFromRichFragment(fragment, 'full');
	setYTextValue(doc.getText('content'), next);
	return next;
}

export function getTextNoteRichPreviewJson(doc: Y.Doc): JSONContent | null {
	// Materialize the named root fragment on read. On a cold load, relying on
	// doc.share.get(...) can return undefined until some other code path first
	// touches the root type, which makes note-card previews fall back to plain
	// text until the editor opens. getXmlFragment() safely returns the existing
	// fragment when present and instantiates the accessor when not yet realized.
	const fragment = doc.getXmlFragment(TEXT_NOTE_RICH_FIELD);
	if (fragment.length === 0) return null;
	try {
		return yXmlFragmentToProsemirrorJSON(fragment) as JSONContent;
	} catch {
		return null;
	}
}

export function ensureChecklistItemRichContent(itemMap: Y.Map<any>): Y.XmlFragment {
	let fragment = itemMap.get(CHECKLIST_ITEM_RICH_FIELD) as Y.XmlFragment | undefined;
	if (!(fragment instanceof Y.XmlFragment)) {
		const doc = (itemMap as unknown as { doc?: Y.Doc | null }).doc ?? null;
		const create = (): void => {
			fragment = new Y.XmlFragment();
			itemMap.set(CHECKLIST_ITEM_RICH_FIELD, fragment as Y.XmlFragment);
		};
		if (doc) doc.transact(create, RICHTEXT_INTERNAL_ORIGIN);
		else create();
		fragment = itemMap.get(CHECKLIST_ITEM_RICH_FIELD) as Y.XmlFragment | undefined;
	}
	if (fragment instanceof Y.XmlFragment && fragment.length === 0) {
		const doc = (itemMap as unknown as { doc?: Y.Doc | null }).doc ?? null;
		const seed = (): void => {
			replaceRichFragmentFromJson(fragment as Y.XmlFragment, createRichTextDocFromPlainText(String(itemMap.get('text') ?? '')), 'minimal');
		};
		if (doc) doc.transact(seed, RICHTEXT_INTERNAL_ORIGIN);
		else seed();
	}
	return fragment as Y.XmlFragment;
}

export function syncChecklistItemPlainText(itemMap: Y.Map<any>, fragment: Y.XmlFragment): string {
	const next = getPlainTextFromRichFragment(fragment, 'minimal');
	const current = String(itemMap.get('text') ?? '');
	if (current !== next) {
		itemMap.set('text', next);
	}
	return next;
}

export function getChecklistItemPlainText(itemMap: Y.Map<any>): string {
	const plainText = String(itemMap.get('text') ?? '');
	return plainText.length > 0 ? plainText : getPlainTextFromRichFragment(ensureChecklistItemRichContent(itemMap), 'minimal');
}

/**
 * Read-only accessor for an existing rich-content fragment.
 * Returns null if the item has no contentRich yet — never mutates Y.js.
 */
export function getChecklistItemRichPreviewJson(itemMap: Y.Map<any>): JSONContent | null {
	const fragment = itemMap.get(CHECKLIST_ITEM_RICH_FIELD);
	if (!(fragment instanceof Y.XmlFragment) || fragment.length === 0) return null;
	try {
		return yXmlFragmentToProsemirrorJSON(fragment) as JSONContent;
	} catch {
		return null;
	}
}

/**
 * Snapshot all rich-content fragments from a checklist Y.Array.
 * Returns a Map from item ID → serialized ProseMirror JSON.
 *
 * Call this **before** deleting/replacing Y.Map entries so the rich content
 * can be restored onto freshly-created maps (Y.js tombstones nested types
 * when the parent map is deleted from an array).
 */
export function snapshotChecklistRichContent(
	yarray: Y.Array<Y.Map<any>>,
): Map<string, JSONContent> {
	const result = new Map<string, JSONContent>();
	for (const m of yarray.toArray()) {
		const id = String(m.get('id') ?? '');
		if (!id) continue;
		const frag = m.get(CHECKLIST_ITEM_RICH_FIELD) as Y.XmlFragment | undefined;
		if (frag instanceof Y.XmlFragment && frag.length > 0) {
			try {
				result.set(id, yXmlFragmentToProsemirrorJSON(frag) as JSONContent);
			} catch {
				// Fragment couldn't be serialized — skip it.
			}
		}
	}
	return result;
}

/**
 * Restore rich content onto a freshly-created checklist Y.Map entry.
 *
 * Creates a new Y.XmlFragment, sets it on the map, and populates it from
 * the given ProseMirror JSON snapshot. No-ops if the map already has a
 * non-empty contentRich fragment.
 */
export function restoreChecklistItemRichContent(
	itemMap: Y.Map<any>,
	json: JSONContent,
): void {
	const existing = itemMap.get(CHECKLIST_ITEM_RICH_FIELD);
	if (existing instanceof Y.XmlFragment && existing.length > 0) return;
	const fragment = new Y.XmlFragment();
	itemMap.set(CHECKLIST_ITEM_RICH_FIELD, fragment);
	replaceRichFragmentFromJson(fragment, json, 'minimal');
}

export function looksLikeMarkdown(text: string): boolean {
	const normalized = String(text ?? '').replace(/\r\n?/g, '\n').trim();
	if (normalized.length === 0) return false;
	// Use a light heuristic instead of full parsing first so normal prose paste is cheap
	// and only obviously-markdown text goes through the markdown-it conversion path.
	return MARKDOWN_BLOCK_PATTERN.test(normalized) || MARKDOWN_INLINE_PATTERN.test(normalized);
}

function normalizeMarkdownTaskListHtml(html: string): string {
	if (typeof DOMParser === 'undefined') return html;
	// markdown-it-task-lists emits plain HTML checkboxes; reshape that markup into the
	// data attributes TipTap expects so pasted task lists become real editable task nodes.
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const taskLists = Array.from(doc.querySelectorAll('ul.contains-task-list'));
	for (const list of taskLists) {
		list.setAttribute('data-type', 'taskList');
	}
	const taskItems = Array.from(doc.querySelectorAll('li.task-list-item'));
	for (const item of taskItems) {
		const directCheckbox = Array.from(item.childNodes).find((node) => {
			return node instanceof HTMLInputElement && node.type === 'checkbox';
		}) as HTMLInputElement | undefined;
		const fallbackCheckbox = directCheckbox ?? item.querySelector('input[type="checkbox"]') ?? undefined;
		const checked = fallbackCheckbox?.checked === true;
		item.setAttribute('data-type', 'taskItem');
		item.setAttribute('data-checked', checked ? 'true' : 'false');
		if (fallbackCheckbox) fallbackCheckbox.remove();

		const label = doc.createElement('label');
		label.contentEditable = 'false';
		const input = doc.createElement('input');
		input.type = 'checkbox';
		if (checked) input.checked = true;
		label.appendChild(input);

		const contentWrapper = doc.createElement('div');
		while (item.firstChild) {
			contentWrapper.appendChild(item.firstChild);
		}

		item.append(label, contentWrapper);
	}
	return doc.body.innerHTML;
}

function applyMarkdownMarkSyntax(html: string): string {
	if (typeof DOMParser === 'undefined' || typeof NodeFilter === 'undefined') {
		return html.replace(MARKDOWN_MARK_PATTERN, '<mark>$1</mark>');
	}
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
	const textNodes: Text[] = [];
	let currentNode = walker.nextNode();
	while (currentNode) {
		if (currentNode instanceof Text) {
			textNodes.push(currentNode);
		}
		currentNode = walker.nextNode();
	}
	for (const textNode of textNodes) {
		if (textNode.parentElement?.closest('code, pre')) continue;
		const value = textNode.data;
		MARKDOWN_MARK_PATTERN.lastIndex = 0;
		let match = MARKDOWN_MARK_PATTERN.exec(value);
		if (!match) continue;
		const fragment = doc.createDocumentFragment();
		let lastIndex = 0;
		do {
			if (match.index > lastIndex) {
				fragment.append(doc.createTextNode(value.slice(lastIndex, match.index)));
			}
			const mark = doc.createElement('mark');
			mark.textContent = match[1];
			fragment.append(mark);
			lastIndex = match.index + match[0].length;
			match = MARKDOWN_MARK_PATTERN.exec(value);
		} while (match);
		if (lastIndex < value.length) {
			fragment.append(doc.createTextNode(value.slice(lastIndex)));
		}
		textNode.replaceWith(fragment);
	}
	return doc.body.innerHTML;
}

export function getVisibleClipboardTextFromHtml(html: string): string {
	if (typeof DOMParser === 'undefined') return '';
	const doc = new DOMParser().parseFromString(html, 'text/html');
	for (const br of Array.from(doc.querySelectorAll('br'))) {
		br.replaceWith(doc.createTextNode('\n'));
	}
	for (const hr of Array.from(doc.querySelectorAll('hr'))) {
		hr.replaceWith(doc.createTextNode('\n---\n'));
	}
	for (const cell of Array.from(doc.querySelectorAll(CLIPBOARD_CELL_SELECTOR))) {
		if (!cell.textContent?.endsWith('\t')) {
			cell.append(doc.createTextNode('\t'));
		}
	}
	for (const item of Array.from(doc.querySelectorAll('li'))) {
		const parentTag = item.parentElement?.tagName;
		const prefix = parentTag === 'OL'
			? `${Array.from(item.parentElement?.children ?? []).indexOf(item) + 1}. `
			: ((item.getAttribute('data-type') === 'taskItem')
				? `- [${item.getAttribute('data-checked') === 'true' ? 'x' : ' '}] `
				: '- ');
		item.prepend(doc.createTextNode(prefix));
		item.append(doc.createTextNode('\n'));
	}
	for (const block of Array.from(doc.querySelectorAll(CLIPBOARD_BLOCK_SELECTOR))) {
		if (!block.textContent?.endsWith('\n')) {
			block.append(doc.createTextNode('\n'));
		}
	}
	return (doc.body.textContent ?? '')
		.replace(/\u00a0/g, ' ')
		.replace(/\r\n?/g, '\n')
		.replace(/\t\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export function isMeaningfulClipboardHtml(html: string | null | undefined): boolean {
	return MEANINGFUL_CLIPBOARD_HTML_PATTERN.test(String(html ?? '').trim());
}

export function renderMarkdownToRichHtml(text: string): string | null {
	const normalized = String(text ?? '').replace(/\r\n?/g, '\n').trim();
	if (!looksLikeMarkdown(normalized)) return null;
	const rendered = markdownParser.render(normalized).trim();
	if (rendered.length === 0) return null;
	return applyMarkdownMarkSyntax(normalizeMarkdownTaskListHtml(rendered));
}

export function wrapClipboardHtmlDocument(html: string): string {
	const fragment = String(html ?? '').trim();
	if (!fragment) return '';
	return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
}

export function getMarkdownPasteHtml(args: {
	text: string;
	html?: string | null;
	variant: RichTextVariant;
}): string | null {
	const text = String(args.text ?? '').replace(/\r\n?/g, '\n');
	if (!looksLikeMarkdown(text)) return null;
	const clipboardHtml = String(args.html ?? '').trim();
	if (
		// If the clipboard already contains richer HTML than the markdown source, keep it.
		// This avoids downgrading content copied from websites or other editors.
		clipboardHtml &&
		MEANINGFUL_CLIPBOARD_HTML_PATTERN.test(clipboardHtml) &&
		getVisibleClipboardTextFromHtml(clipboardHtml) !== text.trim()
	) {
		return null;
	}
	return renderMarkdownToRichHtml(text);
}