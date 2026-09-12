/**
 * Dev-only note-card height diagnostics.
 *
 * The checklist card's height is the product of a lot of moving parts — chrome
 * (header/banner/meta chips/URL preview rail), the completed-items row, per-item
 * line costs that depend on measured wrap state, the text-size preference, and
 * the max-card-height preference. Every past attempt to fix a clipping bug here
 * by looking at a screenshot has cost days, because a screenshot can't tell you
 * whether a card is short because the FORMULA under-reserved, because a
 * MEASUREMENT was stale, or because something OVERRODE the height. Those three
 * have completely different fixes.
 *
 * So: capture the arithmetic instead of guessing at the picture. This records
 * every term that feeds the height computation, what the card actually rendered
 * at, and precisely how many pixels are being clipped off which element.
 *
 * Enable with `?cardDiag=1` (sticky per browser, same pattern as
 * `?forceVirtualization=1`). Completely inert unless enabled — the register
 * calls bail on the first line and nothing is retained.
 */

const CARD_DIAG_STORAGE_KEY = 'freemannotes.cardDiag';

function parseToggle(value: unknown): boolean | null {
	const normalized = String(value ?? '').trim().toLowerCase();
	if (!normalized) return null;
	if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
	if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
	return null;
}

export const CARD_DIAG_ENABLED = (() => {
	if (typeof window === 'undefined') return false;
	try {
		const url = new URL(window.location.href);
		const queryValue = parseToggle(url.searchParams.get('cardDiag'));
		if (queryValue !== null) {
			try {
				window.localStorage.setItem(CARD_DIAG_STORAGE_KEY, queryValue ? '1' : '0');
			} catch {
				// Best effort only.
			}
			return queryValue;
		}
	} catch {
		// ignore malformed location state
	}
	try {
		return parseToggle(window.localStorage.getItem(CARD_DIAG_STORAGE_KEY)) === true;
	} catch {
		return false;
	}
})();

/** Everything the card COMPUTED, straight from the memos that decide its height. */
export type NoteCardDiagComputed = {
	noteId: string;
	title: string;
	type: string;
	hasBanner: boolean;
	completedExpanded: boolean;
	completedTotal: number;
	fontScale: number;
	maxCardHeightPx: number;
	forcedHeightPx: number | null;
	// individual terms of the height formula
	headerHeightPx: number;
	metaHeightPx: number;
	linkPreviewHeightPx: number;
	cardPaddingBottomPx: number;
	bodyPaddingVerticalPx: number;
	completedBaseHeightPx: number;
	lineHeightPx: number;
	availableLineBudget: number;
	usedLineCount: number;
	itemsShown: number;
	itemsTotal: number;
	computedCollapsedMinHeightPx: number;
	computedExpandedMaxHeightPx: number;
};

/** Live element refs so we can read real geometry at capture time. */
export type NoteCardDiagElements = {
	card: HTMLElement | null;
	header: HTMLElement | null;
	metaChipRow: HTMLElement | null;
	contentRegion: HTMLElement | null;
	body: HTMLElement | null;
	completedSection: HTMLElement | null;
	linkPreviewRail: HTMLElement | null;
	footer: HTMLElement | null;
};

/**
 * How bad is the clipping, really?
 *
 * A few pixels shaved off the completed row's own bottom PADDING is invisible —
 * the text and the menu button still render in full. Losing pixels beyond that
 * padding is where content actually disappears. Reporting both as "clipping"
 * (the first version of this tool did) makes every checklist card look broken at
 * every font scale and buries the two or three cards that are genuinely wrong.
 */
export type NoteCardDiagSeverity = 'ok' | 'cosmetic' | 'content-loss';

/** Computed values joined with what actually rendered. */
export type NoteCardDiagRow = NoteCardDiagComputed & {
	isChecklist: boolean;
	chipCount: number;
	previewCount: number;
	actualCardHeightPx: number;
	heightDeltaPx: number;
	contentClientPx: number;
	contentScrollPx: number;
	contentOverflowPx: number;
	bodyClientPx: number;
	bodyScrollPx: number;
	bodyOverflowPx: number;
	completedSectionHeightPx: number;
	completedPadBottomPx: number;
	completedClippedPx: number;
	completedContentLossPx: number;
	previewsFullyVisible: number;
	previewClippedPx: number;
	severity: NoteCardDiagSeverity;
	// Box-model reconciliation: what the card's height is actually spent on, so a
	// systematic gap between the height formula and the real layout is measured
	// directly instead of inferred by subtracting numbers after the fact.
	cardPadTopPx: number;
	cardBorderYPx: number;
	contentRegionOffsetPx: number;
	childrenSumPx: number;
	unaccountedPx: number;
	dockHeightPx: number;
	dockReservedPx: number;
	dockOverlapPx: number;
};

