import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  sanitizeAnnotations,
  setAnnotations,
  pathDisplayName,
  levelInfo,
} from "../../js/annotations.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../../${name}`, import.meta.url), "utf8"));

test("sanitizeAnnotations: tolerates a missing or garbage file", () => {
  assert.deepEqual(sanitizeAnnotations(null), {});
  assert.deepEqual(sanitizeAnnotations("nonsense"), {});
  assert.deepEqual(sanitizeAnnotations(42), {});
  assert.deepEqual(sanitizeAnnotations({ AO: null, AE: "x" }), {});
});

test("sanitizeAnnotations: copies only known sections with expected types", () => {
  const s = sanitizeAnnotations({
    AO: {
      levels: {
        S1: { name: "Main Menu", note: "menu level", junk: 1 },
        R9: { note: "no name: dropped" },
        R8: { name: "  untrimmed  " },
      },
      paths: { R1: { 15: "Free-Fire Zone", 16: "", 17: 3 }, L1: "not an object" },
      future: { anything: true },
    },
  });
  assert.deepEqual(s, {
    AO: {
      levels: { S1: { name: "Main Menu", note: "menu level" } },
      paths: { R1: { 15: "Free-Fire Zone" } },
    },
  });
});

test("pathDisplayName: a curated name overrides, the disc name shows otherwise", () => {
  setAnnotations({ AO: { paths: { R1: { 15: "Curated" } } } });
  assert.equal(pathDisplayName("AO", "R1", { id: 15, name: "Disc Name" }), "Curated");
  assert.equal(pathDisplayName("AO", "R1", { id: 15 }), "Curated"); // numeric id vs string key
  assert.equal(pathDisplayName("AO", "R1", { id: 16, name: "Disc Name" }), "Disc Name");
  assert.equal(pathDisplayName("AO", "R1", { id: 16 }), null);
  assert.equal(pathDisplayName("AO", "R2", { id: 15 }), null);
  assert.equal(pathDisplayName("AE", "R1", { id: 15 }), null); // unannotated game
  setAnnotations(null);
  assert.equal(pathDisplayName("AO", "R1", { id: 15, name: "Disc Name" }), "Disc Name");
  assert.equal(pathDisplayName("AO", "R1", { id: 15 }), null);
});

test("levelInfo: hit, miss, and unloaded game", () => {
  setAnnotations({ AO: { levels: { S1: { name: "Main Menu" } } } });
  assert.deepEqual(levelInfo("AO", "S1"), { name: "Main Menu" });
  assert.equal(levelInfo("AO", "R1"), null);
  assert.equal(levelInfo("AE", "S1"), null);
  setAnnotations(null);
});

// ---- schema sanity over the shipped file, cross-checked against the shipped
// map data: annotations are hand-curated, so typos and dead entries (a note
// for a level the map renders) must not ship
test("annotations.json entries all point at live targets", () => {
  const ann = load("annotations.json");
  const data = { AO: load("map_data_ao.json"), AE: load("map_data_ae.json") };

  for (const [game, g] of Object.entries(ann)) {
    assert.ok(game in data, `game ${game} is a shipped dataset`);
    const levels = new Map(data[game].levels.map((l) => [l.short, l]));
    for (const k of Object.keys(g))
      assert.ok(["levels", "paths"].includes(k), `${game}.${k} known`);

    for (const [short, v] of Object.entries(g.levels ?? {})) {
      assert.ok(!levels.has(short), `${game} ${short}: level annotations are for off-map levels`);
      assert.ok("name" in v, `${game} ${short}: a note-only entry never displays — name required`);
      const keys = Object.keys(v);
      assert.ok(
        keys.every((k) => ["name", "note"].includes(k)),
        `${game} ${short}: known keys`,
      );
      for (const k of keys)
        assert.ok(v[k] && v[k] === v[k].trim(), `${game} ${short}.${k} is a trimmed string`);
    }

    for (const [short, byId] of Object.entries(g.paths ?? {})) {
      const L = levels.get(short);
      assert.ok(L, `${game} ${short}: path annotations need an on-map level`);
      for (const [id, name] of Object.entries(byId)) {
        assert.match(id, /^(0|[1-9]\d*)$/, `${game} ${short} P${id}: canonical id key`);
        const P = L.paths.find((p) => p.id === +id);
        assert.ok(P, `${game} ${short} P${id}: path exists`);
        assert.ok(
          typeof name === "string" && name && name === name.trim(),
          `${game} ${short} P${id}: trimmed non-empty name`,
        );
        // an override may refine a disc name, never erase it: the authentic
        // label must stay visible inside the curated one ("Zulag 2 — Lobby")
        if (P.name)
          assert.ok(
            name.includes(P.name),
            `${game} ${short} P${id}: override "${name}" keeps the disc name "${P.name}"`,
          );
      }
    }
  }
});
