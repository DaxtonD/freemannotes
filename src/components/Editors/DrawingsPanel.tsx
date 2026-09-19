import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faListUl, faPlus, faTableCellsLarge, faTrash } from '@fortawesome/free-solid-svg-icons';
import * as Y from 'yjs';
import { buildDrawingPlaceholderDataUrl, getDrawingThumbnailVersion, renderDrawingThumbnail } from '../../core/drawingThumbnails';
import { readDrawingLinkState } from '../../core/noteModel';
import { useI18n } from '../../core/i18n';
import { useIsInsideAttachmentBrowser } from '../NoteAttachments/attachmentBrowserContext';
import { PANEL_VIEW_MODE_STORAGE_KEYS, usePanelViewMode } from '../../core/panelViewMode';
import styles from './DrawingsPanel.module.css';

type DrawingSummary = {
	id: string;
	title: string;
	thumbnailUrl: string;
	createdAt: string;
};

function formatRelativeDate(value: string, locale: string): string {
	const time = Date.parse(value);
	if (!Number.isFinite(time)) return '';
	const deltaMs = time - Date.now();
	const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
	const minuteDelta = Math.round(deltaMs / 60_000);
	if (Math.abs(minuteDelta) < 60) return rtf.format(minuteDelta, 'minute');
	const hourDelta = Math.round(deltaMs / 3_600_000);
	if (Math.abs(hourDelta) < 24) return rtf.format(hourDelta, 'hour');
	const dayDelta = Math.round(deltaMs / 86_400_000);
	return rtf.format(dayDelta, 'day');
}

// Module-level so a summary survives the panel unmounting — switching media dock
// tabs remounts DrawingsPanel from scratch (different component type at that tree
// position), and without this every tab switch back to Drawings would re-await
// the full per-drawing load/render pipeline before showing anything, even for
// drawings already rendered once this session.
const drawingSummaryCache = new Map<string, DrawingSummary>();

function readDrawingCreatedAtIso(drawingDoc: Y.Doc | null | undefined): string {
	if (!drawingDoc) return '';
	const createdAtMs = Number(drawingDoc.getMap('metadata').get('createdAt') ?? 0);
	if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return '';
	return new Date(createdAtMs).toISOString();
}

type DrawingsPanelProps = {
	doc: Y.Doc;
	canEdit?: boolean;
	onAddDrawing?: (() => void) | undefined;
	onOpenDrawing?: ((drawingId: string) => void) | undefined;
	onDeleteDrawing?: ((drawingId: string) => void | Promise<void>) | undefined;
	loadDrawingDoc?: ((drawingId: string) => Promise<Y.Doc | null>) | undefined;
};

function useDrawingIds(doc: Y.Doc): readonly string[] {
	const drawingIds = React.useMemo(() => doc.getArray<string>('drawingIds'), [doc]);
	const snapshot = React.useSyncExternalStore(
		(onStoreChange) => {
			const observer = (): void => onStoreChange();
			drawingIds.observe(observer);
			return () => drawingIds.unobserve(observer);
		},
		// useSyncExternalStore requires a referentially stable snapshot. Serialize the
		// linked drawing ids so opening the tab doesn't trigger an update loop.
		() => JSON.stringify(readDrawingLinkState(doc).drawingIds),
		() => JSON.stringify(readDrawingLinkState(doc).drawingIds)
	);
	return React.useMemo(() => {
		try {
			const parsed = JSON.parse(snapshot);
			return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
		} catch {
			return [];
		}
	}, [snapshot]);
}

// The new-note screens have no saved note to hang a drawing off yet, so their
// Drawings tab just says so. This used to live inside the old DocumentsPanel (which,
// despite the name, only ever showed drawings or this placeholder).
export function DrawingsComingSoonPanel(): React.JSX.Element {
	const { t } = useI18n();
	return (
		<section className={styles.panel} aria-label={t('editors.mediaTabDrawings')}>
			<div className={styles.header}>
				<div>
					<p className={styles.eyebrow}>{t('editors.mediaTabDrawings')}</p>
					<p className={styles.summary}>{t('drawings.comingSoonTitle')}</p>
				</div>
			</div>
			<div className={styles.comingSoonCard}>
				<p className={styles.placeholderTitle}>{t('drawings.comingSoonTitle')}</p>
				<p className={styles.placeholderBody}>{t('drawings.comingSoonBody')}</p>
			</div>
		</section>
	);
}

