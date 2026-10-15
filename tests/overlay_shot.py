#!/usr/bin/env python3
"""screenshots/overlay-corner.png — race-mode top-right panel mock (Ember)."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "helper"))
from overlay_state import lines_for_panel, normalise, key_label

SHOT = ROOT / "screenshots" / "overlay-corner.png"
PANEL = ROOT / "screenshots" / "overlay-corner-panel.png"

state = normalise({
    "zone": "Cemetery of the Eternals", "section": "Act 1", "progress": "9/111",
    "step": "Activate waypoint + checkpoint, enter Tomb of the Consort",
    "tip": "Hug the walls to find both crypt entrances — and keep going past the long optional digression that should truncate",
    "nextStep": "Kill Asinia → Memorial Key Piece", "nextZone": "Tomb of the Consort",
    "zoneMs": 48000, "runMs": 2253000, "deltaMs": 5000, "running": True,
    "hotkeys": {"split": " ", "pause": "p", "undo": "u"},
})
rows = lines_for_panel(state)
colours = {"zone": "#e6c47a", "step": "#e8e0d0", "tip": "#f1e6c8", "next": "#a39a88",
           "seg": "#e6c47a", "run": "#a39a88", "delta": "#d0574e", "status": "#d0574e"}
sizes = {"zone": "13px", "step": "12.5px", "tip": "11px", "next": "10px",
         "seg": "16px", "run": "12px", "delta": "14px", "status": "11px"}
weights = {"zone": "700", "step": "650", "tip": "400", "next": "400",
           "seg": "700", "run": "400", "delta": "700", "status": "700"}
body = "".join(
    f'<div class="row {role}" style="color:{colours[role]};font-size:{sizes[role]};font-weight:{weights[role]}">{text}</div>'
    for role, text in rows
)
hk = state["hotkeys"]
btns = "".join(
    f'<span>{a.title()} ({key_label(hk[a])})</span>' for a in ("split", "pause", "undo")
)
html = f"""<!doctype html><html><head><meta charset=utf-8>
<style>
  html,body {{ margin:0; background:#2a2520; font-family:"Segoe UI",system-ui,sans-serif; }}
  .desktop {{ width:1280px; height:720px; background:linear-gradient(160deg,#1a1510,#0c0a08); position:relative; }}
  .game {{ position:absolute; inset:40px; border:1px solid #3a342a; border-radius:4px;
    background:radial-gradient(ellipse at 30% 40%, #2a2018, #0a0806 70%); opacity:.55; }}
  .game::after {{ content:"PoE2 (mock fullscreen) · race overlay"; position:absolute; left:24px; bottom:20px;
    color:#6a6050; font-size:14px; }}
  .panel {{ position:absolute; top:48px; right:16px; width:340px; background:#1a1815;
    border:1px solid #c8a45a; border-radius:4px; padding:6px 12px 8px; box-shadow:0 8px 28px #000a; }}
  .bar {{ display:flex; justify-content:space-between; align-items:center; margin-bottom:2px; }}
  .bar .mark {{ color:#c8a45a; font-size:11px; }}
  .bar .gear {{ color:#a39a88; font-size:12px; }}
  .row {{ margin:2px 0; line-height:1.3; }}
  .btns {{ margin-top:6px; display:flex; gap:6px; }}
  .btns span {{ border:1px solid #c8a45a; color:#e6c47a; font-size:11px; padding:2px 8px; border-radius:3px; }}
  .note {{ position:absolute; bottom:16px; right:16px; color:#6a6050; font-size:11px; text-align:right; }}
</style></head><body><div class="desktop"><div class="game"></div>
<div class="panel" id="panel">
  <div class="bar"><span class="mark">◆ splitstone</span><span class="gear">⚙</span></div>
  {body}
  <div class="btns">{btns}</div>
</div>
<div class="note">Settings (opacity / click-through) behind ⚙ · buttons hide when click-through is on</div>
</div></body></html>"""
out = ROOT / "tests" / "output"
out.mkdir(parents=True, exist_ok=True)
page_path = out / "overlay_mock.html"
page_path.write_text(html)
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1280, "height": 720})
    page.goto(page_path.as_uri())
    page.screenshot(path=str(SHOT))
    page.locator("#panel").screenshot(path=str(PANEL))
    b.close()
print("wrote", SHOT.stat().st_size)
