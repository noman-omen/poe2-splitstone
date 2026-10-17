"""Character level from the run panel (−/+) and from Client.txt level-ups in the desktop app.
Needs the app on TRACKER_URL (see tracker_url.py)."""
import sys

from playwright.sync_api import sync_playwright
from tracker_url import TRACKER_URL

URL = TRACKER_URL
results = []

# Desktop bridge stand-in: Client.txt events are delivered through window.__zone, like the real onZone channel.
DESKTOP = """
window.splitstoneDesktop = new Proxy({ isDesktop: true,
  getStatus: async () => ({ watching: true, logExists: true, resolvedLogPath: 'Client.txt' }),
  onZone(cb) { window.__zone = cb; return () => {}; },
}, { get(t, k) {
  if (k in t) return t[k];
  if (typeof k === 'string' && k.startsWith('on')) return () => () => {};
  return async () => ({});
} });
"""
CHAR = "() => { const s = Storage2.load(); return s.characters[s.activeId]; }"


def check(name, ok, info=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""))


with sync_playwright() as p:
    b = p.chromium.launch()
    errs = []

    page = b.new_page(viewport={"width": 1366, "height": 900})
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL); page.evaluate("localStorage.clear()"); page.reload()
    page.keyboard.press("Space")
    up, down = '#now [data-action="lvl-step"][data-d="1"]', '#now [data-action="lvl-step"][data-d="-1"]'
    check("panel level cue has −/+", page.locator(up).is_visible() and page.locator(down).is_visible())
    page.click(up)
    check("+ with no level starts at the zone's level", page.evaluate(CHAR)["level"] == 1, page.evaluate(CHAR)["level"])
    page.click(up); page.click(up)
    check("+ raises the level", page.evaluate(CHAR)["level"] == 3)
    check("focus stays on the button", page.evaluate("document.activeElement.dataset.d") == "1")
    page.click(down)
    check("− lowers the level", page.evaluate(CHAR)["level"] == 2)
    page.click("#tab-character")
    check("Character tab shows the same level", page.input_value("#charLevel") == "2")
    page.click("#tab-campaign")
    page.evaluate("() => { const s = Storage2.load(); s.characters[s.activeId].level = 1; localStorage.setItem('splitstone:v1', JSON.stringify(s)); }")
    page.reload()
    check("− is disabled at level 1", page.locator(down).is_disabled())
    page.evaluate("() => { const s = Storage2.load(); s.characters[s.activeId].ign = '<b>x</b>'; localStorage.setItem('splitstone:v1', JSON.stringify(s)); }")
    page.reload()
    check("a bad in-game name in a save is dropped", page.evaluate(CHAR)["ign"] is None)
    check("no level-up prompt in the browser", page.locator(".lvl-seen").count() == 0)
    page.close()

    page = b.new_page(viewport={"width": 1366, "height": 900})
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script(DESKTOP)
    page.goto(URL); page.evaluate("localStorage.clear()"); page.reload(); page.wait_for_timeout(200)
    page.keyboard.press("Space")
    lvl = lambda ev: page.evaluate("ev => window.__zone(ev)", ev)
    lvl({"type": "level", "name": "Runner", "cls": "Monk", "level": 7}); page.wait_for_timeout(100)
    seen = page.locator("#now .lvl-seen")
    check("an unlinked character asks before using a level-up", seen.is_visible() and "Runner" in seen.text_content()
          and page.evaluate(CHAR)["level"] is None)
    page.click('#now [data-action="lvl-link"]')
    c = page.evaluate(CHAR)
    check("Use as this character links the name and takes the level", c["ign"] == "Runner" and c["level"] == 7, c)
    lvl({"type": "level", "name": "Runner", "cls": "Monk", "level": 8}); page.wait_for_timeout(100)
    check("the linked character's level-ups update the level", page.evaluate(CHAR)["level"] == 8)
    lvl({"type": "level", "name": "Partymate", "cls": "Warrior", "level": 30}); page.wait_for_timeout(100)
    check("someone else's level-up is ignored", page.evaluate(CHAR)["level"] == 8 and page.locator(".lvl-seen").count() == 0)
    for bad in [{"type": "level", "name": "Runner", "level": 500}, {"type": "level", "name": "Runner", "level": "9"},
                {"type": "level", "name": "<img src=x>", "level": 9}, {"type": "level", "name": "Runner", "level": 0}]:
        lvl(bad)
    page.wait_for_timeout(100)
    check("malformed level events are ignored", page.evaluate(CHAR)["level"] == 8, page.evaluate(CHAR)["level"])
    page.click("#tab-character")
    check("Character tab shows the in-game name", page.input_value("#charIgn") == "Runner")
    page.fill("#charIgn", "bad name!"); page.press("#charIgn", "Tab"); page.wait_for_timeout(100)
    check("an invalid name isn't saved", page.evaluate(CHAR)["ign"] == "Runner")
    page.fill("#charIgn", ""); page.press("#charIgn", "Tab"); page.wait_for_timeout(100)
    check("clearing the name unlinks the character", page.evaluate(CHAR)["ign"] is None)
    page.close()

    check("no JS errors", not errs, errs)
    b.close()

passed = sum(ok for _, ok in results)
print(f"\n{passed}/{len(results)} passed")
sys.exit(0 if passed == len(results) else 1)
