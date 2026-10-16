# Splitstone

I built **Splitstone** because I wanted one place to run the Path of Exile 2 campaign: a clear route, a real speedrun timer, and enough history to know where I am losing time — without juggling a wiki tab, a stopwatch, and a spreadsheet.

**Splitstone** is a static, offline-friendly web app: a PoE2 campaign **speedrun tracker and leveling guide** for Acts 1–4 plus the Interludes (currently patch **0.5.5 / Forbidden Rites**). Open it in a browser, pick a character, hit Space, and play.

My goal is to make Splitstone the one-stop-shop tool for the PoE2 campaign, and to grow it into endgame tracking after 1.0.

![Splitstone](screenshots/splitstone.png)

---

## What it does

| | |
| --- | --- |
| **Current step bar** | Big zone name, current objective, tips, next step/zone — readable from a second monitor |
| **Splits & timers** | Per-zone segments; act and interlude totals; pause, undo, auto-advance |
| **Route guide** | Normal clear or fast/speedrun route, optional “required steps only” |
| **History & PBs** | Per-character runs, personal bests, gold segments, live delta vs PB |
| **Auto-split** | Optional helper that tails PoE2 `Client.txt` and splits on zone changes |
| **PoB2 import** | Paste a Path of Building 2 code into the character panel |
| **Themes** | Ember (default), Slate, Crimson, Parchment |
| **In-game overlay** | Small top-right always-on-top panel from the Windows helper |
| **Class notes** | Basic-class gem & reward tips (Warrior … Witch) |

### Now bar (in-game glance)

![Now bar](screenshots/milestone3-nowbar.png)

### Run analytics, maps, hotkeys

| Run analytics | Endgame maps | Hotkeys |
| --- | --- | --- |
| ![Stats](screenshots/milestone3-stats.png) | ![Maps](screenshots/milestone3-maps.png) | ![Hotkeys](screenshots/milestone3-hotkeys.png) |

### Colour themes

| Ember (default) | Slate |
| --- | --- |
| ![Ember](screenshots/theme-ember.png) | ![Slate](screenshots/theme-slate.png) |
| **Crimson** | **Parchment** |
| ![Crimson](screenshots/theme-crimson.png) | ![Parchment](screenshots/theme-parchment.png) |

### In-game overlay (top-right corner)

A browser tab cannot sit on top of fullscreen PoE2. The desktop app (and optional Python helper) show a **minimal** always-on-top panel: **current step**, optional hint, and **next step** only — no timer or Δ. Default ~80% opacity (slider in Settings), click-through on by default (`Ctrl+Alt+O` / tray to unlock and drag). Position is remembered per display.

![Overlay](screenshots/overlay-minimal.png)

---


## Download

