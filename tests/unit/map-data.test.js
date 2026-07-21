import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { camCell, computeEntryPaths, isLoopback } from "../../js/model.js";
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
// and no transition fields (views must not create entry markers). Eight AE
// stones view cameras their shipped path no longer has — pinned so a rebuild
// changing that set is noticed (destOf offers those stones no follow); AO
// triples are resolved against the path they name.
test("hand stones in the shipped data carry decoded views", () => {
  const expectedDead = { AO: 0, AE: 8 };
  for (const file of ["map_data_ao.json", "map_data_ae.json"]) {
    const data = load(file);
    let count = 0,
      dead = 0;
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
            const viewPath =
              t.extra.view1_level == null
                ? P
                : data.levels
                    .find((l) => l.short === t.extra.view1_level)
                    ?.paths.find((p) => p.id === t.extra.view1_path);
            if (!viewPath || camCell(viewPath, t.extra.view1_cam) == null) dead++;
          }
    assert.ok(count > 0, `${data.id}: no hand stones found`);
    assert.equal(dead, expectedDead[data.id], `${data.id}: stones with a dead first view`);
  }
});

// every well in the shipped data carries its pair id, and express wells name
// the arrival well of each destination they emit
test("wells in the shipped data carry decoded pair ids", () => {
  let express = 0,
    locals = 0;
  for (const file of ["map_data_ao.json", "map_data_ae.json"]) {
    const data = load(file);
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs) {
          const where = `${data.id} ${L.short} P${P.id} (${t.x1},${t.y1})`;
          if (t.name === "WellExpress") {
            express++;
            assert.ok(t.extra && t.extra["well#"] != null, `${where} express lacks well#`);
            if (t.extra.to_level != null)
              assert.ok(t.extra["target_well#"] != null, `${where} lacks target_well#`);
            if (t.extra.alt_level != null)
              assert.ok(t.extra["alt_target_well#"] != null, `${where} lacks alt_target_well#`);
          } else if (t.name === "WellLocal" || t.name === "LocalWell") {
            locals++;
            assert.ok(t.extra && t.extra["well#"] != null, `${where} local well lacks well#`);
          }
        }
  }
  assert.ok(express > 0 && locals > 0, "wells found in both roles");
});

// creatures carry the complete raw field archive (the viewer prettifies + picks
// what to show): every one has `fields`, no `raw` fallback, and the key state
// fields are decoded to their expected value ranges. Distributions are pinned
// as a regression guard on the schema-driven extraction.
test("creatures in the shipped data carry a raw field archive", () => {
  const found = { AO: {}, AE: {} };
  for (const [file, id] of [
    ["map_data_ao.json", "AO"],
    ["map_data_ae.json", "AE"],
  ]) {
    const data = load(file);
    const jobs = {},
      emotions = {};
    let creatures = 0;
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs)
          if (t.name === "Mudokon" || t.name === "Slig" || t.name === "Slog") {
            creatures++;
            const f = t.fields;
            const where = `${id} ${L.short} P${P.id} ${t.name} (${t.x1},${t.y1})`;
            assert.ok(f && typeof f === "object", `${where} lacks fields`);
            assert.ok(!("raw" in (t.extra || {})), `${where} still raw`);
            if (t.name === "Mudokon") {
              const s = id === "AO" ? f.job : f.state;
              assert.ok(s >= 0 && s <= 4, `${where} state ${s} out of range`);
              if (id === "AO") jobs[s] = (jobs[s] || 0) + 1;
              if (id === "AE") emotions[f.emotion] = (emotions[f.emotion] || 0) + 1;
            } else if (t.name === "Slig") {
              assert.ok(
                typeof f.shoot_on_sight_delay === "number",
                `${where} lacks shoot_on_sight_delay`,
              );
              assert.ok(f.start_state >= 0 && f.start_state <= 6, `${where} start_state range`);
            } else {
              assert.ok(f.asleep === 0 || f.asleep === 1, `${where} asleep ${f.asleep}`);
            }
          }
    found[id] = { creatures, jobs, emotions };
  }
  // ground-truth pins from the disc: AO's 11 sit-chant (job=2) Monsaic natives,
  // and the AE Mudokon emotion spread
  assert.equal(found.AO.jobs[2], 11, "AO sit-chant Mudokons");
  assert.deepEqual(found.AE.emotions, { 0: 270, 1: 33, 2: 42, 3: 8, 4: 26 });
  assert.ok(found.AO.creatures > 0 && found.AE.creatures > 0, "creatures found in both games");
});

// the gotcha the whole feature turned on: R2 P8's patrolling Slig shoots on
// sight (shoot_on_sight_delay 0, no FREEZE warning), three-round burst
test("AO R2 P8 has the shoot-on-sight Slig", () => {
  const data = load("map_data_ao.json");
  const P = data.levels.find((l) => l.short === "R2").paths.find((p) => p.id === 8);
  const slig = P.tlvs.find((t) => t.name === "Slig" && t.x1 === 3500 && t.y1 === 191);
  assert.ok(slig, "gotcha Slig present");
  assert.equal(slig.fields.shoot_on_sight_delay, 0);
  assert.equal(slig.fields.bullet_shoot_count, 3);
  assert.equal(slig.fields.start_state, 1); // patrol
});

// the extraction now covers gameplay objects broadly, and the schema parser
// spreads the decomp's union-named Door hub ids across their real words
test("gameplay objects carry the field archive; Door hubs are distinct words", () => {
  for (const [file, id] of [
    ["map_data_ao.json", "AO"],
    ["map_data_ae.json", "AE"],
  ]) {
    const data = load(file);
    const withFields = new Set();
    let doorHubsVary = false;
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs) {
          if (t.fields) withFields.add(t.name);
          if (t.name === "Door" && t.fields) {
            assert.ok("start_state" in t.fields, `${id} Door lock state`); // door_closed is AO-only
            const hubs = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => t.fields[`hub_${i}_id`]);
            if (new Set(hubs).size > 1) doorHubsVary = true;
          }
        }
    assert.ok(
      doorHubsVary,
      `${id}: Door hub ids never vary — the schema parser's union fix regressed`,
    );
    assert.ok(withFields.size > 20, `${id}: only ${withFields.size} types carry fields`);
    for (const t of ["Door", "Mine"]) assert.ok(withFields.has(t), `${id} ${t} has fields`); // both games
  }
});

// the shipped data contains exactly three genuinely self-referencing paired
// objects. Dangling destinations (e.g. AE MI P11) must not be flagged, and
// neither must 0-target doors whose camera merely holds them (SV P6, BR P21
// carry numbers 7 and 1 — the engine's hunt for door 0 skips them), nor
// launcher wells whose every state exits within their own screen (destOf
// strips their pairing).
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
