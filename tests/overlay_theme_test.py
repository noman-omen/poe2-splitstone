#!/usr/bin/env python3
"""Desktop overlay theme and the Show in-game overlay switch.

The overlay (desktop/overlay/overlay.html with a stub bridge) takes the app's theme from the state snapshot and
switches live; step and Next keep 4.5:1 contrast for every theme over dark, mid, light and coloured game frames
across the whole opacity range. The app (TRACKER_URL with a stub desktop bridge) sends its theme, and Settings →
Desktop has the switch, which greys out the overlay's own settings while off. Writes overlay-theme-<name>.png and
settings-overlay-on/off.png to test-output/ (screenshots/ with SPLITSTONE_UPDATE_SHOTS=1)."""
import base64
import re
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
from shot_dir import shot_dir  # noqa: E402
from tracker_url import TRACKER_URL  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OVERLAY = (ROOT / "desktop" / "overlay" / "overlay.html").as_uri()
THEMES = ["ember", "slate", "crimson", "parchment"]
STATE = {"v": 1, "step": "Kill the Devourer, then take the waypoint", "nextStep": "Talk to Renly at the blacksmith's tent", "opacity": 0.8}
STUB = """
window.splitstoneOverlay = {
  onState(cb) { window.__push = cb; }, onLock(cb) { window.__lock = cb; }, onToast() {}, onBox(cb) { window.__box = cb; },
  ready() {}, fitWidth() {}, resize() {},
};
"""
DESKTOP = """
window.__pushed = []; window.__enabled = [];
window.splitstoneDesktop = new Proxy({ isDesktop: true,
  getStatus: async () => ({ watching: true, logExists: true, resolvedLogPath: 'Client.txt', overlayEnabled: true,
                            overlayOpacity: 0.8, overlayPosition: 'top-center', clickThrough: true, hotkeys: {} }),
  onStatus(cb) { window.__status = cb; return () => {}; },
  pushOverlayState(st) { window.__pushed.push(st); },
  setOverlayEnabled: async on => { window.__enabled.push(on); return on; },
}, { get(t, k) {
  if (k in t) return t[k];
  if (typeof k === 'string' && k.startsWith('on')) return () => () => {};
  return async () => ({});
} });
"""
# Game frames the overlay can sit on: black, mid grey, white sky, a red boss bar, a blue skybox.
FRAMES = [(0, 0, 0), (128, 128, 128), (255, 255, 255), (200, 40, 30), (60, 120, 200)]
results = []


def check(name, ok, info=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""))


def rgb(css):
    return tuple(int(float(x)) for x in re.findall(r"[\d.]+", css)[:3])


def lum(c):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(v) for v in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def over(c, frame, a):
    """The window is faded as a whole: each pixel is a mix of the overlay and the game behind it."""
    return tuple(a * x + (1 - a) * y for x, y in zip(c, frame))


