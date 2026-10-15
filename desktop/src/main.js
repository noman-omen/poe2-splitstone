"use strict";
/**
 * Splitstone desktop — Electron main process.
 * Loads the static web app, tails Client.txt, global hotkeys, overlay window.
 * Renderer talks over IPC only (no localhost helper required).
 */
const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require("electron");

const { findClientLog, watchClientLog, isClientTxtPath } = require("./client-log");
const { normalise, EMPTY } = require("./overlay-state");
const { registerAll, unregisterAll } = require("./hotkeys");

// Optional auto-update (GitHub Releases). Soft-fail if module missing in dev.
let autoUpdater = null;
try { autoUpdater = require("electron-updater").autoUpdater; } catch (_) { /* optional */ }

// Dev: desktop/src → repo root. Packaged: asar has index.html next to src/.
const DESKTOP = path.join(__dirname, "..");
const ROOT = fs.existsSync(path.join(DESKTOP, "index.html"))
  ? DESKTOP
  : path.join(DESKTOP, "..");
const SETTINGS_FILE = () => path.join(app.getPath("userData"), "desktop-settings.json");

let mainWindow = null;
let overlayWindow = null;
let firstRunWindow = null;
let logWatcher = null;
let overlayState = { ...EMPTY, hotkeys: { ...EMPTY.hotkeys } };
let settings = {
  clientLogPath: null,
  overlayEnabled: true,
  overlayOpacity: 0.92,
  hotkeys: { split: " ", pause: "p", undo: "u", newRun: "n" },
  firstRunDone: false,
};

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8"));
    if (raw && typeof raw === "object") {
      if (typeof raw.clientLogPath === "string" && isClientTxtPath(raw.clientLogPath))
        settings.clientLogPath = raw.clientLogPath;
      if (typeof raw.overlayEnabled === "boolean") settings.overlayEnabled = raw.overlayEnabled;
      if (typeof raw.overlayOpacity === "number") settings.overlayOpacity = Math.min(1, Math.max(0.3, raw.overlayOpacity));
      if (raw.hotkeys && typeof raw.hotkeys === "object") {
        for (const k of ["split", "pause", "undo", "newRun"]) {
          if (typeof raw.hotkeys[k] === "string") settings.hotkeys[k] = raw.hotkeys[k].slice(0, 16);
        }
      }
      if (raw.firstRunDone) settings.firstRunDone = true;
    }
  } catch (_) { /* first launch */ }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
  } catch (e) { console.warn("settings save", e.message); }
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
    hotkeys: { ...settings.hotkeys },
    firstRunDone: settings.firstRunDone,
  };
}

function broadcastStatus() {
  const st = statusPayload();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("desktop:status", st);
}

function startLogWatch(explicitPath) {
  if (logWatcher) { logWatcher.stop(); logWatcher = null; }
  const p = explicitPath || settings.clientLogPath || findClientLog(null);
  if (!p || !fs.existsSync(p)) {
    broadcastStatus();
    return null;
  }
  if (!isClientTxtPath(p)) return null;
  settings.clientLogPath = path.resolve(p);
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

function applyHotkeys() {
  registerAll(settings.hotkeys, (action) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("desktop:hotkey", action);
  });
}

function createOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  overlayWindow = new BrowserWindow({
    width: 360,
    height: 220,
    x: width - 380,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-overlay.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.loadFile(path.join(DESKTOP, "overlay", "overlay.html"));
  overlayWindow.once("ready-to-show", () => {
    if (settings.overlayEnabled) {
      overlayWindow.showInactive();
      overlayWindow.setOpacity(settings.overlayOpacity);
    }
  });
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
  });
}

function createFirstRunIfNeeded() {
  // First-run UI lives in the renderer (injected banner); main only signals.
}

/* ---------- IPC ---------- */
function wireIpc() {
  ipcMain.handle("desktop:get-status", () => statusPayload());
  ipcMain.handle("desktop:find-client-log", () => findClientLog(settings.clientLogPath));
  ipcMain.handle("desktop:set-client-log", (_e, filePath) => {
    if (!isClientTxtPath(filePath)) return { ok: false, error: "Pick Client.txt only" };
    if (!fs.existsSync(filePath)) return { ok: false, error: "File not found" };
    startLogWatch(filePath);
    settings.firstRunDone = true;
    saveSettings();
    return { ok: true, path: settings.clientLogPath };
  });
  ipcMain.handle("desktop:browse-client-log", async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "Find Path of Exile 2 Client.txt",
      filters: [{ name: "Client.txt", extensions: ["txt"] }],
      properties: ["openFile"],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, cancelled: true };
    const fp = res.filePaths[0];
    if (!isClientTxtPath(fp)) return { ok: false, error: "Please choose the file named Client.txt" };
    startLogWatch(fp);
    settings.firstRunDone = true;
    saveSettings();
    return { ok: true, path: settings.clientLogPath };
  });
  ipcMain.handle("desktop:set-hotkeys", (_e, bindings) => {
    if (bindings && typeof bindings === "object") {
      for (const k of ["split", "pause", "undo", "newRun"]) {
        if (typeof bindings[k] === "string") settings.hotkeys[k] = bindings[k].slice(0, 16);
      }
      saveSettings();
      applyHotkeys();
    }
    return settings.hotkeys;
  });
  ipcMain.handle("desktop:set-overlay", (_e, on) => { setOverlayEnabled(on); return settings.overlayEnabled; });
  ipcMain.handle("desktop:set-overlay-opacity", (_e, n) => {
    const v = Math.min(1, Math.max(0.3, Number(n) || 0.92));
    settings.overlayOpacity = v;
    saveSettings();
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setOpacity(v);
    return v;
  });
  ipcMain.on("desktop:overlay-state", (_e, snapshot) => {
    try {
      overlayState = normalise(snapshot);
      if (overlayWindow && !overlayWindow.isDestroyed() && settings.overlayEnabled)
        overlayWindow.webContents.send("overlay:state", overlayState);
    } catch (_) { /* ignore bad snapshots */ }
  });
  ipcMain.on("overlay:ready", () => {
    if (overlayWindow && !overlayWindow.isDestroyed())
      overlayWindow.webContents.send("overlay:state", overlayState);
  });
  ipcMain.handle("desktop:dismiss-first-run", () => {
    settings.firstRunDone = true;
    saveSettings();
    if (!logWatcher) startLogWatch(settings.clientLogPath || findClientLog(null));
    return statusPayload();
  });
  ipcMain.handle("desktop:open-external", (_e, url) => {
    const u = String(url || "");
    if (!/^https:\/\//i.test(u)) return false;
    shell.openExternal(u);
    return true;
  });
}

function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  } catch (_) { /* */ }
}

app.whenReady().then(() => {
  loadSettings();
  wireIpc();
  createMainWindow();
  setupAutoUpdater();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("will-quit", () => {
  unregisterAll();
  if (logWatcher) logWatcher.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Export for tests
module.exports = { statusPayload, isClientTxtPath, findClientLog };
