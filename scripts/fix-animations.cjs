'use strict';
const fs = require('fs');
const path = require('path');

// ── NoteGrid.tsx ──────────────────────────────────────────────
const gridFile = path.join(__dirname, '..', 'src', 'components', 'NoteGrid', 'NoteGrid.tsx');
let c = fs.readFileSync(gridFile, 'utf8');

function rep(label, from, to) {
  if (!c.includes(from)) { console.warn('NOT FOUND:', label); return; }
  c = c.replace(from, to);
  console.log('OK:', label);
}

const t = '\t';
const T9  = t.repeat(9);
const T10 = t.repeat(10);
const T11 = t.repeat(11);
const T13 = t.repeat(13);
const T14 = t.repeat(14);
const T15 = t.repeat(15);
const T16 = t.repeat(16);
const NL = '\r\n';

// A: Collaborator PANEL - remove y translation
rep('A collab panel anim',
  T9+'initial={{ opacity: 0, y: -6 }}'+NL+T9+'animate={{ opacity: 1, y: 0 }}'+NL+T9+'exit={{ opacity: 0, y: -6 }}'+NL+T9+'transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}'+NL+T9.slice(0,-1)+'>'+NL+T9+'<div'+NL+T9+t+'ref={collaboratorOverlayListRef}',
  T9+'initial={{ opacity: 0 }}'+NL+T9+'animate={{ opacity: 1 }}'+NL+T9+'exit={{ opacity: 0 }}'+NL+T9+'transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}'+NL+T9.slice(0,-1)+'>'+NL+T9+'<div'+NL+T9+t+'ref={collaboratorOverlayListRef}'
);

// B: Collaborator ITEM - use y:'-100%' within shell clip
rep('B collab item anim',
  T15+'initial={{ opacity: 0, y: -10 }}'+NL+T15+'animate={{ opacity: 1, y: 0 }}'+NL+T15+'exit={{ opacity: 0, y: -6 }}'+NL+T14+'transition={{'+NL+T16+'duration: 0.15,',
  T15+"initial={{ opacity: 0, y: '-100%' }}"+NL+T15+"animate={{ opacity: 1, y: '0%' }}"+NL+T15+'exit={{ opacity: 0, transition: { duration: 0.08, delay: 0 } }}'+NL+T14+'transition={{'+NL+T16+'duration: 0.12,'
);

// C: Metadata PANEL - remove y translation
rep('C metadata panel anim',
  T10+'initial={{ opacity: 0, y: -6 }}'+NL+T10+'animate={{ opacity: 1, y: 0 }}'+NL+T10+'exit={{ opacity: 0, y: -6 }}'+NL+T10+'transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}',
  T10+'initial={{ opacity: 0 }}'+NL+T10+'animate={{ opacity: 1 }}'+NL+T10+'exit={{ opacity: 0 }}'+NL+T10+'transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}'
);

// D: Metadata ITEM - use y:'-100%' within shell clip
const T12 = t.repeat(12);
rep('D metadata item anim',
  T13+'initial={{ opacity: 0, y: -10 }}'+NL+T13+'animate={{ opacity: 1, y: 0 }}'+NL+T13+'exit={{ opacity: 0, y: -6 }}'+NL+T13+'transition={{'+NL+T12+t+t+'duration: 0.15,',
  T13+"initial={{ opacity: 0, y: '-100%' }}"+NL+T13+"animate={{ opacity: 1, y: '0%' }}"+NL+T13+'exit={{ opacity: 0, transition: { duration: 0.08, delay: 0 } }}'+NL+T13+'transition={{'+NL+T12+t+t+'duration: 0.12,'
);

// E: Metadata items - add shell wrapper (opening)
const T9_base = t.repeat(9);
rep('E metadata shell open',
  T9_base+'{openMetadataChip.entries.map((entry, index) => ('+NL+T12+'<motion.button'+NL+T12+t+'key={entry.key}',
  T9_base+'{openMetadataChip.entries.map((entry, index) => ('+NL+T12+'<div key={entry.key} className={styles.collaboratorOverlayItemShell}>'+NL+T12+'<motion.button'
);

