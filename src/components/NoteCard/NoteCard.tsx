import React from 'react';
import type { JSONContent } from '@tiptap/core';
import * as Y from 'yjs';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faBell,
	faEllipsisVertical,
	faImage,
	faPalette,
	faRotateLeft,
	faThumbtack,
	faUserPlus,
	faNoteSticky,
	faListCheck,
	faPencil,
	faLock,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { ChecklistItem } from '../../core/bindings';
import { getChecklistCountPrefix, normalizeChecklistCountValue } from '../../core/checklistCounts';
import { normalizeChecklistHierarchy, sortCompletedChecklistItemsByRecency, toggleChecklistItemCompleted } from '../../core/checklistHierarchy';
import { buildCollapsibleHeadingLayout } from '../../core/collapsibleRichHeadings';
import { getCollapsedRichHeadingPrefsForNoteVersion, getRichHeadingCollapsed, subscribeCollapsedRichHeadingPrefsForNote } from '../../core/collapsibleHeadingPreferences';
import { recordHeadingCollapseDebug } from '../../core/collapsibleHeadingCollapseDebug';
import { getDeviceId } from '../../core/deviceId';
import {
	isNoteCardDragMediaRetentionActive,
	retainNoteCardDragMediaBlobUrls,
} from '../../core/noteCardDragMediaRetention';
import {
	buildDrawingPlaceholderDataUrl,
	getDrawingThumbnailCacheKey,
	getDrawingThumbnailVersion,
	peekLatestDrawingThumbnail,
	peekDrawingThumbnail,
	readCachedDrawingThumbnail,
	readLatestCachedDrawingThumbnail,
	renderDrawingThumbnail,
	type DrawingPlaceholderOptions,
	type DrawingThumbnailResult,
} from '../../core/drawingThumbnails';
import {
	filterRemoteNoteImagesByPendingDeletes,
	getCachedRemoteNoteImages,
	getNoteMediaChangedEventName,
	readQueuedNoteImageDeletions,
	readQueuedNoteImages,
	readStoredNoteImagePreviewRows,
	readStoredRemoteNoteImages,
	refreshRemoteNoteImages,
} from '../../core/noteMediaStore';
import { getExternalLinkRel, getExternalLinkTarget } from '../../core/externalLinks';
import { useI18n } from '../../core/i18n';
import { extractNoteLinksFromDoc, removeNotePreviewLinkFromDoc } from '../../core/noteLinks';
import { syncNoteLinksForDoc } from '../../core/noteLinkStore';
import { getReminderCardTier } from '../../core/reminderUrgency';
import {
	createRichTextDocFromPlainText,
	getChecklistItemPlainText,
	getChecklistItemRichPreviewJson,
	getTextNoteRichPreviewJson,
	replaceRichFragmentFromJson,
	TEXT_NOTE_RICH_FIELD,
} from '../../core/richText';
import {
	getNoteCardCompletedExpanded,
	setNoteCardCompletedExpanded,
	subscribeNoteCardCompletedExpansion,
} from '../../core/noteCardCompletedExpansion';
import { readEffectiveNoteColorToken, resolveThemeNoteColorModel } from '../../core/noteColors';
import { useLiveAvatarUrlLookup } from '../../core/liveUserAvatarCache';
import { readEffectiveNoteBannerFile } from '../../core/noteBanners';
import { resolveNoteBannerReadableColors, useNoteBannerReadableColors } from '../../core/noteBannerReadability';
import { getNoteBannerPresentationStyle, transformNoteBannerSampleColor, useThemedNoteBannerImageUrl } from '../../core/noteBannerTheme';
import type { NoteLinkRecord } from '../../core/noteLinkApi';
import { getUserNoteColorToken, hasUserNoteColorPref, saveUserNoteColorToken, subscribeNoteColorPrefs } from '../../core/noteColorPreferences';
import { getUserNoteBannerFile, subscribeNoteBannerPrefs } from '../../core/noteBannerPreferences';
import { readDrawingLinkState, type NoteType } from '../../core/noteModel';
import type { ThemeId } from '../../core/theme';
import type { NoteCardBannerTitlePosition } from '../../core/deviceAppearancePreferences';
import { updateUserPreferences } from '../../core/userDevicePreferencesApi';
import { useDeniedNoteIds } from '../../core/references/noteAccessCache';
import { NoteLinkPanel } from '../NoteLinks/NoteLinkPanel';
import { NoteColorPickerModal } from './NoteColorPickerModal';
import styles from './NoteCard.module.css';

export type NoteCardProps = {
	noteId: string;
	docId?: string;
	authUserId?: string | null;
	themeId: ThemeId;
	doc: Y.Doc;
	metaChips?: React.ReactNode;
	canEdit?: boolean;
	hasPendingSync?: boolean;
	isPinned?: boolean;
	reminderAt?: string | null;
	isMoreMenuOpen?: boolean;
	onOpen?: () => void;
	onMoreMenu?: (anchorRect?: { top: number; left: number; width: number; height: number } | null) => void;
	onAddReminder?: () => void;
	/** Called when the user taps the restore button overlay on a trashed card. */
	onRestoreNote?: () => void;
	/** When true, renders the card with trash-view treatment: dimmed, blurred content, chips disabled, and a centered restore overlay. */
	isTrashView?: boolean;
	onAddCollaborator?: () => void;
	onAddImage?: () => void;
	shouldSuppressOpen?: () => boolean;
	dragHandleRef?: (node: HTMLDivElement | null) => void;
	dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
	useWholeCardDragHandle?: boolean;
	maxCardHeightPx?: number;
	// The real column card width NoteGrid just computed for this render (its own
	// mobileCardWidthPx state, or the static --note-card-width CSS default on
	// desktop) — see NoteGrid.tsx's `cardWidthPx` local. Passed as a real prop,
	// not read off the DOM, because it's needed inside a lazy useState
	// initializer that runs before this card's own DOM exists to measure (see
	// checklistLayoutMetrics below); it replaces a flat "representative" width
	// guess the checklist header-height estimate used to make.
	cardWidthPx?: number;
	// Clamped note-card text-size preference (App.tsx's clampFontScale), the same
	// value driving the --note-card-font-scale CSS var. Passed as a real prop —
	// not read back off the DOM — so collapsedChecklistLineHeightPx recomputes on
	// a live preference change instead of freezing at whatever scale was active
	// on mount. See that memo's own comment for the bug this replaces.
	noteCardFontScale?: number;
	forcedHeightPx?: number;
	allowChecklistItemInteractions?: boolean;
	allowLinkInteractions?: boolean;
	allowCompletedItemInteractions?: boolean;
	suppressContentInteractions?: boolean;
	initialLinkRecords?: readonly NoteLinkRecord[];
	preserveControlShell?: boolean;
	debugTransitionTraceId?: string | null;
	bannerTitlePosition?: NoteCardBannerTitlePosition;
	loadDrawingDoc?: (drawingId: string) => Promise<Y.Doc | null>;
};

type NoteCardImagePreview = {
	id: string;
	url: string;
};

type NoteCardChecklistItem = ChecklistItem & { richContent: JSONContent | null; completedAt: number | null };

type NoteCardStyle = React.CSSProperties & {
	'--note-color-card-bg'?: string;
	'--note-color-header-bg'?: string;
	'--note-color-border'?: string;
	'--note-color-text'?: string;
	'--note-color-muted'?: string;
	'--note-color-accent'?: string;
	'--note-card-banner-highlight'?: string;
	'--note-card-collapsed-checklist-height'?: string;
	'--note-card-expanded-checklist-max-height'?: string;
	'--note-card-menu-reserved-height'?: string;
	'--note-card-drawing-aspect-ratio'?: string;
};

// NoteLinkPanel.module.css's ".rail .cardLink" grid gives each preview row a fixed-
// width image column (aspect-ratio 1/1, so its height equals its own width) beside a
// text column whose height depends on content (a 2-line-clamped description, so it
// varies by whether that clamp is actually reached). Above the panel's own 640px
// viewport breakpoint the image column is 42px — comfortably taller than the text
// column even at its 2-line max (~11px description * 1.25 line-height * 2 lines +
// ~11px domain line + padding ≈ 41.7px) — so the image height dominates and total row
// height (image 42 + padding 6+6 + border 1+1) lands on a stable, content-independent
// 56px. Below that breakpoint the image column shrinks to 38px while the text column's
// own max barely changes, so text can dominate instead — the same arithmetic there
// gives padding(5+5)+border(1+1)+max(38, ~41.7)≈53.7, rounded to 54. This SECOND case
// is a bound, not an exact figure: a short (1-line) description still renders shorter
// than this, so some residual correction can remain below 640px specifically — flagged
// rather than claimed as fully deterministic, unlike the >640px case above.
function estimateInitialChecklistRailHeight(linkCount: number): number {
	if (linkCount <= 0) return 0;
	const visibleCount = Math.max(1, Math.min(3, Math.floor(linkCount)));
	const isNarrowViewport = typeof window !== 'undefined' && window.innerWidth <= 640;
	return visibleCount * (isNarrowViewport ? 54 : 56);
}

// The real header (headerRef) wraps the title row AND, when a banner is set, a
// .headerBannerMedia block sized by aspect-ratio 16/4.6 off the card's actual width
// (NoteCard.module.css). cardWidthPx is NoteGrid's own real, currently-computed column
// width (see NoteCardProps.cardWidthPx) — passed in because column width is knowable
// synchronously from NoteGrid's own layout state before this card ever mounts, unlike
// this card's own DOM (which doesn't exist yet at first-render time). Falling back to
// FALLBACK_CARD_WIDTH_PX only matters for a caller that doesn't pass the prop
// (defensive, not the expected path through NoteGrid).
const FALLBACK_CARD_WIDTH_PX = 260;
const BANNER_ASPECT_RATIO = 16 / 4.6;
function estimateInitialChecklistHeaderHeight(hasBanner: boolean, cardWidthPx: number): number {
	const titleRowHeightPx = 39;
	if (!hasBanner) return titleRowHeightPx;
	return titleRowHeightPx + Math.round(cardWidthPx / BANNER_ASPECT_RATIO);
}

function renderChecklistCardContent(item: ChecklistItem, content: React.ReactNode): React.ReactNode {
	const prefix = getChecklistCountPrefix(item);
	if (!prefix) return content;
	const prefixNode = <span className={styles.checklistCountPrefix}>{prefix}</span>;
	if (Array.isArray(content) && content.length > 0) {
		const [firstNode, ...rest] = content;
		if (React.isValidElement(firstNode)) {
			const firstElement = firstNode as React.ReactElement<{ children?: React.ReactNode }>;
			return [
				React.cloneElement(firstElement, {
					children: <>{prefixNode}{firstElement.props.children}</>,
				}),
				...rest,
			];
		}
	}
	if (React.isValidElement(content)) {
		const element = content as React.ReactElement<{ children?: React.ReactNode }>;
		return React.cloneElement(element, {
			children: <>{prefixNode}{element.props.children}</>,
		});
	}
	return <>{prefixNode}{content}</>;
}

// Note cards are opened from pointer-up, so claim the active touch gesture at module
// scope and suppress competing touches until the first gesture resolves.
let activeTouchOpenGesturePointerId: number | null = null;
let activeTouchOpenGestureStartedAt = 0;

function isInteractiveTarget(target: EventTarget | null): boolean {
	if (!target || !(target instanceof HTMLElement)) return false;
	return Boolean(target.closest('input, button, textarea, select, a, [role="textbox"]'));
}

function isCoarsePointerDevice(): boolean {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
	return window.matchMedia('(pointer: coarse)').matches;
}

function isElementLayoutMeasurable(element: HTMLElement | null): element is HTMLElement {
	if (!element) return false;
	if (element.getClientRects().length === 0) return false;
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0;
}

function suppressNextDocumentCompatibilityMouseEvents(): void {
	// Mobile browsers often dispatch compatibility mouse events after touch:
	// `mousedown` -> `mouseup` -> `click`.
	// If we open the editor overlay on pointer-up, those can land on the newly
	// mounted editor ("click-through"), selecting text/focusing controls.
	//
	// Suppress these events briefly, in capture phase.
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
	// Cleanup shortly after the synthetic sequence would fire.
	timeoutId = window.setTimeout(() => cleanup(), 500);
}

function triggerLongPressHaptic(): void {
	if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
	try {
		navigator.vibrate(12);
	} catch {
		// Ignore environments that reject haptic requests.
	}
}

// Subscribe to an optional Y.Text and always return a string snapshot.
function useOptionalYTextValue(getYText: () => Y.Text | null): string {
	return React.useSyncExternalStore(
		(onStoreChange) => {
			const ytext = getYText();
			if (!ytext) return () => {};
			const observer = (): void => onStoreChange();
			ytext.observe(observer);
			return () => ytext.unobserve(observer);
		},
		() => getYText()?.toString() ?? '',
		() => getYText()?.toString() ?? ''
	);
}

// Read a metadata field from Y.Map with live updates.
function useMetadataString(metadata: Y.Map<any>, key: string): string {
	return React.useSyncExternalStore(
		(onStoreChange) => {
			const observer = (): void => onStoreChange();
			metadata.observe(observer);
			return () => metadata.unobserve(observer);
		},
		() => String(metadata.get(key) ?? ''),
		() => String(metadata.get(key) ?? '')
	);
}

// Subscribe to checklist binding updates from Y.Array.
function materializeChecklistItems(yarray: Y.Array<Y.Map<any>>): readonly NoteCardChecklistItem[] {
	return yarray
		.toArray()
		.map((m) => ({
			id: String(m.get('id') ?? ''),
			text: getChecklistItemPlainText(m),
			richContent: getChecklistItemRichPreviewJson(m),
			completed: Boolean(m.get('completed')),
			completedAt: Number.isFinite(Number(m.get('completedAt'))) ? Number(m.get('completedAt')) : null,
			parentId:
				typeof m.get('parentId') === 'string' && String(m.get('parentId')).trim().length > 0
					? String(m.get('parentId')).trim()
					: null,
			countValue: normalizeChecklistCountValue(m.get('countValue')),
		}))
		.filter((item) => item.id.length > 0 && item.text.trim().length > 0);
}

function useTextNoteRichPreview(doc: Y.Doc, plainText: string): JSONContent {
	const cacheRef = React.useRef<{
		signature: string;
		value: JSONContent;
	} | null>(null);

	return React.useSyncExternalStore(
		(onStoreChange) => {
			// RAF-throttle: coalesce rapid Yjs transactions (e.g. held backspace) into
			// at most one React re-render per frame, preventing "Maximum update depth
			// exceeded" from N×onStoreChange calls within a single synchronous flush.
			let rafId = 0;
			const observer = (): void => {
				cancelAnimationFrame(rafId);
				rafId = requestAnimationFrame(() => onStoreChange());
			};
			doc.on('afterTransaction', observer);
			return () => {
				doc.off('afterTransaction', observer);
				cancelAnimationFrame(rafId);
			};
		},
		() => {
			const nextValue = getTextNoteRichPreviewJson(doc) ?? createRichTextDocFromPlainText(plainText, 'full');
			const signature = JSON.stringify(nextValue);
			// useSyncExternalStore must return the same snapshot object when content has
			// not changed, otherwise React treats every render as a fresh update cycle.
			if (cacheRef.current && cacheRef.current.signature === signature) {
				return cacheRef.current.value;
			}
			cacheRef.current = { signature, value: nextValue };
			return nextValue;
		},
		() => {
			const nextValue = getTextNoteRichPreviewJson(doc) ?? createRichTextDocFromPlainText(plainText, 'full');
			const signature = JSON.stringify(nextValue);
			if (cacheRef.current && cacheRef.current.signature === signature) {
				return cacheRef.current.value;
			}
			cacheRef.current = { signature, value: nextValue };
			return nextValue;
		}
	);
}

function getSafeHref(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const href = value.trim();
	if (!href || /^javascript:/i.test(href) || href.startsWith('#')) return undefined;
	return href;
}

function getTextAlignStyle(node: JSONContent): React.CSSProperties | undefined {
	const textAlign = typeof (node.attrs as { textAlign?: unknown } | undefined)?.textAlign === 'string'
		? (String((node.attrs as { textAlign?: string }).textAlign) as React.CSSProperties['textAlign'])
		: undefined;
	return textAlign ? { textAlign } : undefined;
}

function getHeadingLevel(node: JSONContent): 3 | 4 | 5 | 6 {
	const level = Number((node.attrs as { level?: unknown } | undefined)?.level ?? 3);
	if (level <= 3) return 3;
	if (level === 4) return 4;
	if (level === 5) return 5;
	return 6;
}


function getTaskItemChecked(node: JSONContent): boolean {
	const attrs = (node.attrs as { checked?: unknown; ['data-checked']?: unknown } | undefined) ?? {};
	if (typeof attrs.checked === 'boolean') return attrs.checked;
	if (typeof attrs['data-checked'] === 'string') return attrs['data-checked'] === 'true';
	return false;
}

