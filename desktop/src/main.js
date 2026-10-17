"use strict";
/**
 * Splitstone desktop — Electron main process.
 * Loads the static web app, tails Client.txt, global hotkeys, overlay window.
 * Renderer talks over IPC only (no localhost helper required).
 */
const path = require("path");
const fs = require("fs");
const {
  app, BrowserWindow, ipcMain, dialog, shell, screen, Tray, Menu, nativeImage,
} = require("electron");

const { pathToFileURL } = require("url");
const { findClientLog, watchClientLog, isClientTxtPath, isAllowedLogPath } = require("./client-log");
const { normalise, EMPTY } = require("./overlay-state");
const { registerAll, unregisterAll, ACTIONS: HOTKEY_ACTIONS } = require("./hotkeys");
const {
  merge: mergeDesktopSettings, shouldCheckForUpdates, validateAccelerator, isPrereleaseVersion, OVERLAY_TEXT_SIZES,
} = require("./desktop-settings");

let autoUpdater = null;
try { autoUpdater = require("electron-updater").autoUpdater; } catch (_) { /* optional */ }

const DESKTOP = path.join(__dirname, "..");
const ROOT = fs.existsSync(path.join(DESKTOP, "index.html"))
  ? DESKTOP
  : path.join(DESKTOP, "..");
const SETTINGS_FILE = () => path.join(app.getPath("userData"), "desktop-settings.json");
const SMOKE = process.argv.includes("--smoke");

let mainWindow = null;
let overlayWindow = null;
let tray = null;
let logWatcher = null;
let overlayState = { ...EMPTY, hotkeys: { ...EMPTY.hotkeys } };
let settings = mergeDesktopSettings(null);

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8"));
    settings = mergeDesktopSettings(raw);
  } catch (_) { settings = mergeDesktopSettings(null); }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
  } catch (e) { console.warn("settings save", e.message); }
}

let saveTimer = null;
function saveSettingsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 500);
}

function statusPayload() {
  const p = settings.clientLogPath || findClientLog(null);
  return {
    clientLogPath: settings.clientLogPath,
    resolvedLogPath: p,
    logExists: !!(p && fs.existsSync(p)),
    watching: !!logWatcher,
    overlayEnabled: settings.overlayEnabled,
    overlayOpacity: settings.overlayOpacity,
    overlayTextSize: settings.overlayTextSize || "m",
    hotkeys: { ...settings.hotkeys },
    version: app.getVersion(),
    firstRunDone: settings.firstRunDone,
    autoUpdate: settings.autoUpdate !== false,
    clickThrough: settings.clickThrough !== false,
  };
}

function broadcastStatus() {
  const st = statusPayload();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("desktop:status", st);
}

/** Feedback for hotkeys is shown on the overlay itself, never by focusing the tracker. */
function toastOverlay(msg) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (!overlayWindow.isVisible()) overlayWindow.showInactive();
  overlayWindow.webContents.send("overlay:toast", String(msg || ""));
}

function startLogWatch(explicitPath) {
  if (logWatcher) { logWatcher.stop(); logWatcher = null; }
  const p = explicitPath || settings.clientLogPath || findClientLog(null);
  if (!p || !fs.existsSync(p) || !isAllowedLogPath(p, settings.pickedLogPath)) {
    broadcastStatus();
    return null;
  }
  settings.clientLogPath = fs.realpathSync.native(path.resolve(p));
  saveSettings();
  logWatcher = watchClientLog(settings.clientLogPath, (ev) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("desktop:zone", ev);
  }, {
    onError: (e) => console.warn("log watch", e.message),
  });
  broadcastStatus();
  return logWatcher;
}

function setClickThrough(on, { toast } = {}) {
  settings.clickThrough = !!on;
  saveSettings();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(!!settings.clickThrough, { forward: true });
    overlayWindow.setFocusable(!settings.clickThrough);
    overlayWindow.webContents.send("overlay:lock", !!settings.clickThrough);
  }
  broadcastStatus();
  updateTrayMenu();
  if (toast) {
    toastOverlay(settings.clickThrough
      ? "Overlay locked"
      : "Unlocked: drag to move, Ctrl+Alt+O to lock");
  }
  return settings.clickThrough;
}