// F: Metadata items - add shell wrapper (closing </div>)
rep('F metadata shell close',
  'styles.collaboratorOverlayName}>{entry.label}</span>'+NL+T15+')}'  +NL+T12+'</motion.button>'+NL+T11+'))}'  ,
  'styles.collaboratorOverlayName}>{entry.label}</span>'+NL+T15+')}'  +NL+T12+'</motion.button>'+NL+T12+'</div>'+NL+T11+'))}'
);

// G: Add splitIntoListColumns helper near readChipOverlayAnchorRect
const helperFn = `
function splitIntoListColumns<T>(ids: readonly T[], cols: number): T[][] {
\tif (cols <= 1) return [ids as T[]];
\tconst chunkSize = Math.ceil(ids.length / cols);
\treturn Array.from({ length: cols }, (_, i) => ids.slice(i * chunkSize, (i + 1) * chunkSize));
}

`;
if (!c.includes('splitIntoListColumns')) {
  c = c.replace('function readChipOverlayAnchorRect(', helperFn + 'function readChipOverlayAnchorRect(');
  console.log('OK: G splitIntoListColumns helper');
} else {
  console.log('SKIP: G (already present)');
}

fs.writeFileSync(gridFile, c, 'utf8');
console.log('NoteGrid.tsx written');

// ── NoteAttachmentCountChip.tsx ───────────────────────────────
const chipFile = path.join(__dirname, '..', 'src', 'components', 'NoteAttachments', 'NoteAttachmentCountChip.tsx');
let cc = fs.readFileSync(chipFile, 'utf8');

function rep2(label, from, to) {
  if (!cc.includes(from)) { console.warn('NOT FOUND:', label); return; }
  cc = cc.replace(from, to);
  console.log('OK:', label);
}

// Attachment panel - remove y  (9 tabs)
rep2('H attach panel anim',
  '\t\t\t\t\t\t\t\t\tinitial={{ opacity: 0, y: -6 }}'+NL+'\t\t\t\t\t\t\t\t\tanimate={{ opacity: 1, y: 0 }}'+NL+'\t\t\t\t\t\t\t\t\texit={{ opacity: 0, y: -6 }}'+NL+'\t\t\t\t\t\t\t\t\ttransition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}',
  '\t\t\t\t\t\t\t\t\tinitial={{ opacity: 0 }}'+NL+'\t\t\t\t\t\t\t\t\tanimate={{ opacity: 1 }}'+NL+'\t\t\t\t\t\t\t\t\texit={{ opacity: 0 }}'+NL+'\t\t\t\t\t\t\t\t\ttransition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}'
);

// Attachment item - use y:'-100%'  (10 tabs before initial, 14 before animate/exit/transition, 15 before duration)
rep2('I attach item anim',
  '\t\t\t\t\t\t\t\t\t\tinitial={{ opacity: 0, y: -10 }}'+NL+'\t\t\t\t\t\t\t\t\t\t\t\t\t\tanimate={{ opacity: 1, y: 0 }}'+NL+'\t\t\t\t\t\t\t\t\t\t\t\t\t\texit={{ opacity: 0, y: -6 }}'+NL+'\t\t\t\t\t\t\t\t\t\t\t\t\t\ttransition={{'+NL+'\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tduration: 0.15,',
  "\t\t\t\t\t\t\t\t\t\tinitial={{ opacity: 0, y: '-100%' }}"+NL+"\t\t\t\t\t\t\t\t\t\t\t\t\t\tanimate={{ opacity: 1, y: '0%' }}"+NL+'\t\t\t\t\t\t\t\t\t\t\t\t\t\texit={{ opacity: 0, transition: { duration: 0.08, delay: 0 } }}'+NL+'\t\t\t\t\t\t\t\t\t\t\t\t\t\ttransition={{'+NL+'\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tduration: 0.12,'
);

fs.writeFileSync(chipFile, cc, 'utf8');
console.log('NoteAttachmentCountChip.tsx written');

console.log('Done!');
