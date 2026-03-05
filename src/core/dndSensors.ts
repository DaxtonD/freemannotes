import React from 'react';
import type { Position } from 'css-box-model';
import {
	useKeyboardSensor,
	type FluidDragActions,
	type PreDragActions,
	type Sensor,
	type SensorAPI,
} from '@hello-pangea/dnd';
import { fireHorizontalSnap } from './checklistDragState';

// ── State machine ─────────────────────────────────────────────────────────
// idle     → pointer down → pending (PreDragActions held, NO visual drag)
// pending  → move < threshold → stay pending (item stays perfectly still)
// pending  → move horizontal → fire snap callback + abort → idle
// pending  → move vertical → fluidLift → dragging (library drag begins)
// pending  → pointer up → abort → idle (was just a click)
// dragging → move → locked-vertical move
// dragging → pointer up → drop → idle

type IdleState = { type: 'idle' };
type PendingState = {
	type: 'pending';
	actions: PreDragActions;
	draggableId: string;
	startPoint: Position;
	pointerId: number;
	pointerType: string;
	captureTarget: Element | null;
};
type DraggingState = {
	type: 'dragging';
	actions: FluidDragActions;
	startPoint: Position;
	pointerId: number;
	pointerType: string;
	captureTarget: Element | null;
};

type SensorState = IdleState | PendingState | DraggingState;

const idleState: IdleState = { type: 'idle' };
// Gesture classification thresholds:
// While we're in `pending` we haven't started a library drag yet — we're watching
// early movement to decide whether the user intends:
// - vertical reorder (start a normal @hello-pangea/dnd drag), OR
// - horizontal indent/unindent (fire our snap callback and abort the library drag).
//
// Small jitter is ignored so click/tap doesn't accidentally become a drag.
const axisThresholdPx = 6;

// On touch devices fingers are wide and initial movement is noisier.
// We require a stronger horizontal signal (dx must beat dy by this factor)
// before we treat the gesture as indent/unindent. This prevents accidental
// un-indents when the intent was a vertical reorder.
const touchHorizontalBias = 1.8;

function shouldDebugLog(): boolean {
	return typeof window !== 'undefined' && Boolean((window as any).DEBUG);
}

function makeMouseDownEventFromPointer(event: PointerEvent): MouseEvent {
	// Some internals in @hello-pangea/dnd treat only mousedown/touchstart as valid
	// sensor start events. PointerEvent often won’t pass those checks even though
	// it contains the needed coordinates.
	return new MouseEvent('mousedown', {
		bubbles: true,
		cancelable: true,
		clientX: event.clientX,
		clientY: event.clientY,
		button: 0,
		buttons: 1,
		ctrlKey: event.ctrlKey,
		shiftKey: event.shiftKey,
		altKey: event.altKey,
		metaKey: event.metaKey,
	});
}

function makeMouseDownEventFromTouch(touch: Touch): MouseEvent {
	return new MouseEvent('mousedown', {
		bubbles: true,
		cancelable: true,
		clientX: touch.clientX,
		clientY: touch.clientY,
		button: 0,
		buttons: 1,
	});
}

function findTouchInList(list: TouchList, touchId: number | null): Touch | null {
	if (list.length === 0) return null;
	if (touchId === null) return list[0] ?? null;
	for (let i = 0; i < list.length; i++) {
		const t = list[i];
		if (t && t.identifier === touchId) return t;
	}
	return list[0] ?? null;
}

function getTouchById(event: TouchEvent, touchId: number | null): Touch | null {
	// Prefer changedTouches first: on some browsers it's more reliable for
	// tracking the active finger during move/end transitions.
	return findTouchInList(event.changedTouches, touchId) ?? findTouchInList(event.touches, touchId);
}

type TouchIdleState = { type: 'idle' };
type TouchPendingState = {
	type: 'pending';
	actions: PreDragActions;
	draggableId: string;
	startPoint: Position;
	touchId: number | null;
};
type TouchDraggingState = {
	type: 'dragging';
	actions: FluidDragActions;
	startPoint: Position;
	touchId: number | null;
};
type TouchSensorState = TouchIdleState | TouchPendingState | TouchDraggingState;

