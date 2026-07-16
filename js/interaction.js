// Pointer and touch input on the map, hover inspection, and the menu toggle.

import { clamp, esc, extrasText, segDist } from "./util.js";
import { ZOOM_MIN, ZOOM_MAX, catOf, LINE_COLORS, LINE_NAMES } from "./config.js";
import { cv, tip, hud, menuBtn, scrim, narrowMQ, cssVar } from "./dom.js";
import { state, dX, dY, wX, wY } from "./state.js";
import { draw, scheduleDraw } from "./render.js";
import { destOf } from "./model.js";
import { navigateToDest, scheduleHash } from "./navigate.js";

const TIP_MAX_W = parseFloat(cssVar("--tip-max-w"));

let hoverTlvs = [], mouse = {x:0,y:0};
let panMoved = false;
let measuring = false;

// ---- menu --------------------------------------------------------------
const isNarrow = () => narrowMQ.matches;
document.body.classList.toggle("menu-open", !isNarrow());   // set before first paint: open on wide, out of the way on narrow
function toggleMenu(open) { document.body.classList.toggle("menu-open", open ?? !document.body.classList.contains("menu-open")); }
menuBtn.onclick = () => toggleMenu();
scrim.onclick = () => toggleMenu(false);
window.addEventListener("selection-changed", e => {
  if (isNarrow() && !e.detail.fromHash) toggleMenu(false);   // reveal the map after picking
});

// ---- mouse: pan, click-to-follow, ruler ---------------------------------
let panning = false, panStart = null;
cv.addEventListener("mousedown", e => {
  if (state.show.ruler) {
    const w = worldAtMouse();
    state.ruler = { x1: w.x, y1: w.y, x2: w.x, y2: w.y };
    measuring = true;
    draw();
    return;
  }
  panning = true; panMoved = false; cv.classList.add("panning"); panStart = { x: e.clientX, y: e.clientY, cx: state.cam.x, cy: state.cam.y };
});
cv.addEventListener("click", () => {
  if (panMoved || state.show.ruler) return;
  for (const t of hoverTlvs) {
    const d = destOf(t);
    if (d) { navigateToDest(d); return; }
  }
});
window.addEventListener("mouseup", () => { measuring = false; if (panning && panMoved) scheduleHash(false); panning = false; cv.classList.remove("panning"); });
window.addEventListener("mousemove", e => {
  const r = cv.getBoundingClientRect();
  mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  if (measuring && state.ruler) {
    const w = worldAtMouse();
    state.ruler.x2 = w.x; state.ruler.y2 = w.y;
  }
  if (panning) {
    if (Math.abs(e.clientX - panStart.x) + Math.abs(e.clientY - panStart.y) > 4) panMoved = true;
    state.cam.x = panStart.cx - (e.clientX - panStart.x) / state.cam.z;
    state.cam.y = panStart.cy - (e.clientY - panStart.y) / state.cam.z;
  }
  updateHover();
  scheduleDraw();
});
cv.addEventListener("wheel", e => {
  e.preventDefault();
  const f = Math.exp(-e.deltaY * 0.0015);
  const wx = state.cam.x + mouse.x / state.cam.z, wy = state.cam.y + mouse.y / state.cam.z;
  state.cam.z = clamp(state.cam.z * f, ZOOM_MIN, ZOOM_MAX);
  state.cam.x = wx - mouse.x / state.cam.z;
  state.cam.y = wy - mouse.y / state.cam.z;
  updateHover();
  scheduleDraw();
  scheduleHash(false);
}, { passive: false });

function worldAtMouse() { return { x: state.cam.x + mouse.x / state.cam.z, y: state.cam.y + mouse.y / state.cam.z }; }

// ---- touch: one finger pans, two fingers pinch-zoom (into the map, not the page) ----
let touchState = null;   // { mode, ... }
function touchXY(t) { const r = cv.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; }

cv.addEventListener("touchstart", e => {
  e.preventDefault();
  if (e.touches.length === 1) {
    const p = touchXY(e.touches[0]);
    touchState = { mode: "pan", sx: p.x, sy: p.y, cx: state.cam.x, cy: state.cam.y, moved: false, tapT: e.target };
    mouse.x = p.x; mouse.y = p.y;
  } else if (e.touches.length === 2) {
    const a = touchXY(e.touches[0]), b = touchXY(e.touches[1]);
    touchState = { mode: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y),
                   mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }
}, { passive: false });

