/**
 * noteModel.ts – Canonical note model layer.
 *
 * Defines the single authoritative `Note` shape that all note creation and
 * reading flows must go through. Provides factory functions for initializing
 * Yjs documents with the correct field layout, and a snapshot reader for
 * extracting a serializable Note from a live Y.Doc.
 *
 * Design goal: the Note interface maps cleanly to a future Postgres row –
 * every field is a primitive or a serializable structure. The Yjs-level
 * factory/reader functions handle CRDT-specific concerns (Y.Text, Y.Map,
 * Y.Array) so callers do not need to know the internal Yjs document shape.
 *
 * UI components must NOT manually construct note Yjs structures; they must
 * use the factory functions exported here.
 */

import * as Y from 'yjs';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** The two note content modes the application supports. */
export type NoteType = 'text' | 'checklist';

/** Plain-data representation of a single checklist row. */
export interface ChecklistItemData {
	/** Unique identifier for this checklist item (UUID or fallback). */
	id: string;
	/** User-visible label text. */
	text: string;
	/** Whether the item has been marked as done. */
	completed: boolean;
	/** Optional parent row id for one-level nesting. */
	parentId: string | null;
}

/**
 * Canonical note shape – the single source of truth for what constitutes a note.
 *
 * Every field is a serializable primitive or structure so the shape can be
 * round-tripped to JSON / Postgres without transformation. Live Yjs types
 * (Y.Text, Y.Array, Y.Map) are intentionally excluded from this interface;
 * use the factory and reader functions below to bridge between this model
 * and Yjs documents.
 */
export interface Note {
	/** Unique note identifier (UUID or prefixed fallback). */
	id: string;
	/** Discriminator controlling which editor/renderer is used. */
	type: NoteType;
	/** User-visible title. */
	title: string;
	/** Epoch-ms timestamp of initial creation. */
	createdAt: number;
	/** Epoch-ms timestamp of the most recent local mutation. */
	updatedAt: number;
	/**
	 * Soft-delete flag. When true the note has been "moved to trash" and
	 * should be hidden from the main grid. The note is not physically
	 * deleted from Yjs or Postgres — a server-side cleanup process
	 * permanently removes it after `deleteAfterDays` have elapsed.
	 */
	trashed: boolean;
	/**
	 * ISO-8601 timestamp recording when the note was moved to trash.
	 * null when the note is not trashed (trashed === false).
	 * Stored as a string (e.g. "2026-03-01T12:00:00.000Z") inside the
	 * Yjs metadata map and persisted through the normal Yjs→Postgres
	 * pipeline. Used by the server-side cleanup to determine retention expiry.
	 */
	trashedAt: string | null;
	/** Plain-text body. Present only when type === 'text'. */
	content?: string;
	/** Checklist rows. Present only when type === 'checklist'. */
	items?: ChecklistItemData[];
}

// ────────────────────────────────────────────────────────────────────────────
// ID generation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generate a unique note ID.
 *
 * Prefers `crypto.randomUUID()` for uniqueness guarantees in modern browsers.
 * Falls back to a timestamp + random suffix for older environments.
 *
 * @param prefix - Human-readable prefix baked into the fallback ID for
 *                 debuggability. Ignored when randomUUID is available.
 */
export function makeNoteId(prefix: string): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Factory functions  (Y.Doc → canonical fields)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Initialize a Y.Doc as a **text note** with the canonical field layout.
 *
 * This is the **only** sanctioned code path for creating text notes.
 * UI components must call this rather than writing Yjs structures directly.
 *
 * Fields written:
 *   - `title`     (Y.Text)       – note title
 *   - `content`   (Y.Text)       – note body text
 *   - `metadata`  (Y.Map)        – { type: 'text', createdAt, updatedAt }
 *
 * @param doc   - The Yjs document to populate. Must be empty or re-initializable.
 * @param title - Initial title string.
 * @param body  - Initial text content.
 */
