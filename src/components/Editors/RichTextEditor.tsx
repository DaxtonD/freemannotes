import React from 'react';
import { createPortal } from 'react-dom';
import type { Editor, JSONContent } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faAlignCenter,
	faChevronLeft,
	faChevronRight,
	faAlignLeft,
	faAlignRight,
	faBold,
	faCode,
	faCopy,
	faFaceSmile,
	faHeading,
	faHighlighter,
	faIndent,
	faItalic,
	faLink,
	faListCheck,
	faListOl,
	faListUl,
	faMinus,
	faOutdent,
	faPlus,
	faQuoteLeft,
	faRotateLeft,
	faRotateRight,
	faSquareCheck,
	faStrikethrough,
	faTable,
	faUnderline,
} from '@fortawesome/free-solid-svg-icons';
import * as Y from 'yjs';
import { getCollapsedRichHeadingPrefsSnapshot, getRichHeadingCollapsed, subscribeCollapsedRichHeadingPrefs } from '../../core/collapsibleHeadingPreferences';
import { recordHeadingCollapseDebug } from '../../core/collapsibleHeadingCollapseDebug';
import type { EditorToolbarMode } from '../../core/deviceAppearancePreferences';
import { createRichTextExtensions, getMarkdownPasteHtml, type RichTextVariant } from '../../core/richText';
import { ReferenceSuggestionKey } from '../../core/extensions/ReferenceExtension';
import { isNoteDenied, markNoteDenied } from '../../core/references/noteAccessCache';
import { prepareConvertedClipboardPayload, type ClipboardConversionTarget } from '../../core/clipboardConversion';
import { useI18n } from '../../core/i18n';
import { useBubbleMenuEnabled } from '../../core/useBubbleMenuPreference';
import styles from './Editors.module.css';

type RichTextEditorProps = {
	variant: RichTextVariant;
	placeholder: string;
	content?: JSONContent | null;
	fragment?: Y.XmlFragment | null;
	emitInitialChange?: boolean;
	serializeChangePayload?: boolean;
	autoFocus?: boolean;
	compactToolbar?: boolean;
	toolbarMode?: EditorToolbarMode;
	hideToolbar?: boolean;
	caretVisibilityBottomInset?: number;
	containerClassName?: string;
	viewportClassName?: string;
	contentClassName?: string;
	onChange?: (payload?: { json: JSONContent; text: string }) => void;
	onEditorChange?: (editor: Editor | null) => void;
	onEnter?: (editor: Editor) => void;
	onShiftEnter?: () => void;
	onBackspaceWhenEmpty?: () => void;
	onArrowUpAtBoundary?: () => void;
	onArrowDownAtBoundary?: () => void;
	editable?: boolean;
	suppressMobileTaskCheckboxFocus?: boolean;
	onCreateUrlPreview?: () => void;
	noteAutoScrollEnabled?: boolean;
	onToggleNoteAutoScroll?: () => void;
	copyMode?: ClipboardConversionTarget;
	onCopyModeChange?: (target: ClipboardConversionTarget) => void;
	onClipboardStatusChange?: (message: string) => void;
	collapsibleHeadingNoteId?: string | null;
	onNoteClick?: (noteId: string) => void;
	scrollToMentionNodeId?: string | null;
	authUserId?: string | null;
	onSelfMentionInserted?: (nodeId: string) => void;
};

type RichTextToolbarProps = {
	editor: Editor | null;
	variant: RichTextVariant;
	compact?: boolean;
	toolbarMode?: EditorToolbarMode;
	hideStrikeButton?: boolean;
	applyInlineFormattingToWholeEditor?: boolean;
	preferEditorUndoRedo?: boolean;
	onCreateUrlPreview?: () => void;
	noteAutoScrollEnabled?: boolean;
	onToggleNoteAutoScroll?: () => void;
	copyMode?: ClipboardConversionTarget;
	onCopyModeChange?: (target: ClipboardConversionTarget) => void;
	/** Checkbox undo / redo — only wired up when the toolbar is used in checklist mode */
	onUndoCheckbox?: () => void;
	onRedoCheckbox?: () => void;
	checkboxUndoAvail?: boolean;
	checkboxRedoAvail?: boolean;
	onMakeChecklistCount?: () => void;
	onRemoveChecklistCount?: () => void;
	onIncrementChecklistCount?: () => void;
	onDecrementChecklistCount?: () => void;
	collapsibleHeadingNoteId?: string | null;
};

type CondensedToolbarSection = 'formatting' | 'headings' | 'lists' | 'insert' | 'layout' | 'copy' | null;

function getScrollContainer(node: HTMLElement | null): HTMLElement | null {
	let current = node?.parentElement ?? null;
	while (current) {
		const style = window.getComputedStyle(current);
		const overflowY = style.overflowY;
		// `overflow:auto` alone is not enough: only treat the element as a scroll parent
		// when content actually exceeds the container, otherwise selection scrolling would
		// target non-scrolling wrappers and appear to do nothing.
		const isScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && current.scrollHeight > current.clientHeight;
		if (isScrollable) return current;
		current = current.parentElement;
	}
	return null;
}

// Converts heading text to a URL fragment ID using the same algorithm GitHub uses:
// lowercase, spaces → hyphens, strip everything except word chars and hyphens.
function slugifyHeadingText(text: string): string {
	return text
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^\w-]/g, '');
}

// Searches the ProseMirror document for the first heading whose slugified text
// matches `slug`, then scrolls its DOM element into view.  Using nodeDOM(pos)
// instead of querying by id attribute avoids any timing dependency on the
// MutationObserver having run.
function scrollToSluggedHeading(view: EditorView, slug: string): void {
	let found: number | null = null;
	view.state.doc.descendants((node, pos) => {
		if (found !== null) return false;
		if (node.type.name === 'heading' && slugifyHeadingText(node.textContent) === slug) {
			found = pos;
			return false;
		}
	});
	if (found === null) return;
	const dom = view.nodeDOM(found);
	if (dom instanceof HTMLElement) {
		// Blur the editor before scrolling. On mobile, if the editor has an active
		// cursor the browser scrolls to make that cursor visible on any touch — which
		// overrides the programmatic scrollIntoView regardless of where the cursor is.
		// Blurring removes the selection so the browser has no cursor to chase.
		(document.activeElement as HTMLElement | null)?.blur();
		dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
}

export function ensureEditorSelectionVisible(editor: Editor | null, bottomInset: number): void {
	if (!editor || typeof window === 'undefined') return;
	const root = editor.view.dom as HTMLElement | null;
	if (!root || !root.isConnected) return;
	const scrollContainer = getScrollContainer(root);
	if (!scrollContainer) return;
	const { from, to } = editor.state.selection;
	let startRect: { top: number; bottom: number };
	let endRect: { top: number; bottom: number };
	try {
		startRect = editor.view.coordsAtPos(from);
		endRect = editor.view.coordsAtPos(to);
	} catch {
		return;
	}
	const containerRect = scrollContainer.getBoundingClientRect();
	const topBuffer = 12;
	const bottomBuffer = Math.max(12, bottomInset);
	const visibleTop = containerRect.top + topBuffer;
	const visibleBottom = containerRect.bottom - bottomBuffer;
	const selectionTop = Math.min(startRect.top, endRect.top);
	const selectionBottom = Math.max(startRect.bottom, endRect.bottom);

	if (selectionBottom > visibleBottom) {
		scrollContainer.scrollTop += selectionBottom - visibleBottom;
		return;
	}
	if (selectionTop < visibleTop) {
		scrollContainer.scrollTop -= visibleTop - selectionTop;
	}
}

export function focusRichTextEditable(element: HTMLElement | null, placement: 'start' | 'end' = 'end'): void {
	if (!element) return;
	element.focus();
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	const selection = window.getSelection();
	if (!selection) return;
	const range = document.createRange();
	range.selectNodeContents(element);
	range.collapse(placement === 'start');
	selection.removeAllRanges();
	selection.addRange(range);
}

function ensureEditorElementVisible(element: HTMLElement | null, bottomInset: number): void {
	if (!element) return;
	const scrollContainer = getScrollContainer(element);
	if (!scrollContainer) return;
	const elementRect = element.getBoundingClientRect();
	const containerRect = scrollContainer.getBoundingClientRect();
	const topBuffer = 12;
	const bottomBuffer = Math.max(12, bottomInset);
	const visibleTop = containerRect.top + topBuffer;
	const visibleBottom = containerRect.bottom - bottomBuffer;

	if (elementRect.bottom > visibleBottom) {
		scrollContainer.scrollTop += elementRect.bottom - visibleBottom;
		return;
	}
	if (elementRect.top < visibleTop) {
		scrollContainer.scrollTop -= visibleTop - elementRect.top;
	}
}

function canRunUndo(editor: Editor | null | undefined): boolean {
	if (!editor) return false;
	try {
		const canApi = editor.can() as { undo?: () => boolean };
		return typeof canApi.undo === 'function' ? Boolean(canApi.undo()) : false;
	} catch {
		return false;
	}
}

function canRunRedo(editor: Editor | null | undefined): boolean {
	if (!editor) return false;
	try {
		const canApi = editor.can() as { redo?: () => boolean };
		return typeof canApi.redo === 'function' ? Boolean(canApi.redo()) : false;
	} catch {
		return false;
	}
}

function canRunRichTextCommand(editor: Editor | null | undefined, commandName: string, ...args: unknown[]): boolean {
	if (!editor) return false;
	try {
		// TipTap command availability varies by extension set, so this helper lets the
		// toolbar ask about optional commands without hard-coding extension knowledge.
		const canApi = editor.can() as unknown as Record<string, ((...callArgs: unknown[]) => boolean) | undefined>;
		const command = canApi[commandName];
		return typeof command === 'function' ? Boolean(command(...args)) : false;
	} catch {
		return false;
	}
}

type ActiveHeadingToolbarContext = {
	level: number | null;
	collapsible: boolean;
	collapseId: string | null;
};

function readActiveHeadingToolbarContext(editor: Editor | null | undefined): ActiveHeadingToolbarContext {
	if (!editor) return { level: null, collapsible: false, collapseId: null };
	const { $from } = editor.state.selection;
	for (let depth = $from.depth; depth > 0; depth -= 1) {
		const node = $from.node(depth);
		if (node.type.name !== 'heading') continue;
		const level = Number(node.attrs.level);
		const collapseId = typeof node.attrs.collapseId === 'string' && node.attrs.collapseId.trim()
			? node.attrs.collapseId.trim()
			: null;
		return {
			level: Number.isFinite(level) ? Math.round(level) : null,
			collapsible: Boolean(node.attrs.collapsible),
			collapseId,
		};
	}
	return { level: null, collapsible: false, collapseId: null };
}

function runUndo(editor: Editor | null | undefined): void {
	if (!editor) return;
	try {
		const chain = editor.chain().focus() as { undo?: () => { run: () => boolean } };
		if (typeof chain.undo === 'function') {
			chain.undo().run();
		}
	} catch {
		// Editor was destroyed or the command is unavailable.
	}
}

function runRedo(editor: Editor | null | undefined): void {
	if (!editor) return;
	try {
		const chain = editor.chain().focus() as { redo?: () => { run: () => boolean } };
		if (typeof chain.redo === 'function') {
			chain.redo().run();
		}
	} catch {
		// Editor was destroyed or the command is unavailable.
	}
}

function runRichTextCommand(editor: Editor | null | undefined, commandName: string, ...args: unknown[]): void {
	if (!editor) return;
	try {
		// Mirror the defensive can-run helper above: missing commands should quietly no-op
		// rather than explode when the editor is mid-destroy or the extension is absent.
		const chain = editor.chain().focus() as unknown as Record<string, ((...callArgs: unknown[]) => { run: () => boolean }) | undefined>;
		const command = chain[commandName];
		if (typeof command === 'function') {
			command(...args).run();
		}
	} catch {
		// Editor was destroyed or the command is unavailable.
	}
}

function withWholeEditorSelection(editor: Editor | null | undefined, callback: (editor: Editor) => void): void {
	if (!editor) return;
	const originalFrom = editor.state.selection.from;
	const originalTo = editor.state.selection.to;
	try {
		const chain = editor.chain().focus() as unknown as { selectAll?: () => { run: () => boolean } };
		if (typeof chain.selectAll === 'function') {
			chain.selectAll().run();
		}
		callback(editor);
	} finally {
		try {
			const docEnd = Math.max(1, editor.state.doc.content.size - 1);
			const restoreFrom = Math.min(Math.max(1, originalFrom), docEnd);
			const restoreTo = Math.min(Math.max(1, originalTo), docEnd);
			const chain = editor.chain().focus() as unknown as {
				setTextSelection?: (position: number | { from: number; to: number }) => { run: () => boolean };
			};
			if (typeof chain.setTextSelection === 'function') {
				chain.setTextSelection(
					restoreFrom === restoreTo
						? restoreFrom
						: { from: restoreFrom, to: restoreTo },
				).run();
			}
		} catch {
			// Editor was destroyed while the toolbar action was running.
		}
	}
}

function applyWholeRowInlineCommand(
	editor: Editor | null | undefined,
	applyToWholeEditor: boolean,
	callback: (editor: Editor) => void,
): void {
	if (!editor) return;
	if (!applyToWholeEditor) {
		callback(editor);
		return;
	}
	withWholeEditorSelection(editor, callback);
}

function shouldExitEmptyListItem(editor: Editor | null | undefined): boolean {
	if (!editor) return false;
	const { selection } = editor.state;
	if (!selection.empty) return false;
	if (!editor.isActive('bulletList') && !editor.isActive('orderedList')) return false;
	// Empty-list-item branch: a second Enter on a blank bullet/numbered row should
	// exit the list instead of creating infinite empty items.
	const parentText = selection.$from.parent.textContent;
	if (parentText.trim().length > 0) return false;
	for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
		if (selection.$from.node(depth).type.name === 'listItem') return true;
	}
	return false;
}

function exitEmptyListItem(editor: Editor | null | undefined): boolean {
	if (!editor) return false;
	try {
		// Lift the current listItem back out to paragraph level, matching standard editor UX.
		const chain = editor.chain().focus() as { liftListItem?: (typeOrName: string) => { run: () => boolean } };
		if (typeof chain.liftListItem === 'function') {
			return Boolean(chain.liftListItem('listItem').run());
		}
	} catch {
		// Editor was destroyed or the command is unavailable.
	}
	return false;
}

function getToolbarNestingContext(editor: Editor | null | undefined): 'listItem' | 'taskItem' | 'blockquote' | null {
	if (!editor) return null;
	// Prefer list nesting when the selection sits inside both a list and a blockquote.
	// That keeps the toolbar aligned with the most common expectation: indenting the
	// current list row instead of wrapping the entire quoted section again.
	if (editor.isActive('taskList')) return 'taskItem';
	if (editor.isActive('bulletList') || editor.isActive('orderedList')) return 'listItem';
	if (editor.isActive('blockquote')) return 'blockquote';
	return null;
}

function canIndentStructuredBlock(editor: Editor | null | undefined): boolean {
	const context = getToolbarNestingContext(editor);
	if (context === 'taskItem') return canRunRichTextCommand(editor, 'sinkListItem', 'taskItem');
	if (context === 'listItem') return canRunRichTextCommand(editor, 'sinkListItem', 'listItem');
	if (context === 'blockquote') return canRunRichTextCommand(editor, 'wrapIn', 'blockquote');
	return false;
}

