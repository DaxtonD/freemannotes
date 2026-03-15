import { generateText, getSchema, type Extensions, type JSONContent } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
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
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';

export const TEXT_NOTE_RICH_FIELD = 'contentRich';
export const CHECKLIST_ITEM_RICH_FIELD = 'contentRich';

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
const MARKDOWN_INLINE_PATTERN = /(\*\*[^*\n][\s\S]*?\*\*|__[^_\n][\s\S]*?__|~~[^~\n][\s\S]*?~~|`[^`\n]+`|\[[^\]]+\]\([^\)]+\)|!\[[^\]]*\]\([^\)]+\))/;

function buildStarterKit(variant: RichTextVariant) {
	if (variant === 'minimal') {
		return StarterKit.configure({
			undoRedo: false,
			link: false,
			underline: false,
			heading: false,
			bulletList: false,
			orderedList: false,
			blockquote: false,
			codeBlock: false,
			strike: false,
			horizontalRule: false,
		});
	}

	return StarterKit.configure({
		undoRedo: false,
		link: false,
		underline: false,
	});
}

export function createRichTextExtensions(args: {
	variant: RichTextVariant;
	placeholder?: string;
	includeCollaboration?: boolean;
	fragment?: Y.XmlFragment | null;
}): Extensions {
	const extensions: Extensions = [
		buildStarterKit(args.variant),
		Underline,
		Link.configure({
			autolink: true,
			openOnClick: false,
			defaultProtocol: 'https',
		}),
	];

	if (args.variant === 'full') {
		extensions.push(
			TaskList,
			TaskItem.configure({ nested: true }),
			Table.configure({ resizable: false }),
			TableRow,
			TableHeader,
			TableCell,
			TextAlign.configure({ types: ['heading', 'paragraph'] })
		);
	}

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
	return generateText(json, createRichTextExtensions({ variant }), { blockSeparator: variant === 'full' ? '\n' : '\n\n' }).trimEnd();
}

export function getPlainTextFromRichFragment(fragment: Y.XmlFragment, variant: RichTextVariant): string {
	if (fragment.length === 0) return '';
	return getPlainTextFromRichJson(yXmlFragmentToProsemirrorJSON(fragment) as JSONContent, variant);
}

export function replaceRichFragmentFromJson(fragment: Y.XmlFragment, json: JSONContent, variant: RichTextVariant): void {
	if (fragment.length > 0) {
		fragment.delete(0, fragment.length);
	}
	prosemirrorJSONToYXmlFragment(getSchemaForVariant(variant), json, fragment);
}

export function ensureTextNoteRichContent(doc: Y.Doc): Y.XmlFragment {
	const fragment = doc.getXmlFragment(TEXT_NOTE_RICH_FIELD);
	if (fragment.length === 0) {
		replaceRichFragmentFromJson(fragment, createRichTextDocFromPlainText(doc.getText('content').toString(), 'full'), 'full');
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
		fragment = new Y.XmlFragment();
		itemMap.set(CHECKLIST_ITEM_RICH_FIELD, fragment);
	}
	if (fragment.length === 0) {
		replaceRichFragmentFromJson(fragment, createRichTextDocFromPlainText(String(itemMap.get('text') ?? '')), 'minimal');
	}
	return fragment;
}

export function syncChecklistItemPlainText(itemMap: Y.Map<any>, fragment: Y.XmlFragment): string {
	const next = getPlainTextFromRichFragment(fragment, 'minimal');
	itemMap.set('text', next);
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

function looksLikeMarkdown(text: string): boolean {
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

function getVisibleClipboardTextFromHtml(html: string): string {
	if (typeof DOMParser === 'undefined') return '';
	const doc = new DOMParser().parseFromString(html, 'text/html');
	return (doc.body.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trim();
}

export function getMarkdownPasteHtml(args: {
	text: string;
	html?: string | null;
	variant: RichTextVariant;
}): string | null {
	if (args.variant !== 'full') return null;
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
	const rendered = markdownParser.render(text).trim();
	if (rendered.length === 0) return null;
	return normalizeMarkdownTaskListHtml(rendered);
}