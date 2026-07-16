import { clamp, esc, extrasText, segDist } from "./util.js";
import { ZOOM_MIN, ZOOM_MAX, FOCUS_ZOOM_MIN, FOCUS_ZOOM_MAX, FOCUS_SCREENS, FLASH_MS,
         TIP_MAX_W, narrowMQ, COLOR, CATS, catOf, LINE_COLORS, LINE_NAMES } from "./config.js";
import { $, cv, ctx, tip, hud, menuBtn, scrim, gameBtns, levelBtns, pathBtns, filterBox,
         searchInput, searchResults, scopeBar } from "./dom.js";
import { state, GEO, CELL_W, CELL_H, setGeometry, dX, dY, wX, wY } from "./state.js";
import { draw, scheduleDraw, flashAt, resize } from "./render.js";

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

let hoverTlvs = [], mouse = {x:0,y:0};
let panMoved = false;
let measuring = false;

const isNarrow = () => narrowMQ.matches;
document.body.classList.toggle("menu-open", !isNarrow());   // set before first paint: open on wide, out of the way on narrow
function toggleMenu(open) { document.body.classList.toggle("menu-open", open ?? !document.body.classList.contains("menu-open")); }
menuBtn.onclick = () => toggleMenu();
scrim.onclick = () => toggleMenu(false);

// ---- UI build ---------------------------------------------------------
// highlight the button whose data-key matches, clear the rest
function markOn(box, key) {
  for (const b of box.children) b.classList.toggle("on", b.dataset.key === key);
}

