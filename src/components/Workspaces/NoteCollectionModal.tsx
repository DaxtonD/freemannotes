import React from 'react';
import { useI18n } from '../../core/i18n';
import { buildCollectionPathMap, buildCollectionTree, hasCollectionNameConflict, type CollectionRecord, type CollectionTreeNode } from '../../services/collectionService';
import styles from '../shared/MetadataModal.module.css';

type DraftTreeAction =
	| { mode: 'create'; parentId: string | null; name: string }
	| { mode: 'rename'; collectionId: string; name: string };

function filterCollectionTree(nodes: readonly CollectionTreeNode[], normalizedQuery: string): CollectionTreeNode[] {
	if (!normalizedQuery) return [...nodes];
	const next: CollectionTreeNode[] = [];
	for (const node of nodes) {
		const childMatches = filterCollectionTree(node.children, normalizedQuery);
		const matchesSelf = node.name.toLowerCase().includes(normalizedQuery);
		if (!matchesSelf && childMatches.length === 0) continue;
		next.push({
			...node,
			children: matchesSelf ? node.children : childMatches,
		});
	}
	return next;
}

function collectAncestorIds(nodes: readonly CollectionTreeNode[], targetId: string | null | undefined, ancestors: string[] = []): string[] {
	if (!targetId) return [];
	for (const node of nodes) {
		if (node.id === targetId) return ancestors;
		const nested = collectAncestorIds(node.children, targetId, [...ancestors, node.id]);
		if (nested.length > 0) return nested;
	}
	return [];
}

function collectBranchIds(nodes: readonly CollectionTreeNode[]): string[] {
	const output: string[] = [];
	const walk = (list: readonly CollectionTreeNode[]): void => {
		for (const node of list) {
			// Search expands the whole matching branch so deep descendants remain
			// visible without the user manually opening each intermediate parent.
			output.push(node.id);
			walk(node.children);
		}
	};
	walk(nodes);
	return output;
}

type NoteCollectionModalProps = {
	isOpen: boolean;
	onClose: () => void;
	collections: readonly CollectionRecord[];
	selectedCollectionId: string | null;
	noteTitle?: string;
	onCreate: (args: { name: string; parentId: string | null }) => string | null;
	onRename: (collectionId: string, nextName: string) => boolean;
	onDelete: (collectionId: string) => void;
	onSelectCollection: (collectionId: string | null) => void;
};

