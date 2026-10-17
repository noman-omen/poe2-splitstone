#!/usr/bin/env python3
"""Screenshot + assertions for level / XP warnings."""
import os, sys
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
from shot_dir import shot_dir  # noqa: E402
from tracker_url import TRACKER_URL

URL = TRACKER_URL
ROOT = Path(__file__).resolve().parent.parent
SHOT = shot_dir() / "level-xp-warnings.png"
results = []

def check(name, cond, info=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{info}]" if info and not cond else ""))

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 1000})
    page.add_init_script("window.state_c = () => { const s = JSON.parse(localStorage.getItem('splitstone:v1')); return s.characters[s.activeId]; }")
    page.goto(URL)
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_function("() => window.Levels && window.Storage2 && window.Run")

    # Unit: parse + window
    u = page.evaluate("""() => {
      const a = Levels.parseLevelField('30 (area 35)');
      const b = Levels.parseLevelField('15-16');
      const c = Levels.parseLevelField('~28');
      return {
        area35: a && a.areaLevel === 35 && a.recLow === 30 && !a.uncertain,
        band: b && b.areaLevel === 16 && b.uncertain,
        approx: c && c.uncertain && c.areaLevel === 28,
        w1: Levels.xpWindow(1) === 3,
        w16: Levels.xpWindow(16) === 4,
        w32: Levels.xpWindow(32) === 5,
        w48: Levels.xpWindow(48) === 6,
      };
    }""")
    for k, v in u.items():
        check(f"Levels.{k}", v, u)

    # Char lvl 1 vs Cemetery (area 7): gap 6 > window ±3 → bad
    page.click("#tab-character")
    page.fill("#charLevel", "1")
    page.dispatch_event("#charLevel", "change")
    page.click("#tab-campaign")
    page.wait_for_timeout(100)
    st = page.evaluate("""() => {
      const c = state_c();
      const z = Run.ALL.find(o => o.zone.id === 'act1-z09').zone; // Cemetery lvl 7
      const info = Levels.zoneLevelInfo(z);
      const s = Levels.status(Levels.charLevel(c), info);
      const el = document.querySelector('[data-zone="act1-z09"] .zone-lvl');
      const now = document.querySelector('#now .lvl-cue');
      return {
        char: Levels.charLevel(c),
        kind: s && s.kind,
        cue: el && el.textContent,
        now: now && now.textContent,
        nowKind: now && (now.classList.contains('bad') ? 'bad' : now.classList.contains('warn') ? 'warn' : 'ok'),
        under: document.querySelector('[data-zone="act1-z09"].underlevel') != null,
        river: Levels.status(1, Levels.zoneLevelInfo(Run.ALL.find(o => o.zone.id === 'act1-z01').zone)),
      };
    }""")
    check("char level 1 stored", st["char"] == 1, st)
    check("Cemetery underleveled (bad)", st["kind"] == "bad" and st["under"], st)
    check("zone list shows bad cue", st["cue"] and "⚠" in st["cue"], st)
    check("now bar shows route lvl cue", bool(st["now"]), st)
    check("Riverbank ok at lvl 1", st["river"] and st["river"]["kind"] == "ok", st)

    # Approaching: char 5 vs Cemetery 7, window ±3 → warn (gap 2 >= w-1)
    warn = page.evaluate("""() => {
      return Levels.status(5, Levels.zoneLevelInfo(Run.ALL.find(o => o.zone.id === 'act1-z09').zone));
    }""")
    check("Cemetery at char 5 is warn (near edge)", warn and warn["kind"] == "warn", warn)

    # hide-extra hides cues
    page.check("#hideExtra")
    check("hide-extra hides zone-lvl", not page.locator('[data-zone="act1-z09"] .zone-lvl').first.is_visible())
    page.uncheck("#hideExtra")

    # Screenshot: scroll cemetery into view
    page.locator('[data-zone="act1-z09"]').scroll_into_view_if_needed()
    page.screenshot(path=str(SHOT), full_page=False)
    print("wrote", SHOT, SHOT.stat().st_size)
    b.close()

failed = [n for n, ok in results if not ok]
print(f"{sum(ok for _, ok in results)}/{len(results)} passed")
sys.exit(1 if failed else 0)
