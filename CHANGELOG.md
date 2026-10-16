# Changelog

## 1.1.0 (unreleased)

- New Endgame tab: log map runs with tier, waystone mods, deaths, notes and loot; start, pause and finish each map; mark runs completed or failed.
- Sessions with maps per hour, average map time, totals and a history of past sessions. Maps CSV export.
- Atlas progress checklist for patch 0.5.5 (Fortress, pinnacle bosses, atlas masters, atlas points). Items not yet confirmed in patch notes or poe2db are marked.
- Desktop: optional auto-detect of map runs from Client.txt.
- New Tools tab with links to the trade site, poe2db, the PoE2 wiki, Path of Building 2, poe.ninja, Craft of Exile and Maxroll.
- Saves move to schema 2. Map timers from 1.0 are migrated to endgame runs, and the old save is kept as a backup.

## 1.0.0 (2026-10-16)

First full release of the desktop app.

- Global hotkeys use Ctrl+Alt combos (split, undo, pause, new run, hints, overlay lock) and can be changed in settings. Bare keys are never taken from the game.
- The overlay shows only the current step, its hint and the next step. It is click-through by default, can be unlocked and dragged, remembers its spot per display, and has an opacity slider (80% by default).
- Confirmations use in-app dialogs instead of browser pop-ups.
- Larger touch targets and a smaller now bar on phones and short screens.
- Security: the app only loads its own pages, only reads Client.txt from a known PoE2 folder or the file you picked, and exports no longer include the helper token. The helper hides the log path from /status when a token is set.
- Fixed a crash on launch in 0.6.x.
- Auto-update only offers prereleases to prerelease builds.
- Builds are not code-signed, so Windows SmartScreen may warn on first run.