const registry = new Map<string, { computed: NoteCardDiagComputed; elements: NoteCardDiagElements }>();

export function registerNoteCardDiag(computed: NoteCardDiagComputed, elements: NoteCardDiagElements): void {
	if (!CARD_DIAG_ENABLED) return;
	registry.set(computed.noteId, { computed, elements });
}

export function unregisterNoteCardDiag(noteId: string): void {
	if (!CARD_DIAG_ENABLED) return;
	registry.delete(noteId);
}

const round = (value: number): number => Math.round(value * 10) / 10;

function bottomOf(el: Element | null): number | null {
	if (!el) return null;
	return el.getBoundingClientRect().bottom;
}

/**
 * offsetHeight + vertical margins. Margins are excluded from offsetHeight but
 * absolutely do occupy space in a flex column, so a reconciliation that ignores
 * them reports phantom "unaccounted" pixels (`.header` carries a net +5px margin).
 */
function outerHeightPx(el: HTMLElement | null): number {
	if (!el || typeof window === 'undefined') return el?.offsetHeight ?? 0;
	const style = window.getComputedStyle(el);
	return el.offsetHeight
		+ (Number.parseFloat(style.marginTop || '0') || 0)
		+ (Number.parseFloat(style.marginBottom || '0') || 0);
}

/**
 * Read live geometry for every registered card. The important numbers are the
 * overflow deltas: `scrollHeight - clientHeight` on a region with
 * `overflow:hidden` is, literally, how many pixels are being thrown away.
 */
