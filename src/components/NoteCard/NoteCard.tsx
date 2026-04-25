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
} from '@fortawesome/free-solid-svg-icons';
import type { ChecklistItem } from '../../core/bindings';
import { getChecklistCountPrefix, normalizeChecklistCountValue } from '../../core/checklistCounts';
import { buildChecklistCompletedRows, normalizeChecklistHierarchy, toggleChecklistItemCompleted } from '../../core/checklistHierarchy';
import { getDeviceId } from '../../core/deviceId';
import { useI18n } from '../../core/i18n';
import { extractNoteLinksFromDoc, removeNotePreviewLinkFromDoc } from '../../core/noteLinks';
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
} from '../../core/noteCardCompletedExpansion';
import { readNoteColorToken, resolveThemeNoteColorModel } from '../../core/noteColors';
import { getUserNoteColorToken, setUserNoteColorToken, subscribeNoteColorPrefs } from '../../core/noteColorPreferences';
import type { ThemeId } from '../../core/theme';
import { updateUserPreferences } from '../../core/userDevicePreferencesApi';
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
	maxCardHeightPx?: number;
	allowChecklistItemInteractions?: boolean;
	allowLinkInteractions?: boolean;
	allowCompletedItemInteractions?: boolean;
	suppressContentInteractions?: boolean;
};

type NoteType = 'text' | 'checklist';

type NoteCardChecklistItem = ChecklistItem & { richContent: JSONContent | null; completedAt: number | null };

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
		.filter((item) => item.id.length > 0);
}

function useTextNoteRichPreview(doc: Y.Doc, plainText: string): JSONContent {
	const cacheRef = React.useRef<{
		signature: string;
		value: JSONContent;
	} | null>(null);

	return React.useSyncExternalStore(
		(onStoreChange) => {
			const observer = (): void => onStoreChange();
			doc.on('afterTransaction', observer);
			return () => doc.off('afterTransaction', observer);
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
	if (!href || /^javascript:/i.test(href)) return undefined;
	return href;
}

function getTextAlignStyle(node: JSONContent): React.CSSProperties | undefined {
	const textAlign = typeof (node.attrs as { textAlign?: unknown } | undefined)?.textAlign === 'string'
		? String((node.attrs as { textAlign?: string }).textAlign)
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
				<a key={`${key}:link:${index}`} className={styles.richLink} href={href} target="_blank" rel="noreferrer noopener">
					{result}
				</a>
			) : <span key={`${key}:link:${index}`} className={styles.richLink}>{result}</span>;
		}
	}
	return result;
}

function renderInlineNodes(nodes: readonly JSONContent[], keyPrefix: string, allowLinkInteraction: boolean): React.ReactNode[] {
	return nodes.flatMap((node, index) => {
		const key = `${keyPrefix}:${index}`;
		if (node.type === 'hardBreak') return [<br key={key} />];
		if (node.type !== 'text' || !node.text) return [];
		return [<React.Fragment key={key}>{applyMarks(node, node.text, key, allowLinkInteraction)}</React.Fragment>];
	});
}

function renderTableCellContent(nodes: readonly JSONContent[], keyPrefix: string, allowLinkInteraction: boolean): React.ReactNode {
	const children = nodes
		.map((child, index) => renderBlockNode(child, `${keyPrefix}:${index}`, false, true, allowLinkInteraction))
		.filter(Boolean);
	return children.length > 0 ? children : <span className={styles.richTableEmpty}>&nbsp;</span>;
}

function renderTableNode(block: JSONContent, key: string, allowLinkInteraction: boolean): React.ReactNode {
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
	const columnCount = Math.max(0, ...displayRows.map((row) => row.cells.length));
	if (columnCount === 0) return null;

	return (
		<div key={key} className={styles.richTablePreview}>
			<section className={styles.richTableCard}>
				{Array.from({ length: columnCount }, (_, columnIndex) => {
					const label = headerLabels[columnIndex] || `Column ${columnIndex + 1}`;
					const values = displayRows
						.map((row, rowIndex) => {
							const cell = row.cells[columnIndex];
							if (!cell) return null;
							return (
								<div key={`${key}:column:${columnIndex}:row:${rowIndex}`} className={styles.richTableValueRow}>
									{renderTableCellContent(cell.content, `${key}:column:${columnIndex}:row:${rowIndex}`, allowLinkInteraction)}
								</div>
							);
						})
						.filter(Boolean);

					return (
						<div key={`${key}:column:${columnIndex}`} className={styles.richTableField}>
							<div className={styles.richTableLabel}>{label}</div>
							<div className={styles.richTableValue}>
								{values.length > 0 ? values : <span className={styles.richTableEmpty}>&nbsp;</span>}
							</div>
						</div>
					);
				})}
			</section>
		</div>
	);
}

