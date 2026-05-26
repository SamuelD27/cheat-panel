# Civilization VII Cheat Panel — Phase 1 Discovery

## Context

A solo-play cheat/sandbox panel mod for Civilization VII on a Windows Shadow PC. `Research.md` (repo
root) is the reference doc, last verified against patch 1.4 "Test of Time". Phase 1 established ground
truth about the live environment and measured drift from Research.md before any code was written.

**Headline result:** the live environment is in much better shape than Research.md assumed. A
fully-working, Test-of-Time-updated **Sovereign Cheat Panel is already installed locally**, and its
source resolves nearly every API that Research.md marked `(inferred)`. The biggest risk in
Research.md — `.chunk.js` import-alias drift — **does not exist in this build** (there are no
`.chunk.js` files at all). The main blocker is that the **Modding SDK / FireTuner is not installed**,
which limits runtime verification of the new APIs needed for the features Sovereign lacks.

## 1. Environment facts

| Item | Finding |
|---|---|
| Game install | `C:\Program Files (x86)\Steam\steamapps\common\Sid Meier's Civilization VII\` (Steam) |
| Steam app id | `1295660`; single Steam library; Civ VI (`289070`) also present |
| Build id | **`23245653`** (no marketing version string on disk; `LastUpdated` ≈ May 2026) |
| Patch | **Update 1.4.0 "Test of Time" (May 19, 2026)** — confirmed by the installed mod's modinfo comment |
| Base UI source | **Unpacked & readable** at `Base\modules\{core,base-standard,age-antiquity,age-exploration,age-modern}` — 1,379 `.js` files |
| `.chunk.js` files | **ZERO** anywhere in the install |
| New UI tree | `core\ui-next\` exists alongside `core\ui\` (Solid.js-based; `focus-manager` lives here) |
| User data | `%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\` — Mods, Logs, AppOptions present |
| Mod manager | **Vortex** (Nexus) + **Steam Workshop**, both active |
| Logs | `Logs\UI.log` active; `console.log` → UI.log confirmed |

### Installed mods (relevant)
- **Sovereign Cheat Panel** — deployed at `Mods\modules\` (`<Mod id="sovereign-cheat-panel">`), updated for 1.4.0. Fork candidate / primary reference.
- "Izica's dev/cheat panel (fixed)" (Workshop `3645445515`).
- Several map mods (More Diverse Maps, More Natural Wonders, YnAMP, Random Worlds, …).

## 2. SDK & debug status (blockers needing user action)

| Item | Status | Action |
|---|---|---|
| **Modding SDK / FireTuner** | **NOT installed** | Install "Sid Meier's Civilization VII - Development Tools" via Steam → Tools, for live API verification. Not strictly required to build. |
| `EnableDebugPanels` | commented (`;EnableDebugPanels -1`, line 33) | set `1`, or use launch option `-EnableDebugPanels 1` |
| `EnableTuner` | commented (`;EnableTuner -1`, line 75) | set `1`, or `-EnableTuner 1` |
| Achievements | `;AchievementsRestrictedByTuner 1` (line 133) | tuner/debug disables achievements — expected for a cheat mod |
| Workshop conflict | subscribed Sovereign registers `panel-cheat` + patches dock | **disable Workshop Sovereign + Izica** before testing this fork |

## 3. API drift vs Research.md (the diff)

Legend: ✅ verified working · ⚠️ different from Research.md · ❓ still needs runtime verification.

### 3.1 UI framework / imports — major divergence, but simpler than Research.md
| Concern | Research.md | Actual (build 23245653) |
|---|---|---|
| Panel base | `{ P as Panel }` from `panel-support.chunk.js` | ✅⚠️ `import Panel from '/core/ui/panel-support.js'` (default export) |
| FocusManager | `/core/ui/input/focus-manager.js` | ✅⚠️ `import { FocusManager } from '/core/ui-next/services/focus-manager.js'`; `FocusManager.get().setFocus(root)` |
| Dialog | `manager-dialog-box.chunk.js` | ✅⚠️ `/core/ui/dialog-box/manager-dialog-box.js` → `createDialog_ConfirmCancel/_Confirm`; `DialogBoxAction` from `model-dialog-box.js` |
| ContextManager | `.push("cheat-panel",{singleton,createMouseGuard})` | ✅ default import; `.push('panel-lcp',{singleton:true})`, `.pop()`, `.isCurrentClass()`, `.registerEngineInputHandler()` |
| Panel registration | (implicit) | ✅ `Controls.define('panel-lcp', { createInstance, content:['fs://game/base-standard/ui/cheat-panel/cheat-panel.html'], classNames })` |
| Dock launcher | `decoratePanel(...)` from `decorate.chunk.js` | ⚠️ no such file. Resolve dock class via `customElements.get('panel-sub-system-dock')` / `Controls.getDefinition`, monkey-patch `onInitialize`, call dock's `this.addButton({...})`. Official alt: `ModdingRegistry.add({parentID,modSlot,componentTag})`. |
| Events bus | `Engine.on("PlayerTurnBegan")`, `"CityGrowth"` | ⚠️ lowercase `engine.on`; `PlayerTurnBegan`→`PlayerTurnActivated`/`LocalPlayerTurnBegin`; `CityGrowth`→`CityPopulationChanged`; `UnitMoveComplete`✅; `UnitMovementPointsChanged`✅ |

### 3.2 Cheat actions — verified from installed Sovereign source
| Feature | Research.md (inferred) | Actual verified call |
|---|---|---|
| Local player | `GameContext.localPlayerID` | ✅ `Players.get(GameContext.localPlayerID)` |
| Gold | `Treasury.changeGoldBalance(amt,-1)` | ✅ identical |
| Influence | `Stats.changeYieldStockpile(YIELD_INFLUENCE)` | ⚠️ `player.DiplomacyTreasury.changeDiplomacyBalance(amt)` |
| Attribute pts | (renamed) | ✅ `player.Identity.addWildcardAttributePoints(1)` |
| Selected unit | `Units.get(getHeadSelectedUnit())` | ✅ `getHeadSelectedUnit()` → ComponentID `{owner,id}`; guard `owner!==-1 && id!==-1` |
| Restore movement | `unit.Movement.restoreMovement()` | ⚠️ `Units.restoreMovement(unitId)` (static) |
| Heal | `unit.Health.changeDamage(-cur)` | ⚠️ `Units.setDamage(unitId, 0)` (static) |
| Give XP | `unit.Experience.changeExperiencePoints(amt)` | ⚠️ `Units.changeExperience(unitId, amt)` (static) |
| Iterate units | `player.Units.getUnits()` | ✅ identical |
| Complete production | `BuildQueue.addProgress(cost)` | ⚠️ `city.BuildQueue.completeProduction()` |
| Add population | `Growth.addPopulation(1)` | ⚠️ `city.addRuralPopulation(1)` |
| Selected city | (n/a) | ✅ `UI.Player.getHeadSelectedCity()` → cityID; `Cities.get(cityID)` |
| Iterate cities | `Cities.getIds()` | ⚠️ `player.Cities.getCities()` |
| Complete research | `Techs.setResearchProgress(node,cost)` | ⚠️ grant-yield overflow: `Game.ProgressionTrees.getTree(pid, techs.getTreeType())` → node → `Players.grantYield(pid, YieldTypes.YIELD_SCIENCE, enough)` |
| Complete civic | `Culture.setResearchProgress` | ⚠️ same via `culture.getActiveTree()` + grant `YIELD_CULTURE` |
| Refresh MP cosmetic | suggested | ✅ `UI.Player.deselectAllUnits(); UI.Player.selectUnit(id)` |

### 3.3 Map editing & spawn/destroy — confirmed present (`base-standard\ui\tuner-input\tuner-input.js`)
- `WorldBuilder.MapPlots.setTerrain/setFeature/setResource/setBiome/setFertility/setOwnership(type, loc)` — `loc={x,y}`.
- Clears: `FeatureTypes.NO_FEATURE`, `ResourceTypes.NO_RESOURCE`, `FertilityTypes.NO_FERTILITY`, `PlayerIds.NO_PLAYER`.
- ❓ Type-arg format (hash vs `$index`) needs a runtime check. `MapConstructibles.addRoute/addDiscoveryType` use `Database.makeHash(...)`.
- Spawn: `Game.PlayerOperations.sendRequest(pid, "CREATE_ELEMENT", {Kind, Type, Location, Owner[, Parent, Progress]})`.
- Destroy: `Game.PlayerOperations.sendRequest(pid, "DESTROY_ELEMENT", {Kind, Owner, LocalID})`.
- ⚠️ Unit delete = `DESTROY_ELEMENT` or `UNITCOMMAND_DISBAND` (not `"UNITCOMMAND_DELETE"`).
- ❓ `setRevealed` not seen; fog reveal not shipped (use debug menu).

### 3.4 Unit commands/operations — confirmed (base UI)
`Game.UnitCommands.sendRequest(unitId, type, args)` + `.canStart`. Types via enums (`UnitCommandTypes.PROMOTE`) and strings (`"UNITCOMMAND_PROMOTE"`, `"UNITCOMMAND_DISBAND"`). Promotion reads on `unit.Experience`: `getNumPromotions`, `getStoredPromotionPoints`, `hasPromotion`, `canPromote`. ❓ apply-specific-promotion + enumerate-earned-promotions (for duplication) need verification.

### 3.5 Hotkey binding (verified from Sovereign `database/input.xml`)
Schema is `<InputActions>` + `<InputActionDefaultGestures GestureType="KBMouse" GestureData="KEY_F8">` (not Research.md's `<ActionGroupBindings>`/`KEYBOARD_F8`). Loaded at `scope="shell"`. Routed via `ContextManager.registerEngineInputHandler`, dispatch `hotkey-<action>` on window, gated by `InterfaceMode.allowsHotKeys()`; `InputActionStatuses.FINISH`.

### 3.6 HTML / UI primitives (verified from Sovereign `cheat-panel.html`)
`<fxs-subsystem-frame>`, `<fxs-header data-slot="header">`, `<fxs-tab-bar tab-items='[{id,label}]'>` (event `tab-selected`), `<fxs-inner-frame>`, `<fxs-button caption>` (event `action-activate`), `<fxs-stepper captions-list>` (event `component-value-changed`). Tailwind-style classes; tabs toggled via `.hidden`.

> **Content-path convention (resolved):** mod ImportFile `ui/X/Y.html` is addressed as
> `fs://game/base-standard/ui/X/Y.html` regardless of mod id — confirmed across Sovereign and Izica's
> panels. Kept verbatim in the fork.

