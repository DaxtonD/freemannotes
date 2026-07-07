import type { JSONContent } from '@tiptap/core';
import type { ChecklistItemData } from '../noteModel';

/** One note ready to be submitted to the server. */
export interface ParsedNote {
	/** UUID pre-assigned by the client during parsing. */
	noteId: string;
	title: string;
	type: 'text' | 'checklist' | 'drawing';
	/** Rich ProseMirror JSON (text notes). */
	richContent?: JSONContent | null;
	/** Checklist items (checklist notes). */
	items?: Array<ChecklistItemData & { richContent?: JSONContent | null }>;
	/** Excalidraw scene JSON (drawing notes). */
	drawingData?: { elements: unknown[]; appState: Record<string, unknown>; files?: Record<string, unknown> } | null;
	/** Original creation timestamp (ms since epoch). Used to preserve source timestamps. */
	createdAt?: number;
	/** Label names that should be created/assigned. Resolved to IDs after import. */
	labelNames?: string[];
	/** Note color token from source (Keep colors, etc.). */
	colorToken?: string | null;
	/** Collection path components (e.g. ['Work', 'Q1']). Resolved after import. */
	collectionPath?: string[];
}

/** A logical workspace bucket produced during parsing. */
export interface ParsedWorkspace {
	/** Workspace display name (from folder name or platform metadata). */
	name: string;
	/** Notes that belong in this workspace. */
	notes: ParsedNote[];
}

/** Result of the two-pass parse. */
export interface ParseResult {
	platform: ImportPlatform;
	workspaces: ParsedWorkspace[];
	/** All unique label names across all workspaces. */
	allLabelNames: string[];
	/** Any non-fatal warnings encountered during parsing. */
	warnings: string[];
	/** Total number of image attachments detected (may not all be importable). */
	imageCount: number;
}

export type ImportPlatform =
	| 'obsidian'
	| 'keep'
	| 'notion'
	| 'joplin'
	| 'onenote'
	| 'generic';

/** A raw file as extracted from a ZIP or file picker. */
export interface RawFile {
	/** Full path within the archive / selection (e.g. "vault/folder/note.md"). */
	path: string;
	/** File name only (no directory). */
	name: string;
	/** File extension, lower-cased, no leading dot. */
	ext: string;
	/** UTF-8 text content. Binary files (images) are ignored. */
	text: () => Promise<string>;
	/** Raw bytes (for DOCX parsing via mammoth). */
	bytes?: () => Promise<ArrayBuffer>;
}

/** Map from original title/path to the generated noteId — used for wiki-link resolution. */
export type TitleToIdMap = Map<string, string>;
