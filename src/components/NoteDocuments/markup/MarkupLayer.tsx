import React from 'react';
import {
	arrowGeometry,
	calloutAnchor,
	cloudPath,
	inkPath,
	markupBounds,
	markupFooterText,
	markupHandles,
	moveMarkerRadius,
	roundUnit,
	STAMP_LAYOUT,
	stampMainText,
	stampWidestLine,
} from './markupGeometry';
import {
	formatMeasure,
	lengthTicks,
	measureLabelPoint,
	measureLabelSize,
	pathVertexRadius,
	pointsPath,
	type MeasureContext,
} from './markupMeasure';
import type { MarkupDraftStore } from './markupStore';
import { SymbolParts, symbolById } from './markupSymbols';
import {
	HIGHLIGHTER_OPACITY,
	stampDefinition,
	type CalloutMarkup,
	type CommentMarkup,
	type Markup,
	type StampMarkup,
	type TextMarkup,
	type TypedMarkup,
} from './markupTypes';
import styles from './Markup.module.css';

const percent = (value: number): string => `${value * 100}%`;
// Font sizes are page units; --markup-scale (set on the page) turns them into screen pixels.
const scaledPx = (units: number): string => `calc(var(--markup-scale, 1) * ${units}px)`;
const MARKUP_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/**
 * A stamp is all SVG: a rounded frame, the big word, and the author line. Its box was sized from
 * the wording when it was placed; the longer of the two lines is then fitted to the box exactly,
 * so it never spills out whatever font the device has.
 */
function StampShape(props: { markup: StampMarkup; hideMainText?: boolean }): React.JSX.Element {
	const { x, y, w, h, color } = props.markup;
	const layout = STAMP_LAYOUT;
	const stroke = h * layout.stroke;
	const main = stampMainText(props.markup);
	const footer = markupFooterText(props.markup.author, props.markup.createdAt);
	const widest = stampWidestLine(main, footer);
	const fit = { textLength: roundUnit(Math.max(1, w - layout.padX * 2 * h)), lengthAdjust: 'spacingAndGlyphs' as const };
	const centreX = x + w / 2;
	return (
		<g>
			<rect
				x={x + stroke / 2}
				y={y + stroke / 2}
				width={Math.max(0, w - stroke)}
				height={Math.max(0, h - stroke)}
				rx={h * layout.radius}
				fill="rgba(255, 255, 255, 0.82)"
				stroke={color}
				strokeWidth={stroke}
			/>
			{!props.hideMainText ? (
				<text
					x={centreX}
					y={y + h * layout.mainBaseline}
					textAnchor="middle"
					fill={color}
					fontSize={h * layout.mainSize}
					fontWeight={800}
					fontFamily={MARKUP_FONT}
					{...(widest === 'main' ? fit : {})}
				>
					{main}
				</text>
			) : null}
			{footer ? (
				<text
					x={centreX}
					y={y + h * layout.footerBaseline}
					textAnchor="middle"
					fill={color}
					fillOpacity={0.85}
					fontSize={h * layout.footerSize}
					fontWeight={600}
					fontFamily={MARKUP_FONT}
					{...(widest === 'footer' ? fit : {})}
				>
					{footer}
				</text>
			) : null}
		</g>
	);
}

