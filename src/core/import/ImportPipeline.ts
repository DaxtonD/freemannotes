import JSZip from 'jszip';
import * as Y from 'yjs';
import type { ParseResult, ParsedNote, ParsedWorkspace, RawFile } from './ImportTypes';
import { replaceRichFragmentFromJson } from '../richText';
import { sanitizeProsemirrorJson } from './markdownToProsemirror';
import { detectPlatform } from './platforms/detectPlatform';
import { parseObsidian } from './platforms/obsidian';
import { parseGoogleKeepWithStats } from './platforms/googleKeep';
import { parseJoplin } from './platforms/joplin';
import { parseNotion } from './platforms/notion';
import { parseOneNote } from './platforms/oneNote';
import { parseGeneric } from './platforms/generic';

// ── File extraction ───────────────────────────────────────────────────────────

async function extractRawFiles(input: File | FileList | File[]): Promise<RawFile[]> {
	const files = input instanceof FileList
		? Array.from(input)
		: Array.isArray(input) ? input : [input];

	const raw: RawFile[] = [];

	for (const file of files) {
		const ext = (file.name.split('.').pop() ?? '').toLowerCase();

		if (ext === 'zip') {
			// Yield to the macro-task queue first so the browser can render the
			// "Reading notes…" spinner before JSZip starts its CPU-bound work.
			// JSZip processes inside Promise microtasks which bypass the rendering queue,
			// so without this the UI appears frozen even though the call is async.
			await new Promise<void>((r) => setTimeout(r, 0));

			// Pass the File/Blob directly — JSZip reads the central directory only;
			// individual entry content is decompressed lazily on demand via entry.async().
			const zip = await JSZip.loadAsync(file);

			// Yield again after ZIP index is parsed so the browser can breathe before
			// we start iterating (potentially thousands of) entries.
			await new Promise<void>((r) => setTimeout(r, 0));

			let entryIdx = 0;
			for (const [path, entry] of Object.entries(zip.files)) {
				if (entry.dir) continue;
				// Yield every 200 entries so large archives (Google Takeout photos, etc.)
				// don't starve the event loop during the filter pass.
				if (++entryIdx % 200 === 0) {
					await new Promise<void>((r) => setTimeout(r, 0));
				}
				const name = path.split('/').pop() ?? path;
				const fileExt = (name.split('.').pop() ?? '').toLowerCase();
				if (!SUPPORTED_EXT.has(fileExt)) continue;
				raw.push({
					path,
					name,
					ext: fileExt,
					text: () => entry.async('string'),
					bytes: () => entry.async('arraybuffer'),
				});
			}
		} else if (SUPPORTED_EXT.has(ext)) {
			raw.push({
				path: file.webkitRelativePath || file.name,
				name: file.name,
				ext,
				text: () => file.text(),
				bytes: () => file.arrayBuffer(),
			});
		}
	}

	return raw;
}

const SUPPORTED_EXT = new Set(['md', 'txt', 'markdown', 'json', 'docx']);

// ── Main parse entry point ────────────────────────────────────────────────────

export async function runImportPipeline(input: File | FileList | File[]): Promise<ParseResult> {
	const rawFiles = await extractRawFiles(input);
	console.log('[Import] Extracted files:', rawFiles.map((f) => `${f.name} (${f.ext})`));

	if (rawFiles.length === 0) {
		console.warn('[Import] No supported files found in input');
		return { platform: 'generic', workspaces: [], allLabelNames: [], warnings: ['No supported files found.'], imageCount: 0 };
	}

	const platform = detectPlatform(rawFiles);
	console.log('[Import] Detected platform:', platform);

	let workspaces: ParsedWorkspace[] = [];
	const warnings: string[] = [];
	let imageCount = 0;

	try {
		switch (platform) {
			case 'obsidian': workspaces = await parseObsidian(rawFiles); break;
			case 'keep': {
				const keepResult = await parseGoogleKeepWithStats(rawFiles);
				workspaces = keepResult.workspaces;
				imageCount = keepResult.imageCount;
				break;
			}
			case 'joplin':   workspaces = await parseJoplin(rawFiles); break;
			case 'notion':   workspaces = await parseNotion(rawFiles); break;
			case 'onenote':  workspaces = await parseOneNote(rawFiles); break;
			default:         workspaces = await parseGeneric(rawFiles); break;
		}
		console.log('[Import] Parse complete:', workspaces.map((ws) => `"${ws.name}" (${ws.notes.length} notes)`));
	} catch (err) {
		const msg = `Parse error: ${err instanceof Error ? err.message : String(err)}`;
		console.error('[Import] Platform parser threw:', err);
		warnings.push(msg);
	}

	// Collect all unique label names
	const totalNotes = workspaces.reduce((sum, ws) => sum + ws.notes.length, 0);
	const allLabelNames = [...new Set(workspaces.flatMap((ws) => ws.notes.flatMap((n) => n.labelNames ?? [])))];

	if (warnings.length > 0) console.warn('[Import] Warnings:', warnings);
	console.log('[Import] Pipeline result:', { platform, workspaceCount: workspaces.length, totalNotes, imageCount, labelCount: allLabelNames.length });

	return { platform, workspaces, allLabelNames, warnings, imageCount };
}

// ── Yjs encoding (client-side, direct Y.Doc construction) ─────────────────────

export interface EncodedNote {
	noteId: string;
	title: string;
	type: string;
	state: string; // base64-encoded Yjs state
}

/**
 * Extract plain text from a ProseMirror JSON doc (for storing in Y.Text 'content').
 * Newlines are inserted between block nodes so paragraphs remain distinct.
 */
