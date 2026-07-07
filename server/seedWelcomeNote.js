'use strict';

/**
 * Seeds a formatted "Freeman Notes — Feature Guide" rich-text note into a
 * newly-created workspace. Called from authRouter.js after registration so
 * every new user sees it immediately on first login.
 *
 * The note is a type='text' note whose content lives in the 'contentRich'
 * Y.XmlFragment (same key as TEXT_NOTE_RICH_FIELD in richText.ts), built
 * using the same y-prosemirror XML schema that TipTap writes at runtime.
 */

const Y = require('yjs');
const { randomUUID } = require('crypto');

/* ── Yjs XML builder helpers ─────────────────────────────────────────────── */

/** Plain text node */
function t(content) {
	const node = new Y.XmlText();
	node.insert(0, content);
	return node;
}

/** Bold text node */
function b(content) {
	const node = new Y.XmlText();
	node.insert(0, content, { bold: true });
	return node;
}

/** <paragraph> with inline children (Y.XmlText or arrays of them) */
function para(...children) {
	const el = new Y.XmlElement('paragraph');
	const flat = children.flat();
	if (flat.length) el.insert(0, flat);
	return el;
}

/** <heading level="N"> with plain text */
function h2(text) {
	const el = new Y.XmlElement('heading');
	el.setAttribute('level', '2');
	el.insert(0, [t(text)]);
	return el;
}

function h3(text) {
	const el = new Y.XmlElement('heading');
	el.setAttribute('level', '3');
	el.insert(0, [t(text)]);
	return el;
}

/** <horizontalRule> */
function hr() {
	return new Y.XmlElement('horizontalRule');
}

/**
 * <listItem> wrapping a single <paragraph>.
 * children: string | Y.XmlText | Y.XmlText[]
 */
function li(children) {
	const p = new Y.XmlElement('paragraph');
	const kids = typeof children === 'string'
		? [t(children)]
		: Array.isArray(children) ? children.flat() : [children];
	if (kids.length) p.insert(0, kids);
	const item = new Y.XmlElement('listItem');
	item.insert(0, [p]);
	return item;
}

/**
 * <bulletList> where each argument is either a plain string or an array of
 * Y.XmlText nodes (for mixed bold/plain content).
 */
function ul(...items) {
	const list = new Y.XmlElement('bulletList');
	const listItems = items.map(item => li(item));
	if (listItems.length) list.insert(0, listItems);
	return list;
}

/* ── Feature guide content ───────────────────────────────────────────────── */

function buildWelcomeContent(fragment) {
	const nodes = [
		h2('🗂️ Workspaces'),
		para(t('Think of workspaces as separate notebooks for different areas of your life.')),
		ul(
			'Work, Home, Projects — each stays clean and focused',
			'Switch between workspaces from the sidebar',
		),
		hr(),

		h2('📁 Collections & Labels'),
		para(t('Collections are folders within a workspace. Labels are cross-collection tags.')),
		ul(
			'Group related notes into collections',
			'Apply multiple labels to a note for flexible filtering',
		),
		hr(),

		h2('📝 Note Types'),
		h3('Text Notes'),
		para(t('Full rich text editor — headings, bullet lists, bold/italic, tables, links, and more.')),

		h3('Checklists'),
		para(t('Task lists with powerful built-in features:')),
		ul(
			[b('Checklist Counts'), t(' — Add a quantity to any item (e.g. "Milk ×3"). Tap '), b('+1'), t(' to increment instantly, or '), b('+/−'), t(' for precise control. Great for groceries and inventory.')],
			[b('Auto-Scroll'), t(' — After checking an item off, the list scrolls to the next one automatically. Toggle it with the auto-scroll icon in the toolbar.')],
		),

		h3('✏️ Drawing Notes'),
		para(t('Whiteboard canvas powered by Excalidraw — shapes, freehand drawing, text, and more. Syncs in real-time.')),
		hr(),

		h2('📖 Rich Text Features'),
		h3('Table of Contents (TOC)'),
		para(t('Open the TOC panel to see all headings in your note. Click any entry to jump directly to that section.')),

		h3('Collapsible Headings'),
		para(t('Click the arrow next to any heading to collapse all content beneath it. Collapsed state is saved per device.')),
		hr(),

		h2('💬 @Mentions & Inbox'),
		h3('@Mentions'),
		para(t('Type @ to mention a collaborator in any note or checklist.')),
		ul(
			[t('The mentioned user receives an inbox notification with a link to the note')],
			[t('Clicking the card opens the note and scrolls directly to the '), b('@mention'), t(', which pulses to highlight it')],
			[t('Mention '), b('yourself'), t(' to self-assign a task — it appears in your inbox as "You assigned yourself a task"')],
		),

		h3('Inbox'),
		para(t('Your activity feed — click the inbox icon in the sidebar.')),
		ul(
			'@mentions directed at you',
			'Tasks assigned to you in checklists',
			'Swipe a card left or right to archive it',
		),
		hr(),

		h2('🤝 Sharing & Collaboration'),
		ul(
			'Share any note — choose View or Edit permissions',
			'Edit together in real-time across any number of devices',
			'@mention someone without access — they receive an invitation automatically',
		),
		hr(),

		h2('🫧 Bubble View'),
		para(t('A visual overview of your notes as floating bubbles.')),
		ul(
			'More active or important notes rise to the top automatically',
			'Zoom in/out with the slider to see more or less detail',
		),
		hr(),

		h2('⏰ Reminders & Notifications'),
		ul(
			'Set a reminder on any note',
			'Receive push notifications across all your devices',
		),
		hr(),

		h2('🎨 Customization'),
		para(t('Make Freeman Notes feel like your own.')),
		ul(
			'Themes — large library including the Freeman Half-Life themed collection',
			'Note colors — assign a color to any note card for quick identification',
			'Note banners — add a banner image to the top of any note',
			'Card height, click behavior, and text size preferences',
		),
		hr(),

		h2('⚡ Offline First'),
		para(t('All notes load instantly from local storage — no internet needed. Changes sync automatically when you reconnect.')),
		hr(),

		para([b('Workspaces'), t(' = Big categories · '), b('Collections'), t(' = Folders · '), b('Labels'), t(' = Tags · '), b('Inbox'), t(' = Your activity feed')]),
		para(t('Freeman Notes is built to stay out of your way — so you can write, organize, and get things done.')),
	];

	fragment.insert(0, nodes);
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * Creates and persists the welcome feature-guide note for a newly registered
 * workspace. Non-fatal: errors are logged but do not throw.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} workspaceId
 */
