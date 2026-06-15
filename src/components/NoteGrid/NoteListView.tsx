/**
 * NoteListView – compact flat-list rendering of notes.
 *
 * Supports two variants:
 *  - 'list'  : ~46px rows showing title + badge icons only
 *  - 'strip' : ~68px rows adding a one-line content preview below the title
 */

import React from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import * as Y from 'yjs';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faEllipsisVertical,
	faFileLines,
	faListCheck,
	faPenNib,
	faRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
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
import { applyDocumentFlipAnimations, measureDocumentRects, type DocumentRectMap } from './flip';
import { applyListScrollAnchorToRow, type ListScrollAnchor } from './listScrollAnchor';
import styles from './NoteListView.module.css';

const LIST_ROW_GAP_PX = 2;
const LIST_ROW_HEIGHT_PX = 44;
const STRIP_ROW_HEIGHT_PX = 64;
const MIN_ROWS_BEFORE_VIRTUALIZING = 30;

export type NoteListViewProps = {
	variant: 'list' | 'strip';
	orderedIds: string[];
	docsById: Record<string, Y.Doc>;
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

	const title = doc.getText('title').toString() || '\u00A0';
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
					<span className={styles.rowTitle}>{title}</span>
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
	const shouldVirtualize = !props.activeDragId && props.orderedIds.length >= MIN_ROWS_BEFORE_VIRTUALIZING;
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

	const virtualizer = useWindowVirtualizer<HTMLDivElement>({
		count: props.orderedIds.length,
		estimateSize: () => estimatedRowHeight,
		overscan: 10,
		gap: LIST_ROW_GAP_PX,
		scrollMargin,
		getItemKey: (index) => props.orderedIds[index] ?? index,
		enabled: shouldVirtualize,
		useFlushSync: false,
		// List/strip rows are intentionally fixed-height. Letting recycled rows re-measure
		// after mount makes the window virtualizer keep correcting offsets mid-scroll,
		// which shows up as jitter once virtualization starts recycling beyond page one.
		shouldAdjustScrollPositionOnItemSizeChange: () => false,
	});

	React.useEffect(() => {
		if (!shouldVirtualize) return;
		virtualizer.measure();
	}, [scrollMargin, shouldVirtualize, virtualizer]);

	React.useLayoutEffect(() => {
		const anchor = props.scrollAnchor;
		if (!anchor) return;
		const index = props.orderedIds.indexOf(anchor.noteId);
		if (index < 0) return;

		let cancelled = false;
		let attempts = 0;
		const stride = estimatedRowHeight + LIST_ROW_GAP_PX;

		const tryAnchor = (): void => {
			if (cancelled) return;
			attempts += 1;

			const row = containerRef.current?.querySelector<HTMLElement>(
				`[data-note-list-row="true"][data-note-id="${CSS.escape(anchor.noteId)}"]`,
			);

			if (!row && shouldVirtualize) {
				// Rough scroll so the virtualizer mounts the anchor row; fine-tune below.
				const targetScrollY = scrollMargin + index * stride - anchor.viewportTopPx;
				window.scrollTo({ left: 0, top: Math.max(0, Math.round(targetScrollY)), behavior: 'auto' });
				if (attempts < 8) {
					window.requestAnimationFrame(tryAnchor);
				} else {
					props.onScrollAnchorApplied?.();
				}
				return;
			}

			if (!row) {
				if (attempts < 8) {
					window.requestAnimationFrame(tryAnchor);
				} else {
					props.onScrollAnchorApplied?.();
				}
				return;
			}

			const settled = applyListScrollAnchorToRow(row, anchor);
			if (!settled && attempts < 8) {
				window.requestAnimationFrame(tryAnchor);
				return;
			}
			props.onScrollAnchorApplied?.();
		};

		let raf2 = 0;
		const raf1 = window.requestAnimationFrame(() => {
			raf2 = window.requestAnimationFrame(tryAnchor);
		});
		return () => {
			cancelled = true;
			window.cancelAnimationFrame(raf1);
			window.cancelAnimationFrame(raf2);
		};
	}, [estimatedRowHeight, props.onScrollAnchorApplied, props.orderedIds, props.scrollAnchor, props.variant, scrollMargin, shouldVirtualize]);

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
	const renderedIdsSignature = React.useMemo(
		() => renderedItems.map((item) => item.noteId).join('|'),
		[renderedItems]
	);

	React.useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		if (shouldVirtualize) {
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
	}, [props.activeDragId, renderedIdsSignature, shouldVirtualize, showPreview]);

	return (
		<div
			ref={containerRef}
			className={showPreview ? styles.containerStrip : styles.containerList}
			style={shouldVirtualize ? { paddingTop: `${leadingPaddingPx}px`, paddingBottom: `${trailingPaddingPx}px` } : undefined}
		>
			{renderedItems.map(({ key, noteId }) => {
				const doc = props.docsById[noteId];
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
