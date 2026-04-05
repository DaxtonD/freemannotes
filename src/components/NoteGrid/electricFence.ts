/**
 * Half-Life 2 Combine electric fence / force-field animation engine.
 *
 * Visual replication of ElectricFence2.png (in-game crackle field):
 *   Nodes placed on a JITTERED GRID (cell size ~28 px) so the pattern fills
 *    the entire canvas with uniform Voronoi-like cell density.
 *   K-NEAREST-NEIGHBOR edges (K = 5) triangulate the jitter grid, reproducing
 *    the HL2 cell pattern without any explicit Delaunay pass.
 *   THREE-PASS BATCHED edge rendering (bloom / glow / core) using 4
 *    brightness-bucketed stroke calls per pass.  Wide bloom from adjacent edges
 *    overlaps inside each cell, creating the filled-glow look from the game.
 *   LEFT / RIGHT POLE GLOW: pulsing gradient strips represent HL2 fence posts.
 *   LOCAL ARC CRACKLE: occasional zigzag bolts along existing edges.
 *   Light-theme variant uses a pale arctic-blue palette.
 *
 * Performance:
 *   ~12 stroke() calls total per frame regardless of edge count.
 *   No per-node radial gradients; glow comes from edge bloom overlap.
 *   Edge topology recomputed once every 2500 ms.
 *   Shared RAF loop in ElectricFenceShimmer.tsx.
 */

export type Vec2 = { x: number; y: number };

export type FenceNode = {
x: number;
y: number;
homeX: number;
homeY: number;
vx: number;
vy: number;
phase: number;
phaseSpeed: number;
size: number;
};

export type FenceArc = {
pts: Vec2[];
t: number;
duration: number;
intensity: number;
};

export type FenceState = {
nodes: FenceNode[];
edges: [number, number][];
edgesAge: number;
arcs: FenceArc[];
W: number;
H: number;
arcCooldown: number;
totalTime: number;
};

//  Tuning 

const CELL_SIZE = 28;
const K_NEAR = 5;
const DRIFT_RADIUS = 9;
const DRIFT_SPEED = 13;
const EDGE_RECOMPUTE_MS = 2500;

//  Helpers 

function rnd(lo: number, hi: number): number {
return lo + Math.random() * (hi - lo);
}

function zigzag(a: Vec2, b: Vec2, segs: number): Vec2[] {
const dx = b.x - a.x;
const dy = b.y - a.y;
const len = Math.hypot(dx, dy);
if (len < 1) return [{ ...a }, { ...b }];
const px = -dy / len;
const py = dx / len;
const pts: Vec2[] = [{ ...a }];
for (let i = 1; i < segs; i++) {
const t = i / segs;
const off = (Math.random() - 0.5) * len * 0.24;
pts.push({ x: a.x + dx * t + px * off, y: a.y + dy * t + py * off });
}
pts.push({ ...b });
return pts;
}

function knnEdges(nodes: FenceNode[], K: number): [number, number][] {
const seen = new Set<string>();
const result: [number, number][] = [];
for (let i = 0; i < nodes.length; i++) {
const dists: { j: number; d2: number }[] = [];
for (let j = 0; j < nodes.length; j++) {
if (j === i) continue;
const dx = nodes[i].x - nodes[j].x;
const dy = nodes[i].y - nodes[j].y;
dists.push({ j, d2: dx * dx + dy * dy });
}
dists.sort((a, b) => a.d2 - b.d2);
for (let k = 0; k < Math.min(K, dists.length); k++) {
const j = dists[k].j;
const key = i < j ? `${i}:${j}` : `${j}:${i}`;
if (!seen.has(key)) { seen.add(key); result.push([i, j]); }
}
}
return result;
}

//  Public API 

