// DOM-free interpretation of the decoded map data: TLV destinations,
// entry-path analysis, view math and the permalink format. Kept importable in
// bare Node for the unit tests.

import { clamp } from "./util.js";
import { ZOOM_MIN, ZOOM_MAX } from "./config.js";
import { state } from "./state.js";

export function computeEntryPaths(data) {
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

// where a door/portal/well leads: prefers a destination that differs from the
// current level+path unless it names a paired target object
export function destOf(t, lvl = state.lvl, path = state.path) {
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

// zoom the camera by factor about a fixed canvas point: the world spot under
// (px, py) stays put
export function zoomAt(cam, factor, px, py) {
  const z = clamp(cam.z * factor, ZOOM_MIN, ZOOM_MAX);
  return { x: cam.x + px / cam.z - px / z, y: cam.y + py / cam.z - py / z, z };
}

// ---- permalinks: #GAME/LEVEL/PATH/x/y/zoom -----------------------------
export function formatHash(gameId, levelShort, pathId, cam) {
  return `#${gameId}/${levelShort}/${pathId}/${Math.round(cam.x)}/${Math.round(cam.y)}/${cam.z.toFixed(2)}`;
}

// null for an empty hash; view is null unless x/y/z are all present. Numbers
// may come back NaN — the caller resolves and validates against the data.
export function parseHash(hash) {
  const h = hash.replace(/^#/, "");
  if (!h) return null;
  const parts = h.split("/");
  return {
    game: parts[0].toUpperCase(),
    level: (parts[1] || "").toUpperCase(),
    path: +parts[2],
    view: parts[3] != null && parts.length >= 6 ? { x: +parts[3], y: +parts[4], z: +parts[5] } : null,
  };
}
