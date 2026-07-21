import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp, esc, extrasText, formatDist, segDist } from "../../js/util.js";

test("clamp", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test("esc escapes & < > \" and leaves ' alone", () => {
  assert.equal(esc(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;'&lt;/a&gt;");
  assert.equal(esc("plain"), "plain");
});

test("extrasText skips null and empty values but keeps 0", () => {
  const t = { extra: { "door#": 0, hidden: null, label: "", to_path: 3 } };
  assert.equal(extrasText(t), "door#=0 to_path=3");
  assert.equal(extrasText(t, "  "), "door#=0  to_path=3");
  assert.equal(extrasText({ name: "Slig" }), "");
});

test("formatDist rounds the units and converts to 25-unit grid squares", () => {
  assert.equal(formatDist(0), "0u ≈ 0.0 grid");
  assert.equal(formatDist(50), "50u ≈ 2.0 grid");
  assert.equal(formatDist(37.4), "37u ≈ 1.5 grid");
});

test("segDist point-to-segment distance", () => {
  assert.equal(segDist(5, 0, 0, 0, 10, 0), 0); // on the segment
  assert.equal(segDist(5, 3, 0, 0, 10, 0), 3); // perpendicular to the interior
  assert.equal(segDist(-4, 3, 0, 0, 10, 0), 5); // clamped to an endpoint
  assert.equal(segDist(3, 4, 0, 0, 0, 0), 5); // degenerate zero-length segment
});
