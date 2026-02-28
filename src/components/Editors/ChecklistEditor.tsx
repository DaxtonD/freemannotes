import React from 'react';
import type { ChecklistItem } from '../../core/bindings';
import styles from './Editors.module.css';

export type ChecklistEditorProps = {
	onSave: (args: { title: string; items: ChecklistItem[] }) => void | Promise<void>;
	onCancel: () => void;
};

type DraftChecklistItem = ChecklistItem;

// Local-only draft ID generator used before data is persisted to Yjs.
function makeId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ChecklistEditor(props: ChecklistEditorProps): React.JSX.Element {
	// Local draft state until user presses Save.
	const [title, setTitle] = React.useState('');
	const [items, setItems] = React.useState<DraftChecklistItem[]>([]);
	const [saving, setSaving] = React.useState(false);

	const addItem = React.useCallback((): void => {
		// Append a new draft checklist row.
		setItems((prev) => [...prev, { id: makeId(), text: '', completed: false }]);
	}, []);

	const updateItem = React.useCallback((id: string, patch: Partial<DraftChecklistItem>): void => {
		setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
	}, []);

	const removeItem = React.useCallback((id: string): void => {
		setItems((prev) => prev.filter((item) => item.id !== id));
	}, []);

	const onSubmit = async (event: React.FormEvent): Promise<void> => {
		// Submission delegates persistence to parent App handlers.
		event.preventDefault();
		if (saving) return;
		setSaving(true);
		try {
			await props.onSave({ title, items });
		} finally {
			setSaving(false);
		}
	};

	return (
		<form onSubmit={onSubmit} className={styles.form}>
			<div className={styles.title}>New Checklist Note</div>
			<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
			<div className={styles.column}>
				{items.map((item) => (
					<div key={item.id} className={styles.checklistItem}>
						<input
							type="checkbox"
							checked={item.completed}
							onChange={(e) => updateItem(item.id, { completed: e.target.checked })}
						/>
						<input
							value={item.text}
							onChange={(e) => updateItem(item.id, { text: e.target.value })}
							placeholder="Checklist item"
							className={styles.grow}
						/>
						<button type="button" onClick={() => removeItem(item.id)}>
							Remove
						</button>
					</div>
				))}
			</div>
			<div className={styles.row}>
				<button type="button" onClick={addItem} disabled={saving}>
					Add Item
				</button>
				<button type="submit" disabled={saving}>
					{saving ? 'Saving...' : 'Save'}
				</button>
				<button type="button" onClick={props.onCancel} disabled={saving}>
					Cancel
				</button>
			</div>
		</form>
	);
}
