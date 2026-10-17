"use strict";
/**
 * Overlay through main: size and position (grip, persist, reset, 1.2 text-size migration), the Show in-game overlay
 * switch, and the app theme reaching the overlay.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { defaultSize, BOSS_BAR_CLEARANCE } = require("../src/overlay-bounds");

process.setMaxListeners(40);
const FRESH = ["../src/main.js", "../src/desktop-settings.js", "../src/hotkeys.js", "../src/client-log.js", "../src/overlay-state.js"];

/** Loads main.js against a stubbed electron with one display and the given saved settings. */
async function boot(saved, [w, h] = [1920, 1080]) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "splitstone-main-"));
  if (saved) fs.writeFileSync(path.join(userData, "desktop-settings.json"), JSON.stringify(saved));
  const display = { id: 1, workArea: { x: 0, y: 0, width: w, height: h } };
  const handlers = {}, windows = [], shortcuts = {}, menus = [];
  let ready;
  function BrowserWindow(opts) {
    const win = this, wcOn = {};
    win.opts = opts;
    win.bounds = { x: opts.x || 0, y: opts.y || 0, width: opts.width, height: opts.height };
    win.sent = [];
    win.webContents = {
      send: (ch, data) => win.sent.push([ch, data]),
      on: (ev, fn) => { wcOn[ev] = fn; }, once() {}, setWindowOpenHandler() {},
      emit: (ev) => wcOn[ev] && wcOn[ev](),
    };
    const on = {};
    win.destroyed = false;
    win.opacity = null;
    Object.assign(win, {
      on: (ev, fn) => { on[ev] = fn; }, once() {}, emit: (ev) => on[ev] && on[ev](),
      loadFile() {}, isDestroyed: () => win.destroyed, isMinimized: () => false, isVisible: () => true,
      destroy() { win.destroyed = true; win.emit("closed"); },
      setIgnoreMouseEvents() {}, setAlwaysOnTop() {}, setOpacity(o) { win.opacity = o; }, setFocusable() {},
      showInactive() {}, show() {}, focus() {}, hide() {}, moveTop() {}, restore() {},
      getBounds: () => ({ ...win.bounds }), setBounds: (b) => { win.bounds = { ...b }; },
    });
    windows.push(win);
  }
  const electron = {
    app: {
      isPackaged: false, getVersion: () => "0.0.0", getPath: () => userData,
      whenReady: () => ({ then: (fn) => { ready = Promise.resolve().then(fn); } }),
      requestSingleInstanceLock: () => true, on() {}, quit() {}, exit() {},
    },
    BrowserWindow: Object.assign(BrowserWindow, { getAllWindows: () => windows }),
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showErrorBox() {} },
    shell: { openExternal: async () => {} },
    screen: {
      getPrimaryDisplay: () => display, getAllDisplays: () => [display], getDisplayMatching: () => display, on() {},
    },
    globalShortcut: {
      register: (accel, fn) => { shortcuts[accel] = fn; return true; },
      unregister(accel) { delete shortcuts[accel]; }, unregisterAll() { for (const k in shortcuts) delete shortcuts[k]; },
      isRegistered: (accel) => accel in shortcuts,
    },
    Tray: function Tray() { this.setToolTip = () => {}; this.setContextMenu = () => {}; this.on = () => {}; },
    Menu: { buildFromTemplate: (tpl) => { menus.push(tpl); return {}; } },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }), createEmpty: () => ({ isEmpty: () => true }) },
  };
  const original = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === "electron") return electron;
    if (id === "electron-updater") return { autoUpdater: { on() {}, autoDownload: false, checkForUpdatesAndNotify: async () => {} } };
    return original.apply(this, arguments);
  };
  try {
    for (const f of FRESH) delete require.cache[require.resolve(f)];
    require("../src/main.js");
  } finally { Module.prototype.require = original; }
  await ready;
  const main = windows[0];
  main.webContents.emit("did-finish-load");
  const overlay = windows[1];
  const fromMain = { sender: main.webContents }, fromOverlay = overlay && { sender: overlay.webContents };
  const stored = () => JSON.parse(fs.readFileSync(path.join(userData, "desktop-settings.json"), "utf8"));
  const lastBox = () => overlay.sent.filter(([ch]) => ch === "overlay:box").pop()?.[1];
  const tray = () => menus[menus.length - 1] || [];
  return { handlers, main, overlay, windows, shortcuts, tray, fromMain, fromOverlay, stored, lastBox, wa: display.workArea };
}

const ON = { overlayEnabled: true, firstRunDone: true };

