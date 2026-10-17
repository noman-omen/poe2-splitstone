"use strict";
/** The overlay snapshot normaliser: theme allowlist and the opacity floor. */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { normalise, THEMES, OPACITY_MIN, clampOpacity } = require("../src/overlay-state");

describe("overlay state", () => {
  it("accepts the app's four themes and nothing else", () => {
    assert.deepEqual([...THEMES], ["ember", "slate", "crimson", "parchment"]);
    for (const t of THEMES) assert.equal(normalise({ theme: t }).theme, t);
    for (const t of [undefined, null, "", "neon", "SLATE", "slate ", "ember;}", 1, ["slate"], { toString: () => "slate" }])
      assert.equal(normalise({ theme: t }).theme, "ember");
  });

  it("matches the app's theme list", () => {
    const app = require("fs").readFileSync(require("path").join(__dirname, "../../js/app.js"), "utf8");
    const ids = [...app.slice(app.indexOf("const THEMES = ["), app.indexOf("const VALID_THEMES")).matchAll(/id: "(\w+)"/g)].map(m => m[1]);
    assert.deepEqual(ids, [...THEMES]);
  });

  it("keeps opacity between 65% and 100%", () => {
    assert.equal(OPACITY_MIN, 0.65);
    assert.equal(normalise({ opacity: 0.3 }).opacity, 0.65);
    assert.equal(normalise({ opacity: 0.75 }).opacity, 0.75);
    assert.equal(normalise({ opacity: 4 }).opacity, 1);
    assert.equal(clampOpacity("x"), 0.8);
  });
});
