#!/usr/bin/env python3
"""Desktop overlay: current step and next step only, text scaled to fit the window, resize grip,
default spot centred below the boss bar. Loads desktop/overlay/overlay.html with a stub bridge (no Electron)
and checks the app's overlay payload. Writes overlay-top-center.png, overlay-resized-large.png and
overlay-resized-small.png to test-output/ (screenshots/ with SPLITSTONE_UPDATE_SHOTS=1)."""
import base64
import json
import subprocess
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
from shot_dir import shot_dir  # noqa: E402
from tracker_url import TRACKER_URL  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OVERLAY = (ROOT / "desktop" / "overlay" / "overlay.html").as_uri()
HINT = "Fight him in the corner opposite the entrance, then walk straight past the blockade into town."
LONG = {
    "step": "Kill the Devourer, then take the waypoint and head north-east through the Mud Burrow to the Grelwood",
    "tip": HINT, "showTip": True,
    "nextStep": "Talk to Renly at the blacksmith's tent in Clearfell Encampment, then buy a Runic Rod",
}
SHORT = {"step": "Enter Clearfell", "nextStep": "Kill Beira", "tip": HINT}
HUGE = {"step": " ".join(["Follow the long road past every ruin and shrine"] * 12), "nextStep": "And then keep going " * 10}
STUB = """
window.__fit = []; window.__resize = [];
window.splitstoneOverlay = {
  onState(cb) { window.__push = cb; }, onLock(cb) { window.__lock = cb; }, onToast() {},
  onBox(cb) { window.__box = cb; },
  ready() {}, fitWidth(w) { window.__fit.push(w); }, resize(w, h, done) { window.__resize.push([w, h, done]); },
};
"""
MEASURE = """() => {
  const t = document.getElementById('text'), rows = [...t.querySelectorAll('.row')];
  const p = document.getElementById('panel'), cs = getComputedStyle(p);
  const room = p.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  return { font: parseFloat(p.dataset.font), sh: t.scrollHeight, ch: room,
           sw: t.scrollWidth, cw: t.clientWidth, rows: rows.map(r => r.className.replace(' clamp', '')), html: document.body.innerHTML,
           clamped: rows.filter(r => r.classList.contains('clamp')).length };
}"""
results = []


def check(name, ok, info=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""))


def node(js):
    return json.loads(subprocess.check_output(["node", "-e", "const B = require('./desktop/src/overlay-bounds');" + js], cwd=ROOT, text=True))


