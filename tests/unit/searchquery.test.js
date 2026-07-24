import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, queryTerms, matchesQuery, rankFor } from "../../js/searchquery.js";

// A stand-in for the lowercased "name + fields" blob tlvSearchText builds.
const MUD = "mudokon scale=0 state=chisle job=sit chant rescue_switch_id=70";

test("parseQuery: space = AND within one group", () => {
  assert.deepEqual(parseQuery("Mudokon state=chisle"), [["mudokon", "state=chisle"]]);
});

test("parseQuery: comma and the word 'or' both split into OR groups", () => {
  assert.deepEqual(parseQuery("Slig, Slog"), [["slig"], ["slog"]]);
  assert.deepEqual(parseQuery("Slig or Slog"), [["slig"], ["slog"]]);
});

test("parseQuery: bare 'and'/'or' are operators, never terms", () => {
  assert.deepEqual(parseQuery("Slig and Slog"), [["slig", "slog"]]);
  // dangling operators (leading/trailing, so never a separator) drop out too
  assert.deepEqual(parseQuery("or Slig"), [["slig"]]);
  assert.deepEqual(parseQuery("Slig or"), [["slig"]]);
  assert.deepEqual(parseQuery("Slig and"), [["slig"]]);
});

test("parseQuery: '=' is never a split point; field=value stays one term", () => {
  assert.deepEqual(parseQuery("switch_id=70"), [["switch_id=70"]]);
});

test("parseQuery: substrings like 'hand' aren't treated as operators", () => {
  // only whitespace-delimited and/or are operators
  assert.deepEqual(parseQuery("handstone"), [["handstone"]]);
});

test("parseQuery: trailing separators and blanks drop cleanly", () => {
  assert.deepEqual(parseQuery("slig,"), [["slig"]]);
  assert.deepEqual(parseQuery("  slig   patrol "), [["slig", "patrol"]]);
});

test("queryTerms: distinct terms across all groups", () => {
  assert.deepEqual(queryTerms([["slig"], ["slog", "slig"]]), ["slig", "slog"]);
});

test("matchesQuery: AND needs every term, non-adjacent is fine", () => {
  // the original bug: terms straddle other fields in the blob
  assert.ok(matchesQuery(MUD, parseQuery("mudokon state=chisle")));
  assert.ok(!matchesQuery(MUD, parseQuery("mudokon state=scrub")));
});

test("matchesQuery: a spaced label still matches (its words are the AND terms)", () => {
  assert.ok(matchesQuery(MUD, parseQuery("job=sit chant")));
});

test("matchesQuery: OR matches when any group matches", () => {
  assert.ok(matchesQuery(MUD, parseQuery("slig, mudokon")));
  assert.ok(!matchesQuery(MUD, parseQuery("slig, scrab")));
});

test("rankFor: best (lowest) name rank across the terms", () => {
  assert.equal(rankFor("Slig", ["slig"]), 0); // exact
  assert.equal(rankFor("Slig", ["sli"]), 1); // prefix
  assert.equal(rankFor("SligSpawner", ["slig"]), 1); // prefix wins
  assert.equal(rankFor("BellSongStone", ["song"]), 2); // substring
  assert.equal(rankFor("Slig", ["patrol"]), 3); // not in the name
  assert.equal(rankFor("Slog", ["slig", "slog"]), 0); // best across terms
});
