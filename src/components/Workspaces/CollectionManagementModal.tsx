import React from 'react';
import { buildCollectionPathMap, buildCollectionTree, type CollectionRecord, type CollectionTreeNode } from '../../services/collectionService';
import { TreeSelector, type TreeSelectorItem } from '../shared/TreeSelector';
import styles from '../shared/MetadataModal.module.css';

type CollectionManagementModalProps = {
	isOpen: boolean;
	onClose: () => void;
	collections: readonly CollectionRecord[];
	onCreate: (args: { name: string; parentId: string | null }) => void;
	onRename: (collectionId: string, nextName: string) => void;
	onDelete: (collectionId: string) => void;
};

export function CollectionManagementModal(props: CollectionManagementModalProps): React.JSX.Element | null {
	const [name, setName] = React.useState('');
	const [parentId, setParentId] = React.useState<string>('');

	React.useEffect(() => {
		if (!props.isOpen) return;
		// Reset the draft fields on each open so stale input from a previous edit
		// session does not leak into the next collection action.
		setName('');
		setParentId('');
	}, [props.isOpen]);

	const collectionTree = React.useMemo(() => buildCollectionTree(props.collections), [props.collections]);
	const pathById = React.useMemo(() => buildCollectionPathMap(props.collections), [props.collections]);
	const toTreeItems = React.useCallback((nodes: readonly CollectionTreeNode[]): TreeSelectorItem[] => {
		return nodes.map((node) => ({
			id: node.id,
			label: node.name,
			meta: node.parentId ? pathById.get(node.id) ?? node.name : 'Top level',
			children: toTreeItems(node.children),
		}));
	}, [pathById]);
	const treeItems = React.useMemo<TreeSelectorItem[]>(() => toTreeItems(collectionTree), [collectionTree, toTreeItems]);

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={`${styles.modal} ${styles.compactModal}`} role="dialog" aria-modal="true" aria-label="Manage collections" onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<div className={styles.titleBlock}>
						<h2 className={styles.title}>Manage collections</h2>
						<p className={styles.description}>Create, nest, rename, and remove collections.</p>
					</div>
					<button type="button" className={styles.closeButton} onClick={props.onClose} aria-label="Close">✕</button>
				</header>

				<div className={`${styles.section} ${styles.compactSection}`}>
					<div className={styles.field}>
						<label className={styles.fieldLabel} htmlFor="collection-name">Collection name</label>
						<input id="collection-name" className={styles.input} value={name} onChange={(event) => setName(event.target.value)} placeholder="New collection" />
					</div>
					<div className={styles.field}>
						<div className={styles.fieldLabel}>Parent collection</div>
						<div className={styles.treePath}>{parentId ? pathById.get(parentId) ?? 'Top level' : 'Top level'}</div>
						<button type="button" className={styles.ghostButton} onClick={() => setParentId('')}>Place at top level</button>
						<TreeSelector
							items={treeItems}
							selectedId={parentId || null}
							onSelect={(id) => setParentId(id)}
							renderActions={(item) => (
								<>
									<button
										type="button"
										className={styles.treeActionButton}
										onClick={(event) => {
											event.stopPropagation();
											const collection = props.collections.find((entry) => entry.id === item.id);
											const nextName = window.prompt('Rename collection', collection?.name ?? item.label)?.trim();
											if (!nextName) return;
											props.onRename(item.id, nextName);
										}}
									>
										Rename
									</button>
									<button
										type="button"
										className={styles.treeActionButton}
										onClick={(event) => {
											event.stopPropagation();
											const collection = props.collections.find((entry) => entry.id === item.id);
											if (!window.confirm(`Delete ${collection?.name ?? item.label}?`)) return;
											props.onDelete(item.id);
										}}
									>
										Delete
									</button>
								</>
							)}
							emptyLabel="No collections yet."
						/>
					</div>
					<div className={styles.actions}>
						<button
							type="button"
							className={styles.primaryButton}
							onClick={() => {
								props.onCreate({ name, parentId: parentId || null });
								setName('');
								setParentId('');
							}}
							disabled={!name.trim()}
						>
							Create collection
						</button>
					</div>
				</div>
			</section>
		</div>
	);
}