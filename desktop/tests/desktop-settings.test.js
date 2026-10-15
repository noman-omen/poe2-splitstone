"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULTS, blank, merge, shouldCheckForUpdates } = require("../src/desktop-settings");

describe("desktop-settings autoUpdate", () => {
  it("defaults to on", () => {
    assert.equal(DEFAULTS.autoUpdate, true);
    assert.equal(blank().autoUpdate, true);
    assert.equal(merge(null).autoUpdate, true);
    assert.equal(merge({}).autoUpdate, true);
  });

  it("missing key in saved JSON stays on", () => {
    assert.equal(merge({ overlayEnabled: false }).autoUpdate, true);
  });

  it("explicit false turns it off", () => {
    assert.equal(merge({ autoUpdate: false }).autoUpdate, false);
  });

  it("truthy / string values still resolve to on (only false disables)", () => {
    assert.equal(merge({ autoUpdate: true }).autoUpdate, true);
    assert.equal(merge({ autoUpdate: "no" }).autoUpdate, true);
  });

  it("shouldCheckForUpdates requires packaged + updater + setting", () => {
    const on = merge(null);
    const off = merge({ autoUpdate: false });
    assert.equal(shouldCheckForUpdates(on, { isPackaged: true, hasUpdater: true }), true);
    assert.equal(shouldCheckForUpdates(off, { isPackaged: true, hasUpdater: true }), false);
    assert.equal(shouldCheckForUpdates(on, { isPackaged: false, hasUpdater: true }), false);
    assert.equal(shouldCheckForUpdates(on, { isPackaged: true, hasUpdater: false }), false);
  });
});
