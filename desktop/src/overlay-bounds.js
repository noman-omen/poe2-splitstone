"use strict";
/**
 * Where the overlay window sits and how big it is. Pure functions on work-area
 * rectangles so they can be unit tested without Electron.
 */

/** PoE2 draws boss life bars and event banners in a band at the top centre; the overlay sits just below it. */
const BOSS_BAR_CLEARANCE = 0.11;

/** Old default (1.2): left of the minimap, which takes about the right 17% of the screen. */
const MINIMAP_GAP = 48;
const OLD_DEFAULT_TOP = 20;

/** Default panel at 1080p (every route step and its next step fit at 11px or more); other displays scale it by height. */
const BASE = Object.freeze({ width: 400, height: 72, displayHeight: 1080 });
/** Resize limits; the maximum is also capped to part of the screen. */
const LIMITS = Object.freeze({ minW: 200, minH: 44, maxW: 1200, maxH: 360, maxScreenW: 0.7, maxScreenH: 0.45 });
/** 1.2/1.3 text sizes become a starting window size. */
const TEXT_SIZE_SCALE = Object.freeze({ s: 0.85, m: 1, l: 1.3 });

const POSITIONS = ["top-center", "top-right", "custom"];

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : d);

const displayScale = wa => clamp((wa ? wa.height : BASE.displayHeight) / BASE.displayHeight, 0.6, 2.5);

function defaultSize(wa, textSize = "m") {
  const s = displayScale(wa) * (TEXT_SIZE_SCALE[textSize] || 1);
  return { width: Math.round(BASE.width * s), height: Math.round(BASE.height * s) };
}

function maxSize(wa) {
  if (!wa) return { width: LIMITS.maxW, height: LIMITS.maxH };
  return {
    width: Math.max(LIMITS.minW, Math.min(LIMITS.maxW, Math.round(wa.width * LIMITS.maxScreenW))),
    height: Math.max(LIMITS.minH, Math.min(LIMITS.maxH, Math.round(wa.height * LIMITS.maxScreenH))),
  };
}

/** A player's size, kept inside the limits for this display. Falls back to the default. */
function clampSize(size, wa) {
  const d = defaultSize(wa), max = maxSize(wa);
  return {
    width: clamp(num(size && size.width, d.width), LIMITS.minW, max.width),
    height: clamp(num(size && size.height, d.height), LIMITS.minH, max.height),
  };
}

const topCenterY = wa => wa.y + Math.round(wa.height * BOSS_BAR_CLEARANCE);
const minimapLeft = wa => wa.x + wa.width - Math.max(330, Math.round(wa.width * 0.17));

function topCenterBounds(wa, w = defaultSize(wa).width, h = defaultSize(wa).height) {
  return { x: wa.x + Math.round((wa.width - w) / 2), y: topCenterY(wa), width: w, height: h };
}

function topRightBounds(wa, w = defaultSize(wa).width, h = defaultSize(wa).height) {
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

/** Keep the horizontal midpoint and the top edge. */
function centeredResize(b, w, h, wa) {
  let x = Math.round(b.x + b.width / 2 - w / 2), y = b.y;
  if (wa) {
    x = clamp(x, wa.x, wa.x + wa.width - w);
    y = clamp(y, wa.y, wa.y + wa.height - h);
  }
  return { x, y, width: w, height: h };
}

/** Keep the top-left corner: a dragged overlay grows right and down from where it was put. */
function cornerResize(b, w, h, wa) {
  let x = b.x, y = b.y;
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
  if (position === "top-right") return anchoredResize(b, w, h, wa);
  if (position === "custom") return cornerResize(b, w, h, wa);
  return centeredResize(b, w, h, wa);
}

module.exports = {
  BOSS_BAR_CLEARANCE, MINIMAP_GAP, BASE, LIMITS, TEXT_SIZE_SCALE, POSITIONS,
  displayScale, defaultSize, maxSize, clampSize,
  topCenterBounds, topRightBounds, anchoredResize, centeredResize, cornerResize, isOldDefault, boundsFor, resizeFor,
};
