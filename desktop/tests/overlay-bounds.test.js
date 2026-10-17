"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const B = require("../src/overlay-bounds");
const { merge } = require("../src/desktop-settings");
const { normalise, linesForPanel, STEP_MAX } = require("../src/overlay-state");

const DISPLAYS = [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]];
const wa = (w, h, x = 0) => ({ x, y: 0, width: w, height: h });

describe("overlay placement", () => {
  it("defaults to top centre, below the boss bar band", () => {
    for (const [w, h] of DISPLAYS) {
      for (const pw of [B.defaultSize(wa(w, h)).width, B.LIMITS.maxW]) {
        const b = B.topCenterBounds(wa(w, h), pw, 90);
        assert.ok(Math.abs(b.x + b.width / 2 - w / 2) <= 1, `${w}x${h}: centred (${b.x}+${b.width}/2)`);
        assert.equal(b.y, Math.round(h * B.BOSS_BAR_CLEARANCE));
      }
    }
    assert.ok(Math.abs(B.topCenterBounds(wa(1920, 1080)).y - 120) <= 5, "about 120 px at 1080p");
    const second = B.topCenterBounds(wa(2560, 1440, 1920), 400, 80);
    assert.equal(second.x + 200, 1920 + 1280, "centred on its own display");
  });

  it("a new install and a 1.2 install that never moved it both get top centre", () => {
    assert.equal(merge(null).overlayPosition, "top-center");
    assert.equal(merge({}).overlayPosition, "top-center");
    for (const [w, h] of DISPLAYS) {
      const area = wa(w, h);
      for (const width of [280, 300, 440]) {
        const old = B.topRightBounds(area, width, 72);
        assert.ok(B.isOldDefault(old, area), `${w}x${h} width ${width}: old default recognised`);
      }
      assert.ok(!B.isOldDefault({ x: 40, y: 300, width: 300, height: 72 }, area), "a dragged overlay stays put");
    }
    assert.equal(merge({ overlayBounds: { displayId: "1", x: 10, y: 10, width: 300, height: 72 } }).overlayPosition, null,
      "1.2 bounds are left for main to classify");
    assert.equal(merge({ overlayPosition: "top-right" }).overlayPosition, "top-right");
    assert.equal(merge({ overlayPosition: "<x>" }).overlayPosition, "top-center");
  });

  it("grows downward around its midpoint and stays on screen", () => {
    const area = wa(1920, 1080);
    const b = B.topCenterBounds(area);
    const big = B.centeredResize(b, 612, 420, area);
    assert.equal(big.y, b.y, "top edge stays");
    assert.ok(Math.abs((big.x + big.width / 2) - (b.x + b.width / 2)) <= 1, "midpoint stays");
    const edge = B.centeredResize({ x: 1800, y: 1000, width: 100, height: 60 }, 612, 300, area);
    assert.ok(edge.x + edge.width <= 1920 && edge.y + edge.height <= 1080 && edge.x >= 0, "clamped to the work area");
  });

  it("top right keeps its right edge clear of the minimap", () => {
    for (const [w, h] of DISPLAYS) {
      const area = wa(w, h), b = B.topRightBounds(area);
      const big = B.anchoredResize(b, 612, 200, area);
      assert.equal(big.x + big.width, b.x + b.width);
      assert.ok((w - Math.max(330, Math.round(w * 0.17))) - (big.x + big.width) >= B.MINIMAP_GAP);
    }
  });

  it("default size is small, grows with taller displays and never shrinks below the 1080p box", () => {
    assert.deepEqual(B.defaultSize(wa(1920, 1080)), { width: B.BASE.width, height: B.BASE.height });
    const big = B.defaultSize(wa(2560, 1440));
    assert.ok(big.width > B.BASE.width);
    for (const [w, h] of [[1280, 720], [1366, 768], [1600, 900]])
      assert.deepEqual(B.defaultSize(wa(w, h)), { width: B.BASE.width, height: B.BASE.height }, `${w}x${h}`);
    assert.ok(Math.abs(big.width / big.height - B.BASE.width / B.BASE.height) < 0.05, "same shape");
    assert.ok(B.defaultSize(wa(1920, 1080), "l").width > B.BASE.width);
    assert.deepEqual(B.defaultSize(wa(1920, 1080), "s"), { width: B.BASE.width, height: B.BASE.height }, "old Small is the default");
  });

  it("a player size is kept inside the limits and the screen", () => {
    const area = wa(1920, 1080);
    assert.deepEqual(B.clampSize(null, area), B.defaultSize(area));
    assert.deepEqual(B.clampSize({ width: 1, height: 1 }, area), { width: B.LIMITS.minW, height: B.LIMITS.minH });
    assert.deepEqual(B.clampSize({ width: 9999, height: 9999 }, area), B.maxSize(area));
    assert.ok(B.maxSize(area).width <= B.LIMITS.maxW && B.maxSize(wa(1280, 720)).width <= 1280 * B.LIMITS.maxScreenW);
    assert.deepEqual(B.clampSize({ width: 500.4, height: 90.6 }, area), { width: 500, height: 91 });
  });

  it("custom position resizes from its top-left corner", () => {
    const area = wa(1920, 1080), b = { x: 100, y: 600, width: 400, height: 72 };
    assert.deepEqual(B.resizeFor("custom", b, 700, 140, area), { x: 100, y: 600, width: 700, height: 140 });
    const edge = B.resizeFor("custom", { x: 1700, y: 1000, width: 200, height: 60 }, 700, 140, area);
    assert.ok(edge.x + edge.width <= 1920 && edge.y + edge.height <= 1080);
  });
});

describe("overlay shows the current step and the next step only", () => {
  it("drops hints from the state and the panel rows", () => {
    const st = normalise({ step: "Kill the Devourer", tip: "Hint text", showTip: true, nextStep: "Talk to Renly" });
    assert.ok(!("tip" in st) && !("showTip" in st));
    const rows = linesForPanel({ ...st, tip: "Hint text", showTip: true });
    assert.deepEqual(rows.map(r => r[0]), ["step", "next"]);
    assert.ok(!JSON.stringify(rows).includes("Hint text"));
  });

  it("keeps long steps whole", () => {
    const st = normalise({ step: "S".repeat(300), nextStep: "N".repeat(300) });
    assert.equal(st.step.length, 300);
    assert.equal(st.nextStep.length, 300);
  });

  it("every route step fits the IPC bounds", () => {
    global.window = global;
    require("../../data/campaign.js");
    const D = global.CAMPAIGN_DATA;
    for (const sec of D.sections) for (const z of sec.zones) for (const s of z.steps)
      assert.ok(s.objective.length <= STEP_MAX, s.id);
  });
});