export function extractPlainText(json: unknown): string {
	if (!json || typeof json !== 'object') return '';
	const node = json as { type?: string; text?: string; content?: unknown[] };
	if (typeof node.text === 'string') return node.text;
	if (!Array.isArray(node.content)) return '';
	const parts = node.content.map(extractPlainText);
	const blockTypes = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'taskItem', 'tableRow']);
	const sep = blockTypes.has(node.type ?? '') ? '\n' : '';
	return parts.join(sep);
}

/**
 * Safe base64 encoder that processes the Uint8Array in chunks to avoid hitting
 * the JS engine's maximum argument count (which btoa(String.fromCharCode(...bytes))
 * can exceed for anything larger than ~64 KB).
 */
function uint8ToBase64(bytes: Uint8Array): string {
	let binary = '';
	const CHUNK = 8192;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

/**
 * Encode a ParsedNote into a Yjs binary state (base64) ready to send to the server.
 *
 * Constructs Y.Doc fields directly without going through TipTap / y-prosemirror.
 * Text notes store plain text in Y.Text('content') — the app regenerates the rich
 * XmlFragment (contentRich) automatically the first time the note is opened.
 * Checklist items are written as raw Y.Map entries, matching the schema that
 * initChecklistNoteDoc uses, but without the rich-content fragment per item
 * (the editor regenerates those from the 'text' field on first render).
 */
export function encodeNoteToYjs(note: ParsedNote, labelIdsByName: Map<string, string>): EncodedNote {
	const doc = new Y.Doc();
	const labelIds = (note.labelNames ?? []).map((name) => labelIdsByName.get(name) ?? '').filter(Boolean);
	const now = note.createdAt ?? Date.now();
	const nowIso = new Date(now).toISOString();

	doc.transact(() => {
		// Always initialise drawingIds array (expected by all note types)
		doc.getArray<string>('drawingIds');

		// Title
		const yTitle = doc.getText('title');
		yTitle.insert(0, note.title || '');

		// Shared metadata fields
		const meta = doc.getMap<unknown>('metadata');
		meta.set('type', note.type);
		meta.set('createdAt', now);
		meta.set('updatedAt', now);
		meta.set('trashed', false);
		meta.set('trashedAt', null);
		meta.set('archived', false);
		meta.set('archivedAt', null);
		meta.set('colorToken', note.colorToken ?? null);
		meta.set('bannerFile', null);
		meta.set('drawingBackgroundColor', '#ffffff');
		meta.set('collectionId', null);
		meta.set('labelIds', labelIds);
		meta.set('reminderAt', null);
		meta.set('isPinned', false);
		meta.set('lastAccessedAt', nowIso);
		// previewLinks array (always initialised)
		doc.getArray<string>('previewLinks');

		if (note.type === 'text') {
			const plainText = extractPlainText(note.richContent).trim();
			const yContent = doc.getText('content');
			yContent.insert(0, plainText);

		} else if (note.type === 'checklist') {
			doc.getText('content'); // initialise field
			const yChecklist = doc.getArray<Y.Map<unknown>>('checklist');
			for (const item of (note.items ?? [])) {
				const m = new Y.Map<unknown>();
				m.set('id', item.id);
				m.set('text', String(item.text ?? ''));
				m.set('completed', Boolean(item.completed));
				m.set('parentId', item.parentId ?? null);
				m.set('countValue', null);
				// The rich-content XmlFragment per item is left empty; the checklist
				// editor calls syncChecklistItemPlainText on first render to populate it.
				yChecklist.push([m]);
			}

		} else if (note.type === 'drawing') {
			// Drawings can't be imported without Excalidraw scene data; create an
			// empty drawing doc so the title/metadata are at least preserved.
			doc.getArray('elements');
			doc.getMap('assets');
		}
	});

	// Write the rich XmlFragment outside the main transaction. replaceRichFragmentFromJson
	// starts its own Yjs transaction internally. Doing this after the setup transaction
	// avoids nested-transaction edge cases in Yjs.
	if (note.type === 'text' && note.richContent) {
		try {
			const fragment = doc.getXmlFragment('contentRich');
			const sanitized = sanitizeProsemirrorJson(note.richContent);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			replaceRichFragmentFromJson(fragment, sanitized as any, 'full');
		} catch (richErr) {
			// Non-fatal: the editor will fall back to ensureTextNoteRichContent
			// which seeds from plain text on first open.
			console.warn('[Import] replaceRichFragmentFromJson failed, falling back to plain text:', richErr);
		}
	}

	const stateBytes = Y.encodeStateAsUpdate(doc);
	return { noteId: note.noteId, title: note.title, type: note.type, state: uint8ToBase64(stateBytes) };
}

// ── Batch submit to server ─────────────────────────────────────────────────────

export interface BatchImportPayload {
	workspaceId: string;
	notes: EncodedNote[];
	labelNames: string[];
	workspaceName?: string;
}

export interface BatchImportResult {
	created: number;
	labelIdsByName: Record<string, string>;
	errors: Array<{ noteId: string; error: string }>;
}

export async function submitImportBatch(payload: BatchImportPayload): Promise<BatchImportResult> {
	console.log('[Import] POST /api/import/batch — workspace:', payload.workspaceId, '| notes:', payload.notes.length, '| labels:', payload.labelNames);
	const res = await fetch('/api/import/batch', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '(empty body)');
		console.error('[Import] /api/import/batch failed', res.status, body);
		let errMsg: string;
		try { errMsg = (JSON.parse(body) as { error?: string }).error ?? body; } catch { errMsg = body; }
		throw new Error(`HTTP ${res.status}: ${errMsg}`);
	}
	const result = await res.json() as BatchImportResult;
	console.log('[Import] Batch result:', result);
	if (result.errors?.length) console.warn('[Import] Per-note errors:', result.errors);
	return result;
}
