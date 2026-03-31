import type { CSSProperties } from 'react';
import type { ThemeId } from './theme';
import { NOTE_COLOR_TOKENS, resolveThemeNoteColorModel, type NoteColorToken, type ResolvedNoteColorScheme } from './noteColors';

const WORKSPACE_COLOR_TOKENS: readonly NoteColorToken[] = [
	'blue',
	'coral',
	'green',
	'purple',
	'amber',
	'teal',
	'rose',
	'indigo',
	'mint',
	'orange',
	'cyan',
	'magenta',
	'lime',
	'copper',
	'lavender',
	'slate',
];

function hashCode(str: string): number {
	let hash = 0;
	for (let index = 0; index < str.length; index += 1) {
		hash = (Math.imul(31, hash) + str.charCodeAt(index)) | 0;
	}
	return hash;
}

export function getWorkspaceBubbleColorScheme(themeId: ThemeId, workspaceId: string): ResolvedNoteColorScheme {
	const model = resolveThemeNoteColorModel(themeId);
	const token = WORKSPACE_COLOR_TOKENS[Math.abs(hashCode(workspaceId)) % WORKSPACE_COLOR_TOKENS.length] ?? NOTE_COLOR_TOKENS[0].id;
	return model.tokens[token];
}

export function toWorkspaceBubbleColorStyle(resolved: ResolvedNoteColorScheme): CSSProperties {
	return {
		'--bv-bubble-bg': resolved.cardBackground,
		'--bv-bubble-border': resolved.borderColor,
		'--bv-bubble-text': resolved.textColor,
		'--bv-bubble-muted': resolved.mutedTextColor,
		'--bv-bubble-accent': resolved.accentColor,
	} as CSSProperties;
}