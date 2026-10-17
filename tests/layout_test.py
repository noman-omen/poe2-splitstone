"""Campaign layout: one act at a time, the act switcher, the run panel and the Runs/Character tabs.
Needs the app on TRACKER_URL (see tracker_url.py)."""
import json
import sys

from playwright.sync_api import sync_playwright
from modal_helpers import auto_accept_modals
from tracker_url import TRACKER_URL

URL = TRACKER_URL
SIZES = [(1280, 720), (1366, 768), (1280, 800), (1920, 1080), (390, 844)]
PLAY_ORDER = ["act1", "act2", "act3", "act4", "int2a", "int3", "int2b", "int1"]
results = []


def check(name, ok, info=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""))


# Which sections have zones rendered or visible, mapped through the route order.
ACTS_ON_SCREEN = """() => {
  const s = Storage2.load(), c = s.characters[s.activeId];
  const secOf = Object.fromEntries(Run.order(c).map(o => [o.zone.id, o.section.id]));
  const zones = [...document.querySelectorAll('#campaign .zone[data-zone]')];
  const vis = zones.filter(z => { const r = z.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < innerHeight; });
  return { rendered: [...new Set(zones.map(z => secOf[z.dataset.zone]))], visible: [...new Set(vis.map(z => secOf[z.dataset.zone]))] };
}"""

# The Split button sits fully inside the viewport and nothing covers it.
SPLIT_IN_VIEW = """() => {
  const b = document.querySelector('#now [data-action="split"]');
  if (!b) return 'missing';
  const r = b.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) return 'outside ' + JSON.stringify(r);
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return hit && b.contains(hit) ? 'ok' : 'covered by ' + (hit && hit.className);
}"""

SELECTED = "() => document.querySelector('#actTabs [aria-selected=true]').dataset.id"


def blur(page):
    page.evaluate("document.activeElement && document.activeElement.blur()")


def split(page, n=1, ms=30_000):
    for _ in range(n):
        page.clock.run_for(ms)
        page.keyboard.press("Space")


