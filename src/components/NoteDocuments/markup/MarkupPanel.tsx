import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faCheck, faMagnifyingGlass, faPlus, faRotateLeft, faTrashCan, faXmark } from '@fortawesome/free-solid-svg-icons';
import { markupFooterText, stampMainText } from './markupGeometry';
import { SymbolGlyph, symbolById } from './markupSymbols';
import type { CommentMarkup, Markup, MarkupReply } from './markupTypes';
import styles from './MarkupPanel.module.css';

// The markup panel, beside the pages on desktop and a sheet on phones. Two tabs:
// - Comments: every comment by number, Open / Resolved / All, quick resolve, Add comment, so nobody
//   has to scroll a 40-sheet set hunting for pins.
// - All markup: everything drawn, grouped by page, filterable, with counts of symbols and stamps.
// Opening a comment (from either tab or from its pin) shows the comment view for writing,
// resolving and deleting. Everyone can open the panel; only editors get the controls that change
// anything.

type Translate = (key: string) => string;

export type MarkupPanelTab = 'comments' | 'markup';

type Filter = 'all' | 'comments' | 'stamps' | 'symbols' | 'text' | 'shapes' | 'drawing';
type StatusFilter = 'any' | 'open' | 'resolved';
type CommentStatusFilter = 'open' | 'resolved' | 'all';

const FILTERS: ReadonlyArray<{ id: Filter; labelKey: string; test: (markup: Markup) => boolean }> = [
	{ id: 'all', labelKey: 'documents.markupFilterAll', test: () => true },
	{ id: 'comments', labelKey: 'documents.markupFilterComments', test: (markup) => markup.kind === 'comment' },
	{ id: 'stamps', labelKey: 'documents.markupFilterStamps', test: (markup) => markup.kind === 'stamp' },
	{ id: 'symbols', labelKey: 'documents.markupFilterSymbols', test: (markup) => markup.kind === 'symbol' },
	{ id: 'text', labelKey: 'documents.markupFilterText', test: (markup) => markup.kind === 'text' || markup.kind === 'callout' },
	{
		id: 'shapes',
		labelKey: 'documents.markupFilterShapes',
		test: (markup) => ['line', 'arrow', 'rect', 'ellipse', 'cloud', 'move'].includes(markup.kind),
	},
	{ id: 'drawing', labelKey: 'documents.markupFilterDrawing', test: (markup) => markup.kind === 'ink' },
];

const KIND_LABEL_KEYS: Record<Markup['kind'], string> = {
	ink: 'documents.markupPen',
	line: 'documents.markupLine',
	arrow: 'documents.markupArrow',
	move: 'documents.markupMove',
	rect: 'documents.markupRectangle',
	ellipse: 'documents.markupEllipse',
	cloud: 'documents.markupCloud',
	text: 'documents.markupText',
	callout: 'documents.markupCallout',
	stamp: 'documents.markupStamp',
	symbol: 'documents.markupSymbol',
	comment: 'documents.markupComment',
};

const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function markupTitle(markup: Markup, t: Translate): string {
	switch (markup.kind) {
		case 'comment':
			return markup.text.trim() || t('documents.markupCommentEmpty');
		case 'stamp':
			return stampMainText(markup);
		case 'symbol': {
			const definition = symbolById(markup.symbol);
			return definition ? t(definition.nameKey) : t('documents.markupSymbol');
		}
		case 'text':
		case 'callout':
			return markup.text.split('\n')[0].trim() || t(KIND_LABEL_KEYS[markup.kind]);
		case 'ink':
			return t(markup.highlighter ? 'documents.markupHighlighter' : 'documents.markupPen');
		default:
			return t(KIND_LABEL_KEYS[markup.kind]);
	}
}

function markupAuthorName(markup: Markup): string {
	return 'author' in markup && markup.author ? markup.author.name.trim() : '';
}

/** Kind, then author and date where the markup carries them (comments, callouts, stamps). */
function markupMeta(markup: Markup, t: Translate): string {
	const kind = t(KIND_LABEL_KEYS[markup.kind]);
	if (!('author' in markup)) return kind;
	const footer = markupFooterText(markup.author, markup.createdAt);
	return footer ? `${kind} · ${footer}` : kind;
}

