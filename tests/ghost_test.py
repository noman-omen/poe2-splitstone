"""Ghost / race mode in the browser.
Needs the app on TRACKER_URL (see tracker_url.py).
Writes test-output/ghost-mode.png (screenshots/ with SPLITSTONE_UPDATE_SHOTS=1)."""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shot_dir import shot_dir  # noqa: E402
from tracker_url import TRACKER_URL

URL = TRACKER_URL
ROOT = Path(__file__).resolve().parent.parent
KEY = "splitstone:v1"
results = []


def check(name, ok, info=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""))


def saved(page):
    return json.loads(page.evaluate(f"localStorage.getItem('{KEY}')"))


def char(page):
    s = saved(page)
    return s["characters"][s["activeId"]]


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1366, "height": 900})
    ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=URL.rstrip("/"))
    page = ctx.new_page()
    page.clock.install()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL)
    page.evaluate("localStorage.clear()")
    page.reload()

    # Off by default
    check("ghost race off by default", page.evaluate("Storage2.load().settings.ghostMode") is False)
    check("ghost panel hidden by default", not page.locator("#ghost").is_visible())
    check("no ghost line in the now bar by default", page.locator("[data-ghost-now]").count() == 0)

    # Seed a PB, best segments and an older reset run for this character (1.1-shaped save).
    info = page.evaluate("""() => {
      const s = Storage2.load(); const c = s.characters[s.activeId];
      const order = Run.order(c); return { ids: order.map(o => o.zone.id), names: order.map(o => o.zone.name),
        groups: order.map(o => o.group), variant: Run.variantKey(Run.route(c)) }; }""")
    ids, names, variant = info["ids"], info["names"], info["variant"]
    s = json.loads(page.evaluate("JSON.stringify(Storage2.load())"))
    c = s["characters"][s["activeId"]]
    pb_zones = {z: 60_000 for z in ids}
    c["history"] = [
        {"id": "pbrun", "complete": True, "variant": variant, "total": 60_000 * len(ids), "zones": pb_zones,
         "sections": {}, "groups": {}, "finished": "2026-10-10T20:00:00.000Z", "splitsDone": len(ids), "zonesTotal": len(ids)},
        {"id": "oldrun", "complete": False, "variant": variant, "total": 700_000, "zones": {z: 70_000 for z in ids[:10]},
         "sections": {}, "groups": {}, "finished": "2026-10-01T20:00:00.000Z", "splitsDone": 10, "zonesTotal": len(ids)},
    ]
    c["bests"] = {variant: {f"zone:{z}": 50_000 for z in ids}}
    c.pop("ghost", None)                 # a 1.1 save has no ghost fields
    s["settings"].pop("ghostMode", None)
    page.evaluate("v => localStorage.setItem('splitstone:v1', v)", json.dumps(s))
    page.reload()
    check("1.1 save loads without a migration backup", page.evaluate(f"localStorage.getItem('{KEY}:backup-schema1')") is None)
    check("1.1 save keeps its history", len(char(page)["history"]) == 2)
    check("1.1 save is not rewritten just by loading", "ghost" not in char(page))
    check("1.1 save gets default ghost settings in memory", page.evaluate(
        "(() => { const s = Storage2.load(); return JSON.stringify(s.characters[s.activeId].ghost); })()") == '{"pick":"pb","imported":[]}')

    # Turn it on in Settings
    page.click('.topbar [data-action="settings"]')
    page.check("#ghostModeSetting")
    page.keyboard.press("Escape")
    check("setting saved", saved(page)["settings"]["ghostMode"] is True)
    check("ghost panel shown", page.locator("#ghost").is_visible())
    check("PB is the default comparison", page.locator("#ghostPick").input_value() == "pb")

    # Race: zone 1 in 40 s (20 s ahead), zone 2 in 90 s (30 s behind), zone 3 running.
    page.evaluate("document.activeElement && document.activeElement.blur()")
    page.keyboard.press("Space"); page.clock.run_for(40_000); page.keyboard.press("Space")
    page.clock.run_for(90_000); page.keyboard.press("Space")
    page.clock.run_for(15_000)
    rows = page.locator("#ghost .ghost-splits tbody tr")
    check("one row per split plus the live zone", rows.count() == 3, rows.count())
    r1 = rows.nth(0).locator("td"); r2 = rows.nth(1).locator("td")
    check("split 1: 20 s ahead, green", r1.nth(0).inner_text() == "−0:20" and r1.nth(0).locator(".ahead").count() == 1,
          r1.nth(0).inner_text())
    check("split 2: segment 30 s behind, red", r2.nth(0).inner_text() == "+0:30" and r2.nth(0).locator(".behind").count() == 1)
    check("split 2: cumulative 10 s behind", r2.nth(1).inner_text() == "+0:10")
    check("cumulative delta in the panel header", page.locator("[data-ghost-cum]").inner_text() == "+0:10")
    pos = page.text_content("#ghostLive")
    check("ghost position: 145 s in = zone 3", f"The ghost is in {names[2]}" in pos, pos[:120])
    check("now bar shows where the ghost is", f"Ghost in {names[2]}" in page.text_content("[data-ghost-now]"))
    check("act summary shows time lost so far", "so far" in page.text_content(".ghost-acts") and "+0:10" in page.text_content(".ghost-acts"))
    check("live row counts down the ghost's segment", "left" in rows.nth(2).inner_text())
    page.clock.run_for(60_000)
    check("tick moves the ghost on", f"The ghost is in {names[3]}" in page.text_content("#ghostLive"))
    check("tick updates the live delta once slower than the ghost", page.locator("[data-ghost-cum]").inner_text() == "+0:25",
          page.locator("[data-ghost-cum]").inner_text())
    page.screenshot(path=str(shot_dir() / "ghost-mode.png"))

    # Other comparisons
    page.select_option("#ghostPick", "sob")
    # Zone 1's 40 s just became the best segment; zone 2's 90 s is 40 s over its 50 s best.
    sob = page.locator("#ghost .ghost-splits tbody tr")
    check("best segments comparison", sob.nth(0).locator("td").nth(0).inner_text() == "±0:00"
          and sob.nth(1).locator("td").nth(0).inner_text() == "+0:40")
    page.select_option("#ghostPick", "run:oldrun")
    check("past run comparison", page.locator("#ghost .ghost-splits tbody tr").nth(0).locator("td").nth(0).inner_text() == "−0:30")
    check("pick saved per character", char(page)["ghost"]["pick"] == "run:oldrun")

    # Share code round trip, with an HTML-ish name that must be escaped
    code = page.evaluate("""(n) => Ghost.encode({ name: n, variant: 'normal', total: 1000,
        zones: Object.fromEntries(Run.ALL.slice(0, 3).map(o => [o.zone.id, 30000])) })""", "<img src=x onerror=window.__pwned=1>Rival")
    page.click("#ghost summary")
    page.fill("#ghostImportText", code)
    page.click('[data-action="ghost-import"]')
    page.wait_for_timeout(300)
    check("imported ghost selected", page.locator("#ghostPick").input_value().startswith("imp:"), page.text_content("#toast"))
    check("imported name is escaped", page.locator("#ghost img").count() == 0 and "<img" in page.locator("#ghostPick option:checked").inner_text())
    check("no script ran from the name", page.evaluate("window.__pwned") is None)
    check("imported ghost stored", char(page)["ghost"]["imported"][0]["zones"].get(ids[0]) == 30000)
    check("imported ghost in the JSON export", "imported" in json.dumps(char(page)["ghost"]))

    page.click('[data-action="ghost-share"]')
    for _ in range(50):
        if page.input_value("#ghostImportText").startswith("SSG1."):
            break
        page.wait_for_timeout(100)
    shared = page.input_value("#ghostImportText")
    check("copy ghost code (shown in the box too)", shared.startswith("SSG1.") and "copied" in page.text_content("#toast").lower()
          or "in the box" in page.text_content("#toast"), page.text_content("#toast"))
    back = page.evaluate("c => Ghost.parse(c, { knownZones: new Set(Run.ALL.map(o => o.zone.id)) }).then(g => g.name)", shared)
    check("shared code decodes to the selected ghost", "Rival" in back, back)

    # Bad input
    page.fill("#ghostImportText", "SSG1.!!notacode")
    page.click('[data-action="ghost-import"]')
    check("bad code is refused with a message", "Not loaded" in page.text_content("#toast"))
    page.fill("#ghostImportText", '{"app":"splitstone","characters":{"x":{"name":"A","history":[]}}}')
    page.click('[data-action="ghost-import"]')
    check("export without completed runs refused", "no completed" in page.text_content("#toast"))
    check("still one imported ghost", len(char(page)["ghost"]["imported"]) == 1)

    # Import a friend's export file
    friend = {"app": "splitstone", "schema": 2, "characters": {"f1": {"name": "Friend", "history": [
        {"complete": True, "variant": variant, "total": 999_000, "zones": {ids[0]: 33_000, ids[1]: 44_000, "evil<zone>": 1}}]}}}
    tmp = ROOT / "test-output" / "friend-export.json"
    tmp.parent.mkdir(exist_ok=True)
    tmp.write_text(json.dumps(friend))
    page.set_input_files("#ghostFile", str(tmp))
    page.wait_for_timeout(300)
    g = char(page)["ghost"]["imported"][0]
    check("friend's export becomes a ghost", g["name"] == "Friend PB" and g["zones"] == {ids[0]: 33_000, ids[1]: 44_000}, g)

    # Remove
    page.click('[data-action="ghost-remove"]'); page.click("#appModalOk")
    check("ghost removed", len(char(page)["ghost"]["imported"]) == 1)

    # Focus mode hides the panel, keeps the one-line now-bar summary
    page.evaluate("document.activeElement && document.activeElement.blur()"); page.keyboard.press("f")
    check("focus mode hides the ghost panel", not page.locator("#ghost").is_visible())
    check("focus mode keeps the now-bar ghost line", page.locator("[data-ghost-now]").is_visible())
    page.keyboard.press("f")

    # Overlay stays step/hint/next only
    overlay_src = "".join(f.read_text() for f in (ROOT / "desktop" / "overlay").glob("*") if f.is_file())
    check("overlay has no ghost content", "ghost" not in overlay_src.lower())
    page.evaluate("""() => { const st = AutoSplit.status;
        AutoSplit.status = () => Object.assign({}, st(), { state: "connected" });
        AutoSplit.pushState = s => { window.__ov = s; }; }""")
    page.clock.run_for(2_000)
    ov = page.evaluate("JSON.stringify(window.__ov || null)")
    check("overlay payload was captured", ov not in (None, "null"), ov)
    check("overlay payload has no ghost fields", "ghost" not in (ov or "").lower(), ov)

    # Turning it off hides everything again
    page.click('.topbar [data-action="settings"]'); page.uncheck("#ghostModeSetting"); page.keyboard.press("Escape")
    check("off again hides the panel", not page.locator("#ghost").is_visible() and page.locator("[data-ghost-now]").count() == 0)
    check("no JS errors", not errs, errs)
    b.close()

passed = sum(ok for _, ok in results)
print(f"\n{passed}/{len(results)} passed")
sys.exit(0 if passed == len(results) else 1)
