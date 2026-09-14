/**
 * NoteListView – compact flat-list rendering of notes.
 *
 * Supports two variants:
 *  - 'list'  : ~46px rows showing title + badge icons only
 *  - 'strip' : ~68px rows adding a one-line content preview below the title
 */

import React from 'react';
import { defaultRangeExtractor, useWindowVirtualizer, type Range } from '@tanstack/react-virtual';
import * as Y from 'yjs';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faEllipsisVertical,
	faFileLines,
	faListCheck,
	faPenNib,
	faRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import { getNoteBannerPresentationStyle, useThemedNoteBannerImageUrl } from '../../core/noteBannerTheme';
import { readEffectiveNoteBannerFile } from '../../core/noteBanners';
import { getUserNoteBannerFile, subscribeNoteBannerPrefs } from '../../core/noteBannerPreferences';
import { getUserNoteColorPrefsSnapshot, getUserNoteColorToken, hasUserNoteColorPref, subscribeNoteColorPrefs } from '../../core/noteColorPreferences';
import { useNoteBannerReadableColors } from '../../core/noteBannerReadability';
import { readEffectiveNoteColorToken, resolveThemeNoteColorModel } from '../../core/noteColors';
import { readNoteFromDoc } from '../../core/noteModel';
import type { ThemeId } from '../../core/theme';
import type { NoteCardBannerTitlePosition } from '../../core/deviceAppearancePreferences';
import type { VisibleNoteSnapshot } from '../../utilities/getVisibleNotes';
import type { LabelRecord } from '../../services/labelService';
import { FLIP_SETTLE_MS, applyDocumentFlipAnimations, applyFlipFromViewportSnapshot, clearFlipStyles, measureDocumentRects, type DocumentRectMap } from './flip';
import { applyListScrollAnchorOnce, applyListScrollAnchorToRow, findListRowByNoteId, type ListScrollAnchor } from './listScrollAnchor';
import styles from './NoteListView.module.css';

const LIST_ROW_GAP_PX = 2;
const LIST_ROW_HEIGHT_PX = 44;
const STRIP_ROW_HEIGHT_PX = 64;
const MIN_ROWS_BEFORE_VIRTUALIZING = 30;

export type NoteListViewProps = {
	variant: 'list' | 'strip';
	orderedIds: string[];
	docsById: Record<string, Y.Doc>;
	/** Synthetic Y.Doc built from the persisted render snapshot — see NoteGrid.tsx's
	 *  renderGridCard for the equivalent grid-view fallback. Without this, a note
	 *  whose live doc hasn't loaded yet renders nothing at all (a shared note's doc
	 *  load is gated behind an async placements fetch — see CLAUDE.md's Shared Note
	 *  Placement Reconciliation section), instead of the last-known content grid
	 *  view already shows immediately in the same situation. */
	snapshotDocById: Map<string, Y.Doc>;
	noteSnapshotById: Map<string, VisibleNoteSnapshot>;
	/** collectionId → full path label */
	collectionPathById: Map<string, string>;
	labelById: Map<string, LabelRecord>;
	/** noteId → collaborator count (0 = none) */
	collaboratorCountByNoteId: Record<string, number>;
	selectedNoteId: string | null;
	moreMenuNoteId: string | null;
	themeId: ThemeId;
	bannerTitlePosition?: NoteCardBannerTitlePosition;
	activeDragId: string | null;
	/** Included in isDragSession so neighbor flip animations still run through drop overlay settle. */
	isDropSettling?: boolean;
	setItemElement: (id: string, node: HTMLDivElement | null) => void;
	setHandleElement: (id: string, node: HTMLDivElement | null) => void;
	shouldSuppressOpen: () => boolean;
	canOpenNotes: boolean;
	isTrashView?: boolean;
	restoreLabel?: string;
	canDrag: (noteId: string) => boolean;
	onSelectNote: (noteId: string) => void;
	onMoreMenu: (noteId: string, anchorRect: DOMRect | null) => void;
	onRestoreNote?: (noteId: string) => void;
	/** Restore this row's viewport Y after a list ↔ strip switch. */
	scrollAnchor?: ListScrollAnchor | null;
	onScrollAnchorApplied?: () => void;
};

