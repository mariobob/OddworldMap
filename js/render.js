// Canvas rendering: cameras, overlays, markers, and the image caches.

import { FLASH_MS, LINE_COLORS, catOf } from "./config.js";
import { $, cv, ctx, cssVar } from "./dom.js";
import { state, CELL_W, CELL_H, dX, dY } from "./state.js";

// canvas colors shared with the stylesheet, read once from the tokens
const COLOR = { bg: cssVar("--bg"), mapBg: cssVar("--map-bg"), mapBgRgb: cssVar("--map-bg-rgb"),
                cellEmpty: cssVar("--cell-empty"), accentRgb: cssVar("--accent-rgb") };

const images = {};   // png -> Image
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
  if (!im.complete || !im.naturalWidth) return null;   // retried next draw
  const oc = document.createElement("canvas");
  oc.width = im.naturalWidth; oc.height = im.naturalHeight;
  const octx = oc.getContext("2d");
  octx.drawImage(im, 0, 0);
  octx.globalCompositeOperation = "source-in";
  octx.fillStyle = "#ff4fd8";
  octx.fillRect(0, 0, oc.width, oc.height);
  tintCache[src] = oc;
  return oc;
}

// follow-destination highlight: a fading ring at (x, y) in draw space
let flash = null;   // {x, y, t0}
export function flashAt(x, y) {
  flash = { x, y, t0: performance.now() };
  animateFlash();
}

function animateFlash() {
  if (!flash) return;
  if (performance.now() - flash.t0 > FLASH_MS) { flash = null; draw(); return; }
  draw();
  requestAnimationFrame(animateFlash);
}

// coalesce bursty redraw sources (pointer moves, image loads) into one paint per frame
let drawPending = false;
export function scheduleDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => { drawPending = false; draw(); });
}

export function resize() {
  cv.width = cv.clientWidth * devicePixelRatio;
  cv.height = cv.clientHeight * devicePixelRatio;
  draw();
}
window.addEventListener("resize", resize);   // catches devicePixelRatio changes, which leave the map box untouched
new ResizeObserver(resize).observe($("main"));   // the sidebar slide resizes the map without a window resize

export function draw() {
  if (!state.path) { ctx.fillStyle = COLOR.bg; ctx.fillRect(0, 0, cv.width, cv.height); return; }
  const { cam, path, show, ruler } = state;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.fillStyle = COLOR.mapBg;
  ctx.fillRect(0, 0, cv.clientWidth, cv.clientHeight);
  ctx.save();
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.x, -cam.y);

  // cameras
  ctx.imageSmoothingEnabled = cam.z < 1;
  for (const c of path.cams) {
    const cx = (c.cell % path.w) * CELL_W, cy = Math.floor(c.cell / path.w) * CELL_H;
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
      const cx = (c.cell % path.w) * CELL_W, cy = Math.floor(c.cell / path.w) * CELL_H;
      ctx.globalAlpha = 0.6;
      ctx.drawImage(t, cx, cy, CELL_W, CELL_H);
      ctx.globalAlpha = 1;
    }
  }

  // grid + names
  if (show.grid) {
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 1.5 / cam.z;
    for (let gx = 0; gx <= path.w; gx++) { ctx.beginPath(); ctx.moveTo(gx * CELL_W, 0); ctx.lineTo(gx * CELL_W, path.h * CELL_H); ctx.stroke(); }
    for (let gy = 0; gy <= path.h; gy++) { ctx.beginPath(); ctx.moveTo(0, gy * CELL_H); ctx.lineTo(path.w * CELL_W, gy * CELL_H); ctx.stroke(); }
    if (CELL_W * cam.z > 90) {
      ctx.fillStyle = "rgba(255,255,255,.8)";
      ctx.font = `${12 / cam.z}px sans-serif`;
      ctx.shadowColor = "rgba(0,0,0,.9)"; ctx.shadowBlur = 3 / cam.z;
      for (const c of path.cams) {
        const cx = (c.cell % path.w) * CELL_W, cy = Math.floor(c.cell / path.w) * CELL_H;
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
      ctx.beginPath(); ctx.moveTo(dX(x1), dY(y1)); ctx.lineTo(dX(x2), dY(y2)); ctx.stroke();
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
    const x1 = dX(t.x1), y1 = dY(t.y1);
    const w = Math.max(dX(t.x2) - x1, 10), h = Math.max(dY(t.y2) - y1, 10);
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

  if (ruler) {
    const dx = ruler.x2 - ruler.x1, dy = ruler.y2 - ruler.y1;
    const len = Math.hypot(dx, dy);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2 / cam.z;
    ctx.setLineDash([6 / cam.z, 5 / cam.z]);
    ctx.beginPath(); ctx.moveTo(ruler.x1, ruler.y1); ctx.lineTo(ruler.x2, ruler.y2); ctx.stroke();
    ctx.setLineDash([]);
    for (const [ex, ey] of [[ruler.x1, ruler.y1], [ruler.x2, ruler.y2]]) {
      ctx.beginPath(); ctx.arc(ex, ey, 3.5 / cam.z, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill();
    }
    const label = `${Math.round(Math.abs(dx))} × ${Math.round(Math.abs(dy))} · ${Math.round(len)}u ≈ ${(len / 25).toFixed(1)} grid`;
    ctx.font = `${13 / cam.z}px sans-serif`;
    const midx = (ruler.x1 + ruler.x2) / 2, midy = (ruler.y1 + ruler.y2) / 2 - 10 / cam.z;
    ctx.fillStyle = `rgba(${COLOR.mapBgRgb},.85)`;
    const tw = ctx.measureText(label).width;
    ctx.fillRect(midx - tw / 2 - 5 / cam.z, midy - 13 / cam.z, tw + 10 / cam.z, 18 / cam.z);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, midx - tw / 2, midy);
  }

  if (flash) {
    const el = performance.now() - flash.t0;
    const a = Math.max(0, 1 - el / FLASH_MS);
    ctx.strokeStyle = `rgba(${COLOR.accentRgb},${a})`;
    ctx.lineWidth = 3.5 / cam.z;
    const r = (46 + 10 * Math.sin(el / 110)) / Math.sqrt(cam.z);
    ctx.beginPath(); ctx.arc(flash.x, flash.y, r, 0, Math.PI * 2); ctx.stroke();
  }

  ctx.restore();
}