const touchIdleState: TouchIdleState = { type: 'idle' };

function findDragHandleElement(target: Element | null): Element | null {
	if (!target) return null;
	return (
		target.closest('[data-rfd-drag-handle-draggable-id]') ??
		target.closest('[data-rbd-drag-handle-draggable-id]') ??
		null
	);
}

function getDragHandleDraggableId(handle: Element | null): string | null {
	if (!handle) return null;
	return (
		handle.getAttribute('data-rfd-drag-handle-draggable-id') ??
		handle.getAttribute('data-rbd-drag-handle-draggable-id') ??
		null
	);
}

function useImmediateTouchSensor(api: SensorAPI): void {
	const apiRef = React.useRef(api);
	apiRef.current = api;

	const stateRef = React.useRef<TouchSensorState>(touchIdleState);
	const unbindRef = React.useRef<() => void>(() => {});
	const debugMoveCountRef = React.useRef(0);

	const setState = React.useCallback((state: TouchSensorState): void => {
		stateRef.current = state;
	}, []);

	const stopListening = React.useCallback((): void => {
		unbindRef.current();
		unbindRef.current = () => {};
	}, []);

	const reset = React.useCallback((): void => {
		setState(touchIdleState);
		stopListening();
	}, [setState, stopListening]);

	const cancel = React.useCallback((): void => {
		const phase = stateRef.current;
		reset();
		if (phase.type === 'pending') {
			phase.actions.abort();
		} else if (phase.type === 'dragging') {
			phase.actions.cancel({ shouldBlockNextClick: true });
		}
	}, [reset]);

	const startPending = React.useCallback(
		(actions: PreDragActions, draggableId: string, start: Position, touchId: number | null): void => {
			setState({ type: 'pending', actions, draggableId, startPoint: start, touchId });
			debugMoveCountRef.current = 0;
			if (shouldDebugLog()) {
				console.log('[DND sensor] pending (touch)', {
					draggableId,
					touchId,
					start,
				});
			}

			const onTouchMove = (event: TouchEvent): void => {
				const phase = stateRef.current;
				if (phase.type === 'idle') return;
				if (!phase.actions.isActive()) {
					reset();
					return;
				}
				const touch = getTouchById(event, phase.touchId);
				if (!touch) return;

				if (shouldDebugLog() && debugMoveCountRef.current < 6) {
					debugMoveCountRef.current += 1;
					console.log('[DND sensor] touchmove', {
						phase: phase.type,
						touches: event.touches.length,
						changedTouches: event.changedTouches.length,
						touchId: phase.touchId,
						x: touch.clientX,
						y: touch.clientY,
					});
				}

				if (phase.type === 'pending') {
					event.preventDefault();
					const pointNow = { x: touch.clientX, y: touch.clientY };
					const dx = Math.abs(pointNow.x - phase.startPoint.x);
					const dy = Math.abs(pointNow.y - phase.startPoint.y);
					if (dx < axisThresholdPx && dy < axisThresholdPx) return;

					if (dx > dy * touchHorizontalBias) {
						const direction: 'left' | 'right' =
							pointNow.x >= phase.startPoint.x ? 'right' : 'left';
						phase.actions.abort();
						reset();
						fireHorizontalSnap(phase.draggableId, direction);
						return;
					}

					const fluidActions = phase.actions.fluidLift(phase.startPoint);
					setState({
						type: 'dragging',
						actions: fluidActions,
						startPoint: phase.startPoint,
						touchId: phase.touchId,
					});
					if (shouldDebugLog()) console.log('[DND sensor] lift->dragging (touch)');
					fluidActions.move({ x: phase.startPoint.x, y: pointNow.y });
					return;
				}

				if (phase.type === 'dragging') {
					event.preventDefault();
					phase.actions.move({ x: phase.startPoint.x, y: touch.clientY });
				}
			};

			const onTouchEnd = (event: TouchEvent): void => {
				const phase = stateRef.current;
				if (phase.type === 'idle') return;
				event.preventDefault();
				if (!phase.actions.isActive()) {
					reset();
					return;
				}
				if (phase.type === 'pending') {
					phase.actions.abort();
					reset();
					return;
				}
				if (phase.type === 'dragging') {
					phase.actions.drop({ shouldBlockNextClick: true });
					reset();
				}
			};

			const onTouchCancel = (event: TouchEvent): void => {
				const phase = stateRef.current;
				if (phase.type === 'idle') return;
				event.preventDefault();
				if (shouldDebugLog()) console.log('[DND sensor] touchcancel');
				cancel();
			};

			const onKeyDown = (event: KeyboardEvent): void => {
				if (event.key !== 'Escape') return;
				event.preventDefault();
				cancel();
			};

			const onVisibilityChange = (): void => cancel();
			const onContextMenu = (event: Event): void => event.preventDefault();

			const options: AddEventListenerOptions = { capture: true, passive: false };
			window.addEventListener('touchmove', onTouchMove, options);
			window.addEventListener('touchend', onTouchEnd, options);
			window.addEventListener('touchcancel', onTouchCancel, options);
			document.addEventListener('touchmove', onTouchMove, options);
			document.addEventListener('touchend', onTouchEnd, options);
			document.addEventListener('touchcancel', onTouchCancel, options);
			window.addEventListener('keydown', onKeyDown, options);
			window.addEventListener('contextmenu', onContextMenu, options);
			document.addEventListener('visibilitychange', onVisibilityChange, options);

			unbindRef.current = (): void => {
				window.removeEventListener('touchmove', onTouchMove, options);
				window.removeEventListener('touchend', onTouchEnd, options);
				window.removeEventListener('touchcancel', onTouchCancel, options);
				document.removeEventListener('touchmove', onTouchMove, options);
				document.removeEventListener('touchend', onTouchEnd, options);
				document.removeEventListener('touchcancel', onTouchCancel, options);
				window.removeEventListener('keydown', onKeyDown, options);
				window.removeEventListener('contextmenu', onContextMenu, options);
				document.removeEventListener('visibilitychange', onVisibilityChange, options);
			};
		},
		[cancel, reset, setState]
	);

	const onTouchStartCapture = React.useCallback(
		(event: TouchEvent): void => {
			if (event.defaultPrevented) return;
			const touch = event.touches[0];
			if (!touch) return;
			if (shouldDebugLog()) {
				const rawTarget = event.target instanceof Element ? event.target : null;
				console.log('[DND sensor] touchstart', {
					touches: event.touches.length,
					tag: rawTarget ? (rawTarget as HTMLElement).tagName : null,
				});
			}

			const currentApi = apiRef.current;
			const rawTarget = event.target instanceof Element ? event.target : null;
			const domDragHandle = findDragHandleElement(rawTarget);
			if (!domDragHandle) {
				if (shouldDebugLog()) console.log('[DND sensor] touchstart ignored: outside drag handle');
				return;
			}
			const domDraggableId = getDragHandleDraggableId(domDragHandle);
			const apiDraggableId = currentApi.findClosestDraggableId(event);
			const draggableId = domDraggableId ?? apiDraggableId;
			if (!draggableId) {
				if (shouldDebugLog()) console.log('[DND sensor] touchstart no draggableId');
				return;
			}
			if (shouldDebugLog()) console.log('[DND sensor] touchstart closest draggable', draggableId);

			let actions = currentApi.tryGetLock(draggableId, cancel, { sourceEvent: event });
			if (!actions) {
				const synthetic = makeMouseDownEventFromTouch(touch);
				actions = currentApi.tryGetLock(draggableId, cancel, { sourceEvent: synthetic });
				if (!actions) {
					if (shouldDebugLog()) console.log('[DND sensor] touchstart lock NOT acquired');
					return;
				}
				if (shouldDebugLog()) console.log('[DND sensor] touchstart lock acquired (synthetic mousedown)');
			} else {
				if (shouldDebugLog()) console.log('[DND sensor] touchstart lock acquired');
			}

			event.preventDefault();
			startPending(actions, draggableId, { x: touch.clientX, y: touch.clientY }, touch.identifier);
		},
		[cancel, startPending]
	);

	React.useLayoutEffect(() => {
		const options: AddEventListenerOptions = { capture: true, passive: false };
		document.addEventListener('touchstart', onTouchStartCapture, options);
		return () => {
			document.removeEventListener('touchstart', onTouchStartCapture, options);
			stopListening();
			setState(touchIdleState);
		};
	}, [onTouchStartCapture, setState, stopListening]);
}

