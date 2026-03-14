import React from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faChevronLeft, faChevronRight, faImage, faTrash } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import { useResolvedNoteImageSource } from './useResolvedNoteImageSource';
import styles from './NoteImageViewer.module.css';

type NoteImageViewerProps = {
	src: string;
	fallbackThumbnailBlob?: Blob | null;
	title: string;
	subtitle?: string | null;
	onClose: () => void;
	onDelete?: (() => void) | undefined;
	deleteDisabled?: boolean;
	hasPrevious?: boolean;
	hasNext?: boolean;
	onPrevious?: (() => void) | undefined;
	onNext?: (() => void) | undefined;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;

function distanceBetweenPoints(left: { x: number; y: number }, right: { x: number; y: number }): number {
	const dx = right.x - left.x;
	const dy = right.y - left.y;
	return Math.sqrt(dx * dx + dy * dy);
}

export function NoteImageViewer(props: NoteImageViewerProps): React.JSX.Element {
	const { t } = useI18n();
	const resolvedImage = useResolvedNoteImageSource({
		fullUrl: props.src,
		offlineThumbnailBlob: props.fallbackThumbnailBlob || null,
		mode: 'viewer',
	});
	const [scale, setScale] = React.useState(1);
	const [offset, setOffset] = React.useState({ x: 0, y: 0 });
	const [dragging, setDragging] = React.useState(false);
	const [transitionDirection, setTransitionDirection] = React.useState<'next' | 'previous' | null>(null);
	const [isCoarsePointer, setIsCoarsePointer] = React.useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
	const openedAtRef = React.useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());
	const historyTokenRef = React.useRef(`note-image-viewer:${Math.random().toString(36).slice(2, 10)}`);
	const pendingHistoryCleanupRef = React.useRef<number | null>(null);
	const dragStartRef = React.useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
	const swipeStartRef = React.useRef<{ x: number; y: number } | null>(null);
	const activePointersRef = React.useRef(new Map<number, { x: number; y: number }>());
	const pinchStateRef = React.useRef<{ distance: number; scale: number } | null>(null);
	const onCloseRef = React.useRef(props.onClose);
	const onPreviousRef = React.useRef(props.onPrevious);
	const onNextRef = React.useRef(props.onNext);

	useBodyScrollLock(true);

	React.useEffect(() => {
		onCloseRef.current = props.onClose;
		onPreviousRef.current = props.onPrevious;
		onNextRef.current = props.onNext;
	}, [props.onClose, props.onNext, props.onPrevious]);

	const clampScale = React.useCallback((next: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)), []);

	const updateScale = React.useCallback((next: number) => {
		setScale((current) => {
			const resolved = clampScale(typeof next === 'number' ? next : current);
			if (resolved === MIN_SCALE) {
				setOffset({ x: 0, y: 0 });
			}
			return resolved;
		});
	}, [clampScale]);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const media = window.matchMedia('(pointer: coarse)');
		const update = (): void => setIsCoarsePointer(media.matches);
		update();
		media.addEventListener?.('change', update);
		return () => media.removeEventListener?.('change', update);
	}, []);

	React.useEffect(() => {
		setScale(1);
		setOffset({ x: 0, y: 0 });
	}, [props.src]);

	React.useEffect(() => {
		if (!isCoarsePointer || typeof window === 'undefined') return;
		if (pendingHistoryCleanupRef.current != null) {
			window.clearTimeout(pendingHistoryCleanupRef.current);
			pendingHistoryCleanupRef.current = null;
		}
		let active = true;
		let didPush = false;
		const token = historyTokenRef.current;
		const onPopState = (): void => {
			if (!active) return;
			onCloseRef.current();
		};
		window.addEventListener('popstate', onPopState);
		const currentState = window.history.state as { __noteImageViewer?: string } | null;
		// Push a viewer-specific history token so mobile Back dismisses the image
		// overlay first without forcing the parent media sheet or editor to close.
		if (currentState?.__noteImageViewer !== token) {
			window.history.pushState({ __noteImageViewer: token }, '');
			didPush = true;
		}
		return () => {
			active = false;
			window.removeEventListener('popstate', onPopState);
			if (!didPush) return;
			pendingHistoryCleanupRef.current = window.setTimeout(() => {
				pendingHistoryCleanupRef.current = null;
				const state = window.history.state as { __noteImageViewer?: string } | null;
				if (state?.__noteImageViewer === token) {
					window.history.back();
				}
			}, 0);
		};
		}, [isCoarsePointer]);

	React.useEffect(() => () => {
		if (typeof window === 'undefined') return;
		if (pendingHistoryCleanupRef.current != null) {
			window.clearTimeout(pendingHistoryCleanupRef.current);
			pendingHistoryCleanupRef.current = null;
		}
	}, []);

	const requestClose = React.useCallback(() => {
		if (isCoarsePointer && typeof window !== 'undefined' && window.history.state && (window.history.state as { __noteImageViewer?: string }).__noteImageViewer === historyTokenRef.current) {
			window.history.back();
			return;
		}
		onCloseRef.current();
	}, [isCoarsePointer]);

	const syncPinchState = React.useCallback((): void => {
		const pointers = Array.from(activePointersRef.current.values());
		if (pointers.length < 2) {
			pinchStateRef.current = null;
			return;
		}
		const nextDistance = distanceBetweenPoints(pointers[0], pointers[1]);
		if (!pinchStateRef.current) {
			pinchStateRef.current = { distance: nextDistance, scale };
			return;
		}
		if (nextDistance <= 0) return;
		const nextScale = pinchStateRef.current.scale * (nextDistance / pinchStateRef.current.distance);
		updateScale(nextScale);
	}, [scale, updateScale]);

	const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
		swipeStartRef.current = { x: event.clientX, y: event.clientY };
		if (event.pointerType === 'touch') {
			event.currentTarget.setPointerCapture(event.pointerId);
			syncPinchState();
		}
		if (activePointersRef.current.size > 1) {
			dragStartRef.current = null;
			setDragging(false);
			return;
		}
		if (scale <= 1) return;
		dragStartRef.current = {
			x: event.clientX,
			y: event.clientY,
			originX: offset.x,
			originY: offset.y,
		};
		setDragging(true);
		event.currentTarget.setPointerCapture(event.pointerId);
	}, [offset.x, offset.y, scale, syncPinchState]);

	const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		if (activePointersRef.current.has(event.pointerId)) {
			activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
		}
		if (activePointersRef.current.size > 1) {
			syncPinchState();
			return;
		}
		if (!dragStartRef.current || scale <= 1) return;
		const nextX = dragStartRef.current.originX + (event.clientX - dragStartRef.current.x);
		const nextY = dragStartRef.current.originY + (event.clientY - dragStartRef.current.y);
		setOffset({ x: nextX, y: nextY });
	}, [scale, syncPinchState]);

	const handlePrevious = React.useCallback(() => {
		setTransitionDirection('previous');
		onPreviousRef.current?.();
	}, []);
	const handleNext = React.useCallback(() => {
		setTransitionDirection('next');
		onNextRef.current?.();
	}, []);

	React.useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') requestClose();
			if (event.key === 'ArrowLeft') {
				handlePrevious();
			}
			if (event.key === 'ArrowRight') {
				handleNext();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [handleNext, handlePrevious, requestClose]);

	const endDrag = React.useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
		const start = swipeStartRef.current;
		const endPoint = event ? { x: event.clientX, y: event.clientY } : null;
		if (event) {
			activePointersRef.current.delete(event.pointerId);
			if (event.currentTarget.hasPointerCapture && event.currentTarget.releasePointerCapture) {
				try {
					event.currentTarget.releasePointerCapture(event.pointerId);
				} catch {
					// Ignore browsers that reject release for uncaptured pointers.
				}
			}
		}
		if (activePointersRef.current.size < 2) {
			pinchStateRef.current = null;
		}
		if (event && start && endPoint && scale <= 1 && activePointersRef.current.size === 0) {
			const dx = endPoint.x - start.x;
			const dy = endPoint.y - start.y;
			// Only treat the gesture as navigation/close when the image is zoomed out;
			// once zoomed in, pointer travel should remain dedicated to panning.
			if (Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy) * 1.2) {
				if (dx < 0) handleNext();
				if (dx > 0) handlePrevious();
			}
			if (dy > 96 && Math.abs(dy) > Math.abs(dx) * 1.2) {
				requestClose();
			}
		}
		swipeStartRef.current = null;
		dragStartRef.current = null;
		setDragging(false);
	}, [handleNext, handlePrevious, requestClose, scale]);

	const handleWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
		const direction = event.deltaY < 0 ? 0.12 : -0.12;
		updateScale(scale + direction);
	}, [scale, updateScale]);
	const handleBackdropClick = React.useCallback(() => {
		const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
		if (now - openedAtRef.current < 140) return;
		requestClose();
	}, [requestClose]);

	const content = (
		<div className={styles.backdrop} role="presentation" onClick={handleBackdropClick}>
			<section className={styles.viewer} role="dialog" aria-modal="true" aria-label={props.title} onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<div className={styles.headerGroup}>
						<button type="button" className={styles.button} onClick={requestClose}>
							<FontAwesomeIcon icon={faArrowLeft} />
							<span>{t('common.back')}</span>
						</button>
						<div className={styles.titleWrap}>
							<h2 className={styles.title}>{props.title}</h2>
							{props.subtitle || resolvedImage.isOfflinePreview ? <p className={styles.subtitle}>{[props.subtitle, resolvedImage.isOfflinePreview ? t('media.offlinePreviewHint') : ''].filter(Boolean).join(' · ')}</p> : null}
						</div>
					</div>
					<div className={styles.toolbar}>
						{props.onDelete ? (
							<button type="button" className={styles.dangerButton} onClick={props.onDelete} disabled={props.deleteDisabled}>
								<FontAwesomeIcon icon={faTrash} />
								<span>{t('editors.delete')}</span>
							</button>
						) : null}
					</div>
				</header>

				<div
					className={`${styles.stage}${dragging ? ` ${styles.stageDragging}` : ''}`}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={(event) => endDrag(event)}
					onPointerCancel={(event) => endDrag(event)}
					onWheel={handleWheel}
				>
					<div
						key={`${props.src}:${transitionDirection || 'idle'}`}
						className={`${styles.imageFrame}${transitionDirection === 'next' ? ` ${styles.imageFrameSwapNext}` : transitionDirection === 'previous' ? ` ${styles.imageFrameSwapPrevious}` : ''}`}
						onAnimationEnd={() => setTransitionDirection(null)}
					>
						{resolvedImage.src ? (
							<img
								src={resolvedImage.src}
								alt={props.title}
								className={styles.image}
								draggable={false}
								onError={resolvedImage.fallbackToOfflinePreview}
								style={{
									transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
								}}
							/>
						) : (
							<div className={styles.placeholder}>
								<FontAwesomeIcon icon={faImage} />
								<span>{t('media.imageUnavailableOffline')}</span>
							</div>
						)}
					</div>
					{props.hasPrevious ? (
						<button type="button" className={`${styles.navButton} ${styles.navButtonPrev}`} onClick={handlePrevious} aria-label={t('common.previous')}>
							<FontAwesomeIcon icon={faChevronLeft} />
						</button>
					) : null}
					{props.hasNext ? (
						<button type="button" className={`${styles.navButton} ${styles.navButtonNext}`} onClick={handleNext} aria-label={t('common.next')}>
							<FontAwesomeIcon icon={faChevronRight} />
						</button>
					) : null}
				</div>
			</section>
		</div>
	);

	return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}