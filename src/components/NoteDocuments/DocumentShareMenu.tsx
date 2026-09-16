import React from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowsRotate, faDownload, faFile, faPen, faShareNodes } from '@fortawesome/free-solid-svg-icons';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import type { NoteDocumentRecord } from '../../core/noteDocumentApi';
import { resolveNoteDocumentBlob, resolveNoteDocumentViewBlob } from '../../core/noteDocumentStore';
import type { PageViewportSource } from './markup/exportMarkupPdf';
import type { Markup, MarkupReply, PageScale } from './markup/markupTypes';
import { saveBlobToDevice } from './saveBlobToDevice';
import { canShareFileType, shareFile } from './shareFile';
import styles from './DocumentShareMenu.module.css';

// "Download or share" for one document: share the original, share it with the markup drawn in, or
// download either. The PDF viewer hands over its open PDF and live markup. The document list (a
// note's Documents tab, and the browser a card's chip opens) has neither, so it looks the markup up
// when the menu opens and only loads the PDF if a marked-up copy is actually asked for.

type Translate = (key: string) => string;
type ExportAction = 'share-original' | 'share-markup' | 'download-markup';

export type DocumentMarkupContent = {
	items: readonly Markup[];
	replies: readonly MarkupReply[];
	pageScales: ReadonlyMap<number, PageScale>;
};

type MarkupLookup = { versionId: string; checking: boolean; content: DocumentMarkupContent | null };

type FloatingPosition = { right: number; top?: number; bottom?: number; maxHeight: number };

type DocumentShareMenuProps = {
	document: NoteDocumentRecord;
	t: Translate;
	onDownloadOriginal: (document: NoteDocumentRecord) => void;
	/** The viewer's open PDF and live markup (null until the PDF has loaded). */
	live?: (DocumentMarkupContent & { pdf: PageViewportSource }) | null;
	/** Document list: the version whose markup to look up when the menu opens (null: it can't have any). */
	markupVersionId?: string | null;
	/** Server address for that lookup, so markup drawn on another device counts. Null: this device's copy only. */
	websocketUrl?: string | null;
	/**
	 * Draw the menu over the page instead of under the button's own box. Document cards clip whatever
	 * overflows them and the chip's browser scrolls, so the list needs this; the viewer header doesn't.
	 */
	floating?: boolean;
	buttonClassName: string;
	buttonActiveClassName?: string;
	disabled?: boolean;
};

// Room the floating menu wants below its button before it opens upwards instead.
const MENU_MIN_SPACE_PX = 280;
const VIEWPORT_MARGIN_PX = 8;
const EMPTY_MARKUP: DocumentMarkupContent = { items: [], replies: [], pageScales: new Map() };

async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
	const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
	// The viewer sets this too when it loads; whichever gets there first is fine.
	if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
	return pdfjs;
}

const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

// The floating menu lives in a portal, but React still bubbles its events up through the list,
// the modal and any sheet it sits in. Stop them here so a tap on the menu can't start a sheet drag
// or count as a tap on the backdrop.
const stopPropagation = (event: React.SyntheticEvent): void => event.stopPropagation();

