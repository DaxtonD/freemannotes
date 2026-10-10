import type { NoteSearchResult } from './noteMediaApi';

// Deliberately its own module, with nothing but a TYPE import.
//
// This belongs next to offlineSearch.ts conceptually, and started there — but that module
// reaches the whole client graph (Yjs, TipTap, the IndexedDB stores), and TipTap is ESM-only,
// so a unit test of a pure function could not even load it under ts-node's CommonJS transpile.
// The function that decides whether a bad network costs you your search results is worth being
// able to test directly, so it lives where a test can require it in isolation. Type imports are
// erased at compile time, so this module has no runtime dependencies at all.

/**
 * How well a result answers the query, independent of when it was last touched.
 *
 * Results used to be ordered by `updatedAt` alone, which meant relevance never entered into it:
 * search "elevators" and a note titled "Elevator inspection" edited last year sat below anything
 * edited today that merely contained the letters somewhere. Every result does match the query —
 * the server and the local pass both filter on it — so what separates them is *where* the match
 * landed and how completely.
 *
 * Kept deliberately coarse. These are buckets, not a tuned ranking function: a title hit beats a
 * body hit beats an attachment-only hit, and recency still breaks ties within a bucket. Anything
 * finer would need real relevance data (term frequency, field weights) that this search doesn't
 * collect, and a clever score nobody can predict is worse than a blunt one everybody can.
 */
function relevanceScore(result: NoteSearchResult, foldedQuery: string): number {
	if (!foldedQuery) return 0;
	const title = String(result.title || '').toLowerCase();
	let score = 0;
	if (title === foldedQuery) score = 1000;
	else if (title.startsWith(foldedQuery)) score = 800;
	// A match that begins a word reads as intentional; one buried mid-word is usually incidental
	// ("el" inside "well"), which is exactly the case that looked wrong while typing.
	else if (new RegExp(`\\b${foldedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(title)) score = 600;
	else if (title.includes(foldedQuery)) score = 400;

	// The note's own text matched, rather than only something attached to it. Added rather than
	// substituted so a title hit still outranks a body hit on the same note.
	if (result.matchKinds.includes('note')) score += 150;
	return score;
}

/** The same note can arrive from both sides; this is what counts as "the same note". */
function resultKey(result: NoteSearchResult): string {
	// openNoteId is part of the identity on purpose: one underlying doc legitimately appears
	// twice — once as the owner's note, once as the placement shared into your workspace.
	return `${result.docId}:${result.openNoteId || result.noteId}`;
}

/**
 * Combines server results with locally-computed ones into one list, newest first.
 *
 * Either side may be empty, and that is the normal degraded case rather than an error: the
 * search effect calls this with whatever actually arrived, so a request that timed out
 * contributes nothing instead of taking the other side's results down with it.
 *
 * Both sides can legitimately find the same note by different routes — the server knows about
 * OCR'd document text and collaborator names, the device knows about notes it holds locally —
 * so a note found twice keeps the union of *why* it matched rather than whichever copy was
 * written last. The server wins on the scalar fields it is authoritative for (its snippet comes
 * from the full extracted text, the device only has a partial cache), with the local value as
 * the fallback for anything the server left empty.
 */
export function mergeSearchResults(
	remote: readonly NoteSearchResult[],
	offline: readonly NoteSearchResult[],
	query = ''
): NoteSearchResult[] {
	const merged = new Map<string, NoteSearchResult>();
	for (const result of remote) merged.set(resultKey(result), result);
	for (const result of offline) {
		const key = resultKey(result);
		const current = merged.get(key);
		if (!current) {
			merged.set(key, result);
			continue;
		}
		merged.set(key, {
			...current,
			matchKinds: Array.from(new Set([...current.matchKinds, ...result.matchKinds])),
			collaboratorMatches: Array.from(new Set([...current.collaboratorMatches, ...result.collaboratorMatches])).slice(0, 3),
			collectionMatches: Array.from(new Set([...current.collectionMatches, ...result.collectionMatches])).slice(0, 3),
			labelMatches: Array.from(new Set([...current.labelMatches, ...result.labelMatches])).slice(0, 4),
			snippet: current.snippet || result.snippet,
			thumbnailUrl: current.thumbnailUrl || result.thumbnailUrl,
			imageCount: Math.max(current.imageCount, result.imageCount),
			updatedAt: Date.parse(current.updatedAt) >= Date.parse(result.updatedAt) ? current.updatedAt : result.updatedAt,
		});
	}
	// Relevance first, recency as the tie-break within a bucket. Scores are computed once per
	// result rather than inside the comparator, which would recompute them O(n log n) times.
	const foldedQuery = query.trim().toLowerCase();
	const scored = Array.from(merged.values()).map((result) => ({
		result,
		score: relevanceScore(result, foldedQuery),
		updatedAt: Date.parse(result.updatedAt) || 0,
	}));
	scored.sort((left, right) => (right.score - left.score) || (right.updatedAt - left.updatedAt));
	return scored.map((entry) => entry.result);
}