function selectGame(G, keepView) {
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
  if (isNarrow() && !applyingHash) toggleMenu(false);   // reveal the map after picking
  fitView();
  updateCounts();
  updateScopeBar();
  draw();
  scheduleHash(true);
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

// filters
CATS.forEach(c => {
  const lab = document.createElement("label");
  lab.innerHTML = `<span class="sw" style="background:${c.color}"></span>
    <input type="checkbox" ${c.on ? "checked" : ""}>
    <span>${c.label}</span><span class="cnt"></span>`;
  c._cb = lab.querySelector("input");
  c._cnt = lab.querySelector(".cnt");
  c._cb.onchange = () => { c.on = c._cb.checked; draw(); };
  filterBox.appendChild(lab);
});
function setAllFilters(on) {
  CATS.forEach(c => { c.on = on; c._cb.checked = on; });
  draw();
}
$("fAll").onclick = () => setAllFilters(true);
$("fNone").onclick = () => setAllFilters(false);
// display toggles: state.show mirrors the sidebar checkboxes (initial state comes from the HTML)
for (const [key, id] of Object.entries({ grid: "tGrid", coll: "tColl", fg: "tFg",
                                         labels: "tLabels", dim: "tDim", ruler: "tRuler" })) {
  const cb = $(id);
  state.show[key] = cb.checked;
  cb.onchange = () => {
    state.show[key] = cb.checked;
    if (key === "ruler") { if (!state.show.ruler) state.ruler = null; cv.style.cursor = state.show.ruler ? "crosshair" : ""; }
    draw();
  };
}
$("exportBtn").onclick = () => {
  cv.toBlob(blob => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `oddworld-${state.data.id.toLowerCase()}${state.lvl ? "-" + state.lvl.short : ""}${state.path ? "-P" + state.path.id : ""}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, "image/png");
};

function updateCounts() {
  const counts = {};
  state.path.tlvs.forEach(t => { const c = catOf(t); counts[c.key] = (counts[c.key] || 0) + 1; });
  CATS.forEach(c => c._cnt.textContent = counts[c.key] || "");
}

// ---- follow (click a door/portal/well to jump to its destination) -----
function destOf(t) {
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

function selectPathById(id) {
  const P = state.lvl.paths.find(p => p.id === id);
  if (!P) return false;
  selectPath(P);
  return true;
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

function navigateToDest(d) {
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

// ---- global search ------------------------------------------------------
let searchTimer = null;

function tlvSearchText(t) {
  return (t.name + " " + extrasText(t)).toLowerCase();
}

const HIT_CAP = 1500, GROUP_MAX = 8;
let searchScope = "all";   // all | game | level | path (relative to the current selection)

function scopeAccepts(h) {
  if (searchScope === "game") return h.G === state.data;
  if (searchScope === "level") return h.G === state.data && h.L === state.lvl;
  if (searchScope === "path") return h.G === state.data && h.L === state.lvl && h.P === state.path;
  return true;
}

function scopeLabel() {
  return { all: "everywhere", game: state.data.id, level: `${state.data.id} · ${state.lvl.short}`,
           path: `${state.data.id} · ${state.lvl.short} P${state.path.id}` }[searchScope];
}

function updateScopeBar() {
  if (!state.data || !state.lvl || !state.path) return;
  scopeBar.innerHTML = "";
  for (const [key, label] of [["all", "All"], ["game", state.data.id], ["level", state.lvl.short], ["path", "P" + state.path.id]]) {
    const b = document.createElement("button");
    b.textContent = label;
    if (searchScope === key) b.classList.add("on");
    b.onclick = () => { searchScope = key; updateScopeBar(); runSearch(searchInput.value); };
    scopeBar.appendChild(b);
  }
}

function highlight(text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + q.length)) + "</mark>" + esc(text.slice(i + q.length));
}

// match quality: exact name, name prefix, name substring, extras-only
function matchRank(t, q) {
  const n = t.name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  return 3;
}

function hitButton(h, q) {
  const b = document.createElement("button");
  b.className = "hit";
  const ex = extrasText(h.t);
  b.innerHTML = `<span class="loc">${h.L.short} P${h.P.id}</span> ${highlight(h.t.name, q)}` +
                (ex ? ` <span class="ex">${highlight(ex, q)}</span>` : "");
  b.onclick = () => jumpToTlv(h.G, h.L, h.P, h.t);
  return b;
}

function runSearch(q) {
  searchResults.innerHTML = "";
  q = q.trim().toLowerCase();
  if (q.length < 2) { searchScope = "all"; updateScopeBar(); return; }

  const hits = [];
  outer:
  for (const G of state.games)
    for (const L of G.levels)
      for (const P of L.paths)
        for (const t of P.tlvs)
          if (tlvSearchText(t).includes(q)) {
            const h = { G, L, P, t };
            if (!scopeAccepts(h)) continue;
            hits.push(h);
            if (hits.length >= HIT_CAP) break outer;
          }

  // group by context: current path, then current level, then per game
  const groups = [];
  const byKey = {};
  const group = (key, label) => byKey[key] ||
    (byKey[key] = groups[groups.push({ label, hits: [] }) - 1]);
  if (state.path) group("p", `${state.data.id} · ${state.lvl.short} P${state.path.id}`);
  if (state.lvl) group("l", `${state.data.id} · ${state.lvl.short}`);
  for (const G of [state.data, ...state.games.filter(G => G !== state.data)]) group("g" + G.id, G.id);
  for (const h of hits) {
    if (h.G === state.data && h.L === state.lvl && h.P === state.path) group("p").hits.push(h);
    else if (h.G === state.data && h.L === state.lvl) group("l").hits.push(h);
    else group("g" + h.G.id).hits.push(h);
  }

  for (const g of groups) {
    if (!g.hits.length) continue;
    g.hits.sort((a, b) => matchRank(a.t, q) - matchRank(b.t, q));
    const head = document.createElement("div");
    head.className = "shead";
    head.innerHTML = `<span>${g.label}</span><span>${g.hits.length}</span>`;
    searchResults.appendChild(head);
    g.hits.slice(0, GROUP_MAX).forEach(h => searchResults.appendChild(hitButton(h, q)));
    if (g.hits.length > GROUP_MAX) {
      const rest = g.hits.slice(GROUP_MAX);
      const btn = document.createElement("button");
      btn.className = "showmore";
      btn.textContent = `show ${rest.length} more`;
      btn.onclick = () => { rest.forEach(h => searchResults.insertBefore(hitButton(h, q), btn)); btn.remove(); };
      searchResults.appendChild(btn);
    }
  }

  const more = document.createElement("div");
  more.className = "more";
  const perGame = state.games.map(G => `${G.id} ${hits.filter(h => h.G === G).length}`).join(" · ");
  const summary = hits.length
    ? `${hits.length}${hits.length >= HIT_CAP ? "+" : ""} hit${hits.length === 1 ? "" : "s"}` +
      (searchScope === "all" ? ` — ${perGame}` : ` in ${scopeLabel()}`)
    : (searchScope === "all" ? "no hits" : `no hits in ${scopeLabel()}`);
  more.textContent = summary + (searchScope === "all" ? "" : " — ");
  if (searchScope !== "all") {
    const widen = document.createElement("span");
    widen.className = "widen";
    widen.textContent = "search everywhere";
    widen.onclick = () => { searchScope = "all"; updateScopeBar(); runSearch(searchInput.value); };
    more.appendChild(widen);
  }
  searchResults.appendChild(more);
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(searchInput.value), 160);
});

// keyboard: "/" focuses search, Esc clears, arrows walk results, Enter jumps
let activeHit = -1;
function visibleHits() { return [...searchResults.querySelectorAll(".hit")]; }
function setActiveHit(i) {
  const hits = visibleHits();
  hits.forEach(b => b.classList.remove("active"));
  activeHit = Math.max(-1, Math.min(i, hits.length - 1));
  if (activeHit >= 0) {
    hits[activeHit].classList.add("active");
    hits[activeHit].scrollIntoView({ block: "nearest" });
  }
}
window.addEventListener("keydown", e => {
  if (e.key === "/" && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }
  if (document.activeElement !== searchInput) return;
  if (e.key === "Escape") { searchInput.value = ""; runSearch(""); searchInput.blur(); setActiveHit(-1); }
  else if (e.key === "ArrowDown") { e.preventDefault(); setActiveHit(activeHit + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); setActiveHit(activeHit - 1); }
  else if (e.key === "Enter") {
    const hits = visibleHits();
    (hits[activeHit] || hits[0])?.click();
  } else { activeHit = -1; }
});

function jumpToTlv(G, L, P, t) {
  if (state.data !== G) selectGame(G, true);
  if (state.lvl !== L) selectLevel(L);
  if (state.path !== P) selectPathById(P.id);
  focusOn((dX(t.x1) + dX(t.x2)) / 2, (dY(t.y1) + dY(t.y2)) / 2);
}

// ---- permalinks: #LEVEL/PATH/x/y/zoom ----------------------------------
let applyingHash = false, hashTimer = null;

function hashFor() {
  return `#${state.data.id}/${state.lvl.short}/${state.path.id}/${Math.round(state.cam.x)}/${Math.round(state.cam.y)}/${state.cam.z.toFixed(2)}`;
}

function scheduleHash(push) {
  if (applyingHash || !state.path) return;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const h = hashFor();
    if (h === location.hash) return;
    if (push) location.hash = h;                 // history entry (level/path/follow)
    else history.replaceState(null, "", h);      // silent update (pan/zoom)
  }, push ? 0 : 350);
}

