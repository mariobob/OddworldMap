import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeEntryPaths, isLoopback } from "../../js/model.js";
import { AO_GEOMETRY, AE_GEOMETRY } from "./fixtures.js";

// Schema sanity over the shipped data: the invariants the viewer relies on.
// Referential integrity of to_/alt_ links and LINE_NAMES coverage of all line
// types are deliberately NOT asserted — the shipped data contains dangling and
// cross-format refs, and the viewer tolerates unknown values by design.

const load = (name) => JSON.parse(readFileSync(new URL(`../../${name}`, import.meta.url), "utf8"));

for (const [file, id, geometry] of [
  ["map_data_ao.json", "AO", AO_GEOMETRY],
  ["map_data_ae.json", "AE", AE_GEOMETRY],
]) {
  test(`${file} matches the viewer's expectations`, () => {
    const data = load(file);
    assert.equal(data.id, id);
    assert.deepEqual(data.geometry, geometry);
    assert.ok(data.levels.length > 0);

    const shorts = data.levels.map((L) => L.short);
    assert.equal(new Set(shorts).size, shorts.length, "level shorts are unique");

    for (const L of data.levels) {
      assert.ok(L.paths.length > 0, `${L.short} has paths`);
      for (const P of L.paths) {
        assert.ok(Number.isInteger(P.id) && P.w > 0 && P.h > 0, `${L.short} P${P.id} dimensions`);
        for (const c of P.cams) {
          assert.ok(c.cell >= 0 && c.cell < P.w * P.h, `${L.short} P${P.id} cam cell in range`);
          assert.match(c.name, /C\d\d$/, "camCell resolves cameras by this suffix");
        }
        for (const t of P.tlvs) {
          assert.equal(typeof t.name, "string");
          assert.ok(t.x1 <= t.x2 && t.y1 <= t.y2, `${L.short} P${P.id} ${t.name} rect ordered`);
          assert.ok(
            Math.floor(t.x1 / geometry.worldW) < P.w && Math.floor(t.y1 / geometry.worldH) < P.h,
            `${L.short} P${P.id} ${t.name} origin inside the grid (tlvCell must not alias)`,
          );
        }
        for (const line of P.lines) assert.equal(line.length, 5);
      }
    }

    assert.ok(Object.keys(computeEntryPaths(data)).length > 0, "entry paths found");
  });
}

// every shipped hand stone is decoded: at least one view, no raw fallback,
// and no transition fields (views must not create entry markers)
test("hand stones in the shipped data carry decoded views", () => {
  for (const file of ["map_data_ao.json", "map_data_ae.json"]) {
    const data = load(file);
    let count = 0;
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs)
          if (t.name === "HandStone") {
            count++;
            assert.ok(
              t.extra && t.extra.view1_cam != null,
              `${data.id} ${L.short} P${P.id} stone lacks view1_cam`,
            );
            assert.ok(
              !("raw" in t.extra) && !("to_level" in t.extra),
              `${data.id} ${L.short} P${P.id} stone has stray fields`,
            );
          }
    assert.ok(count > 0, `${data.id}: no hand stones found`);
  }
});

// the shipped data contains exactly three genuinely self-referencing paired
// objects; dangling destinations (e.g. AE MI P11, SV P6) must not be flagged
test("loopbacks in the shipped data are exactly the three known ones", () => {
  const found = [];
  for (const [file, geometry] of [
    ["map_data_ao.json", AO_GEOMETRY],
    ["map_data_ae.json", AE_GEOMETRY],
  ]) {
    const data = load(file);
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs)
          if (isLoopback(t, L, P, geometry))
            found.push(`${data.id} ${L.short} P${P.id} ${t.name} (${t.x1},${t.y1})`);
  }
  assert.deepEqual(found, [
    "AO R1 P18 Door (8746,1232)",
    "AE SV P7 Door (1026,440)",
    "AE BW P7 Teleporter (199,439)",
  ]);
});
