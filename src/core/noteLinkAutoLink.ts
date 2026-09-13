import type { JSONContent } from '@tiptap/core';
import {
	findUrlMatchesWithPositions,
	normalizeUrlCandidate,
	type ExtractedNoteLink,
} from './noteLinks';

// Ensures every hyperlink in a note's rich content — however it got there — has
// a matching preview card, and turns bare URL text into a real hyperlink along
// the way. "However it got there" covers three different origins, and the
// first version of this only handled the last one:
//   1. A link applied manually via the toolbar ("Google" -> https://google.com).
//      The visible text isn't URL-shaped at all here — the only way to find the
//      target is to read the mark's own href, not scan the text.
//   2. TipTap's own `autolink` extension already turning a bare typed URL into
//      a real `link` mark live, before this ever runs.
//   3. Bare URL text that never got linked at all (autolink can miss cases
//      depending on how/where it was entered) — this is the one case that
//      needs the text itself split and a new mark added.
//
// This is deliberately a PURE function over prosemirror-json, not something
// wired into the live editor's onUpdate. Rewriting content marks while someone
// (possibly a collaborator on another device) is actively typing in the same
// document is exactly the kind of thing that goes wrong in a CRDT-backed
// editor — cursor jumps, undo-history noise, or a transform racing a
// concurrent edit. Callers run this once, at a natural quiet point (a note
// closing, or a new note being saved for the first time) — see NoteEditor.tsx's
// runCloseTimeUrlAutoLink and the two pending-new-note save handlers.

export type AutoLinkResult = {
	json: JSONContent;
	/** False when the tree itself is unchanged — json is the exact same object, not a copy. Text can still need a preview (case 1/2 above) with changed=false. */
	changed: boolean;
	/** Every link — pre-existing or newly created — not yet in the caller's alreadyHandled set. The caller adds a preview for each and records it as handled. */
	linksNeedingPreview: ExtractedNoteLink[];
};

function hasMark(node: JSONContent, type: string): boolean {
	return (node.marks ?? []).some((mark) => mark.type === type);
}

function isTextNode(node: JSONContent): node is JSONContent & { text: string } {
	return node.type === 'text' && typeof node.text === 'string';
}

/**
 * Handles one already-linked text node: read its real target off the mark
 * (never re-derive it from the visible text, which for a manually-applied
 * link is often just a label like "Google") and queue a preview for it unless
 * already handled. The node itself is never modified — it's already a link.
 */
function collectExistingLink(
	node: JSONContent & { text: string },
	linkMark: NonNullable<JSONContent['marks']>[number],
	alreadyHandled: ReadonlySet<string>,
	linksNeedingPreview: Map<string, ExtractedNoteLink>
): void {
	const href = typeof linkMark.attrs?.href === 'string' ? linkMark.attrs.href : '';
	if (!href) return;
	const link = normalizeUrlCandidate(href);
	if (!link || alreadyHandled.has(link.normalizedUrl)) return;
	linksNeedingPreview.set(link.normalizedUrl, link);
}

/**
 * Splits one NOT-YET-LINKED text node around any URL-shaped runs it contains,
 * applying a real link mark to each. Returns `[node]` (the exact same object)
 * when there is nothing to link — a match whose normalizedUrl is already in
 * `alreadyHandled` still gets skipped, not re-wrapped, so manually removing an
 * auto-added hyperlink (leaving the bare text behind) stays removed rather
 * than reappearing the next time the note closes with that text still present.
 */
