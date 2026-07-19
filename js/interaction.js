// Pointer input on the map (mouse, touch, pen), hover inspection, and the menu toggle.

import { esc, extrasText, segDist } from "./util.js";
import { KEY_PAN_PX, KEY_ZOOM_STEP, TOAST_MS, catOf, LINE_COLORS, LINE_NAMES } from "./config.js";
import {
  $,
  cv,
  tip,
  hud,
  menuBtn,
  scrim,
  copyLinkBtn,
  openSiteBtn,
  narrowMQ,
  cssVar,
  toastEl,
} from "./dom.js";
import { state, GEO, dX, dY, wX, wY } from "./state.js";
import { draw, scheduleDraw, setConnFocus, setHighlight } from "./render.js";
import { destOf, isLoopback, resolveTarget, zoomAt } from "./model.js";
import { cyclePath, navigateToDest, objectHash, scheduleHash, viewHash } from "./navigate.js";
import { toggleShow } from "./sidebar.js";
import { openCamPanel } from "./campanel.js";
import { trapDialogKeys } from "./dialog.js";
import { HAMBURGER_SVG, CLOSE_SVG, LINK_SVG, EXTERNAL_SVG } from "./icons.js";

const TIP_MAX_W = parseFloat(cssVar("--tip-max-w"));

let hoverTlvs = [],
  mouse = { x: 0, y: 0 };
let panMoved = false;
let measuring = false;

// ---- menu --------------------------------------------------------------
const isNarrow = () => narrowMQ.matches;
function syncMenuIcon() {
  const open = document.body.classList.contains("menu-open");
  menuBtn.innerHTML = open ? CLOSE_SVG : HAMBURGER_SVG;
  const label = open ? "Close menu" : "Open menu";
  menuBtn.title = label;
  menuBtn.setAttribute("aria-label", label);
}
document.body.classList.toggle("menu-open", !isNarrow()); // set before first paint: open on wide, out of the way on narrow
export function toggleMenu(open) {
  document.body.classList.toggle(
    "menu-open",
    open ?? !document.body.classList.contains("menu-open"),
  );
  syncMenuIcon();
}
syncMenuIcon();
menuBtn.onclick = () => toggleMenu();
scrim.onclick = () => toggleMenu(false);
window.addEventListener("selection-changed", (e) => {
  if (isNarrow() && !e.detail.fromHash) toggleMenu(false); // reveal the map after picking
});

// ---- pointers: one pointer pans (or measures), two pinch-zoom, click follows ----
// touch-action: none on #cv keeps the browser's own pan/zoom gestures off the map
let panning = false,
  panStart = null;
