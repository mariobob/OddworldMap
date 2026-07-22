import { test } from "node:test";
import assert from "node:assert/strict";
import {
  visibleFields,
  prettify,
  resolve,
  fieldEntries,
  defaultVisible,
  setFieldTypes,
} from "../../js/fields.js";

// prettify keys value transforms by each field's game type, which the viewer
// loads from the field_types sidecar. Inject a small stand-in so the tests
// exercise the object -> field -> type -> transform path. One game "G" suffices:
// the real per-game vocabulary is a data concern, checked in field-types.test.js.
setFieldTypes({
  G: {
    Slig: { start_state: "Path_Slig::StartState", scale: "Scale_short" },
    SligSpawner: { start_state: "Path_Slig::StartState" }, // shares Slig's enum
    Slog: { asleep: "Choice_short" },
    Mudokon: {
      job: "Path_Mudokon::MudJobs",
      state: "Mud_State",
      emotion: "Mud_TLV_Emotion",
      deaf: "Choice_short",
    },
    Door: { start_state: "DoorStates" }, // a real type with no transform -> stays raw
  },
});

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

test("prettify: resolves a value by the field's game type, grouping and collision-safe", () => {
  // the enum resolves on its owning type's field
  assert.equal(prettify("G", "Mudokon", "job", 2), "sit chant");
  assert.equal(prettify("G", "Mudokon", "state", 4), "health ring giver");
  assert.equal(prettify("G", "Mudokon", "emotion", 2), "sad");
  assert.equal(prettify("G", "Slig", "start_state", 0), "listening");
  // grouping: SligSpawner shares Slig's start_state type, so one entry serves both
  assert.equal(prettify("G", "SligSpawner", "start_state", 1), "patrol");
  // collision-safety: a Door's start_state is its own type (DoorStates, with no
  // transform here) -> raw, never the Slig text
  assert.equal(prettify("G", "Door", "start_state", 0), 0);
  // value-type transforms (Choice/Scale) apply wherever that type is carried
  assert.equal(prettify("G", "Slog", "asleep", 1), true); // Choice -> boolean, not 1
  assert.equal(prettify("G", "Slog", "asleep", 0), false);
  assert.equal(prettify("G", "Slig", "scale", 1), "half");
  // no type in the table, out-of-range value, unknown game -> raw
  assert.equal(prettify("G", "Slig", "shoot_on_sight_delay", 0), 0);
  assert.equal(prettify("G", "Mudokon", "job", 9), 9);
  assert.equal(prettify("XX", "Slig", "start_state", 1), 1);
});

test("resolve: a lookup map, a function for open-ended ranges, and a miss", () => {
  assert.equal(resolve({ 0: "a", 1: "b" }, 1), "b");
  assert.equal(
    resolve((n) => `${n / 15}s`, 30),
    "2s",
  );
  assert.equal(resolve({ 0: "a" }, 9), undefined); // map miss -> undefined, so prettify falls to raw
  assert.equal(resolve(undefined, 5), undefined);
  assert.equal(resolve(null, 5), undefined);
});

test("fieldEntries: asleep shows both states; deaf/blind show only when set", () => {
  const asleepSlog = { name: "Slog", extra: {}, fields: { asleep: 1, anger_switch_id: 0 } };
  const awakeSlog = { name: "Slog", extra: {}, fields: { asleep: 0, anger_switch_id: 0 } };
  assert.equal(
    Object.fromEntries(fieldEntries(asleepSlog, { mode: "default", game: "G" })).asleep,
    true,
  );
  assert.equal(
    Object.fromEntries(fieldEntries(awakeSlog, { mode: "default", game: "G" })).asleep,
    false,
  );

  const deafMud = { name: "Mudokon", extra: {}, fields: { job: 2, deaf: 1 } };
  const hearingMud = { name: "Mudokon", extra: {}, fields: { job: 1, deaf: 0 } };
  assert.equal(
    Object.fromEntries(fieldEntries(deafMud, { mode: "default", game: "G" })).deaf,
    true,
  );
  assert.ok(
    !("deaf" in Object.fromEntries(fieldEntries(hearingMud, { mode: "default", game: "G" }))),
  ); // 0 hidden
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
  const def = Object.fromEntries(fieldEntries(slig, { mode: "default", game: "G" }));
  assert.equal(def.start_state, "patrol");
  assert.equal(def.shoot_on_sight_delay, 0); // the gotcha: a meaningful zero, shown
  assert.ok(!("bullet_shoot_count" in def) && !("pause_time" in def) && !("scale" in def));

  const all = Object.fromEntries(fieldEntries(slig, { mode: "all", game: "G" }));
  assert.equal(all.pause_time, 10); // revealed
  assert.equal(all.bullet_shoot_count, 3);
  assert.equal(all.scale, "full"); // Scale_short prettified

  // a nav object's derived extra always shows, independent of field policy
  const door = { name: "Door", extra: { to_level: "R2", "door#": 4 }, fields: { door_closed: 1 } };
  const de = Object.fromEntries(fieldEntries(door, { mode: "default", game: "G" }));
  assert.equal(de.to_level, "R2");
  assert.equal(de["door#"], 4);
  assert.ok(!("door_closed" in de)); // a raw Door field: not default-visible
});