/**
 * Apply requested global hotkeys. Invalid or duplicate combos are refused; a
 * combo that fails to register (taken by another app) is reverted. Returns
 * { hotkeys, results: { action: { ok, accel?, error? } } } for the requested actions.
 */
function setHotkeys(bindings) {
  const results = {};
  const prev = { ...settings.hotkeys };
  const next = { ...settings.hotkeys };
  const req = bindings && typeof bindings === "object" ? bindings : {};
  for (const k of HOTKEY_ACTIONS) {
    if (!(k in req)) continue;
    const v = validateAccelerator(req[k]);
    if (!v.ok) { results[k] = { ok: false, error: v.error }; continue; }
    const clash = HOTKEY_ACTIONS.find(o => o !== k && next[o] === v.accel);
    if (clash) { results[k] = { ok: false, accel: v.accel, error: `Already used for ${clash}` }; continue; }
    next[k] = v.accel;
    results[k] = { ok: true, accel: v.accel };
  }
  settings.hotkeys = next;
  const reg = applyHotkeys();
  let reverted = false;
  for (const k of Object.keys(results)) {
    if (results[k].ok && reg[k] && !reg[k].ok) {
      results[k] = { ok: false, accel: next[k], error: reg[k].error };
      settings.hotkeys[k] = prev[k];
      reverted = true;
    }
  }
  if (reverted) applyHotkeys();
  saveSettings();
  return { hotkeys: { ...settings.hotkeys }, results };
}

const NEW_RUN_CONFIRM_MS = 3000;
let newRunArmedAt = 0;

function applyHotkeys() {
  return registerAll(settings.hotkeys, (action) => {
    if (action === "clickThrough") {
      setClickThrough(!(settings.clickThrough !== false), { toast: true });
      return;
    }
    if (action === "newRun") {
      // Confirm on the overlay with a second press instead of stealing focus from the game.
      const now = Date.now();
      if (now - newRunArmedAt > NEW_RUN_CONFIRM_MS) {
        newRunArmedAt = now;
        toastOverlay("Press " + (settings.hotkeys.newRun || "again") + " again for a new run");
        return;
      }
      newRunArmedAt = 0;
      toastOverlay("New run");
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("desktop:hotkey", action);
  });
}

const OVERLAY = Object.freeze({ minW: 200, maxW: 440, minH: 48, maxH: 200, defW: 300, defH: 72 });
const clampW = w => Math.min(OVERLAY.maxW, Math.max(OVERLAY.minW, parseInt(w, 10) || OVERLAY.defW));
const clampH = h => Math.min(OVERLAY.maxH, Math.max(OVERLAY.minH, parseInt(h, 10) || OVERLAY.defH));

/**
 * Default spot: top-right but left of PoE2's minimap, which takes roughly the right
 * 17% of the screen width at the top (about 330 px at 1080p, more at 1440p/4K).
 */
function overlayDefaultBounds(display) {
  const wa = display.workArea;
  const w = OVERLAY.defW, h = OVERLAY.defH;
  const minimap = Math.max(340, Math.round(wa.width * 0.18));
  return {
    x: Math.max(wa.x + 16, wa.x + wa.width - w - minimap),
    y: wa.y + 20,
    width: w,
    height: h,
  };
}

/** First time the overlay shows (and after Reset position): say how to move it. */
function showOverlayMoveHint(force) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (settings.overlayHintShown && !force) return;
  settings.overlayHintShown = true;
  saveSettings();
  toastOverlay(`${settings.hotkeys.clickThrough || "Ctrl+Alt+O"} to move me`);
}

function resolveOverlayBounds() {
  const displays = screen.getAllDisplays();
  const saved = settings.overlayBounds;
  let display = screen.getPrimaryDisplay();
  if (saved && saved.displayId != null) {
    const found = displays.find(d => String(d.id) === String(saved.displayId));
    if (found) display = found;
  }
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const wa = display.workArea;
    const w = clampW(saved.width), h = clampH(saved.height);
    // saved x/y are relative to work area
    let x = wa.x + (saved.x || 0);
    let y = wa.y + (saved.y || 0);
    // Clamp on-screen
    x = Math.min(Math.max(x, wa.x), wa.x + wa.width - w);
    y = Math.min(Math.max(y, wa.y), wa.y + wa.height - h);
    return { display, bounds: { x, y, width: w, height: h } };
  }
  return { display, bounds: overlayDefaultBounds(display) };
}

