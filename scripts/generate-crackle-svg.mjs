#!/usr/bin/env node
/**
 * scripts/generate-crackle-svg.mjs
 *
 * Generates public/icons/crackle.svg — a scalable, animated SVG crackle effect
 * modelled on crackleeffect.png / crackleeffecttransparent.png.
 *
 * Visual vocabulary:
 *  • Jittered Cartesian grid of nodes (cell ≈ 68 px)
 *  • K-nearest-neighbour edges (K=5) → irregular polygon cells matching the
 *    reference images
 *  • Every edge is an angular zigzag polyline (not a straight line)
 *  • Extra K=8 hairline layer → faint dashed background texture
 *  • Three visual layers: hairline / structural / bright, each with different
 *    stroke weights and SVG blur-based glow filters
 *  • CSS @keyframes for shimmer pulse + arc flash animations
 *
 * Usage: node scripts/generate-crackle-svg.mjs
 */

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Canvas dimensions (approx. matches reference image 1008×812) ─────────────
const W = 1000, H = 800;

// ── Deterministic seeded PRNG (mulberry32) ────────────────────────────────────
let seed = 0xC0FFEE42;
function rng() {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed) >>> 0;
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
  return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
}
const rnd = (a, b) => a + rng() * (b - a);
/** 1-decimal-place string for compact SVG path data */
const f = v => (Math.round(v * 10) / 10).toString();

// ── Jittered grid ─────────────────────────────────────────────────────────────
// Cell size 44 px → ~23 cols × ~19 rows — denser than before, matching the
// reference image which has small, tightly-packed polygons.
// +3 ring extends past canvas edges so lines reach all borders.
const CELL = 44;
const COLS = Math.ceil(W / CELL) + 3;
const ROWS = Math.ceil(H / CELL) + 3;
const CW = W / (COLS - 2);
const CH = H / (ROWS - 2);

const nodes = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    nodes.push({
      x: (c - 0.5) * CW + rnd(-CW * 0.46, CW * 0.46),
      y: (r - 0.5) * CH + rnd(-CH * 0.46, CH * 0.46),
      b: rng(),
    });
  }
}

// ── K-nearest-neighbour edges ─────────────────────────────────────────────────
function buildKNN(nodes, K) {
  const seen = new Set();
  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    const dists = nodes
      .map((_, j) => ({
        j,
        d2: j === i ? Infinity : (nodes[i].x - nodes[j].x) ** 2 + (nodes[i].y - nodes[j].y) ** 2,
      }))
      .sort((a, b) => a.d2 - b.d2)
      .slice(0, K);
    for (const { j } of dists) {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (!seen.has(key)) { seen.add(key); edges.push([i, j]); }
    }
  }
  return edges;
}

const inBounds = n => n.x > -48 && n.x < W + 48 && n.y > -48 && n.y < H + 48;
const onCanvas = n => n.x > 0 && n.x < W && n.y > 0 && n.y < H;

const allEdges5 = buildKNN(nodes, 5).filter(([i, j]) => inBounds(nodes[i]) && inBounds(nodes[j]));

// Hairline layer: K=8, then subtract the K=5 set
const edgeSet5 = new Set(allEdges5.map(([i, j]) => i < j ? `${i}:${j}` : `${j}:${i}`));
const allEdges8 = buildKNN(nodes, 8).filter(([i, j]) => inBounds(nodes[i]) && inBounds(nodes[j]));
const hairEdges = allEdges8.filter(([i, j]) => {
  const k = i < j ? `${i}:${j}` : `${j}:${i}`;
  return !edgeSet5.has(k);
});

// ── Angular zigzag path between two points ────────────────────────────────────
// More segments + larger jitter → jaggier, more angular lines matching the
// reference image (which has sharp turns, not smooth curves).
function angPath(a, b, jitter) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 2) return `M${f(a.x)},${f(a.y)}L${f(b.x)},${f(b.y)}`;
  const px = -dy / len, py = dx / len;
  // More segments per unit length (every 20px) for sharper angles
  const segs = Math.max(2, Math.min(8, Math.ceil(len / 20)));
  let d = `M${f(a.x)},${f(a.y)}`;
  for (let s = 1; s < segs; s++) {
    const t = s / segs;
    // Alternate sign with some randomness for the sharp angular crackle look
    const sign = rng() > 0.5 ? 1 : -1;
    const off = sign * rng() * len * jitter;
    d += `L${f(a.x + dx * t + px * off)},${f(a.y + dy * t + py * off)}`;
  }
  return d + `L${f(b.x)},${f(b.y)}`;
}

