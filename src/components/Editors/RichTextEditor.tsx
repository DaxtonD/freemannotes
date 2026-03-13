import React from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faAlignCenter,
	faAlignLeft,
	faAlignRight,
	faBold,
	faItalic,
	faLink,
	faListOl,
	faListUl,
	faRotateLeft,
	faRotateRight,
	faUnderline,
} from '@fortawesome/free-solid-svg-icons';
import * as Y from 'yjs';
import { createRichTextExtensions, type RichTextVariant } from '../../core/richText';
import { useI18n } from '../../core/i18n';
import { useBubbleMenuEnabled } from '../../core/useBubbleMenuPreference';
import styles from './Editors.module.css';

type RichTextEditorProps = {
	variant: RichTextVariant;
	placeholder: string;
	content?: JSONContent | null;
	fragment?: Y.XmlFragment | null;
	emitInitialChange?: boolean;
	serializeChangePayload?: boolean;
	autoFocus?: boolean;
	compactToolbar?: boolean;
	hideToolbar?: boolean;
	caretVisibilityBottomInset?: number;
	containerClassName?: string;
	viewportClassName?: string;
	contentClassName?: string;
	onChange?: (payload?: { json: JSONContent; text: string }) => void;
	onEditorChange?: (editor: Editor | null) => void;
	onEnter?: () => void;
	onShiftEnter?: () => void;
	onBackspaceWhenEmpty?: () => void;
	editable?: boolean;
};

type RichTextToolbarProps = {
	editor: Editor | null;
	variant: RichTextVariant;
	compact?: boolean;
};

function getScrollContainer(node: HTMLElement | null): HTMLElement | null {
	let current = node?.parentElement ?? null;
	while (current) {
		const style = window.getComputedStyle(current);
		const overflowY = style.overflowY;
		// `overflow:auto` alone is not enough: only treat the element as a scroll parent
		// when content actually exceeds the container, otherwise selection scrolling would
		// target non-scrolling wrappers and appear to do nothing.
		const isScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && current.scrollHeight > current.clientHeight;
		if (isScrollable) return current;
		current = current.parentElement;
	}
	return null;
}

function ensureEditorSelectionVisible(editor: Editor | null, bottomInset: number): void {
	if (!editor || typeof window === 'undefined') return;
	const root = editor.view.dom as HTMLElement | null;
	if (!root || !root.isConnected) return;
	const scrollContainer = getScrollContainer(root);
	if (!scrollContainer) return;
	const { from, to } = editor.state.selection;
	let startRect: { top: number; bottom: number };
	let endRect: { top: number; bottom: number };
	try {
		startRect = editor.view.coordsAtPos(from);
		endRect = editor.view.coordsAtPos(to);
	} catch {
		return;
	}
	const containerRect = scrollContainer.getBoundingClientRect();
	const topBuffer = 12;
	const bottomBuffer = Math.max(12, bottomInset);
	const visibleTop = containerRect.top + topBuffer;
	const visibleBottom = containerRect.bottom - bottomBuffer;
	const selectionTop = Math.min(startRect.top, endRect.top);
	const selectionBottom = Math.max(startRect.bottom, endRect.bottom);

	if (selectionBottom > visibleBottom) {
		scrollContainer.scrollTop += selectionBottom - visibleBottom;
		return;
	}
	if (selectionTop < visibleTop) {
		scrollContainer.scrollTop -= visibleTop - selectionTop;
	}
}

function canRunUndo(editor: Editor | null | undefined): boolean {
	if (!editor) return false;
	try {
		const canApi = editor.can() as { undo?: () => boolean };
		return typeof canApi.undo === 'function' ? Boolean(canApi.undo()) : false;
	} catch {
		return false;
	}
}

function canRunRedo(editor: Editor | null | undefined): boolean {
	if (!editor) return false;
	try {
		const canApi = editor.can() as { redo?: () => boolean };
		return typeof canApi.redo === 'function' ? Boolean(canApi.redo()) : false;
	} catch {
		return false;
	}
}

function runUndo(editor: Editor | null | undefined): void {
	if (!editor) return;
	try {
		const chain = editor.chain().focus() as { undo?: () => { run: () => boolean } };
		if (typeof chain.undo === 'function') {
			chain.undo().run();
		}
	} catch {
		// Editor was destroyed or the command is unavailable.
	}
}

