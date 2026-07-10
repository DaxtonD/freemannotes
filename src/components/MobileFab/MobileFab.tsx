import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBell, faFileLines, faListCheck, faPenNib } from '@fortawesome/free-solid-svg-icons';

const POSITION_KEY_PREFIX = 'freemannotes.fabPosition.v1';

// SVG ring: 72×72 centered over a 56×56 FAB, circles at r=30
// Circumference: 2π × 30 ≈ 188.5
const RING_CIRC = 188.5;

interface FabPosition {
	// Fractions of (viewport dimension − 56px) so the saved position scales
	// naturally across orientation changes and different screen sizes.
	leftPct: number;
	topPct: number;
}

function loadFabPosition(userId: string | null, deviceId: string): FabPosition | null {
	if (!userId || typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(`${POSITION_KEY_PREFIX}:${userId}::${deviceId}`);
		if (!raw) return null;
		const p = JSON.parse(raw) as unknown;
		if (
			p !== null &&
			typeof p === 'object' &&
			'leftPct' in p &&
			'topPct' in p &&
			typeof (p as Record<string, unknown>).leftPct === 'number' &&
			typeof (p as Record<string, unknown>).topPct === 'number'
		) {
			return p as FabPosition;
		}
	} catch { /* ignore bad data */ }
	return null;
}

function saveFabPosition(userId: string | null, deviceId: string, pos: FabPosition): void {
	if (!userId || typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(`${POSITION_KEY_PREFIX}:${userId}::${deviceId}`, JSON.stringify(pos));
	} catch { /* best effort */ }
}

