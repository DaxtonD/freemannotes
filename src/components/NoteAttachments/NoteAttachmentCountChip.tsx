import React from 'react';
import type * as Y from 'yjs';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileLines, faImage, faLink, faPaperclip, faPenNib } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import { readInheritedNoteColorVars } from '../../core/noteChipOverlayColors';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import { MOBILE_GRID_EDGE_MARGIN_PX } from '../NoteGrid/layout';
import { readDrawingLinkState } from '../../core/noteModel';
import { extractNoteLinksFromDoc } from '../../core/noteLinks';
import { getCachedRemoteNoteLinks, getNoteLinksChangedEventName, readStoredNoteLinks, refreshRemoteNoteLinks } from '../../core/noteLinkStore';
import { filterQueuedUploadsNotYetRemote, filterRemoteNoteImagesByPendingDeletes, getCachedRemoteNoteImages, getNoteMediaChangedEventName, readQueuedNoteImageDeletions, readQueuedNoteImages, readStoredRemoteNoteImages, refreshRemoteNoteImages } from '../../core/noteMediaStore';
import {
	getCachedNoteDocuments,
	getNoteDocumentsChangedEventName,
	hasCachedRemoteNoteDocuments,
	readQueuedNoteDocumentDeletions,
	readQueuedNoteDocuments,
	readStoredRemoteNoteDocuments,
	refreshRemoteNoteDocuments,
} from '../../core/noteDocumentStore';
import styles from './NoteAttachmentCountChip.module.css';

export type NoteAttachmentBrowserKind = 'images' | 'links' | 'drawings' | 'documents';

type AttachmentCounts = {
	images: number;
	links: number;
	drawings: number;
	documents: number;
};

type NoteAttachmentCountChipProps = {
	docId: string;
	doc: Y.Doc;
	authUserId?: string | null;
	className: string;
	colorStyle?: React.CSSProperties;
	initialCounts?: Partial<AttachmentCounts>;
	allowedKinds?: readonly NoteAttachmentBrowserKind[];
	forceClosed?: boolean;
	onOpenBrowser: (kind: NoteAttachmentBrowserKind) => void;
	onOpenStateChange?: (isOpen: boolean) => void;
	suspendRemoteRefresh?: boolean;
	disableInitialRemoteRefresh?: boolean;
};

function readAnchorRect(element: HTMLElement | null): { top: number; left: number; width: number; height: number } | null {
	if (!element) return null;
	// Match the other note-card chips by using the card shell for width/centering
	// while preserving the trigger button's vertical position for below/above flip.
	const triggerRect = element.getBoundingClientRect();
	const cardShell = element.closest('[data-note-content="true"]');
	const target = cardShell instanceof HTMLElement ? cardShell : element;
	const cardRect = target.getBoundingClientRect();
	return { top: triggerRect.top, left: cardRect.left, width: cardRect.width, height: triggerRect.height };
}

function AttachmentChipDismissSurface(props: { children: React.ReactNode }): React.JSX.Element {
	return (
		<div
			className={styles.overlayRoot}
			role="presentation"
			style={{ pointerEvents: 'none' }}
		>
			{props.children}
		</div>
	);
}

function preventAttachmentOverlayMouseFocus(event: React.MouseEvent<HTMLButtonElement>): void {
	// Prevent the portal-hosted row button from stealing focus on desktop clicks,
	// which can trigger an unexpected scroll jump before the browser modal opens.
	if (event.cancelable) event.preventDefault();
	event.stopPropagation();
}

function stopAttachmentOverlayPressBubble(event: React.SyntheticEvent): void {
	event.stopPropagation();
}

function readInitialCount(value: number | undefined): number {
	return Math.max(0, Number(value ?? 0) || 0);
}

