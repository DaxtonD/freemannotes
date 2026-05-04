import React, { useMemo, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import {
	DragDropContext,
	Draggable,
	Droppable,
	type BeforeCapture,
	type DragStart,
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
import * as Y from 'yjs';
import { byPrefixAndName } from '../../core/byPrefixAndName';
import type { ChecklistItem } from '../../core/bindings';
import { getChecklistCountPrefix, getChecklistCountValue, isChecklistCountItem, normalizeChecklistCountValue } from '../../core/checklistCounts';
import { applyChecklistDragToItems, buildChecklistCompletedRows, normalizeChecklistHierarchy, toggleChecklistItemCompleted } from '../../core/checklistHierarchy';
import { getChecklistDragAxis, getChecklistHorizontalDirection, registerHorizontalSnapHandler, resetChecklistDragAxis } from '../../core/checklistDragState';
import { getDeviceId } from '../../core/deviceId';
import { immediateChecklistSensors } from '../../core/dndSensors';
import { useChecklistFlip } from '../../core/useChecklistFlip';
import { useI18n } from '../../core/i18n';
import { getUserNoteAutoScrollEnabled, setUserNoteAutoScrollEnabled, subscribeNoteAutoScrollPrefs } from '../../core/noteAutoScrollPreferences';
import { addNotePreviewLinkToDoc, extractNoteLinksFromDoc, removeNotePreviewLinkFromDoc } from '../../core/noteLinks';
import { readEffectiveNoteColorToken, resolveThemeNoteColorModel } from '../../core/noteColors';
import { getUserNoteColorToken, hasUserNoteColorPref, saveUserNoteColorToken, subscribeNoteColorPrefs } from '../../core/noteColorPreferences';
import { getNotePinPrefsSnapshot, resolveUserNotePinned, subscribeNotePinPrefs } from '../../core/notePinPreferences';
import {
	createRichTextDocFromPlainText,
	ensureChecklistItemRichContent,
	ensureTextNoteRichContent,
	getChecklistItemPlainText,
	getChecklistItemRichPreviewJson,
	replaceRichFragmentFromJson,
	setYTextValue,
	splitMinimalRichTextAtSelection,
	snapshotChecklistRichContent,
	syncChecklistItemPlainText,
	TEXT_NOTE_RICH_FIELD,
	RICHTEXT_INTERNAL_ORIGIN,
	syncTextNotePlainText,
} from '../../core/richText';
import type { ClipboardConversionTarget } from '../../core/clipboardConversion';
import type { EditorToolbarMode } from '../../core/deviceAppearancePreferences';
import type { ThemeId } from '../../core/theme';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import { useIsMobileLandscape } from '../../core/useIsMobileLandscape';
import { useKeyboardHeight } from '../../core/useKeyboardHeight';
import { useVisualViewportHeight } from '../../core/useVisualViewportHeight';
import { syncNoteLinksForDoc } from '../../core/noteLinkStore';
import { NoteMediaPanel } from '../NoteMedia/NoteMediaPanel';
import { NoteLinkPanel } from '../NoteLinks/NoteLinkPanel';
import { NoteColorPickerModal } from '../NoteCard/NoteColorPickerModal';
import { NoteCardMoreMenu } from '../NoteCard/NoteCardMoreMenu';
import { DocumentsPanel } from './DocumentsPanel';
import { RichTextEditor, RichTextToolbar, ensureEditorSelectionVisible, focusRichTextEditable } from './RichTextEditor';
import styles from './Editors.module.css';

export type NoteEditorProps = {
	noteId: string;
	docId: string;
	authUserId?: string | null;
	themeId: ThemeId;
	doc: Y.Doc;
	quickCreateCollectionOption?: {
		label: string;
		checked: boolean;
		onChange: (next: boolean) => void;
	};
	onClose: () => void;
	onSavePendingNew?: () => void | Promise<void>;
	onDelete: (noteId: string) => Promise<void>;
	onTogglePin?: (() => void) | undefined;
	onAddCollaborator?: () => void;
	onAddImage?: () => void;
	onAddDocument?: () => void;
	onAddReminder?: () => void;
	onAddToCollection?: () => void;
	onAddLabels?: () => void;
	onShowBriefDialog?: (message: string) => void;
	readOnly?: boolean;
	initialShowCompleted?: boolean;
	onShowCompletedChange?: (next: boolean) => void;
	allowQuickDelete?: boolean;
	toolbarMode?: EditorToolbarMode;
	/** When true, the close button always shows an X (discard) regardless of modification state. */
	isPendingNew?: boolean;
	/** When true, suppresses the floating keyboard toolbar (e.g. while the image upload modal is open). */
	hideFormattingToolbar?: boolean;
};

type NoteType = 'text' | 'checklist';

const EMPTY_ITEMS: readonly ChecklistItem[] = [];

function isMediaDockHistoryEntry(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	return typeof (value as { __noteEditorMediaDock?: unknown }).__noteEditorMediaDock === 'string';
}

function suppressNextDocumentCompatibilityMouseEvents(): void {
	if (typeof window === 'undefined') return;
	let timeoutId = 0;
	const handler = (event: MouseEvent): void => {
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
	};
	const cleanup = (): void => {
		window.removeEventListener('mousedown', handler, true);
		window.removeEventListener('mouseup', handler, true);
		window.removeEventListener('click', handler, true);
		if (timeoutId) window.clearTimeout(timeoutId);
	};
	window.addEventListener('mousedown', handler, true);
	window.addEventListener('mouseup', handler, true);
	window.addEventListener('click', handler, true);
	timeoutId = window.setTimeout(() => cleanup(), 500);
}

/**
 * Lightweight renderer for ProseMirror JSON content in non-active rows.
 * Handles bold, italic, underline, and hard breaks — no TipTap instance needed.
 */
function renderRichPreview(json: import('@tiptap/core').JSONContent | null | undefined): React.ReactNode {
	if (!json?.content) return null;
	const applyMarks = (node: import('@tiptap/core').JSONContent, content: React.ReactNode, key: React.Key): React.ReactNode => {
		let element = content;
		for (const mark of node.marks ?? []) {
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
							target="_blank"
							rel="noreferrer noopener"
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
	const elements = json.content.map((block, bi) => {
		if (block.type !== 'paragraph') return null;
		if (!block.content || block.content.length === 0) return bi > 0 ? <br key={bi} /> : null;
		hasContent = true;
		return (
			<React.Fragment key={bi}>
				{bi > 0 ? <br /> : null}
				{block.content.map((node, ni) => {
					if (node.type === 'hardBreak') return <br key={ni} />;
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

function materializeChecklistItems(yarray: Y.Array<Y.Map<any>>): readonly ChecklistItem[] {
	return yarray
		.toArray()
		.map((m) => ({
			id: String(m.get('id') ?? ''),
			text: getChecklistItemPlainText(m),
			completed: Boolean(m.get('completed')),
			parentId:
				typeof m.get('parentId') === 'string' && String(m.get('parentId')).trim().length > 0
					? String(m.get('parentId')).trim()
					: null,
			countValue: normalizeChecklistCountValue(m.get('countValue')),
		}))
		.filter((item) => item.id.length > 0);
}

function updateChecklistItemById(
	yarray: Y.Array<Y.Map<any>>,
	id: string,
	patch: Partial<Omit<ChecklistItem, 'id'>>
): void {
	const normalizedId = String(id ?? '').trim();
	if (!normalizedId) return;

	const arr = yarray.toArray();
	let idx = -1;
	for (let i = 0; i < arr.length; i++) {
		if (String(arr[i].get('id') ?? '').trim() === normalizedId) {
			idx = i;
			break;
		}
	}
	if (idx === -1) return;

	const doc = (yarray as any).doc as Y.Doc | null | undefined;
	const apply = (): void => {
		const m = yarray.get(idx);
		if (!m) return;
		if (patch.text !== undefined) m.set('text', String(patch.text));
		if (patch.completed !== undefined) m.set('completed', Boolean(patch.completed));
		if (patch.parentId !== undefined) {
			const parentId = typeof patch.parentId === 'string' ? patch.parentId.trim() : null;
			m.set('parentId', parentId && parentId.length > 0 ? parentId : null);
		}
		if (patch.countValue !== undefined) {
			m.set('countValue', normalizeChecklistCountValue(patch.countValue));
		}
	};
	if (doc) doc.transact(apply);
	else apply();
}


function findChecklistItemMapById(yarray: Y.Array<Y.Map<any>>, id: string): Y.Map<any> | null {
	for (const item of yarray.toArray()) {
		if (String(item.get('id') ?? '') === id) return item;
	}
	return null;
}

function useYTextValue(ytext: Y.Text): string {
	return useSyncExternalStore(
		(onStoreChange) => {
			const observer = (): void => onStoreChange();
			ytext.observe(observer);
			return () => ytext.unobserve(observer);
		},
		() => ytext.toString(),
		() => ytext.toString()
	);
}

// Safe optional variant used when a note mode does not expose a given Y.Text.
function useOptionalYTextValue(ytext: Y.Text | null): string {
	return useSyncExternalStore(
		(onStoreChange) => {
			if (!ytext) return () => {};
			const observer = (): void => onStoreChange();
			ytext.observe(observer);
			return () => ytext.unobserve(observer);
		},
		() => ytext?.toString() ?? '',
		() => ytext?.toString() ?? ''
	);
}

// Subscribe to metadata keys for reactive note-type rendering.
function useMetadataString(metadata: Y.Map<any>, key: string): string {
	return useSyncExternalStore(
		(onStoreChange) => {
			const observer = (): void => onStoreChange();
			metadata.observe(observer);
			return () => metadata.unobserve(observer);
		},
		() => String(metadata.get(key) ?? ''),
		() => String(metadata.get(key) ?? '')
	);
}

// Checklist subscription helper for conditional checklist notes.
function useOptionalChecklistItems(yarray: Y.Array<Y.Map<any>> | null): readonly ChecklistItem[] {
	const cacheRef = React.useRef<{
		yarray: Y.Array<Y.Map<any>> | null;
		items: readonly ChecklistItem[];
	}>(
		// Initialize with a stable empty reference so React can compare snapshots.
		{ yarray: null, items: EMPTY_ITEMS }
	);

	return useSyncExternalStore(
		(onStoreChange) => {
			if (!yarray) return () => {};
			// Prime cache on first subscription (and whenever the yarray instance changes).
			if (cacheRef.current.yarray !== yarray) {
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
			}

			const observer = (): void => {
				// Update the cached snapshot BEFORE notifying React.
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
				onStoreChange();
			};
			yarray.observeDeep(observer);
			return () => yarray.unobserveDeep(observer);
		},
		() => {
			if (!yarray) return EMPTY_ITEMS;
			if (cacheRef.current.yarray !== yarray) {
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
			}
			return cacheRef.current.items;
		},
		() => {
			if (!yarray) return EMPTY_ITEMS;
			if (cacheRef.current.yarray !== yarray) {
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
			}
			return cacheRef.current.items;
		}
	);
}

function findScrollableAncestor(node: HTMLElement | null): HTMLElement | null {
	let current = node?.parentElement ?? null;
	while (current) {
		const style = window.getComputedStyle(current);
		const overflowY = style.overflowY;
		// Ignore overflow:visible wrappers so short editors do not scroll the first
		// merely taller ancestor instead of the element that actually owns scrolling.
		const isScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
			&& current.scrollHeight > current.clientHeight + 1;
		if (isScrollable) return current;
		current = current.parentElement;
	}
	return null;
}

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

type ChecklistRowContentProps = {
	item: ChecklistItem;
	itemMap: Y.Map<any> | null;
	checklistArray: Y.Array<Y.Map<any>>;
	contentRef: (node: HTMLDivElement | null) => void;
	isActive: boolean;
	autoFocus: boolean;
	isProtectedFromEmptyBackspace: boolean;
	placeholderText: string;
	removeLabel: string;
	caretVisibilityBottomInset?: number;
	activate: (id: string) => void;
	toggleCompleted: (id: string, checked: boolean) => void;
	remove: (id: string, options?: { clearSelection?: boolean }) => void;
	insertAfter: (id: string, editor?: Editor) => void;
	setActiveEditor: (editor: Editor | null) => void;
	onArrowUpAtBoundary?: () => void;
	onArrowDownAtBoundary?: () => void;
};

const ChecklistRowContent = React.memo(function ChecklistRowContent(props: ChecklistRowContentProps): React.JSX.Element {
	const {
		item,
		itemMap,
		checklistArray,
		contentRef,
		isActive,
		autoFocus,
		isProtectedFromEmptyBackspace,
		placeholderText,
		removeLabel,
		caretVisibilityBottomInset,
		activate,
		toggleCompleted,
		remove,
		insertAfter,
		setActiveEditor,
		onArrowUpAtBoundary,
		onArrowDownAtBoundary,
	} = props;

	const handleActivate = React.useCallback((): void => {
		activate(item.id);
	}, [activate, item.id]);

	const handleToggleCompleted = React.useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
		toggleCompleted(item.id, event.target.checked);
	}, [item.id, toggleCompleted]);

	const handleRemove = React.useCallback((): void => {
		remove(item.id, { clearSelection: true });
	}, [item.id, remove]);

	const handleInsertAfter = React.useCallback((editor: Editor): void => {
		insertAfter(item.id, editor);
	}, [insertAfter, item.id]);

	if (!isActive) {
		const previewMap = itemMap ?? findChecklistItemMapById(checklistArray, item.id);
		const richPreview = renderRichPreview(previewMap ? getChecklistItemRichPreviewJson(previewMap) : null);

		return (
			<>
				<label className={styles.checklistCheckboxHitArea} aria-label={item.completed ? 'Completed' : 'Not completed'}>
					<input
						type="checkbox"
						className={styles.checklistCheckbox}
						checked={item.completed}
						onChange={handleToggleCompleted}
					/>
				</label>
				<div ref={contentRef} className={styles.checklistRowPreview} onClick={handleActivate}>
					{renderChecklistPreviewContent(item, richPreview || item.text || '\u00A0')}
				</div>
				<button
					type="button"
					className={styles.rowRemoveButton}
					onClick={handleRemove}
					aria-label={removeLabel}
					title={removeLabel}
				>
					×
				</button>
			</>
		);
	}

	const liveItemMap = itemMap ?? findChecklistItemMapById(checklistArray, item.id);
	const fragment = liveItemMap ? ensureChecklistItemRichContent(liveItemMap) : null;

	return (
		<>
			<label className={styles.checklistCheckboxHitArea} aria-label={item.completed ? 'Completed' : 'Not completed'}>
				<input
					type="checkbox"
					className={styles.checklistCheckbox}
					checked={item.completed}
					onChange={handleToggleCompleted}
				/>
			</label>
			{liveItemMap && fragment ? (
				<div ref={contentRef} className={styles.checklistRowRichShell}>
					{getChecklistCountPrefix(item) ? <span className={styles.checklistCountPrefix} aria-hidden="true">{getChecklistCountPrefix(item)}</span> : null}
					<RichTextEditor
						variant="minimal"
						fragment={fragment}
						// Mount-emission branch:
						// This row editor mounts whenever active row focus changes. We skip the
						// initial change event so row activation itself does not trigger an
						// immediate parent update.
						emitInitialChange={false}
						// Serialization branch:
						// For Yjs-backed checklist rows we do not need JSON/text payloads from
						// TipTap on each keystroke. We can sync plain text from the shared
						// fragment directly, so signal-only updates are cheaper.
						serializeChangePayload={false}
						placeholder={placeholderText}
						hideToolbar
						autoFocus={autoFocus}
						caretVisibilityBottomInset={caretVisibilityBottomInset}
						containerClassName={styles.checklistRowRichStack}
						viewportClassName={styles.checklistRowRichViewport}
						contentClassName={styles.checklistRowRichEditor}
						onEditorChange={setActiveEditor}
						onChange={() => {
							syncChecklistItemPlainText(liveItemMap, fragment);
						}}
						onEnter={handleInsertAfter}
						onShiftEnter={() => undefined}
						onBackspaceWhenEmpty={() => {
							if (isProtectedFromEmptyBackspace) return;
							remove(item.id);
						}}
						onArrowUpAtBoundary={onArrowUpAtBoundary}
						onArrowDownAtBoundary={onArrowDownAtBoundary}
					/>
				</div>
			) : (
				<div ref={contentRef} className={styles.checklistRowPreview} onClick={handleActivate}>
					{renderChecklistPreviewContent(item, item.text || '\u00A0')}
				</div>
			)}
			<button
				type="button"
				className={styles.rowRemoveButton}
				onClick={handleRemove}
				aria-label={removeLabel}
				title={removeLabel}
			>
				×
			</button>
		</>
	);
}, (prev, next) => (
	prev.item === next.item &&
	prev.itemMap === next.itemMap &&
	prev.checklistArray === next.checklistArray &&
	// contentRef is a side-effect ref callback — skip comparison to avoid
	// defeating memoization when the parent creates a new closure per render.
	prev.isActive === next.isActive &&
	prev.autoFocus === next.autoFocus &&
	prev.isProtectedFromEmptyBackspace === next.isProtectedFromEmptyBackspace &&
	prev.placeholderText === next.placeholderText &&
	prev.removeLabel === next.removeLabel &&
	prev.activate === next.activate &&
	prev.toggleCompleted === next.toggleCompleted &&
	prev.remove === next.remove &&
	prev.insertAfter === next.insertAfter &&
	prev.setActiveEditor === next.setActiveEditor &&
	prev.onArrowUpAtBoundary === next.onArrowUpAtBoundary &&
	prev.onArrowDownAtBoundary === next.onArrowDownAtBoundary
));

export function NoteEditor(props: NoteEditorProps): React.JSX.Element {
	const getInitialInteractionGuardState = (): boolean => {
		return false;
	};
	const { t } = useI18n();
	const readOnly = props.readOnly === true;
	const keyboardVisibilityPaddingPx = 88;
	const [isModified, setIsModified] = React.useState(false);
	const [mediaDockOpen, setMediaDockOpen] = React.useState(() => {
		try { return sessionStorage.getItem('__freemannotes_mediaDockOpen') === '1'; } catch { return false; }
	});
	const [mediaDockTab, setMediaDockTab] = React.useState<0 | 1 | 2>(0);
	// More-menu state (editor 3-dot button):
	// - Desktop: anchored popover positioned relative to the trigger button rect.
	// - Mobile: bottom sheet menu (anchor rect is ignored).
	const [isMoreMenuOpen, setIsMoreMenuOpen] = React.useState(false);
	const [moreMenuAnchorRect, setMoreMenuAnchorRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);
	const [isColorPickerOpen, setIsColorPickerOpen] = React.useState(false);
	const titleFieldRef = React.useRef<HTMLTextAreaElement | null>(null);
	const textBodyFieldRef = React.useRef<HTMLDivElement | null>(null);
	const resizeTitleField = React.useCallback((): void => {
		const field = titleFieldRef.current;
		if (!field) return;
		field.style.height = '0px';
		field.style.height = `${Math.max(36, field.scrollHeight)}px`;
	}, []);
	const [interactionGuardActive, setInteractionGuardActive] = React.useState<boolean>(getInitialInteractionGuardState);
	const isCoarsePointer = useIsCoarsePointer();
	const quickDeleteVisible = Boolean(props.allowQuickDelete) && isCoarsePointer;

	React.useEffect(() => {
		try { sessionStorage.setItem('__freemannotes_mediaDockOpen', mediaDockOpen ? '1' : '0'); } catch { /* */ }
	}, [mediaDockOpen]);
	// Keep the dock tabs driven by the live Yjs doc so link chips, link previews,
	// and browser modals stay in sync without forcing the editor to own extra copy state.
	const extractedLinks = useSyncExternalStore(
		(onStoreChange) => {
			const observer = (): void => onStoreChange();
			props.doc.on('afterTransaction', observer);
			return () => props.doc.off('afterTransaction', observer);
		},
		() => extractNoteLinksFromDoc(props.doc),
		() => extractNoteLinksFromDoc(props.doc)
	);
	const handleCreateUrlPreview = React.useCallback((): void => {
		if (readOnly) return;
		const next = window.prompt(t('links.prompt'), 'https://');
		if (!next) return;
		const added = addNotePreviewLinkToDoc(props.doc, next);
		if (!added) return;
		props.onShowBriefDialog?.(t('links.addedToast'));
	}, [props.doc, props.onShowBriefDialog, readOnly, t]);
	const handleDeleteUrlPreview = React.useCallback((normalizedUrl: string): void => {
		if (readOnly) return;
		removeNotePreviewLinkFromDoc(props.doc, normalizedUrl);
	}, [props.doc, readOnly]);

	React.useEffect(() => {
		let timerId = 0;
		let lastSignature = (extractNoteLinksFromDoc(props.doc) || []).map((link) => `${link.normalizedUrl}:${link.sortOrder}`).join('|');
		// Debounce link sync so typing/editing does not spam the preview resolver.
		const scheduleSync = (tr?: Y.Transaction): void => {
			if (tr?.origin === RICHTEXT_INTERNAL_ORIGIN) return;
			const nextLinks = extractNoteLinksFromDoc(props.doc);
			const nextSignature = nextLinks.map((link) => `${link.normalizedUrl}:${link.sortOrder}`).join('|');
			if (nextSignature === lastSignature) return;
			lastSignature = nextSignature;
			if (timerId) window.clearTimeout(timerId);
			timerId = window.setTimeout(() => {
				void syncNoteLinksForDoc({
					userId: props.authUserId,
					docId: props.docId,
					links: nextLinks,
				});
			}, 320);
		};
		scheduleSync();
		props.doc.on('afterTransaction', scheduleSync as unknown as (tr: Y.Transaction) => void);
		return () => {
			props.doc.off('afterTransaction', scheduleSync as unknown as (tr: Y.Transaction) => void);
			if (timerId) window.clearTimeout(timerId);
		};
	}, [props.authUserId, props.doc, props.docId]);
	const keyboard = useKeyboardHeight();
	const visualViewport = useVisualViewportHeight();
	// Mobile-only keyboard branch:
	// - `useKeyboardHeight()` is driven by the Visual Viewport API, so `keyboard.isOpen`
	//   reflects whether the on-screen keyboard has reduced the visible viewport.
	// - We intentionally gate this branch by `isCoarsePointer` because desktop virtual
	//   keyboards and narrow windows should keep the normal dock/media layout.
	// - Downstream, this flag removes the mobile dock/media sheet from layout entirely
	//   so the editor body ends at the keyboard instead of allowing hidden footer UI to
	//   remain scrollable beneath the visible editing surface.
	const mobileKeyboardOpen = isCoarsePointer && keyboard.isOpen;
	// Ref for the editor overlay DOM node.  Used to check whether the
	// keyboard-triggering element is inside the editor (vs. a higher-z-index
	// modal like NoteImageUploadModal).  Camera Activity transitions on Android
	// cause transient Visual Viewport shrinks that look like a keyboard to
	// useKeyboardHeight — this ref lets us ignore those false positives.
	const editorOverlayRefCb = React.useRef<HTMLDivElement | null>(null);
	const isMobileLandscape = useIsMobileLandscape();
	const isMobileLandscapeRef = React.useRef(isMobileLandscape);
	React.useEffect(() => {
		isMobileLandscapeRef.current = isMobileLandscape;
		// Landscape branch: force media dock closed to keep editing chrome stable.
		if (isMobileLandscape) setMediaDockOpen(false);
	}, [isMobileLandscape]);
	React.useEffect(() => {
		// Keyboard-open branch:
		// The mobile dock should never coexist with the software keyboard. If the dock
		// stayed open while the keyboard was visible, users could still scroll the hidden
		// footer region into view, which is exactly the bug we are preventing here.
		if (!mobileKeyboardOpen) return;
		// Only close the dock when the keyboard was triggered by an element inside
		// the editor overlay.  A keyboard opened by a higher-z-index modal (e.g.
		// the image upload rename field) should not affect the dock state, because
		// doing so fires history.back() during camera Activity transitions.
		if (!(document.activeElement instanceof HTMLElement) || !editorOverlayRefCb.current?.contains(document.activeElement)) return;
		setMediaDockOpen(false);
	}, [mobileKeyboardOpen]);
	React.useEffect(() => {
		if (!mediaDockOpen || !isCoarsePointer || typeof document === 'undefined') return;
		const active = document.activeElement;
		if (active instanceof HTMLElement) {
			// Hide the active caret immediately once the sheet overlays editor content.
			active.blur();
		}
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
	// `onChecklistBeforeCapture`, cleared in `onDragEnd`).  Outside of that window
	// the handler is a fast no-op.
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
	const dockTouchStartRef = React.useRef<{ x: number; y: number } | null>(null);
	const mediaSheetSwipeStartRef = React.useRef<{ x: number; y: number } | null>(null);
	const mediaDockHistoryTokenRef = React.useRef(`note-editor-media-dock:${Math.random().toString(36).slice(2, 10)}`);
	const pendingMediaDockCleanupRef = React.useRef<number | null>(null);
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
	}, []);
	const handleHandleTouchEnd = React.useCallback(
		(event: React.TouchEvent): void => {
			// Landscape branch: never open/close media via vertical swipes.
			if (isMobileLandscapeRef.current) return;
			const start = dockTouchStartRef.current;
			const t0 = event.changedTouches[0];
			if (!start || !t0) return;
			event.stopPropagation();
			dockTouchStartRef.current = null;
			const dx = t0.clientX - start.x;
			const dy = t0.clientY - start.y;
			if (Math.abs(dy) < 28 || Math.abs(dy) < Math.abs(dx)) return;
			if (dy < 0) setMediaDockOpen(true);
			if (dy > 0) setMediaDockOpen(false);
		},
		[]
	);
	const handleDockSwipeEnd = React.useCallback(
		(event: React.TouchEvent): void => {
			// Landscape branch: horizontal media tab swipe is disabled.
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
		},
		[]
	);
	React.useEffect(() => {
		if (!isCoarsePointer || !mediaDockOpen) return;
		if (pendingMediaDockCleanupRef.current != null) {
			window.clearTimeout(pendingMediaDockCleanupRef.current);
			pendingMediaDockCleanupRef.current = null;
		}
		let active = true;
		let didPush = false;
		const token = mediaDockHistoryTokenRef.current;
		const onPopState = (event: PopStateEvent): void => {
			if (!active) return;
			if (isMediaDockHistoryEntry(event.state)) return;
			setMediaDockOpen(false);
		};
		window.addEventListener('popstate', onPopState);
		const currentState = window.history.state as { __noteEditorMediaDock?: string } | null;
		// The media sheet gets its own history entry so mobile Back dismisses the
		// sheet first and leaves the surrounding editor mounted in place.
		if (currentState?.__noteEditorMediaDock !== token) {
			window.history.pushState({ __noteEditorMediaDock: token }, '');
			didPush = true;
			(window as any).__debugLog?.('HISTORY', `mediaDock pushState token=${token} histLen=${window.history.length}`);
		}
		return () => {
			active = false;
			window.removeEventListener('popstate', onPopState);
			if (!didPush) return;
			pendingMediaDockCleanupRef.current = window.setTimeout(() => {
				pendingMediaDockCleanupRef.current = null;
				const state = window.history.state as { __noteEditorMediaDock?: string } | null;
				if (state?.__noteEditorMediaDock === token) {
					window.history.back();
				}
			}, 0);
		};
	}, [isCoarsePointer, mediaDockOpen]);
	React.useEffect(() => () => {
		if (typeof window === 'undefined') return;
		if (pendingMediaDockCleanupRef.current != null) {
			window.clearTimeout(pendingMediaDockCleanupRef.current);
			pendingMediaDockCleanupRef.current = null;
		}
	}, []);
	const closeMediaDock = React.useCallback((): void => {
		setMediaDockOpen(false);
	}, []);
	const closeMediaDockFromPointerEvent = React.useCallback((event: React.PointerEvent<HTMLButtonElement>): void => {
		if (event.pointerType !== 'touch' && !isCoarsePointer) return;
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
		suppressNextDocumentCompatibilityMouseEvents();
		closeMediaDock();
	}, [closeMediaDock, isCoarsePointer]);
	const handleOpenImageFromMediaDock = React.useCallback((): void => {
		props.onAddImage?.();
	}, [props]);
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
		if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy)) {
			setMediaDockTab((prev) => {
				if (dx < 0) return Math.min(prev + 1, 2) as 0 | 1 | 2;
				return Math.max(prev - 1, 0) as 0 | 1 | 2;
			});
		}
	}, []);
	const renderMediaDockPanel = React.useCallback((): React.JSX.Element => {
		// All dock variants funnel through one renderer so mobile sheets and desktop
		// flyouts cannot drift into subtly different attachment behavior.
		if (mediaDockTab === 0) {
			return (
				<NoteMediaPanel
					docId={props.docId}
					authUserId={props.authUserId}
					canEdit={!readOnly}
					onAddImage={props.onAddImage ? handleOpenImageFromMediaDock : undefined}
					isPendingNew={props.isPendingNew}
				/>
			);
		}
		if (mediaDockTab === 1) {
			return <NoteLinkPanel docId={props.docId} authUserId={props.authUserId} fallbackLinks={extractedLinks} canEdit={!readOnly} onDeleteLink={handleDeleteUrlPreview} onAddUrlPreview={handleCreateUrlPreview} />;
		}
		return <DocumentsPanel docId={props.docId} authUserId={props.authUserId} canEdit={!readOnly} onAddDocument={props.onAddDocument} showComingSoonPlaceholder />;
	}, [extractedLinks, handleCreateUrlPreview, handleDeleteUrlPreview, handleOpenImageFromMediaDock, mediaDockTab, props.authUserId, props.docId, props.onAddDocument, props.onAddImage, props.isPendingNew, readOnly]);
	const [showCompleted, setShowCompleted] = React.useState(() => Boolean(props.initialShowCompleted));
	React.useEffect(() => {
		setShowCompleted(Boolean(props.initialShowCompleted));
	}, [props.initialShowCompleted]);
	const checklistArray = useMemo(() => props.doc.getArray<Y.Map<any>>('checklist'), [props.doc]);
	const rowInputsRef = React.useRef<Map<string, HTMLDivElement | null>>(new Map());
	const rowContainersRef = React.useRef<Map<string, HTMLLIElement | null>>(new Map());
	const dragGhostMetricsRef = React.useRef<{ rowWidth: number | null; rowHeight: number | null; textHeight: number | null; textWidth: number | null }>({
		rowWidth: null,
		rowHeight: null,
		textHeight: null,
		textWidth: null,
	});

	React.useEffect(() => {
		setIsModified(false);
		const onAfterTransaction = (tr: Y.Transaction): void => {
			if (!tr.local) return;
			if (tr.origin === RICHTEXT_INTERNAL_ORIGIN) return;
			setIsModified(true);
		};
		props.doc.on('afterTransaction', onAfterTransaction);
		return () => {
			props.doc.off('afterTransaction', onAfterTransaction);
		};
	}, [props.doc, props.noteId]);
	const checklistScrollRef = React.useRef<HTMLDivElement | null>(null);
	const completedSectionRef = React.useRef<HTMLElement | null>(null);
	const [focusRowId, setFocusRowId] = React.useState<string | null>(null);
	const [activeChecklistRowId, setActiveChecklistRowId] = React.useState<string | null>(null);
	const [activeChecklistRowEditor, setActiveChecklistRowEditor] = React.useState<Editor | null>(null);
	const checkboxUndoStack = React.useRef<readonly ChecklistItem[][]>([]);
	const checkboxRedoStack = React.useRef<readonly ChecklistItem[][]>([]);
	const [checkboxUndoAvail, setCheckboxUndoAvail] = React.useState(false);
	const [checkboxRedoAvail, setCheckboxRedoAvail] = React.useState(false);
	// Text-note copy mode is lifted here so the coarse-pointer floating toolbar can
	// reflect and update the same selection-copy mode as the inline desktop toolbar.
	const [copyMode, setCopyMode] = React.useState<ClipboardConversionTarget>('rich-text');
	const [clipboardStatusMessage, setClipboardStatusMessage] = React.useState('');
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
	const allowAutomaticChecklistRowFocusRef = React.useRef(!props.isPendingNew);
	// Quick-delete mode clears checklist-row focus entirely, so skip the normal
	// "auto-activate the first remaining row" behavior on the next render.
	const suppressAutoActivateAfterDeleteRef = React.useRef(false);
	// Some mobile browsers briefly report `keyboard.isOpen=false` during focus
	// handoffs between rows. Suppress keyboard-close de-selection for a short
	// window after deliberate row activation so we don't blur/clear selection.
	const ignoreKeyboardCloseUntilRef = React.useRef<number>(0);
	const prepareChecklistRowFocusHandoff = React.useCallback((): void => {
		// Focus the proxy textarea before a row editor unmounts so the mobile keyboard
		// survives row activation/deletion without a visible close/reopen flicker.
		if (!isCoarsePointer || !keyboard.isOpen) return;
		ignoreKeyboardCloseUntilRef.current = Date.now() + 450;
		focusProxyRef.current?.focus();
	}, [isCoarsePointer, keyboard.isOpen]);
	const clearChecklistSelection = React.useCallback((): void => {
		// Quick delete wants a true blur state, not a refocus onto the next surviving row.
		suppressAutoActivateAfterDeleteRef.current = true;
		setActiveChecklistRowId(null);
		setFocusRowId(null);
		setActiveChecklistRowEditor(null);
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
	}, []);
	// Tracks keyboard open->closed transitions for de-selection.
	const lastMobileKeyboardOpenRef = React.useRef(mobileKeyboardOpen);
	const [textEditor, setTextEditor] = React.useState<Editor | null>(null);
	const focusTextEditorBody = React.useCallback((): void => {
		if (textEditor && !textEditor.isDestroyed) {
			textEditor.commands.focus('start');
			return;
		}
		const tryFocus = (remaining: number): void => {
			const editorElement = textBodyFieldRef.current?.querySelector('[contenteditable="true"]');
			if (editorElement instanceof HTMLElement) {
				editorElement.focus();
				return;
			}
			if (remaining <= 0 || typeof window === 'undefined') return;
			window.setTimeout(() => tryFocus(remaining - 1), 16);
		};
		tryFocus(5);
	}, [textEditor]);
	const [draggingParentId, setDraggingParentId] = React.useState<string | null>(null);


	// metadata.type controls which editor body is rendered.
	const metadata = useMemo(() => props.doc.getMap<any>('metadata'), [props.doc]);
	const colorToken = useSyncExternalStore(
		(onStoreChange) => {
			// Subscribe to both stores while older local-only color selections are still
			// being migrated onto the canonical note metadata path.
			const unsubLocal = subscribeNoteColorPrefs(onStoreChange);
			const observer = (): void => onStoreChange();
			metadata.observe(observer);
			return () => { unsubLocal(); metadata.unobserve(observer); };
		},
		() => readEffectiveNoteColorToken(metadata, getUserNoteColorToken(props.noteId), hasUserNoteColorPref(props.noteId)),
		() => readEffectiveNoteColorToken(metadata, getUserNoteColorToken(props.noteId), hasUserNoteColorPref(props.noteId))
	);
	const typeValue = useMetadataString(metadata, 'type');
	const type: NoteType = typeValue === 'checklist' ? 'checklist' : 'text';
	// Mirror the draft checklist editor: only surface the mobile undo/redo affordance
	// when checklist checkbox history exists and no competing mobile overlay is open.
	const showMobileChecklistUndoFab = isCoarsePointer
		&& type === 'checklist'
		&& !readOnly
		&& !mobileKeyboardOpen
		&& !mediaDockOpen
		&& !isMoreMenuOpen
		&& (checkboxUndoAvail || checkboxRedoAvail);
	// Android standalone PWAs can leave the fullscreen overlay scrolled after
	// nested modal flows (for example Add Image -> close -> reopen editor). Keep
	// the overlay pinned to the origin so the editor shell always reopens flush
	// to the top of the visible viewport.
	const resetEditorOverlayScroll = React.useCallback((): void => {
		const overlay = editorOverlayRefCb.current;
		if (!overlay) return;
		if (overlay.scrollTop === 0 && overlay.scrollLeft === 0) return;
		overlay.scrollTop = 0;
		overlay.scrollLeft = 0;
	}, []);
	React.useLayoutEffect(() => {
		if (!isCoarsePointer || typeof window === 'undefined') return;
		const overlay = editorOverlayRefCb.current;
		if (!overlay) return;
		const rafIds: number[] = [];
		// Re-assert the zero scroll position across the first few layout frames
		// because Android may restore the old offset after mount/viewport changes.
		const timeoutId = window.setTimeout(() => {
			resetEditorOverlayScroll();
		}, 120);
		const scheduleFrameReset = (): void => {
			rafIds.push(window.requestAnimationFrame(() => {
				resetEditorOverlayScroll();
			}));
		};
		const handleScroll = (): void => {
			scheduleFrameReset();
		};
		overlay.addEventListener('scroll', handleScroll, { passive: true });
		resetEditorOverlayScroll();
		scheduleFrameReset();
		scheduleFrameReset();
		return () => {
			overlay.removeEventListener('scroll', handleScroll);
			window.clearTimeout(timeoutId);
			for (const rafId of rafIds) {
				window.cancelAnimationFrame(rafId);
			}
		};
	}, [isCoarsePointer, props.hideFormattingToolbar, props.noteId, resetEditorOverlayScroll]);

	const isPinned = useSyncExternalStore(
		(onStoreChange) => subscribeNotePinPrefs(onStoreChange),
		() => resolveUserNotePinned({
			docId: props.docId,
			noteId: props.noteId,
			userId: props.authUserId,
			legacyPinned: Boolean(metadata.get('isPinned')),
		}),
		() => resolveUserNotePinned({
			docId: props.docId,
			noteId: props.noteId,
			userId: props.authUserId,
			legacyPinned: Boolean(metadata.get('isPinned')),
		})
	);
	const noteAutoScrollEnabled = useSyncExternalStore(
		(onStoreChange) => subscribeNoteAutoScrollPrefs(onStoreChange),
		() => getUserNoteAutoScrollEnabled(props.docId, props.authUserId),
		() => getUserNoteAutoScrollEnabled(props.docId, props.authUserId)
	);
	const autoScrollAppliedForRef = React.useRef<string | null>(null);
	const activeScrollCancelRef = React.useRef<(() => void) | null>(null);
	const resolvedColor = useMemo(
		() => (colorToken ? resolveThemeNoteColorModel(props.themeId).tokens[colorToken] : null),
		[colorToken, props.themeId]
	);

	const stopActiveScrollAnimation = React.useCallback((): void => {
		activeScrollCancelRef.current?.();
		activeScrollCancelRef.current = null;
	}, []);

	const scrollNoteBodyToBottom = React.useCallback((animated: boolean): boolean => {
		const container = type === 'checklist'
			? checklistScrollRef.current
			: findScrollableAncestor(textBodyFieldRef.current?.querySelector('[contenteditable="true"]') as HTMLElement | null);
		if (!container) return false;
		const targetScrollTop = type === 'checklist'
			? getChecklistAutoScrollTarget(container, completedSectionRef.current)
			: undefined;
		stopActiveScrollAnimation();
		if (animated) {
			activeScrollCancelRef.current = animateFastScrollToBottom(container, targetScrollTop);
		} else {
			container.scrollTop = typeof targetScrollTop === 'number' ? targetScrollTop : container.scrollHeight;
		}
		return true;
	}, [stopActiveScrollAnimation, type]);

	const handleToggleNoteAutoScroll = React.useCallback((): void => {
		if (noteAutoScrollEnabled) {
			setUserNoteAutoScrollEnabled(props.docId, props.authUserId, false);
			autoScrollAppliedForRef.current = null;
			stopActiveScrollAnimation();
			return;
		}
		setUserNoteAutoScrollEnabled(props.docId, props.authUserId, true);
		const scrollKey = `${props.docId}:${type}`;
		if (scrollNoteBodyToBottom(true)) {
			autoScrollAppliedForRef.current = scrollKey;
		}
	}, [noteAutoScrollEnabled, props.authUserId, props.docId, scrollNoteBodyToBottom, stopActiveScrollAnimation, type]);

	React.useEffect(() => {
		if (!noteAutoScrollEnabled) {
			autoScrollAppliedForRef.current = null;
			stopActiveScrollAnimation();
			return;
		}
		const scrollKey = `${props.docId}:${type}`;
		if (autoScrollAppliedForRef.current === scrollKey) return;
		let cancelled = false;
		const tryScroll = (remaining: number): void => {
			if (cancelled) return;
			if (scrollNoteBodyToBottom(true)) {
				autoScrollAppliedForRef.current = scrollKey;
				return;
			}
			if (remaining <= 0 || typeof window === 'undefined') return;
			window.setTimeout(() => tryScroll(remaining - 1), 24);
		};
		tryScroll(12);
		return () => {
			cancelled = true;
			stopActiveScrollAnimation();
		};
	}, [noteAutoScrollEnabled, props.docId, scrollNoteBodyToBottom, stopActiveScrollAnimation, type]);

	// iOS caret visibility fix: after keyboard animation settles, re-check caret visibility.
	React.useEffect(() => {
		// When the keyboard opens, `mobileKeyboardOpen` becomes true and the editor
		// shell height is clamped to `keyboard.visibleBottom`. However TipTap's
		// `selectionUpdate` / `focus` event fires BEFORE visualViewport finishes
		// animating, so the caret may still be hidden under the keyboard.
		// Schedule a second check after the iOS keyboard animation settles (~300 ms).
		if (!mobileKeyboardOpen || type !== 'text') return;
		const timer = window.setTimeout(() => {
			ensureEditorSelectionVisible(textEditor, keyboardVisibilityPaddingPx);
		}, 320);
		return () => window.clearTimeout(timer);
	}, [mobileKeyboardOpen, textEditor, type]);

	const editorColorStyle = useMemo(() => {
		if (!resolvedColor) return undefined;
		return {
			'--note-editor-surface': resolvedColor.cardBackground,
			'--note-editor-header': resolvedColor.headerBackground,
			'--note-editor-border': resolvedColor.borderColor,
			'--note-editor-text': resolvedColor.textColor,
			'--note-editor-muted': resolvedColor.mutedTextColor,
			'--note-editor-accent': resolvedColor.accentColor,
		} as React.CSSProperties & Record<string, string>;
	}, [resolvedColor]);
	const editorShellStyle = useMemo(() => {
		const style: React.CSSProperties & Record<string, string> = { ...(editorColorStyle ?? {}) };
		if (isCoarsePointer) {
			// Use the live Visual Viewport height on mobile so the fullscreen shell
			// tracks the actual visible window even when CSS dvh lags behind Android
			// standalone/PWA keyboard transitions.
			const visibleBottom = Math.max(
				0,
				Math.round((visualViewport?.height ?? window.innerHeight) + (visualViewport?.offsetTop ?? 0))
			);
			// Android standalone PWAs can leave CSS `100dvh` stuck at a keyboard-sized
			// value after nested modal flows. Drive the editor shell from the live
			// Visual Viewport instead so reopen and keyboard-dismiss both use the real
			// visible viewport height.
			if (visibleBottom > 0) {
				const visibleHeight = `calc(${visibleBottom}px - env(safe-area-inset-top, 0px))`;
				style.height = visibleHeight;
				style.maxHeight = visibleHeight;
			}
		}
		if (mobileKeyboardOpen) {
			// Only treat the editor as keyboard-driven when the focused element lives
			// inside the editor overlay. Higher-z-index modals like Add Image should not
			// toggle the editor into its keyboard-open branch.
			const active = document.activeElement;
			if (!(active instanceof HTMLElement) || !editorOverlayRefCb.current?.contains(active)) {
				return Object.keys(style).length > 0 ? style : undefined;
			}
		}
		return Object.keys(style).length > 0 ? style : undefined;
	}, [editorColorStyle, isCoarsePointer, mobileKeyboardOpen, visualViewport]);
	const handleOpenColorPicker = React.useCallback((): void => {
		if (readOnly) return;
		setIsColorPickerOpen(true);
	}, [readOnly]);
	const handleSelectNoteColor = React.useCallback((token: Parameters<typeof saveUserNoteColorToken>[2]): void => {
		saveUserNoteColorToken(getDeviceId(), props.noteId, token);
		setIsColorPickerOpen(false);
	}, [props.noteId]);

	// Keyboard-close de-selection (checklist mode only):
	// If the user explicitly dismisses the mobile keyboard, clear any active
	// checklist row selection so dragging cannot bring the keyboard back.
	//
	// We scope this to:
	// - `isCoarsePointer` (mobile/tablet), because desktop has no soft keyboard
	// - `type === 'checklist'`, because text notes use a different editor surface
	React.useEffect(() => {
		const wasOpen = lastMobileKeyboardOpenRef.current;
		lastMobileKeyboardOpenRef.current = mobileKeyboardOpen;
		if (!isCoarsePointer) return;
		if (type !== 'checklist') return;
		if (!wasOpen || mobileKeyboardOpen) return;
		if (Date.now() < ignoreKeyboardCloseUntilRef.current) return;
		setActiveChecklistRowId(null);
		setFocusRowId(null);
		setActiveChecklistRowEditor(null);
		// Remove any lingering :focus-within highlight by clearing DOM focus.
		// This must not move focus to another input (which could re-open the keyboard).
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
	}, [isCoarsePointer, mobileKeyboardOpen, type]);

	const titleYText = useMemo(() => props.doc.getText('title'), [props.doc]);
	const contentYText = useMemo(() => (type === 'text' ? props.doc.getText('content') : null), [props.doc, type]);
	const [richContentFragment, setRichContentFragment] = React.useState<Y.XmlFragment | null>(() => {
		if (type !== 'text') return null;
		const existing = props.doc.share.get(TEXT_NOTE_RICH_FIELD);
		return existing instanceof Y.XmlFragment ? existing : null;
	});
	const title = useYTextValue(titleYText);
	const content = useOptionalYTextValue(contentYText);
	const items = useOptionalChecklistItems(type === 'checklist' ? checklistArray : null);

	React.useEffect(() => {
		if (type !== 'text') {
			setRichContentFragment(null);
			return;
		}
		const existing = props.doc.share.get(TEXT_NOTE_RICH_FIELD);
		if (existing instanceof Y.XmlFragment) {
			setRichContentFragment((current) => (current === existing ? current : existing));
			return;
		}
		// Seed the rich fragment after mount instead of during render so Yjs writes
		// cannot cascade into NoteGrid subscriptions mid-render.
		const nextFragment = ensureTextNoteRichContent(props.doc);
		setRichContentFragment(nextFragment);
	}, [props.doc, type]);

	const checklistMapsById = useMemo(() => {
		const next = new Map<string, Y.Map<any>>();
		for (const itemMap of checklistArray.toArray()) {
			next.set(String(itemMap.get('id') ?? ''), itemMap);
		}
		return next;
	}, [checklistArray, items]);
	const normalizedItems = useMemo(() => normalizeChecklistHierarchy(items), [items]);
	const activeItems = useMemo(() => normalizedItems.filter((item) => !item.completed), [normalizedItems]);
	const completedItems = useMemo(() => normalizedItems.filter((item) => item.completed), [normalizedItems]);
	const completedRows = useMemo(() => buildChecklistCompletedRows(normalizedItems), [normalizedItems]);
	const visibleChecklistRowIds = useMemo(
		() => [
			...activeItems.map((item) => item.id),
			...(showCompleted ? completedRows.flatMap(({ kind, item }) => kind === 'ghost' ? [] : [item.id]) : []),
		],
		[activeItems, completedRows, showCompleted]
	);
	const firstActiveItemId = activeItems[0]?.id ?? null;
	const checklistAddItemLabel = t('editors.addItem');
	const checklistItemPlaceholder = t('editors.checklistItemPlaceholder');
	const checklistRemoveLabel = t('editors.remove');
	const activeChecklistRowItem = useMemo(
		() => normalizedItems.find((item) => item.id === activeChecklistRowId) ?? null,
		[activeChecklistRowId, normalizedItems]
	);
	const activeChecklistCountItem = useMemo(
		() => activeChecklistRowItem && isChecklistCountItem(activeChecklistRowItem) ? activeChecklistRowItem : null,
		[activeChecklistRowItem]
	);

	// FLIP animation helper for checklist indent/un-indent (horizontal snap):
	// When we indent/unindent we mutate the *flat* list (parentId changes + regrouping),
	// which can visually look like items “teleport” to a new place.
	//
	// The hook gives us a `capturePositions()` callback: call it immediately BEFORE we
	// apply the hierarchy mutation so the next render can animate items from their
	// previous rects to their new rects.
	const { capturePositions: captureFlipPositions } = useChecklistFlip(rowContainersRef, normalizedItems);
	const captureFlipPositionsRef = React.useRef(captureFlipPositions);
	captureFlipPositionsRef.current = captureFlipPositions;

	React.useEffect(() => {
		if (type !== 'checklist') return;
		// Mobile keyboard-hidden branch:
		// When the keyboard is closed, allow "no active row" as a stable state.
		// (See the keyboard-close de-selection effect above.)
		if (isCoarsePointer && !mobileKeyboardOpen) return;
		if (!allowAutomaticChecklistRowFocusRef.current) return;
		if (activeChecklistRowId && normalizedItems.some((item) => item.id === activeChecklistRowId)) return;
		if (suppressAutoActivateAfterDeleteRef.current) return;
		setActiveChecklistRowId(normalizedItems[0]?.id ?? null);
	}, [activeChecklistRowId, isCoarsePointer, mobileKeyboardOpen, normalizedItems, type]);

	// Horizontal snap handler — bypass the drag library entirely for indent/unindent:
	// We detect a deliberate horizontal gesture (see `dndSensors.ts`) and then perform
	// the hierarchy mutation directly. This keeps the vertical drag library focused on
	// reorder only, and prevents the “drag started then got cancelled” flicker.
	//
	// We store current values in refs so the handler stays registered once, but still
	// reads fresh `normalizedItems` and `replaceChecklistItems` on every invocation.
	const normalizedItemsRef = React.useRef<readonly ChecklistItem[]>(normalizedItems);
	normalizedItemsRef.current = normalizedItems;
	const replaceChecklistItemsRef = React.useRef<((next: readonly ChecklistItem[]) => void) | null>(null);

	React.useEffect(() => {
		if (type !== 'checklist') return;
		return registerHorizontalSnapHandler((draggableId, direction) => {
			// Capture pre-mutation layout for FLIP before we change parentId/grouping.
			captureFlipPositionsRef.current();
			const currentItems = normalizedItemsRef.current;
			const currentActive = currentItems.filter((item) => !item.completed);
			const sourceIndex = currentActive.findIndex((item) => item.id === draggableId);
			if (sourceIndex === -1) return;
			const nextItems = applyChecklistDragToItems({
				items: currentItems,
				sourceIndex,
				destinationIndex: sourceIndex,
				axis: 'horizontal',
				horizontalDirection: direction,
			});
			replaceChecklistItemsRef.current?.(nextItems);
		});
	}, [type]);

	const addChecklistItem = React.useCallback(
		(index?: number, seed?: { text?: string; parentId?: string | null; countValue?: number | null; richContent?: ReturnType<typeof createRichTextDocFromPlainText> }): void => {
			if (type !== 'checklist') return;
			suppressAutoActivateAfterDeleteRef.current = false;
			prepareChecklistRowFocusHandoff();
			const nextId =
				typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
					? crypto.randomUUID()
					: String(Date.now());
			const insertIndex = typeof index === 'number' ? Math.max(0, Math.min(items.length, index + 1)) : items.length;

			const doc = (checklistArray as any).doc as Y.Doc | null | undefined;
			const apply = (): void => {
				const map = new Y.Map<any>();
				map.set('id', nextId);
				map.set('text', seed?.text ?? '');
				map.set('completed', false);
				map.set('parentId', seed?.parentId ?? null);
				map.set('countValue', normalizeChecklistCountValue(seed?.countValue));
				checklistArray.insert(insertIndex, [map]);
				if (seed?.richContent) {
					const fragment = ensureChecklistItemRichContent(map);
					replaceRichFragmentFromJson(fragment, seed.richContent, 'minimal');
				}
			};

			if (doc) doc.transact(apply);
			else apply();
			setActiveChecklistRowId(nextId);
			setFocusRowId(nextId);
		},
		[checklistArray, items.length, prepareChecklistRowFocusHandoff, type]
	);

	const replaceChecklistItems = React.useCallback(
		(nextItems: readonly ChecklistItem[]): void => {
			const doc = (checklistArray as any).doc as Y.Doc | null | undefined;
			const apply = (): void => {
				const currentMaps = checklistArray.toArray();
				const richSnapshots = snapshotChecklistRichContent(checklistArray);

				// Reorder in place by rewriting the existing slot maps instead of deleting and
				// recreating the full Y.Array. That keeps each slot attached to the document,
				// avoids detached-fragment warnings from y-prosemirror, and prevents the full
				// TipTap remount storm that was making checklist drag feel sluggish.
				if (currentMaps.length === nextItems.length) {
					for (let index = 0; index < nextItems.length; index += 1) {
						const entry = nextItems[index];
						const map = currentMaps[index];
						const nextParentId = typeof entry.parentId === 'string' && entry.parentId.trim().length > 0
							? entry.parentId.trim()
							: null;
						const currentParentId = typeof map.get('parentId') === 'string' && String(map.get('parentId')).trim().length > 0
							? String(map.get('parentId')).trim()
							: null;
						const currentId = String(map.get('id') ?? '');
						const currentText = String(map.get('text') ?? '');
						const currentCompleted = Boolean(map.get('completed'));
						const currentCountValue = normalizeChecklistCountValue(map.get('countValue'));
						const nextCountValue = normalizeChecklistCountValue(entry.countValue);

						if (
							currentId === entry.id &&
							currentText === entry.text &&
							currentCompleted === entry.completed &&
							currentParentId === nextParentId &&
							currentCountValue === nextCountValue
						) {
							continue;
						}

						map.set('id', entry.id);
						map.set('text', entry.text);
						map.set('completed', entry.completed);
						map.set('parentId', nextParentId);
						map.set('countValue', nextCountValue);

						const fragment = ensureChecklistItemRichContent(map);
						replaceRichFragmentFromJson(
							fragment,
							richSnapshots.get(entry.id) ?? createRichTextDocFromPlainText(entry.text),
							'minimal'
						);
					}
					return;
				}

				// Fallback for any future call sites that genuinely change list length.
				checklistArray.delete(0, checklistArray.length);
				const maps = nextItems.map((entry) => {
					const map = new Y.Map<any>();
					map.set('id', entry.id);
					map.set('text', entry.text);
					map.set('completed', entry.completed);
					map.set('parentId', entry.parentId);
					map.set('countValue', normalizeChecklistCountValue(entry.countValue));
					return map;
				});
				checklistArray.insert(0, maps);
				for (let index = 0; index < maps.length; index += 1) {
					const entry = nextItems[index];
					const fragment = ensureChecklistItemRichContent(maps[index]);
					replaceRichFragmentFromJson(
						fragment,
						richSnapshots.get(entry.id) ?? createRichTextDocFromPlainText(entry.text),
						'minimal'
					);
				}
			};

			if (doc) doc.transact(apply);
			else apply();
		},
		[checklistArray]
	);

	// Now that replaceChecklistItems is defined, keep the ref current.
	replaceChecklistItemsRef.current = replaceChecklistItems;

	const toggleChecklistCompleted = React.useCallback(
		(id: string, checked: boolean): void => {
			if (type !== 'checklist') return;
			const snapshot = normalizedItems;
			checkboxUndoStack.current = [...checkboxUndoStack.current.slice(-39), snapshot];
			checkboxRedoStack.current = [];
			setCheckboxUndoAvail(true);
			setCheckboxRedoAvail(false);
			replaceChecklistItems(toggleChecklistItemCompleted(normalizedItems, id, checked));
		},
		[normalizedItems, replaceChecklistItems, type]
	);

	const undoCheckboxChange = React.useCallback((): void => {
		if (checkboxUndoStack.current.length === 0) return;
		const snapshot = checkboxUndoStack.current[checkboxUndoStack.current.length - 1];
		checkboxUndoStack.current = checkboxUndoStack.current.slice(0, -1);
		checkboxRedoStack.current = [...checkboxRedoStack.current, normalizedItems];
		setCheckboxUndoAvail(checkboxUndoStack.current.length > 0);
		setCheckboxRedoAvail(true);
		replaceChecklistItems(snapshot);
	}, [normalizedItems, replaceChecklistItems]);

	const redoCheckboxChange = React.useCallback((): void => {
		if (checkboxRedoStack.current.length === 0) return;
		const snapshot = checkboxRedoStack.current[checkboxRedoStack.current.length - 1];
		checkboxRedoStack.current = checkboxRedoStack.current.slice(0, -1);
		checkboxUndoStack.current = [...checkboxUndoStack.current, normalizedItems];
		setCheckboxUndoAvail(true);
		setCheckboxRedoAvail(checkboxRedoStack.current.length > 0);
		replaceChecklistItems(snapshot);
	}, [normalizedItems, replaceChecklistItems]);

	const checkAllChecklistItems = React.useCallback((): void => {
		if (type !== 'checklist' || readOnly || normalizedItems.length === 0) return;
		replaceChecklistItems(normalizedItems.map((item) => (item.completed ? item : { ...item, completed: true })));
	}, [normalizedItems, readOnly, replaceChecklistItems, type]);

	const uncheckAllChecklistItems = React.useCallback((): void => {
		if (type !== 'checklist' || readOnly || normalizedItems.length === 0) return;
		replaceChecklistItems(normalizedItems.map((item) => (!item.completed ? item : { ...item, completed: false })));
	}, [normalizedItems, readOnly, replaceChecklistItems, type]);

	// Keyboard undo/redo for checkbox toggles (Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z)
	React.useEffect(() => {
		if (type !== 'checklist' || readOnly) return;
		const onKey = (e: KeyboardEvent): void => {
			const meta = e.ctrlKey || e.metaKey;
			if (!meta) return;
			if (e.key === 'z' || e.key === 'Z') {
				if (e.shiftKey) {
					if (checkboxRedoStack.current.length === 0) return;
					e.preventDefault();
					redoCheckboxChange();
				} else {
					if (checkboxUndoStack.current.length === 0) return;
					// Only intercept when focus is NOT inside a TipTap contenteditable
					// so the editor's own Ctrl+Z still works on typed text.
					const active = document.activeElement;
					const inEditor = active instanceof HTMLElement && active.isContentEditable;
					if (inEditor) return;
					e.preventDefault();
					undoCheckboxChange();
				}
			} else if (e.key === 'y' || e.key === 'Y') {
				if (!e.shiftKey && checkboxRedoStack.current.length > 0) {
					const active = document.activeElement;
					const inEditor = active instanceof HTMLElement && active.isContentEditable;
					if (inEditor) return;
					e.preventDefault();
					redoCheckboxChange();
				}
			}
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [readOnly, redoCheckboxChange, type, undoCheckboxChange]);

	const removeChecklistItem = React.useCallback(
		(id: string, options?: { clearSelection?: boolean }): void => {
			if (type !== 'checklist') return;
			const index = normalizedItems.findIndex((row) => row.id === id);
			const previousId = index > 0 ? normalizedItems[index - 1]?.id ?? null : null;
			const nextId = normalizedItems[index + 1]?.id ?? null;
			// `clearSelection=true` is used by quick delete to close editing entirely.
			// Normal delete keeps the keyboard alive and hands focus to a neighbor.
			if (options?.clearSelection !== true) {
				prepareChecklistRowFocusHandoff();
			}

			// Surgical delete: remove only the target item and its children
			// from the Y.Array, preserving all other items' Y.Map (and their
			// rich-content Y.XmlFragment) in place.
			const childIds = new Set(
				normalizedItems.filter((item) => item.parentId === id).map((item) => item.id),
			);
			const idsToRemove = new Set([id, ...childIds]);
			const doc = (checklistArray as any).doc as Y.Doc | null | undefined;
			const apply = (): void => {
				// Delete from end to start so indices remain stable.
				for (let i = checklistArray.length - 1; i >= 0; i--) {
					const m = checklistArray.get(i);
					if (!m) continue;
					const itemId = String(m.get('id') ?? '');
					if (idsToRemove.has(itemId)) {
						checklistArray.delete(i, 1);
					}
				}
			};
			if (doc) doc.transact(apply);
			else apply();

			if (options?.clearSelection === true && quickDeleteVisible) {
				clearChecklistSelection();
				return;
			}

			suppressAutoActivateAfterDeleteRef.current = false;
			setActiveChecklistRowId(previousId ?? nextId);
			setFocusRowId(previousId ?? nextId);
		},
		[checklistArray, clearChecklistSelection, normalizedItems, prepareChecklistRowFocusHandoff, quickDeleteVisible, type]
	);

	const onChecklistDragEnd = React.useCallback(
		(event: DropResult): void => {
			if (!event.destination) return;
			const axis = getChecklistDragAxis() ?? 'vertical';
			const horizontalDirection = getChecklistHorizontalDirection();
			const nextItems = applyChecklistDragToItems({
				items: normalizedItems,
				sourceIndex: event.source.index,
				destinationIndex: event.destination.index,
				axis,
				horizontalDirection,
			});
			replaceChecklistItems(nextItems);
			setDraggingParentId(null);
			dragGhostMetricsRef.current = { rowWidth: null, rowHeight: null, textHeight: null, textWidth: null };
			resetChecklistDragAxis();
		},
		[normalizedItems, replaceChecklistItems]
	);

	// Drag-ghost measurement (desktop + mobile):
	// The drag “clone” should match what the user picked up pixel-perfectly.
	// Multi-line checklist items are especially sensitive because wrapping depends
	// on the *exact* text container width.
	//
	// We measure both the overall row width and the text element width:
	// - `rowWidth` sizes the outer <li> so padding/controls match.
	// - `textWidth` sizes the text block so wrapping matches, preventing the
	//   “ghost is wider/narrower and wraps differently” regressions.
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

	// ── Drag-handle focus-steal prevention ────────────────────────────────────────
	// Bound to onMouseDown / onPointerDown / onTouchStart on every drag-handle
	// button.  `preventDefault()` on these events stops the browser's default
	// "focus the element you just pressed" behaviour.  Without this, tapping the
	// drag handle would blur the TipTap editor and dismiss the keyboard *before*
	// the DnD gesture even begins — making the proxy guard irrelevant.
	const preventHandleFocusSteal = React.useCallback((event: React.SyntheticEvent): void => {
		event.preventDefault();
	}, []);

	const vibrateIfAvailable = React.useCallback((ms: number): void => {
		if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
		navigator.vibrate(ms);
	}, []);

	const onChecklistDragStart = React.useCallback(
		(event: DragStart): void => {
			// Keep drag-start lightweight: rely on metrics captured in onBeforeCapture.
			resetChecklistDragAxis();

			const dragged = activeItems.find((item) => item.id === event.draggableId) ?? null;
			// Hierarchy branch:
			// If the dragged row is a parent with visible children, we store its id so
			// child rows can render with drag-aware styling and avoid visual ambiguity.
			// Dragging a child row (or a parent without children) clears this state.
			if (dragged && !dragged.parentId) {
				const hasChildren = activeItems.some((item) => item.parentId === dragged.id);
				setDraggingParentId(hasChildren ? dragged.id : null);
			} else {
				setDraggingParentId(null);
			}
		},
		[activeItems]
	);

	// ── onChecklistBeforeCapture — earliest hook in the drag lifecycle ────────────
	// Called synchronously by @hello-pangea/dnd *before* any DOM mutations
	// (cloning, portal injection, dimension locking) happen.  This is the only
	// safe moment to move focus to the proxy because once cloning begins the
	// browser may fire a blur on the contenteditable, which on mobile triggers
	// the keyboard-dismiss heuristic within the same event-loop turn.
	const onChecklistBeforeCapture = React.useCallback(
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

	const insertChecklistItemAfter = React.useCallback(
		(rowId: string, editor?: Editor): void => {
			if (editor) {
				const split = splitMinimalRichTextAtSelection(editor);
				const currentMap = findChecklistItemMapById(checklistArray, rowId);
				if (currentMap) {
					currentMap.set('text', split.beforeText);
					const fragment = ensureChecklistItemRichContent(currentMap);
					replaceRichFragmentFromJson(fragment, split.before, 'minimal');
				}
				const currentItem = items.find((row) => row.id === rowId) ?? null;
				const currentIndex = items.findIndex((row) => row.id === rowId);
				addChecklistItem(currentIndex === -1 ? undefined : currentIndex, {
					text: split.afterText,
					parentId: currentItem?.parentId ?? null,
					countValue: currentItem?.countValue != null ? 1 : null,
					richContent: split.after,
				});
				return;
			}
			const currentIndex = items.findIndex((row) => row.id === rowId);
			addChecklistItem(currentIndex === -1 ? undefined : currentIndex);
		},
		[addChecklistItem, checklistArray, items]
	);

	const incrementActiveChecklistCount = React.useCallback((): void => {
		if (type !== 'checklist' || !activeChecklistCountItem || !isChecklistCountItem(activeChecklistCountItem)) return;
		updateChecklistItemById(checklistArray, activeChecklistCountItem.id, { countValue: (getChecklistCountValue(activeChecklistCountItem) ?? 1) + 1 });
	}, [activeChecklistCountItem, checklistArray, type]);

	const makeActiveChecklistCount = React.useCallback((): void => {
		if (type !== 'checklist' || !activeChecklistRowItem || isChecklistCountItem(activeChecklistRowItem)) return;
		updateChecklistItemById(checklistArray, activeChecklistRowItem.id, { countValue: 1 });
	}, [activeChecklistRowItem, checklistArray, type]);

	const decrementActiveChecklistCount = React.useCallback((): void => {
		if (type !== 'checklist' || !activeChecklistCountItem || !isChecklistCountItem(activeChecklistCountItem)) return;
		const currentCountValue = getChecklistCountValue(activeChecklistCountItem) ?? 1;
		updateChecklistItemById(checklistArray, activeChecklistCountItem.id, { countValue: currentCountValue > 1 ? currentCountValue - 1 : null });
	}, [activeChecklistCountItem, checklistArray, type]);

	const removeActiveChecklistCount = React.useCallback((): void => {
		if (type !== 'checklist' || !activeChecklistCountItem) return;
		updateChecklistItemById(checklistArray, activeChecklistCountItem.id, { countValue: null });
	}, [activeChecklistCountItem, checklistArray, type]);

	const activateChecklistRow = React.useCallback(
		(id: string): void => {
			if (activeChecklistRowId === id) return;
			allowAutomaticChecklistRowFocusRef.current = true;
			suppressAutoActivateAfterDeleteRef.current = false;
			// Row-switch focus handoff (mobile):
			// When moving between checklist rows while the keyboard is open, we
			// focus the proxy textarea first so there is never a frame where no
			// input-like element is focused (which would dismiss the keyboard).
			prepareChecklistRowFocusHandoff();
			setActiveChecklistRowId(id);
			setFocusRowId(id);
		},
		[activeChecklistRowId, prepareChecklistRowFocusHandoff]
	);

	const setChecklistRowInputRef = React.useCallback((id: string, node: HTMLDivElement | null): void => {
		rowInputsRef.current.set(id, node);
	}, []);
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
	const moveFocusToAdjacentChecklistRow = React.useCallback((rowId: string, direction: 'previous' | 'next'): void => {
		const currentIndex = visibleChecklistRowIds.indexOf(rowId);
		if (currentIndex === -1) return;
		const targetId = direction === 'previous'
			? visibleChecklistRowIds[currentIndex - 1] ?? null
			: visibleChecklistRowIds[currentIndex + 1] ?? null;
		if (!targetId) return;
		activateChecklistRow(targetId);
		focusChecklistRowEditor(targetId, direction === 'previous' ? 'end' : 'start');
	}, [activateChecklistRow, focusChecklistRowEditor, visibleChecklistRowIds]);

	const focusChecklistBody = React.useCallback((): void => {
		const targetId = activeItems[0]?.id ?? normalizedItems[0]?.id ?? null;
		if (!targetId) return;
		activateChecklistRow(targetId);
		focusChecklistRowEditor(targetId);
	}, [activateChecklistRow, activeItems, focusChecklistRowEditor, normalizedItems]);

	const pruneEmptyChecklistRows = React.useCallback((): void => {
		if (type !== 'checklist') return;
		if (!checklistArray) return;

		// Remove any rows whose text is blank/whitespace.
		// This runs on close so partially-created rows (e.g. user pressed Enter and
		// never typed into the new row) don't get persisted as empty items.
		const arr = checklistArray.toArray();
		const removedIds = new Set<string>();
		for (const m of arr) {
			const id = String(m.get('id') ?? '').trim();
			if (!id) continue;
			const text = getChecklistItemPlainText(m);
			if (text.trim().length === 0) removedIds.add(id);
		}
		if (removedIds.size === 0) return;

		const doc = (checklistArray as any).doc as Y.Doc | null | undefined;
		const apply = (): void => {
			// Delete from end to start so indices remain stable.
			for (let i = checklistArray.length - 1; i >= 0; i--) {
				const m = checklistArray.get(i);
				if (!m) continue;
				const id = String(m.get('id') ?? '').trim();
				if (id && removedIds.has(id)) {
					checklistArray.delete(i, 1);
				}
			}

			// If any remaining row referenced a deleted parent, clear parentId so the
			// hierarchy stays valid when re-opened.
			for (let i = 0; i < checklistArray.length; i++) {
				const m = checklistArray.get(i);
				if (!m) continue;
				const parentId = typeof m.get('parentId') === 'string' ? String(m.get('parentId')).trim() : '';
				if (parentId && removedIds.has(parentId)) {
					m.set('parentId', null);
				}
			}
		};
		if (doc) doc.transact(apply);
		else apply();
	}, [checklistArray, type]);

	const handleClose = React.useCallback((): void => {
		pruneEmptyChecklistRows();
		void props.onClose();
	}, [pruneEmptyChecklistRows, props]);
	const handleSavePendingNew = React.useCallback((): void => {
		pruneEmptyChecklistRows();
		void props.onSavePendingNew?.();
	}, [pruneEmptyChecklistRows, props]);
	React.useLayoutEffect(() => {
		resizeTitleField();
	}, [resizeTitleField, title]);
	React.useEffect(() => {
		allowAutomaticChecklistRowFocusRef.current = !props.isPendingNew;
		if (!props.isPendingNew || typeof window === 'undefined') return;
		const rafId = window.requestAnimationFrame(() => {
			const field = titleFieldRef.current;
			if (!field) return;
			resizeTitleField();
			field.focus();
			const caret = field.value.length;
			field.setSelectionRange(caret, caret);
		});
		return () => window.cancelAnimationFrame(rafId);
	}, [props.isPendingNew, props.noteId, resizeTitleField]);
	const quickCreateCollectionOption = props.quickCreateCollectionOption;

	const backdropPressStartedRef = React.useRef(false);
	const handleOverlayBackdropPressStart = React.useCallback((event: React.PointerEvent | React.MouseEvent): void => {
		// Only close on clicks that both start and end on the backdrop. That prevents
		// text-selection drags from dismissing the editor when the mouse-up lands outside.
		backdropPressStartedRef.current = event.target === event.currentTarget;
	}, []);
	const handleOverlayBackdropClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>, close: () => void): void => {
		if (mediaDockOpen) return;
		const shouldClose = backdropPressStartedRef.current && event.target === event.currentTarget;
		backdropPressStartedRef.current = false;
		if (shouldClose) close();
	}, [mediaDockOpen]);

	const renderChecklistClone = React.useCallback(
		(
			dragProvided: import('@hello-pangea/dnd').DraggableProvided,
			snapshot: import('@hello-pangea/dnd').DraggableStateSnapshot,
			rubric: import('@hello-pangea/dnd').DraggableRubric
		): React.JSX.Element => {
			const dragged = activeItems.find((item) => item.id === rubric.draggableId) ?? null;
			const { rowWidth, rowHeight, textHeight, textWidth } = dragGhostMetricsRef.current;
			const draggedMap = dragged ? checklistMapsById.get(dragged.id) : undefined;
			const draggedRichJson = draggedMap ? getChecklistItemRichPreviewJson(draggedMap) : null;
			const richPreview = renderRichPreview(draggedRichJson);
			const isActiveClone = dragged !== null && activeChecklistRowId === dragged.id;
			const previewContent = richPreview || dragged?.text || '\u00A0';
			const dragStyle = dragProvided.draggableProps.style ?? {};

			return (
				<li
					ref={dragProvided.innerRef}
					{...dragProvided.draggableProps}
					className={`${styles.checklistItem} ${styles.rowDragging} ${styles.dragGhost}${isActiveClone ? ` ${styles.checklistItemActive}` : ''}${dragged?.parentId ? ` ${styles.childRow}` : ''}`}
					style={{
						...(editorColorStyle ?? {}),
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
					<input type="checkbox" className={styles.checklistCheckbox} checked={Boolean(dragged?.completed)} readOnly />
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
		[activeChecklistRowId, activeItems, checklistMapsById, editorColorStyle, isCoarsePointer, t]
	);

	if (readOnly) {
		return (
			<div
				ref={editorOverlayRefCb}
				className={styles.fullscreenOverlay}
				role="presentation"
				onPointerDownCapture={handleOverlayBackdropPressStart}
				onMouseDownCapture={handleOverlayBackdropPressStart}
				onClick={(event) => handleOverlayBackdropClick(event, props.onClose)}
			>
				<section
					aria-label={`Editor ${props.noteId}`}
					className={`${styles.fullscreenEditor} ${styles.editorContainer} ${styles.editorBlurred}${mediaDockOpen ? ` ${styles.mediaOpen}` : ''}${isCoarsePointer ? ` ${styles.mobileHideToolbar}` : ''}`}
					style={editorShellStyle}
					onClick={(event) => event.stopPropagation()}
				>
					<header className={styles.editorTopBar}>
						<button type="button" className={styles.closeIconButton} onClick={props.onClose} aria-label={t('common.close')}>
							✕
						</button>
					</header>
					<input
						type="text"
						className={styles.editorTitleInput}
						ref={titleFieldRef}
						value={title}
						placeholder={t('editors.titlePlaceholder')}
						readOnly
					/>
					{type === 'text' && richContentFragment ? (
						<div className={styles.fullBodyFieldContainer}>
							<RichTextEditor
								variant="full"
								fragment={richContentFragment}
								placeholder={t('editors.startTyping')}
								hideToolbar
								editable={false}
								viewportClassName={mobileKeyboardOpen ? styles.editorViewportKeyboardOpen : undefined}
								contentClassName={styles.fullBodyFieldRich}
							/>
						</div>
					) : null}
					{type === 'checklist' ? (
						<section aria-label="Checklist" className={`${styles.editorContainer} ${styles.checklistEditorSection}`}>
							<div ref={checklistScrollRef} className={styles.checklistScrollArea}>
								<ul className={styles.checklistList}>
									{activeItems.map((item) => (
										<li key={item.id} className={`${styles.checklistItem}${item.parentId ? ` ${styles.childRow}` : ''}`}>
											<button type="button" className={styles.dragHandle} aria-hidden="true" tabIndex={-1} disabled>
												<FontAwesomeIcon icon={faGripVertical} />
											</button>
											<label className={styles.checklistCheckboxHitArea} aria-hidden="true">
												<input type="checkbox" className={styles.checklistCheckbox} checked={item.completed} readOnly tabIndex={-1} />
											</label>
											<div className={styles.checklistRowPreview}>{renderChecklistPreviewContent(item, item.text || '\u00A0')}</div>
										</li>
									))}
								</ul>
								{completedItems.length > 0 ? (
									<section ref={completedSectionRef} className={styles.completedSection}>
										<div className={styles.completedToggle}>{completedItems.length} {t('editors.completedItems')}</div>
										<ul className={styles.checklistList}>
											{completedItems.map((item) => (
												<li key={item.id} className={`${styles.checklistItem}${item.parentId ? ` ${styles.childRow}` : ''}`}>
													<button type="button" className={styles.dragHandle} aria-hidden="true" tabIndex={-1} disabled>
														<FontAwesomeIcon icon={faGripVertical} />
													</button>
													<label className={styles.checklistCheckboxHitArea} aria-hidden="true">
														<input type="checkbox" className={styles.checklistCheckbox} checked={item.completed} readOnly tabIndex={-1} />
													</label>
													<div className={styles.checklistRowPreview}>{renderChecklistPreviewContent(item, item.text || '\u00A0')}</div>
												</li>
											))}
										</ul>
									</section>
								) : null}
							</div>
						</section>
					) : null}
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

						<nav className={`${styles.bottomDock}${type === 'checklist' ? ` ${styles.bottomDockCompact}` : ''}`} aria-label={t('editors.bottomDock')}>
							<div className={styles.bottomDockLeft}>
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
							<button type="button" className={styles.bottomDockClose} onClick={props.onClose} aria-label={t('common.close')} title={t('common.close')}>
								<FontAwesomeIcon icon={byPrefixAndName.far.xmark} />
							</button>
						</nav>
					</div>}
				</section>

				{isCoarsePointer && !mobileKeyboardOpen ? <section
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
							<button
								type="button"
								className={styles.mediaSheetClose}
								onPointerUp={closeMediaDockFromPointerEvent}
								onClick={closeMediaDock}
								aria-label={t('common.close')}
							>
							✕
						</button>
					</header>

					<div className={styles.mediaSheetBody} onTouchStart={handleMediaSheetTouchStart} onTouchEnd={handleMediaSheetTouchEnd}>
						<div key={`media-panel-${mediaDockTab}`} className={`${styles.mediaPanel} ${styles.mediaPanelAnimated}`} role="tabpanel">
							{renderMediaDockPanel()}
						</div>
					</div>
				</section> : null}

				{!isCoarsePointer ? <aside
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
							<button
								type="button"
								className={styles.mediaFlyoutClose}
								onPointerUp={closeMediaDockFromPointerEvent}
								onClick={closeMediaDock}
								aria-label={t('common.close')}
							>
							✕
						</button>
					</header>
					<div className={styles.mediaFlyoutBody}>
						<div key={`media-panel-${mediaDockTab}`} className={`${styles.mediaPanel} ${styles.mediaPanelAnimated}`} role="tabpanel">
							{renderMediaDockPanel()}
						</div>
					</div>
				</aside> : null}
			</div>
		);
	}

	return (
		<div
			ref={editorOverlayRefCb}
			className={styles.fullscreenOverlay}
			role="presentation"
			onPointerDownCapture={handleOverlayBackdropPressStart}
			onMouseDownCapture={handleOverlayBackdropPressStart}
			onClick={(event) => handleOverlayBackdropClick(event, handleClose)}
		>
			<section
				aria-label={`Editor ${props.noteId}`}
				className={`${styles.fullscreenEditor} ${styles.editorContainer} ${styles.editorBlurred}${mediaDockOpen ? ` ${styles.mediaOpen}` : ''}${interactionGuardActive ? ` ${styles.editorInteractionGuardActive}` : ''}${isCoarsePointer ? ` ${styles.mobileHideToolbar}` : ''}`}
				// Keyboard-open branch:
				// `keyboard.visibleBottom` is the bottom edge of the *visible* viewport from
				// the Visual Viewport API. By clamping the editor to that exact height, the
				// content area physically stops at the keyboard instead of continuing behind it.
				style={editorShellStyle}
				onClick={(event) => event.stopPropagation()}
			>
				{/* ── Hidden focus proxy <textarea> ────────────────────────────────
				    Purpose:
				      Keeps the mobile virtual keyboard visible while the DnD library
				      manipulates the DOM.  The proxy receives focus right before the
				      drag begins (in `onChecklistBeforeCapture`) and holds it until
				      the drag ends, at which point focus returns to the active TipTap
				      editor.

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
				{type === 'checklist' ? (
					<header className={styles.editorTopBar}>
						{props.isPendingNew && isModified && props.onSavePendingNew ? (
							<button
								type="button"
								className={styles.closeIconButton}
								onClick={handleSavePendingNew}
								aria-label={t('common.save')}
								title={t('common.save')}
							>
								<FontAwesomeIcon icon={byPrefixAndName.fas['floppy-disk']} />
							</button>
						) : !props.isPendingNew ? (
							<button
								type="button"
								className={styles.closeIconButton}
								onClick={handleClose}
								aria-label={t('common.save')}
								title={t('common.save')}
							>
								<FontAwesomeIcon icon={byPrefixAndName.fas['floppy-disk']} />
							</button>
						) : null}
						{props.isPendingNew ? <button type="button" className={styles.closeIconButton} onClick={handleClose} aria-label={t('common.close')}>
							✕
						</button> : null}
					</header>
				) : null}

				{type === 'checklist' ? (
					<textarea
						name="note-title"
						autoComplete="off"
						autoCorrect="off"
						autoCapitalize="sentences"
						spellCheck={false}
						data-bwignore="true"
						data-lpignore="true"
						data-1p-ignore="true"
						className={styles.editorTitleInput}
						ref={titleFieldRef}
						rows={1}
						value={title}
						onChange={(e) => setYTextValue(titleYText, e.target.value)}
						onInput={resizeTitleField}
						onKeyDown={(event) => {
							if (event.key !== 'Enter') return;
							event.preventDefault();
							focusChecklistBody();
						}}
						placeholder={t('editors.titlePlaceholder')}
					/>
				) : (
					<textarea
						name="text-note-title"
						autoComplete="off"
						autoCorrect="off"
						autoCapitalize="sentences"
						spellCheck={false}
						data-bwignore="true"
						data-lpignore="true"
						data-1p-ignore="true"
						className={styles.editorTitleInput}
						ref={titleFieldRef}
						rows={1}
						value={title}
						onChange={(e) => setYTextValue(titleYText, e.target.value)}
						onInput={resizeTitleField}
						onKeyDown={(event) => {
							if (event.key !== 'Enter') return;
							event.preventDefault();
							focusTextEditorBody();
						}}
						placeholder={t('editors.titlePlaceholder')}
					/>
				)}

					{quickCreateCollectionOption ? (
						<label className={styles.quickCreateCollectionOption}>
							<input
								type="checkbox"
								checked={quickCreateCollectionOption.checked}
								onChange={(event) => quickCreateCollectionOption.onChange(event.target.checked)}
							/>
							<span className={styles.quickCreateCollectionOptionCopy}>
								Create note in current collection: {quickCreateCollectionOption.label}
							</span>
						</label>
					) : null}

				{type === 'text' && richContentFragment ? (
						<div ref={textBodyFieldRef} className={styles.fullBodyFieldContainer}>
						<RichTextEditor
							variant="full"
							fragment={richContentFragment}
							copyMode={copyMode}
							onCopyModeChange={setCopyMode}
							onClipboardStatusChange={setClipboardStatusMessage}
							toolbarMode={props.toolbarMode}
							placeholder={t('editors.startTyping')}
							hideToolbar={isCoarsePointer}
							suppressMobileTaskCheckboxFocus={isCoarsePointer}
							noteAutoScrollEnabled={noteAutoScrollEnabled}
							onToggleNoteAutoScroll={handleToggleNoteAutoScroll}
							caretVisibilityBottomInset={mobileKeyboardOpen ? keyboardVisibilityPaddingPx : 0}
							// Keyboard-open branch:
							// Reserve just enough space at the bottom of the scrolling viewport for the
							// floating formatting toolbar. This keeps the last editable lines reachable
							// without reintroducing the footer/dock into the scrollable area.
							viewportClassName={mobileKeyboardOpen ? styles.editorViewportKeyboardOpen : undefined}
							contentClassName={styles.fullBodyFieldRich}
							onEditorChange={setTextEditor}
							onCreateUrlPreview={handleCreateUrlPreview}
							onChange={() => {
								syncTextNotePlainText(props.doc, richContentFragment);
							}}
						/>
					</div>
				) : null}

				{type === 'checklist' ? (
					<section aria-label="Checklist" className={`${styles.editorContainer} ${styles.checklistEditorSection}`}>
						<div className={styles.checklistToolbarSlot}>
												<RichTextToolbar editor={activeChecklistRowEditor} variant="minimal" compact toolbarMode={props.toolbarMode} hideStrikeButton applyInlineFormattingToWholeEditor onCreateUrlPreview={handleCreateUrlPreview} noteAutoScrollEnabled={noteAutoScrollEnabled} onToggleNoteAutoScroll={handleToggleNoteAutoScroll} onUndoCheckbox={!readOnly ? undoCheckboxChange : undefined} onRedoCheckbox={!readOnly ? redoCheckboxChange : undefined} checkboxUndoAvail={checkboxUndoAvail} checkboxRedoAvail={checkboxRedoAvail} onMakeChecklistCount={!readOnly && activeChecklistRowItem && !isChecklistCountItem(activeChecklistRowItem) ? makeActiveChecklistCount : undefined} onIncrementChecklistCount={!readOnly && activeChecklistCountItem ? incrementActiveChecklistCount : undefined} onDecrementChecklistCount={!readOnly && activeChecklistCountItem ? decrementActiveChecklistCount : undefined} onRemoveChecklistCount={!readOnly && activeChecklistCountItem ? removeActiveChecklistCount : undefined} />
						</div>
						{/* Keyboard-open branch:
						    Checklist mode does not use the generic rich-text viewport above, so we add
						    the same bottom reserve here manually. The value matches the floating toolbar
						    footprint and keeps the final checklist rows scrollable above it. */}
						<div ref={checklistScrollRef} className={styles.checklistScrollArea} style={mobileKeyboardOpen ? { paddingBottom: `${keyboardVisibilityPaddingPx}px` } : undefined}>
							<DragDropContext
								enableDefaultSensors={false}
								sensors={immediateChecklistSensors}
								onBeforeCapture={onChecklistBeforeCapture}
								onDragStart={onChecklistDragStart}
								onDragEnd={(event) => {
									const scrollEl = checklistScrollRef.current;
									const savedScroll = scrollEl ? scrollEl.scrollTop : null;
									const scrollGuard = (): void => {
										if (scrollEl && savedScroll !== null) scrollEl.scrollTop = savedScroll;
									};
									if (isCoarsePointer && scrollEl) {
										scrollEl.addEventListener('scroll', scrollGuard);
									}
									onChecklistDragEnd(event);
									setDraggingParentId(null);
									resetChecklistDragAxis();
									const removeGuard = (): void => {
										if (!isCoarsePointer || !scrollEl) return;
										setTimeout(() => {
											scrollEl.removeEventListener('scroll', scrollGuard);
										}, 300);
									};
									if (isDraggingWithKeyboardRef.current) {
										requestAnimationFrame(() => {
											isDraggingWithKeyboardRef.current = false;
											if (isCoarsePointer && activeChecklistRowEditor?.view) {
												activeChecklistRowEditor.view.dom.focus({ preventScroll: true });
											} else {
												activeChecklistRowEditor?.commands.focus();
											}
											removeGuard();
										});
									} else {
										removeGuard();
									}
								}}
							>
								<Droppable droppableId={`note-editor-active-${props.noteId}`} renderClone={renderChecklistClone}>
									{(dropProvided) => (
										<ul className={styles.checklistList} ref={dropProvided.innerRef} {...dropProvided.droppableProps}>
												{activeItems.length === 0 ? (
													// Empty-state affordance:
													// If all checklist items have been checked, the active (unchecked)
													// list becomes empty. This ensures the editor still exposes a way to
													// add a new row without forcing the user to uncheck an item first.
													<li className={styles.checklistComposerRow}>
														<div className={styles.dragHandle} aria-hidden="true" />
														<div className={styles.checklistComposerActions}>
															<div className={styles.checklistComposerAction}>
																<input type="checkbox" className={styles.checklistCheckbox} checked={false} readOnly tabIndex={-1} aria-hidden="true" />
																<button
																	type="button"
																	className={styles.checklistAddItemButton}
																	onClick={() => addChecklistItem()}
																	aria-label={checklistAddItemLabel}
																>
																	{checklistAddItemLabel}
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
														className={`${styles.checklistItem}${activeChecklistRowId === item.id ? ` ${styles.checklistItemActive}` : ''}${quickDeleteVisible ? ` ${styles.checklistItemQuickDelete}` : ''}${item.parentId ? ` ${styles.childRow}` : ''}${snapshot.isDragging || (draggingParentId !== null && item.parentId === draggingParentId) ? ` ${styles.rowDragging}` : ''}${draggingParentId !== null && item.parentId === draggingParentId ? ` ${styles.childDraggingWithParent} ${styles.childHiddenDuringParentDrag}` : ''}`}
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
															<ChecklistRowContent
																item={item}
																itemMap={checklistMapsById.get(item.id) ?? null}
																checklistArray={checklistArray}
																contentRef={(node) => setChecklistRowInputRef(item.id, node)}
																isActive={activeChecklistRowId === item.id}
																autoFocus={focusRowId === item.id}
																isProtectedFromEmptyBackspace={firstActiveItemId === item.id}
																placeholderText={checklistItemPlaceholder}
																removeLabel={checklistRemoveLabel}
																caretVisibilityBottomInset={mobileKeyboardOpen ? keyboardVisibilityPaddingPx : 0}
																activate={activateChecklistRow}
																toggleCompleted={toggleChecklistCompleted}
																remove={removeChecklistItem}
																insertAfter={insertChecklistItemAfter}
																setActiveEditor={setActiveChecklistRowEditor}
																onArrowUpAtBoundary={isCoarsePointer ? undefined : () => moveFocusToAdjacentChecklistRow(item.id, 'previous')}
																onArrowDownAtBoundary={isCoarsePointer ? undefined : () => moveFocusToAdjacentChecklistRow(item.id, 'next')}
															/>
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
													onClick={() => addChecklistItem()}
													aria-label={checklistAddItemLabel}
												>
													{checklistAddItemLabel}
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
												<li key={`ghost-${item.id}`} className={`${styles.checklistItem} ${styles.checklistGhostItem}`} aria-hidden="true">
													<button type="button" className={styles.dragHandle} aria-hidden="true" tabIndex={-1} disabled />
													<label className={styles.checklistCheckboxHitArea}>
														<input type="checkbox" className={styles.checklistCheckbox} checked={false} disabled readOnly tabIndex={-1} />
													</label>
													<div className={styles.checklistRowPreview}>
														{renderChecklistPreviewContent(item, renderRichPreview(getChecklistItemRichPreviewJson(checklistMapsById.get(item.id) ?? null)) || item.text || '\u00A0')}
													</div>
												</li>
											) : (
												<li key={item.id} className={`${styles.checklistItem}${activeChecklistRowId === item.id ? ` ${styles.checklistItemActive}` : ''}${quickDeleteVisible ? ` ${styles.checklistItemQuickDelete}` : ''}${item.parentId ? ` ${styles.childRow}` : ''}`}>
													<button type="button" className={styles.dragHandle} aria-hidden="true" tabIndex={-1} disabled>
														<FontAwesomeIcon icon={faGripVertical} />
													</button>
													<ChecklistRowContent
														item={item}
														itemMap={checklistMapsById.get(item.id) ?? null}
														checklistArray={checklistArray}
														contentRef={(node) => setChecklistRowInputRef(item.id, node)}
														isActive={activeChecklistRowId === item.id}
														autoFocus={focusRowId === item.id}
														isProtectedFromEmptyBackspace={false}
														placeholderText={checklistItemPlaceholder}
														removeLabel={checklistRemoveLabel}
														caretVisibilityBottomInset={mobileKeyboardOpen ? keyboardVisibilityPaddingPx : 0}
														activate={activateChecklistRow}
														toggleCompleted={toggleChecklistCompleted}
														remove={removeChecklistItem}
														insertAfter={insertChecklistItemAfter}
														setActiveEditor={setActiveChecklistRowEditor}
															onArrowUpAtBoundary={isCoarsePointer ? undefined : () => moveFocusToAdjacentChecklistRow(item.id, 'previous')}
															onArrowDownAtBoundary={isCoarsePointer ? undefined : () => moveFocusToAdjacentChecklistRow(item.id, 'next')}
													/>
												</li>
											))}
									</ul>
								) : null}
							</section>
						) : null}
						</div>
					</section>
				) : null}

				{/* Keyboard-open branch:
				    When the keyboard is visible, the bottom dock/media handle must not exist in
				    layout at all. Rendering `null` here removes the footer from the document flow,
				    which prevents it from being scrolled into view behind the keyboard. */}
				{mobileKeyboardOpen ? null : <div className={styles.editorBottomArea}>
					<div className={type === 'checklist' ? styles.mobileChecklistMediaRow : undefined}>
						{showMobileChecklistUndoFab ? (
							<div
								className={styles.mobileChecklistUndoFabCluster}
								onPointerDown={(event) => event.stopPropagation()}
								onClick={(event) => event.stopPropagation()}
							>
								<button
									type="button"
									className={styles.mobileChecklistUndoFabButton}
									onClick={undoCheckboxChange}
									disabled={!checkboxUndoAvail}
									aria-label={t('editors.undoCheckbox')}
									title={t('editors.undoCheckbox')}
								>
									<FontAwesomeIcon icon={byPrefixAndName.fas.undo} />
								</button>
								<button
									type="button"
									className={styles.mobileChecklistUndoFabButton}
									onClick={redoCheckboxChange}
									disabled={!checkboxRedoAvail}
									aria-label={t('editors.redoCheckbox')}
									title={t('editors.redoCheckbox')}
								>
									<FontAwesomeIcon icon={byPrefixAndName.fas.redo} />
								</button>
							</div>
						) : null}
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
					</div>

					<nav className={`${styles.bottomDock}${type === 'checklist' ? ` ${styles.bottomDockCompact}` : ''}`} aria-label={t('editors.bottomDock')}>
						<div className={styles.bottomDockLeft}>
							<button
								type="button"
								className={`${styles.bottomDockButton}${type === 'checklist' ? ` ${styles.bottomDockButtonCompact}` : ''}`}
								aria-label={t('editors.dockAction')}
								onClick={(e) => {
									// Capture the trigger button's rect so the desktop popover can anchor
									// to it. (On mobile this is ignored since the menu is a sheet.)
									setMoreMenuAnchorRect(e.currentTarget.getBoundingClientRect().toJSON());
									setIsMoreMenuOpen(true);
								}}
							>
								<FontAwesomeIcon icon={faEllipsisVertical} />
							</button>
							<button
								type="button"
								className={`${styles.bottomDockButton}${type === 'checklist' ? ` ${styles.bottomDockButtonCompact}` : ''}`}
								aria-label={t('noteColors.dialogTitle')}
								onClick={handleOpenColorPicker}
								disabled={readOnly}
							>
								<FontAwesomeIcon icon={faPalette} />
							</button>
							<button
								type="button"
								className={`${styles.bottomDockButton}${type === 'checklist' ? ` ${styles.bottomDockButtonCompact}` : ''}`}
								aria-label={t('noteMenu.addReminder')}
								onClick={() => props.onAddReminder?.()}
								disabled={!props.onAddReminder}
							>
								<FontAwesomeIcon icon={faBell} />
							</button>
							<button type="button" className={`${styles.bottomDockButton}${type === 'checklist' ? ` ${styles.bottomDockButtonCompact}` : ''}`} aria-label={t('noteMenu.addCollaborator')} onClick={() => props.onAddCollaborator?.()} disabled={!props.onAddCollaborator}>
								<FontAwesomeIcon icon={faUserPlus} />
							</button>
							<button type="button" className={`${styles.bottomDockButton}${type === 'checklist' ? ` ${styles.bottomDockButtonCompact}` : ''}`} aria-label={t('noteMenu.addImage')} onClick={handleOpenImageFromMediaDock} disabled={!props.onAddImage}>
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
							{props.isPendingNew ? (
								<button type="button" className={styles.bottomDockClose} onClick={handleClose} aria-label={t('common.close')} title={t('common.close')}>
									<FontAwesomeIcon icon={byPrefixAndName.far.xmark} />
								</button>
							) : null}
							{props.isPendingNew && isModified && props.onSavePendingNew ? (
								<button
									type="button"
									className={styles.bottomDockClose}
									onClick={handleSavePendingNew}
									aria-label={t('common.save')}
									title={t('common.save')}
								>
									<FontAwesomeIcon icon={byPrefixAndName.fas['floppy-disk']} />
								</button>
							) : !props.isPendingNew ? (
								<button
									type="button"
									className={styles.bottomDockClose}
									onClick={handleClose}
									aria-label={t('common.save')}
									title={t('common.save')}
								>
									<FontAwesomeIcon icon={byPrefixAndName.fas['floppy-disk']} />
								</button>
							) : null}
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
			</section>

			{/* Keyboard-open branch:
			    The mobile media sheet is also removed while typing. Even if it is visually off
			    screen, keeping it mounted would preserve extra mobile footer affordances that can
			    interfere with the simplified keyboard-open editing layout. */}
			{isCoarsePointer && !mobileKeyboardOpen ? <section
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
					<button
						type="button"
						className={styles.mediaSheetClose}
						onPointerUp={closeMediaDockFromPointerEvent}
						onClick={closeMediaDock}
						aria-label={t('common.close')}
					>
						✕
					</button>
				</header>

				<div className={styles.mediaSheetBody} onTouchStart={handleMediaSheetTouchStart} onTouchEnd={handleMediaSheetTouchEnd}>
					<div key={`media-panel-${mediaDockTab}`} className={`${styles.mediaPanel} ${styles.mediaPanelAnimated}`} role="tabpanel">
						{renderMediaDockPanel()}
					</div>
				</div>
			</section> : null}

			{!isCoarsePointer ? <aside
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
						<button
							type="button"
							className={styles.mediaFlyoutClose}
							onPointerUp={closeMediaDockFromPointerEvent}
							onClick={closeMediaDock}
							aria-label={t('common.close')}
						>
							✕
						</button>
					</header>
					<div className={styles.mediaFlyoutBody}>
						<div key={`media-panel-${mediaDockTab}`} className={`${styles.mediaPanel} ${styles.mediaPanelAnimated}`} role="tabpanel">
							{renderMediaDockPanel()}
						</div>
					</div>
			</aside> : null}
		{/* Only mount the menu while open so its side-effects are scoped:
		    - mobile history/back-button handling
		    - mobile scroll locking + initial-touch suppression */}
		{isMoreMenuOpen ? (
			<NoteCardMoreMenu
				noteType={type}
				anchorRect={moreMenuAnchorRect}
				isPinned={isPinned}
				onClose={() => {
					setIsMoreMenuOpen(false);
					setMoreMenuAnchorRect(null);
				}}
				onTogglePin={props.onTogglePin ? () => {
					setIsMoreMenuOpen(false);
					setMoreMenuAnchorRect(null);
					props.onTogglePin?.();
				} : undefined}
				onAddCollaborator={props.onAddCollaborator ? () => {
					setIsMoreMenuOpen(false);
					setMoreMenuAnchorRect(null);
					props.onAddCollaborator?.();
				} : undefined}
				onAddImage={props.onAddImage ? () => {
					setIsMoreMenuOpen(false);
					setMoreMenuAnchorRect(null);
					props.onAddImage?.();
				} : undefined}
				onAddDocument={props.onAddDocument ? () => {
					setIsMoreMenuOpen(false);
					setMoreMenuAnchorRect(null);
					props.onAddDocument?.();
				} : undefined}
				onAddReminder={props.onAddReminder ? () => {
					setIsMoreMenuOpen(false);
					setMoreMenuAnchorRect(null);
					props.onAddReminder?.();
				} : undefined}
				onAddToCollection={props.onAddToCollection ? () => {
					setIsMoreMenuOpen(false);
					setMoreMenuAnchorRect(null);
					props.onAddToCollection?.();
				} : undefined}
				onAddLabels={props.onAddLabels ? () => {
					setIsMoreMenuOpen(false);
					setMoreMenuAnchorRect(null);
					props.onAddLabels?.();
				} : undefined}
				onAddUrlPreview={!readOnly ? () => {
					setIsMoreMenuOpen(false);
					setMoreMenuAnchorRect(null);
					handleCreateUrlPreview();
				} : undefined}
				onCheckAll={type === 'checklist' && !readOnly && normalizedItems.length > 0 ? () => {
					setIsMoreMenuOpen(false);
					setMoreMenuAnchorRect(null);
					checkAllChecklistItems();
				} : undefined}
				onUncheckAll={type === 'checklist' && !readOnly && normalizedItems.length > 0 ? () => {
					setIsMoreMenuOpen(false);
					setMoreMenuAnchorRect(null);
					uncheckAllChecklistItems();
				} : undefined}
				onTrash={!readOnly ? () => {
					setIsMoreMenuOpen(false);
					setMoreMenuAnchorRect(null);
					void props.onDelete(props.noteId);
				} : undefined}
			/>
		) : null}

		<NoteColorPickerModal
			isOpen={isColorPickerOpen}
			themeId={props.themeId}
			selectedToken={colorToken}
			onClose={() => setIsColorPickerOpen(false)}
			onSelect={handleSelectNoteColor}
		/>

		{/* Floating keyboard toolbar + occlusion backdrop:
		    The editor shell stops at `keyboard.visibleBottom`, so the remaining layout
		    viewport below that edge must be explicitly covered while the mobile keyboard
		    animates in. Otherwise the underlying notes grid can flash through. */}
		{isCoarsePointer && keyboard.isOpen && !props.hideFormattingToolbar ? createPortal(
			<>
				<div className={styles.keyboardOcclusion} style={{ top: `${keyboard.visibleBottom}px` }} />
				<div
					className={styles.floatingToolbar}
					style={{ top: `${keyboard.visibleBottom}px`, transform: 'translateY(-100%)' }}
				>
					{type === 'text' && clipboardStatusMessage ? <div className={styles.selectionCopyToast} role="status" aria-live="polite">{clipboardStatusMessage}</div> : null}
					<RichTextToolbar
						editor={type === 'text' ? textEditor : activeChecklistRowEditor}
						variant={type === 'text' ? 'full' : 'minimal'}
						compact
						toolbarMode={props.toolbarMode}
						hideStrikeButton={type === 'checklist'}
						applyInlineFormattingToWholeEditor={type === 'checklist'}
						onCreateUrlPreview={handleCreateUrlPreview}
						noteAutoScrollEnabled={noteAutoScrollEnabled}
						onToggleNoteAutoScroll={handleToggleNoteAutoScroll}
						onMakeChecklistCount={type === 'checklist' && activeChecklistRowItem && !isChecklistCountItem(activeChecklistRowItem) ? makeActiveChecklistCount : undefined}
						onIncrementChecklistCount={type === 'checklist' && activeChecklistCountItem ? incrementActiveChecklistCount : undefined}
						onDecrementChecklistCount={type === 'checklist' && activeChecklistCountItem ? decrementActiveChecklistCount : undefined}
						onRemoveChecklistCount={type === 'checklist' && activeChecklistCountItem ? removeActiveChecklistCount : undefined}
						copyMode={type === 'text' ? copyMode : undefined}
						onCopyModeChange={type === 'text' ? setCopyMode : undefined}
					/>
				</div>
			</>,
			document.body
		) : null}
		</div>
	);
}
