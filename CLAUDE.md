# Local Cheat Panel — Claude Code project guide

**Read `docs/STATUS.md` first** — it has the current build state, the immediate next action, and the
open issues. This file is the short, always-loaded version.

## What
A private, single-player Civilization VII cheat/sandbox panel mod (private fork of the Sovereign
Cheat Panel). Mod id `local-cheat-panel`, element `panel-lcp`, game build 23245653 / Update 1.4.0
"Test of Time". Opens with F8 or the dock skull button.

## Where we are
M0–M2 done & tested in-game. **M3 (global infinite-move toggle + Duplicate Selected Unit + per-row
Delete) is implemented and deployed but NOT yet verified in-game.** Next is M4 (Cities per-row list),
then M5 (Map paint), then M6 (polish). See `docs/STATUS.md` for the M3 test steps and a Steam launch
error (0x20 — environmental, not the mod).

## How to work here (workflow contract)
- **Milestone-by-milestone.** After each milestone: commit → confirm deployed → give the user a
  **specific in-game test plan** → **WAIT for their report** before the next. Never batch milestones.
- Each milestone must be independently revertable.

## Conventions
- **Single-player guard** on every cheat: `api.guardSP()` (uses `Configuration.getGame().isAnyMultiplayer`,
  NOT `Game.maxPlayers`).
- Prefix all logs with `LCP:`.
- All `/core` & `/core/ui-next` imports live ONLY in `src/ui/cheat-panel/shared/imports.js`.
- Mod-internal ES imports use absolute `/base-standard/ui/cheat-panel/...`; register every new mod
  JS/HTML file as `<ImportFiles>` in `src/local-cheat-panel.modinfo`.
- **Never vendor/replace base-game UI files** (resolve at runtime + decorate). `AffectsSavedGames=0`.
- No `fxs-list` in this build — use plain scrollable DOM rows.
- The unpacked base UI source at `…\steamapps\common\Sid Meier's Civilization VII\Base\modules\` is the
  authoritative API reference; trust it over `Research.md` when they disagree.

## Deploy / test loop
- Deploy is a live junction `Mods\local-cheat-panel → .\src` (`scripts\link.ps1`). Not Vortex.
- JS-only edit → in-game `~` → UI → **Reload UI**. modinfo/database/text/new files → **restart game**.
- Keep the Workshop **Sovereign** + **Izica** cheat panels DISABLED during dev (they conflict).
- Logs: `%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\Logs\UI.log`; filter `LCP:`
  (`scripts\tail-log.ps1`).

## git on this machine
`C:\Program Files\Git\cmd\git.exe`. Commit each milestone. PowerShell 5.1 word-splits multi-line/quoted
commit messages passed inline — write the message to a file (`[System.IO.File]::WriteAllText($tmp,$msg)`)
and `git commit -F $tmp`.

## Key docs
- `docs/STATUS.md` — current state / next action / open issues (**start here**).
- `docs/plan.md` — full implementation plan (milestones, features, risks).
- `docs/discovery.md` — environment + API-drift findings.
- `docs/api-snapshot-23245653.md` — verified engine API signatures.
- `docs/workshop-publishing.md` — how the public `sam-cheat-panel` Workshop build relates to `src/`, and how to launch/update it.
- `Research.md` — background technical reference.
