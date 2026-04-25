// Shared helpers for the optional numeric checklist prefix used by rows such as
// "1 - Buy milk". These helpers keep editors, cards, and sharing views aligned
// on the same normalization and display rules.
type ChecklistCountLike = {
	countValue?: unknown;
};

type ChecklistCountTextLike = ChecklistCountLike & {
	text?: unknown;
};

export function normalizeChecklistCountValue(value: unknown): number | null {
	// Count rows are positive integers only. Empty, invalid, or zero-ish values
	// are treated as "not a count item" everywhere in the app.
	if (value == null) return null;
	if (typeof value === 'string' && value.trim().length === 0) return null;
	const numericValue = Number(value);
	if (!Number.isFinite(numericValue)) return null;
	const integerValue = Math.trunc(numericValue);
	return integerValue >= 1 ? integerValue : null;
}

export function getChecklistCountValue(item: ChecklistCountLike | null | undefined): number | null {
	return normalizeChecklistCountValue(item?.countValue);
}

export function isChecklistCountItem(item: ChecklistCountLike | null | undefined): boolean {
	return getChecklistCountValue(item) !== null;
}

export function getChecklistCountPrefix(item: ChecklistCountLike | null | undefined): string {
	const countValue = getChecklistCountValue(item);
	return countValue === null ? '' : `${countValue} - `;
}

export function getChecklistTextWithCountPrefix(item: ChecklistCountTextLike | null | undefined): string {
	const text = typeof item?.text === 'string' ? item.text : '';
	return `${getChecklistCountPrefix(item)}${text}`;
}