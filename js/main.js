import { clamp, esc, extrasText, segDist } from "./util.js";
import { ZOOM_MIN, ZOOM_MAX, FOCUS_ZOOM_MIN, FOCUS_ZOOM_MAX, FOCUS_SCREENS, FLASH_MS,
         TIP_MAX_W, narrowMQ, COLOR, CATS, catOf, LINE_COLORS, LINE_NAMES } from "./config.js";
import { $, cv, ctx, tip, hud, menuBtn, scrim, gameBtns, levelBtns, pathBtns, filterBox,
         searchInput, searchResults, scopeBar } from "./dom.js";

// Each game maps world coordinates to screen artwork differently (data.geometry):
// AO cameras occupy 1024x480-unit world cells with a 368x240 window at +256/+120
// (1:1 world:pixel; Map.cpp SetActiveCam + ScreenManager xpos/ypos); AE cameras
// are 375x260-unit cells shown scaled into 368x240. Screens are laid out edge to
// edge at cellW x cellH pitch either way.
let CELL_W = 368, CELL_H = 240;
let GEO = null, SX = 1, SY = 1;

function setGeometry(g) {
  GEO = g;
  CELL_W = g.cellW; CELL_H = g.cellH;
  SX = g.cellW / g.visW; SY = g.cellH / g.visH;
}

let GAMES_DATA = [];   // one dataset per available game
let DATA = null;       // current game's dataset
let ENTRY = {};        // per game: level short -> Set of path ids arrived into from other levels

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

function dX(wx) { const c = Math.floor(wx / GEO.worldW); return c * CELL_W + (wx - c * GEO.worldW - GEO.winX) * SX; }
function dY(wy) { const c = Math.floor(wy / GEO.worldH); return c * CELL_H + (wy - c * GEO.worldH - GEO.winY) * SY; }
function wX(dx) { const c = Math.floor(dx / CELL_W); return c * GEO.worldW + GEO.winX + (dx - c * CELL_W) / SX; }
function wY(dy) { const c = Math.floor(dy / CELL_H); return c * GEO.worldH + GEO.winY + (dy - c * CELL_H) / SY; }

// ---- state ------------------------------------------------------------
let lvl = null, path = null;
let cam = { x: 0, y: 0, z: 0.3 };   // world offset + zoom (px per unit)
const images = {};                   // png -> Image
let hoverTlvs = [], mouse = {x:0,y:0};
let panMoved = false;
let flash = null;          // {x, y, t0} follow-destination highlight
let ruler = null;          // {x1, y1, x2, y2} in draw space
let measuring = false;

const isNarrow = () => narrowMQ.matches;
document.body.classList.toggle("menu-open", !isNarrow());   // set before first paint: open on wide, out of the way on narrow
function toggleMenu(open) { document.body.classList.toggle("menu-open", open ?? !document.body.classList.contains("menu-open")); }
menuBtn.onclick = () => toggleMenu();
scrim.onclick = () => toggleMenu(false);

function resize() {
  cv.width = cv.clientWidth * devicePixelRatio;
  cv.height = cv.clientHeight * devicePixelRatio;
  draw();
}
window.addEventListener("resize", resize);   // catches devicePixelRatio changes, which leave the map box untouched
new ResizeObserver(resize).observe($("main"));   // the sidebar slide resizes the map without a window resize

// ---- UI build ---------------------------------------------------------
// highlight the button whose data-key matches, clear the rest
function markOn(box, key) {
  for (const b of box.children) b.classList.toggle("on", b.dataset.key === key);
}

function selectGame(G, keepView) {
  DATA = G;
  setGeometry(G.geometry);
  markOn(gameBtns, G.id);
  $("gameName").textContent = G.game;
  ENTRY = computeEntryPaths(G);
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
  lvl = L;
  markOn(levelBtns, L.short);
  pathBtns.innerHTML = "";
  L.paths.forEach(P => {
    const b = document.createElement("button");
    b.textContent = "P" + P.id;
    b.dataset.key = String(P.id);
    if (ENTRY[L.short] && ENTRY[L.short].has(P.id)) {
      b.classList.add("entry");
      b.title = "entry point (arrived at from another level)";
    }
    b.onclick = () => selectPath(P);
    pathBtns.appendChild(b);
  });
  if (L.paths.length) selectPath(L.paths[0]);
}

