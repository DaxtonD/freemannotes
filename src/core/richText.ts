import { generateText, getRenderedAttributes, getSchema, type Editor, type Extensions, type JSONContent } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
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
import { Plugin } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';

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
		Highlight.configure({ multicolor: true }),
		Link.configure({
			autolink: true,
			openOnClick: true,
			defaultProtocol: 'https',
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
	if (fragment.length > 0) {
		fragment.delete(0, fragment.length);
	}
	prosemirrorJSONToYXmlFragment(getSchemaForVariant(variant), json, fragment);
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