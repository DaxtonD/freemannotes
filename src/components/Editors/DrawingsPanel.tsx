import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPenNib, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import * as Y from 'yjs';
import { buildDrawingPlaceholderDataUrl, getDrawingThumbnailVersion, renderDrawingThumbnail } from '../../core/drawingThumbnails';
import { readDrawingLinkState } from '../../core/noteModel';
import { useI18n } from '../../core/i18n';
import styles from './DocumentsPanel.module.css';

type DrawingSummary = {
	id: string;
	title: string;
	thumbnailUrl: string;
	elementCount: number;
};

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

export function DrawingsPanel(props: DrawingsPanelProps): React.JSX.Element {
	const { t } = useI18n();
	const canEdit = props.canEdit === true;
	const drawingIds = useDrawingIds(props.doc);
	const [drawings, setDrawings] = React.useState<readonly DrawingSummary[]>([]);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [deletingId, setDeletingId] = React.useState<string | null>(null);

	React.useEffect(() => {
		let cancelled = false;
		if (drawingIds.length === 0 || !props.loadDrawingDoc) {
			setDrawings([]);
			setLoading(false);
			setError(null);
			return () => {
				cancelled = true;
			};
		}

		setLoading(true);
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
						const elementCount = drawingDoc
							? drawingDoc.getArray<Y.Map<any>>('elements').toArray().filter((entry) => !entry.get('el')?.isDeleted).length
							: 0;
						return { id: drawingId, title, thumbnailUrl, elementCount } satisfies DrawingSummary;
					})
				);
				if (cancelled) return;
				setDrawings(nextDrawings);
			} catch (nextError) {
				if (cancelled) return;
				setError(nextError instanceof Error ? nextError.message : t('documents.loadFailed'));
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [drawingIds, props.loadDrawingDoc, t]);

	const handleDeleteDrawing = React.useCallback(async (drawingId: string): Promise<void> => {
		if (!canEdit || !props.onDeleteDrawing) return;
		if (typeof window !== 'undefined' && !window.confirm(t('documents.deleteConfirm'))) return;
		setDeletingId(drawingId);
		setError(null);
		try {
			await props.onDeleteDrawing(drawingId);
		} catch (nextError) {
			setError(nextError instanceof Error ? nextError.message : t('documents.deleteFailed'));
		} finally {
			setDeletingId(null);
		}
	}, [canEdit, props.onDeleteDrawing, t]);

	const summaryLabel = drawings.length === 1 ? `1 ${t('documents.itemSingular')}` : `${drawings.length} ${t('documents.itemPlural')}`;

	return (
		<section className={styles.panel} aria-label={t('editors.mediaTabDocuments')}>
			<div className={styles.header}>
				<div>
					<p className={styles.eyebrow}>{t('editors.mediaTabDocuments')}</p>
					<p className={styles.summary}>{drawings.length === 0 ? t('documents.emptyTitle') : summaryLabel}</p>
				</div>
				<div className={styles.toolbar}>
					{loading ? <span className={styles.status}>{t('common.loading')}</span> : null}
					{canEdit && props.onAddDrawing ? (
						<button type="button" className={styles.addButton} onClick={props.onAddDrawing}>
							<FontAwesomeIcon icon={faPlus} />
							<span>{t('documents.addButton')}</span>
						</button>
					) : null}
				</div>
			</div>
			{error ? <p className={styles.error}>{error}</p> : null}
			{drawings.length === 0 ? (
				<div className={styles.placeholderCard}>
					<p className={styles.placeholderTitle}>{t('documents.emptyTitle')}</p>
					<p className={styles.placeholderBody}>{t('documents.emptyBody')}</p>
				</div>
			) : (
				<div className={styles.list}>
					{drawings.map((drawing) => (
						<div key={drawing.id} className={styles.card}>
							{canEdit && props.onDeleteDrawing ? (
								<button
									type="button"
									className={styles.deleteButton}
									onClick={(event) => {
										event.stopPropagation();
										void handleDeleteDrawing(drawing.id);
									}}
									disabled={deletingId === drawing.id}
									aria-label={t('documents.delete')}
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
									<p className={styles.description}>{drawing.elementCount > 0 ? t('documents.processing') : t('drawings.emptyPreview')}</p>
									<p className={styles.meta}>
										<FontAwesomeIcon icon={faPenNib} />
										<span style={{ marginLeft: 8 }}>{drawing.elementCount === 1 ? `1 ${t('drawings.elementSingular')}` : `${drawing.elementCount} ${t('drawings.elementPlural')}`}</span>
									</p>
								</div>
							</button>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
