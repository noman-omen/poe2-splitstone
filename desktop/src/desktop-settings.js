"use strict";
/**
 * Desktop-only preferences (userData/desktop-settings.json).
 * Kept free of Electron so unit tests can assert defaults.
 */
const { isClientTxtPath } = require("./client-log");

/** Global (system-wide) accelerators — always modifier combos so we don't steal Space/letters from the game. */
const DEFAULT_GLOBAL_HOTKEYS = Object.freeze({
  split: "Ctrl+Alt+S",
  undo: "Ctrl+Alt+Z",
  pause: "Ctrl+Alt+P",
  newRun: "Ctrl+Alt+R",
  clickThrough: "Ctrl+Alt+O",
  toggleHint: "Ctrl+Alt+H",
});

const DEFAULTS = Object.freeze({
  clientLogPath: null,
  pickedLogPath: null,
  overlayEnabled: true,
  overlayOpacity: 0.80,
  hotkeys: DEFAULT_GLOBAL_HOTKEYS,
  firstRunDone: false,
  clickThrough: true,
  autoUpdate: true,
  overlayBounds: null, // { displayId, x, y, width, height } relative to display work area
});

function blank() {
  return {
    clientLogPath: null,
    pickedLogPath: null,
    overlayEnabled: true,
    overlayOpacity: 0.80,
    hotkeys: { ...DEFAULT_GLOBAL_HOTKEYS },
    firstRunDone: false,
    clickThrough: true,
    autoUpdate: true,
    overlayBounds: null,
  };
}

function merge(raw) {
  const out = blank();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  if (typeof raw.clientLogPath === "string" && isClientTxtPath(raw.clientLogPath))
    out.clientLogPath = raw.clientLogPath;
  if (typeof raw.pickedLogPath === "string" && isClientTxtPath(raw.pickedLogPath))
    out.pickedLogPath = raw.pickedLogPath;
  if (typeof raw.overlayEnabled === "boolean") out.overlayEnabled = raw.overlayEnabled;
  if (typeof raw.overlayOpacity === "number")
    out.overlayOpacity = Math.min(1, Math.max(0.3, raw.overlayOpacity));
  if (raw.hotkeys && typeof raw.hotkeys === "object") {
    for (const k of Object.keys(DEFAULT_GLOBAL_HOTKEYS)) {
      if (typeof raw.hotkeys[k] === "string" && raw.hotkeys[k].trim()) {
        const a = raw.hotkeys[k].trim().slice(0, 32);
        // Drop bare Space/letters left over from v0.6.0 — keep defaults instead.
        out.hotkeys[k] = isSafeGlobalAccelerator(a) ? a : DEFAULT_GLOBAL_HOTKEYS[k];
      }
    }
  }
  if (raw.firstRunDone) out.firstRunDone = true;
  if (typeof raw.clickThrough === "boolean") out.clickThrough = raw.clickThrough;
  if (raw.autoUpdate === false) out.autoUpdate = false;
  else out.autoUpdate = true;
  if (raw.overlayBounds && typeof raw.overlayBounds === "object") {
    out.overlayBounds = {
      displayId: raw.overlayBounds.displayId != null ? String(raw.overlayBounds.displayId) : null,
      x: Number(raw.overlayBounds.x) || 0,
      y: Number(raw.overlayBounds.y) || 0,
      width: Math.min(320, Math.max(160, Number(raw.overlayBounds.width) || 280)),
      height: Math.min(240, Math.max(48, Number(raw.overlayBounds.height) || 72)),
    };
  }
  return out;
}

function shouldCheckForUpdates(settings, opts = {}) {
  const packaged = opts.isPackaged === true;
  const hasUpdater = opts.hasUpdater === true;
  return !!(packaged && hasUpdater && settings && settings.autoUpdate !== false);
}

/** Reject plain single-key globals that would steal gaming keys. */
function isSafeGlobalAccelerator(accel) {
  if (!accel || typeof accel !== "string") return false;
  const a = accel.trim();
  if (!a) return false;
  // Must include a modifier
  if (!/(CommandOrControl|CmdOrCtrl|Ctrl|Alt|Super|Meta|Shift)\+/i.test(a)) return false;
  // Ban bare Space / single letter even with only Shift
  const parts = a.split("+").map(s => s.trim().toLowerCase());
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (mods.length === 1 && mods[0] === "shift" && (key === "space" || key.length === 1))
    return false;
  return true;
}

/** True for semver prereleases such as 1.1.0-beta.1. */
function isPrereleaseVersion(v) {
  return /^\d+\.\d+\.\d+-/.test(String(v || "").trim());
}

module.exports = {
  DEFAULTS, DEFAULT_GLOBAL_HOTKEYS, blank, merge, shouldCheckForUpdates, isSafeGlobalAccelerator, isPrereleaseVersion,
};
