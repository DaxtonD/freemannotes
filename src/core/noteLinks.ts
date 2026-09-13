import * as Y from 'yjs';

// URL-preview metadata lives in the Yjs note document so editors, cards, and browser
// modals can all derive the same canonical preview-intent list from one place.

const SECOND_LEVEL_SUFFIXES = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);
const NOTE_PREVIEW_LINKS_FIELD = 'urlPreviewLinks';
const notePreviewLinkCache = new WeakMap<Y.Doc, { signature: string; links: ExtractedNoteLink[] }>();
// URLs the close-time auto-linker (noteLinkAutoLink.ts) has ever turned into a
// preview + hyperlink for this note, keyed by normalizedUrl. Shared via Yjs
// (not a local ref) so the record survives across sessions and devices — a URL
// is only ever auto-handled once, ever, for this note. Without that, deleting
// the resulting preview or hyperlink would just have it come back the next
// time anyone closed the note with that URL still sitting in the content.
//
// This set carries a SECOND meaning the "Clean up" button (NoteEditor.tsx's
// handleCleanUpUrlPreviews) leans on: it's the only reliable way to tell a
// content-derived preview apart from one added by hand via "+ URL Preview".
// A manually-added preview was never discovered by scanning the note's
// content, so its URL never lands in this set no matter how long the note
// goes on to exist — which is exactly what makes it safe for Clean up to
// treat "in this set" as "came from content, ok to remove if that content is
// gone now" and leave everything else alone. Do NOT call markUrlsAsAutoLinked
// from a manual add-preview code path — that would make Clean up start
// deleting previews the user asked for by hand.
const AUTO_LINKED_URLS_FIELD = 'autoLinkedUrls';

export type ExtractedNoteLink = {
	url: string;
	normalizedUrl: string;
	hostname: string;
	rootDomain: string;
	sortOrder: number;
};

export function normalizeNoteLinkUrl(value: string): URL | null {
	const input = String(value || '').trim();
	if (!input) return null;
	if (/^(javascript|data|mailto|tel):/i.test(input)) return null;
	const candidate = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
	try {
		const url = new URL(candidate);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		url.hash = '';
		if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
			url.port = '';
		}
		return url;
	} catch {
		return null;
	}
}

export function deriveRootDomain(hostname: string): string {
	const normalized = String(hostname || '').trim().toLowerCase();
	if (!normalized) return '';
	const parts = normalized.split('.').filter(Boolean);
	if (parts.length <= 2) return normalized;
	const last = parts[parts.length - 1];
	const secondLast = parts[parts.length - 2];
	const thirdLast = parts[parts.length - 3];
	if (last.length === 2 && SECOND_LEVEL_SUFFIXES.has(secondLast) && thirdLast) {
		return `${thirdLast}.${secondLast}.${last}`;
	}
	return `${secondLast}.${last}`;
}

function toExtractedLink(rawUrl: unknown, sortOrder: number): ExtractedNoteLink | null {
	if (typeof rawUrl !== 'string') return null;
	const normalized = normalizeNoteLinkUrl(rawUrl);
	if (!normalized) return null;
	return {
		url: rawUrl.trim(),
		normalizedUrl: normalized.toString(),
		hostname: normalized.hostname.toLowerCase(),
		rootDomain: deriveRootDomain(normalized.hostname),
		sortOrder,
	};
}

function getNotePreviewLinkSignature(rawLinks: unknown): string {
	if (!Array.isArray(rawLinks)) return '';
	return rawLinks.map((value) => (typeof value === 'string' ? value.trim() : '')).join('\n');
}

export function getNotePreviewLinksFromDoc(doc: Y.Doc): ExtractedNoteLink[] {
	const metadata = doc.getMap<any>('metadata');
	const rawLinks = metadata.get(NOTE_PREVIEW_LINKS_FIELD);
	const signature = getNotePreviewLinkSignature(rawLinks);
	const cached = notePreviewLinkCache.get(doc);
	if (cached && cached.signature === signature) {
		return cached.links;
	}
	const values = Array.isArray(rawLinks) ? rawLinks : [];
	// Normalize + de-duplicate by canonical URL so edits that vary only by formatting,
	// scheme defaults, or repeated pastes do not create duplicate preview work.
	const deduped = new Map<string, ExtractedNoteLink>();
	for (const [index, value] of values.entries()) {
		const link = toExtractedLink(value, index);
		if (!link) continue;
		if (deduped.has(link.normalizedUrl)) continue;
		deduped.set(link.normalizedUrl, { ...link, sortOrder: deduped.size });
	}
	const links = Array.from(deduped.values());
	notePreviewLinkCache.set(doc, { signature, links });
	return links;
}