const pointers = new Map(); // active pointerId -> {x, y} in canvas space
let pinchDist = 0;
function ptrXY(e) {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

cv.addEventListener("pointerdown", (e) => {
  const p = ptrXY(e);
  pointers.set(e.pointerId, p);
  try {
    cv.setPointerCapture(e.pointerId);
  } catch {
    /* pointer already lifted */
  }
  mouse.x = p.x;
  mouse.y = p.y;
  if (pointers.size === 1) {
    if (state.show.ruler) {
      const w = worldAtMouse();
      state.ruler = { x1: w.x, y1: w.y, x2: w.x, y2: w.y };
      measuring = true;
      draw();
      return;
    }
    panning = true;
    panMoved = false;
    cv.classList.add("panning");
    panStart = { x: p.x, y: p.y, cx: state.cam.x, cy: state.cam.y };
  } else if (pointers.size === 2) {
    // a second pointer turns pan/measure into a pinch
    panning = false;
    measuring = false;
    cv.classList.remove("panning");
    const [a, b] = pointers.values();
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

cv.addEventListener("pointermove", (e) => {
  const p = ptrXY(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
  if (pointers.size === 2) {
    const [a, b] = pointers.values();
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist && pinchDist)
      // coincident fingers make the factor 0 or Infinity; skip those frames
      Object.assign(
        state.cam,
        zoomAt(state.cam, dist / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2),
      ); // anchor at pinch midpoint
    pinchDist = dist;
    scheduleDraw();
    return;
  }
  mouse.x = p.x;
  mouse.y = p.y;
  if (measuring && state.ruler) {
    const w = worldAtMouse();
    state.ruler.x2 = w.x;
    state.ruler.y2 = w.y;
  }
  if (panning) {
    if (
      Math.abs(p.x - panStart.x) + Math.abs(p.y - panStart.y) >
      (e.pointerType === "mouse" ? 4 : 6)
    )
      panMoved = true;
    state.cam.x = panStart.cx - (p.x - panStart.x) / state.cam.z;
    state.cam.y = panStart.cy - (p.y - panStart.y) / state.cam.z;
  }
  if (e.pointerType !== "touch" || !panning) updateHover(); // no tooltips under a panning finger
  scheduleDraw();
});

function endPointer(e) {
  if (!pointers.delete(e.pointerId)) return;
  if (pointers.size === 1) {
    // pinch ended with a pointer still down: continue as a pan
    const [p] = pointers.values();
    panning = true;
    panMoved = true;
    panStart = { x: p.x, y: p.y, cx: state.cam.x, cy: state.cam.y };
  } else if (!pointers.size) {
    if (panMoved) scheduleHash(false);
    panning = false;
    measuring = false;
    cv.classList.remove("panning");
  }
}
cv.addEventListener("pointerup", endPointer);
cv.addEventListener("pointercancel", endPointer);

cv.addEventListener("pointerleave", () => {
  // moving off the canvas clears hover
  if (pointers.size) return; // a captured drag only leaves after release
  hoverTlvs = [];
  tip.style.display = "none";
  cv.style.cursor = "";
  setHighlight(null);
  setConnFocus(null);
});

cv.addEventListener("click", () => {
  if (panMoved || state.show.ruler) return;
  updateHover(); // taps arrive without a preceding hover move
  for (const t of hoverTlvs) {
    const d = destOf(t);
    if (d) {
      navigateToDest(d);
      return;
    }
  }
  const w = worldAtMouse(); // nothing to follow: list the screen's objects
  openCamPanel(w.x, w.y);
});

// right-click (long-press on touch) copies a permalink to the object under
// the pointer; over empty map the native menu stays available
cv.addEventListener("contextmenu", (e) => {
  const r = cv.getBoundingClientRect();
  mouse.x = e.clientX - r.left;
  mouse.y = e.clientY - r.top;
  updateHover();
  if (!hoverTlvs.length) return;
  e.preventDefault();
  const url = location.href.split("#")[0] + objectHash(hoverTlvs[0]);
  (navigator.clipboard?.writeText(url) ?? Promise.reject()).then(
    () => toast("object link copied"),
    () => toast("copy failed"),
  );
});

// the full-site permalink to the current view. viewHash(), not location.href:
// the hash write is debounced and can lag a pan
function fullSiteUrl() {
  const url = new URL(location.href);
  url.searchParams.delete("embed");
  url.hash = state.path ? viewHash() : location.hash;
  return url.href;
}

// the top-right chain button copies that permalink — the address bar
// equivalent, which phones and installed/standalone mode may hide
copyLinkBtn.innerHTML = LINK_SVG;
copyLinkBtn.onclick = () => {
  if (!state.path) return;
  (navigator.clipboard?.writeText(fullSiteUrl()) ?? Promise.reject()).then(
    () => toast("view link copied"),
    () => toast("copy failed"),
  );
};

// in embeds the chain button gives way to this link out to the full site at
// the same view; the href is seeded at boot (an <a> without one isn't even
// focusable) and refreshed on pointerdown/click, before navigation reads it
openSiteBtn.innerHTML = EXTERNAL_SVG;
openSiteBtn.href = fullSiteUrl();
openSiteBtn.onpointerdown = openSiteBtn.onclick = () => {
  openSiteBtn.href = fullSiteUrl();
};

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), TOAST_MS);
}

cv.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    Object.assign(state.cam, zoomAt(state.cam, Math.exp(-e.deltaY * 0.0015), mouse.x, mouse.y));
    updateHover();
    scheduleDraw();
    scheduleHash(false);
  },
  { passive: false },
);

function worldAtMouse() {
  return { x: state.cam.x + mouse.x / state.cam.z, y: state.cam.y + mouse.y / state.cam.z };
}

// ---- keyboard: arrows pan, + / - zoom about the canvas center, [ / ] cycle
// paths, g / c / f flip display toggles, ? lists the shortcuts ---------------
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.target.matches?.("input, textarea, select")) return;
  // brackets before the Alt guard: several layouts type them via Option/AltGr
  if (e.key === "[" || e.key === "]") {
    cyclePath(e.key === "]" ? 1 : -1);
    e.preventDefault();
    return;
  }
  if (e.altKey) return;
  const show = { g: "grid", c: "coll", f: "fg", a: "conn" }[e.key];
  if (show) {
    toggleShow(show);
    return;
  }
  if (e.key === "?") {
    openShortcuts();
    e.preventDefault();
    return;
  }
  const pan = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
    e.key
  ];
  if (pan) {
    state.cam.x += (pan[0] * KEY_PAN_PX) / state.cam.z;
    state.cam.y += (pan[1] * KEY_PAN_PX) / state.cam.z;
  } else if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") {
    const f = e.key === "-" || e.key === "_" ? 1 / KEY_ZOOM_STEP : KEY_ZOOM_STEP;
    Object.assign(state.cam, zoomAt(state.cam, f, cv.clientWidth / 2, cv.clientHeight / 2));
  } else return;
  e.preventDefault();
  updateHover();
  scheduleDraw();
  scheduleHash(false);
});

