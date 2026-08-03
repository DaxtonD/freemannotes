import React, { useSyncExternalStore } from 'react';
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
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
	faBell,
	faImage,
	faEllipsisVertical,
	faGripVertical,
	faListCheck,
	faNoteSticky,
	faPalette,
	faPencil,
	faUserPlus,
} from '@fortawesome/free-solid-svg-icons';
import { byPrefixAndName } from '../../core/byPrefixAndName';
import { useLiveAvatarUrlLookup } from '../../core/liveUserAvatarCache';
import type { ChecklistItem } from '../../core/bindings';
import { getChecklistCountPrefix, getChecklistCountValue, isChecklistCountItem } from '../../core/checklistCounts';
import { getExternalLinkRel, getExternalLinkTarget } from '../../core/externalLinks';
import { mergeNotePreviewLinkInputs } from '../../core/noteLinks';
import { getUserNoteAutoScrollEnabled, setUserNoteAutoScrollEnabled, subscribeNoteAutoScrollPrefs } from '../../core/noteAutoScrollPreferences';
import { createRichTextDocFromPlainText, getPlainTextFromRichJson, splitMinimalRichTextAtSelection } from '../../core/richText';
import { applyChecklistDragToItems, buildChecklistCompletedRows, normalizeChecklistHierarchy, removeChecklistItemWithChildren, toggleChecklistItemCompleted } from '../../core/checklistHierarchy';
import { getChecklistDragAxis, getChecklistHorizontalDirection, registerHorizontalSnapHandler, resetChecklistDragAxis } from '../../core/checklistDragState';
import { immediateChecklistSensors } from '../../core/dndSensors';
import { useChecklistFlip } from '../../core/useChecklistFlip';
import type { EditorToolbarMode } from '../../core/deviceAppearancePreferences';
import { useI18n } from '../../core/i18n';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import { useKeyboardHeight } from '../../core/useKeyboardHeight';
import { useIsMobileLandscape } from '../../core/useIsMobileLandscape';
import { NoteCardMoreMenu } from '../NoteCard/NoteCardMoreMenu';
import { DocumentsPanel } from './DocumentsPanel';
import { RichTextEditor, RichTextToolbar, focusRichTextEditable } from './RichTextEditor';
import styles from './Editors.module.css';

export type ChecklistEditorProps = {
	onSave: (args: { title: string; items: Array<ChecklistItem & { richContent: JSONContent }>; previewLinks: string[] }) => void | Promise<void>;
	onCancel: () => void;
	initialShowCompleted?: boolean;
	onShowBriefDialog?: (message: string) => void;
	onShowCompletedChange?: (next: boolean) => void;
	allowQuickDelete?: boolean;
	toolbarMode?: EditorToolbarMode;
	authUserId?: string | null;
};

type DraftChecklistItem = ChecklistItem & { richContent: JSONContent };

const DRAFT_CHECKLIST_AUTOSCROLL_ID = '__draft_checklist_editor__';

function getChecklistAutoScrollTarget(container: HTMLElement, completedSection: HTMLElement | null): number {
	const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
	if (!completedSection) return maxScrollTop;
	const containerRect = container.getBoundingClientRect();
	const completedRect = completedSection.getBoundingClientRect();
	const completedTop = container.scrollTop + (completedRect.top - containerRect.top);
	return Math.max(0, Math.min(maxScrollTop, completedTop - container.clientHeight + 12));
}

function animateFastScrollToBottom(container: HTMLElement, targetScrollTop?: number): () => void {
	const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
	const boundedTarget = typeof targetScrollTop === 'number'
		? Math.max(0, Math.min(maxScrollTop, targetScrollTop))
		: maxScrollTop;
	const startTop = container.scrollTop;
	const distance = boundedTarget - startTop;
	if (Math.abs(distance) <= 1 || typeof window === 'undefined') {
		container.scrollTop = boundedTarget;
		return () => undefined;
	}
	const durationMs = 180;
	const startTime = window.performance.now();
	let frameId = 0;
	const step = (now: number): void => {
		const progress = Math.min(1, (now - startTime) / durationMs);
		const eased = 1 - Math.pow(1 - progress, 3);
		container.scrollTop = startTop + (distance * eased);
		if (progress < 1) {
			frameId = window.requestAnimationFrame(step);
		}
	};
	frameId = window.requestAnimationFrame(step);
	return () => window.cancelAnimationFrame(frameId);
}

function previewNoteTypeIcon(noteType?: string | null): IconDefinition {
	switch (noteType) {
		case 'checklist': return faListCheck;
		case 'drawing':   return faPencil;
		case 'reminder':  return faBell;
		default:          return faNoteSticky;
	}
}

/**
 * Lightweight renderer for ProseMirror JSON content in non-active rows.
 * Handles bold, italic, underline, hard breaks, and @mention/[[note]] reference
 * chips — no TipTap instance needed. Mirrors NoteEditor.tsx's renderRichPreview;
 * note-type references render as static (non-clickable) chips here since the
 * draft checklist flow has no note-navigation callback to wire up (the note
 * doesn't exist yet — clicking away would abandon the draft).
 */
function renderRichPreview(json: JSONContent | null | undefined, liveAvatarLookup?: ReadonlyMap<string, string | null>): React.ReactNode {
	if (!json?.content) return null;
	const applyMarks = (node: JSONContent, content: React.ReactNode, key: React.Key): React.ReactNode => {
		let element = content;
		for (const mark of (node.marks ?? []) as Array<{ type: string; attrs?: { href?: unknown; color?: unknown } }>) {
			if (mark.type === 'bold') element = <strong key={`${key}-bold`}>{element}</strong>;
			if (mark.type === 'italic') element = <em key={`${key}-italic`}>{element}</em>;
			if (mark.type === 'underline') element = <u key={`${key}-underline`}>{element}</u>;
			if (mark.type === 'strike') element = <s key={`${key}-strike`}>{element}</s>;
			if (mark.type === 'highlight') {
				const color = typeof mark.attrs?.color === 'string' ? mark.attrs.color : undefined;
				element = <mark key={`${key}-highlight`} className={styles.richPreviewHighlight} style={color ? { backgroundColor: color } : undefined}>{element}</mark>;
			}
			if (mark.type === 'link') {
				const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
				element = href
					? (
						<a
							key={`${key}-link`}
							href={href}
							target={getExternalLinkTarget()}
							rel={getExternalLinkRel()}
							onClick={(event) => event.stopPropagation()}
						>
							{element}
						</a>
					)
					: element;
			}
		}
		return element;
	};
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
					if (node.type === 'reference') {
						const label     = typeof node.attrs?.label     === 'string' ? node.attrs.label     : '';
						const id        = typeof node.attrs?.id        === 'string' ? node.attrs.id        : '';
						const refType   = node.attrs?.type;
						const noteType  = node.attrs?.noteType ?? null;
						// See NoteEditor.tsx's renderRichPreview for why the live cache is
						// preferred over the stored (insertion-time) avatarUrl attribute.
						const storedAvatarUrl = typeof node.attrs?.avatarUrl === 'string' ? node.attrs.avatarUrl : null;
						const avatarUrl = liveAvatarLookup && refType === 'user' && id
							? (liveAvatarLookup.get(id) ?? storedAvatarUrl)
							: storedAvatarUrl;
						const isNote    = refType === 'note';
						const isUser    = refType === 'user';
						const icon      = isNote ? previewNoteTypeIcon(noteType) : null;
						return (
							<span key={ni} className={styles.referenceChipPreview}>
								{icon && <FontAwesomeIcon icon={icon} className={styles.referenceChipPreviewIcon} />}
								{isUser && avatarUrl && <img src={avatarUrl} className={styles.referenceChipPreviewAvatar} alt="" aria-hidden />}
								{label}
							</span>
						);
					}
					if (node.type !== 'text' || !node.text) return null;
					return <React.Fragment key={ni}>{applyMarks(node, node.text, `${bi}-${ni}`)}</React.Fragment>;
				})}
			</React.Fragment>
		);
	});
	return hasContent ? elements : null;
}

