import React from 'react';
import type * as Y from 'yjs';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileLines, faImage, faLink, faPaperclip } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import { getCachedNoteDocuments, getNoteDocumentsChangedEventName, readQueuedNoteDocuments, readStoredRemoteNoteDocuments, refreshRemoteNoteDocuments } from '../../core/noteDocumentStore';
import { extractNoteLinksFromDoc } from '../../core/noteLinks';
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
	onOpenBrowser: (kind: NoteAttachmentBrowserKind) => void;
};

function readAnchorRect(element: HTMLElement | null): { top: number; left: number; width: number; height: number } | null {
	if (!element) return null;
	const rect = element.getBoundingClientRect();
	return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

export function NoteAttachmentCountChip(props: NoteAttachmentCountChipProps): React.JSX.Element | null {
	const { t } = useI18n();
	const buttonRef = React.useRef<HTMLButtonElement | null>(null);
	const [counts, setCounts] = React.useState<AttachmentCounts>(() => ({
		images: getCachedRemoteNoteImages(props.docId).length,
		links: extractNoteLinksFromDoc(props.doc).length,
		documents: getCachedNoteDocuments(props.docId).length,
	}));
	const [isOpen, setIsOpen] = React.useState(false);
	const [anchorRect, setAnchorRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);

	const refresh = React.useCallback(async (options?: { syncRemote?: boolean; forceRemote?: boolean }) => {
		// Combine queued + cached + remote counts so the chip reflects the user's intent
		// immediately, even while uploads/deletes are still in flight or offline.
		const [queuedImages, queuedDeletes, storedRemoteImages, queuedDocuments, storedRemoteDocuments] = await Promise.all([
			props.authUserId ? readQueuedNoteImages(props.authUserId, props.docId) : Promise.resolve([]),
			props.authUserId ? readQueuedNoteImageDeletions(props.authUserId, props.docId) : Promise.resolve([]),
			readStoredRemoteNoteImages(props.docId),
			props.authUserId ? readQueuedNoteDocuments(props.authUserId, props.docId) : Promise.resolve([]),
			readStoredRemoteNoteDocuments(props.docId),
		]);

		setCounts({
			images: filterRemoteNoteImagesByPendingDeletes(
				storedRemoteImages.length > 0 ? storedRemoteImages : getCachedRemoteNoteImages(props.docId),
				queuedDeletes
			).length + queuedImages.length,
			links: extractNoteLinksFromDoc(props.doc).length,
			documents: Math.max(storedRemoteDocuments.length + queuedDocuments.length, getCachedNoteDocuments(props.docId).length),
		});

		if (!options?.syncRemote) return;

		try {
			const [remoteImages, mergedDocuments] = await Promise.all([
				refreshRemoteNoteImages(props.docId, {
					force: options.forceRemote,
					minIntervalMs: options.forceRemote ? 0 : 15_000,
				}),
				refreshRemoteNoteDocuments(props.docId, {
					userId: props.authUserId,
					force: options.forceRemote,
				}),
			]);
			setCounts({
				images: filterRemoteNoteImagesByPendingDeletes(remoteImages, queuedDeletes).length + queuedImages.length,
				links: extractNoteLinksFromDoc(props.doc).length,
				documents: mergedDocuments.length,
			});
		} catch {
			// Keep the best local counts when refreshes fail.
		}
	}, [props.authUserId, props.doc, props.docId]);

	React.useEffect(() => {
		void refresh({ syncRemote: true });
	}, [refresh]);

	React.useEffect(() => {
		const onDocUpdate = (): void => {
			setCounts((current) => ({ ...current, links: extractNoteLinksFromDoc(props.doc).length }));
		};
		props.doc.on('update', onDocUpdate);
		return () => {
			props.doc.off('update', onDocUpdate);
		};
	}, [props.doc]);

	React.useEffect(() => {
		const mediaEventName = getNoteMediaChangedEventName();
		const documentEventName = getNoteDocumentsChangedEventName();
		const onChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string }>).detail;
			if (!detail?.docId || detail.docId === props.docId) {
				void refresh({ syncRemote: true, forceRemote: true });
			}
		};
		const onOnline = (): void => {
			void refresh({ syncRemote: true, forceRemote: true });
		};
		window.addEventListener(mediaEventName, onChanged as EventListener);
		window.addEventListener(documentEventName, onChanged as EventListener);
		window.addEventListener('online', onOnline);
		return () => {
			window.removeEventListener(mediaEventName, onChanged as EventListener);
			window.removeEventListener(documentEventName, onChanged as EventListener);
			window.removeEventListener('online', onOnline);
		};
	}, [props.docId, refresh]);

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
		window.addEventListener('scroll', syncPosition, true);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('resize', syncPosition);
			window.removeEventListener('scroll', syncPosition, true);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [isOpen]);

	const totalCount = counts.images + counts.links + counts.documents;

	const handleToggle = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		setAnchorRect(readAnchorRect(buttonRef.current));
		setIsOpen((current) => !current);
	}, []);

	const handleOpenBrowser = React.useCallback((kind: NoteAttachmentBrowserKind) => {
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
							<div className={styles.overlayRoot} role="presentation" onPointerDown={() => setIsOpen(false)}>
								<motion.div
									className={styles.overlayPanel}
									role="dialog"
									aria-modal="false"
									aria-label={t('attachments.chipLabel')}
									onPointerDown={(event) => event.stopPropagation()}
									style={{
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
						) : null}
					</AnimatePresence>,
					document.body
				)
				: null}
		</>
	);
}