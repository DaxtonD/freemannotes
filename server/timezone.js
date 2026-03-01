'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// FreemanNotes – Timezone Formatting Utility
//
// Provides consistent timezone-aware timestamp formatting for the REST API.
// All internal storage (PostgreSQL timestamptz, Yjs epoch-ms metadata) uses
// UTC. This module converts timestamps to the configured PGTIMEZONE for
// human-readable API responses.
//
// Design decisions:
//   - Uses the built-in Intl.DateTimeFormat API (no external dependencies).
//   - Falls back to UTC ISO-8601 strings when no timezone is configured.
//   - Handles both Date objects (from Prisma) and epoch-ms numbers (from Yjs
//     metadata). Both are treated identically — convert to Date, then format.
//   - The formatted string includes full date, time, and timezone abbreviation
//     so API consumers can display timestamps without additional processing.
//
// Usage:
//   const { formatTimestamp, createTimestampFormatter } = require('./timezone');
//   const fmt = createTimestampFormatter('America/Regina');
//   fmt(new Date());          // → "2026-02-28T12:34:56.789-06:00"
//   fmt(1740000000000);       // → "2026-02-19T16:00:00.000-06:00"
//   fmt(null);                // → null
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a timestamp (Date or epoch-ms number) as an ISO-8601 string
 * in the given IANA timezone. If timezone is null/empty, returns standard
 * UTC ISO string.
 *
 * @param {Date | number | null | undefined} value — The timestamp to format.
 * @param {string | null} [timezone] — IANA timezone name (e.g. "America/Regina").
 * @returns {string | null} ISO-8601 formatted string, or null if input is null/undefined.
 */
function formatTimestamp(value, timezone) {
	if (value === null || value === undefined) return null;

	// Normalize input to a Date object.
	const date = typeof value === 'number' ? new Date(value) : value;
	if (!(date instanceof Date) || isNaN(date.getTime())) return null;

	// No timezone configured — return standard UTC ISO string.
	if (!timezone || timezone.trim().length === 0) {
		return date.toISOString();
	}

	try {
		// ── Build an ISO-8601 string with the target timezone offset ─────
		// Intl.DateTimeFormat gives us the individual date/time parts in the
		// target timezone. We reassemble them into ISO-8601 format.
		const formatter = new Intl.DateTimeFormat('en-CA', {
			timeZone: timezone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false,
			fractionalSecondDigits: 3,
		});

		const parts = {};
		for (const { type, value: v } of formatter.formatToParts(date)) {
			parts[type] = v;
		}

		// Calculate the UTC offset for this timezone at this specific instant.
		// We do this by comparing the formatted local time against the UTC time.
		const localStr = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
		const localMs = new Date(localStr + 'Z').getTime();
		const offsetMs = localMs - date.getTime();
		const offsetMinutes = Math.round(offsetMs / 60000);
		const offsetSign = offsetMinutes >= 0 ? '+' : '-';
		const absOffset = Math.abs(offsetMinutes);
		const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
		const offsetMins = String(absOffset % 60).padStart(2, '0');
		const offsetStr = `${offsetSign}${offsetHours}:${offsetMins}`;

		// Fractional seconds — Intl may return them as a separate part.
		const frac = parts.fractionalSecond
			? `.${parts.fractionalSecond}`
			: `.${String(date.getMilliseconds()).padStart(3, '0')}`;

		return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${frac}${offsetStr}`;
	} catch (err) {
		// Invalid timezone name — fall back to UTC.
		console.warn(`[timezone] Invalid timezone "${timezone}": ${err.message}. Falling back to UTC.`);
		return date.toISOString();
	}
}

/**
 * Creates a bound formatting function for a specific timezone.
 * Convenient when the same timezone is used for many timestamps.
 *
 * @param {string | null} timezone — IANA timezone name (e.g. "America/Regina").
 * @returns {(value: Date | number | null | undefined) => string | null}
 */
function createTimestampFormatter(timezone) {
	return (value) => formatTimestamp(value, timezone);
}

module.exports = { formatTimestamp, createTimestampFormatter };
