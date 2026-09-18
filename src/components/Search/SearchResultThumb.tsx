import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileLines, faImage, faLink, faNoteSticky, faTag, faUsers } from '@fortawesome/free-solid-svg-icons';
import styles from './SearchResultThumb.module.css';

// The square at the left of a search result. A real picture when there is one — a document's first
// page, a photo, a link's preview image — and otherwise a tile built from what the result *is*
// rather than a shrunken imitation of the note. Pictures fail more often than you'd think (offline,
// a deleted file, a hotlink-blocked link image), and a broken-image icon looked like a bug.

type ThumbKind = 'note' | 'document' | 'image' | 'link' | 'collaborator' | 'label';

const KIND_ICON: Record<ThumbKind, typeof faNoteSticky> = {
	note: faNoteSticky,
	document: faFileLines,
	image: faImage,
	link: faLink,
	collaborator: faUsers,
	label: faTag,
};

/** The most specific thing this result matched: that's what the tile should say it is. */
function pickKind(matchKinds: readonly string[]): ThumbKind {
	if (matchKinds.includes('document')) return 'document';
	if (matchKinds.includes('ocr') || matchKinds.includes('imageName')) return 'image';
	if (matchKinds.includes('link')) return 'link';
	if (matchKinds.includes('collaborator')) return 'collaborator';
	if (matchKinds.includes('label') || matchKinds.includes('collection')) return 'label';
	return 'note';
}

function firstLetter(title: string): string {
	for (const character of String(title || '').trim()) {
		if (/\p{L}|\p{N}/u.test(character)) return character.toUpperCase();
	}
	return '·';
}

export function SearchResultThumb(props: { thumbnailUrl: string | null; title: string; matchKinds: readonly string[] }): React.JSX.Element {
	const [failed, setFailed] = React.useState(false);
	React.useEffect(() => setFailed(false), [props.thumbnailUrl]);

	if (props.thumbnailUrl && !failed) {
		return (
			<img
				className={styles.thumb}
				src={props.thumbnailUrl}
				alt=""
				loading="lazy"
				decoding="async"
				onError={() => setFailed(true)}
			/>
		);
	}

	const kind = pickKind(props.matchKinds);
	return (
		<div className={styles.fallback} data-kind={kind} aria-hidden="true">
			<span className={styles.initial}>{firstLetter(props.title)}</span>
			<FontAwesomeIcon className={styles.kindIcon} icon={KIND_ICON[kind]} />
		</div>
	);
}
