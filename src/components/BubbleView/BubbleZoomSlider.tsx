import React from 'react';
import styles from './BubbleZoomSlider.module.css';

export type BubbleZoomSliderProps = {
	min: number;
	max: number;
	value: number;
	onChange: (value: number) => void;
	ariaLabel: string;
};

/**
 * Custom drag-to-zoom slider for BubbleView.
 *
 * This deliberately does NOT use a native <input type="range">. The previous
 * version did, plus touch-action:none (needed so the page doesn't steal the
 * drag as a scroll) plus a manual pointer-capture + clientX handler bolted on
 * top (needed because touch-action:none also breaks the range input's own
 * built-in touch dragging). That combination never worked on iOS: Safari's
 * native range-input implementation doesn't reliably hand pointer events back
 * to JS once touch-action:none has taken away its default touch handling, so
 * setPointerCapture on the input silently did nothing and the slider went
 * dead — dragging it did nothing at all.
 *
 * A plain div doesn't carry any of that native-control baggage. Pointer
 * capture on a div is the same well-worn pattern every custom slider/drag
 * library uses, and it behaves identically on iOS, Android, and desktop mouse
 * — which is the whole point of building it this way instead of continuing to
 * patch the native input.
 */
export function BubbleZoomSlider({ min, max, value, onChange, ariaLabel }: BubbleZoomSliderProps): React.JSX.Element {
	const trackRef = React.useRef<HTMLDivElement | null>(null);
	const draggingRef = React.useRef(false);

	const valueFromClientX = React.useCallback((clientX: number): number => {
		const track = trackRef.current;
		if (!track) return value;
		const rect = track.getBoundingClientRect();
		const relX = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
		return Math.round(min + relX * (max - min));
	}, [max, min, value]);

	const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		draggingRef.current = true;
		try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* ignore */ }
		onChange(valueFromClientX(event.clientX));
	}, [onChange, valueFromClientX]);

	const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		if (!draggingRef.current) return;
		onChange(valueFromClientX(event.clientX));
	}, [onChange, valueFromClientX]);

	const endDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		draggingRef.current = false;
		try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
	}, []);

	const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
		const step = event.shiftKey ? 10 : 1;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
			event.preventDefault();
			onChange(Math.max(min, value - step));
		} else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
			event.preventDefault();
			onChange(Math.min(max, value + step));
		} else if (event.key === 'Home') {
			event.preventDefault();
			onChange(min);
		} else if (event.key === 'End') {
			event.preventDefault();
			onChange(max);
		}
	}, [max, min, onChange, value]);

	const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;

	return (
		<div
			ref={trackRef}
			className={styles.track}
			role="slider"
			tabIndex={0}
			aria-label={ariaLabel}
			aria-orientation="horizontal"
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={value}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onLostPointerCapture={() => { draggingRef.current = false; }}
			onKeyDown={handleKeyDown}
		>
			<div className={styles.fill} style={{ width: `${percent}%` }} />
			<div className={styles.thumb} style={{ left: `${percent}%` }} />
		</div>
	);
}
