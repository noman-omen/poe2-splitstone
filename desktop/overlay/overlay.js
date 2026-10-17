"use strict";
(function () {
  const panel = document.getElementById("panel");
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
  }
  const text = s => String(s || "").trim();
  let lastSize = "";
  /** Ask main for a window exactly the size of the panel (plus its margin), so no line is cut off. */
  function fit() {
    const wrap = document.getElementById("wrap"), r = wrap.getBoundingClientRect();
    const m = parseFloat(getComputedStyle(wrap).marginLeft) || 0;
    const w = Math.ceil(r.width + 2 * m), h = Math.ceil(r.height + 2 * m);
    const key = w + "x" + h;
    if (key === lastSize) return;
    lastSize = key;
    if (window.splitstoneOverlay && window.splitstoneOverlay.resize) window.splitstoneOverlay.resize(w, h);
  }
  const toastEl = document.getElementById("toast");
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("on", !!msg);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.classList.remove("on"); fit(); }, 2500);
    fit();
  }
  function render(st) {
    if (!st) return;
    const bits = [];
    bits.push('<div class="row step">' + esc(text(st.step) || "—") + '</div>');
    if (st.showTip !== false && text(st.tip)) {
      bits.push('<div class="row tip">' + esc(text(st.tip)) + '</div>');
    }
    if (text(st.nextStep)) {
      bits.push('<div class="row next">Next · ' + esc(text(st.nextStep)) + '</div>');
    }
    panel.innerHTML = bits.join("");
    fit();
  }
  if (window.ResizeObserver) new ResizeObserver(fit).observe(document.getElementById("wrap"));
  if (window.splitstoneOverlay) {
    window.splitstoneOverlay.onState(render);
    if (window.splitstoneOverlay.onLock) {
      window.splitstoneOverlay.onLock(function (locked) {
        document.body.classList.toggle("unlocked", !locked);
      });
    }
    if (window.splitstoneOverlay.onToast) window.splitstoneOverlay.onToast(showToast);
    if (window.splitstoneOverlay.onTextSize) {
      window.splitstoneOverlay.onTextSize(function (size) {
        document.body.dataset.size = ["s", "m", "l"].indexOf(size) >= 0 ? size : "m";
        lastSize = ""; fit();
      });
    }
    window.splitstoneOverlay.ready();
  }
})();