function applyHash() {
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

// ---- interaction ------------------------------------------------------
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
    const x2 = Math.max(dX(t.x2), x1 + 8), y2 = Math.max(dY(t.y2), y1 + 8);
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
             (d ? `<br><span class="f">➜ click to follow to ${esc(`${d.lv} P${d.pa}`)}${d.ca != null ? " C" + d.ca : ""}</span>` : "") + `</div>`;
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

// boot: the generated data files are `window.MAP_DATA_* = {...}` scripts;
// fetch them and parse the JSON payload after the "=".
async function loadOne(file) {
  try {
    // no-cache revalidates (ETag/304) so rebuilds still show up immediately,
    // but an unchanged dataset is not re-downloaded
    const t = await fetch(file, { cache: "no-cache" }).then(r => r.ok ? r.text() : null);
    if (t) return JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, ""));
  } catch { /* tolerate a missing dataset */ }
  return null;
}

Promise.all([
  loadOne("map_data_ao.js"),
  loadOne("map_data_ae.js"),
]).then(datasets => {
  state.games = datasets.filter(d => d && d.levels && d.levels.length);
  if (!state.games.length) {
    $("gameName").textContent = "Map data failed to load.";
    $("help").textContent = "map data failed to load — check that map_data_ao.js / map_data_ae.js are served";
    return;
  }
  state.games.forEach(G => {
    const b = document.createElement("button");
    b.textContent = G.id;
    b.title = G.game;
    b.dataset.key = G.id;
    b.onclick = () => selectGame(G);
    gameBtns.appendChild(b);
  });
  resize();
  if (!applyHash()) selectGame(state.games[0]);
});