export function MarkupShape(props: { markup: Markup; measure?: MeasureContext }): React.JSX.Element | null {
	const { markup } = props;
	if (markup.kind === 'text') return null;
	const stroke = {
		stroke: markup.color,
		strokeWidth: markup.width,
		fill: 'none',
		strokeLinecap: 'round' as const,
		strokeLinejoin: 'round' as const,
	};
	switch (markup.kind) {
		case 'ink':
			return (
				<path
					d={inkPath(markup.points)}
					{...stroke}
					strokeOpacity={markup.highlighter ? HIGHLIGHTER_OPACITY : undefined}
				/>
			);
		case 'line':
			return <line x1={markup.x1} y1={markup.y1} x2={markup.x2} y2={markup.y2} {...stroke} />;
		case 'arrow': {
			const arrow = arrowGeometry(markup.x1, markup.y1, markup.x2, markup.y2, markup.width);
			return (
				<g>
					<line x1={markup.x1} y1={markup.y1} x2={arrow.shaftX} y2={arrow.shaftY} {...stroke} />
					<polygon points={arrow.head} fill={markup.color} stroke={markup.color} strokeWidth={markup.width} strokeLinejoin="round" />
				</g>
			);
		}
		case 'move': {
			// A ring where the thing is now, a dashed run to where it's going, and a head at the new spot.
			const radius = moveMarkerRadius(markup.width);
			const length = Math.hypot(markup.x2 - markup.x1, markup.y2 - markup.y1);
			const arrow = arrowGeometry(markup.x1, markup.y1, markup.x2, markup.y2, markup.width);
			const startX = length > 0 ? markup.x1 + ((markup.x2 - markup.x1) / length) * radius : markup.x1;
			const startY = length > 0 ? markup.y1 + ((markup.y2 - markup.y1) / length) * radius : markup.y1;
			return (
				<g>
					<circle cx={markup.x1} cy={markup.y1} r={radius} {...stroke} />
					{length > radius * 2 ? (
						<line
							x1={startX}
							y1={startY}
							x2={arrow.shaftX}
							y2={arrow.shaftY}
							{...stroke}
							strokeLinecap="butt"
							strokeDasharray={`${markup.width * 3} ${markup.width * 2.4}`}
						/>
					) : null}
					<polygon points={arrow.head} fill={markup.color} stroke={markup.color} strokeWidth={markup.width} strokeLinejoin="round" />
				</g>
			);
		}
		case 'rect':
			return <rect x={markup.x} y={markup.y} width={markup.w} height={markup.h} {...stroke} />;
		case 'ellipse':
			return <ellipse cx={markup.x + markup.w / 2} cy={markup.y + markup.h / 2} rx={markup.w / 2} ry={markup.h / 2} {...stroke} />;
		case 'cloud':
			return <path d={cloudPath(markup.points, markup.arc)} {...stroke} />;
		case 'callout': {
			// Just the leader here; the box is HTML so its text wraps (see MarkupCalloutBox).
			const anchor = calloutAnchor(markup);
			if (!anchor) return null;
			const arrow = arrowGeometry(anchor.x, anchor.y, markup.tipX, markup.tipY, markup.width);
			return (
				<g>
					<line x1={anchor.x} y1={anchor.y} x2={arrow.shaftX} y2={arrow.shaftY} {...stroke} />
					<polygon points={arrow.head} fill={markup.color} stroke={markup.color} strokeWidth={markup.width} strokeLinejoin="round" />
				</g>
			);
		}
		case 'stamp':
			return <StampShape markup={markup} />;
		case 'measure': {
			const { points } = markup;
			if (points.length < 4) {
				// The first point of a path or area, before the second tap.
				return <circle cx={points[0]} cy={points[1]} r={pathVertexRadius(markup.width) * 1.4} fill={markup.color} />;
			}
			const d = pointsPath(points, markup.mode === 'area');
			const label = formatMeasure(markup, props.measure?.scale ?? null, props.measure?.noScale ?? 'no scale');
			const at = measureLabelPoint(markup);
			const size = measureLabelSize(markup.width);
			// A rough width for the label's backing; the text itself is centred on the same point.
			const labelWidth = label.length * size * 0.58 + size;
			return (
				<g>
					{markup.mode === 'area' ? <path d={d} fill={markup.color} fillOpacity={0.12} stroke="none" /> : null}
					<path d={d} {...stroke} />
					{markup.mode === 'length'
						? lengthTicks(points, markup.width).map((tick, index) => <line key={index} x1={tick[0]} y1={tick[1]} x2={tick[2]} y2={tick[3]} {...stroke} />)
						: null}
					{markup.mode === 'path'
						? Array.from({ length: points.length / 2 }, (_, index) => (
							<circle key={index} cx={points[index * 2]} cy={points[index * 2 + 1]} r={pathVertexRadius(markup.width)} fill={markup.color} />
						))
						: null}
					<rect
						x={at.x - labelWidth / 2}
						y={at.y - size * 0.75}
						width={labelWidth}
						height={size * 1.5}
						rx={size * 0.3}
						fill="rgba(255, 255, 255, 0.9)"
						stroke={markup.color}
						strokeWidth={Math.max(0.5, markup.width * 0.3)}
					/>
					<text x={at.x} y={at.y} fontSize={size} fontWeight={700} fontFamily={MARKUP_FONT} textAnchor="middle" dominantBaseline="central" fill={markup.color}>
						{label}
					</text>
				</g>
			);
		}
		case 'symbol': {
			// Drawn upright in its own unrotated box, then turned about its centre — the box itself
			// never changes shape for a rotation, see SymbolMarkup's own comment.
			const definition = symbolById(markup.symbol);
			const centreX = markup.x + markup.w / 2;
			const centreY = markup.y + markup.h / 2;
			return (
				<g transform={markup.rotation ? `rotate(${markup.rotation} ${centreX} ${centreY})` : undefined}>
					<svg
						x={markup.x}
						y={markup.y}
						width={markup.w}
						height={markup.h}
						viewBox={definition ? `0 0 ${definition.w} ${definition.h}` : '0 0 100 100'}
						preserveAspectRatio="none"
						overflow="visible"
					>
						{definition ? (
							<SymbolParts definition={definition} color={markup.color} />
						) : (
							<g fill="none" stroke={markup.color} strokeWidth={4}>
								<rect x={4} y={4} width={92} height={92} strokeDasharray="10 8" />
								<text x={50} y={50} fontSize={48} textAnchor="middle" dominantBaseline="central" fill={markup.color} stroke="none">?</text>
							</g>
						)}
					</svg>
				</g>
			);
		}
		default:
			return null;
	}
}

