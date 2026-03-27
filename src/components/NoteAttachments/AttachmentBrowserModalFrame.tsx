import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import styles from '../NoteMedia/NoteMediaBrowserModal.module.css';

type AttachmentBrowserModalFrameProps = {
	isOpen: boolean;
	noteTitle?: string | null;
	subtitle: string;
	onClose: () => void;
	children: React.ReactNode;
	closeLabel: string;
};

export function AttachmentBrowserModalFrame(props: AttachmentBrowserModalFrameProps): React.JSX.Element | null {
	useBodyScrollLock(props.isOpen);
	const isCoarsePointer = useIsCoarsePointer();
	const backdropPressStartedRef = React.useRef(false);
	const handleTouchStartRef = React.useRef<{ x: number; y: number; id: number } | null>(null);

	const clearHandleGesture = React.useCallback((): void => {
		handleTouchStartRef.current = null;
	}, []);

	const handleBackdropPressStart = React.useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
		backdropPressStartedRef.current = event.target === event.currentTarget;
	}, []);

	const handleBackdropClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
		const shouldClose = backdropPressStartedRef.current && event.target === event.currentTarget;
		backdropPressStartedRef.current = false;
		if (shouldClose) props.onClose();
	}, [props]);

	const handleSheetHandleTouchStart = React.useCallback((event: React.TouchEvent<HTMLButtonElement>): void => {
		if (!isCoarsePointer) return;
		const touch = event.touches[0];
		if (!touch) return;
		event.stopPropagation();
		handleTouchStartRef.current = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
	}, [isCoarsePointer]);

	const handleSheetHandleTouchMove = React.useCallback((event: React.TouchEvent<HTMLButtonElement>): void => {
		if (!handleTouchStartRef.current) return;
		event.stopPropagation();
		if (event.cancelable) event.preventDefault();
	}, []);

	const handleSheetHandleTouchEnd = React.useCallback((event: React.TouchEvent<HTMLButtonElement>): void => {
		const start = handleTouchStartRef.current;
		const touch = Array.from(event.changedTouches).find((item) => item.identifier === start?.id) || null;
		clearHandleGesture();
		if (!start || !touch) return;
		event.stopPropagation();
		if (event.cancelable) event.preventDefault();
		const dx = touch.clientX - start.x;
		const dy = touch.clientY - start.y;
		if (Math.abs(dy) < 28 || Math.abs(dy) < Math.abs(dx)) return;
		if (dy > 0) props.onClose();
	}, [clearHandleGesture, props]);

	if (!props.isOpen) return null;

	// Reuse the image-browser shell so attachments feel like one feature family instead
	// of three separate modal systems that drift apart over time.
	return (
		<div
			className={styles.backdrop}
			role="presentation"
			onPointerDownCapture={handleBackdropPressStart}
			onClick={handleBackdropClick}
		>
			<section
				className={styles.dialog}
				role="dialog"
				aria-modal="true"
				aria-label={props.noteTitle || props.subtitle}
				onPointerDown={(event) => event.stopPropagation()}
				onClick={(event) => event.stopPropagation()}
			>
				{isCoarsePointer ? (
					<button
						type="button"
						className={styles.sheetHandle}
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
						}}
						onTouchStart={handleSheetHandleTouchStart}
						onTouchMove={handleSheetHandleTouchMove}
						onTouchEnd={handleSheetHandleTouchEnd}
						onTouchCancel={clearHandleGesture}
						aria-label={props.closeLabel}
					>
						<span className={styles.sheetHandlePill} aria-hidden="true" />
					</button>
				) : null}
				<header className={styles.header}>
					<div className={styles.headerCopy}>
						<h2 className={styles.title}>{props.noteTitle || props.subtitle}</h2>
						<p className={styles.subtitle}>{props.subtitle}</p>
					</div>
					<button type="button" className={styles.closeButton} onClick={props.onClose} aria-label={props.closeLabel}>
						<FontAwesomeIcon icon={faXmark} />
					</button>
				</header>
				<div className={styles.body}>{props.children}</div>
			</section>
		</div>
	);
}