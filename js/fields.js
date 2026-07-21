// What object fields to show, and how to render them.
//
// The builder ships every field of a gameplay object raw in `t.fields`; this
// module owns the decision of which ones show and maps enum ints to text. The
// key is one indirection — visibleFields() — so "default", "show more", and a
// future per-type picker are just *which set it returns*; callers never change.
//
// Leaf module: no DOM/state imports, importable in bare Node for tests.

// shown by default: creature identity and the notable gameplay signals
export const DEFAULT_VISIBLE = new Set([
  "job",
  "state",
  "emotion",
  "start_state",
  "shoot_on_sight_delay", // 0 = shoots on sight, no "FREEZE!" warning
  "asleep",
  "deaf", // ignores Abe's speech, so no gamespeak
  "blind", // can't see, so doesn't automatically stop near Abe
  "rescue_switch_id",
  "angry_switch_id",
  "anger_switch_id",
]);

// fields whose 0 means "absent" (no switch wired, flag not set) — hide it. But
// never hide a meaningful 0: shoot_on_sight_delay=0 (shoots on sight) and
// asleep=0 (awake) are real state.
const HIDE_WHEN_ZERO = new Set([
  "rescue_switch_id",
  "angry_switch_id",
  "anger_switch_id",
  "slig_spawner_switch_id",
  "deaf",
  "blind",
]);

// value -> display: enum ints to text, Choice (0/1) fields to true/false
const ENUM = {
  asleep: { 0: false, 1: true },
  deaf: { 0: false, 1: true },
  blind: { 0: false, 1: true },
  job: { 0: "stand scrub", 1: "sit scrub", 2: "sit chant" },
  state: {
    0: "chisle",
    1: "scrub",
    2: "angry worker",
    3: "damage ring giver",
    4: "health ring giver",
  },
  emotion: { 0: "normal", 1: "angry", 2: "sad", 3: "wired", 4: "sick" },
  start_state: {
    0: "listening",
    1: "patrol",
    2: "sleeping",
    3: "chase",
    4: "chase and disappear",
    5: "falling to chase", // AE calls 5 "unused"; neither value occurs in shipped data
    6: "listening to glukkon",
  },
};

export const prettify = (key, value) => ENUM[key]?.[value] ?? value;

// the field keys to display for a type, given the user's prefs. Returns the
// sentinel "all" or a Set. Resolution order is the whole extensibility story:
//   mode "all"     -> everything (search always passes this)
//   mode "more"    -> the user's per-type picks, or everything until they pick
//   default        -> DEFAULT_VISIBLE
export function visibleFields(typeName, prefs) {
  const mode = prefs && prefs.mode;
  if (mode === "all") return "all";
  if (mode === "more") {
    const picks = prefs.byType && prefs.byType[typeName];
    return picks && picks.length ? new Set(picks) : "all";
  }
  return DEFAULT_VISIBLE;
}

// [key, displayValue] pairs for a TLV: the semantic nav fields (extra) always,
// then the raw fields the policy admits, prettified
export function fieldEntries(t, prefs) {
  const out = [];
  for (const [k, v] of Object.entries(t.extra || {})) if (v !== null && v !== "") out.push([k, v]);
  const show = visibleFields(t.name, prefs);
  if (t.fields)
    for (const [k, v] of Object.entries(t.fields)) {
      if (show !== "all" && !show.has(k)) continue;
      if (v === 0 && HIDE_WHEN_ZERO.has(k)) continue;
      out.push([k, prettify(k, v)]);
    }
  return out;
}
