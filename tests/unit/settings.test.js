import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SETTINGS_DEFAULTS,
  SHOW_KEYS,
  displayLabel,
  sanitizeLocationHash,
  sanitizeSettings,
  sanitizeView,
} from "../../js/settings.js";
import { CATS } from "../../js/config.js";

// sanitizeSettings adds fieldPrefs (a non-boolean) on top of the boolean defaults
const DEFAULTS = { ...SETTINGS_DEFAULTS, fieldPrefs: { mode: "default", byType: {} } };

test("sanitizeSettings: absent or unreadable storage yields the defaults", () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULTS);
  assert.deepEqual(sanitizeSettings("{not json"), DEFAULTS);
  assert.deepEqual(sanitizeSettings('"a string"'), DEFAULTS);
  assert.deepEqual(sanitizeSettings("null"), DEFAULTS);
});

test("sanitizeSettings: known boolean keys apply, everything else is dropped", () => {
  const s = sanitizeSettings('{"rememberView":false,"bogus":true}');
  assert.equal(s.rememberView, false);
  assert.deepEqual(Object.keys(s).sort(), Object.keys(DEFAULTS).sort());
});

test("sanitizeSettings: fieldPrefs validates mode and per-type key lists", () => {
  const good = sanitizeSettings(
    '{"fieldPrefs":{"mode":"more","byType":{"Slig":["start_state","pause_time"]}}}',
  );
  assert.deepEqual(good.fieldPrefs, {
    mode: "more",
    byType: { Slig: ["start_state", "pause_time"] },
  });
  // garbage mode/byType fall back cleanly; non-string keys are filtered out
  const bad = sanitizeSettings('{"fieldPrefs":{"mode":"bogus","byType":{"Slig":[1,"ok",null]}}}');
  assert.deepEqual(bad.fieldPrefs, { mode: "default", byType: { Slig: ["ok"] } });
  // a fresh byType each time: mutating one result must not leak into the next
  good.fieldPrefs.byType.Slig.push("leaked");
  assert.deepEqual(sanitizeSettings(null).fieldPrefs, { mode: "default", byType: {} });
});

test("sanitizeSettings: a wrong-typed value keeps its default", () => {
  assert.equal(sanitizeSettings('{"rememberView":"yes"}').rememberView, true);
  assert.equal(sanitizeSettings('{"rememberView":0}').rememberView, true);
});

test("sanitizeView: absent or unreadable snapshot yields null", () => {
  assert.equal(sanitizeView(null), null);
  assert.equal(sanitizeView("{not json"), null);
  assert.equal(sanitizeView("42"), null);
});

test("sanitizeView: a full snapshot round-trips", () => {
  const show = Object.fromEntries(SHOW_KEYS.map((k, i) => [k, i % 2 === 0]));
  const cats = Object.fromEntries(CATS.map((c, i) => [c.key, i % 2 === 1]));
  assert.deepEqual(sanitizeView(JSON.stringify({ show, cats })), { show, cats });
});

test("sanitizeView: unknown keys and wrong-typed values are dropped", () => {
  const v = sanitizeView(
    JSON.stringify({
      show: { grid: false, bogus: true, coll: "yes", ruler: true, route: true }, // ruler/route are never remembered
      cats: { mud: false, gone: true, door: 1 },
    }),
  );
  assert.deepEqual(v, { show: { grid: false }, cats: { mud: false } });
});

test("displayLabel: code alone by default, code (name) in full-names mode", () => {
  assert.equal(displayLabel("MI", "Necrum Mines", false), "MI");
  assert.equal(displayLabel("MI", "Necrum Mines", true), "MI (Necrum Mines)");
  assert.equal(displayLabel("AO", "Oddworld: Abe's Oddysee", true), "AO (Abe's Oddysee)");
  assert.equal(displayLabel("P1", "", true), "P1"); // most paths carry no name
  assert.equal(displayLabel("P1", undefined, true), "P1");
});

test("sanitizeLocationHash: keeps a permalink-shaped string, rejects the rest", () => {
  const h = "#AO/R1/15/-100/-1139/0.16";
  assert.equal(sanitizeLocationHash(h), h);
  assert.equal(sanitizeLocationHash(""), null);
  assert.equal(sanitizeLocationHash("#"), null);
  assert.equal(sanitizeLocationHash("AO/R1/15"), null); // no leading #
  assert.equal(sanitizeLocationHash(null), null);
  assert.equal(sanitizeLocationHash(42), null);
});
