import type { ImportPlatform, RawFile } from '../ImportTypes';

/**
 * Fingerprint the platform from the file set.
 * Called before any content parsing so we can pick the right parser.
 */
export function detectPlatform(files: RawFile[]): ImportPlatform {
	const paths = files.map((f) => f.path.replace(/\\/g, '/'));
	const names = files.map((f) => f.name.toLowerCase());

	// Obsidian: contains .obsidian/ directory or .md files with [[wikilinks]]
	if (paths.some((p) => p.includes('.obsidian/') || p.endsWith('.obsidian'))) {
		return 'obsidian';
	}

	// Google Keep: JSON files with Keep-specific shape (textContent / listContent / title)
	const jsonFiles = files.filter((f) => f.ext === 'json');
	if (jsonFiles.length > 0 && paths.some((p) => p.includes('Takeout') || p.includes('Keep'))) {
		return 'keep';
	}
	// Keep export can also be detected by JSON content — checked in parser

	// Joplin: Markdown files with frontmatter containing `id:` and `parent_id:`
	// (also often named with UUIDs)
	const uuidPattern = /^[0-9a-f]{32}\.md$/i;
	const joplinLikeFiles = files.filter((f) => f.ext === 'md' && uuidPattern.test(f.name));
	if (joplinLikeFiles.length > 2) {
		return 'joplin';
	}

	// Notion: Markdown files with UUID suffixes (e.g. "Note Title abc123def456.md")
	const notionNamePattern = /[a-f0-9]{32}\.md$/i;
	const notionLike = files.filter((f) => notionNamePattern.test(f.name));
	// Notion also exports CSV for databases; if more than half are UUID-named, assume Notion
	if (notionLike.length > 1 && notionLike.length >= files.filter((f) => f.ext === 'md').length * 0.5) {
		return 'notion';
	}

	// OneNote: single DOCX file (OneNote exports individual notebooks as DOCX)
	if (files.length === 1 && files[0].ext === 'docx') {
		return 'onenote';
	}

	return 'generic';
}