## 4. Installed Sovereign panel vs our scope
**Has:** 4-tab panel (Player/Units/Cities/Research), +gold, +influence, +attr pts, restore-move
(sel+all), heal (sel+all), +XP, complete-production (sel+all), +population (sel+all), complete
research/civic, gold-skull dock launcher, F8, draggable panel, confirm dialogs, `AffectsSavedGames=0`.

**Missing (our additions):** per-row unit list; per-row city list; map paint tab; persistent
infinite-move toggle; unit duplication with promotions; yield rate manipulation.

## 5. Open questions / risks into Phase 2
1. No FireTuner (SDK absent) — build from Sovereign + tuner source; probe via `LCP:` logs.
2. `Game.maxPlayers` SP-guard unverified (Sovereign doesn't guard) — verify in M1.
3. `set*` type-arg format (hash vs `$index`) — verify before Map tab.
4. Plot selection for Map tab — needs an interface mode (`ChoosePlotInterfaceMode`).
5. Terrain visual refresh after `setTerrain` mid-game — banner it.
6. Content fs path — **resolved** (`fs://game/base-standard/...`).
7. Workshop conflict — disable Workshop Sovereign/Izica during dev.
8. Deployment — junction to `Mods\`, not via Vortex.

## 6. Verdict
Game current (23245653 / 1.4.0) ✅ · base UI source readable ✅ · proven reference mod on disk ✅ ·
Research.md's #1 risk (chunk drift) void ✅. Blockers: install SDK (optional), enable debug/tuner,
disable Workshop cheat panels before testing.
