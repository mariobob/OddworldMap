// Per-camera object list: clicking a screen with nothing to follow under the
// pointer lists everything on it. Hover doesn't exist on touch devices, so
// this panel is also the mobile way to inspect a screen's objects.

import { esc, extrasText } from "./util.js";
import { CATS, catOf } from "./config.js";
import { $ } from "./dom.js";
import { state, dX, dY } from "./state.js";
import { cellAt } from "./model.js";
import { setHighlight } from "./render.js";
import { jumpToTlv } from "./navigate.js";

const panel = $("camPanel"),
  title = $("camPanelTitle"),
  body = $("camPanelBody");

let listedPath = null; // the path the open panel was built from

function closeCamPanel() {
  panel.hidden = true;
  listedPath = null;
  setHighlight(null);
}

// (x, y) in draw space: list the camera cell under it, all categories —
// the panel is an inventory of the screen, not a view of the filters
export function openCamPanel(x, y) {
  const { path } = state;
  if (!path) return;
  const cell = cellAt(x, y, path);
  const cam = cell != null && path.cams.find((c) => c.cell === cell);
  if (!cam) {
    closeCamPanel(); // clicked the void between/outside screens: dismiss
    return;
  }
  // objects bucket by rect centre in draw space — an inventory rule; the
  // resolution logic (tlvCell) buckets by world top-left, which can differ
  // for an edge-straddling object
  const inCell = (t) => cellAt((dX(t.x1) + dX(t.x2)) / 2, (dY(t.y1) + dY(t.y2)) / 2, path) === cell;
  const byCat = new Map(CATS.map((c) => [c, []]));
  let n = 0;
  for (const t of path.tlvs)
    if (inCell(t)) {
      byCat.get(catOf(t)).push(t);
      n++;
    }

  title.innerHTML = `${esc(cam.name)} <span class="e">· ${n} object${n === 1 ? "" : "s"}</span>`;
  body.innerHTML = "";
  for (const [c, tlvs] of byCat) {
    if (!tlvs.length) continue;
    const head = document.createElement("div");
    head.className = "cp-cat";
    head.innerHTML = `<span class="sw" style="background:${c.color}"></span>${c.label}`;
    body.appendChild(head);
    for (const t of tlvs) {
      const b = document.createElement("button");
      b.className = "cp-row";
      const ex = extrasText(t);
      b.innerHTML = esc(t.name) + (ex ? ` <span class="e">${esc(ex)}</span>` : "");
      b.onclick = () => jumpToTlv(state.data, state.lvl, state.path, t);
      b.onmouseenter = () => setHighlight(t);
      b.onmouseleave = () => setHighlight(null);
      body.appendChild(b);
    }
  }
  if (!n) body.innerHTML = `<div class="cp-none">no objects on this screen</div>`;
  listedPath = path;
  panel.hidden = false;
}

$("camPanelClose").onclick = closeCamPanel;
// close when the listed path is gone; same-path re-selections (every pushed
// hash write re-applies the hash) keep the panel, so a row jump doesn't
// yank the list away mid-browse
window.addEventListener("selection-changed", () => {
  if (!panel.hidden && state.path !== listedPath) closeCamPanel();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !panel.hidden && !e.target.matches?.("input, textarea, select"))
    closeCamPanel();
});
