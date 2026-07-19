// Selection (game/level/path), follow-to-destination, view fitting and hash permalinks.
// Fires a "selection-changed" window event (detail.fromHash) whenever a path is picked.

import { clamp } from "./util.js";
import { ZOOM_MIN, ZOOM_MAX } from "./config.js";
import { $, cv, gameBtns, levelBtns, pathBtns } from "./dom.js";
import { state, GEO, CELL_W, CELL_H, setGeometry, dX, dY } from "./state.js";
import { draw, flashAt } from "./render.js";
import {
  camCell,
  computeEntryPaths,
  focusView,
  formatHash,
  parseHash,
  resolveTarget,
} from "./model.js";
import { displayLabel, getSettings, rememberLocation } from "./settings.js";

// highlight the button whose data-key matches, clear the rest
function markOn(box, key) {
  for (const b of box.children) b.classList.toggle("on", b.dataset.key === key);
}

// label from the code/full-name pair stashed on the button, honoring the
// full-names setting; re-run on every button when the setting flips
function setLabel(b) {
  b.textContent = displayLabel(b.dataset.code, b.dataset.full, getSettings().fullNames);
}

window.addEventListener("settings-changed", (e) => {
  if (e.detail.key !== "fullNames") return;
  for (const box of [gameBtns, levelBtns, pathBtns]) for (const b of box.children) setLabel(b);
});

