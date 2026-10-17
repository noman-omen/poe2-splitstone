# Changelog

## 1.3.0 (2026-10-17)

- Campaign page uses the full window: the checklist on the left and a run panel on the right, in a centred column up to 1840px wide, with the header and tabs lined up with it. The run panel is 400px wide from 1800px. On desktop the page doesn't scroll; the checklist and the act splits scroll inside their own areas.
- One act at a time. A tab strip above the checklist lists the acts and interludes in the order the route plays them, each marked done, current or upcoming, with that act's time and delta in the tooltip. Arrow keys, Home and End move between tabs.
- The current act is selected on load and whenever a split takes you into a new act. Browsing another act doesn't snap back; a "Current act" button and the C hotkey go back to the current act and zone. The act you picked is remembered per character, outside the save file.
- Completed zones fold to one line (name, time, delta); click anywhere on the row to open one. The current and upcoming zones stay open.
- Act tabs read "Interlude 2 (1/2)" and "(2/2)", and the Runs table lists acts and interludes in the same route order, with the Interlude 2 total after its second part. The act badge says "4/23 steps".
- When the act strip doesn't fit, the edge with more tabs fades. Practising a single act or zone shows "Practice: …" instead of a lone tab.
- Jumping to the current zone lands on a zone boundary under the act header, or at the top when the zone fits there.
- During a run the route bar is one line ("Normal clear · Full campaign · Edit ▸"); Edit opens the full bar.
- Run panel: zone and progress, the segment timer with run time, live delta and the ghost line, Split with Pause, Undo and New run under it, the current step with one hint and the next step, the act's splits against your PB, and the campaign total with sum of best.
- The panel shows the step's objective (up to 3 lines) and one hint (up to 2 lines); gear checkpoints, other hints, route info, class notes and the zone's other steps sit behind "+N more", which also shows a shortened objective or hint in full (hover shows it too). "+N more" and Next step are always on screen, on every zone at 1280x720 and 1366x768. On short windows the act splits fold to the current zone and the act total, and the ghost line sits on the Run row under a smaller timer.
- Click the ghost line to pick a different ghost without leaving Campaign; "More on Runs" opens the full ghost panel. With nothing to race it says "Pick a ghost on Runs".
- The level cue on the panel has −/+. In the desktop app, set your in-game name on the Character tab and the level follows your level-ups in Client.txt. Only the game's own "is now level" line for that name is read; chat and other players are ignored. Without a name, the panel asks before using a level-up.
- New Runs tab with run history, run analytics and CSV, the full Run & Segments table and the ghost race panel. New Character tab with the character details and PoB2 import. Tabs are now Campaign, Runs, Character, Endgame and Tools.
- Between 960 and 1279px the panel is narrower and the act splits show the current zone and the act total, with a button to show all. Under 960px there's one column, so the checklist never drops below 560px: the compact now-bar stays at the top with Split and the timers, the act tabs scroll sideways under it, and the act splits sit below the checklist.
- Phones: all five tabs fit from 360px wide; on narrower screens the row scrolls sideways and fades at the edge with more tabs. The ⋯ menu button stays on the header's first line. The tab row slides away while you scroll down and comes back when you scroll up.
- Runs: the "Run analytics & CSV" link (to the same page) is gone. Character and the other tabs use the same centred container as Campaign.
- Accessibility: one main landmark around the tab panels, and the Runs table's first column header is labelled.
- Desktop: `desktop/package.json` declares Node 22 or newer for development.
- Desktop overlay is smaller: it shows only the current step and the next step. Hints stay in the app. The default panel is 400x80 at 1080p, the same on smaller screens and larger on taller ones (533x107 at 1440p), centred at the top below the boss health bar.
- Unlock the overlay (`Ctrl+Alt+O` or the tray) to drag it anywhere and resize it from the bottom-right corner. The corner follows the pointer; at the top centre the overlay grows evenly to both sides and stays centred, and the top-right spot becomes a custom position. Size and position are remembered. The text scales to fit the window you set and keeps one size from step to step; only an unusually long step gets smaller text, and it's cut short only at the smallest size (11px). The Next line is never smaller than 11px. Every route step and its next step fit uncut at the default size on 720p to 1440p screens.
- The overlay text size option is gone. If you had Small or Large, the overlay starts at a matching smaller or larger size.
- Settings → Desktop has an overlay position option (Top center, Top right, or where you dragged it) and "Reset overlay position and size". If your overlay was still at the old top-right default, it moves to top centre; a position you chose is kept.

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
