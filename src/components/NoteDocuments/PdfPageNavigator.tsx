import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import styles from './PdfPageNavigator.module.css';

type Translate = (key: string) => string;

/** page number → object URL of its thumbnail. Owned by the viewer so closing the panel doesn't throw the thumbnails away. */
export type PdfThumbnailCache = Map<number, string>;

type PdfPageNavigatorProps = {
	pdf: PDFDocumentProxy;
	pageSizes: readonly { width: number; height: number }[];
	currentPage: number;
	/** Desktop: a panel beside the pages. Phone: a sheet over the bottom of the viewer. */
	variant: 'side' | 'sheet';
	cache: PdfThumbnailCache;
	t: Translate;
	onSelectPage: (pageNumber: number) => void;
	onClose: () => void;
};

const THUMBNAIL_RENDER_WIDTH_PX = 160;
const THUMBNAIL_JPEG_QUALITY = 0.72;
// After you scroll the thumbnail list yourself, stop auto-following the page you're reading
// for a moment, so the list doesn't yank itself away from what you were looking at.
const USER_SCROLL_HOLD_MS = 1500;

// Thumbnails are drawn once, small, and kept as JPEG object URLs: a few KB each instead of a
// live canvas each, so flicking through a 300-page document's thumbnails doesn't eat memory.
async function renderThumbnailUrl(pdf: PDFDocumentProxy, pageNumber: number): Promise<string | null> {
	let page: PDFPageProxy | null = null;
	const canvas = document.createElement('canvas');
	try {
		page = await pdf.getPage(pageNumber);
		const base = page.getViewport({ scale: 1 });
		const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
		const viewport = page.getViewport({ scale: (THUMBNAIL_RENDER_WIDTH_PX * pixelRatio) / base.width });
		canvas.width = Math.max(1, Math.floor(viewport.width));
		canvas.height = Math.max(1, Math.floor(viewport.height));
		await page.render({ canvas, viewport }).promise;
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', THUMBNAIL_JPEG_QUALITY));
		return blob ? URL.createObjectURL(blob) : null;
	} finally {
		canvas.width = 0;
		canvas.height = 0;
		page?.cleanup();
	}
}

