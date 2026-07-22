import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleFields, prettify, fieldEntries, defaultVisible } from "../../js/fields.js";

test("visibleFields: default is the type's default set, 'all' is everything", () => {
  assert.deepEqual(visibleFields("Slig", undefined), defaultVisible("Slig"));
  assert.deepEqual(visibleFields("Slig", { mode: "default" }), defaultVisible("Slig"));
  assert.equal(visibleFields("Slig", { mode: "all" }), "all");
});

test("defaultVisible: type-scoped fields join the global defaults only for their type", () => {
  assert.ok(
    defaultVisible("Slig").has("start_state") && defaultVisible("Slig").has("shoot_on_sight_delay"),
  );
  assert.ok(!defaultVisible("Door").has("start_state")); // Door's start_state is a different thing
  assert.ok(defaultVisible("Mudokon").has("state") && !defaultVisible("Slig").has("state"));
});

test("visibleFields: 'more' uses per-type picks, else the type defaults", () => {
  // no pick for this type yet -> the picker starts from the type's defaults
  assert.deepEqual(visibleFields("Slig", { mode: "more", byType: {} }), defaultVisible("Slig"));
  // a per-type pick -> exactly those keys (the picker's contract)
  const picked = visibleFields("Slig", { mode: "more", byType: { Slig: ["start_state"] } });
  assert.ok(picked instanceof Set && picked.has("start_state") && picked.size === 1);
  // an explicit empty pick means "show nothing", not "fall back to defaults"
  const none = visibleFields("Slig", { mode: "more", byType: { Slig: [] } });
  assert.ok(none instanceof Set && none.size === 0);
  // a pick for a different type doesn't apply -> that type keeps its defaults
  assert.deepEqual(
    visibleFields("Slog", { mode: "more", byType: { Slig: ["start_state"] } }),
    defaultVisible("Slog"),
  );
});

test("prettify: semantic enums are type-scoped with no bare-key leak; value transforms are global", () => {
  // a semantic enum resolves only on its owning type
  assert.equal(prettify("Mudokon", "job", 2), "sit chant");
  assert.equal(prettify("Mudokon", "state", 4), "health ring giver");
  assert.equal(prettify("Mudokon", "emotion", 2), "sad");
  assert.equal(prettify("Slig", "start_state", 0), "listening");
  // the de-fragilized invariant: a same-named field on another type does not
  // borrow the mapping — no bare-key fallback for job/emotion/state/start_state
  assert.equal(prettify("Slig", "job", 2), 2);
  assert.equal(prettify("Slig", "emotion", 2), 2);
  assert.equal(prettify("Door", "start_state", 0), 0); // Door lock state, not Slig AI
  // value-type transforms apply on any type that carries the field
  assert.equal(prettify("Slog", "asleep", 1), true); // Choice -> boolean, not 1
  assert.equal(prettify("Slog", "asleep", 0), false);
  assert.equal(prettify("Slig", "scale", 1), "half"); // Scale_short, global by field name
  assert.equal(prettify("Slig", "shoot_on_sight_delay", 0), 0); // not an enum: raw
  assert.equal(prettify("Mudokon", "job", 9), 9); // out-of-range: raw
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
  assert.equal(all.scale, "full"); // Scale_short prettified

  // a nav object's derived extra always shows, independent of field policy
  const door = { name: "Door", extra: { to_level: "R2", "door#": 4 }, fields: { door_closed: 1 } };
  const de = Object.fromEntries(fieldEntries(door, { mode: "default" }));
  assert.equal(de.to_level, "R2");
  assert.equal(de["door#"], 4);
  assert.ok(!("door_closed" in de)); // a raw Door field: not default-visible
});

test("fieldEntries: a shared field name is prettified by the owning type only", () => {
  const door = { name: "Door", extra: {}, fields: { start_state: 1 } };
  assert.equal(Object.fromEntries(fieldEntries(door, { mode: "all" })).start_state, 1); // raw
  const slig = { name: "Slig", extra: {}, fields: { start_state: 1 } };
  assert.equal(Object.fromEntries(fieldEntries(slig, { mode: "all" })).start_state, "patrol");
});

test("fieldEntries: zero-valued switch ids are hidden, non-zero shown", () => {
  const mud = { name: "Mudokon", extra: {}, fields: { job: 2, rescue_switch_id: 0 } };
  const e0 = Object.fromEntries(fieldEntries(mud, { mode: "default" }));
  assert.equal(e0.job, "sit chant");
  assert.ok(!("rescue_switch_id" in e0)); // 0 = no switch, hidden

  const mud2 = { name: "Mudokon", extra: {}, fields: { job: 1, rescue_switch_id: 70 } };
  assert.equal(Object.fromEntries(fieldEntries(mud2, { mode: "default" })).rescue_switch_id, 70);
});

test("fieldEntries: a wired object's switch_id/action are default-visible from fields", () => {
  const sw = { name: "Switch", extra: {}, fields: { switch_id: 3, action: 0, scale: 0 } };
  const e = Object.fromEntries(fieldEntries(sw, { mode: "default" }));
  assert.equal(e.switch_id, 3);
  assert.equal(e.action, 0); // action 0 is a real value, shown
  assert.ok(!("scale" in e)); // a fields-only key still governed by the picker

  const unwired = { name: "Switch", extra: {}, fields: { switch_id: 0, action: 0 } };
  assert.ok(!("switch_id" in Object.fromEntries(fieldEntries(unwired, { mode: "default" })))); // 0 hidden
});
