#!/usr/bin/env python3
"""Headless smoke test for the tracker (Playwright + Chromium).

Assumes the app is served at $TRACKER_URL (default http://127.0.0.1:8765/).
Checks: toggles, timers, step persistence across reload, character CRUD,
JSON export/import, PoB2 import (good and bad code). Saves a screenshot.
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


def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.evaluate("localStorage.clear()")
    page.reload()

    # Toggles
    page.check("#hideHints")
    check("hide hints hides hint lists", not page.locator(".hints").first.is_visible())
    page.uncheck("#hideHints")
    check("unhide hints", page.locator(".hints").first.is_visible())
    page.check("#hideExtra")
    check("hide extra hides extra info", not page.locator(".extra").first.is_visible())

    # Timers: zone timer also starts its act timer
    page.click('[data-zone="act1-z01"] button.tt')
    page.wait_for_timeout(2300)
    page.click('[data-zone="act1-z01"] button.tt')  # stop zone
    zone_t = page.text_content('[data-timer="zone:act1-z01"]')
    check(f"zone timer counted ({zone_t})", zone_t >= "0:00:02")
    check("act timer auto-started", "running" in page.get_attribute('[data-key="section:act1"].tw', "class"))
    page.click('header [data-key="section:act1"] button.tt')  # stop act

    # Steps + map
    page.check('[data-id="act1-02"]')
    page.fill("#mapName", "Burial Bog")
    page.click("form.maps-add button")
    check("map added", page.locator(".map-row").count() == 1)

    # Persistence across reload
    page.reload()
    check("step persisted", page.is_checked('[data-id="act1-02"]'))
    check("hide-extra persisted", page.is_checked("#hideExtra"))
    check("timer persisted", page.text_content('[data-timer="zone:act1-z01"]') >= "0:00:02")
    check("map persisted", page.locator(".map-row").count() == 1)
    page.uncheck("#hideExtra")

    # PoB: bad then good code
    page.fill("#pobCode", "this is not a build!!")
    page.click('[data-action="pob-import"]')
    check("bad PoB code shows error", page.locator("#pobError").is_visible())
    page.fill("#pobCode", POB_CODE)
    page.click('[data-action="pob-import"]')
    page.wait_for_selector(".kv")
    panel = page.text_content("#character")
    check("PoB decoded (Witch/Infernalist/93)", all(s in panel for s in ("Witch", "Infernalist", "93")))
    check("PoB main skill listed", "Flameblast" in panel)

    # Export
    with page.expect_download() as dl:
        page.click('[data-action="export"]')
    export_path = OUT / "export.json"
    dl.value.save_as(export_path)
    exported = json.loads(export_path.read_text())
    check("export contains character + step", any(c["done"].get("act1-02") for c in exported["characters"].values()))

    # Characters: create, rename, then wipe storage and import back
    page.once("dialog", lambda d: d.accept("Second char"))
    page.click('[data-action="char-new"]')
    check("new character created", page.locator("#charSelect option").count() == 2)
    page.once("dialog", lambda d: d.accept("Renamed char"))
    page.click('[data-action="char-rename"]')
    check("rename works", "Renamed char" in page.text_content("#charSelect"))
    page.once("dialog", lambda d: d.accept())
    page.click('[data-action="char-delete"]')
    check("delete works", page.locator("#charSelect option").count() == 1)

    page.evaluate("localStorage.clear()")
    page.reload()
    check("cleared state is fresh", not page.is_checked('[data-id="act1-02"]'))
    page.set_input_files("#importFile", str(export_path))
    page.wait_for_timeout(300)
    check("import restores step", page.is_checked('[data-id="act1-02"]'))
    check("import restores build", "Infernalist" in page.text_content("#character"))
    page.set_input_files("#importFile", {"name": "bad.json", "mimeType": "application/json", "buffer": b"{\"x\":1}"})
    page.wait_for_timeout(300)
    check("bad import rejected gracefully", "Import failed" in page.text_content("#toast"))

    # Screenshot: start a timer so it looks alive
    page.click('[data-zone="act1-z02"] button.tt')
    page.wait_for_timeout(1500)
    shot = ROOT / "screenshots" / "milestone1.png"
    page.screenshot(path=str(shot))
    check("no JS errors", not errors)
    browser.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
