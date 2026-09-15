// Markup lives in PDF page units: pdf.js's viewport at scale 1 (points, with the page's own
// rotation applied). Everything is drawn in those units and scaled with the page, so a cloud
// drawn at 300% sits on the same receptacle at 100%, on a phone or a 4K monitor. Stroke widths
// and font sizes are page units too, which is why ink and text grow as you zoom in, like paper.

export type MarkupTool =
	| 'select'
	| 'pen'
	| 'highlighter'
	| 'eraser'
	| 'line'
	| 'arrow'
	| 'rect'
	| 'ellipse'
	| 'cloud'
	| 'callout'
	| 'move'
	| 'stamp'
	| 'symbol'
	| 'comment'
	| 'length'
	| 'path'
	| 'area'
	| 'calibrate'
	| 'text';

type MarkupBase = {
	id: string;
	/** 1-based page number. */
	page: number;
	color: string;
	/** Stroke width in page units (unused by text). */
	width: number;
	createdAt: number;
	updatedAt: number;
};

/** Who made a callout or stamp. The name is a snapshot, so it still reads right if they leave. */
export type MarkupAuthor = { id: string; name: string };

export type InkMarkup = MarkupBase & {
	kind: 'ink';
	/** Flat [x0, y0, x1, y1, …] in page units. */
	points: number[];
	highlighter?: boolean;
};

/** Lines, arrows, and move markers (a dashed arrow from where a thing is to where it goes). */
export type SegmentMarkup = MarkupBase & { kind: 'line' | 'arrow' | 'move'; x1: number; y1: number; x2: number; y2: number };

export type BoxMarkup = MarkupBase & { kind: 'rect' | 'ellipse'; x: number; y: number; w: number; h: number };

/** A revision cloud: a closed outline (four corners for a rectangle cloud) drawn with scallops. */
export type CloudMarkup = MarkupBase & {
	kind: 'cloud';
	/** Flat [x0, y0, x1, y1, …] corners, closed back to the first. */
	points: number[];
	/** Length of one scallop in page units, fixed when it's drawn so it looks right at that zoom. */
	arc: number;
};

export type TextMarkup = MarkupBase & {
	kind: 'text';
	x: number;
	y: number;
	/** Wrap width in page units. */
	w: number;
	/** Last measured height in page units, used for selecting and erasing. */
	h: number;
	text: string;
	fontSize: number;
	/** White backing so text stays readable over busy linework. On unless turned off. */
	background?: boolean;
};

/** A boxed note with a leader arrow pointing at the thing it's about. */
export type CalloutMarkup = MarkupBase & {
	kind: 'callout';
	/** Where the arrow points. */
	tipX: number;
	tipY: number;
	x: number;
	y: number;
	w: number;
	/** Last measured height of the box, author line included. */
	h: number;
	text: string;
	fontSize: number;
	author?: MarkupAuthor;
};

export type StampPreset =
	| 'rfi'
	| 'approved'
	| 'reviewed'
	| 'revise'
	| 'rejected'
	| 'hold'
	| 'void'
	| 'fieldVerify'
	| 'asBuilt'
	| 'notInContract'
	| 'custom';

export type StampMarkup = MarkupBase & {
	kind: 'stamp';
	x: number;
	y: number;
	w: number;
	h: number;
	stamp: StampPreset;
	/** The stamp's word, stored as placed so everyone sees the same thing whatever their language. */
	label: string;
	/** The typed part: the RFI number, or the whole wording of a custom stamp. */
	text: string;
	author?: MarkupAuthor;
};

/** A symbol from the library (markupSymbols.tsx), placed as a box and turned in quarter steps. */
export type SymbolMarkup = MarkupBase & {
	kind: 'symbol';
	/** The box it covers on the page, after turning. */
	x: number;
	y: number;
	w: number;
	h: number;
	/** Library id. One this version doesn't know shows as a placeholder rather than vanishing. */
	symbol: string;
	rotation: 0 | 90 | 180 | 270;
};

/**
 * A comment pin. The pin keeps the same size on screen at any zoom, so only its point is stored.
 * Numbers come from a counter in the document and only ever go up, so "comment 4" never changes
 * meaning when comment 3 is deleted.
 */
export type CommentMarkup = MarkupBase & {
	kind: 'comment';
	x: number;
	y: number;
	number: number;
	text: string;
	status: 'open' | 'resolved';
	resolvedAt?: number;
	resolvedBy?: MarkupAuthor;
	author?: MarkupAuthor;
};

/**
 * A reply to a comment. Stored in their own map rather than inside the comment, so two people
 * replying at once (Stage 4) both land instead of one overwriting the other.
 */
export type MarkupReply = {
	id: string;
	commentId: string;
	text: string;
	author?: MarkupAuthor;
	createdAt: number;
	updatedAt: number;
};

