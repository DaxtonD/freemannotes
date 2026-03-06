import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faAlignCenter,
	faAlignLeft,
	faAlignRight,
	faBell,
	faBold,
	faEllipsisVertical,
	faImage,
	faItalic,
	faListOl,
	faListUl,
	faLink,
	faPalette,
	faUnderline,
	faUserPlus,
} from '@fortawesome/free-solid-svg-icons';
import { byPrefixAndName } from '../../core/byPrefixAndName';
import { useI18n } from '../../core/i18n';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import { useIsMobileLandscape } from '../../core/useIsMobileLandscape';
import styles from './Editors.module.css';

export type TextEditorProps = {
	onSave: (args: { title: string; body: string }) => void | Promise<void>;
	onCancel: () => void;
};

export function TextEditor(props: TextEditorProps): React.JSX.Element {
	const { t } = useI18n();
	// Local draft state until onSave persists to Yjs in App.
	const [title, setTitle] = React.useState('');
	const [body, setBody] = React.useState('');
	const [saving, setSaving] = React.useState(false);
	const [mediaDockOpen, setMediaDockOpen] = React.useState(false);
	const [mediaDockTab, setMediaDockTab] = React.useState<0 | 1>(0);
	const [interactionGuardActive, setInteractionGuardActive] = React.useState(false);
	const isCoarsePointer = useIsCoarsePointer();
	const isMobileLandscape = useIsMobileLandscape();
	const isMobileLandscapeRef = React.useRef(isMobileLandscape);
	React.useEffect(() => {
		isMobileLandscapeRef.current = isMobileLandscape;
		// Landscape branch: media sheet/flyout must remain closed and inert.
		if (isMobileLandscape) setMediaDockOpen(false);
	}, [isMobileLandscape]);
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
			await props.onSave({ title, body });
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className={styles.fullscreenOverlay} role="presentation" onClick={mediaDockOpen ? undefined : props.onCancel}>
			<form onSubmit={onSubmit} className={`${styles.fullscreenEditor} ${styles.editorBlurred}${mediaDockOpen ? ` ${styles.mediaOpen}` : ''}${interactionGuardActive ? ` ${styles.editorInteractionGuardActive}` : ''}`} onClick={(event) => event.stopPropagation()}>
				<input
					className={styles.editorTitleInput}
					ref={titleInputRef}
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder={t('editors.titlePlaceholder')}
				/>

				<div className={styles.formatToolbar} role="toolbar" aria-label={t('editors.formatting')}>
					<div className={styles.formatToolbarRow}>
						<button type="button" className={styles.formatButton} aria-label={t('editors.bold')} title={t('editors.bold')}>
							<FontAwesomeIcon icon={faBold} />
						</button>
						<button type="button" className={styles.formatButton} aria-label={t('editors.italic')} title={t('editors.italic')}>
							<FontAwesomeIcon icon={faItalic} />
						</button>
						<button type="button" className={styles.formatButton} aria-label={t('editors.underline')} title={t('editors.underline')}>
							<FontAwesomeIcon icon={faUnderline} />
						</button>
						<button type="button" className={styles.formatButton} aria-label={t('editors.heading1')} title={t('editors.heading1')}>
							H1
						</button>
						<button type="button" className={styles.formatButton} aria-label={t('editors.heading2')} title={t('editors.heading2')}>
							H2
						</button>
						<button type="button" className={styles.formatButton} aria-label={t('editors.heading3')} title={t('editors.heading3')}>
							H3
						</button>
						<button type="button" className={styles.formatButton} aria-label={t('editors.bulletedList')} title={t('editors.bulletedList')}>
							<FontAwesomeIcon icon={faListUl} />
						</button>
						<button type="button" className={styles.formatButton} aria-label={t('editors.numberedList')} title={t('editors.numberedList')}>
							<FontAwesomeIcon icon={faListOl} />
						</button>
						<button type="button" className={styles.formatButton} aria-label={t('editors.alignLeft')} title={t('editors.alignLeft')}>
							<FontAwesomeIcon icon={faAlignLeft} />
						</button>
						<button type="button" className={styles.formatButton} aria-label={t('editors.alignCenter')} title={t('editors.alignCenter')}>
							<FontAwesomeIcon icon={faAlignCenter} />
						</button>
						<button type="button" className={styles.formatButton} aria-label={t('editors.alignRight')} title={t('editors.alignRight')}>
							<FontAwesomeIcon icon={faAlignRight} />
						</button>
						<button type="button" className={styles.formatButton} aria-label={t('editors.link')} title={t('editors.link')}>
							<FontAwesomeIcon icon={faLink} />
						</button>
					</div>
				</div>
				<textarea
					value={body}
					onChange={(e) => setBody(e.target.value)}
					placeholder={t('editors.bodyPlaceholder')}
					className={styles.fullBodyField}
				/>

				<div className={styles.editorBottomArea}>
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
							<button type="button" className={styles.bottomDockButton} aria-label={t('editors.dockAction')} disabled>
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
				</div>
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

			<section
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
			</section>

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
		</div>
	);
}
