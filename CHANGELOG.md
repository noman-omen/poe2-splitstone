# Changelog

## 1.2.0 (2026-10-17)

- Ghost race (Settings → Ghost race, off by default). Race the current run against your PB, your best segments, any saved run of the character, or a ghost imported from someone else's share code (`SSG1.…`) or Splitstone export file.
- Ahead/behind delta per split and in total, colour-coded, and a line under the run timer showing which zone the ghost would be in right now.
- Time gained or lost per act and interlude, including the one in progress.
- Copy any comparison as a ghost code to share it. Up to 10 imported ghosts per character, saved locally and included in JSON export and import.
- Imported ghosts keep only zone times for zones Splitstone knows, with capped names and sizes (16 KB codes, 64 KB once expanded, 5 MB export files). Names are escaped wherever they're shown.
- The ghost panel hides in Focus mode; the one-line summary under the timer stays.
- No storage migration: 1.1 saves load as they are and pick up the new fields on the next save.
- The ghost line under the timer is larger, with the zone in bold. Racing your PB it shows only where the ghost is, since the delta is already beside the timer. The ghost line, the ghost panel total and the act and interlude summaries also say "ahead" or "behind" in words, so they don't rely on red and green.
- After your first PB, a one-time note points to the ghost race in Settings.
- First run: a "How a run works" card under the timer explains starting, splitting and the PB, with a button to try a one-zone practice. It shows for a new character until you dismiss it, split your first zone or finish a run. Until the character has a finished run, a one-line "No PB yet" hint under the timer links to a one-zone practice. Help has the same "How a run works" section with a Practice button. Practice runs end on "Practice complete", and run history switches to the matching filter after a run.
- Desktop overlay: the default spot is left of the PoE2 minimap instead of on top of it, with a one-time hint on how to move it. New overlay text size option (Small, Medium, Large).
- Accessibility: every theme meets WCAG AA contrast (Parchment and Ember were below it), a "Skip to timer" link, labelled dropdowns, and no animation or smooth scrolling when the system asks for reduced motion.
- Settings and Help: consistent headings, and the dialogs are centred with the page dimmed behind them. Reset hotkeys to defaults now asks first.
- Emoji icons replaced with one inline SVG icon set.
- Less clutter on desktop: per-zone timer and practice buttons show on hover, on focus or for the current zone, and at 1366px wide or less the header's toggles and import/export sit behind the ⋯ menu.
- Imports and saves are checked field by field. PoB build summaries are rebuilt from known fields and escaped, malformed history entries are skipped, undo history isn't imported, and character and ghost names lose invisible and direction-control characters. Paused timers must be known zones, and prototype keys like `__proto__` can't be used as character ids or reach any id-keyed map.
- Import asks before replacing a character that already exists here or applying the file's settings, and refuses files over 10 MB.
- Timers never go negative. If the system clock jumps backwards, running timers keep the time already counted.
- A ghost code whose total doesn't match its zone times is rejected.
- 1.0 saves with a map in progress keep that map's timer when migrated.
- Desktop: Electron 44 and electron-builder 26. npm audit has no critical or high findings.
- Releases: a Linux AppImage and a `SHA256SUMS` file alongside the Windows builds. The release workflow builds with read-only access and creates a draft release, which I publish after checking the assets. Publishing waits for approval on a protected `release` environment that only accepts `v*` tags, and builds take their timestamps from the tag commit.
- Removed dead code. The PB always comes from run history; saves no longer store a separate best total. Added an ESLint config (`npm run lint`).

## 1.1.0 (2026-10-16)

- New Endgame tab: log map runs with tier, waystone mods, deaths, notes and loot; start, pause and finish each map; mark runs completed or failed.
- Sessions with maps per hour, average map time, totals and a history of past sessions. Maps CSV export.
- Atlas progress checklist for patch 0.5.5 (Fortress, pinnacle bosses, atlas masters, atlas points). Items not yet confirmed in patch notes or poe2db are marked.
- Desktop: optional auto-detect that starts and finishes map runs from the zone changes the app already reads for auto-split. No new Client.txt parsing.
- New Tools tab with links to the trade site, poe2db, the PoE2 wiki, Path of Building 2, poe.ninja, Craft of Exile and Maxroll.
- Saves move to schema 2. Map timers from 1.0 are migrated to endgame runs, and the old save is kept as a backup for 14 days after the first successful 1.1 save. Settings has a "Restore pre-1.1 backup" button while it exists.
- Save safety: if the browser's storage is full, a banner says changes aren't being saved and offers Export JSON. A save that can't be read is never overwritten; the banner offers an export and a "Start saving anyway" button. If the backup can't be written, the migration isn't saved.
- Endgame history is capped at 5000 runs (oldest dropped, with a notice). Dates and atlas values in saves and imports are validated.
- Maps CSV: cells that start with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with `'`, so spreadsheets don't run them as formulas.
- Desktop hotkeys must use Ctrl+Alt or Ctrl+Shift plus one letter, digit or F-key. System combos (Ctrl+Alt+Delete, Ctrl+Shift+Esc and others) and duplicates are refused, and Settings shows whether each one registered or is in use by another app.
- Endgame checklist corrected against the 0.5.5 notes and poe2db: King in the Mists, the Aberration and the gateway quests fixed, unconfirmed items marked.
- Settings and Help open from every tab. The tab bar stays at the top while scrolling, campaign-only toggles hide on other tabs, and on phones the header's rarely used buttons sit behind a ⋯ menu.
- Endgame: maps per hour shows after 10 minutes of data, clearer empty state, a note that endgame data is per character, and labelled run buttons.
- Settings and Help are proper modal dialogs: Esc or a click outside closes them, focus returns to where it was, and in-app hotkeys (Space and others) don't fire while any dialog is open.
- Phone: the tab row stays at the top while scrolling, and the ⋯ menu closes on Esc, an outside tap or after picking an item.
- The now bar no longer clips the New run button at 1280×720.

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
