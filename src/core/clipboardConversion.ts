import TurndownService from 'turndown';
import { gfm, tables, strikethrough } from 'turndown-plugin-gfm';
import {
	getVisibleClipboardTextFromHtml,
	isMeaningfulClipboardHtml,
	looksLikeMarkdown,
	renderMarkdownToRichHtml,
	wrapClipboardHtmlDocument,
} from './richText';

export type ClipboardConversionInput = {
	text: string;
	html?: string | null;
};

export type ClipboardConversionTarget = 'markdown' | 'rich-text';

export type ClipboardPayload = {
	text: string;
	html?: string;
};

export type ClipboardSourceFormat = 'markdown' | 'rich-text' | 'plain-text';

const turndown = new TurndownService({
	bulletListMarker: '-',
	codeBlockStyle: 'fenced',
	emDelimiter: '*',
	headingStyle: 'atx',
	strongDelimiter: '**',
});

turndown.use([gfm, tables, strikethrough]);

// TipTap task lists serialize checkbox state into data attributes. Teach Turndown
// how to preserve those markers so Markdown copy/export round-trips cleanly.
turndown.addRule('tiptapTaskItem', {
	filter(node) {
		return node.nodeName === 'LI' && (node as Element).getAttribute('data-type') === 'taskItem';
	},
	replacement(content, node) {
		const checked = (node as Element).getAttribute('data-checked') === 'true';
		const cleaned = content
			.replace(/^\s*\[[ xX]\]\s*/m, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
		return `\n- [${checked ? 'x' : ' '}] ${cleaned}\n`;
	},
});

turndown.addRule('tiptapTaskLabel', {
	filter(node) {
		return node.nodeName === 'LABEL' && (node.parentElement?.getAttribute('data-type') === 'taskItem');
	},
	replacement() {
		return '';
	},
});

function normalizeText(text: string): string {
	return String(text ?? '').replace(/\r\n?/g, '\n').trim();
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function plainTextToHtml(text: string): string {
	const normalized = normalizeText(text);
	if (!normalized) return '<p></p>';
	return normalized
		.split(/\n{2,}/)
		.map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
		.join('');
}

function normalizeHtml(html: string): string {
	const trimmed = String(html ?? '').trim();
	if (!trimmed) return '';
	if (typeof DOMParser === 'undefined') return trimmed;
	const doc = new DOMParser().parseFromString(trimmed, 'text/html');
	for (const node of Array.from(doc.querySelectorAll('script, style, meta'))) {
		node.remove();
	}
	return doc.body.innerHTML.trim();
}

export function detectClipboardSourceFormat(input: string | ClipboardConversionInput): ClipboardSourceFormat {
	const normalized = typeof input === 'string'
		? { text: normalizeText(input), html: '' }
		: { text: normalizeText(input.text), html: normalizeHtml(input.html ?? '') };
	if (looksLikeMarkdown(normalized.text)) return 'markdown';
	if (normalized.html && isMeaningfulClipboardHtml(normalized.html)) return 'rich-text';
	return 'plain-text';
}

export function convertToMarkdown(input: string | ClipboardConversionInput): string {
	const normalized = typeof input === 'string'
		? { text: normalizeText(input), html: '' }
		: { text: normalizeText(input.text), html: normalizeHtml(input.html ?? '') };
	const sourceFormat = detectClipboardSourceFormat(normalized);
	if (sourceFormat === 'markdown') return normalized.text;
	if (sourceFormat === 'rich-text' && normalized.html) {
		return turndown.turndown(normalized.html).trim();
	}
	return normalized.text;
}

export function convertToRichText(input: string | ClipboardConversionInput): string {
	const normalized = typeof input === 'string'
		? { text: normalizeText(input), html: '' }
		: { text: normalizeText(input.text), html: normalizeHtml(input.html ?? '') };
	const sourceFormat = detectClipboardSourceFormat(normalized);
	if (sourceFormat === 'rich-text' && normalized.html) return normalized.html;
	if (sourceFormat === 'markdown') {
		return renderMarkdownToRichHtml(normalized.text) ?? plainTextToHtml(normalized.text);
	}
	return normalized.html || plainTextToHtml(normalized.text);
}

// Structure or marks that Markdown can represent and plain text cannot. If a selection has
// none of these, its Markdown and its plain text are the same string anyway.
const FORMATTED_HTML_PATTERN = /<(h[1-6]|ul|ol|li|blockquote|pre|code|table|thead|tbody|tr|th|td|hr|strong|b|em|i|u|s|del|mark|a)\b/i;

/**
 * What goes on the clipboard when you copy out of a note.
 *
 * Both formats, every time: `text/html` for anything that understands rich text (Word, Docs,
 * Outlook, email) and `text/plain` for anything that doesn't (editors, terminals, GitHub,
 * chat). The destination picks, so nobody has to choose a mode up front — and "paste as plain
 * text" (Ctrl+Shift+V in most apps) forces the Markdown even into a rich destination.
 *
 * The one subtlety: `text/plain` is Markdown **only when the selection actually has formatting
 * worth preserving**. Turndown escapes Markdown-significant characters, so running plain prose
 * through it turns "50% * 2" into "50% \\* 2" — noise, in a search box or a chat message, in
 * exchange for nothing. Unformatted text has identical Markdown and plain text, so skipping the
 * conversion there costs nothing and avoids the escaping entirely.
 */
export function prepareEditorCopyPayload(input: string | ClipboardConversionInput): ClipboardPayload {
	const normalized = typeof input === 'string'
		? { text: normalizeText(input), html: '' }
		: { text: normalizeText(input.text), html: normalizeHtml(input.html ?? '') };
	const html = convertToRichText(normalized);
	const plain = html ? getVisibleClipboardTextFromHtml(html) || normalized.text : normalized.text;
	const text = html && FORMATTED_HTML_PATTERN.test(html)
		? (convertToMarkdown(normalized) || plain)
		: plain;
	return { text, html: html ? wrapClipboardHtmlDocument(html) : undefined };
}

export function prepareConvertedClipboardPayload(
	input: string | ClipboardConversionInput,
	target: ClipboardConversionTarget,
): ClipboardPayload {
	if (target === 'markdown') {
		return { text: convertToMarkdown(input) };
	}

	const html = convertToRichText(input);
	// Always ship a plain-text sibling payload because many clipboard consumers
	// prefer text/plain even when rich HTML is also present.
	const text = html ? getVisibleClipboardTextFromHtml(html) || (typeof input === 'string' ? normalizeText(input) : normalizeText(input.text)) : (typeof input === 'string' ? normalizeText(input) : normalizeText(input.text));
	return { text, html: html ? wrapClipboardHtmlDocument(html) : undefined };
}