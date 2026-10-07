/**
 * Cleans up HTML that arrives on the clipboard from word processors before TipTap parses it.
 *
 * TipTap is perfectly good at reading sane HTML. The problem is that Word, Outlook and Google
 * Docs do not produce sane HTML, and the single worst offender is lists: **Word does not emit
 * `<ul>` or `<ol>` at all.** It emits a run of ordinary paragraphs carrying `style="mso-list:l0
 * level1 lfo1"`, each with the bullet glyph or the number sitting in a `<span>` at the front,
 * hidden inside an `<!--[if !supportLists]-->` conditional comment. Parse that literally — which
 * is exactly what we were doing — and a pasted list arrives as a stack of paragraphs that begin
 * with a stray "·" or "1.", looking almost right and behaving nothing like a list.
 *
 * So this rebuilds real lists out of those paragraphs, then strips the rest of the noise.
 * Everything here is deliberately conservative: when a document does the normal thing and sends
 * real `<ul>`/`<ol>`, none of the list code touches it.
 */

/** Markers Word uses for an unordered bullet. Anything else numeric is treated as ordered. */
const WORD_BULLET_GLYPHS = new Set(['·', '•', 'o', '▪', '●', '○', '−', '-', '', '', '']);
/** "1." / "1)" / "a." / "iv)" — Word writes the literal marker text into the list paragraph. */
const ORDERED_MARKER_PATTERN = /^\s*[(\[]?(?:\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)[.)\]]/;

function isWordListParagraph(el: Element): boolean {
	const style = el.getAttribute('style') ?? '';
	if (/mso-list\s*:/i.test(style)) return true;
	// Word 365 sometimes drops the inline style and leaves only the class behind.
	const className = el.getAttribute('class') ?? '';
	return /\bMsoListParagraph/i.test(className);
}

function getWordListLevel(el: Element): number {
	const style = el.getAttribute('style') ?? '';
	const match = /mso-list\s*:[^;]*?level(\d+)/i.exec(style);
	if (match) return Math.max(1, Math.min(9, Number(match[1]) || 1));
	const className = el.getAttribute('class') ?? '';
	// MsoListParagraphCxSpFirst/Middle/Last carry no level; assume top level.
	return /\bMsoListParagraph/i.test(className) ? 1 : 1;
}

/**
 * Pulls the leading marker ("·", "1.", "a)") off a Word list paragraph and says whether it was
 * an ordered one. The marker lives in its own span, so removing it is a matter of taking nodes
 * off the front until we've consumed it — we must not simply regex the text, or an item that
 * legitimately begins with a number would lose it.
 */
function stripWordListMarker(el: Element): { ordered: boolean } {
	let ordered = false;
	let markerText = '';
	// Word brackets the marker in <!--[if !supportLists]--> ... <!--[endif]-->. The comments are
	// already gone by the time we get here, so take leading nodes until real content starts.
	while (el.firstChild) {
		const node = el.firstChild;
		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent ?? '';
			if (text.trim().length === 0) { node.remove(); continue; }
			break;
		}
		if (!(node instanceof Element)) { node.remove(); continue; }
		const text = (node.textContent ?? '').replace(/ /g, ' ').trim();
		if (text.length === 0) { node.remove(); continue; }
		// Only the marker is this short and this shaped. Anything longer is content.
		const isMarker = WORD_BULLET_GLYPHS.has(text) || (text.length <= 8 && ORDERED_MARKER_PATTERN.test(text));
		if (!isMarker) break;
		markerText = text;
		node.remove();
		break;
	}
	if (markerText && !WORD_BULLET_GLYPHS.has(markerText) && ORDERED_MARKER_PATTERN.test(markerText)) {
		ordered = true;
	}
	// Whatever whitespace Word left behind between marker and text.
	while (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE && (el.firstChild.textContent ?? '').trim().length === 0) {
		el.firstChild.remove();
	}
	return { ordered };
}

/**
 * Replaces each run of consecutive Word list paragraphs with a real list, nesting by the `level`
 * Word recorded. Runs are detected on siblings only, which is how Word lays them out.
 */
function rebuildWordLists(doc: Document): void {
	const paragraphs = Array.from(doc.querySelectorAll('p')).filter(isWordListParagraph);
	if (paragraphs.length === 0) return;

	let index = 0;
	while (index < paragraphs.length) {
		// Collect a maximal run of siblings.
		const run: Element[] = [paragraphs[index]];
		index += 1;
		while (index < paragraphs.length && paragraphs[index].previousElementSibling === run[run.length - 1]) {
			run.push(paragraphs[index]);
			index += 1;
		}

		const first = run[0];
		const parent = first.parentNode;
		if (!parent) continue;

		// A stack of open lists, one per nesting level.
		const stack: { level: number; list: Element }[] = [];
		let rootList: Element | null = null;

		for (const paragraph of run) {
			const level = getWordListLevel(paragraph);
			const { ordered } = stripWordListMarker(paragraph);

			const item = doc.createElement('li');
			while (paragraph.firstChild) item.appendChild(paragraph.firstChild);

			while (stack.length > 0 && stack[stack.length - 1].level > level) stack.pop();

			if (stack.length === 0 || stack[stack.length - 1].level < level) {
				const list = doc.createElement(ordered ? 'ol' : 'ul');
				if (stack.length === 0) {
					rootList = list;
				} else {
					// Nest inside the previous item so the structure is valid.
					const parentList = stack[stack.length - 1].list;
					const lastItem = parentList.lastElementChild;
					(lastItem ?? parentList).appendChild(list);
				}
				stack.push({ level, list });
			}

			stack[stack.length - 1].list.appendChild(item);
		}

		if (rootList) parent.insertBefore(rootList, first);
		for (const paragraph of run) paragraph.remove();
	}
}

