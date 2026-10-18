/**
 * Turning a server note-digest entry into a note-card shell. Pure functions, no side effects.
 *
 * ## Why this is its own file
 *
 * Two reasons, and the second one is the load-bearing one.
 *
 * 1. These are the rules worth testing. `noteDigestSeed.ts` is the plumbing around them — a
 *    `fetch`, a cursor in localStorage, a snapshot read and write. Same split as
 *    `roomConnectionPool.ts` got in step 1 of this rework: the decision is pure and tested, the
 *    wiring is thin and obvious.
 *
 * 2. **Nothing here may import anything at runtime.** Type-only imports are erased, so this file
 *    loads under plain Node. Import one real value and it stops. The chain from
 *    `workspaceRenderSnapshot` (and from `network`) reaches `debugLogger.ts`, which reads
 *    `import.meta.env` at module scope — a Vite-only construct that TypeScript cannot downlevel
 *    to CommonJS, so ts-node must emit ESM and `import.meta.env` is simply `undefined` outside
 *    Vite. That is why no test in this repo has ever managed to import `noteModel`, `richText` or
 *    `workspaceRenderSnapshot`. Keep the imports here type-only and the tests keep working.
 */

// noteLinks only imports yjs, so it loads under plain Node and does not break the
// type-only-imports rule this module relies on (checked, not assumed).
import { normalizeUrlCandidate, type ExtractedNoteLink } from './noteLinks';
import type {
	WorkspaceRenderSnapshotChecklistItem,
	WorkspaceRenderSnapshotNote,
} from './workspaceRenderSnapshot';

/** One note as `GET /api/note-digest` describes it. Mirrors `projectNoteDigestFromState` on the server. */
export type NoteDigestEntry = {
	id: string;
	type: string;
	title: string;
	contentPreview: string;
	contentLength: number;
	checklistItems: { text: string; done: boolean }[];
	checklistItemCount: number;
	checklistCompletedCount: number;
	createdAt: number;
	updatedAt: number;
	collectionId: string | null;
	labelIds: string[];
	drawingIds: string[];
	bannerFile: string | null;
	trashed: boolean;
	archived: boolean;
	serverUpdatedAt: string | null;
	/** Raw URL strings from the note's `urlPreviewLinks` metadata field. */
	previewLinkUrls?: string[];
};

function toPreviewLinks(entry: NoteDigestEntry): ExtractedNoteLink[] {
	const urls = Array.isArray(entry.previewLinkUrls) ? entry.previewLinkUrls : [];
	const links: ExtractedNoteLink[] = [];
	for (const url of urls) {
		const link = normalizeUrlCandidate(url);
		// sortOrder has to come from position here; normalizeUrlCandidate cannot know it.
		if (link) links.push({ ...link, sortOrder: links.length });
	}
	return links;
}

function toChecklistItems(entry: NoteDigestEntry): WorkspaceRenderSnapshotChecklistItem[] {
	const items = Array.isArray(entry.checklistItems) ? entry.checklistItems : [];
	return items.map((item, index) => ({
		// The digest carries no item ids - it describes shape, not identity. These exist only so the
		// card can lay the rows out and get its height right; a real document replaces the whole
		// shell the moment it loads, so nothing downstream ever treats these as stable.
		id: `digest-${entry.id}-${index}`,
		text: String(item?.text ?? ''),
		completed: item?.done === true,
		completedAt: null,
		parentId: null,
		countValue: null,
		richContent: null,
	}));
}

/**
 * One digest entry as a card shell.
 *
 * Fields the digest cannot know are left at their neutral defaults rather than guessed. A
 * reminder, a pin, a note colour and the per-user banner preference are user- or device-scoped and
 * arrive by their own routes. Attachment counts are zeroed for the same reason - images, documents
 * and links are SQL rows delivered over `/ws/metadata`, not part of the Yjs document the digest
 * projects. Attached drawings are the exception: `drawingIds` lives in the document itself, so the
 * digest does know those and the count is real.
 *
 * Guessing any of the others would put a wrong value into a cache that outlives the seed, which is
 * a worse failure than the blank card this exists to fix.
 */
