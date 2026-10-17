#!/usr/bin/env python3
"""End-to-end auto-split test: real helper + fake Client.txt appends + headless app.

Starts helper/splitstone_helper.py on a temp Client.txt (port 8767), enables
auto-split in the app, appends PoE2-style log lines and checks the splits.
"""
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from tracker_url import TRACKER_URL

URL = TRACKER_URL
ROOT = Path(__file__).resolve().parent.parent
PORT = 8767
results = []


def check(name, cond, info=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{info}]" if info and not cond else ""))


tmp = Path(tempfile.mkdtemp()) / "Client.txt"
tmp.write_text("2026/10/15 05:00:00 1 a [INFO Client 1] old line before the helper started\n")
seq = [0]


def enter(area, name, level=1):
    seq[0] += 1
    with tmp.open("a") as f:
        f.write(f'2026/10/15 05:40:{seq[0]:02d} 1 a [DEBUG Client 1] Generating level {level} area "{area}" with seed 1\n')
        f.write(f"2026/10/15 05:40:{seq[0]:02d} 1 a [INFO Client 1] : You have entered {name}.\n")


def C(page):
    return page.evaluate("(() => { const s = JSON.parse(localStorage.getItem('splitstone:v1')); return s.characters[s.activeId]; })()")


helper = subprocess.Popen([sys.executable, str(ROOT / "helper" / "splitstone_helper.py"), "--log", str(tmp), "--port", str(PORT)],
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
try:
    time.sleep(1.0)
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL)
        page.evaluate("localStorage.clear()")
        page.reload()
        check("auto-split is off by default", not page.is_checked("#autoSplit"))
        page.click(".as-settings summary")
        page.fill("#autoSplitUrl", f"http://127.0.0.1:{PORT}")
        page.press("#autoSplitUrl", "Tab")
        page.check("#autoSplit")
        page.wait_for_selector(".pill.as-connected", timeout=5000)
        check("status shows connected", page.locator(".pill.as-connected").count() >= 1)

        enter("G1_1", "The Riverbank")
        page.wait_for_function("() => document.querySelector('#now .now-zone').textContent.includes('Riverbank') && !!Run.runningZone(JSON.parse(localStorage.getItem('splitstone:v1')).characters[JSON.parse(localStorage.getItem('splitstone:v1')).activeId])", timeout=5000)
        check("entering first zone starts the run", C(page)["timers"]["zone:act1-z01"]["startedAt"])
        enter("G1_1", "The Riverbank")  # re-entry (death / checkpoint)
        time.sleep(0.8)
        check("re-entering the current zone is ignored", not C(page)["split"])
        enter("G1_town", "Clearfell Encampment")
        page.wait_for_function("() => document.querySelector('.zone.current')?.dataset.zone === 'act1-z02'", timeout=5000)
        check("entering next zone splits", "act1-z01" in C(page)["split"])
        enter("Hideout_Felled", "Felled Hideout")
        time.sleep(0.8)
        check("hideout ignored", len(C(page)["split"]) == 1)
        enter("G1_2", "Clearfell", 2)
        enter("G1_5", "The Red Vale", 5)   # skipped Grelwood (missed zone): split ahead
        page.wait_for_function("() => document.querySelector('.zone.current')?.dataset.zone === 'act1-z05'", timeout=5000)
        c = C(page)
        check("missed zone closed, jumps to entered zone", "act1-z04" in c["split"] and c["timers"]["zone:act1-z05"]["startedAt"])
        enter("G1_2", "Clearfell", 2)      # backtrack
        time.sleep(0.8)
        check("backtracking ignored", C(page)["timers"]["zone:act1-z05"]["startedAt"])
        check("last event shown", "Clearfell" in page.text_content("[data-as-last]"))
        page.reload()
        page.wait_for_selector(".pill.as-connected", timeout=5000)
        check("toggle persisted + reconnects after reload", page.is_checked("#autoSplit"))
        page.uncheck("#autoSplit")
        enter("G1_town", "Clearfell Encampment")
        time.sleep(0.8)
        check("toggle off: no more auto-splits", "act1-z05" not in C(page)["split"])
        check("no JS errors", not errors, errors)
        b.close()
finally:
    helper.terminate()
    out = helper.communicate(timeout=5)[0]
check("helper logged zone events", '"area": "g1_2"' in out, out[-300:])

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
