"""Settings/Help dialogs, hotkey guard and the phone header menu.
Needs the app on TRACKER_URL (default http://127.0.0.1:8765/)."""
import json
import os
import sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("TRACKER_URL", "http://127.0.0.1:8765/")
results = []


def check(name, ok):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name)


def running(page):
    st = json.loads(page.evaluate("localStorage.getItem('splitstone:v1')") or "{}")
    c = (st.get("characters") or {}).get(st.get("activeId") or "", {})
    return any(t.get("startedAt") for t in (c.get("timers") or {}).values())


def fresh(b, **kw):
    ctx = b.new_context(**kw)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL); page.evaluate("localStorage.clear()"); page.reload()
    page.wait_for_selector("#now")
    return ctx, page, errs


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, page, errs = fresh(b, viewport={"width": 1366, "height": 768})
    opener = page.locator('.topbar [data-action="settings"]')
    opener.focus(); page.keyboard.press("Enter")
    check("settings is a modal dialog", page.evaluate("document.querySelector('#settings').open && document.querySelector('#settings:modal') !== null"))
    check("focus moves into settings", page.evaluate("document.getElementById('settings').contains(document.activeElement)"))
    page.keyboard.press("Space"); page.keyboard.press("s"); page.wait_for_timeout(150)
    check("Space/S don't start the timer while Settings is open", not running(page))
    page.keyboard.press("Escape"); page.wait_for_timeout(100)
    check("Esc closes settings", not page.locator("#settings").is_visible())
    check("focus returns to the Settings button", page.evaluate("document.activeElement === document.querySelector('.topbar [data-action=\"settings\"]')"))
    page.click('.topbar [data-action="help"]')
    check("help opens", page.locator("#help").is_visible())
    page.keyboard.press("Space"); page.wait_for_timeout(150)
    check("Space doesn't start the timer while Help is open", not running(page))
    page.mouse.click(10, 700); page.wait_for_timeout(100)
    check("outside click closes help", not page.locator("#help").is_visible())
    check("Space in Help presses nothing", not page.locator("#settings").is_visible())
    page.click('.topbar [data-action="settings"]')
    page.click('[data-action="settings-close"]')
    check("settings closes with its button", not page.locator("#settings").is_visible())
    page.click('[data-action="char-rename"]'); page.wait_for_selector("#appModal[open]")
    page.keyboard.press("Space"); page.keyboard.press("Escape"); page.wait_for_timeout(150)
    check("confirm box blocks hotkeys", not running(page))
    page.evaluate("document.activeElement.blur()"); page.keyboard.press("Space"); page.wait_for_timeout(150)
    check("Space starts the timer once dialogs are closed", running(page))
    check("no JS errors (desktop)", not errs)
    ctx.close()

    ctx, page, errs = fresh(b, viewport={"width": 390, "height": 844}, has_touch=True)
    btn = page.locator(".more-btn")
    btn.click()
    check("menu opens", page.locator('.topbar [data-action="export"]').is_visible() and btn.get_attribute("aria-expanded") == "true")
    page.keyboard.press("Escape"); page.wait_for_timeout(100)
    check("Esc closes menu", not page.locator('.topbar [data-action="export"]').is_visible())
    check("focus back on the menu button", page.evaluate("document.activeElement.classList.contains('more-btn')"))
    btn.click(); page.mouse.click(200, 700); page.wait_for_timeout(100)
    check("outside tap closes menu", not page.locator('.topbar [data-action="export"]').is_visible())
    btn.click(); page.click('.topbar [data-action="settings"]'); page.wait_for_timeout(100)
    check("picking an item closes menu and runs it", page.locator("#settings").is_visible()
          and not page.evaluate("document.querySelector('.topbar').classList.contains('menu-open')"))
    page.keyboard.press("Escape"); page.wait_for_timeout(100)
    check("focus returns to menu button after the dialog", page.evaluate("document.activeElement.classList.contains('more-btn')"))
    page.mouse.wheel(0, 2500); page.wait_for_timeout(300)
    tab = page.locator("#tab-endgame").bounding_box()
    check("phone tabs stay on screen after scrolling", tab and -4 <= tab["y"] < 60)
    now = page.locator("#now").bounding_box()
    check("now bar sits under the tabs", now and abs(now["y"] - (tab["y"] + tab["height"])) < 12)
    check("no JS errors (phone)", not errs)
    ctx.close()
    b.close()

passed = sum(ok for _, ok in results)
print(f"\n{passed}/{len(results)} passed")
sys.exit(0 if passed == len(results) else 1)