function persistOverlayBounds() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  try {
    const b = overlayWindow.getBounds();
    const display = screen.getDisplayMatching(b);
    const wa = display.workArea;
    settings.overlayBounds = {
      displayId: String(display.id),
      x: b.x - wa.x,
      y: b.y - wa.y,
      width: b.width,
      height: b.height,
    };
    saveSettings();
  } catch (_) { /* */ }
}

function createOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  const { bounds } = resolveOverlayBounds();
  overlayWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: settings.clickThrough === false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-overlay.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  overlayWindow.setIgnoreMouseEvents(settings.clickThrough !== false, { forward: true });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  attachNavGuard(overlayWindow);
  overlayWindow.loadFile(path.join(DESKTOP, "overlay", "overlay.html"));
  overlayWindow.once("ready-to-show", () => {
    if (settings.overlayEnabled) {
      overlayWindow.showInactive();
      overlayWindow.setOpacity(settings.overlayOpacity);
    }
  });
  overlayWindow.on("moved", () => persistOverlayBounds());
  overlayWindow.on("closed", () => { overlayWindow = null; });
  return overlayWindow;
}

function setOverlayEnabled(on) {
  settings.overlayEnabled = !!on;
  saveSettings();
  if (on) {
    const w = createOverlay();
    if (w && !w.isDestroyed()) {
      w.showInactive();
      w.setOpacity(settings.overlayOpacity);
      w.webContents.send("overlay:state", overlayState);
    }
  } else if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  broadcastStatus();
  updateTrayMenu();
}

function resetOverlayPosition() {
  settings.overlayBounds = null;
  saveSettings();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    const { bounds } = resolveOverlayBounds();
    overlayWindow.setBounds(bounds);
    showOverlayMoveHint(true);
  }
}

/** E2: deny navigation away from the app's file: origin. */
/** Only the two bundled pages may ever be loaded (hash/query ignored). */
function isAppPageUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (_) { return false; }
  if (u.protocol !== "file:") return false;
  u.hash = ""; u.search = "";
  const allowed = [path.join(ROOT, "index.html"), path.join(DESKTOP, "overlay", "overlay.html")]
    .map(f => pathToFileURL(f).href);
  return allowed.includes(u.href);
}