function textBoxStyle(markup: TextMarkup, pageWidth: number, pageHeight: number): React.CSSProperties {
	return {
		left: percent(markup.x / pageWidth),
		top: percent(markup.y / pageHeight),
		width: percent(markup.w / pageWidth),
		color: markup.color,
		fontSize: scaledPx(markup.fontSize),
	};
}

function calloutBoxStyle(markup: CalloutMarkup, pageWidth: number, pageHeight: number): React.CSSProperties {
	return {
		left: percent(markup.x / pageWidth),
		top: percent(markup.y / pageHeight),
		width: percent(markup.w / pageWidth),
		color: markup.color,
		borderColor: markup.color,
		borderWidth: scaledPx(markup.width),
		fontSize: scaledPx(markup.fontSize),
	};
}

/** Text is HTML rather than SVG so it wraps inside its box; positioned in page percentages like everything else. */
export function MarkupTextBox(props: { markup: TextMarkup; pageWidth: number; pageHeight: number }): React.JSX.Element {
	const { markup } = props;
	return (
		<div
			className={`${styles.textItem}${markup.background !== false ? ` ${styles.textItemBackground}` : ''}`}
			style={textBoxStyle(markup, props.pageWidth, props.pageHeight)}
			aria-hidden="true"
		>
			{markup.text}
		</div>
	);
}

export function MarkupCalloutBox(props: { markup: CalloutMarkup; pageWidth: number; pageHeight: number }): React.JSX.Element {
	const { markup } = props;
	return (
		<div className={`${styles.textItem} ${styles.calloutBox}`} style={calloutBoxStyle(markup, props.pageWidth, props.pageHeight)} aria-hidden="true">
			<div className={styles.calloutText}>{markup.text}</div>
			<div className={styles.markupFooter}>{markupFooterText(markup.author, markup.createdAt)}</div>
		</div>
	);
}

type PageLayerProps = {
	items: readonly Markup[];
	/** The page's size in page units; the SVG's coordinate system. */
	pageWidth: number;
	pageHeight: number;
	/** The page's scale, for measurement labels. */
	measure?: MeasureContext;
};

