/* charts.js: tiny dependency-free SVG line chart for run trends. */
(function (global) {
  "use strict";

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /**
   * points: [{ y: ms, label: string, gold?: bool }] in chronological order.
   * opts: { fmt(ms), refs: [{ y, label, cls }] horizontal reference lines, height }
   */
  function line(points, opts = {}) {
    const W = 640, H = opts.height || 200, P = { l: 64, r: 12, t: 12, b: 24 };
    if (!points.length) return `<div class="muted small chart-empty">No data yet.</div>`;
    const ys = points.map(p => p.y).concat((opts.refs || []).map(r => r.y));
    let min = Math.min(...ys), max = Math.max(...ys);
    if (min === max) { min *= 0.9; max = max * 1.1 || 1; }
    const pad = (max - min) * 0.08; min = Math.max(0, min - pad); max += pad;
    const x = i => P.l + (points.length === 1 ? (W - P.l - P.r) / 2 : i * (W - P.l - P.r) / (points.length - 1));
    const y = v => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
    const fmt = opts.fmt || (v => String(v));
    const ticks = [0, 0.5, 1].map(f => min + f * (max - min));
    const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || "trend chart")}">
      ${ticks.map(t => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}"/>
        <text class="axis" x="${P.l - 6}" y="${y(t) + 4}" text-anchor="end">${esc(fmt(t))}</text>`).join("")}
      ${(opts.refs || []).map(r => `<line class="ref ${esc(r.cls || "")}" x1="${P.l}" x2="${W - P.r}" y1="${y(r.y)}" y2="${y(r.y)}"/>
        <text class="ref-label ${esc(r.cls || "")}" x="${W - P.r - 4}" y="${y(r.y) - 4}" text-anchor="end">${esc(r.label)}</text>`).join("")}
      <path class="series" d="${path}"/>
      ${points.map((p, i) => `<circle class="pt${p.gold ? " gold" : ""}" cx="${x(i)}" cy="${y(p.y)}" r="4"><title>${esc(p.label)}: ${esc(fmt(p.y))}</title></circle>`).join("")}
      <text class="axis" x="${P.l}" y="${H - 6}">${esc(points[0].label)}</text>
      ${points.length > 1 ? `<text class="axis" x="${W - P.r}" y="${H - 6}" text-anchor="end">${esc(points[points.length - 1].label)}</text>` : ""}
    </svg>`;
  }

  global.Charts = { line };
})(window);
