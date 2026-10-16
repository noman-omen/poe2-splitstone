#!/usr/bin/env python3
"""Save safety: unreadable saves and failed migrations never get overwritten.

Simulates QuotaExceededError by wrapping localStorage.setItem in the page.
Needs the app on http://127.0.0.1:8765.
"""
import json
import sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/"
KEY = "splitstone:v1"
fails, passed = [], 0


def check(name, ok, detail=""):
    global passed
    if ok:
        passed += 1; print("PASS", name)
    else:
        fails.append(name); print("FAIL", name, detail)


LEGACY = {"schema": 1, "activeId": "c1", "settings": {}, "characters": {"c1": {
    "id": "c1", "name": "Old char", "created": "2026-09-01T10:00:00.000Z", "done": {"a1-s1": True}, "timers": {},
    "maps": [], "mapHistory": [{"id": "h1", "name": "Burial Bog (T5)", "ms": 210000, "finished": "2026-10-01T12:03:30.000Z"}],
    "history": [], "bests": {}, "split": {}, "golds": {}, "undo": []}}}

# Throws QuotaExceededError for any key matching the given regex.
QUOTA = """(pattern) => {
  const real = Storage.prototype.setItem;
  window.__quota = new RegExp(pattern);
  Storage.prototype.setItem = function (k, v) {
    if (window.__quota && window.__quota.test(k)) throw new DOMException("full", "QuotaExceededError");
    return real.call(this, k, v);
  };
}"""


def fresh(b, seed=None, quota=None):
    ctx = b.new_context()
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL)
    page.evaluate("localStorage.clear()")
    if seed is not None:
        page.evaluate("([k, v]) => localStorage.setItem(k, v)", [KEY, seed])
    if quota:
        page.add_init_script(f"({QUOTA})({json.dumps(quota)})")
    page.reload()
    return ctx, page, errs


raw_of = lambda page, k=KEY: page.evaluate("k => localStorage.getItem(k)", k)

with sync_playwright() as p:
    b = p.chromium.launch()

    # 1) Unreadable save: never overwritten, user warned, edits not saved.
    ctx, page, errs = fresh(b, seed="{not json")
    check("unreadable: warning shown", page.locator("#storageWarn").is_visible() and "couldn't be read" in page.text_content("#storageWarn"))
    page.click('[data-action="char-new"]'); page.fill("#appModalInput", "X"); page.click("#appModalOk")
    check("unreadable: save left untouched after an edit", raw_of(page) == "{not json")
    page.click('[data-action="storage-overwrite"]'); page.click("#appModalOk")
    check("unreadable: explicit overwrite writes a valid save", json.loads(raw_of(page))["schema"] == 2)
    check("unreadable: warning cleared", not page.locator("#storageWarn").is_visible())
    ctx.close()

    # 2) Migration backup can't be written (quota): old save kept, migrated state in memory, warning.
    legacy = json.dumps(LEGACY)
    ctx, page, errs = fresh(b, seed=legacy, quota="backup")
    check("migration quota: old save untouched", raw_of(page) == legacy)
    check("migration quota: migrated data shown in memory",
          page.evaluate("() => { document.querySelector('#tab-endgame').click(); return document.querySelector('#viewEndgame').textContent.includes('Burial Bog'); }"))
    check("migration quota: warning shown", "back up your save" in page.text_content("#storageWarn"))
    page.click("#tab-campaign")
    check("migration quota: later edits don't overwrite", raw_of(page) == legacy)
    check("no JS errors (quota case)", not errs, errs)
    ctx.close()

    # 3) Migration write itself fails after the backup is stored: data still safe in the backup + old key.
    ctx, page, errs = fresh(b, seed=legacy, quota="^splitstone:v1$")
    check("main write quota: backup stored", raw_of(page, KEY + ":backup-schema1") == legacy)
    check("main write quota: old save still present", raw_of(page) == legacy)
    check("main write quota: storage-full warning", "storage full" in page.text_content("#storageWarn"))
    ctx.close()

    # 4) Normal migration: backup kept, restore action works, backup dropped after 50 saves.
    ctx, page, errs = fresh(b, seed=legacy)
    check("migration: backup kept", raw_of(page, KEY + ":backup-schema1") == legacy)
    page.click('[data-action="settings"]')
    check("settings shows restore action", page.locator('[data-action="restore-backup"]').is_visible())
    page.click('[data-action="settings-close"]')
    page.click('[data-action="char-rename"]'); page.fill("#appModalInput", "Renamed"); page.click("#appModalOk")
    page.click('[data-action="settings"]'); page.click('[data-action="restore-backup"]'); page.click("#appModalOk")
    page.wait_for_timeout(200)
    st = json.loads(raw_of(page))
    check("restore brings back the pre-1.1 data", st["characters"]["c1"]["name"] == "Old char" and st["schema"] == 2)
    page.click('[data-action="settings-close"]')
    for i in range(50):
        page.evaluate("() => Storage2.save(Storage2.load())")
    check("backup dropped after 50 good saves", raw_of(page, KEY + ":backup-schema1") is None)
    ctx.close()

    # 5) Ordinary save hitting quota: warning, no crash.
    ctx, page, errs = fresh(b)
    page.evaluate(f"({QUOTA})('^splitstone:v1$')")
    page.click('[data-action="char-rename"]'); page.fill("#appModalInput", "Y"); page.click("#appModalOk")
    check("save quota: warning with export button", page.locator('#storageWarn [data-action="export"]').is_visible())
    check("no JS errors (save quota)", not errs, errs)
    ctx.close()
    b.close()

print(f"\n{passed}/{passed + len(fails)} passed")
sys.exit(1 if fails else 0)
