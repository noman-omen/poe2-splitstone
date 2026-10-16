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
      const v = validateAccelerator(raw.hotkeys[k]);
      // Unsafe or stale bindings (e.g. bare keys from 0.6) fall back to the default.
      out.hotkeys[k] = v.ok ? v.accel : DEFAULT_GLOBAL_HOTKEYS[k];
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
const ACCEL_MAX_LEN = 32;
const MOD_ALIASES = { ctrl: "Ctrl", control: "Ctrl", commandorcontrol: "Ctrl", cmdorctrl: "Ctrl", alt: "Alt", shift: "Shift" };
const MOD_ORDER = ["Ctrl", "Alt", "Shift"];
// Combos the OS or common apps own; never take them globally.
const BLOCKED_ACCELERATORS = new Set([
  "Ctrl+Alt+Delete", "Ctrl+Alt+F4", "Ctrl+Shift+F4", "Ctrl+Alt+Shift+F4", "Ctrl+Shift+Escape",
  "Ctrl+Alt+Tab", "Ctrl+Shift+Tab", "Ctrl+Alt+L", "Ctrl+Alt+T",
  // Undo/redo, reopen tab, paste plain text and dev tools in browsers and editors.
  "Ctrl+Shift+Z", "Ctrl+Shift+T", "Ctrl+Shift+V", "Ctrl+Shift+C",
]);

/** Normalised key name, or null if it isn't a key we allow (letters, digits, F1-F24, numpad digits). */
function normaliseKey(k) {
  if (/^[a-z0-9]$/i.test(k)) return k.toUpperCase();
  let m = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(k);
  if (m) return "F" + m[1];
  m = /^num([0-9])$/i.exec(k);
  if (m) return "num" + m[1];
  return null;
}

/**
 * Validate a global hotkey. Must be Ctrl+Alt or Ctrl+Shift (optionally both)
 * plus exactly one allowed key; Super/Meta and OS-reserved combos are refused.
 * Returns { ok, accel, error } where accel is the normalised accelerator.
 */
function validateAccelerator(raw) {
  if (typeof raw !== "string") return { ok: false, error: "Not a key combo" };
  const trimmed = raw.trim();
  if (trimmed.length > ACCEL_MAX_LEN) return { ok: false, error: "Too long" };
  const parts = trimmed.split("+").map(s => s.trim());
  if (parts.length < 2 || parts.some(p => !p)) return { ok: false, error: "Use Ctrl+Alt or Ctrl+Shift with a key" };
  const mods = new Set();
  let key = null;
  for (const part of parts) {
    const mod = MOD_ALIASES[part.toLowerCase()];
    if (mod) {
      if (mods.has(mod)) return { ok: false, error: "Repeated modifier" };
      mods.add(mod);
      continue;
    }
    if (/^(super|meta|cmd|command|win|windows)$/i.test(part)) return { ok: false, error: "Windows/Super key combos aren't allowed" };
    if (key !== null) return { ok: false, error: "Only one key besides the modifiers" };
    key = normaliseKey(part);
    if (!key) return { ok: false, error: `"${part}" isn't allowed; use a letter, digit or F-key` };
  }
  if (!key) return { ok: false, error: "Add a key after the modifiers" };
  if (!mods.has("Ctrl") || !(mods.has("Alt") || mods.has("Shift")))
    return { ok: false, error: "Use Ctrl+Alt or Ctrl+Shift with a key" };
  const accel = MOD_ORDER.filter(m => mods.has(m)).concat(key).join("+");
  if (BLOCKED_ACCELERATORS.has(accel)) return { ok: false, error: `${accel} is reserved by the system` };
  return { ok: true, accel };
}

function isSafeGlobalAccelerator(accel) { return validateAccelerator(accel).ok; }

/** True for semver prereleases such as 1.1.0-beta.1. */
function isPrereleaseVersion(v) {
  return /^\d+\.\d+\.\d+-/.test(String(v || "").trim());
}

module.exports = {
  DEFAULTS, DEFAULT_GLOBAL_HOTKEYS, blank, merge, shouldCheckForUpdates, isSafeGlobalAccelerator, validateAccelerator, isPrereleaseVersion,
};