export function DocumentShareMenu(props: DocumentShareMenuProps): React.JSX.Element {
	const { document: noteDocument, t, live = null, markupVersionId = null, websocketUrl = null, floating = false } = props;
	const [open, setOpen] = React.useState(false);
	const [includeResolved, setIncludeResolved] = React.useState(true);
	// Which action is working (only one at a time).
	const [busy, setBusy] = React.useState<ExportAction | null>(null);
	// A file ready to share whose tap wore off while it was being built: one more tap shares it.
	const [pendingShare, setPendingShare] = React.useState<{ blob: Blob; fileName: string } | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [lookup, setLookup] = React.useState<MarkupLookup | null>(null);
	const [position, setPosition] = React.useState<FloatingPosition | null>(null);
	const wrapRef = React.useRef<HTMLDivElement | null>(null);
	const buttonRef = React.useRef<HTMLButtonElement | null>(null);
	const menuRef = React.useRef<HTMLDivElement | null>(null);
	const mountedRef = React.useRef(true);
	const versionRef = React.useRef(markupVersionId);
	versionRef.current = markupVersionId;
	const lookupInFlightRef = React.useRef<string | null>(null);

	React.useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const lookedUp = lookup && lookup.versionId === markupVersionId ? lookup : null;
	const markup: DocumentMarkupContent | null = live ?? lookedUp?.content ?? null;
	const hasMarkup = Boolean(markup && markup.items.length > 0);
	const hasResolvedComments = Boolean(markup && markup.items.some((item) => item.kind === 'comment' && item.status === 'resolved'));
	// Only until the first answer; after that the last answer stays up while it checks again.
	const checkingMarkup = !live && Boolean(markupVersionId) && (!lookedUp || lookedUp.content === null);

	// Share options only appear where they'll work: the browser can share files at all, and this file
	// type in particular (a marked-up export is always a PDF, so office files can still go out that way).
	const canShareOriginal = React.useMemo(() => canShareFileType(noteDocument.fileName, noteDocument.mimeType), [noteDocument.fileName, noteDocument.mimeType]);
	const canSharePdf = React.useMemo(() => canShareFileType('markup.pdf', 'application/pdf'), []);
	const canShareMarkup = hasMarkup && canSharePdf;
	// In the list a document that can carry markup opens the menu before anyone knows whether it has any.
	const mayHaveMarkup = live ? hasMarkup : Boolean(markupVersionId);
	// Nothing to share to and no markup: Download is just the file, as it always was.
	const hasChoices = mayHaveMarkup || canShareOriginal;

	// Look the markup up each time the menu opens, so something drawn since last time counts. A lookup
	// already running is left to finish, even if the menu closes, so reopening shows its answer.
	React.useEffect(() => {
		if (!open || live || !markupVersionId || lookupInFlightRef.current === markupVersionId) return;
		const versionId = markupVersionId;
		lookupInFlightRef.current = versionId;
		setLookup((current) => (current && current.versionId === versionId ? { ...current, checking: true } : { versionId, checking: true, content: null }));
		void (async () => {
			let content: DocumentMarkupContent;
			try {
				const { readMarkupSnapshot } = await import('./markup/markupStore');
				content = await readMarkupSnapshot(versionId, { websocketUrl });
			} catch (lookupError) {
				console.error('[document-share] markup lookup failed', lookupError);
				content = EMPTY_MARKUP;
			}
			if (lookupInFlightRef.current === versionId) lookupInFlightRef.current = null;
			if (!mountedRef.current || versionRef.current !== versionId) return;
			setLookup({ versionId, checking: false, content });
		})();
	}, [live, markupVersionId, open, websocketUrl]);

	const placeMenu = React.useCallback((): void => {
		const button = buttonRef.current;
		if (!button || typeof window === 'undefined') return;
		const rect = button.getBoundingClientRect();
		const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
		const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_MARGIN_PX;
		const spaceAbove = rect.top - VIEWPORT_MARGIN_PX;
		const right = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - rect.right);
		if (spaceBelow >= MENU_MIN_SPACE_PX || spaceBelow >= spaceAbove) {
			setPosition({ right, top: rect.bottom + 6, maxHeight: Math.max(120, spaceBelow - 6) });
		} else {
			setPosition({ right, bottom: viewportHeight - rect.top + 6, maxHeight: Math.max(120, spaceAbove - 6) });
		}
	}, []);

	React.useLayoutEffect(() => {
		if (open && floating) placeMenu();
		else setPosition(null);
	}, [floating, open, placeMenu]);

	// Closes on a press anywhere else. Escape closes the menu before the viewer or modal behind it.
	React.useEffect(() => {
		if (!open) return undefined;
		const inside = (target: EventTarget | null): boolean => target instanceof Node
			&& Boolean(wrapRef.current?.contains(target) || menuRef.current?.contains(target));
		const onPointerDown = (event: PointerEvent): void => {
			if (!inside(event.target)) setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			setOpen(false);
		};
		// A floating menu is pinned where its button was; if the list scrolls away under it, close it
		// rather than leave it hanging over the wrong document.
		const onScroll = (event: Event): void => {
			if (floating && !inside(event.target)) setOpen(false);
		};
		const onResize = (): void => {
			if (floating) placeMenu();
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeyDown, true);
		document.addEventListener('scroll', onScroll, true);
		window.addEventListener('resize', onResize);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown, true);
			document.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('resize', onResize);
		};
	}, [floating, open, placeMenu]);

	// "With markup": the PDF the viewer shows (the converted copy for office files) with the markup
	// drawn in and a comment summary at the end, built on the device so it works offline.
	const buildMarkedUpFile = async (): Promise<{ blob: Blob; fileName: string } | null> => {
		if (!markup || markup.items.length === 0) return null;
		const source = await resolveNoteDocumentViewBlob(noteDocument);
		if (!source) {
			setError(t('documents.downloadOffline'));
			return null;
		}
		const pdfBytes = new Uint8Array(await source.arrayBuffer());
		const { buildMarkedUpPdf, markedUpFileName } = await import('./markup/exportMarkupPdf');
		let loadingTask: PDFDocumentLoadingTask | null = null;
		try {
			let pages: PageViewportSource | null = live?.pdf ?? null;
			if (!pages) {
				// The list has no open PDF: load one just for the page shapes. pdf.js takes ownership of
				// the bytes it's given, so it gets a copy and pdf-lib keeps the original.
				const pdfjs = await loadPdfjs();
				loadingTask = pdfjs.getDocument({ data: pdfBytes.slice(), isEvalSupported: false });
				pages = await loadingTask.promise;
			}
			const bytes = await buildMarkedUpPdf({
				pdfBytes,
				pages,
				items: markup.items,
				replies: markup.replies,
				includeResolved,
				fileName: noteDocument.fileName,
				t,
				pageScales: markup.pageScales,
				noScaleLabel: t('documents.markupNoScale'),
			});
			const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
			return { blob: new Blob([buffer], { type: 'application/pdf' }), fileName: markedUpFileName(noteDocument.fileName, new Date(), t) };
		} finally {
			void loadingTask?.destroy();
		}
	};

	const finishShare = async (blob: Blob, fileName: string): Promise<void> => {
		const outcome = await shareFile(blob, fileName);
		if (outcome === 'shared' || outcome === 'cancelled') {
			setOpen(false);
			return;
		}
		if (outcome === 'needs-tap') {
			// Building took longer than the browser lets a tap count for; the next tap shares it.
			setPendingShare({ blob, fileName });
			return;
		}
		setError(t('documents.shareFailed'));
	};

	const runExport = async (action: ExportAction): Promise<void> => {
		if (busy) return;
		setBusy(action);
		setError(null);
		setPendingShare(null);
		try {
			if (action === 'share-original') {
				const blob = await resolveNoteDocumentBlob(noteDocument);
				if (!blob) {
					setError(t(isOffline() ? 'documents.downloadOffline' : 'documents.downloadFailed'));
					return;
				}
				const typed = blob.type ? blob : new Blob([blob], { type: noteDocument.mimeType || 'application/octet-stream' });
				await finishShare(typed, noteDocument.fileName);
				return;
			}
			const built = await buildMarkedUpFile();
			if (!built) return;
			if (action === 'download-markup') {
				saveBlobToDevice(built.blob, built.fileName);
				setOpen(false);
				return;
			}
			await finishShare(built.blob, built.fileName);
		} catch (exportError) {
			console.error(`[document-share] ${action} failed`, exportError);
			setError(t(action === 'download-markup' ? 'documents.downloadMarkupFailed' : 'documents.shareFailed'));
		} finally {
			if (mountedRef.current) setBusy(null);
		}
	};

	const toggle = (): void => {
		if (!hasChoices) {
			props.onDownloadOriginal(noteDocument);
			return;
		}
		setError(null);
		setPendingShare(null);
		setOpen((current) => !current);
	};

	const showMenu = open && hasChoices && (!floating || position !== null);
	const menu = showMenu ? (
		<div
			ref={menuRef}
			className={`${styles.menu}${floating ? ` ${styles.menuFloating}` : ''}`}
			role="menu"
			style={floating && position ? { right: position.right, top: position.top, bottom: position.bottom, maxHeight: position.maxHeight } : undefined}
			onClick={floating ? stopPropagation : undefined}
			onPointerDown={floating ? stopPropagation : undefined}
			onTouchStart={floating ? stopPropagation : undefined}
			onTouchMove={floating ? stopPropagation : undefined}
			onTouchEnd={floating ? stopPropagation : undefined}
		>
			{canShareOriginal ? (
				<button type="button" role="menuitem" className={styles.menuItem} onClick={() => void runExport('share-original')} disabled={busy !== null}>
					<FontAwesomeIcon icon={busy === 'share-original' ? faArrowsRotate : faShareNodes} spin={busy === 'share-original'} />
					<span>{t('documents.shareOriginal')}</span>
				</button>
			) : null}
			{canShareMarkup ? (
				<button type="button" role="menuitem" className={styles.menuItem} onClick={() => void runExport('share-markup')} disabled={busy !== null}>
					<FontAwesomeIcon icon={busy === 'share-markup' ? faArrowsRotate : faShareNodes} spin={busy === 'share-markup'} />
					<span>{busy === 'share-markup' ? t('documents.preparingPdf') : t('documents.shareWithMarkup')}</span>
				</button>
			) : null}
			{pendingShare ? (
				<button
					type="button"
					role="menuitem"
					className={`${styles.menuItem} ${styles.menuReady}`}
					onClick={() => {
						// Straight from this tap, so the browser allows the share sheet.
						const ready = pendingShare;
						setPendingShare(null);
						void finishShare(ready.blob, ready.fileName);
					}}
				>
					<FontAwesomeIcon icon={faShareNodes} />
					<span>{t('documents.shareReadyTap')}</span>
				</button>
			) : null}
			{canShareOriginal || canShareMarkup ? <span className={styles.menuDivider} aria-hidden="true" /> : null}
			<button
				type="button"
				role="menuitem"
				className={styles.menuItem}
				onClick={() => {
					setOpen(false);
					props.onDownloadOriginal(noteDocument);
				}}
			>
				<FontAwesomeIcon icon={faFile} />
				<span>{t('documents.downloadOriginal')}</span>
			</button>
			{hasMarkup ? (
				<button type="button" role="menuitem" className={styles.menuItem} onClick={() => void runExport('download-markup')} disabled={busy !== null}>
					<FontAwesomeIcon icon={busy === 'download-markup' ? faArrowsRotate : faPen} spin={busy === 'download-markup'} />
					<span>{busy === 'download-markup' ? t('documents.preparingPdf') : t('documents.downloadWithMarkup')}</span>
				</button>
			) : null}
			{hasMarkup && hasResolvedComments ? (
				<label className={styles.menuCheck}>
					<input type="checkbox" checked={includeResolved} onChange={(event) => setIncludeResolved(event.target.checked)} />
					<span>{t('documents.downloadIncludeResolved')}</span>
				</label>
			) : null}
			{checkingMarkup ? (
				<p className={styles.menuNote} role="status">
					<FontAwesomeIcon icon={faArrowsRotate} spin />
					<span>{t('documents.checkingMarkup')}</span>
				</p>
			) : null}
			{error ? <p className={styles.menuError} role="alert">{error}</p> : null}
		</div>
	) : null;

	return (
		<div className={styles.wrap} ref={wrapRef}>
			<button
				ref={buttonRef}
				type="button"
				className={`${props.buttonClassName}${open && props.buttonActiveClassName ? ` ${props.buttonActiveClassName}` : ''}`}
				onClick={toggle}
				disabled={props.disabled}
				aria-label={hasChoices ? t('documents.shareMenuLabel') : t('documents.download')}
				aria-haspopup={hasChoices ? 'menu' : undefined}
				aria-expanded={hasChoices ? open : undefined}
				title={hasChoices ? t('documents.shareMenuLabel') : t('documents.download')}
			>
				<FontAwesomeIcon icon={faDownload} />
			</button>
			{floating && menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu}
		</div>
	);
}
