#!/usr/bin/env python3
"""Record the README demo: screenshots/demo.gif, plus an MP4 copy for posts.

Drives the web app on a fake clock with demo data (a character called "Demo"), then shows the desktop
overlay page over a mock game screen. Frames are captured one by one, so timing is exact and nothing
drops. Not part of the test suites; run it by hand when the UI changes:

  python3 -m http.server 8765 --bind 127.0.0.1 &
  python3 scripts/record_demo.py [--mp4 path/to/demo.mp4]

Needs Playwright (chromium) and ffmpeg.
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))
from tracker_url import TRACKER_URL  # noqa: E402

FPS = 12
TICK = 1000 // FPS
W, H = 1280, 720
OUT_W = 960
SCENE = TRACKER_URL.rstrip("/") + "/__demo_scene.html"
OVERLAY = TRACKER_URL.rstrip("/") + "/desktop/overlay/overlay.html"

# The overlay page's bridge, as the desktop app's preload provides it. fitWidth narrows the frame like main does.
STUB = """
window.splitstoneOverlay = {
  onState(cb) { window.__push = cb; }, onLock() {}, onToast() {}, onBox(cb) { window.__box = cb; },
  ready() {}, resize() {},
  fitWidth(w) { if (window.parent !== window && window.parent.__fit) window.parent.__fit(w); },
};
"""
SCENE_HTML = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body {{ margin: 0; width: {W}px; height: {H}px; position: relative; overflow: hidden; font-family: "Segoe UI", sans-serif;
    background: linear-gradient(180deg, #1d2219, #2b3324 60%, #232a1d); }}
  .ground {{ position: absolute; inset: 300px 0 0 0; background: linear-gradient(180deg, #2b3324, #3a3a2a); }}
  .boss {{ position: absolute; top: 18px; left: 50%; transform: translateX(-50%); width: 420px; text-align: center;
    color: #e8d9b0; font-size: 13px; letter-spacing: 1px; }}
  .bar {{ margin-top: 5px; height: 12px; border: 1px solid #6a5a3a; background: linear-gradient(90deg, #9e2a1f 64%, #2a1210 64%); }}
  .map {{ position: absolute; top: 10px; right: 10px; width: 200px; height: 200px; border: 1px solid #5a5040; background: #0c0e0acc; }}
  .hero {{ position: absolute; left: 50%; top: 58%; width: 26px; height: 46px; margin-left: -13px; border-radius: 13px 13px 4px 4px;
    background: #17120c; }}
  #ov {{ position: absolute; top: 79px; left: 50%; border: 0; background: transparent; opacity: .8;
    transform: translateX(-50%) scale(1.75); transform-origin: top center; }}
  .cap {{ position: absolute; left: 24px; bottom: 22px; color: #f0e6cf; font-size: 22px; text-shadow: 0 1px 3px #000; }}
  .cap small {{ display: block; font-size: 15px; color: #c8c0a8; margin-top: 4px; }}
</style></head><body>
  <div class="boss">THE DEVOURER<div class="bar"></div></div><div class="ground"></div><div class="map"></div><div class="hero"></div>
  <iframe id="ov" src="{OVERLAY}" width="400" height="80"></iframe>
  <div class="cap" id="cap"></div>
  <script>window.__fit = w => {{ document.getElementById('ov').width = Math.max(200, w); }};</script>
</body></html>"""

# A personal best and an older attempt, so the splits have deltas and the Runs tab has history.
SEED = """([now]) => {
  localStorage.clear();
  const s = Storage2.load(), c = s.characters[s.activeId];
  c.name = 'Demo'; c.classId = 'warrior'; c.level = 9;
  s.settings.ghostMode = true; s.settings.seen.firstRunTip = true; s.settings.seen.ghostHint = true;
  const order = Run.order(c), ids = order.map(o => o.zone.id), variant = Run.variantKey(Run.route(c));
  const zones = n => Object.fromEntries(ids.slice(0, n).map((z, i) => [z, 52000 + (i * 7919) % 30000]));
  const pb = zones(ids.length), sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  const old = zones(14);
  c.history = [
    { id: 'demo-pb', complete: true, variant, total: sum(pb), zones: pb, sections: {}, groups: {},
      finished: new Date(now - 3 * 864e5).toISOString(), splitsDone: ids.length, zonesTotal: ids.length },
    { id: 'demo-old', complete: false, variant, total: sum(old) + 60000, zones: old, sections: {}, groups: {},
      finished: new Date(now - 6 * 864e5).toISOString(), splitsDone: 14, zonesTotal: ids.length },
  ];
  c.bests = { [variant]: Object.fromEntries(ids.map(z => ['zone:' + z, Math.round(pb[z] * 0.9)])) };
  localStorage.setItem('splitstone:v1', JSON.stringify(s));
}"""
NOW_STEP = """() => {
  const o = document.querySelector('#now .now-obj-text'), n = document.querySelector('#now .now-next > div');
  return { step: o ? o.getAttribute('title') : '', nextStep: n ? n.textContent.replace(/^\\s*Next step\\s*/, '').trim() : '' };
}"""


