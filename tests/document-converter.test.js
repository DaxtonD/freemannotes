const test = require('node:test');
const assert = require('node:assert/strict');
const { createGotenbergConverter, describeConverterHealth, isConvertibleDocumentExtension } = require('../server/documentConverter');

test('health summary for Preferences: states, and never the address or raw error', () => {
	const at = new Date('2026-09-14T12:00:00.000Z');
	assert.deepEqual(describeConverterHealth(false, null, at), { configured: false, checkedAt: at.toISOString(), state: 'off', version: null });
	assert.deepEqual(describeConverterHealth(true, { ok: true, version: '8.37.0' }, at), { configured: true, checkedAt: at.toISOString(), state: 'connected', version: '8.37.0' });
	assert.equal(describeConverterHealth(true, { ok: false, error: 'ECONNREFUSED' }, at).state, 'unreachable');
	assert.equal(describeConverterHealth(true, { ok: false, error: 'timed out' }, at).state, 'unreachable');
	assert.equal(describeConverterHealth(true, { ok: false, error: 'Gotenberg refused the username/password' }, at).state, 'auth');
	assert.equal(describeConverterHealth(true, { ok: false, error: 'LibreOffice inside Gotenberg is down' }, at).state, 'libreoffice-down');
	const summary = describeConverterHealth(true, { ok: false, error: 'connect ECONNREFUSED 10.20.30.40:3000' }, at);
	assert.equal(JSON.stringify(summary).includes('10.20.30.40'), false);
});

const PDF = Buffer.from('%PDF-1.7\nfake pdf body');

function fakeFetch(handler) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url, init });
		return handler(url, init);
	};
	return { calls, fetchImpl };
}

function respond(status, body, headers = {}) {
	return new Response(body, { status, headers });
}

test('no URL, or a non-http one, means conversion is off', async () => {
	for (const url of [undefined, '', '   ', 'ftp://gotenberg:3000', 'not a url']) {
		const converter = createGotenbergConverter({ url });
		assert.equal(converter.enabled, false, String(url));
		await assert.rejects(converter.convertToPdf({ buffer: Buffer.from('x'), fileName: 'a.docx' }), (error) => error.kind === 'unavailable');
	}
});

test('only office formats are convertible', () => {
	for (const extension of ['docx', 'DOC', 'xlsx', 'ods', 'pptx', 'rtf', 'odt']) assert.equal(isConvertibleDocumentExtension(extension), true, extension);
	for (const extension of ['pdf', 'txt', 'md', 'csv', '', null]) assert.equal(isConvertibleDocumentExtension(extension), false, String(extension));
});

test('posts the file to the LibreOffice route under its real name and returns the PDF', async () => {
	const { calls, fetchImpl } = fakeFetch(() => respond(200, PDF, { 'content-type': 'application/pdf' }));
	const converter = createGotenbergConverter({ url: 'http://gotenberg:3000/', fetchImpl });
	const pdf = await converter.convertToPdf({ buffer: Buffer.from('word bytes'), fileName: 'Quarterly report.docx' });
	assert.deepEqual(pdf, PDF);
	assert.equal(calls[0].url, 'http://gotenberg:3000/forms/libreoffice/convert');
	assert.equal(calls[0].init.method, 'POST');
	const file = calls[0].init.body.get('files');
	assert.equal(file.name, 'Quarterly report.docx');
	assert.equal(calls[0].init.headers.authorization, undefined);
});

test('credentials in the URL become a Basic auth header and never stay in the URL', async () => {
	const { calls, fetchImpl } = fakeFetch(() => respond(200, PDF));
	const converter = createGotenbergConverter({ url: 'http://fn:s3cret@gotenberg:3000', fetchImpl });
	assert.equal(converter.url, 'http://gotenberg:3000');
	await converter.convertToPdf({ buffer: Buffer.from('x'), fileName: 'a.docx' });
	assert.equal(calls[0].url, 'http://gotenberg:3000/forms/libreoffice/convert');
	assert.equal(calls[0].init.headers.authorization, `Basic ${Buffer.from('fn:s3cret').toString('base64')}`);
});

