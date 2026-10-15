/* levels.js: zone recommended / area levels + PoE2 XP-penalty window.
 *
 * Sources (0.5.x):
 *  - Route step `level` fields in data/campaign.js (domistae / Malura bands)
 *  - Malura XP window: no penalty within (3 + floor(charLevel/16)) of area level
 *    (campaign fast tips; malura_en.txt). Exact % curve not modelled — we only
 *    flag approaching / outside the safe window.
 *  - Explicit "N (area M)" when route distinguishes character vs area level.
 * Values marked uncertain when the route only gives a band (~, +, or lo–hi).
 */
(function (global) {
  "use strict";

  /** Parse a route step level string into rec/area hints. */
  function parseLevelField(raw) {
    if (raw == null || raw === "") return null;
    const s = String(raw).trim();
    let m = s.match(/^(\d+)\s*\(\s*area\s*(\d+)\s*\)$/i);
    if (m) {
      const rec = +m[1], area = +m[2];
      return { recLow: rec, recHigh: rec, areaLevel: area, uncertain: false,
        label: `${rec} (area ${area})`, source: "route" };
    }
    m = s.match(/^~(\d+)$/);
    if (m) {
      const n = +m[1];
      return { recLow: n, recHigh: n, areaLevel: n, uncertain: true,
        label: `~${n}`, source: "route-approx" };
    }
    m = s.match(/^(\d+)\+$/);
    if (m) {
      const n = +m[1];
      return { recLow: n, recHigh: null, areaLevel: n, uncertain: true,
        label: `${n}+`, source: "route-min" };
    }
    m = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (m) {
      const lo = +m[1], hi = +m[2];
      // Area level for bands is not always published; use the high end as a
      // conservative XP reference and mark uncertain.
      return { recLow: lo, recHigh: hi, areaLevel: hi, uncertain: true,
        label: `${lo}–${hi}`, source: "route-band" };
    }
    m = s.match(/^(\d+)$/);
    if (m) {
      const n = +m[1];
      return { recLow: n, recHigh: n, areaLevel: n, uncertain: false,
        label: String(n), source: "route" };
    }
    return null;
  }

  /** First parseable step level in a zone (route order). */
  function zoneLevelInfo(zone) {
    if (!zone || !zone.steps) return null;
    for (const s of zone.steps) {
      const info = parseLevelField(s.level);
      if (info) return info;
    }
    return null;
  }

  /** Half-width of the no-penalty XP window for a character level (Malura 0.5.x). */
  function xpWindow(charLevel) {
    const n = Number(charLevel);
    if (!Number.isFinite(n) || n < 1) return null;
    return 3 + Math.floor(n / 16);
  }

  /** Effective character level: manual field, else PoB build.level. */
  function charLevel(c) {
    if (!c) return null;
    if (c.level != null && c.level !== "") {
      const n = Number(c.level);
      if (Number.isFinite(n) && n >= 1 && n <= 100) return Math.floor(n);
    }
    if (c.build && c.build.level != null) {
      const n = parseInt(c.build.level, 10);
      if (Number.isFinite(n) && n >= 1) return n;
    }
    return null;
  }

  /**
   * Glanceable status vs zone area / recommended level.
   * kind: ok | warn | bad | null
   */
  function status(charLvl, info) {
    if (charLvl == null || !info || info.areaLevel == null) return null;
    const w = xpWindow(charLvl);
    if (w == null) return null;
    const gap = info.areaLevel - charLvl; // >0 → under area level
    const unc = info.uncertain ? "≈" : "";
    if (gap > w) {
      return {
        kind: "bad",
        text: `⚠ −${gap}`,
        detail: `Char ${charLvl} is ${gap} below area ${unc}${info.areaLevel} (safe window ±${w}). Heavy XP penalty.`,
      };
    }
    if (gap >= Math.max(1, w - 1)) {
      return {
        kind: "warn",
        text: `⚠ −${gap}`,
        detail: `Near XP penalty: area ${unc}${info.areaLevel}, window ±${w} at char ${charLvl}.`,
      };
    }
    if (info.recLow != null && charLvl < info.recLow) {
      return {
        kind: "warn",
        text: `rec ${info.label}`,
        detail: `Under route recommended level ${info.label} (area ${unc}${info.areaLevel}). Still inside XP window (±${w}).`,
      };
    }
    return {
      kind: "ok",
      text: `lvl ${info.label}`,
      detail: `Area ${unc}${info.areaLevel} · XP window ±${w} at char ${charLvl}.`,
    };
  }

  global.Levels = { parseLevelField, zoneLevelInfo, xpWindow, charLevel, status };
})(window);
