/* storage.js: persistence layer (localStorage) plus JSON export/import.
 * The whole app state is one JSON document under a single key, so a save is
 * atomic and export/import is a straightforward serialisation. */
(function (global) {
  "use strict";

  const KEY = "splitstone:v1";
  const LEGACY_KEYS = ["poe2-campaign-tracker:v1"];  // migrate one-time on first load
  const SCHEMA = 1;

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  function newCharacter(name) {
    return {
      id: uid(),
      name: name || "New character",
      created: new Date().toISOString(),
      done: {},     // stepId -> true
      timers: {},   // timerKey -> { elapsed: ms, startedAt: epoch ms | null }
      maps: [],     // [{ id, name }] maps currently in the list (each has a "map:<id>" timer)
      mapHistory: [], // finished map runs, newest first: [{ id, name, ms, finished }]
      classId: null, // basic class id (warrior|…|witch) or null — see data/class_notes.js
      build: null,  // parsed PoB2 summary (see pob.js)
      // Speedrun bookkeeping (see run.js)
      route: { mode: "normal", requiredOnly: false }, // route variant filter (run.js)
      split: {},    // zoneId -> epoch ms when the zone was split (= completed in this run)
      undo: [],     // stack of { zone, autoMarked[], prevBests{}, golds[] } for undo-split
      golds: {},    // zoneId -> true when this run's segment beat the previous best
      paused: null, // timer keys that were running when the run was paused
      runStarted: null, // ISO time of the first timer start in this run
      history: [],  // finished / abandoned runs, newest first (see Run.finish)
      bests: {},    // "zone:<id>" | "section:<id>" | "group:<id>" | "total" -> best ms ever
      level: null,  // manual character level (number) or null — PoB may also set build.level
      customRoutes: {}, // id -> custom route definition (see custom_route.js)
    };
  }

  const CHAR_KEYS = Object.keys(newCharacter(""));

  function defaultSettings() {
    return { hideHints: false, hideExtra: false, focusMode: false,
             theme: "ember",  // global UI theme (see css/styles.css data-theme)
             autoSplit: { enabled: false, url: "http://127.0.0.1:8766", token: "" },
             hotkeys: {} };  // action -> key overrides; defaults live in app.js (HOTKEY_DEFS)
  }

  const SETTINGS_KEYS = ["hideHints", "hideExtra", "focusMode", "theme", "autoSplit", "hotkeys"];

  /** Local helper hosts: 127.0.0.1, localhost, [::1]. No path/search/hash/userinfo. */
  function isLocalHelperHost(hostname) {
    const h = String(hostname || "").toLowerCase();
    return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
  }

  function isLocalHelperUrl(url) {
    try {
      const u = new URL(String(url || ""));
      if (u.protocol !== "http:") return false;
      if (!isLocalHelperHost(u.hostname)) return false;
      if (u.username || u.password) return false;
      const path = u.pathname || "/";
      if (path !== "/" && path !== "") return false;
      // Reject query/hash so "?token=x" cannot be glued into "/events" by string concat.
      if (u.search || u.hash) return false;
      return true;
    } catch (_) { return false; }
  }

  /** Canonical base URL (no trailing slash, no search/hash). */
  function canonicalHelperUrl(url) {
    if (!isLocalHelperUrl(url)) return null;
    const u = new URL(String(url));
    u.hash = "";
    u.search = "";
    let out = u.origin; // http://127.0.0.1:8766 or http://[::1]:8766
    return out;
  }

  function sanitizeAutoSplit(raw, { allowEnabled = true } = {}) {
    const d = defaultSettings().autoSplit;
    const src = raw && typeof raw === "object" ? raw : {};
    const url = canonicalHelperUrl(src.url) || d.url;
    const enabled = !!(allowEnabled && src.enabled && isLocalHelperUrl(url));
    const token = typeof src.token === "string" ? src.token.slice(0, 128) : "";
    return { enabled, url, token };
  }

  function asObject(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function asArray(v) { return Array.isArray(v) ? v : []; }
  function asBool(v) { return !!v; }
  function asString(v, fallback) { return typeof v === "string" ? v : fallback; }

  function coerceCharacter(id, c) {
    const src = c && typeof c === "object" ? c : {};
    const base = newCharacter(asString(src.name, "Character"));
    const out = { id: asString(id, base.id) };
    for (const k of CHAR_KEYS) {
      if (k === "id") continue;
      if (!(k in src)) { out[k] = base[k]; continue; }
      const v = src[k];
      if (k === "name") out[k] = asString(v, base.name).slice(0, 80);
      else if (k === "created" || k === "runStarted") out[k] = typeof v === "string" || v === null ? v : base[k];
      else if (k === "classId") out[k] = typeof v === "string" || v === null ? v : null;
      else if (k === "level") {
        if (v === null || v === undefined || v === "") out[k] = null;
        else { const n = Number(v); out[k] = Number.isFinite(n) && n >= 1 && n <= 100 ? Math.floor(n) : null; }
      }
      else if (k === "build") out[k] = v && typeof v === "object" ? v : null;
      else if (k === "paused") out[k] = Array.isArray(v) || v === null ? v : null;
      else if (k === "route") {
        const r = asObject(v);
        let practice = null;
        const pr = r.practice;
        if (pr && typeof pr === "object" && typeof pr.kind === "string" && typeof pr.id === "string") {
          if (pr.kind === "group" || pr.kind === "section" || pr.kind === "zone")
            practice = { kind: pr.kind, id: pr.id.slice(0, 64) };
        }
        let customId = null;
        if (typeof r.customId === "string" && /^[a-zA-Z0-9_-]{2,32}$/.test(r.customId))
          customId = r.customId;
        out[k] = {
          mode: r.mode === "fast" ? "fast" : "normal",
          requiredOnly: asBool(r.requiredOnly),
          practice,
          customId,
        };
      }
      else if (k === "done" || k === "timers" || k === "split" || k === "golds" || k === "bests") out[k] = asObject(v);
      else if (k === "customRoutes") {
        out[k] = {};
        const srcR = asObject(v);
        Object.keys(srcR).slice(0, 30).forEach(id => {
          try {
            if (global.CustomRoute) out[k][id] = CustomRoute.normalise(Object.assign({}, srcR[id], { id }));
            else out[k][id] = srcR[id];
          } catch (_) { /* drop bad route */ }
        });
      }
      else if (k === "maps" || k === "mapHistory" || k === "undo" || k === "history") out[k] = asArray(v);
      else out[k] = base[k];
    }
    return out;
  }

  function coerceSettings(raw) {
    const d = defaultSettings();
    const src = asObject(raw);
    const out = {};
    out.hideHints = asBool(src.hideHints);
    out.hideExtra = asBool(src.hideExtra);
    out.focusMode = asBool(src.focusMode);
    out.theme = typeof src.theme === "string" ? src.theme : d.theme;
    out.hotkeys = asObject(src.hotkeys);
    out.autoSplit = sanitizeAutoSplit(src.autoSplit, { allowEnabled: true });
    return out;
  }

  function defaultState() {
    const c = newCharacter("My character");
    return { schema: SCHEMA, activeId: c.id, characters: { [c.id]: c },
             settings: defaultSettings() };
  }

  /** Validate and normalise anything loaded from disk or an import file. */
  function normalise(s) {
    if (!s || typeof s !== "object" || Array.isArray(s) || !s.characters || typeof s.characters !== "object" || Array.isArray(s.characters))
      throw new Error("Not a campaign tracker file");
    const out = { schema: SCHEMA, characters: {}, settings: coerceSettings(s.settings) };
    for (const [id, c] of Object.entries(s.characters)) {
      if (!id || typeof id !== "string") continue;
      out.characters[id] = coerceCharacter(id, c);
    }
    const ids = Object.keys(out.characters);
    if (!ids.length) throw new Error("File contains no characters");
    out.activeId = out.characters[s.activeId] ? s.activeId : ids[0];
    return out;
  }

  function load() {
    try {
      let raw = localStorage.getItem(KEY);
      if (raw) return normalise(JSON.parse(raw));
      // One-time migration from the pre-rebrand key: parse+normalise first;
      // on failure leave the old key untouched so the user can recover.
      for (const old of LEGACY_KEYS) {
        const legacy = localStorage.getItem(old);
        if (!legacy) continue;
        try {
          const state = normalise(JSON.parse(legacy));
          localStorage.setItem(KEY, JSON.stringify(state));
          localStorage.removeItem(old);
          return state;
        } catch (e) {
          console.warn("Legacy state unreadable, leaving", old, e);
        }
      }
      return defaultState();
    } catch (e) {
      console.warn("Saved state unreadable, starting fresh", e);
      return defaultState();
    }
  }

  function save(state) { localStorage.setItem(KEY, JSON.stringify(state)); }

  /** Export: whole state, or a single character when `onlyId` is given. */
  function exportJSON(state, onlyId) {
    const chars = onlyId ? { [onlyId]: state.characters[onlyId] } : state.characters;
    return JSON.stringify({ app: "splitstone", schema: SCHEMA,
      exported: new Date().toISOString(), activeId: onlyId || state.activeId,
      settings: state.settings, characters: chars }, null, 2);
  }

  /**
   * Import merges characters into the current state (same id = overwrite).
   * opts.keepHelper: if true, apply imported helper URL (localhost only) with
   * enabled forced off. Otherwise preserve the current autoSplit settings.
   * Never connects to the helper — caller must not auto-connect on import.
   */
  function importJSON(state, text, opts) {
    const options = opts || {};
    const raw = JSON.parse(text), incoming = normalise(raw);
    Object.assign(state.characters, incoming.characters);
    if (raw.settings) {
      const prevHelper = state.settings.autoSplit;
      state.settings = incoming.settings;
      if (options.keepHelper) {
        state.settings.autoSplit = sanitizeAutoSplit(incoming.settings.autoSplit, { allowEnabled: false });
      } else {
        state.settings.autoSplit = prevHelper;
      }
    }
    state.activeId = incoming.activeId;
    return Object.keys(incoming.characters).length;
  }

  global.Storage2 = {
    KEY, LEGACY_KEYS, load, save, exportJSON, importJSON, newCharacter, uid,
    isLocalHelperUrl, isLocalHelperHost, canonicalHelperUrl, sanitizeAutoSplit, normalise, defaultSettings,
  };
})(window);