function renderBlockNode(block: JSONContent, key: string, inListItem = false, inTableCell = false, allowLinkInteraction = true, onToggleTaskItem?: (indexPath: number[]) => void): React.ReactNode {
	const style = getTextAlignStyle(block);

	if (block.type === 'paragraph' || block.type === 'heading') {
		const children = renderInlineNodes(block.content ?? [], key, allowLinkInteraction);
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
		const items = (block.content ?? []).map((item, index) => renderBlockNode(item, `${key}:${index}`, false, inTableCell, allowLinkInteraction, onToggleTaskItem)).filter(Boolean);
		if (items.length === 0) return null;
		const ListTag = block.type === 'orderedList' ? 'ol' : 'ul';
		return <ListTag key={key} className={block.type === 'orderedList' ? styles.richOrderedList : styles.richList}>{items}</ListTag>;
	}

	if (block.type === 'taskList') {
		const items = (block.content ?? []).map((item, index) => renderBlockNode(item, `${key}:${index}`, false, inTableCell, allowLinkInteraction, onToggleTaskItem)).filter(Boolean);
		if (items.length === 0) return null;
		return <ul key={key} className={styles.richTaskList}>{items}</ul>;
	}

	if (block.type === 'listItem') {
		const children = (block.content ?? []).map((child, index) => renderBlockNode(child, `${key}:${index}`, true, inTableCell, allowLinkInteraction, onToggleTaskItem)).filter(Boolean);
		if (children.length === 0) return null;
		return <li key={key} className={styles.richListItem}>{children}</li>;
	}

	if (block.type === 'taskItem') {
		const checked = getTaskItemChecked(block);
		const children = (block.content ?? []).map((child, index) => renderBlockNode(child, `${key}:${index}`, true, inTableCell, allowLinkInteraction, onToggleTaskItem)).filter(Boolean);
		if (children.length === 0) return null;
		const indexPath = onToggleTaskItem ? key.split(':').slice(1).map(Number) : null;
		return (
			<li
				key={key}
				className={styles.richTaskItem}
				data-checked={checked ? 'true' : 'false'}
				onPointerDown={indexPath ? (e) => e.stopPropagation() : undefined}
				onPointerUp={indexPath ? (e) => e.stopPropagation() : undefined}
				onClick={indexPath ? (e) => e.stopPropagation() : undefined}
			>
				<span className={styles.richTaskCheckbox} aria-hidden="true">
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
		const children = (block.content ?? []).map((child, index) => renderBlockNode(child, `${key}:${index}`, false, inTableCell, allowLinkInteraction, onToggleTaskItem)).filter(Boolean);
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
		return renderTableNode(block, key, allowLinkInteraction);
	}

	if (Array.isArray(block.content) && block.content.length > 0) {
		const children = block.content.map((child, index) => renderBlockNode(child, `${key}:${index}`, inListItem, inTableCell, allowLinkInteraction, onToggleTaskItem)).filter(Boolean);
		if (children.length === 0) return null;
		return <React.Fragment key={key}>{children}</React.Fragment>;
	}

	return null;
}

function renderRichPreview(json: JSONContent | null | undefined, allowLinkInteraction = true, onToggleTaskItem?: (indexPath: number[]) => void): React.ReactNode {
	if (!json?.content) return null;
	const blocks = json.content.map((block, index) => renderBlockNode(block, `block:${index}`, false, false, allowLinkInteraction, onToggleTaskItem)).filter(Boolean);
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
		items: readonly ChecklistItem[];
	} | null>(null);

	return React.useSyncExternalStore(
		(onStoreChange) => {
			if (!cacheRef.current || cacheRef.current.yarray !== yarray) {
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
			}
			const observer = (): void => {
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
				onStoreChange();
			};
			yarray.observeDeep(observer);
			return () => yarray.unobserveDeep(observer);
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

export function NoteCard(props: NoteCardProps): React.JSX.Element {
	const { t } = useI18n();
	const maxCardHeightPx = Math.max(220, props.maxCardHeightPx ?? 300);
	const noteCardLinkPreviewMaxItems = maxCardHeightPx >= 420 ? 3 : 2;
	const collapsedChecklistLineHeightPx = 22;
	const minimumExpandedCompletedItems = 3;
	const canEdit = props.canEdit !== false;
	const allowChecklistItemInteractions = props.allowChecklistItemInteractions !== false;
	const allowLinkInteractions = props.allowLinkInteractions !== false;
	const allowCompletedItemInteractions = props.allowCompletedItemInteractions !== false;
	const suppressContentInteractions = props.suppressContentInteractions === true;
	// metadata.type controls note rendering mode.
	const metadata = React.useMemo(() => props.doc.getMap<any>('metadata'), [props.doc]);
	const colorToken = React.useSyncExternalStore(
		(onStoreChange) => {
			// Subscribe to both the local preferences store and the Yjs metadata
			// (Yjs is kept as a migration fallback for legacy colors already in the doc).
			const unsubLocal = subscribeNoteColorPrefs(onStoreChange);
			const observer = (): void => onStoreChange();
			metadata.observe(observer);
			return () => { unsubLocal(); metadata.unobserve(observer); };
		},
		() => getUserNoteColorToken(props.noteId) ?? readNoteColorToken(metadata),
		() => getUserNoteColorToken(props.noteId) ?? readNoteColorToken(metadata)
	);
	const typeValue = useMetadataString(metadata, 'type');
	const type: NoteType = typeValue === 'checklist' ? 'checklist' : 'text';
	const resolvedColor = React.useMemo(
		() => (colorToken ? resolveThemeNoteColorModel(props.themeId).tokens[colorToken] : null),
		[colorToken, props.themeId]
	);

	const title = useOptionalYTextValue(React.useCallback(() => props.doc.getText('title'), [props.doc]));
	const content = useOptionalYTextValue(
		React.useCallback(() => (type === 'text' ? props.doc.getText('content') : null), [props.doc, type])
	);
	const reminderAt = props.reminderAt ?? '';
	const richContent = useTextNoteRichPreview(props.doc, content);
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
	const normalizedItems = React.useMemo(() => normalizeChecklistHierarchy(checklistItems), [checklistItems]);
	const extractedLinks = React.useSyncExternalStore(
		(onStoreChange) => {
			const observer = (): void => onStoreChange();
			props.doc.on('afterTransaction', observer);
			return () => props.doc.off('afterTransaction', observer);
		},
		() => extractNoteLinksFromDoc(props.doc),
		() => extractNoteLinksFromDoc(props.doc)
	);
	const handleDeletePreview = React.useCallback((normalizedUrl: string): void => {
		if (!canEdit) return;
		removeNotePreviewLinkFromDoc(props.doc, normalizedUrl);
	}, [canEdit, props.doc]);
	const [showCompleted, setShowCompleted] = React.useState<boolean>(() => getNoteCardCompletedExpanded(props.noteId));
	const [multilineById, setMultilineById] = React.useState<Record<string, boolean>>({});
	const [clampedById, setClampedById] = React.useState<Record<string, boolean>>({});
	const [textPreviewLayout, setTextPreviewLayout] = React.useState<{ maxHeightPx: number | null; isOverflowing: boolean }>({
		maxHeightPx: null,
		isOverflowing: false,
	});
	const [checklistLayoutMetrics, setChecklistLayoutMetrics] = React.useState({
		headerHeightPx: 52,
		metaHeightPx: 0,
		linkPreviewHeightPx: 0,
		completedBaseHeightPx: 36,
		cardPaddingBottomPx: 0,
		bodyPaddingVerticalPx: 16,
		renderedCardScrollHeightPx: 0,
		contentRegionScrollHeightPx: 0,
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
		if (typeof window === 'undefined') return;
		window.requestAnimationFrame(() => {
			window.dispatchEvent(new CustomEvent('freemannotes:note-card-layout-change'));
		});
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

	const measureChecklistTextLayout = React.useCallback((): void => {
		if (type !== 'checklist') return;
		const card = cardRef.current;
		if (!card) return;
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
		for (const node of textNodes) {
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

	React.useEffect(() => {
		setShowCompleted(getNoteCardCompletedExpanded(props.noteId));
	}, [props.noteId]);
	const activeChecklistItems = React.useMemo(() => normalizedItems.filter((item) => !item.completed), [normalizedItems]);
	const completedChecklistItems = React.useMemo(() => normalizedItems.filter((item) => item.completed), [normalizedItems]);
	const checklistItemLineCost = React.useCallback((itemId: string): number => {
		if (clampedById[itemId]) return 3;
		if (multilineById[itemId]) return 2;
		return 1;
	}, [clampedById, multilineById]);
	const checklistItemById = React.useMemo(() => new Map(normalizedItems.map((item) => [item.id, item])), [normalizedItems]);
	const checklistOrderIndexById = React.useMemo(() => new Map(normalizedItems.map((item, index) => [item.id, index])), [normalizedItems]);
	const recentCompletedItems = React.useMemo(() => {
		return completedChecklistItems.slice().sort((left, right) => {
			const leftCompletedAt = Number.isFinite(Number(left.completedAt)) ? Number(left.completedAt) : Number.NEGATIVE_INFINITY;
			const rightCompletedAt = Number.isFinite(Number(right.completedAt)) ? Number(right.completedAt) : Number.NEGATIVE_INFINITY;
			if (leftCompletedAt !== rightCompletedAt) return rightCompletedAt - leftCompletedAt;
			return (checklistOrderIndexById.get(right.id) ?? 0) - (checklistOrderIndexById.get(left.id) ?? 0);
		});
	}, [checklistOrderIndexById, completedChecklistItems]);
	const fitChecklistItemsToLineBudget = React.useCallback((items: readonly NoteCardChecklistItem[], lineBudget: number) => {
		if (type !== 'checklist' || items.length === 0 || lineBudget <= 0) {
			return { visible: [] as NoteCardChecklistItem[], hiddenCount: items.length, usedLineCount: items.length > 0 && lineBudget > 0 ? 1 : 0 };
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
	const checklistFixedChromePx = React.useMemo(
		() => checklistLayoutMetrics.headerHeightPx + checklistLayoutMetrics.metaHeightPx + checklistLayoutMetrics.linkPreviewHeightPx + checklistLayoutMetrics.cardPaddingBottomPx + checklistLayoutMetrics.bodyPaddingVerticalPx,
		[checklistLayoutMetrics]
	);
	const collapsedAvailableLineBudget = React.useMemo(
		() => Math.max(0, Math.floor((maxCardHeightPx - checklistFixedChromePx - checklistLayoutMetrics.completedBaseHeightPx) / collapsedChecklistLineHeightPx)),
		[collapsedChecklistLineHeightPx, checklistFixedChromePx, checklistLayoutMetrics.completedBaseHeightPx, maxCardHeightPx]
	);
	const collapsedActiveFit = React.useMemo(
		() => fitChecklistItemsToLineBudget(activeChecklistItems, collapsedAvailableLineBudget),
		[activeChecklistItems, collapsedAvailableLineBudget, fitChecklistItemsToLineBudget]
	);
	const collapsedChecklistMinHeightPx = React.useMemo(
		() => Math.min(maxCardHeightPx, checklistFixedChromePx + checklistLayoutMetrics.completedBaseHeightPx + collapsedActiveFit.usedLineCount * collapsedChecklistLineHeightPx),
		[checklistFixedChromePx, checklistLayoutMetrics.completedBaseHeightPx, collapsedActiveFit.usedLineCount, collapsedChecklistLineHeightPx, maxCardHeightPx]
	);
	const expandedAvailableLineBudget = React.useMemo(
		() => Math.max(0, Math.floor((maxCardHeightPx - checklistFixedChromePx - checklistLayoutMetrics.completedBaseHeightPx) / collapsedChecklistLineHeightPx)),
		[collapsedChecklistLineHeightPx, checklistFixedChromePx, checklistLayoutMetrics.completedBaseHeightPx, maxCardHeightPx]
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
	const activeChecklistItemsToRender = showCompleted ? expandedActiveFit.visible : collapsedActiveFit.visible;
	const hiddenActiveChecklistCountToRender = showCompleted ? expandedActiveFit.hiddenCount : collapsedActiveFit.hiddenCount;
	const expandedActiveLineCost = React.useMemo(() => {
		if (type !== 'checklist') return 0;
		return expandedActiveFit.usedLineCount;
	}, [expandedActiveFit.usedLineCount, type]);
	const visibleCompletedRows = React.useMemo(() => {
		return selectVisibleCompletedRows(Math.max(0, expandedAvailableLineBudget - expandedActiveLineCost));
	}, [expandedActiveLineCost, expandedAvailableLineBudget, selectVisibleCompletedRows]);
	const hiddenCompletedChecklistCount = Math.max(
		0,
		completedChecklistItems.length - visibleCompletedRows.filter((row) => row.kind === 'item').length
	);
	const expandedChecklistMinHeightPx = React.useMemo(() => {
		if (type !== 'checklist') return maxCardHeightPx;
		let completedLineCost = 0;
		for (const row of visibleCompletedRows) {
			completedLineCost += row.kind === 'ghost' ? 1 : checklistItemLineCost(row.item.id);
		}
		if (hiddenCompletedChecklistCount > 0) completedLineCost += 1;
		return checklistFixedChromePx + checklistLayoutMetrics.completedBaseHeightPx + (expandedActiveLineCost + completedLineCost) * collapsedChecklistLineHeightPx;
	}, [checklistFixedChromePx, checklistItemLineCost, checklistLayoutMetrics.completedBaseHeightPx, collapsedChecklistLineHeightPx, expandedActiveLineCost, hiddenCompletedChecklistCount, maxCardHeightPx, type, visibleCompletedRows]);
	const expandedChecklistRenderedHeightPx = React.useMemo(() => {
		if (!showCompleted) return 0;
		return Math.max(
			checklistLayoutMetrics.renderedCardScrollHeightPx,
			checklistLayoutMetrics.headerHeightPx + checklistLayoutMetrics.metaHeightPx + checklistLayoutMetrics.contentRegionScrollHeightPx + checklistLayoutMetrics.cardPaddingBottomPx
		);
	}, [checklistLayoutMetrics, showCompleted]);
	const expandedChecklistMaxHeightPx = Math.max(maxCardHeightPx, expandedChecklistMinHeightPx, expandedChecklistRenderedHeightPx);
	const cardStyle = React.useMemo(() => {
		const nextStyle: React.CSSProperties = {};
		if (resolvedColor) {
			nextStyle['--note-color-card-bg'] = resolvedColor.cardBackground;
			nextStyle['--note-color-header-bg'] = resolvedColor.headerBackground;
			nextStyle['--note-color-border'] = resolvedColor.borderColor;
			nextStyle['--note-color-text'] = resolvedColor.textColor;
			nextStyle['--note-color-muted'] = resolvedColor.mutedTextColor;
			nextStyle['--note-color-accent'] = resolvedColor.accentColor;
		}
		if (type === 'checklist') {
			nextStyle['--note-card-collapsed-checklist-height' as any] = `${collapsedChecklistMinHeightPx}px`;
			nextStyle['--note-card-expanded-checklist-max-height' as any] = `${expandedChecklistMaxHeightPx}px`;
		}
		return Object.keys(nextStyle).length > 0 ? nextStyle : undefined;
	}, [collapsedChecklistMinHeightPx, expandedChecklistMaxHeightPx, resolvedColor, type]);
	const textPreviewStyle = React.useMemo(() => {
		if (type !== 'text') return undefined;
		if (!Number.isFinite(Number(textPreviewLayout.maxHeightPx)) || !textPreviewLayout.maxHeightPx || textPreviewLayout.maxHeightPx <= 0) return undefined;
		return { maxHeight: `${Math.floor(textPreviewLayout.maxHeightPx)}px` } as React.CSSProperties;
	}, [textPreviewLayout.maxHeightPx, type]);
	React.useEffect(() => {
		if (completedChecklistItems.length > 0 || !showCompleted) return;
		setShowCompleted(false);
		setNoteCardCompletedExpanded(props.noteId, false);
		requestChecklistLayoutRefresh();
	}, [completedChecklistItems.length, props.noteId, requestChecklistLayoutRefresh, showCompleted]);

	const toggleNoteCardChecklistItem = React.useCallback((id: string, checked: boolean): void => {
		if (!canEdit) return;
		// Apply the shared parent/child completion rules, then only write the rows
		// whose completion state actually changed back into Yjs.
		const nextItems = toggleChecklistItemCompleted(normalizedItems, id, checked);
		const completionStampBase = Date.now();
		let completionStampOffset = 0;
		for (const item of nextItems) {
			const previous = normalizedItems.find((entry) => entry.id === item.id);
			if (!previous || previous.completed === item.completed) continue;
			updateChecklistItemById(checklistArray, item.id, {
				completed: item.completed,
				completedAt: item.completed ? completionStampBase + completionStampOffset++ : null,
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
		if (type !== 'text') {
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
			const linkPreviewHeightPx = linkPreviewRailRef.current && linkPreviewRailRef.current.childElementCount > 0
				? linkPreviewRailRef.current.offsetHeight
				: 0;
			const cardPaddingBottomPx = Number.parseFloat(cardStyle.paddingBottom || '0') || 0;
			const bodyPaddingVerticalPx =
				(Number.parseFloat(bodyStyle.paddingTop || '0') || 0) +
				(Number.parseFloat(bodyStyle.paddingBottom || '0') || 0);
			const availableHeightPx = Math.floor(
				maxCardHeightPx - headerHeightPx - metaHeightPx - linkPreviewHeightPx - cardPaddingBottomPx - bodyPaddingVerticalPx
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
				measure();
			});
		};

		scheduleMeasure();
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
	}, [content, maxCardHeightPx, richContent, type]);

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

		scheduleMeasure();
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
	}, [requestChecklistLayoutRefresh, showCompleted, type]);

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
		setShowCompleted((prev) => {
			const next = !prev;
			setNoteCardCompletedExpanded(props.noteId, next);
			void updateUserPreferences(getDeviceId(), {
				noteCardCompletedExpandedPatch: { noteId: props.noteId, expanded: next },
			});
			requestChecklistLayoutRefresh();
			return next;
		});
	}, [props.noteId, requestChecklistLayoutRefresh]);

	const handleReminderAction = React.useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
		event.stopPropagation();
		props.onAddReminder?.();
	}, [props]);

	const handleDockAction = React.useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
		// Placeholder — stops propagation so the card doesn't open underneath.
		event.stopPropagation();
	}, []);

	const handlePaletteAction = React.useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
		event.stopPropagation();
		if (!canEdit) return;
		setIsColorPickerOpen(true);
	}, [canEdit]);

	// Write the color choice to the per-user local store only — never to the
	// shared Yjs doc — so collaborators keep independent color preferences.
	const handleColorSelect = React.useCallback((token: Parameters<typeof setUserNoteColorToken>[1]): void => {
		setUserNoteColorToken(props.noteId, token);
		setIsColorPickerOpen(false);
	}, [props.noteId]);

	const handleAddCollaborator = React.useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
		event.stopPropagation();
		props.onAddCollaborator?.();
	}, [props]);

	const handleAddImage = React.useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
		event.stopPropagation();
		props.onAddImage?.();
	}, [props]);

	const handleMoreMenuAction = React.useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
		event.stopPropagation();
		const cardRect = cardRef.current?.getBoundingClientRect();
		const footerRect = footerRef.current?.getBoundingClientRect();
		// Footer-triggered menus anchor to the card's left edge and the dock band
		// so the desktop popover lines up with the card rather than the button.
		props.onMoreMenu?.(
			cardRect
				? {
					top: footerRect?.top ?? cardRect.bottom,
					left: cardRect.left,
					width: cardRect.width,
					height: footerRect?.height ?? 0,
				}
				: null
		);
		event.currentTarget.blur();
	}, [props]);

	const handleRestoreAction = React.useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
		event.stopPropagation();
		props.onRestoreNote?.();
	}, [props]);

	return (
		<article
			ref={cardRef}
			className={`${styles.card}${type === 'checklist' ? ` ${styles.checklistCard}` : ''}${type === 'checklist' && (!showCompleted || completedChecklistItems.length === 0) ? ` ${styles.checklistCardCollapsed}` : ''}${type === 'checklist' && showCompleted && completedChecklistItems.length > 0 ? ` ${styles.checklistCardCompletedExpanded}` : ''}${props.isMoreMenuOpen ? ` ${styles.moreMenuOpen}` : ''}${props.isTrashView ? ` ${styles.trashCard}` : ''}`}
			style={cardStyle}
			data-note-card="true"
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
				// If the touch started on the drag handle (header), let
				// pragmatic-drag-and-drop own the gesture — don't capture the
				// pointer or start the long-press (more-menu) timer.
				const target = e.target as HTMLElement | null;
				const isDragHandle = Boolean(target?.closest('[data-drag-handle="true"]'));
				// Touch/coarse branch: capture the pointer so this interaction stays
				// bound to the card element even if the editor overlay mounts before
				// compatibility events are delivered.
				if (!isDragHandle && (e.pointerType === 'touch' || isCoarsePointerDevice()) && e.currentTarget.hasPointerCapture && e.currentTarget.setPointerCapture) {
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
							// Long-press timer (touch/coarse only): start a 400ms timer.
							// If the pointer doesn't move >6px before it fires, open the more-menu.
							// This is intentionally disabled for touches that start on the drag
							// handle so drag gestures don't accidentally open the menu.
				longPressFiredRef.current = false;
				clearLongPressTimer();
				if (!isDragHandle && props.onMoreMenu && (e.pointerType === 'touch' || isCoarsePointerDevice())) {
					const onMoreMenu = props.onMoreMenu;
					longPressTimerRef.current = window.setTimeout(() => {
						longPressTimerRef.current = 0;
						const state = pointerDownRef.current;
						if (!state || state.moved) return;
						longPressFiredRef.current = true;
						pointerDownRef.current = null;
						// Clear any native text selection Android may have
						// started during the long-press gesture.
						window.getSelection()?.removeAllRanges();							// Release pointer capture now so the full-screen overlay that
							// mounts next correctly receives the still-pressed touch events.
							// Without this the note card keeps all pointer events via capture,
							// preventing the sheet's absorption handlers from ever firing.
							const capturedCard = cardRef.current;
							if (capturedCard && typeof capturedCard.releasePointerCapture === 'function') {
								try { capturedCard.releasePointerCapture(state.pointerId); } catch { /* ignore */ }
							}						triggerLongPressHaptic();
						onMoreMenu();
					}, 400);
				}
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
				if (e.currentTarget.hasPointerCapture && e.currentTarget.releasePointerCapture) {
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
				if (e.currentTarget.hasPointerCapture && e.currentTarget.releasePointerCapture) {
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
				// After a long-press opens the more-menu the finger is still down.
				// Prevent the browser from synthesising a click from this touch
				// sequence — otherwise the click fires at the finger's current
				// position and lands on whichever menu item is underneath.
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
				className={styles.header}
				ref={handleHeaderRef}
				data-drag-handle="true"
				{...props.dragHandleProps}
				onClick={(e) => {
					// Drag-handle clicks should not bubble and open the note.
					e.stopPropagation();
				}}
			>
				<span className={styles.headerTitle}>{title.trim().length > 0 ? title : t('note.untitled')}</span>
				{props.isPinned ? (
					<span aria-label={t('noteMenu.pinNote')} title={t('noteMenu.pinNote')} className={styles.pinBadge}>
						<FontAwesomeIcon icon={faThumbtack} />
					</span>
				) : null}
				{reminderAt ? (
					<span aria-label={reminderLabel || t('note.addReminder')} title={reminderLabel || t('note.addReminder')} className={styles.reminderBadge}>
						<FontAwesomeIcon icon={faBell} />
					</span>
				) : null}
				{props.hasPendingSync ? (
					<span aria-label={t('note.pendingSync')} title={t('note.pendingSync')} className={styles.pendingSync}>
						↻
					</span>
				) : null}
			</div>

			{props.metaChips ? (
				// Keep a dedicated chip rail on the card so collaborator chips ship now
				// and future label/image/collection chips can reuse the same slot.
				<div ref={metaChipRowRef} className={styles.metaChipRow}>{props.metaChips}</div>
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

			<div ref={contentRegionRef} className={`${styles.contentRegion}${showCompleted && completedChecklistItems.length > 0 ? ` ${styles.contentRegionCompletedExpanded}` : ''}`}>
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
				{type === 'text' ? (
					<div ref={bodyRef} className={styles.body}>
						<div ref={contentPreviewRef} className={`${styles.contentPreview}${textPreviewLayout.isOverflowing ? ` ${styles.contentPreviewOverflowing}` : ''}`} style={textPreviewStyle}>{renderRichPreview(richContent, allowLinkInteractions, allowChecklistItemInteractions && canEdit ? handleToggleRichTaskItem : undefined) ?? content}</div>
					</div>
				) : (
					<>
						<div ref={bodyRef} className={styles.body}>
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
												disabled={!canEdit || !allowChecklistItemInteractions}
												readOnly
											/>
										</span>
										<div className={`${styles.checklistText}${clampedById[item.id] ? ` ${styles.checklistTextClamped}` : ''}`} data-checklist-text-id={item.id}>
											{renderChecklistCardContent(item, renderRichPreview(item.richContent ?? createRichTextDocFromPlainText(item.text), allowLinkInteractions) ?? item.text)}
										</div>
									</li>
								))}
							</ul>
							{hiddenActiveChecklistCountToRender > 0 ? (
								<div className={`${styles.checklistMore} ${styles.activeChecklistMore}`}>+{hiddenActiveChecklistCountToRender} more</div>
							) : null}
						</div>

						<div ref={completedSectionRef} className={styles.completedSection}>
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
									<span className={styles.completedToggleArrow} aria-hidden="true">{completedChecklistItems.length > 0 ? (showCompleted ? '▾' : '▸') : '·'}</span>
									<span>{completedChecklistItems.length} {t('editors.completedItems')}</span>
								</button>
							) : (
								<div ref={completedToggleRef as React.RefObject<HTMLDivElement>} className={styles.completedToggle}>
									<span className={styles.completedToggleArrow} aria-hidden="true">{completedChecklistItems.length > 0 ? (showCompleted ? '▾' : '▸') : '·'}</span>
									<span>{completedChecklistItems.length} {t('editors.completedItems')}</span>
								</div>
							)}
							{showCompleted && completedChecklistItems.length > 0 ? (
								<ul className={styles.checklist}>
									{visibleCompletedRows.map(({ kind, item }) => kind === 'ghost' ? (
										<li key={`ghost-${item.id}`} className={`${styles.checklistItem}${multilineById[item.id] ? ` ${styles.checklistItemMultiline}` : ''} ${styles.checklistGhostItem}`} aria-hidden="true">
											<span className={styles.checklistCheckboxHitArea}>
												<input type="checkbox" className={styles.checklistCheckbox} checked={false} disabled readOnly tabIndex={-1} />
											</span>
											<div className={styles.checklistText}>
												{renderChecklistCardContent(item, renderRichPreview(item.richContent ?? createRichTextDocFromPlainText(item.text), false) ?? item.text)}
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
													disabled={!canEdit || !allowCompletedItemInteractions}
													readOnly
												/>
											</span>
											<div className={`${styles.checklistText} ${styles.checklistTextCompleted}${clampedById[item.id] ? ` ${styles.checklistTextClamped}` : ''}`} data-checklist-text-id={item.id}>
												{renderChecklistCardContent(item, renderRichPreview(item.richContent ?? createRichTextDocFromPlainText(item.text), allowLinkInteractions) ?? item.text)}
											</div>
										</li>
									))}
								</ul>
							) : null}
							{showCompleted && hiddenCompletedChecklistCount > 0 ? (
								<div className={`${styles.checklistMore} ${styles.completedChecklistMore}`}>+{hiddenCompletedChecklistCount} completed items</div>
							) : null}
						</div>
					</>
				)}

				{props.docId ? (
					<div ref={linkPreviewRailRef} className={styles.linkPreviewRail}>
						<NoteLinkPanel docId={props.docId} authUserId={props.authUserId} fallbackLinks={extractedLinks} canEdit={canEdit} onDeleteLink={handleDeletePreview} variant="rail" maxItems={noteCardLinkPreviewMaxItems} disableInitialRemoteRefresh disableOpenLinks={!allowLinkInteractions} />
					</div>
				) : null}
			</div>
			<div ref={footerRef} className={`${styles.cardFooter}${suppressContentInteractions ? ` ${styles.cardFooterGuarded}` : ''}`}>
				{/* Desktop-only footer dock mirrors the editor action strip so note
				    cards and editors share the same action vocabulary. */}
				<nav className={styles.cardDock} aria-label={t('editors.bottomDock')}>
					<div className={styles.cardDockLeft}>
						<button
							type="button"
							className={styles.cardDockButton}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={handleMoreMenuAction}
							aria-label={t('editors.dockAction')}
						>
							<FontAwesomeIcon icon={faEllipsisVertical} />
						</button>
						<button
							type="button"
							className={styles.cardDockButton}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={handlePaletteAction}
							aria-label={t('noteColors.dialogTitle')}
							disabled={!canEdit}
						>
							<FontAwesomeIcon icon={faPalette} />
						</button>
						<button
							type="button"
							className={styles.cardDockButton}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={handleReminderAction}
							aria-label={t('note.addReminder')}
							disabled={!canEdit || !props.onAddReminder}
						>
							<FontAwesomeIcon icon={faBell} />
						</button>
						<button
							type="button"
							className={styles.cardDockButton}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={handleAddCollaborator}
							aria-label={t('editors.dockAction')}
							disabled={!canEdit || !props.onAddCollaborator}
						>
							<FontAwesomeIcon icon={faUserPlus} />
						</button>
						<button
							type="button"
							className={styles.cardDockButton}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={props.onAddImage ? handleAddImage : handleDockAction}
							aria-label={t('editors.dockAction')}
							disabled={!canEdit || !props.onAddImage}
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
