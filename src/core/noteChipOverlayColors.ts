import type React from 'react';

const NOTE_COLOR_VARS = [
	'--note-color-card-bg',
	'--note-color-header-bg',
	'--note-color-border',
	'--note-color-text',
	'--note-color-muted',
	'--note-color-accent',
] as const;

/**
 * The note colors a card is actually showing right now, read off the card element.
 *
 * Chip dropdowns render in a portal on <body>, so they can't inherit the card's CSS
 * variables. They used to rebuild the colors from the note's color token alone, which
 * knows nothing about banners: a banner-only card samples its banner and paints itself
 * with those colors, while its dropdown opened in plain theme colors. Reading what the
 * card really computed covers banners, note colors and plain themes with one path.
 *
 * Reads from the card, not the chip button: the button carries its own token-based
 * variables inline, which is exactly the banner-blind version we're trying to avoid.
 */
export function readInheritedNoteColorVars(trigger: HTMLElement | null): React.CSSProperties | undefined {
	if (!trigger || typeof window === 'undefined') return undefined;
	const source = trigger.closest<HTMLElement>('[data-note-card="true"]') ?? trigger.parentElement;
	if (!source) return undefined;
	const computed = window.getComputedStyle(source);
	const vars: Record<string, string> = {};
	for (const name of NOTE_COLOR_VARS) {
		const value = computed.getPropertyValue(name).trim();
		if (value) vars[name] = value;
	}
	return Object.keys(vars).length > 0 ? (vars as React.CSSProperties) : undefined;
}
