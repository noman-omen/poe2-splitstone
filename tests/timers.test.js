"use strict";
const test = require("node:test");
const assert = require("node:assert");
const T = require("../js/timers.js");

test("a clock jump backwards never produces negative time", () => {
  const c = { timers: { "zone:a": { elapsed: 5000, startedAt: 2_000_000 } } };
  assert.strictEqual(T.value(c, "zone:a", 1_000_000), 5000, "now before startedAt: segment keeps its time");
  T.rebase(c, 1_000_000);
  assert.strictEqual(c.timers["zone:a"].startedAt, 1_000_000);
  assert.strictEqual(T.value(c, "zone:a", 1_003_000), 8000, "counts on from the jump");
});

test("a backwards jump between ticks keeps the time already run", () => {
  const c = { timers: { "zone:a": { elapsed: 0, startedAt: 1_000_000 } } };
  assert.strictEqual(T.value(c, "zone:a", 1_030_000), 30000);
  assert.strictEqual(T.rebase(c, 1_030_000 - 3_600_000, 1_030_000), 3_600_000);
  assert.strictEqual(T.value(c, "zone:a", 1_030_000 - 3_600_000), 30000);
  assert.strictEqual(T.value(c, "zone:a", 1_032_000 - 3_600_000), 32000);
});

test("negative or broken elapsed values are clamped", () => {
  const c = { timers: { a: { elapsed: -900, startedAt: null }, b: { elapsed: NaN, startedAt: null } } };
  assert.strictEqual(T.value(c, "a"), 0);
  assert.strictEqual(T.value(c, "b"), 0);
  assert.strictEqual(T.format(-5000), "0:00:00");
  assert.strictEqual(T.format(3_725_000), "1:02:05");
});

test("stop after a backwards jump keeps elapsed time", () => {
  const realNow = Date.now;
  try {
    const c = { timers: {} };
    Date.now = () => 10_000; T.start(c, "z");
    Date.now = () => 4_000; T.stop(c, "z");   // clock moved back 6 s while running
    assert.strictEqual(c.timers.z.elapsed, 0);
    Date.now = () => 4_000; T.start(c, "z");
    Date.now = () => 7_000; T.stop(c, "z");
    assert.strictEqual(c.timers.z.elapsed, 3000);
  } finally { Date.now = realNow; }
});

test("prototype keys never reach Object.prototype (N1)", () => {
  const c = { timers: {} };
  for (const k of ["__proto__", "constructor", "prototype"]) {
    T.start(c, k); T.stop(c, k); T.toggle(c, k); T.reset(c, k);
    assert.equal(T.value(c, k), 0);
    assert.equal(T.isRunning(c, k), false);
  }
  assert.equal(({}).startedAt, undefined);
  assert.equal(Object.keys(c.timers).length, 0);
});