export function captureNoteCardDiag(): NoteCardDiagRow[] {
	if (!CARD_DIAG_ENABLED) return [];
	const rows: NoteCardDiagRow[] = [];
	for (const { computed, elements } of registry.values()) {
		const { card, contentRegion, body, completedSection, linkPreviewRail, metaChipRow, footer } = elements;
		if (!card) continue;

		const contentRect = contentRegion?.getBoundingClientRect() ?? null;
		const visibleBottom = contentRect ? contentRect.bottom : card.getBoundingClientRect().bottom;

		// How far past the visible boundary does the completed row extend?
		const completedBottom = bottomOf(completedSection);
		const completedClippedPx = completedBottom === null ? 0 : Math.max(0, completedBottom - visibleBottom);

		// Same question for each URL preview row.
		let previewsFullyVisible = 0;
		let previewClippedPx = 0;
		const previewChildren = linkPreviewRail ? Array.from(linkPreviewRail.children) : [];
		// The rail wraps the panel, which holds the actual preview rows; look one
		// level deeper when the rail has a single wrapper child.
		const previewRows = previewChildren.length === 1 && previewChildren[0].children.length > 0
			? Array.from(previewChildren[0].children)
			: previewChildren;
		for (const row of previewRows) {
			const rowBottom = row.getBoundingClientRect().bottom;
			const over = Math.max(0, rowBottom - visibleBottom);
			if (over <= 0.5) previewsFullyVisible += 1;
			previewClippedPx = Math.max(previewClippedPx, over);
		}

		// Desktop hover dock: it's position:absolute at the card's bottom and only
		// revealed on hover, so measure its RESERVED geometry rather than requiring
		// a live hover. The question that matters is whether real content would sit
		// underneath it once revealed.
		const dockHeightPx = footer?.offsetHeight ?? 0;
		const cardStyle = typeof window !== 'undefined' ? window.getComputedStyle(card) : null;
		const dockReservedPx = cardStyle ? Number.parseFloat(cardStyle.paddingBottom || '0') || 0 : 0;
		const dockTop = footer ? footer.getBoundingClientRect().top : null;
		const lastContentBottom = Math.max(
			completedBottom ?? Number.NEGATIVE_INFINITY,
			bottomOf(linkPreviewRail) ?? Number.NEGATIVE_INFINITY,
			bottomOf(body) ?? Number.NEGATIVE_INFINITY
		);
		const dockOverlapPx = dockTop !== null && Number.isFinite(lastContentBottom) && dockHeightPx > 0
			? Math.max(0, lastContentBottom - dockTop)
			: 0;

		const actualCardHeightPx = card.offsetHeight;
		const isChecklist = computed.type === 'checklist';

		// Only the part of the clip that reaches PAST the completed row's own
		// bottom padding actually removes anything you can see.
		const completedStyle = completedSection && typeof window !== 'undefined'
			? window.getComputedStyle(completedSection)
			: null;
		const completedPadBottomPx = completedStyle
			? Number.parseFloat(completedStyle.paddingBottom || '0') || 0
			: 0;
		const completedContentLossPx = Math.max(0, completedClippedPx - completedPadBottomPx);

		// Where does the card's height actually go? Anything left over after the
		// known parts is the systematic gap worth chasing.
		const cardPadTopPx = cardStyle ? Number.parseFloat(cardStyle.paddingTop || '0') || 0 : 0;
		const cardBorderYPx = cardStyle
			? (Number.parseFloat(cardStyle.borderTopWidth || '0') || 0) + (Number.parseFloat(cardStyle.borderBottomWidth || '0') || 0)
			: 0;
		const contentRegionOffsetPx = contentRegion?.offsetHeight ?? 0;
		const childrenSumPx = (body?.offsetHeight ?? 0) + (completedSection?.offsetHeight ?? 0) + (linkPreviewRail?.offsetHeight ?? 0);
		const unaccountedPx = actualCardHeightPx
			- cardPadTopPx
			- dockReservedPx
			- cardBorderYPx
			- outerHeightPx(elements.header)
			- outerHeightPx(metaChipRow)
			- outerHeightPx(contentRegion);

		const previewContentLossPx = previewClippedPx > 2 ? previewClippedPx : 0;
		const contentLossPx = Math.max(completedContentLossPx, previewContentLossPx);
		const anyClipPx = Math.max(completedClippedPx, previewClippedPx);
		const severity: NoteCardDiagSeverity = contentLossPx > 1
			? 'content-loss'
			: anyClipPx > 1
				? 'cosmetic'
				: 'ok';

		rows.push({
			...computed,
			isChecklist,
			chipCount: metaChipRow ? metaChipRow.children.length : 0,
			previewCount: previewRows.length,
			actualCardHeightPx: round(actualCardHeightPx),
			heightDeltaPx: round(actualCardHeightPx - computed.computedCollapsedMinHeightPx),
			contentClientPx: round(contentRegion?.clientHeight ?? 0),
			contentScrollPx: round(contentRegion?.scrollHeight ?? 0),
			contentOverflowPx: round(Math.max(0, (contentRegion?.scrollHeight ?? 0) - (contentRegion?.clientHeight ?? 0))),
			bodyClientPx: round(body?.clientHeight ?? 0),
			bodyScrollPx: round(body?.scrollHeight ?? 0),
			bodyOverflowPx: round(Math.max(0, (body?.scrollHeight ?? 0) - (body?.clientHeight ?? 0))),
			completedSectionHeightPx: round(completedSection?.offsetHeight ?? 0),
			completedPadBottomPx: round(completedPadBottomPx),
			completedClippedPx: round(completedClippedPx),
			completedContentLossPx: round(completedContentLossPx),
			previewsFullyVisible,
			previewClippedPx: round(previewClippedPx),
			severity,
			cardPadTopPx: round(cardPadTopPx),
			cardBorderYPx: round(cardBorderYPx),
			contentRegionOffsetPx: round(contentRegionOffsetPx),
			childrenSumPx: round(childrenSumPx),
			unaccountedPx: round(unaccountedPx),
			dockHeightPx: round(dockHeightPx),
			dockReservedPx: round(dockReservedPx),
			dockOverlapPx: round(dockOverlapPx),
		});
	}
	rows.sort((a, b) => a.title.localeCompare(b.title));
	return rows;
}

