/* run.js: speedrun logic on top of the plain zone timers.
 *
 * A "run" is one pass through the route. Zones are the atomic segments:
 *  - the current zone is the first zone (in route order) not yet split;
 *  - split() closes the current zone and starts the next zone's timer;
 *  - act / interlude-part / interlude totals are the sum of their zones, so
 *    they can never drift from the zone times;
 *  - finish() stores the run in the character's history; PB = fastest
 *    complete run; bests = best time ever per segment ("gold splits"),
 *    which also gives the sum of best segments (SoB).
 * Everything here is DOM-free so it is easy to reason about and test. */
(function (global) {
  "use strict";

  const DATA = global.CAMPAIGN_DATA;
  const T = global.Timers;

  // Flat route order: [{ zone, section, group, index }]
  const ORDER = [];
  DATA.sections.forEach(section => section.zones.forEach(zone =>
    ORDER.push({ zone, section, group: section.group, index: ORDER.length })));
  const BY_ZONE = Object.fromEntries(ORDER.map(o => [o.zone.id, o]));
  const zoneKey = id => "zone:" + id;
  const requiredSteps = zone => zone.steps.filter(s => !s.optional);

  const zoneMs = (c, zid, now) => T.value(c, zoneKey(zid), now);
  const sectionMs = (c, sid, now) => DATA.sections.find(s => s.id === sid).zones
    .reduce((a, z) => a + zoneMs(c, z.id, now), 0);
  const groupMs = (c, gid, now) => DATA.sections.filter(s => s.group === gid)
    .reduce((a, s) => a + sectionMs(c, s.id, now), 0);
  const totalMs = (c, now) => ORDER.reduce((a, o) => a + zoneMs(c, o.zone.id, now), 0);

  function runningZone(c) {
    const o = ORDER.find(o => T.isRunning(c, zoneKey(o.zone.id)));
    return o ? o.zone.id : null;
  }
  /** The zone the player is in: the running one, else the first unsplit one. */
  function current(c) {
    const r = runningZone(c);
    if (r) return BY_ZONE[r];
    return ORDER.find(o => !c.split[o.zone.id]) || null;
  }
  const isStarted = c => ORDER.some(o => zoneMs(c, o.zone.id) > 0 || c.split[o.zone.id]);
  const isPaused = c => !!(c.paused && c.paused.length);
  const isFinished = c => ORDER.every(o => c.split[o.zone.id]);

  /** Start (or resume) a zone; only one zone timer runs at a time. */
  function startZone(c, zid) {
    ORDER.forEach(o => { if (o.zone.id !== zid) T.stop(c, zoneKey(o.zone.id)); });
    T.start(c, zoneKey(zid));
    c.paused = null;
    if (!c.runStarted) c.runStarted = new Date().toISOString();
  }

  function stopAllZones(c) { ORDER.forEach(o => T.stop(c, zoneKey(o.zone.id))); }

  /** Update best-ever segments when a zone (and maybe its section/group) closes. */
  function updateBests(c, o, entry) {
    const set = (key, ms) => {
      if (ms <= 0) return;
      entry.prevBests[key] = c.bests[key];
      if (c.bests[key] === undefined || ms < c.bests[key]) {
        c.bests[key] = ms;
        if (key.startsWith("zone:")) { c.golds[o.zone.id] = true; entry.golds.push(o.zone.id); }
      }
    };
    set(zoneKey(o.zone.id), zoneMs(c, o.zone.id));
    if (o.section.zones.every(z => c.split[z.id]))
      set("section:" + o.section.id, sectionMs(c, o.section.id));
    const groupSections = DATA.sections.filter(s => s.group === o.group);
    if (groupSections.every(s => s.zones.every(z => c.split[z.id])))
      set("group:" + o.group, groupMs(c, o.group));
  }

  /**
   * Split: close the current zone (ticking its required steps) and start the
   * next one. Returns "split" | "finished" | null.
   */
  function split(c) {
    const o = current(c);
    if (!o) return null;
    const zid = o.zone.id;
    const entry = { zone: zid, autoMarked: [], prevBests: {}, golds: [], wasRunning: T.isRunning(c, zoneKey(zid)) };
    requiredSteps(o.zone).forEach(s => { if (!c.done[s.id]) { c.done[s.id] = true; entry.autoMarked.push(s.id); } });
    T.stop(c, zoneKey(zid));
    c.split[zid] = Date.now();
    updateBests(c, o, entry);
    c.undo.push(entry);
    if (c.undo.length > 200) c.undo.shift();
    const next = ORDER[o.index + 1];
    // Auto-advance only when the run is live (the zone was being timed).
    if (next && entry.wasRunning) startZone(c, next.zone.id);
    if (!next || isFinished(c)) { finish(c, true); return "finished"; }
    return "split";
  }

  /** Revert the most recent split (restores steps, bests and the timer). */
  function undoSplit(c) {
    const e = c.undo.pop();
    if (!e) return false;
    if (c.finishedId) { // the split finished the run: drop that history entry again
      c.history = c.history.filter(h => h.id !== c.finishedId);
      c.finishedId = null;
    }
    delete c.split[e.zone];
    e.autoMarked.forEach(id => delete c.done[id]);
    Object.entries(e.prevBests).forEach(([k, v]) => { if (v === undefined) delete c.bests[k]; else c.bests[k] = v; });
    e.golds.forEach(z => delete c.golds[z]);
    if (e.wasRunning) startZone(c, e.zone); else stopAllZones(c);
    return true;
  }

  /** Pause stops every running timer and remembers which; resume restarts them. */
  function togglePause(c) {
    if (isPaused(c)) {
      const keys = c.paused; c.paused = null;
      keys.forEach(k => T.start(c, k));
      return "resumed";
    }
    const running = Object.keys(c.timers).filter(k => T.isRunning(c, k));
    if (!running.length) return null;
    running.forEach(k => T.stop(c, k));
    c.paused = running;
    return "paused";
  }

  /** Snapshot every segment of the current run. */
  function snapshot(c) {
    const zones = {}, sections = {}, groups = {};
    ORDER.forEach(o => { const ms = zoneMs(c, o.zone.id); if (ms) zones[o.zone.id] = ms; });
    DATA.sections.forEach(s => { const ms = sectionMs(c, s.id); if (ms) sections[s.id] = ms; });
    DATA.groups.forEach(g => { const ms = groupMs(c, g.id); if (ms) groups[g.id] = ms; });
    return { zones, sections, groups, total: totalMs(c) };
  }

  /** Store the current run in history. complete=false records an abandoned attempt. */
  function finish(c, complete) {
    stopAllZones(c);
    const snap = snapshot(c);
    if (!snap.total) return null;
    const prevPb = pb(c);
    const rec = Object.assign({ id: Math.random().toString(36).slice(2, 10), complete: !!complete,
      started: c.runStarted, finished: new Date().toISOString(),
      splitsDone: ORDER.filter(o => c.split[o.zone.id]).length, zonesTotal: ORDER.length }, snap);
    rec.pb = rec.complete && (!prevPb || rec.total < prevPb.total);
    if (rec.complete && (c.bests.total === undefined || rec.total < c.bests.total)) c.bests.total = rec.total;
    c.history.unshift(rec);
    c.finishedId = rec.id;
    return rec;
  }

  /** Reset progress for a new attempt; history, bests, maps and build stay. */
  function newRun(c) {
    stopAllZones(c);
    ORDER.forEach(o => T.reset(c, zoneKey(o.zone.id)));
    Object.assign(c, { done: {}, split: {}, undo: [], golds: {}, paused: null, runStarted: null, finishedId: null });
  }

  /** Fastest complete run (the PB), or null. */
  function pb(c) {
    return c.history.filter(h => h.complete).reduce((best, h) => (!best || h.total < best.total ? h : best), null);
  }

  /** Sum of best zone segments; null until every zone has a best. */
  function sumOfBest(c) {
    let sum = 0;
    for (const o of ORDER) {
      const b = c.bests[zoneKey(o.zone.id)];
      if (b === undefined) return null;
      sum += b;
    }
    return sum;
  }

  /**
   * Comparison vs PB at the current point of the run:
   * cumulative time through the last split zone (+ the running zone) vs the
   * PB's cumulative time through the same zones. Positive = behind PB.
   */
  function deltaVsPb(c, now = Date.now()) {
    const p = pb(c);
    if (!p) return null;
    let mine = 0, theirs = 0, any = false;
    for (const o of ORDER) {
      const zid = o.zone.id;
      if (!c.split[zid] && !T.isRunning(c, zoneKey(zid))) continue;
      if (p.zones[zid] === undefined) continue;
      if (!c.split[zid]) {
        // Live zone: only count it once we are already slower than PB's segment,
        // otherwise the delta would jump around while you play (LiveSplit-style).
        const ms = zoneMs(c, zid, now);
        if (ms <= p.zones[zid]) continue;
        mine += ms; theirs += p.zones[zid]; any = true; continue;
      }
      mine += zoneMs(c, zid, now); theirs += p.zones[zid]; any = true;
    }
    return any ? mine - theirs : null;
  }

  /** Remove timers left over from older data layouts (e.g. section:*, old interlude zone ids). */
  function prune(c) {
    Object.keys(c.timers).forEach(k => {
      if (k.startsWith("section:") || (k.startsWith("zone:") && !BY_ZONE[k.slice(5)])) delete c.timers[k];
    });
    Object.keys(c.split).forEach(z => { if (!BY_ZONE[z]) delete c.split[z]; });
  }

  global.Run = { ORDER, BY_ZONE, current, runningZone, isStarted, isPaused, isFinished, startZone,
    stopAllZones, split, undoSplit, togglePause, finish, newRun, pb, sumOfBest, deltaVsPb,
    zoneMs, sectionMs, groupMs, totalMs, requiredSteps, prune };
})(window);
