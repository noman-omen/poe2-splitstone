"""Malformed and hostile imports, clock jumps and two tabs (Reggie B1, m5, p2, p3).
Needs the app on TRACKER_URL (default http://127.0.0.1:8765/)."""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = os.environ.get("TRACKER_URL", "http://127.0.0.1:8765/")
KEY = "splitstone:v1"
OUT = Path(__file__).resolve().parent.parent / "test-output"
OUT.mkdir(exist_ok=True)
results = []


def check(name, ok, info=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""))


def saved(page):
    return json.loads(page.evaluate(f"localStorage.getItem('{KEY}')") or "null")


def answer(page, ok=True):
    page.wait_for_selector("#appModal[open]", timeout=5000)
    page.click("#appModalOk" if ok else "#appModalCancel")
    page.wait_for_timeout(150)


def import_file(page, data, name="import.json"):
    buf = data if isinstance(data, bytes) else json.dumps(data).encode()
    page.set_input_files("#importFile", {"name": name, "mimeType": "application/json", "buffer": buf})


def fresh(b, **kw):
    ctx = b.new_context(**kw)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL); page.evaluate("localStorage.clear()"); page.reload()
    return ctx, page, errs


HOSTILE = {
    "app": "splitstone", "schema": 2, "activeId": "evil",
    "characters": {
        "evil": {
            "name": "Ev\u202eil\u061c\u00ad\u200bName",
            "build": {"className": "x", "passives": "<img src=x onerror=\"window.__pwned=1\">",
                      "items": "<a href=\"javascript:alert(1)\">click</a>"},
            "history": [
                None, "junk", 42, {"total": -5, "zones": {}}, {"zones": {"act1-z01": 1000}},
                {"id": "ok1", "complete": True, "variant": "normal", "total": 90000,
                 "zones": {"act1-z01": 90000}, "finished": "2026-10-10T00:00:00Z"},   # no groups/sections
                {"id": "<b>", "complete": True, "total": 100000, "zones": {"act1-z01": "100000"},
                 "variant": "\"><img src=x>", "finished": "not a date"},
            ],
            "undo": [{"zone": "x"}, {"zone": "act1-z01", "autoMarked": ["s1"], "prevBests": {}, "golds": [], "wasRunning": False, "extra": []}],
            "timers": {"zone:act1-z01": {"elapsed": -50000, "startedAt": "soon"}},
            "bests": {"normal": {"zone:act1-z01": "abc", "zone:act1-z02": 1000}},
        },
        "__proto__": {"name": "Proto", "history": []},
        "constructor": {"name": "Ctor"},
        "../../etc": {"name": "Path"},
    },
}

