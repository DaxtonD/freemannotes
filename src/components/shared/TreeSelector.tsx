import React from 'react';
import styles from './MetadataModal.module.css';

export type TreeSelectorItem = {
	id: string;
	label: string;
	depth?: number;
	meta?: string | null;
	children?: readonly TreeSelectorItem[];
};

type TreeSelectorProps = {
	items: readonly TreeSelectorItem[];
	selectedId?: string | null;
	onSelect: (id: string) => void;
	renderActions?: (item: TreeSelectorItem) => React.ReactNode;
	searchQuery?: string;
	emptyLabel?: string;
	expandedIds?: readonly string[];
	onExpandedIdsChange?: (expandedIds: string[]) => void;
};

function filterTreeItems(items: readonly TreeSelectorItem[], normalizedQuery: string): TreeSelectorItem[] {
	if (!normalizedQuery) return [...items];
	const next: TreeSelectorItem[] = [];
	for (const item of items) {
		const childMatches = item.children ? filterTreeItems(item.children, normalizedQuery) : [];
		const matchesSelf = item.label.toLowerCase().includes(normalizedQuery) || String(item.meta || '').toLowerCase().includes(normalizedQuery);
		if (!matchesSelf && childMatches.length === 0) continue;
		next.push({
			...item,
			children: matchesSelf ? item.children : childMatches,
		});
	}
	return next;
}

function collectAncestorIds(items: readonly TreeSelectorItem[], targetId: string | null | undefined, ancestors: string[] = []): string[] {
	if (!targetId) return [];
	for (const item of items) {
		if (item.id === targetId) return ancestors;
		const nested = collectAncestorIds(item.children ?? [], targetId, [...ancestors, item.id]);
		if (nested.length > 0) return nested;
	}
	return [];
}

function collectBranchIds(items: readonly TreeSelectorItem[]): string[] {
	const output: string[] = [];
	const walk = (list: readonly TreeSelectorItem[]): void => {
		for (const item of list) {
			if ((item.children?.length ?? 0) > 0) output.push(item.id);
			walk(item.children ?? []);
		}
	};
	walk(items);
	return output;
}

export function TreeSelector(props: TreeSelectorProps): React.JSX.Element {
	const normalizedQuery = props.searchQuery?.trim().toLowerCase() ?? '';
	const items = React.useMemo(() => filterTreeItems(props.items, normalizedQuery), [normalizedQuery, props.items]);
	const selectedAncestorIds = React.useMemo(() => collectAncestorIds(props.items, props.selectedId ?? null), [props.items, props.selectedId]);
	const searchExpandedIds = React.useMemo(() => new Set<string>(normalizedQuery ? collectBranchIds(items) : []), [items, normalizedQuery]);
	const [internalExpandedIds, setInternalExpandedIds] = React.useState<string[]>([]);
	const expandedIds = props.expandedIds ? [...props.expandedIds] : internalExpandedIds;
	// Keep the selected path and any live search matches expanded so tree pickers do
	// not collapse the exact branch the user is trying to inspect.
	const expandedSet = React.useMemo(() => new Set([...expandedIds, ...selectedAncestorIds, ...searchExpandedIds]), [expandedIds, searchExpandedIds, selectedAncestorIds]);
	const updateExpandedIds = React.useCallback((nextExpandedIds: string[]) => {
		if (props.onExpandedIdsChange) {
			props.onExpandedIdsChange(nextExpandedIds);
			return;
		}
		setInternalExpandedIds(nextExpandedIds);
	}, [props.onExpandedIdsChange]);
	const toggleExpanded = React.useCallback((itemId: string) => {
		const next = new Set(expandedIds);
		if (next.has(itemId)) {
			next.delete(itemId);
		} else {
			next.add(itemId);
		}
		updateExpandedIds(Array.from(next));
	}, [expandedIds, updateExpandedIds]);

	if (items.length === 0) {
		return <div className={styles.muted}>{props.emptyLabel ?? 'Nothing to show.'}</div>;
	}

	const renderNode = (item: TreeSelectorItem, depth: number): React.ReactNode => {
		const hasChildren = (item.children?.length ?? 0) > 0;
		const isExpanded = expandedSet.has(item.id);
		const isActive = props.selectedId === item.id;
		const actions = props.renderActions?.(item) ?? null;
		return (
			<div key={item.id} className={styles.treeNode}>
				<div className={styles.treeRow} style={{ paddingLeft: `${depth * 12}px` }}>
					{hasChildren ? (
						<button
							type="button"
							className={`${styles.treeDisclosure}${isExpanded ? ` ${styles.treeDisclosureOpen}` : ''}`}
							onClick={() => toggleExpanded(item.id)}
							aria-label={isExpanded ? 'Collapse branch' : 'Expand branch'}
						>
							<span className={styles.treeDisclosureIcon} aria-hidden="true" />
						</button>
					) : <span className={styles.treeDisclosureSpacer} aria-hidden="true" />}
					<button
						type="button"
						className={`${styles.treeButton}${isActive ? ` ${styles.treeButtonActive}` : ''}`}
						onClick={() => props.onSelect(item.id)}
					>
						<span className={styles.treeLabelBlock}>
							<span className={styles.treeLabel}>{item.label}</span>
							{item.meta ? <span className={styles.treeMeta}>{item.meta}</span> : null}
						</span>
					</button>
					{actions ? <div className={styles.treeActions}>{actions}</div> : null}
				</div>
				{hasChildren ? (
					<div className={`${styles.treeChildren}${isExpanded ? ` ${styles.treeChildrenOpen}` : ''}`}>
						<div className={styles.treeChildrenContent}>
							{isExpanded ? item.children?.map((child) => renderNode(child, depth + 1)) : null}
						</div>
					</div>
				) : null}
			</div>
		);
	};

	return (
		<div className={styles.treeList}>
			{items.map((item) => renderNode(item, item.depth ?? 0))}
		</div>
	);
}