class Recorder:
    def __init__(self, folder):
        self.folder, self.n = folder, 0

    def frame(self, page):
        page.screenshot(path=str(self.folder / f"f{self.n:04d}.png"))
        self.n += 1

    def hold(self, page, seconds, clock_ms=TICK, clock=True):
        """Capture for this many seconds of GIF time, moving the app clock clock_ms per frame."""
        for _ in range(round(seconds * FPS)):
            self.frame(page)
            if clock:
                page.clock.run_for(clock_ms)


def record(folder):
    rec = Recorder(folder)
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": W, "height": H})
        app = ctx.new_page()
        start = datetime(2026, 10, 17, 19, 0, 0)
        app.clock.install(time=start)
        app.goto(TRACKER_URL)
        app.evaluate(SEED, [int(start.timestamp() * 1000)])
        app.reload()
        app.wait_for_selector("#now")

        # A run already a few zones in.
        app.keyboard.press("Space")
        for ms in (61_000, 74_000, 49_000, 88_000, 57_000):
            app.clock.run_for(ms)
            app.keyboard.press("Space")
        app.clock.run_for(23_000)
        app.mouse.move(W - 5, H - 5)
        app.wait_for_timeout(300)

        rec.hold(app, 3.0)                              # Campaign mid-run, timers ticking
        for _ in range(3):                              # time-lapse to each split, zones fold
            rec.hold(app, 1.2, clock_ms=3_500)
            app.keyboard.press("Space")
            app.clock.run_for(TICK)
            rec.hold(app, 0.6)
        for sec in ("act2", "act3"):                    # browse acts with the strip
            app.click(f"#act-tab-{sec}")
            app.wait_for_timeout(250)
            rec.hold(app, 1.4)
        app.click("#act-tab-act1")
        app.wait_for_timeout(250)
        rec.hold(app, 1.2)
        for tab in ("runs", "endgame"):                 # the other tabs
            app.click(f"#tab-{tab}")
            app.wait_for_timeout(250)
            app.mouse.move(W - 5, H - 5)
            rec.hold(app, 1.6)
        app.click("#tab-campaign")
        app.wait_for_timeout(200)

        # The desktop overlay over a mock game screen.
        scene = ctx.new_page()
        scene.add_init_script(STUB)
        scene.route(SCENE, lambda r: r.fulfill(status=200, content_type="text/html", body=SCENE_HTML))
        scene.goto(SCENE)
        ov = scene.frame_locator("#ov")
        frame = scene.frame(url=OVERLAY)
        frame.wait_for_function("!!window.__push")
        frame.evaluate("() => window.__box({ width: 400, height: 80, custom: false, grow: 'both' })")

        def show(state, caption, sub=""):
            frame.evaluate("st => window.__push(st)", state)
            scene.evaluate("([c, s]) => { document.getElementById('cap').innerHTML = c + (s ? '<small>' + s + '</small>' : ''); }",
                           [caption, sub])
            scene.wait_for_timeout(200)

        st = {"v": 1, "theme": "ember", **app.evaluate(NOW_STEP)}
        show(st, "In-game overlay", "Current step and next step, always on top")
        rec.hold(scene, 2.4, clock=False)
        before = st["step"]
        app.clock.run_for(40_000)
        app.click('#now [data-action="split"]')         # a split in the app moves the overlay on
        app.wait_for_timeout(200)
        st = {**st, **app.evaluate(NOW_STEP)}
        assert st["step"] != before, "the split didn't move the step on"
        show(st, "In-game overlay", "Split: it moves to the next step")
        rec.hold(scene, 2.4, clock=False)
        for theme in ("slate", "crimson", "parchment"):
            show({**st, "theme": theme}, "Follows the app's theme", theme.title())
            rec.hold(scene, 1.2, clock=False)
        assert ov.locator("#panel").count() == 1
        b.close()
    return rec.n


def encode(folder, gif, mp4):
    src = ["-framerate", str(FPS), "-i", str(folder / "f%04d.png")]
    palette = folder / "palette.png"
    scale = f"scale={OUT_W}:-1:flags=lanczos"
    run = lambda *a: subprocess.run(["ffmpeg", "-v", "error", "-y", *a], check=True)
    run(*src, "-vf", f"{scale},palettegen=stats_mode=diff", str(palette))
    run(*src, "-i", str(palette), "-lavfi", f"{scale}[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle",
        "-loop", "0", str(gif))
    if mp4:
        run(*src, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow", "-movflags", "+faststart", str(mp4))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--gif", default=str(ROOT / "screenshots" / "demo.gif"))
    ap.add_argument("--mp4", help="also write an MP4 at the full 1280x720")
    ap.add_argument("--keep-frames", help="copy the PNG frames to this folder")
    args = ap.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        n = record(folder)
        encode(folder, Path(args.gif), args.mp4 and Path(args.mp4))
        if args.keep_frames:
            shutil.copytree(folder, args.keep_frames, dirs_exist_ok=True)
    print(json.dumps({"frames": n, "seconds": round(n / FPS, 2), "gif": args.gif,
                      "gif_bytes": Path(args.gif).stat().st_size}))


if __name__ == "__main__":
    main()
