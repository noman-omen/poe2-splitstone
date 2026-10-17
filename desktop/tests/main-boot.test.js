"use strict";
/**
 * E1 regression: main.js must load without ReferenceError when electron is stubbed.
 * Catches missing requires (e.g. mergeDesktopSettings) at module-eval time.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const path = require("path");

describe("main.js boot (stubbed electron)", () => {
  let originalRequire;
  const listeners = {};
  const stubApp = {
    isPackaged: false,
    getVersion: () => require("../package.json").version,
    getPath: () => path.join(require("os").tmpdir(), "splitstone-test-userdata"),
    whenReady: () => Promise.resolve(),
    on: (ev, fn) => { listeners[ev] = fn; },
    quit: () => {},
  };
  const stubElectron = {
    app: Object.assign(stubApp, {
      requestSingleInstanceLock: () => true,
      on: (ev, fn) => { listeners[ev] = fn; },
    }),
    BrowserWindow: function BrowserWindow() {
      this.webContents = {
        send() {}, on() {}, once() {},
        setWindowOpenHandler() {},
      };
      this.on = () => {};
      this.loadFile = () => {};
      this.isDestroyed = () => false;
      this.setIgnoreMouseEvents = () => {};
      this.setAlwaysOnTop = () => {};
      this.setOpacity = () => {};
      this.setFocusable = () => {};
      this.showInactive = () => {};
      this.show = () => {};
      this.focus = () => {};
      this.hide = () => {};
      this.getPosition = () => [0, 0];
      this.getBounds = () => ({ x: 0, y: 0, width: 280, height: 72 });
      this.setBounds = () => {};
      this.once = () => {};
    },
    ipcMain: { handle() {}, on() {} },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showErrorBox() {},
    },
    shell: { openExternal: async () => {} },
    screen: {
      getPrimaryDisplay: () => ({ id: 1, workAreaSize: { width: 1280, height: 720 }, workArea: { x: 0, y: 0, width: 1280, height: 720 } }),
      getAllDisplays: () => [{ id: 1, workArea: { x: 0, y: 0, width: 1280, height: 720 } }],
      getDisplayMatching: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1280, height: 720 } }),
      on() {},
    },
    globalShortcut: { register: () => true, unregisterAll: () => {} },
    Tray: function Tray() { this.setToolTip = () => {}; this.setContextMenu = () => {}; this.on = () => {}; },
    Menu: { buildFromTemplate: () => ({}) },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }),
      createEmpty: () => ({ isEmpty: () => true, resize: () => ({}) }),
    },
  };

  before(() => {
    originalRequire = Module.prototype.require;
    Module.prototype.require = function (id) {
      if (id === "electron") return stubElectron;
      if (id === "electron-updater") return { autoUpdater: { autoDownload: false, allowPrerelease: false, checkForUpdatesAndNotify: async () => {} } };
      return originalRequire.apply(this, arguments);
    };
    // Clear cache so main re-evaluates with stubs
    const mainPath = require.resolve("../src/main.js");
    delete require.cache[mainPath];
    delete require.cache[require.resolve("../src/desktop-settings.js")];
    delete require.cache[require.resolve("../src/hotkeys.js")];
    delete require.cache[require.resolve("../src/client-log.js")];
    delete require.cache[require.resolve("../src/overlay-state.js")];
  });

  after(() => {
    Module.prototype.require = originalRequire;
    const mainPath = require.resolve("../src/main.js");
    delete require.cache[mainPath];
  });

  it("loads without ReferenceError (mergeDesktopSettings in scope)", () => {
    assert.doesNotThrow(() => {
      require("../src/main.js");
    });
    // Prove the helper is actually bound: mergeDesktopSettings must be a function in the module scope.
    // We can't reach locals, but requiring desktop-settings and checking main didn't throw is the boot smoke.
    const ds = require("../src/desktop-settings");
    assert.equal(typeof ds.merge, "function");
    assert.equal(typeof ds.shouldCheckForUpdates, "function");
    assert.equal(ds.merge(null).autoUpdate, true);
  });

  it("nav guard allows only the bundled pages", () => {
    const path = require("path");
    const { pathToFileURL } = require("url");
    const { isAppPageUrl } = require("../src/main.js");
    const idx = pathToFileURL(path.join(__dirname, "..", "..", "index.html")).href;
    const ovl = pathToFileURL(path.join(__dirname, "..", "overlay", "overlay.html")).href;
    assert.ok(isAppPageUrl(idx));
    assert.ok(isAppPageUrl(idx + "#settings"));
    assert.ok(isAppPageUrl(ovl));
    assert.ok(!isAppPageUrl("file:///etc/passwd"));
    assert.ok(!isAppPageUrl(pathToFileURL(path.join(__dirname, "..", "..", "README.md")).href));
    assert.ok(!isAppPageUrl("https://example.com/"));
  });

  it("default overlay spot stays clear of the minimap", () => {
    const { overlayDefaultBounds } = require("../src/main.js");
    for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]]) {
      const b = overlayDefaultBounds({ workArea: { x: 0, y: 0, width: w, height: h } });
      const minimapLeft = w - Math.round(w * 0.17);
      assert.ok(b.x + b.width <= minimapLeft, `${w}x${h}: overlay right edge ${b.x + b.width} must be left of ${minimapLeft}`);
      assert.ok(b.x >= 16 && b.y >= 0);
    }
    const second = overlayDefaultBounds({ workArea: { x: 1920, y: 0, width: 1920, height: 1080 } });
    assert.ok(second.x > 1920, "second monitor offsets are kept");
  });

  it("Large overlay text grows left and keeps clear of the minimap", () => {
    const { overlayDefaultBounds, anchoredResize } = require("../src/main.js");
    for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]]) {
      const wa = { x: 0, y: 0, width: w, height: h };
      const b = overlayDefaultBounds({ workArea: wa });
      const big = anchoredResize(b, 440, 160, wa);
      assert.equal(big.x + big.width, b.x + b.width, `${w}x${h}: right edge stays put`);
      assert.ok(big.x < b.x, "growth goes left");
      const gap = (w - Math.round(w * 0.17)) - (big.x + big.width);
      assert.ok(gap >= 48, `${w}x${h}: Large overlay keeps ${gap}px from the minimap (need 48)`);
      const small = anchoredResize(big, 220, 60, wa);
      assert.equal(small.x + small.width, b.x + b.width, "shrinking keeps the right edge too");
    }
    const edge = anchoredResize({ x: 10, y: 5, width: 300, height: 72 }, 440, 100, { x: 0, y: 0, width: 1920, height: 1080 });
    assert.equal(edge.x, 0, "never pushed off the left of the screen");
  });

  it("overlay text size is a known value", () => {
    const ds = require("../src/desktop-settings");
    assert.equal(ds.merge({}).overlayTextSize, "m");
    assert.equal(ds.merge({ overlayTextSize: "l" }).overlayTextSize, "l");
    assert.equal(ds.merge({ overlayTextSize: "<x>" }).overlayTextSize, "m");
    assert.equal(ds.merge({ overlayHintShown: "yes" }).overlayHintShown, false);
  });
});
