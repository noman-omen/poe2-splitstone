"""Classes: every playable 0.5.5 class and its ascendancies in the class selectors, and PoB2 import mapping
class and ascendancy names onto that list. Needs the app on TRACKER_URL (see tracker_url.py)."""
import base64
import sys
import zlib

from playwright.sync_api import sync_playwright
from tracker_url import TRACKER_URL

URL = TRACKER_URL
results = []

# Live patch 0.5.5, exact in-game spelling (PoB TreeData/0_5, poe2db).
ROSTER = {
    "Warrior": ["Titan", "Warbringer", "Smith of Kitava"],
    "Ranger": ["Deadeye", "Pathfinder"],
    "Huntress": ["Amazon", "Ritualist", "Spirit Walker"],
    "Witch": ["Infernalist", "Blood Mage", "Lich"],
    "Sorceress": ["Stormweaver", "Chronomancer", "Disciple of Varashta"],
    "Mercenary": ["Witchhunter", "Gemling Legionnaire", "Tactician"],
    "Monk": ["Invoker", "Acolyte of Chayula", "Martial Artist"],
    "Druid": ["Oracle", "Shaman"],
}
NOT_YET = ["Duelist", "Marauder", "Shadow", "Templar"]


def check(name, ok, info=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""))


def pob_code(cls, asc):
    xml = f'<PathOfBuilding2><Build className="{cls}" ascendClassName="{asc}" level="40" targetVersion="0_5"/></PathOfBuilding2>'
    return base64.urlsafe_b64encode(zlib.compress(xml.encode())).decode().rstrip("=")


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL); page.evaluate("localStorage.clear()"); page.reload(); page.wait_for_timeout(200)

    data = page.evaluate("() => CLASS_NOTES.classes.map(c => ({ id: c.id, name: c.name, asc: c.ascendancies }))")
    check("the data lists the 8 playable classes in roster order", [c["name"] for c in data] == list(ROSTER), [c["name"] for c in data])
    check("every class has its ascendancies, spelled as in game", all(c["asc"] == ROSTER[c["name"]] for c in data),
          [(c["name"], c["asc"]) for c in data if c["asc"] != ROSTER.get(c["name"])])
    check("22 ascendancies in all", sum(len(c["asc"]) for c in data) == 22)
    check("no unreleased classes", not any(c["name"] in NOT_YET for c in data))

    want = ["None"] + [c["name"] for c in data]
    route = page.eval_on_selector_all("#routeClass option", "e => e.map(o => o.textContent.trim())")
    check("route bar class selector lists every class in the data", route == want, route)
    page.click("#tab-character"); page.wait_for_timeout(150)
    char = page.eval_on_selector_all("#classSelect option", "e => e.map(o => o.textContent.trim())")
    check("Character class selector lists every class in the data", char == want, char)
    for c in data:
        page.select_option("#classSelect", c["id"]); page.wait_for_timeout(80)
        shown = page.text_content(".class-picker .class-asc") or ""
        check(f"{c['name']}: picking it shows its ascendancies", shown == "Ascendancies: " + ", ".join(c["asc"]), shown)
    stored = page.evaluate("() => { const s = Storage2.load(); return s.characters[s.activeId].classId; }")
    check("the pick is saved", stored == data[-1]["id"], stored)

    # PoB2 names onto the class list.
    cases = [(cls, asc, cls, asc) for cls, ascs in ROSTER.items() for asc in ascs]
    cases += [
        ("Witch", "Abyssal Lich", "Witch", "Lich"),       # hidden Lich variant
        ("", "Abyssal Lich", "Witch", "Lich"),
        ("Mercenary", "Witch Hunter", "Mercenary", "Witchhunter"),
        ("", "Smith of Kitava", "Warrior", "Smith of Kitava"),
        ("Druid", "", "Druid", ""),
        ("Huntress", "None", "Huntress", ""),
    ]
    got = page.evaluate("""cases => cases.map(([cn, asc]) => {
        const m = PoB.classFor({ className: cn, ascendancy: asc === 'None' ? '' : asc }, CLASS_NOTES.classes);
        return m ? [m.cls.name, m.ascendancy] : null; })""", [[c[0], c[1]] for c in cases])
    bad = [(c, g) for c, g in zip(cases, got) if g != [c[2], c[3]]]
    check(f"PoB class and ascendancy names map onto the list ({len(cases)} cases, Abyssal Lich as Lich)", not bad, bad)
    none = page.evaluate("() => [PoB.classFor({ className: 'Duelist', ascendancy: '' }, CLASS_NOTES.classes),"
                         " PoB.classFor({ className: 'Unknown', ascendancy: 'Gladiator' }, CLASS_NOTES.classes), PoB.classFor(null, [])]")
    check("an unknown or unreleased class maps to nothing", none == [None, None, None], none)

    # A real import fills an empty class picker, and never overrides a chosen one.
    page.select_option("#classSelect", ""); page.wait_for_timeout(80)
    page.fill("#pobCode", pob_code("Witch", "Abyssal Lich")); page.click('[data-action="pob-import"]'); page.wait_for_timeout(300)
    after = page.evaluate("() => { const s = Storage2.load(), c = s.characters[s.activeId]; return [c.classId, c.build && c.build.ascendancy]; }")
    check("PoB import with Abyssal Lich sets the class picker to Witch", after == ["witch", "Abyssal Lich"], after)
    page.click('[data-action="pob-clear"]'); page.wait_for_timeout(80)
    page.select_option("#classSelect", "ranger"); page.wait_for_timeout(80)
    page.fill("#pobCode", pob_code("Druid", "Shaman")); page.click('[data-action="pob-import"]'); page.wait_for_timeout(300)
    kept = page.evaluate("() => { const s = Storage2.load(); return s.characters[s.activeId].classId; }")
    check("a class you picked is kept when a build is imported", kept == "ranger", kept)

    check("no JS errors", not errs, errs)
    b.close()

passed = sum(ok for _, ok in results)
print(f"\n{passed}/{len(results)} passed")
sys.exit(0 if passed == len(results) else 1)
