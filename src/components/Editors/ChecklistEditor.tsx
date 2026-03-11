import React from 'react';
import { createPortal } from 'react-dom';
import type { Editor, JSONContent } from '@tiptap/core';
import {
	DragDropContext,
	Draggable,
	Droppable,
	type BeforeCapture,
	type DragStart,
	type DragUpdate,
	type DropResult,
} from '@hello-pangea/dnd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faBell,
	faImage,
	faEllipsisVertical,
	faGripVertical,
	faPalette,
	faUserPlus,
} from '@fortawesome/free-solid-svg-icons';
import { byPrefixAndName } from '../../core/byPrefixAndName';
import type { ChecklistItem } from '../../core/bindings';
import { createRichTextDocFromPlainText } from '../../core/richText';
import { applyChecklistDragToItems, normalizeChecklistHierarchy, removeChecklistItemWithChildren } from '../../core/checklistHierarchy';
import { getChecklistDragAxis, getChecklistHorizontalDirection, registerHorizontalSnapHandler, resetChecklistDragAxis } from '../../core/checklistDragState';
import { immediateChecklistSensors } from '../../core/dndSensors';
import { useChecklistFlip } from '../../core/useChecklistFlip';
import { useI18n } from '../../core/i18n';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import { useKeyboardHeight } from '../../core/useKeyboardHeight';
import { useIsMobileLandscape } from '../../core/useIsMobileLandscape';
import { NoteCardMoreMenu } from '../NoteCard/NoteCardMoreMenu';
import { RichTextEditor, RichTextToolbar } from './RichTextEditor';
import styles from './Editors.module.css';

export type ChecklistEditorProps = {
	onSave: (args: { title: string; items: Array<ChecklistItem & { richContent: JSONContent }> }) => void | Promise<void>;
	onCancel: () => void;
	initialShowCompleted?: boolean;
	onShowCompletedChange?: (next: boolean) => void;
	allowQuickDelete?: boolean;
};

type DraftChecklistItem = ChecklistItem & { richContent: JSONContent };

/**
 * Lightweight renderer for ProseMirror JSON content in non-active rows.
 * Handles bold, italic, underline, and hard breaks — no TipTap instance needed.
 */
function renderRichPreview(json: JSONContent | null | undefined): React.ReactNode {
	if (!json?.content) return null;
	let hasContent = false;
	const elements = json.content.map((block: JSONContent, bi: number) => {
		if (block.type !== 'paragraph') return null;
		if (!block.content || block.content.length === 0) return bi > 0 ? <br key={bi} /> : null;
		hasContent = true;
		return (
			<React.Fragment key={bi}>
				{bi > 0 ? <br /> : null}
				{block.content.map((node: JSONContent, ni: number) => {
					if (node.type === 'hardBreak') return <br key={ni} />;
					if (node.type !== 'text' || !node.text) return null;
					let el: React.ReactNode = node.text;
					for (const mark of (node.marks ?? []) as Array<{ type: string }>) {
						if (mark.type === 'bold') el = <strong>{el}</strong>;
						if (mark.type === 'italic') el = <em>{el}</em>;
						if (mark.type === 'underline') el = <u>{el}</u>;
					}
					return <React.Fragment key={ni}>{el}</React.Fragment>;
				})}
			</React.Fragment>
		);
	});
	return hasContent ? elements : null;
}

// Local-only draft ID generator used before data is persisted to Yjs.
function makeId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function reconcileDraftItems(nextItems: readonly ChecklistItem[], previousItems: readonly DraftChecklistItem[]): DraftChecklistItem[] {
	const previousById = new Map(previousItems.map((item) => [item.id, item]));
	return nextItems.map((item) => {
		const previous = previousById.get(item.id);
		const richContent = previous?.richContent ?? createRichTextDocFromPlainText(item.text);
		// Identity-preservation branch:
		// If normalized fields did not actually change, return the previous object
		// reference. This lets React memoized rows short-circuit, which is important
		// when toggling focus/selection across many checklist rows.
		if (
			previous &&
			previous.text === item.text &&
			previous.completed === item.completed &&
			(previous.parentId ?? null) === (item.parentId ?? null)
		) {
			return previous;
		}
		// Change branch: create a fresh object only when meaningful row fields changed.
		return {
			...item,
			richContent,
		};
	});
}