export function PdfPageNavigator(props: PdfPageNavigatorProps): React.JSX.Element {
	const { pdf, pageSizes, currentPage, cache, t, onSelectPage } = props;
	const pageCount = pageSizes.length;
	const listRef = React.useRef<HTMLDivElement | null>(null);
	const [, setThumbnailVersion] = React.useState(0);
	const [pageInput, setPageInput] = React.useState('');
	const queueRef = React.useRef<number[]>([]);
	const runningRef = React.useRef(false);
	const mountedRef = React.useRef(true);
	const userScrolledAtRef = React.useRef(0);

	React.useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			queueRef.current = [];
		};
	}, []);

	// One thumbnail at a time, so drawing them never competes much with the page you're reading.
	const pumpQueue = React.useCallback(async (): Promise<void> => {
		if (runningRef.current) return;
		runningRef.current = true;
		try {
			while (mountedRef.current && queueRef.current.length > 0) {
				const pageNumber = queueRef.current.shift() as number;
				if (cache.has(pageNumber)) continue;
				const url = await renderThumbnailUrl(pdf, pageNumber).catch((error) => {
					console.warn(`[pdf-viewer] thumbnail for page ${pageNumber} failed`, error);
					return null;
				});
				if (!url) continue;
				cache.set(pageNumber, url);
				if (mountedRef.current) setThumbnailVersion((version) => version + 1);
			}
		} finally {
			runningRef.current = false;
		}
	}, [cache, pdf]);

	React.useEffect(() => {
		const list = listRef.current;
		if (!list || typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber);
				if (!Number.isFinite(pageNumber) || cache.has(pageNumber)) continue;
				if (entry.isIntersecting) {
					if (!queueRef.current.includes(pageNumber)) queueRef.current.push(pageNumber);
				} else {
					// Scrolled past before its turn came: drop it so the queue stays on what's on screen.
					queueRef.current = queueRef.current.filter((queued) => queued !== pageNumber);
				}
			}
			void pumpQueue();
		}, { root: list, rootMargin: '300px 0px' });
		for (const item of Array.from(list.querySelectorAll<HTMLElement>('[data-page-number]'))) observer.observe(item);
		return () => observer.disconnect();
	}, [cache, pageCount, pumpQueue]);

	const scrollItemIntoView = React.useCallback((pageNumber: number, behavior: ScrollBehavior): void => {
		const list = listRef.current;
		const item = list?.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`);
		if (!list || !item) return;
		const itemTop = item.offsetTop;
		const itemBottom = itemTop + item.offsetHeight;
		if (itemTop >= list.scrollTop && itemBottom <= list.scrollTop + list.clientHeight) return;
		// Manual maths, not scrollIntoView: that would also try to scroll every ancestor.
		list.scrollTo({ top: Math.max(0, itemTop - (list.clientHeight - item.offsetHeight) / 2), behavior });
	}, []);

	// Open already showing the page you're on.
	React.useLayoutEffect(() => {
		scrollItemIntoView(currentPage, 'auto');
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Follow along as you read (the desktop panel stays open), unless you're browsing the list.
	React.useEffect(() => {
		if (performance.now() - userScrolledAtRef.current < USER_SCROLL_HOLD_MS) return;
		scrollItemIntoView(currentPage, 'smooth');
	}, [currentPage, scrollItemIntoView]);

	const markUserScroll = (): void => {
		userScrolledAtRef.current = performance.now();
	};

	const handleGoToPage = (event: React.FormEvent): void => {
		event.preventDefault();
		const pageNumber = Number.parseInt(pageInput, 10);
		if (!Number.isFinite(pageNumber)) return;
		setPageInput('');
		onSelectPage(Math.min(pageCount, Math.max(1, pageNumber)));
	};

	return (
		<div className={props.variant === 'side' ? styles.side : styles.sheet} role="region" aria-label={t('documents.pagesPanel')}>
			<div className={styles.header}>
				<span className={styles.title}>{t('documents.pagesPanel')}</span>
				<form className={styles.goTo} onSubmit={handleGoToPage}>
					<input
						className={styles.goToInput}
						type="text"
						inputMode="numeric"
						pattern="[0-9]*"
						enterKeyHint="go"
						value={pageInput}
						placeholder={String(currentPage)}
						aria-label={t('documents.goToPage')}
						onChange={(event) => setPageInput(event.target.value.replace(/[^0-9]/g, ''))}
					/>
					<span className={styles.goToTotal}>/ {pageCount}</span>
				</form>
				<button type="button" className={styles.closeButton} onClick={props.onClose} aria-label={t('documents.closePages')} title={t('documents.closePages')}>
					<FontAwesomeIcon icon={faXmark} />
				</button>
			</div>
			<div
				ref={listRef}
				className={styles.list}
				onWheel={markUserScroll}
				onTouchStart={markUserScroll}
				onPointerDown={markUserScroll}
			>
				{pageSizes.map((size, index) => {
					const pageNumber = index + 1;
					const url = cache.get(pageNumber);
					const isCurrent = pageNumber === currentPage;
					return (
						<button
							key={pageNumber}
							type="button"
							data-page-number={pageNumber}
							className={`${styles.item}${isCurrent ? ` ${styles.itemCurrent}` : ''}`}
							onClick={() => onSelectPage(pageNumber)}
							aria-label={`${t('documents.pageLabel')} ${pageNumber}`}
							aria-current={isCurrent ? 'page' : undefined}
						>
							<span className={styles.thumb} style={{ aspectRatio: `${size.width} / ${size.height}` }}>
								{url ? <img className={styles.thumbImage} src={url} alt="" draggable={false} /> : null}
							</span>
							<span className={styles.itemLabel}>{pageNumber}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