function splitTextNodeAtUrls(
	node: JSONContent & { text: string },
	alreadyHandled: ReadonlySet<string>,
	linksNeedingPreview: Map<string, ExtractedNoteLink>
): JSONContent[] {
	const matches = findUrlMatchesWithPositions(node.text);
	if (matches.length === 0) return [node];

	const pieces: JSONContent[] = [];
	let cursor = 0;
	let appliedAnyLink = false;

	for (const match of matches) {
		const link = normalizeUrlCandidate(match.raw);
		if (!link) continue;

		if (match.start > cursor) {
			pieces.push({ ...node, text: node.text.slice(cursor, match.start) });
		}

		if (alreadyHandled.has(link.normalizedUrl)) {
			// Leave it as plain text — see the function comment above.
			pieces.push({ ...node, text: node.text.slice(match.start, match.end) });
			cursor = match.end;
			continue;
		}

		pieces.push({
			...node,
			text: node.text.slice(match.start, match.end),
			marks: [...(node.marks ?? []), { type: 'link', attrs: { href: link.url } }],
		});
		linksNeedingPreview.set(link.normalizedUrl, link);
		appliedAnyLink = true;
		cursor = match.end;
	}

	// Nothing actually got linked (every match was either invalid or already
	// handled) — return the original node untouched rather than the
	// functionally-identical but needlessly re-split pieces we built above.
	if (!appliedAnyLink) return [node];

	if (cursor < node.text.length) {
		pieces.push({ ...node, text: node.text.slice(cursor) });
	}
	return pieces;
}

/** Recursively walks `node.content`, handling eligible text children. Returns the same object when nothing changed. */
function transformNode(
	node: JSONContent,
	alreadyHandled: ReadonlySet<string>,
	linksNeedingPreview: Map<string, ExtractedNoteLink>
): JSONContent {
	// A URL shown in a code block is source/literal text, not prose — leave it alone.
	if (node.type === 'codeBlock') return node;
	if (!node.content || node.content.length === 0) return node;

	let childrenChanged = false;
	const nextContent: JSONContent[] = [];
	for (const child of node.content) {
		if (isTextNode(child)) {
			const linkMark = (child.marks ?? []).find((mark) => mark.type === 'link');
			if (linkMark) {
				collectExistingLink(child, linkMark, alreadyHandled, linksNeedingPreview);
				nextContent.push(child);
				continue;
			}
			if (hasMark(child, 'code')) {
				nextContent.push(child);
				continue;
			}
			const pieces = splitTextNodeAtUrls(child, alreadyHandled, linksNeedingPreview);
			if (pieces.length !== 1 || pieces[0] !== child) childrenChanged = true;
			nextContent.push(...pieces);
		} else {
			const transformedChild = transformNode(child, alreadyHandled, linksNeedingPreview);
			if (transformedChild !== child) childrenChanged = true;
			nextContent.push(transformedChild);
		}
	}

	if (!childrenChanged) return node;
	return { ...node, content: nextContent };
}

/**
 * Every href actually present as a real `link` mark in `json`, normalized —
 * used by the "clean up" action to find preview cards that no longer have a
 * matching hyperlink anywhere in the note (the link was deleted, or its
 * formatting was removed, but the preview was never told).
 */
export function collectLinkedUrlsFromRichContentJson(json: JSONContent): Set<string> {
	const hrefs = new Set<string>();
	const visit = (node: JSONContent): void => {
		if (!node.content) return;
		for (const child of node.content) {
			if (isTextNode(child)) {
				const linkMark = (child.marks ?? []).find((mark) => mark.type === 'link');
				const href = typeof linkMark?.attrs?.href === 'string' ? linkMark.attrs.href : '';
				if (href) {
					const link = normalizeUrlCandidate(href);
					if (link) hrefs.add(link.normalizedUrl);
				}
				continue;
			}
			visit(child);
		}
	};
	visit(json);
	return hrefs;
}

/**
 * Walks `json`, turning bare URL text into real hyperlinks and collecting
 * every link in the document — pre-existing or newly created — whose
 * normalizedUrl isn't already in `alreadyHandled` (see
 * getAutoLinkedUrlsFromDoc/markUrlsAsAutoLinked in noteLinks.ts for the
 * persisted form of that set). The caller is responsible for adding a preview
 * for each returned link and recording it as handled.
 */
export function autoLinkifyRichContentJson(json: JSONContent, alreadyHandled: ReadonlySet<string>): AutoLinkResult {
	const linksNeedingPreview = new Map<string, ExtractedNoteLink>();
	const nextJson = transformNode(json, alreadyHandled, linksNeedingPreview);
	return {
		json: nextJson,
		changed: nextJson !== json,
		linksNeedingPreview: Array.from(linksNeedingPreview.values()),
	};
}
