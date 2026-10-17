#!/usr/bin/env python3
"""Endgame + Tools tabs: storage migration, export/import, links, screenshots.

Needs the app served on http://127.0.0.1:8765. Writes endgame.png and tools.png
to test-output/ (or screenshots/ with SPLITSTONE_UPDATE_SHOTS=1).
"""
import json
from modal_helpers import fill_modal, reveal_click
from datetime import datetime
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shot_dir import shot_dir  # noqa: E402

URL = "http://127.0.0.1:8765/"
fails = []
passed = 0


def check(name, ok, detail=""):
    global passed
    if ok:
        passed += 1
        print("PASS", name)
    else:
        fails.append(name)
        print("FAIL", name, detail)


LEGACY = {
    "schema": 1, "activeId": "c1",
    "settings": {"theme": "ember"},
    "characters": {"c1": {
        "id": "c1", "name": "Old char", "created": "2026-09-01T10:00:00.000Z",
        "done": {}, "timers": {}, "maps": [{"id": "m1", "name": "Burial Bog (T5)"}],
        "mapHistory": [
            {"id": "h1", "name": "Burial Bog (T5)", "ms": 210000, "finished": "2026-10-01T12:03:30.000Z"},
            {"id": "h2", "name": "Savannah (T6)", "ms": 185000, "finished": "2026-10-01T11:00:00.000Z"},
        ],
        "history": [], "bests": {}, "split": {}, "golds": {}, "undo": [],
    }},
}

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.clock.install(time=datetime(2026, 10, 16, 19, 0, 0))  # fixed start time
    page.goto(URL)

    # --- Migration: schema 1 mapHistory -> endgame runs ---
    page.evaluate("s => localStorage.setItem('splitstone:v1', JSON.stringify(s))", LEGACY)
    page.reload()
    saved = page.evaluate("JSON.parse(localStorage.getItem('splitstone:v1'))")
    c = saved["characters"]["c1"]
    check("schema bumped to 2", saved["schema"] == 2, saved["schema"])
    check("mapHistory migrated to endgame.runs", [r["map"] for r in c["endgame"]["runs"]] == ["Burial Bog", "Savannah"]
          and [r["tier"] for r in c["endgame"]["runs"]] == [5, 6], c.get("endgame"))
    check("old map keys dropped", "mapHistory" not in c and "maps" not in c)
    check("campaign data untouched", c["name"] == "Old char")
    check("pre-migration backup kept", page.evaluate("!!localStorage.getItem('splitstone:v1:backup-schema1')"))

    # --- Endgame tab ---
    page.click("#tab-endgame")
    check("migrated runs listed", page.locator(".eg-runs li").count() == 2 or "Burial Bog" in page.text_content("#viewEndgame"))
    check("auto-detect toggle hidden in the browser", not page.locator("#egAutoDetect").is_visible())
    check("view remembered", page.evaluate("JSON.parse(localStorage.getItem('splitstone:v1')).settings.view") == "endgame")
    page.reload()
    check("endgame tab restored after reload", page.locator("#viewEndgame").is_visible())

    # Demo session for the screenshot
    check("empty state explains the flow", "session opens automatically" in page.text_content("#viewEndgame") or page.locator('.eg-runs li').count() > 0)
    demo = [("Burial Bog", 12, 245, 0, "Divine Orb", True), ("Savannah", 12, 198, 0, "", True),
            ("Vaal Factory", 13, 312, 1, "Exalted x3", True), ("Sandspit", 13, 140, 2, "", False),
            ("Crimson Shores", 13, 221, 0, "Perfect Jeweller's Orb", True)]
    for name, tier, secs, deaths, loot, ok in demo:
        page.fill("#egMap", name); page.fill("#egTier", str(tier))
        page.click(".eg-start button")
        page.clock.fast_forward(secs * 1000)
        for _ in range(deaths):
            page.click('[data-action="eg-death"]')
        if loot:
            page.fill('[data-eg-field="loot"]', loot); page.press('[data-eg-field="loot"]', "Tab")
        page.click(f'[data-action="eg-finish"][data-completed="{1 if ok else 0}"]')
        page.clock.fast_forward(40_000)  # hideout time between maps
    page.fill("#egMap", "Lost Towers"); page.fill("#egTier", "14"); page.fill("#egMods", "Monsters deal 30% extra fire")
    page.click(".eg-start button"); page.clock.fast_forward(97_000)
    eg = page.evaluate("JSON.parse(localStorage.getItem('splitstone:v1')).characters.c1.endgame")
    check("session has 5 runs + active", len([r for r in eg["runs"] if r["sessionId"] == eg["sessionId"]]) == 5 and eg["active"]["map"] == "Lost Towers")
    check("loot saved on run", any(r["loot"] == "Divine Orb" for r in eg["runs"]))
    for mid in ("first-map", "first-tower", "ancient-gateway", "enigma-east", "enigma-west", "arbiter-ash", "kulemak"):
        page.check(f'[data-eg-milestone="{mid}"]')
    check("atlas progress counter", page.text_content(".eg-atlas .badge").startswith("7/"))
    check("unverified items flagged", page.locator("abbr.unverified").count() >= 1)
    page.wait_for_timeout(300)
    page.screenshot(path=str(shot_dir() / "endgame.png"), full_page=True)

    # --- Export / import round trip ---
    with page.expect_download() as dl:
        reveal_click(page, '[data-action="export"]')
    exp = json.loads(Path(dl.value.path()).read_text())
    ec = exp["characters"]["c1"]["endgame"]
    check("export includes endgame runs, sessions and atlas", len(ec["runs"]) == 7 and ec["sessions"] and "arbiter-ash" in ec["atlas"])
    page.evaluate("localStorage.clear()"); page.reload()
    page.set_input_files("#importFile", {"name": "e.json", "mimeType": "application/json", "buffer": json.dumps(exp).encode()})
    for _ in range(3):  # optional confirms: replace characters, apply settings, apply helper URL
        try:
            fill_modal(page, timeout=1500)
        except Exception:
            break
    page.wait_for_timeout(300)
    back = page.evaluate("JSON.parse(localStorage.getItem('splitstone:v1')).characters.c1")
    check("import restores endgame", back and len(back["endgame"]["runs"]) == 7 and back["endgame"]["active"]["map"] == "Lost Towers")

    # --- Tools tab ---
    page.click("#tab-tools")
    links = page.eval_on_selector_all(".tools-grid a.tool", "as => as.map(a => [a.href, a.target, a.rel])")
    check("tools listed", len(links) >= 6, len(links))
    check("all tool links https, new tab, noopener", all(h.startswith("https://") and t == "_blank" and "noopener" in r for h, t, r in links), links)
    page.screenshot(path=str(shot_dir() / "tools.png"))

    # Phone layout sanity
    m = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    m.goto(URL); m.click("#tab-endgame")
    check("endgame fits a phone (no horizontal scroll)", m.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))

    check("no JS errors", not errors, errors)
    b.close()

print(f"\n{passed}/{passed + len(fails)} passed")
sys.exit(1 if fails else 0)
