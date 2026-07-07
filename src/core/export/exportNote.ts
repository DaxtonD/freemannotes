import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { prosemirrorToMarkdown, downloadTextFile } from './toMarkdown';
import type { DocumentManager } from '../DocumentManager';

function sanitizeFilename(name: string): string {
	return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '_').trim().slice(0, 200) || 'Untitled';
}

/**
 * Export a single note to a file download.
 * - Text notes → Markdown (.md)
 * - Checklist notes → GFM task list (.md)
 * - Drawing notes → Excalidraw JSON (.excalidraw)
 */
export async function exportNote(manager: DocumentManager, noteId: string): Promise<void> {
	const doc = await manager.getDocReady(noteId);
	const meta = doc.getMap<unknown>('metadata');
	const title = doc.getText('title').toString().trim() || 'Untitled';
	const type = String(meta.get('type') ?? 'text');

	if (type === 'text') {
		const fragment = doc.getXmlFragment('contentRich');
		let markdown: string;
		try {
			const json = yXmlFragmentToProsemirrorJSON(fragment);
			markdown = `# ${title}\n\n${prosemirrorToMarkdown(json)}`;
		} catch {
			// Fallback to plain text content
			const plain = doc.getText('content').toString();
			markdown = `# ${title}\n\n${plain}`;
		}
		downloadTextFile(`${sanitizeFilename(title)}.md`, markdown);

	} else if (type === 'checklist') {
		const items = doc.getArray<Y.Map<unknown>>('checklist').toArray();
		const lines = [`# ${title}`, ''];
		for (const item of items) {
			const text = String(item.get('text') ?? '').trim();
			const done = Boolean(item.get('completed'));
			lines.push(`- [${done ? 'x' : ' '}] ${text}`);
		}
		downloadTextFile(`${sanitizeFilename(title)}.md`, lines.join('\n'));

	} else if (type === 'drawing') {
		const elements = doc.getArray<Y.Map<unknown>>('elements').toArray().map((m) => {
			const obj: Record<string, unknown> = {};
			m.forEach((v, k) => { obj[k] = v; });
			return obj;
		});
		const filesMap: Record<string, unknown> = {};
		doc.getMap<unknown>('assets').forEach((v, k) => { filesMap[k] = v; });
		const excalidraw = JSON.stringify({
			type: 'excalidraw',
			version: 2,
			source: 'freemannotes',
			elements,
			appState: {},
			files: filesMap,
		}, null, 2);
		downloadTextFile(`${sanitizeFilename(title)}.excalidraw`, excalidraw);
	}
}

/**
 * Export an entire workspace as a ZIP file.
 * Calls the server export endpoint which handles serialization.
 */
export async function exportWorkspace(workspaceId: string, workspaceName: string): Promise<void> {
	const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/export`);
	if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);

	const { files } = await res.json() as { files: Array<{ name: string; content: string }> };

	// Build ZIP client-side
	const JSZip = (await import('jszip')).default;
	const zip = new JSZip();
	const folder = zip.folder(sanitizeFilename(workspaceName) || 'Workspace') ?? zip;
	for (const file of files) {
		folder.file(file.name, file.content);
	}

	const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${sanitizeFilename(workspaceName) || 'workspace'}.zip`;
	a.click();
	URL.revokeObjectURL(url);
}