function useImmediatePointerSensor(api: SensorAPI): void {
	// Keep api in a ref so the primary event handler callback is stable across
	// rerenders — prevents useLayoutEffect cleanup from killing mid-drag listeners.
	const apiRef = React.useRef(api);
	apiRef.current = api;

	const stateRef = React.useRef<SensorState>(idleState);
	const unbindRef = React.useRef<() => void>(() => {});

	const setState = React.useCallback((state: SensorState): void => {
		stateRef.current = state;
	}, []);

	const stopListening = React.useCallback((): void => {
		unbindRef.current();
		unbindRef.current = () => {};
	}, []);

	const reset = React.useCallback((): void => {
		setState(idleState);
		stopListening();
	}, [setState, stopListening]);

	const cancel = React.useCallback((): void => {
		const phase = stateRef.current;
		reset();
		if (phase.type === 'pending') {
			phase.actions.abort();
		} else if (phase.type === 'dragging') {
			phase.actions.cancel({ shouldBlockNextClick: true });
		}
	}, [reset]);

	const releasePointerCapture = React.useCallback((phase: PendingState | DraggingState): void => {
		const target = phase.captureTarget;
		if (!target) return;
		if (!('releasePointerCapture' in target)) return;
		try {
			(target as HTMLElement).releasePointerCapture(phase.pointerId);
		} catch {
			// ignore
		}
	}, []);

	const startPending = React.useCallback(
		(
			actions: PreDragActions,
			draggableId: string,
			point: Position,
			pointerId: number,
			pointerType: string,
			captureTarget: Element | null
		): void => {
			const pending: PendingState = {
				type: 'pending',
				actions,
				draggableId,
				startPoint: point,
				pointerId,
				pointerType,
				captureTarget,
			};
			setState(pending);
			if (shouldDebugLog()) {
				console.log('[DND sensor] pending', {
					draggableId,
					pointerId,
					pointerType,
					start: point,
					captureTag: captureTarget ? (captureTarget as HTMLElement).tagName : null,
				});
			}

			// Pointer capture (critical on mobile):
			// On some browsers the first touch-drag can get “stolen” by scrolling/overscroll,
			// and we stop receiving pointermove events while the library is still in its
			// pre-drag phase. Capturing the pointer keeps move/up events routed to our
			// handler until we either:
			// - abort (horizontal snap / click), or
			// - lift into a real drag.
			if (captureTarget && 'setPointerCapture' in captureTarget) {
				try {
					(captureTarget as HTMLElement).setPointerCapture(pointerId);
				} catch {
					// ignore
				}
			}

			const onPointerMove = (event: PointerEvent): void => {
				const phase = stateRef.current;
				if (phase.type === 'idle') return;
				if (event.pointerId !== phase.pointerId) return;
				if (!phase.actions.isActive()) {
					if (phase.type !== 'idle') releasePointerCapture(phase);
					reset();
					return;
				}

				if (phase.type === 'pending') {
					event.preventDefault();
					const pointNow = { x: event.clientX, y: event.clientY };
					const dx = Math.abs(pointNow.x - phase.startPoint.x);
					const dy = Math.abs(pointNow.y - phase.startPoint.y);

					if (dx < axisThresholdPx && dy < axisThresholdPx) return;

					const horizontalBias = phase.pointerType === 'touch' ? touchHorizontalBias : 1;
					if (dx > dy * horizontalBias) {
						const direction: 'left' | 'right' =
							pointNow.x >= phase.startPoint.x ? 'right' : 'left';
						phase.actions.abort();
						releasePointerCapture(phase);
						reset();
						fireHorizontalSnap(phase.draggableId, direction);
						return;
					}

					const fluidActions = phase.actions.fluidLift(phase.startPoint);
					const dragging: DraggingState = {
						type: 'dragging',
						actions: fluidActions,
						startPoint: phase.startPoint,
						pointerId: phase.pointerId,
						pointerType: phase.pointerType,
						captureTarget: phase.captureTarget,
					};
					setState(dragging);
					if (shouldDebugLog()) {
						console.log('[DND sensor] lift->dragging', {
							draggableId: phase.draggableId,
							pointerId: phase.pointerId,
							pointerType: phase.pointerType,
						});
					}
					fluidActions.move({ x: phase.startPoint.x, y: pointNow.y });
					return;
				}

				if (phase.type === 'dragging') {
					event.preventDefault();
					phase.actions.move({ x: phase.startPoint.x, y: event.clientY });
				}
			};

			const onPointerUp = (event: PointerEvent): void => {
				const phase = stateRef.current;
				if (phase.type === 'idle') return;
				if (event.pointerId !== phase.pointerId) return;
				if (!phase.actions.isActive()) {
					releasePointerCapture(phase);
					reset();
					return;
				}

				if (phase.type === 'pending') {
					phase.actions.abort();
					if (shouldDebugLog()) console.log('[DND sensor] pointerup while pending -> abort');
					releasePointerCapture(phase);
					reset();
					return;
				}

				if (phase.type === 'dragging') {
					phase.actions.drop({ shouldBlockNextClick: true });
					if (shouldDebugLog()) console.log('[DND sensor] pointerup while dragging -> drop');
					releasePointerCapture(phase);
					reset();
				}
			};

			const onPointerCancel = (event: PointerEvent): void => {
				const phase = stateRef.current;
				if (phase.type === 'idle') return;
				if (event.pointerId !== phase.pointerId) return;
				event.preventDefault();
				if (shouldDebugLog()) console.log('[DND sensor] pointercancel');
				if (phase.type !== 'idle') releasePointerCapture(phase);
				cancel();
			};

			const onKeyDown = (event: KeyboardEvent): void => {
				if (event.key !== 'Escape') return;
				event.preventDefault();
				const phase = stateRef.current;
				if (phase.type !== 'idle') releasePointerCapture(phase);
				cancel();
			};

			const onVisibilityChange = (): void => {
				const phase = stateRef.current;
				if (phase.type !== 'idle') releasePointerCapture(phase);
				cancel();
			};

			const onContextMenu = (event: Event): void => event.preventDefault();

			const options: AddEventListenerOptions = { capture: true, passive: false };
			// Listen on both the captured element and window.
			// Some Android builds are inconsistent about where follow-up pointer events
			// dispatch when capture/scroll heuristics kick in.
			const pointerTargets: EventTarget[] = [];
			if (captureTarget) pointerTargets.push(captureTarget);
			pointerTargets.push(window);
			for (const target of pointerTargets) {
				target.addEventListener('pointermove', onPointerMove as EventListener, options);
				target.addEventListener('pointerup', onPointerUp as EventListener, options);
				target.addEventListener('pointercancel', onPointerCancel as EventListener, options);
			}
			window.addEventListener('keydown', onKeyDown, options);
			window.addEventListener('contextmenu', onContextMenu, options);
			document.addEventListener('visibilitychange', onVisibilityChange, options);

			unbindRef.current = (): void => {
				for (const target of pointerTargets) {
					target.removeEventListener('pointermove', onPointerMove as EventListener, options);
					target.removeEventListener('pointerup', onPointerUp as EventListener, options);
					target.removeEventListener('pointercancel', onPointerCancel as EventListener, options);
				}
				window.removeEventListener('keydown', onKeyDown, options);
				window.removeEventListener('contextmenu', onContextMenu, options);
				document.removeEventListener('visibilitychange', onVisibilityChange, options);
			};
		},
		[cancel, releasePointerCapture, reset, setState]
	);

	const onPointerDownCapture = React.useCallback(
		(event: PointerEvent): void => {
			if (event.defaultPrevented) return;
			if (shouldDebugLog()) {
				const rawTarget = event.target instanceof Element ? event.target : null;
				console.log('[DND sensor] pointerdown', {
					pointerId: event.pointerId,
					pointerType: event.pointerType,
					button: event.button,
					tag: rawTarget ? (rawTarget as HTMLElement).tagName : null,
				});
			}
			// For mouse, only left button should start drag.
			if (event.pointerType === 'mouse' && event.button !== 0) return;
			const rawTarget = event.target instanceof Element ? event.target : null;
			const domDragHandle = findDragHandleElement(rawTarget);
			if (!domDragHandle) {
				if (shouldDebugLog()) console.log('[DND sensor] pointerdown ignored: outside drag handle');
				return;
			}

			const currentApi = apiRef.current;
			const domDraggableId = getDragHandleDraggableId(domDragHandle);
			const apiDraggableId = currentApi.findClosestDraggableId(event);
			const draggableId = domDraggableId ?? apiDraggableId;
			if (!draggableId) {
				if (shouldDebugLog()) console.log('[DND sensor] no draggableId found');
				return;
			}
			if (shouldDebugLog()) console.log('[DND sensor] closest draggable', draggableId);

			let actions = currentApi.tryGetLock(draggableId, cancel, { sourceEvent: event });
			if (!actions) {
				// Fallback: attempt lock using a synthetic mousedown, because some
				// pangea internals treat pointerdown as an invalid start event.
				const synthetic = makeMouseDownEventFromPointer(event);
				const fallbackActions = currentApi.tryGetLock(draggableId, cancel, { sourceEvent: synthetic });
				if (!fallbackActions) {
					if (shouldDebugLog()) console.log('[DND sensor] lock NOT acquired');
					return;
				}
				if (shouldDebugLog()) console.log('[DND sensor] lock acquired (synthetic mousedown)');
				// Use the fallback actions from here on.
				actions = fallbackActions;
			}
			if (shouldDebugLog()) console.log('[DND sensor] lock acquired');

			event.preventDefault();
			// Prefer capturing on the actual drag-handle element so:
			// - `touch-action: none` on the handle reliably applies
			// - pointer capture doesn't attach to inner SVG/path nodes
			const handleTarget = domDragHandle;
			const captureTarget = handleTarget;
			startPending(
				actions,
				draggableId,
				{ x: event.clientX, y: event.clientY },
				event.pointerId,
				event.pointerType,
				captureTarget
			);
		},
		[cancel, startPending]
	);

	React.useLayoutEffect(() => {
		const options: AddEventListenerOptions = { capture: true, passive: false };
		document.addEventListener('pointerdown', onPointerDownCapture as EventListener, options);
		return () => {
			document.removeEventListener('pointerdown', onPointerDownCapture as EventListener, options);
			stopListening();
			setState(idleState);
		};
	}, [onPointerDownCapture, setState, stopListening]);
}

/**
 * Prevent native touch behaviours (scroll, pull-to-refresh) on drag handles
 * so the PointerEvent sensor can capture the gesture reliably.
 * We listen at the document level in the capture phase and call preventDefault
 * when the touch lands on a recognised drag handle.
 */
function usePreventNativeTouchOnHandle(_api: SensorAPI): void {
	const handler = React.useCallback((event: TouchEvent): void => {
		const target = event.target instanceof Element ? event.target : null;
		if (findDragHandleElement(target)) {
			event.preventDefault();
		}
	}, []);

	React.useLayoutEffect(() => {
		const options: AddEventListenerOptions = { capture: true, passive: false };
		document.addEventListener('touchstart', handler, options);
		return () => {
			document.removeEventListener('touchstart', handler, options);
		};
	}, [handler]);
}

export const immediateChecklistSensors: Sensor[] = [usePreventNativeTouchOnHandle, useImmediatePointerSensor, useKeyboardSensor];