def contrast(fg, bg):
    hi, lo = sorted((lum(fg), lum(bg)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 400, "height": 80})
    page.add_init_script(STUB)
    page.goto(OVERLAY)
    page.wait_for_function("!!window.__push")
    page.evaluate("() => window.__box({ width: 400, height: 80, custom: true, grow: 'both' })")

    def colours():
        return page.evaluate("""() => { const p = document.getElementById('panel'), rows = document.querySelectorAll('#text .row');
          return { theme: document.body.dataset.theme, bg: getComputedStyle(p).backgroundColor,
                   step: getComputedStyle(rows[0]).color, next: rows[1] ? getComputedStyle(rows[1]).color : null }; }""")

    page.evaluate("st => window.__push(st)", {k: v for k, v in STATE.items()})
    check("no theme in the snapshot: Ember", colours()["theme"] == "ember")
    seen = {}
    for t in THEMES:
        page.evaluate("st => window.__push(st)", {**STATE, "theme": t})
        page.wait_for_timeout(30)
        seen[t] = colours()
        check(f"{t}: overlay takes the theme", seen[t]["theme"] == t, seen[t])
    check("every theme looks different", len({(c["bg"], c["step"], c["next"]) for c in seen.values()}) == 4, seen)
    page.evaluate("st => window.__push(st)", {**STATE, "theme": "parchment"})
    page.evaluate("st => window.__push(st)", {**STATE, "theme": "slate"})
    check("live switching: the latest theme wins without a reload", colours() == seen["slate"], colours())
    for bad in ["neon", "Slate", "ember;color:red", 5, None]:
        page.evaluate("st => window.__push(st)", {**STATE, "theme": bad})
        if colours()["theme"] != "ember":
            break
    check("an unknown theme falls back to Ember", colours() == seen["ember"], colours())

    minimum = float(re.search(r'id="overlayOpacity" min="(\d+)"', (ROOT / "index.html").read_text()).group(1)) / 100
    check("the opacity slider starts at 65%", minimum == 0.65, minimum)
    for t, c in seen.items():
        worst = min((contrast(over(rgb(c[role]), f, a / 100), over(rgb(c["bg"]), f, a / 100)), role, a, f)
                    for role in ("step", "next") for a in range(65, 101) for f in FRAMES)
        check(f"{t}: step and Next keep 4.5:1 from 65% to 100% over any frame", worst[0] >= 4.5,
              f"{worst[0]:.2f} for {worst[1]} at {worst[2]}% over {worst[3]}")
        idle = contrast(rgb(c["next"]), rgb(c["bg"]))
        check(f"{t}: Next is readable at full opacity (7:1)", idle >= 7, f"{idle:.2f}")

    # One shot per theme over the mock 1920x1080 game screen, at the default 80%.
    for t in THEMES:
        page.evaluate("st => window.__push(st)", {**STATE, "theme": t})
        page.wait_for_timeout(60)
        panel = page.screenshot(omit_background=True)
        sc = b.new_page(viewport={"width": 1000, "height": 260})
        sc.set_content(f"""<body style="margin:0;width:1000px;height:260px;position:relative;overflow:hidden;
          background:radial-gradient(circle at 50% 90%,#5a6b4a,#2a3022 55%,#141810);font-family:Segoe UI,sans-serif">
          <div style="position:absolute;top:28px;left:50%;transform:translateX(-50%);width:620px;text-align:center;color:#e8d9b0;font-size:15px;letter-spacing:1px">
            THE DEVOURER<div style="margin-top:6px;height:18px;border:1px solid #6a5a3a;background:linear-gradient(90deg,#9e2a1f 72%,#2a1210 72%)"></div></div>
          <img src="data:image/png;base64,{base64.b64encode(panel).decode()}" style="position:absolute;left:300px;top:119px;opacity:.8">
          <div style="position:absolute;bottom:12px;left:16px;color:#c8c0a8;font-size:13px">Overlay in the {t.title()} theme, 80% opacity</div></body>""")
        sc.screenshot(path=str(shot_dir() / f"overlay-theme-{t}.png"))
        sc.close()
    page.close()

    # The app side: its theme rides on the overlay snapshot, and the switch in Settings → Desktop.
    app = b.new_page(viewport={"width": 1280, "height": 900})
    errs = []
    app.on("pageerror", lambda e: errs.append(str(e)))
    app.add_init_script(DESKTOP)
    app.goto(TRACKER_URL)
    app.evaluate("localStorage.clear()")
    app.reload()
    app.wait_for_timeout(300)
    app.click('button[aria-label="Settings"]')
    app.wait_for_timeout(150)
    check("Settings → Desktop shows the switch, on by default",
          app.locator("#desktopOverlayEnabled").is_visible() and app.is_checked("#desktopOverlayEnabled")
          and "Show in-game overlay" in app.text_content("label:has(#desktopOverlayEnabled)"))
    for t in THEMES:
        app.evaluate("() => window.__pushed = []")
        app.click(f'#themeGrid [data-id="{t}"]')
        app.wait_for_timeout(60)
        sent = app.evaluate("window.__pushed")
        check(f"picking {t.title()} sends it to the overlay at once", sent and sent[-1].get("theme") == t, sent[-1:] if sent else sent)
    app.click('#themeGrid [data-id="ember"]')
    app.evaluate("() => window.__pushed = []")
    app.reload()
    app.wait_for_timeout(300)
    check("the overlay gets the saved theme on start", any(s.get("theme") == "ember" for s in app.evaluate("window.__pushed")))

    app.click('button[aria-label="Settings"]')
    app.wait_for_timeout(150)
    app.locator("#desktopSettingsBlock").screenshot(path=str(shot_dir() / "settings-overlay-on.png"))
    deps = ["#overlayOpacity", "#overlayPosition", "#desktopClickThrough", '[data-action="overlay-reset-pos"]']
    app.uncheck("#desktopOverlayEnabled")
    app.wait_for_timeout(60)
    check("turning it off tells the desktop app", app.evaluate("window.__enabled") == [False], app.evaluate("window.__enabled"))
    check("while off, the overlay's own settings are greyed out", all(app.is_disabled(s) for s in deps))
    app.locator("#desktopSettingsBlock").screenshot(path=str(shot_dir() / "settings-overlay-off.png"))
    app.evaluate("() => window.__status({ overlayEnabled: true, watching: true, logExists: true })")
    app.wait_for_timeout(60)
    check("the tray turning it back on updates Settings", app.is_checked("#desktopOverlayEnabled")
          and not any(app.is_disabled(s) for s in deps))
    app.evaluate("() => window.__status({ overlayEnabled: false, watching: true, logExists: true })")
    app.wait_for_timeout(60)
    check("an off state from the desktop app shows as off", not app.is_checked("#desktopOverlayEnabled")
          and app.is_disabled("#overlayOpacity"))
    check("no JS errors", not errs, errs)
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
