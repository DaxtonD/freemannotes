import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faThumbtack,
	faUserPlus,
	faImage,
	faPenNib,
	faFolderOpen,
	faLink,
	faBell,
	faTrash,
	faArrowRotateLeft,
	faFolderPlus,
	faTag,
	faSquareCheck,
	faSquare,
	faXmark,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { byPrefixAndName } from '../../core/byPrefixAndName';
import { useI18n } from '../../core/i18n';
import styles from './NoteCardMoreMenu.module.css';

type NoteType = 'text' | 'checklist';

export type NoteCardMoreMenuProps = {
	noteType: NoteType;
	onClose: () => void;
	openedByLongPress?: boolean;
	isPinned?: boolean;
	onTogglePin?: (() => void) | undefined;
	onTrash?: (() => void) | undefined;
	onAddCollaborator?: (() => void) | undefined;
	onAddImage?: (() => void) | undefined;
	onSelectBannerImage?: (() => void) | undefined;
	onAddDocument?: (() => void) | undefined;
	onAddUrlPreview?: (() => void) | undefined;
	onAddReminder?: (() => void) | undefined;
	onAddToCollection?: (() => void) | undefined;
	onAddLabels?: (() => void) | undefined;
	onMoveToWorkspace?: (() => void) | undefined;
	onCheckAll?: (() => void) | undefined;
	onUncheckAll?: (() => void) | undefined;
	isTrashView?: boolean;
	showAddImage?: boolean;
	showAddDocument?: boolean;
	/** Bounding rect of the anchor element (e.g. note card). On desktop the
	 *  menu renders as a popover positioned relative to this rect. */
	anchorRect?: { top: number; left: number; width: number; height: number } | null;
};

type MenuItem = {
	key: string;
	labelKey: string;
	icon: IconDefinition;
	danger?: boolean;
	disabled?: boolean;
	action: () => void;
};