test('explicit username and password win over the URL', async () => {
	const { calls, fetchImpl } = fakeFetch(() => respond(200, PDF));
	const converter = createGotenbergConverter({ url: 'http://old:creds@gotenberg:3000', username: 'fn', password: 'pw', fetchImpl });
	await converter.convertToPdf({ buffer: Buffer.from('x'), fileName: 'a.docx' });
	assert.equal(calls[0].init.headers.authorization, `Basic ${Buffer.from('fn:pw').toString('base64')}`);
});

test('error responses are sorted into rejected, unavailable and failed', async () => {
	const cases = [
		[400, 'rejected'],
		[401, 'unavailable'],
		[403, 'unavailable'],
		[404, 'unavailable'],
		[500, 'failed'],
		[503, 'failed'],
	];
	for (const [status, kind] of cases) {
		const { fetchImpl } = fakeFetch(() => respond(status, 'nope'));
		const converter = createGotenbergConverter({ url: 'http://gotenberg:3000', fetchImpl });
		await assert.rejects(
			converter.convertToPdf({ buffer: Buffer.from('x'), fileName: 'a.docx' }),
			(error) => error.kind === kind && error.status === status,
			`status ${status}`
		);
	}
});

test('a network failure is an outage, not a bad file', async () => {
	const converter = createGotenbergConverter({
		url: 'http://gotenberg:3000',
		fetchImpl: async () => {
			throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
		},
	});
	await assert.rejects(converter.convertToPdf({ buffer: Buffer.from('x'), fileName: 'a.docx' }), (error) => error.kind === 'unavailable' && /ECONNREFUSED/.test(error.message));
});

test('a 200 that is not a PDF is refused', async () => {
	const { fetchImpl } = fakeFetch(() => respond(200, '<html>proxy login page</html>'));
	const converter = createGotenbergConverter({ url: 'http://gotenberg:3000', fetchImpl });
	await assert.rejects(converter.convertToPdf({ buffer: Buffer.from('x'), fileName: 'a.docx' }), (error) => error.kind === 'failed');
});

test('a conversion that runs past the time limit fails as a timeout', async () => {
	const converter = createGotenbergConverter({
		url: 'http://gotenberg:3000',
		timeoutMs: 20,
		fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
			init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
		}),
	});
	await assert.rejects(converter.convertToPdf({ buffer: Buffer.from('x'), fileName: 'a.docx' }), (error) => error.kind === 'failed' && /longer than/.test(error.message));
});

test('health check reports the version, and LibreOffice being down', async () => {
	const healthy = fakeFetch((url) => (url.endsWith('/health')
		? respond(200, JSON.stringify({ status: 'up', details: { libreoffice: { status: 'up' } } }))
		: respond(200, '8.37.0\n')));
	assert.deepEqual(await createGotenbergConverter({ url: 'http://gotenberg:3000', fetchImpl: healthy.fetchImpl }).checkHealth(), { ok: true, version: '8.37.0' });

	const degraded = fakeFetch(() => respond(503, JSON.stringify({ status: 'down', details: { libreoffice: { status: 'down' } } })));
	const result = await createGotenbergConverter({ url: 'http://gotenberg:3000', fetchImpl: degraded.fetchImpl }).checkHealth();
	assert.equal(result.ok, false);

	const libreofficeDown = fakeFetch(() => respond(200, JSON.stringify({ status: 'up', details: { libreoffice: { status: 'down' } } })));
	const second = await createGotenbergConverter({ url: 'http://gotenberg:3000', fetchImpl: libreofficeDown.fetchImpl }).checkHealth();
	assert.equal(second.ok, false);
	assert.match(second.error, /LibreOffice/);
});