function runRedo(editor: Editor | null | undefined): void {
	if (!editor) return;
	try {
		const chain = editor.chain().focus() as { redo?: () => { run: () => boolean } };
		if (typeof chain.redo === 'function') {
			chain.redo().run();
		}
	} catch {
		// Editor was destroyed or the command is unavailable.
	}
}

function shouldExitEmptyListItem(editor: Editor | null | undefined): boolean {
	if (!editor) return false;
	const { selection } = editor.state;
	if (!selection.empty) return false;
	if (!editor.isActive('bulletList') && !editor.isActive('orderedList')) return false;
	// Empty-list-item branch: a second Enter on a blank bullet/numbered row should
	// exit the list instead of creating infinite empty items.
	const parentText = selection.$from.parent.textContent;
	if (parentText.trim().length > 0) return false;
	for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
		if (selection.$from.node(depth).type.name === 'listItem') return true;
	}
	return false;
}

function exitEmptyListItem(editor: Editor | null | undefined): boolean {
	if (!editor) return false;
	try {
		// Lift the current listItem back out to paragraph level, matching standard editor UX.
		const chain = editor.chain().focus() as { liftListItem?: (typeOrName: string) => { run: () => boolean } };
		if (typeof chain.liftListItem === 'function') {
			return Boolean(chain.liftListItem('listItem').run());
		}
	} catch {
		// Editor was destroyed or the command is unavailable.
	}
	return false;
}

