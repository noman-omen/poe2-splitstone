"use strict";
/**
 * Global hotkeys via Electron globalShortcut.
 * Defaults are modifier combos (never bare Space/letters) so PoE2 keeps its keys.
 */
const { globalShortcut } = require("electron");
const { isSafeGlobalAccelerator } = require("./desktop-settings");

/** Normalize to an Electron accelerator, or null if unsafe/invalid. */
function toAccelerator(key) {
  if (!key || typeof key !== "string") return null;
  const raw = key.trim();
  if (!raw) return null;
  // Already an accelerator with modifiers
  if (/(CommandOrControl|CmdOrCtrl|Ctrl|Alt|Super|Meta|Shift)\+/i.test(raw)) {
    return isSafeGlobalAccelerator(raw) ? raw.replace(/CmdOrCtrl/gi, "CommandOrControl") : null;
  }
  // Plain keys are NOT registered globally (would steal from the game).
  return null;
}

function registerAll(bindings, onAction) {
  unregisterAll();
  const registered = [];
  const map = bindings || {};
  for (const action of ["split", "pause", "undo", "newRun", "clickThrough", "toggleHint"]) {
    const accel = toAccelerator(map[action]);
    if (!accel) continue;
    try {
      const ok = globalShortcut.register(accel, () => onAction(action));
      if (ok) registered.push({ action, accel });
      else console.warn("hotkey busy:", accel, action);
    } catch (e) {
      console.warn("hotkey failed:", accel, e.message);
    }
  }
  return registered;
}

function unregisterAll() {
  try { globalShortcut.unregisterAll(); } catch (_) { /* */ }
}

module.exports = { toAccelerator, registerAll, unregisterAll };
