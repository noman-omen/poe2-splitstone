"use strict";
/**
 * Global hotkeys via Electron globalShortcut.
 * Accelerator strings use Electron syntax (Space, CommandOrControl+…, etc.).
 */
const { globalShortcut } = require("electron");

/** Map app key binding (KeyboardEvent.key style) → Electron accelerator. */
function toAccelerator(key) {
  if (!key) return null;
  if (key === " ") return "Space";
  const lower = String(key);
  // Already an accelerator?
  if (/^(CommandOrControl|Ctrl|Alt|Shift|Super)\+/i.test(lower)) return lower;
  if (lower.length === 1) {
    const ch = lower.toUpperCase();
    if (/[A-Z0-9]/.test(ch)) return ch;
  }
  const map = {
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    Escape: "Escape", Enter: "Return", Tab: "Tab", Backspace: "Backspace",
    Delete: "Delete", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  };
  if (map[lower]) return map[lower];
  // F-keys
  if (/^F\d{1,2}$/i.test(lower)) return lower.toUpperCase();
  return null;
}

function registerAll(bindings, onAction) {
  unregisterAll();
  const registered = [];
  const map = bindings || {};
  for (const action of ["split", "pause", "undo", "newRun"]) {
    const accel = toAccelerator(map[action]);
    if (!accel) continue;
    try {
      const ok = globalShortcut.register(accel, () => onAction(action));
      if (ok) registered.push(accel);
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
