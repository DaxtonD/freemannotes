import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faArrowPointer,
	faCheck,
	faCommentDots,
	faDeleteLeft,
	faEraser,
	faFont,
	faHighlighter,
	faPen,
	faRotate,
	faRotateLeft,
	faRotateRight,
	faRulerCombined,
	faShapes,
	faStamp,
	faTrashCan,
} from '@fortawesome/free-solid-svg-icons';
import { cloudPath, rectCloudPoints } from './markupGeometry';
import type { CloudShape } from './markupPrefs';
import {
	MARKUP_HIGHLIGHTER_COLORS,
	MARKUP_HIGHLIGHTER_WIDTHS,
	MARKUP_PEN_COLORS,
	MARKUP_PEN_WIDTHS,
	MARKUP_STAMPS,
	MARKUP_TEXT_SIZES,
	type MarkupTool,
	type StampPreset,
} from './markupTypes';
import { MarkupSymbolLibrary } from './MarkupSymbolLibrary';
import { SymbolGlyph, symbolById, type SymbolDefinition } from './markupSymbols';
import styles from './Markup.module.css';

type IconKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloudRect' | 'cloudFreeform' | 'callout' | 'move' | 'measureLength' | 'measurePath' | 'measureArea';

// The cloud icons are drawn with the same scallop code as the real thing.
const CLOUD_RECT_ICON = cloudPath(rectCloudPoints({ x: 2.5, y: 3.5, w: 11, h: 9 }), 3.2);
const CLOUD_FREEFORM_ICON = cloudPath([3, 9.5, 5, 3.5, 11, 3, 13.5, 8, 9.5, 13, 4, 12.5], 3.2);

function ShapeIcon(props: { kind: IconKind }): React.JSX.Element {
	const { kind } = props;
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
			{kind === 'line' ? <line x1="3" y1="13" x2="13" y2="3" /> : null}
			{kind === 'arrow' ? (
				<>
					<line x1="3" y1="13" x2="12" y2="4" />
					<polyline points="6.5,3.5 12.5,3.5 12.5,9.5" />
				</>
			) : null}
			{kind === 'rect' ? <rect x="2.5" y="4" width="11" height="8" rx="0.5" /> : null}
			{kind === 'ellipse' ? <ellipse cx="8" cy="8" rx="5.5" ry="4.2" /> : null}
			{kind === 'cloudRect' ? <path d={CLOUD_RECT_ICON} strokeWidth="1.4" /> : null}
			{kind === 'cloudFreeform' ? <path d={CLOUD_FREEFORM_ICON} strokeWidth="1.4" /> : null}
			{kind === 'callout' ? (
				<>
					<rect x="6.5" y="2.5" width="7.5" height="6" rx="0.8" />
					<line x1="6.5" y1="8.5" x2="2.8" y2="13.2" />
					<polyline points="2.5,10.2 2.5,13.5 5.8,13.5" />
				</>
			) : null}
			{kind === 'measureLength' ? (
				<>
					<line x1="2.5" y1="9.5" x2="13.5" y2="9.5" />
					<line x1="2.5" y1="6.5" x2="2.5" y2="12.5" />
					<line x1="13.5" y1="6.5" x2="13.5" y2="12.5" />
				</>
			) : null}
			{kind === 'measurePath' ? (
				<>
					<polyline points="2.5,12.5 6,5 10,10 13.5,3.5" />
					<circle cx="6" cy="5" r="1.2" fill="currentColor" />
					<circle cx="10" cy="10" r="1.2" fill="currentColor" />
				</>
			) : null}
			{kind === 'measureArea' ? <polygon points="3,12.5 4.5,4 12,3 13.5,11" fill="currentColor" fillOpacity="0.25" /> : null}
			{kind === 'move' ? (
				<>
					<circle cx="4" cy="12" r="2.2" />
					<line x1="5.8" y1="10.2" x2="12" y2="4" strokeDasharray="2 1.8" strokeLinecap="butt" />
					<polyline points="8.5,3.5 12.5,3.5 12.5,7.5" />
				</>
			) : null}
		</svg>
	);
}

type ToolEntry = { tool: MarkupTool; labelKey: string; shortcut: string; icon: React.ReactNode };