function uniqueAuthors(items: readonly Markup[]): string[] {
	const names = new Set<string>();
	for (const item of items) {
		const name = markupAuthorName(item);
		if (name) names.add(name);
	}
	return Array.from(names).sort((left, right) => left.localeCompare(right));
}

function matchesWords(text: string, words: readonly string[]): boolean {
	if (words.length === 0) return true;
	const haystack = fold(text);
	return words.every((word) => haystack.includes(word));
}

function RowIcon(props: { markup: Markup }): React.JSX.Element {
	const { markup } = props;
	if (markup.kind === 'comment') {
		return <span className={styles.rowPin} style={{ background: markup.color }}>{markup.number}</span>;
	}
	if (markup.kind === 'symbol') {
		const definition = symbolById(markup.symbol);
		if (definition) {
			return (
				<span className={styles.rowGlyph} style={{ color: markup.color }}>
					<SymbolGlyph definition={definition} size={22} />
				</span>
			);
		}
	}
	return <span className={styles.rowSwatch} style={{ background: markup.color }} />;
}

type MarkupPanelProps = {
	variant: 'side' | 'sheet';
	tab: MarkupPanelTab;
	items: readonly Markup[];
	replies: readonly MarkupReply[];
	selectedId: string | null;
	/** The comment being written (isNew) or looked at; null shows the tab's list. */
	comment: { markup: CommentMarkup; isNew: boolean } | null;
	commentText: string;
	canEdit: boolean;
	t: Translate;
	onTabChange: (tab: MarkupPanelTab) => void;
	onReveal: (markup: Markup) => void;
	/** Turns on the comment tool so the next tap on the page places a comment. */
	onAddComment: () => void;
	onToggleResolvedFor: (comment: CommentMarkup) => void;
	onBackToList: () => void;
	onCommentChange: (text: string) => void;
	/** Saves edits to an existing comment. */
	onCommentSave: () => void;
	onCommentPost: () => void;
	onCommentCancel: () => void;
	onToggleResolved: () => void;
	onDeleteComment: () => void;
	onClose: () => void;
};

// List filters stay put while the app is open, so going into a comment and back keeps your place.
type ListState = { filter: Filter; status: StatusFilter; author: string; query: string };
type CommentsState = { status: CommentStatusFilter; author: string; query: string };
let rememberedListState: ListState = { filter: 'all', status: 'any', author: '', query: '' };
let rememberedCommentsState: CommentsState = { status: 'open', author: '', query: '' };

function PanelHeader(props: MarkupPanelProps & { openCount: number }): React.JSX.Element {
	const { t } = props;
	const tabs: ReadonlyArray<{ id: MarkupPanelTab; label: string }> = [
		{ id: 'comments', label: t('documents.markupComments') },
		{ id: 'markup', label: t('documents.markupTabAllMarkup') },
	];
	return (
		<div className={styles.header}>
			<div className={styles.tabs} role="tablist">
				{tabs.map((tab) => (
					<button
						key={tab.id}
						type="button"
						role="tab"
						aria-selected={props.tab === tab.id}
						className={`${styles.tab}${props.tab === tab.id ? ` ${styles.tabActive}` : ''}`}
						onClick={() => props.onTabChange(tab.id)}
					>
						<span>{tab.label}</span>
						{tab.id === 'comments' && props.openCount > 0 ? <span className={styles.tabBadge}>{props.openCount}</span> : null}
					</button>
				))}
			</div>
			<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label={t('documents.markupListClose')} title={t('documents.markupListClose')}>
				<FontAwesomeIcon icon={faXmark} />
			</button>
		</div>
	);
}

