/* app.js: UI wiring. State lives in `state`; every mutation goes through
 * commit(), which saves to localStorage and re-renders. A 1s ticker only
 * refreshes timer text, so running timers stay cheap. */
(function () {
  "use strict";

  const DATA = window.CAMPAIGN_DATA;
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let state = Storage2.load();
  const collapsed = new Set();           // UI-only: collapsed section ids
  let pobError = "";

  const char = () => state.characters[state.activeId];
  const allSteps = () => DATA.sections.flatMap(s => s.zones.flatMap(z => z.steps));

  function commit() { Storage2.save(state); render(); }

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* ---------- Timer keys ----------
   * section:<id>  act / interlude timer
   * zone:<id>     zone timer
   * map:<id>      endgame map timer */
  function timerWidget(key, label) {
    const c = char(), run = Timers.isRunning(c, key);
    return `<span class="tw${run ? " running" : ""}" data-key="${esc(key)}">
      <span class="timer" data-timer="${esc(key)}">${Timers.format(Timers.value(c, key))}</span>
      <button class="tt" data-action="timer-toggle" data-key="${esc(key)}"
        aria-label="${run ? "Stop" : "Start"} ${esc(label)} timer">${run ? "Stop" : "Start"}</button>
      <button data-action="timer-reset" data-key="${esc(key)}" title="Reset" aria-label="Reset ${esc(label)} timer">↺</button>
    </span>`;
  }

  /* ---------- Rendering ---------- */
  function render() {
    const c = char();
    document.body.classList.toggle("hide-hints", !!state.settings.hideHints);
    document.body.classList.toggle("hide-extra", !!state.settings.hideExtra);
    $("#hideHints").checked = !!state.settings.hideHints;
    $("#hideExtra").checked = !!state.settings.hideExtra;
    $("#meta").textContent = `Patch ${DATA.meta.patch} · ${DATA.meta.league}`;
    $("#charSelect").innerHTML = Object.values(state.characters)
      .sort((a, b) => a.created.localeCompare(b.created))
      .map(x => `<option value="${esc(x.id)}"${x.id === c.id ? " selected" : ""}>${esc(x.name)}</option>`).join("");
    renderTotals(); renderCharacter(); renderCampaign();
  }

  function renderTotals() {
    const c = char(), steps = allSteps();
    const done = steps.filter(s => c.done[s.id]).length;
    const row = (label, ms, cls = "") =>
      `<div class="totals-row ${cls}"><span>${label}</span><span class="mono" data-total="${label}">${Timers.format(ms)}</span></div>`;
    const t = totals();
    $("#totals").innerHTML = `<h2>Progress &amp; totals</h2>
      <div>${done} / ${steps.length} steps</div>
      <div class="progress"><div style="width:${(100 * done / steps.length).toFixed(1)}%"></div></div>
      ${DATA.sections.map(s => row(s.name, Timers.value(c, "section:" + s.id))).join("")}
      ${row("Acts total", t.acts)}${row("Interludes total", t.interludes)}${row("Maps total", t.maps)}
      ${row("Zones (sum)", t.zones)}
      ${row("Campaign + maps", t.grand, "grand")}`;
  }

  function totals(now = Date.now()) {
    const c = char(), sec = k => DATA.sections.filter(s => s.kind === k)
      .reduce((a, s) => a + Timers.value(c, "section:" + s.id, now), 0);
    const acts = sec("act"), interludes = sec("interlude"), maps = Timers.sum(c, "map:", now);
    return { acts, interludes, maps, zones: Timers.sum(c, "zone:", now), grand: acts + interludes + maps };
  }

  function renderCharacter() {
    const c = char(), b = c.build;
    let html = `<h2>Character</h2><div class="char-name">${esc(c.name)}</div>`;
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
      html += `<p style="color:var(--muted);margin:4px 0 8px">Optional: paste a Path of Building 2 export code.</p>`;
    }
    html += `<details${b ? "" : " open"}><summary style="cursor:pointer;color:var(--muted);margin-top:8px">Import PoB2 code</summary>
      <textarea id="pobCode" placeholder="eNrtPVlz2zjSz6N…" spellcheck="false"></textarea>
      <div class="row"><button class="primary" data-action="pob-import">Decode build</button></div>
      ${pobError ? `<div class="error" id="pobError">${esc(pobError)}</div>` : ""}</details>`;
    $("#character").innerHTML = html;
  }

  function stepHTML(s, c) {
    const done = !!c.done[s.id];
    const extra = [];
    if (s.details.length) extra.push(...s.details.map(d => `<li>${esc(d)}</li>`));
    if (s.waypoint) extra.push(`<li><span class="k">Waypoint</span>${esc(s.waypoint === true ? "Yes" : s.waypoint)}</li>`);
    if (s.skip.length) extra.push(`<li><span class="k">Skip</span>${esc(s.skip.join("; "))}</li>`);
    if (s.rewards.length) extra.push(`<li>${s.rewards.map(r =>
      `<span class="reward${r.must ? " must" : ""}">${r.must ? "★ " : ""}${esc(r.label)}</span>`).join("")}</li>`);
    if (s.warning) extra.push(`<li class="warn">⚠ ${esc(s.warning)}</li>`);
    return `<div class="step${done ? " done" : ""}">
      <input type="checkbox" id="st-${esc(s.id)}" data-action="step" data-id="${esc(s.id)}"${done ? " checked" : ""}>
      <label for="st-${esc(s.id)}"><span class="objective">${esc(s.objective)}</span>
        ${s.level ? `<span class="lvl">· lvl ${esc(s.level)}</span>` : ""}${s.optional ? `<span class="optional">optional</span>` : ""}</label>
      ${s.hints.length ? `<ul class="hints">${s.hints.map(h => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
      ${extra.length ? `<ul class="extra">${extra.join("")}</ul>` : ""}
    </div>`;
  }

  function renderCampaign() {
    const c = char();
    const sections = DATA.sections.map(sec => {
      const steps = sec.zones.flatMap(z => z.steps), done = steps.filter(s => c.done[s.id]).length;
      return `<section class="section${collapsed.has(sec.id) ? " collapsed" : ""}" data-section="${esc(sec.id)}">
        <header data-action="collapse" data-id="${esc(sec.id)}">
          <h2>${esc(sec.name)}<small>${esc(sec.region || "")} · lvl ${esc(sec.levels || "")}</small></h2>
          <span class="badge">${done}/${steps.length}</span>
          ${timerWidget("section:" + sec.id, sec.name)}
        </header>
        <div class="zones">${sec.zones.map(z => {
          const complete = z.steps.every(s => c.done[s.id]);
          return `<div class="zone${complete ? " complete" : ""}" data-zone="${esc(z.id)}">
            <div class="zone-head"><h3>${complete ? "✓ " : ""}${esc(z.name)}</h3>${timerWidget("zone:" + z.id, z.name)}</div>
            ${z.steps.map(s => stepHTML(s, c)).join("")}</div>`;
        }).join("")}</div></section>`;
    }).join("");

    const maps = `<section class="section" data-section="maps">
      <header data-action="collapse" data-id="maps"><h2>Endgame maps<small>per-map timers</small></h2>
        <span class="badge">${c.maps.length}</span></header>
      <div class="zones">
        <form class="maps-add" data-form="map-add"><input type="text" id="mapName" placeholder="Map name, e.g. Burial Bog (T1)" maxlength="80">
          <button class="primary" type="submit">Add map</button></form>
        ${c.maps.length ? c.maps.map(m => `<div class="map-row" data-map="${esc(m.id)}"><span class="name">${esc(m.name)}</span>
          ${timerWidget("map:" + m.id, m.name)}<button data-action="map-delete" data-id="${esc(m.id)}" class="danger" title="Remove map">✕</button></div>`).join("")
          : `<div class="empty">No maps yet.</div>`}
      </div></section>`;
    $("#campaign").innerHTML = sections + maps;
  }

  /** Called every second: refresh only the numbers, not the DOM structure. */
  function tick() {
    const c = char(), now = Date.now();
    document.querySelectorAll("[data-timer]").forEach(el => {
      el.textContent = Timers.format(Timers.value(c, el.dataset.timer, now));
    });
    const t = totals(now);
    const map = { "Acts total": t.acts, "Interludes total": t.interludes, "Maps total": t.maps,
                  "Zones (sum)": t.zones, "Campaign + maps": t.grand };
    DATA.sections.forEach(s => { map[s.name] = Timers.value(c, "section:" + s.id, now); });
    document.querySelectorAll("[data-total]").forEach(el => {
      if (el.dataset.total in map) el.textContent = Timers.format(map[el.dataset.total]);
    });
  }

  /** Map a zone id back to its section, so starting a zone also starts its act. */
  const sectionOfZone = zid => DATA.sections.find(s => s.zones.some(z => z.id === zid));

  /* ---------- Actions ---------- */
  const actions = {
    "timer-toggle"(el) {
      const c = char(), key = el.dataset.key;
      const wasRunning = Timers.isRunning(c, key);
      Timers.toggle(c, key);
      if (!wasRunning && key.startsWith("zone:")) {
        // Only one zone runs at a time; the parent act/interlude keeps running.
        Object.keys(c.timers).filter(k => k.startsWith("zone:") && k !== key).forEach(k => Timers.stop(c, k));
        const sec = sectionOfZone(key.slice(5));
        if (sec) Timers.start(c, "section:" + sec.id);
      }
      commit();
    },
    "timer-reset"(el) {
      if (confirm("Reset this timer to 0?")) { Timers.reset(char(), el.dataset.key); commit(); }
    },
    step(el) {
      const c = char();
      if (el.checked) c.done[el.dataset.id] = true; else delete c.done[el.dataset.id];
      commit();
    },
    collapse(el, ev) {
      if (ev.target.closest("button")) return; // clicks on timer buttons should not collapse
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
      if (!confirm(`Delete "${char().name}" and all its progress?`)) return;
      delete state.characters[state.activeId];
      state.activeId = Object.keys(state.characters)[0];
      commit();
    },
    export() {
      const blob = new Blob([Storage2.exportJSON(state)], { type: "application/json" });
      const a = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(blob),
        download: `poe2-campaign-${new Date().toISOString().slice(0, 10)}.json`,
      });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast("Exported");
    },
    import() { $("#importFile").click(); },
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
    else if (el.id === "hideHints" || el.id === "hideExtra") { state.settings[el.id] = el.checked; commit(); }
    else if (el.id === "charSelect") { state.activeId = el.value; pobError = ""; commit(); }
    else if (el.id === "importFile" && el.files[0]) {
      el.files[0].text().then(text => {
        try { const n = Storage2.importJSON(state, text); commit(); toast(`Imported ${n} character(s)`); }
        catch (e) { toast("Import failed: " + e.message); }
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

  render();
  setInterval(tick, 1000);
})();
