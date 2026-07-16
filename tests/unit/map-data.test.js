import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeEntryPaths } from "../../js/model.js";
import { AO_GEOMETRY, AE_GEOMETRY } from "./fixtures.js";

// Schema sanity over the shipped data: the invariants the viewer relies on.
// Referential integrity of to_/alt_ links and LINE_NAMES coverage of all line
// types are deliberately NOT asserted — the shipped data contains dangling and
// cross-format refs, and the viewer tolerates unknown values by design.

const load = name => JSON.parse(readFileSync(new URL(`../../${name}`, import.meta.url), "utf8"));

for (const [file, id, geometry] of [["map_data_ao.json", "AO", AO_GEOMETRY],
                                    ["map_data_ae.json", "AE", AE_GEOMETRY]]) {
  test(`${file} matches the viewer's expectations`, () => {
    const data = load(file);
    assert.equal(data.id, id);
    assert.deepEqual(data.geometry, geometry);
    assert.ok(data.levels.length > 0);

    const shorts = data.levels.map(L => L.short);
    assert.equal(new Set(shorts).size, shorts.length, "level shorts are unique");

    for (const L of data.levels) {
      assert.ok(L.paths.length > 0, `${L.short} has paths`);
      for (const P of L.paths) {
        assert.ok(Number.isInteger(P.id) && P.w > 0 && P.h > 0, `${L.short} P${P.id} dimensions`);
        for (const c of P.cams) {
          assert.ok(c.cell >= 0 && c.cell < P.w * P.h, `${L.short} P${P.id} cam cell in range`);
          assert.match(c.name, /C\d\d$/, "navigateToDest resolves cameras by this suffix");
        }
        for (const t of P.tlvs) {
          assert.equal(typeof t.name, "string");
          assert.ok(t.x1 <= t.x2 && t.y1 <= t.y2, `${L.short} P${P.id} ${t.name} rect ordered`);
        }
        for (const line of P.lines) assert.equal(line.length, 5);
      }
    }

    assert.ok(Object.keys(computeEntryPaths(data)).length > 0, "entry paths found");
  });
}
