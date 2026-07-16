// Selection (game/level/path), follow-to-destination, view fitting and hash permalinks.
// Fires a "selection-changed" window event (detail.fromHash) whenever a path is picked.

import { clamp } from "./util.js";
import { ZOOM_MIN, ZOOM_MAX, FOCUS_ZOOM_MIN, FOCUS_ZOOM_MAX, FOCUS_SCREENS } from "./config.js";
import { $, cv, gameBtns, levelBtns, pathBtns } from "./dom.js";
import { state, GEO, CELL_W, CELL_H, setGeometry, dX, dY } from "./state.js";
import { draw, flashAt } from "./render.js";

function computeEntryPaths(data) {
  const entries = {};
  const add = (lv, pa) => { if (lv != null && pa != null) (entries[lv] ??= new Set()).add(pa); };
  for (const L of data.levels)
    for (const P of L.paths)
      for (const t of P.tlvs) {
        const e = t.extra || {};
        if (e.to_level && e.to_level !== L.short) add(e.to_level, e.to_path);
        if (e.alt_level && e.alt_level !== L.short) add(e.alt_level, e.alt_path);
        if (t.name === "AbeStart") add(L.short, P.id);   // game start / re-entry
      }
  return entries;
}

// highlight the button whose data-key matches, clear the rest
function markOn(box, key) {
  for (const b of box.children) b.classList.toggle("on", b.dataset.key === key);
}

// build the game buttons once the datasets are known
export function initGames(games) {
  state.games = games;
  games.forEach(G => {
    const b = document.createElement("button");
    b.textContent = G.id;
    b.title = G.game;
    b.dataset.key = G.id;
    b.onclick = () => selectGame(G);
    gameBtns.appendChild(b);
  });
}

export function selectGame(G, keepView) {
  state.data = G;
  setGeometry(G.geometry);
  markOn(gameBtns, G.id);
  $("gameName").textContent = G.game;
  state.entry = computeEntryPaths(G);
  levelBtns.innerHTML = "";
  G.levels.forEach(L => {
    const b = document.createElement("button");
    b.textContent = L.short;
    b.title = L.name;
    b.dataset.key = L.short;
    b.onclick = () => selectLevel(L);
    levelBtns.appendChild(b);
  });
  if (!keepView && G.levels.length) selectLevel(G.levels[0]);
}

function selectLevel(L) {
  state.lvl = L;
  markOn(levelBtns, L.short);
  pathBtns.innerHTML = "";
  L.paths.forEach(P => {
    const b = document.createElement("button");
    b.textContent = "P" + P.id;
    b.dataset.key = String(P.id);
    if (state.entry[L.short] && state.entry[L.short].has(P.id)) {
      b.classList.add("entry");
      b.title = "entry point (arrived at from another level)";
    }
    b.onclick = () => selectPath(P);
    pathBtns.appendChild(b);
  });
  if (L.paths.length) selectPath(L.paths[0]);
}

function selectPath(P) {
  state.path = P;
  markOn(pathBtns, String(P.id));
  fitView();
  draw();
  scheduleHash(true);
  window.dispatchEvent(new CustomEvent("selection-changed", { detail: { fromHash: applyingHash } }));
}

function selectPathById(id) {
  const P = state.lvl.paths.find(p => p.id === id);
  if (!P) return false;
  selectPath(P);
  return true;
}

let camToken = 0;   // bumped on explicit positioning to invalidate pending fits

function fitView() {
  const token = ++camToken;
  const attempt = () => {
    if (token !== camToken) return;   // superseded by hash restore or follow
    if (!cv.clientWidth || !cv.clientHeight) { requestAnimationFrame(attempt); return; }
    const w = state.path.w * CELL_W, h = state.path.h * CELL_H;
    const zx = cv.clientWidth / (w + 200), zy = cv.clientHeight / (h + 200);
    state.cam.z = Math.max(ZOOM_MIN, Math.min(zx, zy));
    state.cam.x = -(cv.clientWidth / state.cam.z - w) / 2;
    state.cam.y = -(cv.clientHeight / state.cam.z - h) / 2;
    draw();
  };
  attempt();
}

// center on (fx, fy) zoomed to a few screens across, flash the spot
function focusOn(fx, fy) {
  state.cam.z = clamp(Math.min(cv.clientWidth / (FOCUS_SCREENS * CELL_W), cv.clientHeight / (FOCUS_SCREENS * CELL_H)),
                      FOCUS_ZOOM_MIN, FOCUS_ZOOM_MAX);
  state.cam.x = fx - cv.clientWidth / (2 * state.cam.z);
  state.cam.y = fy - cv.clientHeight / (2 * state.cam.z);
  camToken++;   // cancel any fit still waiting on layout
  flashAt(fx, fy);
  scheduleHash(true);
}

