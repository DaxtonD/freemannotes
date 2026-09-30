import { createMarkupId, isMarkup, type Markup, type PageScale } from './markupTypes';
import { clampMoveToPage, markupsBounds, translateMarkup } from './markupGeometry';

/**
 * Cut / copy / paste for PDF markup.
 *
 * Lives in sessionStorage rather than a module variable so it survives a reload and following a
 * link to a different document in the same tab — copy a legend off revision A, open revision B,
 * paste it. Deliberately NOT localStorage: a clipboard that outlives the tab and reappears days
 * later is a surprise, not a feature. And not the system clipboard, because these are structured
 * objects, and reading the real clipboard needs a permission prompt that would be absurd here.
 */

const STORAGE_KEY = 'freemannotes.markupClipboard.v1';

/** Past this we keep the clipboard in memory only. A few long ink strokes get big fast, and
 *  blowing the sessionStorage quota would throw away whatever else the tab is keeping there. */
const MAX_STORED_BYTES = 512 * 1024;

/** How far a paste onto the SAME page is nudged, in page units, so it doesn't hide the original. */
const SAME_PAGE_PASTE_OFFSET_UNITS = 12;

export type MarkupClipboard = {
	markups: readonly Markup[];
	/** The page they were taken from. */
	sourcePage: number;
	/**
	 * That page's scale at the time. Measurements are stored as raw geometry and read against
	 * whatever scale their page has, so the same line means a different real length on a page
	 * scaled differently — see prepareMarkupPaste.
	 */
	sourceScale: PageScale | null;
	/** Which document version they came from. Only used to tell the user, not to gate anything. */
	sourceVersionId: string;
	copiedAt: number;
};

/** Kept in memory as well, so an oversized payload still pastes within the session. */
let memoryClipboard: MarkupClipboard | null = null;

function sameScale(left: PageScale | null, right: PageScale | null): boolean {
	if (!left && !right) return true;
	if (!left || !right) return false;
	return left.system === right.system
		&& left.realPerUnit === right.realPerUnit
		&& (left.metricUnit ?? null) === (right.metricUnit ?? null);
}

/**
 * Comments never go on the clipboard. They carry a sequential number and their replies live in a
 * separate map keyed by comment id — a copy would either duplicate a number or silently drop a
 * conversation, and neither is something anyone wants from Ctrl+C.
 */
export function copyableMarkups(markups: readonly Markup[]): readonly Markup[] {
	return markups.filter((markup) => markup.kind !== 'comment');
}

export function writeMarkupClipboard(entry: MarkupClipboard): void {
	memoryClipboard = entry;
	if (typeof window === 'undefined') return;
	try {
		const serialized = JSON.stringify(entry);
		if (serialized.length > MAX_STORED_BYTES) {
			window.sessionStorage.removeItem(STORAGE_KEY);
			return;
		}
		window.sessionStorage.setItem(STORAGE_KEY, serialized);
	} catch {
		// Quota or blocked storage: the in-memory copy above still works for this session.
	}
}

export function readMarkupClipboard(): MarkupClipboard | null {
	if (typeof window !== 'undefined') {
		try {
			const raw = window.sessionStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed: unknown = JSON.parse(raw);
				const entry = parsed as Partial<MarkupClipboard> | null;
				const markups = Array.isArray(entry?.markups) ? entry.markups.filter(isMarkup) : [];
				// Anything read back from storage is validated before it's drawn, same rule the
				// markup store follows for its own persisted items.
				if (markups.length > 0 && typeof entry?.sourcePage === 'number') {
					return {
						markups,
						sourcePage: entry.sourcePage,
						sourceScale: (entry.sourceScale as PageScale | undefined) ?? null,
						sourceVersionId: typeof entry.sourceVersionId === 'string' ? entry.sourceVersionId : '',
						copiedAt: typeof entry.copiedAt === 'number' ? entry.copiedAt : 0,
					};
				}
			}
		} catch {
			// Unparseable or blocked: fall through to whatever is in memory.
		}
	}
	return memoryClipboard;
}

export function clearMarkupClipboard(): void {
	memoryClipboard = null;
	if (typeof window === 'undefined') return;
	try {
		window.sessionStorage.removeItem(STORAGE_KEY);
	} catch {
		// Nothing to do.
	}
}

export type PreparedPaste = {
	/** Fresh markups, ready to hand to addMany. */
	markups: readonly Markup[];
	/** Measurements left behind because the target page is scaled differently. */
	skippedMeasurements: number;
};

/**
 * Turns clipboard contents into new markups for a target page: fresh ids, the target page number,
 * and a nudge when pasting back onto the page they came from.
 *
 * Measurements are dropped when the target page's scale differs from the source's. A measurement
 * is stored as raw page geometry and rendered against its page's scale, so the identical line
 * reads as 4 metres on a 1:100 site plan and 12 feet on a quarter-inch floor plan. Pasting one
 * across that boundary would silently change what it claims — on a plan set someone builds from,
 * that is worse than refusing.
 */
export function prepareMarkupPaste(args: {
	clipboard: MarkupClipboard;
	targetPage: number;
	targetScale: PageScale | null;
	/** The target page's size, so a paste can't land outside it. Omitted only if it isn't known. */
	targetSize?: { width: number; height: number } | null;
}): PreparedPaste {
	const { clipboard, targetPage, targetScale, targetSize } = args;
	const samePage = targetPage === clipboard.sourcePage;
	const offset = samePage ? SAME_PAGE_PASTE_OFFSET_UNITS : 0;
	const scaleMatches = sameScale(clipboard.sourceScale, targetScale);
	const now = Date.now();

	const markups: Markup[] = [];
	let skippedMeasurements = 0;
	for (const source of clipboard.markups) {
		if (source.kind === 'measure' && !scaleMatches) {
			skippedMeasurements += 1;
			continue;
		}
		const moved = offset === 0 ? source : translateMarkup(source, offset, offset);
		markups.push({ ...moved, id: createMarkupId(), page: targetPage, createdAt: now, updatedAt: now });
	}

	// Pasting near an edge — or onto a smaller sheet than the one it was copied from — would
	// otherwise drop markup outside the page, where it's invisible and unrecoverable. Trimmed as
	// one group so a pasted legend keeps its layout instead of collapsing against the margin.
	if (targetSize && markups.length > 0) {
		const box = markupsBounds(markups);
		if (box) {
			const shift = clampMoveToPage(box, 0, 0, targetSize.width, targetSize.height);
			if (shift.dx !== 0 || shift.dy !== 0) {
				return {
					markups: markups.map((item) => translateMarkup(item, shift.dx, shift.dy)),
					skippedMeasurements,
				};
			}
		}
	}
	return { markups, skippedMeasurements };
}
