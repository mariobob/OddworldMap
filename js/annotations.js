// Curated names and notes from annotations.json (hand-edited source; see
// README). A curated name is a deliberate override — the in-game name shows
// only where no curated one is defined.
// The raw file shape stays contained here — callers get plain lookups.
// Leaf module: no imports, importable in bare Node.

let ann = {};

const cleanString = (v) => (typeof v === "string" && v && v === v.trim() ? v : null);

// copy only known sections with the expected types; anything else is dropped,
// so a missing, garbage or future-shaped file can never break the viewer
export function sanitizeAnnotations(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [game, g] of Object.entries(raw)) {
    if (!g || typeof g !== "object") continue;
    const levels = {};
    const paths = {};
    for (const [short, v] of Object.entries(g.levels || {})) {
      const name = cleanString(v?.name);
      const note = cleanString(v?.note);
      if (name) levels[short] = note ? { name, note } : { name };
    }
    for (const [short, byId] of Object.entries(g.paths || {})) {
      if (!byId || typeof byId !== "object") continue;
      for (const [id, name] of Object.entries(byId)) {
        const n = cleanString(name);
        if (n) (paths[short] ??= {})[id] = n;
      }
    }
    out[game] = { levels, paths };
  }
  return out;
}

export function setAnnotations(raw) {
  ann = sanitizeAnnotations(raw);
}

// display name for a path: the curated override, else the disc name, else null
export function pathDisplayName(gameId, levelShort, path) {
  return ann[gameId]?.paths?.[levelShort]?.[String(path.id)] || path.name || null;
}

// {name, note?} for a level the map doesn't render, or null
export function levelInfo(gameId, levelShort) {
  return ann[gameId]?.levels?.[levelShort] ?? null;
}
