import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faThumbtack,
	faUserPlus,
	faImage,
	faBell,
	faTrash,
	faFolderPlus,
	faTag,
	faSquareCheck,
	faSquare,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { useI18n } from '../../core/i18n';
import styles from './NoteCardMoreMenu.module.css';

type NoteType = 'text' | 'checklist';

export type NoteCardMoreMenuProps = {
	noteType: NoteType;
	onClose: () => void;
	onTrash?: (() => void) | undefined;
	/** Bounding rect of the anchor element (e.g. note card). On desktop the
	 *  menu renders as a popover positioned relative to this rect. */
	anchorRect?: { top: number; left: number; width: number; height: number } | null;
};

type MenuItem = {
	key: string;
	labelKey: string;
	icon: IconDefinition;
	danger?: boolean;
	action: () => void;
};

export function NoteCardMoreMenu(props: NoteCardMoreMenuProps): React.JSX.Element {
	const { t } = useI18n();
	const overlayRef = React.useRef<HTMLDivElement>(null);
	const menuRef = React.useRef<HTMLDivElement>(null);
	const onCloseRef = React.useRef(props.onClose);
	onCloseRef.current = props.onClose;

	// Device-mode detection:
	// We treat "pointer: fine" as desktop-like interaction (mouse/trackpad), and
	// "pointer: coarse" as mobile-like interaction (touch). This is more robust
	// than viewport width: a narrow desktop window should still get a popover.
	const isDesktop = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;
	// Desktop branch: render as a compact popover positioned relative to the
	// trigger element. Mobile branch: ignore anchorRect and use a bottom sheet.
	const anchor = isDesktop ? props.anchorRect ?? null : null;

	// Close on overlay click (but NOT clicks inside the sheet/popover body).
	const handleOverlayPointerDown = React.useCallback(
		(e: React.PointerEvent) => {
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
			if (active && didPush) {
				active = false;
				window.history.back();
			}
			active = false;
		};
	}, []);

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

	// Suppress accidental selection from the long-press touch that opened
	// the menu.  The finger is still down when the sheet mounts; if it
	// lifts over a menu item within the first 300ms, ignore that tap.
	const suppressUntilRef = React.useRef(isDesktop ? 0 : Date.now() + 300);

	const noop = (): void => {
		// Placeholder for unimplemented actions — close menu after tap
		props.onClose();
	};

	const items: MenuItem[] = [
		{ key: 'pin', labelKey: 'noteMenu.pinNote', icon: faThumbtack, action: noop },
		{ key: 'collaborator', labelKey: 'noteMenu.addCollaborator', icon: faUserPlus, action: noop },
		{ key: 'image', labelKey: 'noteMenu.addImage', icon: faImage, action: noop },
		{ key: 'reminder', labelKey: 'noteMenu.addReminder', icon: faBell, action: noop },
		...(props.onTrash
			? [{ key: 'trash', labelKey: 'noteMenu.moveToTrash', icon: faTrash, danger: true, action: props.onTrash }]
			: []),
		{ key: 'collection', labelKey: 'noteMenu.addToCollection', icon: faFolderPlus, action: noop },
		{ key: 'label', labelKey: 'noteMenu.addLabel', icon: faTag, action: noop },
	];

	const checklistItems: MenuItem[] =
		props.noteType === 'checklist'
			? [
					{ key: 'uncheckAll', labelKey: 'noteMenu.uncheckAll', icon: faSquare, action: noop },
					{ key: 'checkAll', labelKey: 'noteMenu.checkAll', icon: faSquareCheck, action: noop },
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

		// Prefer left-aligned with the anchor's left edge
		let left = anchor.left;
		// Prefer above the anchor (opens upward from the button)
		let top = anchor.top - menuRect.height - 4;

		// If it overflows top, show below instead
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
			role="dialog"
			aria-modal="true"
			onPointerDown={handleOverlayPointerDown}
		>
			<div ref={menuRef} className={anchor ? styles.popover : styles.sheet} style={anchor ? popoverStyle : undefined}>
				{!anchor && <div className={styles.handle} />}
				<ul className={styles.menuList} role="menu">
					{items.map((item) => (
						<li key={item.key} role="none">
							<button
								type="button"
								role="menuitem"
								className={`${styles.menuItem}${item.danger ? ` ${styles.menuItemDanger}` : ''}`}
								onClick={(e) => {
									e.stopPropagation();
									if (Date.now() < suppressUntilRef.current) return;
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
										className={styles.menuItem}
										onClick={(e) => {
											e.stopPropagation();
											if (Date.now() < suppressUntilRef.current) return;
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
