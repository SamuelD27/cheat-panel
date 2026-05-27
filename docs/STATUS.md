# Local Cheat Panel — Build Status & Handoff

_Last updated: 2026-05-27. Read this first to resume work._

## What this is
A **private, single-player** Civilization VII cheat/sandbox panel mod, built as a private fork of the
Sovereign Cheat Panel. Mod id `local-cheat-panel`, custom element `panel-lcp`. Target game build
**23245653 / Update 1.4.0 "Test of Time"**. Opens with **F8** or the gold-skull button on the
sub-system dock.

## Current status (milestone-by-milestone)

| M | Scope | State | Commit |
|---|---|---|---|
| **M0** | Fork Sovereign → `src/`, rebrand, junction deploy, git | ✅ done & tested in-game | `a7b4118` |
| **M1** | Modularize: `shared/imports.js` + `shared/api.js`; `LCP:` logging; single-player guard | ✅ done & tested | `a0a7472` |
| **M2** | Units tab: per-row unit list (Heal / +XP / Move; click row = camera pan) | ✅ done & tested | `d86c3d6` |
| **M3** | Global ∞-move toggle + Duplicate Selected Unit + per-row Delete | ✅ **done & verified in-game (2026-05-27)** | `c6f7f98` +`e8a8ea1` +dup-rewrite |
| **M4** | Cities tab: per-row city list (set pop / complete prod) | ✅ **done & verified in-game (2026-05-27)** | `6521393` |
| **M4.1** | Fixes: front-end LOC ref, drop redundant per-city +Gold (⚠ its "F8 in-game" attempt was a save-breaking regression — see M4.1-fix) | ⚠ partially reverted | `bdafc56` |
| **M4.1-fix** | Revert game-scope `input.xml` registration (it broke loading ALL saves) | 🟡 **fixed & deployed, NOT yet verified** | _uncommitted_ |
| **M4.2** | Cities tab: per-row [Grow] → native tile picker, claim adjacent tiles (claim-only) | 🟡 **implemented & deployed, NOT yet verified** | `45e7378` |
| **M5** | Map tab: paint terrain/feature/resource/biome on a clicked plot | ⬜ pending | — |
| **M6** | Polish: steppers, drag-persist, conflict-detect, banners, docs | ⬜ pending | — |

## ▶ Immediate next action: RESTART and confirm "Continue Game" loads (M4.1-fix), then verify M4.2

### 🛑 Regression found & fixed (2026-05-27) — the game couldn't load any save
**Symptom:** clicking **"Continue Game"** failed — the game bounced back to the main menu instead of
loading. **Root cause (confirmed in `Modding.log`):** M4.1 (`bdafc56`) registered `database/input.xml`
as a **game-scope** `<UpdateDatabase>` action to try to make F8 work in-game. But `input.xml` defines
`InputActions` / `InputActionDefaultGestures` rows, which exist only in the **front-end (shell) input
database**, not the gameplay database. Loading it in game scope errors
(`UpdateDatabase - Error Loading XML … 'database/input.xml' … require a rollback`), and the engine then
does a **complete rollback to vanilla**, so NO save loads while the mod is enabled. **Fix:** removed the
game-scope `input.xml` registration (kept the working shell-scope one). _Engine lesson:_ input-action
XML is shell-scope only; a game-scope `<UpdateDatabase>` cannot reach the in-game input tables.