function getColorVars(noteId: string, doc: Y.Doc, themeId: ThemeId): React.CSSProperties | undefined {
	const token = readEffectiveNoteColorToken(
		doc.getMap<any>('metadata'),
		getUserNoteColorToken(noteId),
		hasUserNoteColorPref(noteId)
	);
	if (!token) return undefined;
	const resolved = resolveThemeNoteColorModel(themeId).tokens[token];
	return {
		'--list-row-accent': resolved.accentColor,
		'--list-row-bg': resolved.cardBackground,
		'--list-row-header-bg': resolved.headerBackground,
		'--list-row-border': resolved.borderColor,
		'--list-row-text': resolved.textColor,
		'--list-row-muted': resolved.mutedTextColor,
	} as React.CSSProperties;
}

function getContentPreview(doc: Y.Doc, noteId: string): string {
	try {
		const note = readNoteFromDoc(doc, noteId);
		if (note.type === 'checklist') {
			const items = note.items ?? [];
			const total = items.length;
			if (total === 0) return '';
			const done = items.filter((item) => item.completed).length;
			return `${done} / ${total}`;
		}
		const content = (note.content ?? '').trim();
		if (!content) return '';
		return content.length > 100 ? `${content.slice(0, 99)}\u2026` : content;
	} catch {
		return '';
	}
}

type NoteRowProps = {
	noteId: string;
	doc: Y.Doc;
	snapshot: VisibleNoteSnapshot | undefined;
	collectionPath: string | null;
	labels: LabelRecord[];
	collaboratorCount: number;
	isSelected: boolean;
	isMoreMenuOpen: boolean;
	isPlaceholder: boolean;
	showPreview: boolean;
	themeId: ThemeId;
	bannerTitlePosition?: NoteCardBannerTitlePosition;
	setItemElement: (id: string, node: HTMLDivElement | null) => void;
	setHandleElement: (id: string, node: HTMLDivElement | null) => void;
	shouldSuppressOpen: () => boolean;
	canDrag: boolean;
	canOpenNotes: boolean;
	isTrashView: boolean;
	restoreLabel: string;
	onSelectNote: (noteId: string) => void;
	onMoreMenu: (noteId: string, anchorRect: DOMRect | null) => void;
	onRestoreNote?: (noteId: string) => void;
};