export function NoteCardMoreMenu(props: NoteCardMoreMenuProps): React.JSX.Element {
	const { t } = useI18n();
	const isTrashView = props.isTrashView === true;
	const overlayRef = React.useRef<HTMLDivElement>(null);
	const menuRef = React.useRef<HTMLDivElement>(null);
	const onCloseRef = React.useRef(props.onClose);
	onCloseRef.current = props.onClose;
	const isMoreMenuHistoryEntry = React.useCallback((value: unknown): boolean => {
		if (!value || typeof value !== 'object') return false;
		return (value as { __moreMenu?: boolean }).__moreMenu === true;
	}, []);

	// Device-mode detection:
	// We treat "pointer: fine" as desktop-like interaction (mouse/trackpad), and
	// "pointer: coarse" as mobile-like interaction (touch). This is more robust
	// than viewport width: a narrow desktop window should still get a popover.
	const isDesktop = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;
	// Desktop branch: render as a compact popover positioned relative to the
	// trigger element. Mobile branch: ignore anchorRect and use a bottom sheet.
	const anchor = isDesktop ? props.anchorRect ?? null : null;
	const useInitialTouchGuard = !isDesktop && props.openedByLongPress === true;
	const showAddImage = props.showAddImage !== false;
	const showAddDocument = props.showAddDocument !== false;

	// Close on overlay click (but NOT clicks inside the sheet/popover body).
	// Use click rather than pointerdown so the overlay stays mounted for the
	// whole tap sequence and the final click cannot fall through to a note row.
	const handleOverlayClick = React.useCallback(
		(e: React.MouseEvent) => {
			if (e.target === overlayRef.current) {
				e.preventDefault();
				e.stopPropagation();
				props.onClose();
			}
		},
		[props.onClose]
	);

	// Close on Escape
	React.useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') props.onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [props.onClose]);

	// Mobile back-button support: push a history entry so Android back
	// closes the menu instead of navigating away.
	//
	// The pushState is deferred to the next macrotask so React StrictMode's
	// synchronous mount → cleanup → remount cycle doesn't leave a stale
	// popstate event that immediately closes the menu on the second mount.
	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		const mql = window.matchMedia('(pointer: coarse)');
		if (!mql.matches) return; // desktop — skip history management

		let active = true;
		let didPush = false;

		const pushTimer = window.setTimeout(() => {
			if (!active) return;
			didPush = true;
			window.history.pushState({ __moreMenu: true }, '');
		}, 0);

		const onPopState = (): void => {
			if (active && didPush) {
				active = false;
				onCloseRef.current();
			}
		};
		window.addEventListener('popstate', onPopState);

		return () => {
			window.clearTimeout(pushTimer);
			window.removeEventListener('popstate', onPopState);
			if (active && didPush && isMoreMenuHistoryEntry(window.history.state)) {
				active = false;
				window.history.back();
			}
			active = false;
		};
	}, [isMoreMenuHistoryEntry]);

	// Prevent body/html scroll while menu is open (including iOS rubber-banding)
	React.useEffect(() => {
		if (isDesktop) return; // desktop popover doesn't need scroll lock
		const html = document.documentElement;
		const body = document.body;
		const prevHtmlOverflow = html.style.overflow;
		const prevBodyOverflow = body.style.overflow;
		const prevHtmlTouchAction = html.style.touchAction;
		html.style.overflow = 'hidden';
		body.style.overflow = 'hidden';
		html.style.touchAction = 'none';
		return () => {
			html.style.overflow = prevHtmlOverflow;
			body.style.overflow = prevBodyOverflow;
			html.style.touchAction = prevHtmlTouchAction;
		};
	}, []);

	// Suppress only the synthetic/carry-over events immediately after a
	// long-press opens the sheet. Relying on the sheet to observe the
	// original touch release is unreliable because the menu mounts mid-gesture.
	const suppressUntilRef = React.useRef(useInitialTouchGuard ? Date.now() + 180 : 0);
	const [isTouchInteractionLocked, setIsTouchInteractionLocked] = React.useState(useInitialTouchGuard);
	const releaseUnlockTimerRef = React.useRef<number>(0);
	const requiresFreshTouchRef = React.useRef(useInitialTouchGuard);
	const handleTouchStartRef = React.useRef<{ x: number; y: number; id: number } | null>(null);

	const isInitialTouchGuardActive = React.useCallback((): boolean => {
		return Date.now() < suppressUntilRef.current;
	}, []);

	const unlockTouchInteraction = React.useCallback((): void => {
		if (!useInitialTouchGuard) return;
		setIsTouchInteractionLocked(false);
		suppressUntilRef.current = Date.now() + 32;
		window.getSelection()?.removeAllRanges();
	}, [useInitialTouchGuard]);

	const scheduleTouchInteractionUnlock = React.useCallback((): void => {
		if (!useInitialTouchGuard) return;
		if (typeof window === 'undefined') {
			unlockTouchInteraction();
			return;
		}
		if (releaseUnlockTimerRef.current) return;
		releaseUnlockTimerRef.current = window.setTimeout(() => {
			releaseUnlockTimerRef.current = 0;
			unlockTouchInteraction();
		}, 0);
	}, [unlockTouchInteraction, useInitialTouchGuard]);

	const swallowSuppressedInteraction = React.useCallback((event: React.SyntheticEvent): void => {
		if (!isInitialTouchGuardActive()) return;
		event.preventDefault();
		event.stopPropagation();
		window.getSelection()?.removeAllRanges();
	}, [isInitialTouchGuardActive]);

	const handleTouchEndCapture = React.useCallback((event: React.TouchEvent<HTMLDivElement>): void => {
		swallowSuppressedInteraction(event);
	}, [swallowSuppressedInteraction]);

	const handlePointerUpCapture = React.useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
		if (event.pointerType !== 'touch') {
			swallowSuppressedInteraction(event);
			return;
		}
		swallowSuppressedInteraction(event);
	}, [swallowSuppressedInteraction]);

	React.useEffect(() => {
		if (!useInitialTouchGuard || isDesktop || !isTouchInteractionLocked || typeof window === 'undefined') return;

		const handleRelease = (): void => {
			scheduleTouchInteractionUnlock();
		};
		const handleForceUnlock = (): void => {
			scheduleTouchInteractionUnlock();
		};
		window.addEventListener('touchend', handleRelease, true);
		window.addEventListener('touchcancel', handleRelease, true);
		window.addEventListener('pointerup', handleRelease, true);
		window.addEventListener('pointercancel', handleRelease, true);
		window.addEventListener('blur', handleForceUnlock, true);
		document.addEventListener('visibilitychange', handleForceUnlock, true);
		return () => {
			window.removeEventListener('touchend', handleRelease, true);
			window.removeEventListener('touchcancel', handleRelease, true);
			window.removeEventListener('pointerup', handleRelease, true);
			window.removeEventListener('pointercancel', handleRelease, true);
			window.removeEventListener('blur', handleForceUnlock, true);
			document.removeEventListener('visibilitychange', handleForceUnlock, true);
		};
	}, [isDesktop, isTouchInteractionLocked, scheduleTouchInteractionUnlock, useInitialTouchGuard]);

	const handleFreshTouchStart = React.useCallback((): void => {
		if (!useInitialTouchGuard) return;
		if (isTouchInteractionLocked) return;
		if (isInitialTouchGuardActive()) return;
		requiresFreshTouchRef.current = false;
	}, [isInitialTouchGuardActive, isTouchInteractionLocked, useInitialTouchGuard]);

	const swallowLockedTouchInteraction = React.useCallback((event: React.SyntheticEvent): void => {
		if (!useInitialTouchGuard) return;
		if (!isTouchInteractionLocked) return;
		event.preventDefault();
		event.stopPropagation();
		window.getSelection()?.removeAllRanges();
	}, [isTouchInteractionLocked, useInitialTouchGuard]);

	React.useEffect(() => {
		return () => {
			if (releaseUnlockTimerRef.current && typeof window !== 'undefined') {
				window.clearTimeout(releaseUnlockTimerRef.current);
				releaseUnlockTimerRef.current = 0;
			}
		};
	}, []);

	const clearHandleGesture = React.useCallback((): void => {
		handleTouchStartRef.current = null;
	}, []);

	const handleSheetHandleTouchStart = React.useCallback((event: React.TouchEvent<HTMLButtonElement>): void => {
		// Track just the handle gesture so the bottom-sheet close swipe does not
		// compete with list-item taps inside the menu body.
		if (anchor) return;
		const touch = event.touches[0];
		if (!touch) return;
		event.stopPropagation();
		handleTouchStartRef.current = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
	}, [anchor]);

	const handleSheetHandleTouchMove = React.useCallback((event: React.TouchEvent<HTMLButtonElement>): void => {
		if (!handleTouchStartRef.current) return;
		event.stopPropagation();
		if (event.cancelable) event.preventDefault();
	}, []);

	const handleSheetHandleTouchEnd = React.useCallback((event: React.TouchEvent<HTMLButtonElement>): void => {
		const start = handleTouchStartRef.current;
		const touch = Array.from(event.changedTouches).find((item) => item.identifier === start?.id) ?? null;
		clearHandleGesture();
		if (!start || !touch) return;
		event.stopPropagation();
		if (event.cancelable) event.preventDefault();
		const dx = touch.clientX - start.x;
		const dy = touch.clientY - start.y;
		// Require a mostly-vertical drag so a short tap or sideways adjustment on the
		// handle never dismisses the menu.
		if (Math.abs(dy) < 28 || Math.abs(dy) < Math.abs(dx)) return;
		if (dy > 0) props.onClose();
	}, [clearHandleGesture, props]);

	React.useEffect(() => {
		if (typeof document === 'undefined') return;
		const clearSelection = (): void => {
			if (!isInitialTouchGuardActive()) return;
			window.getSelection()?.removeAllRanges();
		};
		const preventContextMenu = (event: Event): void => {
			if (!isInitialTouchGuardActive()) return;
			event.preventDefault();
		};
		document.addEventListener('selectionchange', clearSelection);
		document.addEventListener('contextmenu', preventContextMenu, true);
		return () => {
			document.removeEventListener('selectionchange', clearSelection);
			document.removeEventListener('contextmenu', preventContextMenu, true);
		};
	}, [isInitialTouchGuardActive]);

	const noop = (): void => {
		// Placeholder for unimplemented actions — close menu after tap
		props.onClose();
	};

	const items: MenuItem[] = [
		{
			key: 'pin',
			labelKey: props.isPinned ? 'noteMenu.unpinNote' : 'noteMenu.pinNote',
			icon: faThumbtack,
			disabled: isTrashView || !props.onTogglePin,
			action: () => {
				if (isTrashView) return;
				props.onClose();
				props.onTogglePin?.();
			},
		},
		...(props.onAddCollaborator
			? [{
				key: 'collaborator',
				labelKey: 'noteMenu.addCollaborator',
				icon: faUserPlus,
				disabled: isTrashView,
				action: () => {
					props.onClose();
					props.onAddCollaborator?.();
				},
			}]
			: []),
		...(showAddImage
			? (props.onAddImage
				? [{
					key: 'image',
					labelKey: 'noteMenu.addImage',
					icon: faImage,
					disabled: isTrashView,
					action: () => {
						props.onClose();
						props.onAddImage?.();
					},
				}]
				: [{ key: 'image', labelKey: 'noteMenu.addImage', icon: faImage, disabled: isTrashView, action: noop }])
			: []),
		...(props.onSelectBannerImage
			? [{
				key: 'banner-image',
				labelKey: 'noteMenu.selectBannerImage',
				icon: byPrefixAndName.far['clapperboard'],
				disabled: isTrashView,
				action: () => {
					props.onClose();
					props.onSelectBannerImage?.();
				},
			}]
			: []),
		...(showAddDocument
			? (props.onAddDocument
				? [{
					key: 'document',
					labelKey: 'noteMenu.addDocument',
					icon: faPenNib,
					disabled: isTrashView,
					action: () => {
						props.onClose();
						props.onAddDocument?.();
					},
				}]
				: [{ key: 'document', labelKey: 'noteMenu.addDocument', icon: faPenNib, disabled: isTrashView, action: noop }])
			: []),
		...(props.onAddUrlPreview
			? [{
				key: 'url-preview',
				labelKey: 'noteMenu.addUrlPreview',
				icon: faLink,
				disabled: isTrashView,
				action: () => {
					props.onClose();
					props.onAddUrlPreview?.();
				},
			}]
			: []),
		...(props.onAddReminder
			? [{
				key: 'reminder',
				labelKey: 'noteMenu.addReminder',
				icon: faBell,
				disabled: isTrashView,
				action: () => {
					props.onClose();
					props.onAddReminder?.();
				},
			}]
			: [{ key: 'reminder', labelKey: 'noteMenu.addReminder', icon: faBell, disabled: isTrashView, action: noop }]),
		...(props.onMoveToWorkspace
			? [{
				key: 'move-workspace',
				labelKey: 'noteMenu.moveToWorkspace',
				icon: faFolderOpen,
				disabled: isTrashView,
				action: () => {
					props.onClose();
					props.onMoveToWorkspace?.();
				},
			}]
			: []),
		...(props.onTrash
			? [{
				key: 'trash',
				labelKey: isTrashView ? 'noteMenu.restoreNote' : 'noteMenu.moveToTrash',
				icon: isTrashView ? faArrowRotateLeft : faTrash,
				danger: true,
				action: props.onTrash,
			}]
			: []),
		...(props.onAddToCollection
			? [{
				key: 'collection',
				labelKey: 'noteMenu.addToCollection',
				icon: faFolderPlus,
				disabled: isTrashView,
				action: () => {
					props.onClose();
					props.onAddToCollection?.();
				},
			}]
			: [{ key: 'collection', labelKey: 'noteMenu.addToCollection', icon: faFolderPlus, disabled: isTrashView, action: noop }]),
		...(props.onAddLabels
			? [{
				key: 'label',
				labelKey: 'noteMenu.addLabel',
				icon: faTag,
				disabled: isTrashView,
				action: () => {
					props.onClose();
					props.onAddLabels?.();
				},
			}]
			: [{ key: 'label', labelKey: 'noteMenu.addLabel', icon: faTag, disabled: isTrashView, action: noop }]),
	];

	const checklistItems: MenuItem[] =
		props.noteType === 'checklist'
			? [
					{
						key: 'uncheckAll',
						labelKey: 'noteMenu.uncheckAll',
						icon: faSquare,
						disabled: isTrashView || !props.onUncheckAll,
						action: () => {
							if (isTrashView) return;
							props.onClose();
							props.onUncheckAll?.();
						},
					},
					{
						key: 'checkAll',
						labelKey: 'noteMenu.checkAll',
						icon: faSquareCheck,
						disabled: isTrashView || !props.onCheckAll,
						action: () => {
							if (isTrashView) return;
							props.onClose();
							props.onCheckAll?.();
						},
					},
				]
			: [];

	// Desktop popover positioning:
	// - Prefer opening "above" the trigger (matches editor dock buttons near the
	//   bottom of the viewport, and matches the desired desktop-context-menu feel).
	// - Prefer left alignment with the trigger.
	// - Clamp to the viewport so it never renders off-screen.
	const [popoverStyle, setPopoverStyle] = React.useState<React.CSSProperties>({});
	React.useLayoutEffect(() => {
		if (!anchor || !menuRef.current) return;
		const menu = menuRef.current;
		const menuRect = menu.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const pad = 8;
		const upwardLift = 12;

		// Prefer left-aligned with the anchor's left edge
		let left = anchor.left;
		// Prefer above the anchor (opens upward from the button)
		let top = anchor.top - menuRect.height - (anchor.height > 0 ? 4 : 0) - upwardLift;

		// If it overflows top, show below instead. Footer-triggered anchors carry
		// footer height so the downward fallback clears the dock band cleanly.
		if (top < pad) {
			top = anchor.top + anchor.height + 4;
		}
		// Clamp horizontal
		if (left + menuRect.width > vw - pad) left = vw - pad - menuRect.width;
		if (left < pad) left = pad;
		// Clamp vertical
		if (top < pad) top = pad;

		setPopoverStyle({ top, left });
	}, [anchor]);

	return (
		<div
			ref={overlayRef}
			className={anchor ? styles.overlayDesktop : styles.overlay}
			data-note-more-menu-overlay="true"
			role="dialog"
			aria-modal="true"
			onClick={handleOverlayClick}
			onPointerUpCapture={handlePointerUpCapture}
			onClickCapture={swallowSuppressedInteraction}
			onTouchEndCapture={handleTouchEndCapture}
			onSelect={(event) => {
				if (!isInitialTouchGuardActive()) return;
				event.preventDefault();
				window.getSelection()?.removeAllRanges();
			}}
		>
			<div
				ref={menuRef}
				className={anchor ? styles.popover : styles.sheet}
				data-note-more-menu-panel="true"
				style={anchor ? popoverStyle : undefined}
				onTouchStartCapture={!anchor ? handleFreshTouchStart : undefined}
				onPointerDownCapture={!anchor ? (event) => {
					if (isTouchInteractionLocked) {
						swallowLockedTouchInteraction(event);
						return;
					}
					if (event.pointerType === 'touch') handleFreshTouchStart();
				} : undefined}
				onTouchStart={!anchor ? swallowLockedTouchInteraction : undefined}
				onTouchMove={!anchor ? swallowLockedTouchInteraction : undefined}
				onTouchEnd={!anchor ? swallowLockedTouchInteraction : undefined}
				onPointerDown={!anchor ? swallowLockedTouchInteraction : undefined}
				onPointerUp={!anchor ? swallowLockedTouchInteraction : undefined}
			>
				<div className={anchor ? styles.popoverHeader : styles.sheetHeader}>
					{!anchor ? (
						<button
							type="button"
							className={styles.sheetHandle}
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
							}}
							onTouchStart={handleSheetHandleTouchStart}
							onTouchMove={handleSheetHandleTouchMove}
							onTouchEnd={handleSheetHandleTouchEnd}
							onTouchCancel={clearHandleGesture}
							aria-label={t('common.close')}
						>
							<span className={styles.sheetHandlePill} aria-hidden="true" />
						</button>
					) : <span className={styles.headerSpacer} aria-hidden="true" />}
					<button
						type="button"
						className={styles.closeButton}
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							props.onClose();
						}}
						aria-label={t('common.close')}
						title={t('common.close')}
					>
						<FontAwesomeIcon icon={faXmark} aria-hidden="true" />
					</button>
				</div>
				<ul className={styles.menuList} role="menu">
					{items.map((item) => (
						<li key={item.key} role="none">
							<button
								type="button"
								role="menuitem"
								className={`${styles.menuItem}${item.danger ? ` ${styles.menuItemDanger}` : ''}${item.disabled ? ` ${styles.menuItemDisabled}` : ''}`}
								disabled={item.disabled}
								aria-disabled={item.disabled ? 'true' : undefined}
								onClick={(e) => {
									e.stopPropagation();
									if (item.disabled) return;
									if (!anchor && requiresFreshTouchRef.current) {
										e.preventDefault();
										return;
									}
									if (isInitialTouchGuardActive()) {
										e.preventDefault();
										return;
									}
									item.action();
								}}
							>
								<span className={styles.menuItemIcon}>
									<FontAwesomeIcon icon={item.icon} />
								</span>
								{t(item.labelKey)}
							</button>
						</li>
					))}

					{checklistItems.length > 0 ? (
						<>
							<li role="none"><div className={styles.divider} /></li>
							{checklistItems.map((item) => (
								<li key={item.key} role="none">
									<button
										type="button"
										role="menuitem"
										className={`${styles.menuItem}${item.disabled ? ` ${styles.menuItemDisabled}` : ''}`}
										disabled={item.disabled}
										aria-disabled={item.disabled ? 'true' : undefined}
										onClick={(e) => {
											e.stopPropagation();
											if (item.disabled) return;
											if (!anchor && requiresFreshTouchRef.current) {
												e.preventDefault();
												return;
											}
											if (isInitialTouchGuardActive()) {
												e.preventDefault();
												return;
											}
											item.action();
										}}
									>
										<span className={styles.menuItemIcon}>
											<FontAwesomeIcon icon={item.icon} />
										</span>
										{t(item.labelKey)}
									</button>
								</li>
							))}
						</>
					) : null}
				</ul>
			</div>
		</div>
	);
}
