'use strict';

// Server-side link preview resolver. The goal is not perfect "reader mode" output;
// it is resilient enough metadata and imagery to make note-card link chips useful.

const { extract } = require('@extractus/article-extractor');

const SECOND_LEVEL_SUFFIXES = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);
const HTML_ENTITY_MAP = {
	amp: '&',
	apos: "'",
	gt: '>',
	lt: '<',
	nbsp: ' ',
	quot: '"',
};

function decodeHtmlEntities(value) {
	return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity) => {
		const normalized = String(entity || '').toLowerCase();
		if (normalized.startsWith('#x')) {
			const codePoint = Number.parseInt(normalized.slice(2), 16);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
		}
		if (normalized.startsWith('#')) {
			const codePoint = Number.parseInt(normalized.slice(1), 10);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
		}
		return Object.prototype.hasOwnProperty.call(HTML_ENTITY_MAP, normalized) ? HTML_ENTITY_MAP[normalized] : _match;
	});
}

function stripTags(value) {
	return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function normalizeUrl(rawUrl) {
	const input = String(rawUrl || '').trim();
	if (!input) return null;
	if (/^(javascript|data|mailto|tel):/i.test(input)) return null;
	const candidate = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
	try {
		const url = new URL(candidate);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		url.hash = '';
		if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
			url.port = '';
		}
		return url;
	} catch {
		return null;
	}
}

function deriveRootDomain(hostname) {
	const normalized = String(hostname || '').trim().toLowerCase();
	if (!normalized) return '';
	const parts = normalized.split('.').filter(Boolean);
	if (parts.length <= 2) return normalized;
	const last = parts[parts.length - 1];
	const secondLast = parts[parts.length - 2];
	const thirdLast = parts[parts.length - 3];
	if (last.length === 2 && SECOND_LEVEL_SUFFIXES.has(secondLast) && thirdLast) {
		return `${thirdLast}.${secondLast}.${last}`;
	}
	return `${secondLast}.${last}`;
}

function buildLinkSeed(rawUrl, sortOrder = 0) {
	const normalized = normalizeUrl(rawUrl);
	if (!normalized) return null;
	return {
		normalizedUrl: normalized.toString(),
		originalUrl: String(rawUrl || '').trim() || normalized.toString(),
		hostname: normalized.hostname.toLowerCase(),
		rootDomain: deriveRootDomain(normalized.hostname),
		sortOrder: Number.isFinite(sortOrder) ? Math.max(0, Math.trunc(sortOrder)) : 0,
	};
}

