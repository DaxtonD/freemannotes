import React from 'react';
import { useI18n } from '../../core/i18n';
import styles from './Editors.module.css';

export type TextEditorProps = {
	onSave: (args: { title: string; body: string }) => void | Promise<void>;
	onCancel: () => void;
};

export function TextEditor(props: TextEditorProps): React.JSX.Element {
	const { t } = useI18n();
	// Local draft state until onSave persists to Yjs in App.
	const [title, setTitle] = React.useState('');
	const [body, setBody] = React.useState('');
	const [saving, setSaving] = React.useState(false);
	const titleInputRef = React.useRef<HTMLInputElement | null>(null);

	React.useEffect(() => {
		const rafId = window.requestAnimationFrame(() => {
			titleInputRef.current?.focus();
		});
		return () => window.cancelAnimationFrame(rafId);
	}, []);

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
		<div className={styles.fullscreenOverlay} role="presentation" onClick={props.onCancel}>
			<form onSubmit={onSubmit} className={styles.fullscreenEditor} onClick={(event) => event.stopPropagation()}>
				<header className={styles.fullscreenHeader}>
					<h2 className={styles.fullscreenTitle}>{t('editors.newText')}</h2>
					<div className={styles.fullscreenActions}>
						<button type="submit" disabled={saving}>
							{saving ? t('editors.saving') : t('common.save')}
						</button>
						<button type="button" onClick={props.onCancel} disabled={saving}>
							{t('common.cancel')}
						</button>
					</div>
				</header>

				<input
					ref={titleInputRef}
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder={t('editors.titlePlaceholder')}
				/>
				<textarea
					value={body}
					onChange={(e) => setBody(e.target.value)}
					placeholder={t('editors.bodyPlaceholder')}
					className={styles.fullBodyField}
				/>
			</form>
		</div>
	);
}
