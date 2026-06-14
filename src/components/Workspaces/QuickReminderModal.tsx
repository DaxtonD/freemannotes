import React from 'react';
import { useI18n } from '../../core/i18n';
import styles from '../shared/MetadataModal.module.css';

type QuickReminderModalProps = {
	isOpen: boolean;
	onClose: () => void;
	onSave: (value: { title: string; reminderAt: string }) => void;
};

function isQuickReminderModalHistoryState(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	return (value as { __quickReminderModal?: boolean }).__quickReminderModal === true;
}

function toLocalDateInput(value: Date): string {
	const year = value.getFullYear();
	const month = `${value.getMonth() + 1}`.padStart(2, '0');
	const day = `${value.getDate()}`.padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function toLocalTimeInput(value: Date): string {
	const hours = `${value.getHours()}`.padStart(2, '0');
	const minutes = `${value.getMinutes()}`.padStart(2, '0');
	return `${hours}:${minutes}`;
}

function combineLocalDateTime(date: string, time: string): string | null {
	if (!date) return null;
	const safeTime = time || '09:00';
	const local = new Date(`${date}T${safeTime}:00`);
	if (!Number.isFinite(local.getTime())) return null;
	return local.toISOString();
}

export function QuickReminderModal(props: QuickReminderModalProps): React.JSX.Element | null {
	const { t } = useI18n();
	const [titleValue, setTitleValue] = React.useState('');
	const [dateValue, setDateValue] = React.useState('');
	const [timeValue, setTimeValue] = React.useState('09:00');
	const onCloseRef = React.useRef(props.onClose);

	React.useEffect(() => {
		onCloseRef.current = props.onClose;
	}, [props.onClose]);

	React.useEffect(() => {
		if (!props.isOpen) return;
		setTitleValue('');
		setDateValue('');
		setTimeValue('09:00');
	}, [props.isOpen]);

	React.useEffect(() => {
		if (!props.isOpen || typeof window === 'undefined') return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') onCloseRef.current();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [props.isOpen]);

	React.useEffect(() => {
		if (!props.isOpen || typeof window === 'undefined') return;
		const mql = window.matchMedia('(pointer: coarse)');
		if (!mql.matches) return;

		let active = true;
		let didPush = false;
		const pushTimer = window.setTimeout(() => {
			if (!active) return;
			didPush = true;
			window.history.pushState({ __quickReminderModal: true }, '');
		}, 0);
		const onPopState = (): void => {
			if (!active || !didPush) return;
			active = false;
			onCloseRef.current();
		};
		window.addEventListener('popstate', onPopState);

		return () => {
			window.clearTimeout(pushTimer);
			window.removeEventListener('popstate', onPopState);
			if (active && didPush && isQuickReminderModalHistoryState(window.history.state)) {
				active = false;
				window.history.back();
			}
			active = false;
		};
	}, [props.isOpen]);

	const applyQuickOption = React.useCallback((mode: 'later-today' | 'tomorrow' | 'next-week') => {
		const base = new Date();
		if (mode === 'later-today') {
			base.setHours(Math.max(base.getHours() + 2, 18), 0, 0, 0);
		}
		if (mode === 'tomorrow') {
			base.setDate(base.getDate() + 1);
			base.setHours(9, 0, 0, 0);
		}
		if (mode === 'next-week') {
			base.setDate(base.getDate() + 7);
			base.setHours(9, 0, 0, 0);
		}
		setDateValue(toLocalDateInput(base));
		setTimeValue(toLocalTimeInput(base));
	}, []);

	const reminderAt = combineLocalDateTime(dateValue, timeValue);
	const titleTrimmed = titleValue.trim();
	const canSubmit = Boolean(titleTrimmed && reminderAt);

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={styles.modal} role="dialog" aria-modal="true" aria-label={t('reminders.quickAddTitle')} onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<div className={styles.titleBlock}>
						<h2 className={styles.title}>{t('reminders.quickAddTitle')}</h2>
						<p className={styles.description}>{t('reminders.quickAddDescription')}</p>
					</div>
					<button type="button" className={styles.closeButton} onClick={props.onClose} aria-label={t('common.close')}>✕</button>
				</header>

				<form
					className={styles.section}
					onSubmit={(event) => {
						event.preventDefault();
						if (!reminderAt || !titleTrimmed) return;
						props.onSave({ title: titleTrimmed, reminderAt });
					}}
				>
					<div className={styles.field}>
						<label className={styles.fieldLabel} htmlFor="quick-reminder-title">{t('editors.titlePlaceholder')}</label>
						<input
							id="quick-reminder-title"
							className={styles.input}
							type="text"
							value={titleValue}
							onChange={(event) => setTitleValue(event.target.value)}
							autoFocus
						/>
					</div>
					<div className={styles.quickGrid}>
						<button type="button" className={styles.quickButton} onClick={() => applyQuickOption('later-today')}>{t('reminders.laterToday')}</button>
						<button type="button" className={styles.quickButton} onClick={() => applyQuickOption('tomorrow')}>{t('reminders.tomorrow')}</button>
						<button type="button" className={styles.quickButton} onClick={() => applyQuickOption('next-week')}>{t('reminders.nextWeek')}</button>
					</div>
					<div className={styles.row}>
						<div className={styles.field} style={{ flex: '1 1 180px' }}>
							<label className={styles.fieldLabel} htmlFor="quick-reminder-date">{t('reminders.dateLabel')}</label>
							<input id="quick-reminder-date" className={styles.input} type="date" value={dateValue} onChange={(event) => setDateValue(event.target.value)} />
						</div>
						<div className={styles.field} style={{ flex: '1 1 160px' }}>
							<label className={styles.fieldLabel} htmlFor="quick-reminder-time">{t('reminders.timeLabel')}</label>
							<input id="quick-reminder-time" className={styles.input} type="time" value={timeValue} onChange={(event) => setTimeValue(event.target.value)} />
						</div>
					</div>
					<div className={styles.actions}>
						<button type="button" className={styles.ghostButton} onClick={props.onClose}>{t('common.cancel')}</button>
						<button type="submit" className={styles.primaryButton} disabled={!canSubmit}>{t('reminders.quickCreateAction')}</button>
					</div>
				</form>
			</section>
		</div>
	);
}
