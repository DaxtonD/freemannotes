import React, { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { Editor, JSONContent } from '@tiptap/core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faBell,
	faEllipsisVertical,
	faImage,
	faPalette,
	faUserPlus,
} from '@fortawesome/free-solid-svg-icons';
import { byPrefixAndName } from '../../core/byPrefixAndName';
import type { ClipboardConversionTarget } from '../../core/clipboardConversion';
import { mergeNotePreviewLinkInputs } from '../../core/noteLinks';
import { getUserNoteAutoScrollEnabled, setUserNoteAutoScrollEnabled, subscribeNoteAutoScrollPrefs } from '../../core/noteAutoScrollPreferences';
import { createRichTextDocFromPlainText } from '../../core/richText';
import type { EditorToolbarMode } from '../../core/deviceAppearancePreferences';
import { useI18n } from '../../core/i18n';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import { useIsMobileLandscape } from '../../core/useIsMobileLandscape';
import { useKeyboardHeight } from '../../core/useKeyboardHeight';
import { NoteCardMoreMenu } from '../NoteCard/NoteCardMoreMenu';
import { DocumentsPanel } from './DocumentsPanel';
import { RichTextEditor, RichTextToolbar } from './RichTextEditor';
import styles from './Editors.module.css';

export type TextEditorProps = {
	onSave: (args: { title: string; body: string; richContent: JSONContent; previewLinks: string[] }) => void | Promise<void>;
	onCancel: () => void;
	toolbarMode?: EditorToolbarMode;
};

const DRAFT_TEXT_AUTOSCROLL_ID = '__draft_text_editor__';

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