describe("overlay size and position (main)", () => {
  it("a fresh overlay is the default size, centred below the boss bar", async () => {
    for (const dims of [[1920, 1080], [2560, 1440]]) {
      const t = await boot(ON, dims);
      t.handlers["overlay:ready"](t.fromOverlay);
      const size = defaultSize(t.wa);
      assert.deepEqual({ width: t.overlay.bounds.width, height: t.overlay.bounds.height }, size);
      assert.ok(Math.abs(t.overlay.bounds.x + size.width / 2 - dims[0] / 2) <= 1, "centred");
      assert.equal(t.overlay.bounds.y, Math.round(dims[1] * BOSS_BAR_CLEARANCE));
      assert.deepEqual(t.lastBox(), { ...size, custom: false, grow: "both" });
    }
  });

  it("the default box may narrow to its text, a custom one never does", async () => {
    const t = await boot(ON);
    t.handlers["overlay:fit-width"](t.fromOverlay, 250);
    assert.equal(t.overlay.bounds.width, 250);
    assert.ok(Math.abs(t.overlay.bounds.x + 125 - 960) <= 1, "still centred");
    t.handlers["overlay:fit-width"](t.fromOverlay, 5000);
    assert.equal(t.overlay.bounds.width, defaultSize(t.wa).width, "never wider than the box");
    const c = await boot({ ...ON, overlaySize: { width: 500, height: 100 } });
    c.handlers["overlay:fit-width"](c.fromOverlay, 250);
    assert.equal(c.overlay.bounds.width, 500);
  });

  it("resizing needs move mode, then the size is kept and survives a restart", async () => {
    const t = await boot(ON);
    t.handlers["overlay:resize"](t.fromOverlay, { w: 600, h: 120, done: true });
    assert.equal(t.overlay.bounds.width, defaultSize(t.wa).width, "locked overlay ignores the grip");
    await t.handlers["desktop:set-click-through"](t.fromMain, false);
    t.handlers["overlay:resize"](t.fromMain, { w: 600, h: 120, done: true });
    assert.equal(t.overlay.bounds.width, defaultSize(t.wa).width, "only the overlay may resize itself");
    t.handlers["overlay:resize"](t.fromOverlay, { w: 600, h: 120, done: false });
    t.handlers["overlay:resize"](t.fromOverlay, { w: 640, h: 128, done: true });
    assert.equal(t.overlay.bounds.width, 640);
    assert.equal(t.overlay.bounds.height, 128);
    assert.ok(Math.abs(t.overlay.bounds.x + 320 - 960) <= 1, "top centre grows around its midpoint");
    assert.deepEqual(t.lastBox(), { width: 640, height: 128, custom: true, grow: "both" });
    assert.deepEqual(t.stored().overlaySize, { width: 640, height: 128 });
    t.handlers["overlay:resize"](t.fromOverlay, { w: 99999, h: 1, done: true });
    assert.ok(t.overlay.bounds.width <= 1200 && t.overlay.bounds.height >= 44, "clamped to the limits");

    const again = await boot({ ...t.stored(), clickThrough: true });
    assert.equal(again.overlay.bounds.width, t.overlay.bounds.width);
    assert.equal(again.overlay.bounds.height, t.overlay.bounds.height);
  });

  it("a moved and resized overlay keeps its corner on restart", async () => {
    const t = await boot({ ...ON, overlayPosition: "custom", overlaySize: { width: 500, height: 90 },
      overlayBounds: { displayId: "1", x: 100, y: 600, width: 500, height: 90 } });
    assert.deepEqual(t.overlay.bounds, { x: 100, y: 600, width: 500, height: 90 });
    await t.handlers["desktop:set-click-through"](t.fromMain, false);
    t.handlers["overlay:resize"](t.fromOverlay, { w: 700, h: 140, done: true });
    assert.deepEqual(t.overlay.bounds, { x: 100, y: 600, width: 700, height: 140 }, "top-left corner stays");
  });

  it("resizing the top-right spot frees it, so the grip keeps the left edge", async () => {
    const t = await boot({ ...ON, overlayPosition: "top-right" });
    await t.handlers["desktop:set-click-through"](t.fromMain, false);
    t.handlers["overlay:ready"](t.fromOverlay);
    const before = { ...t.overlay.bounds };
    assert.equal(t.lastBox().grow, "right");
    t.handlers["overlay:resize"](t.fromOverlay, { w: before.width + 80, h: before.height + 20, done: true });
    assert.deepEqual(t.overlay.bounds, { x: before.x, y: before.y, width: before.width + 80, height: before.height + 20 });
    assert.equal(t.stored().overlayPosition, "custom");
    assert.equal(t.stored().overlayBounds.x, before.x);
  });

  it("reset puts it back at top centre at the default size", async () => {
    const t = await boot({ ...ON, overlayPosition: "custom", overlaySize: { width: 700, height: 200 },
      overlayBounds: { displayId: "1", x: 40, y: 700, width: 700, height: 200 } });
    assert.equal(await t.handlers["desktop:reset-overlay-position"](t.fromMain), true);
    const size = defaultSize(t.wa);
    assert.equal(t.overlay.bounds.width, size.width);
    assert.equal(t.overlay.bounds.height, size.height);
    assert.ok(Math.abs(t.overlay.bounds.x + size.width / 2 - 960) <= 1);
    assert.equal(t.overlay.bounds.y, Math.round(1080 * BOSS_BAR_CLEARANCE));
    const s = t.stored();
    assert.equal(s.overlaySize, null);
    assert.equal(s.overlayPosition, "top-center");
    assert.equal(s.overlayBounds, null);
    assert.deepEqual(t.lastBox(), { ...size, custom: false, grow: "both" });
  });

  it("the 1.2 text size becomes a starting window size", async () => {
    const big = await boot({ ...ON, overlayTextSize: "l" });
    const def = defaultSize(big.wa);
    assert.deepEqual(big.stored().overlaySize, defaultSize(big.wa, "l"));
    assert.ok(big.overlay.bounds.width > def.width && big.overlay.bounds.height > def.height);
    assert.equal(big.stored().overlayTextSize, undefined, "the old key is gone");
    const small = await boot({ ...ON, overlayTextSize: "s" });
    assert.equal(small.stored().overlaySize ?? null, null, "Small migrates to the default box, never below 400x80");
    assert.deepEqual({ width: small.overlay.bounds.width, height: small.overlay.bounds.height }, def);
    assert.equal(small.stored().overlayTextSize, undefined);
    const medium = await boot({ ...ON, overlayTextSize: "m" });
    assert.equal(medium.stored().overlaySize ?? null, null, "Medium is the default and stays fit-to-text");
    assert.equal(medium.overlay.bounds.width, def.width);
    const resized = await boot({ ...ON, overlayTextSize: "l", overlaySize: { width: 300, height: 60 } });
    assert.deepEqual(resized.stored().overlaySize, { width: 300, height: 60 }, "a chosen size wins");
  });

  it("status reports the size and no text-size setting", async () => {
    const t = await boot({ ...ON, overlaySize: { width: 500, height: 90 } });
    const st = await t.handlers["desktop:get-status"](t.fromMain);
    assert.deepEqual(st.overlaySize, { width: 500, height: 90 });
    assert.ok(!("overlayTextSize" in st));
  });
});