export function digestEntryToSnapshotNote(entry: NoteDigestEntry): WorkspaceRenderSnapshotNote {
	const type = entry.type === 'checklist' ? 'checklist' : entry.type === 'drawing' ? 'drawing' : 'text';
	const drawingIds = Array.isArray(entry.drawingIds) ? [...entry.drawingIds] : [];
	const previewLinks = toPreviewLinks(entry);
	return {
		id: entry.id,
		type,
		title: String(entry.title ?? ''),
		content: String(entry.contentPreview ?? ''),
		richContent: null,
		checklistItems: toChecklistItems(entry),
		createdAt: Number(entry.createdAt) || 0,
		updatedAt: Number(entry.updatedAt) || 0,
		collectionId: entry.collectionId ?? null,
		labelIds: Array.isArray(entry.labelIds) ? [...entry.labelIds] : [],
		docId: null,
		reminderAt: null,
		isPinned: false,
		lastAccessedAt: '',
		drawingIds,
		trashed: entry.trashed === true,
		archived: entry.archived === true,
		colorToken: null,
		bannerFile: entry.bannerFile ?? null,
		hasSharedBannerPreference: false,
		collaboratorCount: 0,
		attachmentCounts: { images: 0, links: previewLinks.length, drawings: drawingIds.length, documents: 0 },
		previewLinks,
		// The link PREVIEW CARD (title, image, description) is a server-side fetch cached per
		// device, not part of the note document, so the digest cannot supply it. The link row
		// itself is what carries most of the height.
		previewCards: [],
	};
}

/**
 * Can this shell actually draw something?
 *
 * **A shell that answers no must not suppress the card shimmer.** This is the rule that makes the
 * shimmer trustworthy, and it exists because of how a shell becomes a card:
 * `createSnapshotDocFromWorkspaceRenderSnapshot` unconditionally writes all ten canonical
 * metadata keys, so `hasRenderableNoteContent` in NoteGrid answers "renderable" for ANY shell -
 * including one carrying no title, no content and no checklist. Such a card renders blank, titled
 * "Untitled", and because a shell existed it never got a shimmer either. Worse than the skeleton
 * it replaced.
 *
 * A drawing always answers no: its card body IS its Excalidraw scene, which lives in that note's
 * own doc and is never part of the digest.
 */
export function digestShellCanRender(shell: WorkspaceRenderSnapshotNote): boolean {
	if (shell.type === 'drawing') return false;
	if (String(shell.title ?? '').trim().length > 0) return true;
	if (String(shell.content ?? '').trim().length > 0) return true;
	if (shell.checklistItems.length > 0) return true;
	if (shell.drawingIds.length > 0) return true;
	if (shell.previewLinks.length > 0) return true;
	return false;
}

export type DigestShellMerge = {
	/** The full shell list to persist. */
	shells: WorkspaceRenderSnapshotNote[];
	/** Shells for notes the store had never heard of. */
	added: number;
	/** Shells the store already had, replaced with the newer projection. */
	updated: number;
};

/**
 * Merge a page of digest entries into the digest's own shell store.
 *
 * **Inside this store the digest wins**, which is the opposite of how it behaves at render time,
 * and the distinction matters enough to spell out.
 *
 * The digest is the only writer here, and it is fetched incrementally by a cursor ordered on
 * `updatedAt` ascending - so an entry arriving for an id already present is by construction a
 * *newer* projection of that note, and keeping the older one would mean a note stayed stale
 * forever. Hence: upsert.
 *
 * The rule that a real document always beats a digest shell lives at the **read** instead, where
 * the grid prefers a live doc, then its measured render snapshot, and only then one of these.
 * Putting it there rather than here is deliberate: a read-time preference holds no matter what
 * order the writes happened in, and write ordering is exactly what makes this fragile. Seeding
 * into the render snapshot was tried first and the grid's own debounced write clobbered it within
 * a couple of hundred milliseconds, because that snapshot is read once per workspace and rebuilt
 * from live docs plus the stale read.
 */
export function mergeDigestShells(
	existing: readonly WorkspaceRenderSnapshotNote[],
	entries: readonly NoteDigestEntry[]
): DigestShellMerge {
	const byId = new Map<string, WorkspaceRenderSnapshotNote>();
	for (const shell of existing) {
		const id = String(shell?.id ?? '').trim();
		if (id) byId.set(id, shell);
	}

	let added = 0;
	let updated = 0;
	for (const entry of entries) {
		const id = String(entry?.id ?? '').trim();
		if (!id) continue;
		if (byId.has(id)) updated += 1;
		else added += 1;
		byId.set(id, digestEntryToSnapshotNote({ ...entry, id }));
	}
	return { shells: Array.from(byId.values()), added, updated };
}