/**
 * A page's saved drawn markup. Highlighter strokes get their own layer that multiplies with the
 * page (so the drawing underneath stays readable); everything else sits on top of them.
 */
export const MarkupLayer = React.memo(function MarkupLayer(props: PageLayerProps): React.JSX.Element | null {
	const { items, pageWidth, pageHeight } = props;
	const drawn = items.filter((item) => item.kind !== 'text' && item.kind !== 'comment');
	if (drawn.length === 0) return null;
	const highlights = drawn.filter((item) => item.kind === 'ink' && item.highlighter);
	const others = highlights.length === 0 ? drawn : drawn.filter((item) => !(item.kind === 'ink' && item.highlighter));
	const viewBox = `0 0 ${pageWidth} ${pageHeight}`;
	return (
		<>
			{highlights.length > 0 ? (
				<svg className={`${styles.layer} ${styles.layerHighlight}`} viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true">
					{highlights.map((item) => <MarkupShape key={item.id} markup={item} />)}
				</svg>
			) : null}
			{others.length > 0 ? (
				<svg className={styles.layer} viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true">
					{others.map((item) => <MarkupShape key={item.id} markup={item} measure={props.measure} />)}
				</svg>
			) : null}
		</>
	);
});

/** Text notes and callout boxes: the markup that wraps text, so it's HTML over the SVG layers. */
export const MarkupTextLayer = React.memo(function MarkupTextLayer(props: PageLayerProps): React.JSX.Element | null {
	const boxes = props.items.filter((item): item is TextMarkup | CalloutMarkup => item.kind === 'text' || item.kind === 'callout');
	if (boxes.length === 0) return null;
	return (
		<>
			{boxes.map((item) => (item.kind === 'text'
				? <MarkupTextBox key={item.id} markup={item} pageWidth={props.pageWidth} pageHeight={props.pageHeight} />
				: <MarkupCalloutBox key={item.id} markup={item} pageWidth={props.pageWidth} pageHeight={props.pageHeight} />))}
		</>
	);
});

/**
 * Comment pins: numbered badges that keep the same size on screen at any zoom (a pin you can't
 * tap at fit-width on a 36-inch sheet is no use). Resolved ones fade back.
 */
export const MarkupPinLayer = React.memo(function MarkupPinLayer(props: PageLayerProps & { pending: CommentMarkup | null; activeId: string | null }): React.JSX.Element | null {
	const pins = props.items.filter((item): item is CommentMarkup => item.kind === 'comment');
	if (props.pending) pins.push(props.pending);
	if (pins.length === 0) return null;
	return (
		<>
			{pins.map((pin) => {
				const active = pin === props.pending || pin.id === props.activeId;
				return (
					<span
						key={pin.id}
						className={`${styles.pin}${pin.status === 'resolved' ? ` ${styles.pinResolved}` : ''}${active ? ` ${styles.pinActive}` : ''}`}
						style={{ left: percent(pin.x / props.pageWidth), top: percent(pin.y / props.pageHeight), background: pin.color }}
						aria-hidden="true"
					>
						{pin.number}
					</span>
				);
			})}
		</>
	);
});

/** The shape being drawn, moved or resized on this page. Only this re-renders while a pointer drags. */
export function MarkupDraftLayer(props: { store: MarkupDraftStore; page: number; pageWidth: number; pageHeight: number; measure?: MeasureContext }): React.JSX.Element | null {
	const draft = React.useSyncExternalStore(props.store.subscribe, props.store.get, props.store.get);
	if (!draft || draft.page !== props.page) return null;
	const viewBox = `0 0 ${props.pageWidth} ${props.pageHeight}`;
	if (draft.kind === 'text' || draft.kind === 'callout') {
		return (
			<>
				{draft.kind === 'callout' ? (
					<svg className={`${styles.layer} ${styles.layerDraft}`} viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true">
						<MarkupShape markup={draft} />
					</svg>
				) : null}
				<div className={styles.layerDraftText}>
					{draft.kind === 'text'
						? <MarkupTextBox markup={draft} pageWidth={props.pageWidth} pageHeight={props.pageHeight} />
						: <MarkupCalloutBox markup={draft} pageWidth={props.pageWidth} pageHeight={props.pageHeight} />}
				</div>
			</>
		);
	}
	const highlighter = draft.kind === 'ink' && draft.highlighter;
	return (
		<svg
			className={`${styles.layer} ${styles.layerDraft}${highlighter ? ` ${styles.layerHighlight}` : ''}`}
			viewBox={viewBox}
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<MarkupShape markup={draft} measure={props.measure} />
		</svg>
	);
}

