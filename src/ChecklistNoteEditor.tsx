import React from 'react';
import type { ChecklistItem } from './core/bindings';

export type ChecklistNoteEditorProps = {
	onSave: (args: { title: string; items: ChecklistItem[] }) => void | Promise<void>;
	onCancel: () => void;
};

type DraftChecklistItem = ChecklistItem;

function makeId(): string {
	// Branch: modern browsers.
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	// Branch: fallback for environments without randomUUID.
	return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ChecklistNoteEditor(props: ChecklistNoteEditorProps): React.JSX.Element {
	const [title, setTitle] = React.useState('');
	const [items, setItems] = React.useState<DraftChecklistItem[]>([]);
	const [saving, setSaving] = React.useState(false);

	const addItem = React.useCallback((): void => {
		setItems((prev) => [...prev, { id: makeId(), text: '', completed: false }]);
	}, []);

	const updateItem = React.useCallback((id: string, patch: Partial<DraftChecklistItem>): void => {
		setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
	}, []);

	const removeItem = React.useCallback((id: string): void => {
		setItems((prev) => prev.filter((item) => item.id !== id));
	}, []);

	const onSubmit = async (event: React.FormEvent): Promise<void> => {
		event.preventDefault();
		// Branch: prevent duplicate saves while async write is in progress.
		if (saving) return;
		setSaving(true);
		try {
			await props.onSave({ title, items });
		} finally {
			setSaving(false);
		}
	};

	return (
		<form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
			<div style={{ fontWeight: 600 }}>New Checklist Note</div>
			<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
			<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
				{items.map((item) => (
					<div key={item.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
						<input
							type="checkbox"
							checked={item.completed}
							onChange={(e) => updateItem(item.id, { completed: e.target.checked })}
						/>
						<input
							value={item.text}
							onChange={(e) => updateItem(item.id, { text: e.target.value })}
							placeholder="Checklist item"
							style={{ flex: 1 }}
						/>
						<button type="button" onClick={() => removeItem(item.id)}>
							Remove
						</button>
					</div>
				))}
			</div>
			<div style={{ display: 'flex', gap: 8 }}>
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
