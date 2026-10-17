#!/usr/bin/env python3
"""Practice mode: scoped order, separate PB, enter/exit UI."""
import os, sys
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
from shot_dir import shot_dir  # noqa: E402
from tracker_url import TRACKER_URL

URL = TRACKER_URL
ROOT = Path(__file__).resolve().parent.parent
SHOT = shot_dir() / "practice-mode.png"
results = []

def check(name, cond, info=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{info}]" if info and not cond else ""))

def js(page, expr):
    return page.evaluate(expr)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 1000})
    page.add_init_script(
        "window.state_c = () => { const s = JSON.parse(localStorage.getItem('splitstone:v1'));"
        " return s.characters[s.activeId]; }")
    page.clock.install()
    page.goto(URL)
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_function("() => window.Run && window.Storage2")
    # Persist default state so state_c() works (render alone does not save).
    page.evaluate("Storage2.save(Storage2.load())")
    page.wait_for_selector("#practiceScope")

    n_full = js(page, "Run.order(state_c()).length")
    check("full campaign has many zones", n_full > 40, n_full)

    page.select_option("#practiceScope", "group:act1")
    page.wait_for_timeout(150)
    st = js(page, """() => {
      const c = state_c(), r = Run.route(c), ord = Run.order(c);
      return {
        practice: r.practice,
        n: ord.length,
        allAct1: ord.every(o => o.group === 'act1'),
        variant: Run.variantKey(r),
        body: document.body.classList.contains('practice-mode'),
        pill: !!document.querySelector('.practice-pill'),
        hiddenActs: document.querySelectorAll('.section[data-section="act2"]').length,
      };
    }""")
    check("practice route set to act1", st["practice"] == {"kind": "group", "id": "act1"}, st)
    check("order only Act 1 zones", st["n"] < n_full and st["n"] > 5 and st["allAct1"], st)
    check("variant key includes practice", "p:group:act1" in st["variant"], st)
    check("practice-mode body class", st["body"] and st["pill"], st)
    check("Act 2 section hidden", st["hiddenActs"] == 0, st)

    page.keyboard.press("Space")
    for _ in range(st["n"] + 8):
        if page.locator("#now .now-finish").count():
            break
        page.clock.run_for(5_000)
        page.keyboard.press("Space")
    fin = js(page, """() => {
      const c = state_c();
      const pracPb = Run.pb(c);
      const fullPb = Run.pb(c, 'normal');
      const h0 = c.history[0];
      return {
        pracPb: pracPb && pracPb.total,
        fullPb,
        variant: h0 && h0.variant,
        practice: h0 && h0.practice,
        complete: h0 && h0.complete,
        zones: h0 && Object.keys(h0.zones || {}).length,
      };
    }""")
    check("practice run completed", bool(fin["complete"] and fin["pracPb"]), fin)
    check("history tagged practice variant", bool(fin["variant"] and "p:group:act1" in fin["variant"]), fin)
    check("full-campaign PB still null", fin["fullPb"] is None, fin)
    check("practice history only act zones", fin["zones"] == st["n"], fin)

    page.click('[data-action="practice-exit"]')
    page.wait_for_timeout(150)
    left = js(page, """() => {
      const c = state_c();
      const pracKey = Run.variantKey({ mode: 'normal', requiredOnly: false,
        practice: { kind: 'group', id: 'act1' } });
      return {
        practice: Run.route(c).practice,
        n: Run.order(c).length,
        fullPb: Run.pb(c, 'normal'),
        pracStill: Run.pb(c, pracKey),
        body: document.body.classList.contains('practice-mode'),
      };
    }""")
    check("exited practice", left["practice"] is None and left["n"] == n_full, left)
    check("full PB still untouched after exit", left["fullPb"] is None, left)
    check("practice PB retained under practice variant",
          bool(left["pracStill"] and left["pracStill"].get("complete")), left)

    page.select_option("#practiceScope", "zone:act1-z01")
    page.wait_for_timeout(100)
    z = js(page, "Run.order(state_c()).map(o => o.zone.id)")
    check("single-zone practice order", z == ["act1-z01"], z)

    page.select_option("#practiceScope", "group:act1")
    page.wait_for_timeout(100)
    page.locator("#practiceScope").scroll_into_view_if_needed()
    page.screenshot(path=str(SHOT), full_page=False)
    print("wrote", SHOT, SHOT.stat().st_size)
    b.close()

failed = [n for n, ok in results if not ok]
print(f"{sum(1 for _, ok in results if ok)}/{len(results)} passed")
sys.exit(1 if failed else 0)
