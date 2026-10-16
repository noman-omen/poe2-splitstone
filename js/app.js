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
  const cssEsc = s => (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
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

  /** In-app modal for confirm/prompt. Electron has no window.prompt. */
  function openModal(message, { input = null, okLabel = "OK", cancelLabel = "Cancel" } = {}) {
    return new Promise(resolve => {
      const dlg = $("#appModal"), inp = $("#appModalInput"), form = $("#appModalForm");
      $("#appModalMsg").textContent = message;
      $("#appModalOk").textContent = okLabel;
      $("#appModalCancel").textContent = cancelLabel;
      inp.hidden = input === null;
      inp.value = input === null ? "" : String(input);
      const done = v => { form.onsubmit = null; dlg.oncancel = null; if (dlg.open) dlg.close(); resolve(v); };
      form.onsubmit = ev => {
        ev.preventDefault();
        const ok = ev.submitter && ev.submitter.value === "ok";
        done(input === null ? ok : (ok ? inp.value : null));
      };
      dlg.oncancel = ev => { ev.preventDefault(); done(input === null ? false : null); };
      // Desktop: bring the window in front of the game before asking.
      if (window.splitstoneDesktop && window.splitstoneDesktop.focusMain) window.splitstoneDesktop.focusMain();
      dlg.showModal();
      if (input === null) $("#appModalOk").focus(); else { inp.focus(); inp.select(); }
    });
  }
  const askConfirm = (message, opts) => openModal(message, Object.assign({}, opts, { input: null }));
  const askPrompt = (message, def = "") => openModal(message, { input: def == null ? "" : def });


  /** Sidebar/campaign Δ vs PB at the same split point (not full PB vs partial Now). */
  function segDeltaVsPb(c, kind, id, now) {
    if (kind === "total") return Run.deltaVsPb(c, now);
    if (kind === "group") return Run.deltaVsPbIn(c, o => o.group === id, now);
    if (kind === "section") return Run.deltaVsPbIn(c, o => o.section.id === id, now);
    return null;
  }

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
  /** Steps visible under the character's route variant (+ custom hide). */
  const currentCustom = c => Run.getCustom(c, Run.route(c).customId);
  const visibleSteps = (c, zone) => {
    const r = Run.route(c), custom = currentCustom(c);
    const rVis = custom && custom.baseMode ? Object.assign({}, r, { mode: custom.baseMode }) : r;
    return zone.steps.filter(s => Run.stepVisible(s, rVis, custom));
  };
  const allSteps = c => Run.order(c).flatMap(o => visibleSteps(c, o.zone));

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
    document.body.classList.toggle("practice-mode", !!Run.route(char()).practice);
    document.body.classList.toggle("custom-route", !!Run.route(char()).customId);
    $("#hideHints").checked = !!s.hideHints;
    $("#hideExtra").checked = !!s.hideExtra;
    $("#focusMode").checked = !!s.focusMode;
    $("#meta").textContent = `Patch ${DATA.meta.patch} · ${DATA.meta.league}`;
    $("#charSelect").innerHTML = Object.values(state.characters)
      .sort((a, b) => a.created.localeCompare(b.created))
      .map(x => `<option value="${esc(x.id)}"${x.id === c.id ? " selected" : ""}>${esc(x.name)}</option>`).join("");
    renderNow(); renderTotals(); renderHistory(); renderCharacter(); renderCampaign();
    renderHelp();
    renderViews();
    layoutSticky();
    if (state.settings.focusMode) _layoutStickySoon();
    pushOverlay();
  }

  /** The top bar wraps on narrow screens, so sticky offsets are measured, not hard-coded. */
  function layoutSticky() {
    const top = $(".topbar"), now = $("#now");
    if (!top || !now) return;
    const root = document.documentElement.style;
    const topH = getComputedStyle(top).position === "sticky" ? top.offsetHeight : 0;
    now.style.top = topH + "px";
    // Measure after density classes apply (focus mode shrinks the now bar).
    root.setProperty("--sticky-top", topH + now.offsetHeight + 12 + "px");
  }
  window.addEventListener("resize", () => layoutSticky());
  // Recalc after fonts/layout settle when focus mode toggles.
  const _layoutStickySoon = () => requestAnimationFrame(() => requestAnimationFrame(layoutSticky));

  /** Big current-step block: objective, hints (unless hidden) and key route info (unless hidden). */
  function nowStepHTML(c, s) {
    if (!s) return "";
    const hints = stepHints(c, s), info = [];
    if (s.rewards.length) info.push(s.rewards.map(r => `<span class="reward${r.must ? " must" : ""}">${r.must ? "★ " : ""}${esc(r.label)}</span>`).join(""));
    if (s.waypoint) info.push(`<span class="k">Waypoint</span> ${esc(s.waypoint === true ? "Yes" : s.waypoint)}`);
    if (s.skip.length) info.push(`<span class="k">Skip</span> ${esc(s.skip.join("; "))}`);
    if (s.warning) info.push(`<span class="warn">⚠ ${esc(s.warning)}</span>`);
    const more = hints.length > 1 ? hints.length - 1 : 0;
    return `<div class="now-step">
      <label class="now-objective"><input type="checkbox" data-action="step" data-id="${esc(s.id)}"${c.done[s.id] ? " checked" : ""}>
        <span>${esc(s.objective)}${s.level ? ` <span class="lvl">lvl ${esc(s.level)}</span>` : ""}${s.optional ? ' <span class="optional">optional</span>' : ""}</span></label>
      ${hints.length ? `<ul class="now-hints"><li>${esc(hints[0])}</li></ul>
        ${more ? `<details class="now-more-tips"><summary>+${more} more tip${more > 1 ? "s" : ""}</summary>
          <ul class="now-hints">${hints.slice(1).map(h => `<li>${esc(h)}</li>`).join("")}</ul></details>` : ""}` : ""}
      ${(() => { const cr = currentCustom(c); return cr && cr.notes && cr.notes[s.id]
        ? `<div class="custom-note now-custom">${esc(cr.notes[s.id])}</div>` : ""; })()}
      ${info.length ? `<div class="now-info">${info.map(x => `<div>${x}</div>`).join("")}</div>` : ""}
    </div>`;
  }


  /** Snapshot for the helper overlay (POST /state). Keep it tiny and stable. */
  function buildOverlayState() {
    const c = char(), cur = Run.current(c);
    const ov = (state.settings && state.settings.overlay) || { opacity: 0.8, clickThrough: true };
    const showTip = !(state.settings && state.settings.hideHints);
    if (!cur) {
      const last = c.history[0];
      return {
        v: 1,
        step: last ? `Finished · ${Timers.format(last.total)}` : "Campaign complete",
        tip: "", nextStep: "", showTip: false,
        opacity: ov.opacity,
      };
    }
    const z = cur.zone;
    const vis = visibleSteps(c, z), todo = vis.filter(st => !c.done[st.id]);
    const step = todo[0] || vis[vis.length - 1];
    const next = Run.order(c)[cur.index + 1];
    const nextVis = next ? visibleSteps(c, next.zone) : [];
    const nextStep = todo[1] || nextVis[0];
    const tips = step ? stepHints(c, step) : [];
    return {
      v: 1,
      step: step ? step.objective : "",
      tip: showTip ? (tips[0] || "").slice(0, 100) : "",
      nextStep: nextStep ? nextStep.objective : "",
      showTip,
      opacity: ov.opacity,
    };
  }

  const autoSplitOpts = () => ({ token: state.settings.autoSplit.token || "" });
  function pushOverlay() {
    if (window.splitstoneDesktop && window.splitstoneDesktop.isDesktop) {
      AutoSplit.pushState(buildOverlayState());
      return;
    }
    if (AutoSplit.status().state === "off") return;
    AutoSplit.pushState(buildOverlayState(), state.settings.autoSplit.url, autoSplitOpts());
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
        <button class="primary" data-action="new-run">New run <kbd>${esc(keyName(bindings().newRun))}</kbd></button>
        ${Run.route(c).practice ? `<button data-action="practice-exit">Exit practice</button>` : ""}</div>`;
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
        <div class="now-where"><span data-as-pill>${statusPill()}</span> ${(() => {
          const r = Run.route(c);
          const bits = [];
          if (r.practice) bits.push(`<span class="practice-pill" title="Practice PB is separate from full-campaign PB">Practice · ${esc(Run.practiceLabel(r.practice.kind, r.practice.id))}</span>`);
          const cr = currentCustom(c);
          if (cr) bits.push(`<span class="custom-pill" title="Custom route — PB is separate per variant">${esc(cr.name)}</span>`);
          return bits.length ? bits.join(" · ") + " · " : "";
        })()}${esc(cur.section.name)} · zone ${cur.index >= 0 ? cur.index + 1 : "–"}/${Run.order(c).length}${paused ? ' · <span class="behind">PAUSED</span>' : ""}</div>
        <div class="now-zone">${esc(z.name)}</div>
        ${(() => {
          const info = Levels.zoneLevelInfo(z), st = Levels.status(Levels.charLevel(c), info);
          if (!info) return "";
          if (!st) return `<div class="now-lvl muted small lvl-cue">Route lvl ${esc(info.label)}</div>`;
          if (st.kind === "ok") return `<div class="now-lvl muted small lvl-cue" title="${esc(st.detail)}">${esc(st.text)}</div>`;
          return `<div class="now-lvl lvl-cue ${st.kind}" title="${esc(st.detail)}">${esc(st.text)}</div>`;
        })()}
        ${step ? gearNowHTML(c.classId, step.id) : ""}
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
    const row = (label, kind, id, ms, pbMs, bestMs, cls = "") => {
      const d = segDeltaVsPb(c, kind, id);
      const dCls = d === null ? "" : deltaClass(d);
      return `<tr class="${cls}"><th>${esc(label)}</th>
        <td class="${dCls}">${sumTimer(kind, id, ms)}</td>
        <td class="mono ${d === null ? "muted" : dCls}" data-seg-delta="${kind}:${esc(id)}">${d !== null ? fmtDelta(d) : "–"}</td>
        <td class="muted">${pbMs ? fmt(pbMs) : "–"}</td>
        <td class="muted">${bestMs ? fmt(bestMs) : "–"}</td></tr>`;
    };
    const prac = Run.route(c).practice;
    const scopeGroups = new Set(Run.order(c).map(o => o.group));
    const scopeSecs = new Set(Run.order(c).map(o => o.section.id));
    const rows = [];
    DATA.groups.filter(g => !prac || scopeGroups.has(g.id)).forEach(g => {
      const secs = DATA.sections.filter(s => s.group === g.id && (!prac || scopeSecs.has(s.id)));
      rows.push(row(g.name, "group", g.id, Run.groupMs(c, g.id), p && p.groups[g.id], bests["group:" + g.id], "grp"));
      if (secs.length > 1) secs.forEach(s =>
        rows.push(row("└ " + s.name.replace(/^.*· /, ""), "section", s.id, Run.sectionMs(c, s.id), p && p.sections[s.id], bests["section:" + s.id], "sub")));
    });
    const actsMs = DATA.groups.filter(g => g.kind === "act" && (!prac || scopeGroups.has(g.id))).reduce((a, g) => a + Run.groupMs(c, g.id), 0);
    const intMs = DATA.groups.filter(g => g.kind === "interlude" && (!prac || scopeGroups.has(g.id))).reduce((a, g) => a + Run.groupMs(c, g.id), 0);
    const sob = Run.sumOfBest(c);
    const campD = p ? Run.deltaVsPb(c) : null;
    const grandLabel = prac ? ("Practice · " + Run.practiceLabel(prac.kind, prac.id)) : "Campaign";
    $("#totals").innerHTML = `<h2>Run &amp; segments${prac ? " <span class=\"practice-pill\">practice</span>" : ""}</h2>
      <div>${done} / ${steps.length} steps · ${Run.order(c).filter(o => c.split[o.zone.id]).length}/${Run.order(c).length} zones split${prac ? " · <span class=\"muted\">full-campaign PB untouched</span>" : ""}</div>
      <div class="progress"><div style="width:${(100 * done / Math.max(1, steps.length)).toFixed(1)}%"></div></div>
      <table class="seg"><thead><tr><th></th><th>Now</th><th>Δ</th><th>PB</th><th>Best</th></tr></thead><tbody>
      ${rows.join("")}
      ${prac ? "" : `<tr class="sum"><th>Acts</th><td><span class="timer" data-sum="acts:">${fmt(actsMs)}</span></td><td></td><td></td><td></td></tr>
      <tr class="sum"><th>Interludes</th><td><span class="timer" data-sum="interludes:">${fmt(intMs)}</span></td><td></td><td></td><td></td></tr>`}
      <tr class="grand"><th>${esc(grandLabel)}</th><td>${sumTimer("total", "", Run.totalMs(c))}</td>
        <td class="mono ${campD === null ? "muted" : deltaClass(campD)}" data-seg-delta="total:">${campD !== null ? fmtDelta(campD) : "–"}</td>
        <td>${p ? fmt(p.total) : "–"}</td><td>${sob ? fmt(sob) : "–"}</td></tr>
      </tbody></table>
      <div class="muted small">Best = best segment ever (gold) for this route/practice variant.${prac ? " Practice PBs do not replace the full-campaign PB." : " Campaign best = sum of best zones."}</div>`;
  }

  /** Sidebar + analytics: All / Campaign / Practice (default Campaign). */
  let historyFilter = "campaign";
  const isPracticeRun = h => !!(h && (h.practice || String(h.variant || "").includes("+p:")));
  function filteredHistory(c) {
    const all = c.history || [];
    if (historyFilter === "all") return all;
    if (historyFilter === "practice") return all.filter(isPracticeRun);
    return all.filter(h => !isPracticeRun(h));
  }
  const pbFromRuns = runs => (runs || []).filter(h => h.complete)
    .reduce((best, h) => (!best || h.total < best.total ? h : best), null);

  function renderHistory() {
    const c = char();
    const filtered = filteredHistory(c);
    const runs = filtered.slice(0, 15);
    const p = pbFromRuns(filtered);
    const pbOf = h => pbFromRuns(filtered.filter(x => (x.variant || "normal") === (h.variant || "normal")));
    const filterSel = `<label class="hist-filter">Show <select id="historyFilter">
      <option value="campaign"${historyFilter === "campaign" ? " selected" : ""}>Campaign</option>
      <option value="practice"${historyFilter === "practice" ? " selected" : ""}>Practice</option>
      <option value="all"${historyFilter === "all" ? " selected" : ""}>All</option>
    </select></label>`;
    $("#history").innerHTML = `<h2>Run history</h2>
      ${filterSel}
      <div class="muted small">${historyFilter === "all" ? "All variants" : historyFilter === "practice" ? "Practice runs only" : "Campaign runs (no practice)"} · ${esc(Run.variantLabel(Run.variantKey(Run.route(c))))}</div>
      ${p ? `<div class="pb">PB <b class="mono">${fmt(p.total)}</b> <span class="muted">${new Date(p.finished).toLocaleDateString()}</span></div>` : '<div class="muted">No completed run in this filter.</div>'}
      ${runs.length ? `<ol class="runs">${runs.map(h => { const hp = pbOf(h); return `<li class="${hp && h.id === hp.id ? "is-pb" : ""}" title="${esc(Run.variantLabel(h.variant || "normal"))}">
        <span class="mono">${fmt(h.total)}</span>
        <span class="muted">${isPracticeRun(h) ? "◎ " : ""}${(h.variant || "normal").startsWith("fast") ? "⚡" : ""}${h.complete ? (hp && h.id !== hp.id ? `<span class="behind">${fmtDelta(h.total - hp.total)}</span>` : "PB") : `reset ${h.splitsDone}/${h.zonesTotal}`}</span>
        <span class="muted small">${new Date(h.finished).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
        <button class="icon danger" data-action="run-delete" data-id="${esc(h.id)}" title="Delete run" aria-label="Delete run">✕</button></li>`; }).join("")}</ol>` : `<div class="empty">No runs in this filter.</div>`}
      <div class="row"><a href="#stats" class="small">📈 Run analytics &amp; CSV</a></div>
      ${filtered.length > runs.length ? `<div class="muted small">+${filtered.length - runs.length} older in this filter</div>` : ""}`;
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
      </div>
      <div class="char-level"><label for="charLevel">Level</label>
        <input type="number" id="charLevel" min="1" max="100" step="1"
          value="${c.level != null ? esc(c.level) : ""}" placeholder="${b && b.level ? esc(b.level) : "–"}"
          title="Manual level for XP warnings. Leave blank to use PoB level.">
        <span class="muted small">${(() => {
          const eff = Levels.charLevel(c);
          const w = eff && Levels.xpWindow(eff);
          if (!eff) return "Set a level (or import PoB) for zone XP warnings.";
          const src = c.level != null ? "manual" : "PoB";
          return `Using ${eff} (${src})${w != null ? ` · XP window ±${w}` : ""}`;
        })()}</span>
      </div>`;
    if (b) {
      html += `<dl class="kv">
        <dt>Class</dt><dd>${esc(b.className)}</dd>
        <dt>Ascendancy</dt><dd>${esc(b.ascendancy || "None")}</dd>
        <dt>PoB level</dt><dd>${esc(b.level)}</dd>
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

  function gearCueHTML(classId, zone) {
    const items = (typeof Gear !== "undefined" ? Gear.forZone(classId, zone) : []).slice(0, 4);
    if (!items.length) return "";
    return `<span class="gear-cues">${items.map(n =>
      `<span class="gear-cue${n.uncertain ? " uncertain" : ""}" data-kind="${esc(n.kind)}" title="${esc(n.text)}${n.uncertain ? " (uncertain)" : ""}">${Gear.icon(n.kind)} ${esc(n.short)}</span>`
    ).join("")}</span>`;
  }
  function gearNowHTML(classId, stepId) {
    const items = typeof Gear !== "undefined" ? Gear.forStep(classId, stepId) : [];
    if (!items.length) return "";
    return `<div class="now-gear gear-cues">${items.map(n =>
      `<span class="gear-cue${n.uncertain ? " uncertain" : ""}" data-kind="${esc(n.kind)}" title="${esc(n.text)}${n.uncertain ? " (uncertain)" : ""}">${Gear.icon(n.kind)} ${esc(n.short)}</span>`
    ).join("")}</div>`;
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
      ${(() => { const cr = currentCustom(c); return cr && cr.notes && cr.notes[s.id]
        ? `<div class="custom-note">${esc(cr.notes[s.id])}</div>` : ""; })()}
      ${extra.length ? `<ul class="extra">${extra.join("")}</ul>` : ""}
    </div>`;
  }

  function zoneHTML(z, c, cur) {
    const p = Run.pb(c), isSplit = !!c.split[z.id], isCur = cur && cur.zone.id === z.id;
    const ms = Run.zoneMs(c, z.id), pbSeg = p && p.zones[z.id];
    const delta = isSplit && pbSeg ? ms - pbSeg : null;
    const zLvl = Levels.zoneLevelInfo(z), zStat = Levels.status(Levels.charLevel(c), zLvl);
    const lvlCue = zLvl ? `<span class="zone-lvl${zStat && zStat.kind !== "ok" ? " " + zStat.kind : ""}${zLvl.uncertain ? " uncertain" : ""}" title="${esc((zStat && zStat.detail) || ("Route level " + zLvl.label))}">${zStat && zStat.kind !== "ok" ? esc(zStat.text) : "lvl " + esc(zLvl.label)}</span>` : "";
    const gearCue = gearCueHTML(c.classId, z);
    return `<div class="zone${isSplit ? " complete" : ""}${isCur ? " current" : ""}${zStat && zStat.kind === "bad" ? " underlevel" : ""}" data-zone="${esc(z.id)}" id="zone-${esc(z.id)}">
      <div class="zone-head"><h3>${isSplit ? "✓ " : isCur ? "▶ " : ""}${esc(z.name)}</h3>
        ${lvlCue}${gearCue}
        ${!Run.route(c).practice ? `<button type="button" class="practice-btn tiny" data-action="practice-zone" data-id="${esc(z.id)}" title="Practice this zone only">Practice</button>` : ""}
        ${c.golds[z.id] ? '<span class="gold" title="Best segment ever">★ gold</span>' : ""}
        ${delta !== null ? `<span class="delta ${deltaClass(delta)}" title="vs PB segment ${fmt(pbSeg)}">${fmtDelta(delta)}</span>`
          : pbSeg ? `<span class="muted small" title="PB segment">PB ${fmt(pbSeg)}</span>` : ""}
        ${timerWidget("zone:" + z.id, z.name)}</div>
      ${visibleSteps(c, z).map(s => stepHTML(s, c)).join("")}</div>`;
  }

  function renderCampaign() {
    const c = char(), cur = Run.current(c);
    const r = Run.route(c);
    const inScopeSec = sec => {
      if (!r.practice) return true;
      if (r.practice.kind === "group") return sec.group === r.practice.id;
      if (r.practice.kind === "section") return sec.id === r.practice.id;
      if (r.practice.kind === "zone") return sec.zones.some(z => z.id === r.practice.id);
      return true;
    };
    const sections = DATA.sections.filter(inScopeSec).map(sec => {
      const custom = currentCustom(c);
      const rVis = custom && custom.baseMode ? Object.assign({}, r, { mode: custom.baseMode }) : r;
      let zones = sec.zones.filter(z => Run.zoneActive(z, rVis, custom) && Run.matchesPractice({ zone: z, section: sec, group: sec.group }, r.practice));
      // Respect custom zoneOrder within the section.
      if (custom && custom.zoneOrder && custom.zoneOrder.length) {
        const rank = id => { const i = custom.zoneOrder.indexOf(id); return i < 0 ? 9999 : i; };
        zones = zones.slice().sort((a, b) => rank(a.id) - rank(b.id));
      }
      const steps = zones.flatMap(z => visibleSteps(c, z)), done = steps.filter(s => c.done[s.id]).length;
      const isCur = cur && cur.section.id === sec.id;
      const isCollapsed = collapsed.has(sec.id);
      const canPracticeAct = !r.practice;
      return `<section class="section practice-scope${isCollapsed ? " collapsed" : ""}${isCur ? " current" : ""}" data-section="${esc(sec.id)}">
        <header>
          <button class="collapse" data-action="collapse" data-id="${esc(sec.id)}" aria-expanded="${!isCollapsed}"
            aria-label="Toggle ${esc(sec.name)}">${isCollapsed ? "▸" : "▾"}</button>
          <h2>${esc(sec.name)}<small>${esc(sec.region || "")}${sec.levels ? " · lvl " + esc(sec.levels) : ""}</small></h2>
          <span class="badge">${done}/${steps.length}</span>
          ${canPracticeAct ? `<button type="button" class="practice-btn" data-action="practice-group" data-id="${esc(sec.group)}" title="Practice this act / interlude">Practice</button>` : ""}
          <span class="tw">${sumTimer("section", sec.id, Run.sectionMs(c, sec.id))}</span>
        </header>
        <div class="zones">${zones.map(z => zoneHTML(z, c, cur)).join("")}</div></section>`;
    }).join("");


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
      ${practiceSelectHTML(c)}
      ${customSelectHTML(c)}
      <span class="muted small">${(() => {
        const bits = [];
        if (r.practice) bits.push(`Practice · ${esc(Run.practiceLabel(r.practice.kind, r.practice.id))}`);
        const cr = currentCustom(c);
        if (cr) bits.push(`Custom · ${esc(cr.name)}`);
        bits.push(esc(v.desc || ""));
        bits.push(`${Run.order(c).length} zones, ${allSteps(c).length} steps`);
        return bits.join(" · ");
      })()}</span>
      ${r.practice ? `<button type="button" data-action="practice-exit" class="practice-exit">Exit practice</button>` : ""}
      ${r.customId ? `<button type="button" data-action="custom-clear" class="custom-exit">Default route</button>` : ""}
      ${customEditorHTML(c)}
      <span class="as-controls">
        ${window.splitstoneDesktop ? `
          <span class="muted small">Auto-split + overlay on</span>
          <span data-as-pill>${statusPill()}</span>
          <button type="button" data-action="desktop-browse" title="Pick Client.txt">Client.txt…</button>
          <label class="switch" title="Always-on-top overlay (click-through)">
            <input type="checkbox" id="desktopOverlay" checked> Overlay</label>
          <label class="switch desktop-only" title="When on, Splitstone checks GitHub for a newer installer on launch and can download it for you. Turn off if you prefer to update by hand.">
            <input type="checkbox" id="desktopAutoUpdate"${(window.__desktopAutoUpdate !== false) ? " checked" : ""}> Auto-update</label>
        ` : `
        <label class="switch" title="Split automatically when you enter the next zone (reads Client.txt via the helper)">
          <input type="checkbox" id="autoSplit"${state.settings.autoSplit.enabled ? " checked" : ""}> Auto-split</label>
        <span data-as-pill>${statusPill()}</span>
        ${AutoSplit.canWatchFile() ? `<button data-action="watch-file" title="No helper: pick Client.txt and keep this tab open">Watch Client.txt…</button>` : ""}
        `}
        <span class="muted small" data-as-last>${esc(lastAuto)}</span>
      </span>
      <details class="as-settings" data-keep="as-settings"${openDetails.has("as-settings") ? " open" : ""}><summary>Auto-split settings</summary>
        <label>Helper URL <input type="text" id="autoSplitUrl" value="${esc(state.settings.autoSplit.url)}" size="28"
          placeholder="http://127.0.0.1:8766" title="http://127.0.0.1, localhost, or [::1] only — no ?query or #hash"></label>
        <label>Helper token <input type="password" id="autoSplitToken" value="${esc(state.settings.autoSplit.token || "")}" size="20"
          placeholder="optional" autocomplete="off"
          title="Required when the helper was started with --token. Sent as X-Splitstone-Token on fetch; ?token= on SSE only."></label>
        <span class="muted small">Run <code>helper/splitstone_helper.py --overlay</code> on the gaming PC. If you pass <code>--token</code>, paste the same value here (header on POST; query only for EventSource).</span>
      </details>
      ${v.tips && v.tips.length ? `<details class="tips" data-keep="tips"${openDetails.has("tips") ? " open" : ""}><summary>Speedrun tips (${v.tips.length})</summary><ul>${v.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul></details>` : ""}
    </section>`;
    $("#campaign").innerHTML = routeBar + sections + statsHTML(c);
  }

  /* ---------- Endgame view: map runs, sessions, atlas ---------- */
  const EG = () => char().endgame;
  const tierLabel = t => (t ? `T${t}` : "");
  const perHour = v => (v === null ? "–" : v.toFixed(1));
  let egShowSession = null; // UI-only: session id whose runs are listed (null = current/latest)

  function endgameHTML(c) {
    const eg = c.endgame, now = Date.now(), a = eg.active;
    const cur = Endgame.currentSession(eg);
    const shownId = egShowSession || (cur ? cur.id : (eg.sessions[0] && eg.sessions[0].id));
    const ss = shownId ? Endgame.sessionStats(eg, shownId, now) : null;
    const all = Endgame.stats(eg.runs);
    const pm = Endgame.perMap(eg.runs);
    const names = [...new Set(eg.runs.map(r => r.map))].slice(0, 200);
    const card = (label, v) => `<div class="stat"><div class="muted small">${label}</div><div class="mono">${v}</div></div>`;
    const statCards = st => st ? `<div class="stat-cards">${card("Maps", `${st.completed}/${st.maps}`)}${card("Maps / hour", perHour(st.mapsPerHour))}
      ${card("Average", st.avgMs === null ? "–" : fmt(st.avgMs))}${card("Total in maps", fmt(st.totalMs))}${card("Deaths", st.deaths)}</div>` : "";

    const activeBlock = a ? `<div class="eg-active${Endgame.isRunning(eg) ? " running" : ""}">
        <div class="eg-active-head"><strong>${esc(a.map)}</strong> ${a.tier ? `<span class="badge">${tierLabel(a.tier)}</span>` : ""}
          ${a.auto ? `<span class="muted small">auto</span>` : ""}
          <span class="timer big mono" data-eg-timer>${fmt(Endgame.activeMs(eg, now))}</span></div>
        <div class="eg-active-actions">
          <button class="primary" data-action="eg-toggle">${Endgame.isRunning(eg) ? "Pause" : "Resume"}</button>
          <button data-action="eg-death">Death (${a.deaths})</button>
          <button class="primary" data-action="eg-finish" data-completed="1">Completed</button>
          <button data-action="eg-finish" data-completed="0">Failed / abandoned</button>
          <button class="danger" data-action="eg-discard">Discard</button>
        </div>
        <div class="eg-fields">
          <label>Waystone mods <input type="text" data-eg-field="mods" value="${esc(a.mods)}" maxlength="300" placeholder="optional"></label>
          <label>Loot highlights <input type="text" data-eg-field="loot" value="${esc(a.loot)}" maxlength="300" placeholder="optional"></label>
          <label>Notes <input type="text" data-eg-field="notes" value="${esc(a.notes)}" maxlength="500" placeholder="optional"></label>
        </div></div>`
      : `<form class="eg-start" data-form="eg-start">
          <input type="text" id="egMap" list="egMapNames" placeholder="Map name, e.g. Burial Bog" maxlength="80" required aria-label="Map name">
          <datalist id="egMapNames">${names.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
          <input type="number" id="egTier" min="1" max="20" placeholder="Tier" aria-label="Waystone tier">
          <input type="text" id="egMods" maxlength="300" placeholder="Waystone mods (optional)" aria-label="Waystone mods">
          <button class="primary" type="submit">Start map</button></form>`;

    const runs = shownId ? eg.runs.filter(r => r.sessionId === shownId) : eg.runs;
    const runList = runs.length ? `<ol class="runs eg-runs">${runs.slice(0, 50).map(r => {
        const st = pm[r.map.toLowerCase()], isPb = r.completed && st && st.runs > 1 && st.pb === r.ms;
        return `<li class="${r.completed ? "" : "abandoned"}${isPb ? " is-pb" : ""}">
          <span class="mono">${fmt(r.ms)}</span>
          <span>${esc(r.map)} ${r.tier ? `<span class="muted">${tierLabel(r.tier)}</span>` : ""}${isPb ? " · PB" : ""}${r.completed ? "" : " · failed"}${r.deaths ? ` · ${r.deaths} death${r.deaths > 1 ? "s" : ""}` : ""}
            ${r.loot ? `<br><span class="small">${esc(r.loot)}</span>` : ""}${r.mods ? `<br><span class="muted small">${esc(r.mods)}</span>` : ""}${r.notes ? `<br><span class="muted small">${esc(r.notes)}</span>` : ""}</span>
          <button class="icon" data-action="eg-run-complete" data-id="${esc(r.id)}" title="Toggle completed" aria-label="Toggle completed">${r.completed ? "✓" : "○"}</button>
          <button class="icon danger" data-action="eg-run-delete" data-id="${esc(r.id)}" aria-label="Delete map run">✕</button></li>`;
      }).join("")}</ol>` : `<div class="empty">No map runs in this session yet.</div>`;

    const sessOpts = eg.sessions.slice(0, 50).map(s => {
      const st = Endgame.sessionStats(eg, s.id, now);
      const when = new Date(s.started).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
      return `<option value="${esc(s.id)}"${s.id === shownId ? " selected" : ""}>${esc(when)}${s.ended ? "" : " (open)"} · ${st.completed} maps</option>`;
    }).join("");

    const groups = ENDGAME.groups.map(g => {
      const ms = ENDGAME.milestones.filter(m => m.group === g.id);
      return `<div class="eg-atlas-group"><h3>${esc(g.name)}</h3>${ms.map(m => `<label class="step${eg.atlas[m.id] ? " done" : ""}">
          <input type="checkbox" data-eg-milestone="${esc(m.id)}"${eg.atlas[m.id] ? " checked" : ""}>
          <span>${esc(m.name)}${m.verified ? "" : ` <abbr class="unverified" title="From community guides; not yet confirmed in patch notes or poe2db">?</abbr>`}</span></label>`).join("")}</div>`;
    }).join("");
    const prog = Endgame.atlasProgress(eg, ENDGAME.milestones);

    return `<div class="eg-grid">
      <section class="card eg-maps"><header class="card-head"><h2>Map runs</h2>
          <span class="muted small">${cur ? "Session open" : "No open session"}</span>
          ${cur ? `<button data-action="eg-session-end">End session</button>` : `<button data-action="eg-session-start">Start session</button>`}
          <label class="switch desktop-only" title="Start, pause and finish map runs from Client.txt zone changes"><input type="checkbox" id="egAutoDetect"${state.settings.endgameAutoDetect ? " checked" : ""}> Auto-detect maps</label>
        </header>
        ${activeBlock}
        <div class="eg-session-bar"><label>Session <select id="egSession">${sessOpts || `<option value="">none yet</option>`}</select></label>
          <button data-action="eg-csv"${eg.runs.length ? "" : " disabled"}>Maps CSV</button></div>
        ${statCards(ss)}
        ${runList}
        <h3>All time</h3>${statCards(all)}
      </section>
      <section class="card eg-atlas"><header class="card-head"><h2>Atlas progress</h2><span class="badge">${prog.done}/${prog.total}</span></header>
        <p class="muted small">Patch ${esc(ENDGAME.patch)} data, checked ${esc(ENDGAME.checked)}. Items marked ? are from community guides only.</p>
        ${groups}
      </section></div>`;
  }

  function toolsHTML() {
    return `<section class="card"><header class="card-head"><h2>PoE2 tools</h2></header>
      <p class="muted small">Community sites, opened in your browser. Not affiliated with Splitstone.</p>
      <div class="tools-grid">${TOOLS.map(t => `<a class="tool" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer" data-tool-url="${esc(t.url)}">
        <strong>${esc(t.name)}</strong><span class="muted small">${esc(t.desc)}</span><span class="tool-host small">${esc(new URL(t.url).host)}</span></a>`).join("")}</div></section>`;
  }

  function renderViews() {
    const v = state.settings.view || "campaign";
    $("#viewCampaign").hidden = v !== "campaign";
    $("#viewEndgame").hidden = v !== "endgame";
    $("#viewTools").hidden = v !== "tools";
    document.querySelectorAll(".views [data-view]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.view === v)));
    if (v === "endgame") {
      const f = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.egField;
      if (!f) $("#viewEndgame").innerHTML = endgameHTML(char());
    } else if (v === "tools" && !$("#viewTools").innerHTML) $("#viewTools").innerHTML = toolsHTML();
  }

  /** Client.txt zone event -> endgame auto-detect (behind the toggle). */
  function endgameZone(ev) {
    if (!state.settings.endgameAutoDetect) return;
    const r = Endgame.onZone(EG(), ev, Date.now(), { tierOffset: ENDGAME.tierOffset });
    if (r.action === "ignore") return;
    if (r.action === "start") toast(`${r.finished ? `Saved ${r.finished.map} ${fmt(r.finished.ms)}. ` : ""}Map started: ${r.run.map}`);
    commit();
  }

  /* ---------- Run analytics (history charts / trends) ---------- */
  let statSeg = null;                   // UI-only; null = pick worst avg−best group once
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
    // Charts follow the history filter (Campaign / Practice / All), chronological.
    const runs = filteredHistory(c).slice().reverse();
    const complete = runs.filter(h => h.complete);
    const p = pbFromRuns(runs);
    const route = Run.route(c);
    const sobOk = (historyFilter === "campaign" && !route.practice)
      || (historyFilter === "practice" && !!route.practice);
    const sob = sobOk ? Run.sumOfBest(c) : null;
    const totals = complete.map(h => h.total), last5 = totals.slice(-5);
    const card = (label, v) => `<div class="stat"><div class="muted small">${label}</div><div class="mono">${v}</div></div>`;
    const opts = segmentOptions(c);
    // Default the secondary chart to the group with the worst avg−best (most time to gain),
    // not a duplicate of the campaign-total chart above.
    if (statSeg === null) {
      let worst = null, worstGain = -1;
      DATA.groups.forEach(g => {
        const vals = runs.map(h => h.groups[g.id]).filter(Boolean);
        const b = Run.bestsFor(c)["group:" + g.id];
        if (b && vals.length >= 2) {
          const gain = avg(vals) - b;
          if (gain > worstGain) { worstGain = gain; worst = "group:" + g.id; }
        }
      });
      statSeg = worst || "total";
    }
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
    const filterNote = historyFilter === "all" ? "All runs" : historyFilter === "practice" ? "Practice runs" : "Campaign runs";
    return `<section class="section stats" data-section="stats" id="stats">
      <header><h2>Run analytics<small>${esc(filterNote)} · ${esc(Run.variantLabel(variant))}</small></h2>
        <button data-action="csv-runs">Runs CSV</button></header>
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
  const csvCell = v => {
    let s = String(v ?? "");
    // Neutralise spreadsheet formula injection (Excel/Sheets).
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const sec = ms => (ms ? (ms / 1000).toFixed(1) : "");
  function runsCSV(c) {
    const cols = [...DATA.groups.map(g => ["groups", g.id, g.name]), ...DATA.sections.map(s => ["sections", s.id, s.name]),
      ...Run.ALL.map(o => ["zones", o.zone.id, `${o.zone.id} ${o.zone.name}`])];
    const head = ["run_id", "character", "variant", "complete", "started", "finished", "total_s", ...cols.map(c => c[2] + " (s)")];
    const lines = filteredHistory(c).slice().reverse().map(h => [h.id, c.name, h.variant || "normal", h.complete, h.started || "", h.finished,
      sec(h.total), ...cols.map(([k, id]) => sec((h[k] || {})[id]))]);
    return [head, ...lines].map(r => r.map(csvCell).join(",")).join("\n") + "\n";
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
      if (kind === "acts" || kind === "interludes")
        ms = DATA.groups.filter(g => g.kind === (kind === "acts" ? "act" : "interlude")).reduce((a, g) => a + Run.groupMs(c, g.id, now), 0);
      else ms = sumValue(c, kind, id, now);
      el.textContent = fmt(ms);
    });
    const egT = document.querySelector("[data-eg-timer]");
    if (egT) egT.textContent = fmt(Endgame.activeMs(c.endgame, now));
    const d = $("#liveDelta");
    if (d && Run.pb(c)) { const v = Run.deltaVsPb(c, now); d.textContent = fmtDelta(v); d.className = deltaClass(v); }
    if (Run.pb(c)) {
      document.querySelectorAll("[data-seg-delta]").forEach(el => {
        const [kind, id] = el.dataset.segDelta.split(":");
        const v = segDeltaVsPb(c, kind, id, now);
        if (v === null) { el.textContent = "–"; el.className = "mono muted"; return; }
        el.textContent = fmtDelta(v);
        el.className = "mono " + deltaClass(v);
      });
    }
    if (Run.runningZone(c) || Run.isPaused(c)) pushOverlay();
  }

  function scrollToCurrent(smooth = true) {
    const cur = Run.current(char());
    const el = cur && document.querySelector("#zone-" + cssEsc(cur.zone.id));
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


  function customSelectHTML(c) {
    const r = Run.route(c);
    const routes = Object.values(c.customRoutes || {}).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const opts = ['<option value="">Default (campaign)</option>'];
    routes.forEach(cr => {
      opts.push(`<option value="${esc(cr.id)}"${r.customId === cr.id ? " selected" : ""}>${esc(cr.name || cr.id)}</option>`);
    });
    return `<label class="custom-label">Custom <select id="customRoute" title="Player-made route variant — own PB, shareable code">${opts.join("")}</select></label>
      <button type="button" data-action="custom-new" title="Create a custom route from the current campaign order">New</button>
      <button type="button" data-action="custom-import" title="Paste an SSR1 share code">Import…</button>`;
  }

  function customEditorHTML(c) {
    const cr = currentCustom(c);
    if (!cr) return "";
    const open = openDetails.has("custom-editor") ? " open" : "";
    const r = Run.route(c);
    const rVis = Object.assign({}, r, { mode: cr.baseMode || r.mode, customId: null, practice: null });
    // Editor lists zones in campaign order so users can hide / reorder / annotate.
    const rows = [];
    Run.ALL.forEach(o => {
      if (!Run.zoneActive(o.zone, rVis)) return;
      const z = o.zone;
      const zOrd = cr.zoneOrder;
      const hiddenZone = z.steps.every(s => !Run.stepVisible(s, rVis) || cr.hiddenSteps[s.id]);
      rows.push(`<div class="cr-zone" data-zid="${esc(z.id)}">
        <div class="cr-zone-head">
          <button type="button" class="cr-move" data-action="custom-zone-up" data-id="${esc(z.id)}" title="Move zone earlier">↑</button>
          <button type="button" class="cr-move" data-action="custom-zone-down" data-id="${esc(z.id)}" title="Move zone later">↓</button>
          <strong>${esc(o.section.name)} · ${esc(z.name)}</strong>
          <span class="muted small">${hiddenZone ? "all steps hidden" : ""}</span>
        </div>
        <ul class="cr-steps">${z.steps.filter(s => Run.stepVisible(s, rVis)).map(s => {
          const hid = !!cr.hiddenSteps[s.id];
          const note = cr.notes[s.id] || "";
          return `<li class="cr-step${hid ? " cr-hidden" : ""}">
            <label><input type="checkbox" data-action="custom-hide-step" data-id="${esc(s.id)}"${hid ? " checked" : ""}> Hide</label>
            <span class="cr-obj">${esc(s.objective)}</span>
            <input type="text" class="cr-note-input" data-action="custom-note" data-id="${esc(s.id)}"
              maxlength="${CustomRoute.MAX_NOTE}" placeholder="Note" value="${esc(note)}" title="Your note (no URLs)">
          </li>`;
        }).join("")}</ul>
      </div>`);
    });
    // Re-order editor rows if zoneOrder set
    let ordered = rows;
    if (cr.zoneOrder && cr.zoneOrder.length) {
      const byZ = {};
      // rebuild with sort — simpler: sort Run.ALL filtered
      const list = Run.ALL.filter(o => Run.zoneActive(o.zone, rVis));
      const rank = id => { const i = cr.zoneOrder.indexOf(id); return i < 0 ? 5000 + list.findIndex(x => x.zone.id === id) : i; };
      list.sort((a, b) => rank(a.zone.id) - rank(b.zone.id));
      ordered = list.map(o => {
        const z = o.zone;
        const hiddenZone = z.steps.every(s => !Run.stepVisible(s, rVis) || cr.hiddenSteps[s.id]);
        return `<div class="cr-zone" data-zid="${esc(z.id)}">
        <div class="cr-zone-head">
          <button type="button" class="cr-move" data-action="custom-zone-up" data-id="${esc(z.id)}" title="Move zone earlier">↑</button>
          <button type="button" class="cr-move" data-action="custom-zone-down" data-id="${esc(z.id)}" title="Move zone later">↓</button>
          <strong>${esc(o.section.name)} · ${esc(z.name)}</strong>
          <span class="muted small">${hiddenZone ? "all steps hidden" : ""}</span>
        </div>
        <ul class="cr-steps">${z.steps.filter(s => Run.stepVisible(s, rVis)).map(s => {
          const hid = !!cr.hiddenSteps[s.id];
          const note = cr.notes[s.id] || "";
          return `<li class="cr-step${hid ? " cr-hidden" : ""}">
            <label><input type="checkbox" data-action="custom-hide-step" data-id="${esc(s.id)}"${hid ? " checked" : ""}> Hide</label>
            <span class="cr-obj">${esc(s.objective)}</span>
            <input type="text" class="cr-note-input" data-action="custom-note" data-id="${esc(s.id)}"
              maxlength="${CustomRoute.MAX_NOTE}" placeholder="Note" value="${esc(note)}" title="Your note (no URLs)">
          </li>`;
        }).join("")}</ul>
      </div>`;
      });
    }
    return `<details class="custom-editor" data-keep="custom-editor"${open}><summary>Edit custom route · ${esc(cr.name)}</summary>
      <div class="cr-toolbar">
        <label>Name <input type="text" id="customName" maxlength="48" value="${esc(cr.name)}"></label>
        <label>Base <select id="customBaseMode">
          <option value="normal"${cr.baseMode !== "fast" ? " selected" : ""}>Normal</option>
          <option value="fast"${cr.baseMode === "fast" ? " selected" : ""}>Fast</option>
        </select></label>
        <button type="button" data-action="custom-export">Copy share code</button>
        <button type="button" data-action="custom-delete" class="danger">Delete</button>
      </div>
      <p class="muted small">Hide steps, reorder zones, add notes. Export is a compact <code>SSR1.…</code> code — no settings or URLs. Each custom route keeps its own PB.</p>
      <div class="cr-list">${ordered.join("")}</div>
    </details>`;
  }

  function ensureCustomRoutes(c) {
    if (!c.customRoutes || typeof c.customRoutes !== "object") c.customRoutes = {};
  }

  function touchCustom(c, id) {
    ensureCustomRoutes(c);
    const raw = c.customRoutes[id];
    if (!raw) return null;
    const cr = CustomRoute.normalise(raw);
    cr.updated = new Date().toISOString();
    c.customRoutes[id] = cr;
    Run.invalidateOrderCache();
    return cr;
  }

  async function applyCustomId(customId, { reset = true } = {}) {
    const c = char();
    const id = customId && c.customRoutes && c.customRoutes[customId] ? customId : null;
    const next = Object.assign({}, Run.route(c), { customId: id });
    if (Run.isStarted(c) && !Run.isFinished(c)) {
      if (!(await askConfirm("Switch custom route? The current run will be saved as unfinished (other PBs are untouched)."))) {
        render(); return false;
      }
      Run.finish(c, false);
    }
    c.route = next;
    if (reset) Run.newRun(c);
    Run.invalidateOrderCache();
    commit();
    const cr = id ? c.customRoutes[id] : null;
    toast(cr ? `Custom route: ${cr.name}` : "Default campaign route");
    window.scrollTo({ top: 0 });
    scrollToCurrent(false);
    return true;
  }

  function moveCustomZone(zid, dir) {
    const c = char(), id = Run.route(c).customId;
    if (!id) return;
    const cr = touchCustom(c, id);
    if (!cr) return;
    if (!cr.zoneOrder || !cr.zoneOrder.length) {
      const r = Run.route(c);
      cr.zoneOrder = Run.ALL.filter(o => Run.zoneActive(o.zone, { mode: cr.baseMode || r.mode, requiredOnly: false, practice: null }))
        .map(o => o.zone.id);
    }
    const i = cr.zoneOrder.indexOf(zid);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= cr.zoneOrder.length) return;
    const tmp = cr.zoneOrder[i]; cr.zoneOrder[i] = cr.zoneOrder[j]; cr.zoneOrder[j] = tmp;
    c.customRoutes[id] = cr;
    openDetails.add("custom-editor");
    commit();
  }

  function practiceSelectHTML(c) {
    const r = Run.route(c), cur = r.practice;
    const val = cur ? cur.kind + ":" + cur.id : "";
    const opts = ['<option value="">Full campaign</option>'];
    opts.push('<optgroup label="Acts">');
    DATA.groups.filter(g => g.kind === "act").forEach(g => {
      opts.push(`<option value="group:${esc(g.id)}"${val === "group:"+g.id ? " selected" : ""}>${esc(g.name)}</option>`);
    });
    opts.push('</optgroup><optgroup label="Interludes">');
    DATA.groups.filter(g => g.kind === "interlude").forEach(g => {
      opts.push(`<option value="group:${esc(g.id)}"${val === "group:"+g.id ? " selected" : ""}>${esc(g.name)}</option>`);
    });
    opts.push('</optgroup><optgroup label="Act parts (multi-section)">');
    DATA.sections.filter(s => DATA.sections.filter(x => x.group === s.group).length > 1).forEach(s => {
      opts.push(`<option value="section:${esc(s.id)}"${val === "section:"+s.id ? " selected" : ""}>${esc(s.name)}</option>`);
    });
    opts.push('</optgroup>');
    // Single-zone: list zones in current order of full route (ignore practice for the menu)
    const fullOrder = Run.ALL.filter(o => Run.zoneActive(o.zone, { mode: r.mode, requiredOnly: r.requiredOnly, practice: null }));
    opts.push('<optgroup label="Single zone">');
    fullOrder.forEach(o => {
      const v = "zone:" + o.zone.id;
      opts.push(`<option value="${esc(v)}"${val === v ? " selected" : ""}>${esc(o.section.name)} · ${esc(o.zone.name)}</option>`);
    });
    opts.push('</optgroup>');
    return `<label class="practice-label">Practice <select id="practiceScope" title="Practice one act, interlude, or zone — PB is kept separate from the full campaign">${opts.join("")}</select></label>`;
  }

  async function applyPractice(practice, { reset = true } = {}) {
    const c = char();
    const next = Object.assign({}, Run.route(c), { practice: Run.normalisePractice(practice) });
    if (Run.isStarted(c) && !Run.isFinished(c)) {
      if (!(await askConfirm("Switch practice scope? The current run will be saved as unfinished (full-campaign PB is untouched)."))) {
        render(); return false;
      }
      Run.finish(c, false);
    }
    c.route = next;
    if (reset) Run.newRun(c);
    commit();
    const label = next.practice
      ? Run.practiceLabel(next.practice.kind, next.practice.id)
      : "Full campaign";
    toast(next.practice ? `Practice: ${label}` : "Left practice — full campaign");
    window.scrollTo({ top: 0 });
    scrollToCurrent(false);
    return true;
  }

  async function doNewRun(opts) {
    const c = char();
    const confirmed = !!(opts && opts.confirmed); // overlay double-press already confirmed
    if (Run.isStarted(c) && !Run.isFinished(c)) {
      if (!confirmed && !(await askConfirm("Reset the current run? It will be saved in history as an unfinished attempt."))) return;
      Run.finish(c, false);
    } else if (Run.isStarted(c) && !confirmed && !(await askConfirm("Start a new run?"))) return;
    Run.newRun(c);
    commit(); window.scrollTo({ top: 0 }); toast(`New run ready. Press ${keyName(bindings().split)} to start.`);
  }

  const actions = {
    split: doSplit,
    pause() { const r = Run.togglePause(char()); if (r) { commit(); toast(r === "paused" ? "Paused" : "Resumed"); } },
    undo() { if (Run.undoSplit(char())) { commit(); toast("Split undone"); scrollToCurrent(); } },
    "new-run": doNewRun,
    "practice-exit"() { applyPractice(null); },
    "practice-group"(el) { applyPractice({ kind: "group", id: el.dataset.id }); },
    "practice-zone"(el) { applyPractice({ kind: "zone", id: el.dataset.id }); },
    "custom-clear"() { applyCustomId(null); },
    async "custom-new"() {
      const c = char();
      ensureCustomRoutes(c);
      const name = await askPrompt("Name for this custom route:", "My route");
      if (name === null) return;
      const cr = CustomRoute.blank(name || "My route");
      const r = Run.route(c);
      cr.baseMode = r.mode === "fast" ? "fast" : "normal";
      cr.zoneOrder = Run.ALL.filter(o => Run.zoneActive(o.zone, { mode: cr.baseMode, requiredOnly: false, practice: null }))
        .map(o => o.zone.id);
      c.customRoutes[cr.id] = cr;
      Run.invalidateOrderCache();
      openDetails.add("custom-editor");
      applyCustomId(cr.id, { reset: true });
    },
    async "custom-export"() {
      const c = char(), cr = currentCustom(c);
      if (!cr) return toast("No custom route selected");
      try {
        const code = await CustomRoute.encode(cr);
        await navigator.clipboard.writeText(code);
        toast("Share code copied (" + code.length + " chars)");
      } catch (e) { toast(e.message || "Could not export"); }
    },
    async "custom-import"() {
      const raw = await askPrompt("Paste an SSR1 share code:", "");
      if (raw === null || !String(raw).trim()) return;
      try {
        const cr = await CustomRoute.decode(raw);
        const c = char();
        ensureCustomRoutes(c);
        cr.id = CustomRoute.uid();
        c.customRoutes[cr.id] = cr;
        Run.invalidateOrderCache();
        openDetails.add("custom-editor");
        applyCustomId(cr.id, { reset: true });
        toast("Imported: " + cr.name);
      } catch (e) { toast(e.message || "Could not import"); }
    },
    async "custom-delete"() {
      const c = char(), id = Run.route(c).customId;
      if (!id || !c.customRoutes[id]) return;
      if (!(await askConfirm("Delete this custom route? Its PB history stays but the route definition is removed."))) return;
      delete c.customRoutes[id];
      c.route = Object.assign({}, Run.route(c), { customId: null });
      Run.invalidateOrderCache();
      Run.newRun(c);
      commit();
      toast("Custom route deleted");
    },
    "custom-hide-step"(el) {
      const c = char(), id = Run.route(c).customId;
      if (!id) return;
      const cr = touchCustom(c, id);
      if (!cr) return;
      if (el.checked) cr.hiddenSteps[el.dataset.id] = true;
      else delete cr.hiddenSteps[el.dataset.id];
      c.customRoutes[id] = cr;
      openDetails.add("custom-editor");
      commit();
    },
    "custom-zone-up"(el) { moveCustomZone(el.dataset.id, -1); },
    "custom-zone-down"(el) { moveCustomZone(el.dataset.id, 1); },
    "timer-toggle"(el) {
      const c = char(), key = el.dataset.key;
      if (key.startsWith("zone:")) {
        if (Timers.isRunning(c, key)) Timers.stop(c, key); else Run.startZone(c, key.slice(5));
      } else Timers.toggle(c, key);
      commit();
    },
    async "timer-reset"(el) {
      if (await askConfirm("Reset this timer to 0?")) { Timers.reset(char(), el.dataset.key); commit(); }
    },
    step(el) {
      const c = char(), id = el.dataset.id;
      if (el.checked) c.done[id] = true; else delete c.done[id];
      // Auto-advance: ticking the last required step of the zone being timed splits it.
      const cur = Run.current(c);
      if (el.checked && cur && Run.runningZone(c) === cur.zone.id && cur.zone.steps.some(s => s.id === id)
          && Run.requiredSteps(cur.zone, Run.route(c), currentCustom(c)).every(s => c.done[s.id])) return doSplit();
      commit();
    },
    collapse(el) {
      const id = el.dataset.id;
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      render();
    },
    view(el) { state.settings.view = el.dataset.view; commit(); window.scrollTo({ top: 0 }); },
    "eg-toggle"() { const eg = EG(), now = Date.now(); Endgame.isRunning(eg) ? Endgame.pauseMap(eg, now) : Endgame.resumeMap(eg, now); commit(); },
    "eg-death"() { Endgame.addDeath(EG(), 1); commit(); },
    "eg-finish"(el) {
      const run = Endgame.finishMap(EG(), { completed: el.dataset.completed === "1" }, Date.now());
      if (!run) return;
      const st = Endgame.perMap(EG().runs)[run.map.toLowerCase()];
      commit();
      toast(run.completed && st && st.pb === run.ms && st.runs > 1 ? `New map PB: ${run.map} ${fmt(run.ms)}` : `${run.map}: ${fmt(run.ms)}`);
    },
    async "eg-discard"() { if (await askConfirm("Discard this map run without saving it?")) { Endgame.discardMap(EG()); commit(); } },
    "eg-session-start"() { Endgame.startSession(EG(), Date.now()); egShowSession = null; commit(); },
    "eg-session-end"() { const s = Endgame.endSession(EG(), Date.now()); egShowSession = s ? s.id : null; commit(); },
    "eg-run-complete"(el) { const r = EG().runs.find(x => x.id === el.dataset.id); if (r) { r.completed = !r.completed; commit(); } },
    async "eg-run-delete"(el) {
      if (!(await askConfirm("Delete this map run?"))) return;
      EG().runs = EG().runs.filter(r => r.id !== el.dataset.id); commit();
    },
    async "run-delete"(el) {
      if (!(await askConfirm("Delete this run from history? (Best segments are kept.)"))) return;
      const c = char();
      c.history = c.history.filter(h => h.id !== el.dataset.id);
      commit();
    },
    async "char-new"() {
      const name = await askPrompt("Character name:", "New character");
      if (!name || !name.trim()) return;
      const c = Storage2.newCharacter(name.trim());
      state.characters[c.id] = c; state.activeId = c.id; pobError = "";
      commit(); toast(`Created ${c.name}`);
    },
    async "char-rename"() {
      const name = await askPrompt("Rename character:", char().name);
      if (name && name.trim()) { char().name = name.trim(); commit(); }
    },
    async "char-delete"() {
      if (Object.keys(state.characters).length === 1) return toast("You need at least one character.");
      if (!(await askConfirm(`Delete "${char().name}" and all its progress and run history?`))) return;
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
    "eg-csv"() { download(`splitstone-maps-${fileSafe(char().name)}.csv`, Endgame.toCSV(EG(), char().name), "text/csv"); },
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
    if (!el || el.dataset.action === "step" || el.dataset.action === "custom-hide-step") return;
    const fn = actions[el.dataset.action];
    if (fn) {
      const r = fn(el, ev);
      if (r && typeof r.then === "function") r.catch(e => console.warn(e));
    }
  });
  document.addEventListener("change", ev => {
    const el = ev.target;
    if (el.dataset.action === "step") actions.step(el);
    else if (el.dataset.action === "custom-hide-step") actions["custom-hide-step"](el);
    else if (["hideHints", "hideExtra", "focusMode"].includes(el.id)) { state.settings[el.id] = el.checked; commit(); }
    else if (el.id === "routeMode" || el.id === "requiredOnly") {
      (async () => {
        const c = char(), next = Object.assign({}, Run.route(c),
          el.id === "routeMode" ? { mode: el.value } : { requiredOnly: el.checked });
        if (Run.isStarted(c) && !Run.isFinished(c) &&
            !(await askConfirm("Change the route during a run? Times will be compared with that route's PB from now on."))) return render();
        const running = Run.runningZone(c);
        c.route = next;
        if (running && !Run.inOrder(c, running)) Run.stopAllZones(c);
        commit();
      })();
    }
    else if (el.id === "practiceScope") {
      const raw = el.value.trim();
      if (!raw) { applyPractice(null); return; }
      const i = raw.indexOf(":");
      const kind = raw.slice(0, i), id = raw.slice(i + 1);
      applyPractice({ kind, id });
    }
    else if (el.id === "customRoute") {
      applyCustomId(el.value.trim() || null);
    }
    else if (el.id === "customName") {
      const c = char(), id = Run.route(c).customId;
      if (!id) return;
      const cr = touchCustom(c, id);
      if (!cr) return;
      cr.name = String(el.value || "My route").slice(0, 48);
      c.customRoutes[id] = cr;
      openDetails.add("custom-editor");
      commit();
    }
    else if (el.id === "customBaseMode") {
      const c = char(), id = Run.route(c).customId;
      if (!id) return;
      const cr = touchCustom(c, id);
      if (!cr) return;
      cr.baseMode = el.value === "fast" ? "fast" : "normal";
      // Keep route.mode in sync so mode select matches.
      c.route = Object.assign({}, Run.route(c), { mode: cr.baseMode });
      c.customRoutes[id] = cr;
      openDetails.add("custom-editor");
      commit();
    }
    else if (el.classList.contains("cr-note-input") || el.dataset.action === "custom-note") {
      const c = char(), id = Run.route(c).customId;
      if (!id) return;
      const cr = touchCustom(c, id);
      if (!cr) return;
      const cleaned = CustomRoute.cleanNote(el.value);
      if (cleaned) cr.notes[el.dataset.id] = cleaned;
      else delete cr.notes[el.dataset.id];
      c.customRoutes[id] = cr;
      openDetails.add("custom-editor");
      // Don't full-re-render on every keystroke via change — change fires on blur.
      commit();
    }
    else if (el.id === "statSeg") { statSeg = el.value; renderCampaign(); }
    else if (el.id === "historyFilter") {
      historyFilter = ["campaign", "practice", "all"].includes(el.value) ? el.value : "campaign";
      renderHistory(); renderCampaign();
    }
    else if (el.id === "charLevel") {
      const raw = el.value.trim();
      const c = char();
      if (raw === "") c.level = null;
      else {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 1 || n > 100) { toast("Level must be 1–100"); render(); return; }
        c.level = Math.floor(n);
      }
      commit();
    }
    else if (el.id === "desktopOverlay") {
      if (window.splitstoneDesktop) window.splitstoneDesktop.setOverlayEnabled(el.checked);
    }
    else if (el.id === "desktopAutoUpdate" || el.id === "desktopAutoUpdateSettings") {
      if (window.splitstoneDesktop) {
        window.splitstoneDesktop.setAutoUpdate(el.checked).then(v => {
          window.__desktopAutoUpdate = !!v;
          const a = $("#desktopAutoUpdate"), b = $("#desktopAutoUpdateSettings");
          if (a) a.checked = !!v;
          if (b) b.checked = !!v;
        });
      }
    }
    else if (el.id === "overlayOpacity") {
      const pct = Math.min(100, Math.max(30, Number(el.value) || 80));
      const v = pct / 100;
      state.settings.overlay = Object.assign({}, state.settings.overlay || {}, { opacity: v });
      const lab = $("#overlayOpacityVal");
      if (lab) lab.textContent = pct + "%";
      if (window.splitstoneDesktop) window.splitstoneDesktop.setOverlayOpacity(v);
      commit();
      pushOverlay();
    }
    else if (el.dataset && el.dataset.egMilestone) { Endgame.toggleMilestone(EG(), el.dataset.egMilestone, Date.now()); commit(); }
    else if (el.dataset && el.dataset.egField) { Endgame.updateActive(EG(), { [el.dataset.egField]: el.value }); Storage2.save(state); }
    else if (el.id === "egSession") { egShowSession = el.value || null; renderViews(); }
    else if (el.id === "egAutoDetect") { state.settings.endgameAutoDetect = el.checked; commit(); }
    else if (el.dataset && el.dataset.globalKey) {
      const action = el.dataset.globalKey, want = el.value.trim();
      window.splitstoneDesktop.setHotkeys({ [action]: want }).then(hk => {
        renderDesktopHotkeys(hk);
        toast(hk && hk[action] === want ? `${want} saved` : `${want || "That"} isn't allowed; use Ctrl or Alt with a key`);
      }).catch(() => {});
    }
    else if (el.id === "desktopClickThrough") {
      state.settings.overlay = Object.assign({}, state.settings.overlay || {}, { clickThrough: el.checked });
      if (window.splitstoneDesktop) window.splitstoneDesktop.setClickThrough(el.checked);
      commit();
      pushOverlay();
    }
    else if (el.id === "desktopOverlaySettings") {
      window.__desktopOverlayEnabled = el.checked;
      if (window.splitstoneDesktop) window.splitstoneDesktop.setOverlayEnabled(el.checked);
      const bar = $("#desktopOverlay");
      if (bar) bar.checked = el.checked;
    }
    else if (el.id === "autoSplit") {
      state.settings.autoSplit.enabled = el.checked;
      if (el.checked) AutoSplit.connect(state.settings.autoSplit.url, autoSplitOpts());
      else AutoSplit.disconnect();
      commit();
    }
    else if (el.id === "autoSplitUrl") {
      const raw = el.value.trim() || "http://127.0.0.1:8766";
      const canon = Storage2.canonicalHelperUrl(raw);
      if (!canon) {
        toast("Helper URL must be http://127.0.0.1, localhost, or [::1] (no ?query/#hash)");
        el.value = state.settings.autoSplit.url;
        return;
      }
      state.settings.autoSplit.url = canon;
      if (state.settings.autoSplit.enabled) AutoSplit.connect(canon, autoSplitOpts());
      commit();
    }
    else if (el.id === "autoSplitToken") {
      state.settings.autoSplit.token = el.value.slice(0, 128);
      if (state.settings.autoSplit.enabled) AutoSplit.connect(state.settings.autoSplit.url, autoSplitOpts());
      commit();
    }
    else if (el.id === "classSelect" || el.id === "routeClass") {
      (async () => {
        const c = char(), next = el.value || null;
        if (c.classId && next !== c.classId && Run.isStarted(c) && !Run.isFinished(c) &&
            !(await askConfirm("Change class notes mid-run? Tips update immediately; timers are unchanged."))) {
          render(); return;
        }
        c.classId = next;
        commit();
        toast(next ? `Class: ${(classMeta(next) || {}).name}` : "Class notes cleared");
      })();
    }
    else if (el.id === "charSelect") { state.activeId = el.value; pobError = ""; commit(); scrollToCurrent(false); }
    else if (el.id === "importFile" && el.files[0]) {
      el.files[0].text().then(async text => {
        try {
          let keepHelper = false;
          try {
            const peek = JSON.parse(text);
            if (peek && peek.settings && peek.settings.autoSplit) {
              keepHelper = await askConfirm(
                "This file includes Auto-split / helper URL settings.\n\n" +
                "Apply the helper URL? (enabled stays off — import never connects.)");
            }
          } catch (_) { /* normalise will throw below */ }
          const n = Storage2.importJSON(state, text, { keepHelper });
          Object.values(state.characters).forEach(Run.prune);
          // Never AutoSplit.connect on import — user must re-enable Auto-split.
          commit(); toast(`Imported ${n} character(s)`);
        } catch (e) { toast("Import failed: " + e.message); }
        el.value = "";
      });
    }
  });
  document.addEventListener("submit", ev => {
    if (ev.target.dataset.form !== "eg-start") return;
    ev.preventDefault();
    const map = $("#egMap").value.trim();
    if (!map) return;
    Endgame.startMap(EG(), { map, tier: $("#egTier").value, mods: $("#egMods").value }, Date.now());
    commit();
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
    async "overlay-reset-pos"() {
      if (window.splitstoneDesktop && window.splitstoneDesktop.resetOverlayPosition)
        await window.splitstoneDesktop.resetOverlayPosition();
      toast("Overlay position reset");
    },
    settings() {
      $("#help").setAttribute("hidden", "");
      capturing = null;
      renderHelp();
      const desk = $("#desktopSettingsBlock");
      if (desk) {
        const isDesk = !!(window.splitstoneDesktop && window.splitstoneDesktop.isDesktop);
        desk.hidden = !isDesk;
        if (isDesk) {
          const box = $("#desktopAutoUpdateSettings");
          if (box) box.checked = window.__desktopAutoUpdate !== false;
          const ov = (state.settings && state.settings.overlay) || {};
          const op = $("#overlayOpacity"), ovl = $("#overlayOpacityVal");
          const pct = Math.round((Number(ov.opacity) || 0.8) * 100);
          if (op) op.value = String(pct);
          if (ovl) ovl.textContent = pct + "%";
          const ct = $("#desktopClickThrough");
          if (ct) ct.checked = ov.clickThrough !== false;
          const ovs = $("#desktopOverlaySettings");
          if (ovs && window.__desktopOverlayEnabled != null) ovs.checked = !!window.__desktopOverlayEnabled;
          else if (ovs) ovs.checked = true;
        }
      }
      $("#settings").removeAttribute("hidden");
    },
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
    if (ev.key === "Escape") {
      const mdl = $("#appModal");
      if (mdl && mdl.open) return; // dialog handles Esc
      $("#help").setAttribute("hidden", ""); $("#settings").setAttribute("hidden", ""); return;
    }
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
      endgameZone(ev);
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
      const map = {
        split: doSplit, undo: actions.undo, pause: actions.pause,
        newrun: () => doNewRun({ confirmed: true }),
        togglehint: () => { state.settings.hideHints = !state.settings.hideHints; commit(); },
      };
      const fn = map[String(action).toLowerCase().replace(/[^a-z]/g, "")];
      if (fn) fn();
    },
  });
  const GLOBAL_KEY_LABELS = [
    ["split", "Split"], ["undo", "Undo"], ["pause", "Pause / resume"],
    ["newRun", "New run (press twice)"], ["toggleHint", "Show / hide hints"], ["clickThrough", "Lock / unlock overlay"],
  ];
  function renderDesktopHotkeys(hk) {
    const table = $("#desktopHotkeyTable");
    if (!table || !hk) return;
    table.innerHTML = GLOBAL_KEY_LABELS.map(([k, label]) =>
      `<tr><td>${esc(label)}</td><td><input type="text" data-global-key="${k}" value="${esc(hk[k] || "")}"
        maxlength="32" spellcheck="false" aria-label="${esc(label)} global hotkey"></td></tr>`).join("");
  }
  function showDesktopStatus(st) {
    if (!st) return;
    if (st.hotkeys && !(document.activeElement && document.activeElement.dataset.globalKey)) renderDesktopHotkeys(st.hotkeys);
    const v = $("#desktopVersion");
    if (v && st.version) v.textContent = "Splitstone " + st.version;
  }
  function syncDesktopHotkeys() {
    // Global shortcuts stay as desktop modifier combos (Ctrl+Alt+…).
    // Do not push in-window Space/P/U/R bindings into globalShortcut.
    if (!window.splitstoneDesktop) return;
  }

  function showDesktopSetup(info) {
    const el = $("#desktopSetup");
    if (!el) return;
    el.hidden = false;
    const msg = $("#desktopSetupMsg");
    if (info && info.found && info.path) {
      msg.textContent = "Found Client.txt at “" + info.path + "”. Auto-split and the overlay are ready. You can change the file later under Auto-split settings.";
    } else {
      msg.textContent = "We couldn’t find Path of Exile 2’s Client.txt automatically. Click Browse and pick it once — usually under your Steam folder → Path of Exile 2 → logs → Client.txt.";
    }
  }

  function hideDesktopSetup() {
    const el = $("#desktopSetup");
    if (el) el.hidden = true;
  }

  // Desktop: IPC auto-split + overlay (no Python helper). Browser keeps HTTP helper / file picker.
  if (window.splitstoneDesktop && window.splitstoneDesktop.isDesktop) {
    document.body.classList.add("is-desktop");
    state.settings.autoSplit.enabled = true; // always on in desktop
    window.__desktopAutoUpdate = true; // default on until status says otherwise
    window.splitstoneDesktop.getStatus().then(st => {
      if (st && typeof st.autoUpdate === "boolean") window.__desktopAutoUpdate = st.autoUpdate;
      showDesktopStatus(st);
      const box = document.getElementById("desktopAutoUpdate");
      if (box) box.checked = window.__desktopAutoUpdate !== false;
    }).catch(() => {});
    AutoSplit.connectDesktop();
    syncDesktopHotkeys();
    window.splitstoneDesktop.onFirstRunNeeded(info => showDesktopSetup(info));
    window.splitstoneDesktop.onStatus(st => {
      showDesktopStatus(st);
      asStatus = AutoSplit.status();
      document.querySelectorAll("[data-as-pill]").forEach(el => { el.innerHTML = statusPill(); });
      if (st && st.watching && st.logExists) hideDesktopSetup();
      if (st && typeof st.overlayEnabled === "boolean") {
        window.__desktopOverlayEnabled = st.overlayEnabled;
        const a = $("#desktopOverlay"), b = $("#desktopOverlaySettings");
        if (a) a.checked = st.overlayEnabled;
        if (b) b.checked = st.overlayEnabled;
      }
      if (st && typeof st.clickThrough === "boolean") {
        state.settings.overlay = Object.assign({}, state.settings.overlay || {}, { clickThrough: st.clickThrough });
        const ct = $("#desktopClickThrough");
        if (ct) ct.checked = st.clickThrough;
      }
    });
    if (window.splitstoneDesktop.onToast) {
      window.splitstoneDesktop.onToast(msg => { if (msg) toast(msg); });
    }
    // Overlay gets live snapshots whenever the helper path would have pushed.
    const _push = pushOverlay;
    // pushOverlay already calls AutoSplit.pushState which routes to IPC on desktop.
  } else if (state.settings.autoSplit.enabled) {
    AutoSplit.connect(state.settings.autoSplit.url, autoSplitOpts());
  }

  actions["desktop-browse"] = async () => {
    if (!window.splitstoneDesktop) return;
    const res = await window.splitstoneDesktop.browseClientLog();
    if (res && res.ok) {
      hideDesktopSetup();
      toast("Watching " + res.path);
      AutoSplit.connectDesktop();
    } else if (res && res.error) toast(res.error);
  };
  actions["desktop-retry"] = async () => {
    if (!window.splitstoneDesktop) return;
    const p = await window.splitstoneDesktop.findClientLog();
    if (p) {
      const res = await window.splitstoneDesktop.setClientLog(p);
      if (res && res.ok) { hideDesktopSetup(); toast("Found Client.txt"); AutoSplit.connectDesktop(); }
    } else showDesktopSetup({ found: false });
  };
  actions["desktop-skip"] = async () => {
    if (!window.splitstoneDesktop) return;
    await window.splitstoneDesktop.dismissFirstRun();
    hideDesktopSetup();
    toast("You can set Client.txt later under Auto-split settings");
  };

  // When hotkeys change in settings, push to globalShortcut.
  const _origCommit = commit;
  // Patch via wrapping save of hotkeys — listen on keyTable changes already call commit;
  // sync after render when desktop:
  const _render = render;
  // simpler: sync on interval once and after keybind — hook existing setKey if present

  applyTheme(state.settings.theme || "ember");

  render();
  scrollToCurrent(false);
  setInterval(tick, 250);
  if (window.splitstoneDesktop) syncDesktopHotkeys();
})();