export type MeasureSystem = 'imperial' | 'metric';

/**
 * A page's scale, so measurements read in real units. Kept per page: a plan set mixes 1/4" floor
 * plans, 1-1/2" details and 1:100 site plans. Synced with the rest of the markup.
 */
export type PageScale = {
	page: number;
	system: MeasureSystem;
	/** Real inches (imperial) or real millimetres (metric) that one page unit (a PDF point) stands for. */
	realPerUnit: number;
	/** Metric only: show millimetres or metres. */
	metricUnit?: 'mm' | 'm';
	/** The standard scale it was picked from; absent when calibrated from a known dimension. */
	preset?: string;
	updatedAt: number;
};

/** A measurement: a length (two points), a path (a run of points) or an area (a closed outline). */
export type MeasureMarkup = MarkupBase & {
	kind: 'measure';
	mode: 'length' | 'path' | 'area';
	/** Flat [x0, y0, x1, y1, …] in page units. */
	points: number[];
};

export type Markup = InkMarkup | SegmentMarkup | BoxMarkup | CloudMarkup | TextMarkup | CalloutMarkup | StampMarkup | SymbolMarkup | CommentMarkup | MeasureMarkup;

/** Markups that are typed into after they're placed. */
export type TypedMarkup = TextMarkup | CalloutMarkup | StampMarkup;

// Strong colours that survive being printed or sent as a PDF: red for changes, blue for notes,
// green for approved, orange, purple, and black.
export const MARKUP_PEN_COLORS = ['#e02424', '#1c64f2', '#0e9f6e', '#ff8a00', '#9333ea', '#111827'] as const;
export const MARKUP_HIGHLIGHTER_COLORS = ['#facc15', '#4ade80', '#f472b6', '#60a5fa', '#fb923c'] as const;
export const MARKUP_PEN_WIDTHS = [1.5, 3, 6] as const;
export const MARKUP_HIGHLIGHTER_WIDTHS = [10, 18, 28] as const;
export const MARKUP_TEXT_SIZES = [10, 14, 20, 28] as const;
export const HIGHLIGHTER_OPACITY = 0.35;
/** Text box padding in page units, matched by the CSS (see .textItem). */
export const TEXT_PADDING_UNITS = 3;

/**
 * The stamp set. RFI numbers come from whatever system the team already uses, so the number is
 * typed, never generated. "Custom" is typed wording for everything this list doesn't cover.
 */
export const MARKUP_STAMPS: ReadonlyArray<{ preset: StampPreset; labelKey: string; color: string; input?: 'number' | 'label' }> = [
	{ preset: 'rfi', labelKey: 'documents.markupStampRfi', color: '#9333ea', input: 'number' },
	{ preset: 'approved', labelKey: 'documents.markupStampApproved', color: '#0e9f6e' },
	{ preset: 'reviewed', labelKey: 'documents.markupStampReviewed', color: '#1c64f2' },
	{ preset: 'revise', labelKey: 'documents.markupStampRevise', color: '#ff8a00' },
	{ preset: 'rejected', labelKey: 'documents.markupStampRejected', color: '#e02424' },
	{ preset: 'hold', labelKey: 'documents.markupStampHold', color: '#ff8a00' },
	{ preset: 'void', labelKey: 'documents.markupStampVoid', color: '#e02424' },
	{ preset: 'fieldVerify', labelKey: 'documents.markupStampFieldVerify', color: '#ff8a00' },
	{ preset: 'asBuilt', labelKey: 'documents.markupStampAsBuilt', color: '#1c64f2' },
	{ preset: 'notInContract', labelKey: 'documents.markupStampNotInContract', color: '#111827' },
	{ preset: 'custom', labelKey: 'documents.markupStampCustom', color: '#e02424', input: 'label' },
];

export function stampDefinition(preset: StampPreset): (typeof MARKUP_STAMPS)[number] {
	return MARKUP_STAMPS.find((entry) => entry.preset === preset) ?? MARKUP_STAMPS[0];
}

export function createMarkupId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const isNumber = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value);

function isAuthor(value: unknown): boolean {
	if (value === undefined) return true;
	const author = value as Partial<MarkupAuthor> | null;
	return Boolean(author && typeof author.id === 'string' && typeof author.name === 'string');
}

