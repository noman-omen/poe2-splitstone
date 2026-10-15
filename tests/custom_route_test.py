#!/usr/bin/env python3
"""Custom shareable routes: hide/reorder/notes, SSR1 encode/decode, separate PB."""
import os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = os.environ.get("TRACKER_URL", "http://127.0.0.1:8765/")
ROOT = Path(__file__).resolve().parent.parent
SHOT = ROOT / "screenshots" / "custom-routes.png"
results = []

def check(name, cond, info=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{info}]" if info and not cond else ""))

def js(page, expr):
    return page.evaluate(expr)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 1000})
    page.add_init_script(
        "window.state_c = () => { const s = JSON.parse(localStorage.getItem('splitstone:v1'));"
        " return s.characters[s.activeId]; }")
    page.clock.install()
    page.goto(URL)
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_function("() => window.Run && window.CustomRoute && window.Storage2")
    page.evaluate("Storage2.save(Storage2.load())")
    page.wait_for_selector("#customRoute")

    n_full = js(page, "Run.order(state_c()).length")
    check("full campaign baseline", n_full > 40, n_full)

    # Unit: cleanNote strips URLs
    cleaned = js(page, "CustomRoute.cleanNote('see https://evil.example/x for tips')")
    check("cleanNote strips URLs", "[link removed]" in cleaned and "https://" not in cleaned, cleaned)

    # Create custom route via UI
    page.once("dialog", lambda d: d.accept("Skip Miller route"))
    page.click('[data-action="custom-new"]')
    page.wait_for_timeout(200)
    st = js(page, """() => {
      const c = state_c(), r = Run.route(c), cr = Run.getCustom(c, r.customId);
      return {
        customId: r.customId,
        name: cr && cr.name,
        hasOrder: !!(cr && cr.zoneOrder && cr.zoneOrder.length > 10),
        variant: Run.variantKey(r),
        body: document.body.classList.contains('custom-route'),
        pill: !!document.querySelector('.custom-pill'),
        editor: !!document.querySelector('.custom-editor'),
        n: Run.order(c).length,
      };
    }""")
    check("custom route created and selected", bool(st["customId"] and st["name"] == "Skip Miller route"), st)
    check("variant key includes +c:", bool(st["variant"] and "+c:" in st["variant"]), st)
    check("custom-route body + pill + editor", st["body"] and st["pill"] and st["editor"], st)
    check("zoneOrder seeded", st["hasOrder"], st)

    # Hide first step (act1-01) — should drop Clearfell intro zone if only step
    page.locator('[data-action="custom-hide-step"][data-id="act1-01"]').check()
    page.wait_for_timeout(150)
    hid = js(page, """() => {
      const c = state_c(), cr = Run.getCustom(c, Run.route(c).customId);
      const ids = Run.order(c).map(o => o.zone.id);
      return {
        hidden: !!(cr && cr.hiddenSteps['act1-01']),
        hasZ01: ids.includes('act1-z01'),
        n: ids.length,
        noteUrl: null,
      };
    }""")
    check("step hidden in customRoutes", hid["hidden"], hid)
    check("zone with only hidden step dropped from order", not hid["hasZ01"] and hid["n"] == n_full - 1, hid)

    # Add a note (with URL that must be stripped on save)
    page.fill('.cr-note-input[data-id="act1-02"]', "Rush Beira http://spam.test/x")
    page.locator('.cr-note-input[data-id="act1-02"]').dispatch_event("change")
    page.wait_for_timeout(100)
    note = js(page, """() => {
      const c = state_c(), cr = Run.getCustom(c, Run.route(c).customId);
      return cr && cr.notes['act1-02'];
    }""")
    check("note stored without URL", bool(note) and "http" not in note and "Rush Beira" in note, note)

    # Reorder: move first remaining zone down
    first_id = js(page, "Run.order(state_c())[0].zone.id")
    page.click(f'[data-action="custom-zone-down"][data-id="{first_id}"]')
    page.wait_for_timeout(100)
    order2 = js(page, "Run.order(state_c()).map(o => o.zone.id)")
    check("zone reorder applied", order2[0] != first_id and first_id in order2[:3], {"was": first_id, "now": order2[:3]})

    # Export / import round-trip
    code = js(page, """async () => {
      const c = state_c(), cr = Run.getCustom(c, Run.route(c).customId);
      return await CustomRoute.encode(cr);
    }""")
    check("SSR1 share code", isinstance(code, str) and code.startswith("SSR1.") and len(code) < 12000, str(code)[:40] if code else None)

    # Reject settings smuggling
    bad = js(page, """async () => {
      const payload = {
        v: 1, app: 'splitstone-route', name: 'Evil',
        baseMode: 'normal', hiddenSteps: [], zoneOrder: null,
        notes: {}, settings: { autoSplit: { enabled: true, url: 'http://evil' } },
        url: 'https://evil.example'
      };
      const json = JSON.stringify(payload);
      // Build a fake inflated-looking path: use encode of a normal route then...
      // Instead decode via normalise path by stuffing into encode of blank then mutating — 
      // CustomRoute.decode only accepts SSR1; craft via encode of blank and verify normalise drops junk.
      const cr = CustomRoute.normalise(Object.assign({}, payload, { id: 'crEviltest01' }));
      return { hasSettings: 'settings' in cr, hasUrl: 'url' in cr, name: cr.name };
    }""")
    check("import allowlist drops settings/url", bad["hasSettings"] is False and bad["hasUrl"] is False and bad["name"] == "Evil", bad)

    # Decode the real code into a new route
    roundtrip = page.evaluate("""async (code) => {
      const decoded = await CustomRoute.decode(code);
      return {
        name: decoded.name,
        hidden: !!decoded.hiddenSteps['act1-01'],
        note: decoded.notes['act1-02'] || '',
      };
    }""", code)
    check("decode restores hide + note", roundtrip["hidden"] and "Rush Beira" in roundtrip["note"] and "http" not in roundtrip["note"], roundtrip)

    # Separate PB: finish a short custom run (hide almost everything — practice one zone is easier)
    # Switch to practice zone under custom for a quick finish
    page.select_option("#practiceScope", "zone:act1-z02")
    page.wait_for_timeout(100)
    page.keyboard.press("Space")
    page.clock.run_for(3000)
    page.keyboard.press("Space")
    page.wait_for_timeout(150)
    pb = js(page, """() => {
      const c = state_c();
      const h0 = c.history[0];
      const customPb = Run.pb(c);
      const fullPb = Run.pb(c, 'normal');
      return {
        variant: h0 && h0.variant,
        customId: h0 && h0.customId,
        complete: h0 && h0.complete,
        customPb: !!(customPb && customPb.complete),
        fullPb,
      };
    }""")
    check("history tagged custom variant", bool(pb["variant"] and "+c:" in pb["variant"] and "+p:" in pb["variant"]), pb)
    check("custom PB set; full-campaign PB null", pb["customPb"] and pb["fullPb"] is None, pb)

    # Exit practice then clear custom
    page.select_option("#practiceScope", "")
    page.wait_for_timeout(100)
    page.click('[data-action="custom-clear"]')
    page.wait_for_timeout(100)
    left = js(page, """() => {
      const c = state_c();
      return { customId: Run.route(c).customId, body: document.body.classList.contains('custom-route'), n: Run.order(c).length };
    }""")
    check("cleared to default route", left["customId"] is None and not left["body"] and left["n"] == n_full, left)

    # Re-select and screenshot with editor open
    page.select_option("#customRoute", label="Skip Miller route")
    page.wait_for_timeout(150)
    page.evaluate("document.querySelector('.custom-editor') && (document.querySelector('.custom-editor').open = true)")
    page.locator(".route-bar").scroll_into_view_if_needed()
    page.screenshot(path=str(SHOT), full_page=False)
    print("wrote", SHOT, SHOT.stat().st_size)
    b.close()

failed = [n for n, ok in results if not ok]
print(f"{sum(1 for _, ok in results if ok)}/{len(results)} passed")
sys.exit(1 if failed else 0)
