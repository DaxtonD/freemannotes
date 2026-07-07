import type { ParsedNote, ParsedWorkspace, RawFile, TitleToIdMap } from '../ImportTypes';
import { markdownToProsemirror, parseFrontmatter } from '../markdownToProsemirror';
import { makeNoteId } from '../../noteModel';

/**
 * Parse an Obsidian vault export.
 *
 * Structure: flat or nested .md files, optional .obsidian/ config directory.
 * Features parsed: YAML frontmatter (tags, aliases, cssclasses), [[wikilinks]],
 * nested folder → workspace mapping.
 *
 * Two-pass: pass 1 enumerates notes and assigns IDs; pass 2 parses content
 * with wiki-link resolution.
 */
export async function parseObsidian(files: RawFile[]): Promise<ParsedWorkspace[]> {
	// Filter to .md files only (skip .obsidian/, images, etc.)
	const mdFiles = files.filter((f) => f.ext === 'md' && !f.path.includes('/.obsidian/') && !f.path.includes('\\.obsidian\\'));

	// ── Pass 1: enumerate notes, assign IDs, collect titles ─────────────────
	const titleToId: TitleToIdMap = new Map();
	const noteEntries: Array<{ file: RawFile; noteId: string; workspaceName: string }> = [];

	for (const file of mdFiles) {
		const noteId = makeNoteId('obs');
		// Title from filename (strip .md)
		const stem = file.name.replace(/\.md$/i, '');
		titleToId.set(stem.toLowerCase(), noteId);
		// Also index by full path stem for disambiguation
		const pathStem = file.path.replace(/\.md$/i, '').replace(/\\/g, '/');
		titleToId.set(pathStem.toLowerCase(), noteId);

		// Workspace from top-level folder
		const parts = file.path.replace(/\\/g, '/').split('/');
		const workspaceName = parts.length > 1 ? parts[0] : 'Imported Notes';

		noteEntries.push({ file, noteId, workspaceName });
	}

	// ── Pass 2: parse content ────────────────────────────────────────────────
	const workspaceMap = new Map<string, ParsedNote[]>();

	for (const { file, noteId, workspaceName } of noteEntries) {
		const raw = await file.text();
		const { meta, body } = parseFrontmatter(raw);

		const stem = file.name.replace(/\.md$/i, '');
		const title = (typeof meta.title === 'string' && meta.title) ? meta.title : stem;

		// Tags from frontmatter
		const tags: string[] = [];
		if (Array.isArray(meta.tags)) tags.push(...meta.tags.map(String));
		else if (typeof meta.tags === 'string' && meta.tags) tags.push(meta.tags);

		// Inline #tags in body — exclude anchor hrefs like (#prerequisites) inside link syntax
		const inlineTagMatches = body.matchAll(/(?<!\()#([\w/-]+)/g);
		for (const m of inlineTagMatches) {
			const tag = m[1].trim();
			if (tag && !tags.includes(tag)) tags.push(tag);
		}

		// Check if it's a checklist (only task list items)
		const isChecklist = body.trim().length > 0 &&
			body.trim().split('\n').filter((l) => l.trim()).every((l) => /^[-*+]\s+\[[ xX]\]/.test(l.trim()));

		let note: ParsedNote;

		if (isChecklist) {
			const items = body.trim().split('\n').filter((l) => l.trim()).map((l) => {
				const checked = /^[-*+]\s+\[[xX]\]/.test(l.trim());
				const text = l.replace(/^[-*+]\s+\[[ xX]\]\s*/, '').trim();
				return { id: makeNoteId('item'), text, completed: checked, parentId: null };
			});
			note = { noteId, title, type: 'checklist', items, labelNames: tags };
		} else {
			const rich = markdownToProsemirror(body, titleToId);
			note = { noteId, title, type: 'text', richContent: rich, labelNames: tags };
		}

		if (typeof meta.created === 'string' || typeof meta.created === 'number') {
			const ts = Date.parse(String(meta.created));
			if (!isNaN(ts)) note.createdAt = ts;
		}

		const existing = workspaceMap.get(workspaceName) ?? [];
		existing.push(note);
		workspaceMap.set(workspaceName, existing);
	}

	return [...workspaceMap.entries()].map(([name, notes]) => ({ name, notes }));
}
