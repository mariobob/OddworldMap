// What object fields to show, and how to render them.
//
// The builder ships every field of a gameplay object raw in `t.fields`; this
// module owns which ones show and maps enum ints to text. The one indirection —
// visibleFields() — is what "default", "show more", and the picker all resolve
// through, so callers never change.
//
// Leaf module: no DOM/state imports, importable in bare Node for tests.

// shown by default for any type that carries them: identity + notable signals
const GLOBAL_DEFAULT = new Set([
  "job",
  "emotion",
  "shoot_on_sight_delay", // 0 = shoots on sight, no "FREEZE!" warning
  "asleep",
  "deaf", // ignores Abe's speech, so no gamespeak
  "blind", // can't see, so doesn't automatically stop near Abe
  "switch_id", // the switch a door/hazard/etc. is wired to
  "action",
  "rescue_switch_id",
  "angry_switch_id",
  "anger_switch_id",
]);

// some field names are shared by types that mean different things by them
// (start_state is a Slig AI state but a Door lock state), so their default
// visibility and enum are scoped to the owning type, not global
const DEFAULT_BY_TYPE = {
  Mudokon: ["state"],
  Slig: ["start_state"],
};

// the default-visible field set for a type
export function defaultVisible(typeName) {
  const scoped = DEFAULT_BY_TYPE[typeName];
  return scoped ? new Set([...GLOBAL_DEFAULT, ...scoped]) : GLOBAL_DEFAULT;
}

// fields whose 0 means "absent" (no switch wired, flag not set) — hide it. But
// never hide a meaningful 0: shoot_on_sight_delay=0 (shoots on sight) and
// asleep=0 (awake) are real state.
const HIDE_WHEN_ZERO = new Set([
  "switch_id",
  "rescue_switch_id",
  "angry_switch_id",
  "anger_switch_id",
  "slig_spawner_switch_id",
  "deaf",
  "blind",
]);

// value transforms keyed by the field's game type: one entry then serves every
// object that shares that type, and unrelated same-named fields never collide.
const CHOICE = { 0: false, 1: true };
const SCALE = { 0: "full", 1: "half" };
const TRANSFORM = {
  Choice_short: CHOICE,
  Choice_int: CHOICE,
  Scale_short: SCALE,
  Scale_int: SCALE,
  "Path_Slig::StartState": {
    0: "listening",
    1: "patrol",
    2: "sleeping",
    3: "chase",
    4: "chase and disappear",
    5: "falling to chase", // AE calls 5 "unused"; neither value occurs in shipped data
    6: "listening to glukkon",
  },
  "Path_Mudokon::MudJobs": { 0: "stand scrub", 1: "sit scrub", 2: "sit chant" },
  Mud_State: {
    0: "chisle",
    1: "scrub",
    2: "angry worker",
    3: "damage ring giver",
    4: "health ring giver",
  },
  Mud_TLV_Emotion: { 0: "normal", 1: "angry", 2: "sad", 3: "wired", 4: "sick" },
};

// object -> field -> game type, per game; the boot loads the field_types sidecar
// and hands it over. Empty until then, so prettify degrades to raw (bare tests).
let FIELD_TYPES = {};
export function setFieldTypes(byGame) {
  FIELD_TYPES = byGame || {};
}

// a transform entry against a value: a lookup map, or a function for open-ended
// ranges. A miss (no entry, or value the map omits) yields undefined, so prettify
// falls back to the raw value.
export const resolve = (entry, value) =>
  entry == null ? undefined : typeof entry === "function" ? entry(value) : entry[value];

export const prettify = (game, type, key, value) =>
  resolve(TRANSFORM[FIELD_TYPES[game]?.[type]?.[key]], value) ?? value;

// the field keys to display for a type, given the user's prefs — the "all"
// sentinel or a Set. The one indirection point for the display policy:
//   "all"   -> every field
//   "more"  -> the per-type picks, or the defaults until this type is picked
//              (an explicit empty pick means "show nothing")
//   default -> the type's default set
export function visibleFields(typeName, prefs) {
  const mode = prefs && prefs.mode;
  if (mode === "all") return "all";
  if (mode === "more") {
    const picks = prefs.byType && prefs.byType[typeName];
    return picks ? new Set(picks) : defaultVisible(typeName);
  }
  return defaultVisible(typeName);
}

// [key, displayValue] pairs for a TLV: the semantic nav fields (extra) always,
// then the raw fields the policy admits — prettified, or left as ints when
// prefs.raw is set (a formatting choice; zero-hiding still applies).
export function fieldEntries(t, prefs) {
  const out = [];
  for (const [k, v] of Object.entries(t.extra || {})) if (v !== null && v !== "") out.push([k, v]);
  const show = visibleFields(t.name, prefs);
  if (t.fields)
    for (const [k, v] of Object.entries(t.fields)) {
      if (show !== "all" && !show.has(k)) continue;
      if (v === 0 && HIDE_WHEN_ZERO.has(k)) continue;
      out.push([k, prefs && prefs.raw ? v : prettify(prefs && prefs.game, t.name, k, v)]);
    }
  return out;
}
