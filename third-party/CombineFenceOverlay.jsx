// CombineFenceOverlay.jsx
//
// Drop over any `position: relative` card. Fully transparent — the parent
// card's background-color shows through as the theme colour.
//
// Usage:
//   <div style={{ position: "relative", backgroundColor: "#0d1618" }}>
//     <YourNoteCard />
//     <CombineFenceOverlay visible={isLoading} />
//   </div>
//
// Tested across card heights 320 px – 1420 px.

import { useEffect, useRef } from "react";

// ─── tunables ─────────────────────────────────────────────────────────────
const CELL_PX     = 44;   // crackle grid pitch (px)
const EDGE_FRAC   = 0.34; // flame canvas width as fraction of card width
const EDGE_MAX_PX = 110;  // flame canvas max width (px)
const STRIP_PX    = 6;    // emitter strip thickness (px)
const SEGMENT_H   = 28;   // lit segment height for repeating strip (px)
const GAP_H       = 8;    // dark gap height for repeating strip (px)
const OVF         = 60;   // canvas overflow above & below card (px) — prevents
                           // hard clipping of tongues near the top/bottom edges

// ─── CombineFenceOverlay ──────────────────────────────────────────────────
export function CombineFenceOverlay({ visible = true }) {
  const rootRef    = useRef(null);
  const crackleRef = useRef(null);
  const flameLRef  = useRef(null);
  const flameRRef  = useRef(null);
  const rafRef     = useRef(null);
  const stateRef   = useRef(null);

  useEffect(() => {
    if (!visible) return;

    const root  = rootRef.current;
    const crCv  = crackleRef.current;
    const flLCv = flameLRef.current;
    const flRCv = flameRRef.current;
    if (!root || !crCv || !flLCv || !flRCv) return;

    const W  = root.offsetWidth;
    const H  = root.offsetHeight;
    const EW = Math.round(Math.min(EDGE_MAX_PX, W * EDGE_FRAC));

    // Crackle canvas — exactly card size
    crCv.width  = W;
    crCv.height = H;

    // Flame canvases — extend OVF px above & below so gradients near the
    // card edges fade out naturally rather than being hard-cut
    const FH = H + OVF * 2;
    flLCv.width  = EW; flLCv.height = FH;
    flRCv.width  = EW; flRCv.height = FH;

    // ── crackle mesh — geometry is fixed, only alpha animates ─────────
    const cols = Math.ceil(W / CELL_PX) + 2;
    const rows = Math.ceil(H / CELL_PX) + 2;
    const pts  = [];

    for (let i = -1; i <= cols; i++) {
      for (let j = -1; j <= rows; j++) {
        pts.push({
          x: (i + 0.5) * CELL_PX + (Math.random() - 0.5) * CELL_PX * 0.88,
          y: (j + 0.5) * CELL_PX + (Math.random() - 0.5) * CELL_PX * 0.88,
        });
      }
    }

    const maxD2 = (CELL_PX * 1.72) ** 2;
    const edges = [];

    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        if (dx * dx + dy * dy < maxD2) {
          edges.push({
            ax: pts[i].x, ay: pts[i].y,
            bx: pts[j].x, by: pts[j].y,
            mx: (pts[i].x + pts[j].x) / 2 + (Math.random() - 0.5) * 12,
            my: (pts[i].y + pts[j].y) / 2 + (Math.random() - 0.5) * 12,
            phase:     Math.random() * Math.PI * 2,
            freq:      0.35 + Math.random() * 1.6,
            baseAlpha: 0.18 + Math.random() * 0.65,
          });
        }
      }
    }

    // ── flame tongues — horizontal, count scales with height ──────────
    // y positions are in canvas-space (0 = OVF px above card top)
    const numTongues = Math.max(14, Math.ceil(H / 55));

    const makeTongues = () =>
      Array.from({ length: numTongues }, () => ({
        // spread across full canvas height including overflow band
        y:         Math.random() * FH,
        freq:      0.5 + Math.random() * 2.4,   // reach oscillation speed
        freqA:     0.7 + Math.random() * 1.8,   // alpha oscillation speed
        phase:     Math.random() * Math.PI * 2,
        phaseA:    Math.random() * Math.PI * 2,
        baseReach: EW * (0.45 + Math.random() * 1.35), // can extend well past EW
        maxAlpha:  0.42 + Math.random() * 0.52,
      }));

    stateRef.current = {
      edges,
      tonguesL: makeTongues(),
      tonguesR: makeTongues(),
      W, H, FH, EW,
    };

    const ctxC = crCv.getContext("2d");
    const ctxL = flLCv.getContext("2d");
    const ctxR = flRCv.getContext("2d");
    const t0   = performance.now();

    const draw = (now) => {
      const t = (now - t0) / 1000;
      const { edges, tonguesL, tonguesR, W, H, FH, EW } = stateRef.current;

      // ── crackle ───────────────────────────────────────────────────────
      ctxC.clearRect(0, 0, W, H);

      for (const e of edges) {
        const fl    = (1 + Math.sin(t * e.freq + e.phase)) * 0.5;
        const alpha = e.baseAlpha * (0.05 + 0.95 * fl);
        if (alpha < 0.022) continue;

        const bright = alpha > 0.54;
        ctxC.strokeStyle = bright
          ? `rgba(140,248,255,${alpha.toFixed(2)})`
          : `rgba(0,212,230,${alpha.toFixed(2)})`;
        ctxC.lineWidth   = bright ? 1.35 : 0.65;
        ctxC.shadowColor = `rgba(0,220,242,${(alpha * 0.48).toFixed(2)})`;
        ctxC.shadowBlur  = bright ? 6 : 2.5;

        ctxC.beginPath();
        ctxC.moveTo(e.ax, e.ay);
        ctxC.lineTo(e.mx, e.my);
        ctxC.lineTo(e.bx, e.by);
        ctxC.stroke();
      }

      // rare bright arc spark
      if (Math.random() < 0.038) {
        const e = edges[Math.floor(Math.random() * edges.length)];
        ctxC.save();
        ctxC.strokeStyle = "rgba(225,255,255,0.97)";
        ctxC.lineWidth   = 2.2;
        ctxC.shadowColor = "#aaffff";
        ctxC.shadowBlur  = 24;
        ctxC.beginPath();
        ctxC.moveTo(e.ax, e.ay);
        ctxC.lineTo(e.bx, e.by);
        ctxC.stroke();
        ctxC.restore();
      }

      // ── flames ────────────────────────────────────────────────────────
      drawFlame(ctxL, EW, FH, /* fromLeft */ true,  t, tonguesL);
      drawFlame(ctxR, EW, FH, /* fromLeft */ false, t, tonguesR);

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [visible]);

  if (!visible) return null;

  return (
    <div ref={rootRef} style={S.root}>
      <style>{KEYFRAMES}</style>

      {/* Flame canvases sit OVF px above the card top — no overflow:hidden
          on this root div, so they bleed softly at top/bottom             */}
      <canvas
        ref={flameLRef}
        style={{ ...S.flameCanvas, left: 0, top: -OVF }}
      />
      <canvas
        ref={crackleRef}
        style={{ ...S.crackleCanvas }}
      />
      <canvas
        ref={flameRRef}
        style={{ ...S.flameCanvas, right: 0, top: -OVF }}
      />

      {/* Segmented emitter strips */}
      <div style={{ ...S.strip, left:  0, animation: "hl2SL 1.9s ease-in-out infinite alternate" }} />
      <div style={{ ...S.strip, right: 0, animation: "hl2SR 2.3s ease-in-out infinite alternate-reverse" }} />
    </div>
  );
}