export function initTextNoteDoc(doc: Y.Doc, title: string, body: string): void {
	const now = Date.now();
	doc.transact(() => {
		/* Title – replace any pre-existing text with the supplied value. */
		const yTitle = doc.getText('title');
		yTitle.delete(0, yTitle.length);
		yTitle.insert(0, title);

		/* Content body – same clear-and-write pattern. */
		const yContent = doc.getText('content');
		yContent.delete(0, yContent.length);
		yContent.insert(0, body);

		/* Metadata map – type discriminator + creation/update timestamps + trash state. */
		const metadata = doc.getMap<any>('metadata');
		metadata.set('type', 'text');
		metadata.set('createdAt', now);
		metadata.set('updatedAt', now);
		metadata.set('trashed', false);
		metadata.set('trashedAt', null);
	});
}

/**
 * Initialize a Y.Doc as a **checklist note** with the canonical field layout.
 *
 * This is the **only** sanctioned code path for creating checklist notes.
 * Individual checklist items are written into the doc's `checklist` Y.Array
 * as Y.Map entries, each carrying `id`, `text`, and `completed` fields.
 *
 * Fields written:
 *   - `title`     (Y.Text)              – note title
 *   - `checklist` (Y.Array<Y.Map<any>>) – checklist item rows
 *   - `metadata`  (Y.Map)               – { type: 'checklist', createdAt, updatedAt }
 *
 * @param doc   - The Yjs document to populate.
 * @param title - Initial title string.
 * @param items - Initial checklist rows.
 */
export function initChecklistNoteDoc(
	doc: Y.Doc,
	title: string,
	items: readonly ChecklistItemData[]
): void {
	const now = Date.now();
	const yChecklist = doc.getArray<Y.Map<any>>('checklist');

	doc.transact(() => {
		/* Title – clear and write. */
		const yTitle = doc.getText('title');
		yTitle.delete(0, yTitle.length);
		yTitle.insert(0, title);

		/* Metadata – type discriminator + timestamps + trash state. */
		const metadata = doc.getMap<any>('metadata');
		metadata.set('type', 'checklist');
		metadata.set('createdAt', now);
		metadata.set('updatedAt', now);
		metadata.set('trashed', false);
		metadata.set('trashedAt', null);

		/* Clear any pre-existing checklist data (safety net for re-initialization). */
		if (yChecklist.length > 0) {
			yChecklist.delete(0, yChecklist.length);
		}

		/* Insert each item as a fully-constructed Y.Map within the same transaction. */
		for (const item of items) {
			const m = new Y.Map<any>();
			m.set('id', item.id);
			m.set('text', item.text);
			m.set('completed', item.completed);
			m.set('parentId', typeof item.parentId === 'string' && item.parentId.trim().length > 0 ? item.parentId : null);
			yChecklist.push([m]);
		}
	});
}

// ────────────────────────────────────────────────────────────────────────────
// Snapshot reader  (Y.Doc → plain Note)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Read a serializable Note snapshot from a live Y.Doc.
 *
 * Returns a plain-data object suitable for JSON serialization, logging,
 * or future persistence to a relational store. The result is a point-in-time
 * snapshot – it does not update reactively.
 *
 * @param doc - The Yjs document to read from.
 * @param id  - The note's external identifier (not stored inside the doc itself).
 */