export function extractNoteLinksFromDoc(doc: Y.Doc): ExtractedNoteLink[] {
	return getNotePreviewLinksFromDoc(doc);
}

export function getSanitizedNotePreviewLinkInputs(rawUrls: readonly unknown[]): string[] {
	const deduped = new Map<string, string>();
	for (const value of rawUrls) {
		const link = toExtractedLink(value, 0);
		if (!link) continue;
		if (deduped.has(link.normalizedUrl)) continue;
		deduped.set(link.normalizedUrl, link.url);
	}
	return Array.from(deduped.values());
}

// ── Auto-detecting URLs typed/pasted into note content ─────────────────────────
//
// Matches a bare http(s):// or www.-prefixed URL token. Deliberately does NOT
// try to match bare domains without a scheme/www. (e.g. "example.com") the way
// the manual "add URL preview" prompt's normalizeNoteLinkUrl does — that's fine
// for a field where the user's whole input IS a URL, but auto-scanning free-
// flowing note prose with that same leniency would misfire on version numbers,
// file extensions, abbreviations, anything "word.word"-shaped. Stops at
// whitespace or a closing bracket/quote so a URL inside "(see https://x.com)"
// or "https://x.com." at a sentence's end doesn't swallow the wrapper.
const URL_CANDIDATE_PATTERN = /\bhttps?:\/\/[^\s<>()"'\]]+|\bwww\.[^\s<>()"'\]]+/gi;
// Trailing sentence punctuation a URL is unlikely to genuinely end with.
const URL_TRAILING_PUNCTUATION_PATTERN = /[.,;:!?]+$/;

/** Bare URL-shaped substrings found in free text, deduplicated in order of appearance. */
export function extractUrlCandidatesFromText(text: string): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const match of findUrlMatchesWithPositions(text)) {
		if (seen.has(match.raw)) continue;
		seen.add(match.raw);
		result.push(match.raw);
	}
	return result;
}

export type UrlMatchWithPosition = { raw: string; start: number; end: number };

/**
 * Same matching/trimming rules as extractUrlCandidatesFromText, but keeps each
 * match's position in the source string. The rich-text auto-linker (see
 * noteLinkAutoLink.ts) needs the position to split a text node at exactly the
 * right offset — a plain list of matched substrings isn't enough once a string
 * can contain more than one URL, or non-URL text around one.
 */
export function findUrlMatchesWithPositions(text: string): UrlMatchWithPosition[] {
	if (!text) return [];
	const matches: UrlMatchWithPosition[] = [];
	for (const match of text.matchAll(URL_CANDIDATE_PATTERN)) {
		if (match.index === undefined) continue;
		const raw = match[0];
		const trimmed = raw.replace(URL_TRAILING_PUNCTUATION_PATTERN, '');
		if (!trimmed) continue;
		matches.push({ raw: trimmed, start: match.index, end: match.index + trimmed.length });
	}
	return matches;
}

/** Validates/normalizes one candidate string the same way the note-link store does elsewhere. */
export function normalizeUrlCandidate(raw: string): ExtractedNoteLink | null {
	return toExtractedLink(raw, 0);
}

/**
 * Finds URL-shaped substrings in `currentText` that are not already in
 * `alreadyOfferedNormalizedUrls`, and returns them as validated/normalized
 * links (same validation `addNotePreviewLinkToDoc` applies, so nothing this
 * returns can fail to add).
 *
 * Deliberately does NOT check the note's current preview-link list itself —
 * that's the caller's `alreadyOfferedNormalizedUrls`, an ACCUMULATING set that
 * is seeded from whatever's already in the content when a note is opened (so
 * opening an old note never retroactively adds previews for URLs already
 * sitting in it) and never removes a URL once offered — including if the
 * resulting preview is later deleted manually. Checking against the live
 * preview list instead would silently resurrect a preview the user just
 * removed, the moment they typed anywhere else in the note.
 */
export function findNewlyTypedNoteLinks(
	currentText: string,
	alreadyOfferedNormalizedUrls: ReadonlySet<string>
): ExtractedNoteLink[] {
	const found: ExtractedNoteLink[] = [];
	const seenThisCall = new Set<string>();
	for (const raw of extractUrlCandidatesFromText(currentText)) {
		const link = toExtractedLink(raw, 0);
		if (!link) continue;
		if (alreadyOfferedNormalizedUrls.has(link.normalizedUrl) || seenThisCall.has(link.normalizedUrl)) continue;
		seenThisCall.add(link.normalizedUrl);
		found.push(link);
	}
	return found;
}