function readTagAttributes(tagSource, tagName) {
	const attributes = new Map();
	const inner = String(tagSource || '')
		.replace(new RegExp(`^<${tagName}\\b`, 'i'), '')
		.replace(/\/?\s*>$/, '');
	const attrRegex = /([^\s"'=<>`\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
	let match = attrRegex.exec(inner);
	while (match) {
		const key = String(match[1] || '').trim().toLowerCase();
		if (!key) {
			match = attrRegex.exec(inner);
			continue;
		}
		const rawValue = match[2] ?? match[3] ?? match[4] ?? '';
		if (!attributes.has(key)) {
			attributes.set(key, decodeHtmlEntities(String(rawValue || '').trim()));
		}
		match = attrRegex.exec(inner);
	}
	return attributes;
}

function readMetaTags(html) {
	const metaEntries = [];
	const metaRegex = /<meta\b[^>]*>/gi;
	let match = metaRegex.exec(html);
	while (match) {
		const attrs = readTagAttributes(match[0], 'meta');
		const key = attrs.get('property') || attrs.get('name') || attrs.get('itemprop') || '';
		const value = attrs.get('content') || attrs.get('value') || '';
		if (key && value) {
			metaEntries.push({
				key: String(key).trim(),
				value: String(value).trim(),
			});
		}
		match = metaRegex.exec(html);
	}
	return metaEntries;
}

function readTitle(html) {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return match ? stripTags(match[1]) : '';
}

function absolutizeUrl(rawUrl, baseUrl) {
	const value = String(rawUrl || '').trim();
	if (!value) return null;
	try {
		return new URL(value, baseUrl).toString();
	} catch {
		return null;
	}
}

function pickLargestSrcsetCandidate(value) {
	const candidates = String(value || '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const parts = entry.split(/\s+/).filter(Boolean);
			const url = parts[0] || '';
			const descriptor = parts[1] || '';
			const widthMatch = descriptor.match(/^(\d+)w$/i);
			const densityMatch = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
			const score = widthMatch
				? Number.parseInt(widthMatch[1], 10)
				: densityMatch
					? Math.round(Number.parseFloat(densityMatch[1]) * 1000)
					: 0;
			return { url, score };
		})
		.filter((entry) => entry.url);
	if (candidates.length === 0) return null;
	candidates.sort((left, right) => right.score - left.score);
	return candidates[0].url;
}

function isLikelyBadPreviewImageUrl(url) {
	const value = String(url || '').trim().toLowerCase();
	if (!value) return true;
	if (value.includes('fls-na.amazon.') || value.includes('uedata=')) return true;
	if (value.includes('sprite') || value.includes('sash/') || value.endsWith('.svg')) return true;
	if (value.includes('transparent') || value.includes('pixel')) return true;
	if (value.includes('avatar') || value.includes('profile') || value.includes('favicon')) return true;
	if (value.includes('icon') || value.includes('logo')) return true;
	return false;
}

function scoreImageUrl(url) {
	const value = String(url || '').trim().toLowerCase();
	if (!value || isLikelyBadPreviewImageUrl(value)) return -1000;
	let score = 0;
	if (value.includes('m.media-amazon.com/images/i/')) score += 120;
	if (value.match(/\.(jpg|jpeg|png|webp)(\?|$)/)) score += 40;
	if (value.includes('hero') || value.includes('cover') || value.includes('poster')) score += 35;
	if (value.includes('media') || value.includes('image') || value.includes('images')) score += 18;
	if (value.includes('_sx342_') || value.includes('_sy445_') || value.includes('_sl')) score += 30;
	if (value.includes('_sx38_') || value.includes('_sy50_')) score -= 40;
	if (value.includes('logo') || value.includes('icon')) score -= 25;
	if (value.includes('avatar') || value.includes('profile')) score -= 35;
	return score;
}

function pickBestImageUrl(urls) {
	const ranked = Array.isArray(urls)
		? urls
			.filter((value) => typeof value === 'string')
			.map((value) => ({ value, score: scoreImageUrl(value) }))
			.filter((entry) => entry.score > -100)
			.sort((left, right) => right.score - left.score)
		: [];
	return ranked[0] ? ranked[0].value : null;
}

function readLinkHrefs(html, relName) {
	const results = [];
	const linkRegex = /<link\b[^>]*>/gi;
	let match = linkRegex.exec(html);
	while (match) {
		const attrs = readTagAttributes(match[0], 'link');
		const rel = String(attrs.get('rel') || '').toLowerCase();
		const href = attrs.get('href') || '';
		if (href && rel.split(/\s+/).includes(relName)) {
			results.push(href);
		}
		match = linkRegex.exec(html);
	}
	return results;
}

function flattenJsonLdNodes(value, results) {
	if (!value) return;
	if (Array.isArray(value)) {
		for (const entry of value) {
			flattenJsonLdNodes(entry, results);
		}
		return;
	}
	if (typeof value !== 'object') return;
	results.push(value);
	if (Array.isArray(value['@graph'])) {
		for (const entry of value['@graph']) {
			flattenJsonLdNodes(entry, results);
		}
	}
}

function readJsonLdNodes(html) {
	const nodes = [];
	const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
	let match = scriptRegex.exec(html);
	while (match) {
		const attrs = readTagAttributes(`<script${match[1]}>`, 'script');
		const type = String(attrs.get('type') || '').toLowerCase();
		if (!type.includes('ld+json')) {
			match = scriptRegex.exec(html);
			continue;
		}
		const raw = String(match[2] || '').trim();
		if (!raw) {
			match = scriptRegex.exec(html);
			continue;
		}
		try {
			flattenJsonLdNodes(JSON.parse(raw), nodes);
		} catch {
			// Ignore malformed JSON-LD blocks.
		}
		match = scriptRegex.exec(html);
	}
	return nodes;
}

function firstNonEmptyString(values) {
	for (const value of values) {
		const normalized = String(value || '').replace(/\s+/g, ' ').trim();
		if (normalized) return normalized;
	}
	return '';
}

function readJsonLdValue(source, path) {
	const segments = String(path || '').split('.').filter(Boolean);
	let current = source;
	for (const segment of segments) {
		if (!current || typeof current !== 'object') return '';
		current = current[segment];
	}
	if (typeof current === 'string' || typeof current === 'number') {
		return String(current);
	}
	if (current && typeof current === 'object') {
		return firstNonEmptyString([current.name, current.headline, current.text, current.url]);
	}
	return '';
}

function pickJsonLdText(nodes, paths) {
	for (const node of nodes) {
		for (const path of paths) {
			const value = readJsonLdValue(node, path);
			if (value) return value;
		}
	}
	return '';
}

function pushJsonLdImageUrls(results, value, baseUrl) {
	if (!value) return;
	if (typeof value === 'string') {
		const normalized = absolutizeUrl(value, baseUrl);
		if (normalized && !results.includes(normalized)) results.push(normalized);
		return;
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			pushJsonLdImageUrls(results, entry, baseUrl);
		}
		return;
	}
	if (typeof value === 'object') {
		pushJsonLdImageUrls(results, value.url || value.contentUrl || value.thumbnailUrl, baseUrl);
	}
}

