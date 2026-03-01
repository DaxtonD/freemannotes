/**
 * devGuards.ts – Development-only structural integrity checks.
 *
 * These guards emit console.warn diagnostics for data inconsistencies that
 * indicate bugs in note creation, deletion, or ordering logic. They are
 * gated behind `import.meta.env.DEV` so they are tree-shaken out of
 * production builds entirely.
 *
 * Intended to be called periodically – for example inside a React useEffect
 * that fires whenever the note registry or order mutates during development.
 *
 * IMPORTANT: These guards never throw. They only warn. Production builds
 * must not be affected in any way.
 */

import type * as Y from 'yjs';

/**
 * Run all structural integrity guards against the current note registry
 * and ordering state. Logs `console.warn` for every inconsistency found.
 *
 * Guards performed:
 *   1. Duplicate note IDs in the notesList registry.
 *   2. Duplicate note IDs in the noteOrder array.
 *   3. noteOrder entries that reference IDs not present in notesList (orphans).
 *   4. notesList entries that are missing from noteOrder (unordered notes).
 *   5. Duplicate checklist item IDs within individual checklist notes.
 *
 * @param registryIds - Note IDs currently in the notesList Y.Array.
 * @param orderIds    - Note IDs currently in the noteOrder Y.Array.
 * @param docsById    - Map of noteId → loaded Y.Doc, used for per-note
 *                       checklist item duplicate checks.
 */
export function runNoteGuards(
	registryIds: readonly string[],
	orderIds: readonly string[],
	docsById: Readonly<Record<string, Y.Doc>>
): void {
	/* Gate: only run in development builds. Vite replaces this expression
	   with `false` in production, allowing the bundler to dead-code-eliminate
	   the entire function body. The process.env fallback covers non-Vite
	   environments (tests, SSR). */
	const isDev =
		(typeof (import.meta as any).env !== 'undefined' && (import.meta as any).env.DEV) ||
		(typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production');
	if (!isDev) return;

	// ── 1. Duplicate IDs in notesList ────────────────────────────────────
	// Each note should appear exactly once in the registry. Duplicates indicate
	// a bug in createNote or a CRDT merge anomaly.
	const registrySet = new Set<string>();
	for (const id of registryIds) {
		if (registrySet.has(id)) {
			console.warn(`[dev-guard] Duplicate note ID in notesList: "${id}"`);
		}
		registrySet.add(id);
	}

	// ── 2. Duplicate IDs in noteOrder ────────────────────────────────────
	// Each note should appear at most once in the ordering array. Duplicates
	// would cause the same card to render twice in the grid.
	const orderSet = new Set<string>();
	for (const id of orderIds) {
		if (orderSet.has(id)) {
			console.warn(`[dev-guard] Duplicate note ID in noteOrder: "${id}"`);
		}
		orderSet.add(id);
	}

	// ── 3. noteOrder references missing notes (orphaned order entries) ───
	// If noteOrder contains an ID that doesn't exist in the registry, the
	// grid would try to render a non-existent note.
	for (const id of orderIds) {
		if (!registrySet.has(id)) {
			console.warn(`[dev-guard] noteOrder contains orphan ID not in notesList: "${id}"`);
		}
	}

	// ── 4. Notes missing from noteOrder (unordered notes) ────────────────
	// Every note in the registry should have a corresponding position in
	// noteOrder. Missing entries indicate a bug in createNote or deleteNote.
	for (const id of registryIds) {
		if (!orderSet.has(id)) {
			console.warn(`[dev-guard] Note "${id}" exists in notesList but is missing from noteOrder`);
		}
	}

	// ── 5. Duplicate checklist item IDs within individual notes ──────────
	// Each checklist item inside a note must have a unique ID. Duplicates
	// would cause React key collisions and broken update/delete operations.
	for (const [noteId, doc] of Object.entries(docsById)) {
		const metadata = doc.getMap<any>('metadata');
		/* Only inspect checklist-type notes. */
		if (String(metadata.get('type') ?? '') !== 'checklist') continue;

		const yChecklist = doc.getArray<Y.Map<any>>('checklist');
		const itemIdSet = new Set<string>();
		for (const m of yChecklist.toArray()) {
			const itemId = String(m.get('id') ?? '').trim();
			if (!itemId) continue;
			if (itemIdSet.has(itemId)) {
				console.warn(
					`[dev-guard] Duplicate checklist item ID "${itemId}" in note "${noteId}"`
				);
			}
			itemIdSet.add(itemId);
		}
	}

	// ── 6. Trashed notes still visible in the main grid ──────────────────
	// If a note's metadata has trashed === true but it's still showing in
	// the main grid (i.e. in registryIds/orderIds), that indicates the UI
	// is not properly filtering trashed notes.
	for (const [noteId, doc] of Object.entries(docsById)) {
		const metadata = doc.getMap<any>('metadata');
		const trashed = Boolean(metadata.get('trashed'));
		if (trashed && (registrySet.has(noteId) || orderSet.has(noteId))) {
			console.warn(
				`[dev-guard] Note "${noteId}" is trashed but still present in the ` +
				`note registry/order. The UI should filter trashed notes from the main grid.`
			);
		}
	}

	// ── 7. Inconsistent trash state (trashed without trashedAt) ──────────
	// If a note has trashed === true, it must also have an ISO-8601 string
	// trashedAt timestamp. Missing trashedAt would prevent the server-side
	// cleanup from calculating the retention expiry.
	for (const [noteId, doc] of Object.entries(docsById)) {
		const metadata = doc.getMap<any>('metadata');
		const trashed = Boolean(metadata.get('trashed'));
		const trashedAt = metadata.get('trashedAt');
		if (trashed && (typeof trashedAt !== 'string' || trashedAt.length === 0)) {
			console.warn(
				`[dev-guard] Note "${noteId}" has trashed=true but missing/invalid trashedAt. ` +
				`Server cleanup cannot determine retention expiry.`
			);
		}
	}
}
