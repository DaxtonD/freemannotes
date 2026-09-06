import React from 'react';
import { useI18n } from '../../core/i18n';
import styles from './Editors.module.css';

export type ChecklistProgressBarProps = {
	completed: number;
	total: number;
};

// Total time the orb takes to travel the FULL 0↔1 length of the bar, on
// either a checking or unchecking shot. Fixed regardless of how far this
// particular shot's target actually is from its starting edge — like a
// fixed-length barrel, not a speed that scales with the target — see the
// catch-up math in the effect below for why that matters.
const ORB_TRAVEL_DURATION_MS = 420;

// This bar was playing its full check/uncheck shot animation on every single
// note open, for notes nobody had touched. Nothing was wrong with the
// animation code — a note's checklist data just doesn't necessarily reflect
// its true completed/total counts on this component's very first render,
// since IndexedDB hydration and Yjs materialization can still be settling for
// a short window right after the note opens, and from this component's point
// of view that settle is completely indistinguishable from a real toggle:
// same completed-count jump, same trigger, same animation. (This component
// gets a fresh instance per note via key={noteId} at its call sites
// specifically so this window resets on every note you open, not just once
// at app startup.) Any completed-count change within this many ms of mount
// now gets treated as "still opening," not a real toggle, and just snaps
// into place. Chosen generously against realistic hydration timing — the
// cost of a genuine toggle landing THIS fast after open merely not animating
// once is nothing next to animating on literally every open.
const OPEN_SETTLE_GRACE_MS = 800;

/**
 * Discrete "N of M completed" indicator + animated fill bar for checklist
 * notes. Modeled on two opposing Half-Life 2 pulse-rifle-style energy orbs
 * rather than a whole-bar flash — completed and incomplete items pushing
 * back against each other, not one neutral indicator:
 *
 * - Checking an item fires an accent-colored orb from the very START of the
 *   bar (0%) every time.
 * - Unchecking an item fires a muted/grey "incomplete" orb from the very END
 *   of the bar (100%) every time — the opposite side, the opposite color.
 *
 * Either way, the fill does NOT move for the first leg of the shot — it
 * stays exactly where it was while the orb travels through territory it
 * doesn't need to touch yet. Only once the orb reaches the fill's *old* edge
 * does the fill start moving too, and from that point on the two move
 * together at the same rate, arriving at the new position at the same
 * instant. A 50%→60% check looks like: orb races from 0% up through the
 * already-filled 0–50% region alone, then at the 50% mark the fill joins in
 * and they finish the last 50%→60% together. A 50%→40% uncheck mirrors this
 * from the other side: a grey orb races in from 100% down through the
 * still-empty 50–100% region alone, then at the 50% mark the fill joins in
 * and gets dragged down to 40% together with it.
 *
 * The orb and the fill are deliberately two SEPARATE position values, not
 * one shared value driving both — resetting the orb to its starting edge
 * must never move the fill, since the fill hasn't been "reached" yet.
 *
 * The fill's own transition needs a computed delay (how long the orb takes
 * to reach the fill's old position, at a constant rate over the whole shot
 * distance) and a shortened duration (whatever's left of the fixed travel
 * time) — both derived fresh per shot, not fixed CSS constants, which is why
 * they're set as inline `transition` overrides rather than living in
 * Editors.module.css.
 *
 * Both directions are a two-step change under the hood: snap the orb to its
 * starting edge with its transition off (the fill isn't touched at all in
 * this step), then (a frame later, once that's actually painted) turn the
 * computed transitions on for both and set their real targets — the same
 * "disable, then re-enable a frame later" trick used for BubbleView's
 * zoom-driven repacks, and for the same reason: a transition can't animate
 * from a value the browser hasn't painted yet.
 */
