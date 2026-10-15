"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { Parser } = require("../src/log-parser");
const { normalise, linesForPanel, formatMs } = require("../src/overlay-state");
const { isClientTxtPath, findClientLog } = require("../src/client-log");
const { toAccelerator } = require("../src/hotkeys");

const GEN = (lvl, area) =>
  `2026/10/15 05:40:01 1234 abc [DEBUG Client 1234] Generating level ${lvl} area "${area}" with seed 1`;
const ENT = (name) =>
  `2026/10/15 05:40:03 1234 abc [INFO Client 1234] : You have entered ${name}.`;

describe("Parser", () => {
  it("pairs generating + entered", () => {
    const events = [];
    const p = new Parser((e) => events.push(e));
    p.feed(GEN(2, "G1_2"), 0);
    p.feed(ENT("Clearfell"), 1);
    assert.deepEqual(events, [{ type: "zone", area: "g1_2", name: "Clearfell", level: 2 }]);
  });

  it("entered-only emits name without area", () => {
    const events = [];
    const p = new Parser((e) => events.push(e));
    p.feed(ENT("The Riverbank"), 0);
    assert.equal(events[0].name, "The Riverbank");
    assert.equal(events[0].area, null);
  });

  it("generating-only flushes after window", () => {
    const events = [];
    const p = new Parser((e) => events.push(e));
    p.feed(GEN(5, "G1_5"), 0);
    p.flush(1);
    assert.equal(events.length, 0);
    p.flush(10);
    assert.equal(events[0].area, "g1_5");
    assert.equal(events[0].name, null);
  });

  it("ignores chat noise", () => {
    const events = [];
    const p = new Parser((e) => events.push(e));
    p.feed("2026/10/15 05:40:03 1 a [INFO Client 1] @From Foo: hi", 0);
    p.feed("2026/10/15 05:40:03 1 a [INFO Client 1] : AFK mode is now ON.", 0);
    assert.equal(events.length, 0);
  });
});

describe("overlay-state", () => {
  it("normalise allowlists fields", () => {
    const st = normalise({
      zone: "Clearfell",
      zoneMs: 1200,
      deltaMs: -500,
      tip: "x".repeat(200),
      evil: "nope",
      settings: { url: "http://evil" },
      hotkeys: { split: " ", pause: "p", undo: "u", extra: "x" },
    });
    assert.equal(st.zone, "Clearfell");
    assert.equal(st.zoneMs, 1200);
    assert.ok(st.tip.length <= 100);
    assert.equal(st.evil, undefined);
    assert.equal(st.settings, undefined);
    assert.deepEqual(Object.keys(st.hotkeys).sort(), ["pause", "split", "undo"]);
  });

  it("linesForPanel builds rows", () => {
    const rows = linesForPanel(normalise({ zone: "Z", step: "S", zoneMs: 0, runMs: 0, paused: true }));
    assert.ok(rows.some((r) => r[0] === "zone"));
    assert.ok(rows.some((r) => r[0] === "status" && r[1] === "PAUSED"));
  });

  it("formatMs", () => {
    assert.equal(formatMs(0), "0:00");
    assert.equal(formatMs(65000), "1:05");
  });
});

describe("client-log paths", () => {
  it("only allows Client.txt basename", () => {
    assert.equal(isClientTxtPath("C:\\\\foo\\\\Client.txt"), true);
    assert.equal(isClientTxtPath("/tmp/Client.txt"), true);
    assert.equal(isClientTxtPath("/tmp/other.txt"), false);
    assert.equal(isClientTxtPath("/tmp/Client.txt.exe"), false);
  });

  it("findClientLog returns null when missing", () => {
    assert.equal(findClientLog("/no/such/Client.txt"), null);
  });
});

describe("hotkeys", () => {
  it("maps space and letters", () => {
    assert.equal(toAccelerator(" "), "Space");
    assert.equal(toAccelerator("p"), "P");
    assert.equal(toAccelerator("F5"), "F5");
  });
});
