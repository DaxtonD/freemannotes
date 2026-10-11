/**
 * Inserting a date into a note, for journaling. Deliberately small: the toolbar's calendar
 * button drops today's date at the cursor, and its caret opens the browser's own date picker
 * for any other day.
 */

/**
 * "Friday, October 10, 2026" in the viewer's locale.
 *
 * Spelled out as explicit parts rather than `dateStyle: 'full'` because 'full' is free to
 * include things nobody wants pasted into a note (eras, in some locales) and the whole point
 * of this string is that it reads like a journal heading.
 */
export function formatInsertableDate(value: Date): string {
	if (!Number.isFinite(value.getTime())) return '';
	return value.toLocaleDateString(undefined, {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
}

/** A Date → the `YYYY-MM-DD` an `<input type="date">` wants, in LOCAL time. */
export function toDateInputValue(value: Date): string {
	if (!Number.isFinite(value.getTime())) return '';
	const month = String(value.getMonth() + 1).padStart(2, '0');
	const day = String(value.getDate()).padStart(2, '0');
	return `${value.getFullYear()}-${month}-${day}`;
}

/**
 * `YYYY-MM-DD` from an `<input type="date">` → a local-midnight Date.
 *
 * Built from the parts on purpose. `new Date('2026-10-10')` is parsed as UTC midnight, which
 * anywhere west of Greenwich formats back as the 9th — pick "Oct 10" in Saskatchewan and the
 * note would cheerfully say Friday, October 9.
 */
export function parseDateInputValue(value: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const parsed = new Date(year, month - 1, day);
	// Rejects the likes of 2026-02-31, which Date would roll forward into March.
	if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
		return null;
	}
	return parsed;
}
