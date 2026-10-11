/**
 * The toolbar's "pick a date" affordance, deliberately living OUTSIDE React.
 *
 * On a phone, every RichTextToolbar render site is gated on the soft keyboard being open
 * (`isCoarsePointer && keyboard.isOpen` in TextEditor, `mobileKeyboardOpen` in NoteEditor) —
 * the toolbar is a portal that only exists while the keyboard does. Opening a native date
 * picker closes the keyboard, so the toolbar unmounts *while the picker is on screen*. Three
 * attempts died on that: a hidden input owned by the toolbar lost its listeners before the
 * value was ever committed (so picking a day silently did nothing, twice), and a popover
 * simply vanished before it could be used.
 *
 * Hence this: one `<input type="date">` created once, parented to `document.body`, never
 * unmounted, with the commit handler closing over the editor that asked for it. React can tear
 * the whole toolbar down mid-pick and the date still lands in the note.
 */

import { parseDateInputValue } from './editorDateInsert';

let sharedInput: HTMLInputElement | null = null;
let activeDetach: (() => void) | null = null;

function ensureSharedInput(): HTMLInputElement | null {
	if (typeof document === 'undefined') return null;
	if (sharedInput && sharedInput.isConnected) return sharedInput;
	const input = document.createElement('input');
	input.type = 'date';
	input.tabIndex = -1;
	input.setAttribute('aria-hidden', 'true');
	// Out of the way but still *rendered*: showPicker() refuses to open on an input that isn't
	// being rendered, so display:none / visibility:hidden are both off the table.
	input.style.cssText = [
		'position:fixed',
		'bottom:0',
		'left:0',
		'width:1px',
		'height:1px',
		'padding:0',
		'margin:0',
		'border:0',
		'opacity:0',
		'pointer-events:none',
		'z-index:-1',
	].join(';');
	document.body.appendChild(input);
	// Force a layout pass on the node we just appended. showPicker() refuses to open on an
	// input that isn't "being rendered", and a brand-new child has no box computed yet in this
	// same tick — which would make the very first use of the picker the one that fails.
	void input.offsetHeight;
	sharedInput = input;
	return input;
}

/** Opens the native picker, retrying once on the next frame if the first call is too early. */
function openNativePicker(input: HTMLInputElement, allowRetry: boolean): void {
	try {
		if (typeof input.showPicker === 'function') {
			input.showPicker();
			return;
		}
	} catch {
		// Thrown when the input isn't considered rendered yet, or without transient
		// activation. Transient activation lasts seconds, so one rAF retry still counts as
		// coming from the user's press.
		if (allowRetry && typeof requestAnimationFrame === 'function') {
			requestAnimationFrame(() => openNativePicker(input, false));
			return;
		}
	}
	input.focus();
	input.click();
}

/**
 * Open the browser's date picker and hand the chosen day to `onPicked`. Does nothing if the
 * picker is dismissed without a selection.
 */
export function promptForDateToInsert(onPicked: (value: Date) => void): void {
	const input = ensureSharedInput();
	if (!input) return;

	// A second press before the first commits replaces the pending request rather than
	// stacking another listener on the shared input.
	activeDetach?.();
	activeDetach = null;

	const handleCommit = (): void => {
		const picked = parseDateInputValue(input.value);
		// Read it, then blank it, then act. That ordering makes this self-deduping: browsers
		// disagree about whether a picker commit fires `change`, `input` or both, so we listen
		// for both and whichever lands second reads an empty string and no-ops. Blanking is
		// also what lets the same day be picked twice in a row.
		input.value = '';
		detach();
		if (picked) onPicked(picked);
	};
	const detach = (): void => {
		input.removeEventListener('change', handleCommit);
		input.removeEventListener('input', handleCommit);
		if (activeDetach === detach) activeDetach = null;
	};

	input.addEventListener('change', handleCommit);
	input.addEventListener('input', handleCommit);
	activeDetach = detach;

	// Left empty on purpose. Seeding it with today meant that picking today — the highlighted
	// day the calendar opens on, i.e. the one you'd naturally tap — changed nothing, so no
	// event fired at all. An empty date input already opens on the current month.
	input.value = '';
	// Chrome/Edge 99+, Firefox 101+, Safari 16+; older engines get the click fallback.
	openNativePicker(input, true);
}
