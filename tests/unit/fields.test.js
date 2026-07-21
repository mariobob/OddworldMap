import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleFields, prettify, fieldEntries, DEFAULT_VISIBLE } from "../../js/fields.js";

test("visibleFields: default shows DEFAULT_VISIBLE, 'all' shows everything", () => {
  assert.equal(visibleFields("Slig", undefined), DEFAULT_VISIBLE);
  assert.equal(visibleFields("Slig", { mode: "default" }), DEFAULT_VISIBLE);
  assert.equal(visibleFields("Slig", { mode: "all" }), "all");
});

test("visibleFields: 'more' shows everything until a per-type pick exists", () => {
  // no picks yet -> the archive is revealed
  assert.equal(visibleFields("Slig", { mode: "more", byType: {} }), "all");
  // a per-type pick -> exactly those keys (the future picker's contract)
  const picked = visibleFields("Slig", { mode: "more", byType: { Slig: ["start_state"] } });
  assert.ok(picked instanceof Set && picked.has("start_state") && picked.size === 1);
  // a pick for a different type doesn't apply
  assert.equal(visibleFields("Slog", { mode: "more", byType: { Slig: ["start_state"] } }), "all");
});

test("prettify: enum ints map to text, Choice fields to booleans, unknowns raw", () => {
  assert.equal(prettify("job", 2), "sit chant");
  assert.equal(prettify("state", 4), "health ring giver");
  assert.equal(prettify("emotion", 2), "sad");
  assert.equal(prettify("start_state", 0), "listening");
  assert.equal(prettify("asleep", 1), true); // Choice -> boolean, not 1
  assert.equal(prettify("asleep", 0), false);
  assert.equal(prettify("deaf", 1), true);
  assert.equal(prettify("shoot_on_sight_delay", 0), 0); // not an enum: raw
  assert.equal(prettify("job", 9), 9); // out-of-range: raw
});

test("fieldEntries: asleep shows both states; deaf/blind show only when set", () => {
  const asleepSlog = { name: "Slog", extra: {}, fields: { asleep: 1, anger_switch_id: 0 } };
  const awakeSlog = { name: "Slog", extra: {}, fields: { asleep: 0, anger_switch_id: 0 } };
  assert.equal(Object.fromEntries(fieldEntries(asleepSlog, { mode: "default" })).asleep, true);
  assert.equal(Object.fromEntries(fieldEntries(awakeSlog, { mode: "default" })).asleep, false);

  const deafMud = { name: "Mudokon", extra: {}, fields: { job: 2, deaf: 1 } };
  const hearingMud = { name: "Mudokon", extra: {}, fields: { job: 1, deaf: 0 } };
  assert.equal(Object.fromEntries(fieldEntries(deafMud, { mode: "default" })).deaf, true);
  assert.ok(!("deaf" in Object.fromEntries(fieldEntries(hearingMud, { mode: "default" })))); // 0 hidden
});

test("fieldEntries: default surfaces notable fields, prettified; nav extra always shows", () => {
  const slig = {
    name: "Slig",
    extra: {},
    fields: {
      scale: 0,
      start_state: 1,
      shoot_on_sight_delay: 0,
      bullet_shoot_count: 3,
      pause_time: 10,
    },
  };
  const def = Object.fromEntries(fieldEntries(slig, { mode: "default" }));
  assert.equal(def.start_state, "patrol");
  assert.equal(def.shoot_on_sight_delay, 0); // the gotcha: a meaningful zero, shown
  assert.ok(!("bullet_shoot_count" in def) && !("pause_time" in def) && !("scale" in def));

  const all = Object.fromEntries(fieldEntries(slig, { mode: "all" }));
  assert.equal(all.pause_time, 10); // revealed
  assert.equal(all.bullet_shoot_count, 3);
  assert.equal(all.scale, 0);

  // a nav object's derived extra always shows, independent of field policy
  const door = { name: "Door", extra: { to_level: "R2", "door#": 4 }, fields: { door_closed: 1 } };
  const de = Object.fromEntries(fieldEntries(door, { mode: "default" }));
  assert.equal(de.to_level, "R2");
  assert.equal(de["door#"], 4);
});

test("fieldEntries: zero-valued switch ids are hidden, non-zero shown", () => {
  const mud = { name: "Mudokon", extra: {}, fields: { job: 2, rescue_switch_id: 0 } };
  const e0 = Object.fromEntries(fieldEntries(mud, { mode: "default" }));
  assert.equal(e0.job, "sit chant");
  assert.ok(!("rescue_switch_id" in e0)); // 0 = no switch, hidden

  const mud2 = { name: "Mudokon", extra: {}, fields: { job: 1, rescue_switch_id: 70 } };
  assert.equal(Object.fromEntries(fieldEntries(mud2, { mode: "default" })).rescue_switch_id, 70);
});