export function NoteAttachmentCountChip(props: NoteAttachmentCountChipProps): React.JSX.Element | null {
	const { t } = useI18n();
	const isCoarsePointer = useIsCoarsePointer();
	const allowedKinds = React.useMemo<readonly NoteAttachmentBrowserKind[]>(() => (
		props.allowedKinds && props.allowedKinds.length > 0
			? props.allowedKinds
			: ['images', 'links', 'drawings', 'documents']
	), [props.allowedKinds]);
	const allowsImages = allowedKinds.includes('images');
	const allowsLinks = allowedKinds.includes('links');
	const allowsDrawings = allowedKinds.includes('drawings');
	const allowsDocuments = allowedKinds.includes('documents');
	const buttonRef = React.useRef<HTMLButtonElement | null>(null);
	const overlayPanelRef = React.useRef<HTMLDivElement | null>(null);
	const backStatePushedRef = React.useRef(false);
	const [counts, setCounts] = React.useState<AttachmentCounts>(() => ({
		images: Math.max(getCachedRemoteNoteImages(props.docId).length, readInitialCount(props.initialCounts?.images)),
		links: Math.max(getCachedRemoteNoteLinks(props.docId).length, extractNoteLinksFromDoc(props.doc).length, readInitialCount(props.initialCounts?.links)),
		drawings: Math.max(readDrawingLinkState(props.doc).drawingIds.length, readInitialCount(props.initialCounts?.drawings)),
		documents: Math.max(getCachedNoteDocuments(props.docId).length, readInitialCount(props.initialCounts?.documents)),
	}));
	const countsRef = React.useRef(counts);
	const [isOpen, setIsOpen] = React.useState(false);
	const [anchorRect, setAnchorRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);
	// The card's real colors (banner-derived included), captured when the dropdown opens.
	const [overlayColorStyle, setOverlayColorStyle] = React.useState<React.CSSProperties | undefined>(undefined);
	const onOpenStateChangeRef = React.useRef(props.onOpenStateChange);

	React.useEffect(() => {
		// Mirror callback props into refs so refresh/open handlers can stay stable and
		// avoid effect churn while still calling the latest parent callback.
		onOpenStateChangeRef.current = props.onOpenStateChange;
	}, [props.onOpenStateChange]);

	React.useEffect(() => {
		onOpenStateChangeRef.current?.(isOpen);
	}, [isOpen]);

	React.useEffect(() => {
		if (!props.forceClosed) return;
		setIsOpen(false);
	}, [props.forceClosed]);

	React.useEffect(() => {
		countsRef.current = counts;
	}, [counts]);

	React.useEffect(() => {
		setCounts((current) => ({
			images: Math.max(current.images, readInitialCount(props.initialCounts?.images)),
			links: Math.max(current.links, readInitialCount(props.initialCounts?.links)),
			drawings: Math.max(current.drawings, readInitialCount(props.initialCounts?.drawings)),
			documents: Math.max(current.documents, readInitialCount(props.initialCounts?.documents)),
		}));
	}, [props.initialCounts?.documents, props.initialCounts?.drawings, props.initialCounts?.images, props.initialCounts?.links]);

	const refresh = React.useCallback(async (options?: {
		scope?: 'all' | 'media' | 'drawings' | 'links' | 'documents';
		syncRemote?: boolean;
		forceRemote?: boolean;
	}): Promise<AttachmentCounts> => {
		const scope = options?.scope ?? 'all';
		const includeMedia = scope === 'all' || scope === 'media';
		const includeDrawings = scope === 'all' || scope === 'drawings';
		const includeLinks = scope === 'all' || scope === 'links';
		const includeDocuments = scope === 'all' || scope === 'documents';
		// Combine queued + cached + remote counts so the chip reflects the user's intent
		// immediately, even while uploads/deletes are still in flight or offline.
		const [queuedImages, queuedDeletes, storedRemoteImages, storedRemoteLinks, localDocumentCount] = await Promise.all([
			props.authUserId ? readQueuedNoteImages(props.authUserId, props.docId) : Promise.resolve([]),
			props.authUserId ? readQueuedNoteImageDeletions(props.authUserId, props.docId) : Promise.resolve([]),
			includeMedia ? readStoredRemoteNoteImages(props.docId) : Promise.resolve([]),
			includeLinks ? readStoredNoteLinks(props.docId) : Promise.resolve([]),
			includeDocuments
				? (async () => {
					// Documents: the store's merged view already means "server list − pending
					// deletes + queued uploads". Only pull the server list from IndexedDB when
					// nothing has loaded it this session, so a stale stored copy can't
					// overwrite a fresher one a panel just fetched.
					await Promise.all([
						hasCachedRemoteNoteDocuments(props.docId) ? Promise.resolve([]) : readStoredRemoteNoteDocuments(props.docId).catch(() => []),
						props.authUserId ? readQueuedNoteDocuments(props.authUserId, props.docId).catch(() => []) : Promise.resolve([]),
						props.authUserId ? readQueuedNoteDocumentDeletions(props.authUserId, props.docId).catch(() => []) : Promise.resolve([]),
					]);
					return getCachedNoteDocuments(props.docId).length;
				})()
				: Promise.resolve(countsRef.current.documents),
		]);
		const extractedLinkCount = extractNoteLinksFromDoc(props.doc).length;
		const drawingCount = readDrawingLinkState(props.doc).drawingIds.length;
		const visibleRemoteLocal = includeMedia
			? filterRemoteNoteImagesByPendingDeletes(
				storedRemoteImages.length > 0 ? storedRemoteImages : getCachedRemoteNoteImages(props.docId),
				queuedDeletes
			)
			: [];
		const localCounts: AttachmentCounts = {
			images: includeMedia
				? visibleRemoteLocal.length + filterQueuedUploadsNotYetRemote(queuedImages, visibleRemoteLocal).length
				: countsRef.current.images,
			links: includeLinks ? Math.max(storedRemoteLinks.length, extractedLinkCount) : countsRef.current.links,
			drawings: includeDrawings ? drawingCount : countsRef.current.drawings,
			documents: localDocumentCount,
		};
		setCounts((current) => ({
			images: includeMedia ? localCounts.images : current.images,
			links: includeLinks ? localCounts.links : current.links,
			drawings: includeDrawings ? localCounts.drawings : current.drawings,
			documents: includeDocuments ? localCounts.documents : current.documents,
		}));

		if (!options?.syncRemote) return localCounts;

		try {
			const [remoteImages, remoteLinks, remoteDocumentCount] = await Promise.all([
				includeMedia
					? refreshRemoteNoteImages(props.docId, {
						force: options.forceRemote,
						minIntervalMs: options.forceRemote ? 0 : 15_000,
					})
					: Promise.resolve<readonly ReturnType<typeof getCachedRemoteNoteImages>[number][]>([]),
				includeLinks
					? refreshRemoteNoteLinks(props.docId, {
						force: options.forceRemote,
					})
					: Promise.resolve<readonly ReturnType<typeof getCachedRemoteNoteLinks>[number][]>([]),
				includeDocuments
					? refreshRemoteNoteDocuments(props.docId, { userId: props.authUserId })
						.then((documents) => documents.length)
						.catch(() => localCounts.documents)
					: Promise.resolve(localCounts.documents),
			]);
			const visibleRemoteSync = filterRemoteNoteImagesByPendingDeletes(remoteImages, queuedDeletes);
			const remoteCounts: AttachmentCounts = {
				images: includeMedia
					? visibleRemoteSync.length + filterQueuedUploadsNotYetRemote(queuedImages, visibleRemoteSync).length
					: localCounts.images,
				links: includeLinks ? Math.max(remoteLinks.length, extractedLinkCount) : localCounts.links,
				drawings: includeDrawings ? drawingCount : localCounts.drawings,
				documents: remoteDocumentCount,
			};
			setCounts((current) => ({
				images: includeMedia ? remoteCounts.images : current.images,
				links: includeLinks ? remoteCounts.links : current.links,
				drawings: includeDrawings ? remoteCounts.drawings : current.drawings,
				documents: includeDocuments ? remoteCounts.documents : current.documents,
			}));
			return remoteCounts;
		} catch {
			// Keep the best local counts when refreshes fail.
			return localCounts;
		}
	}, [props.authUserId, props.doc, props.docId]);

	React.useEffect(() => {
		if (props.suspendRemoteRefresh) return;
		let cancelled = false;
		void (async () => {
			await refresh({ syncRemote: !props.disableInitialRemoteRefresh });
			if (cancelled) return;
		})();
		return () => {
			cancelled = true;
		};
	}, [props.disableInitialRemoteRefresh, props.suspendRemoteRefresh, refresh]);

	React.useEffect(() => {
		const onDocUpdate = (): void => {
			const extracted = extractNoteLinksFromDoc(props.doc).length;
			const cachedRemote = getCachedRemoteNoteLinks(props.docId).length;
			setCounts((current) => ({
				...current,
				links: Math.max(extracted, cachedRemote),
				drawings: readDrawingLinkState(props.doc).drawingIds.length,
			}));
		};
		props.doc.on('update', onDocUpdate);
		return () => {
			props.doc.off('update', onDocUpdate);
		};
	}, [props.doc, props.docId]);

	React.useEffect(() => {
		if (props.suspendRemoteRefresh) return () => {};
		const mediaEventName = getNoteMediaChangedEventName();
		const linksEventName = getNoteLinksChangedEventName();
		const documentsEventName = getNoteDocumentsChangedEventName();
		const onMediaChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string }>).detail;
			if (!detail?.docId || detail.docId === props.docId) {
				void refresh({ scope: 'media', syncRemote: true, forceRemote: true });
			}
		};
		const onLinksChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string; reason?: 'cache' | 'remote' }>).detail;
			if (!detail?.docId || detail.docId === props.docId) {
				if (detail?.reason === 'cache') {
					const extracted = extractNoteLinksFromDoc(props.doc).length;
					const cachedRemote = getCachedRemoteNoteLinks(props.docId).length;
					setCounts((current) => ({ ...current, links: Math.max(extracted, cachedRemote) }));
					return;
				}
				void refresh({ scope: 'links', syncRemote: true, forceRemote: true });
			}
		};
		const onDocumentsChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string }>).detail;
			if (!detail?.docId || detail.docId === props.docId) {
				// Fires for local queue changes and, via App, for changes made on other
				// devices. Concurrent refreshes for the same note share one request in the store.
				void refresh({ scope: 'documents', syncRemote: true });
			}
		};
		const onOnline = (): void => {
			void refresh({ scope: 'all', syncRemote: true, forceRemote: true });
		};
		window.addEventListener(mediaEventName, onMediaChanged as EventListener);
		window.addEventListener(linksEventName, onLinksChanged as EventListener);
		window.addEventListener(documentsEventName, onDocumentsChanged as EventListener);
		window.addEventListener('online', onOnline);
		return () => {
			window.removeEventListener(mediaEventName, onMediaChanged as EventListener);
			window.removeEventListener(linksEventName, onLinksChanged as EventListener);
			window.removeEventListener(documentsEventName, onDocumentsChanged as EventListener);
			window.removeEventListener('online', onOnline);
		};
	}, [props.docId, props.suspendRemoteRefresh, refresh]);

	React.useEffect(() => {
		if (!isOpen) return;

		// Track the trigger rect while open so scrolling the grid or resizing the window
		// does not leave the dropdown stranded somewhere unrelated on screen.
		const syncPosition = (): void => {
			setAnchorRect(readAnchorRect(buttonRef.current));
			// A banner's sampled colors can land a moment after the card renders.
			setOverlayColorStyle(readInheritedNoteColorVars(buttonRef.current));
		};

		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				event.preventDefault();
				setIsOpen(false);
			}
		};

		syncPosition();
		window.addEventListener('resize', syncPosition);
		if (isCoarsePointer) {
			window.addEventListener('scroll', syncPosition, true);
		}
		document.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('resize', syncPosition);
			if (isCoarsePointer) {
				window.removeEventListener('scroll', syncPosition, true);
			}
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [isCoarsePointer, isOpen]);

	React.useEffect(() => {
		if (!isOpen || typeof window === 'undefined') return;
		if (isCoarsePointer) return;
		const closeOverlay = (): void => setIsOpen(false);
		window.addEventListener('wheel', closeOverlay, { passive: true });
		window.addEventListener('scroll', closeOverlay, true);
		return () => {
			window.removeEventListener('wheel', closeOverlay);
			window.removeEventListener('scroll', closeOverlay, true);
		};
	}, [isCoarsePointer, isOpen]);

	React.useEffect(() => {
		if (!isOpen || !isCoarsePointer) return;
		const panel = overlayPanelRef.current;
		if (!panel) return;
		const onTouchMove = (event: TouchEvent): void => {
			if (event.cancelable) event.preventDefault();
		};
		panel.addEventListener('touchmove', onTouchMove, { passive: false });
		return () => panel.removeEventListener('touchmove', onTouchMove);
	}, [isCoarsePointer, isOpen]);

	React.useEffect(() => {
		if (!isOpen || !isCoarsePointer || typeof window === 'undefined') return;
		try {
			const currentState = window.history.state as Record<string, unknown> | null;
			window.history.pushState({ ...(currentState ?? {}), __chipOverlay: 'attachments' }, '', window.location.href);
			backStatePushedRef.current = true;
		} catch {
			backStatePushedRef.current = false;
		}
		const onPopState = (): void => setIsOpen(false);
		window.addEventListener('popstate', onPopState);
		return () => {
			window.removeEventListener('popstate', onPopState);
			if (backStatePushedRef.current) {
				backStatePushedRef.current = false;
				try {
					const state = window.history.state as Record<string, unknown> | null;
					if (state && state.__chipOverlay === 'attachments') {
						window.history.back();
					}
				} catch {
					// No-op if history APIs are unavailable.
				}
			}
		};
	}, [isCoarsePointer, isOpen]);

	React.useEffect(() => {
		if (!isOpen || typeof window === 'undefined' || typeof document === 'undefined') return;
		const closeOverlay = (): void => setIsOpen(false);
		const onVisibilityChange = (): void => {
			if (document.visibilityState === 'hidden') {
				closeOverlay();
			}
		};
		window.addEventListener('blur', closeOverlay);
		window.addEventListener('pagehide', closeOverlay);
		document.addEventListener('visibilitychange', onVisibilityChange);
		return () => {
			window.removeEventListener('blur', closeOverlay);
			window.removeEventListener('pagehide', closeOverlay);
			document.removeEventListener('visibilitychange', onVisibilityChange);
		};
	}, [isOpen]);

	React.useEffect(() => {
		if (!isOpen || typeof document === 'undefined') return;
		const handlePointerDown = (event: PointerEvent): void => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			if (target.closest('[data-note-chip-trigger="true"]')) return;
			if (overlayPanelRef.current?.contains(target)) return;
			if (event.cancelable) event.preventDefault();
			event.stopPropagation();
			setIsOpen(false);
		};
		document.addEventListener('pointerdown', handlePointerDown, true);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown, true);
		};
	}, [isOpen]);

	const visibleItems = React.useMemo(() => ([
		allowsImages ? { kind: 'images', icon: faImage, label: t('app.sidebarImages'), count: counts.images } : null,
		allowsLinks ? { kind: 'links', icon: faLink, label: t('editors.mediaTabLinks'), count: counts.links } : null,
		allowsDrawings ? { kind: 'drawings', icon: faPenNib, label: t('editors.mediaTabDrawings'), count: counts.drawings } : null,
		allowsDocuments ? { kind: 'documents', icon: faFileLines, label: t('editors.mediaTabDocuments'), count: counts.documents } : null,
	].filter((item): item is { kind: NoteAttachmentBrowserKind; icon: typeof faImage; label: string; count: number } => Boolean(item))), [allowsDocuments, allowsDrawings, allowsImages, allowsLinks, counts.documents, counts.drawings, counts.images, counts.links, t]);
	const totalCount = visibleItems.reduce((sum, item) => sum + item.count, 0);
	const overlayPosition = React.useMemo(() => {
		if (!anchorRect || typeof window === 'undefined') return null;
		// Match the other note-card chip overlays: card-width and horizontally
		// centered, but vertically attached to the chip row with above/below flip.
		// On mobile this reuses the grid edge margin so attachment menus line up with
		// collaborator and metadata menus on the same card.
		const horizontalViewportInset = isCoarsePointer ? MOBILE_GRID_EDGE_MARGIN_PX : 12;
		const overlayWidth = Math.min(
			Math.round(anchorRect.width),
			window.innerWidth - horizontalViewportInset * 2
		);
		const centeredLeft = anchorRect.left + (anchorRect.width - overlayWidth) / 2;
		const left = Math.min(
			Math.max(horizontalViewportInset, centeredLeft),
			Math.max(horizontalViewportInset, window.innerWidth - overlayWidth - horizontalViewportInset)
		);
		// About 52px per row; four rows now that documents are listed.
		const estimatedHeight = 208;
		const preferredTop = anchorRect.top + anchorRect.height + 8;
		const top = preferredTop + estimatedHeight <= window.innerHeight - 12
			? preferredTop
			: Math.max(12, anchorRect.top - estimatedHeight - 8);
		return { top, left, width: overlayWidth };
	}, [anchorRect, isCoarsePointer]);

	const handleToggle = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		setAnchorRect(readAnchorRect(buttonRef.current));
		setOverlayColorStyle(readInheritedNoteColorVars(buttonRef.current));
		setIsOpen((current) => !current);
	}, []);

	const handleOpenBrowser = React.useCallback((kind: NoteAttachmentBrowserKind) => {
		const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
		if (activeElement instanceof HTMLElement) activeElement.blur();
		setIsOpen(false);
		props.onOpenBrowser(kind);
	}, [props]);

	if (totalCount <= 0) return null;

	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				className={[props.className, styles.mainChip].join(' ')}
				data-note-chip-trigger="true"
				style={props.colorStyle}
				onPointerDown={(event) => event.stopPropagation()}
				onClick={handleToggle}
				aria-haspopup="dialog"
				aria-expanded={isOpen}
				aria-label={`${t('attachments.chipLabel')}: ${totalCount}`}
				title={`${t('attachments.chipLabel')}: ${totalCount}`}
			>
				<FontAwesomeIcon icon={faPaperclip} />
				<span className={styles.mainChipCount}>{totalCount}</span>
			</button>
			{typeof document !== 'undefined'
				? createPortal(
					<AnimatePresence>
						{isOpen && anchorRect && overlayPosition ? (
							<>
								<motion.div
									className={styles.overlayBackdrop}
									aria-hidden="true"
									initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
									animate={{ opacity: 1, backdropFilter: 'blur(2px)' }}
									exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
									transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
								/>
								<AttachmentChipDismissSurface>
								<motion.div
									ref={overlayPanelRef}
									className={styles.overlayPanel}
									data-note-chip-panel="true"
									role="dialog"
									aria-modal="false"
									aria-label={t('attachments.chipLabel')}
									onPointerDown={(event) => event.stopPropagation()}
									onClick={(event) => event.stopPropagation()}
									style={{
										...(props.colorStyle ?? {}),
										...(overlayColorStyle ?? {}),
										...overlayPosition,
									}}
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									exit={{ opacity: 0 }}
									transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
								>
									<div className={styles.overlayList}>
										{visibleItems.map((item, index) => {
											const rowDelay = 0.016 + index * 0.024;
											return (
												<div
													key={item.kind}
													className={styles.overlayItemShell}
												>
													<motion.button
														type="button"
														className={styles.overlayItem}
														initial={{ opacity: 0, y: '-100%' }}
														animate={{ opacity: 1, y: '0%' }}
														exit={{ opacity: 0, transition: { duration: 0.08, delay: 0 } }}
														transition={{
															duration: 0.12,
															ease: [0.22, 1, 0.36, 1],
															delay: rowDelay,
														}}
														onMouseDown={preventAttachmentOverlayMouseFocus}
														onPointerDown={stopAttachmentOverlayPressBubble}
														onClick={() => handleOpenBrowser(item.kind)}
													>
														<span className={styles.overlayItemCopy}>
															<FontAwesomeIcon icon={item.icon} />
															<span className={styles.overlayItemLabel}>{item.label}</span>
														</span>
														<span className={styles.overlayItemCount}>{item.count}</span>
													</motion.button>
												</div>
											);
										})}
									</div>
								</motion.div>
							</AttachmentChipDismissSurface>
							</>
						) : null}
					</AnimatePresence>,
					document.body
				)
				: null}
		</>
	);
}
