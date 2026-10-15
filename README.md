# PoE2 Campaign Tracker

A static, offline-friendly web app for tracking a **Path of Exile 2** campaign run
(Acts 1–4 + Interludes, patch 0.5.5 / Forbidden Rites route data), with timers,
per-character saves and optional Path of Building 2 import.

![Screenshot](screenshots/milestone2.png)

## Features

- **Route checklist**: 111 steps grouped by act/interlude → zone, with objective, level,
  hints (layout / speed tips) and extra info (details, waypoints, skips, rewards, warnings).
- **Toggles**: *Hide hints* and *Hide extra info* (persisted).
- **Speedrun splits**: every zone is a timed segment. A sticky "now" bar shows the current
  zone, its open steps, the zone timer, run time and live delta vs PB. `Space` starts the run
  and splits (completes the zone, starts the next one); ticking the last required step of the
  zone you are timing splits automatically. Undo, pause/resume and new run are one key each.
- **Separate interludes**: the route plays Interlude 2 (part 1) → Interlude 3 → Interlude 2
  (part 2) → Interlude 1. Each part is its own section; Interlude 1/2/3 each get a total
  (Interlude 2 = both parts). Act, interlude-part and interlude totals are sums of their zones.
- **History and PBs per character**: finished runs and reset attempts are saved with every zone,
  section and group time. PB = fastest complete run. Best segments (golds) are kept per zone,
  section and interlude; sum of best is shown. Each zone shows its delta vs the PB segment.
- **Manual timers**: start/stop/reset per zone (only one zone runs at a time) and per endgame map.
- **Focus mode** (`F`): show only the current act/interlude and hide completed zones,
  handy on a second monitor. The phone layout keeps a compact sticky bar with the split button.
- **Characters**: one saved campaign per character; create, switch, rename, delete.
- **Persistence**: everything is saved in `localStorage` (`poe2-campaign-tracker:v1`).
- **Export / import** JSON. Import merges characters (same id overwrites) and rejects invalid files.
- **PoB2 import** (optional): paste an export code; it is decoded in the browser
  (base64url → zlib inflate via `DecompressionStream` → XML) and shows class, ascendancy,
  level, passives, item count, key stats and main skills with supports. Invalid codes show
  a clear error and do not change the saved state. Links (pobb.in etc.) are not fetched;
  paste the raw code.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` / `Enter` | Start run / split current zone |
| `U` / `Backspace` | Undo last split |
| `P` | Pause / resume |
| `R` | New run (unfinished run saved as an attempt) |
| `C` | Scroll to current zone |
| `F` | Focus mode |
| `H` / `E` | Hide hints / hide extra info |
| `?` / `Esc` | Help; `Esc` also leaves a text field |

Hotkeys only work while the tracker window has focus (browsers cannot read keys pressed in the game).

## Run

No build step is needed. Open `index.html` directly, or serve it:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
# → http://127.0.0.1:8765/
```

## Project layout

```
index.html            markup + script includes (plain scripts, works from file://)
css/styles.css        theme and layout
js/storage.js         state shape, localStorage, JSON export/import
js/timers.js          stopwatch helpers
js/run.js             speedrun logic: current zone, split/undo/pause, history, PB, bests
js/pob.js             PoB2 code decoder + summariser
js/app.js             rendering and event handling
data/campaign.js      generated route data (do not edit)
scripts/build_data.py regenerates data/campaign.js from route.json
tests/smoke_test.py   Playwright end-to-end test (fake clock; writes screenshots/milestone2.png)
```

## Updating route data

The route is taken from the earlier single-file guide (`/workspace/poe2/campaign/route.json`):

```sh
python3 scripts/build_data.py /path/to/route.json
```

## Tests

```sh
pip install playwright && python3 -m playwright install chromium
python3 -m http.server 8765 --bind 127.0.0.1 &
python3 tests/smoke_test.py
```

## Disclaimer

Fan-made project, not affiliated with or endorsed by Grinding Gear Games. Route data is
compiled from community sources (malura's speedrun route, Domistae, Exile-UI, Maxroll,
poe2db) and may be outdated.
