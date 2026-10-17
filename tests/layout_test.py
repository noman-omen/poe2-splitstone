"""Campaign layout: one act at a time, the act switcher, the run panel and the Runs/Character tabs.
Needs the app on TRACKER_URL (see tracker_url.py)."""
import json
import sys

from playwright.sync_api import sync_playwright
from modal_helpers import auto_accept_modals
from tracker_url import TRACKER_URL

URL = TRACKER_URL
SIZES = [(1280, 720), (1366, 768), (1280, 800), (1024, 768), (900, 700), (1920, 1080), (2560, 1440), (390, 844)]
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

# Panel lines are inside every clipping box and the window; a clamped objective or hint has its toggle.
PANEL_CUT = """() => {
  const sels = ['.now-obj-text', '.now-hint1 li', '.now-more-toggle:not([hidden])', '.now-next > div', '[data-action=split]',
    '.now-run', '.now-ghost', '.now-zone', '.now-lvl'];
  const bad = [];
  for (const sel of sels) for (const e of document.querySelectorAll('#now ' + sel)) {
    const r = e.getBoundingClientRect();
    if (!r.height) continue;
    if (r.top < -0.5 || r.bottom > innerHeight + 0.5) { bad.push(sel + ' off screen'); continue; }
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') {
        const q = a.getBoundingClientRect();
        if (r.top < q.top - 0.5 || r.bottom > q.bottom + 0.5) { bad.push(sel + ' cut ' + Math.round(r.bottom - q.bottom) + 'px'); break; }
      }
    }
  }
  const d = document.querySelector('#now .now-detail');
  if (d && d.scrollHeight > d.clientHeight + 1) bad.push('step area scrolls');
  const panel = document.querySelector('#now').getBoundingClientRect();
  for (const e of document.querySelectorAll('#now .now-next > div'))
    if (e.getBoundingClientRect().bottom > panel.bottom + 0.5) bad.push('Next past the panel border');
  const foot = document.querySelector('#runFoot');
  if (foot && foot.scrollWidth > foot.clientWidth + 1) bad.push('footer overflows');
  const clamped = [...document.querySelectorAll('#now .now-obj-text, #now .now-hint1 li')].filter(e => e.scrollHeight > e.clientHeight + 1);
  const tog = document.querySelector('#now .now-more-toggle');
  if (clamped.length && (!tog || tog.hidden)) bad.push('clamped with no way to open it');
  if (clamped.some(e => !e.title)) bad.push('clamped without the full text in its title');
  const g = document.querySelector('#now .now-ghost');
  return { zone: document.querySelector('#now .now-zone')?.textContent, bad, clamped: clamped.length,
           ghost: !!g && g.getBoundingClientRect().height > 0 };
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
    page.click('.zone.folded >> nth=0 >> .timer')
    second = page.locator(".zone.complete >> nth=1")
    check("a folded row opens from its time too, not only the name", second.locator(".step").count() > 0
          and second.locator("[data-action=zone-toggle]").get_attribute("aria-expanded") == "true")
    badge = page.text_content("#actPanel .badge")
    check("act badge says it counts steps", badge.endswith(" steps"), badge)
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
        list_w = pg.evaluate("document.querySelector('.checklist').getBoundingClientRect().width")
        if w >= 900:
            check(f"{w}x{h}: checklist at least 560 px wide", list_w >= 560, list_w)
        if w >= 960:
            check(f"{w}x{h}: page doesn't scroll, the columns do",
                  pg.evaluate("document.documentElement.scrollHeight") <= h + 1)
            want = 400 if w >= 1800 else 360 if w >= 1280 else 320
            panel = pg.evaluate("() => { const r = document.querySelector('#play').getBoundingClientRect(); return [r.width, r.bottom]; }")
            check(f"{w}x{h}: side panel {want} px, inside the window", round(panel[0]) == want and panel[1] <= h + 1, panel)
            edges = pg.evaluate("""() => { const x = s => document.querySelector(s).getBoundingClientRect();
              return { brand: x('.brand').left, tabs: x('#tab-campaign').left, list: x('.checklist').left,
                io: x('.topbar .io').right, play: x('#play').right, view: x('#viewCampaign').width }; }""")
            check(f"{w}x{h}: header and tabs line up with the content", abs(edges["brand"] - edges["list"]) <= 1
                  and abs(edges["tabs"] - edges["list"]) <= 1 and abs(edges["io"] - edges["play"]) <= 1, edges)
            if w >= 1920:
                check(f"{w}x{h}: wide container (up to 1840 px)", round(edges["view"]) == min(1840, w), edges)
        if w < 960:
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

    # Short windows: act splits fold too, so the panel keeps its room for the step
    page.set_viewport_size({"width": 1366, "height": 768}); page.wait_for_timeout(200)
    shown = [r for r in page.locator("#actSplits tbody tr").all() if r.is_visible()]
    check("short window: act splits show the current zone and the total", len(shown) == 1 and page.locator("#actSplits tfoot").is_visible())

    # Mid width: act splits fold to the current zone plus the total
    page.set_viewport_size({"width": 1024, "height": 768}); page.wait_for_timeout(200)
    rows = page.locator("#actSplits tbody tr")
    shown = [r for r in rows.all() if r.is_visible()]
    check("mid width: act splits show the current zone and the total", len(shown) == 1 and page.locator("#actSplits tfoot").is_visible())
    page.click('[data-action="act-splits-toggle"]')
    check("mid width: expand shows every zone", all(r.is_visible() for r in page.locator("#actSplits tbody tr").all()))
    page.click('[data-action="act-splits-toggle"]')
    page.set_viewport_size({"width": 1280, "height": 800})

    # Act strip: labels, route-order totals, edge fade at narrow widths
    labels = page.evaluate("() => [...document.querySelectorAll('#actTabs [role=tab]')].map(t => t.querySelector('span:not(.sr-only)').textContent)")
    check("interlude parts read 1/2 and 2/2", "Interlude 2 (1/2)" in labels and "Interlude 2 (2/2)" in labels, labels)
    page.click("#tab-runs")
    rows = page.evaluate("() => [...document.querySelectorAll('#totals tbody tr:not(.sum):not(.grand) th')].map(t => t.textContent.trim())")
    check("Runs totals follow the route order", rows == ["Act 1", "Act 2", "Act 3", "Act 4", "Interlude 2 (1/2)", "Interlude 3",
                                                         "Interlude 2 (2/2)", "Interlude 2 total", "Interlude 1"], rows)
    check("Runs: no link back to the same page", page.locator('#history a[href="#stats"]').count() == 0)
    page.click("#tab-character")
    edges = page.evaluate("() => [document.querySelector('#character').getBoundingClientRect().left, document.querySelector('.brand').getBoundingClientRect().left]")
    check("Character page sits in the same container as the header", abs(edges[0] - edges[1]) <= 1, edges)
    page.click("#tab-campaign")
    page.set_viewport_size({"width": 1000, "height": 760}); page.wait_for_timeout(200)
    page.evaluate("document.querySelector('#actTabs .act-tabs').scrollLeft = 0"); page.wait_for_timeout(100)
    fade = page.evaluate("() => { const t = document.querySelector('#actTabs .act-tabs'); return [t.scrollWidth > t.clientWidth, t.className]; }")
    check("act strip: an overflowing edge fades", not fade[0] or ("more-r" in fade[1] and "more-l" not in fade[1]), fade)
    page.set_viewport_size({"width": 1280, "height": 800}); page.wait_for_timeout(200)

    # Route bar: one line during a run, Edit opens it
    check("route bar collapses to one line during a run", page.locator("#campaign .route-summary").is_visible()
          and page.locator("#routeMode").count() == 0, page.text_content("#campaign .route-bar"))
    line = page.text_content("#campaign .route-summary .route-line")
    check("route summary names the route", line.startswith("Normal clear · Full campaign"), line)
    page.click('#campaign .route-summary [data-action="route-edit"]')
    check("Edit opens the full route bar", page.locator("#routeMode").is_visible())
    page.click('#campaign [data-action="route-edit"]')
    check("Done folds it again", page.locator("#campaign .route-summary").is_visible())

    # Auto-scroll lands on a zone boundary, under the sticky act header
    page.set_viewport_size({"width": 1920, "height": 1080}); page.wait_for_timeout(150)
    page.click("#act-tab-act3"); page.click('[data-action="act-current"]'); page.wait_for_timeout(200)
    snap = page.evaluate("""() => { const col = document.querySelector('#checklistScroll'), c = col.getBoundingClientRect();
      const head = document.querySelector('#actPanel > header').getBoundingClientRect();
      const cut = [...col.querySelectorAll('.zone, .route-bar')].map(z => z.getBoundingClientRect())
        .filter(r => (r.top < head.bottom - 1 && r.bottom > head.bottom + 1 && col.scrollTop > 0) || (r.top < c.top - 1 && r.bottom > c.top + 1));
      return { top: col.scrollTop, cut: cut.length }; }""")
    check("auto-scroll leaves no row half under the act header or the column top", snap["cut"] == 0, snap)
    page.set_viewport_size({"width": 1280, "height": 800})

    # Single-section practice: a label instead of one lone tab
    auto_accept_modals(page)  # the reload above dropped it
    page.click('#campaign .route-summary [data-action="route-edit"]')
    page.select_option("#practiceScope", "zone:act1-z02"); page.wait_for_timeout(800)
    check("single practice: no tab strip, a Practice label", page.locator("#actTabs [role=tab]").count() == 0
          and page.text_content("#actTabs .act-single").startswith("Practice: "), page.text_content("#actTabs"))
    page.select_option("#practiceScope", ""); page.wait_for_timeout(200)

    # M1: every header tab is reachable on a phone
    ph = ctx.new_page()
    ph.on("pageerror", lambda e: errs.append(str(e)))
    ph.set_viewport_size({"width": 390, "height": 844})
    ph.goto(URL); ph.wait_for_timeout(200)
    for t in ["campaign", "runs", "character", "endgame", "tools"]:
        ph.click(f"#tab-{t}", timeout=3000)
        box = ph.locator(f"#tab-{t}").bounding_box()
        check(f"390x844: {t} tab clickable and on screen", ph.get_attribute(f"#tab-{t}", "aria-selected") == "true"
              and box and box["x"] >= 0 and box["x"] + box["width"] <= 390, box)
    ph.close()
    HEADER = """() => { const v = document.querySelector('.topbar .views'), t = [...v.querySelectorAll('button')];
      const more = document.querySelector('.more-btn').getBoundingClientRect(), sel = document.querySelector('#charSelect').getBoundingClientRect();
      return { fit: t.every(x => { const r = x.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }),
        fadeL: v.classList.contains('more-l'), fadeR: v.classList.contains('more-r'),
        oneLine: Math.abs((more.top + more.bottom) / 2 - (sel.top + sel.bottom) / 2) < 2 && more.right <= innerWidth }; }"""
    for w in (360, 320):
        ph = ctx.new_page()
        ph.set_viewport_size({"width": w, "height": 740})
        ph.goto(URL); ph.wait_for_timeout(250)
        r = ph.evaluate(HEADER)
        if w == 360:
            check("360px: all five tabs fit, no fade", r["fit"] and not r["fadeR"] and not r["fadeL"], r)
        else:
            check("320px: tabs past the edge get the fade cue", not r["fit"] and r["fadeR"] and not r["fadeL"], r)
            ph.evaluate("document.querySelector('.topbar .views').scrollLeft = 999"); ph.wait_for_timeout(100)
            r2 = ph.evaluate(HEADER)
            check("320px: scrolled to the end, the fade moves to the left edge", r2["fadeL"] and not r2["fadeR"], r2)
        check(f"{w}px: the ⋯ button stays on the header's first line", r["oneLine"], r)
        ph.close()

    # M2: a class, the ghost and The Grelwood on short screens: step, hint and Next step all fully visible
    VISIBLE = """(sel) => { const e = document.querySelector(sel); if (!e) return 'missing';
      const r = e.getBoundingClientRect(); if (!r.height) return 'hidden';
      for (let a = e.parentElement; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') { const q = a.getBoundingClientRect();
          if (r.top < q.top - 0.5 || r.bottom > q.bottom + 0.5) return 'clipped by ' + (a.id || a.className); }
      }
      return r.top >= 0 && r.bottom <= innerHeight ? 'ok' : 'off screen ' + r.bottom; }"""
    for w, h in [(1280, 720), (1366, 768)]:
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.clock.install()
        pg.set_viewport_size({"width": w, "height": h})
        pg.goto(URL)
        pg.evaluate("""() => { localStorage.clear(); const s = Storage2.load(), c = s.characters[s.activeId];
          c.classId = 'warrior'; s.settings.ghostMode = true; s.settings.seen.firstRunTip = true;
          localStorage.setItem('splitstone:v1', JSON.stringify(s)); }""")
        pg.reload(); pg.wait_for_timeout(200)
        pg.keyboard.press("Space"); split(pg, 3)
        zone = pg.text_content("#now .now-zone")
        res = {sel: pg.evaluate(VISIBLE, sel) for sel in ("#now .now-objective", "#now .now-hints li", "#now .now-next")}
        check(f"{w}x{h} Warrior, ghost on, {zone}: step, hint and Next step fully visible",
              zone == "The Grelwood" and all(v == "ok" for v in res.values()), res)
        more = pg.locator("#now .now-more-toggle")
        check(f"{w}x{h}: the rest is behind +N more, pinned outside the scroller", more.count() == 1
              and more.text_content().startswith("+") and pg.locator("#now .now-detail .now-more-toggle").count() == 0
              and not pg.locator("#now .now-class").first.is_visible())
        if w == 1280:
            full = pg.evaluate("() => { const s = Storage2.load(), c = s.characters[s.activeId], z = Run.current(c).zone;"
                               " return z.steps.find(x => !c.done[x.id]).objective; }")
            check("the objective carries its full text in the title", pg.get_attribute("#now .now-obj-text", "title") == full)
            more.click()
            opened = pg.evaluate("""() => { const st = document.querySelector('#now .now-step'), o = st.querySelector('.now-obj-text');
              return { open: st.classList.contains('open'), unclamped: o.scrollHeight <= o.clientHeight + 1,
                extra: !!document.querySelector('#now .now-more-box'), label: document.querySelector('#now .now-more-toggle').textContent,
                focus: document.activeElement.classList.contains('now-more-toggle') }; }""")
            check("+N more opens the rest, lifts the line limits and becomes Show less", opened["open"] and opened["unclamped"]
                  and opened["extra"] and opened["label"] == "Show less" and opened["focus"], opened)
            pg.click("#now .now-more-toggle")
            check("Show less folds it again", not pg.locator("#now .now-more-box").is_visible())
        if w == 1280:
            # m1: the ghost line opens a picker
            pg.click("#now .now-ghost")
            check("ghost line opens a picker with focus on it", pg.locator("#ghostPickNow").is_visible()
                  and pg.evaluate("document.activeElement.id") == "ghostPickNow")
            pg.select_option("#ghostPickNow", "sob"); pg.wait_for_timeout(100)
            pick = pg.evaluate("() => { const s = Storage2.load(); return s.characters[s.activeId].ghost.pick; }")
            check("picking in the popover changes the ghost", pick == "sob", pick)
            pg.keyboard.press("Escape")
            check("Esc closes the picker", pg.locator("#ghostPickNow").count() == 0
                  and pg.evaluate("document.activeElement.classList.contains('now-ghost')"))
            pg.click("#now .now-ghost"); pg.click('#ghostPop [data-action="ghost-more"]')
            check("More on Runs opens the Runs tab", pg.get_attribute("#tab-runs", "aria-selected") == "true"
                  and pg.evaluate("document.activeElement.id") == "ghostPick")
        pg.close()

    # MAJ-1: every zone on the route, Warrior at level 12 racing best segments, at both short sizes.
    for w, h in [(1280, 720), (1366, 768)]:
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.clock.install()
        pg.set_viewport_size({"width": w, "height": h})
        pg.goto(URL); auto_accept_modals(pg)
        pg.evaluate("""() => { localStorage.clear(); const s = Storage2.load(), c = s.characters[s.activeId];
          c.classId = 'warrior'; c.level = 12; s.settings.ghostMode = true; s.settings.seen.firstRunTip = true;
          localStorage.setItem('splitstone:v1', JSON.stringify(s)); }""")
        pg.reload(); auto_accept_modals(pg); pg.wait_for_timeout(200)
        n = pg.evaluate("() => { const s = Storage2.load(); return Run.order(s.characters[s.activeId]).length; }")
        for race in (False, True):
            if race:
                # A finished run to race: best segments, so the ghost line has a zone and a delta.
                pg.keyboard.press("r"); pg.wait_for_timeout(150)
                pg.evaluate("""() => { const s = Storage2.load(), c = s.characters[s.activeId];
                  c.ghost = Object.assign(c.ghost || {}, { pick: 'sob' }); localStorage.setItem('splitstone:v1', JSON.stringify(s)); }""")
                pg.reload(); auto_accept_modals(pg); pg.wait_for_timeout(200)
            pg.keyboard.press("Space")
            if race:
                # Over ten minutes behind before the first split: the widest campaign delta in the footer.
                pg.clock.fast_forward(12 * 60_000)
            cut, clamped, ghosts = [], 0, 0
            for i in range(n):
                pg.clock.fast_forward(45_000 + 1000 * (i % 7)); pg.wait_for_timeout(15)
                if race:
                    r = pg.evaluate(PANEL_CUT)
                    clamped += r["clamped"] > 0
                    ghosts += r["ghost"]
                    if r["bad"]:
                        cut.append((r["zone"], r["bad"]))
                pg.keyboard.press("Space")
        print(f"     {w}x{h}: {n} zones, {len(cut)} with a line cut, {clamped} with the objective or hint clamped (and a way to open it)")
        delta = pg.text_content("#runFoot")
        check(f"{w}x{h} Warrior, level, ghost, campaign delta over 10:00: on all {n} zones every panel line is whole or "
              "deliberately clamped and Next stays inside the panel", not cut, (delta, cut[:4]))
        check(f"{w}x{h}: the ghost line was on screen in every zone", ghosts == n, ghosts)
        pg.close()

    check("no JS errors", not errs, errs)
    b.close()

passed = sum(ok for _, ok in results)
print(f"\n{passed}/{len(results)} passed")
sys.exit(0 if passed == len(results) else 1)