function collectJsonLdImageUrls(nodes, baseUrl) {
	const results = [];
	for (const node of nodes) {
		pushJsonLdImageUrls(results, node.image, baseUrl);
		pushJsonLdImageUrls(results, node.thumbnailUrl, baseUrl);
		pushJsonLdImageUrls(results, node.primaryImageOfPage, baseUrl);
		pushJsonLdImageUrls(results, node.associatedMedia, baseUrl);
		pushJsonLdImageUrls(results, node.logo, baseUrl);
	}
	return results;
}

function collectImageUrls(html, baseUrl, metaMap, jsonLdNodes) {
	const results = [];
	// Collect from high-signal metadata first, then fall back to progressively noisier
	// HTML sources so we get the hero image when possible without trusting every <img>.
	const pushIfPresent = (value) => {
		const normalized = absolutizeUrl(value, baseUrl);
		if (normalized && !results.includes(normalized)) results.push(normalized);
	};
	pushIfPresent(metaMap.get('og:image'));
	pushIfPresent(metaMap.get('og:image:url'));
	pushIfPresent(metaMap.get('og:image:secure_url'));
	pushIfPresent(metaMap.get('twitter:image'));
	pushIfPresent(metaMap.get('twitter:image:src'));
	pushIfPresent(metaMap.get('twitter:image0'));
	pushIfPresent(metaMap.get('image'));
	for (const href of readLinkHrefs(html, 'image_src')) {
		pushIfPresent(href);
	}
	for (const href of collectJsonLdImageUrls(jsonLdNodes, baseUrl)) {
		pushIfPresent(href);
	}
	const imgRegex = /<img\b[^>]*>/gi;
	let match = imgRegex.exec(html);
	while (match && results.length < 18) {
		const attrs = readTagAttributes(match[0], 'img');
		pushIfPresent(attrs.get('data-hero'));
		pushIfPresent(attrs.get('data-src'));
		pushIfPresent(attrs.get('data-lazy-src'));
		pushIfPresent(attrs.get('data-original'));
		pushIfPresent(attrs.get('src'));
		pushIfPresent(pickLargestSrcsetCandidate(attrs.get('srcset')));
		pushIfPresent(pickLargestSrcsetCandidate(attrs.get('data-srcset')));
		match = imgRegex.exec(html);
	}
	return results;
}

function readPrimaryContentHtml(html) {
	const candidates = [];
	for (const tagName of ['main', 'article']) {
		const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
		let match = regex.exec(html);
		while (match) {
			const content = String(match[1] || '');
			const text = stripTags(content);
			if (text.length > 80) {
				candidates.push({ content, score: text.length });
			}
			match = regex.exec(html);
		}
	}
	candidates.sort((left, right) => right.score - left.score);
	return candidates[0] ? candidates[0].content : '';
}