function canOutdentStructuredBlock(editor: Editor | null | undefined): boolean {
	const context = getToolbarNestingContext(editor);
	if (context === 'taskItem') return canRunRichTextCommand(editor, 'liftListItem', 'taskItem');
	if (context === 'listItem') return canRunRichTextCommand(editor, 'liftListItem', 'listItem');
	if (context === 'blockquote') return canRunRichTextCommand(editor, 'lift', 'blockquote');
	return false;
}

function indentStructuredBlock(editor: Editor | null | undefined): void {
	const context = getToolbarNestingContext(editor);
	if (context === 'taskItem') {
		runRichTextCommand(editor, 'sinkListItem', 'taskItem');
		return;
	}
	if (context === 'listItem') {
		runRichTextCommand(editor, 'sinkListItem', 'listItem');
		return;
	}
	if (context === 'blockquote') {
		runRichTextCommand(editor, 'wrapIn', 'blockquote');
	}
}

function outdentStructuredBlock(editor: Editor | null | undefined): void {
	const context = getToolbarNestingContext(editor);
	if (context === 'taskItem') {
		runRichTextCommand(editor, 'liftListItem', 'taskItem');
		return;
	}
	if (context === 'listItem') {
		runRichTextCommand(editor, 'liftListItem', 'listItem');
		return;
	}
	if (context === 'blockquote') {
		runRichTextCommand(editor, 'lift', 'blockquote');
	}
}

function getEditorSelectionClipboardInput(editor: Editor | null): { text: string; html: string } | null {
	if (!editor) return null;
	const { from, to, empty } = editor.state.selection;
	if (empty || from === to) return null;
	const slice = editor.state.selection.content();
	const serializer = DOMSerializer.fromSchema(editor.schema);
	const container = document.createElement('div');
	container.appendChild(serializer.serializeFragment(slice.content));
	const text = editor.state.doc.textBetween(from, to, '\n\n');
	return { text, html: container.innerHTML };
}

function getTaskListCheckboxTarget(target: EventTarget | null): HTMLInputElement | null {
	if (!(target instanceof HTMLElement)) return null;
	const checkbox = target.closest('input[type="checkbox"]');
	if (!(checkbox instanceof HTMLInputElement)) return null;
	return checkbox.closest('li[data-type="taskItem"]') instanceof HTMLElement ? checkbox : null;
}

function getTaskItemPositionFromTarget(view: Editor['view'], target: EventTarget | null): number | null {
	const checkbox = getTaskListCheckboxTarget(target);
	const taskItem = checkbox?.closest('li[data-type="taskItem"]');
	if (!(taskItem instanceof HTMLElement)) return null;
	try {
		return view.posAtDOM(taskItem, 0);
	} catch {
		return null;
	}
}

function getTaskItemElementFromTarget(target: EventTarget | null): HTMLElement | null {
	const checkbox = getTaskListCheckboxTarget(target);
	const taskItem = checkbox?.closest('li[data-type="taskItem"]');
	return taskItem instanceof HTMLElement ? taskItem : null;
}

// ── Highlight color palette ────────────────────────────────────────────────
// Colors are CSS variable references so they automatically respect theme
// overrides declared in variables.css or per-theme override blocks.
type HighlightColor = { id: string; labelKey: string; previewColor: string; cssVar: string | null };
const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
	{ id: 'default', labelKey: 'editors.highlightDefault', previewColor: 'var(--hl-default-bg)', cssVar: null },
	{ id: 'yellow', labelKey: 'editors.highlightYellow', previewColor: 'var(--hl-yellow)', cssVar: 'var(--hl-yellow)' },
	{ id: 'green',  labelKey: 'editors.highlightGreen',  previewColor: 'var(--hl-green)',  cssVar: 'var(--hl-green)'  },
	{ id: 'blue',   labelKey: 'editors.highlightBlue',   previewColor: 'var(--hl-blue)',   cssVar: 'var(--hl-blue)'   },
	{ id: 'pink',   labelKey: 'editors.highlightPink',   previewColor: 'var(--hl-pink)',   cssVar: 'var(--hl-pink)'   },
	{ id: 'purple', labelKey: 'editors.highlightPurple', previewColor: 'var(--hl-purple)', cssVar: 'var(--hl-purple)' },
	{ id: 'orange', labelKey: 'editors.highlightOrange', previewColor: 'var(--hl-orange)', cssVar: 'var(--hl-orange)' },
	{ id: 'teal',   labelKey: 'editors.highlightTeal',   previewColor: 'var(--hl-teal)',   cssVar: 'var(--hl-teal)'   },
	{ id: 'red',    labelKey: 'editors.highlightRed',    previewColor: 'var(--hl-red)',    cssVar: 'var(--hl-red)'    },
	{ id: 'lime',   labelKey: 'editors.highlightLime',   previewColor: 'var(--hl-lime)',   cssVar: 'var(--hl-lime)'   },
	{ id: 'cyan',   labelKey: 'editors.highlightCyan',   previewColor: 'var(--hl-cyan)',   cssVar: 'var(--hl-cyan)'   },
	{ id: 'rose',   labelKey: 'editors.highlightRose',   previewColor: 'var(--hl-rose)',   cssVar: 'var(--hl-rose)'   },
];

// ── Quick emoji palette ────────────────────────────────────────────────────
// A curated flat list of the most useful emojis for notes and documents.
// Grouped by theme: status, time/reference, thinking/creative, technical, reactions.
const QUICK_EMOJIS: readonly string[] = [
	'✅', '❌', '⚠️', '🚧', '🔥', '⭐', '🛑', '💥',
	'📅', '⏰', '⏳', '📌', '📝', '📋', '🗓️', '🔔',
	'💡', '🧠', '✍️', '🎯', '📊', '📈', '📉', '✨',
	'🔧', '⚡', '🏗️', '📐', '🔍', '🔗', '📎', '🔒',
	'👍', '👎', '💪', '🙌', '🤔', '🎉', '🏆', '💬',
	'🔴', '🟡', '🟢', '🔵', 'ℹ️', '❓', '💰', '🌟',
];