**[Download Splitstone for Windows](https://github.com/noman-omen/poe2-splitstone/releases/latest)**

1. Under **Assets**, download **Splitstone-Setup-1.0.0.exe** (installer, recommended) or **Splitstone-Portable-1.0.0.exe**. Ignore the `.yml` and `.blockmap` files.
2. Run it (Windows 10/11 x64). Uninstall from Add/Remove Programs.
3. Builds are **not code-signed**, so SmartScreen may say "Windows protected your PC". Click **More info**, then **Run anyway**.
4. Splitstone finds Path of Exile 2's `Client.txt` automatically. If it can't, click **Client.txt…** and pick it (Steam folder → `Path of Exile 2` → `logs` → `Client.txt`). Only that file, or one in a known PoE2 folder, is read.
5. Play in **Windowed Fullscreen** so the overlay can sit on top.

Global hotkeys (change them under Settings → Global hotkeys in the desktop app; bare keys are never grabbed from the game):

| Keys | Action |
| --- | --- |
| `Ctrl+Alt+S` | Split |
| `Ctrl+Alt+Z` | Undo |
| `Ctrl+Alt+P` | Pause / resume |
| `Ctrl+Alt+R` | New run (press twice within 3 s) |
| `Ctrl+Alt+H` | Show / hide hints |
| `Ctrl+Alt+O` | Lock / unlock the overlay (unlocked = drag to move) |

Auto-update is on by default (Settings → Desktop to turn off). Full releases only get full releases; prerelease builds also see prereleases. A build that crashes on launch can't update itself, so reinstall from the link above.

---

## Features

- **Campaign checklist** — 111 steps grouped by act / interlude → zone (patch 0.5.5 route data), with objectives, levels, hints, rewards, waypoints, and skips.
- **Speedrun splits** — Space starts and splits; ticking the last required step of a timed zone also advances. Undo, pause/resume, and new run are one key each.
- **Separate interludes** — Interlude 2 (parts 1 & 2), 3, and 1 each have their own timers; Interlude 2’s total is both parts combined.
- **Route variants** — *Normal clear* or *Fastest (speedrun)* from the original guide data; *Required steps only* hides optionals. PBs and bests are tracked per variant.
- **History & analytics** — Completed and abandoned runs, PB, gold segments, sum of best, SVG trend charts, per-act “avg − best,” CSV export. Filter history/charts by All / Campaign / Practice (default Campaign).
- **Map history** — Timed map runs with per-map PB / average and CSV export (separate from the campaign run).
- **Characters** — Create, switch, rename, delete; one saved campaign per character.
- **Persistence** — `localStorage` (`splitstone:v1`; older `poe2-campaign-tracker:v1` saves migrate automatically). JSON export / import.
- **Practice mode** — Run a single act, interlude, or zone. Splits, auto-split, and PB/bests are scoped to that practice variant and never overwrite the full-campaign PB. Exit anytime from the route bar or now bar.
- **Gear / gem checkpoints** — Glanceable cues for vendor checks, weapon crafts (e.g. lvl 16), Uncut skill/support/Spirit gems, and class-specific swaps (six basic classes). Act 4 (weapon pieces, tattoos, Kaimana) and the Interludes (Spirit, Boons, passives) are covered. Uncertain notes are dashed. Hidden with **Hide hints** / **Hide extra info**.
- **Level / XP warnings** — Per-zone recommended / area level from the route; warns when your character level (manual field or PoB) is under-leveled or near the XP-penalty window (`±(3 + ⌊level/16⌋)`, Malura 0.5.x). Glanceable in the zone list + now bar; hidden with **Hide extra info**.
- **Auto-split from Client.txt** — Optional local helper (SSE) or Chrome/Edge File System Access. Hideouts, re-entries, and backtracking are ignored.
- **Rebindable hotkeys** — Settings panel with conflict detection; bindings export with the save.
- **PoB2 import** — Decode a build code in-browser (base64url + zlib → XML); bad codes fail gracefully.
- **Themes** — Ember, Slate, Crimson, Parchment (global preference, in settings and export).
- **Class-aware notes** — Pick a basic class per character for campaign gem cuts and reward callouts (not ascendancy-specific yet). Tips hide with *Hide hints*.
- **In-game overlay** — The desktop app (or the Python helper with `--overlay`) shows the current step, its hint and the next step in a small top-right panel. The browser alone cannot draw over fullscreen games.
- **Focus mode & phone layout** — Second-monitor focus; compact sticky bar on small screens.

---

### Class notes (basic classes)

Skills are **not** class-locked in PoE2 — Uncut gems just highlight class-recommended options. The class picker (Warrior, Sorceress, Ranger, Monk, Mercenary, Witch, or None) adds inline tips on relevant steps and a **Recommended for [Class]** chip when a campaign reward choice matters. Ascendancy layers come later.

![Class notes](screenshots/class-notes.png)

![Level / XP warnings](screenshots/level-xp-warnings.png)

![Gear / gem checkpoints](screenshots/gear-gem-checkpoints.png)

![Practice mode](screenshots/practice-mode.png)

![Custom shareable routes](screenshots/custom-routes.png)

## Vision

I want Splitstone to be the tool I actually leave open for the whole league launch: campaign route, timer, and feedback in one window. Campaign is the foundation. After that I want endgame — maps, atlas-style progress, and the same split discipline applied outside the story.

---

## Roadmap

**Stated goal:** have Splitstone available and updated for **PoE2 1.0 by the end of the first week after the 1.0 release** (“1.0 release week” — I am not inventing a calendar date).

| Phase | Focus |
| --- | --- |
| **Current (0.5.x)** | Campaign tracker as it stands: acts, interludes, splits, auto-split helper, themes, in-game overlay |
| **Pre-1.0 hardening** | Polish, test coverage, helper robustness, docs, and anything that would break under a full data refresh |
| **1.0 launch week** | Refresh route data for 1.0 acts and zones, area IDs, and verification against the live game |
| **Post-1.0 endgame** | Atlas / map tracking and the endgame items below |

### Priority #1 — Always-on-top in-game overlay

A browser tab cannot draw over a fullscreen game. I am shipping a **small top-right corner panel** in the Windows helper: always-on-top, low distraction, current zone + current step + tip + next + timer, with opacity and click-through toggles. The browser stays the source of truth and pushes state to the helper over localhost.

### Campaign intelligence

- **Class-aware notes** for the basic classes first (Warrior, Sorceress, Ranger, Monk, Mercenary, Witch) — not subclass-specific yet: class-flavoured campaign steps and recommended campaign reward choices by class
- Level / XP warnings per zone (shipped: route bands + Malura XP window)
- Gear and gem checkpoints along the route
- Build-specific route notes later (Monk / Oracle ascendancy layers)
- Custom shareable routes
- Ghost / race mode (run against a ghost PB)
- Single-act practice mode

### Endgame (post-1.0)

- Atlas progress tracking
- Profit-per-hour style session stats
- Pinnacle boss logs
- League / atlas checklists
- Season / league history
- Leaderboards / shared PBs

### Ecosystem

Buttons or tabs that deep-link or embed popular PoE2 tools (currency / market sites, crafting helpers, and similar). I will research and pick concrete URLs before wiring them — listed here as a goal, not as invented links.

---

## Quick start

No build step. Either open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
# → http://127.0.0.1:8765/
```

### Auto-split + in-game overlay on Windows

A normal browser window **cannot** draw over fullscreen PoE2. Use the helper for auto-split and the overlay.

1. Install Python 3 from python.org (tick *Add to PATH*), or `winget install Python.Python.3.12`.
2. Copy the `helper` folder to the gaming PC.
3. Double-click `run_helper.bat` (starts with `--overlay`), or:

   ```bat
   py helper\splitstone_helper.py --overlay
   py helper\splitstone_helper.py --overlay --log "D:\SteamLibrary\steamapps\common\Path of Exile 2\logs\Client.txt"
   ```

   Defaults it looks for:

   - Steam: `C:\Program Files (x86)\Steam\steamapps\common\Path of Exile 2\logs\Client.txt`
   - Standalone: `C:\Program Files (x86)\Grinding Gear Games\Path of Exile 2\logs\Client.txt`

4. Open Splitstone on the same PC and enable **Auto-split** (that connection also pushes the current step to the overlay).
5. The panel sits in the **top-right**. Drag the SPLITSTONE title to move it. Use the opacity slider and **Click-through** (Windows) so mouse clicks pass through to the game.
6. Optional global hotkeys (work while the game has focus): `py -m pip install pynput`, then  
   `py helper\splitstone_helper.py --overlay --hotkeys` (F1 split, F2 undo, F3 pause).

Overlay buttons publish the same hotkey actions over the helper’s event stream, so Split / Pause / Undo work without focusing the browser.

**Helper security (local only):** the helper binds `127.0.0.1` only. CORS reflects an Origin allowlist (`http://127.0.0.1`, `http://localhost`, `http://[::1]`, and `null` for `file://`). Optional `--token` / `$SPLITSTONE_TOKEN`: paste the same token under **Auto-split settings**. Fetch uses the `X-Splitstone-Token` header only; EventSource cannot set headers, so SSE uses `?token=` only. `GET /status` stays open and reports `auth: true|false`; with a token set it omits the log path. JSON exports never include the token. Helper URLs must not include `?query` or `#hash`. Import never auto-connects.


---

## Project layout

```
index.html            app shell
css/styles.css        themes + layout
js/                   storage, timers, run logic, charts, auto-split, PoB, UI
data/campaign.js      generated route data
scripts/build_data.py regenerate data from route.json
helper/               splitstone_helper.py (Client.txt → SSE)
assets/               logo.svg, favicon.svg
tests/                Playwright + helper unit tests
screenshots/          README images
```

Update route data from the upstream guide JSON:

```sh
python3 scripts/build_data.py /path/to/route.json
```

---

## Tests

```sh
pip install playwright && python3 -m playwright install chromium
python3 -m http.server 8765 --bind 127.0.0.1 &
python3 tests/smoke_test.py
python3 tests/autosplit_test.py
python3 helper/test_helper.py
python3 helper/test_overlay_state.py
python3 tests/overlay_shot.py      # regenerate screenshots/overlay-corner.png
```

---

## Contributing

Issues and pull requests are welcome. For route or area-ID fixes, say which patch you checked against. Keep the app static (no required build step) unless there is a strong reason not to.

---

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 Splitstone contributors.

---

## Disclaimer

This is a fan-made project. It is **not affiliated with or endorsed by Grinding Gear Games**. Path of Exile is a trademark of Grinding Gear Games. Route information is compiled from community sources, may be outdated, and is provided as-is. Use at your own risk.

---

## Develop (web + desktop)

For contributors. Players: use **Download** above.

**Web (browser):** serve the repo root over HTTP (any static server), open `index.html`. Optional: run `helper/splitstone_helper.py` for auto-split + overlay while using a browser.

**Desktop (Electron):** see [desktop/README.md](desktop/README.md) — `cd desktop && npm install && npm start`. Release builds: push a `v*` tag; GitHub Actions attaches the Windows installer to the Release.

The Python helper remains a legacy/optional fallback for browser-only setups.
