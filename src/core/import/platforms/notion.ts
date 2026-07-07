import type { ParsedNote, ParsedWorkspace, RawFile, TitleToIdMap } from '../ImportTypes';
import { markdownToProsemirror, parseFrontmatter } from '../markdownToProsemirror';
import { makeNoteId } from '../../noteModel';

/**
 * Parse a Notion export (Markdown & CSV format).
 *
 * Notion exports Markdown files with UUID suffixes: "Page Title abc123def456.md".
 * Nested pages become separate files in subdirectories matching the parent page name.
 * The top-level directory name becomes the workspace name.
 */
export async function parseNotion(files: RawFile[]): Promise<ParsedWorkspace[]> {
	const mdFiles = files.filter((f) => f.ext === 'md');

	// Strip the 32-char UUID suffix Notion appends to filenames
	function stripNotionId(name: string): string {
		return name.replace(/\s+[a-f0-9]{32}(\.md)?$/i, '').trim();
	}

	// ── Pass 1: enumerate notes, build title → ID map ───────────────────────
	const titleToId: TitleToIdMap = new Map();
	const noteEntries: Array<{ file: RawFile; noteId: string; workspaceName: string; title: string }> = [];

	for (const file of mdFiles) {
		const noteId = makeNoteId('notion');
		const stem = stripNotionId(file.name.replace(/\.md$/i, ''));
		titleToId.set(stem.toLowerCase(), noteId);

		const parts = file.path.replace(/\\/g, '/').split('/');
		const workspaceName = parts.length > 1 ? stripNotionId(parts[0]) : 'Notion Import';

		noteEntries.push({ file, noteId, workspaceName, title: stem });
	}

	// ── Pass 2: parse content ────────────────────────────────────────────────
	const workspaceMap = new Map<string, ParsedNote[]>();

	for (const { file, noteId, workspaceName, title } of noteEntries) {
		const raw = await file.text();
		const { meta, body } = parseFrontmatter(raw);

		// Strip any leading H1 that matches the filename title
		const bodyWithoutTitle = body.replace(/^#\s+.+\n?/, '').trimStart();
		const rich = markdownToProsemirror(bodyWithoutTitle || body, titleToId);

		const tagsMeta = meta['tags'];
		const labelNames: string[] = Array.isArray(tagsMeta) ? tagsMeta.map(String) : [];

		const note: ParsedNote = { noteId, title, type: 'text', richContent: rich, labelNames };

		const created = meta['Created time'] ?? meta['created_time'];
		if (created) {
			const ts = Date.parse(String(created));
			if (!isNaN(ts)) note.createdAt = ts;
		}

		const existing = workspaceMap.get(workspaceName) ?? [];
		existing.push(note);
		workspaceMap.set(workspaceName, existing);
	}

	return [...workspaceMap.entries()].map(([name, notes]) => ({ name, notes }));
}
