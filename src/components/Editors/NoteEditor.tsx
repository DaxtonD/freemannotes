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
	faNoteSticky,
	faListCheck,
	faPencil,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import * as Y from 'yjs';
import { byPrefixAndName } from '../../core/byPrefixAndName';
import type { ChecklistItem } from '../../core/bindings';
import { getChecklistCountPrefix, getChecklistCountValue, isChecklistCountItem, normalizeChecklistCountValue } from '../../core/checklistCounts';
import { applyChecklistDragToItems, buildChecklistCompletedRows, normalizeChecklistHierarchy, toggleChecklistItemCompleted } from '../../core/checklistHierarchy';
import { getChecklistDragAxis, getChecklistHorizontalDirection, registerHorizontalSnapHandler, resetChecklistDragAxis } from '../../core/checklistDragState';
import { getDeviceId } from '../../core/deviceId';
import { getExternalLinkRel, getExternalLinkTarget } from '../../core/externalLinks';
import { immediateChecklistSensors } from '../../core/dndSensors';
import { useChecklistFlip } from '../../core/useChecklistFlip';
import { useI18n } from '../../core/i18n';
import { getUserNoteAutoScrollEnabled, setUserNoteAutoScrollEnabled, subscribeNoteAutoScrollPrefs } from '../../core/noteAutoScrollPreferences';
import { addNotePreviewLinkToDoc, extractNoteLinksFromDoc, removeNotePreviewLinkFromDoc } from '../../core/noteLinks';
import { readEffectiveNoteColorToken, resolveThemeNoteColorModel } from '../../core/noteColors';
import { getUserNoteColorToken, hasUserNoteColorPref, saveUserNoteColorToken, subscribeNoteColorPrefs } from '../../core/noteColorPreferences';
import { getUserNoteBannerFile, saveUserNoteBannerFile, subscribeNoteBannerPrefs } from '../../core/noteBannerPreferences';
import { getNotePinPrefsSnapshot, resolveUserNotePinned, subscribeNotePinPrefs } from '../../core/notePinPreferences';
import {
	createRichTextDocFromPlainText,
	ensureChecklistItemRichContent,
	ensureTextNoteRichContent,
	finalizeCollapsedHeadingWritingForNote,
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
import {
	filterRemoteNoteImagesByPendingDeletes,
	getCachedRemoteNoteImages,
	getNoteMediaChangedEventName,
	readQueuedNoteImageDeletions,
	readQueuedNoteImages,
	readStoredRemoteNoteImages,
} from '../../core/noteMediaStore';
import { readDrawingLinkState } from '../../core/noteModel';
import { NoteMediaPanel } from '../NoteMedia/NoteMediaPanel';
import { NoteLinkPanel } from '../NoteLinks/NoteLinkPanel';
import { NoteColorPickerModal } from '../NoteCard/NoteColorPickerModal';
import { NoteBannerPickerModal } from '../NoteCard/NoteBannerPickerModal';
import { NoteCardMoreMenu } from '../NoteCard/NoteCardMoreMenu';
import { DrawingsPanel } from './DrawingsPanel';
import { RichTextEditor, RichTextToolbar, ensureEditorSelectionVisible, focusRichTextEditable } from './RichTextEditor';
import styles from './Editors.module.css';
import { readEffectiveNoteBannerFile } from '../../core/noteBanners';
import { assignNoteBannerFile } from '../../services/noteService';
import { writeNoteBannerWarmCacheFile } from '../../core/noteBannerWarmCache';
import { closeReferenceSuggestion } from '../../core/extensions/ReferenceExtension';

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
	onOpenDrawing?: (drawingId: string) => void;
	onDeleteDrawing?: (drawingId: string) => Promise<void> | void;
	loadDrawingDoc?: (drawingId: string) => Promise<Y.Doc | null>;
	onAddReminder?: () => void;
	onAddToCollection?: () => void;
	onAddLabels?: () => void;
	onOpenNote?: (noteId: string) => void;
	onShowBriefDialog?: (message: string) => void;
	/** Depth in the note-link navigation chain (0 = root note, >0 = linked note). */
	noteNavDepth?: number;
	/** Go back one step in the note chain. Available when noteNavDepth > 0. */
	onNavBack?: () => void;
	/** Go forward one step (desktop only). Available when canNavForward is true. */
	onNavForward?: () => void;
	/** True when desktop forward navigation is available. */
	canNavForward?: boolean;
	readOnly?: boolean;
	initialShowCompleted?: boolean;
	onShowCompletedChange?: (next: boolean) => void;
	allowQuickDelete?: boolean;
	toolbarMode?: EditorToolbarMode;
	/** When true, the close button always shows an X (discard) regardless of modification state. */
	isPendingNew?: boolean;
	/** When true, suppresses the floating keyboard toolbar (e.g. while the image upload modal is open). */
	hideFormattingToolbar?: boolean;
	scrollToMentionNodeId?: string | null;
	/** Called when the current user inserts an @mention to themselves so the
	 *  caller can create an optimistic inbox notification. */
	onSelfMentionInserted?: (noteId: string, workspaceId: string, nodeId: string, noteTitle: string | null) => void;
};

type NoteType = 'text' | 'checklist';

const EMPTY_ITEMS: readonly ChecklistItem[] = [];

function sanitizeMediaDockTab(value: unknown): 0 | 1 | 2 {
	return value === '1' || value === 1 ? 1 : value === '2' || value === 2 ? 2 : 0;
}

function readStoredMediaDockTab(noteId: string): 0 | 1 | 2 {
	try {
		return sanitizeMediaDockTab(sessionStorage.getItem(`__freemannotes_mediaDockTab:${noteId}`));
	} catch {
		return 0;
	}
}

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
 * Handles bold, italic, underline, and hard breaks — no TipTap instance needed.
 */