export function RichTextToolbar(props: RichTextToolbarProps): React.JSX.Element {
	const { t } = useI18n();
	// Toolbar touch tracking:
	// We record the initial touch point so we can distinguish between two very different
	// gestures that both begin on the toolbar on mobile:
	// 1. a horizontal swipe intended to scroll a long toolbar row
	// 2. a vertical drag that browsers may otherwise interpret as viewport scrolling
	// The follow-up move handler uses this snapshot to block only the second case.
	const touchStartRef = React.useRef<{ x: number; y: number } | null>(null);
	const toolbarState = useEditorState({
		editor: props.editor,
		selector: ({ editor }) => ({
			canUndo: canRunUndo(editor),
			canRedo: canRunRedo(editor),
			isBold: Boolean(editor?.isActive('bold')),
			isItalic: Boolean(editor?.isActive('italic')),
			isUnderline: Boolean(editor?.isActive('underline')),
			isLink: Boolean(editor?.isActive('link')),
			isHeading1: Boolean(editor?.isActive('heading', { level: 1 })),
			isHeading2: Boolean(editor?.isActive('heading', { level: 2 })),
			isHeading3: Boolean(editor?.isActive('heading', { level: 3 })),
			isBulletList: Boolean(editor?.isActive('bulletList')),
			isOrderedList: Boolean(editor?.isActive('orderedList')),
			isAlignLeft: Boolean(editor?.isActive({ textAlign: 'left' })),
			isAlignCenter: Boolean(editor?.isActive({ textAlign: 'center' })),
			isAlignRight: Boolean(editor?.isActive({ textAlign: 'right' })),
		}),
	});

	const preventToolbarFocusSteal = React.useCallback((event: React.SyntheticEvent): void => {
		event.preventDefault();
	}, []);

	const handleToolbarTouchStart = React.useCallback((event: React.TouchEvent): void => {
		// Capture the starting point of the gesture. We intentionally do not call
		// preventDefault here because horizontal toolbar scrolling should remain native.
		const touch = event.touches[0];
		if (!touch) return;
		touchStartRef.current = { x: touch.clientX, y: touch.clientY };
	}, []);

	const handleToolbarTouchMove = React.useCallback((event: React.TouchEvent): void => {
		const start = touchStartRef.current;
		const touch = event.touches[0];
		if (!start || !touch) return;
		const dx = Math.abs(touch.clientX - start.x);
		const dy = Math.abs(touch.clientY - start.y);

		// Vertical-drag branch:
		// If movement is more vertical than horizontal, we treat it as an accidental
		// viewport scroll starting from the toolbar. Canceling it here prevents the
		// editor/page from shifting while preserving horizontal swipes for long toolbars.
		if (dy > dx && event.cancelable) {
			event.preventDefault();
			event.stopPropagation();
		}
	}, []);

	const resetToolbarTouch = React.useCallback((): void => {
		// Gesture cleanup:
		// Clear the cached coordinates on both touch-end and touch-cancel so each new
		// interaction starts with a fresh direction calculation.
		touchStartRef.current = null;
	}, []);

	const stopToolbarPropagation = React.useCallback((event: React.SyntheticEvent): void => {
		// Portal propagation note:
		// Some toolbars are rendered via React portals (e.g. the floating keyboard
		// toolbar in NoteEditor/ChecklistEditor). React events from portals still
		// bubble through the *React* tree to parent components.
		//
		// Our editors use a fullscreen overlay with an onClick "outside" handler to
		// close the editor. Without this stopPropagation, clicking a formatting
		// button is interpreted as a click outside and immediately closes the editor.
		event.stopPropagation();
	}, []);

	const setLink = React.useCallback(() => {
		if (!props.editor) return;
		if (props.editor.isActive('link')) {
			props.editor.chain().focus().unsetLink().run();
			return;
		}
		const current = props.editor.getAttributes('link').href as string | undefined;
		const next = window.prompt(t('editors.linkPrompt'), current ?? 'https://');
		if (!next) return;
		props.editor.chain().focus().extendMarkRange('link').setLink({ href: next }).run();
	}, [props.editor, t]);

	const noEditor = !props.editor;
	const compactButtonClass = props.compact ? ` ${styles.formatButtonCompact}` : '';

	return (
		<div
			className={`${styles.formatToolbar}${props.compact ? ` ${styles.formatToolbarCompact}` : ''}${noEditor ? ` ${styles.formatToolbarDisabled}` : ''}`}
			role="toolbar"
			aria-label={t('editors.formatting')}
			onPointerDown={stopToolbarPropagation}
			onMouseDown={stopToolbarPropagation}
			onClick={stopToolbarPropagation}
			onTouchStartCapture={handleToolbarTouchStart}
			onTouchMoveCapture={handleToolbarTouchMove}
			onTouchEndCapture={resetToolbarTouch}
			onTouchCancelCapture={resetToolbarTouch}
		>
			<div className={styles.formatToolbarRow}>
				<button type="button" className={`${styles.formatButton}${compactButtonClass}`} aria-label={t('editors.undo')} title={t('editors.undo')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runUndo(props.editor)} disabled={!toolbarState.canUndo}>
					<FontAwesomeIcon icon={faRotateLeft} />
				</button>
				<button type="button" className={`${styles.formatButton}${compactButtonClass}`} aria-label={t('editors.redo')} title={t('editors.redo')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => runRedo(props.editor)} disabled={!toolbarState.canRedo}>
					<FontAwesomeIcon icon={faRotateRight} />
				</button>
				<div className={styles.formatDivider} aria-hidden="true" />
				<button type="button" className={`${styles.formatButton}${compactButtonClass}${toolbarState.isBold ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.bold')} title={t('editors.bold')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().toggleBold().run()}>
					<FontAwesomeIcon icon={faBold} />
				</button>
				<button type="button" className={`${styles.formatButton}${compactButtonClass}${toolbarState.isItalic ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.italic')} title={t('editors.italic')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().toggleItalic().run()}>
					<FontAwesomeIcon icon={faItalic} />
				</button>
				<button type="button" className={`${styles.formatButton}${compactButtonClass}${toolbarState.isUnderline ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.underline')} title={t('editors.underline')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().toggleUnderline().run()}>
					<FontAwesomeIcon icon={faUnderline} />
				</button>
				<button type="button" className={`${styles.formatButton}${compactButtonClass}${toolbarState.isLink ? ` ${styles.formatButtonActive}` : ''}`} aria-label={toolbarState.isLink ? t('editors.removeLink') : t('editors.link')} title={toolbarState.isLink ? t('editors.removeLink') : t('editors.link')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={setLink}>
					<FontAwesomeIcon icon={faLink} />
				</button>
				{props.variant === 'full' ? (
					<>
						<div className={styles.formatDivider} aria-hidden="true" />
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${toolbarState.isHeading1 ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.heading1')} title={t('editors.heading1')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
							H1
						</button>
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${toolbarState.isHeading2 ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.heading2')} title={t('editors.heading2')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
							H2
						</button>
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${toolbarState.isHeading3 ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.heading3')} title={t('editors.heading3')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().toggleHeading({ level: 3 }).run()}>
							H3
						</button>
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${toolbarState.isBulletList ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.bulletedList')} title={t('editors.bulletedList')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().toggleBulletList().run()}>
							<FontAwesomeIcon icon={faListUl} />
						</button>
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${toolbarState.isOrderedList ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.numberedList')} title={t('editors.numberedList')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().toggleOrderedList().run()}>
							<FontAwesomeIcon icon={faListOl} />
						</button>
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${toolbarState.isAlignLeft ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.alignLeft')} title={t('editors.alignLeft')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().setTextAlign('left').run()}>
							<FontAwesomeIcon icon={faAlignLeft} />
						</button>
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${toolbarState.isAlignCenter ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.alignCenter')} title={t('editors.alignCenter')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().setTextAlign('center').run()}>
							<FontAwesomeIcon icon={faAlignCenter} />
						</button>
						<button type="button" className={`${styles.formatButton}${compactButtonClass}${toolbarState.isAlignRight ? ` ${styles.formatButtonActive}` : ''}`} aria-label={t('editors.alignRight')} title={t('editors.alignRight')} onMouseDown={preventToolbarFocusSteal} onPointerDown={preventToolbarFocusSteal} onClick={() => props.editor?.chain().focus().setTextAlign('right').run()}>
							<FontAwesomeIcon icon={faAlignRight} />
						</button>
					</>
				) : null}
			</div>
		</div>
	);
}

export function RichTextEditor(props: RichTextEditorProps): React.JSX.Element {
	const { variant } = props;
	const emitInitialChange = props.emitInitialChange ?? true;
	const serializeChangePayload = props.serializeChangePayload ?? true;
	const bubbleMenuEnabled = useBubbleMenuEnabled();
	const caretVisibilityBottomInsetRef = React.useRef(props.caretVisibilityBottomInset ?? 0);
	caretVisibilityBottomInsetRef.current = props.caretVisibilityBottomInset ?? 0;
	const latestHandlersRef = React.useRef({
		onChange: props.onChange,
		onEnter: props.onEnter,
		onShiftEnter: props.onShiftEnter,
		onBackspaceWhenEmpty: props.onBackspaceWhenEmpty,
	});
	latestHandlersRef.current = {
		onChange: props.onChange,
		onEnter: props.onEnter,
		onShiftEnter: props.onShiftEnter,
		onBackspaceWhenEmpty: props.onBackspaceWhenEmpty,
	};
	const editorRef = React.useRef<Editor | null>(null);
	const ensureSelectionVisible = React.useCallback((): void => {
		const bottomInset = caretVisibilityBottomInsetRef.current;
		if (bottomInset <= 0) return;
		window.requestAnimationFrame(() => {
			ensureEditorSelectionVisible(editorRef.current, bottomInset);
		});
	}, []);
	const editor = useEditor(
		{
			immediatelyRender: false,
			extensions: createRichTextExtensions({
				variant,
				placeholder: props.placeholder,
				includeCollaboration: Boolean(props.fragment),
				fragment: props.fragment ?? null,
			}),
			editable: props.editable !== false,
			content: props.fragment ? undefined : props.content ?? undefined,
			editorProps: {
				attributes: {
					class: `${styles.richEditorContent}${props.contentClassName ? ` ${props.contentClassName}` : ''}`,
				},
				handleKeyDown: (_view, event) => {
					const ed = editorRef.current;
					if (event.key === 'Enter' && !event.shiftKey && shouldExitEmptyListItem(ed)) {
						event.preventDefault();
						return exitEmptyListItem(ed);
					}
					if (event.key === 'Enter' && !event.shiftKey && latestHandlersRef.current.onEnter) {
						event.preventDefault();
						latestHandlersRef.current.onEnter();
						return true;
					}
					if (event.key === 'Enter' && event.shiftKey && latestHandlersRef.current.onShiftEnter) {
						event.preventDefault();
						latestHandlersRef.current.onShiftEnter();
						return true;
					}
					if (event.key === 'Backspace' && latestHandlersRef.current.onBackspaceWhenEmpty && editorRef.current?.isEmpty) {
						event.preventDefault();
						latestHandlersRef.current.onBackspaceWhenEmpty();
						return true;
					}
					// Ctrl/Cmd+B/I/U at end of text with collapsed selection → select all then toggle
					const mod = event.metaKey || event.ctrlKey;
					if (mod && !event.shiftKey && !event.altKey && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
						if (ed) {
							const { from, to, empty } = ed.state.selection;
							const docEnd = ed.state.doc.content.size - 1;
							if (empty && from >= docEnd) {
								event.preventDefault();
								const cmd = event.key.toLowerCase() === 'b' ? 'toggleBold' : event.key.toLowerCase() === 'i' ? 'toggleItalic' : 'toggleUnderline';
								(ed.chain().focus().selectAll() as any)[cmd]().run();
								return true;
							}
						}
					}
					return false;
				},
			},
			onCreate: ({ editor: currentEditor }) => {
				ensureSelectionVisible();
				// Mount-time emission branch:
				// For checklist row activation we intentionally mount minimal editors very often.
				// Emitting here can cause immediate JSON/text serialization and parent updates
				// before the user has typed anything. `emitInitialChange=false` disables that
				// eager work and keeps row-switch interactions lightweight.
				if (!emitInitialChange) return;

				// Payload serialization branch:
				// Some callsites only need a "document changed" signal and can read data from
				// Yjs directly. For those paths, skip `getJSON/getText` to avoid expensive
				// conversions on each editor lifecycle event.
				if (serializeChangePayload) {
					latestHandlersRef.current.onChange?.({ json: currentEditor.getJSON(), text: currentEditor.getText() });
					return;
				}
				latestHandlersRef.current.onChange?.();
			},
			onUpdate: ({ editor: currentEditor }) => {
				ensureSelectionVisible();
				// Update-time branch mirrors onCreate:
				// - `true`: caller wants structured payload for non-collab/draft editors.
				// - `false`: caller wants a cheap signal-only callback to reduce CPU cost.
				if (serializeChangePayload) {
					latestHandlersRef.current.onChange?.({ json: currentEditor.getJSON(), text: currentEditor.getText() });
					return;
				}
				latestHandlersRef.current.onChange?.();
			},
		},
		[emitInitialChange, props.editable, props.fragment, props.placeholder, serializeChangePayload, variant]
	);

	React.useEffect(() => {
		editorRef.current = editor;
		props.onEditorChange?.(editor);
		return () => {
			props.onEditorChange?.(null);
		};
	}, [editor, props.onEditorChange]);

	React.useEffect(() => {
		if (!editor) return;
		const handleSelectionChange = (): void => {
			ensureSelectionVisible();
		};
		editor.on('selectionUpdate', handleSelectionChange);
		editor.on('focus', handleSelectionChange);
		return () => {
			editor.off('selectionUpdate', handleSelectionChange);
			editor.off('focus', handleSelectionChange);
		};
	}, [editor, ensureSelectionVisible]);

	React.useEffect(() => {
		if (!editor || !props.autoFocus) return;
		const rafId = window.requestAnimationFrame(() => {
			editor.commands.focus('end');
			ensureSelectionVisible();
		});
		return () => window.cancelAnimationFrame(rafId);
	}, [editor, ensureSelectionVisible, props.autoFocus]);

	const stopToolbarPropagation = React.useCallback((event: React.SyntheticEvent): void => {
		event.stopPropagation();
	}, []);

	return (
		<div className={`${styles.richEditorStack}${props.containerClassName ? ` ${props.containerClassName}` : ''}`}>
			{props.hideToolbar ? null : <RichTextToolbar editor={editor} variant={variant} compact={props.compactToolbar} />}
			<EditorContent editor={editor} className={`${styles.richEditorViewport}${props.viewportClassName ? ` ${props.viewportClassName}` : ''}`} />
			{/*
				Bubble menu branch:
				`minimal` editors are used heavily inside checklist rows where users rapidly
				switch focus. Restricting BubbleMenu to `full` editors avoids extra delayed
				position/update timers in high-frequency checklist interactions.
			*/}
			{bubbleMenuEnabled && editor && variant === 'full' ? (
				<BubbleMenu editor={editor} updateDelay={150} options={{ placement: 'top' }}>
					<div
						className={styles.bubbleMenu}
						onPointerDown={stopToolbarPropagation}
						onMouseDown={stopToolbarPropagation}
						onClick={stopToolbarPropagation}
					>
						<button
							type="button"
							className={`${styles.bubbleMenuButton}${editor.isActive('bold') ? ` ${styles.bubbleMenuButtonActive}` : ''}`}
							onClick={() => editor.chain().focus().toggleBold().run()}
						>
							<FontAwesomeIcon icon={faBold} />
						</button>
						<button
							type="button"
							className={`${styles.bubbleMenuButton}${editor.isActive('italic') ? ` ${styles.bubbleMenuButtonActive}` : ''}`}
							onClick={() => editor.chain().focus().toggleItalic().run()}
						>
							<FontAwesomeIcon icon={faItalic} />
						</button>
						<button
							type="button"
							className={`${styles.bubbleMenuButton}${editor.isActive('underline') ? ` ${styles.bubbleMenuButtonActive}` : ''}`}
							onClick={() => editor.chain().focus().toggleUnderline().run()}
						>
							<FontAwesomeIcon icon={faUnderline} />
						</button>
					</div>
				</BubbleMenu>
			) : null}
		</div>
	);
}