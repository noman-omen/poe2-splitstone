/* icons.js: one small inline SVG icon set (stroke = currentColor, 1em), so icons look
 * the same on every OS instead of mixing emoji fonts. Decorative: aria-hidden. */
(function (global) {
  "use strict";
  const P = {
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    sword: '<path d="M14.5 4H20v5.5L9 20.5 3.5 15z"/><path d="M5 13l6 6"/><path d="M3 21l2.5-2.5"/>',
    gem: '<path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18"/><path d="M12 21L8.5 9 12 3l3.5 6z"/>',
    support: '<path d="M12 3l9 9-9 9-9-9z"/>',
    shop: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9v11h16V9"/><path d="M4 9c0 2 4 2 4 0 0 2 4 2 4 0 0 2 4 2 4 0 0 2 4 2 4 0"/><path d="M10 20v-5h4v5"/>',
    hammer: '<path d="M14 6l4 4"/><path d="M10 4l6 6-2 2-6-6z"/><path d="M11 9l-8 8 3 3 8-8"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
    spark: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/><path d="M12 9l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>',
    dot: '<circle cx="12" cy="12" r="2.5"/>',
    chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M7 15l4-4 3 3 5-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    circle: '<circle cx="12" cy="12" r="7"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  };
  function icon(name, extraClass) {
    const p = P[name];
    if (!p) return "";
    return `<svg class="ico${extraClass ? " " + extraClass : ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  }
  global.Icons = { icon, names: Object.keys(P) };
})(typeof window !== "undefined" ? window : globalThis);