export function getAutoLinkedUrlsFromDoc(doc: Y.Doc): ReadonlySet<string> {
	const metadata = doc.getMap<any>('metadata');
	const raw = metadata.get(AUTO_LINKED_URLS_FIELD);
	return new Set(Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : []);
}

/** Records `normalizedUrls` as auto-handled. Safe to call with URLs already recorded — a no-op for those. */
export function markUrlsAsAutoLinked(doc: Y.Doc, normalizedUrls: readonly string[]): void {
	if (normalizedUrls.length === 0) return;
	const current = getAutoLinkedUrlsFromDoc(doc);
	if (normalizedUrls.every((url) => current.has(url))) return;
	const next = new Set(current);
	for (const url of normalizedUrls) next.add(url);
	doc.getMap<any>('metadata').set(AUTO_LINKED_URLS_FIELD, Array.from(next));
}

/**
 * Forgets `normalizedUrls` were ever auto-handled. Used by the "clean up"
 * action: a preview it removes had no matching link left in the content, so
 * there's nothing left to protect from being "resurrected" — and if that exact
 * URL is typed back in later, it should be treated as new again, not silently
 * skipped because of a stale record from before the cleanup.
 */
export function forgetAutoLinkedUrls(doc: Y.Doc, normalizedUrls: readonly string[]): void {
	if (normalizedUrls.length === 0) return;
	const current = getAutoLinkedUrlsFromDoc(doc);
	if (normalizedUrls.every((url) => !current.has(url))) return;
	const next = new Set(current);
	for (const url of normalizedUrls) next.delete(url);
	doc.getMap<any>('metadata').set(AUTO_LINKED_URLS_FIELD, Array.from(next));
}

/**
 * Which of `previewLinks` the "Clean up" button may safely remove: not
 * currently backed by a real link anywhere in the note's content, AND known
 * (via `autoLinkedUrls` — see AUTO_LINKED_URLS_FIELD's comment above) to have
 * come from that content at some point. A preview added by hand through
 * "+ URL Preview" is never in `autoLinkedUrls` — nothing in the note's content
 * ever pointed the content scanner at it — so it is never returned here, no
 * matter how long it goes without a matching link in the text.
 */
export function findCleanableOrphanedPreviews(
	previewLinks: readonly ExtractedNoteLink[],
	linkedUrlsInContent: ReadonlySet<string>,
	autoLinkedUrls: ReadonlySet<string>
): ExtractedNoteLink[] {
	return previewLinks.filter(
		(link) => !linkedUrlsInContent.has(link.normalizedUrl) && autoLinkedUrls.has(link.normalizedUrl)
	);
}

export function mergeNotePreviewLinkInputs(currentUrls: readonly string[], rawUrl: string): string[] {
	const nextLink = toExtractedLink(rawUrl, 0);
	const sanitizedCurrent = getSanitizedNotePreviewLinkInputs(currentUrls);
	if (!nextLink) return sanitizedCurrent;
	const hasExistingMatch = sanitizedCurrent.some((value) => toExtractedLink(value, 0)?.normalizedUrl === nextLink.normalizedUrl);
	if (hasExistingMatch) return sanitizedCurrent;
	return [...sanitizedCurrent, nextLink.url];
}

export function setNotePreviewLinksOnDoc(doc: Y.Doc, rawUrls: readonly unknown[]): void {
	const metadata = doc.getMap<any>('metadata');
	metadata.set(NOTE_PREVIEW_LINKS_FIELD, getSanitizedNotePreviewLinkInputs(rawUrls));
	notePreviewLinkCache.delete(doc);
}

export function addNotePreviewLinkToDoc(doc: Y.Doc, rawUrl: string): ExtractedNoteLink | null {
	const nextLink = toExtractedLink(rawUrl, 0);
	if (!nextLink) return null;
	const current = getNotePreviewLinksFromDoc(doc);
	if (current.some((entry) => entry.normalizedUrl === nextLink.normalizedUrl)) {
		return nextLink;
	}
	const metadata = doc.getMap<any>('metadata');
	doc.transact(() => {
		metadata.set(NOTE_PREVIEW_LINKS_FIELD, [...current.map((entry) => entry.url), nextLink.url]);
	});
	return { ...nextLink, sortOrder: current.length };
}

export function removeNotePreviewLinkFromDoc(doc: Y.Doc, normalizedUrl: string): void {
	const current = getNotePreviewLinksFromDoc(doc);
	const remaining = current.filter((entry) => entry.normalizedUrl !== normalizedUrl);
	const metadata = doc.getMap<any>('metadata');
	doc.transact(() => {
		metadata.set(NOTE_PREVIEW_LINKS_FIELD, remaining.map((entry) => entry.url));
	});
}