// Desktop shortcut letters are shown in the tooltips, so people find them without a manual.
const TOOLS: readonly ToolEntry[] = [
	{ tool: 'select', labelKey: 'documents.markupSelect', shortcut: 'V', icon: <FontAwesomeIcon icon={faArrowPointer} /> },
	{ tool: 'pen', labelKey: 'documents.markupPen', shortcut: 'P', icon: <FontAwesomeIcon icon={faPen} /> },
	{ tool: 'highlighter', labelKey: 'documents.markupHighlighter', shortcut: 'H', icon: <FontAwesomeIcon icon={faHighlighter} /> },
	{ tool: 'eraser', labelKey: 'documents.markupEraser', shortcut: 'E', icon: <FontAwesomeIcon icon={faEraser} /> },
	{ tool: 'line', labelKey: 'documents.markupLine', shortcut: 'L', icon: <ShapeIcon kind="line" /> },
	{ tool: 'arrow', labelKey: 'documents.markupArrow', shortcut: 'A', icon: <ShapeIcon kind="arrow" /> },
	{ tool: 'rect', labelKey: 'documents.markupRectangle', shortcut: 'R', icon: <ShapeIcon kind="rect" /> },
	{ tool: 'ellipse', labelKey: 'documents.markupEllipse', shortcut: 'O', icon: <ShapeIcon kind="ellipse" /> },
	{ tool: 'text', labelKey: 'documents.markupText', shortcut: 'T', icon: <FontAwesomeIcon icon={faFont} /> },
	{ tool: 'cloud', labelKey: 'documents.markupCloud', shortcut: 'C', icon: <ShapeIcon kind="cloudRect" /> },
	{ tool: 'callout', labelKey: 'documents.markupCallout', shortcut: 'K', icon: <ShapeIcon kind="callout" /> },
	{ tool: 'comment', labelKey: 'documents.markupComment', shortcut: 'N', icon: <FontAwesomeIcon icon={faCommentDots} /> },
	{ tool: 'move', labelKey: 'documents.markupMove', shortcut: 'M', icon: <ShapeIcon kind="move" /> },
	{ tool: 'stamp', labelKey: 'documents.markupStamp', shortcut: 'S', icon: <FontAwesomeIcon icon={faStamp} /> },
	{ tool: 'symbol', labelKey: 'documents.markupSymbol', shortcut: 'Y', icon: <FontAwesomeIcon icon={faShapes} /> },
	{ tool: 'length', labelKey: 'documents.markupLength', shortcut: 'D', icon: <ShapeIcon kind="measureLength" /> },
	{ tool: 'path', labelKey: 'documents.markupPath', shortcut: 'W', icon: <ShapeIcon kind="measurePath" /> },
	{ tool: 'area', labelKey: 'documents.markupArea', shortcut: 'Q', icon: <ShapeIcon kind="measureArea" /> },
];

// Phones: related tools share one button, and the choices inside the group show in the options
// row above it, so the main row fits a phone's width instead of scrolling.
const TOOL_GROUPS: ReadonlyArray<{ id: string; tools: readonly MarkupTool[] }> = [
	{ id: 'select', tools: ['select'] },
	{ id: 'draw', tools: ['pen', 'highlighter', 'eraser'] },
	{ id: 'shapes', tools: ['line', 'arrow', 'rect', 'ellipse', 'cloud', 'move'] },
	{ id: 'measure', tools: ['length', 'path', 'area'] },
	{ id: 'notes', tools: ['text', 'callout', 'comment'] },
	{ id: 'stamp', tools: ['stamp'] },
	{ id: 'symbol', tools: ['symbol'] },
];

const toolEntry = (tool: MarkupTool): ToolEntry => TOOLS.find((entry) => entry.tool === tool) ?? TOOLS[0];

const CLOUD_SHAPE_OPTIONS: ReadonlyArray<{ shape: CloudShape; labelKey: string; icon: IconKind }> = [
	{ shape: 'rect', labelKey: 'documents.markupCloudRect', icon: 'cloudRect' },
	{ shape: 'freeform', labelKey: 'documents.markupCloudFreeform', icon: 'cloudFreeform' },
];

// On-screen size of the width choices, so thin/medium/thick read at a glance.
const PEN_DOTS = [4, 7, 11];
const HIGHLIGHTER_DOTS = [8, 12, 17];
const TEXT_GLYPHS = [11, 13, 16, 19];
// Near-black stamps would vanish on the dark tool bar; their chip uses the bar's own text colour.
const chipColor = (color: string): string => (color === '#111827' ? 'var(--color-text)' : color);

/** What the colour and size controls show and change: a tool's defaults, or the selected markup. */
export type MarkupStyleControls = {
	/** 'colors' (stamps, symbols): colour only, they're resized with their handles. */
	family: 'pen' | 'highlighter' | 'text' | 'colors';
	color: string;
	/** Stroke width, or font size for text. */
	size: number;
};

