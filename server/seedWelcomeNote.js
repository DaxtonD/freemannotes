'use strict';

/**
 * Seeds a formatted "Freeman Notes — Feature Guide" rich-text note into a
 * newly-created workspace. Called from authRouter.js after registration so
 * every new user sees it immediately on first login.
 *
 * The note is a type='text' note whose content lives in the 'contentRich'
 * Y.XmlFragment (same key as TEXT_NOTE_RICH_FIELD in richText.ts), built
 * using the same y-prosemirror XML schema that TipTap writes at runtime.
 *
 * Locale support: pass the user's selected locale so the note is seeded in
 * their language. Supported: 'en' (default), 'es'.
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

/**
 * <heading level="2"> that is marked collapsible. The collapseId is a stable
 * UUID written into the Yjs attributes so TipTap's CollapsibleHeading extension
 * can track collapsed/expanded state per device.
 *
 * Attribute encoding matches y-prosemirror's raw-string storage:
 *   'collapsible' = 'true'  → Boolean('true') = true  ✓
 *   'collapseId'  = '<uuid>' → typeof === 'string'     ✓
 */
function h2Collapsible(text) {
	const el = new Y.XmlElement('heading');
	el.setAttribute('level', '2');
	el.setAttribute('collapsible', 'true');
	el.setAttribute('collapseId', randomUUID());
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

/* ── Feature guide content (English) ────────────────────────────────────── */

function buildWelcomeContentEn(fragment) {
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
		ul(
			[b('Markdown support'), t(' — Type Markdown syntax directly and it converts as you type. Paste Markdown from any source and it converts automatically.')],
			[b('Copy as Markdown / Copy as Rich Text'), t(' — Select any text, right-click (or use the toolbar), and choose your preferred copy format for pasting outside of Freeman Notes.')],
		),

		h3('Checklists'),
		para(t('Task lists with powerful built-in features:')),
		ul(
			[b('Checklist Counts'), t(' — Click '), b('+1'), t(' on any list item to make it a count item. Use '), b('+/−'), t(' to increment or decrement the quantity. Click the checkbox to return it to a standard list item.')],
			[b('Auto-Scroll'), t(' — When a note is opened, the view automatically scrolls to the bottom so your most recent entries are visible. Toggle it with the auto-scroll icon in the toolbar.')],
		),

		h3('✏️ Drawing Notes'),
		para(t('Whiteboard canvas powered by Excalidraw — shapes, freehand drawing, text, and more. Syncs in real-time.')),
		hr(),

		h2('📖 Rich Text Features'),
		h3('Table of Contents (TOC)'),
		para(t('Open the TOC panel to see all headings in your note. Click any entry to jump directly to that section.')),

		// This heading is intentionally collapsible — try clicking the arrow to collapse it.
		h2Collapsible('📌 Collapsible Headings'),
		para(t('Click the arrow next to any heading to collapse everything beneath it. A higher-level heading collapses all lower-level headings and content below it — an H1 collapses all H2, H3, H4, and H5 sections that follow. Collapsed state is saved per device.')),
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
			[b('Themes'), t(' — Large library including the Freeman Half-Life themed collection')],
			[b('Note colors & banners'), t(' — Assign a color or banner image to any note card')],
			[b('Text size'), t(' — Adjust the note card text size in Preferences → Appearance')],
			[b('User avatar'), t(' — Upload a profile photo in Preferences → Account')],
			[b('Toolbar size'), t(' — Resize or reposition the editor toolbar to suit your workflow')],
			[b('Card height & click behavior'), t(' — Control how note cards expand and what a single click does')],
		),
		hr(),

		h2('⚡ Offline First'),
		para(t('All notes load instantly from local storage — no internet needed. Changes sync automatically when you reconnect.')),
		hr(),

		h2('📱 Mobile FAB'),
		para(t('On mobile, long-press the floating + button (bottom-right) to drag it anywhere on screen. Release to drop it in your preferred position — the location is saved per device.')),
		hr(),

		para([b('Workspaces'), t(' = Big categories · '), b('Collections'), t(' = Folders · '), b('Labels'), t(' = Tags · '), b('Inbox'), t(' = Your activity feed')]),
		para(t('Freeman Notes is built to stay out of your way — so you can write, organize, and get things done.')),
	];

	fragment.insert(0, nodes);
}