export function ChecklistProgressBar({ completed, total }: ChecklistProgressBarProps): React.JSX.Element | null {
	const { t } = useI18n();
	const clampedCompleted = Math.max(0, Math.min(completed, total));
	const isComplete = total > 0 && clampedCompleted >= total;
	const progress = total > 0 ? clampedCompleted / total : 0;

	const [orbPosition, setOrbPosition] = React.useState(progress);
	const [fillPosition, setFillPosition] = React.useState(progress);
	// `undefined` = use the default CSS transition (mount only, now — both the
	// checking and unchecking shots compute their own below). 'none' = the
	// orb's reset snap. A computed string = a shot's per-event delay/duration.
	const [orbLeftTransition, setOrbLeftTransition] = React.useState<string | undefined>(undefined);
	const [fillTransition, setFillTransition] = React.useState<string | undefined>(undefined);
	// Which side's orb fired most recently — drives the accent-vs-muted color
	// swap (see .checklistProgressOrbUnchecking in Editors.module.css).
	const [orbDirection, setOrbDirection] = React.useState<'checking' | 'unchecking'>('checking');
	const previousCompletedRef = React.useRef(clampedCompleted);
	const previousProgressRef = React.useRef(progress);
	const mountTimeRef = React.useRef(Date.now());
	// Retrigger the arrival burst on every change after mount (not on mount
	// itself), incremented in a ref rather than state so this never causes an
	// extra render on its own.
	const orbKeyRef = React.useRef(0);

	React.useLayoutEffect(() => {
		const previousCompleted = previousCompletedRef.current;
		const previousProgress = previousProgressRef.current;
		previousProgressRef.current = progress;

		const stillOpening = Date.now() - mountTimeRef.current < OPEN_SETTLE_GRACE_MS;
		if (previousCompleted === clampedCompleted || stillOpening) {
			// total changed with no completion toggle (e.g. a new item was added),
			// OR this note is still settling in from having just been opened (see
			// OPEN_SETTLE_GRACE_MS above) — either way, just track both directly,
			// no shot ceremony.
			previousCompletedRef.current = clampedCompleted;
			setOrbPosition(progress);
			setFillPosition(progress);
			return;
		}
		previousCompletedRef.current = clampedCompleted;
		orbKeyRef.current += 1;

		const checking = clampedCompleted > previousCompleted;
		setOrbDirection(checking ? 'checking' : 'unchecking');
		// Checking fires from 0 (the start); unchecking fires from 1 (the end)
		// — the opposite edge, mirroring the whole shot.
		const startPosition = checking ? 0 : 1;

		// Snap ONLY the orb to its starting edge, with no transition. The fill
		// is left completely alone here — it hasn't been "reached" yet.
		setOrbLeftTransition('none');
		setOrbPosition(startPosition);

		const frameId = requestAnimationFrame(() => {
			// How far into the fixed travel time the orb reaches the fill's OLD
			// edge, at a constant speed over the whole startPosition→progress
			// distance — that's when the fill should start moving, and it gets
			// whatever time is left to cover the remaining (shorter) distance to
			// `progress`. Same `linear` rate on both so they're moving at
			// identical speed once the fill joins in, instead of visibly having
			// to "sprint" to catch up.
			const totalShotDistance = Math.abs(progress - startPosition);
			const distanceToOldEdge = Math.abs(previousProgress - startPosition);
			const catchUpDelayMs = totalShotDistance > 0 ? (distanceToOldEdge / totalShotDistance) * ORB_TRAVEL_DURATION_MS : 0;
			const fillDurationMs = Math.max(0, ORB_TRAVEL_DURATION_MS - catchUpDelayMs);
			setOrbLeftTransition(`left ${ORB_TRAVEL_DURATION_MS}ms linear`);
			setFillTransition(`transform ${fillDurationMs}ms linear ${catchUpDelayMs}ms`);
			setOrbPosition(progress);
			setFillPosition(progress);
		});
		return () => cancelAnimationFrame(frameId);
	}, [clampedCompleted, progress]);

	if (total <= 0) return null;

	const label = t('editors.checklistProgressLabel')
		.replace('{completed}', String(clampedCompleted))
		.replace('{total}', String(total));

	return (
		<div className={styles.checklistProgressBar}>
			<div className={styles.checklistProgressTrack}>
				<div
					className={styles.checklistProgressFill}
					style={{ transform: `scaleX(${fillPosition})`, transition: fillTransition }}
				/>
				<div
					className={styles.checklistProgressOrbAnchor}
					style={{ left: `${orbPosition * 100}%`, transition: orbLeftTransition }}
				>
					<span
						key={orbKeyRef.current}
						className={[
							styles.checklistProgressOrb,
							isComplete ? styles.checklistProgressOrbComplete : '',
							orbDirection === 'unchecking' ? styles.checklistProgressOrbUnchecking : '',
						].filter(Boolean).join(' ')}
						aria-hidden="true"
					/>
				</div>
			</div>
			<span className={styles.checklistProgressLabel}>{label}</span>
		</div>
	);
}
