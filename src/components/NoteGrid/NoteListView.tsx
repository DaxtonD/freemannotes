/**
 * NoteListView – compact flat-list rendering of notes.
 *
 * Supports two variants:
 *  - 'list'  : ~46px rows showing title + badge icons only
 *  - 'strip' : ~68px rows adding a one-line content preview below the title
 */

import React from 'react';
import * as Y from 'yjs';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faBell,
	faEllipsisVertical,
	faFileLines,
	faFolder,
	faListCheck,
	faTag,
	faThumbtack,
	faUsers,
} from '@fortawesome/free-solid-svg-icons';
import { getUserNoteColorToken } from '../../core/noteColorPreferences';
import { readNoteColorToken, resolveThemeNoteColorModel } from '../../core/noteColors';
import { readNoteFromDoc } from '../../core/noteModel';
import type { ThemeId } from '../../core/theme';
import type { VisibleNoteSnapshot } from '../../utilities/getVisibleNotes';
import type { LabelRecord } from '../../services/labelService';
import { applyFlipAnimations, measureViewportRects } from './flip';
import styles from './NoteListView.module.css';

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
	activeDragId: string | null;
	setItemElement: (id: string, node: HTMLDivElement | null) => void;
	setHandleElement: (id: string, node: HTMLDivElement | null) => void;
	shouldSuppressOpen: () => boolean;
	canOpenNotes: boolean;
	canDrag: (noteId: string) => boolean;
	onSelectNote: (noteId: string) => void;
	onMoreMenu: (noteId: string, anchorRect: DOMRect | null) => void;
};

function getColorVars(noteId: string, doc: Y.Doc, themeId: ThemeId): React.CSSProperties | undefined {
	const token = getUserNoteColorToken(noteId) ?? readNoteColorToken(doc.getMap<any>('metadata'));
	if (!token) return undefined;
	const resolved = resolveThemeNoteColorModel(themeId).tokens[token];
	return {
		'--list-row-accent': resolved.accentColor,
		'--list-row-bg': resolved.cardBackground,
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
	setItemElement: (id: string, node: HTMLDivElement | null) => void;
	setHandleElement: (id: string, node: HTMLDivElement | null) => void;
	canDrag: boolean;
	canOpenNotes: boolean;
	onSelectNote: (noteId: string) => void;
	onMoreMenu: (noteId: string, anchorRect: DOMRect | null) => void;
};

const NoteRow = React.memo(function NoteRow(props: NoteRowProps): React.JSX.Element {
	const { noteId, doc, snapshot, showPreview } = props;

	const title = doc.getText('title').toString() || '\u00A0';
	const isPinned = snapshot?.isPinned ?? false;
	const hasReminder = Boolean(snapshot?.reminderAt);
	const noteType = String(doc.getMap<any>('metadata').get('type') ?? '') === 'checklist' ? 'checklist' : 'text';
	const colorVars = getColorVars(noteId, doc, props.themeId);
	const preview = showPreview ? getContentPreview(doc, noteId) : null;

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

	return (
		<div
			ref={handleItemRef}
			className={[
				styles.row,
				props.isSelected ? styles.rowSelected : '',
				props.isMoreMenuOpen ? styles.rowMenuOpen : '',
				props.isPlaceholder ? styles.rowPlaceholder : '',
				showPreview ? styles.rowStrip : '',
			]
				.filter(Boolean)
				.join(' ')}
			style={colorVars}
			role={props.canOpenNotes ? 'button' : undefined}
			tabIndex={props.canOpenNotes ? 0 : undefined}
			data-note-card="true"
			data-note-list-row="true"
			data-note-id={noteId}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
		>
			<div className={styles.rowMain}>
				<span
					className={styles.rowTypeIcon}
					data-drag-handle="true"
					title={noteType === 'checklist' ? 'Checklist' : 'Note'}
				>
					<FontAwesomeIcon icon={noteType === 'checklist' ? faListCheck : faFileLines} />
				</span>
				<span className={styles.rowTitle}>{title}</span>

				<span className={styles.rowBadges}>
					{isPinned ? (
						<span className={styles.badge} title="Pinned">
							<FontAwesomeIcon icon={faThumbtack} />
						</span>
					) : null}
					{hasReminder ? (
						<span className={styles.badge} title="Has reminder">
							<FontAwesomeIcon icon={faBell} />
						</span>
					) : null}
					{props.collectionPath ? (
						<span className={styles.badge} title={props.collectionPath}>
							<FontAwesomeIcon icon={faFolder} />
						</span>
					) : null}
					{props.labels.length > 0 ? (
						<span className={styles.badge} title={`${props.labels.length} label${props.labels.length !== 1 ? 's' : ''}`}>
							<FontAwesomeIcon icon={faTag} />
							{props.labels.length > 1 ? <span className={styles.badgeCount}>{props.labels.length}</span> : null}
						</span>
					) : null}
					{props.collaboratorCount > 0 ? (
						<span className={styles.badge} title={`${props.collaboratorCount} collaborator${props.collaboratorCount !== 1 ? 's' : ''}`}>
							<FontAwesomeIcon icon={faUsers} />
							{props.collaboratorCount > 1 ? <span className={styles.badgeCount}>{props.collaboratorCount}</span> : null}
						</span>
					) : null}
				</span>
			</div>

			{showPreview && preview ? (
				<div className={styles.rowPreview}>{preview}</div>
			) : null}

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
	const showPreview = props.variant === 'strip';
	const containerRef = React.useRef<HTMLDivElement | null>(null);
	const previousRectsRef = React.useRef<Map<string, DOMRect>>(new Map());
	const hasMeasuredRef = React.useRef(false);

	React.useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		if (!hasMeasuredRef.current) {
			previousRectsRef.current = measureViewportRects(container);
			hasMeasuredRef.current = true;
			return;
		}
		previousRectsRef.current = applyFlipAnimations({
			container,
			previousRects: previousRectsRef.current,
			activeId: props.activeDragId,
			suppressAnimations: false,
			skipForScroll: false,
		});
	}, [props.activeDragId, props.orderedIds, showPreview]);

	return (
		<div ref={containerRef} className={showPreview ? styles.containerStrip : styles.containerList}>
			{props.orderedIds.map((noteId) => {
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
						key={noteId}
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
						setItemElement={props.setItemElement}
						setHandleElement={props.setHandleElement}
						shouldSuppressOpen={props.shouldSuppressOpen}
						canOpenNotes={props.canOpenNotes}
						canDrag={props.canDrag(noteId)}
						onSelectNote={props.onSelectNote}
						onMoreMenu={props.onMoreMenu}
					/>
				);
			})}
		</div>
	);
}
