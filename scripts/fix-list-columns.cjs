'use strict';
const fs = require('fs');
const path = require('path');

const gridFile = path.join(__dirname, '..', 'src', 'components', 'NoteGrid', 'NoteGrid.tsx');
let c = fs.readFileSync(gridFile, 'utf8');

const t = '\t';
const NL = '\r\n';
const T5 = t.repeat(5), T6 = t.repeat(6), T7 = t.repeat(7), T8 = t.repeat(8);
const T9 = t.repeat(9);

const sharedProps = (orderedIdsExpr) =>
	NL+T8+'variant={props.viewMode}'+
	NL+T8+'orderedIds={'+orderedIdsExpr+'}'+
	NL+T8+'docsById={docsById}'+
	NL+T8+'noteSnapshotById={noteSnapshotById}'+
	NL+T8+'collectionPathById={collectionPathById}'+
	NL+T8+'labelById={labelById}'+
	NL+T8+'collaboratorCountByNoteId={collaboratorCountByNoteId}'+
	NL+T8+'selectedNoteId={props.selectedNoteId}'+
	NL+T8+'moreMenuNoteId={moreMenuNoteId}'+
	NL+T8+'themeId={props.themeId}'+
	NL+T8+'activeDragId={dragManager.activeDragId}'+
	NL+T8+'setItemElement={dragManager.setItemElement}'+
	NL+T8+'setHandleElement={dragManager.setHandleElement}'+
	NL+T8+'shouldSuppressOpen={() => dragManager.shouldSuppressOpen() || moreMenuNoteId !== null}'+
	NL+T8+'canOpenNotes={!isTrashView}'+
	NL+T8+'isTrashView={isTrashView}'+
	NL+T8+"restoreLabel={t('noteMenu.restoreNote')}"+
	NL+T8+'canDrag={(noteId) => {'+
	NL+T9+'const note = noteById.get(noteId);'+
	NL+T9+'if (!note) return false;'+
	NL+T9+'return !isTrashView && !note.isShared && props.canReorder !== false;'+
	NL+T8+'}}'+
	NL+T8+'onSelectNote={props.onSelectNote}'+
	NL+T8+'onMoreMenu={(noteId, rect) => {'+
	NL+T9+'setMoreMenuOpenedByLongPress(false);'+
	NL+T9+'setMoreMenuAnchorRect(rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null);'+
	NL+T9+'setMoreMenuNoteId(noteId);'+
	NL+T8+'}}'+
	NL+T8+'onRestoreNote={isTrashView ? (noteId) => {'+
	NL+T9+'void manager.restoreNote(noteId);'+
	NL+T8+'} : undefined}'+
	NL+T7+'/>';

const from =
	NL+T5+')) : ('+
	NL+T6+'<div className={styles.listColumn}>'+
	NL+T7+'<NoteListView'+
	sharedProps('listOrderedIds')+
	NL+T6+'</div>';

const to =
	NL+T5+')) : ('+
	NL+T6+'<>'+
	NL+T6+'{splitIntoListColumns(listOrderedIds, listColumnCount).map((colIds, colIdx) => ('+
	NL+T6+'<div key={colIdx} className={styles.listColumn}>'+
	NL+T7+'<NoteListView'+
	sharedProps('colIds')+
	NL+T6+'</div>'+
	NL+T6+'))}'+
	NL+T6+'</>';

if (!c.includes(from)) {
	console.error('NOT FOUND: non-grouped list section');
	process.exit(1);
}

c = c.replace(from, to);
console.log('OK: non-grouped list multi-column');

fs.writeFileSync(gridFile, c, 'utf8');
console.log('NoteGrid.tsx written');
console.log('Done!');
