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
      bests: {},    // { variant: { "zone:<id>" | "section:<id>" | "group:<id>": best ms ever } }
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
             seen: { firstRunTip: false, ghostHint: false }, // one-time tips already shown or dismissed
             hotkeys: {} };  // action -> key overrides; defaults live in app.js (HOTKEY_DEFS)
  }


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

  /* ---------- Untrusted-data helpers (saves and imports) ---------- */
  const MAX_CHARACTERS = 100;
  const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  // Control chars, soft hyphen, Arabic letter mark, zero-width and bidi controls.
  const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g;
  function cleanText(v, max, fallback = "") {
    if (typeof v !== "string" && typeof v !== "number") return fallback;
    const s = String(v).replace(INVISIBLE, "").replace(/\s+/g, " ").trim().slice(0, max);
    return s || fallback;
  }
  const cleanName = (v, fallback) => cleanText(v, 80, fallback);
  const safeId = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) && !BAD_KEYS.has(v);
  const isoOrNull = v => (typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null);
  const MAX_MS = 30 * 24 * 3600 * 1000;
  const msOrNull = (v, max = MAX_MS) => { const n = Number(v); return typeof v !== "boolean" && Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : null; };
  const intIn = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
  /** { key: ms } with string keys only, sane numbers, capped size. */
  function msMap(v, maxKeys = 600) {
    const out = {};
    let n = 0;
    for (const [k, ms] of Object.entries(asObject(v))) {
      if (n >= maxKeys) break;
      if (typeof k !== "string" || k.length > 80 || BAD_KEYS.has(k)) continue;
      const x = msOrNull(ms);
      if (x !== null) { out[k] = x; n++; }
    }
    return out;
  }
  function boolMap(v, maxKeys = 5000) {
    const out = {};
    let n = 0;
    for (const [k, x] of Object.entries(asObject(v))) {
      if (n >= maxKeys) break;
      if (k.length > 80 || BAD_KEYS.has(k) || !x) continue;
      out[k] = typeof x === "number" ? x : true; n++;
    }
    return out;
  }
  function timerMap(v) {
    const out = {};
    for (const [k, t] of Object.entries(asObject(v))) {
      if (k.length > 100 || BAD_KEYS.has(k) || !t || typeof t !== "object") continue;
      const elapsed = msOrNull(t.elapsed) ?? 0;
      const startedAt = Number.isFinite(Number(t.startedAt)) && Number(t.startedAt) > 0 ? Number(t.startedAt) : null;
      out[k] = { elapsed, startedAt };
    }
    return out;
  }
  function cleanPractice(pr) {
    if (!pr || typeof pr !== "object" || typeof pr.kind !== "string" || typeof pr.id !== "string") return null;
    return ["group", "section", "zone"].includes(pr.kind) ? { kind: pr.kind, id: pr.id.slice(0, 64) } : null;
  }

  /** One finished/abandoned run; null when it isn't usable (skipped, not fatal). */
  function cleanHistoryEntry(h) {
    if (!h || typeof h !== "object" || Array.isArray(h)) return null;
    const total = msOrNull(h.total);
    if (!total || !h.zones || typeof h.zones !== "object") return null;
    return {
      id: safeId(h.id) ? h.id : uid(),
      complete: h.complete === true,
      variant: typeof h.variant === "string" && /^[A-Za-z0-9:+_.-]{1,120}$/.test(h.variant) ? h.variant : "normal",
      practice: cleanPractice(h.practice),
      customId: safeId(h.customId) ? h.customId : null,
      customName: h.customName == null ? null : cleanText(h.customName, 48, null),
      started: isoOrNull(h.started),
      finished: isoOrNull(h.finished) || new Date(0).toISOString(),
      splitsDone: intIn(h.splitsDone, 0, 10000) ?? 0,
      zonesTotal: intIn(h.zonesTotal, 0, 10000) ?? 0,
      zones: msMap(h.zones), sections: msMap(h.sections), groups: msMap(h.groups), total,
    };
  }
  function cleanUndoEntry(e) {
    if (!e || typeof e !== "object" || typeof e.zone !== "string" || !knownZoneIds().has(e.zone)) return null;
    const strs = v => asArray(v).filter(x => typeof x === "string" && x.length <= 80).slice(0, 2000);
    const prev = {};
    for (const [k, v] of Object.entries(asObject(e.prevBests))) {
      if (BAD_KEYS.has(k) || k.length > 80) continue;
      if (v === undefined || v === null) prev[k] = undefined; else { const x = msOrNull(v); if (x !== null) prev[k] = x; }
    }
    return { zone: e.zone, autoMarked: strs(e.autoMarked), prevBests: prev, golds: strs(e.golds).filter(z => knownZoneIds().has(z)),
      wasRunning: !!e.wasRunning, extra: strs(e.extra).filter(z => knownZoneIds().has(z)) };
  }

  /** PoB summary rebuilt from known fields only (see pob.js summarise). */
  function cleanBuild(b) {
    if (!b || typeof b !== "object" || Array.isArray(b)) return null;
    const strs = (v, max, each) => asArray(v).slice(0, max).map(x => cleanText(x, each)).filter(Boolean);
    const skills = asArray(b.skills).slice(0, 8).filter(g => g && typeof g === "object").map(g => ({
      actives: strs(g.actives, 12, 80), supports: strs(g.supports, 12, 80),
      main: g.main === true, dps: g.dps === true, label: cleanText(g.label, 80),
    })).filter(g => g.actives.length);
    const STAT_KEYS = ["Life", "EnergyShield", "Mana", "Spirit", "CombinedDPS"];
    const stats = asArray(b.stats).filter(p => Array.isArray(p) && STAT_KEYS.includes(p[0]))
      .slice(0, STAT_KEYS.length).map(([k, v]) => [k, cleanText(v, 24)]).filter(p => p[1]);
    return {
      className: cleanText(b.className, 40, "Unknown"),
      ascendancy: cleanText(b.ascendancy, 40),
      level: cleanText(b.level, 4, "?"),
      version: cleanText(b.version, 20),
      skills,
      passives: intIn(b.passives, 0, 5000) ?? 0,
      items: intIn(b.items, 0, 500) ?? 0,
      stats,
      notes: typeof b.notes === "string" ? b.notes.replace(INVISIBLE, "").slice(0, 600) : "",
      imported: isoOrNull(b.imported),
    };
  }

  function coerceCharacter(id, c) {
    const src = c && typeof c === "object" ? c : {};
    const base = newCharacter(cleanName(src.name, "Character"));
    const out = { id: safeId(id) ? id : base.id };
    for (const k of CHAR_KEYS) {
      if (k === "id") continue;
      if (k === "endgame") {
        // Schema 1 kept finished map runs in mapHistory; carry them over.
        if (src.endgame) out[k] = Endgame.normalise(src.endgame);
        else if ((Array.isArray(src.mapHistory) && src.mapHistory.length) || (Array.isArray(src.maps) && src.maps.length))
          out[k] = Endgame.fromLegacy(src.mapHistory, src.maps, src.timers, Date.now());
        else out[k] = Endgame.blank();
        continue;
      }
      if (!(k in src)) { out[k] = base[k]; continue; }
      const v = src[k];
      if (k === "name") out[k] = cleanName(v, base.name);
      else if (k === "created" || k === "runStarted") out[k] = typeof v === "string" || v === null ? v : base[k];
      else if (k === "classId") out[k] = typeof v === "string" || v === null ? v : null;
      else if (k === "level") {
        if (v === null || v === undefined || v === "") out[k] = null;
        else { const n = Number(v); out[k] = Number.isFinite(n) && n >= 1 && n <= 100 ? Math.floor(n) : null; }
      }
      else if (k === "build") out[k] = cleanBuild(v);
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
      else if (k === "done" || k === "split" || k === "golds") out[k] = boolMap(v);
      else if (k === "timers") out[k] = timerMap(v);
      else if (k === "bests") {
        // { variant: { "zone:<id>" | "section:<id>" | "group:<id>": ms } }; older flat saves are migrated by Run.prune.
        const flat = Object.keys(asObject(v)).some(x => x.includes(":"));
        out[k] = {};
        if (flat) out[k] = msMap(v, 2000);
        else for (const [variant, m] of Object.entries(asObject(v)).slice(0, 200))
          if (!BAD_KEYS.has(variant) && variant.length <= 120) out[k][variant] = msMap(m, 2000);
      }
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
      else if (k === "history") out[k] = asArray(v).slice(0, 2000).map(cleanHistoryEntry).filter(Boolean);
      else if (k === "undo") out[k] = asArray(v).slice(-300).map(cleanUndoEntry).filter(Boolean);
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
    const seen = asObject(src.seen);
    out.seen = { firstRunTip: seen.firstRunTip === true, ghostHint: seen.ghostHint === true };
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
    // Null-prototype map: an id such as "__proto__" can't reach Object.prototype.
    const out = { schema: SCHEMA, characters: Object.create(null), settings: coerceSettings(s.settings) };
    let activeId = null;
    for (const [id, c] of Object.entries(s.characters).slice(0, MAX_CHARACTERS)) {
      // Unsafe or odd ids get a fresh one; the character itself is kept.
      let key = safeId(id) ? id : null;
      while (!key || out.characters[key]) key = uid();
      out.characters[key] = coerceCharacter(key, c);
      if (id === s.activeId) activeId = key;
    }
    const ids = Object.keys(out.characters);
    if (!ids.length) throw new Error("File contains no characters");
    out.activeId = activeId || ids[0];
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
    let raw;
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
  const MAX_IMPORT_CHARS = 10 * 1024 * 1024;
  /** Parse and validate an import without touching state; tells the caller what would be replaced. */
  function previewImport(state, text) {
    if (typeof text !== "string" || text.length > MAX_IMPORT_CHARS) throw new Error("File is too large (10 MB max)");
    let raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error("Not a JSON file", { cause: e }); }
    const incoming = normalise(raw);
    // Undo stacks belong to the machine that made them; never import them.
    Object.values(incoming.characters).forEach(c => { c.undo = []; });
    const replaces = Object.keys(incoming.characters).filter(id => state.characters[id])
      .map(id => state.characters[id].name);
    return { raw, incoming, replaces, hasSettings: !!(raw && raw.settings && typeof raw.settings === "object"),
      hasHelper: !!(raw && raw.settings && raw.settings.autoSplit), count: Object.keys(incoming.characters).length };
  }

  function importJSON(state, text, opts) {
    const options = opts || {};
    const { raw, incoming } = options.preview || previewImport(state, text);
    Object.assign(state.characters, incoming.characters);
    if (raw.settings && options.applySettings !== false) {
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
    previewImport, MAX_IMPORT_CHARS, cleanBuild, cleanHistoryEntry, cleanName,
    KEY, LEGACY_KEYS, BACKUP_KEY, status, load, save, hasBackup, backupState, unblock, exportJSON, importJSON, newCharacter, uid,
    isLocalHelperUrl, isLocalHelperHost, canonicalHelperUrl, sanitizeAutoSplit, normalise, defaultSettings,
  };
})(window);