// ---- follow (click a door/portal/well to jump to its destination) -----
export function destOf(t) {
  const e = t.extra || {};
  // paired objects land on their counterpart, matched by field within the destination camera
  let target = null;
  if (e["target_door#"] != null) target = { name: "Door", field: "door#", value: e["target_door#"] };
  else if (e["target_tp#"] != null) target = { name: "Teleporter", field: "tp#", value: e["target_tp#"] };
  const mk = (lv, pa, ca, tgt) => (lv != null && pa != null) ? { lv, pa, ca, target: tgt } : null;
  const a = mk(e.to_level, e.to_path, e.to_cam, target);
  const b = mk(e.alt_level, e.alt_path, e.alt_cam, null);
  const differs = d => d && !(state.lvl && state.path && d.lv === state.lvl.short && d.pa === state.path.id && d.target == null);
  return differs(a) ? a : (differs(b) ? b : (a || b));
}

export function navigateToDest(d) {
  if (!cv.clientWidth) { requestAnimationFrame(() => navigateToDest(d)); return; }
  const L = state.data.levels.find(l => l.short === d.lv);
  if (!L) return;
  if (state.lvl !== L) selectLevel(L);
  if (!selectPathById(d.pa)) return;

  // door numbers are only unique per camera, so resolve the destination
  // camera cell first and match the target door inside it
  let cell = null;
  if (d.ca != null) {
    const suffix = "C" + String(d.ca).padStart(2, "0");
    const cm = state.path.cams.find(c => c.name && c.name.endsWith(suffix));
    if (cm) cell = cm.cell;
  }
  let fx = null, fy = null;
  if (d.target != null) {
    const inCell = t => cell == null ||
      (Math.floor(t.x1 / GEO.worldW) === cell % state.path.w && Math.floor(t.y1 / GEO.worldH) === Math.floor(cell / state.path.w));
    const tgt = state.path.tlvs.find(t => t.name === d.target.name && (t.extra || {})[d.target.field] === d.target.value && inCell(t)) ||
                state.path.tlvs.find(t => t.name === d.target.name && (t.extra || {})[d.target.field] === d.target.value);
    if (tgt) { fx = (dX(tgt.x1) + dX(tgt.x2)) / 2; fy = (dY(tgt.y1) + dY(tgt.y2)) / 2; }
  }
  if (fx == null && cell != null) {
    fx = (cell % state.path.w) * CELL_W + CELL_W / 2;
    fy = Math.floor(cell / state.path.w) * CELL_H + CELL_H / 2;
  }
  if (fx == null) return;   // path-level target: selectPath already fit the view
  focusOn(fx, fy);
}

export function jumpToTlv(G, L, P, t) {
  if (state.data !== G) selectGame(G, true);
  if (state.lvl !== L) selectLevel(L);
  if (state.path !== P) selectPathById(P.id);
  focusOn((dX(t.x1) + dX(t.x2)) / 2, (dY(t.y1) + dY(t.y2)) / 2);
}

// ---- permalinks: #GAME/LEVEL/PATH/x/y/zoom -----------------------------
let applyingHash = false, hashTimer = null;

function hashFor() {
  return `#${state.data.id}/${state.lvl.short}/${state.path.id}/${Math.round(state.cam.x)}/${Math.round(state.cam.y)}/${state.cam.z.toFixed(2)}`;
}

export function scheduleHash(push) {
  if (applyingHash || !state.path) return;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const h = hashFor();
    if (h === location.hash) return;
    if (push) location.hash = h;                 // history entry (level/path/follow)
    else history.replaceState(null, "", h);      // silent update (pan/zoom)
  }, push ? 0 : 350);
}

export function applyHash() {
  let h = location.hash.replace(/^#/, "");
  if (!h) return false;
  let parts = h.split("/");
  const G = state.games.find(g => g.id === parts[0].toUpperCase());
  if (!G) return false;
  parts = parts.slice(1);
  const L = G.levels.find(l => l.short === (parts[0] || "").toUpperCase());
  if (!L) return false;
  applyingHash = true;
  if (state.data !== G) selectGame(G, true);
  if (state.lvl !== L) selectLevel(L);
  if (!selectPathById(+parts[1])) { applyingHash = false; return false; }
  if (parts[2] != null && parts.length >= 5) {
    state.cam.x = +parts[2]; state.cam.y = +parts[3];
    state.cam.z = clamp(+parts[4], ZOOM_MIN, ZOOM_MAX);
    camToken++;   // cancel any fit still waiting on layout
  }
  applyingHash = false;
  draw();
  return true;
}

window.addEventListener("hashchange", () => { if (!applyingHash) applyHash(); });
