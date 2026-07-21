import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setGeometry,
  dX,
  dY,
  wX,
  wY,
  CELL_W,
  CELL_H,
  worldLen,
  routeTotal,
} from "../../js/state.js";
import { AO_GEOMETRY, AE_GEOMETRY, SYNTH_GEOMETRY } from "./fixtures.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("AO: the visible window maps 1:1 onto the cell", () => {
  setGeometry(AO_GEOMETRY);
  assert.equal(dX(256), 0); // window left edge -> cell left edge
  assert.equal(dY(120), 0);
  assert.equal(dX(256 + 368), 368); // window right edge -> cell right edge
  assert.equal(dX(2 * 1024 + 256 + 100), 2 * 368 + 100); // cell 2, 100 units into the window
  assert.equal(dY(3 * 480 + 120 + 50), 3 * 240 + 50);
});

test("AO: cross-cell spans compress the hidden margins", () => {
  setGeometry(AO_GEOMETRY);
  // 100 units into cell 0's window -> the same point one cell over is one cell width away
  assert.equal(dX(1024 + 256 + 100) - dX(256 + 100), 368);
});

test("AE: whole cells scale into the art", () => {
  setGeometry(AE_GEOMETRY);
  assert.equal(dX(0), 0);
  assert.equal(dX(375), 368); // continuous at the cell boundary
  assert.equal(dY(260), 240);
  close(dX(375 / 2), 368 / 2); // interior scales linearly
});

test("world<->draw round-trips inside the visible window", () => {
  for (const g of [AO_GEOMETRY, AE_GEOMETRY, SYNTH_GEOMETRY]) {
    setGeometry(g);
    for (const cell of [0, 1, 5]) {
      const wx = cell * g.worldW + g.winX + g.visW / 3;
      const wy = cell * g.worldH + g.winY + g.visH / 3;
      close(wX(dX(wx)), wx);
      close(wY(dY(wy)), wy);
    }
  }
});

test("worldLen converts draw-space lengths to world units", () => {
  setGeometry(AO_GEOMETRY); // 1:1 — identity
  assert.equal(worldLen(3, 4), 5);
  setGeometry(AE_GEOMETRY); // the art squeezes 375x260-unit screens into 368x240
  close(worldLen(368, 0), 375);
  close(worldLen(0, -240), 260); // sign-insensitive, like a length should be
  close(worldLen(368, 240), Math.hypot(375, 260));
  setGeometry(SYNTH_GEOMETRY); // 2:1 scaling on both axes
  assert.equal(worldLen(50, 0), 100);
});

test("routeTotal sums polyline legs in world units", () => {
  setGeometry(AO_GEOMETRY);
  assert.equal(routeTotal([{ x: 3, y: 4 }]), 0); // a single waypoint has no legs
  assert.equal(
    routeTotal([
      { x: 0, y: 0 },
      { x: 30, y: 40 },
      { x: 30, y: 100 },
    ]),
    110,
  );
  setGeometry(AE_GEOMETRY);
  // one full screen down in draw space is 260 world units, not 240
  close(
    routeTotal([
      { x: 0, y: 0 },
      { x: 0, y: 240 },
    ]),
    260,
  );
});

test("setGeometry updates the exported cell-size live bindings", () => {
  setGeometry(SYNTH_GEOMETRY); // cell size differs from both games and the defaults
  assert.equal(CELL_W, 100);
  assert.equal(CELL_H, 50);
  assert.equal(dX(400 + 40 + 30), 100 + 15); // cell 1, 30 units in at 0.5 scale
  setGeometry(AO_GEOMETRY);
  assert.equal(CELL_W, 368);
});
