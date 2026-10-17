"use strict";
(function () {
  const MARGIN = 4;              // around the panel, for its shadow
  const MIN_FONT = 11, MAX_FONT = 48;
  const panel = document.getElementById("panel"), textEl = document.getElementById("text");
  const bridge = window.splitstoneOverlay || {};
  let box = { width: window.innerWidth, height: window.innerHeight, custom: false };
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
  const fits = () => textEl.scrollHeight <= room() + 0.5 && textEl.scrollWidth <= textEl.clientWidth + 0.5;
  function setFont(px) { panel.style.setProperty("--f", px + "px"); }

  /**
   * Largest font that fits both lines in the box (binary search in half pixels).
   * Below the minimum the text is cut to the lines that fit, the only place it is shortened.
   */
  function fitText() {
    const w = Math.max(40, box.width - 2 * MARGIN), h = Math.max(24, box.height - 2 * MARGIN);
    panel.style.width = w + "px";
    panel.style.height = h + "px";
    textEl.style.maxHeight = "100%";
    const rows = [...textEl.querySelectorAll(".row")];
    rows.forEach(r => { r.classList.remove("clamp"); r.style.webkitLineClamp = ""; });
    let lo = MIN_FONT * 2, hi = MAX_FONT * 2;
    setFont(lo / 2);
    if (fits()) {
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        setFont(mid / 2);
        if (fits()) lo = mid; else hi = mid - 1;
      }
      setFont(lo / 2);
    } else clampToFit(rows);
    panel.dataset.font = String(lo / 2);
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

  /** At the default size, a short step doesn't need the whole width: ask for a narrower window. */
  function shrinkToText(w) {
    if (box.custom || !bridge.fitWidth) return;
    const pad = panel.offsetWidth - panel.clientWidth + parseFloat(getComputedStyle(panel).paddingLeft) * 2;
    textEl.style.width = "max-content";
    textEl.style.maxWidth = (w - pad) + "px";
    const need = Math.min(w, Math.ceil(textEl.offsetWidth + pad));
    textEl.style.width = textEl.style.maxWidth = "";
    panel.style.width = need + "px";
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

  /** Current step and next step only. Hints stay in the app. */
  function render(st) {
    if (!st) return;
    const bits = ['<div class="row step">' + esc(text(st.step) || "—") + "</div>"];
    if (text(st.nextStep)) bits.push('<div class="row next">Next · ' + esc(text(st.nextStep)) + "</div>");
    textEl.innerHTML = bits.join("");
    fitText();
  }

  // Resize grip (move mode only; main ignores it while the overlay is locked).
  const grip = document.getElementById("grip");
  let drag = null;
  grip.addEventListener("pointerdown", (e) => {
    drag = { x: e.screenX, y: e.screenY, w: box.width, h: box.height, raf: 0, last: null };
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.last = [drag.w + e.screenX - drag.x, drag.h + e.screenY - drag.y];
    if (drag.raf) return;
    drag.raf = requestAnimationFrame(() => {
      drag.raf = 0;
      if (drag.last && bridge.resize) bridge.resize(drag.last[0], drag.last[1], false);
    });
  });
  const endDrag = (e) => {
    if (!drag) return;
    const w = drag.w + e.screenX - drag.x, h = drag.h + e.screenY - drag.y;
    cancelAnimationFrame(drag.raf);
    drag = null;
    if (bridge.resize) bridge.resize(w, h, true);
  };
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);

  if (bridge.onBox) {
    bridge.onBox(function (b) {
      if (!b || !(b.width > 0) || !(b.height > 0)) return;
      box = { width: b.width, height: b.height, custom: !!b.custom };
      lastFitWidth = 0;
      fitText();
    });
  }
  if (bridge.onState) bridge.onState(render);
  if (bridge.onLock) bridge.onLock(function (locked) { document.body.classList.toggle("unlocked", !locked); });
  if (bridge.onToast) bridge.onToast(showToast);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitText);
  if (bridge.ready) bridge.ready();
})();
