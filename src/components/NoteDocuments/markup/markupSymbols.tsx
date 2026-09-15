import React from 'react';

// The symbol library. Each symbol is a handful of plain shapes in its own little box (usually
// 100 × 100), drawn with the markup's colour. Kept as data rather than icon files so symbols are
// tiny in storage (a markup only stores the symbol's id), scale cleanly to any size on a sheet,
// and can be recoloured like everything else.
//
// These are simplified plan symbols in the spirit of the usual drawing conventions, not a
// certified standard: offices vary, and the name under each one says what it's meant to be.
// Abbreviations inside symbols (GFI, SD, WAP…) are drafting shorthand and stay as they are in
// every language; the names shown in the library are translated.
//
// Ids are stored in markup, so never rename or remove one. Add new ones instead.

export type SymbolPart =
	| { type: 'circle'; cx: number; cy: number; r: number; fill?: boolean }
	| { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: boolean }
	| { type: 'line'; x1: number; y1: number; x2: number; y2: number }
	| { type: 'rect'; x: number; y: number; w: number; h: number; rx?: number; fill?: boolean }
	| { type: 'polygon'; points: string; fill?: boolean }
	| { type: 'path'; d: string; fill?: boolean }
	| { type: 'text'; x: number; y: number; size: number; text: string };

export type SymbolCategory = 'electrical' | 'plumbing' | 'hvac' | 'network' | 'fire' | 'general' | 'flowchart';

export type SymbolDefinition = {
	id: string;
	category: SymbolCategory;
	nameKey: string;
	/** Extra English words to search by (the translated name is always searched too). */
	tags: string;
	w: number;
	h: number;
	stroke: number;
	parts: readonly SymbolPart[];
};

export const SYMBOL_CATEGORIES: ReadonlyArray<{ id: SymbolCategory; labelKey: string }> = [
	{ id: 'electrical', labelKey: 'documents.symbolCategoryElectrical' },
	{ id: 'plumbing', labelKey: 'documents.symbolCategoryPlumbing' },
	{ id: 'hvac', labelKey: 'documents.symbolCategoryHvac' },
	{ id: 'network', labelKey: 'documents.symbolCategoryNetwork' },
	{ id: 'fire', labelKey: 'documents.symbolCategoryFire' },
	{ id: 'general', labelKey: 'documents.symbolCategoryGeneral' },
	{ id: 'flowchart', labelKey: 'documents.symbolCategoryFlowchart' },
];

const C = (cx: number, cy: number, r: number, fill = false): SymbolPart => ({ type: 'circle', cx, cy, r, fill });
const E = (cx: number, cy: number, rx: number, ry: number, fill = false): SymbolPart => ({ type: 'ellipse', cx, cy, rx, ry, fill });
const L = (x1: number, y1: number, x2: number, y2: number): SymbolPart => ({ type: 'line', x1, y1, x2, y2 });
const R = (x: number, y: number, w: number, h: number, rx = 0, fill = false): SymbolPart => ({ type: 'rect', x, y, w, h, rx, fill });
const G = (points: string, fill = false): SymbolPart => ({ type: 'polygon', points, fill });
const P = (d: string, fill = false): SymbolPart => ({ type: 'path', d, fill });
const T = (x: number, y: number, size: number, text: string): SymbolPart => ({ type: 'text', x, y, size, text });

function S(
	id: string,
	category: SymbolCategory,
	tags: string,
	parts: SymbolPart[],
	box: { w?: number; h?: number; stroke?: number } = {},
): SymbolDefinition {
	return {
		id,
		category,
		nameKey: `documents.symbol${id.charAt(0).toUpperCase()}${id.slice(1)}`,
		tags,
		w: box.w ?? 100,
		h: box.h ?? 100,
		stroke: box.stroke ?? 6,
		parts,
	};
}

// A circle with letters in it: half the plan symbols on earth.
const lettered = (text: string, size = 30, r = 32): SymbolPart[] => [C(50, 50, r), T(50, 50, size, text)];
const duplex = (cx: number): SymbolPart[] => [C(cx, 50, 28), L(cx - 14, 14, cx - 14, 86), L(cx + 14, 14, cx + 14, 86)];
const bowtie = (fillLeft: boolean): SymbolPart[] => [G('8,8 50,30 8,52', fillLeft), G('92,8 50,30 92,52')];

