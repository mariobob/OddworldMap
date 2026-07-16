import { test } from "node:test";
import assert from "node:assert/strict";
import { CATS, catOf } from "../../js/config.js";

test("catOf buckets known names and falls back to meta", () => {
  assert.equal(catOf({ name: "LCDStatusBoard" }).key, "board");
  assert.equal(catOf({ name: "Slig" }).key, "enemy");
  assert.equal(catOf({ name: "HandStone" }).key, "switch");
  assert.equal(catOf({ name: "NoSuchObject" }).key, "meta");
});

test("CATS keys are unique", () => {
  const keys = CATS.map(c => c.key);
  assert.equal(new Set(keys).size, keys.length);
});

// NAME_CAT is built by forEach, so a name listed twice would silently last-win
test("no TLV name is claimed by two categories", () => {
  const seen = new Map();
  for (const c of CATS)
    for (const n of c.names) {
      assert.ok(!seen.has(n), `"${n}" is in both "${seen.get(n)}" and "${c.key}"`);
      seen.set(n, c.key);
    }
});
