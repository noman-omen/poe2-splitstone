/*
 * Endgame map tracking: pure logic on a character's `endgame` object.
 * No DOM here so it can be unit-tested with node.
 *
 * endgame = {
 *   runs: [{ id, map, tier, mods, started, ms, completed, deaths, notes, loot, sessionId, auto }], newest first
 *   active: null | { id, map, tier, mods, started, elapsed, resumedAt, deaths, notes, loot, auto, area },
 *   sessions: [{ id, started, ended }], newest first
 *   sessionId: id of the open session or null,
 *   atlas: { milestoneId: ISO date },
 * }
 */
(function (global) {
  "use strict";

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const iso = ms => new Date(ms).toISOString();
  const clampInt = (v, lo, hi) => { if (v === null || v === undefined || v === "") return null; const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  function blank() {
    return { runs: [], active: null, sessions: [], sessionId: null, atlas: {} };
  }

  function normaliseRun(r) {
    const src = r && typeof r === "object" ? r : {};
    const ms = Number(src.ms);
    return {
      id: str(src.id, 40) || uid(),
      map: str(src.map, 80) || "Unknown map",
      tier: clampInt(src.tier, 1, 20),
      mods: str(src.mods, 300),
      started: typeof src.started === "string" ? src.started : null,
      ms: Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : 0,
      completed: src.completed !== false,
      deaths: clampInt(src.deaths, 0, 99) || 0,
      notes: str(src.notes, 500),
      loot: str(src.loot, 300),
      sessionId: typeof src.sessionId === "string" ? src.sessionId : null,
      auto: !!src.auto,
    };
  }

  /** Validate anything loaded from storage or an import. */
  function normalise(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const out = blank();
    out.runs = (Array.isArray(src.runs) ? src.runs : []).slice(0, 5000).map(normaliseRun);
    if (src.active && typeof src.active === "object") {
      const a = normaliseRun(src.active);
      const el = Number(src.active.elapsed);
      const ra = Number(src.active.resumedAt);
      out.active = Object.assign(a, {
        elapsed: Number.isFinite(el) && el >= 0 ? el : 0,
        resumedAt: Number.isFinite(ra) && ra > 0 ? ra : null,
        area: str(src.active.area, 80),
      });
      delete out.active.ms; delete out.active.completed;
    }
    out.sessions = (Array.isArray(src.sessions) ? src.sessions : []).slice(0, 1000)
      .filter(s => s && typeof s.id === "string" && typeof s.started === "string")
      .map(s => ({ id: s.id.slice(0, 40), started: s.started, ended: typeof s.ended === "string" ? s.ended : null }));
    out.sessionId = typeof src.sessionId === "string" && out.sessions.some(s => s.id === src.sessionId) ? src.sessionId : null;
    const atlas = src.atlas && typeof src.atlas === "object" ? src.atlas : {};
    Object.keys(atlas).slice(0, 200).forEach(k => { if (typeof atlas[k] === "string") out.atlas[k.slice(0, 64)] = atlas[k]; });
    return out;
  }

  /** "Burial Bog (T5)" -> { map: "Burial Bog", tier: 5 } */
  function parseLegacyName(name) {
    const s = String(name || "").trim();
    const m = /^(.*?)[\s(]*\bT(\d{1,2})\)?\s*$/i.exec(s);
    return m && m[1] ? { map: m[1].trim(), tier: Number(m[2]) } : { map: s || "Unknown map", tier: null };
  }

  /** Old schema stored finished map runs as mapHistory [{ id, name, ms, finished }]. */
  function fromLegacyMapHistory(mapHistory) {
    const eg = blank();
    eg.runs = (Array.isArray(mapHistory) ? mapHistory : []).map(h => {
      const p = parseLegacyName(h && h.name);
      const ms = Number(h && h.ms) || 0;
      const finished = h && typeof h.finished === "string" ? Date.parse(h.finished) : NaN;
      return normaliseRun({
        id: h && h.id, map: p.map, tier: p.tier, ms, completed: true,
        started: Number.isFinite(finished) ? iso(finished - ms) : null,
      });
    });
    return eg;
  }

  /* ---------- Sessions ---------- */
  function currentSession(eg) {
    return eg.sessionId ? eg.sessions.find(s => s.id === eg.sessionId) || null : null;
  }
  function startSession(eg, now) {
    if (currentSession(eg)) return currentSession(eg);
    const s = { id: uid(), started: iso(now), ended: null };
    eg.sessions.unshift(s);
    eg.sessionId = s.id;
    return s;
  }
  function endSession(eg, now) {
    if (eg.active) finishMap(eg, { completed: true }, now);
    const s = currentSession(eg);
    if (s) s.ended = iso(now);
    eg.sessionId = null;
    return s;
  }

  /* ---------- Map runs ---------- */
  function activeMs(eg, now) {
    const a = eg.active;
    if (!a) return 0;
    return a.elapsed + (a.resumedAt ? Math.max(0, now - a.resumedAt) : 0);
  }
  const isRunning = eg => !!(eg.active && eg.active.resumedAt);

  function startMap(eg, info, now) {
    if (eg.active) throw new Error("Finish the current map first");
    const i = info || {};
    startSession(eg, now);
    eg.active = {
      id: uid(), map: str(i.map, 80) || "Unknown map", tier: clampInt(i.tier, 1, 20), mods: str(i.mods, 300),
      started: iso(now), elapsed: 0, resumedAt: now, deaths: 0, notes: "", loot: "",
      sessionId: eg.sessionId, auto: !!i.auto, area: str(i.area, 80),
    };
    return eg.active;
  }
  function pauseMap(eg, now) {
    const a = eg.active;
    if (!a || !a.resumedAt) return false;
    a.elapsed += Math.max(0, now - a.resumedAt);
    a.resumedAt = null;
    return true;
  }
  function resumeMap(eg, now) {
    const a = eg.active;
    if (!a || a.resumedAt) return false;
    a.resumedAt = now;
    return true;
  }
  function addDeath(eg, delta) {
    if (!eg.active) return 0;
    eg.active.deaths = Math.max(0, Math.min(99, eg.active.deaths + (delta || 1)));
    return eg.active.deaths;
  }
  function updateActive(eg, fields) {
    if (!eg.active) return null;
    const f = fields || {};
    if ("map" in f) eg.active.map = str(f.map, 80) || eg.active.map;
    if ("tier" in f) eg.active.tier = clampInt(f.tier, 1, 20);
    if ("mods" in f) eg.active.mods = str(f.mods, 300);
    if ("notes" in f) eg.active.notes = str(f.notes, 500);
    if ("loot" in f) eg.active.loot = str(f.loot, 300);
    return eg.active;
  }
  function finishMap(eg, opts, now) {
    const a = eg.active;
    if (!a) return null;
    const run = normaliseRun(Object.assign({}, a, {
      ms: activeMs(eg, now),
      completed: !(opts && opts.completed === false),
    }));
    eg.runs.unshift(run);
    eg.active = null;
    return run;
  }
  function discardMap(eg) { const had = !!eg.active; eg.active = null; return had; }

  /* ---------- Stats ---------- */
  function stats(runs, opts) {
    const list = runs || [];
    const done = list.filter(r => r.completed);
    const totalMs = list.reduce((a, r) => a + r.ms, 0);
    const deaths = list.reduce((a, r) => a + r.deaths, 0);
    // Maps/hour uses wall-clock time when given (sessions include hideout time), else time in maps.
    const hours = ((opts && opts.wallMs) || totalMs) / 3600000;
    return {
      maps: list.length,
      completed: done.length,
      totalMs,
      avgMs: done.length ? done.reduce((a, r) => a + r.ms, 0) / done.length : null,
      bestMs: done.length ? Math.min(...done.map(r => r.ms)) : null,
      deaths,
      mapsPerHour: hours > 0 ? done.length / hours : null,
    };
  }

  function sessionStats(eg, sessionId, now) {
    const s = eg.sessions.find(x => x.id === sessionId);
    if (!s) return null;
    const runs = eg.runs.filter(r => r.sessionId === sessionId);
    const end = s.ended ? Date.parse(s.ended) : now;
    return Object.assign({ session: s }, stats(runs, { wallMs: Math.max(0, end - Date.parse(s.started)) }));
  }

  /** Per-map PB / average, keyed by lower-case map name. */
  function perMap(runs) {
    const out = {};
    (runs || []).forEach(r => {
      if (!r.completed) return;
      const k = r.map.toLowerCase(), s = out[k] || (out[k] = { map: r.map, runs: 0, sum: 0, pb: null });
      s.runs++; s.sum += r.ms;
      if (s.pb === null || r.ms < s.pb) s.pb = r.ms;
    });
    Object.values(out).forEach(s => { s.avg = s.sum / s.runs; });
    return out;
  }

  /* ---------- Atlas checklist ---------- */
  function toggleMilestone(eg, id, now) {
    if (eg.atlas[id]) delete eg.atlas[id];
    else eg.atlas[id] = iso(now);
    return !!eg.atlas[id];
  }
  function atlasProgress(eg, milestones) {
    const ids = (milestones || []).map(m => m.id);
    const done = ids.filter(id => eg.atlas[id]).length;
    return { done, total: ids.length };
  }

  /* ---------- Client.txt auto-detect ---------- */
  const isMapArea = ev => !!ev && /^map/i.test(ev.area || "") && !/hideout/i.test(ev.area || "");
  function tierFromLevel(level, offset) {
    const t = Number(level) - (offset || 64);
    return Number.isFinite(t) && t >= 1 && t <= 20 ? t : null;
  }

  /**
   * Feed a zone event. Entering a map starts a run (or resumes the same one);
   * leaving to a non-map area pauses it; entering a different map finishes the
   * previous run first. Returns what happened, for a toast.
   */
  function onZone(eg, ev, now, opts) {
    if (!ev || (!ev.area && !ev.name)) return { action: "ignore" };
    const a = eg.active;
    if (isMapArea(ev)) {
      if (a && a.area && a.area === ev.area) return resumeMap(eg, now) ? { action: "resume" } : { action: "ignore" };
      let finished = null;
      if (a && a.auto) finished = finishMap(eg, { completed: true }, now);
      else if (a) return { action: "ignore", reason: "manual run open" };
      const run = startMap(eg, {
        map: ev.name || ev.area, area: ev.area, auto: true,
        tier: tierFromLevel(ev.level, opts && opts.tierOffset),
      }, now);
      return { action: "start", run, finished };
    }
    if (a && a.auto && isRunning(eg)) { pauseMap(eg, now); return { action: "pause" }; }
    return { action: "ignore" };
  }

  function toCSV(eg, charName) {
    const cell = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = ["run_id", "character", "map", "tier", "started", "time_s", "completed", "deaths", "mods", "loot", "notes", "session"];
    const rows = eg.runs.slice().reverse().map(r => [r.id, charName, r.map, r.tier, r.started, (r.ms / 1000).toFixed(1),
      r.completed, r.deaths, r.mods, r.loot, r.notes, r.sessionId]);
    return [head, ...rows].map(r => r.map(cell).join(",")).join("\n") + "\n";
  }

  const Endgame = {
    blank, normalise, normaliseRun, parseLegacyName, fromLegacyMapHistory,
    currentSession, startSession, endSession,
    activeMs, isRunning, startMap, pauseMap, resumeMap, addDeath, updateActive, finishMap, discardMap,
    stats, sessionStats, perMap, toggleMilestone, atlasProgress,
    isMapArea, tierFromLevel, onZone, toCSV,
  };
  global.Endgame = Endgame;
  if (typeof module !== "undefined" && module.exports) module.exports = Endgame;
})(typeof window !== "undefined" ? window : globalThis);
