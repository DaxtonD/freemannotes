'use strict';
const fs = require('fs');
const path = require('path');

const gridFile = path.join(__dirname, '..', 'src', 'components', 'NoteGrid', 'NoteGrid.tsx');
let c = fs.readFileSync(gridFile, 'utf8');

const t = '\t';
const NL = '\r\n';

function rep(label, from, to) {
	if (!c.includes(from)) { console.error('NOT FOUND:', label); process.exit(1); }
	c = c.replace(from, to);
	console.log('OK:', label);
}

// Fix 1: dragColumns - make list view multi-column aware for cross-column drag
rep('dragColumns list-column-aware',
	t+'const dragColumns = React.useMemo(() => (isListLikeView ? [visibleIds] : resolvedBaseColumns), [isListLikeView, resolvedBaseColumns, visibleIds]);',
	t+'const dragColumns = React.useMemo(() => {'+NL+
	t+t+'if (!isListLikeView) return resolvedBaseColumns;'+NL+
	t+t+'if (isGroupedView) return [visibleIds];'+NL+
	t+t+'return splitIntoListColumns(visibleIds, listColumnCount);'+NL+
	t+'}, [isGroupedView, isListLikeView, listColumnCount, resolvedBaseColumns, visibleIds]);'
);

// Fix 2: Add missing badges (collection, labels, collaborators) to listDragGhost
const T7 = t.repeat(7), T8 = t.repeat(8), T9 = t.repeat(9), T10 = t.repeat(10);
const missingBadges =
	NL+T8+'{activeSnapshot?.collectionId && collectionPathById.get(activeSnapshot.collectionId) ? ('+NL+
	T9+'<span className={styles.listDragGhostBadge} title={collectionPathById.get(activeSnapshot.collectionId) ?? undefined}>'+NL+
	T10+'<FontAwesomeIcon icon={faFolder} />'+NL+
	T9+'</span>'+NL+
	T8+') : null}'+
	NL+T8+'{(activeSnapshot?.labelIds?.length ?? 0) > 0 ? ('+NL+
	T9+'<span className={styles.listDragGhostBadge}>'+NL+
	T10+'<FontAwesomeIcon icon={faTag} />'+NL+
	T10+'{(activeSnapshot?.labelIds?.length ?? 0) > 1 ? ('+NL+
	T10+t+'<span className={styles.listDragGhostBadgeCount}>{activeSnapshot!.labelIds!.length}</span>'+NL+
	T10+') : null}'+NL+
	T9+'</span>'+NL+
	T8+') : null}'+
	NL+T8+'{(collaboratorCountByNoteId[activeNote.id] ?? 0) > 0 ? ('+NL+
	T9+'<span className={styles.listDragGhostBadge}>'+NL+
	T10+'<FontAwesomeIcon icon={faUsers} />'+NL+
	T10+'{(collaboratorCountByNoteId[activeNote.id] ?? 0) > 1 ? ('+NL+
	T10+t+'<span className={styles.listDragGhostBadgeCount}>{collaboratorCountByNoteId[activeNote.id]}</span>'+NL+
	T10+') : null}'+NL+
	T9+'</span>'+NL+
	T8+') : null}';

rep('listDragGhost missing badges',
	NL+T8+') : null}'+NL+T7+'</div>'+NL+T7+'{props.viewMode =',
	NL+T8+') : null}'+missingBadges+NL+T7+'</div>'+NL+T7+'{props.viewMode ='
);

fs.writeFileSync(gridFile, c, 'utf8');
console.log('NoteGrid.tsx written');
console.log('Done!');