cv.addEventListener("touchmove", e => {
  e.preventDefault();
  if (!touchState) return;
  if (touchState.mode === "pan" && e.touches.length === 1) {
    const p = touchXY(e.touches[0]);
    if (Math.abs(p.x - touchState.sx) + Math.abs(p.y - touchState.sy) > 6) touchState.moved = true;
    state.cam.x = touchState.cx - (p.x - touchState.sx) / state.cam.z;
    state.cam.y = touchState.cy - (p.y - touchState.sy) / state.cam.z;
    scheduleDraw();
  } else if (touchState.mode === "pinch" && e.touches.length === 2) {
    const a = touchXY(e.touches[0]), b = touchXY(e.touches[1]);
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const wx = state.cam.x + mx / state.cam.z, wy = state.cam.y + my / state.cam.z;   // anchor at pinch midpoint
    state.cam.z = clamp(state.cam.z * dist / touchState.dist, ZOOM_MIN, ZOOM_MAX);
    state.cam.x = wx - mx / state.cam.z;
    state.cam.y = wy - my / state.cam.z;
    touchState.dist = dist; touchState.mx = mx; touchState.my = my;
    scheduleDraw();
  }
}, { passive: false });

cv.addEventListener("touchend", e => {
  if (touchState && touchState.mode === "pan" && !touchState.moved) {
    // treat as a tap: hover there, then follow if it hit a linked object
    updateHover();
    for (const t of hoverTlvs) { const d = destOf(t); if (d) { navigateToDest(d); break; } }
  }
  if (touchState) scheduleHash(false);
  touchState = e.touches.length ? touchState : null;
}, { passive: false });

// ---- hover inspection ----------------------------------------------------
function updateHover() {
  if (!state.path) return;
  const w = worldAtMouse();
  let hoverLines = [];
  if (state.show.coll) {
    const tol = 6 / state.cam.z;
    hoverLines = state.path.lines.filter(([x1, y1, x2, y2]) =>
      segDist(w.x, w.y, dX(x1), dY(y1), dX(x2), dY(y2)) <= tol).slice(0, 4);
  }
  hoverTlvs = state.path.tlvs.filter(t => {
    const c = catOf(t);
    if (!c.on) return false;
    const x1 = dX(t.x1), y1 = dY(t.y1);
    const x2 = Math.max(dX(t.x2), x1 + 10), y2 = Math.max(dY(t.y2), y1 + 10);
    return w.x >= x1 - 4 && w.x <= x2 + 4 && w.y >= y1 - 4 && w.y <= y2 + 4;
  });
  if (hoverTlvs.length || hoverLines.length) {
    tip.style.display = "block";
    const px = Math.min(mouse.x + 16, cv.clientWidth - (TIP_MAX_W + 10));
    tip.style.left = px + "px";
    tip.style.top = (mouse.y + 16) + "px";
    tip.innerHTML = hoverTlvs.slice(0, 8).map(t => {
      const ex = extrasText(t, "  ");
      const d = destOf(t);
      return `<div><span class="t">${esc(t.name)}</span> <span class="e">(${t.x1},${t.y1})–(${t.x2},${t.y2})</span>` +
             (ex ? `<br><span class="e">${esc(ex)}</span>` : "") +
             (d ? `<br><span class="f">➜ click to follow to ${esc(`${d.lv} P${d.pa}${d.ca != null ? " C" + d.ca : ""}`)}</span>` : "") + `</div>`;
    }).concat(hoverLines.map(([x1, y1, x2, y2, t]) => {
      const len = Math.round(Math.hypot(x2 - x1, y2 - y1));
      return `<div><span class="t" style="color:${LINE_COLORS[t] || '#999'}">${LINE_NAMES[t] || "Line type " + t}</span>` +
             ` <span class="e">(${x1},${y1})→(${x2},${y2}) · ${len}u ≈ ${(len / 25).toFixed(1)} grid</span></div>`;
    })).join("<hr>")
      + (hoverTlvs.length > 8 ? `<div class="e">+${hoverTlvs.length - 8} more…</div>` : "");
    if (!panning) cv.style.cursor = hoverTlvs.some(t => destOf(t)) ? "pointer" : "";
  } else {
    tip.style.display = "none";
    if (!panning) cv.style.cursor = "";
  }
  hud.textContent = `world x ${Math.round(wX(w.x))}  y ${Math.round(wY(w.y))}  ·  zoom ${state.cam.z.toFixed(2)}`;
}
