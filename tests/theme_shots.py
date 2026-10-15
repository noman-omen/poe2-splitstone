#!/usr/bin/env python3
"""Screenshot each colour theme + a branded desktop shot for Splitstone."""
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/"
SHOTS = Path(__file__).resolve().parent.parent / "screenshots"
THEMES = ["ember", "slate", "crimson", "parchment"]

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.clock.install()
    page.on("dialog", lambda d: d.accept())
    page.goto(URL)
    page.evaluate("localStorage.clear()")
    page.reload()
    # Seed a short mid-run state so the now bar looks alive
    page.keyboard.press("Space")
    for _ in range(8):
        page.clock.fast_forward(45_000)
        page.keyboard.press("Space")
    page.clock.fast_forward(30_000)
    page.keyboard.press("c")
    for theme in THEMES:
        page.evaluate(f"""() => {{
          const s = JSON.parse(localStorage.getItem('splitstone:v1'));
          s.settings.theme = '{theme}';
          localStorage.setItem('splitstone:v1', JSON.stringify(s));
          document.documentElement.setAttribute('data-theme', '{theme}');
        }}""")
        page.reload()
        page.wait_for_selector(".now-zone")
        page.screenshot(path=str(SHOTS / f"theme-{theme}.png"))
        print("wrote", theme)
    # Branded milestone shot (ember)
    page.evaluate("""() => {
      const s = JSON.parse(localStorage.getItem('splitstone:v1'));
      s.settings.theme = 'ember';
      localStorage.setItem('splitstone:v1', JSON.stringify(s));
    }""")
    page.reload()
    page.screenshot(path=str(SHOTS / "splitstone.png"))
    page.locator(".brand").screenshot(path=str(SHOTS / "splitstone-brand.png"))
    b.close()
print("ok")
