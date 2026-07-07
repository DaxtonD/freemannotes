import type { JSONContent } from '@tiptap/core';
import type { TitleToIdMap } from './ImportTypes';

/**
 * Convert a Markdown string to ProseMirror JSON compatible with Freeman Notes'
 * TipTap schema.  Handles: headings, paragraphs, bold, italic, strikethrough,
 * underline, highlight, code, links, bullet/ordered/task lists, blockquote,
 * code blocks, horizontal rules, tables, and Obsidian [[wikilinks]].
 *
 * wiki-link resolution: if titleToIdMap is supplied, [[Note Title]] is converted
 * to a reference chip node.  Otherwise it falls back to inline text.
 */
export function markdownToProsemirror(md: string, titleToIdMap?: TitleToIdMap): JSONContent {
	// Normalize Windows (\r\n) and legacy Mac (\r) line endings so \r doesn't
	// break regex assertions — `$` and `.` both treat \r as a line terminator.
	const lines = md.replace(/\r\n?/g, '\n').split('\n');
	const nodes: JSONContent[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Fenced code block
		if (line.trimStart().startsWith('```')) {
			const lang = line.trimStart().slice(3).trim() || null;
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
				codeLines.push(lines[i]);
				i++;
			}
			i++; // consume closing ```
			nodes.push({ type: 'codeBlock', attrs: { language: lang }, content: [{ type: 'text', text: codeLines.join('\n') }] });
			continue;
		}

		// Horizontal rule
		if (/^([-*_]){3,}\s*$/.test(line.trim())) {
			nodes.push({ type: 'horizontalRule' });
			i++;
			continue;
		}

		// Heading
		const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
		if (headingMatch) {
			const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
			// Include collapsible attrs so CollapsibleHeading schema validation passes
			nodes.push({ type: 'heading', attrs: { level, collapsible: false, collapseId: null }, content: parseInline(headingMatch[2], titleToIdMap) });
			i++;
			continue;
		}

		// Blockquote
		if (line.startsWith('> ')) {
			const bqLines: string[] = [];
			while (i < lines.length && lines[i].startsWith('> ')) {
				bqLines.push(lines[i].slice(2));
				i++;
			}
			const inner = markdownToProsemirror(bqLines.join('\n'), titleToIdMap);
			nodes.push({ type: 'blockquote', content: inner.content });
			continue;
		}

		// Table
		if (line.includes('|') && i + 1 < lines.length && /^\|[-| :]+\|$/.test(lines[i + 1].trim())) {
			const tableNode = parseTable(lines, i, titleToIdMap);
			nodes.push(tableNode.node);
			i = tableNode.nextIndex;
			continue;
		}

		// Task list item (GFM)
		if (/^[-*+]\s+\[[ xX]\]/.test(line)) {
			const taskItems: JSONContent[] = [];
			while (i < lines.length && /^[-*+]\s+\[[ xX]\]/.test(lines[i])) {
				const checked = /^[-*+]\s+\[[xX]\]/.test(lines[i]);
				const text = lines[i].replace(/^[-*+]\s+\[[ xX]\]\s*/, '');
				taskItems.push({
					type: 'taskItem',
					attrs: { checked },
					content: [{ type: 'paragraph', content: parseInline(text, titleToIdMap) }],
				});
				i++;
			}
			nodes.push({ type: 'taskList', content: taskItems });
			continue;
		}

		// Bullet list
		if (/^[-*+]\s/.test(line)) {
			const listItems: JSONContent[] = [];
			while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
				const text = lines[i].replace(/^[-*+]\s+/, '');
				listItems.push({ type: 'listItem', content: [{ type: 'paragraph', content: parseInline(text, titleToIdMap) }] });
				i++;
			}
			nodes.push({ type: 'bulletList', content: listItems });
			continue;
		}

		// Ordered list
		if (/^\d+\.\s/.test(line)) {
			const listItems: JSONContent[] = [];
			while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
				const text = lines[i].replace(/^\d+\.\s+/, '');
				listItems.push({ type: 'listItem', content: [{ type: 'paragraph', content: parseInline(text, titleToIdMap) }] });
				i++;
			}
			nodes.push({ type: 'orderedList', attrs: { start: 1 }, content: listItems });
			continue;
		}

		// Empty line — skip
		if (line.trim() === '') {
			i++;
			continue;
		}

		// Paragraph — collect consecutive non-block, non-empty lines
		const paraLines: string[] = [];
		while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
			paraLines.push(lines[i]);
			i++;
		}
		if (paraLines.length > 0) {
			const content = parseInline(paraLines.join(' '), titleToIdMap);
			nodes.push({ type: 'paragraph', content });
		} else {
			// Safety valve: if no block pattern claimed this non-empty line and
			// the paragraph collector also refused it (isBlockStart was true but
			// no earlier branch handled it), emit it as plain text and advance.
			// Without this, i never changes and the outer while loops forever.
			if (i < lines.length && lines[i].trim() !== '') {
				nodes.push({ type: 'paragraph', content: parseInline(lines[i], titleToIdMap) });
			}
			i++;
		}
	}

	if (nodes.length === 0) {
		nodes.push({ type: 'paragraph', content: [] });
	}

	return { type: 'doc', content: nodes };
}

