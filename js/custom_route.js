/* custom_route.js: player-made route variants + compact share codes.
 *
 * A custom route can hide steps, reorder zones, and attach per-step notes.
 * Share payload is versioned JSON → deflate → base64url. Import is allowlisted
 * (known zone/step ids only, note length capped, no settings/URLs).
 */
(function (global) {
  "use strict";

  const DATA = () => global.CAMPAIGN_DATA;
  const SCHEMA = 1;
  const MAX_RAW = 24 * 1024;          // JSON string before compress
  const MAX_COMPRESSED = 12 * 1024;
  const MAX_NOTE = 160;
  const MAX_NOTES = 80;
  const MAX_NAME = 48;

  const allStepIds = () => {
    const ids = new Set();
    DATA().sections.forEach(s => s.zones.forEach(z => z.steps.forEach(st => ids.add(st.id))));
    return ids;
  };
  const allZoneIds = () => {
    const ids = [];
    DATA().sections.forEach(s => s.zones.forEach(z => ids.push(z.id)));
    return ids;
  };

  function uid() {
    return "cr" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function blank(name) {
    return {
      id: uid(),
      name: String(name || "My route").slice(0, MAX_NAME),
      baseMode: "normal",
      hiddenSteps: {},
      zoneOrder: null,   // null = campaign order; else array of zone ids
      notes: {},
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
  }

  /** Strip URLs / control chars; hard-cap length. */
  function cleanNote(text) {
    let s = String(text || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
    s = s.replace(/https?:\/\/\S+/gi, "[link removed]");
    s = s.replace(/\s+/g, " ").trim();
    return s.slice(0, MAX_NOTE);
  }

  function normalise(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Not a custom route");
    const steps = allStepIds(), zones = new Set(allZoneIds());
    const out = blank(raw.name);
    if (typeof raw.id === "string" && /^[a-zA-Z0-9_-]{2,32}$/.test(raw.id)) out.id = raw.id;
    out.baseMode = raw.baseMode === "fast" ? "fast" : "normal";
    out.hiddenSteps = {};
    const hidden = raw.hiddenSteps;
    if (Array.isArray(hidden)) hidden.forEach(id => { if (steps.has(id)) out.hiddenSteps[id] = true; });
    else if (hidden && typeof hidden === "object") {
      Object.keys(hidden).forEach(id => { if (steps.has(id) && hidden[id]) out.hiddenSteps[id] = true; });
    }
    if (Array.isArray(raw.zoneOrder)) {
      const seen = new Set();
      out.zoneOrder = [];
      raw.zoneOrder.forEach(id => {
        if (zones.has(id) && !seen.has(id)) { seen.add(id); out.zoneOrder.push(id); }
      });
      if (!out.zoneOrder.length) out.zoneOrder = null;
    } else out.zoneOrder = null;
    out.notes = {};
    let n = 0;
    if (raw.notes && typeof raw.notes === "object") {
      for (const [id, text] of Object.entries(raw.notes)) {
        if (!steps.has(id) || n >= MAX_NOTES) continue;
        const cleaned = cleanNote(text);
        if (cleaned) { out.notes[id] = cleaned; n++; }
      }
    }
    if (typeof raw.created === "string") out.created = raw.created;
    out.updated = new Date().toISOString();
    return out;
  }

  function sharePayload(route) {
    const r = normalise(route);
    return {
      v: SCHEMA,
      app: "splitstone-route",
      name: r.name,
      baseMode: r.baseMode,
      hiddenSteps: Object.keys(r.hiddenSteps),
      zoneOrder: r.zoneOrder,
      notes: r.notes,
    };
  }

  function bytesToB64url(bytes) {
    let s = "";
    bytes.forEach(b => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlToBytes(code) {
    let s = String(code || "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    if (!s) throw new Error("Share code is empty");
    if (/[^A-Za-z0-9+/=]/.test(s)) throw new Error("Share code has invalid characters");
    s += "=".repeat((4 - (s.length % 4)) % 4);
    const bin = atob(s);
    return Uint8Array.from(bin, ch => ch.charCodeAt(0));
  }

  async function deflate(bytes) {
    if (typeof CompressionStream === "undefined")
      throw new Error("This browser cannot compress share codes");
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function inflate(bytes) {
    if (bytes.length > MAX_COMPRESSED) throw new Error("Share code is too large");
    if (typeof DecompressionStream === "undefined")
      throw new Error("This browser cannot decompress share codes");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RAW) { try { await reader.cancel(); } catch (_) {} throw new Error("Share code expands past the size limit"); }
      chunks.push(value);
    }
    return new TextDecoder("utf-8").decode(await new Blob(chunks).arrayBuffer());
  }

  async function encode(route) {
    const json = JSON.stringify(sharePayload(route));
    if (json.length > MAX_RAW) throw new Error("Route is too large to share");
    const compressed = await deflate(new TextEncoder().encode(json));
    if (compressed.length > MAX_COMPRESSED) throw new Error("Compressed share code is too large");
    return "SSR1." + bytesToB64url(compressed);
  }

  async function decode(code) {
    const raw = String(code || "").trim();
    if (!raw.startsWith("SSR1.")) throw new Error("Not a Splitstone route code (expected SSR1.…)");
    const json = await inflate(b64urlToBytes(raw.slice(5)));
    let parsed;
    try { parsed = JSON.parse(json); } catch (_) { throw new Error("Share code is not valid JSON"); }
    if (!parsed || parsed.app !== "splitstone-route" || parsed.v !== SCHEMA)
      throw new Error("Unsupported or unknown share code version");
    // Never accept settings / URLs / unrelated keys — normalise allowlists fields.
    return normalise({
      name: parsed.name,
      baseMode: parsed.baseMode,
      hiddenSteps: parsed.hiddenSteps,
      zoneOrder: parsed.zoneOrder,
      notes: parsed.notes,
    });
  }

  /** Apply custom route filters on top of a base ordered list of {zone,section,group}. */
  function filterOrder(baseOrder, custom, stepVisibleFn, routeObj) {
    if (!custom) return baseOrder;
    let list = baseOrder.slice();
    if (custom.zoneOrder && custom.zoneOrder.length) {
      const byId = Object.fromEntries(list.map(o => [o.zone.id, o]));
      const next = [];
      custom.zoneOrder.forEach(id => { if (byId[id]) next.push(byId[id]); });
      // Append any active zones not listed (new patch content) at the end.
      list.forEach(o => { if (!custom.zoneOrder.includes(o.zone.id)) next.push(o); });
      list = next;
    }
    // Drop zones whose every visible step is hidden.
    return list.filter(o => {
      const vis = o.zone.steps.filter(s => stepVisibleFn(s, routeObj, custom));
      if (!vis.length) return false;
      return vis.some(s => !custom.hiddenSteps[s.id]);
    }).map((o, index) => Object.assign({}, o, { index }));
  }

  function stepHidden(custom, stepId) {
    return !!(custom && custom.hiddenSteps && custom.hiddenSteps[stepId]);
  }

  global.CustomRoute = {
    SCHEMA, MAX_NOTE, blank, normalise, encode, decode, cleanNote,
    filterOrder, stepHidden, sharePayload, uid,
  };
})(window);
