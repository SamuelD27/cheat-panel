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

## To verify at runtime (❓)
- `Game.maxPlayers` (single-player guard).
- `set*` type-arg format: `Database.makeHash("TERRAIN_X")` vs `GameInfo.Terrains.lookup(...).$index`.
- Promotion enumeration on `unit.Experience` for duplication; exact `UNITCOMMAND_PROMOTE` args.
- Absolute set-population (vs repeated `addRuralPopulation(1)`); `addUrbanPopulation`.
- Event names for ∞-move hook: `PlayerTurnActivated` / `LocalPlayerTurnBegin` / `UnitMovementPointsChanged`.
- Plot-selection interface mode (`ChoosePlotInterfaceMode`) for the Map tab.
