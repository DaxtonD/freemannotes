import * as Y from 'yjs';

// URL-preview metadata lives in the Yjs note document so editors, cards, and browser
// modals can all derive the same canonical preview-intent list from one place.

const SECOND_LEVEL_SUFFIXES = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);
const NOTE_PREVIEW_LINKS_FIELD = 'urlPreviewLinks';
const notePreviewLinkCache = new WeakMap<Y.Doc, { signature: string; links: ExtractedNoteLink[] }>();

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