function animateFastScrollToBottom(container: HTMLElement): () => void {
	const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
	const startTop = container.scrollTop;
	const distance = maxScrollTop - startTop;
	if (Math.abs(distance) <= 1 || typeof window === 'undefined') {
		container.scrollTop = maxScrollTop;
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

export function TextEditor(props: TextEditorProps): React.JSX.Element {
	const { t } = useI18n();
	// Reserve enough room for the floating formatting toolbar plus a little breathing
	// room so auto-scroll keeps the caret above the keyboard chrome.
	const keyboardVisibilityPaddingPx = 88;
	// Local draft state until onSave persists to Yjs in App.
	const [title, setTitle] = React.useState('');
	const [body, setBody] = React.useState('');
	const [bodyRichContent, setBodyRichContent] = React.useState<JSONContent>(() => createRichTextDocFromPlainText('', 'full'));
	const [previewLinks, setPreviewLinks] = React.useState<string[]>([]);
	const [saving, setSaving] = React.useState(false);
	const [mediaDockOpen, setMediaDockOpen] = React.useState(false);
	const [mediaDockTab, setMediaDockTab] = React.useState<0 | 1 | 2>(0);
	// More-menu state (editor 3-dot button):
	// - Desktop: anchored popover positioned using the trigger button rect.
	// - Mobile: bottom-sheet menu (anchor rect is ignored).
	const [isMoreMenuOpen, setIsMoreMenuOpen] = React.useState(false);
	const [moreMenuAnchorRect, setMoreMenuAnchorRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);
	const [interactionGuardActive, setInteractionGuardActive] = React.useState(false);
	const mediaFlyoutRef = React.useRef<HTMLElement | null>(null);
	const isCoarsePointer = useIsCoarsePointer();
	const keyboard = useKeyboardHeight();
	// Coarse-pointer branch: treat the software keyboard as part of layout and swap to
	// the floating toolbar presentation while it is open.
	const mobileKeyboardOpen = isCoarsePointer && keyboard.isOpen;
	const isMobileLandscape = useIsMobileLandscape();
	const isMobileLandscapeRef = React.useRef(isMobileLandscape);
	const [textEditor, setTextEditor] = React.useState<Editor | null>(null);
	const noteAutoScrollEnabled = useSyncExternalStore(
		(onStoreChange) => subscribeNoteAutoScrollPrefs(onStoreChange),
		() => getUserNoteAutoScrollEnabled(DRAFT_TEXT_AUTOSCROLL_ID),
		() => getUserNoteAutoScrollEnabled(DRAFT_TEXT_AUTOSCROLL_ID)
	);
	const activeScrollCancelRef = React.useRef<(() => void) | null>(null);
	// Parent-owned copy state keeps the hidden inline editor toolbar and the visible
	// floating mobile toolbar in sync.
	const [copyMode, setCopyMode] = React.useState<ClipboardConversionTarget>('rich-text');
	const [clipboardStatusMessage, setClipboardStatusMessage] = React.useState('');
	React.useEffect(() => {
		isMobileLandscapeRef.current = isMobileLandscape;
		// Landscape branch: media sheet/flyout must remain closed and inert.
		if (isMobileLandscape) setMediaDockOpen(false);
	}, [isMobileLandscape]);
	React.useEffect(() => {
		if (!mobileKeyboardOpen) return;
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
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (mediaFlyoutRef.current?.contains(target)) return;
			if (target.closest('[data-text-editor-media-dock-trigger="true"]')) return;
			setMediaDockOpen(false);
		};
		document.addEventListener('pointerdown', handlePointerDown, true);
		return () => document.removeEventListener('pointerdown', handlePointerDown, true);
	}, [isCoarsePointer, mediaDockOpen]);
	React.useEffect(() => {
		// Coarse-pointer branch: briefly enable an interaction shield after mount
		// so residual open-tap events cannot focus/select editor controls.
		if (!isCoarsePointer || typeof window === 'undefined') return;
		setInteractionGuardActive(true);
		const timeoutId = window.setTimeout(() => setInteractionGuardActive(false), 420);
		return () => window.clearTimeout(timeoutId);
	}, [isCoarsePointer]);
	const dockTouchStartRef = React.useRef<{ x: number; y: number } | null>(null);
	const mediaSheetSwipeStartRef = React.useRef<{ x: number; y: number } | null>(null);
	const titleInputRef = React.useRef<HTMLTextAreaElement | null>(null);
	const bodyFieldRef = React.useRef<HTMLDivElement | null>(null);
	const resizeTitleField = React.useCallback((): void => {
		const field = titleInputRef.current;
		if (!field) return;
		field.style.height = '0px';
		field.style.height = `${Math.max(36, field.scrollHeight)}px`;
	}, []);
	const handleInteractionGuardEvent = React.useCallback((event: React.SyntheticEvent): void => {
		if (!interactionGuardActive) return;
		event.preventDefault();
		event.stopPropagation();
	}, [interactionGuardActive]);

	const focusBodyEditor = React.useCallback((): void => {
		if (textEditor && !textEditor.isDestroyed) {
			textEditor.commands.focus('start');
			return;
		}
		const tryFocus = (remaining: number): void => {
			const editorElement = bodyFieldRef.current?.querySelector('[contenteditable="true"]');
			if (editorElement instanceof HTMLElement) {
				editorElement.focus();
				return;
			}
			if (remaining <= 0 || typeof window === 'undefined') return;
			window.setTimeout(() => tryFocus(remaining - 1), 16);
		};
		tryFocus(5);
	}, [textEditor]);

	const stopActiveScrollAnimation = React.useCallback((): void => {
		activeScrollCancelRef.current?.();
		activeScrollCancelRef.current = null;
	}, []);

	const scrollBodyToBottom = React.useCallback((animated: boolean): boolean => {
		const container = findScrollableAncestor(bodyFieldRef.current?.querySelector('[contenteditable="true"]') as HTMLElement | null);
		if (!container) return false;
		stopActiveScrollAnimation();
		if (animated) {
			activeScrollCancelRef.current = animateFastScrollToBottom(container);
		} else {
			container.scrollTop = container.scrollHeight;
		}
		return true;
	}, [stopActiveScrollAnimation]);

	const handleToggleNoteAutoScroll = React.useCallback((): void => {
		const next = !noteAutoScrollEnabled;
		setUserNoteAutoScrollEnabled(DRAFT_TEXT_AUTOSCROLL_ID, null, next);
		if (next) {
			scrollBodyToBottom(true);
		} else {
			stopActiveScrollAnimation();
		}
	}, [noteAutoScrollEnabled, scrollBodyToBottom, stopActiveScrollAnimation]);

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
		// Landscape branch: swipe-to-open media is explicitly disabled.
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
		// Landscape branch: tab-swipe is disabled when media dock is force-closed.
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
		const touch = event.touches[0];
		if (!touch) return;
		mediaSheetSwipeStartRef.current = { x: touch.clientX, y: touch.clientY };
	}, []);

	const handleMediaSheetTouchEnd = React.useCallback((event: React.TouchEvent<HTMLElement>): void => {
		const start = mediaSheetSwipeStartRef.current;
		const touch = event.changedTouches[0];
		mediaSheetSwipeStartRef.current = null;
		if (!start || !touch) return;
		const dx = touch.clientX - start.x;
		const dy = touch.clientY - start.y;
		if (Math.abs(dx) < 28 || Math.abs(dx) < Math.abs(dy)) return;
		setMediaDockTab((prev) => {
			if (dx < 0) return Math.min(prev + 1, 2) as 0 | 1 | 2;
			return Math.max(prev - 1, 0) as 0 | 1 | 2;
		});
	}, []);

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

	React.useEffect(() => {
		if (!noteAutoScrollEnabled) {
			stopActiveScrollAnimation();
			return;
		}
		let cancelled = false;
		const tryScroll = (remaining: number): void => {
			if (cancelled) return;
			if (scrollBodyToBottom(true)) return;
			if (remaining <= 0 || typeof window === 'undefined') return;
			window.setTimeout(() => tryScroll(remaining - 1), 24);
		};
		tryScroll(12);
		return () => {
			cancelled = true;
			stopActiveScrollAnimation();
		};
	}, [noteAutoScrollEnabled, scrollBodyToBottom, stopActiveScrollAnimation]);

	const onSubmit = async (event: React.FormEvent): Promise<void> => {
		// Standard async submit guard to prevent duplicate saves.
		event.preventDefault();
		if (saving) return;
		setSaving(true);
		try {
			await props.onSave({ title, body, richContent: bodyRichContent, previewLinks });
		} finally {
			setSaving(false);
		}
	};

	const handleCreateUrlPreview = React.useCallback((): void => {
		const next = window.prompt(t('links.prompt'), 'https://');
		if (!next) return;
		setPreviewLinks((current) => mergeNotePreviewLinkInputs(current, next));
	}, [t]);

	const renderMediaDockPanel = React.useCallback((): React.JSX.Element => {
		if (mediaDockTab === 2) return <DocumentsPanel showComingSoonPlaceholder />;
		return <div className={styles.mediaPanelPlaceholder} aria-hidden="true" />;
	}, [mediaDockTab]);

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
				style={mobileKeyboardOpen ? { height: `${keyboard.visibleBottom}px`, maxHeight: `${keyboard.visibleBottom}px` } : undefined}
				onClick={(event) => event.stopPropagation()}
			>
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
					ref={titleInputRef}
					rows={1}
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					onInput={resizeTitleField}
					onKeyDown={(event) => {
						if (event.key !== 'Enter') return;
						event.preventDefault();
						focusBodyEditor();
					}}
					placeholder={t('editors.titlePlaceholder')}
				/>

				<div ref={bodyFieldRef} className={styles.fullBodyFieldContainer}>
					<RichTextEditor
						variant="full"
						placeholder={t('editors.bodyPlaceholder')}
						content={bodyRichContent}
						copyMode={copyMode}
						onCopyModeChange={setCopyMode}
						onClipboardStatusChange={setClipboardStatusMessage}
						noteAutoScrollEnabled={noteAutoScrollEnabled}
						onToggleNoteAutoScroll={handleToggleNoteAutoScroll}
						toolbarMode={props.toolbarMode}
						// Hide the inline toolbar on coarse pointers because it is re-mounted as a
						// portal above the keyboard while the keyboard is open.
						hideToolbar={isCoarsePointer}
						caretVisibilityBottomInset={mobileKeyboardOpen ? keyboardVisibilityPaddingPx : 0}
						viewportClassName={mobileKeyboardOpen ? styles.editorViewportKeyboardOpen : undefined}
						contentClassName={styles.fullBodyFieldRich}
						onEditorChange={setTextEditor}
						onCreateUrlPreview={handleCreateUrlPreview}
						onChange={(payload) => {
							if (!payload) return;
							setBodyRichContent(payload.json);
							setBody(payload.text);
						}}
					/>
				</div>

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
						</button>
					</section>

					<nav className={styles.bottomDock} aria-label={t('editors.bottomDock')}>
						<div className={styles.bottomDockLeft}>
							<button
								type="button"
								className={styles.bottomDockButton}
								aria-label={t('editors.dockAction')}
								onClick={(e) => {
									// Capture the button's rect before opening so the desktop
									// popover can be placed relative to this element.
									setMoreMenuAnchorRect(e.currentTarget.getBoundingClientRect().toJSON());
									setIsMoreMenuOpen(true);
								}}
							>
								<FontAwesomeIcon icon={faEllipsisVertical} />
							</button>
							<button type="button" className={styles.bottomDockButton} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faPalette} />
							</button>
							<button type="button" className={styles.bottomDockButton} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faBell} />
							</button>
							<button type="button" className={styles.bottomDockButton} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faUserPlus} />
							</button>
							<button type="button" className={styles.bottomDockButton} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faImage} />
							</button>
							<button
								type="button"
								className={styles.mediaDockText}
								data-text-editor-media-dock-trigger="true"
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
								aria-label={saving ? t('editors.saving') : t('common.save')}
								title={saving ? t('editors.saving') : t('common.save')}
							>
								<FontAwesomeIcon icon={byPrefixAndName.fas['floppy-disk']} />
							</button>
						</div>
					</nav>
				</div>}
				<div className={styles.editorBlurLayer} aria-hidden="true" />
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
						onClick={() => {
							if (isMobileLandscapeRef.current) return;
							setMediaDockOpen(false);
						}}
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
			</section>}

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
						<div key={`media-panel-${mediaDockTab}`} className={`${styles.mediaPanel} ${styles.mediaPanelAnimated}`} role="tabpanel">
							{renderMediaDockPanel()}
						</div>
					</div>
			</aside>
		{/* Only mount the menu while open so its side-effects are scoped:
		    - mobile history/back-button handling
		    - mobile scroll locking + initial-touch suppression */}
		{isMoreMenuOpen ? (
			<NoteCardMoreMenu
				noteType="text"
				anchorRect={moreMenuAnchorRect}
				onClose={() => {
					setIsMoreMenuOpen(false);
					setMoreMenuAnchorRect(null);
				}}
				onAddUrlPreview={() => {
					setIsMoreMenuOpen(false);
					setMoreMenuAnchorRect(null);
					handleCreateUrlPreview();
				}}
			/>
		) : null}
			{isCoarsePointer && keyboard.isOpen ? createPortal(
				<>
					{/* Portal branch: render outside the editor overlay so the toolbar stays pinned
					    to the visual viewport instead of being clipped by the scrolling editor body. */}
					<div className={styles.keyboardOcclusion} style={{ top: `${keyboard.visibleBottom}px` }} />
					<div
						className={styles.floatingToolbar}
						style={{ top: `${keyboard.visibleBottom}px`, transform: 'translateY(-100%)' }}
					>
						{clipboardStatusMessage ? <div className={styles.selectionCopyToast} role="status" aria-live="polite">{clipboardStatusMessage}</div> : null}
						<RichTextToolbar editor={textEditor} variant="full" compact toolbarMode={props.toolbarMode} onCreateUrlPreview={handleCreateUrlPreview} noteAutoScrollEnabled={noteAutoScrollEnabled} onToggleNoteAutoScroll={handleToggleNoteAutoScroll} copyMode={copyMode} onCopyModeChange={setCopyMode} />
					</div>
				</>,
				document.body
			) : null}
		</div>
	);
}