export function readNoteFromDoc(doc: Y.Doc, id: string): Note {
	const metadata = doc.getMap<any>('metadata');
	const rawType = String(metadata.get('type') ?? 'text');
	const type: NoteType = rawType === 'checklist' ? 'checklist' : 'text';

	const title = doc.getText('title').toString();
	const createdAt = Number(metadata.get('createdAt') ?? 0);
	/* Fall back to createdAt if updatedAt is not yet populated (legacy notes). */
	const updatedAt = Number(metadata.get('updatedAt') ?? createdAt);

	/* Trash state — default to not-trashed for legacy notes that pre-date this field. */
	const trashed = Boolean(metadata.get('trashed'));
	const rawTrashedAt = metadata.get('trashedAt');
	const trashedAt = typeof rawTrashedAt === 'string' ? rawTrashedAt : null;

	const base: Note = { id, type, title, createdAt, updatedAt, trashed, trashedAt };

	if (type === 'text') {
		base.content = doc.getText('content').toString();
	} else {
		const yChecklist = doc.getArray<Y.Map<any>>('checklist');
		base.items = yChecklist
			.toArray()
			.map((m) => ({
				id: String(m.get('id') ?? ''),
				text: String(m.get('text') ?? ''),
				completed: Boolean(m.get('completed')),
				parentId:
					typeof m.get('parentId') === 'string' && String(m.get('parentId')).trim().length > 0
						? String(m.get('parentId')).trim()
						: null,
			}))
			.filter((item) => item.id.length > 0);
	}

	return base;
}

// ────────────────────────────────────────────────────────────────────────────
// Mutation helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Stamp the current epoch-ms time into a note doc's `metadata.updatedAt`.
 *
 * Intended to be called automatically by DocumentManager's afterTransaction
 * listener. Can also be invoked manually for explicit timestamp control.
 *
 * @param doc    - The Yjs document to update.
 * @param origin - Optional transaction origin to prevent observer echo loops.
 *                 When provided, Yjs tags the transaction so other observers
 *                 can distinguish timestamp writes from user edits.
 */
export function touchUpdatedAt(doc: Y.Doc, origin?: symbol): void {
	const metadata = doc.getMap<any>('metadata');
	const run = (): void => {
		metadata.set('updatedAt', Date.now());
	};
	if (origin) {
		doc.transact(run, origin);
	} else {
		doc.transact(run);
	}
}

/**
 * Toggle the soft-delete ("trash") state of a note.
 *
 * When `trashed` is true (or omitted), the note is marked as trashed with
 * the current epoch-ms timestamp. When false, the note is restored (un-trashed)
 * and `trashedAt` is cleared to null.
 *
 * The trash state lives inside the note's Yjs `metadata` map so it is
 * automatically replicated across all connected tabs/clients via CRDT sync
 * and persisted through the normal Yjs→Postgres pipeline. No separate
 * server RPC is needed to toggle trash — the change propagates like any
 * other Yjs mutation.
 *
 * @param doc     - The Yjs document whose trash state to toggle.
 * @param trashed - Whether the note should be trashed (default: true).
 * @param origin  - Optional transaction origin for observer filtering.
 */
export function setNoteTrashed(doc: Y.Doc, trashed = true, origin?: symbol): void {
	const metadata = doc.getMap<any>('metadata');
	const run = (): void => {
		metadata.set('trashed', trashed);
		metadata.set('trashedAt', trashed ? new Date().toISOString() : null);
		/* Also bump updatedAt so the change is visible in timestamps. */
		metadata.set('updatedAt', Date.now());
	};
	if (origin) {
		doc.transact(run, origin);
	} else {
		doc.transact(run);
	}
}

/**
 * Read only the trash-related fields from a live Y.Doc without building
 * a full Note snapshot. Useful for lightweight checks (e.g. filtering
 * the note grid) without the overhead of readNoteFromDoc.
 *
 * @param doc - The Yjs document to inspect.
 * @returns Object with `trashed` boolean and `trashedAt` epoch-ms or null.
 */
export function readTrashState(doc: Y.Doc): { trashed: boolean; trashedAt: string | null } {
	const metadata = doc.getMap<any>('metadata');
	const trashed = Boolean(metadata.get('trashed'));
	const rawTrashedAt = metadata.get('trashedAt');
	const trashedAt = typeof rawTrashedAt === 'string' ? rawTrashedAt : null;
	return { trashed, trashedAt };
}