/** Compact, paste-friendly text report. */
export function formatNoteCardDiagReport(rows: readonly NoteCardDiagRow[]): string {
	const pointer = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
		? (window.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine')
		: 'unknown';
	const viewport = typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'unknown';
	const scale = rows.length > 0 ? rows[0].fontScale : 1;
	const maxH = rows.length > 0 ? rows[0].maxCardHeightPx : 0;
	const checklists = rows.filter((r) => r.isChecklist);
	const contentLoss = checklists.filter((r) => r.severity === 'content-loss');
	const cosmetic = checklists.filter((r) => r.severity === 'cosmetic');
	const unaccounted = checklists.map((r) => r.unaccountedPx);
	const unaccountedRange = unaccounted.length > 0
		? `${round(Math.min(...unaccounted))}..${round(Math.max(...unaccounted))}`
		: 'n/a';

	const lines: string[] = [];
	lines.push('=== note-card diag ===');
	lines.push(`env: pointer=${pointer} viewport=${viewport} fontScale=${scale} maxCardHeightPx=${maxH}`);
	lines.push(`cards=${rows.length} checklists=${checklists.length}`);
	lines.push(`CONTENT-LOSS=${contentLoss.length}  cosmetic(padding-only)=${cosmetic.length}  unaccountedChrome=${unaccountedRange}px`);
	if (contentLoss.length > 0) {
		lines.push(`worst: ${contentLoss
			.slice()
			.sort((a, b) => Math.max(b.completedContentLossPx, b.previewClippedPx) - Math.max(a.completedContentLossPx, a.previewClippedPx))
			.map((r) => `"${r.title}"(${round(Math.max(r.completedContentLossPx, r.previewClippedPx))}px)`)
			.join(' ')}`);
	}
	lines.push('');

	// Checklist cards first, worst first — the non-checklist cards carry none of
	// the checklist height machinery, so their numbers are only context.
	const ordered = [
		...checklists.slice().sort((a, b) => {
			const rank = (s: NoteCardDiagSeverity): number => (s === 'content-loss' ? 0 : s === 'cosmetic' ? 1 : 2);
			if (rank(a.severity) !== rank(b.severity)) return rank(a.severity) - rank(b.severity);
			return Math.max(b.completedContentLossPx, b.previewClippedPx) - Math.max(a.completedContentLossPx, a.previewClippedPx);
		}),
		...rows.filter((r) => !r.isChecklist),
	];

	for (const r of ordered) {
		if (!r.isChecklist) {
			// No completed row, no line budget — printing those fields here was pure
			// noise in the first version (a drawing card "delta" compared a checklist
			// formula against a card that never uses it).
			lines.push(`"${r.title}" [${r.type}] — non-checklist, context only`);
			lines.push(`  height:  actual=${r.actualCardHeightPx} content client=${r.contentClientPx} scroll=${r.contentScrollPx} OVERFLOW=${r.contentOverflowPx}`);
			lines.push(`  box:     cardPadT=${r.cardPadTopPx} cardPadB=${r.cardPaddingBottomPx} borderY=${r.cardBorderYPx} header=${r.headerHeightPx} meta=${r.metaHeightPx} contentRegion=${r.contentRegionOffsetPx} unaccounted=${r.unaccountedPx}`);
			lines.push('');
			continue;
		}
		const chrome = r.headerHeightPx + r.metaHeightPx + r.linkPreviewHeightPx + r.cardPaddingBottomPx + r.bodyPaddingVerticalPx;
		const tag = r.severity === 'content-loss' ? '  *** CONTENT LOSS ***' : r.severity === 'cosmetic' ? '  (cosmetic)' : '';
		lines.push(`"${r.title}" [${r.type}]${tag}`);
		lines.push(`  variant: banner=${r.hasBanner ? 'yes' : 'no'} chips=${r.chipCount} previews=${r.previewCount} completed=${r.completedExpanded ? 'EXPANDED' : 'collapsed'}(${r.completedTotal})`);
		lines.push(`  inputs:  fontScale=${r.fontScale} maxCardH=${r.maxCardHeightPx} lineH=${r.lineHeightPx} forcedH=${r.forcedHeightPx ?? 'none'}`);
		lines.push(`  chrome:  header=${r.headerHeightPx} meta=${r.metaHeightPx} preview=${r.linkPreviewHeightPx} cardPadB=${r.cardPaddingBottomPx} bodyPadV=${r.bodyPaddingVerticalPx} => ${round(chrome)}`);
		lines.push(`  parts:   completedBase=${r.completedBaseHeightPx} budget=${r.availableLineBudget} usedLines=${r.usedLineCount} items=${r.itemsShown}/${r.itemsTotal}`);
		lines.push(`  height:  computedCollapsed=${r.computedCollapsedMinHeightPx} actual=${r.actualCardHeightPx} delta=${r.heightDeltaPx}`);
		lines.push(`  regions: content client=${r.contentClientPx} scroll=${r.contentScrollPx} OVERFLOW=${r.contentOverflowPx}`);
		lines.push(`           body    client=${r.bodyClientPx} scroll=${r.bodyScrollPx} overflow=${r.bodyOverflowPx}`);
		lines.push(`  clipped: completedSection h=${r.completedSectionHeightPx} padB=${r.completedPadBottomPx} clipped=${r.completedClippedPx} CONTENT-LOSS=${r.completedContentLossPx}`);
		lines.push(`           previews visible=${r.previewsFullyVisible}/${r.previewCount} maxClipped=${r.previewClippedPx}`);
		lines.push(`  box:     cardPadT=${r.cardPadTopPx} borderY=${r.cardBorderYPx} contentRegion=${r.contentRegionOffsetPx} childrenSum=${r.childrenSumPx} unaccounted=${r.unaccountedPx}`);
		lines.push(`  dock:    h=${r.dockHeightPx} reservedPadB=${r.dockReservedPx} contentOverlap=${r.dockOverlapPx}`);
		lines.push('');
	}
	return lines.join('\n');
}
