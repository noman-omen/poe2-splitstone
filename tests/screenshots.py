#!/usr/bin/env python3
"""Generate README screenshots (screenshots/milestone3*.png) with realistic demo data.
Simulates 5 runs with varying zone times via Playwright's fake clock."""
import random
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright
from modal_helpers import auto_accept_modals
sys.path.insert(0, str(Path(__file__).resolve().parent))
from shot_dir import shot_dir  # noqa: E402

URL = "http://127.0.0.1:8765/"
SHOTS = shot_dir()
random.seed(7)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1600, "height": 1000})
    page = ctx.new_page()
    page.clock.install()
    # native dialogs gone; auto-OK in-app confirms (e.g. New run)
    page.goto(URL)
    page.evaluate("localStorage.clear()")
    page.reload()
    auto_accept_modals(page)
    done = "() => document.querySelector('#now .now-zone')?.textContent.includes('🏁')"
    for run in range(5):
        page.keyboard.press("r")
        while not page.evaluate(done):
            page.clock.fast_forward(int(random.uniform(40, 160) * 1000 * (1 - run * 0.05)))
            page.keyboard.press("Space")
        page.clock.fast_forward(86_400_000)  # next day
    # mid-run state for the main shot
    page.keyboard.press("r")
    for _ in range(27):
        page.clock.fast_forward(int(random.uniform(40, 120) * 1000)); page.keyboard.press("Space")
    page.clock.fast_forward(48_000)
    page.keyboard.press("c"); page.clock.fast_forward(500)
    page.screenshot(path=str(SHOTS / "milestone3.png"))
    page.locator("#now").screenshot(path=str(SHOTS / "milestone3-nowbar.png"))
    # Element shots: unstick the bars so they don't overlay the element.
    page.add_style_tag(content=".topbar, .now { position: static !important; } .sidebar { position: static !important; }")
    page.locator("#stats").screenshot(path=str(SHOTS / "milestone3-stats.png"))
    page.click('[data-action="settings"] >> nth=0')
    page.locator("#settings").screenshot(path=str(SHOTS / "milestone3-hotkeys.png"))
    page.keyboard.press("Escape")
    state = page.evaluate("localStorage.getItem('splitstone:v1')")
    m = ctx.new_page(); m.set_viewport_size({"width": 390, "height": 844})
    m.goto(URL); m.evaluate("s => localStorage.setItem('splitstone:v1', s)", state); m.reload()
    m.screenshot(path=str(SHOTS / "milestone3-phone.png"))
    b.close()
print("ok")