// build the game buttons once the datasets are known
export function initGames(games) {
  state.games = games;
  games.forEach((G) => {
    const b = document.createElement("button");
    b.dataset.code = G.id;
    b.dataset.full = G.game;
    setLabel(b);
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
  G.levels.forEach((L) => {
    const b = document.createElement("button");
    b.dataset.code = L.short;
    b.dataset.full = L.name;
    setLabel(b);
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
  L.paths.forEach((P) => {
    const b = document.createElement("button");
    b.dataset.code = "P" + P.id;
    b.dataset.full = P.name || "";
    setLabel(b);
    b.dataset.key = String(P.id);
    const tip = [];
    if (P.name) tip.push(P.name);
    if (state.entry[L.short] && state.entry[L.short].has(P.id)) {
      b.classList.add("entry");
      tip.push("entry point (arrived at from another level)");
    }
    if (tip.length) b.title = tip.join(" — ");
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
  window.dispatchEvent(
    new CustomEvent("selection-changed", { detail: { fromHash: applyingHash } }),
  );
}

function selectPathById(id) {
  const P = state.lvl.paths.find((p) => p.id === id);
  if (!P) return false;
  selectPath(P);
  return true;
}

let camToken = 0; // bumped on explicit positioning to invalidate pending fits

function fitView() {
  const token = ++camToken;
  const attempt = () => {
    if (token !== camToken) return; // superseded by hash restore or follow
    if (!cv.clientWidth || !cv.clientHeight) {
      requestAnimationFrame(attempt);
      return;
    }
    const w = state.path.w * CELL_W,
      h = state.path.h * CELL_H;
    const zx = cv.clientWidth / (w + 200),
      zy = cv.clientHeight / (h + 200);
    state.cam.z = Math.max(ZOOM_MIN, Math.min(zx, zy));
    state.cam.x = -(cv.clientWidth / state.cam.z - w) / 2;
    state.cam.y = -(cv.clientHeight / state.cam.z - h) / 2;
    draw();
  };
  attempt();
}

// center on (fx, fy) zoomed to a few screens across, flash the spot
function focusOn(fx, fy) {
  Object.assign(state.cam, focusView(fx, fy, cv.clientWidth, cv.clientHeight));
  camToken++; // cancel any fit still waiting on layout
  flashAt(fx, fy);
  scheduleHash(true);
}

// permalink to one object: the focused view plus the object identity, so
// opening the link can highlight it
export function objectHash(t) {
  const fx = (dX(t.x1) + dX(t.x2)) / 2,
    fy = (dY(t.y1) + dY(t.y2)) / 2;
  const v = focusView(fx, fy, cv.clientWidth, cv.clientHeight);
  return formatHash(state.data.id, state.lvl.short, state.path.id, v, t);
}

// ---- follow (click a door/portal/well to jump to its destination) -----
export function navigateToDest(d) {
  if (!cv.clientWidth) {
    requestAnimationFrame(() => navigateToDest(d));
    return;
  }
  const L = state.data.levels.find((l) => l.short === d.lv);
  if (!L) return;
  if (state.lvl !== L) selectLevel(L);
  if (!selectPathById(d.pa)) return;

  let fx = null,
    fy = null;
  const tgt = resolveTarget(d, state.path, GEO);
  if (tgt) {
    fx = (dX(tgt.x1) + dX(tgt.x2)) / 2;
    fy = (dY(tgt.y1) + dY(tgt.y2)) / 2;
  }
  const cell = camCell(state.path, d.ca);
  if (fx == null && cell != null) {
    fx = (cell % state.path.w) * CELL_W + CELL_W / 2;
    fy = Math.floor(cell / state.path.w) * CELL_H + CELL_H / 2;
  }
  if (fx == null) return; // path-level target: selectPath already fit the view
  focusOn(fx, fy);
}

export function jumpToTlv(G, L, P, t) {
  if (state.data !== G) selectGame(G, true);
  if (state.lvl !== L) selectLevel(L);
  if (state.path !== P) selectPathById(P.id);
  focusOn((dX(t.x1) + dX(t.x2)) / 2, (dY(t.y1) + dY(t.y2)) / 2);
}

// ---- permalinks ---------------------------------------------------------
let applyingHash = false,
  hashTimer = null;

// permalink to the current view (what the address bar shows once the
// debounced hash write lands)
export function viewHash() {
  return formatHash(state.data.id, state.lvl.short, state.path.id, state.cam);
}

export function scheduleHash(push) {
  if (applyingHash || !state.path) return;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(
    () => {
      const h = viewHash();
      rememberLocation(h);
      if (h === location.hash) return;
      if (push)
        location.hash = h; // history entry (level/path/follow)
      else history.replaceState(null, "", h); // silent update (pan/zoom)
    },
    push ? 0 : 350,
  );
}

export function applyHash() {
  const p = parseHash(location.hash);
  if (!p) return false;
  const G = state.games.find((g) => g.id === p.game);
  if (!G) return false;
  const L = G.levels.find((l) => l.short === p.level);
  if (!L) return false;
  applyingHash = true;
  if (state.data !== G) selectGame(G, true);
  if (state.lvl !== L) selectLevel(L);
  if (!selectPathById(p.path)) {
    applyingHash = false;
    return false;
  }
  if (p.view) {
    state.cam.x = p.view.x;
    state.cam.y = p.view.y;
    state.cam.z = clamp(p.view.z, ZOOM_MIN, ZOOM_MAX);
    camToken++; // cancel any fit still waiting on layout
  }
  applyingHash = false;
  if (p.obj) {
    // a link to a specific object: center it and hold a marker on it
    const t = state.path.tlvs.find(
      (x) => x.name === p.obj.name && x.x1 === p.obj.x1 && x.y1 === p.obj.y1,
    );
    if (t) {
      const fx = (dX(t.x1) + dX(t.x2)) / 2,
        fy = (dY(t.y1) + dY(t.y2)) / 2;
      // recenter for this viewport: the link's x/y/z were focusView on the
      // copier's screen and only serve as the fallback when the object is gone
      Object.assign(state.cam, focusView(fx, fy, cv.clientWidth, cv.clientHeight));
      camToken++;
      flashAt(fx, fy, true);
    }
  }
  draw();
  return true;
}

window.addEventListener("hashchange", () => {
  if (applyingHash) return;
  // back/forward retraces update the remembered spot; a rejected hash must not
  if (applyHash()) rememberLocation(location.hash);
});
