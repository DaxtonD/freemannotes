import React from 'react';

import type { NoteChangeChipRow } from '../../core/noteChangeChips';

import styles from './NoteChangeOverlay.module.css';

/**
 * "Somebody else changed this card while you were looking at it."
 *
 * Three deliberate properties, each of which took a wrong turn first:
 *
 * 1. **It does not participate in layout.** `position: absolute; inset: 0` inside the card, so it
 *    tracks the card's size for free and - the part that matters - contributes nothing to the
 *    height the ResizeObserver feeds to the masonry packer. Two attempts at *holding* card height
 *    were reverted before this; the lesson was to keep anything new strictly out of that loop.
 *
 * 2. **`pointer-events: none`, all of it.** The card underneath stays fully interactive: checklist
 *    boxes, link previews, the more-menu, the open gesture. Opening the note is what clears the
 *    chip, so the overlay has nothing to handle and no reason to intercept anything.
 *
 * 3. **The scrim and the signal are separate elements doing separate jobs.** The scrim is a veil
 *    mixed from the card's own TEXT colour, so it contrasts with the card in every theme and on
 *    every note colour - a black wash only worked on light cards, which is what the first version
 *    got wrong. The signal is the accent border on the card itself (`cardChanged` in
 *    NoteCard.module.css). Two elements, because a veil alone cannot say "changed" when a dark
 *    card is veiled light and a light card veiled dark.
 *
 * Entirely `aria-hidden`: a screen reader gets one sentence appended to the card's own aria-label
 * instead (see NoteCard), which is what it actually wants rather than six nested spans of avatar
 * and elapsed time.
 */
/**
 * Avatar, falling back to the initial when the image does not load.
 *
 * The fallback is the offline case, not a nicety. An avatar lives at `/uploads/<userId>.webp` and
 * is only in the service worker's cache if this device has loaded it before - a collaborator whose
 * picture was never fetched, on a device that is now offline, gets a failed request. Without this
 * the chip renders a broken-image glyph, which is worse than the initial it already knows how to
 * draw.
 */
function NoteChangeAvatar(props: { url: string | null; initial: string }): React.JSX.Element {
	const [failed, setFailed] = React.useState(false);
	// A changed avatar URL deserves a fresh attempt rather than inheriting the last one's failure.
	React.useEffect(() => { setFailed(false); }, [props.url]);
	if (!props.url || failed) {
		return <span className={styles.avatarFallback}>{props.initial}</span>;
	}
	return (
		<img
			className={styles.avatar}
			src={props.url}
			alt=""
			loading="lazy"
			decoding="async"
			onError={() => setFailed(true)}
		/>
	);
}

/**
 * `card` is the grid card: chips stacked up the bottom-left, veil fading bottom to top.
 *
 * `row` is a list/strip row, where vertical space is 44px and there is none to spare - so the
 * chips run horizontally at the right end (inboard of the more-menu button), the veil fades left
 * to right, and the NAME is dropped. Avatar and elapsed time only: on a row the title is right
 * there beside it, so the avatar is enough to say who, and a name would push the title out.
 */
export type NoteChangeOverlayVariant = 'card' | 'row';

export function NoteChangeOverlay(props: {
	row: NoteChangeChipRow;
	/** Already localised and formatted, e.g. "+2 more". */
	overflowLabel: string;
	variant?: NoteChangeOverlayVariant;
}): React.JSX.Element | null {
	if (props.row.chips.length === 0) return null;
	const isRow = props.variant === 'row';
	return (
		<div
			className={`${styles.overlay}${isRow ? ` ${styles.overlayRow}` : ''}`}
			data-note-change-overlay="true"
			aria-hidden="true"
		>
			<div className={`${styles.scrim}${isRow ? ` ${styles.scrimRow}` : ''}`} />
			<div className={`${styles.chipStack}${isRow ? ` ${styles.chipStackRow}` : ''}`}>
				{props.row.chips.map((chip) => (
					<span
						key={chip.key}
						className={styles.chip}
						// The row variant drops the visible name, so the tooltip is the only place
						// it survives - which makes it load-bearing there rather than a nicety.
						title={chip.elapsedLabel ? `${chip.name} · ${chip.elapsedLabel}` : chip.name}
					>
						<NoteChangeAvatar url={chip.avatarUrl} initial={chip.initial} />
						{isRow ? null : <span className={styles.name}>{chip.name}</span>}
						{chip.elapsedLabel ? <span className={styles.elapsed}>{chip.elapsedLabel}</span> : null}
					</span>
				))}
				{props.row.overflowCount > 0 ? (
					<span className={styles.overflowChip} title={props.overflowLabel || undefined}>
						{isRow ? `+${props.row.overflowCount}` : props.overflowLabel}
					</span>
				) : null}
			</div>
		</div>
	);
}