/** Anything read back from storage (and, later, from other devices) is checked before it's drawn. */
export function isMarkup(value: unknown): value is Markup {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<Markup>;
	if (typeof candidate.id !== 'string' || !isNumber(candidate.page) || typeof candidate.color !== 'string' || !isNumber(candidate.width)) {
		return false;
	}
	switch (candidate.kind) {
		case 'ink':
			return Array.isArray((candidate as InkMarkup).points) && (candidate as InkMarkup).points.length >= 2;
		case 'line':
		case 'arrow':
		case 'move': {
			const segment = candidate as SegmentMarkup;
			return [segment.x1, segment.y1, segment.x2, segment.y2].every(isNumber);
		}
		case 'rect':
		case 'ellipse': {
			const box = candidate as BoxMarkup;
			return [box.x, box.y, box.w, box.h].every(isNumber);
		}
		case 'cloud': {
			const cloud = candidate as CloudMarkup;
			return Array.isArray(cloud.points) && cloud.points.length >= 6 && cloud.points.every(isNumber) && isNumber(cloud.arc) && cloud.arc > 0;
		}
		case 'text': {
			const text = candidate as TextMarkup;
			return typeof text.text === 'string' && [text.x, text.y, text.w, text.h, text.fontSize].every(isNumber);
		}
		case 'callout': {
			const callout = candidate as CalloutMarkup;
			return typeof callout.text === 'string'
				&& [callout.tipX, callout.tipY, callout.x, callout.y, callout.w, callout.h, callout.fontSize].every(isNumber)
				&& isAuthor(callout.author);
		}
		case 'stamp': {
			const stamp = candidate as StampMarkup;
			return typeof stamp.label === 'string'
				&& typeof stamp.text === 'string'
				&& typeof stamp.stamp === 'string'
				&& [stamp.x, stamp.y, stamp.w, stamp.h].every(isNumber)
				&& stamp.w > 0
				&& stamp.h > 0
				&& isAuthor(stamp.author);
		}
		case 'symbol': {
			const symbol = candidate as SymbolMarkup;
			return typeof symbol.symbol === 'string'
				&& [symbol.x, symbol.y, symbol.w, symbol.h].every(isNumber)
				&& symbol.w > 0
				&& symbol.h > 0
				&& [0, 90, 180, 270].includes(symbol.rotation);
		}
		case 'comment': {
			const comment = candidate as CommentMarkup;
			return typeof comment.text === 'string'
				&& [comment.x, comment.y, comment.number].every(isNumber)
				&& (comment.status === 'open' || comment.status === 'resolved')
				&& isAuthor(comment.author)
				&& isAuthor(comment.resolvedBy);
		}
		case 'measure': {
			const measure = candidate as MeasureMarkup;
			const minimum = measure.mode === 'area' ? 6 : 4;
			return (measure.mode === 'length' || measure.mode === 'path' || measure.mode === 'area')
				&& Array.isArray(measure.points)
				&& measure.points.length >= minimum
				&& measure.points.length % 2 === 0
				&& measure.points.every(isNumber);
		}
		default:
			return false;
	}
}

export function isPageScale(value: unknown): value is PageScale {
	if (!value || typeof value !== 'object') return false;
	const scale = value as Partial<PageScale>;
	return isNumber(scale.page)
		&& (scale.system === 'imperial' || scale.system === 'metric')
		&& isNumber(scale.realPerUnit)
		&& (scale.realPerUnit as number) > 0
		&& (scale.metricUnit === undefined || scale.metricUnit === 'mm' || scale.metricUnit === 'm');
}

export function isMarkupReply(value: unknown): value is MarkupReply {
	if (!value || typeof value !== 'object') return false;
	const reply = value as Partial<MarkupReply>;
	return typeof reply.id === 'string'
		&& typeof reply.commentId === 'string'
		&& typeof reply.text === 'string'
		&& isNumber(reply.createdAt)
		&& isAuthor(reply.author);
}

/**
 * Two people offline can both post "comment #5" (plan decision 1a). Once synced, every device sees
 * the same comments and the same counter, so every device reaches the same answer here: in each
 * clash the oldest comment (createdAt, then id) keeps its number and the others get the next free
 * numbers, clashes handled lowest number first. Devices applying it at the same time write the same
 * values, so they agree instead of fighting.
 *
 * @returns the comments to renumber and their new numbers (empty when there's no clash).
 */
export function planCommentRenumbering(comments: readonly CommentMarkup[], counter: number): Array<{ id: string; number: number }> {
	const byNumber = new Map<number, CommentMarkup[]>();
	let highest = Number.isFinite(counter) ? counter : 0;
	for (const comment of comments) {
		highest = Math.max(highest, comment.number);
		const group = byNumber.get(comment.number) ?? [];
		group.push(comment);
		byNumber.set(comment.number, group);
	}
	const changes: Array<{ id: string; number: number }> = [];
	for (const number of Array.from(byNumber.keys()).sort((left, right) => left - right)) {
		const group = byNumber.get(number) ?? [];
		if (group.length < 2) continue;
		group.sort((left, right) => left.createdAt - right.createdAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
		for (const comment of group.slice(1)) {
			highest += 1;
			changes.push({ id: comment.id, number: highest });
		}
	}
	return changes;
}
