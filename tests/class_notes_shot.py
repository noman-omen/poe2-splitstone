#!/usr/bin/env python3
"""screenshots/class-notes.png — Monk class notes on early Act 1 steps."""
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/"
SHOT = Path(__file__).resolve().parent.parent / "screenshots" / "class-notes.png"

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.goto(URL)
    page.evaluate("localStorage.clear()")
    page.reload()
    page.select_option("#routeClass", "monk")
    page.wait_for_selector(".class-note")
    # Scroll so Renly + Finn areas are in view — focus Act 1 top
    page.locator('.zone[data-zone="act1-z02"]').scroll_into_view_if_needed()
    page.screenshot(path=str(SHOT))
    b.close()
print("wrote", SHOT)