// ── Bucket structural edges by brightness ─────────────────────────────────────
// Thresholds tuned so bright ≈ 18%, mid ≈ 33%, faint ≈ 49% of edges,
// matching the reference image proportion of thick vs hairline lines.
const faintPaths = [], midPaths = [], brightPaths = [];
for (const [i, j] of allEdges5) {
  const b = Math.max(nodes[i].b, nodes[j].b);
  const jitter = b < 0.65 ? 0.07 : b < 0.87 ? 0.16 : 0.26;
  const p = angPath(nodes[i], nodes[j], jitter);
  if (b < 0.52) faintPaths.push(p);
  else if (b < 0.87) midPaths.push(p);
  else brightPaths.push(p);
}
// Hairlines: very small jitter (faint texture lines)
const hairPaths = hairEdges.map(([i, j]) => angPath(nodes[i], nodes[j], 0.04));

// ── Node dots at bright vertices ──────────────────────────────────────────────
const dotEls = nodes
  .filter(n => n.b > 0.82 && onCanvas(n))
  .map(n => `<circle cx="${f(n.x)}" cy="${f(n.y)}" r="${f(0.8 + n.b * 1.8)}"/>`);

// ── Arc flash animated paths ──────────────────────────────────────────────────
// Pick 10 bright edges for brief flash-in / flash-out crackle bursts.
const arcPaths = [...brightPaths].sort(() => rng() - 0.5).slice(0, 10);

// ── Energy-flow dashed paths (stroke-dashoffset animation) ───────────────────
// A handful of mid-layer paths get a flowing dash animation.
const flowPaths = [...midPaths].sort(() => rng() - 0.5).slice(0, 14).map((d, idx) => {
  const dur = (1.8 + idx * 0.31).toFixed(2);
  const del = (idx * 0.22).toFixed(2);
  return { d, dur, del };
});
const flowPathSet = new Set(flowPaths.map(x => x.d));
const staticMidPaths = midPaths.filter(d => !flowPathSet.has(d));

// ── SVG helpers ───────────────────────────────────────────────────────────────
const ps = arr => arr.map(d => `<path d="${d}"/>`).join('');

