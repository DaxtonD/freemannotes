import React from 'react';
import { buildCollectionPathMap, buildCollectionTree, type CollectionRecord, type CollectionTreeNode } from '../../services/collectionService';
import { TreeSelector, type TreeSelectorItem } from '../shared/TreeSelector';
import styles from '../shared/MetadataModal.module.css';

type NoteCollectionModalProps = {
	isOpen: boolean;
	onClose: () => void;
	collections: readonly CollectionRecord[];
	selectedCollectionId: string | null;
	noteTitle?: string;
	onSelectCollection: (collectionId: string | null) => void;
};

export function NoteCollectionModal(props: NoteCollectionModalProps): React.JSX.Element | null {
	const [searchQuery, setSearchQuery] = React.useState('');

	React.useEffect(() => {
		if (!props.isOpen) return;
		setSearchQuery('');
	}, [props.isOpen]);

	const collectionTree = React.useMemo(() => buildCollectionTree(props.collections), [props.collections]);
	const pathById = React.useMemo(() => buildCollectionPathMap(props.collections), [props.collections]);
	const toTreeItems = React.useCallback((nodes: readonly CollectionTreeNode[]): TreeSelectorItem[] => {
		return nodes.map((node) => ({
			id: node.id,
			label: node.name,
			meta: pathById.get(node.id) ?? node.name,
			children: toTreeItems(node.children),
		}));
	}, [pathById]);
	const treeItems = React.useMemo<TreeSelectorItem[]>(() => toTreeItems(collectionTree), [collectionTree, toTreeItems]);
	const selectedPath = props.selectedCollectionId ? pathById.get(props.selectedCollectionId) ?? 'Unknown collection' : 'No collection';

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={styles.modal} role="dialog" aria-modal="true" aria-label="Add to collection" onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<div className={styles.titleBlock}>
						<h2 className={styles.title}>Add to collection</h2>
						<p className={styles.description}>{props.noteTitle?.trim() ? props.noteTitle.trim() : 'Choose where this note belongs.'}</p>
					</div>
					<button type="button" className={styles.closeButton} onClick={props.onClose} aria-label="Close">✕</button>
				</header>
				<div className={styles.section}>
					<div className={styles.treePath}>Current collection: {selectedPath}</div>
					<input
						className={styles.search}
						type="search"
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						placeholder="Search collections"
					/>
					<button type="button" className={styles.ghostButton} onClick={() => props.onSelectCollection(null)}>
						Remove from collection
					</button>
					<TreeSelector
						items={treeItems}
						selectedId={props.selectedCollectionId}
						onSelect={(id) => props.onSelectCollection(id)}
						searchQuery={searchQuery}
						emptyLabel="No matching collections."
					/>
				</div>
			</section>
		</div>
	);
}