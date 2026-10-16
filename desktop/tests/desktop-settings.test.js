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

const { DEFAULT_GLOBAL_HOTKEYS, isSafeGlobalAccelerator } = require("../src/desktop-settings");

describe("global hotkey safety", () => {
  it("defaults are modifier combos", () => {
    for (const [k, v] of Object.entries(DEFAULT_GLOBAL_HOTKEYS)) {
      assert.ok(isSafeGlobalAccelerator(v), `${k}=${v}`);
      assert.match(v, /Ctrl\+Alt\+/i);
    }
  });
  it("rejects bare Space / letters", () => {
    for (const bad of [" ", "Space", "p", "u", "n", "r", "P", "Shift+P", "Shift+Space"]) {
      assert.equal(isSafeGlobalAccelerator(bad), false, bad);
    }
  });
  it("accepts Ctrl+Alt combos", () => {
    assert.equal(isSafeGlobalAccelerator("Ctrl+Alt+S"), true);
    assert.equal(isSafeGlobalAccelerator("Ctrl+Alt+O"), true);
  });
  it("merge replaces unsafe saved hotkeys with defaults", () => {
    const m = merge({ hotkeys: { split: " ", pause: "p", undo: "u", newRun: "n" } });
    assert.equal(m.hotkeys.split, "Ctrl+Alt+S");
    assert.equal(m.hotkeys.pause, "Ctrl+Alt+P");
    assert.equal(m.hotkeys.undo, "Ctrl+Alt+Z");
    assert.equal(m.hotkeys.newRun, "Ctrl+Alt+R");
  });
  it("default opacity 0.8 and clickThrough true", () => {
    const m = merge(null);
    assert.equal(m.overlayOpacity, 0.8);
    assert.equal(m.clickThrough, true);
  });
});
