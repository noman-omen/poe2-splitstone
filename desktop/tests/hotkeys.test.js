"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Module = require("module");
const { validateAccelerator, merge } = require("../src/desktop-settings");

test("accepts Ctrl+Alt / Ctrl+Shift plus one key and normalises", () => {
  for (const [raw, want] of [
    ["Ctrl+Alt+S", "Ctrl+Alt+S"], ["alt+ctrl+s", "Ctrl+Alt+S"], ["CmdOrCtrl+Shift+F5", "Ctrl+Shift+F5"],
    [" Ctrl + Alt + 7 ", "Ctrl+Alt+7"], ["Ctrl+Alt+Shift+K", "Ctrl+Alt+Shift+K"], ["Ctrl+Shift+num4", "Ctrl+Shift+num4"],
  ]) {
    const v = validateAccelerator(raw);
    assert.ok(v.ok, raw + " " + v.error);
    assert.strictEqual(v.accel, want);
  }
});

test("rejects unsafe or malformed combos", () => {
  for (const raw of [
    "S", "Space", "Alt+S", "Shift+S", "Ctrl+S", "Alt+F4", "Ctrl+Alt+F4", "Alt+Tab", "Ctrl+Alt+Delete",
    "Ctrl+Shift+Escape", "Super+L", "Ctrl+Alt+Super+S", "Meta+Ctrl+Alt+S", "Ctrl+Alt", "Ctrl+Alt+S+D",
    "Ctrl+Ctrl+Alt+S", "Ctrl+Alt+Space", "Ctrl+Alt+Enter", "Ctrl++Alt", "", null, 42,
    "Ctrl+Alt+S" + " ".repeat(40),
  ]) {
    assert.ok(!validateAccelerator(raw).ok, "should reject " + JSON.stringify(raw));
  }
});

test("length is checked before trimming", () => {
  assert.ok(!validateAccelerator(" ".repeat(30) + "Ctrl+Alt+S").ok);
});

test("stored bad bindings fall back to defaults", () => {
  const s = merge({ hotkeys: { split: "Space", undo: "Alt+F4", pause: "ctrl+alt+p" } });
  assert.strictEqual(s.hotkeys.split, "Ctrl+Alt+S");
  assert.strictEqual(s.hotkeys.undo, "Ctrl+Alt+Z");
  assert.strictEqual(s.hotkeys.pause, "Ctrl+Alt+P");
});

/* ---------- registration + set-hotkeys through main.js with stubbed electron ---------- */
function withStubbedMain(busy, fn) {
  const registered = [];
  const stub = {
    app: { requestSingleInstanceLock: () => true, on() {}, whenReady: () => new Promise(() => {}), getPath: () => require("os").tmpdir(),
      getVersion: () => "0.0.0", isPackaged: false, quit() {}, exit() {} },
    BrowserWindow: function () {}, ipcMain: { handle() {}, on() {} }, dialog: { showErrorBox() {} }, shell: {},
    screen: { on() {} }, Tray: function () {}, Menu: { buildFromTemplate: () => ({}) }, nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    globalShortcut: {
      register: (accel, cb) => { if (busy.includes(accel)) return false; registered.push(accel); return true; },
      unregisterAll: () => { registered.length = 0; },
    },
  };
  const orig = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === "electron") return stub;
    if (id === "electron-updater") return { autoUpdater: {} };
    return orig.apply(this, arguments);
  };
  const paths = ["../src/main.js", "../src/hotkeys.js"].map(p => require.resolve(p));
  paths.forEach(p => delete require.cache[p]);
  try { return fn(require("../src/main.js"), require("../src/hotkeys.js"), registered); }
  finally { Module.prototype.require = orig; paths.forEach(p => delete require.cache[p]); }
}

test("registerAll reports busy and duplicate combos", () => {
  withStubbedMain(["Ctrl+Alt+P"], (_main, hk) => {
    const r = hk.registerAll({ split: "Ctrl+Alt+S", undo: "Ctrl+Alt+S", pause: "Ctrl+Alt+P", newRun: "Alt+F4" }, () => {});
    assert.deepStrictEqual(r.split, { ok: true, accel: "Ctrl+Alt+S" });
    assert.match(r.undo.error, /Already used/);
    assert.match(r.pause.error, /another app/);
    assert.ok(!r.newRun.ok);
  });
});

test("setHotkeys refuses duplicates, reverts busy combos and reports why", () => {
  withStubbedMain(["Ctrl+Shift+B"], (main) => {
    let res = main.setHotkeys({ split: "Ctrl+Alt+K" });
    assert.deepStrictEqual(res.results.split, { ok: true, accel: "Ctrl+Alt+K" });
    assert.strictEqual(res.hotkeys.split, "Ctrl+Alt+K");

    res = main.setHotkeys({ undo: "Ctrl+Alt+K" });
    assert.ok(!res.results.undo.ok);
    assert.match(res.results.undo.error, /Already used for split/);
    assert.strictEqual(res.hotkeys.undo, "Ctrl+Alt+Z");

    res = main.setHotkeys({ pause: "Ctrl+Shift+B" });
    assert.ok(!res.results.pause.ok);
    assert.match(res.results.pause.error, /another app/);
    assert.strictEqual(res.hotkeys.pause, "Ctrl+Alt+P", "busy combo reverted");

    res = main.setHotkeys({ toggleHint: "Super+H" });
    assert.match(res.results.toggleHint.error, /Super/);
  });
});
