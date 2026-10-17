#!/usr/bin/env python3
"""screenshots/overlay-minimal.png: the real desktop overlay page over a bright scene."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
from shot_dir import shot_dir  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SHOT = shot_dir() / "overlay-minimal.png"
STATE = {
    "step": "Activate the waypoint, then enter the Tomb of the Consort",
    "tip": "Hug the walls to find both crypt entrances",
    "nextStep": "Kill Asinia for the Memorial Key Piece",
    "showTip": True,
}
STUB = """
window.splitstoneOverlay = {
  onState(cb) { window.__push = cb; }, onLock() {}, onToast() {},
  onBox(cb) { window.__box = cb; }, fitWidth() {}, resize() {},
  ready() { window.__box({ width: 400, height: 80, custom: true }); window.__push(%s); },
};
""" % json.dumps(STATE)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 400, "height": 80}, device_scale_factor=2)
    page.add_init_script(STUB)
    page.goto((ROOT / "desktop" / "overlay" / "overlay.html").as_uri())
    # Bright snowy backdrop to prove readability; 0.8 = default window opacity.
    page.add_style_tag(content="""
      html { background: linear-gradient(135deg,#f4f1ea 0%,#d9e4ee 45%,#fff6d8 100%); }
      #panel { opacity: .8; }
    """)
    page.wait_for_timeout(200)
    text = page.text_content("#panel")
    ok = "Tomb of the Consort" in text and "Next" in text and "crypt" not in text
    page.screenshot(path=str(SHOT))
    b.close()
print("PASS overlay shows the step and next step only" if ok else "FAIL overlay content: " + text)
sys.exit(0 if ok else 1)
