import { test } from "node:test";
import assert from "node:assert/strict";
import { setGeometry, dX, dY, wX, wY, CELL_W, CELL_H } from "../../js/state.js";
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

test("setGeometry updates the exported cell-size live bindings", () => {
  setGeometry(SYNTH_GEOMETRY); // cell size differs from both games and the defaults
  assert.equal(CELL_W, 100);
  assert.equal(CELL_H, 50);
  assert.equal(dX(400 + 40 + 30), 100 + 15); // cell 1, 30 units in at 0.5 scale
  setGeometry(AO_GEOMETRY);
  assert.equal(CELL_W, 368);
});
