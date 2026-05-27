# API snapshot — Civ VII build 23245653 (Test of Time 1.4.0)

Live engine signatures confirmed for this build. Fill the FireTuner column once the SDK is installed
(`JSON.stringify(Object.getOwnPropertyNames(<obj>))`). Until then, "Source" = verified from installed
Sovereign mod or base-game UI source.

## Verified working (from Sovereign source / base UI)
| Call | Owner | Source |
|---|---|---|
| `Players.get(GameContext.localPlayerID)` | global | Sovereign |
| `player.Treasury.changeGoldBalance(amount, -1)` | Treasury | Sovereign |
| `player.DiplomacyTreasury.changeDiplomacyBalance(amount)` | DiplomacyTreasury | Sovereign |
| `player.Identity.addWildcardAttributePoints(1)` | Identity | Sovereign |
| `UI.Player.getHeadSelectedUnit()` → ComponentID `{owner,id}` | UI.Player | Sovereign |
| `Units.get(id)` / `Units.restoreMovement(id)` / `Units.setDamage(id,0)` / `Units.changeExperience(id,n)` | Units (static) | Sovereign |
| `player.Units.getUnits()` | PlayerUnits | Sovereign |
| `UI.Player.getHeadSelectedCity()` / `Cities.get(cityID)` | UI.Player / Cities | Sovereign |
| `city.BuildQueue.completeProduction()` | BuildQueue | Sovereign |
| `city.addRuralPopulation(1)` | City | Sovereign |
| `player.Cities.getCities()` | PlayerCities | Sovereign |
| `player.Techs.getTreeType()` / `getNodeCost(node)` / `getTurnsLeft()` | Techs | Sovereign |
| `player.Culture.getActiveTree()` / `getNodeCost(node)` / `getTurnsLeft()` | Culture | Sovereign |
| `Game.ProgressionTrees.getTree(pid, treeType)` → `.nodes[.activeNodeIndex].nodeType` | Game.ProgressionTrees | Sovereign |
| `GameInfo.ProgressionTreeNodes.lookup(nodeType)` | GameInfo | Sovereign |
| `player.Stats.getNetYield(YieldTypes.YIELD_*)` | Stats | Sovereign / base UI |
| `Players.grantYield(pid, YieldTypes.YIELD_*, amount)` | Players (static) | Sovereign |
| `WorldBuilder.MapPlots.set{Terrain,Feature,Resource,Biome,Fertility,Ownership}(type, loc)` | WorldBuilder | tuner-input.js |
| `Game.PlayerOperations.sendRequest(pid, "CREATE_ELEMENT"/"DESTROY_ELEMENT", args)` | Game.PlayerOperations | tuner-input.js |
| `Game.UnitCommands.sendRequest(id, type, args)` / `.canStart(...)` | Game.UnitCommands | base UI |

## Verified IN-GAME during M3/M4 (2026-05-27) — UI-isolate caveats
- ⚠️ **`Units.create(pid, {...})` is gameplay-SCRIPT-only.** From the panel (UI) isolate it returns
  `{Success:false}` even on a valid empty tile. **Spawn units via the tuner path instead:**
  `Game.PlayerOperations.sendRequest(pid, "CREATE_ELEMENT", { Kind:"UNIT", Type:<typeHash>, Location:{x,y}, Owner:pid, IndependentIndex:-1 })`
  (fire-and-forget — no synchronous result/ID). `Type` = the source unit's `.type` hash works directly.
- **Unit delete:** `UNITCOMMAND_DELETE` (unconditional; the trash-button), NOT `UNITCOMMAND_DISBAND`
  (contextual, silently rejected by `canStart`). Pass `{X:-9999, Y:-9999, UnitAbilityType:-1}`.
- **Plot validation helpers (UI isolate):** `GameplayMap.isValidLocation({x,y})` (takes a location obj),
  `GameplayMap.isWater(x,y)` / `isMountain(x,y)` / `isImpassable(x,y)` (take x,y), `MapUnits.getUnits(x,y)`
  → array of **ComponentIDs** (`.owner`/`.id`; resolve via `Units.get(id)`),
  `GameplayMap.getAdjacentPlotLocation(loc, dir)` over `DirectionTypes.NUM_DIRECTION_TYPES` (6 hexes).
- **Unit "kind" / stacking:** `GameInfo.Units.lookup(unit.type)` → `.Domain` (DOMAIN_LAND/SEA/AIR),
  `.FormationClass` (LAND_COMBAT/CIVILIAN/COMMAND — the per-tile stack limit), `.CoreClass`.
- **City mutations (UI):** base UI uses `Game.CityOperations.sendRequest(cityID, CityOperationTypes.BUILD, args)`
  for the build queue; only `BUILD` / `CONSIDER_TOWN_PROJECT` op types exist. There is **no** instant-complete
  CityOperation — `city.BuildQueue.completeProduction()` / `city.addRuralPopulation(n)` are the only path
  (Sovereign approach). ❓ **M4 to confirm in-game these direct city methods actually fire from the UI isolate**
  (if not, no UI workaround exists for instant-complete; would need a different mechanism).
- **City display (UI-readable):** `city.name` (→ `Locale.compose`), `city.population` / `urbanPopulation` /
  `ruralPopulation`, `city.location`, `city.isTown`. `player.Cities.getCities()` → city **objects**.
- **Promotions are commander-only** (`UNITCOMMAND_PROMOTE` gated on `unit.isCommanderUnit`). Read via
  `unit.Experience.hasPromotion(disciplineType, promotionType)`; grant via
  `Game.UnitCommands.sendRequest(id, UnitCommandTypes.PROMOTE, {PromotionType:makeHash(p), PromotionDisciplineType:makeHash(d)})`
  — but `canStart` enforces commander status + stored promotion points + tree prereqs, so copying onto a
  fresh clone is non-trivial (deferred; see Minor_todos).

## To verify at runtime (❓)
- `Game.maxPlayers` (single-player guard).
- `set*` type-arg format: `Database.makeHash("TERRAIN_X")` vs `GameInfo.Terrains.lookup(...).$index`.
- Promotion enumeration on `unit.Experience` for duplication; exact `UNITCOMMAND_PROMOTE` args.
- Absolute set-population (vs repeated `addRuralPopulation(1)`); `addUrbanPopulation`.
- Event names for ∞-move hook: `PlayerTurnActivated` / `LocalPlayerTurnBegin` / `UnitMovementPointsChanged`.
- Plot-selection interface mode (`ChoosePlotInterfaceMode`) for the Map tab.
