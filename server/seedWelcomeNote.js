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

/** Link text node — href is a URL or a #hash fragment */
function lnk(text, href) {
	const node = new Y.XmlText();
	node.insert(0, text, { link: { href, target: null, rel: null, class: null } });
	return node;
}

/** Mirrors slugifyHeadingText() in richText.ts */
function slugify(text) {
	return text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
}

/** <paragraph> with inline children (Y.XmlText or arrays of them) */
function para(...children) {
	const el = new Y.XmlElement('paragraph');
	const flat = children.flat();
	if (flat.length) el.insert(0, flat);
	return el;
}

/** <heading level="3"> with plain text */
function h3(text) {
	const el = new Y.XmlElement('heading');
	el.setAttribute('level', '3');
	el.insert(0, [t(text)]);
	return el;
}

/**
 * <heading level="2"> marked collapsible. The collapseId is a stable UUID
 * written into Yjs attributes so TipTap's CollapsibleHeading extension can
 * track collapsed/expanded state per device.
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
 * <bulletList> where each argument is a string, Y.XmlText, or array of
 * Y.XmlText nodes (for mixed bold/plain/link content).
 */
function ul(...items) {
	const list = new Y.XmlElement('bulletList');
	const listItems = items.map(item => li(item));
	if (listItems.length) list.insert(0, listItems);
	return list;
}

/* ── Feature guide content (English) ────────────────────────────────────── */

