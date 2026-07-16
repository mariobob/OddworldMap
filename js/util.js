// Small pure helpers shared across modules.

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function esc(t) { return t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// decoded extra fields as "k=v k=v", skipping empty values
export const extrasText = (t, sep = " ") => Object.entries(t.extra || {})
  .filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}=${v}`).join(sep);

export function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