def show(page, box, state, custom=False):
    """What main does: the window is the box, narrowed when the overlay asks for it at the default size."""
    page.set_viewport_size({"width": box[0], "height": box[1]})
    page.evaluate("([w, h, c]) => { window.__fit = []; window.__box({ width: w, height: h, custom: c }); }", [box[0], box[1], custom])
    page.evaluate("st => window.__push(st)", state)
    page.wait_for_timeout(60)
    fit = page.evaluate("window.__fit")
    if fit and not custom:
        page.set_viewport_size({"width": fit[-1], "height": box[1]})
        page.wait_for_timeout(40)
    return page.evaluate(MEASURE)


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 360, "height": 64})
    page.add_init_script(STUB)
    page.goto(OVERLAY)
    page.wait_for_timeout(100)

    default = node("console.log(JSON.stringify([1080, 1440, 2160].map(h => B.defaultSize({ x: 0, y: 0, width: h * 16 / 9, height: h }))))")
    check("default size is 400x72 at 1080p and scales with the display", default[0] == {"width": 400, "height": 72}
          and default[1]["width"] == 533 and default[2]["width"] == 800, default)
    for w, h in [(1280, 720), (1920, 1080), (2560, 1440)]:
        bb = node(f"console.log(JSON.stringify(B.topCenterBounds({{ x: 0, y: 0, width: {w}, height: {h} }})))")
        check(f"{w}x{h}: default spot centred, below the boss bar", abs(bb["x"] + bb["width"] / 2 - w / 2) <= 1
              and bb["y"] == round(h * 0.11), bb)

    m = show(page, (400, 72), LONG)
    check("only the step and next step are drawn", m["rows"] == ["row step", "row next"], m["rows"])
    check("no hint in the overlay DOM, whatever showTip says", HINT not in m["html"] and "tip" not in m["html"])
    check("default size: long step fits without clipping", m["sh"] <= m["ch"] + 1 and m["sw"] <= m["cw"] + 1, m)
    long_font = m["font"]
    s = show(page, (400, 72), SHORT)
    check("text shrinks to fit: a long step gets a smaller font than a short one", long_font < s["font"], (long_font, s["font"]))
    check("default size: a short step asks for a narrower window", page.evaluate("window.__fit")[-1] < 400, page.evaluate("window.__fit"))
    small = show(page, (400, 72), LONG, custom=True)["font"]
    big = show(page, (720, 128), LONG, custom=True)
    check("text grows with the window", big["font"] >= small * 1.6, (small, big["font"]))
    check("after a resize the overlay keeps the player's size", page.evaluate("window.__fit") == [])
    for size in [(240, 48), (360, 64), (400, 72), (480, 85), (640, 110), (900, 160)]:
        r = show(page, size, LONG, custom=True)
        check(f"{size[0]}x{size[1]}: nothing clipped, nothing cut above the minimum font",
              r["sh"] <= r["ch"] + 1 and (r["clamped"] == 0 or r["font"] == 11), r)
    steps = json.loads(subprocess.check_output(["node", "-e", "global.window = global; require('./data/campaign.js');"
        "console.log(JSON.stringify(CAMPAIGN_DATA.sections.flatMap(s => s.zones.flatMap(z => z.steps.map(x => x.objective)))))"],
        cwd=ROOT, text=True))
    cut = []
    for i, st in enumerate(steps):
        r = show(page, (400, 72), {"step": st, "nextStep": steps[i + 1] if i + 1 < len(steps) else ""}, custom=True)
        if r["clamped"]:
            cut.append(st)
    check(f"default size: all {len(steps)} route steps and their next step fit uncut", not cut, cut[:3])
    t = show(page, (200, 44), HUGE, custom=True)
    check("at the minimum font, very long text is cut to the lines that fit", t["font"] == 11 and t["clamped"] >= 1
          and t["sh"] <= t["ch"] + 1, t)

    # Resize grip: only in move mode, reports the new size and when the drag ends.
    check("grip hidden while locked", not page.locator("#grip").is_visible())
    page.evaluate("window.__lock(false)")
    show(page, (400, 72), LONG, custom=True)
    g = page.locator("#grip").bounding_box()
    page.mouse.move(g["x"] + 8, g["y"] + 8); page.mouse.down()
    page.mouse.move(g["x"] + 108, g["y"] + 48, steps=4); page.mouse.up()
    rs = page.evaluate("window.__resize")
    check("dragging the grip asks main for the new size", rs and rs[-1][2] is True and rs[-1][0] == 500 and rs[-1][1] == 112, rs)
    page.evaluate("window.__lock(true)")

    clamp = node("const wa = { x: 0, y: 0, width: 1920, height: 1080 };"
                 "console.log(JSON.stringify([B.clampSize({ width: 50, height: 10 }, wa), B.clampSize({ width: 9999, height: 9999 }, wa),"
                 " B.clampSize(null, wa), B.defaultSize(wa, 'l')]))")
    check("resize limits and the old Large size", clamp[0] == {"width": 200, "height": 44} and clamp[1]["width"] <= 1344
          and clamp[1]["height"] <= 486 and clamp[2] == {"width": 400, "height": 72} and clamp[3]["width"] == 520, clamp)

    # The app's overlay payload carries no hint, even with hints showing in the app.
    app = b.new_page()
    app.goto(TRACKER_URL)
    app.evaluate("localStorage.clear()"); app.reload()
    app.evaluate("""() => { const st = AutoSplit.status;
        AutoSplit.status = () => Object.assign({}, st(), { state: "connected" });
        AutoSplit.pushState = s => { window.__ov = s; }; }""")
    app.keyboard.press("Space"); app.wait_for_timeout(1100)
    ov = app.evaluate("window.__ov")
    shown = app.text_content("#now .now-hints") or ""
    check("payload: step and next step, no hint fields", ov and ov.get("step") and "nextStep" in ov
          and "tip" not in ov and "showTip" not in ov, ov)
    check("payload has none of the hint text the app shows", shown and shown.strip() not in json.dumps(ov), (shown, ov))

    # Default, large and small over a mock 1920x1080 game screen.
    def scene(name, box, custom, label):
        show(page, box, LONG, custom)
        vw = page.viewport_size["width"]
        panel = page.screenshot(omit_background=True)
        bb = node(f"console.log(JSON.stringify(B.topCenterBounds({{ x: 0, y: 0, width: 1920, height: 1080 }}, {vw}, {box[1]})))")
        sc = b.new_page(viewport={"width": 1920, "height": 1080})
        sc.set_content(f"""<body style="margin:0;width:1920px;height:1080px;position:relative;overflow:hidden;
          background:radial-gradient(circle at 50% 60%,#5a6b4a,#2a3022 55%,#141810);font-family:Segoe UI,sans-serif">
          <div style="position:absolute;top:28px;left:50%;transform:translateX(-50%);width:620px;text-align:center;color:#e8d9b0;font-size:15px;letter-spacing:1px">
            THE DEVOURER<div style="margin-top:6px;height:18px;border:1px solid #6a5a3a;background:linear-gradient(90deg,#9e2a1f 72%,#2a1210 72%)"></div></div>
          <div style="position:absolute;top:12px;right:12px;width:{round(1920 * .17) - 12}px;height:300px;border:1px solid #5a5040;background:#0c0e0acc"></div>
          <img src="data:image/png;base64,{base64.b64encode(panel).decode()}" style="position:absolute;left:{bb['x']}px;top:{bb['y']}px;opacity:.8">
          <div style="position:absolute;bottom:16px;left:16px;color:#c8c0a8;font-size:13px">Mock 1920x1080 game screen · {label}</div></body>""")
        sc.screenshot(path=str(shot_dir() / name))
        sc.close()
    scene("overlay-top-center.png", (400, 72), False, "overlay at its default size and spot (top centre, y = 11% of height)")
    scene("overlay-resized-large.png", (640, 112), True, "overlay resized larger: the text scales up")
    scene("overlay-resized-small.png", (240, 48), True, "overlay resized smaller: the text scales down")
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
