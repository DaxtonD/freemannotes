import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

/**
 * The little tile on an indented match row — the document, image or link that caused a note to
 * turn up in search.
 *
 * These rows showed a generic glyph, so four attachments on one note gave you four identical
 * document icons and the file name as the only thing telling them apart. The preview that would
 * actually distinguish them already exists in the payload for all three kinds (a document's
 * first-page render, an image's thumbnail, a link's OG image) and was simply not being used.
 *
 * Deliberately NOT SearchResultThumb, which is the 52px tile for the result itself and climbs a
 * five-rung ladder through the note's banner art and colour to express the note's identity. A
 * 28px row tile has one job and no identity of its own to express.
 *
 * It does borrow that component's hardest-won lesson: pictures fail more often than you would
 * expect — offline, a deleted file, a link image the far end refuses to hotlink — and the
 * browser's broken-image glyph reads as a bug. A failure falls back to the icon this row would
 * have shown anyway, so the worst case is exactly the old behaviour.
 */
export function SearchMatchThumb(props: { url?: string | null; icon: IconDefinition }): React.JSX.Element {
	const [failed, setFailed] = React.useState(false);
	// A row is reused as results change, so a previous failure must not stick to the next picture.
	React.useEffect(() => setFailed(false), [props.url]);

	if (props.url && !failed) {
		return (
			<img
				className="global-search-result-match-thumb"
				src={props.url}
				alt=""
				loading="lazy"
				decoding="async"
				onError={() => setFailed(true)}
			/>
		);
	}
	return <FontAwesomeIcon className="global-search-result-match-icon" icon={props.icon} />;
}
