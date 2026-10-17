"""Stacie's 1.2.0 re-verify: first-run tip placement (F4), Parchment gold star contrast, two icon sizes.
Needs the app on TRACKER_URL (default http://127.0.0.1:8765/)."""
import os
import sys
from playwright.sync_api import sync_playwright
from shot_dir import shot_dir

URL = os.environ.get("TRACKER_URL", "http://127.0.0.1:8765/")
results = []


def check(name, ok, info=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""))


TIP_IN_VIEW = """() => {
  const t = document.querySelector('#firstRun .first-run');
  if (!t) return 'missing';
  if (t.closest('.sidebar')) return 'in sidebar';
  const r = t.getBoundingClientRect(), vh = innerHeight, now = document.querySelector('#now').getBoundingClientRect();
  if (r.top < now.bottom - 1) return 'under the now-bar ' + r.top + ' < ' + now.bottom;
  if (r.top > vh - 60) return 'below the fold ' + r.top;
  const hit = document.elementFromPoint(r.left + 20, r.top + 12);
  return hit && t.contains(hit) ? 'ok' : 'covered by ' + (hit && hit.className);
}"""


def lum(rgb):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


with sync_playwright() as p:
    b = p.chromium.launch()
    for label, kw in [("1280x720", {"viewport": {"width": 1280, "height": 720}}),
                      ("phone", {"viewport": {"width": 390, "height": 844}, "has_touch": True, "is_mobile": True})]:
        ctx = b.new_context(**kw)
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(URL); page.evaluate("localStorage.clear()"); page.reload(); page.wait_for_timeout(600)
        check(f"{label}: tip is in the main column, visible after load", page.evaluate(TIP_IN_VIEW) == "ok", page.evaluate(TIP_IN_VIEW))
        check(f"{label}: tip keeps its copy", "How a run works" in page.text_content("#firstRun")
              and "practise one zone" in page.text_content("#firstRun"))
        check(f"{label}: no tip left in the sidebar", page.locator("#history .first-run").count() == 0)
        page.screenshot(path=str(shot_dir() / f"first-run-{label}.png"))
        page.click('[data-action="tip-dismiss"]')
        check(f"{label}: Got it hides the tip", page.locator("#firstRun .first-run").count() == 0 and page.locator("#firstRun").is_hidden())
        page.reload(); page.wait_for_timeout(300)
        check(f"{label}: dismissed tip stays gone", page.locator("#firstRun .first-run").count() == 0)
        # Fresh again: the tip retires itself on the first split.
        page.evaluate("localStorage.clear()"); page.reload(); page.wait_for_timeout(300)
        page.evaluate("document.activeElement && document.activeElement.blur()")
        page.keyboard.press("Space"); page.wait_for_timeout(200)
        check(f"{label}: tip stays while the first zone runs", page.locator("#firstRun .first-run").count() == 1)
        page.keyboard.press("Space"); page.wait_for_timeout(200)
        check(f"{label}: tip goes after the first split", page.locator("#firstRun .first-run").count() == 0)
        check(f"{label}: no JS errors", not errs, errs)
        ctx.close()

    # Practice from the tip ends on "Practice complete"
    ctx = b.new_context(viewport={"width": 1280, "height": 720})
    page = ctx.new_page(); page.goto(URL); page.evaluate("localStorage.clear()"); page.reload(); page.wait_for_timeout(300)
    page.click('[data-action="tip-practice"]')
    for _ in range(3):
        try:
            page.wait_for_selector("#appModal[open]", timeout=800); page.click("#appModalOk"); page.wait_for_timeout(150)
        except Exception:
            break
    page.evaluate("document.activeElement && document.activeElement.blur()")
    page.keyboard.press("Space"); page.wait_for_timeout(1100); page.keyboard.press("Space"); page.wait_for_timeout(300)
    check("tip practice finishes on Practice complete", "Practice complete" in page.text_content("#now"), page.text_content("#now")[:120])
    check("tip gone after the first run", page.locator("#firstRun .first-run").count() == 0)

    # Two icon sizes only, in every view
    sizes = set()
    for view in ["campaign", "endgame", "tools"]:
        page.evaluate(f"document.querySelector('#tab-{view}')?.click()"); page.wait_for_timeout(200)
        sizes |= set(page.evaluate("[...document.querySelectorAll('svg.ico')].map(e => Math.round(e.getBoundingClientRect().width)).filter(Boolean)"))
    check("icons use two sizes (14 and 16px)", sizes <= {14, 16} and sizes, sorted(sizes))

    # Parchment gold star >= 3:1 on white
    page.evaluate("document.querySelector('#tab-campaign')?.click()")
    page.evaluate("document.documentElement.dataset.theme = 'parchment'; document.body.dataset.theme = 'parchment'")
    star = page.evaluate("""() => { const e = document.createElement('span'); e.className = 'gold'; e.textContent = '★';
      document.querySelector('#campaign').appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; }""")
    rgb = tuple(int(x) for x in star[star.index("(") + 1:star.index(")")].split(",")[:3])
    ratio = (1.05) / (lum(rgb) + 0.05)
    check("Parchment gold star is at least 3:1 on white", ratio >= 3, f"{star} {ratio:.2f}")
    ctx.close()
    b.close()

passed = sum(ok for _, ok in results)
print(f"\n{passed}/{len(results)} passed")
sys.exit(0 if passed == len(results) else 1)