/* ── Feature guide content (Spanish) ────────────────────────────────────── */

function buildWelcomeContentEs(fragment) {
	const nodes = [
		h2('🗂️ Espacios de trabajo'),
		para(t('Piensa en los espacios de trabajo como cuadernos separados para diferentes áreas de tu vida.')),
		ul(
			'Trabajo, Hogar, Proyectos — cada uno ordenado y enfocado',
			'Cambia entre espacios de trabajo desde la barra lateral',
		),
		hr(),

		h2('📁 Colecciones y etiquetas'),
		para(t('Las colecciones son carpetas dentro de un espacio de trabajo. Las etiquetas son marcadores que cruzan colecciones.')),
		ul(
			'Agrupa notas relacionadas en colecciones',
			'Aplica varias etiquetas a una nota para filtrado flexible',
		),
		hr(),

		h2('📝 Tipos de notas'),
		h3('Notas de texto'),
		para(t('Editor de texto enriquecido completo — encabezados, listas, negrita/cursiva, tablas, enlaces y más.')),
		ul(
			[b('Compatibilidad con Markdown'), t(' — Escribe sintaxis Markdown directamente y se convierte mientras escribes. Pega Markdown desde cualquier fuente y se convierte automáticamente.')],
			[b('Copiar como Markdown / Copiar como texto enriquecido'), t(' — Selecciona cualquier texto y elige el formato de copia que prefieras para pegar fuera de Freeman Notes.')],
		),

		h3('Listas de verificación'),
		para(t('Listas de tareas con funciones integradas avanzadas:')),
		ul(
			[b('Contadores de lista'), t(' — Haz clic en '), b('+1'), t(' en cualquier elemento para convertirlo en un elemento de conteo. Usa '), b('+/−'), t(' para incrementar o decrementar la cantidad. Haz clic en la casilla para volver a un elemento de lista estándar.')],
			[b('Desplazamiento automático'), t(' — Al abrir una nota, la vista se desplaza automáticamente al final para que tus entradas más recientes sean visibles. Actívalo con el ícono en la barra de herramientas.')],
		),

		h3('✏️ Notas de dibujo'),
		para(t('Lienzo de pizarra con Excalidraw — formas, dibujo a mano alzada, texto y más. Se sincroniza en tiempo real.')),
		hr(),

		h2('📖 Funciones de texto enriquecido'),
		h3('Tabla de contenido (TOC)'),
		para(t('Abre el panel TOC para ver todos los encabezados de tu nota. Haz clic en cualquier entrada para saltar directamente a esa sección.')),

		h2Collapsible('📌 Encabezados contraíbles'),
		para(t('Haz clic en la flecha junto a cualquier encabezado para contraer todo lo que hay debajo. Un encabezado de nivel superior contrae todos los encabezados y contenido de nivel inferior — un H1 contrae todos los H2, H3, H4 y H5 que siguen. El estado contraído se guarda por dispositivo.')),
		hr(),

		h2('💬 @Menciones e Inbox'),
		h3('@Menciones'),
		para(t('Escribe @ para mencionar a un colaborador en cualquier nota o lista.')),
		ul(
			[t('El usuario mencionado recibe una notificación en el inbox con un enlace a la nota')],
			[t('Al hacer clic en la tarjeta, se abre la nota y se desplaza directamente a la '), b('@mención'), t(', que parpadea para resaltarla')],
			[t('Menciónate '), b('a ti mismo'), t(' para asignarte una tarea — aparece en tu inbox como "Te asignaste una tarea"')],
		),

		h3('Inbox'),
		para(t('Tu feed de actividad — haz clic en el ícono de inbox en la barra lateral.')),
		ul(
			'@menciones dirigidas a ti',
			'Tareas asignadas a ti en listas de verificación',
			'Desliza una tarjeta a izquierda o derecha para archivarla',
		),
		hr(),

		h2('🤝 Compartir y colaborar'),
		ul(
			'Comparte cualquier nota — elige permisos de Vista o Edición',
			'Edita junto a otros en tiempo real desde cualquier dispositivo',
			'@menciona a alguien sin acceso — reciben una invitación automáticamente',
		),
		hr(),

		h2('🫧 Vista de burbujas'),
		para(t('Una vista visual de tus notas como burbujas flotantes.')),
		ul(
			'Las notas más activas o importantes suben automáticamente',
			'Acerca o aleja con el deslizador para ver más o menos detalle',
		),
		hr(),

		h2('⏰ Recordatorios y notificaciones'),
		ul(
			'Establece un recordatorio en cualquier nota',
			'Recibe notificaciones push en todos tus dispositivos',
		),
		hr(),

		h2('🎨 Personalización'),
		para(t('Haz que Freeman Notes se sienta como tuyo.')),
		ul(
			[b('Temas'), t(' — Gran biblioteca que incluye la colección de temas Freeman Half-Life')],
			[b('Colores y banners de nota'), t(' — Asigna un color o imagen de banner a cualquier tarjeta de nota')],
			[b('Tamaño de texto'), t(' — Ajusta el tamaño del texto en Preferencias → Apariencia')],
			[b('Avatar de usuario'), t(' — Sube una foto de perfil en Preferencias → Cuenta')],
			[b('Tamaño de barra de herramientas'), t(' — Redimensiona o reposiciona la barra de herramientas del editor')],
			[b('Altura de tarjeta y comportamiento de clic'), t(' — Controla cómo se expanden las tarjetas de notas')],
		),
		hr(),

		h2('⚡ Sin conexión primero'),
		para(t('Todas las notas se cargan instantáneamente desde el almacenamiento local — sin internet. Los cambios se sincronizan automáticamente al reconectarte.')),
		hr(),

		h2('📱 FAB móvil'),
		para(t('En móvil, mantén presionado el botón flotante + (abajo a la derecha) para arrastrarlo a cualquier lugar de la pantalla. Suéltalo para fijarlo en tu posición preferida — se guarda por dispositivo.')),
		hr(),

		para([b('Espacios de trabajo'), t(' = Categorías grandes · '), b('Colecciones'), t(' = Carpetas · '), b('Etiquetas'), t(' = Marcadores · '), b('Inbox'), t(' = Tu feed de actividad')]),
		para(t('Freeman Notes está diseñado para no interponerse en tu camino — para que puedas escribir, organizar y hacer las cosas.')),
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
 * @param {string} [locale='en'] - BCP-47 locale code selected during registration
 */
async function seedWelcomeNote(prisma, workspaceId, locale) {
	const lang = String(locale || 'en').split('-')[0].toLowerCase();

	const noteId        = randomUUID();
	const now           = Date.now();
	const nowIso        = new Date(now).toISOString();
	const noteTitle     = lang === 'es'
		? '🧠 Freeman Notes — Guía de características'
		: '🧠 Freeman Notes — Feature Guide';
	const noteDocId     = `${workspaceId}:${noteId}`;
	const registryDocId = `${workspaceId}:__notes_registry__`;

	// ── 1. Build note Y.Doc ─────────────────────────────────────────────────
	const noteYDoc = new Y.Doc();
	noteYDoc.transact(() => {
		noteYDoc.getText('title').insert(0, noteTitle);

		const meta = noteYDoc.getMap('metadata');
		meta.set('type',           'text');
		meta.set('createdAt',      now);
		meta.set('updatedAt',      now);
		meta.set('trashed',        false);
		meta.set('trashedAt',      null);
		meta.set('archived',       false);
		meta.set('archivedAt',     null);
		meta.set('colorToken',     null);
		meta.set('collectionId',   null);
		meta.set('labelIds',       []);
		meta.set('reminderAt',     null);
		meta.set('isPinned',       false);
		meta.set('lastAccessedAt', nowIso);

		const buildFn = lang === 'es' ? buildWelcomeContentEs : buildWelcomeContentEn;
		buildFn(noteYDoc.getXmlFragment('contentRich'));
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
