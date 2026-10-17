#!/usr/bin/env python3
"""screenshots/class-notes.png — Monk class notes on early Act 1 steps."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
from shot_dir import shot_dir  # noqa: E402
from tracker_url import TRACKER_URL

URL = TRACKER_URL
SHOT = shot_dir() / "class-notes.png"

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.goto(URL)
    page.evaluate("localStorage.clear()")
    page.reload()
    page.select_option("#routeClass", "monk")
    page.wait_for_selector(".zone .class-note")
    # Scroll so Renly + Finn areas are in view — focus Act 1 top
    page.locator('.zone[data-zone="act1-z02"]').scroll_into_view_if_needed()
    page.screenshot(path=str(SHOT))
    b.close()
print("wrote", SHOT)