export const SYMBOLS: readonly SymbolDefinition[] = [
	// ── Electrical ──
	S('receptacleDuplex', 'electrical', 'outlet plug duplex receptacle', duplex(50)),
	S('receptacleSingle', 'electrical', 'outlet plug simplex', [C(50, 50, 28), L(50, 14, 50, 86)]),
	S('receptacleGfci', 'electrical', 'outlet plug gfi gfci ground fault', [...duplex(50), T(118, 50, 28, 'GFI')], { w: 150 }),
	S('receptacleQuad', 'electrical', 'outlet plug fourplex quad double duplex', [...duplex(50), ...duplex(100)], { w: 150 }),
	S('receptacle240', 'electrical', 'outlet plug 240v range dryer welder', lettered('240', 24)),
	S('receptacleFloor', 'electrical', 'outlet plug floor box', [R(6, 6, 88, 88), C(50, 50, 26), L(38, 20, 38, 80), L(62, 20, 62, 80)]),
	S('switchSingle', 'electrical', 'switch light single pole', [T(50, 50, 64, 'S')]),
	S('switchThreeWay', 'electrical', 'switch 3 way three', [T(50, 50, 52, 'S3')]),
	S('switchDimmer', 'electrical', 'switch dimmer', [T(50, 50, 50, 'SD')]),
	S('switchOccupancy', 'electrical', 'occupancy vacancy sensor switch motion', lettered('OS', 28)),
	S('lightCeiling', 'electrical', 'light fixture ceiling luminaire', [C(50, 50, 26), L(50, 4, 50, 20), L(50, 80, 50, 96), L(4, 50, 20, 50), L(80, 50, 96, 50)]),
	S('lightRecessed', 'electrical', 'light pot can downlight recessed', [C(50, 50, 34), C(50, 50, 16)]),
	S('lightWall', 'electrical', 'light sconce wall fixture', [L(8, 72, 92, 72), P('M20 72 A30 30 0 0 1 80 72 Z')]),
	S('lightTroffer', 'electrical', 'light troffer 2x4 fluorescent led panel lay-in', [R(4, 4, 92, 42), L(4, 4, 96, 46), L(96, 4, 4, 46)], { h: 50 }),
	S('lightStrip', 'electrical', 'light strip linear', [R(4, 6, 132, 18, 9)], { w: 140, h: 30 }),
	S('ceilingFan', 'electrical', 'fan ceiling', [C(50, 50, 10), P('M56 44 L78 10 L90 22 Z'), P('M56 56 L90 78 L78 90 Z'), P('M44 56 L22 90 L10 78 Z'), P('M44 44 L10 22 L22 10 Z')]),
	S('junctionBox', 'electrical', 'junction box j-box', lettered('J', 40)),
	S('panelboard', 'electrical', 'panel breaker panelboard distribution', [R(4, 4, 112, 42), G('4,4 116,4 4,46', true)], { w: 120, h: 50 }),
	S('disconnect', 'electrical', 'disconnect safety switch', [R(10, 10, 80, 80), T(50, 50, 44, 'D')]),
	S('motor', 'electrical', 'motor', lettered('M', 36)),
	S('transformer', 'electrical', 'transformer xfmr', [R(4, 4, 112, 52, 4), T(60, 30, 24, 'XFMR')], { w: 120, h: 60 }),
	S('homeRun', 'electrical', 'home run circuit wire panel', [L(8, 30, 98, 30), G('112,30 92,18 92,42', true), L(36, 16, 44, 44), L(52, 16, 60, 44)], { w: 120, h: 60 }),

	// ── Plumbing ──
	S('floorDrain', 'plumbing', 'floor drain fd', lettered('FD', 28)),
	S('cleanout', 'plumbing', 'cleanout co drain', lettered('CO', 28)),
	S('hoseBib', 'plumbing', 'hose bib spigot faucet tap', lettered('HB', 28)),
	S('waterHeater', 'plumbing', 'water heater tank', lettered('WH', 30, 40)),
	S('valveGate', 'plumbing', 'valve gate shutoff', bowtie(false), { h: 60 }),
	S('valveCheck', 'plumbing', 'valve check non-return', bowtie(true), { h: 60 }),
	S('valveBall', 'plumbing', 'valve ball shutoff', [...bowtie(false), C(50, 30, 8, true)], { h: 60 }),
	S('sink', 'plumbing', 'sink basin lavatory', [R(6, 14, 88, 72, 10), R(18, 26, 64, 48, 16), C(50, 50, 4, true)]),
	S('toilet', 'plumbing', 'toilet wc water closet', [R(6, 4, 58, 22, 4), E(35, 62, 26, 34)], { w: 70 }),
	S('shower', 'plumbing', 'shower stall', [R(6, 6, 88, 88), L(6, 6, 94, 94), L(94, 6, 6, 94)]),
	S('sumpPump', 'plumbing', 'sump pump pit', lettered('SP', 28, 36)),
	S('backflowPreventer', 'plumbing', 'backflow preventer bfp rpz', [R(4, 4, 112, 52, 4), T(60, 30, 26, 'BFP')], { w: 120, h: 60 }),

	// ── HVAC ──
	S('supplyDiffuser', 'hvac', 'supply diffuser air grille register', [R(6, 6, 88, 88), R(30, 30, 40, 40), L(6, 6, 30, 30), L(94, 6, 70, 30), L(6, 94, 30, 70), L(94, 94, 70, 70)]),
	S('returnGrille', 'hvac', 'return air grille', [R(6, 6, 88, 88), L(6, 94, 94, 6)]),
	S('exhaustFan', 'hvac', 'exhaust fan ef bathroom', [R(6, 6, 88, 88), C(50, 50, 30), T(50, 50, 24, 'EF')]),
	S('thermostat', 'hvac', 'thermostat t stat', lettered('T', 36)),
	S('humidistat', 'hvac', 'humidistat humidity', lettered('H', 36)),
	S('vavBox', 'hvac', 'vav variable air volume box terminal', [R(4, 4, 112, 52), T(60, 30, 26, 'VAV')], { w: 120, h: 60 }),
	S('damper', 'hvac', 'damper duct balancing', [R(4, 4, 112, 42), L(20, 40, 100, 10), C(60, 25, 4, true)], { w: 120, h: 50 }),
	S('unitHeater', 'hvac', 'unit heater uh', [R(8, 8, 84, 84), T(50, 50, 30, 'UH')]),
	S('rooftopUnit', 'hvac', 'rooftop unit rtu air handler ahu', [R(4, 4, 112, 72, 4), T(60, 40, 28, 'RTU')], { w: 120, h: 80 }),

	// ── IT & AV ──
	S('dataOutlet', 'network', 'data jack ethernet network cat6 outlet', [G('50,14 88,82 12,82')]),
	S('voiceOutlet', 'network', 'phone telephone voice jack outlet', [G('50,14 88,82 12,82', true)]),
	S('dataVoiceOutlet', 'network', 'data phone voice combination jack outlet', [G('50,14 88,82 12,82'), G('50,14 50,82 12,82', true)]),
	S('wirelessAp', 'network', 'wifi wireless access point wap ap', [C(50, 60, 24), T(50, 60, 20, 'AP'), P('M20 32 A40 40 0 0 1 80 32')]),
	S('camera', 'network', 'camera cctv security surveillance', [R(6, 30, 60, 40, 6), G('66,42 94,28 94,72 66,58')]),
	S('cardReader', 'network', 'card reader access control badge', [R(24, 8, 52, 84, 6), T(50, 50, 24, 'CR')]),
	S('motionSensor', 'network', 'motion sensor pir detector alarm', lettered('MS', 28)),
	S('speaker', 'network', 'speaker audio paging', lettered('SPK', 22)),
	S('tvOutlet', 'network', 'tv television coax cable outlet', [R(10, 22, 80, 56, 4), T(50, 50, 28, 'TV')]),
	S('networkRack', 'network', 'rack cabinet server network', [R(6, 4, 58, 92, 3), L(6, 30, 64, 30), L(6, 54, 64, 54), L(6, 78, 64, 78)], { w: 70 }),
	S('networkSwitch', 'network', 'network switch ethernet ports', [R(4, 6, 112, 38, 4), C(26, 25, 4, true), C(46, 25, 4, true), C(66, 25, 4, true), C(86, 25, 4, true)], { w: 120, h: 50 }),
	S('projector', 'network', 'projector av display', [R(6, 26, 88, 48, 6), C(70, 50, 13)]),

	// ── Fire & life safety ──
	S('smokeDetector', 'fire', 'smoke detector alarm sd', lettered('SD', 30)),
	S('heatDetector', 'fire', 'heat detector hd', lettered('HD', 30)),
	S('coDetector', 'fire', 'carbon monoxide co detector', [C(50, 50, 38), C(50, 50, 29), T(50, 50, 24, 'CO')]),
	S('pullStation', 'fire', 'pull station manual fire alarm', [R(14, 14, 72, 72), T(50, 50, 44, 'F')]),
	S('hornStrobe', 'fire', 'horn strobe notification appliance', [R(10, 14, 80, 72), G('30,70 50,30 70,70')]),
	S('sprinklerHead', 'fire', 'sprinkler head', [C(50, 50, 24), C(50, 50, 6, true), L(50, 10, 50, 26), L(50, 74, 50, 90), L(10, 50, 26, 50), L(74, 50, 90, 50)]),
	S('fireExtinguisher', 'fire', 'fire extinguisher fe cabinet', [R(26, 6, 48, 88, 10), T(50, 50, 24, 'FE')]),
	S('exitSign', 'fire', 'exit sign egress', [R(4, 4, 132, 52, 4), T(70, 30, 30, 'EXIT')], { w: 140, h: 60 }),
	S('emergencyLight', 'fire', 'emergency light battery unit', [R(4, 8, 112, 34), C(34, 25, 9, true), C(86, 25, 9, true)], { w: 120, h: 50 }),
	S('fireAlarmPanel', 'fire', 'fire alarm control panel facp', [R(4, 4, 112, 52), T(60, 30, 24, 'FACP')], { w: 120, h: 60 }),
	S('aed', 'fire', 'aed defibrillator', [R(10, 10, 80, 80, 8), T(50, 50, 26, 'AED')]),

	// ── General & drafting ──
	S('northArrow', 'general', 'north arrow orientation compass', [C(50, 50, 44), G('50,10 66,70 50,58 34,70', true), T(50, 82, 18, 'N')]),
	S('sectionMarker', 'general', 'section cut marker', [C(50, 50, 30), L(20, 50, 80, 50), G('80,50 96,50 80,30', true)]),
	S('detailMarker', 'general', 'detail callout bubble reference', [C(50, 50, 36), L(14, 50, 86, 50)]),
	S('elevationMarker', 'general', 'elevation view marker', [C(50, 56, 30), G('50,6 74,34 26,34', true)]),
	S('keynote', 'general', 'keynote hexagon tag', [G('27,10 73,10 96,50 73,90 27,90 4,50')]),
	S('revisionTriangle', 'general', 'revision delta triangle', [G('50,10 94,88 6,88')]),
	S('pointMarker', 'general', 'point target crosshair location', [C(50, 50, 26), L(50, 4, 50, 96), L(4, 50, 96, 50)]),
	S('checkMark', 'general', 'check tick ok done', [P('M14 52 L40 78 L88 22')], { stroke: 10 }),
	S('crossMark', 'general', 'cross x no remove', [L(18, 18, 82, 82), L(82, 18, 18, 82)], { stroke: 10 }),
	S('question', 'general', 'question unknown', lettered('?', 50, 40)),
	S('warning', 'general', 'warning caution hazard', [G('50,8 94,88 6,88'), T(50, 64, 40, '!')]),
	S('star', 'general', 'star important', [G('50,6 61,38 95,38 67,58 78,92 50,72 22,92 33,58 5,38 39,38')]),

	// ── Flowchart & software ──
	S('flowProcess', 'flowchart', 'process step box', [R(4, 4, 132, 72)], { w: 140, h: 80 }),
	S('flowDecision', 'flowchart', 'decision diamond branch', [G('60,4 116,50 60,96 4,50')], { w: 120 }),
	S('flowTerminator', 'flowchart', 'terminator start end', [R(4, 4, 132, 62, 31)], { w: 140, h: 70 }),
	S('flowData', 'flowchart', 'input output data parallelogram', [G('30,4 136,4 110,76 4,76')], { w: 140, h: 80 }),
	S('flowDocument', 'flowchart', 'document report', [P('M4 4 H116 V82 C86 66 66 100 36 88 C22 82 12 82 4 86 Z')], { w: 120 }),
	S('flowDatabase', 'flowchart', 'database storage cylinder db', [P('M6 20 A44 14 0 0 0 94 20 A44 14 0 0 0 6 20 V100 A44 14 0 0 0 94 100 V20')], { h: 120 }),
	S('flowConnector', 'flowchart', 'connector circle junction', [C(50, 50, 40)]),
	S('flowPredefined', 'flowchart', 'subroutine predefined process function', [R(4, 4, 132, 72), L(22, 4, 22, 76), L(118, 4, 118, 76)], { w: 140, h: 80 }),
	S('flowManualInput', 'flowchart', 'manual input keyboard', [G('4,30 136,4 136,76 4,76')], { w: 140, h: 80 }),
	S('flowDelay', 'flowchart', 'delay wait', [P('M4 4 H90 A36 36 0 0 1 90 76 H4 Z')], { w: 130, h: 80 }),
	S('flowUser', 'flowchart', 'user person actor', [C(40, 26, 18), P('M8 96 C8 62 72 62 72 96 Z')], { w: 80 }),
];

