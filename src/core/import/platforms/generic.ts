import type { ParsedNote, ParsedWorkspace, RawFile, TitleToIdMap } from '../ImportTypes';
import { markdownToProsemirror, parseFrontmatter } from '../markdownToProsemirror';
import { makeNoteId } from '../../noteModel';

/**
 * Generic Markdown / plain-text import.
 *
 * Handles a loose mix of .md and .txt files with optional [[wikilinks]].
 * Folder structure maps to workspace names.  Supports the same YAML frontmatter
 * convention as Obsidian so this parser also handles Obsidian vaults that lack
 * the .obsidian directory.
 */
export async function parseGeneric(files: RawFile[]): Promise<ParsedWorkspace[]> {
	const textFiles = files.filter((f) => f.ext === 'md' || f.ext === 'txt' || f.ext === 'markdown');
	if (textFiles.length === 0) return [];

	// ── Pass 1: enumerate, assign IDs ────────────────────────────────────────
	const titleToId: TitleToIdMap = new Map();
	const entries: Array<{ file: RawFile; noteId: string; workspaceName: string }> = [];

	for (const file of textFiles) {
		const noteId = makeNoteId('generic');
		const stem = file.name.replace(/\.(md|txt|markdown)$/i, '');
		titleToId.set(stem.toLowerCase(), noteId);

		const parts = file.path.replace(/\\/g, '/').split('/');
		const workspaceName = parts.length > 1 ? parts[0] : 'Imported Notes';

		entries.push({ file, noteId, workspaceName });
	}

	// ── Pass 2: parse content ────────────────────────────────────────────────
	const workspaceMap = new Map<string, ParsedNote[]>();

	for (const { file, noteId, workspaceName } of entries) {
		const raw = await file.text();
		const { meta, body } = parseFrontmatter(raw);

		const stem = file.name.replace(/\.(md|txt|markdown)$/i, '');
		const title = (typeof meta.title === 'string' && meta.title) ? meta.title : stem;

		const tagsMeta = meta['tags'];
		const labelNames: string[] = Array.isArray(tagsMeta)
			? tagsMeta.map(String)
			: typeof tagsMeta === 'string' && tagsMeta
				? [tagsMeta]
				: [];

		// Check if body is purely a task list
		const nonEmpty = body.trim().split('\n').filter((l) => l.trim());
		const isChecklist = nonEmpty.length > 0 && nonEmpty.every((l) => /^[-*+]\s+\[[ xX]\]/.test(l.trim()));

		let note: ParsedNote;

		if (isChecklist) {
			const items = nonEmpty.map((l) => ({
				id: makeNoteId('item'),
				text: l.replace(/^[-*+]\s+\[[ xX]\]\s*/, '').trim(),
				completed: /^[-*+]\s+\[[xX]\]/.test(l.trim()),
				parentId: null as string | null,
			}));
			note = { noteId, title, type: 'checklist', items, labelNames };
		} else {
			const rich = markdownToProsemirror(body, titleToId);
			note = { noteId, title, type: 'text', richContent: rich, labelNames };
		}

		const createdRaw = meta['created'] ?? meta['date'];
		if (createdRaw) {
			const ts = Date.parse(String(createdRaw));
			if (!isNaN(ts)) note.createdAt = ts;
		}

		const existing = workspaceMap.get(workspaceName) ?? [];
		existing.push(note);
		workspaceMap.set(workspaceName, existing);
	}

	return [...workspaceMap.entries()].map(([name, notes]) => ({ name, notes }));
}
