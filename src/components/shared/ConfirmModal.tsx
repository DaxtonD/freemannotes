import React from 'react';

import { useBodyScrollLock } from '../../core/useBodyScrollLock';

import styles from './ConfirmModal.module.css';

/**
 * A yes/no gate for something that cannot simply be undone.
 *
 * ## Why this exists rather than the two-step button
 *
 * The codebase's existing confirm is an inline one - a button whose label changes to "Confirm
 * delete" on first press. That is right for a reversible action in a crowded menu, and wrong here:
 * it has nowhere to say *why* it is asking, and the cases that need this one are exactly the cases
 * where the consequence is not the one the user expects.
 *
 * The first user of it is trashing a shared note. "Move to trash" reads as reversible - that is
 * what trash means - but for the people it is shared with, access ends immediately and getting
 * them back means re-inviting. A label change cannot carry that.
 *
 * ## Deliberately small
 *
 * No scrolling body, no form, no nested overlays. A confirm that grows a scroll container acquires
 * every trap in CLAUDE.md's scroll-lock section; keeping it to a sentence or two means the
 * `overscroll-behavior` rules in the stylesheet are belt-and-braces rather than load-bearing.
 *
 * ## Mobile back button
 *
 * Pushes `__confirmModal`, which `isMobileDismissLayerHistoryState` in App.tsx recognises, so the
 * Android back button dismisses the dialog instead of counting towards leaving the app. A new
 * dismiss layer that is not registered there silently breaks the exit-back count.
 *
 * It is rendered from App's top level rather than from inside a menu, so it is never a child
 * overlay - no orphaned `__moreMenu` entry to consume, and none of the `closeForChildOverlay`
 * complications that come with nesting.
 */
export type ConfirmModalProps = {
	open: boolean;
	title: string;
	/** One or two short paragraphs. Say what will happen, not what is being clicked. */
	body: readonly string[];
	confirmLabel: string;
	cancelLabel: string;
	/** Styles the confirm button as destructive. Default true - nothing benign needs this dialog. */
	destructive?: boolean;
	/** Set while the action is running, so a slow network cannot produce a double submit. */
	busy?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
};

export function ConfirmModal(props: ConfirmModalProps): React.JSX.Element | null {
	const { open, busy = false, onCancel, onConfirm } = props;
	useBodyScrollLock(open);

	const confirmRef = React.useRef<HTMLButtonElement | null>(null);

	// Escape cancels. A destructive dialog must never treat an ambiguous dismissal as consent, so
	// every exit route below leads to onCancel.
	React.useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			onCancel();
		};
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [open, onCancel]);

	// Focus the confirm button so the dialog is reachable by keyboard immediately. It is also the
	// button a screen reader should land on, because the title alone does not say what the choice
	// is.
	React.useEffect(() => {
		if (!open) return;
		const id = window.setTimeout(() => confirmRef.current?.focus(), 0);
		return () => window.clearTimeout(id);
	}, [open]);

	// Android back dismisses rather than leaving the app. See the note above.
	React.useEffect(() => {
		if (!open) return;
		if (typeof window === 'undefined') return;
		if (!window.matchMedia?.('(pointer: coarse)').matches) return;
		window.history.pushState({ __confirmModal: true }, '');
		return () => {
			if (window.history.state && (window.history.state as Record<string, unknown>).__confirmModal === true) {
				window.history.back();
			}
		};
	}, [open]);

	if (!open) return null;

	return (
		<div
			className={styles.backdrop}
			role="presentation"
			onClick={(event) => {
				// Only a click on the backdrop itself, not one that bubbled out of the dialog.
				if (event.target !== event.currentTarget) return;
				if (busy) return;
				onCancel();
			}}
		>
			<div className={styles.dialog} role="alertdialog" aria-modal="true" aria-label={props.title}>
				<h2 className={styles.title}>{props.title}</h2>
				<div className={styles.body}>
					{props.body.map((paragraph) => (
						<p key={paragraph} className={styles.paragraph}>{paragraph}</p>
					))}
				</div>
				<div className={styles.actions}>
					<button type="button" className={styles.cancel} onClick={onCancel} disabled={busy}>
						{props.cancelLabel}
					</button>
					<button
						ref={confirmRef}
						type="button"
						className={`${styles.confirm}${props.destructive === false ? '' : ` ${styles.destructive}`}`}
						onClick={onConfirm}
						disabled={busy}
					>
						{props.confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
