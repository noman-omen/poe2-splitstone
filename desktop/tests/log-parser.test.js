"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { Parser, parseLevelUp } = require("../src/log-parser");
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

describe("level-up lines", () => {
  const LVL = (rest) => `2026/10/15 05:41:12 81234567 cffb0734 [INFO Client 1234] : ${rest}`;

  it("reads the game's own level-up notice", () => {
    assert.deepEqual(parseLevelUp(LVL("Ember_Witch (Witch) is now level 12")), { name: "Ember_Witch", cls: "Witch", level: 12 });
    assert.deepEqual(parseLevelUp(LVL("Stoneface (Titan) is now level 100") + "\r"), { name: "Stoneface", cls: "Titan", level: 100 });
    for (const asc of ["Smith of Kitava", "Acolyte of Chayula", "Disciple of Varashta", "Gemling Legionnaire", "Blood Mage", "Spirit Walker", "Martial Artist"])
      assert.deepEqual(parseLevelUp(LVL(`Runner (${asc}) is now level 41`)), { name: "Runner", cls: asc, level: 41 }, asc);
    const events = [];
    const p = new Parser((e) => events.push(e));
    p.feed(LVL("Runner (Monk) is now level 2"), 0);
    assert.deepEqual(events, [{ type: "level", name: "Runner", cls: "Monk", level: 2 }]);
  });

  it("rejects chat, whispers and lookalikes", () => {
    const bad = [
      "2026/10/15 05:41:12 81234567 cffb0734 [INFO Client 1234] Someone: Runner (Monk) is now level 99",
      "2026/10/15 05:41:12 81234567 cffb0734 [INFO Client 1234] #Someone: : Runner (Monk) is now level 99",
      "2026/10/15 05:41:12 81234567 cffb0734 [INFO Client 1234] @From Someone: Runner (Monk) is now level 99",
      "2026/10/15 05:41:12 81234567 cffb0734 [INFO Client 1234] %Someone: x] : Runner (Monk) is now level 99",
      "2026/10/15 05:41:12 81234567 cffb0734 [DEBUG Client 1234] : Runner (Monk) is now level 9",
      LVL("Runner (Monk) is now level 101"),
      LVL("Runner (Monk) is now level 0"),
      LVL("Runner (Monk) is now level 12 and more"),
      LVL("Runner (Monk) is now level 1x"),
      LVL("Ru (Monk) is now level 5"),
      LVL("Runner Two (Monk) is now level 5"),
      LVL("Runner (Monk 2) is now level 5"),
      LVL("Runner (Smith  of Kitava) is now level 5"),
      LVL("Runner (Smith of Kitava ) is now level 5"),
      LVL("Runner (A B C D E) is now level 5"),
      LVL("<b>Runner</b> (Monk) is now level 5"),
      "junk : Runner (Monk) is now level 5",
      "",
    ];
    for (const line of bad) assert.equal(parseLevelUp(line), null, line);
    const events = [];
    const p = new Parser((e) => events.push(e));
    bad.forEach((l) => p.feed(l, 0));
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
      showTip: true,
      evil: "nope",
      settings: { url: "http://evil" },
      hotkeys: { split: " ", pause: "p", undo: "u", extra: "x" },
    });
    assert.equal(st.zone, "Clearfell");
    assert.equal(st.zoneMs, 1200);
    assert.equal(st.tip, undefined, "hints never reach the overlay");
    assert.equal(st.showTip, undefined);
    assert.equal(st.evil, undefined);
    assert.equal(st.settings, undefined);
    assert.deepEqual(Object.keys(st.hotkeys).sort(), ["pause", "split", "undo"]);
  });

  it("linesForPanel builds minimal rows (step / next only)", () => {
    const rows = linesForPanel(normalise({
      step: "Do the thing", tip: "A tip", nextStep: "Next thing", showTip: true,
      zone: "Z", zoneMs: 999, runMs: 999, deltaMs: 5, paused: true,
    }));
    assert.ok(rows.some((r) => r[0] === "step" && r[1].includes("Do the thing")));
    assert.ok(!rows.some((r) => r[0] === "tip"));
    assert.ok(rows.some((r) => r[0] === "next" && r[1].includes("Next")));
    assert.ok(!rows.some((r) => r[0] === "zone"));
    assert.ok(!rows.some((r) => r[0] === "status"));
    assert.ok(!rows.some((r) => r[0] === "delta" || r[0] === "seg" || r[0] === "run"));
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
  it("rejects bare keys; accepts modifier combos", () => {
    assert.equal(toAccelerator(" "), null);
    assert.equal(toAccelerator("p"), null);
    assert.equal(toAccelerator("Space"), null);
    assert.equal(toAccelerator("F5"), null); // bare F-key still needs a modifier for globals
    assert.equal(toAccelerator("Ctrl+Alt+S"), "Ctrl+Alt+S");
    assert.equal(toAccelerator("Ctrl+Alt+O"), "Ctrl+Alt+O");
  });
});
