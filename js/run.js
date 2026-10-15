/* run.js: speedrun logic on top of the plain zone timers.
 *
 * A "run" is one pass through the route. Zones are the atomic segments:
 *  - the route variant (normal / fast, optionally "required steps only")
 *    decides which steps are visible, and a zone with no visible step is
 *    not part of the run at all;
 *  - the current zone is the first active zone (route order) not yet split;
 *  - split() closes the current zone and starts the next zone's timer;
 *  - act / interlude-part / interlude totals are sums of their zones;
 *  - finish() stores the run in history, tagged with its variant. PB, best
 *    segments ("golds") and sum of best are kept per variant, because a fast
 *    run is not comparable with a full clear.
 * Everything here is DOM-free. */
(function (global) {
  "use strict";

  const DATA = global.CAMPAIGN_DATA;
  const T = global.Timers;

  // Every zone in route order: [{ zone, section, group }]
  const ALL = [];
  DATA.sections.forEach(section => section.zones.forEach(zone => ALL.push({ zone, section, group: section.group })));
  const BY_ZONE = Object.fromEntries(ALL.map(o => [o.zone.id, o]));
  const zoneKey = id => "zone:" + id;

  /* ---------- Route variants ---------- */
  const DEFAULT_ROUTE = { mode: "normal", requiredOnly: false };
  const route = c => Object.assign({}, DEFAULT_ROUTE, c.route);
  const variantKey = r => r.mode + (r.requiredOnly ? "+req" : "");
  const variantLabel = key => {
    const [mode, req] = key.split("+");
    return ((DATA.variants[mode] && DATA.variants[mode].label) || mode) + (req ? " · required only" : "");
  };
  const stepVisible = (s, r) => s.modes.includes(r.mode) && !(r.requiredOnly && s.optional);
  const zoneActive = (z, r) => z.steps.some(s => stepVisible(s, r));
  const requiredSteps = (zone, r = DEFAULT_ROUTE) => zone.steps.filter(s => stepVisible(s, r) && !s.optional);

  const orderCache = new Map();
  /** Active zones for the character's variant, each with its index in the run. */
  function order(c) {
    const key = variantKey(route(c));
    if (!orderCache.has(key)) {
      const r = route(c);
      orderCache.set(key, ALL.filter(o => zoneActive(o.zone, r)).map((o, index) => Object.assign({ index }, o)));
    }
    return orderCache.get(key);
  }
  const inOrder = (c, zid) => order(c).find(o => o.zone.id === zid);
  const bestsFor = (c, variant = variantKey(route(c))) => (c.bests[variant] || (c.bests[variant] = {}));

  /* ---------- Times ---------- */
  const zoneMs = (c, zid, now) => T.value(c, zoneKey(zid), now);
  const sectionMs = (c, sid, now) => DATA.sections.find(s => s.id === sid).zones
    .reduce((a, z) => a + zoneMs(c, z.id, now), 0);
  const groupMs = (c, gid, now) => DATA.sections.filter(s => s.group === gid)
    .reduce((a, s) => a + sectionMs(c, s.id, now), 0);
  const totalMs = (c, now) => ALL.reduce((a, o) => a + zoneMs(c, o.zone.id, now), 0);

  function runningZone(c) {
    const o = ALL.find(o => T.isRunning(c, zoneKey(o.zone.id)));
    return o ? o.zone.id : null;
  }
  /** The zone the player is in: the running one, else the first unsplit active one. */
  function current(c) {
    const r = runningZone(c);
    if (r) return inOrder(c, r) || Object.assign({ index: -1 }, BY_ZONE[r]);
    return order(c).find(o => !c.split[o.zone.id]) || null;
  }
  const isStarted = c => ALL.some(o => zoneMs(c, o.zone.id) > 0 || c.split[o.zone.id]);
  const isPaused = c => !!(c.paused && c.paused.length);
  const isFinished = c => order(c).every(o => c.split[o.zone.id]);

  /** Start (or resume) a zone; only one zone timer runs at a time. */
  function startZone(c, zid) {
    ALL.forEach(o => { if (o.zone.id !== zid) T.stop(c, zoneKey(o.zone.id)); });
    T.start(c, zoneKey(zid));
    c.paused = null;
    if (!c.runStarted) c.runStarted = new Date().toISOString();
  }
  function stopAllZones(c) { ALL.forEach(o => T.stop(c, zoneKey(o.zone.id))); }

  /** Update best-ever segments when a zone (and maybe its section/group) closes. */
  function updateBests(c, o, entry) {
    const bests = bestsFor(c), act = order(c);
    const set = (key, ms) => {
      if (ms <= 0) return;
      entry.prevBests[key] = bests[key];
      if (bests[key] === undefined || ms < bests[key]) {
        bests[key] = ms;
        if (key.startsWith("zone:")) { c.golds[o.zone.id] = true; entry.golds.push(o.zone.id); }
      }
    };
    set(zoneKey(o.zone.id), zoneMs(c, o.zone.id));
    const done = zones => zones.every(z => !act.some(a => a.zone.id === z.id) || c.split[z.id]);
    if (done(o.section.zones)) set("section:" + o.section.id, sectionMs(c, o.section.id));
    if (DATA.sections.filter(s => s.group === o.group).every(s => done(s.zones)))
      set("group:" + o.group, groupMs(c, o.group));
  }

  /**
   * Split: close the current zone (ticking its required steps) and start the
   * next one. `opts.to` (auto-splitter) closes every zone up to, but not
   * including, that zone and starts it. Returns "split" | "finished" | null.
   */
  function split(c, opts = {}) {
    const o = current(c);
    if (!o) return null;
    const zid = o.zone.id, r = route(c);
    const wasRunning = T.isRunning(c, zoneKey(zid));
    const entry = { zone: zid, autoMarked: [], prevBests: {}, golds: [], wasRunning, extra: [] };
    requiredSteps(o.zone, r).forEach(s => { if (!c.done[s.id]) { c.done[s.id] = true; entry.autoMarked.push(s.id); } });
    T.stop(c, zoneKey(zid));
    c.split[zid] = Date.now();
    updateBests(c, o, entry);
    let next = order(c)[o.index + 1];
    // Auto-splitter skipped ahead (missed a zone): close the zones in between with 0 time.
    if (opts.to) {
      const target = inOrder(c, opts.to);
      while (next && target && next.index < target.index) {
        c.split[next.zone.id] = Date.now();
        entry.extra.push(next.zone.id);
        next = order(c)[next.index + 1];
      }
    }
    c.undo.push(entry);
    if (c.undo.length > 300) c.undo.shift();
    if (next && (wasRunning || opts.start)) startZone(c, next.zone.id);
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
    (e.extra || []).forEach(z => delete c.split[z]);
    e.autoMarked.forEach(id => delete c.done[id]);
    const bests = bestsFor(c);
    Object.entries(e.prevBests).forEach(([k, v]) => { if (v === undefined) delete bests[k]; else bests[k] = v; });
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
    const running = Object.keys(c.timers).filter(k => k.startsWith("zone:") && T.isRunning(c, k));
    if (!running.length) return null;
    running.forEach(k => T.stop(c, k));
    c.paused = running;
    return "paused";
  }

  /** Snapshot every segment of the current run. */
  function snapshot(c) {
    const zones = {}, sections = {}, groups = {};
    ALL.forEach(o => { const ms = zoneMs(c, o.zone.id); if (ms) zones[o.zone.id] = ms; });
    DATA.sections.forEach(s => { const ms = sectionMs(c, s.id); if (ms) sections[s.id] = ms; });
    DATA.groups.forEach(g => { const ms = groupMs(c, g.id); if (ms) groups[g.id] = ms; });
    return { zones, sections, groups, total: totalMs(c) };
  }

  /** Store the current run in history. complete=false records an abandoned attempt. */
  function finish(c, complete) {
    stopAllZones(c);
    const snap = snapshot(c);
    if (!snap.total) return null;
    const variant = variantKey(route(c));
    const rec = Object.assign({ id: Math.random().toString(36).slice(2, 10), complete: !!complete, variant,
      started: c.runStarted, finished: new Date().toISOString(),
      splitsDone: order(c).filter(o => c.split[o.zone.id]).length, zonesTotal: order(c).length }, snap);
    const bests = bestsFor(c, variant);
    if (rec.complete && (bests.total === undefined || rec.total < bests.total)) bests.total = rec.total;
    c.history.unshift(rec);
    c.finishedId = rec.id;
    return rec;
  }

  /** Reset progress for a new attempt; history, bests, maps and build stay. */
  function newRun(c) {
    stopAllZones(c);
    ALL.forEach(o => T.reset(c, zoneKey(o.zone.id)));
    Object.assign(c, { done: {}, split: {}, undo: [], golds: {}, paused: null, runStarted: null, finishedId: null });
  }

  const runsOf = (c, variant = variantKey(route(c))) => c.history.filter(h => (h.variant || "normal") === variant);
  /** Fastest complete run of the variant (the PB), or null. */
  const pb = (c, variant) => runsOf(c, variant).filter(h => h.complete)
    .reduce((best, h) => (!best || h.total < best.total ? h : best), null);

  /** Sum of best zone segments for the active variant; null until every zone has one. */
  function sumOfBest(c) {
    const bests = bestsFor(c);
    let sum = 0;
    for (const o of order(c)) {
      const b = bests[zoneKey(o.zone.id)];
      if (b === undefined) return null;
      sum += b;
    }
    return sum;
  }

  /**
   * Comparison vs PB at the current point of the run: cumulative time through
   * the split zones (+ the live zone once it is slower than PB's segment) vs
   * the PB's time for the same zones. Positive = behind PB.
   * Optional `pred(o)` limits the comparison to a group/section (sidebar Δ).
   */
  function deltaVsPbIn(c, pred, now = Date.now()) {
    const p = pb(c);
    if (!p) return null;
    let mine = 0, theirs = 0, any = false;
    for (const o of order(c)) {
      if (pred && !pred(o)) continue;
      const zid = o.zone.id, live = T.isRunning(c, zoneKey(zid));
      if ((!c.split[zid] && !live) || p.zones[zid] === undefined) continue;
      const ms = zoneMs(c, zid, now);
      if (!c.split[zid] && ms <= p.zones[zid]) continue;
      mine += ms; theirs += p.zones[zid]; any = true;
    }
    return any ? mine - theirs : null;
  }
  const deltaVsPb = (c, now) => deltaVsPbIn(c, null, now);

  /** Migrate older saves: drop stale timers; move flat bests under the "normal" variant. */
  function prune(c) {
    Object.keys(c.timers).forEach(k => {
      if (k.startsWith("section:") || (k.startsWith("zone:") && !BY_ZONE[k.slice(5)])) delete c.timers[k];
    });
    Object.keys(c.split).forEach(z => { if (!BY_ZONE[z]) delete c.split[z]; });
    if (Object.keys(c.bests).some(k => k.includes(":") || k === "total")) c.bests = { normal: c.bests };
    c.route = route(c);
  }

  global.Run = { ALL, BY_ZONE, order, inOrder, route, variantKey, variantLabel, stepVisible, zoneActive,
    bestsFor, current, runningZone, isStarted, isPaused, isFinished, startZone, stopAllZones, split,
    undoSplit, togglePause, finish, newRun, runsOf, pb, sumOfBest, deltaVsPb, deltaVsPbIn, zoneMs, sectionMs, groupMs,
    totalMs, requiredSteps, prune };
})(window);
