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
| **M4** | Cities tab: per-row city list (set pop / complete prod / +gold) | 🟡 **implemented & deployed, NOT yet verified (user away)** | — |
| **M5** | Map tab: paint terrain/feature/resource/biome on a clicked plot | ⬜ pending | — |
| **M6** | Polish: steppers, drag-persist, conflict-detect, banners, docs | ⬜ pending | — |

## ▶ Immediate next action: verify M4 in-game (user was away during the build)

**M4 needs a FULL GAME RESTART** (new file `tab-cities.js` registered in the modinfo + a new text
string), not just Reload UI. Then **F8 → Cities tab**, scroll to the **"── All Cities ──"** list:
1. Each city shows a row: `<name> · pop N · prod:<item|idle> · (x,y)`. Click the **label** → camera
   pans to the city.
2. **[+Pop]** (uses the pop stepper amount at the top of the tab) → city population ticks up in the row.
3. **[Prod]** → completes the city's current production (the `prod:` field should change / banner shows
   it finished next tick).
4. **[+Gold]** → adds 1,000 gold to the treasury (watch the top-bar gold). _(Gold is a player resource;
   the per-row button is just a convenience — it adds to the empire treasury, not "to that city".)_
5. **[Refresh]** rebuilds the list.

⚠ **Risk to watch (the `Units.create` lesson):** `+Pop` and `Prod` call the city's component methods
directly (`city.addRuralPopulation` / `city.BuildQueue.completeProduction`) — the Sovereign approach,
and the only path that exists (there is **no** instant-complete CityOperation). If either does nothing
in-game, the fix is to route it through `Game.CityOperations.sendRequest(cityID, …)` like the base UI's
build-queue does — see the M3 dup saga below. `+Gold` uses `Treasury.changeGoldBalance` (proven in M0),
so it should always work; if only gold works, that confirms the direct-method theory.

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