const NoteRow = React.memo(function NoteRow(props: NoteRowProps): React.JSX.Element {
	const { noteId, doc, snapshot, showPreview } = props;
	const { t } = useI18n();

	const rawTitle = doc.getText('title').toString();
	const title = rawTitle || t('note.untitled');
	const isTitleMuted = !rawTitle;
	const rawNoteType = String(doc.getMap<any>('metadata').get('type') ?? '');
	const noteType = rawNoteType === 'checklist'
		? 'checklist'
		: rawNoteType === 'drawing'
			? 'drawing'
			: 'text';
	const noteTypeLabel = noteType === 'checklist' ? 'Checklist' : noteType === 'drawing' ? 'Drawing' : 'Note';
	const noteTypeIcon = noteType === 'checklist' ? faListCheck : noteType === 'drawing' ? faPenNib : faFileLines;
	const metadata = React.useMemo(() => doc.getMap<any>('metadata'), [doc]);
	const colorVars = getColorVars(noteId, doc, props.themeId);
	const colorVarMap = colorVars as Record<string, string> | undefined;
	const noteBannerFile = React.useSyncExternalStore(
		(onStoreChange) => {
			const unsubscribePrefs = subscribeNoteBannerPrefs(onStoreChange);
			const observer = (): void => onStoreChange();
			metadata.observe(observer);
			return () => {
				unsubscribePrefs();
				metadata.unobserve(observer);
			};
		},
		() => readEffectiveNoteBannerFile(metadata, getUserNoteBannerFile(noteId)),
		() => readEffectiveNoteBannerFile(metadata, getUserNoteBannerFile(noteId))
	);
	const noteBannerUrl = useThemedNoteBannerImageUrl(noteBannerFile, props.themeId, {
		surface: colorVarMap?.['--list-row-bg'],
		surfaceAlt: colorVarMap?.['--list-row-header-bg'],
		text: colorVarMap?.['--list-row-text'],
		accent: colorVarMap?.['--list-row-accent'],
	}, 'list');
	const noteBannerPresentationStyle = React.useMemo<React.CSSProperties>(
		() => getNoteBannerPresentationStyle(props.themeId, {
			surface: colorVarMap?.['--list-row-bg'],
			surfaceAlt: colorVarMap?.['--list-row-header-bg'],
			text: colorVarMap?.['--list-row-text'],
			accent: colorVarMap?.['--list-row-accent'],
		}),
		[props.themeId, colorVarMap?.['--list-row-accent'], colorVarMap?.['--list-row-bg'], colorVarMap?.['--list-row-header-bg'], colorVarMap?.['--list-row-text']]
	);
	const noteBannerReadableColors = useNoteBannerReadableColors(noteBannerUrl);
	const bannerTitlePosition = props.bannerTitlePosition === 'below' ? 'below' : 'above';
	const preview = showPreview ? getContentPreview(doc, noteId) : null;
	const showRestoreAction = props.isTrashView && typeof props.onRestoreNote === 'function';
	const rowStyle = React.useMemo(() => {
		if (!noteBannerUrl) return colorVars;
		return {
			...colorVars,
			...noteBannerPresentationStyle,
			'--list-row-banner-image': `url("${noteBannerUrl}")`,
			'--list-row-banner-border': noteBannerReadableColors?.backgroundColor ?? colorVarMap?.['--list-row-accent'],
			'--list-row-banner-text': noteBannerReadableColors?.textColor,
			'--list-row-banner-muted': noteBannerReadableColors?.mutedTextColor,
			'--list-row-banner-text-shadow': noteBannerReadableColors?.textShadow,
			'--list-row-banner-surface': noteBannerReadableColors?.surfaceColor,
			'--list-row-banner-control-bg': noteBannerReadableColors?.controlBackgroundColor,
			'--list-row-banner-control-border': noteBannerReadableColors?.controlBorderColor,
		} as React.CSSProperties;
	}, [colorVars, noteBannerPresentationStyle, noteBannerReadableColors?.controlBackgroundColor, noteBannerReadableColors?.controlBorderColor, noteBannerReadableColors?.mutedTextColor, noteBannerReadableColors?.surfaceColor, noteBannerReadableColors?.textColor, noteBannerReadableColors?.textShadow, noteBannerUrl]);

	const handleItemRef = React.useCallback(
		(node: HTMLDivElement | null) => {
			props.setItemElement(noteId, node);
			if (!props.canDrag) {
				props.setHandleElement(noteId, null);
				return;
			}
			props.setHandleElement(noteId, node);
		},
		[noteId, props.canDrag, props.setHandleElement, props.setItemElement]
	);

	const handleClick = React.useCallback(
		(event: React.MouseEvent) => {
			// Prevent the more-menu button from also triggering open
			if ((event.target as HTMLElement).closest('[data-more-btn="true"]')) return;
			if (!props.canOpenNotes) return;
			if (props.shouldSuppressOpen()) return;
			props.onSelectNote(noteId);
		},
		[noteId, props]
	);

	const handleKeyDown = React.useCallback(
		(event: React.KeyboardEvent) => {
			if (!props.canOpenNotes) return;
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				props.onSelectNote(noteId);
			}
		},
		[noteId, props.canOpenNotes, props.onSelectNote]
	);

	const handleMoreMenuClick = React.useCallback(
		(event: React.MouseEvent<HTMLButtonElement>) => {
			event.stopPropagation();
			const rect = event.currentTarget.getBoundingClientRect();
			props.onMoreMenu(noteId, rect);
		},
		[noteId, props.onMoreMenu]
	);

	const handleRestoreClick = React.useCallback(
		(event: React.MouseEvent<HTMLButtonElement>) => {
			event.stopPropagation();
			props.onRestoreNote?.(noteId);
		},
		[noteId, props.onRestoreNote]
	);

	return (
		<div
			ref={handleItemRef}
			className={[
				styles.row,
				noteBannerUrl ? styles.rowBanner : '',
				noteBannerUrl && bannerTitlePosition === 'above' ? styles.rowBannerTitleAbove : '',
				noteBannerUrl && bannerTitlePosition === 'below' ? styles.rowBannerTitleBelow : '',
				showRestoreAction ? styles.rowTrash : '',
				props.isSelected ? styles.rowSelected : '',
				props.isMoreMenuOpen ? styles.rowMenuOpen : '',
				props.isPlaceholder ? styles.rowPlaceholder : '',
				showPreview ? styles.rowStrip : '',
			]
				.filter(Boolean)
				.join(' ')}
			style={rowStyle}
			role={props.canOpenNotes ? 'button' : undefined}
			tabIndex={props.canOpenNotes ? 0 : undefined}
			data-note-card="true"
			data-note-list-row="true"
			data-note-id={noteId}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
		>
			{showRestoreAction ? (
				<div className={styles.trashRestoreRow}>
					<button
						type="button"
						className={styles.trashRestoreButton}
						onClick={handleRestoreClick}
						aria-label={props.restoreLabel}
					>
						<span className={styles.trashRestoreIcon} aria-hidden="true">
							<FontAwesomeIcon icon={faRotateLeft} />
						</span>
						<span>{props.restoreLabel}</span>
					</button>
				</div>
			) : null}

			<div
				className={styles.rowMain}
			>
				<span
					className={styles.rowTypeIcon}
					data-drag-handle="true"
					title={noteTypeLabel}
				>
					<FontAwesomeIcon icon={noteTypeIcon} />
				</span>
				<div className={styles.rowTextColumn}>
					<span className={isTitleMuted ? `${styles.rowTitle} ${styles.rowTitleMuted}` : styles.rowTitle}>{title}</span>
					{showPreview && preview ? (
						<div className={styles.rowPreview}>{preview}</div>
					) : null}
				</div>
			</div>

			<button
				type="button"
				className={styles.moreBtn}
				data-more-btn="true"
				onClick={handleMoreMenuClick}
				tabIndex={-1}
				aria-label="More options"
			>
				<FontAwesomeIcon icon={faEllipsisVertical} />
			</button>
		</div>
	);
});

