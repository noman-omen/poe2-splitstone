"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../js/ghost.js");

const s = n => n * 1000;
// Three zones in act 1, two in interlude 1.
const ORDER = [["a1", "act1"], ["a2", "act1"], ["a3", "act1"], ["i1", "int1"], ["i2", "int1"]]
  .map(([id, group], index) => ({ index, group, zone: { id, name: id.toUpperCase() } }));
const KNOWN = new Set(ORDER.map(o => o.zone.id));
const GHOST = { id: "g1", name: "PB", zones: { a1: s(60), a2: s(120), a3: s(90), i1: s(30), i2: s(60) }, total: s(360) };
const mineOf = (times, split, live) => ({ ms: z => times[z] || 0, split: z => split.includes(z), live: live || null });

test("per-split and cumulative deltas", () => {
  const m = mineOf({ a1: s(50), a2: s(130), a3: s(40) }, ["a1", "a2"], "a3");
  const r = G.compare(ORDER, m, GHOST);
  assert.deepStrictEqual(r.rows.map(x => [x.zid, x.seg, x.cum]), [["a1", -s(10), -s(10)], ["a2", s(10), 0]]);
  assert.strictEqual(r.live.zid, "a3");
  assert.strictEqual(r.live.cum, 0, "live zone under the ghost's segment doesn't count yet");
  assert.strictEqual(r.cum, 0);
  const late = G.compare(ORDER, mineOf({ a1: s(50), a2: s(130), a3: s(100) }, ["a1", "a2"], "a3"), GHOST);
  assert.strictEqual(late.live.cum, s(10), "slower than the ghost's segment: counts live");
});

test("zones the ghost doesn't have are skipped", () => {
  const g = Object.assign({}, GHOST, { zones: { a1: s(60), a3: s(90) } });
  const r = G.compare(ORDER, mineOf({ a1: s(70), a2: s(999), a3: s(80) }, ["a1", "a2", "a3"]), g);
  assert.deepStrictEqual(r.rows.map(x => x.zid), ["a1", "a3"]);
  assert.strictEqual(r.cum, 0);
});

test("ghost position follows elapsed run time", () => {
  assert.deepStrictEqual(G.position(ORDER, GHOST, 0), { zid: "a1", index: 0, intoMs: 0, zoneMs: s(60) });
  assert.strictEqual(G.position(ORDER, GHOST, s(61)).zid, "a2");
  assert.strictEqual(G.position(ORDER, GHOST, s(275)).zid, "i1");
  assert.strictEqual(G.position(ORDER, GHOST, s(359)).zid, "i2");
  assert.ok(G.position(ORDER, GHOST, s(360)).finished);
  assert.strictEqual(G.position(ORDER, null, 5), null);
});

test("act and interlude summaries", () => {
  const m = mineOf({ a1: s(50), a2: s(110), a3: s(100), i1: s(40) }, ["a1", "a2", "a3", "i1"], "i2");
  const sums = G.groupSummaries(ORDER, m, GHOST);
  assert.deepStrictEqual(sums.map(x => [x.group, x.done, x.delta]), [["act1", true, -s(10)], ["int1", false, s(10)]]);
});

test("resolve picks PB, sum of best, a past run or an imported ghost", () => {
  const pb = { id: "r1", total: s(300), zones: { a1: s(60) }, variant: "normal" };
  const older = { id: "r2", total: s(400), zones: { a1: s(80) }, finished: "2026-10-01T00:00:00.000Z" };
  const ctx = { pb, history: [pb, older], bests: { "zone:a1": s(55), "zone:a2": s(100) }, order: ORDER };
  const st = G.blankState();
  assert.strictEqual(G.resolve(st, ctx).zones.a1, s(60));
  st.pick = "sob";
  assert.deepStrictEqual([G.resolve(st, ctx).total, G.resolve(st, ctx).zones.a2], [s(155), s(100)]);
  st.pick = "run:r2";
  assert.strictEqual(G.resolve(st, ctx).zones.a1, s(80));
  st.pick = "run:gone";
  assert.strictEqual(G.resolve(st, ctx).id, "r1", "deleted run falls back to PB");
  const key = G.addImported(st, G.normaliseGhost({ name: "Friend", zones: { a1: s(45) } }, KNOWN));
  st.pick = key;
  assert.strictEqual(G.resolve(st, ctx).name, "Friend");
  G.removeImported(st, key.slice(4));
  assert.strictEqual(st.pick, "pb");
  assert.strictEqual(G.resolve(G.blankState(), { order: ORDER }), null, "no PB yet");
});

