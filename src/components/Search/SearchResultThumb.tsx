import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileLines, faImage, faLink, faNoteSticky, faTag, faUsers } from '@fortawesome/free-solid-svg-icons';
import { getNoteBannerAssetUrl } from '../../core/noteBannerApi';
import { getUserNoteBannerFile } from '../../core/noteBannerPreferences';
import { guessNoteBannerCategory } from '../../core/noteBannerCategoryGuess';
import { getUserNoteColorToken } from '../../core/noteColorPreferences';
import { resolveThemeNoteColorModel } from '../../core/noteColors';
import type { ThemeId } from '../../core/theme';
import styles from './SearchResultThumb.module.css';

/**
 * The tile at the left of a search result.
 *
 * It used to fall back to the first letter of the title on a gradient, which was the loudest thing
 * on the card and told you something the title — sitting twelve pixels to its right — already said
 * better. The whole left column read like a contact list.
 *
 * So instead of inventing an identity for the note, it now borrows the one the note already has
 * everywhere else: its banner art, or its colour. You recognise a result because it looks like the
 * card you already know from the grid. Both are per-user preferences read straight from the local
 * stores, so this costs no API change and no extra field on the search payload — a note from
 * another workspace whose prefs aren't loaded simply falls through to the next option.
 *
 * The ladder, most to least specific:
 *   1. a real picture      — a document's first page, a photo, a link's preview image
 *   2. the note's banner art                        (explicitly chosen)
 *   3. the note's colour, as a tint                 (explicitly chosen)
 *   4. banner art guessed from the title            (inferred — see noteBannerCategoryGuess)
 *   5. a neutral tile
 * Explicit choices outrank the guess: if you coloured a note yellow you expect to see yellow, even
 * though a topical picture would arguably scan better.
 *
 * The kind glyph appears on the rungs where the tile alone can't tell you what you're looking at —
 * a real photo could be anything, and a bare tile needs to say something. Banner rungs skip it:
 * their artwork is already the signifier, and the right-hand rail states the kind in words on
 * every row regardless, so a second marker on a 52px square is clutter rather than clarity.
 */

type ThumbKind = 'note' | 'document' | 'image' | 'link' | 'collaborator' | 'label';

const KIND_ICON: Record<ThumbKind, typeof faNoteSticky> = {
	note: faNoteSticky,
	document: faFileLines,
	image: faImage,
	link: faLink,
	collaborator: faUsers,
	label: faTag,
};

/**
 * Banner art comes in two variants with *completely different* geometry, which matters because
 * the tile crops to the icon rather than showing the whole banner:
 *
 *   checklist.svg   520x240   icon at translate(420,120)
 *   checklistW.svg  1000x240  icon at translate(880,120) scale(0.6)
 *
 * Two things conspire to hand us the wrong one. A stored preference may already carry the `W`
 * (nothing strips it), and `resolveThemeBannerAssetFileName` only ever *appends* `W` for the list
 * layout — so asking for the card layout with "checklistW.svg" yields "checklistw.svg", which a
 * case-insensitive filesystem cheerfully resolves to the wide file. The crop then lands in the
 * empty middle of a 1000px-wide image and you get background texture and no icon.
 *
 * So: normalise the stem to the card variant (also the higher-detail art — the wide one scales its
 * icon to 0.6), and tell the stylesheet which geometry actually came back so the crop is right
 * even if something hands us the wide file anyway.
 */
function resolveBannerTile(fileName: string, themeId: ThemeId): { url: string; variant: 'card' | 'wide' } {
	const match = /^(.*?)(\.[a-z0-9]+)?$/i.exec(fileName.trim());
	const stem = (match?.[1] ?? fileName).trim();
	const extension = match?.[2] ?? '.svg';
	// No banner category ends in "w" (calendar…work), so a trailing one is always the wide marker.
	const cardStem = /w$/i.test(stem) ? stem.slice(0, -1) : stem;
	const url = getNoteBannerAssetUrl(`${cardStem}${extension}`, themeId, 'card');
	return { url, variant: /w\.[a-z0-9]+$/i.test(url) ? 'wide' : 'card' };
}

