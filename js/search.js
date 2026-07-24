// Global TLV search: scope bar, grouped results, keyboard navigation.

import { esc, extrasText } from "./util.js";
import { fieldEntries } from "./fields.js";
import { searchInput, searchResults, scopeBar } from "./dom.js";
import { state } from "./state.js";
import { fieldPrefsFor } from "./settings.js";
import { jumpToTlv } from "./navigate.js";

const HIT_CAP = 1500,
  GROUP_MAX = 8;
let searchTimer = null;
let searchScope = "all"; // all | game | level | path (relative to the current selection)

// search matches the full field set regardless of the user's display prefs, so
// any field is findable even when it isn't shown by default. The game is passed
// through so prettify can key each value transform by the field's per-game type.
function tlvSearchText(t, game) {
  return (t.name + " " + extrasText(t, " ", { mode: "all", game })).toLowerCase();
}

function scopeAccepts(h) {
  if (searchScope === "game") return h.G === state.data;
  if (searchScope === "level") return h.G === state.data && h.L === state.lvl;
  if (searchScope === "path") return h.G === state.data && h.L === state.lvl && h.P === state.path;
  return true;
}

function scopeLabel() {
  return {
    all: "everywhere",
    game: state.data.id,
    level: `${state.data.id} · ${state.lvl.short}`,
    path: `${state.data.id} · ${state.lvl.short} P${state.path.id}`,
  }[searchScope];
}

function updateScopeBar() {
  if (!state.data || !state.lvl || !state.path) return;
  scopeBar.innerHTML = "";
  for (const [key, label] of [
    ["all", "All"],
    ["game", state.data.id],
    ["level", state.lvl.short],
    ["path", "P" + state.path.id],
  ]) {
    const b = document.createElement("button");
    b.textContent = label;
    if (searchScope === key) b.classList.add("on");
    b.onclick = () => {
      searchScope = key;
      updateScopeBar();
      runSearch(searchInput.value);
    };
    scopeBar.appendChild(b);
  }
}
window.addEventListener("selection-changed", updateScopeBar);

function highlight(text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return esc(text);
  return (
    esc(text.slice(0, i)) +
    "<mark>" +
    esc(text.slice(i, i + q.length)) +
    "</mark>" +
    esc(text.slice(i + q.length))
  );
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
  let ex = extrasText(h.t, " ", fieldPrefsFor(h.G.id));
  // the index matches every field but the row shows only the visible ones; a
  // hit on a hidden field would look inexplicable, so append what matched
  if (!`${h.t.name} ${ex}`.toLowerCase().includes(q)) {
    const matched = fieldEntries(h.t, { mode: "all", game: h.G.id })
      .map(([k, v]) => `${k}=${v}`)
      .filter((s) => s.toLowerCase().includes(q));
    if (matched.length) ex += (ex ? " " : "") + matched.join(" ");
  }
  b.innerHTML =
    `<span class="loc">${h.L.short} P${h.P.id}</span> ${highlight(h.t.name, q)}` +
    (ex ? ` <span class="ex">${highlight(ex, q)}</span>` : "");
  b.onclick = () => jumpToTlv(h.G, h.L, h.P, h.t);
  return b;
}

function runSearch(q) {
  searchResults.innerHTML = "";
  q = q.trim().toLowerCase();
  if (q.length < 2) {
    searchScope = "all";
    updateScopeBar();
    return;
  }

  const hits = [];
  outer: for (const G of state.games)
    for (const L of G.levels)
      for (const P of L.paths)
        for (const t of P.tlvs)
          if (tlvSearchText(t, G.id).includes(q)) {
            const h = { G, L, P, t };
            if (!scopeAccepts(h)) continue;
            hits.push(h);
            if (hits.length >= HIT_CAP) break outer;
          }

  // group by context: current path, then current level, then per game
  const groups = [];
  const byKey = {};
  const group = (key, label) =>
    byKey[key] || (byKey[key] = groups[groups.push({ label, hits: [] }) - 1]);
  if (state.path) group("p", `${state.data.id} · ${state.lvl.short} P${state.path.id}`);
  if (state.lvl) group("l", `${state.data.id} · ${state.lvl.short}`);
  for (const G of [state.data, ...state.games.filter((G) => G !== state.data)])
    group("g" + G.id, G.id);
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
    g.hits.slice(0, GROUP_MAX).forEach((h) => searchResults.appendChild(hitButton(h, q)));
    if (g.hits.length > GROUP_MAX) {
      const rest = g.hits.slice(GROUP_MAX);
      const btn = document.createElement("button");
      btn.className = "showmore";
      btn.textContent = `show ${rest.length} more`;
      btn.onclick = () => {
        rest.forEach((h) => searchResults.insertBefore(hitButton(h, q), btn));
        btn.remove();
      };
      searchResults.appendChild(btn);
    }
  }

  const more = document.createElement("div");
  more.className = "more";
  const perGame = state.games
    .map((G) => `${G.id} ${hits.filter((h) => h.G === G).length}`)
    .join(" · ");
  const summary = hits.length
    ? `${hits.length}${hits.length >= HIT_CAP ? "+" : ""} hit${hits.length === 1 ? "" : "s"}` +
      (searchScope === "all" ? ` — ${perGame}` : ` in ${scopeLabel()}`)
    : searchScope === "all"
      ? "no hits"
      : `no hits in ${scopeLabel()}`;
  more.textContent = summary + (searchScope === "all" ? "" : " — ");
  if (searchScope !== "all") {
    const widen = document.createElement("span");
    widen.className = "widen";
    widen.textContent = "search everywhere";
    widen.onclick = () => {
      searchScope = "all";
      updateScopeBar();
      runSearch(searchInput.value);
    };
    more.appendChild(widen);
  }
  searchResults.appendChild(more);
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(searchInput.value), 160);
});

// field-display settings change what result rows show or how values render (raw
// vs prettified, the show-more mode, per-type picks); re-render an active search
window.addEventListener("settings-changed", (e) => {
  const key = e.detail?.key;
  if (
    (key === "rawValues" || key === "fieldPrefs" || key === "fieldPicks") &&
    searchInput.value.trim().length >= 2
  )
    runSearch(searchInput.value);
});

// keyboard: "/" focuses search, Esc clears, arrows walk results, Enter jumps
let activeHit = -1;
function visibleHits() {
  return [...searchResults.querySelectorAll(".hit")];
}
function setActiveHit(i) {
  const hits = visibleHits();
  hits.forEach((b) => b.classList.remove("active"));
  activeHit = Math.max(-1, Math.min(i, hits.length - 1));
  if (activeHit >= 0) {
    hits[activeHit].classList.add("active");
    hits[activeHit].scrollIntoView({ block: "nearest" });
  }
}
window.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }
  if (document.activeElement !== searchInput) return;
  if (e.key === "Escape") {
    searchInput.value = "";
    runSearch("");
    searchInput.blur();
    setActiveHit(-1);
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    setActiveHit(activeHit + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setActiveHit(activeHit - 1);
  } else if (e.key === "Enter") {
    const hits = visibleHits();
    (hits[activeHit] || hits[0])?.click();
  } else {
    activeHit = -1;
  }
});
