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

// destinations may dangle, but their level fields must be decoded shorts —
// a raw numeric id means the builder's id map missed a level (the AE ender
// ids regressed this way once)
test("destination level fields are level shorts, never raw ids", () => {
  for (const file of ["map_data_ao.json", "map_data_ae.json"]) {
    const data = load(file);
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs)
          for (const k of ["to_level", "alt_level", "view1_level", "view2_level", "view3_level"]) {
            const v = t.extra && t.extra[k];
            if (v != null)
              assert.equal(
                typeof v,
                "string",
                `${data.id} ${L.short} P${P.id} ${t.name} ${k}=${v}`,
              );
          }
  }
});

// path display names come from game data only: AO R2's zulag save-name table
// and AE's ender-id destinations; every other path stays unnamed
test("path names in the shipped data are exactly the game-defined ones", () => {
  const expected = {
    "AO R2": {
      15: "Zulag 1",
      16: "Zulag 1",
      18: "Zulag 1",
      19: "Zulag 1",
      20: "Zulag 1",
      1: "Zulag 2",
      2: "Zulag 2",
      3: "Zulag 2",
      10: "Zulag 2",
      5: "Zulag 3",
      7: "Zulag 3",
      9: "Zulag 3",
      12: "Zulag 3",
      13: "Zulag 3",
      4: "Zulag 4",
      8: "Zulag 4",
      11: "Zulag 4",
      14: "Zulag 4",
    },
    "AE SV": {
      9: "Mudanchee Vault Ender",
      10: "Mudanchee Vault Ender",
      11: "Mudanchee Vault Ender",
      14: "Mudanchee Vault Ender",
    },
    "AE PV": { 13: "Mudomo Vault Ender" },
    "AE FD": { 11: "FeeCo Depot Ender", 13: "FeeCo Depot Ender", 14: "FeeCo Depot Ender" },
    "AE BA": { 11: "Barracks Ender", 16: "Barracks Ender" },
    "AE BW": { 12: "Bonewerkz Ender", 13: "Bonewerkz Ender", 14: "Bonewerkz Ender" },
  };
  const found = {};
  for (const file of ["map_data_ao.json", "map_data_ae.json"]) {
    const data = load(file);
    for (const L of data.levels)
      for (const P of L.paths) if (P.name) (found[`${data.id} ${L.short}`] ??= {})[P.id] = P.name;
  }
  assert.deepEqual(found, expected);
});

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
// objects. Dangling destinations (e.g. AE MI P11) must not be flagged, and
// neither must 0-target doors whose camera merely holds them (SV P6, BR P21
// carry numbers 7 and 1 — the engine's hunt for door 0 skips them).
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
