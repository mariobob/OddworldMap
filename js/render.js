// Canvas rendering: cameras, overlays, markers, and the image caches.

import { formatDist } from "./util.js";
import { CACHE_MAX_IMAGES, CONN_COLORS, FLASH_MS, LINE_COLORS, catOf } from "./config.js";
import { $, cv, ctx, cssVar } from "./dom.js";
import { state, GEO, CELL_W, CELL_H, dX, dY } from "./state.js";
import { computeConnections } from "./model.js";

// canvas colors shared with the stylesheet, read once from the tokens
const COLOR = {
  bg: cssVar("--bg"),
  mapBg: cssVar("--map-bg"),
  mapBgRgb: cssVar("--map-bg-rgb"),
  cellEmpty: cssVar("--cell-empty"),
  accentRgb: cssVar("--accent-rgb"),
};

const images = {}; // png -> Image
function img(src) {
  if (!images[src]) {
    const im = new Image();
    im.src = src;
    im.onload = scheduleDraw;
    images[src] = im;
  }
  return images[src];
}

const tintCache = {};
function tintedImg(src) {
  if (tintCache[src]) return tintCache[src];
  const im = img(src);
  if (!im.complete || !im.naturalWidth) return null; // retried next draw
  const oc = document.createElement("canvas");
  oc.width = im.naturalWidth;
  oc.height = im.naturalHeight;
  const octx = oc.getContext("2d");
  octx.drawImage(im, 0, 0);
  octx.globalCompositeOperation = "source-in";
  octx.fillStyle = "#ff4fd8";
  octx.fillRect(0, 0, oc.width, oc.height);
  tintCache[src] = oc;
  return oc;
}

// a long browse would pin every visited cam's compressed PNG (and tint canvas)
// for the session; once past the cap, drop what the new path doesn't reference
window.addEventListener("selection-changed", () => {
  if (Object.keys(images).length <= CACHE_MAX_IMAGES) return;
  const keep = new Set();
  for (const c of state.path.cams) {
    if (c.png) keep.add(c.png);
    if (c.fg) keep.add(c.fg);
  }
  for (const src of Object.keys(images)) {
    if (keep.has(src)) continue;
    images[src].onload = null; // in-flight loads must not repaint after eviction
    delete images[src];
    delete tintCache[src];
  }
});

// follow-destination highlight: a fading ring at (x, y) in draw space. A held
// flash (object permalink) pulses at full strength until the normal timeout
// has passed AND the user has interacted.
let flash = null; // {x, y, t0, hold}
let flashInteracted = false;
for (const ev of ["pointerdown", "wheel", "keydown"])
  window.addEventListener(
    ev,
    () => {
      flashInteracted = true;
    },
    { capture: true, passive: true },
  );

export function flashAt(x, y, hold = false) {
  flash = { x, y, t0: performance.now(), hold };
  flashInteracted = false;
  animateFlash();
}

function animateFlash() {
  if (!flash) return;
  if (flash.hold) {
    if (performance.now() - flash.t0 > FLASH_MS && flashInteracted) {
      flash.hold = false;
      flash.t0 = performance.now(); // released: fade out from here
    }
  } else if (performance.now() - flash.t0 > FLASH_MS) {
    flash = null;
    draw();
    return;
  }
  draw();
  requestAnimationFrame(animateFlash);
}

// connection edges, computed lazily and keyed by path object identity —
// selection-changed alone won't do: it re-fires for the same path on every
// pushed hash write
let connCache = { path: null, edges: null };

// hovered followable object: its connection edges render emphasized while
// the rest dim, so one object's circulation reads out of a dense path
let connFocus = null;
export function setConnFocus(t) {
  if (connFocus === t) return;
  connFocus = t;
  scheduleDraw();
}
window.addEventListener("selection-changed", () => {
  connFocus = null;
});

// pointed-at object: a dashed outline around one TLV, for hover affordances
// that reference an object without selecting it (camera-panel rows, a hovered
// door's partner)
let highlight = null;
export function setHighlight(t) {
  if (highlight === t) return;
  highlight = t;
  scheduleDraw();
}
window.addEventListener("selection-changed", () => setHighlight(null)); // TLVs don't outlive their path