function isBlockStart(line: string): boolean {
	return /^#{1,6}\s/.test(line) ||
		/^[-*+]\s+\[[ xX]\]/.test(line) ||
		/^[-*+]\s/.test(line) ||
		/^\d+\.\s/.test(line) ||
		/^> /.test(line) ||
		line.trimStart().startsWith('```') ||
		/^([-*_]){3,}\s*$/.test(line.trim());
	// Note: pipe characters are NOT a block-start signal here. The table check in
	// the main loop already gates on the next line being a separator row. Adding
	// line.includes('|') here would cause an infinite loop for any non-table line
	// that contains a pipe (e.g. URLs, "A | B" text, Keep notes with separators).
}

function parseTable(lines: string[], startIndex: number, titleToIdMap?: TitleToIdMap): { node: JSONContent; nextIndex: number } {
	const headerLine = lines[startIndex];
	const separatorLine = lines[startIndex + 1];
	const headers = parseTableRow(headerLine);
	const alignments = separatorLine.split('|').filter((c) => c.trim()).map((c) => {
		const t = c.trim();
		if (t.startsWith(':') && t.endsWith(':')) return 'center';
		if (t.endsWith(':')) return 'right';
		return null;
	});

	const rows: string[][] = [];
	let i = startIndex + 2;
	while (i < lines.length && lines[i].includes('|')) {
		rows.push(parseTableRow(lines[i]));
		i++;
	}

	const headerRow: JSONContent = {
		type: 'tableRow',
		content: headers.map((h, idx) => ({
			type: 'tableHeader',
			attrs: { colspan: 1, rowspan: 1, colwidth: null, alignment: alignments[idx] ?? null },
			content: [{ type: 'paragraph', content: parseInline(h, titleToIdMap) }],
		})),
	};

	const bodyRows: JSONContent[] = rows.map((row) => ({
		type: 'tableRow',
		content: row.map((cell, idx) => ({
			type: 'tableCell',
			attrs: { colspan: 1, rowspan: 1, colwidth: null, alignment: alignments[idx] ?? null },
			content: [{ type: 'paragraph', content: parseInline(cell, titleToIdMap) }],
		})),
	}));

	return {
		node: { type: 'table', content: [headerRow, ...bodyRows] },
		nextIndex: i,
	};
}

function parseTableRow(line: string): string[] {
	return line.split('|').slice(1, -1).map((c) => c.trim());
}