/** Dashed outline and drag handles around the selected markup. Handles keep a fixed on-screen size. */
export function MarkupSelectionLayer(props: { markup: Markup; pageWidth: number; pageHeight: number; cssWidth: number }): React.JSX.Element | null {
	const { markup } = props;
	// A selected pin shows as highlighted in the pin layer instead.
	if (markup.kind === 'comment') return null;
	const unitsPerPx = props.pageWidth / Math.max(1, props.cssWidth);
	const bounds = markupBounds(markup);
	const pad = 4 * unitsPerPx;
	const radius = 5.5 * unitsPerPx;
	const segment = markup.kind === 'line' || markup.kind === 'arrow' || markup.kind === 'move';
	// Handle positions come back already turned to match a rotated symbol (see markupHandles) — the
	// dashed outline has to turn with them, or the box would visibly disagree with its own handles.
	const rotation = markup.kind === 'symbol' ? markup.rotation : 0;
	const handles = markupHandles(markup, unitsPerPx);
	const rotateHandle = handles.find((handle) => handle.handle === 'rotate');
	const topLeft = handles.find((handle) => handle.handle === 'nw');
	const topRight = handles.find((handle) => handle.handle === 'ne');
	return (
		<svg className={`${styles.layer} ${styles.layerSelection}`} viewBox={`0 0 ${props.pageWidth} ${props.pageHeight}`} preserveAspectRatio="none" aria-hidden="true">
			{segment ? (
				<line x1={markup.x1} y1={markup.y1} x2={markup.x2} y2={markup.y2} className={styles.selectionOutline} vectorEffect="non-scaling-stroke" />
			) : markup.kind === 'measure' ? (
				<path d={pointsPath(markup.points, markup.mode === 'area')} className={styles.selectionOutline} vectorEffect="non-scaling-stroke" />
			) : (
				<rect
					x={bounds.x - pad}
					y={bounds.y - pad}
					width={bounds.w + pad * 2}
					height={bounds.h + pad * 2}
					className={styles.selectionOutline}
					vectorEffect="non-scaling-stroke"
					transform={rotation ? `rotate(${rotation} ${bounds.x + bounds.w / 2} ${bounds.y + bounds.h / 2})` : undefined}
				/>
			)}
			{rotateHandle && topLeft && topRight ? (
				<line
					x1={(topLeft.x + topRight.x) / 2}
					y1={(topLeft.y + topRight.y) / 2}
					x2={rotateHandle.x}
					y2={rotateHandle.y}
					className={styles.selectionOutline}
					vectorEffect="non-scaling-stroke"
				/>
			) : null}
			{handles.map((handle) => (
				<circle
					key={handle.handle}
					cx={handle.x}
					cy={handle.y}
					r={handle.handle === 'rotate' ? radius * 1.15 : radius}
					className={handle.handle === 'rotate' ? `${styles.selectionHandle} ${styles.rotateHandle}` : styles.selectionHandle}
					vectorEffect="non-scaling-stroke"
				/>
			))}
		</svg>
	);
}

/**
 * The line being calibrated against a known dimension. Unlike markup it stays the same thin line at
 * any zoom, with crosshair ends of a fixed on-screen size, so it can be set to the exact ends of a
 * scale bar. Dragging an end fine-tunes it (see useMarkupDrawing).
 */
