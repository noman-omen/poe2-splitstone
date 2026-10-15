/* app.js: UI wiring. State lives in `state`; every mutation goes through
 * commit(), which saves to localStorage and re-renders. A ticker refreshes
 * only the timer/delta text, so running timers stay cheap.
 * Speedrun rules (current zone, splits, PB, bests) live in run.js. */
(function () {
  "use strict";

  const DATA = window.CAMPAIGN_DATA;
  const CLASS_NOTES = window.CLASS_NOTES || { classes: [], byClass: {}, meta: {} };
  const classMeta = id => (CLASS_NOTES.classes || []).find(c => c.id === id);
  const classNotesFor = (classId, stepId) => {
    if (!classId) return [];
    return ((CLASS_NOTES.byClass[classId] || {})[stepId]) || [];
  };
  const classRecsFor = (classId, stepId) =>
    classNotesFor(classId, stepId).filter(n => n.kind === "choice" && n.reward);
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = Timers.format;
  /** Signed delta, e.g. "+0:12" / "−1:05". Short form drops the hour when 0. */
  function fmtDelta(ms) {
    if (ms === null || ms === undefined) return "";
    const sign = ms > 0 ? "+" : ms < 0 ? "−" : "±";
    const s = Math.round(Math.abs(ms) / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    const p = n => String(n).padStart(2, "0");
    return sign + (h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`);
  }
  const deltaClass = ms => (ms === null || ms === undefined ? "" : ms > 0 ? "behind" : "ahead");

  let state = Storage2.load();
  Object.values(state.characters).forEach(Run.prune);

  /* ---------- Colour themes (global, persisted in settings.theme) ---------- */
  const THEMES = [
    { id: "ember", name: "Ember", desc: "Dark charcoal & warm gold (default)",
      chips: ["#0f0e0c", "#1a1815", "#c8a45a", "#e8e0d0"] },
    { id: "slate", name: "Slate", desc: "Blues, grays and whites",
      chips: ["#0e141b", "#1e2a36", "#5b9fd4", "#e6eef5"] },
    { id: "crimson", name: "Crimson", desc: "Reds, blacks and golds",
      chips: ["#0c0808", "#1a1010", "#c9a227", "#e04040"] },
    { id: "parchment", name: "Parchment", desc: "White, gold and gray",
      chips: ["#f4f1ea", "#ffffff", "#b8943a", "#2a261c"] },
  ];
  const VALID_THEMES = new Set(THEMES.map(t => t.id));

  function applyTheme(id) {
    const theme = VALID_THEMES.has(id) ? id : "ember";
    document.documentElement.setAttribute("data-theme", theme);
    state.settings.theme = theme;
  }


  const collapsed = new Set();           // UI-only: collapsed section ids
  let pobError = "";
  let asStatus = AutoSplit.status(), lastAuto = "";
  const openDetails = new Set();          // UI-only: <details data-keep> that stay open across re-renders
  document.addEventListener("toggle", ev => {
    const k = ev.target.dataset && ev.target.dataset.keep;
    if (k) ev.target.open ? openDetails.add(k) : openDetails.delete(k);
  }, true);

  const STATUS_TEXT = { off: "off", connecting: "connecting…", connected: "connected", error: "not connected" };
  function statusPill() {
    if (asStatus.state === "off") return "";
    return `<span class="pill as-${esc(asStatus.state)}" title="${esc(asStatus.detail)}">
      ${asStatus.source === "file" ? "Client.txt" : "Helper"}: ${STATUS_TEXT[asStatus.state]}</span>`;
  }

  const char = () => state.characters[state.activeId];
  /** Steps visible under the character's route variant. */
  const visibleSteps = (c, zone) => zone.steps.filter(s => Run.stepVisible(s, Run.route(c)));
  const allSteps = c => DATA.sections.flatMap(s => s.zones.flatMap(z => visibleSteps(c, z)));

  function commit() { Storage2.save(state); render(); }

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2400);
  }

  /* ---------- Small widgets ---------- */
  function timerWidget(key, label, opts = {}) {
    const c = char(), run = Timers.isRunning(c, key);
    return `<span class="tw${run ? " running" : ""}" data-key="${esc(key)}">
      <span class="timer" data-timer="${esc(key)}">${fmt(Timers.value(c, key))}</span>
      ${opts.noButtons ? "" : `<button class="tt" data-action="timer-toggle" data-key="${esc(key)}"
        aria-label="${run ? "Stop" : "Start"} ${esc(label)} timer">${run ? "Stop" : "Start"}</button>
      <button data-action="timer-reset" data-key="${esc(key)}" title="Reset" aria-label="Reset ${esc(label)} timer">↺</button>`}
    </span>`;
  }
  /** Derived (sum) timer: section / group totals, refreshed by tick(). */
  const sumTimer = (kind, id, ms) => `<span class="timer" data-sum="${kind}:${esc(id)}">${fmt(ms)}</span>`;
  const sumValue = (c, kind, id, now) =>
    kind === "section" ? Run.sectionMs(c, id, now) : kind === "group" ? Run.groupMs(c, id, now) : Run.totalMs(c, now);

  /* ---------- Rendering ---------- */
  function render() {
    const c = char();
    const s = state.settings;
    applyTheme(s.theme || "ember");
    document.body.classList.toggle("hide-hints", !!s.hideHints);
    document.body.classList.toggle("hide-extra", !!s.hideExtra);
    document.body.classList.toggle("focus-mode", !!s.focusMode);
    $("#hideHints").checked = !!s.hideHints;
    $("#hideExtra").checked = !!s.hideExtra;
    $("#focusMode").checked = !!s.focusMode;
    $("#meta").textContent = `Patch ${DATA.meta.patch} · ${DATA.meta.league}`;
    $("#charSelect").innerHTML = Object.values(state.characters)
      .sort((a, b) => a.created.localeCompare(b.created))
      .map(x => `<option value="${esc(x.id)}"${x.id === c.id ? " selected" : ""}>${esc(x.name)}</option>`).join("");
    renderNow(); renderTotals(); renderHistory(); renderCharacter(); renderCampaign();
    renderHelp();
    layoutSticky();
    pushOverlay();
  }

  /** The top bar wraps on narrow screens, so sticky offsets are measured, not hard-coded. */
  function layoutSticky() {
    const top = $(".topbar"), now = $("#now"), root = document.documentElement.style;
    const topH = getComputedStyle(top).position === "sticky" ? top.offsetHeight : 0;
    now.style.top = topH + "px";
    root.setProperty("--sticky-top", topH + now.offsetHeight + 12 + "px");
  }
  window.addEventListener("resize", () => layoutSticky());

  /** Big current-step block: objective, hints (unless hidden) and key route info (unless hidden). */
  function nowStepHTML(c, s) {
    if (!s) return "";
    const hints = stepHints(c, s), info = [];
    if (s.rewards.length) info.push(s.rewards.map(r => `<span class="reward${r.must ? " must" : ""}">${r.must ? "★ " : ""}${esc(r.label)}</span>`).join(""));
    if (s.waypoint) info.push(`<span class="k">Waypoint</span> ${esc(s.waypoint === true ? "Yes" : s.waypoint)}`);
    if (s.skip.length) info.push(`<span class="k">Skip</span> ${esc(s.skip.join("; "))}`);
    if (s.warning) info.push(`<span class="warn">⚠ ${esc(s.warning)}</span>`);
    return `<div class="now-step">
      <label class="now-objective"><input type="checkbox" data-action="step" data-id="${esc(s.id)}"${c.done[s.id] ? " checked" : ""}>
        <span>${esc(s.objective)}${s.level ? ` <span class="lvl">lvl ${esc(s.level)}</span>` : ""}${s.optional ? ' <span class="optional">optional</span>' : ""}</span></label>
      ${hints.length ? `<ul class="now-hints">${hints.map(h => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
      ${info.length ? `<div class="now-info">${info.map(x => `<div>${x}</div>`).join("")}</div>` : ""}
    </div>`;
  }


  /** Snapshot for the helper overlay (POST /state). Keep it tiny and stable. */
  function buildOverlayState() {
    const c = char(), cur = Run.current(c), p = Run.pb(c);
    if (!cur) {
      const last = c.history[0];
      const hk = bindings();
      return { v: 1, zone: "Campaign complete", section: "", step: last ? `Final ${Timers.format(last.total)}` : "Finished",
        tip: "", nextStep: "", nextZone: "", zoneMs: 0, runMs: Run.totalMs(c), deltaMs: null,
        running: false, paused: false, finished: true, progress: `${Run.order(c).length}/${Run.order(c).length}`,
        hotkeys: { split: hk.split, pause: hk.pause, undo: hk.undo } };
    }
    const z = cur.zone, r = Run.route(c);
    const vis = visibleSteps(c, z), todo = vis.filter(st => !c.done[st.id]);
    const step = todo[0] || vis[vis.length - 1];
    const next = Run.order(c)[cur.index + 1];
    const nextVis = next ? visibleSteps(c, next.zone) : [];
    const nextStep = todo[1] || nextVis[0];
    const tips = step ? stepHints(c, step) : [];
    const hk = bindings();
    return {
      v: 1,
      zone: z.name,
      section: cur.section.name,
      step: step ? step.objective : "",
      tip: (tips[0] || "").slice(0, 100),
      nextStep: nextStep ? nextStep.objective : "",
      nextZone: next ? next.zone.name : "",
      zoneMs: Run.zoneMs(c, z.id),
      runMs: Run.totalMs(c),
      deltaMs: Run.deltaVsPb(c),
      running: !!Run.runningZone(c),
      paused: Run.isPaused(c),
      finished: false,
      progress: `${cur.index + 1}/${Run.order(c).length}`,
      hotkeys: { split: hk.split, pause: hk.pause, undo: hk.undo },
    };
  }

  function pushOverlay() {
    if (AutoSplit.status().state === "off") return;
    AutoSplit.pushState(buildOverlayState(), state.settings.autoSplit.url);
  }

  /** The "now playing" bar: current zone, next steps, big timers, split controls. */
  function renderNow() {
    const c = char(), cur = Run.current(c), running = Run.runningZone(c), paused = Run.isPaused(c);
    const p = Run.pb(c);
    if (!cur) {
      const last = c.history[0];
      $("#now").innerHTML = `<div class="now-main"><div class="now-zone">🏁 Campaign complete</div>
        <div class="now-sub">${last ? `Final time <b class="mono">${fmt(last.total)}</b>${p && p.id === last.id ? " · <span class='ahead'>New PB!</span>" : ""}` : ""}</div></div>
        <div class="now-actions"><button data-action="undo">Undo split <kbd>${esc(keyName(bindings().undo))}</kbd></button>
        <button class="primary" data-action="new-run">New run <kbd>${esc(keyName(bindings().newRun))}</kbd></button></div>`;
      return;
    }
    const z = cur.zone, pbSeg = p && p.zones[z.id], best = Run.bestsFor(c)["zone:" + z.id];
    const vis = visibleSteps(c, z), todo = vis.filter(s => !c.done[s.id]);
    const next = Run.order(c)[cur.index + 1];
    // Current step = first open step in the zone; the rest of the zone's open steps go below it.
    const step = todo[0] || vis[vis.length - 1], others = todo.slice(1, 4);
    const nextStep = todo[1] || (next && visibleSteps(c, next.zone)[0]);
    const label = running ? "Split" : paused ? "Resume" : Run.isStarted(c) ? "Resume" : "Start run";
    $("#now").innerHTML = `
      <div class="now-main">
        <div class="now-where"><span data-as-pill>${statusPill()}</span> ${esc(cur.section.name)} · zone ${cur.index >= 0 ? cur.index + 1 : "–"}/${Run.order(c).length}${paused ? ' · <span class="behind">PAUSED</span>' : ""}</div>
        <div class="now-zone">${esc(z.name)}</div>
        ${nowStepHTML(c, step, true)}
        ${step ? `<div class="now-class">${classNoteHTML(c, step.id)}</div>` : ""}
        ${others.length ? `<ul class="now-more">${others.map(x => `<li><label><input type="checkbox" data-action="step" data-id="${esc(x.id)}"${c.done[x.id] ? " checked" : ""}>
          ${esc(x.objective)}${x.optional ? ' <span class="optional">optional</span>' : ""}</label></li>`).join("")}</ul>` : ""}
        <div class="now-next">${nextStep ? `<span class="k">Next step</span> ${esc(nextStep.objective)}` : ""}
          ${next ? `<span class="k">Next zone</span> ${esc(next.zone.name)}${next.section !== cur.section ? ` (${esc(next.section.name)})` : ""}` : ""}</div>
      </div>
      <div class="now-clock">
        <div class="big mono" data-timer="zone:${esc(z.id)}">${fmt(Run.zoneMs(c, z.id))}</div>
        <div class="now-cmp mono">${pbSeg ? `PB seg ${fmt(pbSeg)} · ` : ""}${best ? `Best ${fmt(best)}` : "no best yet"}</div>
        <div class="now-run mono">Run ${sumTimer("total", "run", Run.totalMs(c))}
          <span id="liveDelta" class="${deltaClass(Run.deltaVsPb(c))}">${p ? fmtDelta(Run.deltaVsPb(c)) : ""}</span></div>
      </div>
      <div class="now-actions">
        <button class="primary big-btn" data-action="split">${label} <kbd>${esc(keyName(bindings().split))}</kbd></button>
        <button data-action="pause"${running || paused ? "" : " disabled"}>${paused ? "Resume" : "Pause"} <kbd>${esc(keyName(bindings().pause))}</kbd></button>
        <button data-action="undo"${c.undo.length ? "" : " disabled"}>Undo <kbd>${esc(keyName(bindings().undo))}</kbd></button>
        <button data-action="new-run">New run <kbd>${esc(keyName(bindings().newRun))}</kbd></button>
      </div>`;
  }

  function renderTotals() {
    const c = char(), steps = allSteps(c), p = Run.pb(c), bests = Run.bestsFor(c);
    const done = steps.filter(s => c.done[s.id]).length;
    const row = (label, kind, id, ms, pbMs, bestMs, cls = "") => `<tr class="${cls}"><th>${esc(label)}</th>
      <td>${sumTimer(kind, id, ms)}</td><td class="muted">${pbMs ? fmt(pbMs) : "–"}</td><td class="muted">${bestMs ? fmt(bestMs) : "–"}</td></tr>`;
    const rows = [];
    DATA.groups.forEach(g => {
      const secs = DATA.sections.filter(s => s.group === g.id);
      rows.push(row(g.name, "group", g.id, Run.groupMs(c, g.id), p && p.groups[g.id], bests["group:" + g.id], "grp"));
      if (secs.length > 1) secs.forEach(s =>
        rows.push(row("└ " + s.name.replace(/^.*· /, ""), "section", s.id, Run.sectionMs(c, s.id), p && p.sections[s.id], bests["section:" + s.id], "sub")));
    });
    const actsMs = DATA.groups.filter(g => g.kind === "act").reduce((a, g) => a + Run.groupMs(c, g.id), 0);
    const intMs = DATA.groups.filter(g => g.kind === "interlude").reduce((a, g) => a + Run.groupMs(c, g.id), 0);
    const sob = Run.sumOfBest(c);
    $("#totals").innerHTML = `<h2>Run &amp; segments</h2>
      <div>${done} / ${steps.length} steps · ${Run.order(c).filter(o => c.split[o.zone.id]).length}/${Run.order(c).length} zones split</div>
      <div class="progress"><div style="width:${(100 * done / steps.length).toFixed(1)}%"></div></div>
      <table class="seg"><thead><tr><th></th><th>Now</th><th>PB</th><th>Best</th></tr></thead><tbody>
      ${rows.join("")}
      <tr class="sum"><th>Acts</th><td><span class="timer" data-sum="acts:">${fmt(actsMs)}</span></td><td></td><td></td></tr>
      <tr class="sum"><th>Interludes</th><td><span class="timer" data-sum="interludes:">${fmt(intMs)}</span></td><td></td><td></td></tr>
      <tr class="grand"><th>Campaign</th><td>${sumTimer("total", "", Run.totalMs(c))}</td><td>${p ? fmt(p.total) : "–"}</td><td>${sob ? fmt(sob) : "–"}</td></tr>
      </tbody></table>
      <div class="muted small">Best = best segment ever (gold). Campaign best = sum of best zones.</div>
      <div class="totals-row"><span>Maps total</span><span class="mono" data-sum="maps:">${fmt(Timers.sum(c, "map:"))}</span></div>`;
  }

  function renderHistory() {
    const c = char(), p = Run.pb(c);
    const runs = c.history.slice(0, 15);
    const pbOf = h => Run.pb(c, h.variant || "normal");
    $("#history").innerHTML = `<h2>Run history</h2>
      <div class="muted small">${esc(Run.variantLabel(Run.variantKey(Run.route(c))))}</div>
      ${p ? `<div class="pb">PB <b class="mono">${fmt(p.total)}</b> <span class="muted">${new Date(p.finished).toLocaleDateString()}</span></div>` : '<div class="muted">No completed run yet.</div>'}
      ${runs.length ? `<ol class="runs">${runs.map(h => { const hp = pbOf(h); return `<li class="${hp && h.id === hp.id ? "is-pb" : ""}" title="${esc(Run.variantLabel(h.variant || "normal"))}">
        <span class="mono">${fmt(h.total)}</span>
        <span class="muted">${(h.variant || "normal").startsWith("fast") ? "⚡" : ""}${h.complete ? (hp && h.id !== hp.id ? `<span class="behind">${fmtDelta(h.total - hp.total)}</span>` : "PB") : `reset ${h.splitsDone}/${h.zonesTotal}`}</span>
        <span class="muted small">${new Date(h.finished).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
        <button class="icon danger" data-action="run-delete" data-id="${esc(h.id)}" title="Delete run" aria-label="Delete run">✕</button></li>`; }).join("")}</ol>` : ""}
      <div class="row"><a href="#stats" class="small">📈 Run analytics &amp; CSV</a></div>
      ${c.history.length > runs.length ? `<div class="muted small">+${c.history.length - runs.length} older runs (in export)</div>` : ""}`;
  }

  function renderCharacter() {
    const c = char(), b = c.build;
    const cls = classMeta(c.classId);
    let html = `<h2>Character</h2><div class="char-name">${esc(c.name)}</div>
      <div class="class-picker"><label for="classSelect">Class</label>
        <select id="classSelect" title="Basic class (not ascendancy)">
          <option value="">None</option>
          ${(CLASS_NOTES.classes || []).map(x =>
            `<option value="${esc(x.id)}"${c.classId === x.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}
        </select>
        ${cls ? `<span class="muted small">${esc(cls.weapon)} — ${esc(cls.summary)}</span>` : `<span class="muted small">Optional: unlocks campaign gem &amp; reward tips for that class.</span>`}
      </div>`;
    if (b) {
      html += `<dl class="kv">
        <dt>Class</dt><dd>${esc(b.className)}</dd>
        <dt>Ascendancy</dt><dd>${esc(b.ascendancy || "None")}</dd>
        <dt>Level</dt><dd>${esc(b.level)}</dd>
        <dt>Passives</dt><dd>${b.passives}</dd>
        <dt>Items</dt><dd>${b.items}</dd>
        ${b.stats.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}
      </dl><h2 style="margin-top:12px">Main skills</h2>
      ${b.skills.map(g => `<div class="skill"><div class="${g.main ? "main" : ""}">${g.main ? "★ " : ""}${esc(g.actives.join(", "))}</div>
        ${g.supports.length ? `<div class="sup">${esc(g.supports.join(" · "))}</div>` : ""}</div>`).join("") || "<div class='empty'>No skills</div>"}
      <div class="row"><button data-action="pob-clear" class="danger">Remove build</button></div>`;
    } else {
      html += `<p class="muted" style="margin:4px 0 8px">Optional: paste a Path of Building 2 export code.</p>`;
    }
    html += `<details${b ? "" : " open"}><summary>Import PoB2 code</summary>
      <textarea id="pobCode" placeholder="eNrtPVlz2zjSz6N…" spellcheck="false"></textarea>
      <div class="row"><button class="primary" data-action="pob-import">Decode build</button></div>
      ${pobError ? `<div class="error" id="pobError">${esc(pobError)}</div>` : ""}</details>`;
    $("#character").innerHTML = html;
  }

  function classNoteHTML(c, stepId) {
    const notes = classNotesFor(c.classId, stepId);
    if (!notes.length) return "";
    const name = (classMeta(c.classId) || {}).name || c.classId;
    return notes.map(n => `<div class="class-note${n.uncertain ? " uncertain" : ""}">
      <span class="tag">${esc(n.kind)} · ${esc(name)}</span>${esc(n.text)}
      ${n.uncertain ? ` <span class="muted small">(uncertain)</span>` : ""}
      ${n.alt ? `<div class="alt">${esc(n.alt)}</div>` : ""}</div>`).join("");
  }
  function classRecHTML(c, stepId) {
    const recs = classRecsFor(c.classId, stepId);
    if (!recs.length) return "";
    const name = (classMeta(c.classId) || {}).name || c.classId;
    return recs.map(n => `<span class="class-rec"><span class="for">Recommended for ${esc(name)}</span>${esc(n.reward)}</span>`).join("");
  }

  /** Layout hints, plus the speedrun tips (⚡) when the fast route is selected. */
  const stepHints = (c, s) => s.hints.concat(Run.route(c).mode === "fast" ? s.fastTips.map(t => "⚡ " + t) : []);

  function stepHTML(s, c) {
    const done = !!c.done[s.id];
    const extra = [];
    if (s.details.length) extra.push(...s.details.map(d => `<li>${esc(d)}</li>`));
    if (s.waypoint) extra.push(`<li><span class="k">Waypoint</span>${esc(s.waypoint === true ? "Yes" : s.waypoint)}</li>`);
    if (s.skip.length) extra.push(`<li><span class="k">Skip</span>${esc(s.skip.join("; "))}</li>`);
    if (s.rewards.length) extra.push(`<li>${s.rewards.map(r =>
      `<span class="reward${r.must ? " must" : ""}">${r.must ? "★ " : ""}${esc(r.label)}</span>`).join("")}${classRecHTML(c, s.id)}</li>`);
    else if (classRecsFor(c.classId, s.id).length) extra.push(`<li>${classRecHTML(c, s.id)}</li>`);
    if (s.warning) extra.push(`<li class="warn">⚠ ${esc(s.warning)}</li>`);
    return `<div class="step${done ? " done" : ""}">
      <input type="checkbox" id="st-${esc(s.id)}" data-action="step" data-id="${esc(s.id)}"${done ? " checked" : ""}>
      <label for="st-${esc(s.id)}"><span class="objective">${esc(s.objective)}</span>
        ${s.level ? `<span class="lvl">· lvl ${esc(s.level)}</span>` : ""}${s.optional ? `<span class="optional">optional</span>` : ""}</label>
      ${stepHints(c, s).length ? `<ul class="hints">${stepHints(c, s).map(h => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
      ${classNoteHTML(c, s.id)}
      ${extra.length ? `<ul class="extra">${extra.join("")}</ul>` : ""}
    </div>`;
  }

  function zoneHTML(z, c, cur) {
    const p = Run.pb(c), isSplit = !!c.split[z.id], isCur = cur && cur.zone.id === z.id;
    const ms = Run.zoneMs(c, z.id), pbSeg = p && p.zones[z.id];
    const delta = isSplit && pbSeg ? ms - pbSeg : null;
    return `<div class="zone${isSplit ? " complete" : ""}${isCur ? " current" : ""}" data-zone="${esc(z.id)}" id="zone-${esc(z.id)}">
      <div class="zone-head"><h3>${isSplit ? "✓ " : isCur ? "▶ " : ""}${esc(z.name)}</h3>
        ${c.golds[z.id] ? '<span class="gold" title="Best segment ever">★ gold</span>' : ""}
        ${delta !== null ? `<span class="delta ${deltaClass(delta)}" title="vs PB segment ${fmt(pbSeg)}">${fmtDelta(delta)}</span>`
          : pbSeg ? `<span class="muted small" title="PB segment">PB ${fmt(pbSeg)}</span>` : ""}
        ${timerWidget("zone:" + z.id, z.name)}</div>
      ${visibleSteps(c, z).map(s => stepHTML(s, c)).join("")}</div>`;
  }

  function renderCampaign() {
    const c = char(), cur = Run.current(c);
    const r = Run.route(c);
    const sections = DATA.sections.map(sec => {
      const zones = sec.zones.filter(z => Run.zoneActive(z, r));
      const steps = zones.flatMap(z => visibleSteps(c, z)), done = steps.filter(s => c.done[s.id]).length;
      const isCur = cur && cur.section.id === sec.id;
      const isCollapsed = collapsed.has(sec.id);
      return `<section class="section${isCollapsed ? " collapsed" : ""}${isCur ? " current" : ""}" data-section="${esc(sec.id)}">
        <header>
          <button class="collapse" data-action="collapse" data-id="${esc(sec.id)}" aria-expanded="${!isCollapsed}"
            aria-label="Toggle ${esc(sec.name)}">${isCollapsed ? "▸" : "▾"}</button>
          <h2>${esc(sec.name)}<small>${esc(sec.region || "")}${sec.levels ? " · lvl " + esc(sec.levels) : ""}</small></h2>
          <span class="badge">${done}/${steps.length}</span>
          <span class="tw">${sumTimer("section", sec.id, Run.sectionMs(c, sec.id))}</span>
        </header>
        <div class="zones">${zones.map(z => zoneHTML(z, c, cur)).join("")}</div></section>`;
    }).join("");

    const maps = mapsHTML(c);

    const v = DATA.variants[r.mode] || {};
    const routeBar = `<section class="card route-bar" aria-label="Route">
      <label>Class <select id="routeClass" title="Basic class notes">
        <option value="">None</option>
        ${(CLASS_NOTES.classes || []).map(x =>
          `<option value="${esc(x.id)}"${c.classId === x.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}
      </select></label>
      <label>Route <select id="routeMode">${Object.entries(DATA.variants).map(([k, x]) =>
        `<option value="${esc(k)}"${k === r.mode ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select></label>
      <label class="switch"><input type="checkbox" id="requiredOnly"${r.requiredOnly ? " checked" : ""}> Required steps only</label>
      <span class="muted small">${esc(v.desc || "")} · ${Run.order(c).length} zones, ${allSteps(c).length} steps</span>
      <span class="as-controls">
        <label class="switch" title="Split automatically when you enter the next zone (reads Client.txt via the helper)">
          <input type="checkbox" id="autoSplit"${state.settings.autoSplit.enabled ? " checked" : ""}> Auto-split</label>
        <span data-as-pill>${statusPill()}</span>
        ${AutoSplit.canWatchFile() ? `<button data-action="watch-file" title="No helper: pick Client.txt and keep this tab open">Watch Client.txt…</button>` : ""}
        <span class="muted small" data-as-last>${esc(lastAuto)}</span>
      </span>
      <details class="as-settings" data-keep="as-settings"${openDetails.has("as-settings") ? " open" : ""}><summary>Auto-split settings</summary>
        <label>Helper URL <input type="text" id="autoSplitUrl" value="${esc(state.settings.autoSplit.url)}" size="28"></label>
        <span class="muted small">Run <code>helper/splitstone_helper.py --overlay</code> on the gaming PC for auto-split + the top-right in-game panel (see README).</span>
      </details>
      ${v.tips && v.tips.length ? `<details class="tips" data-keep="tips"${openDetails.has("tips") ? " open" : ""}><summary>Speedrun tips (${v.tips.length})</summary><ul>${v.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul></details>` : ""}
    </section>`;
    $("#campaign").innerHTML = routeBar + sections + maps + statsHTML(c);
  }

  /* ---------- Endgame maps: timers + history / PBs ---------- */
  const mapKey = name => name.trim().toLowerCase();
  /** Per-map stats from history, keyed by normalised map name. */
  function mapStats(c) {
    const out = {};
    (c.mapHistory || []).forEach(m => {
      const k = mapKey(m.name), s = out[k] || (out[k] = { runs: 0, sum: 0, pb: null, last: null });
      s.runs++; s.sum += m.ms;
      if (s.pb === null || m.ms < s.pb) s.pb = m.ms;
      if (!s.last) s.last = m.ms;                  // history is newest first
    });
    Object.values(out).forEach(s => { s.avg = s.sum / s.runs; });
    return out;
  }

  function mapsHTML(c) {
    const stats = mapStats(c), hist = (c.mapHistory || []).slice(0, 12);
    const statLine = st => st ? `<span class="muted small mono" title="${st.runs} runs">PB ${fmt(st.pb)} · avg ${fmt(st.avg)} · ${st.runs}×</span>` : `<span class="muted small">no runs yet</span>`;
    return `<section class="section maps" data-section="maps">
      <header><h2>Endgame maps<small>timed map runs, history and per-map PBs (separate from the campaign run)</small></h2>
        <span class="badge">${(c.mapHistory || []).length} runs</span></header>
      <div class="zones">
        <form class="maps-add" data-form="map-add"><input type="text" id="mapName" list="mapNames" placeholder="Map name, e.g. Burial Bog (T1)" maxlength="80">
          <datalist id="mapNames">${[...new Set((c.mapHistory || []).map(m => m.name))].map(n => `<option value="${esc(n)}">`).join("")}</datalist>
          <button class="primary" type="submit">Add map</button></form>
        ${c.maps.length ? c.maps.map(m => {
          const st = stats[mapKey(m.name)], ms = Timers.value(c, "map:" + m.id);
          return `<div class="map-row" data-map="${esc(m.id)}"><span class="name">${esc(m.name)} ${statLine(st)}</span>
          ${st && ms ? `<span class="delta ${deltaClass(ms - st.pb)}" data-map-delta="${esc(m.id)}">${fmtDelta(ms - st.pb)}</span>` : ""}
          ${timerWidget("map:" + m.id, m.name)}
          <button data-action="map-finish" data-id="${esc(m.id)}" title="Save this run to map history and reset the timer"${ms ? "" : " disabled"}>✓ Finish</button>
          <button data-action="map-delete" data-id="${esc(m.id)}" class="danger" title="Remove map from the list (history is kept)">✕</button></div>`;
        }).join("") : `<div class="empty">No maps yet. Add one, press Start when you enter it and ✓ Finish when done.</div>`}
        ${hist.length ? `<h3 class="chart-title" style="padding:0 16px">Recent map runs</h3><ol class="runs map-runs">${hist.map(m => {
          const st = stats[mapKey(m.name)], isPb = st && st.pb === m.ms;
          return `<li class="${isPb ? "is-pb" : ""}"><span class="mono">${fmt(m.ms)}</span><span>${esc(m.name)}${isPb ? " · PB" : ""}</span>
            <span class="muted small">${new Date(m.finished).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
            <button class="icon danger" data-action="map-run-delete" data-id="${esc(m.id)}" aria-label="Delete map run">✕</button></li>`; }).join("")}</ol>` : ""}
      </div></section>`;
  }

  /* ---------- Run analytics (history charts / trends) ---------- */
  let statSeg = "total";                  // UI-only: segment shown in the trend chart
  const segValue = (h, seg) => {
    if (seg === "total") return h.total;
    const [kind, id] = seg.split(":");
    return (kind === "group" ? h.groups : kind === "section" ? h.sections : h.zones)[id];
  };
  const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const shortDate = iso => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

  function segmentOptions(c) {
    const opts = [["total", "Campaign total"]];
    DATA.groups.forEach(g => {
      opts.push(["group:" + g.id, g.name]);
      const secs = DATA.sections.filter(s => s.group === g.id);
      if (secs.length > 1) secs.forEach(s => opts.push(["section:" + s.id, "  " + s.name]));
    });
    Run.order(c).forEach(o => opts.push(["zone:" + o.zone.id, `Zone · ${o.section.name} · ${o.zone.name}`]));
    return opts;
  }

  function statsHTML(c) {
    const variant = Run.variantKey(Run.route(c));
    const runs = Run.runsOf(c, variant).slice().reverse();       // chronological
    const complete = runs.filter(h => h.complete), p = Run.pb(c), sob = Run.sumOfBest(c);
    const totals = complete.map(h => h.total), last5 = totals.slice(-5);
    const card = (label, v) => `<div class="stat"><div class="muted small">${label}</div><div class="mono">${v}</div></div>`;
    const opts = segmentOptions(c);
    if (!opts.some(o => o[0] === statSeg)) statSeg = "total";
    const segRuns = (statSeg === "total" ? complete : runs).filter(h => segValue(h, statSeg));
    const segVals = segRuns.map(h => segValue(h, statSeg));
    const bestKey = statSeg === "total" ? "total" : statSeg;
    const segBest = Run.bestsFor(c)[bestKey];
    const pts = segRuns.map(h => ({ y: segValue(h, statSeg), label: shortDate(h.finished), gold: h.total === (p && p.total) && statSeg === "total" }));
    const refs = [];
    if (segVals.length > 1) refs.push({ y: avg(segVals), label: "avg " + fmt(avg(segVals)), cls: "avg" });
    if (segBest) refs.push({ y: segBest, label: "best " + fmt(segBest), cls: "best" });
    // Per-act/interlude table: where is the most time to gain (avg − best)?
    const rows = DATA.groups.map(g => {
      const vals = runs.map(h => h.groups[g.id]).filter(Boolean), b = Run.bestsFor(c)["group:" + g.id];
      return { name: g.name, avg: avg(vals), best: b, pb: p && p.groups[g.id], last: vals[vals.length - 1], gain: b && vals.length ? avg(vals) - b : null };
    });
    return `<section class="section stats" data-section="stats" id="stats">
      <header><h2>Run analytics<small>${esc(Run.variantLabel(variant))}</small></h2>
        <button data-action="csv-runs">Runs CSV</button><button data-action="csv-maps">Maps CSV</button></header>
      <div class="zones"><div class="stat-cards">
        ${card("Completed runs", complete.length)}${card("Resets", runs.length - complete.length)}
        ${card("PB", p ? fmt(p.total) : "–")}${card("Average", totals.length ? fmt(avg(totals)) : "–")}
        ${card("Avg last 5", last5.length ? fmt(avg(last5)) : "–")}${card("Sum of best", sob ? fmt(sob) : "–")}
        ${card("PB − SoB", p && sob ? fmt(p.total - sob) : "–")}
      </div>
      <h3 class="chart-title">Campaign time per run</h3>
      ${Charts.line(complete.map(h => ({ y: h.total, label: shortDate(h.finished), gold: p && h.id === p.id })),
        { fmt, title: "Campaign time per run", refs: [
          ...(totals.length > 1 ? [{ y: avg(totals), label: "avg", cls: "avg" }] : []),
          ...(sob ? [{ y: sob, label: "sum of best", cls: "best" }] : [])] })}
      <h3 class="chart-title">Segment trend <select id="statSeg">${opts.map(([v, l]) =>
        `<option value="${esc(v)}"${v === statSeg ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></h3>
      ${Charts.line(pts, { fmt, title: "Segment trend", refs })}
      <div class="muted small">${segVals.length} runs · avg ${segVals.length ? fmt(avg(segVals)) : "–"} · best ${segBest ? fmt(segBest) : "–"} · last ${segVals.length ? fmt(segVals[segVals.length - 1]) : "–"}</div>
      <table class="seg trend"><thead><tr><th>Segment</th><th>Avg</th><th>Best</th><th>PB run</th><th>Last</th><th>Avg − best</th></tr></thead><tbody>
        ${rows.map(r => `<tr><th>${esc(r.name)}</th>${[r.avg, r.best, r.pb, r.last].map(v => `<td>${v ? fmt(v) : "–"}</td>`).join("")}
          <td class="${r.gain > 0 ? "behind" : ""}">${r.gain ? fmt(r.gain) : "–"}</td></tr>`).join("")}
      </tbody></table></div></section>`;
  }

  /** CSV helpers: one row per run, times in seconds (spreadsheet friendly). */
  const csvCell = v => (/[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
  const sec = ms => (ms ? (ms / 1000).toFixed(1) : "");
  function runsCSV(c) {
    const cols = [...DATA.groups.map(g => ["groups", g.id, g.name]), ...DATA.sections.map(s => ["sections", s.id, s.name]),
      ...Run.ALL.map(o => ["zones", o.zone.id, `${o.zone.id} ${o.zone.name}`])];
    const head = ["run_id", "character", "variant", "complete", "started", "finished", "total_s", ...cols.map(c => c[2] + " (s)")];
    const lines = c.history.slice().reverse().map(h => [h.id, c.name, h.variant || "normal", h.complete, h.started || "", h.finished,
      sec(h.total), ...cols.map(([k, id]) => sec((h[k] || {})[id]))]);
    return [head, ...lines].map(r => r.map(csvCell).join(",")).join("\n") + "\n";
  }
  function mapsCSV(c) {
    const lines = (c.mapHistory || []).slice().reverse().map(m => [m.id, c.name, m.name, m.finished, sec(m.ms)]);
    return [["run_id", "character", "map", "finished", "time_s"], ...lines].map(r => r.map(csvCell).join(",")).join("\n") + "\n";
  }
  function download(name, text, type) {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const fileSafe = s => s.replace(/[^a-z0-9_-]+/gi, "_");

  /** Called 4×/s: refresh only the numbers, not the DOM structure. */
  function tick() {
    const c = char(), now = Date.now();
    document.querySelectorAll("[data-timer]").forEach(el => {
      el.textContent = fmt(Timers.value(c, el.dataset.timer, now));
    });
    document.querySelectorAll("[data-sum]").forEach(el => {
      const [kind, id] = el.dataset.sum.split(":");
      let ms;
      if (kind === "maps") ms = Timers.sum(c, "map:", now);
      else if (kind === "acts" || kind === "interludes")
        ms = DATA.groups.filter(g => g.kind === (kind === "acts" ? "act" : "interlude")).reduce((a, g) => a + Run.groupMs(c, g.id, now), 0);
      else ms = sumValue(c, kind, id, now);
      el.textContent = fmt(ms);
    });
    const ms = mapStats(c);
    document.querySelectorAll("[data-map-delta]").forEach(el => {
      const m = c.maps.find(x => x.id === el.dataset.mapDelta), st = m && ms[mapKey(m.name)];
      if (st) { const v = Timers.value(c, "map:" + m.id, now) - st.pb; el.textContent = fmtDelta(v); el.className = "delta " + deltaClass(v); }
    });
    const d = $("#liveDelta");
    if (d && Run.pb(c)) { const v = Run.deltaVsPb(c, now); d.textContent = fmtDelta(v); d.className = deltaClass(v); }
    // Keep the overlay clock in sync (~4 Hz cap inside pushState).
    if (Run.runningZone(c) || Run.isPaused(c)) pushOverlay();
  }

  function scrollToCurrent(smooth = true) {
    const cur = Run.current(char());
    const el = cur && document.getElementById("zone-" + cur.zone.id);
    if (el) el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
  }

  /* ---------- Actions ---------- */
  function doSplit() {
    const c = char(), cur = Run.current(c);
    if (!cur) return toast(`Run complete. Press ${keyName(bindings().newRun)} for a new run.`);
    if (!Run.runningZone(c)) {           // nothing timing: Space starts/resumes
      if (Run.isPaused(c)) Run.togglePause(c); else Run.startZone(c, cur.zone.id);
      commit(); return;
    }
    const res = Run.split(c);
    commit();
    if (res === "finished") {
      const p = Run.pb(c), last = c.history[0];
      toast(p && last && p.id === last.id ? `New PB! ${fmt(last.total)}` : `Run finished: ${fmt(last.total)}`);
    }
    scrollToCurrent();
  }

  function doNewRun() {
    const c = char();
    if (Run.isStarted(c) && !Run.isFinished(c)) {
      if (!confirm("Reset the current run? It will be saved in history as an unfinished attempt.")) return;
      Run.finish(c, false);
    } else if (Run.isStarted(c) && !confirm("Start a new run?")) return;
    Run.newRun(c);
    commit(); window.scrollTo({ top: 0 }); toast(`New run ready. Press ${keyName(bindings().split)} to start.`);
  }

  const actions = {
    split: doSplit,
    pause() { const r = Run.togglePause(char()); if (r) { commit(); toast(r === "paused" ? "Paused" : "Resumed"); } },
    undo() { if (Run.undoSplit(char())) { commit(); toast("Split undone"); scrollToCurrent(); } },
    "new-run": doNewRun,
    "timer-toggle"(el) {
      const c = char(), key = el.dataset.key;
      if (key.startsWith("zone:")) {
        if (Timers.isRunning(c, key)) Timers.stop(c, key); else Run.startZone(c, key.slice(5));
      } else Timers.toggle(c, key);
      commit();
    },
    "timer-reset"(el) {
      if (confirm("Reset this timer to 0?")) { Timers.reset(char(), el.dataset.key); commit(); }
    },
    step(el) {
      const c = char(), id = el.dataset.id;
      if (el.checked) c.done[id] = true; else delete c.done[id];
      // Auto-advance: ticking the last required step of the zone being timed splits it.
      const cur = Run.current(c);
      if (el.checked && cur && Run.runningZone(c) === cur.zone.id && cur.zone.steps.some(s => s.id === id)
          && Run.requiredSteps(cur.zone, Run.route(c)).every(s => c.done[s.id])) return doSplit();
      commit();
    },
    collapse(el) {
      const id = el.dataset.id;
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      render();
    },
    "map-delete"(el) {
      const c = char();
      c.maps = c.maps.filter(m => m.id !== el.dataset.id);
      Timers.reset(c, "map:" + el.dataset.id);
      commit();
    },
    "map-finish"(el) {
      const c = char(), m = c.maps.find(x => x.id === el.dataset.id), key = "map:" + el.dataset.id;
      Timers.stop(c, key);
      const ms = Timers.value(c, key);
      if (!m || !ms) return;
      const prev = mapStats(c)[mapKey(m.name)];
      c.mapHistory = c.mapHistory || [];
      c.mapHistory.unshift({ id: Storage2.uid(), name: m.name, ms, finished: new Date().toISOString() });
      Timers.reset(c, key);
      commit();
      toast(!prev || ms < prev.pb ? `New map PB: ${m.name} ${fmt(ms)}` : `${m.name}: ${fmt(ms)} (${fmtDelta(ms - prev.pb)} vs PB)`);
    },
    "map-run-delete"(el) {
      const c = char();
      c.mapHistory = (c.mapHistory || []).filter(m => m.id !== el.dataset.id);
      commit();
    },
    "run-delete"(el) {
      if (!confirm("Delete this run from history? (Best segments are kept.)")) return;
      const c = char();
      c.history = c.history.filter(h => h.id !== el.dataset.id);
      commit();
    },
    "char-new"() {
      const name = prompt("Character name:", "New character");
      if (!name || !name.trim()) return;
      const c = Storage2.newCharacter(name.trim());
      state.characters[c.id] = c; state.activeId = c.id; pobError = "";
      commit(); toast(`Created ${c.name}`);
    },
    "char-rename"() {
      const name = prompt("Rename character:", char().name);
      if (name && name.trim()) { char().name = name.trim(); commit(); }
    },
    "char-delete"() {
      if (Object.keys(state.characters).length === 1) return toast("You need at least one character.");
      if (!confirm(`Delete "${char().name}" and all its progress and run history?`)) return;
      delete state.characters[state.activeId];
      state.activeId = Object.keys(state.characters)[0];
      commit();
    },
    export() {
      const blob = new Blob([Storage2.exportJSON(state)], { type: "application/json" });
      const a = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(blob),
        download: `splitstone-${new Date().toISOString().slice(0, 10)}.json`,
      });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast("Exported");
    },
    import() { $("#importFile").click(); },
    async "watch-file"() {
      try { await AutoSplit.watchFile(); toast("Watching Client.txt"); }
      catch (e) { if (e.name !== "AbortError") toast(e.message); }
    },
    "csv-runs"() { download(`splitstone-runs-${fileSafe(char().name)}.csv`, runsCSV(char()), "text/csv"); },
    "csv-maps"() { download(`splitstone-maps-${fileSafe(char().name)}.csv`, mapsCSV(char()), "text/csv"); },
    help() { $("#help").toggleAttribute("hidden"); },
    async "pob-import"() {
      const code = $("#pobCode").value;
      try {
        char().build = await PoB.decode(code);
        pobError = ""; commit(); toast("Build imported");
      } catch (e) {
        pobError = e instanceof PoB.PobError ? e.message : "Could not read that build code.";
        console.warn(e); render();
      }
    },
    "pob-clear"() { char().build = null; commit(); },
  };

  document.addEventListener("click", ev => {
    const el = ev.target.closest("[data-action]");
    if (!el || el.dataset.action === "step") return;
    const fn = actions[el.dataset.action];
    if (fn) fn(el, ev);
  });
  document.addEventListener("change", ev => {
    const el = ev.target;
    if (el.dataset.action === "step") actions.step(el);
    else if (["hideHints", "hideExtra", "focusMode"].includes(el.id)) { state.settings[el.id] = el.checked; commit(); }
    else if (el.id === "routeMode" || el.id === "requiredOnly") {
      const c = char(), next = Object.assign({}, Run.route(c),
        el.id === "routeMode" ? { mode: el.value } : { requiredOnly: el.checked });
      if (Run.isStarted(c) && !Run.isFinished(c) &&
          !confirm("Change the route during a run? Times will be compared with that route's PB from now on.")) return render();
      // A zone that disappears from the route must not keep running.
      const running = Run.runningZone(c);
      c.route = next;
      if (running && !Run.inOrder(c, running)) Run.stopAllZones(c);
      commit();
    }
    else if (el.id === "statSeg") { statSeg = el.value; renderCampaign(); }
    else if (el.id === "autoSplit") {
      state.settings.autoSplit.enabled = el.checked;
      if (el.checked) AutoSplit.connect(state.settings.autoSplit.url); else AutoSplit.disconnect();
      commit();
    }
    else if (el.id === "autoSplitUrl") {
      state.settings.autoSplit.url = el.value.trim() || "http://127.0.0.1:8766";
      if (state.settings.autoSplit.enabled) AutoSplit.connect(state.settings.autoSplit.url);
      commit();
    }
    else if (el.id === "classSelect" || el.id === "routeClass") {
      const c = char(), next = el.value || null;
      if (c.classId && next !== c.classId && Run.isStarted(c) && !Run.isFinished(c) &&
          !confirm("Change class notes mid-run? Tips update immediately; timers are unchanged.")) {
        render(); return;
      }
      c.classId = next;
      commit();
      toast(next ? `Class: ${(classMeta(next) || {}).name}` : "Class notes cleared");
    }
    else if (el.id === "charSelect") { state.activeId = el.value; pobError = ""; commit(); scrollToCurrent(false); }
    else if (el.id === "importFile" && el.files[0]) {
      el.files[0].text().then(text => {
        try {
          const n = Storage2.importJSON(state, text);
          Object.values(state.characters).forEach(Run.prune);
          commit(); toast(`Imported ${n} character(s)`);
        } catch (e) { toast("Import failed: " + e.message); }
        el.value = "";
      });
    }
  });
  document.addEventListener("submit", ev => {
    if (ev.target.dataset.form !== "map-add") return;
    ev.preventDefault();
    const name = $("#mapName").value.trim();
    if (!name) return;
    char().maps.push({ id: Storage2.uid(), name });
    commit();
    $("#mapName").focus();
  });

  /* ---------- Hotkeys (rebindable, ignored while typing) ---------- */
  const flip = key => { state.settings[key] = !state.settings[key]; commit(); };
  const HOTKEY_DEFS = [
    // [action id, default key (KeyboardEvent.key, lower-case letters), label, handler]
    ["split", " ", "Start run / split current zone", () => doSplit()],
    ["undo", "u", "Undo last split", () => actions.undo()],
    ["pause", "p", "Pause / resume", () => actions.pause()],
    ["newRun", "r", "New run", () => doNewRun()],
    ["scroll", "c", "Scroll to current zone", () => scrollToCurrent()],
    ["focus", "f", "Focus mode", () => { flip("focusMode"); scrollToCurrent(false); }],
    ["hints", "h", "Hide / show hints", () => flip("hideHints")],
    ["extra", "e", "Hide / show extra info", () => flip("hideExtra")],
    ["help", "?", "Show / hide shortcuts", () => actions.help()],
  ];
  const RESERVED = ["Escape", "Tab"];
  const bindings = () => Object.fromEntries(HOTKEY_DEFS.map(([id, def]) =>
    [id, (state.settings.hotkeys || {})[id] ?? def]));
  const keyName = k => (k === " " ? "Space" : k === "" || k == null ? "—" : k.length === 1 ? k.toUpperCase() : k);
  const normKey = k => (k.length === 1 ? k.toLowerCase() : k);
  let capturing = null;                   // action id waiting for a new key

  function renderHelp() {
    const b = bindings(), cur = state.settings.theme || "ember";
    $("#helpKeys").innerHTML = HOTKEY_DEFS.map(([id, , label]) =>
      `<dt><kbd>${esc(keyName(b[id]))}</kbd></dt><dd>${esc(label)}</dd>`).join("") +
      `<dt><kbd>Esc</kbd></dt><dd>Close dialogs / leave a text field</dd>`;
    $("#keyTable").innerHTML = HOTKEY_DEFS.map(([id, def, label]) => `<tr data-hk="${id}">
      <td>${esc(label)}</td><td><kbd>${capturing === id ? "press a key…" : esc(keyName(b[id]))}</kbd></td>
      <td><button data-action="key-change" data-id="${id}">${capturing === id ? "Cancel" : "Change"}</button></td>
      <td class="muted small">${b[id] !== def ? "default " + esc(keyName(def)) : ""}</td></tr>`).join("");
    const grid = $("#themeGrid");
    if (grid) grid.innerHTML = THEMES.map(t => `<button type="button" class="theme-swatch" role="option"
      data-action="set-theme" data-id="${esc(t.id)}" aria-pressed="${t.id === cur}" title="${esc(t.desc)}">
      <span class="chips">${t.chips.map(c => `<span style="background:${c}"></span>`).join("")}</span>
      <span class="name">${esc(t.name)}</span><span class="desc">${esc(t.desc)}</span></button>`).join("");
  }

  /** Assign `key` to action `id` unless another action already uses it. */
  function bindKey(id, key) {
    const b = bindings(), clash = Object.keys(b).find(a => a !== id && b[a] === key);
    if (RESERVED.includes(key)) return `${keyName(key)} is reserved.`;
    if (clash) return `${keyName(key)} is already used by "${HOTKEY_DEFS.find(d => d[0] === clash)[2]}".`;
    state.settings.hotkeys = Object.assign({}, state.settings.hotkeys, { [id]: key });
    commit();
    return "";
  }

  Object.assign(actions, {
    settings() { $("#help").setAttribute("hidden", ""); capturing = null; renderHelp(); $("#settings").removeAttribute("hidden"); },
    "settings-close"() { capturing = null; $("#settings").setAttribute("hidden", ""); },
    "key-change"(el) { capturing = capturing === el.dataset.id ? null : el.dataset.id; $("#keyError").textContent = ""; renderHelp(); },
    "keys-reset"() { state.settings.hotkeys = {}; capturing = null; $("#keyError").textContent = ""; commit(); toast("Hotkeys reset"); },
    "set-theme"(el) {
      applyTheme(el.dataset.id);
      Storage2.save(state);
      renderHelp();
      toast("Theme: " + (THEMES.find(t => t.id === state.settings.theme) || {}).name);
    },
  });

  document.addEventListener("keydown", ev => {
    if (capturing) {                     // settings dialog: record the new key
      ev.preventDefault(); ev.stopPropagation();
      if (ev.key === "Escape") { capturing = null; renderHelp(); return; }
      if (["Shift", "Control", "Alt", "Meta"].includes(ev.key)) return;
      const err = bindKey(capturing, normKey(ev.key));
      $("#keyError").textContent = err;
      if (!err) capturing = null;
      renderHelp();
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target;
    if (t.closest && t.closest("input[type=text], textarea, select, [contenteditable]")) {
      if (ev.key === "Escape") t.blur();  // Esc leaves the field so hotkeys work again
      return;
    }
    if (ev.key === "Escape") { $("#help").setAttribute("hidden", ""); $("#settings").setAttribute("hidden", ""); return; }
    const b = bindings(), key = normKey(ev.key);
    const def = HOTKEY_DEFS.find(([id]) => b[id] === key);
    if (!def) return;
    // Space/Enter on a focused button should click that button, not trigger a hotkey.
    if ((ev.key === " " || ev.key === "Enter") && t.tagName === "BUTTON") return;
    ev.preventDefault();
    def[3]();
  }, true);

  // Keep timers correct when coming back from a background tab / other monitor.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  // Another tab changed the save: reload it instead of overwriting it later.
  window.addEventListener("storage", ev => { if (ev.key === Storage2.KEY) { state = Storage2.load(); render(); } });

  /* ---------- Auto-split wiring ---------- */
  AutoSplit.init({
    onStatus(st) {
      asStatus = st;
      document.querySelectorAll("[data-as-pill]").forEach(el => { el.innerHTML = statusPill(); });
    },
    onZone(ev) {
      const c = char(), m = AutoSplit.match(c, ev);
      const where = ev.name || ev.area;
      lastAuto = `Last: ${where} → ${m.action}${m.reason ? " (" + m.reason + ")" : ""}`;
      if (m.action === "start") { Run.startZone(c, Run.current(c).zone.id); commit(); toast(`Run started: ${where}`); }
      else if (m.action === "split") {
        const res = Run.split(c, { to: m.to, start: true });
        commit(); scrollToCurrent();
        if (res === "finished") toast("Run finished");
      } else if (m.action === "finish") doSplit();
      else document.querySelectorAll("[data-as-last]").forEach(el => { el.textContent = lastAuto; });
    },
    onHotkey(action) {
      const map = { split: doSplit, undo: actions.undo, pause: actions.pause, newrun: doNewRun };
      const fn = map[String(action).toLowerCase().replace(/[^a-z]/g, "")];
      if (fn) fn();
    },
  });
  if (state.settings.autoSplit.enabled) AutoSplit.connect(state.settings.autoSplit.url);
  applyTheme(state.settings.theme || "ember");

  render();
  scrollToCurrent(false);
  setInterval(tick, 250);
})();