function renderRichPreview(json: import('@tiptap/core').JSONContent | null | undefined, onNoteClick?: (noteId: string) => void): React.ReactNode {
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
	const elements = json.content.map((block, bi) => {
		if (block.type !== 'paragraph') return null;
		if (!block.content || block.content.length === 0) return bi > 0 ? <br key={bi} /> : null;
		hasContent = true;
		return (
			<React.Fragment key={bi}>
				{bi > 0 ? <br /> : null}
				{block.content.map((node, ni) => {
					if (node.type === 'hardBreak') return <br key={ni} />;
					if (node.type === 'reference') {
						const label     = typeof node.attrs?.label     === 'string' ? node.attrs.label     : '';
						const id        = typeof node.attrs?.id        === 'string' ? node.attrs.id        : '';
						const refType   = node.attrs?.type;
						const noteType  = node.attrs?.noteType ?? null;
						const avatarUrl = typeof node.attrs?.avatarUrl === 'string' ? node.attrs.avatarUrl : null;
						const isNote    = refType === 'note';
						const isUser    = refType === 'user';
						const icon      = isNote ? previewNoteTypeIcon(noteType) : null;
						const chipContent = (
							<>
								{icon && <FontAwesomeIcon icon={icon} className={styles.referenceChipPreviewIcon} />}
								{isUser && avatarUrl && <img src={avatarUrl} className={styles.referenceChipPreviewAvatar} alt="" aria-hidden />}
								{label}
							</>
						);
						if (isNote && id && onNoteClick) {
							return (
								<span key={ni} className={styles.referenceChipPreview} role="button" onClick={(e) => { e.stopPropagation(); onNoteClick(id); }}>
									{chipContent}
								</span>
							);
						}
						return <span key={ni} className={styles.referenceChipPreview}>{chipContent}</span>;
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

function normalizeChecklistAutocompleteText(value: string): string {
	return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function matchesChecklistAutocompleteCandidate(normalizedCandidate: string, normalizedTyped: string): boolean {
	if (!normalizedTyped) return false;
	if (normalizedCandidate.startsWith(normalizedTyped)) return true;
	return normalizedCandidate.split(' ').some((part) => part.startsWith(normalizedTyped));
}

function getChecklistAutocompleteSuggestion(
	items: readonly ChecklistItem[],
	rowId: string | null,
	currentText: string
): string | null {
	if (!rowId) return null;
	const normalizedTyped = normalizeChecklistAutocompleteText(currentText);
	if (!normalizedTyped) return null;
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const candidate = items[index];
		if (candidate.id === rowId) continue;
		const candidateText = String(candidate.text ?? '').trim();
		if (!candidateText) continue;
		const normalizedCandidate = normalizeChecklistAutocompleteText(candidateText);
		if (!normalizedCandidate || normalizedCandidate === normalizedTyped) continue;
		if (matchesChecklistAutocompleteCandidate(normalizedCandidate, normalizedTyped)) {
			return candidateText;
		}
	}
	return null;
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
	acceptSuggestion?: (id: string, suggestion: string) => void;
	acceptSuggestionAndInsert?: (id: string, suggestion: string) => void;
	onTextChange?: (id: string, text: string) => void;
	autocompleteText?: string;
	autocompleteSuffix?: string;
	autocompleteSuggestion?: string | null;
	setActiveEditor: (editor: Editor | null) => void;
	onArrowUpAtBoundary?: () => void;
	onArrowDownAtBoundary?: () => void;
	onNoteClick?: (noteId: string) => void;
	authUserId?: string | null;
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
		acceptSuggestion,
		acceptSuggestionAndInsert,
		onTextChange,
		autocompleteText,
		autocompleteSuffix,
		autocompleteSuggestion,
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
	const preventCheckboxFocusSteal = React.useCallback((event: React.SyntheticEvent): void => {
		event.preventDefault();
	}, []);

	const handleRemove = React.useCallback((): void => {
		remove(item.id);
	}, [item.id, remove]);

	const handleInsertAfter = React.useCallback((editor: Editor): void => {
		if (autocompleteSuggestion && acceptSuggestionAndInsert) {
			acceptSuggestionAndInsert(item.id, autocompleteSuggestion);
			return;
		}
		insertAfter(item.id, editor);
	}, [acceptSuggestionAndInsert, autocompleteSuggestion, insertAfter, item.id]);
	const handleActiveAutocompletePress = React.useCallback((event: React.SyntheticEvent): void => {
		if (!autocompleteSuggestion || !acceptSuggestion) return;
		event.preventDefault();
		acceptSuggestion(item.id, autocompleteSuggestion);
	}, [acceptSuggestion, autocompleteSuggestion, item.id]);

	if (!isActive) {
		const previewMap = itemMap ?? findChecklistItemMapById(checklistArray, item.id);
		const richPreview = renderRichPreview(previewMap ? getChecklistItemRichPreviewJson(previewMap) : null, props.onNoteClick);

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
					onMouseDown={preventCheckboxFocusSteal}
					onPointerDown={preventCheckboxFocusSteal}
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
					onMouseDown={preventCheckboxFocusSteal}
					onPointerDown={preventCheckboxFocusSteal}
					onChange={handleToggleCompleted}
				/>
			</label>
			{liveItemMap && fragment ? (
				<div
					ref={contentRef}
					className={styles.checklistRowRichShell}
					onMouseDown={autocompleteSuggestion ? handleActiveAutocompletePress : undefined}
					onPointerDown={autocompleteSuggestion ? handleActiveAutocompletePress : undefined}
					onClick={autocompleteSuggestion ? handleActiveAutocompletePress : undefined}
				>
					{getChecklistCountPrefix(item) ? <span className={styles.checklistCountPrefix} aria-hidden="true">{getChecklistCountPrefix(item)}</span> : null}
					<div className={styles.checklistRowRichStack}>
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
							viewportClassName={styles.checklistRowRichViewport}
							contentClassName={styles.checklistRowRichEditor}
							onEditorChange={setActiveEditor}
							onChange={() => {
								const nextText = syncChecklistItemPlainText(liveItemMap, fragment);
								onTextChange?.(item.id, nextText);
							}}
							onEnter={handleInsertAfter}
							onShiftEnter={() => undefined}
							onBackspaceWhenEmpty={() => {
								if (isProtectedFromEmptyBackspace) return;
								remove(item.id);
							}}
							onArrowUpAtBoundary={onArrowUpAtBoundary}
							onArrowDownAtBoundary={onArrowDownAtBoundary}
							onNoteClick={props.onNoteClick}
							authUserId={props.authUserId}
						/>
						{autocompleteSuffix ? (
							<div className={styles.checklistAutocompleteOverlay} aria-hidden="true">
								<span className={styles.checklistAutocompletePrefix}>{autocompleteText}</span>
								<span className={styles.checklistAutocompleteSuffix}>{autocompleteSuffix}</span>
							</div>
						) : null}
					</div>
				</div>
			) : (
				<div ref={contentRef} className={styles.checklistRowPreview} onClick={handleActivate}>
					{renderChecklistPreviewContent(item, item.text || '\u00A0')}
				</div>
			)}
			<button
				type="button"
				className={styles.rowRemoveButton}
				onMouseDown={preventCheckboxFocusSteal}
				onPointerDown={preventCheckboxFocusSteal}
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
	prev.acceptSuggestion === next.acceptSuggestion &&
	prev.acceptSuggestionAndInsert === next.acceptSuggestionAndInsert &&
	prev.onTextChange === next.onTextChange &&
	prev.autocompleteText === next.autocompleteText &&
	prev.autocompleteSuffix === next.autocompleteSuffix &&
	prev.autocompleteSuggestion === next.autocompleteSuggestion &&
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
	const [mediaDockOpen, setMediaDockOpen] = React.useState(false);
	const [mediaSheetProgress, setMediaSheetProgress] = React.useState(0);
	const [isMediaSheetDragging, setIsMediaSheetDragging] = React.useState(false);
	const [isMediaSheetClosing, setIsMediaSheetClosing] = React.useState(false);
	const [mediaDockTab, setMediaDockTab] = React.useState<0 | 1 | 2>(() => readStoredMediaDockTab(props.noteId));
	// More-menu state (editor 3-dot button):
	// - Desktop: anchored popover positioned relative to the trigger button rect.
	// - Mobile: bottom sheet menu (anchor rect is ignored).
	const [isMoreMenuOpen, setIsMoreMenuOpen] = React.useState(false);
	const [moreMenuAnchorRect, setMoreMenuAnchorRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);
	const [isColorPickerOpen, setIsColorPickerOpen] = React.useState(false);
	const [isBannerPickerOpen, setIsBannerPickerOpen] = React.useState(false);
	const mediaFlyoutRef = React.useRef<HTMLElement | null>(null);
	const mediaSheetRef = React.useRef<HTMLElement | null>(null);
	const mediaSheetDragRef = React.useRef<{
		startX: number;
		startY: number;
		startTime: number;
		startProgress: number;
		sheetHeight: number;
		lastY: number;
		lastTime: number;
		verticalLocked: boolean;
	} | null>(null);
	const ignoreNextMediaDockClickRef = React.useRef(false);
	// Track the previous noteId so the dock-reset effect only fires on actual note
	// switches, not on the initial mount. Without this, the reset runs on first open
	// and the carried touch from the card tap can bump mediaSheetProgress and trigger
	// the close animation (media handle slides up then fades). See memory/editor-and-checklist.md.
	const prevEditorNoteIdRef = React.useRef<string | null>(null);
	// Suppress media-sheet drag gestures for a short window after any note open.
	// The touch that tapped the card to open the editor can carry into the handle
	// area and start an unintended drag if not blocked.
	const mediaSheetGestureSuppressUntilRef = React.useRef(0);
	const titleFieldRef = React.useRef<(HTMLTextAreaElement & HTMLInputElement) | null>(null);
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

	const isMediaSheetGestureSuppressed = React.useCallback((): boolean => {
		return typeof performance !== 'undefined'
			? performance.now() < mediaSheetGestureSuppressUntilRef.current
			: false;
	}, []);

	React.useEffect(() => {
		if (isMediaSheetDragging) return;
		if (isMediaSheetGestureSuppressed()) {
			// Carried touch from the card tap is still active. Snap progress back to
			// zero immediately — do not play the close animation or it looks like the
			// panel auto-opens and then slides away on its own.
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
		// Only reset dock state when actually switching notes (prevEditorNoteIdRef is
		// non-null and differs). On first mount we intentionally skip the reset so the
		// noteId effect does not race with the carried touch from the card tap.
		const switchedNote = prevEditorNoteIdRef.current !== null && prevEditorNoteIdRef.current !== props.noteId;
		if (switchedNote) {
			setMediaDockOpen(false);
			setMediaSheetProgress(0);
			setIsMediaSheetClosing(false);
			setIsMediaSheetDragging(false);
		}
		prevEditorNoteIdRef.current = props.noteId;
		setMediaDockTab(readStoredMediaDockTab(props.noteId));
		// Suppress drag gestures for 450ms after every open/switch so the touch that
		// opened this note cannot accidentally trigger the media sheet drag.
		mediaSheetGestureSuppressUntilRef.current = (
			typeof performance !== 'undefined' ? performance.now() : Date.now()
		) + 450;
	}, [props.noteId]);
	React.useEffect(() => {
		try {
			sessionStorage.setItem(`__freemannotes_mediaDockTab:${props.noteId}`, String(mediaDockTab));
		} catch {
			/* */
		}
	}, [mediaDockTab, props.noteId]);
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
	const linkedDrawingIdsSnapshot = useSyncExternalStore(
		(onStoreChange) => {
			if (!props.isPendingNew) return () => {};
			const drawingIds = props.doc.getArray<string>('drawingIds');
			const observer = (): void => onStoreChange();
			drawingIds.observe(observer);
			props.doc.on('afterTransaction', observer);
			return () => {
				drawingIds.unobserve(observer);
				props.doc.off('afterTransaction', observer);
			};
		},
		() => (props.isPendingNew ? JSON.stringify(readDrawingLinkState(props.doc).drawingIds) : '[]'),
		() => (props.isPendingNew ? JSON.stringify(readDrawingLinkState(props.doc).drawingIds) : '[]'),
	);
	const linkedDrawingIds = React.useMemo(() => {
		if (!props.isPendingNew) return [];
		try {
			const parsed = JSON.parse(linkedDrawingIdsSnapshot);
			return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
		} catch {
			return [];
		}
	}, [linkedDrawingIdsSnapshot, props.isPendingNew]);
	const [pendingNewImageCount, setPendingNewImageCount] = React.useState(0);
	React.useEffect(() => {
		if (!props.isPendingNew) return;
		let cancelled = false;
		const refreshImageCount = async (): Promise<void> => {
			const [queuedImages, queuedDeletes, storedRemoteImages] = await Promise.all([
				props.authUserId ? readQueuedNoteImages(props.authUserId, props.docId) : Promise.resolve([]),
				props.authUserId ? readQueuedNoteImageDeletions(props.authUserId, props.docId) : Promise.resolve([]),
				readStoredRemoteNoteImages(props.docId),
			]);
			const remoteImages = storedRemoteImages.length > 0
				? storedRemoteImages
				: getCachedRemoteNoteImages(props.docId);
			const nextCount = filterRemoteNoteImagesByPendingDeletes(remoteImages, queuedDeletes).length + queuedImages.length;
			if (!cancelled) {
				setPendingNewImageCount((current) => (current === nextCount ? current : nextCount));
			}
		};
		void refreshImageCount();
		const eventName = getNoteMediaChangedEventName();
		const onMediaChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string }>).detail;
			if (!detail?.docId || detail.docId === props.docId) {
				void refreshImageCount();
			}
		};
		window.addEventListener(eventName, onMediaChanged as EventListener);
		return () => {
			cancelled = true;
			window.removeEventListener(eventName, onMediaChanged as EventListener);
		};
	}, [props.authUserId, props.docId, props.isPendingNew]);
	const handleCreateUrlPreview = React.useCallback((): void => {
		if (readOnly) return;
		const next = window.prompt(t('links.prompt'), 'https://');
		if (!next) return;
		const added = addNotePreviewLinkToDoc(props.doc, next);
		if (!added) return;
		void syncNoteLinksForDoc({
			userId: props.authUserId,
			docId: props.docId,
			links: extractNoteLinksFromDoc(props.doc),
		});
		props.onShowBriefDialog?.(t('links.addedToast'));
	}, [props.authUserId, props.doc, props.docId, props.onShowBriefDialog, readOnly, t]);
	const handleDeleteUrlPreview = React.useCallback((normalizedUrl: string): void => {
		if (readOnly) return;
		removeNotePreviewLinkFromDoc(props.doc, normalizedUrl);
		void syncNoteLinksForDoc({
			userId: props.authUserId,
			docId: props.docId,
			links: extractNoteLinksFromDoc(props.doc),
		});
	}, [props.authUserId, props.doc, props.docId, readOnly]);

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
	// Ref for the editor overlay DOM node.  Used to check whether the
	// keyboard-triggering element is inside the editor (vs. a higher-z-index
	// modal like NoteImageUploadModal).  Camera Activity transitions on Android
	// cause transient Visual Viewport shrinks that look like a keyboard to
	// useKeyboardHeight — this ref lets us ignore those false positives.
	const editorOverlayRefCb = React.useRef<HTMLDivElement | null>(null);
	// Mobile-only keyboard branch:
	// - `useKeyboardHeight()` is driven by the Visual Viewport API, so `keyboard.isOpen`
	//   reflects whether the on-screen keyboard has reduced the visible viewport.
	// - We intentionally gate this branch by `isCoarsePointer` because desktop virtual
	//   keyboards and narrow windows should keep the normal dock/media layout.
	// - Only treat the keyboard as editor-hosted when focus lives inside the editor
	//   overlay and no higher-z image-upload modal is open; camera/file-picker viewport
	//   shrinks otherwise hide the media handle until the note is reopened.
	// - Downstream, this flag removes the mobile dock/media sheet from layout entirely
	//   so the editor body ends at the keyboard instead of allowing hidden footer UI to
	//   remain scrollable beneath the visible editing surface.
	const mobileKeyboardOpen = React.useMemo(() => {
		if (!isCoarsePointer || !keyboard.isOpen) return false;
		if (props.hideFormattingToolbar) return false;
		if (typeof document === 'undefined') return false;
		if (document.body.dataset.freemannotesNoteImageUploadOpen === 'true') return false;
		const active = document.activeElement;
		if (!(active instanceof HTMLElement) || !editorOverlayRefCb.current?.contains(active)) return false;
		return true;
	}, [isCoarsePointer, keyboard.isOpen, keyboard.visibleBottom, props.hideFormattingToolbar]);
	const dismissEditorOverlayFocus = React.useCallback((): void => {
		if (typeof document === 'undefined') return;
		const active = document.activeElement;
		if (!(active instanceof HTMLElement) || !editorOverlayRefCb.current?.contains(active)) return;
		active.blur();
		window.getSelection()?.removeAllRanges();
	}, []);
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
	React.useEffect(() => {
		if (!mediaDockOpen || isCoarsePointer || typeof document === 'undefined') return;
		const handlePointerDown = (event: PointerEvent): void => {
			if (document.body.dataset.freemannotesNoteImageUploadOpen === 'true') return;
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (mediaFlyoutRef.current?.contains(target)) return;
			if (target.closest('[data-note-editor-media-dock-trigger="true"]')) return;
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
	const clampMediaSheetProgress = React.useCallback((value: number): number => Math.max(0, Math.min(1, value)), []);
	const getMediaSheetHeight = React.useCallback((): number => {
		const currentHeight = mediaSheetRef.current?.getBoundingClientRect().height ?? 0;
		if (Number.isFinite(currentHeight) && currentHeight > 0) return currentHeight;
		if (typeof window === 'undefined') return 620;
		return Math.min(window.innerHeight * 0.72, 620);
	}, []);
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
		const gestureTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
		event.stopPropagation();
		setIsMediaSheetClosing(false);
		mediaSheetDragRef.current = {
			startX: t0.clientX,
			startY: t0.clientY,
			startTime: gestureTime,
			startProgress: mediaSheetProgress,
			sheetHeight: getMediaSheetHeight(),
			lastY: t0.clientY,
			lastTime: gestureTime,
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
			if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.1) {
				mediaSheetDragRef.current = null;
				setIsMediaSheetDragging(false);
				setMediaSheetProgress(mediaDockOpen ? 1 : 0);
				return;
			}
			if (Math.abs(dy) <= 4 || Math.abs(dy) < Math.abs(dx) * 0.55) return;
			gesture.verticalLocked = true;
		}

		if (event.cancelable) event.preventDefault();
		gesture.lastY = t0.clientY;
		gesture.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
		setIsMediaSheetDragging(true);
		setMediaSheetProgress(clampMediaSheetProgress(gesture.startProgress - (dy / Math.max(gesture.sheetHeight, 1))));
	}, [clampMediaSheetProgress, isMediaSheetGestureSuppressed, mediaDockOpen]);
	const handleMediaDockDragEnd = React.useCallback((event: React.TouchEvent): void => {
		if (isMediaSheetGestureSuppressed()) {
			// Discard the gesture completely — clean up any partial state so the sheet
			// is not left in a dragging/mid-progress limbo after the suppress window ends.
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
		const touch = event.changedTouches[0];
		const endY = touch?.clientY ?? gesture.lastY;
		const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
		const totalDy = endY - gesture.startY;
		const totalDt = Math.max(endTime - gesture.startTime, 1);
		const recentDy = endY - gesture.lastY;
		const recentDt = Math.max(endTime - gesture.lastTime, 1);
		const recentVelocity = recentDy / recentDt;
		const isQuickOpenFlick = (totalDy < -18 && totalDt < 240) || recentVelocity < -0.35;
		const isQuickCloseFlick = (totalDy > 18 && totalDt < 240) || recentVelocity > 0.35;
		ignoreNextMediaDockClickRef.current = true;
		const shouldOpen = isQuickOpenFlick
			? true
			: isQuickCloseFlick
				? false
				: gesture.startProgress >= 0.5
					? mediaSheetProgress > 0.66
					: mediaSheetProgress >= 0.24;
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
			if (typeof document !== 'undefined' && document.body.dataset.freemannotesNoteImageUploadOpen === 'true') return;
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
	const handleSelectMediaDockTabFromTouch = React.useCallback((tab: 0 | 1 | 2, event: React.TouchEvent<HTMLButtonElement>): void => {
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
		dockTouchStartRef.current = null;
		setMediaDockTab(tab);
	}, []);
	const handleOpenImageFromMediaDock = React.useCallback((): void => {
		// Bottom-dock Add Image should match the in-panel flow: expand the media sheet
		// first so the upload modal stacks above it and the sheet stays open afterward.
		if (isCoarsePointer && !isMobileLandscapeRef.current) {
			setMediaDockTab(0);
			setIsMediaSheetClosing(false);
			setMediaDockOpen(true);
			setMediaSheetProgress(1);
		}
		props.onAddImage?.();
	}, [isCoarsePointer, props.onAddImage]);
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
		return (
			<DrawingsPanel
				doc={props.doc}
				canEdit={!readOnly}
				onAddDrawing={props.onAddDocument}
				onOpenDrawing={props.onOpenDrawing}
				onDeleteDrawing={props.onDeleteDrawing}
				loadDrawingDoc={props.loadDrawingDoc}
			/>
		);
	}, [extractedLinks, handleCreateUrlPreview, handleDeleteUrlPreview, handleOpenImageFromMediaDock, mediaDockTab, props.doc, props.loadDrawingDoc, props.onAddDocument, props.onAddImage, props.onDeleteDrawing, props.onOpenDrawing, props.isPendingNew, readOnly]);
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
	const canSavePendingNew = React.useMemo(
		() => isModified
			|| (props.isPendingNew && (
				extractedLinks.length > 0
				|| linkedDrawingIds.length > 0
				|| pendingNewImageCount > 0
			)),
		[extractedLinks.length, isModified, linkedDrawingIds.length, pendingNewImageCount, props.isPendingNew],
	);
	const checklistScrollRef = React.useRef<HTMLDivElement | null>(null);
	const completedSectionRef = React.useRef<HTMLElement | null>(null);
	const [focusRowId, setFocusRowId] = React.useState<string | null>(null);
	const [activeChecklistRowId, setActiveChecklistRowId] = React.useState<string | null>(null);
	const [activeChecklistAutocompleteText, setActiveChecklistAutocompleteText] = React.useState('');
	const [activeChecklistRowEditor, setActiveChecklistRowEditor] = React.useState<Editor | null>(null);
	const [activeChecklistRowHistoryState, setActiveChecklistRowHistoryState] = React.useState({ canUndo: false, canRedo: false });
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
	// Set true on title Enter-key press; cleared by the activeChecklistRowEditor
	// effect below so focus transfers via editor.commands.focus() once TipTap is ready.
	const needsFocusAfterTitleEnterRef = React.useRef(false);
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

	// Close the @ mention dropdown when the media panel opens so it doesn't
	// float over the panel. Uses closeReferenceSuggestion (synchronous hide +
	// view.dom.blur) instead of editor.commands.blur (rAF-deferred, unreliable
	// on iOS Safari where the browser can undo the blur before it executes).
	React.useEffect(() => {
		if (!mediaDockOpen) return;
		if (textEditor && !textEditor.isDestroyed) closeReferenceSuggestion(textEditor);
		if (activeChecklistRowEditor && !activeChecklistRowEditor.isDestroyed) closeReferenceSuggestion(activeChecklistRowEditor);
	}, [mediaDockOpen, textEditor, activeChecklistRowEditor]);

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
	const noteBannerFile = useSyncExternalStore(
		(onStoreChange) => {
			const unsubscribePrefs = subscribeNoteBannerPrefs(onStoreChange);
			const observer = (): void => onStoreChange();
			metadata.observe(observer);
			return () => {
				unsubscribePrefs();
				metadata.unobserve(observer);
			};
		},
		() => readEffectiveNoteBannerFile(metadata, getUserNoteBannerFile(props.noteId)),
		() => readEffectiveNoteBannerFile(metadata, getUserNoteBannerFile(props.noteId))
	);
	const typeValue = useMetadataString(metadata, 'type');
	const type: NoteType = typeValue === 'checklist' ? 'checklist' : 'text';
	const [textHistoryState, setTextHistoryState] = React.useState({ canUndo: false, canRedo: false });
	const updateTextHistoryState = React.useCallback((editor: Editor | null): void => {
		if (!editor) {
			setTextHistoryState((prev) => (prev.canUndo || prev.canRedo ? { canUndo: false, canRedo: false } : prev));
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
		setTextHistoryState((prev) => (prev.canUndo === canUndo && prev.canRedo === canRedo
			? prev
			: { canUndo, canRedo }));
	}, []);
	React.useEffect(() => {
		if (!textEditor) {
			updateTextHistoryState(null);
			return;
		}
		const handleHistoryChange = (): void => {
			updateTextHistoryState(textEditor);
		};
		handleHistoryChange();
		textEditor.on('transaction', handleHistoryChange);
		textEditor.on('selectionUpdate', handleHistoryChange);
		textEditor.on('focus', handleHistoryChange);
		textEditor.on('blur', handleHistoryChange);
		return () => {
			textEditor.off('transaction', handleHistoryChange);
			textEditor.off('selectionUpdate', handleHistoryChange);
			textEditor.off('focus', handleHistoryChange);
			textEditor.off('blur', handleHistoryChange);
		};
	}, [textEditor, updateTextHistoryState]);
	const updateActiveChecklistRowHistoryState = React.useCallback((editor: Editor | null): void => {
		if (!editor) {
			setActiveChecklistRowHistoryState((prev) => (prev.canUndo || prev.canRedo ? { canUndo: false, canRedo: false } : prev));
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
		setActiveChecklistRowHistoryState((prev) => (prev.canUndo === canUndo && prev.canRedo === canRedo
			? prev
			: { canUndo, canRedo }));
	}, []);
	React.useEffect(() => {
		if (!activeChecklistRowEditor) {
			updateActiveChecklistRowHistoryState(null);
			return;
		}
		const handleHistoryChange = (): void => {
			updateActiveChecklistRowHistoryState(activeChecklistRowEditor);
		};
		handleHistoryChange();
		activeChecklistRowEditor.on('transaction', handleHistoryChange);
		activeChecklistRowEditor.on('selectionUpdate', handleHistoryChange);
		activeChecklistRowEditor.on('focus', handleHistoryChange);
		activeChecklistRowEditor.on('blur', handleHistoryChange);
		return () => {
			activeChecklistRowEditor.off('transaction', handleHistoryChange);
			activeChecklistRowEditor.off('selectionUpdate', handleHistoryChange);
			activeChecklistRowEditor.off('focus', handleHistoryChange);
			activeChecklistRowEditor.off('blur', handleHistoryChange);
		};
	}, [activeChecklistRowEditor, updateActiveChecklistRowHistoryState]);
	const canRunChecklistPrimaryUndo = activeChecklistRowHistoryState.canUndo || checkboxUndoAvail;
	const canRunChecklistPrimaryRedo = activeChecklistRowHistoryState.canRedo || checkboxRedoAvail;
	const handleChecklistPrimaryUndo = (): void => {
		if (activeChecklistRowHistoryState.canUndo && activeChecklistRowEditor) {
			try {
				const chain = activeChecklistRowEditor.chain().focus() as { undo?: () => { run: () => boolean } };
				if (typeof chain.undo === 'function') {
					chain.undo().run();
				}
				return;
			} catch {
				// Ignore transient editor teardown while the dock is animating.
			}
		}
		undoCheckboxChange();
	};
	const handleChecklistPrimaryRedo = (): void => {
		if (activeChecklistRowHistoryState.canRedo && activeChecklistRowEditor) {
			try {
				const chain = activeChecklistRowEditor.chain().focus() as { redo?: () => { run: () => boolean } };
				if (typeof chain.redo === 'function') {
					chain.redo().run();
				}
				return;
			} catch {
				// Ignore transient editor teardown while the dock is animating.
			}
		}
		redoCheckboxChange();
	};
	// FAB variants for checklist — see handleTextUndoNoFocus for full rationale.
	const handleChecklistPrimaryUndoNoFocus = (): void => {
		if (activeChecklistRowHistoryState.canUndo && activeChecklistRowEditor) {
			try {
				const chain = activeChecklistRowEditor.chain() as { undo?: () => { run: () => boolean } };
				if (typeof chain.undo === 'function') { chain.undo().run(); return; }
			} catch {}
		}
		undoCheckboxChange();
	};
	const handleChecklistPrimaryRedoNoFocus = (): void => {
		if (activeChecklistRowHistoryState.canRedo && activeChecklistRowEditor) {
			try {
				const chain = activeChecklistRowEditor.chain() as { redo?: () => { run: () => boolean } };
				if (typeof chain.redo === 'function') { chain.redo().run(); return; }
			} catch {}
		}
		redoCheckboxChange();
	};
	// Mirror the draft checklist editor: only surface the mobile undo/redo affordance
	// when checklist history exists and no competing mobile overlay is open.
	// Unlike text notes, checklist row editing should keep the footer history buttons
	// available while the keyboard is open so they remain beside the media handle.
	const showMobileChecklistUndoFab = isCoarsePointer
		&& type === 'checklist'
		&& !readOnly
		&& !mediaDockOpen
		&& !isMoreMenuOpen
		&& (canRunChecklistPrimaryUndo || canRunChecklistPrimaryRedo);
	const showMobileTextUndoFab = isCoarsePointer
		&& type === 'text'
		&& !readOnly
		&& !mobileKeyboardOpen
		&& !mediaDockOpen
		&& !isMoreMenuOpen
		&& (textHistoryState.canUndo || textHistoryState.canRedo);
	const showMobileHistoryFab = showMobileChecklistUndoFab || showMobileTextUndoFab;
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
				'--note-editor-control': resolvedColor.token === 'white' ? '#000000' : resolvedColor.textColor,
				'--note-editor-control-accent': resolvedColor.token === 'white' ? '#000000' : resolvedColor.accentColor,
		} as React.CSSProperties & Record<string, string>;
	}, [resolvedColor]);
	const mediaDockThemeStyle = useMemo(() => {
		const style: React.CSSProperties & Record<string, string> = { ...(editorColorStyle ?? {}) };
		if (resolvedColor) {
			style['--color-surface'] = resolvedColor.cardBackground;
			style['--color-surface-2'] = resolvedColor.headerBackground;
			style['--color-border'] = resolvedColor.borderColor;
			style['--color-text'] = resolvedColor.textColor;
			style['--color-text-muted'] = resolvedColor.mutedTextColor;
			style['--color-accent'] = resolvedColor.token === 'white' ? '#000000' : resolvedColor.accentColor;
		}
		return Object.keys(style).length > 0 ? style : undefined;
	}, [editorColorStyle, resolvedColor]);
	const mediaSheetVisualProgress = clampMediaSheetProgress(mediaSheetProgress);
	const isMediaSheetActive = mediaSheetVisualProgress > 0.001 || isMediaSheetClosing;
	const mediaSheetStyle = useMemo(() => {
		return {
			...(mediaDockThemeStyle ?? {}),
			'--media-sheet-open-progress': mediaSheetVisualProgress.toFixed(4),
			pointerEvents: 'auto' as const,
		} as React.CSSProperties;
	}, [mediaDockThemeStyle, mediaSheetVisualProgress]);
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
		dismissEditorOverlayFocus();
		setIsColorPickerOpen(true);
	}, [dismissEditorOverlayFocus, readOnly]);
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
		setFocusRowId(null);
		// Keep the active row/editor mounted so footer undo/redo can target the same
		// checklist text history after the keyboard is dismissed.
		// Only clear DOM focus so the keyboard stays closed.
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
	React.useEffect(() => {
		if (type !== 'checklist') {
			setActiveChecklistAutocompleteText('');
			return;
		}
		if (!activeChecklistRowId) {
			setActiveChecklistAutocompleteText('');
			return;
		}
		setActiveChecklistAutocompleteText(activeChecklistRowItem?.text ?? '');
	}, [activeChecklistRowId, activeChecklistRowItem?.text, type]);
	const activeChecklistAutocompleteSuggestion = useMemo(
		() => type === 'checklist'
			? getChecklistAutocompleteSuggestion(normalizedItems, activeChecklistRowId, activeChecklistAutocompleteText)
			: null,
		[activeChecklistAutocompleteText, activeChecklistRowId, normalizedItems, type]
	);
	const activeChecklistAutocompleteSuffix = useMemo(() => {
		if (!activeChecklistAutocompleteSuggestion) return '';
		const typed = String(activeChecklistAutocompleteText ?? '');
		if (!typed) return '';
		return activeChecklistAutocompleteSuggestion.toLowerCase().startsWith(typed.toLowerCase())
			? activeChecklistAutocompleteSuggestion.slice(typed.length)
			: '';
	}, [activeChecklistAutocompleteSuggestion, activeChecklistAutocompleteText]);
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

	const pushChecklistUndoSnapshot = React.useCallback((snapshot: readonly ChecklistItem[]): void => {
		checkboxUndoStack.current = [...checkboxUndoStack.current.slice(-39), snapshot as ChecklistItem[]];
		checkboxRedoStack.current = [];
		setCheckboxUndoAvail(true);
		setCheckboxRedoAvail(false);
	}, []);

	const toggleChecklistCompleted = React.useCallback(
		(id: string, checked: boolean): void => {
			if (type !== 'checklist') return;
			prepareChecklistRowFocusHandoff();
			const snapshot = normalizedItems;
			pushChecklistUndoSnapshot(snapshot);
			replaceChecklistItems(toggleChecklistItemCompleted(normalizedItems, id, checked));
		},
		[normalizedItems, prepareChecklistRowFocusHandoff, pushChecklistUndoSnapshot, replaceChecklistItems, type]
	);

	const undoCheckboxChange = React.useCallback((): void => {
		if (checkboxUndoStack.current.length === 0) return;
		prepareChecklistRowFocusHandoff();
		const snapshot = checkboxUndoStack.current[checkboxUndoStack.current.length - 1];
		checkboxUndoStack.current = checkboxUndoStack.current.slice(0, -1);
		checkboxRedoStack.current = [...checkboxRedoStack.current, normalizedItems];
		setCheckboxUndoAvail(checkboxUndoStack.current.length > 0);
		setCheckboxRedoAvail(true);
		replaceChecklistItems(snapshot);
	}, [normalizedItems, prepareChecklistRowFocusHandoff, replaceChecklistItems]);

	const redoCheckboxChange = React.useCallback((): void => {
		if (checkboxRedoStack.current.length === 0) return;
		prepareChecklistRowFocusHandoff();
		const snapshot = checkboxRedoStack.current[checkboxRedoStack.current.length - 1];
		checkboxRedoStack.current = checkboxRedoStack.current.slice(0, -1);
		checkboxUndoStack.current = [...checkboxUndoStack.current, normalizedItems];
		setCheckboxUndoAvail(true);
		setCheckboxRedoAvail(checkboxRedoStack.current.length > 0);
		replaceChecklistItems(snapshot);
	}, [normalizedItems, prepareChecklistRowFocusHandoff, replaceChecklistItems]);

	const handleTextUndo = React.useCallback((): void => {
		if (!textEditor) return;
		try {
			const chain = textEditor.chain().focus() as { undo?: () => { run: () => boolean } };
			if (typeof chain.undo === 'function') {
				chain.undo().run();
			}
		} catch {
			// Ignore transient editor teardown while the sheet animates.
		}
	}, [textEditor]);

	const handleTextRedo = React.useCallback((): void => {
		if (!textEditor) return;
		try {
			const chain = textEditor.chain().focus() as { redo?: () => { run: () => boolean } };
			if (typeof chain.redo === 'function') {
				chain.redo().run();
			}
		} catch {
			// Ignore transient editor teardown while the sheet animates.
		}
	}, [textEditor]);

	// FAB variants — identical to the handlers above but WITHOUT .focus().
	// The toolbar undo/redo (inside the keyboard) needs .focus() to keep the cursor
	// visible. The bottom-left FAB is only shown when mobileKeyboardOpen is false;
	// calling .focus() there would re-open the software keyboard, which is unwanted.
	// Do NOT merge these with the focus variants — they serve different contexts.
	const handleTextUndoNoFocus = React.useCallback((): void => {
		if (!textEditor) return;
		try {
			const chain = textEditor.chain() as { undo?: () => { run: () => boolean } };
			if (typeof chain.undo === 'function') chain.undo().run();
		} catch {}
	}, [textEditor]);

	const handleTextRedoNoFocus = React.useCallback((): void => {
		if (!textEditor) return;
		try {
			const chain = textEditor.chain() as { redo?: () => { run: () => boolean } };
			if (typeof chain.redo === 'function') chain.redo().run();
		} catch {}
	}, [textEditor]);

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
			if (index < 0) return;
			const wasActive = activeChecklistRowId === id;
			const previousId = index > 0 ? normalizedItems[index - 1]?.id ?? null : null;
			const nextId = normalizedItems[index + 1]?.id ?? null;
			// `clearSelection=true` is used by quick delete to close editing entirely.
			// Normal delete keeps the keyboard alive and hands focus to a neighbor.
			if (options?.clearSelection !== true && wasActive) {
				prepareChecklistRowFocusHandoff();
			}
			pushChecklistUndoSnapshot(normalizedItems);

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

			if (!wasActive) {
				return;
			}

			suppressAutoActivateAfterDeleteRef.current = false;
			setActiveChecklistRowId(previousId ?? nextId);
			setFocusRowId(previousId ?? nextId);
		},
		[activeChecklistRowId, checklistArray, clearChecklistSelection, normalizedItems, prepareChecklistRowFocusHandoff, pushChecklistUndoSnapshot, quickDeleteVisible, type]
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
	const handleChecklistRowTextChange = React.useCallback((rowId: string, text: string): void => {
		if (rowId !== activeChecklistRowId) return;
		setActiveChecklistAutocompleteText(text);
	}, [activeChecklistRowId]);
	const acceptChecklistAutocompleteSuggestion = React.useCallback((rowId: string, suggestion: string): void => {
		if (type !== 'checklist') return;
		const map = findChecklistItemMapById(checklistArray, rowId);
		if (!map) return;
		const doc = (checklistArray as any).doc as Y.Doc | null | undefined;
		const apply = (): void => {
			map.set('text', suggestion);
			const fragment = ensureChecklistItemRichContent(map);
			replaceRichFragmentFromJson(fragment, createRichTextDocFromPlainText(suggestion), 'minimal');
		};
		if (doc) doc.transact(apply);
		else apply();
		setActiveChecklistAutocompleteText(suggestion);
	}, [checklistArray, type]);
	const acceptChecklistAutocompleteSuggestionAndInsert = React.useCallback((rowId: string, suggestion: string): void => {
		const currentItem = items.find((row) => row.id === rowId) ?? null;
		const currentIndex = items.findIndex((row) => row.id === rowId);
		acceptChecklistAutocompleteSuggestion(rowId, suggestion);
		addChecklistItem(currentIndex === -1 ? undefined : currentIndex, {
			text: '',
			parentId: currentItem?.parentId ?? null,
			countValue: currentItem?.countValue != null ? 1 : null,
			richContent: createRichTextDocFromPlainText(''),
		});
	}, [acceptChecklistAutocompleteSuggestion, addChecklistItem, items]);

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
	// When the title Enter key arms needsFocusAfterTitleEnterRef, focus via the
	// TipTap editor API as soon as the row editor instance becomes available —
	// the same reliable path used by TextEditor.focusBodyEditor.
	React.useEffect(() => {
		if (!needsFocusAfterTitleEnterRef.current) return;
		if (!activeChecklistRowEditor || activeChecklistRowEditor.isDestroyed) return;
		needsFocusAfterTitleEnterRef.current = false;
		activeChecklistRowEditor.commands.focus('end');
	}, [activeChecklistRowEditor]);

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

	const finalizeRichHeadingWritingState = React.useCallback((): void => {
		if (type !== 'text') return;
		// Collapsed-heading "Writing..." is session UI only; clear it on every close/save path.
		finalizeCollapsedHeadingWritingForNote(props.noteId, textEditor);
	}, [props.noteId, textEditor, type]);
	const handleClose = React.useCallback((): void => {
		pruneEmptyChecklistRows();
		finalizeRichHeadingWritingState();
		void props.onClose();
	}, [finalizeRichHeadingWritingState, pruneEmptyChecklistRows, props]);
	const handleSavePendingNew = React.useCallback((): void => {
		pruneEmptyChecklistRows();
		finalizeRichHeadingWritingState();
		void props.onSavePendingNew?.();
	}, [finalizeRichHeadingWritingState, pruneEmptyChecklistRows, props]);
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
				onClick={(event) => handleOverlayBackdropClick(event, handleClose)}
			>
				<section
					aria-label={`Editor ${props.noteId}`}
					className={`${styles.fullscreenEditor} ${styles.editorContainer} ${styles.editorBlurred}${mediaDockOpen ? ` ${styles.mediaOpen}` : ''}${isCoarsePointer ? ` ${styles.mobileHideToolbar}` : ''}`}
					style={editorShellStyle}
					onClick={(event) => event.stopPropagation()}
				>
					<header className={styles.editorTopBar}>
						<button type="button" className={styles.closeIconButton} onClick={handleClose} aria-label={t('common.close')}>
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
								collapsibleHeadingNoteId={props.noteId}
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
										<li key={item.id} className={`${styles.checklistItem}${item.completed ? ` ${styles.checklistItemCompleted}` : ''}${item.parentId ? ` ${styles.childRow}` : ''}`}>
											<div className={`${styles.dragHandle} ${styles.dragHandleNonDraggable}`} aria-hidden="true">
												<FontAwesomeIcon icon={faGripVertical} />
											</div>
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
												<li key={item.id} className={`${styles.checklistItem}${item.completed ? ` ${styles.checklistItemCompleted}` : ''}${item.parentId ? ` ${styles.childRow}` : ''}`}>
													<div className={`${styles.dragHandle} ${styles.dragHandleNonDraggable}`} aria-hidden="true">
														<FontAwesomeIcon icon={faGripVertical} />
													</div>
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
										<span className={styles.mediaDockLabel}>{t('editors.mediaTabMedia')}</span>
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
								</section>
							</div>
						) : null}

						<nav className={`${styles.bottomDock}${type === 'checklist' ? ` ${styles.bottomDockCompact}` : ''}`} aria-label={t('editors.bottomDock')} onTouchEndCapture={handleBottomDockTouchEnd}>
							<div className={styles.bottomDockLeft}>
								<button
									type="button"
									className={styles.mediaDockText}
									onClick={handleToggleMediaDock}
									aria-label={t('editors.mediaDock')}
								>
									{t('editors.mediaTabMedia')}
								</button>
							</div>
							<button type="button" className={styles.bottomDockClose} onClick={handleClose} aria-label={t('common.close')} title={t('common.close')}>
								<FontAwesomeIcon icon={byPrefixAndName.far.xmark} />
							</button>
						</nav>
					</div>}
				</section>

				{!isCoarsePointer ? <aside
					className={`${styles.mediaFlyout}${mediaDockOpen ? ` ${styles.mediaFlyoutOpen}` : ''}`}
					onClick={(e) => e.stopPropagation()}
					aria-hidden={!mediaDockOpen}
					style={mediaDockThemeStyle}
				>
					<header className={styles.mediaFlyoutHeader}>
						<div className={styles.mediaTabs} role="tablist" aria-label={t('editors.mediaDockTabs')}>
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
				{/* Note navigation bar: back (all devices) and forward (desktop) when in a link chain */}
				{((props.noteNavDepth ?? 0) > 0 || props.canNavForward) ? (
					<nav className={styles.noteNavBar}>
						<button
							type="button"
							className={styles.noteNavButton}
							onClick={props.onNavBack}
							disabled={!props.onNavBack}
							aria-label={t('common.back')}
						>
							← {t('common.back')}
						</button>
						{props.canNavForward ? (
							<button
								type="button"
								className={styles.noteNavButton}
								onClick={props.onNavForward}
								aria-label={t('common.forward')}
							>
								{t('common.forward')} →
							</button>
						) : null}
					</nav>
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
							needsFocusAfterTitleEnterRef.current = true;
							titleFieldRef.current?.blur();
							const hasItems = Boolean(activeItems[0]?.id ?? normalizedItems[0]?.id);
							if (hasItems) {
								focusChecklistBody();
							} else {
								addChecklistItem();
							}
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
							collapsibleHeadingNoteId={props.noteId}
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
							onNoteClick={props.onOpenNote}
						scrollToMentionNodeId={props.scrollToMentionNodeId}
						authUserId={props.authUserId}
						onSelfMentionInserted={(nodeId) => {
							const workspaceId = props.docId.split(':')[0] ?? '';
							const noteTitle = props.doc.getText('title').toString() || null;
							props.onSelfMentionInserted?.(props.noteId, workspaceId, nodeId, noteTitle);
						}}
						/>
					</div>
				) : null}

				{type === 'checklist' ? (
					<section aria-label="Checklist" className={`${styles.editorContainer} ${styles.checklistEditorSection}`}>
						<div className={styles.checklistToolbarSlot}>
												<RichTextToolbar editor={activeChecklistRowEditor} variant="minimal" compact toolbarMode={props.toolbarMode} hideStrikeButton applyInlineFormattingToWholeEditor preferEditorUndoRedo onCreateUrlPreview={handleCreateUrlPreview} noteAutoScrollEnabled={noteAutoScrollEnabled} onToggleNoteAutoScroll={handleToggleNoteAutoScroll} onUndoCheckbox={!readOnly ? undoCheckboxChange : undefined} onRedoCheckbox={!readOnly ? redoCheckboxChange : undefined} checkboxUndoAvail={checkboxUndoAvail} checkboxRedoAvail={checkboxRedoAvail} onMakeChecklistCount={!readOnly && activeChecklistRowItem && !isChecklistCountItem(activeChecklistRowItem) ? makeActiveChecklistCount : undefined} onIncrementChecklistCount={!readOnly && activeChecklistCountItem ? incrementActiveChecklistCount : undefined} onDecrementChecklistCount={!readOnly && activeChecklistCountItem ? decrementActiveChecklistCount : undefined} onRemoveChecklistCount={!readOnly && activeChecklistCountItem ? removeActiveChecklistCount : undefined} />
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
														className={`${styles.checklistItem}${item.completed ? ` ${styles.checklistItemCompleted}` : ''}${activeChecklistRowId === item.id ? ` ${styles.checklistItemActive}` : ''}${quickDeleteVisible ? ` ${styles.checklistItemQuickDelete}` : ''}${item.parentId ? ` ${styles.childRow}` : ''}${snapshot.isDragging || (draggingParentId !== null && item.parentId === draggingParentId) ? ` ${styles.rowDragging}` : ''}${draggingParentId !== null && item.parentId === draggingParentId ? ` ${styles.childDraggingWithParent} ${styles.childHiddenDuringParentDrag}` : ''}`}
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
																acceptSuggestion={acceptChecklistAutocompleteSuggestion}
																acceptSuggestionAndInsert={acceptChecklistAutocompleteSuggestionAndInsert}
																onTextChange={handleChecklistRowTextChange}
																autocompleteText={activeChecklistRowId === item.id ? activeChecklistAutocompleteText : ''}
																autocompleteSuffix={activeChecklistRowId === item.id ? activeChecklistAutocompleteSuffix : ''}
																autocompleteSuggestion={activeChecklistRowId === item.id ? activeChecklistAutocompleteSuggestion : null}
																setActiveEditor={setActiveChecklistRowEditor}
																onArrowUpAtBoundary={isCoarsePointer ? undefined : () => moveFocusToAdjacentChecklistRow(item.id, 'previous')}
																onArrowDownAtBoundary={isCoarsePointer ? undefined : () => moveFocusToAdjacentChecklistRow(item.id, 'next')}
																onNoteClick={props.onOpenNote}
																authUserId={props.authUserId}
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
													<div className={`${styles.dragHandle} ${styles.dragHandleNonDraggable}`} aria-hidden="true" />
													<label className={styles.checklistCheckboxHitArea}>
														<input type="checkbox" className={styles.checklistCheckbox} checked={false} disabled readOnly tabIndex={-1} />
													</label>
													<div className={styles.checklistRowPreview}>
														{renderChecklistPreviewContent(item, renderRichPreview(getChecklistItemRichPreviewJson(checklistMapsById.get(item.id) ?? null), props.onOpenNote) || item.text || '\u00A0')}
													</div>
												</li>
											) : (
												<li key={item.id} className={`${styles.checklistItem}${item.completed ? ` ${styles.checklistItemCompleted}` : ''}${activeChecklistRowId === item.id ? ` ${styles.checklistItemActive}` : ''}${quickDeleteVisible ? ` ${styles.checklistItemQuickDelete}` : ''}${item.parentId ? ` ${styles.childRow}` : ''}`}>
													<div className={`${styles.dragHandle} ${styles.dragHandleNonDraggable}`} aria-hidden="true">
														<FontAwesomeIcon icon={faGripVertical} />
													</div>
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
														acceptSuggestion={acceptChecklistAutocompleteSuggestion}
														acceptSuggestionAndInsert={acceptChecklistAutocompleteSuggestionAndInsert}
														onTextChange={handleChecklistRowTextChange}
														autocompleteText={activeChecklistRowId === item.id ? activeChecklistAutocompleteText : ''}
														autocompleteSuffix={activeChecklistRowId === item.id ? activeChecklistAutocompleteSuffix : ''}
														autocompleteSuggestion={activeChecklistRowId === item.id ? activeChecklistAutocompleteSuggestion : null}
														setActiveEditor={setActiveChecklistRowEditor}
															onArrowUpAtBoundary={isCoarsePointer ? undefined : () => moveFocusToAdjacentChecklistRow(item.id, 'previous')}
															onArrowDownAtBoundary={isCoarsePointer ? undefined : () => moveFocusToAdjacentChecklistRow(item.id, 'next')}
															onNoteClick={props.onOpenNote}
															authUserId={props.authUserId}
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
					<div className={isCoarsePointer ? styles.mobileChecklistMediaRow : undefined}>
						{showMobileHistoryFab ? (
							<div
								className={styles.mobileChecklistUndoFabCluster}
								onPointerDown={(event) => event.stopPropagation()}
								onClick={(event) => event.stopPropagation()}
							>
								<button
									type="button"
									className={styles.mobileChecklistUndoFabButton}
									onClick={type === 'checklist' ? handleChecklistPrimaryUndoNoFocus : handleTextUndoNoFocus}
									disabled={type === 'checklist' ? !canRunChecklistPrimaryUndo : !textHistoryState.canUndo}
									aria-label={type === 'checklist' ? (activeChecklistRowHistoryState.canUndo ? t('editors.undo') : t('editors.undoCheckbox')) : t('editors.undo')}
									title={type === 'checklist' ? (activeChecklistRowHistoryState.canUndo ? t('editors.undo') : t('editors.undoCheckbox')) : t('editors.undo')}
								>
									<FontAwesomeIcon icon={byPrefixAndName.fas.undo} />
								</button>
								<button
									type="button"
									className={styles.mobileChecklistUndoFabButton}
									onClick={type === 'checklist' ? handleChecklistPrimaryRedoNoFocus : handleTextRedoNoFocus}
									disabled={type === 'checklist' ? !canRunChecklistPrimaryRedo : !textHistoryState.canRedo}
									aria-label={type === 'checklist' ? (activeChecklistRowHistoryState.canRedo ? t('editors.redo') : t('editors.redoCheckbox')) : t('editors.redo')}
									title={type === 'checklist' ? (activeChecklistRowHistoryState.canRedo ? t('editors.redo') : t('editors.redoCheckbox')) : t('editors.redo')}
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
										<span className={styles.mediaDockLabel}>{t('editors.mediaTabMedia')}</span>
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
								</section>
							</div>
						) : null}
					</div>

					<nav className={`${styles.bottomDock}${type === 'checklist' ? ` ${styles.bottomDockCompact}` : ''}`} aria-label={t('editors.bottomDock')} onTouchEndCapture={handleBottomDockTouchEnd}>
						<div className={styles.bottomDockLeft}>
							<button
								type="button"
								className={`${styles.bottomDockButton}${type === 'checklist' ? ` ${styles.bottomDockButtonCompact}` : ''}`}
								aria-label={t('editors.dockAction')}
								onClick={(e) => {
									dismissEditorOverlayFocus();
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
								data-note-editor-media-dock-trigger="true"
								onClick={handleToggleMediaDock}
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
							{props.isPendingNew && canSavePendingNew && props.onSavePendingNew ? (
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
			{!isCoarsePointer ? <aside
				ref={mediaFlyoutRef}
				className={`${styles.mediaFlyout}${mediaDockOpen ? ` ${styles.mediaFlyoutOpen}` : ''}`}
				onClick={(e) => e.stopPropagation()}
				aria-hidden={!mediaDockOpen}
				style={mediaDockThemeStyle}
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
								data-note-editor-media-dock-trigger="true"
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
				onSelectBannerImage={!readOnly ? () => {
					setIsMoreMenuOpen(false);
					setMoreMenuAnchorRect(null);
					setIsBannerPickerOpen(true);
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
		<NoteBannerPickerModal
			isOpen={isBannerPickerOpen}
			themeId={props.themeId}
			selectedFileName={noteBannerFile}
			onClose={() => setIsBannerPickerOpen(false)}
			onSelect={(fileName) => {
				assignNoteBannerFile(props.doc, fileName);
				writeNoteBannerWarmCacheFile(props.noteId, fileName);
				setIsBannerPickerOpen(false);
			}}
		/>

		{/* Floating keyboard toolbar + occlusion backdrop:
		    The editor shell stops at `keyboard.visibleBottom`, so the remaining layout
		    viewport below that edge must be explicitly covered while the mobile keyboard
		    animates in. Otherwise the underlying notes grid can flash through. */}
		{mobileKeyboardOpen ? createPortal(
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
						preferEditorUndoRedo={type === 'checklist'}
						onCreateUrlPreview={handleCreateUrlPreview}
						noteAutoScrollEnabled={noteAutoScrollEnabled}
						onToggleNoteAutoScroll={handleToggleNoteAutoScroll}
						onUndoCheckbox={type === 'checklist' && !readOnly ? undoCheckboxChange : undefined}
						onRedoCheckbox={type === 'checklist' && !readOnly ? redoCheckboxChange : undefined}
						checkboxUndoAvail={type === 'checklist' ? checkboxUndoAvail : undefined}
						checkboxRedoAvail={type === 'checklist' ? checkboxRedoAvail : undefined}
						onMakeChecklistCount={type === 'checklist' && activeChecklistRowItem && !isChecklistCountItem(activeChecklistRowItem) ? makeActiveChecklistCount : undefined}
						onIncrementChecklistCount={type === 'checklist' && activeChecklistCountItem ? incrementActiveChecklistCount : undefined}
						onDecrementChecklistCount={type === 'checklist' && activeChecklistCountItem ? decrementActiveChecklistCount : undefined}
						onRemoveChecklistCount={type === 'checklist' && activeChecklistCountItem ? removeActiveChecklistCount : undefined}
						copyMode={type === 'text' ? copyMode : undefined}
						onCopyModeChange={type === 'text' ? setCopyMode : undefined}
						collapsibleHeadingNoteId={type === 'text' ? props.noteId : undefined}
					/>
				</div>
			</>,
			document.body
		) : null}
		</div>
	);
}
