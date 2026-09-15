import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRulerCombined, faXmark } from '@fortawesome/free-solid-svg-icons';
import { convertScaleSystem, parseLengthNumber, SCALE_PRESETS, scaleLabel, type ScalePreset } from './markupMeasure';
import type { MarkupDraftStore } from './markupStore';
import type { PageScale } from './markupTypes';
import styles from './Markup.module.css';

// The scale settings for one page: which units to show, a standard scale, or calibrate from a line
// drawn over a known dimension (then the real length of that line is typed in here).

type Translate = (key: string) => string;
type Display = 'imperial' | 'mm' | 'm';
type ScaleFields = Omit<PageScale, 'page' | 'updatedAt'>;

type MarkupScalePanelProps = {
	placement: 'top' | 'bottom';
	page: number;
	scale: PageScale | null;
	/** The calibration line, once one is drawn (its ends can still be dragged), or null. */
	calibration: MarkupDraftStore | null;
	t: Translate;
	onApply: (scale: ScaleFields) => void;
	onStartCalibrate: () => void;
	onApplyCalibration: (scale: ScaleFields) => void;
	onRemove: () => void;
	onClose: () => void;
};

const DISPLAYS: ReadonlyArray<{ id: Display; labelKey: string }> = [
	{ id: 'imperial', labelKey: 'documents.markupScaleImperial' },
	{ id: 'mm', labelKey: 'documents.markupScaleMillimetres' },
	{ id: 'm', labelKey: 'documents.markupScaleMetres' },
];

const noSubscribe = (): (() => void) => () => undefined;
const noLine = (): null => null;

const displayOf = (scale: PageScale | null): Display => {
	if (!scale || scale.system === 'imperial') return 'imperial';
	return scale.metricUnit === 'm' ? 'm' : 'mm';
};

