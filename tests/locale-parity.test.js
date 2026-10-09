'use strict';

// Every piece of UI copy has to exist in three places — src/locales/en.json, src/locales/es.json
// and FALLBACK_MESSAGES in src/core/i18n.tsx — and nothing enforced that, so it drifted: four
// keys (invite.joinWorkspaceLabel, share.joinNoteLabel, share.fromLabel, share.sharedAt) existed
// only in English and Spanish users silently got the raw English back.
//
// `t()` falls back English → key name, so a missing translation never crashes. That is exactly
// why this needs a test: the failure is invisible unless you read the app in Spanish.
//
// public/locales/ is NOT checked. It's a legacy URL-served copy that isn't the runtime source
// (see CLAUDE.md), and asserting on it would make this fail for the wrong reason.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const en = JSON.parse(fs.readFileSync(path.join(root, 'src', 'locales', 'en.json'), 'utf8'));
const es = JSON.parse(fs.readFileSync(path.join(root, 'src', 'locales', 'es.json'), 'utf8'));

/** Dotted paths of every leaf string, so nested sections are compared properly. */
function leafKeys(value, prefix = '') {
	return Object.entries(value).flatMap(([key, child]) => (
		child && typeof child === 'object' && !Array.isArray(child)
			? leafKeys(child, `${prefix}${key}.`)
			: [`${prefix}${key}`]
	));
}

describe('locale parity', () => {
	it('en.json and es.json define exactly the same keys', () => {
		const english = new Set(leafKeys(en));
		const spanish = new Set(leafKeys(es));
		const missingFromSpanish = [...english].filter((key) => !spanish.has(key)).sort();
		const missingFromEnglish = [...spanish].filter((key) => !english.has(key)).sort();
		assert.deepEqual(missingFromSpanish, [], 'keys present in en.json but missing from es.json');
		assert.deepEqual(missingFromEnglish, [], 'keys present in es.json but missing from en.json');
	});

	it('no locale string is left empty', () => {
		for (const [name, bundle] of [['en', en], ['es', es]]) {
			for (const key of leafKeys(bundle)) {
				const value = key.split('.').reduce((node, part) => node[part], bundle);
				assert.equal(typeof value, 'string', `${name}.${key} is not a string`);
				assert.notEqual(value.trim(), '', `${name}.${key} is empty`);
			}
		}
	});

	it('placeholders match between the two locales', () => {
		// "{n} min left" translated without its {n} silently drops the number at runtime.
		const placeholders = (text) => (String(text).match(/\{[a-zA-Z]+\}/g) || []).sort();
		const read = (bundle, key) => key.split('.').reduce((node, part) => node[part], bundle);
		for (const key of leafKeys(en)) {
			const expected = placeholders(read(en, key));
			if (expected.length === 0) continue;
			assert.deepEqual(placeholders(read(es, key)), expected, `placeholders differ for ${key}`);
		}
	});

	it('FALLBACK_MESSAGES covers the search keys that have no network to load a bundle from', () => {
		// FALLBACK_MESSAGES is what renders before a locale file has loaded, which on a cold
		// offline start is the only thing there is. Checking the whole bundle would be nice but
		// it is a TS literal, not JSON; the search keys are the ones that matter here because
		// search is reachable in exactly that state.
		const source = fs.readFileSync(path.join(root, 'src', 'core', 'i18n.tsx'), 'utf8');
		for (const key of ['noteSingular', 'notePlural', 'filtersToggle', 'offlineResults', 'offlineResultsHint']) {
			assert.match(source, new RegExp(`\\b${key}:`), `FALLBACK_MESSAGES is missing search.${key}`);
		}
	});
});