const byId = new Map(SYMBOLS.map((definition) => [definition.id, definition]));

export const SYMBOL_IDS: readonly string[] = SYMBOLS.map((definition) => definition.id);

export function symbolById(id: string): SymbolDefinition | null {
	return byId.get(id) ?? null;
}

const MARKUP_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/** A symbol's shapes, in its own box's units. Wrap in an <svg> with the symbol's viewBox. */
export function SymbolParts(props: { definition: SymbolDefinition; color: string }): React.JSX.Element {
	const { definition, color } = props;
	return (
		<g fill="none" stroke={color} strokeWidth={definition.stroke} strokeLinecap="round" strokeLinejoin="round">
			{definition.parts.map((part, index) => {
				const fill = 'fill' in part && part.fill ? color : undefined;
				switch (part.type) {
					case 'circle':
						return <circle key={index} cx={part.cx} cy={part.cy} r={part.r} fill={fill} />;
					case 'ellipse':
						return <ellipse key={index} cx={part.cx} cy={part.cy} rx={part.rx} ry={part.ry} fill={fill} />;
					case 'line':
						return <line key={index} x1={part.x1} y1={part.y1} x2={part.x2} y2={part.y2} />;
					case 'rect':
						return <rect key={index} x={part.x} y={part.y} width={part.w} height={part.h} rx={part.rx} fill={fill} />;
					case 'polygon':
						return <polygon key={index} points={part.points} fill={fill} />;
					case 'path':
						return <path key={index} d={part.d} fill={fill} />;
					case 'text':
						return (
							<text
								key={index}
								x={part.x}
								y={part.y}
								fontSize={part.size}
								textAnchor="middle"
								dominantBaseline="central"
								fontWeight={700}
								fontFamily={MARKUP_FONT}
								fill={color}
								stroke="none"
							>
								{part.text}
							</text>
						);
					default:
						return null;
				}
			})}
		</g>
	);
}

/** A symbol as a small picture for the tool bar and the library. */
export function SymbolGlyph(props: { definition: SymbolDefinition; size: number }): React.JSX.Element {
	const { definition } = props;
	const pad = 8;
	return (
		<svg
			width={props.size}
			height={props.size}
			viewBox={`${-pad} ${-pad} ${definition.w + pad * 2} ${definition.h + pad * 2}`}
			aria-hidden="true"
		>
			<SymbolParts definition={definition} color="currentColor" />
		</svg>
	);
}
