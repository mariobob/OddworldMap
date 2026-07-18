import { test } from "node:test";
import assert from "node:assert/strict";

// The regression guard for the whole suite: these modules must never touch the
// DOM at import time, or nothing but a browser session would catch it.
test("pure modules import in bare Node", async () => {
  for (const mod of ["config", "state", "util", "model", "settings"]) {
    const m = await import(`../../js/${mod}.js`);
    assert.ok(Object.keys(m).length > 0, `${mod}.js has exports`);
  }
});