// ── Assemble SVG (parameterised so we can emit dark + light variants) ─────────
function buildSVG(isLight) {
  const pal = isLight ? {
    bg:       '#d0ecfa',
    ch:       '#004e70',  chOp:  '.14',
    cf:       '#006890',  cfOp:  '.26',
    cm:       '#0088b0',  cmOp:  '.55',
    cB:       '#0898c4',  cBOp:  '.88',
    cdFill:   '#0898c4',  cdO:   '.82',
    arcStr:   '#0898c4',
    flStr:    '#0088b0',
    poleC:    '#006fa0',  poleOpHi: '.38', poleOpLo: '.10',
  } : {
    bg:       '#000408',
    ch:       '#005a78',  chOp:  '.22',
    cf:       '#007898',  cfOp:  '.32',
    cm:       '#00aac8',  cmOp:  '.62',
    cB:       '#18e2f8',  cBOp:  '.95',
    cdFill:   '#18e2f8',  cdO:   '.90',
    arcStr:   '#18e2f8',
    flStr:    '#00aac8',
    poleC:    '#00d0ff',  poleOpHi: '.55', poleOpLo: '.14',
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${W} ${H}"
     preserveAspectRatio="xMidYMid slice"
     aria-hidden="true"
     role="presentation">
  <defs>
    <!-- Medium bloom: fills cell interiors (stdDeviation increased for stronger glow) -->
    <filter id="gm" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b"/>
      <feBlend in="SourceGraphic" in2="b" mode="screen"/>
    </filter>
    <!-- Large glow: halo around bright/arc edges -->
    <filter id="gl" x="-80%" y="-80%" width="260%" height="260%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="16" result="b"/>
      <feBlend in="SourceGraphic" in2="b" mode="screen"/>
    </filter>
    <!-- Edge pole glow gradients (left / right sides, like HL2 fence posts) -->
    <linearGradient id="pL" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="${pal.poleC}" stop-opacity="${pal.poleOpHi}"/>
      <stop offset="60%"  stop-color="${pal.poleC}" stop-opacity="${pal.poleOpLo}"/>
      <stop offset="100%" stop-color="${pal.poleC}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="pR" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0%"   stop-color="${pal.poleC}" stop-opacity="${pal.poleOpHi}"/>
      <stop offset="60%"  stop-color="${pal.poleC}" stop-opacity="${pal.poleOpLo}"/>
      <stop offset="100%" stop-color="${pal.poleC}" stop-opacity="0"/>
    </linearGradient>
    <style>
      @keyframes pulse  { 0%,100%{opacity:.72} 50%{opacity:1} }
      @keyframes poleP  { 0%,100%{opacity:.6}  50%{opacity:1} }
      @keyframes f1 { 0%,72%,100%{stroke-opacity:0} 74%{stroke-opacity:.95} 82%{stroke-opacity:.38} 86%{stroke-opacity:0} }
      @keyframes f2 { 0%,84%,100%{stroke-opacity:0} 86%{stroke-opacity:.95} 93%{stroke-opacity:.28} 97%{stroke-opacity:0} }
      @keyframes flow { from{stroke-dashoffset:0} to{stroke-dashoffset:-80} }
    </style>
  </defs>

  <!-- Background -->
  <rect fill="${pal.bg}" width="${W}" height="${H}"/>

  <!-- Left pole glow -->
  <rect fill="url(#pL)" x="0" y="0" width="${Math.round(W * 0.14)}" height="${H}"
        style="animation:poleP 2.8s ease-in-out 0s infinite"/>
  <!-- Right pole glow -->
  <rect fill="url(#pR)" x="${W - Math.round(W * 0.14)}" y="0" width="${Math.round(W * 0.14)}" height="${H}"
        style="animation:poleP 2.8s ease-in-out 1.4s infinite"/>

  <!-- Hairline texture (dashed faint lines, no glow) -->
  <g stroke="${pal.ch}" stroke-opacity="${pal.chOp}" fill="none"
     stroke-width=".65" stroke-dasharray="2.5 5">${ps(hairPaths)}</g>

  <!-- Faint structural lines -->
  <g stroke="${pal.cf}" stroke-opacity="${pal.cfOp}" fill="none"
     stroke-width="1.2">${ps(faintPaths)}</g>

  <!-- Mid structural lines — bloom glow pass -->
  <g stroke="${pal.cm}" stroke-opacity="${pal.cmOp}" fill="none"
     stroke-width="3.5" filter="url(#gm)"
     style="animation:pulse 3.2s ease-in-out .6s infinite">${ps(staticMidPaths)}</g>
  <!-- Mid structural lines — crisp core -->
  <g stroke="${pal.cm}" stroke-opacity="${pal.cmOp}" fill="none"
     stroke-width="1.2">${ps(staticMidPaths)}</g>

  <!-- Energy-flow animated dashed lines -->
  ${flowPaths.map(({ d, dur, del }) =>
    `<path stroke="${pal.flStr}" stroke-opacity=".55" fill="none" stroke-width="1.6"
       stroke-dasharray="16 24" stroke-linecap="round" d="${d}"
       style="animation:flow ${dur}s ${del}s linear infinite"/>`
  ).join('\n  ')}

  <!-- Bright charged edges — wide glow pass -->
  <g stroke="${pal.cB}" stroke-opacity="${pal.cBOp}" fill="none"
     stroke-width="6" filter="url(#gl)"
     style="animation:pulse 3.2s ease-in-out 0s infinite">${ps(brightPaths)}</g>
  <!-- Bright charged edges — medium glow pass -->
  <g stroke="${pal.cB}" stroke-opacity="${pal.cBOp}" fill="none"
     stroke-width="2.5" filter="url(#gm)"
     style="animation:pulse 3.2s ease-in-out 0s infinite">${ps(brightPaths)}</g>
  <!-- Bright charged edges — crisp core -->
  <g stroke="${pal.cB}" stroke-opacity="${pal.cBOp}" fill="none"
     stroke-width="1.4"
     style="animation:pulse 3.2s ease-in-out 0s infinite">${ps(brightPaths)}</g>

  <!-- Vertex dots -->
  <g fill="${pal.cdFill}" fill-opacity="${pal.cdO}">${dotEls.join('')}</g>

  <!-- Arc flash crackle (brief bright flashes on random bright edges) -->
  ${arcPaths.map((d, i) => {
    const anim = i % 2 === 0 ? 'f1' : 'f2';
    const dur  = (2.6 + i * 0.48).toFixed(2);
    const del  = (i * 0.41).toFixed(2);
    return `<path stroke="${pal.arcStr}" stroke-opacity="0" fill="none" stroke-width="3.5"
       filter="url(#gl)" d="${d}"
       style="animation:${anim} ${dur}s ${del}s ease-in infinite"/>`;
  }).join('\n  ')}
</svg>`;
}

// Write dark (default) and light variants
const darkSVG  = buildSVG(false);
const lightSVG = buildSVG(true);
writeFileSync(resolve(__dirname, '../public/icons/crackle.svg'),       darkSVG,  'utf8');
writeFileSync(resolve(__dirname, '../public/icons/crackle-light.svg'), lightSVG, 'utf8');

const kb = (darkSVG.length / 1024).toFixed(1);
console.log(`✓ crackle.svg + crackle-light.svg — ${kb} kB each`);
console.log(`  ${nodes.length} nodes | ${allEdges5.length} structural + ${hairEdges.length} hairline edges`);
console.log(`  ${brightPaths.length} bright (${((brightPaths.length/allEdges5.length)*100).toFixed(0)}%), ${midPaths.length} mid, ${faintPaths.length} faint`);
