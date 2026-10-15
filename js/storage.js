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
    };
  }

  function defaultSettings() {
    return { hideHints: false, hideExtra: false, focusMode: false,
             theme: "ember",  // global UI theme (see css/styles.css data-theme)
             autoSplit: { enabled: false, url: "http://127.0.0.1:8766" },
             hotkeys: {} };  // action -> key overrides; defaults live in app.js (HOTKEY_DEFS)
  }

  function defaultState() {
    const c = newCharacter("My character");
    return { schema: SCHEMA, activeId: c.id, characters: { [c.id]: c },
             settings: defaultSettings() };
  }

  /** Validate and normalise anything loaded from disk or an import file. */
  function normalise(s) {
    if (!s || typeof s !== "object" || !s.characters || typeof s.characters !== "object")
      throw new Error("Not a campaign tracker file");
    const out = { schema: SCHEMA, characters: {},
                  settings: Object.assign(defaultSettings(), s.settings || {}) };
    out.settings.autoSplit = Object.assign(defaultSettings().autoSplit, (s.settings || {}).autoSplit || {});
    for (const [id, c] of Object.entries(s.characters)) {
      const base = newCharacter(String(c.name || "Character"));
      out.characters[id] = Object.assign(base, c, { id });
    }
    const ids = Object.keys(out.characters);
    if (!ids.length) throw new Error("File contains no characters");
    out.activeId = out.characters[s.activeId] ? s.activeId : ids[0];
    return out;
  }

  function load() {
    try {
      let raw = localStorage.getItem(KEY);
      // One-time migration from the pre-rebrand key.
      if (!raw) {
        for (const old of LEGACY_KEYS) {
          raw = localStorage.getItem(old);
          if (raw) {
            localStorage.setItem(KEY, raw);
            localStorage.removeItem(old);
            break;
          }
        }
      }
      return raw ? normalise(JSON.parse(raw)) : defaultState();
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

  /** Import merges characters into the current state (same id = overwrite). */
  function importJSON(state, text) {
    const raw = JSON.parse(text), incoming = normalise(raw);
    Object.assign(state.characters, incoming.characters);
    if (raw.settings) state.settings = incoming.settings;  // includes hotkey bindings
    state.activeId = incoming.activeId;
    return Object.keys(incoming.characters).length;
  }

  global.Storage2 = { KEY, load, save, exportJSON, importJSON, newCharacter, uid };
})(window);