function CommentView(props: MarkupPanelProps & { comment: NonNullable<MarkupPanelProps['comment']> }): React.JSX.Element {
	const { t, comment, canEdit } = props;
	const { markup, isNew } = comment;
	const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
	const replies = props.replies.filter((reply) => reply.commentId === markup.id);
	const resolved = markup.status === 'resolved';

	React.useEffect(() => {
		if (isNew && canEdit) textareaRef.current?.focus({ preventScroll: true });
	}, [canEdit, isNew, markup.id]);

	return (
		<div className={props.variant === 'side' ? styles.side : styles.sheet} role="region" aria-label={t('documents.markupComment')}>
			<div className={styles.header}>
				<button
					type="button"
					className={styles.iconButton}
					onClick={isNew ? props.onCommentCancel : props.onBackToList}
					aria-label={t('documents.markupCommentBack')}
					title={t('documents.markupCommentBack')}
				>
					<FontAwesomeIcon icon={faArrowLeft} />
				</button>
				<span className={styles.title}>{`${t('documents.markupComment')} #${markup.number}`}</span>
				{!isNew ? (
					<span className={`${styles.status} ${resolved ? styles.statusResolved : styles.statusOpen}`}>
						{t(resolved ? 'documents.markupCommentResolved' : 'documents.markupCommentOpen')}
					</span>
				) : null}
				<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label={t('documents.markupListClose')} title={t('documents.markupListClose')}>
					<FontAwesomeIcon icon={faXmark} />
				</button>
			</div>
			<div className={styles.commentBody}>
				<p className={styles.meta}>
					{[markupFooterText(markup.author, markup.createdAt), `${t('documents.pageLabel')} ${markup.page}`].filter(Boolean).join(' · ')}
				</p>
				<textarea
					ref={textareaRef}
					className={styles.textarea}
					value={props.commentText}
					readOnly={!canEdit}
					rows={4}
					placeholder={t('documents.markupCommentPlaceholder')}
					onChange={(event) => props.onCommentChange(event.target.value)}
					onBlur={isNew ? undefined : props.onCommentSave}
					onKeyDown={(event) => {
						if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
							event.preventDefault();
							if (isNew) props.onCommentPost();
							else event.currentTarget.blur();
						} else if (event.key === 'Escape') {
							// Handled here so the viewer doesn't also take Escape as "close".
							event.preventDefault();
							event.stopPropagation();
							if (isNew) props.onCommentCancel();
							else props.onBackToList();
						}
					}}
				/>
				{resolved && markup.resolvedAt ? (
					<p className={styles.meta}>{`${t('documents.markupCommentResolvedBy')} ${markupFooterText(markup.resolvedBy, markup.resolvedAt)}`}</p>
				) : null}
				{replies.length > 0 ? (
					<section className={styles.replies}>
						<h4 className={styles.repliesTitle}>{t('documents.markupCommentReplies')}</h4>
						{replies.map((reply) => (
							<div key={reply.id} className={styles.reply}>
								<p className={styles.meta}>{markupFooterText(reply.author, reply.createdAt)}</p>
								<p className={styles.replyText}>{reply.text}</p>
							</div>
						))}
					</section>
				) : null}
			</div>
			{canEdit ? (
				<div className={styles.actions}>
					{isNew ? (
						<>
							<button type="button" className={styles.action} onClick={props.onCommentCancel}>{t('documents.markupCommentCancel')}</button>
							<button type="button" className={`${styles.action} ${styles.actionPrimary}`} onClick={props.onCommentPost} disabled={!props.commentText.trim()}>
								{t('documents.markupCommentPost')}
							</button>
						</>
					) : (
						<>
							<button type="button" className={`${styles.action} ${styles.actionDanger}`} onClick={props.onDeleteComment}>
								<FontAwesomeIcon icon={faTrashCan} />
								<span>{t('documents.markupCommentDelete')}</span>
							</button>
							<button type="button" className={`${styles.action} ${styles.actionPrimary}`} onClick={props.onToggleResolved}>
								<FontAwesomeIcon icon={resolved ? faRotateLeft : faCheck} />
								<span>{t(resolved ? 'documents.markupCommentReopen' : 'documents.markupCommentResolve')}</span>
							</button>
						</>
					)}
				</div>
			) : null}
		</div>
	);
}

