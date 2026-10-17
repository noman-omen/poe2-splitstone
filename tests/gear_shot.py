#!/usr/bin/env python3
"""Tests + screenshot for gear / gem checkpoints."""
import os, sys
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
from shot_dir import shot_dir  # noqa: E402
from tracker_url import TRACKER_URL

URL = TRACKER_URL
ROOT = Path(__file__).resolve().parent.parent
SHOT = shot_dir() / "gear-gem-checkpoints.png"
results = []

def check(name, cond, info=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{info}]" if info and not cond else ""))

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 1000})
    page.add_init_script("window.state_c = () => { const s = JSON.parse(localStorage.getItem('splitstone:v1')); return s.characters[s.activeId]; }")
    page.goto(URL)
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_function("() => window.Gear && window.GEAR_CHECKPOINTS && window.Run")

    meta = page.evaluate("""() => {
      const g = GEAR_CHECKPOINTS;
      const sharedKeys = Object.keys(g.shared || {});
      const classes = Object.keys(g.byClass || {});
      const renly = Gear.forStep(null, 'act1-02');
      const monk = Gear.forStep('monk', 'act1-02');
      const zone = Run.ALL.find(o => o.zone.id === 'act1-z02').zone;
      const zcues = Gear.forZone('mercenary', zone);
      return {
        patch: g.meta && g.meta.patch,
        sharedN: sharedKeys.length,
        classN: classes.length,
        renlyHasGem: renly.some(x => x.kind === 'gem'),
        monkHasCascade: monk.some(x => /Cascade|Rolling|grenade|Frost|bow|Contagion|Spark/i.test(x.short+x.text)),
        mercCrossbowLater: Gear.forStep('mercenary', 'act2-01').some(x => /crossbow/i.test(x.short+x.text)),
        lvl16: Gear.forStep(null, 'act2-03').some(x => x.kind === 'craft'),
        zoneCues: zcues.length,
        uncertainOk: monk.some(x => true),
      };
    }""")
    check("meta patch 0.5.x", str(meta.get("patch","")).startswith("0.5"), meta)
    check("shared checkpoints present", meta["sharedN"] >= 10, meta)
    check("six classes overlaid", meta["classN"] == 6, meta)
    check("Renly step has gem cue", meta["renlyHasGem"], meta)
    check("Monk Renly is class-specific", meta["monkHasCascade"], meta)
    check("Merc Act2 crossbow cue", meta["mercCrossbowLater"], meta)

    a4 = page.evaluate( """() => {
      const g = GEAR_CHECKPOINTS.shared;
      const pieces = ['act4-03','act4-07','act4-08'].filter(id => (g[id]||[]).some(x => /piece/i.test(x.short+x.text)));
      const spirit = (g['act4-11']||[]).some(x => x.kind==='spirit');
      const intlSpirit = (g['interludes-07']||[]).some(x => x.kind==='spirit');
      const boon = (g['interludes-15']||[]).some(x => /Boon|Qimah/i.test(x.short));
      return { pieces: pieces.length, spirit, intlSpirit, boon, nAct4: Object.keys(g).filter(k=>k.startsWith('act4-')).length };
    }""")
    check("Act4 weapon piece cues (3 bosses)", a4["pieces"] >= 3, a4)
    check("Act4 Hinekora spirit cue", a4["spirit"], a4)
    check("Interlude Lythara spirit cue", a4["intlSpirit"], a4)
    check("Interlude Qimah Boon cue", a4["boon"], a4)
    check("Act4 shared cues expanded", a4["nAct4"] >= 12, a4)

    check("Lvl 16 craft checkpoint", meta["lvl16"], meta)
    check("zone aggregates cues", meta["zoneCues"] >= 1, meta)

    # UI: pick monk → see Hollow Palm / Cascade cues
    page.select_option("#classSelect", "monk")
    page.wait_for_timeout(150)
    ui = page.evaluate("""() => {
      const z02 = document.querySelector('[data-zone="act1-z02"] .gear-cues');
      const z18 = document.querySelector('[data-zone="act1-z18"] .gear-cues');
      const now = document.querySelector('#now .now-gear, #now .gear-cues');
      return {
        z02: z02 && z02.textContent,
        z18: z18 && z18.textContent,
        now: now && now.textContent,
        cueCount: document.querySelectorAll('.zone .gear-cue').length,
      };
    }""")
    check("zone list shows gear cues", ui["cueCount"] >= 3, ui)
    check("Clearfell Renly cue visible", ui["z02"] and ("gem" in ui["z02"].lower() or "◆" in ui["z02"] or "💎" in ui["z02"] or "Cascade" in ui["z02"] or "skill" in ui["z02"].lower()), ui)
    check("now bar gear cues", bool(ui["now"]) and ("weapon" in ui["now"].lower() or "⚔" in ui["now"] or "Starter" in ui["now"]), ui)

    page.check("#hideHints")
    check("hide-hints hides gear cues", page.locator(".zone .gear-cue").count() == 0 or not page.locator(".zone .gear-cues").first.is_visible())
    page.uncheck("#hideHints")

    page.locator('[data-zone="act1-z02"]').scroll_into_view_if_needed()
    page.screenshot(path=str(SHOT), full_page=False)
    print("wrote", SHOT, SHOT.stat().st_size)
    b.close()

failed = [n for n, ok in results if not ok]
print(f"{sum(ok for _, ok in results)}/{len(results)} passed")
sys.exit(1 if failed else 0)