function renderChecklistPreviewContent(item: ChecklistItem, content: React.ReactNode): React.ReactNode {
	const countPrefix = getChecklistCountPrefix(item);
	return countPrefix
		? <><span className={styles.checklistCountPrefix} aria-hidden="true">{countPrefix}</span>{content}</>
		: content;
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
			(previous.parentId ?? null) === (item.parentId ?? null) &&
			(previous.countValue ?? null) === (item.countValue ?? null)
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

function normalizeChecklistAutocompleteText(value: string): string {
	return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function matchesChecklistAutocompleteCandidate(normalizedCandidate: string, normalizedTyped: string): boolean {
	if (!normalizedTyped) return false;
	if (normalizedCandidate.startsWith(normalizedTyped)) return true;
	return normalizedCandidate.split(' ').some((part) => part.startsWith(normalizedTyped));
}

function getChecklistAutocompleteSuggestion(
	items: readonly DraftChecklistItem[],
	rowId: string | null,
	currentText: string
): string | null {
	if (!rowId) return null;
	const normalizedTyped = normalizeChecklistAutocompleteText(currentText);
	if (!normalizedTyped) return null;
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const candidate = items[index];
		if (candidate.id === rowId) continue;
		const candidateText = String(
			candidate.text?.trim().length
				? candidate.text
				: getPlainTextFromRichJson(candidate.richContent, 'minimal')
		).trim();
		if (!candidateText) continue;
		const normalizedCandidate = normalizeChecklistAutocompleteText(candidateText);
		if (!normalizedCandidate || normalizedCandidate === normalizedTyped) continue;
		if (matchesChecklistAutocompleteCandidate(normalizedCandidate, normalizedTyped)) {
			return candidateText;
		}
	}
	return null;
}

export function ChecklistEditor(props: ChecklistEditorProps): React.JSX.Element {
	const { t } = useI18n();
	const keyboardVisibilityPaddingPx = 88;
	// Feeds renderRichPreview's mention-chip avatar so it reflects profile
	// changes instead of the stale value captured at mention-insertion time.
	const liveAvatarLookup = useLiveAvatarUrlLookup();
	// Local draft state until user presses Save.
	const [title, setTitle] = React.useState('');
	const [items, setItems] = React.useState<DraftChecklistItem[]>(() => [
		{ id: makeId(), text: '', completed: false, parentId: null, countValue: null, richContent: createRichTextDocFromPlainText('') },
	]);
	const [previewLinks, setPreviewLinks] = React.useState<string[]>([]);
	const [saving, setSaving] = React.useState(false);
	const [showCompleted, setShowCompleted] = React.useState(() => Boolean(props.initialShowCompleted));
	// ── Checkbox undo/redo ───────────────────────────────────────────────────────
	// Tracks only checkbox check/uncheck actions, separate from text undo. Uses
	// refs to avoid re-renders on every action; boolean state flags drive button
	// enabled/disabled so the UI updates when stacks become empty or non-empty.
	const checkboxUndoStack = React.useRef<DraftChecklistItem[][]>([]);
	const checkboxRedoStack = React.useRef<DraftChecklistItem[][]>([]);
	const [checkboxUndoAvail, setCheckboxUndoAvail] = React.useState(false);
	const [checkboxRedoAvail, setCheckboxRedoAvail] = React.useState(false);
	const checklistFormRef = React.useRef<HTMLFormElement | null>(null);
	const noteAutoScrollEnabled = useSyncExternalStore(
		(onStoreChange) => subscribeNoteAutoScrollPrefs(onStoreChange),
		() => getUserNoteAutoScrollEnabled(DRAFT_CHECKLIST_AUTOSCROLL_ID),
		() => getUserNoteAutoScrollEnabled(DRAFT_CHECKLIST_AUTOSCROLL_ID)
	);
	const activeScrollCancelRef = React.useRef<(() => void) | null>(null);
	const [mediaDockOpen, setMediaDockOpen] = React.useState(false);
	const [mediaSheetProgress, setMediaSheetProgress] = React.useState(0);
	const [isMediaSheetDragging, setIsMediaSheetDragging] = React.useState(false);
	const [isMediaSheetClosing, setIsMediaSheetClosing] = React.useState(false);
	const [mediaDockTab, setMediaDockTab] = React.useState<0 | 1 | 2>(0);
	// More-menu state (editor 3-dot button):
	// - Mobile (pointer: coarse): NoteCardMoreMenu renders as a bottom sheet.
	// - Desktop (pointer: fine): it renders as a popover positioned relative to
	//   the trigger button's DOMRect (captured on click).
	const [isMoreMenuOpen, setIsMoreMenuOpen] = React.useState(false);
	const [moreMenuAnchorRect, setMoreMenuAnchorRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);
	const [interactionGuardActive, setInteractionGuardActive] = React.useState(false);
	const mediaFlyoutRef = React.useRef<HTMLElement | null>(null);
	const mediaSheetRef = React.useRef<HTMLElement | null>(null);
	const mediaSheetDragRef = React.useRef<{
		startX: number;
		startY: number;
		startProgress: number;
		sheetHeight: number;
		verticalLocked: boolean;
	} | null>(null);
	const ignoreNextMediaDockClickRef = React.useRef(false);
	// Suppress media-sheet drag gestures for a short window after the editor opens.
	// The touch that tapped the card can carry into the handle area and trigger an
	// unintended drag that makes the sheet slide up then immediately fade away.
	const mediaSheetGestureSuppressUntilRef = React.useRef(0);
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
	const isMediaSheetGestureSuppressed = React.useCallback((): boolean => {
		return typeof performance !== 'undefined'
			? performance.now() < mediaSheetGestureSuppressUntilRef.current
			: false;
	}, []);

	// Set the suppress window once on mount so any touch that opened the editor cannot
	// accidentally trigger the media sheet drag.
	React.useEffect(() => {
		mediaSheetGestureSuppressUntilRef.current = (
			typeof performance !== 'undefined' ? performance.now() : Date.now()
		) + 450;
	}, []);

	React.useEffect(() => {
		if (isMediaSheetDragging) return;
		if (isMediaSheetGestureSuppressed()) {
			if (!mediaDockOpen && mediaSheetProgress > 0.001) {
				setMediaSheetProgress(0);
				setIsMediaSheetClosing(false);
			}
			return;
		}
		if (!mediaDockOpen && mediaSheetProgress > 0.001) {
			setIsMediaSheetClosing(true);
		}
		if (mediaDockOpen && isMediaSheetClosing) {
			setIsMediaSheetClosing(false);
		}
		setMediaSheetProgress(mediaDockOpen ? 1 : 0);
	}, [isMediaSheetClosing, isMediaSheetDragging, isMediaSheetGestureSuppressed, mediaDockOpen, mediaSheetProgress]);
	React.useEffect(() => {
		if (!mediaDockOpen || !isCoarsePointer || typeof document === 'undefined') return;
		const active = document.activeElement;
		if (active instanceof HTMLElement) {
			// Hide the active caret immediately once the sheet overlays editor content.
			active.blur();
		}
	}, [isCoarsePointer, mediaDockOpen]);
	React.useEffect(() => {
		if (!mediaDockOpen || isCoarsePointer || typeof document === 'undefined') return;
		const handlePointerDown = (event: PointerEvent): void => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (mediaFlyoutRef.current?.contains(target)) return;
			if (target.closest('[data-checklist-editor-media-dock-trigger="true"]')) return;
			setMediaDockOpen(false);
		};
		document.addEventListener('pointerdown', handlePointerDown, true);
		return () => document.removeEventListener('pointerdown', handlePointerDown, true);
	}, [isCoarsePointer, mediaDockOpen]);
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
	React.useEffect(() => {
		if (!noteAutoScrollEnabled) {
			activeScrollCancelRef.current?.();
			activeScrollCancelRef.current = null;
			return;
		}
		let cancelled = false;
		const tryScroll = (remaining: number): void => {
			if (cancelled) return;
			const container = checklistScrollRef.current;
			if (container) {
				activeScrollCancelRef.current?.();
				activeScrollCancelRef.current = animateFastScrollToBottom(container, getChecklistAutoScrollTarget(container, completedSectionRef.current));
				return;
			}
			if (remaining <= 0 || typeof window === 'undefined') return;
			window.setTimeout(() => tryScroll(remaining - 1), 24);
		};
		tryScroll(12);
		return () => {
			cancelled = true;
			activeScrollCancelRef.current?.();
			activeScrollCancelRef.current = null;
		};
	}, [noteAutoScrollEnabled]);
	const dockTouchStartRef = React.useRef<{ x: number; y: number } | null>(null);
	const mediaSheetSwipeStartRef = React.useRef<{ x: number; y: number } | null>(null);
	const handleInteractionGuardEvent = React.useCallback((event: React.SyntheticEvent): void => {
		if (!interactionGuardActive) return;
		event.preventDefault();
		event.stopPropagation();
	}, [interactionGuardActive]);
	const handleBottomDockTouchEnd = React.useCallback((event: React.TouchEvent<HTMLElement>): void => {
		if (!isCoarsePointer) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		const button = target.closest('button');
		if (!(button instanceof HTMLButtonElement)) return;
		if (!event.currentTarget.contains(button) || button.disabled) return;
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
		button.click();
	}, [isCoarsePointer]);
	const clampMediaSheetProgress = React.useCallback((value: number): number => Math.max(0, Math.min(1, value)), []);
	const getMediaSheetHeight = React.useCallback((): number => {
		const currentHeight = mediaSheetRef.current?.getBoundingClientRect().height ?? 0;
		if (Number.isFinite(currentHeight) && currentHeight > 0) return currentHeight;
		if (typeof window === 'undefined') return 620;
		return Math.min(window.innerHeight * 0.72, 620);
	}, []);
	const handleToggleMediaDock = React.useCallback((): void => {
		if (isMobileLandscapeRef.current) return;
		if (ignoreNextMediaDockClickRef.current) {
			ignoreNextMediaDockClickRef.current = false;
			return;
		}
		setIsMediaSheetClosing(false);
		setMediaDockOpen((prev) => !prev);
	}, []);
	const handleDockTabTouchStart = React.useCallback((event: React.TouchEvent): void => {
		const t0 = event.touches[0];
		if (!t0) return;
		event.stopPropagation();
		dockTouchStartRef.current = { x: t0.clientX, y: t0.clientY };
	}, []);
	const handleMediaDockDragStart = React.useCallback((event: React.TouchEvent): void => {
		if (isMobileLandscapeRef.current) return;
		if (isMediaSheetGestureSuppressed()) return;
		const t0 = event.touches[0];
		if (!t0) return;
		event.stopPropagation();
		setIsMediaSheetClosing(false);
		mediaSheetDragRef.current = {
			startX: t0.clientX,
			startY: t0.clientY,
			startProgress: mediaSheetProgress,
			sheetHeight: getMediaSheetHeight(),
			verticalLocked: false,
		};
	}, [getMediaSheetHeight, isMediaSheetGestureSuppressed, mediaSheetProgress]);
	const handleMediaDockDragMove = React.useCallback((event: React.TouchEvent): void => {
		if (isMediaSheetGestureSuppressed()) return;
		const gesture = mediaSheetDragRef.current;
		const t0 = event.touches[0];
		if (!gesture || !t0) return;
		event.stopPropagation();
		const dx = t0.clientX - gesture.startX;
		const dy = t0.clientY - gesture.startY;

		if (!gesture.verticalLocked) {
			if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
				mediaSheetDragRef.current = null;
				setIsMediaSheetDragging(false);
				setMediaSheetProgress(mediaDockOpen ? 1 : 0);
				return;
			}
			if (Math.abs(dy) <= 6 || Math.abs(dy) < Math.abs(dx) * 0.75) return;
			gesture.verticalLocked = true;
		}

		if (event.cancelable) event.preventDefault();
		setIsMediaSheetDragging(true);
		setMediaSheetProgress(clampMediaSheetProgress(gesture.startProgress - (dy / Math.max(gesture.sheetHeight, 1))));
	}, [clampMediaSheetProgress, isMediaSheetGestureSuppressed, mediaDockOpen]);
	const handleMediaDockDragEnd = React.useCallback((event: React.TouchEvent): void => {
		if (isMediaSheetGestureSuppressed()) {
			mediaSheetDragRef.current = null;
			setIsMediaSheetDragging(false);
			return;
		}
		const gesture = mediaSheetDragRef.current;
		if (!gesture) return;
		event.stopPropagation();
		mediaSheetDragRef.current = null;
		if (!gesture.verticalLocked) {
			setIsMediaSheetDragging(false);
			setMediaSheetProgress(mediaDockOpen ? 1 : 0);
			return;
		}
		ignoreNextMediaDockClickRef.current = true;
		const shouldOpen = gesture.startProgress >= 0.5 ? mediaSheetProgress > 0.72 : mediaSheetProgress >= 0.3;
		setIsMediaSheetDragging(false);
		if (shouldOpen) setMediaSheetProgress(1);
		setMediaDockOpen(shouldOpen);
	}, [isMediaSheetGestureSuppressed, mediaDockOpen, mediaSheetProgress]);
	const handleMediaSheetTransitionEnd = React.useCallback((event: React.TransitionEvent<HTMLElement>): void => {
		if (event.target !== event.currentTarget) return;
		if (event.propertyName !== 'transform') return;
		if (mediaDockOpen || mediaSheetProgress > 0.001) return;
		setIsMediaSheetClosing(false);
	}, [mediaDockOpen, mediaSheetProgress]);
	const handleSelectMediaDockTabFromTouch = React.useCallback((tab: 0 | 1 | 2, event: React.TouchEvent<HTMLButtonElement>): void => {
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
		dockTouchStartRef.current = null;
		setMediaDockTab(tab);
	}, []);
	const handleToggleNoteAutoScroll = React.useCallback((): void => {
		const next = !noteAutoScrollEnabled;
		setUserNoteAutoScrollEnabled(DRAFT_CHECKLIST_AUTOSCROLL_ID, null, next);
		if (!next) {
			activeScrollCancelRef.current?.();
			activeScrollCancelRef.current = null;
			return;
		}
		const container = checklistScrollRef.current;
		if (!container) return;
		activeScrollCancelRef.current?.();
		activeScrollCancelRef.current = animateFastScrollToBottom(container, getChecklistAutoScrollTarget(container, completedSectionRef.current));
	}, [noteAutoScrollEnabled]);
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
			if (dx < 0) return Math.min(prev + 1, 2) as 0 | 1 | 2;
			return Math.max(prev - 1, 0) as 0 | 1 | 2;
		});
	}, []);
	const handleMediaSheetTouchStart = React.useCallback((event: React.TouchEvent<HTMLElement>): void => {
		if (typeof document !== 'undefined' && document.body.dataset.freemannotesNoteImageViewerOpen === 'true') {
			mediaSheetSwipeStartRef.current = null;
			return;
		}
		const touch = event.touches[0];
		if (!touch) return;
		mediaSheetSwipeStartRef.current = { x: touch.clientX, y: touch.clientY };
	}, []);
	const handleMediaSheetTouchEnd = React.useCallback((event: React.TouchEvent<HTMLElement>): void => {
		if (typeof document !== 'undefined' && document.body.dataset.freemannotesNoteImageViewerOpen === 'true') {
			mediaSheetSwipeStartRef.current = null;
			return;
		}
		const start = mediaSheetSwipeStartRef.current;
		const touch = event.changedTouches[0];
		mediaSheetSwipeStartRef.current = null;
		if (!start || !touch) return;
		const dx = touch.clientX - start.x;
		const dy = touch.clientY - start.y;
		const currentTarget = event.currentTarget;
		const scrolledToTop = currentTarget.scrollTop <= 0;
		if (!scrolledToTop) return;
		if (Math.abs(dx) < 28 || Math.abs(dx) < Math.abs(dy)) return;
		setMediaDockTab((prev) => {
			if (dx < 0) return Math.min(prev + 1, 2) as 0 | 1 | 2;
			return Math.max(prev - 1, 0) as 0 | 1 | 2;
		});
	}, []);
	const titleInputRef = React.useRef<HTMLTextAreaElement | null>(null);
	const resizeTitleField = React.useCallback((): void => {
		const field = titleInputRef.current;
		if (!field) return;
		field.style.height = '0px';
		field.style.height = `${Math.max(36, field.scrollHeight)}px`;
	}, []);
	const rowInputsRef = React.useRef<Map<string, HTMLDivElement | null>>(new Map());
	const rowContainersRef = React.useRef<Map<string, HTMLLIElement | null>>(new Map());
	// Only one row is ever active (and therefore ever shows a suggestion) at a
	// time, so a single ref is enough — see handleRowShellClick below.
	const activeAutocompleteSuffixRef = React.useRef<HTMLSpanElement | null>(null);
	// Drag “ghost” sizing:
	const dragGhostMetricsRef = React.useRef<{ rowWidth: number | null; rowHeight: number | null; textHeight: number | null; textWidth: number | null }>({
		rowWidth: null,
		rowHeight: null,
		textHeight: null,
		textWidth: null,
	});
	const completedSectionRef = React.useRef<HTMLElement | null>(null);
	const checklistScrollRef = React.useRef<HTMLDivElement | null>(null);
	const [focusRowId, setFocusRowId] = React.useState<string | null>(null);
	const [activeRowId, setActiveRowId] = React.useState<string | null>(null);
	const [activeRowAutocompleteText, setActiveRowAutocompleteText] = React.useState('');
	const [activeRowEditor, setActiveRowEditor] = React.useState<Editor | null>(null);
	const [activeRowHistoryState, setActiveRowHistoryState] = React.useState({ canUndo: false, canRedo: false });
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
	const allowAutomaticRowFocusRef = React.useRef(false);
	// Set true on title Enter-key press; cleared by the activeRowEditor effect below
	// so that the first available TipTap editor instance is focused directly via
	// commands.focus() rather than the DOM-level focusRichTextEditable fallback.
	const needsFocusAfterTitleEnterRef = React.useRef(false);
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
			if (activeRowId === id) return;
			allowAutomaticRowFocusRef.current = true;
			suppressAutoActivateAfterDeleteRef.current = false;
			prepareRowFocusHandoff();
			setActiveRowId(id);
			setFocusRowId(id);
		},
		[activeRowId, prepareRowFocusHandoff]
	);
	const focusChecklistRowEditor = React.useCallback((rowId: string, placement: 'start' | 'end' = 'end'): void => {
		const tryFocus = (remaining: number): void => {
			const editorElement = rowInputsRef.current.get(rowId)?.querySelector('[contenteditable="true"]');
			if (editorElement instanceof HTMLElement) {
				focusRichTextEditable(editorElement, placement);
				return;
			}
			if (remaining <= 0 || typeof window === 'undefined') return;
			window.setTimeout(() => tryFocus(remaining - 1), 16);
		};
		tryFocus(6);
	}, []);
	const focusFirstChecklistItem = React.useCallback((): void => {
		const firstItemId = latestItemsRef.current[0]?.id ?? null;
		if (!firstItemId) return;
		activateRow(firstItemId);
		focusChecklistRowEditor(firstItemId);
	}, [activateRow, focusChecklistRowEditor]);
	// When the title Enter key sets needsFocusAfterTitleEnterRef, this effect fires
	// as soon as the target row's TipTap editor instance becomes available and calls
	// focus via the editor API (commands.focus) rather than raw DOM selection, which
	// is the only reliable path for an empty ProseMirror document.
	React.useEffect(() => {
		if (!needsFocusAfterTitleEnterRef.current) return;
		if (!activeRowEditor || activeRowEditor.isDestroyed) return;
		needsFocusAfterTitleEnterRef.current = false;
		activeRowEditor.commands.focus('end');
	}, [activeRowEditor]);
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
		setFocusRowId(null);
		// Keep the active row/editor mounted so footer undo/redo can target the same
		// checklist text history after the keyboard is dismissed.
		// Only clear DOM focus so the keyboard stays closed.
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
	const completedRows = React.useMemo(() => buildChecklistCompletedRows(normalizedItems), [normalizedItems]);
	const visibleChecklistRowIds = React.useMemo(
		() => [
			...activeItems.map((item) => item.id),
			...(showCompleted ? completedRows.flatMap(({ kind, item }) => kind === 'ghost' ? [] : [item.id]) : []),
		],
		[activeItems, completedRows, showCompleted]
	);
	const moveFocusToAdjacentRow = React.useCallback((rowId: string, direction: 'previous' | 'next'): void => {
		const currentIndex = visibleChecklistRowIds.indexOf(rowId);
		if (currentIndex === -1) return;
		const targetId = direction === 'previous'
			? visibleChecklistRowIds[currentIndex - 1] ?? null
			: visibleChecklistRowIds[currentIndex + 1] ?? null;
		if (!targetId) return;
		activateRow(targetId);
		focusChecklistRowEditor(targetId, direction === 'previous' ? 'end' : 'start');
	}, [activateRow, focusChecklistRowEditor, visibleChecklistRowIds]);

	React.useEffect(() => {
		latestItemsRef.current = items;
	}, [items]);

	React.useEffect(() => {
		// Mobile keyboard-hidden branch:
		// When the keyboard is closed, allow "no active row" as a stable state.
		// (See the keyboard-close de-selection effect above.)
		if (isCoarsePointer && !mobileKeyboardOpen) return;
		if (!allowAutomaticRowFocusRef.current) return;
		if (activeRowId && normalizedItems.some((item) => item.id === activeRowId)) return;
		if (suppressAutoActivateAfterDeleteRef.current) return;
		setActiveRowId(normalizedItems[0]?.id ?? null);
	}, [activeRowId, isCoarsePointer, mobileKeyboardOpen, normalizedItems]);

	React.useLayoutEffect(() => {
		resizeTitleField();
	}, [resizeTitleField, title]);

	React.useEffect(() => {
		const rafId = window.requestAnimationFrame(() => {
			const field = titleInputRef.current;
			if (!field) return;
			resizeTitleField();
			field.focus();
			const caret = field.value.length;
			field.setSelectionRange(caret, caret);
		});
		return () => window.cancelAnimationFrame(rafId);
	}, [resizeTitleField]);

	const handleCreateUrlPreview = React.useCallback((): void => {
		const next = window.prompt(t('links.prompt'), 'https://');
		if (!next) return;
		setPreviewLinks((current) => mergeNotePreviewLinkInputs(current, next));
		props.onShowBriefDialog?.(t('links.addedToast'));
	}, [props.onShowBriefDialog, t]);
	const renderMediaDockPanel = React.useCallback((): React.JSX.Element => {
		if (mediaDockTab === 2) return <DocumentsPanel showComingSoonPlaceholder />;
		return <div className={styles.mediaPanelPlaceholder} aria-hidden="true" />;
	}, [mediaDockTab]);
	const mediaSheetVisualProgress = clampMediaSheetProgress(mediaSheetProgress);
	const isMediaSheetActive = mediaSheetVisualProgress > 0.001 || isMediaSheetClosing;
	const mediaSheetStyle = React.useMemo(() => ({
		'--media-sheet-open-progress': mediaSheetVisualProgress.toFixed(4),
		pointerEvents: 'auto',
	} as React.CSSProperties & Record<string, string>), [mediaSheetVisualProgress]);
	const isMediaDockVisible = isCoarsePointer ? isMediaSheetActive : mediaDockOpen;
	const updateActiveRowHistoryState = React.useCallback((editor: Editor | null): void => {
		if (!editor) {
			setActiveRowHistoryState((prev) => (prev.canUndo || prev.canRedo ? { canUndo: false, canRedo: false } : prev));
			return;
		}
		let canUndo = false;
		let canRedo = false;
		try {
			const canApi = editor.can() as { undo?: () => boolean; redo?: () => boolean };
			canUndo = typeof canApi.undo === 'function' ? Boolean(canApi.undo()) : false;
			canRedo = typeof canApi.redo === 'function' ? Boolean(canApi.redo()) : false;
		} catch {
			canUndo = false;
			canRedo = false;
		}
		setActiveRowHistoryState((prev) => (prev.canUndo === canUndo && prev.canRedo === canRedo
			? prev
			: { canUndo, canRedo }));
	}, []);
	React.useEffect(() => {
		if (!activeRowEditor) {
			updateActiveRowHistoryState(null);
			return;
		}
		const handleHistoryChange = (): void => {
			updateActiveRowHistoryState(activeRowEditor);
		};
		handleHistoryChange();
		activeRowEditor.on('transaction', handleHistoryChange);
		activeRowEditor.on('selectionUpdate', handleHistoryChange);
		activeRowEditor.on('focus', handleHistoryChange);
		activeRowEditor.on('blur', handleHistoryChange);
		return () => {
			activeRowEditor.off('transaction', handleHistoryChange);
			activeRowEditor.off('selectionUpdate', handleHistoryChange);
			activeRowEditor.off('focus', handleHistoryChange);
			activeRowEditor.off('blur', handleHistoryChange);
		};
	}, [activeRowEditor, updateActiveRowHistoryState]);

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

	const addItem = React.useCallback((index?: number, seed?: Partial<DraftChecklistItem>): void => {
		const nextId = makeId();
		suppressAutoActivateAfterDeleteRef.current = false;
		setItems((prev) => {
			const next = prev.slice();
			const insertAt = typeof index === 'number' ? Math.max(0, Math.min(prev.length, index + 1)) : prev.length;
			next.splice(insertAt, 0, {
				id: nextId,
				text: seed?.text ?? '',
				completed: seed?.completed ?? false,
				parentId: seed?.parentId ?? null,
				countValue: seed?.countValue ?? null,
				richContent: seed?.richContent ?? createRichTextDocFromPlainText(''),
			});
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
				(next.countValue ?? null) === (current.countValue ?? null) &&
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

	const CHECKBOX_UNDO_LIMIT = 40;

	const pushChecklistUndoSnapshot = React.useCallback((snapshot: DraftChecklistItem[]): void => {
		checkboxUndoStack.current = [
			...checkboxUndoStack.current.slice(-(CHECKBOX_UNDO_LIMIT - 1)),
			snapshot,
		];
		checkboxRedoStack.current = [];
		setCheckboxUndoAvail(true);
		setCheckboxRedoAvail(false);
	}, []);

	const toggleCompleted = React.useCallback((id: string, checked: boolean): void => {
		prepareRowFocusHandoff();
		setItems((prev) => {
			const next = reconcileDraftItems(toggleChecklistItemCompleted(prev, id, checked), prev);
			if (next === prev) return prev;
			pushChecklistUndoSnapshot(prev);
			return next;
		});
	}, [prepareRowFocusHandoff, pushChecklistUndoSnapshot]);

	const undoCheckboxChange = React.useCallback((): void => {
		const snapshot = checkboxUndoStack.current[checkboxUndoStack.current.length - 1];
		if (!snapshot) return;
		prepareRowFocusHandoff();
		checkboxUndoStack.current = checkboxUndoStack.current.slice(0, -1);
		setItems((prev) => {
			checkboxRedoStack.current = [...checkboxRedoStack.current, prev];
			return snapshot;
		});
		setCheckboxUndoAvail(checkboxUndoStack.current.length > 0);
		setCheckboxRedoAvail(true);
	}, [prepareRowFocusHandoff]);

	const redoCheckboxChange = React.useCallback((): void => {
		const snapshot = checkboxRedoStack.current[checkboxRedoStack.current.length - 1];
		if (!snapshot) return;
		prepareRowFocusHandoff();
		checkboxRedoStack.current = checkboxRedoStack.current.slice(0, -1);
		setItems((prev) => {
			checkboxUndoStack.current = [...checkboxUndoStack.current, prev];
			return snapshot;
		});
		setCheckboxUndoAvail(true);
		setCheckboxRedoAvail(checkboxRedoStack.current.length > 0);
	}, [prepareRowFocusHandoff]);

	// Keyboard shortcut: Ctrl/Cmd+Z undoes last checkbox change; Ctrl/Cmd+Shift+Z
	// or Ctrl+Y redoes it. Only intercepts when focus is inside the checklist form.
	React.useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent): void => {
			const modKey = e.metaKey || e.ctrlKey;
			if (!modKey) return;
			const form = checklistFormRef.current;
			if (!form || !form.contains(document.activeElement)) return;
			const active = document.activeElement;
			const inEditor = active instanceof HTMLElement && active.isContentEditable;
			if (inEditor) return;
			if (e.key === 'z' && !e.shiftKey && checkboxUndoStack.current.length > 0) {
				e.preventDefault();
				undoCheckboxChange();
			} else if ((e.key === 'z' && e.shiftKey || e.key === 'y') && checkboxRedoStack.current.length > 0) {
				e.preventDefault();
				redoCheckboxChange();
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [undoCheckboxChange, redoCheckboxChange]);

	const removeItem = React.useCallback((id: string, options?: { preserveKeyboard?: boolean }): void => {
		if (options?.preserveKeyboard !== false) {
			prepareRowFocusHandoff();
		}
		setItems((prev) => {
			const normalized = normalizeChecklistHierarchy(prev);
			if (normalized.length <= 1) return prev;
			const firstActiveId = normalized.find((row) => !row.completed)?.id ?? normalized[0]?.id ?? null;
			if (firstActiveId && id === firstActiveId) return prev;
			const next = reconcileDraftItems(removeChecklistItemWithChildren(prev, id), prev);
			if (next === prev) return prev;
			pushChecklistUndoSnapshot(prev);
			return next;
		});
	}, [prepareRowFocusHandoff, pushChecklistUndoSnapshot]);

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
		(rowId: string, editor?: Editor): void => {
			if (editor) {
				const split = splitMinimalRichTextAtSelection(editor);
				latestRowPayloadRef.current = { id: rowId, text: split.beforeText, richContent: split.before };
				updateItem(rowId, { text: split.beforeText, richContent: split.before });
				const currentRow = items.find((row) => row.id === rowId) ?? null;
				addItem(items.findIndex((row) => row.id === rowId), {
					text: split.afterText,
					completed: false,
					parentId: currentRow?.parentId ?? null,
					countValue: currentRow?.countValue != null ? 1 : null,
					richContent: split.after,
				});
				return;
			}
			const currentIndex = items.findIndex((row) => row.id === rowId);
			addItem(currentIndex === -1 ? undefined : currentIndex);
		},
		[addItem, items, updateItem]
	);
	const acceptAutocompleteSuggestion = React.useCallback((rowId: string, suggestion: string): void => {
		const currentRow = items.find((row) => row.id === rowId) ?? null;
		const richContent = createRichTextDocFromPlainText(suggestion);
		latestRowPayloadRef.current = { id: rowId, text: suggestion, richContent };
		setActiveRowAutocompleteText(suggestion);
		updateItem(rowId, { text: suggestion, richContent });
		if (activeRowId !== rowId) {
			setActiveRowId(rowId);
		}
		if (focusRowId !== rowId) {
			setFocusRowId(rowId);
		}
	}, [activeRowId, focusRowId, items, updateItem]);

	const activeRowItem = React.useMemo(
		() => items.find((item) => item.id === activeRowId) ?? null,
		[activeRowId, items]
	);
	React.useEffect(() => {
		if (!activeRowId) {
			setActiveRowAutocompleteText('');
			return;
		}
		setActiveRowAutocompleteText(
			activeRowItem
				? String(activeRowItem.text ?? '').trim().length > 0
					? activeRowItem.text
					: getPlainTextFromRichJson(activeRowItem.richContent, 'minimal')
				: ''
		);
	}, [activeRowId, activeRowItem]);
	// Suggestions must only ever appear because the user typed something this focus
	// session — never merely from placing the caret in a row that already happens to
	// be a prefix of another item. Reset on its own effect keyed only on `activeRowId`
	// (not `activeRowItem`, which gets a new reference on every keystroke and would
	// otherwise immediately re-flip this back to false right after typing sets it true).
	const [hasTypedSinceFocus, setHasTypedSinceFocus] = React.useState(false);
	React.useEffect(() => {
		setHasTypedSinceFocus(false);
	}, [activeRowId]);
	const activeRowAutocompleteSuggestion = React.useMemo(
		() => hasTypedSinceFocus ? getChecklistAutocompleteSuggestion(items, activeRowId, activeRowAutocompleteText) : '',
		[hasTypedSinceFocus, activeRowAutocompleteText, activeRowId, items]
	);
	const activeRowAutocompleteSuffix = React.useMemo(() => {
		if (!activeRowAutocompleteSuggestion) return '';
		const typed = String(activeRowAutocompleteText ?? '');
		if (!typed) return '';
		return activeRowAutocompleteSuggestion.toLowerCase().startsWith(typed.toLowerCase())
			? activeRowAutocompleteSuggestion.slice(typed.length)
			: '';
	}, [activeRowAutocompleteSuggestion, activeRowAutocompleteText]);
	// Enter always creates the next item — it no longer doubles as an autocomplete
	// accept gesture. Overloading it meant Enter's behavior silently depended on
	// whether a suggestion happened to be showing, which wasn't predictable.
	const handleChecklistRowEnter = React.useCallback((rowId: string, editor: Editor): void => {
		insertItemAfter(rowId, editor);
	}, [insertItemAfter]);
	// Accept gestures: Tab (desktop — takes priority over the existing indent
	// behavior only while a suggestion is showing) and tapping/clicking the ghost
	// suggestion text itself (both platforms; the primary path on mobile, where
	// there's no Tab key). A plain click/tap anywhere else in the row no longer
	// accepts anything — that used to mean just repositioning the caret could
	// silently rewrite the row's text.
	const handleAcceptActiveAutocomplete = React.useCallback((rowId: string): boolean => {
		if (rowId !== activeRowId || !activeRowAutocompleteSuggestion) return false;
		acceptAutocompleteSuggestion(rowId, activeRowAutocompleteSuggestion);
		return true;
	}, [acceptAutocompleteSuggestion, activeRowAutocompleteSuggestion, activeRowId]);
	// Geometric hit-test instead of relying on CSS pointer-events to carve a
	// clickable hole out of the (pointer-events:none, -webkit-line-clamp'd) ghost
	// overlay — that didn't reliably receive clicks/taps in practice across
	// browsers. The row shell always receives the click normally; we just check
	// whether it landed at or past where the suggestion begins.
	// The target is deliberately generous — from the suggestion's left edge to the
	// end of the row, across the row's full height — rather than the suggestion
	// text's own tight glyph bounds. A one- or two-character suggestion is a
	// hopeless tap target otherwise; nothing meaningful sits in that trailing
	// space anyway, so widening the zone costs nothing.
	const isAutocompleteAcceptHit = React.useCallback((
		event: { clientX: number; clientY: number; currentTarget: EventTarget & HTMLDivElement },
		rowId: string
	): boolean => {
		if (rowId !== activeRowId || !activeRowAutocompleteSuggestion) return false;
		const suffixEl = activeAutocompleteSuffixRef.current;
		if (!suffixEl) return false;
		const suffixRect = suffixEl.getBoundingClientRect();
		const shellRect = event.currentTarget.getBoundingClientRect();
		return !(event.clientX < suffixRect.left || event.clientY < shellRect.top || event.clientY > shellRect.bottom);
	}, [activeRowAutocompleteSuggestion, activeRowId]);
	const handleRowShellClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>, rowId: string): void => {
		if (!isAutocompleteAcceptHit(event, rowId) || !activeRowAutocompleteSuggestion) return;
		event.preventDefault();
		acceptAutocompleteSuggestion(rowId, activeRowAutocompleteSuggestion);
	}, [acceptAutocompleteSuggestion, activeRowAutocompleteSuggestion, isAutocompleteAcceptHit]);
	// Mirrors handleRowShellClick's own hit-test on mousedown/pointerdown — a
	// long ghost suggestion can wrap across the -webkit-line-clamp:2 overlay
	// (short single-line suggestions never do), and the browser's default
	// "focus whatever you just pressed" behavior on that tap can blur the
	// TipTap editor and dismiss the keyboard before the click handler above
	// ever runs its own preventDefault() — by then it's too late, the keyboard
	// is already gone. Same fix as the drag handle / checkbox / remove / save
	// button guards elsewhere in this file, just gated on the same geometry
	// check instead of covering the whole shell (a blanket guard here would
	// also block normal caret-placement clicks in the row).
	const preventSuggestionAcceptFocusSteal = React.useCallback((
		event: React.SyntheticEvent<HTMLDivElement> & { clientX: number; clientY: number },
		rowId: string
	): void => {
		if (isAutocompleteAcceptHit(event, rowId)) {
			event.preventDefault();
		}
	}, [isAutocompleteAcceptHit]);
	const activeCountItem = React.useMemo(
		() => activeRowItem && isChecklistCountItem(activeRowItem) ? activeRowItem : null,
		[activeRowItem]
	);
	const makeActiveCountItem = React.useCallback((): void => {
		if (!activeRowItem || isChecklistCountItem(activeRowItem)) return;
		updateItem(activeRowItem.id, { countValue: 1 });
	}, [activeRowItem, updateItem]);
	const incrementActiveCountItem = React.useCallback((): void => {
		if (!activeCountItem || !isChecklistCountItem(activeCountItem)) return;
		updateItem(activeCountItem.id, { countValue: (getChecklistCountValue(activeCountItem) ?? 1) + 1 });
	}, [activeCountItem, updateItem]);
	const decrementActiveCountItem = React.useCallback((): void => {
		if (!activeCountItem || !isChecklistCountItem(activeCountItem)) return;
		const currentCountValue = getChecklistCountValue(activeCountItem) ?? 1;
		updateItem(activeCountItem.id, { countValue: currentCountValue > 1 ? currentCountValue - 1 : null });
	}, [activeCountItem, updateItem]);
	const removeActiveCountItem = React.useCallback((): void => {
		if (!activeCountItem) return;
		updateItem(activeCountItem.id, { countValue: null });
	}, [activeCountItem, updateItem]);

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
			await props.onSave({ title, items: prunedItems, previewLinks });
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
			if (activeRowId === id) {
				removeItemAndFocus(id);
				return;
			}
			removeItem(id);
		},
		[activeRowId, removeItem, removeItemAndFocus]
	);

	const renderChecklistClone = React.useCallback(
		(
			dragProvided: import('@hello-pangea/dnd').DraggableProvided,
			snapshot: import('@hello-pangea/dnd').DraggableStateSnapshot,
			rubric: import('@hello-pangea/dnd').DraggableRubric
		): React.JSX.Element => {
			const dragged = activeItems.find((item) => item.id === rubric.draggableId) ?? null;
			const { rowWidth, rowHeight, textHeight, textWidth } = dragGhostMetricsRef.current;
			const richPreview = dragged ? renderRichPreview(dragged.richContent, liveAvatarLookup) : null;
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
						...(snapshot.isDropAnimating ? {
							transitionDuration: '180ms',
							transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
						} : null),
						width: rowWidth ?? undefined,
						minHeight: rowHeight ?? undefined,
						boxSizing: 'border-box',
					}}
				>
					<button type="button" className={styles.dragHandle} aria-label={t('editors.dragHandle')} {...dragProvided.dragHandleProps}>
						<FontAwesomeIcon icon={faGripVertical} />
					</button>
					{/* Wrapped in the same .checklistCheckboxHitArea label as the live row —
					    the CSS positions the checkbox differently depending on whether that
					    wrapper is present, so a bare <input> here shifted position vs. the
					    live row and snapped back on drop. */}
					<label className={styles.checklistCheckboxHitArea} aria-hidden="true">
						<input type="checkbox" className={styles.checklistCheckbox} checked={Boolean(dragged?.completed)} readOnly />
					</label>
					{isActiveClone ? (
						<div className={styles.checklistRowRichShell}>
							{dragged ? <span className={styles.checklistCountPrefix} aria-hidden="true">{getChecklistCountPrefix(dragged)}</span> : null}
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
							{dragged ? renderChecklistPreviewContent(dragged, previewContent) : previewContent}
						</div>
					)}
					<button type="button" className={styles.rowRemoveButton} aria-hidden="true" tabIndex={-1} disabled>
						×
					</button>
				</li>
			);
		},
		[activeItems, activeRowId, isCoarsePointer, liveAvatarLookup, t]
	);
	const addItemLabel = t('editors.addItem');

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
	const canRunPrimaryUndo = activeRowHistoryState.canUndo || checkboxUndoAvail;
	const canRunPrimaryRedo = activeRowHistoryState.canRedo || checkboxRedoAvail;
	const handlePrimaryUndo = React.useCallback((): void => {
		if (activeRowHistoryState.canUndo && activeRowEditor) {
			try {
				const chain = activeRowEditor.chain().focus() as { undo?: () => { run: () => boolean } };
				if (typeof chain.undo === 'function') {
					chain.undo().run();
				}
				return;
			} catch {
				// Ignore transient row editor teardown while the mobile footer is animating.
			}
		}
		if (checkboxUndoAvail) {
			undoCheckboxChange();
		}
	}, [activeRowEditor, activeRowHistoryState.canUndo, checkboxUndoAvail, undoCheckboxChange]);
	const handlePrimaryRedo = React.useCallback((): void => {
		if (activeRowHistoryState.canRedo && activeRowEditor) {
			try {
				const chain = activeRowEditor.chain().focus() as { redo?: () => { run: () => boolean } };
				if (typeof chain.redo === 'function') {
					chain.redo().run();
				}
				return;
			} catch {
				// Ignore transient row editor teardown while the mobile footer is animating.
			}
		}
		if (checkboxRedoAvail) {
			redoCheckboxChange();
		}
	}, [activeRowEditor, activeRowHistoryState.canRedo, checkboxRedoAvail, redoCheckboxChange]);
	// Mobile checklist undo/redo mirrors the toolbar's primary history buttons:
	// active row text edits take priority, with checklist item mutations as fallback.
	// Keep the footer actions visible while typing so checklist text history remains
	// reachable from the bottom dock, not just the floating toolbar.
	const showMobileChecklistUndoFab = isCoarsePointer
		&& !isMoreMenuOpen
		&& (canRunPrimaryUndo || canRunPrimaryRedo);

	return (
		<div
			className={styles.fullscreenOverlay}
			role="presentation"
			onPointerDownCapture={handleOverlayBackdropPressStart}
			onMouseDownCapture={handleOverlayBackdropPressStart}
			onClick={handleOverlayBackdropClick}
		>
			<form
				ref={checklistFormRef}
				onSubmit={onSubmit}
				className={`${styles.fullscreenEditor} ${styles.editorContainer} ${styles.editorBlurred}${isMediaDockVisible ? ` ${styles.mediaOpen}` : ''}${interactionGuardActive ? ` ${styles.editorInteractionGuardActive}` : ''}${isCoarsePointer ? ` ${styles.mobileHideToolbar}` : ''}`}
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
					autoComplete="off"
					data-bwignore="true"
					data-lpignore="true"
					data-1p-ignore="true"
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
				<textarea
					name="checklist-note-title"
					autoComplete="off"
					autoCorrect="off"
					autoCapitalize="sentences"
					spellCheck={false}
					data-bwignore="true"
					data-lpignore="true"
					data-1p-ignore="true"
					className={styles.editorTitleInput}
					ref={titleInputRef}
					rows={1}
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					onInput={resizeTitleField}
					onKeyDown={(event) => {
						if (event.key !== 'Enter') return;
						event.preventDefault();
						// Arm the activeRowEditor effect so focus transfers via
						// editor.commands.focus() once TipTap is ready.
						needsFocusAfterTitleEnterRef.current = true;
						// Explicit blur before activation so the title textarea doesn't
						// compete with the contenteditable for focus.
						titleInputRef.current?.blur();
						if (latestItemsRef.current.length === 0) {
							addItem();
						} else {
							focusFirstChecklistItem();
						}
					}}
					placeholder={t('editors.titlePlaceholder')}
				/>

				<section aria-label="Checklist" className={`${styles.editorContainer} ${styles.checklistEditorSection}`}>
					<div className={styles.checklistToolbarSlot}>
						<RichTextToolbar editor={activeRowEditor} variant="minimal" compact toolbarMode={props.toolbarMode} hideStrikeButton applyInlineFormattingToWholeEditor preferEditorUndoRedo onCreateUrlPreview={handleCreateUrlPreview} noteAutoScrollEnabled={noteAutoScrollEnabled} onToggleNoteAutoScroll={handleToggleNoteAutoScroll} onUndoCheckbox={undoCheckboxChange} onRedoCheckbox={redoCheckboxChange} checkboxUndoAvail={checkboxUndoAvail} checkboxRedoAvail={checkboxRedoAvail} onMakeChecklistCount={activeRowItem && !isChecklistCountItem(activeRowItem) ? makeActiveCountItem : undefined} onIncrementChecklistCount={activeCountItem ? incrementActiveCountItem : undefined} onDecrementChecklistCount={activeCountItem ? decrementActiveCountItem : undefined} onRemoveChecklistCount={activeCountItem ? removeActiveCountItem : undefined} />
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
											<div className={styles.checklistComposerActions}>
												<div className={styles.checklistComposerAction}>
													<input type="checkbox" className={styles.checklistCheckbox} checked={false} readOnly tabIndex={-1} aria-hidden="true" />
													<button
														type="button"
														className={styles.checklistAddItemButton}
														onClick={() => addItem()}
														aria-label={addItemLabel}
													>
														{addItemLabel}
													</button>
												</div>
											</div>
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
														className={`${styles.checklistItem}${item.completed ? ` ${styles.checklistItemCompleted}` : ''}${activeRowId === item.id ? ` ${styles.checklistItemActive}` : ''}${quickDeleteVisible ? ` ${styles.checklistItemQuickDelete}` : ''}${item.parentId ? ` ${styles.childRow}` : ''}${snapshot.isDragging || (draggingParentId !== null && item.parentId === draggingParentId) ? ` ${styles.rowDragging}` : ''}${draggingParentId !== null && item.parentId === draggingParentId ? ` ${styles.childDraggingWithParent} ${styles.childHiddenDuringParentDrag}` : ''}`}
													aria-label={t('editors.dragHandle')}
													style={{
														...dragStyle,
														...(snapshot.isDropAnimating ? {
															transitionDuration: '180ms',
															transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
														} : null),
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
													<label className={styles.checklistCheckboxHitArea} aria-label={item.completed ? 'Completed' : 'Not completed'}>
														<input
															type="checkbox"
															className={styles.checklistCheckbox}
															checked={item.completed}
															onMouseDown={preventHandleFocusSteal}
															onPointerDown={preventHandleFocusSteal}
															onChange={(event) => toggleCompleted(item.id, event.target.checked)}
														/>
													</label>
													{activeRowId === item.id ? (
														<div
															ref={(node) => { rowInputsRef.current.set(item.id, node); }}
															className={styles.checklistRowRichShell}
															onMouseDown={(event) => preventSuggestionAcceptFocusSteal(event, item.id)}
															onPointerDown={(event) => preventSuggestionAcceptFocusSteal(event, item.id)}
															onClick={(event) => handleRowShellClick(event, item.id)}
														>
															{getChecklistCountPrefix(item) ? <span className={styles.checklistCountPrefix} aria-hidden="true">{getChecklistCountPrefix(item)}</span> : null}
															<div className={styles.checklistRowRichStack}>
																<RichTextEditor
																	key={item.id}
																	variant="minimal"
																	emitInitialChange={false}
																	content={item.richContent}
																	placeholder={t('editors.checklistItemPlaceholder')}
																	hideToolbar
																	autoFocus={focusRowId === item.id}
																	caretVisibilityBottomInset={mobileKeyboardOpen ? keyboardVisibilityPaddingPx : 0}
																	viewportClassName={styles.checklistRowRichViewport}
																	contentClassName={styles.checklistRowRichEditor}
																	onEditorChange={setActiveRowEditor}
																	onChange={(payload) => {
																		// Signal-only compatibility branch:
																		// `RichTextEditor` can emit undefined payloads in lightweight mode.
																		// This draft editor still requests full payloads, so guard defensively.
																		if (!payload) return;
																		const plainText = getPlainTextFromRichJson(payload.json, 'minimal');
																		latestRowPayloadRef.current = { id: item.id, text: plainText, richContent: payload.json };
																		setActiveRowAutocompleteText(plainText);
																		setHasTypedSinceFocus(true);
																		updateItem(item.id, { text: plainText, richContent: payload.json });
																	}}
																	onEnter={(editor) => handleChecklistRowEnter(item.id, editor)}
																	onShiftEnter={() => undefined}
																	onBackspaceWhenEmpty={() => {
																		if (activeItems[0]?.id === item.id) return;
																		removeItemAndFocus(item.id);
																	}}
																	onArrowUpAtBoundary={isCoarsePointer ? undefined : () => moveFocusToAdjacentRow(item.id, 'previous')}
																	onArrowDownAtBoundary={isCoarsePointer ? undefined : () => moveFocusToAdjacentRow(item.id, 'next')}
																	onTabAcceptSuggestion={() => handleAcceptActiveAutocomplete(item.id)}
																	authUserId={props.authUserId}
																/>
																{activeRowId === item.id && activeRowAutocompleteSuffix ? (
																	<div className={styles.checklistAutocompleteOverlay}>
																		<span className={styles.checklistAutocompletePrefix} aria-hidden="true">{activeRowAutocompleteText}</span>
																		<span
																			ref={activeAutocompleteSuffixRef}
																			className={styles.checklistAutocompleteSuffix}
																			title={t('editors.acceptAutocompleteSuggestion')}
																			aria-hidden="true"
																		>
																			{activeRowAutocompleteSuffix}
																		</span>
																	</div>
																) : null}
															</div>
														</div>
													) : (
														<div ref={(node) => { rowInputsRef.current.set(item.id, node); }} className={styles.checklistRowPreview} onClick={() => activateRow(item.id)}>
															{renderChecklistPreviewContent(item, renderRichPreview(item.richContent, liveAvatarLookup) || item.text || '\u00A0')}
														</div>
													)}
													<button
														type="button"
														className={styles.rowRemoveButton}
														onMouseDown={preventHandleFocusSteal}
														onPointerDown={preventHandleFocusSteal}
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
					{activeItems.length > 0 ? (
						<ul className={styles.checklistComposer}>
							<li className={styles.checklistComposerRow}>
								<div className={styles.dragHandle} aria-hidden="true" />
								<div className={styles.checklistComposerActions}>
									<div className={styles.checklistComposerAction}>
										<input type="checkbox" className={styles.checklistCheckbox} checked={false} readOnly tabIndex={-1} aria-hidden="true" />
										<button
											type="button"
											className={styles.checklistAddItemButton}
											onClick={() => addItem()}
											aria-label={addItemLabel}
										>
											{addItemLabel}
										</button>
									</div>
								</div>
							</li>
						</ul>
					) : null}
					

				{completedItems.length > 0 ? (
					<section ref={completedSectionRef} className={styles.completedSection}>
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
								{completedRows.map(({ kind, item }) => kind === 'ghost' ? (
											<li key={`ghost-${item.id}`}
												className={`${styles.checklistItem} ${styles.checklistGhostItem}`}
												aria-hidden="true">
											<div className={`${styles.dragHandle} ${styles.dragHandleNonDraggable}`} aria-hidden="true" />
										<label className={styles.checklistCheckboxHitArea}>
											<input type="checkbox" className={styles.checklistCheckbox} checked={false} disabled readOnly tabIndex={-1} />
										</label>
										<div className={styles.checklistRowPreview}>
											{renderChecklistPreviewContent(item, renderRichPreview(item.richContent, liveAvatarLookup) || item.text || '\u00A0')}
										</div>
									</li>
								) : (
											<li key={item.id} className={`${styles.checklistItem}${item.completed ? ` ${styles.checklistItemCompleted}` : ''}${activeRowId === item.id ? ` ${styles.checklistItemActive}` : ''}${quickDeleteVisible ? ` ${styles.checklistItemQuickDelete}` : ''}${item.parentId ? ` ${styles.childRow}` : ''}`}>
											<div className={`${styles.dragHandle} ${styles.dragHandleNonDraggable}`} aria-hidden="true">
													<FontAwesomeIcon icon={faGripVertical} />
											</div>
										<label className={styles.checklistCheckboxHitArea} aria-label={item.completed ? 'Completed' : 'Not completed'}>
											<input
												type="checkbox"
												className={styles.checklistCheckbox}
												checked={item.completed}
												onMouseDown={preventHandleFocusSteal}
												onPointerDown={preventHandleFocusSteal}
												onChange={(event) => toggleCompleted(item.id, event.target.checked)}
											/>
										</label>
											{activeRowId === item.id ? (
																	<div
																		ref={(node) => { rowInputsRef.current.set(item.id, node); }}
																		className={styles.checklistRowRichShell}
																		onMouseDown={(event) => preventSuggestionAcceptFocusSteal(event, item.id)}
																		onPointerDown={(event) => preventSuggestionAcceptFocusSteal(event, item.id)}
																		onClick={(event) => handleRowShellClick(event, item.id)}
																	>
																		{getChecklistCountPrefix(item) ? <span className={styles.checklistCountPrefix} aria-hidden="true">{getChecklistCountPrefix(item)}</span> : null}
																	<div className={styles.checklistRowRichStack}>
																		<RichTextEditor
																			key={item.id}
																			variant="minimal"
																			emitInitialChange={false}
																			content={item.richContent}
																			placeholder={t('editors.checklistItemPlaceholder')}
																			hideToolbar
																			autoFocus={focusRowId === item.id}
																			caretVisibilityBottomInset={mobileKeyboardOpen ? keyboardVisibilityPaddingPx : 0}
																			viewportClassName={styles.checklistRowRichViewport}
																			contentClassName={styles.checklistRowRichEditor}
																			onEditorChange={setActiveRowEditor}
																			onChange={(payload) => {
																				// Same guard in completed-items branch for symmetry and safety.
																				if (!payload) return;
																				const plainText = getPlainTextFromRichJson(payload.json, 'minimal');
																				latestRowPayloadRef.current = { id: item.id, text: plainText, richContent: payload.json };
																				setActiveRowAutocompleteText(plainText);
																				setHasTypedSinceFocus(true);
																				updateItem(item.id, { text: plainText, richContent: payload.json });
																			}}
																			onEnter={(editor) => handleChecklistRowEnter(item.id, editor)}
																			onShiftEnter={() => undefined}
																			onBackspaceWhenEmpty={() => {
																				if (activeItems[0]?.id === item.id) return;
																				removeItem(item.id);
																			}}
																			onArrowUpAtBoundary={isCoarsePointer ? undefined : () => moveFocusToAdjacentRow(item.id, 'previous')}
																			onArrowDownAtBoundary={isCoarsePointer ? undefined : () => moveFocusToAdjacentRow(item.id, 'next')}
																			onTabAcceptSuggestion={() => handleAcceptActiveAutocomplete(item.id)}
																			authUserId={props.authUserId}
																		/>
																		{activeRowId === item.id && activeRowAutocompleteSuffix ? (
																			<div className={styles.checklistAutocompleteOverlay}>
																				<span className={styles.checklistAutocompletePrefix} aria-hidden="true">{activeRowAutocompleteText}</span>
																				<span
																					ref={activeAutocompleteSuffixRef}
																					className={styles.checklistAutocompleteSuffix}
																					title={t('editors.acceptAutocompleteSuggestion')}
																					aria-hidden="true"
																				>
																					{activeRowAutocompleteSuffix}
																				</span>
																			</div>
																		) : null}
																	</div>
												</div>
													) : (
														<div ref={(node) => { rowInputsRef.current.set(item.id, node); }} className={styles.checklistRowPreview} onClick={() => activateRow(item.id)}>
															{renderChecklistPreviewContent(item, renderRichPreview(item.richContent, liveAvatarLookup) || item.text || '\u00A0')}
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
					<div className={styles.mobileChecklistMediaRow}>
						{showMobileChecklistUndoFab ? (
							<div
								className={styles.mobileChecklistUndoFabCluster}
								onPointerDown={(event) => event.stopPropagation()}
								onClick={(event) => event.stopPropagation()}
							>
								<button
									type="button"
									className={styles.mobileChecklistUndoFabButton}
									onClick={handlePrimaryUndo}
									disabled={!canRunPrimaryUndo}
									aria-label={checkboxUndoAvail ? t('editors.undoCheckbox') : t('editors.undo')}
									title={checkboxUndoAvail ? t('editors.undoCheckbox') : t('editors.undo')}
								>
									<FontAwesomeIcon icon={byPrefixAndName.fas.undo} />
								</button>
								<button
									type="button"
									className={styles.mobileChecklistUndoFabButton}
									onClick={handlePrimaryRedo}
									disabled={!canRunPrimaryRedo}
									aria-label={checkboxRedoAvail ? t('editors.redoCheckbox') : t('editors.redo')}
									title={checkboxRedoAvail ? t('editors.redoCheckbox') : t('editors.redo')}
								>
									<FontAwesomeIcon icon={byPrefixAndName.fas.redo} />
								</button>
							</div>
						) : null}
						{isCoarsePointer ? (
							<div className={`${styles.mediaDockSlot}${isMediaSheetActive ? ` ${styles.mediaDockSlotActive}` : ''}`}>
								<section
									ref={mediaSheetRef}
									className={`${styles.mediaSheet}${mediaDockOpen ? ` ${styles.mediaSheetOpen}` : ''}${isMediaSheetDragging ? ` ${styles.mediaSheetDragging}` : ''}${!isMediaSheetActive ? ` ${styles.mediaSheetClosed}` : ''}`}
									aria-label={t('editors.mediaDock')}
									style={mediaSheetStyle}
									onTransitionEnd={handleMediaSheetTransitionEnd}
									onClick={(e) => e.stopPropagation()}
								>
									<button
										type="button"
										className={styles.mediaSheetHandle}
										onClick={handleToggleMediaDock}
										onTouchStart={handleMediaDockDragStart}
										onTouchMove={handleMediaDockDragMove}
										onTouchEnd={handleMediaDockDragEnd}
										onTouchCancel={handleMediaDockDragEnd}
										aria-label={t('editors.mediaDock')}
									>
										<span className={styles.mediaDockPill} aria-hidden="true" />
										<span className={styles.mediaDockLabel}>{t('editors.mediaDockLabel')}</span>
									</button>

									<header className={styles.mediaSheetHeader}>
										<div className={styles.mediaTabs} role="tablist" aria-label={t('editors.mediaDockTabs')} onTouchStart={handleDockTabTouchStart} onTouchEnd={handleDockSwipeEnd}>
											<button
												type="button"
												role="tab"
												aria-selected={mediaDockTab === 0}
												className={`${styles.mediaTab}${mediaDockTab === 0 ? ` ${styles.mediaTabActive}` : ''}`}
												onTouchEnd={(event) => handleSelectMediaDockTabFromTouch(0, event)}
												onClick={() => setMediaDockTab(0)}
											>
												{t('editors.mediaTabMedia')}
											</button>
											<button
												type="button"
												role="tab"
												aria-selected={mediaDockTab === 1}
												className={`${styles.mediaTab}${mediaDockTab === 1 ? ` ${styles.mediaTabActive}` : ''}`}
												onTouchEnd={(event) => handleSelectMediaDockTabFromTouch(1, event)}
												onClick={() => setMediaDockTab(1)}
											>
												{t('editors.mediaTabLinks')}
											</button>
											<button
												type="button"
												role="tab"
												aria-selected={mediaDockTab === 2}
												className={`${styles.mediaTab}${mediaDockTab === 2 ? ` ${styles.mediaTabActive}` : ''}`}
												onTouchEnd={(event) => handleSelectMediaDockTabFromTouch(2, event)}
												onClick={() => setMediaDockTab(2)}
											>
												{t('editors.mediaTabDocuments')}
											</button>
										</div>
										<button
											type="button"
											className={styles.mediaSheetClose}
											onClick={() => setMediaDockOpen(false)}
											aria-label={t('common.close')}
										>
											✕
										</button>
									</header>

									<div className={styles.mediaSheetBody} onTouchStart={handleMediaSheetTouchStart} onTouchEnd={handleMediaSheetTouchEnd}>
										<div key={`media-panel-${mediaDockTab}`} className={styles.mediaPanel} role="tabpanel">
											{renderMediaDockPanel()}
										</div>
									</div>
								</section>
							</div>
						) : null}
					</div>

					<nav className={`${styles.bottomDock} ${styles.bottomDockCompact}`} aria-label={t('editors.bottomDock')} onTouchEndCapture={handleBottomDockTouchEnd}>
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
								data-checklist-editor-media-dock-trigger="true"
								onClick={() => {
									if (isMobileLandscapeRef.current) return;
									setMediaDockOpen((prev) => !prev);
								}}
								aria-label={t('editors.mediaDock')}
							>
								{t('editors.mediaDockLabel')}
							</button>
						</div>
						<div className={styles.bottomDockRightActions}>
							{!isCoarsePointer ? (
								<>
									<button
										type="button"
										className={styles.bottomDockClose}
										onClick={undoCheckboxChange}
										disabled={!checkboxUndoAvail}
										aria-label={t('editors.undoCheckbox')}
										title={t('editors.undoCheckbox')}
									>
										<span aria-hidden="true" className={`${styles.formatButtonMaskIcon} ${styles.formatButtonMaskIconUndoCheckbox}`} />
									</button>
									<button
										type="button"
										className={styles.bottomDockClose}
										onClick={redoCheckboxChange}
										disabled={!checkboxRedoAvail}
										aria-label={t('editors.redoCheckbox')}
										title={t('editors.redoCheckbox')}
									>
										<span aria-hidden="true" className={`${styles.formatButtonMaskIcon} ${styles.formatButtonMaskIconRedoCheckbox}`} />
									</button>
								</>
							) : null}
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
				ref={mediaFlyoutRef}
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
							<button
								type="button"
								role="tab"
								aria-selected={mediaDockTab === 2}
								className={`${styles.mediaTab}${mediaDockTab === 2 ? ` ${styles.mediaTabActive}` : ''}`}
								onClick={() => setMediaDockTab(2)}
							>
								{t('editors.mediaTabDocuments')}
							</button>
						</div>
						<button type="button" className={styles.mediaFlyoutClose} onClick={() => setMediaDockOpen(false)} aria-label={t('common.close')}>
							✕
						</button>
					</header>
					<div className={styles.mediaFlyoutBody}>
						<div key={`media-panel-${mediaDockTab}`} className={styles.mediaPanel} role="tabpanel">
							{renderMediaDockPanel()}
						</div>
					</div>
			</aside>
			{/* Branch: only mount the menu while open so it can lock scroll / manage history on mobile. */}
			{isMoreMenuOpen ? (
			<NoteCardMoreMenu
				noteType="checklist"
				anchorRect={moreMenuAnchorRect}
					onClose={() => {
						setIsMoreMenuOpen(false);
						setMoreMenuAnchorRect(null);
					}}
					onCheckAll={items.length > 0 ? () => {
						setItems((current) => current.map((item) => (item.completed ? item : { ...item, completed: true })));
					} : undefined}
					onUncheckAll={items.length > 0 ? () => {
						setItems((current) => current.map((item) => (!item.completed ? item : { ...item, completed: false })));
					} : undefined}
					onAddUrlPreview={() => {
						setIsMoreMenuOpen(false);
						setMoreMenuAnchorRect(null);
						handleCreateUrlPreview();
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
					<RichTextToolbar editor={activeRowEditor} variant="minimal" compact toolbarMode={props.toolbarMode} hideStrikeButton applyInlineFormattingToWholeEditor preferEditorUndoRedo onCreateUrlPreview={handleCreateUrlPreview} noteAutoScrollEnabled={noteAutoScrollEnabled} onToggleNoteAutoScroll={handleToggleNoteAutoScroll} onUndoCheckbox={undoCheckboxChange} onRedoCheckbox={redoCheckboxChange} checkboxUndoAvail={checkboxUndoAvail} checkboxRedoAvail={checkboxRedoAvail} onMakeChecklistCount={activeRowItem && !isChecklistCountItem(activeRowItem) ? makeActiveCountItem : undefined} onIncrementChecklistCount={activeCountItem ? incrementActiveCountItem : undefined} onDecrementChecklistCount={activeCountItem ? decrementActiveCountItem : undefined} onRemoveChecklistCount={activeCountItem ? removeActiveCountItem : undefined} />
				</div>
			</>,
			document.body
		) : null}
		</div>
	);
}