export function MarkupScalePanel(props: MarkupScalePanelProps): React.JSX.Element {
	const { t, scale, calibration, onClose } = props;
	const [display, setDisplay] = React.useState<Display>(displayOf(scale));
	const [feet, setFeet] = React.useState('');
	const [inches, setInches] = React.useState('');
	const [metricValue, setMetricValue] = React.useState('');
	const [error, setError] = React.useState<string | null>(null);
	const rootRef = React.useRef<HTMLDivElement | null>(null);
	const firstInputRef = React.useRef<HTMLInputElement | null>(null);
	const calibrating = calibration !== null;
	const calibrationLine = React.useSyncExternalStore(calibration?.subscribe ?? noSubscribe, calibration?.get ?? noLine, calibration?.get ?? noLine);
	const lengthUnits = calibrationLine && calibrationLine.kind === 'measure' && calibrationLine.points.length >= 4
		? Math.hypot(calibrationLine.points[2] - calibrationLine.points[0], calibrationLine.points[3] - calibrationLine.points[1])
		: 0;

	// A press anywhere else closes it (the tool bar's scale button handles its own toggle). Not while
	// calibrating: those presses are on the page, dragging the ends of the line.
	React.useEffect(() => {
		if (calibrating) return undefined;
		const onPointerDown = (event: PointerEvent): void => {
			const target = event.target as Element | null;
			if (!target || rootRef.current?.contains(target) || target.closest?.('[data-scale-panel-toggle]')) return;
			onClose();
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	}, [calibrating, onClose]);

	React.useEffect(() => {
		// Not on phones: the keyboard would cover the line that's still being fine-tuned.
		if (calibrating && window.matchMedia('(pointer: fine)').matches) firstInputRef.current?.focus({ preventScroll: true });
	}, [calibrating]);

	const metricUnit = display === 'm' ? 'm' : 'mm';
	const presets = SCALE_PRESETS.filter((preset) => (display === 'imperial' ? preset.system === 'imperial' : preset.system === 'metric'));
	const selectedPreset = scale && scale.preset && presets.some((preset) => preset.id === scale.preset) ? scale.preset : '';

	const changeDisplay = (next: Display): void => {
		setDisplay(next);
		setError(null);
		// Changing units keeps the scale: the same real length, shown in the other units.
		if (!scale || calibration) return;
		props.onApply(convertScaleSystem(scale, next === 'imperial' ? 'imperial' : 'metric', next === 'm' ? 'm' : 'mm'));
	};

	const choosePreset = (preset: ScalePreset): void => {
		props.onApply({
			system: preset.system,
			realPerUnit: preset.realPerUnit,
			preset: preset.id,
			...(preset.system === 'metric' ? { metricUnit } : {}),
		});
		onClose();
	};

	const applyCalibration = (): void => {
		if (!calibration) return;
		let real: number | null;
		if (display === 'imperial') {
			const feetValue = parseLengthNumber(feet);
			const inchValue = parseLengthNumber(inches);
			real = feetValue === null || inchValue === null ? null : feetValue * 12 + inchValue;
		} else {
			const value = parseLengthNumber(metricValue);
			real = value === null ? null : display === 'm' ? value * 1000 : value;
		}
		if (!real || real <= 0 || lengthUnits <= 0) {
			setError(t('documents.markupScaleInvalid'));
			return;
		}
		props.onApplyCalibration({
			system: display === 'imperial' ? 'imperial' : 'metric',
			realPerUnit: real / lengthUnits,
			...(display !== 'imperial' ? { metricUnit } : {}),
		});
	};

	const submitOnEnter = (event: React.KeyboardEvent): void => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		applyCalibration();
	};

	return (
		<div
			ref={rootRef}
			className={`${styles.library} ${styles.scalePanel} ${props.placement === 'bottom' ? styles.libraryBottom : styles.libraryTop}`}
			role="dialog"
			aria-label={t('documents.markupScale')}
			// The tool bar swallows mouse presses to keep focus in a text note; this panel needs them for its fields.
			onMouseDown={(event) => event.stopPropagation()}
			onKeyDown={(event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					onClose();
				}
			}}
		>
			<div className={styles.libraryHeader}>
				<span className={styles.scaleTitle}>
					<FontAwesomeIcon icon={faRulerCombined} />
					<span>{`${t('documents.markupScaleForPage')} ${props.page}`}</span>
				</span>
				<button type="button" className={styles.tool} onClick={onClose} aria-label={t('documents.markupScaleClose')} title={t('documents.markupScaleClose')}>
					<FontAwesomeIcon icon={faXmark} />
				</button>
			</div>
			<div className={styles.scaleBody}>
				<div className={styles.scaleSegment} role="radiogroup" aria-label={t('documents.markupScaleShowIn')}>
					{DISPLAYS.map((option) => (
						<button
							key={option.id}
							type="button"
							role="radio"
							aria-checked={display === option.id}
							className={`${styles.scaleSegmentButton}${display === option.id ? ` ${styles.scaleSegmentActive}` : ''}`}
							onClick={() => changeDisplay(option.id)}
						>
							{t(option.labelKey)}
						</button>
					))}
				</div>

				{calibration ? (
					<>
						<span className={styles.scaleLabelText}>{t('documents.markupScaleRealLength')}</span>
						<p className={styles.scaleNote}>{`${(lengthUnits / 72).toFixed(3)}" ${t('documents.markupScaleOnSheet')} · ${t('documents.markupScaleFineTune')}`}</p>
						<div className={styles.scaleInputs}>
							{display === 'imperial' ? (
								<>
									<input
										ref={firstInputRef}
										className={styles.scaleInput}
										inputMode="decimal"
										value={feet}
										placeholder="0"
										aria-label={t('documents.markupScaleFeet')}
										onChange={(event) => setFeet(event.target.value)}
										onKeyDown={submitOnEnter}
									/>
									<span className={styles.scaleUnit}>{t('documents.markupScaleFeet')}</span>
									<input
										className={styles.scaleInput}
										inputMode="decimal"
										value={inches}
										placeholder="0"
										aria-label={t('documents.markupScaleInches')}
										onChange={(event) => setInches(event.target.value)}
										onKeyDown={submitOnEnter}
									/>
									<span className={styles.scaleUnit}>{t('documents.markupScaleInches')}</span>
								</>
							) : (
								<>
									<input
										ref={firstInputRef}
										className={styles.scaleInput}
										inputMode="decimal"
										value={metricValue}
										placeholder="0"
										aria-label={t(display === 'm' ? 'documents.markupScaleMetres' : 'documents.markupScaleMillimetres')}
										onChange={(event) => setMetricValue(event.target.value)}
										onKeyDown={submitOnEnter}
									/>
									<span className={styles.scaleUnit}>{t(display === 'm' ? 'documents.markupScaleMetres' : 'documents.markupScaleMillimetres')}</span>
								</>
							)}
						</div>
						{error ? <p className={styles.scaleError} role="alert">{error}</p> : null}
						<div className={styles.scaleActions}>
							<button type="button" className={styles.scaleAction} onClick={onClose}>{t('documents.markupScaleCancel')}</button>
							<button type="button" className={`${styles.scaleAction} ${styles.scaleActionPrimary}`} onClick={applyCalibration} disabled={lengthUnits <= 0}>{t('documents.markupScaleApply')}</button>
						</div>
					</>
				) : (
					<>
						<p className={`${styles.scaleCurrent}${scale ? '' : ` ${styles.scaleCurrentUnset}`}`}>{scaleLabel(scale, t)}</p>
						<label className={styles.scaleField}>
							<span className={styles.scaleLabelText}>{t('documents.markupScaleStandard')}</span>
							<select
								className={styles.scaleSelect}
								value={selectedPreset}
								onChange={(event) => {
									const preset = SCALE_PRESETS.find((entry) => entry.id === event.target.value);
									if (preset) choosePreset(preset);
								}}
							>
								<option value="" disabled>{t('documents.markupScaleChoose')}</option>
								{(display === 'imperial' ? (['architectural', 'engineering'] as const) : (['metric'] as const)).map((group) => (
									<optgroup
										key={group}
										label={t(group === 'architectural' ? 'documents.markupScaleArchitectural' : group === 'engineering' ? 'documents.markupScaleEngineering' : 'documents.markupScaleMetricRatios')}
									>
										{presets.filter((preset) => preset.group === group).map((preset) => (
											<option key={preset.id} value={preset.id}>{preset.label}</option>
										))}
									</optgroup>
								))}
							</select>
						</label>
						<div className={styles.scaleActions}>
							<button type="button" className={styles.scaleAction} onClick={props.onStartCalibrate}>
								<FontAwesomeIcon icon={faRulerCombined} />
								<span>{t('documents.markupScaleCalibrate')}</span>
							</button>
							{scale ? (
								<button type="button" className={`${styles.scaleAction} ${styles.scaleActionDanger}`} onClick={props.onRemove}>{t('documents.markupScaleRemove')}</button>
							) : null}
						</div>
						<p className={styles.scaleNote}>{t('documents.markupScaleCalibrateHint')}</p>
					</>
				)}
			</div>
		</div>
	);
}
