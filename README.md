# Splitstone

I built Splitstone because I wanted one place to run the Path of Exile 2 campaign: a clear route, a real speedrun timer, and enough history to see where I lose time, without juggling a wiki tab, a stopwatch and a spreadsheet.

It's a campaign speedrun tracker and leveling guide for Acts 1–4 plus the Interludes (route data for patch 0.5.5). Use it in a browser, or install the desktop app for auto-split, global hotkeys and an in-game overlay.

![Splitstone](screenshots/splitstone.png)

---

## What it does

| | |
| --- | --- |
| **Now bar** | Zone, current objective, hints and next step, readable from a second monitor |
| **Splits and timers** | Per-zone segments, act and interlude totals, pause, undo, auto-advance |
| **Routes** | Normal or speedrun route, required-steps-only, practice a single act or zone, custom shareable routes |
| **History and PBs** | Per-character runs, PBs, gold segments, live delta, trend charts, CSV export |
| **Auto-split** | Splits on zone changes from PoE2's `Client.txt` |
| **Cues** | Basic-class notes, level/XP warnings, gear and gem checkpoints |
| **Overlay** | Small top-right panel with the current step, hint and next step |
| **PoB2 import, themes** | Paste a Path of Building 2 code; Ember, Slate, Crimson, Parchment |

![Now bar](screenshots/milestone3-nowbar.png)

| Run analytics | Maps | Hotkeys |
| --- | --- | --- |
| ![Stats](screenshots/milestone3-stats.png) | ![Maps](screenshots/milestone3-maps.png) | ![Hotkeys](screenshots/milestone3-hotkeys.png) |

### In-game overlay

A browser tab can't sit on top of a fullscreen game, so the desktop app draws a small always-on-top panel: current step, hint and next step, nothing else. It's 80% opaque by default (slider in Settings), click-through until you unlock it with `Ctrl+Alt+O` or the tray, and it remembers its position per monitor.

![Overlay](screenshots/overlay-minimal.png)

### Cues and routes

| Class notes | Level / XP warnings |
| --- | --- |
| ![Class notes](screenshots/class-notes.png) | ![Level / XP warnings](screenshots/level-xp-warnings.png) |
| **Gear / gem checkpoints** | **Practice mode** |
| ![Gear / gem checkpoints](screenshots/gear-gem-checkpoints.png) | ![Practice mode](screenshots/practice-mode.png) |

![Custom shareable routes](screenshots/custom-routes.png)

Themes: Ember, Slate, Crimson and Parchment.

| | |
| --- | --- |
| ![Ember](screenshots/theme-ember.png) | ![Slate](screenshots/theme-slate.png) |
| ![Crimson](screenshots/theme-crimson.png) | ![Parchment](screenshots/theme-parchment.png) |

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
| ---

## Roadmap

My goal is to have Splitstone updated for PoE2 1.0 within the first week after it launches: route data, area IDs and zone names checked against the live game.

**Shipped in 1.0.0:** desktop app with auto-split and auto-update, minimal overlay, Ctrl+Alt global hotkeys, class notes, level/XP warnings, gear and gem checkpoints, custom shareable routes, practice mode.

**Next:**

- Endgame tracking: map runs, session stats, atlas progress
- A tools tab with links to the community tools I use
- Ghost / race mode against your PB

**Later:** ascendancy-specific route notes, pinnacle boss logs, league history, shared PBs.

See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.

---

## Run from source

No build step. Serve the folder and open it:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
# http://127.0.0.1:8765/
```

Desktop app: `cd desktop && npm install && npm start` (see [desktop/README.md](desktop/README.md)). Pushing a `v*` tag builds the Windows installer on GitHub Actions.

### Python helper (browser-only setups)

If you'd rather use the browser than the desktop app, `helper/splitstone_helper.py` tails `Client.txt` for auto-split and can show the same overlay:

```bat
py helper\splitstone_helper.py --overlay
py helper\splitstone_helper.py --overlay --log "D:\SteamLibrary\steamapps\common\Path of Exile 2\logs\Client.txt"
```

Then enable **Auto-split** in Splitstone on the same PC.

**Helper security (local only):** the helper binds `127.0.0.1` only. CORS reflects an Origin allowlist (`http://127.0.0.1`, `http://localhost`, `http://[::1]`, and `null` for `file://`). Optional `--token` / `$SPLITSTONE_TOKEN`: paste the same token under **Auto-split settings**. Fetch uses the `X-Splitstone-Token` header only; EventSource cannot set headers, so SSE uses `?token=` only. `GET /status` stays open and reports `auth: true|false`; with a token set it omits the log path. JSON exports never include the token. Helper URLs must not include `?query` or `#hash`. Import never auto-connects.

---

## Project layout

```
index.html            app shell
css/styles.css        themes and layout
js/                   storage, timers, run logic, charts, auto-split, PoB, UI
data/                 route, class notes, gear checkpoints
scripts/build_data.py regenerate data/campaign.js from route.json
desktop/              Electron app
helper/               Python helper (Client.txt to SSE, optional overlay)
tests/                Playwright and unit tests
screenshots/          README images
```

---

## Tests

```sh
pip install playwright && python3 -m playwright install chromium
python3 -m http.server 8765 --bind 127.0.0.1 &
python3 tests/smoke_test.py
python3 tests/security_test.py
python3 tests/autosplit_test.py
python3 helper/test_helper.py
(cd desktop && npm test)
```

Tests write screenshots to `test-output/`. Run with `SPLITSTONE_UPDATE_SHOTS=1` to refresh the images in `screenshots/`.

---

## Contributing

Issues and pull requests are welcome. For route or area-ID fixes, say which patch you checked against. Keep the web app static, with no required build step.

## License

MIT, see [LICENSE](LICENSE).

## Disclaimer

Fan-made and not affiliated with or endorsed by Grinding Gear Games. Path of Exile is a trademark of Grinding Gear Games. Route information comes from community sources and may be out of date.
