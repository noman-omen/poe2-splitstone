#!/usr/bin/env python3
"""Desktop overlay page: full hint text at every size, window fitted to the content, top-centre spot.
Loads desktop/overlay/overlay.html with a stub bridge (no Electron). Writes overlay-top-center.png
to test-output/ (screenshots/ with SPLITSTONE_UPDATE_SHOTS=1)."""
import base64
import json
import subprocess
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
from shot_dir import shot_dir  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OVERLAY = (ROOT / "desktop" / "overlay" / "overlay.html").as_uri()
LONG = {
    "step": "Kill the Devourer, then take the waypoint and head north-east through the Mud Burrow to the Grelwood",
    "tip": ("Fight him in the corner opposite the entrance, then walk straight past the blockade into town. "
            "He burrows after each phase, so stay near the middle and step out of the dust ring when it appears. "
            "Kill the adds first if you are on a melee build, and pick up the flasks from the camp on the way."),
    "nextStep": "Talk to Renly at the blacksmith's tent in Clearfell Encampment, then buy a Runic Rod",
    "showTip": True,
}
STUB = """
window.__sizes = [];
window.splitstoneOverlay = {
  onState(cb) { window.__push = cb; }, onLock() {}, onToast() {},
  onTextSize(cb) { window.__size = cb; },
  ready() {}, resize(w, h) { window.__sizes.push([w, h]); },
};
"""
MAX_W = {"s": 440, "m": 520, "l": 600}
results = []


def check(name, ok, info=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""))


def bounds(w, h, pw, ph):
    js = ("const B = require('./desktop/src/overlay-bounds');"
          f"console.log(JSON.stringify(B.topCenterBounds({{ x: 0, y: 0, width: {w}, height: {h} }}, {pw}, {ph})))")
    return json.loads(subprocess.check_output(["node", "-e", js], cwd=ROOT, text=True))


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 320, "height": 72})
    page.add_init_script(STUB)
    page.goto(OVERLAY)
    for size in ("s", "m", "l"):
        page.evaluate("s => window.__size(s)", size)
        page.evaluate("st => window.__push(st)", LONG)
        page.wait_for_timeout(100)
        w, h = page.evaluate("window.__sizes[window.__sizes.length - 1]")
        page.set_viewport_size({"width": w, "height": h})  # what main does with setBounds
        page.wait_for_timeout(100)
        m = page.evaluate("""() => {
          const rows = [...document.querySelectorAll('#panel .row')], wrap = document.getElementById('wrap').getBoundingClientRect();
          return { rows: rows.map(r => ({ cls: r.className, text: r.textContent, sh: r.scrollHeight, ch: r.clientHeight,
                     lines: Math.round(r.getBoundingClientRect().height / parseFloat(getComputedStyle(r).lineHeight)) })),
                   panelW: document.getElementById('panel').getBoundingClientRect().width,
                   bottom: wrap.bottom, right: wrap.right, vh: innerHeight, vw: innerWidth };
        }""")
        rows = {r["cls"].split()[-1]: r for r in m["rows"]}
        check(f"{size}: step, hint and next only", sorted(rows) == ["next", "step", "tip"], list(rows))
        check(f"{size}: hint shown in full", rows["tip"]["text"] == LONG["tip"] and "…" not in rows["tip"]["text"], rows["tip"]["text"][-40:])
        check(f"{size}: no row clipped (scrollHeight <= clientHeight)", all(r["sh"] <= r["ch"] for r in m["rows"]), m["rows"])
        check(f"{size}: long hint wraps over several lines", rows["tip"]["lines"] >= 3, rows["tip"]["lines"])
        check(f"{size}: panel width capped at {MAX_W[size]}px", m["panelW"] <= MAX_W[size] + 0.5 and m["panelW"] >= MAX_W[size] - 30, m["panelW"])
        check(f"{size}: window fitted to the content", m["bottom"] <= m["vh"] and m["right"] <= m["vw"] and h - m["bottom"] <= 8, m)
    check("text size changes ask for a new window size", len({tuple(s) for s in page.evaluate("window.__sizes")}) >= 3)

    # Large over a mock 1920x1080 game screen at the default (top centre) spot.
    page.evaluate("s => window.__size(s)", "l")
    page.evaluate("st => window.__push(st)", LONG)
    page.wait_for_timeout(100)
    w, h = page.evaluate("window.__sizes[window.__sizes.length - 1]")
    page.set_viewport_size({"width": w, "height": h})
    panel = page.screenshot(omit_background=True)
    box = bounds(1920, 1080, w, h)
    check("Large overlay centred on a 1920 display", abs(box["x"] + box["width"] / 2 - 960) <= 1, box)
    scene = b.new_page(viewport={"width": 1920, "height": 1080})
    scene.set_content(f"""<body style="margin:0;width:1920px;height:1080px;position:relative;overflow:hidden;
      background:radial-gradient(circle at 50% 60%,#5a6b4a,#2a3022 55%,#141810);font-family:Segoe UI,sans-serif">
      <div style="position:absolute;top:28px;left:50%;transform:translateX(-50%);width:620px;text-align:center;color:#e8d9b0;font-size:15px;letter-spacing:1px">
        THE DEVOURER<div style="margin-top:6px;height:18px;border:1px solid #6a5a3a;background:linear-gradient(90deg,#9e2a1f 72%,#2a1210 72%)"></div></div>
      <div style="position:absolute;top:12px;right:12px;width:{round(1920 * .17) - 12}px;height:300px;border:1px solid #5a5040;background:#0c0e0acc"></div>
      <img src="data:image/png;base64,{base64.b64encode(panel).decode()}" style="position:absolute;left:{box['x']}px;top:{box['y']}px;opacity:.8">
      <div style="position:absolute;bottom:16px;left:16px;color:#c8c0a8;font-size:13px">Mock 1920x1080 game screen · overlay at Large, default top-centre spot (y = 11% of height)</div></body>""")
    scene.screenshot(path=str(shot_dir() / "overlay-top-center.png"))
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
