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

// value -> display: enum ints to text, Choice (0/1) fields to true/false. Keyed
// by field name, or `Type.field` where the enum differs per type.
const ENUM = {
  asleep: { 0: false, 1: true },
  deaf: { 0: false, 1: true },
  blind: { 0: false, 1: true },
  scale: { 0: "full", 1: "half" },
  job: { 0: "stand scrub", 1: "sit scrub", 2: "sit chant" },
  emotion: { 0: "normal", 1: "angry", 2: "sad", 3: "wired", 4: "sick" },
  "Mudokon.state": {
    0: "chisle",
    1: "scrub",
    2: "angry worker",
    3: "damage ring giver",
    4: "health ring giver",
  },
  "Slig.start_state": {
    0: "listening",
    1: "patrol",
    2: "sleeping",
    3: "chase",
    4: "chase and disappear",
    5: "falling to chase", // AE calls 5 "unused"; neither value occurs in shipped data
    6: "listening to glukkon",
  },
};

export const prettify = (type, key, value) =>
  (ENUM[`${type}.${key}`] ?? ENUM[key])?.[value] ?? value;

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
// then the raw fields the policy admits, prettified.
export function fieldEntries(t, prefs) {
  const out = [];
  for (const [k, v] of Object.entries(t.extra || {})) if (v !== null && v !== "") out.push([k, v]);
  const show = visibleFields(t.name, prefs);
  if (t.fields)
    for (const [k, v] of Object.entries(t.fields)) {
      if (show !== "all" && !show.has(k)) continue;
      if (v === 0 && HIDE_WHEN_ZERO.has(k)) continue;
      out.push([k, prettify(t.name, k, v)]);
    }
  return out;
}
