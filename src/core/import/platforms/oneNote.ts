import type { ParsedNote, ParsedWorkspace, RawFile } from '../ImportTypes';
import { markdownToProsemirror } from '../markdownToProsemirror';
import { makeNoteId } from '../../noteModel';

/**
 * Parse a OneNote export (DOCX file per notebook section).
 *
 * Uses mammoth.js to convert DOCX → HTML, then strips HTML to plain text
 * that we convert through our Markdown pipeline.
 */
export async function parseOneNote(files: RawFile[]): Promise<ParsedWorkspace[]> {
	const docxFiles = files.filter((f) => f.ext === 'docx');
	if (docxFiles.length === 0) return [];

	const notes: ParsedNote[] = [];

	for (const file of docxFiles) {
		try {
			const mammoth = await import('mammoth');
			const bytes = await file.bytes?.();
			if (!bytes) continue;

			// mammoth.convertToHtml is the stable API; convertToMarkdown is not in all versions
			const htmlResult = await mammoth.convertToHtml({ arrayBuffer: bytes });
			const md = htmlResult.value
				.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
				.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
				.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
				.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
				.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
				.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
				.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
				.replace(/<[^>]+>/g, '')
				.replace(/&amp;/g, '&')
				.replace(/&lt;/g, '<')
				.replace(/&gt;/g, '>')
				.replace(/&nbsp;/g, ' ')
				.trim();

			// Split into sections by H1 headings (OneNote pages)
			const sections = md.split(/^# /m).filter(Boolean);

			for (const section of sections) {
				const firstNewline = section.indexOf('\n');
				const title = firstNewline > 0 ? section.slice(0, firstNewline).trim() : section.trim().slice(0, 80);
				const body = firstNewline > 0 ? section.slice(firstNewline + 1).trim() : '';

				const noteId = makeNoteId('onenote');
				const rich = markdownToProsemirror(body);
				notes.push({ noteId, title: title || 'Untitled', type: 'text', richContent: rich });
			}
		} catch { /* skip files mammoth can't parse */ }
	}

	if (notes.length === 0) return [];
	return [{ name: 'OneNote Import', notes }];
}
