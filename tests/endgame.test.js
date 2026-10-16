"use strict";
const test = require("node:test");
const assert = require("node:assert");
const E = require("../js/endgame.js");
const ENDGAME = require("../data/endgame.js");
const TOOLS = require("../data/tools.js");

const T0 = Date.parse("2026-10-16T18:00:00Z");
const min = n => n * 60000;

test("start, pause, resume and finish a map", () => {
  const eg = E.blank();
  E.startMap(eg, { map: "Burial Bog", tier: "7", mods: "  +rare packs " }, T0);
  assert.ok(E.currentSession(eg), "starting a map opens a session");
  assert.throws(() => E.startMap(eg, { map: "Other" }, T0), /Finish the current map/);
  E.pauseMap(eg, T0 + min(3));
  assert.strictEqual(E.activeMs(eg, T0 + min(10)), min(3), "paused time does not count");
  E.resumeMap(eg, T0 + min(10));
  E.addDeath(eg); E.addDeath(eg);
  E.updateActive(eg, { loot: "Divine Orb", notes: "rippy boss" });
  const run = E.finishMap(eg, { completed: true }, T0 + min(12));
  assert.strictEqual(run.ms, min(5));
  assert.deepStrictEqual([run.map, run.tier, run.mods, run.deaths, run.loot, run.completed], ["Burial Bog", 7, "+rare packs", 2, "Divine Orb", true]);
  assert.strictEqual(eg.active, null);
  assert.strictEqual(eg.runs.length, 1);
});

test("stats and maps per hour use session wall time", () => {
  const eg = E.blank();
  E.startSession(eg, T0);
  [[4, true], [6, true], [5, false]].forEach(([m, ok], i) => {
    const start = T0 + min(i * 10);
    E.startMap(eg, { map: i ? "Savannah" : "Burial Bog" }, start);
    E.finishMap(eg, { completed: ok }, start + min(m));
  });
  const s = E.sessionStats(eg, eg.sessionId, T0 + min(60));
  assert.strictEqual(s.maps, 3);
  assert.strictEqual(s.completed, 2);
  assert.strictEqual(s.avgMs, min(5), "average counts completed maps only");
  assert.strictEqual(s.totalMs, min(15));
  assert.strictEqual(s.mapsPerHour, 2, "2 completed maps in 1 hour of session");
  E.endSession(eg, T0 + min(60));
  assert.strictEqual(eg.sessionId, null);
  assert.ok(eg.sessions[0].ended);
});

test("per-map PBs ignore failed runs", () => {
  const runs = [{ map: "Bog", ms: 100, completed: false }, { map: "bog", ms: 300, completed: true }, { map: "Bog", ms: 200, completed: true }]
    .map(E.normaliseRun);
  const pm = E.perMap(runs);
  assert.strictEqual(pm.bog.pb, 200);
  assert.strictEqual(pm.bog.runs, 2);
});

test("legacy mapHistory migrates to endgame runs", () => {
  const eg = E.fromLegacyMapHistory([
    { id: "a1", name: "Burial Bog (T5)", ms: 210000, finished: "2026-10-01T12:03:30.000Z" },
    { id: "a2", name: "Savannah", ms: 185000, finished: "2026-10-01T11:00:00.000Z" },
  ]);
  assert.strictEqual(eg.runs.length, 2);
  assert.deepStrictEqual([eg.runs[0].id, eg.runs[0].map, eg.runs[0].tier, eg.runs[0].ms, eg.runs[0].completed],
    ["a1", "Burial Bog", 5, 210000, true]);
  assert.strictEqual(eg.runs[0].started, "2026-10-01T12:00:00.000Z");
  assert.strictEqual(eg.runs[1].tier, null);
});

test("normalise rejects junk and clamps fields", () => {
  const eg = E.normalise({ runs: [{ map: "x".repeat(200), tier: 99, deaths: -3, ms: "nope" }, null], sessionId: "missing", atlas: { ok: "2026-01-01", bad: 5 } });
  assert.strictEqual(eg.runs.length, 2);
  assert.strictEqual(eg.runs[0].map.length, 80);
  assert.strictEqual(eg.runs[0].tier, 20);
  assert.strictEqual(eg.runs[0].deaths, 0);
  assert.strictEqual(eg.runs[0].ms, 0);
  assert.strictEqual(eg.sessionId, null);
  assert.deepStrictEqual(Object.keys(eg.atlas), ["ok"]);
  assert.deepStrictEqual(E.normalise(null), E.blank());
});

test("Client.txt auto-detect starts, pauses, resumes and rolls over maps", () => {
  const eg = E.blank();
  let r = E.onZone(eg, { area: "MapBurialBog", name: "Burial Bog", level: 70 }, T0, { tierOffset: 64 });
  assert.strictEqual(r.action, "start");
  assert.strictEqual(eg.active.tier, 6);
  r = E.onZone(eg, { area: "HideoutFelled", name: "Felled Hideout" }, T0 + min(4));
  assert.strictEqual(r.action, "pause");
  r = E.onZone(eg, { area: "MapBurialBog", name: "Burial Bog", level: 70 }, T0 + min(6));
  assert.strictEqual(r.action, "resume");
  r = E.onZone(eg, { area: "MapSavannah", name: "Savannah", level: 75 }, T0 + min(7));
  assert.strictEqual(r.action, "start");
  assert.strictEqual(r.finished.ms, min(5), "4 min + 1 min after re-entry");
  assert.strictEqual(eg.active.map, "Savannah");
  assert.strictEqual(eg.active.tier, 11);
});

test("auto-detect never overrides a manual run", () => {
  const eg = E.blank();
  E.startMap(eg, { map: "Manual" }, T0);
  const r = E.onZone(eg, { area: "MapSavannah", name: "Savannah" }, T0 + 1000);
  assert.strictEqual(r.action, "ignore");
  assert.strictEqual(eg.active.map, "Manual");
});

test("atlas checklist toggles and counts", () => {
  const eg = E.blank();
  assert.ok(E.toggleMilestone(eg, "first-map", T0));
  assert.deepStrictEqual(E.atlasProgress(eg, ENDGAME.milestones), { done: 1, total: ENDGAME.milestones.length });
  assert.ok(!E.toggleMilestone(eg, "first-map", T0));
});

test("CSV escapes fields", () => {
  const eg = E.blank();
  E.startMap(eg, { map: 'Bog, "deep"' }, T0);
  E.finishMap(eg, {}, T0 + 1000);
  const lines = E.toCSV(eg, "Char").trim().split("\n");
  assert.ok(lines[0].startsWith("run_id,character,map,tier"));
  assert.ok(lines[1].includes('"Bog, ""deep"""'));
});

test("endgame data is well formed", () => {
  const ids = new Set();
  const groups = new Set(ENDGAME.groups.map(g => g.id));
  for (const m of ENDGAME.milestones) {
    assert.ok(!ids.has(m.id), "duplicate id " + m.id); ids.add(m.id);
    assert.ok(groups.has(m.group), "unknown group " + m.group);
    assert.strictEqual(typeof m.verified, "boolean");
  }
});

test("tools are https with a description", () => {
  assert.ok(TOOLS.length >= 6);
  for (const t of TOOLS) {
    assert.strictEqual(new URL(t.url).protocol, "https:", t.url);
    assert.ok(t.name && t.desc);
  }
});