/** Measuring tools' extras in the options row: the page's scale, and a path or area in progress. */
export type MarkupMeasureControls = {
	scaleLabel: string;
	hasScale: boolean;
	scaleOpen: boolean;
	onToggleScale: () => void;
	polyPoints: number;
	onFinishPoly: () => void;
	onUndoPolyPoint: () => void;
};

type MarkupToolbarProps = {
	placement: 'top' | 'bottom';
	tool: MarkupTool;
	styleControls: MarkupStyleControls | null;
	cloudShape: CloudShape;
	stampPreset: StampPreset;
	symbolId: string;
	recentSymbols: readonly string[];
	hasSelection: boolean;
	/** A symbol is selected: offer the quarter-turn button. */
	canRotate: boolean;
	canUndo: boolean;
	canRedo: boolean;
	isCoarsePointer: boolean;
	t: (key: string) => string;
	onToolChange: (tool: MarkupTool) => void;
	onStyleChange: (patch: { color?: string; size?: number }) => void;
	onCloudShapeChange: (shape: CloudShape) => void;
	onStampPresetChange: (preset: StampPreset) => void;
	onSymbolChange: (id: string) => void;
	onRotateSelection: () => void;
	measure: MarkupMeasureControls | null;
	/** A floating panel shown next to the bar (the scale settings). */
	panel?: React.ReactNode;
	onDeleteSelection: () => void;
	onUndo: () => void;
	onRedo: () => void;
	onDone: () => void;
};

