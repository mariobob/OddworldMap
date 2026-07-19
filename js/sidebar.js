// Sidebar controls: category filters, display toggles, PNG export, feedback link.

import { CATS, catOf } from "./config.js";
import { $, cv, filterBox } from "./dom.js";
import { state } from "./state.js";
import { draw } from "./render.js";
import { getViewSnapshot, viewChanged } from "./settings.js";

// persisted view options (when "remember" is on) override the HTML/config defaults
const snap = getViewSnapshot();

// filters
const catDefaults = new Map(CATS.map((c) => [c.key, c.on])); // config defaults, captured before the snapshot merge
const catUI = new Map(); // category -> its checkbox and count elements
CATS.forEach((c) => {
  if (snap && c.key in snap.cats) c.on = snap.cats[c.key];
  const lab = document.createElement("label");
  lab.innerHTML = `<span class="sw" style="background:${c.color}"></span>
    <input type="checkbox" autocomplete="off" ${c.on ? "checked" : ""}>
    <span>${c.label}</span><span class="cnt"></span>`;
  const cb = lab.querySelector("input");
  cb.onchange = () => {
    c.on = cb.checked;
    viewChanged();
    draw();
  };
  catUI.set(c, { cb, cnt: lab.querySelector(".cnt") });
  filterBox.appendChild(lab);
});
function setFilters(onFor) {
  CATS.forEach((c) => {
    c.on = onFor(c);
    catUI.get(c).cb.checked = c.on;
  });
  viewChanged();
  draw();
}
$("fAll").onclick = () => setFilters(() => true);
$("fNone").onclick = () => setFilters(() => false);
$("fReset").onclick = () => setFilters((c) => catDefaults.get(c.key));

// display toggles: state.show mirrors the sidebar checkboxes (initial state comes from the HTML)
const showUI = new Map(); // show key -> its checkbox
function syncShow(key, cb) {
  state.show[key] = cb.checked;
  if (key === "ruler") {
    if (!state.show.ruler) state.ruler = null;
    cv.style.cursor = state.show.ruler ? "crosshair" : "";
  }
}
for (const [key, id] of Object.entries({
  grid: "tGrid",
  coll: "tColl",
  fg: "tFg",
  labels: "tLabels",
  dim: "tDim",
  ruler: "tRuler",
})) {
  const cb = $(id);
  if (snap && key in snap.show) cb.checked = snap.show[key];
  state.show[key] = cb.checked;
  cb.onchange = () => {
    syncShow(key, cb);
    viewChanged();
    draw();
  };
  showUI.set(key, cb);
}
// the g/c/f shortcuts flip the same checkboxes the pointer does
export function toggleShow(key) {
  const cb = showUI.get(key);
  cb.checked = !cb.checked;
  syncShow(key, cb);
  viewChanged();
  draw();
}

$("tReset").onclick = () => {
  for (const [key, cb] of showUI) {
    cb.checked = cb.defaultChecked; // the HTML checked attribute is the source of the defaults
    syncShow(key, cb);
  }
  viewChanged();
  draw();
};

$("exportBtn").onclick = () => {
  cv.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `oddworld-${state.data.id.toLowerCase()}${state.lvl ? "-" + state.lvl.short : ""}${state.path ? "-P" + state.path.id : ""}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, "image/png");
};

// feedback mail: attach the current permalink so reports carry their location
const fb = $("feedbackLink");
fb.onclick = () => {
  const addr = ["feedback", "oddworldmap.com"].join("@");
  fb.href = `mailto:${addr}?subject=${encodeURIComponent("Oddworld Map feedback")}&body=${encodeURIComponent(`\n\nViewing: ${location.href}`)}`;
};

function updateCounts() {
  const counts = {};
  state.path.tlvs.forEach((t) => {
    const c = catOf(t);
    counts[c.key] = (counts[c.key] || 0) + 1;
  });
  CATS.forEach((c) => (catUI.get(c).cnt.textContent = counts[c.key] || ""));
}
window.addEventListener("selection-changed", updateCounts);
