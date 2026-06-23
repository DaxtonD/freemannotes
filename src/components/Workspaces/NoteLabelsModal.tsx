import React from 'react';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import { useI18n } from '../../core/i18n';
import { hasLabelNameConflict, type LabelRecord } from '../../services/labelService';
import styles from '../shared/MetadataModal.module.css';

const LABEL_COLOR_PRESETS = ['#d6c24b', '#f28c52', '#d95f5f', '#a56ad8', '#5f85db', '#49a8c7', '#4dbf8f', '#74a85c'] as const;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

// Keep the custom picker in plain TS so mobile and desktop share the same
// inline controls instead of diverging into native browser color dialogs.
function parseHexColor(hex: string): { r: number; g: number; b: number } {
	const normalized = String(hex || '').trim().replace(/^#/, '');
	const full = normalized.length === 3
		? normalized.split('').map((part) => `${part}${part}`).join('')
		: normalized;
	if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 0, g: 0, b: 0 };
	return {
		r: parseInt(full.slice(0, 2), 16),
		g: parseInt(full.slice(2, 4), 16),
		b: parseInt(full.slice(4, 6), 16),
	};
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
	const channel = (value: number): string => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
	return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
	const red = r / 255;
	const green = g / 255;
	const blue = b / 255;
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const delta = max - min;
	let hue = 0;
	if (delta > 0) {
		if (max === red) {
			hue = ((green - blue) / delta) % 6;
		} else if (max === green) {
			hue = (blue - red) / delta + 2;
		} else {
			hue = (red - green) / delta + 4;
		}
	}
	hue = Math.round(hue * 60);
	if (hue < 0) hue += 360;
	const saturation = max === 0 ? 0 : (delta / max) * 100;
	const value = max * 100;
	return { h: hue, s: saturation, v: value };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
	const hue = ((h % 360) + 360) % 360;
	const saturation = clamp(s, 0, 100) / 100;
	const value = clamp(v, 0, 100) / 100;
	const chroma = value * saturation;
	const segment = hue / 60;
	const x = chroma * (1 - Math.abs((segment % 2) - 1));
	let red = 0;
	let green = 0;
	let blue = 0;
	if (segment >= 0 && segment < 1) {
		red = chroma;
		green = x;
	} else if (segment < 2) {
		red = x;
		green = chroma;
	} else if (segment < 3) {
		green = chroma;
		blue = x;
	} else if (segment < 4) {
		green = x;
		blue = chroma;
	} else if (segment < 5) {
		red = x;
		blue = chroma;
	} else {
		red = chroma;
		blue = x;
	}
	const match = value - chroma;
	return {
		r: (red + match) * 255,
		g: (green + match) * 255,
		b: (blue + match) * 255,
	};
}

type LabelColorPickerProps = {
	value: string;
	onChange: (nextColor: string) => void;
	ariaLabel: string;
	onClose: () => void;
	closeLabel: string;
};