def zones_left_in_act(page):
    return page.evaluate("""() => { const s = Storage2.load(), c = s.characters[s.activeId], cur = Run.current(c);
      return Run.order(c).filter(o => o.section.id === cur.section.id && !c.split[o.zone.id]).length; }""")


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.clock.install()
    page.goto(URL)
    page.evaluate("localStorage.clear()")
    page.reload()
    auto_accept_modals(page)

    # Header tabs and where things moved
    tabs = [t.strip() for t in page.locator("#viewTabs [role=tab], .views [role=tab]").all_inner_texts()]
    check("header tabs: Campaign | Runs | Character | Endgame | Tools", tabs == ["Campaign", "Runs", "Character", "Endgame", "Tools"], tabs)
    check("character selector and menu stay in the header", page.locator(".topbar #charSelect").count() == 1
          and page.locator(".topbar .more-btn").count() == 1)
    page.click("#tab-runs")
    check("Runs tab: history, analytics and the segments table", all(page.locator(s).is_visible() for s in ("#history", "#stats", "#totals"))
          and not page.locator("#viewCampaign").is_visible())
    page.click("#tab-character")
    check("Character tab: details and PoB import", page.locator("#character .char-card").is_visible()
          and page.locator("#pobCode").is_visible() and not page.locator("#viewRuns").is_visible())
    page.click("#tab-campaign")
    check("campaign: no analytics or history in the view", page.locator("#viewCampaign #stats, #viewCampaign #history").count() == 0)

    # Act strip: play order, roving tabindex, arrows, Home/End
    ids = page.evaluate("() => [...document.querySelectorAll('#actTabs [role=tab]')].map(t => t.dataset.id)")
    check("act tabs in play order, no Endgame", ids == PLAY_ORDER, ids)
    check("tablist labelled, panel labelled by its tab", page.locator("#actTabs [role=tablist][aria-label]").count() == 1
          and page.get_attribute("#actPanel", "aria-labelledby") == "act-tab-act1")
    check("one tab in the tab order", page.locator("#actTabs [role=tab][tabindex='0']").count() == 1)
    page.focus("#act-tab-act1")
    page.keyboard.press("ArrowRight")
    check("ArrowRight selects and focuses the next act", page.evaluate(SELECTED) == "act2"
          and page.evaluate("document.activeElement.id") == "act-tab-act2")
    page.keyboard.press("End")
    check("End goes to the last act", page.evaluate(SELECTED) == "int1")
    page.keyboard.press("ArrowRight")
    check("ArrowRight wraps to the first act", page.evaluate(SELECTED) == "act1")
    page.keyboard.press("ArrowLeft")
    page.keyboard.press("Home")
    check("Home goes to the first act", page.evaluate(SELECTED) == "act1"
          and page.locator("#actTabs [role=tab][tabindex='0']").get_attribute("data-id") == "act1")
    check("only the selected act's zones are in the DOM", page.evaluate(ACTS_ON_SCREEN)["rendered"] == ["act1"])
    tip = page.get_attribute("#act-tab-act2", "title")
    check("tab tooltip shows the act and its time", tip.startswith("Act 2") and "not started" in tip, tip)
    check("tab states use icons, with a text alternative", page.locator("#act-tab-act1 svg.ico").count() == 1
          and "current" in page.text_content("#act-tab-act1 .sr-only"))

    # Auto-select follows the run; browsing doesn't snap back
    blur(page)
    page.keyboard.press("Space")
    split(page, 3)
    check("folded: completed zone is one line", page.locator(".zone.complete.folded").count() == 3
          and page.locator(".zone.folded .step").count() == 0)
    page.click('.zone.folded [data-action="zone-toggle"] >> nth=0')
    first = page.locator(".zone.complete >> nth=0")
    check("clicking a folded zone opens it", first.locator(".step").count() > 0
          and first.locator("[data-action=zone-toggle]").get_attribute("aria-expanded") == "true")
    check("current zone stays open", page.locator(".zone.current .step").count() > 0)
    page.click("#act-tab-act3"); blur(page)
    split(page)
    check("a split inside the act keeps the act being browsed", page.evaluate(SELECTED) == "act3")
    check("Current act pill shown while browsing", page.locator('[data-action="act-current"]').is_visible())
    page.click('[data-action="act-current"]')
    check("Current act pill goes back", page.evaluate(SELECTED) == "act1"
          and page.locator('[data-action="act-current"]').count() == 0)
    page.click("#act-tab-act4"); blur(page)
    page.keyboard.press("c")
    check("C jumps to the current act", page.evaluate(SELECTED) == "act1")
    in_col = page.evaluate("""() => { const z = document.querySelector('.zone.current').getBoundingClientRect(),
      col = document.querySelector('#checklistScroll').getBoundingClientRect(); return z.top >= col.top && z.top < col.bottom; }""")
    check("C scrolls the current zone into the checklist column", in_col)
    check("the page itself doesn't scroll", page.evaluate("scrollY") == 0)
    page.click("#act-tab-act3"); blur(page)
    split(page, zones_left_in_act(page))
    check("a split into a new act selects it", page.evaluate(SELECTED) == "act2", page.evaluate(SELECTED))
    check("act 1 tab marked done", "done" in page.get_attribute("#act-tab-act1", "class"))
    page.click("#act-tab-act1"); blur(page)
    ui = json.loads(page.evaluate("localStorage.getItem('splitstone:ui')") or "{}")
    check("act pick kept per character in UI state", list((ui.get("acts") or {}).values()) == ["act1"], ui)
    check("act pick not in the save", "act1" not in json.dumps(json.loads(page.evaluate("localStorage.getItem('splitstone:v1')")).get("ui", "")))
    page.reload(); page.wait_for_timeout(200)
    check("reload shows the current act", page.evaluate(SELECTED) == "act2")

    # Run panel contents
    now = page.text_content("#now")
    check("panel: zone and progress", "Act 2 · zone 1/" in now or "ACT 2 · ZONE 1/" in now.upper(), now[:80])
    check("panel: timers and actions", all(page.locator(s).count() for s in (
        '#now [data-action="split"]', '#now [data-action="pause"]', '#now [data-action="undo"]', '#now [data-action="new-run"]')))
    check("act splits: one row per zone, current highlighted", page.locator("#actSplits tbody tr").count()
          == page.locator("#campaign .zone").count() and page.locator("#actSplits tr.cur[aria-current]").count() == 1)
    check("campaign total and sum of best in the footer", "Campaign" in page.text_content("#runFoot")
          and "Sum of best" in page.text_content("#runFoot"))
    blur(page)
    page.keyboard.press("h")
    check("hide hints still hides hints", not page.locator(".zone .hints").first.is_visible()
          and not page.locator("#now .hints").first.is_visible())
    page.keyboard.press("h")
    state = page.evaluate("localStorage.getItem('splitstone:v1')")
    ui = page.evaluate("localStorage.getItem('splitstone:ui')")

    # Sizes: one act on screen, Split in view, no page scroll on desktop
    for w, h in SIZES:
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.set_viewport_size({"width": w, "height": h})
        pg.goto(URL)
        pg.evaluate("([s, u]) => { localStorage.setItem('splitstone:v1', s); localStorage.setItem('splitstone:ui', u); }", [state, ui])
        pg.reload(); pg.wait_for_timeout(300)
        acts = pg.evaluate(ACTS_ON_SCREEN)
        check(f"{w}x{h}: exactly one act's zones rendered and visible", acts["rendered"] == ["act2"] and acts["visible"] == ["act2"], acts)
        check(f"{w}x{h}: Split visible without scrolling", pg.evaluate(SPLIT_IN_VIEW) == "ok", pg.evaluate(SPLIT_IN_VIEW))
        check(f"{w}x{h}: no sideways overflow", pg.evaluate("document.documentElement.scrollWidth - innerWidth") <= 1)
        if w >= 861:
            check(f"{w}x{h}: page doesn't scroll, the columns do",
                  pg.evaluate("document.documentElement.scrollHeight") <= h + 1)
            panel = pg.evaluate("() => { const r = document.querySelector('#play').getBoundingClientRect(); return [r.width, r.bottom]; }")
            check(f"{w}x{h}: side panel {'360' if w >= 1280 else '320'} px, inside the window",
                  round(panel[0]) == (360 if w >= 1280 else 320) and panel[1] <= h + 1, panel)
        else:
            order = pg.evaluate("""() => ['.checklist', '#actSplits'].map(s => document.querySelector(s).getBoundingClientRect())
              .map(r => [r.top, r.bottom])""")
            check("phone: act splits below the checklist", order[0][1] <= order[1][0], order)
            pg.evaluate("scrollTo(0, 2500)"); pg.wait_for_timeout(100)
            check("phone: Split stays visible when scrolled", pg.evaluate(SPLIT_IN_VIEW) == "ok", pg.evaluate(SPLIT_IN_VIEW))
            bar = pg.evaluate("""() => { const a = document.querySelector('#actTabs').getBoundingClientRect(),
              n = document.querySelector('#now').getBoundingClientRect(), t = document.querySelector('#actTabs .act-tabs');
              return { stuck: Math.abs(a.top - n.bottom) < 2, scrolls: getComputedStyle(t).overflowX }; }""")
            check("phone: act chips stick under the now-bar and scroll sideways", bar["stuck"] and bar["scrolls"] == "auto", bar)
            check("phone: act splits collapsed to the current zone", pg.locator("#actSplits tbody tr").first.is_hidden())
        pg.close()

    # Mid width: act splits fold to the current zone plus the total
    page.set_viewport_size({"width": 1024, "height": 768}); page.wait_for_timeout(200)
    rows = page.locator("#actSplits tbody tr")
    shown = [r for r in rows.all() if r.is_visible()]
    check("mid width: act splits show the current zone and the total", len(shown) == 1 and page.locator("#actSplits tfoot").is_visible())
    page.click('[data-action="act-splits-toggle"]')
    check("mid width: expand shows every zone", all(r.is_visible() for r in page.locator("#actSplits tbody tr").all()))
    page.click('[data-action="act-splits-toggle"]')
    page.set_viewport_size({"width": 1280, "height": 800})

    check("no JS errors", not errs, errs)
    b.close()

passed = sum(ok for _, ok in results)
print(f"\n{passed}/{len(results)} passed")
sys.exit(0 if passed == len(results) else 1)