with sync_playwright() as p:
    b = p.chromium.launch()

    # --- B1 / p2: hostile import ---
    ctx, page, errs = fresh(b, viewport={"width": 1366, "height": 900})
    raw = json.dumps(HOSTILE).replace('"__proto__"', '"__proto__"')
    import_file(page, raw.encode())
    page.wait_for_timeout(400)
    if page.locator("#appModal[open]").count():   # settings question etc. never asked for this file
        answer(page, False)
    st = saved(page)
    chars = st["characters"]
    names = sorted(c["name"] for c in chars.values())
    check("hostile file imports without crashing", "EvilName" in names, names)
    check("bidi, ALM, soft hyphen and zero-width stripped from names", "EvilName" in names and not any(
        ch in "".join(names) for ch in "\u202e\u061c\u00ad\u200b"))
    check("__proto__ / constructor / path ids replaced with safe ids", all(
        k not in ("__proto__", "constructor", "../../etc") for k in chars), list(chars))
    check("__proto__ character kept as data", "Proto" in names and "Ctor" in names and "Path" in names, names)
    check("Object.prototype not polluted", page.evaluate("({}).name === undefined && ({}).history === undefined"))
    evil = next(c for c in chars.values() if c["name"] == "EvilName")
    check("build rebuilt from known fields", evil["build"]["className"] == "x" and evil["build"]["passives"] == 0
          and evil["build"]["items"] == 0 and evil["build"]["stats"] == [] and evil["build"]["skills"] == [], evil["build"])
    page.select_option("#charSelect", evil["id"]); page.wait_for_timeout(200)
    check("no injected img/a in the character card", page.locator("#character img, #character a[href^='javascript']").count() == 0)
    check("no script ran", page.evaluate("window.__pwned") is None)
    hist = evil["history"]
    check("malformed history entries skipped", [h["id"] for h in hist][:1] == ["ok1"] and len(hist) == 2, [h["id"] for h in hist])
    check("history entry without groups gets empty maps", hist[0]["groups"] == {} and hist[0]["sections"] == {})
    check("bad id, variant and date replaced", hist[1]["id"] != "<b>" and hist[1]["variant"] == "normal"
          and hist[1]["zones"]["act1-z01"] == 100000)
    check("undo dropped on import", evil["undo"] == [])
    check("negative / junk timers clamped", evil["timers"]["zone:act1-z01"] == {"elapsed": 0, "startedAt": None})
    check("non-numeric bests dropped", evil["bests"]["normal"] == {"zone:act1-z02": 1000})
    page.keyboard.press("u"); page.wait_for_timeout(100)
    page.click('a[href="#stats"]'); page.wait_for_timeout(200)
    check("history, analytics and undo render with odd data", not errs, errs)
    ctx.close()

    # --- m5: confirm before replacing, settings opt-in, size cap ---
    ctx, page, errs = fresh(b)
    page.click('[data-action="char-rename"]'); page.fill("#appModalInput", "Mine"); page.click("#appModalOk")
    st = saved(page); cid = st["activeId"]
    other = json.loads(json.dumps(st))
    other["characters"][cid]["name"] = "Theirs"
    other["settings"]["theme"] = "parchment"
    import_file(page, other)
    page.wait_for_selector("#appModal[open]")
    check("replacing a same-id character asks first", "Mine" in page.text_content("#appModalMsg"))
    answer(page, False)
    page.wait_for_timeout(200)
    check("cancel keeps the local character", saved(page)["characters"][cid]["name"] == "Mine")
    import_file(page, other, "again.json")
    answer(page, True)                       # replace character
    page.wait_for_selector("#appModal[open]")
    check("settings are a separate question", "settings" in page.text_content("#appModalMsg").lower())
    answer(page, False)                      # keep my settings
    page.wait_for_timeout(200)
    st2 = saved(page)
    check("character replaced after OK", st2["characters"][cid]["name"] == "Theirs")
    check("settings kept when declined", st2["settings"]["theme"] != "parchment")
    page.evaluate("""() => { const f = new File([new Uint8Array(10 * 1024 * 1024 + 10)], 'big.json', { type: 'application/json' });
        const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('importFile'); i.files = dt.files;
        i.dispatchEvent(new Event('change', { bubbles: true })); }""")
    page.wait_for_timeout(200)
    check("files over 10 MB are refused", "too large" in page.text_content("#toast"))
    check("no JS errors (import confirms)", not errs, errs)
    ctx.close()

    # --- p3 / m3: clock jumps ---
    ctx = b.new_context(); page = ctx.new_page(); errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.clock.install(time=1_800_000_000_000)
    page.goto(URL); page.evaluate("localStorage.clear()"); page.reload()
    page.keyboard.press("Space"); page.clock.run_for(30_000)
    page.clock.set_system_time(1_800_000_000_000 - 3_600_000)   # clock jumps back an hour
    page.clock.run_for(2_000)
    t = page.text_content('#now [data-timer^="zone:"]')
    check("timer never goes negative after a backwards jump", not t.startswith("-") and t >= "0:00:30", t)
    page.clock.run_for(10_000)
    t2 = page.text_content('#now [data-timer^="zone:"]')
    check("timer keeps counting after the jump", t2 > t, (t, t2))
    page.keyboard.press("Space")
    c = saved(page)["characters"][saved(page)["activeId"]]
    check("split after the jump stores a non-negative segment", all(v["elapsed"] >= 0 for v in c["timers"].values()))
    page.clock.set_system_time(1_800_000_000_000 + 86_400_000)  # and forward a day while the next zone runs
    page.clock.run_for(1_000)
    check("no JS errors (clock jumps)", not errs, errs)
    ctx.close()

    # --- p3: two tabs ---
    ctx = b.new_context()
    a = ctx.new_page(); a.goto(URL); a.evaluate("localStorage.clear()"); a.reload()
    bb = ctx.new_page(); bb.goto(URL)
    a.click('[data-action="char-rename"]'); a.fill("#appModalInput", "From tab A"); a.click("#appModalOk")
    bb.wait_for_timeout(300)
    check("tab B picks up tab A's change", "From tab A" in bb.text_content("#charSelect"))
    bb.evaluate("document.activeElement && document.activeElement.blur()")
    bb.keyboard.press("Space"); bb.wait_for_timeout(100); bb.keyboard.press("Space")
    a.wait_for_timeout(300)
    st = saved(a)
    c = st["characters"][st["activeId"]]
    check("tab B's split doesn't drop tab A's rename", c["name"] == "From tab A" and len(c["split"]) == 1, (c["name"], c["split"]))
    check("tab A shows tab B's split", "1/111 zones split" in a.text_content("#totals") or "1 /" in a.text_content("#totals"))
    ctx.close()
    b.close()

passed = sum(ok for _, ok in results)
print(f"\n{passed}/{len(results)} passed")
sys.exit(0 if passed == len(results) else 1)