function LabelColorPicker(props: LabelColorPickerProps): React.JSX.Element {
	const rgb = React.useMemo(() => parseHexColor(props.value), [props.value]);
	const hsv = React.useMemo(() => rgbToHsv(rgb.r, rgb.g, rgb.b), [rgb.b, rgb.g, rgb.r]);

	const updateFromSaturationValue = React.useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
		const rect = event.currentTarget.getBoundingClientRect();
		const saturation = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
		const value = clamp(100 - (((event.clientY - rect.top) / rect.height) * 100), 0, 100);
		props.onChange(toHex(hsvToRgb(hsv.h, saturation, value)));
	}, [hsv.h, props]);

	const updateFromHue = React.useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
		const rect = event.currentTarget.getBoundingClientRect();
		const hue = clamp(((event.clientX - rect.left) / rect.width) * 360, 0, 360);
		props.onChange(toHex(hsvToRgb(hue, hsv.s, hsv.v)));
	}, [hsv.s, hsv.v, props]);

	return (
		<div className={styles.labelColorPickerPanel}>
				<div
					className={styles.labelColorSaturationBox}
					style={{ backgroundColor: toHex(hsvToRgb(hsv.h, 100, 100)) }}
					onPointerDown={updateFromSaturationValue}
					onPointerMove={(event) => {
						if (event.buttons !== 1) return;
						updateFromSaturationValue(event);
					}}
					role="slider"
					aria-label={`${props.ariaLabel} saturation and brightness`}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(hsv.s)}
				>
					<span
						className={styles.labelColorSaturationThumb}
						style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }}
						aria-hidden="true"
					/>
				</div>
				<div className={styles.labelColorControlsRow}>
					<span className={styles.labelColorPreview} style={{ backgroundColor: props.value }} aria-hidden="true" />
					<div
						className={styles.labelColorHueSlider}
						onPointerDown={updateFromHue}
						onPointerMove={(event) => {
							if (event.buttons !== 1) return;
							updateFromHue(event);
						}}
						role="slider"
						aria-label={`${props.ariaLabel} hue`}
						aria-valuemin={0}
						aria-valuemax={360}
						aria-valuenow={Math.round(hsv.h)}
					>
						<span className={styles.labelColorHueThumb} style={{ left: `${(hsv.h / 360) * 100}%` }} aria-hidden="true" />
					</div>
				</div>
				<div className={styles.labelColorPickerFooter}>
					<button type="button" className={styles.labelColorPickerCloseButton} onClick={props.onClose}>
						{props.closeLabel}
					</button>
				</div>
		</div>
	);
}

type LabelColorSelectorProps = {
	value: string;
	onChange: (nextColor: string) => void;
	ariaLabel: string;
	isCustomOpen: boolean;
	onCustomOpenChange: (isOpen: boolean) => void;
	customLabel: string;
	closeLabel: string;
};

function LabelColorSelector(props: LabelColorSelectorProps): React.JSX.Element {
	const isPreset = LABEL_COLOR_PRESETS.some((preset) => preset.toLowerCase() === props.value.toLowerCase());
	return (
		<div className={styles.labelColorSelector}>
			<div className={styles.labelColorPresetRow}>
				{LABEL_COLOR_PRESETS.map((preset) => {
					const isActive = props.value.toLowerCase() === preset.toLowerCase();
					return (
						<button
							key={preset}
							type="button"
							className={`${styles.labelColorPresetPill}${isActive ? ` ${styles.labelColorPresetPillActive}` : ''}`}
							onClick={() => {
								props.onChange(preset);
								props.onCustomOpenChange(false);
							}}
							aria-label={`${props.ariaLabel}: ${preset}`}
							aria-pressed={isActive}
						>
							<span className={styles.labelColorPresetSwatch} style={{ backgroundColor: preset }} aria-hidden="true" />
						</button>
					);
				})}
				<button
					type="button"
					className={`${styles.labelColorCustomButton}${props.isCustomOpen || !isPreset ? ` ${styles.labelColorCustomButtonActive}` : ''}`}
					onClick={() => props.onCustomOpenChange(!props.isCustomOpen)}
					aria-pressed={props.isCustomOpen}
				>
					<span className={styles.labelColorCustomSwatch} style={{ backgroundColor: props.value }} aria-hidden="true" />
					<span>{props.customLabel}</span>
				</button>
			</div>
			{props.isCustomOpen ? (
				// Render the advanced picker as a positioned popover so opening it
				// never reflows the rest of the add/edit label form.
				<div className={styles.labelColorPickerPopover}>
					<LabelColorPicker
						value={props.value}
						onChange={props.onChange}
						ariaLabel={props.ariaLabel}
						onClose={() => props.onCustomOpenChange(false)}
						closeLabel={props.closeLabel}
					/>
				</div>
			) : null}
		</div>
	);
}

type NoteLabelsModalProps = {
	isOpen: boolean;
	onClose: () => void;
	labels: readonly LabelRecord[];
	selectedLabelIds?: readonly string[];
	noteTitle?: string;
	onToggleLabel?: (labelId: string) => void;
	onCreateLabel: (args: { name: string; color?: string | null }) => string | null;
	onUpdateLabel: (labelId: string, patch: { name?: string; color?: string | null }) => boolean;
	onDeleteLabel: (labelId: string) => void;
	showSelection?: boolean;
};