export function MarkupToolbar(props: MarkupToolbarProps): React.JSX.Element {
	const { tool, styleControls, t, isCoarsePointer } = props;
	const family = styleControls?.family ?? 'pen';
	const colors = family === 'highlighter' ? MARKUP_HIGHLIGHTER_COLORS : MARKUP_PEN_COLORS;
	const sizes: readonly number[] = family === 'highlighter' ? MARKUP_HIGHLIGHTER_WIDTHS : family === 'text' ? MARKUP_TEXT_SIZES : family === 'colors' ? [] : MARKUP_PEN_WIDTHS;
	const sizeLabelKey = family === 'text' ? 'documents.markupTextSize' : 'documents.markupWidth';
	const label = (key: string, shortcut: string): string => (isCoarsePointer ? t(key) : `${t(key)} (${shortcut})`);
	// The last tool used in each group, so tapping the group button comes back to it.
	const lastInGroupRef = React.useRef<Record<string, MarkupTool>>({});
	// Calibrating is part of measuring: its group is the measure group, showing Length.
	const groupTool: MarkupTool = tool === 'calibrate' ? 'length' : tool;
	const activeGroup = TOOL_GROUPS.find((group) => group.tools.includes(groupTool)) ?? TOOL_GROUPS[0];
	lastInGroupRef.current[activeGroup.id] = groupTool;
	const [libraryOpen, setLibraryOpen] = React.useState(false);
	React.useEffect(() => {
		if (tool !== 'symbol') setLibraryOpen(false);
	}, [tool]);
	const closeLibrary = React.useCallback((): void => setLibraryOpen(false), []);

	const toolButton = (entry: ToolEntry, active: boolean): React.JSX.Element => (
		<button
			key={entry.tool}
			type="button"
			className={`${styles.tool}${active ? ` ${styles.toolActive}` : ''}`}
			onClick={() => props.onToolChange(entry.tool)}
			aria-pressed={active}
			aria-label={t(entry.labelKey)}
			title={label(entry.labelKey, entry.shortcut)}
		>
			{entry.icon}
		</button>
	);

	const options: React.ReactNode[] = [];
	const addDivider = (): void => {
		if (options.length > 0) options.push(<span key={`divider-${options.length}`} className={styles.divider} aria-hidden="true" />);
	};
	if (isCoarsePointer && activeGroup.tools.length > 1) {
		options.push(<div key="subtools" className={styles.group}>{activeGroup.tools.map((entry) => toolButton(toolEntry(entry), entry === groupTool))}</div>);
	}
	if (tool === 'cloud') {
		addDivider();
		options.push(
			<div key="cloud" className={styles.group} role="radiogroup" aria-label={t('documents.markupCloud')}>
				{CLOUD_SHAPE_OPTIONS.map((option) => (
					<button
						key={option.shape}
						type="button"
						role="radio"
						aria-checked={props.cloudShape === option.shape}
						className={`${styles.tool}${props.cloudShape === option.shape ? ` ${styles.toolActive}` : ''}`}
						onClick={() => props.onCloudShapeChange(option.shape)}
						aria-label={t(option.labelKey)}
						title={t(option.labelKey)}
					>
						<ShapeIcon kind={option.icon} />
					</button>
				))}
			</div>,
		);
	}
	if (tool === 'stamp') {
		addDivider();
		options.push(
			<div key="stamps" className={`${styles.group} ${styles.groupWrap}`} role="radiogroup" aria-label={t('documents.markupStamps')}>
				{MARKUP_STAMPS.map((entry) => (
					<button
						key={entry.preset}
						type="button"
						role="radio"
						aria-checked={props.stampPreset === entry.preset}
						className={`${styles.stampChip}${props.stampPreset === entry.preset ? ` ${styles.stampChipActive}` : ''}`}
						style={{ color: chipColor(entry.color) }}
						onClick={() => props.onStampPresetChange(entry.preset)}
					>
						{t(entry.labelKey)}
					</button>
				))}
			</div>,
		);
	}
	if (tool === 'symbol') {
		addDivider();
		// The library button, then the recently used symbols (or just the current one, first time).
		const recent = (props.recentSymbols.length > 0 ? props.recentSymbols : [props.symbolId])
			.map((id) => symbolById(id))
			.filter((definition): definition is SymbolDefinition => definition !== null);
		options.push(
			<div key="symbols" className={styles.group}>
				<button
					type="button"
					data-symbol-library-toggle="true"
					className={`${styles.libraryButton}${libraryOpen ? ` ${styles.libraryButtonActive}` : ''}`}
					onClick={() => setLibraryOpen((open) => !open)}
					aria-expanded={libraryOpen}
					title={t('documents.markupSymbolLibrary')}
				>
					<FontAwesomeIcon icon={faShapes} />
					<span>{t('documents.markupSymbols')}</span>
				</button>
				{recent.map((definition) => (
					<button
						key={definition.id}
						type="button"
						className={`${styles.tool}${definition.id === props.symbolId ? ` ${styles.toolActive}` : ''}`}
						onClick={() => props.onSymbolChange(definition.id)}
						aria-pressed={definition.id === props.symbolId}
						aria-label={t(definition.nameKey)}
						title={t(definition.nameKey)}
					>
						<SymbolGlyph definition={definition} size={24} />
					</button>
				))}
			</div>,
		);
	}
	if (props.measure) {
		const measure = props.measure;
		const needed = tool === 'area' ? 3 : 2;
		addDivider();
		options.push(
			<div key="measure" className={styles.group}>
				<button
					type="button"
					data-scale-panel-toggle="true"
					className={`${styles.libraryButton}${measure.scaleOpen ? ` ${styles.libraryButtonActive}` : ''}${measure.hasScale ? '' : ` ${styles.scaleButtonUnset}`}`}
					onClick={measure.onToggleScale}
					aria-expanded={measure.scaleOpen}
					title={t('documents.markupScale')}
				>
					<FontAwesomeIcon icon={faRulerCombined} />
					<span>{measure.scaleLabel}</span>
				</button>
				{tool === 'calibrate' ? <span className={styles.measureHint}>{t('documents.markupScaleCalibrateHint')}</span> : null}
				{(tool === 'path' || tool === 'area') && measure.polyPoints > 0 ? (
					<>
						<button type="button" className={styles.tool} onClick={measure.onUndoPolyPoint} aria-label={t('documents.markupMeasureUndoPoint')} title={label('documents.markupMeasureUndoPoint', 'Backspace')}>
							<FontAwesomeIcon icon={faDeleteLeft} />
						</button>
						<button type="button" className={styles.libraryButton} onClick={measure.onFinishPoly} disabled={measure.polyPoints < needed} title={label('documents.markupMeasureFinish', 'Enter')}>
							<FontAwesomeIcon icon={faCheck} />
							<span>{t('documents.markupMeasureFinish')}</span>
						</button>
					</>
				) : null}
			</div>,
		);
	}
	if (styleControls) {
		addDivider();
		options.push(
			<div key="colors" className={styles.group} role="radiogroup" aria-label={t('documents.markupColor')}>
				{colors.map((color, index) => (
					<button
						key={color}
						type="button"
						role="radio"
						aria-checked={styleControls.color === color}
						className={`${styles.swatch}${styleControls.color === color ? ` ${styles.swatchActive}` : ''}`}
						style={{ background: color }}
						onClick={() => props.onStyleChange({ color })}
						aria-label={`${t('documents.markupColor')} ${index + 1}`}
						title={`${t('documents.markupColor')} ${index + 1}`}
					/>
				))}
			</div>,
		);
		if (sizes.length > 0) {
			addDivider();
			options.push(
				<div key="sizes" className={styles.group} role="radiogroup" aria-label={t(sizeLabelKey)}>
					{sizes.map((size, index) => (
						<button
							key={size}
							type="button"
							role="radio"
							aria-checked={styleControls.size === size}
							className={`${styles.tool}${styleControls.size === size ? ` ${styles.toolActive}` : ''}`}
							onClick={() => props.onStyleChange({ size })}
							aria-label={`${t(sizeLabelKey)} ${index + 1}`}
							title={`${t(sizeLabelKey)} ${index + 1}`}
						>
							{family === 'text' ? (
								<span className={styles.sizeGlyph} style={{ fontSize: TEXT_GLYPHS[index], color: styleControls.color }}>A</span>
							) : (
								<span
									className={styles.widthDot}
									style={{
										width: (family === 'highlighter' ? HIGHLIGHTER_DOTS : PEN_DOTS)[index],
										height: (family === 'highlighter' ? HIGHLIGHTER_DOTS : PEN_DOTS)[index],
										background: styleControls.color,
										opacity: family === 'highlighter' ? 0.7 : 1,
									}}
								/>
							)}
						</button>
					))}
				</div>,
			);
		}
	}

	const bottom = props.placement === 'bottom';
	const optionsRow = options.length > 0 ? (
		<div className={`${styles.bar} ${styles.barOptions}${bottom ? ` ${styles.barBottom}` : ''}`}>{options}</div>
	) : null;
	const mainRow = (
		<div className={`${styles.bar}${bottom ? ` ${styles.barBottom}` : ''}`}>
			<div className={styles.group}>
				{isCoarsePointer
					? TOOL_GROUPS.map((group) => {
						const shown = group.tools.includes(tool) ? tool : lastInGroupRef.current[group.id] ?? group.tools[0];
						const entry = toolEntry(shown);
						return <React.Fragment key={group.id}>{toolButton(entry, group.id === activeGroup.id)}</React.Fragment>;
					})
					: TOOLS.map((entry) => toolButton(entry, entry.tool === groupTool))}
			</div>
			{props.hasSelection ? (
				<>
					<span className={styles.divider} aria-hidden="true" />
					<button type="button" className={styles.tool} onClick={props.onDeleteSelection} aria-label={t('documents.markupDelete')} title={label('documents.markupDelete', 'Del')}>
						<FontAwesomeIcon icon={faTrashCan} />
					</button>
				</>
			) : null}
			{props.canRotate ? (
				<button type="button" className={styles.tool} onClick={props.onRotateSelection} aria-label={t('documents.markupRotate')} title={t('documents.markupRotate')}>
					<FontAwesomeIcon icon={faRotate} />
				</button>
			) : null}
			<span className={styles.divider} aria-hidden="true" />
			<div className={styles.group}>
				<button type="button" className={styles.tool} onClick={props.onUndo} disabled={!props.canUndo} aria-label={t('documents.markupUndo')} title={label('documents.markupUndo', 'Ctrl+Z')}>
					<FontAwesomeIcon icon={faRotateLeft} />
				</button>
				<button type="button" className={styles.tool} onClick={props.onRedo} disabled={!props.canRedo} aria-label={t('documents.markupRedo')} title={label('documents.markupRedo', 'Ctrl+Y')}>
					<FontAwesomeIcon icon={faRotateRight} />
				</button>
			</div>
			<button type="button" className={styles.done} onClick={props.onDone} aria-label={t('documents.markupDone')}>
				<FontAwesomeIcon icon={faCheck} />
				{!isCoarsePointer ? <span>{t('documents.markupDone')}</span> : null}
			</button>
		</div>
	);

	return (
		<div
			className={styles.barStack}
			role="toolbar"
			aria-label={t('documents.markupTools')}
			// Desktop: clicking a colour while typing a text note shouldn't pull focus out of the note.
			onMouseDown={(event) => event.preventDefault()}
		>
			{bottom ? optionsRow : mainRow}
			{bottom ? mainRow : optionsRow}
			{tool === 'symbol' && libraryOpen ? (
				<MarkupSymbolLibrary
					placement={props.placement}
					selectedId={props.symbolId}
					isCoarsePointer={isCoarsePointer}
					t={t}
					onPick={(id) => {
						props.onSymbolChange(id);
						setLibraryOpen(false);
					}}
					onClose={closeLibrary}
				/>
			) : null}
			{props.panel ?? null}
		</div>
	);
}