function buildWelcomeContentEn(fragment) {
	const EN_SECTIONS = [
		'🗂️ Workspaces',
		'📁 Collections & Labels',
		'📝 Note Types',
		'📖 Rich Text Features',
		'📌 Collapsible Headings',
		'💬 @Mentions & Inbox',
		'🤝 Sharing & Collaboration',
		'🫧 Bubble View',
		'⏰ Reminders',
		'🎨 Customization',
		'⚡ Offline First',
		'📱 Mobile FAB',
	];

	const nodes = [
		para(t('What\'s in this note:')),
		ul(...EN_SECTIONS.map(s => lnk(s, `#${slugify(s)}`))),
		hr(),

		h2Collapsible('🗂️ Workspaces'),
		para(t('Separate notebooks for separate contexts, so work doesn\'t bleed into home projects and hobby stuff stays out of personal notes. Create as many as you need — Work, Home, Side Projects, whatever makes sense for how you actually split your life up. You can switch between them from the sidebar, and each device remembers whichever one you had open last.')),
		hr(),

		h2Collapsible('📁 Collections & Labels'),
		para(t('Collections are basically folders inside a workspace. Labels are more like tags and they work across collections instead of being locked to one. Assign a collection to a note to keep it organized, or slap a few labels on it and use the filter sidebar to combine them however you want.')),
		hr(),

		h2Collapsible('📝 Note Types'),
		h3('Text Notes'),
		para(t('These are full rich text: headings, bullet lists, tables, code blocks, links, highlights, images, all of it. Type ## heading and it converts as you go, Markdown-style. You can also just paste in an entire Markdown document and it\'ll parse correctly without any problems (hopefully). When you need to get text out, select it and use the toolbar to copy as either Markdown or rich text, depending on where it\'s headed.')),

		h3('Checklists'),
		para(t('Running lists with a couple of features I actually use every day. Tap '), b('+1'), t(' on any item and it turns into a counter. Hit '), b('+'), t(' or '), b('−'), t(' to adjust it, tap the checkbox again to turn it back into a normal item. There\'s also auto-scroll (not just here — text notes have it too), which scrolls you to the bottom of the note when you open it. Handy for logs or anything you\'re treating like a running journal. Toggle it with the '), b('≡↓'), t(' button in the toolbar.')),
		para(t('Can\'t check something off yet on a long list? Swipe an item right to send it to the bottom, out of your way — swipe left to bring it back to the top. On desktop, hover a row for the same two arrows instead.')),

		h3('✏️ Drawing Notes'),
		para(t('A full Excalidraw canvas is built in: shapes, freehand drawing, text, arrows. If you\'ve got collaborators in the note, it syncs live while you draw.')),
		hr(),

		h2Collapsible('📖 Rich Text Features'),
		h3('Heading Anchors'),
		para(t('Click the link icon in the toolbar and scroll down. Every heading in the note shows up as a jump target. Genuinely useful once a note gets long and you want section navigation instead of scrolling forever.')),

		h3('URL Previews'),
		para(t('There\'s a separate button for this in the toolbar — it looks like an image frame with a chain link (🖼️🔗). It\'s not the same as just pasting a URL. It actually pulls the page title, description, and a thumbnail and renders the whole thing as a card inline in the note. I mostly use it for bookmarks and reference material I want to actually see again later, not just click through to.')),
		hr(),

		h2Collapsible('📌 Collapsible Headings'),
		para(t('Click the lambda next to a heading and everything underneath it folds away. An H2 will collapse all the H3s, H4s, and H5s beneath it, right up until the next H2. An H1 folds the whole section. This is per-device too, so folding something on your laptop doesn\'t change what your collaborators see on theirs.')),
		para(t('(Yes, this heading folds. Try the lambda icon.)')),
		hr(),

		h2Collapsible('💬 @Mentions & Inbox'),
		h3('@Mentions'),
		para(t('Type @ anywhere in a text note or checklist to mention someone. They\'ll get a notification in their inbox with a direct link straight to the note, and clicking it drops them right at the mention, which pulses briefly so it\'s not easy to miss. You can even mention yourself to self-assign something, and it shows up in your inbox as "you assigned yourself a task," which is a little funny but works. If you mention someone who doesn\'t have access yet, they get invited automatically.')),

		h3('Inbox'),
		para(t('The inbox lives behind the icon in the sidebar and doubles as your activity feed: mentions from other people, tasks you\'ve been handed in checklists, that sort of thing. Swipe a card either direction to archive it.')),
		hr(),

		h2Collapsible('🤝 Sharing & Collaboration'),
		para(t('Any note can be shared with either View or Edit permissions, and editing is real-time across however many devices are in the note at once. Shared notes can be placed in your personal workspace, a "Shared with me" section, or organized into separate folders within it.')),
		hr(),

		h2Collapsible('🫧 Bubble View'),
		para(t('This one\'s a bit different. Instead of a list, your notes float around as bubbles sized by how recent and active they are. The ones you\'re actually using drift toward the top. There\'s a zoom slider if you want more or less detail at a glance, and tapping a bubble opens the note like normal.')),
		hr(),

		h2Collapsible('⏰ Reminders'),
		para(t('Set one from the 3-dot menu on any note. Notifications go out to whichever devices you\'ve turned them on for.')),
		hr(),

		h2Collapsible('🎨 Customization'),
		para(t('Preferences → Appearance has a decent theme library, including a Half-Life set if that\'s your thing (it is mine). Beyond themes, you can set note colors and banners from the 3-dot menu, scale card text and editor text separately, change the toolbar size and tweak card height and click behavior — all under Appearance.')),
		hr(),

		h2Collapsible('⚡ Offline First'),
		para(t('Notes load right from your device, so there\'s no network dependency to actually open and read your stuff. Everything syncs back up once you\'re online again. I tested this on a 10-hour flight and it held up the whole way, no weirdness on reconnect.')),
		hr(),

		h2Collapsible('📱 Mobile FAB'),
		para(t('The floating + button in the bottom-right can be long-pressed and dragged anywhere on screen. Wherever you drop it is saved per device, so it stays put.')),
		hr(),

		para([b('Workspaces'), t(' = top-level contexts · '), b('Collections'), t(' = folders · '), b('Labels'), t(' = tags · '), b('Inbox'), t(' = @mentions and tasks')]),
	];

	fragment.insert(0, nodes);
}

/* ── Feature guide content (Spanish) ────────────────────────────────────── */

