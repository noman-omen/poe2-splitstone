"use strict";
(function () {
  const panel = document.getElementById("panel");
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
  }
  function clamp(s, n) {
    s = String(s || "").trim();
    return s.length > n ? s.slice(0, n - 1).replace(/\s+$/, "") + "…" : s;
  }
  let lastSize = "";
  function fit() {
    const r = document.getElementById("wrap").getBoundingClientRect();
    const w = Math.min(440, Math.ceil(r.width) + 8), h = Math.ceil(r.height) + 16;
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
    bits.push('<div class="row step">' + esc(clamp(st.step || "—", 120)) + '</div>');
    if (st.showTip !== false && st.tip) {
      bits.push('<div class="row tip">' + esc(clamp(st.tip, 100)) + '</div>');
    }
    if (st.nextStep) {
      bits.push('<div class="row next">Next · ' + esc(clamp(st.nextStep, 100)) + '</div>');
    }
    panel.innerHTML = bits.join("");
    fit();
  }
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
