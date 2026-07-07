import type { ParsedNote, ParsedWorkspace, RawFile } from '../ImportTypes';
import { markdownToProsemirror } from '../markdownToProsemirror';
import { makeNoteId } from '../../noteModel';

interface KeepListItem {
	text: string;
	isChecked: boolean;
}

interface KeepAttachment {
	filePath: string;
	mimetype: string;
}

interface KeepNote {
	title?: string;
	textContent?: string;
	listContent?: KeepListItem[];
	labels?: Array<{ name: string }>;
	color?: string;
	isTrashed?: boolean;
	isArchived?: boolean;
	createdTimestampUsec?: number;
	userEditedTimestampUsec?: number;
	attachments?: KeepAttachment[];
}

// Keep color name → Freeman Notes color token
const KEEP_COLOR_MAP: Record<string, string> = {
	RED: 'red',
	PINK: 'pink',
	PURPLE: 'purple',
	BLUE: 'blue',
	TEAL: 'teal',
	GREEN: 'green',
	YELLOW: 'yellow',
	ORANGE: 'orange',
	BROWN: 'brown',
	GRAY: 'gray',
	GRAPHITE: 'graphite',
};

/**
 * Parse a Google Keep Takeout export.
 *
 * Keep exports all notes as individual JSON files in a flat directory.
 * Each JSON file has: title, textContent OR listContent, labels, color, timestamps.
 */
export interface GoogleKeepParseResult {
	workspaces: ParsedWorkspace[];
	imageCount: number;
}

export async function parseGoogleKeep(files: RawFile[]): Promise<ParsedWorkspace[]> {
	const { workspaces } = await parseGoogleKeepWithStats(files);
	return workspaces;
}

export async function parseGoogleKeepWithStats(files: RawFile[]): Promise<GoogleKeepParseResult> {
	const jsonFiles = files.filter((f) => f.ext === 'json' && !f.name.startsWith('Labels.'));

	const notes: ParsedNote[] = [];
	let imageCount = 0;

	for (let i = 0; i < jsonFiles.length; i++) {
		// Yield to the event loop every 50 files so JSZip decompression work
		// doesn't starve the browser's rendering and input queues.
		if (i > 0 && i % 50 === 0) {
			await new Promise<void>((r) => setTimeout(r, 0));
		}
		const file = jsonFiles[i];
		try {
			const text = await file.text();
			const data: KeepNote = JSON.parse(text);

			// Skip trashed notes
			if (data.isTrashed) continue;

			const title = (data.title || '').trim();
			const labelNames = (data.labels ?? []).map((l) => l.name).filter(Boolean);
			const colorToken = data.color ? (KEEP_COLOR_MAP[data.color.toUpperCase()] ?? null) : null;
			const createdAt = data.createdTimestampUsec ? Math.floor(data.createdTimestampUsec / 1000) : undefined;

			// Count image attachments (not yet importable, but reported to the user)
			if (data.attachments && data.attachments.length > 0) {
				imageCount += data.attachments.filter(
					(a) => a.mimetype?.startsWith('image/')
				).length;
			}

			const noteId = makeNoteId('keep');

			if (data.listContent && data.listContent.length > 0) {
				// Checklist note
				const items = data.listContent.map((item) => ({
					id: makeNoteId('item'),
					text: item.text,
					completed: item.isChecked,
					parentId: null as string | null,
				}));
				notes.push({ noteId, title: title || 'Untitled', type: 'checklist', items, labelNames, colorToken, createdAt });
			} else {
				// Text note
				const body = (data.textContent || '').trim();
				const rich = markdownToProsemirror(body);
				notes.push({ noteId, title: title || body.slice(0, 60) || 'Untitled', type: 'text', richContent: rich, labelNames, colorToken, createdAt });
			}
		} catch { /* skip malformed JSON */ }
	}

	if (notes.length === 0) return { workspaces: [], imageCount };
	return { workspaces: [{ name: 'Google Keep', notes }], imageCount };
}
