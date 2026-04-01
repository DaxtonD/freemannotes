import React from 'react';
import { useI18n } from '../../core/i18n';
import type { LabelRecord } from '../../services/labelService';
import styles from '../shared/MetadataModal.module.css';

type NoteLabelsModalProps = {
	isOpen: boolean;
	onClose: () => void;
	labels: readonly LabelRecord[];
	selectedLabelIds: readonly string[];
	noteTitle?: string;
	onToggleLabel: (labelId: string) => void;
	onCreateLabel: (args: { name: string; color?: string | null }) => string | null;
};

export function NoteLabelsModal(props: NoteLabelsModalProps): React.JSX.Element | null {
	const { t } = useI18n();
	const [searchQuery, setSearchQuery] = React.useState('');
	const [newLabelName, setNewLabelName] = React.useState('');
	const [newLabelColor, setNewLabelColor] = React.useState('#d6c24b');

	React.useEffect(() => {
		if (!props.isOpen) return;
		setSearchQuery('');
		setNewLabelName('');
	}, [props.isOpen]);

	const filteredLabels = React.useMemo(() => {
		const normalizedQuery = searchQuery.trim().toLowerCase();
		if (!normalizedQuery) return props.labels;
		return props.labels.filter((label) => label.name.toLowerCase().includes(normalizedQuery));
	}, [props.labels, searchQuery]);

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={styles.modal} role="dialog" aria-modal="true" aria-label={t('labels.addTitle')} onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<div className={styles.titleBlock}>
						<h2 className={styles.title}>{t('labels.addTitle')}</h2>
						<p className={styles.description}>{props.noteTitle?.trim() ? props.noteTitle.trim() : t('labels.addDescription')}</p>
					</div>
					<button type="button" className={styles.closeButton} onClick={props.onClose} aria-label={t('common.close')}>✕</button>
				</header>

				<div className={styles.section}>
					<input
						className={styles.search}
						type="search"
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						placeholder={t('labels.searchPlaceholder')}
					/>
					<div className={styles.inlineCreateRow}>
						<input
							className={styles.input}
							value={newLabelName}
							onChange={(event) => setNewLabelName(event.target.value)}
							placeholder={t('labels.createPlaceholder')}
						/>
						<input
							type="color"
							className={styles.input}
							value={newLabelColor}
							onChange={(event) => setNewLabelColor(event.target.value)}
							aria-label={t('labels.colorAria')}
						/>
						<button
							type="button"
							className={styles.primaryButton}
							onClick={() => {
								const nextId = props.onCreateLabel({ name: newLabelName, color: newLabelColor });
								if (!nextId) return;
								props.onToggleLabel(nextId);
								setNewLabelName('');
							}}
							disabled={!newLabelName.trim()}
						>
							{t('labels.createAction')}
						</button>
					</div>
					<div className={styles.checkboxList}>
						{filteredLabels.length === 0 ? <div className={styles.muted}>{t('labels.noMatches')}</div> : filteredLabels.map((label) => {
							const checked = props.selectedLabelIds.includes(label.id);
							return (
								<label key={label.id} className={`${styles.checkboxRow}${checked ? ` ${styles.checkboxRowActive}` : ''}`}>
									<span className={styles.checkboxLabelBlock}>
										<span className={styles.checkboxLabel}>
											{label.color ? <span className={styles.checkboxAccent} style={{ backgroundColor: label.color }} aria-hidden="true" /> : null}
											{label.name}
										</span>
									</span>
									<input className={styles.checkboxInput} type="checkbox" checked={checked} onChange={() => props.onToggleLabel(label.id)} />
								</label>
							);
						})}
					</div>
				</div>
			</section>
		</div>
	);
}