'use strict';

// Office files → PDF through a Gotenberg container (https://gotenberg.dev). Optional, set up
// the same way as Redis: point GOTENBERG_URL at it, or leave it unset and everything still
// works, with office files opening as text. Only Gotenberg's LibreOffice route is ever used.

const CONVERTIBLE_DOCUMENT_EXTENSIONS = new Set(['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp']);

const DEFAULT_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 5_000;

function isConvertibleDocumentExtension(extension) {
	return CONVERTIBLE_DOCUMENT_EXTENSIONS.has(String(extension || '').toLowerCase());
}

/**
 * kind tells the queue what to do next:
 * - 'unavailable': can't reach Gotenberg or it's set up wrong. Not this file's fault; wait and retry.
 * - 'rejected':    Gotenberg looked at this file and said no (400). It will never convert.
 * - 'failed':      a 500, a timeout, or output that isn't a PDF. Could be the file, could be a hiccup.
 */
class DocumentConversionError extends Error {
	constructor(message, kind, status = 0) {
		super(message);
		this.name = 'DocumentConversionError';
		this.kind = kind;
		this.status = status;
	}
}

function parseBaseUrl(raw) {
	const value = String(raw || '').trim();
	if (!value) return null;
	try {
		const parsed = new URL(value);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
		const username = decodeURIComponent(parsed.username || '');
		const password = decodeURIComponent(parsed.password || '');
		// Credentials in the URL work, but never end up in a log line.
		parsed.username = '';
		parsed.password = '';
		return { url: parsed.toString().replace(/\/+$/, ''), username, password };
	} catch {
		return null;
	}
}

function createDisabledConverter() {
	return {
		enabled: false,
		url: null,
		checkHealth: async () => ({ ok: false, error: 'not configured' }),
		convertToPdf: async () => {
			throw new DocumentConversionError('Document conversion is not configured', 'unavailable');
		},
	};
}

function createGotenbergConverter({ url, username = '', password = '', timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
	const base = parseBaseUrl(url);
	if (!base) return createDisabledConverter();
	const user = String(username || '') || base.username;
	const pass = String(password || '') || base.password;
	const authHeaders = user ? { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` } : {};

	async function request(pathname, init, limitMs) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), limitMs);
		try {
			return await fetchImpl(`${base.url}${pathname}`, {
				...init,
				headers: { ...authHeaders, ...((init && init.headers) || {}) },
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timer);
		}
	}

	async function checkHealth() {
		try {
			const response = await request('/health', { method: 'GET' }, HEALTH_TIMEOUT_MS);
			if (response.status === 401 || response.status === 403) return { ok: false, error: 'Gotenberg refused the username/password' };
			if (!response.ok) return { ok: false, error: `health check answered ${response.status}` };
			const body = await response.json().catch(() => null);
			const libreoffice = body && body.details && body.details.libreoffice;
			if (libreoffice && libreoffice.status && libreoffice.status !== 'up') {
				return { ok: false, error: `LibreOffice inside Gotenberg is ${libreoffice.status}` };
			}
			let version = '';
			try {
				const versionResponse = await request('/version', { method: 'GET' }, HEALTH_TIMEOUT_MS);
				if (versionResponse.ok) version = (await versionResponse.text()).trim().slice(0, 40);
			} catch {
				// Older builds without /version still convert fine.
			}
			return { ok: true, version };
		} catch (error) {
			if (error && error.name === 'AbortError') return { ok: false, error: 'timed out' };
			return { ok: false, error: (error && error.cause && error.cause.code) || (error && error.message) || 'unreachable' };
		}
	}

	async function convertToPdf({ buffer, fileName }) {
		const form = new FormData();
		// Gotenberg picks the importer from the file name's extension, so it has to be the real one.
		form.append('files', new Blob([buffer]), fileName);
		let response;
		try {
			response = await request('/forms/libreoffice/convert', { method: 'POST', body: form }, timeoutMs);
		} catch (error) {
			if (error && error.name === 'AbortError') {
				throw new DocumentConversionError(`Conversion took longer than ${Math.round(timeoutMs / 1000)} s`, 'failed');
			}
			const reason = (error && error.cause && error.cause.code) || (error && error.message) || 'network error';
			throw new DocumentConversionError(`Gotenberg unreachable: ${reason}`, 'unavailable');
		}
		if (response.ok) {
			const pdf = Buffer.from(await response.arrayBuffer());
			// Storing something that isn't a PDF would show "couldn't be opened" on every device.
			if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
				throw new DocumentConversionError('Gotenberg answered with something that is not a PDF', 'failed', response.status);
			}
			return pdf;
		}
		const detail = (await response.text().catch(() => '')).trim().slice(0, 300);
		const message = `Gotenberg ${response.status}${detail ? `: ${detail}` : ''}`;
		if (response.status === 400) throw new DocumentConversionError(message, 'rejected', response.status);
		// Wrong credentials, wrong address, or LibreOffice routes switched off: setup, not this file.
		if (response.status === 401 || response.status === 403 || response.status === 404) {
			throw new DocumentConversionError(message, 'unavailable', response.status);
		}
		throw new DocumentConversionError(message, 'failed', response.status);
	}

	return { enabled: true, url: base.url, checkHealth, convertToPdf };
}

/**
 * What Preferences → Storage shows. Deliberately no address and no raw error text: any signed-in
 * user can see this, and "your converter lives at 192.168.x.x" isn't theirs to know.
 */
function describeConverterHealth(enabled, health, checkedAt = new Date()) {
	const base = { configured: Boolean(enabled), checkedAt: checkedAt.toISOString() };
	if (!enabled) return { ...base, state: 'off', version: null };
	if (health && health.ok) return { ...base, state: 'connected', version: health.version || null };
	const error = String((health && health.error) || '');
	let state = 'unreachable';
	if (/username|password/i.test(error)) state = 'auth';
	else if (/libreoffice/i.test(error)) state = 'libreoffice-down';
	return { ...base, state, version: null };
}

module.exports = {
	CONVERTIBLE_DOCUMENT_EXTENSIONS,
	DocumentConversionError,
	createGotenbergConverter,
	describeConverterHealth,
	isConvertibleDocumentExtension,
};
