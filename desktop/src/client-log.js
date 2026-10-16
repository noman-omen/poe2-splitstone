"use strict";
/**
 * Find + tail PoE2 Client.txt. File reads are limited to this log path only.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Parser } = require("./log-parser");

const DEFAULT_CANDIDATES = [
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt",
  "C:\\Program Files\\Steam\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt",
  "C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile 2\\logs\\Client.txt",
  "C:\\Program Files\\Grinding Gear Games\\Path of Exile 2\\logs\\Client.txt",
  path.join(os.homedir(), ".steam/steam/steamapps/common/Path of Exile 2/logs/Client.txt"),
  path.join(os.homedir(), ".local/share/Steam/steamapps/common/Path of Exile 2/logs/Client.txt"),
];

function isClientTxtPath(p) {
  if (!p || typeof p !== "string") return false;
  // Normalize Windows separators when this code runs on Linux (CI / tests).
  const norm = p.replace(/\\/g, "/");
  const base = path.basename(norm).toLowerCase();
  return base === "client.txt";
}

function realpathOrNull(p) {
  try { return fs.realpathSync.native(path.resolve(p)); } catch (_) { return null; }
}

/**
 * A log path is allowed when it resolves (symlinks followed) to a file named
 * Client.txt that is either one of the known PoE2 install locations or the
 * exact file the user picked in the Browse dialog.
 */
function isAllowedLogPath(p, pickedPath, candidates = DEFAULT_CANDIDATES) {
  if (!isClientTxtPath(p)) return false;
  const real = realpathOrNull(p);
  if (!real || !isClientTxtPath(real)) return false;
  const same = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (pickedPath) {
    const pr = realpathOrNull(pickedPath);
    if (pr && same(pr, real)) return true;
  }
  return candidates.some(c => { const cr = realpathOrNull(c); return cr && same(cr, real); });
}

function findClientLog(override) {
  if (override && isClientTxtPath(override) && fs.existsSync(override)) return path.resolve(override);
  for (const c of DEFAULT_CANDIDATES) {
    try {
      if (fs.existsSync(c)) return path.resolve(c);
    } catch (_) { /* continue */ }
  }
  return null;
}

/**
 * Tail a Client.txt file from EOF (or start). Calls onEvent for zone events.
 * Returns { stop, path, exists }.
 */
function watchClientLog(logPath, onEvent, opts = {}) {
  if (!isClientTxtPath(logPath)) throw new Error("Only Client.txt may be watched");
  const resolved = path.resolve(logPath);
  const pollMs = opts.pollMs || 250;
  const fromStart = !!opts.fromStart;
  const parser = new Parser(onEvent);
  let stopped = false;
  let pos = 0;
  let carry = "";
  let exists = fs.existsSync(resolved);

  function readNew() {
    if (stopped) return;
    try {
      if (!fs.existsSync(resolved)) {
        exists = false;
        return;
      }
      exists = true;
      const st = fs.statSync(resolved);
      if (st.size < pos) { pos = 0; carry = ""; } // truncated
      if (st.size === pos) {
        parser.flush(Date.now() / 1000);
        return;
      }
      const fd = fs.openSync(resolved, "r");
      try {
        const len = st.size - pos;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, pos);
        pos = st.size;
        const text = carry + buf.toString("utf8");
        const lines = text.split(/\r?\n/);
        carry = lines.pop() || "";
        const now = Date.now() / 1000;
        for (const line of lines) parser.feed(line, now);
      } finally {
        fs.closeSync(fd);
      }
    } catch (e) {
      if (opts.onError) opts.onError(e);
    }
  }

  if (exists && !fromStart) {
    try { pos = fs.statSync(resolved).size; } catch (_) { pos = 0; }
  }

  const timer = setInterval(readNew, pollMs);
  readNew();

  return {
    path: resolved,
    get exists() { return exists; },
    stop() { stopped = true; clearInterval(timer); },
  };
}

module.exports = { DEFAULT_CANDIDATES, isClientTxtPath, isAllowedLogPath, findClientLog, watchClientLog };