async function seedWelcomeNote(prisma, workspaceId) {
	const noteId       = randomUUID();
	const now          = Date.now();
	const nowIso       = new Date(now).toISOString();
	const noteTitle    = '🧠 Freeman Notes — Feature Guide';
	const noteDocId    = `${workspaceId}:${noteId}`;
	const registryDocId = `${workspaceId}:__notes_registry__`;

	// ── 1. Build note Y.Doc ─────────────────────────────────────────────────
	const noteYDoc = new Y.Doc();
	noteYDoc.transact(() => {
		noteYDoc.getText('title').insert(0, noteTitle);

		const meta = noteYDoc.getMap('metadata');
		meta.set('type',            'text');
		meta.set('createdAt',       now);
		meta.set('updatedAt',       now);
		meta.set('trashed',         false);
		meta.set('trashedAt',       null);
		meta.set('archived',        false);
		meta.set('archivedAt',      null);
		meta.set('colorToken',      null);
		meta.set('collectionId',    null);
		meta.set('labelIds',        []);
		meta.set('reminderAt',      null);
		meta.set('isPinned',        false);
		meta.set('lastAccessedAt',  nowIso);

		buildWelcomeContent(noteYDoc.getXmlFragment('contentRich'));
	});

	await prisma.document.upsert({
		where:  { docId: noteDocId },
		create: { workspaceId, docId: noteDocId, state: Buffer.from(Y.encodeStateAsUpdate(noteYDoc)), stateVector: Buffer.from(Y.encodeStateVector(noteYDoc)) },
		update: { state: Buffer.from(Y.encodeStateAsUpdate(noteYDoc)), stateVector: Buffer.from(Y.encodeStateVector(noteYDoc)) },
	});

	// ── 2. Add to workspace notes registry ──────────────────────────────────
	const registryYDoc = new Y.Doc();

	const existingReg = await prisma.document.findUnique({
		where:  { docId: registryDocId },
		select: { state: true },
	}).catch(() => null);

	if (existingReg?.state) {
		Y.applyUpdate(registryYDoc, new Uint8Array(existingReg.state));
	}

	registryYDoc.transact(() => {
		const notesList = registryYDoc.getArray('notesList');
		const noteOrder = registryYDoc.getArray('noteOrder');

		const alreadyListed = notesList.toArray().some(
			(m) => m instanceof Y.Map && m.get('id') === noteId,
		);
		if (!alreadyListed) {
			const entry = new Y.Map();
			entry.set('id',    noteId);
			entry.set('title', noteTitle);
			notesList.push([entry]);
		}
		if (!noteOrder.toArray().includes(noteId)) {
			noteOrder.insert(0, [noteId]); // newest-first
		}
	});

	await prisma.document.upsert({
		where:  { docId: registryDocId },
		create: { workspaceId, docId: registryDocId, state: Buffer.from(Y.encodeStateAsUpdate(registryYDoc)), stateVector: Buffer.from(Y.encodeStateVector(registryYDoc)) },
		update: { state: Buffer.from(Y.encodeStateAsUpdate(registryYDoc)), stateVector: Buffer.from(Y.encodeStateVector(registryYDoc)) },
	});
}

module.exports = { seedWelcomeNote };