export function NoteCollectionModal(props: NoteCollectionModalProps): React.JSX.Element | null {
	const { t } = useI18n();
	const [searchQuery, setSearchQuery] = React.useState('');
	const [expandedIds, setExpandedIds] = React.useState<string[]>([]);
	const [draftAction, setDraftAction] = React.useState<DraftTreeAction | null>(null);
	const [validationMessage, setValidationMessage] = React.useState<string | null>(null);
	const wasOpenRef = React.useRef(false);
	const onCloseRef = React.useRef(props.onClose);

	React.useEffect(() => {
		onCloseRef.current = props.onClose;
	}, [props.onClose]);

	const collectionTree = React.useMemo(() => buildCollectionTree(props.collections), [props.collections]);
	const collectionById = React.useMemo(() => new Map(props.collections.map((entry) => [entry.id, entry] as const)), [props.collections]);
	const pathById = React.useMemo(() => buildCollectionPathMap(props.collections), [props.collections]);
	const normalizedQuery = searchQuery.trim().toLowerCase();
	const filteredTree = React.useMemo(() => filterCollectionTree(collectionTree, normalizedQuery), [collectionTree, normalizedQuery]);
	const selectedAncestorIds = React.useMemo(() => collectAncestorIds(collectionTree, props.selectedCollectionId), [collectionTree, props.selectedCollectionId]);
	const draftTargetId = draftAction ? (draftAction.mode === 'create' ? draftAction.parentId : draftAction.collectionId) : null;
	const draftAncestorIds = React.useMemo(() => collectAncestorIds(collectionTree, draftTargetId), [collectionTree, draftTargetId]);
	const expandedSet = React.useMemo(
		() => new Set<string>([...expandedIds, ...draftAncestorIds]),
		[draftAncestorIds, expandedIds]
	);
	const selectedPath = props.selectedCollectionId
		? pathById.get(props.selectedCollectionId) ?? t('collections.noneSelected')
		: t('collections.noneSelected');
	const noteTitle = props.noteTitle?.trim() || t('note.untitled');
	const selectedCollectionName = props.selectedCollectionId ? (collectionById.get(props.selectedCollectionId)?.name ?? '') : '';

	React.useEffect(() => {
		if (props.isOpen && !wasOpenRef.current) {
			setSearchQuery('');
			setExpandedIds(selectedAncestorIds);
			setDraftAction(null);
			setValidationMessage(null);
		}
		wasOpenRef.current = props.isOpen;
	}, [props.isOpen, selectedAncestorIds]);

	React.useEffect(() => {
		if (typeof document === 'undefined' || !props.isOpen) return;
		const prevBodyOverflow = document.body.style.overflow;
		const prevBodyOverscroll = (document.body.style as unknown as { overscrollBehavior?: string }).overscrollBehavior;
		const prevHtmlOverflow = document.documentElement.style.overflow;
		const prevHtmlOverscroll = (document.documentElement.style as unknown as { overscrollBehavior?: string }).overscrollBehavior;
		document.body.style.overflow = 'hidden';
		(document.body.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = 'none';
		document.documentElement.style.overflow = 'hidden';
		(document.documentElement.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = 'none';
		return () => {
			document.body.style.overflow = prevBodyOverflow;
			(document.body.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = prevBodyOverscroll || '';
			document.documentElement.style.overflow = prevHtmlOverflow;
			(document.documentElement.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = prevHtmlOverscroll || '';
		};
	}, [props.isOpen]);

	React.useEffect(() => {
		if (!props.isOpen || typeof window === 'undefined') return;
		const mql = window.matchMedia('(pointer: coarse)');
		if (!mql.matches) return;

		// Mobile overlays participate in the history stack so the Android back
		// gesture closes the modal before navigating away from the current page.
		const isCollectionModalHistoryEntry = (state: unknown): state is { __noteCollectionModal: true } => {
			if (!state || typeof state !== 'object') return false;
			return (state as { __noteCollectionModal?: unknown }).__noteCollectionModal === true;
		};

		let active = true;
		let didPush = false;

		const pushTimer = window.setTimeout(() => {
			if (!active) return;
			didPush = true;
			window.history.pushState({ __noteCollectionModal: true }, '');
		}, 0);

		const onPopState = (): void => {
			if (active && didPush) {
				active = false;
				onCloseRef.current();
			}
		};

		window.addEventListener('popstate', onPopState);
		return () => {
			window.clearTimeout(pushTimer);
			window.removeEventListener('popstate', onPopState);
			if (active && didPush && isCollectionModalHistoryEntry(window.history.state)) {
				active = false;
				window.history.back();
			}
			active = false;
		};
	}, [props.isOpen]);

	React.useEffect(() => {
		if (!props.isOpen || !normalizedQuery) return;
		setExpandedIds(collectBranchIds(filteredTree));
	}, [filteredTree, normalizedQuery, props.isOpen]);

	const toggleExpanded = React.useCallback((collectionId: string): void => {
		setExpandedIds((current) => current.includes(collectionId)
			? current.filter((entry) => entry !== collectionId)
			: [...current, collectionId]);
	}, []);

	const openCreateDraft = React.useCallback((parentId: string | null): void => {
		if (parentId) {
			setExpandedIds((current) => current.includes(parentId) ? current : [...current, parentId]);
		}
		setValidationMessage(null);
		setDraftAction({ mode: 'create', parentId, name: '' });
	}, []);

	const openRenameDraft = React.useCallback((collectionId: string, name: string): void => {
		setValidationMessage(null);
		setDraftAction({ mode: 'rename', collectionId, name });
	}, []);

	const updateDraftName = React.useCallback((name: string): void => {
		setValidationMessage(null);
		setDraftAction((current) => current ? { ...current, name } : current);
	}, []);

	const closeDraft = React.useCallback((): void => {
		setValidationMessage(null);
		setDraftAction(null);
	}, []);

	const submitDraft = React.useCallback((): void => {
		if (!draftAction) return;
		const nextName = draftAction.name.trim();
		if (!nextName) return;
		const conflict = draftAction.mode === 'create'
			? hasCollectionNameConflict(props.collections, nextName, draftAction.parentId)
			: hasCollectionNameConflict(props.collections, nextName, collectionById.get(draftAction.collectionId)?.parentId ?? null, draftAction.collectionId);
		if (conflict) {
			setValidationMessage(t('collections.duplicateNameError'));
			return;
		}
		if (draftAction.mode === 'create') {
			const createdId = props.onCreate({ name: nextName, parentId: draftAction.parentId });
			if (!createdId) {
				setValidationMessage(t('collections.duplicateNameError'));
				return;
			}
			setValidationMessage(null);
			setDraftAction(null);
			props.onSelectCollection(createdId);
			return;
		}
		if (!props.onRename(draftAction.collectionId, nextName)) {
			setValidationMessage(t('collections.duplicateNameError'));
			return;
		}
		setValidationMessage(null);
		setDraftAction(null);
	}, [collectionById, draftAction, props, t]);

	const handleDelete = React.useCallback((collectionId: string, name: string): void => {
		if (!window.confirm(t('collections.deleteConfirmPrefix').replace('{name}', name))) return;
		props.onDelete(collectionId);
		setDraftAction((current) => {
			if (!current) return null;
			if (current.mode === 'rename' && current.collectionId === collectionId) return null;
			if (current.mode === 'create' && current.parentId === collectionId) return null;
			return current;
		});
		setExpandedIds((current) => current.filter((entry) => entry !== collectionId));
		setValidationMessage(null);
	}, [props, t]);

	const startCreateFromSelection = React.useCallback((): void => {
		openCreateDraft(props.selectedCollectionId);
	}, [openCreateDraft, props.selectedCollectionId]);

	const startRenameFromSelection = React.useCallback((): void => {
		if (!props.selectedCollectionId || !selectedCollectionName) return;
		openRenameDraft(props.selectedCollectionId, selectedCollectionName);
	}, [openRenameDraft, props.selectedCollectionId, selectedCollectionName]);

	const deleteSelectedCollection = React.useCallback((): void => {
		if (!props.selectedCollectionId || !selectedCollectionName) return;
		handleDelete(props.selectedCollectionId, selectedCollectionName);
	}, [handleDelete, props.selectedCollectionId, selectedCollectionName]);

	const handleDraftKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>): void => {
		if (event.key === 'Enter') {
			event.preventDefault();
			submitDraft();
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			closeDraft();
		}
	}, [closeDraft, submitDraft]);

	const renderDraftEditor = React.useCallback((): React.JSX.Element | null => {
		if (!draftAction) return null;
		return (
			<div className={styles.collectionTreeInlineEditor}>
				{draftAction.mode === 'rename' ? <span className={styles.collectionTreeInlineGlyph} aria-hidden="true">Rename</span> : null}
				<input
					autoFocus
					className={styles.collectionTreeInlineInput}
					value={draftAction.name}
					onChange={(event) => updateDraftName(event.target.value)}
					onKeyDown={handleDraftKeyDown}
					placeholder={t('collections.newPlaceholder')}
				/>
				<div className={styles.collectionTreeInlineActions}>
					<button
						type="button"
						className={styles.collectionTreeActionButton}
						onClick={submitDraft}
						disabled={!draftAction.name.trim()}
					>
						{t('common.save')}
					</button>
					<button type="button" className={styles.collectionTreeActionButton} onClick={closeDraft}>
						{t('common.cancel')}
					</button>
				</div>
			</div>
		);
	}, [closeDraft, draftAction, handleDraftKeyDown, submitDraft, t, updateDraftName]);

	const renderTreeNode = React.useCallback((node: CollectionTreeNode, depth: number): React.JSX.Element => {
		const isExpanded = expandedSet.has(node.id);
		const isActive = props.selectedCollectionId === node.id;
		const isRenaming = draftAction?.mode === 'rename' && draftAction.collectionId === node.id;
		const isCreatingHere = draftAction?.mode === 'create' && draftAction.parentId === node.id;
		const pathLabel = pathById.get(node.id) ?? node.name;
		const showPathMeta = normalizedQuery.length > 0 && pathLabel !== node.name;

		return (
			<div key={node.id} className={styles.collectionTreeNode}>
				<div
					className={styles.collectionTreeRow}
					style={{ ['--collection-tree-depth' as const]: depth } as React.CSSProperties}
				>
					<button
						type="button"
						className={`${styles.collectionTreeDisclosure}${isExpanded ? ` ${styles.collectionTreeDisclosureOpen}` : ''}`}
						onClick={() => toggleExpanded(node.id)}
						aria-label={isExpanded ? 'Collapse branch' : 'Expand branch'}
					>
						<span className={styles.collectionTreeDisclosureIcon} aria-hidden="true" />
					</button>
					{isRenaming ? (
						renderDraftEditor()
					) : (
						<button
							type="button"
							className={`${styles.collectionTreeButton}${isActive ? ` ${styles.collectionTreeButtonActive}` : ''}`}
							onClick={() => {
								setDraftAction(null);
								props.onSelectCollection(node.id);
							}}
							title={pathLabel}
						>
							<span className={styles.collectionTreeLabelBlock}>
								<span className={styles.collectionTreeLabel}>{node.name}</span>
								{showPathMeta ? <span className={styles.collectionTreeMeta}>{pathLabel}</span> : null}
							</span>
						</button>
					)}
				</div>
				{isExpanded ? (
					<div className={styles.collectionTreeBranch}>
						{isCreatingHere ? <div className={styles.collectionTreeDraftRow}>{renderDraftEditor()}</div> : null}
						{node.children.map((child) => renderTreeNode(child, depth + 1))}
					</div>
				) : null}
			</div>
		);
	}, [draftAction, expandedSet, normalizedQuery.length, pathById, props, renderDraftEditor, toggleExpanded]);

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={`${styles.modal} ${styles.compactModal} ${styles.collectionModal}`} role="dialog" aria-modal="true" aria-label={t('noteMenu.addToCollection')} onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<div className={styles.titleBlock}>
						<h2 className={styles.title}>{t('noteMenu.addToCollection')}</h2>
						<div className={styles.collectionHeaderMeta}>
							<div className={styles.collectionHeaderLine}>
								<span className={styles.collectionHeaderLabel}>{t('collections.noteLabel')}:</span>
								<span className={styles.collectionHeaderValue}>{noteTitle}</span>
							</div>
							<div className={styles.collectionHeaderLine}>
								<span className={styles.collectionHeaderLabel}>{t('collections.currentLabel')}:</span>
								<span className={styles.collectionHeaderValue}>{selectedPath}</span>
							</div>
						</div>
					</div>
					<button type="button" className={styles.closeButton} onClick={props.onClose} aria-label={t('common.close')}>✕</button>
				</header>
				<div className={`${styles.section} ${styles.compactSection} ${styles.collectionModalSection}`}>
					<input
						className={styles.search}
						type="search"
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						placeholder={t('collections.searchPlaceholder')}
					/>
					<div className={styles.collectionTreeToolbar}>
						<div className={styles.collectionTreeToolbarActions}>
							<button type="button" className={styles.primaryButton} onClick={startCreateFromSelection}>
								{t('collections.createAction')}
							</button>
							<button type="button" className={styles.secondaryButton} onClick={startRenameFromSelection} disabled={!props.selectedCollectionId}>
								{t('collections.renameAction')}
							</button>
							<button type="button" className={styles.dangerButton} onClick={deleteSelectedCollection} disabled={!props.selectedCollectionId}>
								{t('collections.deleteAction')}
							</button>
						</div>
					</div>
					{validationMessage ? <p className={styles.validationMessage}>{validationMessage}</p> : null}
					<div className={styles.collectionTreeShell} aria-label={t('noteMenu.addToCollection')}>
						<div className={`${styles.treeList} ${styles.collectionTreeList}`}>
							<div className={styles.collectionTreeNode}>
								<div className={styles.collectionTreeRow}>
									<span className={styles.collectionTreeDisclosureSpacer} aria-hidden="true" />
									{draftAction?.mode === 'create' && draftAction.parentId === null ? (
										renderDraftEditor()
									) : (
										<button
											type="button"
											className={`${styles.collectionTreeButton}${props.selectedCollectionId ? '' : ` ${styles.collectionTreeButtonActive}`}`}
											onClick={() => {
												setDraftAction(null);
												props.onSelectCollection(null);
											}}
										>
											<span className={styles.collectionTreeLabelBlock}>
												<span className={styles.collectionTreeLabel}>{t('collections.noneSelected')}</span>
											</span>
										</button>
									)}
								</div>
							</div>
							{filteredTree.map((node) => renderTreeNode(node, 0))}
							{filteredTree.length === 0 && normalizedQuery ? <div className={styles.collectionTreeEmpty}>{t('collections.noMatches')}</div> : null}
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}