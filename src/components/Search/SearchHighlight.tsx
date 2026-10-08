import React from 'react';

/**
 * Marks the searched term inside a result snippet.
 *
 * Searching for a word and then having to hunt for it in the result is the one thing a snippet
 * exists to prevent, and we were doing exactly that: the server finds the match, centres a
 * ~144-character window on it, and then returns a flat string with the offset thrown away.
 *
 * Rather than change the snippet API shape (it's shared by note, document and image snippets and
 * reshaping it would ripple through all three), we just find the query again on this side. That's
 * reliable precisely because of how the snippet was built — it's constructed around the match, so
 * the term is in there by construction. If it somehow isn't, this renders the text untouched.
 */

type Part = { text: string; match: boolean };

/** Case-insensitive, every occurrence. Deliberately indexOf rather than a RegExp: the query is raw
 *  user input, and escaping it for a character class is a worse job than not needing to. */
function splitOnQuery(text: string, query: string): Part[] {
	const source = String(text ?? '');
	const needle = String(query ?? '').trim();
	// An empty needle would spin forever below, so this guard is load-bearing, not defensive.
	if (!source || !needle) return [{ text: source, match: false }];

	const haystack = source.toLowerCase();
	const lowerNeedle = needle.toLowerCase();
	const parts: Part[] = [];
	let cursor = 0;
	for (;;) {
		const index = haystack.indexOf(lowerNeedle, cursor);
		if (index === -1) break;
		if (index > cursor) parts.push({ text: source.slice(cursor, index), match: false });
		parts.push({ text: source.slice(index, index + needle.length), match: true });
		cursor = index + needle.length;
	}
	if (parts.length === 0) return [{ text: source, match: false }];
	if (cursor < source.length) parts.push({ text: source.slice(cursor), match: false });
	return parts;
}

export function SearchHighlight(props: { text: string; query: string }): React.JSX.Element {
	const parts = React.useMemo(() => splitOnQuery(props.text, props.query), [props.text, props.query]);
	return (
		<>
			{parts.map((part, index) => (
				part.match
					? <mark key={index} className="global-search-mark">{part.text}</mark>
					: <React.Fragment key={index}>{part.text}</React.Fragment>
			))}
		</>
	);
}
