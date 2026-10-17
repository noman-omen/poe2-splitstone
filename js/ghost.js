/* ghost.js: race the current run against a comparison ("ghost").
 *
 * A ghost is just per-zone times: { id, name, source, variant, total, zones: { zoneId: ms } }.
 * Sources: the character's PB, sum of best segments, any saved past run, or a ghost
 * imported from another player's export file or share code (SSG1.…).
 * Everything here is pure; app.js supplies the run order and the player's times.
 * Imported data is untrusted: only known zone ids and sane numbers survive, names are
 * stripped of control characters and capped, and the caller escapes them for HTML.
 */
(function (global) {
  "use strict";

  const CODE_PREFIX = "SSG1.";
  const CODE_VERSION = 1;
  const MAX_IMPORTED = 10;              // imported ghosts kept per character
  const MAX_ZONES = 600;
  const MAX_ZONE_MS = 24 * 3600 * 1000; // one zone can't take longer than a day
  const MAX_TOTAL_MS = 30 * 24 * 3600 * 1000;
  const MAX_NAME = 60;
  const MAX_JSON_CHARS = 5 * 1024 * 1024;  // export files with long histories
  const MAX_CODE_CHARS = 16 * 1024;
  const MAX_INFLATED = 64 * 1024;
  const SOURCES = ["pb", "sob", "run", "import"];

  const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
  const uid = () => "g" + Math.random().toString(36).slice(2, 10);

  // Same cleaner as character names (clean.js), capped at the ghost name length.
  const Clean = global.Clean || (typeof require === "function" ? require("./clean.js") : null);
  const cleanName = (v, fallback) => Clean.name(v, fallback || "Ghost", MAX_NAME);
  const cleanVariant = v => (typeof v === "string" && /^[A-Za-z0-9:+_.-]{1,80}$/.test(v) ? v : "normal");
  const cleanMs = (v, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n) : null;
  };
  const isoOrNull = v => (typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);

  /** Validate a ghost against the known zone ids. Throws when nothing usable is left. */
  function normaliseGhost(raw, knownZones) {
    if (!isObj(raw)) throw new Error("Not a ghost");
    const known = knownZones instanceof Set ? knownZones : new Set(knownZones || []);
    const zones = {};
    let n = 0;
    for (const [zid, ms] of Object.entries(isObj(raw.zones) ? raw.zones : {})) {
      if (n >= MAX_ZONES) break;
      if (!known.has(zid)) continue;
      const v = cleanMs(ms, MAX_ZONE_MS);
      if (v === null) continue;
      zones[zid] = v; n++;
    }
    if (!n) throw new Error("The ghost has no zone times this version of Splitstone knows");
    const sum = Object.values(zones).reduce((a, b) => a + b, 0);
    // The total must agree with the zone times (within a second of rounding); otherwise trust the zones.
    const claimed = cleanMs(raw.total, MAX_TOTAL_MS);
    const total = claimed !== null && Math.abs(claimed - sum) <= 1000 ? claimed : sum;
    return {
      id: typeof raw.id === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(raw.id) ? raw.id : uid(),
      name: cleanName(raw.name),
      source: SOURCES.includes(raw.source) ? raw.source : "import",
      variant: cleanVariant(raw.variant),
      total,
      finished: isoOrNull(raw.finished),
      zones,
    };
  }

  /** Per-character ghost settings: which comparison is picked plus imported ghosts. */
  function blankState() { return { pick: "pb", imported: [] }; }
  function normaliseState(raw, knownZones) {
    const out = blankState();
    if (!isObj(raw)) return out;
    const list = Array.isArray(raw.imported) ? raw.imported.slice(0, MAX_IMPORTED) : [];
    for (const g of list) {
      try { out.imported.push(Object.assign(normaliseGhost(g, knownZones), { source: "import" })); } catch (_) { /* drop */ }
    }
    const pick = typeof raw.pick === "string" ? raw.pick : "pb";
    if (pick === "pb" || pick === "sob") out.pick = pick;
    else if (/^run:[A-Za-z0-9_-]{1,24}$/.test(pick)) out.pick = pick;
    else if (/^imp:[A-Za-z0-9_-]{1,24}$/.test(pick) && out.imported.some(g => "imp:" + g.id === pick)) out.pick = pick;
    return out;
  }

  /** Add an imported ghost (newest first, capped); returns its pick key. */
  function addImported(state, ghost) {
    const g = Object.assign({}, ghost, { source: "import" });
    state.imported = [g].concat((state.imported || []).filter(x => x.id !== g.id)).slice(0, MAX_IMPORTED);
    return "imp:" + g.id;
  }
  function removeImported(state, id) {
    state.imported = (state.imported || []).filter(g => g.id !== id);
    if (state.pick === "imp:" + id) state.pick = "pb";
  }

  /* ---------- Building a ghost from local data ---------- */
  function fromRun(rec, source) {
    if (!rec || !isObj(rec.zones)) return null;
    return { id: rec.id, name: source === "pb" ? "Personal best" : "Run " + (rec.finished ? rec.finished.slice(0, 10) : ""),
      source: source || "run", variant: rec.variant || "normal", total: rec.total, finished: rec.finished || null,
      zones: Object.assign({}, rec.zones) };
  }
  /** Sum of best: each zone's best segment for the variant. Zones with no best are skipped. */
  function fromBests(bests, order) {
    const zones = {};
    let total = 0;
    for (const o of order) {
      const b = bests && bests["zone:" + o.zone.id];
      if (b > 0) { zones[o.zone.id] = b; total += b; }
    }
    if (!total) return null;
    return { id: "sob", name: "Best segments", source: "sob", variant: null, total, finished: null, zones };
  }

  /**
   * Resolve the picked comparison. `ctx` = { pb, history, bests, order }.
   * Falls back to the PB when the pick no longer exists (deleted run or ghost).
   */
  function resolve(state, ctx) {
    const st = state || blankState(), pick = st.pick || "pb";
    if (pick === "sob") return fromBests(ctx.bests, ctx.order);
    if (pick.startsWith("run:")) {
      const rec = (ctx.history || []).find(h => h.id === pick.slice(4));
      if (rec) return fromRun(rec, "run");
    }
    if (pick.startsWith("imp:")) {
      const g = (st.imported || []).find(x => x.id === pick.slice(4));
      if (g) return g;
    }
    return ctx.pb ? fromRun(ctx.pb, "pb") : null;
  }

  /* ---------- Racing ---------- */
  /**
   * Compare the run with the ghost, zone by zone, in route order.
   * mine = { ms(zid), split(zid) -> bool, live: zid | null }.
   * Only zones both runs have count, so a ghost from another route stays fair.
   * Returns { rows: [{ zid, index, mine, theirs, seg, cum }], live: { zid, seg, cum } | null, cum }.
   * Positive = behind the ghost.
   */
  function compare(order, mine, ghost) {
    const rows = [];
    let a = 0, b = 0, live = null;
    if (!ghost) return { rows, live, cum: null };
    for (const o of order) {
      const zid = o.zone.id, theirs = ghost.zones[zid];
      if (theirs === undefined) continue;
      if (mine.split(zid)) {
        const ms = mine.ms(zid);
        a += ms; b += theirs;
        rows.push({ zid, index: o.index, mine: ms, theirs, seg: ms - theirs, cum: a - b });
      } else if (mine.live === zid) {
        const ms = mine.ms(zid);
        // The live zone only counts once it is already slower than the ghost's segment.
        live = { zid, index: o.index, mine: ms, theirs, seg: ms - theirs, cum: ms > theirs ? a + ms - b - theirs : (rows.length ? a - b : null) };
      }
    }
    const cum = live && live.cum !== null ? live.cum : rows.length ? rows[rows.length - 1].cum : null;
    return { rows, live, cum };
  }

  /**
   * Where the ghost would be after `elapsed` ms of run time (time in zones, pauses excluded).
   * Returns { zid, index, intoMs, zoneMs } or { finished: true } past its last zone, or null.
   */
  function position(order, ghost, elapsed) {
    if (!ghost) return null;
    let t = 0, last = null;
    for (const o of order) {
      const ms = ghost.zones[o.zone.id];
      if (!ms) continue;
      last = o;
      if (elapsed < t + ms) return { zid: o.zone.id, index: o.index, intoMs: Math.max(0, elapsed - t), zoneMs: ms };
      t += ms;
    }
    return last ? { finished: true, zid: last.zone.id, index: last.index } : null;
  }

  /**
   * Time gained or lost per act / interlude (route group). A group is `done` once every
   * one of its zones in the route is split; the group in progress is reported too.
   */
  function groupSummaries(order, mine, ghost) {
    const out = [], byGroup = new Map();
    if (!ghost) return out;
    for (const o of order) {
      if (!byGroup.has(o.group)) byGroup.set(o.group, []);
      byGroup.get(o.group).push(o);
    }
    for (const [group, zones] of byGroup) {
      let delta = 0, any = false, mineMs = 0, theirsMs = 0;
      const done = zones.every(o => mine.split(o.zone.id));
      for (const o of zones) {
        const theirs = ghost.zones[o.zone.id];
        if (theirs === undefined || !mine.split(o.zone.id)) continue;
        const ms = mine.ms(o.zone.id);
        delta += ms - theirs; mineMs += ms; theirsMs += theirs; any = true;
      }
      if (any) out.push({ group, done, delta, mine: mineMs, theirs: theirsMs });
    }
    return out;
  }

  /* ---------- Sharing ---------- */
  function bytesToB64url(bytes) {
    let s = "";
    bytes.forEach(x => { s += String.fromCharCode(x); });
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlToBytes(code) {
    let s = String(code || "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    if (!s || /[^A-Za-z0-9+/=]/.test(s)) throw new Error("Ghost code has invalid characters");
    s += "=".repeat((4 - (s.length % 4)) % 4);
    return Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
  }
  async function deflate(bytes) {
    if (typeof CompressionStream === "undefined") throw new Error("This browser cannot make ghost codes");
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function inflate(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot read ghost codes");
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_INFLATED) { try { await reader.cancel(); } catch (_) {} throw new Error("Ghost code expands past the size limit"); }
      chunks.push(value);
    }
    return new TextDecoder("utf-8").decode(await new Blob(chunks).arrayBuffer());
  }

  async function encode(ghost, name) {
    const json = JSON.stringify({ app: "splitstone-ghost", v: CODE_VERSION, name: cleanName(name || ghost.name),
      variant: ghost.variant || "normal", total: ghost.total, finished: ghost.finished || null, zones: ghost.zones });
    return CODE_PREFIX + bytesToB64url(await deflate(new TextEncoder().encode(json)));
  }

  /**
   * Read a ghost from pasted text: an SSG1 share code, a single ghost JSON, or a full
   * Splitstone export (its fastest complete run is used, preferring `opts.variant`).
   * opts = { knownZones, variant }. Always returns a normalised ghost or throws.
   */
  async function parse(text, opts) {
    const o = opts || {};
    const raw = String(text ?? "").trim();
    if (!raw) throw new Error("Paste a ghost code or an exported run file");
    if (raw.startsWith(CODE_PREFIX)) {
      if (raw.length > MAX_CODE_CHARS) throw new Error("Ghost code is too large");
      let parsed;
      try { parsed = JSON.parse(await inflate(b64urlToBytes(raw.slice(CODE_PREFIX.length)))); }
      catch (e) { throw new Error(/size limit|invalid characters/.test(e.message) ? e.message : "Ghost code is damaged", { cause: e }); }
      if (!isObj(parsed) || parsed.app !== "splitstone-ghost" || parsed.v !== CODE_VERSION) throw new Error("Unknown ghost code version");
      return normaliseGhost(Object.assign({}, parsed, { id: undefined, source: "import" }), o.knownZones);
    }
    if (raw.length > MAX_JSON_CHARS) throw new Error("File is too large to import as a ghost");
    let data;
    try { data = JSON.parse(raw); } catch (e) { throw new Error("Not a ghost code or Splitstone export", { cause: e }); }
    if (isObj(data) && data.app === "splitstone-ghost")
      return normaliseGhost(Object.assign({}, data, { id: undefined, source: "import" }), o.knownZones);
    if (!isObj(data) || data.app !== "splitstone" || !isObj(data.characters)) throw new Error("Not a ghost code or Splitstone export");
    const candidates = [];
    for (const ch of Object.values(data.characters).slice(0, 50)) {
      if (!isObj(ch) || !Array.isArray(ch.history)) continue;
      for (const h of ch.history.slice(0, 500)) {
        if (!isObj(h) || h.complete !== true || !isObj(h.zones) || h.practice) continue;
        const total = cleanMs(h.total, MAX_TOTAL_MS);
        if (total) candidates.push({ h, total, who: ch.name });
      }
    }
    if (!candidates.length) throw new Error("That export has no completed campaign runs");
    const variant = o.variant || "normal";
    const same = candidates.filter(c => (c.h.variant || "normal") === variant);
    const best = (same.length ? same : candidates).reduce((x, y) => (y.total < x.total ? y : x));
    return normaliseGhost({ name: cleanName(best.who, "Imported run") + " PB", variant: best.h.variant, total: best.total,
      finished: best.h.finished, zones: best.h.zones, source: "import" }, o.knownZones);
  }

  const Ghost = {
    CODE_PREFIX, MAX_IMPORTED, MAX_ZONES, MAX_NAME, MAX_JSON_CHARS, MAX_CODE_CHARS, MAX_INFLATED,
    blankState, normaliseState, normaliseGhost, addImported, removeImported, cleanName,
    fromRun, fromBests, resolve, compare, position, groupSummaries, encode, parse,
  };
  global.Ghost = Ghost;
  if (typeof module !== "undefined" && module.exports) module.exports = Ghost;
})(typeof window !== "undefined" ? window : globalThis);