// coalesce bursty redraw sources (pointer moves, image loads) into one paint per frame
let drawPending = false;
export function scheduleDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    draw();
  });
}

export function resize() {
  cv.width = cv.clientWidth * devicePixelRatio;
  cv.height = cv.clientHeight * devicePixelRatio;
  draw();
}
window.addEventListener("resize", resize); // catches devicePixelRatio changes, which leave the map box untouched
new ResizeObserver(resize).observe($("main")); // the sidebar slide resizes the map without a window resize

// filled arrowhead at (tx, ty) pointing along (dx, dy), h long in draw units
function arrowhead(tx, ty, dx, dy, h) {
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l,
    uy = dy / l;
  const bx = tx - h * ux,
    by = ty - h * uy;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(bx - 0.45 * h * uy, by + 0.45 * h * ux);
  ctx.lineTo(bx + 0.45 * h * uy, by - 0.45 * h * ux);
  ctx.closePath();
  ctx.fill();
}

export function draw() {
  if (!state.path) {
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, cv.width, cv.height);
    return;
  }
  const { cam, path, show, ruler, route } = state;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.fillStyle = COLOR.mapBg;
  ctx.fillRect(0, 0, cv.clientWidth, cv.clientHeight);
  ctx.save();
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.x, -cam.y);

  // cameras
  ctx.imageSmoothingEnabled = cam.z < 1;
  for (const c of path.cams) {
    const cx = (c.cell % path.w) * CELL_W,
      cy = Math.floor(c.cell / path.w) * CELL_H;
    if (c.png) {
      const im = img(c.png);
      if (im.complete && im.naturalWidth) {
        ctx.globalAlpha = show.dim ? 0.35 : 1;
        // source is 384px wide (24 MDEC macroblocks); only the first 368 columns are real
        ctx.drawImage(im, 0, 0, CELL_W, CELL_H, cx, cy, CELL_W, CELL_H);
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.fillStyle = COLOR.cellEmpty;
      ctx.fillRect(cx, cy, CELL_W, CELL_H);
    }
  }

  // foreground occlusion masks, tinted so they stand out from the identical background art
  if (show.fg) {
    for (const c of path.cams) {
      if (!c.fg) continue;
      const t = tintedImg(c.fg);
      if (!t) continue;
      const cx = (c.cell % path.w) * CELL_W,
        cy = Math.floor(c.cell / path.w) * CELL_H;
      ctx.globalAlpha = 0.6;
      ctx.drawImage(t, cx, cy, CELL_W, CELL_H);
      ctx.globalAlpha = 1;
    }
  }

  // grid + names
  if (show.grid) {
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 1.5 / cam.z;
    for (let gx = 0; gx <= path.w; gx++) {
      ctx.beginPath();
      ctx.moveTo(gx * CELL_W, 0);
      ctx.lineTo(gx * CELL_W, path.h * CELL_H);
      ctx.stroke();
    }
    for (let gy = 0; gy <= path.h; gy++) {
      ctx.beginPath();
      ctx.moveTo(0, gy * CELL_H);
      ctx.lineTo(path.w * CELL_W, gy * CELL_H);
      ctx.stroke();
    }
    if (CELL_W * cam.z > 90) {
      ctx.fillStyle = "rgba(255,255,255,.8)";
      ctx.font = `${12 / cam.z}px sans-serif`;
      ctx.shadowColor = "rgba(0,0,0,.9)";
      ctx.shadowBlur = 3 / cam.z;
      for (const c of path.cams) {
        const cx = (c.cell % path.w) * CELL_W,
          cy = Math.floor(c.cell / path.w) * CELL_H;
        ctx.fillText(c.name, cx + 10, cy + 18 / cam.z);
      }
      ctx.shadowBlur = 0;
    }
  }

  // collision lines
  if (show.coll) {
    ctx.lineWidth = 2.5 / cam.z;
    for (const [x1, y1, x2, y2, t] of path.lines) {
      ctx.strokeStyle = LINE_COLORS[t] || "#999";
      ctx.setLineDash(t >= 4 ? [8 / cam.z, 6 / cam.z] : []);
      ctx.beginPath();
      ctx.moveTo(dX(x1), dY(y1));
      ctx.lineTo(dX(x2), dY(y2));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // TLVs
  const showLabels = show.labels && cam.z > 0.45;
  ctx.font = `${11 / cam.z}px sans-serif`;
  for (const t of path.tlvs) {
    const c = catOf(t);
    if (!c.on) continue;
    // far edge goes through the transform too: AE cells are scaled and AO
    // spans can cross cells, so raw world deltas overshoot
    const x1 = dX(t.x1),
      y1 = dY(t.y1);
    const w = Math.max(dX(t.x2) - x1, 10),
      h = Math.max(dY(t.y2) - y1, 10);
    ctx.strokeStyle = c.color;
    ctx.lineWidth = (t.name === "LCDStatusBoard" ? 3.5 : 2) / cam.z;
    ctx.strokeRect(x1, y1, w, h);
    ctx.fillStyle = c.color + "26";
    ctx.fillRect(x1, y1, w, h);
    if (showLabels) {
      ctx.fillStyle = c.color;
      ctx.fillText(t.name, x1, y1 - 3 / cam.z);
    }
  }

  // connection arrows: the path's circulation — curves between resolved
  // pairs (double-headed when mutual), dashed to a bare camera, and fixed
  // 45° labelled stubs for destinations on other paths
  if (show.conn) {
    if (connCache.path !== path)
      connCache = { path, edges: computeConnections(state.lvl, path, GEO) };
    const centre = (t) => [(dX(t.x1) + dX(t.x2)) / 2, (dY(t.y1) + dY(t.y2)) / 2];
    // focus only dims the rest when the hovered object actually has edges
    const focusActive =
      connFocus && connCache.edges.some((e) => e.src === connFocus || e.dst === connFocus);
    const headLen = 12 / cam.z;
    const stubLen = Math.min(Math.max(56 / cam.z, 60), 150);
    const S = Math.SQRT1_2;
    for (const e of connCache.edges) {
      if (!catOf(e.src).on) continue; // hidden markers keep their arrows hidden too
      const focused = focusActive && (e.src === connFocus || e.dst === connFocus);
      ctx.globalAlpha = focusActive ? (focused ? 0.95 : 0.15) : 0.65;
      ctx.lineWidth = (focused ? 3 : 2) / cam.z;
      ctx.strokeStyle = ctx.fillStyle = CONN_COLORS[e.src.name] || "#ffffff";
      const [sx, sy] = centre(e.src);
      if (e.label !== undefined) {
        // off-path stub: a constant diagonal reads as "leaves this path"
        // without pretending to know the direction
        const tx = sx + stubLen * S,
          ty = sy - stubLen * S;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        arrowhead(tx, ty, S, -S, Math.min(headLen, 0.25 * stubLen));
        if (showLabels) {
          ctx.shadowColor = "rgba(0,0,0,.9)";
          ctx.shadowBlur = 3 / cam.z;
          ctx.fillText(`→ ${e.label}`, tx + 8 / cam.z, ty - 4 / cam.z);
          ctx.shadowBlur = 0;
        }
        continue;
      }
      const [tx, ty] = e.dst
        ? centre(e.dst)
        : [((e.cell % path.w) + 0.5) * CELL_W, (Math.floor(e.cell / path.w) + 0.5) * CELL_H];
      const dx = tx - sx,
        dy = ty - sy;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      // control point to the left of travel: near-coincident reversed pairs
      // (stacked double doors) arc apart instead of overlapping
      const k = Math.min(Math.max(0.18 * len, 24), 110);
      const cpx = (sx + tx) / 2 - (dy / len) * k,
        cpy = (sy + ty) / 2 + (dx / len) * k;
      if (!e.dst) ctx.setLineDash([6 / cam.z, 5 / cam.z]); // camera, not exact object
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(cpx, cpy, tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      const h = Math.min(headLen, 0.25 * len);
      arrowhead(tx, ty, tx - cpx, ty - cpy, h); // the curve's end tangent is P2 − C
      if (e.twoWay) arrowhead(sx, sy, sx - cpx, sy - cpy, h);
    }
    ctx.globalAlpha = 1;
  }

  if (highlight) {
    // drawn even when the object's category is toggled off: the outline is
    // what locates a listed object whose marker is hidden
    const x1 = dX(highlight.x1),
      y1 = dY(highlight.y1);
    const w = Math.max(dX(highlight.x2) - x1, 10),
      h = Math.max(dY(highlight.y2) - y1, 10);
    const pad = 3 / cam.z;
    ctx.strokeStyle = `rgb(${COLOR.accentRgb})`;
    ctx.lineWidth = 2.5 / cam.z;
    ctx.setLineDash([7 / cam.z, 5 / cam.z]);
    ctx.strokeRect(x1 - pad, y1 - pad, w + 2 * pad, h + 2 * pad);
    ctx.setLineDash([]);
  }

  if (ruler) {
    const dx = ruler.x2 - ruler.x1,
      dy = ruler.y2 - ruler.y1;
    const len = Math.hypot(dx, dy);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2 / cam.z;
    ctx.setLineDash([6 / cam.z, 5 / cam.z]);
    ctx.beginPath();
    ctx.moveTo(ruler.x1, ruler.y1);
    ctx.lineTo(ruler.x2, ruler.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [ex, ey] of [
      [ruler.x1, ruler.y1],
      [ruler.x2, ruler.y2],
    ]) {
      ctx.beginPath();
      ctx.arc(ex, ey, 3.5 / cam.z, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }
    const label = `${Math.round(Math.abs(dx))} × ${Math.round(Math.abs(dy))} · ${formatDist(len)}`;
    ctx.font = `${13 / cam.z}px sans-serif`;
    const midx = (ruler.x1 + ruler.x2) / 2,
      midy = (ruler.y1 + ruler.y2) / 2 - 10 / cam.z;
    ctx.fillStyle = `rgba(${COLOR.mapBgRgb},.85)`;
    const tw = ctx.measureText(label).width;
    ctx.fillRect(midx - tw / 2 - 5 / cam.z, midy - 13 / cam.z, tw + 10 / cam.z, 18 / cam.z);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, midx - tw / 2, midy);
  }

  // route-planner polyline: solid accent (the ruler stays dashed white), a
  // ring on the start so a shared route reads direction, per-leg lengths
  if (route) {
    const col = `rgb(${COLOR.accentRgb})`;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 2.5 / cam.z;
    if (route.length > 1) {
      ctx.beginPath();
      ctx.moveTo(route[0].x, route[0].y);
      for (let i = 1; i < route.length; i++) ctx.lineTo(route[i].x, route[i].y);
      ctx.stroke();
    }
    for (const p of route) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5 / cam.z, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 2 / cam.z;
    ctx.beginPath();
    ctx.arc(route[0].x, route[0].y, 6.5 / cam.z, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = `${12 / cam.z}px sans-serif`;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1],
        b = route[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len * cam.z < 60) continue; // zoomed out, the labels would drown the route
      const label = formatDist(len);
      const midx = (a.x + b.x) / 2,
        midy = (a.y + b.y) / 2 - 10 / cam.z;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = `rgba(${COLOR.mapBgRgb},.85)`;
      ctx.fillRect(midx - tw / 2 - 5 / cam.z, midy - 12 / cam.z, tw + 10 / cam.z, 17 / cam.z);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, midx - tw / 2, midy);
    }
  }

  if (flash) {
    const el = performance.now() - flash.t0;
    const a = flash.hold ? 1 : Math.max(0, 1 - el / FLASH_MS);
    ctx.strokeStyle = `rgba(${COLOR.accentRgb},${a})`;
    ctx.lineWidth = 3.5 / cam.z;
    const r = (46 + 10 * Math.sin(el / 110)) / Math.sqrt(cam.z);
    ctx.beginPath();
    ctx.arc(flash.x, flash.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
