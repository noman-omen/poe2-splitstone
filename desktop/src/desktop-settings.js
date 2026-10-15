"use strict";
/**
 * Desktop-only preferences (userData/desktop-settings.json).
 * Kept free of Electron so unit tests can assert defaults.
 */
const { isClientTxtPath } = require("./client-log");

const DEFAULTS = Object.freeze({
  clientLogPath: null,
  overlayEnabled: true,
  overlayOpacity: 0.92,
  hotkeys: Object.freeze({ split: " ", pause: "p", undo: "u", newRun: "n" }),
  firstRunDone: false,
  /** Check GitHub Releases for updates on launch (packaged builds only). */
  autoUpdate: true,
});

function blank() {
  return {
    clientLogPath: null,
    overlayEnabled: true,
    overlayOpacity: 0.92,
    hotkeys: { split: " ", pause: "p", undo: "u", newRun: "n" },
    firstRunDone: false,
    autoUpdate: true,
  };
}

/** Merge raw JSON into a safe settings object. Missing autoUpdate → true (on by default). */
function merge(raw) {
  const out = blank();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  if (typeof raw.clientLogPath === "string" && isClientTxtPath(raw.clientLogPath))
    out.clientLogPath = raw.clientLogPath;
  if (typeof raw.overlayEnabled === "boolean") out.overlayEnabled = raw.overlayEnabled;
  if (typeof raw.overlayOpacity === "number")
    out.overlayOpacity = Math.min(1, Math.max(0.3, raw.overlayOpacity));
  if (raw.hotkeys && typeof raw.hotkeys === "object") {
    for (const k of ["split", "pause", "undo", "newRun"]) {
      if (typeof raw.hotkeys[k] === "string") out.hotkeys[k] = raw.hotkeys[k].slice(0, 16);
    }
  }
  if (raw.firstRunDone) out.firstRunDone = true;
  // Explicit false turns it off; anything else (missing/undefined) stays on.
  if (raw.autoUpdate === false) out.autoUpdate = false;
  else out.autoUpdate = true;
  return out;
}

/** Whether the main process should call electron-updater on launch. */
function shouldCheckForUpdates(settings, opts = {}) {
  const packaged = opts.isPackaged === true;
  const hasUpdater = opts.hasUpdater === true;
  return !!(packaged && hasUpdater && settings && settings.autoUpdate !== false);
}

module.exports = { DEFAULTS, blank, merge, shouldCheckForUpdates };
