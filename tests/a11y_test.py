"""axe-core WCAG 2 A/AA scan per theme (campaign with ghost race on, endgame, tools, settings).
Needs the app on TRACKER_URL and axe-core: set AXE_PATH to axe.min.js, or
`npm i axe-core` somewhere and point AXE_PATH at node_modules/axe-core/axe.min.js.
Skips (exit 0) when axe-core isn't found. CSP is bypassed only to inject axe."""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from tracker_url import TRACKER_URL

URL = TRACKER_URL
CANDIDATES = [os.environ.get("AXE_PATH", ""), "/workspace/tools/node_modules/axe-core/axe.min.js",
              str(Path(__file__).resolve().parent.parent / "node_modules/axe-core/axe.min.js")]
AXE = next((p for p in CANDIDATES if p and Path(p).is_file()), None)
if not AXE:
    print("SKIP axe-core not found (set AXE_PATH)")
    sys.exit(0)
THEMES = ["ember", "slate", "crimson", "parchment"]
results = []


def check(name, ok, info=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""))


def scan(page):
    page.add_script_tag(path=AXE)
    res = page.evaluate("""() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
        resultTypes: ['violations'] }).then(r => r.violations.map(v => ({ id: v.id, n: v.nodes.length,
        sample: v.nodes.slice(0, 3).map(x => x.target.join(' ') + ' :: ' + (x.failureSummary || '').split('\\n').slice(-1)[0]) })))""")
    return res


with sync_playwright() as p:
    b = p.chromium.launch()
    for theme in THEMES:
        ctx = b.new_context(viewport={"width": 1366, "height": 900}, bypass_csp=True, reduced_motion="reduce")
        page = ctx.new_page()
        page.goto(URL)
        page.evaluate("""(t) => { const s = Storage2.load(); s.settings.theme = t; s.settings.ghostMode = true;
            localStorage.setItem('splitstone:v1', JSON.stringify(s)); }""", theme)
        page.reload(); page.wait_for_timeout(300)
        for view in ["campaign", "endgame", "tools", "settings"]:
            if view == "settings":
                page.click("#tab-campaign"); page.click('.topbar [data-action="settings"]')
            else:
                page.click(f"#tab-{view}")
            page.wait_for_timeout(150)
            v = scan(page)
            summary = ", ".join(f"{x['id']}×{x['n']}" for x in v)
            check(f"{theme}/{view}: no WCAG A/AA violations", not v, summary + " | " + json.dumps([x["sample"] for x in v])[:600])
            if view == "settings":
                page.keyboard.press("Escape")
        ctx.close()
    b.close()

passed = sum(ok for _, ok in results)
print(f"\n{passed}/{len(results)} passed")
sys.exit(0 if passed == len(results) else 1)
