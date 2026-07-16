import { test } from "node:test";
import assert from "node:assert/strict";
import { camCell, computeEntryPaths, destOf, formatHash, parseHash, resolveTarget, zoomAt } from "../../js/model.js";
import { ZOOM_MIN, ZOOM_MAX } from "../../js/config.js";
import { SYNTH_GEOMETRY, dataset, level, path, tlv } from "./fixtures.js";

const HERE = [{ short: "R1" }, { id: 15 }];   // current level/path stubs

// a TLV moved to world position (x, y); SYNTH_GEOMETRY cells are 400x200 units
const at = (t, x, y) => ({ ...t, x1: x, y1: y, x2: x + 10, y2: y + 10 });

test("destOf: primary destination wins when it leads elsewhere", () => {
  const t = tlv("Door", { to_level: "R2", to_path: 1, to_cam: 3 });
  assert.deepEqual(destOf(t, ...HERE), { lv: "R2", pa: 1, ca: 3, target: null });
});

test("destOf: self destination falls through to the alternate", () => {
  const t = tlv("WellExpress", { to_level: "R1", to_path: 15, to_cam: 1,
                                 alt_level: "R2", alt_path: 2, alt_cam: 4 });
  assert.deepEqual(destOf(t, ...HERE), { lv: "R2", pa: 2, ca: 4, target: null });
});

test("destOf: a paired target keeps even a same-path destination", () => {
  // door numbers are only unique per camera; 0 is a valid target (!= null, not truthiness)
  const t = tlv("Door", { to_level: "R1", to_path: 15, to_cam: 2, "target_door#": 0 });
  assert.deepEqual(destOf(t, ...HERE),
    { lv: "R1", pa: 15, ca: 2, target: { name: "Door", field: "door#", value: 0 } });
});

test("destOf: both destinations self -> primary still returned", () => {
  const t = tlv("Door", { to_level: "R1", to_path: 15, to_cam: 1 });
  assert.deepEqual(destOf(t, ...HERE), { lv: "R1", pa: 15, ca: 1, target: null });
});

test("destOf: no or incomplete destination -> null", () => {
  assert.equal(destOf(tlv("Slig"), ...HERE), null);
  assert.equal(destOf(tlv("Door", { to_level: "R2" }), ...HERE), null);   // path missing
});

test("camCell: zero-padded C## suffix lookup, null for unknown or missing ids", () => {
  const P = path(1, [], [{ cell: 0, name: "XXP01C01" }, { cell: 3, name: "XXP01C12" }], 2, 2);
  assert.equal(camCell(P, 1), 0);
  assert.equal(camCell(P, 12), 3);
  assert.equal(camCell(P, 7), null);
  assert.equal(camCell(P, null), null);
});

test("resolveTarget: matches inside the destination camera before anything else", () => {
  // same door# in two cameras: the destination camera's copy must win
  const a = at(tlv("Door", { "door#": 1 }), 50, 20);     // cell 0 -> C01
  const b = at(tlv("Door", { "door#": 1 }), 450, 20);    // cell 1 -> C02
  const P = path(1, [a, b], [{ cell: 0, name: "XXP01C01" }, { cell: 1, name: "XXP01C02" }], 2, 1);
  const target = { name: "Door", field: "door#", value: 1 };
  assert.equal(resolveTarget({ ca: 2, target }, P, SYNTH_GEOMETRY), b);
  assert.equal(resolveTarget({ ca: 1, target }, P, SYNTH_GEOMETRY), a);
});

test("resolveTarget: path-wide fallback when the destination camera has no match", () => {
  const a = at(tlv("Door", { "door#": 5 }), 50, 20);     // cell 0, not the target cam
  const P = path(1, [a], [{ cell: 0, name: "XXP01C01" }, { cell: 1, name: "XXP01C02" }], 2, 1);
  assert.equal(resolveTarget({ ca: 2, target: { name: "Door", field: "door#", value: 5 } }, P, SYNTH_GEOMETRY), a);
  assert.equal(resolveTarget({ ca: 2, target: { name: "Door", field: "door#", value: 9 } }, P, SYNTH_GEOMETRY), null);
});

test("resolveTarget: no paired target -> null", () => {
  const P = path(1, [at(tlv("Door", { "door#": 1 }), 50, 20)], [], 1, 1);
  assert.equal(resolveTarget({ ca: 1, target: null }, P, SYNTH_GEOMETRY), null);
  assert.equal(resolveTarget(null, P, SYNTH_GEOMETRY), null);
});

test("computeEntryPaths: cross-level links and AbeStart mark entries", () => {
  const data = dataset([
    level("R1", path(15, [
      tlv("AbeStart"),
      tlv("Door", { to_level: "R2", to_path: 1 }),
      tlv("Door", { to_level: "R1", to_path: 16 }),   // same level: not an entry
      tlv("WellExpress", { alt_level: "L1", alt_path: 5 }),
    ])),
    level("R2", path(1, [])),
    level("L1", path(5, [])),
  ]);
  const entries = computeEntryPaths(data);
  assert.deepEqual([...entries.R1], [15]);   // AbeStart only, not the same-level door
  assert.deepEqual([...entries.R2], [1]);
  assert.deepEqual([...entries.L1], [5]);
});

test("zoomAt keeps the world point under the anchor fixed", () => {
  const cam = { x: 100, y: 50, z: 0.5 };
  const [px, py] = [200, 120];
  const out = zoomAt(cam, 1.25, px, py);
  assert.equal(out.z, 0.625);
  assert.ok(Math.abs((cam.x + px / cam.z) - (out.x + px / out.z)) < 1e-9);
  assert.ok(Math.abs((cam.y + py / cam.z) - (out.y + py / out.z)) < 1e-9);
});

test("zoomAt clamps to the manual zoom range", () => {
  assert.equal(zoomAt({ x: 0, y: 0, z: 3 }, 100, 0, 0).z, ZOOM_MAX);
  assert.equal(zoomAt({ x: 0, y: 0, z: 0.05 }, 0.001, 0, 0).z, ZOOM_MIN);
});

test("formatHash rounds coordinates and fixes zoom to two decimals", () => {
  assert.equal(formatHash("AO", "R2", 1, { x: 177.4, y: 54.6, z: 2.234 }), "#AO/R2/1/177/55/2.23");
});

test("parseHash round-trips a formatted hash (against the rounded values)", () => {
  const p = parseHash(formatHash("AO", "R2", 1, { x: 177.4, y: 54.6, z: 2.234 }));
  assert.deepEqual(p, { game: "AO", level: "R2", path: 1, view: { x: 177, y: 55, z: 2.23 } });
});

test("parseHash: case-insensitive, partial and garbage inputs", () => {
  assert.equal(parseHash(""), null);
  assert.equal(parseHash("#"), null);
  assert.deepEqual(parseHash("#ao/r2/1"), { game: "AO", level: "R2", path: 1, view: null });
  assert.deepEqual(parseHash("#AO"), { game: "AO", level: "", path: NaN, view: null });
  // x/y without z: the view is ignored as a whole
  assert.deepEqual(parseHash("#AO/R2/1/10/20"), { game: "AO", level: "R2", path: 1, view: null });
  assert.ok(Number.isNaN(parseHash("#AO/R2/junk").path));
});
