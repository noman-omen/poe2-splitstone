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
    return js(page, "(() => { const s = JSON.parse(localStorage.getItem('poe2-campaign-tracker:v1'));"
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
    answer = {"text": None}  # what the next prompt() should receive
    page.on("dialog", lambda d: d.accept(answer["text"]) if d.type == "prompt" else d.accept())
    page.add_init_script("window.state_c = () => { const s = JSON.parse(localStorage.getItem('poe2-campaign-tracker:v1')); return s.characters[s.activeId]; }")
    page.goto(URL)
    js(page, "localStorage.clear()")
    page.reload()

    # --- Structure: interludes split into their own sections/groups ---
    names = page.locator(".section h2").all_text_contents()
    check("8 campaign sections + maps", len(names) == 9, names)
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
    check("focus mode shows only current act (+maps)", len(vis) == 2)
    page.keyboard.press("f")

    # --- Complete run 1: every zone 10s ---
    for _ in range(200):
        if js(page, "!Run.current(JSON.parse(localStorage.getItem('poe2-campaign-tracker:v1')).characters[JSON.parse(localStorage.getItem('poe2-campaign-tracker:v1')).activeId])"):
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
    page.keyboard.press("r")
    check("R starts a new run (steps reset)", not char(page)["done"])
    page.keyboard.press("Space")
    tick(page, 5_000)
    page.keyboard.press("Space")
    check("zone delta vs PB shown after split", "−0:05" in page.text_content('.zone[data-zone="act1-z01"]'))
    check("gold marker for best segment", page.locator('.zone[data-zone="act1-z01"] .gold').count() == 1)
    tick(page, 1_000)
    check("live run delta ahead of PB", page.locator("#liveDelta.ahead").count() == 1, page.text_content("#now"))
    for _ in range(200):
        if page.locator("#now .now-zone", has_text="🏁").count():
            break
        tick(page, 5_000)
        n0 = len(char(page)["split"])
        page.keyboard.press("Space")
        if len(char(page)["split"]) == n0:
            print("NOSPLIT", _, n0, js(page, "document.activeElement.outerHTML.slice(0,120)"), js(page, "Run.runningZone(JSON.parse(localStorage.getItem('poe2-campaign-tracker:v1')).characters[JSON.parse(localStorage.getItem('poe2-campaign-tracker:v1')).activeId])"))
    c = char(page)
    check("run 2 saved, history has 2", len(c["history"]) == 2)
    check("new PB is the faster run", c["history"][0]["total"] < c["history"][1]["total"]
          and js(page, "Run.pb(JSON.parse(localStorage.getItem('poe2-campaign-tracker:v1')).characters[JSON.parse(localStorage.getItem('poe2-campaign-tracker:v1')).activeId]).id") == c["history"][0]["id"])
    check("bests: best total = PB total", c["bests"]["normal"]["total"] == c["history"][0]["total"])
    check("older run shows +delta in history", "+" in page.text_content("#history"))

    # --- Abandoned run is kept as an attempt ---
    page.keyboard.press("r")
    page.keyboard.press("Space"); tick(page, 3_000); page.keyboard.press("Space"); tick(page, 3_000)
    page.keyboard.press("r")
    c = char(page)
    check("reset mid-run stores unfinished attempt", len(c["history"]) == 3 and not c["history"][0]["complete"])
    check("unfinished attempt does not become PB", js(page, "Run.pb(JSON.parse(localStorage.getItem('poe2-campaign-tracker:v1')).characters[JSON.parse(localStorage.getItem('poe2-campaign-tracker:v1')).activeId]).complete"))

    # --- Route variants (per character) ---
    page.keyboard.press("r")
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
    page.keyboard.press("r")
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
    check("export includes history + bests", len(ec["history"]) == 4 and ec["bests"])

    answer["text"] = "Second char"
    page.click('[data-action="char-new"]')
    check("new character created, separate history", page.locator("#charSelect option").count() == 2 and not char(page)["history"])
    answer["text"] = "Renamed char"
    page.click('[data-action="char-rename"]')
    check("rename works", "Renamed char" in page.text_content("#charSelect"))
    page.select_option("#charSelect", index=0)
    check("switch character restores its history", len(char(page)["history"]) == 4)
    page.select_option("#charSelect", index=1)
    page.click('[data-action="char-delete"]')
    check("delete works", page.locator("#charSelect option").count() == 1)

    js(page, "localStorage.clear()")
    page.reload()
    check("cleared state is fresh", not char(page)["history"] if js(page, "!!localStorage.getItem('poe2-campaign-tracker:v1')") else True)
    page.set_input_files("#importFile", str(export_path))
    page.wait_for_timeout(300)
    check("import restores history + build", len(char(page)["history"]) == 4 and "Infernalist" in page.text_content("#character"))
    page.set_input_files("#importFile", {"name": "bad.json", "mimeType": "application/json", "buffer": b"{\"x\":1}"})
    page.wait_for_timeout(300)
    check("bad import rejected gracefully", "Import failed" in page.text_content("#toast"))

    # --- Screenshot (desktop): mid-run with a PB to compare against ---
    page.keyboard.press("r")
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
