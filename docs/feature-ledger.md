# Feature ledger: released vs proven vs in development

_Built 2026-11-09 by comparing four trees: the published Workshop item, git `master`, branch `dev`, and the
live in-game copy (`Mods/local-cheat-panel` → `src/`, symlink). Keep it current at every release._

| Tree | What it is | Where |
|---|---|---|
| **Released (v4)** | Workshop item **3736063097** "ALL MIGHTY SAM'S POWERS", v4 uploaded 2026-11-09 14:31 ("Upload a new version", Public, tags kept, 2,007 subscribers); v3 was 2026-06-03 | Steam (copy: `~/Library/Application Support/Steam/steamapps/workshop/content/1295660/3736063097`) |
| **master** | v3 + every round proven in game, up to the 2026-11-03 river writer | GitHub `SamuelD27/cheat-panel` |
| **Public v4 build** | the public subset of master, folder `dist-workshop/` (built by `scripts/build-workshop.sh c5f2c94`); this is what the Workshop serves since 2026-11-09 | git `master`, VM `C:\civ7\cheat-panel\dist-workshop` |
| **dev** | master + the 2026-11-05 wonders round (not proven yet) | local branch only; this is what the game loads |

Evidence keys: ✅ **you** = you confirmed it in game; ✅ **log** = the game's UI.log or the river-writer log shows a
successful real run; 🟡 = written and headless-tested, never confirmed in game; ⛔ = last report says it does not work.

## 1. Already released

**v4, 2026-11-09:** every row of section 2 marked "Public v4: yes", plus the 3a rows below (shipped
without an in-game confirmation, the owner chose a direct update with no private dry run).

**v3, 2026-06-03:**

- Player tab: gold, influence, yields. Research tab: instant research and civic.
- Units tab: per-row heal, +XP, promote, delete, restore movement; infinite-movement toggle; duplicate.
- Cities tab: per-row set population, complete production; Claim a tile (native `purchasePlot` rules).
- Map tab: read-only hex minimap (filters Cities / Resources / Me, zoom, hover tooltip, click-to-pan camera,
  resource and wonder spotlight); big-map crash fix.
- Creative tab: paint terrain, feature, resource, biome; Clear resource; single-tile natural wonders (partial).
- Clean exit from paint/claim modes (Esc, right-click, banner button).

**Was broken for subscribers on v3 after the game updates** (fixed by v4, live since 2026-11-09): Creative paint and City Claim clicks do nothing on
build 25516395 (input-handler contract change, fixed in `ce03415`); unit Delete silently fails on 1.4.1+
(fixed in `d445670`).

## 2. New, proven and tested (git `master`)

| Feature | Commit | Public v4 | Evidence |
|---|---|---|---|
| Panel opens again after the 24661151 update; dock skull survives Reload UI | `48a9c33` | yes | ✅ you, 2026-09-14 |
| Creative paint + plot modes work on build 25516395 (InputHandlerState) | `ce03415` | yes | ✅ log 2026-11-05: paint clicks reach `commit` (`paint.click` / `commit` lines) |
| Teleport the selected unit to a clicked minimap tile (same continent) | `4ee64c9`…`8f77a1e` | yes | ✅ you, 2026-07-14 ("works but can't teleport out of home continent") |
| Unit Delete via `DESTROY_ELEMENT` (1.4.1 rejects the old command) | `d445670` | yes | ✅ live tuner check 2026-06-25; teleport's destroy step uses it |
| Collision-proof database rows (no shell-DB rollback that broke other mods) | `8f68451` | yes | ✅ no rollback since 2026-09-14 with the dev copy alone |
| **Reveal map / Restore fog** (Units OFF = terrain only, Restore re-fogs unexplored tiles) | `a4340ab` | yes | ✅ log 2026-11-05 (128×128): 3 reveals ok, 3 restores ok (one full, two keeping 1 tile) |
| Creative paint read-back: correct green/red result, reasons, Clear entries, Gold tags, full list | `a4340ab` | yes | ✅ log 2026-11-05: `paint.done` ok/warn with the right messages; Fish/Hardwood removed |
| Minimap rivers drawn from the real river types | `a4340ab` | yes | ✅ log 2026-11-05: `map.rivers … src=RiverTypes` |
| Painted Navigable River: honest notes, minimap colour, 3D stand-in tint | `c5f2c94` | yes | ✅ you, 2026-11-03 ("just adds blue tint") |
| **River writer**: painted rivers become real rivers (after save & load) | `e6a1bfa` | **no** (private) | ✅ you, 2026-11-04 ("it works"); writes in `lcp-river-writer.out.log` |
| Remove river (queued) for minor rivers | `e6a1bfa` | **no** (private) | ✅ verified in game data 2026-11-04 |
| River-writer auto start/stop with the game (LaunchAgent) | `e6a1bfa` | **no** (Mac only) | ✅ log 2026-11-05 19:25 start, 19:57 "Civ VII has quit: exiting" |
| Mac scripts (`link.sh`, `deploy.sh`, `tail-log.sh`), Mac-first docs | `be9563c` | n/a | in use since 2026-06-12 |

Never public: the unlimited-territory Claim (`setOwnership`, dev build only), the river writer.

## 3. In development / not proven yet

**3a. In master and released in v4 (2026-11-09), never confirmed in game.** Confirm each in game; fix any
that fails in v5 and correct the Workshop change note.

| Feature | Commit | Evidence |
|---|---|---|
| City Claim on build 25516395 (same input fix as paint) | `ce03415` | 🟡 no claim click since the fix |
| Cities tab lists every city (dead nested-scroll cap removed) | `5664382` | 🟡 |
| Restore movement also un-greys the unit's map flag | `606dfad` | 🟡 |
| F8 opens the panel in a match (engine InputAction + key fallback) | `6001de2` | 🟡 binding present in UI.log; no key press seen |
| Multi-tile natural wonders (Creative, experimental) | `a4340ab` | 🟡 |
| Wide-map guards: Reveal refused on maps >128; Teleport/Claim refused in the crash strip | `a4340ab` | 🟡 the allow path ran on 128×128; the refuse path only acts on wider maps |
| Minimap click-and-drag panning | `779293f`…`5a9805e` | ⛔ you, 2026-07-07: "drag and move to navigate on minimap doesn't work" |

**3b. Branch `dev` only (not on GitHub, not in v4).** The 2026-11-05 round, `dev` commit on top of master:

| Feature | Evidence |
|---|---|
| Wonder → (Remove natural wonder): removes every tile of the wonder under the cursor | engine path ✅ (tuner probe 2026-11-05, "removal worked"); the panel button 🟡 never clicked |
| Iguazú Falls / Gullfoss placement that renders (picks a direction, queues a `wf` river job) | 🟡 |
| River-writer `wf` job (writes the falls' minor river) | 🟡 not run live |

Promote 3b to master once its test (`docs/STATUS.md`, "Current round (2026-11-05)") passes:
`git checkout master && git merge --ff-only dev && git push origin master`.
