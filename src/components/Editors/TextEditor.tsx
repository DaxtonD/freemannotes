import React from 'react';
import styles from './Editors.module.css';

export type TextEditorProps = {
	onSave: (args: { title: string; body: string }) => void | Promise<void>;
	onCancel: () => void;
};

export function TextEditor(props: TextEditorProps): React.JSX.Element {
	// Local draft state until onSave persists to Yjs in App.
	const [title, setTitle] = React.useState('');
	const [body, setBody] = React.useState('');
	const [saving, setSaving] = React.useState(false);

	const onSubmit = async (event: React.FormEvent): Promise<void> => {
		// Standard async submit guard to prevent duplicate saves.
		event.preventDefault();
		if (saving) return;
		setSaving(true);
		try {
			await props.onSave({ title, body });
		} finally {
			setSaving(false);
		}
	};

	return (
		<form onSubmit={onSubmit} className={styles.form}>
			<div className={styles.title}>New Text Note</div>
			<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
			<textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body" rows={5} />
			<div className={styles.row}>
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
