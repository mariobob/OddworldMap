// DOM-free interpretation of the decoded map data: TLV destinations,
// entry-path analysis, view math and the permalink format. Kept importable in
// bare Node for the unit tests.

import { clamp } from "./util.js";
import { ZOOM_MIN, ZOOM_MAX, FOCUS_ZOOM_MIN, FOCUS_ZOOM_MAX, FOCUS_SCREENS } from "./config.js";
import { GEO, state, CELL_W, CELL_H } from "./state.js";

export function computeEntryPaths(data) {
  const entries = {};
  const add = (lv, pa) => {
    if (lv != null && pa != null) (entries[lv] ??= new Set()).add(pa);
  };
  for (const L of data.levels)
    for (const P of L.paths)
      for (const t of P.tlvs) {
        const e = t.extra || {};
        if (e.to_level && e.to_level !== L.short) add(e.to_level, e.to_path);
        if (e.alt_level && e.alt_level !== L.short) add(e.alt_level, e.alt_path);
        if (t.name === "AbeStart") add(L.short, P.id); // game start / re-entry
      }
  return entries;
}

// where a door/portal/well leads: prefers a destination that differs from the
// current level+path unless it names a paired target object
export function destOf(t, lvl = state.lvl, path = state.path) {
  const e = t.extra || {};
  // hand stones show other cameras rather than transitioning; follow the first
  // view (AO stones carry full level/path/camera triples, AE ones bare camera
  // ids within their own path)
  if (e.view1_cam != null) {
    const lv = e.view1_level ?? (lvl && lvl.short);
    const pa = e.view1_path ?? (path && path.id);
    return lv != null && pa != null ? { lv, pa, ca: e.view1_cam, target: null } : null;
  }
  // paired objects land on their counterpart within the destination camera;
  // 0 is a pair number like any other (the placeholder ~250 doors and
  // teleporters share — the engine's arrival hunt finds the 0-numbered partner)
  let target = null;
  if (e["target_door#"] != null)
    target = { name: "Door", field: "door#", value: e["target_door#"] };
  else if (e["target_tp#"] != null)
    target = { name: "Teleporter", field: "tp#", value: e["target_tp#"] };
  else if (t.name === "BirdPortal" && e.portal === "travel") target = { name: "BirdPortalExit" };
  const mk = (lv, pa, ca, tgt) => (lv != null && pa != null ? { lv, pa, ca, target: tgt } : null);
  const a = mk(e.to_level, e.to_path, e.to_cam, target);
  const b = mk(e.alt_level, e.alt_path, e.alt_cam, null);
  const differs = (d) =>
    d && !(lvl && path && d.lv === lvl.short && d.pa === path.id && d.target == null);
  return differs(a) ? a : differs(b) ? b : a || b;
}

// camera id -> grid cell within a path (cam names end in C##)
export function camCell(path, camId) {
  if (camId == null) return null;
  const suffix = "C" + String(camId).padStart(2, "0");
  const cm = path.cams.find((c) => c.name && c.name.endsWith(suffix));
  return cm ? cm.cell : null;
}

// grid cell containing a TLV's top-left corner (spans can cross cells)
export const tlvCell = (t, path, geo) =>
  Math.floor(t.y1 / geo.worldH) * path.w + Math.floor(t.x1 / geo.worldW);

// the paired TLV a destination lands on: door numbers are only unique per
// camera, so match inside the destination camera first, path-wide as a fallback.
// Positional targets get no fallback — a name-only target (no pair number)
// resolves only when the stated camera holds exactly one candidate, and pair
// number 0 (shared by many placeholder doors) only inside the stated camera,
// mirroring the engine's forward hunt from there.
export function resolveTarget(d, path, geo) {
  if (!d || !d.target) return null;
  const cell = camCell(path, d.ca);
  const match = (t) =>
    t.name === d.target.name &&
    (d.target.field == null || (t.extra || {})[d.target.field] === d.target.value);
  const positional = d.target.field == null || d.target.value === 0;
  if (positional && cell == null) return null;
  if (d.target.field == null) {
    const hits = path.tlvs.filter((t) => match(t) && tlvCell(t, path, geo) === cell);
    return hits.length === 1 ? hits[0] : null;
  }
  return (
    path.tlvs.find((t) => match(t) && (cell == null || tlvCell(t, path, geo) === cell)) ||
    (positional ? null : path.tlvs.find(match)) ||
    null
  );
}

// a paired object (door, teleporter) whose destination names its own camera and
// resolves back to the object itself; a dangling destination whose path-wide
// fallback merely lands on it doesn't count
export function isLoopback(t, lvl = state.lvl, path = state.path, geo = GEO) {
  if (!lvl || !path) return false;
  const d = destOf(t, lvl, path);
  return !!(
    d &&
    d.lv === lvl.short &&
    d.pa === path.id &&
    camCell(path, d.ca) === tlvCell(t, path, geo) &&
    resolveTarget(d, path, geo) === t
  );
}

// zoom the camera by factor about a fixed canvas point: the world spot under
// (px, py) stays put
export function zoomAt(cam, factor, px, py) {
  const z = clamp(cam.z * factor, ZOOM_MIN, ZOOM_MAX);
  return { x: cam.x + px / cam.z - px / z, y: cam.y + py / cam.z - py / z, z };
}

// the view for jumping to a point: centered on it, a few screens across
export function focusView(fx, fy, cw, ch) {
  const z = clamp(
    Math.min(cw / (FOCUS_SCREENS * CELL_W), ch / (FOCUS_SCREENS * CELL_H)),
    FOCUS_ZOOM_MIN,
    FOCUS_ZOOM_MAX,
  );
  return { x: fx - cw / (2 * z), y: fy - ch / (2 * z), z };
}

// ---- permalinks: #GAME/LEVEL/PATH/x/y/zoom[/Name@x1,y1] -----------------
export function formatHash(gameId, levelShort, pathId, cam, obj) {
  const base = `#${gameId}/${levelShort}/${pathId}/${Math.round(cam.x)}/${Math.round(cam.y)}/${cam.z.toFixed(2)}`;
  return obj ? `${base}/${obj.name}@${obj.x1},${obj.y1}` : base;
}

// null for an empty hash; view is null unless x/y/z are all present; obj names
// a TLV to highlight, identified by name and origin. Numbers may come back
// NaN — the caller resolves and validates against the data.
export function parseHash(hash) {
  const h = hash.replace(/^#/, "");
  if (!h) return null;
  const parts = h.split("/");
  const om = parts.length >= 7 ? /^(\w+)@(-?\d+),(-?\d+)$/.exec(parts[6]) : null;
  return {
    game: parts[0].toUpperCase(),
    level: (parts[1] || "").toUpperCase(),
    path: +parts[2],
    view:
      parts[3] != null && parts.length >= 6 ? { x: +parts[3], y: +parts[4], z: +parts[5] } : null,
    obj: om ? { name: om[1], x1: +om[2], y1: +om[3] } : null,
  };
}
