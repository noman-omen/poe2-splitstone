#!/usr/bin/env python3
"""Produce screenshots/overlay-corner.png — HTML mock of the top-right panel (Ember).

Also exercises overlay_state.lines_for_panel so the shot matches the real protocol.
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "helper"))
from overlay_state import lines_for_panel, normalise

SHOT = ROOT / "screenshots" / "overlay-corner.png"

state = normalise({
    "zone": "Cemetery of the Eternals",
    "section": "Act 1",
    "progress": "9/111",
    "step": "Activate waypoint + checkpoint, enter Tomb of the Consort",
    "tip": "Hug the walls to find both crypt entrances",
    "nextStep": "Kill Asinia → Memorial Key Piece",
    "nextZone": "Tomb of the Consort",
    "zoneMs": 48000,
    "runMs": 2253000,
    "deltaMs": 5000,
    "running": True,
})
rows = lines_for_panel(state)
colours = {"zone": "#e6c47a", "step": "#e8e0d0", "tip": "#f1e6c8", "next": "#a39a88", "timer": "#d0574e"}
sizes = {"zone": "13px", "step": "12.5px", "tip": "11px", "next": "10px", "timer": "18px"}
weights = {"zone": "700", "step": "650", "tip": "400", "next": "400", "timer": "700"}
body = "".join(
    f'<div class="row {role}" style="color:{colours[role]};font-size:{sizes[role]};font-weight:{weights[role]}">{text}</div>'
    for role, text in rows
)
html = f"""<!doctype html><html><head><meta charset=utf-8>
<style>
  html,body {{ margin:0; background:#2a2520; font-family:"Segoe UI",system-ui,sans-serif; }}
  .desktop {{ width:1280px; height:720px; background:linear-gradient(160deg,#1a1510,#0c0a08); position:relative; }}
  .game {{ position:absolute; inset:40px; border:1px solid #3a342a; border-radius:4px;
    background:radial-gradient(ellipse at 30% 40%, #2a2018, #0a0806 70%); opacity:.55; }}
  .game::after {{ content:"PoE2 (mock fullscreen)"; position:absolute; left:24px; bottom:20px;
    color:#6a6050; font-size:14px; letter-spacing:1px; }}
  .panel {{ position:absolute; top:48px; right:16px; width:360px; background:#1a1815;
    border:1px solid #c8a45a; border-radius:4px; padding:8px 12px 10px; box-shadow:0 8px 28px #000a;
    color:#e8e0d0; }}
  .title {{ color:#c8a45a; font-size:10px; font-weight:700; letter-spacing:1px; margin-bottom:4px; }}
  .row {{ margin:3px 0; line-height:1.35; }}
  .timer {{ font-family:Consolas,ui-monospace,monospace; margin-top:6px; }}
  .btns {{ margin-top:8px; display:flex; gap:6px; }}
  .btns span {{ border:1px solid #c8a45a; color:#e6c47a; font-size:11px; padding:2px 10px; border-radius:3px; }}
  .opts {{ margin-top:6px; color:#a39a88; font-size:10px; }}
</style></head><body><div class="desktop"><div class="game"></div>
<div class="panel" id="panel">
  <div class="title">SPLITSTONE</div>
  {body}
  <div class="btns"><span>Split</span><span>Pause</span><span>Undo</span></div>
  <div class="opts">Opacity ████████░░  ☐ Click-through</div>
</div></div></body></html>"""

out = ROOT / "tests" / "output"
out.mkdir(parents=True, exist_ok=True)
page_path = out / "overlay_mock.html"
page_path.write_text(html)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1280, "height": 720})
    page.goto(page_path.as_uri())
    page.screenshot(path=str(SHOT))
    page.locator("#panel").screenshot(path=str(ROOT / "screenshots" / "overlay-corner-panel.png"))
    b.close()
print("wrote", SHOT, SHOT.stat().st_size)