function renderToolbarImageIcon(iconFileName: string): React.JSX.Element {
	if (iconFileName === 'CheckCount.png') {
		return <span className={styles.formatButtonLabel} aria-hidden="true">+1</span>;
	}
	if (iconFileName === 'URL-Preview.png') {
		return <span className={styles.formatButtonMaskIcon} aria-hidden="true" />;
	}
	if (iconFileName === 'autoscroll.png') {
		return <span className={`${styles.formatButtonMaskIcon} ${styles.formatButtonMaskIconAutoScroll}`} aria-hidden="true" />;
	}
	const basePath = import.meta.env.BASE_URL || '/';
	const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`;
	return <img src={`${normalizedBasePath}icons/${iconFileName}`} alt="" aria-hidden="true" className={styles.formatButtonImageIcon} draggable={false} />;
}

export function RichTextToolbar(props: RichTextToolbarProps): React.JSX.Element {
	const { t } = useI18n();
	React.useSyncExternalStore(
		subscribeCollapsedRichHeadingPrefs,
		getCollapsedRichHeadingPrefsSnapshot,
		getCollapsedRichHeadingPrefsSnapshot,
	);
	const resolvedCopyMode = props.copyMode ?? 'rich-text';
	// Toolbar touch tracking:
	// We record the initial touch point so we can distinguish between two very different
	// gestures that both begin on the toolbar on mobile:
	// 1. a horizontal swipe intended to scroll a long toolbar row
	// 2. a vertical drag that browsers may otherwise interpret as viewport scrolling
	// The follow-up move handler uses this snapshot to block only the second case.
	const touchStartRef = React.useRef<{ x: number; y: number; scrollLeft: number } | null>(null);
	const toolbarState = useEditorState({
		editor: props.editor,
		selector: ({ editor }) => {
			const isHighlight = Boolean(editor?.isActive('highlight'));
			const highlightAttrs = isHighlight ? (editor?.getAttributes('highlight') as { color?: unknown } | undefined) : undefined;
			const headingCtx = readActiveHeadingToolbarContext(editor);
			const normalizedHeadingLevel = headingCtx.level;
			const headingCollapseId = headingCtx.collapseId;
			const isCollapsibleHeading = headingCtx.collapsible
				&& normalizedHeadingLevel != null
				&& normalizedHeadingLevel <= 5;
			return {
				canUndo: canRunUndo(editor),
				canRedo: canRunRedo(editor),
				canIndentStructuredBlock: canIndentStructuredBlock(editor),
				canOutdentStructuredBlock: canOutdentStructuredBlock(editor),
				canInsertTable: canRunRichTextCommand(editor, 'insertTable', { rows: 3, cols: 3, withHeaderRow: true }),
				canAddTableColumn: canRunRichTextCommand(editor, 'addColumnAfter'),
				canDeleteTableColumn: canRunRichTextCommand(editor, 'deleteColumn'),
				canAddTableRow: canRunRichTextCommand(editor, 'addRowAfter'),
				canDeleteTableRow: canRunRichTextCommand(editor, 'deleteRow'),
				canDeleteTable: canRunRichTextCommand(editor, 'deleteTable'),
				isBold: Boolean(editor?.isActive('bold')),
				isItalic: Boolean(editor?.isActive('italic')),
				isUnderline: Boolean(editor?.isActive('underline')),
				isStrike: Boolean(editor?.isActive('strike')),
				isLink: Boolean(editor?.isActive('link')),
				isHeading1: Boolean(editor?.isActive('heading', { level: 1 })),
				isHeading2: Boolean(editor?.isActive('heading', { level: 2 })),
				isHeading3: Boolean(editor?.isActive('heading', { level: 3 })),
				isHeading4: Boolean(editor?.isActive('heading', { level: 4 })),
				isHeading5: Boolean(editor?.isActive('heading', { level: 5 })),
				isHeading6: Boolean(editor?.isActive('heading', { level: 6 })),
				activeHeadingLevel: normalizedHeadingLevel,
				isCollapsibleHeading,
				isCollapsedHeading: Boolean(props.collapsibleHeadingNoteId && headingCollapseId && getRichHeadingCollapsed(props.collapsibleHeadingNoteId, headingCollapseId)),
				canToggleHeadingCollapsible: normalizedHeadingLevel != null && normalizedHeadingLevel <= 5 && canRunRichTextCommand(editor, 'toggleHeadingCollapsible'),
				isBulletList: Boolean(editor?.isActive('bulletList')),
				isOrderedList: Boolean(editor?.isActive('orderedList')),
				isTaskList: Boolean(editor?.isActive('taskList')),
				isBlockquote: Boolean(editor?.isActive('blockquote')),
				isCodeBlock: Boolean(editor?.isActive('codeBlock')),
				isTable: Boolean(editor?.isActive('table')),
				isAlignLeft: Boolean(editor?.isActive({ textAlign: 'left' })),
				isAlignCenter: Boolean(editor?.isActive({ textAlign: 'center' })),
				isAlignRight: Boolean(editor?.isActive({ textAlign: 'right' })),
				isHighlight,
				activeHighlightColor: typeof highlightAttrs?.color === 'string' ? highlightAttrs.color : null,
			};
		},
	});
	const resolvedToolbarState = toolbarState ?? {
		canUndo: false,
		canRedo: false,
		canIndentStructuredBlock: false,
		canOutdentStructuredBlock: false,
		canInsertTable: false,
		canAddTableColumn: false,
		canDeleteTableColumn: false,
		canAddTableRow: false,
		canDeleteTableRow: false,
		canDeleteTable: false,
		isBold: false,
		isItalic: false,
		isUnderline: false,
		isStrike: false,
		isLink: false,
		isHeading1: false,
		isHeading2: false,
		isHeading3: false,
		isHeading4: false,
		isHeading5: false,
		isHeading6: false,
		activeHeadingLevel: null,
		isCollapsibleHeading: false,
		isCollapsedHeading: false,
		canToggleHeadingCollapsible: false,
		isBulletList: false,
		isOrderedList: false,
		isTaskList: false,
		isBlockquote: false,
		isCodeBlock: false,
		isTable: false,
		isAlignLeft: false,
		isAlignCenter: false,
		isAlignRight: false,
		isHighlight: false,
		activeHighlightColor: null,
	};
	const canRunPrimaryUndo = props.preferEditorUndoRedo
		? resolvedToolbarState.canUndo || Boolean(props.checkboxUndoAvail)
		: Boolean(props.checkboxUndoAvail) || resolvedToolbarState.canUndo;
	const canRunPrimaryRedo = props.preferEditorUndoRedo
		? resolvedToolbarState.canRedo || Boolean(props.checkboxRedoAvail)
		: Boolean(props.checkboxRedoAvail) || resolvedToolbarState.canRedo;
	const handlePrimaryUndo = React.useCallback((): void => {
		if (props.preferEditorUndoRedo && resolvedToolbarState.canUndo) {
			runUndo(props.editor);
			return;
		}
		if (props.checkboxUndoAvail && props.onUndoCheckbox) {
			props.onUndoCheckbox();
			return;
		}
		runUndo(props.editor);
	}, [props.checkboxUndoAvail, props.editor, props.onUndoCheckbox, props.preferEditorUndoRedo, resolvedToolbarState.canUndo]);
	const handlePrimaryRedo = React.useCallback((): void => {
		if (props.preferEditorUndoRedo && resolvedToolbarState.canRedo) {
			runRedo(props.editor);
			return;
		}
		if (props.checkboxRedoAvail && props.onRedoCheckbox) {
			props.onRedoCheckbox();
			return;
		}
		runRedo(props.editor);
	}, [props.checkboxRedoAvail, props.editor, props.onRedoCheckbox, props.preferEditorUndoRedo, resolvedToolbarState.canRedo]);

	const preventToolbarFocusSteal = React.useCallback((event: React.SyntheticEvent): void => {
		// Keep focus on the active editor so checklist toolbar taps don't blur the
		// row editor before the command executes.
		event.preventDefault();
	}, []);
	const toolbarRowRef = React.useRef<HTMLDivElement | null>(null);
	const headingMenuRef = React.useRef<HTMLDivElement | null>(null);
	const headingMenuButtonRef = React.useRef<HTMLButtonElement | null>(null);
	const tableMenuButtonRef = React.useRef<HTMLButtonElement | null>(null);
	const tableMenuRef = React.useRef<HTMLDivElement | null>(null);
	const highlightMenuButtonRef = React.useRef<HTMLButtonElement | null>(null);
	const highlightMenuRef = React.useRef<HTMLDivElement | null>(null);
	const emojiMenuButtonRef = React.useRef<HTMLButtonElement | null>(null);
	const emojiMenuRef = React.useRef<HTMLDivElement | null>(null);
	const [headingMenuOpen, setHeadingMenuOpen] = React.useState(false);
	const [condensedSection, setCondensedSection] = React.useState<CondensedToolbarSection>(null);
	const [tableMenuOpen, setTableMenuOpen] = React.useState(false);
	const [tableMenuPosition, setTableMenuPosition] = React.useState<{ top: number; left: number } | null>(null);
	const [highlightMenuOpen, setHighlightMenuOpen] = React.useState(false);
	const [highlightMenuPosition, setHighlightMenuPosition] = React.useState<{ top: number; left: number } | null>(null);
	const [emojiMenuOpen, setEmojiMenuOpen] = React.useState(false);
	const [emojiMenuPosition, setEmojiMenuPosition] = React.useState<{ top: number; left: number } | null>(null);
	const [linkMenuOpen, setLinkMenuOpen] = React.useState(false);
	const [linkMenuPosition, setLinkMenuPosition] = React.useState<{ top: number; left: number } | null>(null);
	const [linkUrlInput, setLinkUrlInput] = React.useState('');
	const [linkHeadings, setLinkHeadings] = React.useState<Array<{ text: string; slug: string; level: number }>>([]);
	const linkMenuRef = React.useRef<HTMLDivElement | null>(null);
	const linkUrlInputRef = React.useRef<HTMLInputElement | null>(null);
	const [canScrollToolbarLeft, setCanScrollToolbarLeft] = React.useState(false);
	const [canScrollToolbarRight, setCanScrollToolbarRight] = React.useState(false);
	const updateToolbarScrollState = React.useCallback((): void => {
		const node = toolbarRowRef.current;
		if (!node) {
			setCanScrollToolbarLeft(false);
			setCanScrollToolbarRight(false);
			return;
		}
		setCanScrollToolbarLeft(node.scrollLeft > 4);
		setCanScrollToolbarRight(node.scrollLeft + node.clientWidth < node.scrollWidth - 4);
	}, []);

	const handleToolbarTouchStart = React.useCallback((event: React.TouchEvent): void => {
		// Capture the starting point of the gesture. We intentionally do not call
		// preventDefault here because horizontal toolbar scrolling should remain native.
		const touch = event.touches[0];
		if (!touch) return;
		touchStartRef.current = {
			x: touch.clientX,
			y: touch.clientY,
			scrollLeft: toolbarRowRef.current?.scrollLeft ?? 0,
		};
	}, []);

	const handleToolbarTouchMove = React.useCallback((event: React.TouchEvent): void => {
		const start = touchStartRef.current;
		const touch = event.touches[0];
		if (!start || !touch) return;
		const deltaX = touch.clientX - start.x;
		const dx = Math.abs(deltaX);
		const dy = Math.abs(touch.clientY - start.y);
		const node = toolbarRowRef.current;

		// Horizontal-scroll branch:
		// Drive the row scroll directly so the very first swipe works even when mobile
		// browsers/overlays hesitate to promote the gesture into native horizontal panning.
		if (dx > dy && node && node.scrollWidth > node.clientWidth + 1) {
			if (event.cancelable) event.preventDefault();
			node.scrollLeft = start.scrollLeft - deltaX;
			updateToolbarScrollState();
			return;
		}

		// Vertical-drag branch:
		// If movement is more vertical than horizontal, we treat it as an accidental
		// viewport scroll starting from the toolbar. Canceling it here prevents the
		// editor/page from shifting while preserving horizontal swipes for long toolbars.
		if (dy > dx && event.cancelable) {
			event.preventDefault();
			event.stopPropagation();
		}
	}, []);

	const resetToolbarTouch = React.useCallback((): void => {
		// Gesture cleanup:
		// Clear the cached coordinates on both touch-end and touch-cancel so each new
		// interaction starts with a fresh direction calculation.
		touchStartRef.current = null;
	}, []);

	const stopToolbarPropagation = React.useCallback((event: React.SyntheticEvent): void => {
		// Portal propagation note:
		// Some toolbars are rendered via React portals (e.g. the floating keyboard
		// toolbar in NoteEditor/ChecklistEditor). React events from portals still
		// bubble through the *React* tree to parent components.
		//
		// Our editors use a fullscreen overlay with an onClick "outside" handler to
		// close the editor. Without this stopPropagation, clicking a formatting
		// button is interpreted as a click outside and immediately closes the editor.
		event.stopPropagation();
	}, []);

	const runInlineMarkCommand = React.useCallback((commandName: string): void => {
		applyWholeRowInlineCommand(props.editor, props.applyInlineFormattingToWholeEditor === true, (editor) => {
			const chain = editor.chain().focus() as unknown as Record<string, (() => { run: () => boolean }) | undefined>;
			const command = chain[commandName];
			if (typeof command === 'function') {
				command().run();
			}
		});
	}, [props.applyInlineFormattingToWholeEditor, props.editor]);

	const openLinkMenu = React.useCallback((button: HTMLElement): void => {
		if (!props.editor) return;
		const currentHref = props.editor.getAttributes('link').href as string | undefined;
		setLinkUrlInput(currentHref ?? '');
		// Snapshot headings from the live doc so the list is always current.
		const headings: Array<{ text: string; slug: string; level: number }> = [];
		props.editor.state.doc.descendants((node) => {
			if (node.type.name === 'heading') {
				const text = node.textContent;
				const slug = slugifyHeadingText(text);
				if (slug) headings.push({ text, slug, level: Number(node.attrs.level) });
			}
		});
		setLinkHeadings(headings);
		// Compute position from the trigger button.
		if (typeof window !== 'undefined') {
			const vv = window.visualViewport;
			const vLeft = vv ? Math.round(vv.offsetLeft) : 0;
			const vTop = vv ? Math.round(vv.offsetTop) : 0;
			const vWidth = vv ? Math.round(vv.width) : window.innerWidth;
			// Use the visual viewport height (excludes soft keyboard on mobile) so
			// we can detect when the button is near the bottom of the visible area.
			const vHeight = vv ? Math.round(vv.height) : window.innerHeight;
			const rect = button.getBoundingClientRect();
			const menuWidth = 304;
			const menuEstimatedHeight = 310;
			const left = Math.min(Math.max(vLeft + 8, rect.left), vLeft + vWidth - menuWidth - 8);
			// On mobile the floating toolbar sits just above the keyboard, so
			// there is no room below the button.  Flip the menu upward instead.
			const spaceBelow = vHeight - rect.bottom;
			const top = spaceBelow >= menuEstimatedHeight + 8
				? vTop + rect.bottom + 8
				: Math.max(vTop + 8, vTop + rect.top - menuEstimatedHeight - 8);
			setLinkMenuPosition({ top, left });
		}
		setLinkMenuOpen(true);
		requestAnimationFrame(() => linkUrlInputRef.current?.select());
	}, [props.editor]);

	const applyLinkUrl = React.useCallback((): void => {
		if (!props.editor) return;
		const url = linkUrlInput.trim();
		if (!url) return;
		applyWholeRowInlineCommand(props.editor, props.applyInlineFormattingToWholeEditor === true, (editor) => {
			editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
		});
		setLinkMenuOpen(false);
	}, [props.editor, props.applyInlineFormattingToWholeEditor, linkUrlInput]);

	const applyHeadingAnchor = React.useCallback((slug: string, headingText: string): void => {
		if (!props.editor) return;
		const href = `#${slug}`;
		applyWholeRowInlineCommand(props.editor, props.applyInlineFormattingToWholeEditor === true, (editor) => {
			const { from, to } = editor.state.selection;
			if (from === to) {
				// No text selected — insert the heading text as linked text.
				editor.chain().focus().insertContent([{
					type: 'text',
					text: headingText,
					marks: [{ type: 'link', attrs: { href, target: null, rel: 'noopener noreferrer nofollow', class: null } }],
				}]).run();
			} else {
				editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
			}
		});
		setLinkMenuOpen(false);
	}, [props.editor, props.applyInlineFormattingToWholeEditor]);

	const setLink = React.useCallback((e: React.MouseEvent<HTMLButtonElement>): void => {
		if (!props.editor) return;
		if (props.editor.isActive('link')) {
			applyWholeRowInlineCommand(props.editor, props.applyInlineFormattingToWholeEditor === true, (editor) => {
				editor.chain().focus().unsetLink().run();
			});
			return;
		}
		openLinkMenu(e.currentTarget);
	}, [props.applyInlineFormattingToWholeEditor, props.editor, openLinkMenu]);

	const applyHighlightColor = React.useCallback((cssVar: string | null): void => {
		applyWholeRowInlineCommand(props.editor, props.applyInlineFormattingToWholeEditor === true, (editor) => {
			const isActive = cssVar === null
				? Boolean(editor.isActive('highlight')) && !editor.getAttributes('highlight').color
				: editor.isActive('highlight', { color: cssVar });
			if (isActive) {
				editor.chain().focus().unsetHighlight().run();
				return;
			}
			const chain = editor.chain().focus() as unknown as { setHighlight?: (opts?: { color?: string }) => { run: () => boolean } };
			if (typeof chain.setHighlight === 'function') {
				if (cssVar === null) {
					chain.setHighlight({}).run();
				} else {
					chain.setHighlight({ color: cssVar }).run();
				}
			}
		});
	}, [props.applyInlineFormattingToWholeEditor, props.editor]);

	const clearHighlight = React.useCallback((): void => {
		applyWholeRowInlineCommand(props.editor, props.applyInlineFormattingToWholeEditor === true, (editor) => {
			editor.chain().focus().unsetHighlight().run();
		});
	}, [props.applyInlineFormattingToWholeEditor, props.editor]);
	const handleToolbarWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>): void => {
		const node = toolbarRowRef.current;
		if (!node) return;
		if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
		if (node.scrollWidth <= node.clientWidth + 1) return;
		event.preventDefault();
		node.scrollLeft += event.deltaY;
		updateToolbarScrollState();
	}, [updateToolbarScrollState]);
	const scrollToolbarBy = React.useCallback((delta: number): void => {
		const node = toolbarRowRef.current;
		if (!node) return;
		node.scrollBy({ left: delta, behavior: 'smooth' });
	}, []);
	const updateTableMenuPosition = React.useCallback((): void => {
		const button = tableMenuButtonRef.current;
		if (!button || typeof window === 'undefined') {
			setTableMenuPosition(null);
			return;
		}
		// Anchor against the visual viewport so the floating table menu stays on-screen
		// on mobile keyboards, zoomed layouts, and desktop scroll containers alike.
		const visualViewport = window.visualViewport;
		const viewportLeft = visualViewport ? Math.round(visualViewport.offsetLeft) : 0;
		const viewportTop = visualViewport ? Math.round(visualViewport.offsetTop) : 0;
		const viewportWidth = visualViewport ? Math.round(visualViewport.width) : window.innerWidth;
		const viewportHeight = visualViewport ? Math.round(visualViewport.height) : window.innerHeight;
		const viewportRight = viewportLeft + viewportWidth;
		const viewportBottom = viewportTop + viewportHeight;
		const rect = button.getBoundingClientRect();
		const menuWidth = 180;
		const menuHeight = 232;
		const viewportPadding = 12;
		const left = Math.min(
			Math.max(viewportLeft + viewportPadding, rect.right - menuWidth),
			viewportRight - menuWidth - viewportPadding,
		);
		const preferredTop = rect.bottom + 8;
		const fitsBelow = preferredTop + menuHeight <= viewportBottom - viewportPadding;
		const top = fitsBelow
			? preferredTop
			: Math.max(viewportTop + viewportPadding, rect.top - menuHeight - 8);
		setTableMenuPosition({
			top,
			left,
		});
	}, []);
	const updateHighlightMenuPosition = React.useCallback((): void => {
		const button = highlightMenuButtonRef.current;
		if (!button || typeof window === 'undefined') {
			setHighlightMenuPosition(null);
			return;
		}
		const visualViewport = window.visualViewport;
		const viewportLeft = visualViewport ? Math.round(visualViewport.offsetLeft) : 0;
		const viewportTop = visualViewport ? Math.round(visualViewport.offsetTop) : 0;
		const viewportWidth = visualViewport ? Math.round(visualViewport.width) : window.innerWidth;
		const viewportHeight = visualViewport ? Math.round(visualViewport.height) : window.innerHeight;
		const viewportRight = viewportLeft + viewportWidth;
		const viewportBottom = viewportTop + viewportHeight;
		const rect = button.getBoundingClientRect();
		const menuWidth = 218;
		const menuHeight = 88;
		const viewportPadding = 8;
		const left = Math.min(
			Math.max(viewportLeft + viewportPadding, rect.left),
			viewportRight - menuWidth - viewportPadding,
		);
		const preferredTop = rect.bottom + 8;
		const fitsBelow = preferredTop + menuHeight <= viewportBottom - viewportPadding;
		const top = fitsBelow
			? preferredTop
			: Math.max(viewportTop + viewportPadding, rect.top - menuHeight - 8);
		setHighlightMenuPosition({ top, left });
	}, []);
	const updateEmojiMenuPosition = React.useCallback((): void => {
		const button = emojiMenuButtonRef.current;
		if (!button || typeof window === 'undefined') {
			setEmojiMenuPosition(null);
			return;
		}
		const visualViewport = window.visualViewport;
		const viewportLeft = visualViewport ? Math.round(visualViewport.offsetLeft) : 0;
		const viewportTop = visualViewport ? Math.round(visualViewport.offsetTop) : 0;
		const viewportWidth = visualViewport ? Math.round(visualViewport.width) : window.innerWidth;
		const viewportHeight = visualViewport ? Math.round(visualViewport.height) : window.innerHeight;
		const viewportRight = viewportLeft + viewportWidth;
		const viewportBottom = viewportTop + viewportHeight;
		const rect = button.getBoundingClientRect();
		const measuredMenuWidth = emojiMenuRef.current?.offsetWidth ?? 0;
		const measuredMenuHeight = emojiMenuRef.current?.offsetHeight ?? 0;
		const menuWidth = Math.max(264, measuredMenuWidth);
		const menuHeight = Math.max(210, measuredMenuHeight);
		const viewportPadding = 8;
		const left = Math.min(
			Math.max(viewportLeft + viewportPadding, rect.left),
			viewportRight - menuWidth - viewportPadding,
		);
		const preferredTop = rect.bottom + 8;
		const fitsBelow = preferredTop + menuHeight <= viewportBottom - viewportPadding;
		const top = fitsBelow
			? preferredTop
			: Math.max(viewportTop + viewportPadding, rect.top - menuHeight - 8);
		setEmojiMenuPosition({ top, left });
	}, []);
	const runTableMenuCommand = React.useCallback((commandName: string, ...args: unknown[]): void => {
		runRichTextCommand(props.editor, commandName, ...args);
		setTableMenuOpen(false);
	}, [props.editor]);
	const runHeadingCommand = React.useCallback((level: 1 | 2 | 3 | 4 | 5 | 6): void => {
		props.editor?.chain().focus().toggleHeading({ level }).run();
		setHeadingMenuOpen(false);
		if (props.variant === 'full' && props.toolbarMode === 'condensed') {
			setCondensedSection('headings');
		}
	}, [props.editor, props.toolbarMode, props.variant]);
	React.useEffect(() => {
		updateToolbarScrollState();
		const node = toolbarRowRef.current;
		if (!node) return;
		const handleScroll = (): void => updateToolbarScrollState();
		node.addEventListener('scroll', handleScroll, { passive: true });
		const resizeObserver = new ResizeObserver(() => updateToolbarScrollState());
		resizeObserver.observe(node);
		if (node.parentElement) resizeObserver.observe(node.parentElement);
		return () => {
			node.removeEventListener('scroll', handleScroll);
			resizeObserver.disconnect();
		};
	}, [updateToolbarScrollState, props.variant, props.compact]);
	React.useEffect(() => {
		if (!headingMenuOpen) return;
		const handlePointerDown = (event: PointerEvent): void => {
			const target = event.target as Node | null;
			if (!target) return;
			if (headingMenuRef.current?.contains(target)) return;
			if (headingMenuButtonRef.current?.contains(target)) return;
			setHeadingMenuOpen(false);
		};
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') setHeadingMenuOpen(false);
		};
		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [headingMenuOpen]);
	React.useEffect(() => {
		if (!tableMenuOpen) return;
		updateTableMenuPosition();
		const handlePointerDown = (event: PointerEvent): void => {
			const target = event.target as Node | null;
			if (!target) return;
			if (tableMenuRef.current?.contains(target)) return;
			if (tableMenuButtonRef.current?.contains(target)) return;
			setTableMenuOpen(false);
		};
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') setTableMenuOpen(false);
		};
		const handleViewportChange = (): void => updateTableMenuPosition();
		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		window.addEventListener('resize', handleViewportChange);
		window.addEventListener('scroll', handleViewportChange, true);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('resize', handleViewportChange);
			window.removeEventListener('scroll', handleViewportChange, true);
		};
	}, [tableMenuOpen, updateTableMenuPosition]);
	React.useEffect(() => {
		if (!highlightMenuOpen) return;
		updateHighlightMenuPosition();
		const handlePointerDown = (event: PointerEvent): void => {
			const target = event.target as Node | null;
			if (!target) return;
			if (highlightMenuRef.current?.contains(target)) return;
			if (highlightMenuButtonRef.current?.contains(target)) return;
			setHighlightMenuOpen(false);
		};
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') setHighlightMenuOpen(false);
		};
		const handleViewportChange = (): void => updateHighlightMenuPosition();
		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		window.addEventListener('resize', handleViewportChange);
		window.addEventListener('scroll', handleViewportChange, true);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('resize', handleViewportChange);
			window.removeEventListener('scroll', handleViewportChange, true);
		};
	}, [highlightMenuOpen, updateHighlightMenuPosition]);
	React.useEffect(() => {
		if (!emojiMenuOpen) return;
		updateEmojiMenuPosition();
		const handlePointerDown = (event: PointerEvent): void => {
			const target = event.target as Node | null;
			if (!target) return;
			if (emojiMenuRef.current?.contains(target)) return;
			if (emojiMenuButtonRef.current?.contains(target)) return;
			setEmojiMenuOpen(false);
		};
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') setEmojiMenuOpen(false);
		};
		const handleViewportChange = (): void => updateEmojiMenuPosition();
		const visualViewport = window.visualViewport;
		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		window.addEventListener('resize', handleViewportChange);
		window.addEventListener('scroll', handleViewportChange, true);
		visualViewport?.addEventListener('resize', handleViewportChange);
		visualViewport?.addEventListener('scroll', handleViewportChange);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('resize', handleViewportChange);
			window.removeEventListener('scroll', handleViewportChange, true);
			visualViewport?.removeEventListener('resize', handleViewportChange);
			visualViewport?.removeEventListener('scroll', handleViewportChange);
		};
	}, [emojiMenuOpen, updateEmojiMenuPosition]);
	React.useEffect(() => {
		if (!linkMenuOpen) return;
		const handlePointerDown = (event: PointerEvent): void => {
			const target = event.target as Node | null;
			if (!target || linkMenuRef.current?.contains(target)) return;
			setLinkMenuOpen(false);
		};
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') setLinkMenuOpen(false);
		};
		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [linkMenuOpen]);

	const noEditor = !props.editor;
	const compactButtonClass = props.compact ? ` ${styles.formatButtonCompact}` : '';
	const primaryToolbarButtonClass = props.variant === 'minimal' ? ` ${styles.formatButtonCondensed}` : compactButtonClass;
	const activeHeadingLabel = resolvedToolbarState.isHeading1 ? 'H1'
		: resolvedToolbarState.isHeading2 ? 'H2'
		: resolvedToolbarState.isHeading3 ? 'H3'
		: resolvedToolbarState.isHeading4 ? 'H4'
		: resolvedToolbarState.isHeading5 ? 'H5'
		: resolvedToolbarState.isHeading6 ? 'H6'
		: t('editors.headingMenu');
	const noteAutoScrollLabel = props.noteAutoScrollEnabled
		? t('editors.disableNoteAutoScroll')
		: t('editors.enableNoteAutoScroll');
	const headingCollapseToggleLabel = resolvedToolbarState.isCollapsibleHeading ? 'Disable collapsible section' : 'Enable collapsible section';
	const isCondensedToolbar = props.variant === 'full' && props.toolbarMode === 'condensed';
	// Minimal/mobile toolbars do not render the full list/blockquote section, so
	// surface nest/outdent only when the current selection is already inside a
	// structured context that can actually be deepened or lifted.
	const showStructuredNestingButtons = resolvedToolbarState.canIndentStructuredBlock
		|| resolvedToolbarState.canOutdentStructuredBlock
		|| resolvedToolbarState.isBulletList
		|| resolvedToolbarState.isOrderedList
		|| resolvedToolbarState.isTaskList
		|| resolvedToolbarState.isBlockquote;
	// In condensed mode, the top-level toggles need to reflect both which panel is
	// open and whether the current selection already uses that formatting family.
	const hasActiveFormattingSection = resolvedToolbarState.isBold
		|| resolvedToolbarState.isItalic
		|| resolvedToolbarState.isUnderline
		|| resolvedToolbarState.isStrike
		|| resolvedToolbarState.isLink
		|| resolvedToolbarState.isHighlight;
	const hasActiveHeadingSection = resolvedToolbarState.isHeading1
		|| resolvedToolbarState.isHeading2
		|| resolvedToolbarState.isHeading3
		|| resolvedToolbarState.isHeading4
		|| resolvedToolbarState.isHeading5
		|| resolvedToolbarState.isHeading6;
	const hasActiveCollapsibleHeadingSection = resolvedToolbarState.isHeading1
		|| resolvedToolbarState.isHeading2
		|| resolvedToolbarState.isHeading3
		|| resolvedToolbarState.isHeading4
		|| resolvedToolbarState.isHeading5;
	const showHeadingCollapseToggle = props.variant === 'full' && (
		(resolvedToolbarState.activeHeadingLevel != null && resolvedToolbarState.activeHeadingLevel <= 5)
		|| (isCondensedToolbar && condensedSection === 'headings')
		|| hasActiveCollapsibleHeadingSection
	);
	const hasActiveListSection = resolvedToolbarState.isBulletList
		|| resolvedToolbarState.isOrderedList
		|| resolvedToolbarState.isTaskList
		|| resolvedToolbarState.isBlockquote;
	const hasActiveInsertSection = resolvedToolbarState.isCodeBlock || resolvedToolbarState.isTable;
	const hasActiveLayoutSection = resolvedToolbarState.isAlignCenter || resolvedToolbarState.isAlignRight;
	// Coarse-pointer devices hide the explicit scroll buttons, so expose an edge
	// hint only when the full toolbar actually overflows horizontally.
	const showToolbarScrollHint = props.variant === 'full' && !isCondensedToolbar;
	const showStrikeButton = props.variant === 'full' && props.hideStrikeButton !== true;
	// Sub-toolbar buttons in condensed mode are slightly larger than in full-mode for
	// better tap target size on mobile.
	const condensedSubButtonClass = isCondensedToolbar ? ` ${styles.formatButtonCondensed}` : compactButtonClass;
	const toggleCondensedSection = React.useCallback((section: Exclude<CondensedToolbarSection, null>): void => {
		setCondensedSection((current) => (current === section ? null : section));
	}, []);
	const handleToggleHeadingCollapsible = React.useCallback((): void => {
		runRichTextCommand(props.editor, 'toggleHeadingCollapsible');
	}, [props.editor]);
	// Condensed mode keeps the primary row short on mobile and exposes one grouped
	// secondary section at a time so the command set stays identical to full mode.
	const condensedSectionContent = isCondensedToolbar
		? (() => {
			switch (condensedSection) {
				case 'formatting':
					return (
						<>
							<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}${resolvedToolbarState.isBold ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.bold')} title={t('editors.bold')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runInlineMarkCommand('toggleBold')}>
								<FontAwesomeIcon icon={faBold} />
							</button>
							<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}${resolvedToolbarState.isItalic ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.italic')} title={t('editors.italic')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runInlineMarkCommand('toggleItalic')}>
								<FontAwesomeIcon icon={faItalic} />
							</button>
							<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}${resolvedToolbarState.isUnderline ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.underline')} title={t('editors.underline')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runInlineMarkCommand('toggleUnderline')}>
								<FontAwesomeIcon icon={faUnderline} />
							</button>
							{showStrikeButton ? (
								<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}${resolvedToolbarState.isStrike ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.strikethrough')} title={t('editors.strikethrough')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runInlineMarkCommand('toggleStrike')}>
									<FontAwesomeIcon icon={faStrikethrough} />
								</button>
							) : null}
							<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}${resolvedToolbarState.isLink ? ` ${styles.formatButtonActive}` : ''}`} aria-label={resolvedToolbarState.isLink ? t('editors.removeLink') : t('editors.link')} title={resolvedToolbarState.isLink ? t('editors.removeLink') : t('editors.link')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={setLink}>
								<FontAwesomeIcon icon={faLink} />
							</button>
							<div className={styles.formatMenuAnchor}>
								<button
									ref={highlightMenuButtonRef}
									type="button"
									className={`${styles.formatButton}${condensedSubButtonClass}${resolvedToolbarState.isHighlight || highlightMenuOpen ? ` ${styles.formatButtonActive}` : ''}`}
									aria-label={t('editors.highlight')}
									title={t('editors.highlight')}
									aria-expanded={highlightMenuOpen}
									onMouseDown={preventToolbarFocusSteal}
									onPointerDown={preventToolbarFocusSteal}
									onClick={() => {
										updateHighlightMenuPosition();
										setHighlightMenuOpen((open) => !open);
									}}
								>
									<FontAwesomeIcon icon={faHighlighter} />
								</button>
							</div>
						</>
					);
				case 'headings':
					return (
						<>
							<button type="button" className={`${styles.headingToolbarButton}${props.compact ? ` ${styles.headingToolbarButtonCompact}` : ''}${resolvedToolbarState.isHeading1 ? ` ${styles.headingToolbarButtonActive}` : ''}`} aria-label={t('editors.heading1')} title={t('editors.heading1')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runHeadingCommand(1)}>H1</button>
							<button type="button" className={`${styles.headingToolbarButton}${props.compact ? ` ${styles.headingToolbarButtonCompact}` : ''}${resolvedToolbarState.isHeading2 ? ` ${styles.headingToolbarButtonActive}` : ''}`} aria-label={t('editors.heading2')} title={t('editors.heading2')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runHeadingCommand(2)}>H2</button>
							<button type="button" className={`${styles.headingToolbarButton}${props.compact ? ` ${styles.headingToolbarButtonCompact}` : ''}${resolvedToolbarState.isHeading3 ? ` ${styles.headingToolbarButtonActive}` : ''}`} aria-label={t('editors.heading3')} title={t('editors.heading3')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runHeadingCommand(3)}>H3</button>
							<button type="button" className={`${styles.headingToolbarButton}${props.compact ? ` ${styles.headingToolbarButtonCompact}` : ''}${resolvedToolbarState.isHeading4 ? ` ${styles.headingToolbarButtonActive}` : ''}`} aria-label={t('editors.heading4')} title={t('editors.heading4')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runHeadingCommand(4)}>H4</button>
							<button type="button" className={`${styles.headingToolbarButton}${props.compact ? ` ${styles.headingToolbarButtonCompact}` : ''}${resolvedToolbarState.isHeading5 ? ` ${styles.headingToolbarButtonActive}` : ''}`} aria-label={t('editors.heading5')} title={t('editors.heading5')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runHeadingCommand(5)}>H5</button>
							<button type="button" className={`${styles.headingToolbarButton}${props.compact ? ` ${styles.headingToolbarButtonCompact}` : ''}${resolvedToolbarState.isHeading6 ? ` ${styles.headingToolbarButtonActive}` : ''}`} aria-label={t('editors.heading6')} title={t('editors.heading6')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runHeadingCommand(6)}>H6</button>
							{showHeadingCollapseToggle ? (
								<button
									type="button"
									className={`${styles.headingToolbarButton}${props.compact ? ` ${styles.headingToolbarButtonCompact}` : ''}${resolvedToolbarState.isCollapsibleHeading ? ` ${styles.headingToolbarButtonActive}` : ''}`}
									aria-label={headingCollapseToggleLabel}
									title={headingCollapseToggleLabel}
									onMouseDown={preventToolbarFocusSteal}
									onPointerDown={preventToolbarFocusSteal}
									onClick={handleToggleHeadingCollapsible}
									disabled={!resolvedToolbarState.canToggleHeadingCollapsible}
								>
									<span className={`${styles.formatButtonMaskIcon} ${styles.formatButtonMaskIconHeadingCollapse}`} aria-hidden="true" />
								</button>
							) : null}
						</>
					);
				case 'lists':
					return (
						<>
							<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}${resolvedToolbarState.isBulletList ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.bulletedList')} title={t('editors.bulletedList')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().toggleBulletList().run()}>
								<FontAwesomeIcon icon={faListUl} />
							</button>
							<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}${resolvedToolbarState.isOrderedList ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.numberedList')} title={t('editors.numberedList')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().toggleOrderedList().run()}>
								<FontAwesomeIcon icon={faListOl} />
							</button>
							<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}${resolvedToolbarState.isTaskList ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.taskList')} title={t('editors.taskList')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runRichTextCommand(props.editor, 'toggleTaskList')}>
								<FontAwesomeIcon icon={faListCheck} />
							</button>
							<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}${resolvedToolbarState.isBlockquote ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.blockquote')} title={t('editors.blockquote')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runRichTextCommand(props.editor, 'toggleBlockquote')}>
								<FontAwesomeIcon icon={faQuoteLeft} />
							</button>
							<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}`} aria-label={t('editors.nestContent')} title={t('editors.nestContent')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => indentStructuredBlock(props.editor)} disabled={!resolvedToolbarState.canIndentStructuredBlock}>
								<FontAwesomeIcon icon={faIndent} />
							</button>
							<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}`} aria-label={t('editors.outdentContent')} title={t('editors.outdentContent')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => outdentStructuredBlock(props.editor)} disabled={!resolvedToolbarState.canOutdentStructuredBlock}>
								<FontAwesomeIcon icon={faOutdent} />
							</button>
						</>
					);
				case 'insert':
					return (
						<>
							<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}${resolvedToolbarState.isCodeBlock ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.codeBlock')} title={t('editors.codeBlock')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runRichTextCommand(props.editor, 'toggleCodeBlock')}>
								<FontAwesomeIcon icon={faCode} />
							</button>
							<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}`} aria-label={t('editors.horizontalRule')} title={t('editors.horizontalRule')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runRichTextCommand(props.editor, 'setHorizontalRule')}>
								<FontAwesomeIcon icon={faMinus} />
							</button>
							<div className={styles.formatMenuAnchor}>
								<button
									ref={tableMenuButtonRef}
									type="button"
									className={`${styles.formatButton}${condensedSubButtonClass}${resolvedToolbarState.isTable || tableMenuOpen ? ` ${styles.formatButtonActive}` : ''}`}
									aria-label={t('editors.tableMenu')}
									title={t('editors.tableMenu')}
									aria-expanded={tableMenuOpen}
									onMouseDown={preventToolbarFocusSteal}
									onPointerDown={preventToolbarFocusSteal}
									onClick={() => {
										updateTableMenuPosition();
										setTableMenuOpen((open) => !open);
									}}
								>
									<FontAwesomeIcon icon={faTable} />
								</button>
							</div>
							<div className={styles.formatMenuAnchor}>
								<button
									ref={emojiMenuButtonRef}
									type="button"
									className={`${styles.formatButton}${condensedSubButtonClass}${emojiMenuOpen ? ` ${styles.formatButtonActive}` : ''}`}
									aria-label={t('editors.emojiPicker')}
									title={t('editors.emojiPicker')}
									aria-expanded={emojiMenuOpen}
									onMouseDown={preventToolbarFocusSteal}
									onPointerDown={preventToolbarFocusSteal}
									onClick={() => {
										updateEmojiMenuPosition();
										setEmojiMenuOpen((open) => !open);
									}}
								>
									<FontAwesomeIcon icon={faFaceSmile} />
								</button>
							</div>
							{props.onCreateUrlPreview ? (
								<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}`} aria-label={t('editors.urlPreview')} title={t('editors.urlPreview')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={props.onCreateUrlPreview}>
									{renderToolbarImageIcon('URL-Preview.png')}
								</button>
							) : null}
						</>
					);
				case 'layout':
					return (
						<>
							<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}${resolvedToolbarState.isAlignLeft ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.alignLeft')} title={t('editors.alignLeft')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().setTextAlign('left').run()}>
								<FontAwesomeIcon icon={faAlignLeft} />
							</button>
							<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}${resolvedToolbarState.isAlignCenter ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.alignCenter')} title={t('editors.alignCenter')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().setTextAlign('center').run()}>
								<FontAwesomeIcon icon={faAlignCenter} />
							</button>
							<button type="button" className={`${styles.formatButton}${condensedSubButtonClass}${resolvedToolbarState.isAlignRight ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.alignRight')} title={t('editors.alignRight')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().setTextAlign('right').run()}>
								<FontAwesomeIcon icon={faAlignRight} />
							</button>
						</>
					);
				case 'copy':
					return (
						<div className={styles.copyModeToggleGroup} role="group" aria-label={t('editors.copyMode')}>
							<button
								type="button"
								className={`${styles.copyModeToggleButton}${props.compact ? ` ${styles.copyModeToggleButtonCompact}` : ''}${resolvedCopyMode === 'markdown' ? ` ${styles.copyModeToggleButtonActive}` : ''}`}
								aria-label={t('editors.copyModeMarkdownToast')}
								aria-pressed={resolvedCopyMode === 'markdown'}
								title={t('editors.copyModeMarkdownToast')}
								onMouseDown={preventToolbarFocusSteal}
								onPointerDown={preventToolbarFocusSteal}
								onClick={() => props.onCopyModeChange?.('markdown')}
							>
								{t('editors.copyMarkdown')}
							</button>
							<button
								type="button"
								className={`${styles.copyModeToggleButton}${props.compact ? ` ${styles.copyModeToggleButtonCompact}` : ''}${resolvedCopyMode === 'rich-text' ? ` ${styles.copyModeToggleButtonActive}` : ''}`}
								aria-label={t('editors.copyModeRichTextToast')}
								aria-pressed={resolvedCopyMode === 'rich-text'}
								title={t('editors.copyModeRichTextToast')}
								onMouseDown={preventToolbarFocusSteal}
								onPointerDown={preventToolbarFocusSteal}
								onClick={() => props.onCopyModeChange?.('rich-text')}
							>
								{t('editors.copyRichText')}
							</button>
						</div>
					);
				default:
					return null;
			}
		})()
		: null;
	React.useEffect(() => {
		if (!isCondensedToolbar) {
			setCondensedSection(null);
			return;
		}
		setHeadingMenuOpen(false);
	}, [isCondensedToolbar]);
	React.useEffect(() => {
		if (!isCondensedToolbar) return;
		if (condensedSection !== 'insert') {
			setTableMenuOpen(false);
			setEmojiMenuOpen(false);
		}
		if (condensedSection !== 'formatting') {
			setHighlightMenuOpen(false);
		}
	}, [condensedSection, isCondensedToolbar]);

	return (
		<div className={styles.formatToolbarStack}>
			<div
				className={`${styles.formatToolbar}${props.compact ? ` ${styles.formatToolbarCompact}` : ''}${noEditor ? ` ${styles.formatToolbarDisabled}` : ''}`}
				role="toolbar"
				aria-label={t('editors.formatting')}
				onPointerDown={stopToolbarPropagation}
				onMouseDown={stopToolbarPropagation}
				onClick={stopToolbarPropagation}
				onTouchStartCapture={handleToolbarTouchStart}
				onTouchMoveCapture={handleToolbarTouchMove}
				onTouchEndCapture={resetToolbarTouch}
				onTouchCancelCapture={resetToolbarTouch}
			>
				<div
					className={[
						styles.formatToolbarScroller,
						showToolbarScrollHint && canScrollToolbarLeft ? styles.formatToolbarScrollerHintLeft : '',
						showToolbarScrollHint && canScrollToolbarRight ? styles.formatToolbarScrollerHintRight : '',
					]
						.filter(Boolean)
						.join(' ')}
				>
				<button
					type="button"
					className={`${styles.formatToolbarScrollButton}${canScrollToolbarLeft ? '' : ` ${styles.formatToolbarScrollButtonHidden}`}`}
					aria-label={t('editors.scrollToolbarLeft')}
					title={t('editors.scrollToolbarLeft')}
					onMouseDown={preventToolbarFocusSteal}
					onPointerDown={preventToolbarFocusSteal}
					onClick={() => scrollToolbarBy(-220)}
					disabled={!canScrollToolbarLeft}
				>
					<FontAwesomeIcon icon={faChevronLeft} />
				</button>
				<div ref={toolbarRowRef} className={styles.formatToolbarRow} onWheel={handleToolbarWheel}>
				<button type="button" className={`${styles.formatButton}${primaryToolbarButtonClass}`} aria-label={t('editors.undo')} title={t('editors.undo')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={handlePrimaryUndo} disabled={!canRunPrimaryUndo}>
					<FontAwesomeIcon icon={faRotateLeft} />
				</button>
				<button type="button" className={`${styles.formatButton}${primaryToolbarButtonClass}`} aria-label={t('editors.redo')} title={t('editors.redo')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={handlePrimaryRedo} disabled={!canRunPrimaryRedo}>
					<FontAwesomeIcon icon={faRotateRight} />
				</button>
				<div className={styles.formatDivider} aria-hidden="true" />
				{!isCondensedToolbar ? (
					<>
						{props.onRemoveChecklistCount ? (
							<button type="button" className={`${styles.formatButton}${primaryToolbarButtonClass}`} aria-label={t('editors.removeCountItem')} title={t('editors.removeCountItem')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={props.onRemoveChecklistCount}>
								<FontAwesomeIcon icon={faSquareCheck} />
							</button>
						) : null}
						{props.onMakeChecklistCount ? (
							<button type="button" className={`${styles.formatButton}${primaryToolbarButtonClass}`} aria-label={t('editors.makeCountItem')} title={t('editors.makeCountItem')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={props.onMakeChecklistCount}>
								{renderToolbarImageIcon('CheckCount.png')}
							</button>
						) : null}
						{props.onIncrementChecklistCount ? (
							<button type="button" className={`${styles.formatButton}${primaryToolbarButtonClass}`} aria-label={t('editors.incrementCountItem')} title={t('editors.incrementCountItem')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={props.onIncrementChecklistCount}>
								<FontAwesomeIcon icon={faPlus} />
							</button>
						) : null}
						{props.onDecrementChecklistCount ? (
							<button type="button" className={`${styles.formatButton}${primaryToolbarButtonClass}`} aria-label={t('editors.decrementCountItem')} title={t('editors.decrementCountItem')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={props.onDecrementChecklistCount}>
								<FontAwesomeIcon icon={faMinus} />
							</button>
						) : null}
						<button type="button" className={`${styles.formatButton}${primaryToolbarButtonClass}${resolvedToolbarState.isBold ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.bold')} title={t('editors.bold')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runInlineMarkCommand('toggleBold')}>
							<FontAwesomeIcon icon={faBold} />
						</button>
						<button type="button" className={`${styles.formatButton}${primaryToolbarButtonClass}${resolvedToolbarState.isItalic ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.italic')} title={t('editors.italic')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runInlineMarkCommand('toggleItalic')}>
							<FontAwesomeIcon icon={faItalic} />
						</button>
						<button type="button" className={`${styles.formatButton}${primaryToolbarButtonClass}${resolvedToolbarState.isUnderline ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.underline')} title={t('editors.underline')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runInlineMarkCommand('toggleUnderline')}>
							<FontAwesomeIcon icon={faUnderline} />
						</button>
						{showStrikeButton ? (
							<button type="button" className={`${styles.formatButton}${primaryToolbarButtonClass}${resolvedToolbarState.isStrike ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.strikethrough')} title={t('editors.strikethrough')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runInlineMarkCommand('toggleStrike')}>
								<FontAwesomeIcon icon={faStrikethrough} />
							</button>
						) : null}
						<button type="button" className={`${styles.formatButton}${primaryToolbarButtonClass}${resolvedToolbarState.isLink ? ` ${styles.formatButtonActive}` : ''}`} aria-label={resolvedToolbarState.isLink ? t('editors.removeLink') : t('editors.link')} title={resolvedToolbarState.isLink ? t('editors.removeLink') : t('editors.link')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={setLink}>
							<FontAwesomeIcon icon={faLink} />
						</button>
						{props.variant !== 'full' ? (
							<div className={styles.formatMenuAnchor}>
								<button
									ref={highlightMenuButtonRef}
									type="button"
									className={`${styles.formatButton}${primaryToolbarButtonClass}${resolvedToolbarState.isHighlight || highlightMenuOpen ? ` ${styles.formatButtonActive}` : ''}`}
									aria-label={t('editors.highlight')}
									title={t('editors.highlight')}
									aria-expanded={highlightMenuOpen}
									onMouseDown={preventToolbarFocusSteal}
									onPointerDown={preventToolbarFocusSteal}
									onClick={() => {
										updateHighlightMenuPosition();
										setHighlightMenuOpen((open) => !open);
									}}
								>
									<FontAwesomeIcon icon={faHighlighter} />
								</button>
							</div>
						) : null}
						{/* Emoji quick-insert — available in all toolbar variants */}
						<div className={styles.formatMenuAnchor}>
							<button
								ref={emojiMenuButtonRef}
								type="button"
								className={`${styles.formatButton}${primaryToolbarButtonClass}${emojiMenuOpen ? ` ${styles.formatButtonActive}` : ''}`}
								aria-label={t('editors.emojiPicker')}
								title={t('editors.emojiPicker')}
								aria-expanded={emojiMenuOpen}
								onMouseDown={preventToolbarFocusSteal}
								onPointerDown={preventToolbarFocusSteal}
								onClick={() => {
									updateEmojiMenuPosition();
									setEmojiMenuOpen((open) => !open);
								}}
							>
								<FontAwesomeIcon icon={faFaceSmile} />
							</button>
						</div>
						{props.onCreateUrlPreview ? (
							<button type="button" className={`${styles.formatButton}${primaryToolbarButtonClass}`} aria-label={t('editors.urlPreview')} title={t('editors.urlPreview')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={props.onCreateUrlPreview}>
								{renderToolbarImageIcon('URL-Preview.png')}
							</button>
						) : null}
						{props.onToggleNoteAutoScroll ? (
							<button
								type="button"
								className={`${styles.formatButton}${primaryToolbarButtonClass}${props.noteAutoScrollEnabled ? ` ${styles.formatButtonActive}` : ''}`}
								aria-label={noteAutoScrollLabel}
								aria-pressed={props.noteAutoScrollEnabled}
								title={noteAutoScrollLabel}
								onMouseDown={preventToolbarFocusSteal}
								onPointerDown={preventToolbarFocusSteal}
								onClick={props.onToggleNoteAutoScroll}
							>
								{renderToolbarImageIcon('autoscroll.png')}
							</button>
						) : null}
					</>
				) : null}
				{props.variant !== 'full' && showStructuredNestingButtons ? (
					<>
						<button
							type="button"
							className={`${styles.formatButton}${primaryToolbarButtonClass}`}
							aria-label={t('editors.nestContent')}
							title={t('editors.nestContent')}
							onMouseDown={preventToolbarFocusSteal}
							onPointerDown={preventToolbarFocusSteal}
							onClick={() => indentStructuredBlock(props.editor)}
							disabled={!resolvedToolbarState.canIndentStructuredBlock}
						>
							<FontAwesomeIcon icon={faIndent} />
						</button>
						<button
							type="button"
							className={`${styles.formatButton}${primaryToolbarButtonClass}`}
							aria-label={t('editors.outdentContent')}
							title={t('editors.outdentContent')}
							onMouseDown={preventToolbarFocusSteal}
							onPointerDown={preventToolbarFocusSteal}
							onClick={() => outdentStructuredBlock(props.editor)}
							disabled={!resolvedToolbarState.canOutdentStructuredBlock}
						>
							<FontAwesomeIcon icon={faOutdent} />
						</button>
					</>
				) : null}
				{props.variant === 'full' && !isCondensedToolbar ? (
					<>
						<div className={styles.formatDivider} aria-hidden="true" />
						{/* Multi-color highlight picker */}
						<div className={styles.formatMenuAnchor}>
							<button
								ref={highlightMenuButtonRef}
								type="button"
								className={`${styles.formatButton}${compactButtonClass}${resolvedToolbarState.isHighlight || highlightMenuOpen ? ` ${styles.formatButtonActive}` : ''}`}
								aria-label={t('editors.highlight')}
								title={t('editors.highlight')}
								aria-expanded={highlightMenuOpen}
								onMouseDown={preventToolbarFocusSteal}
								onPointerDown={preventToolbarFocusSteal}
								onClick={() => {
									updateHighlightMenuPosition();
									setHighlightMenuOpen((open) => !open);
								}}
							>
								<FontAwesomeIcon icon={faHighlighter} />
							</button>
						</div>
						<button
							ref={headingMenuButtonRef}
							type="button"
							className={`${styles.formatButton}${compactButtonClass}${headingMenuOpen || resolvedToolbarState.isHeading1 || resolvedToolbarState.isHeading2 || resolvedToolbarState.isHeading3 || resolvedToolbarState.isHeading4 || resolvedToolbarState.isHeading5 || resolvedToolbarState.isHeading6 ? ` ${styles.formatButtonActive}` : ''}`}
							aria-label={t('editors.headingMenu')}
							title={t('editors.headingMenu')}
							aria-expanded={headingMenuOpen}
							onMouseDown={preventToolbarFocusSteal}
							onPointerDown={preventToolbarFocusSteal}
							onClick={() => setHeadingMenuOpen((open) => !open)}
						>
							<span className={styles.headingMenuButtonLabel}>{activeHeadingLabel}</span>
						</button>
						{showHeadingCollapseToggle ? (
							<button
								type="button"
								className={`${styles.formatButton}${compactButtonClass}${resolvedToolbarState.isCollapsibleHeading ? ` ${styles.formatButtonActive}` : ''}`}
								aria-label={headingCollapseToggleLabel}
								title={headingCollapseToggleLabel}
								onMouseDown={preventToolbarFocusSteal}
								onPointerDown={preventToolbarFocusSteal}
								onClick={handleToggleHeadingCollapsible}
								disabled={!resolvedToolbarState.canToggleHeadingCollapsible}
							>
								<span className={`${styles.formatButtonMaskIcon} ${styles.formatButtonMaskIconHeadingCollapse}`} aria-hidden="true" />
							</button>
						) : null}
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${resolvedToolbarState.isBulletList ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.bulletedList')} title={t('editors.bulletedList')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().toggleBulletList().run()}>
							<FontAwesomeIcon icon={faListUl} />
						</button>
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${resolvedToolbarState.isOrderedList ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.numberedList')} title={t('editors.numberedList')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().toggleOrderedList().run()}>
							<FontAwesomeIcon icon={faListOl} />
						</button>
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${resolvedToolbarState.isTaskList ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.taskList')} title={t('editors.taskList')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runRichTextCommand(props.editor, 'toggleTaskList')}>
							<FontAwesomeIcon icon={faListCheck} />
						</button>
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${resolvedToolbarState.isBlockquote ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.blockquote')} title={t('editors.blockquote')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runRichTextCommand(props.editor, 'toggleBlockquote')}>
							<FontAwesomeIcon icon={faQuoteLeft} />
						</button>
						{showStructuredNestingButtons ? (
							<>
								<button
									type="button"
									className={`${styles.formatButton}${compactButtonClass}`}
									aria-label={t('editors.nestContent')}
									title={t('editors.nestContent')}
									onMouseDown={preventToolbarFocusSteal}
									onPointerDown={preventToolbarFocusSteal}
									onClick={() => indentStructuredBlock(props.editor)}
									disabled={!resolvedToolbarState.canIndentStructuredBlock}
								>
									<FontAwesomeIcon icon={faIndent} />
								</button>
								<button
									type="button"
									className={`${styles.formatButton}${compactButtonClass}`}
									aria-label={t('editors.outdentContent')}
									title={t('editors.outdentContent')}
									onMouseDown={preventToolbarFocusSteal}
									onPointerDown={preventToolbarFocusSteal}
									onClick={() => outdentStructuredBlock(props.editor)}
									disabled={!resolvedToolbarState.canOutdentStructuredBlock}
								>
									<FontAwesomeIcon icon={faOutdent} />
								</button>
							</>
						) : null}
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${resolvedToolbarState.isCodeBlock ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.codeBlock')} title={t('editors.codeBlock')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runRichTextCommand(props.editor, 'toggleCodeBlock')}>
							<FontAwesomeIcon icon={faCode} />
						</button>
						<button type="button" className={`${styles.formatButton}${compactButtonClass}`} aria-label={t('editors.horizontalRule')} title={t('editors.horizontalRule')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runRichTextCommand(props.editor, 'setHorizontalRule')}>
							<FontAwesomeIcon icon={faMinus} />
						</button>
						<div className={styles.formatMenuAnchor}>
							<button
								ref={tableMenuButtonRef}
								type="button"
								className={`${styles.formatButton}${compactButtonClass}${resolvedToolbarState.isTable || tableMenuOpen ? ` ${styles.formatButtonActive}` : ''}`}
								aria-label={t('editors.tableMenu')}
								title={t('editors.tableMenu')}
								aria-expanded={tableMenuOpen}
								onMouseDown={preventToolbarFocusSteal}
								onPointerDown={preventToolbarFocusSteal}
								onClick={() => {
									updateTableMenuPosition();
									setTableMenuOpen((open) => !open);
								}}
							>
								<FontAwesomeIcon icon={faTable} />
							</button>
						</div>
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${resolvedToolbarState.isAlignLeft ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.alignLeft')} title={t('editors.alignLeft')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().setTextAlign('left').run()}>
							<FontAwesomeIcon icon={faAlignLeft} />
						</button>
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${resolvedToolbarState.isAlignCenter ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.alignCenter')} title={t('editors.alignCenter')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().setTextAlign('center').run()}>
							<FontAwesomeIcon icon={faAlignCenter} />
						</button>
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${resolvedToolbarState.isAlignRight ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.alignRight')} title={t('editors.alignRight')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().setTextAlign('right').run()}>
							<FontAwesomeIcon icon={faAlignRight} />
						</button>
						<div className={styles.formatDivider} aria-hidden="true" />
						<div className={styles.copyModeToggleGroup} role="group" aria-label={t('editors.copyMode')}>
							<button
								type="button"
								className={`${styles.copyModeToggleButton}${props.compact ? ` ${styles.copyModeToggleButtonCompact}` : ''}${resolvedCopyMode === 'markdown' ? ` ${styles.copyModeToggleButtonActive}` : ''}`}
								aria-label={t('editors.copyModeMarkdownToast')}
								aria-pressed={resolvedCopyMode === 'markdown'}
								title={t('editors.copyModeMarkdownToast')}
								onMouseDown={preventToolbarFocusSteal}
								onPointerDown={preventToolbarFocusSteal}
								onClick={() => props.onCopyModeChange?.('markdown')}
							>
								{t('editors.copyMarkdown')}
							</button>
							<button
								type="button"
								className={`${styles.copyModeToggleButton}${props.compact ? ` ${styles.copyModeToggleButtonCompact}` : ''}${resolvedCopyMode === 'rich-text' ? ` ${styles.copyModeToggleButtonActive}` : ''}`}
								aria-label={t('editors.copyModeRichTextToast')}
								aria-pressed={resolvedCopyMode === 'rich-text'}
								title={t('editors.copyModeRichTextToast')}
								onMouseDown={preventToolbarFocusSteal}
								onPointerDown={preventToolbarFocusSteal}
								onClick={() => props.onCopyModeChange?.('rich-text')}
							>
								{t('editors.copyRichText')}
							</button>
						</div>
					</>
				) : null}
				{isCondensedToolbar ? (
					<>
						<button
							type="button"
							className={`${styles.condensedToolbarToggle}${props.compact ? ` ${styles.condensedToolbarToggleCompact}` : ''}${condensedSection === 'formatting' || hasActiveFormattingSection ? ` ${styles.condensedToolbarToggleActive}` : ''}`}
							aria-label={t('editors.condensedFormatting')}
							title={t('editors.condensedFormatting')}
							aria-pressed={condensedSection === 'formatting'}
							onMouseDown={preventToolbarFocusSteal}
							onPointerDown={preventToolbarFocusSteal}
							onClick={() => toggleCondensedSection('formatting')}
						>
							<FontAwesomeIcon icon={faBold} />
						</button>
						<button
							type="button"
							className={`${styles.condensedToolbarToggle}${props.compact ? ` ${styles.condensedToolbarToggleCompact}` : ''}${condensedSection === 'headings' || hasActiveHeadingSection ? ` ${styles.condensedToolbarToggleActive}` : ''}`}
							aria-label={t('editors.condensedHeadings')}
							title={t('editors.condensedHeadings')}
							aria-pressed={condensedSection === 'headings'}
							onMouseDown={preventToolbarFocusSteal}
							onPointerDown={preventToolbarFocusSteal}
							onClick={() => toggleCondensedSection('headings')}
						>
							<FontAwesomeIcon icon={faHeading} />
						</button>
						<button
							type="button"
							className={`${styles.condensedToolbarToggle}${props.compact ? ` ${styles.condensedToolbarToggleCompact}` : ''}${condensedSection === 'lists' || hasActiveListSection ? ` ${styles.condensedToolbarToggleActive}` : ''}`}
							aria-label={t('editors.condensedLists')}
							title={t('editors.condensedLists')}
							aria-pressed={condensedSection === 'lists'}
							onMouseDown={preventToolbarFocusSteal}
							onPointerDown={preventToolbarFocusSteal}
							onClick={() => toggleCondensedSection('lists')}
						>
							<FontAwesomeIcon icon={faListUl} />
						</button>
						<button
							type="button"
							className={`${styles.condensedToolbarToggle}${props.compact ? ` ${styles.condensedToolbarToggleCompact}` : ''}${condensedSection === 'insert' || hasActiveInsertSection ? ` ${styles.condensedToolbarToggleActive}` : ''}`}
							aria-label={t('editors.condensedInsert')}
							title={t('editors.condensedInsert')}
							aria-pressed={condensedSection === 'insert'}
							onMouseDown={preventToolbarFocusSteal}
							onPointerDown={preventToolbarFocusSteal}
							onClick={() => toggleCondensedSection('insert')}
						>
							<FontAwesomeIcon icon={faPlus} />
						</button>
						<button
							type="button"
							className={`${styles.condensedToolbarToggle}${props.compact ? ` ${styles.condensedToolbarToggleCompact}` : ''}${condensedSection === 'layout' || hasActiveLayoutSection ? ` ${styles.condensedToolbarToggleActive}` : ''}`}
							aria-label={t('editors.condensedLayout')}
							title={t('editors.condensedLayout')}
							aria-pressed={condensedSection === 'layout'}
							onMouseDown={preventToolbarFocusSteal}
							onPointerDown={preventToolbarFocusSteal}
							onClick={() => toggleCondensedSection('layout')}
						>
							<FontAwesomeIcon icon={faAlignLeft} />
						</button>
						<button
							type="button"
							className={`${styles.condensedToolbarToggle}${props.compact ? ` ${styles.condensedToolbarToggleCompact}` : ''}${condensedSection === 'copy' ? ` ${styles.condensedToolbarToggleActive}` : ''}`}
							aria-label={t('editors.condensedCopy')}
							title={t('editors.condensedCopy')}
							aria-pressed={condensedSection === 'copy'}
							onMouseDown={preventToolbarFocusSteal}
							onPointerDown={preventToolbarFocusSteal}
							onClick={() => toggleCondensedSection('copy')}
						>
							<FontAwesomeIcon icon={faCopy} />
						</button>
						{props.onToggleNoteAutoScroll ? (
							<button
								type="button"
								className={`${styles.condensedToolbarToggle}${props.compact ? ` ${styles.condensedToolbarToggleCompact}` : ''}${props.noteAutoScrollEnabled ? ` ${styles.condensedToolbarToggleActive}` : ''}`}
								aria-label={noteAutoScrollLabel}
								aria-pressed={props.noteAutoScrollEnabled}
								title={noteAutoScrollLabel}
								onMouseDown={preventToolbarFocusSteal}
								onPointerDown={preventToolbarFocusSteal}
								onClick={props.onToggleNoteAutoScroll}
							>
								<span className={`${styles.formatButtonMaskIcon} ${styles.formatButtonMaskIconAutoScroll}`} aria-hidden="true" />
							</button>
						) : null}
					</>
				) : null}
				</div>
				<button
					type="button"
					className={`${styles.formatToolbarScrollButton}${canScrollToolbarRight ? '' : ` ${styles.formatToolbarScrollButtonHidden}`}`}
					aria-label={t('editors.scrollToolbarRight')}
					title={t('editors.scrollToolbarRight')}
					onMouseDown={preventToolbarFocusSteal}
					onPointerDown={preventToolbarFocusSteal}
					onClick={() => scrollToolbarBy(220)}
					disabled={!canScrollToolbarRight}
				>
					<FontAwesomeIcon icon={faChevronRight} />
				</button>
			</div>
			</div>
			{isCondensedToolbar && condensedSectionContent ? (
				<div
					className={`${styles.formatSubToolbar}${props.compact ? ` ${styles.formatSubToolbarCompact}` : ''}`}
					role="toolbar"
					aria-label={t('editors.condensedToolbarSections')}
					onPointerDown={stopToolbarPropagation}
					onMouseDown={stopToolbarPropagation}
					onClick={stopToolbarPropagation}
				>
					{condensedSectionContent}
				</div>
			) : null}
			{props.variant === 'full' && headingMenuOpen ? (
				<div
					ref={headingMenuRef}
					className={`${styles.headingToolbar}${props.compact ? ` ${styles.headingToolbarCompact}` : ''}`}
					role="toolbar"
					aria-label={t('editors.headingMenu')}
					onPointerDown={stopToolbarPropagation}
					onMouseDown={stopToolbarPropagation}
					onClick={stopToolbarPropagation}
				>
					<button type="button" className={`${styles.headingToolbarButton}${props.compact ? ` ${styles.headingToolbarButtonCompact}` : ''}${resolvedToolbarState.isHeading1 ? ` ${styles.headingToolbarButtonActive}` : ''}`} aria-label={t('editors.heading1')} title={t('editors.heading1')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runHeadingCommand(1)}>H1</button>
					<button type="button" className={`${styles.headingToolbarButton}${props.compact ? ` ${styles.headingToolbarButtonCompact}` : ''}${resolvedToolbarState.isHeading2 ? ` ${styles.headingToolbarButtonActive}` : ''}`} aria-label={t('editors.heading2')} title={t('editors.heading2')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runHeadingCommand(2)}>H2</button>
					<button type="button" className={`${styles.headingToolbarButton}${props.compact ? ` ${styles.headingToolbarButtonCompact}` : ''}${resolvedToolbarState.isHeading3 ? ` ${styles.headingToolbarButtonActive}` : ''}`} aria-label={t('editors.heading3')} title={t('editors.heading3')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runHeadingCommand(3)}>H3</button>
					<button type="button" className={`${styles.headingToolbarButton}${props.compact ? ` ${styles.headingToolbarButtonCompact}` : ''}${resolvedToolbarState.isHeading4 ? ` ${styles.headingToolbarButtonActive}` : ''}`} aria-label={t('editors.heading4')} title={t('editors.heading4')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runHeadingCommand(4)}>H4</button>
					<button type="button" className={`${styles.headingToolbarButton}${props.compact ? ` ${styles.headingToolbarButtonCompact}` : ''}${resolvedToolbarState.isHeading5 ? ` ${styles.headingToolbarButtonActive}` : ''}`} aria-label={t('editors.heading5')} title={t('editors.heading5')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runHeadingCommand(5)}>H5</button>
					<button type="button" className={`${styles.headingToolbarButton}${props.compact ? ` ${styles.headingToolbarButtonCompact}` : ''}${resolvedToolbarState.isHeading6 ? ` ${styles.headingToolbarButtonActive}` : ''}`} aria-label={t('editors.heading6')} title={t('editors.heading6')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runHeadingCommand(6)}>H6</button>
					{showHeadingCollapseToggle ? (
						<button
							type="button"
							className={`${styles.headingToolbarButton}${props.compact ? ` ${styles.headingToolbarButtonCompact}` : ''}${resolvedToolbarState.isCollapsibleHeading ? ` ${styles.headingToolbarButtonActive}` : ''}`}
							aria-label={headingCollapseToggleLabel}
							title={headingCollapseToggleLabel}
							onMouseDown={preventToolbarFocusSteal}
							onPointerDown={preventToolbarFocusSteal}
							onClick={handleToggleHeadingCollapsible}
							disabled={!resolvedToolbarState.canToggleHeadingCollapsible}
						>
							<span className={`${styles.formatButtonMaskIcon} ${styles.formatButtonMaskIconHeadingCollapse}`} aria-hidden="true" />
						</button>
					) : null}
				</div>
			) : null}
			{tableMenuOpen && tableMenuPosition && typeof document !== 'undefined'
				? createPortal(
					<div
						ref={tableMenuRef}
						className={styles.formatMenu}
						role="menu"
						aria-label={t('editors.tableMenu')}
						style={{ position: 'fixed', top: `${tableMenuPosition.top}px`, left: `${tableMenuPosition.left}px` }}
						onPointerDown={stopToolbarPropagation}
						onMouseDown={stopToolbarPropagation}
						onClick={stopToolbarPropagation}
					>
						<button type="button" className={styles.formatMenuButton} role="menuitem" onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runTableMenuCommand('insertTable', { rows: 3, cols: 3, withHeaderRow: true })} disabled={!resolvedToolbarState.canInsertTable}>
							{t('editors.insertTable')}
						</button>
						<button type="button" className={styles.formatMenuButton} role="menuitem" onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runTableMenuCommand('addColumnAfter')} disabled={!resolvedToolbarState.canAddTableColumn}>
							{t('editors.addTableColumn')}
						</button>
						<button type="button" className={styles.formatMenuButton} role="menuitem" onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runTableMenuCommand('deleteColumn')} disabled={!resolvedToolbarState.canDeleteTableColumn}>
							{t('editors.deleteTableColumn')}
						</button>
						<button type="button" className={styles.formatMenuButton} role="menuitem" onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runTableMenuCommand('addRowAfter')} disabled={!resolvedToolbarState.canAddTableRow}>
							{t('editors.addTableRow')}
						</button>
						<button type="button" className={styles.formatMenuButton} role="menuitem" onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runTableMenuCommand('deleteRow')} disabled={!resolvedToolbarState.canDeleteTableRow}>
							{t('editors.deleteTableRow')}
						</button>
						<button type="button" className={styles.formatMenuButton} role="menuitem" onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runTableMenuCommand('deleteTable')} disabled={!resolvedToolbarState.canDeleteTable}>
							{t('editors.deleteTable')}
						</button>
					</div>,
					document.body,
				)
				: null}
			{/* Highlight color picker portal */}
			{highlightMenuOpen && highlightMenuPosition && typeof document !== 'undefined'
				? createPortal(
					<div
						ref={highlightMenuRef}
						className={styles.highlightMenu}
						role="menu"
						aria-label={t('editors.highlight')}
						style={{ position: 'fixed', top: `${highlightMenuPosition.top}px`, left: `${highlightMenuPosition.left}px` }}
						onPointerDown={stopToolbarPropagation}
						onMouseDown={stopToolbarPropagation}
						onClick={stopToolbarPropagation}
					>
						{HIGHLIGHT_COLORS.map((color) => (
							<button
								key={color.id}
								type="button"
								className={styles.highlightSwatch}
								aria-label={t(color.labelKey as Parameters<typeof t>[0])}
								title={t(color.labelKey as Parameters<typeof t>[0])}
								style={{ background: color.previewColor }}
								onMouseDown={preventToolbarFocusSteal}
								onPointerDown={preventToolbarFocusSteal}
								onClick={() => {
									applyHighlightColor(color.cssVar);
									setHighlightMenuOpen(false);
								}}
							/>
						))}
						<button
							type="button"
							className={styles.highlightClearButton}
							aria-label={t('editors.highlightClear')}
							title={t('editors.highlightClear')}
							onMouseDown={preventToolbarFocusSteal}
							onPointerDown={preventToolbarFocusSteal}
							onClick={() => {
								clearHighlight();
								setHighlightMenuOpen(false);
							}}
						>
							{t('editors.highlightClear')}
						</button>
					</div>,
					document.body,
				)
				: null}
			{/* Emoji quick-insert portal */}
			{emojiMenuOpen && emojiMenuPosition && typeof document !== 'undefined'
				? createPortal(
					<div
						ref={emojiMenuRef}
						className={styles.emojiMenu}
						role="menu"
						aria-label={t('editors.emojiPicker')}
						style={{ position: 'fixed', top: `${emojiMenuPosition.top}px`, left: `${emojiMenuPosition.left}px` }}
						onPointerDown={stopToolbarPropagation}
						onMouseDown={stopToolbarPropagation}
						onClick={stopToolbarPropagation}
					>
						{QUICK_EMOJIS.map((emoji) => (
							<button
								key={emoji}
								type="button"
								className={styles.emojiButton}
								aria-label={emoji}
								title={emoji}
								onMouseDown={preventToolbarFocusSteal}
								onPointerDown={preventToolbarFocusSteal}
								onClick={() => {
									props.editor?.chain().focus().insertContent(emoji).run();
									setEmojiMenuOpen(false);
								}}
							>
								{emoji}
							</button>
						))}
					</div>,
					document.body,
				)
				: null}
			{/* Link picker portal */}
			{linkMenuOpen && linkMenuPosition && typeof document !== 'undefined'
				? createPortal(
					<div
						ref={linkMenuRef}
						className={styles.linkMenu}
						style={{ position: 'fixed', top: `${linkMenuPosition.top}px`, left: `${linkMenuPosition.left}px` }}
						onPointerDown={stopToolbarPropagation}
						onMouseDown={stopToolbarPropagation}
						onClick={stopToolbarPropagation}
					>
						<div className={styles.linkMenuUrlRow}>
							<input
								ref={linkUrlInputRef}
								type="url"
								className={styles.linkMenuInput}
								placeholder="https://..."
								value={linkUrlInput}
								onChange={(e) => setLinkUrlInput(e.target.value)}
								onKeyDown={(e) => { if (e.key === 'Enter') applyLinkUrl(); }}
							/>
							<button
								type="button"
								className={styles.linkMenuApply}
								onMouseDown={preventToolbarFocusSteal}
								onPointerDown={preventToolbarFocusSteal}
								onClick={applyLinkUrl}
								disabled={!linkUrlInput.trim()}
							>
								{t('editors.linkApply')}
							</button>
						</div>
						{linkHeadings.length > 0 ? (
							<>
								<div className={styles.linkMenuSeparator}>
									<span className={styles.linkMenuSeparatorLabel}>{t('editors.linkHeadingsSection')}</span>
								</div>
								<div className={styles.linkMenuHeadingsList}>
									{linkHeadings.map((h, i) => (
										<button
											key={i}
											type="button"
											className={styles.linkMenuHeadingItem}
											style={{ paddingLeft: `${(h.level - 1) * 14 + 10}px` }}
											onMouseDown={preventToolbarFocusSteal}
											onPointerDown={preventToolbarFocusSteal}
											onClick={() => applyHeadingAnchor(h.slug, h.text)}
											title={h.text}
										>
											{h.text}
										</button>
									))}
								</div>
							</>
						) : null}
					</div>,
					document.body,
				)
				: null}
		</div>
	);
}

export function RichTextEditor(props: RichTextEditorProps): React.JSX.Element {
	recordHeadingCollapseDebug('reactRenderRichTextEditor', { noteId: props.collapsibleHeadingNoteId ?? null });
	const { variant } = props;
	const { t } = useI18n();
	const suppressMobileTaskCheckboxFocus = props.suppressMobileTaskCheckboxFocus === true && variant === 'full';
	const emitInitialChange = props.emitInitialChange ?? true;
	const serializeChangePayload = props.serializeChangePayload ?? true;
	const bubbleMenuEnabled = useBubbleMenuEnabled();
	const showFormattingBubbleActions = bubbleMenuEnabled && variant === 'full';
	const caretVisibilityBottomInsetRef = React.useRef(props.caretVisibilityBottomInset ?? 0);
	caretVisibilityBottomInsetRef.current = props.caretVisibilityBottomInset ?? 0;
	const latestHandlersRef = React.useRef({
		onChange: props.onChange,
		onEnter: props.onEnter,
		onShiftEnter: props.onShiftEnter,
		onBackspaceWhenEmpty: props.onBackspaceWhenEmpty,
		onArrowUpAtBoundary: props.onArrowUpAtBoundary,
		onArrowDownAtBoundary: props.onArrowDownAtBoundary,
	});
	latestHandlersRef.current = {
		onChange: props.onChange,
		onEnter: props.onEnter,
		onShiftEnter: props.onShiftEnter,
		onBackspaceWhenEmpty: props.onBackspaceWhenEmpty,
		onArrowUpAtBoundary: props.onArrowUpAtBoundary,
		onArrowDownAtBoundary: props.onArrowDownAtBoundary,
	};
	const editorRef = React.useRef<Editor | null>(null);
	const [hasSelection, setHasSelection] = React.useState(false);
	const [internalCopyMode, setInternalCopyMode] = React.useState<ClipboardConversionTarget>('rich-text');
	const effectiveCopyMode = props.copyMode ?? internalCopyMode;
	const copyModeRef = React.useRef<ClipboardConversionTarget>('rich-text');
	const [clipboardStatusMessage, setClipboardStatusMessage] = React.useState('');
	const clipboardMessageTimeoutRef = React.useRef<number | null>(null);
	const pendingTaskCheckboxRef = React.useRef<HTMLInputElement | null>(null);
	const suppressNextTaskCheckboxClickRef = React.useRef(false);
	const showFormattingBubble = showFormattingBubbleActions && hasSelection;
	const publishClipboardStatus = React.useCallback((message: string): void => {
		setClipboardStatusMessage(message);
		props.onClipboardStatusChange?.(message);
		if (clipboardMessageTimeoutRef.current !== null) {
			window.clearTimeout(clipboardMessageTimeoutRef.current);
		}
		clipboardMessageTimeoutRef.current = window.setTimeout(() => {
			clipboardMessageTimeoutRef.current = null;
			setClipboardStatusMessage('');
			props.onClipboardStatusChange?.('');
		}, 1800);
	}, [props]);
	const handleCopyModeChange = React.useCallback((target: ClipboardConversionTarget): void => {
		copyModeRef.current = target;
		if (props.onCopyModeChange) props.onCopyModeChange(target);
		else setInternalCopyMode(target);
		publishClipboardStatus(target === 'markdown' ? t('editors.copyModeMarkdownToast') : t('editors.copyModeRichTextToast'));
	}, [props, publishClipboardStatus, t]);
	const ensureSelectionVisible = React.useCallback((): void => {
		const bottomInset = caretVisibilityBottomInsetRef.current;
		if (bottomInset <= 0) return;
		window.requestAnimationFrame(() => {
			ensureEditorSelectionVisible(editorRef.current, bottomInset);
		});
	}, []);
	const handleMobileTaskCheckboxToggle = React.useCallback((view: Editor['view'], nodePos: number, checked: boolean): boolean => {
		const node = view.state.doc.nodeAt(nodePos);
		if (!node || node.type.name !== 'taskItem') return false;
		view.dispatch(view.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, checked }));
		const root = view.dom as HTMLElement | null;
		if (root && document.activeElement === root) {
			root.blur();
		}
		return true;
	}, []);
	const scheduleTaskItemVisibility = React.useCallback((target: EventTarget | null): void => {
		const taskItem = getTaskItemElementFromTarget(target);
		if (!taskItem) return;
		const preferredInset = suppressMobileTaskCheckboxFocus
			? Math.max(caretVisibilityBottomInsetRef.current, 88)
			: caretVisibilityBottomInsetRef.current;
		window.requestAnimationFrame(() => {
			ensureEditorElementVisible(taskItem, preferredInset);
		});
		window.setTimeout(() => ensureEditorElementVisible(taskItem, preferredInset), 120);
		window.setTimeout(() => ensureEditorElementVisible(taskItem, preferredInset), 260);
	}, [suppressMobileTaskCheckboxFocus]);
	const toggleMobileTaskCheckboxFromTarget = React.useCallback((view: Editor['view'], target: EventTarget | null): boolean => {
		const nodePos = getTaskItemPositionFromTarget(view, target);
		if (nodePos == null) return false;
		const node = view.state.doc.nodeAt(nodePos);
		if (!node || node.type.name !== 'taskItem') return false;
		const didToggle = handleMobileTaskCheckboxToggle(view, nodePos, !Boolean(node.attrs.checked));
		if (didToggle) scheduleTaskItemVisibility(target);
		return didToggle;
	}, [handleMobileTaskCheckboxToggle, scheduleTaskItemVisibility]);
	const handleTaskCheckboxInteractionStart = React.useCallback((event: MouseEvent | PointerEvent | TouchEvent): boolean => {
		if (!suppressMobileTaskCheckboxFocus) return false;
		const checkbox = getTaskListCheckboxTarget(event.target);
		if (!checkbox) return false;
		pendingTaskCheckboxRef.current = checkbox;
		if (event.cancelable) event.preventDefault();
		return true;
	}, [suppressMobileTaskCheckboxFocus]);
	const handleTaskCheckboxInteractionEnd = React.useCallback((view: Editor['view'], event: MouseEvent | PointerEvent | TouchEvent): boolean => {
		if (!suppressMobileTaskCheckboxFocus) return false;
		const checkbox = getTaskListCheckboxTarget(event.target);
		if (!checkbox || pendingTaskCheckboxRef.current !== checkbox) {
			pendingTaskCheckboxRef.current = null;
			return false;
		}
		pendingTaskCheckboxRef.current = null;
		suppressNextTaskCheckboxClickRef.current = true;
		if (event.cancelable) event.preventDefault();
		return toggleMobileTaskCheckboxFromTarget(view, event.target);
	}, [suppressMobileTaskCheckboxFocus, toggleMobileTaskCheckboxFromTarget]);

	// Stable wrapper so `onSelfMentionInserted` prop changes never trigger editor
	// recreation (it's not in the useEditor deps array) while still always calling
	// the current version of the callback.
	const onSelfMentionInsertedRef = React.useRef(props.onSelfMentionInserted);
	onSelfMentionInsertedRef.current = props.onSelfMentionInserted;
	const stableSelfMentionCb = React.useRef<(nodeId: string) => void>(
		(nodeId) => onSelfMentionInsertedRef.current?.(nodeId),
	).current;

	const editor = useEditor(
		{
			immediatelyRender: false,
			extensions: createRichTextExtensions({
				variant,
				placeholder: props.placeholder,
				includeCollaboration: Boolean(props.fragment),
				fragment: props.fragment ?? null,
				collapsibleHeadingNoteId: props.collapsibleHeadingNoteId ?? null,
				authUserId: props.authUserId ?? null,
				onSelfMentionInserted: stableSelfMentionCb,
			}),
			editable: props.editable !== false,
			content: props.fragment ? undefined : props.content ?? undefined,
			editorProps: {
				attributes: {
					class: `${styles.richEditorContent}${props.contentClassName ? ` ${props.contentClassName}` : ''}`,
					'autocomplete': 'off',
					'autoCorrect': 'off',
					'autoCapitalize': 'off',
					'data-bwignore': 'true',
					'data-lpignore': 'true',
					'data-1p-ignore': 'true',
				},
				handleDOMEvents: {
					pointerdown: (_view, event) => handleTaskCheckboxInteractionStart(event),
					pointerup: (view, event) => handleTaskCheckboxInteractionEnd(view, event),
					mousedown: (_view, event) => handleTaskCheckboxInteractionStart(event),
					mouseup: (view, event) => handleTaskCheckboxInteractionEnd(view, event),
					touchstart: (_view, event) => {
						// Hash-anchor (TOC) links: prevent default on touchstart so the
						// browser does not generate a synthetic mousedown for the touch.
						// Without this, ProseMirror moves the cursor to the link text,
						// which triggers the mobile keyboard and then interrupts the
						// scrollIntoView call in the touchend handler below.
						const anchor = (event.target as Element).closest?.('a');
						if (anchor && anchor.getAttribute('href')?.startsWith('#')) {
							if (event.cancelable) event.preventDefault();
							return true;
						}
						return handleTaskCheckboxInteractionStart(event);
					},
					touchend: (view, event) => {
						// Hash-anchor links: intercept touchend so we scroll to the heading
						// before the synthetic click fires.  touchend fires before any
						// ProseMirror / TipTap Link openOnClick handling, and calling
						// preventDefault() here suppresses the subsequent synthetic click so
						// the link cannot navigate the PWA to the hash URL.
						const anchor = (event.target as Element).closest?.('a');
						if (anchor) {
							const href = anchor.getAttribute('href') ?? '';
							if (href.startsWith('#')) {
								event.preventDefault();
								try { scrollToSluggedHeading(view, decodeURIComponent(href.slice(1))); } catch { /* ignore */ }
								return true;
							}
						}
						return handleTaskCheckboxInteractionEnd(view, event);
					},
					copy: (_view, event) => {
						const ed = editorRef.current;
						if (!ed || variant !== 'full') return false;
						const input = getEditorSelectionClipboardInput(ed);
						if (!input || !event.clipboardData) return false;
						try {
							// Intercept the native copy event so keyboard shortcuts and browser copy
							// actions respect the selected Markdown vs rich-text export mode.
							const payload = prepareConvertedClipboardPayload(input, copyModeRef.current);
							event.preventDefault();
							event.clipboardData.setData('text/plain', payload.text);
							if (payload.html) {
								event.clipboardData.setData('text/html', payload.html);
							}
							return true;
						} catch {
							return false;
						}
					},
					click: (view, event) => {
						// Hash-anchor interception: scroll to the heading instead of letting
						// TipTap's Link openOnClick call window.open (which navigates in PWA).
						// Returning true prevents ProseMirror from dispatching handleClick plugins.
						const anchor = (event.target as Element).closest?.('a');
						if (anchor) {
							const href = anchor.getAttribute('href') ?? '';
							if (href.startsWith('#')) {
								event.preventDefault();
								try { scrollToSluggedHeading(view, decodeURIComponent(href.slice(1))); } catch { /* ignore */ }
								return true;
							}
						}
						if (!suppressMobileTaskCheckboxFocus) return false;
						const checkbox = getTaskListCheckboxTarget(event.target);
						if (!checkbox) return false;
						if (event.cancelable) event.preventDefault();
						if (suppressNextTaskCheckboxClickRef.current) {
							suppressNextTaskCheckboxClickRef.current = false;
							return true;
						}
						return toggleMobileTaskCheckboxFromTarget(view, event.target);
					},
				},
				// handleClick fires via the mouseup dispatch path (separate from the raw
				// DOM click event) and is checked as a direct view prop before any plugin
				// handleClick handlers — including TipTap Link's openOnClick, which calls
				// window.open. Returning true here short-circuits the plugin chain so the
				// link is scrolled to instead of opened in a new window/tab.
				handleClick: (view, _pos, event: MouseEvent) => {
					const anchor = (event.target as Element).closest?.('a');
					if (!anchor) return false;
					const rawHref = anchor.getAttribute('href') ?? '';
					let slug: string | null = null;
					if (rawHref.startsWith('#')) {
						slug = decodeURIComponent(rawHref.slice(1));
					} else if (rawHref) {
						// TipTap may resolve relative hrefs to absolute before storing them
						try {
							const url = new URL(rawHref, location.href);
							if (url.origin === location.origin && url.pathname === location.pathname && url.hash) {
								slug = decodeURIComponent(url.hash.slice(1));
							}
						} catch { /* ignore malformed URLs */ }
					}
					if (!slug) return false;
					event.preventDefault();
					try { scrollToSluggedHeading(view, slug); } catch { /* ignore */ }
					return true;
				},
				handleClickOn: (view, nodePos, node, _directPos, event, direct) => {
					if (!suppressMobileTaskCheckboxFocus || !direct || node.type.name !== 'taskItem') return false;
					const checkbox = getTaskListCheckboxTarget(event.target);
					if (!checkbox) return false;
					event.preventDefault();
					return handleMobileTaskCheckboxToggle(view, nodePos, !Boolean(node.attrs.checked));
				},
				handlePaste: (_view, event) => {
					const ed = editorRef.current;
					if (!ed) return false;
					const clipboardData = event.clipboardData;
					if (!clipboardData) return false;
					const hasFiles = Array.from(clipboardData.items ?? []).some((item) => item.kind === 'file');
					if (hasFiles) return false;
					// Prefer markdown expansion only when the clipboard does not already contain
					// meaningful rich HTML. This also covers minimal editors so checklist rows
					// can accept inline markdown like ==highlight==.
					const markdownHtml = getMarkdownPasteHtml({
						text: clipboardData.getData('text/plain'),
						html: clipboardData.getData('text/html'),
						variant,
					});
					if (!markdownHtml) return false;
					event.preventDefault();
					return ed.chain().focus().insertContent(markdownHtml).run();
				},
				handleKeyDown: (_view, event) => {
					const ed = editorRef.current;
					if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
						// Keep keyboard nesting aligned with the toolbar: Tab deepens the current
						// list/quote context, Shift+Tab backs it out, and unsupported contexts
						// fall through so native focus navigation still works.
						const handled = event.shiftKey
							? canOutdentStructuredBlock(ed) && (outdentStructuredBlock(ed), true)
							: canIndentStructuredBlock(ed) && (indentStructuredBlock(ed), true);
						if (handled) {
							event.preventDefault();
							return true;
						}
					}
					if (event.key === 'Enter' && !event.shiftKey && shouldExitEmptyListItem(ed)) {
						event.preventDefault();
						return exitEmptyListItem(ed);
					}
					if (event.key === 'Enter' && !event.shiftKey && latestHandlersRef.current.onEnter) {
						event.preventDefault();
						if (ed) {
							latestHandlersRef.current.onEnter(ed);
						}
						return true;
					}
					if (event.key === 'Enter' && event.shiftKey && latestHandlersRef.current.onShiftEnter) {
						event.preventDefault();
						latestHandlersRef.current.onShiftEnter();
						return true;
					}
					if (event.key === 'Backspace' && latestHandlersRef.current.onBackspaceWhenEmpty && editorRef.current?.isEmpty) {
						event.preventDefault();
						latestHandlersRef.current.onBackspaceWhenEmpty();
						return true;
					}
					// Don't steal arrow keys when the @ mention dropdown is active —
					// let the Suggestion plugin handle up/down navigation within it.
					const suggestionActive = ed ? (ReferenceSuggestionKey.getState(ed.state) as { active?: boolean } | null)?.active === true : false;
					if (
						!suggestionActive &&
						event.key === 'ArrowUp' &&
						!event.shiftKey &&
						!event.metaKey &&
						!event.ctrlKey &&
						!event.altKey &&
						latestHandlersRef.current.onArrowUpAtBoundary &&
						ed?.state.selection.empty &&
						_view.endOfTextblock('up')
					) {
						event.preventDefault();
						latestHandlersRef.current.onArrowUpAtBoundary();
						return true;
					}
					if (
						!suggestionActive &&
						event.key === 'ArrowDown' &&
						!event.shiftKey &&
						!event.metaKey &&
						!event.ctrlKey &&
						!event.altKey &&
						latestHandlersRef.current.onArrowDownAtBoundary &&
						ed?.state.selection.empty &&
						_view.endOfTextblock('down')
					) {
						event.preventDefault();
						latestHandlersRef.current.onArrowDownAtBoundary();
						return true;
					}
					// Ctrl/Cmd+B/I/U at end of text with collapsed selection → select all then toggle
					const mod = event.metaKey || event.ctrlKey;
					if (mod && !event.shiftKey && !event.altKey && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
						if (ed) {
							const { from, to, empty } = ed.state.selection;
							const docEnd = ed.state.doc.content.size - 1;
							if (empty && from >= docEnd) {
								event.preventDefault();
								const cmd = event.key.toLowerCase() === 'b' ? 'toggleBold' : event.key.toLowerCase() === 'i' ? 'toggleItalic' : 'toggleUnderline';
								(ed.chain().focus().selectAll() as any)[cmd]().run();
								return true;
							}
						}
					}
					return false;
				},
			},
			onCreate: ({ editor: currentEditor }) => {
				ensureSelectionVisible();
				// Mount-time emission branch:
				// For checklist row activation we intentionally mount minimal editors very often.
				// Emitting here can cause immediate JSON/text serialization and parent updates
				// before the user has typed anything. `emitInitialChange=false` disables that
				// eager work and keeps row-switch interactions lightweight.
				if (!emitInitialChange) return;

				// Payload serialization branch:
				// Some callsites only need a "document changed" signal and can read data from
				// Yjs directly. For those paths, skip `getJSON/getText` to avoid expensive
				// conversions on each editor lifecycle event.
				if (serializeChangePayload) {
					latestHandlersRef.current.onChange?.({ json: currentEditor.getJSON(), text: currentEditor.getText() });
					return;
				}
				latestHandlersRef.current.onChange?.();
			},
			onUpdate: ({ editor: currentEditor }) => {
				// Avoid forcing caret visibility on every content mutation. On mobile,
				// shrink-only edits like repeated backspace can otherwise ratchet the
				// viewport upward while the keyboard is open.
				// Update-time branch mirrors onCreate:
				// - `true`: caller wants structured payload for non-collab/draft editors.
				// - `false`: caller wants a cheap signal-only callback to reduce CPU cost.
				if (serializeChangePayload) {
					latestHandlersRef.current.onChange?.({ json: currentEditor.getJSON(), text: currentEditor.getText() });
					return;
				}
				latestHandlersRef.current.onChange?.();
			},
		},
		[emitInitialChange, handleMobileTaskCheckboxToggle, handleTaskCheckboxInteractionEnd, handleTaskCheckboxInteractionStart, props.collapsibleHeadingNoteId, props.editable, props.fragment, props.placeholder, serializeChangePayload, suppressMobileTaskCheckboxFocus, toggleMobileTaskCheckboxFromTarget, variant]
	);

	React.useEffect(() => {
		copyModeRef.current = effectiveCopyMode;
	}, [effectiveCopyMode]);

	React.useEffect(() => {
		editorRef.current = editor;
		props.onEditorChange?.(editor);
		return () => {
			if (clipboardMessageTimeoutRef.current !== null) {
				window.clearTimeout(clipboardMessageTimeoutRef.current);
				clipboardMessageTimeoutRef.current = null;
			}
			props.onEditorChange?.(null);
		};
	}, [editor, props.onEditorChange]);

	React.useEffect(() => {
		if (!props.scrollToMentionNodeId || !editor) return;
		const nodeId = props.scrollToMentionNodeId;
		let tries = 0;
		let timerId: ReturnType<typeof setTimeout>;
		const attempt = () => {
			const el = editor.view.dom.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
			if (el instanceof HTMLElement) {
				el.scrollIntoView({ behavior: 'smooth', block: 'center' });
				el.classList.add(styles.mentionScrollHighlight);
				el.addEventListener('animationend', () => el.classList.remove(styles.mentionScrollHighlight), { once: true });
				return;
			}
			if (++tries < 8) timerId = setTimeout(attempt, 250);
		};
		timerId = setTimeout(attempt, 300);
		return () => clearTimeout(timerId);
	}, [props.scrollToMentionNodeId, editor]);

	React.useEffect(() => {
		if (!editor) return;
		const handleSelectionChange = (): void => {
			ensureSelectionVisible();
			setHasSelection(!editor.state.selection.empty);
		};
		editor.on('selectionUpdate', handleSelectionChange);
		editor.on('focus', handleSelectionChange);
		handleSelectionChange();
		return () => {
			editor.off('selectionUpdate', handleSelectionChange);
			editor.off('focus', handleSelectionChange);
		};
	}, [editor, ensureSelectionVisible]);

	React.useEffect(() => {
		if (!editor || !props.autoFocus) return;
		const rafId = window.requestAnimationFrame(() => {
			editor.commands.focus('end');
			ensureSelectionVisible();
		});
		return () => window.cancelAnimationFrame(rafId);
	}, [editor, ensureSelectionVisible, props.autoFocus]);


	const stopToolbarPropagation = React.useCallback((event: React.SyntheticEvent): void => {
		event.stopPropagation();
	}, []);

	const handleReferenceClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>): void => {
		if (!props.onNoteClick) return;
		const chipEl = (e.target as HTMLElement).closest('[data-reference="true"][data-type="note"]') as HTMLElement | null;
		if (!chipEl) return;
		const noteId = chipEl.getAttribute('data-id');
		if (!noteId) return;

		e.preventDefault();
		e.stopPropagation();

		// Fast path: already confirmed denied this session
		if (isNoteDenied(noteId)) return;

		// Pre-flight access check before opening the note editor
		fetch(`/api/notes/${encodeURIComponent(noteId)}/access-check`)
			.then((res) => {
				if (!res.ok) {
					markNoteDenied(noteId);
					return;
				}
				props.onNoteClick!(noteId);
			})
			.catch(() => {
				// Network error — attempt navigation; server auth will gate it
				props.onNoteClick!(noteId);
			});
	}, [props.onNoteClick]);

	return (
		<div className={`${styles.richEditorStack}${props.containerClassName ? ` ${props.containerClassName}` : ''}`} onClick={handleReferenceClick}>
			{props.hideToolbar ? null : <RichTextToolbar editor={editor} variant={variant} compact={props.compactToolbar} toolbarMode={props.toolbarMode} onCreateUrlPreview={props.onCreateUrlPreview} noteAutoScrollEnabled={props.noteAutoScrollEnabled} onToggleNoteAutoScroll={props.onToggleNoteAutoScroll} copyMode={effectiveCopyMode} onCopyModeChange={handleCopyModeChange} collapsibleHeadingNoteId={props.collapsibleHeadingNoteId} />}
			{clipboardStatusMessage && !(props.hideToolbar && props.onClipboardStatusChange) ? <div className={styles.selectionCopyToast} role="status" aria-live="polite">{clipboardStatusMessage}</div> : null}
			<EditorContent editor={editor} className={`${styles.richEditorViewport}${props.viewportClassName ? ` ${props.viewportClassName}` : ''}`} />
			{/*
				Bubble menu branch:
				`minimal` editors are used heavily inside checklist rows where users rapidly
				switch focus. Restricting BubbleMenu to `full` editors avoids extra delayed
				position/update timers in high-frequency checklist interactions.
			*/}
			{editor && showFormattingBubble ? (
				<BubbleMenu editor={editor} updateDelay={150} options={{ placement: 'top' }}>
					<div
						className={styles.bubbleMenu}
						onPointerDown={stopToolbarPropagation}
						onMouseDown={stopToolbarPropagation}
						onClick={stopToolbarPropagation}
					>
						{showFormattingBubbleActions ? (
							<>
								<button
									type="button"
									className={`${styles.bubbleMenuButton}${editor.isActive('bold') ? ` ${styles.bubbleMenuButtonActive}` : ''}`}
									onClick={() => editor.chain().focus().toggleBold().run()}
								>
									<FontAwesomeIcon icon={faBold} />
								</button>
								<button
									type="button"
									className={`${styles.bubbleMenuButton}${editor.isActive('italic') ? ` ${styles.bubbleMenuButtonActive}` : ''}`}
									onClick={() => editor.chain().focus().toggleItalic().run()}
								>
									<FontAwesomeIcon icon={faItalic} />
								</button>
								<button
									type="button"
									className={`${styles.bubbleMenuButton}${editor.isActive('underline') ? ` ${styles.bubbleMenuButtonActive}` : ''}`}
									onClick={() => editor.chain().focus().toggleUnderline().run()}
								>
									<FontAwesomeIcon icon={faUnderline} />
								</button>
								<button
									type="button"
									className={`${styles.bubbleMenuButton}${editor.isActive('strike') ? ` ${styles.bubbleMenuButtonActive}` : ''}`}
									onClick={() => editor.chain().focus().toggleStrike().run()}
								>
									<FontAwesomeIcon icon={faStrikethrough} />
								</button>
							</>
						) : null}
					</div>
				</BubbleMenu>
			) : null}
		</div>
	);
}