function extractPlainTextFromNode(node: JSONContent | null | undefined): string {
	if (!node) return '';
	if (node.type === 'text') return node.text ?? '';
	if (node.type === 'hardBreak') return '\n';
	if (!Array.isArray(node.content) || node.content.length === 0) return '';
	return node.content.map((child) => extractPlainTextFromNode(child)).join('');
}

function extractPlainTextFromNodes(nodes: readonly JSONContent[] | null | undefined): string {
	if (!Array.isArray(nodes) || nodes.length === 0) return '';
	return nodes.map((node) => extractPlainTextFromNode(node)).join('').replace(/\s+/g, ' ').trim();
}

function isTextNoteContentEmpty(content: string, richContent: JSONContent, _noteId: string): boolean {
	if (content.trim().length > 0) return false;
	// Empty TipTap docs still render a placeholder paragraph (<br />), so inspect
	// plain text instead of React preview nodes when deciding media-only cards.
	return extractPlainTextFromNode(richContent).length === 0;
}

function isChecklistContentEmpty(items: readonly NoteCardChecklistItem[], _noteId: string): boolean {
	if (items.length === 0) return true;
	return items.every((item) => {
		if (item.text.trim().length > 0) return false;
		return extractPlainTextFromNode(item.richContent ?? createRichTextDocFromPlainText(item.text)).length === 0;
	});
}

type NoteCardImagePreviewSource = {
	id: string;
	url: string | null;
	blob: Blob | null;
};

function buildNoteCardImagePreviewSources(args: {
	remoteImages: readonly { id: string; thumbnailUrl?: string | null; originalUrl?: string | null }[];
	queuedRows: readonly { id: string; operationType?: string; blob?: Blob | null; sourceUrl?: string | null }[];
	previewRows: readonly { id: string; kind: 'remote' | 'queued'; remoteImageId?: string | null; thumbnailBlob?: Blob | null }[];
}): readonly NoteCardImagePreviewSource[] {
	const previewByRemoteId = new Map(
		args.previewRows
			.filter((row) => row.kind === 'remote' && row.remoteImageId)
			.map((row) => [String(row.remoteImageId), row] as const)
	);
	const previewByQueuedId = new Map(
		args.previewRows
			.filter((row) => row.kind === 'queued')
			.map((row) => [row.id, row] as const)
	);
	const results: NoteCardImagePreviewSource[] = [];
	for (const image of args.remoteImages) {
		const previewRow = previewByRemoteId.get(image.id);
		results.push({
			id: image.id,
			url: String(image.thumbnailUrl || image.originalUrl || '').trim() || null,
			blob: previewRow?.thumbnailBlob instanceof Blob ? previewRow.thumbnailBlob : null,
		});
	}
	for (const row of args.queuedRows) {
		if (row.operationType === 'delete') continue;
		if (results.some((entry) => entry.id === row.id)) continue;
		const previewRow = previewByQueuedId.get(row.id);
		results.push({
			id: row.id,
			url: typeof row.sourceUrl === 'string' && row.sourceUrl.trim().length > 0 ? row.sourceUrl.trim() : null,
			blob: row.blob instanceof Blob
				? row.blob
				: previewRow?.thumbnailBlob instanceof Blob
					? previewRow.thumbnailBlob
					: null,
		});
	}
	return results.slice(0, 4);
}

function mapNoteCardImagePreviews(sources: readonly NoteCardImagePreviewSource[], objectUrls: string[]): readonly NoteCardImagePreview[] {
	const nextObjectUrls: string[] = [];
	const previews: NoteCardImagePreview[] = [];
	for (const source of sources) {
		let url = source.url?.trim() ?? '';
		if (!url && source.blob instanceof Blob) {
			url = URL.createObjectURL(source.blob);
			nextObjectUrls.push(url);
		}
		if (url.length > 0) {
			previews.push({ id: source.id, url });
		}
	}
	objectUrls.splice(0, objectUrls.length, ...nextObjectUrls);
	return previews;
}

function applyMarks(node: JSONContent, content: React.ReactNode, key: string, allowLinkInteraction: boolean): React.ReactNode {
	let result = content;
	for (const [index, mark] of (node.marks ?? []).entries()) {
		if (mark.type === 'bold') result = <strong key={`${key}:bold:${index}`}>{result}</strong>;
		if (mark.type === 'italic') result = <em key={`${key}:italic:${index}`}>{result}</em>;
		if (mark.type === 'underline') result = <u key={`${key}:underline:${index}`}>{result}</u>;
		if (mark.type === 'strike') result = <s key={`${key}:strike:${index}`}>{result}</s>;
		if (mark.type === 'code') result = <code key={`${key}:code:${index}`} className={styles.richInlineCode}>{result}</code>;
		if (mark.type === 'highlight') {
			const color = (mark.attrs as { color?: string } | undefined)?.color;
			result = <mark key={`${key}:highlight:${index}`} className={styles.richHighlight} style={color ? { backgroundColor: color } : undefined}>{result}</mark>;
		}
		if (mark.type === 'link') {
			const href = getSafeHref((mark.attrs as { href?: unknown } | undefined)?.href);
			result = href && allowLinkInteraction ? (
				<a key={`${key}:link:${index}`} className={styles.richLink} href={href} target={getExternalLinkTarget()} rel={getExternalLinkRel()}>
					{result}
				</a>
			) : <span key={`${key}:link:${index}`} className={styles.richLink}>{result}</span>;
		}
	}
	return result;
}

function cardNoteTypeIcon(noteType?: string | null): IconDefinition {
	switch (noteType) {
		case 'checklist': return faListCheck;
		case 'drawing':   return faPencil;
		case 'reminder':  return faBell;
		default:          return faNoteSticky;
	}
}

function renderInlineNodes(nodes: readonly JSONContent[], keyPrefix: string, allowLinkInteraction: boolean, deniedNoteIds?: Set<string>, liveAvatarLookup?: ReadonlyMap<string, string | null>): React.ReactNode[] {
	return nodes.flatMap((node, index) => {
		const key = `${keyPrefix}:${index}`;
		if (node.type === 'hardBreak') return [<br key={key} />];
		if (node.type === 'reference') {
			const label     = String(node.attrs?.label ?? '').trim();
			if (!label) return [];
			const refType   = node.attrs?.type;
			const noteType  = node.attrs?.noteType ?? null;
			const userId    = node.attrs?.id ?? null;
			const storedUrl = node.attrs?.avatarUrl ?? null;
			const avatarUrl = (liveAvatarLookup && userId ? (liveAvatarLookup.get(userId) ?? storedUrl) : storedUrl);
			const isNote    = refType === 'note';
			const isUser    = refType === 'user';
			const noteId    = node.attrs?.id ?? null;
			const isDenied  = isNote && !!noteId && !!deniedNoteIds?.has(noteId);
			return [(
				<span
					key={key}
					className={`${styles.richReferenceChip}${isDenied ? ` ${styles.richReferenceChipDenied}` : ''}`}
					title={isDenied ? "You don't have access to this note" : undefined}
				>
					{isNote && (
						<FontAwesomeIcon
							icon={isDenied ? faLock : cardNoteTypeIcon(noteType)}
							className={styles.richReferenceChipIcon}
						/>
					)}
					{isUser && avatarUrl && (
						<img src={avatarUrl} className={styles.richReferenceChipAvatar} alt="" aria-hidden />
					)}
					{label}
				</span>
			)];
		}
		if (node.type !== 'text' || !node.text) return [];
		return [<React.Fragment key={key}>{applyMarks(node, node.text, key, allowLinkInteraction)}</React.Fragment>];
	});
}

function renderTableCellContent(nodes: readonly JSONContent[], keyPrefix: string, allowLinkInteraction: boolean, deniedNoteIds?: Set<string>, liveAvatarLookup?: ReadonlyMap<string, string | null>): React.ReactNode {
	const children = nodes
		.map((child, index) => renderBlockNode(child, `${keyPrefix}:${index}`, { inTableCell: true, allowLinkInteraction, deniedNoteIds, liveAvatarLookup }))
		.filter(Boolean);
	return children.length > 0 ? children : <span className={styles.richTableEmpty}>&nbsp;</span>;
}

function renderTableNode(block: JSONContent, key: string, allowLinkInteraction: boolean, deniedNoteIds?: Set<string>, liveAvatarLookup?: ReadonlyMap<string, string | null>): React.ReactNode {
	const rows = (block.content ?? [])
		.filter((row): row is JSONContent => row?.type === 'tableRow')
		.map((row) => ({
			cells: (row.content ?? [])
				.filter((cell): cell is JSONContent => cell?.type === 'tableCell' || cell?.type === 'tableHeader')
				.map((cell) => ({
					isHeader: cell.type === 'tableHeader',
					content: cell.content ?? [],
				})),
		}))
		.filter((row) => row.cells.length > 0);

	if (rows.length === 0) return null;

	const hasHeaderRow = rows[0]?.cells.every((cell) => cell.isHeader) ?? false;
	const headerLabels = hasHeaderRow
		? rows[0].cells.map((cell) => extractPlainTextFromNodes(cell.content))
		: [];
	const bodyRows = hasHeaderRow && rows.length > 1 ? rows.slice(1) : rows;
	const displayRows = bodyRows.length > 0 ? bodyRows : rows;
	if (displayRows.length === 0) return null;

	return (
		<div key={key} className={styles.richTablePreview}>
			<section className={styles.richTableCard}>
				{hasHeaderRow && headerLabels.length > 0 && (
					<div className={styles.richTableHeaderBar}>{headerLabels.join(' · ')}</div>
				)}
				{displayRows.map((row, rowIndex) => (
					<div key={`${key}:row:${rowIndex}`} className={styles.richTableField}>
						<div className={styles.richTableValue}>
							{row.cells.map((cell, cellIndex) => (
								<div key={`${key}:row:${rowIndex}:cell:${cellIndex}`} className={styles.richTableValueRow}>
									{renderTableCellContent(cell.content, `${key}:row:${rowIndex}:cell:${cellIndex}`, allowLinkInteraction, deniedNoteIds, liveAvatarLookup)}
								</div>
							))}
						</div>
					</div>
				))}
			</section>
		</div>
	);
}

type RichPreviewRenderOptions = {
	inListItem?: boolean;
	inTableCell?: boolean;
	allowLinkInteraction?: boolean;
	onToggleTaskItem?: (indexPath: number[]) => void;
	noteId?: string;
	deniedNoteIds?: Set<string>;
	liveAvatarLookup?: ReadonlyMap<string, string | null>;
};

function renderBlockNode(block: JSONContent, key: string, options: RichPreviewRenderOptions = {}): React.ReactNode {
	const {
		inListItem = false,
		inTableCell = false,
		allowLinkInteraction = true,
		onToggleTaskItem,
		noteId,
		deniedNoteIds,
		liveAvatarLookup,
	} = options;
	const style = getTextAlignStyle(block);

	if (block.type === 'paragraph' || block.type === 'heading') {
		const children = renderInlineNodes(block.content ?? [], key, allowLinkInteraction, deniedNoteIds, liveAvatarLookup);
		if (block.type === 'heading') {
			const level = getHeadingLevel(block);
			const headingClassName = [styles.richHeading, styles[`richHeading${level}` as keyof typeof styles]].filter(Boolean).join(' ');
			return React.createElement(
				`h${level}`,
				{ key, className: headingClassName, style },
				children.length > 0 ? children : <br />
			);
		}
		return React.createElement(
			inListItem || inTableCell ? 'div' : 'p',
			{ key, className: inListItem ? styles.richListParagraph : styles.richBlock, style },
			children.length > 0 ? children : <br />
		);
	}

	if (block.type === 'bulletList' || block.type === 'orderedList') {
		const items = (block.content ?? []).map((item, index) => renderBlockNode(item, `${key}:${index}`, { inTableCell, allowLinkInteraction, onToggleTaskItem, noteId, deniedNoteIds, liveAvatarLookup })).filter(Boolean);
		if (items.length === 0) return null;
		const ListTag = block.type === 'orderedList' ? 'ol' : 'ul';
		return <ListTag key={key} className={block.type === 'orderedList' ? styles.richOrderedList : styles.richList}>{items}</ListTag>;
	}

	if (block.type === 'taskList') {
		const items = (block.content ?? []).map((item, index) => renderBlockNode(item, `${key}:${index}`, { inTableCell, allowLinkInteraction, onToggleTaskItem, noteId, deniedNoteIds, liveAvatarLookup })).filter(Boolean);
		if (items.length === 0) return null;
		return <ul key={key} className={styles.richTaskList}>{items}</ul>;
	}

	if (block.type === 'listItem') {
		const children = (block.content ?? []).map((child, index) => renderBlockNode(child, `${key}:${index}`, { inListItem: true, inTableCell, allowLinkInteraction, onToggleTaskItem, noteId, deniedNoteIds, liveAvatarLookup })).filter(Boolean);
		if (children.length === 0) return null;
		return <li key={key} className={styles.richListItem}>{children}</li>;
	}

	if (block.type === 'taskItem') {
		const checked = getTaskItemChecked(block);
		const children = (block.content ?? []).map((child, index) => renderBlockNode(child, `${key}:${index}`, { inListItem: true, inTableCell, allowLinkInteraction, onToggleTaskItem, noteId, deniedNoteIds, liveAvatarLookup })).filter(Boolean);
		if (children.length === 0) return null;
		const indexPath = onToggleTaskItem ? key.split(':').slice(1).map(Number) : null;
		return (
			<li
				key={key}
				className={styles.richTaskItem}
				data-checked={checked ? 'true' : 'false'}
			>
				<span
					className={styles.richTaskCheckbox}
					aria-hidden="true"
					onPointerDown={indexPath ? (e) => e.stopPropagation() : undefined}
					onPointerUp={indexPath ? (e) => e.stopPropagation() : undefined}
					onClick={indexPath ? (e) => e.stopPropagation() : undefined}
				>
					<input
						type="checkbox"
						checked={checked}
						readOnly={!indexPath}
						tabIndex={-1}
						style={{ pointerEvents: indexPath ? 'auto' : 'none' }}
						onChange={indexPath ? () => onToggleTaskItem!(indexPath) : undefined}
					/>
				</span>
				<div className={styles.richTaskContent}>{children}</div>
			</li>
		);
	}

	if (block.type === 'blockquote') {
		const children = (block.content ?? []).map((child, index) => renderBlockNode(child, `${key}:${index}`, { inTableCell, allowLinkInteraction, onToggleTaskItem, noteId, deniedNoteIds, liveAvatarLookup })).filter(Boolean);
		if (children.length === 0) return null;
		return <blockquote key={key} className={styles.richBlockquote}>{children}</blockquote>;
	}

	if (block.type === 'codeBlock') {
		const codeText = extractPlainTextFromNodes(block.content ?? []);
		return (
			<pre key={key} className={styles.richCodeBlock}>
				<code>{codeText}</code>
			</pre>
		);
	}

	if (block.type === 'horizontalRule') {
		return <hr key={key} className={styles.richRule} />;
	}

	if (block.type === 'table') {
		return renderTableNode(block, key, allowLinkInteraction, deniedNoteIds, liveAvatarLookup);
	}

	if (Array.isArray(block.content) && block.content.length > 0) {
		const children = block.content.map((child, index) => renderBlockNode(child, `${key}:${index}`, { inListItem, inTableCell, allowLinkInteraction, onToggleTaskItem, noteId, deniedNoteIds, liveAvatarLookup })).filter(Boolean);
		if (children.length === 0) return null;
		return <React.Fragment key={key}>{children}</React.Fragment>;
	}

	return null;
}

function renderRichPreview(
	json: JSONContent | null | undefined,
	allowLinkInteraction = true,
	onToggleTaskItem?: (indexPath: number[]) => void,
	noteId?: string,
	deniedNoteIds?: Set<string>,
	liveAvatarLookup?: ReadonlyMap<string, string | null>,
): React.ReactNode {
	if (!json?.content) return null;
	const visibleBlocks = noteId
		? buildCollapsibleHeadingLayout(json.content, (collapseId) => getRichHeadingCollapsed(noteId, collapseId))
			.filter((item) => !item.hidden)
			.map((item) => item.block)
		: json.content;
	const blocks = visibleBlocks
		.map((block, index) => renderBlockNode(block, `block:${index}`, { allowLinkInteraction, onToggleTaskItem, noteId, deniedNoteIds, liveAvatarLookup }))
		.filter(Boolean);
	return blocks.length > 0 ? blocks : null;
}

