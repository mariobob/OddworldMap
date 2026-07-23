// The "Fields" sidebar section, shown only when "Show more object fields" is
// on: a per-type checklist (notable fields pre-checked) that writes the user's
// picks into the current game's fieldPrefs.byType bucket.

import { $ } from "./dom.js";
import { state } from "./state.js";
import { defaultVisible } from "./fields.js";
import { getSettings, fieldPrefsFor, persistSettings } from "./settings.js";

const section = $("fieldPanel");
const body = section.querySelector(".fp-body");
const prefs = () => fieldPrefsFor(state.data.id);

// gameplay types (those carrying `fields`) on the current path, both the types
// and each one's union of field names sorted by name for scanning
function typesOnPath() {
  const byName = new Map();
  for (const t of (state.path && state.path.tlvs) || []) {
    if (!t.fields) continue;
    let keys = byName.get(t.name);
    if (!keys) byName.set(t.name, (keys = new Set()));
    for (const k of Object.keys(t.fields)) keys.add(k);
  }
  return [...byName.entries()]
    .map(([name, keys]) => ({ name, fields: [...keys].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// the fields currently shown for a type: its picks, or the defaults it carries
function shownFor(name, fields) {
  const picks = prefs().byType[name];
  const def = defaultVisible(name);
  return new Set(fields.filter((f) => (picks ? picks.includes(f) : def.has(f))));
}

function renderType({ name, fields }) {
  const shown = shownFor(name, fields);
  const det = document.createElement("details");
  det.className = "fp-type";

  const sum = document.createElement("summary");
  const nameEl = document.createElement("span");
  nameEl.textContent = name;
  const countEl = document.createElement("span");
  countEl.className = "fp-count";
  const recount = () => (countEl.textContent = `${shown.size} / ${fields.length}`);
  sum.append(nameEl, countEl);
  det.append(sum);
  recount();

  // pick edits stay local (no re-render) so an open row keeps its state
  const save = () => {
    prefs().byType[name] = [...shown];
    persistSettings();
  };

  const grid = document.createElement("div");
  grid.className = "fp-fields";
  const boxes = [];
  for (const f of fields) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = shown.has(f);
    cb.onchange = () => {
      if (cb.checked) shown.add(f);
      else shown.delete(f);
      save();
      recount();
    };
    boxes.push([cb, f]);
    label.append(cb, document.createTextNode(" " + f));
    grid.append(label);
  }

  const tools = document.createElement("div");
  tools.className = "fp-tools";
  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.textContent = "all";
  allBtn.onclick = () => {
    fields.forEach((f) => shown.add(f));
    boxes.forEach(([cb]) => (cb.checked = true));
    save();
    recount();
  };
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.textContent = "reset";
  resetBtn.onclick = () => {
    delete prefs().byType[name]; // truly back to defaults, so future default tweaks apply
    persistSettings();
    const def = shownFor(name, fields);
    shown.clear();
    def.forEach((f) => shown.add(f));
    boxes.forEach(([cb, f]) => (cb.checked = shown.has(f)));
    recount();
  };
  tools.append(allBtn, document.createTextNode(" · "), resetBtn);
  grid.append(tools);
  det.append(grid);
  return det;
}

let renderedPath = null; // the path the panel was built from

export function renderFieldPanel() {
  const on = getSettings().fieldPrefs.mode === "more"; // mode only: no game is selected at boot
  section.hidden = !on;
  renderedPath = state.path;
  body.textContent = "";
  if (!on) return;
  for (const type of typesOnPath()) body.append(renderType(type));
}

export function initFieldPanel() {
  // rebuild only when the path really changed: selection-changed re-fires for
  // the same path on every pushed hash write, and a rebuild would collapse
  // whichever type row the user has open
  window.addEventListener("selection-changed", () => {
    if (state.path !== renderedPath) renderFieldPanel();
  });
  window.addEventListener("settings-changed", (e) => {
    if (!e.detail || e.detail.key === "fieldPrefs") renderFieldPanel(); // show-more toggled
  });
  renderFieldPanel();
}
