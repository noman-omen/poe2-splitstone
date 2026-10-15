/* autosplit.js: zone-change auto-splitting from PoE2's Client.txt.
 *
 * Two sources feed the same matcher:
 *  1. the local helper (helper/splitstone_helper.py) over Server-Sent Events;
 *  2. no-helper mode: the File System Access API (Chromium browsers) polls a
 *     Client.txt the user picked and parses new lines in the browser.
 *
 * Matching rules (match()):
 *  - hideouts and unknown areas are ignored;
 *  - re-entering the current zone (portal / checkpoint / death) is ignored;
 *  - entering one of the next LOOKAHEAD zones of the route splits up to it
 *    (missed zones in between are closed with 0 time);
 *  - areas that are behind you (backtracking, town visits off-route) are ignored;
 *  - before the run starts, entering the current zone starts it;
 *  - in the last zone, entering a map (area id "map…") finishes the run. */
(function (global) {
  "use strict";

  const LOOKAHEAD = 4;
  const RE_GENERATING = /Generating level (\d+) area "([^"]+)"/;
  const RE_ENTERED = /\] : You have entered (.+?)\.?\s*$/;

  const norm = s => String(s || "").toLowerCase().replace(/^the /, "").replace(/[^a-z0-9]+/g, " ").trim();
  const isHideout = ev => /hideout/i.test(ev.area || "") || /hideout/i.test(ev.name || "");

  /** Does a route zone correspond to the area the player entered? */
  function zoneMatches(zone, ev) {
    if (ev.area && zone.areas.length) return zone.areas.includes(ev.area);
    if (!ev.name) return false;
    const n = norm(ev.name);
    return zone.name.split("→").some(part => norm(part) === n);
  }

  /** Decide what an entered-zone event means for character `c` (pure, no side effects). */
  function match(c, ev) {
    if (!ev || (!ev.area && !ev.name)) return { action: "ignore", reason: "empty event" };
    if (isHideout(ev)) return { action: "ignore", reason: "hideout" };
    const order = Run.order(c), cur = Run.current(c);
    if (!cur) return { action: "ignore", reason: "run complete" };
    if (Run.isPaused(c)) return { action: "ignore", reason: "paused" };
    const running = !!Run.runningZone(c);
    if (zoneMatches(cur.zone, ev)) return running ? { action: "ignore", reason: "re-entry" } : { action: "start" };
    if (!running) return { action: "ignore", reason: "run not started" };
    for (let i = cur.index + 1; i < order.length && i <= cur.index + LOOKAHEAD; i++) {
      if (zoneMatches(order[i].zone, ev)) return { action: "split", to: order[i].zone.id };
    }
    if (cur.index === order.length - 1 && /^map/i.test(ev.area || "")) return { action: "finish" };
    return { action: "ignore", reason: "not on route ahead" };
  }

  /* ---------- Sources ---------- */
  let handlers = {}, es = null, fileTimer = null;
  let status = { source: null, state: "off", detail: "" };
  const setStatus = (s) => { status = Object.assign({}, status, s); handlers.onStatus && handlers.onStatus(status); };

  function dispatch(ev) {
    if (ev.type === "zone") handlers.onZone && handlers.onZone(ev);
    else if (ev.type === "hotkey") handlers.onHotkey && handlers.onHotkey(ev.action);
    else if (ev.type === "hello") setStatus({ state: "connected",
      detail: ev.log_exists ? `watching ${ev.log}` : `waiting for ${ev.log}` });
  }

  /** Connect to the helper. EventSource reconnects by itself after errors. */
  function connect(url) {
    disconnect();
    setStatus({ source: "helper", state: "connecting", detail: url });
    try {
      es = new EventSource(url.replace(/\/$/, "") + "/events");
    } catch (e) { setStatus({ state: "error", detail: e.message }); return; }
    es.onmessage = m => { try { dispatch(JSON.parse(m.data)); } catch (e) { console.warn("bad event", e); } };
    es.onerror = () => setStatus({ state: "error", detail: `helper not reachable at ${url} (retrying)` });
  }

  /** No-helper mode: poll a user-picked Client.txt via the File System Access API. */
  async function watchFile() {
    if (!global.showOpenFilePicker) throw new Error("This browser has no File System Access API (use Chrome/Edge, or the helper).");
    const [handle] = await global.showOpenFilePicker({ types: [{ description: "Client.txt", accept: { "text/plain": [".txt"] } }] });
    disconnect();
    let pos = (await handle.getFile()).size, pending = null, carry = "";
    setStatus({ source: "file", state: "connected", detail: `watching ${handle.name} (keep this tab open)` });
    fileTimer = setInterval(async () => {
      try {
        const f = await handle.getFile();
        if (f.size < pos) pos = 0;                   // log was truncated / recreated
        if (f.size === pos) return;
        const text = carry + await f.slice(pos, f.size).text();
        pos = f.size;
        const lines = text.split(/\r?\n/);
        carry = lines.pop();                         // incomplete last line
        for (const line of lines) {
          let m = RE_GENERATING.exec(line);
          if (m) { pending = { area: m[2].toLowerCase(), level: +m[1] }; continue; }
          m = RE_ENTERED.exec(line);
          if (m) { dispatch(Object.assign({ type: "zone", name: m[1].trim() }, pending || { area: null })); pending = null; }
        }
      } catch (e) { setStatus({ state: "error", detail: "lost access to the file: " + e.message }); }
    }, 1000);
  }

  function disconnect() {
    if (es) { es.close(); es = null; }
    if (fileTimer) { clearInterval(fileTimer); fileTimer = null; }
    setStatus({ source: null, state: "off", detail: "" });
  }

  /** Push the current-step snapshot to the helper overlay (POST /state). Fire-and-forget. */
  let lastPush = 0, pushUrl = null;
  function pushState(snapshot, url) {
    if (!snapshot) return;
    pushUrl = (url || pushUrl || "").replace(/\/$/, "");
    if (!pushUrl || status.state === "off") return;
    const now = Date.now();
    // Cap at ~4 Hz so a 250ms tick does not flood the helper.
    if (now - lastPush < 200 && snapshot._force !== true) return;
    lastPush = now;
    const body = JSON.stringify(snapshot);
    try {
      // keepalive so a closing tab still delivers the last frame when possible
      fetch(pushUrl + "/state", { method: "POST", headers: { "Content-Type": "application/json" },
        body, mode: "cors", keepalive: true }).catch(() => {});
    } catch (_) { /* ignore */ }
  }

  global.AutoSplit = {
    init: h => { handlers = h; }, connect, watchFile, disconnect, match, zoneMatches,
    pushState, status: () => status, canWatchFile: () => !!global.showOpenFilePicker,
  };
})(window);