/** The live overlay window: the last one created that hasn't been destroyed. */
const liveOverlays = t => t.windows.slice(1).filter(w => !w.destroyed);
const states = w => w.sent.filter(([ch]) => ch === "overlay:state").map(([, st]) => st);

describe("Show in-game overlay (main)", () => {
  it("defaults to on, with an overlay window", async () => {
    const t = await boot({ firstRunDone: true });
    assert.equal(liveOverlays(t).length, 1);
    assert.equal((await t.handlers["desktop:get-status"](t.fromMain)).overlayEnabled, true);
  });

  it("off destroys the window and persists; on brings a fresh one back", async () => {
    const t = await boot(ON);
    await t.handlers["desktop:set-overlay"](t.fromMain, false);
    assert.equal(t.overlay.destroyed, true, "destroyed, not hidden");
    assert.equal(liveOverlays(t).length, 0);
    assert.equal(t.stored().overlayEnabled, false);

    const restart = await boot(t.stored());
    assert.equal(liveOverlays(restart).length, 0, "stays off after a restart");
    await restart.handlers["desktop:set-overlay"](restart.fromMain, true);
    assert.equal(liveOverlays(restart).length, 1);
    assert.equal(restart.stored().overlayEnabled, true);
  });

  it("only the main window may switch it", async () => {
    const t = await boot(ON);
    await t.handlers["desktop:set-overlay"](t.fromOverlay, false);
    await t.handlers["desktop:set-overlay"]({ sender: {} }, false);
    assert.equal(t.overlay.destroyed, false);
    assert.equal(t.stored().overlayEnabled ?? true, true);
  });

  it("while off, hotkeys never recreate it and Ctrl+Alt+O move mode does nothing", async () => {
    const t = await boot(ON);
    await t.handlers["desktop:set-overlay"](t.fromMain, false);
    const before = t.windows.length;
    assert.ok(t.shortcuts["Ctrl+Alt+O"], "move-mode hotkey registered");
    t.shortcuts["Ctrl+Alt+O"]();
    t.shortcuts["Ctrl+Alt+O"]();
    assert.equal((await t.handlers["desktop:get-status"](t.fromMain)).clickThrough, true, "still locked");
    for (const k of ["Ctrl+Alt+S", "Ctrl+Alt+Z", "Ctrl+Alt+P", "Ctrl+Alt+R", "Ctrl+Alt+R", "Ctrl+Alt+H"]) t.shortcuts[k]();
    t.handlers["desktop:overlay-state"](t.fromMain, { v: 1, step: "Kill Beira", theme: "slate" });
    assert.equal(t.windows.length, before, "no window created");
    const hk = t.main.sent.filter(([ch]) => ch === "desktop:hotkey").map(([, a]) => a);
    assert.deepEqual(hk, ["split", "undo", "pause", "newRun", "toggleHint"], "the run hotkeys still work");

    await t.handlers["desktop:set-overlay"](t.fromMain, true);
    const w = liveOverlays(t)[0];
    assert.equal(states(w).pop().step, "Kill Beira", "the new window gets the latest state");
    t.shortcuts["Ctrl+Alt+O"]();
    assert.equal((await t.handlers["desktop:get-status"](t.fromMain)).clickThrough, false, "move mode works again");
  });

  it("the tray shows the switch as a checkbox and greys out move mode while off", async () => {
    const t = await boot(ON);
    const find = (label) => t.tray().find(i => i.label === label);
    assert.equal(find("Show in-game overlay").type, "checkbox");
    assert.equal(find("Show in-game overlay").checked, true);
    find("Show in-game overlay").click();
    assert.equal(t.overlay.destroyed, true);
    assert.equal(find("Show in-game overlay").checked, false);
    const lock = t.tray().find(i => /overlay \((move|click-through)\)/.test(i.label));
    assert.equal(lock.enabled, false);
  });
});