export function createFenceState(W: number, H: number): FenceState {
const w = Math.max(W, 40);
const h = Math.max(H, 40);

const cols = Math.ceil(w / CELL_SIZE) + 2;
const rows = Math.ceil(h / CELL_SIZE) + 2;
const cellW = w / (cols - 2);
const cellH = h / (rows - 2);

const nodes: FenceNode[] = [];
for (let r = 0; r < rows; r++) {
for (let c = 0; c < cols; c++) {
const hx = (c - 0.5) * cellW;
const hy = (r - 0.5) * cellH;
nodes.push({
x: hx + rnd(-cellW * 0.40, cellW * 0.40),
y: hy + rnd(-cellH * 0.40, cellH * 0.40),
homeX: hx,
homeY: hy,
vx: rnd(-DRIFT_SPEED, DRIFT_SPEED),
vy: rnd(-DRIFT_SPEED, DRIFT_SPEED),
phase: Math.random() * Math.PI * 2,
phaseSpeed: rnd(0.4, 1.8) / 1000,
size: rnd(1.3, 2.2),
});
}
}

return {
nodes,
edges: knnEdges(nodes, K_NEAR),
edgesAge: 0,
arcs: [],
W: w,
H: h,
arcCooldown: rnd(200, 800),
totalTime: 0,
};
}

export function tickFence(state: FenceState, dt: number): void {
const { nodes } = state;
state.totalTime += dt;

for (const nd of nodes) {
nd.x += nd.vx * (dt / 1000);
nd.y += nd.vy * (dt / 1000);
nd.phase += nd.phaseSpeed * dt;

const dx = nd.x - nd.homeX;
const dy = nd.y - nd.homeY;
const d = Math.hypot(dx, dy);
if (d > 0.5) {
const spring = Math.max(0, (d - DRIFT_RADIUS * 0.4) / DRIFT_RADIUS);
nd.vx -= (dx / d) * DRIFT_SPEED * spring * 0.4;
nd.vy -= (dy / d) * DRIFT_SPEED * spring * 0.4;
}
nd.vx *= 0.998;
nd.vy *= 0.998;
}

state.edgesAge += dt;
if (state.edgesAge > EDGE_RECOMPUTE_MS) {
state.edgesAge = 0;
state.edges = knnEdges(nodes, K_NEAR);
}

for (let i = state.arcs.length - 1; i >= 0; i--) {
state.arcs[i].t += dt;
if (state.arcs[i].t >= state.arcs[i].duration) state.arcs.splice(i, 1);
}

state.arcCooldown -= dt;
if (state.arcCooldown <= 0 && state.edges.length > 0 && state.arcs.length < 4) {
state.arcCooldown = rnd(140, 600);
const edge = state.edges[Math.floor(Math.random() * state.edges.length)];
const [ei, ej] = edge;
const len = Math.hypot(nodes[ei].x - nodes[ej].x, nodes[ei].y - nodes[ej].y);
state.arcs.push({
pts: zigzag(nodes[ei], nodes[ej], Math.max(3, Math.ceil(len / 9))),
t: 0,
duration: rnd(80, 230),
intensity: rnd(0.55, 1.0),
});
}
}