export function NoteListView(props: NoteListViewProps): React.JSX.Element {
	React.useSyncExternalStore(subscribeNoteColorPrefs, getUserNoteColorPrefsSnapshot, getUserNoteColorPrefsSnapshot);
	const showPreview = props.variant === 'strip';
	const containerRef = React.useRef<HTMLDivElement | null>(null);
	const previousRectsRef = React.useRef<DocumentRectMap>(new Map());
	const hasMeasuredRef = React.useRef(false);
	const [scrollMargin, setScrollMargin] = React.useState(0);
	// Never toggle virtualization off during drag — remounting the list collapses document
	// height and resets window scroll. Neighbor shift uses document-space flip on the
	// rows that stay mounted (see isDragSession below). Do not reintroduce
	// `!activeDragId` guards here; scroll-restore after re-enable was unreliable.
	const shouldVirtualize = props.orderedIds.length >= MIN_ROWS_BEFORE_VIRTUALIZING;
	const isDragSession = Boolean(props.activeDragId || props.isDropSettling);
	const estimatedRowHeight = showPreview ? STRIP_ROW_HEIGHT_PX : LIST_ROW_HEIGHT_PX;

	React.useLayoutEffect(() => {
		if (typeof window === 'undefined') return;
		const node = containerRef.current;
		if (!node) return;

		// Window virtualization needs the list's document offset so restored scroll
		// positions line up with the first mounted rows.
		const updateScrollMargin = (): void => {
			const rect = node.getBoundingClientRect();
			const nextMargin = Math.max(0, Math.round(rect.top + window.scrollY));
			setScrollMargin((previous) => (previous === nextMargin ? previous : nextMargin));
		};

		updateScrollMargin();
		const rafId = window.requestAnimationFrame(updateScrollMargin);
		const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateScrollMargin()) : null;
		observer?.observe(node);
		window.addEventListener('resize', updateScrollMargin);
		window.addEventListener('orientationchange', updateScrollMargin);

		return () => {
			window.cancelAnimationFrame(rafId);
			observer?.disconnect();
			window.removeEventListener('resize', updateScrollMargin);
			window.removeEventListener('orientationchange', updateScrollMargin);
		};
	}, [props.variant, props.orderedIds.length]);

	const anchor = props.scrollAnchor ?? null;
	const anchorIndex = anchor ? props.orderedIds.indexOf(anchor.noteId) : -1;
	const rowStride = estimatedRowHeight + LIST_ROW_GAP_PX;
	// During a list ↔ strip switch, keep the rows around the anchor note mounted in this very
	// render. The virtualizer still thinks the page is scrolled where it was before the switch
	// (it only hears about the scroll a frame later), so without this the synchronous scroll in
	// the anchor effect below would land on rows that don't exist yet and flash an empty list.
	// The range stays contiguous because rows are laid out in normal flow with padding.
	const rangeExtractor = React.useCallback((range: Range): number[] => {
		const base = defaultRangeExtractor(range);
		if (anchorIndex < 0 || range.count === 0) return base;
		const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
		const span = Math.ceil(viewportHeight / rowStride) + range.overscan;
		const start = Math.max(0, Math.min(base.length > 0 ? base[0] : anchorIndex, anchorIndex - span));
		const end = Math.min(range.count - 1, Math.max(base.length > 0 ? base[base.length - 1] : anchorIndex, anchorIndex + span));
		const indexes: number[] = [];
		for (let index = start; index <= end; index += 1) indexes.push(index);
		return indexes;
	}, [anchorIndex, rowStride]);

	const virtualizer = useWindowVirtualizer<HTMLDivElement>({
		count: props.orderedIds.length,
		estimateSize: () => estimatedRowHeight,
		// Wider overscan during drag/drop so more neighbors are mounted for flip animations.
		overscan: isDragSession ? 24 : 10,
		gap: LIST_ROW_GAP_PX,
		scrollMargin,
		getItemKey: (index) => props.orderedIds[index] ?? index,
		enabled: shouldVirtualize,
		useFlushSync: false,
		rangeExtractor,
	});
	// List/strip rows are intentionally fixed-height. Letting recycled rows re-measure after
	// mount makes the window virtualizer keep correcting offsets mid-scroll, which shows up as
	// jitter once virtualization starts recycling beyond page one. This has to be set on the
	// instance: virtual-core only reads it from the virtualizer object, never from the options
	// passed to the hook, so as an option it silently did nothing (same trap the grid's
	// columns fell into before 1.13.2).
	virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;

	React.useEffect(() => {
		if (!shouldVirtualize) return;
		virtualizer.measure();
	}, [scrollMargin, shouldVirtualize, virtualizer]);

	// A list ↔ strip switch. Put the note that was at the top of the screen back exactly where
	// it was, then animate every row from where it sat on screen before the switch. Both happen
	// here, after the new layout commits but before the browser paints it.
	//
	// This used to wait two frames and then chase the anchor row while the rows were already
	// mid-animation. The measured position included the animation's transform, so the scroll
	// "corrected" to a moving target and the top note ended up somewhere else. And once a column
	// held 30+ notes the list was virtualized, which skipped the animation entirely: the view
	// just snapped. Hence "the animation was lovely until we had more notes".
	const anchorAnimationUntilRef = React.useRef(0);
	React.useLayoutEffect(() => {
		if (!anchor) return;
		const container = containerRef.current;
		if (!container || typeof window === 'undefined') return;
		if (!isDragSession) clearFlipStyles(container);
		// Whichever column commits first scrolls for all of them.
		applyListScrollAnchorOnce(anchor);
		if (!isDragSession) {
			// Settled layout, no transforms: the baseline later drag animations measure against.
			previousRectsRef.current = measureDocumentRects(container);
			hasMeasuredRef.current = true;
			if (anchor.rowViewportRects) {
				applyFlipFromViewportSnapshot({ container, previousRects: anchor.rowViewportRects, activeId: props.activeDragId });
				anchorAnimationUntilRef.current = performance.now() + FLIP_SETTLE_MS;
			}
		}
		// Only the column that holds the anchor note reports back. It waits a few frames so the
		// virtualizer has seen the scroll before the extra rows above are dropped, and nudges the
		// anchor back if a late layout change (e.g. a section above resizing) moved it. The anchor
		// row itself doesn't animate (it didn't move on screen), so measuring it here is safe.
		if (anchorIndex < 0) return;
		let cancelled = false;
		let frame = 0;
		let attempts = 0;
		const settle = (): void => {
			if (cancelled) return;
			attempts += 1;
			const row = findListRowByNoteId(anchor.noteId);
			const inPlace = row ? applyListScrollAnchorToRow(row, anchor) : false;
			if ((!inPlace || attempts < 3) && attempts < 8) {
				frame = window.requestAnimationFrame(settle);
				return;
			}
			props.onScrollAnchorApplied?.();
		};
		frame = window.requestAnimationFrame(settle);
		return () => {
			cancelled = true;
			window.cancelAnimationFrame(frame);
		};
		// Runs once per anchor; everything else it reads is current for that commit.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [anchor]);

	const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : [];
	const leadingPaddingPx = shouldVirtualize && virtualItems.length > 0
		? Math.max(0, Math.round(virtualItems[0].start - scrollMargin))
		: 0;
	const trailingPaddingPx = shouldVirtualize && virtualItems.length > 0
		? Math.max(0, Math.round(virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end))
		: 0;
	const renderedItems = shouldVirtualize
		? virtualItems.map((item) => ({ key: item.key, noteId: props.orderedIds[item.index] ?? '' }))
		: props.orderedIds.map((noteId) => ({ key: noteId, noteId }));
	// Full column order, not just visible virtual rows — insertion preview changes order
	// before the virtual window recycles, and flip must run on every reorder.
	const renderedIdsSignature = React.useMemo(
		() => props.orderedIds.join('|'),
		[props.orderedIds]
	);

	React.useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		if (!isDragSession) {
			// A list ↔ strip switch is handled by the anchor effect above (it measures and
			// animates). While that animation runs, measuring here would read its transforms
			// as real movement and kick off a second, wrong animation.
			if (anchor) return;
			if (performance.now() < anchorAnimationUntilRef.current) return;
		}
		// Idle virtualized lists only snapshot rects; flip runs during drag sessions.
		if (shouldVirtualize && !isDragSession) {
			previousRectsRef.current = measureDocumentRects(container);
			hasMeasuredRef.current = true;
			return;
		}
		if (!hasMeasuredRef.current) {
			previousRectsRef.current = measureDocumentRects(container);
			hasMeasuredRef.current = true;
			return;
		}
		previousRectsRef.current = applyDocumentFlipAnimations({
			container,
			previousRects: previousRectsRef.current,
			activeId: props.activeDragId,
			suppressAnimations: false,
			skipForScroll: false,
			suppressUniformGlobalShift: true,
		});
	}, [anchor, isDragSession, props.activeDragId, renderedIdsSignature, shouldVirtualize, showPreview]);

	return (
		<div
			ref={containerRef}
			className={showPreview ? styles.containerStrip : styles.containerList}
			style={shouldVirtualize ? { paddingTop: `${leadingPaddingPx}px`, paddingBottom: `${trailingPaddingPx}px` } : undefined}
		>
			{renderedItems.map(({ key, noteId }) => {
				const doc = props.docsById[noteId] ?? props.snapshotDocById.get(noteId) ?? null;
				if (!doc) return null;
				const snapshot = props.noteSnapshotById.get(noteId);
				const collectionId = snapshot?.collectionId ?? null;
				const collectionPath = collectionId ? (props.collectionPathById.get(collectionId) ?? null) : null;
				const labels = (snapshot?.labelIds ?? [])
					.map((labelId) => props.labelById.get(labelId) ?? null)
					.filter((label): label is LabelRecord => Boolean(label));
				const collaboratorCount = props.collaboratorCountByNoteId[noteId] ?? 0;

				return (
					<NoteRow
						key={key}
						noteId={noteId}
						doc={doc}
						snapshot={snapshot}
						collectionPath={collectionPath}
						labels={labels}
						collaboratorCount={collaboratorCount}
						isSelected={props.selectedNoteId === noteId}
						isMoreMenuOpen={props.moreMenuNoteId === noteId}
						isPlaceholder={props.activeDragId === noteId}
						showPreview={showPreview}
						themeId={props.themeId}
						bannerTitlePosition={props.bannerTitlePosition}
						setItemElement={props.setItemElement}
						setHandleElement={props.setHandleElement}
						shouldSuppressOpen={props.shouldSuppressOpen}
						canOpenNotes={props.canOpenNotes}
						isTrashView={Boolean(props.isTrashView)}
						restoreLabel={props.restoreLabel ?? 'Restore note'}
						canDrag={props.canDrag(noteId)}
						onSelectNote={props.onSelectNote}
						onMoreMenu={props.onMoreMenu}
						onRestoreNote={props.onRestoreNote}
					/>
				);
			})}
			{/* Keep the final mobile list row scrollable above the fixed FAB so its
			    trailing more-menu button does not get trapped underneath the overlay. */}
			<div className={styles.mobileFabSpacer} aria-hidden="true" />
		</div>
	);
}
