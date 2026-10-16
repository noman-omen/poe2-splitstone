"use strict";
/**
 * Global hotkeys via Electron globalShortcut.
 * Defaults are modifier combos (never bare Space/letters) so PoE2 keeps its keys.
 */
const { globalShortcut } = require("electron");
const { validateAccelerator } = require("./desktop-settings");

/** Normalize to an Electron accelerator, or null if unsafe/invalid. */
/** Normalised Electron accelerator, or null if unsafe/invalid. Plain keys are never registered globally. */
function toAccelerator(key) {
  const v = validateAccelerator(key);
  return v.ok ? v.accel : null;
}

const ACTIONS = ["split", "pause", "undo", "newRun", "clickThrough", "toggleHint"];

/**
 * Register every binding. Returns { action: { ok, accel, error } } so the UI can
 * show a failure (e.g. the combo is taken by another app) instead of "saved".
 */
function registerAll(bindings, onAction) {
  unregisterAll();
  const results = {};
  const map = bindings || {};
  const seen = new Map();
  for (const action of ACTIONS) {
    const accel = toAccelerator(map[action]);
    if (!accel) { results[action] = { ok: false, error: "Invalid combo" }; continue; }
    if (seen.has(accel)) { results[action] = { ok: false, accel, error: `Already used for ${seen.get(accel)}` }; continue; }
    seen.set(accel, action);
    try {
      const ok = globalShortcut.register(accel, () => onAction(action));
      results[action] = ok ? { ok: true, accel } : { ok: false, accel, error: "In use by another app" };
    } catch (e) {
      results[action] = { ok: false, accel, error: e.message };
    }
  }
  return results;
}

function unregisterAll() {
  try { globalShortcut.unregisterAll(); } catch (_) { /* */ }
}

module.exports = { ACTIONS, toAccelerator, registerAll, unregisterAll };