function isCoarsePointerDevice(): boolean {
	return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function buildDirectionClasses(leftPct: number, topPct: number): string {
	const classes: string[] = [];
	if (topPct < 0.5) classes.push('opens-down');
	if (leftPct < 0.5) classes.push('aligns-left');
	return classes.join(' ');
}

export interface MobileFabProps {
	isOpen: boolean;
	onToggle: () => void;
	onCreateReminder: () => void;
	onCreateText: () => void;
	onCreateChecklist: () => void;
	onCreateDrawing: () => void;
	fabIconSrc: string;
	userId: string | null;
	deviceId: string;
	t: (key: string) => string;
}

export function MobileFab({
	isOpen,
	onToggle,
	onCreateReminder,
	onCreateText,
	onCreateChecklist,
	onCreateDrawing,
	fabIconSrc,
	userId,
	deviceId,
	t,
}: MobileFabProps): React.ReactElement {
	const [savedPosition, setSavedPosition] = React.useState<FabPosition | null>(() =>
		loadFabPosition(userId, deviceId)
	);
	const [isDragging, setIsDragging] = React.useState(false);
	// 'charging': ring drawing (500ms long-press)
	// 'firing':   ring exploding (200ms after threshold reached)
	// 'idle':     no indicator
	const [longPressPhase, setLongPressPhase] = React.useState<'idle' | 'charging' | 'firing'>('idle');
	const [directionClasses, setDirectionClasses] = React.useState<string>(() => {
		const pos = loadFabPosition(userId, deviceId);
		return pos ? buildDirectionClasses(pos.leftPct, pos.topPct) : '';
	});

	const anchorRef = React.useRef<HTMLDivElement | null>(null);
	const fabButtonRef = React.useRef<HTMLButtonElement | null>(null);
	const longPressTimerRef = React.useRef<number | null>(null);
	// Timer to clear the 'firing' phase after its exit animation finishes
	const fireRingTimerRef = React.useRef<number | null>(null);
	const pointerOriginRef = React.useRef<{ x: number; y: number; pointerId: number } | null>(null);
	const dragActiveRef = React.useRef(false);
	// Set true after a drag ends; cleared at the start of the NEXT pointerdown so
	// the subsequent synthetic click is suppressed (mobile browsers fire click after
	// pointerup even after a long drag, but only if the pointer barely moved — if it
	// moved a lot the browser skips click, leaving this flag stale).
	const wasJustDraggingRef = React.useRef(false);

	const applyAnchorPosition = React.useCallback((leftPct: number, topPct: number): void => {
		const el = anchorRef.current;
		if (!el) return;
		el.style.left = `${Math.round(leftPct * Math.max(1, window.innerWidth - 56))}px`;
		el.style.top = `${Math.round(topPct * Math.max(1, window.innerHeight - 56))}px`;
	}, []);

	// Sync anchor inline style whenever the persisted position changes
	React.useEffect(() => {
		const el = anchorRef.current;
		if (!el) return;
		if (savedPosition) {
			applyAnchorPosition(savedPosition.leftPct, savedPosition.topPct);
		} else {
			el.style.left = '';
			el.style.top = '';
		}
	}, [savedPosition, applyAnchorPosition]);

	// Block global touchmove while long-pressing or dragging so the sidebar
	// swipe gesture cannot activate when the FAB is near the left screen edge.
	React.useEffect(() => {
		if (longPressPhase === 'idle' && !isDragging) return;
		const prevent = (e: TouchEvent): void => { e.preventDefault(); };
		document.addEventListener('touchmove', prevent, { passive: false, capture: true });
		return () => { document.removeEventListener('touchmove', prevent, { capture: true }); };
	}, [longPressPhase, isDragging]);

	const handlePointerDown = React.useCallback(
		(event: React.PointerEvent<HTMLButtonElement>): void => {
			// Clear any stale drag-suppression flag from the previous drag.
			// Bug: after dragging significantly, mobile browsers don't fire a click
			// event after pointerup, so wasJustDraggingRef never gets self-cleared.
			// Resetting it here ensures the next tap is always treated as a tap.
			wasJustDraggingRef.current = false;

			// Drag is a touch-only interaction — mouse long-press would feel wrong
			if (event.pointerType !== 'touch') return;
			// Don't let dragging start while the action stack is open
			if (isOpen) return;

			pointerOriginRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
			setLongPressPhase('charging');

			longPressTimerRef.current = window.setTimeout(() => {
				longPressTimerRef.current = null;
				dragActiveRef.current = true;
				setIsDragging(true);
				setLongPressPhase('firing');
				try { navigator.vibrate?.(22); } catch { /* ignore */ }

				if (fabButtonRef.current && pointerOriginRef.current) {
					try {
						fabButtonRef.current.setPointerCapture(pointerOriginRef.current.pointerId);
					} catch { /* ignore if pointer already released */ }
				}

				// Clear firing indicator after the CSS exit animation completes
				fireRingTimerRef.current = window.setTimeout(() => {
					setLongPressPhase('idle');
					fireRingTimerRef.current = null;
				}, 220);
			}, 500);
		},
		[isOpen]
	);

	const handlePointerMove = React.useCallback(
		(event: React.PointerEvent<HTMLButtonElement>): void => {
			if (!pointerOriginRef.current) return;

			const dx = event.clientX - pointerOriginRef.current.x;
			const dy = event.clientY - pointerOriginRef.current.y;

			if (!dragActiveRef.current) {
				// Cancel the long-press if the finger moved more than ~8px
				if (Math.hypot(dx, dy) > 8 && longPressTimerRef.current !== null) {
					clearTimeout(longPressTimerRef.current);
					longPressTimerRef.current = null;
					pointerOriginRef.current = null;
					setLongPressPhase('idle');
				}
				return;
			}

			// Update anchor position directly — no React re-render per frame
			const el = anchorRef.current;
			if (!el) return;
			const left = clamp(event.clientX - 28, 0, window.innerWidth - 56);
			const top = clamp(event.clientY - 28, 0, window.innerHeight - 56);
			el.style.left = `${left}px`;
			el.style.top = `${top}px`;

			const leftPct = left / Math.max(1, window.innerWidth - 56);
			const topPct = top / Math.max(1, window.innerHeight - 56);
			setDirectionClasses(buildDirectionClasses(leftPct, topPct));
		},
		[]
	);

	const handlePointerUp = React.useCallback(
		(_event: React.PointerEvent<HTMLButtonElement>): void => {
			if (longPressTimerRef.current !== null) {
				clearTimeout(longPressTimerRef.current);
				longPressTimerRef.current = null;
			}

			const wasDragging = dragActiveRef.current;
			dragActiveRef.current = false;
			pointerOriginRef.current = null;

			if (!wasDragging) {
				// Short tap — cancel any charging indicator
				setLongPressPhase('idle');
				return;
			}

			// Suppress the synthetic click that fires immediately after this pointerup
			wasJustDraggingRef.current = true;

			const el = anchorRef.current;
			if (el) {
				const left = parseFloat(el.style.left) || 0;
				const top = parseFloat(el.style.top) || 0;
				const newPos: FabPosition = {
					leftPct: clamp(left / Math.max(1, window.innerWidth - 56), 0, 1),
					topPct: clamp(top / Math.max(1, window.innerHeight - 56), 0, 1),
				};
				setSavedPosition(newPos);
				saveFabPosition(userId, deviceId, newPos);
				setDirectionClasses(buildDirectionClasses(newPos.leftPct, newPos.topPct));
			}

			setIsDragging(false);

			// Fire-ring timer may already have cleared the phase; ensure cleanup
			if (fireRingTimerRef.current !== null) {
				clearTimeout(fireRingTimerRef.current);
				fireRingTimerRef.current = null;
			}
			setLongPressPhase('idle');
		},
		[userId, deviceId]
	);

	const handlePointerCancel = React.useCallback((): void => {
		if (longPressTimerRef.current !== null) {
			clearTimeout(longPressTimerRef.current);
			longPressTimerRef.current = null;
		}
		if (fireRingTimerRef.current !== null) {
			clearTimeout(fireRingTimerRef.current);
			fireRingTimerRef.current = null;
		}
		dragActiveRef.current = false;
		pointerOriginRef.current = null;
		setLongPressPhase('idle');

		// Restore last saved position; if none, revert to CSS default
		const el = anchorRef.current;
		if (el) {
			if (savedPosition) {
				applyAnchorPosition(savedPosition.leftPct, savedPosition.topPct);
			} else {
				el.style.left = '';
				el.style.top = '';
			}
		}

		setIsDragging(false);
	}, [savedPosition, applyAnchorPosition]);

	const anchorClass = [
		'mobile-fab-anchor',
		savedPosition ? 'has-custom-position' : '',
		isDragging ? 'is-dragging' : '',
		longPressPhase === 'charging' ? 'is-charging' : '',
		// is-firing must appear after is-dragging in the class string so that
		// when both are active simultaneously, CSS source-order gives is-firing
		// precedence on FAB transform during the ring's exit flash.
		longPressPhase === 'firing' ? 'is-firing' : '',
		directionClasses,
	].filter(Boolean).join(' ');

	return (
		<>
			{isOpen ? (
				<button
					type="button"
					className="mobile-fab-backdrop"
					onPointerUp={(event) => {
						if (event.pointerType !== 'touch' && !isCoarsePointerDevice()) return;
						if (event.cancelable) event.preventDefault();
						event.stopPropagation();
						onToggle();
					}}
					onClick={(event) => {
						if (event.defaultPrevented) return;
						onToggle();
					}}
					aria-label={t('app.closeQuickCreate')}
				/>
			) : null}
			<div ref={anchorRef} className={anchorClass}>
				{/* Long-press ring indicator — drawn behind the stack and button */}
				<svg
					className="fab-press-ring"
					viewBox="0 0 72 72"
					aria-hidden="true"
				>
					{/* Wide glow layer draws slightly slower for a trailing-comet look */}
					<circle
						className="fab-press-glow"
						cx="36"
						cy="36"
						r="30"
						strokeDasharray={`${RING_CIRC} ${RING_CIRC}`}
						strokeDashoffset={RING_CIRC}
					/>
					{/* Sharp ring draws at the long-press threshold (500ms) */}
					<circle
						className="fab-press-circle"
						cx="36"
						cy="36"
						r="30"
						strokeDasharray={`${RING_CIRC} ${RING_CIRC}`}
						strokeDashoffset={RING_CIRC}
					/>
				</svg>
				<div className={`mobile-fab-stack mobile-fab-stack-anchored${isOpen ? ' is-open' : ''}`}>
					<button type="button" className="mobile-fab-action" onClick={onCreateReminder}>
						<FontAwesomeIcon icon={faBell} />
						{t('app.createQuickReminder')}
					</button>
					<button type="button" className="mobile-fab-action" onClick={onCreateText}>
						<FontAwesomeIcon icon={faFileLines} />
						{t('app.createNote')}
					</button>
					<button type="button" className="mobile-fab-action" onClick={onCreateChecklist}>
						<FontAwesomeIcon icon={faListCheck} />
						{t('app.createChecklist')}
					</button>
					<button type="button" className="mobile-fab-action" onClick={onCreateDrawing}>
						<FontAwesomeIcon icon={faPenNib} />
						{t('app.createDrawing')}
					</button>
				</div>
				<button
					ref={fabButtonRef}
					type="button"
					className={`mobile-fab mobile-fab-anchored${isOpen ? ' is-open' : ''}`}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
					onPointerCancel={handlePointerCancel}
					onContextMenu={(e) => { if (dragActiveRef.current) e.preventDefault(); }}
					onClick={(event) => {
						if (wasJustDraggingRef.current) {
							wasJustDraggingRef.current = false;
							event.preventDefault();
							return;
						}
						onToggle();
					}}
					aria-label={isOpen ? t('app.closeQuickCreate') : t('app.openQuickCreate')}
					title={isOpen ? t('app.closeQuickCreate') : t('app.openQuickCreate')}
				>
					<img aria-hidden="true" className="mobile-fab-icon" src={fabIconSrc} alt="" />
				</button>
			</div>
		</>
	);
}