export function ChecklistEditor(props: ChecklistEditorProps): React.JSX.Element {
	const { t } = useI18n();
	const keyboardVisibilityPaddingPx = 88;
	// Local draft state until user presses Save.
	const [title, setTitle] = React.useState('');
	const [items, setItems] = React.useState<DraftChecklistItem[]>(() => [
		{ id: makeId(), text: '', completed: false, parentId: null, richContent: createRichTextDocFromPlainText('') },
	]);
	const [saving, setSaving] = React.useState(false);
	const [showCompleted, setShowCompleted] = React.useState(() => Boolean(props.initialShowCompleted));
	const [mediaDockOpen, setMediaDockOpen] = React.useState(false);
	const [mediaDockTab, setMediaDockTab] = React.useState<0 | 1>(0);
	// More-menu state (editor 3-dot button):
	// - Mobile (pointer: coarse): NoteCardMoreMenu renders as a bottom sheet.
	// - Desktop (pointer: fine): it renders as a popover positioned relative to
	//   the trigger button's DOMRect (captured on click).
	const [isMoreMenuOpen, setIsMoreMenuOpen] = React.useState(false);
	const [moreMenuAnchorRect, setMoreMenuAnchorRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);
	const [interactionGuardActive, setInteractionGuardActive] = React.useState(false);
	const isCoarsePointer = useIsCoarsePointer();
	const quickDeleteVisible = Boolean(props.allowQuickDelete) && isCoarsePointer;
	const keyboard = useKeyboardHeight();
	// Mobile-only keyboard branch:
	// - This mirrors the existing-note editor behavior so new-checklist creation has the
	//   same viewport contract while typing on mobile.
	// - As soon as the software keyboard is visible, the bottom dock/media affordances are
	//   treated as out-of-scope for layout and interaction until the keyboard closes again.
	const mobileKeyboardOpen = isCoarsePointer && keyboard.isOpen;
	const isMobileLandscape = useIsMobileLandscape();
	const isMobileLandscapeRef = React.useRef(isMobileLandscape);
	React.useEffect(() => {
		setShowCompleted(Boolean(props.initialShowCompleted));
	}, [props.initialShowCompleted]);
	React.useEffect(() => {
		isMobileLandscapeRef.current = isMobileLandscape;
		// Landscape branch: keep media dock closed and prevent opening gestures.
		if (isMobileLandscape) setMediaDockOpen(false);
	}, [isMobileLandscape]);
	React.useEffect(() => {
		// Keyboard-open branch:
		// Close the dock immediately so the composer cannot scroll down into a stale footer
		// region while the user is actively editing with the mobile keyboard open.
		if (!mobileKeyboardOpen) return;
		setMediaDockOpen(false);
	}, [mobileKeyboardOpen]);
	// ── Keyboard-drag focusout guard ─────────────────────────────────────────────
	// Mounted once on component init.  Listens in the *capture* phase so it fires
	// before any library/framework handlers can react to the blur.
	//
	// Why capture phase?  The DnD library's own listeners run in the bubble phase.
	// If we also used bubble, the browser's keyboard-dismiss heuristic could act
	// between the library's blur dispatch and our handler.  Capture guarantees we
	// intervene first.
	//
	// The guard is only active while `isDraggingWithKeyboardRef` is true (set in
	// `onBeforeCapture`, cleared in `onDragEnd`).  Outside of that window the
	// handler is a fast no-op.
	React.useEffect(() => {
		const handleFocusOut = (e: FocusEvent): void => {
			// Not in a keyboard-drag session — let the event propagate normally.
			if (!isDraggingWithKeyboardRef.current) return;
			// Focus is already moving *to* the proxy (e.g. we just called .focus()
			// on it ourselves) — no re-assert needed, avoid infinite loop.
			if (e.relatedTarget === focusProxyRef.current) return;
			// Re-claim focus on the proxy so the keyboard stays up.
			focusProxyRef.current?.focus();
		};
		document.addEventListener('focusout', handleFocusOut, true);
		return () => document.removeEventListener('focusout', handleFocusOut, true);
	}, []);
	React.useEffect(() => {
		// Coarse-pointer branch: shield initial interactions to absorb delayed
		// tap/mouse compatibility events from the opener surface.
		if (!isCoarsePointer) return;
		setInteractionGuardActive(false);
	}, [isCoarsePointer]);
	const dockTouchStartRef = React.useRef<{ x: number; y: number } | null>(null);
	const handleInteractionGuardEvent = React.useCallback((event: React.SyntheticEvent): void => {
		if (!interactionGuardActive) return;
		event.preventDefault();
		event.stopPropagation();
	}, [interactionGuardActive]);
	const handleTouchStart = React.useCallback((event: React.TouchEvent): void => {
		const t0 = event.touches[0];
		if (!t0) return;
		event.stopPropagation();
		dockTouchStartRef.current = { x: t0.clientX, y: t0.clientY };
	}, []);
	const handleDockTouchMove = React.useCallback((event: React.TouchEvent): void => {
		if (!dockTouchStartRef.current) return;
		event.stopPropagation();
		if (event.cancelable) event.preventDefault();
	}, []);
	const handleHandleTouchEnd = React.useCallback((event: React.TouchEvent): void => {
		// Landscape branch: dock open/close gestures are blocked.
		if (isMobileLandscapeRef.current) return;
		const start = dockTouchStartRef.current;
		const t0 = event.changedTouches[0];
		if (!start || !t0) return;
		event.stopPropagation();
		if (event.cancelable) event.preventDefault();
		dockTouchStartRef.current = null;
		const dx = t0.clientX - start.x;
		const dy = t0.clientY - start.y;
		if (Math.abs(dy) < 28 || Math.abs(dy) < Math.abs(dx)) return;
		if (dy < 0) setMediaDockOpen(true);
		if (dy > 0) setMediaDockOpen(false);
	}, []);
	const handleDockSwipeEnd = React.useCallback((event: React.TouchEvent): void => {
		// Landscape branch: media tab swipe is blocked with dock locked closed.
		if (isMobileLandscapeRef.current) return;
		const start = dockTouchStartRef.current;
		const t0 = event.changedTouches[0];
		if (!start || !t0) return;
		event.stopPropagation();
		dockTouchStartRef.current = null;
		const dx = t0.clientX - start.x;
		const dy = t0.clientY - start.y;
		if (Math.abs(dx) < 28 || Math.abs(dx) < Math.abs(dy)) return;
		setMediaDockTab((prev) => {
			if (dx < 0) return (prev === 0 ? 1 : prev);
			return (prev === 1 ? 0 : prev);
		});
	}, []);
	const titleInputRef = React.useRef<HTMLInputElement | null>(null);
	const rowInputsRef = React.useRef<Map<string, HTMLDivElement | null>>(new Map());
	const rowContainersRef = React.useRef<Map<string, HTMLLIElement | null>>(new Map());
	// Drag “ghost” sizing:
	// - We capture metrics from the real row *before* the drag starts.
	// - Height alone is not enough for multiline items: if the clone’s text area
	//   ends up with even a slightly different width, the text re-wraps, which
	//   looks like the ghost “changes” and can pull words from neighbouring lines.
	// - Capturing the text area's exact width lets the clone reflow identically.
	const dragGhostMetricsRef = React.useRef<{ rowWidth: number | null; rowHeight: number | null; textHeight: number | null; textWidth: number | null }>({
		rowWidth: null,
		rowHeight: null,
		textHeight: null,
		textWidth: null,
	});
	const checklistScrollRef = React.useRef<HTMLDivElement | null>(null);
	const [focusRowId, setFocusRowId] = React.useState<string | null>(null);
	const [activeRowId, setActiveRowId] = React.useState<string | null>(null);
	const [activeRowEditor, setActiveRowEditor] = React.useState<Editor | null>(null);
	const latestItemsRef = React.useRef<DraftChecklistItem[]>(items);
	const latestRowPayloadRef = React.useRef<{ id: string; text: string; richContent: JSONContent } | null>(null);
	// ── Mobile keyboard focus proxy ──────────────────────────────────────────────
	// Problem: when the DnD library starts a drag it clones the grabbed element
	// into a portal, tears the original out of flow, and sometimes blurs the
	// contenteditable altogether.  On mobile, any frame without a focused
	// input-like element causes the browser to dismiss the virtual keyboard.
	//
	// Solution: keep a hidden <textarea> in the DOM (the "focus proxy").  Right
	// before the drag begins we transfer focus to the proxy.  Because a real
	// input element holds focus, the OS keeps the keyboard visible even while
	// the original TipTap editor is momentarily detached / blurred.
	//
	// `focusProxyRef`              – ref to the hidden <textarea> rendered below.
	// `isDraggingWithKeyboardRef`  – mutable flag that is `true` only while a
	//                                drag is in flight *and* the keyboard was open
	//                                when the drag started.  Guards the document-
	//                                level focusout listener so it only intervenes
	//                                during keyboard-sensitive drags.
	const focusProxyRef = React.useRef<HTMLTextAreaElement | null>(null);
	const isDraggingWithKeyboardRef = React.useRef(false);
	// Quick-delete branch intentionally leaves no active row selected after delete.
	// This ref suppresses the usual "always keep one row active" effect on the next render.
	const suppressAutoActivateAfterDeleteRef = React.useRef(false);
	// Some mobile browsers briefly report `keyboard.isOpen=false` during focus
	// handoffs (e.g. contenteditable A unmounts before B mounts). If we treat that
	// as an intentional keyboard dismissal, we'll clear selection and blur focus,
	// which makes the keyboard flicker worse. This ref suppresses that effect for
	// a short window after a deliberate row activation.
	const ignoreKeyboardCloseUntilRef = React.useRef<number>(0);
	const prepareRowFocusHandoff = React.useCallback((): void => {
		// Focus the hidden proxy before the active row unmounts so mobile browsers keep
		// the software keyboard open during row-to-row activation or deletion.
		if (!isCoarsePointer || !keyboard.isOpen) return;
		ignoreKeyboardCloseUntilRef.current = Date.now() + 450;
		focusProxyRef.current?.focus();
	}, [isCoarsePointer, keyboard.isOpen]);
	const clearRowSelection = React.useCallback((): void => {
		// Clear both React selection state and DOM focus so quick delete truly exits the
		// row instead of letting another row auto-focus and reopen the keyboard.
		suppressAutoActivateAfterDeleteRef.current = true;
		setActiveRowId(null);
		setFocusRowId(null);
		setActiveRowEditor(null);
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
	}, []);
	// Row-switch focus handoff (mobile):
	// When switching the active checklist row while the keyboard is already open,
	// we briefly focus the proxy textarea BEFORE we unmount the current row editor.
	// This prevents a single-frame "no focused input" gap that can cause iOS/Android
	// to dismiss the keyboard and then immediately re-open it.
	const activateRow = React.useCallback(
		(id: string): void => {
			suppressAutoActivateAfterDeleteRef.current = false;
			prepareRowFocusHandoff();
			setActiveRowId(id);
			setFocusRowId(id);
		},
		[prepareRowFocusHandoff]
	);
	// Keyboard-close de-selection:
	// If the user dismisses the software keyboard, we intentionally de-select
	// any active checklist row on mobile. This ensures a subsequent drag gesture
	// cannot "re-open" the keyboard by re-focusing an already-mounted
	// contenteditable row editor.
	//
	// We only do this on coarse-pointer devices (mobile/tablet) because desktop
	// has no software keyboard contract and users may expect a persistent row
	// selection while navigating with mouse/keyboard.
	const lastMobileKeyboardOpenRef = React.useRef(mobileKeyboardOpen);
	React.useEffect(() => {
		const wasOpen = lastMobileKeyboardOpenRef.current;
		lastMobileKeyboardOpenRef.current = mobileKeyboardOpen;
		if (!isCoarsePointer) return;
		if (!wasOpen || mobileKeyboardOpen) return;
		// Deliberate row-switch branch:
		// Ignore transient "keyboard closed" signals during activation handoff.
		if (Date.now() < ignoreKeyboardCloseUntilRef.current) return;
		setActiveRowId(null);
		setFocusRowId(null);
		setActiveRowEditor(null);
		// Remove any lingering :focus-within highlight by clearing DOM focus.
		// This must not move focus to another input (which could re-open the keyboard).
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
	}, [isCoarsePointer, mobileKeyboardOpen]);
	const lastOverIndexRef = React.useRef<number | null>(null);
	const [draggingParentId, setDraggingParentId] = React.useState<string | null>(null);

	// FLIP animation helper for indent/un-indent (horizontal snap):
	// We snapshot row positions immediately before we mutate the list so React's
	// next render can animate rows from old -> new positions (less “teleporting”).
	const { capturePositions: captureFlipPositions } = useChecklistFlip(rowContainersRef, items);

	const normalizedItems = React.useMemo(() => reconcileDraftItems(normalizeChecklistHierarchy(items), items), [items]);
	const activeItems = React.useMemo(() => normalizedItems.filter((row) => !row.completed), [normalizedItems]);
	const completedItems = React.useMemo(() => normalizedItems.filter((row) => row.completed), [normalizedItems]);

	React.useEffect(() => {
		latestItemsRef.current = items;
	}, [items]);

	React.useEffect(() => {
		// Mobile keyboard-hidden branch:
		// When the keyboard is closed, allow "no active row" as a stable state.
		// (See the keyboard-close de-selection effect above.)
		if (isCoarsePointer && !mobileKeyboardOpen) return;
		if (activeRowId && normalizedItems.some((item) => item.id === activeRowId)) return;
		if (suppressAutoActivateAfterDeleteRef.current) return;
		setActiveRowId(normalizedItems[0]?.id ?? null);
	}, [activeRowId, isCoarsePointer, mobileKeyboardOpen, normalizedItems]);

	React.useEffect(() => {
		const rafId = window.requestAnimationFrame(() => {
			titleInputRef.current?.focus();
		});
		return () => window.cancelAnimationFrame(rafId);
	}, []);

	// Horizontal snap handler — bypass the drag library entirely for indent/unindent.
	// Important: we capture FLIP positions *before* the setItems() call so the
	// subsequent re-render can animate the moved row(s) into place.
	React.useEffect(() => {
		return registerHorizontalSnapHandler((draggableId, direction) => {
			captureFlipPositions();
			setItems((prev) => {
				const normalized = normalizeChecklistHierarchy(prev);
				const active = normalized.filter((item) => !item.completed);
				const sourceIndex = active.findIndex((item) => item.id === draggableId);
				if (sourceIndex === -1) return prev;
				return reconcileDraftItems(
					applyChecklistDragToItems({
						items: normalized,
						sourceIndex,
						destinationIndex: sourceIndex,
						axis: 'horizontal',
						horizontalDirection: direction,
					}),
					prev
				);
			});
		});
	}, []);

	const addItem = React.useCallback((index?: number): void => {
		const nextId = makeId();
		suppressAutoActivateAfterDeleteRef.current = false;
		setItems((prev) => {
			const next = prev.slice();
			const insertAt = typeof index === 'number' ? Math.max(0, Math.min(prev.length, index + 1)) : prev.length;
			next.splice(insertAt, 0, { id: nextId, text: '', completed: false, parentId: null, richContent: createRichTextDocFromPlainText('') });
			return next;
		});
		// Preserve keyboard during row-switch by focusing the proxy before the
		// current row editor unmounts (mobile).
		activateRow(nextId);
	}, [activateRow]);

	const updateItem = React.useCallback((id: string, patch: Partial<DraftChecklistItem>): void => {
		setItems((prev) => {
			const index = prev.findIndex((item) => item.id === id);
			if (index === -1) return prev;
			const current = prev[index];
			const next = { ...current, ...patch };
			// No-op branch:
			// Avoid replacing array/state when the patch does not change effective row
			// values. This prevents rerenders that would otherwise be attributed to React
			// scheduler time in the performance panel.
			if (
				next.text === current.text &&
				next.completed === current.completed &&
				(next.parentId ?? null) === (current.parentId ?? null) &&
				next.richContent === current.richContent
			) {
				return prev;
			}
			// Mutation branch: only touch the single updated row slot.
			const updated = prev.slice();
			updated[index] = next;
			return updated;
		});
	}, []);

	const toggleCompleted = React.useCallback((id: string, checked: boolean): void => {
		setItems((prev) => {
			const normalized = normalizeChecklistHierarchy(prev);
			const childIds = new Set(
				normalized.filter((item) => item.parentId === id).map((item) => item.id)
			);
			return reconcileDraftItems(normalized.map((item) => {
				if (item.id === id || childIds.has(item.id)) {
					return { ...item, completed: checked };
				}
				return item;
			}), prev);
		});
	}, []);

	const removeItem = React.useCallback((id: string, options?: { preserveKeyboard?: boolean }): void => {
		if (options?.preserveKeyboard !== false) {
			prepareRowFocusHandoff();
		}
		setItems((prev) => {
			const normalized = normalizeChecklistHierarchy(prev);
			if (normalized.length <= 1) return prev;
			const firstActiveId = normalized.find((row) => !row.completed)?.id ?? normalized[0]?.id ?? null;
			if (firstActiveId && id === firstActiveId) return prev;
			return reconcileDraftItems(removeChecklistItemWithChildren(prev, id), prev);
		});
	}, [prepareRowFocusHandoff]);

	const onDragEnd = React.useCallback((event: DropResult): void => {
		const destination = event.destination;
		if (!destination) return;
		const axis = getChecklistDragAxis() ?? 'vertical';
		const horizontalDirection = getChecklistHorizontalDirection();
		setItems((prev) =>
			reconcileDraftItems(
				applyChecklistDragToItems({
					items: prev,
					sourceIndex: event.source.index,
					destinationIndex: destination.index,
					axis,
					horizontalDirection,
				}),
				prev
			)
		);
		setDraggingParentId(null);
		dragGhostMetricsRef.current = { rowWidth: null, rowHeight: null, textHeight: null, textWidth: null };
		resetChecklistDragAxis();
	}, []);

	// Measure the row + text element before dragging so the drag clone matches
	// the original exactly (especially critical for multiline wrapping).
	const captureDragGhostMetrics = React.useCallback((id: string): void => {
		const rowNode = rowContainersRef.current.get(id);
		const textNode = rowInputsRef.current.get(id);
		const rowRect = rowNode?.getBoundingClientRect();
		const textRect = textNode?.getBoundingClientRect();
		dragGhostMetricsRef.current = {
			rowWidth: rowRect ? Math.ceil(rowRect.width) : null,
			rowHeight: rowRect ? Math.ceil(rowRect.height) : null,
			textHeight: textNode ? Math.max(26, Math.ceil(textNode.scrollHeight) + 2) : null,
			textWidth: textRect ? Math.ceil(textRect.width) : null,
		};
	}, []);

	const insertItemAfter = React.useCallback(
		(rowId: string): void => {
			const currentIndex = items.findIndex((row) => row.id === rowId);
			addItem(currentIndex === -1 ? undefined : currentIndex);
		},
		[addItem, items]
	);

	const vibrateIfAvailable = React.useCallback((ms: number): void => {
		if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
		navigator.vibrate(ms);
	}, []);

	// ── Drag-handle focus-steal prevention ────────────────────────────────────────
	// Bound to onMouseDown / onPointerDown / onTouchStart on every drag-handle
	// button.  `preventDefault()` on these events stops the browser's default
	// "focus the element you just pressed" behaviour.  Without this, tapping the
	// drag handle would blur the TipTap editor and dismiss the keyboard *before*
	// the DnD gesture even begins — making the proxy guard irrelevant.
	const preventHandleFocusSteal = React.useCallback((event: React.SyntheticEvent): void => {
		event.preventDefault();
	}, []);

	const onDragStart = React.useCallback(
		(event: DragStart): void => {
			// Keep drag-start lightweight: rely on metrics captured in onBeforeCapture.
			resetChecklistDragAxis();

			const dragged = activeItems.find((item) => item.id === event.draggableId) ?? null;
			// Parent-with-children branch:
			// While dragging a top-level parent that has children, we mark those children
			// for alternate styling/visibility so hierarchy motion stays understandable.
			// Non-parent or child rows skip this extra styling state.
			if (dragged && !dragged.parentId) {
				const hasChildren = activeItems.some((item) => item.parentId === dragged.id);
				setDraggingParentId(hasChildren ? dragged.id : null);
			} else {
				setDraggingParentId(null);
			}
			lastOverIndexRef.current = null;
		},
		[activeItems]
	);

	// ── onBeforeCapture — earliest hook in the drag lifecycle ────────────────────
	// Called synchronously by @hello-pangea/dnd *before* any DOM mutations
	// (cloning, portal injection, dimension locking) happen.  This is the only
	// safe moment to move focus to the proxy because once cloning begins the
	// browser may fire a blur on the contenteditable, which on mobile triggers
	// the keyboard-dismiss heuristic within the same event-loop turn.
	const onBeforeCapture = React.useCallback(
		(before: BeforeCapture): void => {
			// Ghost-sizing branch: measure the row so the drag clone is pixel-perfect.
			captureDragGhostMetrics(before.draggableId);

			// Mobile keyboard preservation branch:
			// • Arm the focusout guard so any subsequent blur during the drag is
			//   immediately recovered.
			// • Move focus to the proxy textarea.  Because the proxy is a real
			//   input-like element, the OS considers the keyboard "still in use"
			//   and keeps it visible.
			// • We only do this when `mobileKeyboardOpen` is true to avoid
			//   interfering with desktop drag interactions where there is no
			//   virtual keyboard to preserve.
			if (mobileKeyboardOpen) {
				isDraggingWithKeyboardRef.current = true;
				focusProxyRef.current?.focus();
			}
		},
		[captureDragGhostMetrics, mobileKeyboardOpen]
	);

	const onDragUpdate = React.useCallback(
		(event: DragUpdate): void => {
			const nextIndex = event.destination?.index ?? null;
			if (nextIndex === null) return;
			if (lastOverIndexRef.current === nextIndex) return;
			lastOverIndexRef.current = nextIndex;
			vibrateIfAvailable(6);
		},
		[vibrateIfAvailable]
	);

	const onSubmit = async (event: React.FormEvent): Promise<void> => {
		// Submission delegates persistence to parent App handlers.
		event.preventDefault();
		if (saving) return;
		setSaving(true);
		try {
			let itemsForSave = latestItemsRef.current;
			// Save-time flush:
			// The focused TipTap row can be ahead of React state if the user types and taps
			// Save immediately. Snapshot the active editor directly so offline-created
			// checklist rows never persist as "checkbox with blank text".
			const latestRowPayload = latestRowPayloadRef.current;
			if (latestRowPayload && itemsForSave.some((item) => item.id === latestRowPayload.id)) {
				itemsForSave = itemsForSave.map((item) => item.id === latestRowPayload.id
					? { ...item, text: latestRowPayload.text, richContent: latestRowPayload.richContent }
					: item);
			}
			if (activeRowId && activeRowEditor) {
				try {
					const activeText = activeRowEditor.getText();
					const activeJson = activeRowEditor.getJSON();
					itemsForSave = itemsForSave.map((item) => item.id === activeRowId
						? { ...item, text: activeText, richContent: activeJson }
						: item);
				} catch {
					// If the editor is tearing down mid-submit, fall back to the latest React state.
				}
			}
			const prunedItems = itemsForSave.filter((item) => item.text.trim().length > 0);
			await props.onSave({ title, items: prunedItems });
		} finally {
			setSaving(false);
		}
	};

	const preventSaveFocusSteal = React.useCallback((event: React.SyntheticEvent): void => {
		event.preventDefault();
	}, []);

	const removeItemAndFocus = React.useCallback(
		(id: string): void => {
			if (activeItems[0]?.id === id) return;
			const currentIndex = normalizedItems.findIndex((row) => row.id === id);
			const previousId = currentIndex > 0 ? normalizedItems[currentIndex - 1]?.id ?? null : null;
			const nextId = normalizedItems[currentIndex + 1]?.id ?? null;
			removeItem(id);
			const focusTarget = previousId ?? nextId;
			if (focusTarget) activateRow(focusTarget);
		},
		[activeItems, normalizedItems, removeItem, activateRow]
	);

	const removeItemByButton = React.useCallback(
		(id: string): void => {
			if (!quickDeleteVisible) {
				// Standard delete keeps editing flow moving by focusing an adjacent row.
				removeItemAndFocus(id);
				return;
			}
			// Quick-delete branch favors keyboard dismissal over focus continuity.
			clearRowSelection();
			removeItem(id, { preserveKeyboard: false });
		},
		[clearRowSelection, quickDeleteVisible, removeItem, removeItemAndFocus]
	);

	const renderChecklistClone = React.useCallback(
		(
			dragProvided: import('@hello-pangea/dnd').DraggableProvided,
			snapshot: import('@hello-pangea/dnd').DraggableStateSnapshot,
			rubric: import('@hello-pangea/dnd').DraggableRubric
		): React.JSX.Element => {
			const dragged = activeItems.find((item) => item.id === rubric.draggableId) ?? null;
			const { rowWidth, rowHeight, textHeight, textWidth } = dragGhostMetricsRef.current;
			const richPreview = dragged ? renderRichPreview(dragged.richContent) : null;
			const isActiveClone = dragged !== null && activeRowId === dragged.id;
			const previewContent = richPreview || dragged?.text || '\u00A0';
			const dragStyle = dragProvided.draggableProps.style ?? {};

			return (
				<li
					ref={dragProvided.innerRef}
					{...dragProvided.draggableProps}
					className={`${styles.checklistItem} ${styles.rowDragging} ${styles.dragGhost}${isActiveClone ? ` ${styles.checklistItemActive}` : ''}${dragged?.parentId ? ` ${styles.childRow}` : ''}`}
					style={{
						...dragStyle,
						...(snapshot.isDropAnimating ? { transitionDuration: isCoarsePointer ? '1ms' : '60ms' } : null),
						width: rowWidth ?? undefined,
						minHeight: rowHeight ?? undefined,
						boxSizing: 'border-box',
					}}
				>
					<button type="button" className={styles.dragHandle} aria-label={t('editors.dragHandle')} {...dragProvided.dragHandleProps}>
						<FontAwesomeIcon icon={faGripVertical} />
					</button>
					<input type="checkbox" className={styles.checklistCheckbox} checked={Boolean(dragged?.completed)} readOnly />
					{isActiveClone ? (
						<div className={styles.checklistRowRichShell}>
							<div className={styles.checklistRowRichStack} style={{ width: textWidth ?? undefined, flex: '0 0 auto' }}>
								<div className={styles.checklistRowRichViewport}>
									<div className={`${styles.checklistRowRichEditor} ${styles.dragPreviewText}`} style={{ height: textHeight ?? undefined }}>
										{previewContent}
									</div>
								</div>
							</div>
						</div>
					) : (
						<div className={styles.checklistRowPreview} style={{ height: textHeight ?? undefined, width: textWidth ?? undefined, flex: '0 0 auto' }}>
							{previewContent}
						</div>
					)}
					<button type="button" className={styles.rowRemoveButton} aria-hidden="true" tabIndex={-1} disabled>
						×
					</button>
				</li>
			);
		},
		[activeItems, activeRowId, isCoarsePointer, t]
	);

	const backdropPressStartedRef = React.useRef(false);
	const handleOverlayBackdropPressStart = React.useCallback((event: React.PointerEvent | React.MouseEvent): void => {
		// Only close on clicks that both start and end on the backdrop. That prevents
		// text-selection drags from dismissing the editor when the mouse-up lands outside.
		backdropPressStartedRef.current = event.target === event.currentTarget;
	}, []);
	const handleOverlayBackdropClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
		if (mediaDockOpen) return;
		const shouldClose = backdropPressStartedRef.current && event.target === event.currentTarget;
		backdropPressStartedRef.current = false;
		if (shouldClose) props.onCancel();
	}, [mediaDockOpen, props]);

	return (
		<div
			className={styles.fullscreenOverlay}
			role="presentation"
			onPointerDownCapture={handleOverlayBackdropPressStart}
			onMouseDownCapture={handleOverlayBackdropPressStart}
			onClick={handleOverlayBackdropClick}
		>
			<form
				onSubmit={onSubmit}
				className={`${styles.fullscreenEditor} ${styles.editorContainer} ${styles.editorBlurred}${mediaDockOpen ? ` ${styles.mediaOpen}` : ''}${interactionGuardActive ? ` ${styles.editorInteractionGuardActive}` : ''}${isCoarsePointer ? ` ${styles.mobileHideToolbar}` : ''}`}
				// Keyboard-open branch:
				// Clamp the editor to the visible viewport so the composer ends at the keyboard
				// edge and never includes a hidden footer region below the keyboard.
				style={mobileKeyboardOpen ? { height: `${keyboard.visibleBottom}px`, maxHeight: `${keyboard.visibleBottom}px` } : undefined}
				onClick={(event) => event.stopPropagation()}
			>
				{/* ── Hidden focus proxy <textarea> ────────────────────────────────
				    Purpose:
				      Keeps the mobile virtual keyboard visible while the DnD library
				      manipulates the DOM.  The proxy receives focus right before the
				      drag begins (in `onBeforeCapture`) and holds it until the drag
				      ends, at which point focus returns to the active TipTap editor.

				    Why a <textarea> and not an <input>?
				      Both work on Android/Chrome, but Safari on iOS aggressively
				      collapses the keyboard for <input type="text"> when it detects
				      that the element has no visible frame.  <textarea> does not
				      trigger that heuristic.

				    Style choices:
				      • position:fixed / 1×1px / opacity:0 — invisible but focusable.
				        `display:none` and `visibility:hidden` both make the element
				        unfocusable, which would defeat the purpose.
				      • fontSize:16px — prevents iOS "auto-zoom on focus" which fires
				        when the focused input has a computed font-size < 16px.
				      • pointerEvents:none — the proxy must never accidentally
				        intercept taps or scroll gestures.
				      • tabIndex={-1} — keeps the element out of the normal tab order
				        so keyboard (hardware) navigation skips it.
				      • aria-hidden — prevents screen readers from announcing it.
				      • zIndex:-1 — pushes it behind all other content as a safety
				        net in case opacity/pointer-events ever fail to hide it. */}
				<textarea
					ref={focusProxyRef}
					aria-hidden="true"
					tabIndex={-1}
					style={{
						position: 'fixed',
						top: 0,
						left: 0,
						width: '1px',
						height: '1px',
						opacity: 0,
						padding: 0,
						border: 'none',
						outline: 'none',
						pointerEvents: 'none',
						fontSize: '16px',
						zIndex: -1,
					}}
				/>
				<input
					className={styles.editorTitleInput}
					ref={titleInputRef}
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder={t('editors.titlePlaceholder')}
				/>

				<section aria-label="Checklist" className={`${styles.editorContainer} ${styles.checklistEditorSection}`}>
					<div className={styles.checklistToolbarSlot}>
						<RichTextToolbar editor={activeRowEditor} variant="minimal" compact />
					</div>
					{/* Keyboard-open branch:
					    Reserve space for the floating toolbar only. This preserves comfortable text
					    scrolling while explicitly excluding the dock/media handle from the editable
					    viewport during keyboard interaction. */}
					<div ref={checklistScrollRef} className={styles.checklistScrollArea} style={mobileKeyboardOpen ? { paddingBottom: `${keyboardVisibilityPaddingPx}px` } : undefined}>
					<DragDropContext
						enableDefaultSensors={false}
						sensors={immediateChecklistSensors}
						onBeforeCapture={onBeforeCapture}
						onDragStart={onDragStart}
						onDragUpdate={onDragUpdate}
						onDragEnd={(event) => {
							const scrollEl = checklistScrollRef.current;
							const savedScroll = scrollEl ? scrollEl.scrollTop : null;
							// Scroll guard: intercept any scroll event and snap back to
							// saved position. Catches focus-driven scrollIntoView, DnD
							// cleanup, and React reflow — fires before the browser paints.
							const scrollGuard = (): void => {
								if (scrollEl && savedScroll !== null) scrollEl.scrollTop = savedScroll;
							};
							if (isCoarsePointer && scrollEl) {
								scrollEl.addEventListener('scroll', scrollGuard);
							}
							lastOverIndexRef.current = null;
							onDragEnd(event);
							setDraggingParentId(null);
							resetChecklistDragAxis();
							const removeGuard = (): void => {
								if (!isCoarsePointer || !scrollEl) return;
								// Keep the guard active through several frames so it
								// catches deferred focus effects (autoFocus rAF, etc.)
								setTimeout(() => {
									scrollEl.removeEventListener('scroll', scrollGuard);
								}, 300);
							};
							if (isDraggingWithKeyboardRef.current) {
								requestAnimationFrame(() => {
									isDraggingWithKeyboardRef.current = false;
									if (isCoarsePointer && activeRowEditor?.view) {
										activeRowEditor.view.dom.focus({ preventScroll: true });
									} else {
										activeRowEditor?.commands.focus();
									}
									removeGuard();
								});
							} else {
								removeGuard();
							}
						}}
					>
						<Droppable droppableId="checklist-active-items" renderClone={renderChecklistClone}>
							{(dropProvided) => (
								<ul
										className={styles.checklistList}
									ref={dropProvided.innerRef}
									{...dropProvided.droppableProps}
								>
									{activeItems.length === 0 ? (
									// Empty-state affordance:
									// If every checklist item has been marked completed, the "active" list
									// becomes empty and there is otherwise no way to create a new row.
									// This provides a lightweight in-place action that inserts a fresh row
									// into the underlying items array and focuses it.
										<li className={styles.checklistComposerRow}>
											<div className={styles.dragHandle} aria-hidden="true" />
											<input type="checkbox" className={styles.checklistCheckbox} checked={false} readOnly tabIndex={-1} aria-hidden="true" />
											<button
												type="button"
												className={styles.checklistAddItemButton}
												onClick={() => addItem()}
												aria-label={t('editors.addItem')}
											>
												{t('editors.addItem')}
											</button>
										</li>
									) : null}
									{activeItems.map((item, index) => (
										<Draggable key={item.id} draggableId={item.id} index={index} disableInteractiveElementBlocking>
											{(dragProvided, snapshot) => {
												const dragStyle = dragProvided.draggableProps.style ?? {};
												return (
												<li
																ref={(node) => {
																	dragProvided.innerRef(node);
																	rowContainersRef.current.set(item.id, node);
																}}
													{...dragProvided.draggableProps}
														className={`${styles.checklistItem}${activeRowId === item.id ? ` ${styles.checklistItemActive}` : ''}${quickDeleteVisible ? ` ${styles.checklistItemQuickDelete}` : ''}${item.parentId ? ` ${styles.childRow}` : ''}${snapshot.isDragging || (draggingParentId !== null && item.parentId === draggingParentId) ? ` ${styles.rowDragging}` : ''}${draggingParentId !== null && item.parentId === draggingParentId ? ` ${styles.childDraggingWithParent} ${styles.childHiddenDuringParentDrag}` : ''}`}
													aria-label={t('editors.dragHandle')}
													style={{
														...dragStyle,
														...(snapshot.isDropAnimating ? { transitionDuration: isCoarsePointer ? '1ms' : '60ms' } : null),
													}}
												>
													<button
														type="button"
														className={styles.dragHandle}
														aria-label={t('editors.dragHandle')}
														title={t('editors.dragHandle')}
														{...dragProvided.dragHandleProps}
														onMouseDown={preventHandleFocusSteal}
														onPointerDown={preventHandleFocusSteal}
													>
														<FontAwesomeIcon icon={faGripVertical} />
													</button>
													<input
														type="checkbox"
														className={styles.checklistCheckbox}
														checked={item.completed}
														onChange={(event) => toggleCompleted(item.id, event.target.checked)}
													/>
													{activeRowId === item.id ? (
														<div ref={(node) => { rowInputsRef.current.set(item.id, node); }} className={styles.checklistRowRichShell} onClick={() => activateRow(item.id)}>
															<RichTextEditor
																key={item.id}
																variant="minimal"
																emitInitialChange={false}
																content={item.richContent}
																placeholder={t('editors.checklistItemPlaceholder')}
																hideToolbar
																autoFocus={focusRowId === item.id}
																caretVisibilityBottomInset={mobileKeyboardOpen ? keyboardVisibilityPaddingPx : 0}
																containerClassName={styles.checklistRowRichStack}
																viewportClassName={styles.checklistRowRichViewport}
																contentClassName={styles.checklistRowRichEditor}
																onEditorChange={setActiveRowEditor}
																onChange={(payload) => {
																	// Signal-only compatibility branch:
																	// `RichTextEditor` can emit undefined payloads in lightweight mode.
																	// This draft editor still requests full payloads, so guard defensively.
																	if (!payload) return;
																	latestRowPayloadRef.current = { id: item.id, text: payload.text, richContent: payload.json };
																	updateItem(item.id, { text: payload.text, richContent: payload.json });
																}}
																onEnter={() => insertItemAfter(item.id)}
																onShiftEnter={() => undefined}
																onBackspaceWhenEmpty={() => {
																	if (activeItems[0]?.id === item.id) return;
																	removeItemAndFocus(item.id);
																}}
															/>
														</div>
													) : (
														<div ref={(node) => { rowInputsRef.current.set(item.id, node); }} className={styles.checklistRowPreview} onClick={() => activateRow(item.id)}>
															{renderRichPreview(item.richContent) || item.text || '\u00A0'}
														</div>
													)}
													<button
														type="button"
														className={styles.rowRemoveButton}
														onClick={() => {
															if (quickDeleteVisible) {
																removeItemByButton(item.id);
																return;
															}
															removeItem(item.id);
														}}
														aria-label={t('editors.remove')}
														title={t('editors.remove')}
													>
														×
													</button>
												</li>
												);
											}}
										</Draggable>
									))}
									{dropProvided.placeholder}
								</ul>
							)}
						</Droppable>
					</DragDropContext>
					

				{completedItems.length > 0 ? (
					<section className={styles.completedSection}>
						<button
							type="button"
							className={styles.completedToggle}
							onClick={() =>
								setShowCompleted((prev) => {
									const next = !prev;
									props.onShowCompletedChange?.(next);
									return next;
								})
							}
						>
							{showCompleted ? '▾' : '▸'} {completedItems.length} {t('editors.completedItems')}
						</button>
						{showCompleted ? (
							<ul className={styles.checklistList}>
								{completedItems.map((item) => (
											<li key={item.id} className={`${styles.checklistItem}${activeRowId === item.id ? ` ${styles.checklistItemActive}` : ''}${quickDeleteVisible ? ` ${styles.checklistItemQuickDelete}` : ''}${item.parentId ? ` ${styles.childRow}` : ''}`}>
										<div className={styles.dragHandle} aria-hidden="true">
													<FontAwesomeIcon icon={faGripVertical} />
										</div>
										<input
											type="checkbox"
											className={styles.checklistCheckbox}
											checked={item.completed}
											onChange={(event) => toggleCompleted(item.id, event.target.checked)}
										/>
											{activeRowId === item.id ? (
																	<div ref={(node) => { rowInputsRef.current.set(item.id, node); }} className={styles.checklistRowRichShell} onClick={() => activateRow(item.id)}>
															<RichTextEditor
																key={item.id}
																variant="minimal"
																emitInitialChange={false}
																content={item.richContent}
																placeholder={t('editors.checklistItemPlaceholder')}
																hideToolbar
																autoFocus={focusRowId === item.id}
																caretVisibilityBottomInset={mobileKeyboardOpen ? keyboardVisibilityPaddingPx : 0}
																containerClassName={styles.checklistRowRichStack}
																viewportClassName={styles.checklistRowRichViewport}
																contentClassName={styles.checklistRowRichEditor}
																onEditorChange={setActiveRowEditor}
																onChange={(payload) => {
																	// Same guard in completed-items branch for symmetry and safety.
																	if (!payload) return;
																	latestRowPayloadRef.current = { id: item.id, text: payload.text, richContent: payload.json };
																	updateItem(item.id, { text: payload.text, richContent: payload.json });
																}}
																onEnter={() => insertItemAfter(item.id)}
																onShiftEnter={() => undefined}
																onBackspaceWhenEmpty={() => {
																	if (activeItems[0]?.id === item.id) return;
																	removeItem(item.id);
																}}
													/>
												</div>
													) : (
																		<div ref={(node) => { rowInputsRef.current.set(item.id, node); }} className={styles.checklistRowPreview} onClick={() => activateRow(item.id)}>
													{renderRichPreview(item.richContent) || item.text || '\u00A0'}
												</div>
											)}
										<button
											type="button"
											className={styles.rowRemoveButton}
											onClick={() => removeItemByButton(item.id)}
											aria-label={t('editors.remove')}
											title={t('editors.remove')}
										>
											×
										</button>
									</li>
								))}
							</ul>
						) : null}
					</section>
				) : null}
					</div>
				</section>

				{/* Keyboard-open branch:
				    The dock/media controls are removed entirely while typing on mobile. This is
				    stronger than merely hiding them visually and guarantees they cannot be dragged
				    or scrolled into view under the keyboard. */}
				{mobileKeyboardOpen ? null : <div className={styles.editorBottomArea}>
					<section className={styles.mediaDock} aria-label={t('editors.mediaDock')}>
						<button
							type="button"
							className={styles.mediaDockHandle}
							onClick={() => {
								if (isMobileLandscapeRef.current) return;
								setMediaDockOpen((prev) => !prev);
							}}
							onTouchStart={handleTouchStart}
							onTouchMove={handleDockTouchMove}
							onTouchEnd={handleHandleTouchEnd}
							aria-label={t('editors.mediaDock')}
						>
							<span className={styles.mediaDockPill} aria-hidden="true" />
							<span className={styles.mediaDockLabel}>{t('editors.mediaTabMedia')}</span>
						</button>
					</section>

					<nav className={`${styles.bottomDock} ${styles.bottomDockCompact}`} aria-label={t('editors.bottomDock')}>
						<div className={styles.bottomDockLeft}>
							<button
								type="button"
								className={`${styles.bottomDockButton} ${styles.bottomDockButtonCompact}`}
								aria-label={t('editors.dockAction')}
								onClick={(e) => {
									// Capture the trigger button's rect for desktop popover placement.
									// (On mobile this rect is ignored because the menu is a bottom sheet.)
									setMoreMenuAnchorRect(e.currentTarget.getBoundingClientRect().toJSON());
									setIsMoreMenuOpen(true);
								}}
							>
								<FontAwesomeIcon icon={faEllipsisVertical} />
							</button>
							<button type="button" className={`${styles.bottomDockButton} ${styles.bottomDockButtonCompact}`} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faPalette} />
							</button>
							<button type="button" className={`${styles.bottomDockButton} ${styles.bottomDockButtonCompact}`} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faBell} />
							</button>
							<button type="button" className={`${styles.bottomDockButton} ${styles.bottomDockButtonCompact}`} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faUserPlus} />
							</button>
							<button type="button" className={`${styles.bottomDockButton} ${styles.bottomDockButtonCompact}`} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faImage} />
							</button>
							<button
								type="button"
								className={styles.mediaDockText}
								onClick={() => {
									if (isMobileLandscapeRef.current) return;
									setMediaDockOpen((prev) => !prev);
								}}
								aria-label={t('editors.mediaDock')}
							>
								{t('editors.mediaTabMedia')}
							</button>
						</div>
						<div className={styles.bottomDockRightActions}>
							<button
								type="button"
								className={styles.bottomDockClose}
								onClick={props.onCancel}
								disabled={saving}
								aria-label={t('common.cancel')}
								title={t('common.cancel')}
							>
								<FontAwesomeIcon icon={byPrefixAndName.fas.ban} />
							</button>
							<button
								type="submit"
								className={styles.bottomDockClose}
								disabled={saving}
								onMouseDown={preventSaveFocusSteal}
								onPointerDown={preventSaveFocusSteal}
								aria-label={saving ? t('editors.saving') : t('common.save')}
								title={saving ? t('editors.saving') : t('common.save')}
							>
								<FontAwesomeIcon icon={byPrefixAndName.fas['floppy-disk']} />
							</button>
						</div>
					</nav>
				</div>}
			<div
				className={styles.editorBlockLayer}
				aria-hidden="true"
				onPointerDown={handleInteractionGuardEvent}
				onPointerUp={handleInteractionGuardEvent}
				onMouseDown={handleInteractionGuardEvent}
				onMouseUp={handleInteractionGuardEvent}
				onTouchStart={handleInteractionGuardEvent}
				onTouchEnd={handleInteractionGuardEvent}
				onClick={handleInteractionGuardEvent}
			/>
			</form>

			<aside
				className={`${styles.mediaFlyout}${mediaDockOpen ? ` ${styles.mediaFlyoutOpen}` : ''}`}
				onClick={(e) => e.stopPropagation()}
				aria-hidden={!mediaDockOpen}
			>
					<header className={styles.mediaFlyoutHeader}>
						<div className={styles.mediaTabs} role="tablist" aria-label={t('editors.mediaDockTabs')}>
							<button
								type="button"
								role="tab"
								aria-selected={mediaDockTab === 0}
								className={`${styles.mediaTab}${mediaDockTab === 0 ? ` ${styles.mediaTabActive}` : ''}`}
								onClick={() => setMediaDockTab(0)}
							>
								{t('editors.mediaTabMedia')}
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={mediaDockTab === 1}
								className={`${styles.mediaTab}${mediaDockTab === 1 ? ` ${styles.mediaTabActive}` : ''}`}
								onClick={() => setMediaDockTab(1)}
							>
								{t('editors.mediaTabLinks')}
							</button>
						</div>
						<button type="button" className={styles.mediaFlyoutClose} onClick={() => setMediaDockOpen(false)} aria-label={t('common.close')}>
							✕
						</button>
					</header>
					<div className={styles.mediaFlyoutBody}>
						<div className={styles.mediaPanel} role="tabpanel">
							<div className={styles.mediaPanelPlaceholder} aria-hidden="true" />
						</div>
					</div>
			</aside>

			{/* Keyboard-open branch:
			    The mobile media sheet is kept out of the tree during keyboard editing for the
			    same reason as the dock: the keyboard-open layout should contain only the editor
			    body and the floating formatting toolbar. */}
			{mobileKeyboardOpen ? null : <section
				className={`${styles.mediaSheet}${mediaDockOpen ? ` ${styles.mediaSheetOpen}` : ''}`}
				aria-label={t('editors.mediaDock')}
				onClick={(e) => e.stopPropagation()}
			>
				<button
					type="button"
					className={styles.mediaSheetHandle}
					onClick={() => {
						if (isMobileLandscapeRef.current) return;
						setMediaDockOpen((prev) => !prev);
					}}
					onTouchStart={handleTouchStart}
					onTouchMove={handleDockTouchMove}
					onTouchEnd={handleHandleTouchEnd}
					aria-label={t('editors.mediaDock')}
				>
					<span className={styles.mediaDockPill} aria-hidden="true" />
					<span className={styles.mediaDockLabel}>{t('editors.mediaTabMedia')}</span>
				</button>

				<header className={styles.mediaSheetHeader}>
					<div className={styles.mediaTabs} role="tablist" aria-label={t('editors.mediaDockTabs')} onTouchStart={handleTouchStart} onTouchEnd={handleDockSwipeEnd}>
						<button
							type="button"
							role="tab"
							aria-selected={mediaDockTab === 0}
							className={`${styles.mediaTab}${mediaDockTab === 0 ? ` ${styles.mediaTabActive}` : ''}`}
							onClick={() => setMediaDockTab(0)}
						>
							{t('editors.mediaTabMedia')}
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={mediaDockTab === 1}
							className={`${styles.mediaTab}${mediaDockTab === 1 ? ` ${styles.mediaTabActive}` : ''}`}
							onClick={() => setMediaDockTab(1)}
						>
							{t('editors.mediaTabLinks')}
						</button>
					</div>
					<button
						type="button"
						className={styles.mediaSheetClose}
						onClick={() => {
							if (isMobileLandscapeRef.current) return;
							setMediaDockOpen(false);
						}}
						aria-label={t('common.close')}
					>
						✕
					</button>
				</header>

				<div className={styles.mediaSheetBody}>
					<div className={styles.mediaPanel} role="tabpanel">
						<div className={styles.mediaPanelPlaceholder} aria-hidden="true" />
					</div>
				</div>
			</section>}
			{/* Branch: only mount the menu while open so it can lock scroll / manage history on mobile. */}
			{isMoreMenuOpen ? (
			<NoteCardMoreMenu
				noteType="checklist"
				anchorRect={moreMenuAnchorRect}
					onClose={() => {
						setIsMoreMenuOpen(false);
						setMoreMenuAnchorRect(null);
					}}
			/>
		) : null}

		{/* Floating keyboard toolbar + occlusion backdrop:
		    The editor itself is clamped to `keyboard.visibleBottom`, which leaves the
		    keyboard-covered portion of the layout viewport outside the overlay. During
		    the keyboard slide-up animation that region can briefly reveal the app grid,
		    so we cover it with a fixed opaque layer behind the toolbar. */}
		{isCoarsePointer && keyboard.isOpen ? createPortal(
			<>
				<div className={styles.keyboardOcclusion} style={{ top: `${keyboard.visibleBottom}px` }} />
				<div
					className={styles.floatingToolbar}
					style={{ top: `${keyboard.visibleBottom}px`, transform: 'translateY(-100%)' }}
				>
					<RichTextToolbar editor={activeRowEditor} variant="minimal" compact />
				</div>
			</>,
			document.body
		) : null}
		</div>
	);
}
