"use strict";
/** Overlay snapshot normaliser: the minimal panel shows the current step and the next step, never hints. */
const SCHEMA_VERSION = 1;
// Upper bounds on what the renderer may send. Route text is far shorter (a test checks), so nothing real is cut.
const STEP_MAX = 600;
const NEXT_MAX = 600;
const DEFAULT_OPACITY = 0.80;

const EMPTY = Object.freeze({
  v: SCHEMA_VERSION,
  zone: "—",
  section: "",
  step: "Waiting for Splitstone…",
  nextStep: "",
  nextZone: "",
  zoneMs: 0,
  runMs: 0,
  deltaMs: null,
  running: false,
  paused: false,
  finished: false,
  progress: "",
  opacity: DEFAULT_OPACITY,
  clickThrough: true,
  hotkeys: Object.freeze({ split: " ", pause: "p", undo: "u" }),
});

function formatMs(ms) {
  if (ms == null) return "—";
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function formatDelta(ms) {
  if (ms == null) return "";
  const sign = ms > 0 ? "+" : ms < 0 ? "−" : "±";
  return sign + formatMs(Math.abs(ms));
}

function ellipsis(text, limit = STEP_MAX) {
  const s = String(text || "").trim();
  if (s.length <= limit) return s;
  return s.slice(0, Math.max(0, limit - 1)).replace(/\s+$/, "") + "…";
}

function keyLabel(key) {
  if (!key) return "";
  if (key === " ") return "Space";
  return key.length > 1 ? key : key.toUpperCase();
}

function normalise(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("state must be a JSON object");
  const out = {
    v: SCHEMA_VERSION,
    zone: EMPTY.zone,
    section: "",
    step: EMPTY.step,
    nextStep: "",
    nextZone: "",
    zoneMs: 0,
    runMs: 0,
    deltaMs: null,
    running: false,
    paused: false,
    finished: false,
    progress: "",
    opacity: DEFAULT_OPACITY,
    clickThrough: true,
    hotkeys: { split: " ", pause: "p", undo: "u" },
  };
  out.v = parseInt(raw.v || SCHEMA_VERSION, 10) || SCHEMA_VERSION;
  for (const key of ["zone", "section", "nextZone", "progress"]) {
    if (raw[key] != null) out[key] = String(raw[key]).slice(0, 240);
  }
  for (const key of ["step", "nextStep"]) {
    if (raw[key] != null) out[key] = String(raw[key]);
  }
  out.step = ellipsis(out.step || "", STEP_MAX);
  out.nextStep = ellipsis(out.nextStep || "", NEXT_MAX);
  for (const key of ["zoneMs", "runMs"]) {
    if (raw[key] != null) out[key] = Math.max(0, parseInt(raw[key], 10) || 0);
  }
  if ("deltaMs" in raw) out.deltaMs = raw.deltaMs == null ? null : parseInt(raw.deltaMs, 10) || 0;
  for (const key of ["running", "paused", "finished", "clickThrough"]) {
    if (key in raw) out[key] = !!raw[key];
  }
  if (raw.opacity != null) {
    const o = Number(raw.opacity);
    if (Number.isFinite(o)) out.opacity = Math.min(1, Math.max(0.3, o));
  }
  if (raw.hotkeys && typeof raw.hotkeys === "object") {
    for (const k of ["split", "pause", "undo"]) {
      if (raw.hotkeys[k] != null) out.hotkeys[k] = String(raw.hotkeys[k]).slice(0, 16);
    }
  }
  return out;
}

function linesForPanel(state) {
  const rows = [];
  rows.push(["step", ellipsis(state.step || "—", STEP_MAX)]);
  const nxt = ellipsis(state.nextStep || "", NEXT_MAX);
  if (nxt) rows.push(["next", "Next · " + nxt]);
  return rows;
}

module.exports = {
  EMPTY, SCHEMA_VERSION, DEFAULT_OPACITY, STEP_MAX, NEXT_MAX,
  formatMs, formatDelta, ellipsis, keyLabel, normalise, linesForPanel,
};