/** Google Docs wraps its entire payload in a bold span that explicitly un-bolds itself. */
function unwrapGoogleDocsBoldWrapper(doc: Document): void {
	for (const bold of Array.from(doc.querySelectorAll('b[style*="font-weight"]'))) {
		const style = bold.getAttribute('style') ?? '';
		if (!/font-weight\s*:\s*normal/i.test(style)) continue;
		const parent = bold.parentNode;
		if (!parent) continue;
		while (bold.firstChild) parent.insertBefore(bold.firstChild, bold);
		bold.remove();
	}
}

/** Office styling that means nothing outside Office, and would otherwise survive as noise. */
function stripOfficeCruft(doc: Document): void {
	for (const node of Array.from(doc.querySelectorAll('style, script, meta, link, title, xml'))) {
		node.remove();
	}
	// Namespaced Office elements (<o:p>, <w:sdt>, <m:oMath>) — unwrap, keeping any text.
	for (const el of Array.from(doc.querySelectorAll('*'))) {
		if (!el.tagName.includes(':')) continue;
		const parent = el.parentNode;
		if (!parent) continue;
		while (el.firstChild) parent.insertBefore(el.firstChild, el);
		el.remove();
	}
	for (const el of Array.from(doc.querySelectorAll('[class], [style]'))) {
		const className = el.getAttribute('class');
		if (className && /\bMso|\bdocx|\bOutline/i.test(className)) el.removeAttribute('class');
		const style = el.getAttribute('style');
		if (!style) continue;
		// Drop mso-* declarations and the font/size/colour soup, but keep the handful of
		// declarations TipTap actually reads as marks (bold/italic/underline/strike).
		const kept = style
			.split(';')
			.map((decl) => decl.trim())
			.filter((decl) => decl.length > 0 && !/^mso-/i.test(decl))
			.filter((decl) => /^(font-weight|font-style|text-decoration|text-align|background-color)\s*:/i.test(decl))
			.join('; ');
		if (kept) el.setAttribute('style', kept);
		else el.removeAttribute('style');
	}
}

/** Empty spans and paragraphs Word leaves behind once its styling is gone. */
function removeEmptyLeftovers(doc: Document): void {
	for (const span of Array.from(doc.querySelectorAll('span'))) {
		if (span.attributes.length > 0) continue;
		const parent = span.parentNode;
		if (!parent) continue;
		while (span.firstChild) parent.insertBefore(span.firstChild, span);
		span.remove();
	}
	for (const paragraph of Array.from(doc.querySelectorAll('p'))) {
		const text = (paragraph.textContent ?? '').replace(/ /g, ' ').trim();
		if (text.length === 0 && paragraph.children.length === 0) paragraph.remove();
	}
}

/** True when the clipboard HTML carries the fingerprints of a word processor. */
export function looksLikeWordProcessorHtml(html: string): boolean {
	if (!html) return false;
	return /mso-|MsoNormal|MsoListParagraph|urn:schemas-microsoft-com|<o:p|docs-internal-guid|<!--\s*\[if\s/i.test(html);
}

/**
 * Normalises word-processor HTML into something TipTap can parse faithfully.
 *
 * Returns the original string unchanged when there is no DOMParser (non-browser) or when the
 * HTML shows no sign of coming from a word processor — ordinary web HTML is left completely
 * alone, since TipTap already handles it and every transformation here is a chance to lose
 * something.
 */
export function sanitizePastedHtml(html: string): string {
	const input = String(html ?? '').trim();
	if (!input) return '';
	if (typeof DOMParser === 'undefined') return input;
	if (!looksLikeWordProcessorHtml(input)) return input;
	try {
		// Conditional comments have to go before parsing, because the marker spans Word hides
		// inside them are the only record of whether a list was bulleted or numbered, and we
		// want them as real nodes rather than comment text.
		const withoutConditionals = input
			.replace(/<!--\s*\[if[^\]]*\]>/gi, '')
			.replace(/<!\[endif\]\s*-->/gi, '')
			.replace(/<!\[if[^\]]*\]>/gi, '')
			.replace(/<!\[endif\]>/gi, '');
		const doc = new DOMParser().parseFromString(withoutConditionals, 'text/html');
		unwrapGoogleDocsBoldWrapper(doc);
		rebuildWordLists(doc);
		stripOfficeCruft(doc);
		removeEmptyLeftovers(doc);
		return doc.body.innerHTML.trim();
	} catch {
		// A malformed paste is not worth throwing away — hand back what we were given and let
		// TipTap do its best, which is still the old behaviour rather than a regression.
		return input;
	}
}
