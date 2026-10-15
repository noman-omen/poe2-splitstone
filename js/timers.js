/* timers.js: start/stop stopwatches stored as { elapsed, startedAt }.
 * Storing a start timestamp (not a ticking counter) keeps timers accurate
 * across reloads and background tabs. */
(function (global) {
  "use strict";

  const get = (c, key) => c.timers[key] || (c.timers[key] = { elapsed: 0, startedAt: null });
  const isRunning = (c, key) => !!(c.timers[key] && c.timers[key].startedAt);

  function value(c, key, now = Date.now()) {
    const t = c.timers[key];
    if (!t) return 0;
    return t.elapsed + (t.startedAt ? now - t.startedAt : 0);
  }

  function start(c, key) { const t = get(c, key); if (!t.startedAt) t.startedAt = Date.now(); }
  function stop(c, key) {
    const t = get(c, key);
    if (t.startedAt) { t.elapsed += Date.now() - t.startedAt; t.startedAt = null; }
  }
  function toggle(c, key) { isRunning(c, key) ? stop(c, key) : start(c, key); }
  function reset(c, key) { delete c.timers[key]; }

  /** Sum of every timer whose key starts with `prefix`. */
  function sum(c, prefix, now = Date.now()) {
    return Object.keys(c.timers).filter(k => k.startsWith(prefix))
      .reduce((a, k) => a + value(c, k, now), 0);
  }

  function format(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    const p = n => String(n).padStart(2, "0");
    return `${h}:${p(m)}:${p(sec)}`;
  }

  global.Timers = { value, start, stop, toggle, reset, isRunning, sum, format };
})(window);