function buildWelcomeContentEs(fragment) {
	const ES_SECTIONS = [
		'🗂️ Espacios de trabajo',
		'📁 Colecciones y etiquetas',
		'📝 Tipos de notas',
		'📖 Funciones de texto enriquecido',
		'📌 Encabezados contraíbles',
		'💬 @Menciones e Inbox',
		'🤝 Compartir y colaborar',
		'🫧 Vista de burbujas',
		'⏰ Recordatorios',
		'🎨 Personalización',
		'⚡ Sin conexión primero',
		'📱 FAB móvil',
	];

	const nodes = [
		para(t('Contenido de esta nota:')),
		ul(...ES_SECTIONS.map(s => lnk(s, `#${slugify(s)}`))),
		hr(),

		h2Collapsible('🗂️ Espacios de trabajo'),
		para(t('Cuadernos separados para contextos distintos, para que el trabajo no se mezcle con proyectos personales y las cosas de hobby no aparezcan en notas de clientes. Crea todos los que necesites — Trabajo, Casa, Proyectos personales, lo que tenga sentido según cómo organizas tu vida. Puedes cambiar entre ellos desde la barra lateral, y cada dispositivo recuerda el que tenías abierto la última vez.')),
		hr(),

		h2Collapsible('📁 Colecciones y etiquetas'),
		para(t('Las colecciones son básicamente carpetas dentro de un espacio de trabajo. Las etiquetas son más como tags y funcionan entre colecciones en vez de estar atadas a una sola. Asigna una colección a una nota para mantenerla ordenada, o ponle unas etiquetas y usa el panel de filtros para combinarlas como quieras.')),
		hr(),

		h2Collapsible('📝 Tipos de notas'),
		h3('Notas de texto'),
		para(t('Texto enriquecido completo: encabezados, listas, tablas, bloques de código, enlaces, resaltados, imágenes, todo. Escribe ## encabezado y se convierte al momento, estilo Markdown. También puedes pegar un documento Markdown completo y lo parsea correctamente sin problemas (con suerte). Cuando necesites sacar el texto, selecciónalo y usa la barra de herramientas para copiar como Markdown o texto enriquecido, según dónde vaya.')),

		h3('Listas de verificación'),
		para(t('Listas con un par de funciones que uso todos los días. Toca '), b('+1'), t(' en cualquier elemento y se convierte en un contador. Usa '), b('+'), t(' o '), b('−'), t(' para ajustarlo, toca el checkbox de nuevo para volver a un elemento normal. También hay desplazamiento automático (no solo aquí — las notas de texto también lo tienen), que te lleva al final de la nota cuando la abres. Útil para registros o cualquier cosa que uses como diario. Actívalo con el botón '), b('≡↓'), t(' en la barra de herramientas.')),
		para(t('¿No puedes marcar algo todavía en una lista larga? Desliza un elemento hacia la derecha para mandarlo al final, fuera del camino — deslízalo hacia la izquierda para devolverlo arriba. En escritorio, pasa el cursor sobre la fila para ver las mismas dos flechas.')),

		h3('✏️ Notas de dibujo'),
		para(t('Un lienzo Excalidraw completo integrado: formas, dibujo a mano alzada, texto, flechas. Si tienes colaboradores en la nota, se sincroniza en tiempo real mientras dibujas.')),
		hr(),

		h2Collapsible('📖 Funciones de texto enriquecido'),
		h3('Anclas de encabezado'),
		para(t('Haz clic en el ícono de enlace en la barra de herramientas y desplázate hacia abajo. Todos los encabezados de la nota aparecen como destinos de salto. Muy útil cuando una nota se alarga y quieres navegación por secciones en vez de hacer scroll para siempre.')),

		h3('Vistas previas de URL'),
		para(t('Hay un botón separado para esto en la barra de herramientas — parece un marco de imagen con un ícono de cadena (🖼️🔗). No es lo mismo que pegar una URL normal. Obtiene el título de la página, la descripción y una miniatura, y renderiza todo como una tarjeta en línea dentro de la nota. Yo lo uso principalmente para marcadores y material de referencia que quiero volver a ver, no solo tener el enlace.')),
		hr(),

		h2Collapsible('📌 Encabezados contraíbles'),
		para(t('Haz clic en el ícono lambda junto a un encabezado y todo lo que hay debajo se pliega. Un H2 colapsa todos los H3, H4 y H5 que tiene debajo, hasta el siguiente H2. Un H1 pliega toda la sección. Esto es por dispositivo, así que plegar algo en tu laptop no cambia lo que ven tus colaboradores en los suyos.')),
		para(t('(Sí, este encabezado se pliega. Prueba el ícono lambda.)')),
		hr(),

		h2Collapsible('💬 @Menciones e Inbox'),
		h3('@Menciones'),
		para(t('Escribe @ en cualquier lugar de una nota de texto o lista para mencionar a alguien. Recibirán una notificación en su inbox con un enlace directo a la nota, y al hacer clic los lleva justo a la mención, que parpadea brevemente para que no pase desapercibida. Puedes incluso mencionarte a ti mismo para auto-asignarte algo, y aparece en tu inbox como "te asignaste una tarea," lo cual es un poco gracioso pero funciona. Si mencionas a alguien que no tiene acceso todavía, recibe una invitación automáticamente.')),

		h3('Inbox'),
		para(t('El inbox vive detrás del ícono en la barra lateral y funciona como tu feed de actividad: menciones de otras personas, tareas que te han asignado en listas de verificación, ese tipo de cosas. Desliza una tarjeta en cualquier dirección para archivarla.')),
		hr(),

		h2Collapsible('🤝 Compartir y colaborar'),
		para(t('Cualquier nota se puede compartir con permisos de Vista o Edición, y la edición es en tiempo real en cuantos dispositivos haya en la nota a la vez. Las notas compartidas se pueden poner en tu espacio de trabajo personal, en una sección "Compartido conmigo", o organizarlas en carpetas separadas dentro de esa sección.')),
		hr(),

		h2Collapsible('🫧 Vista de burbujas'),
		para(t('Esta es un poco diferente. En vez de una lista, tus notas flotan como burbujas cuyo tamaño depende de qué tan recientes y activas son. Las que realmente estás usando suben hacia arriba. Hay un deslizador de zoom si quieres ver más o menos detalle de un vistazo, y tocar una burbuja abre la nota como normal.')),
		hr(),

		h2Collapsible('⏰ Recordatorios'),
		para(t('Configura uno desde el menú de tres puntos en cualquier nota. Las notificaciones van a los dispositivos donde las hayas activado.')),
		hr(),

		h2Collapsible('🎨 Personalización'),
		para(t('Preferencias → Apariencia tiene una buena biblioteca de temas, incluido un set de Half-Life si eso es lo tuyo (lo es para mí). Más allá de los temas, puedes poner colores y banners en las notas desde el menú de tres puntos, escalar el texto de las tarjetas y del editor por separado, cambiar el tamaño de la barra de herramientas y ajustar la altura de las tarjetas y el comportamiento al hacer clic, todo en Apariencia.')),
		hr(),

		h2Collapsible('⚡ Sin conexión primero'),
		para(t('Las notas se cargan directamente desde tu dispositivo, así que no hay dependencia de red para abrirlas y leerlas. Todo se sincroniza de vuelta cuando vuelves a estar en línea. Lo probé en un vuelo de 10 horas y funcionó todo el tiempo, sin rarezas al reconectar.')),
		hr(),

		h2Collapsible('📱 FAB móvil'),
		para(t('El botón flotante + en la esquina inferior derecha se puede mantener presionado y arrastrar a cualquier parte de la pantalla. Donde lo sueltes se guarda por dispositivo, así que se queda donde lo pusiste.')),
		hr(),

		para([b('Espacios de trabajo'), t(' = contextos principales · '), b('Colecciones'), t(' = carpetas · '), b('Etiquetas'), t(' = tags · '), b('Inbox'), t(' = @menciones y tareas')]),
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
		? '🧠 Freeman Notes — cómo funciona esto'
		: '🧠 Freeman Notes — how stuff works';
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