function updateChecklistItemById(
	yarray: Y.Array<Y.Map<any>>,
	id: string,
	patch: Partial<Omit<ChecklistItem, 'id'>> & { completedAt?: number | null }
): void {
	const normalizedId = String(id ?? '').trim();
	if (!normalizedId) return;

	const arr = yarray.toArray();
	let idx = -1;
	for (let i = 0; i < arr.length; i++) {
		if (String(arr[i].get('id') ?? '').trim() === normalizedId) {
			idx = i;
			break;
		}
	}
	if (idx === -1) return;

	const doc = (yarray as any).doc as Y.Doc | null | undefined;
	const apply = (): void => {
		const m = yarray.get(idx);
		if (!m) return;
		if (patch.text !== undefined) m.set('text', String(patch.text));
		if (patch.completed !== undefined) m.set('completed', Boolean(patch.completed));
		if (patch.completedAt !== undefined) {
			if (Number.isFinite(Number(patch.completedAt))) m.set('completedAt', Number(patch.completedAt));
			else m.delete('completedAt');
		}
		if (patch.parentId !== undefined) {
			const parentId = typeof patch.parentId === 'string' ? patch.parentId.trim() : null;
			m.set('parentId', parentId && parentId.length > 0 ? parentId : null);
		}
	};
	if (doc) doc.transact(apply);
	else apply();
}

function useChecklistItems(yarray: Y.Array<Y.Map<any>>): readonly NoteCardChecklistItem[] {
	const cacheRef = React.useRef<{
		yarray: Y.Array<Y.Map<any>>;
		items: readonly NoteCardChecklistItem[];
	} | null>(null);

	return React.useSyncExternalStore(
		(onStoreChange) => {
			if (!cacheRef.current || cacheRef.current.yarray !== yarray) {
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
			}
			let rafId = 0;
			const observer = (): void => {
				// Eagerly materialize so the snapshot is always fresh, but defer the
				// React re-render to avoid cascading updates on rapid keystrokes.
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
				cancelAnimationFrame(rafId);
				rafId = requestAnimationFrame(() => onStoreChange());
			};
			yarray.observeDeep(observer);
			return () => {
				yarray.unobserveDeep(observer);
				cancelAnimationFrame(rafId);
			};
		},
		() => {
			if (!cacheRef.current || cacheRef.current.yarray !== yarray) {
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
			}
			return cacheRef.current.items;
		},
		() => {
			if (!cacheRef.current || cacheRef.current.yarray !== yarray) {
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
			}
			return cacheRef.current.items;
		}
	);
}

function useLinkedDrawingIds(doc: Y.Doc): readonly string[] {
	const drawingIds = React.useMemo(() => doc.getArray<string>('drawingIds'), [doc]);
	const snapshot = React.useSyncExternalStore(
		(onStoreChange) => {
			const observer = (): void => onStoreChange();
			drawingIds.observe(observer);
			return () => drawingIds.unobserve(observer);
		},
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

const MEDIA_PREVIEW_MAX = 4;
/** Max linked-drawing doc slots loaded per card (2 keeps startup costs bounded). */
const DRAWING_PREVIEW_MAX = 2;

/**
 * How many drawing and image cells to show in the unified preview grid.
 * Rules:
 *   - Total ≤ MEDIA_PREVIEW_MAX (4)
 *   - Drawings capped at DRAWING_PREVIEW_MAX (2)
 *   - Remaining slots filled with images
 * This gives a balanced mix when both types exist.
 */
function computeMediaPreviewSlots(drawingCount: number, imageCount: number): { drawingSlots: number; imageSlots: number } {
	const drawingSlots = Math.min(drawingCount, DRAWING_PREVIEW_MAX);
	const imageSlots = Math.min(imageCount, MEDIA_PREVIEW_MAX - drawingSlots);
	return { drawingSlots, imageSlots };
}

function useLinkedDrawingThumbnail(
	drawingIds: readonly string[],
	/** Which slot in the array to load (0 or 1). No-op if index ≥ drawingIds.length. */
	index: number,
	loadDrawingDoc: ((drawingId: string) => Promise<Y.Doc | null>) | undefined,
	placeholderOptions: DrawingPlaceholderOptions | undefined,
	fallbackTitle: string,
): string | null {
	const firstDrawingId = drawingIds[index] ?? '';
	const placeholderThemeKey = React.useMemo(
		() => placeholderOptions?.colors
			? `${placeholderOptions.colors.background || ''}|${placeholderOptions.colors.surface || ''}|${placeholderOptions.colors.border || ''}|${placeholderOptions.colors.text || ''}|${placeholderOptions.colors.muted || ''}|${placeholderOptions.colors.accent || ''}`
			: '',
		[placeholderOptions]
	);
	// Synchronously seed the thumbnail from the persistent cache (same source used by
	// native drawing cards) so view-switch and warm-start cards don't start blank.
	const [thumbnailUrl, setThumbnailUrl] = React.useState<string | null>(
		() => (firstDrawingId ? peekLatestDrawingThumbnail(firstDrawingId)?.dataUrl ?? null : null)
	);
	// Stable-ref for the debounce timer so we can cancel it in cleanup.
	const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	React.useEffect(() => {
		let cancelled = false;
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
		}

		if (!firstDrawingId || !loadDrawingDoc) {
			setThumbnailUrl(null);
			return () => { cancelled = true; };
		}

		const doRender = async (doc: Y.Doc | null): Promise<void> => {
			try {
				const title = doc?.getText('title').toString().trim() || fallbackTitle;
				const nextUrl = doc
					? (await renderDrawingThumbnail(firstDrawingId, doc, title, getDrawingThumbnailVersion(doc), placeholderOptions)).dataUrl
					: await buildDrawingPlaceholderDataUrl(title, { ...placeholderOptions, seed: firstDrawingId });
				if (!cancelled) setThumbnailUrl(nextUrl);
			} catch {
				if (cancelled) return;
				const nextUrl = await buildDrawingPlaceholderDataUrl(fallbackTitle, { ...placeholderOptions, seed: firstDrawingId });
				if (!cancelled) setThumbnailUrl(nextUrl);
			}
		};

		// Track the drawing doc so we can subscribe to live changes.
		let drawingDoc: Y.Doc | null = null;
		let lastVersionKey = '';
		let unsubscribeDoc: (() => void) | null = null;

		void (async () => {
			try {
				drawingDoc = await loadDrawingDoc(firstDrawingId);
				if (cancelled) return;

				if (drawingDoc) {
					lastVersionKey = getDrawingThumbnailVersion(drawingDoc);

					// Subscribe to drawing doc changes (propagated via Yjs across all clients).
					// Guard with a version key so animation frames / metadata-only transactions
					// that don't change the visual content don't trigger spurious re-renders.
					// Debounce 500 ms: prevents render-per-stroke jitter during active editing.
					const observer = (): void => {
						if (!drawingDoc) return;
						const newVersion = getDrawingThumbnailVersion(drawingDoc);
						if (newVersion === lastVersionKey) return;
						lastVersionKey = newVersion;
						if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
						debounceTimerRef.current = setTimeout(() => {
							debounceTimerRef.current = null;
							if (!cancelled) void doRender(drawingDoc);
						}, 500);
					};
					drawingDoc.on('afterTransaction', observer);
					unsubscribeDoc = () => drawingDoc!.off('afterTransaction', observer);
				}

				await doRender(drawingDoc);
			} catch {
				if (cancelled) return;
				const nextUrl = await buildDrawingPlaceholderDataUrl(fallbackTitle, { ...placeholderOptions, seed: firstDrawingId });
				if (!cancelled) setThumbnailUrl(nextUrl);
			}
		})();

		return () => {
			cancelled = true;
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}
			if (unsubscribeDoc) unsubscribeDoc();
		};
	}, [fallbackTitle, firstDrawingId, loadDrawingDoc, placeholderOptions, placeholderThemeKey]);

	return thumbnailUrl;
}

function useNoteCardImages(
	docId: string | undefined,
	noteId: string,
	authUserId?: string | null,
): readonly NoteCardImagePreview[] {
	const resolvedDocId = docId?.trim() ?? '';
	const objectUrlsRef = React.useRef<string[]>([]);
	// Synchronously seed from the in-memory remote cache populated by
	// warmWorkspaceImageMetadata so view-switch and workspace-switch cards
	// don't start blank. Remote images have CDN URLs — no blob creation needed.
	const [images, setImages] = React.useState<readonly NoteCardImagePreview[]>(() => {
		if (!resolvedDocId) return [];
		const cached = getCachedRemoteNoteImages(resolvedDocId);
		if (cached.length === 0) return [];
		const sources = buildNoteCardImagePreviewSources({ remoteImages: cached, queuedRows: [], previewRows: [] });
		return mapNoteCardImagePreviews(sources, objectUrlsRef.current);
	});

	React.useEffect(() => {
		const revokeObjectUrls = (): void => {
			for (const url of objectUrlsRef.current) {
				URL.revokeObjectURL(url);
			}
			objectUrlsRef.current = [];
		};

		if (!resolvedDocId) {
			revokeObjectUrls();
			setImages([]);
			return revokeObjectUrls;
		}

		let cancelled = false;
		const hydrateFromLocal = async (): Promise<void> => {
			const [storedRemote, queuedRows, queuedDeletes, previewRows] = await Promise.all([
				readStoredRemoteNoteImages(resolvedDocId),
				authUserId ? readQueuedNoteImages(authUserId, resolvedDocId) : Promise.resolve([]),
				authUserId ? readQueuedNoteImageDeletions(authUserId, resolvedDocId) : Promise.resolve([]),
				readStoredNoteImagePreviewRows(resolvedDocId),
			]);
			const remoteImages = filterRemoteNoteImagesByPendingDeletes(
				storedRemote.length > 0 ? storedRemote : getCachedRemoteNoteImages(resolvedDocId),
				queuedDeletes
			);
			const sources = buildNoteCardImagePreviewSources({ remoteImages, queuedRows, previewRows });
			if (cancelled) return;
			revokeObjectUrls();
			setImages(mapNoteCardImagePreviews(sources, objectUrlsRef.current));
		};

		void hydrateFromLocal();
		void refreshRemoteNoteImages(resolvedDocId).catch(() => []).then((refreshed) => {
			if (cancelled || refreshed.length === 0) return;
			void hydrateFromLocal();
		});

		const eventName = getNoteMediaChangedEventName();
		const onChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string }>).detail;
			if (!detail?.docId || detail.docId === resolvedDocId) {
				void hydrateFromLocal();
			}
		};
		window.addEventListener(eventName, onChanged as EventListener);
		return () => {
			cancelled = true;
			window.removeEventListener(eventName, onChanged as EventListener);
			if (isNoteCardDragMediaRetentionActive(noteId)) {
				retainNoteCardDragMediaBlobUrls(noteId, objectUrlsRef.current);
				objectUrlsRef.current = [];
				return;
			}
			revokeObjectUrls();
		};
	}, [authUserId, noteId, resolvedDocId]);

	return images;
}

type DrawingThumbnailInfo = {
	url: string | null;
	// width/height's own aspect ratio, once known (see drawingThumbnails.ts's
	// DrawingThumbnailResult) — null until a cache entry with real dimensions is
	// found, so the card can fall back to a default box instead.
	aspectRatio: number | null;
};

function useDrawingThumbnail(
	doc: Y.Doc,
	noteId: string,
	noteType: NoteType,
	title: string,
	placeholderOptions?: DrawingPlaceholderOptions
): DrawingThumbnailInfo {
	const snapshotKey = React.useSyncExternalStore(
		(onStoreChange) => {
			let rafId = 0;
			const observer = (): void => {
				cancelAnimationFrame(rafId);
				rafId = requestAnimationFrame(() => onStoreChange());
			};
			doc.on('afterTransaction', observer);
			return () => {
				doc.off('afterTransaction', observer);
				cancelAnimationFrame(rafId);
			};
		},
		() => noteType === 'drawing' ? getDrawingThumbnailVersion(doc) : '',
		() => noteType === 'drawing' ? getDrawingThumbnailVersion(doc) : ''
	);
	const placeholderThemeKey = React.useMemo(
		() => placeholderOptions?.colors
			? `${placeholderOptions.colors.background || ''}|${placeholderOptions.colors.surface || ''}|${placeholderOptions.colors.border || ''}|${placeholderOptions.colors.text || ''}|${placeholderOptions.colors.muted || ''}|${placeholderOptions.colors.accent || ''}`
			: '',
		[placeholderOptions]
	);
	const thumbnailCacheKey = React.useMemo(
		() => noteType === 'drawing' ? getDrawingThumbnailCacheKey(noteId, snapshotKey, placeholderOptions) : '',
		[noteId, noteType, placeholderOptions, snapshotKey]
	);
	const toInfo = (result: DrawingThumbnailResult | null): DrawingThumbnailInfo => ({
		url: result?.dataUrl ?? null,
		aspectRatio: result?.width && result?.height ? result.width / result.height : null,
	});
	const [thumbnail, setThumbnail] = React.useState<DrawingThumbnailInfo>(() => (
		noteType === 'drawing'
			? toInfo((thumbnailCacheKey ? peekDrawingThumbnail(thumbnailCacheKey) : null) || peekLatestDrawingThumbnail(noteId))
			: { url: null, aspectRatio: null }
	));

	React.useEffect(() => {
		let cancelled = false;
		if (noteType !== 'drawing') {
			setThumbnail({ url: null, aspectRatio: null });
			return () => {
				cancelled = true;
			};
		}
		const cached = thumbnailCacheKey ? peekDrawingThumbnail(thumbnailCacheKey) : null;
		if (cached) {
			setThumbnail((current) => (current.url === cached.dataUrl ? current : toInfo(cached)));
		} else {
			const latestCached = peekLatestDrawingThumbnail(noteId);
			if (latestCached) {
				setThumbnail((current) => (current.url === latestCached.dataUrl ? current : toInfo(latestCached)));
			}
		}
		void (async () => {
			const persisted = thumbnailCacheKey
				? await readCachedDrawingThumbnail(thumbnailCacheKey, noteId, snapshotKey)
				: null;
			if (cancelled) return;
			if (persisted) {
				setThumbnail((current) => (current.url === persisted.dataUrl ? current : toInfo(persisted)));
				return;
			}
			const latestPersisted = await readLatestCachedDrawingThumbnail(noteId);
			if (cancelled) return;
			if (latestPersisted) {
				setThumbnail((current) => (current.url === latestPersisted.dataUrl ? current : toInfo(latestPersisted)));
			}
			const rendered = await renderDrawingThumbnail(noteId, doc, title || 'Drawing', snapshotKey, placeholderOptions);
			if (cancelled) return;
			setThumbnail(toInfo(rendered));
		})();
		return () => {
			cancelled = true;
		};
	}, [doc, noteId, noteType, placeholderOptions, placeholderThemeKey, snapshotKey, thumbnailCacheKey, title]);

	return thumbnail;
}

