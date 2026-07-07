import type { JSONContent } from '@tiptap/core';

/**
 * Serialize a ProseMirror JSONContent document to Markdown.
 * Used for client-side single-note export.
 */
export function prosemirrorToMarkdown(doc: JSONContent): string {
	if (!doc?.content) return '';
	return doc.content.map((node) => blockNodeToMarkdown(node)).join('\n\n').trim();
}

function blockNodeToMarkdown(node: JSONContent, listDepth = 0): string {
	switch (node.type) {
		case 'heading': {
			const level = (node.attrs?.level as number) ?? 1;
			const text = inlineToMarkdown(node.content ?? []);
			return `${'#'.repeat(level)} ${text}`;
		}
		case 'paragraph': {
			const text = inlineToMarkdown(node.content ?? []);
			return text || '';
		}
		case 'blockquote': {
			const inner = (node.content ?? []).map((n) => blockNodeToMarkdown(n)).join('\n\n');
			return inner.split('\n').map((l) => `> ${l}`).join('\n');
		}
		case 'codeBlock': {
			const lang = String(node.attrs?.language ?? '');
			const text = (node.content ?? []).map((n) => n.text ?? '').join('');
			return `\`\`\`${lang}\n${text}\n\`\`\``;
		}
		case 'horizontalRule':
			return '---';
		case 'bulletList': {
			return (node.content ?? []).map((item) => listItemToMarkdown(item, '-', listDepth)).join('\n');
		}
		case 'orderedList': {
			const start = (node.attrs?.start as number) ?? 1;
			return (node.content ?? []).map((item, idx) => listItemToMarkdown(item, `${start + idx}.`, listDepth)).join('\n');
		}
		case 'taskList': {
			return (node.content ?? []).map((item) => {
				const checked = Boolean(item.attrs?.checked);
				const inner = (item.content ?? []).map((n) => blockNodeToMarkdown(n, listDepth + 1)).join('\n').trim();
				return `${'  '.repeat(listDepth)}- [${checked ? 'x' : ' '}] ${inner}`;
			}).join('\n');
		}
		case 'table':
			return tableToMarkdown(node);
		default:
			return (node.content ?? []).map((n) => blockNodeToMarkdown(n)).join('\n\n');
	}
}

function listItemToMarkdown(item: JSONContent, prefix: string, depth: number): string {
	const inner = (item.content ?? []).map((n) => {
		if (n.type === 'paragraph') return inlineToMarkdown(n.content ?? []);
		return blockNodeToMarkdown(n, depth + 1);
	}).join('\n');
	return `${'  '.repeat(depth)}${prefix} ${inner}`;
}

function tableToMarkdown(node: JSONContent): string {
	const rows = node.content ?? [];
	if (rows.length === 0) return '';
	const headerRow = rows[0];
	const headerCells = (headerRow.content ?? []).map((cell) =>
		inlineToMarkdown((cell.content?.[0]?.content) ?? [])
	);
	const separator = headerCells.map(() => '---');
	const bodyRows = rows.slice(1).map((row) =>
		(row.content ?? []).map((cell) => inlineToMarkdown((cell.content?.[0]?.content) ?? []))
	);
	const allRows = [headerCells, separator, ...bodyRows];
	return allRows.map((row) => `| ${row.join(' | ')} |`).join('\n');
}

function inlineToMarkdown(nodes: JSONContent[]): string {
	return nodes.map((node) => {
		if (node.type === 'hardBreak') return '\n';
		if (node.type === 'reference') {
			// Reference chip → wikilink style
			return `[[${node.attrs?.label ?? node.attrs?.id ?? ''}]]`;
		}
		const text = node.text ?? (node.content ? node.content.map((n) => n.text ?? '').join('') : '');
		if (!text) return '';
		const marks: string[] = ((node.marks ?? []) as JSONContent[]).map((m) => m.type ?? '');
		let out = text;
		if (marks.includes('code')) return `\`${out}\``;
		if (marks.includes('bold') && marks.includes('italic')) return `***${out}***`;
		if (marks.includes('bold')) out = `**${out}**`;
		if (marks.includes('italic')) out = `*${out}*`;
		if (marks.includes('strike')) out = `~~${out}~~`;
		if (marks.includes('underline')) out = `__${out}__`;
		if (marks.includes('highlight')) out = `==${out}==`;
		const linkMark = (node.marks ?? [] as JSONContent[]).find((m: JSONContent) => m.type === 'link');
		if (linkMark) out = `[${out}](${(linkMark as JSONContent).attrs?.href ?? ''})`;
		return out;
	}).join('');
}

/** Trigger a file download in the browser. */
export function downloadTextFile(filename: string, content: string): void {
	const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
