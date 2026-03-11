import React from 'react';
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
import { createRichTextDocFromPlainText } from '../../core/richText';
import { useI18n } from '../../core/i18n';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import { useIsMobileLandscape } from '../../core/useIsMobileLandscape';
import { useKeyboardHeight } from '../../core/useKeyboardHeight';
import { NoteCardMoreMenu } from '../NoteCard/NoteCardMoreMenu';
import { RichTextEditor, RichTextToolbar } from './RichTextEditor';
import styles from './Editors.module.css';

export type TextEditorProps = {
	onSave: (args: { title: string; body: string; richContent: JSONContent }) => void | Promise<void>;
	onCancel: () => void;
};

export function TextEditor(props: TextEditorProps): React.JSX.Element {
	const { t } = useI18n();
	// Reserve enough room for the floating formatting toolbar plus a little breathing
	// room so auto-scroll keeps the caret above the keyboard chrome.
	const keyboardVisibilityPaddingPx = 88;
	// Local draft state until onSave persists to Yjs in App.
	const [title, setTitle] = React.useState('');
	const [body, setBody] = React.useState('');
	const [bodyRichContent, setBodyRichContent] = React.useState<JSONContent>(() => createRichTextDocFromPlainText('', 'full'));
	const [saving, setSaving] = React.useState(false);
	const [mediaDockOpen, setMediaDockOpen] = React.useState(false);
	const [mediaDockTab, setMediaDockTab] = React.useState<0 | 1>(0);
	// More-menu state (editor 3-dot button):
	// - Desktop: anchored popover positioned using the trigger button rect.
	// - Mobile: bottom-sheet menu (anchor rect is ignored).
	const [isMoreMenuOpen, setIsMoreMenuOpen] = React.useState(false);
	const [moreMenuAnchorRect, setMoreMenuAnchorRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);
	const [interactionGuardActive, setInteractionGuardActive] = React.useState(false);
	const isCoarsePointer = useIsCoarsePointer();
	const keyboard = useKeyboardHeight();
	// Coarse-pointer branch: treat the software keyboard as part of layout and swap to
	// the floating toolbar presentation while it is open.
	const mobileKeyboardOpen = isCoarsePointer && keyboard.isOpen;
	const isMobileLandscape = useIsMobileLandscape();
	const isMobileLandscapeRef = React.useRef(isMobileLandscape);
	const [textEditor, setTextEditor] = React.useState<Editor | null>(null);
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
		// Coarse-pointer branch: briefly enable an interaction shield after mount
		// so residual open-tap events cannot focus/select editor controls.
		if (!isCoarsePointer || typeof window === 'undefined') return;
		setInteractionGuardActive(true);
		const timeoutId = window.setTimeout(() => setInteractionGuardActive(false), 420);
		return () => window.clearTimeout(timeoutId);
	}, [isCoarsePointer]);
	const dockTouchStartRef = React.useRef<{ x: number; y: number } | null>(null);
	const titleInputRef = React.useRef<HTMLInputElement | null>(null);
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
			if (dx < 0) return prev === 0 ? 1 : prev;
			return prev === 1 ? 0 : prev;
		});
	}, []);

	React.useEffect(() => {
		const rafId = window.requestAnimationFrame(() => {
			titleInputRef.current?.focus();
		});
		return () => window.cancelAnimationFrame(rafId);
	}, []);

	const onSubmit = async (event: React.FormEvent): Promise<void> => {
		// Standard async submit guard to prevent duplicate saves.
		event.preventDefault();
		if (saving) return;
		setSaving(true);
		try {
			await props.onSave({ title, body, richContent: bodyRichContent });
		} finally {
			setSaving(false);
		}
	};

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
				<input
					className={styles.editorTitleInput}
					ref={titleInputRef}
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder={t('editors.titlePlaceholder')}
				/>

				<div className={styles.fullBodyFieldContainer}>
					<RichTextEditor
						variant="full"
						placeholder={t('editors.bodyPlaceholder')}
						content={bodyRichContent}
						autoFocus
						// Hide the inline toolbar on coarse pointers because it is re-mounted as a
						// portal above the keyboard while the keyboard is open.
						hideToolbar={isCoarsePointer}
						caretVisibilityBottomInset={mobileKeyboardOpen ? keyboardVisibilityPaddingPx : 0}
						viewportClassName={mobileKeyboardOpen ? styles.editorViewportKeyboardOpen : undefined}
						contentClassName={styles.fullBodyFieldRich}
						onEditorChange={setTextEditor}
						onChange={({ json, text }) => {
							setBodyRichContent(json);
							setBody(text);
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
							<span className={styles.mediaDockLabel}>{t('editors.mediaTabMedia')}</span>
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
						<RichTextToolbar editor={textEditor} variant="full" compact />
					</div>
				</>,
				document.body
			) : null}
		</div>
	);
}
