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
	onOpenBrowser: (kind: NoteAttachmentBrowserKind) => void;
	onOpenStateChange?: (isOpen: boolean) => void;
	suspendRemoteRefresh?: boolean;
	disableInitialRemoteRefresh?: boolean;
};

function readAnchorRect(element: HTMLElement | null): { top: number; left: number; width: number; height: number } | null {
	if (!element) return null;
	const rect = element.getBoundingClientRect();
	return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
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
	const [isOpen, setIsOpen] = React.useState(false);
	const [anchorRect, setAnchorRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);

	React.useEffect(() => {
		props.onOpenStateChange?.(isOpen);
	}, [isOpen, props.onOpenStateChange]);

	const refresh = React.useCallback(async (options?: {
		scope?: 'all' | 'media' | 'documents' | 'links';
		syncRemote?: boolean;
		forceRemote?: boolean;
	}) => {
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
		setCounts((current) => ({
			images: includeMedia
				? filterRemoteNoteImagesByPendingDeletes(
					storedRemoteImages.length > 0 ? storedRemoteImages : getCachedRemoteNoteImages(props.docId),
					queuedDeletes
				).length + queuedImages.length
				: current.images,
			links: includeLinks ? Math.max(storedRemoteLinks.length, extractedLinkCount) : current.links,
			documents: includeDocuments
				? Math.max(storedRemoteDocuments.length + queuedDocuments.length, getCachedNoteDocuments(props.docId).length)
				: current.documents,
		}));

		if (!options?.syncRemote) return;

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
			setCounts((current) => ({
				images: includeMedia
					? filterRemoteNoteImagesByPendingDeletes(remoteImages, queuedDeletes).length + queuedImages.length
					: current.images,
				links: includeLinks ? Math.max(remoteLinks.length, extractedLinkCount) : current.links,
				documents: includeDocuments ? mergedDocuments.length : current.documents,
			}));
		} catch {
			// Keep the best local counts when refreshes fail.
		}
	}, [props.authUserId, props.doc, props.docId]);

	React.useEffect(() => {
		if (props.suspendRemoteRefresh) return;
		void refresh({ syncRemote: !props.disableInitialRemoteRefresh });
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

	const totalCount = counts.images + counts.links + counts.documents;

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
						{isOpen && anchorRect ? (
							<>
								<motion.div
									className={styles.overlayBackdrop}
									aria-hidden="true"
									initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
									animate={{ opacity: 1, backdropFilter: 'blur(2px)' }}
									exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
									transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
								/>
								<div
									className={styles.overlayRoot}
									role="presentation"
									onPointerDown={(event) => {
										if (event.cancelable) event.preventDefault();
										event.stopPropagation();
										if (isCoarsePointer) {
											suppressNextDocumentCompatibilityMouseEvents();
										}
										setIsOpen(false);
									}}
									onClick={(event) => {
										event.preventDefault();
										event.stopPropagation();
									}}
								>
								<motion.div
									ref={overlayPanelRef}
									className={styles.overlayPanel}
									role="dialog"
									aria-modal="false"
									aria-label={t('attachments.chipLabel')}
									onPointerDown={(event) => event.stopPropagation()}
									onClick={(event) => event.stopPropagation()}
									style={{
										...(props.colorStyle ?? {}),
										top: Math.min(anchorRect.top + anchorRect.height + 10, window.innerHeight - 164),
										left: Math.min(anchorRect.left, Math.max(12, window.innerWidth - 272)),
									}}
									initial={{ opacity: 0, y: -8, scale: 0.985 }}
									animate={{ opacity: 1, y: 0, scale: 1 }}
									exit={{ opacity: 0, y: -8, scale: 0.98 }}
									transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
								>
									<div className={styles.overlayList}>
										{([
											{ kind: 'images', icon: faImage, label: t('app.sidebarImages'), count: counts.images },
											{ kind: 'links', icon: faLink, label: t('editors.mediaTabLinks'), count: counts.links },
											{ kind: 'documents', icon: faFileLines, label: t('editors.mediaTabDocuments'), count: counts.documents },
										] as const).map((item, index) => {
											const shellDelay = 0.01 + index * 0.035;
											const contentDelay = shellDelay + 0.0125;
											const entryOffset = 18 + index * 32;
											return (
												<motion.div
													key={item.kind}
													className={styles.overlayItemShell}
													initial={{ height: 0, marginTop: 0 }}
													animate={{ height: 'auto', marginTop: index === 0 ? 0 : 4 }}
													exit={{ height: 0, marginTop: 0 }}
													transition={{
														height: { duration: 0.06, ease: [0.22, 1, 0.36, 1], delay: shellDelay },
														marginTop: { duration: 0.04, ease: 'easeOut', delay: shellDelay },
													}}
												>
													<motion.button
														type="button"
														className={styles.overlayItem}
														disabled={item.kind === 'documents'}
														aria-disabled={item.kind === 'documents' ? 'true' : undefined}
														data-disabled={item.kind === 'documents' ? 'true' : undefined}
														style={{ zIndex: index + 1 }}
														initial={{ y: -entryOffset, scale: 0.97 }}
														animate={{ y: 0, scale: 1 }}
														exit={{ y: -12, scale: 0.98 }}
														transition={{
															type: 'spring',
															stiffness: 620,
															damping: 30,
															mass: 0.6,
															delay: contentDelay,
														}}
														onClick={() => handleOpenBrowser(item.kind)}
													>
														<span className={styles.overlayItemCopy}>
															<FontAwesomeIcon icon={item.icon} />
															<span className={styles.overlayItemLabel}>{item.label}</span>
														</span>
														<span className={styles.overlayItemCount}>{item.count}</span>
													</motion.button>
												</motion.div>
											);
										})}
									</div>
								</motion.div>
								</div>
							</>
						) : null}
					</AnimatePresence>,
					document.body
				)
				: null}
		</>
	);
}