/* storage.js: persistence layer (localStorage) plus JSON export/import.
 * The whole app state is one JSON document under a single key, so a save is
 * atomic and export/import is a straightforward serialisation. */
(function (global) {
  "use strict";

  const KEY = "splitstone:v1";
  const LEGACY_KEYS = ["poe2-campaign-tracker:v1"];  // migrate one-time on first load
  // 2: endgame tracking replaced maps/mapHistory (migrated on load).
  const SCHEMA = 2;

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  function newCharacter(name) {
    return {
      id: uid(),
      name: name || "New character",
      created: new Date().toISOString(),
      done: {},     // stepId -> true
      timers: {},   // timerKey -> { elapsed: ms, startedAt: epoch ms | null }
      endgame: global.Endgame ? Endgame.blank() : { runs: [], active: null, sessions: [], sessionId: null, atlas: {} }, // see endgame.js
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
      ghost: global.Ghost ? Ghost.blankState() : { pick: "pb", imported: [] }, // race comparison (see ghost.js)
    };
  }

  const CHAR_KEYS = Object.keys(newCharacter(""));
  let _zoneIds = null;
  const knownZoneIds = () => _zoneIds || (_zoneIds = new Set(((global.CAMPAIGN_DATA || {}).sections || [])
    .flatMap(s => s.zones.map(z => z.id))));

  function defaultSettings() {
    return { hideHints: false, hideExtra: false, focusMode: false,
             theme: "ember",  // global UI theme (see css/styles.css data-theme)
             autoSplit: { enabled: false, url: "http://127.0.0.1:8766", token: "" },
             overlay: { opacity: 0.8, clickThrough: true },
             endgameAutoDetect: false, // desktop: start/stop map runs from Client.txt
             view: "campaign",         // campaign | endgame | tools
             ghostMode: false,         // race against a ghost (PB, best segments, a past or imported run)
             hotkeys: {} };  // action -> key overrides; defaults live in app.js (HOTKEY_DEFS)
  }

  const SETTINGS_KEYS = ["hideHints", "hideExtra", "focusMode", "theme", "autoSplit", "overlay", "endgameAutoDetect", "view", "ghostMode", "hotkeys"];

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
      if (k === "endgame") {
        // Schema 1 kept finished map runs in mapHistory; carry them over.
        if (src.endgame) out[k] = Endgame.normalise(src.endgame);
        else if (Array.isArray(src.mapHistory) && src.mapHistory.length) out[k] = Endgame.fromLegacyMapHistory(src.mapHistory);
        else out[k] = Endgame.blank();
        continue;
      }
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
      else if (k === "ghost") out[k] = global.Ghost ? Ghost.normaliseState(v, knownZoneIds()) : base[k];
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
      else if (k === "undo" || k === "history") out[k] = asArray(v);
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
    const ov = asObject(src.overlay);
    let opacity = Number(ov.opacity);
    if (!Number.isFinite(opacity)) opacity = 0.8;
    opacity = Math.min(1, Math.max(0.3, opacity));
    out.endgameAutoDetect = asBool(src.endgameAutoDetect);
    out.ghostMode = asBool(src.ghostMode);
    out.view = ["campaign", "endgame", "tools"].includes(src.view) ? src.view : "campaign";
    out.overlay = {
      opacity,
      clickThrough: ov.clickThrough === undefined ? true : !!ov.clickThrough,
    };
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

  /*
   * Save safety: never replace a save we could not read, and never drop data
   * because a migration write failed. `status` explains what the app should warn about.
   */
  const BACKUP_KEY = KEY + ":backup-schema1";
  const BACKUP_SINCE_KEY = KEY + ":backup-since";  // time of the first good schema-2 save
  const LEGACY_SAVES_KEY = KEY + ":backup-saves";   // counter used by early 1.1 builds
  const BACKUP_KEEP_MS = 14 * 24 * 3600 * 1000;     // keep the pre-1.1 backup for 14 days
  const status = { blocked: null, lastError: null };
  // blocked: null | "unreadable" (existing save can't be parsed) | "migration" (backup could not be written)

  const isQuota = e => !!e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014 || /quota/i.test(e.message || ""));

  function load() {
    status.blocked = null; status.lastError = null;
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { status.blocked = "unreadable"; status.lastError = String(e.message || e); return defaultState(); }
    if (raw) {
      let parsed, state;
      try { parsed = JSON.parse(raw); state = normalise(parsed); }
      catch (e) {
        console.warn("Saved state unreadable; not overwriting it", e);
        status.blocked = "unreadable"; status.lastError = String(e.message || e);
        return defaultState();
      }
      if (parsed.schema !== SCHEMA) {
        // Keep the pre-migration save, then persist the migrated state.
        try {
          if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, raw);
          localStorage.removeItem(BACKUP_SINCE_KEY);
        } catch (e) {
          // No room for the backup: keep the migrated state in memory only and leave the old save alone.
          status.blocked = "migration"; status.lastError = isQuota(e) ? "storage full" : String(e.message || e);
          return state;
        }
        try { localStorage.setItem(KEY, JSON.stringify(state)); }
        catch (e) { status.lastError = isQuota(e) ? "storage full" : String(e.message || e); }
      }
      return state;
    }
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
        status.blocked = "unreadable"; status.lastError = String(e.message || e);
        return defaultState();
      }
    }
    return defaultState();
  }

  /** Returns true when written. Refuses while blocked; reports quota errors in status. */
  function save(state) {
    if (status.blocked) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      status.lastError = isQuota(e) ? "storage full" : String(e.message || e);
      return false;
    }
    status.lastError = null;
    try {
      if (localStorage.getItem(BACKUP_KEY) !== null) {
        localStorage.removeItem(LEGACY_SAVES_KEY);
        const since = Date.parse(localStorage.getItem(BACKUP_SINCE_KEY) || "");
        if (!Number.isFinite(since)) localStorage.setItem(BACKUP_SINCE_KEY, new Date().toISOString());
        else if (Date.now() - since >= BACKUP_KEEP_MS) { localStorage.removeItem(BACKUP_KEY); localStorage.removeItem(BACKUP_SINCE_KEY); }
      }
    } catch (_) { /* counter is best effort */ }
    return true;
  }

  const hasBackup = () => { try { return localStorage.getItem(BACKUP_KEY) !== null; } catch (_) { return false; } };

  /** State from the pre-1.1 backup (migrated in memory). Throws if missing or unreadable. */
  function backupState() {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) throw new Error("No pre-1.1 backup");
    return normalise(JSON.parse(raw));
  }

  /** User chose to overwrite a blocked save (after exporting, or to restore the backup). */
  function unblock() { status.blocked = null; }



  /** Export: whole state, or a single character when `onlyId` is given. */
  /** Exports never carry the helper token (E6). */
  function settingsForExport(settings) {
    const s = JSON.parse(JSON.stringify(settings || {}));
    if (s.autoSplit) delete s.autoSplit.token;
    return s;
  }

  function exportJSON(state, onlyId) {
    const chars = onlyId ? { [onlyId]: state.characters[onlyId] } : state.characters;
    return JSON.stringify({ app: "splitstone", schema: SCHEMA,
      exported: new Date().toISOString(), activeId: onlyId || state.activeId,
      settings: settingsForExport(state.settings), characters: chars }, null, 2);
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
    KEY, LEGACY_KEYS, BACKUP_KEY, status, load, save, hasBackup, backupState, unblock, exportJSON, importJSON, newCharacter, uid,
    isLocalHelperUrl, isLocalHelperHost, canonicalHelperUrl, sanitizeAutoSplit, normalise, defaultSettings,
  };
})(window);