// ─── flame renderer ───────────────────────────────────────────────────────
// Tongues radiate horizontally from the strip edge inward toward center.
// fromLeft=true  → anchor at x=0, tongues extend rightward
// fromLeft=false → anchor at x=EW, tongues extend leftward
function drawFlame(ctx, W, H, fromLeft, t, tongues) {
  ctx.clearRect(0, 0, W, H);

  // Constant base glow — always present at the strip face
  const gx0 = fromLeft ? 0 : W;
  const gx1 = fromLeft ? W : 0;
  const bg   = ctx.createLinearGradient(gx0, 0, gx1, 0);
  bg.addColorStop(0.00, "rgba(0,195,228,0.38)");
  bg.addColorStop(0.30, "rgba(0,172,210,0.11)");
  bg.addColorStop(1.00, "rgba(0,0,0,0)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Individual tongues
  for (const tongue of tongues) {
    // reach breathes in and out
    const reach = tongue.baseReach *
      (0.20 + 0.80 * (0.5 + 0.5 * Math.sin(t * tongue.freq + tongue.phase)));
    if (reach < 3) continue;

    const alpha = tongue.maxAlpha *
      (0.12 + 0.88 * (0.5 + 0.5 * Math.sin(t * tongue.freqA + tongue.phaseA)));
    if (alpha < 0.014) continue;

    const anchorX = fromLeft ? 0 : W;

    // Horizontally elongated by scaling x-axis — makes tongues look like
    // fire licks rather than round blobs
    const xStretch = 1.70;
    ctx.save();
    ctx.scale(xStretch, 1);

    const ax = anchorX / xStretch;
    const r  = reach   / xStretch;

    const g = ctx.createRadialGradient(ax, tongue.y, 0, ax, tongue.y, r);
    g.addColorStop(0.00, `rgba(225,255,255,${alpha.toFixed(2)})`);
    g.addColorStop(0.10, `rgba(0,235,255,${(alpha * 0.90).toFixed(2)})`);
    g.addColorStop(0.40, `rgba(0,190,220,${(alpha * 0.38).toFixed(2)})`);
    g.addColorStop(1.00, "rgba(0,150,185,0)");

    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W / xStretch, H);
    ctx.restore();
  }
}

