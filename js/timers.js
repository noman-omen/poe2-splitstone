/* timers.js: start/stop stopwatches stored as { elapsed, startedAt }.
 * Storing a start timestamp (not a ticking counter) keeps timers accurate
 * across reloads and background tabs. */
(function (global) {
  "use strict";

  // Timer keys come from saves and imports: never let one reach Object.prototype.
  const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  const ok = key => typeof key === "string" && !BAD_KEYS.has(key);
  const own = (c, key) => (ok(key) && c.timers && Object.prototype.hasOwnProperty.call(c.timers, key) ? c.timers[key] : undefined);
  const get = (c, key) => own(c, key) || (c.timers[key] = { elapsed: 0, startedAt: null });
  const isRunning = (c, key) => !!(own(c, key) && own(c, key).startedAt);

  /* Wall-clock timestamps survive reloads, but the clock can jump (NTP, DST fixes,
   * a manual change). A running segment never counts negative time, and a jump
   * backwards while running is absorbed: the segment simply resumes from where it was. */
  const since = (t, now) => (t.startedAt ? Math.max(0, now - t.startedAt) : 0);

  function value(c, key, now = Date.now()) {
    const t = own(c, key);
    if (!t) return 0;
    return Math.max(0, t.elapsed || 0) + since(t, now);
  }

  function start(c, key) { if (!ok(key)) return; const t = get(c, key); if (!t.startedAt) t.startedAt = Date.now(); }
  function stop(c, key) {
    if (!ok(key)) return;
    const t = get(c, key);
    if (t.startedAt) { t.elapsed = Math.max(0, t.elapsed || 0) + since(t, Date.now()); t.startedAt = null; }
  }
  /**
   * The clock jumped backwards: shift running timers by the jump so the time they had
   * at `lastNow` is kept (nothing lost, nothing invented). Without a `lastNow` (e.g. after
   * a reload) a start time in the future is pulled back to now.
   */
  function rebase(c, now = Date.now(), lastNow = null) {
    const back = lastNow !== null && now < lastNow ? lastNow - now : 0;
    for (const t of Object.values(c.timers)) {
      if (!t.startedAt) continue;
      if (back) t.startedAt -= back;
      if (t.startedAt > now) t.startedAt = now;
    }
    return back;
  }
  function toggle(c, key) { isRunning(c, key) ? stop(c, key) : start(c, key); }
  function reset(c, key) { if (ok(key)) delete c.timers[key]; }

  /** Sum of every timer whose key starts with `prefix`. */
  function sum(c, prefix, now = Date.now()) {
    return Object.keys(c.timers).filter(k => k.startsWith(prefix))
      .reduce((a, k) => a + value(c, k, now), 0);
  }

  function format(ms) {
    const s = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    const p = n => String(n).padStart(2, "0");
    return `${h}:${p(m)}:${p(sec)}`;
  }

  global.Timers = { value, start, stop, toggle, reset, isRunning, sum, format, rebase };
  if (typeof module !== "undefined" && module.exports) module.exports = global.Timers;
})(typeof window !== "undefined" ? window : globalThis);
