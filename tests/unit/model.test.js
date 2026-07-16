import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEntryPaths, destOf, formatHash, parseHash } from "../../js/model.js";
import { dataset, level, path, tlv } from "./fixtures.js";

const HERE = [{ short: "R1" }, { id: 15 }];   // current level/path stubs

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
