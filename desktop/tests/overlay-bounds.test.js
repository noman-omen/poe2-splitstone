"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const B = require("../src/overlay-bounds");
const { merge } = require("../src/desktop-settings");
const { normalise, TIP_MAX, STEP_MAX } = require("../src/overlay-state");

const DISPLAYS = [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]];
const wa = (w, h, x = 0) => ({ x, y: 0, width: w, height: h });

describe("overlay placement", () => {
  it("defaults to top centre, below the boss bar band", () => {
    for (const [w, h] of DISPLAYS) {
      for (const pw of [B.LIMITS.defW, B.PANEL_MAX_W.l + 2 * B.MARGIN]) {
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

  it("window height follows the content, up to the screen height", () => {
    assert.equal(B.clampH(480, wa(1920, 1080)), 480);
    assert.equal(B.clampH(5000, wa(1920, 1080)), 1080);
    assert.equal(B.clampW(9999), B.PANEL_MAX_W.l + 2 * B.MARGIN);
  });
});

describe("overlay text is never shortened", () => {
  it("keeps long hints and steps whole", () => {
    const tip = "Fight him in the corner opposite the entrance, then walk straight past the blockade into town. ".repeat(4).trim();
    const st = normalise({ step: "S".repeat(300), tip, nextStep: "N".repeat(300) });
    assert.equal(st.tip, tip);
    assert.equal(st.step.length, 300);
    assert.ok(!st.tip.endsWith("…"));
  });

  it("every route step and hint fits the IPC bounds", () => {
    global.window = global;
    require("../../data/campaign.js");
    const D = global.CAMPAIGN_DATA;
    for (const sec of D.sections) for (const z of sec.zones) for (const s of z.steps) {
      assert.ok(s.objective.length <= STEP_MAX, s.id);
      for (const h of s.hints.concat(s.fastTips.map(t => "Speedrun: " + t))) assert.ok(h.length <= TIP_MAX, s.id + ": " + h);
    }
  });
});