function CommentsTab(props: MarkupPanelProps & { comments: readonly CommentMarkup[]; openCount: number }): React.JSX.Element {
	const { t, comments, canEdit } = props;
	const [state, setState] = React.useState<CommentsState>(rememberedCommentsState);
	const update = (patch: Partial<CommentsState>): void => {
		setState((current) => {
			const next = { ...current, ...patch };
			rememberedCommentsState = next;
			return next;
		});
	};
	const authors = React.useMemo(() => uniqueAuthors(comments), [comments]);
	const replyCounts = React.useMemo(() => {
		const counts = new Map<string, number>();
		for (const reply of props.replies) counts.set(reply.commentId, (counts.get(reply.commentId) ?? 0) + 1);
		return counts;
	}, [props.replies]);

	const resolvedCount = comments.length - props.openCount;
	const words = fold(state.query).split(/\s+/).filter(Boolean);
	const visible = comments
		.filter((comment) => state.status === 'all' || comment.status === state.status)
		.filter((comment) => !state.author || markupAuthorName(comment) === state.author)
		.filter((comment) => matchesWords(`#${comment.number} ${comment.text} ${markupAuthorName(comment)}`, words))
		.slice()
		.sort((left, right) => left.number - right.number);

	const statusChips: ReadonlyArray<{ id: CommentStatusFilter; label: string; count: number }> = [
		{ id: 'open', label: t('documents.markupCommentOpen'), count: props.openCount },
		{ id: 'resolved', label: t('documents.markupCommentResolved'), count: resolvedCount },
		{ id: 'all', label: t('documents.markupFilterAll'), count: comments.length },
	];

	return (
		<div className={props.variant === 'side' ? styles.side : styles.sheet} role="region" aria-label={t('documents.markupComments')}>
			<PanelHeader {...props} />
			<div className={styles.controls}>
				{canEdit ? (
					<button type="button" className={`${styles.action} ${styles.actionPrimary} ${styles.addComment}`} onClick={props.onAddComment}>
						<FontAwesomeIcon icon={faPlus} />
						<span>{t('documents.markupCommentsAdd')}</span>
					</button>
				) : null}
				{comments.length > 0 ? (
					<>
						<div className={styles.chips} role="tablist">
							{statusChips.map((chip) => (
								<button
									key={chip.id}
									type="button"
									role="tab"
									aria-selected={state.status === chip.id}
									className={`${styles.chip}${state.status === chip.id ? ` ${styles.chipActive}` : ''}`}
									onClick={() => update({ status: chip.id })}
								>
									{`${chip.label} ${chip.count}`}
								</button>
							))}
						</div>
						<div className={styles.searchField}>
							<FontAwesomeIcon icon={faMagnifyingGlass} className={styles.searchIcon} />
							<input
								className={styles.search}
								type="search"
								value={state.query}
								placeholder={t('documents.markupCommentsSearch')}
								aria-label={t('documents.markupCommentsSearch')}
								autoComplete="off"
								enterKeyHint="search"
								onChange={(event) => update({ query: event.target.value })}
							/>
						</div>
						{authors.length > 1 ? (
							<div className={styles.selects}>
								<select
									className={styles.select}
									value={state.author}
									onChange={(event) => update({ author: event.target.value })}
									aria-label={t('documents.markupFilterAuthor')}
								>
									<option value="">{t('documents.markupFilterEveryone')}</option>
									{authors.map((name) => <option key={name} value={name}>{name}</option>)}
								</select>
							</div>
						) : null}
					</>
				) : null}
			</div>
			<div className={styles.list}>
				{comments.length === 0 ? (
					<p className={styles.empty}>
						{t('documents.markupCommentsEmpty')}
						{canEdit ? <><br />{t('documents.markupCommentsAddHint')}</> : null}
					</p>
				) : visible.length === 0 ? (
					<p className={styles.empty}>{t('documents.markupCommentsNoMatches')}</p>
				) : (
					visible.map((comment) => {
						const resolved = comment.status === 'resolved';
						const replies = replyCounts.get(comment.id) ?? 0;
						const meta = [
							markupFooterText(comment.author, comment.createdAt),
							`${t('documents.pageLabel')} ${comment.page}`,
							replies > 0 ? `${t('documents.markupCommentReplies')}: ${replies}` : '',
						].filter(Boolean).join(' · ');
						return (
							<div
								key={comment.id}
								className={`${styles.commentRow}${comment.id === props.selectedId ? ` ${styles.rowActive}` : ''}${resolved ? ` ${styles.rowResolved}` : ''}`}
							>
								<button type="button" className={styles.commentRowMain} onClick={() => props.onReveal(comment)}>
									<RowIcon markup={comment} />
									<span className={styles.rowText}>
										<span className={styles.commentText}>{markupTitle(comment, t)}</span>
										<span className={styles.rowMeta}>{meta}</span>
									</span>
								</button>
								{canEdit ? (
									<button
										type="button"
										className={`${styles.iconButton} ${resolved ? '' : styles.resolveButton}`}
										onClick={() => props.onToggleResolvedFor(comment)}
										aria-label={t(resolved ? 'documents.markupCommentReopen' : 'documents.markupCommentResolve')}
										title={t(resolved ? 'documents.markupCommentReopen' : 'documents.markupCommentResolve')}
									>
										<FontAwesomeIcon icon={resolved ? faRotateLeft : faCheck} />
									</button>
								) : (
									<span className={`${styles.status} ${resolved ? styles.statusResolved : styles.statusOpen}`}>
										{t(resolved ? 'documents.markupCommentResolved' : 'documents.markupCommentOpen')}
									</span>
								)}
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}

function AllMarkupTab(props: MarkupPanelProps & { openCount: number }): React.JSX.Element {
	const { t, items } = props;
	const [listState, setListState] = React.useState<ListState>(rememberedListState);
	const update = (patch: Partial<ListState>): void => {
		setListState((current) => {
			const next = { ...current, ...patch };
			rememberedListState = next;
			return next;
		});
	};

	const authors = React.useMemo(() => uniqueAuthors(items), [items]);

	// "12 × Duplex receptacle", "3 × RFI": what's on the sheet, at a glance.
	const counts = React.useMemo(() => {
		const tally = new Map<string, number>();
		for (const item of items) {
			if (item.kind !== 'symbol' && item.kind !== 'stamp') continue;
			const label = item.kind === 'stamp' ? item.label : markupTitle(item, t);
			tally.set(label, (tally.get(label) ?? 0) + 1);
		}
		return Array.from(tally.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
	}, [items, t]);

	const filterTest = FILTERS.find((entry) => entry.id === listState.filter)?.test ?? FILTERS[0].test;
	const words = fold(listState.query).split(/\s+/).filter(Boolean);
	const visible = items.filter((item) => {
		if (!filterTest(item)) return false;
		if (listState.filter === 'comments' && listState.status !== 'any' && item.kind === 'comment' && item.status !== listState.status) return false;
		if (listState.author && markupAuthorName(item) !== listState.author) return false;
		return matchesWords(`${markupTitle(item, t)} ${markupMeta(item, t)}`, words);
	});

	const byPage = new Map<number, Markup[]>();
	for (const item of visible) {
		const list = byPage.get(item.page) ?? [];
		list.push(item);
		byPage.set(item.page, list);
	}
	const pages = Array.from(byPage.keys()).sort((left, right) => left - right);
	// Top to bottom, then left to right, the way people read a sheet.
	const position = (markup: Markup): [number, number] => ('y' in markup && 'x' in markup ? [markup.y, markup.x] : 'y1' in markup ? [markup.y1, markup.x1] : [markup.points[1] ?? 0, markup.points[0] ?? 0]);

	return (
		<div className={props.variant === 'side' ? styles.side : styles.sheet} role="region" aria-label={t('documents.markupTabAllMarkup')}>
			<PanelHeader {...props} />
			{items.length > 0 ? (
				<div className={styles.controls}>
					<div className={styles.searchField}>
						<FontAwesomeIcon icon={faMagnifyingGlass} className={styles.searchIcon} />
						<input
							className={styles.search}
							type="search"
							value={listState.query}
							placeholder={t('documents.markupListSearch')}
							aria-label={t('documents.markupListSearch')}
							autoComplete="off"
							enterKeyHint="search"
							onChange={(event) => update({ query: event.target.value })}
						/>
						<span className={styles.total}>{visible.length === items.length ? items.length : `${visible.length} / ${items.length}`}</span>
					</div>
					<div className={styles.chips} role="tablist">
						{FILTERS.map((entry) => (
							<button
								key={entry.id}
								type="button"
								role="tab"
								aria-selected={listState.filter === entry.id}
								className={`${styles.chip}${listState.filter === entry.id ? ` ${styles.chipActive}` : ''}`}
								onClick={() => update({ filter: entry.id })}
							>
								{t(entry.labelKey)}
							</button>
						))}
					</div>
					{listState.filter === 'comments' || authors.length > 0 ? (
						<div className={styles.selects}>
							{listState.filter === 'comments' ? (
								<select
									className={styles.select}
									value={listState.status}
									onChange={(event) => update({ status: event.target.value as StatusFilter })}
									aria-label={t('documents.markupFilterAnyStatus')}
								>
									<option value="any">{t('documents.markupFilterAnyStatus')}</option>
									<option value="open">{t('documents.markupCommentOpen')}</option>
									<option value="resolved">{t('documents.markupCommentResolved')}</option>
								</select>
							) : null}
							{authors.length > 0 ? (
								<select
									className={styles.select}
									value={listState.author}
									onChange={(event) => update({ author: event.target.value })}
									aria-label={t('documents.markupFilterAuthor')}
								>
									<option value="">{t('documents.markupFilterEveryone')}</option>
									{authors.map((name) => <option key={name} value={name}>{name}</option>)}
								</select>
							) : null}
						</div>
					) : null}
					{counts.length > 0 ? (
						<div className={styles.counts} aria-label={t('documents.markupCounts')}>
							{counts.map(([label, count]) => (
								<button key={label} type="button" className={styles.count} onClick={() => update({ query: label, filter: 'all' })} title={label}>
									<span className={styles.countLabel}>{label}</span>
									<span className={styles.countNumber}>{count}</span>
								</button>
							))}
						</div>
					) : null}
				</div>
			) : null}
			<div className={styles.list}>
				{items.length === 0 ? (
					<p className={styles.empty}>{t('documents.markupListEmpty')}</p>
				) : visible.length === 0 ? (
					<p className={styles.empty}>{t('documents.markupListNoMatches')}</p>
				) : (
					pages.map((page) => (
						<section key={page}>
							<h4 className={styles.pageTitle}>{`${t('documents.pageLabel')} ${page}`}</h4>
							{(byPage.get(page) ?? [])
								.slice()
								.sort((left, right) => {
									const [leftY, leftX] = position(left);
									const [rightY, rightX] = position(right);
									return leftY - rightY || leftX - rightX;
								})
								.map((item) => (
									<button
										key={item.id}
										type="button"
										className={`${styles.row}${item.id === props.selectedId ? ` ${styles.rowActive}` : ''}${item.kind === 'comment' && item.status === 'resolved' ? ` ${styles.rowResolved}` : ''}`}
										onClick={() => props.onReveal(item)}
									>
										<RowIcon markup={item} />
										<span className={styles.rowText}>
											<span className={styles.rowTitle}>{markupTitle(item, t)}</span>
											<span className={styles.rowMeta}>{markupMeta(item, t)}</span>
										</span>
										{item.kind === 'comment' ? (
											<span className={`${styles.status} ${item.status === 'resolved' ? styles.statusResolved : styles.statusOpen}`}>
												{t(item.status === 'resolved' ? 'documents.markupCommentResolved' : 'documents.markupCommentOpen')}
											</span>
										) : null}
									</button>
								))}
						</section>
					))
				)}
			</div>
		</div>
	);
}

export function MarkupPanel(props: MarkupPanelProps): React.JSX.Element {
	const comments = React.useMemo(
		() => props.items.filter((item): item is CommentMarkup => item.kind === 'comment'),
		[props.items],
	);
	const openCount = comments.reduce((count, comment) => count + (comment.status === 'open' ? 1 : 0), 0);

	if (props.comment) return <CommentView {...props} comment={props.comment} />;
	if (props.tab === 'comments') return <CommentsTab {...props} comments={comments} openCount={openCount} />;
	return <AllMarkupTab {...props} openCount={openCount} />;
}