export function NoteCard(props: NoteCardProps): React.JSX.Element {
	recordHeadingCollapseDebug('reactRenderNoteCard', { noteId: props.noteId });
	const { t } = useI18n();
	const maxCardHeightPx = Math.max(220, props.maxCardHeightPx ?? 300);
	// While forcedHeightPx is active (this card is a pre-hydration snapshot shell,
	// see NoteGrid.tsx's isSnapshotCard), the box is literally pinned to that
	// cached height via an inline style that wins over everything else — but the
	// checklist item-count budget below was, until now, computed purely against
	// the grid-wide maxCardHeightPx ceiling with zero awareness of that pin. If
	// the cached height was shorter than maxCardHeightPx, budgeting rendered more
	// items than physically fit in the pinned box (clipped). If it was taller,
	// budgeting rendered fewer than the box had room for (dead space). Budget
	// against whichever ceiling is actually in effect right now instead — once
	// the snapshot phase ends and forcedHeightPx goes away, this collapses back
	// to plain maxCardHeightPx with no change in behavior.
	const effectiveMaxCardHeightPx = Number.isFinite(Number(props.forcedHeightPx)) && Number(props.forcedHeightPx) > 0
		? Math.max(220, Number(props.forcedHeightPx))
		: maxCardHeightPx;
	const noteCardLinkPreviewMaxItems = maxCardHeightPx >= 420 ? 3 : 2;
	const hasFinePointer = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
		? window.matchMedia('(pointer: fine)').matches
		: true;
	const cardWidthPx = props.cardWidthPx ?? FALLBACK_CARD_WIDTH_PX;
	const initialChecklistCardPaddingBottomPx = hasFinePointer ? 50 : 0;
	const initialChecklistBodyPaddingVerticalPx = hasFinePointer ? 14 : 18;
	// Budget checklist preview rows using the rendered row pitch (text line box
	// + 4 px gap between items). The pitch scales with --note-card-font-scale.
	// Prefer the live prop (threaded from App.tsx's same preference state that
	// drives the CSS var) over reading the DOM: this used to read
	// getComputedStyle in a useMemo with an EMPTY dependency array, so it only
	// ever captured the scale active at mount and silently went stale for the
	// rest of that card instance's life on any live font-size preference
	// change — the checklist item/height budget kept computing against the old,
	// smaller line pitch, which under-reserved space and clipped the completed-
	// toggle and URL preview at the bottom of the card. Falling back to the DOM
	// read only covers a caller that doesn't pass the prop (defensive, not the
	// expected path through NoteGrid).
	const collapsedChecklistLineHeightPx = React.useMemo(() => {
		const propScale = Number(props.noteCardFontScale);
		const scale = Number.isFinite(propScale) && propScale > 0
			? propScale
			: typeof document !== 'undefined'
				? Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--note-card-font-scale') || '1') || 1
				: 1;
		return Math.max(18, Math.round(scale * 16 * 1.35 + 4));
	}, [props.noteCardFontScale]);
	// Let the completed summary move with the visible active rows. The coarse-
	// pointer path previously reused a stale measured body height, which created
	// a collapsing gap on mobile as checklist items crossed the preview threshold.
	const keepCompletedToggleStable = false;
	const minimumExpandedCompletedItems = 3;
	const canEdit = props.canEdit !== false;
	const preserveControlShell = props.preserveControlShell === true;
	const allowChecklistItemInteractions = props.allowChecklistItemInteractions !== false;
	const allowLinkInteractions = props.allowLinkInteractions !== false;
	const deniedNoteIds = useDeniedNoteIds();
	const allowCompletedItemInteractions = props.allowCompletedItemInteractions !== false;
	const suppressContentInteractions = props.suppressContentInteractions === true;
	// metadata.type controls note rendering mode.
	const metadata = React.useMemo(() => props.doc.getMap<any>('metadata'), [props.doc]);
	const colorToken = React.useSyncExternalStore(
		(onStoreChange) => {
			// Subscribe to both stores while older local-only color selections are still
			// being migrated onto the canonical note metadata path.
			const unsubLocal = subscribeNoteColorPrefs(onStoreChange);
			const observer = (): void => onStoreChange();
			metadata.observe(observer);
			return () => { unsubLocal(); metadata.unobserve(observer); };
		},
		() => readEffectiveNoteColorToken(metadata, getUserNoteColorToken(props.noteId), hasUserNoteColorPref(props.noteId)),
		() => readEffectiveNoteColorToken(metadata, getUserNoteColorToken(props.noteId), hasUserNoteColorPref(props.noteId))
	);
	const typeValue = useMetadataString(metadata, 'type');
	const type: NoteType = typeValue === 'checklist' ? 'checklist' : typeValue === 'drawing' ? 'drawing' : 'text';
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
		() => readEffectiveNoteBannerFile(metadata, getUserNoteBannerFile(props.noteId)),
		() => readEffectiveNoteBannerFile(metadata, getUserNoteBannerFile(props.noteId))
	);
	const resolvedColor = React.useMemo(
		() => (colorToken ? resolveThemeNoteColorModel(props.themeId).tokens[colorToken] : null),
		[colorToken, props.themeId]
	);
	const headerBannerUrl = useThemedNoteBannerImageUrl(noteBannerFile, props.themeId, {
		surface: resolvedColor?.cardBackground,
		surfaceAlt: resolvedColor?.headerBackground,
		text: resolvedColor?.textColor,
		accent: resolvedColor?.accentColor,
	});
	const headerBannerPresentationStyle = React.useMemo<React.CSSProperties>(
		() => getNoteBannerPresentationStyle(props.themeId, {
			surface: resolvedColor?.cardBackground,
			surfaceAlt: resolvedColor?.headerBackground,
			text: resolvedColor?.textColor,
			accent: resolvedColor?.accentColor,
		}),
		[props.themeId, resolvedColor?.accentColor, resolvedColor?.cardBackground, resolvedColor?.headerBackground, resolvedColor?.textColor]
	);
	const bannerTitlePosition = props.bannerTitlePosition === 'below' ? 'below' : 'above';
	const rawHeaderBannerTitleColors = useNoteBannerReadableColors(headerBannerUrl, { startY: 0.62, endY: 1 });
	const headerBannerTitleColors = React.useMemo(() => {
		if (!rawHeaderBannerTitleColors) return null;
		if (!resolvedColor) return rawHeaderBannerTitleColors;
		// Keep the title-row background in lockstep with the recolored banner media.
		// Sampling the raw asset alone drifts as soon as an explicit note color tints
		// the banner away from its shipped SVG average.
		return resolveNoteBannerReadableColors(transformNoteBannerSampleColor(props.themeId, rawHeaderBannerTitleColors.backgroundColor, {
			surface: resolvedColor.cardBackground,
			surfaceAlt: resolvedColor.headerBackground,
			text: resolvedColor.textColor,
			accent: resolvedColor.accentColor,
		}));
	}, [props.themeId, rawHeaderBannerTitleColors, resolvedColor]);
	const headerBannerTitleStyle = React.useMemo<React.CSSProperties | undefined>(
		() => (
			headerBannerTitleColors
				? {
					backgroundColor: headerBannerTitleColors.backgroundColor,
					color: headerBannerTitleColors.textColor,
					order: bannerTitlePosition === 'above' ? 0 : 1,
				}
				: undefined
		),
		[bannerTitlePosition, headerBannerTitleColors]
	);
	const derivedBannerCardColors = React.useMemo(() => {
		if (!headerBannerTitleColors) return null;
		const cardBackground = headerBannerTitleColors.backgroundColor;
		const textColor = headerBannerTitleColors.textColor;
		const accentColor = `color-mix(in srgb, ${cardBackground} 44%, ${textColor} 56%)`;
		return {
			cardBackground,
			headerBackground: cardBackground,
			borderColor: `color-mix(in srgb, ${cardBackground} 76%, ${textColor} 24%)`,
			textColor,
			mutedTextColor: `color-mix(in srgb, ${textColor} 68%, ${cardBackground} 32%)`,
			accentColor,
		};
	}, [headerBannerTitleColors]);
	// Only banner-only notes promote the sampled banner palette across the full
	// card. When a note already has an explicit color, that note color remains the
	// card surface and is used to tint the banner image instead.
	const displayedCardColors = React.useMemo(
		() => (resolvedColor ? resolvedColor : (headerBannerUrl && derivedBannerCardColors ? derivedBannerCardColors : null)),
		[derivedBannerCardColors, headerBannerUrl, resolvedColor]
	);
	const drawingPlaceholderOptions = React.useMemo<DrawingPlaceholderOptions | undefined>(() => {
		if (!displayedCardColors) return undefined;
		return {
			seed: props.noteId,
			colors: {
				background: displayedCardColors.cardBackground,
				surface: displayedCardColors.headerBackground,
				border: displayedCardColors.borderColor,
				text: displayedCardColors.textColor,
				muted: displayedCardColors.mutedTextColor,
				accent: displayedCardColors.accentColor,
			},
		};
	}, [displayedCardColors, props.noteId]);

	const title = useOptionalYTextValue(React.useCallback(() => props.doc.getText('title'), [props.doc]));
	const content = useOptionalYTextValue(
		React.useCallback(() => (type === 'text' ? props.doc.getText('content') : null), [props.doc, type])
	);
	const { url: drawingThumbnailUrl, aspectRatio: drawingThumbnailAspectRatio } = useDrawingThumbnail(props.doc, props.noteId, type, title, drawingPlaceholderOptions);
	const linkedDrawingIds = useLinkedDrawingIds(props.doc);
	// Two hook calls cover the max DRAWING_PREVIEW_MAX (2) drawing slots.
	// Each is a no-op when its index exceeds linkedDrawingIds.length.
	const linkedDrawingThumbnailFallbackTitle = title.trim() || t('note.untitled');
	const linkedDrawingThumbnail0 = useLinkedDrawingThumbnail(
		linkedDrawingIds,
		0,
		props.loadDrawingDoc,
		drawingPlaceholderOptions,
		linkedDrawingThumbnailFallbackTitle,
	);
	const linkedDrawingThumbnail1 = useLinkedDrawingThumbnail(
		linkedDrawingIds,
		1,
		props.loadDrawingDoc,
		drawingPlaceholderOptions,
		linkedDrawingThumbnailFallbackTitle,
	);
	const noteImages = useNoteCardImages(props.docId, props.noteId, props.authUserId);
	const reminderAt = props.reminderAt ?? '';
	const richContent = useTextNoteRichPreview(props.doc, content);
	const liveAvatarLookup = useLiveAvatarUrlLookup();
	const checklistArray = React.useMemo(() => props.doc.getArray<Y.Map<any>>('checklist'), [props.doc]);

	const handleToggleRichTaskItem = React.useCallback((indexPath: number[]) => {
		if (!canEdit) return;
		const updated = JSON.parse(JSON.stringify(richContent)) as JSONContent;
		let node: JSONContent = updated;
		for (let i = 0; i < indexPath.length - 1; i++) {
			const child = node.content?.[indexPath[i]];
			if (!child) return;
			node = child;
		}
		const lastIdx = indexPath[indexPath.length - 1];
		const target = node.content?.[lastIdx];
		if (!target || target.type !== 'taskItem') return;
		target.attrs = { ...((target.attrs as object) ?? {}), checked: !getTaskItemChecked(target) };
		const fragment = props.doc.getXmlFragment(TEXT_NOTE_RICH_FIELD);
		props.doc.transact(() => { replaceRichFragmentFromJson(fragment, updated, 'full'); });
	}, [canEdit, props.doc, richContent]);
	const checklistItems = useChecklistItems(checklistArray);
	const normalizedItems = React.useMemo<NoteCardChecklistItem[]>(
		() => normalizeChecklistHierarchy(checklistItems) as NoteCardChecklistItem[],
		[checklistItems]
	);
	// Show media previews whenever the note body is empty, regardless of title.
	// Title-only notes (title + no content) still show image/drawing thumbnails.
	const isMediaOnlyEmpty = (
		type === 'text'
			? isTextNoteContentEmpty(content, richContent, props.noteId)
			: type === 'checklist'
				? isChecklistContentEmpty(normalizedItems, props.noteId)
				: false
	);
	const { drawingSlots, imageSlots } = React.useMemo(
		() => isMediaOnlyEmpty
			? computeMediaPreviewSlots(linkedDrawingIds.length, noteImages.length)
			: { drawingSlots: 0, imageSlots: 0 },
		[isMediaOnlyEmpty, linkedDrawingIds.length, noteImages.length],
	);
	const showMediaPreview = drawingSlots + imageSlots > 0;
	// Legacy aliases: kept so existing height-effect conditions don't need rewriting.
	const showLinkedDrawingPreview = showMediaPreview;
	const showImageGridPreview = showMediaPreview;
	const extractedLinks = React.useSyncExternalStore(
		(onStoreChange) => {
			let rafId = 0;
			const observer = (): void => {
				cancelAnimationFrame(rafId);
				rafId = requestAnimationFrame(() => onStoreChange());
			};
			props.doc.on('afterTransaction', observer);
			return () => {
				props.doc.off('afterTransaction', observer);
				cancelAnimationFrame(rafId);
			};
		},
		() => extractNoteLinksFromDoc(props.doc),
		() => extractNoteLinksFromDoc(props.doc)
	);
	// Declared here (rather than down near the rest of the corner-menu JSX) because
	// cardStyle's useMemo, below, needs menuReservedHeightPx as a dependency.
	const hasMenuButton = Boolean(props.onMoreMenu) && isCoarsePointerDevice();
	// The corner menu button is one absolutely-positioned element anchored to the
	// CARD's bottom edge, so only whichever chrome region actually renders last
	// (in DOM order: body -> completedSection [checklist only] -> linkPreviewRail
	// [any type, whenever docId is set]) needs padding reserved to clear it. Every
	// region used to get its own *MenuSafe class unconditionally off hasMenuButton
	// alone, with no awareness of what actually followed it — so a checklist card
	// with a URL preview reserved clearance in completedSection AND body, on top of
	// linkPreviewRail's own (correct) reservation, none of which was needed since
	// linkPreviewRail was the true last element. That's what produced the visibly
	// bigger gap below the completed-toggle than above it: the extra reservation
	// sat between the toggle and the preview, not after the preview where the menu
	// button actually lives.
	const hasCompletedSectionRegion = type === 'checklist';
	// NOT just Boolean(props.docId) — the wrapping <div> for the link-preview rail
	// renders whenever a note has a docId at all (nearly every saved note), even
	// when it has zero actual links and NoteLinkPanel itself renders null inside
	// that div. Treating docId-presence alone as "a preview region exists" wrongly
	// stole the menu-safe reservation away from completedSection for cards with NO
	// preview at all — worse than the original bug, since nothing downstream of
	// completedSection was left to reserve the space instead. Mirrors the same
	// props.initialLinkRecords/extractedLinks combination the initial
	// checklistLayoutMetrics estimate already uses, so a warm-snapshot cold start
	// (initialLinkRecords known before the Yjs doc finishes hydrating extractedLinks)
	// doesn't flash between the two states either.
	const hasLinkPreviewRegion = Boolean(props.docId) && Math.max(props.initialLinkRecords?.length ?? 0, extractedLinks.length) > 0;
	const isBodyMenuSafeRegion = hasMenuButton && !hasCompletedSectionRegion && !hasLinkPreviewRegion;
	const isCompletedSectionMenuSafeRegion = hasMenuButton && hasCompletedSectionRegion && !hasLinkPreviewRegion;
	const isLinkPreviewMenuSafeRegion = hasMenuButton && hasLinkPreviewRegion;
	// Independent of hasMenuButton (applies on desktop too): completedSection's own
	// padding-bottom is sized to look right as the card's trailing edge on its own
	// (a divider above, breathing room below). When a link preview immediately
	// follows it instead, that padding just stacks on top of the preview card's own
	// border+internal padding, which was already doing that same job — producing a
	// visibly bigger gap below the completed-toggle than the divider's gap above it.
	// Zero it out here so the preview's own edge provides the sole gap.
	const isCompletedSectionAdjacentToPreview = hasCompletedSectionRegion && hasLinkPreviewRegion;
	// Single source of truth for how tall the trailing reserved band is, shared via
	// CSS custom property with .linkPreviewRailMenuSafe's own padding-bottom AND
	// .cardMenuButton's own glyph inset (NoteCard.module.css) — previously these were
	// two independently hand-tuned numbers with no way to stay in sync: bumping the
	// reserved padding to fix clipping never re-centered the glyph within the new
	// size. Tune EITHER of these two things and both move together.
	// Only the with-preview case (isLinkPreviewMenuSafeRegion) still needs this at
	// all: the no-preview case (isCompletedSectionMenuSafeRegion) used to reserve
	// trailing space below the toggle for this same button, but centering a glyph
	// within an empty reserved band below a row can never actually share that row's
	// OWN centerline — moving the icon in-line as a true flex sibling of the toggle
	// (completedToggleRow, below) fixed that by construction and made this whole
	// reserved-space mechanism unnecessary for that case: ordinary flex layout
	// already keeps the icon clear of everything with nothing to reserve.
	// 52px (an oversized diagnostic value from an earlier round) read as too much
	// clearance below the preview; 28px, tried next, read as "a little too tight
	// on the top" of the icon's own space. Split the difference upward rather than
	// all the way back — 34px.
	const MENU_RESERVED_HEIGHT_LINK_PREVIEW_PX = 34;
	const menuReservedHeightPx = isLinkPreviewMenuSafeRegion
		? MENU_RESERVED_HEIGHT_LINK_PREVIEW_PX
		: null;
	const handleDeletePreview = React.useCallback((normalizedUrl: string): void => {
		if (!canEdit) return;
		removeNotePreviewLinkFromDoc(props.doc, normalizedUrl);
		// Sync the deletion to the server so the DB record is soft-deleted and
		// future loads don't resurrect the orphaned preview from the server cache.
		void syncNoteLinksForDoc({
			userId: props.authUserId,
			docId: props.docId ?? '',
			links: extractNoteLinksFromDoc(props.doc),
		});
	}, [canEdit, props.authUserId, props.doc, props.docId]);
	// useSyncExternalStore, not local useState: this needs to react when a
	// cross-device server seed lands (seedNoteCardCompletedExpandedByNoteId) for a
	// note this device has never toggled locally, not just to local toggles on
	// this exact card instance — see noteCardCompletedExpansion.ts's own comment
	// for the bug this closes (an already-mounted card previously had no way to
	// hear about that seed arriving at all).
	const showCompleted = React.useSyncExternalStore(
		subscribeNoteCardCompletedExpansion,
		() => getNoteCardCompletedExpanded(props.noteId),
		() => getNoteCardCompletedExpanded(props.noteId)
	);
	React.useSyncExternalStore(
		(onStoreChange) => subscribeCollapsedRichHeadingPrefsForNote(props.noteId, onStoreChange),
		() => getCollapsedRichHeadingPrefsForNoteVersion(props.noteId),
		() => 0,
	);
	const [multilineById, setMultilineById] = React.useState<Record<string, boolean>>({});
	const [clampedById, setClampedById] = React.useState<Record<string, boolean>>({});
	const [textPreviewLayout, setTextPreviewLayout] = React.useState<{ maxHeightPx: number | null; isOverflowing: boolean }>({
		maxHeightPx: null,
		isOverflowing: false,
	});
	const [checklistLayoutMetrics, setChecklistLayoutMetrics] = React.useState(() => {
		const initialPreviewLinkCount = Math.max(
			0,
			Math.min(
				noteCardLinkPreviewMaxItems,
				Math.max(props.initialLinkRecords?.length ?? 0, extractNoteLinksFromDoc(props.doc).length)
			)
		);
		// Conservative initial estimates: keep these close to real measured values
		// so the first render has minimal gap before the layout effect measures.
		// Checklist cards that already have a chip row or preview rail on the warm
		// snapshot need those shells budgeted immediately; otherwise the preview rail
		// is briefly clipped and cards below shift down after the first measurement.
		return {
		headerHeightPx: estimateInitialChecklistHeaderHeight(Boolean(noteBannerFile), cardWidthPx),
		// .metaChipRow's real CSS min-height differs by pointer type: 42px fine
		// (NoteCard.module.css base rule), 40px coarse (pointer:coarse override).
		// At most 4 small icon+count chips render here and never wrap in practice
		// (see NoteGrid.tsx's renderNoteMetaChips — labels collapse into one
		// counted chip), so the CSS floor IS the real height, not just a guess.
		metaHeightPx: props.metaChips ? (hasFinePointer ? 42 : 40) : 0,
		linkPreviewHeightPx: estimateInitialChecklistRailHeight(initialPreviewLinkCount),
		// Real value = toggle.offsetHeight + completedSection's padding-top/bottom
		// + border-top. The toggle's own text renders at the flat, non-scaling
		// --font-size-xs (12px, NoteCard.module.css/variables.css — unlike
		// checklist item rows, this text does NOT scale with
		// --note-card-font-scale), so its line height never reaches
		// .completedToggle's own 20px min-height floor — that floor wins
		// regardless of font-scale or collapsed/expanded state (this field only
		// ever measures the toggle row itself, never the dropdown content).
		// completedSection's padding/border differ by pointer type: coarse is
		// 6px/6px/1px (20+6+6+1=33), fine is 10px/6px/1px (20+10+6+1=37).
		completedBaseHeightPx: hasFinePointer ? 37 : 33,
		cardPaddingBottomPx: initialChecklistCardPaddingBottomPx,
		bodyPaddingVerticalPx: initialChecklistBodyPaddingVerticalPx,
		bodyScrollHeightPx: 0,
		renderedCardScrollHeightPx: 0,
		contentRegionScrollHeightPx: 0,
		};
	});
	const [isColorPickerOpen, setIsColorPickerOpen] = React.useState(false);
	const cardRef = React.useRef<HTMLElement | null>(null);
	const headerRef = React.useRef<HTMLDivElement | null>(null);
	const metaChipRowRef = React.useRef<HTMLDivElement | null>(null);
	const contentRegionRef = React.useRef<HTMLDivElement | null>(null);
	const bodyRef = React.useRef<HTMLDivElement | null>(null);
	const contentPreviewRef = React.useRef<HTMLDivElement | null>(null);
	const checklistRef = React.useRef<HTMLUListElement | null>(null);
	const completedSectionRef = React.useRef<HTMLDivElement | null>(null);
	const completedToggleRef = React.useRef<HTMLButtonElement | HTMLDivElement | null>(null);
	const linkPreviewRailRef = React.useRef<HTMLDivElement | null>(null);
	const footerRef = React.useRef<HTMLDivElement | null>(null);
	const requestChecklistLayoutRefresh = React.useCallback((): void => {
		// Checklist card height changes are already observed by the outer
		// virtualized note-column shell. Dispatching extra grid refresh events from
		// inside the card creates duplicate repack passes around one logical toggle.
	}, []);
	const handleHeaderRef = React.useCallback((node: HTMLDivElement | null): void => {
		headerRef.current = node;
		props.dragHandleRef?.(node);
	}, [props.dragHandleRef]);
	const reminderLabel = React.useMemo(() => {
		if (!reminderAt) return null;
		const parsed = new Date(reminderAt);
		if (!Number.isFinite(parsed.getTime())) return t('note.addReminder');
		return parsed.toLocaleString();
	}, [reminderAt, t]);
	const reminderTier = React.useMemo(() => {
		if (!reminderAt) return null;
		const parsed = new Date(reminderAt);
		if (!Number.isFinite(parsed.getTime())) return null;
		return getReminderCardTier(reminderAt);
	}, [reminderAt]);
	const reminderBadgeClassName = reminderTier === 'overdue'
		? `${styles.reminderBadge} ${styles.reminderBadgeOverdue}`
		: reminderTier === 'dueToday'
			? `${styles.reminderBadge} ${styles.reminderBadgeDueToday}`
			: styles.reminderBadge;

	const measureChecklistTextLayout = React.useCallback((): void => {
		if (type !== 'checklist') return;
		const card = cardRef.current;
		if (!isElementLayoutMeasurable(card)) return;
		const next: Record<string, boolean> = {};
		const nextClamped: Record<string, boolean> = {};
		const mergeMeasuredState = (previous: Record<string, boolean>, measured: Record<string, boolean>): Record<string, boolean> => {
			const merged: Record<string, boolean> = {};
			for (const item of normalizedItems) {
				// Preserve the last measured wrap state for rows that are temporarily
				// hidden by the preview line budget. Large completed sections can
				// otherwise forget those rows are multiline, re-render them, and loop.
				merged[item.id] = Object.prototype.hasOwnProperty.call(measured, item.id) ? measured[item.id] : (previous[item.id] ?? false);
			}
			return merged;
		};
		const textNodes = card.querySelectorAll<HTMLElement>('[data-checklist-text-id]');
		for (const node of Array.from(textNodes)) {
			const id = String(node.dataset.checklistTextId ?? '').trim();
			if (!id) continue;
			const style = window.getComputedStyle(node);
			const fontSize = Number.parseFloat(style.fontSize || '0') || 14;
			const parsedLineHeight = Number.parseFloat(style.lineHeight || '0') || 0;
			const lineHeight = parsedLineHeight > 0 ? parsedLineHeight : fontSize * 1.35;
			const expectedSingleLine = Math.ceil(lineHeight + 2);
			const expectedClampHeight = Math.ceil(lineHeight * 3 + 4);
			next[id] = node.scrollHeight > expectedSingleLine + 4;
			nextClamped[id] = node.scrollHeight > expectedClampHeight;
		}
		setMultilineById((prev) => {
			const merged = mergeMeasuredState(prev, next);
			const prevKeys = Object.keys(prev);
			const nextKeys = Object.keys(merged);
			if (prevKeys.length === nextKeys.length && nextKeys.every((key) => prev[key] === merged[key])) {
				return prev;
			}
			return merged;
		});
		setClampedById((prev) => {
			const merged = mergeMeasuredState(prev, nextClamped);
			const prevKeys = Object.keys(prev);
			const nextKeys = Object.keys(merged);
			if (prevKeys.length === nextKeys.length && nextKeys.every((key) => prev[key] === merged[key])) {
				return prev;
			}
			return merged;
		});
	}, [normalizedItems, type]);

	// (No longer need a props.noteId-keyed re-sync effect here: showCompleted now
	// reads live from useSyncExternalStore above, which already re-evaluates its
	// snapshot on every render, including when props.noteId changes.)
	const activeChecklistItems = React.useMemo(() => normalizedItems.filter((item) => !item.completed), [normalizedItems]);
	const completedChecklistItems = React.useMemo(() => normalizedItems.filter((item) => item.completed), [normalizedItems]);
	const checklistItemLineCost = React.useCallback((itemId: string): number => {
		if (clampedById[itemId]) return 3;
		if (multilineById[itemId]) return 2;
		return 1;
	}, [clampedById, multilineById]);
	const checklistItemById = React.useMemo(() => new Map(normalizedItems.map((item) => [item.id, item])), [normalizedItems]);
	// Shared with the full editors (src/core/checklistHierarchy.ts) so recency
	// ordering behaves identically everywhere a checklist's completed section
	// renders, not just here.
	const recentCompletedItems = React.useMemo(
		() => sortCompletedChecklistItemsByRecency(completedChecklistItems, normalizedItems),
		[completedChecklistItems, normalizedItems]
	);
	const fitChecklistItemsToLineBudget = React.useCallback((items: readonly NoteCardChecklistItem[], lineBudget: number) => {
		if (type !== 'checklist' || items.length === 0) {
			return { visible: [] as NoteCardChecklistItem[], hiddenCount: items.length, usedLineCount: 0 };
		}
		if (lineBudget <= 0) {
			return { visible: [] as NoteCardChecklistItem[], hiddenCount: items.length, usedLineCount: 1 };
		}
		let totalLineCost = 0;
		for (const item of items) totalLineCost += checklistItemLineCost(item.id);
		if (totalLineCost <= lineBudget) {
			return { visible: items.slice(), hiddenCount: 0, usedLineCount: totalLineCost };
		}
		const visible: NoteCardChecklistItem[] = [];
		let remainingBudget = Math.max(0, lineBudget - 1);
		for (const item of items) {
			const lineCost = checklistItemLineCost(item.id);
			if (remainingBudget < lineCost) break;
			visible.push(item);
			remainingBudget -= lineCost;
		}
		return {
			visible,
			hiddenCount: Math.max(0, items.length - visible.length),
			usedLineCount: visible.reduce((total, item) => total + checklistItemLineCost(item.id), 0) + 1,
		};
	}, [checklistItemLineCost, type]);
	const selectVisibleCompletedRows = React.useCallback((lineBudget: number) => {
		if (type !== 'checklist' || recentCompletedItems.length === 0) return [] as Array<{ kind: 'item' | 'ghost'; item: NoteCardChecklistItem }>;
		const visible: Array<{ kind: 'item' | 'ghost'; item: NoteCardChecklistItem }> = [];
		const insertedGhosts = new Set<string>();
		let remainingBudget = Math.max(0, lineBudget);
		let shownCompletedItems = 0;
		for (const item of recentCompletedItems) {
			const ghostParent = item.parentId ? checklistItemById.get(item.parentId) ?? null : null;
			const shouldInsertGhost = Boolean(ghostParent && !ghostParent.completed && !insertedGhosts.has(ghostParent.id));
			const rowCost = checklistItemLineCost(item.id) + (shouldInsertGhost ? 1 : 0);
			if (shownCompletedItems >= minimumExpandedCompletedItems && remainingBudget < rowCost) break;
			if (shouldInsertGhost && ghostParent) {
				visible.push({ kind: 'ghost', item: ghostParent });
				insertedGhosts.add(ghostParent.id);
				remainingBudget = Math.max(0, remainingBudget - 1);
			}
			visible.push({ kind: 'item', item });
			shownCompletedItems += 1;
			remainingBudget = Math.max(0, remainingBudget - checklistItemLineCost(item.id));
		}
		return visible;
	}, [checklistItemById, checklistItemLineCost, minimumExpandedCompletedItems, recentCompletedItems, type]);
	// Deliberately NOT checklistLayoutMetrics.linkPreviewHeightPx (the rail's live
	// measured DOM height) here — that was the actual bug behind a genuinely
	// baffling repro: a checklist would show 6 active items + "3 more" on a fresh
	// mobile load, then a few seconds later, with nobody touching anything,
	// reshuffle itself to 7 active + "2 more" and shove the preview down. Turned
	// out NoteLinkPanel's own data can still be mid-hydration for several seconds
	// after mount (retries at 800ms/1.5s/3s/5s/8s/12s, see noteLinkStore.ts) —
	// every time real title/description text landed, the rail's real rendered
	// height grew, and we were feeding that straight into the item-count budget
	// below. The card wasn't broken, it was just still loading and we were
	// re-deciding the layout every time new data trickled in. The CSS already
	// hard-caps a rail row's height (-webkit-line-clamp:2 on the description),
	// so the same worst-case, link-count-derived estimate the very first paint
	// already uses (estimateInitialChecklistRailHeight) is a genuine upper bound,
	// not just a first guess — reusing it here keeps the item budget stable no
	// matter when, or whether, hydration ever finishes. Tradeoff: a card whose
	// real description is short may reserve a few px more than strictly
	// necessary. Fine. A few wasted pixels beats a checklist that redecorates
	// itself mid-read.
	const currentPreviewLinkCount = React.useMemo(
		() => Math.max(0, Math.min(noteCardLinkPreviewMaxItems, Math.max(props.initialLinkRecords?.length ?? 0, extractedLinks.length))),
		[extractedLinks.length, noteCardLinkPreviewMaxItems, props.initialLinkRecords]
	);
	const stableLinkPreviewHeightPx = React.useMemo(
		() => estimateInitialChecklistRailHeight(currentPreviewLinkCount),
		[currentPreviewLinkCount]
	);
	const checklistFixedChromePx = React.useMemo(
		() => checklistLayoutMetrics.headerHeightPx + checklistLayoutMetrics.metaHeightPx + stableLinkPreviewHeightPx + checklistLayoutMetrics.cardPaddingBottomPx + checklistLayoutMetrics.bodyPaddingVerticalPx,
		[checklistLayoutMetrics, stableLinkPreviewHeightPx]
	);
	const collapsedAvailableLineBudget = React.useMemo(
		() => Math.max(0, Math.floor((effectiveMaxCardHeightPx - checklistFixedChromePx - checklistLayoutMetrics.completedBaseHeightPx) / collapsedChecklistLineHeightPx)),
		[collapsedChecklistLineHeightPx, checklistFixedChromePx, checklistLayoutMetrics.completedBaseHeightPx, effectiveMaxCardHeightPx]
	);
	const collapsedActiveFit = React.useMemo(
		() => fitChecklistItemsToLineBudget(activeChecklistItems, collapsedAvailableLineBudget),
		[activeChecklistItems, collapsedAvailableLineBudget, fitChecklistItemsToLineBudget]
	);
	const collapsedActiveBodyContentHeightPx = React.useMemo(() => {
		const estimatedBodyContentHeightPx = collapsedActiveFit.usedLineCount * collapsedChecklistLineHeightPx;
		const measuredBodyContentHeightPx = Math.max(
			0,
			checklistLayoutMetrics.bodyScrollHeightPx - checklistLayoutMetrics.bodyPaddingVerticalPx
		);
		// Trust the live rendered body height outright once it exists — it describes
		// exactly the same set of items the estimate above is guessing at, just
		// measured instead of guessed, so it's strictly more accurate whichever
		// direction it differs. This used to Math.min() it against the estimate
		// (rationale: "multiline rows can otherwise reserve extra card height that
		// shows up as empty space beneath the completed-items rail" — i.e. only
		// trust the measurement when it's SMALLER). That direction-locked trust was
		// backwards for a case that rationale didn't anticipate: at low note-card
		// text-size scales, the per-line estimate (collapsedChecklistLineHeightPx)
		// keeps shrinking with scale, but real rows bottom out at the fixed-size
		// checkbox's own height (~20px, not scaled by font at all) well before the
		// estimate does — so the estimate becomes SMALLER than the real, measured
		// content at low scale. Math.min() then picked the too-small estimate,
		// under-budgeting the card's total height by exactly that shortfall — with
		// nowhere else to absorb it, completedSection got pushed past
		// contentRegion's own overflow:hidden boundary (confirmed via direct
		// Playwright DOM measurement: contentRegion.bottom sat ~4-28px above
		// completedSection's real bottom edge, growing worse the lower the scale).
		if (measuredBodyContentHeightPx > 0) return measuredBodyContentHeightPx;
		return estimatedBodyContentHeightPx;
	}, [
		checklistLayoutMetrics.bodyPaddingVerticalPx,
		checklistLayoutMetrics.bodyScrollHeightPx,
		collapsedActiveFit.usedLineCount,
		collapsedChecklistLineHeightPx,
	]);
	// Soft cap, hard floor: effectiveMaxCardHeightPx is a *target*, not a promise —
	// collapsedAvailableLineBudget above already reduces active items (down to zero)
	// to try to hit it, and in the overwhelming majority of real checklists that's
	// enough. But chrome (header/banner, meta chips, the full URL preview, the
	// completed-items toggle, reserved menu/dock padding) is never allowed to
	// flex, and when it alone — even with zero active items shown — doesn't fit
	// under the cap, clamping down here would just silently clip the preview via
	// the card's own overflow:hidden (it's last in flex order). So the floor
	// (chrome, uncompressible) always wins over the cap; only the amount ABOVE
	// that floor gets capped. This only grows the card past the target in that
	// genuinely rare case — every normal case still resolves to the same value
	// as before, since collapsedAvailableLineBudget already targeted the cap.
	const collapsedChecklistMandatoryFloorPx = React.useMemo(
		() => checklistFixedChromePx + checklistLayoutMetrics.completedBaseHeightPx,
		[checklistFixedChromePx, checklistLayoutMetrics.completedBaseHeightPx]
	);
	// Deliberately NOT Math.min(effectiveMaxCardHeightPx, ...) anymore. That was
	// quietly reintroducing exactly the clip this whole "hard floor" policy exists
	// to prevent, and it took a live-DevTools session with the user actually
	// hovering a card to catch it, because the bug only shows up once you already
	// believe the floor is safe. collapsedActiveBodyContentHeightPx trusts the
	// LIVE measured body height once one exists (see that memo's own comment —
	// added to fix a different, earlier font-scale under-estimate bug), but the
	// item COUNT shown was already decided by collapsedAvailableLineBudget using
	// the *per-line estimate*, not this measurement. Two different numbers,
	// deciding two different things, that everyone assumed agreed with each
	// other. When real rendering comes in even slightly taller than the estimate
	// assumed — measured on a real card: 8 short single-line items came in at
	// ~227px of real body height against the ~168px the estimate had budgeted for
	// them, a gap that compounds per item — floor + the REAL content can exceed
	// effectiveMaxCardHeightPx even though the item count was already trimmed
	// toward it. Re-clamping to the cap right here silently ate that difference
	// via the card's own overflow:hidden. Direct measurement caught it in the
	// act: a card that needed 390px total was rendering at the 380px cap, and the
	// missing 10px was exactly the completed-toggle row — the "hidden behind the
	// dock" bug, explained in full. Once the item count is decided, whatever real
	// height it turns out to need gets honored in full. The cap already did its
	// job at the item-count budget; it doesn't get a second bite here.
	const collapsedChecklistMinHeightPx = React.useMemo(
		() => collapsedChecklistMandatoryFloorPx + collapsedActiveBodyContentHeightPx,
		[collapsedChecklistMandatoryFloorPx, collapsedActiveBodyContentHeightPx]
	);
	const expandedAvailableLineBudget = React.useMemo(
		() => Math.max(0, Math.floor((effectiveMaxCardHeightPx - checklistFixedChromePx - checklistLayoutMetrics.completedBaseHeightPx) / collapsedChecklistLineHeightPx)),
		[collapsedChecklistLineHeightPx, checklistFixedChromePx, checklistLayoutMetrics.completedBaseHeightPx, effectiveMaxCardHeightPx]
	);
	const totalActiveChecklistLineCost = React.useMemo(() => {
		if (type !== 'checklist') return 0;
		let total = 0;
		for (const item of activeChecklistItems) total += checklistItemLineCost(item.id);
		return total;
	}, [activeChecklistItems, checklistItemLineCost, type]);
	const expandedActiveFit = React.useMemo(
		() => totalActiveChecklistLineCost <= expandedAvailableLineBudget
			? { visible: activeChecklistItems.slice(), hiddenCount: 0, usedLineCount: totalActiveChecklistLineCost }
			: fitChecklistItemsToLineBudget(activeChecklistItems, expandedAvailableLineBudget),
		[activeChecklistItems, expandedAvailableLineBudget, fitChecklistItemsToLineBudget, totalActiveChecklistLineCost]
	);
	const expandedActiveContentFit = React.useMemo(
		() => keepCompletedToggleStable ? collapsedActiveFit : expandedActiveFit,
		[collapsedActiveFit, expandedActiveFit, keepCompletedToggleStable]
	);
	const activeChecklistItemsToRender = showCompleted ? expandedActiveContentFit.visible : collapsedActiveFit.visible;
	const hiddenActiveChecklistCountToRender = showCompleted ? expandedActiveContentFit.hiddenCount : collapsedActiveFit.hiddenCount;
	const expandedActiveLineCost = React.useMemo(() => {
		if (type !== 'checklist') return 0;
		return expandedActiveContentFit.usedLineCount;
	}, [expandedActiveContentFit.usedLineCount, type]);
	const expandedActiveBodyContentHeightPx = React.useMemo(() => {
		if (keepCompletedToggleStable) return collapsedActiveBodyContentHeightPx;
		return expandedActiveLineCost * collapsedChecklistLineHeightPx;
	}, [
		collapsedActiveBodyContentHeightPx,
		collapsedChecklistLineHeightPx,
		expandedActiveLineCost,
		keepCompletedToggleStable,
	]);
	const visibleCompletedRows = React.useMemo(() => {
		return selectVisibleCompletedRows(Math.max(0, expandedAvailableLineBudget - expandedActiveLineCost));
	}, [expandedActiveLineCost, expandedAvailableLineBudget, selectVisibleCompletedRows]);
	const hiddenCompletedChecklistCount = Math.max(
		0,
		completedChecklistItems.length - visibleCompletedRows.filter((row) => row.kind === 'item').length
	);
	const checklistLayoutSignature = React.useMemo(() => {
		if (type !== 'checklist') return '';
		const itemsSignature = normalizedItems
			.map((item) => `${item.id}:${item.completed ? 1 : 0}:${item.parentId ?? ''}:${item.text.length}:${item.countValue ?? ''}`)
			.join('|');
		const completedSignature = visibleCompletedRows.map((row) => `${row.kind}:${row.item.id}`).join('|');
		return [
			itemsSignature,
			showCompleted ? '1' : '0',
			hiddenActiveChecklistCountToRender,
			hiddenCompletedChecklistCount,
			completedSignature,
		].join('::');
	}, [hiddenActiveChecklistCountToRender, hiddenCompletedChecklistCount, normalizedItems, showCompleted, type, visibleCompletedRows]);
	const expandedChecklistMinHeightPx = React.useMemo(() => {
		if (type !== 'checklist') return maxCardHeightPx;
		let completedLineCost = 0;
		for (const row of visibleCompletedRows) {
			completedLineCost += row.kind === 'ghost' ? 1 : checklistItemLineCost(row.item.id);
		}
		if (hiddenCompletedChecklistCount > 0) completedLineCost += 1;
		return checklistFixedChromePx + checklistLayoutMetrics.completedBaseHeightPx + expandedActiveBodyContentHeightPx + completedLineCost * collapsedChecklistLineHeightPx;
	}, [checklistFixedChromePx, checklistItemLineCost, checklistLayoutMetrics.completedBaseHeightPx, collapsedChecklistLineHeightPx, expandedActiveBodyContentHeightPx, hiddenCompletedChecklistCount, maxCardHeightPx, type, visibleCompletedRows]);
	const expandedChecklistRenderedHeightPx = React.useMemo(() => {
		if (!showCompleted) return 0;
		return Math.max(
			checklistLayoutMetrics.renderedCardScrollHeightPx,
			checklistLayoutMetrics.headerHeightPx + checklistLayoutMetrics.metaHeightPx + checklistLayoutMetrics.contentRegionScrollHeightPx + checklistLayoutMetrics.cardPaddingBottomPx
		);
	}, [checklistLayoutMetrics, showCompleted]);
	React.useEffect(() => {
		if (type !== 'checklist') return;
		requestChecklistLayoutRefresh();
	}, [checklistLayoutSignature, requestChecklistLayoutRefresh, type]);
	const expandedChecklistMaxHeightPx = Math.max(maxCardHeightPx, expandedChecklistMinHeightPx, expandedChecklistRenderedHeightPx);
	// When either checklist CSS height variable changes, the card's rendered height
	// changes without necessarily changing card.scrollHeight. Fire the grid refresh in
	// a layout effect so NoteGrid re-measures after the new CSS vars are committed,
	// not against the stale pre-commit height.
	React.useLayoutEffect(() => {
		if (type !== 'checklist') return;
		requestChecklistLayoutRefresh();
	}, [collapsedChecklistMinHeightPx, expandedChecklistMaxHeightPx, requestChecklistLayoutRefresh, type]);
	const cardStyle = React.useMemo(() => {
		const nextStyle: NoteCardStyle = {};
		if (displayedCardColors) {
			nextStyle['--note-color-card-bg'] = displayedCardColors.cardBackground;
			nextStyle['--note-color-header-bg'] = displayedCardColors.headerBackground;
			nextStyle['--note-color-border'] = displayedCardColors.borderColor;
			nextStyle['--note-color-text'] = displayedCardColors.textColor;
			nextStyle['--note-color-muted'] = displayedCardColors.mutedTextColor;
			nextStyle['--note-color-accent'] = displayedCardColors.accentColor;
		}
		if (headerBannerTitleColors?.backgroundColor) {
			nextStyle['--note-card-banner-highlight'] = headerBannerTitleColors.backgroundColor;
		} else if (resolvedColor?.accentColor) {
			nextStyle['--note-card-banner-highlight'] = resolvedColor.accentColor;
		}
		if (type === 'checklist' && !showLinkedDrawingPreview && !showImageGridPreview) {
			nextStyle['--note-card-collapsed-checklist-height'] = `${collapsedChecklistMinHeightPx}px`;
			nextStyle['--note-card-expanded-checklist-max-height'] = `${expandedChecklistMaxHeightPx}px`;
		}
		if (menuReservedHeightPx !== null) {
			nextStyle['--note-card-menu-reserved-height'] = `${menuReservedHeightPx}px`;
		}
		if (type === 'drawing' && drawingThumbnailAspectRatio !== null && Number.isFinite(drawingThumbnailAspectRatio) && drawingThumbnailAspectRatio > 0) {
			nextStyle['--note-card-drawing-aspect-ratio'] = String(drawingThumbnailAspectRatio);
		}
		if (Number.isFinite(Number(props.forcedHeightPx)) && Number(props.forcedHeightPx) > 0) {
			const forcedHeightPx = `${Math.round(Number(props.forcedHeightPx))}px`;
			nextStyle.height = forcedHeightPx;
			nextStyle.maxHeight = forcedHeightPx;
			nextStyle.minHeight = forcedHeightPx;
		}
		return Object.keys(nextStyle).length > 0 ? nextStyle : undefined;
	}, [collapsedChecklistMinHeightPx, displayedCardColors, drawingThumbnailAspectRatio, expandedChecklistMaxHeightPx, headerBannerTitleColors?.backgroundColor, menuReservedHeightPx, props.forcedHeightPx, resolvedColor?.accentColor, showImageGridPreview, showLinkedDrawingPreview, type]);
	const textPreviewStyle = React.useMemo(() => {
		if (type !== 'text') return undefined;
		if (!Number.isFinite(Number(textPreviewLayout.maxHeightPx)) || !textPreviewLayout.maxHeightPx || textPreviewLayout.maxHeightPx <= 0) return undefined;
		return { maxHeight: `${Math.floor(textPreviewLayout.maxHeightPx)}px` } as React.CSSProperties;
	}, [textPreviewLayout.maxHeightPx, type]);
	React.useEffect(() => {
		if (completedChecklistItems.length > 0 || !showCompleted) return;
		setNoteCardCompletedExpanded(props.noteId, false);
		requestChecklistLayoutRefresh();
	}, [completedChecklistItems.length, props.noteId, requestChecklistLayoutRefresh, showCompleted]);

	const toggleNoteCardChecklistItem = React.useCallback((id: string, checked: boolean): void => {
		if (!canEdit) return;
		// Apply the shared parent/child completion rules (which also stamps
		// completedAt for anything becoming completed — see
		// toggleChecklistItemCompleted in checklistHierarchy.ts), then only
		// write the rows whose completion state actually changed back into Yjs.
		const nextItems = toggleChecklistItemCompleted(normalizedItems, id, checked);
		for (const item of nextItems) {
			const previous = normalizedItems.find((entry) => entry.id === item.id);
			if (!previous || previous.completed === item.completed) continue;
			updateChecklistItemById(checklistArray, item.id, {
				completed: item.completed,
				completedAt: item.completed ? (item.completedAt ?? Date.now()) : null,
			});
		}
	}, [canEdit, checklistArray, normalizedItems]);

	React.useLayoutEffect(() => {
		if (type !== 'checklist') return;
		// Checklist line wrapping changes when the card width, viewport, or
		// completed-section height changes, so remeasure on those layout signals.
		measureChecklistTextLayout();
		if (typeof ResizeObserver === 'undefined' || typeof window === 'undefined') return;

		let frameId = 0;
		const scheduleMeasure = (): void => {
			if (frameId) window.cancelAnimationFrame(frameId);
			frameId = window.requestAnimationFrame(() => {
				frameId = 0;
				measureChecklistTextLayout();
			});
		};

		const observer = new ResizeObserver(() => scheduleMeasure());
		if (cardRef.current) observer.observe(cardRef.current);
		if (contentRegionRef.current) observer.observe(contentRegionRef.current);
		if (bodyRef.current) observer.observe(bodyRef.current);
		if (checklistRef.current) observer.observe(checklistRef.current);
		if (completedSectionRef.current) observer.observe(completedSectionRef.current);

		const viewport = window.visualViewport;
		window.addEventListener('resize', scheduleMeasure);
		viewport?.addEventListener('resize', scheduleMeasure);

		return () => {
			if (frameId) window.cancelAnimationFrame(frameId);
			observer.disconnect();
			window.removeEventListener('resize', scheduleMeasure);
			viewport?.removeEventListener('resize', scheduleMeasure);
		};
	}, [measureChecklistTextLayout, normalizedItems, showCompleted, type]);

	React.useLayoutEffect(() => {
		if (type !== 'text' || showLinkedDrawingPreview || showImageGridPreview) {
			setTextPreviewLayout((previous) => previous.maxHeightPx === null && !previous.isOverflowing
				? previous
				: { maxHeightPx: null, isOverflowing: false });
			return;
		}
		if (typeof ResizeObserver === 'undefined' || typeof window === 'undefined') return;

		let frameId = 0;
		const measure = (): void => {
			const card = cardRef.current;
			const body = bodyRef.current;
			const preview = contentPreviewRef.current;
			if (!card || !body || !preview) return;
			if (!isElementLayoutMeasurable(card)) return;

			// Measure with the preview's current clamp temporarily removed so content
			// height is always based on the natural rich-text flow.
			const previousInlineMaxHeight = preview.style.maxHeight;
			if (previousInlineMaxHeight) {
				preview.style.maxHeight = '';
			}
			const fullContentHeightPx = Math.ceil(preview.scrollHeight);
			if (previousInlineMaxHeight) {
				preview.style.maxHeight = previousInlineMaxHeight;
			}

			const cardStyle = window.getComputedStyle(card);
			const bodyStyle = window.getComputedStyle(body);
			const headerHeightPx = headerRef.current?.offsetHeight ?? 0;
			const metaHeightPx = metaChipRowRef.current?.offsetHeight ?? 0;
			// Stable, count-derived upper bound rather than the rail's live measured
			// height — same reasoning as checklistFixedChromePx above: NoteLinkPanel's
			// data can still be mid-hydration for several seconds after mount, and
			// using the live height here would re-clamp (or un-clamp) this preview
			// every time a preview's real title/description text lands.
			const cardPaddingBottomPx = Number.parseFloat(cardStyle.paddingBottom || '0') || 0;
			const bodyPaddingVerticalPx =
				(Number.parseFloat(bodyStyle.paddingTop || '0') || 0) +
				(Number.parseFloat(bodyStyle.paddingBottom || '0') || 0);
			const availableHeightPx = Math.floor(
				maxCardHeightPx - headerHeightPx - metaHeightPx - stableLinkPreviewHeightPx - cardPaddingBottomPx - bodyPaddingVerticalPx
			);

			if (availableHeightPx <= 0 || fullContentHeightPx <= availableHeightPx + 1) {
				setTextPreviewLayout((previous) => previous.maxHeightPx === null && !previous.isOverflowing
					? previous
					: { maxHeightPx: null, isOverflowing: false });
				return;
			}

			const fontSizePx = Number.parseFloat(bodyStyle.fontSize || '0') || 16;
			const parsedLineHeightPx = Number.parseFloat(bodyStyle.lineHeight || '0') || 0;
			const lineHeightPx = parsedLineHeightPx > 0 ? parsedLineHeightPx : fontSizePx * 1.35;
			const blockElements = Array.from(preview.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
			let lastFullyVisibleBlockBottomPx = 0;
			for (const block of blockElements) {
				const blockBottomPx = Math.ceil(block.offsetTop + block.offsetHeight);
				if (blockBottomPx <= availableHeightPx + 0.5) {
					lastFullyVisibleBlockBottomPx = blockBottomPx;
					continue;
				}
				break;
			}

			const lineAlignedHeightPx = lineHeightPx > 0
				? Math.floor(availableHeightPx / lineHeightPx) * lineHeightPx
				: availableHeightPx;
			const fallbackHeightPx = Math.max(
				1,
				lineAlignedHeightPx > 0 ? Math.min(availableHeightPx, Math.floor(lineAlignedHeightPx)) : availableHeightPx
			);
			const resolvedMaxHeightPx = blockElements.length > 1 && lastFullyVisibleBlockBottomPx > 0
				// Rich clipboard HTML often becomes multiple top-level blocks. If the
				// next block is tall, clamping to the previous block boundary alone can
				// squash the card down to a single short paragraph. Keep the safer
				// line-aligned fallback whenever it uses more of the available height.
				? Math.min(availableHeightPx, Math.max(lastFullyVisibleBlockBottomPx, fallbackHeightPx))
				: fallbackHeightPx;

			setTextPreviewLayout((previous) => {
				if (previous.isOverflowing && previous.maxHeightPx !== null && Math.abs(previous.maxHeightPx - resolvedMaxHeightPx) < 0.5) {
					return previous;
				}
				return { maxHeightPx: resolvedMaxHeightPx, isOverflowing: true };
			});
		};

		const scheduleMeasure = (): void => {
			if (frameId) window.cancelAnimationFrame(frameId);
			frameId = window.requestAnimationFrame(() => {
				frameId = 0;
				recordHeadingCollapseDebug('resizeObserver', { noteId: props.noteId, surface: 'text-preview' });
				measure();
			});
		};

		// Run the first overflow measurement before paint so the bottom fade does
		// not visibly appear a frame after a warm snapshot card mounts.
		measure();
		const observer = new ResizeObserver(() => scheduleMeasure());
		if (cardRef.current) observer.observe(cardRef.current);
		if (contentRegionRef.current) observer.observe(contentRegionRef.current);
		if (bodyRef.current) observer.observe(bodyRef.current);
		if (contentPreviewRef.current) observer.observe(contentPreviewRef.current);
		window.addEventListener('resize', scheduleMeasure);
		const viewport = window.visualViewport;
		viewport?.addEventListener('resize', scheduleMeasure);

		return () => {
			if (frameId) window.cancelAnimationFrame(frameId);
			observer.disconnect();
			window.removeEventListener('resize', scheduleMeasure);
			viewport?.removeEventListener('resize', scheduleMeasure);
		};
	}, [content, maxCardHeightPx, richContent, showImageGridPreview, showLinkedDrawingPreview, stableLinkPreviewHeightPx, type]);

	React.useLayoutEffect(() => {
		if (type !== 'checklist') return;
		if (typeof ResizeObserver === 'undefined' || typeof window === 'undefined') return;

		let frameId = 0;
		const measure = (): void => {
			const card = cardRef.current;
			const contentRegion = contentRegionRef.current;
			const body = bodyRef.current;
			const toggle = completedToggleRef.current;
			const completed = completedSectionRef.current;
			if (!card || !contentRegion || !body || !toggle || !completed) return;
			if (!isElementLayoutMeasurable(card)) return;
			const cardStyle = window.getComputedStyle(card);
			const bodyStyle = window.getComputedStyle(body);
			const completedStyle = window.getComputedStyle(completed);
			const nextMetrics = {
				headerHeightPx: headerRef.current?.offsetHeight ?? 0,
				metaHeightPx: metaChipRowRef.current?.offsetHeight ?? 0,
				linkPreviewHeightPx: linkPreviewRailRef.current && linkPreviewRailRef.current.childElementCount > 0 ? linkPreviewRailRef.current.offsetHeight : 0,
				completedBaseHeightPx:
					toggle.offsetHeight +
						(Number.parseFloat(completedStyle.paddingTop || '0') || 0) +
						(Number.parseFloat(completedStyle.paddingBottom || '0') || 0) +
						(Number.parseFloat(completedStyle.borderTopWidth || '0') || 0),
				cardPaddingBottomPx: Number.parseFloat(cardStyle.paddingBottom || '0') || 0,
				bodyPaddingVerticalPx:
					(Number.parseFloat(bodyStyle.paddingTop || '0') || 0) +
					(Number.parseFloat(bodyStyle.paddingBottom || '0') || 0),
				bodyScrollHeightPx: Math.ceil(body.scrollHeight),
				renderedCardScrollHeightPx: Math.ceil(card.scrollHeight),
				contentRegionScrollHeightPx: Math.ceil(contentRegion.scrollHeight),
			};
			setChecklistLayoutMetrics((previous) => {
				const changed = Object.entries(nextMetrics).some(([key, value]) => Math.abs((previous as Record<string, number>)[key] - value) > 0.5);
				if (!changed) return previous;
				requestChecklistLayoutRefresh();
				return nextMetrics;
			});
		};

		const scheduleMeasure = (): void => {
			if (frameId) window.cancelAnimationFrame(frameId);
			frameId = window.requestAnimationFrame(() => {
				frameId = 0;
				measure();
			});
		};

		// Run synchronously on first commit so CSS vars are set before the browser
		// paints - avoids a visible gap when the initial estimate is slightly off.
		measure();
		const observer = new ResizeObserver(() => scheduleMeasure());
		if (cardRef.current) observer.observe(cardRef.current);
		if (headerRef.current) observer.observe(headerRef.current);
		if (metaChipRowRef.current) observer.observe(metaChipRowRef.current);
		if (bodyRef.current) observer.observe(bodyRef.current);
		if (completedSectionRef.current) observer.observe(completedSectionRef.current);
		if (completedToggleRef.current) observer.observe(completedToggleRef.current);
		if (linkPreviewRailRef.current) observer.observe(linkPreviewRailRef.current);
		if (footerRef.current) observer.observe(footerRef.current);
		window.addEventListener('resize', scheduleMeasure);
		const viewport = window.visualViewport;
		viewport?.addEventListener('resize', scheduleMeasure);

		return () => {
			if (frameId) window.cancelAnimationFrame(frameId);
			observer.disconnect();
			window.removeEventListener('resize', scheduleMeasure);
			viewport?.removeEventListener('resize', scheduleMeasure);
		};
	}, [requestChecklistLayoutRefresh, showCompleted, type, !!props.metaChips]);

	// Pointer tracking distinguishes tap-to-open from drag/move gestures.
	const pointerDownRef = React.useRef<{ x: number; y: number; moved: boolean; pointerId: number } | null>(null);
	const suppressGestureOpenRef = React.useRef(false);
	// Long-press timer: fires the more-menu after 400ms without movement on touch devices.
	const longPressTimerRef = React.useRef<number>(0);
	const longPressFiredRef = React.useRef(false);

	const clearLongPressTimer = React.useCallback((): void => {
		if (longPressTimerRef.current) {
			window.clearTimeout(longPressTimerRef.current);
			longPressTimerRef.current = 0;
		}
	}, []);

	const tryOpen = React.useCallback((): void => {
		if (!props.onOpen) return;
		if (props.shouldSuppressOpen?.()) return;
		props.onOpen();
	}, [props]);

	const toggleCompletedSection = React.useCallback((): void => {
		// No local setState to drive this off anymore — showCompleted comes from
		// useSyncExternalStore now, so read the store's current value directly and
		// write the flip straight back to it; the subscription updates this (and
		// every other mounted card showing the same note) reactively.
		const next = !getNoteCardCompletedExpanded(props.noteId);
		setNoteCardCompletedExpanded(props.noteId, next);
		void updateUserPreferences(getDeviceId(), {
			noteCardCompletedExpandedPatch: { noteId: props.noteId, expanded: next },
		});
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('freemannotes:checklist-toggle', {
				detail: {
					noteId: props.noteId,
					expanded: next,
				},
			}));
		}
		requestChecklistLayoutRefresh();
	}, [props.noteId, requestChecklistLayoutRefresh]);

	const handleReminderAction = React.useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
		event.stopPropagation();
		if (!canEdit) return;
		props.onAddReminder?.();
	}, [canEdit, props]);

	const handleDockAction = React.useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
		// Placeholder — stops propagation so the card doesn't open underneath.
		event.stopPropagation();
	}, []);

	const handlePaletteAction = React.useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
		event.stopPropagation();
		if (!canEdit) return;
		setIsColorPickerOpen(true);
	}, [canEdit]);

	const handleColorSelect = React.useCallback((token: Parameters<typeof saveUserNoteColorToken>[2]): void => {
		saveUserNoteColorToken(getDeviceId(), props.noteId, token);
		setIsColorPickerOpen(false);
	}, [props.noteId]);

	const handleAddCollaborator = React.useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
		event.stopPropagation();
		if (!canEdit) return;
		props.onAddCollaborator?.();
	}, [canEdit, props]);

	const handleAddImage = React.useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
		event.stopPropagation();
		if (!canEdit) return;
		props.onAddImage?.();
	}, [canEdit, props]);

	const handleMoreMenuAction = React.useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
		event.stopPropagation();
		const cardRect = cardRef.current?.getBoundingClientRect();
		const footerRect = footerRef.current?.getBoundingClientRect();
		const triggerRect = event.currentTarget.getBoundingClientRect();
		// Card-triggered menus anchor to the card's left edge while using the
		// trigger/footer band for vertical placement so the desktop popover lines up
		// with the card instead of snapping tightly to the ellipsis button.
		props.onMoreMenu?.(
			cardRect
				? {
					top: footerRect?.top ?? triggerRect.top,
					left: cardRect.left,
					width: cardRect.width,
					height: footerRect?.height ?? triggerRect.height,
				}
				: null
		);
		event.currentTarget.blur();
	}, [props]);

	const handleRestoreAction = React.useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
		event.stopPropagation();
		props.onRestoreNote?.();
	}, [props]);
	const renderInteractiveShell = preserveControlShell && !canEdit;
	const disablePaletteAction = !renderInteractiveShell && !canEdit;
	const disableReminderAction = !props.onAddReminder || (!renderInteractiveShell && !canEdit);
	const disableCollaboratorAction = !props.onAddCollaborator || (!renderInteractiveShell && !canEdit);
	const disableImageAction = !props.onAddImage || (!renderInteractiveShell && !canEdit);
	// The floating corner ellipsis is touch-only; fine-pointer desktops reopen the
	// same menu from the footer dock so the card body stays visually cleaner.
	// (hasMenuButton, the *MenuSafeRegion booleans, isCompletedSectionAdjacentToPreview,
	// and menuReservedHeightPx are all declared earlier in this component — see
	// extractedLinks's declaration — since cardStyle's useMemo needs
	// menuReservedHeightPx as a dependency before this point is reached.)
	const disableChecklistCheckbox = !allowChecklistItemInteractions;
	const disableCompletedChecklistCheckbox = !allowCompletedItemInteractions;
	const headerTitleValue = title.trim().length > 0 ? title : t('note.untitled');
	const headerTitleRow = headerBannerUrl ? (
		<div className={styles.headerBannerTitleRow} style={headerBannerTitleStyle}>
			<span className={styles.headerTitle} title={headerTitleValue}>
				{headerTitleValue}
			</span>
			<div className={styles.headerBadges}>
				{props.isPinned ? (
					<span aria-label={t('noteMenu.pinNote')} title={t('noteMenu.pinNote')} className={styles.pinBadge}>
						<FontAwesomeIcon icon={faThumbtack} />
					</span>
				) : null}
				{reminderAt ? (
					<span aria-label={reminderLabel || t('note.addReminder')} title={reminderLabel || t('note.addReminder')} className={reminderBadgeClassName}>
						<FontAwesomeIcon icon={faBell} />
					</span>
				) : null}
				{props.hasPendingSync ? (
					<span aria-label={t('note.pendingSync')} title={t('note.pendingSync')} className={styles.pendingSync}>
						↻
					</span>
				) : null}
			</div>
		</div>
	) : null;

	return (
		<article
			ref={cardRef}
			className={`${styles.card}${showLinkedDrawingPreview || showImageGridPreview ? ` ${styles.mediaPreviewCard}` : ''}${type === 'checklist' && !showLinkedDrawingPreview && !showImageGridPreview ? ` ${styles.checklistCard}` : ''}${type === 'checklist' && !showLinkedDrawingPreview && !showImageGridPreview && (!showCompleted || completedChecklistItems.length === 0) ? ` ${styles.checklistCardCollapsed}` : ''}${type === 'checklist' && !showLinkedDrawingPreview && !showImageGridPreview && showCompleted && completedChecklistItems.length > 0 ? ` ${styles.checklistCardCompletedExpanded}` : ''}${props.isMoreMenuOpen ? ` ${styles.moreMenuOpen}` : ''}${props.isTrashView ? ` ${styles.trashCard}` : ''}${headerBannerUrl ? ` ${styles.cardWithBannerHighlight}` : ''}`}
			style={cardStyle}
			data-note-card="true"
			data-drag-handle={props.useWholeCardDragHandle ? 'true' : undefined}
			aria-label={`Note ${props.noteId}`}
			role={props.onOpen ? 'button' : undefined}
			tabIndex={props.onOpen ? 0 : undefined}
			onPointerDown={(e) => {
				// Track initial point; open action is decided on pointer up if movement stayed small.
				if (!props.onOpen && !props.onMoreMenu) return;
				if (isInteractiveTarget(e.target)) return;
				suppressGestureOpenRef.current = false;
				if (e.pointerType === 'touch' || isCoarsePointerDevice()) {
					const now = Date.now();
					const gestureRecentlyClaimed = activeTouchOpenGesturePointerId !== null && (now - activeTouchOpenGestureStartedAt) < 700;
					if (gestureRecentlyClaimed && activeTouchOpenGesturePointerId !== e.pointerId) {
						suppressGestureOpenRef.current = true;
						pointerDownRef.current = null;
						clearLongPressTimer();
						return;
					}
					activeTouchOpenGesturePointerId = e.pointerId;
					activeTouchOpenGestureStartedAt = now;
				}
				// If the touch started on the drag handle, let pragmatic-drag-and-drop
				// own the gesture instead of capturing it at the card root.
				const target = e.target as HTMLElement | null;
				const isDragHandle = Boolean(target?.closest('[data-drag-handle="true"]'));
				// Touch/coarse branch: capture the pointer so this interaction stays
				// bound to the card element even if the editor overlay mounts before
				// compatibility events are delivered.
				if (!isDragHandle && (e.pointerType === 'touch' || isCoarsePointerDevice()) && typeof e.currentTarget.setPointerCapture === 'function') {
					try {
						e.currentTarget.setPointerCapture(e.pointerId);
					} catch {
						// Ignore browsers/devices that reject capture for this pointer.
					}
				}
				pointerDownRef.current = {
					x: e.clientX,
					y: e.clientY,
					moved: false,
					pointerId: e.pointerId,
				};
				longPressFiredRef.current = false;
				clearLongPressTimer();
			}}
			onPointerMove={(e) => {
				// Mark as moved beyond threshold to suppress accidental open during drag/scroll.
				if (suppressGestureOpenRef.current) return;
				const state = pointerDownRef.current;
				if (!state) return;
				if (state.pointerId !== e.pointerId) return;
				const dx = e.clientX - state.x;
				const dy = e.clientY - state.y;
				// Allow a bit of natural finger drift during long-press so mobile
				// users don't have to hold perfectly still to open the menu.
				if (dx * dx + dy * dy > 144) {
					state.moved = true;
					clearLongPressTimer();
				}
			}}
			onPointerUp={(e) => {
				// Treat as click/tap only if the pointer did not move significantly.
				clearLongPressTimer();
				if (activeTouchOpenGesturePointerId === e.pointerId) {
					activeTouchOpenGesturePointerId = null;
				}
				if (typeof e.currentTarget.releasePointerCapture === 'function' && e.currentTarget.hasPointerCapture(e.pointerId)) {
					try {
						e.currentTarget.releasePointerCapture(e.pointerId);
					} catch {
						// Ignore if the pointer wasn't captured.
					}
				}
				const state = pointerDownRef.current;
				pointerDownRef.current = null;
				if (suppressGestureOpenRef.current) {
					suppressGestureOpenRef.current = false;
					return;
				}
				if (!state) return;
				if (state.pointerId !== e.pointerId) return;
				if (state.moved) return;
				if (longPressFiredRef.current) return;
				if (isInteractiveTarget(e.target)) return;
				// Touch/coarse branch: the same physical tap can generate delayed
				// compatibility mouse events. We suppress them before opening so they
				// cannot retarget into the newly mounted editor controls.
				if (e.pointerType === 'touch' || isCoarsePointerDevice()) {
					if (e.cancelable) e.preventDefault();
					e.stopPropagation();
					suppressNextDocumentCompatibilityMouseEvents();
				}
				tryOpen();
			}}
			onPointerCancel={(e) => {
				// Cancellation branch: always release any capture to avoid pointer
				// lifecycle leaks that can affect subsequent gestures.
				clearLongPressTimer();
				if (activeTouchOpenGesturePointerId === e.pointerId) {
					activeTouchOpenGesturePointerId = null;
				}
				if (typeof e.currentTarget.releasePointerCapture === 'function' && e.currentTarget.hasPointerCapture(e.pointerId)) {
					try {
						e.currentTarget.releasePointerCapture(e.pointerId);
					} catch {
						// Ignore if the pointer wasn't captured.
					}
				}
				pointerDownRef.current = null;
				suppressGestureOpenRef.current = false;
			}}
			onTouchEnd={(e) => {
				// Guard kept for any future long-press gesture owner on this card path.
				if (longPressFiredRef.current) {
					e.preventDefault();
					// Consume this guard once so later taps (for example metadata chips)
					// are not blocked if they stop pointer-down propagation at the card root.
					longPressFiredRef.current = false;
				}
			}}
			onContextMenu={(e) => {
				// On coarse (touch) devices suppress the browser/OS context-menu
				// long-press gesture. We already handle long-press ourselves and
				// the OS fires its own haptic feedback when it detects the gesture,
				// which appears to the user as an unwanted second vibration.
				if (isCoarsePointerDevice()) {
					e.preventDefault();
				}
			}}
			onKeyDown={(e) => {
				if (!props.onOpen) return;
				if (e.currentTarget !== e.target) return;
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					tryOpen();
				}
			}}
		>
			<div
				className={`${styles.header}${noteBannerFile ? ` ${styles.headerWithBanner}` : ''}`}
				ref={handleHeaderRef}
				data-drag-handle="true"
				{...props.dragHandleProps}
				onClick={(e) => {
					// Drag-handle clicks should not bubble and open the note.
					e.stopPropagation();
				}}
			>
				{headerBannerUrl ? (
					headerTitleRow
				) : null}
				{headerBannerUrl ? (
					<div
						className={styles.headerBannerMedia}
						style={{
							...headerBannerPresentationStyle,
							order: bannerTitlePosition === 'above' ? 1 : 0,
						}}
					>
						<img className={styles.headerBannerImage} src={headerBannerUrl} alt="" aria-hidden="true" />
					</div>
				) : null}
				{headerBannerUrl ? null : (
					<>
						<span className={styles.headerTitle} title={headerTitleValue}>
							{headerTitleValue}
						</span>
						<div className={styles.headerBadges}>
							{props.isPinned ? (
								<span aria-label={t('noteMenu.pinNote')} title={t('noteMenu.pinNote')} className={styles.pinBadge}>
									<FontAwesomeIcon icon={faThumbtack} />
								</span>
							) : null}
							{reminderAt ? (
								<span aria-label={reminderLabel || t('note.addReminder')} title={reminderLabel || t('note.addReminder')} className={reminderBadgeClassName}>
									<FontAwesomeIcon icon={faBell} />
								</span>
							) : null}
							{props.hasPendingSync ? (
								<span aria-label={t('note.pendingSync')} title={t('note.pendingSync')} className={styles.pendingSync}>
									↻
								</span>
							) : null}
						</div>
					</>
				)}
			</div>

			{props.metaChips ? (
				<div
					ref={metaChipRowRef}
					className={styles.metaChipRow}
				>
					{props.metaChips}
				</div>
			) : null}

			{props.isTrashView && props.onRestoreNote ? (
				<div className={styles.trashRestoreRow}>
					<button
						type="button"
						className={styles.trashRestoreButton}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={handleRestoreAction}
						aria-label={t('noteMenu.restoreNote')}
					>
						<span className={styles.trashRestoreIcon} aria-hidden="true">
							<FontAwesomeIcon icon={faRotateLeft} />
						</span>
						<span>{t('noteMenu.restoreNote')}</span>
					</button>
				</div>
			) : null}

			<div ref={contentRegionRef} className={`${styles.contentRegion}${type === 'checklist' && !showLinkedDrawingPreview && !showImageGridPreview && showCompleted && completedChecklistItems.length > 0 ? ` ${styles.contentRegionCompletedExpanded}` : ''}`}>
				{suppressContentInteractions ? (
					<div
						className={styles.contentInteractionGuard}
						aria-hidden="true"
						onPointerDown={(event) => {
							if (event.cancelable) event.preventDefault();
							event.stopPropagation();
						}}
						onPointerUp={(event) => {
							if (event.cancelable) event.preventDefault();
							event.stopPropagation();
						}}
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
						}}
					/>
				) : null}
				{type === 'drawing' ? (
					/* Native drawing note: variable-height thumbnail showing the full drawing */
					<div ref={bodyRef} className={`${styles.body} ${styles.drawingBody}${isBodyMenuSafeRegion ? ` ${styles.bodyMenuSafe} ${styles.drawingBodyMenuSafe}` : ''}`} data-note-drag-manual="true">
						{drawingThumbnailUrl ? (
							<img
								className={styles.drawingThumbnail}
								src={drawingThumbnailUrl}
								alt=""
								draggable={false}
								onDragStart={(e) => e.preventDefault()}
							/>
						) : (
							<div className={styles.drawingThumbnailSkeleton} aria-hidden="true" />
						)}
					</div>
				) : showMediaPreview ? (
					/* Mixed media grid: drawing thumbnails (slot 0, 1) + image thumbnails, up to 4 total.
					   Cell count is fixed at render time so card height never oscillates on async loads. */
					<div ref={bodyRef} className={`${styles.body} ${styles.mediaImageBody}${isBodyMenuSafeRegion ? ` ${styles.bodyMenuSafe}` : ''}`} data-note-drag-manual="true">
						<div className={styles.mediaImageGrid}>
							{drawingSlots > 0 && linkedDrawingIds[0] ? (
								<div key={`d0-${linkedDrawingIds[0]}`} className={styles.mediaImageGridCell}>
									{linkedDrawingThumbnail0 ? (
										<img className={styles.mediaImageThumb} src={linkedDrawingThumbnail0} alt="" draggable={false} onDragStart={(e) => e.preventDefault()} />
									) : null}
								</div>
							) : null}
							{drawingSlots > 1 && linkedDrawingIds[1] ? (
								<div key={`d1-${linkedDrawingIds[1]}`} className={styles.mediaImageGridCell}>
									{linkedDrawingThumbnail1 ? (
										<img className={styles.mediaImageThumb} src={linkedDrawingThumbnail1} alt="" draggable={false} onDragStart={(e) => e.preventDefault()} />
									) : null}
								</div>
							) : null}
							{noteImages.slice(0, imageSlots).map((image) => (
								<div key={image.id} className={styles.mediaImageGridCell}>
									<img className={styles.mediaImageThumb} src={image.url} alt="" draggable={false} onDragStart={(e) => e.preventDefault()} />
								</div>
							))}
						</div>
					</div>
				) : type === 'text' ? (
					<div ref={bodyRef} className={`${styles.body}${isBodyMenuSafeRegion ? ` ${styles.bodyMenuSafe}` : ''}`} data-note-drag-manual="true">
						<div ref={contentPreviewRef} className={`${styles.contentPreview}${textPreviewLayout.isOverflowing ? ` ${styles.contentPreviewOverflowing}` : ''}`} style={textPreviewStyle}>{renderRichPreview(richContent, allowLinkInteractions, allowChecklistItemInteractions && canEdit ? handleToggleRichTaskItem : undefined, props.noteId, deniedNoteIds, liveAvatarLookup) ?? content}</div>
					</div>
				) : (
					<>
						<div ref={bodyRef} className={`${styles.body}${isBodyMenuSafeRegion ? ` ${styles.bodyMenuSafe}` : ''}`} data-note-drag-manual="true">
							<ul ref={checklistRef} className={styles.checklist}>
								{activeChecklistItemsToRender.map((item) => (
									<li key={item.id} className={`${styles.checklistItem}${multilineById[item.id] ? ` ${styles.checklistItemMultiline}` : ''}${item.parentId ? ` ${styles.childItem}` : ''}`}>
										<span
											className={styles.checklistCheckboxHitArea}
											onPointerDown={allowChecklistItemInteractions ? (e) => e.stopPropagation() : undefined}
											onPointerUp={allowChecklistItemInteractions ? (e) => e.stopPropagation() : undefined}
											onClick={allowChecklistItemInteractions ? (e) => {
												e.stopPropagation();
												toggleNoteCardChecklistItem(item.id, !item.completed);
											} : undefined}
											aria-label={item.completed ? 'Completed' : 'Not completed'}
										>
											<input
												type="checkbox"
												className={styles.checklistCheckbox}
												checked={item.completed}
												disabled={disableChecklistCheckbox}
												readOnly
											/>
										</span>
										<div className={`${styles.checklistText}${clampedById[item.id] ? ` ${styles.checklistTextClamped}` : ''}`} data-checklist-text-id={item.id}>
											{renderChecklistCardContent(item, renderRichPreview(item.richContent ?? createRichTextDocFromPlainText(item.text), allowLinkInteractions, undefined, undefined, deniedNoteIds, liveAvatarLookup) ?? item.text)}
										</div>
									</li>
								))}
							</ul>
							{hiddenActiveChecklistCountToRender > 0 ? (
								<div className={`${styles.checklistMore} ${styles.activeChecklistMore}`}>+{hiddenActiveChecklistCountToRender} more</div>
							) : null}
						</div>

						{/* completedSectionMenuSafe's extra padding-bottom reservation is now
						    obsolete when the corner menu lives on the toggle row (see
						    completedToggleRow below) rather than overlaid past this section's
						    trailing edge — the icon is a true flex sibling now, so ordinary
						    layout already keeps it clear of everything without any reserved
						    space to get wrong. That reservation is only still needed, and only
						    still applied, in the with-preview case (isLinkPreviewMenuSafeRegion),
						    which still uses the original card-bottom-anchored button. */}
						<div ref={completedSectionRef} className={`${styles.completedSection}${isCompletedSectionAdjacentToPreview ? ` ${styles.completedSectionAdjacentToPreview}` : ''}`}>
							<div className={styles.completedToggleRow}>
							{allowCompletedItemInteractions ? (
								<button
									ref={completedToggleRef as React.RefObject<HTMLButtonElement>}
									type="button"
									className={styles.completedToggle}
									onPointerDown={(e) => e.stopPropagation()}
									onClick={(e) => {
										e.stopPropagation();
										if (completedChecklistItems.length <= 0) return;
										toggleCompletedSection();
									}}
									disabled={completedChecklistItems.length <= 0}
								>
										<span className={styles.completedToggleArrow} aria-hidden="true">
											<span className={`${styles.completedToggleArrowIcon}${showCompleted ? ` ${styles.completedToggleArrowIconOpen}` : ''}`} />
										</span>
									<span>{completedChecklistItems.length} {t('editors.completedItems')}</span>
								</button>
							) : (
								<div ref={completedToggleRef as React.RefObject<HTMLDivElement>} className={styles.completedToggle}>
										<span className={styles.completedToggleArrow} aria-hidden="true">
											<span className={`${styles.completedToggleArrowIcon}${showCompleted ? ` ${styles.completedToggleArrowIconOpen}` : ''}`} />
										</span>
									<span>{completedChecklistItems.length} {t('editors.completedItems')}</span>
								</div>
							)}
							{/* Rendered here instead of at the card's bottom edge specifically for
							    this case (checklist, no preview) — a true flex sibling of the toggle
							    row centers on it via ordinary align-items:center, tracking whatever
							    height the row actually renders at (font-scale, wrapped translated
							    text, etc.) with no computed offset to keep in sync. This also means
							    the icon's position is now identical whether the completed section is
							    collapsed or expanded, satisfying "always maintain its position" by
							    construction rather than by matching two independently-tuned values.
							    See isCompletedSectionMenuSafeRegion's own comment for why this is
							    scoped to exactly that case: a with-preview card still wants the icon
							    at the card's bottom edge, after the preview, not on the toggle row. */}
							{isCompletedSectionMenuSafeRegion ? (
								<button
									type="button"
									className={styles.cardMenuButtonInToggle}
									onPointerDown={(e) => e.stopPropagation()}
									onClick={handleMoreMenuAction}
									aria-label={t('editors.dockAction')}
								>
									<FontAwesomeIcon icon={faEllipsisVertical} />
								</button>
							) : null}
							</div>
							{showCompleted && completedChecklistItems.length > 0 ? (
								<div className={styles.completedDropdown}>
									<ul className={styles.checklist}>
										{visibleCompletedRows.map(({ kind, item }) => kind === 'ghost' ? (
											<li key={`ghost-${item.id}`} className={`${styles.checklistItem}${multilineById[item.id] ? ` ${styles.checklistItemMultiline}` : ''} ${styles.checklistGhostItem}`} aria-hidden="true">
												<span className={styles.checklistCheckboxHitArea}>
													<input type="checkbox" className={styles.checklistCheckbox} checked={false} disabled readOnly tabIndex={-1} />
												</span>
												<div className={styles.checklistText}>
													{renderChecklistCardContent(item, renderRichPreview(item.richContent ?? createRichTextDocFromPlainText(item.text), false, undefined, undefined, deniedNoteIds, liveAvatarLookup) ?? item.text)}
												</div>
											</li>
										) : (
											<li key={item.id} className={`${styles.checklistItem}${multilineById[item.id] ? ` ${styles.checklistItemMultiline}` : ''}${item.parentId ? ` ${styles.childItem}` : ''}`}>
												<span
													className={styles.checklistCheckboxHitArea}
													onPointerDown={allowCompletedItemInteractions ? (e) => e.stopPropagation() : undefined}
													onPointerUp={allowCompletedItemInteractions ? (e) => e.stopPropagation() : undefined}
													onClick={allowCompletedItemInteractions ? (e) => {
														e.stopPropagation();
														toggleNoteCardChecklistItem(item.id, !item.completed);
													} : undefined}
													aria-label={item.completed ? 'Completed' : 'Not completed'}
												>
													<input
														type="checkbox"
														className={styles.checklistCheckbox}
														checked={item.completed}
														disabled={disableCompletedChecklistCheckbox}
														readOnly
													/>
												</span>
												<div className={`${styles.checklistText} ${styles.checklistTextCompleted}${clampedById[item.id] ? ` ${styles.checklistTextClamped}` : ''}`} data-checklist-text-id={item.id}>
													{renderChecklistCardContent(item, renderRichPreview(item.richContent ?? createRichTextDocFromPlainText(item.text), allowLinkInteractions, undefined, undefined, deniedNoteIds, liveAvatarLookup) ?? item.text)}
												</div>
											</li>
										))}
									</ul>
									{hiddenCompletedChecklistCount > 0 ? (
										<div className={`${styles.checklistMore} ${styles.completedChecklistMore}`}>+{hiddenCompletedChecklistCount} completed items</div>
									) : null}
								</div>
							) : null}
						</div>
					</>
				)}

				{props.docId ? (
					<div ref={linkPreviewRailRef} className={`${styles.linkPreviewRail}${isLinkPreviewMenuSafeRegion ? ` ${styles.linkPreviewRailMenuSafe}` : ''}`}>
						<NoteLinkPanel docId={props.docId} authUserId={props.authUserId} fallbackLinks={extractedLinks} initialLinks={props.initialLinkRecords} canEdit={canEdit} onDeleteLink={handleDeletePreview} variant="rail" maxItems={noteCardLinkPreviewMaxItems} disableInitialRemoteRefresh disableOpenLinks={!allowLinkInteractions} />
					</div>
				) : null}
			</div>
				{hasMenuButton && !isCompletedSectionMenuSafeRegion ? (
					<button
						type="button"
						className={styles.cardMenuButton}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={handleMoreMenuAction}
						aria-label={t('editors.dockAction')}
					>
						<FontAwesomeIcon icon={faEllipsisVertical} />
					</button>
				) : null}
			<div ref={footerRef} className={`${styles.cardFooter}${suppressContentInteractions ? ` ${styles.cardFooterGuarded}` : ''}`}>
				{/* Desktop-only footer dock mirrors the editor action strip so note
				    cards and editors share the same action vocabulary. */}
				<nav className={styles.cardDock} aria-label={t('editors.bottomDock')}>
					<div className={styles.cardDockLeft}>
						{props.onMoreMenu ? (
							<button
								type="button"
								className={styles.cardDockButton}
								onPointerDown={(e) => e.stopPropagation()}
								onClick={handleMoreMenuAction}
								aria-label={t('editors.dockAction')}
							>
								<FontAwesomeIcon icon={faEllipsisVertical} />
							</button>
						) : null}
						<button
							type="button"
							className={styles.cardDockButton}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={handlePaletteAction}
							aria-label={t('noteColors.dialogTitle')}
							aria-disabled={!canEdit || undefined}
							disabled={disablePaletteAction}
						>
							<FontAwesomeIcon icon={faPalette} />
						</button>
						<button
							type="button"
							className={styles.cardDockButton}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={handleReminderAction}
							aria-label={t('note.addReminder')}
							aria-disabled={!canEdit || undefined}
							disabled={disableReminderAction}
						>
							<FontAwesomeIcon icon={faBell} />
						</button>
						<button
							type="button"
							className={styles.cardDockButton}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={handleAddCollaborator}
							aria-label={t('editors.dockAction')}
							aria-disabled={!canEdit || undefined}
							disabled={disableCollaboratorAction}
						>
							<FontAwesomeIcon icon={faUserPlus} />
						</button>
						<button
							type="button"
							className={styles.cardDockButton}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={props.onAddImage ? handleAddImage : handleDockAction}
							aria-label={t('editors.dockAction')}
							aria-disabled={!canEdit || undefined}
							disabled={disableImageAction}
						>
							<FontAwesomeIcon icon={faImage} />
						</button>
					</div>
				</nav>
			</div>
			<NoteColorPickerModal
				isOpen={isColorPickerOpen}
				themeId={props.themeId}
				selectedToken={colorToken}
				onClose={() => setIsColorPickerOpen(false)}
				onSelect={handleColorSelect}
			/>
		</article>
	);
}
