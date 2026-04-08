import React from 'react';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
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
			output.push(node.id);
			walk(node.children);
		}
	};
	walk(nodes);
	return output;
}

type CollectionManagementModalProps = {
	isOpen: boolean;
	onClose: () => void;
	collections: readonly CollectionRecord[];
	onCreate: (args: { name: string; parentId: string | null }) => string | null;
	onRename: (collectionId: string, nextName: string) => boolean;
	onDelete: (collectionId: string) => void;
};

export function CollectionManagementModal(props: CollectionManagementModalProps): React.JSX.Element | null {
	const { t } = useI18n();
	useBodyScrollLock(props.isOpen, { disableTouchAction: false });
	const [searchQuery, setSearchQuery] = React.useState('');
	const [expandedIds, setExpandedIds] = React.useState<string[]>([]);
	const [draftAction, setDraftAction] = React.useState<DraftTreeAction | null>(null);
	const [selectedCollectionId, setSelectedCollectionId] = React.useState<string | null>(null);
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
	const draftTargetId = draftAction ? (draftAction.mode === 'create' ? draftAction.parentId : draftAction.collectionId) : null;
	const draftAncestorIds = React.useMemo(() => collectAncestorIds(collectionTree, draftTargetId), [collectionTree, draftTargetId]);
	const expandedSet = React.useMemo(
		() => new Set<string>([...expandedIds, ...draftAncestorIds]),
		[draftAncestorIds, expandedIds]
	);
	const selectedCollectionName = selectedCollectionId ? (collectionById.get(selectedCollectionId)?.name ?? '') : '';

	React.useEffect(() => {
		if (props.isOpen && !wasOpenRef.current) {
			setSearchQuery('');
			setExpandedIds([]);
			setDraftAction(null);
			setSelectedCollectionId(null);
			setValidationMessage(null);
		}
		wasOpenRef.current = props.isOpen;
	}, [props.isOpen]);

	React.useEffect(() => {
		if (!props.isOpen || typeof window === 'undefined') return;
		const mql = window.matchMedia('(pointer: coarse)');
		if (!mql.matches) return;

		const isCollectionManagementHistoryEntry = (state: unknown): state is { __collectionManagementModal: true } => {
			if (!state || typeof state !== 'object') return false;
			return (state as { __collectionManagementModal?: unknown }).__collectionManagementModal === true;
		};

		let active = true;
		let didPush = false;

		const pushTimer = window.setTimeout(() => {
			if (!active) return;
			didPush = true;
			window.history.pushState({ __collectionManagementModal: true }, '');
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
			if (active && didPush && isCollectionManagementHistoryEntry(window.history.state)) {
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
			setSelectedCollectionId(createdId);
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
		setSelectedCollectionId((current) => current === collectionId ? null : current);
		setValidationMessage(null);
	}, [props, t]);

	const startCreateFromSelection = React.useCallback((): void => {
		openCreateDraft(selectedCollectionId);
	}, [openCreateDraft, selectedCollectionId]);

	const startRenameFromSelection = React.useCallback((): void => {
		if (!selectedCollectionId || !selectedCollectionName) return;
		openRenameDraft(selectedCollectionId, selectedCollectionName);
	}, [openRenameDraft, selectedCollectionId, selectedCollectionName]);

	const deleteSelectedCollection = React.useCallback((): void => {
		if (!selectedCollectionId || !selectedCollectionName) return;
		handleDelete(selectedCollectionId, selectedCollectionName);
	}, [handleDelete, selectedCollectionId, selectedCollectionName]);

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
		const isActive = selectedCollectionId === node.id;
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
								setSelectedCollectionId(node.id);
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
	}, [draftAction, expandedSet, normalizedQuery.length, pathById, renderDraftEditor, selectedCollectionId, toggleExpanded]);

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={`${styles.modal} ${styles.compactModal} ${styles.collectionModal}`} role="dialog" aria-modal="true" aria-label={t('collections.manageTitle')} onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<div className={styles.titleBlock}>
						<h2 className={styles.title}>{t('collections.manageTitle')}</h2>
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
							<button type="button" className={styles.secondaryButton} onClick={startRenameFromSelection} disabled={!selectedCollectionId}>
								{t('collections.renameAction')}
							</button>
							<button type="button" className={styles.dangerButton} onClick={deleteSelectedCollection} disabled={!selectedCollectionId}>
								{t('collections.deleteAction')}
							</button>
						</div>
					</div>
					{validationMessage ? <p className={styles.validationMessage}>{validationMessage}</p> : null}
					<div className={styles.collectionTreeShell} aria-label={t('collections.manageTitle')}>
						<div className={`${styles.treeList} ${styles.collectionTreeList}`}>
							<div className={styles.collectionTreeNode}>
								<div className={styles.collectionTreeRow}>
									<span className={styles.collectionTreeDisclosureSpacer} aria-hidden="true" />
									{draftAction?.mode === 'create' && draftAction.parentId === null ? (
										renderDraftEditor()
									) : (
										<button
											type="button"
											className={`${styles.collectionTreeButton}${selectedCollectionId ? '' : ` ${styles.collectionTreeButtonActive}`}`}
											onClick={() => {
												setDraftAction(null);
												setSelectedCollectionId(null);
											}}
										>
											<span className={styles.collectionTreeLabelBlock}>
												<span className={styles.collectionTreeLabel}>{t('collections.topLevelLabel')}</span>
											</span>
										</button>
									)}
								</div>
							</div>
							{!props.collections.length && !normalizedQuery && !(draftAction?.mode === 'create' && draftAction.parentId === null)
								? <div className={styles.collectionTreeEmpty}>{t('collections.emptyState')}</div>
								: null}
							{filteredTree.map((node) => renderTreeNode(node, 0))}
							{normalizedQuery && filteredTree.length === 0 ? <div className={styles.collectionTreeEmpty}>{t('collections.noMatches')}</div> : null}
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}