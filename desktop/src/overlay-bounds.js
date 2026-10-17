"use strict";
/**
 * Where the overlay window sits and how it grows. Pure functions on work-area
 * rectangles so they can be unit tested without Electron.
 */

/** PoE2 draws boss life bars and event banners in a band at the top centre; the overlay sits just below it. */
const BOSS_BAR_CLEARANCE = 0.11;

/** Old default (1.2): left of the minimap, which takes about the right 17% of the screen. */
const MINIMAP_GAP = 48;
const OLD_DEFAULT_TOP = 20;

/** Panel max width per text size; the window adds MARGIN on each side for the shadow. */
const PANEL_MAX_W = Object.freeze({ s: 440, m: 520, l: 600 });
const MARGIN = 6;
const LIMITS = Object.freeze({ minW: 160, maxW: PANEL_MAX_W.l + 2 * MARGIN, minH: 40, defW: 320, defH: 72 });

const POSITIONS = ["top-center", "top-right", "custom"];

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const clampW = w => clamp(parseInt(w, 10) || LIMITS.defW, LIMITS.minW, LIMITS.maxW);
const clampH = (h, wa) => clamp(parseInt(h, 10) || LIMITS.defH, LIMITS.minH, wa ? wa.height : 2000);

const topCenterY = wa => wa.y + Math.round(wa.height * BOSS_BAR_CLEARANCE);
const minimapLeft = wa => wa.x + wa.width - Math.max(330, Math.round(wa.width * 0.17));

function topCenterBounds(wa, w = LIMITS.defW, h = LIMITS.defH) {
  return { x: wa.x + Math.round((wa.width - w) / 2), y: topCenterY(wa), width: w, height: h };
}

function topRightBounds(wa, w = LIMITS.defW, h = LIMITS.defH) {
  return { x: Math.max(wa.x + 16, minimapLeft(wa) - MINIMAP_GAP - w), y: wa.y + OLD_DEFAULT_TOP, width: w, height: h };
}

/** Keep the right edge (top-right spot, so it grows away from the minimap). */
function anchoredResize(b, w, h, wa) {
  let x = b.x + b.width - w, y = b.y;
  if (wa) {
    x = clamp(x, wa.x, wa.x + wa.width - w);
    y = clamp(y, wa.y, wa.y + wa.height - h);
  }
  return { x, y, width: w, height: h };
}

/** Keep the horizontal midpoint and the top edge, so the panel grows downward. */
function centeredResize(b, w, h, wa) {
  let x = Math.round(b.x + b.width / 2 - w / 2), y = b.y;
  if (wa) {
    x = clamp(x, wa.x, wa.x + wa.width - w);
    y = clamp(y, wa.y, wa.y + wa.height - h);
  }
  return { x, y, width: w, height: h };
}

/**
 * Saved bounds from 1.2 sit at the old default when nobody dragged them: the right
 * edge on the minimap gap and y at 20 px. Those players move to top centre.
 */
function isOldDefault(saved, wa) {
  if (!saved || !wa) return false;
  const right = wa.x + saved.x + saved.width;
  const want = minimapLeft(wa) - MINIMAP_GAP;
  return Math.abs(right - want) <= 1 && Math.abs(saved.y - OLD_DEFAULT_TOP) <= 1;
}

function boundsFor(position, wa, w, h) {
  return position === "top-right" ? topRightBounds(wa, w, h) : topCenterBounds(wa, w, h);
}

function resizeFor(position, b, w, h, wa) {
  return position === "top-right" ? anchoredResize(b, w, h, wa) : centeredResize(b, w, h, wa);
}

module.exports = {
  BOSS_BAR_CLEARANCE, MINIMAP_GAP, PANEL_MAX_W, MARGIN, LIMITS, POSITIONS,
  clampW, clampH, topCenterBounds, topRightBounds, anchoredResize, centeredResize, isOldDefault, boundsFor, resizeFor,
};