**This fix needs a FULL GAME RESTART** (modinfo change), not just Reload UI. After restart, confirm:
1. **"Continue Game" actually loads the save** (the regression is gone). This is the gating test.
2. **Cities tab rows show only [+Pop] [Prod]** (the redundant per-row [+Gold] was removed — gold is
   empire-wide, already covered by the Player tab's Add Gold buttons; M4.1).
3. **M4.2 [Grow]:** open a city row's **[Grow]** → panel closes, camera pans to the city, the native
   tile picker highlights valid **adjacent** plots; clicking one claims it into the city. Check `UI.log`
   for `LCP: growCity: EXPAND offers N plot(s)` to answer whether EXPAND needs a pending growth slot.

**Re: F8 in-game** — F8 now opens the panel **only at the main menu** (shell scope). In-game, use the
**dock skull button** (works). A correct in-game F8 needs a JS-level key approach (not a DB action);
tracked as a follow-up, not bundled into this fix.

### M4.2 — free city-territory growth (researched; awaiting user direction)
User wants to "grow the city as I want": open the classic Grow-City tile picker, claim **adjacent**
tiles with **no distance limit**, and (ideally) **give up** tiles too.
- ✅ **CLAIM is doable via the native UI.** `InterfaceMode.switchTo("INTERFACEMODE_ACQUIRE_TILE",
  {CityID})` is exactly the game's grow-city tile picker. It highlights only valid **adjacent** plots
  (adjacency is the engine's only rule — no ring/distance cap, matching the request), and committing a
  plot fires `Game.CityCommands.sendRequest(cityID, CityCommandTypes.EXPAND, {X,Y})`. Valid plots come
  from `Game.CityCommands.canStart(cityID, EXPAND, {}, false).Plots`. Refs:
  `base-standard/ui/interface-modes/interface-mode-acquire-tile.js`,
  `base-standard/ui/place-population/model-place-population.js`.
- ❌ **RELINQUISH is NOT engine-supported.** No `RELINQUISH`/`RELEASE`/remove-plot CityCommand exists,
  and there is no `WorldBuilder.CityManager`/plot-owner-set API. Once a city owns a plot it is permanent
  (until the city is destroyed). The only theoretical "give up" path is destroy + recreate the city —
  drastic and risky; not recommended.
- ❓ **Open question for testing:** whether `EXPAND` works freely as a cheat with no pending growth, or
  must be paired with the existing `+Pop` (which creates a growth/worker slot to place). Resolve in-game.

### M3 outcome (DONE, verified 2026-05-27) — and the key API lesson
- ✅ ∞-move toggle (minor caveat: units spawned while ON → `docs/Minor_todos.md` #1).
- ✅ Delete: was `UNITCOMMAND_DISBAND` (contextual, silently rejected) → now `UNITCOMMAND_DELETE` with
  the standard `{X,Y,UnitAbilityType}` params.
- ✅ Duplicate: **the big lesson** — `Units.create` is a gameplay-SCRIPT API and returns
  `{Success:false}` from the panel (UI) isolate even on a validated empty tile. The UI-isolate way to
  spawn a unit is the **tuner path**: `Game.PlayerOperations.sendRequest(pid, "CREATE_ELEMENT",
  {Kind:"UNIT", Type:unit.type, Location, Owner, IndependentIndex:-1})`. Duplicate now also validates
  the target tile itself (`findPlacementPlot`/`plotBlockReason` in `api.js`: in-bounds, land, not
  mountain/impassable, no other-player unit, no same-`FormationClass` stack).
- 🔎 **Rule of thumb going forward:** state-mutating engine calls usually need a UI-callable
  `*.sendRequest` operation (PlayerOperations / UnitCommands / CityOperations); direct
  `Units.create`-style methods may be inert from the panel. Verify against an actual `ui/` call site.

## ⚠ Open issue: Steam launch error 0x20 (ERROR_SHARING_VIOLATION)
On 2026-05-27 the game failed to launch from Steam: _"le processus ne peut pas accéder au fichier car
le fichier est utilisé par un autre processus" (0x20)_. **This is not the mod** — a sharing violation
at process launch happens before any mod is read. Diagnostics confirmed: no Civ 7 process running,
junction valid, modinfo reachable, no log-tail holding `UI.log`. Fixes (easiest first): fully exit
Steam from the tray and relaunch; reboot Windows; Steam → Verify integrity of game files; check
antivirus isn't locking the `.exe`. If it still won't launch, temporarily remove the junction
(`Mods\local-cheat-panel`) to confirm the game starts clean without the mod.

## Environment & deploy
- **Install:** `C:\Program Files (x86)\Steam\steamapps\common\Sid Meier's Civilization VII\`. Base UI
  source is unpacked at `Base\modules\` — read it for API truth (no published API docs).
- **Deploy:** a directory **junction** `Mods\local-cheat-panel → .\src` (created by `scripts\link.ps1`,
  already in place). Edits in `src/` are live. **Not** managed by Vortex.
- **Conflict:** the Workshop **Sovereign** + **Izica** cheat panels must stay **disabled** during dev.
- **git:** installed at `C:\Program Files\Git`. Commit each milestone.
- **Reload loop:** JS-only edit → in-game `~` → UI → **Reload UI**. `.modinfo` / `database` / `text` /
  new files → **full game restart**. Logs: `…\Logs\UI.log`; filter `LCP:` (`scripts\tail-log.ps1`).

## Repo layout
```
src/local-cheat-panel.modinfo            mod manifest (UIScripts, ImportFiles, UpdateText, input bindings)
src/database/input.xml                   F8 binding (action "lcp-open-panel", gesture KEY_F8)
src/text/Cheat-Panel-Text.sql            in-game LOC_LCP_* strings (game scope)
src/text/en_us/ModuleText.xml            mod name/description loc
src/images/cheat_icon.svg                launcher icon (dock uses an inline base64 skull)
src/ui/sub-system-dock/lcp-sub-system-dock.js   dock launcher + F8 routing (resolves dock at runtime; never vendors it)
src/ui/cheat-panel/cheat-panel.html      fxs-subsystem-frame + 4-tab fxs-tab-bar + unit list container
src/ui/cheat-panel/cheat-panel.js        root Panel: Controls.define('panel-lcp'), lifecycle, UI wiring, tab routing
src/ui/cheat-panel/shared/imports.js     the ONLY file importing /core & /core/ui-next
src/ui/cheat-panel/shared/api.js         SP-guarded wrappers around every verified engine call
src/ui/cheat-panel/shared/infinite-move.js  global ∞-move toggle + engine listeners
src/ui/cheat-panel/tab-units.js          per-row unit list renderer
scripts/{link,deploy,tail-log}.ps1       deploy + log helpers
docs/{discovery,plan,api-snapshot-23245653,STATUS}.md
Research.md                              technical reference (treat live game source as authoritative over it)
```

## Verified engine API cheat-sheet (build 23245653)
Full list + provenance in `docs/api-snapshot-23245653.md`; drift analysis in `docs/discovery.md`.
- Local player: `Players.get(GameContext.localPlayerID)`.
- Gold `Treasury.changeGoldBalance(amt,-1)` · influence `DiplomacyTreasury.changeDiplomacyBalance(amt)`
  · attr pts `Identity.addWildcardAttributePoints(1)` · yield grant `Players.grantYield(pid, YieldTypes.YIELD_*, amt)`.
- Units (statics, take ComponentID): `Units.get(id)`, `Units.restoreMovement(id)`, `Units.setDamage(id,0)`,
  `Units.changeExperience(id,n)`, `Units.create(pid,{Type,Location,Validate:true})→{Success,ID}`. Iterate `player.Units.getUnits()`.
  Selected: `UI.Player.getHeadSelectedUnit()`→ComponentID `{owner,id}`. Disband: `Game.UnitCommands.sendRequest(id,"UNITCOMMAND_DISBAND",{})`.
- Cities: `UI.Player.getHeadSelectedCity()`, `Cities.get(id)`, `player.Cities.getCities()`,
  `city.BuildQueue.completeProduction()`, `city.addRuralPopulation(1)`.
- Research/civic: complete via yield overflow — `Game.ProgressionTrees.getTree(pid, techs.getTreeType())`
  → `tree.nodes[tree.activeNodeIndex].nodeType` → `Players.grantYield(pid, YIELD_SCIENCE/CULTURE, enough)`.
  (Civic tree via `culture.getActiveTree()`.)
- Map paint (M5): `WorldBuilder.MapPlots.set{Terrain,Feature,Resource,Biome,...}(type, {x,y})` — ref `base-standard/ui/tuner-input/tuner-input.js`. ❓ type arg = hash vs `$index` (verify in M5). Spawn/destroy: `Game.PlayerOperations.sendRequest(pid,"CREATE_ELEMENT"/"DESTROY_ELEMENT",{Kind,...})`.
- Events (lowercase `engine.on`): `PlayerTurnActivated`→`data.player`; `UnitMoveComplete`→`data.unit` (ComponentID); also `CityPopulationChanged`.
- Camera: `Camera.lookAtPlot({x,y},{zoom})`. Names: `Locale.compose(unit.name)`.

## Conventions (enforced every milestone)
- **Single-player guard:** every cheat early-returns via `api.guardSP()` (uses
  `Configuration.getGame().isAnyMultiplayer` — NOT `Game.maxPlayers`, which is the civ-slot count).
- **Logging:** prefix all `console.log/error` with `LCP:`.
- **Imports isolated:** all `/core` & `/core/ui-next` imports only in `shared/imports.js`.
- **Mod-internal imports** use the absolute path `/base-standard/ui/cheat-panel/...` (verified
  ImportFile→fs mapping); register each new mod JS/HTML file as an `<ImportFiles>` item in the modinfo.
- **Never vendor/replace base UI files** — resolve at runtime + decorate (vendoring the dock hid base
  UI: age progress / current tech / doctrine). `AffectsSavedGames=0`.
- No `fxs-list` element exists in this build — use plain scrollable DOM rows.
- Promotions are commander-only discipline trees; the user declined promote/promotion-copy.

## git commit gotcha (PowerShell 5.1)
Passing multi-line / quote-containing commit messages inline to native `git` word-splits. Use a
message file: `[System.IO.File]::WriteAllText($tmp,$msg)` (BOM-free) then `git commit -F $tmp`.
LF→CRLF warnings are harmless. (The M2 commit subject has a stray BOM — cosmetic only.)

## Workflow contract
Milestone-by-milestone. After each: **commit** → ensure deployed (junction is live) → give the user a
**specific in-game test plan** → **WAIT for their test report** before starting the next. Don't batch
milestones. Each milestone must be independently revertable (`git checkout <prior>` leaves a working subset).
