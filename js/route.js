// Route planner: waypoint editing, the distance readout bar and the route's
// lifecycle. The polyline itself renders in render.js whenever state.route
// has points; state.show.route only gates editing, so a shared route link
// opens visible with click-to-follow still live.

import { MAX_ROUTE_PTS } from "./config.js";
import { formatDist, routeTotal } from "./util.js";
import { $ } from "./dom.js";
import { state } from "./state.js";
import { scheduleDraw } from "./render.js";
import { scheduleHash } from "./navigate.js";

const bar = $("routeBar"),
  stats = $("routeStats"),
  undoBtn = $("routeUndo"),
  clearBtn = $("routeClear");

let routePath = null; // the path the waypoints were plotted on

// user edits announce themselves and serialize into the hash; applyHash sets
// state.route directly and dispatches the event itself
function edited(push) {
  window.dispatchEvent(new CustomEvent("route-changed"));
  scheduleHash(push);
}

export function addRoutePoint(pt) {
  if (!state.path) return;
  const p = { x: Math.round(pt.x), y: Math.round(pt.y) }; // ints, so the hash round-trips exactly
  const last = state.route?.at(-1);
  if (last && last.x === p.x && last.y === p.y) return; // double-click: no zero-length leg
  if (state.route?.length >= MAX_ROUTE_PTS) return; // parser cap; unreachable by hand
  (state.route ??= []).push(p);
  edited(false);
}

export function undoRoutePoint() {
  if (!state.route) return;
  state.route.pop();
  if (!state.route.length) state.route = null;
  edited(false);
}

function clearRoute() {
  if (!state.route) return;
  state.route = null;
  edited(true); // a push: the previous history entry keeps the route, so Back restores it
}

undoBtn.onclick = undoRoutePoint;
clearBtn.onclick = clearRoute;

// one sync point for every mutation source (edits, mode toggle, applyHash)
window.addEventListener("route-changed", () => {
  routePath = state.route ? state.path : null;
  bar.hidden = !(state.show.route || state.route);
  undoBtn.disabled = clearBtn.disabled = !state.route;
  const n = state.route?.length;
  stats.textContent = n
    ? `${n} pt${n === 1 ? "" : "s"} · ${formatDist(routeTotal(state.route))}`
    : "click the map to add waypoints";
  scheduleDraw();
});

// waypoints don't outlive their path; same-path re-selections (every pushed
// hash write re-applies the hash) keep the route
window.addEventListener("selection-changed", () => {
  if (state.route && state.path !== routePath) {
    // no hash write: the selection's own push serializes the cleared state
    // (its debounced timer runs after this synchronous listener)
    state.route = null;
    window.dispatchEvent(new CustomEvent("route-changed"));
  }
});