test("imported ghosts are validated and capped", () => {
  const g = G.normaliseGhost({
    name: "<img src=x onerror=alert(1)>\u202e\u0007" + "x".repeat(200), variant: "normal\"><script>",
    zones: { a1: s(60), a2: -5, a3: "90000", nope: s(10), __proto__: 1, i1: Infinity, i2: 1e12 }, total: "abc",
  }, KNOWN);
  assert.deepStrictEqual(Object.keys(g.zones).sort(), ["a1", "a3"]);
  assert.strictEqual(g.total, s(150), "bad total falls back to the zone sum");
  assert.strictEqual(g.variant, "normal");
  assert.ok(g.name.length <= G.MAX_NAME && !/[\u202e\u0007]/.test(g.name));
  assert.throws(() => G.normaliseGhost({ zones: { unknown: 5 } }, KNOWN), /no zone times/);
  assert.throws(() => G.normaliseGhost("x", KNOWN), /Not a ghost/);
  const st = G.normaliseState({ pick: "imp:zzz", imported: Array.from({ length: 30 }, (_, i) => ({ id: "x" + i, zones: { a1: s(1 + i) } })) }, KNOWN);
  assert.strictEqual(st.imported.length, G.MAX_IMPORTED);
  assert.strictEqual(st.pick, "pb", "pick of a missing ghost resets");
  assert.deepStrictEqual(G.normaliseState(null, KNOWN), G.blankState());
  assert.strictEqual(G.normaliseState({ pick: "run:<x>" }, KNOWN).pick, "pb");
});

test("share codes round-trip and reject tampering", async () => {
  const code = await G.encode(GHOST, "Speedy");
  assert.ok(code.startsWith("SSG1."));
  const back = await G.parse(code, { knownZones: KNOWN });
  assert.deepStrictEqual(back.zones, GHOST.zones);
  assert.deepStrictEqual([back.name, back.source, back.total], ["Speedy", "import", s(360)]);
  await assert.rejects(G.parse("SSG1.!!!", { knownZones: KNOWN }), /invalid characters/);
  await assert.rejects(G.parse("SSG1.AAAA", { knownZones: KNOWN }), /damaged/);
  await assert.rejects(G.parse("SSG1." + "A".repeat(G.MAX_CODE_CHARS), { knownZones: KNOWN }), /too large/);
  // A zip-bomb style code: tiny compressed, huge expanded.
  const big = new TextEncoder().encode(JSON.stringify({ app: "splitstone-ghost", v: 1, pad: " ".repeat(G.MAX_INFLATED * 4) }));
  const deflated = new Uint8Array(await new Response(new Blob([big]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const bomb = "SSG1." + Buffer.from(deflated).toString("base64url");
  await assert.rejects(G.parse(bomb, { knownZones: KNOWN }), /size limit/);
});

test("export files: fastest complete campaign run, same route variant preferred", async () => {
  const exp = { app: "splitstone", schema: 2, characters: {
    c1: { name: "Alice", history: [
      { complete: true, total: s(200), variant: "fast", zones: { a1: s(20) } },
      { complete: true, total: s(300), variant: "normal", zones: { a1: s(30) } },
      { complete: true, total: s(100), variant: "normal", practice: { kind: "zone", id: "a1" }, zones: { a1: s(10) } },
      { complete: false, total: s(50), variant: "normal", zones: { a1: s(5) } },
    ] } } };
  const g = await G.parse(JSON.stringify(exp), { knownZones: KNOWN, variant: "normal" });
  // Claimed totals pick the run; the ghost's own total is its zone sum (m4).
  assert.deepStrictEqual([g.name, g.total, g.zones.a1], ["Alice PB", s(30), s(30)]);
  const f = await G.parse(JSON.stringify(exp), { knownZones: KNOWN, variant: "fast" });
  assert.strictEqual(f.zones.a1, s(20));
  await assert.rejects(G.parse(JSON.stringify({ app: "splitstone", characters: {} }), { knownZones: KNOWN }), /no completed/);
  await assert.rejects(G.parse("{\"app\":\"other\"}", { knownZones: KNOWN }), /Not a ghost/);
  await assert.rejects(G.parse("not json", { knownZones: KNOWN }), /Not a ghost/);
  await assert.rejects(G.parse(" ".repeat(10) + "x".repeat(G.MAX_JSON_CHARS + 1), { knownZones: KNOWN }), /too large/);
  await assert.rejects(G.parse("   ", { knownZones: KNOWN }), /Paste/);
});

test("a ghost's total must agree with its zone times", async () => {
  const lie = G.normaliseGhost({ zones: { a1: s(60), a2: s(60) }, total: s(5) }, KNOWN);
  assert.strictEqual(lie.total, s(120), "a too-small claimed total is replaced by the zone sum");
  const ok = G.normaliseGhost({ zones: { a1: s(60), a2: s(60) }, total: s(120) + 400 }, KNOWN);
  assert.strictEqual(ok.total, s(120) + 400, "rounding within a second is kept");
  const code = await G.encode({ name: "x", total: s(1), zones: { a1: s(60) } });
  assert.strictEqual((await G.parse(code, { knownZones: KNOWN })).total, s(60));
});
