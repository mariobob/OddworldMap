// Shared mutable viewer state and the world-to-draw coordinate transforms.

// Each game maps world coordinates to screen artwork differently (data.geometry):
// AO cameras occupy 1024x480-unit world cells with a 368x240 window at +256/+120
// (1:1 world:pixel; Map.cpp SetActiveCam + ScreenManager xpos/ypos); AE cameras
// are 375x260-unit cells shown scaled into 368x240. Screens are laid out edge to
// edge at cellW x cellH pitch either way.
export let GEO = null,
  CELL_W = 368,
  CELL_H = 240;
let SX = 1,
  SY = 1;

export function setGeometry(g) {
  GEO = g;
  CELL_W = g.cellW;
  CELL_H = g.cellH;
  SX = g.cellW / g.visW;
  SY = g.cellH / g.visH;
}

export function dX(wx) {
  const c = Math.floor(wx / GEO.worldW);
  return c * CELL_W + (wx - c * GEO.worldW - GEO.winX) * SX;
}
export function dY(wy) {
  const c = Math.floor(wy / GEO.worldH);
  return c * CELL_H + (wy - c * GEO.worldH - GEO.winY) * SY;
}
export function wX(dx) {
  const c = Math.floor(dx / CELL_W);
  return c * GEO.worldW + GEO.winX + (dx - c * CELL_W) / SX;
}
export function wY(dy) {
  const c = Math.floor(dy / CELL_H);
  return c * GEO.worldH + GEO.winY + (dy - c * CELL_H) / SY;
}

export const state = {
  games: [], // one dataset per available game
  data: null, // current game's dataset
  lvl: null, // current level
  path: null, // current path
  entry: {}, // per game: level short -> Set of path ids arrived into from other levels
  cam: { x: 0, y: 0, z: 0.3 }, // view offset + zoom (px per draw unit)
  show: {}, // display toggles, mirrored from the sidebar checkboxes
  ruler: null, // {x1, y1, x2, y2} in draw space
  route: null, // route waypoints [{x, y}, …] in draw space; drawn whenever set (show.route only gates editing)
};
