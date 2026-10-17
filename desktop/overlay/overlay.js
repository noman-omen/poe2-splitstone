"use strict";
(function () {
  const MARGIN = 4;              // around the panel, for its shadow
  const MIN_FONT = 11, MAX_FONT = 48;
  const panel = document.getElementById("panel"), textEl = document.getElementById("text");
  const bridge = window.splitstoneOverlay || {};
  let box = { width: window.innerWidth, height: window.innerHeight, custom: false, grow: "both" };
  let lastFitWidth = 0;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
  }
  const text = s => String(s || "").trim();

  /** Room inside the panel's padding; the text block grows with its content until it hits this. */
  function room() {
    const cs = getComputedStyle(panel);
    return panel.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  }
  /** Both rows, Next included, inside the panel: no overflow down or sideways. */
  function fits() {
    const last = textEl.lastElementChild;
    const bottom = last ? last.getBoundingClientRect().bottom - textEl.getBoundingClientRect().top : 0;
    return textEl.scrollHeight <= room() + 0.5 && bottom <= room() + 0.5 && textEl.scrollWidth <= textEl.clientWidth + 0.5;
  }
  function setFont(px) { panel.style.setProperty("--f", px + "px"); }

  /** Largest font up to `cap` that fits, in half pixels; 0 when even the minimum doesn't. */
  function largestFit(cap) {
    let lo = MIN_FONT * 2, hi = Math.max(lo, Math.floor(cap * 2));
    setFont(lo / 2);
    if (!fits()) return 0;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      setFont(mid / 2);
      if (fits()) lo = mid; else hi = mid - 1;
    }
    setFont(lo / 2);
    return lo / 2;
  }

  /**
   * A long route step (longer than most) and its next step. The font that fits them is the font for this
   * window size, so it stays put from step to step; only longer steps get a smaller one.
   */
  const STEADY = [
    "Place 2 Medium Soul Cores in the generators, kill Zicoatl → Large Soul Core, WP to Jungle Ruins",
    "Put the Large Soul Core into the Stone Altar → opens The Matlan Waterways",
  ];
  const steady = { key: "", font: MAX_FONT };
  function steadyFont(w, h) {
    const key = w + "x" + h;
    if (steady.key === key) return steady.font;
    const html = textEl.innerHTML;
    textEl.innerHTML = rowsHTML(STEADY[0], STEADY[1]);
    steady.key = key;
    steady.font = largestFit(MAX_FONT) || MIN_FONT;
    textEl.innerHTML = html;
    return steady.font;
  }

  /** Below the minimum font the text is cut to the lines that fit, the only place it is shortened. */
  function fitText() {
    const w = Math.max(40, box.width - 2 * MARGIN), h = Math.max(24, box.height - 2 * MARGIN);
    panel.style.width = w + "px";
    panel.style.height = h + "px";
    const cap = steadyFont(w, h);
    const rows = [...textEl.querySelectorAll(".row")];
    rows.forEach(r => { r.classList.remove("clamp"); r.style.webkitLineClamp = ""; });
    const font = largestFit(cap);
    if (!font) {
      setFont(MIN_FONT);
      clampToFit(rows);
    }
    panel.dataset.font = String(font || MIN_FONT);
    shrinkToText(w);
  }

  function clampToFit(rows) {
    const [step, next] = rows;
    const lh = el => parseFloat(getComputedStyle(el).lineHeight) || MIN_FONT * 1.22;
    if (next) { next.classList.add("clamp"); next.style.webkitLineClamp = "1"; }
    if (step) {
      const left = room() - (next ? next.offsetHeight + 2 : 0);
      step.classList.add("clamp");
      step.style.webkitLineClamp = String(Math.max(1, Math.floor(left / lh(step))));
    }
  }

  /**
   * At the default size, a short step doesn't need the whole width: ask for a narrower window.
   * Measured unrounded and rounded up; if the narrower panel would re-wrap the text, keep the full width.
   */
  function shrinkToText(w) {
    if (box.custom || !bridge.fitWidth) return;
    const cs = getComputedStyle(panel);
    const pad = panel.offsetWidth - panel.clientWidth + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    textEl.style.width = "max-content";
    textEl.style.maxWidth = (w - pad) + "px";
    let need = Math.min(w, Math.ceil(textEl.getBoundingClientRect().width + pad) + 1);
    textEl.style.width = textEl.style.maxWidth = "";
    panel.style.width = need + "px";
    if (need < w && !fits()) {
      need = w;
      panel.style.width = w + "px";
    }
    const want = need + 2 * MARGIN;
    if (want !== lastFitWidth) { lastFitWidth = want; bridge.fitWidth(want); }
  }

  const toastEl = document.getElementById("toast");
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("on", !!msg);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("on"), 2500);
  }

  function rowsHTML(step, next) {
    return '<div class="row step">' + esc(step) + "</div>" + (next ? '<div class="row next">Next · ' + esc(next) + "</div>" : "");
  }

  /** Current step and next step only. Hints stay in the app. */
  function render(st) {
    if (!st) return;
    textEl.innerHTML = rowsHTML(text(st.step) || "—", text(st.nextStep));
    fitText();
  }

  // Resize grip (move mode only; main ignores it while the overlay is locked).
  const grip = document.getElementById("grip");
  let drag = null;
  /** The grip follows the pointer: a window centred on its midpoint grows by twice the pointer's move. */
  const sizeAt = e => [Math.round(drag.w + drag.k * (e.screenX - drag.x)), Math.round(drag.h + e.screenY - drag.y)];
  grip.addEventListener("pointerdown", (e) => {
    drag = { x: e.screenX, y: e.screenY, w: box.width, h: box.height, k: box.grow === "both" ? 2 : 1, raf: 0, last: null };
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.last = sizeAt(e);
    if (drag.raf) return;
    drag.raf = requestAnimationFrame(() => {
      drag.raf = 0;
      if (drag.last && bridge.resize) bridge.resize(drag.last[0], drag.last[1], false);
    });
  });
  const endDrag = (e) => {
    if (!drag) return;
    const [w, h] = sizeAt(e);
    cancelAnimationFrame(drag.raf);
    drag = null;
    if (bridge.resize) bridge.resize(w, h, true);
  };
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);

  if (bridge.onBox) {
    bridge.onBox(function (b) {
      if (!b || !(b.width > 0) || !(b.height > 0)) return;
      box = { width: b.width, height: b.height, custom: !!b.custom, grow: b.grow === "right" ? "right" : "both" };
      lastFitWidth = 0;
      fitText();
    });
  }
  if (bridge.onState) bridge.onState(render);
  if (bridge.onLock) bridge.onLock(function (locked) { document.body.classList.toggle("unlocked", !locked); });
  if (bridge.onToast) bridge.onToast(showToast);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { steady.key = ""; fitText(); });
  if (bridge.ready) bridge.ready();
})();