// ---- shortcuts panel (the ? key) -----------------------------------------
function openShortcuts() {
  document.body.classList.add("shortcuts-open");
  $("shortcutsClose").focus();
}
const closeShortcuts = () => document.body.classList.remove("shortcuts-open");
$("shortcutsClose").onclick = closeShortcuts;
$("shortcutsOverlay").onclick = (e) => {
  if (e.target === e.currentTarget) closeShortcuts();
};
trapDialogKeys(
  () => document.body.classList.contains("shortcuts-open"),
  $("shortcuts"),
  closeShortcuts,
);

// ---- hover inspection ----------------------------------------------------
function updateHover() {
  if (!state.path) return;
  const w = worldAtMouse();
  let hoverLines = [];
  if (state.show.coll) {
    const tol = 6 / state.cam.z;
    hoverLines = state.path.lines
      .filter(([x1, y1, x2, y2]) => segDist(w.x, w.y, dX(x1), dY(y1), dX(x2), dY(y2)) <= tol)
      .slice(0, 4);
  }
  hoverTlvs = state.path.tlvs.filter((t) => {
    const c = catOf(t);
    if (!c.on) return false;
    const x1 = dX(t.x1),
      y1 = dY(t.y1);
    const x2 = Math.max(dX(t.x2), x1 + 10),
      y2 = Math.max(dY(t.y2), y1 + 10);
    return w.x >= x1 - 4 && w.x <= x2 + 4 && w.y >= y1 - 4 && w.y <= y2 + 4;
  });
  // partner preview: hovering a linked object outlines its counterpart when
  // the destination resolves within the current path
  let partner = null;
  for (const t of hoverTlvs) {
    const d = destOf(t);
    if (!d || d.lv !== state.lvl.short || d.pa !== state.path.id) continue;
    const tgt = resolveTarget(d, state.path, GEO);
    if (tgt) {
      partner = tgt;
      break;
    }
  }
  setHighlight(partner);
  // arrows overlay: spotlight the hovered object's own edges
  setConnFocus(state.show.conn ? (hoverTlvs.find((t) => destOf(t)) ?? null) : null);
  if (hoverTlvs.length || hoverLines.length) {
    tip.style.display = "block";
    const px = Math.min(mouse.x + 16, cv.clientWidth - (TIP_MAX_W + 10));
    tip.style.left = px + "px";
    tip.style.top = mouse.y + 16 + "px";
    tip.innerHTML =
      hoverTlvs
        .slice(0, 8)
        .map((t) => {
          const ex = extrasText(t, "  ");
          const d = destOf(t);
          const follow =
            d &&
            (isLoopback(t)
              ? `<br><span class="f loop">⟳ loops back to itself</span>`
              : `<br><span class="f">➜ click to follow to ${esc(`${d.lv} P${d.pa}${d.ca != null ? " C" + d.ca : ""}`)}</span>`);
          return (
            `<div><span class="t">${esc(t.name)}</span> <span class="e">(${t.x1},${t.y1})–(${t.x2},${t.y2})</span>` +
            (ex ? `<br><span class="e">${esc(ex)}</span>` : "") +
            (follow || "") +
            `</div>`
          );
        })
        .concat(
          hoverLines.map(([x1, y1, x2, y2, t]) => {
            const len = Math.round(Math.hypot(x2 - x1, y2 - y1));
            return (
              `<div><span class="t" style="color:${LINE_COLORS[t] || "#999"}">${LINE_NAMES[t] || "Line type " + t}</span>` +
              ` <span class="e">(${x1},${y1})→(${x2},${y2}) · ${len}u ≈ ${(len / 25).toFixed(1)} grid</span></div>`
            );
          }),
        )
        .join("<hr>") +
      (hoverTlvs.length > 8 ? `<div class="e">+${hoverTlvs.length - 8} more…</div>` : "");
    if (!panning) cv.style.cursor = hoverTlvs.some((t) => destOf(t)) ? "pointer" : "";
  } else {
    tip.style.display = "none";
    if (!panning) cv.style.cursor = "";
  }
  hud.textContent = `world x ${Math.round(wX(w.x))}  y ${Math.round(wY(w.y))}  ·  zoom ${state.cam.z.toFixed(2)}`;
}
