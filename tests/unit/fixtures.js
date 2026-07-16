// Shared fixtures for the unit tests.

// the two shipped geometries; map-data.test.js pins the real data files to these
export const AO_GEOMETRY = { cellW: 368, cellH: 240, worldW: 1024, worldH: 480,
                             winX: 256, winY: 120, visW: 368, visH: 240 };
export const AE_GEOMETRY = { cellW: 368, cellH: 240, worldW: 375, worldH: 260,
                             winX: 0, winY: 0, visW: 375, visH: 260 };

// unlike either game (window offset AND 2:1 scaling, cell size ≠ the state.js
// defaults) so transform and live-binding bugs cannot hide behind real values
export const SYNTH_GEOMETRY = { cellW: 100, cellH: 50, worldW: 400, worldH: 200,
                                winX: 40, winY: 20, visW: 200, visH: 100 };

// minimal dataset builders, shaped like the generated map data
export const tlv = (name, extra = null) =>
  ({ t: 0, name, x1: 0, y1: 0, x2: 10, y2: 10, ...(extra ? { extra } : {}) });
export const path = (id, tlvs) => ({ id, w: 1, h: 1, cams: [], tlvs, lines: [] });
export const level = (short, ...paths) => ({ short, name: short, paths });
export const dataset = levels => ({ id: "XX", levels });
