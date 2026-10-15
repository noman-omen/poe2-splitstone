"use strict";
/** Overlay snapshot normaliser (ported from helper/overlay_state.py). */
const SCHEMA_VERSION = 1;
const TIP_MAX = 100;

const EMPTY = Object.freeze({
  v: SCHEMA_VERSION,
  zone: "—",
  section: "",
  step: "Waiting for Splitstone…",
  tip: "",
  nextStep: "",
  nextZone: "",
  zoneMs: 0,
  runMs: 0,
  deltaMs: null,
  running: false,
  paused: false,
  finished: false,
  progress: "",
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

function ellipsis(text, limit = TIP_MAX) {
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
    tip: "",
    nextStep: "",
    nextZone: "",
    zoneMs: 0,
    runMs: 0,
    deltaMs: null,
    running: false,
    paused: false,
    finished: false,
    progress: "",
    hotkeys: { split: " ", pause: "p", undo: "u" },
  };
  out.v = parseInt(raw.v || SCHEMA_VERSION, 10) || SCHEMA_VERSION;
  for (const key of ["zone", "section", "step", "nextStep", "nextZone", "progress"]) {
    if (raw[key] != null) out[key] = String(raw[key]).slice(0, 240);
  }
  if (raw.tip != null) out.tip = ellipsis(String(raw.tip), TIP_MAX);
  for (const key of ["zoneMs", "runMs"]) {
    if (raw[key] != null) out[key] = Math.max(0, parseInt(raw[key], 10) || 0);
  }
  if ("deltaMs" in raw) out.deltaMs = raw.deltaMs == null ? null : parseInt(raw.deltaMs, 10) || 0;
  for (const key of ["running", "paused", "finished"]) {
    if (key in raw) out[key] = !!raw[key];
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
  let head = state.zone || "—";
  if (state.section) head = `${state.section} · ${head}`;
  if (state.progress) head = `${head}  (${state.progress})`;
  rows.push(["zone", head]);
  rows.push(["step", state.step || "—"]);
  const tip = ellipsis(state.tip || "", TIP_MAX);
  if (tip) rows.push(["tip", "➤ " + tip]);
  const nxt = [];
  if (state.nextStep) nxt.push(state.nextStep);
  if (state.nextZone) nxt.push(state.nextZone);
  if (nxt.length) rows.push(["next", "Next · " + nxt.join(" · ")]);
  rows.push(["seg", "seg  " + formatMs(state.zoneMs)]);
  rows.push(["run", "run  " + formatMs(state.runMs)]);
  if (state.deltaMs != null) rows.push(["delta", "Δ  " + formatDelta(state.deltaMs)]);
  if (state.paused) rows.push(["status", "PAUSED"]);
  else if (state.finished) rows.push(["status", "DONE"]);
  return rows;
}

module.exports = { EMPTY, SCHEMA_VERSION, formatMs, formatDelta, ellipsis, keyLabel, normalise, linesForPanel };