export function DrawingsPanel(props: DrawingsPanelProps): React.JSX.Element {
	const insideAttachmentBrowser = useIsInsideAttachmentBrowser();
	const { t, locale } = useI18n();
	const canEdit = props.canEdit === true;
	const drawingIds = useDrawingIds(props.doc);
	const [drawings, setDrawings] = React.useState<readonly DrawingSummary[]>(
		() => drawingIds.map((id) => drawingSummaryCache.get(id)).filter((d): d is DrawingSummary => Boolean(d))
	);
	const [error, setError] = React.useState<string | null>(null);
	const [deletingId, setDeletingId] = React.useState<string | null>(null);
	const [viewMode, toggleViewMode] = usePanelViewMode(PANEL_VIEW_MODE_STORAGE_KEYS.drawings, 'card');

	React.useEffect(() => {
		let cancelled = false;
		if (drawingIds.length === 0 || !props.loadDrawingDoc) {
			setDrawings([]);
			setError(null);
			return () => {
				cancelled = true;
			};
		}

		// Offline-first: show whatever's already cached immediately (no loading
		// state), then silently reconcile once the fresh load resolves — including
		// for drawings not yet cached, so a first-ever visit still shows the others
		// right away instead of waiting on the whole batch together.
		const cachedNow = drawingIds.map((id) => drawingSummaryCache.get(id)).filter((d): d is DrawingSummary => Boolean(d));
		if (cachedNow.length > 0) setDrawings(cachedNow);
		setError(null);
		void (async () => {
			try {
				const nextDrawings = await Promise.all(
					drawingIds.map(async (drawingId) => {
						const drawingDoc = await props.loadDrawingDoc?.(drawingId);
						const title = drawingDoc?.getText('title').toString().trim() || t('note.untitled');
						const thumbnailUrl = drawingDoc
							? await renderDrawingThumbnail(drawingId, drawingDoc, title, getDrawingThumbnailVersion(drawingDoc))
							: await buildDrawingPlaceholderDataUrl(title, { seed: drawingId });
						const createdAt = readDrawingCreatedAtIso(drawingDoc);
						return { id: drawingId, title, thumbnailUrl, createdAt } satisfies DrawingSummary;
					})
				);
				if (cancelled) return;
				for (const drawing of nextDrawings) {
					drawingSummaryCache.set(drawing.id, drawing);
				}
				setDrawings(nextDrawings);
			} catch (nextError) {
				if (cancelled) return;
				setError(nextError instanceof Error ? nextError.message : t('drawings.loadFailed'));
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [drawingIds, props.loadDrawingDoc, t]);

	const handleDeleteDrawing = React.useCallback(async (drawingId: string): Promise<void> => {
		if (!canEdit || !props.onDeleteDrawing) return;
		if (typeof window !== 'undefined' && !window.confirm(t('drawings.deleteConfirm'))) return;
		setDeletingId(drawingId);
		setError(null);
		try {
			await props.onDeleteDrawing(drawingId);
		} catch (nextError) {
			setError(nextError instanceof Error ? nextError.message : t('drawings.deleteFailed'));
		} finally {
			setDeletingId(null);
		}
	}, [canEdit, props.onDeleteDrawing, t]);

	const summaryLabel = drawings.length === 1 ? `1 ${t('drawings.itemSingular')}` : `${drawings.length} ${t('drawings.itemPlural')}`;

	return (
		<section className={styles.panel} aria-label={t('editors.mediaTabDrawings')}>
			<div className={styles.header}>
				<div>
					{insideAttachmentBrowser ? null : <p className={styles.eyebrow}>{t('editors.mediaTabDrawings')}</p>}
					<p className={insideAttachmentBrowser ? `${styles.summary} ${styles.summaryWithoutEyebrow}` : styles.summary}>
						{drawings.length === 0 ? t('drawings.emptyTitle') : summaryLabel}
					</p>
				</div>
				<div className={styles.toolbar}>
					<button
						type="button"
						className={styles.iconButton}
						onClick={toggleViewMode}
						aria-label={viewMode === 'card' ? t('common.viewAsList') : t('common.viewAsCards')}
						title={viewMode === 'card' ? t('common.viewAsList') : t('common.viewAsCards')}
					>
						<FontAwesomeIcon icon={viewMode === 'card' ? faListUl : faTableCellsLarge} />
					</button>
					{canEdit && props.onAddDrawing ? (
						<button type="button" className={styles.addButton} onClick={props.onAddDrawing}>
							<FontAwesomeIcon icon={faPlus} />
							<span>{t('drawings.addButton')}</span>
						</button>
					) : null}
				</div>
			</div>
			{error ? <p className={styles.error}>{error}</p> : null}
			{drawings.length === 0 ? (
				null
			) : (
				<div className={viewMode === 'list' ? styles.listView : styles.list}>
					{drawings.map((drawing) => (
						<div key={drawing.id} className={`${styles.card}${viewMode === 'list' ? ` ${styles.cardListRow}` : ''}`}>
							{canEdit && props.onDeleteDrawing ? (
								<button
									type="button"
									className={styles.deleteButton}
									onClick={(event) => {
										event.stopPropagation();
										void handleDeleteDrawing(drawing.id);
									}}
									disabled={deletingId === drawing.id}
									aria-label={t('drawings.delete')}
								>
									<FontAwesomeIcon icon={faTrash} />
								</button>
							) : null}
							<button
								type="button"
								className={styles.cardButton}
								onClick={() => props.onOpenDrawing?.(drawing.id)}
								disabled={!props.onOpenDrawing}
							>
								<img className={styles.thumbnail} src={drawing.thumbnailUrl} alt="" />
								<div className={styles.copy}>
									<p className={styles.title}>{drawing.title}</p>
									{drawing.createdAt ? (
										<p className={styles.description}>{formatRelativeDate(drawing.createdAt, locale)}</p>
									) : null}
								</div>
							</button>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
