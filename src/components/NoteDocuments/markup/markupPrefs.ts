import React from 'react';
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
import { SYMBOL_IDS } from './markupSymbols';

/** How many recently used symbols the tool bar keeps within one tap. */
export const MAX_RECENT_SYMBOLS = 8;

// The last tool, colours, widths, text size, cloud shape and stamp, remembered per device. Pen,
// highlighter and text keep separate colours, so switching to the highlighter doesn't turn it red.
// Clouds and move markers draw with the pen's colour and width; callouts use the text settings.

export type CloudShape = 'rect' | 'freeform';

export type MarkupPrefs = {
	tool: MarkupTool;
	penColor: string;
	penWidth: number;
	highlighterColor: string;
	highlighterWidth: number;
	textColor: string;
	textSize: number;
	cloudShape: CloudShape;
	stampPreset: StampPreset;
	symbolId: string;
	/** Most recent first. */
	recentSymbols: string[];
	commentColor: string;
};

const STORAGE_KEY = 'freemannotes.markupPrefs.v1';
const TOOLS: readonly MarkupTool[] = ['select', 'pen', 'highlighter', 'eraser', 'line', 'arrow', 'rect', 'ellipse', 'text', 'cloud', 'callout', 'move', 'stamp', 'symbol', 'comment', 'length', 'path', 'area'];
const CLOUD_SHAPES: readonly CloudShape[] = ['rect', 'freeform'];
const STAMP_PRESETS: readonly StampPreset[] = MARKUP_STAMPS.map((entry) => entry.preset);

const DEFAULT_PREFS: MarkupPrefs = {
	// Select, not a drawing tool: opening markup for the first time (or on a device that
	// hasn't saved a preference yet) should let you look around and pick things, not start
	// inking on your first tap.
	tool: 'select',
	penColor: MARKUP_PEN_COLORS[0],
	penWidth: MARKUP_PEN_WIDTHS[1],
	highlighterColor: MARKUP_HIGHLIGHTER_COLORS[0],
	highlighterWidth: MARKUP_HIGHLIGHTER_WIDTHS[1],
	textColor: MARKUP_PEN_COLORS[0],
	textSize: MARKUP_TEXT_SIZES[1],
	cloudShape: 'rect',
	stampPreset: 'rfi',
	symbolId: 'receptacleDuplex',
	recentSymbols: [],
	// Blue for notes, same as the palette's intent.
	commentColor: MARKUP_PEN_COLORS[1],
};

function readPrefs(): MarkupPrefs {
	try {
		const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null') as Partial<MarkupPrefs> | null;
		if (!parsed || typeof parsed !== 'object') return DEFAULT_PREFS;
		const pick = <T,>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
		return {
			tool: pick(parsed.tool, TOOLS, DEFAULT_PREFS.tool),
			penColor: pick(parsed.penColor, MARKUP_PEN_COLORS, DEFAULT_PREFS.penColor),
			penWidth: pick(parsed.penWidth, MARKUP_PEN_WIDTHS, DEFAULT_PREFS.penWidth),
			highlighterColor: pick(parsed.highlighterColor, MARKUP_HIGHLIGHTER_COLORS, DEFAULT_PREFS.highlighterColor),
			highlighterWidth: pick(parsed.highlighterWidth, MARKUP_HIGHLIGHTER_WIDTHS, DEFAULT_PREFS.highlighterWidth),
			textColor: pick(parsed.textColor, MARKUP_PEN_COLORS, DEFAULT_PREFS.textColor),
			textSize: pick(parsed.textSize, MARKUP_TEXT_SIZES, DEFAULT_PREFS.textSize),
			cloudShape: pick(parsed.cloudShape, CLOUD_SHAPES, DEFAULT_PREFS.cloudShape),
			stampPreset: pick(parsed.stampPreset, STAMP_PRESETS, DEFAULT_PREFS.stampPreset),
			symbolId: pick(parsed.symbolId, SYMBOL_IDS, DEFAULT_PREFS.symbolId),
			recentSymbols: Array.isArray(parsed.recentSymbols)
				? parsed.recentSymbols.filter((id): id is string => SYMBOL_IDS.includes(id as string)).slice(0, MAX_RECENT_SYMBOLS)
				: [],
			commentColor: pick(parsed.commentColor, MARKUP_PEN_COLORS, DEFAULT_PREFS.commentColor),
		};
	} catch {
		return DEFAULT_PREFS;
	}
}

export function useMarkupPrefs(): [MarkupPrefs, (patch: Partial<MarkupPrefs>) => void] {
	const [prefs, setPrefs] = React.useState<MarkupPrefs>(readPrefs);
	const update = React.useCallback((patch: Partial<MarkupPrefs>): void => {
		setPrefs((current) => {
			const next = { ...current, ...patch };
			try {
				window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			} catch {
				// Storage blocked: the choice still holds for this session.
			}
			return next;
		});
	}, []);
	return [prefs, update];
}

export function styleForTool(prefs: MarkupPrefs, tool: MarkupTool | null): { color: string; width: number } {
	return tool === 'highlighter'
		? { color: prefs.highlighterColor, width: prefs.highlighterWidth }
		: { color: prefs.penColor, width: prefs.penWidth };
}
