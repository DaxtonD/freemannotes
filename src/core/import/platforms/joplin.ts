import type { ParsedNote, ParsedWorkspace, RawFile, TitleToIdMap } from '../ImportTypes';
import { markdownToProsemirror, parseFrontmatter } from '../markdownToProsemirror';
import { makeNoteId } from '../../noteModel';

interface JoplinMeta {
	id?: string;
	parent_id?: string;
	title?: string;
	created_time?: string;
	updated_time?: string;
	is_todo?: string | number;
	todo_completed?: string | number;
	type_?: string | number;
}

/**
 * Parse a Joplin export (JEX format extracted, or raw MD export).
 *
 * Joplin exports Markdown files named with their UUID. Each file contains
 * YAML-like frontmatter with `id`, `parent_id`, `title`, and timestamps.
 * Folder notes have `type_: 2`.
 */
export async function parseJoplin(files: RawFile[]): Promise<ParsedWorkspace[]> {
	const mdFiles = files.filter((f) => f.ext === 'md');

	// ── Pass 1: enumerate all items (notes + folders) ───────────────────────
	type JoplinItem = {
		file: RawFile;
		joplinId: string;
		parentId: string | null;
		title: string;
		isFolder: boolean;
		noteId: string; // Freeman Notes ID
		createdAt?: number;
	};

	const items: JoplinItem[] = [];
	const joplinIdToItem = new Map<string, JoplinItem>();
	const titleToId: TitleToIdMap = new Map();

	for (const file of mdFiles) {
		const raw = await file.text();
		const { meta, body } = parseFrontmatter(raw);
		const jMeta = meta as JoplinMeta;

		const joplinId = String(jMeta.id ?? '').trim();
		const parentId = String(jMeta.parent_id ?? '').trim() || null;
		const title = String(jMeta.title ?? file.name.replace(/\.md$/i, '')).trim();
		const typeNum = Number(jMeta.type_ ?? 1);
		const isFolder = typeNum === 2;
		const noteId = makeNoteId('joplin');
		const createdAt = jMeta.created_time ? Date.parse(String(jMeta.created_time)) || undefined : undefined;

		const item: JoplinItem = { file, joplinId, parentId, title, isFolder, noteId, createdAt };
		items.push(item);
		if (joplinId) {
			joplinIdToItem.set(joplinId, item);
			titleToId.set(title.toLowerCase(), noteId);
		}
	}

	// ── Build folder hierarchy ───────────────────────────────────────────────
	// Top-level folders (parentId is '' or points to a non-existent item) become workspaces.
	function getFolderPath(joplinId: string, depth = 0): string[] {
		if (depth > 10) return [];
		const item = joplinIdToItem.get(joplinId);
		if (!item || !item.isFolder) return [];
		if (!item.parentId || !joplinIdToItem.has(item.parentId)) return [item.title];
		return [...getFolderPath(item.parentId, depth + 1), item.title];
	}

	// ── Pass 2: parse note content ───────────────────────────────────────────
	const workspaceMap = new Map<string, ParsedNote[]>();

	for (const item of items) {
		if (item.isFolder) continue;

		const raw = await item.file.text();
		const { meta, body } = parseFrontmatter(raw);
		const jMeta = meta as JoplinMeta;

		// Determine workspace from folder hierarchy
		const parentPath = item.parentId ? getFolderPath(item.parentId) : [];
		const workspaceName = parentPath.length > 0 ? parentPath[0] : 'Imported Notes';

		const isTodo = Number(jMeta.is_todo) === 1;
		const labelNames: string[] = [];

		let note: ParsedNote;

		if (isTodo) {
			// Joplin todo is a single-item checklist
			const completed = Number(jMeta.todo_completed) > 0;
			note = {
				noteId: item.noteId,
				title: item.title,
				type: 'checklist',
				items: [{ id: makeNoteId('item'), text: body.trim(), completed, parentId: null }],
				labelNames,
				createdAt: item.createdAt,
			};
		} else {
			const rich = markdownToProsemirror(body, titleToId);
			note = { noteId: item.noteId, title: item.title, type: 'text', richContent: rich, labelNames, createdAt: item.createdAt };
		}

		const existing = workspaceMap.get(workspaceName) ?? [];
		existing.push(note);
		workspaceMap.set(workspaceName, existing);
	}

	return [...workspaceMap.entries()].map(([name, notes]) => ({ name, notes }));
}