export function MarkupCalibrationLayer(props: { store: MarkupDraftStore; page: number; pageWidth: number; pageHeight: number; cssWidth: number }): React.JSX.Element | null {
	const line = React.useSyncExternalStore(props.store.subscribe, props.store.get, props.store.get);
	if (!line || line.page !== props.page || line.kind !== 'measure' || line.points.length < 4) return null;
	const unitsPerPx = props.pageWidth / Math.max(1, props.cssWidth);
	const radius = 9 * unitsPerPx;
	const [x1, y1, x2, y2] = line.points;
	return (
		<svg className={`${styles.layer} ${styles.layerSelection}`} viewBox={`0 0 ${props.pageWidth} ${props.pageHeight}`} preserveAspectRatio="none" aria-hidden="true">
			<line x1={x1} y1={y1} x2={x2} y2={y2} className={styles.calibrationHalo} vectorEffect="non-scaling-stroke" />
			<line x1={x1} y1={y1} x2={x2} y2={y2} className={styles.calibrationLine} vectorEffect="non-scaling-stroke" />
			{[[x1, y1], [x2, y2]].map(([x, y], index) => (
				<g key={index}>
					<circle cx={x} cy={y} r={radius} className={styles.calibrationHandle} vectorEffect="non-scaling-stroke" />
					<line x1={x - radius} y1={y} x2={x + radius} y2={y} className={styles.calibrationCross} vectorEffect="non-scaling-stroke" />
					<line x1={x} y1={y - radius} x2={x} y2={y + radius} className={styles.calibrationCross} vectorEffect="non-scaling-stroke" />
				</g>
			))}
		</svg>
	);
}

export type MarkupTextEditorHandlers = {
	placeholders: { text: string; stampNumber: string; stampLabel: string };
	onChange: (text: string) => void;
	onCommit: () => void;
	/** The element whose height is saved as the markup's height when typing finishes. */
	setElement: (element: HTMLElement | null) => void;
};

type EditorProps<T extends TypedMarkup> = { markup: T; pageWidth: number; pageHeight: number; handlers: MarkupTextEditorHandlers };

function useEditorFocus(ref: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>): void {
	React.useEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.focus({ preventScroll: true });
		const end = element.value.length;
		element.setSelectionRange(end, end);
		// On a phone the keyboard slides up over the lower half of the screen; bring the box back into view.
		const timer = window.setTimeout(() => element.scrollIntoView({ block: 'nearest', inline: 'nearest' }), 300);
		return () => window.clearTimeout(timer);
	}, [ref]);
}

function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, deps: readonly unknown[]): void {
	// Grow with the text instead of scrolling inside a tiny box.
	React.useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.style.height = 'auto';
		element.style.height = `${element.scrollHeight}px`;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);
}

function commitOnKey(event: React.KeyboardEvent, handlers: MarkupTextEditorHandlers, enterCommits: boolean): void {
	if (event.key === 'Escape' || (event.key === 'Enter' && (enterCommits || event.ctrlKey || event.metaKey))) {
		event.preventDefault();
		event.stopPropagation();
		handlers.onCommit();
	}
}

function TextNoteEditor(props: EditorProps<TextMarkup>): React.JSX.Element {
	const { markup, handlers } = props;
	const elementRef = React.useRef<HTMLTextAreaElement | null>(null);
	const setRef = React.useCallback((element: HTMLTextAreaElement | null): void => {
		elementRef.current = element;
		handlers.setElement(element);
	}, [handlers]);
	useAutoGrow(elementRef, [markup.text, markup.fontSize, markup.w]);
	useEditorFocus(elementRef);
	return (
		<textarea
			ref={setRef}
			data-markup-text-editor="true"
			className={`${styles.textItem} ${styles.textItemBackground} ${styles.textEditor}`}
			style={textBoxStyle(markup, props.pageWidth, props.pageHeight)}
			value={markup.text}
			rows={1}
			placeholder={handlers.placeholders.text}
			spellCheck
			onChange={(event) => handlers.onChange(event.target.value)}
			onBlur={() => handlers.onCommit()}
			onKeyDown={(event) => commitOnKey(event, handlers, false)}
		/>
	);
}

