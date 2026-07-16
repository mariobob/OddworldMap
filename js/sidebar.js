// Sidebar controls: category filters, display toggles, PNG export.

import { CATS, catOf } from "./config.js";
import { $, cv, filterBox } from "./dom.js";
import { state } from "./state.js";
import { draw } from "./render.js";

// filters
const catUI = new Map();   // category -> its checkbox and count elements
CATS.forEach(c => {
  const lab = document.createElement("label");
  lab.innerHTML = `<span class="sw" style="background:${c.color}"></span>
    <input type="checkbox" autocomplete="off" ${c.on ? "checked" : ""}>
    <span>${c.label}</span><span class="cnt"></span>`;
  const cb = lab.querySelector("input");
  cb.onchange = () => { c.on = cb.checked; draw(); };
  catUI.set(c, { cb, cnt: lab.querySelector(".cnt") });
  filterBox.appendChild(lab);
});
function setAllFilters(on) {
  CATS.forEach(c => { c.on = on; catUI.get(c).cb.checked = on; });
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
  CATS.forEach(c => catUI.get(c).cnt.textContent = counts[c.key] || "");
}
window.addEventListener("selection-changed", updateCounts);