// ─── static styles ────────────────────────────────────────────────────────
const S = {
  root: {
    position:      "absolute",
    inset:         0,
    // NO overflow:hidden — flame canvases extend OVF px beyond top/bottom
    // and are allowed to fade out naturally
    pointerEvents: "none",
    zIndex:        10,
    // NO background — parent card's backgroundColor is the theme colour
  },
  flameCanvas: {
    position: "absolute",
    // top is set inline to -OVF; bottom is not set (height comes from canvas attr)
  },
  crackleCanvas: {
    position: "absolute",
    inset:    0,
  },
  strip: {
    position:   "absolute",
    top:        0,
    bottom:     0,
    width:      `${STRIP_PX}px`,
    background: `repeating-linear-gradient(
      to bottom,
      rgba(218,255,255,0.97) 0px,
      rgba(82,235,252,0.93)  ${SEGMENT_H}px,
      rgba(0,78,100,0.76)    ${SEGMENT_H}px,
      rgba(0,48,66,0.88)     ${SEGMENT_H + GAP_H}px
    )`,
    boxShadow: `
      0 0 10px  5px rgba(0,208,232,0.72),
      0 0 30px 14px rgba(0,162,192,0.36)
    `,
  },
};

const KEYFRAMES = `
  @keyframes hl2SL {
    0%  { opacity: 1.00; }
    40% { opacity: 0.70; }
    100%{ opacity: 0.88; }
  }
  @keyframes hl2SR {
    0%  { opacity: 0.85; }
    55% { opacity: 0.62; }
    100%{ opacity: 0.95; }
  }
`;


// ═══════════════════════════════════════════════════════════════════════════
// DEMO — delete everything below when integrating into your app
// ═══════════════════════════════════════════════════════════════════════════

const DEMO_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh; background: #060b0e;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 28px; padding: 40px 20px;
    font-family: 'Share Tech Mono', monospace;
  }
  .lbl {
    font-family: 'Orbitron', sans-serif; font-size: 9px; font-weight: 600;
    letter-spacing: .28em; text-transform: uppercase;
    color: rgba(0,200,220,.45); text-align: center;
  }
  .row { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; justify-content: center; }
  .card {
    position: relative;
    overflow: hidden;           /* ← your card clips the OVF bleed, which is fine */
    width: 210px;
    background: #0c1518;
    border: 1px solid rgba(0,150,175,.20);
    border-radius: 3px; padding: 14px;
  }
  .ct {
    font-family: 'Orbitron', sans-serif; font-size: 10px; font-weight: 600;
    color: rgba(0,215,238,.88); margin-bottom: 8px; letter-spacing: .10em;
  }
  .cb { color: rgba(0,190,215,.62); font-size: 11px; line-height: 1.78; white-space: pre-line; }
  .btn {
    font-family: 'Orbitron', sans-serif; font-size: 8px; font-weight: 600;
    letter-spacing: .22em; text-transform: uppercase;
    color: rgba(0,205,228,.78); background: transparent;
    border: 1px solid rgba(0,172,200,.32); padding: 8px 22px;
    cursor: pointer; transition: all .18s;
  }
  .btn:hover { background: rgba(0,152,178,.12); border-color: rgba(0,210,235,.65); color: #00e8ff; }
`;

const CARDS = [
  {
    h: 320, title: "SECTOR 17",
    body: "Citadel power grid nominal. No anomalies detected in the perimeter.",
  },
  {
    h: 560, title: "PRISONER LOG",
    body: "Subject 49182 transferred to processing.\nCompliance: 94%.\nReassignment pending council review.\nPsych profile attached.",
  },
  {
    h: 900, title: "FIELD REPORT",
    body: "Checkpoint Bravo reports increased Resistance activity along the canal route.\n\nRecommend additional scanner deployment in sectors 4-F through 6-J. Units await orders from sector command.\n\nCasualty count within parameters per Directive 8-C.",
  },
];

import { useState } from "react";

export default function Demo() {
  const [on, setOn] = useState(true);
  return (
    <>
      <style>{DEMO_CSS}</style>
      <p className="lbl">CombineFenceOverlay · 320 px / 560 px / 900 px</p>
      <div className="row">
        {CARDS.map(({ h, title, body }) => (
          <div key={title} className="card" style={{ minHeight: h }}>
            <p className="ct">{title}</p>
            <p className="cb">{body}</p>
            <CombineFenceOverlay visible={on} />
          </div>
        ))}
      </div>
      <button className="btn" onClick={() => setOn(v => !v)}>
        {on ? "▶ dismiss overlay" : "◀ show overlay"}
      </button>
    </>
  );
}