function extractBodyText(html) {
	const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
	const source = readPrimaryContentHtml(html) || (bodyMatch ? bodyMatch[1] : html);
	return stripTags(
		source
			.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
			.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
			.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
			.replace(/<(header|footer|nav|aside|form|button|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
	);
}

function snippet(value, maxLength) {
	const normalized = String(value || '').replace(/\s+/g, ' ').trim();
	if (!normalized) return '';
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function normalizeSnippetText(value, maxLength) {
	return snippet(stripTags(value), maxLength);
}

function shouldUseExtractorFallback(result) {
	if (!result) return true;
	if (!result.title) return true;
	if (!result.description) return true;
	if (!result.imageUrl || isLikelyBadPreviewImageUrl(result.imageUrl)) return true;
	if (!result.mainContent || result.mainContent.length < 160) return true;
	return false;
}

async function resolveWithArticleExtractor(url) {
	try {
		const result = await extract(url, {
			descriptionLengthThreshold: 120,
			descriptionTruncateLen: 320,
			contentLengthThreshold: 120,
		});
		if (!result) return null;
		return {
			title: normalizeSnippetText(result.title, 220) || null,
			description: normalizeSnippetText(result.description, 420) || null,
			mainContent: normalizeSnippetText(result.content || result.description, 900) || null,
			imageUrl: absolutizeUrl(result.image, url),
			siteName: normalizeSnippetText(result.source, 120) || null,
		};
	} catch {
		return null;
	}
}

async function resolveNoteLinkPreview(rawUrl, { timeoutMs = 8000 } = {}) {
	const normalized = normalizeUrl(rawUrl);
	if (!normalized) {
		throw new Error('Invalid URL');
	}
	const controller = typeof AbortController === 'function' ? new AbortController() : null;
	const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
	try {
		const response = await fetch(normalized.toString(), {
			redirect: 'follow',
			headers: {
				accept: 'text/html,application/xhtml+xml',
				'accept-language': 'en-US,en;q=0.9',
				'user-agent': 'FreemanNotes Link Preview Bot/1.0',
			},
			signal: controller ? controller.signal : undefined,
		});
		if (!response.ok) {
			throw new Error(`Link request failed (${response.status})`);
		}
		const contentType = String(response.headers.get('content-type') || '').toLowerCase();
		if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
			throw new Error('URL did not return HTML content');
		}
		const html = await response.text();
		const metaEntries = readMetaTags(html);
		const metaMap = new Map(metaEntries.map((entry) => [entry.key.toLowerCase(), entry.value]));
		const finalUrl = normalizeUrl(response.url || normalized.toString()) || normalized;
		const jsonLdNodes = readJsonLdNodes(html);
		const pageTitle = firstNonEmptyString([
			metaMap.get('og:title'),
			metaMap.get('twitter:title'),
			metaMap.get('title'),
			pickJsonLdText(jsonLdNodes, ['headline', 'name', 'alternativeHeadline']),
			readTitle(html),
		]);
		const description = firstNonEmptyString([
			metaMap.get('og:description'),
			metaMap.get('description'),
			metaMap.get('twitter:description'),
			pickJsonLdText(jsonLdNodes, ['description', 'abstract']),
		]);
		const siteName = firstNonEmptyString([
			metaMap.get('og:site_name'),
			metaMap.get('application-name'),
			metaMap.get('twitter:site'),
			pickJsonLdText(jsonLdNodes, ['publisher.name', 'isPartOf.name', 'provider.name']),
			deriveRootDomain(finalUrl.hostname),
		]).replace(/^@/, '');
		const bodyText = extractBodyText(html);
		const imageUrls = collectImageUrls(html, finalUrl.toString(), metaMap, jsonLdNodes);
		const bestImageUrl = pickBestImageUrl(imageUrls);
		const mainContent = firstNonEmptyString([
			pickJsonLdText(jsonLdNodes, ['articleBody', 'text', 'description']),
			bodyText,
			description,
		]);
		const resolved = {
			normalizedUrl: finalUrl.toString(),
			originalUrl: String(rawUrl || '').trim() || normalized.toString(),
			hostname: finalUrl.hostname.toLowerCase(),
			rootDomain: deriveRootDomain(finalUrl.hostname),
			siteName: siteName || null,
			title: snippet(pageTitle, 220) || null,
			description: snippet(description, 420) || null,
			mainContent: snippet(mainContent, 900) || null,
			imageUrl: bestImageUrl,
			imageUrls,
			metadataJson: Object.fromEntries(metaEntries.map((entry) => [entry.key, entry.value])),
		};
		// The custom parser is cheaper and preserves site-specific heuristics; only invoke
		// article-extractor when the result still looks thin or obviously low quality.
		if (!shouldUseExtractorFallback(resolved)) {
			return resolved;
		}
		const extracted = await resolveWithArticleExtractor(finalUrl.toString());
		if (!extracted) {
			return resolved;
		}
		return {
			...resolved,
			siteName: resolved.siteName || extracted.siteName,
			title: resolved.title || extracted.title,
			description: resolved.description || extracted.description,
			mainContent: resolved.mainContent && resolved.mainContent.length >= 160
				? resolved.mainContent
				: extracted.mainContent || resolved.mainContent,
			imageUrl: resolved.imageUrl && !isLikelyBadPreviewImageUrl(resolved.imageUrl)
				? resolved.imageUrl
				: extracted.imageUrl,
			imageUrls: extracted.imageUrl && !resolved.imageUrls.includes(extracted.imageUrl)
				? [extracted.imageUrl, ...resolved.imageUrls]
				: resolved.imageUrls,
			metadataJson: {
				...resolved.metadataJson,
				resolverFallback: 'article-extractor',
			},
		};
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
}

module.exports = {
	buildLinkSeed,
	deriveRootDomain,
	isLikelyBadPreviewImageUrl,
	normalizeUrl,
	resolveNoteLinkPreview,
};