test("fieldEntries: raw mode shows the underlying ints, not the prettified text", () => {
  const slig = { name: "Slig", extra: {}, fields: { start_state: 1, scale: 0 } };
  const raw = Object.fromEntries(fieldEntries(slig, { mode: "all", game: "G", raw: true }));
  assert.equal(raw.start_state, 1); // not "patrol"
  assert.equal(raw.scale, 0); // not "full"
  const pretty = Object.fromEntries(fieldEntries(slig, { mode: "all", game: "G" }));
  assert.equal(pretty.start_state, "patrol"); // raw:false / absent keeps prettifying
  assert.equal(pretty.scale, "full");

  // raw is a value-formatting choice, not a visibility one: zero-hiding still applies
  const slog = { name: "Slog", extra: {}, fields: { asleep: 1, anger_switch_id: 0 } };
  const rawSlog = Object.fromEntries(fieldEntries(slog, { mode: "default", game: "G", raw: true }));
  assert.equal(rawSlog.asleep, 1); // not true
  assert.ok(!("anger_switch_id" in rawSlog)); // still hidden at 0
});

test("fieldEntries: a shared field name is resolved by the owning type's game type", () => {
  const door = { name: "Door", extra: {}, fields: { start_state: 1 } };
  assert.equal(Object.fromEntries(fieldEntries(door, { mode: "all", game: "G" })).start_state, 1); // DoorStates: raw
  const slig = { name: "Slig", extra: {}, fields: { start_state: 1 } };
  assert.equal(
    Object.fromEntries(fieldEntries(slig, { mode: "all", game: "G" })).start_state,
    "patrol",
  );
});

test("fieldEntries: zero-valued switch ids are hidden, non-zero shown", () => {
  const mud = { name: "Mudokon", extra: {}, fields: { job: 2, rescue_switch_id: 0 } };
  const e0 = Object.fromEntries(fieldEntries(mud, { mode: "default", game: "G" }));
  assert.equal(e0.job, "sit chant");
  assert.ok(!("rescue_switch_id" in e0)); // 0 = no switch, hidden

  const mud2 = { name: "Mudokon", extra: {}, fields: { job: 1, rescue_switch_id: 70 } };
  assert.equal(
    Object.fromEntries(fieldEntries(mud2, { mode: "default", game: "G" })).rescue_switch_id,
    70,
  );
});

test("fieldEntries: a wired object's switch_id/action are default-visible from fields", () => {
  const sw = { name: "Switch", extra: {}, fields: { switch_id: 3, action: 0, scale: 0 } };
  const e = Object.fromEntries(fieldEntries(sw, { mode: "default", game: "G" }));
  assert.equal(e.switch_id, 3);
  assert.equal(e.action, 0); // action 0 is a real value, shown
  assert.ok(!("scale" in e)); // a fields-only key still governed by the picker

  const unwired = { name: "Switch", extra: {}, fields: { switch_id: 0, action: 0 } };
  assert.ok(
    !("switch_id" in Object.fromEntries(fieldEntries(unwired, { mode: "default", game: "G" }))),
  ); // 0 hidden
});
