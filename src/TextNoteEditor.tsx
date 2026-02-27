import React from 'react';

export type TextNoteEditorProps = {
	onSave: (args: { title: string; body: string }) => void | Promise<void>;
	onCancel: () => void;
};

export function TextNoteEditor(props: TextNoteEditorProps): React.JSX.Element {
	const [title, setTitle] = React.useState('');
	const [body, setBody] = React.useState('');
	const [saving, setSaving] = React.useState(false);

	const onSubmit = async (event: React.FormEvent): Promise<void> => {
		event.preventDefault();
		// Branch: prevent duplicate saves while async write is in progress.
		if (saving) return;
		setSaving(true);
		try {
			await props.onSave({ title, body });
		} finally {
			setSaving(false);
		}
	};

	return (
		<form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
			<div style={{ fontWeight: 600 }}>New Text Note</div>
			<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
			<textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body" rows={5} />
			<div style={{ display: 'flex', gap: 8 }}>
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