describe("overlay theme (main)", () => {
  it("forwards the app theme and switches live", async () => {
    const t = await boot(ON);
    t.handlers["overlay:ready"](t.fromOverlay);
    for (const theme of ["slate", "crimson", "parchment", "ember"]) {
      t.handlers["desktop:overlay-state"](t.fromMain, { v: 1, step: "Kill Beira", nextStep: "Waypoint", opacity: 0.8, theme });
      assert.equal(states(t.overlay).pop().theme, theme);
    }
  });

  it("drops a theme that isn't one of the app's, and ignores snapshots from anyone but the main window", async () => {
    const t = await boot(ON);
    t.handlers["desktop:overlay-state"](t.fromMain, { v: 1, step: "A", theme: "slate" });
    for (const theme of ["neon", "Slate", "", "slate;color:red", "../x", 7, { a: 1 }, null])
      t.handlers["desktop:overlay-state"](t.fromMain, { v: 1, step: "A", theme });
    assert.ok(states(t.overlay).every(st => ["ember", "slate"].includes(st.theme)));
    assert.equal(states(t.overlay).pop().theme, "ember", "invalid falls back to the default");
    const n = states(t.overlay).length;
    t.handlers["desktop:overlay-state"](t.fromOverlay, { v: 1, step: "B", theme: "crimson" });
    t.handlers["desktop:overlay-state"]({ sender: {} }, { v: 1, step: "B", theme: "crimson" });
    assert.equal(states(t.overlay).length, n);
  });

  it("keeps its own opacity, floored at 65%", async () => {
    const t = await boot(ON);
    t.handlers["desktop:overlay-state"](t.fromMain, { v: 1, step: "A", theme: "parchment", opacity: 0.9 });
    assert.equal(t.overlay.opacity, 0.9);
    assert.equal(states(t.overlay).pop().theme, "parchment");
    t.handlers["desktop:overlay-state"](t.fromMain, { v: 1, step: "A", theme: "slate", opacity: 0.1 });
    assert.equal(t.overlay.opacity, 0.65);
    await t.handlers["desktop:set-overlay-opacity"](t.fromMain, 0.3);
    assert.equal(t.overlay.opacity, 0.65);
    const old = await boot({ ...ON, overlayOpacity: 0.3 });
    assert.equal((await old.handlers["desktop:get-status"](old.fromMain)).overlayOpacity, 0.65, "an older, fainter setting is raised");
  });
});