function attachNavGuard(win) {
  const wc = win.webContents;
  const guard = (e, url) => { if (!isAppPageUrl(url)) e.preventDefault(); };
  wc.on("will-navigate", guard);
  wc.on("will-redirect", guard);
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Splitstone",
    backgroundColor: "#1a1410",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    icon: path.join(DESKTOP, "build", "icon.png"),
  });
  attachNavGuard(mainWindow);
  mainWindow.loadFile(path.join(ROOT, "index.html"));
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.webContents.on("did-finish-load", () => {
    broadcastStatus();
    const found = settings.clientLogPath || findClientLog(null);
    if (!settings.firstRunDone || !found || !fs.existsSync(found)) {
      mainWindow.webContents.send("desktop:first-run", {
        found: !!(found && fs.existsSync(found)),
        path: found || null,
      });
    } else {
      startLogWatch(found);
    }
    applyHotkeys();
    if (settings.overlayEnabled) createOverlay();
    if (SMOKE) {
      console.log("SMOKE_OK");
      setTimeout(() => app.quit(), 500);
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const ct = settings.clickThrough !== false;
  const menu = Menu.buildFromTemplate([
    { label: `Splitstone ${app.getVersion()}`, enabled: false },
    { type: "separator" },
    { label: "Show Splitstone", click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: "separator" },
    {
      label: ct ? "Unlock overlay (move)" : "Lock overlay (click-through)",
      click: () => setClickThrough(!ct, { toast: true }),
    },
    {
      label: settings.overlayEnabled ? "Hide overlay" : "Show overlay",
      click: () => setOverlayEnabled(!settings.overlayEnabled),
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  try {
    const iconPath = path.join(DESKTOP, "build", "icon.png");
    const img = nativeImage.createFromPath(iconPath);
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
    tray.setToolTip("Splitstone");
    updateTrayMenu();
    tray.on("click", () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
  } catch (e) {
    console.warn("tray", e.message);
  }
}

function senderIsMain(event) {
  return !!(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
}

function senderIsOverlay(event) {
  return !!(overlayWindow && !overlayWindow.isDestroyed() && event.sender === overlayWindow.webContents);
}

function wireIpc() {
  ipcMain.handle("desktop:get-status", (e) => {
    if (!senderIsMain(e)) return null;
    return statusPayload();
  });
  ipcMain.handle("desktop:find-client-log", (e) => {
    if (!senderIsMain(e)) return null;
    return findClientLog(settings.clientLogPath);
  });
  ipcMain.handle("desktop:set-client-log", (e, filePath) => {
    if (!senderIsMain(e)) return { ok: false, error: "denied" };
    if (!isClientTxtPath(filePath)) return { ok: false, error: "Pick Client.txt only" };
    if (!fs.existsSync(filePath)) return { ok: false, error: "File not found" };
    if (!isAllowedLogPath(filePath, settings.pickedLogPath))
      return { ok: false, error: "Use Browse to pick Client.txt" };
    startLogWatch(filePath);
    settings.firstRunDone = true;
    saveSettings();
    return { ok: true, path: settings.clientLogPath };
  });
  ipcMain.handle("desktop:browse-client-log", async (e) => {
    if (!senderIsMain(e)) return { ok: false, error: "denied" };
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "Find Path of Exile 2 Client.txt",
      filters: [{ name: "Client.txt", extensions: ["txt"] }],
      properties: ["openFile"],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, cancelled: true };
    const fp = res.filePaths[0];
    if (!isClientTxtPath(fp)) return { ok: false, error: "Please choose the file named Client.txt" };
    settings.pickedLogPath = path.resolve(fp);
    startLogWatch(fp);
    settings.firstRunDone = true;
    saveSettings();
    return { ok: true, path: settings.clientLogPath };
  });
  ipcMain.handle("desktop:set-hotkeys", (e, bindings) => {
    if (!senderIsMain(e)) return { hotkeys: settings.hotkeys, results: {} };
    return setHotkeys(bindings);
  });
  ipcMain.handle("desktop:set-overlay", (e, on) => {
    if (!senderIsMain(e)) return settings.overlayEnabled;
    setOverlayEnabled(on);
    return settings.overlayEnabled;
  });
  ipcMain.handle("desktop:set-auto-update", (e, on) => {
    if (!senderIsMain(e)) return settings.autoUpdate;
    return setAutoUpdate(!!on);
  });
  ipcMain.handle("desktop:get-auto-update", (e) => {
    if (!senderIsMain(e)) return true;
    return settings.autoUpdate !== false;
  });
  ipcMain.handle("desktop:set-overlay-opacity", (e, n) => {
    if (!senderIsMain(e)) return settings.overlayOpacity;
    const v = Math.min(1, Math.max(0.3, Number(n) || 0.8));
    settings.overlayOpacity = v;
    saveSettings();
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setOpacity(v);
    return v;
  });
  ipcMain.handle("desktop:set-click-through", (e, on) => {
    if (!senderIsMain(e)) return settings.clickThrough;
    return setClickThrough(!!on, { toast: true });
  });
  ipcMain.handle("desktop:reset-overlay-position", (e) => {
    if (!senderIsMain(e)) return false;
    resetOverlayPosition();
    return true;
  });
  ipcMain.on("desktop:overlay-state", (e, snapshot) => {
    if (!senderIsMain(e)) return;
    try {
      // clickThrough is owned by the main process; snapshots never change it.
      const next = normalise(snapshot);
      const changed = JSON.stringify(next) !== JSON.stringify(overlayState);
      overlayState = next;
      if (typeof snapshot.opacity === "number") {
        const op = Math.min(1, Math.max(0.3, snapshot.opacity));
        if (op !== settings.overlayOpacity) {
          settings.overlayOpacity = op;
          if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setOpacity(op);
          saveSettingsSoon();
        }
      }
      if (changed && overlayWindow && !overlayWindow.isDestroyed() && settings.overlayEnabled)
        overlayWindow.webContents.send("overlay:state", overlayState);
    } catch (_) { /* ignore */ }
  });
  ipcMain.on("overlay:resize", (e, size) => {
    if (!senderIsOverlay(e)) return;
    if (!overlayWindow || overlayWindow.isDestroyed() || !size) return;
    // Fixed height preferred for race mode — only bump if content needs it slightly
    const w = clampW(size.w), h = clampH(size.h);
    try {
      const b = overlayWindow.getBounds();
      if (b.width === w && b.height === h) return;
      overlayWindow.setBounds({ x: b.x, y: b.y, width: w, height: h });
      persistOverlayBounds();
    } catch (_) { /* */ }
  });
  ipcMain.on("overlay:ready", (e) => {
    if (!senderIsOverlay(e)) return;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send("overlay:text-size", settings.overlayTextSize || "m");
      overlayWindow.webContents.send("overlay:state", overlayState);
      if (settings.overlayEnabled) setTimeout(() => showOverlayMoveHint(false), 800);
    }
  });
  ipcMain.handle("desktop:set-overlay-text-size", (e, size) => {
    if (!senderIsMain(e)) return settings.overlayTextSize;
    if (!OVERLAY_TEXT_SIZES.includes(size)) return settings.overlayTextSize;
    settings.overlayTextSize = size;
    saveSettings();
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send("overlay:text-size", size);
    return size;
  });
  ipcMain.on("desktop:focus-main", (e) => {
    if (!senderIsMain(e)) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.moveTop();
    mainWindow.focus();
  });
  ipcMain.handle("desktop:dismiss-first-run", (e) => {
    if (!senderIsMain(e)) return null;
    settings.firstRunDone = true;
    saveSettings();
    if (!logWatcher) startLogWatch(settings.clientLogPath || findClientLog(null));
    return statusPayload();
  });
  ipcMain.handle("desktop:open-external", (e, url) => {
    if (!senderIsMain(e)) return false;
    const u = String(url || "");
    if (!/^https:\/\//i.test(u)) return false;
    shell.openExternal(u);
    return true;
  });
}

function setupAutoUpdater() {
  if (SMOKE) return; // launch checks stay offline
  if (!shouldCheckForUpdates(settings, { isPackaged: app.isPackaged, hasUpdater: !!autoUpdater }))
    return;
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.allowPrerelease = isPrereleaseVersion(app.getVersion());
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  } catch (_) { /* */ }
}

function setAutoUpdate(on) {
  settings.autoUpdate = !!on;
  saveSettings();
  if (settings.autoUpdate) setupAutoUpdater();
  broadcastStatus();
  return settings.autoUpdate;
}

// Single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    loadSettings();
    wireIpc();
    createMainWindow();
    if (!SMOKE) createTray();
    setupAutoUpdater();
    screen.on("display-metrics-changed", (_e, _display, changed) => {
      if (!changed.some(k => k === "scaleFactor" || k === "workArea" || k === "bounds")) return;
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      overlayWindow.setBounds(resolveOverlayBounds().bounds);
    });
    screen.on("display-removed", () => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        const { bounds } = resolveOverlayBounds();
        overlayWindow.setBounds(bounds);
      }
    });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });
}

app.on("will-quit", () => {
  unregisterAll();
  if (logWatcher) logWatcher.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

process.on("uncaughtException", (err) => {
  console.error("Splitstone crashed:", err);
  try {
    dialog.showErrorBox("Splitstone crashed", String(err && err.message || err));
  } catch (_) { /* */ }
  app.exit(1);
});

module.exports = { setHotkeys, isAppPageUrl, statusPayload, isClientTxtPath, findClientLog, setClickThrough, overlayDefaultBounds };
