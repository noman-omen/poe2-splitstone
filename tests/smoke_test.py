#!/usr/bin/env python3
"""Headless end-to-end test for the tracker (Playwright + Chromium).

Assumes the app is served at $TRACKER_URL (default http://127.0.0.1:8765/).
Uses Playwright's fake clock so full speedruns take milliseconds.
Covers: toggles, focus mode, per-zone/section/group timers, splits,
auto-advance, undo, pause, full runs + PB + history + deltas, hotkeys,
persistence, characters, export/import, PoB2 import, mobile layout.
Writes screenshots/milestone2.png (+ a phone-sized one in tests/output).
"""
import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright
from modal_helpers import fill_modal


def accept_if_modal(page, timeout=800):
    try:
        fill_modal(page, timeout=timeout)
    except Exception:
        pass


def new_run(page):
    """Press R and accept the in-app confirm when one is shown."""
    page.keyboard.press("r")
    try:
        fill_modal(page, timeout=800)
    except Exception:
        pass  # nothing to confirm (fresh run)

URL = os.environ.get("TRACKER_URL", "http://127.0.0.1:8765/")
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "output"
OUT.mkdir(parents=True, exist_ok=True)
POB_CODE = (ROOT / "tests" / "fixtures-flameblast.txt").read_text().strip()
results = []


def check(name, cond, info=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{info}]" if info and not cond else ""))


def js(page, expr):
    return page.evaluate(expr)


def char(page):
    return js(page, "(() => { const s = JSON.parse(localStorage.getItem('splitstone:v1'));"
                    " return s.characters[s.activeId]; })()")