export function NoteLabelsModal(props: NoteLabelsModalProps): React.JSX.Element | null {
	const { t } = useI18n();
	useBodyScrollLock(props.isOpen, { disableTouchAction: false });
	// The same modal now serves both note label selection and standalone label
	// management, so selection-specific props become optional in manage mode.
	const showSelection = props.showSelection !== false;
	const selectedLabelIds = props.selectedLabelIds ?? [];
	const [searchQuery, setSearchQuery] = React.useState('');
	const [newLabelName, setNewLabelName] = React.useState('');
	const [newLabelColor, setNewLabelColor] = React.useState('#d6c24b');
	const [newLabelCustomPickerOpen, setNewLabelCustomPickerOpen] = React.useState(false);
	const [editingLabelId, setEditingLabelId] = React.useState<string | null>(null);
	const [editingLabelName, setEditingLabelName] = React.useState('');
	const [editingLabelColor, setEditingLabelColor] = React.useState('#d6c24b');
	const [editingLabelCustomPickerOpen, setEditingLabelCustomPickerOpen] = React.useState(false);
	const [deleteConfirmLabelId, setDeleteConfirmLabelId] = React.useState<string | null>(null);
	const [validationMessage, setValidationMessage] = React.useState<string | null>(null);
	const onCloseRef = React.useRef(props.onClose);
	const formCardRef = React.useRef<HTMLDivElement | null>(null);
	const labelNameInputRef = React.useRef<HTMLInputElement | null>(null);

	React.useEffect(() => {
		onCloseRef.current = props.onClose;
	}, [props.onClose]);

	React.useEffect(() => {
		if (!props.isOpen) return;
		setSearchQuery('');
		setNewLabelName('');
		setNewLabelCustomPickerOpen(false);
		setEditingLabelId(null);
		setEditingLabelName('');
		setEditingLabelColor('#d6c24b');
		setEditingLabelCustomPickerOpen(false);
		setDeleteConfirmLabelId(null);
		setValidationMessage(null);
	}, [props.isOpen]);

	React.useEffect(() => {
		if (!props.isOpen || typeof window === 'undefined') return;
		const mql = window.matchMedia('(pointer: coarse)');
		if (!mql.matches) return;

		const isNoteLabelsHistoryEntry = (state: unknown): state is { __noteLabelsModal: true } => {
			if (!state || typeof state !== 'object') return false;
			return (state as { __noteLabelsModal?: unknown }).__noteLabelsModal === true;
		};

		let active = true;
		let didPush = false;

		const pushTimer = window.setTimeout(() => {
			if (!active) return;
			const currentState = window.history.state as { __moreMenu?: boolean } | null;
			if (currentState?.__moreMenu === true) {
				window.history.replaceState({ __noteLabelsModal: true }, '');
			} else {
				window.history.pushState({ __noteLabelsModal: true }, '');
			}
			didPush = true;
		}, 0);

		const onPopState = (): void => {
			if (active && didPush) {
				active = false;
				onCloseRef.current();
			}
		};

		window.addEventListener('popstate', onPopState);
		return () => {
			window.clearTimeout(pushTimer);
			window.removeEventListener('popstate', onPopState);
			if (active && didPush && isNoteLabelsHistoryEntry(window.history.state)) {
				active = false;
				window.history.back();
			}
			active = false;
		};
	}, [props.isOpen]);

	React.useEffect(() => {
		if (!editingLabelId) return;
		if (props.labels.some((label) => label.id === editingLabelId)) return;
		setEditingLabelId(null);
		setEditingLabelName('');
		setEditingLabelColor('#d6c24b');
		setEditingLabelCustomPickerOpen(false);
		setDeleteConfirmLabelId(null);
	}, [editingLabelId, props.labels]);

	React.useEffect(() => {
		if (!editingLabelId) return;
		// On mobile the edit form may be partially offscreen after tapping a row in
		// the list pane, so bring the form back into view before focusing its input.
		formCardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		labelNameInputRef.current?.focus();
		labelNameInputRef.current?.select();
	}, [editingLabelId]);

	const filteredLabels = React.useMemo(() => {
		const normalizedQuery = searchQuery.trim().toLowerCase();
		if (!normalizedQuery) return props.labels;
		return props.labels.filter((label) => label.name.toLowerCase().includes(normalizedQuery));
	}, [props.labels, searchQuery]);

	const beginEditingLabel = React.useCallback((label: LabelRecord) => {
		setValidationMessage(null);
		setEditingLabelId(label.id);
		setEditingLabelName(label.name);
		setEditingLabelColor(label.color ?? '#d6c24b');
		setEditingLabelCustomPickerOpen(false);
		setDeleteConfirmLabelId(null);
	}, []);

	const cancelEditingLabel = React.useCallback(() => {
		setEditingLabelId(null);
		setEditingLabelName('');
		setEditingLabelColor('#d6c24b');
		setEditingLabelCustomPickerOpen(false);
		setDeleteConfirmLabelId(null);
		setValidationMessage(null);
	}, []);

	const saveEditingLabel = React.useCallback(() => {
		if (!editingLabelId) return;
		const nextName = editingLabelName.trim();
		if (!nextName) return;
		if (hasLabelNameConflict(props.labels, nextName, editingLabelId)) {
			setValidationMessage(t('labels.duplicateNameError'));
			return;
		}
		if (!props.onUpdateLabel(editingLabelId, {
			name: nextName,
			color: editingLabelColor,
		})) {
			setValidationMessage(t('labels.duplicateNameError'));
			return;
		}
		setValidationMessage(null);
		cancelEditingLabel();
	}, [cancelEditingLabel, editingLabelColor, editingLabelId, editingLabelName, props, t]);

	const deleteEditingLabel = React.useCallback((labelId: string) => {
		if (deleteConfirmLabelId !== labelId) {
			setDeleteConfirmLabelId(labelId);
			return;
		}
		props.onDeleteLabel(labelId);
		cancelEditingLabel();
	}, [cancelEditingLabel, deleteConfirmLabelId, props]);

	const isEditingLabel = Boolean(editingLabelId);

	if (!props.isOpen) return null;

	return (
		<div className={styles.overlay} role="presentation" onClick={props.onClose}>
			<section className={styles.modal} role="dialog" aria-modal="true" aria-label={showSelection ? t('labels.addTitle') : t('labels.manageTitle')} onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<div className={styles.titleBlock}>
						<h2 className={styles.title}>{showSelection ? t('labels.addTitle') : t('labels.manageTitle')}</h2>
						<p className={styles.description}>{props.noteTitle?.trim() ? props.noteTitle.trim() : showSelection ? t('labels.addDescription') : t('labels.manageDescription')}</p>
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
					<div className={styles.splitLayout}>
						<div className={styles.splitSidebar}>
							<div ref={formCardRef} className={`${styles.section} ${styles.compactSection}`}>
								<p className={styles.formModeLabel}>
									{isEditingLabel ? t('labels.manageAction') : t('labels.createAction')}
								</p>
								<div className={styles.field}>
									<label className={styles.fieldLabel} htmlFor="note-label-name">{isEditingLabel ? t('labels.changePlaceholder') : t('labels.createPlaceholder')}</label>
									<input
										id="note-label-name"
										ref={labelNameInputRef}
										className={styles.input}
										value={isEditingLabel ? editingLabelName : newLabelName}
										onChange={(event) => {
											setValidationMessage(null);
											if (isEditingLabel) {
												setEditingLabelName(event.target.value);
												return;
											}
											setNewLabelName(event.target.value);
										}}
										placeholder={isEditingLabel ? t('labels.changePlaceholder') : t('labels.createPlaceholder')}
									/>
								</div>
								<div className={styles.field}>
									<label className={styles.fieldLabel}>{isEditingLabel ? t('labels.editColorAria') : t('labels.colorAria')}</label>
									<LabelColorSelector
										value={isEditingLabel ? editingLabelColor : newLabelColor}
										onChange={(nextColor) => {
											setValidationMessage(null);
											if (isEditingLabel) {
												setEditingLabelColor(nextColor);
												return;
											}
											setNewLabelColor(nextColor);
										}}
										ariaLabel={isEditingLabel ? t('labels.editColorAria') : t('labels.colorAria')}
										isCustomOpen={isEditingLabel ? editingLabelCustomPickerOpen : newLabelCustomPickerOpen}
										onCustomOpenChange={isEditingLabel ? setEditingLabelCustomPickerOpen : setNewLabelCustomPickerOpen}
										customLabel={t('labels.customColorAction')}
										closeLabel={t('common.close')}
									/>
								</div>
								{validationMessage ? <p className={styles.validationMessage}>{validationMessage}</p> : null}
								<div className={styles.actions}>
									{isEditingLabel ? (
										<>
											<button type="button" className={styles.primaryButton} onClick={saveEditingLabel} disabled={!editingLabelName.trim()}>
												{t('common.save')}
											</button>
											<button type="button" className={styles.ghostButton} onClick={cancelEditingLabel}>
												{t('common.cancel')}
											</button>
											<button type="button" className={styles.dangerButton} onClick={() => deleteEditingLabel(editingLabelId)}>
												{deleteConfirmLabelId === editingLabelId ? t('labels.confirmDeleteAction') : t('labels.deleteAction')}
											</button>
										</>
									) : (
										<button
											type="button"
											className={styles.primaryButton}
											onClick={() => {
												const nextName = newLabelName.trim();
												if (!nextName) return;
												if (hasLabelNameConflict(props.labels, nextName)) {
													setValidationMessage(t('labels.duplicateNameError'));
													return;
												}
												const nextId = props.onCreateLabel({ name: newLabelName, color: newLabelColor });
												if (!nextId) {
													setValidationMessage(t('labels.duplicateNameError'));
													return;
												}
												props.onToggleLabel(nextId);
												setNewLabelName('');
												setNewLabelCustomPickerOpen(false);
												setValidationMessage(null);
											}}
											disabled={!newLabelName.trim()}
										>
											{t('labels.createAction')}
										</button>
									)}
								</div>
							</div>
						</div>
						<div className={styles.splitMain}>
							<div className={`${styles.section} ${styles.paneSection}`}>
								<div className={`${styles.checkboxList} ${styles.paneList}`}>
									{filteredLabels.length === 0 ? <div className={styles.muted}>{t('labels.noMatches')}</div> : filteredLabels.map((label) => {
										const checked = showSelection && selectedLabelIds.includes(label.id);
										const isEditing = editingLabelId === label.id;
										return (
											<div key={label.id} className={styles.checkboxRowShell}>
												<div className={`${styles.checkboxRow}${checked ? ` ${styles.checkboxRowActive}` : ''}${isEditing ? ` ${styles.checkboxRowEditing}` : ''}`}>
													{showSelection ? (
														<button
															type="button"
															className={styles.checkboxRowToggle}
															onClick={() => props.onToggleLabel?.(label.id)}
														>
															<span className={styles.checkboxLabelBlock}>
																<span className={styles.checkboxLabel}>
																	{label.color ? <span className={styles.checkboxAccent} style={{ backgroundColor: label.color }} aria-hidden="true" /> : null}
																	{label.name}
																</span>
															</span>
														</button>
													) : (
														<div className={styles.checkboxRowStaticCopy}>
															<span className={styles.checkboxLabelBlock}>
																<span className={styles.checkboxLabel}>
																	{label.color ? <span className={styles.checkboxAccent} style={{ backgroundColor: label.color }} aria-hidden="true" /> : null}
																	{label.name}
																</span>
															</span>
														</div>
													)}
													<div className={styles.checkboxRowActions}>
														<button
															type="button"
															className={styles.checkboxManageButton}
															onClick={() => {
																if (isEditing) {
																	cancelEditingLabel();
																	return;
																}
																beginEditingLabel(label);
															}}
														>
															{isEditing ? t('common.close') : t('labels.manageAction')}
														</button>
														{showSelection ? <input className={styles.checkboxInput} type="checkbox" checked={checked} onChange={() => props.onToggleLabel?.(label.id)} /> : null}
													</div>
												</div>
											</div>
										);
									})}
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}