/** Parse inline Markdown to ProseMirror inline nodes. */
export function parseInline(text: string, titleToIdMap?: TitleToIdMap): JSONContent[] {
	const nodes: JSONContent[] = [];
	// Tokenize with a regex that captures all inline patterns
	// Group indices:
	// 1=outer 2=boldItalic 3=bold 4=underline 5=strike 6=highlight 7=code
	// 8=italic1 9=italic2 10=linkText 11=linkHref 12=wikilink 13=bareUrl
	const pattern = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|==(.+?)==|`(.+?)`|\*(.+?)\*|_(.+?)_|\[([^\]]+)\]\(([^)]+)\)|\[\[([^\]]+)\]\]|!\[[^\]]*\]\([^)]+\)|(https?:\/\/[^\s<>"')\]]+))/g;

	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(text)) !== null) {
		// Text before this match
		if (match.index > lastIndex) {
			nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
		}

		const [full, , boldItalic, bold, underline, strike, highlight, code, italic1, italic2, linkText, linkHref, wikilink, bareUrl] = match;
		const linkAttrs = (href: string) => ({ href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null });

		if (boldItalic) {
			nodes.push({ type: 'text', text: boldItalic, marks: [{ type: 'bold' }, { type: 'italic' }] });
		} else if (bold) {
			nodes.push({ type: 'text', text: bold, marks: [{ type: 'bold' }] });
		} else if (underline) {
			nodes.push({ type: 'text', text: underline, marks: [{ type: 'underline' }] });
		} else if (strike) {
			nodes.push({ type: 'text', text: strike, marks: [{ type: 'strike' }] });
		} else if (highlight) {
			nodes.push({ type: 'text', text: highlight, marks: [{ type: 'highlight', attrs: { color: null } }] });
		} else if (code) {
			nodes.push({ type: 'text', text: code, marks: [{ type: 'code' }] });
		} else if (italic1 || italic2) {
			nodes.push({ type: 'text', text: (italic1 || italic2)!, marks: [{ type: 'italic' }] });
		} else if (linkText && linkHref) {
			nodes.push({ type: 'text', text: linkText, marks: [{ type: 'link', attrs: linkAttrs(linkHref) }] });
		} else if (bareUrl) {
			// Strip trailing punctuation that commonly follows URLs in prose
			const url = bareUrl.replace(/[.,;!?)]+$/, '');
			nodes.push({ type: 'text', text: url, marks: [{ type: 'link', attrs: linkAttrs(url) }] });
		} else if (wikilink) {
			// Resolve [[Note Title]] → reference chip if we have the ID, else plain text
			const noteId = titleToIdMap?.get(wikilink.trim().toLowerCase());
			if (noteId) {
				nodes.push({
					type: 'reference',
					attrs: { id: noteId, type: 'note', label: wikilink.trim(), noteType: 'text', avatarUrl: null },
				});
			} else {
				nodes.push({ type: 'text', text: wikilink.trim() });
			}
		} else if (full.startsWith('!')) {
			// Image — skip (can't embed in rich text)
		}

		lastIndex = pattern.lastIndex;
	}

	// Remaining text after last match
	if (lastIndex < text.length) {
		nodes.push({ type: 'text', text: text.slice(lastIndex) });
	}

	return nodes;
}

/**
 * Recursively strip nodes that would fail ProseMirror schema validation:
 * - text nodes with empty or whitespace-only `text`
 * - content arrays reduced to nothing after filtering
 *
 * Call this on ProseMirror JSON before passing to replaceRichFragmentFromJson
 * so y-prosemirror does not throw on edge cases produced by our MD parser.
 */
export function sanitizeProsemirrorJson(node: unknown): unknown {
	if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
	const n = node as Record<string, unknown>;
	if (n['type'] === 'text') {
		// ProseMirror forbids text nodes with empty string
		if (typeof n['text'] !== 'string' || n['text'] === '') return null;
		return n;
	}
	if (Array.isArray(n['content'])) {
		const cleaned = (n['content'] as unknown[])
			.map(sanitizeProsemirrorJson)
			.filter((c): c is unknown => c !== null);
		return { ...n, content: cleaned };
	}
	return n;
}

/** Parse YAML frontmatter from a Markdown string. Returns { meta, body }. */
export function parseFrontmatter(md: string): { meta: Record<string, unknown>; body: string } {
	if (!md.startsWith('---')) return { meta: {}, body: md };
	const end = md.indexOf('\n---', 3);
	if (end === -1) return { meta: {}, body: md };
	const yamlStr = md.slice(4, end);
	const body = md.slice(end + 4).trimStart();
	const meta: Record<string, unknown> = {};
	for (const line of yamlStr.split('\n')) {
		const colon = line.indexOf(':');
		if (colon < 1) continue;
		const key = line.slice(0, colon).trim();
		const rawValue = line.slice(colon + 1).trim();
		// Simple list detection: "- item"
		if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
			meta[key] = rawValue.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
		} else {
			meta[key] = rawValue.replace(/^["']|["']$/g, '');
		}
	}
	return { meta, body };
}
