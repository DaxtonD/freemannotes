import React from 'react';
import type * as Y from 'yjs';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileLines, faImage, faLink, faPaperclip } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import { getCachedNoteDocuments, getNoteDocumentsChangedEventName, readQueuedNoteDocuments, readStoredRemoteNoteDocuments, refreshRemoteNoteDocuments } from '../../core/noteDocumentStore';
import { extractNoteLinksFromDoc } from '../../core/noteLinks';
import { getCachedRemoteNoteLinks, getNoteLinksChangedEventName, readStoredNoteLinks, refreshRemoteNoteLinks } from '../../core/noteLinkStore';
import { filterRemoteNoteImagesByPendingDeletes, getCachedRemoteNoteImages, getNoteMediaChangedEventName, readQueuedNoteImageDeletions, readQueuedNoteImages, readStoredRemoteNoteImages, refreshRemoteNoteImages } from '../../core/noteMediaStore';
import styles from './NoteAttachmentCountChip.module.css';

export type NoteAttachmentBrowserKind = 'images' | 'links' | 'documents';

type AttachmentCounts = {
	images: number;
	links: number;
	documents: number;
};

type NoteAttachmentCountChipProps = {
	docId: string;
	doc: Y.Doc;
	authUserId?: string | null;
	className: string;
	colorStyle?: React.CSSProperties;
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

export function NoteAttachmentCountChip(props: NoteAttachmentCountChipProps): React.JSX.Element | null {
	const { t } = useI18n();
	const isCoarsePointer = useIsCoarsePointer();
	const buttonRef = React.useRef<HTMLButtonElement | null>(null);
	const overlayPanelRef = React.useRef<HTMLDivElement | null>(null);
	const backStatePushedRef = React.useRef(false);
	const [counts, setCounts] = React.useState<AttachmentCounts>(() => ({
		images: getCachedRemoteNoteImages(props.docId).length,
		links: Math.max(getCachedRemoteNoteLinks(props.docId).length, extractNoteLinksFromDoc(props.doc).length),
		documents: getCachedNoteDocuments(props.docId).length,
	}));
	const countsRef = React.useRef(counts);
	const [isOpen, setIsOpen] = React.useState(false);
	const [anchorRect, setAnchorRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);
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

	const refresh = React.useCallback(async (options?: {
		scope?: 'all' | 'media' | 'documents' | 'links';
		syncRemote?: boolean;
		forceRemote?: boolean;
	}): Promise<AttachmentCounts> => {
		const scope = options?.scope ?? 'all';
		const includeMedia = scope === 'all' || scope === 'media';
		const includeDocuments = scope === 'all' || scope === 'documents';
		const includeLinks = scope === 'all' || scope === 'links';
		// Combine queued + cached + remote counts so the chip reflects the user's intent
		// immediately, even while uploads/deletes are still in flight or offline.
		const [queuedImages, queuedDeletes, storedRemoteImages, queuedDocuments, storedRemoteDocuments, storedRemoteLinks] = await Promise.all([
			props.authUserId ? readQueuedNoteImages(props.authUserId, props.docId) : Promise.resolve([]),
			props.authUserId ? readQueuedNoteImageDeletions(props.authUserId, props.docId) : Promise.resolve([]),
			includeMedia ? readStoredRemoteNoteImages(props.docId) : Promise.resolve([]),
			props.authUserId ? readQueuedNoteDocuments(props.authUserId, props.docId) : Promise.resolve([]),
			includeDocuments ? readStoredRemoteNoteDocuments(props.docId) : Promise.resolve([]),
			includeLinks ? readStoredNoteLinks(props.docId) : Promise.resolve([]),
		]);
		const extractedLinkCount = extractNoteLinksFromDoc(props.doc).length;
		const localCounts: AttachmentCounts = {
			images: includeMedia
				? filterRemoteNoteImagesByPendingDeletes(
					storedRemoteImages.length > 0 ? storedRemoteImages : getCachedRemoteNoteImages(props.docId),
					queuedDeletes
				).length + queuedImages.length
				: countsRef.current.images,
			links: includeLinks ? Math.max(storedRemoteLinks.length, extractedLinkCount) : countsRef.current.links,
			documents: includeDocuments
				? Math.max(storedRemoteDocuments.length + queuedDocuments.length, getCachedNoteDocuments(props.docId).length)
				: countsRef.current.documents,
		};
		setCounts((current) => ({
			images: includeMedia ? localCounts.images : current.images,
			links: includeLinks ? localCounts.links : current.links,
			documents: includeDocuments ? localCounts.documents : current.documents,
		}));

		if (!options?.syncRemote) return localCounts;

		try {
			const [remoteImages, mergedDocuments, remoteLinks] = await Promise.all([
				includeMedia
					? refreshRemoteNoteImages(props.docId, {
						force: options.forceRemote,
						minIntervalMs: options.forceRemote ? 0 : 15_000,
					})
					: Promise.resolve<readonly ReturnType<typeof getCachedRemoteNoteImages>[number][]>([]),
				includeDocuments
					? refreshRemoteNoteDocuments(props.docId, {
						userId: props.authUserId,
						force: options.forceRemote,
					})
					: Promise.resolve<readonly ReturnType<typeof getCachedNoteDocuments>[number][]>([]),
				includeLinks
					? refreshRemoteNoteLinks(props.docId, {
						force: options.forceRemote,
					})
					: Promise.resolve<readonly ReturnType<typeof getCachedRemoteNoteLinks>[number][]>([]),
			]);
			const remoteCounts: AttachmentCounts = {
				images: includeMedia
					? filterRemoteNoteImagesByPendingDeletes(remoteImages, queuedDeletes).length + queuedImages.length
					: localCounts.images,
				links: includeLinks ? Math.max(remoteLinks.length, extractedLinkCount) : localCounts.links,
				documents: includeDocuments ? mergedDocuments.length : localCounts.documents,
			};
			setCounts((current) => ({
				images: includeMedia ? remoteCounts.images : current.images,
				links: includeLinks ? remoteCounts.links : current.links,
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
			setCounts((current) => ({ ...current, links: Math.max(extracted, cachedRemote) }));
		};
		props.doc.on('update', onDocUpdate);
		return () => {
			props.doc.off('update', onDocUpdate);
		};
	}, [props.doc, props.docId]);

	React.useEffect(() => {
		if (props.suspendRemoteRefresh) return () => {};
		const mediaEventName = getNoteMediaChangedEventName();
		const documentEventName = getNoteDocumentsChangedEventName();
		const linksEventName = getNoteLinksChangedEventName();
		const onMediaChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string }>).detail;
			if (!detail?.docId || detail.docId === props.docId) {
				void refresh({ scope: 'media', syncRemote: true, forceRemote: true });
			}
		};
		const onDocumentChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string }>).detail;
			if (!detail?.docId || detail.docId === props.docId) {
				void refresh({ scope: 'documents', syncRemote: true, forceRemote: true });
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
		const onOnline = (): void => {
			void refresh({ scope: 'all', syncRemote: true, forceRemote: true });
		};
		window.addEventListener(mediaEventName, onMediaChanged as EventListener);
		window.addEventListener(documentEventName, onDocumentChanged as EventListener);
		window.addEventListener(linksEventName, onLinksChanged as EventListener);
		window.addEventListener('online', onOnline);
		return () => {
			window.removeEventListener(mediaEventName, onMediaChanged as EventListener);
			window.removeEventListener(documentEventName, onDocumentChanged as EventListener);
			window.removeEventListener(linksEventName, onLinksChanged as EventListener);
			window.removeEventListener('online', onOnline);
		};
	}, [props.docId, props.suspendRemoteRefresh, refresh]);

	React.useEffect(() => {
		if (!isOpen) return;

		// Track the trigger rect while open so scrolling the grid or resizing the window
		// does not leave the dropdown stranded somewhere unrelated on screen.
		const syncPosition = (): void => {
			setAnchorRect(readAnchorRect(buttonRef.current));
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

	const totalCount = counts.images + counts.links + counts.documents;
	const overlayPosition = React.useMemo(() => {
		if (!anchorRect || typeof window === 'undefined') return null;
		// Match the other note-card chip overlays: card-width and horizontally
		// centered, but vertically attached to the chip row with above/below flip.
		const overlayWidth = Math.min(Math.round(anchorRect.width), window.innerWidth - 24);
		const centeredLeft = anchorRect.left + (anchorRect.width - overlayWidth) / 2;
		const left = Math.min(Math.max(12, centeredLeft), Math.max(12, window.innerWidth - overlayWidth - 12));
		const estimatedHeight = 156;
		const preferredTop = anchorRect.top + anchorRect.height + 8;
		const top = preferredTop + estimatedHeight <= window.innerHeight - 12
			? preferredTop
			: Math.max(12, anchorRect.top - estimatedHeight - 8);
		return { top, left, width: overlayWidth };
	}, [anchorRect]);

	const handleToggle = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		setAnchorRect(readAnchorRect(buttonRef.current));
		setIsOpen((current) => !current);
	}, []);

	const handleOpenBrowser = React.useCallback((kind: NoteAttachmentBrowserKind) => {
		if (kind === 'documents') return;
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
										...overlayPosition,
									}}
									initial={{ opacity: 0, y: -6 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: -6 }}
									transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
								>
									<div className={styles.overlayList}>
										{([
											{ kind: 'images', icon: faImage, label: t('app.sidebarImages'), count: counts.images },
											{ kind: 'links', icon: faLink, label: t('editors.mediaTabLinks'), count: counts.links },
											{ kind: 'documents', icon: faFileLines, label: t('editors.mediaTabDocuments'), count: counts.documents },
										] as const).map((item, index) => {
											const rowDelay = 0.016 + index * 0.024;
											return (
												<div
													key={item.kind}
													className={styles.overlayItemShell}
												>
													<motion.button
														type="button"
														className={styles.overlayItem}
														disabled={item.kind === 'documents'}
														aria-disabled={item.kind === 'documents' ? 'true' : undefined}
														data-disabled={item.kind === 'documents' ? 'true' : undefined}
														initial={{ opacity: 0, y: -10 }}
														animate={{ opacity: 1, y: 0 }}
														exit={{ opacity: 0, y: -6 }}
														transition={{
															duration: 0.15,
															ease: [0.22, 1, 0.36, 1],
															delay: rowDelay,
														}}
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