def tick(page, ms):
    page.clock.run_for(ms)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
    page = ctx.new_page()
    page.clock.install()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    # In-app modals replace window.prompt/confirm; use fill_modal() where needed.
    page.add_init_script("window.state_c = () => { const s = JSON.parse(localStorage.getItem('splitstone:v1')); return s.characters[s.activeId]; }")
    page.goto(URL)
    js(page, "localStorage.clear()")
    page.reload()

    # --- Structure: interludes split into their own sections/groups ---
    names = page.locator(".section h2").all_text_contents()
    check("8 campaign sections + maps + analytics", len(names) == 10, names)
    check("interludes split (1, 2 part 1/2, 3)",
          all(any(n.startswith(x) for n in names) for x in ("Interlude 1", "Interlude 2 · part 1", "Interlude 2 · part 2", "Interlude 3")))
    seg = page.text_content("#totals")
    check("totals table lists Interlude 1/2/3 + acts", all(x in seg for x in ("Act 1", "Act 4", "Interlude 1", "Interlude 2", "Interlude 3")))

    # --- Toggles ---
    page.check("#hideHints")
    check("hide hints hides hint lists", not page.locator(".zone .hints").first.is_visible())
    page.keyboard.press("h")
    check("H hotkey toggles hints back", page.locator(".zone .hints").first.is_visible())
    page.keyboard.press("e")
    check("E hotkey hides extra info", not page.locator(".extra").first.is_visible())
    page.keyboard.press("e")

    # --- Start run with Space, split, auto-advance ---
    check("now bar shows first zone", "The Riverbank" in page.text_content("#now"))
    page.keyboard.press("Space")
    tick(page, 10_000)
    c = char(page)
    check("Space starts the current zone timer", c["timers"]["zone:act1-z01"]["startedAt"])
    page.keyboard.press("Space")
    c = char(page)
    check("Space splits zone 1", "act1-z01" in c["split"])
    check("auto-advance: zone 2 timer running", c["timers"].get("zone:act1-z02", {}).get("startedAt"))
    check("split auto-ticks required steps", c["done"].get("act1-01"))
    check("current zone highlighted", page.locator(".zone.current").get_attribute("data-zone") == "act1-z02")
    tick(page, 5_000)
    # Ticking the last required step of the timed zone auto-splits
    page.check('.zone[data-zone="act1-z02"] input[data-id="act1-02"]')
    c = char(page)
    check("checkbox completion auto-splits + advances", "act1-z02" in c["split"] and c["timers"]["zone:act1-z03"]["startedAt"])
    # Undo
    page.keyboard.press("u")
    c = char(page)
    check("U undoes the split (zone 2 running again)", "act1-z02" not in c["split"] and c["timers"]["zone:act1-z02"]["startedAt"])
    check("undo un-ticks auto-ticked steps only", c["done"].get("act1-02"))  # was ticked by hand: stays
    page.keyboard.press("Space")
    # Pause
    page.keyboard.press("p")
    before = char(page)["timers"]["zone:act1-z03"]["elapsed"]
    tick(page, 20_000)
    check("pause freezes time", not char(page)["timers"]["zone:act1-z03"]["startedAt"]
          and char(page)["timers"]["zone:act1-z03"]["elapsed"] == before)
    page.keyboard.press("p")
    check("resume restarts the zone", char(page)["timers"]["zone:act1-z03"]["startedAt"])

    # Hotkeys must not fire while typing
    page.fill("#mapName", "")
    page.type("#mapName", "p u r")
    check("hotkeys ignored in text inputs", char(page)["timers"]["zone:act1-z03"]["startedAt"]
          and page.input_value("#mapName") == "p u r")
    page.fill("#mapName", "")
    page.keyboard.press("Escape")  # leave the field: hotkeys active again

    # Focus mode
    page.keyboard.press("f")
    vis = [s for s in page.locator(".section").all() if s.is_visible()]
    check("focus mode shows only current act (+maps, analytics)", len(vis) == 3)
    page.keyboard.press("f")

    # --- Complete run 1: every zone 10s ---
    for _ in range(200):
        if js(page, "!Run.current(JSON.parse(localStorage.getItem('splitstone:v1')).characters[JSON.parse(localStorage.getItem('splitstone:v1')).activeId])"):
            break
        tick(page, 10_000)
        page.keyboard.press("Space")
    c = char(page)
    zones = js(page, "Run.ALL.length")
    check("run 1 finished, stored in history", len(c["history"]) == 1 and c["history"][0]["complete"], len(c["history"]))
    run1 = c["history"][0]
    check("history stores every zone time", len(run1["zones"]) == zones, len(run1["zones"]))
    check("history stores each act + interlude part", len(run1["sections"]) == 8)
    check("history stores interlude group totals", all(g in run1["groups"] for g in ("interlude1", "interlude2", "interlude3")))
    check("interlude 2 total = part1 + part2", run1["groups"]["interlude2"] == run1["sections"]["int2a"] + run1["sections"]["int2b"])
    check("act total = sum of its zones", run1["sections"]["act1"] == sum(v for k, v in run1["zones"].items() if k.startswith("act1-")))
    check("campaign total = sum of groups", run1["total"] == sum(run1["groups"].values()))
    check("finish screen shown", page.locator("#now .now-zone", has_text="🏁").count() == 1)
    check("PB shown in history", "PB" in page.text_content("#history"))

    # --- Run 2: faster, live delta vs PB, new PB ---
    new_run(page)
    check("R starts a new run (steps reset)", not char(page)["done"])
    page.keyboard.press("Space")
    tick(page, 5_000)
    page.keyboard.press("Space")
    check("zone delta vs PB shown after split", "−0:05" in page.text_content('.zone[data-zone="act1-z01"]'))
    check("gold marker for best segment", page.locator('.zone[data-zone="act1-z01"] .gold').count() == 1)
    tick(page, 1_000)
    check("live run delta ahead of PB", page.locator("#liveDelta.ahead").count() == 1, page.text_content("#now"))
    # Sidebar Δ must match split-point PB (same as #liveDelta), not partial Now vs full PB
    mid = js(page, """(() => {
      const c = state_c(), now = Date.now(), p = Run.pb(c);
      const live = Run.deltaVsPb(c, now);
      const act1 = Run.deltaVsPbIn(c, o => o.group === 'act1', now);
      const act4 = Run.deltaVsPbIn(c, o => o.group === 'act4', now);
      const wrongCamp = Run.totalMs(c, now) - p.total;
      const wrongAct1 = Run.groupMs(c, 'act1', now) - p.groups.act1;
      const campEl = document.querySelector('[data-seg-delta="total:"]');
      const act1El = document.querySelector('[data-seg-delta="group:act1"]');
      const act4El = document.querySelector('[data-seg-delta="group:act4"]');
      const liveEl = document.querySelector('#liveDelta');
      return {
        live, act1, act4, wrongCamp, wrongAct1,
        campDom: campEl && campEl.textContent, liveDom: liveEl && liveEl.textContent,
        act1Dom: act1El && act1El.textContent, act4Dom: act4El && act4El.textContent,
        campAhead: !!(campEl && campEl.classList.contains('ahead')),
        liveAhead: !!(liveEl && liveEl.classList.contains('ahead')),
      };
    })()""")
    check("mid-run Campaign Δ equals #liveDelta (split-point)", mid["campDom"] == mid["liveDom"] and mid["campAhead"] and mid["liveAhead"], mid)
    check("mid-run Campaign Δ is not partial-vs-full-PB", mid["live"] is not None and mid["wrongCamp"] < mid["live"] - 60_000, mid)
    check("mid-run Act 1 Δ uses split-point (not full act PB)", mid["act1"] is not None and mid["wrongAct1"] < mid["act1"] - 10_000, mid)
    check("unstarted Act 4 Δ is dash", mid["act4"] is None and mid["act4Dom"] == "–", mid)
    for _ in range(200):
        if page.locator("#now .now-zone", has_text="🏁").count():
            break
        tick(page, 5_000)
        page.keyboard.press("Space")
    c = char(page)
    check("run 2 saved, history has 2", len(c["history"]) == 2)
    check("new PB is the faster run", c["history"][0]["total"] < c["history"][1]["total"]
          and js(page, "Run.pb(JSON.parse(localStorage.getItem('splitstone:v1')).characters[JSON.parse(localStorage.getItem('splitstone:v1')).activeId]).id") == c["history"][0]["id"])
    check("bests: best total = PB total", c["bests"]["normal"]["total"] == c["history"][0]["total"])
    check("older run shows +delta in history", "+" in page.text_content("#history"))

    # --- Abandoned run is kept as an attempt ---
    new_run(page)
    page.keyboard.press("Space"); tick(page, 3_000); page.keyboard.press("Space"); tick(page, 3_000)
    new_run(page)
    c = char(page)
    check("reset mid-run stores unfinished attempt", len(c["history"]) == 3 and not c["history"][0]["complete"])
    check("unfinished attempt does not become PB", js(page, "Run.pb(JSON.parse(localStorage.getItem('splitstone:v1')).characters[JSON.parse(localStorage.getItem('splitstone:v1')).activeId]).complete"))

    # --- Route variants (per character) ---
    new_run(page)
    n_normal = js(page, "Run.order(state_c()).length")
    page.select_option("#routeMode", "fast")
    c = char(page)
    check("route mode persisted on character", c["route"]["mode"] == "fast")
    n_fast = js(page, "Run.order(state_c()).length")
    check(f"fast route drops normal-only zones ({n_normal}->{n_fast})", n_fast < n_normal)
    check("normal-only step hidden in fast route", page.locator('input[data-id="act1-15"]').count() == 0)
    check("fast tips shown with ⚡ in fast route", page.locator(".zone .hints li", has_text="⚡").count() > 0)
    page.check("#requiredOnly")
    check("required-only hides optional steps", page.locator('input[data-id="interludes-20"]').count() == 0
          and js(page, "Run.order(state_c()).length") <= n_fast)
    page.uncheck("#requiredOnly")
    for _ in range(200):
        if page.locator("#now .now-zone", has_text="🏁").count():
            break
        tick(page, 4_000)
        page.keyboard.press("Space")
    c = char(page)
    check("fast run saved with its variant", c["history"][0]["variant"] == "fast" and c["history"][0]["complete"])
    check("fast run has its own PB (not compared with normal)", c["bests"]["fast"]["total"] == c["history"][0]["total"]
          and c["bests"]["normal"]["total"] != c["history"][0]["total"])
    new_run(page)
    page.select_option("#routeMode", "normal")

    # --- Persistence ---
    page.keyboard.press("Space"); tick(page, 4_000)
    page.check("#hideExtra")
    page.reload()
    c = char(page)
    check("history persisted across reload", len(c["history"]) == 4)
    check("running timer survives reload", c["timers"]["zone:act1-z01"]["startedAt"])
    check("settings persisted", page.is_checked("#hideExtra"))
    page.uncheck("#hideExtra")

    # Manual zone/map timers still work
    page.fill("#mapName", "Burial Bog")
    page.click("form.maps-add button")
    page.click('.map-row button.tt'); tick(page, 3_000); page.click('.map-row button.tt')
    check("map timer counts", char(page)["timers"][[k for k in char(page)["timers"] if k.startswith("map:")][0]]["elapsed"] >= 3000)
    page.click('.zone[data-zone="act2-z01"] button.tt')
    c = char(page)
    check("manual zone start stops other zones", c["timers"]["zone:act2-z01"]["startedAt"] and not c["timers"]["zone:act1-z01"]["startedAt"])

    # --- Run analytics + CSV ---
    # Chart points follow the history filter (Campaign / Practice / All), like the app.
    hfilter = page.eval_on_selector("#historyFilter", "e => e.value") if page.locator("#historyFilter").count() else "campaign"
    is_practice = lambda h: bool(h.get("practice") or "+p:" in str(h.get("variant", "")))
    keep = {"all": lambda h: True, "practice": is_practice}.get(hfilter, lambda h: not is_practice(h))
    n_complete = len([h for h in char(page)["history"] if h["complete"] and keep(h)])
    check("trend chart: one point per completed run", page.locator("#stats svg.chart").first.locator("circle").count() == n_complete)
    if page.locator("#historyFilter").count():
        page.select_option("#historyFilter", "all")
        n_all = len([h for h in char(page)["history"] if h["complete"]])
        check("trend chart follows history filter (All)", page.locator("#stats svg.chart").first.locator("circle").count() == n_all)
        page.select_option("#historyFilter", hfilter)
    check("stat cards show average + sum of best", "Average" in page.text_content("#stats") and "Sum of best" in page.text_content("#stats"))
    page.select_option("#statSeg", "group:interlude2")
    check("segment trend selectable (Interlude 2)", page.locator("#stats svg.chart").nth(1).locator("circle").count() >= 2)
    with page.expect_download() as dl:
        page.click('[data-action="csv-runs"]')
    csv = Path(dl.value.path()).read_text().splitlines()
    check("runs CSV has header + one row per run", csv[0].startswith("run_id,character,variant") and len(csv) == 1 + len(char(page)["history"]), len(csv))
    check("runs CSV has interlude + zone columns", "Interlude 2 (s)" in csv[0] and "act1-z01" in csv[0])

    # --- Map history + PBs ---
    for t in (30_000, 20_000):
        page.click('.map-row button.tt'); tick(page, t)
        page.click('[data-action="map-finish"]')
    mh = char(page)["mapHistory"]
    check("map runs saved to history", len(mh) == 2 and 20_000 <= mh[0]["ms"] < 21_000 and mh[1]["ms"] >= 30_000, [m["ms"] for m in mh])
    row = page.text_content(".map-row")
    check("per-map PB + average + count shown", "PB 0:00:20" in row and "2×" in row, row)
    check("map timer reset after finish", not any(k.startswith("map:") for k in char(page)["timers"]))
    page.click('.map-row button.tt'); tick(page, 25_000)
    check("live map delta vs PB", "+0:05" in page.text_content(".map-row"))
    page.click('.map-row button.tt')
    with page.expect_download() as dl:
        page.click('[data-action="csv-maps"]')
    mcsv = Path(dl.value.path()).read_text().splitlines()
    check("maps CSV exported", len(mcsv) == 3 and "Burial Bog" in mcsv[1])

    # --- PoB ---
    page.fill("#pobCode", "this is not a build!!")
    page.click('[data-action="pob-import"]')
    check("bad PoB code shows error", page.locator("#pobError").is_visible())
    page.fill("#pobCode", "https://pobb.in/abc")
    page.click('[data-action="pob-import"]')
    check("PoB link gives helpful error", "raw" in page.text_content("#pobError"))
    page.fill("#pobCode", POB_CODE)
    page.click('[data-action="pob-import"]')
    page.wait_for_selector("#character .kv")
    panel = page.text_content("#character")
    check("PoB decoded (Witch/Infernalist/93 + Flameblast)", all(s in panel for s in ("Witch", "Infernalist", "93", "Flameblast")))

    # --- Export / characters / import ---
    with page.expect_download() as dl:
        page.click('[data-action="export"]')
    export_path = OUT / "export.json"
    dl.value.save_as(export_path)
    exported = json.loads(export_path.read_text())
    ec = list(exported["characters"].values())[0]
    check("export includes history + bests + map history", len(ec["history"]) == 4 and ec["bests"] and len(ec["mapHistory"]) == 2)

    page.click('[data-action="char-new"]')
    fill_modal(page, "Second char")
    check("new character created, separate history", page.locator("#charSelect option").count() == 2 and not char(page)["history"])
    page.click('[data-action="char-rename"]')
    fill_modal(page, "Renamed char")
    check("rename works", "Renamed char" in page.text_content("#charSelect"))
    page.select_option("#charSelect", index=0)
    check("switch character restores its history", len(char(page)["history"]) == 4)
    page.select_option("#charSelect", index=1)
    page.click('[data-action="char-delete"]')
    fill_modal(page)  # confirm delete
    check("delete works", page.locator("#charSelect option").count() == 1)

    js(page, "localStorage.clear()")
    page.reload()
    check("cleared state is fresh", not char(page)["history"] if js(page, "!!localStorage.getItem('splitstone:v1')") else True)
    page.set_input_files("#importFile", str(export_path))
    try:
        fill_modal(page, timeout=1500)  # optional "apply helper URL?" confirm
    except Exception:
        pass
    page.wait_for_timeout(300)
    check("import restores history + build", len(char(page)["history"]) == 4 and "Infernalist" in page.text_content("#character"))
    page.set_input_files("#importFile", {"name": "bad.json", "mimeType": "application/json", "buffer": b"{\"x\":1}"})
    page.wait_for_timeout(300)
    check("bad import rejected gracefully", "Import failed" in page.text_content("#toast"))

    # --- Class-aware campaign notes ---
    page.select_option("#routeClass", "monk")
    accept_if_modal(page)
    check("class persisted on character", char(page).get("classId") == "monk")
    check("monk gem tip on Renly step", page.locator(".step .class-note", has_text="Glacial Cascade").count() >= 1)
    check("recommended reward callout for Finn charm", page.locator(".class-rec", has_text="Sapphire").count() >= 1)
    page.check("#hideHints")
    check("hide-hints hides class notes", not page.locator(".class-note").first.is_visible())
    page.uncheck("#hideHints")
    page.select_option("#routeClass", "mercenary")
    accept_if_modal(page)
    check("mercenary Renly tip is Explosive Grenade", page.locator(".class-note", has_text="Explosive Grenade").count() >= 1)
    page.select_option("#routeClass", "warrior")
    accept_if_modal(page)
    check("warrior Rolling Slam tip shown", page.locator(".class-note", has_text="Rolling Slam").count() >= 1)
    with page.expect_download() as dl:
        page.click('[data-action="export"]')
    exp = json.loads(Path(dl.value.path()).read_text())
    check("classId in JSON export", any(c.get("classId") == "warrior" for c in exp["characters"].values()))
    check("JSON export never carries the helper token", "token" not in exp["settings"].get("autoSplit", {}))
    page.select_option("#routeClass", "")
    accept_if_modal(page)
    check("class can be cleared to None", char(page).get("classId") in (None, ""))

    # --- Colour themes (global) ---
    check("default theme is ember", js(page, "document.documentElement.getAttribute('data-theme')") == "ember")
    page.click('[data-action="settings"] >> nth=0')
    page.click('[data-action="set-theme"][data-id="slate"]')
    check("theme switches to slate", js(page, "document.documentElement.getAttribute('data-theme')") == "slate")
    check("theme persisted in settings", js(page, "JSON.parse(localStorage.getItem('splitstone:v1')).settings.theme") == "slate")
    page.click('[data-action="settings-close"]')
    page.reload()
    check("theme survives reload", js(page, "document.documentElement.getAttribute('data-theme')") == "slate"
          and page.is_visible(".brand h1") and page.text_content(".brand h1") == "Splitstone")
    page.click('[data-action="settings"] >> nth=0')
    page.click('[data-action="set-theme"][data-id="crimson"]')
    page.click('[data-action="set-theme"][data-id="parchment"]')
    check("parchment theme applied", js(page, "document.documentElement.getAttribute('data-theme')") == "parchment")
    page.click('[data-action="set-theme"][data-id="ember"]')
    page.click('[data-action="settings-close"]')
    with page.expect_download() as dl:
        page.click('[data-action="export"]')
    exp = json.loads(Path(dl.value.path()).read_text())
    check("theme in JSON export", exp.get("settings", {}).get("theme") == "ember" and exp.get("app") == "splitstone")
    check("branded title", "Splitstone" in page.title() and page.locator('.brand .logo svg').count() == 1)

    # --- Legacy localStorage migration ---
    page.evaluate("""() => {
      const cur = localStorage.getItem('splitstone:v1');
      localStorage.setItem('poe2-campaign-tracker:v1', cur);
      localStorage.removeItem('splitstone:v1');
    }""")
    page.reload()
    check("legacy key migrated", js(page, "!!localStorage.getItem('splitstone:v1') && !localStorage.getItem('poe2-campaign-tracker:v1')"))
    check("migrated state still loads", page.text_content(".brand h1") == "Splitstone")

    # --- Rebindable hotkeys ---
    page.click('[data-action="settings"] >> nth=0')
    check("hotkey settings open", page.locator("#settings").is_visible())
    page.click('tr[data-hk="split"] button')
    page.keyboard.press("s")
    check("split rebound to S", js(page, "JSON.parse(localStorage.getItem('splitstone:v1')).settings.hotkeys.split") == "s")
    page.click('tr[data-hk="undo"] button')
    page.keyboard.press("s")
    check("conflict detected", "already used" in page.text_content("#keyError"))
    page.keyboard.press("Escape")
    check("conflicting bind not saved", js(page, "JSON.parse(localStorage.getItem('splitstone:v1')).settings.hotkeys.undo") is None)
    page.click('[data-action="settings-close"]')
    check("help overlay reflects bindings", "S" in page.locator("#helpKeys kbd").first.text_content())
    check("split button shows new key", "S" in page.text_content('#now [data-action="split"]'))
    with page.expect_download() as dl:
        page.click('[data-action="export"]')
    check("hotkeys in JSON export", json.loads(Path(dl.value.path()).read_text())["settings"]["hotkeys"]["split"] == "s")
    new_run(page)
    page.keyboard.press("s")
    check("new key starts/splits", js(page, "!!Run.runningZone(state_c())"))
    page.keyboard.press("Space")
    check("old key no longer splits", not char(page)["split"])
    page.click('[data-action="settings"] >> nth=0')
    page.click('[data-action="keys-reset"]')
    page.click('[data-action="settings-close"]')
    check("reset defaults", js(page, "JSON.stringify(JSON.parse(localStorage.getItem('splitstone:v1')).settings.hotkeys)") == "{}")

    # --- Screenshot (desktop): mid-run with a PB to compare against ---
    new_run(page)
    for _ in range(25):
        tick(page, 9_000); page.keyboard.press("Space")
    tick(page, 6_000)
    page.keyboard.press("c")
    tick(page, 1_000)
    page.screenshot(path=str(ROOT / "screenshots" / "milestone2.png"))

    # --- Mobile layout ---
    m = ctx.new_page(); m.set_viewport_size({"width": 390, "height": 844}); m.goto(URL)
    overflow = m.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    check("phone: no horizontal overflow", overflow <= 1, overflow)
    check("phone: split button visible", m.locator('#now [data-action="split"]').is_visible())
    m.screenshot(path=str(OUT / "phone.png"))

    check("no JS errors", not errors, errors)
    browser.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