function selectPath(P) {
  path = P;
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
    const w = path.w * CELL_W, h = path.h * CELL_H;
    const zx = cv.clientWidth / (w + 200), zy = cv.clientHeight / (h + 200);
    cam.z = Math.max(ZOOM_MIN, Math.min(zx, zy));
    cam.x = -(cv.clientWidth / cam.z - w) / 2;
    cam.y = -(cv.clientHeight / cam.z - h) / 2;
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
// display toggles: `show` mirrors the sidebar checkboxes (initial state comes from the HTML)
const show = {};
for (const [key, id] of Object.entries({ grid: "tGrid", coll: "tColl", fg: "tFg",
                                         labels: "tLabels", dim: "tDim", ruler: "tRuler" })) {
  const cb = $(id);
  show[key] = cb.checked;
  cb.onchange = () => {
    show[key] = cb.checked;
    if (key === "ruler") { if (!show.ruler) ruler = null; cv.style.cursor = show.ruler ? "crosshair" : ""; }
    draw();
  };
}
$("exportBtn").onclick = () => {
  cv.toBlob(blob => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `oddworld-${DATA.id.toLowerCase()}${lvl ? "-" + lvl.short : ""}${path ? "-P" + path.id : ""}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, "image/png");
};

function updateCounts() {
  const counts = {};
  path.tlvs.forEach(t => { const c = catOf(t); counts[c.key] = (counts[c.key] || 0) + 1; });
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
  const differs = d => d && !(lvl && path && d.lv === lvl.short && d.pa === path.id && d.target == null);
  return differs(a) ? a : (differs(b) ? b : (a || b));
}

function selectPathById(id) {
  const P = lvl.paths.find(p => p.id === id);
  if (!P) return false;
  selectPath(P);
  return true;
}

// center on (fx, fy) zoomed to a few screens across, flash the spot
function focusOn(fx, fy) {
  cam.z = clamp(Math.min(cv.clientWidth / (FOCUS_SCREENS * CELL_W), cv.clientHeight / (FOCUS_SCREENS * CELL_H)),
                FOCUS_ZOOM_MIN, FOCUS_ZOOM_MAX);
  cam.x = fx - cv.clientWidth / (2 * cam.z);
  cam.y = fy - cv.clientHeight / (2 * cam.z);
  camToken++;   // cancel any fit still waiting on layout
  flash = { x: fx, y: fy, t0: performance.now() };
  animateFlash();
  scheduleHash(true);
}

function navigateToDest(d) {
  if (!cv.clientWidth) { requestAnimationFrame(() => navigateToDest(d)); return; }
  const L = DATA.levels.find(l => l.short === d.lv);
  if (!L) return;
  if (lvl !== L) selectLevel(L);
  if (!selectPathById(d.pa)) return;

  // door numbers are only unique per camera, so resolve the destination
  // camera cell first and match the target door inside it
  let cell = null;
  if (d.ca != null) {
    const suffix = "C" + String(d.ca).padStart(2, "0");
    const cm = path.cams.find(c => c.name && c.name.endsWith(suffix));
    if (cm) cell = cm.cell;
  }
  let fx = null, fy = null;
  if (d.target != null) {
    const inCell = t => cell == null ||
      (Math.floor(t.x1 / GEO.worldW) === cell % path.w && Math.floor(t.y1 / GEO.worldH) === Math.floor(cell / path.w));
    const tgt = path.tlvs.find(t => t.name === d.target.name && (t.extra || {})[d.target.field] === d.target.value && inCell(t)) ||
                path.tlvs.find(t => t.name === d.target.name && (t.extra || {})[d.target.field] === d.target.value);
    if (tgt) { fx = (dX(tgt.x1) + dX(tgt.x2)) / 2; fy = (dY(tgt.y1) + dY(tgt.y2)) / 2; }
  }
  if (fx == null && cell != null) {
    fx = (cell % path.w) * CELL_W + CELL_W / 2;
    fy = Math.floor(cell / path.w) * CELL_H + CELL_H / 2;
  }
  if (fx == null) return;   // path-level target: selectPath already fit the view
  focusOn(fx, fy);
}

function animateFlash() {
  if (!flash) return;
  if (performance.now() - flash.t0 > FLASH_MS) { flash = null; draw(); return; }
  draw();
  requestAnimationFrame(animateFlash);
}

// ---- global search ------------------------------------------------------
let searchTimer = null;

function tlvSearchText(t) {
  return (t.name + " " + extrasText(t)).toLowerCase();
}

const HIT_CAP = 1500, GROUP_MAX = 8;
let searchScope = "all";   // all | game | level | path (relative to the current selection)

function scopeAccepts(h) {
  if (searchScope === "game") return h.G === DATA;
  if (searchScope === "level") return h.G === DATA && h.L === lvl;
  if (searchScope === "path") return h.G === DATA && h.L === lvl && h.P === path;
  return true;
}

function scopeLabel() {
  return { all: "everywhere", game: DATA.id, level: `${DATA.id} · ${lvl.short}`,
           path: `${DATA.id} · ${lvl.short} P${path.id}` }[searchScope];
}

function updateScopeBar() {
  if (!DATA || !lvl || !path) return;
  scopeBar.innerHTML = "";
  for (const [key, label] of [["all", "All"], ["game", DATA.id], ["level", lvl.short], ["path", "P" + path.id]]) {
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
  for (const G of GAMES_DATA)
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
  if (path) group("p", `${DATA.id} · ${lvl.short} P${path.id}`);
  if (lvl) group("l", `${DATA.id} · ${lvl.short}`);
  for (const G of [DATA, ...GAMES_DATA.filter(G => G !== DATA)]) group("g" + G.id, G.id);
  for (const h of hits) {
    if (h.G === DATA && h.L === lvl && h.P === path) group("p").hits.push(h);
    else if (h.G === DATA && h.L === lvl) group("l").hits.push(h);
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
  const perGame = GAMES_DATA.map(G => `${G.id} ${hits.filter(h => h.G === G).length}`).join(" · ");
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
  if (DATA !== G) selectGame(G, true);
  if (lvl !== L) selectLevel(L);
  if (path !== P) selectPathById(P.id);
  focusOn((dX(t.x1) + dX(t.x2)) / 2, (dY(t.y1) + dY(t.y2)) / 2);
}

// ---- permalinks: #LEVEL/PATH/x/y/zoom ----------------------------------
let applyingHash = false, hashTimer = null;

function hashFor() {
  return `#${DATA.id}/${lvl.short}/${path.id}/${Math.round(cam.x)}/${Math.round(cam.y)}/${cam.z.toFixed(2)}`;
}

function scheduleHash(push) {
  if (applyingHash || !path) return;
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
  const G = GAMES_DATA.find(g => g.id === parts[0].toUpperCase());
  if (!G) return false;
  parts = parts.slice(1);
  const L = G.levels.find(l => l.short === (parts[0] || "").toUpperCase());
  if (!L) return false;
  applyingHash = true;
  if (DATA !== G) selectGame(G, true);
  if (lvl !== L) selectLevel(L);
  if (!selectPathById(+parts[1])) { applyingHash = false; return false; }
  if (parts[2] != null && parts.length >= 5) {
    cam.x = +parts[2]; cam.y = +parts[3];
    cam.z = clamp(+parts[4], ZOOM_MIN, ZOOM_MAX);
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
  if (show.ruler) {
    const w = worldAtMouse();
    ruler = { x1: w.x, y1: w.y, x2: w.x, y2: w.y };
    measuring = true;
    draw();
    return;
  }
  panning = true; panMoved = false; cv.classList.add("panning"); panStart = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
});
cv.addEventListener("click", () => {
  if (panMoved || show.ruler) return;
  for (const t of hoverTlvs) {
    const d = destOf(t);
    if (d) { navigateToDest(d); return; }
  }
});
window.addEventListener("mouseup", () => { measuring = false; if (panning && panMoved) scheduleHash(false); panning = false; cv.classList.remove("panning"); });
window.addEventListener("mousemove", e => {
  const r = cv.getBoundingClientRect();
  mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  if (measuring && ruler) {
    const w = worldAtMouse();
    ruler.x2 = w.x; ruler.y2 = w.y;
  }
  if (panning) {
    if (Math.abs(e.clientX - panStart.x) + Math.abs(e.clientY - panStart.y) > 4) panMoved = true;
    cam.x = panStart.cx - (e.clientX - panStart.x) / cam.z;
    cam.y = panStart.cy - (e.clientY - panStart.y) / cam.z;
  }
  updateHover();
  scheduleDraw();
});
cv.addEventListener("wheel", e => {
  e.preventDefault();
  const f = Math.exp(-e.deltaY * 0.0015);
  const wx = cam.x + mouse.x / cam.z, wy = cam.y + mouse.y / cam.z;
  cam.z = clamp(cam.z * f, ZOOM_MIN, ZOOM_MAX);
  cam.x = wx - mouse.x / cam.z;
  cam.y = wy - mouse.y / cam.z;
  updateHover();
  scheduleDraw();
  scheduleHash(false);
}, { passive: false });

function worldAtMouse() { return { x: cam.x + mouse.x / cam.z, y: cam.y + mouse.y / cam.z }; }

// ---- touch: one finger pans, two fingers pinch-zoom (into the map, not the page) ----
let touchState = null;   // { mode, ... }
function touchXY(t) { const r = cv.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; }

cv.addEventListener("touchstart", e => {
  e.preventDefault();
  if (e.touches.length === 1) {
    const p = touchXY(e.touches[0]);
    touchState = { mode: "pan", sx: p.x, sy: p.y, cx: cam.x, cy: cam.y, moved: false, tapT: e.target };
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
    cam.x = touchState.cx - (p.x - touchState.sx) / cam.z;
    cam.y = touchState.cy - (p.y - touchState.sy) / cam.z;
    scheduleDraw();
  } else if (touchState.mode === "pinch" && e.touches.length === 2) {
    const a = touchXY(e.touches[0]), b = touchXY(e.touches[1]);
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const wx = cam.x + mx / cam.z, wy = cam.y + my / cam.z;   // anchor at pinch midpoint
    cam.z = clamp(cam.z * dist / touchState.dist, ZOOM_MIN, ZOOM_MAX);
    cam.x = wx - mx / cam.z;
    cam.y = wy - my / cam.z;
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
  if (!path) return;
  const w = worldAtMouse();
  let hoverLines = [];
  if (show.coll) {
    const tol = 6 / cam.z;
    hoverLines = path.lines.filter(([x1, y1, x2, y2]) =>
      segDist(w.x, w.y, dX(x1), dY(y1), dX(x2), dY(y2)) <= tol).slice(0, 4);
  }
  hoverTlvs = path.tlvs.filter(t => {
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
  hud.textContent = `world x ${Math.round(wX(w.x))}  y ${Math.round(wY(w.y))}  ·  zoom ${cam.z.toFixed(2)}`;
}

// ---- drawing ----------------------------------------------------------
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

// coalesce bursty redraw sources (pointer moves, image loads) into one paint per frame
let drawPending = false;
function scheduleDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => { drawPending = false; draw(); });
}

function draw() {
  if (!path) { ctx.fillStyle = COLOR.bg; ctx.fillRect(0, 0, cv.width, cv.height); return; }
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
  GAMES_DATA = datasets.filter(d => d && d.levels && d.levels.length);
  if (!GAMES_DATA.length) {
    $("gameName").textContent = "Map data failed to load.";
    $("help").textContent = "map data failed to load — check that map_data_ao.js / map_data_ae.js are served";
    return;
  }
  GAMES_DATA.forEach(G => {
    const b = document.createElement("button");
    b.textContent = G.id;
    b.title = G.game;
    b.dataset.key = G.id;
    b.onclick = () => selectGame(G);
    gameBtns.appendChild(b);
  });
  resize();
  if (!applyHash()) selectGame(GAMES_DATA[0]);
});
