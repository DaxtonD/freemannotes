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

/**
 * `edited` annotates a card that is still a card. `removed` marks one that is a TOMBSTONE: the note
 * has been trashed, deleted, or shared-access revoked, and this is what is left of it until the
 * user applies the change.
 *
 * The two differ in three ways, each on purpose:
 *
 * - **The veil is flat rather than a gradient.** A bottom-to-top fade says "look at the bottom of
 *   this card"; a removal is about the whole card, so the whole card dims evenly.
 * - **It does NOT fade out on hover.** The edited treatment gets out of the way so the card's
 *   action dock is usable - but a removed card has nothing worth acting on, and a treatment that
 *   disappeared under the pointer would make the card look alive again.
 * - **It swallows pointer events** instead of passing them through. There is no good answer to
 *   "what happens when you click a note that is gone": for a deleted one there is nothing to open,
 *   and for a trashed one you would be taken into something you have not agreed to lose yet.
 */
export type NoteChangeOverlayKind = 'edited' | 'removed';

/**
 * Everything a card or row needs to draw its overlay, built once per changed note in NoteGrid.
 *
 * It carries the localised strings rather than letting each render site look them up, because
 * there are three sites (grid card, list row, strip row) and keeping the lookup in one place is
 * what stops the row variant growing its own idea of what a missing name means.
 */
export type NoteChangeOverlayDescriptor = {
	row: NoteChangeChipRow;
	/** For the card's aria-label, which is where a screen reader hears about this. */
	label: string;
	overflowLabel: string;
	kind: NoteChangeOverlayKind;
	/** "deleted this note" - the card variant, where there is room for a sentence. */
	removedVerb: string;
	/** "deleted" - the row variant, which has already given up the name for space. */
	removedVerbShort: string;
	removedFallbackLabel: string;
};

export function NoteChangeOverlay(props: {
	row: NoteChangeChipRow;
	/** Already localised and formatted, e.g. "+2 more". */
	overflowLabel: string;
	variant?: NoteChangeOverlayVariant;
	kind?: NoteChangeOverlayKind;
	/** The verb, already localised: "deleted this note" on a card, "deleted" on a row. */
	removedLabel?: string;
	/** Shown when a removal has nobody attributed to it, e.g. "This note was deleted". */
	removedFallbackLabel?: string;
}): React.JSX.Element | null {
	const isRemoved = props.kind === 'removed';
	// A removal with nobody attributed to it still has to be drawn - an unattributed change is the
	// normal case when the tab was disconnected, and a card that silently dimmed with no
	// explanation would be worse than no treatment at all.
	if (props.row.chips.length === 0 && !isRemoved) return null;
	const isRow = props.variant === 'row';
	return (
		<div
			className={[
				styles.overlay,
				isRow ? styles.overlayRow : '',
				isRemoved ? styles.overlayRemoved : '',
			].filter(Boolean).join(' ')}
			data-note-change-overlay={isRemoved ? 'removed' : 'true'}
			aria-hidden="true"
		>
			<div
				className={[
					styles.scrim,
					isRow ? styles.scrimRow : '',
					isRemoved ? styles.scrimRemoved : '',
				].filter(Boolean).join(' ')}
			/>
			<div className={`${styles.chipStack}${isRow ? ` ${styles.chipStackRow}` : ''}`}>
				{props.row.chips.map((chip) => (
					<span
						key={chip.key}
						className={[
							styles.chip,
							isRemoved ? styles.chipRemoved : '',
							// Two-line layout on a card; a row stays on one line and has no name.
							isRemoved && !isRow ? styles.chipRemovedStacked : '',
						].filter(Boolean).join(' ')}
						// The row variant drops the visible name, so the tooltip is the only place
						// it survives - which makes it load-bearing there rather than a nicety.
						title={[
							chip.name,
							isRemoved ? props.removedLabel : '',
							chip.elapsedLabel,
						].filter(Boolean).join(' · ')}
					>
						<NoteChangeAvatar url={chip.avatarUrl} initial={chip.initial} />
						{/* A removal on a CARD goes two-line beside the avatar: name on top, verb
						    and time underneath.

						    One line did not survive a phone. "Meshuga deleted this note 3m" in a
						    nowrap chip on a narrow card ellipsised the NAME, so it read
						    "m, deleted this note" - the one word that had to survive was the one
						    that got cut. Stacking gives the verb its own line and lets the name
						    use the chip's full width before it has to truncate at all. */}
						{isRemoved && !isRow ? (
							<span className={styles.removedStack}>
								<span className={styles.name}>{chip.name}</span>
								<span className={styles.removedLine}>
									{props.removedLabel ? <span className={styles.removedVerb}>{props.removedLabel}</span> : null}
									{chip.elapsedLabel ? <span className={styles.elapsed}>{chip.elapsedLabel}</span> : null}
								</span>
							</span>
						) : (
							<>
								{isRow ? null : <span className={styles.name}>{chip.name}</span>}
								{/* The verb is the whole point of a removal chip: an avatar and a
								    time alone would read as "this person was here", not "this is
								    gone". On a row it is all there is room for, so the name goes
								    and the verb stays. */}
								{isRemoved && props.removedLabel
									? <span className={styles.removedVerb}>{props.removedLabel}</span>
									: null}
								{chip.elapsedLabel ? <span className={styles.elapsed}>{chip.elapsedLabel}</span> : null}
							</>
						)}
					</span>
				))}
				{props.row.chips.length === 0 && isRemoved && props.removedFallbackLabel ? (
					<span className={`${styles.chip} ${styles.chipRemoved}`}>
						<span className={styles.removedVerb}>{props.removedFallbackLabel}</span>
					</span>
				) : null}
				{props.row.overflowCount > 0 ? (
					<span className={styles.overflowChip} title={props.overflowLabel || undefined}>
						{isRow ? `+${props.row.overflowCount}` : props.overflowLabel}
					</span>
				) : null}
			</div>
		</div>
	);
}
