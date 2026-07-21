// Small pure helpers shared across modules.

import { GRID_UNIT } from "./config.js";
import { fieldEntries } from "./fields.js";

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function esc(t) {
  return t.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

// decoded extra fields as "k=v k=v", skipping empty values
export const extrasText = (t, sep = " ", prefs) =>
  fieldEntries(t, prefs)
    .map(([k, v]) => `${k}=${v}`)
    .join(sep);

// a length in world units with its grid-square equivalent
export const formatDist = (len) => `${Math.round(len)}u ≈ ${(len / GRID_UNIT).toFixed(1)} grid`;

export function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1,
    dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