/** The most specific thing this result matched: that's what the tile should say it is. */
function pickKind(matchKinds: readonly string[]): ThumbKind {
	if (matchKinds.includes('document')) return 'document';
	if (matchKinds.includes('ocr') || matchKinds.includes('imageName')) return 'image';
	if (matchKinds.includes('link')) return 'link';
	if (matchKinds.includes('collaborator')) return 'collaborator';
	if (matchKinds.includes('label') || matchKinds.includes('collection')) return 'label';
	return 'note';
}

export function SearchResultThumb(props: {
	thumbnailUrl: string | null;
	title: string;
	matchKinds: readonly string[];
	noteId: string;
	themeId: ThemeId;
}): React.JSX.Element {
	const [failed, setFailed] = React.useState(false);
	React.useEffect(() => setFailed(false), [props.thumbnailUrl]);

	const kind = pickKind(props.matchKinds);
	const glyph = <FontAwesomeIcon className={styles.kindIcon} icon={KIND_ICON[kind]} />;

	// Rung 1: a real picture. Pictures fail more often than you'd expect (offline, a deleted file,
	// a hotlink-blocked link image) and a broken-image icon looked like a bug, so a failure drops
	// to the rungs below rather than showing the browser's placeholder.
	if (props.thumbnailUrl && !failed) {
		return (
			<span className={styles.tile}>
				<img
					className={styles.image}
					src={props.thumbnailUrl}
					alt=""
					loading="lazy"
					decoding="async"
					onError={() => setFailed(true)}
				/>
				<span className={styles.glyphScrim} aria-hidden="true">{glyph}</span>
			</span>
		);
	}

	// Rung 2: the note's own banner.
	//
	// Rendered as a background rather than an <img> so it can be cropped to the artwork's icon.
	// These banners are 520x240 with the icon at translate(420,120) — far to the right, on a clean
	// zone the horizontal fade lays down for it (the fade paints first, the icon on top). A square
	// tile with object-fit:cover takes the MIDDLE of that, which is the one region guaranteed to
	// contain no icon at all: just background texture. See .banner in the stylesheet for the crop.
	const bannerFile = getUserNoteBannerFile(props.noteId);
	if (bannerFile) {
		const banner = resolveBannerTile(bannerFile, props.themeId);
		return (
			<span
				className={`${styles.tile} ${styles.banner}`}
				data-variant={banner.variant}
				style={{ backgroundImage: `url("${banner.url}")` }}
				aria-hidden="true"
			/>
		);
	}

	// Rung 3: the note's colour, as a tint. An explicit choice, so it outranks the guess below.
	const colorToken = getUserNoteColorToken(props.noteId);
	if (colorToken) {
		const scheme = resolveThemeNoteColorModel(props.themeId).tokens[colorToken];
		return (
			<span
				className={styles.tile}
				data-kind={kind}
				data-tinted="true"
				style={{
					'--search-thumb-fill': scheme.cardBackground,
					'--search-thumb-edge': scheme.borderColor,
					'--search-thumb-ink': scheme.mutedTextColor,
				} as React.CSSProperties}
				aria-hidden="true"
			>
				<span className={styles.glyphOnly}>{glyph}</span>
			</span>
		);
	}

	// Rung 4: banner art guessed from the title. Same artwork and same crop as rung 2 — a guessed
	// tile is meant to sit beside a chosen one without looking like a different kind of thing.
	const guessedCategory = guessNoteBannerCategory(props.title);
	if (guessedCategory) {
		return (
			<span
				className={`${styles.tile} ${styles.banner}`}
				data-guessed="true"
				data-variant="card"
				style={{ backgroundImage: `url("${getNoteBannerAssetUrl(`${guessedCategory}.svg`, props.themeId, 'card')}")` }}
				aria-hidden="true"
			/>
		);
	}

	// Rung 5: nothing to go on. A quiet kind-tinted tile.
	return (
		<span className={styles.tile} data-kind={kind} aria-hidden="true">
			<span className={styles.glyphOnly}>{glyph}</span>
		</span>
	);
}