export function drawFence(
ctx: CanvasRenderingContext2D,
state: FenceState,
W: number,
H: number,
isLight: boolean,
): void {
const { nodes, edges, arcs, totalTime } = state;

const bg     = isLight ? 'rgba(210,238,252,0.97)' : 'rgba(0,4,12,0.96)';
const eBloom = isLight ? '0,75,138'    : '0,140,218';
const eMid   = isLight ? '0,100,168'   : '0,188,238';
const eCore  = isLight ? '8,132,210'   : '0,230,255';
const nColor = isLight ? '0,135,215'   : '75,244,255';
const poleC  = isLight ? '0,118,195'   : '0,208,255';
const arcC   = isLight ? '155,218,245' : '202,248,255';
const arcG   = isLight ? '0,100,168'   : '0,162,238';

ctx.clearRect(0, 0, W, H);
ctx.fillStyle = bg;
ctx.fillRect(0, 0, W, H);

const bri = nodes.map((nd) => Math.sin(nd.phase) * 0.5 + 0.5);

// Pole glow
const pt = totalTime / 650;
const pa = (isLight ? 0.20 : 0.35) * (0.60 + 0.40 * Math.sin(pt));
const pw = Math.max(8, Math.round(W * 0.06));
const lg = ctx.createLinearGradient(0, 0, pw, 0);
lg.addColorStop(0,    `rgba(${poleC},${Math.min(0.98, pa * 1.6)})`);
lg.addColorStop(0.55, `rgba(${poleC},${pa * 0.30})`);
lg.addColorStop(1,    `rgba(${poleC},0)`);
ctx.fillStyle = lg;
ctx.fillRect(0, 0, pw, H);
const rg = ctx.createLinearGradient(W, 0, W - pw, 0);
rg.addColorStop(0,    `rgba(${poleC},${Math.min(0.98, pa * 1.6)})`);
rg.addColorStop(0.55, `rgba(${poleC},${pa * 0.30})`);
rg.addColorStop(1,    `rgba(${poleC},0)`);
ctx.fillStyle = rg;
ctx.fillRect(W - pw, 0, pw, H);

ctx.lineCap = 'round';
ctx.lineJoin = 'round';

// Brightness buckets
const buckets: [number, number][][] = [[], [], [], []];
for (const edge of edges) {
const b = Math.max(bri[edge[0]], bri[edge[1]]);
buckets[Math.min(3, Math.floor(b * 4))].push(edge);
}

// Wide bloom pass
ctx.lineWidth = isLight ? 16 : 20;
for (let b = 1; b < 4; b++) {
const bucket = buckets[b];
if (!bucket.length) continue;
const bv = (b + 0.5) / 4;
ctx.strokeStyle = `rgba(${eBloom},${(isLight ? 0.055 : 0.095) * bv})`;
ctx.beginPath();
for (const [i, j] of bucket) {
ctx.moveTo(nodes[i].x, nodes[i].y);
ctx.lineTo(nodes[j].x, nodes[j].y);
}
ctx.stroke();
}

// Medium glow pass
ctx.lineWidth = 4.5;
for (let b = 1; b < 4; b++) {
const bucket = buckets[b];
if (!bucket.length) continue;
const bv = (b + 0.5) / 4;
ctx.strokeStyle = `rgba(${eMid},${(isLight ? 0.13 : 0.24) * bv})`;
ctx.beginPath();
for (const [i, j] of bucket) {
ctx.moveTo(nodes[i].x, nodes[i].y);
ctx.lineTo(nodes[j].x, nodes[j].y);
}
ctx.stroke();
}

// Bright core pass
ctx.lineWidth = 1.1;
for (let b = 0; b < 4; b++) {
const bucket = buckets[b];
if (!bucket.length) continue;
const bv = (b + 0.5) / 4;
ctx.strokeStyle = `rgba(${eCore},${(isLight ? 0.50 : 0.80) * bv})`;
ctx.beginPath();
for (const [i, j] of bucket) {
ctx.moveTo(nodes[i].x, nodes[i].y);
ctx.lineTo(nodes[j].x, nodes[j].y);
}
ctx.stroke();
}

// Node dots
for (let k = 0; k < nodes.length; k++) {
const nd = nodes[k];
const b = bri[k];
if (b < 0.08) continue;
ctx.fillStyle = `rgba(${nColor},${(isLight ? 0.68 : 0.90) * b})`;
ctx.beginPath();
ctx.arc(nd.x, nd.y, nd.size * (0.5 + 0.5 * b), 0, Math.PI * 2);
ctx.fill();
}

// Arc flashes
for (const arc of arcs) {
const env = arc.intensity * Math.sin((arc.t / arc.duration) * Math.PI);
if (env <= 0.02) continue;
const { pts } = arc;
ctx.strokeStyle = `rgba(${arcG},${(isLight ? 0.22 : 0.32) * env})`;
ctx.lineWidth = 5.5;
ctx.beginPath();
ctx.moveTo(pts[0].x, pts[0].y);
for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
ctx.stroke();
ctx.strokeStyle = `rgba(${arcC},${0.92 * env})`;
ctx.lineWidth = 0.9;
ctx.beginPath();
ctx.moveTo(pts[0].x, pts[0].y);
for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
ctx.stroke();
}
}