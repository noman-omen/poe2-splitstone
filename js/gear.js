/* gear.js: glanceable gear / gem checkpoints for the current step & zone. */
(function (global) {
  "use strict";

  const DATA = () => global.GEAR_CHECKPOINTS || { shared: {}, byClass: {}, meta: {} };
  const KIND_ICON = {
    weapon: "⚔", gem: "💎", support: "◆", vendor: "🏪", craft: "⚒",
    respec: "↺", spirit: "✦", tip: "·",
  };

  function forStep(classId, stepId) {
    if (!stepId) return [];
    const d = DATA();
    const shared = d.shared[stepId] || [];
    const klass = (classId && d.byClass[classId] && d.byClass[classId][stepId]) || [];
    // Class rows first (more specific), then shared — drop shared with same short label.
    const seen = new Set();
    const out = [];
    for (const n of klass.concat(shared)) {
      const key = (n.short || n.text || "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
    return out;
  }

  function forZone(classId, zone) {
    if (!zone || !zone.steps) return [];
    const seen = new Set();
    const out = [];
    for (const s of zone.steps) {
      for (const n of forStep(classId, s.id)) {
        const key = (n.kind + "|" + (n.short || n.text)).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(Object.assign({ stepId: s.id }, n));
      }
    }
    return out;
  }

  function icon(kind) { return KIND_ICON[kind] || "·"; }

  global.Gear = { forStep, forZone, icon, data: DATA };
})(window);
