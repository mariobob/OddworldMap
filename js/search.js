// Global TLV search: scope bar, grouped results, keyboard navigation.

import { esc, extrasText } from "./util.js";
import { fieldEntries } from "./fields.js";
import { parseQuery, queryTerms, matchesQuery, rankFor } from "./searchquery.js";
import { searchInput, searchResults, scopeBar } from "./dom.js";
import { state } from "./state.js";
import { fieldPrefsFor, getSettings } from "./settings.js";
import { jumpToTlv } from "./navigate.js";

const HIT_CAP = 1500,
  GROUP_MAX = 8;
let searchTimer = null;
let searchScope = "all"; // all | game | level | path (relative to the current selection)

// search matches the full field set regardless of the user's display prefs, so
// any field is findable even when it isn't shown by default. The game keys each
// value transform by the field's per-game type; raw follows the display setting
// so a query matches whichever representation the user sees (raw ints or words).
function tlvSearchText(t, game, raw) {
  return (t.name + " " + extrasText(t, " ", { mode: "all", game, raw })).toLowerCase();
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

// mark every occurrence of every term, merging overlaps, escaping each segment
function highlight(text, terms) {
  const lower = text.toLowerCase();
  const ranges = [];
  for (const term of terms) {
    if (!term) continue; // indexOf("") would never advance
    for (let i = lower.indexOf(term); i >= 0; i = lower.indexOf(term, i + term.length))
      ranges.push([i, i + term.length]);
  }
  if (!ranges.length) return esc(text);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  let out = "",
    pos = 0;
  for (const [s, e] of merged) {
    out += esc(text.slice(pos, s)) + "<mark>" + esc(text.slice(s, e)) + "</mark>";
    pos = e;
  }
  return out + esc(text.slice(pos));
}

function hitButton(h, terms) {
  const b = document.createElement("button");
  b.className = "hit";
  let ex = extrasText(h.t, " ", fieldPrefsFor(h.G.id));
  // the index matches every field but the row shows only the visible ones; a
  // hit on a hidden field would look inexplicable, so append what matched
  const visible = `${h.t.name} ${ex}`.toLowerCase();
  const missing = terms.filter((term) => !visible.includes(term));
  if (missing.length) {
    const matched = fieldEntries(h.t, {
      mode: "all",
      game: h.G.id,
      raw: getSettings().showRawValues,
    })
      .map(([k, v]) => `${k}=${v}`)
      .filter((s) => missing.some((term) => s.toLowerCase().includes(term)));
    if (matched.length) ex += (ex ? " " : "") + matched.join(" ");
  }
  b.innerHTML =
    `<span class="loc">${h.L.short} P${h.P.id}</span> ${highlight(h.t.name, terms)}` +
    (ex ? ` <span class="ex">${highlight(ex, terms)}</span>` : "");
  b.onclick = () => jumpToTlv(h.G, h.L, h.P, h.t);
  return b;
}

function runSearch(q) {
  searchResults.innerHTML = "";
  q = q.trim();
  if (q.length < 2) {
    searchScope = "all";
    updateScopeBar();
    return;
  }

  const orGroups = parseQuery(q);
  const terms = queryTerms(orGroups);
  const raw = getSettings().showRawValues;
  const hits = [];
  outer: for (const G of state.games)
    for (const L of G.levels)
      for (const P of L.paths)
        for (const t of P.tlvs)
          if (matchesQuery(tlvSearchText(t, G.id, raw), orGroups)) {
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
    g.hits.sort((a, b) => rankFor(a.t.name, terms) - rankFor(b.t.name, terms));
    const head = document.createElement("div");
    head.className = "shead";
    head.innerHTML = `<span>${g.label}</span><span>${g.hits.length}</span>`;
    searchResults.appendChild(head);
    g.hits.slice(0, GROUP_MAX).forEach((h) => searchResults.appendChild(hitButton(h, terms)));
    if (g.hits.length > GROUP_MAX) {
      const rest = g.hits.slice(GROUP_MAX);
      const btn = document.createElement("button");
      btn.className = "showmore";
      btn.textContent = `show ${rest.length} more`;
      btn.onclick = () => {
        rest.forEach((h) => searchResults.insertBefore(hitButton(h, terms), btn));
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