function CalloutEditor(props: EditorProps<CalloutMarkup>): React.JSX.Element {
	const { markup, handlers } = props;
	const areaRef = React.useRef<HTMLTextAreaElement | null>(null);
	useAutoGrow(areaRef, [markup.text, markup.fontSize, markup.w]);
	useEditorFocus(areaRef);
	return (
		<>
			<svg className={`${styles.layer} ${styles.layerEditorShape}`} viewBox={`0 0 ${props.pageWidth} ${props.pageHeight}`} preserveAspectRatio="none" aria-hidden="true">
				<MarkupShape markup={markup} />
			</svg>
			<div
				ref={handlers.setElement}
				data-markup-text-editor="true"
				className={`${styles.textItem} ${styles.calloutBox} ${styles.boxEditor}`}
				style={calloutBoxStyle(markup, props.pageWidth, props.pageHeight)}
				// A press on the author line shouldn't take focus away from the text (which would save it).
				onMouseDown={(event) => {
					if (event.target !== areaRef.current) event.preventDefault();
				}}
			>
				<textarea
					ref={areaRef}
					className={styles.calloutTextarea}
					value={markup.text}
					rows={1}
					placeholder={handlers.placeholders.text}
					spellCheck
					onChange={(event) => handlers.onChange(event.target.value)}
					onBlur={() => handlers.onCommit()}
					onKeyDown={(event) => commitOnKey(event, handlers, false)}
				/>
				<div className={styles.markupFooter}>{markupFooterText(markup.author, markup.createdAt)}</div>
			</div>
		</>
	);
}

function StampEditor(props: EditorProps<StampMarkup>): React.JSX.Element {
	const { markup, handlers } = props;
	const inputRef = React.useRef<HTMLInputElement | null>(null);
	const definition = stampDefinition(markup.stamp);
	useEditorFocus(inputRef);
	return (
		<>
			<svg className={`${styles.layer} ${styles.layerEditorShape}`} viewBox={`0 0 ${props.pageWidth} ${props.pageHeight}`} preserveAspectRatio="none" aria-hidden="true">
				<StampShape markup={markup} hideMainText />
			</svg>
			<div
				data-markup-text-editor="true"
				className={styles.stampEditor}
				style={{
					left: percent(markup.x / props.pageWidth),
					top: percent(markup.y / props.pageHeight),
					width: percent(markup.w / props.pageWidth),
					height: percent(markup.h / props.pageHeight),
					color: markup.color,
					fontSize: scaledPx(markup.h * STAMP_LAYOUT.mainSize),
					borderRadius: scaledPx(markup.h * STAMP_LAYOUT.radius),
				}}
			>
				<div className={styles.stampEditorLine}>
					{definition.input === 'number' ? <span className={styles.stampEditorPrefix}>{`${markup.label} #`}</span> : null}
					<input
						ref={inputRef}
						className={styles.stampEditorInput}
						value={markup.text}
						placeholder={definition.input === 'number' ? handlers.placeholders.stampNumber : handlers.placeholders.stampLabel}
						autoComplete="off"
						enterKeyHint="done"
						spellCheck={definition.input !== 'number'}
						onChange={(event) => handlers.onChange(event.target.value)}
						onBlur={() => handlers.onCommit()}
						onKeyDown={(event) => commitOnKey(event, handlers, true)}
					/>
				</div>
			</div>
		</>
	);
}

/** Typing into a text note, callout or stamp, in place and at its real size, so what you type is what gets saved. */
export function MarkupTextEditor(props: EditorProps<TypedMarkup>): React.JSX.Element {
	const { markup } = props;
	if (markup.kind === 'callout') return <CalloutEditor {...props} markup={markup} />;
	if (markup.kind === 'stamp') return <StampEditor {...props} markup={markup} />;
	return <TextNoteEditor {...props} markup={markup} />;
}
